import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';
import { parseCron, cronMatches, zonedParts, dueBetween, armSchedules } from '../src/schedule.js';
import { startServer } from '../src/server.js';

const read = (w, id) => w.readEntity(id);
const lastRun = (w, id) => w.state.entities[id].values[w.getField('System/Workflows', 'Last Run').id];
const LA = 'America/Los_Angeles';
const T = (iso) => new Date(iso);

function demo() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Task' });
  w.addField(t.id, { name: 'State', type: 'workflow', config: { states: [{ name: 'Open', default: true }, { name: 'Done', category: 'done' }] } });
  w.addField(t.id, { name: 'Flag', type: 'checkbox' });
  const a = w.createEntity(t.id, { Name: 'A' });
  const b = w.createEntity(t.id, { Name: 'B' });
  const done = w.createEntity(t.id, { Name: 'Done one' });
  w.setState(done.id, 'State', 'Done');
  return { w, t, a, b, done };
}

const nudge = {
  name: 'Morning nudge',
  trigger: { type: 'schedule', cron: '0 9 * * *', zone: LA, where: [['State', '!=', 'Done']] },
  actions: [{ type: 'set-field', field: 'Flag', value: true }, { type: 'add-comment', text: 'Nudged on {{Today:iso}}' }],
};

test('parseCron accepts five fields with lists, ranges and steps, and refuses what is not a schedule', () => {
  const c = parseCron('*/15 9-17 1,15 * 1-5');
  assert.deepEqual([...c.minute], [0, 15, 30, 45]);
  assert.deepEqual([...c.hour], [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual([...c.day], [1, 15]);
  assert.equal(c.month, null, 'a star is no constraint');
  assert.deepEqual([...c.weekday], [1, 2, 3, 4, 5]);
  assert.equal(parseCron('0 9 * * 7').weekday.has(0), true, '7 is Sunday too');
  assert.equal(parseCron(' 0  9 * * * ').text, '0 9 * * *', 'the text is normalised');
  assert.throws(() => parseCron('0 9 * *'), /five fields/);
  assert.throws(() => parseCron('60 9 * * *'), /minute/);
  assert.throws(() => parseCron('0 24 * * *'), /hour/);
  assert.throws(() => parseCron('0 9 0 * *'), /day/);
  assert.throws(() => parseCron('0 9 * 13 *'), /month/);
  assert.throws(() => parseCron('0 9 * * 8'), /weekday/);
  assert.throws(() => parseCron('a b c d e'), /minute/);
  assert.throws(() => parseCron(''), /five fields/);
});

test('cronMatches follows cron: day-of-month and weekday are OR when both are set, AND with a star', () => {
  const at = { minute: 0, hour: 9, day: 15, month: 3, weekday: 1 };
  assert.equal(cronMatches(parseCron('0 9 * * *'), at), true);
  assert.equal(cronMatches(parseCron('0 9 15 * 5'), at), true, 'day matches, weekday does not: OR says yes');
  assert.equal(cronMatches(parseCron('0 9 16 * 1'), at), true, 'weekday matches, day does not: OR says yes');
  assert.equal(cronMatches(parseCron('0 9 16 * 5'), at), false);
  assert.equal(cronMatches(parseCron('0 9 16 * *'), at), false, 'a star weekday leaves the day to decide');
  assert.equal(cronMatches(parseCron('0 9 * * 5'), at), false, 'a star day leaves the weekday to decide');
  assert.equal(cronMatches(parseCron('1 9 * * *'), at), false);
});

test('zonedParts reads the wall clock of a zone, and dueBetween finds a due minute in a window', () => {
  assert.deepEqual(zonedParts(T('2027-03-10T17:00:00Z'), LA), { minute: 0, hour: 9, day: 10, month: 3, weekday: 3 });
  assert.deepEqual(zonedParts(T('2027-03-10T17:00:00Z'), 'UTC'), { minute: 0, hour: 17, day: 10, month: 3, weekday: 3 });
  assert.deepEqual(zonedParts(T('2027-01-01T00:30:00Z'), 'Asia/Tokyo'), { minute: 30, hour: 9, day: 1, month: 1, weekday: 5 });
  const cron = parseCron('0 9 * * *');
  assert.equal(dueBetween(cron, LA, T('2027-03-10T16:59:30Z'), T('2027-03-10T17:00:10Z'))?.toISOString(), '2027-03-10T17:00:00.000Z');
  assert.equal(dueBetween(cron, LA, T('2027-03-10T17:00:10Z'), T('2027-03-10T17:00:50Z')), null, 'the minute mark already passed');
  assert.equal(dueBetween(cron, LA, T('2027-03-10T17:00:00Z'), T('2027-03-10T17:00:50Z')), null, 'the window is open at its start');
  assert.equal(dueBetween(cron, LA, T('2027-03-01T17:00:10Z'), T('2027-03-10T18:00:00Z'))?.toISOString(), '2027-03-10T17:00:00.000Z', 'a long window answers the newest due minute');
  assert.equal(dueBetween(cron, LA, T('2026-01-01T00:00:00Z'), T('2027-03-10T18:00:00Z'))?.toISOString(), '2027-03-10T17:00:00.000Z', 'a window older than seven days is cut to seven');
  assert.equal(dueBetween(parseCron('30 2 * * *'), LA, T('2027-03-14T09:00:00Z'), T('2027-03-14T11:00:00Z')), null, 'a wall-clock minute DST skips never comes due');
});

test('a schedule rule compiles: the Script round-trips cron, zone and where, State is Ready and describe names them', () => {
  const { w, t } = demo();
  const auto = w.createAutomation(t.id, nudge);
  const row = read(w, auto.id);
  assert.deepEqual(JSON.parse(row.docs.Script), {
    table: 'Ops/Task',
    trigger: { type: 'schedule', cron: '0 9 * * *', zone: LA, where: [['State', '!=', 'Done']] },
    actions: nudge.actions,
  });
  assert.equal(row.fields.State, 'Ready');
  assert.equal(row.fields.Health, 'No runs');
  assert.deepEqual(w.describeAutomations()[0].trigger, { type: 'schedule', cron: '0 9 * * *', zone: LA, where: [['State', '!=', 'Done']] });
  const bare = w.createAutomation(t.id, { name: 'Hourly', trigger: { type: 'schedule', cron: '0 * * * *' }, actions: nudge.actions });
  assert.deepEqual(JSON.parse(read(w, bare.id).docs.Script).trigger, { type: 'schedule', cron: '0 * * * *', zone: 'UTC' }, 'zone defaults to UTC and an absent where stays absent');
});

test('a bad cron, zone or where is Setup incomplete with the reason, and a field named by where is checked', () => {
  const { w, t } = demo();
  const wf = w.getTable('System/Workflows');
  const script = (trigger) => JSON.stringify({ table: 'Ops/Task', trigger, actions: nudge.actions });
  const row = w.createEntity(wf.id, { Name: 'Broken' });
  w.setDoc(row.id, script({ type: 'schedule', cron: '0 9 * *' }), 'Script');
  assert.equal(read(w, row.id).fields.State, 'Setup incomplete');
  assert.throws(() => w.updateEntity(row.id, { On: true }), /five fields/);
  w.setDoc(row.id, script({ type: 'schedule', cron: '0 9 * * *', zone: 'Mars/Olympus' }), 'Script');
  assert.throws(() => w.updateEntity(row.id, { On: true }), /time zone/);
  w.setDoc(row.id, script({ type: 'schedule', cron: '0 9 * * *', where: [['Nope', '=', 1]] }), 'Script');
  assert.throws(() => w.updateEntity(row.id, { On: true }), /Nope/);
  w.setDoc(row.id, script({ type: 'schedule' }), 'Script');
  assert.throws(() => w.updateEntity(row.id, { On: true }), /cron/);
  w.setDoc(row.id, script({ type: 'schedule', cron: '0 9 * * *' }), 'Script');
  assert.equal(read(w, row.id).fields.State, 'Ready');
});

test('runSchedules fires once per due minute on every row the where clause admits, as the automation, stamping Health and Last Run at the tick', () => {
  const { w, t, a, b, done } = demo();
  let clock = T('2027-03-10T16:59:30Z');
  w.now = () => clock;
  const auto = w.createAutomation(t.id, nudge);
  assert.equal(w.runSchedules(), 0, 'before the slot nothing is due');
  clock = T('2027-03-10T17:00:10Z');
  assert.equal(w.runSchedules(), 1, 'at 09:00 Los Angeles the rule fires');
  for (const e of [a, b]) {
    const r = read(w, e.id);
    assert.equal(r.fields.Flag, true, `${r.name} was nudged`);
    assert.equal(r.comments.at(-1).text, 'Nudged on 2027-03-10');
    assert.equal(r.comments.at(-1).author, `workflow:${auto.id}`, 'the automation is the author');
    assert.equal(r.modifiedBy, `workflow:${auto.id}`);
    assert.equal(r.activity.find((x) => x.kind === 'automation-ran')?.detail?.name, 'Morning nudge');
  }
  const d = read(w, done.id);
  assert.equal(d.fields.Flag, false, 'the Done row is outside the where clause');
  assert.equal(d.comments.length, 0);
  const row = read(w, auto.id);
  assert.equal(row.fields.Health, 'Healthy');
  assert.equal(lastRun(w, auto.id), '2027-03-10T17:00:10.000Z', 'Last Run is the tick, on the injected clock');
  clock = T('2027-03-10T17:00:50Z');
  assert.equal(w.runSchedules(), 0, 'the same minute never fires twice');
  assert.equal(read(w, a.id).comments.length, 1);
  clock = T('2027-03-11T17:00:05Z');
  assert.equal(w.runSchedules(), 1, 'the next day fires again');
  assert.equal(read(w, a.id).comments.length, 2);
});

test('an Off rule is skipped, and a rule switched On after its slot waits for the next one instead of replaying it', () => {
  const { w, t, a } = demo();
  let clock = T('2027-03-10T16:59:30Z');
  w.now = () => clock;
  const auto = w.createAutomation(t.id, { ...nudge, enabled: false });
  clock = T('2027-03-10T17:00:10Z');
  assert.equal(w.runSchedules(), 0, 'Off: the engine skips the row');
  assert.equal(read(w, a.id).fields.Flag, false);
  clock = T('2027-03-10T18:00:10Z');
  w.updateAutomation(auto.id, { enabled: true });
  assert.equal(w.runSchedules(), 0, 'the 09:00 slot passed while Off and is not replayed');
  clock = T('2027-03-11T17:00:10Z');
  assert.equal(w.runSchedules(), 1);
  assert.equal(read(w, a.id).fields.Flag, true);
});

test('a box that slept catches up once: three missed days are one run, and the floor is seven days', () => {
  const { w, t, a } = demo();
  let clock = T('2027-03-10T16:59:30Z');
  w.now = () => clock;
  w.createAutomation(t.id, nudge);
  assert.equal(w.runSchedules(), 0);
  clock = T('2027-03-10T17:00:10Z');
  assert.equal(w.runSchedules(), 1);
  clock = T('2027-03-13T20:00:00Z');
  assert.equal(w.runSchedules(), 1, 'one reconcile pass, not three');
  assert.equal(read(w, a.id).comments.length, 2);
  assert.equal(read(w, a.id).comments.at(-1).text, 'Nudged on 2027-03-13', 'the catch-up run reads the clock it runs at');
  clock = T('2027-03-13T20:00:30Z');
  assert.equal(w.runSchedules(), 0);
});

test('a never-run rule starts its window at the tick that first sees it: a slot before that is not due', () => {
  const { w, t } = demo();
  let clock = T('2027-03-10T18:00:00Z');
  w.now = () => clock;
  w.createAutomation(t.id, nudge);
  assert.equal(w.runSchedules(), 0, 'the first tick only opens the window');
  clock = T('2027-03-10T18:00:40Z');
  assert.equal(w.runSchedules(), 0, 'first seen at 10:00 Los Angeles, the 09:00 slot is gone');
  clock = T('2027-03-11T17:00:00Z');
  assert.equal(w.runSchedules(), 1);
});

test('an action that throws stamps Failed with the reason, Last Run still moves and the row stays On', () => {
  const { w, t, a } = demo();
  let clock = T('2027-03-10T16:59:30Z');
  w.now = () => clock;
  const auto = w.createAutomation(t.id, { ...nudge, actions: [{ type: 'upsert-row', table: 'Ops/Task', key: 'Name', fields: { Name: 'row.Nope' } }, { type: 'set-field', field: 'Flag', value: true }] });
  assert.equal(w.runSchedules(), 0);
  clock = T('2027-03-10T17:00:10Z');
  assert.equal(w.runSchedules(), 1);
  const row = read(w, auto.id);
  assert.equal(row.fields.Health, 'Failed');
  assert.match(row.fields['Health Reason'], /key field 'Name'/);
  assert.equal(lastRun(w, auto.id), '2027-03-10T17:00:10.000Z');
  assert.equal(row.fields.On, true);
  assert.equal(read(w, a.id).fields.Flag, false, 'the action after the failure did not run');
});

test('a schedule rule with no where clause fires on every live row of its table, and a row trigger still fires as before', () => {
  const { w, t, a, b, done } = demo();
  let clock = T('2027-03-10T16:59:30Z');
  w.now = () => clock;
  w.createAutomation(t.id, { name: 'All', trigger: { type: 'schedule', cron: '0 9 * * *', zone: LA }, actions: [{ type: 'set-field', field: 'Flag', value: true }] });
  w.createAutomation(t.id, { name: 'On create', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'born' }] });
  assert.equal(w.runSchedules(), 0);
  clock = T('2027-03-10T17:00:10Z');
  assert.equal(w.runSchedules(), 1);
  for (const e of [a, b, done]) assert.equal(read(w, e.id).fields.Flag, true);
  const c = w.createEntity(t.id, { Name: 'C' });
  assert.equal(read(w, c.id).comments[0].text, 'born');
});

test('the MCP tool creates a schedule rule and lists it', () => {
  const { w } = demo();
  const out = dispatchTool(w, 'weave_create_automation', { db: 'Ops/Task', name: 'Nightly', trigger: { type: 'schedule', cron: '0 2 * * *', zone: 'UTC' }, actions: [{ type: 'add-comment', text: 'night' }] });
  assert.equal(out.trigger.type, 'schedule');
  const listed = dispatchTool(w, 'weave_automations', { action: 'describe', db: 'Ops/Task' });
  assert.deepEqual(listed.rules.find((x) => x.name === 'Nightly').trigger, { type: 'schedule', cron: '0 2 * * *', zone: 'UTC' });
});

test('armSchedules ticks on its timer, swallows a tick that throws, and stops', () => {
  const timers = [];
  const setTimer = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; };
  const clearTimer = (id) => { timers[id].cleared = true; };
  let ticks = 0;
  const log = [];
  const s = armSchedules(() => { ticks++; if (ticks === 2) throw new Error('boom'); }, { setTimer, clearTimer, log: (m) => log.push(m) });
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 60_000);
  timers[0].fn();
  timers[0].fn();
  timers[0].fn();
  assert.equal(ticks, 3);
  assert.match(log[0], /boom/);
  s.stop();
  assert.equal(timers[0].cleared, true);
});

test('the server ticks every hub workspace: a due rule fires without any request', async () => {
  const { w, t, a } = demo();
  let clock = T('2027-03-10T16:59:30Z');
  w.now = () => clock;
  w.createAutomation(t.id, nudge);
  assert.equal(w.runSchedules(), 0);
  const { server } = await startServer(w, { port: 0, scheduleEvery: 15 });
  try {
    clock = T('2027-03-10T17:00:10Z');
    const until = Date.now() + 5000;
    while (read(w, a.id).fields.Flag !== true && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
    assert.equal(read(w, a.id).fields.Flag, true, 'the ticker fired the rule');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
