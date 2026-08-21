import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

/* Feature #17 — saved multi-table views with public share links. A view is a
   named list of blocks — each a table plus an optional where — stored in the
   workspace. Sharing mints a capability token: the share URL renders that
   view read-only, and ONLY that view, even when the workspace requires auth.
   Revoking the share kills the link. */

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', {
    name: 'State', type: 'workflow',
    config: { states: [{ name: 'Todo', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] },
  });
  w.createEntity('Task', { name: 'Open one' });
  const done = w.createEntity('Task', { name: 'Done one' });
  w.setState(done.id, 'State', 'Done');
  return w;
}

test('a view is blocks over tables, resolvable to live rows', () => {
  const w = fresh();
  const v = w.createView({ name: 'Focus', blocks: [{ table: 'Task', where: [['State', '=', 'Todo']] }] });
  assert.equal(v.name, 'Focus');
  const resolved = w.resolveView(v.id);
  assert.equal(resolved.blocks.length, 1);
  assert.equal(resolved.blocks[0].table, 'Dev/Task');
  assert.deepEqual(resolved.blocks[0].items.map((e) => e.name), ['Open one']);

  assert.equal(w.listViews().length, 1);
  w.deleteView(v.id);
  assert.equal(w.listViews().length, 0);
});

test('a view refuses unknown tables at creation, not at render time', () => {
  const w = fresh();
  assert.throws(() => w.createView({ name: 'Bad', blocks: [{ table: 'Nope' }] }), /not found/);
  assert.throws(() => w.createView({ name: '', blocks: [] }), /name/i);
});

test('sharing mints a revocable capability', () => {
  const w = fresh();
  const v = w.createView({ name: 'Focus', blocks: [{ table: 'Task' }] });
  const { url, token } = w.shareView(v.id);
  assert.match(url, /^\/view\//);
  assert.equal(w.viewByShareToken(token).id, v.id);
  w.unshareView(v.id);
  assert.equal(w.viewByShareToken(token), null);
});

test('the share URL is readable without auth, and only shows its view', async () => {
  const w = fresh();
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  const v = w.createView({ name: 'Focus', blocks: [{ table: 'Task', where: [['State', '=', 'Todo']] }] });
  const { token } = w.shareView(v.id);
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${base}/view/${token}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('Focus'));
    assert.ok(html.includes('Open one'));
    assert.ok(!html.includes('Done one'), 'the where clause holds on the share page');
    assert.equal((await fetch(`${base}/view/wrong`)).status, 404);
    assert.equal((await fetch(`${base}/api/schema`)).status, 401, 'the share token opens nothing else');
  } finally {
    server.close();
  }
});
