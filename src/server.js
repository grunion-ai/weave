import { createServer as createHttpServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave, WeaveError } from './engine.js';
import { createRequestHandler } from './routes.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
// The version weave actually is — read at load, never hardcoded (Issue #19).
const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
};

function statusFor(err) {
  if (!(err instanceof WeaveError)) return 500;
  return { 'not-found': 404, conflict: 409, invalid: 400, ambiguous: 400 }[err.code] ?? 400;
}

async function readBody(req) {
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

// One web app can host several workspaces (like the.fibery.io):
// the default workspace lives at /, siblings at /w/<name>/ — same UI, same
// API shapes, path-scoped. Sibling <name>.json files next to the default
// workspace's data file are discovered automatically.
export function createWorkspaceHub(defaultWeave, { workspaces = {} } = {}) {
  const instances = new Map();
  let defaultName = defaultWeave.state.meta.name || 'workspace';
  instances.set(defaultName, defaultWeave);
  for (const [name, w] of Object.entries(workspaces)) instances.set(name, w);

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
          if (!instances.has(w.state.meta.name)) instances.set(w.state.meta.name, w);
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
          tables: w.listTables().length,
          entities: Object.keys(w.state.entities).length,
          logo: !!w.state.meta.logo,
          deletedAt: w.state.meta.deletedAt ?? null,
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
        return w;
      }
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
    restore(ref) {
      const w = this.get(ref);
      if (!w) throw new WeaveError(`Workspace '${ref}' not found`, 'not-found');
      if (!w.state.meta.deletedAt) return w;
      w.state.meta.deletedAt = null;
      w.save();
      return w;
    },
    create(name) {
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) throw new WeaveError('Workspace name must be alphanumeric', 'invalid');
      const held = this.get(name);
      if (held?.state.meta.deletedAt) throw new WeaveError(`Workspace '${name}' is in the trash — restore it instead`, 'conflict');
      if (held) throw new WeaveError(`Workspace '${name}' already exists`, 'conflict');
      if (!dataDir) throw new WeaveError('In-memory hub cannot create workspaces', 'invalid');
      const w = new Weave({ path: join(dataDir, `${name}.db`) });
      w.state.meta.name = name;
      // A fresh workspace opens on its own page: say what the reader is
      // looking at and what to do first, instead of bare registry scaffolding
      // (Issue #123). The description is theirs to rewrite or clear.
      w.state.meta.description = 'A fresh workspace. Create a **space** from the sidebar, add a **table** to it, and rows take it from there.\n\nThe *Workspace* space below is the workspace describing itself — every space, table and field you create appears there as a row, and editing those rows edits the schema.';
      w.save();
      instances.set(name, w);
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

export function createServer(defaultWeave, { workspaces = {} } = {}) {
  const hub = createWorkspaceHub(defaultWeave, { workspaces });

  // Node adapter around the runtime-agnostic dispatcher (src/routes.js): this
  // side owns the body stream, the response socket, and static files from
  // public/. The Worker adapter (src/worker.js) wraps the same dispatcher.
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
    const mtime = statSync(full).mtime;
    const headers = {
      'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Last-Modified': mtime.toUTCString(),
    };
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
    serveStatic,
  });

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const outcome = await handle({
      method: req.method,
      path: decodeURIComponent(url.pathname),
      searchParams: url.searchParams,
      header: (name) => req.headers[name.toLowerCase()],
      readBody: () => readBody(req),
    });
    res.writeHead(outcome.status, outcome.headers);
    res.end(outcome.body);
  });

  return server;
}

export function startServer(weave, { port = 4400, host = '127.0.0.1', workspaces = {} } = {}) {
  const server = createServer(weave, { workspaces });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}
