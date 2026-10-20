import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/board-core.js';

const Board = globalThis.weaveBoardCore;

test('a board compares two to four picked cards', () => {
  assert.equal(Board.PICK_MIN, 2);
  assert.equal(Board.PICK_CAP, 4);
});

test('togglePick adds and removes in pick order, and refuses a fifth card', () => {
  let got = Board.togglePick([], 'a');
  assert.deepEqual(got, { ids: ['a'], refused: false });
  got = Board.togglePick(['a', 'b', 'c'], 'd');
  assert.deepEqual(got, { ids: ['a', 'b', 'c', 'd'], refused: false });
  assert.deepEqual(Board.togglePick(['a', 'b', 'c', 'd'], 'e'), { ids: ['a', 'b', 'c', 'd'], refused: true }, 'a fifth pick leaves the four');
  assert.deepEqual(Board.togglePick(['a', 'b', 'c', 'd'], 'b'), { ids: ['a', 'c', 'd'], refused: false }, 'a full set still lets one go');
});

test('compareRows marks a row that differs across the picked cards', () => {
  const fields = [{ name: 'State' }, { name: 'Best Price' }, { name: 'Tags' }, { name: 'Note' }];
  const items = [
    { raw: { State: 'Ready to Buy', 'Best Price': 449, Tags: ['desk', 'office'], Note: '' } },
    { raw: { State: 'Ready to Buy', 'Best Price': 939, Tags: ['office', 'desk'] } },
    { raw: { State: 'Ready to Buy', 'Best Price': 449, Tags: ['desk', 'office'], Note: null } },
  ];
  assert.deepEqual(Board.compareRows(fields, items).map((r) => [r.field.name, r.differs]), [
    ['State', false], ['Best Price', true], ['Tags', false], ['Note', false],
  ], 'a set reads the same in any order, and empty, null and missing agree');
});

test('compareRows compares relation chips by the row they name', () => {
  const fields = [{ name: 'Vendor' }];
  const one = [{ raw: { Vendor: [{ id: 'v1', name: 'IKEA' }] } }, { raw: { Vendor: [{ id: 'v1', name: 'IKEA' }] } }];
  const two = [{ raw: { Vendor: [{ id: 'v1', name: 'IKEA' }] } }, { raw: { Vendor: [{ id: 'v2', name: 'Fully' }] } }];
  assert.equal(Board.compareRows(fields, one)[0].differs, false);
  assert.equal(Board.compareRows(fields, two)[0].differs, true);
});
