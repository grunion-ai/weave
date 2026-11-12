import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, get } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { cloudStore } from '../src/backup.js';
import { ROOT } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';

const BIN = join(ROOT, 'bin', 'weave.js');
const MiB = 1024 * 1024;
const MAGIC = Buffer.from('WVBK1\0');
const BLOCK = randomBytes(MiB);
const BUDGET = 64 * MiB;

async function* archiveBytes(size) {
  yield MAGIC;
  for (let left = size - MAGIC.length; left > 0; left -= BLOCK.length) yield left >= BLOCK.length ? BLOCK : BLOCK.subarray(0, left);
}

async function digest(chunks) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of chunks) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest('hex') };
}

function streamingBucket() {
  const objects = new Map();
  const uploads = new Map();
  const requests = [];
  let made = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://bucket');
    const key = url.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    const uploadId = url.searchParams.get('uploadId');
    const upload = uploadId ? uploads.get(uploadId) : null;
    const part = createHash('sha256');
    const small = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (req.method !== 'PUT') { small.push(chunk); continue; }
      part.update(chunk);
      upload?.hash.update(chunk);
    }
    requests.push({ method: req.method, key, query: Object.fromEntries(url.searchParams), bytes });
    const sha256 = part.digest('hex');
    if (!String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 ')) { res.writeHead(403); return res.end(); }
    if (uploadId && !upload) { res.writeHead(404); return res.end('<Error><Code>NoSuchUpload</Code></Error>'); }
    if (req.method === 'PUT' && req.headers['x-amz-content-sha256'] !== sha256) { res.writeHead(400); return res.end('<Error><Code>XAmzContentSHA256Mismatch</Code></Error>'); }
    const at = new Date(Date.parse('2026-11-11T04:00:00Z') + requests.length * 1000).toISOString();
    if (req.method === 'POST' && url.searchParams.has('uploads')) {
      const id = `upload-${++made}`;
      uploads.set(id, { key, hash: createHash('sha256'), bytes: 0, next: 1 });
      return res.end(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (req.method === 'PUT' && upload) {
      if (Number(url.searchParams.get('partNumber')) !== upload.next) { res.writeHead(400); return res.end('<Error><Code>InvalidPartOrder</Code></Error>'); }
      upload.next += 1;
      upload.bytes += bytes;
      res.writeHead(200, { ETag: `"part-${url.searchParams.get('partNumber')}"` });
      return res.end();
    }
    if (req.method === 'POST' && upload) {
      objects.set(key, { bytes: upload.bytes, sha256: upload.hash.digest('hex'), at });
      uploads.delete(uploadId);
      return res.end('<CompleteMultipartUploadResult/>');
    }
    if (req.method === 'DELETE' && upload) { uploads.delete(uploadId); res.writeHead(204); return res.end(); }
    if (req.method === 'PUT') { objects.set(key, { bytes, sha256, at }); return res.end(); }
    if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
    if (url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const rows = [...objects].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
      return res.end(`<ListBucketResult>${rows.map(([k, o]) => `<Contents><Key>${k}</Key><LastModified>${o.at}</LastModified><Size>${o.bytes}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    const o = objects.get(key);
    if (!o) { res.writeHead(404); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
    res.writeHead(200, { 'Content-Length': o.bytes });
    await pipeline(Readable.from(archiveBytes(o.bytes)), res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, objects, uploads, requests, endpoint: `http://127.0.0.1:${server.address().port}` })));
}

const PROBE = `data:text/javascript,${encodeURIComponent(`
let base = 0, peak = 0, sweep = null;
const look = () => { const now = process.memoryUsage.rss(); if (now > peak) peak = now; };
setInterval(look, 2).unref();
process.on('message', (m) => {
  if (m?.rss === 'start') { globalThis.gc(); base = peak = process.memoryUsage.rss(); clearInterval(sweep); sweep = setInterval(() => globalThis.gc(), 20); process.send({ rss: 'started', base }); }
  if (m?.rss === 'read') { clearInterval(sweep); look(); process.send({ rss: 'read', base, peak }); }
});
`)}`;

async function serving(endpoint) {
  const dir = tempDir('weave-backup-stream-');
  const db = join(dir, 'alpha.db');
  const w = new Weave({ path: db });
  const { token } = w.createAccount({ name: 'nightly', role: 'editor' });
  w.store.close();
  const docs = new Weave({ path: join(dir, 'weave.db') });
  docs.state.meta.name = 'weave';
  docs.save();
  docs.store.close();
  const env = {
    ...process.env, HOME: join(dir, 'home'), WEAVE_UPDATE_CHECK: 'off', WEAVE_KEYSTORE: join(dir, 'keys', 'keystore.json'),
    WEAVE_BACKUP_BUCKET: 'vault', WEAVE_BACKUP_ENDPOINT: endpoint, WEAVE_BACKUP_KEY_ID: 'k', WEAVE_BACKUP_SECRET: 's', WEAVE_BACKUP_REGION: 'auto',
  };
  for (const k of ['WEAVE_DEFER_MIGRATIONS', 'WEAVE_BACKUP_DEST', 'WEAVE_BACKUP_QUOTA_BYTES', 'WEAVE_BACKUP_PART_BYTES', 'WEAVE_AUTO_UPDATE', 'WEAVE_DATA', 'WEAVE_HOST', 'WEAVE_ORIGIN', 'PORT']) delete env[k];
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
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Bearer ${token}` };
  return {
    log: () => log,
    push: (name, size) => fetch(`${base}/api/backups/${name}`, { method: 'PUT', duplex: 'half', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: ReadableStream.from(archiveBytes(size)) }),
    pull: (name) => fetch(`${base}/api/backups/${name}`, { headers: auth }),
    start: () => ask('start', 'started'),
    grown: async () => { const { base: before, peak } = await ask('read', 'read'); return peak - before; },
    stop: async () => { if (child.exitCode === null && child.signalCode === null) child.disconnect(); await exited; },
  };
}

test('a 200 MiB archive push and download through weave serve keep its RSS within 64 MiB of where it started (Issue #1636)', async () => {
  const size = 200 * MiB;
  const want = await digest(archiveBytes(size));
  const bucket = await streamingBucket();
  const s = await serving(bucket.endpoint);
  try {
    const warm = await s.push('warm.tar.enc', 20 * MiB);
    assert.equal(warm.status, 201, await warm.clone().text());
    assert.equal((await digest((await s.pull('warm.tar.enc')).body)).bytes, 20 * MiB);

    await s.start();
    const put = await s.push('big.tar.enc', size);
    assert.equal(put.status, 201, await put.clone().text());
    const pushed = await s.grown();
    assert.ok(pushed < BUDGET, `the push grew the server by ${(pushed / MiB).toFixed(1)} MiB for a ${size / MiB} MiB archive`);
    const stored = [...bucket.objects].find(([k]) => k.endsWith('/big.tar.enc'))?.[1];
    assert.equal(stored?.bytes, size, 'the bucket holds the whole archive');
    assert.equal(stored.sha256, want.sha256, 'the bucket holds the archive byte for byte');
    const sent = bucket.requests.filter((q) => q.method === 'PUT' && q.key.endsWith('/big.tar.enc'));
    assert.ok(sent.length > 1 && sent.every((q) => q.bytes <= 8 * MiB), `the archive went to the bucket a part at a time, not whole: ${sent.map((q) => q.bytes)}`);

    await s.start();
    const got = await s.pull('big.tar.enc');
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-length'), String(size));
    assert.deepEqual(await digest(got.body), want, 'the download is the archive byte for byte');
    const pulled = await s.grown();
    assert.ok(pulled < BUDGET, `the download grew the server by ${(pulled / MiB).toFixed(1)} MiB for a ${size / MiB} MiB archive`);
  } finally {
    await s.stop();
    bucket.server.closeAllConnections();
    bucket.server.close();
  }
});

function memoryBucket() {
  const objects = new Map();
  const uploads = new Map();
  const requests = [];
  const aborted = [];
  let made = 0;
  let clock = Date.parse('2026-11-11T04:00:00Z');
  const fetchImpl = async (url, { method = 'GET', body } = {}) => {
    const u = new URL(url);
    const key = u.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    const bytes = body == null ? Buffer.alloc(0) : Buffer.from(body);
    requests.push({ method, key, query: Object.fromEntries(u.searchParams), bytes: bytes.length });
    const uploadId = u.searchParams.get('uploadId');
    if (method === 'POST' && u.searchParams.has('uploads')) {
      const id = `upload-${++made}`;
      uploads.set(id, []);
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (uploadId && !uploads.has(uploadId)) return new Response('<Error><Code>NoSuchUpload</Code></Error>', { status: 404 });
    if (method === 'PUT' && uploadId) { uploads.get(uploadId).push(bytes); return new Response('', { headers: { ETag: `"part-${u.searchParams.get('partNumber')}"` } }); }
    if (method === 'POST' && uploadId) { objects.set(key, { body: Buffer.concat(uploads.get(uploadId)), at: new Date(clock += 1000).toISOString() }); uploads.delete(uploadId); return new Response('<CompleteMultipartUploadResult/>'); }
    if (method === 'DELETE' && uploadId) { uploads.delete(uploadId); aborted.push(uploadId); return new Response(null, { status: 204 }); }
    if (method === 'PUT') { objects.set(key, { body: bytes, at: new Date(clock += 1000).toISOString() }); return new Response(''); }
    if (method === 'DELETE') { objects.delete(key); return new Response(null, { status: 204 }); }
    if (u.searchParams.get('list-type') === '2') {
      const prefix = u.searchParams.get('prefix') ?? '';
      const rows = [...objects].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
      return new Response(`<ListBucketResult>${rows.map(([k, o]) => `<Contents><Key>${k}</Key><LastModified>${o.at}</LastModified><Size>${o.body.length}</Size></Contents>`).join('')}</ListBucketResult>`);
    }
    const o = objects.get(key);
    return o ? new Response(o.body, { headers: { 'Content-Length': String(o.body.length) } }) : new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
  };
  return { objects, uploads, requests, aborted, fetchImpl };
}

const storeEnv = (extra = {}) => ({ WEAVE_BACKUP_BUCKET: 'vault', WEAVE_BACKUP_ENDPOINT: 'http://s3.test', WEAVE_BACKUP_KEY_ID: 'k', WEAVE_BACKUP_SECRET: 's', WEAVE_BACKUP_PART_BYTES: String(5 * MiB), ...extra });
const whole = async (size) => Buffer.concat(await Readable.from(archiveBytes(size)).toArray());

test('the cloud store takes an archive as a stream and hands it to the bucket a part at a time (Issue #1636)', async () => {
  const bucket = memoryBucket();
  const store = cloudStore({ env: storeEnv(), fetchImpl: bucket.fetchImpl });
  const size = 12 * MiB + 17;
  const r = await store.put('acct', 'big.tar.enc', Readable.from(archiveBytes(size)));
  assert.deepEqual(r, { name: 'big.tar.enc', bytes: size, used: size, quota: 5 * 1024 ** 3, kept: 1, pruned: [] });
  const parts = bucket.requests.filter((q) => q.method === 'PUT');
  assert.deepEqual(parts.map((q) => [Number(q.query.partNumber), q.bytes]), [[1, 5 * MiB], [2, 5 * MiB], [3, 2 * MiB + 17]]);
  assert.ok(bucket.objects.get('acct/big.tar.enc').body.equals(await whole(size)), 'the bucket reassembles the archive byte for byte');
  assert.equal(bucket.uploads.size, 0, 'no upload was left open');

  const small = await store.put('acct', 'small.tar.enc', Readable.from(archiveBytes(MiB)));
  assert.equal(small.bytes, MiB);
  assert.equal(bucket.requests.filter((q) => q.key === 'acct/small.tar.enc' && q.method === 'POST').length, 0, 'an archive inside one part goes up as one PUT');
  assert.ok(bucket.objects.get('acct/small.tar.enc').body.equals(await whole(MiB)));

  const opened = await store.open('acct', 'big.tar.enc');
  assert.equal(opened.bytes, size);
  assert.equal(typeof opened.body.pipe, 'function', 'the archive comes back as a stream');
  assert.ok(Buffer.concat(await opened.body.toArray()).equals(await whole(size)));
  await assert.rejects(store.open('acct', 'nope.tar.enc'), (err) => err.code === 'not-found');
});

test('a streamed archive past the quota aborts its upload, and one that is not sealed or is empty never reaches the bucket (Issue #1636)', async () => {
  const bucket = memoryBucket();
  const store = cloudStore({ env: storeEnv({ WEAVE_BACKUP_QUOTA_BYTES: String(7 * MiB) }), fetchImpl: bucket.fetchImpl });
  await store.put('acct', 'kept.tar.enc', Readable.from(archiveBytes(MiB)));
  await assert.rejects(store.put('acct', 'huge.tar.enc', Readable.from(archiveBytes(12 * MiB))), (err) => err.code === 'too-large' && /quota of 7340032 bytes/.test(err.message));
  assert.equal(bucket.aborted.length, 1, 'the upload past the quota was aborted');
  assert.equal(bucket.uploads.size, 0, 'and left no parts behind');
  assert.deepEqual([...bucket.objects.keys()], ['acct/kept.tar.enc'], 'a refused archive lands nothing and evicts nothing');

  const seen = bucket.requests.length;
  await assert.rejects(store.put('acct', 'plain.tar', Readable.from([Buffer.from('ustar'), Buffer.alloc(MiB)])), /encrypted archives only/);
  await assert.rejects(store.put('acct', 'short.tar.enc', Readable.from([Buffer.from('WVB')])), /encrypted archives only/);
  await assert.rejects(store.put('acct', 'empty.tar.enc', Readable.from([])), /empty/);
  assert.equal(bucket.requests.length, seen, 'the bucket never saw a refused archive');
});

test('the backup doors stream: a chunked push past the quota answers 413 and leaves nothing, and a download carries its length (Issue #1636)', async () => {
  const bucket = memoryBucket();
  const w = new Weave();
  const { token } = w.createAccount({ name: 'alice', role: 'editor' });
  const { server, port } = await startServer(w, { port: 0, cloudBackups: cloudStore({ env: storeEnv({ WEAVE_BACKUP_QUOTA_BYTES: String(6 * MiB) }), fetchImpl: bucket.fetchImpl }) });
  const base = `http://127.0.0.1:${port}`;
  const auth = { Authorization: `Bearer ${token}` };
  try {
    const over = await fetch(`${base}/api/backups/over.tar.enc`, { method: 'PUT', duplex: 'half', headers: auth, body: ReadableStream.from(archiveBytes(12 * MiB)) });
    assert.equal(over.status, 413, await over.clone().text());
    assert.equal(bucket.objects.size, 0);
    assert.equal(bucket.uploads.size, 0);

    const put = await fetch(`${base}/api/backups/fits.tar.enc`, { method: 'PUT', duplex: 'half', headers: auth, body: ReadableStream.from(archiveBytes(5 * MiB + 1)) });
    assert.equal(put.status, 201, await put.clone().text());
    assert.equal((await put.json()).bytes, 5 * MiB + 1);
    const got = await fetch(`${base}/api/backups/fits.tar.enc`, { headers: auth });
    assert.equal(got.status, 200);
    assert.equal(got.headers.get('content-length'), String(5 * MiB + 1));
    assert.equal(got.headers.get('content-type'), 'application/octet-stream');
    assert.ok(Buffer.from(await got.arrayBuffer()).equals(await whole(5 * MiB + 1)));
    assert.equal((await fetch(`${base}/api/backups/missing.tar.enc`, { headers: auth })).status, 404);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

const raw = (port, path) => new Promise((resolve, reject) => {
  get({ host: '127.0.0.1', port, path }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
  }).on('error', reject);
});

test('a JSON reply answers as before now that the server also pipes streams: same status, same headers, and its Content-Length instead of chunks (Issue #1636, Issue #1645)', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.createEntity('Ops/Task', { name: 'Ship the stream' });
  const { server, port } = await startServer(w, { port: 0 });
  try {
    const r = await raw(port, '/api/tables/Task/entities');
    assert.equal(r.status, 200);
    const { date, etag, connection, 'keep-alive': alive, 'x-weave-schema-version': schema, ...rest } = r.headers;
    assert.deepEqual(rest, {
      'content-type': 'application/json', 'cache-control': 'private, no-cache', vary: 'Accept-Encoding',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'content-length': String(Buffer.byteLength(r.body)),
    });
    assert.match(etag, /^W\/"[\w-]{22}"$/);
    assert.match(schema, /^[0-9a-f]+$/);
    assert.ok(date && connection && alive);
    assert.match(r.body, /"Ship the stream"/);
    assert.doesNotThrow(() => JSON.parse(r.body));
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
