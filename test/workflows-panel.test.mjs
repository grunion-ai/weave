import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const wf = (w) => w.getTable('System/Workflows');
const names = (t, ids) => ids.map((id) => t.fields[id]?.name ?? id);
const PANEL = ['On', 'Name', 'When', 'Then', 'Health', 'Last Run'];

function demo() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  w.addField(t.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'New', default: true }, { name: 'Done', category: 'done' }] } });
  w.addField(t.id, { name: 'Notes', type: 'text' });
  w.addField(t.id, { name: 'Body', type: 'document' });
  w.createSpace({ name: 'Billing' });
  const acct = w.createTable({ space: 'Billing', name: 'Account' });
  w.addField(acct.id, { name: 'Stripe Id', type: 'text' });
  return { w, t };
}

test('the Workflows Standard view reads as the control panel: On, Name, When, Then, Health, Last Run (Feature #249)', () => {
  const w = new Weave();
  const t = wf(w);
  for (const name of ['When', 'Then']) {
    const fld = Object.values(t.fields).find((x) => x.name === name);
    assert.equal(fld?.type, 'text', `${name} is a text field`);
    assert.equal(fld.system, true, `${name} is a system field`);
  }
  assert.deepEqual(names(t, t.tableViews[0].fields), PANEL);
  assert.equal(t.tableViews[0].name, 'Standard');
  assert.deepEqual(w.tableView(`${t.id}/${t.tableViews[0].id}`).widths, { When: 280, Then: 320 }, 'the sentences get room to be read');
  assert.deepEqual(w.tableView(`${t.id}/${t.tableViews[0].id}`).phoneRow, { lead: 'Health', chips: ['On', 'When', 'Then'], wrap: true }, 'a phone row leads on Health and wraps the switch and both sentences');
});

test('a workspace from before the panel takes the panel columns on load, once, and a later change is kept (Feature #249)', () => {
  const w = new Weave();
  const json = w.exportJSON();
  const t = Object.values(json.tables).find((x) => x.system === 'workflows');
  for (const name of ['When', 'Then']) {
    const id = Object.values(t.fields).find((x) => x.name === name).id;
    delete t.fields[id];
    t.fieldOrder = t.fieldOrder.filter((x) => x !== id);
    for (const v of t.tableViews) v.fields = v.fields.filter((x) => x !== id);
  }
  delete t.workflowPanel;
  t.tableViews[0].fields = t.fieldOrder.slice(0, 3);

  const w2 = new Weave();
  w2.importJSON(json);
  const t2 = wf(w2);
  assert.deepEqual(names(t2, t2.tableViews[0].fields), PANEL);
  assert.equal(Object.values(t2.fields).filter((x) => x.name === 'When').length, 1, 'one When field');

  w2.tableView(`${t2.id}/${t2.tableViews[0].id}`, { fields: ['Name', 'On', 'Health'] });
  const again = new Weave();
  again.importJSON(w2.exportJSON());
  assert.deepEqual(names(wf(again), wf(again).tableViews[0].fields), ['Name', 'On', 'Health'], 'the reader\'s columns survive a reopen');
});

const row = (w, id) => w.readEntity(id).fields;

test('When names the table and the trigger in words, for every trigger type (Feature #249)', () => {
  const { w, t } = demo();
  const act = [{ type: 'add-comment', text: 'hi' }];
  const cases = [
    [{ type: 'entity-created' }, 'A record is created in Ops/Request'],
    [{ type: 'field-updated', field: 'Notes' }, 'Notes changes in Ops/Request'],
    [{ type: 'state-changed', field: 'Status' }, 'Status moves in Ops/Request'],
    [{ type: 'state-changed', field: 'Status', toState: 'Done' }, 'Status moves to Done in Ops/Request'],
    [{ type: 'schedule', cron: '0 9 * * 1-5', zone: 'America/Los_Angeles' }, 'Schedule 0 9 * * 1-5 America/Los_Angeles, every record in Ops/Request'],
    [{ type: 'schedule', cron: '*/15 * * * *', where: [['Status', '!=', 'Done']] }, 'Schedule */15 * * * * UTC, matching records in Ops/Request'],
  ];
  for (const [trigger, words] of cases) {
    const auto = w.createAutomation(t.id, { name: JSON.stringify(trigger), trigger, actions: act });
    assert.equal(row(w, auto.id).When, words, trigger.type);
  }
});

test('Then lists the actions in words, in order (Feature #249)', () => {
  const { w, t } = demo();
  const auto = w.createAutomation(t.id, {
    name: 'Everything',
    trigger: { type: 'entity-created' },
    actions: [
      { type: 'set-field', field: 'Notes', value: 'seen {{Today}}' },
      { type: 'set-field', field: 'Notes', value: null },
      { type: 'append-doc', field: 'Body', text: 'More' },
      { type: 'append-doc', text: 'More' },
      { type: 'add-comment', text: 'Hello' },
      { type: 'webhook', url: 'https://hooks.example.com/weave/x?y=1' },
      { type: 'webhook', url: 'https://hooks.example.com/weave', signWith: 'hooks' },
      { type: 'upsert-row', table: 'Billing/Account', key: 'Stripe Id', fields: { 'Stripe Id': 'row.Name' } },
    ],
  });
  assert.equal(row(w, auto.id).Then, [
    'Set Notes to "seen {{Today}}"',
    'Clear Notes',
    'Append to Body',
    'Append to the document',
    'Add a comment',
    'Post to hooks.example.com',
    'Post to hooks.example.com, signed',
    'Create or update a record in Billing/Account by Stripe Id',
  ].join(', then '));
});

test('When and Then follow an edit of the Script, and clear while setup is incomplete (Feature #249)', () => {
  const { w, t } = demo();
  const auto = w.createAutomation(t.id, { name: 'Edit me', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'x' }] });
  w.setDoc(auto.id, JSON.stringify({ table: 'Ops/Request', trigger: { type: 'field-updated', field: 'Notes' }, actions: [{ type: 'add-comment', text: 'x' }] }), 'Script');
  assert.equal(row(w, auto.id).When, 'Notes changes in Ops/Request');
  w.setDoc(auto.id, '{"table": "Ops/Request"}', 'Script');
  assert.equal(row(w, auto.id).State, 'Setup incomplete');
  assert.equal(row(w, auto.id).When, null);
  assert.equal(row(w, auto.id).Then, null);
});
