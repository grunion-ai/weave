import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = mkdtempSync(join(tmpdir(), 'weave-sec-proto-'));
process.env.WEAVE_KEYSTORE = join(ROOT, 'keystore.json');
const { Weave } = await import('../../src/engine.js');
test.after(() => rmSync(ROOT, { recursive: true, force: true }));

const REFS = ['__proto__', 'constructor', 'prototype'];

function fresh() {
  const w = new Weave({ keystorePath: process.env.WEAVE_KEYSTORE });
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'Note', type: 'text' });
  w.addRelation('T', { name: 'Parent', targetDb: 'T' });
  const e = w.createEntity('T', { Name: 'row' });
  w.createAccount({ name: 'admin', role: 'admin' });
  return { w, e };
}

function snapshot() {
  const take = (o) => Object.getOwnPropertyNames(o).sort().map((k) => {
    const d = Object.getOwnPropertyDescriptor(o, k);
    return [k, 'value' in d ? d.value : d.get];
  });
  return { proto: take(Object.prototype), ctor: take(Object), fn: take(Function.prototype) };
}

const PATCH = { name: 'polluted', description: 'polluted', icon: 'x', enabled: false, system: 'spaces', deletedAt: 'now' };

const VERBS = (w, e, r) => [
  () => w.updateSpace(r, PATCH),
  () => w.deleteSpace(r),
  () => w.restoreSpace(r),
  () => w.updateTable(r, PATCH),
  () => w.moveTable(r, 'S'),
  () => w.moveTable('T', r),
  () => w.duplicateTable(r),
  () => w.deleteTable(r),
  () => w.restoreTable(r),
  () => w.tableView(r, { name: 'v' }),
  () => w.tableView('T', { name: r }),
  () => w.shareView(r),
  () => w.unshareView(r),
  () => w.deleteView(r),
  () => w.addField(r, { name: 'x', type: 'text' }),
  () => w.updateField('T', r, PATCH),
  () => w.updateField(r, 'Note', PATCH),
  () => w.deleteField('T', r),
  () => w.createEntity(r, { Name: 'x' }),
  () => w.updateEntity(r, { Name: 'x' }),
  () => w.updateEntity(e.id, { [r]: 'x' }),
  () => w.link(r, 'Parent', [e.id]),
  () => w.link(e.id, 'Parent', [r]),
  () => w.unlink(e.id, 'Parent', [r]),
  () => w.setState(r, 'Status', 'Done'),
  () => w.deleteEntity(r),
  () => w.restoreEntity(r),
  () => w.setDoc(r, 'x'),
  () => w.appendDoc(r, 'x'),
  () => w.setDoc(e.id, 'x', r),
  () => w.addComment(r, { text: 'x' }),
  () => w.attachFile(r, { name: 'x', bytes: Buffer.from('x') }),
  () => w.updateAutomation(r, PATCH),
  () => w.deleteAutomation(r),
  () => w.deleteAccount(r),
  () => w.createSession(r),
  () => w.revokeSession(r, { all: true }),
  () => w.setKey(r, 'secret'),
  () => w.grantKey(r, true),
  () => w.grantKey(r, 'someone'),
  () => w.revokeKey(r, 'someone'),
  () => w.deleteKey(r),
  () => w.revealKey(r),
  () => w.resolveKey(r),
  () => w.createSpace({ name: r }),
  () => w.createTable({ space: 'S', name: r }),
  () => w.addField('T', { name: r, type: 'text' }),
  () => w.createView({ name: r }),
  () => w.createAccount({ name: r }),
  () => w.updateSpace('S', { name: r }),
  () => w.updateTable('T', { name: r }),
  () => w.updateField('T', 'Note', { name: r }),
];

test('no write verb given a reserved ref changes Object.prototype', () => {
  const before = snapshot();
  for (const r of REFS) {
    const { w, e } = fresh();
    VERBS(w, e, r).forEach((call, i) => {
      try { call(); } catch {}
      assert.deepEqual(snapshot(), before, `verb #${i} with '${r}' changed a shared prototype`);
    });
  }
  assert.equal(({}).name, undefined);
  assert.equal(({}).shareToken, undefined);
  assert.equal(({}).system, undefined);
  assert.equal(({}).owner, undefined);
});

test('reserved refs resolve to not found', () => {
  const { w, e } = fresh();
  for (const r of REFS) {
    assert.equal(w.findSpace(r), undefined, `findSpace(${r})`);
    assert.equal(w.findTable(r), undefined, `findTable(${r})`);
    assert.throws(() => w.getSpace(r), { code: 'not-found' });
    assert.throws(() => w.getTable(r), { code: 'not-found' });
    assert.throws(() => w.getView(r), { code: 'not-found' });
    assert.throws(() => w.getEntity(r), { code: 'not-found' });
    assert.throws(() => w.getField('T', r), { code: 'not-found' });
    assert.throws(() => w.readEntity(r), { code: 'not-found' });
    assert.equal(w.findEntity('T', r), undefined, `findEntity(${r})`);
    assert.throws(() => w.updateAutomation(r, {}), { code: 'not-found' });
    assert.throws(() => w.deleteAccount(r), { code: 'not-found' });
    assert.throws(() => w.createSession(r), { code: 'not-found' });
    assert.equal(w.hasKey(r), false, `hasKey(${r})`);
    assert.throws(() => w.resolveKey(r), { code: 'not-found' });
    assert.throws(() => w.grantKey(r, true), { code: 'not-found' });
    assert.throws(() => w.deleteKey(r), { code: 'not-found' });
    assert.throws(() => w.shareView(r), { code: 'not-found' });
  }
  assert.equal(w.readEntity(e.id).name, 'row');
});

test('an import keyed by a reserved id is refused and changes nothing', () => {
  const { w, e } = fresh();
  const before = JSON.stringify(w.exportJSON());
  for (const r of REFS) {
    for (const where of ['entities', 'spaces', 'tables', 'fields', 'views']) {
      const dump = JSON.parse(JSON.stringify(w.exportJSON()));
      const row = JSON.parse(JSON.stringify(dump.entities[e.id]));
      const plant = (m) => JSON.parse(JSON.stringify(m).replace(/^\{/, `{${JSON.stringify(r)}:${JSON.stringify(row)},`));
      if (where === 'fields') { const t = Object.values(dump.tables)[0]; t.fields = plant(t.fields); }
      else if (where === 'views') dump.meta.views = plant(dump.meta.views ?? { x: {} });
      else dump[where] = plant(dump[where]);
      assert.throws(() => w.importJSON(dump), { code: 'invalid' }, `${where} keyed '${r}'`);
    }
  }
  assert.equal(JSON.stringify(w.exportJSON()), before);
});

test('reserved names are refused where things are named', () => {
  const { w } = fresh();
  for (const r of REFS) {
    assert.throws(() => w.createSpace({ name: r }), { code: 'invalid' }, `space ${r}`);
    assert.throws(() => w.updateSpace('S', { name: r }), { code: 'invalid' }, `space rename ${r}`);
    assert.throws(() => w.createTable({ space: 'S', name: r }), { code: 'invalid' }, `table ${r}`);
    assert.throws(() => w.updateTable('T', { name: r }), { code: 'invalid' }, `table rename ${r}`);
    assert.throws(() => w.addField('T', { name: r, type: 'text' }), { code: 'invalid' }, `field ${r}`);
    assert.throws(() => w.updateField('T', 'Note', { name: r }), { code: 'invalid' }, `field rename ${r}`);
    assert.throws(() => w.createView({ name: r }), { code: 'invalid' }, `view ${r}`);
    assert.throws(() => w.tableView('T', { name: r }), { code: 'invalid' }, `table view ${r}`);
    assert.throws(() => w.createAccount({ name: r }), { code: 'invalid' }, `account ${r}`);
    assert.throws(() => w.setKey(r, 's'), { code: 'invalid' }, `key ${r}`);
  }
  w.createSpace({ name: 'constructor notes' });
  w.createTable({ space: 'S', name: 'Prototype' });
  w.addField('T', { name: 'proto', type: 'text' });
  w.createAccount({ name: 'constructor-bot' });
});
