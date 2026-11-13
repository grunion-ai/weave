import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { select, promote, verdict, revertsCommit, due, pushArgs, issueName, lagLine, realIO } from '../scripts/promote.mjs';

const sha = (n) => n.toString(16).padStart(40, '0');
const commit = (n, message = `change ${n} (#${n})`) => ({ sha: sha(n), message });
const live = (n, watch = { ok: true }, swap = {}) => ({ ok: true, supervisor: { commit: sha(n), release: `c${sha(n)}`, failed: [], lastSwap: { ok: true, to: `c${sha(n)}`, from: 'cold', ...swap }, watch: { release: `c${sha(n)}`, until: '2026-10-13T10:10:00Z', ...watch } } });
const at = (hour) => new Date(Date.UTC(2026, 9, 13, hour, 23));

function fake({ promotedAt = null, head = sha(1), status = 'ahead', commits = [], gates = {}, soaks = {}, health = [live(1)], hook = { action: 'swapped' }, revert = { number: 600, html_url: 'https://github.com/grunion-ai/weave/pull/600' } } = {}) {
  const reads = [];
  const writes = [];
  let h = 0;
  const io = {
    log: () => {},
    lastPromotion: async () => { reads.push('lastPromotion'); return promotedAt; },
    production: async () => { reads.push('production'); return head; },
    range: async (base, tip = 'main') => {
      reads.push(['range', base, tip]);
      if (tip === 'main') return { status, commits };
      return { status: 'ahead', commits: commits.slice(0, commits.findIndex((c) => c.sha === tip) + 1) };
    },
    gate: async (s) => { reads.push(['gate', s]); return gates[s] ?? null; },
    soak: async (s) => { reads.push(['soak', s]); return soaks[s] ?? null; },
    health: async () => health[Math.min(h++, health.length - 1)],
    push: async (s) => { writes.push(['push', s]); head = s; },
    check: async () => { writes.push(['check']); return hook; },
    openRevert: async (spec) => { writes.push(['revert', spec]); return revert; },
    fileIssue: async (spec) => { writes.push(['issue', spec]); return { url: 'https://weave.grunion.ai/w/weave/e/x' }; },
    alert: async (line) => writes.push(['alert', line]),
  };
  return { io, reads, writes, kinds: () => writes.map((w) => w[0]) };
}

const opts = (extra = {}) => ({ now: at(10), event: 'workflow_dispatch', everyHours: 2, ...extra });
const fast = { pollMs: 0, deadlineMs: 60_000, sleep: async () => {} };

test('the newest main commit with both CI gate and dev-soak success is picked', async () => {
  const commits = [2, 3, 4, 5].map((n) => commit(n));
  const f = fake({ commits, gates: { [sha(2)]: 'success', [sha(3)]: 'success', [sha(4)]: 'success', [sha(5)]: 'success' }, soaks: { [sha(2)]: 'success', [sha(3)]: 'success', [sha(5)]: 'pending' } });
  const out = await select(f.io, opts());
  assert.equal(out.action, 'promote');
  assert.equal(out.sha, sha(3));
  assert.equal(out.from, sha(1));
  assert.deepEqual(f.writes, []);
});

test('a commit needs both checks: gate alone, soak alone or neither is never promoted', async () => {
  const commits = [2, 3, 4].map((n) => commit(n));
  const f = fake({ commits, gates: { [sha(4)]: 'success', [sha(2)]: 'failure', [sha(3)]: null }, soaks: { [sha(2)]: 'success', [sha(3)]: 'success', [sha(4)]: 'failure' } });
  const out = await select(f.io, opts());
  assert.equal(out.action, 'skip');
  assert.match(out.reason, /CI gate and dev-soak/);
});

test('nothing newer than production exits quietly', async () => {
  const f = fake({ status: 'identical' });
  const out = await select(f.io, opts());
  assert.equal(out.action, 'skip');
  assert.match(out.reason, /already at main/);
});

test('a production head that main does not descend from is refused', async () => {
  for (const status of ['diverged', 'behind']) {
    await assert.rejects(select(fake({ status, commits: [commit(2)] }).io, opts()), /not an ancestor of main/);
  }
  await assert.rejects(select(fake({ head: null }).io, opts()), /no production branch/);
});

test('PROMOTION_PAUSED stops promotion before anything is read', async () => {
  const f = fake({ commits: [commit(2)], gates: { [sha(2)]: 'success' }, soaks: { [sha(2)]: 'success' } });
  const out = await select(f.io, opts({ paused: true }));
  assert.equal(out.action, 'skip');
  assert.match(out.reason, /PROMOTION_PAUSED/);
  assert.deepEqual(f.reads, []);
});

test('a scheduled run acts once the last promotion is a batch old, however late GitHub delivers it; a dispatch always acts', async () => {
  const hoursAgo = (h, now = at(11)) => new Date(now.getTime() - h * 3_600_000);
  assert.equal(due(at(11), null, 2), true);
  assert.equal(due(at(11), hoursAgo(2), 2), true);
  assert.equal(due(at(11), hoursAgo(1.6), 2), true, 'an hourly cron that drifts a few minutes still lands every batch');
  assert.equal(due(at(11), hoursAgo(1), 2), false);
  assert.equal(due(at(11), hoursAgo(0.6), 1), true);
  assert.equal(due(at(11), hoursAgo(0.2), 1), false);
  const ready = { commits: [commit(2)], gates: { [sha(2)]: 'success' }, soaks: { [sha(2)]: 'success' } };
  const recent = fake({ ...ready, promotedAt: hoursAgo(1) });
  const out = await select(recent.io, opts({ event: 'schedule', now: at(11) }));
  assert.equal(out.action, 'skip');
  assert.match(out.reason, /last promotion .* 2-hour batch/);
  assert.deepEqual(recent.reads, ['lastPromotion']);
  const late = fake({ ...ready, promotedAt: hoursAgo(9) });
  assert.equal((await select(late.io, opts({ event: 'schedule', now: at(11) }))).action, 'promote', 'a run GitHub delivered in an odd hour still promotes');
  const dispatched = fake({ ...ready, promotedAt: hoursAgo(0.1) });
  assert.equal((await select(dispatched.io, opts({ event: 'workflow_dispatch', now: at(11) }))).action, 'promote');
  assert.ok(!dispatched.reads.includes('lastPromotion'), 'a dispatch reads no promotion history');
});

test('a tests or dev-soak completion acts at once like a dispatch, with no batch gate (Issues #1535, #965)', async () => {
  const ready = { commits: [commit(2)], gates: { [sha(2)]: 'success' }, soaks: { [sha(2)]: 'success' } };
  const f = fake({ ...ready, promotedAt: new Date(at(11).getTime() - 360_000) });
  const out = await select(f.io, opts({ event: 'workflow_run', now: at(11) }));
  assert.equal(out.action, 'promote');
  assert.equal(out.sha, sha(2));
  assert.ok(!f.reads.includes('lastPromotion'), 'a completion event reads no promotion history');
});

test('a pick older than one batch carries a lag line for the alert; a fresh pick carries none (Issue #1535)', async () => {
  const dated = (n, hoursAgo) => ({ ...commit(n), at: new Date(at(11).getTime() - hoursAgo * 3_600_000) });
  const checks = { gates: { [sha(2)]: 'success', [sha(3)]: 'success' }, soaks: { [sha(2)]: 'success', [sha(3)]: 'success' } };
  const old = await select(fake({ commits: [dated(2, 9), dated(3, 2.5)], ...checks }).io, opts({ event: 'schedule', now: at(11) }));
  assert.equal(old.sha, sha(3));
  assert.match(old.stale, new RegExp(`production lags ${sha(3).slice(0, 10)} by 2\\.5 hours, more than the 2-hour batch`));
  const fresh = await select(fake({ commits: [dated(2, 9), dated(3, 0.5)], ...checks }).io, opts({ event: 'workflow_run', now: at(11) }));
  assert.equal(fresh.sha, sha(3));
  assert.equal(fresh.stale, undefined);
  const undated = await select(fake({ commits: [commit(2)], ...checks }).io, opts({ now: at(11) }));
  assert.equal(undated.stale, undefined);
  assert.equal(lagLine({ sha: sha(3), at: new Date(at(11).getTime() - 3 * 3_600_000) }, at(11), 1), `weave promote: production lags ${sha(3).slice(0, 10)} by 3.0 hours, more than the 1-hour batch; the tests and dev-soak completion triggers missed it`);
});

test('while prod does not serve the production head, only a range carrying its revert is promoted (Issue #1650)', async () => {
  const bad = sha(1);
  const stuck = { ok: true, supervisor: { commit: sha(0), release: `c${sha(0)}`, failed: [bad], lastSwap: { ok: true, from: `c${bad}`, to: `c${sha(0)}`, rollback: 'x' } } };
  const pick = async (f) => {
    f.io.health = async () => { throw new Error('select never reads prod: it holds no secret'); };
    const out = await select(f.io, opts());
    f.io.health = async () => stuck;
    return out;
  };
  const plain = fake({ commits: [commit(2), commit(3)], gates: { [sha(2)]: 'success', [sha(3)]: 'success' }, soaks: { [sha(2)]: 'success', [sha(3)]: 'success' } });
  const chosen = await pick(plain);
  assert.equal(chosen.sha, sha(3));
  const held = await promote(plain.io, chosen, fast);
  assert.equal(held.action, 'skip');
  assert.match(held.reason, /^prod serves c0{40}, not the production head 0{10}; waiting for a main commit that reverts it$/);
  assert.deepEqual(plain.writes, [], 'a held pick never moves production, calls the hook or alerts');
  const commits = [commit(2), commit(3, `Revert promoted range\n\nThis reverts commit ${bad}.`), commit(4)];
  const freed = fake({ commits, gates: { [sha(2)]: 'success', [sha(3)]: 'success', [sha(4)]: 'failure' }, soaks: { [sha(2)]: 'success', [sha(3)]: 'success', [sha(4)]: 'success' } });
  const revert = await pick(freed);
  assert.equal(revert.sha, sha(3));
  freed.io.health = (() => { const seen = [stuck, live(3)]; return async () => seen.shift() ?? live(3); })();
  assert.equal((await promote(freed.io, revert, fast)).action, 'promoted', 'a range carrying the revert moves production');
  assert.deepEqual(freed.kinds(), ['push', 'check']);
  const early = fake({ commits, gates: { [sha(2)]: 'success' }, soaks: { [sha(2)]: 'success' } });
  const before = await pick(early);
  assert.equal(before.sha, sha(2));
  assert.equal((await promote(early.io, before, fast)).action, 'skip', 'a green commit before the revert still carries the bad change');
  assert.deepEqual(early.writes, []);
});

test('a promotion fast-forwards production, calls the deploy hook and waits for the watch to pass', async () => {
  const pending = live(3, { ok: null });
  const f = fake({ commits: [commit(2), commit(3)], health: [live(1), pending, pending, live(3)] });
  const out = await promote(f.io, { sha: sha(3), from: sha(1) }, fast);
  assert.equal(out.action, 'promoted');
  assert.deepEqual(f.kinds(), ['push', 'check']);
  assert.deepEqual(f.writes[0], ['push', sha(3)]);
  assert.equal(out.health.supervisor.watch.ok, true);
});

test('a promotion that lands while sign-in is broken stays promoted and writes one alert line (Issue #1178)', async () => {
  const broken = { ...live(3), auth: { ok: false } };
  const f = fake({ commits: [commit(2), commit(3)], health: [live(1), broken] });
  const out = await promote(f.io, { sha: sha(3), from: sha(1) }, fast);
  assert.equal(out.action, 'promoted', 'an auth fault is configuration: blocking the promotion would block its fix too');
  assert.deepEqual(f.kinds(), ['push', 'check', 'alert']);
  assert.match(f.writes[2][1], /sign-in is broken: \/api\/health reads auth\.ok false/);
  const fine = fake({ commits: [commit(2), commit(3)], health: [live(1), { ...live(3), auth: { ok: true } }] });
  await promote(fine.io, { sha: sha(3), from: sha(1) }, fast);
  assert.deepEqual(fine.kinds(), ['push', 'check']);
});

test('a watch that fails or a rollback fails the run, files an Issue, alerts and opens a revert of the promoted range', async () => {
  const commits = [commit(2), commit(3), commit(4)];
  const tripped = live(3, { ok: false, reason: '/api/health failed 3 checks in a row' });
  const rolled = { ok: true, supervisor: { commit: sha(1), release: `c${sha(1)}`, failed: [sha(3)], lastSwap: { ok: true, from: `c${sha(3)}`, to: `c${sha(1)}`, rollback: '12 of 20 responses were 5xx' }, watch: { release: `c${sha(3)}`, ok: false } } };
  for (const bad of [tripped, rolled]) {
    const f = fake({ commits, health: [live(1), bad] });
    const out = await promote(f.io, { sha: sha(3), from: sha(1) }, fast);
    assert.equal(out.action, 'failed');
    assert.deepEqual(f.kinds(), ['push', 'check', 'revert', 'issue', 'alert']);
    assert.deepEqual(f.writes.filter((w) => w[0] === 'push').map((w) => w[1]), [sha(3)], 'production only ever moves forward');
    const spec = f.writes[2][1];
    assert.deepEqual(spec.shas, [sha(2), sha(3)]);
    assert.equal(spec.branch, `promote/revert-${sha(3).slice(0, 10)}`);
    assert.match(spec.message, new RegExp(`This reverts commit ${sha(3)}\\.`));
    assert.match(spec.message, /^No-changelog: \S/m);
    const issue = f.writes[3][1];
    assert.equal(issue.name, issueName(sha(3)));
    assert.match(issue.description, /pull\/600/);
    assert.match(f.writes[4][1], /pull\/600/);
  }
});

test('a range holding a revert is escalated without another revert; a failed revert still files and alerts', async () => {
  const commits = [commit(2, `Revert "x"\n\nThis reverts commit ${sha(9)}.`), commit(3)];
  const f = fake({ commits, health: [live(1), live(3, { ok: false, reason: 'worker exited' })] });
  const out = await promote(f.io, { sha: sha(3), from: sha(1) }, fast);
  assert.equal(out.action, 'failed');
  assert.deepEqual(f.kinds(), ['push', 'check', 'issue', 'alert']);
  const g = fake({ commits: [commit(2), commit(3)], health: [live(1), live(3, { ok: false, reason: 'worker exited' })] });
  g.io.openRevert = async () => { throw new Error('push denied'); };
  assert.equal((await promote(g.io, { sha: sha(3), from: sha(1) }, fast)).action, 'failed');
  assert.deepEqual(g.kinds(), ['push', 'check', 'issue', 'alert']);
  assert.match(g.writes[2][1].description, /push denied/);
});

test('a timeout or a skipped hook fails visibly without a revert', async () => {
  const slow = fake({ commits: [commit(2)], health: [live(1)] });
  const out = await promote(slow.io, { sha: sha(2), from: sha(1) }, { ...fast, deadlineMs: 0 });
  assert.equal(out.action, 'failed');
  assert.deepEqual(slow.kinds(), ['push', 'check', 'issue', 'alert']);
  const skipped = fake({ commits: [commit(2)], hook: { action: 'skipped', reason: 'failed at boot' } });
  const s = await promote(skipped.io, { sha: sha(2), from: sha(1) }, fast);
  assert.equal(s.action, 'failed');
  assert.match(s.reason, /failed at boot/);
  assert.deepEqual(skipped.kinds(), ['push', 'check', 'issue', 'alert']);
});

test('a stale pick writes its lag line once before production moves (Issue #1535)', async () => {
  const f = fake({ commits: [commit(2), commit(3)], health: [live(1), live(3)] });
  const out = await promote(f.io, { sha: sha(3), from: sha(1), stale: 'weave promote: production lags x' }, fast);
  assert.equal(out.action, 'promoted');
  assert.deepEqual(f.kinds(), ['alert', 'push', 'check']);
  assert.equal(f.writes[0][1], 'weave promote: production lags x');
});

test('production that moved since selection is never pushed', async () => {
  const f = fake({ head: sha(7), commits: [commit(2)] });
  await assert.rejects(promote(f.io, { sha: sha(2), from: sha(1) }, fast), /production moved/);
  assert.deepEqual(f.writes, []);
  const again = fake({ head: sha(2), commits: [commit(2)], health: [live(2)] });
  assert.equal((await promote(again.io, { sha: sha(2), from: sha(1) }, fast)).action, 'promoted');
  assert.deepEqual(again.kinds(), ['check'], 'a rerun after the push resumes at the hook');
});

test('helpers: verdict, revert detection and a push that can only fast-forward', () => {
  assert.equal(verdict(live(3), sha(3)).state, 'passed');
  assert.equal(verdict(live(3, { ok: null }), sha(3)).state, 'pending');
  assert.equal(verdict(live(1), sha(3)).state, 'pending');
  assert.equal(verdict(live(3, { ok: false, reason: 'r' }), sha(3)).state, 'failed');
  assert.equal(verdict({ ok: true, supervisor: { failed: [sha(3)] } }, sha(3)).state, 'failed');
  assert.equal(verdict(undefined, sha(3)).state, 'pending');
  assert.ok(revertsCommit(`x\n\nThis reverts commit ${sha(5)}.`, sha(5)));
  assert.ok(!revertsCommit(`x\n\nThis reverts commit ${sha(6)}.`, sha(5)));
  const args = pushArgs(sha(3));
  assert.deepEqual(args.slice(-1), [`${sha(3)}:refs/heads/production`]);
  assert.ok(!args.some((a) => /^(-f|--force|--force-with-lease|--mirror|--delete|\+)/.test(a) || a.startsWith('+') || a.startsWith(':')));
});

test('promote.yml: tests and dev-soak completions on main, hourly schedule as recovery, plus dispatch, one run at a time (Issue #1535)', () => {
  const yml = readFileSync('.github/workflows/promote.yml', 'utf8');
  assert.match(yml, /^on:\n  workflow_run: # zizmor: ignore\[dangerous-triggers\]\n    workflows: \[tests, dev-soak\]\n    types: \[completed\]\n    branches: \[main\]\n  schedule:\n    - cron: "\d+ \* \* \* \*"\n  workflow_dispatch:/m);
  const selectJob = yml.slice(yml.indexOf('  select:'), yml.indexOf('  promote:'));
  const gate = selectJob.slice(selectJob.indexOf('if:'), selectJob.indexOf('runs-on:'));
  assert.match(gate, /github\.ref == 'refs\/heads\/main'/);
  assert.match(gate, /github\.event_name != 'workflow_run' \|\|/);
  assert.match(gate, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(gate, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(gate, /github\.event\.workflow_run\.head_repository\.full_name == github\.repository/);
  assert.doesNotMatch(yml, /workflow_run\.head_sha/, 'select reads main itself and never trusts the event SHA');
  assert.match(selectJob, /stale: \$\{\{ steps\.select\.outputs\.stale \}\}/);
  assert.match(yml.slice(yml.indexOf('  promote:')), /STALE: \$\{\{ needs\.select\.outputs\.stale \}\}/);
});

test('promote.yml: one run at a time, read-only token, prod secrets only in the production job', () => {
  const yml = readFileSync('.github/workflows/promote.yml', 'utf8');
  assert.match(yml, /group: promotion\n  cancel-in-progress: false/);
  assert.match(yml, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(yml, /: write\s*$/m);
  assert.match(yml, /PROMOTION_PAUSED: \$\{\{ vars\.PROMOTION_PAUSED \}\}/);
  assert.match(yml, /PROMOTION_EVERY_HOURS: \$\{\{ vars\.PROMOTION_EVERY_HOURS \}\}/);
  const selectJob = yml.slice(yml.indexOf('  select:'), yml.indexOf('  promote:'));
  const promoteJob = yml.slice(yml.indexOf('  promote:'));
  assert.doesNotMatch(selectJob, /secrets\.|environment:/);
  assert.match(promoteJob, /environment:\n      name: production\n/);
  for (const s of ['PROD_DEPLOY_TOKEN', 'PROMOTION_DEPLOY_KEY']) assert.match(promoteJob, new RegExp(`secrets\\.${s}`));
  assert.doesNotMatch(yml + readFileSync('scripts/promote.mjs', 'utf8'), /--force|push -f|\+refs\//);
});

test('a tracker write that throws still alerts the rejection and names the tracker failure (Issue #1651)', async () => {
  const f = fake({ commits: [commit(2)], health: [live(1)] });
  f.io.fileIssue = async () => { throw new Error('weave.grunion.ai answered HTTP 503'); };
  const out = await promote(f.io, { sha: sha(2), from: sha(1) }, { ...fast, deadlineMs: 0 });
  assert.equal(out.action, 'failed');
  assert.equal(out.issue, null);
  assert.deepEqual(f.kinds(), ['push', 'check', 'alert']);
  const line = f.writes.at(-1)[1];
  assert.match(line, /production rejected/);
  assert.match(line, /tracker write failed: weave\.grunion\.ai answered HTTP 503/);
});

test('the production health read sends the deploy token header when the job holds the token (Issue #1650)', async () => {
  const was = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push([String(url), init.headers]); return new Response(JSON.stringify({ ok: true, name: 'weave' })); };
  try {
    await realIO({ PROD_DEPLOY_TOKEN: 'p'.repeat(40) }).health();
    await realIO({}).health();
  } finally { globalThis.fetch = was; }
  assert.equal(sent[0][0], 'https://weave.grunion.ai/api/health');
  assert.equal(sent[0][1]['x-weave-deploy-token'], 'p'.repeat(40), 'the supervisor answers its block to the token only');
  assert.equal('x-weave-deploy-token' in sent[1][1], false, 'no token, no header');
});
