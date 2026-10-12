import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { GUIDES } from '../src/handbook.js';
import { backup, restore, cloud, cloudStore, destKind, scheduleNightly, CLOUD_QUOTA_BYTES, RETAIN, ARCHIVE_PREFIX } from '../src/backup.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');
const run = promisify(execFile);
const tmp = (label) => mkdtempSync(join(tmpdir(), `weave-cloud-${label}-`));
const MAGIC = Buffer.from('WVBK1\0');
const sealed = (n = 64) => Buffer.concat([MAGIC, randomBytes(n)]);
const PASS = 'correct horse battery staple';

function fakeS3() {
  const objects = new Map();
  const requests = [];
  let clock = Date.parse('2026-10-12T04:00:00Z');
  const fetchImpl = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const u = new URL(url);
    requests.push({ method, path: u.pathname });
    if (!String(headers.Authorization ?? '').startsWith('AWS4-HMAC-SHA256 ')) return new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 });
    const [, , ...rest] = u.pathname.split('/');
    const key = rest.map(decodeURIComponent).join('/');
    if (method === 'PUT') {
      clock += 1000;
      objects.set(key, { body: Buffer.from(body), at: new Date(clock).toISOString() });
      return new Response('', { status: 200 });
    }
    if (method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    if (u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') ?? '';
      const rows = [...objects].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
      return new Response(`<?xml version="1.0"?><ListBucketResult>${rows.map(([k, o]) => `<Contents><Key>${k}</Key><LastModified>${o.at}</LastModified><Size>${o.body.length}</Size></Contents>`).join('')}</ListBucketResult>`, { status: 200 });
    }
    const o = objects.get(key);
    return o ? new Response(o.body, { status: 200 }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
  };
  return { objects, requests, fetchImpl };
}

const cloudEnv = (extra = {}) => ({ WEAVE_BACKUP_BUCKET: 'vault', WEAVE_BACKUP_ENDPOINT: 'http://s3.test', WEAVE_BACKUP_KEY_ID: 'k', WEAVE_BACKUP_SECRET: 's', ...extra });

async function cloudServer({ env = cloudEnv(), store } = {}) {
  const bucket = fakeS3();
  const w = new Weave();
  const alice = w.createAccount({ name: 'alice', role: 'editor' });
  const bob = w.createAccount({ name: 'bob', role: 'editor' });
  const cloudBackups = store === undefined ? cloudStore({ env, fetchImpl: bucket.fetchImpl }) : store;
  const { server, port } = await startServer(w, { port: 0, cloudBackups });
  const base = `http://127.0.0.1:${port}`;
  const call = (path, { token, account, method = 'GET', body } = {}) => fetch(base + path, {
    method,
    body,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(account ? { 'X-Weave-Account': account } : {}) },
  });
  return { w, server, port, base, bucket, call, alice, bob, close: () => server.close() };
}

function seedDataDir() {
  const dir = tmp('data');
  const w = new Weave({ path: join(dir, 'alpha.db') });
  w.state.meta.name = 'alpha';
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.createEntity('Ops/Task', { name: 'Ship the cloud backup' });
  w.createEntity('Ops/Task', { name: 'Restore it' });
  w.store.close?.();
  return dir;
}

test('the weave:// parser names the host, the account and an optional archive, over https unless the host is loopback', () => {
  assert.deepEqual(cloud.parse('weave://weave.grunion.ai/alice'), { host: 'weave.grunion.ai', origin: 'https://weave.grunion.ai', account: 'alice', name: null });
  assert.deepEqual(cloud.parse('weave://Weave.Grunion.AI/alice/'), { host: 'weave.grunion.ai', origin: 'https://weave.grunion.ai', account: 'alice', name: null });
  assert.equal(cloud.parse('weave://weave.grunion.ai/alice/weave-backup-all-x.tar.enc').name, 'weave-backup-all-x.tar.enc');
  assert.equal(cloud.parse('weave://weave.grunion.ai/Kyle%20A').account, 'Kyle A');
  assert.equal(cloud.parse('weave://127.0.0.1:4400/alice').origin, 'http://127.0.0.1:4400');
  assert.equal(cloud.parse('weave://localhost:9/alice').origin, 'http://localhost:9');
  for (const bad of ['weave://host', 'weave://host/', 's3://bucket/p', 'weave://host/a/b/c', '']) assert.throws(() => cloud.parse(bad), /weave:\/\/host\/account/);
  assert.throws(() => cloud.parse('weave://h/%E0%A4%A'), /malformed percent-escape/);
  assert.equal(destKind('weave://h/a'), 'weave');
  assert.equal(destKind('s3://b/p'), 's3');
  assert.equal(destKind(null), null);
});

test('the token comes from WEAVE_BACKUP_TOKEN and must be a wv_ account token', () => {
  assert.equal(cloud.token({ WEAVE_BACKUP_TOKEN: ' wv_abc ' }), 'wv_abc');
  assert.throws(() => cloud.token({}), /WEAVE_BACKUP_TOKEN/);
  assert.throws(() => cloud.token({ WEAVE_BACKUP_TOKEN: 'sk_live_nope' }), /wv_/);
});

test('the cloud store is off without WEAVE_BACKUP_BUCKET and the quota defaults to 5 GiB', () => {
  assert.equal(cloudStore({ env: {} }), null);
  assert.equal(CLOUD_QUOTA_BYTES, 5 * 1024 ** 3);
  assert.equal(cloudStore({ env: cloudEnv() }).quota, CLOUD_QUOTA_BYTES);
  assert.equal(cloudStore({ env: cloudEnv({ WEAVE_BACKUP_QUOTA_BYTES: '1000' }) }).quota, 1000);
  assert.equal(cloudStore({ env: cloudEnv({ WEAVE_BACKUP_QUOTA_BYTES: 'lots' }) }).quota, CLOUD_QUOTA_BYTES);
});

test('the store keeps archives under the bucket prefix and the account, ciphertext only, and refuses bad names', async () => {
  const bucket = fakeS3();
  const store = cloudStore({ env: cloudEnv(), fetchImpl: bucket.fetchImpl });
  const body = sealed();
  const r = await store.put('acct-1', 'weave-backup-all-1.tar.enc', body);
  assert.deepEqual(r, { name: 'weave-backup-all-1.tar.enc', bytes: body.length, used: body.length, quota: CLOUD_QUOTA_BYTES, kept: 1, pruned: [] });
  assert.ok(bucket.objects.get('acct-1/weave-backup-all-1.tar.enc').body.equals(body));
  assert.ok((await store.get('acct-1', 'weave-backup-all-1.tar.enc')).equals(body));
  const listed = await store.list('acct-1');
  assert.deepEqual(listed.map((b) => [b.name, b.bytes]), [['weave-backup-all-1.tar.enc', body.length]]);
  assert.match(listed[0].at, /^2026-10-12T/);
  assert.deepEqual(await store.list('acct-2'), []);
  await assert.rejects(store.put('acct-1', 'plain.tar', Buffer.from('ustar plain bytes')), /encrypted archives only/);
  await assert.rejects(store.put('acct-1', '../escape', sealed()), /not an archive name/);
  await assert.rejects(store.put('acct-1', '.hidden', sealed()), /not an archive name/);
  await assert.rejects(store.get('acct-1', 'nope.tar.enc'), (err) => err.code === 'not-found');
});

test('a put prunes past the newest thirty and past the quota, oldest first, and never the archive it just stored', async () => {
  const bucket = fakeS3();
  const store = cloudStore({ env: cloudEnv(), fetchImpl: bucket.fetchImpl });
  for (let i = 1; i <= RETAIN + 2; i++) await store.put('a', `${ARCHIVE_PREFIX}all-${String(i).padStart(2, '0')}.tar.enc`, sealed(8));
  const kept = (await store.list('a')).map((b) => b.name);
  assert.equal(kept.length, RETAIN);
  assert.equal(kept[0], `${ARCHIVE_PREFIX}all-03.tar.enc`);
  assert.equal(kept.at(-1), `${ARCHIVE_PREFIX}all-${RETAIN + 2}.tar.enc`);

  const small = cloudStore({ env: cloudEnv({ WEAVE_BACKUP_QUOTA_BYTES: '150' }), fetchImpl: fakeS3().fetchImpl });
  await small.put('a', 'one.tar.enc', sealed(54));
  await small.put('a', 'two.tar.enc', sealed(54));
  const third = await small.put('a', 'three.tar.enc', sealed(54));
  assert.deepEqual(third.pruned, ['one.tar.enc']);
  assert.equal(third.used, 120);
  assert.ok(third.used <= third.quota);
  await assert.rejects(small.put('a', 'huge.tar.enc', sealed(300)), (err) => err.code === 'too-large' && /quota of 150 bytes/.test(err.message));
  assert.deepEqual((await small.list('a')).map((b) => b.name), ['two.tar.enc', 'three.tar.enc'], 'a refused archive evicts nothing');
});

test('the backup doors refuse anonymous callers, foreign accounts and a deployment with no bucket', async () => {
  const s = await cloudServer();
  try {
    assert.equal((await s.call('/api/backups')).status, 401);
    assert.equal((await s.call('/api/backups', { token: 'wv_not-a-real-token' })).status, 401);
    const wrong = await s.call('/api/backups', { token: s.alice.token, account: 'bob' });
    assert.equal(wrong.status, 403);
    assert.match((await wrong.json()).error, /belongs to the account alice, not bob/);
    assert.equal((await s.call('/api/backups/x.tar.enc', { token: s.alice.token, account: 'bob', method: 'PUT', body: sealed() })).status, 403);

    const put = await s.call('/api/backups/weave-backup-all-1.tar.enc', { token: s.bob.token, account: 'bob', method: 'PUT', body: sealed() });
    assert.equal(put.status, 201);
    assert.equal((await s.call('/api/backups/weave-backup-all-1.tar.enc', { token: s.alice.token })).status, 404, 'alice cannot read bob\'s archive');
    const mine = await (await s.call('/api/backups', { token: s.alice.token, account: 'alice' })).json();
    assert.deepEqual(mine.backups, []);
    assert.equal(mine.account, 'alice');
    const plain = await s.call('/api/backups/plain.tar', { token: s.alice.token, method: 'PUT', body: Buffer.from('not sealed') });
    assert.equal(plain.status, 400);
    assert.equal((await s.call('/api/backups/x.tar.enc', { token: s.alice.token, method: 'DELETE' })).status, 405);
  } finally { s.close(); }

  const bare = await cloudServer({ store: null });
  try {
    const r = await bare.call('/api/backups', { token: bare.alice.token });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'This deployment keeps no backups: it has no bucket configured.');
    assert.equal((await bare.call('/api/backups')).status, 401, 'auth is checked before the bucket');
  } finally { bare.close(); }
});

test('the doors cap an upload at the quota', async () => {
  const s = await cloudServer({ env: cloudEnv({ WEAVE_BACKUP_QUOTA_BYTES: '100' }) });
  try {
    const r = await s.call('/api/backups/big.tar.enc', { token: s.alice.token, method: 'PUT', body: sealed(200) });
    assert.equal(r.status, 413);
    assert.deepEqual(await s.bucket.objects.size, 0);
  } finally { s.close(); }
});

test('backup to weave:// and restore from it round-trip, and the cloud holds ciphertext only', async () => {
  const s = await cloudServer();
  try {
    const dir = seedDataDir();
    const env = { WEAVE_BACKUP_TOKEN: s.alice.token, WEAVE_BACKUP_PASSPHRASE: PASS };
    const dest = `weave://127.0.0.1:${s.port}/alice`;
    const first = await backup({ dataDir: dir, out: tmp('out'), dest, env, now: () => new Date('2026-10-12T04:00:00Z') });
    const second = await backup({ dataDir: dir, out: tmp('out'), dest, env, now: () => new Date('2026-10-13T04:00:00Z') });
    assert.equal(second.uploaded, `${dest}/${second.archive}`);
    assert.deepEqual(second.pruned, []);
    const stored = [...s.bucket.objects.entries()];
    assert.equal(stored.length, 2);
    for (const [key, o] of stored) {
      assert.match(key, new RegExp(`^${s.alice.account.id}/${ARCHIVE_PREFIX}`));
      assert.ok(o.body.subarray(0, MAGIC.length).equals(MAGIC), 'the bucket holds a sealed archive');
      assert.ok(!o.body.includes(Buffer.from('SQLite format 3')), 'no plaintext database reached the cloud');
    }

    const latest = tmp('fresh');
    const r = await restore({ source: dest, dataDir: latest, env });
    assert.equal(r.archive.createdAt, '2026-10-13T04:00:00.000Z', 'with no archive named, restore takes the newest');
    assert.ok(existsSync(join(latest, 'alpha.db')));
    const back = new Weave({ path: join(latest, 'alpha.db') });
    assert.deepEqual(back.listEntities(back.findTable('Ops/Task').id).map((e) => back.entityName(e)).sort(), ['Restore it', 'Ship the cloud backup']);
    back.store.close?.();

    const named = await restore({ source: `${dest}/${first.archive}`, dataDir: tmp('named'), env });
    assert.equal(named.archive.createdAt, '2026-10-12T04:00:00.000Z');

    await assert.rejects(restore({ source: dest, dataDir: tmp('wrong'), env: { ...env, WEAVE_BACKUP_PASSPHRASE: 'wrong' } }), /wrong passphrase/);
    await assert.rejects(restore({ source: `weave://127.0.0.1:${s.port}/bob`, dataDir: tmp('bob'), env }), /403/);
    await assert.rejects(backup({ dataDir: dir, out: tmp('plain'), dest, env: { WEAVE_BACKUP_TOKEN: s.alice.token } }), /encrypted archives only/);
    await assert.rejects(backup({ dataDir: dir, out: tmp('notoken'), dest, env: { WEAVE_BACKUP_PASSPHRASE: PASS } }), /WEAVE_BACKUP_TOKEN/);
    await assert.rejects(restore({ source: `weave://127.0.0.1:${s.port}/bob`, dataDir: tmp('empty'), env: { ...env, WEAVE_BACKUP_TOKEN: s.bob.token } }), /holds no backups yet/);
  } finally { s.close(); }
});

test('the nightly status names the destination kind for /api/health', () => {
  const at = (dest) => scheduleNightly({ run: async () => ({}), dest, now: () => 0, setTimer: () => ({}), log: () => {} });
  assert.equal(at('weave://weave.grunion.ai/alice').status().kind, 'weave');
  assert.equal(at('s3://b/p').status().kind, 's3');
});

test('weave backup --dest weave:// and weave restore --from weave:// work from the CLI', async () => {
  const s = await cloudServer();
  try {
    const dir = seedDataDir();
    const env = { ...process.env, WEAVE_BACKUP_DEST: '', WEAVE_BACKUP_TOKEN: s.alice.token, WEAVE_BACKUP_PASSPHRASE: PASS };
    const dest = `weave://127.0.0.1:${s.port}/alice`;
    const outDir = tmp('cli-out');
    const { stdout } = await run('node', [BIN, 'backup', '--data', dir, '--out', outDir, '--dest', dest], { env });
    assert.match(stdout, new RegExp(`uploaded ${dest.replace(/[.]/g, '\\.')}/${ARCHIVE_PREFIX}`));
    assert.ok(readdirSync(outDir).some((f) => f.endsWith('.tar.enc')));
    const fresh = tmp('cli-fresh');
    const restored = await run('node', [BIN, 'restore', '--from', dest, '--data', fresh], { env });
    assert.match(restored.stdout, /alpha\.db/);
    assert.ok(existsSync(join(fresh, 'alpha.db')));
    const { stdout: help } = await run('node', [BIN, 'help'], { env });
    assert.match(help, /weave:\/\/host\/account/);
    assert.match(help, /restore --from weave:\/\//);
  } finally { s.close(); }
});

test('the cloud-backup Handbook page names the destination, the token, the quota, restore and the doors', () => {
  const g = GUIDES.find((x) => x.name === 'Backup to weave cloud');
  assert.ok(g, 'there is a Backup to weave cloud guide');
  assert.equal(g.audience, 'Human');
  assert.ok(g.doc.startsWith('# Backup to weave cloud\n'));
  for (const topic of ['weave://', 'WEAVE_BACKUP_TOKEN', 'WEAVE_BACKUP_DEST', 'WEAVE_BACKUP_PASSPHRASE', 'WEAVE_BACKUP_BUCKET', 'WEAVE_BACKUP_QUOTA_BYTES', 'WEAVE_BACKUP_KEY_ID', 'WEAVE_BACKUP_SECRET', 'WEAVE_BACKUP_ENDPOINT', 'WEAVE_BACKUP_REGION',
    '5 GiB', 'thirty', 'weave restore --from', 'PUT /api/backups/', 'GET /api/backups', '401', '403', '400', 'ciphertext']) {
    assert.ok(g.doc.includes(topic), `the guide never mentions ${topic}`);
  }
});
