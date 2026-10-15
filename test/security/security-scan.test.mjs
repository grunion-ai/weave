import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fingerprint, newFindings, summarize, onPath, steps, ROOT, GITLEAKS_ARGS } from '../../scripts/security-scan.mjs';

const result = (rule, path, start, end = start) => ({ check_id: `security.semgrep.${rule}`, path, start: { line: start }, end: { line: end } });

test('a fingerprint ignores the line number and indentation but not the code', () => {
  const src = 'a\n    el.innerHTML = x;\nb';
  const moved = '\n\na\n  el.innerHTML   =  x;\nb';
  assert.equal(fingerprint(result('r', 'f.js', 2), src), fingerprint(result('r', 'f.js', 4), moved));
  assert.notEqual(fingerprint(result('r', 'f.js', 2), src), fingerprint(result('r', 'f.js', 2), src.replace('x', 'y')));
  assert.equal(fingerprint(result('r', 'f.js', 1, 2), 'one\n two\nthree'), 'r|f.js|one two');
});

test('the baseline hides what it holds and shows anything beyond it, duplicates included', () => {
  assert.deepEqual(newFindings(['a', 'b'], ['a', 'b', 'c']), []);
  assert.deepEqual(newFindings(['a', 'd'], ['a']), ['d']);
  assert.deepEqual(newFindings(['a', 'a'], ['a']), ['a']);
});

test('the summary has one line per tool and the exit code follows the fails', () => {
  const s = summarize([
    { name: 'gitleaks', status: 'pass' },
    { name: 'semgrep', status: 'fail', detail: '1 new result' },
    { name: 'hadolint', status: 'skipped', detail: 'hadolint not on PATH' },
  ]);
  assert.deepEqual(s.lines, ['gitleaks: pass', 'semgrep: fail (1 new result)', 'hadolint: skipped (hadolint not on PATH)']);
  assert.equal(s.code, 1);
  assert.equal(summarize([{ name: 'a', status: 'pass' }, { name: 'b', status: 'skipped' }]).code, 0);
  assert.equal(summarize([{ name: 'b', status: 'skipped' }], { requireAll: true }).code, 1);
  assert.match(summarize([{ name: 'b', status: 'skipped' }], { requireAll: true }).lines[0], /^b: fail/);
});

test('a tool is found by its PATH entry, not assumed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scanpath-'));
  try {
    writeFileSync(join(dir, 'faketool'), '#!/bin/sh\n');
    chmodSync(join(dir, 'faketool'), 0o755);
    assert.equal(onPath('faketool', dir), true);
    assert.equal(onPath('nothere', dir), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('with an empty PATH every external tool is skipped and only the failing checks count', () => {
  const skipped = steps().slice(0, 5).map((step) => {
    const old = process.env.PATH;
    process.env.PATH = '';
    try { return step(); } finally { process.env.PATH = old; }
  });
  assert.deepEqual(skipped.map((r) => r.status), ['skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
  assert.deepEqual(skipped.map((r) => r.name), ['gitleaks', 'semgrep', 'zizmor', 'actionlint', 'hadolint']);
});

test('the semgrep rules fire on their fixtures and stay quiet on the ok lines', { skip: !onPath('semgrep') && 'semgrep not installed' }, () => {
  const r = spawnSync('semgrep', ['--test', '--metrics=off', 'security/semgrep'], { encoding: 'utf8', cwd: join(import.meta.dirname, '../..') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('gitleaks judges the history HEAD would land, not every fetched branch (Issue #913)', () => {
  assert.ok(GITLEAKS_ARGS.includes('--log-opts=HEAD'), 'the scan walks HEAD only');
  assert.equal(GITLEAKS_ARGS.at(-1), '.', 'and still reads the checkout');
});

test('a leak on another branch passes the scan; the same leak on HEAD fails it (Issue #913)', { skip: !onPath('gitleaks') && 'gitleaks not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'leakref-'));
  const git = (...a) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' });
  const scan = (args) => spawnSync('gitleaks', args.map((a) => (a === 'security/gitleaks.toml' ? join(ROOT, a) : a)), { cwd: dir, encoding: 'utf8' }).status;
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'ok.txt'), 'nothing here\n');
    git('add', '.'); git('commit', '-q', '-m', 'clean');
    git('checkout', '-q', '-b', 'side');
    writeFileSync(join(dir, 'leak.js'), `const token = "${'glpat-' + 'Zx8Rq2LmT9vKp4WdN7sJ'}";\n`);
    git('add', '.'); git('commit', '-q', '-m', 'leak');
    git('checkout', '-q', 'main');
    assert.notEqual(scan(GITLEAKS_ARGS.filter((a) => a !== '--log-opts=HEAD').concat('--log-opts=--all')), 0, 'the fixture is a leak gitleaks finds');
    assert.equal(scan(GITLEAKS_ARGS), 0, 'a leak on another branch does not fail this checkout');
    git('merge', '-q', '--ff-only', 'side');
    assert.notEqual(scan(GITLEAKS_ARGS), 0, 'the leak fails the scan once HEAD carries it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
