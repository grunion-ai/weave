import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { ROOT } from './lib/source.mjs';
import { bootAndStop } from './lib/serve-fixture.mjs';
import { GUIDES, FIELD_DOCS, applyHandbook, handbookDrift, handbookHash, syncHandbook } from '../src/handbook.js';

const BIN = join(ROOT, 'bin', 'weave.js');
const dir = mkdtempSync(join(tmpdir(), 'weave-handbook-sync-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const guideRow = (w, name) => w.findEntity(w.getTable('Handbook/Guide'), name);
const fieldRow = (w, name) => w.findEntity(w.getTable('Handbook/Fields'), name);

function olderBuild(w = new Weave()) {
  applyHandbook(w);
  const guide = guideRow(w, 'Making a workspace your own');
  w.setDoc(guide.id, '# Making a workspace your own\n\nThe old page, before ranges, fill and paste.');
  w.setDoc(fieldRow(w, 'number').id, '# number\n\nstale');
  w.deleteEntity(guideRow(w, 'Chip and card anatomy').id, { hard: true });
  w.state.meta.handbookSync = 'an-older-build';
  w.save();
  return w;
}

test('a workspace seeded from an older build carries the current text for every page after sync', () => {
  const w = olderBuild();
  const r = syncHandbook(w);
  assert.equal(r.applied, true);
  assert.equal(r.created, 1, 'the guide the newer build added is created');
  assert.equal(r.updated, 2, 'the two stale pages are updated');
  for (const g of GUIDES) {
    const row = guideRow(w, g.name);
    assert.ok(row, `no '${g.name}' guide after sync`);
    const read = w.readEntity(row.id);
    assert.equal(read.doc, g.doc, `'${g.name}' still carries old text`);
    assert.equal(read.fields.Audience, g.audience);
    assert.equal(read.fields.Order, g.order);
  }
  for (const f of FIELD_DOCS) {
    const read = w.readEntity(fieldRow(w, f.name).id);
    assert.equal(read.doc, f.doc, `the '${f.name}' page still carries old text`);
    assert.equal(read.fields.Kind, f.kind);
  }
  assert.equal(w.state.meta.handbookSync, handbookHash(), 'a whole pass stamps the build');
});

test('a sync keeps each page id, so inbound [[…]] links survive', () => {
  const w = olderBuild();
  const before = guideRow(w, 'Making a workspace your own').id;
  syncHandbook(w);
  assert.equal(guideRow(w, 'Making a workspace your own').id, before);
});

test('the rows a sync writes name the sync, and the workspace keeps its actor', () => {
  const w = olderBuild();
  w.actor = 'kyle';
  syncHandbook(w);
  assert.equal(w.getEntity(guideRow(w, 'Making a workspace your own').id).modifiedBy, 'handbook-sync');
  assert.equal(w.actor, 'kyle', 'a sync on the serving instance left its actor behind');
});

test('a guide row a person wrote is untouched by sync, and nothing is deleted', () => {
  const w = olderBuild();
  const guides = w.getTable('Handbook/Guide');
  const mine = w.createEntity(guides, { name: 'How our team files bugs', values: { Audience: 'Human', Order: 99 }, doc: '# How our team files bugs\n\nOurs.' });
  const snapshot = JSON.stringify(w.readEntity(mine.id));
  const count = (t) => w.query(t, { limit: 500 }).total;
  const fieldsBefore = count('Handbook/Fields');

  syncHandbook(w, { force: true });

  assert.equal(JSON.stringify(w.readEntity(mine.id)), snapshot, 'sync rewrote a guide it does not generate');
  assert.equal(count('Handbook/Guide'), GUIDES.length + 1, 'sync removed or duplicated a guide');
  assert.equal(count('Handbook/Fields'), fieldsBefore);
  assert.equal(w.listTrash?.('Handbook/Guide')?.length ?? 0, 0, 'sync sent a guide to the trash');
});

test('handbook check reports drift, and none straight after sync', () => {
  const w = olderBuild();
  const drift = handbookDrift(w);
  assert.deepEqual(drift.missing, ['Handbook/Guide: Chip and card anatomy']);
  assert.deepEqual(drift.stale.sort(), ['Handbook/Fields: number', 'Handbook/Guide: Making a workspace your own']);
  syncHandbook(w);
  assert.deepEqual(handbookDrift(w), { missing: [], stale: [] });
  const bare = new Weave();
  assert.equal(handbookDrift(bare).missing.length, GUIDES.length + FIELD_DOCS.length);
  assert.ok(!bare.findTable('Handbook/Guide'), 'check created a table');
});

test('the build hash makes boot one write per build, not one per boot', () => {
  const w = olderBuild();
  assert.equal(syncHandbook(w).applied, true);
  const row = guideRow(w, 'Polymorphic relations');
  w.setDoc(row.id, '# Polymorphic relations\n\nedited by hand on :4400');
  assert.equal(syncHandbook(w).applied, false);
  assert.match(w.getDoc(row.id), /edited by hand/);
  w.state.meta.handbookSync = 'the-previous-build';
  assert.equal(syncHandbook(w).applied, true);
  assert.equal(w.getDoc(row.id), GUIDES.find((g) => g.name === 'Polymorphic relations').doc);
});

test('a sync with nothing to change touches no row', () => {
  const w = new Weave();
  applyHandbook(w);
  const stamps = () => w.query('Handbook/Guide', { limit: 200 }).items.map((e) => w.getEntity(e.id).updatedAt).join();
  const before = stamps();
  const r = syncHandbook(w, { force: true });
  assert.deepEqual([r.created, r.updated], [0, 0]);
  assert.equal(stamps(), before, 'a no-op sync bumped updatedAt on a page');
});

test('the hash follows the generated content', () => {
  assert.match(handbookHash(), /^[0-9a-f]{16,}$/);
  assert.equal(handbookHash(), handbookHash());
});

function staleDb(path) {
  const w = olderBuild(new Weave({ path }));
  w.store.close?.();
  return path;
}
const cli = (...args) => execFileSync('node', [BIN, ...args], { encoding: 'utf8' });

test('weave handbook check exits 1 on drift; handbook sync clears it', () => {
  const data = staleDb(join(dir, 'cli-weave.db'));
  assert.throws(() => cli('handbook', 'check', '--data', data), (err) => err.status === 1 && /Making a workspace your own/.test(err.stdout));
  const out = JSON.parse(cli('handbook', 'sync', '--data', data));
  assert.equal(out.applied, true);
  assert.equal(out.created, 1);
  assert.equal(out.updated, 2);
  JSON.parse(cli('handbook', 'check', '--data', data));
  assert.throws(() => cli('handbook', 'sync'), /explicit --data/, 'handbook must never guess its target');
});

test('serve brings an existing docs workspace up to the current Handbook on boot', async () => {
  const sub = mkdtempSync(join(dir, 'boot-'));
  const docs = staleDb(join(sub, 'weave.db'));
  const child = spawn('node', [BIN, 'serve', '--port', '0', '--data', join(sub, 'ws.db')], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WEAVE_UPDATE_CHECK: 'off' } });
  const log = await bootAndStop(child);
  assert.match(log, /Handbook sync: 1 created, 2 updated/);
  const w = new Weave({ path: docs });
  try {
    assert.deepEqual(handbookDrift(w), { missing: [], stale: [] });
    assert.equal(w.state.meta.handbookSync, handbookHash());
  } finally {
    w.store.close?.();
  }
});
