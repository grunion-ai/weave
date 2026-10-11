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

test('a document cell is a named chip that says what kind it holds', () => {
  assert.match(APP, /function docChipCell\(/, 'one builder for the chip cell');
  const fn = APP.match(/function docChipCell\([^]*?\n\}/)[0];
  assert.match(fn, /docChipKind\(/, 'and the chip says what kind it is — the declared kind first');
  assert.ok(!/docPreview\(item\.docs/.test(APP), 'the flattened raw snippet of one document is still gone');
  assert.ok(!/\.slice\(0, 60\)/.test(APP), 'and so is the 60-character document slice it left behind');
});

test('the description keeps its first-lines preview; only it previews (Kyle, 2026-08-27)', () => {
  assert.doesNotMatch(APP, /name === 'Description'/, 'the description is found by role, never by the name Kyle can change');
  assert.match(APP, /role === 'description'[^]*?docPreviewCell|docPreviewCell[^]*?role === 'description'/,
    'the preview cell is the description role’s alone; every other document is a chip');
});

test('clicking a chip docks the entity, never a row expansion (Issue #74)', () => {
  assert.match(APP, /docChipCell\(f, item, \(\) => dockEntity\(db, id, \{ step: true \}\)\)/,
    'a doc chip docks its entity beside the table');
  assert.ok(!APP.includes('peekEntity'), 'the side peek is fully excised');
  assert.ok(!APP.includes('docsEditor('), 'the inline under-row editor is gone');
  assert.ok(!APP.includes("class: 'doc-row'"), 'no expansion row under the grid');
});

test('an empty document reads as empty rather than lying about a kind', () => {
  assert.match(CSS, /\.k-doc\.is-empty/);
  assert.doesNotMatch(APP, /doc-chip' \+ \(kind \? '' : ' empty'\)/,
    'the chip never wears the framework’s class name');
  assert.doesNotMatch(CSS, /\.doc-chip\.is-empty\s*\{[^}]*opacity/,
    'dimming an empty field reads as disabled, not as an invitation');
});
