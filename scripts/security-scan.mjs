#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, delimiter, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = join(ROOT, 'security/semgrep/baseline.json');
export const CUT_SHORT = join(ROOT, 'security/semgrep/cut-short.json');
export const SCAN_DIRS = ['src', 'bin', 'public'];

export function fingerprint(result, source) {
  const lines = source.split('\n').slice(result.start.line - 1, result.end.line);
  return `${result.check_id.split('.').pop()}|${result.path}|${lines.map((l) => l.trim().replace(/\s+/g, ' ')).join(' ')}`;
}

export function newFindings(fingerprints, baseline) {
  const allowed = new Set(baseline);
  return [...new Set(fingerprints)].filter((f) => !allowed.has(f));
}
export const SEMGREP_ARGS = ['--metrics=off', '--quiet', '--json', '--time', '-j', '1', '--timeout', '300', '--config', 'security/semgrep/weave.yml',
  '--exclude', 'vendor', ...SCAN_DIRS];
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
export function settle(runPass, max = 4) {
  const fps = new Set();
  const cut = new Set();
  const broken = [];
  let last = null;
  for (let passes = 1; passes <= max; passes++) {
    const pass = runPass();
    for (const f of pass.fps) fps.add(f);
    for (const path of pass.cut ?? []) cut.add(path);
    broken.push(...pass.broken);
    if (last && sameSet(last, pass.fps)) return { fps, cut, broken, passes, stable: true };
    last = pass.fps;
  }
  return { fps, cut, broken, passes: max, stable: false };
}
const count = (n, noun) => `${n} ${noun}${n > 1 ? 's' : ''}`;
export function semgrepVerdict({ fps, cut = new Set(), broken, passes, stable }, baseline, knownCut = []) {
  if (broken.length) return { status: 'fail', detail: `semgrep did not finish cleanly:\n  ${broken.map((e) => `${e.type}: ${e.message}`).join('\n  ')}` };
  const cutNew = [...cut].filter((path) => !knownCut.includes(path));
  if (cutNew.length) return { status: 'fail', detail: `taint analysis ran out of time in ${cutNew.join(', ')}, so results there are incomplete: shorten the function it names, or list the file in security/semgrep/cut-short.json` };
  if (!stable) return { status: 'fail', detail: `${passes} passes never agreed on one tree, so no result set can be trusted` };
  const fresh = newFindings([...fps], baseline);
  if (fresh.length) return { status: 'fail', detail: `${count(fresh.length, 'new result')}:\n  ${fresh.join('\n  ')}` };
  const missing = [...new Set(baseline)].filter((f) => !fps.has(f));
  if (missing.length) return { status: 'fail', detail: `${count(missing.length, 'baseline result')} not reported: the scan missed it, or the code is fixed and wants node scripts/security-scan.mjs --update-baseline:\n  ${missing.join('\n  ')}` };
  const guarded = [...cut].map((path) => `${path} analysed to its time limit, guarded by ${count(baseline.filter((f) => f.split('|')[1] === path).length, 'baseline result')} there`);
  return { status: 'pass', detail: [`${count(fps.size, 'result')}, all in baseline, ${passes} passes agreed`, ...guarded].join('; ') };
}
export const summaryLine = (name, status, detail = '') => `${name}: ${status}${detail ? ` (${detail})` : ''}`;

export function summarize(steps, { requireAll = false } = {}) {
  const lines = steps.map((s) => {
    const status = s.status === 'skipped' && requireAll ? 'fail' : s.status;
    return summaryLine(s.name, status, s.status === 'skipped' && requireAll ? 'not installed, --require-all' : s.detail);
  });
  const failed = steps.some((s) => s.status === 'fail' || (requireAll && s.status === 'skipped'));
  return { lines, code: failed ? 1 : 0 };
}

export function onPath(bin, path = process.env.PATH ?? '') {
  if (isAbsolute(bin)) return existsSync(bin);
  return path.split(delimiter).some((d) => d && existsSync(join(d, bin)));
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
const tail = (r, n = 8) => (r.stdout + r.stderr).trim().split('\n').slice(-n).join('\n');

function semgrepPass() {
  const r = run('semgrep', SEMGREP_ARGS);
  let out;
  try { out = JSON.parse(r.stdout); } catch { return { fps: new Set(), cut: [], broken: [{ type: 'NoJSON', message: tail(r) }] }; }
  const broken = out.errors.filter((e) => String(e.type) !== 'PartialParsing' && !/^PartialParsing|Syntax error/.test(`${e.type} ${e.message}`));
  return { fps: new Set(out.results.map((x) => fingerprint(x, readFileSync(join(ROOT, x.path), 'utf8')))), cut: (out.time?.fixpoint_timeouts ?? []).map((e) => e.location.path), broken };
}
function semgrepStep(update) {
  const scan = settle(semgrepPass);
  if (update) {
    if (scan.broken.length || !scan.stable) return semgrepVerdict(scan, [], [...scan.cut]);
    writeFileSync(BASELINE, JSON.stringify([...scan.fps].sort(), null, 2) + '\n');
    return { status: 'pass', detail: `baseline rewritten, ${count(scan.fps.size, 'result')}` };
  }
  return semgrepVerdict(scan, JSON.parse(readFileSync(BASELINE, 'utf8')), JSON.parse(readFileSync(CUT_SHORT, 'utf8')));
}
const simple = (name, bin, args, lines) => () => {
  if (!onPath(bin)) return { name, status: 'skipped', detail: `${bin} not on PATH` };
  const r = run(bin, args);
  return { name, status: r.status === 0 ? 'pass' : 'fail', detail: r.status === 0 ? '' : tail(r, lines) };
};

export const gitleaksArgs = (config = 'security/gitleaks.toml') =>
  ['git', '--no-banner', '--redact', '--config', config, '--log-opts=HEAD', '.'];

export function steps(update = false) {
  return [
    simple('gitleaks', 'gitleaks', gitleaksArgs()),
    () => (onPath('semgrep') ? { name: 'semgrep', ...semgrepStep(update) } : { name: 'semgrep', status: 'skipped', detail: 'semgrep not on PATH' }),
    simple('zizmor', 'zizmor', [...(process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? [] : ['--offline']), '--no-progress', '.github/workflows']),
    simple('actionlint', 'actionlint', []),
    simple('hadolint', 'hadolint', ['--config', 'security/hadolint.yaml', 'Dockerfile']),
    simple('vendor', process.execPath, ['scripts/vendor-advisories.mjs'], 20),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const update = process.argv.includes('--update-baseline');
  const results = [];
  for (const step of update ? [steps(true)[1]] : steps()) {
    const r = step();
    results.push(r);
    console.error(`... ${r.name}: ${r.status}`);
  }
  const { lines, code } = summarize(results, { requireAll: process.argv.includes('--require-all') });
  console.log(lines.join('\n'));
  process.exit(code);
}
