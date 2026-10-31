import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer, createWorkspaceHub } from '../src/server.js';
import { unwrapData } from './lib/fixtures.mjs';

const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function hub() {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'CRM', template: true });
  const deal = root.createTable({ space: 'CRM', name: 'Deal' });
  root.addField(deal.id, { name: 'Amount', type: 'number', config: { format: 'currency', currency: 'USD' } });
  root.createEntity(deal.id, { name: 'Big one', values: { Amount: 5 } });
  root.createSpace({ name: 'Plain' });
  const acme = new Weave();
  acme.updateWorkspace({ name: 'acme' });
  const { server } = await startServer(root, { port: 0, workspaces: { acme } });
  return { root, acme, server, base: `http://127.0.0.1:${server.address().port}` };
}

test('GET /api/templates lists the URL workspace\'s template spaces', async () => {
  const { server, base } = await hub();
  try {
    const list = await (await fetch(`${base}/api/templates`)).json();
    assert.deepEqual(list.map((s) => s.name), ['CRM']);
    assert.deepEqual(await (await fetch(`${base}/w/acme/api/templates`)).json(), []);
  } finally { server.close(); }
});

test('POST /api/spaces/:id/use copies the schema into the named workspace and answers its url', async () => {
  const { root, acme, server, base } = await hub();
  try {
    const crm = root.getSpace('CRM');
    const res = await post(`${base}/api/spaces/${crm.id}/use`, { workspace: 'acme', name: 'Sales' });
    assert.equal(res.status, 201, await res.clone().text());
    const body = await res.json();
    const made = acme.getSpace('Sales');
    assert.equal(body.space.id, made.id);
    assert.equal(body.url, `/w/acme/#/space/${made.id}`);
    assert.ok(Array.isArray(body.plan) && body.plan.length);
    assert.deepEqual(body.skipped, []);
    assert.equal(acme.listEntities(acme.getTable('Sales/Deal').id).length, 0, 'rows stay home');
    const schema = await (await fetch(`${base}/w/acme/api/schema`)).json();
    assert.ok(schema.find((s) => s.space === 'Sales'), 'the member serves the new space');

    const back = await (await post(`${base}/w/acme/api/spaces/${made.id}/use`, { workspace: 'root', name: 'Sales' })).json();
    assert.equal(back.url, `/#/space/${root.getSpace('Sales').id}`);
    assert.equal((await (await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme' })).json()).space.name, 'CRM');

    const clash = await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme', name: 'Sales' });
    assert.equal(clash.status, 409);
    assert.match((await clash.json()).error, /already has a space named 'Sales'/);
    assert.equal((await post(`${base}/api/spaces/CRM/use`, { workspace: 'nowhere' })).status, 404);
    assert.equal((await post(`${base}/api/spaces/CRM/use`, {})).status, 400);
  } finally { server.close(); }
});

test('using a template needs an architect on the target', async () => {
  const { root, acme, server, base } = await hub();
  try {
    const editor = root.createAccount({ name: 'ed', role: 'editor' }).token;
    const architect = root.createAccount({ name: 'boss', role: 'architect' }).token;
    acme.createAccount({ name: 'own', role: 'architect' });
    const spacesBefore = acme.listSpaces().map(s => s.id);
    for (const token of [editor, architect]) {
      const res = await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme' }, { Authorization: `Bearer ${token}` });
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /cannot build in acme/);
    }
    assert.deepEqual(acme.listSpaces().map(s => s.id), spacesBefore, 'nothing written');
  } finally { server.close(); }
});

test('an observer on the source may use a template into an open workspace', async () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'CRM', template: true });
  root.createTable({ space: 'CRM', name: 'Deal' });
  const acme = new Weave();
  acme.updateWorkspace({ name: 'acme' });
  const { server } = await startServer(root, { port: 0, workspaces: { acme } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const viewer = root.createAccount({ name: 'vee', role: 'observer' });
    const res = await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme' }, { Authorization: `Bearer ${viewer.token}` });
    assert.equal(res.status, 201, await res.clone().text());
    assert.ok(acme.getSpace('CRM'));
    assert.equal((await post(`${base}/api/spaces`, { name: 'Nope' }, { Authorization: `Bearer ${viewer.token}` })).status, 403);
    acme.createAccount({ name: 'own', role: 'architect' });
    const refused = await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme', name: 'CRM 2' }, { Authorization: `Bearer ${viewer.token}` });
    assert.equal(refused.status, 403);
  } finally { server.close(); }
});

test('template copies use the target local session for permission and audit identity', async () => {
  const { root, acme, server, base } = await hub();
  try {
    const viewer = root.createAccount({ name: 'viewer', role: 'observer' });
    const owner = acme.createAccount({ name: 'owner', role: 'architect' });
    root.setRequireAuth(true);
    acme.setRequireAuth(true);
    const cookie = [root, acme].map(w => `wv_session_${w.state.meta.id}=${w.createSession(w === root ? viewer.account.id : owner.account.id).token}`).join('; ');
    const res = await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme' }, { Cookie: cookie });
    assert.equal(res.status, 201, await res.clone().text());
    const entries = acme.store.listAudit({ limit: -1, actions: ['space-from-template'] });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].actor, `account:${owner.account.id}`);
    assert.notEqual(entries[0].actor, `account:${viewer.account.id}`);
    assert.equal((await post(`${base}/api/spaces`, { name: 'Nope' }, { Cookie: cookie })).status, 403);
  } finally { server.close(); }
});

test('weave_template_use over HTTP MCP reaches the hub', async () => {
  const { acme, server, base } = await hub();
  try {
    const rpc = async (name, args) => (await (await post(`${base}/api/mcp`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()).result;
    const listed = JSON.parse(unwrapData((await rpc('weave_template_list', {})).content[0].text));
    assert.deepEqual(listed.templates.map((s) => s.name), ['CRM']);
    const used = await rpc('weave_template_use', { space: 'CRM', workspace: 'acme', name: 'Sales' });
    assert.ok(!used.isError, used.content[0].text);
    const body = JSON.parse(used.content[0].text);
    assert.equal(body.url, `/w/acme/#/space/${acme.getSpace('Sales').id}`);
    const again = await rpc('weave_template_use', { space: 'CRM', workspace: 'acme', name: 'Sales' });
    assert.ok(again.isError);
    assert.match(again.content[0].text, /already has a space named 'Sales'/);
    const viaCall = await rpc('weave_call', { name: 'weave_template_use', args: { space: 'CRM', workspace: 'acme', name: 'Sales 2' } });
    assert.ok(!viaCall.isError, viaCall.content[0].text);
  } finally { server.close(); }
});

test('a member\'s space is marked a template from its own registry row', async () => {
  const { root, acme, server, base } = await hub();
  try {
    acme.createSpace({ name: 'Kit' });
    const spaces = acme.getTable('System/Spaces');
    const row = acme.listEntities(spaces.id).find((e) => acme.entityName(e) === 'Kit');
    assert.equal((await fetch(`${base}/api/entities/${row.id}`)).status, 404);
    const res = await fetch(`${base}/w/acme/api/entities/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Template: true }) });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(acme.getSpace('Kit').template, true, 'the row edit reaches the member engine');
    assert.deepEqual((await (await fetch(`${base}/w/acme/api/templates`)).json()).map((s) => s.name), ['Kit']);
    acme.updateSpace('Kit', { template: false });
    assert.equal(acme.readEntity(row.id).fields.Template, false, 'and the verb writes the local registry row');
  } finally { server.close(); }
});

test('a space rollup travels into the destination workspace registry', () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const acme = new Weave();
  acme.updateWorkspace({ name: 'acme' });
  createWorkspaceHub(root, { workspaces: { acme } });
  root.createSpace({ name: 'CRM', template: true });
  const deal = root.createTable({ space: 'CRM', name: 'Deal' });
  root.addField(deal.id, { name: 'Amount', type: 'number' });
  const spaces = root.getTable('System/Spaces');
  root.addField(spaces.id, { name: 'Deal sum', type: 'rollup', config: { via: deal.id, targetField: 'Amount', aggregate: 'sum' } });
  root.useTemplate('CRM', acme, { name: 'Sales' });
  assert.equal(root.findField(spaces, 'Deal sum')?.config.via, deal.id, 'the source keeps its own');
  const localSpaces = acme.getTable('System/Spaces');
  const copied = Object.values(localSpaces.fields).find(f => f.type === 'rollup' && f.config.via === acme.getTable('Sales/Deal').id);
  assert.ok(copied, 'the destination registry owns the copied rollup');
  assert.equal(Object.values(spaces.fields).filter(f => f.type === 'rollup').length, 1, 'the source gains no destination rollup');
});


test('template REST and MCP refuse a protected target with no local accounts', async () => {
  const { root, acme, server, base } = await hub();
  try {
    const { token } = root.createAccount({ name: 'source-owner', role: 'architect' });
    acme.setRequireAuth(true);
    const headers = { Authorization: `Bearer ${token}` };
    const before = acme.listSpaces().map(s => s.id);
    const response = await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme' }, headers);
    assert.equal(response.status, 403);
    const rpc = await (await post(`${base}/api/mcp`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_template_use', arguments: { space: 'CRM', workspace: 'acme' } } }, headers)).json();
    assert.equal(rpc.result.isError, true);
    assert.match(rpc.result.content[0].text, /architect|cannot build/);
    assert.deepEqual(acme.listSpaces().map(s => s.id), before);
  } finally { server.close(); }
});

test('a scoped target architect session cannot manage the workspace through another workspace', async () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'source' });
  root.createSpace({ name: 'CRM', template: true });
  root.createTable({ space: 'CRM', name: 'Deal' });
  const source = root.createAccount({ name: 'source-owner', role: 'architect' }).account;
  const target = new Weave();
  target.updateWorkspace({ name: 'target' });
  target.createSpace({ name: 'Ops' });
  const scoped = target.createAccount({ name: 'scoped', role: 'architect', space: 'Ops' }).account;
  target.setRequireAuth(true);
  const { server } = await startServer(root, { port: 0, workspaces: { target } });
  const base = `http://127.0.0.1:${server.address().port}`;
  const Cookie = `wv_session_${root.state.meta.id}=${root.createSession(source.id).token}; wv_session_${target.state.meta.id}=${target.createSession(scoped.id).token}`;
  try {
    const before = target.listSpaces().map(s => s.id);
    const copied = await post(`${base}/api/spaces/CRM/use`, { workspace: 'target' }, { Cookie });
    assert.equal(copied.status, 403);
    const removed = await fetch(`${base}/api/workspaces/target`, { method: 'DELETE', headers: { Cookie } });
    assert.equal(removed.status, 403);
    assert.deepEqual(target.listSpaces().map(s => s.id), before);
    assert.ok(!target.state.meta.deletedAt);
  } finally { server.close(); }
});
