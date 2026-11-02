import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { createWorkspaceHub, startServer } = await import('../src/server.js');
const { createBilling, CLERK_API } = await import('../src/billing.js');
const { sweepTrialMail, trialMailStage, architectAddresses, TRIAL_MAIL_DAYS } = await import('../src/trial-mail.js');

const ISSUER = 'https://clerk.weave.example.com';
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-10T09:00:00Z');
const ORIGIN = 'https://weave.example.com';

const clerk = (routes = {}) => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = String(url).slice(CLERK_API.length).split('?')[0];
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    const hit = routes[`${method} ${path}`] ?? [404, { errors: [{ code: 'resource_not_found' }] }];
    const [status, body] = typeof hit === 'function' ? hit() : hit;
    return new Response(JSON.stringify(body), { status });
  };
  return { fetch, calls };
};

const mailbox = () => {
  const sent = [];
  const send = async (msg) => {
    if (String(msg.to).startsWith('fail-')) throw new Error('Resend answered 403: domain not verified');
    sent.push(msg);
    return { id: 'em_1' };
  };
  return { sent, send };
};

function workspace({ name = 'acme', daysIn = 4, architects = [['arc', 'arc@example.com']], editors = [] } = {}) {
  const w = new Weave();
  w.updateWorkspace({ name });
  w.state.meta.createdAt = new Date(NOW - 30 * DAY).toISOString();
  for (const [who, email, role] of [...architects.map(([n, e]) => [n, e, 'architect']), ...editors.map(([n, e]) => [n, e, 'editor'])]) {
    w.createAccount({ name: who, role });
    if (email) w.redeemIdentityInvite(w.linkIdentity(who, { issuer: ISSUER }).code, { issuer: ISSUER, subject: `user_${who}`, email });
  }
  if (daysIn !== null) w.startTrial(new Date(NOW - daysIn * DAY).toISOString());
  return w;
}

const sweep = (w, { routes = {}, trialDays = 7, mail, now = NOW } = {}) => {
  const fake = clerk(routes);
  const billing = createBilling({ secretKey: 'sk_test_x', plan: 'seat', since: Date.parse('2026-06-01T00:00:00Z'), issuer: ISSUER, trialDays, fetch: fake.fetch, now: () => now });
  return sweepTrialMail({ hub: createWorkspaceHub(w), billing, mail, origin: ORIGIN, now: () => now, log: () => {} });
};

test('a workspace 4 days into a 7-day trial mails its architect once, and a second sweep mails nobody', async () => {
  const w = workspace({ daysIn: 4 });
  const box = mailbox();
  const first = await sweep(w, { mail: box.send });
  assert.deepEqual(first.sent, [{ workspace: 'acme', stage: 'ending', to: ['arc@example.com'] }]);
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, 'arc@example.com');
  assert.equal(box.sent[0].subject, 'Free trial of the acme workspace: 3 days left');
  assert.match(box.sent[0].html, /\/w\/acme\/billing/);

  const again = await sweep(w, { mail: box.send });
  assert.deepEqual(again.sent, []);
  assert.equal(box.sent.length, 1, 'the mark on the workspace meta stops a second mail');
});

test('the last day gets its own mail, and each stage goes out once', async () => {
  const w = workspace({ daysIn: 4 });
  const box = mailbox();
  await sweep(w, { mail: box.send });
  const last = await sweep(w, { mail: box.send, now: NOW + 3 * DAY - 3600_000 });
  assert.deepEqual(last.sent, [{ workspace: 'acme', stage: 'last', to: ['arc@example.com'] }]);
  assert.equal(box.sent[1].subject, 'Free trial of the acme workspace: last day');
  assert.deepEqual((await sweep(w, { mail: box.send, now: NOW + 3 * DAY - 1800_000 })).sent, []);
  assert.equal(box.sent.length, 2);
  assert.deepEqual(Object.keys(w.state.meta.trialMail).sort(), ['ending', 'last']);
});

test('a trial with more than three days left mails nobody', async () => {
  const w = workspace({ daysIn: 1 });
  const box = mailbox();
  assert.deepEqual((await sweep(w, { mail: box.send })).sent, []);
  assert.equal(box.sent.length, 0);
  assert.equal(w.state.meta.trialMail, undefined);
});

test('a workspace with no trial, or with trials turned off, mails nobody', async () => {
  const box = mailbox();
  assert.deepEqual((await sweep(workspace({ daysIn: null }), { mail: box.send })).sent, []);
  assert.deepEqual((await sweep(workspace({ daysIn: 4 }), { mail: box.send, trialDays: 0 })).sent, []);
  assert.equal(box.sent.length, 0);
});

test('a plan bought during the trial stops the mail', async () => {
  const w = workspace({ daysIn: 4 });
  w.linkBillingOrg('org_1');
  const box = mailbox();
  const routes = {
    'GET /organizations/org_1/billing/subscription': [200, { subscription_items: [{ status: 'active', plan: { slug: 'seat' }, period_end: NOW + 20 * DAY }] }],
    'GET /organizations/org_1/memberships': [200, { data: [{ public_user_data: { user_id: 'user_arc' } }] }],
  };
  assert.deepEqual((await sweep(w, { mail: box.send, routes })).sent, []);
  assert.equal(box.sent.length, 0);
});

test('Clerk being unreachable during a trial still mails, because the trial stands without Clerk', async () => {
  const w = workspace({ daysIn: 4 });
  w.linkBillingOrg('org_1');
  const box = mailbox();
  const down = { 'GET /organizations/org_1/billing/subscription': [500, { errors: [{ code: 'oops' }] }] };
  assert.equal((await sweep(w, { mail: box.send, routes: down })).sent.length, 1);
  assert.equal(box.sent.length, 1);
});

test('a plan check that throws leaves the marks alone, so the next sweep tries again', async () => {
  const w = workspace({ daysIn: 4 });
  const box = mailbox();
  const refusing = { trialDays: 7, standing: async () => { throw new Error('Clerk did not answer'); } };
  const once = await sweepTrialMail({ hub: createWorkspaceHub(w), billing: refusing, mail: box.send, origin: ORIGIN, now: () => NOW, log: () => {} });
  assert.deepEqual(once.sent, []);
  assert.equal(box.sent.length, 0);
  assert.equal(w.state.meta.trialMail, undefined);
  assert.equal((await sweep(w, { mail: box.send })).sent.length, 1);
});

test('a send that fails leaves the stage unmarked; one address getting through marks it', async () => {
  const box = mailbox();
  const alone = workspace({ daysIn: 4, architects: [['arc', 'fail-arc@example.com']] });
  assert.deepEqual((await sweep(alone, { mail: box.send })).sent, []);
  assert.equal(alone.state.meta.trialMail, undefined);

  const both = workspace({ daysIn: 4, architects: [['arc', 'fail-arc@example.com'], ['two', 'two@example.com']] });
  assert.deepEqual((await sweep(both, { mail: box.send })).sent, [{ workspace: 'acme', stage: 'ending', to: ['fail-arc@example.com', 'two@example.com'] }]);
  assert.equal(both.state.meta.trialMail.ending.endsWith('Z'), true);
});

test('only architects with a verified address are written to', () => {
  const w = workspace({ daysIn: 4, architects: [['arc', 'arc@example.com'], ['agent', null]], editors: [['ed', 'ed@example.com']] });
  assert.deepEqual(architectAddresses(w.listAccounts()), ['arc@example.com']);
  assert.deepEqual(architectAddresses([]), []);
});

test('a workspace with no architect address mails nobody and stays unmarked', async () => {
  const w = workspace({ daysIn: 4, architects: [['agent', null]] });
  const box = mailbox();
  assert.deepEqual((await sweep(w, { mail: box.send })).sent, []);
  assert.equal(w.state.meta.trialMail, undefined);
});

test('no mailer means no sweep at all', async () => {
  const w = workspace({ daysIn: 4 });
  assert.deepEqual((await sweep(w, { mail: null })).sent, []);
  assert.equal(w.state.meta.trialMail, undefined);
});

test('trialMailStage: three days left or fewer, then the last day, each once', () => {
  assert.equal(TRIAL_MAIL_DAYS, 3);
  assert.equal(trialMailStage(null, {}), null);
  assert.equal(trialMailStage({ daysLeft: 4 }, {}), null);
  assert.equal(trialMailStage({ daysLeft: 3 }, {}), 'ending');
  assert.equal(trialMailStage({ daysLeft: 2 }, {}), 'ending');
  assert.equal(trialMailStage({ daysLeft: 2 }, { ending: 'yes' }), null);
  assert.equal(trialMailStage({ daysLeft: 1 }, { ending: 'yes' }), 'last');
  assert.equal(trialMailStage({ daysLeft: 1 }, { ending: 'yes', last: 'yes' }), null);
  assert.equal(trialMailStage({ daysLeft: 1 }, {}), 'last', 'a short trial skips straight to the last day');
});

test('markTrialMail records a stage once and refuses one it does not know', () => {
  const w = workspace({ daysIn: 4 });
  const at = '2026-11-10T09:00:00.000Z';
  assert.equal(w.markTrialMail('ending', at), at);
  assert.equal(w.markTrialMail('ending', '2026-11-11T09:00:00.000Z'), at, 'the first mark stands');
  assert.deepEqual(w.state.meta.trialMail, { ending: at });
  assert.throws(() => w.markTrialMail('someday', at), /ending, last/);
});

test('a server with billing and a mailer sweeps trials on start and on its own timer', async () => {
  const w = workspace({ daysIn: 11 });
  w.state.meta.trialFrom = new Date(Date.now() - 11 * DAY).toISOString();
  w.save();
  const box = mailbox();
  const fake = clerk();
  const billing = createBilling({ secretKey: 'sk_test_x', plan: 'seat', since: Date.parse('2026-06-01T00:00:00Z'), issuer: ISSUER, trialDays: 14, fetch: fake.fetch });
  const { server } = await startServer(w, { port: 0, origin: ORIGIN, billing, mail: box.send });
  try {
    for (let i = 0; i < 50 && !box.sent.length; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(box.sent.length, 1, 'the sweep runs as the server comes up');
    assert.equal(box.sent[0].subject, 'Free trial of the acme workspace: 3 days left');
    assert.equal(typeof w.state.meta.trialMail.ending, 'string');
  } finally {
    server.close();
  }
});

test('a server with no billing or no mailer arms no trial sweep', async () => {
  const w = workspace({ daysIn: 11 });
  w.state.meta.trialFrom = new Date(Date.now() - 11 * DAY).toISOString();
  w.save();
  const box = mailbox();
  const { server } = await startServer(w, { port: 0, origin: ORIGIN, billing: null, mail: box.send });
  try {
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(box.sent.length, 0);
    assert.equal(w.state.meta.trialMail, undefined);
  } finally {
    server.close();
  }
});
