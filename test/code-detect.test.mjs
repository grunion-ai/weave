/* What language an unlabelled fence is written in.

   Why this is a table of rules and not a call to hljs.highlightAuto():
   measured in a live browser against the vendored bundle, auto-detection is
   confidently wrong. Over a curated subset it read a JavaScript block as CSS
   (relevance 4) and a mermaid graph as CSS (3) — the same score real SQL got.
   Over its full language set it answered `ada` for that JavaScript, `ebnf` for
   `const x = 1;`, `livecodeserver` for Python and `solidity` (relevance 7) for
   a plain file path. Colour drawn from that is a lie about the writer's code,
   so weave claims a language only when the shape of the text says so, and
   shows everything else as the plain text a code block is for. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/editor-lib.js');
// Called as a method: the rules reach their sibling patterns through `this`.
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
  // A Code block shows what it holds. Rendering belongs to the Mermaid command
  // and its own ```mermaid fence — an unlabelled graph is source to read.
  for (const head of ['graph TD\n  A --> B', 'sequenceDiagram\n  A->>B: hi', 'gantt\n  title X', 'mindmap\n  root']) {
    assert.equal(detect(head), null, `${head.split('\n')[0]} must stay plain text`);
  }
});

test('css and javascript are told apart by their words, not their braces', () => {
  assert.equal(detect('@media (min-width: 600px) { .card { color: red; } }'), 'css');
  assert.equal(detect('const style = { color: "red" };\nreturn style;'), 'javascript');
});

test('the same text always gets the same answer', () => {
  // The objection auto-detection could not answer: a scorer can rank two
  // languages differently as a document grows, so a block changes colour
  // between visits. These rules are a function of the text alone.
  const text = 'name: weave\nversion: 0.4.2';
  assert.equal(detect(text), detect(text));
  assert.equal(detect(text), 'yaml');
});
