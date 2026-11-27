import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

const engineUrl = new URL('../src/engine.js', import.meta.url).href;

const child = (path, keystorePath, go) => `
  const { Weave } = await import(${JSON.stringify(engineUrl)});
  while (Date.now() < ${go}) await new Promise((r) => setTimeout(r, 1));
  new Weave({ path: ${JSON.stringify(path)}, keystorePath: ${JSON.stringify(keystorePath)} });
`;

function run(code) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (status) => resolve({ status, err }));
  });
}

function liveSystemKinds(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const counts = {};
    for (const { json } of db.prepare('SELECT json FROM tables').all()) {
      const t = JSON.parse(json);
      if (t.system && !t.deletedAt) counts[t.system] = (counts[t.system] ?? 0) + 1;
    }
    return counts;
  } finally { db.close(); }
}

test('two processes constructing one fresh workspace file leave one live table per system kind', { timeout: 240000 }, async () => {
  const dir = tempDir('weave-registry-race-');
  const keystorePath = join(dir, 'keystore.json');
  for (const stagger of [0, 8, 20]) {
    for (let trial = 0; trial < 2; trial++) {
      const path = join(dir, `race-${stagger}-${trial}.db`);
      const go = Date.now() + 1500;
      const [a, b] = await Promise.all([
        run(child(path, keystorePath, go)),
        run(child(path, keystorePath, go + stagger)),
      ]);
      assert.equal(a.status, 0, a.err);
      assert.equal(b.status, 0, b.err);
      const doubled = Object.entries(liveSystemKinds(path)).filter(([, n]) => n > 1);
      assert.deepEqual(doubled, [], `stagger ${stagger} ms trial ${trial}`);
      const w = new Weave({ path, keystorePath });
      assert.deepEqual(w.registryReport().problems, []);
      w.store.close();
    }
  }
});

test('registryReport names a system kind with two live tables', () => {
  const w = new Weave();
  const ws = Object.values(w.state.tables).find((t) => t.system === 'workspaces' && !t.deletedAt);
  const copy = { ...structuredClone(ws), id: crypto.randomUUID() };
  w.state.tables[copy.id] = copy;
  const problems = w.registryReport().problems.filter((p) => p.kind === 'system table');
  assert.deepEqual(problems, [{ kind: 'system table', name: 'workspaces', problem: '2 live tables of this system kind', tables: [ws.id, copy.id] }]);
});

test('registryReport ignores a soft-deleted second system table', () => {
  const w = new Weave();
  const ws = Object.values(w.state.tables).find((t) => t.system === 'workspaces' && !t.deletedAt);
  const copy = { ...structuredClone(ws), id: crypto.randomUUID(), deletedAt: new Date().toISOString() };
  w.state.tables[copy.id] = copy;
  assert.deepEqual(w.registryReport().problems.filter((p) => p.kind === 'system table'), []);
});
