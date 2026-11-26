import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { Store } from '../src/store.js';
import { tempDir } from './lib/temp.mjs';

const counted = (path) => {
  const store = new Store(path);
  const save = store.save.bind(store);
  store.saves = 0;
  store.save = (...args) => { store.saves++; return save(...args); };
  return store;
};

const fresh = (name = 'w') => {
  const store = counted(join(tempDir('wv-1627-'), `${name}.db`));
  return new Weave({ store });
};

const spec = (tables = 20, fields = 12) => ({
  spaces: [{
    name: 'Work',
    tables: Array.from({ length: tables }, (_, i) => ({
      name: `T${i}`,
      fields: Array.from({ length: fields }, (_, j) => ({ name: `F${j}`, type: j % 2 ? 'number' : 'text' })),
    })),
  }],
});

const userFieldIds = (w) => Object.values(w.state.tables)
  .filter((t) => !t.system && !t.deletedAt)
  .flatMap((t) => Object.values(t.fields).map((f) => f.id))
  .sort();

const registeredFieldIds = (reg, wsId) => {
  const t = reg.getTable('System/Fields');
  const wsF = reg.findField(t, 'Workspace');
  const wsRow = reg.listEntities(reg.getTable('System/Workspaces').id).find((r) => r.sysId === wsId);
  return reg.listEntities(t.id)
    .filter((r) => !wsF || !wsRow || (r.values[wsF.id] ?? wsRow.id) === wsRow.id)
    .map((r) => r.sysId)
    .sort();
};

const registeredTableIds = (reg, w) => {
  const t = reg.getTable('System/Tables');
  const own = new Set(Object.keys(w.state.tables));
  return reg.listEntities(t.id).map((r) => r.sysId).filter((id) => own.has(id)).sort();
};

const liveTableIds = (w) => Object.values(w.state.tables).filter((t) => !t.deletedAt).map((t) => t.id).sort();

const assertRegistryComplete = (w, reg = w) => {
  assert.deepEqual(registeredFieldIds(reg, w.state.meta.id), userFieldIds(w), 'System/Fields has one row per field');
  assert.deepEqual(registeredTableIds(reg, w), liveTableIds(w), 'System/Tables has one row per table');
  assert.deepEqual(w.registryReport().problems, [], 'the registry report finds no problems');
};

test('a fresh file-backed workspace writes its system tables in one save (Issue #1627)', () => {
  const store = counted(join(tempDir('wv-1627-'), 'w.db'));
  const w = new Weave({ store });
  assert.ok(store.saves <= 2, `construction saved ${store.saves} times`);
  assertRegistryComplete(w);
  assertRegistryComplete(new Weave({ path: store.path }));
});

test('build of 20 tables x 12 fields saves a handful of times, not once per verb (Issue #1627)', () => {
  const w = fresh();
  w.store.saves = 0;
  const r = w.build(spec());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(w.store.saves <= 3, `build saved ${w.store.saves} times`);
  assertRegistryComplete(w);
  const again = new Weave({ path: w.store.path });
  assert.deepEqual(userFieldIds(again), userFieldIds(w), 'every field reopens');
  assertRegistryComplete(again);
});

test('applySchema of 20 tables x 12 fields saves a handful of times (Issue #1627)', () => {
  const w = fresh();
  w.createSpace({ name: 'Work' });
  const doc = w.describeSchema();
  doc.find((s) => s.space === 'Work').tables.push(...spec().spaces[0].tables);
  w.store.saves = 0;
  w.applySchema(doc);
  assert.ok(w.store.saves <= 3, `applySchema saved ${w.store.saves} times`);
  assertRegistryComplete(w);
  assertRegistryComplete(new Weave({ path: w.store.path }));
});

test('addField, addRelation and duplicateTable each save once (Issue #1627)', () => {
  const w = fresh();
  w.createSpace({ name: 'Work' });
  w.createTable({ space: 'Work', name: 'Task' });
  w.createTable({ space: 'Work', name: 'Person' });
  for (const [label, verb] of [
    ['addField', () => w.addField('Task', { name: 'Note', type: 'text' })],
    ['addRelation', () => w.addRelation('Task', { name: 'Owner', targetDb: 'Person' })],
    ['duplicateTable', () => w.duplicateTable('Task')],
  ]) {
    w.store.saves = 0;
    verb();
    assert.equal(w.store.saves, 1, `${label} saved ${w.store.saves} times`);
  }
  assertRegistryComplete(w);
  assertRegistryComplete(new Weave({ path: w.store.path }));
});

test('in hub mode a build saves the member and the hub registry a handful of times each, and the hub rows are complete (Issue #1627)', () => {
  const root = fresh('root');
  const member = fresh('member');
  member.joinRegistry(root);
  root.store.saves = 0;
  member.store.saves = 0;
  const r = member.build(spec(5, 6));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(member.store.saves <= 3, `member saved ${member.store.saves} times`);
  assert.ok(root.store.saves <= 3, `hub saved ${root.store.saves} times`);
  assertRegistryComplete(member, root);
  const hub = new Weave({ path: root.store.path });
  assert.deepEqual(registeredFieldIds(hub, member.state.meta.id), userFieldIds(member), 'the hub file keeps one Fields row per member field');
});

test('a build that fails part way still keeps what it wrote, as before (Issue #1627)', () => {
  const w = fresh();
  w.createSpace({ name: 'Work' });
  w.createTable({ space: 'Work', name: 'Task' });
  const before = w.store.saves;
  assert.throws(() => w.addField('Task', { name: 'Bad', type: 'nope' }));
  assert.equal(w.store.saves, before, 'a refused verb writes nothing');
  const again = new Weave({ path: w.store.path });
  assert.ok(again.getTable('Task'));
  assertRegistryComplete(again);
});
