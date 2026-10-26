import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/list-core.js';
import '../public/board-core.js';

const Board = globalThis.weaveBoardCore;
const List = globalThis.weaveListCore;
const SEP = List.SEP;

const STATES = ['Research', 'Ready to Buy', 'Bought'].map((n) => ({ key: n, label: n, value: n }));
const ROOMS = ['Office', 'Bedroom', 'Kitchen'].map((n) => ({ key: n, label: n, value: n }));
const row = (id, state, room) => ({ id, keys: [[{ key: state, label: state, value: state }], room ? [{ key: room, label: room, value: room }] : []], parent: null, done: false });
const rows = [row('desk', 'Ready to Buy', 'Office'), row('chair', 'Ready to Buy', 'Office'), row('bed', 'Research', 'Bedroom'), row('rug', 'Bought', null)];
const levels = [{ domain: STATES, nullLabel: 'No State' }, { domain: ROOMS, nullLabel: 'No Room' }];

test('laneGrid turns two group levels into columns and lanes, a cell for every pair', () => {
  const grid = Board.laneGrid(List.arrange(rows, { levels, showEmpty: true }).groups, levels[1]);
  assert.deepEqual(grid.columns.map((c) => c.label), ['Research', 'Ready to Buy', 'Bought']);
  assert.deepEqual(grid.lanes.map((l) => l.label), ['Office', 'Bedroom', 'Kitchen', 'No Room'], 'domain order, the empty bucket last');
  const office = grid.lanes[0];
  assert.equal(office.count, 2);
  assert.deepEqual(office.cells.map((c) => c.key), ['Research', 'Ready to Buy', 'Bought'].map((s) => `${s}${SEP}Office`));
  assert.deepEqual(office.cells[1].items.map((i) => i.row.id), ['desk', 'chair']);
  assert.deepEqual(office.cells[2].path.map((p) => p.label), ['Bought', 'Office'], 'an empty cell still carries the path a drop writes');
  assert.deepEqual(office.cells[2].items, []);
  assert.equal(grid.lanes[2].count, 0, 'Kitchen shows empty because empty groups show');
});

test('laneGrid keeps only the lanes that hold a card when empty groups are off', () => {
  const grid = Board.laneGrid(List.arrange(rows, { levels, showEmpty: false }).groups, levels[1]);
  assert.deepEqual(grid.columns.map((c) => c.label), ['Research', 'Ready to Buy', 'Bought']);
  assert.deepEqual(grid.lanes.map((l) => l.label), ['Office', 'Bedroom', 'No Room'], 'Kitchen holds no card and goes');
  assert.equal(grid.lanes.find((l) => l.label === 'Office').cells.length, 3, 'a lane still spans every column');
});

test('laneShut and laneFold read and write the existing collapsed group paths', () => {
  const grid = Board.laneGrid(List.arrange(rows, { levels, showEmpty: true }).groups, levels[1]);
  const office = grid.lanes[0];
  assert.equal(Board.laneShut(undefined, office), false);
  const shut = Board.laneFold(undefined, office);
  assert.deepEqual(shut, [List.COMPLETED, ...office.cells.map((c) => c.key)], 'every cell of the lane is collapsed, Completed keeps its default');
  assert.equal(Board.laneShut(shut, office), true);
  assert.equal(Board.laneShut([office.cells[0].key], office), false, 'one folded cell does not fold the lane');
  assert.deepEqual(Board.laneFold(shut, office), [List.COMPLETED]);
  assert.deepEqual(Board.laneFold([office.cells[0].key], office).sort(), office.cells.map((c) => c.key).sort(), 'a half-folded lane folds the rest');
});

test('laneGrid honours a reversed lane level, with No value still last', () => {
  const lane = { ...levels[1], dir: 'desc' };
  const grid = Board.laneGrid(List.arrange(rows, { levels: [levels[0], lane], showEmpty: true }).groups, lane);
  assert.deepEqual(grid.lanes.map((l) => l.label), ['Kitchen', 'Bedroom', 'Office', 'No Room']);
  const forward = Board.laneGrid(List.arrange(rows, { levels, showEmpty: true }).groups, levels[1]);
  assert.deepEqual(forward.lanes.map((l) => l.label), ['Office', 'Bedroom', 'Kitchen', 'No Room']);
});
