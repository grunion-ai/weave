/* Issue #596: an MCP write answers with what the next call needs — id,
   publicId, name, and a field's type and config — not the whole object. Every
   reply stays in an agent's conversation and is re-read on every later turn;
   the 2026-10-02 disclosure eval measured weave_create_entity at 3,352 bytes a
   call and weave_update_table at 5,564, and no agent used more than the id and
   the name. `verbose: true` still returns the full object. Only the MCP door
   changes: dispatchTool, REST and the CLI keep their replies. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { handleMcpMessage, dispatchTool, TOOLS, COMPACT_TOOLS } from '../src/mcp.js';

let rpcId = 0;
function call(w, name, args) {
  const res = handleMcpMessage(w, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } });
  const text = res.result.content[0].text;
  assert.ok(!res.result.isError, `${name}: ${text}`);
  return { text, data: JSON.parse(text) };
}

function fixture() {
  const w = new Weave();
  call(w, 'weave_create_space', { name: 'Ops' });
  call(w, 'weave_create_table', { space: 'Ops', name: 'Project' });
  call(w, 'weave_create_table', { space: 'Ops', name: 'Task' });
  call(w, 'weave_add_field', { db: 'Task', name: 'Status', type: 'workflow', config: { states: [{ name: 'New', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  call(w, 'weave_add_relation', { db: 'Task', name: 'Project', targetDb: 'Project', cardinality: 'many-to-one', inverseName: 'Tasks' });
  call(w, 'weave_create_entity', { db: 'Project', name: 'Apollo' });
  return w;
}

// next and hints are a schema write's guidance (src/field-hints.js), not an echo.
const BRIEF = new Set(['id', 'publicId', 'name', 'type', 'config', 'deletedAt', 'purged', 'next', 'hints']);
const bare = (obj) => Object.keys(obj).filter((k) => k !== 'next' && k !== 'hints').sort();
const assertBrief = (obj, label) => {
  const extra = Object.keys(obj).filter((k) => !BRIEF.has(k));
  assert.deepEqual(extra, [], `${label} carries only the brief keys`);
  assert.ok(obj.id, `${label} has an id`);
  assert.ok(obj.name, `${label} has a name`);
};

test('a row write answers with id, publicId and name', () => {
  const w = fixture();
  const made = call(w, 'weave_create_entity', { db: 'Task', name: 'Ship it', values: { Project: 'Apollo' } }).data;
  assertBrief(made, 'weave_create_entity');
  assert.deepEqual(made, { id: made.id, publicId: 1, name: 'Ship it' });
  const ref = 'Task#1';
  for (const [name, args] of [
    ['weave_update_entity', { entity: ref, values: { Name: 'Ship it now' } }],
    ['weave_set_state', { entity: ref, field: 'Status', state: 'Done' }],
    ['weave_unlink', { entity: ref, field: 'Project', targets: ['Apollo'] }],
    ['weave_link', { entity: ref, field: 'Project', targets: ['Apollo'] }],
    ['weave_restore_entity', { entity: ref }],
  ]) {
    const data = call(w, name, args).data;
    assertBrief(data, name);
    assert.equal(data.id, made.id, `${name} names the row it wrote`);
    assert.equal(data.publicId, 1);
  }
  const gone = call(w, 'weave_delete_entity', { entity: made.id }).data;
  assertBrief(gone, 'weave_delete_entity');
  assert.ok(gone.deletedAt, 'a soft delete says when');
  assert.equal(w.readEntity(made.id).fields.Status, 'Done', 'the writes landed');
  const purged = call(w, 'weave_delete_entity', { entity: made.id, hard: true }).data;
  assert.deepEqual(purged, { id: made.id, purged: true }, 'a hard delete still says it purged');
});

test('a schema write answers with id and name, a field with its type and stored config', () => {
  const w = fixture();
  const space = call(w, 'weave_create_space', { name: 'Sales', description: 'x' }).data;
  assert.deepEqual(bare(space), ['id', 'name']);
  assertBrief(call(w, 'weave_update_space', { space: 'Sales', description: 'y' }).data, 'weave_update_space');
  const table = call(w, 'weave_create_table', { space: 'Sales', name: 'Deal' }).data;
  assert.deepEqual(bare(table), ['id', 'name'], 'no fields map, no views');
  for (const [name, args] of [
    ['weave_update_table', { db: 'Deal', noun: 'deal' }],
    ['weave_duplicate_table', { db: 'Deal' }],
    ['weave_move_table', { db: 'Deal Copy', space: 'Ops' }],
  ]) assertBrief(call(w, name, args).data, name);
  call(w, 'weave_delete_table', { db: 'Deal Copy' });
  assertBrief(call(w, 'weave_restore_table', { db: 'Deal Copy' }).data, 'weave_restore_table');
  call(w, 'weave_delete_space', { space: 'Sales' });
  assertBrief(call(w, 'weave_restore_space', { space: 'Sales' }).data, 'weave_restore_space');

  const field = call(w, 'weave_add_field', { db: 'Deal', name: 'Stage', type: 'select', config: { options: ['Open', 'Won'] } }).data;
  assert.deepEqual(bare(field), ['config', 'id', 'name', 'type']);
  assert.equal(field.type, 'select');
  assert.deepEqual(field.config.options.map((o) => o.name), ['Open', 'Won'], 'the stored config, options resolved');
  const widened = call(w, 'weave_update_field', { db: 'Deal', field: 'Stage', config: { width: 140 } }).data;
  assert.equal(widened.config.width, 140);

  const rel = call(w, 'weave_add_relation', { db: 'Deal', name: 'Owner', targetDb: 'Task', cardinality: 'many-to-one', inverseName: 'Deals' }).data;
  assert.deepEqual(Object.keys(rel).sort(), ['field', 'inverse']);
  assertBrief(rel.field, 'relation field');
  assertBrief(rel.inverse, 'relation inverse');
  assert.equal(rel.field.config.inverseFieldId, rel.inverse.id);
});

test('verbose: true returns the whole object, and never reaches the engine as a value', () => {
  const w = fixture();
  const full = call(w, 'weave_create_entity', { db: 'Task', name: 'A', verbose: true }).data;
  assert.equal(full.fields.Status, 'New');
  assert.ok(full.activity, 'the full read, activity and all');
  const table = call(w, 'weave_create_table', { space: 'Ops', name: 'Note', verbose: true }).data;
  assert.ok(table.fields && table.fieldOrder, 'the whole table');
  const updated = call(w, 'weave_update_entity', { entity: 'Task#1', values: { Name: 'B' }, verbose: true }).data;
  assert.equal(updated.fields.Name, 'B');
  assert.equal(updated.fields.verbose, undefined);
});

test('every compacting tool advertises verbose, and the set is the write tools', () => {
  for (const name of COMPACT_TOOLS) {
    const tool = TOOLS.find((t) => t.name === name);
    assert.ok(tool, `${name} is a tool`);
    assert.equal(tool.inputSchema.properties.verbose?.type, 'boolean', `${name} takes verbose`);
  }
  for (const name of ['weave_create_entity', 'weave_update_entity', 'weave_create_table', 'weave_update_table',
    'weave_create_space', 'weave_update_space', 'weave_add_field', 'weave_update_field', 'weave_add_relation',
    'weave_link', 'weave_unlink', 'weave_set_state']) {
    assert.ok(COMPACT_TOOLS.has(name), `${name} compacts`);
  }
});

test('tool text is one-line JSON', () => {
  const w = fixture();
  const { text } = call(w, 'weave_query', { db: 'Project' });
  assert.ok(!text.includes('\n'), 'no indentation, no newlines');
  assert.equal(JSON.parse(text).total, 1);
});

test('dispatchTool keeps the full object for in-process callers', () => {
  const w = fixture();
  const e = dispatchTool(w, 'weave_create_entity', { db: 'Task', name: 'A' });
  assert.equal(e.fields.Status, 'New');
});

test('a build sequence costs a fraction of the old echo (Issue #596 budget)', () => {
  const w = new Weave();
  let bytes = 0;
  const run = (name, args) => { bytes += Buffer.byteLength(call(w, name, args).text); };
  run('weave_create_space', { name: 'Ops' });
  run('weave_create_table', { space: 'Ops', name: 'Project' });
  run('weave_create_table', { space: 'Ops', name: 'Task' });
  run('weave_add_field', { db: 'Task', name: 'Status', type: 'workflow', config: { states: [{ name: 'New', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  run('weave_add_field', { db: 'Task', name: 'Hours', type: 'number' });
  run('weave_add_field', { db: 'Task', name: 'Priority', type: 'select', config: { options: ['Low', 'High'] } });
  run('weave_add_field', { db: 'Project', name: 'Due', type: 'date' });
  run('weave_add_relation', { db: 'Task', name: 'Project', targetDb: 'Project', cardinality: 'many-to-one', inverseName: 'Tasks' });
  run('weave_create_entity', { db: 'Project', name: 'Apollo', values: { Due: '2026-11-01' } });
  for (let i = 1; i <= 4; i++) run('weave_create_entity', { db: 'Task', name: 'Task ' + i, values: { Hours: i, Priority: 'High', Project: 'Apollo' } });
  // 17,244 bytes before this change (v0.4.54), 1,614 after. The schema
  // writes' next[] and hints[] (Issues #579, #581) add about 620: the
  // settings a type takes and the slips to fix, which the 2026-10-02 eval
  // found reach a model that never asks.
  assert.ok(bytes < 2400, `13 build calls answered in ${bytes} bytes`);
});
