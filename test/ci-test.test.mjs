import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, validate, digest, touchedBrowser, prPlan, reachTokens, SMOKE, ONBOARDING, REACH_CAP, REACH_SPREAD, newestAttempts } from '../scripts/ci-test.mjs';

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
  const shards = prPlan({ unit, browser }, ['public/app.js'], sheetRead, () => 1, sheetDiff);
  const picked = shards.filter((s) => s.lane === 'browser').flatMap((s) => s.files);
  assert.ok(picked.includes('test/phone-picker-sheet-browser.test.mjs'));
  assert.equal(picked.length, SMOKE.length + 2);
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

test('every gating workflow bounds each browser install attempt and retries it once', async () => {
  const { readFileSync } = await import('node:fs');
  for (const [file, from, to, jobBudget, lane] of [['pr.yml', '  test:', '  gate:', 15, true], ['test.yml', '  test:', '  gate:', 30, true], ['dev-soak.yml', '  soak:', null, 30, false]]) {
    const workflow = readFileSync(`.github/workflows/${file}`, 'utf8');
    const job = workflow.slice(workflow.indexOf(from), to ? workflow.indexOf(to) : undefined);
    assert.ok(job.length > 200, `${file} has a ${from.trim()} job`);
    assert.match(job, new RegExp(`timeout-minutes: ${jobBudget}\\n`), `${file} declares the job budget this test reasons about`);
    const steps = [...job.matchAll(/- name: Install [^\n]*\n(?:        if: ([^\n]*)\n)?        timeout-minutes: (\d+)\n        run: \|\n([\s\S]*?)(?=\n      - )/g)];
    assert.equal(steps.length, 1, `${file} has one bounded install step`);
    const [, guard, backstop, body] = steps[0];
    if (lane) assert.equal(guard, "matrix.lane == 'browser'", `${file} installs browsers for the browser lane only`);
    const attempts = [...body.matchAll(/timeout (\d+)m npx --no-install playwright install --with-deps /g)].map((m) => Number(m[1]));
    assert.equal(attempts.length, 2, `${file} attempts the install twice`);
    for (const budget of attempts) assert.ok(budget >= 1 && budget <= 5, `${file} waits ${budget} minutes on an attempt`);
    assert.match(body, /dpkg --configure -a \|\| true/, `${file} repairs an interrupted unpack before the second attempt`);
    assert.match(body, /Acquire::Retries/, `${file} bounds apt's own connections`);
    assert.ok(attempts[0] + attempts[1] <= Number(backstop), `${file} fits both attempts in the step backstop`);
    assert.ok(Number(backstop) < jobBudget, `${file} leaves the job room to run its work`);
    assert.doesNotMatch(job, /continue-on-error/, `${file} does not lean on continue-on-error, which a killed step does not survive`);
    assert.equal(job.match(/playwright install --with-deps /g).length, 2, `${file} installs browsers in one place`);
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
