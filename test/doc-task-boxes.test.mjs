import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/editor-lib.js');

const norm = (md) => globalThis.WeaveEditorLib.normalizeTaskBoxes(md);

test('the editor\'s two spaces after a task box collapse to one', () => {
  assert.equal(norm('- [ ]  Draft the quickstart'), '- [ ] Draft the quickstart');
  assert.equal(norm('* [ ]  Draft'), '* [ ] Draft');
  assert.equal(norm('+ [ ]  Draft'), '+ [ ] Draft');
  assert.equal(norm('1. [ ]  Draft'), '1. [ ] Draft');
  assert.equal(norm('1) [ ]  Draft'), '1) [ ] Draft');
  assert.equal(norm('  - [ ]  Nested'), '  - [ ] Nested');
});

test('an upper-case box becomes the lower-case x the Handbook promises', () => {
  assert.equal(norm('- [X]  Pick the sample app'), '- [x] Pick the sample app');
  assert.equal(norm('- [X] Pick the sample app'), '- [x] Pick the sample app');
  assert.equal(norm('- [x] Pick the sample app'), '- [x] Pick the sample app');
});

test('a task list already in the stored shape comes back byte for byte', () => {
  const md = 'Launch checklist\n\n- [ ] Draft the quickstart\n- [x] Pick the sample app\n';
  assert.equal(norm(md), md);
  assert.equal(norm(norm(md)), norm(md));
});

test('the whole repro from Issue #555 round-trips to the stored shape', () => {
  assert.equal(
    norm('Launch checklist for v1\n\n- [ ]  Draft the quickstart\n- [X]  Pick the sample app\n'),
    'Launch checklist for v1\n\n- [ ] Draft the quickstart\n- [x] Pick the sample app\n');
});

test('a fenced block keeps its text exactly', () => {
  const md = 'before\n\n```md\n- [ ]  kept\n- [X]  kept\n```\n\n- [X]  fixed\n';
  assert.equal(norm(md), 'before\n\n```md\n- [ ]  kept\n- [X]  kept\n```\n\n- [x] fixed\n');
  const tilde = '~~~\n- [X]  kept\n~~~\n';
  assert.equal(norm(tilde), tilde);
});

test('lines that are not task items are left alone', () => {
  for (const md of [
    '- bullet',
    'a [X] in a sentence',
    '- [ ] ',
    '[ ]  not a list item',
    '- [y]  not a box',
    '',
  ]) assert.equal(norm(md), md, JSON.stringify(md));
});

test('non-strings answer the empty string rather than throwing', () => {
  assert.equal(norm(null), '');
  assert.equal(norm(undefined), '');
});
