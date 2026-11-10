import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';
import { withServer } from './lib/fixtures.mjs';

function fresh() {
  const dir = tempDir('weave-keys-');
  const w = new Weave({ keystorePath: join(dir, 'keystore.json') });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Service' });
  return { w, dir };
}

test('the secret lives in the keystore, the value is only a name', () => {
  const { w } = fresh();
  w.addField('Service', { name: 'API Key', type: 'key' });
  w.setKey('openai-prod', 's3cret-value');
  const e = w.createEntity('Service', { name: 'OpenAI', values: { 'API Key': 'openai-prod' } });

  assert.equal(w.hasKey('openai-prod'), true);
  assert.equal(w.resolveKey('openai-prod'), 's3cret-value');
  assert.ok(!JSON.stringify(w.exportJSON()).includes('s3cret-value'), 'exports never carry secrets');

  const read = w.readEntity(e.id);
  assert.ok(String(read.fields['API Key']).includes('openai-prod'), 'the cell names the key');
  assert.ok(!String(read.fields['API Key']).includes('s3cret'), 'and never the secret');
});

test('the keystore file is private and survives reopening', () => {
  const { w, dir } = fresh();
  w.setKey('a', 'one');
  const path = join(dir, 'keystore.json');
  assert.equal(statSync(path).mode & 0o777, 0o600, 'keystore is chmod 600');
  assert.ok(readFileSync(path, 'utf8').includes('"a"'), 'the keystore holds the name');

  const w2 = new Weave({ keystorePath: path });
  assert.equal(w2.resolveKey('a'), 'one');
  w2.deleteKey('a');
  assert.equal(w2.hasKey('a'), false);
});

test('key is a definable, defaultable-free value type', () => {
  const { w } = fresh();
  const f = w.addField('Service', { name: 'K', type: 'key' });
  assert.equal(f.type, 'key');
  const row = w.listEntities(w.getTable('Fields').id).find((e) => w.entityName(e) === 'K');
  assert.ok(row);
});

test('the authenticated API sets and lists keys while a generic key GET never reveals a secret', async () => {
  const { w } = fresh();
  const { token } = w.createAccount({ name: 'key-owner', role: 'architect' });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  await withServer(w, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/keys`)).status, 401);
    const denied = await fetch(`${base}/api/keys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'stripe', value: 'sk_live_hush' }),
    });
    assert.equal(denied.status, 401);
    assert.equal(w.hasKey('stripe'), false);
    const set = await fetch(`${base}/api/keys`, {
      method: 'POST', headers,
      body: JSON.stringify({ name: 'stripe', value: 'sk_live_hush' }),
    });
    assert.equal(set.status, 201);
    const list = await (await fetch(`${base}/api/keys`, { headers })).json();
    assert.deepEqual(list.map((k) => k.name), ['stripe']);
    assert.equal(list[0].set, true);
    assert.ok(!JSON.stringify(list).includes('hush'));
    assert.equal((await fetch(`${base}/api/keys/stripe`, { headers })).status, 404, 'no read-back endpoint');
    assert.equal((await fetch(`${base}/api/keys/stripe`, { method: 'DELETE', headers })).status, 200);
    assert.equal(w.hasKey('stripe'), false);
  });
});

test('a credential field takes a new kind, keystore and parts through updateField (Issue #1500)', () => {
  const { w } = fresh();
  const f = w.addField('Service', { name: 'Token', type: 'key', config: { kind: 'pair', keystore: '1password' } });
  assert.deepEqual(w.getField('Service', f.id).config.parts, [{ name: 'id', secret: false }, { name: 'secret', secret: true }]);

  w.updateField('Service', f.id, { config: { kind: 'token' } });
  const token = w.getField('Service', f.id).config;
  assert.equal(token.kind, 'token', 'the new kind lands');
  assert.equal(token.keystore, '1password', 'the keystore it did not name is left alone');
  assert.equal('parts' in token, false, 'a single-value credential keeps no parts');

  w.updateField('Service', f.id, { config: { keystore: 'local' } });
  assert.equal(w.getField('Service', f.id).config.keystore, 'local', 'the new keystore lands');

  w.updateField('Service', f.id, { config: { kind: 'pair', parts: ['client', { name: 'secret', secret: true }] } });
  assert.deepEqual(w.getField('Service', f.id).config.parts, [{ name: 'client', secret: false }, { name: 'secret', secret: true }]);

  assert.throws(() => w.updateField('Service', f.id, { config: { kind: 'nope' } }), /Invalid credential kind/);
  assert.throws(() => w.updateField('Service', f.id, { config: { parts: ['only-one'] } }), /A pair names exactly two parts/);
  assert.equal(w.getField('Service', f.id).config.kind, 'pair', 'a refused patch changes nothing');
});

test('a credential kind edited in a schema document lands through applySchema (Issue #1500)', () => {
  const { w } = fresh();
  w.addField('Service', { name: 'Token', type: 'key', config: { kind: 'pair', keystore: '1password' } });
  const doc = w.describeSchema();
  const field = doc.flatMap((s) => s.tables).find((t) => t.name === 'Service').fields.find((f) => f.name === 'Token');
  field.kind = 'token';
  field.keystore = 'local';
  delete field.parts;

  assert.deepEqual(w.applySchema(doc, { dryRun: true }).map((p) => p.action), ['update-field']);
  w.applySchema(doc);
  const after = Object.values(w.getTable('Service').fields).find((f) => f.name === 'Token').config;
  assert.equal(after.kind, 'token');
  assert.equal(after.keystore, 'local');
  assert.deepEqual(w.applySchema(w.describeSchema(), { dryRun: true }), [], 'the document and the field now agree');
});
