import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { backup, cloudStore } from '../src/backup.js';
import { tempDir } from './lib/temp.mjs';

const PASS = 'correct horse battery staple';

function memoryBucket() {
  const objects = new Map();
  let clock = Date.parse('2026-10-12T04:00:00Z');
  const fetchImpl = async (url, { method = 'GET', body } = {}) => {
    const u = new URL(url);
    const key = u.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    if (method === 'PUT') { clock += 1000; objects.set(key, { body: Buffer.from(body), at: new Date(clock).toISOString() }); return new Response('', { status: 200 }); }
    if (method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    if (u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') ?? '';
      const rows = [...objects].filter(([k]) => k.startsWith(prefix));
      return new Response(`<ListBucketResult>${rows.map(([k, o]) => `<Contents><Key>${k}</Key><LastModified>${o.at}</LastModified><Size>${o.body.length}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    const o = objects.get(key);
    return o ? new Response(o.body) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
  };
  return { fetchImpl };
}

async function cloud() {
  const dir = tempDir('weave-migrate-ambiguous-cloud-');
  const root = new Weave({ path: join(dir, 'home.db') });
  root.state.meta.name = 'home';
  root.save();
  const alice = root.createAccount({ name: 'alice', role: 'architect' });
  const env = { WEAVE_BACKUP_BUCKET: 'vault', WEAVE_BACKUP_ENDPOINT: 'http://s3.test', WEAVE_BACKUP_KEY_ID: 'k', WEAVE_BACKUP_SECRET: 's' };
  const { server, port } = await startServer(root, { port: 0, cloudBackups: cloudStore({ env, fetchImpl: memoryBucket().fetchImpl }) });
  const base = `http://127.0.0.1:${port}`;
  const post = (body) => fetch(`${base}/api/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { dir, port, alice, post, close: () => server.close() };
}

async function twoWorkspaceArchive(c) {
  const src = tempDir('weave-migrate-ambiguous-src-');
  for (const name of ['alpha', 'beta']) {
    const w = new Weave({ path: join(src, `${name}.db`) });
    w.state.meta.name = name;
    w.createSpace({ name: 'Ops' });
    w.store.close?.();
  }
  const r = await backup({ dataDir: src, out: tempDir('weave-migrate-ambiguous-out-'), dest: `weave://127.0.0.1:${c.port}/alice`, env: { WEAVE_BACKUP_TOKEN: c.alice.token, WEAVE_BACKUP_PASSPHRASE: PASS } });
  return r.archive;
}

test('an archive holding two workspaces is refused with their names until one is chosen', async () => {
  const c = await cloud();
  try {
    const archive = await twoWorkspaceArchive(c);
    const r = await c.post({ name: 'acme', from: `backup:${archive}`, key: PASS });
    assert.equal(r.status, 400);
    const { error } = await r.json();
    assert.match(error, /The archive holds alpha, beta: name the one to migrate as workspace/);
    assert.ok(!existsSync(join(c.dir, 'acme.db')));
  } finally { c.close(); }
});

test('naming one of the two workspaces migrates that one', async () => {
  const c = await cloud();
  try {
    const archive = await twoWorkspaceArchive(c);
    const r = await c.post({ name: 'acme', from: `backup:${archive}`, key: PASS, workspace: 'beta' });
    assert.equal(r.status, 201);
    assert.equal((await r.json()).name, 'acme');
  } finally { c.close(); }
});
