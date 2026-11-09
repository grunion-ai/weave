import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { fileStore, migrateKeys } from '../src/keystore.js';
import { tempDir } from './lib/temp.mjs';
import { hasKeychain, throwawayKeychain } from './lib/keychain.mjs';

const keychains = [];
after(() => { for (const k of keychains.splice(0)) k.remove(); });

const keyFile = () => join(tempDir('weave-migrate-'), 'keystore.json');

test('a move whose values do not read back stops before deleting the source', () => {
  const path = keyFile();
  const from = fileStore({ path, env: {} });
  new Weave({ keyStore: from }).setKey('stripe', 'sk_test_kept_on_failure');
  const deaf = { kind: 'keychain', read: () => ({ v: 2, keys: {} }), write() {}, value() { return ''; }, clear() { throw new Error('never cleared'); } };
  assert.throws(() => migrateKeys(from, deaf), /Migration stopped before deleting anything: stripe did not read back from the keychain store/);
  assert.ok(existsSync(path));
  assert.equal(new Weave({ keyStore: from }).resolveKey('stripe'), 'sk_test_kept_on_failure');
});

test('a move to the store already in use is refused', () => {
  const path = keyFile();
  assert.throws(() => migrateKeys(fileStore({ path, env: {} }), fileStore({ path, env: {} })), /already live in the file store/);
});

test('a move weave would not follow is refused before anything moves', () => {
  const path = keyFile();
  const w = new Weave({ keystorePath: path, keystoreEnv: {} });
  w.setKey('stripe', 'sk_test_stays_put');
  assert.throws(() => w.migrateKeys('keychain'), /After the move weave would still read the file store for .*keystore\.json: set WEAVE_KEYSTORE=keychain/);
  assert.throws(() => w.migrateKeys('vault'), /--to keychain or --to file/);
  assert.equal(w.resolveKey('stripe'), 'sk_test_stays_put');
  assert.ok(existsSync(path));
});

if (hasKeychain) {
  test('weave key migrate moves every key into the keychain and back, verified, deleting the source each way', () => {
    const kc = throwawayKeychain();
    keychains.push(kc);
    const path = keyFile();
    const keyPath = path.replace(/\.json$/, '.key');
    const values = { stripe: 'sk_test_migrate_one', 'team/hook': 'line one\nline two', empty: '' };
    const before = new Weave({ keystorePath: path, keystoreEnv: { WEAVE_KEYSTORE: 'file' } });
    for (const [name, value] of Object.entries(values)) before.setKey(name, value);
    before.grantKey('stripe', true);
    const ws = before.state.meta.id;

    const onKeychain = new Weave({ keystorePath: path, keystoreEnv: { WEAVE_KEYSTORE: 'keychain', WEAVE_KEYCHAIN: kc.path } });
    onKeychain.state.meta.id = ws;
    assert.deepEqual(onKeychain.migrateKeys('keychain'), { from: 'file', to: 'keychain', moved: ['empty', 'stripe', 'team/hook'] });
    assert.equal(existsSync(path), false, 'keystore.json is gone');
    assert.equal(existsSync(keyPath), false, 'keystore.key is gone');
    assert.equal(kc.find(`weave:${ws}:stripe`), 'sk_test_migrate_one', 'security reads the value back');
    for (const [name, value] of Object.entries(values)) assert.equal(onKeychain.revealKey(name), value, name);
    assert.equal(onKeychain.keyStore.read().keys.stripe.shared, true, 'sharing travels with the key');

    const onFile = new Weave({ keystorePath: path, keystoreEnv: { WEAVE_KEYSTORE: 'file', WEAVE_KEYCHAIN: kc.path } });
    onFile.state.meta.id = ws;
    assert.deepEqual(onFile.migrateKeys('file').to, 'file');
    assert.ok(existsSync(path));
    assert.doesNotMatch(readFileSync(path, 'utf8'), /sk_test_migrate_one/);
    assert.throws(() => kc.find(`weave:${ws}:stripe`), 'the keychain item is gone');
    assert.throws(() => kc.find('weave:keystore'), 'the index item is gone');
    for (const [name, value] of Object.entries(values)) assert.equal(onFile.revealKey(name), value, name);
  });
}
