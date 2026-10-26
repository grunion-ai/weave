import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realIO as sheriffIO, isRevert } from './sheriff.mjs';

export const REPO = 'grunion-ai/weave';
export const BRANCH = 'production';
export const PROD = 'https://weave.grunion.ai';
export const SOAK = 'dev-soak';
export const GITHUB_HOST_KEY = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

const short = (sha) => String(sha).slice(0, 10);
const skip = (reason) => ({ action: 'skip', reason });

export const inWindow = (now, everyHours) => now.getUTCHours() % Math.max(1, Math.floor(everyHours) || 1) === 0;
export const revertsCommit = (message, sha) => String(message).includes(`This reverts commit ${sha}`);
export const pushArgs = (sha) => ['push', '--porcelain', `git@github.com:${REPO}.git`, `${sha}:refs/heads/${BRANCH}`];
export const issueName = (sha) => `Error: production rolled back the promotion of ${short(sha)}`;

export function verdict(health, sha) {
  const s = health?.supervisor;
  if (!s) return { state: 'pending', why: 'no supervisor block in /api/health' };
  const release = `c${sha}`;
  if (s.failed?.includes(sha)) return { state: 'failed', why: `the supervisor marked ${short(sha)} failed${s.lastSwap?.rollback ? `: ${s.lastSwap.rollback}` : ''}` };
  if (s.lastSwap?.rollback && s.lastSwap.from === release) return { state: 'failed', why: `rolled back to ${s.lastSwap.to}: ${s.lastSwap.rollback}` };
  if (s.watch?.release === release && s.watch.ok === false) return { state: 'failed', why: `watch failed: ${s.watch.reason ?? 'no reason given'}` };
  if (s.commit === sha && s.lastSwap?.ok && s.lastSwap.to === release && s.watch?.release === release && s.watch.ok === true) return { state: 'passed' };
  return { state: 'pending', why: `serving ${s.release ?? 'unknown'}, watch ${s.watch?.release ?? 'none'} ok=${s.watch?.ok ?? 'none'}` };
}

export async function select(io, { paused = false, now = new Date(), event = 'workflow_dispatch', everyHours = 2 } = {}) {
  if (paused) return skip('PROMOTION_PAUSED is true');
  if (event === 'schedule' && !inWindow(now, everyHours)) return skip(`outside the ${everyHours}-hour batch window`);
  const head = await io.production();
  if (!head) throw new Error(`no ${BRANCH} branch to promote from`);
  const { status, commits } = await io.range(head);
  if (status === 'identical') return skip(`${BRANCH} is already at main (${short(head)})`);
  if (status !== 'ahead') throw new Error(`${BRANCH} ${short(head)} is not an ancestor of main (compare: ${status})`);
  let from = 0;
  const health = await io.health();
  if (health?.supervisor?.commit !== head) {
    const at = commits.findLastIndex((c) => revertsCommit(c.message, head));
    if (at < 0) return skip(`prod serves ${health?.supervisor?.release ?? 'unknown'}, not the ${BRANCH} head ${short(head)}; waiting for a main commit that reverts it`);
    from = at;
  }
  for (const c of commits.slice(from).reverse()) {
    if (await io.gate(c.sha) !== 'success') continue;
    if (await io.soak(c.sha) !== 'success') continue;
    return { action: 'promote', sha: c.sha, from: head };
  }
  return skip(`no main commit newer than ${short(head)} has CI gate and ${SOAK} success`);
}

async function waitLive(io, sha, { deadlineMs, pollMs, sleep }) {
  const deadline = Date.now() + deadlineMs;
  let last = 'no health read yet';
  for (;;) {
    let health;
    try { health = await io.health(); } catch (error) { last = `health: ${error.message}`; }
    const v = health ? verdict(health, sha) : { state: 'pending', why: last };
    if (v.state !== 'pending') return { ...v, health };
    last = v.why;
    if (Date.now() >= deadline) return { state: 'timeout', why: `prod did not pass its watch on ${short(sha)} in ${Math.round(deadlineMs / 60_000)} minutes: ${last}`, health };
    await sleep(pollMs);
  }
}

export async function promote(io, { sha, from }, { deadlineMs = 25 * 60_000, pollMs = 15_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), self } = {}) {
  const head = await io.production();
  if (head !== from && head !== sha) throw new Error(`production moved to ${short(head)} since ${short(from)} was selected`);
  if (head !== sha) await io.push(sha);
  let hook;
  try { hook = await io.check(); } catch (error) { hook = { error: error.message }; }
  io.log(`deploy hook: ${JSON.stringify(hook)}`);
  const outcome = hook?.action === 'skipped'
    ? { state: 'failed', why: `the supervisor skipped ${short(sha)}: ${hook.reason ?? 'no reason given'}`, known: true }
    : await waitLive(io, sha, { deadlineMs, pollMs, sleep });
  if (outcome.state === 'passed') {
    if (outcome.health?.auth?.ok === false) await io.alert(`weave promote: ${short(sha)} is live, but sign-in is broken: /api/health reads auth.ok false (an architect read names the provider's error code)${self ? `; ${self}` : ''}`);
    return { action: 'promoted', sha, from, health: outcome.health };
  }

  const { commits } = await io.range(from, sha);
  const lines = [
    `Promotion of ${sha} to production failed: ${outcome.why}.`,
    `Previous production head: ${from}.`,
    ...(self ? [`Run: ${self}`] : []),
    `Health at the end: ${JSON.stringify(outcome.health?.supervisor ?? null)}`,
    '',
    'Promoted commits:',
    ...commits.map((c) => `- ${c.sha} ${String(c.message).split('\n')[0]}`),
  ];
  let revert = null;
  let note = '';
  if (outcome.state === 'failed' && !outcome.known) {
    const held = commits.filter((c) => isRevert(c.message));
    if (held.length) note = `No revert opened: the range holds a revert (${held.map((c) => short(c.sha)).join(', ')}).`;
    else {
      const title = `promote: revert ${commits.length === 1 ? short(sha) : `${commits.length} commits ${short(commits[0].sha)}..${short(sha)}`} after production rolled back`;
      const message = [title, '', ...commits.map((c) => `This reverts commit ${c.sha}.`), '', 'No-changelog: automatic revert of a promotion that production rolled back'].join('\n');
      try {
        revert = await io.openRevert({ branch: `promote/revert-${short(sha)}`, shas: commits.map((c) => c.sha), title, body: [...lines, '', 'Production stays on the failed commit and serves its rollback; this revert lands on main and promotes forward.'].join('\n'), message });
      } catch (error) { note = `Revert PR not opened: ${error.message}`; }
    }
  } else if (outcome.state === 'timeout') note = 'No revert opened: the watch never finished, so the commit is not known bad.';
  const prLine = revert?.html_url ? `Revert PR: ${revert.html_url}` : note;
  const issue = await io.fileIssue({ name: issueName(sha), description: [...lines, '', prLine, '', 'Fix shape: reproduce on dev with the promoted commit, land the fix as a new PR; promotion resumes once main carries a commit that reverts or supersedes it with CI gate and dev-soak success.', '', `Filed by the promote workflow, ${new Date().toISOString().slice(0, 10)}.`].join('\n') });
  await io.alert(`weave promote: production rejected ${short(sha)} (${outcome.why}); ${prLine}${issue?.url ? `; Issue ${issue.url}` : ''}`);
  return { action: 'failed', sha, from, reason: outcome.why, revert, issue };
}

export function realIO(env = process.env, { cwd = process.cwd() } = {}) {
  const repo = env.GITHUB_REPOSITORY || REPO;
  const base = `repos/${repo}`;
  const run = (cmd, args, extra = {}) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 64 * 1024 * 1024, ...extra }).trim();
  const api = (path) => JSON.parse(run('gh', ['api', path]));
  const optional = (path) => { try { return api(path); } catch (error) { if (/HTTP 404/.test(String(error.stderr))) return null; throw error; } };
  const sheriff = sheriffIO(env, { cwd });
  return {
    log: (line) => console.log(line),
    production: async () => optional(`${base}/branches/${BRANCH}`)?.commit?.sha ?? null,
    range: async (from, to = 'main') => {
      const first = api(`${base}/compare/${from}...${to}?per_page=100&page=1`);
      const commits = [...first.commits];
      for (let page = 2; commits.length < first.total_commits && page <= 20; page++) commits.push(...api(`${base}/compare/${from}...${to}?per_page=100&page=${page}`).commits);
      if (commits.length !== first.total_commits) throw new Error(`compare ${short(from)}...${to} returned ${commits.length} of ${first.total_commits} commits`);
      return { status: first.status, commits: commits.map((c) => ({ sha: c.sha, message: c.commit.message })) };
    },
    gate: async (sha) => {
      let seen = null;
      for (const r of api(`${base}/actions/workflows/test.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=20`).workflow_runs) {
        const gate = api(`${base}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`).jobs.find((j) => j.name === 'CI gate');
        if (gate?.conclusion === 'success') return 'success';
        seen ??= gate?.conclusion ?? null;
      }
      return seen;
    },
    soak: async (sha) => {
      const status = api(`${base}/commits/${sha}/status`).statuses.find((s) => s.context === SOAK)?.state;
      if (status) return status;
      return api(`${base}/commits/${sha}/check-runs?check_name=${SOAK}&filter=latest`).check_runs[0]?.conclusion ?? null;
    },
    health: async () => {
      const r = await fetch(`${PROD}/api/health`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    push: async (sha) => {
      if (!env.PROMOTION_DEPLOY_KEY) throw new Error('PROMOTION_DEPLOY_KEY is not set');
      const dir = mkdtempSync(join(tmpdir(), 'promote-'));
      try {
        writeFileSync(join(dir, 'key'), `${env.PROMOTION_DEPLOY_KEY.trim()}\n`, { mode: 0o600 });
        writeFileSync(join(dir, 'known_hosts'), `${GITHUB_HOST_KEY}\n`);
        const ssh = `ssh -i ${join(dir, 'key')} -o IdentitiesOnly=yes -o UserKnownHostsFile=${join(dir, 'known_hosts')} -o StrictHostKeyChecking=yes`;
        console.log(run('git', pushArgs(sha), { env: { ...env, GIT_SSH_COMMAND: ssh } }));
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
    check: async () => {
      if (!env.PROD_DEPLOY_TOKEN) throw new Error('PROD_DEPLOY_TOKEN is not set');
      const r = await fetch(`${PROD}/_supervisor/check`, { method: 'POST', headers: { authorization: `Bearer ${env.PROD_DEPLOY_TOKEN}` }, signal: AbortSignal.timeout(300_000) });
      const body = await r.json().catch(() => ({}));
      return r.ok ? body : { error: `HTTP ${r.status}`, ...body };
    },
    openRevert: (spec) => sheriff.openRevert(spec),
    fileIssue: (spec) => sheriff.fileIssue(spec),
    alert: (line) => sheriff.alert(line),
  };
}

function output(env, values) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v ?? ''}\n`).join(''));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${Object.entries(values).map(([k, v]) => `${k}: ${v ?? ''}`).join('\n')}\n`);
}

async function main(env = process.env) {
  const io = realIO(env);
  const self = env.GITHUB_RUN_ID ? `https://github.com/${env.GITHUB_REPOSITORY || REPO}/actions/runs/${env.GITHUB_RUN_ID}` : undefined;
  if (process.argv[2] === 'select') {
    const out = await select(io, { paused: env.PROMOTION_PAUSED === 'true', event: env.PROMOTION_EVENT, everyHours: Number(env.PROMOTION_EVERY_HOURS || 2) });
    console.log(JSON.stringify(out));
    const dry = env.PROMOTION_DRY_RUN === 'true';
    output(env, { sha: out.action === 'promote' && !dry ? out.sha : '', from: out.from, pick: out.sha, reason: out.reason ?? (dry ? 'dry run' : 'promote') });
    return;
  }
  if (process.argv[2] === 'promote') {
    if (env.PROMOTION_PAUSED === 'true') { console.log('PROMOTION_PAUSED is true'); return; }
    if (!/^[0-9a-f]{40}$/.test(env.SHA ?? '') || !/^[0-9a-f]{40}$/.test(env.FROM ?? '')) throw new Error('Expected SHA and FROM as full commit SHAs');
    const out = await promote(io, { sha: env.SHA, from: env.FROM }, { self });
    console.log(JSON.stringify({ ...out, health: out.health?.supervisor }));
    output(env, { result: out.action, sha: out.sha, reason: out.reason });
    if (out.action !== 'promoted') process.exitCode = 1;
    return;
  }
  throw new Error('usage: node scripts/promote.mjs select|promote');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
