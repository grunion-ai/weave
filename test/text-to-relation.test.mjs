import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, TYPE_MIGRATIONS } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';

function ledger() {
  const w = new Weave();
  w.createSpace({ name: 'Budget' });
  const account = w.createTable({ space: 'Budget', name: 'Account' });
  const tx = w.createTable({ space: 'Budget', name: 'Transaction' });
  w.addField(tx, { name: 'Account', type: 'text', config: { width: 150, description: 'Where the money moved' } });
  w.addField(tx, { name: 'Tags', type: 'text' });
  const checking = w.createEntity(account, { name: 'Checking' });
  const savings = w.createEntity(account, { name: 'Savings' });
  const rows = [['Rent', 'Checking'], ['Coffee', 'checking'], ['Interest', 'Savings'], ['Blank', null]]
    .map(([name, acct]) => w.createEntity(tx, { name, values: { Account: acct } }));
  return { w, account, tx, checking, savings, rows };
}
const names = (w, id, field) => {
  const v = w.readEntity(id).fields[field];
  return (Array.isArray(v) ? v : v ? [v] : []).map((x) => x.name ?? x);
};

test('a text column becomes a relation, each value linked to the row of that name', () => {
  const { w, tx, account, checking, savings, rows } = ledger();
  const before = w.getField(tx.id, 'Account');
  const field = w.updateField(tx.id, 'Account', { type: 'relation', config: { targetDb: 'Account' } });
  assert.equal(field.id, before.id, 'the field keeps its id, so views and widths hold');
  assert.equal(field.type, 'relation');
  assert.equal(field.config.targetDb, account.id);
  assert.equal(field.config.width, 150, 'the width rides');
  assert.equal(field.config.description, 'Where the money moved', 'the description rides');
  assert.deepEqual(names(w, rows[0].id, 'Account'), ['Checking']);
  assert.deepEqual(names(w, rows[1].id, 'Account'), ['Checking'], 'a name matches whatever its case');
  assert.deepEqual(names(w, rows[2].id, 'Account'), ['Savings']);
  assert.deepEqual(names(w, rows[3].id, 'Account'), [], 'an empty cell stays empty');
  const inverse = w.getField(account.id, 'Transactions');
  assert.equal(inverse.config.inverseFieldId, field.id, 'the target gains the inverse');
  assert.deepEqual(names(w, checking.id, 'Transactions').sort(), ['Coffee', 'Rent']);
  assert.deepEqual(names(w, savings.id, 'Transactions'), ['Interest']);
});

test('a value no row carries is refused by name, and nothing changes', () => {
  const { w, tx, account, rows } = ledger();
  w.updateEntity(rows[3].id, { Account: 'Brokerage' });
  assert.throws(() => w.updateField(tx.id, 'Account', { type: 'relation', config: { targetDb: 'Account' } }), /Brokerage.*createMissing/s);
  assert.equal(w.getField(tx.id, 'Account').type, 'text', 'the field is untouched');
  assert.equal(w.readEntity(rows[3].id).fields.Account, 'Brokerage', 'the value is untouched');
  assert.equal(w.listEntities(account.id).length, 2, 'no row was made');
  assert.equal(w.findField(w.getTable(account.id), 'Transactions'), undefined, 'no inverse was left behind');
});

test('createMissing makes the rows the values name', () => {
  const { w, tx, account, rows } = ledger();
  w.updateEntity(rows[3].id, { Account: 'Brokerage' });
  w.updateField(tx.id, 'Account', { type: 'relation', config: { targetDb: 'Account', createMissing: true } });
  assert.deepEqual(w.listEntities(account.id).map((e) => w.entityName(e)).sort(), ['Brokerage', 'Checking', 'Savings']);
  assert.deepEqual(names(w, rows[3].id, 'Account'), ['Brokerage']);
});

test('many-to-many splits a list on commas; the cardinalities that would steal rows are refused', () => {
  const { w, tx, rows } = ledger();
  const tag = w.createTable({ space: 'Budget', name: 'Tag' });
  w.updateEntity(rows[0].id, { Tags: 'home, fixed' });
  w.updateEntity(rows[1].id, { Tags: 'treat' });
  w.updateField(tx.id, 'Tags', { type: 'relation', config: { targetDb: 'Tag', cardinality: 'many-to-many', inverseName: 'Spent', createMissing: true } });
  assert.deepEqual(names(w, rows[0].id, 'Tags'), ['home', 'fixed']);
  assert.equal(w.listEntities(tag.id).length, 3);
  assert.throws(() => w.updateField(tx.id, 'Account', { type: 'relation', config: { targetDb: 'Account', cardinality: 'one-to-one' } }), /many-to-one or many-to-many/);
});

test('a figure never resolves as a public id: a value matches a row by its name only', () => {
  const { w, tx, account, rows } = ledger();
  w.updateEntity(rows[3].id, { Account: '1' });
  assert.throws(() => w.updateField(tx.id, 'Account', { type: 'relation', config: { targetDb: account.id } }), /'1'/);
});

test('the conversion rolls back with its values, and the inverse goes', () => {
  const { w, tx, account, rows } = ledger();
  w.updateField(tx.id, 'Account', { type: 'relation', config: { targetDb: 'Account' } });
  const [entry] = w.activityFeed({ entityId: tx.id, kinds: ['field-config-updated'], limit: 1 }).items;
  const out = w.rollbackFieldConfig(entry.id);
  assert.equal(out.field.type, 'text');
  assert.equal(w.readEntity(rows[1].id).fields.Account, 'checking', 'the text as it was typed comes back');
  assert.equal(w.readEntity(rows[3].id).fields.Account, null);
  assert.equal(w.findField(w.getTable(account.id), 'Transactions'), undefined, 'the inverse is gone');
  assert.equal(w.getField(tx.id, 'Account').config.width, 150);
});

test('the Name field and a target-less change are refused; the field tray offers no relation', () => {
  const { w, tx } = ledger();
  assert.throws(() => w.updateField(tx.id, 'Name', { type: 'relation', config: { targetDb: 'Account' } }), /Name field/);
  assert.throws(() => w.updateField(tx.id, 'Account', { type: 'relation' }), /targetDb/);
  assert.ok(!TYPE_MIGRATIONS.text.includes('relation'), 'the tray cannot pick a target, so it never offers this lane');
});

test('weave_update_field converts over MCP', () => {
  const { w, rows } = ledger();
  const res = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_update_field', arguments: { db: 'Transaction', field: 'Account', type: 'relation', config: { targetDb: 'Account' } } } });
  assert.ok(!res.result.isError, res.result.content[0].text);
  assert.equal(JSON.parse(res.result.content[0].text).type, 'relation');
  assert.deepEqual(names(w, rows[2].id, 'Account'), ['Savings']);
});
