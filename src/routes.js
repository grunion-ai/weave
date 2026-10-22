import { Weave, WeaveError, fileHeaders, sandboxedHtmlHeaders, logoType, inviteUrl, accountActor } from './engine.js';
import { handleApplet, appletOn } from './applet.js';
import { shareDoor, shareGate, sharePage, scopedMention } from './shares.js';
import { vocabularyView } from './vocabulary.js';
import { guided } from './field-hints.js';
import { renderDocumentPage, renderMarkdown, isHtmlDocument, escapeHtml } from './markdown.js';
import { markdownToPdf } from './pdf.js';
const deckModule = () => import('./deck.js');
import { handleMcpMessage, mayAdminister, toolTable } from './mcp.js';
import { workspaceSlug, slugOfHost, slugTaken } from './workspace-name.js';
import { createForm, updateForm, getFormDefinition, getForm, listForms, submitForm, ensureBugForm, formAdmits, renderFormPage, leaveWorkspace, isDocsWorkspace, refuseOnDocs } from './forms.js';
import { renderAuthPage, renderRefusalPage, sameOriginPath } from './auth-page.js';
import { PRIVACY, TERMS, SUPPORT, AGENT_DOCS } from './legal.js';
import { bugForwardTarget, forwardBugReport } from './bugreport.js';
import { inviteEmail, inviteAcceptedEmail, ROLES as MAIL_ROLES, longDate } from './mail.js';
import { BillingUnavailable, PAID_ROLES } from './billing.js';
import '../public/starter-core.js';
import '../public/prefill-core.js';
const { WeaveStarters, WeaveSlugs, weavePrefill } = globalThis;

export const decodePath = (pathname) => {
  try { return decodeURIComponent(pathname.replace(/%2f/gi, '%252F')); }
  catch { throw new WeaveError('Malformed percent-escape in the path', 'invalid'); }
};

export const ownsEntity = (ws, id) => Object.hasOwn(ws.state.entities, id);

export function statusFor(err) {
  if (!(err instanceof WeaveError)) return 500;
  return { 'not-found': 404, conflict: 409, slug_taken: 409, slug_reserved: 400, slug_invalid: 400, invalid: 400, ambiguous: 400, forbidden: 403, 'unsupported-type': 415, 'too-large': 413, 'rate-limited': 429 }[err.code] ?? 400;
}

const STARTED_AT = new Date().toISOString();

export const clientAddress = ({ forwarded, remote, trustProxy }) => {
  const hop = trustProxy ? String(forwarded ?? '').split(',').pop().trim() : '';
  return hop || remote || 'unknown';
};

export function errorBody(err, code = 'internal') {
  if (err instanceof WeaveError) return { error: err.message, code: err.code ?? code };
  const id = crypto.randomUUID().slice(0, 8);
  if (typeof console !== 'undefined') console.error(`weave: request ${id} failed:`, err);
  return { error: `Internal error (request ${id})`, code: 'internal', id };
}

export const MAX_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 500;
const rowCap = () => Math.max(1, Number(process.env.WEAVE_MAX_ROWS) || MAX_ROWS);
const actorOf = (account) => (account?.id ? accountActor(account.id) : account?.name);
const boundedLimit = (value, fallback = null) => (value == null ? fallback : Math.min(Number(value), rowCap()));

const wallPageHtml = (authHref, provider = null) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in required</title><style>body{font:15px/1.5 -apple-system,sans-serif;max-width:480px;margin:4rem auto;padding:0 16px;color:#1a1d21}a{color:#2563eb}</style><h1>This workspace requires authentication</h1><p><a href="${authHref}">Sign in${provider ? ` with ${escapeHtml(provider)}` : ''}</a>, send a Bearer token, or open a share link you were given.</p>`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const previewInput = (p) => (p && typeof p === 'object' && (p.contentBase64 ?? p.bytes) != null ? { bytes: p.contentBase64 ?? p.bytes } : null);
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const metaAttr = (s) => escapeHtml(s).replace(/\r?\n/g, '&#10;');
const PREFILL_SKIP = new Set(['lookup', 'rollup', 'formula', 'view', 'attachments', 'avatar', 'field']);
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
const HANDOFF_TTL_MS = 60 * 1000;
const digest = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');
const LIMITS = { options: 10, failed: 5, slugs: 60 };
const START_TTL_MS = 30 * 60 * 1000;
const holdsLink = (w, kind, id) => {
  w.maybeRefresh();
  if (kind === 't') return !!w.findTable(id);
  if (kind === 's') return !!(w.findSpace(id) || w.shareByToken(id));
  return Object.hasOwn(w.state.entities ?? {}, id);
};
const linkHolder = (hub, kind, id) => hub.entries().map(([, w]) => w).find((w) => !w.state.meta.deletedAt && holdsLink(w, kind, id)) ?? null;
const INGEST_MAX_BYTES = 2 * 1024 * 1024;
const INGEST_HEADERS = ['content-type', 'content-encoding', 'user-agent'];
const newChallenge = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const joinedInvite = (next) => {
  const i = next.indexOf('#');
  const [path, hash] = i < 0 ? [next, ''] : [next.slice(0, i), next.slice(i)];
  return `${path}${path.includes('?') ? '&' : '?'}joined=invite${hash}`;
};
const parseCookies = (header) => Object.fromEntries(String(header ?? '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf('='); return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)]; }));

export function createRequestHandler(hub, { version = 'unknown', uptime = () => 0, build = () => null, backup = () => null, cloudBackups = null, serveStatic = null, origin = null, trustProxy = false, limits = LIMITS, oidc = null, mcpOrigins = [], mail = null, baseDomain = null, openSignup = { on: false, limit: 1 }, clerkKey = null, billing = null, posthog = null, anonymousForms = ['1', 'true'].includes(String(process.env.WEAVE_ANONYMOUS_FORMS ?? '').toLowerCase()) } = {}) {
  const clerkPane = (() => {
    if (!clerkKey || !oidc) return null;
    let host;
    try { host = atob(clerkKey.split('_')[2]).replace(/\$$/, ''); } catch { return null; }
    const issuer = new URL(oidc.issuer);
    return issuer.host === host ? { publishableKey: clerkKey, script: `${issuer.origin}/npm/@clerk/clerk-js@6/dist/clerk.browser.js` } : null;
  })();
  const challenges = new Map();
  const handoffs = new Map();
  const remirror = async (w) => {
    const orgId = billing ? w.billing().billing.orgId : null;
    if (!orgId) return null;
    try { return await billing.syncMembers({ orgId, accounts: w.listAccounts() }); } catch (err) {
      console.error(`weave: the Clerk organization ${orgId} was not re-mirrored: ${err.message}`);
      return null;
    }
  };
  const scheme = origin ? new URL(origin).protocol : 'http:';
  const apexOrigin = origin ?? `${scheme}//${baseDomain}`;
  const rates = { options: new Map(), failed: new Map(), slugs: new Map() };
  const starts = new Map();
  const formRates = new Map();
  const formLimited = (keys) => {
    const now = Date.now();
    for (const [key, value] of formRates) if (value.until <= now) formRates.delete(key);
    let retry = 0;
    for (const [key, max] of keys) {
      let hit = formRates.get(key);
      if (!hit) {
        if (formRates.size >= 10000) return 60;
        hit = { until: now + 60000, n: 0 };
        formRates.set(key, hit);
      }
      hit.n += 1;
      if (hit.n > max) retry = Math.max(retry, Math.ceil((hit.until - now) / 1000));
    }
    return retry;
  };
  const prune = (map) => { const now = Date.now(); for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k); };
  const handOff = async (engine, accountId, next, host) => {
    const code = newChallenge();
    prune(handoffs);
    handoffs.set(await digest(code), { engine, accountId, next, host, expiresAt: Date.now() + HANDOFF_TTL_MS });
    return { status: 302, headers: { Location: `${scheme}//${host}.${baseDomain}/api/auth/handoff?code=${code}`, 'Cache-Control': 'no-store' }, body: '' };
  };
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
  const clientIp = (rx) => clientAddress({ forwarded: rx.header('x-forwarded-for'), remote: rx.remote, trustProxy });
  const LEGACY_COOKIE = 'wv_session';
  const cookieName = (w) => `${LEGACY_COOKIE}_${w.state.meta.id}`;
  const outName = (w) => `wv_out_${w.state.meta.id}`;
  const secureFlag = (rx) => (originFor(rx).startsWith('https:') ? '; Secure' : '');
  const sessionCookie = (name, token, rx) => `${name}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Weave.SESSION_TTL_MS / 1000}${secureFlag(rx)}`;
  const clearCookie = (name, rx) => `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag(rx)}`;
  const withCookies = (res, jar) => {
    if (!res || !jar.length) return res;
    const own = [res.headers?.['Set-Cookie'] ?? []].flat();
    const named = new Set(own.map((c) => c.split('=')[0]));
    const add = new Map(jar.filter((c) => !named.has(c.split('=')[0])).map((c) => [c.split('=')[0], c]));
    const all = [...own, ...add.values()];
    return { ...res, headers: { ...res.headers, 'Set-Cookie': all.length === 1 ? all[0] : all } };
  };

  const respond = async (rx, jar) => {
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

    if (path === '/ingest' || path.startsWith('/ingest/')) {
      if (!posthog || !rx.readBytes) return out(404, { error: 'Not found', code: 'not-found' });
      const rest = path.slice('/ingest'.length) || '/';
      const query = rx.searchParams?.toString();
      const target = `${/^\/(?:static|array)\//.test(rest) ? posthog.assets : posthog.host}${rest}${query ? `?${query}` : ''}`;
      const headers = Object.fromEntries(INGEST_HEADERS.map((h) => [h, rx.header(h)]).filter(([, v]) => v));
      headers['x-forwarded-for'] = clientIp(rx);
      let res;
      try {
        const body = ['GET', 'HEAD'].includes(rx.method) ? undefined : await rx.readBytes(INGEST_MAX_BYTES);
        res = await fetch(target, { method: rx.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      } catch (err) {
        if (err instanceof WeaveError) return out(statusFor(err), errorBody(err));
        return out(502, { error: 'PostHog is not answering', code: 'bad-gateway' });
      }
      const kept = Object.fromEntries(['content-type', 'cache-control'].map((h) => [h, res.headers.get(h)]).filter(([, v]) => v).map(([h, v]) => [h === 'content-type' ? 'Content-Type' : 'Cache-Control', v]));
      return { status: res.status, headers: { 'Content-Type': 'application/octet-stream', ...kept }, body: new Uint8Array(await res.arrayBuffer()) };
    }

    let weave = hub.get(hub.defaultName);
    let wsPrefix = '';
    const hostSlug = slugOfHost(rx.header('host'), baseDomain);
    let hostOrigin = null;
    if (hostSlug !== null) {
      const holder = hub.bySlug(hostSlug);
      if (!holder) {
        const moved = hub.aliasOf(hostSlug);
        const q = rx.searchParams?.toString();
        if (moved) return { status: 301, headers: { Location: `${scheme}//${String(moved.state.meta.name).toLowerCase()}.${baseDomain}${encodeURI(rx.path)}${q ? `?${q}` : ''}`, 'Cache-Control': 'no-store' }, body: '' };
        return notFound({ error: 'Not found', code: 'not-found' });
      }
      weave = holder;
      hostOrigin = `${scheme}//${String(rx.header('host')).toLowerCase()}`;
    }
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
    if (baseDomain && oidc && !hostOrigin && !wsPrefix && ['GET', 'HEAD'].includes(rx.method)) {
      if (/^\/[est]\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(path)) {
        const holder = linkHolder(hub, path.slice(1, 2), path.slice(3)) ?? hub.get(hub.defaultName);
        return { status: 301, headers: { Location: `${scheme}//${String(holder.state.meta.name).toLowerCase()}.${baseDomain}${path}`, 'Cache-Control': 'no-store' }, body: '' };
      }
    }
    const updateWorkspace = (patch) => {
      const slug = patch.name != null ? workspaceSlug(patch.name) : null;
      const state = slug != null && patch.name !== weave.state.meta.name ? hub.slugState(slug, weave) : 'available';
      if (state !== 'available') throw new WeaveError(WeaveSlugs.apiMessage(state, slug), `slug_${state}`);
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
      const theirs = (id) => { const ws = root.workflowWorkspace(id); return ws !== undefined && ws !== weave.state.meta.id; };
      if (eM && !ownsEntity(weave, eM[1]) && ownsEntity(root, eM[1]) && !theirs(eM[1])) weave = root;
      else if (tM) {
        let ref = tM[1];
        try { ref = decodeURIComponent(ref); } catch {}
        const has = (w) => { try { return w.findTable(ref); } catch { return null; } };
        if (!has(weave) && has(root)?.system) weave = root;
      }
    }

    let actor = String(rx.header('x-weave-actor') || 'web').slice(0, 120);
    weave.actor = actor;
    if (oidc?.issuer) (weave.registryHost ?? weave).inviteIssuer = oidc.issuer;
    path = path.replace(/^(\/api\/tables\/)([^/]+)/, (whole, head, key) => {
      if (!/%2f/i.test(key)) return whole;
      try { return head + (weave.findTable(key.replace(/%2f/gi, '/'))?.id ?? key); } catch { return whole; }
    });

    let mcpChallenge = null;
    const deny = (code, error) => out(code, { error, code: code === 401 ? 'unauthorized' : 'forbidden' },
      code === 401 && mcpChallenge ? { 'WWW-Authenticate': mcpChallenge } : {});

    {
      const shareM = path.match(/^\/view\/([A-Za-z0-9_-]+)$/);
      if (shareM && rx.method === 'GET') {
        if (!weave.shareByToken(shareM[1])) return out(404, 'This share link is not (or no longer) valid.');
        return { status: 302, headers: { Location: `${wsPrefix}/s/${shareM[1]}`, 'Cache-Control': 'no-store' }, body: '' };
      }
    }

    if (path === '/t' || (path.startsWith('/t/') && !UUID_RE.test(path.slice(3)) && !UUID_RE.test(path.slice(3).replace(/\/new$/, '')))) {
      const wantsBody = ['POST', 'PUT', 'PATCH'].includes(rx.method) && appletOn();
      if (wantsBody && Number(rx.header('content-length') ?? 0) > MAX_BODY_BYTES) return out(413, { error: 'Body too large', code: 'too-large' });
      const appletBody = wantsBody ? await rx.readBody().catch(() => ({})) : {};
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
        const json = errorBody(err, 'error');
        return err instanceof WeaveError && err.code === 'not-found' ? notFound(json) : out(statusFor(err), json);
      }
    }

    const shellMarker = () => `\n<meta name="weave-workspace" content="${metaAttr(weave.state.meta.name ?? '')}" data-root="${weave === hub.get(hub.defaultName)}">`;
    const linkPreview = (p, { signedOut = false } = {}) => {
      const m = p.match(/^\/([est])\/([^/]+)$/);
      if (p !== '/' && !m) return null;
      if (signedOut && m && !UUID_RE.test(m[2])) return null;
      const ws = weave.state.meta;
      const site = ws.title ?? ws.name;
      const canonical = baseDomain && ws.name ? `${scheme}//${String(ws.name).toLowerCase()}.${baseDomain}` : null;
      const base = canonical ?? origin ?? `http://${rx.header('host')}`;
      const home = canonical ? '' : `/w/${ws.name || hub.defaultName}`;
      let image = `${base}/brand/weave-mark-512.png`;
      if (ws.logo) {
        try {
          const { meta: logo, bytes } = weave.getWorkspaceLogo();
          if (RASTER.has(logoType(bytes))) image = `${base}${home}/api/workspace/logo?v=${logo.id.slice(0, 8)}`;
        } catch {}
      }
      const live = (tables) => tables.reduce((n, d) => n + weave.listEntities(d.id).length, 0);
      let title, heading, trail, detail, url, route = null, fields = [];
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
          const ref = `${db.name} #${e.publicId}`;
          title = clip(`${ref}${name ? ` · ${name}` : ''}`, 80);
          heading = clip(name || ref, 80);
          trail = [site, weave.state.spaces[db.spaceId]?.name, ref];
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
        tag('property', 'og:title', heading ?? title),
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
    const statusPage = ['GET', 'HEAD'].includes(rx.method) && (path === '/status' || path === '/status/');
    const legalPage = ['GET', 'HEAD'].includes(rx.method) && (path === '/privacy' || path === '/terms' || path === '/support' || path === '/docs');
    const previewLogo = path === '/api/workspace/logo' && ['GET', 'HEAD'].includes(rx.method) && !!weave.state.meta.linkPreview;
    const startDoor = path === '/start' || path === '/api/start' || path.startsWith('/api/start/');
    const formDoor = (['GET', 'HEAD'].includes(rx.method) && /^\/(?:f|api\/forms)\/[^/]+$/.test(path)) || (rx.method === 'POST' && /^\/api\/forms\/[^/]+\/submit$/.test(path));
    const openDoor = path === '/api/health' || path === '/auth' || path.startsWith('/api/auth/') || legalPage || statusPage || previewLogo || startDoor || formDoor
      || (['GET', 'HEAD'].includes(rx.method) && (/\.(css|js|mjs|map|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|ico)$/i.test(path) || /^\/brand\/[\w-]+\.html$/.test(path)));
    let role = null;
    let session = null;
    let accountName = null;
    const cookies = parseCookies(rx.header('cookie'));
    if (cookies[LEGACY_COOKIE]) jar.push(clearCookie(LEGACY_COOKIE, rx));
    const startRoot = baseDomain ? apexOrigin : '';
    const sameLogin = (a, b) => a.issuer === b.issuer && a.subject === b.subject;
    const findWorkspaces = (logins) => {
      const hubRoot = hub.get(hub.defaultName);
      const live = hub.entries().filter(([, w]) => !w.state.meta.deletedAt);
      const rootOf = (me) => hubRoot.accountForIdentity(me);
      const accountFor = (w, me) => w.accountForIdentity(me) ?? (rootOf(me) ? { ...rootOf(me), viaRoot: true } : null);
      const opener = (w) => logins.find((me) => accountFor(w, me)) ?? null;
      const label = (me) => me.email ?? live.map(([, w]) => w.accountForIdentity(me)?.name).find(Boolean) ?? me.subject;
      const title = (name, w) => w.state.meta.title ?? name;
      const seenOn = (w, account) => (account.viaRoot ? null : w.listSessions(account.id)[0]?.lastSeenAt ?? null);
      const logoOf = (name, w) => (w.state.meta.logo ? `/api/start/logo/${encodeURIComponent(name)}?v=${w.state.meta.logo.id.slice(0, 8)}` : null);
      const rows = [
        ...live.filter(([, w]) => opener(w))
          .map(([name, w]) => {
            const me = opener(w);
            const account = accountFor(w, me);
            return { kind: 'workspace', name, id: w.state.meta.id, title: title(name, w), login: label(me), host: baseDomain ? `${name.toLowerCase()}.${baseDomain}` : null, role: Weave.roleName(account.role), logo: logoOf(name, w), seenAt: seenOn(w, account), open: `/api/start/open/${encodeURIComponent(name)}` };
          })
          .sort((a, b) => (b.seenAt ?? '').localeCompare(a.seenAt ?? '')),
        ...live.flatMap(([name, w]) => logins.filter((me) => me.email && !w.accountForIdentity(me))
          .flatMap((me) => w.invitesForEmail(me.email).map((i) => ({ kind: 'invite', name, title: title(name, w), role: i.role, invitedBy: i.invitedBy ?? null, login: label(me), accept: `/api/start/invites/${encodeURIComponent(name)}/${i.id}` })))),
      ];
      const available = rows.filter((r) => r.kind === 'workspace' && !isDocsWorkspace(hub.get(r.name))).map((r) => r.name.toLowerCase());
      const names = [...new Set([...String(cookies.wv_rail ?? '').split(',').filter((n) => available.includes(n)), ...available])];
      const creator = logins.find((me) => mayAdminister(hubRoot, rootOf(me)?.role)) ?? null;
      const signedUp = (me) => live.filter(([, w]) => w.state.meta.signup && sameLogin(w.state.meta.signup, me)).length;
      const signup = !creator && openSignup.on ? logins.find((me) => signedUp(me) < openSignup.limit) ?? null : null;
      const owner = creator ?? signup ?? (billing ? logins[0] ?? null : null);
      const accountName = (creator && rootOf(creator)?.name) ?? logins.map((me) => rootOf(me)?.name).find(Boolean) ?? logins.map((me) => me.name).find(Boolean) ?? logins.map(label).find((l) => !l.includes('@'))
        ?? logins.map((me) => me.email?.split('@')[0]).find(Boolean) ?? null;
      const unpaid = async (me) => {
        for (const [name, w] of live) {
          if (Weave.roleName(w.accountForIdentity(me)?.role) !== 'architect') continue;
          const { plan } = await billing.standing({ workspace: w.billing(), accounts: w.listAccounts() });
          if (plan == null || plan === 'trial') return name;
        }
        return null;
      };
      return { rows, names, logins: logins.map(label), accountIn: (w) => { const me = opener(w); return me ? { ...accountFor(w, me), login: me } : null; }, creator, signup, owner, canCreate: !!owner, accountName, hubRoot, unpaid };
    };
    const heldStart = async () => {
      prune(starts);
      const key = cookies.wv_start ? await digest(cookies.wv_start) : null;
      const held = key ? starts.get(key) : null;
      return held ? { key, token: cookies.wv_start, logins: held.logins } : null;
    };
    const holdLogin = async (who) => {
      const held = await heldStart();
      const login = { issuer: who.issuer, subject: who.subject, email: who.email ?? null, ...(who.name ? { name: who.name } : {}) };
      const logins = (held?.logins ?? []).map((l) => (sameLogin(l, login) ? login : l));
      if (!logins.some((l) => sameLogin(l, login))) logins.push(login);
      const token = held?.token ?? newChallenge();
      starts.set(held?.key ?? await digest(token), { logins, expiresAt: Date.now() + START_TTL_MS });
      return { token, logins };
    };
    const railDomain = baseDomain ? `; Domain=.${baseDomain}` : '';
    const railCookie = (names) => `wv_rail=${names.join(',')}; HttpOnly; SameSite=Lax; Path=/${railDomain}; Max-Age=${Weave.SESSION_TTL_MS / 1000}${secureFlag(rx)}`;
    const clearRail = () => `wv_rail=; HttpOnly; SameSite=Lax; Path=/${railDomain}; Max-Age=0${secureFlag(rx)}`;
    const startCookies = ({ token, logins }) => [`wv_start=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${START_TTL_MS / 1000}${secureFlag(rx)}`, railCookie(findWorkspaces(logins).names)];
    const withCookies = (res, more) => ({ ...res, headers: { ...res.headers, 'Set-Cookie': [res.headers['Set-Cookie'] ?? []].flat().concat(more) } });
    if (path === '/' && baseDomain && oidc && !hostOrigin && !wsPrefix && ['GET', 'HEAD'].includes(rx.method)) {
      const railed = (await heldStart()) ? null : String(cookies.wv_rail ?? '').split(',').filter(Boolean).map((n) => hub.bySlug(n)).find((w) => w && !w.state.meta.deletedAt && !isDocsWorkspace(w));
      return { status: 302, headers: { Location: railed ? `${scheme}//${String(railed.state.meta.name).toLowerCase()}.${baseDomain}/#/resume` : '/start', 'Cache-Control': 'no-store' }, body: '' };
    }
    const resolved = new Map();
    const ownSession = (w) => {
      if (resolved.has(w)) return resolved.get(w);
      const name = cookieName(w);
      const own = cookies[name] ? w.verifySession(cookies[name]) : null;
      const hit = own ? { ...own, engine: w, cookie: name } : null;
      if (hit?.renewed) jar.push(sessionCookie(name, cookies[name], rx));
      resolved.set(w, hit);
      return hit;
    };
    const docsVisitor = (w) => {
      if (!isDocsWorkspace(w) || !w.state.meta.requireAuth) return null;
      for (const name of Object.keys(cookies)) {
        const from = name.startsWith(`${LEGACY_COOKIE}_`) ? hub.get(name.slice(LEGACY_COOKIE.length + 1)) : null;
        const hit = from && from !== w ? ownSession(from) : null;
        if (hit) return { ...hit, role: 'observer', visitor: true };
      }
      return null;
    };
    const docsToken = (w, token) => {
      if (!isDocsWorkspace(w) || !w.state.meta.requireAuth) return null;
      const from = hub.entries().find(([, x]) => x !== w && !x.state.meta.deletedAt && x.verifyToken(token))?.[1];
      return from ? { ...from.verifyToken(token), role: 'observer' } : null;
    };
    const crossSeat = (w) => {
      const root = hub.get(hub.defaultName);
      if (w === root || cookies[outName(w)]) return null;
      const base = ownSession(root);
      if (!base) return null;
      for (const id of base.identities ?? []) {
        const acct = w.accountForIdentity({ issuer: id.issuer, subject: id.subject }, { touch: false });
        if (acct) return { ...base, role: acct.role };
      }
      return mayAdminister(root, base.role) ? base : null;
    };
    const sessionOn = (w) => ownSession(w) ?? crossSeat(w) ?? docsVisitor(w);
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
        resource: (hostOrigin ?? mcpOrigin(rx)) + rest,
        authorization_servers: [oidc.issuer],
        scopes_supported: ['openid'],
        bearer_methods_supported: ['header'],
      });
    }
    if (path === '/.well-known/openai-apps-challenge' && !wsPrefix && ['GET', 'HEAD'].includes(rx.method)) {
      const token = process.env.WEAVE_OPENAI_APPS_CHALLENGE?.trim();
      if (!token) return notFound({ error: 'No apps challenge is configured', code: 'not-found' });
      return out(200, token, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    }
    if (path === '/mcp') {
      if (oidc) mcpChallenge = `Bearer resource_metadata="${hostOrigin ?? mcpOrigin(rx)}/.well-known/oauth-protected-resource${wsPrefix}/mcp"`;
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
        const engine = [weave, root].find((e) => (account = e.accountForIdentity(who)) && (e === weave || mayAdminister(root, account.role)));
        if (!engine) return deny(403, `This ${oidc.name} sign-in opens no account on this workspace. Ask an operator for an invite (weave account link <name>) and open it in a browser once; then sign in here again.`);
        oauth = { account, engine };
      }
      path = '/api/mcp';
      mcpDoor = true;
    }
    const door = shareDoor(path, authz);
    const share = door ? weave.shareByToken(door.token) : null;
    if (door) {
      if (!share) return door.page ? notFound({ error: 'This share link is not (or no longer) valid', code: 'not-found' }) : deny(401, 'Invalid token');
      if (share.visibility === 'private' && !sessionOn(weave)) return door.page ? wallPage() : deny(401, 'This share link is private: sign in to open it');
      weave.actor = actor = `share:${share.label || share.id.slice(0, 8)}`.slice(0, 120);
      if (door.page) {
        const hit = sharePage(weave, share, door.rest, { method: rx.method, prefix: wsPrefix });
        if (hit.redirect) return { status: 302, headers: { Location: hit.redirect, 'Cache-Control': 'no-store' }, body: '' };
        if (hit.html) return out(200, hit.html, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        if (hit.status === 405) return out(405, { error: 'A share page is read-only', code: 'method-not-allowed' }, { Allow: 'GET, HEAD' });
        if (!hit.path) return notFound({ error: 'Not found', code: 'not-found' });
        path = hit.path;
      }
    }
    if (share) role = null;
    else if (authz && /^Bearer /i.test(authz)) {
      const account = oauth?.account ?? weave.verifyToken(authz.slice(7).trim()) ?? docsToken(weave, authz.slice(7).trim());
      if (!account) return path.startsWith('/api/') ? deny(401, 'Invalid token') : wallPage();
      weave.actor = actor = oauth ? `${accountActor(account.id)} via MCP` : actorOf(account);
      accountName = account.name;
      role = Weave.roleName(account.role);
    } else if ((session = sessionOn(weave))) {
      weave.actor = actor = actorOf(session);
      accountName = session.name;
      role = Weave.roleName(session.role);
    } else if (weave.state.meta.requireAuth && !openDoor && cookies[cookieName(weave)]) {
      if (weave.removedSession(cookies[cookieName(weave)])) {
        const ws = weave.state.meta.name;
        if (path.startsWith('/api/')) return out(403, { error: `Your access to ${ws} was removed`, code: 'access-removed' }, { 'Cache-Control': 'no-store' });
        return out(403, renderRefusalPage({
          title: `Your access to ${ws} was removed`,
          lines: [`A workspace architect removed your account from ${ws}, so this browser's session there has ended.`, 'Ask an architect for a new invite link, or sign in with a different account.'],
          actions: [{ href: `${wsPrefix}/auth?signed-out=1`, label: 'Sign in with a different account' }],
        }), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      return path.startsWith('/api/')
        ? deny(401, 'Session expired or revoked')
        : { status: 302, headers: { Location: authHref, 'Set-Cookie': clearCookie(cookieName(weave), rx), 'Cache-Control': 'no-store' }, body: '' };
    } else if (weave.state.meta.requireAuth && !openDoor) {
      if (path.startsWith('/api/')) return deny(401, 'This workspace requires authentication');
      const preview = weave.state.meta.linkPreview && ['GET', 'HEAD'].includes(rx.method) ? linkPreview(path, { signedOut: true }) : null;
      if (preview) return out(200, previewPageHtml(preview.head, authHref), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return wall();
    }
    let unseated = null;
    const seatRequired = () => {
      const ws = weave.state.meta.name;
      const ended = weave.state.meta.trialFrom && billing?.trialDays ? `The free trial of ${ws} has ended, so creating and editing there needs a paid seat.` : `Creating and editing in ${ws} needs a paid seat.`;
      return unseated === 'architect'
        ? `${ended} Reading and commenting stay free. Subscribe on the billing page to keep editing.`
        : `${ended} Reading and commenting stay free. Ask an architect of ${ws} to subscribe on the billing page.`;
    };
    if (billing && PAID_ROLES.has(role) && accountName && !['GET', 'HEAD', 'OPTIONS'].includes(rx.method) && !path.startsWith('/api/billing') && !path.startsWith('/api/auth/')) {
      try {
        if (!(await billing.standing({ workspace: weave.billing(), accounts: weave.listAccounts() })).seated(accountName)) { unseated = role; role = 'observer'; }
      } catch (error) {
        if (!(error instanceof BillingUnavailable)) throw error;
        return out(503, { error: error.message, code: 'billing-unavailable' }, { 'Retry-After': '60', 'Cache-Control': 'no-store' });
      }
    }
    const guarded = () => !!(weave.listAccounts().length || hub.get(hub.defaultName).listAccounts().length);
    const actorForRequest = role || share || !guarded() ? actor : 'anonymous';
    weave.actor = actorForRequest;
    const requestActor = role ? actorForRequest : 'anonymous';
    const cap = role ?? (!share && !weave.state.meta.requireAuth && guarded() ? 'observer' : null);
    if (cap && cap !== 'architect') {
      const m2 = rx.method;
      const read = m2 === 'GET' || m2 === 'HEAD' || path.startsWith('/api/auth/')
        || (unseated === 'architect' && path === '/api/mcp')
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
      const observer = cap !== 'editor';
      const cm = observer && !read && path.match(/^\/api\/entities\/([^/]+)\/comments(?:\/([^/]+?))?$/);
      const ownComment = cm && (cm[2] == null ? m2 === 'POST' : m2 === 'DELETE' && (() => {
        try { return weave.isActor(weave.getEntity(cm[1]).comments.find((c) => c.id === cm[2])?.author); } catch { return false; }
      })());
      const submits = m2 === 'POST' && (path === '/api/bug-report' || path === '/api/workspace/leave' || /^\/api\/forms\/[^/]+\/submit$/.test(path));
      if (observer && !read && !ownComment && !submits) {
        if (unseated) return out(402, { error: seatRequired(), code: 'seat-required', billing: `${wsPrefix}/billing` }, { 'Cache-Control': 'no-store' });
        return role ? deny(403, 'An observer may read and comment, nothing else') : deny(401, 'This workspace has accounts: send a token or sign in to write');
      }
      if (cap === 'editor' && (schemaWrite || sysTouch)) return deny(403, 'This token cannot change the schema');
    }
    const roleOn = (w) => {
      if (w === weave) return role;
      if (oauth) return w === oauth.engine ? Weave.roleName(oauth.account.role) : null;
      if (authz && /^Bearer /i.test(authz)) return Weave.roleName((w.verifyToken(authz.slice(7).trim()) ?? docsToken(w, authz.slice(7).trim()))?.role) ?? null;
      return Weave.roleName(sessionOn(w)?.role) ?? null;
    };

    const plainMention = (kind, ref) => {
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
          return {
            href: `${wsPrefix}/e/${e.id}/doc.html`,
            label: weave.entityName(e),
            name: weave.entityName(e),
            home: weave.state.tables[e.dbId]?.name,
            view: weave.renderView(e.id, 'chip'),
            fields: weave.previewFields(e.id),
          };
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
          home: db.name,
          view: weave.renderView(entity.id, 'chip'),
          fields: weave.previewFields(entity.id),
        };
      } catch {
        return null;
      }
    };
    const resolveMention = share ? scopedMention(weave, share, plainMention, `${wsPrefix}/s/${share.token}`) : plainMention;

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
        return out(200, pdf, fileHeaders({ name: `${entity.name || 'document'}.pdf`, mime: 'application/pdf' }, pdf));
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
        const pdf = markdownToPdf(md, { title: entity.name || `#${entity.publicId}`, subtitle });
        return out(200, pdf, fileHeaders({ name: `${entity.name || 'entity'}.pdf`, mime: 'application/pdf' }, pdf));
      }

      if ((m = path.match(/^\/e\/([^/]+)\/deck\.(html|json)$/))) {
        const { renderDeck } = await deckModule();
        const built = renderDeck(weave, m[1]);
        if (m[2] === 'json') {
          return out(200, { model: built.model, errors: built.errors, warnings: built.warnings });
        }
        return out(200, built.html, sandboxedHtmlHeaders({ 'X-Weave-Deck-Warnings': String(built.warnings.length) }));
      }

      if ((m = path.match(/^\/t\/([^/]+)\/new$/)) && ['GET', 'HEAD'].includes(rx.method)) {
        const preview = linkPreview(`/t/${m[1]}`);
        if (!preview) throw new WeaveError(`Nothing at ${wsPrefix}${path}`, 'not-found');
        const q = weavePrefill.clip(rx.searchParams).query;
        const to = `${wsPrefix}/#/table/${m[1]}/new${q ? `?${q}` : ''}`;
        if (!serveStatic) return { status: 302, headers: { Location: to, 'Cache-Control': 'no-store' }, body: '' };
        const hit = serveStatic('/', rx, { head: `${preview.head}${shellMarker()}\n<meta name="weave-route" content="${metaAttr(to)}">\n<script src="/permalink.js"></script>` });
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
        const hit = preview && serveStatic ? serveStatic('/', rx, { head: preview.head + shellMarker() + jump }) : null;
        if (hit) return hit;
      }

      const formClient = () => {
        const current = cookies.wv_form_client;
        if (/^[A-Za-z0-9_-]{43}$/.test(current ?? '')) return current;
        const token = newChallenge();
        jar.push(`wv_form_client=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secureFlag(rx)}`);
        return token;
      };
      const formFor = (ref) => {
        let form;
        try { form = getForm(weave, decodeURIComponent(ref)); } catch (err) {
          if (err instanceof WeaveError && err.code === 'not-found' && weave.state.meta.requireAuth && role == null) return { form: null, admitted: false };
          throw err;
        }
        return { form, admitted: formAdmits(form, { role: roleOn(form.owner), anonymous: anonymousForms }) };
      };
      if ((m = path.match(/^\/f\/([^/]+)$/)) && ['GET', 'HEAD'].includes(rx.method)) {
        const { form, admitted } = formFor(m[1]);
        if (!admitted) return wall();
        formClient();
        return out(200, renderFormPage(form, { mount: wsPrefix, searchParams: rx.searchParams }), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }

      if ((m = path.match(/^\/api\/forms\/([^/]+)\/submit$/)) && rx.method === 'POST') {
        const { form, admitted } = formFor(m[1]);
        if (!admitted) return deny(401, 'Sign in to submit this form');
        const ip = clientIp(rx);
        const key = `${form.owner.state.meta.id}:${form.id}`;
        const retry = formLimited([['server', limits.formServer ?? 1000], [`form:${key}`, limits.formTotal ?? 120], [`sender:${key}:${ip}`, limits.formSender ?? 20]]);
        if (retry) return out(429, { error: 'Too many submissions. Try again later.', code: 'rate-limited' }, { 'Retry-After': String(retry) });
        const signedIn = roleOn(form.owner) != null;
        const actor = !signedIn ? 'anonymous' : form.owner === weave ? requestActor : actorOf((authz && /^Bearer /i.test(authz) ? form.owner.verifyToken(authz.slice(7).trim()) ?? docsToken(form.owner, authz.slice(7).trim()) : sessionOn(form.owner)) ?? null) ?? requestActor;
        const body = await rx.readBody();
        const idempotencyKey = rx.header('idempotency-key') ?? body?.idempotencyKey;
        const client = formClient();
        if (!signedIn && idempotencyKey != null && !/^[A-Za-z0-9_-]{32,200}$/.test(idempotencyKey)) throw new WeaveError('Anonymous Idempotency-Key must contain 32 to 200 letters, digits, hyphens or underscores', 'invalid');
        const input = form.kind === 'Row' && body && typeof body === 'object' && !Array.isArray(body) && !Object.hasOwn(body, 'values') ? { values: Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'idempotencyKey')) } : body;
        const result = submitForm(weave, form.id, input ?? {}, {
          actor,
          server: { version, startedAt: STARTED_AT, uptime: Math.round(uptime()), workspace: weave.state.meta.name },
          idempotencyKey,
          scope: signedIn ? '' : idempotencyKey != null ? `key:${await digest(idempotencyKey)}` : `client:${client}`,
          dedupScope: signedIn ? '' : `client:${client}`,
        });
        return out(result.replayed ? 200 : 201, result);
      }

      if (statusPage) {
        const page = serveStatic?.('/status.html', rx);
        return page ?? notFound({ error: 'Not found', code: 'not-found' });
      }

      if (path === '/auth') {
        if (baseDomain && oidc && !hostOrigin && !wsPrefix) return { status: 302, headers: { Location: rx.searchParams?.get('mode') === 'signup' ? '/start?mode=signup' : '/start', 'Cache-Control': 'no-store' }, body: '' };
        if (oidc && !session && !role && !rx.searchParams?.has('signed-out')) {
          const q = rx.searchParams?.toString() ?? '';
          if (!origin && String(rx.header('host') ?? '').split(':')[0] === '127.0.0.1') {
            return { status: 302, headers: { Location: `${originFor(rx)}${wsPrefix}/auth${q ? '?' + q : ''}`, 'Cache-Control': 'no-store' }, body: '' };
          }
          const n = sameOriginPath(rx.searchParams?.get('next'), originFor(rx), null);
          if (baseDomain && wsPrefix && !hostOrigin) return { status: 302, headers: { Location: `/start?next=${encodeURIComponent(n?.startsWith(`${wsPrefix}/`) ? n : `${wsPrefix}/`)}`, 'Cache-Control': 'no-store' }, body: '' };
          const next = n ? `?next=${encodeURIComponent(n)}` : '';
          return { status: 302, headers: { Location: `${wsPrefix}/api/auth/oidc/start${next}`, 'Cache-Control': 'no-store' }, body: '' };
        }
        return out(200, renderAuthPage({ mount: wsPrefix, workspace: weave.state.meta.name, provider: oidc?.name ?? null, analyticsKey: posthog?.key ?? null }), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      }

      if (path === '/start' && ['GET', 'HEAD'].includes(rx.method)) {
        const asked = ['pick', 'setup', 'error', 'mode', 'next'].some((k) => rx.searchParams?.has(k));
        const logins = !hostOrigin && !wsPrefix && oidc && !asked ? (await heldStart())?.logins ?? [] : [];
        const found = logins.length ? findWorkspaces(logins) : null;
        const last = found?.rows.find((r) => r.kind === 'workspace' && r.name.toLowerCase() === found.names[0]) ?? found?.rows.find((r) => r.kind === 'workspace');
        if (last && !found.rows.some((r) => r.kind === 'invite')) return { status: 302, headers: { Location: `${last.open}?to=resume`, 'Cache-Control': 'no-store' }, body: '' };
        const page = !hostOrigin && !wsPrefix && oidc && serveStatic ? serveStatic('/start.html', rx) : null;
        const back = rx.searchParams?.get('next');
        const workspaceReturn = back == null || (sameOriginPath(back, originFor(rx), null) === back && /^\/w\/[^/?#]+\//.test(back));
        if (page && !workspaceReturn) {
          const q = new URLSearchParams(rx.searchParams);
          q.delete('next');
          return { status: 302, headers: { Location: `/start${q.size ? `?${q}` : ''}`, 'Cache-Control': 'no-store' }, body: '' };
        }
        if (page) return { ...page, headers: { ...page.headers, 'Cache-Control': 'no-store' } };
        return notFound({ error: 'Not found', code: 'not-found' });
      }

      if (path === '/billing' && ['GET', 'HEAD'].includes(rx.method)) {
        const page = billing && serveStatic ? serveStatic('/billing.html', rx) : null;
        if (page) return { ...page, headers: { ...page.headers, 'Cache-Control': 'no-store' } };
        return notFound({ error: 'Not found', code: 'not-found' });
      }

      if (legalPage) {
        const [title, markdown] = {
          '/privacy': ['Privacy policy', PRIVACY],
          '/terms': ['Terms of Service', TERMS],
          '/support': ['Support', SUPPORT],
          '/docs': ['Connect an agent', `${AGENT_DOCS.replaceAll('{{MCP_URL}}', `${hostOrigin ?? mcpOrigin(rx)}${wsPrefix}/mcp`)}\n\n## Tools\n\n${toolTable()}\n`],
        }[path];
        const html = renderDocumentPage({ title, subtitle: 'weave', markdown });
        return out(200, path === '/privacy' ? html.replace('<h3>Cookies</h3>', '<h3 id="cookies">Cookies</h3>') : html, { 'Content-Type': 'text/html; charset=utf-8' });
      }

      if (path === '/api/backups' || (m = path.match(/^\/api\/backups\/([^/]+)$/))) {
        const archive = path === '/api/backups' ? null : m[1];
        const bearer = authz && /^Bearer /i.test(authz) ? authz.slice(7).trim() : '';
        const account = bearer.startsWith('wv_') ? weave.verifyToken(bearer) : null;
        if (!account) return deny(401, 'Backups need the account token: send Authorization: Bearer wv_…');
        const claimed = rx.header('x-weave-account');
        let named = claimed;
        try { named = claimed == null ? null : decodeURIComponent(claimed); } catch {}
        if (named != null && named !== account.name) return deny(403, `This token belongs to the account ${account.name}, not ${named}`);
        if (!cloudBackups) return out(400, { error: 'This deployment keeps no backups: it has no bucket configured.', code: 'invalid' });
        if (rx.method === 'GET' && !archive) {
          const backups = await cloudBackups.list(account.id);
          return out(200, { account: account.name, quota: cloudBackups.quota, used: backups.reduce((n, b) => n + b.bytes, 0), backups });
        }
        if (rx.method === 'GET') {
          const bytes = await cloudBackups.get(account.id, archive);
          return out(200, new Uint8Array(bytes), { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${archive}"`, 'Cache-Control': 'no-store' });
        }
        if (rx.method === 'PUT' && archive) {
          if (!rx.readBytes) return out(400, { error: 'This deployment cannot take an archive upload.', code: 'invalid' });
          return out(201, await cloudBackups.put(account.id, archive, await rx.readBytes(cloudBackups.quota)));
        }
        return out(405, { error: 'Backups answer GET /api/backups, GET /api/backups/<name> and PUT /api/backups/<name>', code: 'method-not-allowed' }, { Allow: 'GET, PUT' });
      }

      if (path.startsWith('/api/')) {
        const body = ['POST', 'PUT', 'PATCH'].includes(rx.method) ? await rx.readBody() : {};
        weave.actor = actorForRequest;
        const route = `${rx.method} ${path}`;
        if (share) {
          const gated = shareGate(weave, share, { method: rx.method, path, body, searchParams: rx.searchParams, viewerZone });
          if (gated) return out(gated.status, gated.data);
        }

        if (path.startsWith('/api/auth/')) {
          const ip = clientIp(rx);
          const tooMany = () => out(429, { error: 'Too many attempts — wait a minute and try again', code: 'rate-limited' });
          const who = () => session ?? (role ? weave.verifyToken(authz.slice(7).trim()) : null);
          if (path.startsWith('/api/auth/oidc/')) {
            if (!oidc) return notFound({ error: 'No identity provider is configured (WEAVE_OIDC_ISSUER)', code: 'not-found' });
            let mount = wsPrefix;
            const signInAgain = () => ({ href: `${mount}/auth?signed-out=1`, label: 'Back to sign in' });
            const refusal = (status, title, detail, actions = [signInAgain()]) => out(status, renderRefusalPage({ title, lines: detail, actions }),
              { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            const tooMany = () => refusal(429, 'Too many sign-in attempts', 'Wait a minute, then sign in again.');
            const redirectUri = `${originFor(rx)}/api/auth/oidc/callback`;
            if (hostOrigin && route === 'GET /api/auth/oidc/start') {
              const q = new URLSearchParams(rx.searchParams ?? '');
              q.set('handoff', String(weave.state.meta.name).toLowerCase());
              return { status: 302, headers: { Location: `${apexOrigin}/w/${encodeURIComponent(weave.state.meta.name)}/api/auth/oidc/start?${q}`, 'Cache-Control': 'no-store' }, body: '' };
            }
            if (route === 'GET /api/auth/oidc/start') {
              if (limited('options', ip)) return tooMany();
              const handoff = rx.searchParams?.get('handoff') || null;
              if (handoff && (!baseDomain || hub.bySlug(handoff) !== weave)) return refusal(400, 'This sign-in link is not valid', 'Start again from the sign-in page of the workspace you want.');
              const next = sameOriginPath(rx.searchParams?.get('next'), originFor(rx), handoff ? '/' : `${wsPrefix}/`);
              const invite = rx.searchParams?.get('invite') || null;
              if (invite && !weave.identityInvite(invite)) {
                const member = session?.engine === weave || ((await heldStart())?.logins ?? []).some((me) => weave.accountForIdentity(me));
                return refusal(410, 'This invite expired or was already used', member ? 'You already have access. Open your workspace to continue.' : 'If you already joined, sign in to open the workspace. Otherwise, ask the sender for a new invite.',
                  [{ href: member ? `${mount}/` : `${mount}/auth`, label: member ? 'Open workspace' : 'Sign in to workspace' }, { href: '/start?pick=1', label: 'Find your workspaces' }]);
              }
              const heldLogins = invite && !rx.searchParams?.has('pick') ? (await heldStart())?.logins ?? [] : [];
              if (heldLogins.length) {
                const again = (extra) => { const u = new URLSearchParams(rx.searchParams ?? ''); for (const [k, v] of Object.entries(extra)) u.set(k, v); return `${mount}/api/auth/oidc/start?${u}`; };
                const another = { label: WeaveSlugs.COPY.start.otherLogin, href: again({ fresh: '1', pick: '1' }) };
                const as = rx.searchParams?.get('as');
                if (as == null) {
                  const labels = findWorkspaces(heldLogins).logins;
                  return refusal(200, WeaveSlugs.fill(WeaveSlugs.COPY.start.chooserTitle, { workspace: weave.state.meta.name }), WeaveSlugs.COPY.start.chooserLead,
                    [...labels.map((login, i) => ({ label: WeaveSlugs.fill(WeaveSlugs.COPY.start.acceptAs, { login }), href: again({ as: String(i) }) })), another]);
                }
                const me = heldLogins[Number(as)];
                if (!me) return refusal(400, 'This choice expired', 'Open the invite link again.', [another]);
                let account;
                try { account = weave.redeemIdentityInvite(invite, me); await remirror(weave); } catch (err) {
                  noteFailure(ip);
                  if (err.code === 'conflict') return refusal(409, 'This login already opens another account', 'The invite was not used. Accept it with the login it was meant for.', [another, signInAgain()]);
                  return refusal(410, 'This invite expired or was already used', 'Ask whoever sent it for a new link.');
                }
                const kept = startCookies(await holdLogin(me));
                const to = posthog ? joinedInvite(next) : next;
                if (handoff) return withCookies(await handOff(weave, account.id, to, handoff), kept);
                const minted = weave.createSession(account.id, { ua: rx.header('user-agent') });
                return { status: 302, headers: { Location: to, 'Set-Cookie': [sessionCookie(cookieName(weave), minted.token, rx), ...kept], 'Cache-Control': 'no-store' }, body: '' };
              }
              let trip;
              try { trip = await oidc.begin({ redirectUri, fresh: rx.searchParams?.has('fresh') }); } catch (err) { return refusal(502, `${oidc.name} is not answering`, err.message); }
              const binder = newChallenge();
              const start = !hostOrigin && !wsPrefix && (rx.searchParams?.has('start') || !!baseDomain);
              putChallenge({ kind: 'oidc', nonce: trip.nonce, verifier: trip.verifier, binder, next, holder: weave, invite, mount: wsPrefix, handoff, start }, trip.state);
              const secure = originFor(rx).startsWith('https:') ? '; Secure' : '';
              return { status: 302, headers: { Location: trip.url, 'Set-Cookie': `wv_oidc=${binder}; HttpOnly; SameSite=Lax; Path=/api/auth/oidc; Max-Age=${CHALLENGE_TTL_MS / 1000}${secure}`, 'Cache-Control': 'no-store' }, body: '' };
            }
            if (route === 'GET /api/auth/oidc/callback') {
              if (limited('failed', ip, { peek: true })) return tooMany();
              const c = takeChallenge(String(rx.searchParams?.get('state') ?? ''), 'oidc');
              if (!c || !cookies.wv_oidc || cookies.wv_oidc !== c.binder) { noteFailure(ip); return refusal(400, 'This sign-in expired or was already used', 'Start again from the sign-in page, in the browser you want to sign in.'); }
              mount = c.mount ?? '';
              const toStart = (code) => ({ status: 302, headers: { Location: `/start?error=${code}`, 'Cache-Control': 'no-store' }, body: '' });
              if (rx.searchParams.get('error') || !rx.searchParams.get('code')) {
                if (c.start) return toStart('signin_failed');
                return refusal(400, `${oidc.name} did not sign you in`, String(rx.searchParams.get('error_description') ?? rx.searchParams.get('error') ?? 'No authorization code came back.'));
              }
              let who;
              try {
                who = await oidc.redeem({ code: rx.searchParams.get('code'), redirectUri, verifier: c.verifier, nonce: c.nonce });
              } catch (err) {
                noteFailure(ip);
                if (!(err instanceof WeaveError)) return c.start ? toStart('provider_down') : refusal(502, `${oidc.name} is not answering`, 'The identity provider could not be reached. Try again in a minute.');
                return c.start ? toStart('signin_unverified') : refusal(401, `${oidc.name} sign-in could not be verified`, err.message);
              }
              if (c.start) {
                const back = /^\/start(?:[?#]|$)/.test(c.next) ? c.next : '/start';
                return { status: 302, headers: { Location: back, 'Set-Cookie': startCookies(await holdLogin(who)), 'Cache-Control': 'no-store' }, body: '' };
              }
              const root = hub.get(hub.defaultName);
              let account = null;
              const fresh = (invite) => `${mount}/api/auth/oidc/start?fresh=1${c.handoff ? `&handoff=${encodeURIComponent(c.handoff)}` : ''}${invite ? `&invite=${encodeURIComponent(invite)}` : ''}&next=${encodeURIComponent(c.next)}`;
              const differentAccount = async () => ({ label: 'Use a different account', href: await oidc.endSessionUrl({ postLogoutRedirectUri: `${originFor(rx)}${mount}/auth?signed-out=1` }).catch(() => null) ?? fresh() });
              let engine = null;
              if (c.invite) {
                try {
                  account = c.holder.redeemIdentityInvite(c.invite, who);
                  engine = c.holder;
                  await remirror(c.holder);
                } catch (err) {
                  noteFailure(ip);
                  if (err.code === 'conflict') return refusal(409, 'This identity already opens another account', `You signed in at ${oidc.name} as someone this server already knows, so the invite was not used. Sign in as the person it was meant for to use it.`, [{ label: 'Use a different account', href: fresh(c.invite) }, signInAgain()]);
                  return refusal(410, 'This invite expired or was already used', 'Ask whoever sent it for a new link.');
                }
              } else engine = [c.holder, root].find((e) => (account = e.accountForIdentity(who)));
              if (!engine && isDocsWorkspace(c.holder)) engine = hub.entries().map(([, w]) => w).find((e) => e !== c.holder && !e.state.meta.deletedAt && (account = e.accountForIdentity(who)));
              if (!engine) {
                noteFailure(ip);
                const ws = c.holder.state.meta.name;
                const own = billing ? [{ label: 'Start your own workspace', href: `${startRoot}/start` }] : [];
                const page = refusal(403, `No access to ${ws}`, [`You signed in at ${oidc.name}, but that account has no access to ${ws}.`, 'A workspace architect can send you an invite link that adds you. Or sign in with a different account.'], [...own, await differentAccount(), signInAgain()]);
                return own.length ? withCookies(page, startCookies(await holdLogin(who))) : page;
              }
              const kept = startCookies(await holdLogin(who));
              const to = posthog && c.invite ? joinedInvite(c.next) : c.next;
              if (c.handoff) return withCookies(await handOff(engine, account.id, to, c.handoff), kept);
              const minted = engine.createSession(account.id, { ua: rx.header('user-agent') });
              const back = cookies[outName(c.holder)] ? [clearCookie(outName(c.holder), rx)] : [];
              return { status: 302, headers: { Location: to, 'Set-Cookie': [sessionCookie(cookieName(engine), minted.token, rx), ...back, ...kept], 'Cache-Control': 'no-store' }, body: '' };
            }
            return notFound({ error: 'Unknown auth route', code: 'not-found' });
          }
          if (route === 'GET /api/auth/handoff' && hostOrigin) {
            if (limited('failed', ip, { peek: true })) return tooMany();
            const key = await digest(String(rx.searchParams?.get('code') ?? ''));
            const h = handoffs.get(key);
            handoffs.delete(key);
            if (!h || h.expiresAt <= Date.now() || h.host !== hostSlug) {
              noteFailure(ip);
              return out(400, renderRefusalPage({ title: 'This sign-in expired or was already used', lines: 'Start again from the sign-in page.', actions: [{ href: '/auth?signed-out=1', label: 'Back to sign in' }] }),
                { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
            }
            const minted = h.engine.createSession(h.accountId, { ua: rx.header('user-agent') });
            return { status: 302, headers: { Location: h.next, 'Set-Cookie': sessionCookie(cookieName(h.engine), minted.token, rx), 'Cache-Control': 'no-store' }, body: '' };
          }
          if (route === 'POST /api/auth/logout') {
            const everywhere = ['1', 'true'].includes(rx.searchParams?.get('everywhere') ?? '');
            const borrowed = !everywhere && !!session && session.engine !== weave;
            const ending = everywhere ? hub.entries().map(([, w]) => ownSession(w)).filter(Boolean) : borrowed ? [] : [session].filter(Boolean);
            for (const hit of ending) {
              try { hit.engine.revokeSession(hit.id, { id: hit.sessionId }); } catch {}
            }
            const names = new Set(everywhere
              ? [...Object.keys(cookies).filter((n) => n === LEGACY_COOKIE || n.startsWith(`${LEGACY_COOKIE}_`) || n.startsWith('wv_out_')), ...ending.map((hit) => hit.cookie)]
              : borrowed ? [] : [session?.cookie ?? cookieName(weave)]);
            const marks = borrowed ? [`${outName(weave)}=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Weave.SESSION_TTL_MS / 1000}${secureFlag(rx)}`] : [];
            const held = everywhere ? await heldStart() : null;
            if (held) starts.delete(held.key);
            const startEnds = everywhere ? [clearCookie('wv_start', rx), clearRail()] : [];
            return out(200, { ok: true }, { 'Set-Cookie': [...[...names].map((n) => clearCookie(n, rx)), ...marks, ...startEnds], 'Cache-Control': 'no-store' });
          }
          if (route === 'GET /api/auth/me') {
            const account = who();
            if (!account) return deny(401, 'Not signed in');
            const engine = session ? session.engine : weave;
            const sessions = engine.listSessions(account.id).map(({ accountId, ...s }) => ({ ...s, current: s.id === session?.sessionId }));
            const { credentials, ...pub } = engine.listAccounts().find((a) => a.id === account.id) ?? account;
            const ids = pub.identities ?? [];
            const user = posthog ? (ids.find((i) => i.issuer === oidc?.issuer) ?? ids[0])?.subject : null;
            return out(200, { account: pub, role: account.role, sessions, ...(user ? { analytics: { user } } : {}) }, { 'Cache-Control': 'no-store' });
          }
          if ((m = path.match(/^\/api\/auth\/sessions\/([^/]+)$/)) && rx.method === 'DELETE') {
            const account = who();
            if (!account) return deny(401, 'Not signed in');
            const engine = session ? session.engine : weave;
            if (m[1] === 'others') return out(200, engine.revokeSession(account.id, { all: true, except: session?.sessionId ?? null }));
            return out(200, engine.revokeSession(account.id, { id: m[1] }));
          }
          return notFound({ error: 'Unknown auth route', code: 'not-found' });
        }

        if (startDoor) {
          if (hostOrigin || wsPrefix || !oidc) return notFound({ error: 'Not found', code: 'not-found' });
          const held = await heldStart();
          const logins = held?.logins ?? [];
          if (route === 'POST /api/start/signout') {
            if (held) starts.delete(held.key);
            return out(200, { ok: true }, { 'Set-Cookie': [clearCookie('wv_start', rx), clearRail()], 'Cache-Control': 'no-store' });
          }
          if (route === 'GET /api/start' && !logins.length) return out(200, { signedIn: false, provider: oidc.name, ...(clerkPane ? { clerk: clerkPane } : {}), ...(posthog ? { analytics: { key: posthog.key } } : {}) }, { 'Cache-Control': 'no-store' });
          if (!logins.length) return deny(401, 'Sign in first');
          const found = findWorkspaces(logins);
          const { hubRoot, accountIn } = found;
          if (route === 'GET /api/start') {
            const { canCreate, accountName } = found;
            const trialOn = async (name) => {
              const w = billing && hub.get(name);
              if (!w || !billing.trial(w.billing())) return null;
              return (await billing.standing({ workspace: w.billing(), accounts: w.listAccounts() })).trial;
            };
            const rows = await Promise.all(found.rows.map(async (r) => (r.kind === 'workspace' ? { ...r, trial: await trialOn(r.name) } : r)));
            let waiting = null;
            if (billing && !found.creator && found.owner) {
              try { waiting = await found.unpaid(found.owner); } catch (error) {
                if (!(error instanceof BillingUnavailable)) throw error;
              }
            }
            return out(200, { signedIn: true, rows, logins: found.logins, canCreate, waiting, openSignup: openSignup.on, accountName, base: baseDomain, ...(posthog ? { analytics: { key: posthog.key, user: logins[0].subject } } : {}) }, { 'Set-Cookie': railCookie(found.names), 'Cache-Control': 'no-store' });
          }
          if (route === 'GET /api/start/slug') {
            if (limited('slugs', clientIp(rx))) return out(429, { error: 'Too many checks: wait a minute and try again', code: 'rate-limited' });
            const slug = String(rx.searchParams?.get('slug') ?? '');
            return out(200, { slug, state: hub.slugState(slug), base: baseDomain }, { 'Cache-Control': 'no-store' });
          }
          if ((m = path.match(/^\/api\/start\/open\/([^/]+)$/)) && rx.method === 'GET') {
            const w = hub.bySlug(String(m[1]).toLowerCase());
            const account = w && accountIn(w);
            if (!account) return deny(403, 'This sign-in opens no account on that workspace');
            const engine = account.viaRoot ? hubRoot : w;
            const host = String(w.state.meta.name).toLowerCase();
            const table = String(rx.searchParams?.get('table') ?? '');
            const land = rx.searchParams?.get('to') === 'billing' ? 'billing'
              : rx.searchParams?.get('to') === 'resume' ? '#/resume'
              : /^[0-9a-f-]{36}$/.test(table) && w.listTables().some((t) => t.id === table) ? `#/table/${table}` : '';
            const rail = railCookie(isDocsWorkspace(w) ? found.names : [host, ...found.names.filter((name) => name !== host)]);
            if (baseDomain) return withCookies(await handOff(engine, account.id, `/${land}`, host), [rail]);
            const minted = engine.createSession(account.id, { ua: rx.header('user-agent') });
            const back = cookies[outName(w)] ? [clearCookie(outName(w), rx)] : [];
            return { status: 302, headers: { Location: `/w/${encodeURIComponent(w.state.meta.name)}/${land}`, 'Set-Cookie': [sessionCookie(cookieName(engine), minted.token, rx), ...back, rail], 'Cache-Control': 'no-store' }, body: '' };
          }
          if ((m = path.match(/^\/api\/start\/logo\/([^/]+)$/)) && rx.method === 'GET') {
            const w = hub.bySlug(String(m[1]).toLowerCase());
            if (!(w && accountIn(w))) return deny(403, 'This sign-in opens no account on that workspace');
            if (!w.state.meta.logo) return notFound({ error: 'This workspace has no logo', code: 'not-found' });
            const { bytes } = w.getWorkspaceLogo();
            return out(200, bytes, { 'Content-Type': logoType(bytes), 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'" });
          }
          if ((m = path.match(/^\/api\/start\/invites\/([^/]+)\/([A-Za-z0-9_-]+)$/)) && rx.method === 'POST') {
            const w = hub.bySlug(String(m[1]).toLowerCase());
            if (!w) return notFound({ error: 'Not found', code: 'not-found' });
            const me = logins.find((l) => l.email && w.invitesForEmail(l.email).some((i) => i.id === m[2])) ?? logins[0];
            const account = w.acceptInvite(m[2], me);
            await remirror(w);
            return out(200, { name: w.state.meta.name, account: account.name, open: `/api/start/open/${encodeURIComponent(w.state.meta.name)}` });
          }
          if ((m = path.match(/^\/api\/start\/workspaces\/([^/]+)\/agent$/)) && rx.method === 'GET') {
            const w = hub.bySlug(String(m[1]).toLowerCase());
            const account = w && accountIn(w);
            if (!account) return deny(403, 'This sign-in opens no account on that workspace');
            const seen = (account.viaRoot ? hubRoot : w).agentSeen(account.id);
            return out(200, { connected: !!seen, at: seen?.at ?? null, client: seen?.client ?? null }, { 'Cache-Control': 'no-store' });
          }
          if (route === 'POST /api/start/workspaces') {
            const me = found.owner;
            if (!me) {
              if (openSignup.on) return out(403, { error: 'This sign-in has made as many workspaces as this server allows.', code: 'signup_limit' });
              return out(403, { error: 'Creating a workspace here needs an invite from the operator.', code: 'signup_closed' });
            }
            if (!found.creator && billing) {
              let waiting;
              try { waiting = await found.unpaid(me); } catch (error) {
                if (!(error instanceof BillingUnavailable)) throw error;
                return out(503, { error: error.message, code: 'billing-unavailable' }, { 'Retry-After': '60', 'Cache-Control': 'no-store' });
              }
              if (waiting) {
                const at = baseDomain ? `${scheme}//${String(waiting).toLowerCase()}.${baseDomain}/billing` : `/w/${encodeURIComponent(waiting)}/billing`;
                return out(402, { error: `${waiting} is still waiting on a plan. Subscribe to the solo plan on its billing page, then start another workspace.`, code: 'plan-required', waiting, billing: at }, { 'Cache-Control': 'no-store' });
              }
            }
            const template = body?.template ? WeaveStarters.TEMPLATES.find((t) => t.id === body.template) : null;
            if (body?.template && !template) return out(400, { error: `Unknown template '${body.template}'`, code: 'invalid' });
            const ownerName = (found.creator && hubRoot.accountForIdentity(me)?.name) || found.accountName || 'owner';
            let asked = body?.name;
            let slug = body?.slug ?? null;
            if (body?.quick) {
              asked = String(asked || ownerName);
              const base = WeaveSlugs.slugify(asked) || 'workspace';
              slug = [base, ...Array.from({ length: 50 }, (_, i) => `${base}-${i + 2}`)].find((s) => hub.slugState(s) === 'available') ?? null;
            }
            const w = hub.create(asked, { slug, actor: actorForRequest });
            const owner = w.createAccount({ name: ownerName, role: 'architect' }).account;
            w.redeemIdentityInvite(w.linkIdentity(owner.name, { issuer: me.issuer }).code, me);
            if (!found.creator) {
              w.state.meta.signup = { issuer: me.issuer, subject: me.subject };
              w.save();
            }
            w.startTrial();
            let table = null;
            let templateError = null;
            const built = { space: template?.space ?? null, tables: [] };
            if (template) {
              try {
                const spec = WeaveStarters.spec(template);
                const done = w.build(spec);
                if (!done.ok) throw new Error(done.errors.map((e) => e.error).join('; '));
                built.tables = spec.spaces[0].tables.map((t) => t.name);
                table = w.findTable(`${template.space}/${WeaveStarters.firstTable(template)}`)?.id ?? null;
              } catch (err) { templateError = err.message; }
            }
            w.markOnboarded(owner.id);
            const name = w.state.meta.name;
            const host = String(name).toLowerCase();
            const mcp = baseDomain ? `${scheme}//${host}.${baseDomain}/mcp` : `${originFor(rx)}/w/${encodeURIComponent(name)}/mcp`;
            return out(201, { name, title: w.state.meta.title ?? name, open: `/api/start/open/${encodeURIComponent(name)}`, table, mcp, built, templateError });
          }
          return notFound({ error: 'Not found', code: 'not-found' });
        }

        if (route === 'GET /api/workspaces/slug') {
          if (!role && !session && hub.get(hub.defaultName).state.meta.requireAuth) return deny(401, 'Sign in to check a workspace address');
          if (limited('slugs', clientIp(rx))) return out(429, { error: 'Too many checks: wait a minute and try again', code: 'rate-limited' });
          const slug = String(rx.searchParams?.get('slug') ?? '');
          return out(200, { slug, state: hub.slugState(slug), base: baseDomain }, { 'Cache-Control': 'no-store' });
        }

        if (route === 'GET /api/health/build') {
          if (!role) return deny(401, 'A workspace token is required');
          const serving = build() ?? {};
          const candidate = serving.servingSha ?? serving.sha;
          const sha = /^[a-f0-9]{40}$/.test(candidate ?? '') ? candidate : null;
          return out(200, { sha, version, ready: sha != null && serving.stale !== true }, { 'Cache-Control': 'no-store' });
        }
        if (route === 'GET /api/health') {
          if (!mayAdminister(weave, role)) return out(200, { ok: true, name: 'weave', ...(role ? { version } : {}) });
          const nightly = backup();
          return out(200, { ok: true, name: 'weave', version, workspace: weave.state.meta.name, startedAt: STARTED_AT, uptime: Math.round(uptime()), ...(build() ?? {}), ...weave.storageStats(), ...(nightly ? { backup: nightly } : {}) });
        }
        if (route === 'GET /api/schema') return out(200, weave.describeSchema());
        if (route === 'GET /api/ontology') {
          const q = (k) => rx.searchParams?.get(k) || null;
          return out(200, weave.ontology({ depth: q('depth') ?? 'outline', concept: q('concept'), since: q('since') }));
        }
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
          target.actor = actorForRequest;
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
          const rail = oidc ? String(cookies.wv_rail ?? '').split(',').filter(Boolean) : [];
          const heldOnRail = (x) => rail.includes(x.name.toLowerCase()) && !hub.get(x.name)?.state.meta.deletedAt;
          const hubRoot = hub.get(hub.defaultName);
          const manages = mayAdminister(hubRoot, roleOn(hubRoot));
          return out(200, hub.list({ includeDeleted }).filter((x) => canOpen(hub.get(x.name)) || heldOnRail(x))
            .map((x) => ({
              ...(canOpen(hub.get(x.name)) ? { ...x, deletable: x.deletable && manages } : { name: x.name, id: x.id, held: true, open: `${startRoot}/api/start/open/${encodeURIComponent(x.name)}` }),
              ...(baseDomain ? { host: `${scheme}//${x.name.toLowerCase()}.${baseDomain}/` } : {}),
            })));
        }
        if (route === 'POST /api/workspaces' && body?.from != null) {
          const source = String(body.from).match(/^backup:(.+)$/);
          if (!source) throw new WeaveError('from takes backup:<archive>, an archive GET /api/backups lists', 'invalid');
          if (body.key == null || body.key === '') throw new WeaveError('key is required: the passphrase the archive was sealed with', 'invalid');
          if (!cloudBackups) return out(400, { error: 'This deployment keeps no backups: it has no bucket configured.', code: 'invalid' });
          const hubRoot = hub.get(hub.defaultName);
          const bearer = authz && /^Bearer /i.test(authz) ? authz.slice(7).trim() : '';
          const caller = bearer ? hubRoot.verifyToken(bearer) : sessionOn(hubRoot);
          if (!caller) return deny(401, 'Migrating a backup needs an account on the hub root');
          const archive = await cloudBackups.get(caller.id, source[1]);
          const w = await hub.createFrom(body.name, { slug: body.slug ?? null, archive, key: body.key, workspace: body.workspace ?? null, actor: actorForRequest });
          return out(201, { name: w.state.meta.name, url: `/w/${w.state.meta.name}/`, from: `backup:${source[1]}`, entities: w.storageStats().entities });
        }
        if (route === 'POST /api/workspaces') {
          const w = hub.create(body.name, { slug: body.slug ?? null, actor: actorForRequest });
          return out(201, { name: w.state.meta.name, url: `/w/${w.state.meta.name}/` });
        }
        if ((m = path.match(/^\/api\/workspaces\/([^/]+)\/restore$/)) && rx.method === 'POST') {
          const w = hub.restore(m[1], { actor: actorForRequest });
          return out(200, { name: w.state.meta.name, deletedAt: null });
        }
        if ((m = path.match(/^\/api\/workspaces\/([^/]+)$/)) && rx.method === 'PATCH') {
          if (body?.position == null) throw new WeaveError('position is required: 0 is the first place in the rail', 'invalid');
          hub.get(hub.defaultName).moveWorkspace(decodeURIComponent(m[1]), body.position);
          return out(200, hub.list().filter((x) => canOpen(hub.get(x.name))));
        }
        if ((m = path.match(/^\/api\/workspaces\/([^/]+)$/)) && rx.method === 'DELETE') {
          if (!hub.remove) return out(400, { error: 'This deployment cannot delete workspaces' });
          const hard = ['1', 'true'].includes(rx.searchParams.get('hard') ?? '');
          if (hard) return out(200, hub.remove(m[1], { hard: true, actor: actorForRequest }));
          const w = hub.remove(m[1], { actor: actorForRequest });
          return out(200, { name: w.state.meta.name, deletedAt: w.state.meta.deletedAt });
        }


        if (path === '/api/onboarding') {
          const root = hub.get(hub.defaultName);
          const token = authz && /^Bearer /i.test(authz) ? weave.verifyToken(authz.slice(7).trim()) : null;
          const me = token ? { engine: weave, id: token.id, name: token.name }
            : session ? { engine: session.engine, id: session.id, name: session.name }
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
            if (taken(name)) throw new WeaveError(slugTaken(name).message, 'slug_taken');
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
          return out(200, { ...ws, url: `/w/${ws.id}/`, schemaVersion: weave.schemaVersion(), ...(oidc ? { start: `${startRoot}/start` } : {}) });
        }

        if (path === '/api/billing' || path === '/api/billing/team') {
          if (!billing) return notFound({ error: 'This deployment bills nobody: WEAVE_CLERK_SECRET_KEY and the plan slugs are not set.', code: 'billing-off' });
          const architect = (unseated ?? role) === 'architect' || mayAdminister(weave, unseated ?? role);
          const standingNow = async () => {
            const accounts = weave.listAccounts();
            const s = await billing.standing({ workspace: weave.billing(), accounts });
            return {
              plan: s.plan, trial: s.trial ?? null, seats: s.seats, orgId: s.orgId, soloPlan: billing.soloPlan, teamPlan: billing.teamPlan, publishableKey: billing.publishableKey,
              me: accountName, architect,
              members: accounts.map((a) => {
                const mail = a.identities?.find((i) => i.verifiedEmail)?.verifiedEmail ?? null;
                return { name: a.name, role: Weave.roleName(a.role), paid: PAID_ROLES.has(Weave.roleName(a.role)), seated: s.seated(a.name), ...(architect && mail ? { email: mail } : {}) };
              }),
            };
          };
          const answer = async (extra = {}) => {
            try { return out(200, { ...(await standingNow()), ...extra }, { 'Cache-Control': 'no-store' }); } catch (error) {
              if (!(error instanceof BillingUnavailable)) throw error;
              return out(503, { error: error.message, code: 'billing-unavailable' }, { 'Retry-After': '60', 'Cache-Control': 'no-store' });
            }
          };
          if (route === 'GET /api/billing') {
            if (!role && !unseated && !mayAdminister(weave, role)) return deny(401, 'Sign in to see this workspace\'s plan');
            return answer();
          }
          if (route === 'POST /api/billing/team') {
            if (!architect) return deny(role ? 403 : 401, 'Opening the team plan needs an architect');
            const me = weave.listAccounts().find((a) => a.name === accountName);
            const createdBy = me ? billing.subjectOf(me) : null;
            if (!createdBy) return out(400, { error: 'Your account has no sign-in identity at the billing provider, so it cannot own the team plan. Sign in with the provider first.', code: 'invalid' });
            weave.linkBillingOrg(await billing.ensureOrg({ workspace: weave.billing(), createdBy }));
            const synced = await remirror(weave);
            billing.forget();
            return answer(synced?.refused?.length ? { refused: synced.refused } : {});
          }
          return out(405, { error: 'Billing answers GET /api/billing and POST /api/billing/team', code: 'method-not-allowed' }, { Allow: 'GET, POST' });
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
        if ((m = path.match(/^\/api\/accounts\/([^/]+)$/)) && rx.method === 'PATCH') {
          const changed = weave.setAccountRole(decodeURIComponent(m[1]), body?.role);
          await remirror(weave);
          return out(200, changed);
        }
        if ((m = path.match(/^\/api\/accounts\/([^/]+)\/identities$/))) {
          const ref = decodeURIComponent(m[1]);
          if (rx.method === 'POST') {
            const made = weave.linkIdentity(ref, { issuer: body?.issuer ?? oidc?.issuer, email: body?.email });
            return out(201, { ...made, url: inviteUrl(`${originFor(rx)}${wsPrefix}`, made.code) });
          }
          if (rx.method === 'DELETE') return out(200, weave.unlinkIdentity(ref, { issuer: rx.searchParams?.get('issuer') ?? null, subject: rx.searchParams?.get('subject') }));
        }
        if ((m = path.match(/^\/api\/accounts\/(.+)$/)) && rx.method === 'DELETE') {
          const gone = weave.deleteAccount(decodeURIComponent(m[1]));
          await remirror(weave);
          return out(200, gone);
        }
        if (path.startsWith('/api/keys')) {
          const root = hub.get(hub.defaultName);
          const rootRole = roleOn(root);
          const km = /^\/api\/keys\/([^/]+)(\/reveal)?$/.exec(path);
          const reveal = !!km?.[2] && rx.method === 'POST';
          const target = route === 'POST /api/keys' ? body?.name
            : km && !km[2] && rx.method === 'DELETE' ? decodeURIComponent(km[1]) : null;
          const owns = !!rootRole && target != null && weave.listKeys().find((k) => k.name === target)?.owner === weave.actorName(actorForRequest);
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
            partial: !!body?.partial,
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
        if (route === 'GET /api/share') {
          if (!share) return out(404, { error: 'No share token on this request: send Authorization: Bearer wvs_…', code: 'not-found' });
          const { token, url, ...grant } = share;
          return out(200, grant);
        }
        if (path.startsWith('/api/shares') && !mayAdminister(weave, role)) return deny(role ? 403 : 401, 'Share links are minted, listed, renewed and revoked by an architect');
        if (route === 'GET /api/shares') return out(200, weave.listShares({ kind: rx.searchParams.get('kind'), id: rx.searchParams.get('id') }));
        if (route === 'POST /api/shares') return out(201, weave.mintShare(body ?? {}));
        if ((m = path.match(/^\/api\/shares\/([^/]+)$/)) && rx.method === 'DELETE') {
          return out(200, weave.revokeShare(decodeURIComponent(m[1])));
        }
        if ((m = path.match(/^\/api\/shares\/([^/]+)\/renew$/)) && rx.method === 'POST') {
          return out(200, weave.renewShare(decodeURIComponent(m[1])));
        }
        if (route === 'GET /api/views') return out(200, weave.listViews({ trash: ['1', 'true'].includes(rx.searchParams.get('trash') ?? '') }));
        if (route === 'POST /api/views') return out(201, weave.createView(body ?? {}));
        if ((m = path.match(/^\/api\/views\/([^/]+)$/))) {
          if (rx.method === 'GET') return out(200, weave.resolveView(m[1]));
          if (rx.method === 'DELETE') return out(200, weave.deleteView(m[1], { hard: ['1', 'true'].includes(rx.searchParams.get('hard') ?? '') }));
        }
        if ((m = path.match(/^\/api\/views\/([^/]+)\/restore$/)) && rx.method === 'POST') {
          return out(200, weave.restoreView(m[1]));
        }
        if ((m = path.match(/^\/api\/views\/([^/]+)\/share$/)) && ['POST', 'DELETE'].includes(rx.method)) {
          if (!mayAdminister(weave, role)) return deny(role ? 403 : 401, 'Sharing a view, or ending its link, needs an architect');
          return rx.method === 'POST' ? out(201, weave.shareView(m[1])) : out(200, weave.unshareView(m[1]));
        }
        if (route === 'GET /api/audit') {
          return out(200, weave.listAudit({
            limit: boundedLimit(rx.searchParams.get('limit'), 100),
            offset: Number(rx.searchParams.get('offset') ?? 0),
          }));
        }
        if (mcpDoor && rx.method !== 'POST') return out(405, { error: 'The MCP door takes POST: JSON-RPC in, JSON out, no stream', code: 'method-not-allowed' }, { Allow: 'POST' });
        if (route === 'POST /api/mcp') {
          const msgs = Array.isArray(body) ? body : [body];
          const root = hub.get(hub.defaultName);
          const seat = unseated ? `${seatRequired()} Billing: ${hostOrigin ?? mcpOrigin(rx)}${wsPrefix}/billing` : null;
          const caller = { role, root, rootRole: roleOn(root), updateWorkspace, useTemplate: useTemplateInto, seat };
          const replies = msgs.map((msg) => handleMcpMessage(weave, msg, { version, caller })).filter(Boolean);
          if (oauth) oauth.engine.noteAgent(oauth.account.id, rx.header('user-agent'));
          if (!replies.length) return { status: 202, headers: { 'Content-Type': 'application/json' }, body: '' };
          return out(200, Array.isArray(body) ? replies : replies[0]);
        }
        if (route === 'GET /api/undo') {
          return out(200, weave.listUndo({ limit: boundedLimit(rx.searchParams.get('limit'), 20) }));
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

        if (route === 'GET /api/forms/manage' || route === 'POST /api/forms' || (rx.method === 'PATCH' && /^\/api\/forms\/[^/]+$/.test(path))) {
          const registry = weave.registryHost ?? weave;
          const registryRole = roleOn(registry);
          if ((weave.state.meta.requireAuth && role == null) || (registry.state.meta.requireAuth && registryRole == null) || !mayAdminister(weave, role) || !mayAdminister(registry, registryRole)) return deny(role ? 403 : 401, 'Managing forms needs an architect on the workspace and its registry');
          if (route === 'GET /api/forms/manage') {
            const tableRef = rx.searchParams?.get('table');
            const table = tableRef ? weave.getTable(tableRef) : null;
            const forms = listForms(weave).filter(form => !table || form.tableId === table.id).map(form => getFormDefinition(weave, form.id));
            return out(200, { forms, anonymousAllowed: anonymousForms, requireAuth: !!weave.state.meta.requireAuth }, { 'Cache-Control': 'no-store' });
          }
          if (route === 'POST /api/forms') {
            if (body?.kind !== undefined) throw new WeaveError('The form builder creates row forms', 'invalid');
            const form = createForm(weave, body);
            return out(201, getFormDefinition(weave, form.id));
          }
          return out(200, updateForm(weave, decodeURIComponent(path.split('/').pop()), body));
        }

        if (route === 'GET /api/forms') {
          if (isDocsWorkspace(weave)) { try { ensureBugForm(weave); } catch {} }
          return out(200, listForms(weave));
        }
        if ((m = path.match(/^\/api\/forms\/([^/]+)$/)) && rx.method === 'GET') {
          const { form, admitted } = formFor(m[1]);
          if (!admitted) return deny(401, 'Sign in to open this form');
          return out(200, form);
        }
        const stamp = () => ({ version, startedAt: STARTED_AT, uptime: Math.round(uptime()), workspace: weave.state.meta.name });
        if (route === 'POST /api/workspace/leave') {
          refuseOnDocs(weave, 'left');
          const me = session && session.engine === weave && !session.visitor ? session : role ? weave.verifyToken(authz?.slice(7).trim() ?? '') : null;
          if (!me) return deny(401, 'Sign in to leave a workspace');
          const left = leaveWorkspace(weave, me.id);
          await remirror(weave);
          return out(200, left);
        }

        if (route === 'POST /api/bug-report') {
          const docs = hub.get('weave') ?? hub.get('weaver');
          const issues = docs && (() => { try { return docs.getTable('Development/Issue'); } catch { return null; } })();
          if (issues && role == null && !canOpen(docs)) return deny(401, 'The weave docs workspace requires authentication');
          const target = bugForwardTarget();
          let forwardFailure = null;
          if (target) {
            const sent = await forwardBugReport(target, body && typeof body === 'object' && !Array.isArray(body) ? body : {}, origin || process.env.WEAVE_ORIGIN || String(rx.header('host') ?? 'unknown'));
            if (sent.ok) return out(201, { ...sent.data, forwardedTo: target.url });
            forwardFailure = { url: target.url, reason: sent.reason };
          }
          const failed = forwardFailure ? { forward: 'failed', forwardError: forwardFailure.reason } : {};
          if (!issues) {
            return out(501, { error: 'No Development/Issue table to file into — this instance has no weave docs workspace', code: 'unsupported', ...failed });
          }
          docs.maybeRefresh();
          const form = ensureBugForm(docs);
          const instance = role != null && typeof body?.instance === 'string' && body.instance.trim() ? body.instance.trim().slice(0, 200) : null;
          const filed = submitForm(docs, form.id, body ?? {}, { actor: role == null ? 'bug-report' : actorForRequest, server: { ...stamp(), instance, forwardFailure } });
          return out(201, { ...filed, ...failed });
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
          return out(200, dbs.map((db) => ({ id: db.id, name: db.name, qualified: weave.qualifiedName(db), spaceId: db.spaceId, position: db.position })));
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
          return out(200, weave.moveTable(m[1], body.space, { position: body.position ?? null }));
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
            const entry = weave.fieldChangeSince(m[1], field.id, seq);
            return out(200, { ...guided(weave, 'field', field, body?.type == null ? body?.config : {}), activity: entry?.id ?? null, lossy: !!entry?.detail.lossy,
              ...(entry?.detail.formulas ? { formulas: entry.detail.formulas } : {}) });
          }
          if (rx.method === 'DELETE') {
            weave.deleteField(m[1], m[2], { hard: ['1', 'true'].includes(rx.searchParams.get('hard') ?? '') });
            return out(200, { ok: true });
          }
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/fields\/([^/]+)\/restore$/)) && rx.method === 'POST') {
          return out(200, weave.restoreField(m[1], decodeURIComponent(m[2])));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/fields\/([^/]+)\/rollback$/)) && rx.method === 'POST') {
          return out(200, weave.rollbackFieldConfig(body?.activity, { table: m[1], field: m[2], via: body?.via }));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/relations$/)) && rx.method === 'POST') {
          return out(201, weave.addRelation(m[1], body));
        }

        if ((m = path.match(/^\/api\/tables\/([^/]+)\/entities$/))) {
          if (rx.method === 'POST') {
            if (weave !== member && ['spaces', 'users', 'workflows'].includes(weave.findTable(m[1])?.system)) {
              const values = body.values ?? body;
              if (values.Workspace == null) values.Workspace = member.state.meta.id;
            }
            const e = weave.createEntity(m[1], body);
            const once = weave.takeOneTime(e.id);
            const secret = once?.invite ? { invite: { ...once.invite, url: inviteUrl(`${originFor(rx)}${wsPrefix}`, once.invite.code) } } : once ?? {};
            return out(201, { ...weave.readEntity(e.id, { viewerZone }), ...secret });
          }
          if (rx.method === 'GET') {
            const limit = boundedLimit(rx.searchParams.get('limit'));
            const offset = Number(rx.searchParams.get('offset') ?? 0);
            return out(200, weave.query(m[1], { limit, offset, viewerZone, workspace: member.state.meta.id }));
          }
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/prefill$/)) && rx.method === 'GET') {
          return out(200, prefillDraft(weave, m[1], rx.searchParams));
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/query$/)) && rx.method === 'POST') {
          if (body?.limit != null) body.limit = boundedLimit(body.limit);
          return out(200, weave.query(m[1], { ...body, viewerZone, workspace: member.state.meta.id }));
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
          const items = weave.listTrash(null, { workspace: member.state.meta.id });
          return out(200, { total: items.length, items, views: weave.listViews({ trash: true }), purge: !cap || cap === 'architect' || cap === 'editor' });
        }
        if ((m = path.match(/^\/api\/tables\/([^/]+)\/trash$/)) && rx.method === 'GET') {
          const items = weave.listTrash(m[1], { workspace: member.state.meta.id });
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
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/conditional$/)) && rx.method === 'POST') return out(200, weave.conditionalWrite(m[1], body));
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/state$/)) && rx.method === 'POST') {
          weave.setState(m[1], body.field, body.state);
          return out(200, weave.readEntity(m[1], { viewerZone }));
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/doc\/revisions$/)) && rx.method === 'GET') {
          const fieldRef = rx.searchParams.get('field') ?? null;
          return out(200, weave.listDocRevisions(m[1], fieldRef, { limit: boundedLimit(rx.searchParams.get('limit'), 50) }));
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
          return out(201, weave.attachToField(m[1], decodeURIComponent(m[2]), { name: body.name, mime: body.mime, bytes: body.bytes ?? body.contentBase64, preview: previewInput(body.preview) }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/files$/)) && rx.method === 'POST') {
          return out(201, weave.attachFile(m[1], { name: body.name, mime: body.mime, bytes: body.contentBase64, preview: previewInput(body.preview) }));
        }
        if ((m = path.match(/^\/api\/entities\/([^/]+)\/files\/([^/]+)$/)) && rx.method === 'DELETE') {
          weave.deleteFile(m[1], m[2]);
          return out(200, { ok: true });
        }
        if ((m = path.match(/^\/api\/files\/([^/]+)$/)) && rx.method === 'GET') {
          const { meta, bytes } = weave.readFile(m[1], { preview: rx.searchParams?.has('preview') ?? false });
          return out(200, bytes, fileHeaders(meta, bytes, { view: rx.searchParams?.has('view') ?? false }));
        }

        if ((m = path.match(/^\/api\/entities\/([^/]+)\/comments$/)) && rx.method === 'POST') {
          return out(201, weave.addComment(m[1], (role ? !['architect', 'editor'].includes(role) : guarded()) ? { ...body, author: actorForRequest } : body));
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
            limit: boundedLimit(rx.searchParams.get('limit')),
            offset: Number(rx.searchParams.get('offset') ?? 0),
          }));
        }
        if ((m = path.match(/^\/api\/activity\/(.+)$/)) && rx.method === 'GET') {
          return out(200, weave.getActivity(decodeURIComponent(m[1])));
        }

        if (route === 'GET /api/search') {
          const q = rx.searchParams.get('q') ?? '';
          const limit = boundedLimit(rx.searchParams.get('limit'), 25);
          const tables = rx.searchParams.get('tables');
          if (tables != null) {
            return out(200, weave.universalSearch(q, { limit, prefix: wsPrefix, tables: tables.split(',').map((t) => t.trim()).filter(Boolean) }));
          }
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
      const json = errorBody(err, 'internal');
      return status === 404 ? notFound(json) : out(status, json, status === 429 ? { 'Retry-After': '60' } : {});
    }
  };

  return async function handle(rx) {
    const jar = [];
    return withCookies(await respond(rx, jar), jar);
  };
}
