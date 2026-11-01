import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { tempDir } from './lib/temp.mjs';

async function withHub(seed, fn) {
  const dir = tempDir('weave-settings-delete-');
  const main = new Weave({ path: join(dir, 'main.db') });
  main.state.meta.name = 'main';
  main.save();
  const { server } = await startServer(main, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path, { token, body } = {}) => {
    const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };
  try {
    assert.equal((await api('POST', '/api/workspaces', { body: { name: 'scratch' } })).status, 201);
    const scratch = new Weave({ path: join(dir, 'scratch.db') });
    const tokens = seed(main, scratch);
    scratch.store.close?.();
    await fn({ api, tokens });
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the trash says whether the caller may purge it: an open workspace may (Feature #295)', async () => {
  await withHub(() => ({}), async ({ api }) => {
    const res = await api('GET', '/api/trash');
    assert.equal(res.status, 200);
    assert.equal(res.data.purge, true, 'nobody signs in here, so anyone may purge');
  });
});

test('an editor and an architect may purge the trash; an observer and an anonymous caller may not (Feature #295)', async () => {
  await withHub((main) => ({
    architect: main.createAccount({ name: 'arch', role: 'architect' }).token,
    editor: main.createAccount({ name: 'ed', role: 'editor' }).token,
    observer: main.createAccount({ name: 'eye', role: 'observer' }).token,
  }), async ({ api, tokens }) => {
    const purge = async (token) => (await api('GET', '/api/trash', { token })).data.purge;
    assert.equal(await purge(tokens.architect), true);
    assert.equal(await purge(tokens.editor), true);
    assert.equal(await purge(tokens.observer), false, 'an observer reads the trash and cannot purge it');
    assert.equal(await purge(null), false, 'a workspace with accounts gives an anonymous caller read only');
  });
});

test('the hub list marks deletion using the target workspace local role (Feature #297)', async () => {
  await withHub((main, scratch) => ({
    architect: scratch.createAccount({ name: 'arch', role: 'architect' }).token,
    editor: scratch.createAccount({ name: 'ed', role: 'editor' }).token,
    other: main.createAccount({ name: 'other', role: 'architect' }).token,
  }), async ({ api, tokens }) => {
    const deletable = async token => (await api('GET', '/w/scratch/api/workspaces', { token })).data.find(w => w.name === 'scratch')?.deletable;
    assert.equal(await deletable(tokens.architect), true);
    assert.equal(await deletable(tokens.editor), false);
    assert.equal((await api('DELETE', '/w/scratch/api/workspaces/scratch', { token: tokens.editor })).status, 403);
    assert.equal((await api('DELETE', '/w/scratch/api/workspaces/scratch', { token: tokens.other })).status, 401);
  });
});
