/* Collapsible headings in the IR surface (Issue #88).

   Folding a heading hides every block until the next heading of the same or
   a higher level. The affordance lives in an overlay gutter layer — never
   inside the contenteditable, whose DOM belongs to Lute's serializer — and
   the fold itself is a class on the hidden blocks (CSS display:none), which
   Lute ignores when it reads the DOM back, so the stored markdown never
   changes. Fold state persists per entity+field in localStorage, keyed by
   heading level+text, and the pass re-applies it after every re-render.

   The pure range math lives in public/editor-lib.js and is tested here;
   round-trip safety and persistence are covered by the browser suite. */
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

/* ---------- foldRange: what a fold hides ---------- */
// Blocks are levels: a number for a heading, null for anything else.

test('a fold reaches to the next heading of the same level', () => {
  //            h2    p     p     h2
  const blocks = [2, null, null, 2, null];
  assert.deepEqual(LIB.foldRange(blocks, 0), [1, 2]);
});

test('a deeper heading folds along, a higher one ends the fold', () => {
  //            h2    p    h3    p    h1
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

/* ---------- wiring contracts ---------- */

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
  // The caret shows on hover like the rest of the section chrome, but a
  // FOLDED caret must stay visible or the hidden content is unfindable.
  assert.match(CSS, /\.doc-fold\.folded\s*\{[^}]*opacity:\s*1/);
});

test('the rail ignores headings hidden inside a fold', () => {
  assert.match(APP, /offsetParent/, 'display:none headings must not join the rail');
});
