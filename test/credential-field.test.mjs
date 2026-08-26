import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave, CREDENTIAL_KINDS, KEYSTORES } from '../src/engine.js';
import { FIELD_TYPE_VOCABULARY } from '../src/vocabulary.js';

/* Feature #143 — the credential field: `key` generalized.
   #64 gave the type one shape, an API key named in the local keystore. A
   column now says WHICH sort of credential it holds and WHICH store holds it,
   so the same type covers a shared team password, an OAuth pair, and a
   redacted personal id. The value stays what it always was — a NAME — and the
   secret stays outside the workspace. */

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'weave-cred-'));
  const w = new Weave({ keystorePath: join(dir, 'keystore.json') });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Service' });
  return { w, dir };
}

test('a credential column declares its kind and its keystore, and defaults to both', () => {
  const { w } = fresh();
  const plain = w.addField('Service', { name: 'API Key', type: 'key' });
  assert.deepEqual(plain.config, { kind: 'apikey', keystore: 'local' },
    'a bare key field is an apikey in the local keystore — what #64 always meant');

  const pw = w.addField('Service', { name: 'Portal Login', type: 'key', config: { kind: 'password', keystore: '1password' } });
  assert.equal(pw.config.kind, 'password');
  assert.equal(pw.config.keystore, '1password');
});

test('the kind and the keystore are closed sets, and say so when missed', () => {
  const { w } = fresh();
  assert.throws(
    () => w.addField('Service', { name: 'A', type: 'key', config: { kind: 'passphrase' } }),
    (e) => e.message.includes('passphrase') && CREDENTIAL_KINDS.every((k) => e.message.includes(k)),
    'an unknown kind names every kind that would have worked',
  );
  assert.throws(
    () => w.addField('Service', { name: 'B', type: 'key', config: { keystore: 'lastpass' } }),
    (e) => e.message.includes('lastpass') && KEYSTORES.every((k) => e.message.includes(k)),
  );
});

test('a pair is ONE credential with named parts, not two fields', () => {
  const { w } = fresh();
  const f = w.addField('Service', { name: 'OAuth', type: 'key', config: { kind: 'pair' } });
  assert.deepEqual(f.config.parts, [{ name: 'id', secret: false }, { name: 'secret', secret: true }],
    'a pair without stated parts gets the id/secret shape');

  const named = w.addField('Service', { name: 'Stripe OAuth', type: 'key', config: {
    kind: 'pair', parts: [{ name: 'client_id' }, { name: 'client_secret', secret: true }],
  } });
  assert.deepEqual(named.config.parts, [
    { name: 'client_id', secret: false },
    { name: 'client_secret', secret: true },
  ], 'a stated part is secret only when it says so');
});

test('parts belong to a pair and nowhere else', () => {
  const { w } = fresh();
  assert.throws(
    () => w.addField('Service', { name: 'A', type: 'key', config: { kind: 'apikey', parts: [{ name: 'x' }] } }),
    /parts/i,
    'a single-valued credential has no parts to name',
  );
  assert.throws(
    () => w.addField('Service', { name: 'B', type: 'key', config: { kind: 'pair', parts: [{ name: 'only' }] } }),
    /two/i,
    'a pair with one part is not a pair',
  );
});

test('the cell names the credential and never the secret, whatever the kind', () => {
  const { w } = fresh();
  w.addField('Service', { name: 'API Key', type: 'key' });
  w.setKey('openai-prod', 's3cret-value');
  const e = w.createEntity('Service', { name: 'OpenAI', values: { 'API Key': 'openai-prod' } });

  const read = w.readEntity(e.id);
  assert.match(String(read.fields['API Key']), /openai-prod/, 'the cell names the key');
  assert.doesNotMatch(String(read.fields['API Key']), /s3cret/, 'and never the secret');
  assert.ok(!JSON.stringify(w.exportJSON()).includes('s3cret-value'), 'exports never carry secrets');
});

test('an unset local credential says so; a remote one does not pretend to know', () => {
  const { w } = fresh();
  w.addField('Service', { name: 'Local', type: 'key' });
  w.addField('Service', { name: 'Remote', type: 'key', config: { keystore: '1password' } });
  const e = w.createEntity('Service', { name: 'Acme', values: { Local: 'nope', Remote: 'op-entry' } });

  const read = w.readEntity(e.id);
  assert.match(String(read.fields.Local), /\(unset\)/, 'the local keystore knows it has no such name');
  assert.doesNotMatch(String(read.fields.Remote), /\(unset\)/,
    'weave cannot see inside 1Password, so it may not claim the entry is missing');
});

test('a key field created before #143 reads as a defaulted credential', () => {
  const { w } = fresh();
  const f = w.addField('Service', { name: 'Legacy', type: 'key' });
  // Simulate the pre-#143 shape on disk: config was {} for every key field.
  f.config = {};
  w.save();
  const view = w.getTable('Service');
  const seen = view.fields[f.id];
  assert.equal(w.credentialConfig(seen).kind, 'apikey');
  assert.equal(w.credentialConfig(seen).keystore, 'local');
});

test('text migrates into a credential column with the defaults filled in', () => {
  const { w } = fresh();
  const f = w.addField('Service', { name: 'Token', type: 'text' });
  w.createEntity('Service', { name: 'Row', values: { Token: 'vendor-portal' } });
  w.updateField('Service', f.id, { type: 'key' });
  const after = w.getField('Service', f.id);
  assert.equal(after.type, 'key');
  assert.equal(after.config.kind, 'apikey');
  assert.equal(after.config.keystore, 'local');
});

test('the vocabulary tells an agent what a credential column can be configured with', () => {
  const entry = FIELD_TYPE_VOCABULARY.find((v) => v.type === 'key');
  assert.ok(entry, 'key is in the vocabulary');
  assert.deepEqual(entry.config, ['kind', 'keystore', 'parts']);
  assert.match(entry.renders, /never the secret/i);
});
