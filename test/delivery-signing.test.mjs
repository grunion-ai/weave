import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const { GUIDES } = await import('../src/handbook.js');
const { TOOLS } = await import('../src/mcp.js');

const SECRET = 'whsec-http-request-signing-9090';
const API_KEY = 'sk-signed-integration-value-3030';
const HOST = 'api.example.com';
const NOW = Date.parse('2026-11-09T16:00:00Z');

async function endpoint() {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const real = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    const u = new URL(String(url));
    if (u.protocol === 'https:' && u.hostname === HOST) { u.protocol = 'http:'; u.host = `127.0.0.1:${port}`; }
    return real(u, init);
  };
  return {
    seen, url: `http://127.0.0.1:${port}/in`,
    close: () => { globalThis.fetch = real; server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); },
  };
}

function demo() {
  const dir = tempDir('weave-signing-');
  const w = new Weave({ actor: 'kyle', keystorePath: join(dir, 'keystore.json') });
  w.now = () => new Date(NOW);
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  return { w, t };
}

const verify = (secret, { headers, body }) => headers['x-weave-signature'] === `sha256=${createHmac('sha256', secret).update(`${headers['x-weave-timestamp']}.${body}`).digest('hex')}`;

test('an http-request that names signWith is signed with the webhook recipe, and the Script keeps the name alone', async () => {
  const api = await endpoint();
  try {
    const { w, t } = demo();
    w.setKey('partner-hook', SECRET);
    const auto = w.createAutomation(t.id, {
      name: 'Signed call', trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'PUT', url: `${api.url}/{{PublicId}}`, signWith: 'partner-hook', body: { name: '{{Name}}' } }],
    });
    assert.equal(JSON.parse(w.readEntity(auto.id).docs.Script).actions[0].signWith, 'partner-hook');
    w.createEntity(t.id, { Name: 'Signed' });
    await w.automationsSettled();
    const [got] = api.seen;
    assert.equal(got.headers['x-weave-timestamp'], String(NOW / 1000));
    assert.match(got.headers['x-weave-delivery'], /^[0-9a-f-]{36}$/);
    assert.ok(verify(SECRET, got), 'the receiver recomputes the signature over the raw body');
    assert.equal(JSON.stringify(w.state).includes(SECRET), false);
    assert.equal(w.readEntity(auto.id).fields.Health, 'Healthy');
  } finally { await api.close(); }
});

test('an http-request through an integration carries the timestamp and delivery id beside its key, and a signature when it also names signWith', async () => {
  const api = await endpoint();
  try {
    const { w, t } = demo();
    w.setKey('partner-hook', SECRET);
    const ints = w.getTable('System/Integrations');
    const integration = w.createEntity(ints.id, { name: 'Acme API', values: { Provider: 'Generic API key', Host: HOST } });
    await w.setIntegrationCredential(integration.id, API_KEY);
    api.seen.length = 0;
    w.createAutomation(t.id, {
      name: 'Keyed', trigger: { type: 'entity-created' },
      actions: [
        { type: 'http-request', method: 'POST', integration: 'Acme API', url: `https://${HOST}/v1/a`, body: { n: 1 } },
        { type: 'http-request', method: 'POST', integration: 'Acme API', signWith: 'partner-hook', url: `https://${HOST}/v1/b`, body: { n: 2 } },
      ],
    });
    w.createEntity(t.id, { Name: 'Keyed' });
    await w.automationsSettled();
    const [plain, signed] = api.seen;
    assert.equal(plain.headers.authorization, `Bearer ${API_KEY}`);
    assert.equal(plain.headers['x-weave-timestamp'], String(NOW / 1000));
    assert.match(plain.headers['x-weave-delivery'], /^[0-9a-f-]{36}$/);
    assert.equal(plain.headers['x-weave-signature'], undefined, 'the integration key authenticates a call that names no signWith');
    assert.ok(verify(SECRET, signed));
    assert.notEqual(plain.headers['x-weave-delivery'], signed.headers['x-weave-delivery']);
  } finally { await api.close(); }
});

test('an http-request with no credential sends no weave headers, and one naming a credential the keystore lacks sends nothing', async () => {
  const api = await endpoint();
  try {
    const { w, t } = demo();
    const auto = w.createAutomation(t.id, {
      name: 'Plain', trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'POST', url: api.url, body: 'x' }],
    });
    w.createEntity(t.id, { Name: 'Plain' });
    await w.automationsSettled();
    assert.deepEqual(Object.keys(api.seen[0].headers).filter((k) => k.startsWith('x-weave-')), []);
    w.updateAutomation(auto.id, { enabled: false });
    const unsignable = w.createAutomation(t.id, {
      name: 'Unsignable', trigger: { type: 'entity-created' },
      actions: [{ type: 'http-request', method: 'POST', url: api.url, body: 'x', signWith: 'never-set' }],
    });
    w.createEntity(t.id, { Name: 'Unsignable' });
    await w.automationsSettled();
    assert.equal(api.seen.length, 1, 'an unsignable call is not sent unsigned');
    assert.equal(w.readEntity(unsignable.id).fields.Health, 'Failed');
    assert.match(w.readEntity(unsignable.id).fields['Health Reason'], /never-set/);
    assert.deepEqual(w.pendingDeliveries(), [], 'a missing credential is not retried');
    assert.throws(() => w.createAutomation(t.id, { name: 'Bad', trigger: { type: 'entity-created' }, actions: [{ type: 'http-request', url: api.url, signWith: 7 }] }), /signWith/);
  } finally { await api.close(); }
});

test('the guide documents signing for both actions and the replay protection a receiver keeps, and the MCP tool names signWith on http-request', () => {
  const guide = GUIDES.find((g) => g.name === 'Automations').doc;
  assert.match(guide, /## Signed deliveries/);
  assert.match(guide, /`http-request`[^\n]*`signWith`/);
  assert.match(guide, /five minutes/);
  assert.match(guide, /same `X-Weave-Delivery`/);
  const tool = TOOLS.find((x) => x.name === 'weave_create_automation');
  assert.match(tool.description, /http-request[^|]*signWith/);
});
