import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.WEAVE_KEYSTORE ??= join(mkdtempSync(join(tmpdir(), 'weave-sec-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startServer, hostAllowed, hostCheckFor, allowedHostsFromEnv } = await import('../../src/server.js');

const get = (port, path, host) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('error', reject);
  req.end();
});

async function serve(opts = {}) {
  const w = new Weave();
  w.setRequireAuth(false);
  const { server, port } = await startServer(w, { port: 0, ...opts });
  return { port, stop: () => server.close() };
}

test('loopback names answer, with or without the port', async () => {
  const { port, stop } = await serve();
  try {
    for (const h of ['127.0.0.1', `127.0.0.1:${port}`, 'localhost', `localhost:${port}`, 'LOCALHOST', '[::1]', `[::1]:${port}`]) {
      assert.equal(await get(port, '/api/workspace', h), 200, h);
    }
  } finally { stop(); }
});

test('a foreign Host is a 421, including names that only look like loopback', async () => {
  const { port, stop } = await serve();
  try {
    for (const h of ['evil.example', `evil.example:${port}`, 'localhost.evil.example', '127.0.0.1.nip.io', 'localhost@evil.example']) {
      assert.equal(await get(port, '/api/workspace', h), 421, JSON.stringify(h));
      assert.equal(await get(port, '/', h), 421, JSON.stringify(h));
    }
    assert.equal(await get(port, '/api/health', 'healthcheck.railway.app'), 200);
  } finally { stop(); }
});

test("WEAVE_ORIGIN's host and WEAVE_ALLOWED_HOSTS entries answer", async () => {
  const { port, stop } = await serve({ origin: 'https://weave.example.com', allowedHosts: ['lan.box', '192.168.1.20'] });
  try {
    assert.equal(await get(port, '/api/workspace', 'weave.example.com'), 200);
    assert.equal(await get(port, '/api/workspace', 'lan.box:4400'), 200);
    assert.equal(await get(port, '/api/workspace', `192.168.1.20:${port}`), 200);
    assert.equal(await get(port, '/api/workspace', 'other.example.com'), 421);
  } finally { stop(); }
});

const hit = (port, path, host, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: host, ...headers } }, (res) => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
  });
  req.on('error', reject);
  req.end();
});

test('a page asked for on another allowed name moves to WEAVE_ORIGIN, so sign-in happens where it can finish (Issue #547)', async () => {
  const { port, stop } = await serve({ origin: 'https://weave.example.com', allowedHosts: ['weave-production-a5bd.up.railway.app', 'mcp.weave.example.com'], mcpOrigins: ['https://mcp.weave.example.com'] });
  const other = 'weave-production-a5bd.up.railway.app';
  try {
    for (const path of ['/auth', '/', '/w/weave/auth?next=%2Fw%2Fweave%2F', '/start']) {
      assert.deepEqual(await hit(port, path, other), { status: 308, location: `https://weave.example.com${path}` }, path);
    }
    assert.deepEqual(await hit(port, '/auth', other, { method: 'HEAD' }), { status: 308, location: 'https://weave.example.com/auth' });
    for (const path of ['/api/workspace', '/w/weave/api/tables', '/api/health', '/mcp', '/.well-known/oauth-protected-resource']) {
      assert.notEqual((await hit(port, path, other)).status, 308, `${path} keeps answering on ${other}`);
    }
    assert.equal((await hit(port, '/api/workspace', other, { headers: { Authorization: 'Bearer wv_x' } })).status !== 308, true, 'a Bearer call is served where it arrived');
    assert.notEqual((await hit(port, '/auth', 'weave.example.com')).status, 308, 'the origin itself is not redirected');
    assert.notEqual((await hit(port, '/auth', 'mcp.weave.example.com')).status, 308, 'an MCP origin is its own public name');
    assert.notEqual((await hit(port, '/auth', `127.0.0.1:${port}`)).status, 308, 'loopback stays local');
  } finally { stop(); }
});

test('without WEAVE_ORIGIN an allowed name serves pages where it is (Issue #547)', async () => {
  const { port, stop } = await serve({ allowedHosts: ['lan.box'] });
  try {
    assert.notEqual((await hit(port, '/', 'lan.box')).status, 308);
  } finally { stop(); }
});

test('WEAVE_ALLOWED_HOSTS is comma separated, ports and case ignored', () => {
  assert.deepEqual(allowedHostsFromEnv({ WEAVE_ALLOWED_HOSTS: ' Lan.Box:4400, 192.168.1.20 ,,' }), ['lan.box', '192.168.1.20']);
  assert.deepEqual(allowedHostsFromEnv({}), []);
  assert.equal(hostAllowed('LAN.box:1', { allowedHosts: ['lan.box'] }), true);
  assert.equal(hostAllowed(undefined, {}), false);
});

test('a non-loopback bind with neither variable set keeps accepting any Host and warns once', () => {
  assert.deepEqual(hostCheckFor({ host: '127.0.0.1', env: {} }), { enforce: true, warning: null });
  assert.deepEqual(hostCheckFor({ host: 'localhost', env: {} }), { enforce: true, warning: null });
  assert.deepEqual(hostCheckFor({ host: '::1', env: {} }), { enforce: true, warning: null });
  assert.equal(hostCheckFor({ host: '0.0.0.0', env: { WEAVE_ORIGIN: 'https://w.example.com' } }).enforce, true);
  assert.equal(hostCheckFor({ host: '0.0.0.0', env: { WEAVE_ALLOWED_HOSTS: 'lan.box' } }).enforce, true);
  const open = hostCheckFor({ host: '0.0.0.0', env: {} });
  assert.equal(open.enforce, false);
  assert.match(open.warning, /WEAVE_ALLOWED_HOSTS/);
  assert.equal(open.warning.split('\n').length, 1, 'one line');
});
