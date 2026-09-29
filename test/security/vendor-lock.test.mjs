import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLock, diffLock, sha256 } from '../../scripts/vendor-lock.mjs';
import { queryable, buildQueries, toRows } from '../../scripts/vendor-advisories.mjs';

test('every vendored file matches security/vendor.lock.json, and none is unlisted or missing', () => {
  const { missing, changed, unlisted } = diffLock(readLock());
  assert.deepEqual(changed, [], 'hash differs from the lock: a vendored file changed. If deliberate, node scripts/vendor-lock.mjs --update');
  assert.deepEqual(unlisted, [], 'file under a vendor directory that the lock does not list: add it to security/vendor.lock.json');
  assert.deepEqual(missing, [], 'the lock lists a file that is gone');
});

test('the confirmed versions are pinned, and DOMPurify is its own entry inside mermaid', () => {
  const by = Object.fromEntries(readLock().libraries.map((l) => [l.name, l]));
  assert.equal(by.mermaid.version, '11.17.0');
  assert.equal(by.dompurify.version, '3.4.12');
  assert.equal(by.dompurify.bundledIn, 'mermaid');
  assert.equal(by.vditor.version, '3.11.3');
  assert.equal(by.katex.version, '0.16.47');
  assert.equal(by['highlight.js'].version, '11.7.0');
  assert.equal(by.tabler.npm, '@tabler/core');
  assert.equal(by.tabler.version, '1.4.0');
});

test('diffLock names a changed, an unlisted and a missing file', () => {
  const root = mkdtempSync(join(tmpdir(), 'vlock-'));
  try {
    mkdirSync(join(root, 'public/vendor'), { recursive: true });
    writeFileSync(join(root, 'public/vendor/a.js'), 'one');
    writeFileSync(join(root, 'public/vendor/extra.js'), 'x');
    const lock = { libraries: [{ files: [
      { path: 'public/vendor/a.js', sha256: sha256(join(root, 'public/vendor/a.js')) },
      { path: 'public/vendor/gone.js', sha256: '0'.repeat(64) },
    ] }] };
    assert.deepEqual(diffLock(lock, root), { missing: ['public/vendor/gone.js'], changed: [], unlisted: ['public/vendor/extra.js'] });
    writeFileSync(join(root, 'public/vendor/a.js'), 'two');
    assert.deepEqual(diffLock(lock, root).changed, ['public/vendor/a.js']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('advisory queries cover npm libraries with a version and map results by position', () => {
  const lock = { libraries: [
    { name: 'a', npm: 'a', version: '1.0.0', files: [] },
    { name: 'b', npm: null, version: '2', files: [] },
    { name: 'c', npm: 'c', version: null, files: [] },
    { name: 'd', npm: '@s/d', version: '3.1.0', files: [] },
  ] };
  const libs = queryable(lock);
  assert.deepEqual(buildQueries(libs), [
    { package: { name: 'a', ecosystem: 'npm' }, version: '1.0.0' },
    { package: { name: '@s/d', ecosystem: 'npm' }, version: '3.1.0' },
  ]);
  assert.deepEqual(toRows(libs, [{}, { vulns: [{ id: 'GHSA-x' }] }]).map((r) => r.ids), [[], ['GHSA-x']]);
});
