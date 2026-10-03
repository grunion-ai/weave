import { createServer as createHttpServer } from 'node:http';
import { spawnSync, execFile } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Weave, WeaveError } from './engine.js';
import { workspaceName, nameFromFile } from './workspace-name.js';
import { createRequestHandler } from './routes.js';
import { createOidc, oidcFromEnv } from './oidc.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
// The version weave actually is — read at load, never hardcoded (Issue #19).
export const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

/* ---------- build staleness (Kyle, 2026-09-02) ----------
   "my local should always be on the latest and should show a toast when it
   is not." The node adapter reads its own checkout: HEAD at boot, the first
   remote's main lazily (never blocking a request, at most every 5 minutes,
   4s timeout so an offline instance stays silent). /api/health carries
   {sha, latestSha, behind} and the UI raises the toast.

   The disk head rides along too (Issue #114). Static assets are read from
   disk per request; src/* is loaded once at boot — so a checkout that moves
   under a running process serves NEW app.js against an OLD engine, and row
   creation fails silently until someone restarts it. `behind` cannot carry
   that: it compares the boot HEAD to the REMOTE, it is lazy (the first health
   call after a boot has no verdict at all), it is absent whenever ls-remote
   fails, and its remedy is a pull. This one is local, synchronous, and fixed
   by a restart. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gitOut = (...a) => {
  const r = spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', timeout: 4000 });
  return r.status === 0 ? r.stdout.trim() : null;
};
const BUILD = { head: gitOut('rev-parse', 'HEAD'), remote: gitOut('remote')?.split('\n')[0] || null, latest: null, contains: null, checkedAt: 0, disk: null, diskCheckedAt: 0 };
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
/* Does this checkout already carry `sha`? A sha the local store never fetched
   fails the check, which is the right answer: HEAD lacks it (Issue #459). */
export function headContains(root, sha, head = 'HEAD') {
  return new Promise((resolve) => execFile('git', ['-C', root, 'merge-base', '--is-ancestor', sha, head],
    { timeout: 4000 }, (err) => resolve(!err)));
}
/* The HEAD the next static asset will be served from. Read for real, at most
   every 5s: the whole point is that it can differ from the one in memory. */
function diskHead() {
  if (Date.now() - BUILD.diskCheckedAt > 5000) {
    BUILD.diskCheckedAt = Date.now();
    BUILD.disk = gitOut('rev-parse', 'HEAD');
  }
  return BUILD.disk;
}
/* The verdicts, apart from the reading: stale = the process is older than the
   checkout it serves; behind = main has a commit the checkout lacks (Issue
   #459: a checkout at main or ahead of it is not behind). `contains` says
   whether HEAD carries main's sha; unknown falls back to "differs". */
export function describeBuild({ head, disk = null, latest = null, contains = null }) {
  if (!head) return null;
  return {
    sha: head.slice(0, 7),
    ...(disk ? { diskSha: disk.slice(0, 7), stale: disk !== head } : {}),
    ...(latest ? { latestSha: latest.slice(0, 7), behind: latest !== head && contains !== true } : {}),
  };
}
/* The newer-release check (Issue #253, src/update-check.js) rides the same
   payload. `weave serve` arms it; it needs no checkout, so an install from a
   source zip still hears about a newer release. */
let RELEASE = null;
export function armReleaseCheck(check) { RELEASE = check; }
export function buildInfo() {
  const release = RELEASE?.status() ?? null;
  if (!BUILD.head) return release;
  if (Date.now() - BUILD.checkedAt > 5 * 60 * 1000) refreshLatest();
  return { ...describeBuild({ head: BUILD.head, disk: diskHead(), latest: BUILD.latest, contains: BUILD.contains }), ...release };
}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

/* ---------- compression (Issue #258) ----------
   A cold load moved 2.1 MB: app.js 475 KB, the schema 96 KB, all as plain
   text. The Node adapter gzips text-shaped answers — statics and JSON alike —
   when the request says it can inflate them. Cloudflare (src/worker.js)
   compresses at its edge, so this lives here, not in the shared dispatcher.
   Under 1 KB the header costs more than it saves; images are already packed. */
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/i;
const GZIP_MIN = 1024;

// RFC 9110 12.5.3: gzip's own q wins; failing that the wildcard's; q=0 refuses.
export function acceptsGzip(header) {
  const q = {};
  for (const part of String(header ?? '').toLowerCase().split(',')) {
    const [coding, ...params] = part.split(';').map((x) => x.trim());
    if (!coding) continue;
    const qp = params.find((x) => x.startsWith('q='));
    q[coding] = qp ? Number(qp.slice(2)) : 1;
  }
  const v = q.gzip ?? q['*'];
  return v > 0;
}

export function gzipOutcome({ status, headers, body }, acceptEncoding, { cache = null, path = '' } = {}) {
  const type = headers['Content-Type'] ?? '';
  if (!COMPRESSIBLE.test(type) || headers['Content-Encoding']) return { headers, body };
  // Every representation of a compressible answer depends on the header, 304s included.
  const vary = headers.Vary ? `${headers.Vary}, Accept-Encoding` : 'Accept-Encoding';
  const size = typeof body === 'string' ? Buffer.byteLength(body) : body?.length ?? 0;
  if (status !== 200 || size < GZIP_MIN || !acceptsGzip(acceptEncoding)) return { headers: { ...headers, Vary: vary }, body };
  // Two files can share a size and an mtime; the path keeps them apart.
  const key = headers.ETag && `${path} ${headers.ETag}`;
  let zipped = key && cache?.get(key);
  if (!zipped) {
    zipped = gzipSync(body);
    if (key && cache) cache.set(key, zipped);
  }
  return { headers: { ...headers, Vary: vary, 'Content-Encoding': 'gzip' }, body: zipped };
}

/* Cross-site writes (Issue #486). A page anywhere could POST a text/plain
   "simple request" (no preflight) at an instance and change its rows. A write
   is refused when the browser says it came from another site: an Origin that
   is not this request's own origin, WEAVE_ORIGIN or a loopback origin on
   this port, or Sec-Fetch-Site: cross-site. No Origin (curl, the CLI, agents)
   is served. */
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

/* Security headers (Issue #494), on every answer the node adapter writes.
   frame-ancestors is enforced: weave frames only its own pages (deck, doc
   and file previews), and WEAVE_FRAME_ANCESTORS (comma-separated origins)
   lets a demo shell elsewhere frame it. The report-only policy is the target
   state, not today's: the shell and the document pages still run inline
   scripts and styles, so enforcing it would break them. HSTS only when the
   request arrived over https. */
export const CSP_REPORT_ONLY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
export const frameAncestorsFromEnv = (env = process.env) => String(env.WEAVE_FRAME_ANCESTORS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
export function securityHeaders(headers, { https = false, frameAncestors = [] } = {}) {
  const html = /^text\/html/i.test(headers['Content-Type'] ?? '');
  return {
    ...headers,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...(html ? { 'Content-Security-Policy': ["frame-ancestors 'self'", ...frameAncestors].join(' '), 'Content-Security-Policy-Report-Only': CSP_REPORT_ONLY } : {}),
    ...(https ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}

async function readBody(req, { requireJson = false } = {}) {
  // With an Origin present a browser sent it: only a JSON body, never a form or text/plain.
  if (requireJson && !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new WeaveError('A request with an Origin must send its body as application/json', 'invalid');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new WeaveError('Body too large', 'invalid');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new WeaveError('Invalid JSON body', 'invalid');
  }
}

// The workspace `weave serve` opens at / (Issue #594). Fresh, it takes its
// file's name when someone chose one (`--data acme.db`), and otherwise
// personal-workspace, or -2, -3 when a workspace file beside it already
// holds that name. A workspace that was never served still carries the old
// seed name 'Weave Workspace' and takes its file's basename, as it always
// did; one that was (so is called 'workspace', say) keeps its name.
export function openDefaultWorkspace(dataPath, { actor } = {}) {
  const dir = dirname(dataPath);
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

// One web app can host several workspaces (like the.fibery.io):
// the default workspace lives at /, siblings at /w/<name>/ — same UI, same
// API shapes, path-scoped. Sibling <name>.json files next to the default
// workspace's data file are discovered automatically.
export function createWorkspaceHub(defaultWeave, { workspaces = {} } = {}) {
  const instances = new Map();
  let defaultName = defaultWeave.state.meta.name || 'workspace';
  instances.set(defaultName, defaultWeave);
  // The registry lives once, at the root (Feature #219): the default
  // workspace hosts it and every other workspace the hub holds joins it —
  // handed in, adopted by scan, or created here. A single-member hub (the
  // Worker) is its own root, untouched.
  defaultWeave.hostRegistry();
  const enroll = (w) => { if (w !== defaultWeave) w.joinRegistry(defaultWeave); return w; };
  for (const [name, w] of Object.entries(workspaces)) instances.set(name, enroll(w));

  const dataDir = defaultWeave.store.path ? dirname(defaultWeave.store.path) : null;
  // One workspace = one .db file; legacy sibling .json files migrate on
  // adoption. Both spellings of the same stem resolve to the same .db, so
  // adopted store paths are the dedupe key.
  const adoptedPaths = new Set([...instances.values()].map((w) => w.store.path).filter(Boolean));
  const scan = () => {
    if (!dataDir) return;
    for (const file of readdirSync(dataDir)) {
      if (!/\.(json|db)$/.test(file)) continue;
      const name = file.replace(/\.(json|db)$/, '');
      const dbPath = join(dataDir, `${name}.db`);
      if (instances.has(name) || adoptedPaths.has(dbPath)) continue;
      // Only load files that look like Weave workspaces.
      try {
        const w = new Weave({ path: join(dataDir, file) });
        if (w.state.meta) {
          if (!w.state.meta.name || w.state.meta.name === 'Weave Workspace') {
            w.state.meta.name = name;
            w.save();
          }
          // Never let a later file clobber an already-adopted name.
          if (!instances.has(w.state.meta.name)) instances.set(w.state.meta.name, enroll(w));
          adoptedPaths.add(dbPath);
        }
      } catch { /* not a workspace file */ }
    }
  };
  scan();

  return {
    get defaultName() { return defaultName; },
    rename(oldName, newName) {
      const w = instances.get(oldName);
      if (!w) return;
      instances.delete(oldName);
      instances.set(newName, w);
      if (defaultName === oldName) defaultName = newName;
    },
    get(name) {
      if (instances.has(name)) return instances.get(name);
      // The universal reference rule: a workspace answers to its id as well
      // as its friendly name, so /w/<id>/ survives any rename.
      for (const w of instances.values()) if (w.state.meta.id === name) return w;
      scan();
      for (const w of instances.values()) if (w.state.meta.id === name) return w;
      return instances.get(name) ?? null;
    },
    list({ includeDeleted = false } = {}) {
      scan();
      for (const w of instances.values()) w.maybeRefresh();
      return [...instances.entries()]
        .filter(([, w]) => includeDeleted || !w.state.meta.deletedAt)
        .map(([name, w]) => ({
          name,
          id: w.state.meta.id,
          url: `/w/${w.state.meta.id}/`,
          default: name === defaultName,
          spaces: w.listSpaces().length,
          tables: w.userTables().length,
          entities: Object.keys(w.state.entities).length,
          logo: !!w.state.meta.logo,
          deletedAt: w.state.meta.deletedAt ?? null,
          // What the UI may offer a delete on (Issue #190): a hub without
          // remove() reports nothing deletable, and the two workspaces the
          // app stands on never are.
          deletable: !!this.remove && name !== defaultName && name !== 'weave' && !w.state.meta.deletedAt,
        }));
    },
    /* Workspace trash, two rungs (lifecycle gate Phase 0b + Issue #122).
       Soft (default): a deletedAt tombstone in the workspace's own meta — it
       leaves the hub list but keeps its file and its URL, survives restarts
       and rescans, and restore() undoes it; the readable-by-id rule trashed
       entities and tables follow. Hard: the .db (with WAL/SHM sidecars)
       moves to <dataDir>/trash/, where scan() never looks — recoverable only
       by moving it back by hand. The default workspace and the weave docs
       workspace refuse both: the app is standing on them. */
    remove(ref, { hard = false } = {}) {
      const w = this.get(ref);
      if (!w) throw new WeaveError(`Workspace '${ref}' not found`, 'not-found');
      const name = [...instances.entries()].find(([, x]) => x === w)?.[0];
      if (w === defaultWeave || name === defaultName) throw new WeaveError('The default workspace cannot be deleted', 'invalid');
      if (name === 'weave') throw new WeaveError('The weave docs workspace cannot be deleted', 'invalid');
      if (!hard) {
        if (w.state.meta.deletedAt) return w;
        w.state.meta.deletedAt = new Date().toISOString();
        w.save();
        w.syncRegistry();
        return w;
      }
      const path = w.store.path;
      w.store.close?.();
      instances.delete(name);
      defaultWeave.dropWorkspace(w.state.meta.id);
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
    restore(ref) {
      const w = this.get(ref);
      if (!w) throw new WeaveError(`Workspace '${ref}' not found`, 'not-found');
      if (!w.state.meta.deletedAt) return w;
      w.state.meta.deletedAt = null;
      w.save();
      w.syncRegistry();
      return w;
    },
    create(name) {
      // No name asked for: personal-workspace, or the first -2, -3 the
      // instance does not hold (Issue #594).
      if (name == null || name === '') {
        scan();
        name = workspaceName({ taken: instances.keys() }).slug;
      }
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) throw new WeaveError('Workspace name must be alphanumeric', 'invalid');
      const held = this.get(name);
      if (held?.state.meta.deletedAt) throw new WeaveError(`Workspace '${name}' is in the trash — restore it instead`, 'conflict');
      if (held) throw new WeaveError(`Workspace '${name}' already exists`, 'conflict');
      if (!dataDir) throw new WeaveError('In-memory hub cannot create workspaces', 'invalid');
      const w = new Weave({ path: join(dataDir, `${name}.db`) });
      w.state.meta.name = name;
      // A fresh workspace opens on its own page, and the page's empty state
      // says what to do first (Issue #386) — the job a default description
      // did since Issue #123. The description starts empty and is theirs.
      w.save();
      instances.set(name, enroll(w));
      adoptedPaths.add(w.store.path);
      return w;
    },
    entries() {
      scan();
      for (const w of instances.values()) w.maybeRefresh();
      return [...instances.entries()];
    },
  };
}

/* The public origin the sign-in provider redirects back to and the session
   cookie is bound to (Feature #222 part 2, Feature #212): WEAVE_ORIGIN, e.g.
   https://weave.example.com. Unset means loopback — http://localhost:<port>.
   WEAVE_TRUST_PROXY=1
   makes the rate limiter read X-Forwarded-For (Railway, Fly and every other
   platform proxy put the client there); off, the socket address is the
   client, so a proxy would rate-limit itself. */
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
/* The other public origins the MCP door answers on (Feature #254), comma
   separated: https://mcp.weave.example.com beside WEAVE_ORIGIN on the same
   service. An MCP client checks that the protected-resource metadata names
   the URL it dialled, so the resource origin follows the Host header, but
   only onto an origin listed here or in WEAVE_ORIGIN; a Host header is never
   echoed. Each host is also served, as WEAVE_ALLOWED_HOSTS would. */
export const mcpOriginsFromEnv = (env = process.env) => String(env.WEAVE_MCP_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  .map((o) => originFromEnv({ WEAVE_MCP_ORIGINS: o }, 'WEAVE_MCP_ORIGINS'));
export const trustProxyFromEnv = (env = process.env) => ['1', 'true', 'yes'].includes(String(env.WEAVE_TRUST_PROXY ?? '').toLowerCase());

/* The names this server answers to (Issue #487). Any Host used to do, so a
   page on an attacker's name that re-resolves to 127.0.0.1 (DNS rebinding)
   was same-origin with a loopback instance. Loopback names, WEAVE_ORIGIN's
   host and the comma-separated WEAVE_ALLOWED_HOSTS answer; ports are not
   compared, since a rebinding page controls the name, not the port. */
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const hostnameOf = (host) => { try { return host ? new URL(`http://${host}`).hostname : null; } catch { return null; } };
export const allowedHostsFromEnv = (env = process.env) => String(env.WEAVE_ALLOWED_HOSTS ?? '').split(',').map((h) => hostnameOf(h.trim())).filter(Boolean);
export function hostAllowed(host, { origin = null, allowedHosts = [] } = {}) {
  const name = hostnameOf(String(host ?? ''));
  if (!name) return false;
  return LOOPBACK_NAMES.has(name) || (!!origin && new URL(origin).hostname === name) || allowedHosts.includes(name);
}
/* A container bound to 0.0.0.0 with neither variable set was reached by
   whatever name its platform gave it; refusing that on upgrade would take it
   down, so it keeps answering any Host and says so once. */
export function hostCheckFor({ host, env = process.env }) {
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
  if (loopback || env.WEAVE_ORIGIN?.trim() || env.WEAVE_MCP_ORIGINS?.trim() || allowedHostsFromEnv(env).length) return { enforce: true, warning: null };
  return { enforce: false, warning: `weave: bound to ${host} with neither WEAVE_ORIGIN nor WEAVE_ALLOWED_HOSTS set, so any Host header is answered; set one to refuse DNS-rebound requests` };
}

/* Content-versioned asset URLs (Issue #313). weave has no build step, so the
   shell is versioned when it is served: every local src/href/import in
   index.html that names a file gains `?v=<first 12 hex of its sha1>`, and an
   asset asked for at its current version can be cached `immutable`. A
   version is cached per file until its mtime or size moves, so a request for
   the shell costs a stat per asset, not a hash. The Worker's Assets binding
   serves public/ untouched (Issue #231): its shell keeps plain URLs and the
   platform's own revalidation, which stays correct without this. */
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

/* Door C (Feature #212): the provider WEAVE_OIDC_* names, or null. */
const providerFromEnv = (env = process.env) => { const c = oidcFromEnv(env); return c ? createOidc(c) : null; };

export function createServer(defaultWeave, { workspaces = {}, build = () => null, backup = () => null, origin = originFromEnv(), trustProxy = trustProxyFromEnv(), limits, allowedHosts = allowedHostsFromEnv(), checkHost = true, frameAncestors = frameAncestorsFromEnv(), oidc = providerFromEnv(), mcpOrigins = mcpOriginsFromEnv() } = {}) {
  const hub = createWorkspaceHub(defaultWeave, { workspaces });
  const answers = [...allowedHosts, ...mcpOrigins.map((o) => new URL(o).hostname)];

  // Node adapter around the runtime-agnostic dispatcher (src/routes.js): this
  // side owns the body stream, the response socket, and static files from
  // public/. The Worker adapter (src/worker.js) wraps the same dispatcher.
  const assets = createAssetVersions(PUBLIC_DIR);
  const serveStatic = (path, rx) => {
    /* Vditor lazy-loads mermaid from inside its own dist tree. weave already
       vendors a mermaid build for document pages, so that path is aliased
       onto it rather than shipping a second 3.5MB copy of the same library. */
    const file = path === '/' ? '/index.html'
      : path === '/vendor/vditor/dist/js/mermaid/mermaid.min.js' ? '/vendor/mermaid.min.js'
      : path;
    const full = join(PUBLIC_DIR, file.replace(/\.\./g, ''));
    if (!existsSync(full) || full.endsWith('/')) return null;
    // no-cache, not no-store: the browser may keep a copy but must
    // revalidate. Without it heuristic caching serves a stale app.js or
    // style.css after an edit, so UI changes only appear on a hard reload.
    // Last-Modified lets that revalidation answer 304 (Feature #148): a
    // workspace switch is a full page load, and without it every switch
    // re-downloaded ~1MB of unchanged vendor JS/CSS.
    const match = rx?.header?.('if-none-match');
    const matches = (etag) => match && match.split(',').map((t) => t.trim().replace(/^W\//, '')).some((t) => t === '*' || t === etag.slice(2));
    if (file === '/index.html') {
      /* The shell names its assets by version, so its validator must follow
         the bytes it serves: an asset can change under an unchanged
         index.html, and a 304 on the file's mtime would keep the old URLs.
         No Last-Modified for the same reason. */
      const body = assets.rewrite(readFileSync(full, 'utf8'));
      const headers = {
        'Content-Type': MIME['.html'],
        'Cache-Control': 'no-cache',
        ETag: `W/"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`,
      };
      return matches(headers.ETag) ? { status: 304, headers, body: '' } : { status: 200, headers, body };
    }
    const v = rx?.searchParams?.get?.('v');
    const { mtime, size } = statSync(full);
    const headers = {
      'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
      // Immutable only when the version asked for names these exact bytes.
      'Cache-Control': v && v === assets.version(file) ? IMMUTABLE : 'no-cache',
      'Last-Modified': mtime.toUTCString(),
      /* Weak on purpose (Issue #258): the adapter may gzip the body, and a
         weak validator names the file, not the bytes of one encoding. */
      ETag: `W/"${size.toString(16)}-${Math.floor(mtime.getTime()).toString(16)}"`,
    };
    // If-None-Match wins over If-Modified-Since when both are sent (RFC 9110 13.2.2).
    if (match) return matches(headers.ETag) ? { status: 304, headers, body: '' } : { status: 200, headers, body: readFileSync(full) };
    const since = Date.parse(rx?.header?.('if-modified-since') ?? '');
    // HTTP dates carry whole seconds; compare at that grain or nothing matches.
    if (since && Math.floor(mtime.getTime() / 1000) <= Math.floor(since / 1000)) {
      return { status: 304, headers, body: '' };
    }
    return { status: 200, headers, body: readFileSync(full) };
  };

  const handle = createRequestHandler(hub, {
    version: VERSION,
    uptime: () => process.uptime(),
    // Opt-in (the CLI serve path passes buildInfo): an embedded/test server
    // must not read git or toast about a checkout it does not represent.
    build,
    // The nightly backup's last result, when serve armed one (Feature #222 phase 3).
    backup,
    serveStatic,
    origin,
    trustProxy,
    oidc,
    mcpOrigins,
    ...(limits ? { limits } : {}),
  });

  // gzip of a static, keyed by its ETag: app.js costs ~10ms to deflate and
  // only changes on a deploy. ponytail: unbounded by count, but the keys are
  // the files in public/ at their current versions — a deploy restarts us.
  const gzCache = new Map();
  /* The listener is async, so anything it throws is an unhandled rejection,
     and node ends the process on one (Issue #484: a malformed percent-escape
     in the path took the server down). Its whole body is guarded: a path
     that will not decode is the caller's 400, anything else is a 500 whose
     detail stays in the log. */
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
      try { path = decodeURIComponent(url.pathname); } catch { return fail(res, 400, 'Malformed percent-escape in the path', 'invalid'); }
      // Health stays open to any name: platform probes send their own Host.
      if (checkHost && path !== '/api/health' && !hostAllowed(req.headers.host, { origin, allowedHosts: answers })) {
        return fail(res, 421, 'This server does not answer to that Host; add it to WEAVE_ALLOWED_HOSTS', 'misdirected');
      }
      if (crossSiteWrite(req, { origin, trustProxy })) return fail(res, 403, 'Cross-site write refused', 'forbidden');
      const outcome = await handle({
        method: req.method,
        path,
        searchParams: url.searchParams,
        header: (name) => req.headers[name.toLowerCase()],
        readBody: () => readBody(req, { requireJson: req.headers.origin !== undefined }),
        remote: req.socket?.remoteAddress ?? null,
      });
      const { headers, body } = gzipOutcome(outcome, req.headers['accept-encoding'], { cache: gzCache, path: url.pathname });
      res.writeHead(outcome.status, secure(req, headers));
      res.end(body);
    } catch (err) {
      console.error(`weave: ${req.method} ${req.url} failed:`, err);
      fail(res, 500, 'Internal error', 'internal');
    }
  });

  return server;
}

export function startServer(weave, { port = 4400, host = '127.0.0.1', workspaces = {}, build = () => null, backup = () => null, origin, trustProxy, limits, allowedHosts, frameAncestors, oidc, mcpOrigins } = {}) {
  const { enforce, warning } = origin || allowedHosts?.length || mcpOrigins?.length ? { enforce: true, warning: null } : hostCheckFor({ host });
  if (warning) console.warn(warning);
  const server = createServer(weave, { workspaces, build, backup, limits, checkHost: enforce, ...(origin !== undefined ? { origin } : {}), ...(trustProxy !== undefined ? { trustProxy } : {}), ...(allowedHosts !== undefined ? { allowedHosts } : {}), ...(frameAncestors !== undefined ? { frameAncestors } : {}), ...(oidc !== undefined ? { oidc } : {}), ...(mcpOrigins !== undefined ? { mcpOrigins } : {}) });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}
