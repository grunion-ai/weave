#!/usr/bin/env node
/* The repeatable security checks (Issue #532), run by hand and by
   .github/workflows/security.yml. In order, each only if its binary is on the PATH:
     gitleaks   git history, security/gitleaks.toml
     semgrep    security/semgrep/weave.yml over src bin public, against baseline.json
     zizmor     .github/workflows
     actionlint .github/workflows
     hadolint   Dockerfile, security/hadolint.yaml
     vendor     scripts/vendor-advisories.mjs (OSV, network)
   One summary line per tool: pass, fail or skipped. Exit 1 on any fail.
   --require-all (CI) turns a skipped tool into a fail.
   --update-baseline rewrites security/semgrep/baseline.json from a fresh run;
   do that only after reading each new result and deciding it is not a defect.
   Semgrep's taint results can vary between runs on a loaded machine, so a baseline
   entry that does not reproduce is never a failure; regenerate until the count is stable. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, delimiter, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = join(ROOT, 'security/semgrep/baseline.json');
export const SCAN_DIRS = ['src', 'bin', 'public'];

/* A finding is identified by rule, file and the text of the lines it matched,
   never by line number, so an unrelated edit above it does not read as new. */
export function fingerprint(result, source) {
  const lines = source.split('\n').slice(result.start.line - 1, result.end.line);
  return `${result.check_id.split('.').pop()}|${result.path}|${lines.map((l) => l.trim().replace(/\s+/g, ' ')).join(' ')}`;
}

/* Multiset compare: a fingerprint seen more often than the baseline allows is new. */
export function newFindings(fingerprints, baseline) {
  const allowed = new Map();
  for (const f of baseline) allowed.set(f, (allowed.get(f) ?? 0) + 1);
  const fresh = [];
  for (const f of fingerprints) {
    const left = allowed.get(f) ?? 0;
    if (left > 0) allowed.set(f, left - 1);
    else fresh.push(f);
  }
  return fresh;
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

function semgrepStep(update) {
  const r = run('semgrep', ['--metrics=off', '--quiet', '--json', '--timeout', '300', '--config', 'security/semgrep/weave.yml',
    '--exclude', 'vendor', ...SCAN_DIRS]);
  let out;
  try { out = JSON.parse(r.stdout); } catch { return { status: 'fail', detail: `no JSON from semgrep: ${tail(r)}` }; }
  // A rule that cannot load is a failure; a file semgrep cannot parse is not (public/app.js carries a raw NUL in a template literal).
  // A timeout would drop results silently, so it fails too.
  const broken = out.errors.filter((e) => e.type !== 'PartialParsing' && !/Syntax error/.test(e.message));
  if (broken.length) return { status: 'fail', detail: broken.map((e) => e.message.split('\n')[0]).join('; ') };
  const fps = out.results.map((x) => fingerprint(x, readFileSync(join(ROOT, x.path), 'utf8')));
  if (update) { writeFileSync(BASELINE, JSON.stringify(fps.sort(), null, 2) + '\n'); return { status: 'pass', detail: `baseline rewritten, ${fps.length} results` }; }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const fresh = newFindings(fps, base);
  return fresh.length
    ? { status: 'fail', detail: `${fresh.length} new result${fresh.length > 1 ? 's' : ''}:\n  ${fresh.join('\n  ')}` }
    : { status: 'pass', detail: `${fps.length} results, all in baseline` };
}

const simple = (name, bin, args, lines) => () => {
  if (!onPath(bin)) return { name, status: 'skipped', detail: `${bin} not on PATH` };
  const r = run(bin, args);
  return { name, status: r.status === 0 ? 'pass' : 'fail', detail: r.status === 0 ? '' : tail(r, lines) };
};

export function steps(update = false) {
  return [
    simple('gitleaks', 'gitleaks', ['git', '--no-banner', '--redact', '--config', 'security/gitleaks.toml', '.']),
    () => (onPath('semgrep') ? { name: 'semgrep', ...semgrepStep(update) } : { name: 'semgrep', status: 'skipped', detail: 'semgrep not on PATH' }),
    // zizmor asks the GitHub API to check pinned SHAs when it has a token; without one it stays offline.
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
