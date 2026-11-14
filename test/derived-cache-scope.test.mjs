import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function seeded() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const company = w.createTable({ space: 'Sales', name: 'Company' });
  const owner = w.createTable({ space: 'Sales', name: 'Owner' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  w.addField(owner.id, { name: 'Tier', type: 'select', config: { options: ['Gold', 'Silver'] } });
  w.addRelation(owner.id, { name: 'Company', targetDb: company.id, cardinality: 'many-to-one', inverseName: 'Owners' });
  w.addField(owner.id, { name: 'Company name', type: 'lookup', config: { relationField: 'Company', targetField: 'Name' } });
  w.addField(deal.id, { name: 'Amount', type: 'number', config: { display: 'bar' } });
  w.addRelation(deal.id, { name: 'Owner', targetDb: owner.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addField(deal.id, { name: 'Owner name', type: 'lookup', config: { relationField: 'Owner', targetField: 'Name' } });
  w.addField(deal.id, { name: 'Owner company', type: 'lookup', config: { relationField: 'Owner', targetField: 'Company name' } });
  w.addField(deal.id, { name: 'Owner tier', type: 'lookup', config: { relationField: 'Owner', targetField: 'Tier' } });
  w.createSpace({ name: 'Ops' });
  const other = w.createTable({ space: 'Ops', name: 'Other' });
  w.addField(other.id, { name: 'N', type: 'number' });
  const companies = ['Acme', 'Birch'].map((name) => w.createEntity(company.id, { name }));
  const owners = [['Maya', 'Gold', 0], ['Ari', 'Silver', 1], ['Zed', 'Gold', 1]]
    .map(([name, Tier, at]) => w.createEntity(owner.id, { name, values: { Tier, Company: companies[at].id } }));
  const deals = [50, 10, 70, 30].map((Amount, i) => w.createEntity(deal.id, { name: `Deal ${i}`, values: { Amount, Owner: owners[i % 3].id } }));
  const row = w.createEntity(other.id, { name: 'o', values: { N: 1 } });
  return { w, company, owner, deal, other, companies, owners, deals, row };
}

function reads(w, field) {
  let seen = 0;
  const findField = Weave.prototype.findField;
  w.findField = function (db, ref) {
    if (ref === field) seen++;
    return findField.call(this, db, ref);
  };
  return () => { const n = seen; seen = 0; return n; };
}

const names = (page) => page.items.map((e) => e.Name);
const byAmount = (w, deal) => names(w.query(deal.id, { sort: [{ field: 'Amount', dir: 'desc' }], select: ['Name'], limit: 2 }));
const overTwenty = (w, deal) => names(w.query(deal.id, { where: [['Amount', '>', 20]], select: ['Name'] }));

function fresh(w) {
  const copy = new Weave();
  copy.importJSON(w.exportJSON({ blobs: false }));
  return copy;
}

test('a write to a table the page does not read keeps its sort and its filter warm (Issue #1613)', () => {
  const { w, deal, other, row } = seeded();
  const amountReads = reads(w, 'Amount');
  assert.deepEqual(byAmount(w, deal), ['Deal 2', 'Deal 0']);
  assert.ok(amountReads() >= 4, 'a cold page reads every row');
  assert.deepEqual(overTwenty(w, deal), ['Deal 0', 'Deal 2', 'Deal 3']);
  assert.ok(amountReads() >= 4, 'a cold filter reads every row');
  w.updateEntity(row.id, { N: 2 });
  w.createEntity(other.id, { name: 'p', values: { N: 3 } });
  w.deleteEntity(row.id);
  assert.deepEqual(byAmount(w, deal), ['Deal 2', 'Deal 0']);
  assert.deepEqual(overTwenty(w, deal), ['Deal 0', 'Deal 2', 'Deal 3']);
  assert.equal(amountReads(), 0, 'three writes to Other leave the Deal pages warm');
});

test('a save that writes no row keeps the page warm, and a session renewal moves no schema version (Issue #1613)', () => {
  const { w, deal } = seeded();
  const { account } = w.createAccount({ name: 'Ann', role: 'admin' });
  const { token } = w.createSession(account.id);
  const amountReads = reads(w, 'Amount');
  byAmount(w, deal);
  assert.ok(amountReads() > 0);
  w.save();
  byAmount(w, deal);
  assert.equal(amountReads(), 0, 'a bare save');
  const version = w.schemaVersion();
  for (const s of Object.values(w.state.meta.sessions)) s.lastSeenAt = new Date(Date.now() - 120_000).toISOString();
  assert.equal(w.verifySession(token).renewed, true);
  assert.equal(w.schemaVersion(), version, 'a renewed session is not structure');
  assert.deepEqual(byAmount(w, deal), ['Deal 2', 'Deal 0']);
  assert.equal(amountReads(), 0, 'a renewal cools no page');
});

test('a write to the sorted table cools its page and the page sorts on the new value (Issue #1613)', () => {
  const { w, deal, deals } = seeded();
  const amountReads = reads(w, 'Amount');
  byAmount(w, deal);
  overTwenty(w, deal);
  amountReads();
  w.updateEntity(deals[1].id, { Amount: 500 });
  assert.deepEqual(byAmount(w, deal), ['Deal 1', 'Deal 2']);
  assert.deepEqual(overTwenty(w, deal), ['Deal 0', 'Deal 1', 'Deal 2', 'Deal 3']);
  assert.ok(amountReads() > 0);
});

test('a write two relations away re-sorts the page that reads it (Issue #1613)', () => {
  const { w, deal, companies } = seeded();
  const byCompany = () => names(w.query(deal.id, { sort: [{ field: 'Owner company', dir: 'asc' }, { field: 'Amount', dir: 'asc' }], select: ['Name'] }));
  const theirs = () => names(fresh(w).query(deal.id, { sort: [{ field: 'Owner company', dir: 'asc' }, { field: 'Amount', dir: 'asc' }], select: ['Name'] }));
  assert.deepEqual(byCompany(), ['Deal 3', 'Deal 0', 'Deal 1', 'Deal 2']);
  w.updateEntity(companies[0].id, { Name: 'Zinc' });
  assert.deepEqual(byCompany(), ['Deal 1', 'Deal 2', 'Deal 3', 'Deal 0']);
  assert.deepEqual(byCompany(), theirs());
});

test('a hard delete re-sorts the pages that read the deleted row (Issue #1613)', () => {
  const { w, deal, owners } = seeded();
  const byOwner = () => names(w.query(deal.id, { sort: [{ field: 'Owner name', dir: 'asc' }, { field: 'Amount', dir: 'asc' }], select: ['Name'] }));
  assert.deepEqual(byOwner(), ['Deal 1', 'Deal 3', 'Deal 0', 'Deal 2']);
  w.deleteEntity(owners[0].id, { hard: true });
  assert.deepEqual(byOwner(), ['Deal 1', 'Deal 2', 'Deal 3', 'Deal 0']);
});

test('a schema change re-sorts every page that reads the changed field (Issue #1613)', () => {
  const { w, owner, deal } = seeded();
  const byTier = () => names(w.query(deal.id, { sort: [{ field: 'Owner tier', dir: 'asc' }, { field: 'Amount', dir: 'asc' }], select: ['Name'] }));
  assert.deepEqual(byTier(), ['Deal 3', 'Deal 0', 'Deal 2', 'Deal 1']);
  const options = w.getField(owner.id, 'Tier').config.options;
  w.updateField(owner.id, 'Tier', { config: { options: options.map((o) => (o.name === 'Gold' ? { ...o, name: 'Tin' } : o)) } });
  assert.deepEqual(byTier(), ['Deal 1', 'Deal 3', 'Deal 0', 'Deal 2']);
});

test('a table rollup on the Spaces registry follows a write to the table it rolls up (Issue #1613)', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const job = w.createTable({ space: 'Ops', name: 'Job' });
  w.addField(job.id, { name: 'Hours', type: 'number' });
  const row = w.createEntity(job.id, { name: 'a', values: { Hours: 3 } });
  const spaces = Object.values(w.state.tables).find((t) => t.system === 'spaces');
  w.addField(spaces.id, { name: 'Job hours', type: 'rollup', config: { via: job.id, targetField: 'Hours', aggregate: 'sum' } });
  const busy = () => names(w.query(spaces.id, { where: [['Job hours', '>', 50]], select: ['Name'] }));
  assert.deepEqual(busy(), []);
  w.updateEntity(row.id, { Hours: 99 });
  assert.deepEqual(busy(), ['Ops']);
});

test('a table rollup in a hub registry follows a write in the member that holds the table (Issue #1613)', () => {
  const root = new Weave({ name: 'root' });
  const alpha = new Weave({ name: 'alpha' });
  alpha.joinRegistry(root);
  alpha.createSpace({ name: 'Ops' });
  const job = alpha.createTable({ space: 'Ops', name: 'Job' });
  alpha.addField(job.id, { name: 'Hours', type: 'number' });
  const row = alpha.createEntity(job.id, { name: 'a', values: { Hours: 3 } });
  const spaces = Object.values(root.state.tables).find((t) => t.system === 'spaces');
  root.addField(spaces.id, { name: 'Job hours', type: 'rollup', config: { via: job.id, targetField: 'Hours', aggregate: 'sum' } });
  const busy = () => names(root.query(spaces.id, { where: [['Job hours', '>', 50]], select: ['Name'] }));
  assert.deepEqual(busy(), []);
  alpha.updateEntity(row.id, { Hours: 99 });
  assert.deepEqual(busy(), ['Ops']);
});

test('the bar scale of a number column follows writes to its own table (Issue #1613)', () => {
  const { w, deal, deals, row } = seeded();
  const scale = () => w.readEntity(deals[0].id).scales.Amount;
  assert.equal(scale(), 70);
  w.updateEntity(deals[1].id, { Amount: 500 });
  assert.equal(scale(), 500);
  w.updateEntity(row.id, { N: 9 });
  assert.equal(scale(), 500);
  w.deleteEntity(deals[1].id);
  assert.equal(scale(), 70);
  assert.equal(w.query(deal.id, { limit: 1 }).items[0].scales.Amount, 70);
});
