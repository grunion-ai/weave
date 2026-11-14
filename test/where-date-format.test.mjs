import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';

const COSTUMES = {
  plain: {},
  iso: { format: 'iso' },
  us: { format: 'us' },
  long: { format: 'long' },
  short: { format: 'short' },
  ordinal: { format: 'ordinal' },
  relative: { format: 'relative' },
  withTime: { time: true },
};

const DUE = { early: '2026-01-05', mid: '2026-03-20', late: '2026-11-10' };

function workspace(config) {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'Due', type: 'date', config });
  for (const [name, value] of Object.entries(DUE)) w.createEntity('T', { name, values: { Due: value } });
  w.createEntity('T', { name: 'blank', values: {} });
  return w;
}

const names = (w, where, db = 'T') => w.query(db, { where }).items.map((it) => it.name).sort();

for (const [label, config] of Object.entries(COSTUMES)) {
  test(`${label}: every comparison operator reads the stored date`, () => {
    const w = workspace(config);
    assert.deepEqual(names(w, [['Due', '<', '2026-11-10']]), ['early', 'mid']);
    assert.deepEqual(names(w, [['Due', '<=', '2026-11-10']]), ['early', 'late', 'mid']);
    assert.deepEqual(names(w, [['Due', '>', '2026-03-20']]), ['late']);
    assert.deepEqual(names(w, [['Due', '>=', '2026-03-20']]), ['late', 'mid']);
    assert.deepEqual(names(w, [['Due', '=', '2026-11-10']]), ['late']);
    assert.deepEqual(names(w, [['Due', '!=', '2026-11-10']]), ['blank', 'early', 'mid']);
    assert.deepEqual(names(w, [['Due', 'in', ['2026-01-05', '2026-11-10']]]), ['early', 'late']);
    assert.deepEqual(names(w, [['Due', 'is-empty']]), ['blank']);
    assert.deepEqual(names(w, [['Due', 'not-empty']]), ['early', 'late', 'mid']);
  });
}

test('the handbook example from src/handbook/fields/date.md answers its rows', () => {
  const w = workspace({});
  assert.deepEqual(names(w, [['Due', '<', '2026-10-01'], ['Due', 'not-empty']]), ['early', 'mid']);
});

test('a year-month grain compares on the stored month, not its reading', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'Month', type: 'date', config: { grain: ['year', 'month'] } });
  w.createEntity('T', { name: 'jan', values: { Month: '2026-01' } });
  w.createEntity('T', { name: 'nov', values: { Month: '2026-11' } });
  assert.deepEqual(names(w, [['Month', '<', '2026-11']]), ['jan']);
  assert.deepEqual(names(w, [['Month', '=', '2026-11']]), ['nov']);
  assert.deepEqual(names(w, [['Month', '>=', '2026-11']]), ['nov']);
});

test('a date with a time, and an instant, compare on the stored moment', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'At', type: 'date', config: { time: true } });
  w.addField('T', { name: 'Inst', type: 'date', config: { time: true, zone: 'instant' } });
  w.createEntity('T', { name: 'dawn', values: { At: '2026-01-05T06:00:00Z', Inst: '2026-01-05T06:00:00Z' } });
  w.createEntity('T', { name: 'dusk', values: { At: '2026-01-05T18:00:00Z', Inst: '2026-01-05T18:00:00Z' } });
  assert.deepEqual(names(w, [['At', '<', '2026-01-05T12:00:00Z']]), ['dawn']);
  assert.deepEqual(names(w, [['At', '>', '2026-01-05T12:00:00Z']]), ['dusk']);
  assert.deepEqual(names(w, [['Inst', '<', '2026-01-05T12:00:00Z']]), ['dawn']);
  assert.deepEqual(names(w, [['Inst', '>=', '2026-01-05T18:00Z']]), ['dusk']);
});

test('a clock-only field compares on the stored clock', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'Stamp', type: 'date', config: { grain: [], time: true } });
  w.createEntity('T', { name: 'dawn', values: { Stamp: '06:00' } });
  w.createEntity('T', { name: 'dusk', values: { Stamp: '18:00' } });
  assert.deepEqual(names(w, [['Stamp', '<', '12:00']]), ['dawn']);
  assert.deepEqual(names(w, [['Stamp', '=', '18:00']]), ['dusk']);
});

test('a daterange compares on its stored bounds', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'Window', type: 'daterange', config: {} });
  w.createEntity('T', { name: 'q1', values: { Window: { start: '2026-01-01', end: '2026-03-31' } } });
  w.createEntity('T', { name: 'q4', values: { Window: { start: '2026-10-01', end: '2026-12-31' } } });
  assert.deepEqual(names(w, [['Window', '<', '2026-06-01']]), ['q1']);
  assert.deepEqual(names(w, [['Window', '>', '2026-06-01']]), ['q4']);
});

test('a date across a relation compares on the stored date', () => {
  const w = workspace({});
  w.createTable({ space: 'S', name: 'Deal' });
  w.addRelation('Deal', { name: 'Item', targetDb: 'T' });
  w.createEntity('Deal', { name: 'd-early', values: { Item: 'early' } });
  w.createEntity('Deal', { name: 'd-late', values: { Item: 'late' } });
  assert.deepEqual(names(w, [['Item.Due', '<', '2026-06-01']], 'Deal'), ['d-early']);
  assert.deepEqual(names(w, [['Item.Due', '=', '2026-11-10']], 'Deal'), ['d-late']);
});

test('the read still paints the costume and contains still reads it', () => {
  const w = workspace({ format: 'long' });
  const late = w.query('T', { where: [['Name', '=', 'late']] }).items[0];
  assert.equal(late.fields.Due, 'Nov 10, 2026');
  assert.deepEqual(names(w, [['Due', 'contains', 'Nov 10']]), ['late']);
  assert.deepEqual(names(w, [['Due', 'contains', '2026']]), ['early', 'late', 'mid']);
});

test('sort by a date keeps its stored order', () => {
  const w = workspace({ format: 'long' });
  const up = w.query('T', { sort: [{ field: 'Due', dir: 'asc' }], where: [['Due', 'not-empty']] }).items.map((it) => it.name);
  assert.deepEqual(up, ['early', 'mid', 'late']);
});

test('weave_query and weave_stats answer the same rows as the engine', () => {
  const w = workspace({});
  const q = dispatchTool(w, 'weave_query', { db: 'T', where: [['Due', '<', '2026-10-01'], ['Due', 'not-empty']], select: ['Due'] });
  assert.equal(q.total, 2);
  const s = dispatchTool(w, 'weave_stats', { table: 'T', where: [['Due', '<', '2026-10-01']] });
  assert.equal(s.rows, 2);
});
