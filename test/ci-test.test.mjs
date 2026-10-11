import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, validate, digest } from '../scripts/ci-test.mjs';

const files = ['test/a.test.mjs', 'test/b.test.mjs', 'test/c-browser.test.mjs', 'test/d-browser.test.mjs'];
const manifest = plan(files, { unit: files.slice(0, 2), browser: files.slice(2) }, () => 10, 2, 2);
const evidence = () => manifest.map(shard => ({ ...shard, commit: 'abc', manifest: digest(manifest), code: 0, durationMs: 10, summaries: shard.files.map(file => ({ file, success: true, counts: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0 }, duration_ms: 1 })), skips: [] }));

test('shards cover every file exactly once and balance deterministic weights', () => {
  assert.deepEqual(manifest.flatMap(s => s.files).sort(), files);
  assert.equal(new Set(manifest.map(s => s.id)).size, 4);
  assert.deepEqual(plan([...files].reverse(), { unit: files.slice(0, 2), browser: files.slice(2) }, () => 10, 2, 2), manifest);
  assert.throws(() => plan([], { unit: [], browser: [] }, () => 1), /empty/i);
  assert.throws(() => plan(files, { unit: files, browser: files.slice(2) }, () => 1), /coverage/i);
});

test('aggregation requires exact commit, manifest, every shard and executed file evidence', () => {
  assert.equal(validate(manifest, evidence(), 'abc').files, 4);
  for (const mutate of [
    r => r.pop(),
    r => r.push(r[0]),
    r => { r[0].commit = 'other'; },
    r => { r[0].manifest = 'other'; },
    r => { r[0].code = 1; },
    r => { r[0].summaries = []; },
    r => { r[0].summaries[0].counts.tests = 0; },
    r => { r[0].summaries[0].success = false; },
    r => { r[0].files = []; },
    r => { r[0].skips = [{ file: r[0].files[0], reason: 'playwright not installed' }]; },
  ]) {
    const results = evidence(); mutate(results);
    assert.throws(() => validate(manifest, results, 'abc'));
  }
});

test('only exact security and overlay-scrollbar capability skips are allowed', () => {
  for (const [file, reason] of [
    ['test/security/security-scan.test.mjs', 'semgrep not installed'],
    ['test/ws-rail-inset-browser.test.mjs', 'overlay scrollbars here: no gutter to measure ({})'],
  ]) {
    const manifest = [{ id: 'unit-1', lane: 'unit', files: [file] }];
    const results = [{ id: 'unit-1', files: [file], commit: 'abc', manifest: digest(manifest), code: 0, summaries: [{ file, success: true, counts: { tests: 1 } }], skips: [{ file, reason }] }];
    assert.equal(validate(manifest, results, 'abc').files, 1);
    results[0].skips[0].reason = 'webkit cannot launch here';
    assert.throws(() => validate(manifest, results, 'abc'), /Skipped coverage/);
    results[0].skips[0] = { file: 'test/other.test.mjs', reason };
    assert.throws(() => validate(manifest, results, 'abc'), /Skipped coverage/);
  }
});

test('CI reporter records executed files, timings and missing prerequisite skips', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'weave-ci-test-'));
  try {
    const fixture = join(dir, 'example.test.mjs'), report = join(dir, 'events.jsonl');
    writeFileSync(fixture, "import test from 'node:test'; test('executed', () => {}); test('missing', {skip: 'playwright not installed'}, () => {});");
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const child = spawnSync(process.execPath, ['--test', `--test-reporter=${resolve('scripts/ci-test-reporter.mjs')}`, fixture], { env: { ...env, WEAVE_CI_REPORT: report }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const events = readFileSync(report, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.filter(e => e.type === 'summary').length, 1);
    assert.equal(events.find(e => e.type === 'summary').data.counts.tests, 2);
    assert.ok(events.find(e => e.type === 'summary').data.duration_ms >= 0);
    assert.deepEqual(events.filter(e => e.type === 'skip').map(e => e.data.reason), ['playwright not installed']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the required gate uses merge commits and always validates shards; draft reviews stay unmergeable', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync('.github/workflows/test.yml', 'utf8');
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/);
  assert.match(workflow, /if: github.event_name != 'pull_request' \|\| !github.event.pull_request.draft/);
  assert.match(workflow, /name: CI gate\n    if: always\(\)\n    needs: \[plan, test\]/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /node scripts\/ci-test.mjs aggregate ci-results/);
  assert.match(workflow, /max-parallel: 6/);
  assert.match(workflow, /install --with-deps chromium webkit/);
});
