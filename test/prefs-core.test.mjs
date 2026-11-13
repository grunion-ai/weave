import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

await import('../public/prefs-core.js');
const { of, read, write, drop, list } = globalThis.WeavePrefs;

const fake = (items = {}) => {
  const map = new Map(Object.entries(items));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};
const hostile = (which) => {
  const s = fake();
  for (const name of which) s[name] = () => { throw new DOMException('denied', 'SecurityError'); };
  return s;
};

test('prefs: a saved list of names reads back as it was written (Issue #1448)', () => {
  const s = fake({ 'weave-folded-spaces': '["s1","s2"]' });
  assert.deepEqual(list('weave-folded-spaces', s), ['s1', 's2']);
  assert.equal(write('weave-folded-spaces', '["s3"]', s), true);
  assert.deepEqual(list('weave-folded-spaces', s), ['s3']);
  assert.deepEqual(list('weave-never-written', s), [], 'an absent key reads as the empty default');
  assert.equal(s.map.has('weave-never-written'), false, 'an absent key is not written back');
});

test('prefs: malformed JSON reads as the default and resets only that key (Issue #1448)', () => {
  const s = fake({ 'weave-folded-spaces': '{broken', 'weave-theme': 'dark' });
  assert.deepEqual(list('weave-folded-spaces', s), []);
  assert.equal(s.map.has('weave-folded-spaces'), false, 'the bad key is reset');
  assert.equal(read('weave-theme', s), 'dark', 'no unrelated key is cleared');
});

test('prefs: a value that parses but has the wrong shape is still refused (Issue #1448)', () => {
  for (const raw of ['null', '3', '"a"', '{"a":1}', '[1,"b"]', '[null]', 'true']) {
    const s = fake({ k: raw });
    assert.deepEqual(list('k', s), [], raw);
    assert.equal(s.map.has('k'), false, `${raw} is reset`);
  }
});

test('prefs: denied reads and failed writes answer the default instead of throwing (Issue #1448)', () => {
  const noRead = hostile(['getItem']);
  assert.equal(read('weave-theme', noRead), null);
  assert.deepEqual(list('weave-folded-spaces', noRead), []);
  const noWrite = hostile(['setItem', 'removeItem']);
  assert.equal(write('weave-theme', 'dark', noWrite), false);
  assert.equal(drop('weave-theme', noWrite), false);
  assert.deepEqual(list('weave-folded-spaces', fake({ 'weave-folded-spaces': '{broken' })), []);
});

test('prefs: storage the browser refuses to hand over is acquired safely (Issue #1448, pattern from #956)', () => {
  const core = readFileSync(new URL('../public/prefs-core.js', import.meta.url), 'utf8');
  const browser = {};
  runInNewContext(`Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); } });\n${core}`, browser);
  const prefs = browser.WeavePrefs;
  assert.equal(prefs.of(), null, 'the property is read inside the guard, never before it');
  assert.equal(prefs.read('weave-theme'), null);
  assert.equal(prefs.list('weave-folded-spaces').length, 0);
  assert.equal(prefs.write('weave-theme', 'dark'), false);
  assert.equal(prefs.drop('weave-theme'), false);
});

test('prefs: a window with no storage at all is the same as a denied one (Issue #1448)', () => {
  assert.equal(of({ getItem: () => null }) !== null, true, 'a storage passed in is used as given');
  const browser = {};
  runInNewContext(readFileSync(new URL('../public/prefs-core.js', import.meta.url), 'utf8'), browser);
  assert.equal(browser.WeavePrefs.of(), null);
  assert.equal(browser.WeavePrefs.list('weave-folded-spaces').length, 0);
});

test('prefs: the app reads its preferences through the adapter, never straight from storage (Issue #1448)', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const bare = app.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /\blocalStorage\b/.test(line))
    .filter(([, line]) => !/WeaveDocDraft\./.test(line))
    .filter(([, line]) => !/\btry \{/.test(line));
  assert.deepEqual(bare, [], `every other preference goes through WeavePrefs: ${JSON.stringify(bare)}`);
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(index.indexOf('/prefs-core.js') < index.indexOf('/app.js'), 'the adapter loads before the app that boots on it');
});
