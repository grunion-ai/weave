import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { handleMcpMessage, TOOLS } from '../src/mcp.js';

const HINTS = ['title', 'readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];
const READ_ONLY = new Set([
  'weave_ontology', 'weave_schema', 'weave_query', 'weave_get_entity', 'weave_search', 'weave_stats', 'weave_trash',
  'weave_get_doc', 'weave_doc_revisions', 'weave_check_formula', 'weave_export_csv', 'weave_export_json',
  'weave_vocabulary', 'weave_template_list', 'weave_activity', 'weave_audit', 'weave_relation_map',
]);
const DESTRUCTIVE = new Set([
  'weave_delete_entity', 'weave_delete_comment', 'weave_delete_space', 'weave_delete_table', 'weave_delete_field',
  'weave_bulk', 'weave_undo', 'weave_set_doc', 'weave_doc_restore', 'weave_update_field', 'weave_rollback_field',
  'weave_apply_schema', 'weave_import_json', 'weave_automations', 'weave_accounts', 'weave_keys', 'weave_files',
  'weave_views', 'weave_shares', 'weave_workspace', 'weave_call',
]);
const OPEN_WORLD = new Set(['weave_runs', 'weave_create_automation', 'weave_automations', 'weave_call']);
const NOT_IDEMPOTENT = new Set(['weave_runs',
  'weave_create_entity', 'weave_undo', 'weave_bulk', 'weave_set_doc', 'weave_add_comment', 'weave_create_space',
  'weave_create_table', 'weave_add_field', 'weave_add_relation', 'weave_create_automation', 'weave_import_csv',
  'weave_attach_file', 'weave_template_use', 'weave_duplicate_table', 'weave_build', 'weave_views', 'weave_shares',
  'weave_accounts', 'weave_forms', 'weave_form_submit', 'weave_call',
]);
const hint = (name) => TOOLS.find((t) => t.name === name)?.annotations?.idempotentHint;

test('every tool carries a title and all four hints, set explicitly', () => {
  assert.equal(TOOLS.length, 66);
  for (const t of TOOLS) {
    const a = t.annotations;
    assert.ok(a && typeof a === 'object', `${t.name} has no annotations`);
    for (const k of HINTS) assert.ok(Object.hasOwn(a, k), `${t.name} lacks ${k}`);
    assert.deepEqual(Object.keys(a).sort(), [...HINTS].sort(), `${t.name} carries only the five fields`);
    assert.equal(typeof a.title, 'string');
    assert.ok(a.title.trim().length > 0 && a.title.length <= 40, `${t.name} title "${a.title}"`);
    for (const k of HINTS.slice(1)) assert.equal(typeof a[k], 'boolean', `${t.name}.${k} is a boolean`);
  }
});

test('titles are unique', () => {
  const titles = TOOLS.map((t) => t.annotations?.title);
  assert.equal(new Set(titles).size, titles.length);
});

test('reads are read-only, removals and replacements are destructive, only automations reach outside', () => {
  for (const name of [...READ_ONLY, ...DESTRUCTIVE, ...OPEN_WORLD]) assert.ok(TOOLS.some((t) => t.name === name), `${name} is a tool`);
  for (const t of TOOLS) {
    const a = t.annotations ?? {};
    assert.equal(a.readOnlyHint, READ_ONLY.has(t.name), `${t.name} readOnlyHint`);
    assert.equal(a.destructiveHint, DESTRUCTIVE.has(t.name), `${t.name} destructiveHint`);
    assert.equal(a.openWorldHint, OPEN_WORLD.has(t.name), `${t.name} openWorldHint`);
    if (a.readOnlyHint) assert.equal(a.destructiveHint, false, `${t.name} reads and destroys`);
  }
});

test('a repeat call is idempotent unless it adds, appends, mints or dispatches', () => {
  for (const name of NOT_IDEMPOTENT) assert.ok(TOOLS.some((t) => t.name === name), `${name} is a tool`);
  for (const t of TOOLS) assert.equal(t.annotations?.idempotentHint, !NOT_IDEMPOTENT.has(t.name), `${t.name} idempotentHint`);
  for (const name of READ_ONLY) assert.equal(hint(name), true, `${name} reads, so a repeat changes nothing`);
  assert.equal(hint('weave_query'), true);
  assert.equal(hint('weave_create_entity'), false, 'a second create makes a second row');
  assert.equal(hint('weave_import_csv'), false, 'a second import appends the rows again');
  assert.equal(hint('weave_add_comment'), false, 'a second comment is a second comment');
  assert.equal(hint('weave_set_doc'), false, 'append mode adds the text again');
  assert.equal(hint('weave_undo'), false, 'each call reverts one more step');
  assert.equal(hint('weave_update_entity'), true, 'writing the same values again is a no-op');
  assert.equal(hint('weave_set_state'), true);
  assert.equal(hint('weave_link'), true);
  assert.equal(hint('weave_update_field'), true);
  assert.equal(hint('weave_apply_schema'), true, 'the workspace ends matching the document');
  assert.equal(hint('weave_delete_entity'), true, 'a trashed row stays trashed');
  assert.equal(hint('weave_delete_table'), true);
  assert.equal(hint('weave_import_json'), true, 'the workspace ends as the export');
});

test('repeating an idempotent write leaves the workspace as the first call did, a create adds again', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.addField('Task', { name: 'Estimate', type: 'number' });
  w.addField('Task', { name: 'Stage', type: 'workflow', config: { states: [{ name: 'Todo', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  const call = (name, args) => {
    const res = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    assert.ok(!res.result.isError, `${name}: ${res.result.content?.[0]?.text}`);
  };
  const rows = () => w.query('Task', { includeDeleted: true }).total;
  const events = () => w.activityFeed({ limit: -1 }).total;
  call('weave_create_entity', { db: 'Task', name: 'ship it' });
  call('weave_create_entity', { db: 'Task', name: 'ship it' });
  assert.equal(rows(), 2, 'create is not idempotent');
  const [row] = w.query('Task', {}).items;
  for (const [name, args] of [
    ['weave_update_entity', { entity: row.id, values: { Estimate: 3 } }],
    ['weave_set_state', { entity: row.id, field: 'Stage', state: 'Done' }],
    ['weave_delete_entity', { entity: row.id }],
  ]) {
    call(name, args);
    const seen = events();
    const state = JSON.stringify(w.readEntity(row.id).values);
    call(name, args);
    assert.equal(events(), seen, `${name} repeated records nothing new`);
    assert.equal(JSON.stringify(w.readEntity(row.id).values), state, `${name} repeated changes nothing`);
  }
  assert.equal(rows(), 2);
});

test('tools/list sends the annotations in both profiles', () => {
  const w = new Weave();
  for (const tools of ['core', 'all']) {
    const listed = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { tools }).result.tools;
    for (const t of listed) assert.deepEqual(Object.keys(t.annotations ?? {}).sort(), [...HINTS].sort(), `${tools}: ${t.name}`);
  }
});
