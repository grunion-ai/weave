import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, sourcePath } from '../src/engine.js';
import { dispatchTool, TOOLS } from '../src/mcp.js';
import { startServer } from '../src/server.js';

const read = (w, id) => w.readEntity(id);

function demo() {
  const w = new Weave();
  w.createSpace({ name: 'Inbox' });
  const person = w.createTable({ space: 'Inbox', name: 'Person' });
  w.createEntity(person.id, { Name: 'Kim' });
  w.createEntity(person.id, { Name: 'Lee' });
  const delivery = w.createTable({ space: 'Inbox', name: 'Delivery' });
  for (const name of ['Ext', 'Who', 'Tier', 'Rep']) w.addField(delivery.id, { name, type: 'text' });
  w.addField(delivery.id, { name: 'Total', type: 'number' });
  const account = w.createTable({ space: 'Inbox', name: 'Account' });
  w.addField(account.id, { name: 'External Id', type: 'text' });
  w.addField(account.id, { name: 'Plan', type: 'select', config: { options: ['Free', 'Pro'] } });
  w.addField(account.id, { name: 'Total', type: 'number' });
  w.addField(account.id, { name: 'Event', type: 'text' });
  w.addRelation(account.id, { name: 'Owner', targetDb: person.id, cardinality: 'many-to-one' });
  return { w, delivery, account, person };
}

const upsert = {
  type: 'upsert-row',
  table: 'Inbox/Account',
  key: 'External Id',
  fields: { 'External Id': 'row.Ext', Name: 'row.Who', Plan: 'row.Tier', Owner: 'row.Rep', Total: 'row.Total', Event: 'event.type' },
};
const rule = { name: 'Land deliveries', trigger: { type: 'entity-created' }, actions: [upsert] };
const accounts = (w, account) => w.listEntities(account.id).filter((e) => !e.deletedAt);

test('upsert-row creates the target row on a key miss: select by option name, relation by target Name, event context', () => {
  const { w, delivery, account } = demo();
  const auto = w.createAutomation(delivery.id, rule);
  w.createEntity(delivery.id, { Name: 'd1', Ext: 'cus_1', Who: 'Acme', Tier: 'Pro', Rep: 'Kim', Total: 5 });
  const rows = accounts(w, account);
  assert.equal(rows.length, 1);
  const acct = read(w, rows[0].id);
  assert.equal(acct.name, 'Acme');
  assert.equal(acct.fields['External Id'], 'cus_1');
  assert.equal(acct.fields.Plan, 'Pro');
  assert.equal(acct.fields.Owner.name, 'Kim');
  assert.equal(acct.fields.Total, 5);
  assert.equal(acct.fields.Event, 'entity-created');
  assert.equal(read(w, auto.id).fields.Health, 'Healthy');
});

test('upsert-row updates the matching row on a key hit, and a repeated fire never makes a duplicate', () => {
  const { w, delivery, account } = demo();
  w.createAutomation(delivery.id, rule);
  w.createEntity(delivery.id, { Name: 'd1', Ext: 'cus_1', Who: 'Acme', Tier: 'Pro', Rep: 'Kim', Total: 5 });
  w.createEntity(delivery.id, { Name: 'd2', Ext: 'cus_1', Who: 'Acme Inc', Tier: 'Free', Rep: 'Lee', Total: 9 });
  w.createEntity(delivery.id, { Name: 'd3', Ext: 'cus_1', Who: 'Acme Inc', Tier: 'Free', Rep: 'Lee', Total: 9 });
  const rows = accounts(w, account);
  assert.equal(rows.length, 1, 'one external id, one row');
  const acct = read(w, rows[0].id);
  assert.equal(acct.name, 'Acme Inc');
  assert.equal(acct.fields.Plan, 'Free');
  assert.equal(acct.fields.Owner.name, 'Lee');
  assert.equal(acct.fields.Total, 9);
  w.createEntity(delivery.id, { Name: 'd4', Ext: 'cus_2', Who: 'Beta', Tier: 'Pro', Rep: 'Kim', Total: 1 });
  assert.equal(accounts(w, account).length, 2, 'a new external id is a new row');
});

test('a source path that resolves to nothing leaves that field alone', () => {
  const { w, delivery, account } = demo();
  w.createAutomation(delivery.id, rule);
  w.createEntity(delivery.id, { Name: 'd1', Ext: 'cus_1', Who: 'Acme', Tier: 'Pro', Rep: 'Kim', Total: 5 });
  w.createEntity(delivery.id, { Name: 'd2', Ext: 'cus_1', Who: 'Acme' });
  const acct = read(w, accounts(w, account)[0].id);
  assert.equal(acct.fields.Plan, 'Pro', 'an empty Tier did not clear Plan');
  assert.equal(acct.fields.Owner.name, 'Kim');
  assert.equal(acct.fields.Total, 5);
});

test('an empty key at fire time marks the row Failed and writes nothing; the firing create still lands', () => {
  const { w, delivery, account } = demo();
  const auto = w.createAutomation(delivery.id, rule);
  const d = w.createEntity(delivery.id, { Name: 'd1', Who: 'Nobody' });
  assert.ok(read(w, d.id));
  assert.equal(accounts(w, account).length, 0);
  const r = read(w, auto.id);
  assert.equal(r.fields.Health, 'Failed');
  assert.match(r.fields['Health Reason'], /External Id/);
});

test('a value the target refuses marks Failed and leaves no half-made row', () => {
  const { w, delivery, account } = demo();
  const auto = w.createAutomation(delivery.id, rule);
  w.createEntity(delivery.id, { Name: 'd1', Ext: 'cus_1', Who: 'Acme', Tier: 'Gold' });
  assert.equal(accounts(w, account).length, 0);
  assert.equal(read(w, auto.id).fields.Health, 'Failed');
});

test('the Script stores the action by names and describeAutomations lists its table and key', () => {
  const { w, delivery } = demo();
  const auto = w.createAutomation(delivery.id, rule);
  assert.deepEqual(JSON.parse(read(w, auto.id).docs.Script).actions, [upsert]);
  assert.deepEqual(w.describeAutomations()[0].actions, [{ type: 'upsert-row', table: 'Inbox/Account', key: 'External Id' }]);
});

test('renaming a target field rewrites the Script and the rule keeps firing', () => {
  const { w, delivery, account } = demo();
  const auto = w.createAutomation(delivery.id, rule);
  w.updateField(account.id, 'External Id', { name: 'Stripe Id' });
  const script = JSON.parse(read(w, auto.id).docs.Script);
  assert.equal(script.actions[0].key, 'Stripe Id');
  assert.equal(script.actions[0].fields['Stripe Id'], 'row.Ext');
  w.createEntity(delivery.id, { Name: 'd1', Ext: 'cus_9', Who: 'Gamma' });
  assert.equal(read(w, accounts(w, account)[0].id).fields['Stripe Id'], 'cus_9');
});

test('upsert-row validation: key, target table, target fields and paths', () => {
  const { w, delivery, account } = demo();
  w.addField(account.id, { name: 'Twice', type: 'formula', config: { expression: 'Total * 2' } });
  const make = (patch) => () => w.createAutomation(delivery.id, { ...rule, actions: [{ ...upsert, ...patch }] });
  assert.throws(make({ key: undefined }), /key/);
  assert.throws(make({ key: 'External Id', fields: { Name: 'row.Who' } }), /External Id/, 'the key must be mapped');
  assert.throws(make({ table: 'Inbox/Nope' }), /Nope/);
  assert.throws(make({ table: undefined }), /table/);
  assert.throws(make({ fields: { ...upsert.fields, Colour: 'row.Who' } }), /Colour/, 'an unknown target field is refused');
  assert.throws(make({ fields: { ...upsert.fields, Twice: 'row.Total' } }), /computed/);
  assert.throws(make({ fields: { ...upsert.fields, Name: '' } }), /path/);
  assert.throws(make({ fields: { ...upsert.fields, Name: 7 } }), /path/);
  assert.throws(make({ fields: 'row.Who' }), /fields/);
  assert.throws(make({ key: 'Owner', fields: { ...upsert.fields } }), /Owner/, 'a relation is no key');
  assert.equal(w.listAutomations().length, 0);
});

test('an upsert into its own table is held by the automation depth guard', () => {
  const w = new Weave();
  w.createSpace({ name: 'Loop' });
  const t = w.createTable({ space: 'Loop', name: 'Item' });
  w.addField(t.id, { name: 'Ext', type: 'text' });
  const auto = w.createAutomation(t.id, {
    name: 'Chain',
    trigger: { type: 'entity-created' },
    actions: [{ type: 'upsert-row', table: 'Loop/Item', key: 'Ext', fields: { Ext: 'row.PublicId', Name: 'row.PublicId' } }],
  });
  w.createEntity(t.id, { Name: 'seed' });
  const n = w.listEntities(t.id).filter((e) => !e.deletedAt).length;
  assert.ok(n > 1 && n <= 4, `bounded chain, got ${n} rows`);
  assert.notEqual(read(w, auto.id).fields.Health, 'Failed');
});

test('sourcePath walks objects and array indexes and answers undefined for a miss', () => {
  const src = { row: { Name: 'A' }, event: { body: { data: { object: { id: 'cus_1', items: [{ sku: 'x' }] } } } } };
  assert.equal(sourcePath(src, 'row.Name'), 'A');
  assert.equal(sourcePath(src, 'event.body.data.object.id'), 'cus_1');
  assert.equal(sourcePath(src, 'event.body.data.object.items.0.sku'), 'x');
  assert.equal(sourcePath(src, 'event.body.nope.id'), undefined);
  assert.equal(sourcePath(src, 'row.Name.length'), undefined, 'strings are leaves');
  assert.equal(sourcePath(src, 'row.__proto__'), undefined);
});

test('MCP weave_create_automation takes an upsert-row action and its description names it', () => {
  const { w, delivery, account } = demo();
  const spec = TOOLS.find((x) => x.name === 'weave_create_automation');
  assert.match(spec.description, /upsert-row/);
  const made = dispatchTool(w, 'weave_create_automation', { db: delivery.id, ...rule });
  assert.equal(made.actions[0].type, 'upsert-row');
  w.createEntity(delivery.id, { Name: 'd1', Ext: 'cus_1', Who: 'Acme' });
  assert.equal(accounts(w, account).length, 1);
});

test('POST /api/automations takes an upsert-row action and GET lists it', async () => {
  const { w, delivery, account } = demo();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/automations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db: delivery.id, ...rule }) });
    assert.equal(res.status, 201);
    const listed = await (await fetch(`${base}/api/automations`)).json();
    assert.deepEqual(listed[0].actions, [{ type: 'upsert-row', table: 'Inbox/Account', key: 'External Id' }]);
    const bad = await fetch(`${base}/api/automations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ db: delivery.id, ...rule, actions: [{ ...upsert, key: 'Nope' }] }) });
    assert.equal(bad.status >= 400 && bad.status < 500, true);
    w.createEntity(delivery.id, { Name: 'd1', Ext: 'cus_1', Who: 'Acme' });
    assert.equal(accounts(w, account).length, 1);
  } finally {
    server.close();
  }
});
