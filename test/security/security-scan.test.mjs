import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fingerprint, newFindings, summarize, onPath, steps, gitleaksArgs, ROOT } from '../../scripts/security-scan.mjs';
import { tempDir } from '../lib/temp.mjs';

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
  const dir = tempDir('scanpath-');
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

test('gitleaks reads the checked-out history only, never every fetched branch (Issue #913)', () => {
  assert.ok(gitleaksArgs().includes('--log-opts=HEAD'));
});

test('a leak on another branch does not fail the scan of a clean checkout (Issue #913)', { skip: !onPath('gitleaks') && 'gitleaks not installed' }, () => {
  const dir = tempDir('scanref-');
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
  const scan = () => spawnSync('gitleaks', gitleaksArgs(join(ROOT, 'security/gitleaks.toml')), { cwd: dir, encoding: 'utf8' });
  try {
    git('init', '-q', '-b', 'main');
    writeFileSync(join(dir, 'clean.js'), 'export const ok = 1;\n');
    git('add', '.'); git('commit', '-q', '-m', 'clean');
    git('checkout', '-q', '-b', 'other');
    const value = ['k3J9', 'qP2x', 'Lm8v', 'Tz4w', 'Rb7n', 'Yc1s', 'Hd6f', 'Wg0e'].join('');
    writeFileSync(join(dir, 'config.js'), `const api_key = "${value}";\n`);
    git('add', '.'); git('commit', '-q', '-m', 'leak');
    assert.notEqual(scan().status, 0, 'the fixture must be a finding when its branch is checked out');
    git('checkout', '-q', 'main');
    const r = scan();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
