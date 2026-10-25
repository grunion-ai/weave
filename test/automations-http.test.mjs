import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

async function serve() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  const rule = w.createAutomation('Task', { name: 'stamp', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'filed' }] });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  return { w, rule, call, stop: () => server.close() };
}

test('PATCH /api/automations/:id renames and pauses a rule; an unknown id is a 404', async () => {
  const { w, rule, call, stop } = await serve();
  try {
    const loud = w.createEntity('Task', { Name: 'Loud' });
    assert.equal(w.readEntity(loud.id).comments.length, 1, 'the rule fires before the pause');
    const ok = await call('PATCH', `/api/automations/${rule.id}`, { enabled: false, name: 'stamp quietly' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.id, rule.id);
    assert.equal(ok.json.name, 'stamp quietly');
    assert.equal(ok.json.enabled, false);
    const listed = w.listAutomations('Task').find((a) => a.id === rule.id);
    assert.equal(listed.enabled, false, 'the pause is stored, not only echoed');
    const made = w.createEntity('Task', { Name: 'Quiet' });
    assert.deepEqual(w.readEntity(made.id).comments, [], 'a paused rule does not fire');

    const bad = await call('PATCH', '/api/automations/no-such-rule', { enabled: true });
    assert.equal(bad.status, 404);
    assert.equal(bad.json.code, 'not-found');
  } finally {
    stop();
  }
});

test('DELETE /api/automations/:id removes the rule; a second DELETE answers 200 and changes nothing (Issue #1087)', async () => {
  const { w, rule, call, stop } = await serve();
  try {
    const ok = await call('DELETE', `/api/automations/${rule.id}`);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { ok: true });
    assert.deepEqual(w.listAutomations('Task'), []);
    const made = w.createEntity('Task', { Name: 'After' });
    assert.deepEqual(w.readEntity(made.id).comments, [], 'a deleted rule does not fire');

    const again = await call('DELETE', `/api/automations/${rule.id}`);
    assert.equal(again.status, 200, 'Issue #1087: a miss reads as success today');
    assert.deepEqual(again.json, { ok: true });
  } finally {
    stop();
  }
});
