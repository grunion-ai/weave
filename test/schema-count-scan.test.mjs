import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function workspaceWithTables(tableCount, rowsPerTable) {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const tables = [];
  for (let i = 0; i < tableCount; i += 1) {
    const t = w.createTable({ space: 'Ops', name: `Table${i}` });
    for (let r = 0; r < rowsPerTable; r += 1) w.createEntity(t, { name: `Row ${i}-${r}` });
    tables.push(t);
  }
  return { w, tables };
}

function countingScans(w) {
  const scans = { count: 0 };
  const original = Object.getPrototypeOf(w).listEntities;
  w.listEntities = function listEntities(...args) {
    scans.count += 1;
    return original.apply(this, args);
  };
  return scans;
}

test('describeSchema counts rows without one entity scan per table', () => {
  const { w } = workspaceWithTables(6, 3);
  const scans = countingScans(w);
  w.describeSchema();
  assert.ok(
    scans.count <= 1,
    `describeSchema ran ${scans.count} entity scans; tables times entities is the cost this row is about`,
  );
});

test('universalSearch counts rows without one entity scan per matched table', () => {
  const { w } = workspaceWithTables(6, 3);
  const scans = countingScans(w);
  w.universalSearch('Table');
  assert.ok(
    scans.count <= 1,
    `universalSearch ran ${scans.count} entity scans for the table hits alone`,
  );
});

test('the faster count agrees with listEntities through delete, restore, purge and move', () => {
  const { w, tables } = workspaceWithTables(3, 4);
  const [a, b] = tables;

  const rows = w.listEntities(a.id);
  w.deleteEntity(rows[0].id);
  const restored = w.listEntities(a.id)[0];
  w.deleteEntity(restored.id);
  w.restoreEntity(restored.id);
  w.deleteEntity(w.listEntities(a.id)[1].id, { hard: true });
  w.bulk([w.listEntities(a.id)[0].id], 'move', { table: w.qualifiedName(w.getTable(b.id)) });

  const counts = new Map();
  for (const sp of w.describeSchema()) for (const t of sp.tables) counts.set(t.id, t.entityCount);
  for (const t of w.listTables()) {
    assert.equal(counts.get(t.id), w.listEntities(t.id).length, `count for ${t.name} drifted from its rows`);
  }

  const hits = w.universalSearch('Table').filter((h) => h.kind === 'table');
  assert.ok(hits.length >= 2, 'the search must return the tables it counts');
  for (const h of hits) assert.equal(h.entityCount, w.listEntities(h.id).length, `search count for ${h.name} drifted`);
});
