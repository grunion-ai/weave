import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import * as Forms from '../src/forms.js';

function workspace(name = 'acme') {
  const w = new Weave({ name });
  w.createSpace({ name: 'Intake' });
  const table = w.createTable({ space: 'Intake', name: 'Request' });
  w.addField(table.id, { name: 'Source', type: 'text' });
  const tokens = Object.fromEntries(['architect', 'editor', 'observer'].map(role => [role, w.createAccount({ name: role, role }).token]));
  w.setRequireAuth(true);
  return { w, table, tokens };
}

async function fixture(t, { hub = false } = {}) {
  const f = workspace();
  const other = workspace('other');
  const root = hub ? workspace('root').w : f.w;
  const { server } = await startServer(root, { port: 0, ...(hub ? { workspaces: { acme: f.w, other: other.w } } : {}) });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token = f.tokens.architect) => {
    const response = await fetch(base + (hub ? '/w/acme' : '') + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  return { ...f, other, root, call };
}

const spec = table => ({ name: 'Public intake', table: table.id, fields: [{ field: 'Name', key: 'subject', label: 'Subject', required: true }], hidden: { Source: 'secret default' }, floor: 'Anonymous' });

test('native management creates, reads and updates one stable form without exposing hidden values publicly', async t => {
  const { w, table, call } = await fixture(t);
  const made = await call('POST', '/api/forms', spec(table));
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.tableId, table.id);
  assert.equal(made.data.hiddenValues[w.findField(table, 'Source').id], 'secret default');
  const list = await call('GET', `/api/forms/manage?table=${table.id}`);
  assert.equal(list.status, 200);
  assert.equal(list.data.requireAuth, true);
  assert.equal(typeof list.data.anonymousAllowed, 'boolean');
  assert.equal(list.data.forms[0].id, made.data.id);
  const updated = await call('PATCH', `/api/forms/${made.data.id}`, { name: 'Updated', fields: [{ field: 'Name', key: 'newSubject', label: 'New subject' }], enabled: false });
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  assert.equal(updated.data.id, made.data.id);
  assert.ok(updated.data.fields[0].aliases.includes('subject'));
  assert.equal(updated.data.enabled, false);
  const publicRead = await call('GET', `/api/forms/${made.data.id}`);
  assert.equal(publicRead.data.hiddenValues, undefined);
  assert.ok(!JSON.stringify(publicRead.data).includes('secret default'));
});

test('management endpoints reject observer/editor and signed-out callers', async t => {
  const { table, tokens, call } = await fixture(t);
  const made = await call('POST', '/api/forms', spec(table));
  for (const role of ['observer', 'editor']) {
    assert.equal((await call('GET', '/api/forms/manage', null, tokens[role])).status, 403);
    assert.equal((await call('POST', '/api/forms', spec(table), tokens[role])).status, 403);
    assert.equal((await call('PATCH', `/api/forms/${made.data.id}`, { enabled: false }, tokens[role])).status, 403);
  }
  assert.equal((await call('GET', '/api/forms/manage', null, null)).status, 401);
});

test('invalid mixed updates are atomic and built-in bug forms cannot be edited', async t => {
  const { w, table, call } = await fixture(t);
  const made = await call('POST', '/api/forms', spec(table));
  const bad = await call('PATCH', `/api/forms/${made.data.id}`, { name: 'Wrong', floor: 'Invalid', enabled: false });
  assert.equal(bad.status, 400);
  assert.equal(Forms.getForm(w, made.data.id).name, 'Public intake');
  assert.equal(Forms.getForm(w, made.data.id).enabled, true);
  assert.equal((await call('PATCH', `/api/forms/${made.data.id}`, { name: 'Wrong', fields: [{ field: 'missing' }] })).status, 400);
  assert.equal(Forms.getForm(w, made.data.id).name, 'Public intake');
  const bug = Forms.createForm(w, { name: 'Built in', table: table.id, kind: 'Bug report', fields: ['Name'] });
  assert.equal((await call('PATCH', `/api/forms/${bug.id}`, { name: 'Changed' })).status, 403);
  assert.equal((await call('POST', '/api/forms', { ...spec(table), kind: 'Bug report' })).status, 400);
});

test('engine management confines definitions and updates to their owning workspace', () => {
  const a = workspace('a');
  const b = workspace('b');
  a.w.registryHost = b.w;
  b.w.members = [a.w];
  const form = Forms.createForm(b.w, spec(b.table));
  assert.throws(() => Forms.getFormDefinition(a.w, form.id), e => e.code === 'not-found');
  assert.throws(() => Forms.updateForm(a.w, form.id, { enabled: false }), e => e.code === 'not-found');
  assert.equal(Forms.getForm(b.w, form.id).enabled, true);
});

test('a member architect cannot change or read private form configuration on the root registry', async t => {
  const { table, call } = await fixture(t, { hub: true });
  assert.equal((await call('GET', '/api/forms/manage')).status, 403);
  assert.equal((await call('POST', '/api/forms', spec(table))).status, 403);
});

test('accountless management respects the auth wall and retains local open access', async t => {
  const w = new Weave();
  w.createSpace({ name: 'Intake' });
  const table = w.createTable({ space: 'Intake', name: 'Request' });
  Forms.createForm(w, { name: 'Private configuration', table: table.id, fields: ['Name'], hidden: { Description: 'private default' } });
  const { server } = await startServer(w, { port: 0 });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/forms/manage`;
  assert.equal((await fetch(url)).status, 200);
  w.setRequireAuth(true);
  const refused = await fetch(url);
  assert.equal(refused.status, 401);
  assert.ok(!(await refused.text()).includes('private default'));
});

test('an accountless root auth wall blocks a member architect from managing forms', async t => {
  const root = new Weave({ name: 'root' });
  root.setRequireAuth(true);
  const member = workspace('acme');
  const { server } = await startServer(root, { port: 0, workspaces: { acme: member.w } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/w/acme/api/forms`;
  const headers = { Authorization: `Bearer ${member.tokens.architect}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${url}/manage`, { headers })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(spec(member.table)) })).status, 403);
});
