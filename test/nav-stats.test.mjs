import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

/* The nav stats strip: the sidebar's foot shows how big this workspace is —
   entity count plus what it weighs on disk. The engine answers with
   storageStats(), /api/health carries it, app.js renders it. */

function seeded(path = null) {
  const w = new Weave(path ? { path } : undefined);
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Contract' });
  return w;
}

test('storageStats: live entity count + attached file bytes (in-memory)', () => {
  const w = seeded();
  // System-mirror rows (workspace, spaces, tables) are live entities too —
  // count relative to the seeded baseline.
  const base = w.storageStats().entities;
  w.createEntity('Contract', { name: 'Acme' });
  const gone = w.createEntity('Contract', { name: 'Trashed' });
  w.deleteEntity(gone.id);
  const kept = w.createEntity('Contract', { name: 'Beta' });
  w.attachFile(kept.id, { name: 'msa.pdf', bytes: Buffer.from('x'.repeat(1000)) });
  const stats = w.storageStats();
  assert.equal(stats.entities, base + 2, 'trashed rows do not count');
  assert.ok(stats.sizeBytes >= 1000, 'attachment bytes count');
});

test('storageStats: file-backed workspace counts the .db on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-stats-'));
  try {
    const w = seeded(join(dir, 'ws.db'));
    w.createEntity('Contract', { name: 'Acme' });
    const stats = w.storageStats();
    assert.ok(stats.sizeBytes > 4096, 'the sqlite file itself is in the total');
    assert.equal(typeof w.store.sizeBytes(), 'number');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('/api/health carries entities + sizeBytes for the scoped workspace', async () => {
  const w = seeded();
  w.createEntity('Contract', { name: 'Acme' });
  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
    const h = await res.json();
    assert.equal(h.entities, w.storageStats().entities);
    assert.equal(typeof h.sizeBytes, 'number');
  } finally { server.close(); }
});

const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('fmtSize speaks GB and TB, never MB', () => {
  assert.doesNotThrow(() => new Function(APP), 'public/app.js does not parse');
  const start = APP.indexOf('function fmtSize(');
  assert.ok(start > -1, 'app.js defines fmtSize');
  const fmtSize = new Function(`${APP.slice(start, APP.indexOf('\n}', start) + 2)}; return fmtSize;`)();
  assert.equal(fmtSize(0), '0.00 GB');
  assert.equal(fmtSize(52_400_000), '0.05 GB');
  assert.equal(fmtSize(2_400_000_000), '2.4 GB');
  assert.equal(fmtSize(250_000_000_000), '250 GB');
  assert.equal(fmtSize(1_500_000_000_000), '1.50 TB');
});

test('the strip renders in the nav foot and style.css dresses it', () => {
  assert.ok(APP.includes("class: 'nav-stats'"), 'renderNav builds the strip');
  const CSS = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.ok(/\.nav-stats\s*{/.test(CSS), 'style.css has a .nav-stats rule');
});
