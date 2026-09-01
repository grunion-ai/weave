/* Documents in a grid row are chips, not a snippet (Kyle, 2026-08-24).

   The Docs cell used to flatten the FIRST document field to 90 characters
   and print it, so a Task with Description, Spec and test showed a slice of
   one of them and no sign of the other two. A row now carries one chip per
   document field, named, with the kind of thing that document actually is —
   markdown, an HTML app, a JSON model, a mermaid diagram — and clicking a
   chip opens that document, not the first one.

   Narrowed 2026-08-27, and the narrowing keeps the ruling rather than undoing
   it. Kyle: a description "should always show a preview of the properly
   formatted first few lines, not an md document chip." What he rejected in
   August was a raw slice of ONE document standing in for all of them; what he
   wants now is the description saying what it says. So the description leaves
   the Docs cell for a column of its own — one dressed line, the rest on hover
   — and Spec, Model and test keep exactly the chips this file was written to
   defend. Both rulings hold at once, and neither cell has to compromise.

   Widened 2026-08-31: the shared Docs cell itself retired. Every document
   field is now a COLUMN of its own, and its cell is the same named chip with
   its kind badge — the chips survive, the grouping does not. The column era's
   own gates live in test/doc-columns.test.mjs; this file keeps the rulings
   that still hold: the chip form, the peek, the flattened-slice ban, the
   honest empty state. */
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

/* ---------- what kind of document this is ---------- */

test('an empty document has no kind to claim', () => {
  assert.equal(LIB.docKind(''), null);
  assert.equal(LIB.docKind('   \n '), null);
  assert.equal(LIB.docKind(null), null);
});

test('prose is markdown', () => {
  assert.equal(LIB.docKind('# Title\n\nsome words'), 'md');
  assert.equal(LIB.docKind('just words'), 'md');
});

test('a complete HTML file is an app, the way the editor already reads it', () => {
  assert.equal(LIB.docKind('<!doctype html>\n<html><body>hi</body></html>'), 'html');
  assert.equal(LIB.docKind('<html lang="en"><body>hi</body></html>'), 'html');
  assert.equal(LIB.docKind('an <html> tag mid-sentence'), 'md', 'only when the file IS one');
});

test('a model is json, a diagram is mermaid', () => {
  assert.equal(LIB.docKind('{"slides": []}'), 'json');
  assert.equal(LIB.docKind('[1, 2]'), 'json');
  assert.equal(LIB.docKind('{ not really json'), 'md');
  assert.equal(LIB.docKind('graph LR\n  A --> B'), 'mmd');
  assert.equal(LIB.docKind('flowchart TD\n  A --> B'), 'mmd');
});

/* ---------- the cell ---------- */

test('a document cell is a named chip that says what kind it holds', () => {
  assert.match(APP, /function docChipCell\(/, 'one builder for the chip cell');
  const fn = APP.match(/function docChipCell\([^]*?\n\}/)[0];
  assert.match(fn, /docChipKind\(/, 'and the chip says what kind it is — the declared kind first');
  // The ban survives both narrowings: what Kyle rejected was a FLATTENED raw
  // slice of one document standing in for the row. The description's preview
  // is a block-stripped, mark-dressed read of a named, role-marked field, and
  // it must not be spelled like the thing that was thrown out — satisfying the
  // letter of this gate by renaming the old helper would be gaming it.
  assert.ok(!/docPreview\(item\.docs/.test(APP), 'the flattened raw snippet of one document is still gone');
  assert.ok(!/\.slice\(0, 60\)/.test(APP), 'and so is the 60-character document slice it left behind');
});

test('the description keeps its first-lines preview; only it previews (Kyle, 2026-08-27)', () => {
  assert.match(APP, /function descriptionFieldOf\(/, 'the description is found by role, never by the name Kyle can change');
  assert.match(APP, /role === 'description'[^]*?docPreviewCell|docPreviewCell[^]*?role === 'description'/,
    'the preview cell is the description role’s alone; every other document is a chip');
});

test('clicking a chip opens the entity peek, never a row expansion (Issue #74)', () => {
  // Documents used to expand an editor UNDER the grid row, stretching the
  // table. Kyle (2026-08-25): they open in the side peek — the full entity
  // view with its ✕ in the upper right — and the row expansion is gone.
  assert.match(APP, /docChipCell\(f, item, \(\) => peekEntity\(id\)\)/,
    'a doc chip opens the side peek on its entity');
  assert.ok(!APP.includes('docsEditor('), 'the inline under-row editor is gone');
  assert.ok(!APP.includes("class: 'doc-row'"), 'no expansion row under the grid');
});

test('an empty document reads as empty rather than lying about a kind', () => {
  // Since the chip system (2026-08-25) the empty state is a dashed pointer,
  // not a dimmed one — .doc-chip carries geometry only, .k-doc.is-empty the
  // look. The modifier is `is-empty` because Tabler ships a global `.empty`
  // (flex column, height 100%, 1rem pad) and the chip inherited it, which
  // took a comfortable row from 43px to 85 (Kyle, 2026-08-26).
  assert.match(CSS, /\.k-doc\.is-empty/);
  assert.doesNotMatch(APP, /doc-chip' \+ \(kind \? '' : ' empty'\)/,
    'the chip never wears the framework’s class name');
  assert.doesNotMatch(CSS, /\.doc-chip\.is-empty\s*\{[^}]*opacity/,
    'dimming an empty field reads as disabled, not as an invitation');
});
