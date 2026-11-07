import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool, TOOLS } from '../src/mcp.js';

const row = (w, name) => w.listEntities('System/Spaces').find((e) => w.entityName(e) === name);
const schema = (w, name) => w.describeSchema().find((s) => s.space === name);

test('space parents organize stable identities without changing table names', () => {
  const w = new Weave();
  const parent = w.createSpace({ name: 'Work' });
  const child = w.createSpace({ name: 'Projects', parentId: parent.id });
  const table = w.createTable({ space: child.id, name: 'Task' });
  assert.equal(child.parentId, parent.id);
  assert.equal(schema(w, 'Projects').parentId, parent.id);
  assert.equal(w.qualifiedName(table), 'Projects/Task');
  const parentField = w.getField('System/Spaces', 'Parent');
  assert.equal(row(w, 'Projects').values[parentField.id], row(w, 'Work').id);
  w.updateEntity(row(w, 'Projects').id, { Parent: null });
  assert.equal(child.parentId, undefined);
  w.updateEntity(row(w, 'Projects').id, { Parent: row(w, 'Work').id });
  assert.equal(child.parentId, parent.id);
  assert.throws(() => w.updateSpace(parent.id, { parentId: child.id }), /cycle/i);
  assert.throws(() => w.updateSpace(child.id, { parentId: child.id }), /cycle/i);
  assert.throws(() => w.updateSpace(child.id, { parentId: 'System' }), /system/i);
  assert.throws(() => w.updateSpace(child.id, { parentId: 'missing' }), /not found/i);
  assert.throws(() => w.deleteSpace(parent.id), /subspace/i);
  assert.throws(() => w.deleteSpace(parent.id, { hard: true }), /subspace/i);
  w.deleteSpace(child.id);
  w.deleteSpace(parent.id);
  assert.throws(() => w.restoreSpace(child.id), /parent/i);
  w.restoreSpace(parent.id);
  w.restoreSpace(child.id);
  assert.equal(child.parentId, parent.id);
});

test('hub registry parents reject another workspace and inverse writes stay structural', () => {
  const root = new Weave();
  root.createSpace({ name: 'Root' });
  const member = new Weave();
  member.joinRegistry(root);
  const a = member.createSpace({ name: 'Local' });
  const b = member.createSpace({ name: 'Child', parentId: a.id });
  assert.equal(row(root, 'Child').values[root.getField('Spaces', 'Parent').id], row(root, 'Local').id);
  assert.throws(() => root.updateEntity(row(root, 'Child').id, { Parent: row(root, 'Root').id }), /workspace/i);
  root.updateEntity(row(root, 'Child').id, { Parent: null });
  assert.equal(b.parentId, undefined);
  assert.throws(() => root.updateEntity(row(root, 'Local').id, { Subspaces: [row(root, 'Child').id] }), /Parent/i);
});

test('smart spaces match registry tables as guest references without changing ownership', () => {
  const w = new Weave();
  const source = w.createSpace({ name: 'Source' });
  const t = w.createTable({ space: source.id, name: 'Task' });
  const smart = w.createSpace({ name: 'Focus', match: [['Name', 'contains', 'Task']] });
  assert.deepEqual(schema(w, 'Focus').tables, []);
  assert.deepEqual(schema(w, 'Focus').guestTables.map((x) => x.id), [t.id]);
  assert.equal(schema(w, 'Focus').guestTables[0].spaceId, source.id);
  assert.equal(w.getTable(t.id).spaceId, source.id);
  w.createTable({ space: smart.id, name: 'Task' });
  assert.equal(schema(w, 'Focus').guestTables.length, 1);
  assert.equal(schema(w, 'Focus').tables.length, 1);
  w.updateTable(t.id, { name: 'Job' });
  assert.deepEqual(schema(w, 'Focus').guestTables, []);
  w.updateEntity(row(w, 'Focus').id, { Match: '[["Name","=","Job"]]' });
  assert.equal(schema(w, 'Focus').guestTables[0].id, t.id);
  w.deleteSpace(smart.id, { hard: true });
  assert.equal(w.getTable(t.id).spaceId, source.id);
});

test('match validation is eager even with no user tables', () => {
  const w = new Weave();
  for (const match of [{}, [['Name', 'bogus', 'x']], [['Missing', '=', 'x']], [['Name']], [null]]) {
    assert.throws(() => w.createSpace({ name: 'Bad', match }));
    assert.equal(w.findSpace('Bad'), undefined);
  }
  const s = w.createSpace({ name: 'Good', match: [] });
  assert.throws(() => w.updateSpace(s.id, { description: 'changed', match: [['Name', 'bogus', 'x']] }));
  assert.equal(s.description, '');
  assert.throws(() => w.updateEntity(row(w, 'Good').id, { Match: 'not json' }));
  assert.equal(s.match, undefined);
});

test('hub matches are scoped to local live user tables and exclude registry tables', () => {
  const root = new Weave();
  root.createSpace({ name: 'Root' });
  root.createTable({ space: 'Root', name: 'Task' });
  const member = new Weave();
  member.joinRegistry(root);
  member.createSpace({ name: 'Local' });
  const t = member.createTable({ space: 'Local', name: 'Task' });
  member.createSpace({ name: 'Focus', match: [['Name', 'not-empty', null]] });
  assert.deepEqual(schema(member, 'Focus').guestTables.map((x) => x.id), [t.id]);
  member.deleteSpace('Local');
  assert.deepEqual(schema(member, 'Focus').guestTables, []);
});

test('schema and JSON round trips preserve nesting and match; templates leave both behind', () => {
  const w = new Weave();
  w.createSpace({ name: 'Parent' });
  w.createSpace({ name: 'Child', parentId: 'Parent', match: [['Name', '=', 'Task']] });
  const doc = w.describeSchema();
  assert.deepEqual(w.applySchema(doc), []);
  const other = new Weave();
  other.applySchema(doc);
  assert.equal(other.getSpace('Child').parentId, other.getSpace('Parent').id);
  assert.deepEqual(other.getSpace('Child').match, [['Name', '=', 'Task']]);
  const imported = new Weave();
  imported.importJSON(w.exportJSON());
  assert.equal(imported.getSpace('Child').parentId, imported.getSpace('Parent').id);
  const target = new Weave();
  w.useTemplate('Child', target);
  assert.equal(target.getSpace('Child').parentId, undefined);
  assert.equal(target.getSpace('Child').match, undefined);
  const bad = w.exportJSON();
  bad.spaces[w.getSpace('Parent').id].parentId = w.getSpace('Child').id;
  assert.throws(() => imported.importJSON(bad), /cycle/i);
  assert.equal(imported.getSpace('Parent').parentId, undefined);
});

test('MCP and build carry the same parent and match options', async () => {
  const w = new Weave();
  const parent = w.createSpace({ name: 'Parent' });
  await dispatchTool(w, 'weave_create_space', { name: 'Child', parentId: parent.id, match: [['Name', '=', 'Task']] });
  assert.equal(w.getSpace('Child').parentId, parent.id);
  await dispatchTool(w, 'weave_update_space', { space: 'Child', parentId: null, match: [] });
  assert.equal(w.getSpace('Child').parentId, undefined);
  for (const name of ['weave_create_space', 'weave_update_space']) assert.ok(TOOLS.find((t) => t.name === name).inputSchema.properties.parentId);
  const built = w.build({ spaces: [{ name: 'Built', parentId: parent.id, match: [['Name', '=', 'Task']], tables: [] }] });
  assert.deepEqual(built.errors, []);
  assert.equal(w.getSpace('Built').parentId, parent.id);
});
