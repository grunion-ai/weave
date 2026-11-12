import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, childEnv } from '../scripts/test.mjs';
import { shardResult, digest, plan, aggregate } from '../scripts/ci-test.mjs';
import { realIO, dryIO, retriedFlakes, recordRetries, flakeName, flakeLine } from '../scripts/sheriff.mjs';
import { tempDir } from './lib/temp.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const CI_REPORTER = pathToFileURL(join(ROOT, 'scripts/ci-test-reporter.mjs')).href;
const repoPath = (file) => relative(ROOT, file).split('\\').join('/');
const sha = (n) => n.toString(16).padStart(40, '0');
const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tail = (file) => literal(file.split('/').at(-1));

function fixtures(kinds) {
  const dir = tempDir('weave-retried-');
  const paths = {};
  for (const [name, kind] of Object.entries(kinds)) {
    const file = join(dir, `${name}.test.mjs`);
    const mark = JSON.stringify(join(dir, `${name}.seen`));
    const body = {
      good: "test('good', () => {});\n",
      broken: "test('subject', () => { throw new Error('always'); });\n",
      flaky: `import { existsSync, writeFileSync } from 'node:fs';\ntest('flakes once', () => {\n  const first = !existsSync(${mark});\n  writeFileSync(${mark}, '1');\n  if (first) throw new Error('flaked');\n});\n`,
    }[kind];
    writeFileSync(file, `import test from 'node:test';\n${body}`);
    paths[name] = realpathSync(file);
  }
  return { dir, paths };
}

function runShard(kinds) {
  const { dir, paths } = fixtures(kinds);
  const report = join(dir, 'events.jsonl');
  writeFileSync(report, '');
  const said = [];
  const code = run(Object.values(paths), [`--test-reporter=${CI_REPORTER}`, '--test-reporter-destination=stdout'],
    { out: (line) => said.push(line), env: { ...childEnv(), WEAVE_CI_REPORT: report } });
  const events = readFileSync(report, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const shard = { id: 'unit-1', lane: 'unit', files: Object.values(paths).map(repoPath).sort() };
  const result = shardResult(shard, events, { commit: 'abc', manifest: 'digest', attempt: 1, code, timedOut: false, durationMs: 1 });
  return { code, said: said.join('\n'), result, files: Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, repoPath(v)])) };
}

test('a file that passes on its retry appears in the shard JSON, beside both of its runs (Issue #1671)', () => {
  const { code, said, result, files } = runShard({ good: 'good', flaky: 'flaky' });
  assert.equal(code, 0, 'the retry still turns the lane green');
  assert.deepEqual(result.retried, [files.flaky]);
  assert.deepEqual(result.summaries.filter((s) => s.file === files.flaky).map((s) => s.success), [false, true]);
  assert.match(said, new RegExp(`^# RETRIED and green: 1 file\\(s\\) failed the first run and passed the second: .*${tail(files.flaky)}$`, 'm'));
  const written = JSON.parse(JSON.stringify(result));
  assert.deepEqual(written.retried, [files.flaky], 'the field survives the JSON the shard uploads');
});

test('a retry that saves one file and not another records the one it saved, and a clean run records none (Issue #1671)', () => {
  const mixed = runShard({ flaky: 'flaky', broken: 'broken' });
  assert.equal(mixed.code, 1);
  assert.deepEqual(mixed.result.retried, [mixed.files.flaky]);
  assert.match(mixed.said, /^# RETRIED and green: 1 file\(s\)/m);
  assert.match(mixed.said, new RegExp(`^# RETRIED and still red: .*${tail(mixed.files.broken)}$`, 'm'));
  const clean = runShard({ good: 'good' });
  assert.equal(clean.code, 0);
  assert.deepEqual(clean.result.retried, []);
  assert.doesNotMatch(clean.said, /RETRIED/);
});

test('one shard result is pinned: every record it carried before, in the same order, then the retried list (Issue #1671)', () => {
  const failed = { success: false, counts: { tests: 1, failed: 1, passed: 0, cancelled: 0, skipped: 0, todo: 0, topLevel: 1, suites: 0 }, duration_ms: 12.5, file: 'test/a.test.mjs' };
  const passed = { ...failed, success: true, counts: { ...failed.counts, failed: 0, passed: 1 } };
  const red = { file: 'test/a.test.mjs', name: 'a', nesting: 0, pass: false };
  const green = { ...red, pass: true };
  const skip = { file: 'test/a.test.mjs', reason: 'semgrep not installed' };
  const events = [{ type: 'case', data: red }, { type: 'summary', data: failed }, { type: 'case', data: green }, { type: 'summary', data: passed }, { type: 'skip', data: skip }, { type: 'retried', data: { file: 'test/a.test.mjs' } }];
  const written = shardResult({ id: 'unit-1', lane: 'unit', files: ['test/a.test.mjs'] }, events, { commit: 'abc', manifest: 'd1', attempt: 2, code: 0, timedOut: false, durationMs: 40 });
  assert.equal(JSON.stringify(written, null, 2), JSON.stringify({
    id: 'unit-1', lane: 'unit', files: ['test/a.test.mjs'],
    commit: 'abc', manifest: 'd1', attempt: 2, code: 0, timedOut: false, durationMs: 40,
    summaries: [failed, passed], skips: [skip], cases: [red, green],
    retried: ['test/a.test.mjs'],
  }, null, 2));
  assert.deepEqual(shardResult({ id: 'unit-1' }, [{ type: 'summary', data: passed }], {}).retried, []);
});

test('one aggregate is pinned: the gate summary prints as it did, then one annotation per retried file (Issue #1671)', () => {
  const files = ['test/a.test.mjs', 'test/b-browser.test.mjs'];
  const manifest = plan(files, { unit: [files[0]], browser: [files[1]] }, () => 10, 1, 1);
  const ok = (file, ms) => ({ file, success: true, counts: { tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0 }, duration_ms: ms });
  const bad = (file, ms) => ({ ...ok(file, ms), success: false, counts: { tests: 2, passed: 1, failed: 1, cancelled: 0, skipped: 0 } });
  const shard = (i, attempt, code, summaries, retried) => ({ ...manifest[i], commit: 'abc', manifest: digest(manifest), attempt, code, durationMs: 10, summaries, skips: [], cases: [], retried });
  const results = [
    shard(0, 1, 0, [ok('test/a.test.mjs', 5)], []),
    shard(1, 1, 1, [bad('test/b-browser.test.mjs', 7), bad('test/b-browser.test.mjs', 6)], []),
    shard(1, 2, 0, [bad('test/b-browser.test.mjs', 9), ok('test/b-browser.test.mjs', 8)], ['test/b-browser.test.mjs']),
  ];
  const printed = aggregate(manifest, results, 'abc');
  assert.deepEqual(printed, [
    JSON.stringify({ commit: 'abc', files: 2, tests: 4, slowest: [ok('test/b-browser.test.mjs', 8), ok('test/a.test.mjs', 5)] }, null, 2),
    '::warning file=test/b-browser.test.mjs,title=Passed only on its retry::test/b-browser.test.mjs failed in shard browser-1 and passed when the shard ran it again',
  ]);
  assert.deepEqual(Object.keys(JSON.parse(printed[0])), ['commit', 'files', 'tests', 'slowest'], 'the summary keeps the keys it had');
  const older = results.map(({ retried, ...rest }) => rest);
  assert.deepEqual(aggregate(manifest, older, 'abc'), [printed[0]], 'a shard result from before the field prints the summary alone');
});

test('retried files are read off the attempt that completed, each with the cases that failed first (Issue #1671)', () => {
  const results = [
    { id: 'unit-2', attempt: 1, retried: ['test/backup-stream.test.mjs'], cases: [{ file: 'test/backup-stream.test.mjs', name: 'a 200 MiB push grows the server by less than its budget', pass: false }, { file: 'test/backup-stream.test.mjs', name: 'a 200 MiB push grows the server by less than its budget', pass: true }, { file: 'test/backup-stream.test.mjs', name: 'download streams', pass: true }] },
    { id: 'browser-3', attempt: 2, retried: ['test/phone-option-row-browser.test.mjs'], cases: [] },
    { id: 'browser-1', attempt: 1 },
  ];
  assert.deepEqual(retriedFlakes(results, 1), [{ file: 'test/backup-stream.test.mjs', shard: 'unit-2', cases: ['a 200 MiB push grows the server by less than its budget'] }]);
  assert.deepEqual(retriedFlakes(results, 2).map((f) => f.file), ['test/phone-option-row-browser.test.mjs']);
  assert.match(flakeLine({ at: '2026-11-11', sha: '5c898afaf531713099ebee4ffa4daa3317ce3a7e', url: 'https://github.com/grunion-ai/weave/actions/runs/43114912798', outcome: 'retried-green', shard: 'unit-2', cases: ['a 200 MiB push grows the server by less than its budget'] }),
    /^2026-11-11 5c898afaf5 failed, then passed on the in-shard retry, in unit-2 \(failing case: a 200 MiB push grows the server by less than its budget\): https:\/\/github\.com\/grunion-ai\/weave\/actions\/runs\/43114912798$/);
});

const reply = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });

function tracker(rows = []) {
  let next = 5000;
  const value = (row, field) => (field === 'publicId' ? row.publicId : row.fields[field]);
  const match = (row, [field, op, want]) => (op === '=' ? value(row, field) === want : op === '!=' ? value(row, field) !== want : op === 'contains' ? String(value(row, field)).includes(want) : false);
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(/^\/w\/weave\/api/, '');
    const body = init.body ? JSON.parse(init.body) : {};
    if (path === '/tables/Issue/query') return reply({ items: rows.filter((row) => body.where.every((w) => match(row, w))) });
    if (path === '/tables/Issue/entities') {
      const row = { id: `row-${next}`, publicId: next++, fields: { Name: body.Name, Status: 'Open', Severity: body.Severity }, doc: body.Description };
      rows.push(row);
      return reply(row);
    }
    const [, id, what] = path.match(/^\/entities\/([^/]+)\/(doc|state)$/) ?? [];
    const row = rows.find((r) => r.id === id);
    if (!row) return reply({ error: 'not found' }, 404);
    if (what === 'doc') row.doc += body.doc;
    else row.fields[body.field] = body.state;
    return reply({});
  };
  return { rows, fetch };
}

const env = { WEAVE_TRACKER_TOKEN: 'token', WEAVE_TRACKER_URL: 'https://tracker.test/w/weave' };
const mainRun = (id, head) => ({ id, head_sha: head, html_url: `https://github.com/grunion-ai/weave/actions/runs/${id}` });

test('the flake upsert writes one row per file and updates it on repeat (Issue #1671)', async (t) => {
  const stub = tracker();
  t.mock.method(globalThis, 'fetch', stub.fetch);
  const io = realIO(env);
  await io.logRetried({ run: mainRun(43114912798, '5c898afaf531713099ebee4ffa4daa3317ce3a7e'), file: 'test/backup-stream.test.mjs', shard: 'unit-2', cases: ['a 200 MiB push grows the server by less than its budget'] });
  await io.logRetried({ run: mainRun(43200000000, sha(7)), file: 'test/backup-stream.test.mjs', shard: 'unit-1', cases: [] });
  await io.logRetried({ run: mainRun(43200000000, sha(7)), file: 'test/phone-option-row-browser.test.mjs', shard: 'browser-3', cases: [] });
  assert.deepEqual(stub.rows.map((r) => [r.fields.Name, r.fields.Status, r.fields.Severity]), [
    [flakeName('test/backup-stream.test.mjs'), 'Open', 'Low'],
    [flakeName('test/phone-option-row-browser.test.mjs'), 'Open', 'Low'],
  ]);
  const ledger = stub.rows[0].doc;
  assert.equal(ledger.match(/failed, then passed on the in-shard retry/g).length, 2, 'the repeat lands on the row the first run opened');
  assert.match(ledger, /5c898afaf5 .* in unit-2 .*runs\/43114912798/);
  assert.match(ledger, /0000000000 .* in unit-1: .*runs\/43200000000/);
});

test('a Fixed flake row reopens with the new line, an In Progress row only takes it, and a split pair grows no third row (Issue #1671)', async (t) => {
  const stub = tracker([
    { id: 'r1737', publicId: 1737, fields: { Name: flakeName('test/backup-stream.test.mjs'), Status: 'Fixed' }, doc: 'ledger' },
    { id: 'r1503', publicId: 1503, fields: { Name: flakeName('test/phone-matrix-record-browser.test.mjs'), Status: 'In Progress' }, doc: 'ledger' },
    { id: 'r1351', publicId: 1351, fields: { Name: flakeName('tests browser-1'), Status: 'Fixed' }, doc: 'ledger' },
    { id: 'r1506', publicId: 1506, fields: { Name: flakeName('tests browser-1'), Status: 'Open' }, doc: 'ledger' },
  ]);
  t.mock.method(globalThis, 'fetch', stub.fetch);
  const io = realIO(env);
  const at = mainRun(43200000000, sha(7));
  await io.logRetried({ run: at, file: 'test/backup-stream.test.mjs', shard: 'unit-2', cases: [] });
  await io.logRetried({ run: at, file: 'test/phone-matrix-record-browser.test.mjs', shard: 'browser-5', cases: [] });
  await io.logFlake({ run: { ...at, head_sha: sha(8) }, files: [], jobs: [{ name: 'tests browser-1', step: 'Run complete shard' }] });
  assert.equal(stub.rows.length, 4, 'no file or shard got a second row');
  const row = (id) => stub.rows.find((r) => r.publicId === id);
  assert.equal(row(1737).fields.Status, 'Open');
  assert.match(row(1737).doc, /flaked again after this row was marked Fixed/);
  assert.match(row(1737).doc, /in-shard retry, in unit-2/);
  assert.equal(row(1503).fields.Status, 'In Progress');
  assert.match(row(1503).doc, /in-shard retry, in browser-5/);
  assert.equal(row(1351).doc, 'ledger', 'the old Fixed twin stays as it was');
  assert.match(row(1506).doc, /0000000000 failed, then passed on rerun at the Run complete shard step/);
});

test('a flake row that is In Progress still marks its file as a tracked flake, so the sheriff convicts no commit for it (Issue #1671)', async (t) => {
  const stub = tracker([
    { id: 'r1503', publicId: 1503, fields: { Name: flakeName('test/phone-matrix-record-browser.test.mjs'), Status: 'In Progress' }, doc: '' },
    { id: 'r1737', publicId: 1737, fields: { Name: flakeName('test/backup-stream.test.mjs'), Status: 'Fixed' }, doc: '' },
  ]);
  t.mock.method(globalThis, 'fetch', stub.fetch);
  assert.deepEqual(await realIO(env).openFlakes(['test/phone-matrix-record-browser.test.mjs', 'test/backup-stream.test.mjs']), [{ file: 'test/phone-matrix-record-browser.test.mjs', publicId: 1503 }]);
});

function fakeRuns(attempts, results) {
  const logged = [];
  const logs = [];
  const io = {
    repo: 'grunion-ai/weave',
    log: (line) => logs.push(line),
    run: async (id) => ({ ...attempts.at(-1), id }),
    attempt: async (id, n) => ({ ...attempts[n - 1], id }),
    shardResults: async () => results,
    logRetried: async (spec) => logged.push(spec),
  };
  return { io, logged, logs };
}

const testsRun = (patch = {}) => ({ name: 'tests', path: '.github/workflows/test.yml', event: 'push', head_branch: 'main', head_repository: { full_name: 'grunion-ai/weave' }, status: 'completed', conclusion: 'success', head_sha: sha(9), html_url: 'https://github.com/grunion-ai/weave/actions/runs/9', ...patch });

test('after every completed main tests run, each file that passed only on its retry gets one line, read off that attempt (Issue #1671)', async () => {
  const results = [
    { id: 'unit-2', attempt: 1, retried: ['test/backup-stream.test.mjs'], cases: [] },
    { id: 'browser-3', attempt: 2, retried: ['test/phone-option-row-browser.test.mjs'], cases: [] },
  ];
  for (const conclusion of ['success', 'failure']) {
    const f = fakeRuns([testsRun({ conclusion, run_attempt: 1 }), testsRun({ status: 'in_progress', conclusion: null, run_attempt: 2 })], results);
    const out = await recordRetries(9, f.io, { attempt: 1 });
    assert.deepEqual(out.files, ['test/backup-stream.test.mjs'], conclusion);
    assert.deepEqual(f.logged.map((l) => [l.file, l.shard, l.run.head_sha]), [['test/backup-stream.test.mjs', 'unit-2', sha(9)]]);
  }
  const second = fakeRuns([testsRun({ conclusion: 'failure', run_attempt: 1 }), testsRun({ conclusion: 'success', run_attempt: 2 })], results);
  assert.deepEqual((await recordRetries(9, second.io, { attempt: 2 })).files, ['test/phone-option-row-browser.test.mjs']);
  for (const patch of [{ event: 'workflow_dispatch' }, { head_branch: 'feature' }, { conclusion: 'cancelled' }, { head_repository: { full_name: 'fork/weave' } }]) {
    const f = fakeRuns([testsRun(patch)], results);
    assert.equal((await recordRetries(9, f.io, { attempt: 1 })).action, 'skip', JSON.stringify(patch));
    assert.deepEqual(f.logged, []);
  }
  const dry = fakeRuns([testsRun()], results);
  const io = dryIO(dry.io);
  await recordRetries(9, io, { attempt: 1 });
  assert.deepEqual(dry.logged, []);
  assert.ok(dry.logs.some((l) => l.includes('would log an in-shard flake') && l.includes('test/backup-stream.test.mjs')), dry.logs.join('\n'));
});

test('the sheriff workflow records retried files after every completed main tests run, from main\'s own code (Issue #1671)', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/sheriff.yml'), 'utf8');
  assert.ok(yml.includes('\n  flakes:\n'), 'a flakes job sits beside the sheriff job');
  const flakes = yml.slice(yml.indexOf('\n  flakes:\n') + 1);
  for (const guard of ["github.event_name == 'workflow_run'", "github.event.workflow_run.conclusion == 'success' || github.event.workflow_run.conclusion == 'failure'", "github.event.workflow_run.event == 'push'", "github.event.workflow_run.head_branch == 'main'", 'github.event.workflow_run.head_repository.full_name == github.repository']) {
    assert.ok(flakes.includes(guard), guard);
  }
  assert.doesNotMatch(flakes, /run_attempt == 1/, 'a rerun attempt records its own retries too');
  assert.match(flakes, /permissions:\n      contents: read\n      actions: read\n    steps:/);
  assert.match(flakes, /ref: main\n/);
  assert.match(flakes, /run: node scripts\/sheriff\.mjs --retries\n/);
  assert.match(flakes, /SHERIFF_RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/);
  assert.match(flakes, /SHERIFF_RUN_ATTEMPT: \$\{\{ github\.event\.workflow_run\.run_attempt \}\}/);
  assert.match(flakes, /WEAVE_TRACKER_TOKEN: \$\{\{ secrets\.WEAVE_TRACKER_TOKEN \}\}/);
});
