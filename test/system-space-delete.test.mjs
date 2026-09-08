/* Issue #248 — the Workspace space is the workspace's own system space.
   The engine has always refused to delete it or to move a table into it
   (Issue #126 by design), but the refusal read "is part of the system
   registry", which Kyle took for a name clash between the space and the
   Spaces registry table. The message now says plainly what the space is
   and why the verb is refused; the behaviour itself is unchanged. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const fresh = () => {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Tasks' });
  return w;
};

test('deleteSpace on the Workspace space says it is the system space, not a registry clash', () => {
  const w = fresh();
  assert.throws(() => w.deleteSpace('Workspace'), (e) => {
    assert.equal(e.code, 'invalid');
    assert.match(e.message, /Space 'Workspace' is the workspace's own system space and cannot be deleted/);
    assert.doesNotMatch(e.message, /registry/);
    return true;
  });
  assert.throws(() => w.deleteSpace('Workspace', { hard: true }), /own system space/);
  assert.ok(w.getSpace('Workspace'), 'the space is still there');
});

test('moveTable into the Workspace space says the system space takes no tables', () => {
  const w = fresh();
  const tasks = w.getTable('Tasks');
  assert.throws(() => w.moveTable(tasks.id, 'Workspace'), (e) => {
    assert.equal(e.code, 'invalid');
    assert.match(e.message, /Space 'Workspace' is the workspace's own system space and cannot hold your tables/);
    assert.doesNotMatch(e.message, /registry/);
    return true;
  });
  assert.equal(w.getTable('Tasks').spaceId, w.getSpace('Product').id, 'the table did not move');
});
