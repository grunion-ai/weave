import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
      (file === 'test/security/security-scan.test.mjs' && reason === 'semgrep not installed') ||
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

function currentPlan() {
  const files = testFiles(ROOT);
  return plan(files, lanes(files, ROOT), file => statSync(join(ROOT, file)).size);
}

async function main() {
  const [command, id, out = 'ci-results'] = process.argv.slice(2);
  const manifest = currentPlan();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (command === 'plan') { console.log(JSON.stringify({ include: manifest.map(({ id, lane }) => ({ id, lane })) })); return; }
  if (command === 'aggregate') {
    const results = readdirSync(id, { recursive: true }).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(id, f), 'utf8')));
    const summary = validate(manifest, results, commit);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (command !== 'run') throw new Error('Expected plan, run <shard>, or aggregate <directory>');
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
  const result = { ...shard, commit, manifest: digest(manifest), code: child.status ?? 1, durationMs: Date.now() - start, summaries: events.filter(e => e.type === 'summary').map(e => e.data), skips: events.filter(e => e.type === 'skip').map(e => e.data) };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${id}.json`), JSON.stringify(result, null, 2) + '\n');
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = result.code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
