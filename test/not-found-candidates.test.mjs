import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, FIELD_TYPES } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';

function pipeline() {
  const w = new Weave();
  w.createSpace({ name: 'Pipeline' });
  w.createTable({ space: 'Pipeline', name: 'Company' });
  w.createTable({ space: 'Pipeline', name: 'Deal' });
  w.addField('Deal', { name: 'Stage', type: 'text' });
  w.addField('Deal', { name: 'Amount', type: 'number' });
  w.addRelation('Deal', { name: 'Company', targetDb: 'Company', cardinality: 'many-to-one' });
  w.createEntity('Deal', { Name: 'Acme renewal' });
  return w;
}

const refusal = (fn) => {
  try { fn(); } catch (err) { return err; }
  assert.fail('the call was not refused');
};

test('a missing table names the nearest tables, nearest first (Issue #1564)', () => {
  const err = refusal(() => pipeline().query('Deals'));
  assert.equal(err.code, 'not-found');
  assert.match(err.message, /^Table 'Deals' not found; tables: Deal, /);
});

test('a missing field names the table fields nearest first, on writes, where and dotted paths (Issue #1564)', () => {
  const w = pipeline();
  const write = refusal(() => w.createEntity('Deal', { Name: 'x', Stag: 'Won' }));
  assert.equal(write.code, 'not-found');
  assert.match(write.message, /^Field 'Stag' not found in table 'Deal'; fields: Stage, /);
  assert.doesNotMatch(write.message, /Chip|Card/, 'the minted chip and card views are not fields a caller writes');
  const where = refusal(() => w.query('Deal', { where: [['Amout', '>', 1]] }));
  assert.match(where.message, /^Field 'Amout' not found in table 'Deal'; fields: Amount, /);
  const dotted = refusal(() => w.query('Deal', { where: [['Compny.Name', '=', 'Acme']] }));
  assert.match(dotted.message, /^Field 'Compny' not found in table 'Deal'; fields: Company, /);
  const update = refusal(() => w.updateField('Deal', 'Stgae', { name: 'Phase' }));
  assert.match(update.message, /^Field 'Stgae' not found in table 'Deal'; fields: Stage, /);
});

test('the candidate list stops at eight names (Issue #1564)', () => {
  const w = pipeline();
  for (let i = 0; i < 12; i++) w.addField('Deal', { name: `Note ${i}`, type: 'text' });
  const err = refusal(() => w.createEntity('Deal', { Name: 'x', Nope: 1 }));
  assert.equal(err.message.split('; fields: ')[1].split(', ').length, 8);
});

test('an unknown field type lists every field type, nearest first (Issue #1564)', () => {
  const err = refusal(() => pipeline().addField('Deal', { name: 'Notes', type: 'txt' }));
  assert.equal(err.code, 'invalid');
  assert.match(err.message, /^Unknown field type 'txt'; types: text, /);
  assert.deepEqual(err.message.split('; types: ')[1].split(', ').sort(), [...FIELD_TYPES].sort());
});

test('MCP refusals carry the candidates with every stored name sealed (Issues #1564, #1747)', () => {
  const w = pipeline();
  const res = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_create_entity', arguments: { db: 'Deal', name: 'x', values: { Stag: 'Won' } } } }, { tools: 'all' }).result;
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /^Error: Field 'Stag' not found in table 'Deal'; fields: <weave_data>Stage<\/weave_data>, /);
});
