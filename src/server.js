import { createServer as createHttpServer } from 'node:http';
import { spawnSync, execFile } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, renameSync, copyFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, basename } from 'node:path';
import { gzipSync, brotliCompress, constants as zlibConstants } from 'node:zlib';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Weave, WeaveError, detachHubRegistry } from './engine.js';
import { workspaceName, workspaceSlug, nameFromFile, hostSlugRefusal, slugTaken, slugOfHost } from './workspace-name.js';
import { createRequestHandler, decodePath, MAX_BODY_BYTES } from './routes.js';
import { refuseOnDocs, ensureBugForm } from './forms.js';
import { createOidc, oidcFromEnv } from './oidc.js';
import { mailerFromEnv } from './mail-send.js';
import { billingFromEnv } from './billing.js';
import { createMinified } from './minify.js';
import { cloudStore, restore as restoreArchive, isEncrypted, inspect as inspectDb } from './backup.js';
import { armSchedules } from './schedule.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gitOut = (...a) => {
  const r = spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', timeout: 4000 });
  return r.status === 0 ? r.stdout.trim() : null;
};
const BUILD = { head: gitOut('rev-parse', 'HEAD'), remote: gitOut('remote')?.split('\n')[0] || null, latest: null, contains: null, checkedAt: 0, disk: null, diskCheckedAt: 0 };
export function servingCommit(head, directory) {
  return /^[a-f0-9]{40}$/.test(head ?? '') ? head : /^c([a-f0-9]{40})$/.exec(basename(directory))?.[1] ?? null;
}
const SERVING_COMMIT = servingCommit(BUILD.head, ROOT);
function refreshLatest() {
  BUILD.checkedAt = Date.now();
  if (!BUILD.remote) return;
  execFile('git', ['-C', ROOT, 'ls-remote', BUILD.remote, 'main'], { encoding: 'utf8', timeout: 4000 },
    async (err, out) => {
      if (err) return;
      const latest = (out ?? '').split(/\s/)[0] || null;
      BUILD.contains = latest ? await headContains(ROOT, latest, BUILD.head) : null;
      BUILD.latest = latest;
    });
}
export function headContains(root, sha, head = 'HEAD') {
  return new Promise((resolve) => execFile('git', ['-C', root, 'merge-base', '--is-ancestor', sha, head],
    { timeout: 4000 }, (err) => resolve(!err)));
}
function diskHead() {
  if (Date.now() - BUILD.diskCheckedAt > 5000) {
    BUILD.diskCheckedAt = Date.now();
    BUILD.disk = gitOut('rev-parse', 'HEAD');
  }
  return BUILD.disk;
}
export function describeBuild({ head, disk = null, latest = null, contains = null }) {
  if (!head) return null;
  return {
    sha: head.slice(0, 7),
    ...(disk ? { diskSha: disk.slice(0, 7), stale: disk !== head } : {}),
    ...(latest ? { latestSha: latest.slice(0, 7), behind: latest !== head && contains !== true } : {}),
  };
}
let RELEASE = null;
export function armReleaseCheck(check) { RELEASE = check; }
export function buildInfo() {
  const release = RELEASE?.status() ?? null;
  if (!BUILD.head) return SERVING_COMMIT ? { ...release, servingSha: SERVING_COMMIT } : release;
  if (Date.now() - BUILD.checkedAt > 5 * 60 * 1000) refreshLatest();
  return { ...describeBuild({ head: BUILD.head, disk: diskHead(), latest: BUILD.latest, contains: BUILD.contains }), ...release, servingSha: BUILD.head };
}
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/i;
const GZIP_MIN = 1024;

export function acceptsCoding(header, coding) {
  const q = {};
  for (const part of String(header ?? '').toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((x) => x.trim());
    if (!name) continue;
    const qp = params.find((x) => x.startsWith('q='));
    q[name] = qp ? Number(qp.slice(2)) : 1;
  }
  const v = q[coding] ?? q['*'];
  return v > 0;
}

export const acceptsGzip = (header) => acceptsCoding(header, 'gzip');

function brotliLater(cache, key, body, size) {
  cache.set(key, null);
  const params = { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: size };
  brotliCompress(body, { params }, (err, out) => (err ? cache.delete(key) : cache.set(key, out)));
}

export function gzipOutcome({ status, headers, body }, acceptEncoding, { cache = null, path = '' } = {}) {
  const type = headers['Content-Type'] ?? '';
  if (!COMPRESSIBLE.test(type) || headers['Content-Encoding']) return { headers, body };
  const vary = headers.Vary ? `${headers.Vary}, Accept-Encoding` : 'Accept-Encoding';
  const size = typeof body === 'string' ? Buffer.byteLength(body) : body?.length ?? 0;
  if (status !== 200 || size < GZIP_MIN) return { headers: { ...headers, Vary: vary }, body };
  const key = headers.ETag && !/\bprivate\b/.test(headers['Cache-Control'] ?? '') && `${path} ${headers.ETag}`;
  if (key && cache && acceptsCoding(acceptEncoding, 'br')) {
    const br = cache.get(`br ${key}`);
    if (br) return { headers: { ...headers, Vary: vary, 'Content-Encoding': 'br' }, body: br };
    if (br === undefined) brotliLater(cache, `br ${key}`, body, size);
  }
  if (!acceptsGzip(acceptEncoding)) return { headers: { ...headers, Vary: vary }, body };
  let zipped = key && cache?.get(key);
  if (!zipped) {
    zipped = gzipSync(body);
    if (key && cache) cache.set(key, zipped);
  }
  return { headers: { ...headers, Vary: vary, 'Content-Encoding': 'gzip' }, body: zipped };
}

export const etagMatches = (header, etag) => !!header && String(header).split(',').map((t) => t.trim().replace(/^W\//, '')).some((t) => t === '*' || t === etag.slice(2));

const API_PATH = /^(?:\/w\/[^/]+)?\/api\//;
export function revalidateApi(outcome, { method, path, ifNoneMatch }) {
  const { status, headers, body } = outcome;
  if (method !== 'GET' || status !== 200 || !API_PATH.test(path) || body == null
    || headers.ETag || headers['Cache-Control'] || headers['Set-Cookie'] || headers['Content-Encoding']) return outcome;
  const etag = `W/"${createHash('sha1').update(body).digest('base64url').slice(0, 22)}"`;
  const tagged = { ...headers, ETag: etag, 'Cache-Control': 'private, no-cache' };
  return etagMatches(ifNoneMatch, etag) ? { status: 304, headers: tagged, body: '' } : { status, headers: tagged, body };
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
export const requestIsHttps = (req, trustProxy) => !!req.socket?.encrypted
  || (trustProxy && String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase() === 'https');
export function crossSiteWrite(req, { origin = null, trustProxy = false } = {}) {
  if (!WRITES.has(req.method)) return false;
  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return true;
  const from = req.headers.origin;
  if (from === undefined) return false;
  const port = req.socket?.localPort;
  const own = `${requestIsHttps(req, trustProxy) ? 'https' : 'http'}://${String(req.headers.host ?? '').toLowerCase()}`;
  const ok = [own, origin, ...['localhost', '127.0.0.1', '[::1]'].map((h) => `http://${h}:${port}`)];
  return !ok.includes(String(from).toLowerCase());
}

export const CSP_REPORT_ONLY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
export const frameAncestorsFromEnv = (env = process.env) => String(env.WEAVE_FRAME_ANCESTORS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
export function securityHeaders(headers, { https = false, frameAncestors = [] } = {}) {
  const html = /^text\/html/i.test(headers['Content-Type'] ?? '');
  return {
    ...headers,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...(html ? {
      'Content-Security-Policy': [headers['Content-Security-Policy'], ["frame-ancestors 'self'", ...frameAncestors].join(' ')].filter(Boolean).join('; '),
      'Content-Security-Policy-Report-Only': CSP_REPORT_ONLY,
    } : {}),
    ...(https ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}

async function readBytes(req, max) {
  if (Number(req.headers['content-length']) > max) throw new WeaveError(`Body too large: ${max} bytes at most`, 'too-large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new WeaveError(`Body too large: ${max} bytes at most`, 'too-large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req, { requireJson = false, form = false } = {}) {
  const encoded = form && /^application\/x-www-form-urlencoded\s*(;|$)/i.test(req.headers['content-type'] ?? '');
  const maxSize = form ? 64 * 1024 : MAX_BODY_BYTES;
  if (Number(req.headers['content-length']) > maxSize) throw new WeaveError('Body too large', form ? 'too-large' : 'invalid');
  if (requireJson && !encoded && !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new WeaveError('A request with an Origin must send its body as application/json', 'invalid');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) throw new WeaveError('Body too large', form ? 'too-large' : 'invalid');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  if (encoded) {
    const params = new URLSearchParams(raw);
    return Object.fromEntries([...new Set(params.keys())].map((key) => [key, params.getAll(key).length > 1 ? params.getAll(key) : params.get(key)]));
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new WeaveError('Invalid JSON body', 'invalid');
  }
}

function hubRouting(dataDir) {
  const path = join(dataDir, '_hub.json');
  if (!existsSync(path)) return {};
  let routes;
  try { routes = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new WeaveError('The hub routing file is unreadable; restore _hub.json from backup', 'invalid'); }
  if (!routes || typeof routes !== 'object' || Array.isArray(routes) || Object.entries(routes).some(([from, to]) => !/^[^/]+\.(db|json)$/.test(from) || typeof to !== 'string' || !/^[^/]+\.(db|json)$/.test(to))) throw new WeaveError('The hub routing file is invalid; restore _hub.json from backup', 'invalid');
  return routes;
}

export function openDefaultWorkspace(dataPath, { actor } = {}) {
  const dir = dirname(dataPath);
  const routing = hubRouting(dir);
  const seen = new Set();
  while (Object.hasOwn(routing, basename(dataPath))) {
    if (seen.has(dataPath)) throw new WeaveError('The hub routing file contains a loop; restore _hub.json from backup', 'invalid');
    seen.add(dataPath);
    const next = join(dir, routing[basename(dataPath)]);
    if (!existsSync(next)) throw new WeaveError('The hub routing target is missing; restore the workspace from backup', 'not-found');
    dataPath = next;
  }
  const stem = (f) => f.split('/').pop().replace(/\.(json|db)$/, '');
  const taken = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(json|db)$/.test(f)).map(stem) : [];
  const name = nameFromFile(dataPath) ?? workspaceName({ taken }).slug;
  const w = new Weave({ path: dataPath, actor, name });
  if (!w.state.meta.name || w.state.meta.name === 'Weave Workspace') {
    w.state.meta.name = stem(dataPath);
    w.save();
  }
  return w;
}

export function createWorkspaceHub(defaultWeave, { workspaces = {}, walled = false } = {}) {
  const instances = new Map();
  let defaultName = defaultWeave.state.meta.name || 'workspace';
  instances.set(defaultName, defaultWeave);
  for (const [name, w] of Object.entries(workspaces)) instances.set(name, w);

  for (const w of instances.values()) w.localKeyAccess = false;

  const dataDir = defaultWeave.store.path ? dirname(defaultWeave.store.path) : null;
  const adoptedPaths = new Set([...instances.values()].map((w) => w.store.path).filter(Boolean));
  let migrationReady = false;
  const scan = () => {
    if (!dataDir) return;
    const added = [];
    for (const file of readdirSync(dataDir)) {
      if (file === '_hub.json' || !/\.(json|db)$/.test(file)) continue;
      const name = file.replace(/\.(json|db)$/, '');
      const dbPath = join(dataDir, `${name}.db`);
      if (instances.has(name) || adoptedPaths.has(dbPath) || added.some(x => x.path === dbPath)) continue;
      let w;
      try { w = new Weave({ path: join(dataDir, file) }); } catch { continue; }
      w.localKeyAccess = false;
      if (!w.state.meta.name || w.state.meta.name === 'Weave Workspace') {
        w.state.meta.name = name;
        w.save();
      }
      if (instances.has(w.state.meta.name)) { w.store.close?.(); continue; }
      added.push({ w, path: dbPath });
    }
    try {
      if (migrationReady && added.some(({ w }) => w.state.meta.registry === 'hub')) {
        if (![...instances.values()].includes(defaultWeave)) throw new WeaveError('This workspace needs its former registry restored before it can be opened', 'invalid');
        detachHubRegistry(defaultWeave, [...instances.values(), ...added.map(x => x.w)].filter(w => w !== defaultWeave));
      }
    } catch (error) {
      for (const { w } of added) w.store.close?.();
      throw error;
    }
    for (const { w, path } of added) {
      instances.set(w.state.meta.name, w);
      adoptedPaths.add(path);
    }
  };
  scan();
  detachHubRegistry(defaultWeave, [...instances.values()].filter(w => w !== defaultWeave));
  migrationReady = true;
  try { if (instances.has('weave')) ensureBugForm(instances.get('weave')); } catch {}
  const ordered = (entries, workspace) => {
    const rank = new Map((workspace?.state.meta.workspaceOrder ?? []).map((id, i) => [id, i]));
    return entries.map((entry, index) => ({ entry, index })).sort((a, b) => (rank.get(a.entry[1].state.meta.id) ?? Infinity) - (rank.get(b.entry[1].state.meta.id) ?? Infinity) || a.index - b.index).map(x => x.entry);
  };

  return {
    get defaultName() { return !instances.get(defaultName)?.state.meta.deletedAt && instances.has(defaultName) ? defaultName : [...instances].find(([, w]) => !w.state.meta.deletedAt)?.[0] ?? null; },
    walled,
    move(ref, position, { workspace, visible = () => true } = {}) {
      if (!Number.isInteger(position) || position < 0) throw new WeaveError('position must be a non-negative integer', 'invalid');
      const w = this.get(ref);
      if (!w || !visible(w)) throw new WeaveError(`Workspace '${ref}' not found`, 'not-found');
      const ids = this.list({ workspace }).filter(x => visible(this.get(x.id))).map(x => x.id).filter(id => id !== w.state.meta.id);
      ids.splice(Math.min(position, ids.length), 0, w.state.meta.id);
      if (workspace) {
        workspace.state.meta.workspaceOrder = ids;
        workspace.save();
      }
      return this.list({ workspace });
    },
    rename(oldName, newName) {
      const w = instances.get(oldName);
      if (!w) return;
      instances.delete(oldName);
      instances.set(newName, w);
      if (defaultName === oldName) defaultName = newName;
    },
    get(name) {
      const find = () => {
        if (instances.has(name)) return instances.get(name);
        const lower = String(name).toLowerCase();
        for (const [n, w] of instances) if (w.state.meta.id === name || n.toLowerCase() === lower) return w;
        return null;
      };
      return find() ?? (scan(), find());
    },
    bySlug(label) {
      const find = () => [...instances].find(([n, w]) => n.toLowerCase() === label && !w.state.meta.deletedAt)?.[1] ?? null;
      return find() ?? (scan(), find());
    },
    aliasOf(label) {
      return [...instances.values()].find((w) => w.state.meta.aliases?.includes(label)) ?? null;
    },
    list({ includeDeleted = false, workspace = null } = {}) {
      scan();
      for (const w of instances.values()) w.maybeRefresh();
      return ordered([...instances.entries()], workspace)
        .filter(([, w]) => includeDeleted || !w.state.meta.deletedAt)
        .map(([name, w]) => ({
          name,
          id: w.state.meta.id,
          url: `/w/${w.state.meta.id}/`,
          default: name === this.defaultName,
          spaces: w.listSpaces().length,
          tables: w.userTables().length,
          entities: Object.keys(w.state.entities).length,
          logo: !!w.state.meta.logo,
          deletedAt: w.state.meta.deletedAt ?? null,
          deletable: !!this.remove && name !== 'weave' && !w.state.meta.deletedAt && [...instances.values()].filter(x => !x.state.meta.deletedAt).length > 1,
        }));
    },
    remove(ref, { hard = false, actor = 'web' } = {}) {
      const w = this.get(ref);
      if (!w) throw new WeaveError(`Workspace '${ref}' not found`, 'not-found');
      const name = [...instances.entries()].find(([, x]) => x === w)?.[0];
      refuseOnDocs(w, 'deleted');
      if (!w.state.meta.deletedAt && [...instances.values()].filter(x => !x.state.meta.deletedAt).length === 1) throw new WeaveError('Create another workspace before deleting the last workspace', 'invalid');
      if (w.store.path && dataDir) {
        const next = [...instances.values()].find(x => x !== w && !x.state.meta.deletedAt && x.store.path);
        if (next) {
          const path = join(dataDir, '_hub.json');
          const routes = hubRouting(dataDir);
          for (const [from, to] of Object.entries(routes)) if (to === basename(w.store.path)) routes[from] = basename(next.store.path);
          delete routes[basename(next.store.path)];
          routes[basename(w.store.path)] = basename(next.store.path);
          const legacy = basename(w.store.path).replace(/\.db$/, '.json');
          routes[legacy] = basename(next.store.path);
          writeFileSync(`${path}.tmp`, JSON.stringify(routes));
          renameSync(`${path}.tmp`, path);
        }
      }
      if (!hard) {
        if (w.state.meta.deletedAt) return w;
        w.state.meta.deletedAt = new Date().toISOString();
        w.save();
        w.syncRegistry();
        w.auditWorkspace('workspace-trashed', name, actor);
        return w;
      }
      w.auditWorkspace('workspace-deleted', name, actor);
      const path = w.store.path;
      w.store.close?.();
      instances.delete(name);
      if (path) {
        adoptedPaths.delete(path);
        const trashDir = join(dirname(path), 'trash');
        mkdirSync(trashDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        for (const suffix of ['', '-wal', '-shm']) {
          if (existsSync(path + suffix)) renameSync(path + suffix, join(trashDir, `${name}-${stamp}.db${suffix}`));
        }
      }
      return { name, trashed: !!path };
    },
    restore(ref, { actor = 'web' } = {}) {
      const w = this.get(ref);
      if (!w) throw new WeaveError(`Workspace '${ref}' not found`, 'not-found');
      if (!w.state.meta.deletedAt) return w;
      w.state.meta.deletedAt = null;
      w.save();
      w.syncRegistry();
      w.auditWorkspace('workspace-restored', w.state.meta.name, actor);
      return w;
    },
    slugState(slug, self = null) {
      const refused = hostSlugRefusal(slug);
      if (refused) return refused.state;
      const held = this.get(slug) ?? this.aliasOf(slug);
      return held && held !== self ? 'taken' : 'available';
    },
    create(asked, { slug = null, from = null, actor = 'web' } = {}) {
      let title, name;
      if (slug != null && slug !== '') {
        name = String(slug);
        title = String(asked ?? '').trim() || name;
      } else if (asked == null || asked === '') {
        scan();
        ({ name: title, slug: name } = workspaceName({ taken: instances.keys() }));
      } else {
        title = String(asked).trim();
        name = workspaceSlug(asked);
      }
      const refused = hostSlugRefusal(name);
      if (refused) throw new WeaveError(refused.message, refused.code);
      const held = this.get(name);
      if (held?.state.meta.deletedAt) throw new WeaveError(`Workspace '${name}' is in the trash — restore it instead`, 'slug_taken');
      if (held || this.aliasOf(name)) throw new WeaveError(slugTaken(name).message, 'slug_taken');
      if (!dataDir) throw new WeaveError('In-memory hub cannot create workspaces', 'invalid');
      const target = join(dataDir, `${name}.db`);
      if (from) {
        if (existsSync(target)) throw new WeaveError(slugTaken(name).message, 'slug_taken');
        copyFileSync(from, target);
      }
      const w = new Weave({ path: target });
      w.localKeyAccess = false;
      if (from && w.state.meta.registry === 'hub') {
        w.store.close?.();
        for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true });
        throw new WeaveError('Restore the full legacy hub backup and migrate its registry before importing this workspace', 'invalid');
      }
      const twin = from && [...instances.entries()].find(([, x]) => x.state.meta.id === w.state.meta.id);
      if (twin) {
        w.store.close?.();
        for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true });
        throw new WeaveError(`This archive's workspace is already here as '${twin[0]}'`, 'conflict');
      }
      w.state.meta.name = name;
      if (from) { delete w.state.meta.title; w.state.meta.deletedAt = null; }
      if (title !== name) w.state.meta.title = title;
      w.save();
      if (walled) w.setRequireAuth(true);
      instances.set(name, w);
      adoptedPaths.add(w.store.path);
      w.auditWorkspace('workspace-created', name, actor);
      return w;
    },
    async createFrom(asked, { slug = null, archive, key, workspace = null, actor = 'web' } = {}) {
      if (!dataDir) throw new WeaveError('In-memory hub cannot create workspaces', 'invalid');
      const scratch = mkdtempSync(join(tmpdir(), 'weave-migrate-'));
      try {
        const sealed = join(scratch, 'archive.tar.enc');
        writeFileSync(sealed, archive);
        if (!isEncrypted(sealed)) throw new WeaveError('A migration takes a sealed archive only', 'invalid');
        const landed = join(scratch, 'data');
        const r = await restoreArchive({ source: sealed, dataDir: landed, env: { WEAVE_BACKUP_PASSPHRASE: String(key) } });
        const dbs = r.landed.filter((n) => /^[^/]+\.db$/.test(n));
        const pick = workspace != null && workspace !== '' ? `${workspace}.db` : dbs.length === 1 ? dbs[0] : null;
        if (!pick || !dbs.includes(pick)) {
          throw new WeaveError(`The archive holds ${dbs.map((n) => n.slice(0, -3)).join(', ') || 'no workspace'}: name the one to migrate as workspace`, 'invalid');
        }
        const from = join(landed, pick);
        const refs = inspectDb(from).refs.map((f) => f.id);
        const w = this.create(asked == null || asked === '' ? pick.slice(0, -3) : asked, { slug, from, actor });
        const blobs = join(dataDir, 'files');
        for (const id of new Set(refs)) {
          const src = join(landed, 'files', id);
          if (!existsSync(src) || existsSync(join(blobs, id))) continue;
          mkdirSync(blobs, { recursive: true });
          copyFileSync(src, join(blobs, id));
        }
        return w;
      } finally { rmSync(scratch, { recursive: true, force: true }); }
    },
    entries() {
      scan();
      for (const w of instances.values()) w.maybeRefresh();
      return [...instances.entries()];
    },
  };
}

export function originFromEnv(env = process.env, name = 'WEAVE_ORIGIN') {
  const raw = env[name]?.trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw new WeaveError(`${name} must be an absolute URL like https://weave.example.com (got '${raw}')`, 'invalid'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
    throw new WeaveError(`${name} must be a bare origin — scheme and host only, no path (got '${raw}')`, 'invalid');
  }
  return url.origin;
}
export const mcpOriginsFromEnv = (env = process.env) => String(env.WEAVE_MCP_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  .map((o) => originFromEnv({ WEAVE_MCP_ORIGINS: o }, 'WEAVE_MCP_ORIGINS'));
export const deployTokenFromEnv = (env = process.env) => (String(env.WEAVE_DEPLOY_TOKEN ?? '').length >= 32 ? env.WEAVE_DEPLOY_TOKEN : null);
export const clerkKeyFromEnv = (env = process.env) => (/^pk_(test|live)_[A-Za-z0-9+/=]+$/.test(String(env.WEAVE_CLERK_PUBLISHABLE_KEY ?? '').trim()) ? env.WEAVE_CLERK_PUBLISHABLE_KEY.trim() : null);
export function posthogFromEnv(env = process.env) {
  const key = String(env.POSTHOG_KEY ?? '').trim();
  if (!/^phc_[A-Za-z0-9_-]+$/.test(key)) return null;
  const host = (String(env.POSTHOG_HOST ?? '').trim() || 'https://us.i.posthog.com').replace(/\/+$/, '');
  return { key, host, assets: host.replace(/^(https:\/\/)(us|eu)\.i\.posthog\.com$/, '$1$2-assets.i.posthog.com') };
}
export function openSignupFromEnv(env = process.env) {
  const limit = Number.parseInt(env.WEAVE_SIGNUP_LIMIT ?? '', 10);
  return { on: ['1', 'true', 'yes'].includes(String(env.WEAVE_OPEN_SIGNUP ?? '').toLowerCase()), limit: limit > 0 ? limit : 1 };
}
export const trustProxyFromEnv = (env = process.env) => ['1', 'true', 'yes'].includes(String(env.WEAVE_TRUST_PROXY ?? '').toLowerCase());

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const hostnameOf = (host) => { try { return host ? new URL(`http://${host}`).hostname : null; } catch { return null; } };
export const allowedHostsFromEnv = (env = process.env) => String(env.WEAVE_ALLOWED_HOSTS ?? '').split(',').map((h) => hostnameOf(h.trim())).filter(Boolean);
export function baseDomainFromEnv(env = process.env) {
  const raw = env.WEAVE_BASE_DOMAIN?.trim().toLowerCase();
  if (!raw) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(raw)) {
    throw new WeaveError(`WEAVE_BASE_DOMAIN must be a bare host name like weave.example.com, no scheme, port or path (got '${raw}')`, 'invalid');
  }
  return raw;
}
export function hostAllowed(host, { origin = null, allowedHosts = [], baseDomain = null } = {}) {
  const name = hostnameOf(String(host ?? ''));
  if (!name) return false;
  const label = slugOfHost(name, baseDomain);
  return LOOPBACK_NAMES.has(name) || (!!origin && new URL(origin).hostname === name) || allowedHosts.includes(name)
    || (!!baseDomain && name === baseDomain) || (!!label && !label.includes('.'));
}
export function hostCheckFor({ host, env = process.env }) {
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
  if (loopback || env.WEAVE_ORIGIN?.trim() || env.WEAVE_MCP_ORIGINS?.trim() || env.WEAVE_BASE_DOMAIN?.trim() || allowedHostsFromEnv(env).length) return { enforce: true, warning: null };
  return { enforce: false, warning: `weave: bound to ${host} with neither WEAVE_ORIGIN nor WEAVE_ALLOWED_HOSTS set, so any Host header is answered; set one to refuse DNS-rebound requests` };
}

export function createAssetVersions(dir) {
  const known = new Map();
  const version = (file) => {
    const full = join(dir, file.replace(/\.\./g, ''));
    let st;
    try { st = statSync(full); } catch { return null; }
    if (!st.isFile()) return null;
    const hit = known.get(full);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.v;
    const v = createHash('sha1').update(readFileSync(full)).digest('hex').slice(0, 12);
    known.set(full, { mtimeMs: st.mtimeMs, size: st.size, v });
    return v;
  };
  const rewrite = (html) => html.replace(/(\b(?:src|href)="|\bfrom ")(\/[^"?#]+\.(?:js|mjs|css|svg|ico|png))"/g,
    (all, lead, url) => { const v = version(url); return v ? `${lead}${url}?v=${v}"` : all; });
  return { version, rewrite };
}
const IMMUTABLE = 'public, max-age=31536000, immutable';
const VENDOR_CACHE = 'public, max-age=3600';

const providerFromEnv = (env = process.env) => { const c = oidcFromEnv(env); return c ? createOidc(c) : null; };

export function createServer(defaultWeave, { workspaces = {}, build = () => null, backup = () => null, cloudBackups = cloudStore(), origin = originFromEnv(), trustProxy = trustProxyFromEnv(), limits, allowedHosts = allowedHostsFromEnv(), checkHost = true, frameAncestors = frameAncestorsFromEnv(), oidc = providerFromEnv(), mcpOrigins = mcpOriginsFromEnv(), mail = mailerFromEnv(), baseDomain = baseDomainFromEnv(), openSignup = openSignupFromEnv(), clerkKey = clerkKeyFromEnv(), deployToken = deployTokenFromEnv(), billing = billingFromEnv(), posthog = posthogFromEnv(), scheduleEvery = 60_000, authProbeEvery = 0 } = {}) {
  const hub = createWorkspaceHub(defaultWeave, { workspaces, walled: !!origin });
  const schedules = armSchedules(() => {
    for (const { name } of hub.list()) {
      try { hub.get(name)?.runSchedules(); } catch (err) { console.error(`weave: schedules on '${name}' failed: ${err?.message ?? err}`); }
    }
  }, { every: scheduleEvery });
  let signIn = null;
  const probeSignIn = () => oidc.probe({ redirectUri: origin ? `${origin}/api/auth/oidc/callback` : null }).then((s) => {
    if (!s.ok) console.error(`weave: sign-in is broken: ${oidc.name} answered ${s.status ?? 'nothing'} ${s.code} to the client-credential probe at its token endpoint${s.detail ? ` (${s.detail})` : ''}`);
    signIn = s;
  }, (err) => console.error(`weave: the sign-in probe failed: ${err?.message ?? err}`));
  const signInProbe = oidc?.probe && authProbeEvery > 0 ? setInterval(probeSignIn, authProbeEvery) : null;
  if (signInProbe) { signInProbe.unref?.(); probeSignIn(); }
  const answers = [...allowedHosts, ...mcpOrigins.map((o) => new URL(o).hostname)];
  const publicNames = origin ? [new URL(origin).hostname, ...mcpOrigins.map((o) => new URL(o).hostname)] : [];
  const elsewhere = new Set(origin ? allowedHosts.filter((h) => !LOOPBACK_NAMES.has(h) && !publicNames.includes(h)) : []);
  const NOT_A_PAGE = /^(?:\/w\/[^/]+)?\/(?:api|mcp|ingest)(?:\/|$)|^\/(?:_supervisor|\.well-known)\//;

  const assets = createAssetVersions(PUBLIC_DIR);
  const minified = createMinified();
  const serveStatic = (path, rx, { head = null } = {}) => {
    const file = path === '/' ? '/index.html'
      : path === '/favicon.ico' ? '/brand/favicon.ico'
      : path === '/vendor/vditor/dist/js/mermaid/mermaid.min.js' ? '/vendor/mermaid.min.js'
      : path;
    const full = join(PUBLIC_DIR, file.replace(/\.\./g, ''));
    if (!existsSync(full) || full.endsWith('/')) return null;
    const match = rx?.header?.('if-none-match');
    const matches = (etag) => etagMatches(match, etag);
    if (file === '/index.html') {
      const raw = readFileSync(full, 'utf8');
      const shell = posthog ? raw.replace('<script src="/app.js" defer></script>', (tag) => `<script src="/consent.js" data-posthog-key="${posthog.key}" defer></script>\n${tag}`) : raw;
      const body = assets.rewrite(head ? shell.replace(/<title>[^<]*<\/title>/, () => head) : shell);
      const headers = {
        'Content-Type': MIME['.html'],
        'Cache-Control': 'no-cache',
        ETag: `W/"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
      };
      return matches(headers.ETag) ? { status: 304, headers, body: '' } : { status: 200, headers, body };
    }
    const v = rx?.searchParams?.get?.('v');
    const st = statSync(full);
    const { mtime, size } = st;
    const headers = {
      'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
      'Cache-Control': v ? (v === assets.version(file) ? IMMUTABLE : 'no-cache') : file.startsWith('/vendor/') ? VENDOR_CACHE : 'no-cache',
      'Last-Modified': mtime.toUTCString(),
      ETag: `W/"${size.toString(16)}-${Math.floor(mtime.getTime()).toString(16)}"`,
    };
    const read = () => (/\.(?:m?js|css)$/.test(file) && !file.startsWith('/vendor/') ? minified(full, st, () => readFileSync(full)) : readFileSync(full));
    if (match) return matches(headers.ETag) ? { status: 304, headers, body: '' } : { status: 200, headers, body: read() };
    const since = Date.parse(rx?.header?.('if-modified-since') ?? '');
    if (since && Math.floor(mtime.getTime() / 1000) <= Math.floor(since / 1000)) {
      return { status: 304, headers, body: '' };
    }
    return { status: 200, headers, body: read() };
  };

  const handle = createRequestHandler(hub, {
    version: VERSION,
    uptime: () => process.uptime(),
    build,
    backup,
    cloudBackups,
    serveStatic,
    origin,
    trustProxy,
    oidc,
    mcpOrigins,
    mail,
    baseDomain,
    billing,
    openSignup,
    clerkKey,
    posthog,
    signIn: () => signIn,
    ...(limits ? { limits } : {}),
  });

  const gzCache = new Map();
  const secure = (req, headers) => securityHeaders(headers, { https: requestIsHttps(req, trustProxy), frameAncestors });
  const fail = (res, status, error, code) => {
    if (res.headersSent) return res.destroy();
    res.writeHead(status, secure(res.req, { 'Content-Type': 'application/json' }));
    res.end(JSON.stringify({ error, code }));
  };
  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let path;
      try { path = decodePath(url.pathname); } catch { return fail(res, 400, 'Malformed percent-escape in the path', 'invalid'); }
      if (checkHost && path !== '/api/health' && !hostAllowed(req.headers.host, { origin, allowedHosts: answers, baseDomain })) {
        return fail(res, 421, 'This server does not answer to that Host; add it to WEAVE_ALLOWED_HOSTS', 'misdirected');
      }
      if (elsewhere.size && ['GET', 'HEAD'].includes(req.method) && elsewhere.has(hostnameOf(String(req.headers.host ?? ''))) && !NOT_A_PAGE.test(path)) {
        res.writeHead(308, secure(req, { Location: `${origin}${req.url}`, 'Cache-Control': 'no-store' }));
        return res.end();
      }
      if (path === '/_supervisor/workspaces' && deployToken) {
        const given = Buffer.from(String(req.headers.authorization ?? ''));
        const want = Buffer.from(`Bearer ${deployToken}`);
        if (given.length !== want.length || !timingSafeEqual(given, want)) return fail(res, 401, 'unauthorized', 'unauthorized');
        if (req.method !== 'GET') return fail(res, 405, 'GET only', 'method-not-allowed');
        res.writeHead(200, secure(req, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }));
        return res.end(JSON.stringify(hub.list().map(({ name }) => ({ name, requireAuth: !!hub.get(name).state.meta.requireAuth }))));
      }
      if (crossSiteWrite(req, { origin, trustProxy })) return fail(res, 403, 'Cross-site write refused', 'forbidden');
      const outcome = await handle({
        method: req.method,
        path,
        searchParams: url.searchParams,
        header: (name) => req.headers[name.toLowerCase()],
        readBody: () => readBody(req, { requireJson: req.headers.origin !== undefined, form: req.method === 'POST' && /^(?:\/w\/[^/]+)?(?:\/s\/wv[sv]_[A-Za-z0-9_-]+)?\/api\/forms\/[^/]+\/submit$/.test(path) }),
        readBytes: (max) => readBytes(req, max),
        remote: req.socket?.remoteAddress ?? null,
      });
      const fresh = revalidateApi(outcome, { method: req.method, path, ifNoneMatch: req.headers['if-none-match'] });
      const { headers, body } = gzipOutcome(fresh, req.headers['accept-encoding'], { cache: gzCache, path: url.pathname });
      res.writeHead(fresh.status, secure(req, headers));
      res.end(body);
    } catch (err) {
      console.error(`weave: ${req.method} ${req.url} failed:`, err);
      fail(res, 500, 'Internal error', 'internal');
    }
  });
  server.on('close', () => { schedules.stop(); if (signInProbe) clearInterval(signInProbe); });
  return server;
}

export function startServer(weave, { port = 4400, host = '127.0.0.1', workspaces = {}, build = () => null, backup = () => null, cloudBackups, origin, trustProxy, limits, allowedHosts, frameAncestors, oidc, mcpOrigins, mail, baseDomain, openSignup, clerkKey, deployToken, billing, posthog, scheduleEvery, authProbeEvery } = {}) {
  const { enforce, warning } = origin || allowedHosts?.length || mcpOrigins?.length || baseDomain ? { enforce: true, warning: null } : hostCheckFor({ host });
  if (warning) console.warn(warning);
  const server = createServer(weave, { workspaces, build, backup, limits, ...(cloudBackups !== undefined ? { cloudBackups } : {}), checkHost: enforce, ...(origin !== undefined ? { origin } : {}), ...(trustProxy !== undefined ? { trustProxy } : {}), ...(allowedHosts !== undefined ? { allowedHosts } : {}), ...(frameAncestors !== undefined ? { frameAncestors } : {}), ...(oidc !== undefined ? { oidc } : {}), ...(mcpOrigins !== undefined ? { mcpOrigins } : {}), ...(mail !== undefined ? { mail } : {}), ...(baseDomain !== undefined ? { baseDomain } : {}), ...(openSignup !== undefined ? { openSignup } : {}), ...(clerkKey !== undefined ? { clerkKey } : {}), ...(deployToken !== undefined ? { deployToken } : {}), ...(billing !== undefined ? { billing } : {}), ...(posthog !== undefined ? { posthog } : {}), ...(scheduleEvery !== undefined ? { scheduleEvery } : {}), ...(authProbeEvery !== undefined ? { authProbeEvery } : {}) });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}
