import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer } from '../src/server.js';

/* Feature #14 — accounts, permissions, and the audit log: the groundwork a
   hosted instance (v0.5, #84) stands on. Accounts carry a role and a token;
   the token is handed out exactly once and only its hash is stored. The
   server names the caller from a Bearer token, enforces the role, and — when
   the workspace demands auth — refuses anonymous API calls. Structural
   changes land in a durable audit log that names actor, action and subject,
   riding the actor plumbing from #65. */

test('an account is born with a token that is never stored in the clear', () => {
  const w = new Weave();
  const { account, token } = w.createAccount({ name: 'deploy-bot', role: 'writer' });
  assert.equal(account.role, 'writer');
  assert.match(token, /^wv_/);
  assert.ok(!JSON.stringify(w.exportJSON()).includes(token), 'the raw token is nowhere at rest');

  assert.equal(w.verifyToken(token).name, 'deploy-bot');
  assert.equal(w.verifyToken('wv_wrong'), null);

  const listed = w.listAccounts();
  assert.equal(listed.length, 1);
  assert.ok(!('tokenHash' in listed[0]), 'listings never leak hashes');

  w.deleteAccount('deploy-bot');
  assert.equal(w.verifyToken(token), null);
});

test('roles are validated and names are unique', () => {
  const w = new Weave();
  w.createAccount({ name: 'a' });
  assert.throws(() => w.createAccount({ name: 'a' }), /exists/);
  assert.throws(() => w.createAccount({ name: 'b', role: 'god' }), /role/i);
});

test('structural changes land in the audit log with their actor', () => {
  const w = new Weave({ actor: 'ada' });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Estimate', type: 'number' });
  w.deleteField('Task', 'Estimate');
  const log = w.listAudit({ limit: 50 });
  const actions = log.map((r) => r.action);
  assert.ok(actions.includes('space-created'));
  assert.ok(actions.includes('table-created'));
  assert.ok(actions.includes('field-added'));
  assert.ok(actions.includes('field-deleted'));
  assert.ok(log.every((r) => r.actor === 'ada'));
  const fieldAdd = log.find((r) => r.action === 'field-added');
  assert.equal(fieldAdd.detail.table, 'Task');
  assert.equal(fieldAdd.detail.name, 'Estimate');
});

test('account lifecycle is itself audited', () => {
  const w = new Weave();
  const { account } = w.createAccount({ name: 'bot' });
  w.deleteAccount(account.id);
  const actions = w.listAudit({ limit: 10 }).map((r) => r.action);
  assert.ok(actions.includes('account-created'));
  assert.ok(actions.includes('account-deleted'));
});

async function serve(w) {
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, token) => fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { server, call };
}

test('a Bearer token names the actor and its role gates what it may do', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const writer = w.createAccount({ name: 'writer-bot', role: 'writer' }).token;
  const reader = w.createAccount({ name: 'reader-bot', role: 'reader' }).token;
  const { server, call } = await serve(w);
  try {
    // Writer: entity CRUD yes, schema no.
    const made = await call('POST', '/api/tables/Task/entities', { name: 'By bot' }, writer);
    assert.equal(made.status, 201);
    assert.equal((await made.json()).createdBy, 'writer-bot');
    assert.equal((await call('POST', '/api/spaces', { name: 'Nope' }, writer)).status, 403);
    assert.equal((await call('DELETE', '/api/tables/Task', undefined, writer)).status, 403);

    // Reader: reads only.
    assert.equal((await call('GET', '/api/schema', undefined, reader)).status, 200);
    assert.equal((await call('POST', '/api/tables/Task/entities', { name: 'X' }, reader)).status, 403);

    // A bad token is a 401, not an anonymous fallthrough.
    assert.equal((await call('GET', '/api/schema', undefined, 'wv_bogus')).status, 401);
  } finally {
    server.close();
  }
});

test('requireAuth closes the API to anonymous callers — health stays open', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  w.setRequireAuth(true);
  const { server, call } = await serve(w);
  try {
    assert.equal((await call('GET', '/api/schema')).status, 401);
    assert.equal((await call('GET', '/api/health')).status, 200);
    assert.equal((await call('GET', '/api/schema', undefined, admin)).status, 200);
    // Admin can do schema work.
    assert.equal((await call('POST', '/api/spaces', { name: 'Ops' }, admin)).status, 201);
  } finally {
    server.close();
  }
});
