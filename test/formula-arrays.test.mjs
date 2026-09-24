/* Feature #232 — formula arrays and the sparkline display. A formula is
   row-local, and a list comes in through a lookup over a to-many relation.
   `sortby(values, keys)` orders a series by a parallel list (deal amounts by
   close date); that only holds if two lookups over the same relation keep
   their blank slots in position, so that is proven first. A formula may
   return a list or null; the API returns the numbers. The formula's display
   costume gains `sparkline` with a `style` (line, column, winloss), and a
   sort or a filter on a sparkline column reads its last value. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { evaluate, check } from '../src/formula.js';

function crm() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const acct = w.createTable({ space: 'Sales', name: 'Account' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  w.addField(deal, { name: 'Amount', type: 'number' });
  w.addField(deal, { name: 'Close', type: 'date' });
  w.addRelation(deal, { name: 'Account', targetDb: acct, cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addField(acct, { name: 'Deal amounts', type: 'lookup', config: { relationField: 'Deals', targetField: 'Amount' } });
  w.addField(acct, { name: 'Deal close dates', type: 'lookup', config: { relationField: 'Deals', targetField: 'Close' } });
  return { w, acct, deal };
}

test('two lookups over the same relation keep blank slots in position, so they stay aligned', () => {
  const { w, acct, deal } = crm();
  const a = w.createEntity(acct, { name: 'Acme' });
  w.createEntity(deal, { name: 'd1', values: { Amount: 300, Close: '2026-03-01', Account: a.id } });
  w.createEntity(deal, { name: 'd2', values: { Amount: null, Close: '2026-01-01', Account: a.id } });
  w.createEntity(deal, { name: 'd3', values: { Amount: 100, Close: null, Account: a.id } });
  const d4 = w.createEntity(deal, { name: 'd4', values: { Amount: 200, Close: '2026-02-01', Account: a.id } });
  const raw = w.readEntity(a.id).raw;
  assert.deepEqual(raw['Deal amounts'], [300, null, 100, 200], 'a blank amount holds its slot');
  assert.deepEqual(raw['Deal close dates'], ['2026-03-01', '2026-01-01', null, '2026-02-01'], 'a blank date holds its slot');
  // A trashed row leaves both lists together, not one.
  w.deleteEntity(d4.id);
  const after = w.readEntity(a.id).raw;
  assert.equal(after['Deal amounts'].length, after['Deal close dates'].length);
  assert.deepEqual(after['Deal amounts'], [300, null, 100]);
});

test('sortby orders a series by its keys: stable, blank keys last, blank values kept', () => {
  const get = (n) => ({ V: [30, 10, null, 20], K: ['2026-03', '2026-01', '2026-02', null], N: [3, 1, 2] }[n]);
  assert.deepEqual(evaluate('sortby([V], [K])', get), [10, null, 30, 20]);
  assert.deepEqual(evaluate('sortby([N], [N])', get), [1, 2, 3], 'numbers order as numbers');
  assert.deepEqual(evaluate('sortby([N], [K])', (n) => ({ N: [3, 1, 2], K: [2, 10, 1] }[n])), [2, 3, 1], 'not as strings: 10 after 2');
  assert.throws(() => evaluate('sortby([V], [N])', get), /sortby needs one key per value \(4 values, 3 keys\)/);
  assert.equal(evaluate('sortby(5, 1)', get), 5, 'a single value is its own series');
  assert.equal(evaluate('sortby(null, [K])', get), null);
  assert.deepEqual(check('sortby([A], [B])', ['A', 'B']), { ok: true }, 'the authoring check stubs fields and passes');
});

test('a formula returns a list or null, and the API returns the numbers', () => {
  const { w, acct, deal } = crm();
  w.addField(acct, { name: 'Trend', type: 'formula', config: { expression: 'sortby([Deal amounts], [Deal close dates])' } });
  w.addField(acct, { name: 'Nothing', type: 'formula', config: { expression: 'null' } });
  const a = w.createEntity(acct, { name: 'Acme' });
  for (const [amt, close] of [[300, '2026-03-01'], [100, '2026-01-01'], [200, '2026-02-01']]) {
    w.createEntity(deal, { name: String(amt), values: { Amount: amt, Close: close, Account: a.id } });
  }
  const read = w.readEntity(a.id);
  assert.deepEqual(read.raw.Trend, [100, 200, 300]);
  assert.deepEqual(read.fields.Trend, [100, 200, 300]);
  assert.equal(read.raw.Nothing, null);
  const checked = w.checkFormula(acct, 'sortby([Deal amounts], [Deal close dates])', { entity: a.id });
  assert.equal(checked.type, 'list', 'the builder learns the result is a list');
});

test('sparkline is a formula display with a style; a number field cannot wear it', () => {
  const { w, acct } = crm();
  w.addField(acct, { name: 'Trend', type: 'formula', config: { expression: '[Deal amounts]', display: 'sparkline' } });
  const f = w.describeSchema().find((s) => s.space === 'Sales').tables.find((t) => t.name === 'Account').fields.find((x) => x.name === 'Trend');
  assert.equal(f.display, 'sparkline');
  assert.equal(f.style, undefined, 'line is the default style and is not written down');
  w.updateField(acct, 'Trend', { config: { style: 'winloss' } });
  assert.equal(w.getField(acct, 'Trend').config.style, 'winloss');
  w.updateField(acct, 'Trend', { config: { style: 'column' } });
  assert.equal(w.getField(acct, 'Trend').config.style, 'column');
  assert.throws(() => w.updateField(acct, 'Trend', { config: { style: 'area' } }), /Invalid sparkline style 'area' \(line, column, winloss\)/);
  w.updateField(acct, 'Trend', { config: { display: 'text' } });
  assert.equal(w.getField(acct, 'Trend').config.style, undefined, 'back to text drops the style');
  assert.throws(() => w.addField(acct, { name: 'N', type: 'number', config: { display: 'sparkline' } }), /A sparkline draws a list: only a formula can wear it/);
});

test('sort and filter on a sparkline column read its last value', () => {
  const { w, acct, deal } = crm();
  w.addField(acct, { name: 'Trend', type: 'formula', config: { expression: 'sortby([Deal amounts], [Deal close dates])', display: 'sparkline' } });
  const rows = { up: [[1, '2026-01-01'], [9, '2026-02-01']], down: [[9, '2026-01-01'], [2, '2026-02-01']], mid: [[5, '2026-01-01'], [null, '2026-02-01'], [5, '2026-03-01']] };
  for (const [name, deals] of Object.entries(rows)) {
    const a = w.createEntity(acct, { name });
    deals.forEach(([amt, close], i) => w.createEntity(deal, { name: `${name}${i}`, values: { Amount: amt, Close: close, Account: a.id } }));
  }
  const names = (q) => q.items.map((e) => e.name);
  assert.deepEqual(names(w.query(acct, { sort: [{ field: 'Trend', dir: 'asc' }] })), ['down', 'mid', 'up'], 'last values 2, 5, 9');
  assert.deepEqual(names(w.query(acct, { where: [['Trend', '>', 4]] })).sort(), ['mid', 'up'], 'a blank last slot falls back to the last number');
  assert.deepEqual(w.readEntity(w.query(acct, { where: [['Name', '=', 'mid']] }).items[0].id).raw.Trend, [5, null, 5], 'the API still returns the whole series');
});

test('a chip and a card carry the series a sparkline segment draws', () => {
  const { w, acct, deal } = crm();
  w.addField(acct, { name: 'Trend', type: 'formula', config: { expression: 'sortby([Deal amounts], [Deal close dates])', display: 'sparkline', style: 'column' } });
  const a = w.createEntity(acct, { name: 'Acme' });
  w.createEntity(deal, { name: 'x', values: { Amount: 4, Close: '2026-01-01', Account: a.id } });
  w.createEntity(deal, { name: 'y', values: { Amount: 7, Close: '2026-02-01', Account: a.id } });
  const chip = w.renderView(a.id, 'chip', { config: { fields: ['Trend'] } });
  assert.deepEqual(chip.fields[0].spark, { style: 'column', values: [4, 7] });
});
