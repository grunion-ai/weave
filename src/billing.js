import { WeaveError } from './store.js';

export const CLERK_API = 'https://api.clerk.com/v1';
export const PAID_ROLES = new Set(['editor', 'architect']);
export const FRESH_MS = 60_000;
export const STALE_MS = 15 * 60_000;
export const DAY_MS = 86_400_000;
export const TRIAL_DAYS = 14;
const ORG_ROLE = { architect: 'org:admin', editor: 'org:member' };
const PAGE = 500;

export class BillingUnavailable extends Error {
  constructor(cause) {
    super('Clerk Billing did not answer, so seats cannot be checked right now');
    this.name = 'BillingUnavailable';
    this.cause = cause;
  }
}

export function admits(item, at) {
  const status = item?.status;
  if (status === 'active' || status === 'past_due') return true;
  if (status === 'canceled') return typeof item.period_end === 'number' && at < item.period_end;
  if (status === 'ended' || status === 'expired') return item.past_due_at != null && item.canceled_at == null;
  return false;
}

const covers = (subscription, slug, at) => (subscription?.subscription_items ?? []).some((item) => item?.plan?.slug === slug && admits(item, at));

export function billingFromEnv(env = process.env, opts = {}) {
  const secretKey = String(env.WEAVE_CLERK_SECRET_KEY ?? '').trim();
  const plan = String(env.WEAVE_BILLING_PLAN ?? '').trim();
  if (!secretKey || !plan) return null;
  const rawSince = String(env.WEAVE_BILLING_SINCE ?? '').trim();
  const since = rawSince ? Date.parse(rawSince) : 0;
  if (Number.isNaN(since)) throw new WeaveError(`WEAVE_BILLING_SINCE must be a date like 2026-10-16T00:00:00Z (got '${rawSince}')`, 'invalid');
  const rawDays = String(env.WEAVE_TRIAL_DAYS ?? '').trim();
  const trialDays = rawDays ? Number(rawDays) : TRIAL_DAYS;
  if (!Number.isInteger(trialDays) || trialDays < 0) throw new WeaveError(`WEAVE_TRIAL_DAYS must be a whole number of days, 0 for no trial (got '${rawDays}')`, 'invalid');
  const issuer = String(env.WEAVE_OIDC_ISSUER ?? '').trim().replace(/\/+$/, '');
  const publishableKey = String(env.WEAVE_CLERK_PUBLISHABLE_KEY ?? '').trim() || null;
  return createBilling({ secretKey, plan, since, trialDays, issuer, publishableKey, ...opts });
}

export function trialOf(workspace, trialDays, at) {
  const from = Date.parse(workspace?.trialFrom ?? '');
  if (!trialDays || Number.isNaN(from)) return null;
  const ends = from + trialDays * DAY_MS;
  return at < ends ? { endsAt: new Date(ends).toISOString(), daysLeft: Math.ceil((ends - at) / DAY_MS) } : null;
}

export function createBilling({ secretKey, plan, since = 0, trialDays = TRIAL_DAYS, issuer = '', publishableKey = null, fetch = globalThis.fetch, now = Date.now }) {
  const cache = new Map();

  async function api(method, path, body) {
    const res = await fetch(`${CLERK_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error(`Clerk answered ${res.status} at ${method} ${path.split('?')[0]}${json?.errors?.[0]?.code ? `: ${json.errors[0].code}` : ''}`);
      error.status = res.status;
      error.code = json?.errors?.[0]?.code ?? null;
      throw error;
    }
    return json;
  }

  const subscription = (kind, id) => api('GET', `/${kind}/${encodeURIComponent(id)}/billing/subscription`).catch((error) => {
    if (error.status === 404) return null;
    throw error;
  });

  async function members(orgId) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await api('GET', `/organizations/${encodeURIComponent(orgId)}/memberships?limit=${PAGE}&offset=${offset}`);
      const data = page?.data ?? [];
      out.push(...data);
      if (data.length < PAGE) return out;
    }
  }

  const subjectOf = (account) => (account.identities ?? []).find((i) => !issuer || i.issuer === issuer)?.subject ?? null;
  const seatsOf = (accounts) => accounts.filter((a) => PAID_ROLES.has(a.seatRole ?? a.role) && subjectOf(a));

  async function lookup(workspace, accounts) {
    const seats = seatsOf(accounts);
    const orgId = workspace.billing?.orgId ?? null;
    if (orgId && covers(await subscription('organizations', orgId), plan, now())) {
      const seated = new Set((await members(orgId)).map((m) => m?.public_user_data?.user_id).filter(Boolean));
      return { plan: 'paid', seats: seats.length, seatedSubjects: seated };
    }
    return { plan: null, seats: seats.length, seatedSubjects: new Set() };
  }

  const shape = ({ plan: state, seats, seatedSubjects }, accounts) => {
    const byName = new Map(accounts.map((a) => [a.name, a]));
    return {
      plan: state,
      seats,
      orgId: null,
      seated(name) {
        const account = byName.get(name);
        if (!account || !PAID_ROLES.has(account.seatRole ?? account.role) || state === 'comped' || state === 'trial') return true;
        const subject = subjectOf(account);
        return !subject || seatedSubjects.has(subject);
      },
    };
  };

  return {
    plan,
    publishableKey,
    subjectOf,
    trialDays,
    trial: (workspace) => trialOf(workspace, trialDays, now()),
    async standing({ workspace, accounts }) {
      const created = Date.parse(workspace.createdAt ?? '');
      const orgId = workspace.billing?.orgId ?? null;
      if (!Number.isNaN(created) && created < since) return { ...shape({ plan: 'comped', seats: seatsOf(accounts).length, seatedSubjects: new Set() }, accounts), orgId, trial: null };
      const trial = trialOf(workspace, trialDays, now());
      const key = `${workspace.slug ?? ''}\u0000${workspace.billing?.orgId ?? ''}\u0000${seatsOf(accounts).map(subjectOf).sort().join(',')}`;
      const hit = cache.get(key);
      let value;
      if (hit && now() - hit.at < FRESH_MS) value = hit.value;
      else {
        try {
          value = await lookup(workspace, accounts);
          if (cache.size > 10_000) cache.clear();
          cache.set(key, { at: now(), value });
        } catch (error) {
          if (hit && now() - hit.at <= STALE_MS) value = hit.value;
          else if (trial) value = { plan: null, seats: seatsOf(accounts).length, seatedSubjects: new Set() };
          else throw new BillingUnavailable(error);
        }
      }
      if (value.plan == null && trial) return { ...shape({ ...value, plan: 'trial' }, accounts), orgId, trial };
      return { ...shape(value, accounts), orgId, trial: null };
    },
    forget() { cache.clear(); },
    async ensureOrg({ workspace, createdBy }) {
      if (workspace.billing?.orgId) return workspace.billing.orgId;
      const org = await api('POST', '/organizations', { name: workspace.name || workspace.slug, created_by: createdBy, private_metadata: { weave_workspace: workspace.slug } });
      return org.id;
    },
    async syncMembers({ orgId, accounts }) {
      const wanted = new Map();
      for (const account of seatsOf(accounts)) wanted.set(subjectOf(account), { name: account.name, role: ORG_ROLE[account.role] ?? ORG_ROLE.editor });
      const present = new Map((await members(orgId)).map((m) => [m?.public_user_data?.user_id, m.role]).filter(([id]) => id));
      const refused = [];
      const base = `/organizations/${encodeURIComponent(orgId)}/memberships`;
      for (const [subject, { name, role }] of wanted) {
        try {
          if (!present.has(subject)) await api('POST', base, { user_id: subject, role });
          else if (present.get(subject) !== role) await api('PATCH', `${base}/${encodeURIComponent(subject)}`, { role });
        } catch (error) {
          if (error.status >= 500 || !error.status) throw error;
          refused.push(name);
        }
      }
      for (const subject of present.keys()) if (!wanted.has(subject)) await api('DELETE', `${base}/${encodeURIComponent(subject)}`);
      cache.clear();
      return { refused };
    },
  };
}
