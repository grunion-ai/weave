import test from 'node:test';
import assert from 'node:assert/strict';
import { APP } from './lib/source.mjs';

await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;

test('a declared kind rules the viewer, whatever the content says', () => {
  assert.equal(LIB.docViewMode('html', '# not html at all'), 'app');
  assert.equal(LIB.docViewMode('html', ''), 'app');
  assert.equal(LIB.docViewMode('code', 'SELECT 1;'), 'code');
  assert.equal(LIB.docViewMode('code', '<!doctype html><html></html>'), 'code',
    'code means code — an HTML file in a code field is source to read, not an app to run');
});

test('no declared kind falls back to the sniff every existing field relies on', () => {
  assert.equal(LIB.docViewMode(undefined, '<!doctype html>\n<html><body>hi</body></html>'), 'app');
  assert.equal(LIB.docViewMode(undefined, '<html lang="en"><body>hi</body></html>'), 'app');
  assert.equal(LIB.docViewMode(undefined, '# Title\n\nwords'), 'markdown');
  assert.equal(LIB.docViewMode(undefined, ''), 'markdown', 'an empty undeclared field invites markdown');
  assert.equal(LIB.docViewMode('markdown', '<!doctype html><html></html>'), 'app',
    'markdown is the unmarked default — the engine never stores it, so it cannot outvote the sniff');
});

test('a sniffed diagram or model gets a viewer of its own (Issues #188, #189)', () => {
  assert.equal(LIB.docViewMode(undefined, 'graph LR\n A-->B'), 'diagram', 'mermaid source draws as a diagram');
  assert.equal(LIB.docViewMode(undefined, 'flowchart TD\n F[a] --> D{b}'), 'diagram');
  assert.equal(LIB.docViewMode(undefined, '{"slides": []}'), 'code', 'a JSON model edits in the code box');
  assert.equal(LIB.docViewMode('code', 'graph LR\n A-->B'), 'code', 'a declared code field still rules');
  assert.equal(LIB.docViewMode('html', 'graph LR\n A-->B'), 'app', 'so does a declared html field');
});

test('the diagram sniff wants a diagram header, not a word that opens prose', () => {
  assert.equal(LIB.docKind('graph theory, a primer\n\nwords'), 'md');
  assert.equal(LIB.docKind('pie is a dessert'), 'md');
  assert.equal(LIB.docKind('timeline of the project'), 'md');
  assert.equal(LIB.docKind('graph LR\n A-->B'), 'mmd');
  assert.equal(LIB.docKind('pie title Pets\n "Dogs": 3'), 'mmd');
  assert.equal(LIB.docKind('stateDiagram-v2\n [*] --> A'), 'mmd');
});

test('the document section mounts a diagram viewer for the diagram mode', () => {
  const from = APP.indexOf('const mode = globalThis.WeaveEditorLib.docViewMode(');
  const section = APP.slice(from, APP.indexOf('/* Comments panel */', from));
  assert.match(section, /mode === 'diagram'/, 'the section knows the mode');
  assert.match(section, /renderMermaidIn\(/, 'and draws it with the one mermaid renderer');
  assert.match(section, /class: 'doc-diagram'/, 'inside its own box');
});

test('the chip wears the declared kind; sniffing is for the undeclared', () => {
  assert.equal(LIB.docChipKind('html', 'anything at all'), 'html');
  assert.equal(LIB.docChipKind('code', 'def f(): pass'), 'code');
  assert.equal(LIB.docChipKind(undefined, '{"slides": []}'), 'json');
  assert.equal(LIB.docChipKind(undefined, 'graph LR\n A-->B'), 'mmd');
  assert.equal(LIB.docChipKind(undefined, 'plain words'), 'md');
});

test('an empty document has no kind to claim, declared or not', () => {
  assert.equal(LIB.docChipKind('html', ''), null);
  assert.equal(LIB.docChipKind('code', '   \n'), null);
  assert.equal(LIB.docChipKind(undefined, null), null);
});

test('every document field is a column; the shared Docs cell is gone', () => {
  const cols = APP.match(/function visibleCols\([^]*?\n\}/)[0];
  assert.doesNotMatch(cols, /type !== 'document'/,
    'the column list stopped filtering documents down to the description');
  assert.ok(!APP.includes('Docs ('), 'no grouped Docs header survives');
  assert.ok(!APP.includes('function docChips('), 'the multi-chip builder is gone with the cell it filled');
  assert.ok(!APP.includes('chipDocumentFields'), 'nothing decides which documents are "chips" any more');
});

test('a non-description document cell is the named chip with its kind badge', () => {
  assert.match(APP, /function docChipCell\(/, 'one builder for the chip cell');
  const fn = APP.match(/function docChipCell\([^]*?\n\}/)[0];
  assert.match(fn, /docChipKind\(/, 'the badge honours the declared kind before the sniff');
  assert.match(fn, /is-empty/, 'an empty document reads as empty rather than lying about a kind');
});

test('document fields hide behind the eye like any field', () => {
  assert.doesNotMatch(APP, /db\.fields\.filter\(\(f\) => f\.type !== 'document'\)\.map\(\(f\) => row\(/,
    'the visibility popover stopped excluding documents');
});

test('the document section asks docViewMode, not a local sniff', () => {
  assert.match(APP, /docViewMode\(f\.kind/, 'the section routes on the field’s declared kind');
  assert.ok(!APP.includes('function isHtmlDocument('),
    'the client’s own HTML sniff is gone — docKind in editor-lib is the one classifier');
});

test('a code document mounts its code box directly — no frame, no toggle', () => {
  const body = APP.match(/const docSection = \([^]*?\n {2}\};/)[0];
  assert.match(body, /mode === 'code'/, 'code is a first-class mode of the section');
  assert.match(body, /doc-source/, 'and it edits in the same monospace box HTML source uses');
});

