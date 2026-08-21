import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

/* Feature #97 — number units & formatting, Fibery-style. A number field's
   config can say how it reads: format (number | currency | percent), a free
   unit rendered beside the value, decimals, and a thousands separator. The
   stored value stays a plain number — formatting is display-only and never
   round-trips into storage or formulas. */

function fresh(config) {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Deal' });
  w.addField('Deal', { name: 'Amount', type: 'number', config });
  return w;
}

const shown = (w, value) => {
  const e = w.createEntity('Deal', { name: 'X', values: { Amount: value } });
  return w.readEntity(e.id).fields.Amount;
};

test('a plain number stays plain', () => {
  assert.equal(shown(fresh(), 1200.5), 1200.5);
});

test('unit, decimals and separator compose', () => {
  const w = fresh({ unit: 'days', decimals: 0 });
  assert.equal(shown(w, 30), '30 days');
  const w2 = fresh({ decimals: 2, separator: true });
  assert.equal(shown(w2, 1234567.891), '1,234,567.89');
});

test('currency puts the unit in front; percent needs no unit at all', () => {
  const w = fresh({ format: 'currency', unit: '$', decimals: 2, separator: true });
  assert.equal(shown(w, 1200), '$1,200.00');
  const w2 = fresh({ format: 'percent', decimals: 1 });
  assert.equal(shown(w2, 12.345), '12.3%');
});

test('the stored value is untouched by its costume', () => {
  const w = fresh({ format: 'currency', unit: '$', decimals: 2 });
  const e = w.createEntity('Deal', { name: 'X', values: { Amount: 1200.5 } });
  const f = Object.values(w.getTable('Deal').fields).find((x) => x.name === 'Amount');
  assert.equal(w.getEntity(e.id).values[f.id], 1200.5, 'raw number in storage');
  w.addField('Deal', { name: 'Doubled', type: 'formula', config: { expression: 'Amount * 2' } });
  assert.equal(w.readEntity(e.id).fields.Doubled, 2401, 'formulas see the number, not the string');
});

test('config is validated and travels through describeSchema', () => {
  const w = fresh({ format: 'currency', unit: '€', decimals: 2, separator: true });
  const f = w.describeSchema().find((sp) => sp.space === 'Dev').tables[0].fields.find((x) => x.name === 'Amount');
  assert.equal(f.format, 'currency');
  assert.equal(f.unit, '€');
  assert.equal(f.decimals, 2);
  assert.equal(f.separator, true);
  assert.throws(() => w.addField('Deal', { name: 'Bad', type: 'number', config: { format: 'roman' } }), /format/i);
  assert.throws(() => w.addField('Deal', { name: 'Bad2', type: 'number', config: { decimals: 12 } }), /decimals/i);
});

test('updateField edits the costume without touching width or default', () => {
  const w = fresh({ unit: 'kg' });
  w.updateField('Deal', 'Amount', { config: { width: 120 } });
  w.updateField('Deal', 'Amount', { config: { unit: 'lbs', decimals: 1 } });
  const f = Object.values(w.getTable('Deal').fields).find((x) => x.name === 'Amount');
  assert.equal(f.config.width, 120, 'width survived the unit edit');
  assert.equal(f.config.unit, 'lbs');
  assert.equal(f.config.decimals, 1);
});

/* Feature #44 — the date system's engine half: a display costume for date
   fields (format + optional time) and date math in formulas. Values store as
   ISO strings; the costume is display-only, exactly like numbers (#97). */
test('date fields wear a format costume', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Due', type: 'date', config: { format: 'long' } });
  w.addField('Task', { name: 'DueUS', type: 'date', config: { format: 'us' } });
  w.addField('Task', { name: 'DueEU', type: 'date', config: { format: 'eu' } });
  const e = w.createEntity('Task', { name: 'T', values: { Due: '2026-08-21', DueUS: '2026-08-21', DueEU: '2026-08-21' } });
  const read = w.readEntity(e.id);
  assert.equal(read.fields.Due, 'Aug 21, 2026');
  assert.equal(read.fields.DueUS, '8/21/2026');
  assert.equal(read.fields.DueEU, '21.8.2026');
  assert.equal(w.getEntity(e.id).values[Object.values(w.getTable('Task').fields).find((f) => f.name === 'Due').id], '2026-08-21', 'ISO in storage');
  assert.throws(() => w.addField('Task', { name: 'Bad', type: 'date', config: { format: 'stardate' } }), /format/i);
});

test('a datetime keeps its time and shows it', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'At', type: 'date', config: { time: true, format: 'long' } });
  const e = w.createEntity('Task', { name: 'T', values: { At: '2026-08-21T14:30' } });
  assert.match(String(w.readEntity(e.id).fields.At), /Aug 21, 2026.*14:30/);
});

test('formulas do date math', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Due', type: 'date' });
  w.addField('Task', { name: 'Grace', type: 'formula', config: { expression: 'dateadd(Due, 14, "days")' } });
  w.addField('Task', { name: 'Age', type: 'formula', config: { expression: 'datediff(Due, "2026-09-04", "days")' } });
  w.addField('Task', { name: 'Y', type: 'formula', config: { expression: 'year(Due)' } });
  const e = w.createEntity('Task', { name: 'T', values: { Due: '2026-08-21' } });
  const read = w.readEntity(e.id);
  assert.equal(read.fields.Grace, '2026-09-04');
  assert.equal(read.fields.Age, 14);
  assert.equal(read.fields.Y, 2026);
});
