import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function workspace() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const company = w.createTable({ space: 'Sales', name: 'Company' });
  return { w, company };
}

const withTerm = (w, db, term) => w.updateField(db.id, db.nameFieldId, { config: { term } });
const inverseOf = (w, result) => w.getTable(result.field.config.targetDb).fields[result.inverse.id].name;

test('a plural table name with no term names the inverse as written, on both sides', () => {
  const { w, company } = workspace();
  const items = w.createTable({ space: 'Sales', name: 'Action Items' });
  const many = w.addRelation(items, { name: 'Company', targetDb: company, cardinality: 'many-to-one' });
  assert.equal(inverseOf(w, many), 'Action Items');
  const contact = w.createTable({ space: 'Sales', name: 'Contact' });
  const one = w.addRelation(items, { name: 'Contact', targetDb: contact, cardinality: 'one-to-many' });
  assert.equal(inverseOf(w, one), 'Action Items');
});

test('the many side takes the plural term from the Name field, cased like the table name', () => {
  const { w, company } = workspace();
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  withTerm(w, deal, { singular: 'deal', plural: 'deals' });
  const many = w.addRelation(deal, { name: 'Company', targetDb: company, cardinality: 'many-to-one' });
  assert.equal(inverseOf(w, many), 'Deals');
  const contact = w.createTable({ space: 'Sales', name: 'Contact' });
  const one = w.addRelation(deal, { name: 'Owner', targetDb: contact, cardinality: 'one-to-one' });
  assert.equal(inverseOf(w, one), 'Deal', 'the one side keeps the table name');
});

test('a multi-word title-case table name title-cases every word of its plural term', () => {
  const { w, company } = workspace();
  const item = w.createTable({ space: 'Sales', name: 'Action Item' });
  withTerm(w, item, { singular: 'action item', plural: 'action items' });
  const many = w.addRelation(item, { name: 'Company', targetDb: company, cardinality: 'many-to-one' });
  assert.equal(inverseOf(w, many), 'Action Items');
});

test('a table with no term names the inverse with its own name', () => {
  const { w, company } = workspace();
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  const many = w.addRelation(deal, { name: 'Company', targetDb: company, cardinality: 'many-to-many' });
  assert.equal(inverseOf(w, many), 'Deal');
});

test('an explicit inverseName is kept', () => {
  const { w, company } = workspace();
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  withTerm(w, deal, { singular: 'deal', plural: 'deals' });
  const many = w.addRelation(deal, { name: 'Company', targetDb: company, cardinality: 'many-to-one', inverseName: 'Pipeline' });
  assert.equal(inverseOf(w, many), 'Pipeline');
});

test('a text field turned relation names its inverse the same way', () => {
  const { w, company } = workspace();
  w.createEntity(company, { name: 'Acme' });
  const items = w.createTable({ space: 'Sales', name: 'Action Items' });
  w.addField(items, { name: 'Company', type: 'text' });
  w.updateField(items.id, 'Company', { type: 'relation', config: { targetDb: 'Company' } });
  assert.ok(w.findField(w.getTable(company.id), 'Action Items'), 'no term: the table name as written');

  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  withTerm(w, deal, { singular: 'deal', plural: 'deals' });
  w.addField(deal, { name: 'Company', type: 'text' });
  w.updateField(deal.id, 'Company', { type: 'relation', config: { targetDb: 'Company' } });
  assert.ok(w.findField(w.getTable(company.id), 'Deals'), 'with a term: its plural');

  const lead = w.createTable({ space: 'Sales', name: 'Lead' });
  withTerm(w, lead, { singular: 'lead', plural: 'leads' });
  w.addField(lead, { name: 'Company', type: 'text' });
  w.updateField(lead.id, 'Company', { type: 'relation', config: { targetDb: 'Company', inverseName: 'Prospects' } });
  assert.ok(w.findField(w.getTable(company.id), 'Prospects'), 'an explicit inverseName wins');
  assert.equal(w.findField(w.getTable(company.id), 'Leads'), undefined);
});
