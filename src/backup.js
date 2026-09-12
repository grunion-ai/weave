/* Backup and restore (Feature #222 phase 3; Feature #209; Issue #250).

   A weave instance is a directory: one `.db` per workspace, `files/` of
   attachment blobs shared by all of them, `keystore.json`, and — on a laptop
   — `keystore.key` beside it. A backup is those minus the key, in one tar:

     alpha.db beta.db …      VACUUM INTO snapshots: safe against the live
                             writer, the WAL folded in, rollback-journal mode
     files/<id>              every blob present (one workspace: its own)
     keystore.json           sealed by its own key; useless alone
     manifest.json           LAST: entries + sha256, counts, weave version,
                             the orphan report

   Sealed with AES-256-GCM under a scrypt key when any passphrase exists:
   WEAVE_BACKUP_PASSPHRASE, else WEAVE_KEYSTORE_PASSPHRASE, else the contents
   of keystore.key. `keystore.key` itself NEVER goes into the archive — the
   pair in one place is the leak the keystore exists to survive — so the key
   material is what seals the archive instead, and the restore side needs it
   from the operator's hand.

   The orphan report (Issue #250): a reference in a `.db` to a blob that is
   not in `files/` is counted and listed, never fatal. A backup cannot copy
   bytes that are not there, and going red nightly over a source defect
   would train everyone to ignore red.

   ponytail: stdlib only — node:sqlite for the snapshot, node:crypto for the
   seal and the SigV4 signer, a ~90-line POSIX ustar writer/reader because
   Node has no tar module. rclone, Litestream and tar(1) are the upgrades and
   the Handbook says where each one goes. The archive is built as a file and
   read back into memory whole; a workspace big enough to make that hurt has
   outgrown a nightly tar. */
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync,
  openSync, readSync, writeSync, closeSync, mkdtempSync, rmSync, copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { WeaveError } from './store.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* checked at use */ }

const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

export const ARCHIVE_PREFIX = 'weave-backup-';
/* Thirty daily archives, the spec's number (Feature #222 Part 4). */
export const RETAIN = 30;
const CHUNK = 1024 * 1024;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/* ------------------------------------------------------------ ustar */

const BLOCK = 512;
const octal = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';

/* One POSIX ustar header. Names over 100 bytes split at a '/' into the
   155-byte prefix field — the standard way, so tar(1) reads it too. */
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

/* Append-as-you-go writer: each add() streams one entry (a Buffer, or a file
   read in chunks) and hands back its digest, so the manifest can be the last
   entry without a second pass over the data. */
export function tarWriter(out, { mtime = Math.floor(Date.now() / 1000) } = {}) {
  const fd = openSync(out, 'w');
  return {
    add(e) {
      const size = e.data ? e.data.length : statSync(e.path).size;
      writeSync(fd, header(e.name, size, e.mtime ?? mtime));
      const hash = createHash('sha256');
      if (e.data) { writeSync(fd, e.data); hash.update(e.data); } else {
        const src = openSync(e.path, 'r');
        try {
          const buf = Buffer.alloc(CHUNK);
          for (let n; (n = readSync(src, buf, 0, CHUNK, null)) > 0;) { writeSync(fd, buf, 0, n); hash.update(buf.subarray(0, n)); }
        } finally { closeSync(src); }
      }
      const pad = (BLOCK - (size % BLOCK)) % BLOCK;
      if (pad) writeSync(fd, Buffer.alloc(pad));
      return { name: e.name, bytes: size, sha256: hash.digest('hex') };
    },
    close() { writeSync(fd, Buffer.alloc(2 * BLOCK)); closeSync(fd); },
  };
}

export function packTar(out, entries) {
  const t = tarWriter(out);
  const digests = entries.map((e) => t.add(e));
  t.close();
  return digests;
}

const field = (h, off, len) => h.toString('utf8', off, off + len).replace(/\0.*$/s, '');

/* Regular files only; a header that fails its own checksum stops the read
   rather than yielding whatever the bytes happen to say. */
export function readTar(path) {
  const buf = readFileSync(path);
  const entries = [];
  for (let off = 0; off + BLOCK <= buf.length; ) {
    const h = buf.subarray(off, off + BLOCK);
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
    if (sum !== parseInt(field(h, 148, 8).trim(), 8)) throw new WeaveError(`Tar header checksum mismatch at byte ${off}`, 'invalid');
    const size = parseInt(field(h, 124, 12).trim(), 8);
    const prefix = field(h, 345, 155);
    const name = (prefix ? `${prefix}/` : '') + field(h, 0, 100);
    const type = h[156];
    off += BLOCK;
    if (type === 0x30 || type === 0) entries.push({ name, data: buf.subarray(off, off + size) });
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return entries;
}

/* ------------------------------------------------------------ the seal */

/* Envelope: "WVBK1\0" · 16-byte salt · 12-byte iv · ciphertext · 16-byte tag.
   scrypt (N=16384, the node default) stretches the passphrase; GCM makes a
   wrong passphrase or a flipped byte fail loudly at the end, and nothing
   half-decrypted is left on disk when it does. */
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

export function encryptFile(src, dst, passphrase) {
  const salt = randomBytes(16), iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', scryptSync(String(passphrase), salt, 32), iv);
  const s = openSync(src, 'r'), d = openSync(dst, 'w');
  try {
    writeSync(d, Buffer.concat([MAGIC, salt, iv]));
    pump(s, d, (c) => cipher.update(c));
    writeSync(d, cipher.final());
    writeSync(d, cipher.getAuthTag());
  } finally { closeSync(s); closeSync(d); }
}

export function decryptFile(src, dst, passphrase) {
  const size = statSync(src).size;
  const headLen = MAGIC.length + 16 + 12;
  if (size < headLen + 16 || !isEncrypted(src)) throw new WeaveError('Not an encrypted weave archive', 'invalid');
  const s = openSync(src, 'r');
  let d = null;
  try {
    const head = Buffer.alloc(headLen);
    readSync(s, head, 0, headLen, 0);
    const tag = Buffer.alloc(16);
    readSync(s, tag, 0, 16, size - 16);
    const salt = head.subarray(MAGIC.length, MAGIC.length + 16), iv = head.subarray(MAGIC.length + 16);
    const decipher = createDecipheriv('aes-256-gcm', scryptSync(String(passphrase), salt, 32), iv);
    decipher.setAuthTag(tag);
    d = openSync(dst, 'w');
    pump(s, d, (c) => decipher.update(c), { start: headLen, end: size - 16 });
    try { writeSync(d, decipher.final()); } catch {
      closeSync(d); d = null;
      rmSync(dst, { force: true });
      throw new WeaveError('Cannot decrypt the archive — wrong passphrase, or the archive was altered', 'invalid');
    }
  } finally { closeSync(s); if (d != null) closeSync(d); }
}

/* Where the material comes from, in order. --passphrase-env names one
   variable and nothing else counts; otherwise the backup passphrase, the
   keystore passphrase (the hosted deployment already has it in the
   environment), then the key file's contents (the laptop). None → plain. */
export const keystorePath = (env, dataDir) => env.WEAVE_KEYSTORE || join(dataDir, 'keystore.json');
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
  } catch { /* no key file */ }
  return null;
}

/* ------------------------------------------------------------ the data dir */

/* Same reading as the laptop script (~/bin/weave-backup): every .db is a
   workspace, -wal/-shm are the live writer's and meaningless without it,
   keystore.key is the one file that stays home, trash/ is not a workspace. */
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

/* VACUUM INTO from a throwaway connection: a read transaction in WAL mode,
   so a writer mid-request neither blocks it nor lands in it; the copy comes
   out compacted, checkpointed and in rollback-journal mode with no sidecars. */
export function snapshot(src, dst) {
  needSqlite();
  rmSync(dst, { force: true }); // VACUUM INTO refuses an existing file
  const db = new DatabaseSync(src);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(`VACUUM INTO '${dst.replace(/'/g, "''")}'`);
  } finally { db.close(); }
}

/* Live entity count (what /api/health reports) and every blob the rows
   point at, trashed rows included — a trashed row's attachment is still a
   reference the restore will show as a dead link. One unparseable row is
   skipped, not fatal. */
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
      for (const f of e.files ?? []) if (f?.id) refs.push({ id: String(f.id), name: f.name ?? '' });
    }
    return { entities, refs };
  } finally { db.close(); }
}

const stamp = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');

/* ------------------------------------------------------------ backup */

export async function backup({
  dataDir, out = process.cwd(), dest = null, env = process.env, passphraseEnv = null,
  workspace = null, now = () => new Date(), fetchImpl = fetch, keep = true,
}) {
  needSqlite();
  dataDir = resolve(dataDir);
  if (!existsSync(dataDir) || !statSync(dataDir).isDirectory()) throw new WeaveError(`Data directory not found: ${dataDir}`, 'not-found');
  dest = dest || env.WEAVE_BACKUP_DEST || null;
  const passphrase = resolvePassphrase({ env, dataDir, passphraseEnv });
  const c = classify(readdirSync(dataDir, { withFileTypes: true }));
  const dbs = workspace ? c.databases.filter((n) => n === `${workspace}.db`) : c.databases;
  if (!dbs.length) throw new WeaveError(workspace ? `No workspace '${workspace}' in ${dataDir}` : `No .db files in ${dataDir}`, 'not-found');

  const archive = `${ARCHIVE_PREFIX}${workspace ?? 'all'}-${stamp(now())}.tar${passphrase ? '.enc' : ''}`;
  const outPath = /\.tar(\.enc)?$/.test(out) ? resolve(out) : join(resolve(out), archive);
  mkdirSync(dirname(outPath), { recursive: true });

  const scratch = mkdtempSync(join(tmpdir(), 'weave-backup-'));
  const result = { archive, path: outPath, bytes: 0, encrypted: !!passphrase, workspaces: {}, files: 0, orphans: { count: 0, list: [] }, uploaded: null, pruned: [] };
  try {
    const tarPath = join(scratch, 'archive.tar');
    const t = tarWriter(tarPath);
    const entries = [];
    const filesDir = join(dataDir, 'files');
    const present = new Set(c.dirs.includes('files')
      ? readdirSync(filesDir).filter((f) => { try { return statSync(join(filesDir, f)).isFile(); } catch { return false; } })
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
    // The whole blob store for a whole-instance backup — an unreferenced blob
    // costs bytes, a missing one costs a file. One workspace takes its own.
    const blobs = [...(workspace ? [...referenced].filter((id) => present.has(id)) : present)].sort();
    for (const id of blobs) entries.push(t.add({ name: `files/${id}`, path: join(filesDir, id) }));
    result.files = blobs.length;
    const ks = keystorePath(env, dataDir);
    if (existsSync(ks)) entries.push(t.add({ name: 'keystore.json', path: ks }));
    const manifest = {
      format: 'weave-backup/1', weave: VERSION, createdAt: now().toISOString(), workspace: workspace ?? 'all',
      encrypted: !!passphrase, entries, workspaces: result.workspaces, files: result.files, orphans: result.orphans,
    };
    t.add({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 1)) });
    t.close();
    if (passphrase) encryptFile(tarPath, outPath, passphrase);
    else copyFileSync(tarPath, outPath); // not rename: the out dir may be another volume
    result.bytes = statSync(outPath).size;

    if (dest) {
      const { bucket, prefix } = s3.parse(dest);
      const client = s3.client({ env, fetchImpl, now });
      const key = prefix ? `${prefix}/${archive}` : archive;
      await client.put(bucket, key, readFileSync(outPath));
      result.uploaded = key;
      /* Retention runs only after a successful upload, and only over our own
         names: anything else under the prefix is not ours to delete. The
         ISO stamp in the name sorts chronologically, so the oldest are the
         first N past the cap.
         ponytail: one ListObjectsV2 page (1000 keys) — thirty kept means the
         prefix never grows past a page unless something else fills it. */
      const ours = (await client.list(bucket, prefix ? `${prefix}/${ARCHIVE_PREFIX}` : ARCHIVE_PREFIX)).sort();
      for (const k of ours.slice(0, Math.max(0, ours.length - RETAIN))) {
        await client.delete(bucket, k);
        result.pruned.push(k);
      }
    }
    return result;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    if (!keep) { rmSync(outPath, { force: true }); result.path = null; }
  }
}

/* ------------------------------------------------------------ restore */

/* Is anyone holding this database? Two readings, either one refuses:
   1. a -wal or -shm sidecar beside it — SQLite removes both when the last
      connection closes cleanly, so their presence means a connection is
      open (a running server) or a process died mid-write (and the WAL then
      holds pages a plain overwrite would lose);
   2. `BEGIN IMMEDIATE` with no busy timeout fails — a writer is inside a
      transaction right now.
   A server idling on the file passes (2) and fails (1), which is why both
   are needed. --force says the operator knows better. */
export function heldOpen(dbPath) {
  if (existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`)) return true;
  if (!DatabaseSync) return false;
  let db = null;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 0');
    db.exec('BEGIN IMMEDIATE');
    db.exec('ROLLBACK');
    return false;
  } catch (err) {
    return /locked|busy/i.test(err.message);
  } finally { db?.close(); }
}

export async function restore({ source, dataDir, env = process.env, passphraseEnv = null, force = false, fetchImpl = fetch }) {
  dataDir = resolve(dataDir);
  mkdirSync(dataDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'weave-restore-'));
  try {
    let local = join(scratch, 'source');
    if (/^s3:\/\//.test(source)) {
      const { bucket, prefix: key } = s3.parse(source);
      writeFileSync(local, await s3.client({ env, fetchImpl }).get(bucket, key));
    } else if (/^https?:\/\//.test(source)) {
      const res = await fetchImpl(source);
      if (!res.ok) throw new WeaveError(`GET ${source} → ${res.status}`, 'not-found');
      writeFileSync(local, Buffer.from(await res.arrayBuffer()));
    } else {
      if (!existsSync(source)) throw new WeaveError(`Archive not found: ${source}`, 'not-found');
      local = resolve(source);
    }
    let tarPath = local;
    if (isEncrypted(local)) {
      const passphrase = resolvePassphrase({ env, dataDir, passphraseEnv });
      if (!passphrase) throw new WeaveError('The archive is encrypted — set WEAVE_BACKUP_PASSPHRASE (or WEAVE_KEYSTORE_PASSPHRASE, or --passphrase-env NAME) to the passphrase it was sealed with', 'invalid');
      tarPath = join(scratch, 'plain.tar');
      decryptFile(local, tarPath, passphrase);
    }
    const entries = readTar(tarPath);
    const mf = entries.find((e) => e.name === 'manifest.json');
    if (!mf) throw new WeaveError('Not a weave backup: the archive has no manifest.json', 'invalid');
    const manifest = JSON.parse(mf.data.toString('utf8'));
    let verified = 0;
    for (const m of manifest.entries ?? []) {
      const e = entries.find((x) => x.name === m.name);
      if (!e) throw new WeaveError(`The archive is missing ${m.name} that its manifest lists`, 'invalid');
      if (sha256(e.data) !== m.sha256) throw new WeaveError(`sha256 mismatch on ${m.name}: the archive does not match its manifest`, 'invalid');
      verified += 1;
    }
    const landing = entries.filter((e) => e.name !== 'manifest.json' && e.name !== 'keystore.key' && !e.name.split('/').includes('..') && !e.name.startsWith('/'));
    for (const e of landing.filter((x) => /^[^/]+\.db$/.test(x.name))) {
      const target = join(dataDir, e.name);
      if (!existsSync(target)) continue;
      if (!force && heldOpen(target)) throw new WeaveError(`${target} is held open — a -wal/-shm sidecar is beside it or a writer holds its lock. Stop the server first (or pass --force)`, 'conflict');
      if (!force) throw new WeaveError(`${target} exists — pass --force to overwrite it`, 'conflict');
    }
    const ks = join(dataDir, 'keystore.json');
    if (!force && landing.some((e) => e.name === 'keystore.json') && existsSync(ks)) throw new WeaveError(`${ks} exists — pass --force to overwrite it`, 'conflict');

    const landed = [];
    for (const e of landing) {
      const target = join(dataDir, e.name);
      mkdirSync(dirname(target), { recursive: true });
      // A stale sidecar beside a restored database is how a restore is lost.
      if (e.name.endsWith('.db')) for (const s of ['-wal', '-shm']) rmSync(target + s, { force: true });
      writeFileSync(target, e.data, e.name === 'keystore.json' ? { mode: 0o600 } : undefined);
      landed.push(e.name);
    }
    return {
      dataDir, landed, verified,
      workspaces: manifest.workspaces ?? {}, orphans: manifest.orphans ?? { count: 0, list: [] },
      archive: { weave: manifest.weave, createdAt: manifest.createdAt, workspace: manifest.workspace },
    };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

/* ------------------------------------------------------------ SigV4 */

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
/* RFC 3986 unreserved only — what S3's canonical URI and query want
   (S3 is signed on the single-encoded path, never double-encoded). */
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/* AWS Signature Version 4 over fetch: the four canonical steps from the S3
   reference (Authenticating Requests: Using the Authorization Header),
   verified against its worked examples in test/backup.test.mjs. R2, B2 and
   S3 all take this. */
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

/* The four verbs the backup needs and nothing more: PUT, GET, DELETE, and one
   page of ListObjectsV2. Endpoint set (R2, B2, MinIO) → path-style
   `endpoint/bucket/key`; unset → AWS virtual-hosted on the region. */
export const s3 = {
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
    const call = async (method, bucket, key, { query = '', body = '' } = {}) => {
      const url = s3.url({ bucket, key, endpoint: c.endpoint, region: c.region }) + query;
      const headers = signV4({ method, url, body, keyId: c.keyId, secret: c.secret, region: c.region, now: now ? now() : new Date() });
      const res = await fetchImpl(url, { method, headers, body: body.length ? body : undefined });
      if (!res.ok) throw new WeaveError(`${method} ${key || bucket} → ${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 200)}`.trim(), res.status === 404 ? 'not-found' : 'invalid');
      return res;
    };
    return {
      put: (bucket, key, body) => call('PUT', bucket, key, { body }),
      get: async (bucket, key) => Buffer.from(await (await call('GET', bucket, key)).arrayBuffer()),
      delete: (bucket, key) => call('DELETE', bucket, key),
      list: async (bucket, prefix) => {
        const xml = await (await call('GET', bucket, '', { query: `?list-type=2&prefix=${uriEncode(prefix)}` })).text();
        return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => unxml(m[1]));
      },
    };
  },
};

/* ------------------------------------------------------------ the nightly */

/* 04:00 UTC — the spec's hour, and after every timezone's midnight but
   Honolulu's. Strictly after `now`, so a run at 04:00 sharp arms tomorrow. */
export function nextFireAt(now = new Date(), hour = 4) {
  const d = new Date(now);
  d.setUTCHours(hour, 0, 0, 0);
  if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/* A setTimeout chain, not cron: one timer to the next 04:00, re-armed after
   each run whether it passed or failed. In-process because a platform cron
   service cannot share the volume (Railway) and a sidecar is one more thing
   to run; the timer is unref'd so it never keeps a stopping server alive.
   `audit` receives {action, detail} — the caller stamps at and actor. */
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
    status: () => ({ lastAt: state.lastAt, lastStatus: state.lastStatus, ...(state.lastError ? { lastError: state.lastError } : {}), nextAt: state.nextAt, dest }),
    stop() { stopped = true; if (timer) clearTimer(timer); },
    fire,
  };
}
