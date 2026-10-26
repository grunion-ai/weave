import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { APP } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';

function seeded(path = null) {
  const w = new Weave(path ? { path } : undefined);
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Contract' });
  return w;
}

test('storageStats: live entity count + attached file bytes (in-memory)', () => {
  const w = seeded();
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
  const dir = tempDir('weave-stats-');
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


test('the strip pins to the sidebar bottom and style.css dresses it', () => {
  assert.ok(!APP.includes("class: 'nav-stats'"), 'renderNav builds no rows and size line (Feature #333)');
  assert.ok(APP.includes("class: 'nav-pinned'"), 'the strip that pins New space, System and the identity panel to the bottom');
  assert.ok(APP.includes("$('#sidebar').append(el('div', { class: 'nav-pinned' }"), 'the strip is a sidebar sibling after #nav, not a foot child');
  const CSS = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  const rule = CSS.match(/\.nav-pinned\s*{([^}]*)}/)?.[1] ?? '';
  assert.ok(/margin-top:\s*auto/.test(rule), 'pushed to the bottom when the nav is short');
  const sidebar = CSS.match(/#sidebar\s*{([^}]*)}/)?.[1] ?? '';
  assert.match(sidebar, /padding:\s*\d+px\s+\d+px\s+0\s*;/, "no bottom padding, so the strip reaches the sidebar's outer bottom edge");
  assert.match(CSS.match(/#nav\s*{([^}]*)}/)?.[1] ?? '', /flex:\s*1/, 'the list takes the room between the head and the strip (Issue #957)');
});
