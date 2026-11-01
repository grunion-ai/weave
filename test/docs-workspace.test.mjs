import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer, createWorkspaceHub } from '../src/server.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { leaveWorkspace, isDocsWorkspace, BUG_FORM_NAME } from '../src/forms.js';
import { startIdp, serveOidc, cookieOf } from './lib/idp.mjs';

const KYLE = { sub: 'user_kyle', email: 'kyle@example.com', email_verified: true };
const STRANGER = { sub: 'user_nobody', email: 'nobody@example.com', email_verified: true };
const forbidden = (err) => err instanceof WeaveError && err.code === 'forbidden' && /built in/.test(err.message);

function docsWorkspace({ auth = false } = {}) {
  const docs = new Weave();
  seedWeaver(docs);
  if (auth) {
    docs.createAccount({ name: 'curator', role: 'architect' });
    docs.setRequireAuth(true);
  }
  return docs;
}

function member(name, { issuer = null } = {}) {
  const w = new Weave();
  w.state.meta.name = name;
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const owner = w.createAccount({ name: 'owner', role: 'architect' }).token;
  const kyle = w.createAccount({ name: 'kyle', role: 'editor' }).token;
  if (issuer) w.redeemIdentityInvite(w.linkIdentity('kyle', { issuer }).code, { issuer, subject: KYLE.sub });
  w.setRequireAuth(true);
  return { w, owner, kyle };
}

test('the docs workspace is known by its name', () => {
  assert.equal(isDocsWorkspace(docsWorkspace()), true);
  assert.equal(isDocsWorkspace(member('alpha').w), false);
});

test('engine: the docs workspace cannot be renamed; its description still can, and other workspaces rename freely', () => {
  const docs = docsWorkspace();
  assert.throws(() => docs.updateWorkspace({ name: 'manual' }), forbidden);
  assert.equal(docs.state.meta.name, 'weave');
  assert.equal(docs.updateWorkspace({ name: 'weave', description: 'the record' }).description, 'the record');
  const { w } = member('alpha');
  assert.equal(w.updateWorkspace({ name: 'beta' }).name, 'beta');
});

test('hub: the docs workspace cannot be deleted, soft or hard, even when it is the default', () => {
  const docs = docsWorkspace();
  const hub = createWorkspaceHub(new Weave(), { workspaces: { weave: docs } });
  assert.throws(() => hub.remove('weave'), forbidden);
  assert.throws(() => hub.remove('weave', { hard: true }), forbidden);
  assert.equal(docs.state.meta.deletedAt ?? null, null);
  assert.equal(hub.list().find((x) => x.name === 'weave').deletable, false);
  const rooted = createWorkspaceHub(docsWorkspace());
  assert.throws(() => rooted.remove('weave'), forbidden);
});

test('engine: nobody can leave the docs workspace; leaving another workspace removes your own account, never its last architect', () => {
  const docs = docsWorkspace({ auth: true });
  assert.throws(() => leaveWorkspace(docs, 'curator'), forbidden);
  assert.ok(docs.listAccounts().some((a) => a.name === 'curator'));
  const { w } = member('alpha');
  const kyleId = w.listAccounts().find((a) => a.name === 'kyle').id;
  assert.deepEqual(leaveWorkspace(w, 'kyle'), { id: kyleId, left: true, workspace: 'alpha' });
  assert.ok(!w.listAccounts().some((a) => a.name === 'kyle'));
  assert.throws(() => leaveWorkspace(w, 'owner'), (err) => err.code === 'invalid' && /last architect/.test(err.message));
});

test('routes: delete, rename and leave on the docs workspace answer 403 with the one error contract', async () => {
  const docs = docsWorkspace();
  const { server } = await startServer(new Weave(), { port: 0, workspaces: { weave: docs } });
  const at = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(at + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  try {
    for (const [method, path, body] of [
      ['DELETE', '/api/workspaces/weave'],
      ['DELETE', '/api/workspaces/weave?hard=1'],
      ['PATCH', '/w/weave/api/workspace', { name: 'manual' }],
      ['POST', '/w/weave/api/workspace/leave', {}],
    ]) {
      const r = await call(method, path, body);
      assert.equal(r.status, 403, `${method} ${path}`);
      assert.equal(r.data.code, 'forbidden');
      assert.match(r.data.error, /built in/);
    }
    assert.equal((await call('GET', '/w/weave/api/workspace')).data.name, 'weave');
  } finally { server.close(); }
});

async function oidcHub() {
  const idp = await startIdp();
  const docs = docsWorkspace({ auth: true });
  const alpha = member('alpha', { issuer: idp.issuer });
  const beta = member('beta');
  const s = await serveOidc(new Weave(), idp, { workspaces: { weave: docs, alpha: alpha.w, beta: beta.w } });
  const jar = new Map();
  const take = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split('; ');
      const i = pair.indexOf('=');
      if (!pair.slice(i + 1) || attrs.includes('Max-Age=0')) jar.delete(pair.slice(0, i));
      else jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ') || undefined;
  const call = async (method, path, opts = {}) => take(await s.call(method, path, { cookie: cookie(), ...opts }));
  const signIn = async (ws, claims = KYLE) => {
    const start = await s.call('GET', `/w/${ws}/api/auth/oidc/start?next=${encodeURIComponent(`/w/${ws}/`)}`);
    const back = idp.approve(start.headers.get('location'), claims);
    return take(await s.call('GET', back.pathname + back.search, { cookie: [cookie(), cookieOf(start)].filter(Boolean).join('; ') }));
  };
  return { s, idp, docs, alpha, beta, jar, call, signIn, stop: () => s.stop() };
}

test('routes: a fresh login opens the docs workspace as an Observer, without an account row there', async () => {
  const h = await oidcHub();
  try {
    const accounts = h.docs.listAccounts().length;
    const back = await h.signIn('weave');
    assert.equal(back.status, 302, 'the sign-in on the docs workspace lands');
    assert.equal(back.headers.get('location'), '/w/weave/');
    assert.ok([...h.jar.keys()].includes(`wv_session_${h.alpha.w.state.meta.id}`), 'the session is the login\'s own workspace session');
    assert.equal(h.docs.listAccounts().length, accounts, 'no row per person in the docs workspace');
    const me = await h.call('GET', '/w/weave/api/auth/me');
    assert.equal(me.status, 200);
    const body = await me.json();
    assert.equal(body.role, 'observer');
    assert.equal(body.account.name, 'kyle');
    assert.equal((await h.call('POST', '/w/weave/api/tables/Development%2FIssue/query', { body: {} })).status, 200, 'an Observer reads');
    assert.equal((await h.call('POST', '/w/weave/api/tables/Development%2FIssue/entities', { body: { name: 'direct' } })).status, 403, 'an Observer cannot write the table');
    const filed = await h.call('POST', '/w/weave/api/bug-report', { body: { categories: ['slow'], note: 'from a visitor', events: [], client: {} } });
    assert.equal(filed.status, 201, 'but may submit a bug through the form');
    const issue = h.docs.readEntity((await filed.json()).id);
    assert.equal(issue.createdBy, 'kyle', 'the submitter is the actor');
    const forms = await (await h.call('GET', '/w/weave/api/forms')).json();
    const bug = forms.find((f) => f.name === BUG_FORM_NAME);
    assert.equal((await h.call('POST', `/w/weave/api/forms/${bug.id}/submit`, { body: { note: 'second', events: [] } })).status, 201);
    assert.equal((await h.call('POST', '/w/weave/api/workspace/leave', { body: {} })).status, 403, 'and cannot leave it');
    assert.equal((await h.call('GET', '/w/beta/api/workspace')).status, 401, 'the visit opens the docs workspace only, not a third one');
  } finally { h.stop(); }
});

test('routes: a login no workspace on the hub knows is still refused at the docs workspace', async () => {
  const h = await oidcHub();
  try {
    const back = await h.signIn('weave', STRANGER);
    assert.equal(back.status, 403);
    assert.equal((await h.call('GET', '/w/weave/api/workspace')).status, 401);
  } finally { h.stop(); }
});

test('routes: a token from any workspace on the hub reads the docs workspace as an Observer', async () => {
  const h = await oidcHub();
  try {
    const token = h.alpha.kyle;
    assert.equal((await h.s.call('POST', '/w/weave/api/tables/Development%2FIssue/query', { token, body: {} })).status, 200);
    assert.equal((await h.s.call('POST', '/w/weave/api/tables/Development%2FIssue/entities', { token, body: { name: 'x' } })).status, 403);
    assert.equal((await h.s.call('POST', '/w/weave/api/tables/Development%2FIssue/query', { token: 'wv_nonsense', body: {} })).status, 401);
  } finally { h.stop(); }
});
