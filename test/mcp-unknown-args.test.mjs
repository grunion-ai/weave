import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { handleMcpMessage, TOOLS } from '../src/mcp.js';
import { FAMILIES } from '../src/commands.js';
import { unwrapData } from './lib/fixtures.mjs';

let rpcId = 0;
const call = (w, name, args) => handleMcpMessage(w, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }).result;
const ok = (res) => {
  assert.ok(!res.isError, res.content[0].text);
  const text = unwrapData(res.content[0].text);
  try { return JSON.parse(text); } catch { return text; }
};
const refused = (res, pattern) => {
  assert.equal(res.isError, true, `refused: ${res.content[0].text}`);
  assert.match(res.content[0].text, pattern);
  assert.equal(res.structuredContent.code, 'invalid', 'an unknown argument is an invalid request, not an internal error');
  assert.equal(res.structuredContent.rpc, -32602);
  return res.content[0].text;
};
const takes = (name) => Object.keys(TOOLS.find((t) => t.name === name).inputSchema.properties).join(', ');

function deals() {
  const w = new Weave();
  ok(call(w, 'weave_build', { workspace: 'sales', spaces: [{ name: 'Sales', tables: [
    { name: 'Company', records: [{ Name: 'Initech' }] },
    { name: 'Person', records: [{ Name: 'Peter' }] },
    { name: 'Deal', fields: [{ name: 'Stage', type: 'select', options: ['Won', 'Lost'] }, { name: 'Value', type: 'number' }],
      records: [{ Name: 'Acme', Stage: 'Won', Value: 3 }, { Name: 'Beta', Stage: 'Won', Value: 1 }, { Name: 'Gamma', Stage: 'Lost', Value: 2 }] },
  ] }] }));
  return w;
}
const names = (res) => ok(res).items.map((r) => r.name);

test('a misspelled where on weave_query is refused, naming the keys weave_query takes (Issue #1559)', () => {
  const w = deals();
  assert.deepEqual(names(call(w, 'weave_query', { db: 'Deal', where: [['Stage', '=', 'Won']] })), ['Acme', 'Beta']);
  const text = refused(call(w, 'weave_query', { db: 'Deal', filter: [['Stage', '=', 'Won']] }), /unknown 'filter'/);
  assert.ok(text.includes(`weave_query takes ${takes('weave_query')}; unknown 'filter'`), text);
  assert.match(text, /\bwhere\b/, 'the refusal names the key that was meant');
});

test('every tool refuses an unknown key with the message shape checkRowArgs uses, before it runs (Issue #1559)', () => {
  const w = deals();
  const before = JSON.stringify(w.exportJSON());
  for (const t of TOOLS) {
    const family = FAMILIES.get(t.name);
    const action = family?.commands.find((c) => !c.toolRefusal);
    const args = {
      ...(action ? { [action.actionArg ?? 'action']: action.action } : {}),
      ...(t.name === 'weave_forms' ? { action: 'list' } : {}),
      ...(t.name === 'weave_update_entity' ? { values: {} } : {}),
      ...(t.name === 'weave_call' ? { name: 'weave_schema' } : {}),
      zzz: 1,
    };
    const text = refused(call(w, t.name, args), /unknown 'zzz'/);
    const props = takes(t.name);
    assert.ok(text.startsWith(`Error: ${t.name} takes ${props || 'no arguments'}; unknown 'zzz'`), `${t.name}: ${text}`);
  }
  assert.equal(JSON.stringify(w.exportJSON()), before, 'no refused call wrote anything');
});

test('the build grammar carried into a single verb is refused, not half applied (Issue #1559)', () => {
  const w = deals();
  refused(call(w, 'weave_create_space', { name: 'Ops', tables: [{ name: 'Task' }] }), /weave_create_space takes .*; unknown 'tables'/);
  refused(call(w, 'weave_create_table', { space: 'Sales', name: 'Lead', fields: [{ name: 'Score', type: 'number' }] }), /unknown 'fields'/);
  assert.ok(!w.findTable('Lead'), 'no table was made without the fields it was sent with');
  refused(call(w, 'weave_search', { text: 'Acme' }), /weave_search takes query, limit; unknown 'text'/);
  refused(call(w, 'weave_stats', { table: 'Deal', groupBy: 'Stage' }), /unknown 'groupBy'/);
});

test('weave_call refuses an unknown key of its own, and the tool it calls refuses its own (Issue #1559)', () => {
  const w = deals();
  refused(call(w, 'weave_call', { name: 'weave_stats', arguments: { table: 'Deal' } }), /weave_call takes name, args; unknown 'arguments'/);
  refused(call(w, 'weave_call', { name: 'weave_stats', args: { table: 'Deal', groupBy: 'Stage' } }), /weave_stats takes .*; unknown 'groupBy'/);
  assert.equal(ok(call(w, 'weave_call', { name: 'weave_stats', args: { table: 'Deal', by: 'Stage' } })).rows, 3);
});

test('weave_add_relation takes the build spelling: to names the table, a list of tables makes a target set (Issue #1568)', () => {
  const w = deals();
  const made = ok(call(w, 'weave_add_relation', { db: 'Deal', name: 'Owner', to: 'Company' }));
  assert.equal(made.field.name, 'Owner');
  assert.equal(made.inverse.name, 'Deal');
  assert.equal(w.findField(w.findTable('Deal'), 'Owner').config.targetDb, w.findTable('Company').id);
  ok(call(w, 'weave_add_relation', { db: 'Deal', name: 'Lead', type: 'relation', to: 'Person', cardinality: 'many-to-one' }));
  assert.equal(w.findField(w.findTable('Deal'), 'Lead').config.targetDb, w.findTable('Person').id);
  ok(call(w, 'weave_add_relation', { db: 'Deal', name: 'About', to: ['Company', 'Person'] }));
  assert.deepEqual(w.findField(w.findTable('Deal'), 'About').config.targetDbs, [w.findTable('Company').id, w.findTable('Person').id]);
  refused(call(w, 'weave_add_relation', { db: 'Deal', name: 'Twice', to: 'Company', targetDb: 'Person' }), /weave_add_relation takes .*targetDb.*; unknown 'to'/);
  refused(call(w, 'weave_add_relation', { db: 'Deal', name: 'Typed', type: 'select', to: 'Company' }), /unknown 'type'/);
  assert.ok(!w.findField(w.findTable('Deal'), 'Twice'));
});

test('weave_add_field and weave_update_field take the build\'s flat config keys (Issue #1568)', () => {
  const w = deals();
  const price = ok(call(w, 'weave_add_field', { db: 'Deal', name: 'Price', type: 'number', format: 'currency', currency: 'USD', width: 140 }));
  assert.deepEqual([price.config.format, price.config.currency, price.config.width], ['currency', 'USD', 140]);
  const tier = ok(call(w, 'weave_add_field', { db: 'Deal', name: 'Tier', type: 'select', options: ['Gold', 'Silver'], description: 'How big the account is' }));
  assert.deepEqual(tier.config.options.map((o) => o.name ?? o), ['Gold', 'Silver']);
  assert.equal(w.findField(w.findTable('Deal'), 'Tier').config.description, 'How big the account is');
  const share = ok(call(w, 'weave_update_field', { db: 'Deal', field: 'Price', format: 'percent' }));
  assert.equal(share.config.format, 'percent');
  const wins = ok(call(w, 'weave_add_field', { db: 'Deal', name: 'Cost', type: 'number', format: 'percent', config: { format: 'currency' } }));
  assert.equal(wins.config.format, 'currency', 'config named outright wins over the same key sent flat');
  const note = ok(call(w, 'weave_add_field', { db: 'Deal', name: 'Note', type: 'text', currency: 'USD' }));
  assert.ok(note.hints.some((h) => /Ignored currency/.test(h)), 'a config key the type does not take is named in hints, as it is inside config');
  refused(call(w, 'weave_add_field', { db: 'Deal', name: 'Fee', type: 'number', formt: 'currency' }), /weave_add_field takes db, name, type, config, verbose; unknown 'formt'/);
  assert.ok(!w.findField(w.findTable('Deal'), 'Fee'));
  ok(call(w, 'weave_add_field', { db: 'Deal', name: 'Client', type: 'text' }));
  const [acme, beta] = ok(call(w, 'weave_query', { db: 'Deal', sort: 'Name' })).items;
  ok(call(w, 'weave_update_entity', { entity: acme.id, values: { Client: 'Initech' } }));
  ok(call(w, 'weave_update_entity', { entity: beta.id, values: { Client: 'Hooli' } }));
  ok(call(w, 'weave_update_field', { db: 'Deal', field: 'Client', type: 'relation', to: 'Company', createMissing: true }));
  assert.equal(w.findField(w.findTable('Deal'), 'Client').config.targetDb, w.findTable('Company').id, 'a text field becomes a relation from the build spelling too');
  assert.deepEqual(names(call(w, 'weave_query', { db: 'Company', sort: 'Name' })), ['Hooli', 'Initech']);
});

test('weave_query takes a sort in the build\'s spelling: "Field desc", a list of them, "-Field" or one {field, dir} (Issue #1568)', () => {
  const w = deals();
  const want = ['Acme', 'Gamma', 'Beta'];
  for (const sort of ['Value desc', ['Value desc'], '-Value', { field: 'Value', dir: 'desc' }, [{ field: 'Value', dir: 'desc' }]]) {
    assert.deepEqual(names(call(w, 'weave_query', { db: 'Deal', sort })), want, JSON.stringify(sort));
  }
  assert.deepEqual(names(call(w, 'weave_query', { db: 'Deal', sort: 'Stage desc, Value asc' })), names(call(w, 'weave_query', { db: 'Deal', sort: [{ field: 'Stage', dir: 'desc' }, { field: 'Value', dir: 'asc' }] })));
  assert.deepEqual(names(call(w, 'weave_query', { db: 'Deal', sort: ['Name'] })), ['Acme', 'Beta', 'Gamma']);
});

test('weave_build still takes a bare spec, and refuses a stray key beside it or beside an explicit spec (Issue #1559)', () => {
  const w = new Weave();
  const bare = ok(call(w, 'weave_build', { workspace: 'ops', spaces: [{ name: 'Ops', tables: [{ name: 'Task' }] }], dryRun: true }));
  assert.equal(bare.ok, true);
  assert.equal(bare.dryRun, true);
  refused(call(w, 'weave_build', { spaces: [{ name: 'Ops', tables: [{ name: 'Task' }] }], dryrun: true }), /weave_build takes spec, dryRun, skipExistingRows; unknown 'dryrun'/);
  refused(call(w, 'weave_build', { spec: { spaces: [{ name: 'Ops' }] }, spaces: [{ name: 'Extra' }] }), /weave_build takes spec, dryRun, skipExistingRows; unknown 'spaces'/);
  assert.deepEqual(w.listSpaces().map((s) => s.name).filter((n) => ['Ops', 'Extra'].includes(n)), [], 'a misspelled dryRun wrote nothing');
  const nested = ok(call(w, 'weave_build', { spaces: [{ name: 'Ops', tables: [{ name: 'Task', colour: 'red' }] }] }));
  assert.deepEqual(nested.ignored, [{ path: 'spaces[0].tables[0]', keys: ['colour'] }], 'inside the spec the build keeps its own ignored report');
});
