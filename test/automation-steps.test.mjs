import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

process.env.WEAVE_WEBHOOK_ALLOW_PRIVATE = '1';
const read = (w, id) => w.readEntity(id);

function demo() {
  const w = new Weave();
  w.createSpace({ name: 'Billing' });
  const req = w.createTable({ space: 'Billing', name: 'Request' });
  w.addField(req.id, { name: 'Customer', type: 'text' });
  w.addField(req.id, { name: 'Account Ref', type: 'text' });
  w.addField(req.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'New', default: true }, { name: 'Approved', category: 'done' }] } });
  const acct = w.createTable({ space: 'Billing', name: 'Account' });
  w.addField(acct.id, { name: 'Stripe Id', type: 'text' });
  return { w, req, acct };
}

test('each action yields an output, and a later action reads it as steps.<n>.<path> in text and in upsert-row mappings', () => {
  const { w, req, acct } = demo();
  const auto = w.createAutomation(req.id, {
    name: 'Open the account',
    trigger: { type: 'state-changed', field: 'Status', toState: 'Approved' },
    actions: [
      { type: 'upsert-row', table: 'Billing/Account', key: 'Stripe Id', fields: { 'Stripe Id': 'row.Customer', Name: 'row.Name' } },
      { type: 'set-field', field: 'Account Ref', value: 'Account#{{steps.1.publicId}}' },
      { type: 'add-comment', text: 'Opened {{steps.1.name}} as #{{steps.1.publicId}} ({{steps.1.created}}); ref now {{steps.2.value}}' },
      { type: 'upsert-row', table: 'Billing/Account', key: 'Stripe Id', fields: { 'Stripe Id': 'steps.1.name', Name: 'steps.3.text' } },
    ],
  });
  const r = w.createEntity(req.id, { Name: 'Acme', Customer: 'cus_123' });
  w.setState(r.id, 'Status', 'Approved');
  const accounts = w.listEntities(acct.id).map((e) => read(w, e.id));
  const acme = accounts.find((a) => a.fields['Stripe Id'] === 'cus_123');
  assert.ok(acme, 'step 1 created the account');
  const out = read(w, r.id);
  assert.equal(out.fields['Account Ref'], `Account#${acme.publicId}`, 'step 2 read step 1\'s publicId');
  assert.equal(out.comments.at(-1).text, `Opened Acme as #${acme.publicId} (true); ref now Account#${acme.publicId}`, 'step 3 read steps 1 and 2');
  const second = accounts.find((a) => a.fields['Stripe Id'] === 'Acme');
  assert.equal(second.name, out.comments.at(-1).text, 'step 4 mapped step outputs into a new row');
  const ran = out.activity.find((a) => a.kind === 'automation-ran');
  assert.equal(ran.detail.name, 'Open the account');
  assert.equal(ran.detail.workflow, auto.id);
  assert.deepEqual(ran.detail.steps[0], { id: acme.id, publicId: acme.publicId, name: 'Acme', created: true });
  assert.deepEqual(ran.detail.steps[1], { field: 'Account Ref', value: `Account#${acme.publicId}` });
  assert.equal(ran.detail.steps[2].text, out.comments.at(-1).text);
  assert.equal(ran.detail.steps[3].created, true);
  assert.equal(read(w, auto.id).fields.Health, 'Healthy');
});

test('a step that is not there yet, or a path it has not got, reads empty, and a literal set-field value is left alone', () => {
  const { w, req } = demo();
  w.createAutomation(req.id, {
    name: 'Refs',
    trigger: { type: 'entity-created' },
    actions: [
      { type: 'set-field', field: 'Account Ref', value: 'plain {{Customer}}' },
      { type: 'add-comment', text: 'ahead [{{steps.3.text}}] missing [{{steps.1.nope}}] value [{{steps.1.value}}]' },
      { type: 'set-field', field: 'Customer', value: 42 },
    ],
  });
  const r = w.createEntity(req.id, { Name: 'B', Customer: 'cus_9' });
  const out = read(w, r.id);
  assert.equal(out.fields['Account Ref'], 'plain cus_9', 'set-field strings take the same templates as text actions');
  assert.equal(out.comments[0].text, 'ahead [] missing [] value [plain cus_9]');
  assert.equal(out.fields.Customer, '42', 'a non-string value is written as it was');
});

test('an append-doc step yields its field and text, and a webhook step yields the url it posted to', async () => {
  const { w, req } = demo();
  w.addField(req.id, { name: 'Notes', type: 'document' });
  w.webhookTimeoutMs = 200;
  w.createAutomation(req.id, {
    name: 'Notes and ping',
    trigger: { type: 'entity-created' },
    actions: [
      { type: 'append-doc', field: 'Notes', text: 'Hello {{Name}}' },
      { type: 'webhook', url: 'http://127.0.0.1:9/hook' },
      { type: 'add-comment', text: '{{steps.1.field}}: {{steps.1.text}} → {{steps.2.url}}' },
    ],
  });
  const r = w.createEntity(req.id, { Name: 'C' });
  const out = read(w, r.id);
  assert.equal(out.comments[0].text, 'Notes: Hello C → http://127.0.0.1:9/hook');
  await new Promise((res) => setTimeout(res, 300));
});

test('the schedule trigger carries steps too: event.type is schedule and step outputs flow between actions', () => {
  const { w, req, acct } = demo();
  let clock = new Date('2027-03-10T16:59:30Z');
  w.now = () => clock;
  w.createEntity(req.id, { Name: 'D', Customer: 'cus_d' });
  w.createAutomation(req.id, {
    name: 'Nightly sync',
    trigger: { type: 'schedule', cron: '0 9 * * *', zone: 'America/Los_Angeles' },
    actions: [
      { type: 'upsert-row', table: 'Billing/Account', key: 'Stripe Id', fields: { 'Stripe Id': 'row.Customer', Name: 'event.type' } },
      { type: 'set-field', field: 'Account Ref', value: '{{steps.1.name}}#{{steps.1.publicId}}' },
    ],
  });
  clock = new Date('2027-03-10T17:00:10Z');
  assert.equal(w.runSchedules(), 1);
  const a = read(w, w.listEntities(acct.id)[0].id);
  assert.equal(a.name, 'schedule');
  assert.equal(read(w, w.listEntities(req.id)[0].id).fields['Account Ref'], `schedule#${a.publicId}`);
});
