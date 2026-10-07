import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';
import { workspace } from './lib/fixtures.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

const entries = (w) => Object.values(w.state.entities)
  .flatMap((e) => (e.activity ?? []).map((a, i) => ({ ...a, id: `${e.id}:${i}` })));

function oneInstant(w, ts = '2026-09-20T12:00:00.000Z') {
  for (const e of Object.values(w.state.entities)) for (const a of e.activity ?? []) a.ts = ts;
}

test('every entry carries a workspace-unique seq, minted in commit order', () => {
  const { w, t } = workspace();
  const a = w.createEntity(t, { name: 'a' });
  const b = w.createEntity(t, { name: 'b' });
  w.updateEntity(a.id, { Name: 'a2' });
  w.addComment(b.id, { text: 'hi' });

  const all = entries(w);
  for (const x of all) assert.equal(typeof x.seq, 'number', `a ${x.kind} entry carries a seq`);
  const seqs = all.map((x) => x.seq);
  assert.equal(new Set(seqs).size, seqs.length, 'no two entries in a workspace share a seq');

  const seqOf = (entityId, i) => w.state.entities[entityId].activity[i].seq;
  assert.ok(seqOf(a.id, 0) < seqOf(b.id, 0), "a's creation precedes b's");
  assert.ok(seqOf(b.id, 0) < seqOf(a.id, 1), "b's creation precedes a's rename");
  assert.ok(seqOf(a.id, 1) < seqOf(b.id, 1), "a's rename precedes b's comment");
  assert.equal(w.state.meta.activitySeq, Math.max(...seqs), 'the counter is on the workspace');
});

test('the feed carries seq and orders by it, not by the entity uuid', () => {
  const { w, t } = workspace();
  const made = Array.from({ length: 6 }, (_, i) => w.createEntity(t, { name: `t${i}` }).id);
  oneInstant(w);
  const feed = w.activityFeed({ tableRef: 'Ops/Ticket' }).items;
  for (const r of feed) assert.equal(typeof r.seq, 'number', 'the feed row exposes seq');
  assert.deepEqual(feed.map((r) => r.entityId), [...made].reverse(),
    'newest first is the last commit, whatever the uuids sort like');
  assert.deepEqual(feed.map((r) => r.seq), [...feed.map((r) => r.seq)].sort((x, y) => y - x),
    'the feed is descending seq');
});

test('within one entity the tenth entry reads as newer than the ninth', () => {
  const { w, t } = workspace();
  const e = w.createEntity(t, { name: 'busy' });
  for (let i = 0; i < 11; i++) w.addComment(e.id, { text: `c${i}` });
  oneInstant(w);
  const ids = w.activityFeed({ entityId: e.id }).items.map((r) => r.id);
  assert.deepEqual(ids, Array.from({ length: 12 }, (_, i) => `${e.id}:${11 - i}`),
    'the index is a number, not a string to compare');
});

test('a clock that steps backwards does not reorder history', () => {
  const { w, t } = workspace();
  const e = w.createEntity(t, { name: 'a' });
  w.addComment(e.id, { text: 'first' });
  w.addComment(e.id, { text: 'second' });
  w.state.entities[e.id].activity[2].ts = '2020-01-01T00:00:00.000Z';
  assert.deepEqual(w.activityFeed({ entityId: e.id }).items.map((r) => r.id),
    [`${e.id}:2`, `${e.id}:1`, `${e.id}:0`], 'commit order survives a lying clock');
});

test('deleted and restored are stamped the same way as everything else', () => {
  const { w, t } = workspace({ actor: 'agent:zoe' });
  const e = w.createEntity(t, { name: 'a' });
  w.deleteEntity(e.id);
  w.restoreEntity(e.id);
  const acts = w.state.entities[e.id].activity;
  assert.deepEqual(acts.map((a) => a.kind), ['created', 'deleted', 'restored']);
  for (const a of acts) {
    assert.equal(typeof a.seq, 'number', `${a.kind} carries a seq`);
    assert.equal(a.actor, 'agent:zoe', `${a.kind} names its actor`);
  }
  assert.ok(acts[0].seq < acts[1].seq && acts[1].seq < acts[2].seq, 'in lifecycle order');
  assert.equal(acts[1].ts, w.state.entities[e.id].activity[1].ts, 'the delete keeps its own ts');
});

test('a folded document session keeps the seq it started with', () => {
  const { w, t } = workspace();
  const e = w.createEntity(t, { name: 'a' });
  w.setDoc(e.id, 'one');
  const first = w.state.entities[e.id].activity.at(-1);
  assert.equal(first.kind, 'doc-updated');
  const was = first.seq;
  assert.equal(typeof was, 'number');
  w.setDoc(e.id, 'one two');
  const folded = w.state.entities[e.id].activity.at(-1);
  assert.equal(folded.kind, 'doc-updated');
  assert.equal(w.state.entities[e.id].activity.filter((a) => a.kind === 'doc-updated').length, 1);
  assert.equal(folded.seq, was, 'one event, one seq — the fold does not re-stamp it');
});

test('a second person editing the same document gets an entry of their own (Issue #680)', () => {
  const { w, t } = workspace({ actor: 'alice' });
  const e = w.createEntity(t, { name: 'The plan' });
  w.setDoc(e.id, 'First draft of the plan.');
  w.actor = 'bob';
  w.setDoc(e.id, 'First draft of the plan.\nRisks: none yet.');
  w.actor = 'agent';
  w.setDoc(e.id, 'A plan.');

  const docs = w.state.entities[e.id].activity.filter((a) => a.kind === 'doc-updated');
  assert.deepEqual(docs.map((a) => a.actor), ['alice', 'bob', 'agent'], 'three authors inside the window, three entries');
  assert.deepEqual(docs.map((a) => a.detail.prevLength), [0, 24, 41], 'each entry starts from what the one before it left');
  assert.deepEqual(docs.map((a) => a.detail.length), [24, 41, 7]);
  assert.deepEqual(docs.map((a) => a.detail.delta), [24, 17, -34], 'and the delta describes that author\'s edit alone');
  assert.equal(docs[1].detail.preview, 'Risks: none yet.', 'as does the preview');
  assert.ok(docs[0].seq < docs[1].seq && docs[1].seq < docs[2].seq, 'in the order they were written');
  assert.equal(w.listDocRevisions(e.id).revisions.map((r) => r.actor).join(','), 'agent,bob,alice',
    'and the two logs agree on who wrote what');
});

test('the same person coming back inside the window still folds into their own entry (Issue #32)', () => {
  const { w, t } = workspace({ actor: 'alice' });
  const e = w.createEntity(t, { name: 'The plan' });
  w.setDoc(e.id, 'one');
  w.actor = 'bob';
  w.setDoc(e.id, 'one two');
  w.actor = 'alice';
  w.setDoc(e.id, 'one two three');
  w.setDoc(e.id, 'one two three four');

  const docs = w.state.entities[e.id].activity.filter((a) => a.kind === 'doc-updated');
  assert.deepEqual(docs.map((a) => a.actor), ['alice', 'bob', 'alice'], 'alice returning is a third entry, not a fourth');
  assert.equal(docs[2].detail.prevLength, 7, 'her second session spans from what bob left');
  assert.equal(docs[2].detail.length, 18);
});

test('a workspace written before seq existed is numbered once, in its stored order', () => {
  const { w, t } = workspace();
  const a = w.createEntity(t, { name: 'a' });
  const b = w.createEntity(t, { name: 'b' });
  w.addComment(a.id, { text: 'x' });
  w.addComment(b.id, { text: 'y' });

  const dump = JSON.parse(JSON.stringify(w.exportJSON({ blobs: false })));
  delete dump.meta.activitySeq;
  for (const e of Object.values(dump.entities)) for (const x of e.activity ?? []) delete x.seq;

  const w2 = new Weave();
  w2.importJSON(dump);
  const all = entries(w2);
  for (const x of all) assert.equal(typeof x.seq, 'number', 'the backfill reaches every entry');
  assert.equal(new Set(all.map((x) => x.seq)).size, all.length, 'and hands out no duplicates');
  for (const e of Object.values(w2.state.entities)) {
    const s = (e.activity ?? []).map((x) => x.seq);
    assert.deepEqual(s, [...s].sort((x, y) => x - y), 'an entity keeps its stored order');
  }
  assert.equal(w2.state.meta.activitySeq, Math.max(...all.map((x) => x.seq)));

  const before = entries(w2).map((x) => x.seq);
  w2.importJSON(w2.exportJSON({ blobs: false }));
  assert.deepEqual(entries(w2).map((x) => x.seq), before, 'a second open does not renumber');

  w2.addComment(b.id, { text: 'z' });
  assert.ok(w2.state.entities[b.id].activity.at(-1).seq > Math.max(...before),
    'the counter carries on past the backfilled entries');
});

test('an entry a pre-seq writer appended is numbered on the next open', () => {
  const { w, t } = workspace();
  const a = w.createEntity(t, { name: 'a' });
  const dump = JSON.parse(JSON.stringify(w.exportJSON({ blobs: false })));
  const before = dump.entities[a.id].activity[0].seq;
  dump.entities[a.id].activity.push({ ts: '2026-09-20T21:00:06.178Z', kind: 'comment-added', detail: {}, actor: 'cli' });

  const w2 = new Weave();
  w2.importJSON(dump);
  const acts = w2.state.entities[a.id].activity;
  assert.equal(acts[0].seq, before, 'a number already handed out never moves');
  assert.equal(acts[1].seq, w2.state.meta.activitySeq, 'the straggler takes the next one');
  assert.ok(acts[1].seq > acts[0].seq, 'and reads as the later commit');
  for (const x of entries(w2)) assert.equal(typeof x.seq, 'number', 'nothing is left unnumbered');
});

test('until that open, an unnumbered entry still reads as the newest', () => {
  const { w, t } = workspace();
  const e = w.createEntity(t, { name: 'a' });
  w.addComment(e.id, { text: 'one' });
  delete w.state.entities[e.id].activity[1].seq;
  const feed = w.activityFeed({ entityId: e.id }).items;
  assert.deepEqual(feed.map((r) => r.id), [`${e.id}:1`, `${e.id}:0`]);
  assert.equal(feed[0].seq, undefined, 'the row says it has no number rather than inventing one');
});

test('the counter is a write counter, not part of the schema fingerprint', () => {
  const { w, t } = workspace();
  const before = w.schemaVersion();
  const e = w.createEntity(t, { name: 'a' });
  w.addComment(e.id, { text: 'hi' });
  w.deleteEntity(e.id);
  assert.ok(w.state.meta.activitySeq > 0, 'the counter did move');
  assert.equal(w.schemaVersion(), before, 'the structure did not');
});

test('route, MCP and CLI carry seq (parity)', async () => {
  const { w, t } = workspace();
  const e = w.createEntity(t, { name: 'a' });
  w.addComment(e.id, { text: 'hi' });
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const feed = await (await fetch(`${base}/api/activity?entity=${e.id}`)).json();
    assert.equal(typeof feed.items[0].seq, 'number', 'GET /api/activity');
    const one = await (await fetch(`${base}/api/activity/${encodeURIComponent(feed.items[0].id)}`)).json();
    assert.equal(one.seq, feed.items[0].seq, 'GET /api/activity/:id');
    const ent = await (await fetch(`${base}/api/entities/${e.id}`)).json();
    assert.equal(typeof ent.activity[0].seq, 'number', 'GET /api/entities/:id');
  } finally { server.close(); }
  assert.equal(typeof dispatchTool(w, 'weave_activity', { entity: e.id }).items[0].seq, 'number');
  assert.equal(typeof dispatchTool(w, 'weave_get_entity', { entity: e.id }).activity[0].seq, 'number');

  const dir = mkdtempSync(join(tmpdir(), 'weave-actseq-'));
  try {
    const data = join(dir, 'ws.db');
    const fw = new Weave({ path: data });
    fw.createSpace({ name: 'Ops' });
    const ft = fw.createTable({ space: 'Ops', name: 'Ticket' });
    const fe = fw.createEntity(ft, { name: 'a' });
    fw.addComment(fe.id, { text: 'hi' });
    fw.save?.();
    const cli = (...a) => JSON.parse(execFileSync(process.execPath, [BIN, ...a, '--data', data], { encoding: 'utf8', maxBuffer: 64 << 20 }));
    assert.equal(typeof cli('activity', '--entity', fe.id).items[0].seq, 'number', 'weave activity');
    const reopened = new Weave({ path: data });
    const top = Math.max(...entries(reopened).map((x) => x.seq));
    reopened.addComment(fe.id, { text: 'again' });
    assert.ok(reopened.state.entities[fe.id].activity.at(-1).seq > top, 'seq is durable');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
