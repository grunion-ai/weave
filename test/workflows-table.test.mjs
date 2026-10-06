import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { fresh } from './lib/fixtures.mjs';

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
  assert.deepEqual(state.config.states.map((s) => s.name), ['Setup incomplete', 'Ready']);
  assert.deepEqual(state.config.states.map((s) => s.category), ['not-started', 'done']);
  assert.equal(state.config.states[0].default, true, 'a new workflow is Setup incomplete');

  const health = f(t, 'Health');
  assert.equal(health.type, 'select');
  assert.deepEqual(health.config.options.map((o) => o.name), ['Healthy', 'Warning', 'Failed', 'No runs']);
  assert.equal(f(t, 'Health Reason').type, 'text', 'the reason a row Failed, for the hover');

  assert.equal(f(t, 'Last Run').type, 'date');
  assert.equal(f(t, 'Last Run').config.time, true, 'a run happens at a time, not on a day');

  assert.equal(f(t, 'Diagram').type, 'document');
  assert.equal(f(t, 'Diagram').config.kind ?? 'markdown', 'markdown', 'mermaid rides in markdown');

  const type = f(t, 'Type');
  assert.equal(type.type, 'select');
  assert.deepEqual(type.config.options, [], 'no workflow types exist yet — the field is the socket');

  for (const name of ['On', 'Tables', 'Spaces', 'Script', 'Version', 'State', 'Health', 'Health Reason', 'Last Run', 'Diagram', 'Type']) {
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
  assert.equal(read.fields.State, 'Setup incomplete', 'a script that is not a rule is setup still to do (Feature #249)');
  assert.equal(read.fields.Tables.length, 1);
  assert.equal(read.fields.Tables[0].name, 'Task');
  assert.equal(read.fields.Spaces[0].name, 'Dev');
  assert.match(read.docs.Script, /export default/);
  assert.match(read.docs.Diagram, /mermaid/);
  assert.equal(read.raw.Version, 1);
  assert.equal(read.fields.Version, '1', 'the display value wears the number costume');

  w.setState(wf.id, 'State', 'Ready');
  w.updateEntity(wf.id, { Health: 'Healthy' });
  const after = w.readEntity(wf.id);
  assert.equal(after.fields.State, 'Setup incomplete');
  assert.equal(after.fields.Health, 'Healthy');
  assert.equal(after.fields.Tables[0].name, 'Task', 'a row with no rule keeps the Tables written by hand');

  w.deleteEntity(wf.id);
  assert.ok(w.getEntity(wf.id) === undefined || w.readEntity(wf.id).deletedAt, 'soft-deleted');
  w.restoreEntity(wf.id);
  assert.equal(w.readEntity(wf.id).deletedAt, null);
});

test('workflow rows do not collide with the registry interceptors', () => {
  const w = fresh();
  const t = wfTable(w);
  const wf = w.createEntity(t.id, { Name: 'Weekly digest' });
  w.updateEntity(wf.id, { Name: 'Weekly digest v2', Version: 2 });
  const read = w.readEntity(wf.id);
  assert.equal(read.name, 'Weekly digest v2');
  assert.equal(read.raw.Version, 2);
  w.deleteEntity(wf.id, { hard: true });
  assert.throws(() => w.readEntity(wf.id), /not found/i);
});

test('a legacy workspace grows the Workflows table on load', () => {
  const w = fresh();
  const json = w.exportJSON();
  const t = Object.values(json.tables).find((x) => x.system === 'workflows');
  delete json.tables[t.id];
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

test('a Workflows row is ordinary data: a blank name is accepted, as on any table (Issue #241)', () => {
  const w = fresh();
  const row = w.createEntity(wfTable(w).id, { name: '' });
  assert.equal(w.entityName(w.getEntity(row.id)), '');
  assert.throws(() => w.createEntity(w.getTable('Workspace/Spaces').id, { name: '' }), /Name is required/);
});

const names = (t, ids) => ids.map((id) => t.fields[id]?.name ?? id);

test('every Workflows row carries a system On toggle, worded On / Off, off until switched', () => {
  const w = fresh();
  const t = wfTable(w);
  const on = f(t, 'On');
  assert.ok(on, 'the On field exists');
  assert.equal(on.type, 'toggle');
  assert.equal(on.system, true, 'a system field, like the rest of the shape');
  assert.deepEqual(on.config, { on: 'On', off: 'Off' }, 'worded On / Off, with no default: a new workflow starts off');
  const wf = w.createEntity(t.id, { Name: 'Nightly enrich' });
  assert.equal(w.readEntity(wf.id).fields.On, false, 'born off');
  w.setDoc(wf.id, JSON.stringify({ table: 'Dev/Task', trigger: { type: 'entity-created' }, actions: [{ type: 'append-doc', text: 'hi' }] }), 'Script');
  w.updateEntity(wf.id, { On: 'On' });
  assert.equal(w.readEntity(wf.id).fields.On, true, 'the On word switches it on');
  w.updateEntity(wf.id, { On: false });
  assert.equal(w.readEntity(wf.id).fields.On, false, 'and off again');
  assert.equal(w.readEntity(wf.id).fields.State, 'Ready', 'State is setup, not the switch: Off leaves it Ready');
  assert.equal(f(t, 'State').type, 'workflow', 'State stays in place beside it');
});

test('the On switch leads the row: first after Name, in the schema order and in the standard view', () => {
  const w = fresh();
  const t = wfTable(w);
  assert.deepEqual(names(t, t.fieldOrder).slice(0, 3), ['Name', 'On', 'Description']);
  for (const v of t.tableViews) assert.deepEqual(names(t, v.fields).slice(0, 2), ['Name', 'On'], `view ${v.name}`);
  const row = w.query('Tables', { where: [['Name', '=', 'Workflows']] }).items[0];
  assert.match(w.readEntity(row.id).raw['Field Order'], /^Name, On, Description/, 'the Tables row names the same order');
});

test('a workspace from before the switch grows it on load, once, and a later move is kept', () => {
  const w = fresh();
  const json = w.exportJSON();
  const t = Object.values(json.tables).find((x) => x.system === 'workflows');
  const onId = Object.values(t.fields).find((x) => x.name === 'On').id;
  delete t.fields[onId];
  t.fieldOrder = t.fieldOrder.filter((x) => x !== onId);
  for (const v of t.tableViews) v.fields = v.fields.filter((x) => x !== onId);

  const w2 = new Weave();
  w2.importJSON(json);
  const t2 = wfTable(w2);
  assert.equal(Object.values(t2.fields).filter((x) => x.name === 'On').length, 1, 'one On field');
  assert.equal(f(t2, 'On').type, 'toggle');
  assert.equal(f(t2, 'On').system, true);
  assert.deepEqual(names(t2, t2.fieldOrder).slice(0, 2), ['Name', 'On'], 'it lands first after Name');
  for (const v of t2.tableViews) assert.deepEqual(names(t2, v.fields).slice(0, 2), ['Name', 'On']);

  const id = f(t2, 'On').id;
  const view = t2.tableViews[0];
  w2.tableView(`${t2.id}/${view.id}`, { fields: [...names(t2, view.fields).filter((n) => n !== 'On'), 'On'] });
  const again = new Weave();
  again.importJSON(w2.exportJSON());
  const t3 = wfTable(again);
  assert.equal(f(t3, 'On').id, id, 'the same field, not a second one');
  assert.equal(Object.values(t3.fields).filter((x) => x.name === 'On').length, 1);
  assert.equal(names(t3, t3.tableViews[0].fields).at(-1), 'On', 'the reader\'s order survives a re-sync');
});
