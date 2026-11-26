import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testFiles, lanes } from './lanes.mjs';

const ROOT = resolve(import.meta.dirname, '..');
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const TREND = ['test/feedback-budget-browser.test.mjs', 'test/query-volume.test.mjs', 'test/render-budget-browser.test.mjs', 'test/vitals-budget-browser.test.mjs'];
export const QUARANTINE = [{ file: 'test/entity-dock-default-browser.test.mjs', issue: 1778 }];
const onList = (list, file) => list.some(q => q.file === file);
export const quarantinedRed = (result, list = QUARANTINE) => (result.stillRed ?? []).filter(file => onList(list, file) && (!result.files || result.files.includes(file)));
export function shardCode(result, list = QUARANTINE) {
  if (result.code === 0 || result.timedOut) return result.code;
  const red = result.stillRed ?? [];
  return red.length && red.every(file => onList(list, file)) ? 0 : result.code;
}
export const gating = ({ unit, browser }) => ({ unit: unit.filter(f => !TREND.includes(f)), browser: browser.filter(f => !TREND.includes(f)) });

export function plan(files, groups, weight, unitCount = 2, browserCount = 8) {
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

export function validate(manifest, results, commit, quarantine = QUARANTINE) {
  if (results.length !== manifest.length || new Set(results.map(r => r.id)).size !== manifest.length) throw new Error('Missing or duplicate shards');
  const summaries = [];
  const quarantined = [];
  for (const shard of manifest) {
    const result = results.find(r => r.id === shard.id);
    if (!result || result.commit !== commit || result.manifest !== digest(manifest) || shardCode(result, quarantine) !== 0) throw new Error(`Invalid shard ${shard.id}`);
    if (JSON.stringify(result.files) !== JSON.stringify(shard.files)) throw new Error(`Selection mismatch ${shard.id}`);
    if (result.skips.some(({ file, reason }) => !shard.files.includes(file) || !(
      (file === 'test/security/security-scan.test.mjs' && (reason === 'semgrep not installed' || reason === 'gitleaks not installed')) ||
      (file === 'test/ws-rail-inset-browser.test.mjs' && reason.startsWith('overlay scrollbars here: no gutter to measure ('))
    ))) throw new Error(`Skipped coverage ${shard.id}`);
    const actual = new Map(result.summaries.map(s => [s.file, s]));
    const red = quarantinedRed({ ...result, files: shard.files }, quarantine);
    if ([...actual.keys()].some(file => !shard.files.includes(file)) || shard.files.some(file => !actual.has(file) && !red.includes(file))) throw new Error(`Executed coverage mismatch ${shard.id}`);
    for (const file of shard.files) {
      if (red.includes(file)) { quarantined.push({ file, issue: quarantine.find(q => q.file === file).issue, shard: shard.id }); continue; }
      const summary = actual.get(file);
      if (!summary?.success || !(summary.counts.tests > 0) || summary.counts.failed || summary.counts.cancelled) throw new Error(`Missing or failed execution ${file}`);
      summaries.push(summary);
    }
  }
  const summary = { commit, files: summaries.length, tests: summaries.reduce((n, s) => n + s.counts.tests, 0), slowest: summaries.sort((a, b) => b.duration_ms - a.duration_ms).slice(0, 10) };
  return quarantined.length ? { ...summary, quarantined: quarantined.sort((a, b) => a.file.localeCompare(b.file)) } : summary;
}

export const retryAnnotations = results => results.flatMap(r => (r.retried ?? []).map(file => ({ file, shard: r.id })))
  .sort((a, b) => a.file.localeCompare(b.file))
  .map(({ file, shard }) => `::warning file=${file},title=Passed only on its retry::${file} failed in shard ${shard} and passed when the shard ran it again`);

export const quarantineAnnotations = summary => (summary.quarantined ?? [])
  .map(({ file, issue, shard }) => `::warning file=${file},title=Quarantined, red, not gating::${file} stayed red after its retry in shard ${shard}; it is quarantined under Issue #${issue}, so the gate passed`);

export function aggregate(manifest, results, commit, quarantine = QUARANTINE) {
  const summary = validate(manifest, newestAttempts(results), commit, quarantine);
  return [JSON.stringify(summary, null, 2), ...retryAnnotations(newestAttempts(results)), ...quarantineAnnotations(summary)];
}

export function shardResult(shard, events, run) {
  const records = (type) => events.filter(e => e.type === type).map(e => e.data);
  return { ...shard, ...run, summaries: records('summary'), skips: records('skip'), cases: records('case'), retried: records('retried').map(r => r.file), stillRed: records('still-red').map(r => r.file) };
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

const tokensOf = (diff, keep) => {
  const tokens = new Set();
  for (const line of String(diff).split('\n')) {
    if (DIFF_HEADER.test(line) || !keep(line)) continue;
    for (const [token] of line.matchAll(TOKEN)) if (token.length >= 6) tokens.add(token);
  }
  return [...tokens].sort();
};

export const reachTokens = (diff) => tokensOf(diff, () => true);
export const reachNamed = (diff) => tokensOf(diff, (line) => line.startsWith('+') || line.startsWith('-'));

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
  const edited = new Set(reachNamed(diff));
  const groups = reachTokens(diff)
    .map(token => [token, browser.filter(file => source.get(file).includes(token))])
    .filter(([, files]) => files.length && files.length <= REACH_SPREAD)
    .sort((a, b) => Number(edited.has(b[0])) - Number(edited.has(a[0])) || a[1].length - b[1].length || a[0].localeCompare(b[0]));
  for (const [, files] of groups) {
    const adds = files.filter(file => !picked.has(file));
    if (picked.size + adds.length > named + REACH_CAP) continue;
    for (const file of adds) picked.add(file);
  }
  return [...picked].sort();
}

const MONOLITHS = ['public/app.js', 'public/style.css', 'src/commands.js', 'src/engine.js', 'src/routes.js'];
const RELATIVE_IMPORT = /(?:^|[\s({,;=])(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"\n]+)['"]/gm;
const TEMPLATE = /<template\b[^>]*>[\s\S]*?<\/template>/g;
const ASSET = /(?:src|href)="(\/[^"]+\.(?:js|css))"/g;
export const OMITTED_NAMED = 20;

export function eagerAssets(read) {
  let html = '';
  try { html = read('public/index.html'); } catch { return []; }
  const bare = String(html).replace(TEMPLATE, '');
  return [...new Set([...bare.matchAll(ASSET)].map(([, path]) => `public${path}`))].sort();
}

export function planNotice(manifest, browser) {
  const planned = new Set(manifest.filter(shard => shard.lane === 'browser').flatMap(shard => shard.files));
  const left = browser.filter(file => !planned.has(file));
  const named = left.length > OMITTED_NAMED
    ? `${left.slice(0, OMITTED_NAMED).join(' ')} and ${left.length - OMITTED_NAMED} more`
    : (left.join(' ') || 'none');
  return `plan browser lane: ${planned.size} of ${browser.length} suites; left out ${named}`;
}

export function browserHelpers(browser, read) {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    let source = '';
    try { source = read(file); } catch {}
    for (const [, specifier] of source.matchAll(RELATIVE_IMPORT)) {
      const next = posix.join(posix.dirname(file), specifier);
      if (next.startsWith('test/')) visit(next);
    }
  };
  for (const file of browser) visit(file);
  return [...seen].filter(file => file.startsWith('test/lib/')).sort();
}

const GRAPHED = /^(?:src|bin|scripts)\//;
const CODE_PATH = /(?:src|bin|scripts|public)\//;

export function unitReach(unit, changed, read) {
  const sources = changed.filter(file => !file.startsWith('test/'));
  if (!sources.length || !sources.every(file => GRAPHED.test(file))) return unit;
  const text = file => { try { return String(read(file)); } catch { return ''; } };
  const closure = file => {
    const seen = new Set([file]);
    for (const next of seen) {
      for (const [, specifier] of text(next).matchAll(RELATIVE_IMPORT)) seen.add(posix.join(posix.dirname(next), specifier));
    }
    return seen;
  };
  const roots = [...new Set(sources.map(file => file.split('/')[0]))]
    .map(root => new RegExp(`['\"\`]${root}/?['\"\`]`));
  return unit.filter(file => {
    const reached = closure(file);
    if (sources.some(path => reached.has(path))) return true;
    const body = [...reached].map(text).join('\n');
    if (!CODE_PATH.test(body)) return true;
    return sources.some(path => body.includes(basename(path))) || roots.some(root => root.test(body));
  });
}

export function prSelection({ unit, browser }, changed, read, diff = '') {
  const shared = [...MONOLITHS, ...eagerAssets(read), ...browserHelpers(browser, read)];
  if (changed.some(file => shared.includes(file))) return { unit, browser: touchedBrowser(browser, browser, read), shared: true };
  return { unit, browser: touchedBrowser(changed, browser, read, diff), shared: false };
}

export function prPlan(groups, changed, read, weight, diff = '') {
  const { unit, browser, shared } = prSelection(groups, changed, read, diff);
  if (shared) return plan([...unit, ...groups.browser], { unit, browser }, weight, 4);
  return plan([...unit, ...browser], { unit, browser }, weight, 4, Math.min(4, Math.ceil(browser.length / 20)));
}

export function durationsFrom(results) {
  const seen = new Map();
  for (const result of results) {
    for (const summary of result?.summaries ?? []) {
      if (!summary?.file || !(summary.duration_ms >= 0)) continue;
      if (!seen.has(summary.file)) seen.set(summary.file, []);
      seen.get(summary.file).push(summary.duration_ms);
    }
  }
  const median = new Map();
  for (const [file, samples] of seen) {
    samples.sort((a, b) => a - b);
    const middle = samples.length >> 1;
    median.set(file, samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2);
  }
  return median;
}

export const weightWith = (durations, size) => file => durations.get(file) ?? size(file);

const sizeOf = file => statSync(join(ROOT, file)).size;

function recordedDurations(dir = process.env.WEAVE_CI_HISTORY) {
  if (!dir) return new Map();
  let names;
  try { names = readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.json')); }
  catch { return new Map(); }
  const results = [];
  for (const name of names) {
    try { results.push(JSON.parse(readFileSync(join(dir, name), 'utf8'))); } catch {}
  }
  const durations = durationsFrom(results);
  console.error(`plan weights: ${durations.size} files with a recorded duration from ${dir}, the rest by byte size`);
  return durations;
}


export function newestAttempts(results) {
  const newest = new Map();
  for (const result of results) {
    const held = newest.get(result.id);
    if (!held || (result.attempt ?? 1) > (held.attempt ?? 1)) newest.set(result.id, result);
  }
  return [...newest.values()];
}

export function currentPlan() {
  const groups = gating(lanes(testFiles(ROOT), ROOT));
  return plan([...groups.unit, ...groups.browser], groups, weightWith(recordedDurations(), sizeOf));
}

function currentPrPlan() {
  const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const diff = execFileSync('git', ['diff', '-W', '--no-renames', 'HEAD^1', 'HEAD', '--', 'public', 'src', 'bin'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const groups = gating(lanes(testFiles(ROOT), ROOT));
  const manifest = prPlan(groups, changed, file => readFileSync(join(ROOT, file), 'utf8'), weightWith(recordedDurations(), sizeOf), diff);
  console.error(planNotice(manifest, groups.browser));
  return manifest;
}

export const UNIT_TEST_TIMEOUT = 240_000;

export const shardArgs = (shard) => ['--targeted', '--timeout=1200000', '--test-concurrency=2',
  ...(shard.lane === 'unit' ? [`--test-timeout=${UNIT_TEST_TIMEOUT}`] : []),
  `--test-reporter=${pathToFileURL(join(ROOT, 'scripts/ci-test-reporter.mjs'))}`, '--test-reporter-destination=stdout', ...shard.files];

async function main() {
  const [mode, id, out = 'ci-results'] = process.argv.slice(2);
  const pr = mode?.startsWith('pr-');
  const command = pr ? mode.slice(3) : mode;
  const manifest = pr ? currentPrPlan() : currentPlan();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (command === 'plan') { console.log(JSON.stringify({ include: manifest.map(({ id, lane }) => ({ id, lane })) })); return; }
  if (command === 'aggregate') {
    const results = readdirSync(id, { recursive: true }).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(id, f), 'utf8')));
    for (const line of aggregate(manifest, results, commit)) console.log(line);
    return;
  }
  if (command !== 'run') throw new Error('Expected [pr-]plan, [pr-]run <shard>, or [pr-]aggregate <directory>');
  const shard = manifest.find(s => s.id === id);
  if (!shard) throw new Error(`Unknown shard ${id}`);
  const dir = mkdtempSync(join(tmpdir(), 'weave-ci-'));
  const report = join(dir, 'events.jsonl');
  writeFileSync(report, '');
  const start = Date.now();
  const child = spawnSync(process.execPath, ['scripts/test.mjs', ...shardArgs(shard)], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, WEAVE_CI_REPORT: report },
  });
  const events = readFileSync(report, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const result = shardResult(shard, events, { commit, manifest: digest(manifest), attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1), code: child.status ?? 1, timedOut: child.status === 124, durationMs: Date.now() - start });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${id}.json`), JSON.stringify(result, null, 2) + '\n');
  rmSync(dir, { recursive: true, force: true });
  for (const file of quarantinedRed(result)) console.log(`# QUARANTINED and red: ${file} stayed red after its retry; Issue #${QUARANTINE.find(q => q.file === file).issue} holds it off the gate`);
  process.exitCode = shardCode(result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
