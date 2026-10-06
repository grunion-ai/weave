import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { Weave } from '../src/engine.js';
import { dispatchTool, TOOLS } from '../src/mcp.js';

const wf = (w) => w.getTable('Workspace/Workflows');
const read = (w, id) => w.readEntity(id);

function demo() {
  const w = new Weave();
  w.createSpace({ name: 'Workflow Demo' });
  const t = w.createTable({ space: 'Workflow Demo', name: 'Request' });
  w.addField(t.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'New', default: true }, { name: 'Done', category: 'done' }] } });
  w.addField(t.id, { name: 'Resolved', type: 'checkbox' });
  return { w, t };
}

const closeOut = {
  name: 'Close out on Done',
  trigger: { type: 'state-changed', field: 'Status', toState: 'Done' },
  actions: [{ type: 'set-field', field: 'Resolved', value: true }, { type: 'append-doc', text: 'Closed.' }],
};

test('createAutomation writes a Workflows row: Script JSON with names, On, State Ready, Health No runs, Tables and Spaces', () => {
  const { w, t } = demo();
  const auto = w.createAutomation(t.id, closeOut);
  const row = read(w, auto.id);
  assert.equal(row.db, 'Workspace/Workflows', 'the rule IS the row');
  assert.equal(row.name, 'Close out on Done');
  assert.deepEqual(JSON.parse(row.docs.Script), {
    table: 'Workflow Demo/Request',
    trigger: { type: 'state-changed', field: 'Status', toState: 'Done' },
    actions: [{ type: 'set-field', field: 'Resolved', value: true }, { type: 'append-doc', text: 'Closed.' }],
  });
  assert.equal(row.fields.On, true, 'enabled defaults on, as it always did');
  assert.equal(row.fields.State, 'Ready');
  assert.equal(row.fields.Health, 'No runs');
  assert.deepEqual(row.fields.Tables.map((x) => x.name), ['Request']);
  assert.deepEqual(row.fields.Spaces.map((x) => x.name), ['Workflow Demo']);
  assert.deepEqual(w.state.automations, {}, 'nothing lands in the old store');
  assert.equal(auto.dbId, t.id);
  assert.equal(auto.trigger.fieldId, w.getField(t.id, 'Status').id);
  assert.equal(auto.actions[0].fieldId, w.getField(t.id, 'Resolved').id);
  assert.equal(auto.enabled, true);
  assert.equal(auto.seq, row.publicId, 'seq is the row number: rules fire in row order');
  assert.deepEqual(w.listAutomations().map((a) => a.id), [auto.id]);
  assert.equal(w.describeAutomations()[0].table, 'Workflow Demo/Request');
});

test('a hand-made row with a valid Script is a rule: it lists, and it fires once switched On', () => {
  const { w, t } = demo();
  const row = w.createEntity(wf(w).id, { Name: 'By hand' });
  assert.equal(read(w, row.id).fields.State, 'Setup incomplete', 'a blank row has no rule yet');
  w.setDoc(row.id, JSON.stringify({ table: 'Workflow Demo/Request', trigger: closeOut.trigger, actions: closeOut.actions }), 'Script');
  const r = read(w, row.id);
  assert.equal(r.fields.State, 'Ready', 'State follows the Script on every write');
  assert.deepEqual(r.fields.Tables.map((x) => x.name), ['Request'], 'Tables follows the rule');
  assert.deepEqual(r.fields.Spaces.map((x) => x.name), ['Workflow Demo']);
  assert.equal(r.fields.On, false, 'still off: only the user switches it');
  assert.deepEqual(w.listAutomations().map((a) => [a.id, a.enabled]), [[row.id, false]]);

  const req = w.createEntity(t.id, { Name: 'R1' });
  w.setState(req.id, 'Status', 'Done');
  assert.equal(read(w, req.id).fields.Resolved, false, 'Off: the engine skips the row');
  assert.equal(read(w, row.id).fields.Health, 'No runs');

  w.updateEntity(row.id, { On: true });
  const req2 = w.createEntity(t.id, { Name: 'R2' });
  w.setState(req2.id, 'Status', 'Done');
  assert.equal(read(w, req2.id).fields.Resolved, true, 'On: it fires');
  const after = read(w, row.id);
  assert.equal(after.fields.Health, 'Healthy');
  assert.ok(after.raw['Last Run'], 'Last Run is stamped');
  assert.equal(after.fields.On, true);
});

test('a Setup incomplete row cannot be switched On, and the refusal names what is missing', () => {
  const { w } = demo();
  const row = w.createEntity(wf(w).id, { Name: 'Broken' });
  assert.throws(() => w.updateEntity(row.id, { On: true }), (err) => err.code === 'invalid' && /Script/.test(err.message));
  w.setDoc(row.id, JSON.stringify({ table: 'Workflow Demo/Request', trigger: { type: 'field-updated', field: 'Nope' }, actions: [{ type: 'append-doc', text: 'x' }] }), 'Script');
  assert.equal(read(w, row.id).fields.State, 'Setup incomplete');
  assert.throws(() => w.updateEntity(row.id, { On: 'On' }), /Nope/, 'names the missing field');
  assert.throws(() => w.createEntity(wf(w).id, { Name: 'Born on', On: true }), /Script/, 'a create cannot start it On either');
  assert.equal(read(w, row.id).fields.On, false);
  w.addField('Workflow Demo/Request', { name: 'Count', type: 'number' });
  w.setDoc(row.id, JSON.stringify({ table: 'Workflow Demo/Request', trigger: { type: 'field-updated', field: 'Resolved' }, actions: [{ type: 'set-field', field: 'Count', value: 'many' }] }), 'Script');
  assert.equal(read(w, row.id).fields.State, 'Setup incomplete', 'a value that does not fit its field is setup, too');
  assert.throws(() => w.updateEntity(row.id, { On: true }), /many|Count/);
});

test('setup that breaks while On keeps On, is skipped, reads Failed with the reason, and can still be switched Off', () => {
  const { w, t } = demo();
  w.addField(t.id, { name: 'Notes', type: 'text' });
  const auto = w.createAutomation(t.id, { name: 'Note it', trigger: { type: 'field-updated', field: 'Notes' }, actions: [{ type: 'set-field', field: 'Resolved', value: true }] });
  w.deleteField(t.id, 'Notes');
  const r = read(w, auto.id);
  assert.equal(r.fields.On, true, 'the engine never flips On');
  assert.equal(r.fields.State, 'Setup incomplete');
  assert.equal(r.fields.Health, 'Failed');
  assert.match(r.fields['Health Reason'], /Notes/, 'the reason names what broke');
  const req = w.createEntity(t.id, { Name: 'R' });
  w.updateEntity(req.id, { Resolved: false });
  assert.equal(read(w, req.id).fields.Resolved, false);
  w.updateEntity(auto.id, { On: false });
  assert.equal(read(w, auto.id).fields.On, false, 'switching a broken row off is always allowed');
});

test('an action that throws stamps Failed with the reason; the row stays On and the write that fired it lands', () => {
  const { w, t } = demo();
  const people = w.createTable({ space: 'Workflow Demo', name: 'Person' });
  const kim = w.createEntity(people.id, { Name: 'Kim' });
  w.addRelation(t.id, { name: 'Owner', targetDb: people.id, cardinality: 'many-to-one' });
  const auto = w.createAutomation(t.id, { name: 'Assign Kim', trigger: { type: 'entity-created' }, actions: [{ type: 'set-field', field: 'Owner', value: 'Kim' }] });
  w.deleteEntity(kim.id, { hard: true });
  const req = w.createEntity(t.id, { Name: 'R' });
  assert.ok(read(w, req.id), 'the create landed');
  const r = read(w, auto.id);
  assert.equal(r.fields.Health, 'Failed');
  assert.match(r.fields['Health Reason'], /Kim/);
  assert.equal(r.fields.On, true, 'a failing row stays On');
  assert.ok(r.raw['Last Run']);
});

test('the Health options carry colour, No runs included; State is Setup incomplete / Ready', () => {
  const w = new Weave();
  const t = wf(w);
  const health = Object.values(t.fields).find((f) => f.name === 'Health');
  assert.deepEqual(health.config.options.map((o) => [o.name, o.hue]), [['Healthy', 'green'], ['Warning', 'amber'], ['Failed', 'red'], ['No runs', 'slate']]);
  const state = Object.values(t.fields).find((f) => f.name === 'State');
  assert.deepEqual(state.config.states.map((s) => s.name), ['Setup incomplete', 'Ready']);
  assert.equal(state.config.states[0].default, true);
});

test('updateAutomation and deleteAutomation work on the row', () => {
  const { w, t } = demo();
  const auto = w.createAutomation(t.id, closeOut);
  w.updateAutomation(auto.id, { enabled: false, name: 'Close' });
  assert.equal(read(w, auto.id).fields.On, false);
  assert.equal(read(w, auto.id).name, 'Close');
  assert.equal(w.listAutomations()[0].enabled, false);
  assert.deepEqual(w.deleteAutomation(auto.id), { id: auto.id, deleted: true });
  assert.deepEqual(w.listAutomations(), []);
  assert.ok(read(w, auto.id).deletedAt, 'the row goes to the trash, restorable like any row');
  w.restoreEntity(auto.id);
  assert.equal(w.listAutomations().length, 1);
});

function legacy(w, t, { name, seq, enabled = true }) {
  const status = w.getField(t.id, 'Status');
  return {
    id: `00000000-0000-4000-8000-00000000000${seq}`, seq, dbId: t.id, name, enabled,
    trigger: { type: 'state-changed', fieldId: status.id, toStateId: status.config.states.find((s) => s.name === 'Done').id },
    actions: [{ type: 'set-field', fieldId: w.getField(t.id, 'Resolved').id, value: true }, { type: 'append-doc', text: `${name} ran` }],
  };
}

test('migration: every state.automations entry becomes a Workflows row, in seq order, and the old store empties', () => {
  const { w, t } = demo();
  const dump = w.exportJSON({ blobs: false });
  const b = legacy(w, t, { name: 'B', seq: 2, enabled: false });
  const a = legacy(w, t, { name: 'A', seq: 1 });
  dump.automations = { [b.id]: b, [a.id]: a };
  const w2 = new Weave();
  w2.importJSON(dump);
  assert.deepEqual(w2.state.automations, {});
  const rows = w2.listEntities(wf(w2).id).sort((x, y) => x.publicId - y.publicId);
  assert.deepEqual(rows.map((r) => w2.entityName(r)), ['A', 'B'], 'seq order becomes row order');
  const ra = read(w2, rows[0].id);
  assert.equal(ra.fields.On, true);
  assert.equal(read(w2, rows[1].id).fields.On, false, 'On is the old enabled');
  assert.equal(ra.fields.State, 'Ready');
  assert.deepEqual(JSON.parse(ra.docs.Script).actions, [{ type: 'set-field', field: 'Resolved', value: true }, { type: 'append-doc', text: 'A ran' }]);
  const req = w2.createEntity(w2.getTable('Workflow Demo/Request').id, { Name: 'R' });
  w2.setState(req.id, 'Status', 'Done');
  assert.match(w2.getDoc(req.id), /A ran/);
  assert.doesNotMatch(w2.getDoc(req.id), /B ran/, 'B came over Off');
  const w3 = new Weave();
  w3.importJSON(w2.exportJSON({ blobs: false }));
  assert.equal(w3.listEntities(wf(w3).id).length, 2);
});

test('migration adopts a hand-made row with the same Name on the same table instead of minting a duplicate', () => {
  const { w, t } = demo();
  const tableRow = w.query('Tables', { where: [['Name', '=', 'Request']] }).items[0];
  const mine = w.createEntity(wf(w).id, { Name: 'A', Description: 'kept', Tables: [tableRow.id] });
  w.setDoc(mine.id, 'flowchart', 'Diagram');
  w.updateEntity(mine.id, { Description: 'kept' });
  const dump = w.exportJSON({ blobs: false });
  const a = legacy(w, t, { name: 'A', seq: 1 });
  dump.automations = { [a.id]: a };
  const w2 = new Weave();
  w2.importJSON(dump);
  const rows = w2.listEntities(wf(w2).id);
  assert.equal(rows.length, 1, 'no duplicate');
  const r = read(w2, mine.id);
  assert.equal(r.id, mine.id, 'the hand-made row keeps its id');
  assert.equal(r.fields.Description, 'kept');
  assert.equal(r.docs.Diagram, 'flowchart');
  assert.equal(r.fields.On, false, 'and its own On: the user switched it, not the migration');
  assert.equal(JSON.parse(r.docs.Script).table, 'Workflow Demo/Request');
  assert.equal(r.fields.State, 'Ready');
});

test('migration on a .db: the automations table empties on disk and a reopen does nothing more', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-wfmig-'));
  try {
    const path = join(dir, 'ws.db');
    const { w, t } = demo();
    const w1 = new Weave({ path });
    w1.importJSON(w.exportJSON({ blobs: false }));
    const t1 = w1.getTable('Workflow Demo/Request');
    w1.store.close();
    const db = new DatabaseSync(path);
    const a = legacy(w, t, { name: 'A', seq: 1 });
    a.dbId = t1.id;
    a.trigger.fieldId = Object.values(t1.fields).find((f) => f.name === 'Status').id;
    a.trigger.toStateId = 'done';
    a.actions[0].fieldId = Object.values(t1.fields).find((f) => f.name === 'Resolved').id;
    db.prepare('INSERT INTO automations (id, json) VALUES (?, ?)').run(a.id, JSON.stringify(a));
    db.close();
    const w2 = new Weave({ path });
    assert.deepEqual(w2.listAutomations().map((x) => x.name), ['A']);
    w2.store.close();
    const check = new DatabaseSync(path);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM automations').get().n, 0, 'the old rows are gone from disk');
    check.close();
    const w3 = new Weave({ path });
    assert.equal(w3.listEntities(wf(w3).id).length, 1);
    w3.store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a hub member\'s automation is a root Workflows row that fires in the member and lists only there', () => {
  const r = new Weave();
  r.updateWorkspace({ name: 'root' });
  const m = new Weave();
  m.updateWorkspace({ name: 'uno' });
  m.createSpace({ name: 'Workflow Demo' });
  const t = m.createTable({ space: 'Workflow Demo', name: 'Request' });
  m.addField(t.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'New', default: true }, { name: 'Done' }] } });
  m.addField(t.id, { name: 'Resolved', type: 'checkbox' });
  m.joinRegistry(r);
  const auto = m.createAutomation(t.id, closeOut);
  const row = r.readEntity(auto.id);
  assert.equal(row.db, 'Workspace/Workflows', 'the row lives at the root');
  assert.equal(row.fields.State, 'Ready');
  assert.deepEqual(m.listAutomations().map((a) => a.id), [auto.id]);
  assert.deepEqual(r.listAutomations(), [], 'the root lists its own rules, not the member\'s');
  const req = m.createEntity(t.id, { Name: 'R' });
  m.setState(req.id, 'Status', 'Done');
  assert.equal(m.readEntity(req.id).fields.Resolved, true);
  assert.equal(r.readEntity(auto.id).fields.Health, 'Healthy');
});

test('a hub member\'s legacy automations migrate to the root when it joins', () => {
  const r = new Weave();
  const m = new Weave();
  m.createSpace({ name: 'Workflow Demo' });
  const t = m.createTable({ space: 'Workflow Demo', name: 'Request' });
  m.addField(t.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'New', default: true }, { name: 'Done' }] } });
  m.addField(t.id, { name: 'Resolved', type: 'checkbox' });
  const a = legacy(m, t, { name: 'A', seq: 1 });
  m.state.automations[a.id] = a;
  m.joinRegistry(r);
  assert.deepEqual(m.state.automations, {});
  assert.deepEqual(m.listAutomations().map((x) => x.name), ['A']);
  const req = m.createEntity(t.id, { Name: 'R' });
  m.setState(req.id, 'Status', 'Done');
  assert.equal(m.readEntity(req.id).fields.Resolved, true);
});

test('MCP weave_automations list reads the rows', () => {
  const { w, t } = demo();
  const auto = w.createAutomation(t.id, closeOut);
  const listed = dispatchTool(w, 'weave_automations', { action: 'list' }).automations;
  assert.deepEqual(listed.map((x) => [x.id, x.name, x.enabled]), [[auto.id, 'Close out on Done', true]]);
});

test('MCP weave_create_automation honours enabled:false as the row\'s On, lists it, and update switches it (Issue #683)', () => {
  const { w, t } = demo();
  const spec = TOOLS.find((x) => x.name === 'weave_create_automation');
  assert.equal(spec.inputSchema.properties.enabled.type, 'boolean');
  assert.match(spec.description, /enabled/, 'the description lists it');
  const made = dispatchTool(w, 'weave_create_automation', { db: t.id, ...closeOut, enabled: false });
  assert.equal(made.enabled, false);
  assert.equal(read(w, made.id).fields.On, false, 'the row comes up Off');
  const req = w.createEntity(t.id, { Name: 'R' });
  w.setState(req.id, 'Status', 'Done');
  assert.equal(read(w, req.id).fields.Resolved, false, 'an Off rule never fired');
  assert.equal(dispatchTool(w, 'weave_create_automation', { db: t.id, ...closeOut, name: 'On by default' }).enabled, true);
  assert.equal(dispatchTool(w, 'weave_automations', { action: 'update', automation: made.id, patch: { enabled: true } }).enabled, true);
  assert.equal(read(w, made.id).fields.On, true);
});

async function hook(handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}/hook` };
}

async function until(fn) {
  const deadline = Date.now() + 5000;
  while (!fn() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  return fn();
}

function notifier(w, t, url) {
  return w.createAutomation(t.id, { name: 'Notify', trigger: { type: 'state-changed', field: 'Status', toState: 'Done' }, actions: [{ type: 'webhook', url }] });
}

test('a webhook that answers non-2xx marks its row Failed with the status; a later 2xx run reads Healthy with no reason (Issue #682)', async () => {
  const statuses = [500, 200];
  const { server, url } = await hook((req, res) => { req.resume(); res.statusCode = statuses.shift() ?? 200; res.end(); });
  try {
    const { w, t } = demo();
    const auto = notifier(w, t, url);
    const r1 = w.createEntity(t.id, { Name: 'R1' });
    w.setState(r1.id, 'Status', 'Done');
    assert.equal(read(w, r1.id).fields.Status, 'Done', 'the triggering write lands before the webhook answers');
    assert.ok(await until(() => read(w, auto.id).fields.Health === 'Failed'));
    assert.equal(read(w, auto.id).fields['Health Reason'], `POST ${new URL(url).host}: HTTP 500`);
    assert.equal(read(w, auto.id).fields.On, true, 'a failing webhook never switches the row off');
    const r2 = w.createEntity(t.id, { Name: 'R2' });
    w.setState(r2.id, 'Status', 'Done');
    assert.ok(await until(() => !statuses.length));
    await new Promise((r) => setTimeout(r, 50));
    const after = read(w, auto.id);
    assert.equal(after.fields.Health, 'Healthy');
    assert.equal(after.fields['Health Reason'] ?? null, null, 'the success clears the reason');
  } finally { server.close(); }
});

test('a webhook to a host that refuses the connection marks its row Failed with the error code (Issue #682)', async () => {
  const { server, url } = await hook(() => {});
  await new Promise((r) => server.close(r));
  const { w, t } = demo();
  const auto = notifier(w, t, url);
  const r1 = w.createEntity(t.id, { Name: 'R1' });
  w.setState(r1.id, 'Status', 'Done');
  assert.ok(await until(() => read(w, auto.id).fields.Health === 'Failed'));
  assert.equal(read(w, auto.id).fields['Health Reason'], `POST ${new URL(url).host}: ECONNREFUSED`);
});

test('a webhook that never answers times out and marks its row Failed (Issue #682)', async () => {
  const { server, url } = await hook((req) => { req.resume(); });
  try {
    const { w, t } = demo();
    w.webhookTimeoutMs = 150;
    const auto = notifier(w, t, url);
    const r1 = w.createEntity(t.id, { Name: 'R1' });
    w.setState(r1.id, 'Status', 'Done');
    assert.ok(await until(() => read(w, auto.id).fields.Health === 'Failed'));
    assert.equal(read(w, auto.id).fields['Health Reason'], `POST ${new URL(url).host}: timed out after 0.15 s`);
  } finally { server.closeAllConnections(); server.close(); }
});
