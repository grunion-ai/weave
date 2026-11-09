import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { backup, restore, readTar, keystorePath } from '../src/backup.js';
import { keychainStore, fileStore } from '../src/keystore.js';
import { tempDir } from './lib/temp.mjs';
import { hasKeychain, throwawayKeychain } from './lib/keychain.mjs';

const keychains = [];
after(() => { for (const k of keychains.splice(0)) k.remove(); });

const SECRET = 'sk_test_known_backup_value';

function seed(keyStore) {
  const dir = tempDir('weave-bk-kc-');
  const w = new Weave({ path: join(dir, 'alpha.db'), keyStore });
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.createEntity('Ops/Task', { name: 'Back it up' });
  w.setKey('stripe', SECRET);
  w.setKey('hook', 'second-known-value');
  w.store.close?.();
  return dir;
}

function memoryStore(kind) {
  const keys = {};
  return {
    kind,
    read: () => ({ v: 2, keys: structuredClone(keys) }),
    write(data) { for (const k of Object.keys(keys)) delete keys[k]; for (const [n, { value, ...meta }] of Object.entries(data.keys)) keys[n] = meta; },
    value: () => { throw new Error('a backup never reads a value'); },
    clear() {},
  };
}

test('WEAVE_KEYSTORE=keychain does not read as a key file path', () => {
  assert.equal(keystorePath({ WEAVE_KEYSTORE: 'keychain' }, '/data'), '/data/keystore.json');
  assert.equal(keystorePath({ WEAVE_KEYSTORE: '/elsewhere/keystore.json' }, '/data'), '/elsewhere/keystore.json');
});

test('under the keychain store a backup carries key names and no secret material', async () => {
  const store = memoryStore('keychain');
  const dir = seed(store);
  const r = await backup({ dataDir: dir, out: tempDir('weave-bk-kc-out-'), env: {}, keyStore: store });
  assert.equal(r.encrypted, false);
  assert.deepEqual(r.keys, { store: 'keychain', names: ['hook', 'stripe'] });
  const raw = readFileSync(r.path);
  assert.equal(raw.includes(SECRET), false, 'the known test value is not in the archive');
  assert.equal(raw.includes(Buffer.from(SECRET).toString('hex')), false);
  const names = readTar(r.path).map((e) => e.name);
  assert.ok(names.includes('keys.json'));
  assert.ok(!names.includes('keystore.json'));
  assert.deepEqual(JSON.parse(readTar(r.path).find((e) => e.name === 'keys.json').data), { store: 'keychain', names: ['hook', 'stripe'] });
});

test('a restore of a keychain backup reports each value the key store here is missing', async () => {
  const store = memoryStore('keychain');
  const r = await backup({ dataDir: seed(store), out: tempDir('weave-bk-kc-out-'), env: {}, keyStore: store });
  const here = memoryStore('keychain');
  here.write({ keys: { hook: { owner: null } } });
  const fresh = tempDir('weave-bk-kc-fresh-');
  const rr = await restore({ source: r.path, dataDir: fresh, env: {}, keyStore: here });
  assert.deepEqual(rr.keys, { store: 'keychain', names: ['hook', 'stripe'], missing: ['stripe'] });
  assert.ok(!rr.landed.includes('keys.json'), 'the name list is a report, not a file to land');
  assert.equal(existsSync(join(fresh, 'keys.json')), false);
  assert.ok(existsSync(join(fresh, 'alpha.db')));
});

test('under the file store a backup still carries keystore.json', async () => {
  const dir = tempDir('weave-bk-file-');
  const store = fileStore({ path: join(dir, 'keystore.json'), env: {} });
  const w = new Weave({ path: join(dir, 'alpha.db'), keyStore: store });
  w.setKey('stripe', SECRET);
  w.store.close?.();
  const r = await backup({ dataDir: dir, out: tempDir('weave-bk-file-out-'), env: {} });
  assert.equal(r.keys, null);
  const rr = await restore({ source: r.path, dataDir: tempDir('weave-bk-file-fresh-'), env: { WEAVE_BACKUP_PASSPHRASE: readFileSync(join(dir, 'keystore.key'), 'utf8').trim() } });
  assert.ok(rr.landed.includes('keystore.json'));
  assert.equal(rr.keys, null);
});

if (hasKeychain) {
  test('keychain: after a real keychain store holds the keys, the archive greps clean of the value', async () => {
    const kc = throwawayKeychain();
    keychains.push(kc);
    const store = keychainStore({ keychain: kc.path });
    const dir = seed(store);
    assert.equal(kc.find(`weave:${new Weave({ path: join(dir, 'alpha.db'), keyStore: store }).state.meta.id}:stripe`), SECRET);
    const r = await backup({ dataDir: dir, out: tempDir('weave-bk-kc-out-'), env: {}, keyStore: store });
    const raw = readFileSync(r.path);
    assert.equal(raw.includes(SECRET), false);
    assert.deepEqual(r.keys.names, ['hook', 'stripe']);
  });
}
