import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.WEAVE_KEYSTORE ??= join(mkdtempSync(join(tmpdir(), 'weave-sec-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { sameOriginPath, renderAuthPage } = await import('../../src/auth-page.js');
const { startIdp, serveOidc } = await import('./../lib/idp.mjs');

const ORIGIN = 'https://weave.example.com';
const FOREIGN = ['//evil.example/x', 'https://evil.example/', '/\\evil.example', '/\t/evil.example', '/\t\\evil.example', '/\n/evil.example', '\\/evil.example', 'javascript:alert(1)', '', 'relative/path'];
const OWN = ['/', '/#/Dev/Task', '/w/x/?a=1#/table/1', '/e/0a1b'];

test('sameOriginPath keeps a path only when the browser would stay on this origin', () => {
  for (const n of FOREIGN) assert.equal(sameOriginPath(n, ORIGIN, '/home/'), '/home/', JSON.stringify(n));
  for (const n of OWN) assert.equal(sameOriginPath(n, ORIGIN, '/home/'), n, JSON.stringify(n));
  assert.equal(sameOriginPath('/x', 'https://weave.example.com:443', '/'), '/x', 'a default port spelled out still matches');
  assert.equal(sameOriginPath('/x', 'not a url', '/'), '/', 'an unparsable origin keeps the fallback');
});

test('the sign-in page resolves next the same way, against its own origin', () => {
  const html = renderAuthPage({ mount: '/w/x' });
  assert.ok(html.includes(sameOriginPath.toString()), 'the page carries the same function the server uses');
  assert.ok(html.includes('sameOriginPath(q.get(\'next\') || \'\', location.origin, mount + \'/\')'), 'and calls it on ?next with location.origin');
  assert.ok(!html.includes("n.startsWith('//')"), 'the string check is gone');
});

async function serve() {
  const idp = await startIdp();
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'editor' });
  w.redeemIdentityInvite(w.linkIdentity('kyle', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_kyle' });
  w.setRequireAuth(true);
  return serveOidc(w, idp, { limits: { options: 1000, failed: 1000 } });
}
const KYLE = { sub: 'user_kyle' };

test('the OIDC callback lands on the mount root when next would leave the origin', async () => {
  const s = await serve();
  try {
    for (const next of FOREIGN.filter(Boolean)) {
      const { res } = await s.signIn(KYLE, { next });
      assert.equal(res.status, 302, JSON.stringify(next));
      assert.equal(res.headers.get('location'), '/', JSON.stringify(next));
    }
    const { res } = await s.signIn(KYLE, { next: '/#/Dev/Task' });
    assert.equal(res.headers.get('location'), '/#/Dev/Task');
  } finally { s.stop(); }
});

test('/auth drops a foreign next before handing the browser to the provider', async () => {
  const s = await serve();
  try {
    for (const next of ['/\t/evil.example', '/\\evil.example']) {
      const res = await s.call('GET', `/auth?next=${encodeURIComponent(next)}`);
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), '/api/auth/oidc/start', JSON.stringify(next));
    }
    const res = await s.call('GET', `/auth?next=${encodeURIComponent('/#/Dev/Task')}`);
    assert.equal(res.headers.get('location'), '/api/auth/oidc/start?next=%2F%23%2FDev%2FTask');
  } finally { s.stop(); }
});
