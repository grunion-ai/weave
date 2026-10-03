/* Sending the invite email (Feature #216, Issue #569). One POST to Resend,
   switched on by WEAVE_MAIL_KEY and WEAVE_MAIL_FROM together. Without both,
   nothing is sent and the invite flow is the copy-the-link one it was. A
   failed send never fails the invite: the invite is made, the link is in the
   answer, and `mailed: false` with `mailError` says what happened. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { createMailer, mailerFromEnv, RESEND_URL } = await import('../src/mail-send.js');
const { Weave } = await import('../src/engine.js');
const { startServer } = await import('../src/server.js');
const { createOidc } = await import('../src/oidc.js');

const spyFetch = (answer = () => new Response('{"id":"em_1"}', { status: 200 })) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return answer(); };
  return { f, calls };
};

test('mailerFromEnv: off unless both WEAVE_MAIL_KEY and WEAVE_MAIL_FROM are set', () => {
  const { f, calls } = spyFetch();
  for (const env of [{}, { WEAVE_MAIL_KEY: 're_x' }, { WEAVE_MAIL_FROM: 'weave <a@b.co>' }, { WEAVE_MAIL_KEY: ' ', WEAVE_MAIL_FROM: 'weave <a@b.co>' }]) {
    assert.equal(mailerFromEnv(env, { fetch: f }), null, JSON.stringify(Object.keys(env)));
  }
  assert.equal(typeof mailerFromEnv({ WEAVE_MAIL_KEY: 're_x', WEAVE_MAIL_FROM: 'weave <a@b.co>' }, { fetch: f }), 'function');
  assert.equal(calls.length, 0, 'making a mailer sends nothing');
});

test('a send is one POST of the right JSON to Resend', async () => {
  const { f, calls } = spyFetch();
  const send = createMailer({ key: 're_test', from: 'weave <no-reply@mail.example.com>', fetch: f });
  assert.deepEqual(await send({ to: 'dylan@example.com', subject: 'S', html: '<p>h</p>', text: 't' }), { id: 'em_1' });
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, RESEND_URL);
  assert.equal(RESEND_URL, 'https://api.resend.com/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer re_test');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { from: 'weave <no-reply@mail.example.com>', to: ['dylan@example.com'], subject: 'S', html: '<p>h</p>', text: 't' });
});

test('a refused send throws with Resend\'s answer, and never the key', async () => {
  const { f } = spyFetch(() => new Response('{"message":"The example.com domain is not verified"}', { status: 403 }));
  const send = createMailer({ key: 're_secret', from: 'weave <a@example.com>', fetch: f });
  await assert.rejects(send({ to: 'x@example.com', subject: 's', html: 'h', text: 't' }), (err) => {
    assert.match(err.message, /Resend answered 403: .*not verified/);
    assert.ok(!err.message.includes('re_secret'));
    return true;
  });
});

/* ---------------------------------------------------------------- route */
async function serve(mail) {
  const w = new Weave();
  w.updateWorkspace({ name: 'home' });
  const architect = w.createAccount({ name: 'kyle', role: 'architect' }).token;
  w.setRequireAuth(true);
  const oidc = createOidc({ issuer: 'https://idp.test', clientId: 'weave' });
  const { server } = await startServer(w, { port: 0, origin: 'https://weave.example.com', oidc, ...(mail !== undefined ? { mail } : {}) });
  const base = `http://127.0.0.1:${server.address().port}`;
  const invite = async (email) => {
    const res = await fetch(`${base}/api/invites`, { method: 'POST', headers: { Host: 'weave.example.com', 'Content-Type': 'application/json', Authorization: `Bearer ${architect}` }, body: JSON.stringify({ email, role: 'observer' }) });
    return { status: res.status, body: await res.json() };
  };
  return { w, invite, stop: () => server.close() };
}

test('route: with mail on, the invite is emailed to the address typed and answers mailed: true', async () => {
  const sent = [];
  const s = await serve(async (msg) => { sent.push(msg); return { id: 'em_1' }; });
  try {
    const { status, body } = await s.invite('Dylan@Example.com');
    assert.equal(status, 201);
    assert.equal(body.mailed, true);
    assert.equal(body.mailError, undefined);
    assert.match(body.url, /^https:\/\/weave\.example\.com\/api\/auth\/oidc\/start\?invite=wvi_/, 'the link is still in the answer');
    assert.equal(sent.length, 1);
    const [m] = sent;
    assert.equal(m.to, 'dylan@example.com');
    assert.equal(m.subject, 'Invite from kyle to the home workspace');
    assert.ok(m.text.includes(body.url) && m.html.includes(body.url), 'both parts carry the link');
    assert.ok(m.text.includes('As an Observer, you can view and comment.'));
    assert.ok(m.html.includes('https://weave.example.com/brand/email-lockup-light.png'), 'the mark is on the instance origin');
    assert.ok(m.text.includes('a workspace on weave.example.com'));
    assert.ok(m.text.includes(`expires on ${new Date(body.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })}`));
  } finally { s.stop(); }
});

test('route: a failed send still makes the invite and reports mailed: false with the reason', async () => {
  const errors = [];
  const was = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  const s = await serve(async () => { throw new Error('Resend answered 403: domain not verified'); });
  try {
    const { status, body } = await s.invite('ann@example.com');
    assert.equal(status, 201);
    assert.equal(body.mailed, false);
    assert.equal(body.mailError, 'Resend answered 403: domain not verified');
    assert.match(body.url, /invite=wvi_/);
    assert.deepEqual(s.w.listInvites().map((i) => i.email), ['ann@example.com'], 'the invite exists');
    assert.ok(errors.some((e) => e.includes('domain not verified')), 'the failure is logged');
    assert.ok(!errors.some((e) => e.includes('ann@example.com')), 'the log carries no address');
  } finally { console.error = was; s.stop(); }
});

test('route: with mail off, nothing is sent and the invite answers as before, mailed: false', async () => {
  const s = await serve(null);
  try {
    const { status, body } = await s.invite('bo@example.com');
    assert.equal(status, 201);
    assert.equal(body.mailed, false);
    assert.ok(!('mailError' in body));
    assert.match(body.url, /invite=wvi_/);
  } finally { s.stop(); }
});

test('server: the mailer comes from the environment, so an unset key sends nothing', async () => {
  const was = globalThis.fetch;
  const resend = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) !== RESEND_URL) return was(url, init);
    resend.push(JSON.parse(init.body));
    return new Response('{"id":"em_2"}', { status: 200 });
  };
  try {
    process.env.WEAVE_MAIL_FROM = 'weave <a@example.com>';
    delete process.env.WEAVE_MAIL_KEY;
    const off = await serve(undefined);
    try { assert.equal((await off.invite('cy@example.com')).body.mailed, false); } finally { off.stop(); }
    assert.equal(resend.length, 0, 'no call to Resend without the key');
    process.env.WEAVE_MAIL_KEY = 're_env';
    const on = await serve(undefined);
    try { assert.equal((await on.invite('di@example.com')).body.mailed, true); } finally { on.stop(); }
    assert.deepEqual(resend.map((b) => [b.from, b.to[0]]), [['weave <a@example.com>', 'di@example.com']]);
  } finally {
    globalThis.fetch = was;
    delete process.env.WEAVE_MAIL_FROM;
    delete process.env.WEAVE_MAIL_KEY;
  }
});
