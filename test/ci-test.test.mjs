import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, validate, digest, touchedBrowser, prPlan, SMOKE, ONBOARDING, newestAttempts, BUDGET, hunks, touchedLines, toMap } from '../scripts/ci-test.mjs';

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
    ['test/security/security-scan.test.mjs', 'gitleaks not installed'],
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

test('the full suite runs on main pushes only and always validates shards', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync('.github/workflows/test.yml', 'utf8');
  assert.doesNotMatch(workflow, /pull_request|merge_group/);
  assert.match(workflow, /name: CI gate\n    if: always\(\)\n    needs: \[plan, test\]/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /node scripts\/ci-test.mjs aggregate ci-results/);
  assert.match(workflow, /max-parallel: 6/);
  assert.match(workflow, /install --with-deps chromium webkit/);
});

const browserFiles = ['test/chip-browser.test.mjs', 'test/chip-width-browser.test.mjs', 'test/grid-keymap-browser.test.mjs', 'test/oidc-login-browser.test.mjs', ...SMOKE];
const sources = { 'test/oidc-login-browser.test.mjs': "import { startIdp } from './lib/idp.mjs'; const src = '../src/oidc.js';" };
const read = file => sources[file] ?? '';

test('a changed browser test runs itself beside the smoke set', () => {
  assert.deepEqual(touchedBrowser(['test/grid-keymap-browser.test.mjs'], browserFiles, read).files, [...SMOKE, 'test/grid-keymap-browser.test.mjs'].sort());
});

test('a changed module maps to browser tests named for it, its -core twin included', () => {
  assert.deepEqual(touchedBrowser(['public/grid-keymap.js'], browserFiles, read).files, [...SMOKE, 'test/grid-keymap-browser.test.mjs'].sort());
  assert.deepEqual(touchedBrowser(['public/chip-core.js'], browserFiles, read).files, [...SMOKE, 'test/chip-browser.test.mjs', 'test/chip-width-browser.test.mjs'].sort());
});

test('a changed file maps to browser tests whose source cites it', () => {
  assert.deepEqual(touchedBrowser(['src/oidc.js'], browserFiles, read).files, [...SMOKE, 'test/oidc-login-browser.test.mjs'].sort());
  assert.deepEqual(touchedBrowser(['test/lib/idp.mjs'], browserFiles, read).files, [...SMOKE, 'test/oidc-login-browser.test.mjs'].sort());
});

test('a diff nothing maps to falls back to the fixed smoke set, never an empty browser lane', () => {
  assert.deepEqual(touchedBrowser(['DEVELOPMENT.md', 'test/formula.test.mjs'], browserFiles, read).files, [...SMOKE].sort());
  assert.deepEqual(touchedBrowser([], browserFiles, read).files, [...SMOKE].sort());
  assert.ok(SMOKE.length > 0 && SMOKE.length <= 12);
  assert.ok(SMOKE.every(f => f.endsWith('-browser.test.mjs')));
});

test('the smoke set names browser tests that exist in this repository', async () => {
  const { testFiles, lanes } = await import('../scripts/test.mjs');
  const { browser } = lanes(testFiles());
  assert.deepEqual(SMOKE.filter(f => !browser.includes(f)), []);
});

test('the PR plan runs every unit file and the touched browser tests through the full-suite planner', () => {
  const unit = Array.from({ length: 30 }, (_, i) => `test/u${String(i).padStart(2, '0')}.test.mjs`);
  const many = Array.from({ length: 70 }, (_, i) => `test/b${String(i).padStart(2, '0')}-browser.test.mjs`);
  const browser = [...many, ...SMOKE];
  const small = prPlan({ unit, browser }, ['DEVELOPMENT.md'], read, () => 1);
  assert.deepEqual(small.filter(s => s.lane === 'unit').map(s => s.id), ['unit-1', 'unit-2', 'unit-3', 'unit-4']);
  assert.deepEqual(small.filter(s => s.lane === 'unit').flatMap(s => s.files).sort(), unit);
  assert.deepEqual(small.filter(s => s.lane === 'browser').map(s => s.id), ['browser-1']);
  assert.deepEqual(small.filter(s => s.lane === 'browser').flatMap(s => s.files).sort(), [...SMOKE].sort());
  const wide = prPlan({ unit, browser }, ['test/lib/browser.mjs'], () => "from './lib/browser.mjs'", () => 1);
  assert.equal(wide.filter(s => s.lane === 'browser').length, 4);
  assert.equal(wide.filter(s => s.lane === 'browser').flatMap(s => s.files).length, browser.length);
  const mid = prPlan({ unit, browser }, many.slice(0, 30), read, () => 1);
  assert.equal(mid.filter(s => s.lane === 'browser').length, 3);
});

test('pr.yml runs the fast tier on ready pull requests and one PR gate requires every shard', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync('.github/workflows/pr.yml', 'utf8');
  assert.match(workflow, /^on:\n  pull_request:\n    types: \[opened, synchronize, reopened, ready_for_review\]\n\n/m);
  assert.doesNotMatch(workflow, /^  push:|pull_request_target|secrets\./m);
  assert.match(workflow, /concurrency:\n  group: \$\{\{ github.workflow \}\}-\$\{\{ github.ref \}\}\n  cancel-in-progress: true/);
  assert.match(workflow, /if: \$\{\{ !github.event.pull_request.draft \}\}/);
  assert.match(workflow, /node scripts\/ci-test.mjs pr-plan/);
  assert.match(workflow, /node scripts\/ci-test.mjs pr-run "\$SHARD"/);
  assert.match(workflow, /name: PR gate\n    if: \$\{\{ always\(\) && !github.event.pull_request.draft \}\}\n    needs: \[plan, test\]/);
  assert.match(workflow, /node scripts\/ci-test.mjs pr-aggregate ci-results/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.match(workflow, /install --with-deps chromium webkit/);
  assert.match(workflow, /name: Install browsers and system dependencies\n        if: matrix.lane == 'browser'\n/);
});

test('a re-run shard replaces its earlier attempt, so the gate judges the newest result', () => {
  const failed = { ...evidence()[0], attempt: 1, code: 1 };
  const rerun = { ...evidence()[0], attempt: 2 };
  const results = [failed, rerun, ...evidence().slice(1).map(r => ({ ...r, attempt: 1 }))];
  assert.throws(() => validate(manifest, results, 'abc'), /duplicate/);
  assert.equal(validate(manifest, newestAttempts(results), 'abc').files, 4);
  assert.equal(validate(manifest, newestAttempts([rerun, failed, ...results.slice(2)]), 'abc').files, 4);
  assert.throws(() => validate(manifest, newestAttempts([{ ...failed, attempt: 3 }, rerun, ...results.slice(2)]), 'abc'), /Invalid shard/);
  assert.deepEqual(newestAttempts([{ id: 'unit-1' }, { id: 'unit-1', attempt: 2 }]), [{ id: 'unit-1', attempt: 2 }]);
});

test('pr.yml names each shard artifact by attempt so a re-run never overwrites the one it replaces', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync('.github/workflows/pr.yml', 'utf8');
  assert.match(workflow, /name: pr-\$\{\{ matrix.id \}\}-\$\{\{ github.run_attempt \}\}/);
});

test('the main tests gate judges each shard by its newest attempt, so Re-run failed jobs can turn CI gate green', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync('.github/workflows/test.yml', 'utf8');
  assert.match(workflow, /name: ci-\$\{\{ matrix.id \}\}-\$\{\{ github.run_attempt \}\}\n/);
  assert.match(workflow, /pattern: ci-\*\n/);
  const source = readFileSync('scripts/ci-test.mjs', 'utf8');
  assert.ok(source.includes('const summary = validate(manifest, newestAttempts(results), commit);'), 'aggregate keeps the newest attempt for main and PR runs alike');
  assert.doesNotMatch(source, /pr \? newestAttempts/);
  const failed = { ...evidence()[0], attempt: 1, code: 1 };
  const rerun = { ...evidence()[0], attempt: 2 };
  const passed = evidence().slice(1).map((r) => ({ ...r, attempt: 1 }));
  assert.throws(() => validate(manifest, newestAttempts([failed, ...passed]), 'abc'), /Invalid shard/);
  assert.equal(validate(manifest, newestAttempts([failed, ...passed, rerun]), 'abc').files, 4);
});

test('onboarding journeys are mandatory even for unrelated changes and cannot silently disappear', () => {
  const selected = touchedBrowser(['README.md'], browserFiles, read).files;
  for (const file of ONBOARDING) {
    assert.ok(selected.includes(file));
    assert.throws(() => touchedBrowser([], browserFiles.filter(f => f !== file), read), /Missing required journey suite/);
  }
  assert.equal(ONBOARDING.length, 4);
});

const covTests = Array.from({ length: 315 }, (_, i) => `test/t${String(i).padStart(3, '0')}-browser.test.mjs`);
const covLane = [...covTests, ...SMOKE];
const covBrowser = [...covLane, 'test/new-thing-browser.test.mjs'];
const covMap = {
  commit: 'a'.repeat(40),
  tests: [...covTests, ...SMOKE].sort(),
  sets: [],
  files: {},
};
const setOf = names => { covMap.sets.push(names.map(n => covMap.tests.indexOf(n)).sort((a, b) => a - b)); return covMap.sets.length - 1; };
covMap.files['public/app.js'] = [[1, 12000, setOf(covMap.tests)], [100, 140, setOf([covTests[1], covTests[2]])], [120, 130, setOf([covTests[3]])]];
covMap.files['src/routes.js'] = [[1, 900, setOf([covTests[10], covTests[11]])]];
const beyondSmoke = files => files.filter(f => !SMOKE.includes(f));

test('a change to a mapped server module selects the browser tests that executed it', () => {
  const { files } = touchedBrowser(['src/routes.js'], covLane, read, { map: covMap, lines: { 'src/routes.js': [50] } });
  assert.deepEqual(beyondSmoke(files), [covTests[10], covTests[11]]);
});

test('a hunk inside one app.js function selects the tests mapped to that function, innermost first, never all of them', () => {
  const outer = touchedBrowser(['public/app.js'], covLane, read, { map: covMap, lines: { 'public/app.js': [105] } }).files;
  assert.deepEqual(beyondSmoke(outer), [covTests[1], covTests[2]]);
  const inner = touchedBrowser(['public/app.js'], covLane, read, { map: covMap, lines: { 'public/app.js': [125] } }).files;
  assert.deepEqual(beyondSmoke(inner), [covTests[3]]);
  assert.ok(outer.length < covLane.length && inner.length < covLane.length);
});

test('a file the map does not know falls back to name matching', () => {
  const { files } = touchedBrowser(['public/new-thing.js'], covBrowser, read, { map: covMap, lines: {} });
  assert.deepEqual(beyondSmoke(files), ['test/new-thing-browser.test.mjs']);
});

test('a browser test the map does not know always runs, and a mapped test the lane no longer has never does', () => {
  const stale = { ...covMap, tests: [...covMap.tests, 'test/zz-removed-browser.test.mjs'] };
  const { files } = touchedBrowser(['README.md'], [...covBrowser, 'test/brand-new-browser.test.mjs'], read, { map: stale, lines: {} });
  assert.ok(files.includes('test/brand-new-browser.test.mjs'));
  assert.ok(files.includes('test/new-thing-browser.test.mjs'));
  assert.ok(!files.includes('test/zz-removed-browser.test.mjs'));
});

test('a change wider than the budget keeps the highest-ranked tests, names the rest as dropped and never runs zero', () => {
  const lines = { 'public/app.js': [5, 105, 125], 'src/routes.js': [50] };
  const first = touchedBrowser(['public/app.js', 'src/routes.js'], covBrowser, read, { map: covMap, lines });
  assert.equal(first.files.length, BUDGET);
  assert.equal(first.files.length + first.dropped.length, covBrowser.length);
  for (const top of [covTests[1], covTests[2], covTests[3], covTests[10], covTests[11]]) assert.ok(first.files.includes(top), top);
  assert.deepEqual(touchedBrowser(['src/routes.js', 'public/app.js'], [...covBrowser].reverse(), read, { map: covMap, lines }), first);
  const tiny = { commit: covMap.commit, tests: [covTests[3], ...SMOKE].sort(), sets: [], files: {} };
  tiny.sets.push([tiny.tests.indexOf(covTests[3])]);
  tiny.files['public/app.js'] = [[1, 10, 0]];
  const crowded = touchedBrowser(['public/app.js'], covBrowser, read, { map: tiny, lines: { 'public/app.js': [5] } });
  assert.ok(crowded.files.includes(covTests[3]));
  assert.ok(beyondSmoke(touchedBrowser(['public/app.js'], covBrowser, read, { map: covMap, lines: {} }).files).length > 0);
});

test('diff hunks become old-side lines, translated back to the commit the map was generated at', () => {
  const diff = [
    'diff --git a/public/app.js b/public/app.js', 'index 1..2 100644', '--- a/public/app.js', '+++ b/public/app.js',
    '@@ -10,3 +10,6 @@ function x() {', '--- not a header', '+a', '@@ -40,0 +44,2 @@', '+b',
    'diff --git a/src/gone.js b/src/gone.js', 'deleted file mode 100644', '--- a/src/gone.js', '+++ /dev/null', '@@ -1 +0,0 @@', '-x',
  ].join('\n');
  const h = hunks(diff);
  assert.deepEqual(h, { 'public/app.js': [[10, 3, 10, 6], [40, 0, 44, 2]], 'src/gone.js': [[1, 1, 0, 0]] });
  assert.deepEqual(touchedLines(h['public/app.js']), [10, 11, 12, 40, 41]);
  assert.equal(toMap(5, h['public/app.js']), 5);
  assert.equal(toMap(12, h['public/app.js']), 10);
  assert.equal(toMap(20, h['public/app.js']), 17);
  assert.equal(toMap(44, h['public/app.js']), 41);
  assert.equal(toMap(50, h['public/app.js']), 45);
  assert.equal(toMap(10, [[10, 3, 9, 0]]), 13);
  assert.equal(toMap(9, [[10, 3, 9, 0]]), 9);
});

test('the committed coverage map routes a src/routes.js change and an app.js function hunk to real browser tests', async () => {
  const { readFileSync } = await import('node:fs');
  const { testFiles, lanes } = await import('../scripts/test.mjs');
  const map = JSON.parse(readFileSync('test/coverage-map.json', 'utf8'));
  const { browser } = lanes(testFiles());
  assert.match(map.commit, /^[0-9a-f]{40}$/);
  assert.ok(map.tests.length > 200 && map.tests.every((t, i) => !i || map.tests[i - 1] < t));
  const routes = touchedBrowser(['src/routes.js'], browser, read, { map, lines: { 'src/routes.js': [map.files['src/routes.js'].at(-1)[0]] } });
  assert.ok(beyondSmoke(routes.files).length > 0);
  const app = map.files['public/app.js'];
  assert.ok(app.length > 100);
  const narrow = app.find(([s, e, set]) => e > s && map.sets[set].length < 40 && map.sets[set].length > 0);
  const picked = touchedBrowser(['public/app.js'], browser, read, { map, lines: { 'public/app.js': [narrow[0]] } });
  assert.ok(beyondSmoke(picked.files).length > 0);
  assert.ok(picked.files.length < browser.length / 2);
});

test('pr.yml checks out full history so the planner can diff against the commit the map was generated at', async () => {
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync('.github/workflows/pr.yml', 'utf8'), /fetch-depth: 0/);
});
