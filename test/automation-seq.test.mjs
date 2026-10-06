/* Automations carried no ordinal (Issue #285). The engine fired the rules on
   one trigger in the order `Object.values(state.automations)` yields them,
   which is the order the store's bare `SELECT id, json FROM automations`
   returned them: rowid order, and whatever SQLite liked after a VACUUM or a
   hand-edited file. Two rules that write the same field ran in an order
   nobody stored.

   Every rule then carried `seq`, a workspace-wide counter minted at create.
   Since Feature #249 a rule is a row of Workspace/Workflows, and its seq is
   the row's number: minted at create, never reused after a delete, carried
   by export and import with the row. The rules on one trigger fire in row
   order. A workspace still holding state.automations is moved onto rows on
   open, in seq order, and a rule written before seq existed is numbered
   first in rowid order, the order it fired in until then. */
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

// A rule in the shape state.automations held before Feature #249.
const legacy = (t, letter, seq) => ({
  id: `00000000-0000-4000-8000-0000000000${letter.charCodeAt(0)}`, dbId: t.id, name: `Rule ${letter}`, enabled: true,
  trigger: { type: 'entity-created' }, actions: [{ type: 'append-doc', text: letter }], ...(seq != null ? { seq } : {}),
});

const tmp = () => mkdtempSync(join(tmpdir(), 'weave-autoseq-'));

test('create mints a workspace-wide seq that never repeats', () => {
  const { w, t } = workspace();
  const other = w.createTable({ space: 'Ops', name: 'Incident' });
  const [a] = rules(w, t, ['A']);
  const [b] = rules(w, other, ['B']);
  const [c] = rules(w, t, ['C']);
  assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3], 'one counter across tables, minted in create order');
  w.deleteAutomation(c.id);
  const [d] = rules(w, t, ['D']);
  assert.equal(d.seq, 4, 'a deleted rule does not give its number back');
});

test('rules on one trigger fire in seq order, in the session that made them and after a reopen', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'ws.db');
    const { w, t } = workspace({ path });
    rules(w, t, ['A', 'B', 'C']);
    assert.equal(fired(w, t), 'ABC', 'in the session that made them');
    w.store.close();
    const w2 = new Weave({ path });
    const t2 = w2.getTable('Ops/Ticket');
    assert.equal(fired(w2, t2), 'ABC', 'the reopened workspace fires by seq');
    assert.deepEqual(w2.listAutomations(t2).map((x) => x.name), ['Rule A', 'Rule B', 'Rule C'], 'listAutomations reads by seq');
    assert.deepEqual(w2.describeAutomations(t2).map((x) => x.seq), [1, 2, 3], 'describeAutomations exposes seq, in order');
    w2.store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a .db written before seq existed opens cleanly: its rules become rows in rowid order and keep firing in it', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'ws.db');
    const { w, t } = workspace({ path });
    w.store.close();
    // The pre-seq shape: no seq on any rule, no counter on meta, and a
    // rowid order (insertion order) that is not the letters' order.
    const db = new DatabaseSync(path);
    for (const l of ['B', 'C', 'A']) {
      const a = legacy(t, l);
      db.prepare('INSERT INTO automations (id, json) VALUES (?, ?)').run(a.id, JSON.stringify(a));
    }
    db.close();

    const w2 = new Weave({ path });
    const t2 = w2.getTable('Ops/Ticket');
    assert.deepEqual(w2.listAutomations().map((x) => [x.name, x.seq]), [['Rule B', 1], ['Rule C', 2], ['Rule A', 3]], 'numbered in rowid order, the order they fired in before');
    assert.equal(fired(w2, t2), 'BCA', 'and they keep firing in that order');
    w2.store.close();

    const check = new DatabaseSync(path);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM automations').get().n, 0, 'the old rows are gone from disk');
    check.close();
    const w3 = new Weave({ path });
    assert.deepEqual(w3.listAutomations().map((x) => x.seq), [1, 2, 3], 'a second open does not renumber');
    const [d] = rules(w3, w3.getTable('Ops/Ticket'), ['D']);
    assert.equal(d.seq, 4, 'a new rule takes the next number');
    w3.store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a rule a pre-#249 writer left in state.automations fires after the rows already numbered', () => {
  const { w, t } = workspace();
  const [a, b] = rules(w, t, ['A', 'B']);
  const dump = w.exportJSON({ blobs: false });
  const x = legacy(t, 'X', 1);
  dump.automations = { [x.id]: x };
  const w2 = new Weave();
  w2.importJSON(dump);
  const seqs = Object.fromEntries(w2.listAutomations().map((r) => [r.name, r.seq]));
  assert.equal(seqs['Rule A'], a.seq, 'a number already handed out never moves');
  assert.equal(seqs['Rule B'], b.seq);
  assert.equal(seqs['Rule X'], 3, 'the straggler takes the next one');
  assert.equal(fired(w2, w2.getTable('Ops/Ticket')), 'ABX');
});

test('export and import carry the rules as rows, with their numbers', () => {
  const { w, t } = workspace();
  const [, b] = rules(w, t, ['A', 'B', 'C']);
  w.deleteAutomation(b.id);
  const dump = w.exportJSON({ blobs: false });
  assert.deepEqual(dump.automations, {}, 'nothing rides in the old store');
  const w2 = new Weave();
  w2.importJSON(dump);
  const t2 = w2.getTable('Ops/Ticket');
  assert.deepEqual(w2.listAutomations().map((x) => x.seq), [1, 3], 'imported seqs are kept as written');
  assert.equal(fired(w2, t2), 'AC', 'fire order follows seq');
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
