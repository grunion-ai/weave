import { createServer as createHttpServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave, WeaveError } from './engine.js';
import { renderDocumentPage, renderMarkdown } from './markdown.js';
import { markdownToPdf } from './pdf.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
// Process start, not server start: module load is close enough and survives
// multiple startServer calls in one process (tests, workspace hubs).
const STARTED_AT = new Date().toISOString();
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
      scan();
      return instances.get(name) ?? null;
    },
    list() {
      scan();
      for (const w of instances.values()) w.maybeRefresh();
      return [...instances.entries()].map(([name, w]) => ({
        name,
        default: name === defaultName,
        spaces: w.listSpaces().length,
        tables: w.listTables().length,
        entities: Object.keys(w.state.entities).length,
        logo: !!w.state.meta.logo,
      }));
    },
    create(name) {
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) throw new WeaveError('Workspace name must be alphanumeric', 'invalid');
      if (this.get(name)) throw new WeaveError(`Workspace '${name}' already exists`, 'conflict');
      if (!dataDir) throw new WeaveError('In-memory hub cannot create workspaces', 'invalid');
      const w = new Weave({ path: join(dataDir, `${name}.db`) });
      w.state.meta.name = name;
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

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);

    // Workspace scoping: /w/<name>/... targets a sibling workspace.
    let weave = defaultWeave;
    let wsPrefix = '';
    const wsM = path.match(/^\/w\/([^/]+)(\/.*|$)/);
    if (wsM && wsM[1] !== 'undefined') {
      // Back-compat: the docs workspace was renamed weaver → weave.
      const target = hub.get(wsM[1]) ?? (wsM[1] === 'weaver' ? hub.get('weave') : null);
      if (!target) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `Workspace '${wsM[1]}' not found`, code: 'not-found' }));
      }
      weave = target;
      wsPrefix = `/w/${wsM[1]}`;
      path = wsM[2] || '/';
    }
    // Pick up commits from other processes (CLI beside the server) before
    // serving anything from this workspace.
    weave.maybeRefresh();

    // Who is calling (Feature #65): callers name themselves per request;
    // without a header every mutation is 'web'. Set each request — a sticky
    // actor from the last request would misattribute this one.
    weave.actor = String(req.headers['x-weave-actor'] || 'web').slice(0, 120);

    // Accounts & roles (Feature #14). A Bearer token names the account and
    // caps what it may do; a bad token is a 401, never an anonymous
    // fallthrough. With requireAuth on, anonymous API calls are refused —
    // /api/health stays open so a monitor can still see the instance.
    const deny = (code, error) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error, code: code === 401 ? 'unauthorized' : 'forbidden' }));
    };
    // A share link is its own authorization (Feature #17): the token names
    // exactly one view, rendered read-only, before any auth wall applies.
    {
      const shareM = path.match(/^\/view\/([A-Za-z0-9_-]+)$/);
      if (shareM && req.method === 'GET') {
        const v = weave.viewByShareToken(shareM[1]);
        if (!v) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          return res.end('This share link is not (or no longer) valid.');
        }
        const resolved = weave.resolveView(v.id);
        const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const block = (b) => `<h2>${esc(b.table)}</h2><table><thead><tr>${
          Object.keys(b.items[0]?.fields ?? { '—': 1 }).map((k) => `<th>${esc(k)}</th>`).join('')
        }</tr></thead><tbody>${
          b.items.map((e) => `<tr>${Object.values(e.fields).map((val) => `<td>${esc(Array.isArray(val) ? val.map((x) => x?.name ?? x).join(', ') : (val && typeof val === 'object' ? val.name ?? '' : val ?? ''))}</td>`).join('')}</tr>`).join('')
        }</tbody></table>`;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(resolved.name)}</title><style>body{font:15px/1.5 -apple-system,sans-serif;max-width:960px;margin:2rem auto;padding:0 16px;color:#1a1d21}table{border-collapse:collapse;width:100%;font-size:13.5px;margin:0 0 24px}th,td{border:1px solid #d9dde3;padding:5px 9px;text-align:left}th{background:#f4f6f8}h1{font-size:22px}h2{font-size:15px;margin:20px 0 6px}footer{color:#6b7280;font-size:12px;margin-top:32px}</style><h1>${esc(resolved.name)}</h1>${resolved.blocks.map(block).join('')}<footer>Shared read-only from a weave workspace.</footer>`);
      }
    }

    let role = null;
    const authz = req.headers['authorization'];
    if (authz && /^Bearer /i.test(authz)) {
      const account = weave.verifyToken(authz.slice(7).trim());
      if (!account) return deny(401, 'Invalid token');
      weave.actor = account.name;
      role = account.role;
    } else if (weave.state.meta.requireAuth && path.startsWith('/api/') && path !== '/api/health') {
      return deny(401, 'This workspace requires authentication');
    }
    if (role && role !== 'admin' && path.startsWith('/api/')) {
      const m2 = req.method;
      const read = m2 === 'GET' || m2 === 'HEAD'
        || (m2 === 'POST' && (/^\/api\/tables\/[^/]+\/query$/.test(path) || path === '/api/markdown'));
      const schemaWrite = !read && (
        /^\/api\/(spaces|automations|accounts)/.test(path)
        || /^\/api\/tables$/.test(path)
        || (/^\/api\/tables\/[^/]+$/.test(path) && (m2 === 'PATCH' || m2 === 'DELETE'))
        || /^\/api\/tables\/[^/]+\/fields/.test(path)
        || (/^\/api\/schema$/.test(path))
        || (/^\/api\/workspace$/.test(path) && m2 === 'PATCH'));
      // Registry rows ARE structure: writing Spaces/Tables/Fields rows through
      // the entity door is a schema change wearing entity clothes.
      const sysM = !read && (path.match(/^\/api\/tables\/([^/]+)\/entities/) ?? path.match(/^\/api\/entities\/([^/]+)/));
      const sysTouch = sysM && (() => {
        try {
          const ref = sysM[0].startsWith('/api/entities/')
            ? weave.state.tables[weave.getEntity(sysM[1]).dbId]
            : weave.findTable(decodeURIComponent(sysM[1]));
          return !!ref?.system;
        } catch { return false; }
      })();
      if (role === 'reader' && !read) return deny(403, 'This token is read-only');
      if (role === 'writer' && (schemaWrite || sysTouch)) return deny(403, 'This token cannot change the schema');
    }

    // Resolves [[Table#12]] mentions in rendered documents (active workspace).
    // The one place that knows how each reference kind is addressed and what
    // it links to. Returns null for a miss, which renders as a broken chip.
    const resolveMention = (kind, ref) => {
      try {
        if (kind === 'workspace') {
          return { href: `${wsPrefix}/`, label: weave.state.meta.name || 'workspace' };
        }
        if (kind === 'space') {
          const sp = weave.findSpace(ref);
          return sp ? { href: `${wsPrefix}/#/space/${sp.id}`, label: sp.name } : null;
        }
        if (kind === 'table') {
          const db = weave.findTable(ref);
          return db ? { href: `${wsPrefix}/#/table/${db.id}`, label: weave.qualifiedName(db) } : null;
        }
        const m = /^(.+)#(\d+)$/.exec(ref);
        if (!m) return null;
        const db = weave.findTable(m[1].trim());
        if (!db) return null;
        const entity = weave.listEntities(db.id).find((e) => String(e.publicId) === m[2]);
        if (!entity) return null;
        return {
          href: `${wsPrefix}/e/${entity.id}/doc.html`,
          label: `${db.name}#${m[2]} — ${weave.entityName(entity)}`,
        };
      } catch {
        return null; // an ambiguous or malformed ref is a miss, not a 500
      }
    };
    const send = (status, data, headers = {}) => {
      const isBuf = Buffer.isBuffer(data);
      const isStr = typeof data === 'string';
      const body = isBuf ? data : isStr ? data : JSON.stringify(data, null, 1);
      // Same-origin only: no CORS headers. An unauthenticated localhost API
      // with ACAO:* would let any open website read/write the workspace
      // cross-origin (2026-08-16 release audit).
      res.writeHead(status, {
        'Content-Type': headers['Content-Type'] ?? (isBuf || isStr ? 'text/plain; charset=utf-8' : 'application/json'),
        ...headers,
      });
      res.end(body);
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, { Allow: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' });
      return res.end();
    }

    try {
      // ---------- native document views ----------
      // /e/:id/doc.<fmt> serves the default (first) document field;
      // /e/:id/doc/<Field Name>.<fmt> serves a named document field.
      let m;
      if ((m = path.match(/^\/e\/([^/]+)\/doc(?:\/([^/]+?))?\.(md|mmd|html|pdf)$/))) {
        const entity = weave.readEntity(m[1]);
        const fieldRef = m[2] ?? null;
        const markdown = weave.getDoc(m[1], fieldRef);
        const docLabel = fieldRef ? ` • ${fieldRef}` : '';
        const subtitle = `${entity.db} #${entity.publicId} • ${entity.name}${docLabel} • updated ${entity.updatedAt.slice(0, 10)}`;
        if (m[3] === 'md') {
          return send(200, markdown, { 'Content-Type': 'text/markdown; charset=utf-8' });
        }
        if (m[3] === 'mmd') {
          return send(200, markdown, { 'Content-Type': 'text/vnd.mermaid; charset=utf-8' });
        }
        if (m[3] === 'html') {
          const page = renderDocumentPage({ title: entity.name || `#${entity.publicId}`, subtitle, markdown, resolveMention });
          return send(200, page, { 'Content-Type': 'text/html; charset=utf-8' });
        }
        const pdf = markdownToPdf(markdown, { title: entity.name || `#${entity.publicId}`, subtitle });
        return send(200, pdf, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${(entity.name || 'document').replace(/[^\w.-]+/g, '_')}.pdf"`,
        });
      }
      // Whole-entity export: name + fields + every document field, in one file.
      if ((m = path.match(/^\/e\/([^/]+)\/entity\.(md|mmd|html|pdf)$/))) {
        const entity = weave.readEntity(m[1]);
        const lines = [`# ${entity.name || '#' + entity.publicId}`, '', `${entity.db} #${entity.publicId} • updated ${entity.updatedAt.slice(0, 10)}`, '', '## Fields', '', '| Field | Value |', '|---|---|'];
        for (const [k, v] of Object.entries(entity.fields)) {
          if (k in entity.docs) continue;
          const val = v == null ? '' : Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.name : x)).join(', ') : typeof v === 'object' ? (v.name ?? '') : String(v);
          lines.push(`| ${k} | ${String(val).replace(/\|/g, '\\|')} |`);
        }
        // Every document renders as its own page (PDF break; print break in HTML).
        for (const [docName, docText] of Object.entries(entity.docs)) {
          lines.push('', '<div class="pagebreak"></div>', '', `## ${docName}`, '', docText || '_empty_');
        }
        const md = lines.join('\n');
        const subtitle = `${entity.db} #${entity.publicId} • full entity export`;
        if (m[2] === 'md') return send(200, md, { 'Content-Type': 'text/markdown; charset=utf-8' });
        if (m[2] === 'mmd') return send(200, md, { 'Content-Type': 'text/vnd.mermaid; charset=utf-8' });
        if (m[2] === 'html') {
          return send(200, renderDocumentPage({ title: entity.name || `#${entity.publicId}`, subtitle, markdown: md, resolveMention }), { 'Content-Type': 'text/html; charset=utf-8' });
        }
        return send(200, markdownToPdf(md, { title: entity.name || `#${entity.publicId}`, subtitle }), {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${(entity.name || 'entity').replace(/[^\w.-]+/g, '_')}.pdf"`,
        });
      }

      if ((m = path.match(/^\/e\/([^/]+)$/))) {
        const entity = weave.readEntity(m[1]); // 404s if missing
        res.writeHead(302, { Location: `${wsPrefix}/#/entity/${entity.id}` });
        return res.end();
      }

      // ---------- API ----------
      if (path.startsWith('/api/')) {
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const route = `${req.method} ${path}`;

        // startedAt + uptime let callers spot a stale server (process start
        // time vs commit/package version) instead of assuming "up" = "current".
        if (route === 'GET /api/health') return send(200, { ok: true, name: 'weave', version: VERSION, workspace: weave.state.meta.name, startedAt: STARTED_AT, uptime: Math.round(process.uptime()) });
        if (route === 'GET /api/schema') return send(200, weave.describeSchema());

        if (route === 'GET /api/workspaces') return send(200, hub.list());
        if (route === 'POST /api/workspaces') {
          const w = hub.create(body.name);
          return send(201, { name: w.state.meta.name, url: `/w/${w.state.meta.name}/` });
        }

        if (route === 'GET /api/workspace') {
          return send(200, { name: weave.state.meta.name, description: weave.state.meta.description ?? '', logo: !!weave.state.meta.logo, requireAuth: !!weave.state.meta.requireAuth });
        }

        // Accounts (Feature #14). Once any account exists, only an admin
        // token manages them — the anonymous door closes behind the first key.
        if (path.startsWith('/api/accounts') || (route === 'PATCH /api/workspace' && 'requireAuth' in (body ?? {}))) {
          if (weave.listAccounts().length && role !== 'admin') {
            return deny(role ? 403 : 401, 'Managing accounts needs an admin token');
          }
        }
        if (route === 'GET /api/accounts') return send(200, weave.listAccounts());
        if (route === 'POST /api/accounts') return send(201, weave.createAccount(body ?? {}));
        if ((m = path.match(/^\/api\/accounts\/(.+)$/)) && req.method === 'DELETE') {
          return send(200, weave.deleteAccount(decodeURIComponent(m[1])));
        }
        // Keystore (Feature #64): set, list, delete — never read back. The
        // same admin gate as accounts once any account exists.
        if (path.startsWith('/api/keys')) {
          if (weave.listAccounts().length && role !== 'admin') {
            return deny(role ? 403 : 401, 'Managing keys needs an admin token');
          }
          if (route === 'GET /api/keys') return send(200, weave.listKeys());
          if (route === 'POST /api/keys') return send(201, weave.setKey(body?.name, body?.value));
          if ((m = path.match(/^\/api\/keys\/(.+)$/))) {
            if (req.method === 'DELETE') return send(200, weave.deleteKey(decodeURIComponent(m[1])));
            return send(404, { error: 'Secrets cannot be read back', code: 'not-found' });
          }
        }
        if (route === 'PUT /api/schema') {
          return send(200, weave.applySchema(body?.schema ?? body, {
            dryRun: !!body?.dryRun,
            allowDestructive: !!body?.allowDestructive,
          }));
        }
        if (route === 'GET /api/relation-map.mmd') {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end(weave.relationMapMmd());
        }
        if (route === 'GET /api/views') return send(200, weave.listViews());
        if (route === 'POST /api/views') return send(201, weave.createView(body ?? {}));
        if ((m = path.match(/^\/api\/views\/([^/]+)$/))) {
          if (req.method === 'GET') return send(200, weave.resolveView(m[1]));
          if (req.method === 'DELETE') return send(200, weave.deleteView(m[1]));
        }
        if ((m = path.match(/^\/api\/views\/([^/]+)\/share$/)) && req.method === 'POST') {
          return send(201, weave.shareView(m[1]));
        }
        if ((m = path.match(/^\/api\/views\/([^/]+)\/share$/)) && req.method === 'DELETE') {
          return send(200, weave.unshareView(m[1]));
        }
        if (route === 'GET /api/audit') {
          return send(200, weave.listAudit({
            limit: Number(url.searchParams.get('limit') ?? 100),
            offset: Number(url.searchParams.get('offset') ?? 0),
          }));
        }
        if (route === 'PATCH /api/workspace' && 'requireAuth' in (body ?? {})) {
          weave.setRequireAuth(!!body.requireAuth);
          if (Object.keys(body).length === 1) return send(200, { requireAuth: weave.state.meta.requireAuth });
        }
        if (route === 'PATCH /api/workspace') {
          if (body.description != null) weave.state.meta.description = String(body.description);
          if (body.name && body.name !== weave.state.meta.name) {
            if (!/^[a-z0-9][a-z0-9-_]*$/i.test(body.name)) throw new WeaveError('Workspace name must be alphanumeric', 'invalid');
            if (hub.get(body.name)) throw new WeaveError(`Workspace '${body.name}' already exists`, 'conflict');
            hub.rename(weave.state.meta.name, body.name);
            weave.state.meta.name = body.name;
          }
          weave.save();
          return send(200, { name: weave.state.meta.name, description: weave.state.meta.description ?? '' });
        }
        if (route === 'POST /api/markdown') {
          return send(200, { html: renderMarkdown(String(body.md ?? ''), { resolveMention }) });
        }

        if (path === '/api/workspace/logo') {
          if (req.method === 'GET') {
            const { meta, bytes } = weave.getWorkspaceLogo();
            return send(200, bytes, { 'Content-Type': meta.mime, 'Cache-Control': 'no-cache' });
          }
          if (req.method === 'PUT' || req.method === 'POST') {
            return send(200, weave.setWorkspaceLogo({ name: body.name, mime: body.mime, bytes: body.contentBase64 }));
          }
          if (req.method === 'DELETE') { weave.deleteWorkspaceLogo(); return send(200, { ok: true }); }
        }

        if (route === 'GET /api/spaces') return send(200, weave.listSpaces());
        if (route === 'POST /api/spaces') return send(201, weave.createSpace(body));
        if ((m = path.match(/^\/api\/spaces\/([^/]+)$/))) {
          if (req.method === 'GET') return send(200, weave.getSpace(m[1]));
          if (req.method === 'PATCH') return send(200, weave.updateSpace(m[1], body));
          if (req.method === 'DELETE') { weave.deleteSpace(m[1]); return send(200, { ok: true }); }
        }

        if (route === 'GET /api/tables') {
          const space = url.searchParams.get('space');
          const dbs = weave.listTables(space ? weave.getSpace(space).id : null);
          return send(200, dbs.map((db) => ({ id: db.id, name: db.name, qualified: weave.qualifiedName(db), spaceId: db.spaceId })));
        }
        if (route === 'POST /api/tables') return send(201, weave.createTable(body));
        if ((m = path.match(/^\/api\/tables\/([^/]+)$/))) {
          if (req.method === 'GET') {
            const db = weave.getTable(m[1]);
            const schema = weave.describeSchema().flatMap((s) => s.tables).find((d) => d.id === db.id);
            return send(200, schema);
          }
          if (req.method === 'PATCH') return send(200, weave.updateTable(m[1], body));
          if (req.method === 'DELETE') { weave.deleteTable(m[1]); return send(200, { ok: true }); }
        }

        if ((m = path.match(/^\/api\/tables\/([^/]+)\/fields$/)) && req.method === 'POST') {
          return send(201, weave.addField(m[1], body));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/fields\/([^/]+)$/))) {
          if (req.method === 'PATCH') return send(200, weave.updateField(m[1], m[2], body));
          if (req.method === 'DELETE') { weave.deleteField(m[1], m[2]); return send(200, { ok: true }); }
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/relations$/)) && req.method === 'POST') {
          return send(201, weave.addRelation(m[1], body));
        }

        if ((m = path.match(/^\/api\/tables\/([^/]+)\/entities$/))) {
          if (req.method === 'POST') {
            const e = weave.createEntity(m[1], body);
            return send(201, weave.readEntity(e.id));
          }
          if (req.method === 'GET') {
            const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : null;
            const offset = Number(url.searchParams.get('offset') ?? 0);
            return send(200, weave.query(m[1], { limit, offset }));
          }
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/query$/)) && req.method === 'POST') {
          return send(200, weave.query(m[1], body));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/trash$/)) && req.method === 'GET') {
          const items = weave.listTrash(m[1]);
          return send(200, { total: items.length, items });
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/export\.csv$/)) && req.method === 'GET') {
          return send(200, weave.exportCSV(m[1]), { 'Content-Type': 'text/csv; charset=utf-8' });
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/import\.csv$/)) && req.method === 'POST') {
          return send(200, weave.importCSV(m[1], body.csv ?? ''));
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)$/))) {
          if (req.method === 'GET') return send(200, weave.readEntity(m[1]));
          if (req.method === 'PATCH') {
            weave.updateEntity(m[1], body.values ?? body);
            return send(200, weave.readEntity(m[1]));
          }
          // Soft by default; ?hard=1 is the irreversible purge.
          if (req.method === 'DELETE') {
            const hard = ['1', 'true'].includes(url.searchParams.get('hard') ?? '');
            return send(200, { ok: true, ...weave.deleteEntity(m[1], { hard }) });
          }
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/restore$/)) && req.method === 'POST') {
          return send(200, weave.restoreEntity(m[1]));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/link$/)) && req.method === 'POST') {
          weave.link(m[1], body.field, body.targets ?? body.items);
          return send(200, weave.readEntity(m[1]));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/unlink$/)) && req.method === 'POST') {
          weave.unlink(m[1], body.field, body.targets ?? body.items);
          return send(200, weave.readEntity(m[1]));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/state$/)) && req.method === 'POST') {
          weave.setState(m[1], body.field, body.state);
          return send(200, weave.readEntity(m[1]));
        }

        // Document field selected by ?field= (GET) or body.field (PUT/POST);
        // omitted = the table's default (first) document field.
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/doc$/))) {
          const fieldRef = url.searchParams.get('field') ?? body.field ?? null;
          if (req.method === 'GET') return send(200, { field: fieldRef, doc: weave.getDoc(m[1], fieldRef) });
          if (req.method === 'PUT') { weave.setDoc(m[1], body.doc ?? body.markdown ?? '', fieldRef); return send(200, { ok: true }); }
          if (req.method === 'POST') { weave.appendDoc(m[1], body.doc ?? body.markdown ?? '', fieldRef); return send(200, { ok: true }); }
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/files$/)) && req.method === 'POST') {
          return send(201, weave.attachFile(m[1], { name: body.name, mime: body.mime, bytes: body.contentBase64 }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/files\/([^/]+)$/)) && req.method === 'DELETE') {
          weave.deleteFile(m[1], m[2]);
          return send(200, { ok: true });
        }
        if ((m = path.match(/^\/api\/files\/([^/]+)$/)) && req.method === 'GET') {
          const { meta, bytes } = weave.readFile(m[1]);
          return send(200, bytes, {
            'Content-Type': meta.mime,
            'Content-Disposition': `inline; filename="${meta.name.replace(/[^\w.-]+/g, '_')}"`,
          });
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/comments$/)) && req.method === 'POST') {
          return send(201, weave.addComment(m[1], body));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/comments\/([^/]+)$/)) && req.method === 'DELETE') {
          weave.deleteComment(m[1], m[2]);
          return send(200, { ok: true });
        }

        if (route === 'GET /api/automations') {
          return send(200, weave.describeAutomations(url.searchParams.get('db')));
        }
        if (route === 'POST /api/automations') {
          return send(201, weave.createAutomation(body.db, body));
        }
        if ((m = path.match(/^\/api\/automations\/([^/]+)$/))) {
          if (req.method === 'PATCH') return send(200, weave.updateAutomation(m[1], body));
          if (req.method === 'DELETE') { weave.deleteAutomation(m[1]); return send(200, { ok: true }); }
        }

        /* The Activity system table. Read-only by construction: there is no
           POST here, because an event is something that happened, not
           something anyone declares. */
        if (route === 'GET /api/activity') {
          return send(200, weave.activityFeed({
            entityId: url.searchParams.get('entity'),
            tableRef: url.searchParams.get('table'),
            kinds: url.searchParams.getAll('kind'),
            since: url.searchParams.get('since'),
            limit: url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : null,
            offset: Number(url.searchParams.get('offset') ?? 0),
          }));
        }
        if ((m = path.match(/^\/api\/activity\/(.+)$/)) && req.method === 'GET') {
          return send(200, weave.getActivity(decodeURIComponent(m[1])));
        }

        if (route === 'GET /api/search') {
          const q = url.searchParams.get('q') ?? '';
          const limit = Number(url.searchParams.get('limit') ?? 25);
          if (url.searchParams.get('all')) {
            // Cross-workspace search: permalinks carry the workspace path.
            const results = [];
            for (const [name, w] of hub.entries()) {
              const prefix = name === hub.defaultName ? '' : `/w/${name}`;
              for (const hit of w.universalSearch(q, { limit, prefix })) {
                results.push({ workspace: name, ...hit });
              }
            }
            return send(200, results.sort((a, b) => b.score - a.score).slice(0, limit));
          }
          return send(200, weave.universalSearch(q, { limit, prefix: wsPrefix }));
        }
        if (route === 'GET /api/export') return send(200, weave.exportJSON());
        if (route === 'POST /api/import') { weave.importJSON(body); return send(200, { ok: true }); }

        return send(404, { error: `No route: ${route}` });
      }

      // ---------- static UI ----------
      /* Vditor lazy-loads mermaid from inside its own dist tree. weave already
         vendors a mermaid build for document pages, so that path is aliased
         onto it rather than shipping a second 3.5MB copy of the same library. */
      const file = path === '/' ? '/index.html'
        : path === '/vendor/vditor/dist/js/mermaid/mermaid.min.js' ? '/vendor/mermaid.min.js'
        : path;
      const full = join(PUBLIC_DIR, file.replace(/\.\./g, ''));
      if (existsSync(full) && !full.endsWith('/')) {
        // no-cache, not no-store: the browser may keep a copy but must
        // revalidate. Without it heuristic caching serves a stale app.js or
        // style.css after an edit, so UI changes only appear on a hard reload.
        return send(200, readFileSync(full), {
          'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
          'Cache-Control': 'no-cache',
        });
      }
      return send(404, 'Not found');
    } catch (err) {
      const status = statusFor(err);
      if (status === 500) console.error(err);
      return send(status, { error: err.message, code: err.code ?? 'internal' });
    }
  });

  return server;
}

export function startServer(weave, { port = 4400, host = '127.0.0.1', workspaces = {} } = {}) {
  const server = createServer(weave, { workspaces });
  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({ server, port: server.address().port }));
  });
}
