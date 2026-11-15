import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function mine() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Status', type: 'select', config: { options: ['Open', 'Done'] } });
  w.addField('Task', { name: 'Owner', type: 'text' });
  w.addField('Task', { name: 'Notes', type: 'text' });
  w.tableView('Task/Mine', { from: 'blank', filters: { Status: ['Open'] }, widths: { Owner: 200, Notes: 120 } });
  const views = w.getTable('Views');
  const row = () => w.listEntities(views.id).find((e) => w.entityName(e) === 'Mine');
  return { w, row };
}

test('writing one cell of a view record leaves the view filters alone', () => {
  const { w, row } = mine();
  w.updateEntity(row().id, { Search: 'launch' });
  const view = w.tableView('Task/Mine');
  assert.equal(view.search, 'launch');
  assert.deepEqual(view.filters, { Status: ['Open'] });
});

test('a view record with an empty Fields cell leaves the view with no fields', () => {
  const { w, row } = mine();
  w.updateEntity(row().id, { Fields: null });
  assert.deepEqual(w.tableView('Task/Mine').fields, []);
});

test('a view record Widths cell sets the widths and drops the ones it no longer names', () => {
  const { w, row } = mine();
  w.updateEntity(row().id, { Widths: 'Owner 300' });
  assert.deepEqual(w.tableView('Task/Mine').widths, { Owner: 300 });
  w.updateEntity(row().id, { Widths: 'Status 90' });
  assert.deepEqual(w.tableView('Task/Mine').widths, { Status: 90 });
});
