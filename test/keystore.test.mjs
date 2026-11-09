import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { fileStore, keychainStore, keystoreKind, openKeyStore, runSecurity } from '../src/keystore.js';
import { tempDir } from './lib/temp.mjs';
import { hasKeychain, throwawayKeychain } from './lib/keychain.mjs';

const keychains = [];
after(() => { for (const k of keychains.splice(0)) k.remove(); });

const IMPLEMENTATIONS = [
  ['file', () => {
    const path = join(tempDir('weave-ks-file-'), 'keystore.json');
    return { store: () => fileStore({ path, env: {} }), raw: () => (existsSync(path) ? readFileSync(path, 'utf8') : '') };
  }],
  ...(hasKeychain ? [['keychain', () => {
    const kc = throwawayKeychain();
    keychains.push(kc);
    return { store: () => keychainStore({ keychain: kc.path }), raw: () => kc.dump(), kc };
  }]] : []),
];

for (const [kind, make] of IMPLEMENTATIONS) {
  const fresh = () => {
    const box = make();
    return { ...box, w: new Weave({ keyStore: box.store() }) };
  };

  test(`${kind}: a key set reads back through resolve, reveal, has and list`, () => {
    const { w } = fresh();
    assert.equal(w.keyStore.kind, kind);
    w.setKey('stripe', 'sk_test_round_trip');
    assert.equal(w.hasKey('stripe'), true);
    assert.equal(w.hasKey('absent'), false);
    assert.equal(w.resolveKey('stripe'), 'sk_test_round_trip');
    assert.equal(w.revealKey('stripe'), 'sk_test_round_trip');
    assert.deepEqual(w.listKeys().map((k) => k.name), ['stripe']);
  });

  test(`${kind}: a second engine on the same store reads the keys the first wrote`, () => {
    const box = make();
    new Weave({ keyStore: box.store() }).setKey('shared', 'one-value');
    assert.equal(new Weave({ keyStore: box.store() }).resolveKey('shared'), 'one-value');
  });

  test(`${kind}: replacing a key keeps its createdAt and stamps rotatedAt`, () => {
    const { w } = fresh();
    w.setKey('api', 'first');
    const born = w.keyStore.read().keys.api.createdAt;
    w.setKey('api', 'second');
    const entry = w.keyStore.read().keys.api;
    assert.equal(entry.createdAt, born);
    assert.ok(entry.rotatedAt);
    assert.equal(w.resolveKey('api'), 'second');
  });

  test(`${kind}: deleting a key removes its value`, () => {
    const { w } = fresh();
    w.setKey('gone', 'bye-value');
    w.setKey('kept', 'stay-value');
    assert.deepEqual(w.deleteKey('gone'), { name: 'gone', deleted: true });
    assert.equal(w.hasKey('gone'), false);
    assert.throws(() => w.resolveKey('gone'), /not found/);
    assert.throws(() => w.deleteKey('gone'), /not found/);
    assert.equal(w.resolveKey('kept'), 'stay-value');
  });

  test(`${kind}: sharing and unsharing a key changes only its access list`, () => {
    const { w } = fresh();
    w.setKey('team', 'team-value');
    assert.equal(w.grantKey('team', true).shared, true);
    assert.equal(w.keyStore.read().keys.team.shared, true);
    w.revokeKey('team', 'nobody');
    assert.equal(w.keyStore.read().keys.team.shared, false);
    assert.equal(w.resolveKey('team'), 'team-value');
  });

  test(`${kind}: quotes, backslashes, line breaks, accents and the empty string round-trip`, () => {
    const { w } = fresh();
    const values = { quote: 'a"b\'c', slash: 'C:\\path\\x', lines: 'line one\nline two\n', accent: 'clé ünïcødé ✓', empty: '', hexish: '6869', spaced: '  padded  ' };
    for (const [name, value] of Object.entries(values)) w.setKey(name, value);
    for (const [name, value] of Object.entries(values)) assert.equal(w.resolveKey(name), value, name);
  });

  test(`${kind}: the stored form never holds the value in the clear`, () => {
    const box = make();
    const w = new Weave({ keyStore: box.store() });
    w.setKey('visible-name', 'sk_test_never_in_clear');
    assert.doesNotMatch(JSON.stringify(w.keyStore.read()), /sk_test_never_in_clear/);
    if (kind === 'file') assert.doesNotMatch(box.raw(), /sk_test_never_in_clear/);
  });
}

if (hasKeychain) {
  test('keychain: each key is one item named weave:<workspace>:<key> that security reads back', () => {
    const kc = throwawayKeychain();
    keychains.push(kc);
    const w = new Weave({ keyStore: keychainStore({ keychain: kc.path }) });
    w.setKey('stripe', 'sk_test_item_per_key');
    assert.equal(kc.find(`weave:${w.state.meta.id}:stripe`), 'sk_test_item_per_key');
    assert.equal(w.revealKey('stripe'), 'sk_test_item_per_key');
    assert.doesNotMatch(kc.find('weave:keystore'), /sk_test_item_per_key/, 'the index item holds names and access, never values');
  });

  test('keychain: a value never reaches the argument list of a security process', () => {
    const kc = throwawayKeychain();
    keychains.push(kc);
    const calls = [];
    const run = (bin, args, input) => { calls.push(args); return runSecurity(bin, args, input); };
    const w = new Weave({ keyStore: keychainStore({ keychain: kc.path, run }) });
    const value = 'sk_test_off_ps_list';
    w.setKey('secret', value);
    w.setKey('secret', value);
    assert.equal(w.resolveKey('secret'), value);
    w.deleteKey('secret');
    const hex = Buffer.from(value).toString('hex');
    assert.ok(calls.length > 3);
    for (const args of calls) {
      const line = args.join(' ');
      assert.doesNotMatch(line, new RegExp(value), line);
      assert.ok(!line.toLowerCase().includes(hex), line);
    }
    assert.ok(calls.some((a) => a[0] === '-i'), 'writes go through security -i, which reads the command from stdin');
  });
}

test('the store is picked by platform, and WEAVE_KEYSTORE=file|keychain overrides it', () => {
  const home = tempDir('weave-ks-home-');
  const fallback = join(home, '.weave', 'keystore.json');
  const security = join(home, 'security');
  writeFileSync(security, '');
  assert.equal(keystoreKind({ path: fallback, home, platform: 'darwin', security }), 'keychain', 'macOS with security and no key file');
  assert.equal(keystoreKind({ path: fallback, home, platform: 'linux', security }), 'file', 'Linux');
  assert.equal(keystoreKind({ path: fallback, home, platform: 'darwin', security: join(home, 'absent') }), 'file', 'no security binary');
  assert.equal(keystoreKind({ path: join(home, 'elsewhere.json'), home, platform: 'darwin', security }), 'file', 'a keystore path set by hand');
  assert.equal(keystoreKind({ path: fallback, home, platform: 'linux', security, pick: 'keychain' }), 'keychain');
  assert.equal(keystoreKind({ path: fallback, home, platform: 'darwin', security, pick: 'file' }), 'file');
  mkdirSync(join(home, '.weave'));
  writeFileSync(fallback, '{}');
  assert.equal(keystoreKind({ path: fallback, home, platform: 'darwin', security }), 'file', 'an existing key file keeps the file store until it is migrated');
});

test('WEAVE_KEYSTORE as a path still means the file store at that path', () => {
  const path = join(tempDir('weave-ks-path-'), 'keystore.json');
  const w = new Weave({ keystoreEnv: { WEAVE_KEYSTORE: path }, keystorePath: path });
  assert.equal(w.keyStore.kind, 'file');
  w.setKey('a', 'one');
  assert.ok(existsSync(path));
  assert.throws(() => openKeyStore({ path, kind: 'vault' }), /Unknown key store 'vault'/);
});

test('the engine holds no cipher of its own: the key store owns encryption', () => {
  const src = readFileSync(new URL('../src/engine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /createCipheriv|createDecipheriv|#readKeystore|#writeKeystore/);
});
