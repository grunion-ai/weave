import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const { Weave } = await import('../src/engine.js');
const { createWorkspaceHub } = await import('../src/server.js');
const { client } = await import('./lib/fixtures.mjs');

function demo() {
  const w = new Weave({ actor: 'kyle' });
  w.updateWorkspace({ name: 'ws' });
  const sales = w.createSpace({ name: 'Sales', description: 'Pipeline and accounts', icon: 'lucide:briefcase' });
  const ops = w.createSpace({ name: 'Ops' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal', icon: 'lucide:users' });
  w.addField(deal.id, { name: 'Code', type: 'text' });
  w.addField(deal.id, { name: 'Note', type: 'text' });
  const contact = w.createTable({ space: 'Sales', name: 'Contact' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  w.addField(task.id, { name: 'Code', type: 'text' });
  w.addField(task.id, { name: 'Note', type: 'text' });
  return { w, sales, ops, deal, contact, task };
}

const stampNote = { type: 'set-field', field: 'Note', value: 'stamped' };
const upsertDeal = { type: 'upsert-row', table: 'Sales/Deal', key: 'Code', fields: { Code: 'row.Code', Name: 'row.Name' } };

test('the home payload names the space and counts each table\'s live rows', () => {
  const { w, sales, deal, contact } = demo();
  w.createEntity(deal.id, { Name: 'One' });
  const gone = w.createEntity(deal.id, { Name: 'Two' });
  w.deleteEntity(gone.id);
  const home = w.spaceHome(sales.id);
  assert.deepEqual(home.space, { id: sales.id, name: 'Sales', icon: 'lucide:briefcase', description: 'Pipeline and accounts' });
  assert.deepEqual(home.tables.map((t) => [t.id, t.name, t.icon ?? null, t.rowCount]), [
    [deal.id, 'Deal', 'lucide:users', 1],
    [contact.id, 'Contact', null, 0],
  ]);
  assert.deepEqual(home.runs, []);
  assert.deepEqual(home.tables[0].views.map((v) => v.layout), ['table']);
});

test('a run in the space lists its rows, its time and a success outcome', () => {
  const { w, sales, deal } = demo();
  const auto = w.createAutomation(deal.id, { name: 'Stamp', trigger: { type: 'entity-created' }, actions: [stampNote] });
  const row = w.createEntity(deal.id, { Name: 'Northstar' });
  const [run] = w.spaceHome(sales.id).runs;
  assert.equal(run.workflowId, auto.id);
  assert.equal(run.name, 'Stamp');
  assert.equal(run.originSpace, 'Sales');
  assert.equal(run.outcome, 'success');
  assert.equal(run.failedStep, null);
  assert.ok(Date.parse(run.at) > 0);
  assert.equal(run.changedCount, 1);
  assert.deepEqual(run.changedRows, [{ id: row.id, publicId: row.publicId, name: 'Northstar', table: 'Deal' }]);
});

test('runs read newest first and each firing is its own run', () => {
  const { w, sales, deal } = demo();
  w.createAutomation(deal.id, { name: 'Stamp', trigger: { type: 'entity-created' }, actions: [stampNote] });
  const a = w.createEntity(deal.id, { Name: 'A' });
  const b = w.createEntity(deal.id, { Name: 'B' });
  const { runs } = w.spaceHome(sales.id);
  assert.deepEqual(runs.map((r) => r.changedRows.map((x) => x.id)), [[b.id], [a.id]]);
});

test('a scheduled run over many rows groups into one run, and a thousand rows stay bounded', () => {
  const { w, sales, deal } = demo();
  const rows = [];
  for (let i = 0; i < 1200; i++) rows.push(w.createEntity(deal.id, { Name: `Row ${i}` }));
  let clock = new Date('2027-03-10T16:59:30Z');
  w.now = () => clock;
  w.createAutomation(deal.id, {
    name: 'Morning stamp',
    trigger: { type: 'schedule', cron: '0 9 * * *', zone: 'America/Los_Angeles' },
    actions: [stampNote],
  });
  w.runSchedules();
  clock = new Date('2027-03-10T17:00:10Z');
  assert.equal(w.runSchedules(), 1);
  const { runs } = w.spaceHome(sales.id);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].changedCount, 1200);
  assert.equal(runs[0].changedRows.length, 50);
});

test('the payload keeps the newest twenty runs', () => {
  const { w, sales, deal } = demo();
  w.createAutomation(deal.id, { name: 'Stamp', trigger: { type: 'entity-created' }, actions: [stampNote] });
  for (let i = 0; i < 25; i++) w.createEntity(deal.id, { Name: `Row ${i}` });
  const { runs } = w.spaceHome(sales.id);
  assert.equal(runs.length, 20);
  assert.equal(runs[0].changedRows[0].name, 'Row 24');
});

test('a run from another space appears where it changed rows, with only the rows here', () => {
  const { w, sales, ops, task } = demo();
  w.createAutomation(task.id, { name: 'Open deal', trigger: { type: 'entity-created' }, actions: [upsertDeal, stampNote] });
  const source = w.createEntity(task.id, { Name: 'Renewal', Code: 'D-1' });
  const [here] = w.spaceHome(sales.id).runs;
  assert.equal(here.originSpace, 'Ops');
  assert.deepEqual(here.changedRows.map((r) => [r.name, r.table]), [['Renewal', 'Deal']]);
  const [there] = w.spaceHome(ops.id).runs;
  assert.equal(there.originSpace, 'Ops');
  assert.deepEqual(there.changedRows.map((r) => r.id), [source.id]);
});

test('a run that changed nothing in the space stays off its home', () => {
  const { w, sales, task } = demo();
  w.createAutomation(task.id, { name: 'Local', trigger: { type: 'entity-created' }, actions: [stampNote] });
  w.createEntity(task.id, { Name: 'T' });
  assert.deepEqual(w.spaceHome(sales.id).runs, []);
});

test('a comment an automation leaves counts as a changed row', () => {
  const { w, sales, deal } = demo();
  w.createAutomation(deal.id, { name: 'Greet', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'Welcome' }] });
  const row = w.createEntity(deal.id, { Name: 'N' });
  assert.deepEqual(w.spaceHome(sales.id).runs[0].changedRows.map((r) => r.id), [row.id]);
});

test('a partial run names its failed step and keeps the rows it changed', () => {
  const { w, sales, deal } = demo();
  const failing = { type: 'upsert-row', table: 'Ops/Task', key: 'Code', fields: { Code: 'row.Code' } };
  w.createAutomation(deal.id, { name: 'Half', trigger: { type: 'entity-created' }, actions: [stampNote, failing, { type: 'add-comment', text: 'never' }] });
  const row = w.createEntity(deal.id, { Name: 'No code' });
  const ran = w.readEntity(row.id).activity.find((a) => a.kind === 'automation-ran');
  assert.equal(ran.detail.failed.step, 2, 'the event records the step that threw');
  assert.match(ran.detail.failed.error, /no value for the key field/);
  const [run] = w.spaceHome(sales.id).runs;
  assert.equal(run.outcome, 'attention');
  assert.equal(run.failedStep.step, 2);
  assert.match(run.failedStep.error, /no value for the key field/);
  assert.deepEqual(run.changedRows.map((r) => r.id), [row.id]);
});

test('a run that failed before changing anything still shows on the space of its trigger row', () => {
  const { w, sales, ops, deal } = demo();
  const failing = { type: 'upsert-row', table: 'Ops/Task', key: 'Code', fields: { Code: 'row.Code' } };
  w.createAutomation(deal.id, { name: 'Dead', trigger: { type: 'entity-created' }, actions: [failing] });
  w.createEntity(deal.id, { Name: 'No code' });
  const [run] = w.spaceHome(sales.id).runs;
  assert.equal(run.outcome, 'attention');
  assert.equal(run.failedStep.step, 1);
  assert.deepEqual(run.changedRows, []);
  assert.equal(run.changedCount, 0);
  assert.deepEqual(w.spaceHome(ops.id).runs, []);
});

test('only the row that failed carries the failure, in a run over many rows', () => {
  const { w, deal } = demo();
  const rows = ['A', 'B'].map((Name) => w.createEntity(deal.id, { Name, Code: Name }));
  const blank = w.createEntity(deal.id, { Name: 'C' });
  let clock = new Date('2027-03-10T16:59:30Z');
  w.now = () => clock;
  w.createAutomation(deal.id, {
    name: 'Copy',
    trigger: { type: 'schedule', cron: '0 9 * * *', zone: 'America/Los_Angeles' },
    actions: [{ type: 'upsert-row', table: 'Ops/Task', key: 'Code', fields: { Code: 'row.Code' } }],
  });
  w.runSchedules();
  clock = new Date('2027-03-10T17:00:10Z');
  w.runSchedules();
  const failedOn = [...rows, blank].filter((r) => w.readEntity(r.id).activity.find((a) => a.kind === 'automation-ran')?.detail.failed);
  assert.deepEqual(failedOn.map((r) => r.id), [blank.id]);
});

test('an event with no recorded failure reads the workflow Health only for its newest run', () => {
  const { w, sales, deal } = demo();
  const auto = w.createAutomation(deal.id, { name: 'Stamp', trigger: { type: 'entity-created' }, actions: [stampNote] });
  w.createEntity(deal.id, { Name: 'A' });
  w.createEntity(deal.id, { Name: 'B' });
  w.updateEntity(auto.id, { Health: 'Failed', 'Health Reason': 'POST example.com: HTTP 500' });
  const [newest, older] = w.spaceHome(sales.id).runs;
  assert.equal(newest.outcome, 'attention');
  assert.deepEqual(newest.failedStep, { step: null, error: 'POST example.com: HTTP 500' });
  assert.equal(older.outcome, 'success');
  assert.equal(older.failedStep, null);
});

test('a webhook that fails after its run turns the newest run to attention', async () => {
  const { w, sales, deal } = demo();
  const server = createServer((req, res) => { res.statusCode = 500; res.end(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const auto = w.createAutomation(deal.id, { name: 'Tell', trigger: { type: 'entity-created' }, actions: [stampNote, { type: 'webhook', url: `http://127.0.0.1:${server.address().port}/` }] });
    w.createEntity(deal.id, { Name: 'A' });
    for (let i = 0; i < 100 && w.readEntity(auto.id).fields.Health !== 'Failed'; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    const [run] = w.spaceHome(sales.id).runs;
    assert.equal(run.outcome, 'attention');
    assert.match(run.failedStep.error, /HTTP 500/);
  } finally {
    server.close();
  }
});

test('a trashed row leaves the run, and a run left with no rows leaves the home', () => {
  const { w, sales, deal } = demo();
  w.createAutomation(deal.id, { name: 'Stamp', trigger: { type: 'entity-created' }, actions: [stampNote] });
  const row = w.createEntity(deal.id, { Name: 'A' });
  w.deleteEntity(row.id);
  assert.deepEqual(w.spaceHome(sales.id).runs, []);
});

test('a space with no tables answers empty lists', () => {
  const w = new Weave();
  const sp = w.createSpace({ name: 'Empty' });
  assert.deepEqual(w.spaceHome(sp.id), { space: { id: sp.id, name: 'Empty', icon: null, description: '' }, tables: [], runs: [] });
});

function guarded() {
  const d = demo();
  const { w, contact, task } = d;
  w.createAutomation(task.id, { name: 'Hidden origin', trigger: { type: 'entity-created' }, actions: [upsertDeal, stampNote] });
  w.createAutomation(contact.id, { name: 'Open origin', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'Welcome' }] });
  w.createEntity(task.id, { Name: 'Quiet renewal', Code: 'D-1' });
  w.createEntity(contact.id, { Name: 'Plain contact' });
  const t = {
    arc: w.createAccount({ name: 'arc', role: 'architect' }).token,
    member: w.createAccount({ name: 'member', role: 'observer' }).token,
    obs: w.createAccount({ name: 'obs', role: 'observer' }).token,
    bot: w.createAccount({ name: 'bot', role: 'editor', space: 'Sales' }).token,
  };
  w.updateSpace('Ops', { access: 'private' });
  w.setSpaceMember('Ops', 'member');
  w.setRequireAuth(true);
  return { ...d, t, call: client(createWorkspaceHub(w)) };
}

const homeOf = async (call, id, token) => {
  const res = await call('GET', `/api/spaces/${id}/home`, { token });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  return res.json;
};

test('GET /api/spaces/:id/home answers by id and by name, and an unknown space is a 404', async () => {
  const { call, sales, t } = guarded();
  assert.equal((await homeOf(call, sales.id, t.arc)).space.name, 'Sales');
  assert.equal((await homeOf(call, 'Sales', t.arc)).space.id, sales.id);
  assert.equal((await call('GET', '/api/spaces/Nowhere/home', { token: t.arc })).status, 404);
});

test('a reader outside a private space sees no run that started there, nor its name', async () => {
  const { call, sales, t } = guarded();
  const seen = await homeOf(call, sales.id, t.obs);
  assert.deepEqual(seen.runs.map((r) => r.name), ['Open origin']);
  const text = JSON.stringify(seen);
  assert.ok(!text.includes('Hidden origin') && !text.includes('Ops') && !text.includes('Quiet renewal'), text);
  const member = await homeOf(call, sales.id, t.member);
  assert.deepEqual(member.runs.map((r) => r.name), ['Open origin', 'Hidden origin']);
  assert.equal(member.runs[1].originSpace, 'Ops');
  const architect = await homeOf(call, sales.id, t.arc);
  assert.equal(architect.runs.length, 2);
});

test('a reader outside a private space gets a 404 for its home', async () => {
  const { call, ops, t } = guarded();
  const res = await call('GET', `/api/spaces/${ops.id}/home`, { token: t.obs });
  assert.equal(res.status, 404);
  assert.ok(!JSON.stringify(res.json).includes('Task'));
});

test('a token scoped to one space sees only runs that started in it', async () => {
  const { call, sales, ops, t } = guarded();
  const seen = await homeOf(call, sales.id, t.bot);
  assert.deepEqual(seen.runs.map((r) => r.name), ['Open origin']);
  assert.equal((await call('GET', `/api/spaces/${ops.id}/home`, { token: t.bot })).status, 404);
});

test('a share link reaches no space home, at any scope', async () => {
  const { w, call, sales, deal } = guarded();
  const row = w.listEntities(deal.id)[0];
  const scopes = [{ kind: 'workspace' }, { kind: 'space', id: sales.id }, { kind: 'table', id: deal.id }, { kind: 'entity', id: row.id }];
  for (const scope of scopes) {
    const { token } = w.mintShare({ scope, mode: 'read' });
    const res = await call('GET', `/api/spaces/${sales.id}/home`, { token });
    assert.equal(res.status, 403, `${scope.kind} share`);
    assert.ok(!JSON.stringify(res.json).includes('Hidden origin'));
  }
});

test('the home route only reads', async () => {
  const { call, sales, t } = guarded();
  const res = await call('POST', `/api/spaces/${sales.id}/home`, { token: t.arc, body: {} });
  assert.notEqual(res.status, 200);
});
