import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, statSync, openSync, writeSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Weave, FIELD_TYPES } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { GUIDES } from '../src/handbook.js';
import {
  packTar, readTar, streamTar, tarWriter, classify, heldOpen, encryptFile, decryptFile, isEncrypted, resolvePassphrase,
  backup, restore, signV4, s3, scheduleNightly, nextFireAt, ARCHIVE_PREFIX, RETAIN,
} from '../src/backup.js';
import { tempDir } from './lib/temp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');
const tmp = (label) => tempDir(`weave-backup-${label}-`);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const PASS = 'correct horse battery staple';

function seedDataDir({ passphrase = null } = {}) {
  const dir = tmp('data');
  const keystoreEnv = passphrase ? { WEAVE_KEYSTORE_PASSPHRASE: passphrase } : {};
  const open = (name) => new Weave({ path: join(dir, `${name}.db`), keystorePath: join(dir, 'keystore.json'), keystoreEnv });
  const alpha = open('alpha');
  alpha.state.meta.name = 'alpha';
  alpha.createSpace({ name: 'Ops' });
  alpha.createTable({ space: 'Ops', name: 'Task' });
  const t1 = alpha.createEntity('Ops/Task', { name: 'Write the backup' });
  alpha.createEntity('Ops/Task', { name: 'Restore it' });
  const gone = alpha.createEntity('Ops/Task', { name: 'Trashed' });
  alpha.deleteEntity(gone.id);
  const bytes = Buffer.from('%PDF-1.4 the attachment, byte for byte\n'.repeat(40));
  const kept = alpha.attachFile(t1.id, { name: 'spec.pdf', mime: 'application/pdf', bytes });
  const orphan = alpha.attachFile(t1.id, { name: 'lost.png', mime: 'image/png', bytes: Buffer.from('png') });
  rmSync(join(dir, 'files', orphan.id));
  alpha.setKey('stripe', 'sk_live_hush');
  const beta = open('beta');
  beta.state.meta.name = 'beta';
  beta.createSpace({ name: 'Home' });
  beta.createTable({ space: 'Home', name: 'Note' });
  for (let i = 0; i < 5; i++) beta.createEntity('Home/Note', { name: `Note ${i}` });
  const counts = { alpha: Object.keys(alpha.state.entities).length, beta: Object.keys(beta.state.entities).length };
  const live = { alpha: alpha.storageStats().entities, beta: beta.storageStats().entities };
  return { dir, alpha, beta, counts, live, kept, orphan, gone, bytes, keystoreEnv };
}

const closeAll = (...ws) => ws.forEach((w) => w.store.close?.());

test('the ustar writer and reader round-trip long names, empty files and binary bytes', () => {
  const dir = tmp('tar');
  const long = 'files/' + 'a'.repeat(120) + '/' + 'b'.repeat(90) + '.bin';
  const bin = Buffer.from(Array.from({ length: 1500 }, (_, i) => i % 256));
  writeFileSync(join(dir, 'on-disk.txt'), 'from a file\n');
  const out = join(dir, 'x.tar');
  packTar(out, [
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: long, data: bin },
    { name: 'disk/on-disk.txt', path: join(dir, 'on-disk.txt') },
  ]);
  assert.equal(statSync(out).size % 512, 0, 'a tar is a whole number of blocks');
  const entries = readTar(out);
  assert.deepEqual(entries.map((e) => e.name), ['empty.txt', long, 'disk/on-disk.txt']);
  assert.equal(entries[0].data.length, 0);
  assert.ok(entries[1].data.equals(bin), 'binary bytes survive');
  assert.equal(entries[2].data.toString(), 'from a file\n');
  const listed = execFileSync('tar', ['-tf', out], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(listed, ['empty.txt', long, 'disk/on-disk.txt']);
});

test('a corrupt header is refused rather than read as garbage', () => {
  const dir = tmp('tar-bad');
  const out = join(dir, 'x.tar');
  packTar(out, [{ name: 'a.txt', data: Buffer.from('aaa') }]);
  const buf = readFileSync(out);
  buf[148] = 0x30; buf[149] = 0x30;
  writeFileSync(out, buf);
  assert.throws(() => readTar(out), /checksum/i);
});

test('an encrypted archive is opaque without the passphrase and refuses the wrong one', () => {
  const dir = tmp('enc');
  const plain = join(dir, 'p.tar');
  packTar(plain, [{ name: 'secret.txt', data: Buffer.from('the keystore is in here') }]);
  const enc = join(dir, 'p.tar.enc');
  encryptFile(plain, enc, PASS);
  assert.ok(isEncrypted(enc), 'the envelope announces itself');
  assert.ok(!isEncrypted(plain));
  assert.doesNotMatch(readFileSync(enc, 'latin1'), /the keystore is in here/);
  const back = join(dir, 'back.tar');
  decryptFile(enc, back, PASS);
  assert.ok(readFileSync(back).equals(readFileSync(plain)));
  assert.throws(() => decryptFile(enc, join(dir, 'no.tar'), 'wrong'), /passphrase|auth/i);
  assert.ok(!existsSync(join(dir, 'no.tar')), 'nothing lands when the tag fails');
});

test('the passphrase comes from WEAVE_BACKUP_PASSPHRASE, then the keystore passphrase, then the key file, else none', () => {
  const dir = tmp('pass');
  assert.equal(resolvePassphrase({ env: {}, dataDir: dir }), null, 'no material means a plain tar');
  writeFileSync(join(dir, 'keystore.key'), 'a2V5LW1hdGVyaWFs');
  assert.equal(resolvePassphrase({ env: {}, dataDir: dir }), 'a2V5LW1hdGVyaWFs', 'the key file seals the archive the keystore is in');
  assert.equal(resolvePassphrase({ env: { WEAVE_KEYSTORE_PASSPHRASE: 'ks' }, dataDir: dir }), 'ks');
  assert.equal(resolvePassphrase({ env: { WEAVE_KEYSTORE_PASSPHRASE: 'ks', WEAVE_BACKUP_PASSPHRASE: 'bk' }, dataDir: dir }), 'bk');
  assert.equal(resolvePassphrase({ env: { MY_PASS: 'named', WEAVE_BACKUP_PASSPHRASE: 'bk' }, dataDir: dir, passphraseEnv: 'MY_PASS' }), 'named', '--passphrase-env names the one variable');
  assert.throws(() => resolvePassphrase({ env: {}, dataDir: dir, passphraseEnv: 'MISSING' }), /MISSING/);
});

test('backup → restore → boot: counts equal, attachment identical, orphan reported, keystore.key never leaves', async () => {
  const src = seedDataDir();
  const outDir = tmp('out');
  const r = await backup({ dataDir: src.dir, out: outDir, env: {}, now: () => new Date('2026-09-12T04:00:00Z') });
  closeAll(src.alpha, src.beta);

  assert.equal(r.archive, `${ARCHIVE_PREFIX}all-2026-09-12T04-00-00Z.tar.enc`, 'named for the whole data dir and the instant');
  assert.equal(r.encrypted, true, 'a key file exists, so the archive is sealed with it');
  assert.equal(r.path, join(outDir, r.archive));
  assert.equal(r.bytes, statSync(r.path).size);
  assert.deepEqual(Object.keys(r.workspaces).sort(), ['alpha', 'beta']);
  assert.equal(r.workspaces.alpha.entities, src.live.alpha, 'entity counts match what /api/health reports');
  assert.equal(r.workspaces.beta.entities, src.live.beta);
  assert.equal(r.orphans.count, 1, 'Issue #250: the missing blob is counted, not fatal');
  assert.deepEqual(r.orphans.list, [{ workspace: 'alpha', id: src.orphan.id, name: 'lost.png' }]);
  assert.equal(r.files, 1, 'one blob actually copied');

  const tar = join(outDir, 'peek.tar');
  decryptFile(r.path, tar, readFileSync(join(src.dir, 'keystore.key'), 'utf8').trim());
  const names = readTar(tar).map((e) => e.name);
  assert.ok(names.includes('alpha.db') && names.includes('beta.db') && names.includes('keystore.json'));
  assert.ok(names.includes(`files/${src.kept.id}`));
  assert.ok(!names.includes('keystore.key'), 'keystore.key never leaves the machine');
  assert.ok(!names.some((n) => n.endsWith('-wal') || n.endsWith('-shm')), 'no sidecars — VACUUM INTO folded them');
  assert.equal(names.at(-1), 'manifest.json');
  const manifest = JSON.parse(readTar(tar).at(-1).data.toString());
  assert.equal(manifest.weave, JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  assert.equal(manifest.entries.find((e) => e.name === `files/${src.kept.id}`).sha256, sha256(src.bytes));
  assert.equal(manifest.orphans.count, 1);

  const fresh = tmp('fresh');
  const keyMaterial = readFileSync(join(src.dir, 'keystore.key'), 'utf8').trim();
  const rr = await restore({ source: r.path, dataDir: fresh, env: { WEAVE_BACKUP_PASSPHRASE: keyMaterial } });
  assert.deepEqual(rr.landed.sort(), ['alpha.db', 'beta.db', `files/${src.kept.id}`, 'keystore.json'].sort());
  assert.equal(rr.orphans.count, 1, 'the restore repeats the orphan report so nobody is surprised by a dead link');
  assert.equal(rr.verified, manifest.entries.length, 'every entry was hashed against the manifest');
  for (const db of ['alpha.db', 'beta.db']) {
    assert.ok(!existsSync(join(fresh, `${db}-wal`)), 'no sidecar lands beside a restored database');
    const probe = new DatabaseSync(join(fresh, db), { readOnly: true });
    assert.equal(probe.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    probe.close();
  }

  const alpha = new Weave({ path: join(fresh, 'alpha.db'), keystorePath: join(fresh, 'keystore.json'), keystoreEnv: {} });
  const beta = new Weave({ path: join(fresh, 'beta.db') });
  assert.equal(Object.keys(alpha.state.entities).length, src.counts.alpha, 'alpha: every row, trashed ones included');
  assert.equal(Object.keys(beta.state.entities).length, src.counts.beta);
  assert.equal(alpha.storageStats().entities, src.live.alpha);
  assert.ok(Buffer.from(alpha.readFile(src.kept.id).bytes).equals(src.bytes), 'the attachment is byte-identical');
  assert.throws(() => alpha.readFile(src.orphan.id), /missing/, 'the orphan is still an orphan — the backup cannot invent bytes');
  writeFileSync(join(fresh, 'keystore.key'), keyMaterial, { mode: 0o600 });
  assert.equal(alpha.resolveKey('stripe'), 'sk_live_hush');
  closeAll(alpha, beta);
});

test('with a keystore passphrase and no key file, the same passphrase seals the archive and reopens the keystore', async () => {
  const src = seedDataDir({ passphrase: PASS });
  assert.ok(!existsSync(join(src.dir, 'keystore.key')));
  const outDir = tmp('out2');
  const r = await backup({ dataDir: src.dir, out: outDir, env: { WEAVE_KEYSTORE_PASSPHRASE: PASS } });
  closeAll(src.alpha, src.beta);
  assert.equal(r.encrypted, true);
  const fresh = tmp('fresh2');
  await assert.rejects(restore({ source: r.path, dataDir: fresh, env: { WEAVE_KEYSTORE_PASSPHRASE: 'wrong' } }), /passphrase/i);
  await restore({ source: r.path, dataDir: fresh, env: { WEAVE_KEYSTORE_PASSPHRASE: PASS } });
  const alpha = new Weave({ path: join(fresh, 'alpha.db'), keystorePath: join(fresh, 'keystore.json'), keystoreEnv: { WEAVE_KEYSTORE_PASSPHRASE: PASS } });
  assert.equal(alpha.resolveKey('stripe'), 'sk_live_hush');
  closeAll(alpha);
});

test('a plain tar is written when no key material exists, and one workspace can be picked', async () => {
  const src = seedDataDir();
  rmSync(join(src.dir, 'keystore.key'));
  const outDir = tmp('out3');
  const r = await backup({ dataDir: src.dir, out: outDir, env: {}, workspace: 'beta' });
  closeAll(src.alpha, src.beta);
  assert.equal(r.encrypted, false);
  assert.match(r.archive, /^weave-backup-beta-.*\.tar$/);
  const names = readTar(r.path).map((e) => e.name);
  assert.ok(names.includes('beta.db') && !names.includes('alpha.db'));
  assert.ok(names.includes('keystore.json'), 'the keystore rides along with any workspace — it is shared');
});

test('--out may name the file itself', async () => {
  const src = seedDataDir();
  rmSync(join(src.dir, 'keystore.key'));
  const file = join(tmp('out4'), 'named.tar');
  const r = await backup({ dataDir: src.dir, out: file, env: {} });
  closeAll(src.alpha, src.beta);
  assert.equal(r.path, file);
  assert.ok(existsSync(file));
});

test('a backup taken while a server holds the db open with an uncommitted write is consistent', async () => {
  const src = seedDataDir();
  const writer = new DatabaseSync(join(src.dir, 'alpha.db'));
  writer.exec('BEGIN IMMEDIATE');
  writer.prepare("INSERT INTO entities (id, db_id, public_id, updated_at, json) VALUES ('ghost', 'x', 99, null, '{\"id\":\"ghost\"}')").run();
  assert.ok(existsSync(join(src.dir, 'alpha.db-wal')), 'the WAL is live');
  const r = await backup({ dataDir: src.dir, out: tmp('out5'), env: {} });
  writer.exec('ROLLBACK');
  writer.close();
  closeAll(src.alpha, src.beta);
  const fresh = tmp('fresh5');
  await restore({ source: r.path, dataDir: fresh, env: { WEAVE_BACKUP_PASSPHRASE: readFileSync(join(src.dir, 'keystore.key'), 'utf8').trim() } });
  const probe = new DatabaseSync(join(fresh, 'alpha.db'), { readOnly: true });
  assert.equal(probe.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(probe.prepare("SELECT count(*) AS n FROM entities WHERE id = 'ghost'").get().n, 0, 'the uncommitted row is not in the snapshot');
  assert.equal(probe.prepare('SELECT count(*) AS n FROM entities').get().n, src.counts.alpha, 'every committed row is');
  probe.close();
});

test('restore refuses a target a server holds open, and --force overrides', async () => {
  const src = seedDataDir();
  rmSync(join(src.dir, 'keystore.key'));
  const r = await backup({ dataDir: src.dir, out: tmp('out6'), env: {} });
  await assert.rejects(restore({ source: r.path, dataDir: src.dir, env: {} }), /held open|stop the server/i);
  closeAll(src.alpha, src.beta);
  await assert.rejects(restore({ source: r.path, dataDir: src.dir, env: {} }), /exists|--force/i);
  const rr = await restore({ source: r.path, dataDir: src.dir, env: {}, force: true });
  assert.ok(rr.landed.includes('alpha.db'));
});

test('restore refuses an archive whose bytes do not match its manifest', async () => {
  const src = seedDataDir();
  rmSync(join(src.dir, 'keystore.key'));
  const r = await backup({ dataDir: src.dir, out: tmp('out7'), env: {} });
  closeAll(src.alpha, src.beta);
  const entries = readTar(r.path);
  const i = entries.findIndex((e) => e.name === 'beta.db');
  entries[i].data[100] ^= 0xff;
  packTar(r.path, entries);
  await assert.rejects(restore({ source: r.path, dataDir: tmp('fresh7'), env: {} }), /sha256|mismatch/i);
});

const AWS = { keyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', now: new Date('2013-05-24T00:00:00Z') };

test('the signer reproduces the S3 reference GET example', () => {
  const h = signV4({
    ...AWS, method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt',
    headers: { Range: 'bytes=0-9' }, body: '',
  });
  assert.equal(h['x-amz-date'], '20130524T000000Z');
  assert.equal(h['x-amz-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(h.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
    + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
    + 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('the signer reproduces the S3 reference PUT example', () => {
  const h = signV4({
    ...AWS, method: 'PUT', url: 'https://examplebucket.s3.amazonaws.com/test$file.text',
    headers: { Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' }, body: 'Welcome to Amazon S3.',
  });
  assert.equal(h.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
    + 'SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, '
    + 'Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('the signer reproduces the S3 reference list example (query string)', () => {
  const h = signV4({
    ...AWS, method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J', headers: {}, body: '',
  });
  assert.equal(h.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
    + 'SignedHeaders=host;x-amz-content-sha256;x-amz-date, '
    + 'Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
});

function fakeBucket(keys = []) {
  const state = { keys: new Set(keys), requests: [], bodies: new Map() };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization, bytes: body.length, sha: req.headers['x-amz-content-sha256'] });
    const [, bucket, ...rest] = url.pathname.split('/');
    const key = rest.join('/');
    if (!req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ')) { res.writeHead(403); return res.end('<Error><Code>AccessDenied</Code></Error>'); }
    if (req.method === 'PUT') { state.keys.add(key); state.bodies.set(key, body); res.writeHead(200); return res.end(); }
    if (req.method === 'DELETE') { state.keys.delete(key); res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const listed = [...state.keys].filter((k) => k.startsWith(prefix)).sort();
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><IsTruncated>false</IsTruncated>`
        + listed.map((k) => `<Contents><Key>${k}</Key><Size>1</Size></Contents>`).join('') + '</ListBucketResult>');
    }
    if (req.method === 'GET') {
      if (!state.bodies.has(key)) { res.writeHead(404); return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
      res.writeHead(200); return res.end(state.bodies.get(key));
    }
    res.writeHead(400); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, endpoint: `http://127.0.0.1:${server.address().port}` })));
}

const bucketEnv = (endpoint) => ({ WEAVE_BACKUP_ENDPOINT: endpoint, WEAVE_BACKUP_KEY_ID: 'k', WEAVE_BACKUP_SECRET: 's', WEAVE_BACKUP_REGION: 'auto' });

test('upload puts the archive under the prefix and prunes past the newest thirty', async () => {
  const old = Array.from({ length: 32 }, (_, i) => `nightly/${ARCHIVE_PREFIX}all-2026-08-${String(i + 1).padStart(2, '0')}T04-00-00Z.tar.enc`);
  const { server, state, endpoint } = await fakeBucket([...old, 'nightly/unrelated.txt']);
  try {
    const src = seedDataDir();
    const r = await backup({ dataDir: src.dir, out: tmp('out8'), dest: 's3://my-bucket/nightly', env: bucketEnv(endpoint), now: () => new Date('2026-09-12T04:00:00Z') });
    closeAll(src.alpha, src.beta);
    assert.equal(r.uploaded, `nightly/${r.archive}`);
    const put = state.requests.find((q) => q.method === 'PUT');
    assert.equal(put.path, `/my-bucket/nightly/${r.archive}`);
    assert.equal(put.bytes, r.bytes, 'the whole archive went up');
    assert.equal(put.sha, sha256(readFileSync(r.path)), 'the payload hash is signed');
    assert.ok(state.bodies.get(`nightly/${r.archive}`).equals(readFileSync(r.path)));
    assert.deepEqual(r.pruned, old.slice(0, 3));
    assert.equal(state.keys.size, 31);
    assert.ok(state.keys.has('nightly/unrelated.txt'));
    assert.ok(state.requests.every((q) => q.auth.startsWith('AWS4-HMAC-SHA256 Credential=k/20260912/auto/s3/aws4_request')));
  } finally { server.close(); }
});

test('restore takes an s3:// source through the same signer', async () => {
  const { server, state, endpoint } = await fakeBucket();
  try {
    const src = seedDataDir();
    rmSync(join(src.dir, 'keystore.key'));
    const r = await backup({ dataDir: src.dir, out: tmp('out9'), dest: 's3://b/p', env: bucketEnv(endpoint) });
    closeAll(src.alpha, src.beta);
    const fresh = tmp('fresh9');
    const rr = await restore({ source: `s3://b/p/${r.archive}`, dataDir: fresh, env: bucketEnv(endpoint) });
    assert.ok(rr.landed.includes('alpha.db'));
    assert.ok(state.requests.some((q) => q.method === 'GET' && q.path === `/b/p/${r.archive}`));
    await assert.rejects(restore({ source: 's3://b/p/nope.tar', dataDir: tmp('fresh9b'), env: bucketEnv(endpoint) }), /404|NoSuchKey/);
  } finally { server.close(); }
});

test('the s3 helper spells R2/B2 (path-style on an endpoint) and AWS (virtual-hosted) URLs', () => {
  assert.equal(s3.url({ bucket: 'b', key: 'p/x.tar', endpoint: 'https://acct.r2.cloudflarestorage.com' }), 'https://acct.r2.cloudflarestorage.com/b/p/x.tar');
  assert.equal(s3.url({ bucket: 'b', key: 'p/x.tar', region: 'eu-west-1' }), 'https://b.s3.eu-west-1.amazonaws.com/p/x.tar');
  assert.deepEqual(s3.parse('s3://my-bucket/some/prefix/'), { bucket: 'my-bucket', prefix: 'some/prefix' });
  assert.deepEqual(s3.parse('s3://my-bucket'), { bucket: 'my-bucket', prefix: '' });
  assert.throws(() => s3.parse('https://not-s3'), /s3:\/\//);
});

test('the next fire is 04:00 UTC, today if still ahead, else tomorrow', () => {
  assert.equal(nextFireAt(new Date('2026-09-12T01:00:00Z')).toISOString(), '2026-09-12T04:00:00.000Z');
  assert.equal(nextFireAt(new Date('2026-09-12T04:00:00Z')).toISOString(), '2026-09-13T04:00:00.000Z');
  assert.equal(nextFireAt(new Date('2026-09-12T17:30:00Z')).toISOString(), '2026-09-13T04:00:00.000Z');
});

test('the scheduler chains one timer per day on a fake clock, records the result, and survives a failure', async () => {
  let clock = new Date('2026-09-12T01:00:00Z').getTime();
  const timers = [];
  const setTimer = (fn, ms) => { timers.push({ fn, ms, at: clock + ms }); return { unref() {} }; };
  const runs = [];
  let fail = false;
  const run = async () => { runs.push(clock); if (fail) throw new Error('bucket said no'); return { archive: `a-${runs.length}.tar.enc`, bytes: 10, orphans: { count: 2 } }; };
  const audit = [];
  const s = scheduleNightly({ run, dest: 's3://b/p', now: () => clock, setTimer, audit: (e) => audit.push(e), log: () => {} });
  assert.equal(s.status().nextAt, '2026-09-12T04:00:00.000Z');
  assert.equal(timers[0].ms, 3 * 3600 * 1000);
  assert.deepEqual(s.status(), { lastAt: null, lastStatus: null, nextAt: '2026-09-12T04:00:00.000Z', dest: 's3://b/p', kind: 's3' });

  clock = timers[0].at; await timers[0].fn();
  assert.equal(runs.length, 1);
  assert.equal(s.status().lastStatus, 'completed');
  assert.equal(s.status().lastAt, '2026-09-12T04:00:00.000Z');
  assert.equal(s.status().nextAt, '2026-09-13T04:00:00.000Z');
  assert.equal(timers[1].ms, 24 * 3600 * 1000, 'the next timer is a day out');
  assert.deepEqual(audit.at(-1), { action: 'backup-completed', detail: { archive: 'a-1.tar.enc', bytes: 10, orphans: 2, dest: 's3://b/p' } });

  fail = true;
  clock = timers[1].at; await timers[1].fn();
  assert.equal(s.status().lastStatus, 'failed');
  assert.equal(s.status().lastError, 'bucket said no');
  assert.equal(audit.at(-1).action, 'backup-failed');
  assert.equal(audit.at(-1).detail.error, 'bucket said no');
  assert.equal(timers.length, 3, 'a failure still schedules tomorrow');
  assert.doesNotMatch(JSON.stringify(s.status()), /secret|key/i, 'status carries no credential');
  s.stop();
});

test('/api/health carries the last backup result when the nightly is on, and nothing when it is off', async () => {
  const off = await startServer(new Weave(), { port: 0 });
  try {
    const h = await (await fetch(`http://127.0.0.1:${off.port}/api/health`)).json();
    assert.equal(h.backup, undefined);
  } finally { off.server.close(); }
  const status = { lastAt: '2026-09-12T04:00:00.000Z', lastStatus: 'completed', nextAt: '2026-09-13T04:00:00.000Z', dest: 's3://b/p' };
  const on = await startServer(new Weave(), { port: 0, backup: () => status });
  try {
    const h = await (await fetch(`http://127.0.0.1:${on.port}/api/health`)).json();
    assert.deepEqual(h.backup, status);
  } finally { on.server.close(); }
});

test('weave backup and weave restore <archive> work from the CLI, and restore <ref> is still the entity verb', () => {
  const src = seedDataDir();
  rmSync(join(src.dir, 'keystore.key'));
  closeAll(src.alpha, src.beta);
  const outDir = tmp('cli-out');
  const stdout = execFileSync('node', [BIN, 'backup', '--data', src.dir, '--out', outDir], { encoding: 'utf8', env: { ...process.env, WEAVE_BACKUP_DEST: '' } });
  assert.match(stdout, /alpha.*entities/);
  assert.match(stdout, /orphan/i);
  const archive = readdirSync(outDir).find((f) => f.startsWith(ARCHIVE_PREFIX));
  assert.ok(archive, 'an archive landed');
  const fresh = tmp('cli-fresh');
  const restored = execFileSync('node', [BIN, 'restore', join(outDir, archive), '--data', fresh], { encoding: 'utf8' });
  assert.match(restored, /alpha\.db/);
  assert.ok(existsSync(join(fresh, 'beta.db')));
  const back = execFileSync('node', [BIN, 'restore', src.gone.id, '--data', join(fresh, 'alpha.db')], { encoding: 'utf8' });
  assert.match(back, /Trashed/);
  const help = execFileSync('node', [BIN, 'help'], { encoding: 'utf8' });
  assert.match(help, /weave backup|backup \[--out/);
  assert.match(help, /restore <archive/);
});

test('the Handbook guide and AGENTS.md name the verbs, the variables, the nightly, retention and the upgrade path', () => {
  const g = GUIDES.find((x) => x.name === 'Backup and restore');
  assert.ok(g, 'there is a Backup and restore guide');
  assert.equal(g.audience, 'Human');
  assert.ok(g.doc.startsWith('# Backup and restore\n'));
  for (const topic of ['weave backup', 'weave restore', 'WEAVE_BACKUP_DEST', 'WEAVE_BACKUP_PASSPHRASE', 'WEAVE_BACKUP_ENDPOINT',
    'WEAVE_BACKUP_KEY_ID', 'WEAVE_BACKUP_SECRET', 'AWS_ACCESS_KEY_ID', 'r2.cloudflarestorage.com', 'backblazeb2.com', '04:00 UTC',
    'keystore.key', 'thirty', 'Litestream', 'Railway', 'manifest.json', 'orphan', 'phase 3', '## How you know it worked']) {
    assert.ok(g.doc.includes(topic), `the guide never mentions ${topic}`);
  }
  assert.ok(g.doc.trim().split('## How you know it worked').length === 2 && g.doc.trim().endsWith('.') , 'the check is the last section');
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');
  assert.match(agents, /`weave backup`/);
  assert.match(agents, /`weave restore <archive>`/);
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8').split('## v0.4.17')[0];
  assert.match(changelog, /weave backup/);
  assert.match(changelog, /Feature #209/);
  assert.match(changelog, /Issue #250/);
});

test('RETAIN is thirty, per the spec', () => assert.equal(RETAIN, 30));

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f3a8d40000000049454e44ae426082', 'hex');
const SPEC_BYTES = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 7 + 3) % 256));
const UNCOVERED_TYPES = ['view'];

const openFull = (dir) => new Weave({ path: join(dir, 'full.db'), keystorePath: join(dir, 'keystore.json'), revisionWindowMs: 0 });
const snap = (w) => JSON.parse(JSON.stringify(w.state));

function seedEveryField() {
  const dir = tmp('every');
  const w = openFull(dir);
  w.createSpace({ name: 'Lab' });
  w.createTable({ space: 'Lab', name: 'Group' });
  w.createTable({ space: 'Lab', name: 'Item' });
  const fields = [
    { name: 'Note', type: 'text' },
    { name: 'Price', type: 'number', config: { format: 'currency', currency: 'USD' } },
    { name: 'Stars', type: 'rating' },
    { name: 'Due', type: 'date', config: { grain: ['year', 'month'] } },
    { name: 'Window', type: 'daterange' },
    { name: 'Done', type: 'checkbox' },
    { name: 'Flag', type: 'toggle' },
    { name: 'Site', type: 'url' },
    { name: 'Contact', type: 'email' },
    { name: 'Kind', type: 'select', config: { options: ['A', 'B'] } },
    { name: 'Tags', type: 'multiselect', config: { options: ['x', 'y', 'z'] } },
    { name: 'Stage', type: 'workflow', config: { states: [{ name: 'New', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } },
    { name: 'Secret', type: 'key' },
    { name: 'Ref', type: 'field' },
    { name: 'Files', type: 'attachments' },
    { name: 'Face', type: 'avatar' },
    { name: 'Spec', type: 'document' },
  ];
  for (const f of fields) w.addField('Item', f);
  w.addRelation('Item', { name: 'Group', targetDb: 'Group', cardinality: 'many-to-one', inverseName: 'Items' });
  w.addRelation('Item', { name: 'Related', targetDb: 'Item', cardinality: 'many-to-many', inverseName: 'Related by' });
  w.addField('Item', { name: 'Group label', type: 'lookup', config: { relationField: 'Group', targetField: 'Name' } });
  w.addField('Item', { name: 'Price doubled', type: 'formula', config: { expression: 'Price * 2' } });
  w.addField('Group', { name: 'Item count', type: 'rollup', config: { relationField: 'Items', aggregate: 'count' } });
  w.addField('Group', { name: 'Total price', type: 'rollup', config: { relationField: 'Items', targetField: 'Price', aggregate: 'sum' } });
  const group = w.createEntity('Lab/Group', { name: 'Core' });
  const alpha = w.createEntity('Lab/Item', {
    name: 'Alpha',
    values: {
      Note: 'first row', Price: 12.5, Stars: 4, Due: '2026-03', Window: { start: '2026-01-01', end: '2026-02-01' },
      Done: true, Flag: true, Site: 'https://example.com', Contact: 'ada@example.com', Kind: 'A', Tags: ['x', 'z'],
      Stage: 'Done', Group: group.id,
    },
    doc: 'draft one',
  });
  const beta = w.createEntity('Lab/Item', { name: 'Beta', values: { Price: 7.25, Group: group.id, Related: [alpha.id] } });
  const gone = w.createEntity('Lab/Item', { name: 'Trashed' });
  w.deleteEntity(gone.id);
  w.setDoc(alpha.id, 'draft two, revised');
  const spec = w.attachToField(alpha.id, 'Files', { name: 'spec.bin', mime: 'application/octet-stream', bytes: SPEC_BYTES });
  const face = w.attachToField(alpha.id, 'Face', { name: 'face.png', mime: 'image/png', bytes: PNG });
  w.addComment(alpha.id, { author: 'ada', text: 'ship it' });
  const automation = w.createAutomation('Lab/Item', { name: 'Greet', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'hi' }] });
  return { dir, w, group, alpha, beta, gone, spec, face, automation, blobs: { [spec.id]: SPEC_BYTES, [face.id]: PNG } };
}

const revisionsOf = (w, id) => w.listDocRevisions(id).revisions.map((r) => ({ ...r, text: w.getDocRevision(id, null, r.seq).text }));

async function roundTrip({ passphrase = null } = {}) {
  const src = seedEveryField();
  src.w.store.close?.();
  const reopened = openFull(src.dir);
  const before = { state: snap(reopened), revisions: revisionsOf(reopened, src.alpha.id) };
  closeAll(reopened);
  const env = passphrase ? { WEAVE_BACKUP_PASSPHRASE: passphrase } : {};
  const made = await backup({ dataDir: src.dir, out: tmp('rt-out'), env });
  const fresh = tmp('rt-fresh');
  const landed = await restore({ source: made.path, dataDir: fresh, env });
  const back = openFull(fresh);
  return { src, before, made, landed, back, fresh };
}

function assertRoundTrip({ src, before, back }) {
  assert.deepStrictEqual(snap(back), before.state, 'every table, field, row, doc, comment and automation survives with its ids');
  assert.deepStrictEqual(revisionsOf(back, src.alpha.id), before.revisions, 'the document keeps both revisions, text and sequence');
  assert.equal(before.revisions.length, 2);
  for (const [id, bytes] of Object.entries(src.blobs)) {
    assert.equal(sha256(back.readFile(id).bytes), sha256(bytes), `blob ${id} is byte-identical by sha256`);
  }
  assert.equal(back.getEntity(src.alpha.id).comments[0].text, 'ship it');
  assert.equal(back.listAutomations('Lab/Item').find((a) => a.id === src.automation.id)?.name, 'Greet');
  assert.ok(back.getEntity(src.gone.id).deletedAt, 'the trashed row is still trashed');
}

test('the seed offers every field type the engine has', () => {
  const src = seedEveryField();
  const used = new Set();
  for (const db of Object.values(src.w.state.tables)) for (const f of Object.values(db.fields)) used.add(f.type);
  assert.deepEqual(FIELD_TYPES.filter((t) => !used.has(t) && !UNCOVERED_TYPES.includes(t)), [], 'a new engine field type must join the round-trip seed');
  assert.equal(src.w.readEntity(src.alpha.id).raw['Group label'], 'Core', 'the lookup computes');
  src.w.store.close?.();
});

test('backup → restore → boot keeps every field value, document revision, comment, automation and blob byte', async () => {
  const rt = await roundTrip();
  assert.equal(rt.made.encrypted, false);
  assertRoundTrip(rt);
  closeAll(rt.back);
});

test('the same round trip holds through an encrypted archive', async () => {
  const rt = await roundTrip({ passphrase: PASS });
  assert.equal(rt.made.encrypted, true);
  assert.ok(isEncrypted(rt.made.path));
  assert.doesNotMatch(readFileSync(rt.made.path, 'latin1'), /first row|ship it/, 'nothing readable rides in the envelope');
  assertRoundTrip(rt);
  closeAll(rt.back);
});

test('a restore with the wrong passphrase fails clearly and writes nothing into the target', async () => {
  const src = seedEveryField();
  src.w.store.close?.();
  const made = await backup({ dataDir: src.dir, out: tmp('wrong-out'), env: { WEAVE_BACKUP_PASSPHRASE: PASS } });
  const fresh = tmp('wrong-fresh');
  await assert.rejects(restore({ source: made.path, dataDir: fresh, env: { WEAVE_BACKUP_PASSPHRASE: 'not the passphrase' } }), /Cannot decrypt the archive.*wrong passphrase/);
  assert.deepEqual(readdirSync(fresh), [], 'no database, blob or keystore landed');
  await assert.rejects(restore({ source: made.path, dataDir: fresh, env: {} }), /archive is encrypted.*WEAVE_BACKUP_PASSPHRASE/);
  assert.deepEqual(readdirSync(fresh), []);
});

function chunked(buf, size) {
  return (async function* () { for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size); })();
}

async function streamed(buf, size) {
  const seen = [];
  await streamTar(chunked(buf, size), (name, bytes) => {
    const parts = [];
    const entry = { name, bytes, parts, closed: false };
    seen.push(entry);
    return { write: (c) => parts.push(Buffer.from(c)), close: () => { entry.closed = true; } };
  });
  return seen.map((e) => ({ name: e.name, bytes: e.bytes, closed: e.closed, data: Buffer.concat(e.parts) }));
}

test('streamTar reads back what tarWriter wrote, across block boundaries and in any chunking', async () => {
  const dir = tmp('stream');
  const sizes = { 'empty.txt': 0, 'one-byte.bin': 1, 'block-minus.bin': 511, 'block.bin': 512, 'block-plus.bin': 513, 'across.bin': 1100, 'two-blocks.bin': 1024 };
  const payload = Object.fromEntries(Object.entries(sizes).map(([n, len], k) => [n, Buffer.from(Array.from({ length: len }, (_, i) => (i * 31 + k) % 256))]));
  const out = join(dir, 'x.tar');
  const t = tarWriter(out, { mtime: 1_700_000_000 });
  const digests = Object.entries(payload).map(([name, data]) => t.add({ name, data }));
  t.close();
  assert.deepEqual(digests.map((d) => [d.name, d.bytes, d.sha256]), Object.entries(payload).map(([n, d]) => [n, d.length, sha256(d)]));
  const whole = readFileSync(out);
  for (const size of [whole.length, 4096, 512, 100, 7, 1]) {
    const got = await streamed(whole, size);
    assert.deepEqual(got.map((e) => e.name), Object.keys(payload), `entries in order at chunk size ${size}`);
    for (const e of got) {
      assert.equal(e.bytes, payload[e.name].length);
      assert.ok(e.closed, `${e.name} closed at chunk size ${size}`);
      assert.ok(e.data.equals(payload[e.name]), `${e.name} bytes exact at chunk size ${size}`);
    }
  }
});

test('streamTar skips non-file entries, refuses a truncated archive and a corrupt header', async () => {
  const dir = tmp('stream-edge');
  const out = join(dir, 'x.tar');
  packTar(out, [{ name: 'meta', data: Buffer.alloc(600, 7) }, { name: 'after.bin', data: Buffer.from('after') }]);
  const buf = readFileSync(out);
  buf[156] = 0x78;
  buf.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of buf.subarray(0, 512)) sum += b;
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const got = await streamed(buf, 100);
  assert.deepEqual(got.map((e) => e.name), ['after.bin'], 'the extended-header entry is read past, never opened');
  assert.equal(got[0].data.toString(), 'after');
  assert.deepEqual(readTar(buf).map((e) => e.name), ['after.bin'], 'readTar agrees');

  packTar(out, [{ name: 'big.bin', data: Buffer.alloc(1100, 9) }]);
  const whole = readFileSync(out);
  const sinks = [];
  await assert.rejects(streamTar(chunked(whole.subarray(0, 900), 64), (n) => { const s = { closed: false, write() {}, close() { s.closed = true; } }; sinks.push(s); return s; }), /truncated at byte 900/);
  assert.ok(sinks.every((s) => s.closed), 'a sink left mid-file is closed when the stream fails');

  const bad = Buffer.from(whole);
  bad[0] ^= 0xff;
  await assert.rejects(streamTar(chunked(bad, 512), () => ({ write() {}, close() {} })), /checksum mismatch at byte 0/);
});

test('classify sorts a data directory into databases, directories and sidecars to leave out', () => {
  const dir = tmp('classify');
  for (const f of ['zeta.db', 'alpha.db', 'alpha.db-wal', 'alpha.db-shm', 'keystore.key', 'keystore.json', 'notes.txt']) writeFileSync(join(dir, f), 'x');
  mkdirSync(join(dir, 'files'));
  assert.deepEqual(classify(readdirSync(dir, { withFileTypes: true })), {
    databases: ['alpha.db', 'zeta.db'],
    dirs: ['files'],
    skipped: ['alpha.db-shm', 'alpha.db-wal', 'keystore.key'],
  });
});

test('heldOpen sees a live WAL and a writer lock, and clears for a closed database', () => {
  const dir = tmp('held');
  const db = join(dir, 'held.db');
  const writer = new DatabaseSync(db);
  writer.exec('PRAGMA journal_mode = DELETE');
  writer.exec('CREATE TABLE t (x)');
  assert.equal(heldOpen(db), false, 'a quiet rollback-journal database is not held');
  writer.exec('BEGIN IMMEDIATE');
  assert.equal(heldOpen(db), true, 'a writer holding the lock is');
  writer.exec('ROLLBACK');
  writer.close();
  assert.equal(heldOpen(db), false);
  writeFileSync(`${db}-wal`, '');
  assert.equal(heldOpen(db), true, 'a leftover -wal sidecar counts');
});

const FIXTURE = join(ROOT, 'test', 'fixtures', 'backup-v0.4.100.tar');

test('an archive taken by release v0.4.100 restores with today\'s code and reads back its seeded rows', async () => {
  const names = readTar(FIXTURE).map((e) => e.name);
  assert.deepEqual(names.filter((n) => !n.startsWith('files/')), ['ledger.db', 'manifest.json']);
  const fresh = tmp('v04100');
  const rr = await restore({ source: FIXTURE, dataDir: fresh, env: {} });
  assert.equal(rr.archive.weave, '0.4.100', 'the archive names the release that wrote it');
  assert.equal(rr.verified, 2, 'the database and the one blob match the old manifest');
  assert.equal(rr.orphans.count, 0);
  const w = new Weave({ path: join(fresh, 'ledger.db') });
  const inv = w.findEntity('Finance/Invoice', 'INV-0042');
  const raw = w.readEntity(inv.id).raw;
  assert.equal(raw.Amount, 1234.5);
  assert.equal(raw.Issued, '2026-03-14');
  assert.equal(raw.Terms, 'net-30');
  assert.equal(w.getDoc(inv.id), 'Paid in full on receipt.');
  assert.equal(w.getEntity(inv.id).files.length, 1);
  assert.equal(w.readFile(w.getEntity(inv.id).files[0].id).bytes.toString(), 'invoice 0042 attachment bytes\n');
  assert.equal(w.readEntity(w.findEntity('Finance/Invoice', 'INV-0043').id).raw.Amount, 99);
  closeAll(w);
});

test('full backups preserve hub routing aliases without putting them in single-workspace exports', async () => {
  const { dir, alpha, beta } = seedDataDir();
  rmSync(join(dir, 'keystore.key'));
  const routes = { 'removed.db': 'alpha.db' };
  writeFileSync(join(dir, '_hub.json'), JSON.stringify(routes));
  closeAll(alpha, beta);
  const full = await backup({ dataDir: dir, out: tmp('hub-full'), env: {} });
  assert.ok(readTar(full.path).some(e => e.name === '_hub.json'));
  const target = tmp('hub-restored');
  await restore({ source: full.path, dataDir: target, env: {} });
  assert.deepEqual(JSON.parse(readFileSync(join(target, '_hub.json'), 'utf8')), routes);
  const single = await backup({ dataDir: dir, workspace: 'alpha', out: tmp('hub-single'), env: {} });
  assert.equal(readTar(single.path).some(e => e.name === '_hub.json'), false);
});
