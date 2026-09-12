/* Document version history (Feature #225). Every document field keeps its
   own revisions in a `doc_revisions` table beside the entity blob — never
   inside it, so entity rows stay small and export (a share surface, Issue
   #230) never carries prior text. A typing session is one revision: writes
   by the same actor to the same field inside the coalescing window replace
   the newest revision instead of adding one (the activity feed's rule,
   Issue #32). A restore is a plain setDoc of the old text, recorded fresh,
   so nothing in the log is ever destroyed by restoring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Weave, WeaveError } from '../src/engine.js';
import { Store } from '../src/store.js';
import { CFStore } from '../src/store-cf.js';
import { startServer } from '../src/server.js';
import { dispatchTool, TOOLS } from '../src/mcp.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

function build(opts = {}) {
  const w = new Weave(opts);
  w.createSpace({ name: 'Wiki' });
  w.createTable({ space: 'Wiki', name: 'Article' });
  w.addField('Article', { name: 'Spec', type: 'document' });
  return w;
}

// The store contract, run against every backing: in-memory, file, and the
// Durable Object shim — one shape, three homes.
function storeContract(name, makeStore) {
  test(`${name}: push, list newest first with metadata only, get carries the text`, () => {
    const s = makeStore();
    const a = s.pushDocRevision({ entityId: 'e1', fieldId: 'f1', at: '2026-09-12T10:00:00.000Z', actor: 'kyle', text: 'one' });
    const b = s.pushDocRevision({ entityId: 'e1', fieldId: 'f1', at: '2026-09-12T10:20:00.000Z', actor: 'agent', text: 'one two' });
    s.pushDocRevision({ entityId: 'e1', fieldId: 'OTHER', at: '2026-09-12T10:30:00.000Z', actor: 'kyle', text: 'elsewhere' });
    s.pushDocRevision({ entityId: 'e2', fieldId: 'f1', at: '2026-09-12T10:30:00.000Z', actor: 'kyle', text: 'elsewhere' });
    assert.ok(b.seq > a.seq, 'seq grows');
    const list = s.listDocRevisions('e1', 'f1');
    assert.deepEqual(list.map((r) => r.seq), [b.seq, a.seq], 'newest first, scoped to entity + field');
    assert.deepEqual(Object.keys(list[0]).sort(), ['actor', 'at', 'len', 'seq'], 'the list carries metadata only');
    assert.equal(list[0].len, 7);
    assert.equal(list[0].actor, 'agent');
    assert.equal(s.getDocRevision('e1', 'f1', a.seq).text, 'one');
    assert.equal(s.getDocRevision('e1', 'f1', 99999), null);
    assert.equal(s.getDocRevision('e2', 'f1', a.seq), null, 'a seq belongs to one document');
    assert.equal(s.listDocRevisions('e1', 'f1', { limit: 1 }).length, 1);
  });

  test(`${name}: replace rewrites the newest revision in place; delete drops an entity's revisions`, () => {
    const s = makeStore();
    const a = s.pushDocRevision({ entityId: 'e1', fieldId: 'f1', at: '2026-09-12T10:00:00.000Z', actor: 'kyle', text: 'one' });
    s.replaceDocRevision(a.seq, { at: '2026-09-12T10:05:00.000Z', text: 'one two three' });
    const [top] = s.listDocRevisions('e1', 'f1');
    assert.equal(top.seq, a.seq);
    assert.equal(top.at, '2026-09-12T10:05:00.000Z');
    assert.equal(top.len, 13);
    assert.equal(s.getDocRevision('e1', 'f1', a.seq).text, 'one two three');
    s.pushDocRevision({ entityId: 'e1', fieldId: 'f2', at: '2026-09-12T10:05:00.000Z', actor: 'kyle', text: 'x' });
    s.pushDocRevision({ entityId: 'e2', fieldId: 'f1', at: '2026-09-12T10:05:00.000Z', actor: 'kyle', text: 'y' });
    s.deleteDocRevisions('e1');
    assert.equal(s.listDocRevisions('e1', 'f1').length, 0);
    assert.equal(s.listDocRevisions('e1', 'f2').length, 0);
    assert.equal(s.listDocRevisions('e2', 'f1').length, 1, 'another entity keeps its history');
  });

  test(`${name}: a document keeps its newest 200 revisions`, () => {
    const s = makeStore();
    for (let i = 0; i < 205; i++) {
      s.pushDocRevision({ entityId: 'e1', fieldId: 'f1', at: `2026-09-12T10:00:${String(i % 60).padStart(2, '0')}.000Z`, actor: 'kyle', text: `v${i}` });
    }
    const list = s.listDocRevisions('e1', 'f1', { limit: 500 });
    assert.equal(list.length, 200);
    assert.equal(s.getDocRevision('e1', 'f1', list[0].seq).text, 'v204', 'the newest survives');
    assert.equal(s.getDocRevision('e1', 'f1', list[199].seq).text, 'v5', 'the oldest five went');
  });
}

storeContract('memory store', () => new Store());
storeContract('sqlite store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-rev-'));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = new Store(join(dir, 'ws.db'));
  s.load();
  return s;
});
storeContract('cloudflare store', () => {
  const db = new DatabaseSync(':memory:');
  const storage = {
    sql: {
      exec(query, ...params) {
        if (params.length === 0 && !/^\s*SELECT/i.test(query)) { db.exec(query); return { toArray: () => [] }; }
        const stmt = db.prepare(query);
        if (/^\s*SELECT/i.test(query)) return { toArray: () => stmt.all(...params) };
        stmt.run(...params);
        return { toArray: () => [] };
      },
    },
    transactionSync(fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (err) { db.exec('ROLLBACK'); throw err; } },
  };
  const s = new CFStore(storage);
  s.load();
  return s;
});

test('sqlite: revisions persist across a reopen and live outside the entity blob', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-rev-'));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'ws.db');
  const w = build({ path, revisionWindowMs: 0 });
  const e = w.createEntity('Article', { name: 'A', doc: 'first' });
  w.setDoc(e.id, 'second');
  const w2 = new Weave({ path });
  const list = w2.listDocRevisions(e.id).revisions;
  assert.equal(list.length, 2);
  assert.equal(w2.getDocRevision(e.id, null, list[1].seq).text, 'first');
  const row = new DatabaseSync(path).prepare('SELECT json FROM entities WHERE id = ?').get(e.id);
  assert.ok(!row.json.includes('"first"'), 'the entity row carries only the current text');
  assert.ok(!JSON.stringify(w2.exportJSON()).includes('"first"'), 'export carries no prior text');
});

// ---------------- engine ----------------

test('a create with a document is its first revision; each later write is a revision of the new text', () => {
  const w = build({ revisionWindowMs: 0 });
  const e = w.createEntity('Article', { name: 'A', doc: 'v1' });
  assert.deepEqual(w.listDocRevisions(e.id).revisions.map((r) => r.len), [2]);
  w.setDoc(e.id, 'v2 longer');
  w.appendDoc(e.id, 'tail');
  w.updateEntity(e.id, { Description: 'v4' });
  const list = w.listDocRevisions(e.id).revisions;
  assert.deepEqual(list.map((r) => r.len), [2, 15, 9, 2], 'newest first: v4, v2+tail, v2, v1');
  assert.equal(w.getDocRevision(e.id, 'Description', list[0].seq).text, 'v4', 'the newest revision IS the current text');
  assert.equal(w.getDocRevision(e.id, null, list[1].seq).text, 'v2 longer\n\ntail');
  assert.equal(list[0].actor, 'local');
  assert.ok(list[0].at >= list[3].at);
});

test('identical text records nothing; each document field keeps its own log', () => {
  const w = build({ revisionWindowMs: 0 });
  const e = w.createEntity('Article', { name: 'A', doc: 'same' });
  w.setDoc(e.id, 'same');
  w.setDoc(e.id, 'same');
  assert.equal(w.listDocRevisions(e.id).revisions.length, 1);
  w.setDoc(e.id, 'spec text', 'Spec');
  assert.equal(w.listDocRevisions(e.id, 'Spec').revisions.length, 1);
  assert.equal(w.listDocRevisions(e.id, 'Description').revisions.length, 1);
  assert.equal(w.listDocRevisions(e.id).revisions.length, 1, 'no field = the default document');
});

test('a typing session is one revision: same actor, same field, inside the window coalesces', () => {
  const w = build(); // the default ten-minute window
  const e = w.createEntity('Article', { name: 'A', doc: 'v1' });
  w.setDoc(e.id, 'v1 and more');
  w.setDoc(e.id, 'v1 and more and more');
  const list = w.listDocRevisions(e.id).revisions;
  assert.equal(list.length, 1, 'three writes in one session are one revision');
  assert.equal(w.getDocRevision(e.id, null, list[0].seq).text, 'v1 and more and more');
  // Another actor starts a new revision even inside the window.
  w.actor = 'agent';
  w.setDoc(e.id, 'agent edit');
  assert.equal(w.listDocRevisions(e.id).revisions.length, 2);
  assert.equal(w.listDocRevisions(e.id).revisions[0].actor, 'agent');
  // Back to the first actor: a new revision too — the newest is the agent's.
  w.actor = 'local';
  w.setDoc(e.id, 'local again');
  assert.equal(w.listDocRevisions(e.id).revisions.length, 3);
});

test('a document that predates the feature gets its prior text as a baseline on its first write', () => {
  const w = build({ revisionWindowMs: 0 });
  const e = w.createEntity('Article', { name: 'A' });
  // Simulate a pre-feature document: text in the blob, nothing in the log.
  const db = w.getTable('Article');
  const f = w.descriptionField(db);
  w.getEntity(e.id).docs[f.id] = 'legacy text';
  assert.equal(w.listDocRevisions(e.id).revisions.length, 0);
  w.setDoc(e.id, 'edited');
  const list = w.listDocRevisions(e.id).revisions;
  assert.equal(list.length, 2);
  assert.equal(w.getDocRevision(e.id, null, list[1].seq).text, 'legacy text', 'the text before the first write is kept');
  assert.equal(w.getDocRevision(e.id, null, list[0].seq).text, 'edited');
});

test('restore is a normal setDoc: activity, undo and a fresh revision — never a coalesce', () => {
  const w = build();
  const e = w.createEntity('Article', { name: 'A', doc: 'v1' });
  w.actor = 'agent';
  w.setDoc(e.id, 'v2');
  w.actor = 'local';
  w.setDoc(e.id, 'v3');
  const [, , first] = w.listDocRevisions(e.id).revisions;
  const r = w.restoreDocRevision(e.id, null, first.seq);
  assert.equal(w.getDoc(e.id), 'v1');
  assert.equal(r.field, 'Description');
  assert.equal(r.seq, first.seq);
  const list = w.listDocRevisions(e.id).revisions;
  assert.equal(list.length, 4, 'the restore is a fourth revision; v3 (same actor, inside the window) was not overwritten');
  assert.equal(w.getDocRevision(e.id, null, list[1].seq).text, 'v3');
  assert.equal(w.getDocRevision(e.id, null, list[0].seq).text, 'v1');
  const kinds = w.getEntity(e.id).activity.map((a) => a.kind);
  assert.ok(kinds.includes('doc-updated'));
  w.undo();
  assert.equal(w.getDoc(e.id), 'v3', 'undo steps the restore back');
  assert.equal(w.listDocRevisions(e.id).revisions.length, 5, 'the undo is itself a revision; nothing is popped from the log');
  assert.equal(w.getDocRevision(e.id, null, w.listDocRevisions(e.id).revisions[0].seq).text, 'v3');
});

test('a revision is looked up by its own document: a wrong field or seq is not-found', () => {
  const w = build({ revisionWindowMs: 0 });
  const e = w.createEntity('Article', { name: 'A', doc: 'v1' });
  const [rev] = w.listDocRevisions(e.id).revisions;
  assert.throws(() => w.getDocRevision(e.id, 'Spec', rev.seq), (err) => err instanceof WeaveError && err.code === 'not-found');
  assert.throws(() => w.getDocRevision(e.id, null, 424242), (err) => err.code === 'not-found');
  assert.throws(() => w.restoreDocRevision(e.id, null, 424242), (err) => err.code === 'not-found');
  assert.throws(() => w.listDocRevisions(e.id, 'Nope'), (err) => err instanceof WeaveError && /not a document field/.test(err.message));
});

test('soft delete keeps the history; purge removes it', () => {
  const w = build({ revisionWindowMs: 0 });
  const e = w.createEntity('Article', { name: 'A', doc: 'v1' });
  w.setDoc(e.id, 'v2');
  w.deleteEntity(e.id);
  assert.equal(w.listDocRevisions(e.id).revisions.length, 2, 'the trash keeps what it holds');
  w.restoreEntity(e.id);
  assert.equal(w.listDocRevisions(e.id).revisions.length, 2);
  w.deleteEntity(e.id, { hard: true });
  assert.equal(w.store.listDocRevisions(e.id, Object.keys(w.getTable('Article').fields)[0]).length, 0);
  assert.equal(w.store.listDocRevisions(e.id, w.descriptionField(w.getTable('Article')).id).length, 0, 'purged with the row');
});

test('the log is bounded per document and per-document only', () => {
  const w = build({ revisionWindowMs: 0 });
  const e = w.createEntity('Article', { name: 'A', doc: 'v0' });
  for (let i = 1; i <= 210; i++) w.setDoc(e.id, `v${i}`);
  const list = w.listDocRevisions(e.id, null, { limit: 1000 }).revisions;
  assert.equal(list.length, 200);
  assert.equal(w.getDocRevision(e.id, null, list[0].seq).text, 'v210');
  assert.equal(list.length, w.listDocRevisions(e.id, null, { limit: 1000 }).revisions.length);
});

test('the document ontology names the revision verbs', async () => {
  const { ONTOLOGY } = await import('../src/engine.js');
  const doc = ONTOLOGY.constituents.find((t) => t.key === 'document');
  for (const verb of ['listDocRevisions', 'getDocRevision', 'restoreDocRevision']) {
    assert.ok(doc.api.includes(verb), `document ontology lacks ${verb}`);
  }
});

// ---------------- doors ----------------

test('HTTP: list, read and restore a revision', async () => {
  const w = build({ revisionWindowMs: 0 });
  const e = w.createEntity('Article', { name: 'A', doc: 'v1' });
  w.setDoc(e.id, 'v2');
  w.setDoc(e.id, 'spec 1', 'Spec');
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const api = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json() };
    };
    const list = await api('GET', `/api/entities/${e.id}/doc/revisions`);
    assert.equal(list.status, 200);
    assert.equal(list.body.field, 'Description');
    assert.equal(list.body.revisions.length, 2);
    assert.deepEqual(Object.keys(list.body.revisions[0]).sort(), ['actor', 'at', 'len', 'seq']);
    const spec = await api('GET', `/api/entities/${e.id}/doc/revisions?field=Spec&limit=5`);
    assert.equal(spec.body.revisions.length, 1);
    const oldest = list.body.revisions[1].seq;
    const one = await api('GET', `/api/entities/${e.id}/doc/revisions/${oldest}`);
    assert.equal(one.body.text, 'v1');
    assert.equal(one.body.seq, oldest);
    const restored = await api('POST', `/api/entities/${e.id}/doc/revisions/${oldest}/restore`, { field: 'Description' });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.field, 'Description');
    assert.equal(w.getDoc(e.id), 'v1');
    const missing = await api('GET', `/api/entities/${e.id}/doc/revisions/999999`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('MCP: weave_doc_revisions lists or reads; weave_doc_restore writes back', () => {
  const w = build({ revisionWindowMs: 0 });
  const e = w.createEntity('Article', { name: 'A', doc: 'v1' });
  w.setDoc(e.id, 'v2');
  for (const name of ['weave_doc_revisions', 'weave_doc_restore']) assert.ok(TOOLS.find((t) => t.name === name), name);
  const list = dispatchTool(w, 'weave_doc_revisions', { entity: e.id });
  assert.equal(list.revisions.length, 2);
  const oldest = list.revisions[1].seq;
  assert.equal(dispatchTool(w, 'weave_doc_revisions', { entity: e.id, seq: oldest }).text, 'v1');
  const r = dispatchTool(w, 'weave_doc_restore', { entity: e.id, seq: oldest });
  assert.equal(r.seq, oldest);
  assert.equal(w.getDoc(e.id), 'v1');
});

test('CLI: weave doc-revisions and weave doc-restore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-rev-cli-'));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  const data = join(dir, 'ws.db');
  const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8', env: { ...process.env, WEAVE_ACTOR: 'kyle' } });
  cli('space', 'create', 'Wiki');
  cli('db', 'create', 'Wiki', 'Article');
  cli('create', 'Article', 'A', '--doc', 'v1');
  // A second actor inside the window is a second revision (no coalescing).
  execFileSync('node', [BIN, 'doc', 'set', 'Article#1', '--content', 'v2', '--data', data], { encoding: 'utf8', env: { ...process.env, WEAVE_ACTOR: 'agent' } });
  const list = JSON.parse(cli('doc-revisions', 'Article#1'));
  assert.equal(list.field, 'Description');
  assert.equal(list.revisions.length, 2);
  const oldest = list.revisions[1].seq;
  const one = JSON.parse(cli('doc-revisions', 'Article#1', '--seq', String(oldest)));
  assert.equal(one.text, 'v1');
  const r = JSON.parse(cli('doc-restore', 'Article#1', '--seq', String(oldest)));
  assert.equal(r.seq, oldest);
  assert.equal(cli('doc', 'get', 'Article#1').trim(), 'v1');
  const limited = JSON.parse(cli('doc-revisions', 'Article#1', '--limit', '1'));
  assert.equal(limited.revisions.length, 1);
});
