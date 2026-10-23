import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';
import { unwrapData } from './lib/fixtures.mjs';

let rpcId = 0;
function call(w, name, args) {
  const res = handleMcpMessage(w, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }, { tools: 'all' });
  const text = unwrapData(res.result.content[0].text);
  return { isError: !!res.result.isError, text, data: res.result.isError ? null : JSON.parse(text) };
}

function fixture() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  w.createTable({ space: 'Sales', name: 'Deal' });
  w.addField('Deal', { name: 'Amount', type: 'number' });
  w.createEntity('Deal', { Name: 'Acme', Amount: 5 });
  return w;
}

const amounts = (w) => Object.fromEntries(w.query('Deal', {}).items.map((e) => [w.readEntity(e.id).name, w.readEntity(e.id).fields.Amount]));

test('weave_check_formula previews a valid expression and reports a broken one without writing', () => {
  const w = fixture();
  const ok = call(w, 'weave_check_formula', { db: 'Deal', expression: 'Amount * 2' });
  assert.equal(ok.isError, false, ok.text);
  assert.deepEqual(ok.data, { ok: true, preview: 10, previewEntity: 'Acme', type: 'number' });
  const broken = call(w, 'weave_check_formula', { db: 'Deal', expression: 'Amount *' });
  assert.equal(broken.isError, false, 'a broken expression is an answer, not a tool error');
  assert.equal(broken.data.ok, false);
  assert.match(broken.data.error, /end of formula/);
  assert.equal(Object.values(w.getTable('Deal').fields).some((f) => f.type === 'formula'), false, 'checking adds no field');
  const nowhere = call(w, 'weave_check_formula', { db: 'Nope', expression: '1' });
  assert.equal(nowhere.isError, true);
  assert.match(nowhere.text, /Table 'Nope' not found/);
});

test('weave_import_csv adds one row per CSV line; an unknown table is an error and imports nothing', () => {
  const w = fixture();
  const ok = call(w, 'weave_import_csv', { db: 'Deal', csv: 'Name,Amount\nBeta,7\nGamma,9\n' });
  assert.equal(ok.isError, false, ok.text);
  assert.deepEqual(ok.data, { created: 2, errors: [] });
  assert.deepEqual(amounts(w), { Acme: 5, Beta: 7, Gamma: 9 });
  const nowhere = call(w, 'weave_import_csv', { db: 'Nope', csv: 'Name\nDelta\n' });
  assert.equal(nowhere.isError, true);
  assert.match(nowhere.text, /Table 'Nope' not found/);
  assert.equal(w.query('Deal', {}).total, 3);
});

test('weave_restore_field brings a trashed field back with its values; a field not in the trash is an error', () => {
  const w = fixture();
  w.deleteField('Deal', 'Amount');
  assert.equal(Object.values(w.getTable('Deal').fields).some((f) => f.name === 'Amount' && !f.deletedAt), false);
  const ok = call(w, 'weave_restore_field', { db: 'Deal', field: 'Amount' });
  assert.equal(ok.isError, false, ok.text);
  assert.equal(ok.data.name, 'Amount');
  assert.equal(ok.data.type, 'number');
  assert.deepEqual(amounts(w), { Acme: 5 }, 'the values come back with the field');
  const live = call(w, 'weave_restore_field', { db: 'Deal', field: 'Amount' });
  assert.equal(live.isError, true);
  assert.match(live.text, /Field 'Amount' not found in the trash of 'Deal'/);
});
