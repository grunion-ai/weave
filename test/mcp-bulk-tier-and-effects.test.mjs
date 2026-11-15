import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool, toolTable } from '../src/mcp.js';

function seeded() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const task = w.createTable({ space: 'Dev', name: 'Task' });
  w.addField(task.id, { name: 'Owner', type: 'text' });
  const row = w.createEntity(task.id, { name: 'One', values: { Owner: 'dana' } });
  return { w, row };
}

const bulk = (row) => ({ ids: [row.id], op: 'set', values: { Owner: 'sam' } });

test('weave_bulk follows the caller space tier, not the workspace tier', () => {
  const { w, row } = seeded();
  const caller = { role: 'architect', signedIn: true, tier: 'observer', workspaceTier: 'architect' };
  assert.throws(() => dispatchTool(w, 'weave_bulk', bulk(row), { caller }));
  assert.equal(w.readEntity(row.id).fields.Owner, 'dana');
});

test('weave_bulk writes for a caller whose space tier is editor', () => {
  const { w, row } = seeded();
  const caller = { role: 'editor', signedIn: true, tier: 'editor', workspaceTier: 'observer' };
  dispatchTool(w, 'weave_bulk', bulk(row), { caller });
  assert.equal(w.readEntity(row.id).fields.Owner, 'sam');
});

test('the tool table names a read tool as read-only and nothing more', () => {
  const rows = toolTable().split('\n');
  assert.ok(rows.includes('| `weave_ontology` | Read schema outline | Read-only |'));
  assert.ok(rows.includes('| `weave_create_entity` | Create record | Adds or edits |'));
});

test('the tool table flags a webhook tool as able to call out and no read tool', () => {
  const rows = toolTable().split('\n');
  assert.ok(rows.includes('| `weave_create_automation` | Create automation | Adds or edits, can call a webhook |'));
  assert.ok(rows.includes('| `weave_vocabulary` | Look up allowed values | Read-only |'));
});
