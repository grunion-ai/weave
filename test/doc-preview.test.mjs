/* A description previews as prose, not as markup (Kyle, 2026-08-27).

   "it should always show a preview of the properly formatted first few lines,
   not an md document chip." A chip said the field existed and what kind it
   was; it never said what it SAID. The preview does, and it does it in the
   reader's alphabet: a heading arrives as its text, a list as its items, bold
   as bold — never a hash, a dash or a pair of asterisks.

   inlineTokens is the one inline grammar and stays that way. docPreview is the
   block pass in front of it: it decides which lines are worth showing, and the
   caller dresses each line through inlineTokens. A document that is not prose
   at all — an HTML app, a slide model, a mermaid diagram — is NAMED rather
   than flattened, because a doctype makes a terrible summary. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;

test('a heading previews as its text, not its hashes', () => {
  const p = LIB.docPreview('# Title\n\nbody');
  assert.equal(p.lines[0], 'Title');
  assert.ok(!p.lines.join(' ').includes('#'));
});

test('list markers are stripped and blank lines are skipped', () => {
  assert.deepEqual(LIB.docPreview('- one\n\n- two').lines, ['one', 'two']);
  assert.deepEqual(LIB.docPreview('1. first\n2. second').lines, ['first', 'second']);
  assert.deepEqual(LIB.docPreview('> quoted').lines, ['quoted']);
});

test('inline marks survive as marks, not syntax', () => {
  // docPreview is the BLOCK pass and hands the inline level on untouched —
  // one inline grammar in the browser, and it is inlineTokens.
  const line = LIB.docPreview('## **bold** text').lines[0];
  assert.equal(line, '**bold** text', 'the heading went, the emphasis stayed for the tokenizer');
  const tokens = LIB.inlineTokens(line);
  assert.ok(tokens.some((t) => t.mark === 'strong' && t.text === 'bold'), 'the mark is a mark');
  assert.ok(!tokens.map((t) => t.text).join('').includes('*'), 'the asterisks never reach the reader');
});

test('table rows and horizontal rules are not preview material', () => {
  assert.deepEqual(LIB.docPreview('| a | b |\n| --- | --- |\n\n---\n\nreal text').lines, ['real text']);
});

test('a fenced code block does not leak its fence', () => {
  assert.deepEqual(LIB.docPreview('```js\nconst x = 1;\n```\nafter').lines, ['after']);
});

test('an HTML page is named, not flattened', () => {
  const p = LIB.docPreview('<!doctype html>\n<html><head><title>Pricing</title></head><body>hi</body></html>');
  assert.equal(p.kind, 'html');
  assert.deepEqual(p.lines, [], 'a doctype never becomes the row’s summary');
  assert.equal(p.label, 'Pricing');
  assert.equal(LIB.docPreview('<html><body>hi</body></html>').label, 'HTML page');
});

test('a JSON model is named, not flattened', () => {
  const p = LIB.docPreview('{"slides": [1, 2]}');
  assert.equal(p.kind, 'json');
  assert.deepEqual(p.lines, []);
  assert.match(p.label, /JSON model/);
});

test('a mermaid diagram is named, not flattened', () => {
  const p = LIB.docPreview('graph LR\n  A --> B');
  assert.equal(p.kind, 'mmd');
  assert.deepEqual(p.lines, []);
  assert.match(p.label, /diagram/i);
});

test('an empty document previews as nothing at all', () => {
  for (const empty of ['', '   \n ', null, undefined]) {
    const p = LIB.docPreview(empty);
    assert.equal(p.kind, null);
    assert.deepEqual(p.lines, []);
    assert.equal(p.label, '');
  }
});

test('the preview stops at the line budget', () => {
  const six = 'one\ntwo\nthree\nfour\nfive\nsix';
  assert.deepEqual(LIB.docPreview(six, { lines: 3 }).lines, ['one', 'two', 'three']);
  assert.deepEqual(LIB.docPreview(six, { lines: 1 }).lines, ['one']);
  assert.equal(LIB.docPreview(six).lines.length, 3, 'three lines is the default budget');
});

test('the kind is the one the chips already agreed on', () => {
  // docPreview classifies through docKind so a preview and a chip can never
  // disagree about what a document is.
  for (const src of ['# md', '{"a":1}', 'graph TD\n A-->B', '<!doctype html><html></html>']) {
    assert.equal(LIB.docPreview(src).kind, LIB.docKind(src));
  }
});
