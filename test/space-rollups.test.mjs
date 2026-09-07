/* Kyle's ruling (2026-09-06): "all footer values live at the space level."
   A table-wide aggregate — the Σ under a column — is a rollup field on the
   Spaces registry row that holds the table, addressable and lookup-able like
   any field. `via` names the table (no relation to cross), `where` narrows
   the rows, `aggregate` is any of the engine's list. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function build() {
  const w = new Weave();
  const sp = w.createSpace({ name: 'Agent' });
  const other = w.createSpace({ name: 'Product' });
  const t = w.createTable({ space: sp.id, name: 'Sessions' });
  w.addField(t.id, { name: 'Cost', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2 } });
  w.addField(t.id, { name: 'Kind', type: 'select', config: { options: ['interactive', 'scheduled'] } });
  w.addField(t.id, { name: 'Model', type: 'multiselect', config: { options: ['opus', 'fable', 'sonnet'] } });
  w.addField(t.id, { name: 'Started', type: 'date' });
  w.addField(t.id, { name: 'Done', type: 'checkbox' });
  const rows = [
    ['a', 1.5, 'interactive', ['opus'], '2026-09-01', true],
    ['b', 2.5, 'interactive', ['opus', 'fable'], '2026-09-03', false],
    ['c', null, 'scheduled', ['fable'], '2026-08-30', true],
    ['d', 10, 'scheduled', [], null, false],
  ];
  for (const [Name, Cost, Kind, Model, Started, Done] of rows) w.createEntity(t.id, { values: { Name, Cost, Kind, Model, Started, Done } });
  const spacesT = Object.values(w.state.tables).find((x) => x.system === 'spaces');
  const spaceRow = () => w.query(spacesT.id, { where: [['Name', '=', 'Agent']] }).items[0];
  return { w, sp, other, t, spacesT, spaceRow };
}

test('a rollup on the Spaces row rolls a whole table up through `via`', () => {
  const { w, t, spacesT, spaceRow } = build();
  w.addField(spacesT.id, { name: 'Sessions · Cost · sum', type: 'rollup', config: { via: 'Agent/Sessions', targetField: 'Cost', aggregate: 'sum' } });
  w.addField(spacesT.id, { name: 'Sessions · count', type: 'rollup', config: { via: t.id, aggregate: 'count' } });
  w.addField(spacesT.id, { name: 'Sessions · Cost · avg', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'avg' } });
  w.addField(spacesT.id, { name: 'Sessions · Cost · median', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'median' } });
  w.addField(spacesT.id, { name: 'Sessions · Cost · max', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'max' } });
  w.addField(spacesT.id, { name: 'Sessions · Cost · filled', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'filled' } });
  w.addField(spacesT.id, { name: 'Sessions · Model · distinct', type: 'rollup', config: { via: 'Sessions', targetField: 'Model', aggregate: 'distinct' } });
  const row = spaceRow();
  assert.equal(row.raw['Sessions · Cost · sum'], 14);
  assert.equal(row.raw['Sessions · count'], 4);
  assert.equal(row.raw['Sessions · Cost · avg'], 14 / 3);
  assert.equal(row.raw['Sessions · Cost · median'], 2.5);
  assert.equal(row.raw['Sessions · Cost · max'], 10);
  assert.equal(row.raw['Sessions · Cost · filled'], 3);
  assert.equal(row.raw['Sessions · Model · distinct'], 2);
});

test('the rolled-up value wears the target column\'s costume', () => {
  const { w, spacesT, spaceRow } = build();
  w.addField(spacesT.id, { name: 'Cost sum', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'sum' } });
  w.addField(spacesT.id, { name: 'Cost avg', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'avg' } });
  w.addField(spacesT.id, { name: 'First', type: 'rollup', config: { via: 'Sessions', targetField: 'Started', aggregate: 'min' } });
  w.addField(spacesT.id, { name: 'Last', type: 'rollup', config: { via: 'Sessions', targetField: 'Started', aggregate: 'max' } });
  w.addField(spacesT.id, { name: 'Cost n', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'filled' } });
  const row = spaceRow();
  assert.equal(row.fields['Cost sum'], '$14.00');
  assert.equal(row.fields['Cost avg'], '$4.67');
  assert.equal(row.raw.First, '2026-08-30');
  assert.equal(row.fields.First, 'Aug 30, 2026');
  assert.equal(row.fields.Last, 'Sep 3, 2026');
  assert.equal(row.fields['Cost n'], 3, 'a count is a count, not a dollar figure');
});

test('a relation rollup of a currency column wears the same costume', () => {
  const w = new Weave();
  const sp = w.createSpace({ name: 'P' });
  const a = w.createTable({ space: sp.id, name: 'Project' });
  const b = w.createTable({ space: sp.id, name: 'Task' });
  w.addField(b.id, { name: 'Estimate', type: 'number', config: { format: 'currency', currency: 'EUR', decimals: 0 } });
  w.addRelation(b.id, { name: 'Project', targetDb: a.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.addField(a.id, { name: 'Total', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Estimate', aggregate: 'sum' } });
  const p = w.createEntity(a.id, { values: { Name: 'Apollo' } });
  w.createEntity(b.id, { values: { Name: 't1', Estimate: 100, Project: p.id } });
  w.createEntity(b.id, { values: { Name: 't2', Estimate: 250, Project: p.id } });
  assert.equal(w.readEntity(p.id).fields.Total, '€350');
});

test('`where` narrows the rows the rollup reads', () => {
  const { w, spacesT, spaceRow } = build();
  w.addField(spacesT.id, { name: 'Scheduled cost', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'sum', where: [['Kind', '=', 'scheduled']] } });
  w.addField(spacesT.id, { name: 'Interactive', type: 'rollup', config: { via: 'Sessions', aggregate: 'count', where: { or: [['Kind', '=', 'interactive'], ['Done', '=', true]] } } });
  const row = spaceRow();
  assert.equal(row.raw['Scheduled cost'], 10);
  assert.equal(row.raw.Interactive, 3);
  assert.throws(() => w.addField(spacesT.id, { name: 'Bad', type: 'rollup', config: { via: 'Sessions', aggregate: 'count', where: [['Nope', '=', 1]] } }), /Nope/);
});

test('every aggregate the engine lists resolves without throwing, over numbers and over chips', () => {
  const { w, spacesT, spaceRow } = build();
  const { VOCABULARY } = w.constructor.vocabulary ? w.constructor : { VOCABULARY: null };
  const aggs = (VOCABULARY?.aggregates) ?? ['count', 'sum', 'avg', 'min', 'max', 'join', 'median', 'stdev', 'distinct', 'filled', 'empty', 'range'];
  for (const agg of aggs) {
    w.addField(spacesT.id, { name: `n ${agg}`, type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: agg } });
    w.addField(spacesT.id, { name: `m ${agg}`, type: 'rollup', config: { via: 'Sessions', targetField: 'Model', aggregate: agg } });
  }
  const row = spaceRow();
  assert.equal(row.raw['n stdev'].toFixed(3), '4.646');
  assert.equal(row.raw['n range'], 8.5);
  assert.equal(row.raw['n empty'], 1);
  assert.equal(row.raw['m join'], 'opus, opus, fable, fable');
  assert.equal(row.raw['m empty'], 1);
  assert.equal(row.raw['m sum'], 0, 'chips have no numbers to sum');
});

test('a space rollup answers only on the row of the space that holds the table', () => {
  const { w, spacesT } = build();
  w.addField(spacesT.id, { name: 'N', type: 'rollup', config: { via: 'Sessions', aggregate: 'count' } });
  const rows = w.query(spacesT.id, {}).items;
  assert.equal(rows.find((r) => r.name === 'Agent').raw.N, 4);
  assert.equal(rows.find((r) => r.name === 'Product').raw.N, null);
});

test('`via` is refused off the Spaces registry, on a registry table, and on a table that does not exist', () => {
  const { w, t, spacesT } = build();
  assert.throws(() => w.addField(t.id, { name: 'Self', type: 'rollup', config: { via: 'Sessions', aggregate: 'count' } }), /Spaces/);
  assert.throws(() => w.addField(spacesT.id, { name: 'Reg', type: 'rollup', config: { via: 'Workspace/Tables', aggregate: 'count' } }), /system registry/);
  assert.throws(() => w.addField(spacesT.id, { name: 'Ghost', type: 'rollup', config: { via: 'Nowhere', aggregate: 'count' } }), /not found/);
  assert.throws(() => w.addField(spacesT.id, { name: 'Mode', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'mode' } }), /Invalid aggregate/);
});

test('the schema names the table a space rollup reads, and a round trip keeps it', () => {
  const { w, spacesT, spaceRow } = build();
  w.addField(spacesT.id, { name: 'Cost sum', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'sum', where: [['Kind', '=', 'scheduled']] } });
  const desc = w.describeSchema().flatMap((s) => s.tables).find((d) => d.system === 'spaces').fields.find((f) => f.name === 'Cost sum');
  assert.equal(desc.viaTable, 'Agent/Sessions');
  assert.equal(desc.targetField, 'Cost');
  assert.equal(desc.aggregate, 'sum');
  assert.deepEqual(desc.where, [['Kind', '=', 'scheduled']]);
  assert.equal(desc.via, undefined, 'no relation is crossed');
  // Apply the same schema back: nothing changes, nothing is lost.
  const before = JSON.stringify(spaceRow().raw);
  w.applySchema(w.describeSchema());
  assert.equal(JSON.stringify(spaceRow().raw), before);
  // And into a fresh workspace: the field lands, pointed at the same table.
  const w2 = new Weave();
  w2.applySchema(w.describeSchema());
  const t2 = w2.describeSchema().flatMap((s) => s.tables).find((d) => d.system === 'spaces').fields.find((f) => f.name === 'Cost sum');
  assert.equal(t2?.viaTable, 'Agent/Sessions');
});

test('deleting the column a space rollup reads is refused; hard-deleting the table drops the rollup', () => {
  const { w, t, spacesT } = build();
  w.addField(spacesT.id, { name: 'Cost sum', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'sum' } });
  w.addField(spacesT.id, { name: 'N', type: 'rollup', config: { via: 'Sessions', aggregate: 'count' } });
  assert.throws(() => w.deleteField(t.id, 'Cost'), /Spaces\.Cost sum/);
  w.deleteTable(t.id, { hard: true });
  const names = Object.values(w.getTable(spacesT.id).fields).map((f) => f.name);
  assert.ok(!names.includes('Cost sum') && !names.includes('N'), `dependants dropped: ${names}`);
  // Every read still answers.
  assert.doesNotThrow(() => w.query(spacesT.id, {}));
});

test('tableRollups lists the space rollups pointed at a table with their live values', () => {
  const { w, t, spacesT } = build();
  w.addField(spacesT.id, { name: 'Cost sum', type: 'rollup', config: { via: 'Sessions', targetField: 'Cost', aggregate: 'sum' } });
  w.addField(spacesT.id, { name: 'N', type: 'rollup', config: { via: 'Sessions', aggregate: 'count' } });
  const list = w.tableRollups(t.id);
  assert.deepEqual(list.map((r) => [r.name, r.targetField, r.aggregate, r.value, r.display]), [
    ['Cost sum', 'Cost', 'sum', 14, '$14.00'],
    ['N', null, 'count', 4, '4'],
  ]);
  assert.ok(list[0].fieldId && list[0].spaceRowId, 'each carries the ids a client needs to edit or delete it');
});

test('tableStats describes every column: numbers get the summary and a histogram, chips a distribution, dates a span', () => {
  const { w, t } = build();
  const s = w.tableStats(t.id);
  assert.equal(s.table, 'Agent/Sessions');
  assert.equal(s.rows, 4);
  const col = (n) => s.columns.find((c) => c.name === n);
  assert.equal(col('Cost').kind, 'number');
  assert.equal(col('Cost').filled, 3);
  assert.equal(col('Cost').empty, 1);
  assert.equal(col('Cost').summary.sum, 14);
  assert.equal(col('Cost').summary.median, 2.5);
  assert.equal(col('Cost').display.sum, '$14.00');
  assert.equal(col('Cost').display.avg, '$4.67');
  assert.ok(col('Cost').histogram.length >= 1);
  assert.equal(col('Kind').kind, 'category');
  assert.deepEqual(col('Kind').distribution, [{ value: 'interactive', count: 2 }, { value: 'scheduled', count: 2 }]);
  assert.deepEqual(col('Model').distribution, [{ value: 'fable', count: 2 }, { value: 'opus', count: 2 }, { value: null, count: 1 }]);
  assert.equal(col('Done').kind, 'category');
  assert.equal(col('Started').kind, 'date');
  assert.equal(col('Started').earliest, '2026-08-30');
  assert.equal(col('Started').latest, '2026-09-03');
  assert.equal(col('Started').spanDays, 4);
  assert.equal(col('Name').kind, 'text');
  assert.equal(col('Name').distinct, 4);
  assert.ok(!s.columns.some((c) => c.name === 'Chip' || c.name === 'Card'), 'views are not columns to summarise');
});

test('tableStats groups by a field and takes a where', () => {
  const { w, t } = build();
  const s = w.tableStats(t.id, { by: 'Kind' });
  assert.deepEqual(s.groups.map((g) => [g.value, g.rows, g.columns.Cost.sum, g.columns.Cost.avg]), [
    ['interactive', 2, 4, 2],
    ['scheduled', 2, 10, 10],
  ]);
  assert.equal(s.groups[0].display.Cost.sum, '$4.00');
  const multi = w.tableStats(t.id, { by: 'Model' });
  assert.deepEqual(multi.groups.map((g) => [g.value, g.rows]), [['fable', 2], ['opus', 2], [null, 1]]);
  const narrowed = w.tableStats(t.id, { where: [['Kind', '=', 'scheduled']] });
  assert.equal(narrowed.rows, 2);
  assert.equal(narrowed.columns.find((c) => c.name === 'Cost').summary.sum, 10);
  assert.throws(() => w.tableStats(t.id, { by: 'Nope' }), /not found/);
});

test('tableStats carries the space rollups pointed at the table', () => {
  const { w, t, spacesT } = build();
  w.addField(spacesT.id, { name: 'N', type: 'rollup', config: { via: 'Sessions', aggregate: 'count' } });
  assert.deepEqual(w.tableStats(t.id).rollups.map((r) => [r.name, r.value]), [['N', 4]]);
});
