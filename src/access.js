import { AsyncLocalStorage } from 'node:async_hooks';

export const SPACE_ACCESS = ['open', 'private'];
export const RANK = { observer: 0, editor: 1, architect: 2 };
const OLD = { admin: 'architect', writer: 'editor', reader: 'observer' };
const named = (role) => OLD[role] ?? role ?? null;
const own = (o, k) => (o && k != null && Object.hasOwn(o, k) ? o[k] : undefined);
export const lower = (a, b) => (a == null || b == null ? null : RANK[a] <= RANK[b] ? a : b);
export const higher = (a, b) => (a == null ? b : b == null ? a : RANK[a] >= RANK[b] ? a : b);

const requests = new AsyncLocalStorage();
export const ANONYMOUS = Object.freeze({ accountId: null, role: 'observer' });

export const withViewers = (holder, fn) => requests.run(holder, fn);
export const unrestricted = (fn) => requests.run(null, fn);

export function viewerOf(engine) {
  const holder = requests.getStore();
  if (!holder?.of) return null;
  const viewer = holder.of(engine);
  return viewer === undefined ? ANONYMOUS : viewer;
}

export function viewerFor(account, { unseated = false } = {}) {
  if (!account) return ANONYMOUS;
  return {
    accountId: account.accountId ?? account.id ?? null,
    role: named(account.role) ?? 'observer',
    space: account.space ?? null,
    issuedBy: account.issuedBy ?? null,
    ...(unseated ? { unseated: true } : {}),
  };
}

const accountOf = (weave, id) => own(weave.state.meta.accounts, id) ?? null;
const issuerOf = (weave, viewer) => {
  if (!viewer.issuedBy) return undefined;
  const a = accountOf(weave, viewer.issuedBy);
  return a ? viewerFor(a) : null;
};

export function workspaceRole(weave, viewer, depth = 0) {
  if (!viewer) return 'architect';
  if (viewer.share) return null;
  let role = named(viewer.role);
  if (viewer.space) role = lower(role, 'editor');
  if (viewer.unseated) role = lower(role, 'observer');
  const issuer = issuerOf(weave, viewer);
  if (issuer === null || depth > 8) return null;
  if (issuer) role = lower(role, workspaceRole(weave, issuer, depth + 1));
  return role;
}

export function spaceRole(weave, viewer, sp, depth = 0) {
  if (!viewer) return 'architect';
  if (!sp) return null;
  if (viewer.share) return grantReaches(weave, viewer.share, sp) ? (['edit', 'manage'].includes(viewer.share.mode) ? 'editor' : 'observer') : null;
  if (sp.system) return viewer.space ? 'observer' : workspaceRole(weave, viewer, depth);
  if (viewer.space && viewer.space !== sp.id) return null;
  const base = named(viewer.role);
  const member = viewer.accountId ? own(sp.members, viewer.accountId) : undefined;
  const admitted = base === 'architect' || member || viewer.space === sp.id || sp.access !== 'private';
  if (!admitted) return null;
  let role = base === 'architect' ? base : named(member?.role) ?? base;
  if (viewer.unseated) role = lower(role, 'observer');
  const issuer = issuerOf(weave, viewer);
  if (issuer === null || depth > 8) return null;
  if (issuer) role = lower(role, spaceRole(weave, issuer, sp, depth + 1));
  return role;
}

export function topRole(weave, viewer) {
  let role = workspaceRole(weave, viewer);
  for (const sp of Object.values(weave.state.spaces)) {
    if (!sp.deletedAt && !sp.system) role = higher(role, spaceRole(weave, viewer, sp));
  }
  return role;
}

export function seatRole(weave, account) {
  let role = named(account.role);
  for (const sp of Object.values(weave.state.spaces)) {
    const m = own(sp.members, account.id);
    if (!sp.deletedAt && m?.role) role = higher(role, named(m.role));
  }
  return role;
}

const ACCOUNT = /^account:([0-9a-f-]{36})(?: via MCP)?$/;

export function grantReaches(weave, grant, sp) {
  if (!sp || sp.access !== 'private') return true;
  if (grant?.scope?.kind === 'workspace') return false;
  const stored = own(weave.state.meta.shares, grant?.id) ?? grant;
  const by = ACCOUNT.exec(String(stored?.createdBy ?? ''))?.[1];
  if (!by) return true;
  const issuer = accountOf(weave, by);
  return !!issuer && spaceRole(weave, viewerFor(issuer), sp) != null;
}
