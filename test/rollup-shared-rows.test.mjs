import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function seeded({ parents = 1000, children = 10000 } = {}) {
  const w = new Weave();
  const space = w.createSpace({ name: 'Load' });
  const kid = w.createTable({ space: 'Load', name: 'Kid' });
  w.addField(kid.id, { name: 'N', type: 'number' });
  const par = w.createTable({ space: 'Load', name: 'Parent' });
  const spaces = Object.values(w.state.tables).find((t) => t.system === 'spaces');
  const rollup = w.addField(spaces.id, { name: 'Top kids', type: 'rollup', config: { via: kid.id, targetField: 'N', aggregate: 'sum', where: [['N', '>=', children - 1000]] } });
  w.addRelation(par.id, { name: 'Home', targetDb: spaces.id });
  const home = w.findField(w.getTable(par.id), 'Home');
  w.addField(par.id, { name: 'Top sum', type: 'lookup', config: { relationField: home.id, targetField: rollup.id } });
  for (let i = 0; i < children; i++) w.createEntity(kid.id, { name: `kid ${i}`, N: i });
  const row = w.listEntities(spaces.id).find((e) => e.sysId === space.id);
  for (let i = 0; i < parents; i++) w.createEntity(par.id, { name: `parent ${i}`, Home: row.id });
  return { w, kid, par, expected: Array.from({ length: 1000 }, (_, i) => children - 1000 + i).reduce((a, b) => a + b, 0) };
}

function countLists(w, dbId) {
  const calls = { n: 0 };
  const list = w.listEntities.bind(w);
  w.listEntities = (id, opts) => { if (id === dbId) calls.n++; return list(id, opts); };
  return calls;
}

test('a filtered rollup reads its child table once per query, not once per parent row (Issue #999)', () => {
  const { w, kid, par, expected } = seeded();
  const calls = countLists(w, kid.id);
  const out = w.query(par.id, { select: ['Top sum'] });
  assert.equal(out.total, 1000);
  assert.ok(out.items.every((r) => r['Top sum'] === expected), 'every parent sees the same rollup value');
  assert.equal(calls.n, 1, `the child table was listed ${calls.n} times for one query`);
});

test('a grid of 1k parents over a filtered 10k-row rollup answers inside its budget (Issue #999)', () => {
  const { w, par } = seeded();
  w.query(par.id, { limit: 50 });
  const t = performance.now();
  const out = w.query(par.id, {});
  const ms = performance.now() - t;
  assert.equal(out.items.length, 1000);
  assert.ok(ms < 2000, `grid query took ${ms.toFixed(0)} ms, budget 2000 ms`);
});

test('the shared child list is per query: a write between queries shows up (Issue #999)', () => {
  const { w, kid, par } = seeded({ parents: 3, children: 2000 });
  const before = w.query(par.id, { select: ['Top sum'] }).items[0]['Top sum'];
  assert.equal(before, Array.from({ length: 1000 }, (_, i) => 1000 + i).reduce((a, b) => a + b, 0));
  w.createEntity(kid.id, { name: 'late', N: 5000 });
  const after = w.query(par.id, { select: ['Top sum'] }).items[0]['Top sum'];
  assert.equal(after, before + 5000);
});
