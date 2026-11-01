import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TREND } from './ci-test.mjs';
import { alertRequest } from './sheriff.mjs';

export const SUSTAINED = 3;
export const WORKFLOW = 'budgets.yml';

export function streak(runs, currentId) {
  let n = 0;
  for (const run of [...runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    if (String(run.id) === String(currentId)) continue;
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') continue;
    if (run.conclusion !== 'failure') break;
    n++;
  }
  return n;
}

export function verdict(code, previous, sustained = SUSTAINED) {
  if (code === 0) return { level: 'held', line: 'timing budgets held' };
  const count = previous + 1;
  if (count >= sustained) return { level: 'alert', line: `timing budgets over budget on ${count} main pushes in a row: a sustained regression, not runner noise` };
  return { level: 'warn', line: `timing budgets over budget (${count} of ${sustained} in a row before an alert): one red on a shared runner is noise until it repeats` };
}

async function previousFailures(env) {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${WORKFLOW}/runs?branch=main&event=push&status=completed&per_page=20`, {
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`runs answered ${res.status}`);
  return streak((await res.json()).workflow_runs ?? [], env.GITHUB_RUN_ID);
}

async function main(env = process.env) {
  const child = spawnSync(process.execPath, ['scripts/test.mjs', '--targeted', '--timeout=1200000', ...TREND], { stdio: 'inherit', env });
  const code = child.status ?? 1;
  let previous = 0;
  if (code !== 0) {
    try { previous = await previousFailures(env); } catch (error) { console.log(`::warning::could not read earlier budget runs (${error.message}); counting this red alone`); }
  }
  const { level, line } = verdict(code, previous);
  const run = env.GITHUB_RUN_ID ? ` https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  console.log(level === 'held' ? line : `::${level === 'alert' ? 'error' : 'warning'}::${line}`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}${run}\n`);
  if (level === 'alert' && env.SHERIFF_ALERT_URL) {
    const alert = `weave budgets: ${line}${run}`;
    try {
      await fetch(env.SHERIFF_ALERT_URL, alertRequest(env, alert));
    } catch (error) {
      console.log(`::warning::alert not sent: ${error.message}`);
    }
  }
  process.exitCode = code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
