import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { read } from '../lib/source.mjs';

const dir = mkdtempSync(join(tmpdir(), 'weave-gcm-'));
process.env.WEAVE_KEYSTORE = join(dir, 'unused-keystore.json');
const { Weave } = await import('../../src/engine.js');

test('a keystore entry whose tag was cut to 12 bytes is refused instead of decrypting under a shorter tag', () => {
  const keystorePath = join(dir, 'keystore.json');
  const w = new Weave({ path: join(dir, 'ws.db'), keystorePath, keystoreEnv: { WEAVE_KEYSTORE_PASSPHRASE: 'gcm-tag-length' } });
  w.setKey('api', 'the-secret');
  assert.equal(w.resolveKey('api'), 'the-secret');
  const data = JSON.parse(readFileSync(keystorePath, 'utf8'));
  const tag = Buffer.from(data.keys.api.tag, 'base64');
  assert.equal(tag.length, 16, 'the keystore writes a full 16-byte tag');
  data.keys.api.tag = tag.subarray(0, 12).toString('base64');
  writeFileSync(keystorePath, JSON.stringify(data));
  assert.throws(() => w.resolveKey('api'), /Cannot decrypt 'api'/);
});

test('both AES-GCM decrypt sites pin the 16-byte tag length', () => {
  for (const file of ['src/backup.js', 'src/engine.js']) {
    const sites = [...read(file).matchAll(/createDecipheriv\('aes-256-gcm'[^\n]*/g)].map((m) => m[0]);
    assert.equal(sites.length, 1, `${file} has one AES-GCM decrypt site`);
    assert.match(sites[0], /authTagLength: 16/, `${file}: ${sites[0]}`);
  }
});
