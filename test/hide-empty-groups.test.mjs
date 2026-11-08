import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';

function posts() {
  const w = new Weave();
  w.createSpace({ name: 'Marketing' });
  const t = w.createTable({ space: 'Marketing', name: 'Post' });
  w.addField(t.id, { name: 'Style', type: 'select', config: { options: [{ name: 'Poster' }, { name: 'Ledger' }, { name: 'Thread' }] } });
  w.createEntity('Post', { name: 'a', Style: 'Poster' });
  w.createEntity('Post', { name: 'b', Style: 'Poster' });
  return { w, t };
}

test('hideEmpty takes true, false or null; false and null read as unset', () => {
  const { w } = posts();
  assert.throws(() => w.tableView('Post/Standard', { hideEmpty: 'yes' }), /hideEmpty is true, false or null/);
  w.tableView('Post/Standard', { hideEmpty: true });
  assert.equal(w.tableView('Post/Standard', { hideEmpty: false }).hideEmpty, undefined);
  w.tableView('Post/Standard', { hideEmpty: true });
  assert.equal(w.tableView('Post/Standard', { hideEmpty: null }).hideEmpty, undefined);
});

test('hideEmpty travels with describeSchema, the view copy and weave_table_view', () => {
  const { w } = posts();
  w.tableView('Post/Standard', { layout: 'board', group: ['Style'], hideEmpty: true });
  assert.equal(w.tableView('Post/Copy', { from: 'Standard' }).hideEmpty, true);
  const w2 = new Weave();
  w2.applySchema(w.describeSchema());
  assert.equal(w2.tableView('Post/Standard').hideEmpty, true);
  const v = dispatchTool(w, 'weave_table_view', { view: 'Post/Standard', hideEmpty: null });
  assert.equal(v.hideEmpty, undefined);
  const tool = TOOLS.find((x) => x.name === 'weave_table_view');
  assert.ok(tool.inputSchema.properties.hideEmpty, 'schema names hideEmpty');
});
