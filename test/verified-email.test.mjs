import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { PRIVACY } from '../src/legal.js';
import { startIdp } from './lib/idp.mjs';

const hit = (port, host, method, path, { cookie, body, token } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = request({
    host: '127.0.0.1', port, method, path,
    headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
  });
  req.on('error', reject);
  req.end(payload ?? undefined);
});
const cookieOf = (res, name) => [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${name}=`))?.split(';')[0];
const mail = /[\w.+-]+@[\w-]+\.[\w.]+/;

async function serve() {
  const idp = await startIdp();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const dir = mkdtempSync(join(tmpdir(), 'weave-email-'));
  const acme = new Weave({ path: join(dir, 'acme.db'), name: 'acme' });
  acme.state.meta.name = 'acme';
  const architect = acme.createAccount({ name: 'boss', role: 'architect' }).token;
  acme.actor = 'boss';
  const invite = acme.inviteMember({ email: 'Dylan@Example.com', role: 'observer', issuer: idp.issuer });
  acme.setRequireAuth(true);
  acme.save();
  acme.store.close?.();
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.state.meta.name = 'Net';
  main.createAccount({ name: 'kyle', role: 'architect' });
  main.redeemIdentityInvite(main.linkIdentity('kyle', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_kyle' });
  main.setRequireAuth(true);
  main.save();
  const { server, port } = await startServer(main, { port: 0, baseDomain: 'weave.test', origin: 'http://weave.test', oidc, limits: { options: 1000, failed: 1000, slugs: 1000 } });
  const at = (host) => (method, path, opts) => hit(port, host, method, path, opts);
  const apex = at('weave.test');
  const follow = (location, opts) => { const u = new URL(location, 'http://weave.test'); return at(u.host)('GET', u.pathname + u.search, opts); };
  const signInAtStart = async (claims) => {
    const start = await apex('GET', '/api/auth/oidc/start?start=1');
    const back = idp.approve(start.headers.location, claims);
    const res = await follow(back.href, { cookie: cookieOf(start, 'wv_oidc') });
    return cookieOf(res, 'wv_start');
  };
  const reopen = (name) => new Weave({ path: join(dir, `${name}.db`) });
  return { dir, main, at, apex, follow, signInAtStart, reopen, idp, invite, architect, stop: () => { server.close(); idp.stop(); rmSync(dir, { recursive: true, force: true }); } };
}

test('oidc: the verified email comes back normalised; an unverified one, a name or a picture never does', async () => {
  const idp = await startIdp();
  try {
    const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret });
    const redeem = async (claims) => {
      const trip = await oidc.begin({ redirectUri: 'http://localhost/cb' });
      assert.equal(new URL(trip.url).searchParams.get('scope'), 'openid email');
      const back = idp.approve(trip.url, claims);
      return oidc.redeem({ code: back.searchParams.get('code'), redirectUri: 'http://localhost/cb', verifier: trip.verifier, nonce: trip.nonce });
    };
    const extra = { name: 'Kyle A', picture: 'https://img.example/k.png', given_name: 'Kyle' };
    assert.deepEqual(await redeem({ sub: 'u1', email: ' Kyle@Example.COM ', email_verified: true, ...extra }), { issuer: idp.issuer, subject: 'u1', email: 'kyle@example.com' });
    assert.deepEqual(await redeem({ sub: 'u2', email: 'kyle@example.com', email_verified: false, ...extra }), { issuer: idp.issuer, subject: 'u2' });
    assert.deepEqual(await redeem({ sub: 'u3', email: 'kyle@example.com', email_verified: 'true' }), { issuer: idp.issuer, subject: 'u3' }, 'only a boolean true counts');
  } finally { idp.stop(); }
});

test('engine: a later sign-in backfills the address, deleting the account deletes it, export leaves it out and import keeps it', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'architect' });
  w.redeemIdentityInvite(w.linkIdentity('kyle', { issuer: 'https://idp.example' }).code, { issuer: 'https://idp.example', subject: 'u1' });
  assert.equal(w.listAccounts()[0].identities[0].verifiedEmail, undefined, 'nothing guessed from old data');
  assert.equal(w.accountForIdentity({ issuer: 'https://idp.example', subject: 'u1', email: 'Kyle@example.com' }).name, 'kyle');
  assert.equal(w.listAccounts()[0].identities[0].verifiedEmail, 'kyle@example.com', 'backfilled at sign-in');
  assert.equal(w.accountForIdentity({ issuer: 'https://idp.example', subject: 'u1' }).identities[0].verifiedEmail, 'kyle@example.com', 'a sign-in with no address keeps the one on file');

  const dump = w.exportJSON();
  assert.ok(!mail.test(JSON.stringify(dump.meta)), 'export carries no email');
  w.importJSON(dump);
  assert.equal(w.listAccounts()[0].identities[0].verifiedEmail, 'kyle@example.com', 'importing an export into the same workspace keeps the address');
  const far = new Weave();
  far.importJSON(dump);
  assert.ok(!mail.test(JSON.stringify(far.state.meta)), 'another workspace gets none');

  w.deleteAccount('kyle');
  assert.ok(!mail.test(JSON.stringify(w.state.meta)), 'deleting the account deletes the address');
});

test('engine: an invite is accepted by the verified address it was sent to, once, and only that address', () => {
  const w = new Weave();
  w.actor = 'boss';
  const inv = w.inviteMember({ email: 'dylan@example.com', role: 'observer', issuer: 'https://idp.example' });
  assert.deepEqual(w.invitesForEmail(' DYLAN@example.com ').map((i) => i.id), [inv.id]);
  assert.deepEqual(w.invitesForEmail('someone@example.com'), []);
  assert.throws(() => w.acceptInvite(inv.id, { issuer: 'https://idp.example', subject: 'u9', email: 'someone@example.com' }), /another address/);
  assert.throws(() => w.acceptInvite(inv.id, { issuer: 'https://idp.example', subject: 'u9' }), /another address/, 'no verified address, no match');
  const made = w.acceptInvite(inv.id, { issuer: 'https://idp.example', subject: 'u9', email: 'dylan@example.com' });
  assert.deepEqual([made.name, Weave.roleName(made.role), made.identities[0].verifiedEmail], ['dylan', 'observer', 'dylan@example.com']);
  assert.throws(() => w.acceptInvite(inv.id, { issuer: 'https://idp.example', subject: 'u9', email: 'dylan@example.com' }), /already used/);
  assert.throws(() => w.acceptInvite('__proto__', { issuer: 'https://idp.example', subject: 'u9', email: 'dylan@example.com' }), /already used/);
});

test('start: a verified address sees its pending invites after sign-in and accepts one; the link keeps working', async () => {
  const s = await serve();
  try {
    const stranger = await s.signInAtStart({ sub: 'user_dylan', email: 'dylan@example.com', email_verified: false });
    assert.deepEqual((await s.apex('GET', '/api/start', { cookie: stranger })).json().rows, [], 'an unverified address matches nothing');

    const dylan = await s.signInAtStart({ sub: 'user_dylan', email: 'Dylan@example.com', email_verified: true });
    const rows = (await s.apex('GET', '/api/start', { cookie: dylan })).json().rows;
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].kind, rows[0].name, rows[0].role, rows[0].invitedBy], ['invite', 'acme', 'observer', 'boss']);
    assert.match(rows[0].accept, /^\/api\/start\/invites\/acme\/[0-9a-f]{64}$/);

    const accepted = await s.apex('POST', rows[0].accept, { cookie: dylan, body: {} });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.json(), { name: 'acme', account: 'dylan', open: '/api/start/open/acme' });
    assert.equal((await s.apex('POST', rows[0].accept, { cookie: dylan, body: {} })).status, 404, 'once');
    const after = (await s.apex('GET', '/api/start', { cookie: dylan })).json().rows;
    assert.deepEqual(after.map((r) => [r.kind, r.name]), [['workspace', 'acme']], 'the invite became a workspace');
    const open = await s.apex('GET', after[0].open, { cookie: dylan });
    const landed = await s.follow(open.headers.location);
    const session = cookieOf(landed, [landed.headers['set-cookie']].flat()[0].split('=')[0]);
    const me = (await s.at('acme.weave.test')('GET', '/api/auth/me', { cookie: session })).json();
    assert.deepEqual([me.account.name, me.role, me.account.identities[0].verifiedEmail], ['dylan', 'observer', 'dylan@example.com']);

    const members = (await s.at('acme.weave.test')('GET', '/api/accounts', { token: s.architect })).json();
    assert.equal(members.find((a) => a.name === 'dylan').identities[0].verifiedEmail, 'dylan@example.com', 'an architect sees the address in Members');
    assert.equal((await s.at('acme.weave.test')('GET', '/api/accounts', { cookie: session })).status, 403, 'an observer does not');

    assert.equal((await s.apex('POST', '/api/start/invites/acme/' + 'a'.repeat(64), { body: {} })).status, 401, 'signed out accepts nothing');
  } finally { s.stop(); }
});

test('privacy: the policy says weave keeps one verified email per sign-in and nothing else from the profile', () => {
  assert.match(PRIVACY, /one verified email address for each sign-in/);
  assert.match(PRIVACY, /no name, picture or other details/);
});
