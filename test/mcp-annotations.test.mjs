import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { handleMcpMessage, TOOLS } from '../src/mcp.js';

const HINTS = ['title', 'readOnlyHint', 'destructiveHint', 'openWorldHint'];
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
const OPEN_WORLD = new Set(['weave_create_automation', 'weave_automations', 'weave_call']);

test('every tool carries a title and all three hints, set explicitly', () => {
  assert.equal(TOOLS.length, 65);
  for (const t of TOOLS) {
    const a = t.annotations;
    assert.ok(a && typeof a === 'object', `${t.name} has no annotations`);
    for (const k of HINTS) assert.ok(Object.hasOwn(a, k), `${t.name} lacks ${k}`);
    assert.deepEqual(Object.keys(a).sort(), [...HINTS].sort(), `${t.name} carries only the four fields`);
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

test('tools/list sends the annotations in both profiles', () => {
  const w = new Weave();
  for (const tools of ['core', 'all']) {
    const listed = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { tools }).result.tools;
    for (const t of listed) assert.deepEqual(Object.keys(t.annotations ?? {}).sort(), [...HINTS].sort(), `${tools}: ${t.name}`);
  }
});
