import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

/* Feature #64 — the key field type. A key field's VALUE is only a name; the
   secret lives in a keystore outside workspace data and never crosses into
   state, exports, or any read endpoint. The cell says which key and whether
   the keystore holds it — nothing more. This is how workspace rows (#12) can
   carry API credentials without the workspace file becoming a secret. */

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'weave-keys-'));
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
  assert.ok(readFileSync(path, 'utf8').includes('one'), 'the keystore holds the secret');

  const w2 = new Weave({ keystorePath: path });
  assert.equal(w2.resolveKey('a'), 'one');
  w2.deleteKey('a');
  assert.equal(w2.hasKey('a'), false);
});

test('key is a definable, defaultable-free value type', () => {
  const { w } = fresh();
  const f = w.addField('Service', { name: 'K', type: 'key' });
  assert.equal(f.type, 'key');
  // A key rides the Fields registry like any definable type.
  const row = w.listEntities(w.getTable('Fields').id).find((e) => w.entityName(e) === 'K');
  assert.ok(row);
});

test('the API sets and lists keys but can never read one back', async () => {
  const { w } = fresh();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const set = await fetch(`${base}/api/keys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'stripe', value: 'sk_live_hush' }),
    });
    assert.equal(set.status, 201);
    const list = await (await fetch(`${base}/api/keys`)).json();
    assert.deepEqual(list, [{ name: 'stripe', set: true }]);
    assert.ok(!JSON.stringify(list).includes('hush'));
    assert.equal((await fetch(`${base}/api/keys/stripe`)).status, 404, 'no read-back endpoint');
    assert.equal((await fetch(`${base}/api/keys/stripe`, { method: 'DELETE' })).status, 200);
    assert.equal(w.hasKey('stripe'), false);
  } finally {
    server.close();
  }
});
