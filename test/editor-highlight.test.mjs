import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderDocumentPage } from '../src/markdown.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');

function slashInsert(label) {
  const line = APP.split('\n').find((l) => l.includes(`label: '${label}'`));
  assert.ok(line, `the ${label} slash item must exist`);
  const insert = line.match(/insert:\s*'((?:[^'\\]|\\.)*)'/);
  assert.ok(insert, `the ${label} slash item must declare an insert`);
  return insert[1];
}

test('the slash Code block leaves the language to the content', () => {
  assert.equal(slashInsert('Code block'), '```\\ncode\\n```', 'no language is guessed at insert time');
  assert.match(APP, /detectCodeLanguage\(text\)/, 'something has to do the detecting');
});

test('one detector serves the editor and the page', () => {
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

const JS_DOC = '# t\n\n```js\nconst x = 1;\n```\n';

test('a page with language-tagged code carries the vendored hljs assets', () => {
  const page = renderDocumentPage({ title: 't', markdown: JS_DOC });
  assert.ok(page.includes('/vendor/vditor/dist/js/highlight.js/highlight.min.js'),
    'the page must load the same vendored highlight.js the editor uses');
  assert.match(page, /github\.min\.css"[^>]*media="\(prefers-color-scheme: light\)"/);
  assert.match(page, /github-dark\.min\.css"[^>]*media="\(prefers-color-scheme: dark\)"/);
});

test('the page highlights every code block, tagged or detected', () => {
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
});

test('hljs keeps token colours but the page keeps the block chrome', () => {
  const page = renderDocumentPage({ title: 't', markdown: JS_DOC });
  assert.match(page, /pre code\.hljs\s*\{[^}]*background:\s*(none|transparent)/);
});
