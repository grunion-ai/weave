import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { sharePage } from '../src/shares.js';

function sharedTable(records) {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const task = w.createTable({ space: 'Dev', name: 'Task' });
  w.addField(task.id, { name: 'Owner', type: 'text' });
  for (let i = 1; i <= records; i++) w.createEntity(task.id, { name: `Item ${i}`, values: { Owner: 'dana' } });
  const grant = w.mintShare({ scope: { kind: 'table', id: task.id } });
  const page = () => sharePage(w, grant, `/table/${task.id}`, { method: 'GET' }).html;
  return { page };
}

test('a shared saved view lists the plain fields as columns and leaves out the view fields', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const task = w.createTable({ space: 'Dev', name: 'Task' });
  w.addField(task.id, { name: 'Owner', type: 'text' });
  w.createEntity(task.id, { name: 'One', values: { Owner: 'dana' } });
  const view = w.createView({ name: 'Open work', blocks: [{ table: task.id }] });
  const grant = w.mintShare({ scope: { kind: 'view', id: view.id } });
  const { html } = sharePage(w, grant, `/view/${view.id}`, { method: 'GET' });
  assert.match(html, /<th>Name<\/th><th>Owner<\/th>/);
  assert.doesNotMatch(html, /<th>(Chip|Card)<\/th>/);
});

test('a shared table page counts one record in the singular', () => {
  const html = sharedTable(1).page();
  assert.match(html, /1 record(?!s)/);
  assert.doesNotMatch(html, /1 records/);
});

test('a shared table page counts several records in the plural', () => {
  assert.match(sharedTable(3).page(), /3 records/);
});
