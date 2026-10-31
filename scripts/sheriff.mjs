import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO = 'grunion-ai/weave';
export const BISECT_CAP = 4;
export const WORKFLOW = '.github/workflows/test.yml';
export const BRANCH_PREFIX = 'sheriff/revert-';
export const TRACKER = 'https://weave.grunion.ai/w/weave';
const BOT = ['-c', 'user.name=weave-sheriff', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];

export const short = (sha) => String(sha).slice(0, 10);
export const subjectOf = (message = '') => String(message).split('\n')[0];
export const probeTitle = (sha) => `tests at ${sha}`;

export function isRevert(message = '') {
  const subject = subjectOf(message);
  return /^revert\b/i.test(subject) || /^sheriff: revert\b/i.test(subject) || /This reverts commit [0-9a-f]{7,40}/.test(message);
}

export function eligible(run, repo = REPO) {
  if (run.name !== 'tests' || String(run.path ?? '').split('@')[0] !== WORKFLOW) return 'not the tests workflow';
  if (run.event !== 'push' || run.head_branch !== 'main') return 'not a main push';
  if (run.head_repository?.full_name !== repo) return 'not this repository';
  if (run.status !== 'completed') return 'not a completed run';
  if (run.conclusion !== 'failure') return `conclusion ${run.conclusion} is no signal`;
  if (!/^[0-9a-f]{40}$/.test(run.head_sha ?? '')) return 'no head commit';
  return null;
}

export function rerunVerdict(gate) {
  return gate === 'success' || gate === 'failure' ? gate : 'unknown';
}

export function gateVerdict(jobs = []) {
  const gate = jobs.find((j) => j.name === 'CI gate')?.conclusion ?? null;
  const shards = jobs.filter((j) => j.name !== 'CI gate');
  return gate === 'failure' && !shards.some((j) => j.conclusion === 'failure') && shards.some((j) => j.conclusion === 'cancelled') ? 'cancelled' : gate;
}

export const flakeName = (file) => `Error: ${file} flakes on main`;

export function nextProbe(lo, hi) {
  return hi - lo > 1 ? Math.floor((lo + hi) / 2) : null;
}

export function revertBranch(culprits) {
  const first = short(culprits[0].sha);
  return culprits.length === 1 ? `${BRANCH_PREFIX}${first}` : `${BRANCH_PREFIX}${first}-${short(culprits.at(-1).sha)}`;
}

export function culpritsOf(body = '') {
  return [...String(body).matchAll(/^Sheriff-Culprit: ([0-9a-f]{40})$/gm)].map((m) => m[1]);
}

export function failingFiles(results) {
  const last = new Map();
  for (const result of [...results].sort((a, b) => Number(a.attempt ?? 1) - Number(b.attempt ?? 1))) {
    for (const s of result.summaries ?? []) if (s.file) last.set(s.file, s.success === false || s.counts?.failed > 0);
  }
  return [...last].filter(([, failed]) => failed).map(([file]) => file).sort();
}

const prList = (prs) => prs.length > 3 ? `${prs.slice(0, 3).map((p) => `#${p.number}`).join(', ')} and ${prs.length - 3} more` : prs.map((p) => `#${p.number}`).join(', ');

export function issueName({ files, prs, culprits, run }) {
  const test = files[0] ?? 'the tests suite';
  const more = files.length > 1 ? ` (+${files.length - 1} more)` : '';
  const after = prs.length === 1 ? `PR #${prs[0].number}` : prs.length ? `PRs ${prList(prs)}` : `commit ${short(culprits[0]?.sha ?? run.head_sha)}`;
  return `Error: ${test}${more} fails on main after ${after}`;
}

export function revertTitle({ culprits, prs, probes = [] }) {
  const what = culprits.length === 1 ? short(culprits[0].sha) : `${culprits.length} commits ${short(culprits[0].sha)}..${short(culprits.at(-1).sha)}`;
  const unprobed = probes.length ? '' : ` (${culprits.length} commit${culprits.length === 1 ? '' : 's'} in range, no bisect probe)`;
  return `sheriff: revert ${what}${prs.length ? ` (PR ${prList(prs)})` : ''} after main went red${unprobed}`;
}

function evidence(ctx) {
  const { run, files, jobs, probes, base, commits, culprits, prs } = ctx;
  const lines = [
    `Red run: ${run.html_url} (head ${short(run.head_sha)})`,
    `Rerun of the failed jobs: ${run.html_url}/attempts/2`,
    ...probes.map((p) => `Bisect probe ${short(p.sha)}: ${p.conclusion} ${p.url}`),
    `Last green main: ${base.sha ? `${short(base.sha)} ${base.url}` : 'none found'}`,
    `Range: ${commits.length} commit(s) since the last green run; ${culprits.length === 1 ? 'one culprit' : `${culprits.length} suspects left`}`,
    '',
    'Failing tests:',
    ...(files.length ? files.map((f) => `- ${f}`) : ['- none recorded in the shard results']),
    '',
    'Failed jobs:',
    ...(jobs.length ? jobs.map((j) => `- ${j.name} ${j.html_url}`) : ['- none listed']),
    '',
    'Culprit commits:',
    ...culprits.map((c) => `- ${c.sha} ${subjectOf(c.message)}`),
    '',
    `Original PR: ${prs.length ? prs.map((p) => `#${p.number} ${p.html_url}`).join(', ') : 'none found'}`,
  ];
  return lines.join('\n');
}

export function revertBody(ctx) {
  return [
    `The tests workflow went red on main and stayed red after a rerun of its failed jobs. The sheriff reverts ${ctx.culprits.length === 1 ? 'the commit that broke it' : 'the commits it could not separate within the bisect cap'}; the fix lands as a new PR.`,
    '',
    evidence(ctx),
    '',
    ...ctx.culprits.map((c) => `Sheriff-Culprit: ${c.sha}`),
    `Sheriff-Run: ${ctx.run.id}`,
  ].join('\n');
}

export function revertMessage(ctx) {
  return [
    revertTitle(ctx),
    '',
    ...ctx.culprits.map((c) => `This reverts commit ${c.sha}.`),
    '',
    `Sheriff-Run: ${ctx.run.id}`,
    'No-changelog: sheriff revert of a commit that turned main red',
  ].join('\n');
}

export function prComment(ctx, revert) {
  return [
    `Main went red after this PR landed and stayed red after a rerun. ${revert?.html_url ? `Revert: ${revert.html_url}.` : 'No revert was opened; the details are below.'} Land the fix as a new PR.`,
    '',
    evidence(ctx),
  ].join('\n');
}

export function issueDescription(ctx, revert, note) {
  return [
    `The sheriff found main red on ${ctx.run.html_url} and it stayed red after a rerun of the failed jobs.`,
    note ? `\n${note}` : '',
    revert?.html_url ? `Revert PR: ${revert.html_url}` : 'No revert PR was opened.',
    '',
    evidence(ctx),
    '',
    'Fix shape: reproduce with `npm test -- --targeted <file>` on the culprit commit, fix, and land the fix with the original change as a new PR.',
    '',
    `Filed by the sheriff, run ${ctx.self ?? ctx.run.id}, ${new Date().toISOString().slice(0, 10)}.`,
  ].join('\n');
}

export function alertLine(ctx, outcome) {
  return `weave sheriff: main red at ${short(ctx.run.head_sha)} (${ctx.run.html_url}); ${outcome}`;
}

export function outcomeExitCode(outcome, { dryRun = false } = {}) {
  return !dryRun && (outcome.action === 'escalate' || (outcome.action === 'revert' && outcome.revert?.armed === false)) ? 1 : 0;
}

export async function sheriff(runId, io, { cap = BISECT_CAP, dryRun = false } = {}) {
  const run = await io.run(runId);
  const result = (action, extra = {}) => { io.log(`${action}: ${extra.reason ?? ''}`.trim()); return { action, run: run.id, ...extra }; };
  const why = eligible(run, io.repo ?? REPO);
  if (why) return result('skip', { reason: why });
  if (Number(run.run_attempt) > 1 && !dryRun) return result('skip', { reason: `attempt ${run.run_attempt} exists; the first attempt's sheriff owns this run` });
  const green = await io.greenAfter(run);
  if (green && !dryRun) return result('skip', { reason: `main went green again at ${short(green.sha)}` });
  if (green) io.log(`main went green again at ${short(green.sha)}; a live sheriff stops here, the dry run goes on`);

  const { files, jobs, cancelled = [] } = await io.failures(run);
  if (!jobs.length && cancelled.length) return result('skip', { reason: `no job failed; ${cancelled.join(', ')} cancelled, which is no signal` });
  if (Number(run.run_attempt) === 1) await io.rerunFailed(run.id);
  let rerun = await io.waitRun(run.id, 2);
  let verdict = rerunVerdict(await io.gate(rerun.id));
  if (verdict === 'unknown') {
    io.log(`the rerun of ${short(run.head_sha)} reached no CI gate verdict; rerunning its failed jobs once more`);
    try {
      await io.rerunFailed(run.id);
      rerun = await io.waitRun(run.id, Number(rerun.run_attempt ?? 2) + 1);
      verdict = rerunVerdict(await io.gate(rerun.id));
    } catch (error) {
      io.log(`the second rerun of ${short(run.head_sha)} could not be read: ${error.message}`);
    }
  }
  if (verdict === 'success') {
    await io.logFlake({ run, files, jobs });
    return result('flake', { reason: `rerun passed; ${files.length ? files.join(', ') : 'no failing file recorded'}`, files });
  }
  if (verdict === 'unknown') return result('skip', { reason: `two reruns of the failed jobs reached no CI gate verdict; the next red main run judges ${short(run.head_sha)}`, files });
  const healed = dryRun ? null : await io.greenAfter(run);
  if (healed) return result('skip', { reason: `main went green at ${short(healed.sha)} while the rerun ran` });

  const base = (await io.lastGreen(run)) ?? {};
  const commits = base.sha ? await io.range(base.sha, run.head_sha) : [];
  const ctx = { run, files, jobs, base, commits, culprits: [], probes: [], prs: [], self: io.self };
  const tracked = files.length ? await io.openFlakes(files) : [];
  if (files.length && tracked.length === files.length) {
    await io.logFlake({ run, files, jobs, stayedRed: true });
    return escalate(io, ctx, result, `every file still red already has ${tracked.length > 1 ? 'open flake rows' : 'an open flake row'} ${tracked.map((t) => `#${t.publicId} (${t.file})`).join(', ')}; the sheriff never convicts a commit for a tracked flake`);
  }
  if (!commits.length) return escalate(io, ctx, result, 'no green main run to bisect from, or no commits since it');

  const held = (await io.openReverts()).find((pr) => pr.shas.some((sha) => commits.some((c) => c.sha === sha)));
  if (held) return result('skip', { reason: `revert PR #${held.number} already covers this range` });

  let lo = -1, hi = commits.length - 1, dispatched = 0, stopped = null;
  for (let mid = nextProbe(lo, hi); mid !== null; mid = nextProbe(lo, hi)) {
    const sha = commits[mid].sha;
    let probe = await io.known(sha);
    if (!probe) {
      if (dispatched >= cap) { stopped = `bisect cap of ${cap} runs reached`; break; }
      dispatched++;
      probe = await io.probe(sha);
      if (!probe) { stopped = `dry run: would dispatch tests at ${sha}`; break; }
    }
    ctx.probes.push({ sha, ...probe });
    if (probe.conclusion === 'success') lo = mid;
    else if (probe.conclusion === 'failure') hi = mid;
    else { stopped = `probe at ${short(sha)} ended ${probe.conclusion}`; break; }
  }
  ctx.culprits = commits.slice(lo + 1, hi + 1);
  ctx.dispatched = dispatched;
  const seen = new Map();
  for (const c of ctx.culprits) for (const pr of await io.pullsFor(c.sha)) seen.set(pr.number, pr);
  ctx.prs = [...seen.values()];
  if (stopped) io.log(stopped);

  const reverts = ctx.culprits.filter((c) => isRevert(c.message));
  if (reverts.length) return escalate(io, ctx, result, `the culprit range holds a revert (${reverts.map((c) => short(c.sha)).join(', ')}); the sheriff never reverts a revert`);

  const cleared = dryRun ? null : await io.greenAfter(run);
  if (cleared) return result('skip', { reason: `main went green at ${short(cleared.sha)} before the revert was opened; ${short(run.head_sha)} is cleared`, culprits: ctx.culprits.map((c) => c.sha) });

  const opened = await io.openRevert({ branch: revertBranch(ctx.culprits), shas: ctx.culprits.map((c) => c.sha), title: revertTitle(ctx), body: revertBody(ctx), message: revertMessage(ctx) });
  if (opened.exists) return result('skip', { reason: `${revertBranch(ctx.culprits)} already exists; this culprit was handled` });
  if (opened.conflict) return escalate(io, ctx, result, `git revert conflicted: ${opened.error}`);
  if (opened.refused) return escalate(io, ctx, result, `revert branch ${opened.branch} is pushed but GitHub refused its PR (${opened.refused}); open it from ${opened.compare}`);
  return report(io, ctx, result, opened, `revert PR ${opened.html_url ?? opened.branch}${opened.armed === false ? ' (auto-merge not armed: SHERIFF_TOKEN missing)' : ''}`, 'revert');
}

async function escalate(io, ctx, result, reason) {
  return report(io, ctx, result, null, `needs a human: ${reason}`, 'escalate', reason);
}

async function report(io, ctx, result, revert, outcome, action, note) {
  for (const pr of ctx.prs) await io.comment(pr.number, prComment(ctx, revert));
  const issue = await io.fileIssue({ name: issueName(ctx), description: issueDescription(ctx, revert, note) });
  await io.alert(alertLine(ctx, outcome + (issue?.url ? `; Issue ${issue.url}` : '')));
  return result(action, { reason: outcome, culprits: ctx.culprits.map((c) => c.sha), prs: ctx.prs.map((p) => p.number), probes: ctx.probes, revert, issue });
}

export function alertRequest(env, line) {
  return { method: 'POST', body: line, headers: env.SHERIFF_ALERT_TOKEN ? { Authorization: `Bearer ${env.SHERIFF_ALERT_TOKEN}` } : {}, signal: AbortSignal.timeout(10_000) };
}
export function pushArgs(branch) {
  return ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'push', 'origin', `HEAD:refs/heads/${branch}`];
}

export function realIO(env = process.env, { cwd = process.cwd(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const repo = env.GITHUB_REPOSITORY || REPO;
  const base = `repos/${repo}`;
  const readToken = env.GH_TOKEN;
  const writeToken = env.SHERIFF_TOKEN || env.GH_TOKEN;
  const workflowRef = env.SHERIFF_WORKFLOW_REF || 'main';
  const run = (cmd, args, { token = readToken, input } = {}) => execFileSync(cmd, args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 300_000, maxBuffer: 256 * 1024 * 1024, env: { ...env, GH_TOKEN: token } }).trim();
  const api = (path, { method = 'GET', body, token } = {}) => {
    const out = run('gh', ['api', '-X', method, path, ...(body ? ['--input', '-'] : [])], { token, input: body ? JSON.stringify(body) : undefined });
    return out ? JSON.parse(out) : null;
  };
  const runs = (query) => api(`${base}/actions/workflows/test.yml/runs?${query}`).workflow_runs;
  const gate = (id) => gateVerdict(api(`${base}/actions/runs/${id}/jobs?filter=latest&per_page=100`).jobs);
  const waitRun = async (id, attempt, minutes = 75) => {
    const deadline = Date.now() + minutes * 60_000;
    for (;;) {
      const r = api(`${base}/actions/runs/${id}`);
      if (r.status === 'completed' && Number(r.run_attempt) >= attempt) return r;
      if (Date.now() > deadline) throw new Error(`run ${id} did not complete attempt ${attempt} in ${minutes} minutes`);
      await sleep(30_000);
    }
  };
  const tracker = async (path, init = {}) => {
    const res = await fetch(`${(env.WEAVE_TRACKER_URL || TRACKER).replace(/\/$/, '')}/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.WEAVE_TRACKER_TOKEN}` }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`tracker ${path}: HTTP ${res.status}`);
    return res.json();
  };
  const upsertIssue = async ({ name, description, severity, line }) => {
    if (!env.WEAVE_TRACKER_TOKEN) throw new Error(`WEAVE_TRACKER_TOKEN missing; not filed: ${name}`);
    const open = (await tracker('/tables/Issue/query', { method: 'POST', body: JSON.stringify({ where: [['Name', '=', name], ['Status', '=', 'Open']] }) })).items ?? [];
    if (open[0]) {
      await tracker(`/entities/${open[0].id}/doc`, { method: 'POST', body: JSON.stringify({ doc: `\n\n${line ?? description}` }) });
      return { id: open[0].id, publicId: open[0].publicId, url: `${env.WEAVE_TRACKER_URL || TRACKER}/e/${open[0].id}`, appended: true };
    }
    const row = await tracker('/tables/Issue/entities', { method: 'POST', body: JSON.stringify({ Name: name, Severity: severity, Symptom: ['Error'], Description: description }) });
    return { id: row.id, publicId: row.publicId, url: `${env.WEAVE_TRACKER_URL || TRACKER}/e/${row.id}` };
  };
  const pushRevert = ({ branch, shas, message }) => {
    run('git', ['fetch', '--quiet', 'origin', 'main']);
    run('git', ['switch', '--quiet', '-C', branch, 'origin/main']);
    try { run('git', [...BOT, 'revert', '--no-commit', ...[...shas].reverse()]); }
    catch (error) { try { run('git', ['revert', '--abort']); } catch {} return { conflict: true, error: String(error.stderr || error.message).split('\n')[0] }; }
    run('git', [...BOT, 'commit', '--quiet', '-F', '-'], { input: message });
    try { run('git', pushArgs(branch), { token: writeToken }); }
    catch (error) { if (/\(fetch first\)|\(non-fast-forward\)|already exists/.test(String(error.stderr))) return { exists: true, branch }; throw error; }
    return null;
  };
  return {
    repo,
    self: env.GITHUB_RUN_ID ? `https://github.com/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : undefined,
    log: (line) => console.log(line),
    run: async (id) => api(`${base}/actions/runs/${id}`),
    gate: async (id) => gate(id),
    waitRun,
    rerunFailed: async (id) => api(`${base}/actions/runs/${id}/rerun-failed-jobs`, { method: 'POST' }),
    greenAfter: async (r) => {
      const g = runs('branch=main&event=push&status=success&per_page=30').find((g) => g.created_at > r.created_at && g.head_sha !== r.head_sha);
      return g ? { sha: g.head_sha, url: g.html_url } : null;
    },
    lastGreen: async (r) => {
      for (let page = 1; page <= 3; page++) {
        const hit = runs(`branch=main&event=push&status=success&per_page=100&page=${page}`).find((g) => g.created_at < r.created_at && gate(g.id) === 'success');
        if (hit) return { sha: hit.head_sha, url: hit.html_url };
      }
      return null;
    },
    range: async (from, to) => {
      const cmp = api(`${base}/compare/${from}...${to}?per_page=250`);
      if (cmp.status !== 'ahead' || cmp.total_commits !== cmp.commits.length) throw new Error(`compare ${short(from)}...${short(to)} is ${cmp.status} with ${cmp.total_commits} commits`);
      return cmp.commits.map((c) => ({ sha: c.sha, message: c.commit.message }));
    },
    failures: async (r) => {
      const all = api(`${base}/actions/runs/${r.id}/attempts/1/jobs?per_page=100`).jobs.filter((j) => j.name !== 'CI gate');
      const jobs = all.filter((j) => j.conclusion === 'failure').map((j) => ({ name: j.name, html_url: j.html_url }));
      const cancelled = all.filter((j) => j.conclusion === 'cancelled').map((j) => j.name);
      const dir = mkdtempSync(join(tmpdir(), 'sheriff-'));
      try {
        try { run('gh', ['run', 'download', String(r.id), '-R', repo, '-p', 'ci-*', '-D', dir]); } catch {}
        const results = [];
        const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.json')) { try { results.push(JSON.parse(readFileSync(p, 'utf8'))); } catch {} } } };
        walk(dir);
        return { jobs, cancelled, files: failingFiles(results) };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
    openReverts: async () => api(`${base}/pulls?state=open&per_page=100`).filter((p) => p.head.ref.startsWith(BRANCH_PREFIX)).map((p) => ({ number: p.number, shas: culpritsOf(p.body) })),
    known: async (sha) => {
      const done = [...runs(`head_sha=${sha}&event=push&status=completed&per_page=20`), ...runs('event=workflow_dispatch&status=completed&per_page=100').filter((d) => d.display_title === probeTitle(sha))];
      for (const r of done) { const g = gate(r.id); if (g === 'success' || g === 'failure') return { conclusion: g, url: r.html_url }; }
      return null;
    },
    probe: async (sha) => {
      let id = runs('event=workflow_dispatch&per_page=100').find((d) => d.display_title === probeTitle(sha) && d.status !== 'completed')?.id;
      if (!id) {
        const since = new Date(Date.now() - 60_000).toISOString();
        const answer = api(`${base}/actions/workflows/test.yml/dispatches`, { method: 'POST', body: { ref: workflowRef, inputs: { ref: sha }, return_run_details: true } });
        id = answer?.workflow_run_id;
        for (let i = 0; !id && i < 20; i++) {
          await sleep(15_000);
          id = runs('event=workflow_dispatch&per_page=50').find((d) => d.display_title === probeTitle(sha) && d.created_at >= since)?.id;
        }
        if (!id) throw new Error(`dispatched tests at ${sha} but found no run`);
      }
      const r = await waitRun(id, 1);
      return { conclusion: gate(id) ?? r.conclusion, url: r.html_url };
    },
    pullsFor: async (sha) => api(`${base}/commits/${sha}/pulls`).filter((p) => p.merged_at).map((p) => ({ number: p.number, html_url: p.html_url, title: p.title })),
    openRevert: async ({ branch, shas, title, body, message }) => {
      let pushed = false;
      try { run('git', ['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`]); pushed = true; } catch {}
      if (pushed && api(`${base}/pulls?state=all&head=${repo.split('/')[0]}:${branch}`).length) return { exists: true, branch };
      if (!pushed) {
        const made = pushRevert({ branch, shas, message });
        if (made) return made;
      }
      let pr;
      try { pr = api(`${base}/pulls`, { method: 'POST', token: writeToken, body: { title, head: branch, base: 'main', body } }); }
      catch (error) { return { refused: String(error.stderr || error.message).trim().split('\n').at(-1), branch, compare: `https://github.com/${repo}/compare/main...${branch}` }; }
      const armed = Boolean(env.SHERIFF_TOKEN);
      if (armed) run('gh', ['pr', 'merge', String(pr.number), '-R', repo, '--auto', '--squash', '--subject', title, '--body', message.split('\n').slice(2).join('\n')], { token: writeToken });
      return { number: pr.number, html_url: pr.html_url, branch, armed };
    },
    comment: async (number, text) => api(`${base}/issues/${number}/comments`, { method: 'POST', token: writeToken, body: { body: text } }),
    fileIssue: async ({ name, description }) => upsertIssue({ name, description, severity: 'High' }),
    openFlakes: async (files) => {
      if (!env.WEAVE_TRACKER_TOKEN) throw new Error('WEAVE_TRACKER_TOKEN missing; cannot read the flake rows');
      const found = [];
      for (const file of files) {
        const row = (await tracker('/tables/Issue/query', { method: 'POST', body: JSON.stringify({ where: [['Name', '=', flakeName(file)], ['Status', '=', 'Open']] }) })).items?.[0];
        if (row) found.push({ file, publicId: row.publicId });
      }
      return found;
    },
    logFlake: async ({ run: r, files, jobs, stayedRed = false }) => {
      const names = files.length ? files : jobs.map((j) => j.name);
      const line = `${new Date().toISOString().slice(0, 10)} ${short(r.head_sha)} ${stayedRed ? 'failed and stayed red after a rerun; the sheriff escalated instead of reverting' : 'failed, then passed on rerun'}: ${r.html_url}`;
      for (const name of names.length ? names : ['the tests suite']) {
        await upsertIssue({ name: flakeName(name), severity: 'Low', line, description: `Flake log kept by the sheriff. Each line is a main run whose failed jobs passed on one rerun.\n\n${line}` });
      }
    },
    alert: async (line) => {
      console.log(`::warning::${line}`);
      if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
      if (env.SHERIFF_ALERT_URL) await fetch(env.SHERIFF_ALERT_URL, alertRequest(env, line)).catch((e) => console.log(`alert post failed: ${e.message}`));
    },
  };
}

export function dryIO(io) {
  const say = (what) => async (...args) => { io.log(`dry run, would ${what}: ${JSON.stringify(args).slice(0, 400)}`); };
  return {
    ...io,
    rerunFailed: say('rerun failed jobs'),
    waitRun: async (id) => io.run(id),
    probe: async () => null,
    openFlakes: async (files) => { try { return await io.openFlakes(files); } catch (error) { io.log(`dry run could not read the flake rows: ${error.message}`); return []; } },
    openRevert: async (spec) => { io.log(`dry run, would open ${spec.branch}: ${spec.title}\n${spec.body}`); return { branch: spec.branch, dryRun: true }; },
    comment: say('comment on PR'),
    fileIssue: async (spec) => { io.log(`dry run, would file Issue: ${spec.name}`); return null; },
    logFlake: say('log a flake'),
    alert: async (line) => io.log(`dry run, would alert: ${line}`),
  };
}

async function main() {
  const runId = process.env.SHERIFF_RUN_ID || process.argv[2];
  if (!/^\d+$/.test(runId ?? '')) throw new Error('Expected SHERIFF_RUN_ID or a run id argument');
  const dryRun = process.env.SHERIFF_DRY_RUN === '1' || process.argv.includes('--dry-run');
  const io = realIO();
  try {
    const outcome = await sheriff(runId, dryRun ? dryIO(io) : io, { dryRun });
    console.log(JSON.stringify(outcome, null, 2));
    process.exitCode = outcomeExitCode(outcome, { dryRun });
  } catch (error) {
    if (!dryRun) await io.alert(`weave sheriff: failed on run https://github.com/${io.repo}/actions/runs/${runId}: ${error.message}${io.self ? ` (${io.self})` : ''}`);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
