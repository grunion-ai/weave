import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { createWorkspaceHub } = await import('../src/server.js');
const { client } = await import('./lib/fixtures.mjs');

const SECRET = 'Acme Secret Deal';
let D = null;
let T = null;

function build() {
  const w = new Weave();
  w.updateWorkspace({ name: 'ws' });
  w.createSpace({ name: 'Sales' });
  w.createSpace({ name: 'Ops' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  w.addField(deal.id, { name: 'Amount', type: 'number' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  D = deal.id;
  T = task.id;
  w.addRelation(task.id, { name: 'Deal', targetDb: deal.id, cardinality: 'many-to-many', inverseName: 'Tasks' });
  w.addField(task.id, { name: 'Deal Amount', type: 'lookup', config: { relationField: 'Deal', targetField: 'Amount' } });
  w.addField(task.id, { name: 'Deal Total', type: 'rollup', config: { relationField: 'Deal', targetField: 'Amount', aggregate: 'sum' } });
  w.addField(task.id, { name: 'Deal Names', type: 'formula', config: { expression: '[Deal]' } });
  const secret = w.createEntity(deal.id, { name: SECRET, Amount: 900 });
  const plain = w.createEntity(task.id, { name: 'Call the client', Deal: [secret.id] });
  const view = w.createView({ name: 'Pipeline', blocks: [{ table: 'Sales/Deal' }, { table: 'Ops/Task' }] });
  const t = {
    arc: w.createAccount({ name: 'arc', role: 'architect' }).token,
    sam: w.createAccount({ name: 'sam', role: 'editor' }).token,
    olive: w.createAccount({ name: 'olive', role: 'editor' }).token,
    obs: w.createAccount({ name: 'obs', role: 'observer' }).token,
  };
  w.updateSpace('Sales', { access: 'private' });
  w.setSpaceMember('Sales', 'sam');
  w.setRequireAuth(true);
  const share = w.mintShare({ scope: { kind: 'workspace' }, mode: 'read' });
  return { w, call: client(createWorkspaceHub(w)), secret, plain, view, t, share, deal, task };
}

const leaks = (value) => JSON.stringify(value ?? null).includes(SECRET);

test('a space is open by default and an open space changes nothing for a one-person workspace', () => {
  const w = new Weave();
  const sp = w.createSpace({ name: 'Home' });
  assert.equal(w.getSpace(sp.id).access ?? 'open', 'open');
  assert.throws(() => w.updateSpace('Home', { access: 'secret' }), /open or private/);
});

test('spaces: a non-member does not see a private space in the space or table lists', async () => {
  const { call, t } = build();
  const spaces = await call('GET', '/api/spaces', { token: t.olive });
  assert.equal(spaces.status, 200);
  assert.ok(!spaces.json.some((s) => s.name === 'Sales'), 'the private space is not listed');
  const tables = await call('GET', '/api/tables', { token: t.olive });
  assert.ok(!tables.json.some((d) => d.qualified === 'Sales/Deal'));
  assert.equal((await call('GET', '/api/spaces/Sales', { token: t.olive })).status, 404);
  const member = await call('GET', '/api/spaces', { token: t.sam });
  assert.ok(member.json.some((s) => s.name === 'Sales'), 'a member sees it');
  const arc = await call('GET', '/api/spaces', { token: t.arc });
  assert.ok(arc.json.some((s) => s.name === 'Sales'), 'an architect sees every private space');
});

test('rows: a non-member gets 404 on a private table, its query and its rows', async () => {
  const { call, t, secret } = build();
  assert.equal((await call('GET', `/api/tables/${D}`, { token: t.olive })).status, 404);
  assert.equal((await call('POST', `/api/tables/${D}/query`, { token: t.olive, body: {} })).status, 404);
  assert.equal((await call('GET', `/api/entities/${secret.id}`, { token: t.olive })).status, 404);
  assert.equal((await call('PATCH', `/api/entities/${secret.id}`, { token: t.olive, body: { Amount: 1 } })).status, 404);
  const ok = await call('POST', `/api/tables/${D}/query`, { token: t.sam, body: {} });
  assert.equal(ok.status, 200);
  assert.ok(leaks(ok.json));
});

test('search: a non-member finds nothing from a private space', async () => {
  const { call, t } = build();
  const hits = await call('GET', `/api/search?q=${encodeURIComponent('Acme')}`, { token: t.olive });
  assert.equal(hits.status, 200);
  assert.ok(!leaks(hits.json), 'search leaks the private row');
  const scoped = await call('GET', `/api/search?q=Acme&tables=${encodeURIComponent('Sales/Deal')}`, { token: t.olive });
  assert.ok(!leaks(scoped.json));
  const member = await call('GET', '/api/search?q=Acme', { token: t.sam });
  assert.ok(leaks(member.json), 'a member finds it');
});

test('relations: a relation into a private space shows a locked chip to a non-member', async () => {
  const { call, t, plain, secret } = build();
  const res = await call('GET', `/api/entities/${plain.id}`, { token: t.olive });
  assert.equal(res.status, 200);
  assert.ok(!leaks(res.json), 'the related row leaks its name');
  const chip = res.json.fields.Deal[0];
  assert.equal(chip.locked, true);
  assert.equal(chip.id, secret.id);
  assert.equal(chip.publicId, null);
  const member = await call('GET', `/api/entities/${plain.id}`, { token: t.sam });
  assert.equal(member.json.fields.Deal[0].name, SECRET);
  assert.ok(!member.json.fields.Deal[0].locked);
});

test('lookups, rollups and formulas: a non-member gets no value from a private row', async () => {
  const { call, t, plain } = build();
  const olive = (await call('GET', `/api/entities/${plain.id}`, { token: t.olive })).json;
  assert.deepEqual(olive.raw['Deal Amount'], [], 'lookup reaches the private row');
  assert.equal(olive.raw['Deal Total'], 0, 'rollup reaches the private row');
  assert.ok(!leaks(olive.fields['Deal Names']), 'formula reaches the private row');
  const sam = (await call('GET', `/api/entities/${plain.id}`, { token: t.sam })).json;
  assert.deepEqual(sam.raw['Deal Amount'], [900]);
  assert.equal(sam.raw['Deal Total'], 900);
  const where = await call('POST', `/api/tables/${T}/query`, { token: t.olive, body: { where: [['Deal.Name', 'contains', 'Acme']] } });
  assert.equal(where.json.total, 0, 'a where clause probes the private row');
  const sorted = await call('POST', `/api/tables/${T}/query`, { token: t.olive, body: { sort: ['Deal Total'] } });
  assert.ok(!leaks(sorted.json));
});

test('views: a non-member sees a view without its private blocks', async () => {
  const { call, t, view } = build();
  const res = await call('GET', `/api/views/${view.id}`, { token: t.olive });
  assert.equal(res.status, 200);
  assert.ok(!leaks(res.json));
  assert.ok(!JSON.stringify(res.json).includes('Sales/Deal'));
  const list = await call('GET', '/api/views', { token: t.olive });
  assert.ok(!JSON.stringify(list.json).includes('Sales/Deal'));
});

test('schema and ontology: a non-member reads no private table or field', async () => {
  const { call, t } = build();
  for (const path of ['/api/schema', '/api/ontology', '/api/ontology?concept=Ops%2FTask']) {
    const res = await call('GET', path, { token: t.olive });
    assert.equal(res.status, 200, path);
    assert.ok(!JSON.stringify(res.json).includes('Sales/Deal'), `${path} names the private table`);
    assert.ok(!JSON.stringify(res.json).includes('"Amount"'), `${path} names a private field`);
  }
  const schema = await call('GET', '/api/schema', { token: t.olive });
  assert.ok(!schema.json.some((s) => s.space === 'Sales'));
  const arc = await call('GET', '/api/schema', { token: t.arc });
  assert.ok(arc.json.some((s) => s.space === 'Sales'));
});

test('registry: the System rows that mirror a private space stay hidden from a non-member', async () => {
  const { call, t } = build();
  for (const table of ['Spaces', 'Tables', 'Fields']) {
    const res = await call('POST', `/api/tables/${table}/query`, { token: t.olive, body: {} });
    assert.equal(res.status, 200, table);
    assert.ok(!res.json.items.some((r) => ['Sales', 'Deal', 'Amount'].includes(r.name) && (table !== 'Fields' || r.fields?.Table?.name === 'Deal')), `${table} mirrors the private space`);
  }
});

test('MCP: query, search, get and ontology answer nothing from a private space to a non-member', async () => {
  const { call, t, secret } = build();
  const rpc = async (name, args) => (await call('POST', '/api/mcp', { token: t.olive, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })).json.result;
  const q = await rpc('weave_query', { db: 'Sales/Deal' });
  assert.ok(q.isError && !leaks(q));
  const s = await rpc('weave_search', { text: 'Acme' });
  assert.ok(!leaks(s));
  const g = await rpc('weave_get_entity', { id: secret.id });
  assert.ok(g.isError && !leaks(g));
  const o = await rpc('weave_ontology', {});
  assert.ok(!JSON.stringify(o).includes('Sales/Deal'));
  const csv = await rpc('weave_export_csv', { db: 'Ops/Task' });
  assert.ok(!leaks(csv));
});

test('export: CSV and markdown exports carry nothing from a private space', async () => {
  const { call, t, secret, plain } = build();
  const csvPrivate = await call('GET', `/api/tables/${D}/export.csv`, { token: t.olive });
  assert.equal(csvPrivate.status, 404);
  const md = await call('GET', `/e/${secret.id}/entity.md`, { token: t.olive });
  assert.equal(md.status, 404);
  const doc = await call('GET', `/e/${secret.id}/doc.md`, { token: t.olive });
  assert.equal(doc.status, 404);
  const openMd = await call('GET', `/e/${plain.id}/entity.md`, { token: t.olive });
  assert.equal(openMd.status, 200);
  assert.ok(!leaks(openMd.json));
  const full = await call('GET', '/api/export', { token: t.olive });
  assert.ok(full.status === 403 || !leaks(full.json), 'the JSON export carries the private space');
});

test('export: the CSV of an open table shows a locked cell for a private relation', () => {
  const { w, task } = build();
  const olive = w.listAccounts().find((a) => a.name === 'olive');
  const csv = w.asAccount(olive, () => w.exportCSV(task.id));
  assert.ok(!csv.includes(SECRET));
});

test('share grants: a workspace link never reaches a private space', async () => {
  const { call, share, secret } = build();
  const spaces = await call('GET', `/s/${share.token}/api/spaces`);
  assert.equal(spaces.status, 200);
  assert.ok(!spaces.json.some((s) => s.name === 'Sales'));
  const row = await call('GET', `/s/${share.token}/api/entities/${secret.id}`);
  assert.equal(row.status, 404);
  const query = await call('POST', `/s/${share.token}/api/tables/${D}/query`, { body: {} });
  assert.equal(query.status, 404);
});

test('share grants: a link minted by a member stops at the space when the member leaves it', async () => {
  const { w, call, t } = build();
  const sam = w.listAccounts().find((a) => a.name === 'sam');
  const g = w.asAccount(sam, () => w.mintShare({ scope: { kind: 'table', id: 'Sales/Deal' }, mode: 'read' }));
  assert.equal((await call('POST', `/s/${g.token}/api/tables/${D}/query`, { body: {} })).status, 200);
  w.removeSpaceMember('Sales', 'sam');
  assert.equal((await call('POST', `/s/${g.token}/api/tables/${D}/query`, { body: {} })).status, 404);
  assert.ok(t.sam);
});

test('audit: a non-member reads no audit entry about a private space', async () => {
  const { call, t } = build();
  const olive = await call('GET', '/api/audit?limit=500', { token: t.olive });
  assert.equal(olive.status, 200);
  assert.ok(!olive.json.some((r) => (r.detail?.spaces ?? []).length && JSON.stringify(r).includes('Sales')), 'the audit log names the private space');
  assert.ok(!olive.json.some((r) => r.detail?.name === 'Deal' || r.detail?.name === 'Sales'));
  const arc = await call('GET', '/api/audit?limit=500', { token: t.arc });
  assert.ok(arc.json.some((r) => r.action === 'space-created' && r.detail?.name === 'Sales'));
});

test('space role: a workspace Observer who is a space Editor writes in that space only', async () => {
  const { w, call, t, plain } = build();
  w.setSpaceMember('Sales', 'obs', { role: 'editor' });
  const made = await call('POST', `/api/tables/${D}/entities`, { token: t.obs, body: { Name: 'New deal' } });
  assert.equal(made.status, 201);
  const elsewhere = await call('PATCH', `/api/entities/${plain.id}`, { token: t.obs, body: { Name: 'x' } });
  assert.equal(elsewhere.status, 403);
});

test('space role: a space Observer role takes write away from a workspace Editor in that space', async () => {
  const { w, call, t, secret } = build();
  w.setSpaceMember('Sales', 'sam', { role: 'observer' });
  assert.equal((await call('GET', `/api/entities/${secret.id}`, { token: t.sam })).status, 200);
  assert.equal((await call('PATCH', `/api/entities/${secret.id}`, { token: t.sam, body: { Amount: 1 } })).status, 403);
});

test('space role: a space Editor takes a paid seat', () => {
  const { w } = build();
  w.setSpaceMember('Sales', 'obs', { role: 'editor' });
  const obs = w.listAccounts().find((a) => a.name === 'obs');
  assert.equal(obs.seatRole, 'editor');
  assert.equal(w.listAccounts().find((a) => a.name === 'olive').seatRole, 'editor');
});

test('members: workspace Architects and space Architects manage a private space, nobody else', async () => {
  const { w, call, t } = build();
  assert.equal((await call('PUT', '/api/spaces/Sales/members/olive', { token: t.sam, body: {} })).status, 403);
  w.setSpaceMember('Sales', 'sam', { role: 'architect' });
  assert.equal((await call('PUT', '/api/spaces/Sales/members/olive', { token: t.sam, body: { role: 'observer' } })).status, 200);
  const list = await call('GET', '/api/spaces/Sales/members', { token: t.sam });
  assert.deepEqual(list.json.map((m) => [m.name, m.role]).sort(), [['olive', 'observer'], ['sam', 'architect']]);
  assert.equal((await call('DELETE', '/api/spaces/Sales/members/olive', { token: t.arc })).status, 200);
  assert.equal((await call('PATCH', '/api/spaces/Sales', { token: t.olive, body: { access: 'open' } })).status, 404);
  assert.equal((await call('PATCH', '/api/spaces/Sales', { token: t.arc, body: { access: 'open' } })).status, 200);
  assert.equal(w.getSpace('Sales').access ?? 'open', 'open');
});

test('agent tokens: a token scoped to one space reads that space only', async () => {
  const { w, call } = build();
  const scoped = w.createAccount({ name: 'bot', role: 'editor', space: 'Ops' }).token;
  const spaces = await call('GET', '/api/spaces', { token: scoped });
  assert.deepEqual(spaces.json.filter((s) => !s.system).map((s) => s.name), ['Ops']);
  assert.equal((await call('POST', `/api/tables/${D}/query`, { token: scoped, body: {} })).status, 404);
});

test('agent tokens: a token never exceeds the access of the account that issued it', async () => {
  const { w, call } = build();
  const sam = w.listAccounts().find((a) => a.name === 'sam');
  const minted = w.asAccount(sam, () => w.createAccount({ name: 'sam-bot', role: 'architect', space: 'Sales' }));
  assert.equal(minted.account.role, 'editor', 'the role is capped at the issuer’s');
  assert.equal(minted.account.issuedBy, sam.id);
  assert.equal((await call('POST', `/api/tables/${D}/query`, { token: minted.token, body: {} })).status, 200);
  w.removeSpaceMember('Sales', 'sam');
  assert.equal((await call('POST', `/api/tables/${D}/query`, { token: minted.token, body: {} })).status, 404, 'the token outlives its issuer’s access');
});

test('agent tokens: every write a scoped token makes lands in the audit log', async () => {
  const { w, call } = build();
  const scoped = w.createAccount({ name: 'bot', role: 'editor', space: 'Ops' }).token;
  const made = await call('POST', `/api/tables/${T}/entities`, { token: scoped, body: { Name: 'bot row' } });
  assert.equal(made.status, 201);
  const audit = w.listAudit({ limit: 20 });
  assert.ok(audit.some((r) => r.action === 'token-write' && r.actor === 'bot'), 'the scoped write is audited');
});
