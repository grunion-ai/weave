/* Workspace trash (lifecycle regression gate, Phase 0b).

   A workspace can now be deleted and restored like everything inside it.
   The delete is a hub-level tombstone written into the workspace's own meta
   (so it survives restarts and rescans): the workspace drops out of the hub
   list and the switcher, but its .db file is untouched and its URL still
   answers — the readable-by-id rule structures and entities already follow.
   There is deliberately NO hard delete here: removing a .db file is a human
   filesystem act, not an API call. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

async function withHub(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-wtrash-'));
  const main = new Weave({ path: join(dir, 'main.db') });
  main.state.meta.name = 'main';
  main.save();
  const { server } = await startServer(main, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };
  try {
    await fn({ api, base, dir, main });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a deleted workspace leaves the hub list but keeps its file and its URL', async () => {
  await withHub(async ({ api }) => {
    assert.equal((await api('POST', '/api/workspaces', { name: 'scratch' })).status, 201);
    assert.ok((await api('GET', '/api/workspaces')).data.some((w) => w.name === 'scratch'));

    assert.equal((await api('DELETE', '/api/workspaces/scratch')).status, 200);
    assert.ok(!(await api('GET', '/api/workspaces')).data.some((w) => w.name === 'scratch'),
      'the hub list must hide the trash');

    // The trash is visible when asked for, carrying its deletion time.
    const trashed = (await api('GET', '/api/workspaces?deleted=1')).data.find((w) => w.name === 'scratch');
    assert.ok(trashed?.deletedAt, 'the trashed workspace shows with ?deleted=1');

    // Readable by URL, like a trashed entity is readable by id.
    assert.equal((await api('GET', '/w/scratch/api/health')).status, 200);
  });
});

test('restore brings the workspace back to the list; delete is idempotent', async () => {
  await withHub(async ({ api }) => {
    await api('POST', '/api/workspaces', { name: 'scratch' });
    await api('DELETE', '/api/workspaces/scratch');
    await api('DELETE', '/api/workspaces/scratch'); // idempotent, no error

    assert.equal((await api('POST', '/api/workspaces/scratch/restore')).status, 200);
    assert.ok((await api('GET', '/api/workspaces')).data.some((w) => w.name === 'scratch'));
    // Restoring a live workspace is a no-op, not an error.
    assert.equal((await api('POST', '/api/workspaces/scratch/restore')).status, 200);
  });
});

test('the default workspace cannot be deleted', async () => {
  await withHub(async ({ api }) => {
    const res = await api('DELETE', '/api/workspaces/main');
    assert.equal(res.status, 400);
    assert.match(res.data.error, /default/i);
  });
});

test('the tombstone survives a restart: a fresh hub still hides the workspace', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-wtrash2-'));
  try {
    {
      const main = new Weave({ path: join(dir, 'main.db') });
      main.state.meta.name = 'main';
      main.save();
      const { server } = await startServer(main, { port: 0 });
      const base = `http://127.0.0.1:${server.address().port}`;
      await fetch(`${base}/api/workspaces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"scratch"}' });
      await fetch(`${base}/api/workspaces/scratch`, { method: 'DELETE' });
      server.close();
    }
    {
      const main = new Weave({ path: join(dir, 'main.db') });
      const { server } = await startServer(main, { port: 0 });
      const base = `http://127.0.0.1:${server.address().port}`;
      const list = await (await fetch(`${base}/api/workspaces`)).json();
      assert.ok(!list.some((w) => w.name === 'scratch'), 'the tombstone is in the .db, not the process');
      const trash = await (await fetch(`${base}/api/workspaces?deleted=1`)).json();
      assert.ok(trash.some((w) => w.name === 'scratch' && w.deletedAt));
      server.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a deleted name cannot be re-created while it sits in the trash', async () => {
  await withHub(async ({ api }) => {
    await api('POST', '/api/workspaces', { name: 'scratch' });
    await api('DELETE', '/api/workspaces/scratch');
    const res = await api('POST', '/api/workspaces', { name: 'scratch' });
    assert.equal(res.status, 409);
    assert.match(res.data.error, /trash/i);
  });
});
