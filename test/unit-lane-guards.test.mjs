import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/source.mjs';
import { tempDir } from './lib/temp.mjs';
import { childEnv, run } from '../scripts/test.mjs';
import { UNIT_TEST_TIMEOUT, shardArgs } from '../scripts/ci-test.mjs';

test('a CI unit shard runs with a per-test timeout that ends a stalled test well inside the job cap (Issue #1817)', () => {
  const unit = shardArgs({ id: 'unit-1', lane: 'unit', files: ['test/a.test.mjs'] });
  assert.ok(unit.includes(`--test-timeout=${UNIT_TEST_TIMEOUT}`), unit.join(' '));
  assert.ok(UNIT_TEST_TIMEOUT >= 60_000 && UNIT_TEST_TIMEOUT <= 5 * 60_000, `${UNIT_TEST_TIMEOUT} ms`);
  assert.deepEqual(unit.slice(-1), ['test/a.test.mjs']);
  const browser = shardArgs({ id: 'browser-1', lane: 'browser', files: ['test/b-browser.test.mjs'] });
  assert.ok(!browser.some((a) => a.startsWith('--test-timeout')), browser.join(' '));
});

test('a keychain store opened with no keychain inside a lane reaches the security on PATH, aimed at the lane sandbox keychain (Issue #1817)', () => {
  const dir = tempDir('weave-lane-keychain-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const log = join(dir, 'security.log');
  const mark = join(dir, 'keychain.txt');
  writeFileSync(join(bin, 'security'), '#!/bin/sh\nprintf \'argv %s\\n\' "$*" >> "$WEAVE_SECURITY_LOG"\ncat >> "$WEAVE_SECURITY_LOG"\n[ "$1" = find-generic-password ] && exit 44\nexit 0\n', { mode: 0o755 });
  const keystore = pathToFileURL(join(ROOT, 'src/keystore.js')).href;
  const file = join(dir, 'wrong-branch.test.mjs');
  writeFileSync(file, `import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
test('a wrong branch opens the keychain store with an empty env', async () => {
  const { openKeyStore } = await import(${JSON.stringify(keystore)});
  const sandbox = dirname(process.env.WEAVE_KEYSTORE);
  assert.match(process.env.NODE_OPTIONS ?? '', /usr%2Fbin%2Fsecurity/, 'the lane loads the keychain guard');
  const store = openKeyStore({ path: join(sandbox, 'wrong.json'), env: {}, kind: 'keychain' });
  assert.ok(store.keychain?.startsWith(sandbox), 'the store names the lane sandbox keychain: ' + store.keychain);
  writeFileSync(${JSON.stringify(mark)}, store.keychain);
  store.write({ keys: { stripe: { value: 'sk_test_lane_guard' } } });
});
`);
  const said = [];
  const code = run([file], [], { out: (l) => said.push(l), env: { ...childEnv(), PATH: `${bin}:${process.env.PATH}`, WEAVE_SECURITY_LOG: log } });
  assert.equal(code, 0, said.join('\n'));
  const keychain = readFileSync(mark, 'utf8');
  const calls = readFileSync(log, 'utf8');
  assert.match(calls, /^argv find-generic-password /m, calls);
  assert.match(calls, /^add-generic-password -U -s "weave:local:stripe" /m, calls);
  const named = calls.split('\n').filter((l) => /(find|add)-generic-password/.test(l));
  assert.ok(named.length >= 3, calls);
  for (const line of named) assert.ok(line.includes(keychain), `a security call left the sandbox keychain: ${line}`);
});
