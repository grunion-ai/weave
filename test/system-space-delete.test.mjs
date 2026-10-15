import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const fresh = () => {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Tasks' });
  return w;
};

test('deleteSpace on the System space says it is the system space, not a registry clash', () => {
  const w = fresh();
  assert.throws(() => w.deleteSpace('System'), (e) => {
    assert.equal(e.code, 'invalid');
    assert.match(e.message, /Space 'System' is the workspace's own system space and cannot be deleted/);
    assert.doesNotMatch(e.message, /registry/);
    return true;
  });
  assert.throws(() => w.deleteSpace('System', { hard: true }), /own system space/);
  assert.ok(w.getSpace('System'), 'the space is still there');
});

test('moveTable into the System space says the system space takes no tables', () => {
  const w = fresh();
  const tasks = w.getTable('Tasks');
  assert.throws(() => w.moveTable(tasks.id, 'System'), (e) => {
    assert.equal(e.code, 'invalid');
    assert.match(e.message, /Space 'System' is the workspace's own system space and cannot hold your tables/);
    assert.doesNotMatch(e.message, /registry/);
    return true;
  });
  assert.equal(w.getTable('Tasks').spaceId, w.getSpace('Product').id, 'the table did not move');
});
