import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';

const FORMATS = {
  plain: {},
  currency: { format: 'currency', currency: 'USD' },
  percent: { format: 'percent' },
  compact: { format: 'compact' },
  decimals: { decimals: 2 },
};

function workspace(config) {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'N', type: 'number', config });
  w.createEntity('T', { name: 'big', values: { N: 12000 } });
  w.createEntity('T', { name: 'small', values: { N: 10 } });
  return w;
}

const names = (w, where) => w.query('T', { where }).items.map((it) => it.name).sort();

for (const [label, config] of Object.entries(FORMATS)) {
  test(`${label}: every comparison operator reads the stored number`, () => {
    const w = workspace(config);
    assert.deepEqual(names(w, [['N', '>', 5000]]), ['big']);
    assert.deepEqual(names(w, [['N', '>=', 12000]]), ['big']);
    assert.deepEqual(names(w, [['N', '<', 5000]]), ['small']);
    assert.deepEqual(names(w, [['N', '<=', 10]]), ['small']);
    assert.deepEqual(names(w, [['N', '=', 12000]]), ['big']);
    assert.deepEqual(names(w, [['N', '!=', 12000]]), ['small']);
    assert.deepEqual(names(w, [['N', 'in', [10, 12000]]]), ['big', 'small']);
    assert.deepEqual(names(w, [['N', '>', '5000']]), ['big']);
  });
}

test('currency: the read still paints the costume', () => {
  const w = workspace(FORMATS.currency);
  const big = w.query('T', { where: [['N', '>', 5000]] }).items[0];
  assert.equal(big.fields.N, '$12,000.00');
  assert.equal(w.query('T', { where: [['N', 'contains', '$12,000']] }).total, 1);
});

test('a number formula with a currency format compares by its number', () => {
  const w = workspace(FORMATS.currency);
  w.addField('T', { name: 'Double', type: 'formula', config: { expression: '[N] * 2', format: 'currency', currency: 'USD' } });
  assert.deepEqual(names(w, [['Double', '>', 20000]]), ['big']);
});

test('a currency field across a relation compares by its number', () => {
  const w = workspace(FORMATS.currency);
  w.createTable({ space: 'S', name: 'Deal' });
  w.addRelation('Deal', { name: 'Item', targetDb: 'T' });
  w.createEntity('Deal', { name: 'd1', values: { Item: 'big' } });
  w.createEntity('Deal', { name: 'd2', values: { Item: 'small' } });
  assert.deepEqual(w.query('Deal', { where: [['Item.N', '>', 5000]] }).items.map((it) => it.name), ['d1']);
});

test('MCP: weave_query over a currency field', () => {
  const w = workspace(FORMATS.currency);
  const out = dispatchTool(w, 'weave_query', { db: 'T', where: [['N', '>', 5000]] });
  assert.equal(out.total, 1);
});
