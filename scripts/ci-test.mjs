import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testFiles, lanes } from './test.mjs';

const ROOT = resolve(import.meta.dirname, '..');
export const UNIT_SHARDS = 2;
export const BROWSER_FILES_PER_SHARD = 45;
export const BROWSER_SHARD_CAP = 12;
export const browserShards = count => Math.max(1, Math.min(BROWSER_SHARD_CAP, Math.ceil(count / BROWSER_FILES_PER_SHARD)));
export const TARGET_SHARD_MS = 7 * 60 * 1000;
export const UNIT_SHARD_CAP = 4;
export const DEFAULT_PARALLELISM = 1.5;

export function laneMs(files, timings, size) {
  const measured = file => {
    const ms = timings?.files?.[file];
    return Number.isFinite(ms) && ms > 0 ? ms : null;
  };
  const rates = files.filter(measured).map(file => measured(file) / Math.max(1, size(file))).sort((a, b) => a - b);
  if (!rates.length) return null;
  const rate = rates[Math.floor(rates.length / 2)];
  return new Map(files.map(file => [file, measured(file) ?? Math.max(1, size(file)) * rate]));
}

export function laneShards(lane, files, ms, timings) {
  if (!ms) return lane === 'unit' ? UNIT_SHARDS : browserShards(files.length);
  const parallelism = timings?.parallelism?.[lane] > 0 ? timings.parallelism[lane] : DEFAULT_PARALLELISM;
  const total = files.reduce((sum, file) => sum + ms.get(file), 0);
  const cap = lane === 'unit' ? UNIT_SHARD_CAP : BROWSER_SHARD_CAP;
  const floor = lane === 'unit' ? Math.min(UNIT_SHARDS, files.length) : 1;
  return Math.max(floor, Math.min(cap, Math.ceil(total / parallelism / TARGET_SHARD_MS)));
}

export function checkInventory(manifest, groups) {
  for (const lane of ['unit', 'browser']) {
    const planned = manifest.filter(s => s.lane === lane).flatMap(s => s.files).sort();
    if (JSON.stringify(planned) !== JSON.stringify([...groups[lane]].sort())) throw new Error(`Manifest ${lane} lane does not match the test inventory at this commit`);
  }
  if (manifest.some(s => s.lane !== 'unit' && s.lane !== 'browser')) throw new Error('Manifest names an unknown lane');
  return manifest;
}

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function plan(files, groups, weight, unitCount = UNIT_SHARDS, browserCount = 4) {
  if (!files.length) throw new Error('Empty CI selection');
  if (JSON.stringify([...files].sort()) !== JSON.stringify([...groups.unit, ...groups.browser].sort())) throw new Error('Lane coverage mismatch');
  return Object.entries(groups).flatMap(([lane, selected]) => {
    const count = Math.min(selected.length, lane === 'unit' ? unitCount : browserCount);
    const shards = Array.from({ length: count }, (_, i) => ({ id: `${lane}-${i + 1}`, lane, files: [], weight: 0 }));
    for (const file of [...selected].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))) {
      const shard = [...shards].sort((a, b) => a.weight - b.weight || a.id.localeCompare(b.id))[0];
      shard.files.push(file); shard.weight += weight(file);
    }
    return shards.map(({ weight, ...shard }) => ({ ...shard, files: shard.files.sort() }));
  });
}

export function validate(manifest, results, commit) {
  if (results.length !== manifest.length || new Set(results.map(r => r.id)).size !== manifest.length) throw new Error('Missing or duplicate shards');
  const summaries = [];
  for (const shard of manifest) {
    const result = results.find(r => r.id === shard.id);
    if (!result || result.commit !== commit || result.manifest !== digest(manifest) || result.code !== 0) throw new Error(`Invalid shard ${shard.id}`);
    if (JSON.stringify(result.files) !== JSON.stringify(shard.files)) throw new Error(`Selection mismatch ${shard.id}`);
    if (result.skips.some(({ file, reason }) => !shard.files.includes(file) || !(
      (file === 'test/security/security-scan.test.mjs' && (reason === 'semgrep not installed' || reason === 'gitleaks not installed')) ||
      (file === 'test/ws-rail-inset-browser.test.mjs' && reason.startsWith('overlay scrollbars here: no gutter to measure ('))
    ))) throw new Error(`Skipped coverage ${shard.id}`);
    const actual = new Map(result.summaries.map(s => [s.file, s]));
    if (actual.size !== shard.files.length) throw new Error(`Executed coverage mismatch ${shard.id}`);
    for (const file of shard.files) {
      const summary = actual.get(file);
      if (!summary?.success || !(summary.counts.tests > 0) || summary.counts.failed || summary.counts.cancelled) throw new Error(`Missing or failed execution ${file}`);
      summaries.push(summary);
    }
  }
  return { commit, files: summaries.length, tests: summaries.reduce((n, s) => n + s.counts.tests, 0), slowest: summaries.sort((a, b) => b.duration_ms - a.duration_ms).slice(0, 10) };
}

export const ONBOARDING = [
  'test/setup-flows-browser.test.mjs',
  'test/workspace-signin-start-browser.test.mjs',
  'test/invites-browser.test.mjs',
  'test/invites-mail-browser.test.mjs',
];

export const SMOKE = [
  ...ONBOARDING,
  'test/chip-paint-contract-browser.test.mjs',
  'test/click-budget-browser.test.mjs',
  'test/doc-title-browser.test.mjs',
  'test/entity-dock-browser.test.mjs',
  'test/first-run-browser.test.mjs',
  'test/picker-browser.test.mjs',
  'test/route-skeleton-browser.test.mjs',
  'test/table-views-browser.test.mjs',
];

export const REACH_CAP = 60;
export const REACH_SPREAD = 8;
const TOKEN = /[a-z][a-z0-9]*(?:[-/][a-z0-9]+)+/g;
const DIFF_HEADER = /^(diff --git|index |\+\+\+|---|@@|new file|deleted file|old mode|new mode|similarity|rename|Binary)/;

export function reachTokens(diff) {
  const tokens = new Set();
  for (const line of String(diff).split('\n')) {
    if (DIFF_HEADER.test(line)) continue;
    for (const [token] of line.matchAll(TOKEN)) if (token.length >= 6) tokens.add(token);
  }
  return [...tokens].sort();
}

export function touchedBrowser(changed, browser, read, diff = '') {
  for (const file of SMOKE) if (!browser.includes(file)) throw new Error(`Missing required journey suite ${file}`);
  const source = new Map(browser.map(file => [file, read(file)]));
  const picked = new Set(SMOKE);
  for (const file of changed) {
    if (browser.includes(file)) { picked.add(file); continue; }
    const name = basename(file);
    const stem = name.replace(/\.[^.]+$/, '').replace(/-core$/, '');
    for (const test of browser) {
      const testStem = basename(test).replace(/(-browser)?\.test\.mjs$/, '');
      if (testStem === stem || testStem.startsWith(`${stem}-`) || source.get(test).includes(name)) picked.add(test);
    }
  }
  const named = picked.size;
  const groups = reachTokens(diff)
    .map(token => [token, browser.filter(file => source.get(file).includes(token))])
    .filter(([, files]) => files.length && files.length <= REACH_SPREAD)
    .sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
  for (const [, files] of groups) {
    const adds = files.filter(file => !picked.has(file));
    if (picked.size + adds.length > named + REACH_CAP) continue;
    for (const file of adds) picked.add(file);
  }
  return [...picked].sort();
}

export function prPlan({ unit, browser }, changed, read, weight, diff = '') {
  const touched = touchedBrowser(changed, browser, read, diff);
  return plan([...unit, ...touched], { unit, browser: touched }, weight, 4, Math.min(4, Math.ceil(touched.length / 20)));
}

const weightOf = file => statSync(join(ROOT, file)).size;

export function newestAttempts(results) {
  const newest = new Map();
  for (const result of results) {
    const held = newest.get(result.id);
    if (!held || (result.attempt ?? 1) > (held.attempt ?? 1)) newest.set(result.id, result);
  }
  return [...newest.values()];
}

export function mainPlan(root = ROOT, timings = null) {
  const files = testFiles(root);
  const groups = lanes(files, root);
  const size = file => statSync(join(root, file)).size;
  const ms = { unit: laneMs(groups.unit, timings, size), browser: laneMs(groups.browser, timings, size) };
  const weight = file => (ms.unit?.get(file) ?? ms.browser?.get(file) ?? size(file));
  return plan(files, groups, weight, laneShards('unit', groups.unit, ms.unit, timings), laneShards('browser', groups.browser, ms.browser, timings));
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

export function loadManifest(path, root = ROOT) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  return checkInventory(manifest, lanes(testFiles(root), root));
}

function currentPrPlan() {
  const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const diff = execFileSync('git', ['diff', '-W', '--no-renames', 'HEAD^1', 'HEAD', '--', 'public', 'src', 'bin'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return prPlan(lanes(testFiles(ROOT), ROOT), changed, file => readFileSync(join(ROOT, file), 'utf8'), weightOf, diff);
}

async function main() {
  const [mode, id, out = 'ci-results'] = process.argv.slice(2);
  const pr = mode?.startsWith('pr-');
  const command = pr ? mode.slice(3) : mode;
  const saved = !pr && command !== 'plan' && process.env.CI_MANIFEST;
  const manifest = pr ? currentPrPlan() : saved ? loadManifest(saved) : mainPlan(ROOT, process.env.CI_TIMINGS ? readJson(process.env.CI_TIMINGS) : null);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (command === 'plan') {
    if (!pr && process.env.CI_MANIFEST) {
      mkdirSync(resolve(process.env.CI_MANIFEST, '..'), { recursive: true });
      writeFileSync(process.env.CI_MANIFEST, JSON.stringify(manifest) + '\n');
    }
    console.log(JSON.stringify({ include: manifest.map(({ id, lane }) => ({ id, lane })) }));
    return;
  }
  if (command === 'aggregate') {
    const results = readdirSync(id, { recursive: true }).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(id, f), 'utf8')));
    const summary = validate(manifest, newestAttempts(results), commit);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (command !== 'run') throw new Error('Expected [pr-]plan, [pr-]run <shard>, or [pr-]aggregate <directory>');
  const shard = manifest.find(s => s.id === id);
  if (!shard) throw new Error(`Unknown shard ${id}`);
  const dir = mkdtempSync(join(tmpdir(), 'weave-ci-'));
  const report = join(dir, 'events.jsonl');
  writeFileSync(report, '');
  const start = Date.now();
  const child = spawnSync(process.execPath, ['scripts/test.mjs', '--targeted', '--timeout=1200000', '--test-concurrency=2', `--test-reporter=${pathToFileURL(join(ROOT, 'scripts/ci-test-reporter.mjs'))}`, '--test-reporter-destination=stdout', ...shard.files], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, WEAVE_CI_REPORT: report },
  });
  const events = readFileSync(report, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const result = { ...shard, commit, manifest: digest(manifest), attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1), code: child.status ?? 1, durationMs: Date.now() - start, summaries: events.filter(e => e.type === 'summary').map(e => e.data), skips: events.filter(e => e.type === 'skip').map(e => e.data) };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${id}.json`), JSON.stringify(result, null, 2) + '\n');
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = result.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
