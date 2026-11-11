import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const LA = 'America/Los_Angeles';
const TOKYO = 'Asia/Tokyo';
const EVENING = '2026-03-11T02:00:00Z';

function workspace(clock = EVENING) {
  const w = new Weave();
  w.now = () => new Date(clock);
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'Task' });
  w.addField(t.id, { name: 'State', type: 'workflow', config: { states: [{ name: 'Open', default: true }, { name: 'Done', category: 'done' }] } });
  w.addField(t.id, { name: 'Stamped', type: 'text' });
  return { w, t };
}

const stamp = (w, t, trigger) => w.createAutomation(t.id, {
  name: 'Stamp the day',
  trigger,
  actions: [{ type: 'set-field', field: 'Stamped', value: '{{Today:iso}}' }],
});

test('{{Today:iso}} reads the day in the actor zone, not the UTC day', () => {
  const { w, t } = workspace();
  stamp(w, t, { type: 'entity-created' });
  const row = w.createEntity(t.id, { Name: 'ship it' }, { viewerZone: LA });
  assert.equal(w.readEntity(row.id).fields.Stamped, '2026-03-10');
});

test('{{Today}} and {{Today:iso}} name the same day', () => {
  const { w, t } = workspace();
  w.createAutomation(t.id, {
    name: 'Both forms',
    trigger: { type: 'entity-created' },
    actions: [{ type: 'set-field', field: 'Stamped', value: '{{Today}} | {{Today:iso}}' }],
  });
  const row = w.createEntity(t.id, { Name: 'ship it' }, { viewerZone: LA });
  const text = w.readEntity(row.id).fields.Stamped;
  assert.equal(text, 'Mar 10, 2026 | 2026-03-10');
});

test('a zone east of UTC gets its own day', () => {
  const { w, t } = workspace('2026-03-10T22:00:00Z');
  stamp(w, t, { type: 'entity-created' });
  const tokyo = w.createEntity(t.id, { Name: 'tokyo' }, { viewerZone: TOKYO });
  const la = w.createEntity(t.id, { Name: 'la' }, { viewerZone: LA });
  assert.equal(w.readEntity(tokyo.id).fields.Stamped, '2026-03-11');
  assert.equal(w.readEntity(la.id).fields.Stamped, '2026-03-10');
});

test('with no zone the UTC day stands', () => {
  const { w, t } = workspace();
  stamp(w, t, { type: 'entity-created' });
  const row = w.createEntity(t.id, { Name: 'bare' });
  assert.equal(w.readEntity(row.id).fields.Stamped, '2026-03-11');
});

test('an update carries the actor zone into the rule, as a create already does', () => {
  const { w, t } = workspace();
  stamp(w, t, { type: 'field-updated', field: 'Name' });
  const row = w.createEntity(t.id, { Name: 'before' });
  w.updateEntity(row.id, { Name: 'after' }, { viewerZone: LA });
  assert.equal(w.readEntity(row.id).fields.Stamped, '2026-03-10');
});

test('a state change carries the actor zone into the rule', () => {
  const { w, t } = workspace();
  stamp(w, t, { type: 'state-changed', field: 'State', toState: 'Done' });
  const row = w.createEntity(t.id, { Name: 'move me' });
  w.setState(row.id, 'State', 'Done', { viewerZone: LA });
  assert.equal(w.readEntity(row.id).fields.Stamped, '2026-03-10');
});

test("a schedule rule reads the day in the rule's own zone", () => {
  const { w, t } = workspace();
  let clock = new Date('2026-03-11T00:59:30Z');
  w.now = () => clock;
  w.createAutomation(t.id, {
    name: 'Evening stamp',
    trigger: { type: 'schedule', cron: '0 18 * * *', zone: LA },
    actions: [{ type: 'set-field', field: 'Stamped', value: '{{Today:iso}}' }],
  });
  const row = w.createEntity(t.id, { Name: 'nightly' });
  assert.equal(w.runSchedules(), 0, 'before the due minute nothing fires');
  clock = new Date('2026-03-11T01:00:10Z');
  assert.equal(w.runSchedules(), 1, 'at 18:00 Los Angeles, which is 01:00 UTC in March, the rule fires');
  assert.equal(w.readEntity(row.id).fields.Stamped, '2026-03-10', 'the rule zone names the day, not UTC');
});

test('a bare schedule rule keeps the UTC day', () => {
  const { w, t } = workspace();
  let clock = new Date('2026-03-11T00:59:30Z');
  w.now = () => clock;
  w.createAutomation(t.id, {
    name: 'UTC stamp',
    trigger: { type: 'schedule', cron: '0 1 * * *' },
    actions: [{ type: 'set-field', field: 'Stamped', value: '{{Today:iso}}' }],
  });
  const row = w.createEntity(t.id, { Name: 'nightly' });
  assert.equal(w.runSchedules(), 0, 'the first tick arms the rule');
  clock = new Date('2026-03-11T01:00:10Z');
  assert.equal(w.runSchedules(), 1);
  assert.equal(w.readEntity(row.id).fields.Stamped, '2026-03-11');
});

test('a webhook payload carrying its own zone key never steers the day', () => {
  const { w, t } = workspace();
  w.createAutomation(t.id, {
    name: 'Payload cannot pick the zone',
    trigger: { type: 'entity-created' },
    actions: [{ type: 'set-field', field: 'Stamped', value: '{{Today:iso}}' }],
  });
  w.viewerZone = 'Asia/Tokyo';
  const row = w.createEntity(t.id, { Name: 'inbound' });
  w.viewerZone = null;
  assert.equal(w.readEntity(row.id).fields.Stamped, '2026-03-11', 'Tokyo is already the next day');
});

test('the x-weave-zone header carries the day into a rule over PATCH and over the state route', async () => {
  const { w, t } = workspace();
  w.createAutomation(t.id, {
    name: 'Stamp the day',
    trigger: { type: 'field-updated', field: 'Name' },
    actions: [{ type: 'set-field', field: 'Stamped', value: '{{Today:iso}}' }],
  });
  w.createAutomation(t.id, {
    name: 'Stamp on done',
    trigger: { type: 'state-changed', field: 'State', toState: 'Done' },
    actions: [{ type: 'set-field', field: 'Stamped', value: '{{Today:iso}}' }],
  });
  const patched = w.createEntity(t.id, { Name: 'patch me' });
  const moved = w.createEntity(t.id, { Name: 'move me' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, zone) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(zone ? { 'x-weave-zone': zone } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.status);
  try {
    assert.equal(await call('PATCH', `/api/entities/${patched.id}`, { values: { Name: 'patched' } }, LA), 200);
    assert.equal(w.readEntity(patched.id).fields.Stamped, '2026-03-10', 'PATCH carries the zone');
    assert.equal(await call('POST', `/api/entities/${moved.id}/state`, { field: 'State', state: 'Done' }, LA), 200);
    assert.equal(w.readEntity(moved.id).fields.Stamped, '2026-03-10', 'the state route carries the zone');
    const bare = w.createEntity(t.id, { Name: 'no header' });
    assert.equal(await call('PATCH', `/api/entities/${bare.id}`, { values: { Name: 'still bare' } }), 200);
    assert.equal(w.readEntity(bare.id).fields.Stamped, '2026-03-11', 'no header keeps the UTC day');
  } finally {
    server.close();
  }
});
