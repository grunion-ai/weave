import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { selectTests, affectedTests } from '../scripts/test-selection.mjs';
import { lanes } from '../scripts/test.mjs';

const files = ['test/core.test.mjs', 'test/editor-browser.test.mjs', 'test/other.test.mjs'];
test('test-only changes select sorted unique existing tests', () => {
  const result = selectTests({ files, changed: [files[2], files[0], files[2]] });
  assert.equal(result.mode, 'targeted');
  assert.deepEqual(result.files, [files[0], files[2]]);
  assert.ok(result.reasons.length);
});
for (const changed of [[], ['public/app.js'], ['public/style.css'], ['src/engine.js'], ['package.json'], ['README.md'], ['test/lib/browser.mjs'], ['test/deleted.test.mjs'], ['unknown'], ['test/core.test.mjs', 'src/server.js']]) {
  test(`uncertain blast radius uses full suite: ${JSON.stringify(changed)}`, () => {
    const result = selectTests({ files, changed });
    assert.equal(result.mode, 'full');
    assert.deepEqual(result.files, files);
    assert.ok(result.reasons.length);
  });
}
test('empty discovered test list fails closed', () => {
  assert.throws(() => selectTests({ files: [], changed: [] }), /No test files/);
});
test('git discovery includes staged, unstaged and untracked files, recursively', t => {
  const root = mkdtempSync(join(tmpdir(), 'weave-select-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  mkdirSync(join(root, 'test/nested'), { recursive: true });
  writeFileSync(join(root, 'test/a.test.mjs'), 'before');
  writeFileSync(join(root, 'test/b.test.mjs'), 'before');
  git('init'); git('add', 'test');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  writeFileSync(join(root, 'test/a.test.mjs'), 'staged'); git('add', 'test/a.test.mjs');
  writeFileSync(join(root, 'test/b.test.mjs'), 'unstaged');
  writeFileSync(join(root, 'test/nested/new file.test.mjs'), 'untracked');
  assert.deepEqual(affectedTests(root).files, ['test/a.test.mjs', 'test/b.test.mjs', 'test/nested/new file.test.mjs']);
  assert.equal(affectedTests(root).mode, 'targeted');
  writeFileSync(join(root, 'unknown.txt'), 'unmapped');
  assert.equal(affectedTests(root).mode, 'full');
  assert.throws(() => affectedTests(root, 'nonexistent-ref'));
});

/* This file names 'test/lib/browser.mjs' in its data above, and the runner
   once read that as driving a browser and ran it at half concurrency. Only
   an import counts, static or awaited (Issue #648). */
test('a suite that only names the browser harness stays in the unit lane', () => {
  const { unit, browser } = lanes(['test/test-selection.test.mjs', 'test/nav.test.mjs', 'test/security/security-headers.test.mjs']);
  assert.deepEqual(unit, ['test/test-selection.test.mjs']);
  assert.deepEqual(browser, ['test/nav.test.mjs', 'test/security/security-headers.test.mjs']);
});
