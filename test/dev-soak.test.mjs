import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTEXT, DEFAULTS, judge, describe, soak, report, config } from '../scripts/dev-soak.mjs';

const SHA = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const MIN = 60_000;

const health = ({ commit = SHA, ok = null, pid = 21, since = '2026-10-13T04:00:00Z', watch, lastSwap } = {}) => ({
  ok: true,
  supervisor: {
    release: `c${commit}`,
    commit,
    pid,
    since,
    track: 'main',
    lastSwap: lastSwap ?? { at: since, from: 'cold', to: `c${commit}`, ok: true },
    watch: watch === undefined ? { release: `c${commit}`, until: '2026-10-13T04:10:00Z', ok, migrated: false } : watch,
    failed: [],
  },
});

function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, sleep: async (ms) => { t += ms; }, at: () => t };
}

function fakeIO({ healthAt, smokeAt = () => ({ ok: true, fivexx: 0 }), head = SHA } = {}) {
  const calls = { smokes: [], health: 0, statuses: [], alerts: [], logs: [] };
  return {
    calls,
    runUrl: 'https://github.com/grunion-ai/weave/actions/runs/7',
    log: (l) => calls.logs.push(l),
    smoke: async () => { const r = smokeAt(calls.smokes.length); calls.smokes.push(r); return r; },
    health: async () => { calls.health++; return healthAt(calls.health); },
    mainHead: async () => head,
    status: async (sha, body) => { calls.statuses.push({ sha, ...body }); },
    alert: async (line) => { calls.alerts.push(line); },
  };
}

const watching = (until) => (n) => ({ status: 200, body: health({ ok: n < until ? null : true }) });

test('judge: a watch still open on the expected commit is watching, a passed one is ok', () => {
  assert.equal(judge(health(), { sha: SHA }).verdict, 'watching');
  assert.equal(judge(health({ ok: true }), { sha: SHA }).verdict, 'ok');
});

test('judge: no supervisor block, no watch, a failed watch or an alert all fail', () => {
  assert.equal(judge({ ok: true }, { sha: SHA }).verdict, 'fail');
  assert.equal(judge(health({ watch: null }), { sha: SHA }).verdict, 'fail');
  assert.match(judge(health({ ok: false, watch: { release: `c${SHA}`, ok: false, reason: '30 of 40 responses were 5xx' } }), { sha: SHA }).reason, /30 of 40/);
  assert.equal(judge(health({ watch: { release: `c${SHA}`, ok: false, alert: 'migrated; act by hand' } }), { sha: SHA }).verdict, 'fail');
  assert.equal(judge(health({ watch: { release: 'cold', ok: true } }), { sha: SHA }).verdict, 'fail');
});

test('judge: a worker whose pid or start time changed mid-soak fails', () => {
  const first = health().supervisor;
  assert.equal(judge(health({ pid: 22 }), { sha: SHA, first }).verdict, 'fail');
  assert.equal(judge(health({ since: '2026-10-13T04:05:00Z' }), { sha: SHA, first }).verdict, 'fail');
  assert.equal(judge(health(), { sha: SHA, first }).verdict, 'watching');
});

test('judge: another commit serving is a move, unless it got there by rollback', () => {
  assert.equal(judge(health({ commit: NEWER }), { sha: SHA }).verdict, 'moved');
  const back = health({ commit: NEWER, lastSwap: { from: `c${SHA}`, to: `c${NEWER}`, ok: true, rollback: '/api/health failed 3 checks in a row' } });
  const j = judge(back, { sha: SHA });
  assert.equal(j.verdict, 'fail');
  assert.match(j.reason, /rolled back/);
});

test('soak: smokes every 3 minutes for 15 minutes and succeeds once the watch passes', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({ healthAt: watching(25) });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'success');
  assert.equal(io.calls.smokes.length, 5);
  assert.ok(clock.at() - t0 >= 15 * MIN);
  assert.ok(clock.at() - t0 < 16 * MIN);
});

test('soak: a watch that has not passed when the soak ends gets the grace period, then fails', async () => {
  const late = fakeClock();
  const ok = await soak({ sha: SHA, io: fakeIO({ healthAt: watching(33) }), clock: late });
  assert.equal(ok.state, 'success');
  const never = fakeClock();
  const t0 = never.at();
  const io = fakeIO({ healthAt: watching(Infinity) });
  const failed = await soak({ sha: SHA, io, clock: never });
  assert.equal(failed.state, 'failure');
  assert.match(failed.reason, /watch still open/);
  assert.ok(never.at() - t0 >= DEFAULTS.soakMs + DEFAULTS.graceMs);
});

test('soak: a smoke that fails twice in a row fails and names the step', async () => {
  const io = fakeIO({ healthAt: watching(5), smokeAt: (n) => (n === 2 || n === 3 ? { ok: false, step: 'open table', error: 'timeout', fivexx: 0 } : { ok: true, fivexx: 0 }) });
  const outcome = await soak({ sha: SHA, io, clock: fakeClock() });
  assert.equal(outcome.state, 'failure');
  assert.equal(outcome.reason, 'smoke 3 failed at open table twice: timeout');
});

test('soak: one failed smoke is retried at once and a passing retry keeps the soak going, logged', async () => {
  const io = fakeIO({ healthAt: watching(25), smokeAt: (n) => (n === 2 ? { ok: false, step: 'open table', error: 'timeout', fivexx: 0 } : { ok: true, fivexx: 0 }) });
  const outcome = await soak({ sha: SHA, io, clock: fakeClock() });
  assert.equal(outcome.state, 'success');
  assert.equal(outcome.retries, 1);
  assert.equal(io.calls.smokes.length, 6);
  assert.match(io.calls.logs.join('\n'), /smoke 3 failed at open table \(timeout\); retrying once/);
});

test('soak: any 5xx past the budget fails, from the smoke or from health', async () => {
  const fromSmoke = await soak({ sha: SHA, io: fakeIO({ healthAt: watching(5), smokeAt: (n) => ({ ok: true, fivexx: n === 1 ? 1 : 0 }) }), clock: fakeClock() });
  assert.equal(fromSmoke.state, 'failure');
  assert.match(fromSmoke.reason, /1 5xx/);
  const fromHealth = await soak({ sha: SHA, io: fakeIO({ healthAt: (n) => (n === 4 ? { status: 502, body: null } : { status: 200, body: health() }) }), clock: fakeClock() });
  assert.equal(fromHealth.state, 'failure');
  const budget = await soak({ sha: SHA, io: fakeIO({ healthAt: watching(25), smokeAt: (n) => ({ ok: true, fivexx: n === 1 ? 1 : 0 }) }), clock: fakeClock(), cfg: { ...DEFAULTS, max5xx: 1 } });
  assert.equal(budget.state, 'success');
});

test('soak: health that stops answering fails after three misses in a row, a single miss does not', async () => {
  const blip = await soak({ sha: SHA, io: fakeIO({ healthAt: (n) => (n === 3 ? { status: 0, error: 'timeout' } : watching(25)(n)) }), clock: fakeClock() });
  assert.equal(blip.state, 'success');
  const down = await soak({ sha: SHA, io: fakeIO({ healthAt: (n) => (n >= 3 ? { status: 0, error: 'ECONNREFUSED' } : watching(25)(n)) }), clock: fakeClock() });
  assert.equal(down.state, 'failure');
  assert.match(down.reason, /3 times in a row \(ECONNREFUSED\)/);
});

test('soak: dev moving to a newer main commit mid-soak is superseded, not a failure', async () => {
  const io = fakeIO({ head: NEWER, healthAt: (n) => ({ status: 200, body: n < 6 ? health() : health({ commit: NEWER }) }) });
  const outcome = await soak({ sha: SHA, io, clock: fakeClock() });
  assert.equal(outcome.state, 'superseded');
});

test('soak: dev serving another commit while main still names ours is a failure', async () => {
  const io = fakeIO({ head: SHA, healthAt: () => ({ status: 200, body: health({ commit: NEWER }) }) });
  const outcome = await soak({ sha: SHA, io, clock: fakeClock() });
  assert.equal(outcome.state, 'failure');
  assert.match(outcome.reason, /dev serves bbbbbbbbbb, not aaaaaaaaaa/);
});

test('soak: a rollback mid-soak fails', async () => {
  const rolled = health({ commit: NEWER, lastSwap: { from: `c${SHA}`, to: `c${NEWER}`, ok: true, rollback: '30 of 40 responses were 5xx' } });
  const io = fakeIO({ head: SHA, healthAt: (n) => ({ status: 200, body: n < 4 ? health() : rolled }) });
  const outcome = await soak({ sha: SHA, io, clock: fakeClock() });
  assert.equal(outcome.state, 'failure');
  assert.match(outcome.reason, /rolled back/);
});

test('report: success posts the dev-soak context with the run link and no alert', async () => {
  const io = fakeIO({ healthAt: () => null });
  await report({ sha: SHA, outcome: { state: 'success', reason: 'watch passed', rounds: 5, fivexx: 0, ms: 15.5 * MIN }, io });
  assert.deepEqual(io.calls.statuses, [{ sha: SHA, state: 'success', context: 'dev-soak', description: '5 smokes over 16 min, watch passed, 0 5xx', target_url: io.runUrl }]);
  assert.equal(io.calls.alerts.length, 0);
});

test('report: failure posts failure with the run link and alerts', async () => {
  const io = fakeIO({ healthAt: () => null });
  await report({ sha: SHA, outcome: { state: 'failure', reason: 'worker restarted (pid 21 -> 40)', rounds: 2, fivexx: 0, ms: 4 * MIN }, io });
  assert.equal(io.calls.statuses[0].state, 'failure');
  assert.equal(io.calls.statuses[0].context, CONTEXT);
  assert.equal(io.calls.statuses[0].target_url, io.runUrl);
  assert.match(io.calls.alerts[0], /aaaaaaaaaa failed: worker restarted .*actions\/runs\/7/);
});

test('report: superseded posts nothing, so the newer commit owns the status', async () => {
  const io = fakeIO({ healthAt: () => null });
  assert.equal(await report({ sha: SHA, outcome: { state: 'superseded', reason: 'main moved' }, io }), null);
  assert.equal(io.calls.statuses.length, 0);
  assert.equal(io.calls.alerts.length, 0);
});

test('describe stays inside the 140-character status limit', () => {
  assert.equal(describe({ state: 'failure', reason: 'x'.repeat(300) }).length, 140);
});

test('config reads the dev URL, workspaces and timings from the environment', () => {
  const c = config({ DEV_BASE_URL: 'https://dev.example/', DEV_SMOKE_WORKSPACE: '/w/qa', DEV_SOAK_MS: '60000', DEV_SOAK_MAX_5XX: '2' });
  assert.equal(c.base, 'https://dev.example');
  assert.equal(c.writeWorkspace, '/w/qa');
  assert.equal(c.soakMs, 60_000);
  assert.equal(c.max5xx, 2);
  assert.equal(config({}).soakMs, 15 * MIN);
});

test('the dev-soak workflow follows Deploy dev on main, cancels superseded runs and may write statuses', () => {
  const wf = readFileSync(new URL('../.github/workflows/dev-soak.yml', import.meta.url), 'utf8');
  assert.match(wf, /workflows: \[dev\]/);
  assert.match(wf, /branches: \[main\]/);
  assert.match(wf, /cancel-in-progress: true/);
  assert.match(wf, /statuses: write/);
  assert.match(wf, /node scripts\/dev-soak\.mjs/);
  assert.match(wf, /github\.event\.workflow_run\.conclusion == 'success'/);
});
