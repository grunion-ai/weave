/* Syntax highlighting for fenced code (Issue #35).

   Diagnosis, measured in a live browser at this commit: hljs DOES run in the
   IR editor — Vditor highlights the block's `.vditor-ir__preview` copy on
   render, and by design never tokenizes the editable
   `pre.vditor-ir__marker--pre` (the plain surface shown while the caret is
   inside). The "always one colour" report traces to weave's own slash menu:
   its Code block inserted ```` ``` ```` with no language, hljs fell back to
   plaintext, and plaintext emits zero token <span>s. So every block created
   in-app was born unhighlightable — not a pruned file, not a dead option.

   Two fixes under test here:
   1. the slash Code block carries a language placeholder (the writer types
      over it, same contract as the "Heading" placeholder text), and
   2. rendered document pages (/e/:id/doc.html) highlight language-tagged
      code with the same vendored highlight.js the editor uses — before this
      they shipped bare escaped text.

   Span counts in the live editor are measured by the browser suite in
   test/editor-phase4-browser.test.mjs; this file holds the node-side
   contracts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderDocumentPage } from '../src/markdown.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');

/* The `insert` string of one slash-menu item, found by its label. The
   catalogue is one item per line, so the line IS the object literal. */
function slashInsert(label) {
  const line = APP.split('\n').find((l) => l.includes(`label: '${label}'`));
  assert.ok(line, `the ${label} slash item must exist`);
  const insert = line.match(/insert:\s*'((?:[^'\\]|\\.)*)'/);
  assert.ok(insert, `the ${label} slash item must declare an insert`);
  return insert[1];
}

/* ---------- the slash menu births highlightable blocks ---------- */

test('slash Code block inserts a language placeholder, not a bare fence', () => {
  // A bare ``` block is plaintext to hljs — zero token spans, one colour.
  // The placeholder language makes the block highlightable from birth; the
  // writer edits the info line like any other placeholder text.
  // Read the catalogue by label rather than by field order: the item carries
  // icon/group/hint/aliases too, and a test that assumes their order breaks on
  // every catalogue edit without a single behaviour having changed.
  assert.match(slashInsert('Code block'), /^```\w+\\n/, 'the fence must open with a language');
});

test('the mermaid slash item keeps its own language untouched', () => {
  assert.match(slashInsert('Mermaid diagram'), /^```mermaid\\n/,
    'the mermaid fence names mermaid, not a highlight language');
});

/* ---------- rendered document pages highlight code ---------- */

const JS_DOC = '# t\n\n```js\nconst x = 1;\n```\n';

test('a page with language-tagged code carries the vendored hljs assets', () => {
  const page = renderDocumentPage({ title: 't', markdown: JS_DOC });
  assert.ok(page.includes('/vendor/vditor/dist/js/highlight.js/highlight.min.js'),
    'the page must load the same vendored highlight.js the editor uses');
  // Both palettes ship, gated by media query, so the page follows the OS
  // theme the same way its own CSS variables do.
  assert.match(page, /github\.min\.css"[^>]*media="\(prefers-color-scheme: light\)"/);
  assert.match(page, /github-dark\.min\.css"[^>]*media="\(prefers-color-scheme: dark\)"/);
});

test('the page highlights only language-tagged code', () => {
  // An unlabeled block is plaintext on purpose — auto-detection would guess
  // a different language per visit. The selector must say so.
  const page = renderDocumentPage({ title: 't', markdown: JS_DOC });
  assert.ok(page.includes('code[class*="language-"]'),
    'highlighting must be scoped to language-tagged blocks');
  assert.match(page, /language-(\(mermaid|.*mermaid)/,
    'diagram/math languages must be excluded from hljs');
});

test('a page without code blocks stays free of hljs', () => {
  const page = renderDocumentPage({ title: 't', markdown: '# just prose\n\nhello\n' });
  assert.ok(!page.includes('highlight.min.js'), 'no code, no highlighter');
  assert.ok(!page.includes('github.min.css'), 'no code, no palette');
});

test('an unlabeled code block also stays free of hljs', () => {
  const page = renderDocumentPage({ title: 't', markdown: '```\nplain\n```\n' });
  assert.ok(!page.includes('highlight.min.js'),
    'plaintext blocks have nothing to tokenize');
});

test('hljs keeps token colours but the page keeps the block chrome', () => {
  // github.min.css paints .hljs with its own background + padding; the page
  // already draws the block (border, --soft background, copy button), so the
  // style sheet's chrome must be neutralized or code blocks get a second,
  // clashing box inside the first.
  const page = renderDocumentPage({ title: 't', markdown: JS_DOC });
  assert.match(page, /pre code\.hljs\s*\{[^}]*background:\s*(none|transparent)/);
});
