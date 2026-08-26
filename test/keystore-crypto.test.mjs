import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';

/* Feature #143, phase 2 — the local keystore is encrypted at rest.
   #64 wrote plaintext JSON at chmod 600, which is honest for one operator's
   API keys on one laptop. It stops being honest the moment the column is
   meant to hold a shared password or an id somebody would be harmed by
   losing, and again when the workspace is hosted. The file mode defends
   against another user on the box; encryption defends against the copy — a
   backup, a sync folder, a stolen disk — which is the leak that actually
   happens. */

function fresh(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-ks-'));
  const path = join(dir, 'keystore.json');
  return { dir, path, w: new Weave({ keystorePath: path, keystoreEnv: env }) };
}

test('a secret written to disk is not readable from the file', () => {
  const { w, path } = fresh();
  w.setKey('stripe', 'sk_live_hush');
  const raw = readFileSync(path, 'utf8');
  assert.doesNotMatch(raw, /sk_live_hush/, 'the secret is not sitting in the file');
  assert.match(raw, /"v":\s*2/, 'the envelope names its format');
  assert.match(raw, /stripe/, 'the NAME stays readable — it is not the secret');
  assert.equal(w.resolveKey('stripe'), 'sk_live_hush', 'and it still round-trips');
});

test('the keystore and the key beside it are both private', () => {
  const { w, path } = fresh();
  w.setKey('a', 'one');
  assert.equal(statSync(path).mode & 0o777, 0o600, 'keystore is chmod 600');
  const keyPath = path.replace(/\.json$/, '.key');
  assert.ok(existsSync(keyPath), 'a generated key file sits beside the keystore');
  assert.equal(statSync(keyPath).mode & 0o777, 0o600, 'and is chmod 600 too');
});

test('a keystore reopens with the key file beside it', () => {
  const { w, path } = fresh();
  w.setKey('a', 'one');
  w.setKey('b', 'two');
  const w2 = new Weave({ keystorePath: path });
  assert.equal(w2.resolveKey('a'), 'one');
  assert.equal(w2.resolveKey('b'), 'two');
  assert.deepEqual(w2.listKeys().map((k) => k.name), ['a', 'b']);
});

test('a plaintext keystore from #64 migrates on open, losing nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-ks-v1-'));
  const path = join(dir, 'keystore.json');
  writeFileSync(path, JSON.stringify({ legacy: 'old-secret', other: 'second' }, null, 1), { mode: 0o600 });

  const w = new Weave({ keystorePath: path });
  assert.equal(w.resolveKey('legacy'), 'old-secret', 'a v1 secret still resolves');
  assert.equal(w.resolveKey('other'), 'second');

  w.setKey('fresh', 'new-secret');
  const raw = readFileSync(path, 'utf8');
  assert.doesNotMatch(raw, /old-secret/, 'the v1 secret is encrypted once anything is written');
  assert.doesNotMatch(raw, /new-secret/);
  assert.equal(w.resolveKey('legacy'), 'old-secret', 'and survives the migration');
});

test('a passphrase in the environment replaces the key file', () => {
  const { w, path } = fresh({ WEAVE_KEYSTORE_PASSPHRASE: 'correct horse battery staple' });
  w.setKey('a', 'one');
  assert.ok(!existsSync(path.replace(/\.json$/, '.key')), 'no key file is written when a passphrase is given');

  const same = new Weave({ keystorePath: path, keystoreEnv: { WEAVE_KEYSTORE_PASSPHRASE: 'correct horse battery staple' } });
  assert.equal(same.resolveKey('a'), 'one');

  const wrong = new Weave({ keystorePath: path, keystoreEnv: { WEAVE_KEYSTORE_PASSPHRASE: 'wrong' } });
  assert.throws(() => wrong.resolveKey('a'), /passphrase|decrypt/i,
    'a wrong passphrase fails loudly rather than reading as an empty keystore');
});

test('a tampered envelope is refused rather than half-read', () => {
  const { w, path } = fresh();
  w.setKey('a', 'one');
  const env = JSON.parse(readFileSync(path, 'utf8'));
  const ct = env.keys.a.ct;
  env.keys.a.ct = ct.slice(0, -4) + (ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  writeFileSync(path, JSON.stringify(env), { mode: 0o600 });

  const w2 = new Weave({ keystorePath: path });
  assert.throws(() => w2.resolveKey('a'), /decrypt|tamper|auth/i, 'GCM catches the edit');
});
