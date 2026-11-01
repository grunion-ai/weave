import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';

process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { client } = await import('../lib/fixtures.mjs');

function build() {
  const keystorePath = join(tempDir('weave-ks-'), 'keystore.json');
  const w = new Weave({ keystorePath });
  const kyle = w.createAccount({ name: 'kyle', role: 'architect' });
  const sajit = w.createAccount({ name: 'sajit', role: 'editor' });
  const id = (made) => `account:${made.account.id}`;
  return { w, keystorePath, kyle, sajit, as: (made) => { w.actor = made ? id(made) : 'nobody'; }, id };
}

const raw = (path) => JSON.parse(readFileSync(path, 'utf8')).keys;
const legacy = (path, name, patch) => {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  Object.assign(data.keys[name], patch);
  writeFileSync(path, JSON.stringify(data));
};

test('setting a key records the caller\'s account id as owner, and grants store account ids', () => {
  const { w, keystorePath, kyle, sajit, as, id } = build();
  as(kyle);
  w.setKey('stripe', 'sk_test_hush');
  w.grantKey('stripe', 'sajit');
  const entry = raw(keystorePath).stripe;
  assert.equal(entry.owner, id(kyle));
  assert.deepEqual(entry.shared, [id(sajit)]);
  assert.equal(w.listKeys().find((k) => k.name === 'stripe').owner, 'kyle', 'the list still names the owner');
});

test('a free-text actor that spells an account name opens nothing', () => {
  const { w, kyle, as } = build();
  as(kyle);
  w.setKey('stripe', 'sk_test_hush');
  w.actor = 'kyle';
  assert.throws(() => w.revealKey('stripe'), (e) => e.code === 'forbidden');
  assert.throws(() => w.grantKey('stripe', 'sajit'), (e) => e.code === 'forbidden');
  assert.throws(() => w.revokeKey('stripe', 'sajit'), (e) => e.code === 'forbidden');
  assert.equal(w.ownsKey('stripe'), false);
});

test('a legacy free-text owner or grant no longer matches the account of that name', () => {
  const { w, keystorePath, kyle, sajit, as } = build();
  as(kyle);
  w.setKey('legacy', 'old-secret');
  legacy(keystorePath, 'legacy', { owner: 'kyle', shared: ['sajit'] });
  as(sajit);
  assert.throws(() => w.revealKey('legacy'), (e) => e.code === 'forbidden', 'a grant by name is not a grant to the account');
  as(kyle);
  assert.throws(() => w.revealKey('legacy'), (e) => e.code === 'forbidden', 'the account named kyle is not the text kyle');
  assert.equal(w.ownsKey('legacy'), false);
  assert.throws(() => w.grantKey('legacy', 'sajit'), (e) => e.code === 'forbidden');
  w.localKeyAccess = true;
  w.actor = 'local';
  w.grantKey('legacy', 'sajit');
  as(sajit);
  assert.equal(w.revealKey('legacy'), 'old-secret', 'a local operator re-grants it by account');
});

test('an ownerless key requires explicit local recovery and granting claims nothing', () => {
  const { w, keystorePath, kyle, sajit, as, id } = build();
  w.actor = 'web';
  w.setKey('orphan', 'nobody-owns-me');
  assert.equal(raw(keystorePath).orphan.owner, null, 'a caller with no account records no owner');
  as(sajit);
  assert.throws(() => w.grantKey('orphan', 'sajit'), (e) => e.code === 'forbidden', 'an editor cannot grant an ownerless key to itself');
  assert.throws(() => w.revokeKey('orphan', 'kyle'), (e) => e.code === 'forbidden');
  assert.equal(raw(keystorePath).orphan.owner, null, 'a refused grant claims nothing');
  as(kyle);
  assert.throws(() => w.grantKey('orphan', 'sajit'), (e) => e.code === 'forbidden');
  assert.throws(() => w.revokeKey('orphan', 'sajit'), (e) => e.code === 'forbidden');
  w.localKeyAccess = true;
  w.actor = 'local';
  w.grantKey('orphan', 'sajit');
  assert.equal(raw(keystorePath).orphan.owner, null, 'a local recovery grant does not claim ownership');
  assert.deepEqual(raw(keystorePath).orphan.shared, [id(sajit)]);
  as(sajit);
  assert.equal(w.revealKey('orphan'), 'nobody-owns-me');
});

test('a grant to a name with no account is refused', () => {
  const { w, kyle, as } = build();
  as(kyle);
  w.setKey('stripe', 'sk_test_hush');
  assert.throws(() => w.grantKey('stripe', 'mallory'), (e) => e.code === 'invalid');
});

test('an account-less workspace keeps its keystore open to the local operator', () => {
  const keystorePath = join(tempDir('weave-ks-'), 'keystore.json');
  const w = new Weave({ keystorePath, actor: 'local' });
  w.setKey('stripe', 'sk_test_hush');
  w.actor = 'web';
  assert.equal(w.revealKey('stripe'), 'sk_test_hush');
});

test('over HTTP, a root editor whose name matches a legacy owner cannot rotate or delete that key', async () => {
  process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const writer = root.createAccount({ name: 'root-writer', role: 'editor' });
  root.actor = `account:${writer.account.id}`;
  root.setKey('w', 'legacy-secret');
  legacy(process.env.WEAVE_KEYSTORE, 'w', { owner: 'root-writer' });
  const call = client(createWorkspaceHub(root));
  assert.equal((await call('POST', '/api/keys', { token: writer.token, body: { name: 'w', value: 'rotated' } })).status, 403);
  assert.equal((await call('DELETE', '/api/keys/w', { token: writer.token })).status, 403);
  assert.equal((await call('POST', '/api/keys/w/reveal', { token: writer.token })).status, 403);
  assert.equal(root.resolveKey('w'), 'legacy-secret');
});
