import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { createWorkspaceHub } = await import('../src/server.js');
const { createBilling, CLERK_API } = await import('../src/billing.js');
const { client } = await import('./lib/fixtures.mjs');

const ISSUER = 'https://clerk.weave.example.com';
const PUBLISHABLE = ['pk', 'test', Buffer.from('clerk.weave.example.com$').toString('base64')].join('_');
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
function build(routes = {}, { comped = false, billingOn = true, trialFrom = null, trialDays = 14 } = {}) {
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
  if (trialFrom) w.state.meta.trialFrom = trialFrom;
  const fake = clerk(routes);
  const billing = billingOn ? createBilling({ secretKey: 'sk_test_x', plan: 'seat', since: Date.parse('2026-06-01T00:00:00Z'), issuer: ISSUER, publishableKey: PUBLISHABLE, trialDays, fetch: fake.fetch }) : null;
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

test('the seat plan seats the Clerk organization members; a paid human without a seat stays an Observer', async () => {
  const { w, call, t } = build({
    'GET /organizations/org_1/billing/subscription': active('seat'),
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
  assert.equal(res.json.planSlug, 'seat');
  assert.equal(res.json.publishableKey, PUBLISHABLE);
  assert.equal(res.json.orgId, null);
});

test('POST /api/billing/organization: an unseated architect opens the Clerk organization and every paid human is mirrored into it', async () => {
  const added = [];
  const { w, call, t } = build({
    'POST /organizations': [200, { id: 'org_7' }],
    'GET /organizations/org_7/memberships': [200, { data: [{ role: 'org:admin', public_user_data: { user_id: 'user_arc' } }] }],
    'POST /organizations/org_7/memberships': (body) => { added.push(body); return [200, {}]; },
  });
  assert.equal((await call('POST', '/api/billing/organization', { token: t.ed })).status, 403, 'only an architect sets up billing');
  const res = await call('POST', '/api/billing/organization', { token: t.arc });
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
    'GET /organizations/org_1/billing/subscription': active('seat'),
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

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const mcp = (call, token, method, params) => call('POST', '/api/mcp', { token, body: { jsonrpc: '2.0', id: 1, method, params } });

test('a trial workspace: every paid role writes, the AI app works, and /api/billing names the end', async () => {
  const { call, t } = build({}, { trialFrom: daysAgo(3) });
  assert.equal((await write(call, t.ed)).status, 201);
  assert.equal((await write(call, t.arc)).status, 201);
  assert.equal((await mcp(call, t.arc, 'initialize', {})).status, 200);
  const made = await mcp(call, t.arc, 'tools/call', { name: 'weave_create_entity', arguments: { db: 'Dev/Task', name: 'from the agent' } });
  assert.equal(made.status, 200);
  assert.notEqual(made.json.result.isError, true, JSON.stringify(made.json));
  const res = await call('GET', '/api/billing', { token: t.ob });
  assert.equal(res.json.plan, 'trial');
  assert.equal(res.json.trial.daysLeft, 11);
  assert.ok(Date.parse(res.json.trial.endsAt) > Date.now());
  assert.ok(res.json.members.every((m) => m.seated));
});

test('after the trial: writes need a seat again, existing rows stay, and /api/billing has no trial', async () => {
  const { w, call, t } = build({}, { trialFrom: daysAgo(20) });
  w.createEntity('Dev/Task', { name: 'kept' });
  assert.equal((await write(call, t.arc)).status, 402);
  const res = await call('GET', '/api/billing', { token: t.arc });
  assert.deepEqual([res.json.plan, res.json.trial], [null, null]);
  const rows = await call('POST', `/api/tables/${tableId}/query`, { token: t.arc, body: {} });
  assert.deepEqual(rows.json.items.map((e) => e.name), ['kept']);
});

test('an unseated Architect keeps an AI app that reads; its writes come back as a seat-required tool error', async () => {
  const { w, call, t } = build();
  w.createEntity('Dev/Task', { name: 'kept' });
  const init = await mcp(call, t.arc, 'initialize', {});
  assert.equal(init.status, 200);
  assert.equal((await mcp(call, t.arc, 'tools/list', {})).status, 200);
  const read = await mcp(call, t.arc, 'tools/call', { name: 'weave_query', arguments: { db: 'Dev/Task' } });
  assert.equal(read.json.result.isError, undefined, JSON.stringify(read.json));
  assert.match(read.json.result.content[0].text, /kept/);
  const wrapped = await mcp(call, t.arc, 'tools/call', { name: 'weave_call', arguments: { name: 'weave_search', args: { query: 'kept' } } });
  assert.equal(wrapped.json.result.isError, undefined, JSON.stringify(wrapped.json));
  for (const [name, args] of [['weave_create_entity', { db: 'Dev/Task', name: 'x' }], ['weave_call', { name: 'weave_create_space', args: { name: 'Ops' } }]]) {
    const refused = await mcp(call, t.arc, 'tools/call', { name, arguments: args });
    assert.equal(refused.json.result.isError, true, name);
    assert.match(refused.json.result.content[0].text, /paid seat/);
    assert.match(refused.json.result.content[0].text, /\/billing/);
  }
  assert.equal(w.listTables().filter((x) => !x.system).length, 1);
  assert.equal((await mcp(call, t.ob, 'initialize', {})).status, 200, 'an Observer by role reads over MCP (Issue #508)');
  const obWrite = await mcp(call, t.ob, 'tools/call', { name: 'weave_create_entity', arguments: { db: 'Dev/Task', name: 'x' } });
  assert.equal(obWrite.json.result.isError, true, 'and writes no row');
});

test('GET /api/billing gives an architect every seat holder\'s address and gives a member none (Issue #921)', async () => {
  const { w, call, t } = build();
  for (const [name, subject] of [['arc', 'user_arc'], ['ed', 'user_ed'], ['ob', 'user_ob']]) {
    assert.equal(w.accountForIdentity({ issuer: ISSUER, subject, email: `${name}@example.com` }).name, name);
  }
  const mine = await call('GET', '/api/billing', { token: t.arc });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.json.members.map((m) => [m.name, m.email]).sort(), [['arc', 'arc@example.com'], ['ed', 'ed@example.com'], ['ob', 'ob@example.com']]);
  const theirs = await call('GET', '/api/billing', { token: t.ob });
  assert.equal(theirs.status, 200);
  assert.deepEqual(theirs.json.members.map((m) => m.email), [undefined, undefined, undefined], 'only an architect reads addresses, as in Members');
});

test('GET /api/billing leaves out the address of an account that has never signed in (Issue #921)', async () => {
  const { call, t } = build();
  const res = await call('GET', '/api/billing', { token: t.arc });
  assert.deepEqual(res.json.members.map((m) => m.email), [undefined, undefined, undefined]);
});
