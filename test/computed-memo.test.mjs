import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function seeded({ rows = 5000, owners = 50 } = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Load' });
  const owner = w.createTable({ space: 'Load', name: 'Owner' });
  w.addField(owner.id, { name: 'Rank', type: 'number' });
  const item = w.createTable({ space: 'Load', name: 'Item' });
  w.addField(item.id, { name: 'N', type: 'number' });
  w.addRelation(item.id, { name: 'Owner', targetDb: owner.id });
  const rel = w.findField(w.getTable(item.id), 'Owner');
  const rank = w.findField(w.getTable(owner.id), 'Rank');
  w.addField(item.id, { name: 'Weight', type: 'lookup', config: { relationField: rel.id, targetField: rank.id } });
  w.addField(item.id, { name: 'Score', type: 'formula', config: { expression: 'Weight * 10 + N' } });
  const heads = [];
  for (let i = 0; i < owners; i++) heads.push(w.createEntity(owner.id, { name: `owner ${i}`, Rank: (i * 37) % owners }));
  for (let i = 0; i < rows; i++) w.createEntity(item.id, { name: `item ${i}`, N: i % 7, Owner: heads[(i * 13) % owners].id });
  return { w, item, owner, heads };
}

function countReads(w, name) {
  const reads = { n: 0 };
  const find = w.findField.bind(w);
  w.findField = (db, ref) => { if (ref === name) reads.n++; return find(db, ref); };
  return reads;
}

function expectedOrder(w, item, dir = 'asc') {
  const rows = w.listEntities(item.id).map((e, i) => {
    const owner = w.getEntity(e.values[w.findField(w.getTable(item.id), 'Owner').id]);
    return { id: e.id, i, score: owner.values[w.findField(w.getTable(owner.dbId), 'Rank').id] * 10 + e.values[w.findField(w.getTable(item.id), 'N').id] };
  });
  rows.sort((a, b) => (dir === 'desc' ? b.score - a.score : a.score - b.score) || a.i - b.i);
  return rows.map((r) => r.id);
}

test('sorting 5k rows by a formula over a lookup evaluates it once per row (Issue #1000)', () => {
  const { w, item } = seeded();
  const want = expectedOrder(w, item);
  const reads = countReads(w, 'Weight');
  const out = w.query(item.id, { sort: [{ field: 'Score' }], limit: 50 });
  assert.equal(out.total, 5000);
  assert.deepEqual(out.items.map((e) => e.id), want.slice(0, 50));
  assert.ok(reads.n <= 5000, `the formula read its lookup ${reads.n} times for 5000 rows`);
});

test('the full sort keeps the order a comparator sort gives, both directions and with ties (Issue #1000)', () => {
  const { w, item } = seeded({ rows: 600, owners: 7 });
  assert.deepEqual(w.query(item.id, { sort: [{ field: 'Score' }], select: ['Score'] }).items.map((e) => e.id), expectedOrder(w, item));
  assert.deepEqual(w.query(item.id, { sort: [{ field: 'Score', dir: 'desc' }], select: ['Score'] }).items.map((e) => e.id), expectedOrder(w, item, 'desc'));
  const two = w.query(item.id, { sort: [{ field: 'Weight' }, { field: 'N', dir: 'desc' }], select: ['Weight', 'N'] }).items;
  for (let i = 1; i < two.length; i++) {
    const a = two[i - 1];
    const b = two[i];
    assert.ok(a.Weight < b.Weight || (a.Weight === b.Weight && a.N >= b.N), `row ${i} out of order`);
  }
});

test('the memo lasts one query: a write between queries shows up (Issue #1000)', () => {
  const { w, item, heads } = seeded({ rows: 40, owners: 4 });
  const first = w.query(item.id, { sort: [{ field: 'Score', dir: 'desc' }], select: ['Score'] }).items[0];
  w.updateEntity(heads[0].id, { Rank: 1000 });
  const top = w.query(item.id, { sort: [{ field: 'Score', dir: 'desc' }], select: ['Score'] }).items[0];
  assert.ok(top.Score >= 10000, `the new rank did not reach the next query (top score ${top.Score}, before ${first.Score})`);
});

test('a sort on a one-row table never resolves the sort key, as before (Issue #1000)', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'One' });
  w.createEntity(t.id, { name: 'only' });
  assert.equal(w.query(t.id, { sort: [{ field: 'Nope' }] }).total, 1);
});

test('5k rows sorted by a formula over a lookup answer inside the budget (Issue #1000)', () => {
  const { w, item } = seeded();
  w.query(item.id, { limit: 50 });
  const t = performance.now();
  w.query(item.id, { sort: [{ field: 'Score' }], limit: 50 });
  const ms = performance.now() - t;
  assert.ok(ms < 120, `sorted query took ${ms.toFixed(0)} ms, budget 120 ms`);
});

test('a memoised value never outlives the depth limit it was computed under (Issue #1000)', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'Chain' });
  w.addField(t.id, { name: 'N', type: 'number' });
  w.addField(t.id, { name: 'F0', type: 'formula', config: { expression: 'N + 1' } });
  for (let i = 1; i <= 11; i++) w.addField(t.id, { name: `F${i}`, type: 'formula', config: { expression: `F${i - 1} + 1` } });
  const row = w.createEntity(t.id, { name: 'r', N: 1 });
  const names = ['F2', 'F4', 'F11', 'F9', 'F0', 'F7', 'F10'];
  const alone = Object.fromEntries(names.map((n) => [n, w.query(t.id, { select: [n] }).items[0][n]]));
  const together = w.query(t.id, { select: names }).items[0];
  for (const n of names) assert.deepEqual(together[n], alone[n], `${n} read beside other fields differs from ${n} read alone`);
  const plain = w.readEntity(row.id).fields;
  assert.deepEqual(w.query(t.id, {}).items[0].fields, plain);
});
