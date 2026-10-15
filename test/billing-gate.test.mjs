import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { createWorkspaceHub } = await import('../src/server.js');
const { createBilling, CLERK_API } = await import('../src/billing.js');
const { client } = await import('./lib/fixtures.mjs');

const ISSUER = 'https://clerk.weave.example.com';
const PERIOD_END = Date.now() + 20 * 86_400_000;
const active = (slug) => [200, { subscription_items: [{ status: 'active', plan: { slug }, period_end: PERIOD_END }] }];

function clerk(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = String(url).slice(CLERK_API.length).split('?')[0];
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const hit = routes[`${method} ${path}`];
    const [status, body] = typeof hit === 'function' ? hit(init.body ? JSON.parse(init.body) : null) : hit ?? [404, { errors: [{ code: 'resource_not_found' }] }];
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

let tableId = null;
function build(routes = {}, { comped = false, billingOn = true } = {}) {
  const w = new Weave();
  w.updateWorkspace({ name: 'acme' });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const t = {};
  for (const [name, role, subject] of [['arc', 'architect', 'user_arc'], ['ed', 'editor', 'user_ed'], ['ob', 'observer', 'user_ob']]) {
    t[name] = w.createAccount({ name, role }).token;
    w.redeemIdentityInvite(w.linkIdentity(name, { issuer: ISSUER }).code, { issuer: ISSUER, subject });
  }
  w.setRequireAuth(true);
  if (comped) w.state.meta.createdAt = '2026-01-01T00:00:00.000Z';
  const fake = clerk(routes);
  const billing = billingOn ? createBilling({ secretKey: 'sk_test_x', soloPlan: 'solo', teamPlan: 'team', since: Date.parse('2026-06-01T00:00:00Z'), issuer: ISSUER, publishableKey: 'pk_test_Y2xlcmsud2VhdmUuZXhhbXBsZS5jb20k', fetch: fake.fetch }) : null;
  tableId = w.findTable('Dev/Task').id;
  return { w, call: client(createWorkspaceHub(w), { billing }), t, calls: fake.calls };
}

const write = (call, token) => call('POST', `/api/tables/${tableId}/entities`, { token, body: { name: 'new' } });

test('billing on and no plan: Editors and Architects work as Observers, with a seat-required refusal', async () => {
  const { call, t } = build();
  const refused = await write(call, t.ed);
  assert.equal(refused.status, 402);
  assert.equal(refused.json.code, 'seat-required');
  assert.match(refused.json.error, /seat/);
  assert.equal(refused.json.billing, '/billing');
  assert.equal((await write(call, t.arc)).status, 402);
  assert.equal((await call('POST', `/api/tables/${tableId}/query`, { token: t.ed, body: {} })).status, 200, 'reading never needs a seat');
});

test('a workspace made before WEAVE_BILLING_SINCE writes as before and never asks Clerk', async () => {
  const { call, t, calls } = build({}, { comped: true });
  assert.equal((await write(call, t.ed)).status, 201);
  assert.deepEqual(calls, []);
});

test('billing off: nothing changes and /api/billing says so', async () => {
  const { call, t } = build({}, { billingOn: false });
  assert.equal((await write(call, t.ed)).status, 201);
  const res = await call('GET', '/api/billing', { token: t.arc });
  assert.equal(res.status, 404);
  assert.equal(res.json.code, 'billing-off');
});

test('the team plan seats the Clerk organization members; a paid human without a seat stays an Observer', async () => {
  const { w, call, t } = build({
    'GET /organizations/org_1/billing/subscription': active('team'),
    'GET /organizations/org_1/memberships': [200, { data: [{ public_user_data: { user_id: 'user_arc' } }] }],
  });
  w.linkBillingOrg('org_1');
  assert.equal((await write(call, t.arc)).status, 201);
  assert.equal((await write(call, t.ed)).status, 402);
});

test('Clerk down on a write answers 503, not a refusal the person caused', async () => {
  const { w, call, t } = build({ 'GET /organizations/org_1/billing/subscription': [500, {}] });
  w.linkBillingOrg('org_1');
  const res = await write(call, t.ed);
  assert.equal(res.status, 503);
  assert.equal(res.json.code, 'billing-unavailable');
});

test('GET /api/billing: the plan, the seat count and who holds a seat, for any member', async () => {
  const { call, t } = build();
  const res = await call('GET', '/api/billing', { token: t.ob });
  assert.equal(res.status, 200);
  assert.equal(res.json.plan, null);
  assert.equal(res.json.seats, 2);
  assert.deepEqual(res.json.members.map((m) => [m.name, m.role, m.seated]).sort(), [['arc', 'architect', false], ['ed', 'editor', false], ['ob', 'observer', true]]);
  assert.equal(res.json.soloPlan, 'solo');
  assert.equal(res.json.teamPlan, 'team');
  assert.equal(res.json.publishableKey, 'pk_test_Y2xlcmsud2VhdmUuZXhhbXBsZS5jb20k');
  assert.equal(res.json.orgId, null);
});

test('POST /api/billing/team: an unseated architect opens the Clerk organization and every paid human is mirrored into it', async () => {
  const added = [];
  const { w, call, t } = build({
    'POST /organizations': [200, { id: 'org_7' }],
    'GET /organizations/org_7/memberships': [200, { data: [{ role: 'org:admin', public_user_data: { user_id: 'user_arc' } }] }],
    'POST /organizations/org_7/memberships': (body) => { added.push(body); return [200, {}]; },
  });
  assert.equal((await call('POST', '/api/billing/team', { token: t.ed })).status, 403, 'only an architect opens the team plan');
  const res = await call('POST', '/api/billing/team', { token: t.arc });
  assert.equal(res.status, 200);
  assert.equal(res.json.orgId, 'org_7');
  assert.equal(w.billing().billing.orgId, 'org_7');
  assert.deepEqual(added, [{ user_id: 'user_ed', role: 'org:member' }]);
});

test('a role change on a linked workspace re-mirrors the Clerk organization', async () => {
  const writes = [];
  const { w, call, t } = build({
    'GET /organizations/org_1/memberships': [200, { data: [{ role: 'org:admin', public_user_data: { user_id: 'user_arc' } }, { role: 'org:member', public_user_data: { user_id: 'user_ed' } }] }],
    'DELETE /organizations/org_1/memberships/user_ed': () => { writes.push('drop ed'); return [200, {}]; },
    'GET /organizations/org_1/billing/subscription': active('team'),
  });
  w.linkBillingOrg('org_1');
  const res = await call('PATCH', '/api/accounts/ed', { token: t.arc, body: { role: 'observer' } });
  assert.equal(res.status, 200);
  assert.deepEqual(writes, ['drop ed']);
});

test('linkBillingOrg refuses anything but a Clerk organization id', () => {
  const w = new Weave();
  assert.throws(() => w.linkBillingOrg('acme'), /Clerk organization id/);
  assert.equal(w.linkBillingOrg('org_abc'), 'org_abc');
  assert.equal(w.billing().billing.orgId, 'org_abc');
});
