import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.WEAVE_KEYSTORE ??= join(mkdtempSync(join(tmpdir(), 'weave-sec-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');

const call = (port, method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
    let text = '';
    res.on('data', (d) => { text += d; });
    res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.on('error', reject);
  req.end(body);
});

async function serve(opts = {}) {
  const w = new Weave();
  const { server, port } = await startServer(w, { port: 0, ...opts });
  const spaces = () => w.listSpaces().map((s) => s.name);
  return { w, port, spaces, stop: () => server.close() };
}
const JSON_CT = { 'Content-Type': 'application/json' };

test('a write from another site is a 403 and changes nothing', async () => {
  const { port, spaces, stop } = await serve();
  try {
    for (const origin of ['https://evil.example', 'null', `http://localhost:${port + 1}`, `http://evil.example:${port}`]) {
      const r = await call(port, 'POST', '/api/spaces', { headers: { ...JSON_CT, Origin: origin }, body: JSON.stringify({ name: 'Pwned' }) });
      assert.equal(r.status, 403, origin);
    }
    const plain = await call(port, 'POST', '/api/spaces', { headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example' }, body: JSON.stringify({ name: 'Pwned' }) });
    assert.equal(plain.status, 403);
    const fetchSite = await call(port, 'POST', '/api/spaces', { headers: { ...JSON_CT, 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify({ name: 'Pwned' }) });
    assert.equal(fetchSite.status, 403);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const r = await call(port, method, '/api/workspace', { headers: { ...JSON_CT, Origin: 'https://evil.example' }, body: '{}' });
      assert.equal(r.status, 403, method);
    }
    assert.ok(!spaces().includes('Pwned'));
  } finally { stop(); }
});

test('same-origin, loopback-on-this-port and origin-less writes are served', async () => {
  const { port, spaces, stop } = await serve();
  try {
    const ok = async (name, headers) => {
      const r = await call(port, 'POST', '/api/spaces', { headers: { ...JSON_CT, ...headers }, body: JSON.stringify({ name }) });
      assert.equal(r.status, 201, `${name}: ${r.text}`);
    };
    await ok('Own', { Origin: `http://127.0.0.1:${port}` });
    await ok('Localhost', { Origin: `http://localhost:${port}` });
    await ok('V6', { Origin: `http://[::1]:${port}` });
    await ok('SameSite', { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' });
    await ok('Curl', {});
    const curl = await call(port, 'POST', '/api/spaces', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: JSON.stringify({ name: 'CurlForm' }) });
    assert.equal(curl.status, 201);
    assert.deepEqual(['Own', 'Localhost', 'V6', 'SameSite', 'Curl', 'CurlForm'].filter((n) => !spaces().includes(n)), []);
    const read = await call(port, 'GET', '/api/workspace', { headers: { Origin: 'https://evil.example' } });
    assert.equal(read.status, 200);
  } finally { stop(); }
});

test('WEAVE_ORIGIN and a proxied https origin are served', async () => {
  const { port, spaces, stop } = await serve({ origin: 'https://weave.example.com', trustProxy: true });
  try {
    const viaOrigin = await call(port, 'POST', '/api/spaces', { headers: { ...JSON_CT, Host: 'weave.example.com', Origin: 'https://weave.example.com' }, body: JSON.stringify({ name: 'Public' }) });
    assert.equal(viaOrigin.status, 201, viaOrigin.text);
    const proxiedHttps = { ...JSON_CT, Host: 'weave.example.com', 'X-Forwarded-Proto': 'https' };
    const downgraded = await call(port, 'POST', '/api/spaces', { headers: { ...proxiedHttps, Origin: 'http://weave.example.com' }, body: JSON.stringify({ name: 'Downgraded' }) });
    assert.equal(downgraded.status, 403, 'an https request with an http Origin is another origin');
    assert.ok(spaces().includes('Public'));
  } finally { stop(); }
  const proxied = await serve({ trustProxy: true, allowedHosts: ['box.example'] });
  try {
    const r = await call(proxied.port, 'POST', '/api/spaces', { headers: { ...JSON_CT, Host: 'box.example', 'X-Forwarded-Proto': 'https', Origin: 'https://box.example' }, body: JSON.stringify({ name: 'Proxied' }) });
    assert.equal(r.status, 201, r.text);
  } finally { proxied.stop(); }
});

test('with an Origin present, a JSON route refuses a body that is not application/json', async () => {
  const { port, spaces, stop } = await serve();
  try {
    const own = { Origin: `http://127.0.0.1:${port}` };
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const r = await call(port, 'POST', '/api/spaces', { headers: { ...own, 'Content-Type': ct }, body: JSON.stringify({ name: 'Plain' }) });
      assert.equal(r.status, 400, ct);
    }
    const missing = await call(port, 'POST', '/api/spaces', { headers: own, body: JSON.stringify({ name: 'Plain' }) });
    assert.equal(missing.status, 400, 'no Content-Type');
    assert.ok(!spaces().includes('Plain'));
    const charset = await call(port, 'POST', '/api/spaces', { headers: { ...own, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ name: 'Charset' }) });
    assert.equal(charset.status, 201);
  } finally { stop(); }
});
