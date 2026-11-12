import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { Weave } from '../src/engine.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { scanSuites, syncQualityMirror, caseResults, planQualityMirror } from '../src/quality-mirror.js';
import { tempDir } from './lib/temp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('scanSuites finds every test file with its declared case names', () => {
  const suites = scanSuites(ROOT);
  const byFile = Object.fromEntries(suites.map((s) => [s.file, s]));

  assert.ok(suites.length >= 90, `the whole test tree is scanned (got ${suites.length})`);
  assert.ok(byFile['test/quality-mirror.test.mjs'], 'this very file is a suite');
  assert.ok(byFile['test/regression/lifecycle.test.mjs'], 'subdirectories are scanned');
  assert.ok(byFile['test/quality-mirror.test.mjs'].cases
    .includes('scanSuites finds every test file with its declared case names'), 'this very test is a case');

  for (const s of suites) {
    assert.ok(s.name && s.file.startsWith('test/'), 'every suite carries a name and a repo-relative file');
    assert.ok(s.cases.length >= 1, `${s.file} declares at least one case`);
  }
  const slash = byFile['test/slash-commands.test.mjs'];
  assert.ok(slash.cases.some((c) => c.includes('${')), 'template declarations are kept verbatim');
});

test('the first sync builds the mirror on a docs workspace the seed left without one, equal to the scan (Issue #1595)', () => {
  const w = seedWeaver(new Weave());
  assert.equal(w.findTable('Quality/Suite'), undefined, 'the seed carries no mirror of the test suite');
  const scanned = scanSuites(ROOT);
  assert.deepEqual(syncQualityMirror(w, scanned, { dryRun: true }).createdSuites, scanned.length, 'a dry run plans the whole mirror');
  assert.equal(w.findTable('Quality/Suite'), undefined, 'and builds nothing');
  syncQualityMirror(w, scanned);
  const suiteRows = w.listEntities(w.getTable('Quality/Suite').id);
  assert.equal(suiteRows.length, scanned.length, 'one Suite row per test file');

  const fileField = Object.values(w.getTable('Quality/Suite').fields).find((f) => f.name === 'File');
  const rowsByFile = new Map(suiteRows.map((r) => [r.values[fileField.id], r]));
  for (const s of scanned) {
    const row = rowsByFile.get(s.file);
    assert.ok(row, `missing Suite row for ${s.file}`);
    const caseNames = w.readEntity(row.id).fields.Cases.map((c) => c.name).sort();
    assert.deepEqual(caseNames, [...s.cases].sort(), `case drift in ${s.file}`);
  }
});

test('syncQualityMirror reconciles an existing drifted mirror without duplicating', () => {
  const w = seedWeaver(new Weave());
  const scanned = scanSuites(ROOT);
  syncQualityMirror(w, scanned);
  const suite = w.getTable('Quality/Suite');
  const cases = w.getTable('Quality/Case');

  w.createEntity(suite, { name: 'Ghost suite', values: { File: 'test/ghost.test.mjs' } });
  const someRow = w.listEntities(suite.id)[0];
  w.createEntity(cases, { name: 'a case that no longer exists', values: { Suite: someRow.id } });

  const twinned = scanned.find((s) => s.file === 'test/quality-mirror.test.mjs');
  const twin = w.createEntity(suite, { name: 'quality mirror', values: { File: twinned.file } });
  w.createEntity(cases, { name: 'a case only the twin has', values: { Suite: twin.id } });

  const summary = syncQualityMirror(w, scanned);
  assert.ok(summary.removedSuites >= 1 && summary.removedCases >= 1, JSON.stringify(summary));

  assert.equal(w.listEntities(suite.id).length, scanned.length, 'ghost suite purged');

  const fileField = Object.values(suite.fields).find((f) => f.name === 'File');
  const files = w.listEntities(suite.id).map((r) => r.values[fileField.id]);
  assert.equal(new Set(files).size, files.length, 'no test file is mirrored by two Suite rows');
  const kept = w.listEntities(suite.id).filter((r) => r.values[fileField.id] === twinned.file);
  assert.equal(kept.length, 1, 'the twin collapsed into one row');
  assert.notEqual(kept[0].id, twin.id, 'the older row survives — anything linking to it still resolves');
  assert.equal(w.entityName(kept[0]), twinned.name, 'the survivor carries the scanned name');
  assert.deepEqual(
    w.readEntity(kept[0].id).fields.Cases.map((c) => c.name).sort(),
    [...twinned.cases].sort(),
    'the survivor carries the scanned cases — the Case Count rollup matches disk',
  );
  assert.ok(
    !w.listEntities(cases.id).some((c) => w.entityName(c) === 'a case only the twin has'),
    "the twin's cases went with it",
  );
  const again = syncQualityMirror(w, scanned);
  assert.deepEqual(
    { createdSuites: again.createdSuites, createdCases: again.createdCases, removedSuites: again.removedSuites, removedCases: again.removedCases },
    { createdSuites: 0, createdCases: 0, removedSuites: 0, removedCases: 0 },
    'a second sync is a no-op — the reconcile is idempotent',
  );
});

function shardFromRun(source, runs = 1) {
  const dir = tempDir('weave-quality-run-');
  try {
    const file = join(dir, 'example.test.mjs');
    const report = join(dir, 'events.jsonl');
    const state = join(dir, 'state');
    writeFileSync(report, '');
    writeFileSync(file, source.replaceAll('STATE', JSON.stringify(state)));
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    for (let i = 0; i < runs; i++) {
      spawnSync(process.execPath, ['--test', `--test-reporter=${resolve(ROOT, 'scripts/ci-test-reporter.mjs')}`, file], { cwd: dir, env: { ...env, WEAVE_CI_REPORT: report }, encoding: 'utf8' });
    }
    const events = readFileSync(report, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return { id: 'unit-1', attempt: 1, files: ['example.test.mjs'], summaries: events.filter((e) => e.type === 'summary').map((e) => e.data), cases: events.filter((e) => e.type === 'case').map((e) => e.data) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('the CI reporter records a pass or fail per case, and a case that fails then passes on the retry reads Flaky (Issue #1245)', () => {
  const shard = shardFromRun(`import test from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
test('holds', () => {});
test('breaks', () => { throw new Error('red'); });
test('wobbles', () => { if (!existsSync(STATE)) { writeFileSync(STATE, '1'); throw new Error('first try'); } });
for (const n of [1]) test(\`made \${n}\`, () => {});
`, 2);
  assert.ok(shard.cases.every((c) => c.file === 'example.test.mjs' && typeof c.pass === 'boolean'), JSON.stringify(shard.cases));
  const results = caseResults([shard]);
  const file = results.get('example.test.mjs');
  assert.equal(file.ok, false, 'a file with a case red on every attempt is red');
  assert.equal(file.cases.get('holds'), 'Passing');
  assert.equal(file.cases.get('breaks'), 'Failing');
  assert.equal(file.cases.get('wobbles'), 'Flaky');
  assert.equal(file.cases.get('made 1'), 'Passing');
});

test('caseResults keeps the newest attempt of a shard, so a re-run job replaces its first result (Issue #1245)', () => {
  const at = (attempt, pass) => ({ id: 'unit-1', attempt, summaries: [{ file: 'test/a.test.mjs', success: pass }], cases: [{ file: 'test/a.test.mjs', name: 'one', pass }] });
  assert.equal(caseResults([at(2, true), at(1, false)]).get('test/a.test.mjs').cases.get('one'), 'Passing');
  assert.equal(caseResults([at(1, true), at(2, false)]).get('test/a.test.mjs').cases.get('one'), 'Failing');
});

const ROWS = () => [
  { id: 's1', publicId: 1, name: 'A', file: 'test/a.test.mjs', cases: [{ id: 'c1', name: 'one', status: 'Passing' }, { id: 'c2', name: 'two', status: 'Passing' }, { id: 'c9', name: 'gone', status: 'Passing' }] },
  { id: 's2', publicId: 2, name: 'Deleted', file: 'test/deleted.test.mjs', cases: [{ id: 'c3', name: 'x', status: 'Passing' }] },
];
const SCAN = [
  { name: 'A', file: 'test/a.test.mjs', cases: ['one', 'two', '${theme}: three'] },
  { name: 'B', file: 'test/b.test.mjs', cases: ['new'] },
];

test('the plan writes a red case Failing, creates new cases with their run result, and removes a suite whose file is gone (Issue #1244, Issue #1245)', () => {
  const results = new Map([
    ['test/a.test.mjs', { ok: false, cases: new Map([['one', 'Passing'], ['two', 'Failing']]) }],
    ['test/b.test.mjs', { ok: true, cases: new Map([['new', 'Passing']]) }],
  ]);
  const { ops, summary } = planQualityMirror(ROWS(), SCAN, results);
  assert.deepEqual(ops.filter((o) => o.op === 'status'), [{ op: 'status', id: 'c2', status: 'Failing' }]);
  assert.deepEqual(ops.find((o) => o.op === 'createCase'), { op: 'createCase', suite: 's1', name: '${theme}: three', status: null }, 'a template name no run reports keeps the default while its file is red');
  assert.deepEqual(ops.find((o) => o.op === 'createSuite'), { op: 'createSuite', name: 'B', file: 'test/b.test.mjs', cases: [{ name: 'new', status: 'Passing' }] });
  assert.deepEqual(ops.filter((o) => o.op === 'deleteCase').map((o) => o.id).sort(), ['c3', 'c9']);
  assert.deepEqual(ops.filter((o) => o.op === 'deleteSuite').map((o) => o.id), ['s2']);
  assert.deepEqual(summary.missingFiles, ['test/deleted.test.mjs'], 'the drift names the suite that points at a deleted file');
  assert.equal(summary.statusChanges, 1);
});

test('a green file marks a case no run names Passing, and with no results the plan never touches Status (Issue #1245)', () => {
  const green = new Map([['test/a.test.mjs', { ok: true, cases: new Map([['one', 'Passing'], ['two', 'Passing']]) }]]);
  assert.equal(planQualityMirror(ROWS(), SCAN, green).ops.find((o) => o.op === 'createCase').status, 'Passing');
  const blind = planQualityMirror(ROWS(), SCAN, null);
  assert.equal(blind.ops.filter((o) => o.op === 'status').length, 0);
  assert.equal(blind.ops.find((o) => o.op === 'createCase').status, null);
});

test('syncQualityMirror writes the run result onto Case Status and a second sync writes nothing (Issue #1245)', () => {
  const w = seedWeaver(new Weave());
  const scanned = scanSuites(ROOT);
  syncQualityMirror(w, scanned);
  const target = scanned.find((s) => s.file === 'test/quality-mirror.test.mjs');
  const named = target.cases[0];
  const results = new Map([[target.file, { ok: false, cases: new Map([[named, 'Failing']]) }]]);
  const first = syncQualityMirror(w, scanned, { results });
  assert.equal(first.statusChanges, 1);
  const suite = w.listEntities(w.getTable('Quality/Suite').id).find((r) => w.entityName(r) === target.name);
  const row = w.readEntity(suite.id).fields.Cases.find((c) => c.name === named);
  assert.equal(w.readEntity(row.id).fields.Status, 'Failing');
  const again = syncQualityMirror(w, scanned, { results });
  assert.deepEqual([again.createdSuites, again.createdCases, again.removedSuites, again.removedCases, again.renamedSuites, again.statusChanges], [0, 0, 0, 0, 0, 0]);
});
