import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

function setup(path) {
  const w = new Weave({ path });
  w.createSpace({ name: 'S' });
  const deal = w.createTable({ space: 'S', name: 'Deal' });
  w.addField(deal, { name: 'Amount', type: 'number' });
  w.addField(deal, { name: 'Stage', type: 'select', config: { options: ['Lead', 'Won'] } });
  return { w, deal, row: w.createEntity(deal, { name: 'Original', values: { Amount: 5 } }) };
}

test('a rejected multi-field update leaves memory and disk unchanged (Issue #1454)', () => {
  const dir = tempDir('weave-atomic-');
  try {
    const path = join(dir, 'ws.db');
    const { w, deal, row } = setup(path);
    assert.throws(() => w.updateEntity(row.id, { Name: 'REJECTED_NAME', Amount: 'invalid' }), /not a number/);
    assert.equal(w.readEntity(row.id).name, 'Original');
    assert.throws(() => w.updateEntity(row.id, { Stage: 'Won', Name: 'REJECTED_NAME', Missing: 1 }), /not found/);
    assert.equal(w.readEntity(row.id).fields.Stage ?? null, null);
    w.createEntity(deal, { name: 'Unrelated' });
    const reopened = new Weave({ path });
    const back = reopened.readEntity(row.id);
    assert.equal(back.name, 'Original');
    assert.equal(back.fields.Amount, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function privateLink(path) {
  const w = new Weave({ path });
  w.createSpace({ name: 'Open' });
  w.createSpace({ name: 'Private' });
  const task = w.createTable({ space: 'Open', name: 'Task' });
  const deal = w.createTable({ space: 'Private', name: 'Deal' });
  const project = w.createTable({ space: 'Open', name: 'Project' });
  w.addRelation(task.id, { name: 'Deal', targetDb: deal.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.addRelation(task.id, { name: 'Project', targetDb: project.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.addField(task, { name: 'Notes', type: 'document' });
  w.createAutomation(task.id, { name: 'Echo name', trigger: { type: 'field-updated', field: 'Name' }, actions: [{ type: 'add-comment', text: 'renamed' }] });
  const secret = w.createEntity(deal.id, { name: 'Secret' });
  const target = w.createEntity(project.id, { name: 'Target' });
  const row = w.createEntity(task.id, { name: 'Original', values: { Deal: secret.id }, doc: 'first' });
  w.createAccount({ name: 'editor', role: 'editor' });
  w.updateSpace('Private', { access: 'private' });
  const editor = w.listAccounts().find((x) => x.name === 'editor');
  return { w, task, row, target, editor };
}

function snapshot(w, row, target) {
  const r = w.readEntity(row.id);
  const t = w.readEntity(target.id);
  return {
    name: r.name, project: r.fields.Project ?? null, notes: w.getDoc(row.id, 'Notes'),
    comments: r.comments.length, activity: r.activity?.length ?? null,
    revisions: w.listDocRevisions(row.id, 'Notes').revisions.length,
    targetTasks: t.fields.Tasks ?? null, targetActivity: t.activity?.length ?? null,
  };
}

for (const disk of [false, true]) {
  test(`a refusal during apply leaves every earlier field, link, doc and automation unwritten, ${disk ? 'SQLite' : 'memory'} (Issue #1454)`, () => {
    const dir = tempDir('weave-atomic-');
    try {
      const path = disk ? join(dir, 'ws.db') : null;
      const { w, task, row, target, editor } = privateLink(path);
      const before = snapshot(w, row, target);
      assert.throws(() => w.asAccount(editor, () => w.updateEntity(row.id, { Name: 'REJECTED_PRIVATE_LINK', Project: target.id, Notes: 'rejected doc', Deal: null })), (err) => err.code === 'forbidden');
      assert.deepEqual(snapshot(w, row, target), before);
      w.createEntity(task.id, { name: 'Unrelated' });
      assert.deepEqual(snapshot(w, row, target), before);
      if (disk) {
        w.store.close();
        const back = new Weave({ path });
        assert.deepEqual(snapshot(back, row, target), before);
        back.store.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('a refused create leaves no link, comment or row behind (Issue #1454)', () => {
  const dir = tempDir('weave-atomic-');
  try {
    const path = join(dir, 'ws.db');
    const { w, task, target, editor } = privateLink(path);
    const before = w.readEntity(target.id);
    assert.throws(() => w.asAccount(editor, () => w.createEntity(task.id, { name: 'Ghost', values: { Project: target.id, Deal: 'Deal#1' } })));
    const after = w.readEntity(target.id);
    assert.deepEqual(after.fields.Tasks ?? null, before.fields.Tasks ?? null);
    assert.equal(after.activity?.length ?? null, before.activity?.length ?? null);
    assert.equal(w.listEntities(task.id).filter((e) => w.entityName(e) === 'Ghost').length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
