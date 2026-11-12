import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sheriff, dryIO, short, eligible, nextProbe, rerunVerdict, gateVerdict, isRevert, revertBranch, culpritsOf, failingFiles, unresolvedFiles, flakeLine, flakeRows, flakeStep, failedStep, revertedRefs, reopenNote, REOPEN, issueName, revertTitle, revertMessage, pushArgs, realIO, outcomeExitCode, BISECT_CAP, timedOutShards } from '../scripts/sheriff.mjs';

const sha = (n) => n.toString(16).padStart(40, '0');
const repo = 'grunion-ai/weave';
const red = (patch = {}) => ({ id: 900, name: 'tests', path: '.github/workflows/test.yml', event: 'push', head_branch: 'main', head_repository: { full_name: repo }, status: 'completed', conclusion: 'failure', run_attempt: 1, head_sha: sha(100), html_url: 'https://github.com/grunion-ai/weave/actions/runs/900', created_at: '2026-10-12T10:00:00Z', ...patch });
const commit = (n, message = `change ${n} (#${n})`) => ({ sha: sha(n), message });

function fake({ run: given, rerunGate = 'failure', commits = [commit(100)], badFrom = null, known = {}, reverts = [], branchExists = false, conflict = false, green = null, files = ['test/grid.test.mjs'], jobs = [{ name: 'tests browser-2', html_url: 'https://github.com/grunion-ai/weave/actions/runs/900/job/1' }], cancelled = [], flakes = {}, unresolved = [], probeRed = null, parent = 'success', parentRed = null, rows = {}, paths = {}, incidents = [], timedOut = [] } = {}) {
  const head = commits.at(-1)?.sha;
  const run = given ?? red({ head_sha: head ?? sha(100) });
  const writes = [];
  const logs = [];
  const index = (s) => commits.findIndex((c) => c.sha === s);
  const io = {
    repo,
    log: (line) => logs.push(line),
    run: async () => run,
    greenAfter: async () => green,
    failures: async () => ({ files, jobs, cancelled, unresolved, timedOut }),
    probeFiles: async (id) => (id === 6999 ? parentRed : null) ?? probeRed ?? files,
    reopenRow: async ({ table, publicId, line }) => {
      const held = rows[`${table}#${publicId}`];
      if (!held || held !== REOPEN[table].from) return null;
      writes.push(['reopen', `${table}#${publicId}`, line]);
      return { table, publicId, from: REOPEN[table].from, to: REOPEN[table].to };
    },
    openFlakes: async (names) => names.filter((n) => flakes[n]).map((n) => ({ file: n, publicId: flakes[n] })),
    rerunFailed: async (id) => writes.push(['rerun', id]),
    waitRun: async (id) => ({ ...run, id, run_attempt: 2 }),
    gate: async () => (Array.isArray(rerunGate) ? (rerunGate.length > 1 ? rerunGate.shift() : rerunGate[0]) : rerunGate),
    lastGreen: async () => ({ sha: sha(1), url: 'https://github.com/grunion-ai/weave/actions/runs/800' }),
    range: async (from, to) => { assert.equal(from, sha(1)); assert.equal(to, head ?? run.head_sha); return commits; },
    openReverts: async () => reverts,
    pathsOf: async (s) => paths[s] ?? ['src/engine.js'],
    openIncidents: async (names) => incidents.filter((i) => names.includes(i.file)),
    appendRow: async (row, line) => { writes.push(['append', row, line]); return { id: row.id, publicId: row.publicId, url: `https://weave.grunion.ai/w/weave/e/${row.id}`, appended: true }; },
    known: async (s) => known[s] ?? null,
    probe: async (s) => { writes.push(['probe', s]); return { conclusion: index(s) < 0 ? parent : index(s) >= badFrom ? 'failure' : 'success', url: `https://github.com/grunion-ai/weave/actions/runs/p${index(s)}`, id: 7000 + index(s) }; },
    pullsFor: async (s) => [{ number: Number.parseInt(s, 16), html_url: `https://github.com/grunion-ai/weave/pull/${Number.parseInt(s, 16)}` }],
    openRevert: async (spec) => { writes.push(['revert', spec]); return branchExists ? { exists: true } : conflict ? { conflict: true, error: 'CONFLICT (content)' } : { number: 500, html_url: 'https://github.com/grunion-ai/weave/pull/500', branch: spec.branch, armed: true }; },
    comment: async (n, body) => writes.push(['comment', n, body]),
    fileIssue: async (spec) => { writes.push(['issue', spec]); return { url: 'https://weave.grunion.ai/w/weave/e/x' }; },
    logFlake: async (spec) => writes.push(['flake', spec]),
    alert: async (line) => writes.push(['alert', line]),
  };
  return { io, writes, logs, kinds: () => writes.map((w) => w[0]) };
}

test('only a failed first-attempt main push run of tests is eligible', () => {
  assert.equal(eligible(red()), null);
  for (const patch of [{ event: 'workflow_dispatch' }, { head_branch: 'feature' }, { conclusion: 'success' }, { conclusion: 'cancelled' }, { status: 'in_progress' }, { name: 'dev' }, { path: '.github/workflows/dev.yml' }, { head_repository: { full_name: 'fork/weave' } }]) {
    assert.ok(eligible(red(patch)), JSON.stringify(patch));
  }
});

test('a main run that ended cancelled, skipped, neutral or any other non-failure is no signal: nothing written, the conclusion logged', async () => {
  for (const conclusion of ['cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale', 'startup_failure', 'success', null]) {
    assert.equal(eligible(red({ conclusion })), `conclusion ${conclusion} is no signal`);
    const f = fake({ run: red({ conclusion, run_attempt: 1 }) });
    const out = await sheriff(900, f.io);
    assert.equal(out.action, 'skip', String(conclusion));
    assert.deepEqual(f.writes, [], String(conclusion));
    assert.ok(f.logs.some((l) => l.includes(`conclusion ${conclusion} is no signal`)), f.logs.join('\n'));
  }
});

test('the 2026-10-28 run, read after its rerun was cancelled, is no signal even when dispatched by hand', async () => {
  const f = fake({ run: red({ id: 40726317119, conclusion: 'cancelled', run_attempt: 2 }) });
  const out = await sheriff(40726317119, f.io, { dryRun: true });
  assert.equal(out.action, 'skip');
  assert.match(out.reason, /conclusion cancelled is no signal/);
  assert.deepEqual(f.writes, []);
});

test('a failed run whose only red jobs were cancelled is no signal: no rerun, no bisect, no revert', async () => {
  const f = fake({ jobs: [], cancelled: ['tests browser-1', 'tests browser-4'], files: [] });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'skip');
  assert.match(out.reason, /no job failed; tests browser-1, tests browser-4 cancelled/);
  assert.deepEqual(f.writes, []);
  const gateOnly = fake({ jobs: [], cancelled: [], files: [] });
  assert.equal((await sheriff(900, gateOnly.io)).action, 'revert');
  const mixed = fake({ cancelled: ['tests browser-4'] });
  assert.equal((await sheriff(900, mixed.io)).action, 'revert');
});

test('a CI gate failure carried only by cancelled shards reads as cancelled, so a rerun or probe it ends gives no verdict', () => {
  const job = (name, conclusion) => ({ name, conclusion });
  assert.equal(gateVerdict([job('plan', 'success'), job('tests browser-1', 'cancelled'), job('tests unit-1', 'success'), job('CI gate', 'failure')]), 'cancelled');
  assert.equal(gateVerdict([job('tests browser-1', 'cancelled'), job('tests browser-2', 'failure'), job('CI gate', 'failure')]), 'failure');
  assert.equal(gateVerdict([job('tests browser-1', 'success'), job('CI gate', 'failure')]), 'failure');
  assert.equal(gateVerdict([job('tests browser-1', 'success'), job('CI gate', 'success')]), 'success');
  assert.equal(gateVerdict([job('tests browser-1', 'cancelled')]), null);
  assert.equal(gateVerdict([]), null);
  assert.equal(rerunVerdict(gateVerdict([job('tests browser-1', 'cancelled'), job('CI gate', 'failure')])), 'unknown');
});

test('a file the in-run retry turned green is not named as failing (Issue #1282)', () => {
  const s = (file, success) => ({ file, success, counts: { failed: success ? 0 : 1 } });
  assert.deepEqual(failingFiles([{ attempt: 1, summaries: [s('test/feedback-budget-browser.test.mjs', false), s('test/vitals-budget-browser.test.mjs', false), s('test/status-browser.test.mjs', false), s('test/feedback-budget-browser.test.mjs', true), s('test/vitals-budget-browser.test.mjs', false), s('test/status-browser.test.mjs', true)] }]), ['test/vitals-budget-browser.test.mjs']);
  assert.deepEqual(failingFiles([{ attempt: 2, summaries: [s('test/a.test.mjs', true)] }, { attempt: 1, summaries: [s('test/a.test.mjs', false)] }]), []);
});

test('a file whose shard died before its retry answered is unresolved, never named as what blocked main (Issue #1282)', () => {
  const s = (file, success) => ({ file, success, counts: { failed: success ? 0 : 1 } });
  const killed = [
    { id: 'browser-1', attempt: 1, code: 0, summaries: [s('test/phone-new-row-sheet-browser.test.mjs', false), s('test/phone-new-row-sheet-browser.test.mjs', true)] },
    { id: 'browser-2', attempt: 1, code: 124, summaries: [s('test/feedback-budget-browser.test.mjs', false), s('test/status-browser.test.mjs', false)] },
    { id: 'browser-4', attempt: 1, code: 1, summaries: [s('test/vitals-budget-browser.test.mjs', false), s('test/vitals-budget-browser.test.mjs', false)] },
  ];
  assert.deepEqual(failingFiles(killed), ['test/vitals-budget-browser.test.mjs']);
  assert.deepEqual(unresolvedFiles(killed), ['test/feedback-budget-browser.test.mjs', 'test/status-browser.test.mjs']);
  assert.deepEqual(unresolvedFiles([{ summaries: [s('test/a.test.mjs', false), s('test/a.test.mjs', false)] }]), []);
  assert.deepEqual(unresolvedFiles([{ summaries: [s('test/a.test.mjs', true)] }]), []);
});

test('a bisect probe red on a different file than the run under investigation is no evidence: escalate, never narrow (Issue #1282)', async () => {
  const f = fake({
    files: ['test/phone-new-row-sheet-browser.test.mjs'],
    commits: [101, 102, 103, 104].map((n) => commit(n)),
    badFrom: 1,
    probeRed: ['test/feedback-budget-browser.test.mjs'],
  });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.ok(!f.kinds().includes('revert'), f.kinds().join(','));
  assert.match(out.reason, /test\/feedback-budget-browser\.test\.mjs/);
  assert.match(out.reason, /test\/phone-new-row-sheet-browser\.test\.mjs/);
  const matching = fake({ files: ['test/grid.test.mjs'], commits: [101, 102, 103, 104].map((n) => commit(n)), badFrom: 1, probeRed: ['test/grid.test.mjs'] });
  assert.equal((await sheriff(900, matching.io)).action, 'revert');
  const unnamed = fake({ files: ['test/grid.test.mjs'], commits: [101, 102, 103, 104].map((n) => commit(n)), badFrom: 1, probeRed: [] });
  assert.equal((await sheriff(900, unnamed.io)).action, 'revert');
});

test('a red held only by files with an open flake row escalates instead of convicting a commit (Issue #1282)', async () => {
  const file = 'test/feedback-budget-browser.test.mjs';
  const f = fake({ files: [file], commits: [101, 102, 103].map((n) => commit(n)), badFrom: 1, flakes: { [file]: 1109 } });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.ok(!f.kinds().includes('revert'), f.kinds().join(','));
  assert.ok(!f.kinds().includes('probe'), f.kinds().join(','));
  assert.deepEqual(f.kinds(), ['rerun', 'flake', 'issue', 'alert']);
  assert.match(out.reason, /open flake row #1109/);
  assert.equal(f.writes.find((w) => w[0] === 'flake')[1].outcome, 'stayed-red');
  assert.match(f.writes.find((w) => w[0] === 'issue')[1].description, /open flake row #1109/);
  const untracked = fake({ files: [file, 'test/grid.test.mjs'], flakes: { [file]: 1109 } });
  assert.equal((await sheriff(900, untracked.io)).action, 'revert');
  const none = fake({ files: [], flakes: { [file]: 1109 } });
  assert.equal((await sheriff(900, none.io)).action, 'revert');
});

test('a red whose only red files never reached a retry verdict escalates instead of convicting a commit (Issue #1322)', async () => {
  const stuck = ['test/feedback-budget-browser.test.mjs', 'test/phone-new-row-sheet-browser.test.mjs'];
  const f = fake({
    files: [],
    unresolved: stuck,
    jobs: [{ name: 'tests browser-4', html_url: 'https://github.com/grunion-ai/weave/actions/runs/900/job/125445590524' }],
    commits: [commit(101), commit(102, 'v0.4.111: 1 fix (#598)')],
    badFrom: 1,
  });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.deepEqual(f.kinds(), ['rerun', 'flake', 'issue', 'alert']);
  assert.deepEqual(out.culprits, []);
  assert.match(out.reason, /no file reached a retry verdict/);
  for (const file of stuck) assert.ok(out.reason.includes(file), out.reason);
  const flake = f.writes.find((w) => w[0] === 'flake')[1];
  assert.deepEqual(flake.files, stuck);
  assert.equal(flake.outcome, 'no-verdict');
  assert.match(f.writes.find((w) => w[0] === 'issue')[1].description, /Red with no retry verdict/);
  const resolved = fake({ files: ['test/grid.test.mjs'], unresolved: stuck, commits: [commit(101), commit(102)], badFrom: 1 });
  assert.equal((await sheriff(900, resolved.io)).action, 'revert');
  const silent = fake({ files: [], unresolved: [], commits: [commit(101), commit(102)], badFrom: 1 });
  assert.equal((await sheriff(900, silent.io)).action, 'revert');
});

test('the flake ledger line names which of the three verdicts the run reached (Issue #1322)', () => {
  const at = '2026-11-02';
  const url = 'https://github.com/grunion-ai/weave/actions/runs/41494395090';
  assert.equal(flakeLine({ at, sha: sha(100), url }), `${at} ${sha(100).slice(0, 10)} failed, then passed on rerun: ${url}`);
  assert.match(flakeLine({ at, sha: sha(100), url, outcome: 'stayed-red' }), /failed and stayed red after a rerun; the sheriff escalated instead of reverting: /);
  assert.match(flakeLine({ at, sha: sha(100), url, outcome: 'no-verdict' }), /failed with no retry verdict, because the shard ended before its retry answered; the sheriff escalated instead of convicting a commit: /);
  assert.throws(() => flakeLine({ at, sha: sha(100), url, outcome: 'green' }), /unknown flake outcome green/);
});

test('the flake ledger line names the step the shard died in, so an install timeout is not read as a test flake (Issue #1353)', () => {
  const at = '2026-11-09';
  const url = 'https://github.com/grunion-ai/weave/actions/runs/42082398755';
  const install = flakeLine({ at, sha: sha(100), url, step: 'Install browsers and system dependencies' });
  assert.match(install, /at the Install browsers and system dependencies step: /);
  const shard = flakeLine({ at, sha: sha(100), url, step: 'Run complete shard' });
  assert.match(shard, /at the Run complete shard step: /);
  assert.notEqual(install, shard, 'two runs that died in different steps of one shard are told apart by the line');
  assert.equal(flakeLine({ at, sha: sha(100), url }), `${at} ${sha(100).slice(0, 10)} failed, then passed on rerun: ${url}`);
});

test('the failing step of a job is read off the steps the jobs API already returns (Issue #1353)', () => {
  const job = { name: 'pr browser-2', steps: [
    { name: 'Set up job', conclusion: 'success' },
    { name: 'Install browsers and system dependencies', conclusion: 'failure' },
    { name: 'Run fast shard', conclusion: 'skipped' },
  ] };
  assert.equal(failedStep(job), 'Install browsers and system dependencies');
  assert.equal(failedStep({ name: 'tests unit-1', steps: [{ name: 'Set up job', conclusion: 'success' }] }), null);
  assert.equal(failedStep({ name: 'tests unit-1' }), null);
  assert.equal(flakeStep([{ step: 'Install Chromium' }, { step: 'Install Chromium' }]), 'Install Chromium');
  assert.equal(flakeStep([{ step: 'Install Chromium' }, { step: 'Run complete shard' }]), null, 'two different steps name no single step');
  assert.equal(flakeStep([{ name: 'tests browser-1' }]), null);
});

test('a shard that died installing its browsers opens one shard-named row and never a per-file one (Issue #1353)', () => {
  const browser2 = { name: 'pr browser-2', html_url: 'https://github.com/grunion-ai/weave/actions/runs/42082398755/job/127438718126', step: 'Install browsers and system dependencies' };
  assert.deepEqual(flakeRows({ files: [], jobs: [browser2] }), ['pr browser-2'], 'a job that recorded no ci-results file opens a shard-named row');
  assert.deepEqual(flakeRows({ files: ['test/grid.test.mjs'], jobs: [browser2] }), ['pr browser-2'], 'an install failure never adds a line to a per-file flake row');
  assert.deepEqual(flakeRows({ files: ['test/grid.test.mjs'], jobs: [{ name: 'tests browser-2', step: 'Run complete shard' }] }), ['test/grid.test.mjs']);
  assert.deepEqual(flakeRows({ files: [], jobs: [] }), ['the tests suite']);
});

test('the Issue and Feature rows a reverted commit names are read off its subject (Issue #1297)', () => {
  assert.deepEqual(revertedRefs([{ message: 'Workspace row pressed state on the setup page (Issue #958) (#398)' }]), [{ table: 'Issue', publicId: 958 }]);
  assert.deepEqual(revertedRefs([{ message: 'Port the overnight fixer core into weave as agents/fixer/core.mjs (Feature #192) (#544)' }]), [{ table: 'Feature', publicId: 192 }]);
  assert.deepEqual(revertedRefs([{ message: 'Brand kit page, every PNG at 2x or more (Feature #342, Issue #1196) (#464)' }]),
    [{ table: 'Feature', publicId: 342 }, { table: 'Issue', publicId: 1196 }]);
  assert.deepEqual(revertedRefs([{ message: 'Re-land #255: sign-up starts onboarding (Feature #327, Issues #910, #933) (#271)' }]),
    [{ table: 'Feature', publicId: 327 }, { table: 'Issue', publicId: 910 }, { table: 'Issue', publicId: 933 }]);
  assert.deepEqual(revertedRefs([{ message: 'System tables back under the System space in the sidebar (#513)' }]), []);
  assert.deepEqual(revertedRefs([{ message: 'a (Issue #7) b\n\nBody names Issue #8 and Feature #9.' }]), [{ table: 'Issue', publicId: 7 }]);
  assert.deepEqual(revertedRefs([{ message: 'x (Issue #7) (#1)' }, { message: 'y (Issue #7) (#2)' }]), [{ table: 'Issue', publicId: 7 }]);
  assert.match(reopenNote({ at: '2026-11-01', ref: { table: 'Issue', publicId: 958 }, culprit: { sha: sha(101), message: 'x (Issue #958) (#398)' }, revert: { number: 600, html_url: 'https://github.com/grunion-ai/weave/pull/600' } }),
    /^Reopened 2026-11-01 by the sheriff: revert PR #600/);
});

test('a sheriff revert sets the rows it undid back to Open or Building, so a reland is queued (Issue #1297)', async () => {
  const culprit = { sha: sha(101), message: 'Brand kit page, every PNG at 2x or more (Feature #342, Issue #1196) (#464)' };
  const f = fake({ commits: [culprit], rows: { 'Feature#342': 'Shipped', 'Issue#1196': 'Fixed' } });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'revert');
  assert.deepEqual(out.reopened, [{ table: 'Feature', publicId: 342, from: 'Shipped', to: 'Building' }, { table: 'Issue', publicId: 1196, from: 'Fixed', to: 'Open' }]);
  const reopens = f.writes.filter((w) => w[0] === 'reopen');
  assert.deepEqual(reopens.map((w) => w[1]), ['Feature#342', 'Issue#1196']);
  for (const w of reopens) {
    assert.match(w[2], /revert PR #500/);
    assert.match(w[2], /not on main/);
    assert.match(w[2], /Reland it as a new PR/);
  }
  assert.ok(f.kinds().indexOf('reopen') > f.kinds().indexOf('issue'), f.kinds().join(','));
  const ranged = fake({ commits: [culprit, { sha: sha(102), message: 'docs: README hero clip (Feature #293) (#439)' }], rows: { 'Feature#342': 'Shipped', 'Issue#1196': 'Fixed', 'Feature#293': 'Shipped' } });
  ranged.io.probe = async () => ({ conclusion: 'cancelled', url: 'u' });
  const wide = await sheriff(900, ranged.io);
  assert.equal(wide.action, 'revert');
  assert.deepEqual(wide.reopened.map((r) => `${r.table}#${r.publicId}`), ['Feature#342', 'Issue#1196', 'Feature#293']);
});

test('a row that is not in its done state, an escalation and a dry run reopen nothing (Issue #1297)', async () => {
  const culprit = { sha: sha(101), message: 'x (Issue #958) (#398)' };
  const already = fake({ commits: [culprit], rows: { 'Issue#958': 'Open' } });
  const out = await sheriff(900, already.io);
  assert.equal(out.action, 'revert');
  assert.deepEqual(out.reopened, []);
  assert.ok(!already.kinds().includes('reopen'), already.kinds().join(','));
  const escalated = fake({ commits: [culprit], conflict: true, rows: { 'Issue#958': 'Fixed' } });
  assert.equal((await sheriff(900, escalated.io)).action, 'escalate');
  assert.ok(!escalated.kinds().includes('reopen'), escalated.kinds().join(','));
  const dry = fake({ commits: [culprit], rows: { 'Issue#958': 'Fixed' } });
  await sheriff(900, dryIO(dry.io), { dryRun: true });
  assert.ok(!dry.kinds().includes('reopen'), dry.kinds().join(','));
});

test('a shard result that ended on the test manager timeout is named, newest attempt per shard', () => {
  const r = (id, attempt, timedOut) => ({ id, attempt, timedOut });
  assert.deepEqual(timedOutShards([r('browser-2', 1, true), r('browser-1', 1, false), r('browser-3', 1, true), r('browser-3', 2, false)]), ['browser-2']);
  assert.deepEqual(timedOutShards([r('browser-1', 2, true), r('browser-1', 1, false)]), ['browser-1']);
  assert.deepEqual(timedOutShards([{ id: 'unit-1', code: 1 }]), []);
});

test('a red held only by shards that hit the test manager timeout, with no failing test recorded, escalates without a bisect or a revert', async () => {
  const f = fake({ files: [], timedOut: ['browser-1', 'browser-2'], commits: [101, 102, 103].map((n) => commit(n)), badFrom: 1 });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.deepEqual(f.kinds(), ['rerun', 'issue', 'alert']);
  assert.match(out.reason, /browser-1, browser-2 hit the test manager timeout/);
  assert.match(out.reason, /no test recorded a failure/);
  const issue = f.writes.find((w) => w[0] === 'issue')[1];
  assert.equal(issue.name, 'Error: tests shards time out on main');
  assert.match(issue.description, /^Shards that hit the test manager timeout: browser-1, browser-2$/m);
  const named = fake({ files: ['test/grid.test.mjs'], timedOut: ['browser-1'] });
  assert.equal((await sheriff(900, named.io)).action, 'revert', 'a failing test beside the timeout is still a conviction');
  const unverdicted = fake({ files: [], unresolved: ['test/grid-browser.test.mjs'], timedOut: ['browser-4'] });
  const held = await sheriff(900, unverdicted.io);
  assert.equal(held.action, 'escalate');
  assert.match(held.reason, /no file reached a retry verdict/, 'a red file with no verdict keeps the Issue #1322 reason');
  const passed = fake({ files: [], timedOut: ['browser-1'], rerunGate: 'success' });
  assert.equal((await sheriff(900, passed.io)).action, 'flake', 'a timeout the rerun cleared is a flake like any other');
});

test('an ineligible run, a rerun attempt or a main that went green again writes nothing', async () => {
  for (const options of [{ run: red({ event: 'pull_request' }) }, { run: red({ run_attempt: 2 }) }, { green: { sha: sha(101) } }]) {
    const f = fake(options);
    assert.equal((await sheriff(900, f.io)).action, 'skip');
    assert.deepEqual(f.writes, []);
  }
});

test('main going green while the rerun runs stops the sheriff before any revert', async () => {
  const f = fake();
  let calls = 0;
  f.io.greenAfter = async () => (calls++ ? { sha: sha(101) } : null);
  assert.equal((await sheriff(900, f.io)).action, 'skip');
  assert.deepEqual(f.kinds(), ['rerun']);
});

test('a rerun that passes is a flake: logged once, nothing reverted or alerted', async () => {
  const f = fake({ rerunGate: 'success' });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'flake');
  assert.deepEqual(f.kinds(), ['rerun', 'flake']);
  assert.deepEqual(f.writes[1][1].files, ['test/grid.test.mjs']);
});

test('a rerun that reaches no CI gate verdict is rerun once more, never bisected', async () => {
  for (const gate of ['cancelled', 'timed_out', 'skipped', null]) {
    const f = fake({ rerunGate: [gate, gate] });
    const out = await sheriff(900, f.io);
    assert.equal(out.action, 'skip', `${gate} ended ${out.action}`);
    assert.deepEqual(f.kinds(), ['rerun', 'rerun']);
    assert.match(out.reason, /no CI gate verdict/);
  }
});

test('a second rerun GitHub refuses leaves the commit unjudged instead of failing the sheriff', async () => {
  const f = fake({ rerunGate: ['cancelled'] });
  let reruns = 0;
  f.io.rerunFailed = async (id) => { if (++reruns > 1) throw new Error('HTTP 422: cannot rerun a cancelled attempt'); f.writes.push(['rerun', id]); };
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'skip');
  assert.match(out.reason, /no CI gate verdict/);
  assert.deepEqual(f.kinds(), ['rerun']);
});

test('the second rerun carries the verdict: green is a flake, red reverts', async () => {
  const flake = fake({ rerunGate: ['cancelled', 'success'] });
  assert.equal((await sheriff(900, flake.io)).action, 'flake');
  assert.deepEqual(flake.kinds(), ['rerun', 'rerun', 'flake']);
  const red = fake({ rerunGate: ['cancelled', 'failure'] });
  assert.equal((await sheriff(900, red.io)).action, 'revert');
  assert.deepEqual(red.kinds(), ['rerun', 'rerun', 'probe', 'revert', 'comment', 'issue', 'alert']);
});

test('main going green after the bisect clears the suspect before the revert is opened', async () => {
  const f = fake({ commits: [101, 102, 103].map((n) => commit(n)), badFrom: 2 });
  let calls = 0;
  f.io.greenAfter = async () => (++calls >= 3 ? { sha: sha(101) } : null);
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'skip');
  assert.match(out.reason, /went green/);
  assert.ok(!f.kinds().includes('revert'), f.kinds().join(','));
  assert.deepEqual(f.kinds().filter((k) => k !== 'probe'), ['rerun']);
});

test('a revert that took no probe names the range size and the missing probe in its title, as a dry run shows', async () => {
  const f = fake({ commits: [commit(100)] });
  const out = await sheriff(900, dryIO(f.io), { dryRun: true });
  assert.equal(out.action, 'revert');
  assert.equal(out.probes.length, 0);
  assert.deepEqual(f.writes, []);
  assert.ok(f.logs.some((l) => l.includes(`would dispatch tests at ${sha(1)}`)), 'the dry run names the parent probe it would dispatch');
  assert.match(f.logs.find((l) => /would open sheriff\/revert-/.test(l)), /\(1 commit in range, no bisect probe\)\n/);
  const bisected = fake({ commits: [101, 102, 103].map((n) => commit(n)), badFrom: 2 });
  await sheriff(900, bisected.io);
  assert.doesNotMatch(bisected.writes.find((w) => w[0] === 'revert')[1].title, /no bisect probe/);
});

test('one commit since the last green run is the culprit: revert PR, PR comment, Issue row, one alert', async () => {
  const f = fake({ commits: [commit(100)] });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'revert');
  assert.deepEqual(f.kinds(), ['rerun', 'probe', 'revert', 'comment', 'issue', 'alert']);
  const spec = f.writes[2][1];
  assert.equal(spec.branch, `sheriff/revert-${sha(100).slice(0, 10)}`);
  assert.deepEqual(spec.shas, [sha(100)]);
  assert.match(spec.body, /test\/grid\.test\.mjs/);
  assert.match(spec.body, /actions\/runs\/900/);
  assert.match(spec.body, /pull\/100/);
  assert.match(spec.body, new RegExp(`Sheriff-Culprit: ${sha(100)}`));
  assert.match(spec.message, new RegExp(`This reverts commit ${sha(100)}\\.`));
  assert.match(spec.message, /^No-changelog: \S/m);
  assert.doesNotMatch(spec.title, /\((Issue|Feature)s? #/);
  assert.equal(f.writes[3][1], 100);
  assert.match(f.writes[3][2], /pull\/500/);
  assert.equal(f.writes[4][1].name, 'Error: test/grid.test.mjs fails on main');
  assert.match(f.writes[4][1].description, /actions\/runs\/900/);
  assert.equal(f.kinds().filter((k) => k === 'alert').length, 1);
});

test('a one-commit range is rerun at its parent before the sheriff convicts it (Issue #1671)', async () => {
  const f = fake({ commits: [commit(100)] });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'revert');
  assert.deepEqual(f.kinds(), ['rerun', 'probe', 'revert', 'comment', 'issue', 'alert']);
  assert.equal(f.writes[1][1], sha(1), 'the probe runs the last green commit again, after the red');
  assert.deepEqual(out.probes.map((p) => [p.sha, p.conclusion, p.parent]), [[sha(1), 'success', true]]);
  const spec = f.writes.find((w) => w[0] === 'revert')[1];
  assert.doesNotMatch(spec.title, /no bisect probe/);
  assert.match(spec.body, new RegExp(`^Parent probe ${short(sha(1))}: success https://github\\.com/grunion-ai/weave/actions/runs/p-1$`, 'm'));
});

test('the sheriff no longer reverts PR #923 for the RSS flake PR #922 left on main, because the parent goes red on it too (Issues #1671, #1736)', async () => {
  const culprit = { sha: '6430ff5be073611c82c86b654480082ea247d8d5', message: 'Renaming a field rewrites the formulas that name it (Issues #1622, #1732) (#923)' };
  const parentSha = '5c898afaf531713099ebee4ffa4daa3317ce3a7e';
  const f = fake({
    run: red({ id: 43115687795, head_sha: culprit.sha, html_url: 'https://github.com/grunion-ai/weave/actions/runs/43115687795' }),
    commits: [culprit],
    files: ['test/backup-stream.test.mjs'],
    jobs: [{ name: 'tests unit-2', html_url: 'https://github.com/grunion-ai/weave/actions/runs/43115687795/job/130843153746' }],
    parent: 'failure',
    parentRed: ['test/backup-stream.test.mjs'],
    rows: { 'Issue#1622': 'Fixed', 'Issue#1732': 'Fixed' },
  });
  f.io.lastGreen = async () => ({ sha: parentSha, url: 'https://github.com/grunion-ai/weave/actions/runs/43114912798' });
  f.io.range = async (from, to) => { assert.equal(from, parentSha); assert.equal(to, culprit.sha); return [culprit]; };
  const out = await sheriff(43115687795, f.io);
  assert.equal(out.action, 'escalate');
  assert.deepEqual(f.kinds(), ['rerun', 'probe', 'comment', 'issue', 'alert']);
  assert.equal(f.writes[1][1], parentSha);
  assert.match(out.reason, /no commit in the range can explain this red/);
  assert.match(out.reason, /the parent 5c898afaf5 went red on test\/backup-stream\.test\.mjs too/);
  const row = f.writes.find((w) => w[0] === 'issue')[1];
  assert.doesNotMatch(row.description, /Culprit commits:/);
  assert.match(row.description, /^Parent probe 5c898afaf5: failure /m);
  assert.match(row.description, /^- 6430ff5be073611c82c86b654480082ea247d8d5 Renaming a field rewrites the formulas that name it .*: the parent 5c898afaf5 went red/m);
});

test('a parent probe red on another file neither clears nor convicts the range: escalate (Issue #1671)', async () => {
  const f = fake({ commits: [commit(100)], parent: 'failure', parentRed: ['test/feedback-budget-browser.test.mjs'] });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.ok(!f.kinds().includes('revert'), f.kinds().join(','));
  assert.match(out.reason, new RegExp(`parent probe at ${short(sha(1))} went red on test/feedback-budget-browser\\.test\\.mjs, not on test/grid\\.test\\.mjs`));
});

test('a parent probe that reaches no verdict leaves the rerun red to convict, as before the probe; a red that names no file meets a red parent alone (Issue #1671)', async () => {
  for (const [options, said] of [[{ parent: 'cancelled' }, 'ended cancelled'], [{ parent: 'failure', parentRed: [] }, 'went red with no failing file recorded']]) {
    const f = fake({ commits: [commit(100)], ...options });
    const out = await sheriff(900, f.io);
    assert.equal(out.action, 'revert', JSON.stringify(options));
    assert.ok(f.logs.some((l) => l.includes(`parent probe at ${short(sha(1))} ${said}`)), f.logs.join('\n'));
  }
  const silent = fake({ commits: [commit(100)], files: [], parent: 'failure' });
  const out = await sheriff(900, silent.io);
  assert.equal(out.action, 'escalate');
  assert.match(out.reason, new RegExp(`the parent ${short(sha(1))} went red too`));
});

test('a bisect that probed green below its culprit spends no parent probe; one whose every probe went red does, within the cap (Issue #1671)', async () => {
  const found = fake({ commits: [101, 102, 103, 104, 105].map((n) => commit(n)), badFrom: 2 });
  await sheriff(900, found.io);
  assert.deepEqual(found.writes.filter((w) => w[0] === 'probe').map((w) => w[1]), [sha(102), sha(103)]);
  const first = fake({ commits: [101, 102].map((n) => commit(n)), badFrom: 0 });
  const out = await sheriff(900, first.io);
  assert.deepEqual(out.culprits, [sha(101)]);
  assert.deepEqual(first.writes.filter((w) => w[0] === 'probe').map((w) => w[1]), [sha(101), sha(1)]);
  const spent = fake({ commits: Array.from({ length: 40 }, (_, i) => commit(200 + i)), badFrom: 0 });
  assert.equal((await sheriff(900, spent.io)).action, 'revert');
  assert.equal(spent.writes.filter((w) => w[0] === 'probe').length, BISECT_CAP, 'the parent probe counts against the bisect cap');
  assert.ok(spent.logs.some((l) => l.includes('bisect cap') && l.includes('parent')), spent.logs.join('\n'));
});

test('bisect dispatches midpoints until one commit is isolated', async () => {
  const commits = [101, 102, 103, 104, 105].map((n) => commit(n));
  const f = fake({ commits, badFrom: 2 });
  const out = await sheriff(900, f.io);
  assert.deepEqual(out.culprits, [sha(103)]);
  const probes = f.writes.filter((w) => w[0] === 'probe').map((w) => w[1]);
  assert.deepEqual(probes, [sha(102), sha(103)]);
  assert.ok(probes.length <= BISECT_CAP);
  assert.deepEqual(f.writes.find((w) => w[0] === 'revert')[1].shas, [sha(103)]);
});

test('past the cap of 4 bisect runs the remaining suspect range is reverted as one PR', async () => {
  const commits = Array.from({ length: 40 }, (_, i) => commit(200 + i));
  const f = fake({ commits, badFrom: 25 });
  const out = await sheriff(900, f.io);
  assert.equal(f.writes.filter((w) => w[0] === 'probe').length, 4);
  assert.ok(out.culprits.length > 1);
  assert.ok(out.culprits.includes(sha(225)));
  const spec = f.writes.find((w) => w[0] === 'revert')[1];
  assert.deepEqual(spec.shas, out.culprits);
  assert.equal(spec.branch, `sheriff/revert-${out.culprits[0].slice(0, 10)}-${out.culprits.at(-1).slice(0, 10)}`);
  assert.match(f.writes.find((w) => w[0] === 'issue')[1].description, /^Original PR: #\d+ \S+, #\d+ /m);
});

test('known results for a midpoint are reused and do not spend the cap', async () => {
  const commits = [101, 102, 103, 104, 105].map((n) => commit(n));
  const f = fake({ commits, badFrom: 2, known: { [sha(102)]: { conclusion: 'success', url: 'u' }, [sha(103)]: { conclusion: 'failure', url: 'v' } } });
  const out = await sheriff(900, f.io);
  assert.deepEqual(out.culprits, [sha(103)]);
  assert.equal(f.writes.filter((w) => w[0] === 'probe').length, 0);
});

test('an inconclusive probe stops the bisect and reverts what is still suspect', async () => {
  const commits = [101, 102, 103].map((n) => commit(n));
  const f = fake({ commits });
  f.io.probe = async () => ({ conclusion: 'cancelled', url: 'u' });
  const out = await sheriff(900, f.io);
  assert.deepEqual(out.culprits, commits.map((c) => c.sha));
  assert.equal(out.action, 'revert');
});

test('a culprit range holding only a revert names no culprit (Issue #1279)', async () => {
  const f = fake({ commits: [commit(100, 'Revert "grid: tab order (Issue #551)"\n\nThis reverts commit abcdef1234.')] });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.match(f.writes.at(-1)[1], /never reverts a revert/);
  const row = f.writes.find((w) => w[0] === 'issue')[1];
  assert.doesNotMatch(row.description, /Culprit commits:/);
  assert.match(row.description, /No culprit: no commit in the range can explain this red/);
  assert.match(row.description, new RegExp(`${sha(100)} .*: it is a revert`));
  assert.doesNotMatch(row.description, /on the culprit commit/);
});

test('a documentation commit is no suspect for a browser suite, and an empty suspect list says so (Issue #1316)', async () => {
  const docs = ['README.md', 'docs/PARITY.md', 'docs/comparison/airtable.md', 'changelog.d/private-space-docs-141.md'];
  const f = fake({ commits: [commit(100, 'docs: private spaces in the README (#593)')], files: ['test/setup-flows-browser.test.mjs'], paths: { [sha(100)]: docs } });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.ok(!f.kinds().includes('revert'), f.kinds().join(','));
  assert.match(out.reason, /no commit in the range can explain this red/);
  assert.match(out.reason, /flake or an ordering effect/);
  const row = f.writes.find((w) => w[0] === 'issue')[1];
  assert.doesNotMatch(row.description, /Culprit commits:/);
  assert.match(row.description, /its diff reaches no path test\/setup-flows-browser\.test\.mjs can read/);

  const unit = fake({ commits: [commit(100, 'docs: private spaces in the README (#593)')], files: ['test/docs-drift.test.mjs'], paths: { [sha(100)]: docs } });
  assert.equal((await sheriff(900, unit.io)).action, 'revert', 'a documentation suite still reads documentation');
});

test('a failing file that already has an open row is filed onto that row (Issue #1321)', async () => {
  const file = 'test/grid.test.mjs';
  const held = { id: 'row-1317', publicId: 1317, file };
  const f = fake({ incidents: [held] });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'revert');
  assert.ok(!f.kinds().includes('issue'), f.kinds().join(','));
  const append = f.writes.find((w) => w[0] === 'append');
  assert.equal(append[1].publicId, 1317);
  assert.match(append[2], /actions\/runs\/900/);
  assert.match(append[2], new RegExp(file.replace('/', '\\/')));
  assert.equal(out.issue.publicId, 1317);
});

test('a revert in the culprit range is never reverted: Issue and alert only', async () => {
  const f = fake({ commits: [commit(100, 'Revert "grid: tab order (Issue #551)"\n\nThis reverts commit abcdef1234.')] });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.ok(!f.kinds().includes('revert'));
  assert.deepEqual(f.kinds(), ['rerun', 'comment', 'issue', 'alert']);
  assert.match(f.writes.at(-1)[1], /never reverts a revert/);
});

test('the same culprit is never acted on twice', async () => {
  const held = fake({ reverts: [{ number: 500, shas: [sha(100)] }] });
  assert.equal((await sheriff(900, held.io)).action, 'skip');
  assert.deepEqual(held.kinds(), ['rerun']);
  const branch = fake({ branchExists: true });
  assert.equal((await sheriff(900, branch.io)).action, 'skip');
  assert.deepEqual(branch.kinds(), ['rerun', 'probe', 'revert']);
});

test('a conflicting revert or a missing green base escalates instead of guessing', async () => {
  const conflict = fake({ conflict: true });
  assert.equal((await sheriff(900, conflict.io)).action, 'escalate');
  assert.deepEqual(conflict.kinds(), ['rerun', 'probe', 'revert', 'comment', 'issue', 'alert']);
  const none = fake();
  none.io.lastGreen = async () => null;
  assert.equal((await sheriff(900, none.io)).action, 'escalate');
  assert.equal(none.writes.find((w) => w[0] === 'issue')[1].name, 'Error: test/grid.test.mjs fails on main');
});

test('a refused revert PR escalates with the pushed branch instead of failing silently', async () => {
  const f = fake();
  f.io.openRevert = async (spec) => { f.writes.push(['revert', spec]); return { refused: 'gh: GitHub Actions is not permitted to create or approve pull requests (HTTP 403)', branch: spec.branch, compare: `https://github.com/grunion-ai/weave/compare/main...${spec.branch}` }; };
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.deepEqual(f.kinds(), ['rerun', 'probe', 'revert', 'comment', 'issue', 'alert']);
  assert.match(f.writes.at(-1)[1], /refused its PR .*compare\/main\.\.\.sheriff\/revert-/);
});

test('dry run reads but writes nothing', async () => {
  const commits = [101, 102, 103].map((n) => commit(n));
  const f = fake({ commits, badFrom: 1 });
  const out = await sheriff(900, dryIO(f.io), { dryRun: true });
  assert.deepEqual(f.writes, []);
  assert.equal(out.action, 'revert');
  assert.ok(f.logs.some((l) => /would dispatch tests at/.test(l)));
  assert.ok(f.logs.some((l) => /would open sheriff\/revert-/.test(l)));
});

test('helpers: probes, reverts, markers, failing files, titles and a push that never forces', () => {
  assert.equal(nextProbe(-1, 0), null);
  assert.equal(nextProbe(-1, 4), 1);
  assert.equal(nextProbe(1, 4), 2);
  assert.ok(isRevert('Revert "x"'));
  assert.ok(isRevert('sheriff: revert 0123456789 after main went red'));
  assert.ok(isRevert('fix\n\nThis reverts commit 0123456789abcdef.'));
  assert.ok(!isRevert('grid: tab order (#12)'));
  assert.equal(revertBranch([commit(1)]), `sheriff/revert-${sha(1).slice(0, 10)}`);
  assert.deepEqual(culpritsOf(`x\nSheriff-Culprit: ${sha(1)}\nSheriff-Culprit: ${sha(2)}\n`), [sha(1), sha(2)]);
  assert.deepEqual(failingFiles([{ summaries: [{ file: 'test/b.test.mjs', counts: { failed: 1 } }, { file: 'test/a.test.mjs', success: false, counts: { failed: 0 } }, { file: 'test/c.test.mjs', counts: { failed: 0 } }, { file: 'test/b.test.mjs', counts: { failed: 2 } }, { file: 'test/a.test.mjs', success: false, counts: { failed: 0 } }] }, {}]), ['test/a.test.mjs', 'test/b.test.mjs']);
  assert.equal(issueName({ files: ['test/a.test.mjs', 'test/b.test.mjs'], prs: [{ number: 7 }], culprits: [commit(1)] }), 'Error: test/a.test.mjs fails on main');
  assert.equal(revertTitle({ culprits: [commit(1)], prs: [{ number: 7 }], probes: [{ sha: sha(1), conclusion: 'failure' }] }), `sheriff: revert ${sha(1).slice(0, 10)} (PR #7) after main went red`);
  assert.equal(revertTitle({ culprits: [commit(1)], prs: [{ number: 7 }] }), `sheriff: revert ${sha(1).slice(0, 10)} (PR #7) after main went red (1 commit in range, no bisect probe)`);
  assert.match(revertTitle({ culprits: [commit(1), commit(2)], prs: [] }), /\(2 commits in range, no bisect probe\)$/);
  assert.equal(rerunVerdict('success'), 'success');
  assert.equal(rerunVerdict('failure'), 'failure');
  for (const gate of ['cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', null, undefined]) assert.equal(rerunVerdict(gate), 'unknown', String(gate));
  assert.match(revertMessage({ culprits: [commit(1), commit(2)], prs: [], run: red() }), /This reverts commit .*\.\nThis reverts commit/);
  const args = pushArgs('sheriff/revert-x');
  assert.ok(!args.some((a) => /^(-f|--force|--force-with-lease|\+)/.test(a)));
  assert.ok(!args.some((a) => /refs\/heads\/main$/.test(a)));
});

test('workflows: tests takes a ref input for bisect probes and the sheriff answers red main pushes', () => {
  const tests = readFileSync('.github/workflows/test.yml', 'utf8');
  assert.match(tests, /workflow_dispatch:\n    inputs:\n      ref:/);
  assert.match(tests, /run-name: \$\{\{ inputs\.ref && format\('tests at \{0\}', inputs\.ref\) \|\| '' \}\}/);
  assert.equal(tests.split('ref: ${{ inputs.ref || github.sha }}').length - 1, 3);
  assert.match(tests, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}-\$\{\{ inputs\.ref \|\| github\.sha \}\}/);
  assert.match(tests, /workflow_dispatch' && !inputs\.ref\)/);
  const yml = readFileSync('.github/workflows/sheriff.yml', 'utf8');
  assert.match(yml, /workflow_run:[^\n]*\n    workflows: \[tests\]\n    types: \[completed\]\n    branches: \[main\]/);
  for (const guard of ["conclusion == 'failure'", "event == 'push'", "head_branch == 'main'", 'run_attempt == 1']) assert.ok(yml.includes(guard), guard);
  assert.match(yml, /node scripts\/sheriff\.mjs/);
  assert.doesNotMatch(yml + readFileSync('scripts/sheriff.mjs', 'utf8'), /--force|push -f/);
});


test('unresolved recovery fails the workflow while dry runs and completed recovery succeed', () => {
  for (const action of ['skip', 'flake']) assert.equal(outcomeExitCode({ action }), 0);
  assert.equal(outcomeExitCode({ action: 'revert', revert: { armed: true } }), 0);
  for (const outcome of [{ action: 'escalate' }, { action: 'revert', revert: { armed: false } }]) {
    assert.equal(outcomeExitCode(outcome), 1);
    assert.equal(outcomeExitCode(outcome, { dryRun: true }), 0);
  }
});

test('missing tracker credentials reject both incident filing and flake recording', async () => {
  const io = realIO({});
  await assert.rejects(io.fileIssue({ name: 'incident', description: 'evidence' }), /WEAVE_TRACKER_TOKEN missing/);
  await assert.rejects(io.logFlake({ run: red(), files: ['test/grid.test.mjs'], jobs: [] }), /WEAVE_TRACKER_TOKEN missing/);
  await assert.rejects(io.openFlakes(['test/grid.test.mjs']), /WEAVE_TRACKER_TOKEN missing/);
  const logs = [];
  assert.deepEqual(await dryIO({ ...io, log: (l) => logs.push(l) }).openFlakes(['test/grid.test.mjs']), []);
  assert.match(logs.join('\n'), /could not read the flake rows/);
});
