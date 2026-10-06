import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const detect = (text) => LIB.detectCodeLanguage(text);

test('formats that can be recognised for certain are', () => {
  assert.equal(detect('{ "a": 1, "b": [true, null] }'), 'json', 'JSON that parses is JSON');
  assert.equal(detect('[\n  1,\n  2\n]'), 'json');
  assert.equal(detect('<div class="x">hi</div>'), 'xml', 'markup that closes its tags');
  assert.equal(detect('<img src="a.png" />'), 'xml', 'or closes itself');
  assert.equal(detect('SELECT id FROM users WHERE active = true;'), 'sql');
  assert.equal(detect('insert into audit (id) values (1)'), 'sql', 'case is not the signal');
  assert.equal(detect('npm install weave --save'), 'bash');
  assert.equal(detect('$ git push origin main'), 'bash', 'a prompt is a shell session');
  assert.equal(detect('def add(a, b):\n    return a + b'), 'python');
  assert.equal(detect('from pathlib import Path'), 'python');
  assert.equal(detect('const x = 1;'), 'javascript', 'one declaration is still code');
  assert.equal(detect('function add(a, b) {\n  return a + b;\n}'), 'javascript');
  assert.equal(detect('.card { padding: 8px; color: red; }'), 'css');
  assert.equal(detect('name: weave\nversion: 0.4.2\nsteps:\n  - run: test'), 'yaml');
  assert.equal(detect('diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b'), 'diff');
});

test('everything else is plain text, on purpose', () => {
  for (const [what, text] of [
    ['prose', 'Just some prose about the meeting notes we took'],
    ['a short line', 'Nothing here but words'],
    ['a list of names', 'Kyle\nSajit\nRoshan\nMyriam'],
    ['a file path', '/Users/kyle/Documents/weave/public/app.js'],
    ['too little to judge', 'ok'],
    ['nothing at all', ''],
  ]) {
    assert.equal(detect(text), null, `${what} must not be coloured as code`);
  }
});

test('a diagram source is text, not a language and not a diagram', () => {
  for (const head of ['graph TD\n  A --> B', 'sequenceDiagram\n  A->>B: hi', 'gantt\n  title X', 'mindmap\n  root']) {
    assert.equal(detect(head), null, `${head.split('\n')[0]} must stay plain text`);
  }
});

test('css and javascript are told apart by their words, not their braces', () => {
  assert.equal(detect('@media (min-width: 600px) { .card { color: red; } }'), 'css');
  assert.equal(detect('const style = { color: "red" };\nreturn style;'), 'javascript');
});

test('the same text always gets the same answer', () => {
  const text = 'name: weave\nversion: 0.4.2';
  assert.equal(detect(text), detect(text));
  assert.equal(detect(text), 'yaml');
});
