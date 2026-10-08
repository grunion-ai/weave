import { createServer as createHttpServer } from 'node:http';
import { spawnSync, execFile } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Weave, WeaveError } from './engine.js';
import { workspaceName, workspaceSlug, nameFromFile } from './workspace-name.js';
import { createRequestHandler } from './routes.js';
import { createOidc, oidcFromEnv } from './oidc.js';
import { mailerFromEnv } from './mail-send.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

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
  if (!BUILD.head) return release;
  if (Date.now() - BUILD.checkedAt > 5 * 60 * 1000) refreshLatest();
  return { ...describeBuild({ head: BUILD.head, disk: diskHead(), latest: BUILD.latest, contains: BUILD.contains }), ...release };
}
export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg\+xml)/i;
const GZIP_MIN = 1024;

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
  const vary = headers.Vary ? `${headers.Vary}, Accept-Encoding` : 'Accept-Encoding';
  const size = typeof body === 'string' ? Buffer.byteLength(body) : body?.length ?? 0;
  if (status !== 200 || size < GZIP_MIN || !acceptsGzip(acceptEncoding)) return { headers: { ...headers, Vary: vary }, body };
  const key = headers.ETag && `${path} ${headers.ETag}`;
  let zipped = key && cache?.get(key);
  if (!zipped) {
    zipped = gzipSync(body);
    if (key && cache) cache.set(key, zipped);
  }
  return { headers: { ...headers, Vary: vary, 'Content-Encoding': 'gzip' }, body: zipped };
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

async function readBody(req, { requireJson = false } = {}) {
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

export function createWorkspaceHub(defaultWeave, { workspaces = {} } = {}) {
  const instances = new Map();
  let defaultName = defaultWeave.state.meta.name || 'workspace';
  instances.set(defaultName, defaultWeave);
  defaultWeave.hostRegistry();
  const enroll = (w) => { if (w !== defaultWeave) w.joinRegistry(defaultWeave); return w; };
  for (const [name, w] of Object.entries(workspaces)) instances.set(name, enroll(w));

  const dataDir = defaultWeave.store.path ? dirname(defaultWeave.store.path) : null;
  const adoptedPaths = new Set([...instances.values()].map((w) => w.store.path).filter(Boolean));
  const scan = () => {
    if (!dataDir) return;
    for (const file of readdirSync(dataDir)) {
      if (!/\.(json|db)$/.test(file)) continue;
      const name = file.replace(/\.(json|db)$/, '');
      const dbPath = join(dataDir, `${name}.db`);
      if (instances.has(name) || adoptedPaths.has(dbPath)) continue;
      try {
        const w = new Weave({ path: join(dataDir, file) });
        if (w.state.meta) {
          if (!w.state.meta.name || w.state.meta.name === 'Weave Workspace') {
            w.state.meta.name = name;
            w.save();
          }
          if (!instances.has(w.state.meta.name)) instances.set(w.state.meta.name, enroll(w));
          adoptedPaths.add(dbPath);
        }
      } catch {}
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
      const find = () => {
        if (instances.has(name)) return instances.get(name);
        const lower = String(name).toLowerCase();
        for (const [n, w] of instances) if (w.state.meta.id === name || n.toLowerCase() === lower) return w;
        return null;
      };
      return find() ?? (scan(), find());
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
          deletable: !!this.remove && name !== defaultName && name !== 'weave' && !w.state.meta.deletedAt,
        }));
    },
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
    create(asked) {
      let title, name;
      if (asked == null || asked === '') {
        scan();
        ({ name: title, slug: name } = workspaceName({ taken: instances.keys() }));
      } else {
        title = String(asked).trim();
        name = workspaceSlug(asked);
      }
      if (!name) throw new WeaveError('A workspace name needs a letter or a digit: its slug keeps letters, digits, - and _', 'invalid');
      const held = this.get(name);
      if (held?.state.meta.deletedAt) throw new WeaveError(`Workspace '${name}' is in the trash — restore it instead`, 'conflict');
      if (held) throw new WeaveError(`Workspace '${name}' already exists`, 'conflict');
      if (!dataDir) throw new WeaveError('In-memory hub cannot create workspaces', 'invalid');
      const w = new Weave({ path: join(dataDir, `${name}.db`) });
      w.state.meta.name = name;
      if (title !== name) w.state.meta.title = title;
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
export const trustProxyFromEnv = (env = process.env) => ['1', 'true', 'yes'].includes(String(env.WEAVE_TRUST_PROXY ?? '').toLowerCase());

const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const hostnameOf = (host) => { try { return host ? new URL(`http://${host}`).hostname : null; } catch { return null; } };
export const allowedHostsFromEnv = (env = process.env) => String(env.WEAVE_ALLOWED_HOSTS ?? '').split(',').map((h) => hostnameOf(h.trim())).filter(Boolean);
export function hostAllowed(host, { origin = null, allowedHosts = [] } = {}) {
  const name = hostnameOf(String(host ?? ''));
  if (!name) return false;
  return LOOPBACK_NAMES.has(name) || (!!origin && new URL(origin).hostname === name) || allowedHosts.includes(name);
}
export function hostCheckFor({ host, env = process.env }) {
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
  if (loopback || env.WEAVE_ORIGIN?.trim() || env.WEAVE_MCP_ORIGINS?.trim() || allowedHostsFromEnv(env).length) return { enforce: true, warning: null };
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

export function createServer(defaultWeave, { workspaces = {}, build = () => null, backup = () => null, origin = originFromEnv(), trustProxy = trustProxyFromEnv(), limits, allowedHosts = allowedHostsFromEnv(), checkHost = true, frameAncestors = frameAncestorsFromEnv(), oidc = providerFromEnv(), mcpOrigins = mcpOriginsFromEnv(), mail = mailerFromEnv() } = {}) {
  const hub = createWorkspaceHub(defaultWeave, { workspaces });
  const answers = [...allowedHosts, ...mcpOrigins.map((o) => new URL(o).hostname)];

  const assets = createAssetVersions(PUBLIC_DIR);
  const serveStatic = (path, rx, { head = null } = {}) => {
    const file = path === '/' ? '/index.html'
      : path === '/vendor/vditor/dist/js/mermaid/mermaid.min.js' ? '/vendor/mermaid.min.js'
      : path;
    const full = join(PUBLIC_DIR, file.replace(/\.\./g, ''));
    if (!existsSync(full) || full.endsWith('/')) return null;
    const match = rx?.header?.('if-none-match');
    const matches = (etag) => match && match.split(',').map((t) => t.trim().replace(/^W\//, '')).some((t) => t === '*' || t === etag.slice(2));
    if (file === '/index.html') {
      const shell = readFileSync(full, 'utf8');
      const body = assets.rewrite(head ? shell.replace(/<title>[^<]*<\/title>/, () => head) : shell);
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
      'Cache-Control': v ? (v === assets.version(file) ? IMMUTABLE : 'no-cache') : file.startsWith('/vendor/') ? VENDOR_CACHE : 'no-cache',
      'Last-Modified': mtime.toUTCString(),
      ETag: `W/"${size.toString(16)}-${Math.floor(mtime.getTime()).toString(16)}"`,
    };
    if (match) return matches(headers.ETag) ? { status: 304, headers, body: '' } : { status: 200, headers, body: readFileSync(full) };
    const since = Date.parse(rx?.header?.('if-modified-since') ?? '');
    if (since && Math.floor(mtime.getTime() / 1000) <= Math.floor(since / 1000)) {
      return { status: 304, headers, body: '' };
    }
    return { status: 200, headers, body: readFileSync(full) };
  };

  const handle = createRequestHandler(hub, {
    version: VERSION,
    uptime: () => process.uptime(),
    build,
    backup,
    serveStatic,
    origin,
    trustProxy,
    oidc,
    mcpOrigins,
    mail,
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
      try { path = decodeURIComponent(url.pathname); } catch { return fail(res, 400, 'Malformed percent-escape in the path', 'invalid'); }
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

export function startServer(weave, { port = 4400, host = '127.0.0.1', workspaces = {}, build = () => null, backup = () => null, origin, trustProxy, limits, allowedHosts, frameAncestors, oidc, mcpOrigins, mail } = {}) {
  const { enforce, warning } = origin || allowedHosts?.length || mcpOrigins?.length ? { enforce: true, warning: null } : hostCheckFor({ host });
  if (warning) console.warn(warning);
  const server = createServer(weave, { workspaces, build, backup, limits, checkHost: enforce, ...(origin !== undefined ? { origin } : {}), ...(trustProxy !== undefined ? { trustProxy } : {}), ...(allowedHosts !== undefined ? { allowedHosts } : {}), ...(frameAncestors !== undefined ? { frameAncestors } : {}), ...(oidc !== undefined ? { oidc } : {}), ...(mcpOrigins !== undefined ? { mcpOrigins } : {}), ...(mail !== undefined ? { mail } : {}) });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}
