import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { selectTests, affectedTests } from '../scripts/test-selection.mjs';
import { lanes, testFiles } from '../scripts/test.mjs';
import { gating, prSelection, SMOKE } from '../scripts/ci-test.mjs';
import { tempDir } from './lib/temp.mjs';

const files = ['test/core.test.mjs', 'test/editor-browser.test.mjs', 'test/other.test.mjs'];
test('test-only changes select sorted unique existing tests', () => {
  const result = selectTests({ files, changed: [files[2], files[0], files[2]] });
  assert.equal(result.mode, 'targeted');
  assert.deepEqual(result.files, [files[0], files[2]]);
  assert.ok(result.reasons.length);
});
test('no changed files uses the full suite rather than an empty pass', () => {
  const result = selectTests({ files, changed: [] });
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.files, files);
  assert.ok(result.reasons.length);
});
test('a checkout the PR planner cannot read falls back to the full suite', () => {
  const result = selectTests({ files, changed: ['src/server.js'], read: () => '' });
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.files, files);
  assert.match(result.reasons.join(' '), /full suite required/);
});

const ROOT = join(import.meta.dirname, '..');
const real = testFiles(ROOT);
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const groups = gating(lanes(real, ROOT));
for (const changed of [['scripts/test-selection.mjs'], ['src/field-hints.js'], ['package.json'], ['README.md'], ['test/deleted.test.mjs'], ['unknown'], ['test/test-selection.test.mjs', 'src/server.js']]) {
  test(`a non-test change runs what the PR gate would, not the full suite (Issue #1641): ${JSON.stringify(changed)}`, () => {
    const result = selectTests({ files: real, changed, read });
    assert.equal(result.mode, 'pr');
    const pick = prSelection(groups, changed, read);
    assert.deepEqual(result.files, [...pick.unit, ...pick.browser].sort());
    for (const file of groups.unit) assert.ok(result.files.includes(file), `${file}: every unit file runs, as on the PR gate`);
    for (const file of SMOKE) assert.ok(result.files.includes(file), `${file}: the smoke journeys run`);
    assert.ok(result.files.length < real.length, `${result.files.length} of ${real.length}: the browser lane is narrowed`);
    assert.match(result.reasons.join(' '), /PR gate selection: \d+ unit and \d+ of \d+ browser suites/);
  });
}
for (const changed of [['src/routes.js'], ['public/app.js'], ['public/style.css'], ['test/lib/browser.mjs']]) {
  test(`a shared-code change runs every gating browser suite, as the PR gate does: ${JSON.stringify(changed)}`, () => {
    const result = selectTests({ files: real, changed, read });
    assert.equal(result.mode, 'pr');
    for (const file of [...groups.unit, ...groups.browser]) assert.ok(result.files.includes(file), file);
  });
}
test('empty discovered test list fails closed', () => {
  assert.throws(() => selectTests({ files: [], changed: [] }), /No test files/);
});
test('git discovery includes staged, unstaged and untracked files, recursively', t => {
  const root = tempDir('weave-select-');
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

test('a suite that only names the browser harness stays in the unit lane', () => {
  const { unit, browser } = lanes(['test/test-selection.test.mjs', 'test/nav.test.mjs', 'test/security/security-headers.test.mjs']);
  assert.deepEqual(unit, ['test/test-selection.test.mjs']);
  assert.deepEqual(browser, ['test/nav.test.mjs', 'test/security/security-headers.test.mjs']);
});
