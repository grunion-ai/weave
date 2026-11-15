import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const rowNamed = (w, table, name) => w.listEntities(w.getTable(table).id).find((e) => w.entityName(e) === name);

const hub = () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'Docs' });
  root.createTable({ space: 'Docs', name: 'Guide' });
  const member = new Weave();
  member.updateWorkspace({ name: 'uno' });
  member.createSpace({ name: 'Dev' });
  member.createTable({ space: 'Dev', name: 'Task' });
  member.joinRegistry(root);
  return root;
};

test('a Tables record cannot be created inside the system registry space', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const tables = w.getTable('System/Tables');
  const before = w.listTables().length;
  assert.throws(() => w.createEntity(tables.id, { name: 'Mine', values: { Space: 'System' } }), (err) => {
    assert.equal(err.code, 'invalid');
    assert.match(err.message, /Space 'System' is part of the system registry/);
    assert.match(err.message, /create tables in your own spaces/);
    return true;
  });
  assert.equal(w.listTables().length, before);
});

test('a Tables record created in an ordinary space makes a table there', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createEntity(w.getTable('System/Tables').id, { name: 'Mine', values: { Space: 'Dev' } });
  assert.equal(w.getTable('Dev/Mine').name, 'Mine');
});

test('a registry record cannot be moved to another Workspace', () => {
  const root = hub();
  const guide = rowNamed(root, 'System/Tables', 'Guide');
  const uno = rowNamed(root, 'System/Workspaces', 'uno');
  assert.throws(() => root.updateEntity(guide.id, { Workspace: uno.id }), (err) => {
    assert.equal(err.code, 'invalid');
    assert.match(err.message, /Workspace follows the structure it describes and cannot move/);
    return true;
  });
  const space = rowNamed(root, 'System/Spaces', 'Docs');
  assert.throws(() => root.updateEntity(space.id, { Workspace: 'uno' }), /cannot move/);
});

test('a registry record cannot have its Workspace cleared', () => {
  const root = hub();
  const guide = rowNamed(root, 'System/Tables', 'Guide');
  assert.throws(() => root.updateEntity(guide.id, { Workspace: null }), /cannot move/);
});

test('sending the Workspace a registry record already has is accepted, by id or by name', () => {
  const root = hub();
  const guide = rowNamed(root, 'System/Tables', 'Guide');
  const own = rowNamed(root, 'System/Workspaces', 'root');
  assert.doesNotThrow(() => root.updateEntity(guide.id, { Workspace: own.id }));
  assert.doesNotThrow(() => root.updateEntity(guide.id, { Workspace: 'root' }));
  assert.equal(root.readEntity(guide.id).sysWorkspaceId, root.state.meta.id);
});

test('a Users record created with a Name keeps the account named by the creation input', () => {
  const w = new Weave();
  const users = w.getTable('System/Users');
  const made = w.createEntity(users.id, { name: 'Alpha', values: { Kind: 'Agent', Name: 'Beta' } });
  const names = Object.values(w.state.meta.accounts).map((a) => a.name);
  assert.deepEqual(names, ['Alpha']);
  assert.equal(w.entityName(w.getEntity(made.id)), 'Alpha');
});
