import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

async function withHub(seed, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-settings-delete-'));
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
    const tokens = seed(main);
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

test('the hub list marks a workspace deletable only for a caller who may manage workspaces (Feature #297)', async () => {
  await withHub((main) => ({
    architect: main.createAccount({ name: 'arch', role: 'architect' }).token,
    editor: main.createAccount({ name: 'ed', role: 'editor' }).token,
  }), async ({ api, tokens }) => {
    const deletable = async (token) => (await api('GET', '/api/workspaces', { token })).data.find((w) => w.name === 'scratch')?.deletable;
    assert.equal(await deletable(tokens.architect), true, 'an architect on the hub root may delete a sibling');
    assert.equal(await deletable(tokens.editor), false, 'an editor on the hub root may not');
    assert.equal((await api('DELETE', '/api/workspaces/scratch', { token: tokens.editor })).status, 403, 'and the route refuses the editor too');
  });
});
