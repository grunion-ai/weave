import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { GUIDES } from '../src/handbook.js';
import { backup, cloudStore } from '../src/backup.js';
import { tempDir } from './lib/temp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');
const run = promisify(execFile);
const tmp = (label) => tempDir(`weave-migrate-${label}-`);
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
  return { objects, fetchImpl };
}

async function cloud() {
  const dir = tmp('cloud');
  const root = new Weave({ path: join(dir, 'home.db') });
  root.state.meta.name = 'home';
  root.save();
  const alice = root.createAccount({ name: 'alice', role: 'architect' });
  const bob = root.createAccount({ name: 'bob', role: 'architect' });
  const bucket = memoryBucket();
  const env = { WEAVE_BACKUP_BUCKET: 'vault', WEAVE_BACKUP_ENDPOINT: 'http://s3.test', WEAVE_BACKUP_KEY_ID: 'k', WEAVE_BACKUP_SECRET: 's' };
  const { server, port } = await startServer(root, { port: 0, cloudBackups: cloudStore({ env, fetchImpl: bucket.fetchImpl }) });
  const base = `http://127.0.0.1:${port}`;
  const post = (token, body) => fetch(`${base}/api/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const workspaces = async () => (await (await fetch(`${base}/api/workspaces`, { headers: { Authorization: `Bearer ${alice.token}` } })).json()).map((x) => x.name);
  return { dir, root, alice, bob, port, base, post, workspaces, close: () => server.close() };
}

async function storedArchive(c, identity = null) {
  const src = tmp('src');
  const w = new Weave({ path: join(src, 'alpha.db') });
  w.state.meta.name = 'alpha';
  if (identity) {
    const account = w.createAccount({ name: 'archive-person', role: 'observer' }).account;
    w.redeemIdentityInvite(w.linkIdentity(account.id, { issuer: identity.issuer }).code, identity);
  }
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  const t = w.createEntity('Ops/Task', { name: 'Move to the cloud' });
  w.createEntity('Ops/Task', { name: 'Keep self-hosting' });
  const blob = Buffer.from('%PDF-1.4 the attachment survives the move\n'.repeat(20));
  const file = w.attachFile(t.id, { name: 'plan.pdf', mime: 'application/pdf', bytes: blob });
  w.store.close?.();
  const r = await backup({ dataDir: src, out: tmp('out'), dest: `weave://127.0.0.1:${c.port}/alice`, env: { WEAVE_BACKUP_TOKEN: c.alice.token, WEAVE_BACKUP_PASSPHRASE: PASS } });
  return { archive: r.archive, src, blob, file };
}

const filesUnder = (dir) => readdirSync(dir, { recursive: true }).map((f) => join(dir, f)).filter((f) => statSync(f).isFile());

test('POST /api/workspaces with from backup:<archive> creates the workspace from it, attachments included, and keeps no key', async () => {
  const c = await cloud();
  try {
    const { archive, blob, file } = await storedArchive(c);
    const r = await c.post(c.alice.token, { name: 'acme', from: `backup:${archive}`, key: PASS });
    assert.equal(r.status, 201);
    const made = await r.json();
    assert.equal(made.name, 'acme');
    assert.equal(made.from, `backup:${archive}`);
    assert.ok(made.entities >= 2);
    assert.equal((await c.workspaces()).includes('acme'), false, 'the source token does not grant membership on the imported workspace');
    const opened = await fetch(`${c.base}/w/acme/api/schema`, { headers: { Authorization: `Bearer ${made.owner.token}` } });
    assert.equal(opened.status, 200);
    const acme = new Weave({ path: join(c.dir, 'acme.db') });
    assert.equal(acme.state.meta.name, 'acme');
    assert.deepEqual(acme.listEntities(acme.findTable('Ops/Task').id).map((e) => acme.entityName(e)).sort(), ['Keep self-hosting', 'Move to the cloud']);
    acme.store.close?.();
    assert.ok(readFileSync(join(c.dir, 'files', file.id)).equals(blob), 'the attachment moved with the workspace');
    const needle = Buffer.from(PASS);
    for (const f of filesUnder(c.dir)) assert.ok(!readFileSync(f).includes(needle), `${f} holds the key`);
    assert.ok(!readdirSync(tmpdir()).some((d) => d.startsWith('weave-migrate-') && existsSync(join(tmpdir(), d, 'data'))), 'the scratch directory is gone');

    const again = await c.post(c.alice.token, { name: 'acme-two', from: `backup:${archive}`, key: PASS });
    assert.equal(again.status, 409);
    assert.match((await again.json()).error, /already here as 'acme'/);
    assert.ok(!(await c.workspaces()).includes('acme-two'));
  } finally { c.close(); }
});

test('a wrong key is refused and creates nothing', async () => {
  const c = await cloud();
  try {
    const { archive } = await storedArchive(c);
    const r = await c.post(c.alice.token, { name: 'acme', from: `backup:${archive}`, key: 'not the passphrase' });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.match(body.error, /wrong passphrase/);
    assert.doesNotMatch(body.error, /not the passphrase/, 'the refusal does not echo the key');
    assert.ok(!(await c.workspaces()).includes('acme'));
    assert.ok(!existsSync(join(c.dir, 'acme.db')));
    assert.equal((await c.post(c.alice.token, { name: 'acme', from: `backup:${archive}` })).status, 400, 'no key at all');
    assert.equal((await c.post(c.alice.token, { name: 'acme', from: 'elsewhere', key: PASS })).status, 400);
  } finally { c.close(); }
});

test('another account\'s archive is not found, and nothing is created', async () => {
  const c = await cloud();
  try {
    const { archive } = await storedArchive(c);
    const r = await c.post(c.bob.token, { name: 'stolen', from: `backup:${archive}`, key: PASS });
    assert.equal(r.status, 404);
    assert.ok(!(await c.workspaces()).includes('stolen'));
    assert.equal((await fetch(`${c.base}/api/workspaces`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'anon', from: `backup:${archive}`, key: PASS }) })).status, 401);
  } finally { c.close(); }
});

test('weave workspace migrate is the CLI form, and the Handbook page covers it', async () => {
  const c = await cloud();
  try {
    await storedArchive(c);
    const env = { ...process.env, WEAVE_BACKUP_TOKEN: c.alice.token, WEAVE_BACKUP_PASSPHRASE: PASS };
    const { stdout } = await run('node', [BIN, 'workspace', 'migrate', '--from', `weave://127.0.0.1:${c.port}/alice`, '--name', 'from-cli', '--data', tmp('cli')], { env });
    assert.match(stdout, /Migrated weave-backup-.* into the workspace from-cli .*\(\d+ entities\)/);
    assert.ok(existsSync(join(c.dir, 'from-cli.db')));
    const { stdout: help } = await run('node', [BIN, 'help'], { env });
    assert.match(help, /workspace migrate --from weave:\/\//);
  } finally { c.close(); }
  const g = GUIDES.find((x) => x.name === 'Backup to weave cloud');
  for (const topic of ['## Migrate to a cloud workspace', 'weave workspace migrate', 'backup:<archive>', 'POST /api/workspaces', '409', 'never written down or logged']) {
    assert.ok(g.doc.includes(topic), `the guide never mentions ${topic}`);
  }
});

test('import reuses the caller identity already in the archive and makes it the local owner', async () => {
  const c = await cloud();
  try {
    const identity = { issuer: 'https://identity.test', subject: 'alice' };
    c.root.redeemIdentityInvite(c.root.linkIdentity(c.alice.account.id, { issuer: identity.issuer }).code, identity);
    const { archive } = await storedArchive(c, identity);
    const response = await c.post(c.alice.token, { name: 'recovered', from: `backup:${archive}`, key: PASS });
    assert.equal(response.status, 201);
    const made = await response.json();
    const w = new Weave({ path: join(c.dir, 'recovered.db') });
    assert.equal(w.listAccounts().length, 1);
    assert.equal(w.accountForIdentity(identity).id, made.owner.account.id);
    assert.equal(w.accountForIdentity(identity).role, 'architect');
    w.store.close();
  } finally { c.close(); }
});
