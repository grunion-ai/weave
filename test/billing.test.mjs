import test from 'node:test';
import assert from 'node:assert/strict';
import { admits, billingFromEnv, createBilling, CLERK_API, PAID_ROLES, BillingUnavailable } from '../src/billing.js';

const ISSUER = 'https://clerk.weave.example.com';
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-01T00:00:00Z');

const clerkFake = (routes) => {
  const calls = [];
  const f = async (url, init = {}) => {
    const path = String(url).slice(CLERK_API.length);
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    const hit = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    if (hit === undefined) return new Response('{"errors":[{"code":"resource_not_found"}]}', { status: 404 });
    const [status, body] = typeof hit === 'function' ? hit(calls.at(-1)) : hit;
    return new Response(JSON.stringify(body), { status });
  };
  return { f, calls };
};

const sub = (slug, item = {}) => ({ object: 'commerce_subscription', status: 'active', subscription_items: [{ status: 'active', plan: { slug }, period_end: NOW + 20 * DAY, canceled_at: null, past_due_at: null, ...item }] });
const human = (name, role, subject) => ({ name, role, identities: subject ? [{ issuer: ISSUER, subject }] : [] });
const env = { WEAVE_CLERK_SECRET_KEY: 'sk_test_x', WEAVE_BILLING_SOLO_PLAN: 'solo', WEAVE_BILLING_TEAM_PLAN: 'team', WEAVE_BILLING_SINCE: '2026-10-16T00:00:00Z', WEAVE_OIDC_ISSUER: ISSUER };
const make = (routes, extra = {}) => {
  const { f, calls } = clerkFake(routes);
  return { billing: billingFromEnv({ ...env, ...extra }, { fetch: f, now: () => NOW }), calls };
};
const fresh = { createdAt: '2026-10-20T00:00:00Z', billing: {} };

test('billingFromEnv: dark unless the key and both plan slugs are set', () => {
  for (const drop of ['WEAVE_CLERK_SECRET_KEY', 'WEAVE_BILLING_SOLO_PLAN', 'WEAVE_BILLING_TEAM_PLAN']) {
    assert.equal(billingFromEnv({ ...env, [drop]: ' ' }), null, drop);
  }
  assert.equal(billingFromEnv({}), null);
  assert.equal(typeof billingFromEnv(env).standing, 'function');
});

test('billingFromEnv refuses a WEAVE_BILLING_SINCE that is not a date', () => {
  assert.throws(() => billingFromEnv({ ...env, WEAVE_BILLING_SINCE: 'soon' }), /WEAVE_BILLING_SINCE/);
});

test('paid roles are Editor and Architect; Observer is free', () => {
  assert.deepEqual([...PAID_ROLES].sort(), ['architect', 'editor']);
});

test('admits: active and past_due run, a canceled item runs to its period end, an unpaid end keeps access', () => {
  assert.equal(admits({ status: 'active' }, NOW), true);
  assert.equal(admits({ status: 'past_due' }, NOW), true);
  assert.equal(admits({ status: 'canceled', period_end: NOW + 1 }, NOW), true);
  assert.equal(admits({ status: 'canceled', period_end: NOW - 1 }, NOW), false);
  assert.equal(admits({ status: 'ended', past_due_at: NOW - DAY, canceled_at: null }, NOW), true);
  assert.equal(admits({ status: 'ended', past_due_at: NOW - DAY, canceled_at: NOW - DAY }, NOW), false);
  assert.equal(admits({ status: 'upcoming' }, NOW), false);
  assert.equal(admits(null, NOW), false);
});

test('a workspace made before WEAVE_BILLING_SINCE is comped and asks Clerk nothing', async () => {
  const { billing, calls } = make({});
  const s = await billing.standing({ workspace: { createdAt: '2026-09-01T00:00:00Z', billing: {} }, accounts: [human('kyle', 'architect', 'user_k'), human('ana', 'editor', 'user_a')] });
  assert.equal(s.plan, 'comped');
  assert.equal(s.seated('kyle'), true);
  assert.equal(s.seated('ana'), true);
  assert.equal(calls.length, 0);
});

test('one paid human on the solo plan is seated; Observers never need a seat', async () => {
  const { billing, calls } = make({ 'GET /users/user_k/billing/subscription': [200, sub('solo')] });
  const s = await billing.standing({ workspace: fresh, accounts: [human('kyle', 'architect', 'user_k'), human('obs', 'observer', 'user_o')] });
  assert.equal(s.plan, 'solo');
  assert.equal(s.seats, 1);
  assert.equal(s.seated('kyle'), true);
  assert.equal(s.seated('obs'), true);
  assert.equal(calls[0].auth, 'Bearer sk_test_x');
});

test('one paid human with no plan is not seated', async () => {
  const { billing } = make({});
  const s = await billing.standing({ workspace: fresh, accounts: [human('kyle', 'architect', 'user_k')] });
  assert.equal(s.plan, null);
  assert.equal(s.seated('kyle'), false);
});

test('a solo plan stops covering once a second paid human joins without the team plan', async () => {
  const { billing } = make({ 'GET /users/user_k/billing/subscription': [200, sub('solo')] });
  const s = await billing.standing({ workspace: fresh, accounts: [human('kyle', 'architect', 'user_k'), human('ana', 'editor', 'user_a')] });
  assert.equal(s.plan, null);
  assert.equal(s.seated('kyle'), false);
  assert.equal(s.seated('ana'), false);
});

test('on the team plan every paid human who is a member of the Clerk organization is seated', async () => {
  const { billing } = make({
    'GET /organizations/org_1/billing/subscription': [200, sub('team')],
    'GET /organizations/org_1/memberships': [200, { data: [{ public_user_data: { user_id: 'user_k' } }, { public_user_data: { user_id: 'user_a' } }], total_count: 2 }],
  });
  const s = await billing.standing({ workspace: { ...fresh, billing: { orgId: 'org_1' } }, accounts: [human('kyle', 'architect', 'user_k'), human('ana', 'editor', 'user_a'), human('bo', 'editor', 'user_b')] });
  assert.equal(s.plan, 'team');
  assert.equal(s.seats, 3);
  assert.equal(s.seated('kyle'), true);
  assert.equal(s.seated('ana'), true);
  assert.equal(s.seated('bo'), false, 'Clerk had no seat for bo, so bo works as an Observer');
});

test('an account with no identity under the Clerk issuer is not a seat and is never gated', async () => {
  const { billing } = make({});
  const s = await billing.standing({ workspace: fresh, accounts: [human('deploy-check', 'architect', null)] });
  assert.equal(s.seats, 0);
  assert.equal(s.seated('deploy-check'), true);
});

const trialing = (daysAgo) => ({ ...fresh, slug: `t${daysAgo}`, trialFrom: new Date(NOW - daysAgo * DAY).toISOString() });

test('billingFromEnv: WEAVE_TRIAL_DAYS sets the trial length, 14 by default, 0 for none', async () => {
  const days = async (extra) => (await billingFromEnv({ ...env, ...extra }, { fetch: clerkFake({}).f, now: () => NOW }).standing({ workspace: trialing(0), accounts: [human('kyle', 'architect', 'user_k')] })).trial;
  assert.equal((await days({})).daysLeft, 14);
  assert.equal((await days({ WEAVE_TRIAL_DAYS: '30' })).daysLeft, 30);
  assert.equal(await days({ WEAVE_TRIAL_DAYS: '0' }), null);
  assert.throws(() => billingFromEnv({ ...env, WEAVE_TRIAL_DAYS: 'lots' }), /WEAVE_TRIAL_DAYS/);
  assert.throws(() => billingFromEnv({ ...env, WEAVE_TRIAL_DAYS: '-3' }), /WEAVE_TRIAL_DAYS/);
});

test('a workspace on its trial seats every paid role, and says when the trial ends', async () => {
  const { billing } = make({});
  const ws = trialing(2);
  const s = await billing.standing({ workspace: ws, accounts: [human('kyle', 'architect', 'user_k'), human('ana', 'editor', 'user_a')] });
  assert.equal(s.plan, 'trial');
  assert.equal(s.seated('kyle'), true);
  assert.equal(s.seated('ana'), true);
  assert.deepEqual(s.trial, { endsAt: new Date(Date.parse(ws.trialFrom) + 14 * DAY).toISOString(), daysLeft: 12 });
});

test('a plan bought during the trial wins over the trial', async () => {
  const { billing } = make({ 'GET /users/user_k/billing/subscription': [200, sub('solo')] });
  const s = await billing.standing({ workspace: trialing(2), accounts: [human('kyle', 'architect', 'user_k')] });
  assert.deepEqual([s.plan, s.trial], ['solo', null]);
});

test('after the trial the workspace needs a plan again', async () => {
  const { billing } = make({});
  const s = await billing.standing({ workspace: trialing(15), accounts: [human('kyle', 'architect', 'user_k')] });
  assert.deepEqual([s.plan, s.trial, s.seated('kyle')], [null, null, false]);
});

test('Clerk down during a trial keeps the trial working', async () => {
  const { billing } = make({ 'GET /users/user_k/billing/subscription': [500, {}] });
  const s = await billing.standing({ workspace: trialing(1), accounts: [human('kyle', 'architect', 'user_k')] });
  assert.deepEqual([s.plan, s.seated('kyle'), s.trial.daysLeft], ['trial', true, 13]);
});

test('a workspace made before WEAVE_BILLING_SINCE stays comped, with no trial', async () => {
  const { billing } = make({});
  const s = await billing.standing({ workspace: { createdAt: '2026-09-01T00:00:00Z', trialFrom: '2026-09-01T00:00:00Z', billing: {} }, accounts: [human('kyle', 'architect', 'user_k')] });
  assert.deepEqual([s.plan, s.trial], ['comped', null]);
});

test('standing is cached for a minute, and a stale answer stands in while Clerk is down', async () => {
  let up = true;
  const { f } = clerkFake({ 'GET /users/user_k/billing/subscription': () => (up ? [200, sub('solo')] : [500, {}]) });
  let now = NOW;
  const billing = billingFromEnv(env, { fetch: f, now: () => now });
  const ws = { ...fresh, slug: 'acme' };
  const accounts = [human('kyle', 'architect', 'user_k')];
  assert.equal((await billing.standing({ workspace: ws, accounts })).plan, 'solo');
  up = false;
  now += 2 * 60_000;
  assert.equal((await billing.standing({ workspace: ws, accounts })).plan, 'solo');
  now += 20 * 60_000;
  await assert.rejects(billing.standing({ workspace: ws, accounts }), BillingUnavailable);
});

test('ensureOrg creates one Clerk organization for a workspace, made by its architect', async () => {
  const { billing, calls } = make({ 'POST /organizations': [200, { id: 'org_9' }] });
  assert.equal(await billing.ensureOrg({ workspace: { slug: 'acme', name: 'Acme', billing: {} }, createdBy: 'user_k' }), 'org_9');
  assert.deepEqual(calls[0].body, { name: 'Acme', created_by: 'user_k', private_metadata: { weave_workspace: 'acme' } });
  assert.equal(await billing.ensureOrg({ workspace: { slug: 'acme', billing: { orgId: 'org_9' } }, createdBy: 'user_k' }), 'org_9');
  assert.equal(calls.length, 1);
});

test('syncMembers mirrors paid roles only: adds, re-roles and removes, and reports refusals', async () => {
  const { billing, calls } = make({
    'GET /organizations/org_1/memberships': [200, { data: [
      { role: 'org:admin', public_user_data: { user_id: 'user_k' } },
      { role: 'org:admin', public_user_data: { user_id: 'user_a' } },
      { role: 'org:member', public_user_data: { user_id: 'user_gone' } },
    ] }],
    'POST /organizations/org_1/memberships': ({ body }) => (body.user_id === 'user_full' ? [403, { errors: [{ code: 'organization_membership_quota_exceeded' }] }] : [200, {}]),
    'PATCH /organizations/org_1/memberships/user_a': [200, {}],
    'DELETE /organizations/org_1/memberships/user_gone': [200, {}],
  });
  const result = await billing.syncMembers({ orgId: 'org_1', accounts: [
    human('kyle', 'architect', 'user_k'), human('ana', 'editor', 'user_a'), human('new', 'editor', 'user_n'),
    human('full', 'editor', 'user_full'), human('obs', 'observer', 'user_o'),
  ] });
  const writes = calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path} ${c.body ? JSON.stringify(c.body) : ''}`.trim());
  assert.deepEqual(writes.sort(), [
    'DELETE /organizations/org_1/memberships/user_gone',
    'PATCH /organizations/org_1/memberships/user_a {"role":"org:member"}',
    'POST /organizations/org_1/memberships {"user_id":"user_full","role":"org:member"}',
    'POST /organizations/org_1/memberships {"user_id":"user_n","role":"org:member"}',
  ]);
  assert.deepEqual(result.refused, ['full']);
});
