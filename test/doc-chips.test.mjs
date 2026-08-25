/* Documents in a grid row are chips, not a snippet (Kyle, 2026-08-24).

   The Docs cell used to flatten the FIRST document field to 90 characters
   and print it, so a Task with Description, Spec and test showed a slice of
   one of them and no sign of the other two. A row now carries one chip per
   document field, named, with the kind of thing that document actually is —
   markdown, an HTML app, a JSON model, a mermaid diagram — and clicking a
   chip opens that document, not the first one. */
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

test('the Docs cell is chips, one per document field', () => {
  assert.match(APP, /function docChips\(/, 'one builder for the chips');
  const fn = APP.match(/function docChips\([^]*?\n\}/)[0];
  assert.match(fn, /documentFields\(/, 'every document field gets a chip, not just the first');
  assert.match(fn, /docKind\(/, 'and the chip says what kind it is');
  assert.ok(!/docPreview\(item\.docs/.test(APP), 'the flattened snippet of one document is gone');
});

test('clicking a chip opens the entity peek, never a row expansion (Issue #74)', () => {
  // Documents used to expand an editor UNDER the grid row, stretching the
  // table. Kyle (2026-08-25): they open in the side peek — the full entity
  // view with its ✕ in the upper right — and the row expansion is gone.
  assert.match(APP, /class: 'docs-cell' \}, docChips\(item, db, \(\) => peekEntity\(item\.id\)\)/,
    'a doc chip opens the side peek on its entity');
  assert.ok(!APP.includes('docsEditor('), 'the inline under-row editor is gone');
  assert.ok(!APP.includes("class: 'doc-row'"), 'no expansion row under the grid');
});

test('an empty document reads as empty rather than lying about a kind', () => {
  // Since the chip system (2026-08-25) the empty state is a dashed pointer,
  // not a dimmed one — .doc-chip carries geometry only, .k-doc.empty the look.
  assert.match(CSS, /\.k-doc\.empty/);
  assert.doesNotMatch(CSS, /\.doc-chip\.empty\s*\{[^}]*opacity/,
    'dimming an empty field reads as disabled, not as an invitation');
});
