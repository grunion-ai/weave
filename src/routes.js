// The runtime-agnostic request core (Feature #84). Every route weave serves,
// as a pure async function of a request-shaped object — no node:http, no
// node:fs, no imports beyond the engine and renderers, so the same dispatcher
// runs under node (src/server.js wraps it) and workerd (src/worker.js will).
// The adapter owns transport: reading the body stream, writing the response,
// and static assets (node reads public/; Workers bind Static Assets).
import { WeaveError } from './engine.js';
import { handleApplet } from './applet.js';
import { VOCABULARY } from './vocabulary.js';
import { renderDocumentPage, renderMarkdown, isHtmlDocument } from './markdown.js';
import { markdownToPdf } from './pdf.js';
// Loaded on demand: the vendored decklet engine resolves its own directory
// from import.meta.url at module scope, which is undefined inside a bundled
// Worker — evaluating it there fails the whole upload. Deck routes are rare
// and node-only anyway, so they pay for the import when they are asked for.
const deckModule = () => import('./deck.js');
import { handleMcpMessage } from './mcp.js';
import { renderBugReport, SYMPTOM_FIELD, MAX_EVENTS as MAX_BUG_EVENTS } from './bugreport.js';
import { renderAuthPage } from './auth-page.js';
import { verifyRegistration, verifyAssertion, newChallenge, b64url } from './webauthn.js';

export function statusFor(err) {
  if (!(err instanceof WeaveError)) return 500;
  return { 'not-found': 404, conflict: 409, invalid: 400, ambiguous: 400, forbidden: 403 }[err.code] ?? 400;
}

const STARTED_AT = new Date().toISOString();

/* What a browser sees at the wall (Feature #222 phase 0): the condition and
   the ways in — the passkey page (phase 2), a Bearer token, a share link. */
const wallPageHtml = (authHref) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in required</title><style>body{font:15px/1.5 -apple-system,sans-serif;max-width:480px;margin:4rem auto;padding:0 16px;color:#1a1d21}a{color:#2563eb}</style><h1>This workspace requires authentication</h1><p><a href="${authHref}">Sign in with a passkey</a>, send a Bearer token, or open a share link you were given.</p>`;

/* ---------- door B plumbing (Feature #222 part 2) ----------
   Challenges live five minutes in memory, keyed by a random id the client
   echoes back; rate limits are per IP, in memory, sized to blunt guessing
   and nothing more (10 options calls a minute, 5 failed verifies a minute). */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const LIMITS = { options: 10, failed: 5 };
const parseCookies = (header) => Object.fromEntries(String(header ?? '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf('='); return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)]; }));

/* hub: createWorkspaceHub's interface (get/list/create/rename/entries/
   defaultName). opts:
   - version: the version string /api/health reports (adapter resolves it —
     node reads package.json, the worker inlines it at deploy)
   - uptime: () => seconds (node: process.uptime; worker: isolate age)
   - backup: () => the nightly backup's last result ({lastAt, lastStatus,
     nextAt, dest}, no secrets) or null when WEAVE_BACKUP_DEST is unset —
     /api/health carries it so a stale backup shows where staleness is
     already checked (Feature #222 phase 3, Feature #209)
   - serveStatic: (path) => {status, headers, body} | null, or null when the
     platform serves assets before the dispatcher runs
   Returns handle(rx) where rx = { method, path (decoded pathname),
   searchParams, header(name), readBody() } → {status, headers, body}. */
export function createRequestHandler(hub, { version = 'unknown', uptime = () => 0, build = () => null, backup = () => null, serveStatic = null, origin = null, trustProxy = false, limits = LIMITS } = {}) {
  const challenges = new Map();
  const rates = { options: new Map(), failed: new Map() };
  /* limited(kind, ip) counts this call and says whether the minute's budget
     is spent; limited(kind, ip, { peek: true }) only asks. Options calls
     count on arrival; a verify counts only when it fails. */
  const limited = (kind, ip, { peek = false } = {}) => {
    const now = Date.now();
    const bucket = rates[kind];
    if (bucket.size > 5000) bucket.clear();
    let hit = bucket.get(ip);
    if (!hit || now - hit.at > 60 * 1000) { hit = { at: now, n: 0 }; bucket.set(ip, hit); }
    if (!peek) hit.n += 1;
    return hit.n > limits[kind] || (peek && hit.n >= limits[kind]);
  };
  const noteFailure = (ip) => limited('failed', ip);
  /* The id the client echoes back IS the challenge: 32 random bytes, used
     once — takeChallenge deletes on read, so a replayed verify finds nothing. */
  const putChallenge = (entry) => {
    const now = Date.now();
    for (const [k, v] of challenges) if (v.expiresAt <= now) challenges.delete(k);
    const id = newChallenge();
    challenges.set(id, { ...entry, expiresAt: now + CHALLENGE_TTL_MS });
    return id;
  };
  const takeChallenge = (id, kind) => {
    const c = challenges.get(id);
    challenges.delete(id);
    if (!c || c.kind !== kind || c.expiresAt <= Date.now()) return null;
    return c;
  };
  /* The origin passkeys are bound to. WEAVE_ORIGIN when set; else the
     loopback dev form — http://localhost:<port> — because a WebAuthn RP ID
     cannot be an IP address, and rpId is the origin's hostname. */
  const originFor = (rx) => {
    if (origin) return origin;
    const port = String(rx.header('host') ?? '').split(':')[1];
    return `http://localhost${port ? ':' + port : ''}`;
  };
  const rpIdFor = (rx) => new URL(originFor(rx)).hostname;
  const clientIp = (rx) => {
    const fwd = trustProxy ? String(rx.header('x-forwarded-for') ?? '').split(',')[0].trim() : '';
    return fwd || rx.remote || 'unknown';
  };
  const sessionCookie = (token, rx) => `wv_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}${originFor(rx).startsWith('https:') ? '; Secure' : ''}`;
  const clearCookie = (rx) => `wv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${originFor(rx).startsWith('https:') ? '; Secure' : ''}`;

  return async function handle(rx) {
    let path = rx.path;
    // Where the reader is: an instant renders in this zone (public/date-grain.js).
    const viewerZone = rx.header('x-weave-zone') || null;
    const out = (status, data, headers = {}) => {
      const isBin = data instanceof Uint8Array;
      const isStr = typeof data === 'string';
      // Same-origin only: no CORS headers. An unauthenticated localhost API
      // with ACAO:* would let any open website read/write the workspace
      // cross-origin (2026-08-16 release audit).
      return {
        status,
        headers: {
          'Content-Type': headers['Content-Type'] ?? (isBin || isStr ? 'text/plain; charset=utf-8' : 'application/json'),
          ...headers,
        },
        body: isBin || isStr ? data : JSON.stringify(data, null, 1),
      };
    };

    /* A browser navigation deserves a page, not a JSON shrug (Feature #148):
       GET on a non-API path answers with the branded 404 page when the
       platform serves statics; API callers keep the JSON error. */
    const notFound = (json) => {
      const isPage = rx.method === 'GET' && serveStatic && !path.includes('/api/');
      const page = isPage ? serveStatic('/404.html') : null;
      return page ? { ...page, status: 404 } : out(404, json);
    };

    // Workspace scoping: /w/<name>/... targets a sibling workspace.
    let weave = hub.get(hub.defaultName);
    let wsPrefix = '';
    const wsM = path.match(/^\/w\/([^/]+)(\/.*|$)/);
    if (wsM && wsM[1] !== 'undefined') {
      // Back-compat: the docs workspace was renamed weaver → weave.
      const target = hub.get(wsM[1]) ?? (wsM[1] === 'weaver' ? hub.get('weave') : null);
      if (!target) return notFound({ error: `Workspace '${wsM[1]}' not found`, code: 'not-found' });
      weave = target;
      wsPrefix = `/w/${wsM[1]}`;
      path = wsM[2] || '/';
    }
    // Pick up commits from other processes (CLI beside the server) before
    // serving anything from this workspace.
    weave.maybeRefresh();

    /* The registry lives at the root (Feature #219), but a member page reads
       and edits the rows that describe it through its own prefix: an entity
       id or a registry table the member does not hold falls through to the
       root engine. A Spaces row created from a member lands in that member.
       ponytail: a member's own Bearer tokens do not verify on the root; a
       member with requireAuth on reads its registry rows at the root URL. */
    const member = weave;
    {
      const root = weave.registryHost;
      const eM = root && path.match(/^\/(?:api\/entities|e)\/([^/]+)/);
      const tM = root && !eM && path.match(/^\/api\/tables\/([^/]+)/);
      if (eM && !weave.state.entities[eM[1]] && root.state.entities[eM[1]]) weave = root;
      else if (tM) {
        let ref = tM[1];
        try { ref = decodeURIComponent(ref); } catch { /* keep as is */ }
        const has = (w) => { try { return w.findTable(ref); } catch { return null; } }; // an ambiguous name is the route's to refuse
        if (!has(weave) && has(root)?.system) weave = root;
      }
    }

    // Who is calling (Feature #65): callers name themselves per request;
    // without a header every mutation is 'web'. Set each request — a sticky
    // actor from the last request would misattribute this one.
    weave.actor = String(rx.header('x-weave-actor') || 'web').slice(0, 120);

    // Accounts & roles (Feature #14). A Bearer token names the account and
    // caps what it may do; a bad token is a 401, never an anonymous
    // fallthrough. With requireAuth on, anonymous API calls are refused —
    // /api/health stays open so a monitor can still see the instance.
    const deny = (code, error) => out(code, { error, code: code === 401 ? 'unauthorized' : 'forbidden' });

    // A share link is its own authorization (Feature #17): the token names
    // exactly one view, rendered read-only, before any auth wall applies.
    {
      const shareM = path.match(/^\/view\/([A-Za-z0-9_-]+)$/);
      if (shareM && rx.method === 'GET') {
        const v = weave.viewByShareToken(shareM[1]);
        if (!v) return out(404, 'This share link is not (or no longer) valid.');
        const resolved = weave.resolveView(v.id);
        const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const block = (b) => `<h2>${esc(b.table)}</h2><table><thead><tr>${
          Object.keys(b.items[0]?.fields ?? { '—': 1 }).map((k) => `<th>${esc(k)}</th>`).join('')
        }</tr></thead><tbody>${
          b.items.map((e) => `<tr>${Object.values(e.fields).map((val) => `<td>${esc(Array.isArray(val) ? val.map((x) => x?.name ?? x).join(', ') : (val && typeof val === 'object' ? val.name ?? '' : val ?? ''))}</td>`).join('')}</tr>`).join('')
        }</tbody></table>`;
        return out(200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(resolved.name)}</title><style>body{font:15px/1.5 -apple-system,sans-serif;max-width:960px;margin:2rem auto;padding:0 16px;color:#1a1d21}table{border-collapse:collapse;width:100%;font-size:13.5px;margin:0 0 24px}th,td{border:1px solid #d9dde3;padding:5px 9px;text-align:left}th{background:#f4f6f8}h1{font-size:22px}h2{font-size:15px;margin:20px 0 6px}footer{color:#6b7280;font-size:12px;margin-top:32px}</style><h1>${esc(resolved.name)}</h1>${resolved.blocks.map(block).join('')}<footer>Shared read-only from a weave workspace.</footer>`,
          { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      }
    }

    // The task applet (mobile, passcode-gated). Like a share link it carries
    // its own authorization, so it sits ahead of the auth wall — and it is
    // generated here rather than dropped in public/, which the Cloudflare
    // assets binding would serve before this dispatcher ever runs.
    if (path === '/t' || path.startsWith('/t/')) {
      const appletBody = ['POST', 'PUT', 'PATCH'].includes(rx.method) ? await rx.readBody().catch(() => ({})) : {};
      try {
        const hit = handleApplet({
          weave,
          rx: { method: rx.method, header: (n) => rx.header(n), searchParams: rx.searchParams, body: appletBody },
          path,
          out,
          mount: `${wsPrefix}/t`,
        });
        if (hit) return hit;
      } catch (err) {
        // The applet sits ahead of the dispatcher's own try/catch; without
        // this a throw here would leave the phone waiting forever.
        const json = { error: err.message, code: err.code ?? 'error' };
        return err instanceof WeaveError && err.code === 'not-found' ? notFound(json) : out(500, json);
      }
    }

    /* The wall covers every route, not just /api (Feature #222 phase 0,
       closing Feature #194 problem 2): with requireAuth on, an entity page,
       doc.html, entity.pdf, a deck or the app shell needs a token like the
       API does. The doors that stay open carry their own authorization or
       are needed before anyone can sign in: /api/health for a monitor, the
       share link and the applet above, the sign-in page at /auth with its
       ceremonies under /api/auth/ (part 2), and the static CSS/JS/font/image
       assets — never a .html, which is the app itself. A browser gets a
       page, an API caller keeps the JSON. */
    const authHref = `${wsPrefix}/auth?next=${encodeURIComponent(wsPrefix + path)}`;
    const wallPage = () => out(401, wallPageHtml(authHref), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    const openDoor = path === '/api/health' || path === '/auth' || path.startsWith('/api/auth/')
      || (['GET', 'HEAD'].includes(rx.method) && /\.(css|js|mjs|map|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|ico)$/i.test(path));
    let role = null;
    /* Who is here (Feature #222 part 2): a Bearer token wins when both are
       present; otherwise the wv_session cookie names the account. A session
       minted on the hub root opens a member workspace too — the root is
       where the registry lives (Feature #219) and where an operator's
       passkey is registered; a member's own sessions still verify first. */
    let session = null;
    const cookies = parseCookies(rx.header('cookie'));
    const authz = rx.header('authorization');
    if (authz && /^Bearer /i.test(authz)) {
      const account = weave.verifyToken(authz.slice(7).trim());
      if (!account) return path.startsWith('/api/') ? deny(401, 'Invalid token') : wallPage();
      weave.actor = account.name;
      role = account.role;
    } else if (cookies.wv_session) {
      const root = hub.get(hub.defaultName);
      session = weave.verifySession(cookies.wv_session) ?? (root !== weave ? root.verifySession(cookies.wv_session) : null);
      if (session) {
        weave.actor = session.name;
        role = session.role;
      } else if (weave.state.meta.requireAuth && !openDoor) {
        // A dead cookie: the browser goes to the sign-in page and the cookie
        // is cleared on the way; an API caller keeps the JSON 401.
        return path.startsWith('/api/')
          ? deny(401, 'Session expired or revoked')
          : { status: 302, headers: { Location: authHref, 'Set-Cookie': clearCookie(rx), 'Cache-Control': 'no-store' }, body: '' };
      }
    } else if (weave.state.meta.requireAuth && !openDoor) {
      return path.startsWith('/api/') ? deny(401, 'This workspace requires authentication') : wallPage();
    }
    // The caps reach the page routes too: every page is a read, so a reader
    // may GET any of them and POST at none (Feature #222 phase 0). The auth
    // verbs are every account's own — a reader may sign out.
    if (role && role !== 'admin') {
      const m2 = rx.method;
      const read = m2 === 'GET' || m2 === 'HEAD' || path.startsWith('/api/auth/')
        || (m2 === 'POST' && (/^\/api\/tables\/[^/]+\/query$/.test(path) || path === '/api/markdown'));
      const schemaWrite = !read && (
        /^\/api\/(spaces|automations|accounts|registry)/.test(path)
        // MCP carries every tool, schema tools included — a capped token must
        // not widen itself through the tunnel. Admin (or the edge gate) only.
        || path === '/api/mcp'
        // Replacing the whole workspace is every schema change at once
        // (Issue #230): a writer barred from one field cannot swap them all.
        || path === '/api/import'
        || /^\/api\/tables$/.test(path)
        || (/^\/api\/tables\/[^/]+$/.test(path) && (m2 === 'PATCH' || m2 === 'DELETE'))
        // Re-homing, cloning or un-trashing a table is structure too (nav
        // kebab, 2026-08-31; restore since Issue #149).
        || /^\/api\/tables\/[^/]+\/(move|duplicate|restore)$/.test(path)
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
        // A bare uuid is the durable form: resolves whatever the names are now.
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref)) {
          const e = weave.state.entities[ref];
          if (!e || e.deletedAt) return null;
          return { href: `${wsPrefix}/e/${e.id}/doc.html`, label: weave.entityName(e), fields: weave.previewFields(e.id) };
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
          fields: weave.previewFields(entity.id),
        };
      } catch {
        return null; // an ambiguous or malformed ref is a miss, not a 500
      }
    };

    if (rx.method === 'OPTIONS') {
      return { status: 204, headers: { Allow: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, body: '' };
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
          return out(200, markdown, { 'Content-Type': 'text/markdown; charset=utf-8' });
        }
        if (m[3] === 'mmd') {
          return out(200, markdown, { 'Content-Type': 'text/vnd.mermaid; charset=utf-8' });
        }
        if (m[3] === 'html') {
          // An HTML document serves itself — its own styles and scripts, verbatim.
          if (isHtmlDocument(markdown)) return out(200, markdown, { 'Content-Type': 'text/html; charset=utf-8' });
          const page = renderDocumentPage({ title: entity.name || `#${entity.publicId}`, subtitle, markdown, resolveMention });
          return out(200, page, { 'Content-Type': 'text/html; charset=utf-8' });
        }
        const pdf = markdownToPdf(markdown, { title: entity.name || `#${entity.publicId}`, subtitle });
        return out(200, pdf, {
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
        if (m[2] === 'md') return out(200, md, { 'Content-Type': 'text/markdown; charset=utf-8' });
        if (m[2] === 'mmd') return out(200, md, { 'Content-Type': 'text/vnd.mermaid; charset=utf-8' });
        if (m[2] === 'html') {
          return out(200, renderDocumentPage({ title: entity.name || `#${entity.publicId}`, subtitle, markdown: md, resolveMention }), { 'Content-Type': 'text/html; charset=utf-8' });
        }
        return out(200, markdownToPdf(md, { title: entity.name || `#${entity.publicId}`, subtitle }), {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${(entity.name || 'entity').replace(/[^\w.-]+/g, '_')}.pdf"`,
        });
      }

      /* ---------- composed decks (Feature #118) ----------
         /e/:ref/deck.html is a deck the way /e/:ref/doc.html is a document:
         composed on read from the slides the entity links, never stored. A
         slide entity answers the same route with a one-slide preview wearing
         its deck's chrome. .json is the composed model plus what the decklet
         validator says about it. */
      if ((m = path.match(/^\/e\/([^/]+)\/deck\.(html|json)$/))) {
        const { renderDeck } = await deckModule();
        const built = renderDeck(weave, m[1]);
        if (m[2] === 'json') {
          return out(200, { model: built.model, errors: built.errors, warnings: built.warnings });
        }
        return out(200, built.html, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Weave-Deck-Warnings': String(built.warnings.length),
        });
      }

      if ((m = path.match(/^\/e\/([^/]+)$/))) {
        const entity = weave.readEntity(m[1]); // 404s if missing
        return { status: 302, headers: { Location: `${wsPrefix}/#/entity/${entity.id}` }, body: '' };
      }

      /* ---------- door B: the sign-in page and its ceremonies (Feature #222 part 2) ---------- */
      if (path === '/auth') {
        return out(200, renderAuthPage({ mount: wsPrefix, workspace: weave.state.meta.name }), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }

      // ---------- API ----------
      if (path.startsWith('/api/')) {
        const body = ['POST', 'PUT', 'PATCH'].includes(rx.method) ? await rx.readBody() : {};
        const route = `${rx.method} ${path}`;

        if (path.startsWith('/api/auth/')) {
          const ip = clientIp(rx);
          const tooMany = () => out(429, { error: 'Too many attempts — wait a minute and try again', code: 'rate-limited' });
          const who = () => session ?? (role ? weave.verifyToken(authz.slice(7).trim()) : null);
          // Which engine holds the session: the one asked, or the hub root.
          const holder = () => (session && weave.verifySession(cookies.wv_session)) ? weave : hub.get(hub.defaultName);
          if (route === 'POST /api/auth/register/options') {
            if (limited('options', ip)) return tooMany();
            const invite = body?.invite ? weave.readInvite(String(body.invite)) : null;
            const account = invite ?? who();
            if (!account) return deny(401, body?.invite ? 'This invite link is not valid or has expired — ask for a new one' : 'Registering a passkey needs an invite link or a signed-in session');
            const id = putChallenge({ kind: 'register', accountId: account.id, invite: invite ? String(body.invite) : null, holder: invite ? weave : holder() });
            return out(200, {
              id,
              options: {
                challenge: id,
                rp: { id: rpIdFor(rx), name: weave.state.meta.name || 'weave' },
                user: { id: b64url.encode(new TextEncoder().encode(account.id)), name: account.name, displayName: account.name },
                pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
                authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
                attestation: 'none',
                timeout: CHALLENGE_TTL_MS,
                excludeCredentials: (account.credentials ?? []).map((c) => ({ type: 'public-key', id: c.id, transports: c.transports ?? [] })),
              },
            });
          }
          if (route === 'POST /api/auth/register/verify') {
            if (limited('failed', ip, { peek: true })) return tooMany();
            const c = takeChallenge(String(body?.id ?? ''), 'register');
            if (!c) { noteFailure(ip); return out(400, { error: 'This registration expired or was already used — start again', code: 'invalid' }); }
            const engine = c.holder;
            let cred;
            try {
              cred = await verifyRegistration({ response: body?.response, expectedChallenge: String(body?.id), origin: originFor(rx), rpId: rpIdFor(rx) });
              if (c.invite) engine.consumeInvite(c.invite);
              engine.addCredential(c.accountId, { ...cred, label: String(body?.label ?? '').slice(0, 80) });
            } catch (err) {
              noteFailure(ip);
              throw err;
            }
            const minted = engine.createSession(c.accountId, { ua: rx.header('user-agent') });
            return out(200, { ok: true, account: minted.account, credential: { id: cred.id, alg: cred.alg } }, { 'Set-Cookie': sessionCookie(minted.token, rx), 'Cache-Control': 'no-store' });
          }
          if (route === 'POST /api/auth/login/options') {
            if (limited('options', ip)) return tooMany();
            const id = putChallenge({ kind: 'login' });
            return out(200, { id, options: { challenge: id, rpId: rpIdFor(rx), allowCredentials: [], userVerification: 'preferred', timeout: CHALLENGE_TTL_MS } });
          }
          if (route === 'POST /api/auth/login/verify') {
            if (limited('failed', ip, { peek: true })) return tooMany();
            const c = takeChallenge(String(body?.id ?? ''), 'login');
            if (!c) { noteFailure(ip); return out(400, { error: 'This sign-in expired or was already used — start again', code: 'invalid' }); }
            const credId = String(body?.response?.id ?? '');
            // The credential's home: this workspace, or the hub root.
            const root = hub.get(hub.defaultName);
            const engine = weave.credentialById(credId) ? weave : (root.credentialById(credId) ? root : null);
            const hit = engine?.credentialById(credId);
            if (!hit) { noteFailure(ip); return deny(401, 'No account holds this passkey — it may have been removed; ask for an invite'); }
            let verdict;
            try {
              verdict = await verifyAssertion({ response: body?.response, credential: hit.credential, expectedChallenge: String(body?.id), origin: originFor(rx), rpId: rpIdFor(rx) });
            } catch (err) {
              noteFailure(ip);
              throw err;
            }
            engine.useCredential(credId, { counter: verdict.counter });
            const minted = engine.createSession(hit.account.id, { ua: rx.header('user-agent') });
            return out(200, { ok: true, account: minted.account }, { 'Set-Cookie': sessionCookie(minted.token, rx), 'Cache-Control': 'no-store' });
          }
          if (route === 'POST /api/auth/logout') {
            if (session) {
              try { holder().revokeSession(session.id, { id: session.sessionId }); } catch { /* already gone */ }
            }
            return out(200, { ok: true }, { 'Set-Cookie': clearCookie(rx), 'Cache-Control': 'no-store' });
          }
          if (route === 'GET /api/auth/me') {
            const account = who();
            if (!account) return deny(401, 'Not signed in');
            const engine = session ? holder() : weave;
            const sessions = engine.listSessions(account.id).map(({ accountId, ...s }) => ({ ...s, current: s.id === session?.sessionId }));
            const { credentials = [], ...pub } = engine.listAccounts().find((a) => a.id === account.id) ?? account;
            return out(200, { account: pub, role: account.role, sessions, credentials }, { 'Cache-Control': 'no-store' });
          }
          /* The two self-service verbs the You section needs. `others` ends
             every session but this one; an id ends that one. */
          if ((m = path.match(/^\/api\/auth\/sessions\/([^/]+)$/)) && rx.method === 'DELETE') {
            const account = who();
            if (!account) return deny(401, 'Not signed in');
            const engine = session ? holder() : weave;
            if (m[1] === 'others') return out(200, engine.revokeSession(account.id, { all: true, except: session?.sessionId ?? null }));
            return out(200, engine.revokeSession(account.id, { id: m[1] }));
          }
          if ((m = path.match(/^\/api\/auth\/credentials\/([^/]+)$/)) && rx.method === 'DELETE') {
            const account = who();
            if (!account) return deny(401, 'Not signed in');
            const engine = session ? holder() : weave;
            return out(200, engine.removeCredential(account.id, decodeURIComponent(m[1])));
          }
          return notFound({ error: 'Unknown auth route', code: 'not-found' });
        }

        // startedAt + uptime let callers spot a stale server (process start
        // time vs commit/package version) instead of assuming "up" = "current".
        if (route === 'GET /api/health') {
          const nightly = backup();
          return out(200, { ok: true, name: 'weave', version, workspace: weave.state.meta.name, startedAt: STARTED_AT, uptime: Math.round(uptime()), ...(build() ?? {}), ...weave.storageStats(), ...(nightly ? { backup: nightly } : {}) });
        }
        if (route === 'GET /api/schema') return out(200, weave.describeSchema());
        // Every closed set a config value can come from, and what the choice
        // looks like on screen — served so an agent never has to guess a
        // color, an icon name or a format (src/vocabulary.js).
        if (route === 'GET /api/vocabulary') return out(200, VOCABULARY);

        if (route === 'GET /api/workspaces') {
          const includeDeleted = ['1', 'true'].includes(rx.searchParams.get('deleted') ?? '');
          return out(200, hub.list({ includeDeleted }));
        }
        if (route === 'POST /api/workspaces') {
          const w = hub.create(body.name);
          return out(201, { name: w.state.meta.name, url: `/w/${w.state.meta.name}/` });
        }
        // Workspace trash: soft only — a .db file is removed by a human, not
        // an API call. Restore is the inverse.
        if ((m = path.match(/^\/api\/workspaces\/([^/]+)\/restore$/)) && rx.method === 'POST') {
          const w = hub.restore(m[1]);
          return out(200, { name: w.state.meta.name, deletedAt: null });
        }
        if ((m = path.match(/^\/api\/workspaces\/([^/]+)$/)) && rx.method === 'DELETE') {
          if (!hub.remove) return out(400, { error: 'This deployment cannot delete workspaces' });
          const hard = ['1', 'true'].includes(rx.searchParams.get('hard') ?? '');
          if (hard) return out(200, hub.remove(m[1], { hard: true }));
          const w = hub.remove(m[1]);
          return out(200, { name: w.state.meta.name, deletedAt: w.state.meta.deletedAt });
        }


        if (route === 'GET /api/workspace') {
          const ws = weave.getWorkspace();
          return out(200, { ...ws, url: `/w/${ws.id}/` });
        }

        // Accounts (Feature #14). Once any account exists, only an admin
        // token manages them — the anonymous door closes behind the first key.
        if (path.startsWith('/api/accounts') || (route === 'PATCH /api/workspace' && 'requireAuth' in (body ?? {}))) {
          if (weave.listAccounts().length && role !== 'admin') {
            return deny(role ? 403 : 401, 'Managing accounts needs an admin token');
          }
        }
        if (route === 'GET /api/accounts') return out(200, weave.listAccounts());
        if (route === 'POST /api/accounts') return out(201, weave.createAccount(body ?? {}));
        if ((m = path.match(/^\/api\/accounts\/(.+)$/)) && rx.method === 'DELETE') {
          return out(200, weave.deleteAccount(decodeURIComponent(m[1])));
        }
        // Keystore (Feature #64): set, list, delete — never read back. The
        // same admin gate as accounts once any account exists.
        if (path.startsWith('/api/keys')) {
          if (weave.listAccounts().length && role !== 'admin') {
            return deny(role ? 403 : 401, 'Managing keys needs an admin token');
          }
          if (route === 'GET /api/keys') return out(200, weave.listKeys());
          if (route === 'POST /api/keys') return out(201, weave.setKey(body?.name, body?.value));
          /* Reveal is its own verb on its own path (Feature #143). It is a
             POST because it is an act, not a read: the credential's access
             list decides, and every call lands in the audit log. GET stays
             a 404 so nothing that merely follows links can spend a reveal. */
          if ((m = path.match(/^\/api\/keys\/([^/]+)\/reveal$/)) && rx.method === 'POST') {
            return out(200, { name: decodeURIComponent(m[1]), value: weave.revealKey(decodeURIComponent(m[1]), { via: body?.via ?? 'show' }) });
          }
          if ((m = path.match(/^\/api\/keys\/([^/]+)\/share$/))) {
            const name = decodeURIComponent(m[1]);
            if (rx.method === 'POST') return out(200, weave.grantKey(name, body?.account));
            if (rx.method === 'DELETE') return out(200, weave.revokeKey(name, body?.account));
          }
          if ((m = path.match(/^\/api\/keys\/(.+)$/))) {
            if (rx.method === 'DELETE') return out(200, weave.deleteKey(decodeURIComponent(m[1])));
            return out(404, { error: 'Secrets cannot be read back', code: 'not-found' });
          }
        }
        if (route === 'PUT /api/schema') {
          return out(200, weave.applySchema(body?.schema ?? body, {
            dryRun: !!body?.dryRun,
            allowDestructive: !!body?.allowDestructive,
          }));
        }
        if (route === 'GET /api/relation-map.mmd') {
          return out(200, weave.relationMapMmd());
        }
        // The meta-model registries, the third door beside MCP and the CLI.
        if (route === 'GET /api/registry') return out(200, weave.registryReport());
        if (route === 'POST /api/registry/rebuild') return out(200, weave.rebuildRegistry());
        if (route === 'GET /api/views') return out(200, weave.listViews());
        if (route === 'POST /api/views') return out(201, weave.createView(body ?? {}));
        if ((m = path.match(/^\/api\/views\/([^/]+)$/))) {
          if (rx.method === 'GET') return out(200, weave.resolveView(m[1]));
          if (rx.method === 'DELETE') return out(200, weave.deleteView(m[1]));
        }
        if ((m = path.match(/^\/api\/views\/([^/]+)\/share$/)) && rx.method === 'POST') {
          return out(201, weave.shareView(m[1]));
        }
        if ((m = path.match(/^\/api\/views\/([^/]+)\/share$/)) && rx.method === 'DELETE') {
          return out(200, weave.unshareView(m[1]));
        }
        if (route === 'GET /api/audit') {
          return out(200, weave.listAudit({
            limit: Number(rx.searchParams.get('limit') ?? 100),
            offset: Number(rx.searchParams.get('offset') ?? 0),
          }));
        }
        /* MCP over HTTP (Feature #99): stateless streamable-HTTP, JSON mode —
           one JSON-RPC message (or a batch array) per POST, the response in
           the body, 202 for notifications. The same handler as stdio, so the
           hosted instance speaks exactly what a local agent already speaks. */
        if (route === 'POST /api/mcp') {
          const msgs = Array.isArray(body) ? body : [body];
          const replies = msgs.map((msg) => handleMcpMessage(weave, msg, { version })).filter(Boolean);
          if (!replies.length) return { status: 202, headers: { 'Content-Type': 'application/json' }, body: '' };
          return out(200, Array.isArray(body) ? replies : replies[0]);
        }
        if (route === 'GET /api/undo') {
          return out(200, weave.listUndo({ limit: Number(rx.searchParams.get('limit') ?? 20) }));
        }
        /* One write for a whole selection (Feature #132, slice 3): body is
           { ids, op, ...params }; the reply names what landed and what did not. */
        if (route === 'POST /api/bulk') {
          const { ids, op, ...params } = body ?? {};
          return out(200, weave.bulk(ids, op, params));
        }
        if (route === 'POST /api/undo') {
          return out(200, weave.undo({ steps: Math.max(1, Number(body?.steps ?? 1)) }));
        }
        if (route === 'PATCH /api/workspace' && 'requireAuth' in (body ?? {})) {
          weave.setRequireAuth(!!body.requireAuth);
          if (Object.keys(body).length === 1) return out(200, { requireAuth: weave.state.meta.requireAuth });
        }
        if (route === 'PATCH /api/workspace') {
          // The record is the engine's; the hub's name index is the server's.
          const renaming = body.name && body.name !== weave.state.meta.name;
          if (renaming && hub.get(body.name)) throw new WeaveError(`Workspace '${body.name}' already exists`, 'conflict');
          const was = weave.state.meta.name;
          const ws = weave.updateWorkspace({ name: body.name ?? null, description: body.description ?? null });
          if (renaming) hub.rename(was, ws.name);
          return out(200, { id: ws.id, url: `/w/${ws.id}/`, name: ws.name, description: ws.description });
        }
        if (route === 'POST /api/markdown') {
          return out(200, { html: renderMarkdown(String(body.md ?? ''), { resolveMention }) });
        }

        /* The in-app bug reporter (Feature #141). A reporter picks one of four
           things, and the page hands over the ring buffer of what just
           happened; the report is rendered and filed here.

           It files into the **weave** docs workspace, whichever workspace the
           reporter was looking at, because a bug in weave is not a row in
           somebody's data. And the server supplies its own version, start
           time and workspace name rather than trusting the page's copy — a
           stale build reporting its own version is how this project's most
           common false bug starts. */
        if (route === 'POST /api/bug-report') {
          const events = body?.events ?? [];
          if (!Array.isArray(events) || events.length > MAX_BUG_EVENTS) {
            return out(400, { error: `events must be an array of at most ${MAX_BUG_EVENTS} entries`, code: 'invalid' });
          }
          // The docs workspace, by either spelling, or this instance is not
          // one a bug can be filed against.
          const docs = hub.get('weave') ?? hub.get('weaver');
          const issues = docs && (() => { try { return docs.getTable('Development/Issue'); } catch { return null; } })();
          if (!issues) {
            return out(501, { error: 'No Development/Issue table to file into — this instance has no weave docs workspace', code: 'unsupported' });
          }
          docs.maybeRefresh();
          /* renderBugReport is the validator too: an unknown symptom, or a
             report with neither a symptom nor a note, throws before anything
             is written. */
          let report;
          try {
            report = renderBugReport({
              categories: body?.categories ?? [],
              note: body?.note,
              events,
              client: body?.client ?? {},
              server: {
                version,
                startedAt: STARTED_AT,
                uptime: Math.round(uptime()),
                workspace: weave.state.meta.name,
              },
            });
          } catch (err) {
            return out(400, { error: err.message, code: 'invalid' });
          }
          const was = docs.actor;
          docs.actor = 'bug-report';
          try {
            /* The symptoms land in a real multiselect so a week of reports
               can be filtered rather than read (Kyle, 2026-08-25: "this should
               map perfectly to an issue record with a multiselect and a
               description field"). A workspace seeded before the field existed
               keeps them in the Description alone rather than 400ing. */
            const values = { Severity: report.severity };
            const field = docs.findField(issues, SYMPTOM_FIELD);
            /* Only options the field actually declares. A workspace whose
               options were renamed would otherwise reject the whole create
               ("'Slow or stuck' is not an option of 'Symptom'", seen live
               2026-08-25) and lose a report over a label edit. */
            const declared = new Set((field?.config?.options ?? []).map((o) => o?.name ?? o));
            const settable = report.symptoms.filter((s) => declared.has(s));
            if (settable.length) values[SYMPTOM_FIELD] = settable;
            /* The report goes to whatever the Issue table calls its
               description. Naming it 'Description' threw 'not a document
               field' the moment someone renamed it, and the handler above
               does not catch — the whole report was lost over a label edit.
               A table with no description at all files the row anyway. */
            const described = docs.descriptionField(issues);
            const issue = docs.createEntity(issues.id, {
              name: report.title,
              values,
              ...(described ? { docs: { [described.name]: report.markdown } } : {}),
            });
            return out(201, {
              id: issue.id,
              publicId: issue.publicId,
              workspace: docs.state.meta.name,
              table: 'Development/Issue',
              severity: report.severity,
              symptoms: settable,
              url: `/w/${docs.state.meta.name}/#/entity/${issue.id}`,
            });
          } finally {
            docs.actor = was;
          }
        }

        if (path === '/api/workspace/logo') {
          if (rx.method === 'GET') {
            const { meta, bytes } = weave.getWorkspaceLogo();
            return out(200, bytes, { 'Content-Type': meta.mime, 'Cache-Control': 'no-cache' });
          }
          if (rx.method === 'PUT' || rx.method === 'POST') {
            return out(200, weave.setWorkspaceLogo({ name: body.name, mime: body.mime, bytes: body.contentBase64 }));
          }
          if (rx.method === 'DELETE') { weave.deleteWorkspaceLogo(); return out(200, { ok: true }); }
        }

        if (route === 'GET /api/spaces') return out(200, weave.listSpaces());
        if (route === 'POST /api/spaces') return out(201, weave.createSpace(body));
        if ((m = path.match(/^\/api\/spaces\/([^/]+)$/))) {
          if (rx.method === 'GET') return out(200, weave.getSpace(m[1]));
          if (rx.method === 'PATCH') return out(200, weave.updateSpace(m[1], body));
          if (rx.method === 'DELETE') {
            const hard = ['1', 'true'].includes(rx.searchParams.get('hard') ?? '');
            weave.deleteSpace(m[1], { hard });
            return out(200, { ok: true });
          }
        }
        if ((m = path.match(/^\/api\/spaces\/([^/]+)\/restore$/)) && rx.method === 'POST') {
          return out(200, weave.restoreSpace(m[1]));
        }

        if (route === 'GET /api/tables') {
          const space = rx.searchParams.get('space');
          const dbs = weave.listTables(space ? weave.getSpace(space).id : null);
          return out(200, dbs.map((db) => ({ id: db.id, name: db.name, qualified: weave.qualifiedName(db), spaceId: db.spaceId })));
        }
        if (route === 'POST /api/tables') return out(201, weave.createTable(body));
        if ((m = path.match(/^\/api\/tables\/([^/]+)$/))) {
          if (rx.method === 'GET') {
            const db = weave.getTable(m[1]);
            const schema = weave.describeSchema().flatMap((s) => s.tables).find((d) => d.id === db.id);
            return out(200, schema ?? { id: db.id, name: db.name, spaceId: db.spaceId, deletedAt: db.deletedAt ?? null });
          }
          if (rx.method === 'PATCH') return out(200, weave.updateTable(m[1], body));
          if (rx.method === 'DELETE') {
            const hard = ['1', 'true'].includes(rx.searchParams.get('hard') ?? '');
            weave.deleteTable(m[1], { hard });
            return out(200, { ok: true });
          }
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/move$/)) && rx.method === 'POST') {
          if (typeof body.space !== 'string' || !body.space.trim()) throw new WeaveError('space is required: the destination space', 'invalid');
          return out(200, weave.moveTable(m[1], body.space));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/duplicate$/)) && rx.method === 'POST') {
          return out(201, weave.duplicateTable(m[1]));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/restore$/)) && rx.method === 'POST') {
          return out(200, weave.restoreTable(m[1]));
        }

        if ((m = path.match(/^\/api\/tables\/([^/]+)\/fields$/)) && rx.method === 'POST') {
          return out(201, weave.addField(m[1], body));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/fields\/([^/]+)$/))) {
          if (rx.method === 'PATCH') return out(200, weave.updateField(m[1], m[2], body));
          if (rx.method === 'DELETE') { weave.deleteField(m[1], m[2]); return out(200, { ok: true }); }
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/relations$/)) && rx.method === 'POST') {
          return out(201, weave.addRelation(m[1], body));
        }

        if ((m = path.match(/^\/api\/tables\/([^/]+)\/entities$/))) {
          if (rx.method === 'POST') {
            // A Spaces row born on a member page belongs to that member
            // (Feature #219); the engine accepts the workspace id as the ref.
            if (weave !== member && weave.findTable(m[1])?.system === 'spaces') {
              const values = body.values ?? body;
              if (values.Workspace == null) values.Workspace = member.state.meta.id;
            }
            const e = weave.createEntity(m[1], body);
            return out(201, weave.readEntity(e.id, { viewerZone }));
          }
          if (rx.method === 'GET') {
            const limit = rx.searchParams.has('limit') ? Number(rx.searchParams.get('limit')) : null;
            const offset = Number(rx.searchParams.get('offset') ?? 0);
            return out(200, weave.query(m[1], { limit, offset, viewerZone }));
          }
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/query$/)) && rx.method === 'POST') {
          return out(200, weave.query(m[1], { ...body, viewerZone }));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/formula-check$/)) && rx.method === 'POST') {
          return out(200, weave.checkFormula(m[1], body?.expression, { entity: body?.entity ?? null, excludeField: body?.excludeField ?? null, scan: Boolean(body?.scan) }));
        }
        // Every column summarised — the five-number summary and a histogram
        // for numbers, a distribution for chips, the span for dates — plus
        // the space rollups pointed at the table. ?by=Field groups the numeric
        // columns; ?where=<json> narrows the rows (src/stats.js).
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/stats$/)) && rx.method === 'GET') {
          const by = rx.searchParams.get('by') || null;
          const raw = rx.searchParams.get('where');
          let where = null;
          if (raw) { try { where = JSON.parse(raw); } catch { return out(400, { error: 'where must be JSON' }); } }
          return out(200, weave.tableStats(m[1], { by, where }));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/trash$/)) && rx.method === 'GET') {
          const items = weave.listTrash(m[1]);
          return out(200, { total: items.length, items });
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/export\.csv$/)) && rx.method === 'GET') {
          return out(200, weave.exportCSV(m[1]), { 'Content-Type': 'text/csv; charset=utf-8' });
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/import\.csv$/)) && rx.method === 'POST') {
          return out(200, weave.importCSV(m[1], body.csv ?? ''));
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)$/))) {
          if (rx.method === 'GET') return out(200, weave.readEntity(m[1], { viewerZone }));
          if (rx.method === 'PATCH') {
            weave.updateEntity(m[1], body.values ?? body);
            return out(200, weave.readEntity(m[1], { viewerZone }));
          }
          // Soft by default; ?hard=1 is the irreversible purge.
          if (rx.method === 'DELETE') {
            const hard = ['1', 'true'].includes(rx.searchParams.get('hard') ?? '');
            return out(200, { ok: true, ...weave.deleteEntity(m[1], { hard }) });
          }
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/restore$/)) && rx.method === 'POST') {
          return out(200, weave.restoreEntity(m[1]));
        }
        // Backlinks: entities whose documents mention this one. A reference,
        // never a relation — computed from the text, not stored.
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/references$/)) && rx.method === 'GET') {
          return out(200, weave.referencesTo(m[1]));
        }
        // The outbound mirror: entities this one's documents mention.
        /* One row as its chip or card, optionally under a candidate config
           (?config=<json>): the field dialog's live preview. A read: nothing
           is saved. */
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/view$/)) && rx.method === 'GET') {
          const shape = rx.searchParams.get('shape') ?? 'chip';
          const rawCfg = rx.searchParams.get('config');
          let config = null;
          if (rawCfg) {
            try { config = JSON.parse(rawCfg); } catch { throw new WeaveError('config is a JSON object', 'invalid'); }
          }
          return out(200, weave.renderView(m[1], shape, { config }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/references-from$/)) && rx.method === 'GET') {
          return out(200, weave.referencesFrom(m[1]));
        }
        // A slide's next version: same key and content, Version + 1, pointing
        // back at what it supersedes. ?promote=1 swaps it into the decks the
        // old row sat in, keeping its place in each running order.
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/version$/)) && rx.method === 'POST') {
          const promote = ['1', 'true'].includes(rx.searchParams.get('promote') ?? '') || body.promote === true;
          const { newSlideVersion } = await deckModule();
          const made = newSlideVersion(weave, m[1], { promote });
          return out(201, weave.readEntity(made.id));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/link$/)) && rx.method === 'POST') {
          weave.link(m[1], body.field, body.targets ?? body.items);
          return out(200, weave.readEntity(m[1], { viewerZone }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/unlink$/)) && rx.method === 'POST') {
          weave.unlink(m[1], body.field, body.targets ?? body.items);
          return out(200, weave.readEntity(m[1], { viewerZone }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/state$/)) && rx.method === 'POST') {
          weave.setState(m[1], body.field, body.state);
          return out(200, weave.readEntity(m[1], { viewerZone }));
        }

        // Document history (Feature #225): metadata newest first, one
        // revision's text, and a restore that is an ordinary write.
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/doc\/revisions$/)) && rx.method === 'GET') {
          const fieldRef = rx.searchParams.get('field') ?? null;
          return out(200, weave.listDocRevisions(m[1], fieldRef, { limit: rx.searchParams.get('limit') ?? 50 }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/doc\/revisions\/([^/]+)$/)) && rx.method === 'GET') {
          return out(200, weave.getDocRevision(m[1], rx.searchParams.get('field') ?? null, m[2]));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/doc\/revisions\/([^/]+)\/restore$/)) && rx.method === 'POST') {
          return out(200, weave.restoreDocRevision(m[1], body.field ?? null, m[2]));
        }

        // Document field selected by ?field= (GET) or body.field (PUT/POST);
        // omitted = the table's default (first) document field.
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/doc$/))) {
          const fieldRef = rx.searchParams.get('field') ?? body.field ?? null;
          if (rx.method === 'GET') return out(200, { field: fieldRef, doc: weave.getDoc(m[1], fieldRef) });
          if (rx.method === 'PUT') { weave.setDoc(m[1], body.doc ?? body.markdown ?? '', fieldRef); return out(200, { ok: true }); }
          if (rx.method === 'POST') { weave.appendDoc(m[1], body.doc ?? body.markdown ?? '', fieldRef); return out(200, { ok: true }); }
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/fields\/([^/]+)\/files$/)) && rx.method === 'POST') {
          return out(201, weave.attachToField(m[1], decodeURIComponent(m[2]), { name: body.name, mime: body.mime, bytes: body.bytes ?? body.contentBase64 }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/files$/)) && rx.method === 'POST') {
          return out(201, weave.attachFile(m[1], { name: body.name, mime: body.mime, bytes: body.contentBase64 }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/files\/([^/]+)$/)) && rx.method === 'DELETE') {
          weave.deleteFile(m[1], m[2]);
          return out(200, { ok: true });
        }
        if ((m = path.match(/^\/api\/files\/([^/]+)$/)) && rx.method === 'GET') {
          const { meta, bytes } = weave.readFile(m[1]);
          return out(200, bytes, {
            'Content-Type': meta.mime,
            'Content-Disposition': `inline; filename="${meta.name.replace(/[^\w.-]+/g, '_')}"`,
          });
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/comments$/)) && rx.method === 'POST') {
          return out(201, weave.addComment(m[1], body));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/comments\/([^/]+)$/)) && rx.method === 'DELETE') {
          weave.deleteComment(m[1], m[2]);
          return out(200, { ok: true });
        }

        if (route === 'GET /api/automations') {
          return out(200, weave.describeAutomations(rx.searchParams.get('db')));
        }
        if (route === 'POST /api/automations') {
          return out(201, weave.createAutomation(body.db, body));
        }
        if ((m = path.match(/^\/api\/automations\/([^/]+)$/))) {
          if (rx.method === 'PATCH') return out(200, weave.updateAutomation(m[1], body));
          if (rx.method === 'DELETE') { weave.deleteAutomation(m[1]); return out(200, { ok: true }); }
        }

        /* The Activity system table. Read-only by construction: there is no
           POST here, because an event is something that happened, not
           something anyone declares. */
        if (route === 'GET /api/activity') {
          return out(200, weave.activityFeed({
            entityId: rx.searchParams.get('entity'),
            tableRef: rx.searchParams.get('table'),
            kinds: rx.searchParams.getAll('kind'),
            since: rx.searchParams.get('since'),
            limit: rx.searchParams.has('limit') ? Number(rx.searchParams.get('limit')) : null,
            offset: Number(rx.searchParams.get('offset') ?? 0),
          }));
        }
        if ((m = path.match(/^\/api\/activity\/(.+)$/)) && rx.method === 'GET') {
          return out(200, weave.getActivity(decodeURIComponent(m[1])));
        }

        if (route === 'GET /api/search') {
          const q = rx.searchParams.get('q') ?? '';
          const limit = Number(rx.searchParams.get('limit') ?? 25);
          if (rx.searchParams.get('all')) {
            // Cross-workspace search: permalinks carry the workspace path.
            const results = [];
            for (const [name, w] of hub.entries()) {
              const prefix = name === hub.defaultName ? '' : `/w/${name}`;
              for (const hit of w.universalSearch(q, { limit, prefix })) {
                results.push({ workspace: name, ...hit });
              }
            }
            return out(200, results.sort((a, b) => b.score - a.score).slice(0, limit));
          }
          return out(200, weave.universalSearch(q, { limit, prefix: wsPrefix }));
        }
        if (route === 'GET /api/export') return out(200, weave.exportJSON());
        if (route === 'POST /api/import') { weave.importJSON(body); return out(200, { ok: true }); }

        return out(404, { error: `No route: ${route}` });
      }

      // ---------- static UI ----------
      if (serveStatic) {
        const hit = serveStatic(path, rx);
        if (hit) return hit;
      }
      return notFound('Not found');
    } catch (err) {
      const status = statusFor(err);
      if (status === 500 && typeof console !== 'undefined') console.error(err);
      const json = { error: err.message, code: err.code ?? 'internal' };
      // A not-found from the engine (unknown entity id on /e/<id>, Issue #238)
      // is a navigation miss like any other: the page rule decides.
      return status === 404 ? notFound(json) : out(status, json);
    }
  };
}
