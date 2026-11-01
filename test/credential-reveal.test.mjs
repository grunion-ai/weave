import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { tempDir } from './lib/temp.mjs';

const asAccount = (w, name) => { const a = w.listAccounts().find((x) => x.name === name); w.actor = a ? `account:${a.id}` : name; };

function fresh(actor = 'kyle', { solo = false } = {}) {
  const dir = tempDir('weave-reveal-');
  const w = new Weave({ keystorePath: join(dir, 'keystore.json'), actor });
  if (!solo) w.createAccount({ name: 'kyle', role: 'admin' });
  asAccount(w, actor);
  return { w, dir, path: join(dir, 'keystore.json'), as: (name) => asAccount(w, name) };
}


test('the actor who sets a credential owns it, and can read it back', () => {
  const { w } = fresh('kyle');
  w.setKey('stripe', 'sk_live_hush');
  assert.equal(w.revealKey('stripe'), 'sk_live_hush');

  const entry = w.listKeys().find((k) => k.name === 'stripe');
  assert.equal(entry.owner, 'kyle');
  assert.equal(entry.shared, false, 'a new credential starts closed — sharing is a deliberate act');
});

test('a reveal is written to the audit log, and says how it was taken', () => {
  const { w } = fresh('kyle');
  w.setKey('stripe', 'sk_live_hush');
  w.revealKey('stripe', { via: 'copy' });

  const entry = w.listAudit({ limit: 20 }).find((a) => a.action === 'key-revealed');
  assert.ok(entry, 'the reveal is on the record');
  assert.equal(entry.actor, 'kyle');
  assert.equal(entry.detail.name, 'stripe');
  assert.equal(entry.detail.via, 'copy', 'copying is revealing — it is the same act with a shorter path');
  assert.ok(!JSON.stringify(entry).includes('sk_live_hush'), 'the log records the act, never the secret');
});

test('someone else on the same workspace cannot read it back', () => {
  const { w, path } = fresh('kyle');
  w.setKey('stripe', 'sk_live_hush');

  w.actor = 'sajit';
  assert.throws(() => w.revealKey('stripe'), (e) => e.code === 'forbidden',
    'table access is not credential access');
  assert.throws(() => w.revealKey('stripe'), (e) => !String(e.message).includes('sk_live'));
  void path;
});

test('sharing is granted per credential, and revoking takes it back', () => {
  const { w, as } = fresh('kyle');
  w.createAccount({ name: 'sajit', role: 'editor' });
  w.setKey('stripe', 'sk_live_hush');
  w.grantKey('stripe', 'sajit');

  as('sajit');
  assert.equal(w.revealKey('stripe'), 'sk_live_hush', 'a grant is what opens it');

  as('kyle');
  w.revokeKey('stripe', 'sajit');
  as('sajit');
  assert.throws(() => w.revealKey('stripe'), (e) => e.code === 'forbidden');
});

test('one operator with no accounts is not kept out of their own keystore', () => {
  const { w } = fresh('local', { solo: true });
  w.setKey('stripe', 'sk_live_hush');
  w.actor = 'web';
  assert.equal(w.revealKey('stripe'), 'sk_live_hush');
});

test('a grant is itself audited, so an admin opening a credential leaves a trail', () => {
  const { w } = fresh('kyle');
  w.createAccount({ name: 'sajit', role: 'editor' });
  w.setKey('stripe', 'sk_live_hush');
  w.grantKey('stripe', 'sajit');
  const entry = w.listAudit({ limit: 20 }).find((a) => a.action === 'key-granted');
  assert.ok(entry);
  assert.equal(entry.detail.to, 'sajit');
});

test('a credential carried over from #64 has no owner, so nobody reveals it', () => {
  const dir = tempDir('weave-reveal-v1-');
  const path = join(dir, 'keystore.json');
  writeFileSync(path, JSON.stringify({ ancient: 'old-secret' }), { mode: 0o600 });

  const w = new Weave({ keystorePath: path, actor: 'kyle' });
  w.createAccount({ name: 'kyle', role: 'admin' });
  w.createAccount({ name: 'sajit', role: 'editor' });
  asAccount(w, 'sajit');
  assert.throws(() => w.revealKey('ancient'), (e) => e.code === 'forbidden',
    'a credential nobody claimed is shared with nobody');
  assert.throws(() => w.grantKey('ancient', 'sajit'), (e) => e.code === 'forbidden', 'an editor cannot claim an ownerless credential');
  asAccount(w, 'kyle');
  assert.throws(() => w.resolveKey('ancient'), (e) => e.code === 'forbidden');
  w.localKeyAccess = true;
  w.actor = 'local';
  assert.equal(w.resolveKey('ancient'), 'old-secret');
  w.grantKey('ancient', 'sajit');
  asAccount(w, 'sajit');
  assert.equal(w.revealKey('ancient'), 'old-secret');
});

test('a credential in someone else\'s keystore is refused with somewhere to go', () => {
  const { w } = fresh('kyle');
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Service' });
  w.addField('Service', { name: 'Login', type: 'key', config: { keystore: '1password', kind: 'password' } });
  const e = w.createEntity('Service', { name: 'Acme', values: { Login: 'acme-portal' } });

  const link = w.credentialLink(w.getField('Service', 'Login'), 'acme-portal');
  assert.match(link, /^onepassword:\/\/|^op:\/\//, '1Password gets a link that opens 1Password');
  assert.ok(w.readEntity(e.id));
  assert.throws(() => w.revealKey('acme-portal'), (e2) => e2.code === 'not-found',
    'weave never held this secret, so it cannot hand it over');
});

test('the HTTP surface has a reveal verb, and still has no GET', async () => {
  const { w } = fresh('kyle', { solo: true });
  const { token } = w.createAccount({ name: 'kyle', role: 'architect' });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${base}/api/keys`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'stripe', value: 'sk_live_hush' }),
    });
    assert.equal((await fetch(`${base}/api/keys/stripe`, { headers })).status, 404, 'still no read-back by GET');

    const ok = await fetch(`${base}/api/keys/stripe/reveal`, { method: 'POST', headers });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).value, 'sk_live_hush');

    const gone = await fetch(`${base}/api/keys/nope/reveal`, { method: 'POST', headers });
    assert.equal(gone.status, 404);
  } finally {
    server.close();
  }
});

test('a formula cannot launder a secret out through a text column', () => {
  const { w } = fresh('kyle');
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Service' });
  w.addField('Service', { name: 'API Key', type: 'key' });
  w.setKey('openai-prod', 's3cret-value');
  w.addField('Service', { name: 'Leak', type: 'formula', config: { expression: 'concat("<", [API Key], ">")' } });
  const e = w.createEntity('Service', { name: 'OpenAI', values: { 'API Key': 'openai-prod' } });

  const read = w.readEntity(e.id);
  assert.doesNotMatch(String(read.fields.Leak), /s3cret/,
    'a formula over a credential sees the name, which is all the cell ever held');
  assert.ok(!JSON.stringify(w.exportJSON()).includes('s3cret-value'));
  assert.ok(!JSON.stringify(w.query('Service', { limit: 10 })).includes('s3cret-value'));
});

test('a reveal the engine refuses answers 403 over HTTP, not 400', async () => {
  const { w } = fresh('kyle');
  const { token } = w.createAccount({ name: 'sajit', role: 'admin' });
  w.setKey('stripe', 'sk_live_hush');
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const denied = await fetch(`${base}/api/keys/stripe/reveal`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, 'forbidden');
  } finally {
    server.close();
  }
});

test('renaming an account keeps the credentials it owns and the ones shared with it (Issue #884)', () => {
  const { w , as } = fresh('kyle');
  w.createAccount({ name: 'sajit', role: 'editor' });
  w.setKey('stripe', 'sk_live_hush');
  w.grantKey('stripe', 'sajit');
  w.renameAccount('kyle', 'kyle.adriany');
  as('kyle.adriany');
  assert.equal(w.revealKey('stripe'), 'sk_live_hush', 'the owner still reads its own credential after a rename');
  assert.equal(w.listKeys().find((k) => k.name === 'stripe').owner, 'kyle.adriany');
  w.createAccount({ name: 'ann', role: 'editor' });
  w.grantKey('stripe', 'ann');
  w.renameAccount('sajit', 'sajit.p');
  as('sajit.p');
  assert.equal(w.revealKey('stripe'), 'sk_live_hush', 'a grant follows the account across its own rename');
  as('kyle');
  assert.throws(() => w.revealKey('stripe'), (e) => e.code === 'forbidden', 'the old name holds nothing');
});

test('renaming an account with no keystore leaves no keystore behind (Issue #884)', () => {
  const { w, path } = fresh('kyle');
  w.renameAccount('kyle', 'kyle.adriany');
  assert.equal(existsSync(path), false);
});
