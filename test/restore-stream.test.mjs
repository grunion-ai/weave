import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { backup, restore, tarWriter, cloudStore } from '../src/backup.js';
import { ROOT } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';

const BIN = join(ROOT, 'bin', 'weave.js');
const MiB = 1024 * 1024;
const PASS = 'correct horse battery staple';

const scratch = tempDir('weave-restore-stream-');
const ENV = { ...process.env, HOME: join(scratch, 'home'), WEAVE_UPDATE_CHECK: 'off', WEAVE_KEYSTORE: join(scratch, 'keys', 'keystore.json') };
for (const k of ['WEAVE_DEFER_MIGRATIONS', 'WEAVE_BACKUP_DEST', 'WEAVE_BACKUP_PASSPHRASE', 'WEAVE_KEYSTORE_PASSPHRASE', 'WEAVE_BACKUP_QUOTA_BYTES', 'WEAVE_AUTO_UPDATE', 'WEAVE_DATA', 'WEAVE_HOST', 'WEAVE_ORIGIN', 'PORT']) delete ENV[k];

async function sealedArchive(mib) {
  const dir = tempDir('weave-restore-stream-data-');
  const w = new Weave({ path: join(dir, 'alpha.db') });
  w.state.meta.name = 'alpha';
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  const blob = randomBytes(Math.min(mib, 10) * MiB);
  for (let i = 0; i * 10 < mib; i++) w.attachFile(w.createEntity('Ops/Task', { name: `Task ${i}` }).id, { name: `part-${i}.bin`, mime: 'application/octet-stream', bytes: blob });
  w.store.close();
  const r = await backup({ dataDir: dir, out: tempDir('weave-restore-stream-out-'), env: { WEAVE_BACKUP_PASSPHRASE: PASS } });
  return { path: r.path, archive: r.archive, bytes: r.bytes, blobs: existsSync(join(dir, 'files')) ? readdirSync(join(dir, 'files')).sort() : [] };
}

let archives = null;
const shared = async () => (archives ??= { small: await sealedArchive(0), big: await sealedArchive(200) });

const PEAK = `data:text/javascript,${encodeURIComponent(`
import { writeSync } from 'node:fs';
process.on('exit', () => writeSync(2, '\\npeak-rss-kib=' + process.resourceUsage().maxRSS + '\\n'));
`)}`;

const restoreCli = (archive, data) => new Promise((resolve, reject) => {
  execFile(process.execPath, ['--import', PEAK, BIN, 'restore', '--from', archive, '--data', data], { cwd: ROOT, env: { ...ENV, WEAVE_BACKUP_PASSPHRASE: PASS } }, (err, stdout, stderr) => {
    if (err) return reject(new Error(`weave restore failed: ${err.message}\n${stderr}`));
    resolve({ stdout, peak: Number(stderr.match(/peak-rss-kib=(\d+)/)?.[1]) * 1024 });
  });
});

test('weave restore of a 200 MiB sealed archive peaks less than the archive itself above a one-record restore, so it never holds the archive in memory (Issue #1663)', async () => {
  const { small, big } = await shared();
  assert.ok(big.bytes > 200 * MiB, `the archive is ${big.bytes} bytes`);
  const floor = await restoreCli(small.path, tempDir('weave-restore-stream-small-'));
  const into = tempDir('weave-restore-stream-big-');
  const r = await restoreCli(big.path, into);
  assert.match(r.stdout, /alpha\.db/);
  assert.deepEqual(readdirSync(join(into, 'files')).sort(), big.blobs, 'every blob landed');
  const grown = r.peak - floor.peak;
  assert.ok(grown < big.bytes, `restoring ${(big.bytes / MiB).toFixed(0)} MiB peaked ${(grown / MiB).toFixed(1)} MiB above a one-record restore`);
});

function fileBucket() {
  const objects = new Map();
  const server = createServer(async (req, res) => {
    req.resume();
    const url = new URL(req.url, 'http://bucket');
    const key = url.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    if (!String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 ')) { res.writeHead(403); return res.end(); }
    const path = objects.get(key);
    if (req.method !== 'GET' || !path) { res.writeHead(404); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
    res.writeHead(200, { 'Content-Length': statSync(path).size });
    await pipeline(createReadStream(path), res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, objects, endpoint: `http://127.0.0.1:${server.address().port}` })));
}

const PROBE = `data:text/javascript,${encodeURIComponent(`
let base = 0, peak = 0;
const look = () => { const now = process.memoryUsage.rss(); if (now > peak) peak = now; };
setInterval(look, 2).unref();
process.on('message', (m) => {
  if (m?.rss === 'start') { globalThis.gc?.(); base = peak = process.memoryUsage.rss(); process.send({ rss: 'started', base }); }
  if (m?.rss === 'read') { look(); process.send({ rss: 'read', base, peak }); }
});
`)}`;

async function serving(endpoint) {
  const dir = tempDir('weave-restore-stream-hub-');
  const db = join(dir, 'home.db');
  const w = new Weave({ path: db });
  w.state.meta.name = 'home';
  w.save();
  const alice = w.createAccount({ name: 'alice', role: 'architect' });
  w.store.close();
  const docs = new Weave({ path: join(dir, 'weave.db') });
  docs.state.meta.name = 'weave';
  docs.save();
  docs.store.close();
  const env = { ...ENV, WEAVE_BACKUP_BUCKET: 'vault', WEAVE_BACKUP_ENDPOINT: endpoint, WEAVE_BACKUP_KEY_ID: 'k', WEAVE_BACKUP_SECRET: 's', WEAVE_BACKUP_REGION: 'auto' };
  const child = spawn(process.execPath, ['--expose-gc', '--import', PROBE, BIN, 'serve', '--port', '0', '--host', '127.0.0.1', '--data', db], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const { port } = await new Promise((resolve, reject) => {
    child.on('message', (m) => { if (m?.weave === 'listening') resolve(m); });
    exited.then((code) => reject(new Error(`weave serve exited (${code}) before it listened:\n${log}`)));
  });
  const ask = (rss, answer) => new Promise((resolve) => {
    const on = (m) => { if (m?.rss === answer) { child.off('message', on); resolve(m); } };
    child.on('message', on);
    child.send({ rss });
  });
  return {
    dir, alice,
    migrate: (body) => fetch(`http://127.0.0.1:${port}/api/workspaces`, { method: 'POST', headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    start: () => ask('start', 'started'),
    grown: async () => { const { base, peak } = await ask('read', 'read'); return peak - base; },
    log: () => log,
    stop: async () => { if (child.exitCode === null && child.signalCode === null) child.disconnect(); await exited; },
  };
}

test('migrating a 200 MiB archive into a cloud workspace grows weave serve by less than the archive itself, so it never holds the archive in memory (Issue #1663)', async () => {
  const { small: warm, big } = await shared();
  const bucket = await fileBucket();
  const s = await serving(bucket.endpoint);
  try {
    bucket.objects.set(`${s.alice.account.id}/${warm.archive}`, warm.path);
    bucket.objects.set(`${s.alice.account.id}/big-${big.archive}`, big.path);
    const first = await s.migrate({ name: 'warm', from: `backup:${warm.archive}`, key: PASS });
    assert.equal(first.status, 201, await first.clone().text());

    await s.start();
    const r = await s.migrate({ name: 'moved', from: `backup:big-${big.archive}`, key: PASS });
    assert.equal(r.status, 201, await r.clone().text());
    const grown = await s.grown();
    assert.ok(grown < big.bytes, `migrating ${(big.bytes / MiB).toFixed(0)} MiB grew the server by ${(grown / MiB).toFixed(1)} MiB`);
    assert.ok((await r.json()).entities >= big.blobs.length);
    assert.ok(existsSync(join(s.dir, 'moved.db')));
    const moved = new Set(readdirSync(join(s.dir, 'files')));
    assert.deepEqual(big.blobs.filter((id) => !moved.has(id)), [], 'every attachment moved with the workspace');
  } finally {
    await s.stop();
    bucket.server.closeAllConnections();
    bucket.server.close();
  }
});

function crafted(extra, { listed = true } = {}) {
  const dir = tempDir('weave-restore-crafted-');
  const db = join(dir, 'alpha.db');
  const w = new Weave({ path: db });
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.createEntity('Ops/Task', { name: 'original' });
  w.store.close();
  const out = join(dir, 'crafted.tar');
  const t = tarWriter(out);
  const entries = [t.add({ name: 'alpha.db', path: db })];
  for (const e of extra) {
    const digest = t.add(e);
    if (listed) entries.push(digest);
  }
  t.add({ name: 'manifest.json', data: Buffer.from(JSON.stringify({ format: 'weave-backup/1', weave: 'crafted', entries })) });
  t.close();
  return out;
}

test('restore lands only what weave backup writes: a -wal, a -shm or any other entry refuses the archive and lands nothing (Issue #1724)', async () => {
  for (const name of ['alpha.db-wal', 'alpha.db-shm', 'keystore.key', 'notes.txt', 'files/nested/blob', 'files/.hidden']) {
    const target = tempDir('weave-restore-crafted-into-');
    await assert.rejects(restore({ source: crafted([{ name, data: Buffer.from('crafted bytes') }]), dataDir: target, env: {} }),
      (err) => err.code === 'invalid' && err.message.includes(`carries ${name}, which weave backup never writes`), name);
    assert.deepEqual(readdirSync(target), [], `nothing landed beside ${name}`);
  }
  const twice = tempDir('weave-restore-crafted-into-');
  await assert.rejects(restore({ source: crafted([{ name: 'alpha.db', data: Buffer.from('a second alpha.db') }]), dataDir: twice, env: {} }), /carries alpha\.db twice/);
  assert.deepEqual(readdirSync(twice), []);
  const unlisted = tempDir('weave-restore-crafted-into-');
  await assert.rejects(restore({ source: crafted([{ name: 'files/extra', data: Buffer.from('not in the manifest') }], { listed: false }), dataDir: unlisted, env: {} }), /carries files\/extra, which its manifest does not list/);
  assert.deepEqual(readdirSync(unlisted), []);
  const plain = tempDir('weave-restore-crafted-into-');
  const r = await restore({ source: crafted([{ name: 'files/kept', data: Buffer.from('a listed blob') }]), dataDir: plain, env: {} });
  assert.deepEqual([...r.landed].sort(), ['alpha.db', 'files/kept']);
  assert.equal(r.verified, 2);
});

test('a bucket body that arrives encoded opens with no length, since fetch hands back the decoded bytes (Issue #1663)', async () => {
  const env = { WEAVE_BACKUP_BUCKET: 'vault', WEAVE_BACKUP_ENDPOINT: 'http://s3.test', WEAVE_BACKUP_KEY_ID: 'k', WEAVE_BACKUP_SECRET: 's' };
  const answer = (headers) => async () => new Response(Buffer.from('sealed bytes'), { headers });
  const plain = await cloudStore({ env, fetchImpl: answer({ 'Content-Length': '12' }) }).open('acct', 'a.tar.enc');
  assert.equal(plain.bytes, 12);
  const encoded = await cloudStore({ env, fetchImpl: answer({ 'Content-Length': '9', 'Content-Encoding': 'gzip' }) }).open('acct', 'a.tar.enc');
  assert.equal(encoded.bytes, null, 'the compressed length would cut the decoded download short');
  assert.equal(Buffer.concat(await encoded.body.toArray()).toString(), 'sealed bytes');
});
