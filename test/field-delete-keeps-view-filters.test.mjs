import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

test('deleting one filtered field leaves the filter on the other field', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Status', type: 'select', config: { options: ['Open', 'Done'] } });
  w.addField('Task', { name: 'Team', type: 'select', config: { options: ['Core', 'Web'] } });
  w.tableView('Task/Main', { from: 'blank', filters: { Status: ['Open'], Team: ['Core'] } });
  w.deleteField('Task', 'Status');
  assert.deepEqual(w.tableView('Task/Main').filters, { Team: ['Core'] });
  w.restoreField('Task', 'Status');
  assert.deepEqual(w.tableView('Task/Main').filters, { Team: ['Core'], Status: ['Open'] });
});

test('deleting the only filtered field leaves the view without filters', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Status', type: 'select', config: { options: ['Open', 'Done'] } });
  w.tableView('Task/Main', { from: 'blank', filters: { Status: ['Open'] } });
  w.deleteField('Task', 'Status');
  assert.equal(w.tableView('Task/Main').filters, undefined);
});
