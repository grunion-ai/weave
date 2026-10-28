import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Weave } from '../src/engine.js';
import { startIdp, serveOidc } from './lib/idp.mjs';

async function fixture(options = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Marketing' });
  w.createTable({ space: 'Marketing', name: 'Posts' });
  w.addField('Posts', { name: 'Image', type: 'attachments' });
  const row = w.createEntity('Posts', { Name: 'Poster' });
  w.createAccount({ name: 'root', role: 'architect' });
  w.createAccount({ name: 'agent', role: 'editor' });
  const idp = await startIdp();
  w.redeemIdentityInvite(w.linkIdentity('agent', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'agent' });
  w.setRequireAuth(true);
  const other = new Weave();
  const s = await serveOidc(w, idp, { workspaces: { other }, ...options });
  const token = idp.mint({ sub: 'agent' });
  const prepare = async (args = {}, prefix = '') => {
    const res = await s.call('POST', `${prefix}/mcp`, { token, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_attach_file', arguments: { entity: row.id, field: 'Image', name: 'poster.png', mime: 'image/png', size: 4, prepare: true, ...args } } } });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    return body.result.isError ? body.result : JSON.parse(body.result.content[0].text);
  };
  return { ...s, w, row, prepare, token };
}
const put = (grant, bytes = Buffer.from([0, 1, 2, 255])) => fetch(grant.url, { method: grant.method, headers: grant.headers, body: bytes });

test('OAuth prepares a bounded raw upload to an attachment field without an editor token or base64', async () => {
  const s = await fixture();
  try {
    const grant = await s.prepare();
    assert.equal(s.w.readEntity(s.row.id).files.length, 0);
    assert.equal(grant.method, 'PUT');
    assert.equal(grant.maxBytes, 4);
    assert.ok(Date.parse(grant.expiresAt) > Date.now());
    const res = await put(grant);
    assert.equal(res.status, 201, await res.clone().text());
    const file = await res.json();
    assert.deepEqual(s.w.readFile(file.id).bytes, Buffer.from([0, 1, 2, 255]));
    assert.equal(s.w.getEntity(s.row.id).values[s.w.getField('Posts', 'Image').id][0], file.id);
    assert.equal((await put(grant)).status, 401);
    assert.ok(s.w.getEntity(s.row.id).activity.some((a) => a.kind === 'file-attached' && a.actor.includes('account:')));
  } finally { s.stop(); }
});

test('upload grants cannot reach another workspace, endpoint, or carry different byte counts', async () => {
  const s = await fixture();
  try {
    const grant = await s.prepare();
    assert.equal((await fetch(`${s.base}/w/other/api/uploads`, { method: 'PUT', headers: grant.headers, body: '1234' })).status, 401);
    assert.equal((await fetch(`${s.base}/api/entities/${s.row.id}`, { headers: grant.headers })).status, 401);
    assert.equal((await put(grant, Buffer.alloc(5))).status, 413);
    assert.equal((await put(grant)).status, 401);
    const short = await s.prepare();
    assert.equal((await put(short, Buffer.alloc(3))).status, 400);
    assert.equal(s.w.readEntity(s.row.id).files.length, 0);
  } finally { s.stop(); }
});

test('upload preparation validates size, destination and permission; redemption rechecks roles and expiry', async () => {
  const s = await fixture();
  try {
    for (const args of [{ size: -1 }, { size: 10 * 1024 * 1024 + 1 }, { field: 'Name' }, { entity: 'missing' }]) assert.equal((await s.prepare(args)).isError, true);
    const grant = await s.prepare();
    s.w.setAccountRole('agent', 'observer');
    assert.equal((await s.prepare()).isError, true);
    assert.equal((await put(grant)).status, 403);
    s.w.setAccountRole('agent', 'editor');
    const expired = await s.prepare();
    const now = Date.now;
    Date.now = () => now() + 11 * 60 * 1000;
    try { assert.equal((await put(expired)).status, 401); } finally { Date.now = now; }
    const deleted = await s.prepare();
    s.w.deleteAccount('agent');
    assert.equal((await put(deleted)).status, 401);
  } finally { s.stop(); }
});

test('a grant is bound to the workspace path and hostname and parallel replay attaches once', async () => {
  const s = await fixture();
  try {
    const prefix = `/w/${s.w.state.meta.name}`;
    const grant = await s.prepare({}, prefix);
    assert.ok(grant.url.endsWith(`${prefix}/api/uploads`));
    assert.equal((await fetch(`${s.base}/api/uploads`, { method: 'PUT', headers: grant.headers, body: '1234' })).status, 401);
    assert.equal((await fetch(grant.url.replace('localhost', '127.0.0.1'), { method: 'PUT', headers: grant.headers, body: '1234' })).status, 401);
    const replies = await Promise.all([put(grant), put(grant)]);
    assert.deepEqual(replies.map((r) => r.status).sort(), [201, 401]);
    assert.equal(s.w.readEntity(s.row.id).files.length, 1);
  } finally { s.stop(); }
});

test('streamed bytes are bounded and a removed attachment field cannot redirect the upload', async () => {
  const s = await fixture();
  try {
    const grant = await s.prepare();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5)); controller.close(); } });
    const res = await fetch(grant.url, { method: 'PUT', headers: grant.headers, body, duplex: 'half' });
    assert.equal(res.status, 413);
    const gone = await s.prepare();
    s.w.deleteField('Posts', 'Image');
    assert.equal((await put(gone)).status, 404);
    assert.equal(s.w.readEntity(s.row.id).files.length, 0);
  } finally { s.stop(); }
});

test('a named workspace host returns a usable upload URL on that same host', async () => {
  const s = await fixture({ baseDomain: 'weave.test' });
  try {
    const host = `${s.w.state.meta.name.toLowerCase()}.weave.test`;
    const hosted = (method, path, headers, body) => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: s.port, method, path, headers: { ...headers, Host: host } }, (res) => {
        let text = '';
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: new Headers(res.headers), json: async () => JSON.parse(text) }));
      });
      req.on('error', reject);
      req.end(body);
    });
    const res = await hosted('POST', '/mcp', { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_call', arguments: { name: 'weave_attach_file', args: { entity: s.row.id, field: 'Image', name: 'poster.png', prepare: true, size: 4 } } } }));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const rpc = await res.json();
    assert.ok(!rpc.result.isError, JSON.stringify(rpc));
    const grant = JSON.parse(rpc.result.content[0].text);
    assert.equal(grant.url, `http://${host}/api/uploads`);
    const uploaded = await hosted(grant.method, '/api/uploads', grant.headers, '1234');
    assert.equal(uploaded.status, 201, JSON.stringify(await uploaded.json()));
    assert.equal(uploaded.headers.get('cache-control'), 'no-store');
  } finally { s.stop(); }
});

test('unlinking the OAuth identity revokes its outstanding upload grant', async () => {
  const s = await fixture();
  try {
    const grant = await s.prepare();
    const identity = s.w.listAccounts().find((a) => a.name === 'agent').identities[0];
    s.w.unlinkIdentity('agent', identity);
    assert.equal((await put(grant)).status, 401);
    assert.equal(s.w.readEntity(s.row.id).files.length, 0);
  } finally { s.stop(); }
});
