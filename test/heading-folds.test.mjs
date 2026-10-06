import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');

test('a fold reaches to the next heading of the same level', () => {
  const blocks = [2, null, null, 2, null];
  assert.deepEqual(LIB.foldRange(blocks, 0), [1, 2]);
});

test('a deeper heading folds along, a higher one ends the fold', () => {
  const blocks = [2, null, 3, null, 1, null];
  assert.deepEqual(LIB.foldRange(blocks, 0), [1, 2, 3], 'h3 and its text fold with the h2');
});

test('the last section folds to the end of the document', () => {
  const blocks = [null, 2, null, null];
  assert.deepEqual(LIB.foldRange(blocks, 1), [2, 3]);
});

test('a heading with nothing under it folds nothing', () => {
  assert.deepEqual(LIB.foldRange([2, 2, null], 0), []);
  assert.deepEqual(LIB.foldRange([2], 0), []);
});

test('the fold affordance never enters the contenteditable', () => {
  assert.match(APP, /doc-fold-layer/, 'the carets live in an overlay layer');
  assert.ok(!/vditor-reset[^]{0,160}\.append\([^)]*fold/i.test(APP),
    'nothing fold-related is appended into the editing surface');
});

test('fold state persists per entity+field', () => {
  assert.match(APP, /weave-doc-folds:\$\{|weave-doc-folds:'/,
    'localStorage key carries entity and field');
});

test('hidden blocks are a class, not removed content', () => {
  assert.match(CSS, /\.wv-folded\s*\{[^}]*display:\s*none/);
  assert.match(APP, /wv-folded/, 'the pass toggles the class');
});

test('a folded heading stays discoverable', () => {
  assert.match(CSS, /\.doc-fold\.folded\s*\{[^}]*opacity:\s*1/);
});

test('the rail ignores headings hidden inside a fold', () => {
  assert.match(APP, /offsetParent/, 'display:none headings must not join the rail');
});
