import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function buildWorkspace() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  w.addField(tasks, { name: 'Points', type: 'number' });
  w.addField(tasks, { name: 'Notes', type: 'text' });
  w.addField(tasks, { name: 'Owner', type: 'text' });
  w.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const a = w.createEntity(tasks, { name: 'Alpha', values: { Points: 3, Notes: 'first', Owner: 'ada', Project: apollo.id } });
  const b = w.createEntity(tasks, { name: 'Beta', values: { Points: 5, Notes: 'second', Project: apollo.id } });
  return { w, projects, tasks, apollo, a, b };
}

const fieldRow = (w, name) => w.listEntities(w.getTable('Fields').id, { includeDeleted: true }).find((e) => w.entityName(e) === name);
const order = (w, db) => w.getTable(db).fieldOrder.map((id) => w.getTable(db).fields[id].name);

test('a deleted field goes to the trash and restore brings back its values and its place', () => {
  const { w, tasks, a, b } = buildWorkspace();
  const before = order(w, tasks.id);
  w.tableView(`${tasks.id}/Main`, { from: 'blank' });
  const view = w.tableView(`${tasks.id}/Main`, { widths: { Notes: 240 }, sort: [{ field: 'Owner' }, { field: 'Notes', dir: 'desc' }] });
  const viewFields = view.fields;
  assert.ok(viewFields.includes('Notes'));

  w.deleteField(tasks.id, 'Notes');
  assert.equal(w.findField(w.getTable(tasks.id), 'Notes'), undefined, 'the field leaves the table');
  assert.equal(w.readEntity(a.id).fields.Notes, undefined, 'and its values leave the rows');
  assert.ok(w.listAudit().some((x) => x.action === 'field-trashed'));

  const restored = w.restoreField(tasks.id, 'Notes');
  assert.equal(restored.name, 'Notes');
  assert.deepEqual(order(w, tasks.id), before, 'the field returns to its column position');
  assert.equal(w.readEntity(a.id).fields.Notes, 'first', 'values survive the round trip');
  assert.equal(w.readEntity(b.id).fields.Notes, 'second');
  const after = w.tableView(`${tasks.id}/Main`);
  assert.deepEqual(after.fields, viewFields, 'the field returns to its place in the view');
  assert.equal(after.widths?.Notes, 240, 'with its width');
  assert.deepEqual(after.sort, view.sort, 'and its place in the sort');
  assert.ok(w.listAudit().some((x) => x.action === 'field-restored'));
  assert.throws(() => w.restoreField(tasks.id, 'Notes'), /not found|trash/i, 'a field restores once');
});

test('a deleted relation restores both sides and every link', () => {
  const { w, projects, tasks, apollo, a, b } = buildWorkspace();
  const projectOrder = order(w, projects.id);
  w.deleteField(tasks.id, 'Project');
  assert.equal(w.findField(w.getTable(projects.id), 'Tasks'), undefined, 'the inverse leaves with it');

  w.restoreField(tasks.id, 'Project');
  assert.deepEqual(order(w, projects.id), projectOrder, 'the inverse returns to its place');
  assert.equal(w.readEntity(a.id).fields.Project.name, 'Apollo');
  assert.deepEqual(w.readEntity(apollo.id).fields.Tasks.map((t) => t.name).sort(), ['Alpha', 'Beta']);
  w.unlink(b.id, 'Project', [apollo.id]);
  assert.deepEqual(w.readEntity(apollo.id).fields.Tasks.map((t) => t.name), ['Alpha'], 'the restored pair stays wired');
});

test('the trash lists a trashed field by its registry row, and restoring the row restores the field', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteField(tasks.id, 'Points');
  const row = fieldRow(w, 'Points');
  assert.ok(row?.deletedAt, 'the Fields row is trashed, not purged');
  assert.ok(w.listTrash().some((t) => t.id === row.id), 'the trash lists it');

  w.restoreEntity(row.id);
  assert.equal(w.readEntity(a.id).fields.Points, 3);
  assert.equal(fieldRow(w, 'Points').deletedAt, null, 'the row comes back live');
  assert.equal(w.registryReport().problems.length, 0, 'the registry stays whole');
});

test('soft-deleting the Fields row trashes the column; hard on the row purges it', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteEntity(fieldRow(w, 'Owner').id);
  assert.equal(w.findField(w.getTable(tasks.id), 'Owner'), undefined);
  w.restoreEntity(fieldRow(w, 'Owner').id);
  assert.equal(w.readEntity(a.id).fields.Owner, 'ada');

  w.deleteEntity(fieldRow(w, 'Owner').id);
  w.deleteEntity(fieldRow(w, 'Owner').id, { hard: true });
  assert.equal(fieldRow(w, 'Owner'), undefined, 'the row is gone');
  assert.throws(() => w.restoreField(tasks.id, 'Owner'), /not found/i, 'and so is the trashed column');
});

test('purge still removes a field for good, from the trash or straight from the table', () => {
  const { w, tasks } = buildWorkspace();
  w.deleteField(tasks.id, 'Notes');
  w.deleteField(tasks.id, 'Notes', { hard: true });
  assert.throws(() => w.restoreField(tasks.id, 'Notes'), /not found/i);
  assert.equal(fieldRow(w, 'Notes'), undefined);

  w.deleteField(tasks.id, 'Owner', { hard: true });
  assert.throws(() => w.restoreField(tasks.id, 'Owner'), /not found/i, 'hard skips the trash');
  assert.ok(!w.listTrash().some((t) => t.name === 'Owner'));
  assert.deepEqual(w.getTable(tasks.id).trashedFields ?? {}, {});
});

test('a trashed field frees its name; restore refuses while a live field holds it', () => {
  const { w, tasks } = buildWorkspace();
  w.deleteField(tasks.id, 'Notes');
  w.addField(tasks.id, { name: 'Notes', type: 'text' });
  assert.throws(() => w.restoreField(tasks.id, 'Notes'), /already holds|live field/i);
});

test('a field cannot be restored while its table is in the trash', () => {
  const { w, tasks } = buildWorkspace();
  w.deleteField(tasks.id, 'Notes');
  w.deleteTable(tasks.id);
  assert.throws(() => w.restoreField(tasks.id, 'Notes'), /restore the table first/i);
  w.restoreTable(tasks.id);
  assert.equal(w.restoreField(tasks.id, 'Notes').name, 'Notes');
});

test('purging a table purges the fields it held in the trash', () => {
  const { w, tasks } = buildWorkspace();
  w.deleteField(tasks.id, 'Notes');
  w.deleteTable(tasks.id, { hard: true });
  assert.equal(fieldRow(w, 'Notes'), undefined);
});

test('the Name field and system fields still refuse delete, soft or hard', () => {
  const { w, tasks } = buildWorkspace();
  const db = w.getTable(tasks.id);
  assert.throws(() => w.deleteField(tasks.id, db.nameFieldId), /Cannot delete the Name field/);
  assert.throws(() => w.deleteField(tasks.id, db.nameFieldId, { hard: true }), /Cannot delete the Name field/);
  const spaceField = w.findField(w.getTable('Tables'), 'Space');
  assert.throws(() => w.deleteField('Tables', spaceField.id), /system/i);
  assert.throws(() => w.deleteField('Tables', spaceField.id, { hard: true }), /system/i);
  assert.throws(() => w.deleteEntity(fieldRow(w, 'Name')?.id ?? 'none'), /Name field|not found/);
});

test('a trashed field survives an export and import round trip', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteField(tasks.id, 'Notes');
  const reopened = new Weave();
  reopened.importJSON(w.exportJSON());
  reopened.restoreField(tasks.id, 'Notes');
  assert.equal(reopened.readEntity(a.id).fields.Notes, 'first');
});

test('a deleted share page goes to the trash: hidden, unshared while there, restorable', () => {
  const { w } = buildWorkspace();
  const v = w.createView({ name: 'Focus', blocks: [{ table: 'Product/Task' }] });
  const { token } = w.shareView(v.id);

  w.deleteView(v.id);
  assert.equal(w.listViews().length, 0, 'the page leaves the list');
  assert.deepEqual(w.listViews({ trash: true }).map((x) => x.name), ['Focus'], 'the trash lists it');
  assert.ok(w.listViews({ trash: true })[0].deletedAt);
  assert.equal(w.viewByShareToken(token), null, 'its link stops serving');
  assert.throws(() => w.resolveView(v.id), /not found|trash/i);
  assert.ok(w.listAudit().some((x) => x.action === 'view-trashed'));

  const back = w.restoreView(v.id);
  assert.equal(back.name, 'Focus');
  assert.equal(back.deletedAt, undefined);
  assert.equal(w.listViews().length, 1);
  assert.equal(w.listViews({ trash: true }).length, 0);
  assert.equal(w.viewByShareToken(token).id, v.id, 'the link serves again');
  assert.equal(w.resolveView(v.id).blocks[0].items.length, 2);
  assert.ok(w.listAudit().some((x) => x.action === 'view-restored'));
});

test('a restored share page takes back its place in the list, through an export too', () => {
  const { w } = buildWorkspace();
  for (const name of ['One', 'Two', 'Three', 'Four']) w.createView({ name, blocks: [{ table: 'Product/Task' }] });
  const id = (name) => w.listViews().find((x) => x.name === name).id;
  const two = id('Two');
  w.deleteView(two);
  w.restoreView(two);
  assert.deepEqual(w.listViews().map((x) => x.name), ['One', 'Two', 'Three', 'Four'], 'Two is second again, not last');
  assert.equal(w.listViews()[1].position, undefined, 'the live page carries no trash bookkeeping');

  const first = id('One');
  w.deleteView(first);
  const reopened = new Weave();
  reopened.importJSON(w.exportJSON());
  reopened.restoreView(first);
  assert.deepEqual(reopened.listViews().map((x) => x.name), ['One', 'Two', 'Three', 'Four'], 'the place survives an export');
});

test('purging a share page removes it for good, from the trash or directly', () => {
  const { w } = buildWorkspace();
  const v = w.createView({ name: 'Focus', blocks: [{ table: 'Product/Task' }] });
  w.deleteView(v.id);
  w.deleteView(v.id, { hard: true });
  assert.equal(w.listViews({ trash: true }).length, 0);
  assert.throws(() => w.restoreView(v.id), /not found/i);

  const u = w.createView({ name: 'Other', blocks: [] });
  w.deleteView(u.id, { hard: true });
  assert.equal(w.listViews({ trash: true }).length, 0, 'hard skips the trash');
  assert.throws(() => w.restoreView(u.id), /not found/i);
});

test('REST: field and share-page delete are soft, the trash lists both, restore un-deletes, ?hard=1 purges', async () => {
  const { w, tasks, a } = buildWorkspace();
  const v = w.createView({ name: 'Focus', blocks: [{ table: 'Product/Task' }] });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path) => {
    const res = await fetch(base + path, { method });
    return { status: res.status, data: await res.json() };
  };
  try {
    assert.equal((await api('DELETE', `/api/tables/${tasks.id}/fields/Notes`)).status, 200);
    assert.equal((await api('DELETE', `/api/views/${v.id}`)).status, 200);
    const trash = (await api('GET', '/api/trash')).data;
    assert.ok(trash.items.some((i) => i.name === 'Notes'), 'the trash lists the field');
    assert.deepEqual(trash.views.map((x) => x.name), ['Focus'], 'and the share page');
    assert.deepEqual((await api('GET', '/api/views?trash=1')).data.map((x) => x.name), ['Focus']);
    assert.deepEqual((await api('GET', '/api/views')).data, []);

    const restored = await api('POST', `/api/tables/${tasks.id}/fields/Notes/restore`);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.name, 'Notes');
    assert.equal((await api('GET', `/api/entities/${a.id}`)).data.fields.Notes, 'first');
    assert.equal((await api('POST', `/api/views/${v.id}/restore`)).status, 200);
    assert.deepEqual((await api('GET', '/api/views')).data.map((x) => x.name), ['Focus']);

    assert.equal((await api('DELETE', `/api/tables/${tasks.id}/fields/Notes`)).status, 200);
    assert.equal((await api('DELETE', `/api/tables/${tasks.id}/fields/Notes?hard=1`)).status, 200);
    assert.equal((await api('POST', `/api/tables/${tasks.id}/fields/Notes/restore`)).status, 404);
    assert.equal((await api('DELETE', `/api/views/${v.id}?hard=1`)).status, 200);
    assert.equal((await api('POST', `/api/views/${v.id}/restore`)).status, 404);
    assert.deepEqual((await api('GET', '/api/trash')).data.views, []);
  } finally {
    server.close();
  }
});
