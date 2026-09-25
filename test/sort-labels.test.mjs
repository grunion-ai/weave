/* The words on a column's two sort rows (Issues #254, #318).

   "Sort ascending" meant A to Z on a name, smallest first on a number and
   oldest first on a date: three readings under one word. Kyle, 2026-09-09:
   "sort should just be by ascending descending. but also largest smallest
   most recent to oldest or alphabetical." So the stored direction stays
   `asc` / `desc` and only the wording follows the field's type; 2026-09-18
   added that a status and a single select order by their definition.

   fieldDialogCore.sortLabels is the one place the choice is made. This file
   walks every type the engine declares through it, and pins the system
   columns' names to the ones the engine will sort by. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_TYPES, SYSTEM_SORT_KEYS } from '../src/engine.js';

await import('../public/date-grain.js');
await import('../public/field-dialog-core.js');
const { sortLabels, SYSTEM_SORT } = globalThis.fieldDialogCore;

const DATE = { asc: 'Oldest to newest', desc: 'Newest to oldest' };
const NUMBER = { asc: 'Smallest to largest', desc: 'Largest to smallest' };
const TEXT = { asc: 'A to Z', desc: 'Z to A' };
const PLAIN = { asc: 'Ascending', desc: 'Descending' };

// One row per engine type: what the menu says for a plain field of it.
const EXPECTED = {
  text: TEXT, url: TEXT, email: TEXT, key: TEXT,
  number: NUMBER,
  date: DATE, daterange: DATE,
  select: { asc: 'Option order', desc: 'Reverse option order' },
  workflow: { asc: 'State order', desc: 'Reverse state order' },
  // No one reading of these: several values, a reference Kyle left open
  // ("for references its not clear"), a yes/no, a definition, a file list.
  multiselect: PLAIN, relation: PLAIN, checkbox: PLAIN, toggle: PLAIN,
  field: PLAIN, attachments: PLAIN, document: PLAIN, view: PLAIN,
  // Computed types say what they compute when the field tells us (below);
  // bare, they fall back.
  lookup: PLAIN, rollup: PLAIN, formula: PLAIN,
};

test('every type the engine declares has its two labels', () => {
  assert.deepEqual(Object.keys(EXPECTED).sort(), [...FIELD_TYPES].sort(), 'the table above covers the engine exactly');
  for (const type of FIELD_TYPES) {
    assert.deepEqual(sortLabels({ type }), EXPECTED[type], type);
  }
});

test('a label is a short noun phrase with no dash in it', () => {
  for (const type of FIELD_TYPES) {
    for (const label of Object.values(sortLabels({ type }))) {
      assert.ok(!/[—–]/.test(label), `${type}: ${label}`);
      assert.ok(label.split(' ').length <= 4, `${type}: ${label}`);
    }
  }
});

test('a computed field reads the way its result sorts', () => {
  // Every rollup but min, max and join yields a number (src/stats.js).
  for (const aggregate of ['count', 'sum', 'avg', 'median', 'stdev', 'distinct', 'filled', 'empty', 'range']) {
    assert.deepEqual(sortLabels({ type: 'rollup', aggregate }), NUMBER, aggregate);
  }
  assert.deepEqual(sortLabels({ type: 'rollup', aggregate: 'join' }), TEXT, 'join is the names, joined');
  assert.deepEqual(sortLabels({ type: 'rollup', aggregate: 'max' }, { targetType: 'number' }), NUMBER);
  // The max of dates is an ISO string that sorts as text; there is no
  // honest "newest" to promise, so it stays plain.
  assert.deepEqual(sortLabels({ type: 'rollup', aggregate: 'max' }, { targetType: 'date' }), PLAIN);
  assert.deepEqual(sortLabels({ type: 'lookup' }, { targetType: 'number' }), NUMBER);
  assert.deepEqual(sortLabels({ type: 'lookup' }, { targetType: 'text' }), TEXT);
  assert.deepEqual(sortLabels({ type: 'lookup' }, { targetType: 'select' }), TEXT, 'a looked-up option sorts by its name');
  // A formula wearing a number costume computes a number.
  assert.deepEqual(sortLabels({ type: 'formula', format: 'currency' }), NUMBER);
  assert.deepEqual(sortLabels({ type: 'formula', unit: 'kg' }), NUMBER);
  assert.deepEqual(sortLabels({ type: 'formula', expression: 'concat(Name)' }), PLAIN);
  // A number's costume changes nothing about its order.
  assert.deepEqual(sortLabels({ type: 'number', format: 'percent' }), NUMBER);
});

test('the system columns sort as what they hold, under the names the engine sorts by', () => {
  assert.deepEqual(Object.keys(SYSTEM_SORT).sort(), Object.keys(SYSTEM_SORT_KEYS).sort());
  for (const [name, { key }] of Object.entries(SYSTEM_SORT)) assert.equal(key, SYSTEM_SORT_KEYS[name], name);
  assert.deepEqual(sortLabels(SYSTEM_SORT['Created At']), DATE);
  assert.deepEqual(sortLabels(SYSTEM_SORT['Modified At']), DATE);
  assert.deepEqual(sortLabels(SYSTEM_SORT['Created By']), TEXT);
  assert.deepEqual(sortLabels(SYSTEM_SORT['Modified By']), TEXT);
  assert.deepEqual(sortLabels(SYSTEM_SORT['Public Id']), NUMBER);
  assert.equal(SYSTEM_SORT.Activity, undefined, 'Activity is a link to the history, not a value to order by');
});
