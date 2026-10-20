import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function seeded({ tables = 20, rows = 50000, small = 100 } = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Load' });
  const dbs = [];
  for (let i = 0; i < tables; i++) {
    const db = w.createTable({ space: 'Load', name: `T${i}` });
    w.addField(db.id, { name: 'N', type: 'number' });
    dbs.push(db);
  }
  for (let i = 0; i < small; i++) w.createEntity(dbs[0].id, { name: `small ${i}`, N: i });
  for (let i = 0; i < rows - small; i++) w.createEntity(dbs[1 + (i % (tables - 1))].id, { name: `row ${i}`, N: i });
  return { w, small: dbs[0], big: dbs[1] };
}

function counted(w) {
  const visits = { ids: new Set(), walks: 0, reset() { this.ids.clear(); this.walks = 0; } };
  w.state.entities = new Proxy(w.state.entities, {
    get(target, key, receiver) { visits.ids.add(key); return Reflect.get(target, key, receiver); },
    ownKeys(target) { visits.walks++; return Reflect.ownKeys(target); },
  });
  return visits;
}

function brute(w, dbId, { includeDeleted = false } = {}) {
  return Object.values(w.state.entities).filter((e) => e.dbId === dbId && (includeDeleted || !e.deletedAt)).map((e) => e.id);
}

test('a table query visits its own rows, not the workspace (Issue #998)', () => {
  const { w, small } = seeded();
  w.query(small.id, { limit: 100 });
  const visits = counted(w);
  w.query(small.id, { limit: 100 });
  visits.reset();
  const out = w.query(small.id, { limit: 100, trashCount: true, countAll: true });
  assert.equal(out.total, 100);
  assert.equal(out.all, 100);
  assert.equal(out.trashCount, 0);
  assert.equal(visits.walks, 0, 'the query enumerated the whole workspace');
  assert.ok(visits.ids.size < 200, `a 100-row query in a 50k workspace read ${visits.ids.size} entities, budget 200`);
});

test('a table query in a 50k workspace answers inside its time budget (Issue #998)', () => {
  const { w, small } = seeded();
  w.query(small.id, { limit: 100 });
  const times = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    w.query(small.id, { limit: 100, trashCount: true, countAll: true });
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  assert.ok(p95 < 30, `p95 ${p95.toFixed(1)} ms, budget 30 ms`);
});

test('the table index follows create, trash, restore, purge, undo and reload (Issue #998)', () => {
  const { w, small, big } = seeded({ tables: 3, rows: 300, small: 50 });
  const same = (dbId, opts) => assert.deepEqual(w.listEntities(dbId, opts).map((e) => e.id), brute(w, dbId, opts));
  const a = w.createEntity(small.id, { name: 'added' });
  same(small.id);
  w.deleteEntity(a.id);
  same(small.id);
  same(small.id, { includeDeleted: true });
  assert.equal(w.query(small.id, { trashCount: true }).trashCount, 1);
  w.restoreEntity(a.id);
  same(small.id);
  const pid = a.publicId;
  assert.equal(w.getEntity(`Load/T0#${pid}`).id, a.id);
  w.deleteEntity(a.id, { hard: true });
  same(small.id, { includeDeleted: true });
  assert.throws(() => w.getEntity(`Load/T0#${pid}`), /not found/);
  const b = w.createEntity(big.id, { name: 'undone' });
  w.undo();
  same(big.id);
  same(big.id, { includeDeleted: true });
  assert.ok(w.listEntities(big.id, { includeDeleted: true }).some((e) => e.id === b.id));
  assert.throws(() => w.createEntity(small.id, { name: 'bad', Nope: 1 }));
  same(small.id, { includeDeleted: true });
  const snapshot = w.exportJSON();
  w.createEntity(small.id, { name: 'gone after import' });
  w.importJSON(snapshot);
  same(small.id, { includeDeleted: true });
  same(big.id, { includeDeleted: true });
});

test('a query reads each table row once and keeps its order (Issue #998)', () => {
  const { w, small } = seeded({ tables: 3, rows: 300, small: 50 });
  const before = brute(w, small.id);
  const out = w.query(small.id, {});
  assert.deepEqual(out.items.map((e) => e.id), before);
});
