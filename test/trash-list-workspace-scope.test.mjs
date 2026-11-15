import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { createWorkspaceHub } from '../src/server.js';
import { COMMANDS } from '../src/commands.js';

const rule = { trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'seen' }] };
const trashList = COMMANDS.find((c) => c.name === 'entity.trash');

function member(name, table) {
  const w = new Weave({ name });
  w.createSpace({ name: 'Work' });
  w.createTable({ space: 'Work', name: table });
  return w;
}

function trashedRule(w, table, name) {
  const wf = w.createAutomation(`Work/${table}`, { name, ...rule });
  w.deleteEntity(wf.id);
}

test('trash.list scopes the workflow trash to the workspace named in the call context', () => {
  const root = new Weave({ name: 'root' });
  const a = member('alpha', 'Lead');
  const b = member('beta', 'Bug');
  createWorkspaceHub(root, { workspaces: { alpha: a, beta: b } });
  trashedRule(a, 'Lead', 'alpha rule');
  trashedRule(b, 'Bug', 'beta rule');
  const table = a.getTable('System/Workflows').id;
  const names = (items) => items.map((i) => i.name).sort();

  assert.deepEqual(names(trashList.run(a, { table }, { workspace: a.state.meta.id }).items), ['alpha rule']);
  assert.deepEqual(trashList.run(a, { table }, { workspace: b.state.meta.id }).items, []);
  assert.deepEqual(names(trashList.run(b, { table: b.getTable('System/Workflows').id }, { workspace: b.state.meta.id }).items), ['beta rule']);
});
