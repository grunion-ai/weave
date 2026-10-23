import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testFiles, lanes } from './test.mjs';

const ROOT = resolve(import.meta.dirname, '..');
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function plan(files, groups, weight, unitCount = 2, browserCount = 4) {
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

export const BUDGET = 80;

export function hunks(diff) {
  const out = {};
  let file = null, old = null, header = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) header = true;
    else if (header && line.startsWith('--- ')) old = line.slice(4).replace(/^a\//, '');
    else if (header && line.startsWith('+++ ')) { const p = line.slice(4); file = p === '/dev/null' ? old : p.replace(/^b\//, ''); }
    else if (line.startsWith('@@ ')) {
      header = false;
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      (out[file] ??= []).push([+m[1], +(m[2] ?? 1), +m[3], +(m[4] ?? 1)]);
    }
  }
  return out;
}

export const touchedLines = list => list.flatMap(([start, count]) => count ? Array.from({ length: count }, (_, i) => start + i) : [Math.max(1, start), start + 1]);

export function toMap(line, drift) {
  let delta = 0;
  for (const [os, oc, ns, nc] of drift) {
    const start = nc ? ns : ns + 1;
    if (line < start) break;
    const from = oc ? os : os + 1;
    if (line < start + nc) return from;
    delta = from + oc - start - nc;
  }
  return line + delta;
}

const innermost = (entries, line) => entries.reduce((best, e) => e[0] <= line && line <= e[1] && (!best || e[1] - e[0] < best[1] - best[0]) ? e : best, null);

export function touchedBrowser(changed, browser, read, { map, lines = {} } = {}) {
  for (const file of SMOKE) if (!browser.includes(file)) throw new Error(`Missing required journey suite ${file}`);
  const picked = new Set(SMOKE);
  const lane = new Set(browser);
  if (map) { const known = new Set(map.tests); for (const test of browser) if (!known.has(test)) picked.add(test); }
  const score = new Map();
  for (const file of changed) {
    if (lane.has(file)) { picked.add(file); continue; }
    const entries = map?.files[file];
    if (entries) {
      const hit = new Set((lines[file]?.length ? lines[file] : [1]).map(line => innermost(entries, line)).filter(Boolean));
      for (const [, , set] of hit) for (const i of map.sets[set]) score.set(map.tests[i], (score.get(map.tests[i]) ?? 0) + 1);
      continue;
    }
    const name = basename(file);
    const stem = name.replace(/\.[^.]+$/, '').replace(/-core$/, '');
    for (const test of browser) {
      const testStem = basename(test).replace(/(-browser)?\.test\.mjs$/, '');
      if (testStem === stem || testStem.startsWith(`${stem}-`) || read(test).includes(name)) picked.add(test);
    }
  }
  const ranked = [...score].filter(([test]) => lane.has(test) && !picked.has(test)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([test]) => test);
  const room = Math.max(1, BUDGET - picked.size);
  for (const test of ranked.slice(0, room)) picked.add(test);
  return { files: [...picked].sort(), dropped: ranked.slice(room) };
}

export function prPlan({ unit, browser }, changed, read, weight, coverage) {
  const { files: touched, dropped } = touchedBrowser(changed, browser, read, coverage);
  if (dropped.length) console.error(`PR plan: ${touched.length} browser files selected, ${dropped.length} covering tests dropped over the ${BUDGET}-file budget: ${dropped.join(' ')}`);
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

function currentPlan() {
  const files = testFiles(ROOT);
  return plan(files, lanes(files, ROOT), weightOf);
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

function currentCoverage() {
  const path = join(ROOT, 'test/coverage-map.json');
  if (!existsSync(path)) return undefined;
  const map = JSON.parse(readFileSync(path, 'utf8'));
  const pr = hunks(git('diff', '-U0', '--no-renames', 'HEAD^1', 'HEAD', '--', ...Object.keys(map.files)));
  const touched = Object.keys(pr);
  let drift = {};
  if (touched.length) try { drift = hunks(git('diff', '-U0', '--no-renames', map.commit, 'HEAD^1', '--', ...touched)); } catch { console.error(`PR plan: coverage map commit ${map.commit} is not in this history, reading lines as they are`); }
  return { map, lines: Object.fromEntries(touched.map(file => [file, touchedLines(pr[file]).map(line => toMap(line, drift[file] ?? []))])) };
}

function currentPrPlan() {
  const changed = git('diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD').split('\n').filter(Boolean);
  return prPlan(lanes(testFiles(ROOT), ROOT), changed, file => readFileSync(join(ROOT, file), 'utf8'), weightOf, currentCoverage());
}

async function main() {
  const [mode, id, out = 'ci-results'] = process.argv.slice(2);
  const pr = mode?.startsWith('pr-');
  const command = pr ? mode.slice(3) : mode;
  const manifest = pr ? currentPrPlan() : currentPlan();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (command === 'plan') { console.log(JSON.stringify({ include: manifest.map(({ id, lane }) => ({ id, lane })) })); return; }
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
