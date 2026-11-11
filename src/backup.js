import {
  readFileSync, mkdirSync, existsSync, readdirSync, statSync,
  openSync, readSync, writeSync, closeSync, fsyncSync, mkdtempSync, rmSync, renameSync, createReadStream, createWriteStream,
} from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { WeaveError } from './store.js';
import { openKeyStore, keystoreFilePath } from './keystore.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}

const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

export const ARCHIVE_PREFIX = 'weave-backup-';
export const RETAIN = 30;
const CHUNK = 1024 * 1024;
const STREAM_CHUNK = 16 * 1024;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const BLOCK = 512;
const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';

function header(name, size, mtime) {
  let base = name, prefix = '';
  if (Buffer.byteLength(name) > 100) {
    for (let j = name.length - 1; j > 0; j--) {
      if (name[j] === '/' && Buffer.byteLength(name.slice(j + 1)) <= 100 && Buffer.byteLength(name.slice(0, j)) <= 155) {
        prefix = name.slice(0, j); base = name.slice(j + 1); break;
      }
    }
    if (!prefix) throw new WeaveError(`Path too long for a tar entry: ${name}`, 'invalid');
  }
  const h = Buffer.alloc(BLOCK);
  h.write(base, 0, 100);
  h.write(octal(0o644, 8), 100);
  h.write(octal(0, 8), 108);
  h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124);
  h.write(octal(mtime, 12), 136);
  h.write('        ', 148);
  h.write('0', 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  h.write('weave', 265);
  h.write('weave', 297);
  h.write(octal(0, 8), 329);
  h.write(octal(0, 8), 337);
  h.write(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

export function tarWriter(out, { mtime = Math.floor(Date.now() / 1000), seal = null } = {}) {
  const fd = openSync(out, 'w');
  if (seal) writeSync(fd, seal.head);
  const put = seal
    ? (b, off = 0, len = b.length - off) => { const c = seal.update(b.subarray(off, off + len)); if (c.length) writeSync(fd, c); }
    : (b, off = 0, len = b.length - off) => writeSync(fd, b, off, len);
  return {
    add(e) {
      const size = e.data ? e.data.length : statSync(e.path).size;
      put(header(e.name, size, e.mtime ?? mtime));
      const hash = createHash('sha256');
      if (e.data) { put(e.data); hash.update(e.data); } else {
        const src = openSync(e.path, 'r');
        try {
          const buf = Buffer.alloc(CHUNK);
          for (let n; (n = readSync(src, buf, 0, CHUNK, null)) > 0;) { put(buf, 0, n); hash.update(buf.subarray(0, n)); }
        } finally { closeSync(src); }
      }
      const pad = (BLOCK - (size % BLOCK)) % BLOCK;
      if (pad) put(Buffer.alloc(pad));
      return { name: e.name, bytes: size, sha256: hash.digest('hex') };
    },
    close() { put(Buffer.alloc(2 * BLOCK)); if (seal) writeSync(fd, seal.final()); closeSync(fd); },
  };
}

export function packTar(out, entries) {
  const t = tarWriter(out);
  const digests = entries.map((e) => t.add(e));
  t.close();
  return digests;
}

const field = (h, off, len) => h.toString('utf8', off, off + len).replace(/\0.*$/s, '');

function tarHeader(h, off) {
  if (h.every((b) => b === 0)) return null;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
  if (sum !== parseInt(field(h, 148, 8).trim(), 8)) throw new WeaveError(`Tar header checksum mismatch at byte ${off}`, 'invalid');
  const size = parseInt(field(h, 124, 12).trim(), 8);
  const prefix = field(h, 345, 155);
  const name = (prefix ? `${prefix}/` : '') + field(h, 0, 100);
  const type = h[156];
  return { name, size, file: type === 0x30 || type === 0 };
}

export function readTar(path) {
  const buf = Buffer.isBuffer(path) ? path : readFileSync(path);
  const entries = [];
  for (let off = 0; off + BLOCK <= buf.length; ) {
    const h = tarHeader(buf.subarray(off, off + BLOCK), off);
    if (!h) break;
    off += BLOCK;
    if (h.file) entries.push({ name: h.name, data: buf.subarray(off, off + h.size) });
    off += Math.ceil(h.size / BLOCK) * BLOCK;
  }
  return entries;
}

export async function streamTar(chunks, open) {
  let head = Buffer.alloc(0), at = 0, left = 0, skip = 0, sink = null, done = false;
  try {
    for await (const chunk of chunks) {
      let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      while (buf.length && !done) {
        let n;
        if (left) {
          n = Math.min(left, buf.length);
          sink?.write(buf.subarray(0, n));
          left -= n;
          if (!left) { sink?.close(); sink = null; }
        } else if (skip) {
          n = Math.min(skip, buf.length);
          skip -= n;
        } else {
          n = Math.min(BLOCK - head.length, buf.length);
          head = Buffer.concat([head, buf.subarray(0, n)]);
          if (head.length === BLOCK) {
            const h = tarHeader(head, at + n - BLOCK);
            head = Buffer.alloc(0);
            if (!h) done = true;
            else {
              left = h.size;
              skip = (BLOCK - (h.size % BLOCK)) % BLOCK;
              sink = h.file ? open(h.name, h.size) : null;
              if (!left) { sink?.close(); sink = null; }
            }
          }
        }
        at += n;
        buf = buf.subarray(n);
      }
    }
    if (!done && (left || skip || head.length)) throw new WeaveError(`Tar archive truncated at byte ${at}`, 'invalid');
  } finally {
    sink?.close();
  }
}

const MAGIC = Buffer.from('WVBK1\0');

export function isEncrypted(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    return readSync(fd, head, 0, MAGIC.length, 0) === MAGIC.length && head.equals(MAGIC);
  } finally { closeSync(fd); }
}

function pump(src, dst, transform, { start = 0, end = Infinity } = {}) {
  const buf = Buffer.alloc(CHUNK);
  let pos = start;
  while (pos < end) {
    const n = readSync(src, buf, 0, Math.min(CHUNK, end - pos), pos);
    if (n <= 0) break;
    writeSync(dst, transform(buf.subarray(0, n)));
    pos += n;
  }
}

export function sealer(passphrase, { salt = randomBytes(16), iv = randomBytes(12) } = {}) {
  const cipher = createCipheriv('aes-256-gcm', scryptSync(String(passphrase), salt, 32), iv);
  return {
    head: Buffer.concat([MAGIC, salt, iv]),
    update: (chunk) => cipher.update(chunk),
    final: () => Buffer.concat([cipher.final(), cipher.getAuthTag()]),
  };
}

export function encryptFile(src, dst, passphrase, { salt, iv } = {}) {
  const seal = sealer(passphrase, { salt, iv });
  const s = openSync(src, 'r'), d = openSync(dst, 'w');
  try {
    writeSync(d, seal.head);
    pump(s, d, (c) => seal.update(c));
    writeSync(d, seal.final());
  } finally { closeSync(s); closeSync(d); }
}

const cannotDecrypt = () => new WeaveError('Cannot decrypt the archive — wrong passphrase, or the archive was altered', 'invalid');
const SEALED_HEAD = MAGIC.length + 16 + 12;

function decipherOf(path, passphrase) {
  const size = statSync(path).size;
  if (size < SEALED_HEAD + 16 || !isEncrypted(path)) throw new WeaveError('Not an encrypted weave archive', 'invalid');
  const head = Buffer.alloc(SEALED_HEAD), tag = Buffer.alloc(16);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, head, 0, SEALED_HEAD, 0);
    readSync(fd, tag, 0, 16, size - 16);
  } finally { closeSync(fd); }
  const decipher = createDecipheriv('aes-256-gcm', scryptSync(String(passphrase), head.subarray(MAGIC.length, MAGIC.length + 16), 32), head.subarray(MAGIC.length + 16), { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return { decipher, size };
}

async function* unsealed(path, passphrase) {
  const { decipher, size } = decipherOf(path, passphrase);
  if (size > SEALED_HEAD + 16) {
    for await (const chunk of createReadStream(path, { start: SEALED_HEAD, end: size - 17, highWaterMark: STREAM_CHUNK })) yield decipher.update(chunk);
  }
  let last;
  try { last = decipher.final(); } catch { throw cannotDecrypt(); }
  yield last;
}

export function decryptFile(src, dst, passphrase) {
  const { decipher, size } = decipherOf(src, passphrase);
  const s = openSync(src, 'r');
  let d = null;
  try {
    d = openSync(dst, 'w');
    pump(s, d, (c) => decipher.update(c), { start: SEALED_HEAD, end: size - 16 });
    try { writeSync(d, decipher.final()); } catch {
      closeSync(d); d = null;
      rmSync(dst, { force: true });
      throw cannotDecrypt();
    }
  } finally { closeSync(s); if (d != null) closeSync(d); }
}

export const keystorePath = (env, dataDir) => keystoreFilePath(env.WEAVE_KEYSTORE) || join(dataDir, 'keystore.json');
export function resolvePassphrase({ env = process.env, dataDir, passphraseEnv = null }) {
  if (passphraseEnv) {
    if (!env[passphraseEnv]) throw new WeaveError(`--passphrase-env names ${passphraseEnv}, which is not set`, 'invalid');
    return String(env[passphraseEnv]);
  }
  if (env.WEAVE_BACKUP_PASSPHRASE) return String(env.WEAVE_BACKUP_PASSPHRASE);
  if (env.WEAVE_KEYSTORE_PASSPHRASE) return String(env.WEAVE_KEYSTORE_PASSPHRASE);
  try {
    const material = readFileSync(keystorePath(env, dataDir).replace(/\.json$/, '') + '.key', 'utf8').trim();
    if (material) return material;
  } catch {}
  return null;
}

export function classify(entries) {
  const out = { databases: [], dirs: [], skipped: [] };
  for (const e of entries) {
    const n = e.name;
    if (e.isDirectory()) out.dirs.push(n);
    else if (n.endsWith('-wal') || n.endsWith('-shm') || n === 'keystore.key') out.skipped.push(n);
    else if (n.endsWith('.db')) out.databases.push(n);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

function needSqlite() {
  if (!DatabaseSync) throw new WeaveError(`weave backup needs node:sqlite (Node >= 22.16); this is ${process.version}`, 'invalid');
}

export function snapshot(src, dst) {
  needSqlite();
  rmSync(dst, { force: true });
  const db = new DatabaseSync(src);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
  } finally { db.close(); }
}

export function inspect(path) {
  needSqlite();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    if (!tables.includes('entities')) return { entities: null, refs: [] };
    let entities = 0;
    const refs = [];
    for (const { json } of db.prepare('SELECT json FROM entities').all()) {
      let e;
      try { e = JSON.parse(json); } catch { continue; }
      if (!e.deletedAt) entities += 1;
      for (const f of e.files ?? []) {
        if (f?.id) refs.push({ id: String(f.id), name: f.name ?? '' });
        if (f?.preview?.id) refs.push({ id: String(f.preview.id), name: `${f.name ?? ''} (preview)` });
      }
    }
    return { entities, refs };
  } finally { db.close(); }
}

const stamp = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
const fileStream = (path) => Readable.toWeb(createReadStream(path, { highWaterMark: CHUNK }));
const opened = (res) => {
  const length = res.headers.has('content-encoding') ? null : res.headers.get('content-length');
  return { body: res.body ? Readable.fromWeb(res.body) : Readable.from([]), bytes: length == null ? null : Number(length) };
};

export async function backup({
  dataDir, out = process.cwd(), dest = null, env = process.env, passphraseEnv = null,
  workspace = null, now = () => new Date(), fetchImpl = fetch, keep = true, keyStore = null,
}) {
  needSqlite();
  dataDir = resolve(dataDir);
  if (!existsSync(dataDir) || !statSync(dataDir).isDirectory()) throw new WeaveError(`Data directory not found: ${dataDir}`, 'not-found');
  dest = dest || env.WEAVE_BACKUP_DEST || null;
  const passphrase = resolvePassphrase({ env, dataDir, passphraseEnv });
  const toCloud = destKind(dest) === 'weave';
  if (toCloud) {
    cloud.parse(dest);
    cloud.token(env);
    if (!passphrase) throw new WeaveError('weave:// keeps encrypted archives only: set WEAVE_BACKUP_PASSPHRASE (or WEAVE_KEYSTORE_PASSPHRASE, or --passphrase-env NAME), or keep keystore.key beside the data', 'invalid');
  }
  const c = classify(readdirSync(dataDir, { withFileTypes: true }));
  const dbs = workspace ? c.databases.filter((n) => n === `${workspace}.db`) : c.databases;
  if (!dbs.length) throw new WeaveError(workspace ? `No workspace '${workspace}' in ${dataDir}` : `No .db files in ${dataDir}`, 'not-found');

  const archive = `${ARCHIVE_PREFIX}${workspace ?? 'all'}-${stamp(now())}.tar${passphrase ? '.enc' : ''}`;
  const outPath = /\.tar(\.enc)?$/.test(out) ? resolve(out) : join(resolve(out), archive);
  mkdirSync(dirname(outPath), { recursive: true });

  const scratch = mkdtempSync(join(tmpdir(), 'weave-backup-'));
  const partial = `${outPath}.part`;
  const result = { archive, path: outPath, bytes: 0, encrypted: !!passphrase, workspaces: {}, files: 0, orphans: { count: 0, list: [] }, keys: null, uploaded: null, pruned: [] };
  try {
    const t = tarWriter(partial, { seal: passphrase ? sealer(passphrase) : null });
    const entries = [];
    const filesDir = join(dataDir, 'files');
    const present = new Set(c.dirs.includes('files')
      ? readdirSync(filesDir).filter((f) => !f.endsWith('.tmp')).filter((f) => { try { return statSync(join(filesDir, f)).isFile(); } catch { return false; } })
      : []);
    const referenced = new Set();
    for (const db of dbs) {
      const copy = join(scratch, db);
      snapshot(join(dataDir, db), copy);
      const facts = inspect(copy);
      const name = db.slice(0, -3);
      result.workspaces[name] = { entities: facts.entities, bytes: statSync(copy).size, referenced: facts.refs.length };
      for (const f of facts.refs) {
        referenced.add(f.id);
        if (!present.has(f.id)) result.orphans.list.push({ workspace: name, id: f.id, name: f.name });
      }
      entries.push(t.add({ name: db, path: copy }));
      rmSync(copy, { force: true });
    }
    result.orphans.count = result.orphans.list.length;
    const blobs = [...(workspace ? [...referenced].filter((id) => present.has(id)) : present)].sort();
    for (const id of blobs) entries.push(t.add({ name: `files/${id}`, path: join(filesDir, id) }));
    result.files = blobs.length;
    if (!workspace && existsSync(join(dataDir, '_hub.json'))) entries.push(t.add({ name: '_hub.json', path: join(dataDir, '_hub.json') }));
    const ks = keystorePath(env, dataDir);
    const keys = keyStore ?? openKeyStore({ path: ks, env });
    if (keys.kind === 'keychain') {
      result.keys = { store: 'keychain', names: Object.keys(keys.read().keys).sort() };
      entries.push(t.add({ name: 'keys.json', data: Buffer.from(JSON.stringify(result.keys)) }));
    } else if (existsSync(ks)) entries.push(t.add({ name: 'keystore.json', path: ks }));
    const manifest = {
      format: 'weave-backup/1', weave: VERSION, createdAt: now().toISOString(), workspace: workspace ?? 'all',
      encrypted: !!passphrase, entries, workspaces: result.workspaces, files: result.files, orphans: result.orphans,
    };
    t.add({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 1)) });
    t.close();
    renameSync(partial, outPath);
    result.bytes = statSync(outPath).size;

    if (toCloud) {
      const sent = await cloud.client({ dest, env, fetchImpl }).put(archive, fileStream(outPath));
      result.uploaded = `${dest.replace(/\/+$/, '')}/${archive}`;
      result.pruned = sent.pruned ?? [];
    } else if (dest) {
      const { bucket, prefix } = s3.parse(dest);
      const client = s3.client({ env, fetchImpl, now });
      const key = prefix ? `${prefix}/${archive}` : archive;
      await client.upload(bucket, key, outPath);
      result.uploaded = key;
      const ours = (await client.list(bucket, prefix ? `${prefix}/${ARCHIVE_PREFIX}` : ARCHIVE_PREFIX)).sort();
      for (const k of ours.slice(0, Math.max(0, ours.length - RETAIN))) {
        await client.delete(bucket, k);
        result.pruned.push(k);
      }
    }
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(partial, { force: true });
    if (!keep) { rmSync(outPath, { force: true }); result.path = null; }
  }
}

export function heldOpen(dbPath) {
  if (!DatabaseSync || !existsSync(dbPath)) return false;
  let db = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 0');
    db.exec('PRAGMA locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE');
    db.exec('ROLLBACK');
    return false;
  } catch (err) {
    return /locked|busy/i.test(err.message);
  } finally { db?.close(); }
}

function refuseLive(dataDir) {
  const held = readdirSync(dataDir).filter((n) => n.endsWith('.db')).sort().map((n) => join(dataDir, n)).find(heldOpen);
  if (held) throw new WeaveError(`${held} is held open by a running process: weave serve, weave mcp or another weave command. Stop the server first, then restore. --force does not override this, because that process would keep writing to the file the restore replaces`, 'conflict');
}

const LANDS = /^(?:[^/]+\.db|files\/[^/.][^/]*|_hub\.json|keystore\.json)$/;
const READS = new Set(['manifest.json', 'keys.json']);

async function unpack(chunks, dir) {
  mkdirSync(dir);
  const entries = [];
  await streamTar(chunks, (name, bytes) => {
    const e = { name, bytes, path: join(dir, String(entries.length)), sha256: null };
    entries.push(e);
    const fd = openSync(e.path, 'w');
    const hash = createHash('sha256');
    return {
      write: (buf) => { writeSync(fd, buf); hash.update(buf); },
      close: () => { closeSync(fd); e.sha256 = hash.digest('hex'); },
    };
  });
  return entries;
}

function fileSha256(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    for (let n; (n = readSync(fd, buf, 0, CHUNK, null)) > 0;) hash.update(buf.subarray(0, n));
  } finally { closeSync(fd); }
  return hash.digest('hex');
}

function landFile(from, to, mode) {
  mkdirSync(dirname(to), { recursive: true });
  const temporary = `${to}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    const src = openSync(from, 'r'), dst = openSync(temporary, 'wx', mode);
    try {
      pump(src, dst, (c) => c);
      fsyncSync(dst);
    } finally { closeSync(src); closeSync(dst); }
    renameSync(temporary, to);
  } finally { rmSync(temporary, { force: true }); }
}

export async function restore({ source, dataDir, env = process.env, passphraseEnv = null, force = false, fetchImpl = fetch, keyStore = null }) {
  dataDir = resolve(dataDir);
  mkdirSync(dataDir, { recursive: true });
  refuseLive(dataDir);
  const scratch = mkdtempSync(join(tmpdir(), 'weave-restore-'));
  try {
    let local = join(scratch, 'source');
    if (destKind(source) === 'weave') {
      const c = cloud.client({ dest: source, env, fetchImpl });
      let name = c.name;
      if (!name) {
        const { backups } = await c.list();
        if (!backups.length) throw new WeaveError(`${source} holds no backups yet`, 'not-found');
        name = backups.at(-1).name;
      }
      await pipeline((await c.open(name)).body, createWriteStream(local));
    } else if (/^s3:\/\//.test(source)) {
      const { bucket, prefix: key } = s3.parse(source);
      await pipeline((await s3.client({ env, fetchImpl }).open(bucket, key)).body, createWriteStream(local));
    } else if (/^https?:\/\//.test(source)) {
      const res = await fetchImpl(source);
      if (!res.ok) throw new WeaveError(`GET ${source} → ${res.status}`, 'not-found');
      await pipeline(opened(res).body, createWriteStream(local));
    } else {
      if (!existsSync(source)) throw new WeaveError(`Archive not found: ${source}`, 'not-found');
      local = resolve(source);
    }
    const sealed = isEncrypted(local);
    const passphrase = sealed ? resolvePassphrase({ env, dataDir, passphraseEnv }) : null;
    if (sealed && !passphrase) throw new WeaveError('The archive is encrypted — set WEAVE_BACKUP_PASSPHRASE (or WEAVE_KEYSTORE_PASSPHRASE, or --passphrase-env NAME) to the passphrase it was sealed with', 'invalid');
    let entries;
    try {
      entries = await unpack(sealed ? unsealed(local, passphrase) : createReadStream(local, { highWaterMark: STREAM_CHUNK }), join(scratch, 'entries'));
    } catch (err) {
      throw sealed && err instanceof WeaveError && err.code === 'invalid' ? cannotDecrypt() : err;
    }
    const byName = new Map();
    for (const e of entries) {
      if (byName.has(e.name)) throw new WeaveError(`The archive carries ${e.name} twice`, 'invalid');
      byName.set(e.name, e);
    }
    const mf = byName.get('manifest.json');
    if (!mf) throw new WeaveError('Not a weave backup: the archive has no manifest.json', 'invalid');
    const manifest = JSON.parse(readFileSync(mf.path, 'utf8'));
    const foreign = entries.find((e) => !READS.has(e.name) && !LANDS.test(e.name));
    if (foreign) throw new WeaveError(`The archive carries ${foreign.name}, which weave backup never writes: restore lands only workspaces, files/, _hub.json and keystore.json`, 'invalid');
    const listed = new Set((manifest.entries ?? []).map((m) => m.name));
    const unlisted = entries.find((e) => e.name !== 'manifest.json' && !listed.has(e.name));
    if (unlisted) throw new WeaveError(`The archive carries ${unlisted.name}, which its manifest does not list`, 'invalid');
    let verified = 0;
    for (const m of manifest.entries ?? []) {
      const e = byName.get(m.name);
      if (!e) throw new WeaveError(`The archive is missing ${m.name} that its manifest lists`, 'invalid');
      if (e.sha256 !== m.sha256) throw new WeaveError(`sha256 mismatch on ${m.name}: the archive does not match its manifest`, 'invalid');
      verified += 1;
    }
    const landing = entries.filter((e) => LANDS.test(e.name));
    const named = byName.get('keys.json');
    let keys = null;
    if (named) {
      const { names = [] } = JSON.parse(readFileSync(named.path, 'utf8'));
      const held = (keyStore ?? openKeyStore({ path: keystorePath(env, dataDir), env })).read().keys;
      keys = { store: 'keychain', names, missing: names.filter((n) => !Object.hasOwn(held, n)) };
    }
    refuseLive(dataDir);
    const clash = force ? null : landing.find((e) => {
      const target = join(dataDir, e.name);
      if (!existsSync(target)) return false;
      return /^[^/]+\.db$/.test(e.name) || e.name === 'keystore.json' || statSync(target).size !== e.bytes || fileSha256(target) !== e.sha256;
    });
    if (clash) throw new WeaveError(`${join(dataDir, clash.name)} exists: pass --force to overwrite it`, 'conflict');

    const landed = [];
    for (const e of landing) {
      const target = join(dataDir, e.name);
      if (e.name.endsWith('.db')) for (const s of ['-wal', '-shm']) rmSync(target + s, { force: true });
      landFile(e.path, target, e.name === 'keystore.json' ? 0o600 : undefined);
      landed.push(e.name);
    }
    return {
      dataDir, landed, verified, keys,
      workspaces: manifest.workspaces ?? {}, orphans: manifest.orphans ?? { count: 0, list: [] },
      archive: { weave: manifest.weave, createdAt: manifest.createdAt, workspace: manifest.workspace },
    };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function signV4({ method, url, headers = {}, body = '', keyId, secret, region = 'us-east-1', service = 's3', now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const all = { ...headers, host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const canonHeaders = Object.entries(all)
    .map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const signed = canonHeaders.map(([k]) => k).join(';');
  const canonUri = u.pathname.split('/').map(uriEncode).join('/') || '/';
  const canonQuery = [...u.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : (a[0] < b[0] ? -1 : 1)))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const canonical = [method, canonUri, canonQuery, canonHeaders.map(([k, v]) => `${k}:${v}`).join('\n') + '\n', signed, payloadHash].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return {
    ...headers,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const PART_BYTES = 8 * 1024 * 1024;
const PART_FLOOR = 5 * 1024 * 1024;

export const s3 = {
  partBytes(env = process.env) {
    const n = Number(env.WEAVE_BACKUP_PART_BYTES);
    return Number.isFinite(n) && n > 0 ? Math.max(PART_FLOOR, Math.floor(n)) : PART_BYTES;
  },
  parse(dest) {
    const m = String(dest ?? '').match(/^s3:\/\/([^/]+)\/?(.*)$/);
    if (!m) throw new WeaveError(`The destination must be s3://bucket[/prefix], got '${dest}'`, 'invalid');
    return { bucket: m[1], prefix: m[2].replace(/\/+$/, '') };
  },
  url({ bucket, key = '', endpoint = null, region = 'us-east-1' }) {
    const path = key.split('/').map(uriEncode).join('/');
    return endpoint ? `${endpoint.replace(/\/+$/, '')}/${bucket}/${path}` : `https://${bucket}.s3.${region}.amazonaws.com/${path}`;
  },
  credentials(env) {
    const keyId = env.WEAVE_BACKUP_KEY_ID || env.AWS_ACCESS_KEY_ID;
    const secret = env.WEAVE_BACKUP_SECRET || env.AWS_SECRET_ACCESS_KEY;
    if (!keyId || !secret) throw new WeaveError('No bucket credentials: set WEAVE_BACKUP_KEY_ID + WEAVE_BACKUP_SECRET (or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY)', 'invalid');
    const endpoint = env.WEAVE_BACKUP_ENDPOINT || null;
    return { keyId, secret, endpoint, region: env.WEAVE_BACKUP_REGION || env.AWS_REGION || (endpoint ? 'auto' : 'us-east-1') };
  },
  client({ env = process.env, fetchImpl = fetch, now = null } = {}) {
    const c = s3.credentials(env);
    const objects = async (bucket, prefix) => {
      const xml = await (await call('GET', bucket, '', { query: `?list-type=2&prefix=${uriEncode(prefix)}` })).text();
      return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, c]) => ({
        key: unxml(c.match(/<Key>([^<]*)<\/Key>/)?.[1] ?? ''),
        bytes: Number(c.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        at: c.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1] ?? null,
      }));
    };
    const call = async (method, bucket, key, { query = '', body = '' } = {}) => {
      const url = s3.url({ bucket, key, endpoint: c.endpoint, region: c.region }) + query;
      const headers = signV4({ method, url, body, keyId: c.keyId, secret: c.secret, region: c.region, now: now ? now() : new Date() });
      const res = await fetchImpl(url, { method, headers, body: body.length ? body : undefined });
      if (!res.ok) throw new WeaveError(`${method} ${key || bucket} → ${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}`.trim(), res.status === 404 ? 'not-found' : 'invalid');
      return res;
    };
    const send = async (bucket, key, chunks, partBytes) => {
      const part = Buffer.allocUnsafe(partBytes);
      const parts = [];
      let fill = 0, held = null;
      const flush = async () => {
        if (!held) {
          const started = await (await call('POST', bucket, key, { query: '?uploads' })).text();
          const uploadId = started.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
          if (!uploadId) throw new WeaveError(`POST ${key}?uploads answered no UploadId`, 'invalid');
          held = `uploadId=${uriEncode(unxml(uploadId))}`;
        }
        const number = parts.length + 1;
        const res = await call('PUT', bucket, key, { query: `?partNumber=${number}&${held}`, body: part.subarray(0, fill) });
        parts.push(`<Part><PartNumber>${number}</PartNumber><ETag>${xml(res.headers.get('etag') ?? '')}</ETag></Part>`);
        fill = 0;
      };
      try {
        for await (const chunk of chunks) {
          for (let at = 0; at < chunk.length;) {
            if (fill === partBytes) await flush();
            const n = Math.min(partBytes - fill, chunk.length - at);
            part.set(chunk.subarray(at, at + n), fill);
            fill += n;
            at += n;
          }
        }
        if (!held) return await call('PUT', bucket, key, { body: part.subarray(0, fill) });
        await flush();
        return await call('POST', bucket, key, { query: `?${held}`, body: `<CompleteMultipartUpload>${parts.join('')}</CompleteMultipartUpload>` });
      } catch (err) {
        if (held) await call('DELETE', bucket, key, { query: `?${held}` }).catch(() => {});
        throw err;
      }
    };
    return {
      send: (bucket, key, chunks, { partBytes = s3.partBytes(env) } = {}) => send(bucket, key, chunks, partBytes),
      upload: (bucket, key, path, { partBytes = s3.partBytes(env) } = {}) => send(bucket, key, createReadStream(path, { highWaterMark: CHUNK }), partBytes),
      open: async (bucket, key) => opened(await call('GET', bucket, key)),
      delete: (bucket, key) => call('DELETE', bucket, key),
      list: async (bucket, prefix) => (await objects(bucket, prefix)).map((o) => o.key),
      objects,
    };
  },
};

export function nextFireAt(now = new Date(), hour = 4) {
  const d = new Date(now);
  d.setUTCHours(hour, 0, 0, 0);
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export function scheduleNightly({ run, dest, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, audit = () => {}, log = console.log, hour = 4 }) {
  const state = { lastAt: null, lastStatus: null, lastError: null, nextAt: null };
  let timer = null, stopped = false;
  const arm = () => {
    if (stopped) return;
    const next = nextFireAt(new Date(now()), hour);
    state.nextAt = next.toISOString();
    timer = setTimer(fire, Math.max(0, next.getTime() - now()));
    timer?.unref?.();
  };
  const fire = async () => {
    state.lastAt = new Date(now()).toISOString();
    try {
      const r = await run();
      state.lastStatus = 'completed';
      state.lastError = null;
      const orphans = r?.orphans?.count ?? 0;
      audit({ action: 'backup-completed', detail: { archive: r?.archive ?? null, bytes: r?.bytes ?? 0, orphans, dest } });
      log(`Backup ${r?.archive} (${r?.bytes} bytes, ${orphans} orphaned references) → ${dest}`);
    } catch (err) {
      state.lastStatus = 'failed';
      state.lastError = err.message;
      audit({ action: 'backup-failed', detail: { error: err.message, dest } });
      log(`Backup failed: ${err.message}`);
    }
    arm();
  };
  arm();
  return {
    status: () => ({ lastAt: state.lastAt, lastStatus: state.lastStatus, ...(state.lastError ? { lastError: state.lastError } : {}), nextAt: state.nextAt, dest, kind: destKind(dest) }),
    stop() { stopped = true; if (timer) clearTimer(timer); },
    fire,
  };
}

export const destKind = (dest) => (/^weave:\/\//.test(String(dest ?? '')) ? 'weave' : /^s3:\/\//.test(String(dest ?? '')) ? 's3' : null);

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const ARCHIVE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
export const CLOUD_QUOTA_BYTES = 5 * 1024 ** 3;

export const cloud = {
  parse(dest) {
    const m = String(dest ?? '').match(/^weave:\/\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/);
    if (!m) throw new WeaveError(`The destination must be weave://host/account[/archive], got '${dest}'`, 'invalid');
    const host = m[1].toLowerCase();
    try {
      return { host, origin: `${LOOPBACK.test(host) ? 'http' : 'https'}://${host}`, account: decodeURIComponent(m[2]), name: m[3] ? decodeURIComponent(m[3]) : null };
    } catch {
      throw new WeaveError(`The destination '${dest}' carries a malformed percent-escape`, 'invalid');
    }
  },
  token(env = process.env) {
    const token = String(env.WEAVE_BACKUP_TOKEN ?? '').trim();
    if (!token) throw new WeaveError('weave:// needs WEAVE_BACKUP_TOKEN: a wv_ token minted on the cloud account', 'invalid');
    if (!token.startsWith('wv_')) throw new WeaveError('WEAVE_BACKUP_TOKEN must be a wv_ account token', 'invalid');
    return token;
  },
  client({ dest, env = process.env, fetchImpl = fetch }) {
    const d = cloud.parse(dest);
    const token = cloud.token(env);
    const call = async (method, name = null, body = undefined) => {
      const url = `${d.origin}/api/backups${name ? `/${encodeURIComponent(name)}` : ''}`;
      const headers = { Authorization: `Bearer ${token}`, 'X-Weave-Account': encodeURIComponent(d.account), ...(body ? { 'Content-Type': 'application/octet-stream' } : {}) };
      const res = await fetchImpl(url, { method, headers, body, ...(typeof body?.getReader === 'function' ? { duplex: 'half' } : {}) });
      if (!res.ok) {
        let reason = '';
        try { reason = (await res.json()).error ?? ''; } catch {}
        throw new WeaveError(`${method} ${url} → ${res.status}${reason ? `: ${reason}` : ''}`, { 404: 'not-found', 403: 'forbidden', 413: 'too-large' }[res.status] ?? 'invalid');
      }
      return res;
    };
    return {
      ...d,
      put: async (name, body) => (await call('PUT', name, body)).json(),
      list: async () => (await call('GET')).json(),
      open: async (name) => opened(await call('GET', name)),
      migrate: async ({ name = null, slug = null, archive, key, workspace = null }) => {
        const url = `${d.origin}/api/workspaces`;
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, slug, from: `backup:${archive}`, key, workspace }),
        });
        if (!res.ok) {
          let reason = '';
          try { reason = (await res.json()).error ?? ''; } catch {}
          throw new WeaveError(`POST ${url} → ${res.status}${reason ? `: ${reason}` : ''}`, { 404: 'not-found', 403: 'forbidden', 409: 'conflict' }[res.status] ?? 'invalid');
        }
        return res.json();
      },
    };
  },
};

const notSealed = () => new WeaveError('weave cloud keeps encrypted archives only: this body is not one. Back up with WEAVE_BACKUP_PASSPHRASE set', 'invalid');

async function* sealedWithin(body, quota, counted) {
  let bytes = 0;
  for await (const chunk of Buffer.isBuffer(body) ? [body] : body) {
    const head = Math.min(MAGIC.length - bytes, chunk.length);
    if (head > 0 && !MAGIC.subarray(bytes, bytes + head).equals(chunk.subarray(0, head))) throw notSealed();
    bytes += chunk.length;
    if (bytes > quota) throw new WeaveError(`The archive runs past this account's quota of ${quota} bytes`, 'too-large');
    yield chunk;
  }
  if (!bytes) throw new WeaveError('The archive is empty', 'invalid');
  if (bytes < MAGIC.length) throw notSealed();
  counted(bytes);
}

export function cloudStore({ env = process.env, fetchImpl = fetch, now = null } = {}) {
  const bucket = String(env.WEAVE_BACKUP_BUCKET ?? '').trim();
  if (!bucket) return null;
  const quota = Number(env.WEAVE_BACKUP_QUOTA_BYTES) > 0 ? Math.floor(Number(env.WEAVE_BACKUP_QUOTA_BYTES)) : CLOUD_QUOTA_BYTES;
  const client = () => s3.client({ env, fetchImpl, now });
  const base = (account) => `${account}/`;
  const named = (name) => {
    if (!ARCHIVE_NAME.test(String(name ?? ''))) throw new WeaveError(`'${name}' is not an archive name: letters, digits, dot, dash and underscore, 200 at most`, 'invalid');
    return name;
  };
  const oldestFirst = (a, b) => (a.at === b.at ? (a.name < b.name ? -1 : 1) : (a.at ?? '') < (b.at ?? '') ? -1 : 1);
  const list = async (account) => (await client().objects(bucket, base(account)))
    .map((o) => ({ name: o.key.slice(base(account).length), bytes: o.bytes, at: o.at }))
    .filter((o) => o.name && !o.name.includes('/'))
    .sort(oldestFirst);
  return {
    quota,
    list,
    async put(account, name, body) {
      named(name);
      const c = client();
      let bytes = 0;
      await c.send(bucket, base(account) + name, sealedWithin(body, quota, (n) => { bytes = n; }));
      const others = (await list(account)).filter((o) => o.name !== name);
      const kept = [...others, { name, bytes, at: null }];
      const pruned = [];
      let used = kept.reduce((n, o) => n + o.bytes, 0);
      while (kept.length > 1 && (kept.length > RETAIN || used > quota)) {
        const gone = kept.shift();
        await c.delete(bucket, base(account) + gone.name);
        used -= gone.bytes;
        pruned.push(gone.name);
      }
      return { name, bytes, used, quota, kept: kept.length, pruned };
    },
    async open(account, name) {
      return client().open(bucket, base(account) + named(name));
    },
  };
}
