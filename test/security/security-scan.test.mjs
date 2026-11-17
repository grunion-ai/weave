import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fingerprint, newFindings, settle, semgrepVerdict, SEMGREP_ARGS, CUT_SHORT, summarize, onPath, steps, gitleaksArgs, ROOT } from '../../scripts/security-scan.mjs';
import { tempDir } from '../lib/temp.mjs';

const result = (rule, path, start, end = start) => ({ check_id: `security.semgrep.${rule}`, path, start: { line: start }, end: { line: end } });

test('a fingerprint ignores the line number and indentation but not the code', () => {
  const src = 'a\n    el.innerHTML = x;\nb';
  const moved = '\n\na\n  el.innerHTML   =  x;\nb';
  assert.equal(fingerprint(result('r', 'f.js', 2), src), fingerprint(result('r', 'f.js', 4), moved));
  assert.notEqual(fingerprint(result('r', 'f.js', 2), src), fingerprint(result('r', 'f.js', 2), src.replace('x', 'y')));
  assert.equal(fingerprint(result('r', 'f.js', 1, 2), 'one\n two\nthree'), 'r|f.js|one two');
});

test('the baseline hides every fingerprint it lists, however often a run reports it, and shows any it does not list (Issue #1302)', () => {
  assert.deepEqual(newFindings(['a', 'b'], ['a', 'b', 'c']), []);
  assert.deepEqual(newFindings(['a', 'd'], ['a']), ['d']);
  assert.deepEqual(newFindings(['a', 'a'], ['a']), [], 'a taint rule that reports one listed line twice on one run and once on the next is one tree, one result');
  assert.deepEqual(newFindings(['d', 'd'], ['a']), ['d']);
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
  const r = spawnSync('semgrep', ['--test', '--metrics=off', 'security/semgrep'], { encoding: 'utf8', cwd: join(import.meta.dirname, '../..'), timeout: 300_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('gitleaks reads the checked-out history only, never every fetched branch (Issue #913)', () => {
  assert.ok(gitleaksArgs().includes('--log-opts=HEAD'));
});

test('a leak on another branch does not fail the scan of a clean checkout (Issue #913)', { skip: !onPath('gitleaks') && 'gitleaks not installed' }, () => {
  const dir = tempDir('scanref-');
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', timeout: 120_000 });
  const scan = () => spawnSync('gitleaks', gitleaksArgs(join(ROOT, 'security/gitleaks.toml')), { cwd: dir, encoding: 'utf8', timeout: 120_000 });
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

const passes = (...sets) => { const queue = sets.map((x) => ({ fps: new Set(x), broken: [] })); return () => queue.shift(); };

test('a new fingerprint a run reports twice is listed once (Issue #1794)', () => {
  assert.deepEqual(newFindings(['a', 'new', 'new'], ['a']), ['new']);
});

test('semgrep runs on one job, where eight runs of one tree agreed and nine jobs gave 22, 16 and 21 results (Issue #1789)', () => {
  const at = SEMGREP_ARGS.indexOf('-j');
  assert.ok(at >= 0);
  assert.equal(SEMGREP_ARGS[at + 1], '1');
});

test('the scan repeats until two passes in a row agree, and keeps every result any pass saw (Issue #1789)', () => {
  const agreed = settle(passes(['a', 'b'], ['a', 'b']));
  assert.deepEqual([[...agreed.fps].sort(), agreed.passes, agreed.stable], [['a', 'b'], 2, true]);
  const short = settle(passes(['a'], ['a', 'b'], ['a', 'b']));
  assert.deepEqual([[...short.fps].sort(), short.passes, short.stable], [['a', 'b'], 3, true]);
  const once = settle(passes(['a', 'new'], ['a'], ['a']));
  assert.ok(once.fps.has('new'), 'a result one pass saw and the next two missed still counts');
  const never = settle(passes(['a'], ['b'], ['a'], ['b']));
  assert.deepEqual([never.passes, never.stable], [4, false]);
});

test('a pass with a semgrep error carries it to the verdict', () => {
  const queue = [{ fps: new Set(['a']), broken: [{ type: 'Timeout', message: 'rule timed out' }] }, { fps: new Set(['a']), broken: [] }];
  assert.equal(settle(() => queue.shift()).broken.length, 1);
});

test('the verdict is green only for a settled, error-free scan that reports exactly the baseline (Issues #1789, #1794)', () => {
  const ok = { fps: new Set(['a', 'b']), passes: 2, stable: true, broken: [] };
  assert.equal(semgrepVerdict(ok, ['a', 'b']).status, 'pass');
  const fresh = semgrepVerdict({ ...ok, fps: new Set(['a', 'b', 'new']) }, ['a', 'b']);
  assert.equal(fresh.status, 'fail');
  assert.match(fresh.detail, /1 new result:\n {2}new/);
  const missing = semgrepVerdict({ ...ok, fps: new Set(['a']) }, ['a', 'b']);
  assert.equal(missing.status, 'fail');
  assert.match(missing.detail, /1 baseline result not reported.*--update-baseline[\s\S]*\n {2}b/);
  const unstable = semgrepVerdict({ ...ok, stable: false, passes: 4 }, ['a', 'b']);
  assert.equal(unstable.status, 'fail');
  assert.match(unstable.detail, /4 passes never agreed/);
  const broken = semgrepVerdict({ ...ok, broken: [{ type: 'Timeout', message: 'rule timed out' }] }, ['a', 'b']);
  assert.equal(broken.status, 'fail');
  assert.match(broken.detail, /Timeout/);
});

test('a file whose taint analysis ran out of time fails the scan unless it is listed, and a listed one is named in the pass line (Issue #1789)', () => {
  const scan = settle(passes(['a|src/routes.js|x', 'b|src/mcp.js|y'], ['a|src/routes.js|x', 'b|src/mcp.js|y']));
  assert.equal(scan.cut.size, 0);
  const queue = [{ fps: new Set(['a|src/routes.js|x']), broken: [], cut: ['src/routes.js'] }, { fps: new Set(['a|src/routes.js|x']), broken: [], cut: [] }];
  const cut = settle(() => queue.shift());
  assert.deepEqual([...cut.cut], ['src/routes.js'], 'one pass that ran out of time marks the file');
  const unlisted = semgrepVerdict(cut, ['a|src/routes.js|x'], []);
  assert.equal(unlisted.status, 'fail');
  assert.match(unlisted.detail, /ran out of time in src\/routes\.js/);
  const listed = semgrepVerdict(cut, ['a|src/routes.js|x'], ['src/routes.js']);
  assert.equal(listed.status, 'pass');
  assert.match(listed.detail, /src\/routes\.js analysed to its time limit, guarded by 1 baseline result there/);
});

test('the scan asks semgrep for its timing block, the only place it reports a taint analysis it cut short (Issue #1789)', () => {
  assert.ok(SEMGREP_ARGS.includes('--time'));
});

test('no file is excused for a taint analysis that ran out of time: the request handler is split so semgrep finishes it', () => {
  assert.deepEqual(JSON.parse(readFileSync(CUT_SHORT, 'utf8')), []);
});
