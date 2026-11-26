import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, validate, digest, touchedBrowser, unitReach, prPlan, eagerAssets, planNotice, reachTokens, reachNamed, SMOKE, ONBOARDING, REACH_CAP, REACH_SPREAD, newestAttempts, durationsFrom, weightWith, TREND, gating, currentPlan, QUARANTINE, shardCode, aggregate } from '../scripts/ci-test.mjs';
import { testFiles, lanes } from '../scripts/test.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tempDir } from './lib/temp.mjs';

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
  const dir = tempDir('weave-ci-test-');
  try {
    const fixture = join(dir, 'example.test.mjs'), report = join(dir, 'events.jsonl');
    writeFileSync(fixture, "import test from 'node:test'; test('executed', () => {}); test('missing', {skip: 'playwright not installed'}, () => {});");
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const child = spawnSync(process.execPath, ['--test', `--test-reporter=${resolve('scripts/ci-test-reporter.mjs')}`, fixture], { env: { ...env, WEAVE_CI_REPORT: report }, encoding: 'utf8', timeout: 120_000 });
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
  assert.match(workflow, /max-parallel: 10/);
  assert.match(workflow, /image: \$\{\{ matrix\.lane == 'browser' && 'mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}' \|\| '' \}\}\n/);
});

const RESULT = (id, lane, durations) => ({
  id, lane, attempt: 1, code: 0,
  files: Object.keys(durations).sort(),
  summaries: Object.entries(durations).map(([file, duration_ms]) => ({ file, duration_ms, success: true, counts: { tests: 1, failed: 0, cancelled: 0 } })),
  skips: [],
});

test('a shard result yields the duration of every file it ran (Issue #966)', () => {
  const durations = durationsFrom([
    RESULT('browser-1', 'browser', { 'test/vitals-budget-browser.test.mjs': 85000, 'test/chip-browser.test.mjs': 4000 }),
    RESULT('browser-2', 'browser', { 'test/render-budget-browser.test.mjs': 164000 }),
  ]);
  assert.equal(durations.get('test/vitals-budget-browser.test.mjs'), 85000);
  assert.equal(durations.get('test/render-budget-browser.test.mjs'), 164000);
  assert.equal(durations.size, 3);
});

test('two readings of one file give its median, and a broken result is ignored (Issue #966)', () => {
  const durations = durationsFrom([
    RESULT('browser-1', 'browser', { 'test/flicker-gate-browser.test.mjs': 60000 }),
    RESULT('browser-1', 'browser', { 'test/flicker-gate-browser.test.mjs': 100000 }),
    { id: 'browser-2', lane: 'browser' },
    null,
  ]);
  assert.equal(durations.get('test/flicker-gate-browser.test.mjs'), 80000);
  assert.equal(durations.size, 1);
});

test('a recorded duration outranks byte size, and a file with no history keeps its size (Issue #966)', () => {
  const sizes = { 'test/vitals-budget-browser.test.mjs': 1903, 'test/grid-keymap-browser.test.mjs': 14731 };
  const weight = weightWith(new Map([['test/vitals-budget-browser.test.mjs', 35097]]), (file) => sizes[file]);
  assert.equal(weight('test/vitals-budget-browser.test.mjs'), 35097, 'the 1,903-byte file that loops its page loads weighs what it cost in run 41959983156');
  assert.equal(weight('test/grid-keymap-browser.test.mjs'), 14731, 'a file the history does not name falls back to its byte size');
});

const REAL = {
  'test/setup-flows-browser.test.mjs': { bytes: 52749, ms: 119137 },
  'test/table-views-browser.test.mjs': { bytes: 23625, ms: 29604 },
  'test/feedback-budget-browser.test.mjs': { bytes: 3131, ms: 321949 },
  'test/render-budget-browser.test.mjs': { bytes: 1682, ms: 163971 },
};

test('measured durations split the two slowest browser files, which are also the two smallest (Issue #966)', () => {
  const browser = Object.keys(REAL).sort();
  const groups = { unit: [], browser };
  const bytes = (file) => REAL[file].bytes;
  const measured = new Map(Object.entries(REAL).map(([file, { ms }]) => [file, ms]));
  const shardOf = (shards, file) => shards.find((shard) => shard.files.includes(file)).id;
  const path = (shards) => Math.max(...shards.map((shard) => shard.files.reduce((n, f) => n + REAL[f].ms, 0)));

  const byBytes = plan(browser, groups, bytes, 1, 2);
  assert.equal(shardOf(byBytes, 'test/feedback-budget-browser.test.mjs'), shardOf(byBytes, 'test/render-budget-browser.test.mjs'),
    'byte size lands the 322 s and the 164 s file in one shard, because at 3,131 and 1,682 bytes they are the two smallest');
  assert.equal(path(byBytes), 515524);

  const byDuration = plan(browser, groups, weightWith(measured, bytes), 1, 2);
  assert.notEqual(shardOf(byDuration, 'test/feedback-budget-browser.test.mjs'), shardOf(byDuration, 'test/render-budget-browser.test.mjs'),
    'the recorded durations put them in different shards');
  assert.equal(path(byDuration), 321949, 'the critical path drops to the single slowest file');
  assert.ok(path(byDuration) < path(byBytes));
});

test('the plan job reads the last green main run\'s durations and keeps them off CI\'s commits (Issue #966)', () => {
  const workflow = readFileSync('.github/workflows/test.yml', 'utf8');
  const job = workflow.slice(workflow.indexOf('  plan:'), workflow.indexOf('  test:'));
  assert.match(job, /permissions:\n      contents: read\n      actions: read\n/, 'the plan job may read another run\'s artifacts');
  assert.match(job, /gh run list [^\n]*--workflow tests --branch main --status success --limit 1/, 'the durations come from the newest green main run');
  assert.match(job, /--json databaseId [^\n]*\|\| true\)\n/, 'a repository with no green main run still plans, by byte size');
  assert.match(job, /\|\| echo "run \$run kept no readable shard results"\n/, 'expired or unreadable artifacts still plan, by byte size');
  assert.doesNotMatch(job, /continue-on-error/, 'tolerance lives in the shell here too, since a killed step never reaches it');
  assert.match(job, /WEAVE_CI_HISTORY: ci-history\n/, 'the planner is told where the downloaded durations are');
  assert.doesNotMatch(workflow, /git (commit|push|add)/, 'no baseline is committed from CI; weave refuses pull requests opened by Actions');
});

test('every job that rebuilds the manifest reads the same durations (Issue #966)', () => {
  const workflow = readFileSync('.github/workflows/test.yml', 'utf8');
  const jobs = {
    plan: workflow.slice(workflow.indexOf('  plan:'), workflow.indexOf('  test:')),
    test: workflow.slice(workflow.indexOf('  test:'), workflow.indexOf('  gate:')),
    gate: workflow.slice(workflow.indexOf('  gate:'), workflow.indexOf('  compatibility:')),
  };
  assert.match(jobs.plan, /name: plan-history\n          path: ci-history\/\n          if-no-files-found: ignore\n          overwrite: true\n/,
    'the plan job publishes the durations it used, so the shards and the gate weigh what it weighed');
  for (const [name, job] of Object.entries(jobs)) {
    assert.match(job, /WEAVE_CI_HISTORY: ci-history\n/, `the ${name} job weighs by the run's own durations`);
    assert.match(job, /node scripts\/ci-test\.mjs (plan|run|aggregate)/, `the ${name} job rebuilds the manifest`);
    if (name === 'test') assert.match(job, /uses: actions\/download-artifact@[0-9a-f]{40}\n        with:\n          pattern: plan-history\n          path: ci-history\n/, 'the test job takes the plan job\'s copy, and a pattern that matches no artifact leaves it planning by byte size');
    if (name === 'gate') assert.match(job, /gh run download "\$GITHUB_RUN_ID" [^\n]*-n plan-history -D ci-history \|\| echo /, 'the gate job takes the plan job\'s copy, and plans by byte size if it is not there');
  }
  assert.doesNotMatch(jobs.gate, /pattern: plan-\*|pattern: '?\*/, 'the shard results and the durations land in separate directories');
  assert.match(jobs.gate, /pattern: ci-\*\n          path: ci-results\n/,
    'the durations artifact is named plan-history so the ci-* pattern never mixes a past run\'s shard results into this run\'s evidence');
});

test('the pull request plan weighs shards by the last green main run\'s durations, and every PR job rebuilds the same manifest (Issue #1673)', () => {
  const workflow = readFileSync('.github/workflows/pr.yml', 'utf8');
  const jobs = {
    plan: workflow.slice(workflow.indexOf('  plan:'), workflow.indexOf('  test:')),
    test: workflow.slice(workflow.indexOf('  test:'), workflow.indexOf('  gate:')),
    gate: workflow.slice(workflow.indexOf('  gate:')),
  };
  assert.match(jobs.plan, /permissions:\n      contents: read\n      actions: read\n/, 'the plan job may read the main run\'s artifacts');
  assert.match(jobs.plan, /gh run list [^\n]*--workflow tests --branch main --status success --limit 1 --json databaseId [^\n]*\|\| true\)\n/,
    'the durations come from the newest green main tests run, and a repository without one still plans by byte size');
  assert.match(jobs.plan, /gh run download "\$run" [^\n]*-p 'ci-\*' -D ci-history \|\| echo /, 'expired or unreadable artifacts still plan, by byte size');
  assert.match(jobs.plan, /name: plan-history\n          path: ci-history\/\n          if-no-files-found: ignore\n          overwrite: true\n/,
    'the plan job publishes the durations it used, so the shards and the gate weigh what it weighed');
  assert.doesNotMatch(workflow, /continue-on-error/, 'tolerance lives in the shell, since a killed step never reaches it');
  for (const [name, job] of Object.entries(jobs)) {
    assert.match(job, /WEAVE_CI_HISTORY: ci-history\n/, `the ${name} job weighs by the run's own durations`);
    assert.match(job, /node scripts\/ci-test\.mjs pr-(plan|run|aggregate)/, `the ${name} job rebuilds the manifest`);
  }
  assert.match(jobs.test, /uses: actions\/download-artifact@[0-9a-f]{40}\n        with:\n          pattern: plan-history\n          path: ci-history\n/,
    'the shards take the plan job\'s copy, and a pattern that matches no artifact leaves them planning by byte size');
  assert.match(jobs.gate, /uses: actions\/download-artifact@[0-9a-f]{40}\n        with:\n          pattern: plan-history\n          path: ci-history\n/,
    'the gate takes the plan job\'s copy');
  assert.match(jobs.gate, /pattern: pr-\*\n          path: ci-results\n/, 'the durations land apart from this run\'s shard evidence');
});

test('only the browser lanes of the full suite start from the browser image (Issue #967)', () => {
  const workflow = readFileSync('.github/workflows/test.yml', 'utf8');
  assert.match(workflow, /\n    container:\n      image: \$\{\{ matrix\.lane == 'browser' && '[^']+' \|\| '' \}\}\n/,
    'the two unit shards of run 39439094335 spent 46 and 37 seconds downloading engines they never open; an empty image runs a unit shard on the bare runner');
  assert.equal([...workflow.matchAll(/matrix\.lane == 'browser'/g)].length, 1,
    'the lane condition picks the container, and nothing else');
});

const STATIC_PLAYWRIGHT = /^\s*import\s(?:[^;]*?from\s*)?['"]playwright['"]/m;
const SPECIFIER = /(?:^|[\s({,;=])from\s*['"](\.[^'"\n]+)['"]|(?:^|[\s({,;=])import\s*\(?\s*['"](\.[^'"\n]+)['"]/gm;

function browsersReachedBy(file, seen = new Set()) {
  const absolute = resolve(file);
  if (seen.has(absolute)) return [];
  seen.add(absolute);
  let source;
  try { source = readFileSync(absolute, 'utf8'); } catch { return []; }
  const reached = STATIC_PLAYWRIGHT.test(source) ? [`${file} imports playwright at load`] : [];
  for (const [, fromSpec, importSpec] of source.matchAll(SPECIFIER)) {
    const next = relative('.', join(dirname(absolute), fromSpec ?? importSpec));
    if (/(?:^|\/)lib\/browser\.mjs$/.test(next)) reached.push(`${file} reaches ${next}`);
    else if (existsSync(next)) reached.push(...browsersReachedBy(next, seen));
  }
  return reached;
}

test('no unit-lane test opens a browser at load, so the unit shards need no engine (Issue #967)', () => {
  const { unit } = lanes(testFiles(resolve('.')), resolve('.'));
  assert.ok(unit.length > 100, 'the unit lane holds the bulk of the inventory');
  assert.deepEqual(unit.flatMap((file) => browsersReachedBy(file)), [],
    'a test that drives a browser belongs in the browser lane, which is the lane that installs the engines');
});

test('every main commit gets its own tests lane, so a later merge cancels no earlier CI gate', async () => {
  const { readFileSync } = await import('node:fs');
  const workflow = readFileSync('.github/workflows/test.yml', 'utf8');
  const concurrency = workflow.match(/\nconcurrency:\n  group: (.+)\n  cancel-in-progress: (\S+)\n/);
  assert.ok(concurrency, 'test.yml carries one workflow-level concurrency block');
  assert.match(concurrency[1], /\$\{\{ inputs\.ref \|\| github\.sha \}\}/, 'the group names the commit under test, so two main pushes never queue behind one lane');
  assert.equal(concurrency[2], 'false', 'a running gate is never cancelled by the next merge');
});

const browserFiles = ['test/chip-browser.test.mjs', 'test/chip-width-browser.test.mjs', 'test/grid-keymap-browser.test.mjs', 'test/oidc-login-browser.test.mjs', ...SMOKE];
const sources = { 'test/oidc-login-browser.test.mjs': "import { startIdp } from './lib/idp.mjs'; const src = '../src/oidc.js';" };
const read = file => sources[file] ?? '';

test('a changed browser test runs itself beside the smoke set', () => {
  assert.deepEqual(touchedBrowser(['test/grid-keymap-browser.test.mjs'], browserFiles, read), [...SMOKE, 'test/grid-keymap-browser.test.mjs'].sort());
});

test('a changed module maps to browser tests named for it, its -core twin included', () => {
  assert.deepEqual(touchedBrowser(['public/grid-keymap.js'], browserFiles, read), [...SMOKE, 'test/grid-keymap-browser.test.mjs'].sort());
  assert.deepEqual(touchedBrowser(['public/chip-core.js'], browserFiles, read), [...SMOKE, 'test/chip-browser.test.mjs', 'test/chip-width-browser.test.mjs'].sort());
});

test('a changed file maps to browser tests whose source cites it', () => {
  assert.deepEqual(touchedBrowser(['src/oidc.js'], browserFiles, read), [...SMOKE, 'test/oidc-login-browser.test.mjs'].sort());
  assert.deepEqual(touchedBrowser(['test/lib/idp.mjs'], browserFiles, read), [...SMOKE, 'test/oidc-login-browser.test.mjs'].sort());
});

test('a diff nothing maps to falls back to the fixed smoke set, never an empty browser lane', () => {
  assert.deepEqual(touchedBrowser(['DEVELOPMENT.md', 'test/formula.test.mjs'], browserFiles, read), [...SMOKE].sort());
  assert.deepEqual(touchedBrowser([], browserFiles, read), [...SMOKE].sort());
  assert.ok(SMOKE.length > 0 && SMOKE.length <= 12);
  assert.ok(SMOKE.every(f => f.endsWith('-browser.test.mjs')));
});

test('the smoke set names browser tests that exist in this repository', async () => {
  const { testFiles, lanes } = await import('../scripts/test.mjs');
  const { browser } = lanes(testFiles());
  assert.deepEqual(SMOKE.filter(f => !browser.includes(f)), []);
});

const sheetSources = {
  'test/phone-new-row-sheet-browser.test.mjs': "await page.locator('.sheet-grip').hover();",
  'test/phone-picker-sheet-browser.test.mjs': "const pill = page.locator('.sheet-grip-pill');",
  'test/phone-bottom-bar-browser.test.mjs': "await styleOf(page, '.phone-bottom-bar');",
};
const sheetBrowser = [...Object.keys(sheetSources), ...browserFiles];
const sheetRead = (file) => sheetSources[file] ?? sources[file] ?? '';
const sheetDiff = [
  'diff --git a/public/app.js b/public/app.js',
  'index 83152140..1a5732e1 100644',
  '--- a/public/app.js',
  '+++ b/public/app.js',
  '@@ -11291,10 +11291,11 @@ function sheetGrip(sheet, close) {',
  "   const grip = el('div', { class: 'sheet-grip' }, el('span', { class: 'sheet-grip-pill' }));",
  '-    const speed = Math.max(0, e.clientY - y) / span;',
  "+    const reach = e.type === 'pointerup' ? Math.max(at, e.clientY - y) : at;",
].join('\n');

test('hunk tokens are the dashed and slashed literals of the changed blocks, never the diff headers', () => {
  assert.deepEqual(reachTokens(sheetDiff), ['sheet-grip', 'sheet-grip-pill']);
  assert.deepEqual(reachTokens(''), []);
  assert.deepEqual(reachTokens('diff --git a/public/field-dialog-core.js b/public/field-dialog-core.js'), []);
});

test('a changed public module selects every browser suite naming the DOM tokens of the block it changed', () => {
  assert.deepEqual(touchedBrowser(['public/app.js'], sheetBrowser, sheetRead), [...SMOKE].sort());
  assert.deepEqual(
    touchedBrowser(['public/app.js'], sheetBrowser, sheetRead, sheetDiff),
    [...SMOKE, 'test/phone-new-row-sheet-browser.test.mjs', 'test/phone-picker-sheet-browser.test.mjs'].sort(),
  );
});

test('a changed server module selects the browser suites naming the paths its block serves', () => {
  const routes = {
    'test/footer-rollups-browser.test.mjs': "await page.request.post('/api/tables/subtotals');",
    'test/table-views-browser.test.mjs': 'const open = true;',
  };
  const browser = [...Object.keys(routes), ...browserFiles];
  const read = (file) => routes[file] ?? sources[file] ?? '';
  const diff = ["@@ -820,6 +820,7 @@ function routeTable(req) {", "+  if (path === '/api/tables/subtotals') return subtotals(req);"].join('\n');
  assert.deepEqual(touchedBrowser(['src/routes.js'], browser, read), [...SMOKE].sort());
  assert.deepEqual(
    touchedBrowser(['src/routes.js'], browser, read, diff),
    [...SMOKE, 'test/footer-rollups-browser.test.mjs'].sort(),
  );
});

test('the reached tier drops a token the whole lane names and stops at its file cap', () => {
  const wide = Array.from({ length: 120 }, (_, i) => `test/w${String(i).padStart(3, '0')}-browser.test.mjs`);
  const browser = [...wide, ...SMOKE];
  const read = (file) => (wide.includes(file) ? `const token = 'wv-token-${file.slice(6, 9)}'; const shared = 'wv-whole-lane';` : '');
  assert.deepEqual(touchedBrowser(['public/app.js'], browser, read, "+  const shared = 'wv-whole-lane';"), [...SMOKE].sort());
  const everyToken = wide.map((file) => `+  const token = 'wv-token-${file.slice(6, 9)}';`).join('\n');
  const picked = touchedBrowser(['public/app.js'], browser, read, everyToken);
  assert.equal(picked.length, SMOKE.length + REACH_CAP);
  assert.ok(REACH_CAP >= 20 && REACH_SPREAD >= 1);
  assert.deepEqual(picked.filter((file) => SMOKE.includes(file)).sort(), [...SMOKE].sort());
});

test('the PR plan shards the reached browser suites beside the named ones', () => {
  const unit = Array.from({ length: 30 }, (_, i) => `test/u${String(i).padStart(2, '0')}.test.mjs`);
  const browser = [...Object.keys(sheetSources), ...SMOKE];
  const shards = prPlan({ unit, browser }, ['public/chip-core.js'], sheetRead, () => 1, sheetDiff);
  const picked = shards.filter((s) => s.lane === 'browser').flatMap((s) => s.files);
  assert.ok(picked.includes('test/phone-picker-sheet-browser.test.mjs'));
  assert.equal(picked.length, SMOKE.length + 2);
  const monolith = prPlan({ unit, browser }, ['public/app.js'], sheetRead, () => 1, sheetDiff);
  assert.equal(monolith.filter((s) => s.lane === 'browser').flatMap((s) => s.files).length, browser.length, 'a public/app.js diff plans the full browser lane (Feature #368)');
});

test('the sheet grabber tokens reach the phone sheet suites of this repository, which file names cannot', async () => {
  const { readFileSync } = await import('node:fs');
  const { testFiles, lanes } = await import('../scripts/test.mjs');
  const { browser } = lanes(testFiles());
  const read = (file) => readFileSync(file, 'utf8');
  const diff = "+  const grip = el('div', { class: 'sheet-grip' }, el('span', { class: 'sheet-grip-pill' }));";
  const named = touchedBrowser(['public/app.js'], browser, read);
  const reached = touchedBrowser(['public/app.js'], browser, read, diff);
  const beyond = reached.filter((file) => !named.includes(file));
  assert.ok(beyond.length >= 2, `sheet-grip reached ${beyond.length} suites beyond the name match`);
  assert.ok(reached.includes('test/phone-picker-sheet-browser.test.mjs'));
  assert.ok(reached.length <= SMOKE.length + REACH_CAP + named.length);
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
  const wide = prPlan({ unit, browser }, ['test/lib/browser.mjs'], file => (file.startsWith('test/lib/') ? '' : "from './lib/browser.mjs'"), () => 1);
  assert.equal(wide.filter(s => s.lane === 'browser').length, 8);
  assert.equal(wide.filter(s => s.lane === 'browser').flatMap(s => s.files).length, browser.length);
  const mid = prPlan({ unit, browser }, many.slice(0, 30), read, () => 1);
  assert.equal(mid.filter(s => s.lane === 'browser').length, 3);
});

const indexHtml = [
  '<script src="/theme-boot.js"></script>',
  '<link rel="stylesheet" href="/style.css">',
  '<template id="lazy-assets"><script src="/board-view.js"></script><script src="/settings-view.js"></script></template>',
  '<script src="/chip-core.js"></script>',
  '<script src="/menu-core.js"></script>',
  '<script src="/app.js"></script>',
].join('\n');

test('the eager assets of index.html are the shared front end, and the templated ones are not', () => {
  assert.deepEqual(eagerAssets((file) => (file === 'public/index.html' ? indexHtml : '')), [
    'public/app.js', 'public/chip-core.js', 'public/menu-core.js', 'public/style.css', 'public/theme-boot.js',
  ]);
  assert.deepEqual(eagerAssets(() => ''), []);
  assert.deepEqual(eagerAssets(() => { throw new Error('no such file'); }), []);
});

test('a diff touching a module every app page loads plans the full browser lane, not a stem match', () => {
  const unit = Array.from({ length: 30 }, (_, i) => `test/u${String(i).padStart(2, '0')}.test.mjs`);
  const browser = [...Object.keys(sheetSources), ...browserFiles];
  const readIndex = (file) => (file === 'public/index.html' ? indexHtml : sheetRead(file));
  const laneOf = (changed) => prPlan({ unit, browser }, changed, readIndex, () => 1).filter((s) => s.lane === 'browser').flatMap((s) => s.files);
  assert.equal(laneOf(['public/menu-core.js']).length, browser.length, 'public/menu-core.js is loaded by every app page, so every browser suite exercises it');
  assert.equal(laneOf(['public/theme-boot.js']).length, browser.length);
  assert.deepEqual(laneOf(['public/board-view.js']).sort(), [...SMOKE].sort(), 'a templated module stays on name and reach selection');
  for (const file of ['public/app.js', 'public/style.css', 'src/commands.js', 'src/engine.js', 'src/routes.js']) {
    assert.equal(laneOf([file]).length, browser.length, `${file} keeps the full lane even when index.html does not name it`);
  }
});

test('a change to the shared chrome of this repository selects the suite whose silent omission took main red', async () => {
  const { readFileSync } = await import('node:fs');
  const { testFiles, lanes } = await import('../scripts/test.mjs');
  const { browser } = lanes(testFiles());
  const readFile = (file) => readFileSync(file, 'utf8');
  const eager = eagerAssets(readFile);
  for (const file of ['public/menu-core.js', 'public/picker-core.js', 'public/phone-row.js', 'public/app.js']) {
    assert.ok(eager.includes(file), `${file} is loaded by every app page`);
  }
  assert.ok(!eager.includes('public/board-view.js'), 'public/board-view.js is templated, so it is not shared chrome');
  const lane = prPlan({ unit: ['test/formula.test.mjs'], browser }, ['public/menu-core.js'], readFile, () => 1)
    .filter((s) => s.lane === 'browser').flatMap((s) => s.files);
  assert.ok(lane.includes('test/phone-row-header-browser.test.mjs'), 'the suite PR 868 skipped and main failed (Issue #1550)');
  assert.equal(lane.length, browser.length);
});

test('the PR plan says on stderr which browser suites it left out, so a silent subset cannot read as green', () => {
  const browser = [...Object.keys(sheetSources), ...browserFiles];
  const kept = prPlan({ unit: ['test/formula.test.mjs'], browser }, ['test/formula.test.mjs'], sheetRead, () => 1);
  const notice = planNotice(kept, browser);
  assert.match(notice, /^plan browser lane: \d+ of \d+ suites; left out /);
  for (const file of Object.keys(sheetSources)) assert.ok(notice.includes(file), `${file} is named as left out`);
  const full = prPlan({ unit: ['test/formula.test.mjs'], browser }, ['public/app.js'], sheetRead, () => 1);
  assert.equal(planNotice(full, browser), `plan browser lane: ${browser.length} of ${browser.length} suites; left out none`);
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
  assert.match(workflow, /image: \$\{\{ matrix\.lane == 'browser' && 'mcr\.microsoft\.com\/playwright:v[\d.]+-noble@sha256:[0-9a-f]{64}' \|\| '' \}\}\n/);
});

test('every workflow that installs browsers on the runner bounds the install inside the job budget', () => {
  for (const [file, from, to, jobBudget] of [['dev-soak.yml', '  soak:', null, 30], ['budgets.yml', '  trend:', null, 30]]) {
    const workflow = readFileSync(`.github/workflows/${file}`, 'utf8');
    const job = workflow.slice(workflow.indexOf(from), to ? workflow.indexOf(to) : undefined);
    assert.ok(job.length > 200, `${file} has a ${from.trim()} job`);
    assert.match(job, new RegExp(`timeout-minutes: ${jobBudget}\\n`), `${file} declares the job budget this test reasons about`);
    const steps = [...job.matchAll(/- name: Install [^\n]*\n(?:        id: [^\n]*\n)?(?:        if: [^\n]*\n)?        timeout-minutes: (\d+)\n        run: node scripts\/ci\/install-browsers\.mjs [a-z ]+\n/g)];
    assert.equal(steps.length, 1, `${file} has one bounded install step`);
    assert.ok(Number(steps[0][1]) < jobBudget, `${file} leaves the job room to run its work`);
    assert.doesNotMatch(job, /continue-on-error/, `${file} does not lean on continue-on-error, which a killed step does not survive`);
  }
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
  assert.ok(source.includes('const summary = validate(manifest, newestAttempts(results), commit, quarantine);'), 'aggregate keeps the newest attempt for main and PR runs alike');
  assert.doesNotMatch(source, /pr \? newestAttempts/);
  const failed = { ...evidence()[0], attempt: 1, code: 1 };
  const rerun = { ...evidence()[0], attempt: 2 };
  const passed = evidence().slice(1).map((r) => ({ ...r, attempt: 1 }));
  assert.throws(() => validate(manifest, newestAttempts([failed, ...passed]), 'abc'), /Invalid shard/);
  assert.equal(validate(manifest, newestAttempts([failed, ...passed, rerun]), 'abc').files, 4);
});

test('onboarding journeys are mandatory even for unrelated changes and cannot silently disappear', () => {
  const selected = touchedBrowser(['README.md'], browserFiles, read);
  for (const file of ONBOARDING) {
    assert.ok(selected.includes(file));
    assert.throws(() => touchedBrowser([], browserFiles.filter(f => f !== file), read), /Missing required journey suite/);
  }
  assert.equal(ONBOARDING.length, 4);
});

test('render, vitals, feedback and query-volume budgets leave every gating plan for the trend lane, and nothing else does (Issue #1709)', () => {
  const all = lanes(testFiles());
  assert.deepEqual([...TREND].sort(), ['test/feedback-budget-browser.test.mjs', 'test/query-volume.test.mjs', 'test/render-budget-browser.test.mjs', 'test/vitals-budget-browser.test.mjs']);
  assert.deepEqual(TREND.filter((f) => ![...all.unit, ...all.browser].includes(f)), [], 'every trend suite is a test of this repository');
  for (const f of ['test/click-budget-browser.test.mjs', 'test/render-budget.test.mjs', 'test/vitals-budget.test.mjs', 'test/feedback-budget.test.mjs']) assert.ok(!TREND.includes(f), `${f} counts clicks or checks raise reasons, never a reading of the runner, and stays on the gate`);
  const kept = gating(all);
  assert.equal(kept.unit.length + kept.browser.length + TREND.length, all.unit.length + all.browser.length);
  assert.ok(!kept.unit.includes('test/query-volume.test.mjs'), 'the unit lane drops the query-volume ratio as well');
  assert.ok(currentPlan().every((s) => s.files.every((f) => !TREND.includes(f))), 'the main CI gate plans no trend suite');
  for (const changed of [[...TREND], [...TREND, 'public/app.js'], ['test/lib/journeys.mjs']]) {
    const pr = prPlan(kept, changed, (file) => (file.includes('/lib/') ? '' : "from './lib/journeys.mjs'"), () => 1);
    assert.ok(pr.every((s) => s.files.every((f) => !TREND.includes(f))), `a PR changing ${changed.join(', ')} asserts no millisecond on a shared runner`);
  }
});

test('budgets.yml runs the trend lane on main pushes only, outside the tests workflow the sheriff, release and promotion read', async () => {
  const { readFileSync } = await import('node:fs');
  const yml = readFileSync('.github/workflows/budgets.yml', 'utf8');
  assert.match(yml, /^name: budgets\n/);
  assert.match(yml, /^on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n\n/m);
  assert.doesNotMatch(yml, /pull_request|merge_group|workflow_run/);
  assert.match(yml, /node scripts\/ci-trend\.mjs\n/);
  assert.match(yml, /permissions:\n      contents: read\n      actions: read\n/);
  const sheriff = readFileSync('.github/workflows/sheriff.yml', 'utf8');
  assert.match(sheriff, /workflows: \[tests\]/, 'the sheriff judges the tests workflow alone, so a budget red never reaches it');
});

test('budgets.yml records each run as one point of the series and judges it against the points before it (Issue #1709)', () => {
  const yml = readFileSync('.github/workflows/budgets.yml', 'utf8');
  const step = (name) => yml.slice(yml.indexOf(`- name: ${name}`)).split(/\n(?=      - )/)[0];
  const history = step('Series from the earlier budget runs');
  assert.match(history, /gh run list -R "\$GITHUB_REPOSITORY" --workflow budgets\.yml --branch main --event push --status completed --limit \d+ --json databaseId -q '\.\[\]\.databaseId' \|\| true\)\n/, 'the earlier main pushes, and none at all on a first run');
  assert.match(history, /gh run download "\$run" -R "\$GITHUB_REPOSITORY" -n trend-series -D "trend-history\/\$run" \|\| \{\n\s+echo "run \$run kept no trend series"\n/, 'a run that kept no series is named in the shell and stubbed as a gap point (Issue #1848)');
  assert.match(history, /GH_TOKEN: \$\{\{ github\.token \}\}\n/);
  const judge = step('Run the timing budgets and judge the trend');
  assert.match(judge, /WEAVE_TREND_HISTORY: trend-history\n/);
  assert.match(judge, /WEAVE_TREND_SERIES: trend-series\n/);
  assert.match(judge, /WEAVE_TRACKER_TOKEN: \$\{\{ secrets\.WEAVE_TRACKER_TOKEN \}\}\n/, 'a miss files its trend note on the tracker');
  assert.ok(yml.indexOf('- name: Series from the earlier budget runs') < yml.indexOf('- name: Run the timing budgets and judge the trend'));
  const keep = step('Keep this run\'s readings for the next runs');
  assert.match(keep, /if: always\(\)\n/, 'a faulted run keeps the readings it took');
  assert.match(keep, /uses: actions\/upload-artifact@[0-9a-f]{40}\n/);
  assert.match(keep, /name: trend-series\n          path: trend-series\/\n/);
  assert.match(keep, /overwrite: true\n/, 'a re-run replaces its own point rather than failing on the name');
  assert.doesNotMatch(yml, /continue-on-error/);
});

test('the main plan spreads the browser lane over eight shards and runs every shard at once, so none meets the 20-minute job timeout (Issue #1351)', () => {
  const real = testFiles('.');
  const manifest = plan(real, lanes(real, '.'), () => 1);
  const browser = manifest.filter(s => s.lane === 'browser');
  assert.equal(browser.length, 8);
  const workflow = readFileSync('.github/workflows/test.yml', 'utf8');
  const parallel = Number(workflow.match(/max-parallel: (\d+)/)[1]);
  assert.ok(parallel >= manifest.length, `max-parallel ${parallel} runs every one of ${manifest.length} shards at once`);
});

const reachFiles = ['test/formula.test.mjs', 'test/grid.test.mjs', 'test/cli.test.mjs', 'test/docs-drift.test.mjs'];
const reachSources = {
  'test/formula.test.mjs': "import { evaluate } from '../src/formula.js';",
  'test/grid.test.mjs': "import { rows } from './lib/grid.mjs';",
  'test/lib/grid.mjs': "import { Weave } from '../../src/engine.js';",
  'test/cli.test.mjs': "spawnSync(process.execPath, ['bin/weave.js', 'query']);",
  'test/docs-drift.test.mjs': "readdirSync('src/').filter((f) => f.endsWith('.js'));",
};
const reachRead = (file) => reachSources[file] ?? '';

test('a changed source module selects the unit files that import it, directly or through a helper (Issue #1676)', () => {
  assert.deepEqual(unitReach(reachFiles, ['src/formula.js'], reachRead), ['test/formula.test.mjs', 'test/docs-drift.test.mjs']);
  assert.deepEqual(unitReach(reachFiles, ['src/engine.js'], reachRead), ['test/grid.test.mjs', 'test/docs-drift.test.mjs']);
});

test('a unit file that names a changed file it never imports is selected, so a read or a spawn is not missed (Issue #1676)', () => {
  assert.deepEqual(unitReach(reachFiles, ['bin/weave.js'], reachRead), ['test/cli.test.mjs']);
  assert.ok(unitReach(reachFiles, ['src/formula.js'], reachRead).includes('test/docs-drift.test.mjs'),
    'a gate that reads the whole src directory runs for any change inside it');
});

test('a unit file that names no code path at all is kept, since nothing says what it covers (Issue #1676)', () => {
  const blind = { 'test/repo.test.mjs': "readFileSync('CHANGELOG.md', 'utf8');" };
  assert.deepEqual(unitReach(['test/repo.test.mjs', ...reachFiles], ['src/formula.js'], (file) => blind[file] ?? reachRead(file)),
    ['test/repo.test.mjs', 'test/formula.test.mjs', 'test/docs-drift.test.mjs'],
    'a gate that reads the repo without naming src, bin, scripts or public runs for every change');
});

test('a change the import graph cannot follow keeps every unit file (Issue #1676)', () => {
  for (const changed of [['README.md'], ['package.json'], ['public/sw.js'], ['.github/workflows/test.yml'], ['src/formula.js', 'README.md'], []]) {
    assert.deepEqual(unitReach(reachFiles, changed, reachRead), reachFiles, JSON.stringify(changed));
  }
  assert.deepEqual(unitReach(reachFiles, ['src/formula.js', 'test/grid.test.mjs'], reachRead), ['test/formula.test.mjs', 'test/docs-drift.test.mjs'],
    'a changed test beside a changed source does not widen the lane: the selection adds changed tests itself');
});

test('a source change narrows the real unit lane and keeps the suite that covers it (Issue #1676)', () => {
  const root = join(import.meta.dirname, '..');
  const unit = gating(lanes(testFiles(root), root)).unit;
  const reached = unitReach(unit, ['src/formula.js'], file => readFileSync(join(root, file), 'utf8'));
  assert.ok(reached.includes('test/formula.test.mjs'), 'the suite named for the changed module runs');
  assert.ok(reached.length < unit.length, `${reached.length} of ${unit.length} unit files: the lane is narrower than every gating unit file`);
  assert.ok(reached.length >= 1, 'a narrowed lane is never empty');
  const missing = unitReach(unit, ['src/formula.js', 'docs/graph.md'], file => readFileSync(join(root, file), 'utf8'));
  assert.deepEqual(missing, unit, 'a documentation change beside it keeps every unit file');
});

test('a token the edit itself names outranks the enclosing function it sits in, and the whole-function tokens still reach (Issue #1679)', () => {
  const wide = Array.from({ length: 120 }, (_, i) => `test/w${String(i).padStart(3, '0')}-browser.test.mjs`);
  const edited = Array.from({ length: REACH_SPREAD }, (_, i) => `test/e${i}-browser.test.mjs`);
  const browser = [...wide, ...edited, ...SMOKE];
  const read = (file) => {
    if (wide.includes(file)) return `const token = 'wv-token-${file.slice(6, 9)}';`;
    if (edited.includes(file)) return "const token = 'wv-edited-token';";
    return '';
  };
  const context = wide.map((file) => `   const token = 'wv-token-${file.slice(6, 9)}';`).join('\n');
  const diff = ['@@ -1,1 +1,1 @@ function enclosing() {', "+  el('div', { class: 'wv-edited-token' });", context].join('\n');
  assert.deepEqual(reachNamed(diff), ['wv-edited-token'], 'the named tokens come from the changed lines alone');
  assert.equal(reachTokens(diff).length, wide.length + 1, 'the whole -W block still yields every token, so recall is unchanged');
  const picked = touchedBrowser(['public/app.js'], browser, read, diff);
  assert.equal(picked.length, SMOKE.length + REACH_CAP, 'the cap is still spent in full');
  assert.deepEqual(edited.filter((file) => !picked.includes(file)), [], 'every suite naming the edited token is selected before the cap closes');
  assert.ok(picked.some((file) => wide.includes(file)), 'the enclosing function still reaches suites with what is left of the cap');
});

test('a diff with no changed-line tokens still reaches through its context, as Issue #1075 intended (Issue #1679)', () => {
  assert.deepEqual(reachNamed(sheetDiff), [], 'the sheet diff names its tokens only on context lines');
  assert.deepEqual(
    touchedBrowser(['public/app.js'], sheetBrowser, sheetRead, sheetDiff),
    [...SMOKE, 'test/phone-new-row-sheet-browser.test.mjs', 'test/phone-picker-sheet-browser.test.mjs'].sort(),
  );
  assert.deepEqual(reachNamed(''), []);
  assert.deepEqual(reachNamed('--- a/public/app.js\n+++ b/public/app.js'), [], 'the file headers are not changed lines');
});

const quarantine = [{ file: 'test/c-browser.test.mjs', issue: 1778 }];
const quarantinedRun = ({ crash = false } = {}) => evidence().map(shard => {
  if (!shard.files.includes('test/c-browser.test.mjs')) return shard;
  const red = ['test/c-browser.test.mjs'];
  const summaries = shard.files.flatMap(file => red.includes(file)
    ? (file === 'test/c-browser.test.mjs' && crash ? [] : [{ file, success: false, counts: { tests: 2, passed: 1, failed: 1, cancelled: 0, skipped: 0 }, duration_ms: 3 }])
    : [{ file, success: true, counts: { tests: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0 }, duration_ms: 1 }]);
  return { ...shard, code: 1, summaries, retried: [], stillRed: red.sort() };
});

test('a quarantined file still red after its retry leaves the gate green and is named with its Issue in the summary (Issue #1761)', () => {
  const results = quarantinedRun();
  const red = results.find(r => r.stillRed?.length);
  assert.equal(shardCode(red, quarantine), 0, 'the shard job passes when only quarantined files stayed red');
  assert.equal(shardCode(red, []), 1, 'with no quarantine the same shard fails');
  const summary = validate(manifest, results, 'abc', quarantine);
  assert.equal(summary.files, 3);
  assert.deepEqual(summary.quarantined, [{ file: 'test/c-browser.test.mjs', issue: 1778, shard: red.id }]);
  const printed = aggregate(manifest, results, 'abc', quarantine);
  assert.deepEqual(JSON.parse(printed[0]).quarantined, summary.quarantined, 'the gate summary lists the file under its own key');
  assert.ok(printed.includes(`::warning file=test/c-browser.test.mjs,title=Quarantined, red, not gating::test/c-browser.test.mjs stayed red after its retry in shard ${red.id}; it is quarantined under Issue #1778, so the gate passed`));
  assert.throws(() => validate(manifest, results, 'abc', []), /Invalid shard/, 'an empty list gates the same red');
});

test('a quarantine never hides another red, a timeout or a missing file (Issue #1761)', () => {
  const crashed = quarantinedRun({ crash: true });
  assert.deepEqual(validate(manifest, crashed, 'abc', quarantine).quarantined.map(q => q.file), ['test/c-browser.test.mjs'], 'a quarantined file whose process crashed on both runs is listed too');
  const mixed = { code: 1, files: ['test/c-browser.test.mjs', 'test/d-browser.test.mjs'], stillRed: ['test/c-browser.test.mjs', 'test/d-browser.test.mjs'] };
  assert.equal(shardCode(mixed, quarantine), 1, 'a red file off the list keeps the shard red');
  const both = quarantinedRun().map(r => r.files.includes('test/d-browser.test.mjs')
    ? { ...r, code: 1, stillRed: ['test/d-browser.test.mjs'], summaries: [{ file: 'test/d-browser.test.mjs', success: false, counts: { tests: 1, passed: 0, failed: 1, cancelled: 0, skipped: 0 }, duration_ms: 1 }] }
    : r);
  assert.throws(() => validate(manifest, both, 'abc', quarantine), /Invalid shard/, 'another shard red off the list fails the gate');
  const timedOut = quarantinedRun().map(r => r.stillRed?.length ? { ...r, timedOut: true, code: 124 } : r);
  assert.equal(shardCode(timedOut.find(r => r.timedOut), quarantine), 124, 'a timed out shard stays red');
  assert.throws(() => validate(manifest, timedOut, 'abc', quarantine), /Invalid shard/);
  const silent = quarantinedRun().map(r => r.stillRed?.length ? { ...r, stillRed: [] } : r);
  assert.throws(() => validate(manifest, silent, 'abc', quarantine), /Invalid shard/, 'a red shard that names no still-red file stays red');
  const other = evidence().map(r => r.files.includes('test/a.test.mjs') ? { ...r, summaries: r.summaries.filter(s => s.file !== 'test/a.test.mjs') } : r);
  assert.throws(() => validate(manifest, other, 'abc', quarantine), /coverage/, 'a missing summary off the list still fails coverage');
  assert.equal(Object.hasOwn(validate(manifest, evidence(), 'abc', quarantine), 'quarantined'), false, 'a green run prints the summary keys it had');
});

test('every QUARANTINE entry names its flake Issue and a gating test file that exists (Issue #1761)', () => {
  const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
  const all = testFiles(root);
  for (const entry of QUARANTINE) {
    assert.deepEqual(Object.keys(entry).sort(), ['file', 'issue']);
    assert.ok(Number.isInteger(entry.issue) && entry.issue > 0, `${entry.file} names an Issue number`);
    assert.match(entry.file, /^test\/.+\.test\.mjs$/);
    assert.ok(existsSync(join(root, entry.file)), `${entry.file} exists`);
    assert.ok(all.includes(entry.file), `${entry.file} is a test file the lanes run`);
    assert.ok(!TREND.includes(entry.file), `${entry.file} is not already outside the gate`);
  }
  assert.equal(new Set(QUARANTINE.map(q => q.file)).size, QUARANTINE.length, 'one entry per file');
});

test('the CI gate and the PR gate both take their shard exit code and their verdict from the quarantine-aware functions (Issue #1761)', () => {
  const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
  const source = readFileSync(join(root, 'scripts/ci-test.mjs'), 'utf8');
  assert.ok(source.includes('process.exitCode = shardCode(result);'), 'the shard job exits by shardCode');
  assert.ok(source.includes('shardCode(result, quarantine) !== 0'), 'validate reads the shard code through the quarantine');
  assert.match(readFileSync(join(root, '.github/workflows/test.yml'), 'utf8'), /node scripts\/ci-test\.mjs run "\$SHARD"[\s\S]*node scripts\/ci-test\.mjs aggregate ci-results/);
  assert.match(readFileSync(join(root, '.github/workflows/pr.yml'), 'utf8'), /node scripts\/ci-test\.mjs pr-run "\$SHARD"[\s\S]*node scripts\/ci-test\.mjs pr-aggregate ci-results/);
});
