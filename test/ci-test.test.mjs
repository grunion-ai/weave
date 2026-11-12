import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, validate, digest, touchedBrowser, prPlan, reachTokens, SMOKE, ONBOARDING, REACH_CAP, REACH_SPREAD, newestAttempts, durationsFrom, weightWith, TREND, gating, currentPlan } from '../scripts/ci-test.mjs';
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
    const steps = [...job.matchAll(/- name: Install [^\n]*\n(?:        if: [^\n]*\n)?        timeout-minutes: (\d+)\n        run: node scripts\/ci\/install-browsers\.mjs [a-z ]+\n/g)];
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
  assert.ok(source.includes('const summary = validate(manifest, newestAttempts(results), commit);'), 'aggregate keeps the newest attempt for main and PR runs alike');
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
  assert.match(history, /gh run download "\$run" -R "\$GITHUB_REPOSITORY" -n trend-series -D "trend-history\/\$run" \|\| echo /, 'a run that kept no series is skipped in the shell');
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
