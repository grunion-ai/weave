import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sheriff, dryIO, eligible, nextProbe, isRevert, revertBranch, culpritsOf, failingFiles, issueName, revertTitle, revertMessage, pushArgs, BISECT_CAP } from '../scripts/sheriff.mjs';

const sha = (n) => n.toString(16).padStart(40, '0');
const repo = 'grunion-ai/weave';
const red = (patch = {}) => ({ id: 900, name: 'tests', path: '.github/workflows/test.yml', event: 'push', head_branch: 'main', head_repository: { full_name: repo }, status: 'completed', conclusion: 'failure', run_attempt: 1, head_sha: sha(100), html_url: 'https://github.com/grunion-ai/weave/actions/runs/900', created_at: '2026-10-12T10:00:00Z', ...patch });
const commit = (n, message = `change ${n} (#${n})`) => ({ sha: sha(n), message });

function fake({ run: given, rerunGate = 'failure', commits = [commit(100)], badFrom = null, known = {}, reverts = [], branchExists = false, conflict = false, green = null, files = ['test/grid.test.mjs'] } = {}) {
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
    failures: async () => ({ files, jobs: [{ name: 'tests browser-2', html_url: 'https://github.com/grunion-ai/weave/actions/runs/900/job/1' }] }),
    rerunFailed: async (id) => writes.push(['rerun', id]),
    waitRun: async (id) => ({ ...run, id, run_attempt: 2 }),
    gate: async () => rerunGate,
    lastGreen: async () => ({ sha: sha(1), url: 'https://github.com/grunion-ai/weave/actions/runs/800' }),
    range: async (from, to) => { assert.equal(from, sha(1)); assert.equal(to, head ?? run.head_sha); return commits; },
    openReverts: async () => reverts,
    known: async (s) => known[s] ?? null,
    probe: async (s) => { writes.push(['probe', s]); return { conclusion: index(s) >= badFrom ? 'failure' : 'success', url: `https://github.com/grunion-ai/weave/actions/runs/p${index(s)}` }; },
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

test('one commit since the last green run is the culprit: revert PR, PR comment, Issue row, one alert', async () => {
  const f = fake({ commits: [commit(100)] });
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'revert');
  assert.deepEqual(f.kinds(), ['rerun', 'revert', 'comment', 'issue', 'alert']);
  const spec = f.writes[1][1];
  assert.equal(spec.branch, `sheriff/revert-${sha(100).slice(0, 10)}`);
  assert.deepEqual(spec.shas, [sha(100)]);
  assert.match(spec.body, /test\/grid\.test\.mjs/);
  assert.match(spec.body, /actions\/runs\/900/);
  assert.match(spec.body, /pull\/100/);
  assert.match(spec.body, new RegExp(`Sheriff-Culprit: ${sha(100)}`));
  assert.match(spec.message, new RegExp(`This reverts commit ${sha(100)}\\.`));
  assert.match(spec.message, /^No-changelog: \S/m);
  assert.doesNotMatch(spec.title, /\((Issue|Feature)s? #/);
  assert.equal(f.writes[2][1], 100);
  assert.match(f.writes[2][2], /pull\/500/);
  assert.equal(f.writes[3][1].name, 'Error: test/grid.test.mjs fails on main after PR #100');
  assert.match(f.writes[3][1].description, /actions\/runs\/900/);
  assert.equal(f.kinds().filter((k) => k === 'alert').length, 1);
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
  assert.match(f.writes.find((w) => w[0] === 'issue')[1].name, /after PRs #/);
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
  assert.deepEqual(branch.kinds(), ['rerun', 'revert']);
});

test('a conflicting revert or a missing green base escalates instead of guessing', async () => {
  const conflict = fake({ conflict: true });
  assert.equal((await sheriff(900, conflict.io)).action, 'escalate');
  assert.deepEqual(conflict.kinds(), ['rerun', 'revert', 'comment', 'issue', 'alert']);
  const none = fake();
  none.io.lastGreen = async () => null;
  assert.equal((await sheriff(900, none.io)).action, 'escalate');
  assert.equal(none.writes.find((w) => w[0] === 'issue')[1].name, `Error: test/grid.test.mjs fails on main after commit ${sha(100).slice(0, 10)}`);
});

test('a refused revert PR escalates with the pushed branch instead of failing silently', async () => {
  const f = fake();
  f.io.openRevert = async (spec) => { f.writes.push(['revert', spec]); return { refused: 'gh: GitHub Actions is not permitted to create or approve pull requests (HTTP 403)', branch: spec.branch, compare: `https://github.com/grunion-ai/weave/compare/main...${spec.branch}` }; };
  const out = await sheriff(900, f.io);
  assert.equal(out.action, 'escalate');
  assert.deepEqual(f.kinds(), ['rerun', 'revert', 'comment', 'issue', 'alert']);
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
  assert.deepEqual(failingFiles([{ summaries: [{ file: 'test/b.test.mjs', counts: { failed: 1 } }, { file: 'test/a.test.mjs', success: false, counts: { failed: 0 } }, { file: 'test/c.test.mjs', counts: { failed: 0 } }] }, {}]), ['test/a.test.mjs', 'test/b.test.mjs']);
  assert.equal(issueName({ files: ['test/a.test.mjs', 'test/b.test.mjs'], prs: [{ number: 7 }], culprits: [commit(1)] }), 'Error: test/a.test.mjs (+1 more) fails on main after PR #7');
  assert.equal(revertTitle({ culprits: [commit(1)], prs: [{ number: 7 }] }), `sheriff: revert ${sha(1).slice(0, 10)} (PR #7) after main went red`);
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
  assert.match(tests, /group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}-\$\{\{ inputs\.ref \}\}/);
  assert.match(tests, /workflow_dispatch' && !inputs\.ref\)/);
  const yml = readFileSync('.github/workflows/sheriff.yml', 'utf8');
  assert.match(yml, /workflow_run:[^\n]*\n    workflows: \[tests\]\n    types: \[completed\]\n    branches: \[main\]/);
  for (const guard of ["conclusion == 'failure'", "event == 'push'", "head_branch == 'main'", 'run_attempt == 1']) assert.ok(yml.includes(guard), guard);
  assert.match(yml, /node scripts\/sheriff\.mjs/);
  assert.doesNotMatch(yml + readFileSync('scripts/sheriff.mjs', 'utf8'), /--force|push -f/);
});
