import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';
process.env.WEAVE_KEYSTORE ??= join(tempDir('weave-sec-'), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { startServer } = await import('../../src/server.js');
const { clientAddress } = await import('../../src/routes.js');

const LIMITS = { options: 10, failed: 5, slugs: 2 };

async function serve(opts = {}) {
  const { server, port } = await startServer(new Weave(), { port: 0, limits: LIMITS, ...opts });
  const check = async (forwarded) => (await fetch(`http://127.0.0.1:${port}/api/workspaces/slug?slug=probe`, {
    headers: forwarded ? { 'X-Forwarded-For': forwarded } : {},
  })).status;
  return { check, stop: () => server.close() };
}

test('clientAddress keys on the entry the trusted proxy appended, or the socket', () => {
  assert.equal(clientAddress({ forwarded: '1.1.1.1, 9.9.9.9', remote: '10.0.0.1', trustProxy: true }), '9.9.9.9');
  assert.equal(clientAddress({ forwarded: ' 9.9.9.9 ', remote: '10.0.0.1', trustProxy: true }), '9.9.9.9');
  assert.equal(clientAddress({ forwarded: '1.1.1.1, 9.9.9.9', remote: '10.0.0.1', trustProxy: false }), '10.0.0.1');
  assert.equal(clientAddress({ forwarded: '', remote: '10.0.0.1', trustProxy: true }), '10.0.0.1');
  assert.equal(clientAddress({ forwarded: undefined, remote: null, trustProxy: true }), 'unknown');
});

test('behind a trusted proxy, a client that rotates the leftmost X-Forwarded-For entry shares one budget', async () => {
  const { check, stop } = await serve({ trustProxy: true });
  try {
    const rotatingLeft = [];
    for (const fake of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) rotatingLeft.push(await check(`${fake}, 9.9.9.9`));
    assert.deepEqual(rotatingLeft, [200, 200, 429], 'the proxy-appended entry is the key');
    const distinctClients = [];
    for (const real of ['5.5.5.5', '6.6.6.6', '7.7.7.7']) distinctClients.push(await check(`1.1.1.1, ${real}`));
    assert.deepEqual(distinctClients, [200, 200, 200], 'each real client has its own budget');
  } finally { stop(); }
});

test('with WEAVE_TRUST_PROXY unset, X-Forwarded-For is ignored and the socket address is the key', async () => {
  const { check, stop } = await serve({ trustProxy: false });
  try {
    const got = [];
    for (const fake of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) got.push(await check(fake));
    assert.deepEqual(got, [200, 200, 429]);
    assert.equal(await check(null), 429, 'no header, same socket, same budget');
  } finally { stop(); }
});
