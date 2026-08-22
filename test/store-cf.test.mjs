import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { CFStore } from '../src/store-cf.js';

/* A node-side shim of a Durable Object's ctx.storage: the same synchronous
   sql.exec(query, ...bindings) + transactionSync(fn) surface, backed by
   node:sqlite. This proves the adapter's logic; gate G2 re-runs the same
   contract under `wrangler dev` (workerd) before anything deploys. */
function shimStorage() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    sql: {
      exec(query, ...params) {
        if (params.length === 0 && !/^\s*SELECT/i.test(query)) {
          db.exec(query);
          return { toArray: () => [] };
        }
        const stmt = db.prepare(query);
        if (/^\s*SELECT/i.test(query)) return { toArray: () => stmt.all(...params) };
        stmt.run(...params);
        return { toArray: () => [] };
      },
    },
    transactionSync(fn) {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; }
      catch (err) { db.exec('ROLLBACK'); throw err; }
    },
  };
}

function build(storage) {
  const store = new CFStore(storage);
  const w = new Weave({ store });
  return w;
}

test('CFStore: engine boots, structures and entities persist through save/load', () => {
  const storage = shimStorage();
  const w = build(storage);
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Task' });
  w.addField('Task', { name: 'Estimate', type: 'number' });
  const e = w.createEntity('Task', { name: 'A', values: { Estimate: 3 }, doc: 'notes here' });

  // A second store over the SAME storage sees everything the first wrote.
  const w2 = build(storage);
  const r = w2.readEntity(e.id);
  assert.equal(r.name, 'A');
  assert.equal(r.fields.Estimate, 3);
  assert.ok(w2.findSpace('Product'));
  assert.equal(w2.getDoc(e.id), 'notes here');
});

test('CFStore: FTS search parity — indexed on write, delisted on trash', () => {
  const storage = shimStorage();
  const w = build(storage);
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  const e = w.createEntity('T', { name: 'quixotic entity' });
  const rows = storage.sql.exec("SELECT id FROM entities_fts WHERE entities_fts MATCH 'quixotic'").toArray();
  assert.equal(rows.length, 1);
  w.deleteEntity(e.id);
  const gone = storage.sql.exec("SELECT id FROM entities_fts WHERE entities_fts MATCH 'quixotic'").toArray();
  assert.equal(gone.length, 0, 'the trash is not searchable');
});

test('CFStore: undo works through the DO backend and survives a reopen', () => {
  const storage = shimStorage();
  const w = build(storage);
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'N', type: 'number' });
  const e = w.createEntity('T', { name: 'row', values: { N: 1 } });
  w.updateEntity(e.id, { N: 2 });

  const w2 = build(storage); // fresh engine, same storage — the stack persisted
  w2.undo();
  assert.equal(w2.readEntity(e.id).fields.N, 1);
});

test('CFStore: audit trail lands in the audit_log table', () => {
  const storage = shimStorage();
  const w = build(storage);
  w.createSpace({ name: 'S' });
  const entries = w.listAudit({ limit: 10 });
  assert.ok(entries.length >= 1);
  assert.ok(entries.some((a) => a.action === 'space-created'));
});

test('CFStore: a failed save rolls back atomically', () => {
  const storage = shimStorage();
  const w = build(storage);
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  const before = storage.sql.exec('SELECT COUNT(*) AS n FROM entities').toArray()[0].n;
  // Poison one entity so JSON.stringify throws mid-save, inside the txn.
  const e = w.createEntity('T', { name: 'ok' });
  const cyc = {}; cyc.self = cyc;
  const bad = { ...w.getEntity(e.id), id: 'bad-row', values: cyc };
  w.state.entities['bad-row'] = bad;
  assert.throws(() => w.store.save(w.state, { dirty: new Set(['bad-row']) }));
  delete w.state.entities['bad-row'];
  const after = storage.sql.exec('SELECT COUNT(*) AS n FROM entities').toArray()[0].n;
  assert.equal(after, before + 1, 'only the committed row exists; the poisoned txn left nothing behind');
});

test('CFStore: changedExternally is always false — one DO, one writer', () => {
  const storage = shimStorage();
  const w = build(storage);
  assert.equal(w.store.changedExternally(), false);
});
