import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const { withServer } = await import('./lib/fixtures.mjs');

test('an inbound webhook door answers POST only: other methods find no route and run nothing', async () => {
  const w = new Weave({ actor: 'kyle' });
  w.createSpace({ name: 'Ops' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  w.addField(task.id, { name: 'Remote Id', type: 'text' });
  const auto = w.createAutomation(task.id, {
    name: 'Intake',
    trigger: { type: 'webhook-inbound', key: 'id' },
    actions: [{ type: 'upsert-row', table: 'Task', key: 'Remote Id', fields: { 'Remote Id': 'trigger.body.id' } }],
  });
  const path = auto.hook.path.replace(/^\/w\/[^/]+/, '');
  await withServer(w, {}, async ({ base }) => {
    const unsigned = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":"1"}' });
    assert.equal(unsigned.status, 401, 'POST reaches the door, which wants a signature');
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const res = await fetch(base + path, { method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: '{"id":"1"}' }) });
      assert.equal(res.status, 404, method);
    }
  });
});
