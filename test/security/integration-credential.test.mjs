import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');
const { dispatchTool } = await import('../../src/mcp.js');

const SECRET = 'pasted-integration-value-sealed-qrst';

async function seed() {
  const dir = tempDir('weave-int-sec-');
  const w = new Weave({ path: join(dir, 'ws.db'), keystorePath: join(dir, 'keystore.json') });
  w.createSpace({ name: 'Work' });
  w.createTable({ space: 'Work', name: 'Task' });
  const t = w.getTable('System/Integrations');
  const row = w.createEntity(t.id, { name: 'Fibery', values: { Provider: 'Fibery', Host: 'acme.fibery.io' } });
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ success: true, result: [{ 'user/name': 'Agent' }] }]), { status: 200 });
  try { await w.setIntegrationCredential(row.id, SECRET); } finally { globalThis.fetch = real; }
  assert.equal(w.readEntity(row.id).fields.State, 'Connected', 'the key is stored');
  return { w, t, row, dir };
}

const leaks = (label, text) => assert.equal(String(text).includes(SECRET) || String(text).includes(SECRET.slice(0, 12)), false, `${label} carries the key`);

test('the stored key never comes back from an engine read, query, search, export, CSV, activity or audit', async () => {
  const { w, t, row } = await seed();
  leaks('readEntity', JSON.stringify(w.readEntity(row.id)));
  leaks('query', JSON.stringify(w.query(t.id, {})));
  leaks('search', JSON.stringify(w.search('Fibery')));
  leaks('exportJSON', JSON.stringify(w.exportJSON()));
  leaks('exportCSV', w.exportCSV(t.id));
  leaks('activityFeed', JSON.stringify(w.activityFeed({ limit: 500 })));
  leaks('row activity', JSON.stringify(w.activityFeed({ entityId: row.id, limit: 500 })));
  leaks('listAudit', JSON.stringify(w.listAudit({ limit: 500 })));
  leaks('describeSchema', JSON.stringify(w.describeSchema()));
  leaks('engine state', JSON.stringify(w.state));
});

test('the key is in no file on disk but the keystore, and there only as ciphertext', async () => {
  const { w, dir } = await seed();
  w.save();
  const files = readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f))).filter((p) => existsSync(p) && !p.endsWith('/'));
  assert.ok(files.some((p) => p.endsWith('ws.db')));
  for (const p of files) {
    let bytes;
    try { bytes = readFileSync(p); } catch { continue; }
    assert.equal(bytes.includes(Buffer.from(SECRET)), false, `${p} holds the key in the clear`);
  }
});

test('no HTTP response carries the key: rows, queries, export, CSV, activity, audit, search', async () => {
  const { w, t, row } = await seed();
  const admin = w.createAccount({ name: 'root', role: 'architect' });
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body) => fetch(base + path, {
    method, headers: { Authorization: `Bearer ${admin.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    for (const [method, path, body] of [
      ['GET', `/api/entities/${row.id}`],
      ['POST', `/api/tables/${t.id}/query`, {}],
      ['GET', `/api/tables/${t.id}/entities`],
      ['GET', `/api/tables/${t.id}/export.csv`],
      ['GET', '/api/export'],
      ['GET', '/api/schema'],
      ['GET', '/api/activity'],
      ['GET', `/api/activity?entity=${row.id}`],
      ['GET', '/api/audit'],
      ['GET', '/api/keys'],
      ['GET', '/api/search?q=Fibery'],
      ['POST', `/api/keys/${encodeURIComponent(`integration:${row.id}`)}/reveal`, { via: 'show' }],
      ['POST', `/api/keys/${encodeURIComponent(`integration:${row.id}`)}/reveal`, { via: 'copy' }],
    ]) {
      const res = await call(method, path, body);
      leaks(`${method} ${path} (${res.status})`, await res.text());
    }
    assert.equal((await call('POST', `/api/keys/${encodeURIComponent(`integration:${row.id}`)}/reveal`, { via: 'show' })).status, 403, 'the reveal door is shut');
  } finally { server.close(); }
});

test('a share link over the whole workspace never carries the key', async () => {
  const { w, t, row } = await seed();
  w.createAccount({ name: 'root', role: 'architect' });
  w.setRequireAuth(true);
  const g = w.mintShare({ scope: { kind: 'workspace', id: w.state.meta.id }, mode: 'read' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of [`/s/${g.token}`, `/s/${g.token}/workspace`, `/s/${g.token}/table/${t.id}`, `/s/${g.token}/e/${row.id}/entity.html`, '/api/share', `/api/entities/${row.id}`, `/api/tables/${t.id}/entities`]) {
      const res = await fetch(base + path, { headers: { Authorization: `Bearer ${g.token}` }, redirect: 'manual' });
      leaks(`share ${path} (${res.status})`, await res.text());
    }
  } finally { server.close(); }
});

test('no MCP read carries the key, and the MCP keystore tool cannot reveal, overwrite or delete it', async () => {
  const { w, t, row } = await seed();
  for (const [name, args] of [
    ['weave_get_entity', { entity: row.id }],
    ['weave_query', { db: t.id }],
    ['weave_search', { text: 'Fibery' }],
    ['weave_schema', {}],
    ['weave_keys', { action: 'list' }],
  ]) {
    let out;
    try { out = await dispatchTool(w, name, args); } catch (err) { out = err.message; }
    leaks(name, JSON.stringify(out));
  }
  for (const args of [{ action: 'set', name: `integration:${row.id}`, value: 'x' }, { action: 'delete', name: `integration:${row.id}` }, { action: 'share', name: `integration:${row.id}`, account: true }]) {
    assert.throws(() => dispatchTool(w, 'weave_keys', args), /Integrations row/, args.action);
  }
  assert.equal(w.hasKey(`integration:${row.id}`), true, 'the key is still sealed');
});

test('a workflow cannot borrow an integration key to sign a webhook', async () => {
  const { w, row } = await seed();
  assert.throws(() => w.resolveKey(`integration:${row.id}`), { code: 'forbidden' });
});

test('PUT /api/integrations/:id/credential: only an architect sets a key, nobody reads it, and the answer never echoes it', async () => {
  const { createWorkspaceHub } = await import('../../src/server.js');
  const { client } = await import('../lib/fixtures.mjs');
  const dir = tempDir('weave-int-route-');
  const w = new Weave({ keystorePath: join(dir, 'keystore.json') });
  const admin = w.createAccount({ name: 'root', role: 'architect' });
  const editor = w.createAccount({ name: 'ed', role: 'editor' });
  const t = w.getTable('System/Integrations');
  const row = w.createEntity(t.id, { name: 'Fibery', values: { Provider: 'Fibery', Host: 'acme.fibery.io' } });
  const call = client(createWorkspaceHub(w));
  const path = `/api/integrations/${row.id}/credential`;
  assert.equal((await call('PUT', path, { body: { value: SECRET } })).status, 401);
  assert.equal((await call('PUT', path, { token: editor.token, body: { value: SECRET } })).status, 403);
  assert.equal((await call('GET', path, { token: admin.token })).status, 405);
  assert.equal(w.hasKey(`integration:${row.id}`), false, 'refused writes stored nothing');
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ success: true, result: [{ 'user/name': 'Agent' }] }]), { status: 200 });
  let res;
  try { res = await call('PUT', path, { token: admin.token, body: { value: SECRET } }); } finally { globalThis.fetch = real; }
  assert.equal(res.status, 200);
  assert.equal(res.json.connected, true);
  assert.equal(res.json.fields.State, 'Connected');
  leaks('the PUT answer', JSON.stringify(res.json));
  assert.equal((await call('PUT', `/api/integrations/nope/credential`, { token: admin.token, body: { value: SECRET } })).status, 404);
  assert.equal((await call('PUT', path, { token: admin.token, body: {} })).status, 400);
});
