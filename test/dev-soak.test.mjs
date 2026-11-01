import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTEXT, DEFAULTS, judge, judgeBatch, describe, soak, report, config, smoke, writableTable } from '../scripts/dev-soak.mjs';

const SHA = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const NEWEST = 'c'.repeat(40);
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

test('writableTable: the smoke writes to a user table, never the workspace registry (Issue #979)', () => {
  const check = { id: 'c', qualified: 'Smoke/Check' };
  assert.equal(writableTable([{ id: 's', qualified: 'System/Spaces' }, { id: 'u', qualified: 'System/Users' }, check]), check);
  assert.equal(writableTable([{ id: 's', qualified: 'System/Spaces' }]), undefined);
});

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

test('judge: a later release rolled back onto the expected commit is a move, this commit never failed', () => {
  const back = health({ lastSwap: { from: `c${NEWER}`, to: `c${SHA}`, ok: true, rollback: '30 of 40 responses were 5xx' }, watch: { release: `c${NEWER}`, ok: false, reason: '30 of 40 responses were 5xx' } });
  assert.equal(judge(back, { sha: SHA }).verdict, 'moved');
  const past = health({ commit: NEWER, lastSwap: { from: `c${NEWEST}`, to: `c${NEWER}`, ok: true, rollback: '30 of 40 responses were 5xx' } });
  assert.equal(judge(past, { sha: SHA }).verdict, 'moved');
});

test('judgeBatch: a rollback, a watch alert or a failed watch on the serving release fail the batch', () => {
  const rolled = health({ commit: NEWER, lastSwap: { from: `c${NEWEST}`, to: `c${NEWER}`, ok: true, rollback: '/api/health failed 3 checks in a row' } });
  assert.match(judgeBatch(rolled).reason, /rolled back to bbbbbbbbbb: \/api\/health failed 3 checks/);
  assert.match(judgeBatch(health({ commit: NEWER, watch: { release: `c${NEWER}`, ok: false, alert: 'migrated; act by hand' } })).reason, /watch alert on bbbbbbbbbb: migrated/);
  assert.match(judgeBatch(health({ commit: NEWER, watch: { release: `c${NEWER}`, ok: false, reason: '30 of 40 responses were 5xx' } })).reason, /watch failed on bbbbbbbbbb: 30 of 40/);
  assert.equal(judgeBatch({ ok: true }).verdict, 'fail');
});

test('judgeBatch: a just-swapped release with no watch yet, or with an open one, holds the batch', () => {
  assert.equal(judgeBatch(health({ commit: NEWER, watch: null })).verdict, 'ok');
  assert.equal(judgeBatch(health({ commit: NEWER, watch: { release: `c${SHA}`, ok: false, reason: 'an older release' } })).verdict, 'ok');
  assert.equal(judgeBatch(health({ commit: NEWER })).verdict, 'ok');
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

const movedAfter = (clock, t0, minutes, moved) => () => ({ status: 200, body: clock.at() - t0 >= minutes * MIN ? moved : health() });

test('soak: a merge during the window holds the clock and the smoke schedule and ends in success on the original commit', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({ head: NEWER, healthAt: movedAfter(clock, t0, 5, health({ commit: NEWER, pid: 40, since: '2026-10-13T04:05:00Z' })) });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'success');
  assert.equal(outcome.movedTo, NEWER);
  assert.equal(io.calls.smokes.length, 5);
  assert.ok(clock.at() - t0 >= 15 * MIN);
  assert.ok(clock.at() - t0 < 16 * MIN);
  const status = await report({ sha: SHA, outcome, io });
  assert.equal(status.state, 'success');
  assert.equal(io.calls.statuses[0].sha, SHA);
  assert.match(status.description, /bbbbbbbbbb/);
  assert.equal(io.calls.alerts.length, 0);
});

test('soak: several merges in one window still end in success at the same time, naming the last commit dev moved to', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({
    head: NEWEST,
    healthAt: () => {
      const minutes = (clock.at() - t0) / MIN;
      if (minutes < 3) return { status: 200, body: health() };
      if (minutes < 7) return { status: 200, body: health({ commit: NEWER, pid: 40, watch: null }) };
      return { status: 200, body: health({ commit: NEWEST, pid: 41, watch: null }) };
    },
  });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'success');
  assert.equal(outcome.movedTo, NEWEST);
  assert.equal(io.calls.smokes.length, 5);
  assert.ok(clock.at() - t0 >= 15 * MIN);
  assert.ok(clock.at() - t0 < 16 * MIN);
  assert.match(describe(outcome), /cccccccccc/);
});

test('soak: dev already past the commit when the queued soak starts still runs the whole window', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({ head: NEWER, healthAt: () => ({ status: 200, body: health({ commit: NEWER, watch: null }) }) });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'success');
  assert.equal(io.calls.smokes.length, 5);
  assert.ok(clock.at() - t0 >= 15 * MIN);
});

test('soak: a move ends the wait for a watch, the original or the new one', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({ head: NEWER, healthAt: movedAfter(clock, t0, 14, health({ commit: NEWER })) });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'success');
  assert.ok(clock.at() - t0 < 16 * MIN);
});

test('soak: a commit that held dev for the whole window with a passing watch succeeds when dev then moves', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({
    head: NEWER,
    healthAt: () => ({ status: 200, body: clock.at() - t0 >= DEFAULTS.soakMs ? health({ commit: NEWER }) : health({ ok: true }) }),
  });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'success');
  assert.ok(clock.at() - t0 >= DEFAULTS.soakMs);
});

test('soak: a smoke failure after a move is superseded with no alert', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({
    head: NEWER,
    healthAt: movedAfter(clock, t0, 5, health({ commit: NEWER })),
    smokeAt: (n) => (n >= 3 ? { ok: false, step: 'open table', error: 'timeout', fivexx: 0 } : { ok: true, fivexx: 0 }),
  });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'superseded');
  assert.match(outcome.reason, /smoke 4 failed at open table twice: timeout/);
  const status = await report({ sha: SHA, outcome, io });
  assert.equal(status.state, 'pending');
  assert.equal(io.calls.alerts.length, 0);
});

test('soak: a smoke failure before a move is a failure with an alert', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({
    head: NEWER,
    healthAt: movedAfter(clock, t0, 12, health({ commit: NEWER })),
    smokeAt: (n) => (n >= 2 ? { ok: false, step: 'open table', error: 'timeout', fivexx: 0 } : { ok: true, fivexx: 0 }),
  });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'failure');
  await report({ sha: SHA, outcome, io });
  assert.equal(io.calls.statuses[0].state, 'failure');
  assert.equal(io.calls.alerts.length, 1);
});

test('soak: a smoke failure on a swap the health poll had not seen yet is superseded, the check looks once more', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({
    head: NEWER,
    healthAt: (n) => ({ status: 200, body: n <= 12 ? health() : health({ commit: NEWER }) }),
    smokeAt: () => (clock.at() - t0 >= 6 * MIN ? { ok: false, step: 'load', error: 'net::ERR_ABORTED', fivexx: 0 } : { ok: true, fivexx: 0 }),
  });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'superseded');
  assert.equal(io.calls.health, 13);
});

test('soak: a rollback after a move is superseded with no alert', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({
    head: NEWEST,
    healthAt: () => {
      const minutes = (clock.at() - t0) / MIN;
      if (minutes < 5) return { status: 200, body: health() };
      if (minutes < 9) return { status: 200, body: health({ commit: NEWEST, pid: 40 }) };
      return { status: 200, body: health({ commit: NEWER, pid: 41, lastSwap: { from: `c${NEWEST}`, to: `c${NEWER}`, ok: true, rollback: '30 of 40 responses were 5xx' } }) };
    },
  });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'superseded');
  assert.match(outcome.reason, /rolled back to bbbbbbbbbb/);
  await report({ sha: SHA, outcome, io });
  assert.equal(io.calls.statuses[0].state, 'pending');
  assert.equal(io.calls.alerts.length, 0);
});

test('soak: a later release rolled back onto this commit between polls is superseded, this commit is not blamed', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const back = health({ pid: 40, lastSwap: { from: `c${NEWER}`, to: `c${SHA}`, ok: true, rollback: '/api/health failed 3 checks in a row' }, watch: { release: `c${NEWER}`, ok: false, reason: '/api/health failed 3 checks in a row' } });
  const io = fakeIO({ head: NEWER, healthAt: movedAfter(clock, t0, 5, back) });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'superseded');
  assert.equal(io.calls.alerts.length, 0);
});

test('soak: a watch alert or a failed watch on the release dev moved to is superseded', async () => {
  for (const watch of [{ release: `c${NEWER}`, ok: false, alert: 'migrated; act by hand' }, { release: `c${NEWER}`, ok: false, reason: '30 of 40 responses were 5xx' }]) {
    const clock = fakeClock();
    const t0 = clock.at();
    const outcome = await soak({ sha: SHA, io: fakeIO({ head: NEWER, healthAt: movedAfter(clock, t0, 5, health({ commit: NEWER, watch })) }), clock });
    assert.equal(outcome.state, 'superseded');
    assert.ok(clock.at() - t0 < 6 * MIN);
  }
});

test('soak: 5xx past the budget after a move is superseded, inside the budget it still passes', async () => {
  const run = async (cfg) => {
    const clock = fakeClock();
    const t0 = clock.at();
    const io = fakeIO({
      head: NEWER,
      healthAt: movedAfter(clock, t0, 5, health({ commit: NEWER })),
      smokeAt: (n) => ({ ok: true, fivexx: n === 3 ? 1 : 0 }),
    });
    return soak({ sha: SHA, io, clock, cfg });
  };
  assert.equal((await run(DEFAULTS)).state, 'superseded');
  const within = await run({ ...DEFAULTS, max5xx: 1 });
  assert.equal(within.state, 'success');
  assert.equal(within.fivexx, 1);
});

test('soak: health that stops answering after a move is superseded', async () => {
  const clock = fakeClock();
  const t0 = clock.at();
  const io = fakeIO({ head: NEWER, healthAt: () => (clock.at() - t0 < 5 * MIN ? { status: 200, body: health() } : clock.at() - t0 < 7 * MIN ? { status: 200, body: health({ commit: NEWER }) } : { status: 0, error: 'ECONNREFUSED' }) });
  const outcome = await soak({ sha: SHA, io, clock });
  assert.equal(outcome.state, 'superseded');
  assert.match(outcome.reason, /3 times in a row \(ECONNREFUSED\)/);
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

test('report: superseded posts its own pending status, told apart from a pass, and never alerts', async () => {
  const io = fakeIO({ healthAt: () => null });
  const status = await report({ sha: SHA, outcome: { state: 'superseded', reason: 'main moved to bbbbbbbbbb; dev serves bbbbbbbbbb, not aaaaaaaaaa' }, io });
  assert.equal(status.state, 'pending');
  assert.equal(io.calls.statuses.length, 1);
  assert.equal(io.calls.statuses[0].context, CONTEXT);
  assert.equal(io.calls.statuses[0].target_url, io.runUrl);
  assert.match(io.calls.statuses[0].description, /^superseded: main moved to bbbbbbbbbb/);
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

function fakePage() {
  const seen = [];
  let pageHeaders = {};
  const answer = (url) => {
    if (url.endsWith('/api/tables')) return [{ id: 't1' }];
    if (url.endsWith('/query')) return { items: [{ id: 'e1', doc: 'body' }] };
    return { id: 'e2' };
  };
  return {
    seen,
    on: () => {},
    setExtraHTTPHeaders: async (headers) => { pageHeaders = headers; },
    goto: async (url) => { seen.push({ url, auth: pageHeaders.Authorization }); },
    reload: async () => {},
    evaluate: async () => {},
    waitForSelector: async () => {},
    waitForFunction: async () => {},
    request: {
      fetch: async (url, init) => {
        seen.push({ url, auth: init.headers?.Authorization });
        return { status: () => 200, ok: () => true, json: async () => answer(url) };
      },
    },
  };
}

test('smoke: the write token reaches only the write workspace', async () => {
  const page = fakePage();
  const result = await smoke(page, { base: 'https://dev.example', workspace: '/w/weave', writeWorkspace: '/w/smoke', token: 'wv_smoke' });
  assert.deepEqual(result, { ok: true, fivexx: 0, steps: 6 });
  const read = page.seen.filter((s) => s.url.includes('/w/weave'));
  const write = page.seen.filter((s) => s.url.includes('/w/smoke'));
  assert.ok(read.length && write.length);
  assert.deepEqual(read.filter((s) => s.auth), []);
  assert.deepEqual(write.filter((s) => s.auth !== 'Bearer wv_smoke'), []);
});

test('smoke: the browser context carries no token of its own', () => {
  const source = readFileSync(new URL('../scripts/dev-soak.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /newContext\(\{[^}]*Authorization/);
});

test('the dev-soak workflow follows Deploy dev on main, queues merges behind the running soak and may write statuses', () => {
  const wf = readFileSync(new URL('../.github/workflows/dev-soak.yml', import.meta.url), 'utf8');
  assert.match(wf, /workflows: \[dev\]/);
  assert.match(wf, /branches: \[main\]/);
  assert.match(wf, /group: dev-soak-[^\n]+\n\s+cancel-in-progress: false/);
  assert.doesNotMatch(wf, /cancel-in-progress: true/);
  assert.match(wf, /statuses: write/);
  assert.match(wf, /node scripts\/dev-soak\.mjs/);
  assert.match(wf, /github\.event\.workflow_run\.conclusion == 'success'/);
});
