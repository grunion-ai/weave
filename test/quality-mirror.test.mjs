/* The Quality mirror, derived instead of hand-kept.

   Quality/Suite + Quality/Case rows exist to let weave describe its own test
   suite as data. A hand-maintained copy drifts silently (the old seed listed
   9 suites and invented case names). The mirror is now GENERATED: scanSuites
   reads the test files, syncQualityMirror reconciles a workspace to them,
   and the seed uses the same path — so a fresh workspace's mirror is correct
   by construction, and the live one is re-synced by the main watcher after
   every landing. These tests gate the generator itself. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { scanSuites, syncQualityMirror } from '../src/quality-mirror.js';

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
  // A dynamic declaration (test(`slash: ${name}`)) is mirrored as written —
  // one row for the declaration, not one per runtime expansion.
  const slash = byFile['test/slash-commands.test.mjs'];
  assert.ok(slash.cases.some((c) => c.includes('${')), 'template declarations are kept verbatim');
});

test('the seeded workspace mirror equals the scan, by construction', () => {
  const w = seedWeaver(new Weave());
  const scanned = scanSuites(ROOT);
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
  const suite = w.getTable('Quality/Suite');
  const cases = w.getTable('Quality/Case');

  // Drift it four ways: a stale suite, a stale case, a renamed case, and a
  // SECOND row for a file that already has one. The live mirror grew two of
  // those twins (test/applet.test.mjs, test/structure-trash.test.mjs) and no
  // reconcile ever cleared them: keying the existing rows by File into a Map
  // let the later row overwrite the earlier, so the loser was invisible to
  // both the update pass and the prune pass and survived every sync.
  w.createEntity(suite, { name: 'Ghost suite', values: { File: 'test/ghost.test.mjs' } });
  const someRow = w.listEntities(suite.id)[0];
  w.createEntity(cases, { name: 'a case that no longer exists', values: { Suite: someRow.id } });

  const twinned = scanned.find((s) => s.file === 'test/quality-mirror.test.mjs');
  const twin = w.createEntity(suite, { name: 'quality mirror', values: { File: twinned.file } });
  w.createEntity(cases, { name: 'a case only the twin has', values: { Suite: twin.id } });

  const summary = syncQualityMirror(w, scanned);
  assert.ok(summary.removedSuites >= 1 && summary.removedCases >= 1, JSON.stringify(summary));

  assert.equal(w.listEntities(suite.id).length, scanned.length, 'ghost suite purged');

  // One row per File, and the survivor carries the current name and cases.
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
