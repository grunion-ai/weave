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

test('the slash Code block leaves the language to the content', () => {
  /* The old answer to "a bare fence is plaintext to hljs" was to name a
     language for the writer (```js on every block, whatever they pasted). The
     block now detects what it holds, so the fence stays bare and the writer is
     never handed a lie about their own code. */
  assert.equal(slashInsert('Code block'), '```\\ncode\\n```', 'no language is guessed at insert time');
  assert.match(APP, /detectCodeLanguage\(text\)/, 'something has to do the detecting');
});

test('one detector serves the editor and the page', () => {
  /* The rules themselves live in public/editor-lib.js and are unit-tested in
     test/code-detect.test.mjs — including WHY they are rules rather than a
     call to hljs.highlightAuto(). What matters here is that both surfaces ask
     the same question of the same code: a block must not be JSON in the
     editor and plain text on its own page. */
  const lib = readFileSync(join(ROOT, 'public/editor-lib.js'), 'utf8');
  assert.match(lib, /detectCodeLanguage\(text\) \{/, 'the shared rules are in the shared library');

  const fn = APP.slice(APP.indexOf('function refreshCodeAuto'));
  const decorator = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(decorator, /WeaveEditorLib\?\.detectCodeLanguage/, 'the editor asks the library');
  assert.match(decorator, /language-\\S\/\.test\(code\.className\)/, 'a fence that names a language keeps it');
  assert.match(decorator, /vditor-ir__preview > code/,
    'only the rendered copy is touched — the markdown lives in the editable pre beside it');

  const page = readFileSync(join(ROOT, 'src/markdown.js'), 'utf8');
  assert.ok(page.includes('/editor-lib.js'), 'the page loads the same library');
  assert.ok(page.includes('WeaveEditorLib.detectCodeLanguage'), 'and asks it the same question');
  assert.ok(page.includes('highlightElement'), 'a tagged fence is still highlighted as tagged');
  assert.ok(page.includes("body.includes('<pre><code')"),
    'any page with a code block pays for the script, not only a tagged one');
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

test('the page highlights every code block, tagged or detected', () => {
  // An unlabeled block used to stay plaintext on purpose. It is now detected
  // the same way the editor detects it — same rules, same result on both
  // surfaces — so the selector reaches every block and the SCRIPT decides.
  const page = renderDocumentPage({ title: 't', markdown: JS_DOC });
  assert.ok(page.includes("querySelectorAll('pre > code')"),
    'every code block is considered');
  assert.ok(page.includes('WeaveEditorLib.detectCodeLanguage'),
    'and an untagged one is detected, not skipped');
  assert.match(page, /language-(\(mermaid|.*mermaid)/,
    'diagram/math languages must be excluded from hljs');
});

test('a page without code blocks stays free of hljs', () => {
  const page = renderDocumentPage({ title: 't', markdown: '# just prose\n\nhello\n' });
  assert.ok(!page.includes('highlight.min.js'), 'no code, no highlighter');
  assert.ok(!page.includes('github.min.css'), 'no code, no palette');
});

test('an unlabeled code block brings the highlighter with it', () => {
  const page = renderDocumentPage({ title: 't', markdown: '```\nplain\n```\n' });
  assert.ok(page.includes('highlight.min.js'),
    'an untagged block can still be JSON, markup or a shell session');
  // …and the script is what decides it is none of those: three words of prose
  // score nothing, so they stay plain text on the page as in the editor.
});

test('hljs keeps token colours but the page keeps the block chrome', () => {
  // github.min.css paints .hljs with its own background + padding; the page
  // already draws the block (border, --soft background, copy button), so the
  // style sheet's chrome must be neutralized or code blocks get a second,
  // clashing box inside the first.
  const page = renderDocumentPage({ title: 't', markdown: JS_DOC });
  assert.match(page, /pre code\.hljs\s*\{[^}]*background:\s*(none|transparent)/);
});
