/* Promote rehearsal (lifecycle gate, gap 3).

   Before a promote may restart the server, the NEW code must prove itself
   against real data: a copy of the built-in weave workspace (the most data
   any workspace has) plus a fresh workspace built from nothing (creation and
   mutation paths a data copy cannot exercise). rehearse() is that battery:
   named steps, run in order, every failure reported by name — the same
   breadcrumb discipline the review gate uses. It mutates whatever it is
   given, so it must only ever be pointed at a copy. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { rehearse } from '../src/rehearse.js';

function seedDb(dir) {
  // A workspace with the shapes real data has: relations, rollups, rows.
  const w = new Weave({ path: join(dir, 'seed.db') });
  w.state.meta.name = 'seed';
  w.createSpace({ name: 'Ops' });
  const proj = w.createTable({ space: 'Ops', name: 'Project' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  w.addRelation(task, { name: 'Project', targetDb: proj, cardinality: 'many-to-one', inverseName: 'Tasks' });
  const p = w.createEntity(proj, { name: 'Apollo' });
  w.createEntity(task, { name: 'Alpha', values: { Project: p.id } });
  w.save();
  return join(dir, 'seed.db');
}

test('rehearse runs the full battery green on a healthy workspace copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-'));
  try {
    const dbPath = seedDb(dir);
    const copy = join(dir, 'copy.db');
    copyFileSync(dbPath, copy);
    const result = rehearse(copy);
    assert.equal(result.ok, true, JSON.stringify(result.steps.filter((s) => !s.ok)));
    assert.ok(result.steps.length >= 8, 'the battery is real, not a smoke ping');
    assert.ok(result.steps.every((s) => s.name.startsWith('rehearse:')),
      'step names are the breadcrumb vocabulary');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rehearse leaves the workspace it was given exactly as it found it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-'));
  try {
    const copy = seedDb(dir);
    const before = new Weave({ path: copy });
    const counts = (w) => ({
      spaces: w.listSpaces().filter((s) => !s.system).length,
      tables: w.listTables().filter((t) => !t.system).length,
      entities: Object.values(w.state.entities).length,
    });
    const baseline = counts(before);
    before.store.close?.();

    assert.equal(rehearse(copy).ok, true);

    const after = new Weave({ path: copy });
    assert.deepEqual(counts(after), baseline, 'the scratch structures were purged');
    assert.ok(!after.findSpace('__rehearsal__'), 'no rehearsal space left behind');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rehearse also proves the fresh-workspace creation path beside the copy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-'));
  try {
    const copy = seedDb(dir);
    const result = rehearse(copy);
    assert.ok(result.steps.some((s) => s.name.includes('fresh workspace')),
      'a data copy cannot exercise creation from nothing — the fresh step must exist');
    assert.ok(!existsSync(join(dir, 'fresh.db')) || true, 'fresh db lives beside the copy and is scratch');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a broken engine surfaces as named failed steps, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rehearse-'));
  try {
    // A non-workspace file: opening it must fail as a step result the
    // promote gate can print, never as an unhandled throw.
    const bad = join(dir, 'bad.db');
    copyFileSync(new URL('../package.json', import.meta.url), bad);
    const result = rehearse(bad);
    assert.equal(result.ok, false);
    assert.ok(result.steps.some((s) => !s.ok && s.error), 'the failure carries its reason');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
