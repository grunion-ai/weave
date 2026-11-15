import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const ENV_KEYS = ['WEAVE_ORIGIN', 'WEAVE_ALLOWED_HOSTS', 'WEAVE_MCP_ORIGINS', 'WEAVE_BASE_DOMAIN'];

function askAs(port, hostHeader) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/tables', headers: { Host: hostHeader } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

async function statusFor(options, hostHeader) {
  const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  const { server, port } = await startServer(new Weave({ name: 'hosts' }), { port: 0, host: '0.0.0.0', ...options });
  try {
    return await askAs(port, hostHeader);
  } finally {
    server.close();
    for (const k of ENV_KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
}

test('a server given only an origin refuses a Host header that is not that origin', async () => {
  assert.equal(await statusFor({ origin: 'https://weave.example.com' }, 'evil.example.net'), 421);
  assert.equal(await statusFor({ origin: 'https://weave.example.com' }, 'weave.example.com'), 200);
});

test('a server given only allowed hosts refuses a Host header that is not listed', async () => {
  assert.equal(await statusFor({ allowedHosts: ['weave.internal'] }, 'evil.example.net'), 421);
  assert.equal(await statusFor({ allowedHosts: ['weave.internal'] }, 'weave.internal'), 200);
});

test('a server bound to a public address with no origin and no allowed hosts answers any Host header', async () => {
  assert.equal(await statusFor({}, 'anything.example.net'), 200);
});
