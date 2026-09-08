import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, WeaveError } from '../src/engine.js';

/* Feature #219 — the registry lives ONCE, at the weave root.

   The root (the hub's default workspace, or any bare engine) keeps the
   Workspace system space and grows a Workspaces table: one row per
   workspace file. Every registry table carries a Workspace relation. A
   member workspace joins the root's registry instead of minting its own:
   its structure is projected as rows in the root, its structural verbs keep
   those rows true, and a row edit at the root routes to the member's
   structural verb. The truth stays in each workspace's state; the rows are
   a projection the owning engine re-asserts. */

const rowNamed = (w, table, name) => w.listEntities(w.getTable(table).id).find((e) => w.entityName(e) === name);
const field = (w, table, name) => Object.values(w.getTable(table).fields).find((f) => f.name === name);

function root() {
  const r = new Weave();
  r.updateWorkspace({ name: 'root' });
  r.createSpace({ name: 'Docs' });
  r.createTable({ space: 'Docs', name: 'Guide' });
  return r;
}
function member(name = 'uno') {
  const m = new Weave();
  m.updateWorkspace({ name });
  m.createSpace({ name: 'Dev' });
  m.createTable({ space: 'Dev', name: 'Task' });
  m.addField('Dev/Task', { name: 'Cost', type: 'number' });
  return m;
}

test('the root carries a Workspaces table and its own row; every registry table has a Workspace relation', () => {
  const r = root();
  const wsT = r.getTable('Workspace/Workspaces');
  assert.equal(wsT.system, 'workspaces');
  const rows = r.listEntities(wsT.id);
  assert.deepEqual(rows.map((e) => r.entityName(e)), ['root']);
  assert.equal(rows[0].sysId, r.state.meta.id);
  for (const t of ['Spaces', 'Tables', 'Fields', 'Workflows']) {
    const f = field(r, `Workspace/${t}`, 'Workspace');
    assert.equal(f?.type, 'relation', `${t} has no Workspace relation`);
    assert.equal(f.config.targetDb, wsT.id);
    assert.ok(f.system);
  }
  // The root's own structure points at the root's Workspaces row.
  const wsF = field(r, 'Workspace/Tables', 'Workspace');
  assert.equal(rowNamed(r, 'Workspace/Tables', 'Guide').values[wsF.id], rows[0].id);
  assert.equal(r.readEntity(rowNamed(r, 'Workspace/Tables', 'Guide').id).sysWorkspaceId, r.state.meta.id);
});

test('a member joins the root registry: no Workspace space of its own, its structure as root rows', () => {
  const r = root();
  const m = member();
  m.joinRegistry(r);
  assert.equal(m.registryHost, r);
  assert.equal(m.state.meta.registry, 'hub');
  assert.deepEqual(m.listSpaces().map((s) => s.name), ['Dev']);
  assert.throws(() => m.getTable('Workspace/Tables'), WeaveError);
  const wsRow = rowNamed(r, 'Workspace/Workspaces', 'uno');
  assert.equal(wsRow.sysId, m.state.meta.id);
  const wsF = field(r, 'Workspace/Tables', 'Workspace');
  const taskRow = rowNamed(r, 'Workspace/Tables', 'Task');
  assert.equal(taskRow.sysId, m.getTable('Dev/Task').id);
  assert.equal(taskRow.values[wsF.id], wsRow.id);
  assert.equal(r.readEntity(taskRow.id).sysWorkspaceId, m.state.meta.id);
  const spaceF = field(r, 'Workspace/Tables', 'Space');
  assert.equal(taskRow.values[spaceF.id], rowNamed(r, 'Workspace/Spaces', 'Dev').id);
  const costRow = rowNamed(r, 'Workspace/Fields', 'Cost');
  assert.equal(costRow.values[field(r, 'Workspace/Fields', 'Table').id], taskRow.id);
  assert.equal(costRow.values[field(r, 'Workspace/Fields', 'Workspace').id], wsRow.id);
  assert.ok(r.members.includes(m));
  // The Description of a fresh member no longer points at a space it does not have.
  assert.deepEqual(m.registryReport().problems, []);
  assert.deepEqual(r.registryReport().problems, []);
});

test('a member\'s structural verbs keep the root rows true', () => {
  const r = root();
  const m = member();
  m.joinRegistry(r);
  m.updateTable('Dev/Task', { name: 'Job', description: 'work', hiddenFields: ['Cost'] });
  const row = rowNamed(r, 'Workspace/Tables', 'Job');
  assert.ok(row);
  assert.equal(row.values[field(r, 'Workspace/Tables', 'Hidden Fields').id], 'Cost');
  m.addField('Dev/Job', { name: 'Due', type: 'date' });
  assert.ok(rowNamed(r, 'Workspace/Fields', 'Due'));
  m.createSpace({ name: 'Ops' });
  assert.ok(rowNamed(r, 'Workspace/Spaces', 'Ops'));
  m.deleteTable('Dev/Job', { hard: true });
  assert.equal(rowNamed(r, 'Workspace/Tables', 'Job'), undefined);
  assert.equal(rowNamed(r, 'Workspace/Fields', 'Due'), undefined);
  m.deleteSpace('Ops');
  assert.ok(rowNamed(r, 'Workspace/Spaces', 'Ops') === undefined || r.state.entities[rowNamed(r, 'Workspace/Spaces', 'Ops').id].deletedAt);
  assert.deepEqual(r.registryReport().problems, []);
});

test('a root row edit routes to the owning member', () => {
  const r = root();
  const m = member();
  m.joinRegistry(r);
  const row = rowNamed(r, 'Workspace/Tables', 'Task');
  r.updateEntity(row.id, { Name: 'Job', 'Field Order': 'Cost, Name, Description, Chip, Card' });
  const t = m.getTable('Dev/Job');
  assert.equal(t.name, 'Job');
  assert.deepEqual(t.fieldOrder.map((id) => t.fields[id].name), ['Cost', 'Name', 'Description', 'Chip', 'Card']);
  // A create at the root lands in the member the parent row names.
  const made = r.createEntity(r.getTable('Workspace/Tables').id, { name: 'Bug', values: { Space: rowNamed(r, 'Workspace/Spaces', 'Dev').id } });
  assert.ok(m.getTable('Dev/Bug'));
  assert.equal(made.sysId, m.getTable('Dev/Bug').id);
  const f = r.createEntity(r.getTable('Workspace/Fields').id, { name: 'Severity', values: { Table: made.id, Definition: { type: 'text', config: {} } } });
  assert.ok(m.getField('Dev/Bug', 'Severity'));
  assert.equal(f.sysId, m.getField('Dev/Bug', 'Severity').id);
  // A Spaces create names its workspace; the root is the default.
  const sp = r.createEntity(r.getTable('Workspace/Spaces').id, { name: 'Ops', values: { Workspace: rowNamed(r, 'Workspace/Workspaces', 'uno').id } });
  assert.ok(m.getSpace('Ops'));
  assert.equal(sp.sysId, m.getSpace('Ops').id);
  const rootSp = r.createEntity(r.getTable('Workspace/Spaces').id, { name: 'Wiki' });
  assert.equal(rootSp.sysId, r.getSpace('Wiki').id);
  // Delete routes too.
  r.deleteEntity(made.id, { hard: true });
  assert.throws(() => m.getTable('Dev/Bug'), WeaveError);
  assert.deepEqual(r.registryReport().problems, []);
});

test('a legacy member tombstones its own Workspace space and carries its space rollups to the root', () => {
  const r = root();
  const m = member();
  m.createEntity('Dev/Task', { name: 'a', values: { Cost: 10 } });
  m.createEntity('Dev/Task', { name: 'b', values: { Cost: 30 } });
  // Before joining, the member is a root of its own and holds a space rollup.
  const localSpaces = m.getTable('Workspace/Spaces');
  m.addField(localSpaces.id, { name: 'Task · Cost · sum', type: 'rollup', config: { via: 'Dev/Task', targetField: 'Cost', aggregate: 'sum' } });
  assert.equal(m.tableRollups('Dev/Task')[0].value, 40);
  m.joinRegistry(r);
  const ws = Object.values(m.state.spaces).find((s) => s.system === 'workspace');
  assert.ok(ws.deletedAt, 'the legacy space is tombstoned, not purged');
  assert.ok(Object.values(m.state.tables).filter((t) => t.system).every((t) => t.deletedAt));
  assert.equal(m.listSpaces().length, 1);
  // The rollup now lives on the root Spaces table and reads the member's rows.
  const rf = field(r, 'Workspace/Spaces', 'Task · Cost · sum');
  assert.equal(rf?.type, 'rollup');
  assert.equal(rf.config.via, m.getTable('Dev/Task').id);
  const rolled = m.tableRollups('Dev/Task');
  assert.equal(rolled.length, 1);
  assert.equal(rolled[0].value, 40);
  // Adding a via rollup at the root over a member table resolves across.
  r.addField(r.getTable('Workspace/Spaces').id, { name: 'Task · count', type: 'rollup', config: { via: m.getTable('Dev/Task').id, aggregate: 'count' } });
  assert.equal(m.tableRollups('Dev/Task').find((x) => x.name === 'Task · count').value, 2);
  // Only the row of the space that holds the table answers.
  const devRow = rowNamed(r, 'Workspace/Spaces', 'Dev');
  const docsRow = rowNamed(r, 'Workspace/Spaces', 'Docs');
  assert.equal(r.readEntity(devRow.id).fields['Task · count'], 2);
  assert.equal(r.readEntity(docsRow.id).fields['Task · count'], null);
  // Hard-deleting the member table drops its rollups from the root.
  m.deleteTable('Dev/Task', { hard: true });
  assert.equal(field(r, 'Workspace/Spaces', 'Task · count'), undefined);
  assert.equal(field(r, 'Workspace/Spaces', 'Task · Cost · sum'), undefined);
});

test('joining is idempotent and a re-opened member mints nothing until it hosts again', () => {
  const r = root();
  const m = member();
  m.joinRegistry(r);
  m.joinRegistry(r);
  assert.equal(r.listEntities(r.getTable('Workspace/Workspaces').id).length, 2);
  assert.equal(r.listEntities(r.getTable('Workspace/Tables').id).filter((e) => r.entityName(e) === 'Task').length, 1);
  // Re-opened on its own (a CLI beside the hub): the flag holds, no space appears.
  const again = new Weave();
  again.importJSON(m.exportJSON());
  assert.equal(again.state.meta.registry, 'hub');
  assert.deepEqual(again.listSpaces().map((s) => s.name), ['Dev']);
  // Made a root again: the registry comes back.
  again.hostRegistry();
  assert.equal(again.state.meta.registry, undefined);
  assert.ok(again.getTable('Workspace/Tables'));
  assert.ok(rowNamed(again, 'Workspace/Tables', 'Task'));
});

test('leaving the hub drops the member\'s rows from the root', () => {
  const r = root();
  const m = member();
  m.joinRegistry(r);
  r.dropWorkspace(m.state.meta.id);
  assert.equal(rowNamed(r, 'Workspace/Workspaces', 'uno'), undefined);
  assert.equal(rowNamed(r, 'Workspace/Tables', 'Task'), undefined);
  assert.equal(rowNamed(r, 'Workspace/Spaces', 'Dev'), undefined);
  assert.deepEqual(r.registryReport().problems, []);
});
