/* The hosted MCP door (Feature #254): /mcp and /w/<name>/mcp are /api/mcp
   behind an OAuth 2.1 protected resource, so `claude mcp add --transport
   http weave https://<host>/mcp` signs a person in through the browser. The
   instance publishes RFC 9728 metadata naming door C's provider as the
   authorization server; a call without a credential is a 401 that points at
   it; the provider's access token is checked at its userinfo endpoint and
   the subject opens the account a door C invite pinned it to (Feature #252:
   no email is asked for or kept). wv_ tokens are
   untouched. The provider is test/lib/idp.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Weave } from '../src/engine.js';
import { startServer, mcpOriginsFromEnv } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { startIdp } from './lib/idp.mjs';

const KYLE = { sub: 'user_kyle' };
const ANN = { sub: 'user_ann' };
/* The browser half of door C, done: the invite is opened once and pins the subject. */
const pin = (w, name, issuer, subject) => w.redeemIdentityInvite(w.linkIdentity(name, { issuer }).code, { issuer, subject });

async function serve({ configured = true, origin = null, mcpOrigins } = {}) {
  const idp = await startIdp();
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const admin = w.createAccount({ name: 'root', role: 'architect' }).token;
  w.createAccount({ name: 'kyle', role: 'architect' });
  pin(w, 'kyle', idp.issuer, KYLE.sub);
  w.setRequireAuth(true);
  const docs = new Weave();
  docs.createSpace({ name: 'Docs' });
  docs.createTable({ space: 'Docs', name: 'Page' });
  docs.createAccount({ name: 'ann', role: 'architect' });
  pin(docs, 'ann', idp.issuer, ANN.sub);
  docs.setRequireAuth(true);
  const oidc = configured ? createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' }) : null;
  const { server } = await startServer(w, { port: 0, origin, oidc, workspaces: { docs }, ...(mcpOrigins ? { mcpOrigins } : {}) });
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const call = (method, path, { token, body, headers = {} } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  const rpc = async (path, token, method, params) => {
    const res = await call('POST', path, { token, body: { jsonrpc: '2.0', id: 1, method, params } });
    return { res, data: res.status === 200 ? await res.json() : await res.json().catch(() => null) };
  };
  /* fetch will not send a Host of our choosing; node:http will. */
  const withHost = (host, path) => new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    }).on('error', reject).end();
  });
  return { w, docs, idp, admin, base, call, rpc, withHost, stop: () => { server.close(); idp.stop(); } };
}

test('metadata: RFC 9728 names the provider as the authorization server, for the root, /mcp and a workspace', async () => {
  const s = await serve();
  try {
    for (const [suffix, resource] of [['/mcp', `${s.base}/mcp`], ['/w/docs/mcp', `${s.base}/w/docs/mcp`], ['', s.base]]) {
      const res = await s.call('GET', `/.well-known/oauth-protected-resource${suffix}`);
      assert.equal(res.status, 200, suffix);
      assert.deepEqual(await res.json(), {
        resource,
        authorization_servers: [s.idp.issuer],
        scopes_supported: ['openid'],
        bearer_methods_supported: ['header'],
      });
    }
    assert.equal((await s.call('GET', '/.well-known/oauth-protected-resource/w/nowhere/mcp')).status, 404, 'no workspace, no resource');
  } finally { s.stop(); }
});

test('metadata: without a provider there is no protected resource, and /mcp is /api/mcp behind the usual wall', async () => {
  const s = await serve({ configured: false });
  try {
    assert.equal((await s.call('GET', '/.well-known/oauth-protected-resource/mcp')).status, 404);
    assert.equal((await s.call('GET', '/.well-known/oauth-protected-resource')).status, 404);
    const bare = await s.call('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(bare.status, 401);
    assert.equal(bare.headers.get('www-authenticate'), null, 'no metadata to point at');
    const { res, data } = await s.rpc('/mcp', s.admin, 'tools/list');
    assert.equal(res.status, 200);
    assert.ok(data.result.tools.length > 10);
  } finally { s.stop(); }
});

test('401: a call with no credential names the metadata document, per workspace', async () => {
  const s = await serve();
  try {
    for (const [path, meta] of [['/mcp', '/.well-known/oauth-protected-resource/mcp'], ['/w/docs/mcp', '/.well-known/oauth-protected-resource/w/docs/mcp']]) {
      const res = await s.call('POST', path, { body: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
      assert.equal(res.status, 401, path);
      assert.equal(res.headers.get('www-authenticate'), `Bearer resource_metadata="${s.base}${meta}"`);
      assert.equal((await res.json()).code, 'unauthorized');
    }
  } finally { s.stop(); }
});

test('origin: the resource is a configured origin picked by Host, never the Host itself', async () => {
  const s = await serve({ origin: 'https://weave.example.com', mcpOrigins: ['https://mcp.weave.example.com'] });
  try {
    const meta = async (host) => JSON.parse((await s.withHost(host, '/.well-known/oauth-protected-resource/mcp')).body).resource;
    assert.equal(await meta('mcp.weave.example.com'), 'https://mcp.weave.example.com/mcp');
    assert.equal(await meta('weave.example.com'), 'https://weave.example.com/mcp');
    assert.equal(await meta('localhost'), 'https://weave.example.com/mcp', 'an allowed but unlisted host gets WEAVE_ORIGIN');
    assert.equal((await s.withHost('evil.example', '/.well-known/oauth-protected-resource/mcp')).status, 421, 'a stranger Host is refused outright');
  } finally { s.stop(); }
  assert.deepEqual(mcpOriginsFromEnv({ WEAVE_MCP_ORIGINS: ' https://mcp.a.example , https://b.example/ ' }), ['https://mcp.a.example', 'https://b.example']);
  assert.deepEqual(mcpOriginsFromEnv({}), []);
  assert.throws(() => mcpOriginsFromEnv({ WEAVE_MCP_ORIGINS: 'https://mcp.a.example/mcp' }), /WEAVE_MCP_ORIGINS/);
});

test('token: the provider\'s userinfo names the subject, and the account it is pinned to calls the tools', async () => {
  const s = await serve();
  try {
    const token = s.idp.mint(KYLE);
    const { res, data } = await s.rpc('/mcp', token, 'tools/list');
    assert.equal(res.status, 200);
    assert.ok(data.result.tools.some((t) => t.name === 'weave_create_entity'));
    const made = await s.rpc('/mcp', token, 'tools/call', { name: 'weave_create_entity', arguments: { db: 'Task', name: 'from claude' } });
    assert.equal(made.res.status, 200);
    assert.ok(!made.data.result.isError, made.data.result.content[0].text);
    const row = s.w.getEntity(JSON.parse(made.data.result.content[0].text).id);
    assert.equal(row.createdBy, 'kyle via oauth', 'the account is the actor; an opaque token names no client');
  } finally { s.stop(); }
});

test('audit: a JWT access token that names its client puts the client beside the account', async () => {
  const s = await serve();
  try {
    const token = s.idp.mint(KYLE, { jwt: { client_id: 'claude-code_123' } });
    const made = await s.rpc('/mcp', token, 'tools/call', { name: 'weave_create_entity', arguments: { db: 'Task', name: 'jwt row' } });
    const row = s.w.getEntity(JSON.parse(made.data.result.content[0].text).id);
    assert.equal(row.createdBy, 'kyle via claude-code_123');
  } finally { s.stop(); }
});

test('403: a subject no account is pinned to opens nothing, an email in userinfo included; an unopened invite pins nobody', async () => {
  const s = await serve();
  try {
    const stranger = await s.rpc('/mcp', s.idp.mint({ sub: 'user_x', email: 'x@example.com', email_verified: true }), 'tools/list');
    assert.equal(stranger.res.status, 403);
    assert.match(stranger.data.error, /weave account link/);
    assert.doesNotMatch(stranger.data.error, /x@example/, 'no email is read, so none is echoed');
    s.w.createAccount({ name: 'newcomer', role: 'architect' });
    s.w.linkIdentity('newcomer', { issuer: s.idp.issuer });
    assert.equal((await s.rpc('/mcp', s.idp.mint({ sub: 'user_new' }), 'tools/list')).res.status, 403, 'the invite is the browser\'s to open');
  } finally { s.stop(); }
});

test('401: a token the provider rejects is refused with the challenge, and asked about once', async () => {
  const s = await serve();
  try {
    const before = s.idp.seen.userinfo;
    for (let i = 0; i < 2; i += 1) {
      const { res } = await s.rpc('/mcp', 'not-a-token-the-provider-made', 'tools/list');
      assert.equal(res.status, 401);
      assert.match(res.headers.get('www-authenticate'), /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/);
    }
    assert.equal(s.idp.seen.userinfo - before, 1, 'the refusal is cached');
  } finally { s.stop(); }
});

test('limits: an address that keeps sending refused tokens is held off; a provider that is down is a 502, not a 401', async () => {
  const s = await serve();
  try {
    for (let i = 0; i < 5; i += 1) assert.equal((await s.rpc('/mcp', `junk-${i}`, 'tools/list')).res.status, 401);
    assert.equal((await s.rpc('/mcp', 'junk-6', 'tools/list')).res.status, 429);
  } finally { s.stop(); }
  const down = await serve();
  try {
    const token = down.idp.mint(KYLE);
    down.idp.stop();
    const { res } = await down.rpc('/mcp', token, 'tools/list');
    assert.equal(res.status, 502, 'a 401 would send the client round the sign-in again');
  } finally { down.stop(); }
});

test('cache: a second call with the same token does not ask the provider again', async () => {
  const s = await serve();
  try {
    const token = s.idp.mint(KYLE);
    const before = s.idp.seen.userinfo;
    assert.equal((await s.rpc('/mcp', token, 'tools/list')).res.status, 200);
    assert.equal((await s.rpc('/mcp', token, 'ping')).res.status, 200);
    assert.equal(s.idp.seen.userinfo - before, 1);
  } finally { s.stop(); }
});

test('wv_ tokens: unchanged on /mcp and /api/mcp, never sent to the provider; a provider token does not open /api/mcp', async () => {
  const s = await serve();
  try {
    const before = s.idp.seen.userinfo;
    for (const path of ['/mcp', '/api/mcp']) assert.equal((await s.rpc(path, s.admin, 'tools/list')).res.status, 200, path);
    const bad = await s.rpc('/mcp', 'wv_nope', 'tools/list');
    assert.equal(bad.res.status, 401);
    assert.match(bad.res.headers.get('www-authenticate'), /resource_metadata=/);
    assert.equal(s.idp.seen.userinfo, before, 'a wv_ token never leaves the process');
    assert.equal((await s.rpc('/api/mcp', s.idp.mint(KYLE), 'tools/list')).res.status, 401, '/api/mcp keeps its contract');
  } finally { s.stop(); }
});

test('workspace: /w/<name>/mcp opens that workspace for an account linked there, and the root route does not', async () => {
  const s = await serve();
  try {
    const ann = s.idp.mint(ANN);
    const made = await s.rpc('/w/docs/mcp', ann, 'tools/call', { name: 'weave_create_entity', arguments: { db: 'Page', name: 'ann page' } });
    assert.equal(made.res.status, 200);
    assert.ok(!made.data.result.isError, made.data.result.content[0].text);
    const id = JSON.parse(made.data.result.content[0].text).id;
    assert.equal(s.docs.getEntity(id).createdBy, 'ann via oauth', 'the row lands in docs');
    assert.throws(() => s.w.getEntity(id), /not found/);
    assert.equal((await s.rpc('/mcp', ann, 'tools/list')).res.status, 403, 'ann has no account on the root workspace');
  } finally { s.stop(); }
});

test('methods: /mcp answers POST only; GET is 405 so a client does not wait on a stream', async () => {
  const s = await serve();
  try {
    const res = await s.call('GET', '/mcp', { token: s.admin });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST');
  } finally { s.stop(); }
});
