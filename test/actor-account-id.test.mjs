import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

async function signedIn(t) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-actor-keys-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const w = new Weave({ keystorePath: join(dir, 'keystore.json') });
  w.createSpace({ name: 'Ops' });
  const table = w.createTable({ space: 'Ops', name: 'Ticket' });
  w.actor = 'kyle';
  const legacy = w.createEntity(table.id, { name: 'before the change' });
  w.setKey('legacy', 'sk_test_legacy');
  const made = w.createAccount({ name: 'kyle', role: 'architect' });
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0 });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${made.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };
  return { w, table, legacy, account: made.account, call };
}

test('a signed-in write stores the account id, and history follows a rename (Issue #699)', async (t) => {
  const { w, table, account, call } = await signedIn(t);
  const row = (await call('POST', `/api/tables/${table.id}/entities`, { name: 'r1', doc: 'first' })).body;
  assert.equal((await call('PUT', `/api/entities/${row.id}/doc`, { doc: 'second' })).status, 200);
  assert.equal((await call('POST', '/api/keys', { name: 'stripe', value: 'sk_test_hush' })).status, 201);

  const stored = w.getEntity(row.id);
  assert.equal(stored.createdBy, `account:${account.id}`, 'createdBy stores the account id');
  assert.equal(stored.modifiedBy, `account:${account.id}`, 'modifiedBy stores the account id');
  assert.ok(stored.activity.every((a) => a.actor === `account:${account.id}`), 'activity stores the account id');
  assert.ok(w.store.listAudit({ limit: -1 }).some((r) => r.action === 'key-set' && r.actor === `account:${account.id}`), 'the audit line stores the account id');

  w.renameAccount('kyle', 'kyle.adriany');

  const read = (await call('GET', `/api/entities/${row.id}`)).body;
  assert.equal(read.createdBy, 'kyle.adriany', 'the row names its writer by the current name');
  assert.equal(read.modifiedBy, 'kyle.adriany');
  assert.ok(read.activity.every((a) => a.actor === 'kyle.adriany'), 'the record panel activity names the current name');
  const feed = (await call('GET', `/api/activity?entity=${row.id}`)).body;
  assert.ok(feed.items.length && feed.items.every((a) => a.actor === 'kyle.adriany'), 'the activity feed names the current name');
  const one = (await call('GET', `/api/activity/${encodeURIComponent(feed.items[0].id)}`)).body;
  assert.equal(one.actor, 'kyle.adriany', 'one activity event names the current name');
  const audit = (await call('GET', '/api/audit?limit=-1')).body;
  const events = audit.events ?? audit;
  assert.equal(events.find((r) => r.action === 'key-set')?.actor, 'kyle.adriany', 'the audit log names the current name');
  const revs = (await call('GET', `/api/entities/${row.id}/doc/revisions`)).body.revisions;
  assert.ok(revs.length && revs.every((r) => r.actor === 'kyle.adriany'), 'doc revisions name the current name');
  const rev = (await call('GET', `/api/entities/${row.id}/doc/revisions/${revs[0].seq}`)).body;
  assert.equal(rev.actor, 'kyle.adriany', 'one doc revision names the current name');
  const queried = (await call('POST', `/api/tables/${table.id}/query`, { where: [['Created By', '=', 'kyle.adriany']] })).body;
  assert.deepEqual((queried.items ?? queried.entities ?? queried).map((e) => e.id), [row.id], 'a Created By filter matches the current name');

  const reveal = await call('POST', '/api/keys/stripe/reveal', {});
  assert.equal(reveal.status, 200, 'the owner reads its own credential after a rename');
  assert.equal(reveal.body.value, 'sk_test_hush');
  const keys = (await call('GET', '/api/keys')).body;
  assert.equal(keys.find((k) => k.name === 'stripe').owner, 'kyle.adriany', 'the key list names the owner by its current name');

  const mcp = dispatchTool(w, 'weave_activity', { entity: row.id });
  assert.ok(mcp.items.every((a) => a.actor === 'kyle.adriany'), 'weave_activity names the current name');
  assert.equal(dispatchTool(w, 'weave_get_entity', { entity: row.id }).createdBy, 'kyle.adriany', 'weave_get_entity names the current name');
  assert.equal(dispatchTool(w, 'weave_audit', { limit: -1 }).events.find((r) => r.action === 'key-set').actor, 'kyle.adriany', 'weave_audit names the current name');
});

test('a line written before the change keeps the name it holds, and a legacy credential stays its owner\'s (Issue #699)', async (t) => {
  const { w, legacy, call } = await signedIn(t);
  assert.equal((await call('POST', '/api/keys/legacy/reveal', {})).status, 200, 'a credential owned by the account name still opens for that account');
  w.renameAccount('kyle', 'kyle.adriany');
  assert.equal(w.getEntity(legacy.id).createdBy, 'kyle', 'the stored line is not rewritten');
  assert.equal((await call('GET', `/api/entities/${legacy.id}`)).body.createdBy, 'kyle', 'and renders as it was written');
  assert.equal((await call('POST', '/api/keys/legacy/reveal', {})).status, 200, 'and after a rename');
});

test('a grant names an account and follows it across a rename (Issue #699)', async (t) => {
  const { w, call } = await signedIn(t);
  const sajit = w.createAccount({ name: 'sajit', role: 'architect' });
  assert.equal((await call('POST', '/api/keys', { name: 'stripe', value: 'sk_test_hush' })).status, 201);
  assert.equal((await call('POST', '/api/keys/stripe/share', { account: 'sajit' })).status, 200);
  w.renameAccount('sajit', 'sajit.p');
  const keys = (await call('GET', '/api/keys')).body;
  assert.deepEqual(keys.find((k) => k.name === 'stripe').shared, ['sajit.p'], 'the grant names the account by its current name');
  w.actor = `account:${sajit.account.id}`;
  assert.equal(w.revealKey('stripe'), 'sk_test_hush', 'the grantee reads it after its own rename');
  w.actor = `account:${(w.listAccounts().find((a) => a.name === 'kyle')).id}`;
  assert.deepEqual(w.revokeKey('stripe', 'sajit.p').shared, [], 'revoking by the current name takes it back');
});

test('a removed account renders as removed, never as its id (Issue #699)', async (t) => {
  const { w, table, call } = await signedIn(t);
  const other = w.createAccount({ name: 'temp', role: 'editor' });
  w.actor = `account:${other.account.id}`;
  const row = w.createEntity(table.id, { name: 'by temp' });
  w.deleteAccount('temp');
  const read = (await call('GET', `/api/entities/${row.id}`)).body;
  assert.equal(read.createdBy, 'removed account');
});

test('weave get and weave activity print the current name (Issue #699)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-actor-'));
  try {
    const data = join(dir, 'ws.db');
    const w = new Weave({ path: data, keystorePath: join(dir, 'keystore.json') });
    w.createSpace({ name: 'Ops' });
    const table = w.createTable({ space: 'Ops', name: 'Ticket' });
    const { account } = w.createAccount({ name: 'kyle', role: 'architect' });
    w.actor = `account:${account.id}`;
    const row = w.createEntity(table.id, { name: 'r1' });
    w.renameAccount('kyle', 'kyle.adriany');
    w.save?.();
    const cli = (...a) => JSON.parse(execFileSync('node', [BIN, ...a, '--data', data], { encoding: 'utf8' }));
    assert.equal(cli('get', row.id).createdBy, 'kyle.adriany');
    assert.ok(cli('activity', '--entity', row.id).items.every((a) => a.actor === 'kyle.adriany'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
