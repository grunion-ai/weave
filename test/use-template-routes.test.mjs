/* Feature #261, the hub half: POST /api/spaces/:id/use on the source
   workspace's API copies a template space into another workspace of the hub,
   GET /api/templates lists them, and weave_template_use over HTTP MCP reaches
   the same door. The caller reads the source and must be an architect on the
   target. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer, createWorkspaceHub } from '../src/server.js';

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

    // The name defaults to the template's; the default workspace's url has no /w/.
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
    // Neither root token verifies on acme, which holds accounts of its own:
    // the target verifies the caller's credential, whatever the source says.
    for (const token of [editor, architect]) {
      const res = await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme' }, { Authorization: `Bearer ${token}` });
      assert.equal(res.status, 403);
      assert.match((await res.json()).error, /cannot build in acme/);
    }
    assert.equal(acme.listSpaces().length, 0, 'nothing written');
  } finally { server.close(); }
});

test('an observer on the source may use a template into a workspace where it is an architect', async () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'CRM', template: true });
  root.createTable({ space: 'CRM', name: 'Deal' });
  const acme = new Weave();
  acme.updateWorkspace({ name: 'acme' });
  const { server } = await startServer(root, { port: 0, workspaces: { acme } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // A root session opens a member (the hub rule), so one browser session
    // carries the caller to both: observer here, architect there is the case
    // a Bearer token cannot make, so the role is set per workspace by account.
    const viewer = root.createAccount({ name: 'vee', role: 'observer' });
    const res = await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme' }, { Authorization: `Bearer ${viewer.token}` });
    // acme holds no account, so anyone may build there.
    assert.equal(res.status, 201, await res.clone().text());
    assert.ok(acme.getSpace('CRM'));
    // Other writes stay closed to the observer.
    assert.equal((await post(`${base}/api/spaces`, { name: 'Nope' }, { Authorization: `Bearer ${viewer.token}` })).status, 403);
    // Once acme holds accounts, a caller who is not its architect is refused.
    acme.createAccount({ name: 'own', role: 'architect' });
    const refused = await post(`${base}/api/spaces/CRM/use`, { workspace: 'acme', name: 'CRM 2' }, { Authorization: `Bearer ${viewer.token}` });
    assert.equal(refused.status, 403);
  } finally { server.close(); }
});

test('weave_template_use over HTTP MCP reaches the hub', async () => {
  const { acme, server, base } = await hub();
  try {
    const rpc = async (name, args) => (await (await post(`${base}/api/mcp`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()).result;
    const listed = JSON.parse((await rpc('weave_template_list', {})).content[0].text);
    assert.deepEqual(listed.templates.map((s) => s.name), ['CRM']);
    const used = await rpc('weave_template_use', { space: 'CRM', workspace: 'acme', name: 'Sales' });
    assert.ok(!used.isError, used.content[0].text);
    const body = JSON.parse(used.content[0].text);
    assert.equal(body.url, `/w/acme/#/space/${acme.getSpace('Sales').id}`);
    const again = await rpc('weave_template_use', { space: 'CRM', workspace: 'acme', name: 'Sales' });
    assert.ok(again.isError);
    assert.match(again.content[0].text, /already has a space named 'Sales'/);
    // weave_call reaches it too.
    const viaCall = await rpc('weave_call', { name: 'weave_template_use', args: { space: 'CRM', workspace: 'acme', name: 'Sales 2' } });
    assert.ok(!viaCall.isError, viaCall.content[0].text);
  } finally { server.close(); }
});

test('a member\'s space is marked a template from its row in the root registry', async () => {
  const { root, acme, server, base } = await hub();
  try {
    acme.createSpace({ name: 'Kit' });
    const spaces = root.getTable('Workspace/Spaces');
    const row = root.listEntities(spaces.id).find((e) => root.entityName(e) === 'Kit');
    const res = await fetch(`${base}/api/entities/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Template: true }) });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(acme.getSpace('Kit').template, true, 'the row edit reaches the member engine');
    assert.deepEqual((await (await fetch(`${base}/w/acme/api/templates`)).json()).map((s) => s.name), ['Kit']);
    acme.updateSpace('Kit', { template: false });
    assert.equal(root.readEntity(row.id).fields.Template, false, 'and the verb writes the root row');
  } finally { server.close(); }
});

test('a space rollup travels into a hub member, where the root registry holds it', () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const acme = new Weave();
  acme.updateWorkspace({ name: 'acme' });
  createWorkspaceHub(root, { workspaces: { acme } });
  root.createSpace({ name: 'CRM', template: true });
  const deal = root.createTable({ space: 'CRM', name: 'Deal' });
  root.addField(deal.id, { name: 'Amount', type: 'number' });
  const spaces = root.getTable('Workspace/Spaces');
  root.addField(spaces.id, { name: 'Deal sum', type: 'rollup', config: { via: deal.id, targetField: 'Amount', aggregate: 'sum' } });
  root.useTemplate('CRM', acme, { name: 'Sales' });
  const via = (n) => root.findField(spaces, n)?.config.via;
  assert.equal(via('Deal sum'), deal.id, 'the source keeps its own');
  assert.equal(via('Deal sum (Sales)'), acme.getTable('Sales/Deal').id, 'the copy\'s reads the member\'s table, under the new space\'s name');
});
