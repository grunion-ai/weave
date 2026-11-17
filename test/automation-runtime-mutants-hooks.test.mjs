import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
import { endpoint } from './lib/receiver.mjs';
process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const MINUTE = 60_000;
function workspace({ dir = tempDir('weave-runtime-hooks-'), path } = {}) {
  const w = new Weave({ actor: 'kyle', path, keystorePath: join(dir, 'keystore.json') });
  const state = { t: Date.parse('2026-11-09T15:00:00Z') };
  w.now = () => new Date(state.t);
  w.deliveryAttempts = 2;
  if (!w.findTable('Ops/Task')) {
    w.createSpace({ name: 'Ops' });
    const task = w.createTable({ space: 'Ops', name: 'Task' });
    for (const name of ['Remote Id', 'Status']) w.addField(task.id, { name, type: 'text' });
  }
  return { w, task: w.getTable('Ops/Task'), dir, state, tick: (ms) => { state.t += ms; } };
}
const secrets = new Map();
function deliver(w, auto, body) {
  const hookId = auto.hook.path.split('/').at(-1);
  if (!secrets.has(auto.id)) secrets.set(auto.id, w.revealHookSecret(auto.id).secret);
  const secret = secrets.get(auto.id);
  const bytes = Buffer.from(JSON.stringify(body));
  return w.receiveHook(hookId, { bytes, header: (name) => (name === 'x-weave-secret' ? secret : undefined) });
}
const fields = (w, id) => w.readEntity(id).fields;
const letters = (w) => w.listEntities(w.getTable('System/Failed Deliveries').id);

test('a webhook-inbound rule finds the record it changes by Name, and refuses a Name nobody has', () => {
  const { w, task } = workspace();
  const shared = w.createEntity(task.id, { Name: 'Shared launch' });
  const auto = w.createAutomation(task.id, {
    name: 'Sync', trigger: { type: 'webhook-inbound', record: 'record' },
    actions: [{ type: 'set-field', field: 'Status', value: '{{trigger.body.status}}' }],
  });
  const hit = deliver(w, auto, { record: 'Shared launch', status: 'Closed' });
  assert.equal(hit.status, 200, JSON.stringify(hit.answer));
  assert.equal(hit.answer.ran, 1);
  assert.equal(w.readEntity(shared.id).fields.Status, 'Closed');
  const miss = deliver(w, auto, { record: 'Nobody here', status: 'Closed' });
  assert.equal(miss.status, 422);
  assert.equal(miss.answer.code, 'invalid');
  assert.match(miss.answer.error, /No record 'Nobody here' in Ops\/Task/);
});

test('an upsert-row field with a blank source path is refused as invalid', () => {
  const { w, task } = workspace();
  const make = (path) => () => w.createAutomation(task.id, {
    name: 'Land', trigger: { type: 'entity-created' },
    actions: [{ type: 'upsert-row', table: 'Ops/Task', key: 'Remote Id', fields: { 'Remote Id': 'row.Name', Status: path } }],
  });
  assert.throws(make('   '), (err) => err.code === 'invalid' && /Field 'Status' needs a source path such as row\.Name/.test(err.message));
});

test('a failed delivery for a hook item names the Webhook source when no integration sent it', async () => {
  const hook = await endpoint();
  try {
    const { w, task, tick } = workspace();
    const auto = w.createAutomation(task.id, {
      name: 'Forward', trigger: { type: 'webhook-inbound', key: 'id' },
      actions: [{ type: 'http-request', method: 'POST', url: hook.url, body: { text: '{{trigger.body.title}}' } }],
    });
    hook.fail(503, 503);
    const answer = deliver(w, auto, { id: 'evt-7', title: 'Hello' });
    assert.equal(answer.status, 200, JSON.stringify(answer.answer));
    await w.automationsSettled();
    tick(MINUTE);
    w.runDeliveries();
    await w.automationsSettled();
    assert.equal(hook.seen.length, 2);
    const [letter] = letters(w);
    assert.equal(w.readEntity(letter.id).fields.Record, 'Webhook item evt-7#1');
  } finally { await hook.close(); }
});

test('a retry after a restart still runs the later steps against the live record', async () => {
  const hook = await endpoint();
  try {
    const dir = tempDir('weave-runtime-restart-');
    const path = join(dir, 'ops.db');
    const first = workspace({ dir, path });
    const auto = first.w.createAutomation(first.task.id, {
      name: 'Tell then note', trigger: { type: 'entity-created' },
      actions: [{ type: 'webhook', url: hook.url }, { type: 'add-comment', text: 'told the hook about {{Name}}' }],
    });
    hook.fail(500);
    const e = first.w.createEntity(first.task.id, { Name: 'Survives' });
    await first.w.automationsSettled();
    assert.equal(fields(first.w, auto.id).Health, 'Warning');
    const again = workspace({ dir, path });
    again.tick(MINUTE);
    again.w.runSchedules();
    await again.w.automationsSettled();
    assert.equal(fields(again.w, auto.id).Health, 'Healthy');
    assert.deepEqual(again.w.readEntity(e.id).comments.map((c) => c.text), ['told the hook about Survives']);
  } finally { await hook.close(); }
});

test('a scheduled run held by a failed webhook goes on to every record after the retry, from the stored copy of the workspace', async () => {
  const hook = await endpoint();
  try {
    const dir = tempDir('weave-runtime-schedule-');
    const path = join(dir, 'ops.db');
    const first = workspace({ dir, path });
    const a = first.w.createEntity(first.task.id, { Name: 'Alpha' });
    const b = first.w.createEntity(first.task.id, { Name: 'Beta' });
    first.w.createAutomation(first.task.id, {
      name: 'Nudge', trigger: { type: 'schedule', cron: '* * * * *' },
      actions: [{ type: 'webhook', url: hook.url }, { type: 'add-comment', text: 'nudged {{Name}}' }],
    });
    first.w.runSchedules();
    hook.fail(503);
    first.tick(MINUTE);
    first.w.runSchedules();
    await first.w.automationsSettled();
    assert.equal(first.w.pendingDeliveries().length, 1);
    const again = workspace({ dir, path });
    again.tick(2 * MINUTE);
    again.w.runDeliveries();
    await again.w.automationsSettled();
    const said = (id) => again.w.readEntity(id).comments.map((c) => c.text);
    assert.deepEqual(said(a.id), ['nudged Alpha']);
    assert.deepEqual(said(b.id), ['nudged Beta']);
  } finally { await hook.close(); }
});
