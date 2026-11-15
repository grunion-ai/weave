import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { startIdp } from './lib/idp.mjs';
import { tempDir } from './lib/temp.mjs';

const BASE = 'weave.test';

const hit = (port, host, path, { cookie } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, method: 'GET', path, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
  });
  req.on('error', reject);
  req.end();
});

async function serve() {
  const dir = tempDir('weave-ws-oidc-');
  const idp = await startIdp();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const acme = new Weave({ path: join(dir, 'acme.db'), name: 'acme' });
  acme.state.meta.name = 'acme';
  acme.createAccount({ name: 'kyle', role: 'editor' });
  acme.setRequireAuth(true);
  acme.save();
  acme.store.close?.();
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.state.meta.name = 'Net';
  main.save();
  const { server, port } = await startServer(main, { port: 0, baseDomain: BASE, origin: `http://${BASE}`, oidc, limits: { options: 1000, failed: 1000 } });
  return { port, stop: () => { server.close(); idp.stop(); rmSync(dir, { recursive: true, force: true }); } };
}

test('a workspace host sends only the sign-in start to the apex: its callback is answered there and expired', async () => {
  const s = await serve();
  try {
    const start = await hit(s.port, `acme.${BASE}`, '/api/auth/oidc/start');
    assert.equal(start.status, 302);
    assert.equal(new URL(start.headers.location).host, BASE, 'the start goes to the apex');
    assert.match(start.headers['cache-control'], /no-store/);

    const callback = await hit(s.port, `acme.${BASE}`, '/api/auth/oidc/callback?code=made-up&state=made-up');
    assert.equal(callback.status, 400);
    assert.equal(callback.headers.location, undefined, 'the callback is not redirected to the apex start');
    assert.match(callback.text, /expired or was already used/);
  } finally { s.stop(); }
});

test('a sign-in begun on the apex that the provider refuses goes back to the start page, never cached', async () => {
  const s = await serve();
  try {
    const start = await hit(s.port, BASE, '/api/auth/oidc/start');
    assert.equal(start.status, 302);
    const state = new URL(start.headers.location).searchParams.get('state');
    const trip = [start.headers['set-cookie']].flat().find((c) => c.startsWith('wv_oidc=')).split(';')[0];

    const back = await hit(s.port, BASE, `/api/auth/oidc/callback?error=access_denied&state=${encodeURIComponent(state)}`, { cookie: trip });
    assert.equal(back.status, 302);
    assert.equal(back.headers.location, '/start?error=signin_failed');
    assert.equal(back.headers['cache-control'], 'no-store');
  } finally { s.stop(); }
});
