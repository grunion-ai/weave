/* A lookup of a relation shows the far row's chip (Issue #643).

   CRM/Activities.Company looks up the Contact relation and reads the
   contact's Company, itself a relation. The lookup carried the company's
   uuid list in `fields`, so the grid, the entity page, CSV and MCP all
   printed `["73ec…"]` where the Contact column beside it drew a chip. A
   lookup whose target is a relation now wears the relation's shape: the
   summary `{id, publicId, name, db}` (with its chip) for a to-one path, a
   list of them when either hop is to-many. `raw` keeps the ids, as it does
   for the relation column itself. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';
import { startServer } from '../src/server.js';

function crm() {
  const w = new Weave();
  w.createSpace({ name: 'CRM' });
  w.createTable({ space: 'CRM', name: 'Companies' });
  w.createTable({ space: 'CRM', name: 'Contacts' });
  w.createTable({ space: 'CRM', name: 'Activities' });
  w.addRelation('Contacts', { name: 'Company', targetDb: 'Companies', cardinality: 'many-to-one' });
  w.addRelation('Contacts', { name: 'Clients', targetDb: 'Companies', cardinality: 'many-to-many', inverseName: 'Advisors' });
  w.addRelation('Activities', { name: 'Contact', targetDb: 'Contacts', cardinality: 'many-to-one' });
  w.addRelation('Activities', { name: 'Attendees', targetDb: 'Contacts', cardinality: 'many-to-many', inverseName: 'Meetings' });
  // to-one over to-one, to-many over to-one, to-one over to-many.
  w.addField('Activities', { name: 'Company', type: 'lookup', config: { relationField: 'Contact', targetField: 'Company' } });
  w.addField('Activities', { name: 'Attendee Companies', type: 'lookup', config: { relationField: 'Attendees', targetField: 'Company' } });
  w.addField('Activities', { name: 'Contact Clients', type: 'lookup', config: { relationField: 'Contact', targetField: 'Clients' } });
  const northwind = w.createEntity('Companies', { Name: 'Northwind Traders' });
  const contoso = w.createEntity('Companies', { Name: 'Contoso' });
  w.createEntity('Contacts', { Name: 'Ada Lovelace', Company: 'Northwind Traders', Clients: ['Contoso', 'Northwind Traders'] });
  w.createEntity('Contacts', { Name: 'Grace Hopper', Company: 'Contoso' });
  w.createEntity('Contacts', { Name: 'Alan Turing', Company: 'Northwind Traders' });
  const call = w.createEntity('Activities', { Name: 'Discovery call', Contact: 'Ada Lovelace', Attendees: ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'] });
  const memo = w.createEntity('Activities', { Name: 'Memo' });
  return { w, call, memo, northwind, contoso };
}

const ref = (s) => s && { id: s.id, publicId: s.publicId, name: s.name, db: s.db };

test('a to-one lookup of a to-one relation reads the far row\'s chip; raw keeps the id', () => {
  const { w, call, northwind } = crm();
  const read = w.readEntity(call.id);
  assert.deepEqual(ref(read.fields.Company), { id: northwind.id, publicId: northwind.publicId, name: 'Northwind Traders', db: 'CRM/Companies' });
  assert.equal(read.fields.Company.chip?.shape, 'chip', 'the chip rides along, as on the relation column');
  assert.deepEqual(read.raw.Company, [northwind.id]);
});

test('a to-many path reads a chip list, each far row once', () => {
  const { w, call, northwind, contoso } = crm();
  const read = w.readEntity(call.id);
  assert.deepEqual(read.fields['Attendee Companies'].map(ref).map((s) => s.name), ['Northwind Traders', 'Contoso']);
  assert.deepEqual(read.fields['Attendee Companies'].map((s) => s.id), [northwind.id, contoso.id]);
  assert.deepEqual(read.fields['Contact Clients'].map((s) => s.name), ['Contoso', 'Northwind Traders']);
});

test('an empty path reads null to-one and [] to-many; a trashed far row drops out', () => {
  const { w, call, memo, northwind } = crm();
  const empty = w.readEntity(memo.id);
  assert.equal(empty.fields.Company, null);
  assert.deepEqual(empty.fields['Attendee Companies'], []);
  w.deleteEntity(northwind.id);
  const read = w.readEntity(call.id);
  assert.equal(read.fields.Company, null);
  assert.deepEqual(read.fields['Attendee Companies'].map((s) => s.name), ['Contoso']);
});

test('query rows, the chip cut, select, where, CSV and a formula read the name', () => {
  const { w, northwind } = crm();
  const rows = w.query('Activities', { where: [['Name', '=', 'Discovery call']] }).items;
  assert.equal(rows[0].fields.Company.name, 'Northwind Traders');
  const cut = w.query('Activities', { relations: 'chip', fields: ['Company', 'Attendee Companies'] });
  assert.deepEqual(cut.items[0].fields.Company, { id: northwind.id, publicId: northwind.publicId, name: 'Northwind Traders' });
  assert.equal(cut.chips[northwind.id].name, 'Northwind Traders', 'the far row\'s summary is sent once in chips');
  assert.equal(w.query('Activities', { select: ['Company'] }).items[0].Company, 'Northwind Traders');
  assert.deepEqual(w.query('Activities', { select: ['Attendee Companies'] }).items[0]['Attendee Companies'], ['Northwind Traders', 'Contoso']);
  assert.equal(w.query('Activities', { where: [['Company', '=', 'Northwind Traders']] }).total, 1);
  assert.equal(w.query('Activities', { where: [['Attendee Companies', '=', 'Contoso']] }).total, 1);
  const csv = w.exportCSV('Activities');
  assert.match(csv, /Discovery call,.*Northwind Traders/);
  assert.doesNotMatch(csv, new RegExp(northwind.id));
  w.addField('Activities', { name: 'Who', type: 'formula', config: { expression: 'UPPER([Company])' } });
  assert.equal(w.query('Activities', { select: ['Who'] }).items[0].Who, 'NORTHWIND TRADERS');
});

test('MCP weave_query and weave_get_entity carry the chip, not the id', () => {
  const { w, northwind } = crm();
  const q = dispatchTool(w, 'weave_query', { db: 'CRM/Activities', where: [['Name', '=', 'Discovery call']] });
  assert.equal(q.items[0].fields.Company.name, 'Northwind Traders');
  assert.equal(q.items[0].fields.Company.id, northwind.id);
  assert.equal(dispatchTool(w, 'weave_get_entity', { entity: 'Activities#1' }).fields.Company.name, 'Northwind Traders');
});

test('POST /api/tables/:id/query answers the chip under the lookup', async () => {
  const { w, northwind } = crm();
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/tables/${w.getTable('Activities').id}/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ where: [['Name', '=', 'Discovery call']] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(ref(body.items[0].fields.Company), { id: northwind.id, publicId: northwind.publicId, name: 'Northwind Traders', db: 'CRM/Companies' });
    assert.deepEqual(body.items[0].fields['Attendee Companies'].map((s) => s.name), ['Northwind Traders', 'Contoso']);
  } finally { server.close(); }
});
