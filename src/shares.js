import { randomBytes } from 'node:crypto';
import { uuid } from './ids.js';
import { WeaveError } from './store.js';
import { renderDocumentPage } from './markdown.js';

export const SHARE_KINDS = ['entity', 'table', 'space', 'view', 'workspace'];
export const SHARE_MODES = ['read', 'comment', 'edit', 'manage'];
export const SHARE_VISIBILITIES = ['public', 'private'];
const RUNG = { read: 0, comment: 1, edit: 2, manage: 3 };
const TOKEN = /^wv[sv]_[A-Za-z0-9_-]{16,}$/;

const own = (map, id) => (map && typeof id === 'string' && Object.hasOwn(map, id) ? map[id] : null);
const nowMs = (weave) => (typeof weave.now === 'function' ? weave.now() : new Date()).getTime();
const views = (weave) => weave.state.meta.views ?? {};

const liveSpace = (weave, id) => {
  const sp = own(weave.state.spaces, id);
  return sp && !sp.deletedAt && !sp.system ? sp : null;
};
const liveTable = (weave, id) => {
  const db = own(weave.state.tables, id);
  return db && !db.deletedAt && !db.system && liveSpace(weave, db.spaceId) ? db : null;
};
const liveEntity = (weave, id) => {
  const e = own(weave.state.entities, id);
  return e && !e.deletedAt && liveTable(weave, e.dbId) ? e : null;
};

const invalid = (msg) => new WeaveError(msg, 'invalid');
const registry = (what) => invalid(`${what} belongs to the system registry; a share reaches the rows people made`);
const gone = (what, ref) => new WeaveError(`${what} '${ref}' not found`, 'not-found');

function resolveScope(weave, scope) {
  const kind = scope?.kind;
  if (!SHARE_KINDS.includes(kind)) throw invalid(`A share's scope.kind is one of ${SHARE_KINDS.join(', ')}; got ${JSON.stringify(kind ?? null)}`);
  if (kind === 'workspace') return { kind, id: weave.state.meta.id };
  const ref = scope.id == null ? '' : String(scope.id);
  if (!ref) throw invalid(`Name the ${kind} to share in scope.id`);
  if (kind === 'entity') {
    const e = weave.getEntity(ref);
    if (e.deletedAt) throw gone('Entity', ref);
    if (!liveEntity(weave, e.id)) throw registry(`Entity '${ref}'`);
    return { kind, id: e.id };
  }
  if (kind === 'table') {
    const db = weave.getTable(ref);
    if (db.deletedAt) throw gone('Table', ref);
    if (!liveTable(weave, db.id)) throw registry(`Table '${ref}'`);
    return { kind, id: db.id };
  }
  if (kind === 'space') {
    const sp = weave.getSpace(ref);
    if (!liveSpace(weave, sp.id)) throw registry(`Space '${ref}'`);
    return { kind, id: sp.id };
  }
  return { kind, id: weave.getView(ref).id };
}

function alive(weave, scope) {
  switch (scope?.kind) {
    case 'entity': return !!liveEntity(weave, scope.id);
    case 'table': return !!liveTable(weave, scope.id);
    case 'space': return !!liveSpace(weave, scope.id);
    case 'view': return !!own(views(weave), scope.id);
    case 'workspace': return scope.id === weave.state.meta.id;
    default: return false;
  }
}

const live = (weave, g) => !!g?.token && !g.revokedAt && !(g.expiresAt && Date.parse(g.expiresAt) <= nowMs(weave)) && alive(weave, g.scope);

export function scopeTitle(weave, scope) {
  try {
    switch (scope.kind) {
      case 'entity': {
        const e = weave.getEntity(scope.id);
        const db = weave.state.tables[e.dbId];
        const name = weave.entityName(e).trim();
        return `${db.name} #${e.publicId}${name ? ` · ${name}` : ''}`;
      }
      case 'table': return weave.qualifiedName(weave.getTable(scope.id));
      case 'space': return weave.getSpace(scope.id).name;
      case 'view': return weave.getView(scope.id).name;
      default: return weave.state.meta.title ?? weave.state.meta.name ?? 'workspace';
    }
  } catch {
    return null;
  }
}

const publicGrant = (weave, g) => ({ ...g, scope: { ...g.scope }, url: `/s/${g.token}`, title: scopeTitle(weave, g.scope) });

export function mint(weave, { scope, mode = 'read', visibility = 'public', label = '', expiresAt = null } = {}) {
  const target = resolveScope(weave, scope);
  if (!SHARE_MODES.includes(mode)) throw invalid(`A share's mode is one of ${SHARE_MODES.join(', ')}; got ${JSON.stringify(mode)}`);
  if (mode === 'comment') throw new WeaveError('Comment links wait for comments by share; mint read, edit or manage for now', 'forbidden');
  if (!SHARE_VISIBILITIES.includes(visibility)) throw invalid(`A share's visibility is public or private; got ${JSON.stringify(visibility)}`);
  let expires = null;
  if (expiresAt != null && expiresAt !== '') {
    const at = Date.parse(expiresAt);
    if (Number.isNaN(at) || at <= nowMs(weave)) throw invalid(`expiresAt is a date in the future; got ${JSON.stringify(expiresAt)}`);
    expires = new Date(at).toISOString();
  }
  const grant = {
    id: uuid(),
    token: 'wvs_' + randomBytes(24).toString('base64url'),
    scope: target,
    mode,
    visibility,
    label: String(label ?? '').trim().slice(0, 120),
    createdBy: weave.actor ?? null,
    createdAt: new Date().toISOString(),
    expiresAt: expires,
    revokedAt: null,
  };
  (weave.state.meta.shares ??= {})[grant.id] = grant;
  return publicGrant(weave, grant);
}

export function list(weave, { kind = null, id = null } = {}) {
  return Object.values(weave.state.meta.shares ?? {})
    .filter((g) => live(weave, g) && (!kind || g.scope.kind === kind) && (!id || g.scope.id === id))
    .map((g) => publicGrant(weave, g));
}

export function byToken(weave, token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const g = Object.values(weave.state.meta.shares ?? {}).find((x) => x.token === token);
  return live(weave, g) ? publicGrant(weave, g) : null;
}

export function revoke(weave, id, { any = true } = {}) {
  const g = own(weave.state.meta.shares, id);
  if (!g) throw gone('Share', id);
  if (!any && g.createdBy !== weave.actor) throw new WeaveError('An editor revokes the links it made; an architect revokes any', 'forbidden');
  if (g.revokedAt) return { grant: publicGrant(weave, g), changed: false };
  g.revokedAt = new Date().toISOString();
  return { grant: publicGrant(weave, g), changed: true };
}

export const auditDetail = (g) => ({ kind: g.scope.kind, scope: g.title ?? g.scope.id, mode: g.mode, visibility: g.visibility, ...(g.label ? { label: g.label } : {}) });

export function liftViewShares(state) {
  let changed = false;
  for (const v of Object.values(state.meta?.views ?? {})) {
    if (!v.shareToken) continue;
    const shares = (state.meta.shares ??= {});
    if (!Object.values(shares).some((g) => g.token === v.shareToken)) {
      const id = uuid();
      shares[id] = {
        id, token: v.shareToken, scope: { kind: 'view', id: v.id }, mode: 'read', visibility: 'public',
        label: v.name ?? '', createdBy: v.createdBy ?? null, createdAt: v.createdAt ?? new Date().toISOString(),
        expiresAt: null, revokedAt: null,
      };
    }
    delete v.shareToken;
    changed = true;
  }
  return changed;
}

export function redactTokens(out) {
  for (const g of Object.values(out.meta?.shares ?? {})) delete g.token;
}

export function keepTokens(meta, prior) {
  for (const g of Object.values(meta.shares ?? {})) {
    const was = own(prior?.shares, g.id);
    if (g.token === undefined && was?.token) g.token = was.token;
  }
}

export function withinScope(weave, grant, { spaceId = null, tableId = null, entityId = null, viewId = null } = {}) {
  const scope = grant?.scope;
  if (!scope) return false;
  let e = null;
  let db = null;
  let sp = null;
  if (entityId != null) {
    e = liveEntity(weave, entityId);
    if (!e) return false;
    tableId = e.dbId;
  }
  if (tableId != null) {
    db = liveTable(weave, tableId);
    if (!db) return false;
    spaceId = db.spaceId;
  }
  if (spaceId != null) {
    sp = liveSpace(weave, spaceId);
    if (!sp) return false;
  }
  if (viewId != null && !own(views(weave), viewId)) return false;
  if (!sp && viewId == null) return false;
  switch (scope.kind) {
    case 'workspace': return scope.id === weave.state.meta.id;
    case 'space': return !!sp && sp.id === scope.id;
    case 'table': return !!db && db.id === scope.id;
    case 'entity': return !!e && e.id === scope.id;
    case 'view': {
      if (viewId != null) return viewId === scope.id && !db;
      const v = own(views(weave), scope.id);
      if (!v || !db) return false;
      const blocks = (v.blocks ?? []).filter((b) => b.dbId === db.id);
      if (!blocks.length) return false;
      if (!e) return true;
      return blocks.some((b) => !b.where?.length || weave.query(db.id, { where: b.where }).items.some((x) => x.id === e.id));
    }
    default: return false;
  }
}

function inScopeOf(weave, grant, db) {
  const { kind, id } = grant.scope;
  if (kind === 'entity') return (eid) => eid === id && !!liveEntity(weave, eid);
  if (!withinScope(weave, grant, { tableId: db.id })) return () => false;
  const blocks = kind === 'view' ? (own(views(weave), id)?.blocks ?? []).filter((b) => b.dbId === db.id) : [];
  if (kind !== 'view' || blocks.some((b) => !b.where?.length)) return (eid) => !!liveEntity(weave, eid);
  const ids = new Set(blocks.flatMap((b) => weave.query(db.id, { where: b.where }).items.map((x) => x.id)));
  return (eid) => ids.has(eid) && !!liveEntity(weave, eid);
}

const touches = (weave, grant, db) => withinScope(weave, grant, { tableId: db.id })
  || (grant.scope.kind === 'entity' && liveEntity(weave, grant.scope.id)?.dbId === db.id);

export function shareDoor(path, authz) {
  const m = path.match(/^\/s\/(wv[sv]_[A-Za-z0-9_-]+)(\/.*)?$/);
  if (m) return { token: m[1], rest: m[2] ?? '', page: true };
  if (authz && /^Bearer\s+wvs_/i.test(authz)) {
    return { token: authz.replace(/^Bearer\s+/i, '').trim(), rest: path, page: !path.startsWith('/api/') };
  }
  return null;
}

const answer = (status, data) => ({ status, data });
const refuse = (status, error) => answer(status, { error, code: status === 404 ? 'not-found' : 'forbidden' });
const missing = () => refuse(404, 'Not found');
const OUTSIDE = 'A share link reaches the rows, documents and files in its scope, nothing else';

export function shareGate(weave, grant, { method, path, body = {}, searchParams = null, viewerZone = null }) {
  const rung = RUNG[grant.mode] ?? 0;
  const read = method === 'GET' || method === 'HEAD';
  const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
  const entityIn = (ref) => {
    try {
      const e = weave.getEntity(decode(ref));
      return withinScope(weave, grant, { entityId: e.id }) ? e : null;
    } catch { return null; }
  };
  const tableOf = (ref) => { try { return weave.getTable(decode(ref)); } catch { return null; } };
  let m;
  if (path === '/api/share' && read) return null;
  if (path === '/api/markdown' && method === 'POST') return null;
  if (path === '/api/tables' && read) {
    return answer(200, weave.listTables().filter((db) => touches(weave, grant, db))
      .map((db) => ({ id: db.id, name: db.name, qualified: weave.qualifiedName(db), spaceId: db.spaceId })));
  }
  if (path === '/api/spaces' && read) {
    return answer(200, weave.listSpaces().filter((sp) => weave.listTables(sp.id).some((db) => touches(weave, grant, db))));
  }
  if ((m = path.match(/^\/api\/tables\/([^/]+)$/)) && read) {
    const db = tableOf(m[1]);
    return db && touches(weave, grant, db) ? null : missing();
  }
  if ((m = path.match(/^\/api\/tables\/([^/]+)\/(entities|query)$/))) {
    const db = tableOf(m[1]);
    if (!db || !touches(weave, grant, db)) return missing();
    if (m[2] === 'entities' && method === 'POST') {
      if (!withinScope(weave, grant, { tableId: db.id })) return refuse(403, 'This share link reaches one row; it cannot add rows beside it');
      return rung >= RUNG.manage ? null : refuse(403, `A ${grant.mode} link cannot add rows; that takes manage`);
    }
    if (!(m[2] === 'entities' ? read : method === 'POST')) return refuse(403, OUTSIDE);
    const opts = m[2] === 'query'
      ? { ...(body ?? {}), includeDeleted: false, viewerZone }
      : {
        limit: searchParams?.has('limit') ? Number(searchParams.get('limit')) : null,
        offset: Number(searchParams?.get('offset') ?? 0),
        viewerZone,
      };
    const res = weave.query(db.id, opts);
    const inScope = inScopeOf(weave, grant, db);
    const items = (res.items ?? []).filter((x) => inScope(x.id));
    return answer(200, { ...res, items, total: items.length === (res.items ?? []).length ? res.total : items.length });
  }
  if ((m = path.match(/^\/api\/files\/([^/]+)$/)) && read) {
    const owner = Object.values(weave.state.entities).find((e) => (e.files ?? []).some((f) => f.id === m[1]));
    return owner && withinScope(weave, grant, { entityId: owner.id }) ? null : missing();
  }
  if ((m = path.match(/^\/api\/entities\/([^/]+)(?:\/(doc|state|link|unlink|comments(?:\/[^/]+)?))?$/))) {
    const tail = m[2] ?? '';
    if (tail.startsWith('comments')) return refuse(403, 'Comments by share link are not built yet');
    if (!entityIn(m[1])) return missing();
    if (read && (tail === '' || tail === 'doc')) return null;
    if (method === 'DELETE' && tail === '') {
      if (rung < RUNG.manage) return refuse(403, `A ${grant.mode} link cannot delete rows; that takes manage`);
      return searchParams?.get('hard') ? refuse(403, 'A share link moves rows to the trash; it never purges them') : null;
    }
    const writes = (tail === '' && method === 'PATCH') || (tail === 'doc' && ['PUT', 'POST'].includes(method))
      || (['state', 'link', 'unlink'].includes(tail) && method === 'POST');
    if (!writes) return refuse(403, OUTSIDE);
    return rung >= RUNG.edit ? null : refuse(403, `A ${grant.mode} link cannot change rows; that takes edit`);
  }
  return refuse(403, OUTSIDE);
}

const cellText = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.name ?? '' : x)).join(', ');
  if (typeof v === 'object') return v.name ?? '';
  return String(v);
};
const md = (s) => String(s).replace(/\|/g, '¦').replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')')).replace(/\r?\n/g, ' ');

function rowsTable(weave, db, items, base) {
  const cols = db.fieldOrder.map((id) => db.fields[id]).filter((f) => f && f.type !== 'document' && f.type !== 'view');
  if (!items.length) return '_No rows._';
  const lines = [`| ${cols.map((f) => md(f.name)).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`];
  for (const item of items) {
    const e = weave.readEntity(item.id);
    lines.push(`| ${cols.map((f) => {
      const text = md(cellText(e.fields[f.name]));
      return f.id === db.nameFieldId ? `[${text || `#${e.publicId}`}](${base}/e/${e.id}/entity.html)` : text;
    }).join(' | ')} |`);
  }
  return lines.join('\n');
}

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const FOOT = '\n\n_Shared read-only from a weave workspace._';

function page(title, subtitle, markdown) {
  return renderDocumentPage({ title, subtitle, markdown: markdown + FOOT });
}

const rowsIn = (weave, grant, db, where = null) => {
  const inScope = inScopeOf(weave, grant, db);
  return weave.query(db.id, where?.length ? { where } : {}).items.filter((x) => inScope(x.id));
};

export function sharePage(weave, grant, rest, { method, prefix = '' }) {
  if (method !== 'GET' && method !== 'HEAD') return { status: 405 };
  const base = `${prefix}/s/${grant.token}`;
  const { kind, id } = grant.scope;
  if (rest === '' || rest === '/') {
    const to = { entity: `/e/${id}/entity.html`, table: `/table/${id}`, space: `/space/${id}`, view: `/view/${id}`, workspace: '/workspace' }[kind];
    return { redirect: base + to };
  }
  let m;
  if ((m = rest.match(/^\/e\/([^/]+)\/((?:doc(?:\/[^/]+)?|entity)\.(?:md|mmd|html|pdf)|deck\.html)$/))) {
    let e;
    try { e = weave.getEntity(decodeURIComponent(m[1])); } catch { return { status: 404 }; }
    return withinScope(weave, grant, { entityId: e.id }) ? { path: `/e/${e.id}/${m[2]}` } : { status: 404 };
  }
  if ((m = rest.match(/^\/table\/([^/]+)$/))) {
    const db = liveTable(weave, m[1]);
    if (!db || !withinScope(weave, grant, { tableId: db.id })) return { status: 404 };
    const items = rowsIn(weave, grant, db);
    const space = weave.state.spaces[db.spaceId]?.name;
    return { html: page(db.name, `${space} • ${count(items.length, 'row')}`, rowsTable(weave, db, items, base)) };
  }
  if ((m = rest.match(/^\/space\/([^/]+)$/))) {
    const sp = liveSpace(weave, m[1]);
    if (!sp || !withinScope(weave, grant, { spaceId: sp.id })) return { status: 404 };
    const tables = weave.listTables(sp.id).filter((db) => withinScope(weave, grant, { tableId: db.id }));
    const lines = tables.map((db) => `- [${md(db.name)}](${base}/table/${db.id}) · ${count(rowsIn(weave, grant, db).length, 'row')}`);
    return { html: page(sp.name, count(tables.length, 'table'), lines.join('\n') || '_No tables._') };
  }
  if ((m = rest.match(/^\/view\/([^/]+)$/))) {
    if (!withinScope(weave, grant, { viewId: m[1] })) return { status: 404 };
    const v = own(views(weave), m[1]);
    const blocks = (v.blocks ?? []).map((b) => {
      const db = liveTable(weave, b.dbId);
      if (!db) return '## (deleted table)\n\n_No rows._';
      return `## ${md(weave.qualifiedName(db))}\n\n${rowsTable(weave, db, rowsIn(weave, grant, db, b.where), base)}`;
    });
    return { html: page(v.name, count(blocks.length, 'block'), blocks.join('\n\n')) };
  }
  if (rest === '/workspace' && kind === 'workspace') {
    const spaces = weave.listSpaces().filter((sp) => liveSpace(weave, sp.id));
    const lines = spaces.map((sp) => `- [${md(sp.name)}](${base}/space/${sp.id}) · ${count(weave.listTables(sp.id).filter((db) => liveTable(weave, db.id)).length, 'table')}`);
    const ws = weave.state.meta;
    return { html: page(ws.title ?? ws.name ?? 'workspace', count(spaces.length, 'space'), lines.join('\n') || '_No spaces._') };
  }
  return { status: 404 };
}

export function scopedMention(weave, grant, plain, base) {
  return (kind, ref) => {
    try {
      if (kind === 'workspace') return grant.scope.kind === 'workspace' ? { ...plain(kind, ref), href: `${base}/workspace` } : null;
      if (kind === 'space') {
        const sp = weave.findSpace(ref);
        return sp && withinScope(weave, grant, { spaceId: sp.id }) ? { ...plain(kind, ref), href: `${base}/space/${sp.id}` } : null;
      }
      if (kind === 'table') {
        const db = weave.findTable(ref);
        return db && withinScope(weave, grant, { tableId: db.id }) ? { ...plain(kind, ref), href: `${base}/table/${db.id}` } : null;
      }
      const e = weave.getEntity(ref);
      if (!withinScope(weave, grant, { entityId: e.id })) return null;
      const hit = plain(kind, ref);
      return hit ? { ...hit, href: `${base}/e/${e.id}/doc.html` } : null;
    } catch {
      return null;
    }
  };
}
