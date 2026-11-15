import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startIdp, serveOidc } from './lib/idp.mjs';

const KYLE = { sub: 'user_kyle', email: 'kyle@example.com', email_verified: true };

async function serve() {
  const idp = await startIdp();
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'writer' });
  w.redeemIdentityInvite(w.linkIdentity('kyle', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_kyle' });
  w.setRequireAuth(true);
  return { w, idp, ...await serveOidc(w, idp, { limits: { options: 1000, failed: 1000 } }) };
}

test('an id token issued an hour from now is refused with its reason and opens no session', async () => {
  const s = await serve();
  try {
    const hourAhead = Math.floor(Date.now() / 1000) + 3600;
    const { res } = await s.signIn({ ...KYLE, iat: hourAhead });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.match(await res.text(), /The id token is dated in the future/);
    assert.equal(Object.keys(s.w.state.meta.sessions ?? {}).length, 0);
  } finally { s.stop(); }
});

test('an id token issued just now signs in', async () => {
  const s = await serve();
  try {
    const { res } = await s.signIn(KYLE);
    assert.equal(res.status, 302);
    assert.ok(res.headers.get('set-cookie'));
  } finally { s.stop(); }
});
