import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { handleMcpMessage } from '../src/mcp.js';
import { toolCommand } from '../src/commands.js';
import { unwrapData } from './lib/fixtures.mjs';

function deals() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  w.createTable({ space: 'Sales', name: 'Deal' });
  w.addField('Deal', { name: 'Amount', type: 'number' });
  w.addField('Deal', { name: 'Twice', type: 'formula', config: { expression: 'Amount * 2' } });
  return w;
}

test('weave_update_field answers the formulas a rename rewrote, as its Activity entry records them (Issue #1622)', () => {
  const w = deals();
  const out = toolCommand('weave_update_field').run(w, { db: 'Deal', field: 'Amount', name: 'Total' });
  assert.deepEqual(out.rewritten, [{ field: 'Twice', before: 'Amount * 2', after: 'Total * 2' }]);
  const reply = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_update_field', arguments: { db: 'Deal', field: 'Total', name: 'Sum', verbose: true } } }).result;
  assert.notEqual(reply.isError, true, reply.content[0].text);
  assert.deepEqual(JSON.parse(unwrapData(reply.content[0].text)).rewritten, [{ field: 'Twice', before: 'Total * 2', after: 'Sum * 2' }]);
  const plain = toolCommand('weave_update_field').run(w, { db: 'Deal', field: 'Sum', config: { width: 120 } });
  assert.equal(plain.rewritten, undefined, 'a change that rewrites no formula answers no rewritten list');
});
