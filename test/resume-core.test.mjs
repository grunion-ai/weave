import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/resume-core.js');
const { MARK, land, keep } = globalThis.WeaveResume;

test('resume: the resume mark lands on the last page this workspace had open (Issue #977)', () => {
  assert.equal(MARK, '#/resume');
  assert.equal(land(MARK, '#/table/t1/view/Board'), '#/table/t1/view/Board');
  assert.equal(land(MARK, '#/entity/e1'), '#/entity/e1');
});

test('resume: with nothing stored the mark lands on home (Issue #977)', () => {
  assert.equal(land(MARK, null), '#/');
  assert.equal(land(MARK, ''), '#/');
  assert.equal(land(MARK, MARK), '#/', 'the mark never stores itself');
});

test('resume: a deep link always wins over the stored page (Issue #977)', () => {
  assert.equal(land('#/entity/e9', '#/table/t1'), '#/entity/e9');
  assert.equal(land('', '#/table/t1'), '', 'a bare visit without the mark is left alone');
  assert.equal(keep('#/entity/e9'), true);
  assert.equal(keep(MARK), false);
  assert.equal(keep(''), false);
});
