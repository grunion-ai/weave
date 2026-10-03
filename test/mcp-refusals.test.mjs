/* Refusals an agent can act on (Issues #600, #626). A stock agent that sends
   the wrong argument shape gets a refusal naming the argument and the shape
   weave takes, never a raw JavaScript TypeError or a field lookup on the
   whole malformed value. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Money' });
  w.createTable({ space: 'Money', name: 'Txn' });
  w.addField('Txn', { name: 'Date', type: 'date' });
  w.addField('Txn', { name: 'Amount', type: 'number' });
  return w;
}

/* ---------- #600: weave_update_entity without values ---------- */

test('weave_update_entity without values is refused by name, not a TypeError', () => {
  const w = fresh();
  const e = dispatchTool(w, 'weave_create_entity', { db: 'Txn', name: 'Rent' });
  assert.throws(() => dispatchTool(w, 'weave_update_entity', { entity: e.id }),
    (err) => !(err instanceof TypeError) && /values is required: a map of field name to value/.test(err.message));
});

test('weave_update_entity with fields instead of values names the unknown key', () => {
  const w = fresh();
  const e = dispatchTool(w, 'weave_create_entity', { db: 'Txn', name: 'Rent' });
  assert.throws(() => dispatchTool(w, 'weave_update_entity', { entity: e.id, db: 'Txn', fields: { Name: 'x' } }),
    (err) => /values is required/.test(err.message) && /'fields'/.test(err.message) && /'db'/.test(err.message));
  assert.equal(w.readEntity(e.id).name, 'Rent', 'nothing was written');
});

test('weave_update_entity refuses values that are not a map', () => {
  const w = fresh();
  const e = dispatchTool(w, 'weave_create_entity', { db: 'Txn', name: 'Rent' });
  for (const values of [null, 'Name=x', ['Name', 'x']]) {
    assert.throws(() => dispatchTool(w, 'weave_update_entity', { entity: e.id, values }),
      /values is required: a map of field name to value/, JSON.stringify(values));
  }
});

test('weave_create_entity names an unknown key instead of creating an empty row', () => {
  const w = fresh();
  assert.throws(() => dispatchTool(w, 'weave_create_entity', { db: 'Txn', fields: { Name: 'Rent' } }),
    (err) => /'fields'/.test(err.message) && /values/.test(err.message));
  assert.equal(w.listEntities(w.getTable('Txn').id).length, 0, 'no empty row was left behind');
  assert.throws(() => dispatchTool(w, 'weave_create_entity', { db: 'Txn', values: 'Name=Rent' }),
    /values is a map of field name to value/);
});

test('the well-formed calls still land, verbose included', () => {
  const w = fresh();
  const e = dispatchTool(w, 'weave_create_entity', { db: 'Txn', name: 'Rent', values: { Amount: 5 }, verbose: true });
  const r = dispatchTool(w, 'weave_update_entity', { entity: e.id, values: { Amount: 7 }, verbose: true });
  assert.equal(r.fields.Amount, 7);
});

/* ---------- #626: a Sort written as JSON or "-Date" ---------- */

const viewRow = (w, name) => w.listEntities(w.getTable('Views').id).map((e) => w.readEntity(e.id))
  .find((r) => r.name === name);

test('a Views row Sort takes "-Date", "+Date", JSON text and a JSON list', () => {
  const w = fresh();
  w.tableView('Txn/Recent', { fields: ['Name', 'Date'] });
  const id = viewRow(w, 'Recent').id;
  const cases = [
    ['-Date', [{ field: 'Date', dir: 'desc' }]],
    ['+Date, -Amount', [{ field: 'Date', dir: 'asc' }, { field: 'Amount', dir: 'desc' }]],
    ['[{"field":"Date","dir":"desc"}]', [{ field: 'Date', dir: 'desc' }]],
    [[{ field: 'Amount', dir: 'DESC' }, 'Date'], [{ field: 'Amount', dir: 'desc' }, { field: 'Date', dir: 'asc' }]],
    ['["-Amount"]', [{ field: 'Amount', dir: 'desc' }]],
    ['Date desc', [{ field: 'Date', dir: 'desc' }]],
  ];
  for (const [Sort, want] of cases) {
    w.updateEntity(id, { Sort });
    assert.deepEqual(w.tableView('Txn/Recent').sort, want, JSON.stringify(Sort));
  }
  assert.equal(viewRow(w, 'Recent').fields.Sort, 'Date desc', 'the row reads back in the one spelling');
});

test('the same forms land through weave_update_entity on a Views row', () => {
  const w = fresh();
  w.tableView('Txn/Recent', { fields: ['Name', 'Date'] });
  const id = viewRow(w, 'Recent').id;
  dispatchTool(w, 'weave_update_entity', { entity: id, values: { Sort: [{ field: 'Date', dir: 'desc' }] } });
  assert.deepEqual(w.tableView('Txn/Recent').sort, [{ field: 'Date', dir: 'desc' }]);
});

test('a Tables row Sort takes "-Date" too', () => {
  const w = fresh();
  const row = w.listEntities(w.getTable('Tables').id).map((e) => w.readEntity(e.id)).find((r) => r.name === 'Txn');
  w.updateEntity(row.id, { Sort: '-Date' });
  assert.deepEqual(w.tableView('Txn/Standard').sort, [{ field: 'Date', dir: 'desc' }]);
});

test('an unknown Sort field names the accepted form', () => {
  const w = fresh();
  w.tableView('Txn/Recent', { fields: ['Name', 'Date'] });
  const id = viewRow(w, 'Recent').id;
  assert.throws(() => w.updateEntity(id, { Sort: '-When' }),
    (err) => /Field 'When' not found/.test(err.message) && /Date desc/.test(err.message));
  assert.throws(() => w.updateEntity(id, { Sort: '[{"field":"Date"' }),
    (err) => /Sort reads 'Field asc\|desc, Field2 asc\|desc'/.test(err.message));
  assert.throws(() => w.updateEntity(id, { Sort: 'Date sideways' }),
    (err) => /Sort reads 'Field asc\|desc, Field2 asc\|desc'/.test(err.message) || /not found/.test(err.message));
});
