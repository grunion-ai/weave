/* Promote rehearsal (lifecycle gate, gap 3): prove the NEW code against a
   COPY of real data before it may serve anyone.

   Two fixtures, deliberately different:
   - the copy it is handed (in production: the built-in weave workspace,
     the most data any workspace carries) — exercises open/migration and
     mutation against accumulated real shapes;
   - a fresh workspace built beside the copy — exercises creation from
     nothing, which no data copy can.

   Named steps, run in order, failures reported by name with their reason —
   the same breadcrumb discipline as the review gate. rehearse() MUTATES the
   workspace it opens (and cleans up after itself), so callers hand it a
   copy, never the live file. */

import { join, dirname } from 'node:path';
import { rmSync } from 'node:fs';
import { Weave } from './engine.js';

const SCRATCH = '__rehearsal__';

// The mutation battery every workspace must survive: structure, relations,
// rows, and the full lifecycle matrix the regression pack gates.
function battery(w, label) {
  const steps = [];
  const step = (name, fn) => {
    try { fn(); steps.push({ name: `rehearse: ${label}: ${name}`, ok: true }); }
    catch (err) { steps.push({ name: `rehearse: ${label}: ${name}`, ok: false, error: String(err?.message ?? err) }); }
  };

  let proj; let task; let p; let t;
  step('scratch space, tables and relation created', () => {
    // A crashed earlier rehearsal may have left the scratch space behind.
    if (w.findSpace(SCRATCH)) w.deleteSpace(SCRATCH, { hard: true });
    w.createSpace({ name: SCRATCH });
    proj = w.createTable({ space: SCRATCH, name: 'RehearseProject' });
    task = w.createTable({ space: SCRATCH, name: 'RehearseTask' });
    w.addRelation(task, { name: 'Project', targetDb: proj, cardinality: 'many-to-one', inverseName: 'Tasks' });
    p = w.createEntity(proj, { name: 'Probe project' });
    t = w.createEntity(task, { name: 'Probe task', values: { Project: p.id } });
  });
  step('mutations round-trip: update, relation read, query', () => {
    w.updateEntity(t.id, { Name: 'Probe task 2' });
    if (w.readEntity(p.id).fields.Tasks.length !== 1) throw new Error('relation did not read back');
    if (w.query(task.id, { where: [['Name', '=', 'Probe task 2']] }).total !== 1) throw new Error('query missed the update');
  });
  step('entity delete and restore', () => {
    w.deleteEntity(t.id);
    if (w.query(task.id, {}).total !== 0) throw new Error('soft delete still visible');
    w.restoreEntity(t.id);
    if (w.readEntity(p.id).fields.Tasks.length !== 1) throw new Error('relation lost across restore');
  });
  step('table delete and restore', () => {
    w.deleteTable(task.id);
    if (w.readEntity(p.id).fields.Tasks.length !== 0) throw new Error('trashed table still read through');
    w.restoreTable(task.id);
    if (w.query(task.id, {}).total !== 1) throw new Error('rows lost across table restore');
  });
  step('space delete and restore', () => {
    const spId = w.getTable(proj.id).spaceId;
    w.deleteSpace(spId);
    if (w.findSpace(SCRATCH)) throw new Error('trashed space still findable by name');
    w.restoreSpace(spId);
    if (!w.findSpace(SCRATCH)) throw new Error('space restore did not rejoin');
  });
  step('scratch purged, workspace back to baseline', () => {
    w.deleteSpace(SCRATCH, { hard: true });
    if (w.findSpace(SCRATCH)) throw new Error('purge left the scratch space');
  });
  return steps;
}

export function rehearse(dataPath) {
  const steps = [];
  let w = null;
  try {
    w = new Weave({ path: dataPath });
    steps.push({ name: 'rehearse: copy: workspace opens', ok: true });
  } catch (err) {
    steps.push({ name: 'rehearse: copy: workspace opens', ok: false, error: String(err?.message ?? err) });
    return { ok: false, steps };
  }
  try {
    const schema = w.describeSchema();
    if (!schema.length) throw new Error('describeSchema returned nothing');
    steps.push({ name: 'rehearse: copy: schema describes', ok: true });
  } catch (err) {
    steps.push({ name: 'rehearse: copy: schema describes', ok: false, error: String(err?.message ?? err) });
  }
  steps.push(...battery(w, 'copy'));
  w.store.close?.();

  // Creation from nothing, beside the copy so everything scratch shares one
  // directory and one cleanup.
  const freshPath = join(dirname(dataPath), 'rehearse-fresh.db');
  try {
    rmSync(freshPath, { force: true });
    const fresh = new Weave({ path: freshPath });
    fresh.state.meta.name = 'rehearse-fresh';
    steps.push({ name: 'rehearse: fresh workspace: created from nothing', ok: true });
    steps.push(...battery(fresh, 'fresh workspace'));
    fresh.store.close?.();
  } catch (err) {
    steps.push({ name: 'rehearse: fresh workspace: created from nothing', ok: false, error: String(err?.message ?? err) });
  } finally {
    for (const suffix of ['', '-wal', '-shm']) rmSync(freshPath + suffix, { force: true });
  }

  return { ok: steps.every((s) => s.ok), steps };
}
