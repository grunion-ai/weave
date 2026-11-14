import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
import { TREND } from '../scripts/ci-test.mjs';
import { SUITES, SUSTAINED, NOTE_LOG, readingOf, readTap, judge, streakOf, noteName, noteSymptom, noteLine, readHistory, trend, fileNote, suiteEnv } from '../scripts/ci-trend.mjs';

const result = (pass, n, name) => [`# Subtest: ${name}`, `${pass ? 'ok' : 'not ok'} ${n} - ${name}`, '  ---', '  duration_ms: 9125.25', "  type: 'test'", '  ...'];
const FEEDBACK = 'load-home|desktop: the action paints its answer before a slow server does, within its feedback budget (Issue \\#1042)';
const BUSY = 'load-home|desktop: an action that settles inside the skeleton delay shows no spinner and no aria-busy (Issue \\#1042)';
const RENDERS = 'load-home|desktop: the journey renders in no more frames than its budget (Issue \\#1042)';
const VITALS = 'open-table|desktop: LCP, CLS and INP stay inside their budgets (Issue \\#1042)';
const QUERY = 'the first page of a 50000-row table sorted by a lookup costs at most 4x the unsorted first page (Issues \\#1093, \\#1511)';

const CLS_RUN = [
  '# TEST SELECTION targeted: Explicit test selection.',
  'TAP version 13',
  ...result(true, 1, QUERY),
  '# query-volume lookup sort p50 1.7 ms (p95 3.0 ms), unsorted p50 2.6 ms, ratio 0.66x, ceiling 4x',
  '# RESULT green: unit lane green',
  'TAP version 13',
  '# (node:5223) ExperimentalWarning: SQLite is an experimental feature and might change at any time',
  ...result(true, 1, FEEDBACK),
  '# feedback load-home|desktop fastest 110 ms median 131 ms runs 449,131,110 budget 700 acts load:110',
  ...result(true, 2, BUSY),
  ...result(true, 3, RENDERS),
  '# renders load-home|desktop fastest 9 median 9 runs 9,10,9 budget 9',
  ...result(false, 44, VITALS),
  '# vitals open-table|desktop|lcp fastest 372 median 388 runs 388,488,412,372,384,436,376 budget 1000',
  '# vitals open-table|desktop|cls fastest 0.139 median 0.139 runs 0.139,0.139,0.139,0.139,0.139,0.139,0.139 budget 0.01',
  '# vitals open-table|desktop|inp fastest 72 median 80 runs 88,80,96,72,80,80,80 budget 240',
  '# fail 1',
  '# RETRYING 1 file(s) that failed: /home/runner/work/weave/weave/test/vitals-budget-browser.test.mjs',
  'TAP version 13',
  ...result(false, 1, VITALS),
  '# vitals open-table|desktop|lcp fastest 300 median 320 runs 368,344,372,320,300,308,308 budget 1000',
  '# vitals open-table|desktop|cls fastest 0.139 median 0.139 runs 0.139,0.139,0.139,0.139,0.139,0.139,0.139 budget 0.01',
  '# vitals open-table|desktop|inp fastest 64 median 64 runs 72,80,64,64,64,64,64 budget 240',
  '# RETRIED and still red: /home/runner/work/weave/weave/test/vitals-budget-browser.test.mjs',
  '# RESULT red: browser lane red',
].join('\n');

const POINT = { commit: 'a74d5bc6e92882819365291a16a28d6abd922956', run: '43147007522', attempt: 1, at: '2026-11-12T03:21:28.000Z' };
const URL_OF_RUN = 'https://github.com/grunion-ai/weave/actions/runs/43147007522';
const past = (run, value, key = 'open-table|desktop|cls', suite = 'vitals') => ({ run, readings: [{ suite, key, value, budget: 0.01 }] });

function fakeIO({ code = 1, text = CLS_RUN, history = [], note = async () => {} } = {}) {
  const io = {
    commit: POINT.commit, run: POINT.run, attempt: POINT.attempt, url: URL_OF_RUN, logs: [], summaries: [], notes: [], alerts: [], points: [],
    now: () => POINT.at,
    suites: async () => ({ code, text }),
    history: () => history,
    write: (point) => io.points.push(point),
    note: async (n) => { io.notes.push(n); return note(n); },
    alert: async (line) => io.alerts.push(line),
    log: (line) => io.logs.push(line),
    summary: (line) => io.summaries.push(line),
  };
  return io;
}

test('the trend parser reads the reading each budget suite logs, and only those (Issue #1709)', () => {
  assert.deepEqual(readingOf('# renders load-home|desktop fastest 9 median 9 runs 9,10,9 budget 9'), { suite: 'renders', key: 'load-home|desktop', value: 9, budget: 9, runs: [9, 10, 9] });
  assert.deepEqual(readingOf('# vitals open-table|desktop|cls fastest 0.139 median 0.139 runs 0.139,0.139 budget 0.01'), { suite: 'vitals', key: 'open-table|desktop|cls', value: 0.139, budget: 0.01, runs: [0.139, 0.139] });
  assert.deepEqual(readingOf('# feedback load-home|desktop fastest 110 ms median 131 ms runs 449,131,110 budget 700 acts load:110'), { suite: 'feedback', key: 'load-home|desktop', value: 110, budget: 700, runs: [449, 131, 110] });
  assert.deepEqual(readingOf('# query-volume lookup sort p50 1.7 ms (p95 3.0 ms), unsorted p50 2.6 ms, ratio 0.66x, ceiling 4x'), { suite: 'query-volume', key: 'lookup sort', value: 0.66, budget: 4 });
  assert.equal(readingOf('# renders new-journey|phone fastest 7 median 7 runs 7,7,7 budget none').budget, null, 'a journey with no budget yet reads as unbudgeted');
  assert.equal(readingOf('# feedback open-row|desktop fastest - ms median - ms runs -,-,- budget 120 acts '), null, 'a journey that painted nothing has no reading to judge');
  for (const line of ['# clicks load-home|desktop 2 budget 2', '# busy open-row|desktop held open by Issue #1', '# (node:5223) ExperimentalWarning: SQLite', 'ok 1 - renders x fastest 9 median 9 runs 9 budget 9', '  # vitals x fastest 1 median 1 runs 1 budget 2']) {
    assert.equal(readingOf(line), null, `${line} is not a trend reading`);
  }
});

test('the trend parser ties each reading to the test it follows, and a retried test keeps its last result (Issue #1709)', () => {
  const { tests, readings } = readTap(CLS_RUN);
  assert.equal(readings.length, 9, 'every reading of both attempts is read');
  const vitals = tests.find((t) => t.name.startsWith('open-table|desktop'));
  assert.equal(vitals.name, VITALS.replaceAll('\\#', '#'));
  assert.equal(vitals.pass, false);
  assert.deepEqual(vitals.readings.map((r) => r.value), [300, 0.139, 64], 'the retry is the result that stands, with its own readings');
  assert.equal(tests.find((t) => t.name.startsWith(BUSY.slice(0, 30))).readings.length, 0);
  assert.equal(tests.filter((t) => t.pass).length, 4);
});

test('a budget miss is a trend note and the run judges green: the CLS run that turned budgets red on 21 main pushes (Issue #1709)', () => {
  const { readings, misses, faults } = judge(readTap(CLS_RUN), { code: 1, run: POINT.run });
  assert.deepEqual(faults, []);
  assert.deepEqual(misses.map((m) => [m.suite, m.key, m.value, m.budget, m.streak]), [['vitals', 'open-table|desktop|cls', 0.139, 0.01, 1]]);
  assert.equal(readings.length, 6, 'one reading per suite and key, the fastest of the attempts');
  assert.equal(readings.find((r) => r.key === 'open-table|desktop|lcp').value, 300);
  assert.deepEqual([...new Set(readings.map((r) => r.suite))].sort(), Object.values(SUITES).sort(), 'every trend suite was read');
});

test('a failure no budget miss explains, a silent suite or an exit with no failing test still turns the trend lane red (Issue #1709)', () => {
  const busy = CLS_RUN.replace(`ok 2 - ${BUSY}`, `not ok 2 - ${BUSY}`);
  assert.deepEqual(judge(readTap(busy), { code: 1 }).faults, [`${BUSY.replaceAll('\\#', '#')} failed without a budget miss`]);
  const crashed = CLS_RUN.replace(/# renders [^\n]+\n/, '').replace(`ok 3 - ${RENDERS}`, `not ok 3 - ${RENDERS}`);
  assert.deepEqual(judge(readTap(crashed), { code: 1 }).faults, [
    'the trend lane read no renders budget: its suite recorded nothing',
    `${RENDERS.replaceAll('\\#', '#')} failed without a budget miss`,
  ]);
  const held = CLS_RUN.replaceAll('cls fastest 0.139', 'cls fastest 0.004').replaceAll(`not ok 44 - ${VITALS}`, `ok 44 - ${VITALS}`).replaceAll(`not ok 1 - ${VITALS}`, `ok 1 - ${VITALS}`);
  const green = judge(readTap(held), { code: 0 });
  assert.deepEqual([green.misses, green.faults], [[], []]);
  assert.deepEqual(judge(readTap(held), { code: 1 }).faults, ['the trend suites exited 1 with no failing test']);
  assert.equal(judge(readTap(''), { code: 1 }).faults.length, Object.keys(SUITES).length + 1, 'a lane that ran nothing reads no suite and names its exit');
});

test('a retry that holds clears the miss, since the fastest reading is the page and the slower one the runner (Issues #1327, #1709)', () => {
  const [first, retry] = CLS_RUN.split('# RETRYING');
  const recovered = `${first}# RETRYING${retry.replace('cls fastest 0.139', 'cls fastest 0.004').replace(`not ok 1 - ${VITALS}`, `ok 1 - ${VITALS}`)}`;
  const { misses, faults, readings } = judge(readTap(recovered), { code: 0 });
  assert.deepEqual([misses, faults], [[], []]);
  assert.equal(readings.find((r) => r.key === 'open-table|desktop|cls').value, 0.004);
});

test('a miss counts the main pushes in a row its series stayed over today\'s budget (Issue #1709)', () => {
  const now = { suite: 'vitals', key: 'open-table|desktop|cls', value: 0.139, budget: 0.01 };
  assert.equal(streakOf(now, [], '9'), 1);
  assert.equal(streakOf(now, [past('8', 0.139), past('7', 0.2), past('6', 0.004), past('5', 0.139)], '9'), 3, 'a hold ends the run of misses');
  assert.equal(streakOf(now, [past('6', 0.004), past('8', 0.139), past('7', 0.139)], '9'), 3, 'the series is read newest first, whatever order it arrives in');
  assert.equal(streakOf(now, [past('8', 0.139), { run: '7', readings: [] }, past('6', 0.139)], '9'), 3, 'a push that read nothing for this key neither counts nor breaks the run');
  assert.equal(streakOf(now, [past('9', 0.139), past('8', 0.139)], '9'), 2, 'the run never counts its own earlier attempt');
  assert.equal(streakOf({ ...now, budget: 0.5 }, [past('8', 0.139)], '9'), 1, 'earlier readings are judged against the budget that stands today');
  assert.equal(streakOf({ ...now, budget: null }, [past('8', 0.004)], '9'), 2, 'an unbudgeted reading misses every push');
});

test('a budget miss files a trend note and exits green, never a red gate (Issue #1709)', async () => {
  const io = fakeIO();
  assert.equal(await trend(io), 0);
  assert.deepEqual(io.notes, [{
    name: 'Looks broken: vitals open-table|desktop|cls over its budget on main',
    symptom: 'Looks broken',
    line: `2026-11-12T03:21:28.000Z a74d5bc6e9 read 0.139 against a budget of 0.01, a new miss: ${URL_OF_RUN}`,
    quiet: false,
  }]);
  assert.ok(io.logs.includes('::warning title=Trend note::vitals open-table|desktop|cls read 0.139 against a budget of 0.01, a new miss'));
  assert.ok(!io.logs.some((l) => l.startsWith('::error')));
  assert.deepEqual(io.alerts, []);
  assert.deepEqual(io.summaries.slice(0, 2), [
    `timing budgets: 1 of 6 readings over budget, kept as trend notes, not a red gate ${URL_OF_RUN}`,
    '- vitals open-table|desktop|cls read 0.139 against a budget of 0.01, a new miss',
  ]);
});

test('every trend run records its readings as one point of the series, faults or not (Issue #1709)', async () => {
  const io = fakeIO();
  await trend(io);
  assert.equal(io.points.length, 1);
  const [point] = io.points;
  assert.deepEqual({ commit: point.commit, run: point.run, attempt: point.attempt, at: point.at }, POINT);
  assert.equal(point.readings.length, 6);
  assert.deepEqual(point.readings.find((r) => r.key === 'open-table|desktop|cls'), { suite: 'vitals', key: 'open-table|desktop|cls', value: 0.139, budget: 0.01, runs: [0.139, 0.139, 0.139, 0.139, 0.139, 0.139, 0.139] });
  const broken = fakeIO({ code: 1, text: '# BROWSER MISSING: chromium did not launch\n# RESULT red: browser missing, no lane ran' });
  assert.equal(await trend(broken), 1, 'a lane that read nothing is broken, which is the one red the trend lane keeps');
  assert.deepEqual(broken.points.map((p) => p.readings), [[]]);
  assert.ok(broken.logs.includes('::error::the trend lane read no vitals budget: its suite recorded nothing'));
  assert.equal(broken.logs[0], 'trend lane broken (5 faults): 0 readings inside their budgets');
});

test('a miss that lasts three main pushes alerts once and writes its note; the pushes after it keep the series, not the row (Issue #1709)', async () => {
  const third = fakeIO({ history: [past('43143618538', 0.139), past('43142855333', 0.139)] });
  assert.equal(await trend(third), 0);
  assert.equal(third.notes[0].quiet, false);
  assert.match(third.notes[0].line, new RegExp(`, ${SUSTAINED} main pushes in a row: `));
  assert.deepEqual(third.alerts, [`weave budgets: vitals open-table|desktop|cls over its budget on ${SUSTAINED} main pushes in a row ${URL_OF_RUN}`]);
  const fourth = fakeIO({ history: [past('43143618538', 0.139), past('43142855333', 0.139), past('43140523229', 0.139)] });
  assert.equal(await trend(fourth), 0);
  assert.equal(fourth.notes[0].quiet, true, 'an open note is not written again mid-run of misses');
  assert.deepEqual(fourth.alerts, []);
});

test('a tracker that refuses the note leaves a warning and the run green (Issue #1709)', async () => {
  const io = fakeIO({ note: async () => { throw new Error('tracker /tables/Issue/query: HTTP 502'); } });
  assert.equal(await trend(io), 0);
  assert.ok(io.logs.includes('::warning::trend note not filed for vitals open-table|desktop|cls: tracker /tables/Issue/query: HTTP 502'));
});

test('trend notes are one standing row per suite and key, named for what the reading shows (Issue #1709)', () => {
  assert.equal(noteName({ suite: 'feedback', key: 'open-row|desktop' }), 'Slow: feedback open-row|desktop over its budget on main');
  assert.equal(noteName({ suite: 'query-volume', key: 'lookup sort' }), 'Slow: query-volume lookup sort over its budget on main');
  assert.equal(noteSymptom({ suite: 'vitals', key: 'open-table|desktop|inp' }), 'Slow');
  assert.equal(noteSymptom({ suite: 'vitals', key: 'open-table|desktop|cls' }), 'Looks broken', 'a layout shift is a page that looks broken, not a slow one');
  assert.equal(noteSymptom({ suite: 'renders', key: 'type-doc|phone' }), 'Looks broken', 'extra render frames are flicker');
  assert.equal(noteLine({ value: 7, budget: null, streak: 2 }, POINT, URL_OF_RUN), `2026-11-12T03:21:28.000Z a74d5bc6e9 read 7 against a budget of none, 2 main pushes in a row: ${URL_OF_RUN}`);
  assert.match(NOTE_LOG, /trend lane/);
  assert.match(NOTE_LOG, /not a budget to raise/);
});

function fakeTracker(rows) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const path = url.replace('https://weave.example/w/weave/api', '');
    const body = JSON.parse(init.body);
    calls.push([path, body]);
    assert.equal(init.headers.Authorization, 'Bearer tkn');
    if (path === '/tables/Issue/query') return Response.json({ items: rows });
    if (path === '/tables/Issue/entities') return Response.json({ id: 'new', publicId: 9001 });
    return Response.json({ ok: true });
  };
  return { calls, fetchImpl };
}

test('the tracker side of a trend note: create once, append to the open row, reopen a Fixed one, and stay quiet mid-run (Issue #1709)', async () => {
  const env = { WEAVE_TRACKER_TOKEN: 'tkn', WEAVE_TRACKER_URL: 'https://weave.example/w/weave/' };
  const note = { name: 'Slow: feedback open-row|desktop over its budget on main', symptom: 'Slow', line: 'L', quiet: false };

  const fresh = fakeTracker([]);
  await fileNote(env, note, fresh.fetchImpl);
  assert.deepEqual(fresh.calls, [
    ['/tables/Issue/query', { where: [['Name', '=', note.name]] }],
    ['/tables/Issue/entities', { Name: note.name, Severity: 'Low', Symptom: ['Slow'], Description: `${NOTE_LOG}\n\nL` }],
  ]);

  const open = fakeTracker([{ id: 'old', publicId: 10, fields: { Status: 'Fixed' } }, { id: 'live', publicId: 12, fields: { Status: 'Open' } }]);
  await fileNote(env, note, open.fetchImpl);
  assert.deepEqual(open.calls.slice(1), [['/entities/live/doc', { doc: '\n\nL' }]]);

  const quiet = fakeTracker([{ id: 'live', publicId: 12, fields: { Status: 'In Progress' } }]);
  await fileNote(env, { ...note, quiet: true }, quiet.fetchImpl);
  assert.equal(quiet.calls.length, 1, 'an open row mid-run of misses is left as it is');

  const fixed = fakeTracker([{ id: 'done', publicId: 10, fields: { Status: 'Fixed' } }]);
  await fileNote(env, { ...note, quiet: true }, fixed.fetchImpl);
  assert.deepEqual(fixed.calls.slice(1), [
    ['/entities/done/doc', { doc: '\n\nL\n\nReopened by the budgets workflow: this reading missed its budget again after the row was marked Fixed.' }],
    ['/entities/done/state', { field: 'Status', state: 'Open' }],
  ]);

  const none = fakeTracker([]);
  await assert.rejects(fileNote({}, note, none.fetchImpl), /WEAVE_TRACKER_TOKEN missing; not filed: Slow: feedback open-row\|desktop/);
  assert.deepEqual(none.calls, [], 'with no tracker token nothing is sent, and the run log says why');
});

test('the suites run without the tracker token and the alert secrets the judge holds (Issue #1709)', () => {
  assert.deepEqual(suiteEnv({ PATH: '/bin', GITHUB_RUN_ID: '1', WEAVE_TRACKER_TOKEN: 'tkn', SHERIFF_ALERT_URL: 'https://hook', SHERIFF_ALERT_TOKEN: 'alert' }), { PATH: '/bin', GITHUB_RUN_ID: '1' });
});

test('the series history reads every earlier point the workflow downloaded and skips anything else (Issue #1709)', () => {
  const dir = tempDir('weave-trend-history-');
  for (const [run, body] of [['43143618538', JSON.stringify(past('43143618538', 0.139))], ['43142855333', JSON.stringify(past('43142855333', 0.2))], ['broken', '{not json'], ['foreign', JSON.stringify({ id: 'unit-1', summaries: [] })]]) {
    mkdirSync(join(dir, run), { recursive: true });
    writeFileSync(join(dir, run, 'series.json'), body);
  }
  assert.deepEqual(readHistory(dir).map((p) => p.run).sort(), ['43142855333', '43143618538']);
  assert.deepEqual(readHistory(join(dir, 'missing')), []);
  assert.deepEqual(readHistory(undefined), []);
});

test('the trend lane reads every suite in TREND, and each of them logs the reading the parser reads (Issue #1709)', () => {
  assert.deepEqual(Object.keys(SUITES).sort(), [...TREND].sort());
  for (const [file, suite] of Object.entries(SUITES)) {
    assert.ok(readFileSync(file, 'utf8').includes(`t.diagnostic(\`${suite} `), `${file} logs its ${suite} reading as a test diagnostic`);
  }
});
