import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tempDir } from './lib/temp.mjs';
import { Weave, detachHubRegistry, deferMigrations, runDeferredMigrations } from '../src/engine.js';
import { createForm, getForm } from '../src/forms.js';

const setup = () => {
  const root = new Weave({ name: 'root' });
  const member = new Weave({ name: 'member' });
  member.createSpace({ name: 'Work' });
  const table = member.createTable({ space: 'Work', name: 'Task' });
  const account = member.createAccount({ name: 'member-user', role: 'architect' });
  const users = member.getTable('System/Users');
  const user = member.listEntities(users.id)[0];
  member.addRelation(table.id, { name: 'Owner', targetDb: users.id, cardinality: 'many-to-one' });
  const task = member.createEntity(table.id, { name: 'Keep', values: { Owner: user.id } });
  member.joinRegistry(root);
  const form = createForm(member, { name: 'Intake', table: table.id, fields: ['Name'] });
  return { root, member, table, account, task, form };
};

test('detach preserves local relations, root form IDs, accounts and independent registry', () => {
  const { root, member, account, task, form } = setup();
  const rootUsers = root.getTable('System/Users');
  const memberUser = root.listEntities(rootUsers.id).find(row => row.sysId === account.account.id);
  detachHubRegistry(root, [member]);
  assert.equal(member.registryHost, null);
  assert.equal(member.state.meta.registry, undefined);
  assert.equal(member.getTable('System/Users').id, rootUsers.id);
  assert.equal(member.readEntity(task.id).fields.Owner.id, memberUser.id);
  assert.equal(member.verifyToken(account.token).id, account.account.id);
  assert.equal(getForm(member, form.id).id, form.id);
  assert.deepEqual(member.registryReport().problems, []);
  assert.equal(root.listEntities(rootUsers.id).some(row => row.id === memberUser.id), false);
  const before = JSON.stringify(member.state);
  detachHubRegistry(root, [member]);
  assert.equal(JSON.stringify(member.state), before);
});

test('detach refuses cross-workspace custom relation before mutation', () => {
  const { root, member } = setup();
  const other = new Weave({ name: 'other' });
  const account = other.createAccount({ name: 'Other user', role: 'observer' });
  other.joinRegistry(root);
  const spaces = root.getTable('System/Spaces');
  const users = root.getTable('System/Users');
  const external = root.listEntities(users.id).find(row => row.sysId === account.account.id);
  const f = root.addRelation(spaces.id, { name: 'External', targetDb: users.id, cardinality: 'many-to-one' }).field;
  const row = root.listEntities(spaces.id).find(row => row.sysId === member.getSpace('Work').id);
  row.values[f.id] = external.id;
  const before = [root, member, other].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, [member, other]), /cross-workspace|cannot detach/i);
  assert.deepEqual([root, member, other].map(w => JSON.stringify(w.state)), before);
});

test('detach keeps text equal to a remapped ID literal', () => {
  const { root, member, table, task } = setup();
  const oldUsers = Object.values(member.state.tables).find(t => t.system === 'users');
  member.addField(table.id, { name: 'Literal', type: 'text' });
  member.updateEntity(task.id, { Literal: oldUsers.id });
  detachHubRegistry(root, [member]);
  assert.equal(member.readEntity(task.id).fields.Literal, oldUsers.id);
});

test('detach resumes source cleanup after a committed member and failed root save', () => {
  const { root, member, form } = setup();
  const save = root.save.bind(root);
  root.save = () => { throw new Error('root write failed'); };
  assert.throws(() => detachHubRegistry(root, [member]), /root write failed/);
  root.save = save;
  root.state.entities[form.id].deletedAt = null;
  assert.equal(getForm(member, form.id).id, form.id);
  detachHubRegistry(root, [member]);
  assert.ok(root.state.entities[form.id].deletedAt);
  assert.equal(getForm(member, form.id).id, form.id);
});

test('detach preserves migrated automation ID and executes it once locally', () => {
  const { root, member, table } = setup();
  const rule = member.createAutomation(table.id, { name: 'Stamp', trigger: { type: 'entity-created' }, actions: [{ type: 'append-doc', text: 'once' }] });
  detachHubRegistry(root, [member]);
  assert.ok(member.state.entities[rule.id]);
  assert.ok(root.state.entities[rule.id].deletedAt);
  const made = member.createEntity(table.id, { name: 'After' });
  assert.equal(member.getDoc(made.id).trim(), 'once');
});

test('detach refuses a protected member without a local account before mutation', () => {
  const root = new Weave({ name: 'root' });
  const member = new Weave({ name: 'locked' });
  member.setRequireAuth(true);
  member.joinRegistry(root);
  const before = [root, member].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, [member]), /locked.*no local account/);
  assert.deepEqual([root, member].map(w => JSON.stringify(w.state)), before);
});

test('shared keys and credential reveal are restricted to the owning workspace', () => {
  const keystorePath = join(tempDir('weave-workspace-keys-'), 'keystore.json');
  const a = new Weave({ name: 'a', keystorePath });
  const b = new Weave({ name: 'b', keystorePath });
  const owner = a.createAccount({ name: 'owner', role: 'architect' }).account;
  const peer = a.createAccount({ name: 'peer', role: 'observer' }).account;
  const outsider = b.createAccount({ name: 'outsider', role: 'architect' }).account;
  a.localKeyAccess = b.localKeyAccess = false;
  a.actor = `account:${owner.id}`;
  a.setKey('shared', 'private-value');
  a.grantKey('shared', true);
  a.actor = `account:${peer.id}`;
  assert.equal(a.revealKey('shared'), 'private-value');
  b.actor = `account:${outsider.id}`;
  assert.deepEqual(b.listKeys(), []);
  assert.throws(() => b.revealKey('shared'), /not shared/);
  assert.throws(() => b.resolveKey('shared'), /another workspace/);
  assert.throws(() => b.setKey('shared', 'replacement'), /Only/);
  assert.throws(() => b.deleteKey('shared'), /Only/);
  const empty = new Weave({ name: 'empty', keystorePath });
  empty.localKeyAccess = false;
  assert.throws(() => empty.revealKey('shared'), /not shared/);
  assert.throws(() => empty.resolveKey('shared'), /another workspace/);
});

test('deferred migration keeps disk unchanged until migrate and propagates write failure', () => {
  const dir = tempDir('weave-detach-deferred-');
  const rootPath = join(dir, 'root.db');
  const memberPath = join(dir, 'member.db');
  let root = new Weave({ path: rootPath, name: 'root' });
  let member = new Weave({ path: memberPath, name: 'member' });
  member.joinRegistry(root);
  root.store.close();
  member.store.close();
  deferMigrations();
  root = new Weave({ path: rootPath });
  member = new Weave({ path: memberPath });
  detachHubRegistry(root, [member]);
  const disk = new Weave({ path: memberPath });
  assert.equal(disk.state.meta.registry, 'hub');
  disk.store.close();
  const save = member.store.save.bind(member.store);
  member.store.save = () => { throw new Error('disk refused'); };
  assert.throws(() => runDeferredMigrations(), /disk refused/);
  member.store.save = save;
  root.store.close();
  member.store.close();
});

test('detach resumes after reopening disk following destination commit and source failure', () => {
  const dir = tempDir('weave-detach-crash-');
  const rootPath = join(dir, 'root.db');
  const memberPath = join(dir, 'member.db');
  let root = new Weave({ path: rootPath, name: 'root' });
  let member = new Weave({ path: memberPath, name: 'member' });
  member.createSpace({ name: 'Work' });
  const table = member.createTable({ space: 'Work', name: 'Task' });
  member.joinRegistry(root);
  const form = createForm(member, { name: 'Intake', table: table.id, fields: ['Name'] });
  const sourceSave = root.store.save.bind(root.store);
  root.store.save = () => { throw new Error('source unavailable'); };
  assert.throws(() => detachHubRegistry(root, [member]), /source unavailable/);
  root.store.save = sourceSave;
  root.store.close();
  member.store.close();
  root = new Weave({ path: rootPath });
  member = new Weave({ path: memberPath });
  assert.ok(!root.state.entities[form.id].deletedAt);
  assert.equal(getForm(member, form.id).id, form.id);
  detachHubRegistry(root, [member]);
  assert.ok(root.state.entities[form.id].deletedAt);
  assert.equal(getForm(member, form.id).id, form.id);
  root.store.close();
  member.store.close();
});

test('detach projects each member space rollup into its owning workspace', () => {
  const root = new Weave({ name: 'root' });
  const members = ['one', 'two'].map(name => {
    const w = new Weave({ name });
    w.createSpace({ name: 'Work' });
    const table = w.createTable({ space: 'Work', name: 'Task' });
    w.createEntity(table.id, { name: 'Count me' });
    w.addField('System/Spaces', { name: 'Count', type: 'rollup', config: { via: table.id, aggregate: 'count' } });
    w.joinRegistry(root);
    return w;
  });
  const source = Object.values(root.getTable('System/Spaces').fields).filter(f => f.type === 'rollup');
  assert.equal(source.length, 2);
  detachHubRegistry(root, members);
  for (const w of members) {
    const spaces = w.getTable('System/Spaces');
    const rollups = Object.values(spaces.fields).filter(f => f.type === 'rollup');
    assert.equal(rollups.length, 1);
    assert.ok(source.some(f => f.id === rollups[0].id));
    const row = w.listEntities(spaces.id).find(r => r.sysId === w.getSpace('Work').id);
    assert.equal(w.readEntity(row.id).fields[rollups[0].name], 1);
  }
  assert.equal(Object.values(root.getTable('System/Spaces').fields).filter(f => f.type === 'rollup').length, 0);
});

test('detach preserves local select options missing from the root field', () => {
  const root = new Weave({ name: 'root' });
  const member = new Weave({ name: 'member' });
  const users = member.getTable('System/Users');
  member.addField(users.id, { name: 'Team', type: 'select', config: { options: ['Old'] } });
  const account = member.createAccount({ name: 'User', role: 'architect' }).account;
  const row = member.listEntities(users.id).find(r => r.sysId === account.id);
  member.updateEntity(row.id, { Team: 'Old' });
  member.joinRegistry(root);
  root.addField(root.getTable('System/Users').id, { name: 'Team', type: 'select', config: { options: ['New'] } });
  detachHubRegistry(root, [member]);
  const copied = member.listEntities(member.getTable('System/Users').id).find(r => r.sysId === account.id);
  assert.equal(member.readEntity(copied.id).fields.Team, 'Old');
  assert.deepEqual(member.findField(member.getTable('System/Users'), 'Team').config.options.map(o => o.name), ['New', 'Old']);
  assert.deepEqual(root.findField(root.getTable('System/Users'), 'Team').config.options.map(o => o.name), ['New']);
});

test('detach remaps recognized wiki targets while preserving literal UUID text and code', () => {
  const { root, member, task, account } = setup();
  const users = Object.values(member.state.tables).find(t => t.system === 'users');
  const old = Object.values(member.state.entities).find(row => row.dbId === users.id && row.sysId === account.account.id);
  const target = root.listEntities(root.getTable('System/Users').id).find(row => row.sysId === account.account.id);
  const doc = [`Literal ${old.id}`, `[[${old.id}|Owner]]`, `[[table:${users.id}]]`, '`[[' + old.id + ']]`', '```', `[[${old.id}]]`, '```'].join('\n');
  member.setDoc(task.id, doc);
  detachHubRegistry(root, [member]);
  const expected = doc.replace(`[[${old.id}|Owner]]`, `[[${target.id}|Owner]]`).replace(`[[table:${users.id}]]`, `[[table:${root.getTable('System/Users').id}]]`);
  assert.equal(member.getDoc(task.id), expected);
});

test('free-text actors do not gain key access on accountful engines and local recovery is explicit', () => {
  const keystorePath = join(tempDir('weave-local-key-recovery-'), 'keystore.json');
  const w = new Weave({ keystorePath });
  const owner = w.createAccount({ name: 'owner', role: 'architect' }).account;
  w.actor = `account:${owner.id}`;
  w.setKey('legacy', 'old-secret');
  const data = JSON.parse(readFileSync(keystorePath, 'utf8'));
  delete data.keys.legacy.workspace;
  data.keys.legacy.owner = null;
  writeFileSync(keystorePath, JSON.stringify(data));
  w.actor = 'owner';
  assert.throws(() => w.revealKey('legacy'), /not shared/);
  assert.throws(() => w.grantKey('legacy', 'owner'), /Only/);
  const local = new Weave({ keystorePath, localKeyAccess: true });
  local.state = w.state;
  local.grantKey('legacy', 'owner');
  w.actor = `account:${owner.id}`;
  assert.equal(w.revealKey('legacy'), 'old-secret');
});

test('detach rejects incompatible local custom field semantics before writes', () => {
  const root = new Weave({ name: 'root' });
  const member = new Weave({ name: 'member' });
  member.addField('System/Users', { name: 'Budget', type: 'number', config: { format: 'currency', currency: 'USD' } });
  member.joinRegistry(root);
  root.addField('System/Users', { name: 'Budget', type: 'number', config: { format: 'currency', currency: 'EUR' } });
  const before = [root, member].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, [member]), /conflicting field configuration/);
  assert.deepEqual([root, member].map(w => JSON.stringify(w.state)), before);
});

test('detach refuses a wiki reference to another workspace table before writes', () => {
  const { root, member, task } = setup();
  root.createSpace({ name: 'Private' });
  const table = root.createTable({ space: 'Private', name: 'Root only' });
  member.setDoc(task.id, `[[table:${table.id}]]`);
  const before = [root, member].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, [member]), /cross-workspace document reference/);
  assert.deepEqual([root, member].map(w => JSON.stringify(w.state)), before);
});

test('detach refuses a formula whose referenced rollup name changed at the root', () => {
  const root = new Weave({ name: 'root' });
  const members = ['one', 'two'].map(name => {
    const w = new Weave({ name });
    w.createSpace({ name: 'Work' });
    const table = w.createTable({ space: 'Work', name: 'Task' });
    w.addField('System/Spaces', { name: 'Count', type: 'rollup', config: { via: table.id, aggregate: 'count' } });
    w.addField('System/Spaces', { name: 'Plus one', type: 'formula', config: { expression: 'Count + 1' } });
    w.joinRegistry(root);
    return w;
  });
  const before = [root, ...members].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, members), /invalid formula/);
  assert.deepEqual([root, ...members].map(w => JSON.stringify(w.state)), before);
});

test('detach preserves unreferenced orphan registry metadata as tombstones', () => {
  const { root, member } = setup();
  const gone = member.createTable({ space: 'Work', name: 'Gone' });
  const tables = root.getTable('System/Tables');
  root.addField(tables.id, { name: 'Migration note', type: 'text' });
  root.addField(tables.id, { name: 'Migration document', type: 'document' });
  const row = root.listEntities(tables.id).find(r => r.sysId === gone.id);
  root.updateEntity(row.id, { 'Migration note': 'Keep this metadata' });
  root.setDoc(row.id, 'Keep this document', 'Migration document');
  delete member.state.tables[gone.id];
  detachHubRegistry(root, [member]);
  const saved = member.state.entities[row.id];
  assert.ok(saved.deletedAt);
  assert.equal(saved.values[member.findField(member.getTable('System/Tables'), 'Migration note').id], 'Keep this metadata');
  assert.equal(member.getDoc(row.id, 'Migration document'), 'Keep this document');
  assert.deepEqual(member.registryReport().problems, []);
});

test('detach refuses orphan structural rows that live user relations reference', () => {
  const { root, member, table, task } = setup();
  const gone = member.createTable({ space: 'Work', name: 'Gone' });
  const source = root.listEntities(root.getTable('System/Tables').id).find(r => r.sysId === gone.id);
  const spaces = root.getTable('System/Spaces');
  const relation = root.addRelation(spaces.id, { name: 'Schema reference', targetDb: root.getTable('System/Tables').id, cardinality: 'many-to-one' }).field;
  const space = root.listEntities(spaces.id).find(r => r.sysId === member.getSpace('Work').id);
  space.values[relation.id] = source.id;
  delete member.state.tables[gone.id];
  const before = [root, member].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, [member]), /orphan.*reference|reference.*orphan/i);
  assert.deepEqual([root, member].map(w => JSON.stringify(w.state)), before);
});

test('detach refuses missing registry subjects that actually belong to another workspace', () => {
  const { root, member } = setup();
  const other = new Weave({ name: 'other' });
  other.createSpace({ name: 'Other' });
  const table = other.createTable({ space: 'Other', name: 'Elsewhere' });
  other.joinRegistry(root);
  const tables = root.getTable('System/Tables');
  const workspaces = root.getTable('System/Workspaces');
  const row = root.listEntities(tables.id).find(r => r.sysId === table.id);
  row.values[root.findField(tables, 'Workspace').id] = root.listEntities(workspaces.id).find(r => r.sysId === member.state.meta.id).id;
  const before = [root, member, other].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, [member, other]), /another workspace|cross-workspace/);
  assert.deepEqual([root, member, other].map(w => JSON.stringify(w.state)), before);
});

test('detach tombstones a stale Fields row for a missing field without dropping metadata', () => {
  const { root, member, table } = setup();
  const gone = member.addField(table.id, { name: 'Obsolete', type: 'text' });
  const fields = root.getTable('System/Fields');
  root.addField(fields.id, { name: 'Preserved note', type: 'text' });
  const row = root.listEntities(fields.id).find(r => r.sysId === gone.id);
  root.updateEntity(row.id, { 'Preserved note': 'Prior field context' });
  delete member.state.tables[table.id].fields[gone.id];
  member.state.tables[table.id].fieldOrder = member.state.tables[table.id].fieldOrder.filter(id => id !== gone.id);
  detachHubRegistry(root, [member]);
  const saved = member.state.entities[row.id];
  assert.ok(saved.deletedAt);
  assert.equal(saved.values[member.findField(member.getTable('System/Fields'), 'Preserved note').id], 'Prior field context');
  assert.deepEqual(member.registryReport().problems, []);
});

const formerHub = () => {
  const root = new Weave({ name: 'root' });
  const former = new Weave({ name: 'former' });
  const peer = new Weave({ name: 'peer' });
  peer.createSpace({ name: 'Product' });
  peer.createAccount({ name: 'Peer person', role: 'architect' });
  peer.joinRegistry(former);
  const users = former.getTable('System/Users');
  const user = former.listEntities(users.id)[0];
  former.addField(users.id, { name: 'Historical note', type: 'text' });
  former.updateEntity(user.id, { 'Historical note': 'Retain this context' });
  return { root, former, peer, users, user, join: () => { former.joinRegistry(root); peer.joinRegistry(root); } };
};

test('detach archives obsolete local peer projections including Users and Workspaces', () => {
  const { root, former, peer, user, join } = formerHub();
  join();
  const correct = root.listEntities(root.getTable('System/Users').id).find(r => r.sysId === user.sysId);
  detachHubRegistry(root, [former, peer]);
  assert.equal(former.listEntities(former.getTable('System/Users').id).length, 0);
  assert.equal(former.listEntities(former.getTable('System/Workspaces').id).length, 1);
  assert.equal(former.listEntities(former.getTable('System/Spaces').id).some(row => row.sysId === peer.getSpace('Product').id), false);
  assert.ok(former.state.entities[user.id].deletedAt);
  assert.equal(former.state.entities[user.id].values[former.findField(former.getTable('System/Users'), 'Historical note').id], 'Retain this context');
  assert.ok(!peer.state.entities[correct.id].deletedAt);
  assert.equal(peer.listEntities(peer.getTable('System/Users').id).length, 1);
});

test('detach refuses live custom relations to obsolete local peer projections', () => {
  const { root, former, peer, users, user, join } = formerHub();
  former.createSpace({ name: 'Work' });
  const table = former.createTable({ space: 'Work', name: 'Task' });
  former.addRelation(table.id, { name: 'Owner', targetDb: users.id, cardinality: 'many-to-one' });
  former.createEntity(table.id, { name: 'Keep owner', values: { Owner: user.id } });
  join();
  const before = [root, former, peer].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, [former, peer]), /orphan.*reference|reference.*orphan/i);
  assert.deepEqual([root, former, peer].map(w => JSON.stringify(w.state)), before);
});

test('detach refuses live wiki references to obsolete local peer projections', () => {
  const { root, former, peer, user, join } = formerHub();
  former.createSpace({ name: 'Work' });
  const table = former.createTable({ space: 'Work', name: 'Task' });
  const task = former.createEntity(table.id, { name: 'Keep owner' });
  former.setDoc(task.id, `[[${user.id}]]`);
  join();
  const before = [root, former, peer].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, [former, peer]), /document reference.*orphan/i);
  assert.deepEqual([root, former, peer].map(w => JSON.stringify(w.state)), before);
});

for (const disk of [false, true]) test(`detach preserves registry attachments, page storage and revisions (${disk ? 'cross-directory disk' : 'memory'})`, () => {
  const dir = disk ? tempDir('weave-detach-files-') : null;
  if (disk) for (const name of ['root', 'member']) mkdirSync(join(dir, name));
  const root = new Weave({ name: 'root', ...(disk ? { path: join(dir, 'root', 'root.db') } : {}) });
  const member = new Weave({ name: 'member', ...(disk ? { path: join(dir, 'member', 'member.db') } : {}) });
  const space = member.createSpace({ name: 'Work' });
  const local = member.listEntities(member.getTable('System/Spaces').id).find(r => r.sysId === space.id);
  const oldFile = member.attachFile(local.id, { name: 'local.txt', bytes: Buffer.from('local bytes') });
  member.joinRegistry(root);
  const row = root.listEntities(root.getTable('System/Spaces').id).find(r => r.sysId === space.id);
  const file = root.attachFile(row.id, { name: 'page.html', mime: 'text/html', bytes: Buffer.from('<html>saved</html>') });
  root.writeFileStorage(file.id, { answer: 'saved' });
  const doc = root.addField(root.getTable('System/Spaces').id, { name: 'Notes', type: 'document' });
  root.store.pushDocRevision({ entityId: row.id, fieldId: doc.id, at: '2026-01-01T00:00:00.000Z', text: 'history', actor: 'local' });
  detachHubRegistry(root, [member]);
  assert.equal(member.readFile(oldFile.id).bytes.toString(), 'local bytes');
  assert.equal(member.readFile(file.id).bytes.toString(), '<html>saved</html>');
  assert.deepEqual(member.readFileStorage(file.id).items, { answer: 'saved' });
  const revisions = member.store.listDocRevisions(row.id, doc.id);
  assert.equal(revisions.length, 1);
  assert.equal(member.store.getDocRevision(row.id, doc.id, revisions[0].seq).text, 'history');
  detachHubRegistry(root, [member]);
  assert.equal(member.store.listDocRevisions(row.id, doc.id).length, 1);
  if (disk) {
    const path = member.store.path;
    member.store.close();
    const reopened = new Weave({ path });
    assert.equal(reopened.readFile(file.id).bytes.toString(), '<html>saved</html>');
    assert.deepEqual(reopened.readFileStorage(file.id).items, { answer: 'saved' });
    assert.equal(reopened.store.listDocRevisions(row.id, doc.id).length, 1);
    reopened.store.close();
    root.store.close();
  }
});

test('detach stages sidecar writes and preserves source on a failed destination transaction', () => {
  const dir = tempDir('weave-detach-sidecar-');
  const root = new Weave({ name: 'root', path: join(dir, 'root.db') });
  const member = new Weave({ name: 'member', path: join(dir, 'member.db') });
  member.createSpace({ name: 'Work' });
  member.joinRegistry(root);
  const row = root.listEntities(root.getTable('System/Spaces').id).find(r => r.sysId === member.getSpace('Work').id);
  const file = root.attachFile(row.id, { name: 'page.html', mime: 'text/html', bytes: Buffer.from('page') });
  root.writeFileStorage(file.id, { saved: 'yes' });
  const save = member.store.save.bind(member.store);
  deferMigrations();
  detachHubRegistry(root, [member]);
  assert.equal(member.store.getFileStorage(file.id), null);
  member.store.save = () => { throw new Error('destination transaction failed'); };
  assert.throws(() => runDeferredMigrations(), /destination transaction failed/);
  assert.equal(member.store.getFileStorage(file.id), null);
  member.store.save = save;
  root.store.close();
  member.store.close();
  const reopenedRoot = new Weave({ path: join(dir, 'root.db') });
  const reopenedMember = new Weave({ path: join(dir, 'member.db') });
  assert.equal(reopenedRoot.getEntity(row.id).deletedAt, undefined);
  detachHubRegistry(reopenedRoot, [reopenedMember]);
  assert.deepEqual(reopenedMember.readFileStorage(file.id).items, { saved: 'yes' });
  assert.equal(reopenedMember.readFile(file.id).bytes.toString(), 'page');
  reopenedRoot.store.pushUndo({ kind: 'file-attach', entityId: row.id, data: { fileId: file.id } });
  const result = reopenedRoot.undo();
  assert.equal(result.undone[0].skipped, 'entity moved to its workspace');
  assert.throws(() => reopenedRoot.restoreEntity(row.id), /moved to its workspace/);
  reopenedRoot.deleteFile(row.id, file.id);
  assert.equal(reopenedMember.readFile(file.id).bytes.toString(), 'page');
  reopenedRoot.store.close();
  reopenedMember.store.close();
});

test('detach refuses missing attachment bytes before changing either workspace', () => {
  const { root, member } = setup();
  const row = root.listEntities(root.getTable('System/Spaces').id).find(r => r.sysId === member.getSpace('Work').id);
  const file = root.attachFile(row.id, { name: 'lost.txt', bytes: Buffer.from('lost') });
  delete root.state.fileBlobs[file.id];
  const before = [root, member].map(w => JSON.stringify(w.state));
  assert.throws(() => detachHubRegistry(root, [member]), /file blob.*missing/);
  assert.deepEqual([root, member].map(w => JSON.stringify(w.state)), before);
});

test('detach snapshots foreign actors without granting them local identity', () => {
  const { root, member } = setup();
  const owner = root.createAccount({ name: 'source-owner', role: 'architect' });
  root.actor = `account:${owner.account.id}`;
  const row = root.listEntities(root.getTable('System/Spaces').id).find(r => r.sysId === member.getSpace('Work').id);
  const doc = root.addField(row.dbId, { name: 'Notes', type: 'document' });
  root.addComment(row.id, { text: 'source note', author: root.actor });
  root.store.pushDocRevision({ entityId: row.id, fieldId: doc.id, at: '2026-01-01T00:00:00Z', actor: root.actor, text: 'old' });
  detachHubRegistry(root, [member]);
  assert.equal(member.getEntity(row.id).comments.at(-1).author, 'from root: source-owner');
  assert.equal(member.store.listDocRevisions(row.id, doc.id)[0].actor, 'from root: source-owner');
  assert.equal(member.listAccounts().some(a => a.id === owner.account.id), false);
});

test('detach retries failed destination sidecars before retiring source rows', () => {
  const { root, member } = setup();
  const row = root.listEntities(root.getTable('System/Spaces').id).find(r => r.sysId === member.getSpace('Work').id);
  const file = root.attachFile(row.id, { name: 'page.html', mime: 'text/html', bytes: Buffer.from('saved') });
  root.writeFileStorage(file.id, { saved: 'yes' });
  const set = member.store.setFileStorage.bind(member.store);
  member.store.setFileStorage = () => { throw new Error('sidecar failed'); };
  assert.throws(() => detachHubRegistry(root, [member]), /sidecar failed/);
  assert.ok(!root.state.entities[row.id].deletedAt);
  member.store.setFileStorage = set;
  detachHubRegistry(root, [member]);
  assert.deepEqual(member.readFileStorage(file.id).items, { saved: 'yes' });
  assert.equal(member.readFile(file.id).bytes.toString(), 'saved');
  assert.ok(root.state.entities[row.id].deletedAt);
});
