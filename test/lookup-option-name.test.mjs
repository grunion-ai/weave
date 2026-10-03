/* A lookup of a select shows the option's name (Issue #598).

   The lookup's display was the option's stored id, the slug: "credit-card"
   where the select column on the far table shows "Credit card". An option
   whose name is already a slug hides the bug, so every option here has a
   name that differs from its id. The lookup wears the far field's costume:
   option names for a select and a multiselect, the state name for a
   workflow. `raw` keeps the stored ids. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';

function workspace({ many = false } = {}) {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'A' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('A', { name: 'K', type: 'select', config: { options: [{ name: 'Credit card' }, { name: 'Bank Transfer' }] } });
  w.addField('A', { name: 'Tags', type: 'multiselect', config: { options: [{ name: 'Big Spend' }, { name: 'Travel Cost' }] } });
  w.addField('A', { name: 'Stage', type: 'workflow', config: { states: [{ name: 'In Review' }, { name: 'Paid Out' }] } });
  w.addRelation('T', { name: 'A', targetDb: 'A', ...(many ? { cardinality: 'many-to-many' } : {}) });
  for (const name of ['K', 'Tags', 'Stage']) {
    w.addField('T', { name: `L ${name}`, type: 'lookup', config: { relationField: 'A', targetField: name } });
  }
  w.createEntity('A', { Name: 'a', K: 'Credit card', Tags: ['Big Spend', 'Travel Cost'], Stage: 'Paid Out' });
  w.createEntity('A', { Name: 'b', K: 'Bank Transfer', Tags: ['Travel Cost'], Stage: 'In Review' });
  const t = w.createEntity('T', { Name: 't', A: many ? ['a', 'b'] : 'a' });
  return { w, t };
}

test('a lookup of a select, a multiselect and a workflow reads their names', () => {
  const { w, t } = workspace();
  const read = w.readEntity(t.id);
  assert.equal(read.fields['L K'], 'Credit card');
  assert.deepEqual(read.fields['L Tags'], ['Big Spend', 'Travel Cost']);
  assert.equal(read.fields['L Stage'], 'Paid Out');
  // raw keeps the stored id.
  assert.notEqual(read.raw['L K'], 'Credit card');
});

test('a many lookup of a select reads each name', () => {
  const { w, t } = workspace({ many: true });
  const read = w.readEntity(t.id);
  assert.deepEqual(read.fields['L K'], ['Credit card', 'Bank Transfer']);
  assert.deepEqual(read.fields['L Stage'], ['Paid Out', 'In Review']);
  assert.deepEqual(read.fields['L Tags'], [['Big Spend', 'Travel Cost'], ['Travel Cost']]);
});

test('query rows, select, where and MCP read the option name', () => {
  const { w } = workspace();
  assert.equal(w.query('T', {}).items[0].fields['L K'], 'Credit card');
  assert.equal(w.query('T', { select: ['L K'] }).items[0]['L K'], 'Credit card');
  assert.equal(w.query('T', { where: [['L K', '=', 'Credit card']] }).total, 1);
  assert.equal(dispatchTool(w, 'weave_get_entity', { entity: 'T#1' }).fields['L K'], 'Credit card');
});
