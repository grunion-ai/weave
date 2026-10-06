/* Automations carried no ordinal (Issue #285). The engine fired the rules on
   one trigger in the order `Object.values(state.automations)` yields them,
   which is the order the store's bare `SELECT id, json FROM automations`
   returned them: rowid order today, and whatever SQLite likes after a
   VACUUM or a hand-edited file. Two rules that write the same field ran in an
   order nobody stored.

   Every automation now carries `seq`, a workspace-wide monotonic counter
   minted at create (the same family as `audit_log.seq`, `doc_revisions.seq`
   and activity's `seq`). The counter lives on `meta.automationSeq`; the store
   loads by seq, the engine fires and lists by seq, and a workspace written
   before seq existed is numbered once on open, in rowid order, which is the
   order its rules fired in until now. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';
import { workspace } from './lib/fixtures.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

// One rule per letter, each appending its letter to the new row's document,
// so the document spells out the order the rules fired in.
function rules(w, t, letters) {
  return letters.map((l) => w.createAutomation(t, {
    name: `Rule ${l}`, trigger: { type: 'entity-created' }, actions: [{ type: 'append-doc', text: l }],
  }));
}
const fired = (w, t) => w.getDoc(w.createEntity(t, { name: 'probe' }).id).split(/\n+/).join('');

const tmp = () => mkdtempSync(join(tmpdir(), 'weave-autoseq-'));

// Reorder the automations table's rowids: each id in turn moves past the
// current maximum. Returns the order the store's own pre-seq read
// (`SELECT id, json`, a full scan) gets back, which is rowid order. A bare
// `SELECT id` would walk the primary-key index instead and come back in uuid
// order: a third order, and a reminder that none of them was ever stored.
function setRowidOrder(path, ids) {
  const db = new DatabaseSync(path);
  try {
    for (const id of ids) db.prepare('UPDATE automations SET rowid = (SELECT MAX(rowid) FROM automations) + 1 WHERE id = ?').run(id);
    return db.prepare('SELECT id, json FROM automations').all().map((r) => r.id);
  } finally { db.close(); }
}

test('create mints a workspace-wide seq that never repeats', () => {
  const { w, t } = workspace();
  const other = w.createTable({ space: 'Ops', name: 'Incident' });
  const [a] = rules(w, t, ['A']);
  const [b] = rules(w, other, ['B']);
  const [c] = rules(w, t, ['C']);
  assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3], 'one counter across tables, minted in create order');
  assert.equal(w.state.meta.automationSeq, 3, 'the counter lives on the workspace');
  w.deleteAutomation(c.id);
  const [d] = rules(w, t, ['D']);
  assert.equal(d.seq, 4, 'a deleted rule does not give its number back');
});

test('rules on one trigger fire in seq order, not in the order SQLite returns them', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'ws.db');
    const { w, t } = workspace({ path });
    const [a, b, c] = rules(w, t, ['A', 'B', 'C']);
    assert.equal(fired(w, t), 'ABC', 'in the session that made them');
    w.store.close();

    // The file now hands the rows back as C, B, A.
    assert.deepEqual(setRowidOrder(path, [c.id, b.id, a.id]), [c.id, b.id, a.id], 'the premise: SQLite returns them reversed');

    const w2 = new Weave({ path });
    const t2 = w2.getTable('Ops/Ticket');
    assert.equal(fired(w2, t2), 'ABC', 'the reopened workspace fires by seq');
    assert.deepEqual(w2.listAutomations(t2).map((x) => x.name), ['Rule A', 'Rule B', 'Rule C'], 'listAutomations reads by seq');
    assert.deepEqual(w2.describeAutomations(t2).map((x) => x.seq), [1, 2, 3], 'describeAutomations exposes seq, in order');
    w2.store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a .db written before seq existed opens cleanly and is numbered in rowid order', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'ws.db');
    const { w, t } = workspace({ path });
    const [a, b, c] = rules(w, t, ['A', 'B', 'C']);
    w.store.close();

    // Rewrite the file into the pre-seq shape: no seq on any rule, no counter
    // on meta. Then give it a rowid order that differs from creation order,
    // so the test can tell rowid order from anything else.
    let db = new DatabaseSync(path);
    for (const row of db.prepare('SELECT id, json FROM automations').all()) {
      const j = JSON.parse(row.json);
      delete j.seq;
      db.prepare('UPDATE automations SET json = ? WHERE id = ?').run(JSON.stringify(j), row.id);
    }
    const meta = JSON.parse(db.prepare('SELECT json FROM weave_meta WHERE id = 1').get().json);
    delete meta.meta.automationSeq;
    db.prepare('UPDATE weave_meta SET json = ? WHERE id = 1').run(JSON.stringify(meta));
    db.close();
    const rowidOrder = setRowidOrder(path, [b.id, c.id, a.id]);
    assert.deepEqual(rowidOrder, [b.id, c.id, a.id]);

    const w2 = new Weave({ path });
    const t2 = w2.getTable('Ops/Ticket');
    const seqs = Object.fromEntries(w2.listAutomations().map((x) => [x.id, x.seq]));
    assert.deepEqual([seqs[b.id], seqs[c.id], seqs[a.id]], [1, 2, 3], 'backfilled in rowid order, the order they fired in before');
    assert.equal(w2.state.meta.automationSeq, 3, 'the counter continues from the backfill');
    assert.equal(fired(w2, t2), 'BCA', 'and they keep firing in that order');
    w2.store.close();

    // The backfill is written through, and a second open renumbers nothing.
    db = new DatabaseSync(path);
    const onDisk = Object.fromEntries(db.prepare('SELECT id, json FROM automations').all().map((r) => [r.id, JSON.parse(r.json).seq]));
    db.close();
    assert.deepEqual(onDisk, seqs, 'the numbers are on disk');
    const w3 = new Weave({ path });
    assert.deepEqual(Object.fromEntries(w3.listAutomations().map((x) => [x.id, x.seq])), seqs, 'a second open does not renumber');
    const [d] = rules(w3, w3.getTable('Ops/Ticket'), ['D']);
    assert.equal(d.seq, 4, 'a new rule takes the next number');
    w3.store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a rule a pre-seq writer appended fires last until the next open numbers it', () => {
  // A CLI still running pre-seq code can append a rule to the shared .db; a
  // running server refreshes without re-opening, so the hole must sort.
  const { w, t } = workspace();
  const [a, b, c] = rules(w, t, ['A', 'B', 'C']);
  delete w.state.automations[a.id].seq;
  assert.equal(fired(w, t), 'BCA', 'an unnumbered rule reads as the newest');

  const w2 = new Weave();
  w2.importJSON(w.exportJSON({ blobs: false }));
  const seqs = Object.fromEntries(w2.listAutomations().map((x) => [x.id, x.seq]));
  assert.equal(seqs[b.id], b.seq, 'a number already handed out never moves');
  assert.equal(seqs[c.id], c.seq);
  assert.equal(seqs[a.id], 4, 'the straggler takes the next one');
  assert.equal(w2.state.meta.automationSeq, 4);
});

test('export and import carry seq and the counter', () => {
  const { w, t } = workspace();
  const [, b] = rules(w, t, ['A', 'B', 'C']);
  w.deleteAutomation(b.id);
  const dump = w.exportJSON({ blobs: false });
  assert.deepEqual(Object.values(dump.automations).map((x) => x.seq), [1, 3], 'the dump carries seq');
  assert.equal(dump.meta.automationSeq, 3, 'and the counter');

  // A dump whose automations object lists them backwards: the object's key
  // order is the one thing a JSON round trip does not promise to keep.
  const reversed = { ...dump, automations: Object.fromEntries(Object.entries(dump.automations).reverse()) };
  const w2 = new Weave();
  w2.importJSON(reversed);
  const t2 = w2.getTable('Ops/Ticket');
  assert.deepEqual(w2.listAutomations().map((x) => x.seq), [1, 3], 'imported seqs are kept as written');
  assert.equal(fired(w2, t2), 'AC', 'fire order follows seq, not the dump key order');
  const [d] = rules(w2, t2, ['D']);
  assert.equal(d.seq, 4, 'the imported counter carries on');
});

test('route, MCP and CLI carry seq (parity)', async () => {
  const { w, t } = workspace();
  rules(w, t, ['A', 'B']);
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const listed = await (await fetch(`${base}/api/automations`)).json();
    assert.deepEqual(listed.map((x) => x.seq), [1, 2], 'GET /api/automations');
    const made = await (await fetch(`${base}/api/automations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ db: 'Ops/Ticket', name: 'Rule C', trigger: { type: 'entity-created' }, actions: [{ type: 'append-doc', text: 'C' }] }),
    })).json();
    assert.equal(made.seq, 3, 'POST /api/automations');
  } finally { server.close(); }
  assert.deepEqual(dispatchTool(w, 'weave_automations', { action: 'list' }).automations.map((x) => x.seq), [1, 2, 3], 'weave_automations list');

  const dir = tmp();
  try {
    const data = join(dir, 'ws.db');
    const { w: fw, t: ft } = workspace({ path: data });
    rules(fw, ft, ['A', 'B']);
    fw.store.close();
    const cli = (...a) => JSON.parse(execFileSync(process.execPath, [BIN, ...a, '--data', data], { encoding: 'utf8', maxBuffer: 64 << 20 }));
    assert.deepEqual(cli('automation', 'list').map((x) => x.seq), [1, 2], 'weave automation list');
    assert.deepEqual(cli('automation', 'describe').map((x) => x.seq), [1, 2], 'weave automation describe');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
