import { Weave, WeaveError, fileHeaders, logoType, inviteUrl } from './engine.js';
import { handleApplet } from './applet.js';
import { vocabularyView } from './vocabulary.js';
import { guided } from './field-hints.js';
import { renderDocumentPage, renderMarkdown, isHtmlDocument, escapeHtml } from './markdown.js';
import { markdownToPdf } from './pdf.js';
const deckModule = () => import('./deck.js');
import { handleMcpMessage, mayAdminister } from './mcp.js';
import { workspaceSlug } from './workspace-name.js';
import { renderBugReport, SYMPTOM_FIELD, MAX_EVENTS as MAX_BUG_EVENTS } from './bugreport.js';
import { renderAuthPage, renderRefusalPage } from './auth-page.js';
import { PRIVACY, TERMS } from './legal.js';
import { inviteEmail, inviteAcceptedEmail, ROLES as MAIL_ROLES, longDate } from './mail.js';
import '../public/starter-core.js';
import '../public/prefill-core.js';
const { WeaveStarters, weavePrefill } = globalThis;

export function statusFor(err) {
  if (!(err instanceof WeaveError)) return 500;
  return { 'not-found': 404, conflict: 409, invalid: 400, ambiguous: 400, forbidden: 403, 'unsupported-type': 415 }[err.code] ?? 400;
}

const STARTED_AT = new Date().toISOString();

const wallPageHtml = (authHref, provider = null) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in required</title><style>body{font:15px/1.5 -apple-system,sans-serif;max-width:480px;margin:4rem auto;padding:0 16px;color:#1a1d21}a{color:#2563eb}</style><h1>This workspace requires authentication</h1><p><a href="${authHref}">Sign in${provider ? ` with ${escapeHtml(provider)}` : ''}</a>, send a Bearer token, or open a share link you were given.</p>`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const metaAttr = (s) => escapeHtml(s).replace(/\r?\n/g, '&#10;');
const PREFILL_SKIP = new Set(['lookup', 'rollup', 'formula', 'view', 'attachments', 'field']);
const pickOption = (options, ref) => options.find((o) => o.id === ref)
  ?? options.find((o) => o.name === ref)
  ?? options.find((o) => o.name.toLowerCase() === String(ref).toLowerCase());
function prefillDraft(weave, ref, params) {
  const db = weave.getTable(ref);
  const { pairs, cut } = weavePrefill.clip(params);
  const slots = new Map();
  const unknown = [];
  for (const [key, raw] of pairs) {
    const f = weave.findField(db, key);
    if (!f || PREFILL_SKIP.has(f.type)) {
      if (!unknown.includes(key)) unknown.push(key);
      continue;
    }
    if (!slots.has(f.id)) slots.set(f.id, { f, raws: [] });
    slots.get(f.id).raws.push(raw);
  }
  const fields = [...slots.values()].map(({ f, raws }) => {
    const errors = [];
    const out = { field: f.name, type: f.type, errors };
    const list = f.type === 'multiselect' || (f.type === 'relation' && f.config.many);
    const picked = list ? raws : raws.slice(0, 1);
    if (f.type === 'select' || f.type === 'multiselect' || f.type === 'workflow') {
      const choices = f.type === 'workflow' ? f.config.states : f.config.options;
      const names = picked.map((r) => {
        const opt = pickOption(choices, r);
        if (!opt) errors.push(`'${r}' is not ${f.type === 'workflow' ? 'a state' : 'an option'} of '${f.name}'`);
        return opt ? opt.name : r;
      });
      out.value = list ? names : names[0];
      return out;
    }
    if (f.type === 'relation') {
      out.rows = [];
      const names = [];
      for (const r of picked) {
        let hit = null;
        for (const dbId of weave.relationTargetDbIds(f)) {
          try { hit = weave.findEntity(dbId, r); } catch { hit = null; }
          if (hit && !hit.deletedAt) break;
          hit = null;
        }
        if (hit) out.rows.push({ id: hit.id, name: weave.entityName(hit) });
        else errors.push(`No row named '${r}' in the related table`);
        names.push(hit ? weave.entityName(hit) : r);
      }
      out.value = list ? names : names[0];
      return out;
    }
    out.value = picked[0];
    return out;
  });
  return { table: db.id, name: db.name, fields, unknown, cut };
}
const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const plainLine = (md) => String(md ?? '').split('\n').map((l) => l.replace(/[*_`#>]/g, '').trim()).find(Boolean) ?? '';
const previewPageHtml = (head, authHref) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${head}<meta name="weave-route" content="${metaAttr(authHref)}" data-sign-in><link rel="icon" type="image/svg+xml" href="/brand/weave-favicon.svg"><link rel="alternate icon" href="/brand/favicon.ico"><script src="/permalink.js"></script><style>body{font:15px/1.5 -apple-system,sans-serif;max-width:480px;margin:4rem auto;padding:0 16px;color:#1a1d21}a{color:#2563eb}</style></head><body><p><a href="${escapeHtml(authHref)}">Sign in</a> to open this in weave.</p></body></html>`;

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const LIMITS = { options: 10, failed: 5 };
const newChallenge = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const parseCookies = (header) => Object.fromEntries(String(header ?? '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf('='); return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)]; }));

export function createRequestHandler(hub, { version = 'unknown', uptime = () => 0, build = () => null, backup = () => null, serveStatic = null, origin = null, trustProxy = false, limits = LIMITS, oidc = null, mcpOrigins = [], mail = null } = {}) {
  const challenges = new Map();
  const rates = { options: new Map(), failed: new Map() };
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
  const putChallenge = (entry, id = newChallenge()) => {
    const now = Date.now();
    for (const [k, v] of challenges) if (v.expiresAt <= now) challenges.delete(k);
    challenges.set(id, { ...entry, expiresAt: now + CHALLENGE_TTL_MS });
    return id;
  };
  const takeChallenge = (id, kind) => {
    const c = challenges.get(id);
    challenges.delete(id);
    if (!c || c.kind !== kind || c.expiresAt <= Date.now()) return null;
    return c;
  };
  const originFor = (rx) => {
    if (origin) return origin;
    const port = String(rx.header('host') ?? '').split(':')[1];
    return `http://localhost${port ? ':' + port : ''}`;
  };
  const mcpOrigin = (rx) => {
    const known = [origin, ...mcpOrigins].filter(Boolean);
    const host = String(rx.header('host') ?? '').toLowerCase();
    return known.find((o) => new URL(o).host === host) ?? known[0] ?? originFor(rx);
  };
  const opened = new WeakMap();
  const accountOn = (who, engine) => {
    let byEngine = opened.get(who);
    if (!byEngine) opened.set(who, (byEngine = new Map()));
    if (!byEngine.has(engine)) byEngine.set(engine, engine.accountForIdentity(who));
    return byEngine.get(engine);
  };
  const clientIp = (rx) => {
    const fwd = trustProxy ? String(rx.header('x-forwarded-for') ?? '').split(',')[0].trim() : '';
    return fwd || rx.remote || 'unknown';
  };
  const sessionCookie = (token, rx) => `wv_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}${originFor(rx).startsWith('https:') ? '; Secure' : ''}`;
  const clearCookie = (rx) => `wv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${originFor(rx).startsWith('https:') ? '; Secure' : ''}`;

  return async function handle(rx) {
    let path = rx.path;
    const viewerZone = rx.header('x-weave-zone') || null;
    let versionOf = null;
    const out = (status, data, headers = {}) => {
      const isBin = data instanceof Uint8Array;
      const isStr = typeof data === 'string';
      let schemaVersion = null;
      try { schemaVersion = versionOf?.schemaVersion?.() ?? null; } catch {}
      return {
        status,
        headers: {
          'Content-Type': headers['Content-Type'] ?? (isBin || isStr ? 'text/plain; charset=utf-8' : 'application/json'),
          ...(schemaVersion ? { 'X-Weave-Schema-Version': schemaVersion } : {}),
          ...headers,
        },
        body: isBin || isStr ? data : JSON.stringify(data, null, 1),
      };
    };

    const notFound = (json) => {
      const isPage = rx.method === 'GET' && serveStatic && !path.includes('/api/');
      const page = isPage ? serveStatic('/404.html') : null;
      return page ? { ...page, status: 404 } : out(404, json);
    };

    let weave = hub.get(hub.defaultName);
    let wsPrefix = '';
    const wsM = path.match(/^\/w\/([^/]+)(\/.*|$)/);
    if (wsM && wsM[1] !== 'undefined') {
      const target = hub.get(wsM[1]) ?? (wsM[1] === 'weaver' ? hub.get('weave') : null);
      if (!target) return notFound({ error: `Workspace '${wsM[1]}' not found`, code: 'not-found' });
      weave = target;
      wsPrefix = `/w/${wsM[1]}`;
      path = wsM[2] || '/';
    }
    weave.maybeRefresh();
    versionOf = weave;
    const updateWorkspace = (patch) => {
      const slug = patch.name != null ? workspaceSlug(patch.name) : null;
      const held = slug ? hub.get(slug) : null;
      if (held && held !== weave) throw new WeaveError(`Workspace '${slug}' already exists`, 'conflict');
      const was = weave.state.meta.name;
      const ws = weave.updateWorkspace(patch);
      if (ws.name !== was) hub.rename(was, ws.name);
      return ws;
    };

    const member = weave;
    {
      const root = weave.registryHost;
      const eM = root && path.match(/^\/(?:api\/entities|e)\/([^/]+)/);
      const tM = root && !eM && path.match(/^\/api\/tables\/([^/]+)/);
      if (eM && !weave.state.entities[eM[1]] && root.state.entities[eM[1]]) weave = root;
      else if (tM) {
        let ref = tM[1];
        try { ref = decodeURIComponent(ref); } catch {}
        const has = (w) => { try { return w.findTable(ref); } catch { return null; } };
        if (!has(weave) && has(root)?.system) weave = root;
      }
    }

    weave.actor = String(rx.header('x-weave-actor') || 'web').slice(0, 120);

    let mcpChallenge = null;
    const deny = (code, error) => out(code, { error, code: code === 401 ? 'unauthorized' : 'forbidden' },
      code === 401 && mcpChallenge ? { 'WWW-Authenticate': mcpChallenge } : {});

    {
      const shareM = path.match(/^\/view\/([A-Za-z0-9_-]+)$/);
      if (shareM && rx.method === 'GET') {
        const v = weave.viewByShareToken(shareM[1]);
        if (!v) return out(404, 'This share link is not (or no longer) valid.');
        const resolved = weave.resolveView(v.id);
        const block = (b) => `<h2>${escapeHtml(b.table)}</h2><table><thead><tr>${
          Object.keys(b.items[0]?.fields ?? { '—': 1 }).map((k) => `<th>${escapeHtml(k)}</th>`).join('')
        }</tr></thead><tbody>${
          b.items.map((e) => `<tr>${Object.values(e.fields).map((val) => `<td>${escapeHtml(Array.isArray(val) ? val.map((x) => x?.name ?? x).join(', ') : (val && typeof val === 'object' ? val.name ?? '' : val ?? ''))}</td>`).join('')}</tr>`).join('')
        }</tbody></table>`;
        return out(200, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(resolved.name)}</title><style>body{font:15px/1.5 -apple-system,sans-serif;max-width:960px;margin:2rem auto;padding:0 16px;color:#1a1d21}table{border-collapse:collapse;width:100%;font-size:13.5px;margin:0 0 24px}th,td{border:1px solid #d9dde3;padding:5px 9px;text-align:left}th{background:#f4f6f8}h1{font-size:22px}h2{font-size:15px;margin:20px 0 6px}footer{color:#6b7280;font-size:12px;margin-top:32px}</style><h1>${escapeHtml(resolved.name)}</h1>${resolved.blocks.map(block).join('')}<footer>Shared read-only from a weave workspace.</footer>`,
          { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      }
    }

    if (path === '/t' || (path.startsWith('/t/') && !UUID_RE.test(path.slice(3)) && !UUID_RE.test(path.slice(3).replace(/\/new$/, '')))) {
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
        const json = { error: err.message, code: err.code ?? 'error' };
        return err instanceof WeaveError && err.code === 'not-found' ? notFound(json) : out(statusFor(err), json);
      }
    }

    const linkPreview = (p, { signedOut = false } = {}) => {
      const m = p.match(/^\/([est])\/([^/]+)$/);
      if (p !== '/' && !m) return null;
      if (signedOut && m && !UUID_RE.test(m[2])) return null;
      const ws = weave.state.meta;
      const site = ws.title ?? ws.name;
      const base = origin ?? `http://${rx.header('host')}`;
      const home = `/w/${ws.name || hub.defaultName}`;
      let image = `${base}/brand/weave-mark-512.png`;
      if (ws.logo) {
        try {
          const { meta: logo, bytes } = weave.getWorkspaceLogo();
          if (RASTER.has(logoType(bytes))) image = `${base}${home}/api/workspace/logo?v=${logo.id.slice(0, 8)}`;
        } catch {}
      }
      const live = (tables) => tables.reduce((n, d) => n + weave.listEntities(d.id).length, 0);
      let title, trail, detail, url, route = null, fields = [];
      try {
        if (!m) {
          const tables = weave.userTables();
          title = site;
          detail = plainLine(ws.description) || `${count(new Set(tables.map((d) => d.spaceId)).size, 'space')} · ${count(tables.length, 'table')}`;
          url = `${home}/`;
        } else if (m[1] === 'e') {
          const e = weave.getEntity(m[2]);
          if (e.deletedAt) return null;
          const db = weave.state.tables[e.dbId];
          const name = weave.entityName(e).trim();
          title = clip(`${db.name} #${e.publicId}${name ? ` · ${name}` : ''}`, 80);
          trail = [site, weave.state.spaces[db.spaceId]?.name, db.name];
          fields = weave.previewFields(e.id);
          detail = fields.map((f) => `${f.label} ${f.value}`).join(' · ');
          url = `${home}/e/${e.id}`;
          route = `${wsPrefix}/#/entity/${e.id}`;
        } else if (m[1] === 's') {
          const sp = Object.hasOwn(weave.state.spaces, m[2]) ? weave.state.spaces[m[2]] : null;
          if (!sp || sp.deletedAt) return null;
          const tables = weave.listTables(sp.id);
          title = `${sp.name} · space`;
          trail = [site, sp.name];
          detail = `${count(tables.length, 'table')} · ${count(live(tables), 'row')}`;
          url = `${home}/s/${sp.id}`;
          route = `${wsPrefix}/#/space/${sp.id}`;
        } else {
          const db = weave.listTables().find((d) => d.id === m[2]);
          if (!db) return null;
          const space = weave.state.spaces[db.spaceId]?.name;
          title = `${space} / ${db.name} · table`;
          trail = [site, space, db.name];
          detail = count(live([db]), 'row');
          url = `${home}/t/${db.id}`;
          route = `${wsPrefix}/#/table/${db.id}`;
        }
      } catch (err) {
        if (err instanceof WeaveError) return null;
        throw err;
      }
      const description = m ? `${trail.filter(Boolean).join(' › ')}${detail ? `\n${detail}` : ''}` : detail;
      const tag = (attr, key, value) => `<meta ${attr}="${key}" content="${metaAttr(value)}">`;
      const head = [
        `<title>${escapeHtml(title === site ? site : `${title} · ${site}`)}</title>`,
        tag('name', 'description', description),
        tag('property', 'og:title', title),
        tag('property', 'og:description', description),
        tag('property', 'og:site_name', site),
        tag('property', 'og:url', base + url),
        tag('property', 'og:type', m?.[1] === 'e' ? 'article' : 'website'),
        tag('property', 'og:image', image),
        tag('name', 'twitter:card', 'summary'),
        ...fields.flatMap((f, i) => [tag('name', `twitter:label${i + 1}`, f.label), tag('name', `twitter:data${i + 1}`, String(f.value))]),
      ].join('\n');
      return { head, route };
    };

    const carried = weavePrefill.clip(rx.searchParams).query;
    const authHref = `${wsPrefix}/auth?next=${encodeURIComponent(wsPrefix + path + (carried ? `?${carried}` : ''))}`;
    const wallPage = () => out(401, wallPageHtml(authHref, oidc?.name), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    const wall = () => (oidc ? { status: 302, headers: { Location: authHref, 'Cache-Control': 'no-store' }, body: '' } : wallPage());
    const legalPage = ['GET', 'HEAD'].includes(rx.method) && (path === '/privacy' || path === '/terms');
    const previewLogo = path === '/api/workspace/logo' && ['GET', 'HEAD'].includes(rx.method) && !!weave.state.meta.linkPreview;
    const openDoor = path === '/api/health' || path === '/auth' || path.startsWith('/api/auth/') || legalPage || previewLogo
      || (['GET', 'HEAD'].includes(rx.method) && /\.(css|js|mjs|map|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|ico)$/i.test(path));
    let role = null;
    let session = null;
    const cookies = parseCookies(rx.header('cookie'));
    const authz = rx.header('authorization');
    let oauth = null;
    let mcpDoor = false;
    if (path.startsWith('/.well-known/oauth-protected-resource') && !wsPrefix) {
      const rest = path.slice('/.well-known/oauth-protected-resource'.length);
      const wm = rest.match(/^\/w\/([^/]+)\/mcp$/);
      if (!oidc || rx.method !== 'GET' || !(rest === '' || rest === '/mcp' || (wm && hub.get(wm[1])))) {
        return notFound({ error: oidc ? 'No such protected resource' : 'No identity provider is configured (WEAVE_OIDC_ISSUER)', code: 'not-found' });
      }
      return out(200, {
        resource: mcpOrigin(rx) + rest,
        authorization_servers: [oidc.issuer],
        scopes_supported: ['openid'],
        bearer_methods_supported: ['header'],
      });
    }
    if (path === '/mcp') {
      if (oidc) mcpChallenge = `Bearer resource_metadata="${mcpOrigin(rx)}/.well-known/oauth-protected-resource${wsPrefix}/mcp"`;
      const bearer = authz && /^Bearer /i.test(authz) ? authz.slice(7).trim() : '';
      if (oidc && !bearer) return deny(401, `Sign in with ${oidc.name} to use this MCP server`);
      if (oidc && !bearer.startsWith('wv_')) {
        const ip = clientIp(rx);
        if (limited('failed', ip, { peek: true })) return out(429, { error: 'Too many refused tokens: wait a minute and try again', code: 'rate-limited' });
        let who;
        try { who = await oidc.identify(bearer); } catch (err) {
          if (err instanceof WeaveError) { noteFailure(ip); return deny(401, err.message); }
          return out(502, { error: `${oidc.name} is not answering: ${err.message}`, code: 'bad-gateway' });
        }
        const root = hub.get(hub.defaultName);
        let account = null;
        const engine = [weave, root].find((e) => (account = accountOn(who, e)));
        if (!engine) return deny(403, `This ${oidc.name} sign-in opens no account on this workspace. Ask an operator for an invite (weave account link <name>) and open it in a browser once; then sign in here again.`);
        oauth = { account, engine, client: who.client ?? 'oauth' };
      }
      path = '/api/mcp';
      mcpDoor = true;
    }
    if (authz && /^Bearer /i.test(authz)) {
      const account = oauth?.account ?? weave.verifyToken(authz.slice(7).trim());
      if (!account) return path.startsWith('/api/') ? deny(401, 'Invalid token') : wallPage();
      weave.actor = oauth ? `${account.name} via ${oauth.client}`.slice(0, 120) : account.name;
      role = Weave.roleName(account.role);
    } else if (cookies.wv_session) {
      const root = hub.get(hub.defaultName);
      session = weave.verifySession(cookies.wv_session) ?? (root !== weave ? root.verifySession(cookies.wv_session) : null);
      if (session) {
        weave.actor = session.name;
        role = Weave.roleName(session.role);
      } else if (weave.state.meta.requireAuth && !openDoor) {
        return path.startsWith('/api/')
          ? deny(401, 'Session expired or revoked')
          : { status: 302, headers: { Location: authHref, 'Set-Cookie': clearCookie(rx), 'Cache-Control': 'no-store' }, body: '' };
      }
    } else if (weave.state.meta.requireAuth && !openDoor) {
      if (path.startsWith('/api/')) return deny(401, 'This workspace requires authentication');
      const preview = weave.state.meta.linkPreview && ['GET', 'HEAD'].includes(rx.method) ? linkPreview(path, { signedOut: true }) : null;
      if (preview) return out(200, previewPageHtml(preview.head, authHref), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return wall();
    }
    if (role && role !== 'architect') {
      const m2 = rx.method;
      const read = m2 === 'GET' || m2 === 'HEAD' || path.startsWith('/api/auth/')
        || (m2 === 'POST' && (/^\/api\/tables\/[^/]+\/query$/.test(path) || path === '/api/markdown'))
        || (m2 === 'POST' && /^\/api\/spaces\/[^/]+\/use$/.test(path));
      const schemaWrite = !read && (
        /^\/api\/(spaces|automations|accounts|invites|registry)/.test(path)
        || path === '/api/mcp'
        || path === '/api/import'
        || /^\/api\/tables$/.test(path)
        || (/^\/api\/tables\/[^/]+$/.test(path) && (m2 === 'PATCH' || m2 === 'DELETE'))
        || /^\/api\/tables\/[^/]+\/(move|duplicate|restore)$/.test(path)
        || /^\/api\/tables\/[^/]+\/fields/.test(path)
        || /^\/api\/tables\/[^/]+\/relations$/.test(path)
        || /^\/api\/tables\/[^/]+\/views/.test(path)
        || (/^\/api\/schema$/.test(path))
        || path === '/api/build'
        || (/^\/api\/workspace$/.test(path) && m2 === 'PATCH')
        || path === '/api/onboarding');
      const sysM = !read && (path.match(/^\/api\/tables\/([^/]+)\/(?:entities|import\.csv)/) ?? path.match(/^\/api\/entities\/([^/]+)/));
      const sysTouch = sysM && (() => {
        try {
          const ref = sysM[0].startsWith('/api/entities/')
            ? weave.state.tables[weave.getEntity(sysM[1]).dbId]
            : weave.findTable(decodeURIComponent(sysM[1]));
          return !!ref?.system;
        } catch { return false; }
      })();
      const observer = role !== 'editor';
      const cm = observer && !read && path.match(/^\/api\/entities\/([^/]+)\/comments(?:\/([^/]+?))?$/);
      const ownComment = cm && (cm[2] == null ? m2 === 'POST' : m2 === 'DELETE' && (() => {
        try { return weave.getEntity(cm[1]).comments.find((c) => c.id === cm[2])?.author === weave.actor; } catch { return false; }
      })());
      if (observer && !read && !ownComment) return deny(403, 'An observer may read and comment, nothing else');
      if (role === 'editor' && (schemaWrite || sysTouch)) return deny(403, 'This token cannot change the schema');
    }
    const roleOn = (w) => {
      if (w === weave) return role;
      if (oauth) return w === oauth.engine ? Weave.roleName(oauth.account.role) : null;
      if (authz && /^Bearer /i.test(authz)) return Weave.roleName(w.verifyToken(authz.slice(7).trim())?.role) ?? null;
      if (!cookies.wv_session) return null;
      const root = hub.get(hub.defaultName);
      return Weave.roleName((w.verifySession(cookies.wv_session) ?? (w !== root ? root.verifySession(cookies.wv_session) : null))?.role) ?? null;
    };

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
          name: weave.entityName(entity),
          fields: weave.previewFields(entity.id),
        };
      } catch {
        return null;
      }
    };

    if (rx.method === 'OPTIONS') {
      return { status: 204, headers: { Allow: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, body: '' };
    }

    try {
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
      if ((m = path.match(/^\/e\/([^/]+)\/entity\.(md|mmd|html|pdf)$/))) {
        const entity = weave.readEntity(m[1]);
        const lines = [`# ${entity.name || '#' + entity.publicId}`, '', `${entity.db} #${entity.publicId} • updated ${entity.updatedAt.slice(0, 10)}`, '', '## Fields', '', '| Field | Value |', '|---|---|'];
        for (const [k, v] of Object.entries(entity.fields)) {
          if (k in entity.docs) continue;
          const val = v == null ? '' : Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.name : x)).join(', ') : typeof v === 'object' ? (v.name ?? '') : String(v);
          lines.push(`| ${k} | ${String(val).replace(/\|/g, '\\|')} |`);
        }
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

      if ((m = path.match(/^\/t\/([^/]+)\/new$/)) && ['GET', 'HEAD'].includes(rx.method)) {
        const preview = linkPreview(`/t/${m[1]}`);
        if (!preview) throw new WeaveError(`Nothing at ${wsPrefix}${path}`, 'not-found');
        const q = weavePrefill.clip(rx.searchParams).query;
        const to = `${wsPrefix}/#/table/${m[1]}/new${q ? `?${q}` : ''}`;
        if (!serveStatic) return { status: 302, headers: { Location: to, 'Cache-Control': 'no-store' }, body: '' };
        const hit = serveStatic('/', rx, { head: `${preview.head}\n<meta name="weave-route" content="${metaAttr(to)}">\n<script src="/permalink.js"></script>` });
        if (hit) return { ...hit, headers: { ...hit.headers, 'Cache-Control': 'no-store' } };
      }
      if ((m = path.match(/^\/(e|s|t)\/([^/]+)$/)) && !['GET', 'HEAD'].includes(rx.method)) {
        throw new WeaveError(`A permalink answers GET, not ${rx.method}`, 'not-found');
      }
      if (['GET', 'HEAD'].includes(rx.method) && (path === '/' || m)) {
        const preview = linkPreview(path);
        if (!preview && path !== '/') throw new WeaveError(`Nothing at ${wsPrefix}${path}`, 'not-found');
        if (preview?.route && !serveStatic) return { status: 302, headers: { Location: preview.route }, body: '' };
        const jump = preview?.route ? `\n<meta name="weave-route" content="${metaAttr(preview.route)}">\n<script src="/permalink.js"></script>` : '';
        const hit = preview && serveStatic ? serveStatic('/', rx, { head: preview.head + jump }) : null;
        if (hit) return hit;
      }

      if (path === '/auth') {
        if (oidc && !session && !role && !rx.searchParams?.has('signed-out')) {
          const q = rx.searchParams?.toString() ?? '';
          if (!origin && String(rx.header('host') ?? '').split(':')[0] === '127.0.0.1') {
            return { status: 302, headers: { Location: `${originFor(rx)}${wsPrefix}/auth${q ? '?' + q : ''}`, 'Cache-Control': 'no-store' }, body: '' };
          }
          const n = String(rx.searchParams?.get('next') ?? '');
          const next = /^\/(?![/\\])/.test(n) ? `?next=${encodeURIComponent(n)}` : '';
          return { status: 302, headers: { Location: `${wsPrefix}/api/auth/oidc/start${next}`, 'Cache-Control': 'no-store' }, body: '' };
        }
        return out(200, renderAuthPage({ mount: wsPrefix, workspace: weave.state.meta.name, provider: oidc?.name ?? null }), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }

      if (legalPage) {
        const [title, markdown] = path === '/privacy' ? ['Privacy policy', PRIVACY] : ['Terms of Service', TERMS];
        return out(200, renderDocumentPage({ title, subtitle: 'weave', markdown }), { 'Content-Type': 'text/html; charset=utf-8' });
      }

      if (path.startsWith('/api/')) {
        const body = ['POST', 'PUT', 'PATCH'].includes(rx.method) ? await rx.readBody() : {};
        const route = `${rx.method} ${path}`;

        if (path.startsWith('/api/auth/')) {
          const ip = clientIp(rx);
          const tooMany = () => out(429, { error: 'Too many attempts — wait a minute and try again', code: 'rate-limited' });
          const who = () => session ?? (role ? weave.verifyToken(authz.slice(7).trim()) : null);
          const holder = () => (session && weave.verifySession(cookies.wv_session)) ? weave : hub.get(hub.defaultName);
          if (path.startsWith('/api/auth/oidc/')) {
            if (!oidc) return notFound({ error: 'No identity provider is configured (WEAVE_OIDC_ISSUER)', code: 'not-found' });
            let mount = wsPrefix;
            const signInAgain = () => ({ href: `${mount}/auth?signed-out=1`, label: 'Back to sign in' });
            const refusal = (status, title, detail, actions = [signInAgain()]) => out(status, renderRefusalPage({ title, lines: detail, actions }),
              { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            const tooMany = () => refusal(429, 'Too many sign-in attempts', 'Wait a minute, then sign in again.');
            const redirectUri = `${originFor(rx)}/api/auth/oidc/callback`;
            if (route === 'GET /api/auth/oidc/start') {
              if (limited('options', ip)) return tooMany();
              const n = String(rx.searchParams?.get('next') ?? '');
              const next = /^\/(?![/\\])/.test(n) ? n : `${wsPrefix}/`;
              const invite = rx.searchParams?.get('invite') || null;
              if (invite && !weave.identityInvite(invite)) return refusal(410, 'This invite expired or was already used', 'Ask whoever sent it for a new link.');
              let trip;
              try { trip = await oidc.begin({ redirectUri, fresh: rx.searchParams?.has('fresh') }); } catch (err) { return refusal(502, `${oidc.name} is not answering`, err.message); }
              const binder = newChallenge();
              putChallenge({ kind: 'oidc', nonce: trip.nonce, verifier: trip.verifier, binder, next, holder: weave, invite, mount: wsPrefix }, trip.state);
              const secure = originFor(rx).startsWith('https:') ? '; Secure' : '';
              return { status: 302, headers: { Location: trip.url, 'Set-Cookie': `wv_oidc=${binder}; HttpOnly; SameSite=Lax; Path=/api/auth/oidc; Max-Age=${CHALLENGE_TTL_MS / 1000}${secure}`, 'Cache-Control': 'no-store' }, body: '' };
            }
            if (route === 'GET /api/auth/oidc/callback') {
              if (limited('failed', ip, { peek: true })) return tooMany();
              const c = takeChallenge(String(rx.searchParams?.get('state') ?? ''), 'oidc');
              if (!c || !cookies.wv_oidc || cookies.wv_oidc !== c.binder) { noteFailure(ip); return refusal(400, 'This sign-in expired or was already used', 'Start again from the sign-in page, in the browser you want to sign in.'); }
              mount = c.mount ?? '';
              if (rx.searchParams.get('error') || !rx.searchParams.get('code')) return refusal(400, `${oidc.name} did not sign you in`, String(rx.searchParams.get('error_description') ?? rx.searchParams.get('error') ?? 'No authorization code came back.'));
              let who;
              try {
                who = await oidc.redeem({ code: rx.searchParams.get('code'), redirectUri, verifier: c.verifier, nonce: c.nonce });
              } catch (err) {
                noteFailure(ip);
                if (!(err instanceof WeaveError)) return refusal(502, `${oidc.name} is not answering`, 'The identity provider could not be reached. Try again in a minute.');
                return refusal(401, `${oidc.name} sign-in could not be verified`, err.message);
              }
              const root = hub.get(hub.defaultName);
              let account = null;
              const fresh = (invite) => `${mount}/api/auth/oidc/start?fresh=1${invite ? `&invite=${encodeURIComponent(invite)}` : ''}&next=${encodeURIComponent(c.next)}`;
              const differentAccount = async () => ({ label: 'Use a different account', href: await oidc.endSessionUrl({ postLogoutRedirectUri: `${originFor(rx)}${mount}/auth?signed-out=1` }).catch(() => null) ?? fresh() });
              let engine = null;
              if (c.invite) {
                try {
                  account = c.holder.redeemIdentityInvite(c.invite, who);
                  engine = c.holder;
                } catch (err) {
                  noteFailure(ip);
                  if (err.code === 'conflict') return refusal(409, 'This identity already opens another account', `You signed in at ${oidc.name} as someone this server already knows, so the invite was not used. Sign in as the person it was meant for to use it.`, [{ label: 'Use a different account', href: fresh(c.invite) }, signInAgain()]);
                  return refusal(410, 'This invite expired or was already used', 'Ask whoever sent it for a new link.');
                }
              } else engine = [c.holder, root].find((e) => (account = e.accountForIdentity(who)));
              if (!engine) {
                noteFailure(ip);
                const ws = c.holder.state.meta.name;
                return refusal(403, `No access to ${ws}`, [`You signed in at ${oidc.name}, but that account has no access to ${ws}.`, 'A workspace architect can send you an invite link that adds you. Or sign in with a different account.'], [await differentAccount(), signInAgain()]);
              }
              const minted = engine.createSession(account.id, { ua: rx.header('user-agent') });
              return { status: 302, headers: { Location: c.next, 'Set-Cookie': sessionCookie(minted.token, rx), 'Cache-Control': 'no-store' }, body: '' };
            }
            return notFound({ error: 'Unknown auth route', code: 'not-found' });
          }
          if (route === 'POST /api/auth/logout') {
            if (session) {
              try { holder().revokeSession(session.id, { id: session.sessionId }); } catch {}
            }
            return out(200, { ok: true }, { 'Set-Cookie': clearCookie(rx), 'Cache-Control': 'no-store' });
          }
          if (route === 'GET /api/auth/me') {
            const account = who();
            if (!account) return deny(401, 'Not signed in');
            const engine = session ? holder() : weave;
            const sessions = engine.listSessions(account.id).map(({ accountId, ...s }) => ({ ...s, current: s.id === session?.sessionId }));
            const { credentials, ...pub } = engine.listAccounts().find((a) => a.id === account.id) ?? account;
            return out(200, { account: pub, role: account.role, sessions }, { 'Cache-Control': 'no-store' });
          }
          if ((m = path.match(/^\/api\/auth\/sessions\/([^/]+)$/)) && rx.method === 'DELETE') {
            const account = who();
            if (!account) return deny(401, 'Not signed in');
            const engine = session ? holder() : weave;
            if (m[1] === 'others') return out(200, engine.revokeSession(account.id, { all: true, except: session?.sessionId ?? null }));
            return out(200, engine.revokeSession(account.id, { id: m[1] }));
          }
          return notFound({ error: 'Unknown auth route', code: 'not-found' });
        }

        if (route === 'GET /api/health') {
          const nightly = backup();
          return out(200, { ok: true, name: 'weave', version, workspace: weave.state.meta.name, startedAt: STARTED_AT, uptime: Math.round(uptime()), ...(build() ?? {}), ...weave.storageStats(), ...(nightly ? { backup: nightly } : {}) });
        }
        if (route === 'GET /api/schema') return out(200, weave.describeSchema());
        if (route === 'GET /api/vocabulary') {
          try { return out(200, vocabularyView(rx.searchParams?.get('section'), rx.searchParams?.get('query'))); }
          catch (e) { throw new WeaveError(e.message, 'invalid'); }
        }

        const canOpen = (w) => !w.state.meta.requireAuth || roleOn(w) != null;
        const useTemplateInto = ({ space, workspace, name } = {}) => {
          if (workspace == null || String(workspace).trim() === '') throw new WeaveError('Name the workspace to build in: {workspace}, as GET /api/workspaces lists them', 'invalid');
          const target = hub.get(String(workspace));
          if (!target || target.state.meta.deletedAt) throw new WeaveError(`Workspace '${workspace}' not found`, 'not-found');
          const key = hub.list().find((x) => x.id === target.state.meta.id)?.name ?? target.state.meta.name;
          if (!mayAdminister(target, roleOn(target))) throw new WeaveError(`You cannot build in ${key}: using a template there needs an architect on it`, 'forbidden');
          target.maybeRefresh?.();
          const was = target.actor;
          target.actor = weave.actor;
          try {
            const r = weave.useTemplate(space, target, { name: name == null || name === '' ? undefined : String(name) });
            const url = key === hub.defaultName ? `/#/space/${r.space.id}` : `/w/${key}/#/space/${r.space.id}`;
            return { space: r.space, workspace: key, url, plan: r.plan, skipped: r.skipped };
          } finally { target.actor = was; }
        };
        if (/^\/api\/workspaces(\/|$)/.test(path) && rx.method !== 'GET') {
          const hubRoot = hub.get(hub.defaultName);
          const rootRole = roleOn(hubRoot);
          if (!mayAdminister(hubRoot, rootRole)) return deny(rootRole ? 403 : 401, 'Managing workspaces needs an architect on the hub root');
        }
        if (route === 'GET /api/workspaces') {
          const includeDeleted = ['1', 'true'].includes(rx.searchParams.get('deleted') ?? '');
          return out(200, hub.list({ includeDeleted }).filter((x) => canOpen(hub.get(x.name))));
        }
        if (route === 'POST /api/workspaces') {
          const w = hub.create(body.name);
          return out(201, { name: w.state.meta.name, url: `/w/${w.state.meta.name}/` });
        }
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


        if (path === '/api/onboarding') {
          const root = hub.get(hub.defaultName);
          const token = authz && /^Bearer /i.test(authz) ? weave.verifyToken(authz.slice(7).trim()) : null;
          const me = token ? { engine: weave, id: token.id, name: token.name }
            : session ? { engine: weave.verifySession(cookies.wv_session) ? weave : root, id: session.id, name: session.name }
              : { engine: root, id: null, name: null };
          const taken = (n) => { const h = hub.get(n); return !!h && h !== weave; };
          const firstName = WeaveStarters.workspaceName(String(me.name ?? '').trim().split(/\s+/)[0].toLowerCase());
          const fallback = WeaveStarters.workspaceName(weave.state.meta.name) || 'workspace';
          const byDefault = firstName && !taken(firstName) ? firstName : fallback;
          if (rx.method === 'GET') {
            const show = !me.engine.onboardedAt(me.id)
              && (!role || role === 'architect')
              && weave.state.meta.name !== 'weave'
              && !weave.userTables().length
              && hub.list().every((x) => x.name === 'weave' || !x.tables || hub.get(x.name) === weave || !canOpen(hub.get(x.name)));
            return out(200, { show, name: byDefault }, { 'Cache-Control': 'no-store' });
          }
          if (rx.method === 'POST') {
            const name = WeaveStarters.workspaceName(body?.name) || byDefault;
            if (taken(name)) throw new WeaveError(`Workspace '${name}' already exists`, 'conflict');
            const template = body?.template ? WeaveStarters.TEMPLATES.find((t) => t.id === body.template) : null;
            if (body?.template && !template) throw new WeaveError(`Unknown template '${body.template}'`, 'invalid');
            let table = null;
            if (template) {
              const built = weave.build(WeaveStarters.spec(template));
              if (!built.ok) throw new WeaveError(`Couldn't set up ${template.title}: ${built.errors.map((e) => e.error).join('; ')}`, 'invalid');
              table = weave.findTable(`${template.space}/${WeaveStarters.firstTable(template)}`)?.id ?? null;
            }
            const ws = updateWorkspace({ name });
            me.engine.markOnboarded(me.id);
            return out(200, { id: ws.id, name: ws.name, url: `/w/${ws.id}/`, table });
          }
        }

        if (route === 'GET /api/workspace') {
          const ws = weave.getWorkspace();
          return out(200, { ...ws, url: `/w/${ws.id}/`, schemaVersion: weave.schemaVersion() });
        }

        if (path.startsWith('/api/accounts') || path.startsWith('/api/invites') || (route === 'PATCH /api/workspace' && ('requireAuth' in (body ?? {}) || 'linkPreview' in (body ?? {})))) {
          if (!mayAdminister(weave, role)) {
            return deny(role ? 403 : 401, 'Managing accounts needs an architect token');
          }
        }
        if (route === 'GET /api/accounts') return out(200, weave.listAccounts());
        if (route === 'GET /api/invites') return out(200, weave.listInvites());
        if (route === 'POST /api/invites') {
          const made = weave.inviteMember({ email: body?.email, role: body?.role ?? 'editor', issuer: body?.issuer ?? oidc?.issuer });
          const url = inviteUrl(`${originFor(rx)}${wsPrefix}`, made.code);
          let sent = { mailed: false };
          if (mail) {
            try {
              const m = inviteEmail({ inviter: made.invitedBy, workspace: made.workspace, role: made.role, expires: longDate(made.expiresAt), link: url, origin: originFor(rx) });
              await mail({ to: made.email, subject: m.subject, html: m.html, text: m.text });
              sent = { mailed: true };
            } catch (err) {
              console.error(`weave: the invite email was not sent: ${err.message}`);
              sent = { mailed: false, mailError: err.message };
            }
          }
          return out(201, { ...made, url, ...sent });
        }
        if ((m = path.match(/^\/api\/invites\/([^/]+)$/)) && rx.method === 'DELETE') return out(200, weave.revokeInvite(decodeURIComponent(m[1])));
        if ((m = path.match(/^\/api\/mail\/preview\/([^/]+)$/)) && rx.method === 'GET') {
          if (!mayAdminister(weave, role)) return deny(role ? 403 : 401, 'Previewing email needs an architect token');
          const make = { invite: inviteEmail, accepted: inviteAcceptedEmail }[m[1]];
          if (!make) return notFound({ error: `No email named '${m[1]}' (invite, accepted)`, code: 'not-found' });
          const asked = rx.searchParams?.get('role') || 'editor';
          if (!MAIL_ROLES[asked]) throw new WeaveError(`Invalid role '${asked}' (${Object.keys(MAIL_ROLES).join(', ')})`, 'invalid');
          const o = originFor(rx);
          const email = make({ inviter: 'kyle', workspace: 'weave', member: 'dana', expires: 'October 10', joined: 'October 3', role: asked,
            link: `${o}/api/auth/oidc/start?invite=Zq7tK4mW2xR9pLc8`, members: `${o}/w/weave/#members`, origin: o,
            theme: ['light', 'dark'].includes(rx.searchParams?.get('theme')) ? rx.searchParams.get('theme') : undefined });
          return out(200, email.html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        }
        if (route === 'POST /api/accounts') return out(201, weave.createAccount(body ?? {}));
        if ((m = path.match(/^\/api\/accounts\/([^/]+)\/identities$/))) {
          const ref = decodeURIComponent(m[1]);
          if (rx.method === 'POST') {
            const made = weave.linkIdentity(ref, { issuer: body?.issuer ?? oidc?.issuer, email: body?.email });
            return out(201, { ...made, url: inviteUrl(`${originFor(rx)}${wsPrefix}`, made.code) });
          }
          if (rx.method === 'DELETE') return out(200, weave.unlinkIdentity(ref, { issuer: rx.searchParams?.get('issuer') ?? null, subject: rx.searchParams?.get('subject') }));
        }
        if ((m = path.match(/^\/api\/accounts\/(.+)$/)) && rx.method === 'DELETE') {
          return out(200, weave.deleteAccount(decodeURIComponent(m[1])));
        }
        if (path.startsWith('/api/keys')) {
          const root = hub.get(hub.defaultName);
          const rootRole = roleOn(root);
          const km = /^\/api\/keys\/([^/]+)(\/reveal)?$/.exec(path);
          const reveal = !!km?.[2] && rx.method === 'POST';
          const target = route === 'POST /api/keys' ? body?.name
            : km && !km[2] && rx.method === 'DELETE' ? decodeURIComponent(km[1]) : null;
          const owns = !!rootRole && target != null && weave.listKeys().find((k) => k.name === target)?.owner === weave.actor;
          if (!mayAdminister(root, rootRole) && !(reveal && rootRole) && !owns) {
            return deny(rootRole ? 403 : 401, 'Managing keys needs an architect on the hub root');
          }
          if (route === 'GET /api/keys') return out(200, weave.listKeys());
          if (route === 'POST /api/keys') return out(201, weave.setKey(body?.name, body?.value));
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
        if (route === 'POST /api/build') {
          const { spec, dryRun, skipExistingRows, ...bare } = body ?? {};
          const r = weave.build(spec ?? bare, { dryRun: !!dryRun, skipExistingRows: !!skipExistingRows });
          return out(r.ok ? 200 : 400, r);
        }
        if (route === 'GET /api/relation-map.mmd') {
          return out(200, weave.relationMapMmd());
        }
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
        if (mcpDoor && rx.method !== 'POST') return out(405, { error: 'The MCP door takes POST: JSON-RPC in, JSON out, no stream', code: 'method-not-allowed' }, { Allow: 'POST' });
        if (route === 'POST /api/mcp') {
          const msgs = Array.isArray(body) ? body : [body];
          const root = hub.get(hub.defaultName);
          const caller = { role, root, rootRole: roleOn(root), updateWorkspace, useTemplate: useTemplateInto };
          const replies = msgs.map((msg) => handleMcpMessage(weave, msg, { version, caller })).filter(Boolean);
          if (!replies.length) return { status: 202, headers: { 'Content-Type': 'application/json' }, body: '' };
          return out(200, Array.isArray(body) ? replies : replies[0]);
        }
        if (route === 'GET /api/undo') {
          return out(200, weave.listUndo({ limit: Number(rx.searchParams.get('limit') ?? 20) }));
        }
        if (route === 'POST /api/bulk') {
          const { ids, op, ...params } = body ?? {};
          if (role === 'editor') {
            const sys = (fn) => { try { return !!fn()?.system; } catch { return false; } };
            const list = ids == null ? [] : [].concat(ids);
            const into = op === 'rollup' && params.table == null
              ? (() => { try { return weave.relationTargetDbIds(weave.getField(weave.getEntity(list[0]).dbId, params.field)); } catch { return []; } })()
              : [];
            if (list.some((id) => sys(() => weave.state.tables[weave.getEntity(id).dbId]))
              || (params.table != null && sys(() => weave.getTable(params.table)))
              || into.some((t) => weave.state.tables[t]?.system)) {
              return deny(403, 'This token cannot change the schema');
            }
          }
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
          const ws = updateWorkspace({ name: body.name ?? null, description: body.description ?? null, linkPreview: body.linkPreview ?? null });
          return out(200, { id: ws.id, url: `/w/${ws.id}/`, name: ws.name, title: ws.title, description: ws.description, linkPreview: ws.linkPreview });
        }
        if (route === 'POST /api/markdown') {
          return out(200, { html: renderMarkdown(String(body.md ?? ''), { resolveMention }) });
        }

        if (route === 'POST /api/bug-report') {
          const events = body?.events ?? [];
          if (!Array.isArray(events) || events.length > MAX_BUG_EVENTS) {
            return out(400, { error: `events must be an array of at most ${MAX_BUG_EVENTS} entries`, code: 'invalid' });
          }
          const docs = hub.get('weave') ?? hub.get('weaver');
          const issues = docs && (() => { try { return docs.getTable('Development/Issue'); } catch { return null; } })();
          if (!issues) {
            return out(501, { error: 'No Development/Issue table to file into — this instance has no weave docs workspace', code: 'unsupported' });
          }
          if (role == null && !canOpen(docs)) return deny(401, 'The weave docs workspace requires authentication');
          docs.maybeRefresh();
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
            const values = { Severity: report.severity };
            const field = docs.findField(issues, SYMPTOM_FIELD);
            const declared = new Set((field?.config?.options ?? []).map((o) => o?.name ?? o));
            const settable = report.symptoms.filter((s) => declared.has(s));
            if (settable.length) values[SYMPTOM_FIELD] = settable;
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
            const { bytes } = weave.getWorkspaceLogo();
            const type = logoType(bytes);
            return out(200, bytes, {
              'Content-Type': type ?? 'application/octet-stream',
              ...(type ? {} : { 'Content-Disposition': 'attachment; filename="logo"' }),
              'Cache-Control': 'no-cache',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "sandbox; default-src 'none'",
            });
          }
          if (rx.method === 'PUT' || rx.method === 'POST') {
            return out(200, weave.setWorkspaceLogo({ name: body.name, mime: body.mime, bytes: body.contentBase64 }));
          }
          if (rx.method === 'DELETE') { weave.deleteWorkspaceLogo(); return out(200, { ok: true }); }
        }

        if (route === 'GET /api/spaces') return out(200, weave.listSpaces());
        if (route === 'GET /api/templates') return out(200, weave.listTemplates());
        if ((m = path.match(/^\/api\/spaces\/([^/]+)\/use$/)) && rx.method === 'POST') {
          return out(201, useTemplateInto({ space: decodeURIComponent(m[1]), workspace: body?.workspace, name: body?.name }));
        }
        if (route === 'POST /api/spaces') return out(201, guided(weave, 'space', weave.createSpace(body)));
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
        if (route === 'POST /api/tables') return out(201, guided(weave, 'table', weave.createTable(body)));
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
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/views$/)) && rx.method === 'GET') {
          return out(200, weave.tableView(decodeURIComponent(m[1])));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/views\/([^/]+)$/))) {
          const ref = `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`;
          if (rx.method === 'GET') return out(200, weave.tableView(ref));
          if (rx.method === 'PATCH') return out(200, weave.tableView(ref, body ?? {}));
          if (rx.method === 'DELETE') return out(200, weave.tableView(ref, { delete: true }));
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
          return out(201, guided(weave, 'field', weave.addField(m[1], body), body?.config));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/fields\/([^/]+)$/))) {
          if (rx.method === 'PATCH') {
            const seq = weave.state.meta.activitySeq ?? 0;
            const field = weave.updateField(m[1], m[2], body);
            const [last] = weave.activityFeed({ entityId: weave.getTable(m[1]).id, kinds: ['field-config-updated'], limit: 1 }).items;
            const entry = last && last.seq > seq && last.detail.fieldId === field.id ? last : null;
            return out(200, { ...guided(weave, 'field', field, body?.type == null ? body?.config : {}), activity: entry?.id ?? null, lossy: !!entry?.detail.lossy });
          }
          if (rx.method === 'DELETE') { weave.deleteField(m[1], m[2]); return out(200, { ok: true }); }
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/fields\/([^/]+)\/rollback$/)) && rx.method === 'POST') {
          return out(200, weave.rollbackFieldConfig(body?.activity, { table: m[1], field: m[2], via: body?.via }));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/relations$/)) && rx.method === 'POST') {
          return out(201, weave.addRelation(m[1], body));
        }

        if ((m = path.match(/^\/api\/tables\/([^/]+)\/entities$/))) {
          if (rx.method === 'POST') {
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
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/prefill$/)) && rx.method === 'GET') {
          return out(200, prefillDraft(weave, m[1], rx.searchParams));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/query$/)) && rx.method === 'POST') {
          return out(200, weave.query(m[1], { ...body, viewerZone }));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/formula-check$/)) && rx.method === 'POST') {
          return out(200, weave.checkFormula(m[1], body?.expression, { entity: body?.entity ?? null, excludeField: body?.excludeField ?? null, scan: Boolean(body?.scan) }));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/stats$/)) && rx.method === 'GET') {
          const by = rx.searchParams.get('by') || null;
          const field = rx.searchParams.get('field') || null;
          const raw = rx.searchParams.get('where');
          let where = null;
          if (raw) { try { where = JSON.parse(raw); } catch { return out(400, { error: 'where must be JSON' }); } }
          return out(200, weave.tableStats(m[1], { by, where, field }));
        }
        if (path === '/api/trash' && rx.method === 'GET') {
          const items = weave.listTrash();
          return out(200, { total: items.length, items });
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
            const { touched } = weave.touching(() => weave.updateEntity(m[1], body.values ?? body));
            return out(200, { ...weave.readEntity(m[1], { viewerZone }), affected: weave.affectedBy(m[1], touched) });
          }
          if (rx.method === 'DELETE') {
            const hard = ['1', 'true'].includes(rx.searchParams.get('hard') ?? '');
            return out(200, { ok: true, ...weave.deleteEntity(m[1], { hard }) });
          }
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/restore$/)) && rx.method === 'POST') {
          return out(200, weave.restoreEntity(m[1]));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/references$/)) && rx.method === 'GET') {
          return out(200, weave.referencesTo(m[1]));
        }
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

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/doc$/))) {
          const fieldRef = rx.searchParams.get('field') ?? body.field ?? null;
          if (rx.method === 'GET') return out(200, { field: fieldRef, doc: weave.getDoc(m[1], fieldRef) });
          if (rx.method === 'PUT' || rx.method === 'POST') {
            const text = body.doc ?? body.markdown;
            if (text == null) throw new WeaveError('A document write carries its text under `doc` or `markdown`; this body has neither. Send `{"doc": ""}` to clear the document.', 'invalid');
            if (rx.method === 'PUT') weave.setDoc(m[1], text, fieldRef);
            else weave.appendDoc(m[1], text, fieldRef);
            return out(200, { ok: true });
          }
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
          return out(200, bytes, fileHeaders(meta, bytes, { view: rx.searchParams?.has('view') ?? false }));
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/comments$/)) && rx.method === 'POST') {
          return out(201, weave.addComment(m[1], role && !['architect', 'editor'].includes(role) ? { ...body, author: weave.actor } : body));
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
            const results = [];
            for (const [name, w] of hub.entries()) {
              if (!canOpen(w)) continue;
              const prefix = name === hub.defaultName ? '' : `/w/${name}`;
              for (const hit of w.universalSearch(q, { limit, prefix })) {
                results.push({ workspace: name, ...hit });
              }
            }
            return out(200, Weave.capRows(results, limit));
          }
          return out(200, weave.universalSearch(q, { limit, prefix: wsPrefix }));
        }
        if (route === 'GET /api/export') return out(200, weave.exportJSON());
        if (route === 'POST /api/import') {
          if (!mayAdminister(weave, role)) return deny(role ? 403 : 401, 'Replacing the workspace needs an architect token');
          return out(200, { ok: true, ...weave.importJSON(body) });
        }

        return out(404, { error: `No route: ${route}` });
      }

      if (serveStatic) {
        const hit = serveStatic(path, rx);
        if (hit) return hit;
      }
      return notFound('Not found');
    } catch (err) {
      const status = statusFor(err);
      if (status === 500 && typeof console !== 'undefined') console.error(err);
      const json = { error: err.message, code: err.code ?? 'internal' };
      return status === 404 ? notFound(json) : out(status, json);
    }
  };
}
