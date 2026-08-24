import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

/* The Workspace system space gains a fourth table, `Workflows` (Kyle,
   2026-08-24): a real system table like the registries, but its rows are
   DATA, not mirrors of structure — each row is one workflow. Shape:
   which tables and spaces it touches (relations into the registries), the
   executable automation script itself (a code document), Version, State
   (Draft / Active / Deactivated), Health (Healthy / Warning / Failed),
   Last Run (a datetime), a Diagram document holding the workflow's mermaid,
   and a Type select that ships EMPTY — types are designed and rolled out
   later, the field is the socket they plug into. */

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  return w;
}
const wfTable = (w) => w.getTable('Workspace/Workflows');
const f = (db, name) => Object.values(db.fields).find((x) => x.name === name);

test('every workspace carries Workspace/Workflows as a system table', () => {
  const w = new Weave();
  const t = wfTable(w);
  assert.equal(t.system, 'workflows');
  assert.equal(w.getSpace('Workspace').system, 'workspace', 'it lives in the Workspace space');
  assert.throws(() => w.deleteTable(t.id), /system/i, 'not deletable');
});

test('the shape: relations, script, version, state, health, last run, diagram, type', () => {
  const w = new Weave();
  const t = wfTable(w);

  const tables = f(t, 'Tables');
  assert.equal(tables.type, 'relation');
  assert.equal(tables.config.many, true, 'a workflow touches many tables');
  assert.equal(w.getTable(tables.config.targetDb).system, 'tables', 'into the Tables registry');

  const spaces = f(t, 'Spaces');
  assert.equal(spaces.type, 'relation');
  assert.equal(spaces.config.many, true);
  assert.equal(w.getTable(spaces.config.targetDb).system, 'spaces', 'into the Spaces registry');

  assert.equal(f(t, 'Script').type, 'document');
  assert.equal(f(t, 'Script').config.kind, 'code', 'the executable script is a code document');

  assert.equal(f(t, 'Version').type, 'number');
  assert.equal(f(t, 'Version').config.decimals, 0);

  const state = f(t, 'State');
  assert.equal(state.type, 'workflow');
  assert.deepEqual(state.config.states.map((s) => s.name), ['Draft', 'Active', 'Deactivated']);
  assert.deepEqual(state.config.states.map((s) => s.category), ['not-started', 'in-progress', 'canceled']);
  assert.equal(state.config.states[0].default, true, 'a new workflow is a Draft');

  const health = f(t, 'Health');
  assert.equal(health.type, 'select');
  assert.deepEqual(health.config.options.map((o) => o.name), ['Healthy', 'Warning', 'Failed']);

  assert.equal(f(t, 'Last Run').type, 'date');
  assert.equal(f(t, 'Last Run').config.time, true, 'a run happens at a time, not on a day');

  assert.equal(f(t, 'Diagram').type, 'document');
  assert.equal(f(t, 'Diagram').config.kind ?? 'markdown', 'markdown', 'mermaid rides in markdown');

  const type = f(t, 'Type');
  assert.equal(type.type, 'select');
  assert.deepEqual(type.config.options, [], 'no workflow types exist yet — the field is the socket');

  for (const name of ['Tables', 'Spaces', 'Script', 'Version', 'State', 'Health', 'Last Run', 'Diagram', 'Type']) {
    assert.equal(f(t, name).system, true, `${name} is a system field`);
  }
});

test('a workflow row is ordinary data: create, link, run, document', () => {
  const w = fresh();
  const t = wfTable(w);
  const taskRow = w.query('Tables', { where: [['Name', '=', 'Task']] }).items[0];
  const devRow = w.query('Spaces', { where: [['Name', '=', 'Dev']] }).items[0];

  const wf = w.createEntity(t.id, {
    Name: 'Nightly enrich',
    Version: 1,
    'Last Run': '2026-08-24T02:00:00.000Z',
  });
  w.link(wf.id, 'Tables', [taskRow.id]);
  w.link(wf.id, 'Spaces', [devRow.id]);
  w.setDoc(wf.id, 'export default async (weave) => {}', 'Script');
  w.setDoc(wf.id, '```mermaid\nflowchart LR\n  A[query Task] --> B[enrich]\n```', 'Diagram');

  const read = w.readEntity(wf.id);
  assert.equal(read.fields.State, 'Draft', 'born a Draft');
  assert.equal(read.fields.Tables.length, 1);
  assert.equal(read.fields.Tables[0].name, 'Task');
  assert.equal(read.fields.Spaces[0].name, 'Dev');
  assert.match(read.docs.Script, /export default/);
  assert.match(read.docs.Diagram, /mermaid/);
  assert.equal(read.raw.Version, 1);
  assert.equal(read.fields.Version, '1', 'the display value wears the number costume');

  w.setState(wf.id, 'State', 'Active');
  w.updateEntity(wf.id, { Health: 'Healthy' });
  const after = w.readEntity(wf.id);
  assert.equal(after.fields.State, 'Active');
  assert.equal(after.fields.Health, 'Healthy');

  // Ordinary rows of a system table delete like data — soft first, restorable.
  w.deleteEntity(wf.id);
  assert.ok(w.getEntity(wf.id) === undefined || w.readEntity(wf.id).deletedAt, 'soft-deleted');
  w.restoreEntity(wf.id);
  assert.equal(w.readEntity(wf.id).deletedAt, null);
});

test('workflow rows do not collide with the registry interceptors', () => {
  const w = fresh();
  const t = wfTable(w);
  const wf = w.createEntity(t.id, { Name: 'Weekly digest' });
  // A rename is a row rename, not a structural verb aimed at nothing.
  w.updateEntity(wf.id, { Name: 'Weekly digest v2', Version: 2 });
  const read = w.readEntity(wf.id);
  assert.equal(read.name, 'Weekly digest v2');
  assert.equal(read.raw.Version, 2);
  // A hard delete is a row delete, not a schema delete.
  w.deleteEntity(wf.id, { hard: true });
  assert.throws(() => w.readEntity(wf.id), /not found/i);
});

test('a legacy workspace grows the Workflows table on load', () => {
  const w = fresh();
  const json = w.exportJSON();
  const t = Object.values(json.tables).find((x) => x.system === 'workflows');
  delete json.tables[t.id];
  // True legacy has neither side: strip the inverse relation fields the
  // registries would have gained, exactly as a pre-Workflows export lacks them.
  for (const reg of Object.values(json.tables)) {
    for (const [fid, fld] of Object.entries(reg.fields ?? {})) {
      if (fld.name === 'Workflows' && fld.type === 'relation' && fld.config.targetDb === t.id) {
        delete reg.fields[fid];
        reg.fieldOrder = reg.fieldOrder.filter((x) => x !== fid);
      }
    }
  }
  const w2 = new Weave();
  w2.importJSON(json);
  assert.equal(wfTable(w2).system, 'workflows');
  assert.equal(f(wfTable(w2), 'Type').type, 'select');
});
