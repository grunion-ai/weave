/* A text cell holding markdown must not read as markdown.

   Space and table descriptions are `text` fields whose values are written in
   markdown — the description box on the space page is a markdown editor. In
   the registry grids those same values were painted into an <input>, so the
   Spaces grid read `**Official documentation and how-tos** — the pages`.

   The fix follows the formatted-number pattern (Issue #97): the cell wears
   its costume at rest and hands over the raw text the moment it is clicked.
   inlineTokens() is the pure half — the marks, in order, with no syntax left
   in the text. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');

const plain = (md) => LIB.inlineTokens(md).map((t) => t.text).join('');

/* ---------- the marks ---------- */

test('plain text is one unmarked token', () => {
  assert.deepEqual(LIB.inlineTokens('just words'), [{ text: 'just words', mark: null }]);
  assert.deepEqual(LIB.inlineTokens(''), []);
  assert.deepEqual(LIB.inlineTokens(null), []);
});

test('bold, italic, code and strike lose their syntax and keep their meaning', () => {
  assert.deepEqual(LIB.inlineTokens('a **b** c'), [
    { text: 'a ', mark: null }, { text: 'b', mark: 'strong' }, { text: ' c', mark: null },
  ]);
  assert.deepEqual(LIB.inlineTokens('*em* and _also_'), [
    { text: 'em', mark: 'em' }, { text: ' and ', mark: null }, { text: 'also', mark: 'em' },
  ]);
  assert.deepEqual(LIB.inlineTokens('run `node --test`'), [
    { text: 'run ', mark: null }, { text: 'node --test', mark: 'code' },
  ]);
  assert.deepEqual(LIB.inlineTokens('~~gone~~'), [{ text: 'gone', mark: 'strike' }]);
});

test('links and references show their words, never their targets', () => {
  assert.deepEqual(LIB.inlineTokens('see [the guide](/w/weave/e/1)'), [
    { text: 'see ', mark: null }, { text: 'the guide', mark: 'link' },
  ]);
  assert.deepEqual(LIB.inlineTokens('see [[Guide#2|the guide]]'), [
    { text: 'see ', mark: null }, { text: 'the guide', mark: 'ref' },
  ]);
  assert.deepEqual(LIB.inlineTokens('[[Guide#2]]'), [{ text: 'Guide#2', mark: 'ref' }]);
});

test('the whole description in the Spaces grid comes out as prose', () => {
  const md = '**Official documentation and how-tos** — the pages that teach `weave`';
  assert.equal(plain(md), 'Official documentation and how-tos — the pages that teach weave');
  assert.ok(!plain(md).includes('*'), 'no leftover markers');
  assert.ok(!plain(md).includes('`'));
});

test('lone punctuation is text, not an unclosed mark', () => {
  assert.equal(plain('2 * 3 * 4'), '2 * 3 * 4');
  assert.equal(plain('snake_case_name'), 'snake_case_name');
  assert.equal(plain('a ** b'), 'a ** b');
});

/* ---------- wiring ---------- */

test('a markdown text cell wears the rendered costume until it is clicked', () => {
  assert.match(APP, /function dressedText\(/, 'the costume is built from the tokens');
  assert.match(APP, /inlineTokens\(/, 'app.js reads the pure tokenizer');
  const fn = APP.match(/function dressedText\([^]*?\n\}/)[0];
  assert.match(fn, /replaceWith\(input\)/, 'clicking hands over the raw text');
  assert.match(fn, /stopPropagation/, 'and does not open the row instead');
});
