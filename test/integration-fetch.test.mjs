import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');

const SECRET = 'pasted-integration-value-fetch-ijkl';

function intercept(answer) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return answer(String(url), init);
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const user = () => new Response(JSON.stringify([{ success: true, result: [{ 'user/name': 'Agent' }] }]), { status: 200 });

async function connected() {
  const w = new Weave({ actor: 'kyle', keystorePath: join(tempDir('weave-int-fetch-'), 'keystore.json') });
  const t = w.getTable('System/Integrations');
  const row = w.createEntity(t.id, { name: 'Fibery adriany', values: { Provider: 'Fibery', Host: 'adriany.fibery.io' } });
  const net = intercept(user);
  try { await w.setIntegrationCredential(row.id, SECRET); } finally { net.restore(); }
  return { w, t, row };
}

const keyUsed = (w) => {
  const audit = w.listAudit({ limit: 200 });
  return (audit.items ?? audit).filter((a) => a.action === 'key-used');
};

test('integrationFetch attaches the row key, reaches only the row Host, stamps Last Used and audits key-used', async () => {
  const { w, row } = await connected();
  assert.equal(w.readEntity(row.id).fields['Last Used'] ?? null, null);
  const net = intercept(() => new Response('{"ok":true}', { status: 201, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'sid=1' } }));
  let out;
  try {
    out = await w.integrationFetch('Fibery adriany', 'https://adriany.fibery.io/api/commands?x=1', { method: 'post', headers: { 'Content-Type': 'application/json' }, body: '[]' });
  } finally { net.restore(); }
  assert.equal(net.calls.length, 1);
  const [call] = net.calls;
  assert.equal(call.url, 'https://adriany.fibery.io/api/commands?x=1');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.get('authorization'), `Token ${SECRET}`);
  assert.equal(call.init.headers.get('content-type'), 'application/json');
  assert.equal(call.init.redirect, 'manual', 'a redirect is never followed with the key');
  assert.deepEqual({ status: out.status, ok: out.ok, body: out.body }, { status: 201, ok: true, body: '{"ok":true}' });
  assert.equal(out.headers['set-cookie'], undefined, 'no cookie comes back to the caller');
  assert.ok(w.readEntity(row.id).fields['Last Used'], 'Last Used is stamped');
  const [used] = keyUsed(w);
  assert.deepEqual({ ...used.detail, spaces: undefined }, { integration: 'Fibery adriany', host: 'adriany.fibery.io', method: 'POST', path: '/api/commands', status: 201, spaces: undefined });
  assert.equal(JSON.stringify(w.listAudit({ limit: 200 })).includes(SECRET), false);
  assert.equal(JSON.stringify(w.state).includes(SECRET), false);
});

test('any host other than Host is refused before a byte leaves, and the key is never sent', async () => {
  const { w, row } = await connected();
  const net = intercept(() => new Response('', { status: 200 }));
  try {
    for (const url of [
      'https://evil.example.com/api', 'http://adriany.fibery.io/api', 'https://adriany.fibery.io:8443/api',
      'https://u:p@adriany.fibery.io/api', 'https://evil.adriany.fibery.io/api', 'https://adriany.fibery.io.evil.com/api',
      'https://other.fibery.io/api', 'not a url',
    ]) {
      await assert.rejects(w.integrationFetch(row.id, url), { code: /forbidden|invalid/ }, url);
    }
  } finally { net.restore(); }
  assert.equal(net.calls.length, 0, 'no request went out');
  assert.equal(keyUsed(w).length, 0, 'a refused call is not a use');
  assert.equal(w.readEntity(row.id).fields['Last Used'] ?? null, null);
});

test('the caller cannot set Authorization, Proxy-Authorization or Cookie, nor an unknown method', async () => {
  const { w, row } = await connected();
  const net = intercept(() => new Response('', { status: 200 }));
  try {
    for (const headers of [{ Authorization: 'Bearer mine' }, { 'proxy-authorization': 'x' }, { Cookie: 'a=b' }]) {
      await assert.rejects(w.integrationFetch(row.id, 'https://adriany.fibery.io/', { headers }), { code: 'invalid' });
    }
    await assert.rejects(w.integrationFetch(row.id, 'https://adriany.fibery.io/', { method: 'TRACE' }), { code: 'invalid' });
  } finally { net.restore(); }
  assert.equal(net.calls.length, 0);
});

test('an Off row, a row with no key, a moved Host and a deleted row all refuse', async () => {
  const { w, t, row } = await connected();
  const net = intercept(() => new Response('', { status: 200 }));
  try {
    w.updateEntity(row.id, { On: false });
    await assert.rejects(w.integrationFetch(row.id, 'https://adriany.fibery.io/'), { code: 'forbidden' });
    w.updateEntity(row.id, { On: true, Host: 'other.fibery.io' });
    await assert.rejects(w.integrationFetch(row.id, 'https://other.fibery.io/'), /no key/);
    const bare = w.createEntity(t.id, { name: 'Bare', values: { Provider: 'Generic API key', Host: 'api.example.com' } });
    await assert.rejects(w.integrationFetch(bare.id, 'https://api.example.com/'), /no key/);
    w.deleteEntity(bare.id);
    await assert.rejects(w.integrationFetch(bare.id, 'https://api.example.com/'), { code: 'not-found' });
    await assert.rejects(w.integrationFetch('nope', 'https://api.example.com/'), { code: 'not-found' });
  } finally { net.restore(); }
  assert.equal(net.calls.length, 0);
});

test('a response that echoes the key comes back with the key redacted', async () => {
  const { w, row } = await connected();
  const net = intercept(() => new Response(`you sent ${SECRET}`, { status: 200 }));
  let out;
  try { out = await w.integrationFetch(row.id, 'https://adriany.fibery.io/echo'); } finally { net.restore(); }
  assert.equal(out.body, 'you sent ••••');
});

test('a redirect comes back to the caller unfollowed', async () => {
  const { w, row } = await connected();
  const net = intercept(() => new Response('', { status: 302, headers: { Location: 'https://evil.example.com/' } }));
  let out;
  try { out = await w.integrationFetch(row.id, 'https://adriany.fibery.io/'); } finally { net.restore(); }
  assert.equal(net.calls.length, 1);
  assert.equal(out.status, 302);
});

test('an unreachable host is still a recorded use: Last Used, a key-used entry with the error, and a refusal', async () => {
  const { w, row } = await connected();
  const net = intercept(() => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); });
  try { await assert.rejects(w.integrationFetch(row.id, 'https://adriany.fibery.io/'), /ECONNRESET/); } finally { net.restore(); }
  const [used] = keyUsed(w);
  assert.equal(used.detail.status, null);
  assert.match(used.detail.error, /ECONNRESET/);
  assert.ok(w.readEntity(row.id).fields['Last Used']);
});

test('a Generic API key row sends a bearer header', async () => {
  const w = new Weave({ keystorePath: join(tempDir('weave-int-fetch-'), 'keystore.json') });
  const t = w.getTable('System/Integrations');
  const row = w.createEntity(t.id, { name: 'Airtable', values: { Provider: 'Generic API key', Host: 'api.airtable.com' } });
  let net = intercept(() => new Response('', { status: 200 }));
  try { await w.setIntegrationCredential(row.id, SECRET); } finally { net.restore(); }
  net = intercept(() => new Response('[]', { status: 200 }));
  try { await w.integrationFetch(row.id, 'https://api.airtable.com/v0/meta/bases'); } finally { net.restore(); }
  assert.equal(net.calls[0].init.headers.get('authorization'), `Bearer ${SECRET}`);
});
