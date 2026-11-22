import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
import { endpoint } from './lib/receiver.mjs';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const { dispatchTool } = await import('../src/mcp.js');

function demo() {
  const dir = tempDir('weave-health-api-');
  const w = new Weave({ actor: 'kyle', keystorePath: join(dir, 'keystore.json') });
  w.now = () => new Date('2026-11-09T14:00:00Z');
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  return { w, t };
}

const pick = ({ health, healthReason, lastRun }) => ({ health, healthReason, lastRun });

test('listAutomations, describeAutomations and weave_automations carry Health, Health Reason and Last Run from the Workflows row (Issue #1610)', async () => {
  const hook = await endpoint();
  try {
    const { w, t } = demo();
    const auto = w.createAutomation(t.id, { name: 'Notify', trigger: { type: 'entity-created' }, actions: [{ type: 'webhook', url: hook.url }] });
    assert.deepEqual(pick(w.listAutomations(t.id)[0]), { health: 'No runs', healthReason: null, lastRun: null }, 'a rule that never ran says so');
    assert.deepEqual(pick(auto), { health: 'No runs', healthReason: null, lastRun: null }, 'createAutomation answers the same shape');

    hook.fail(404);
    w.createEntity(t.id, { Name: 'R1' });
    await w.automationsSettled();
    const row = w.readEntity(auto.id).fields;
    assert.equal(row.Health, 'Failed');
    assert.ok(row['Last Run'], 'the run stamped Last Run');
    const want = { health: 'Failed', healthReason: row['Health Reason'], lastRun: w.listAutomations(t.id)[0].lastRun };
    assert.match(want.healthReason, /HTTP 404$/);
    assert.match(want.lastRun, /^\d{4}-\d\d-\d\dT\d\d:\d\d/, 'Last Run comes back as an ISO timestamp');
    assert.deepEqual(pick(w.listAutomations(t.id)[0]), want, 'listAutomations reads the row');
    assert.deepEqual(pick(w.describeAutomations(t.id)[0]), want, 'describeAutomations reads the row');
    assert.deepEqual(pick(dispatchTool(w, 'weave_automations', { action: 'list', db: 'Ops/Request' }).automations[0]), want, 'weave_automations list');
    assert.deepEqual(pick(dispatchTool(w, 'weave_automations', { action: 'describe', db: 'Ops/Request' }).rules[0]), want, 'weave_automations describe');

    w.createEntity(t.id, { Name: 'R2' });
    await w.automationsSettled();
    assert.equal(w.listAutomations(t.id)[0].health, 'Healthy', 'a run that lands reads Healthy');
    assert.equal(w.listAutomations(t.id)[0].healthReason, null);
  } finally { await hook.close(); }
});

test('a rule with incomplete setup lists its Health and the setup reason (Issue #1610)', () => {
  const { w } = demo();
  const row = w.createEntity(w.getTable('System/Workflows').id, { Name: 'By hand' });
  w.setDoc(row.id, JSON.stringify({ table: 'Ops/Request', trigger: { type: 'entity-created' }, actions: [{ type: 'set-field', field: 'Nope', value: 1 }] }), 'Script');
  const [listed] = w.listAutomations();
  assert.ok(listed, 'a rule with a problem still lists');
  assert.equal(listed.state, 'Setup incomplete');
  assert.equal(listed.health, w.readEntity(row.id).fields.Health);
  assert.equal(listed.healthReason, w.readEntity(row.id).fields['Health Reason']);
});
