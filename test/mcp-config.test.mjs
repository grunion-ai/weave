/* The configuration tools, exercised. Presence is test/agent-surface.test.mjs's
   job; this is whether the tools actually do the thing an agent asks for —
   the same writes the web UI makes over REST, with no browser in the loop. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';

const call = (w, name, args) => dispatchTool(w, name, args ?? {});

function workspace() {
  const w = new Weave();
  call(w, 'weave_create_space', { name: 'Ops', description: 'how work runs' });
  call(w, 'weave_create_table', { space: 'Ops', name: 'Invoice' });
  call(w, 'weave_add_field', { db: 'Invoice', name: 'Stage', type: 'select', config: { options: ['Draft', 'Sent'], width: 200 } });
  return w;
}

test('a table takes its whole costume from one tool call', () => {
  const w = workspace();
  call(w, 'weave_update_table', {
    db: 'Invoice', icon: 'iconly:wallet', noun: 'invoice',
    hiddenFields: ['Description'], systemFields: ['Created At'],
    fieldOrder: ['Stage', 'Name', 'Description'],
  });
  const t = call(w, 'weave_schema').find((s) => s.space === 'Ops').tables[0];
  assert.equal(t.icon, 'iconly:wallet');
  assert.equal(t.noun, 'invoice');
  assert.deepEqual(t.hiddenFields, ['Description']);
  assert.deepEqual(t.systemFields, ['Created At']);
  assert.deepEqual(t.fields.map((f) => f.name), ['Stage', 'Name', 'Description']);
});

test('a field is renamed, recolored, widened and dropped without a browser', () => {
  const w = workspace();
  call(w, 'weave_update_field', {
    db: 'Invoice', field: 'Stage', name: 'Phase',
    config: { options: [{ name: 'Draft', color: '#f59f00' }, { name: 'Sent', color: '#2ea043' }], width: 260 },
  });
  const field = () => call(w, 'weave_schema').find((s) => s.space === 'Ops').tables[0].fields.find((f) => f.name === 'Phase');
  assert.equal(field().optionsFull[0].color, '#f59f00');
  assert.equal(field().width, 260);
  call(w, 'weave_delete_field', { db: 'Invoice', field: 'Phase' });
  assert.equal(field(), undefined);
});

test('a space is renamed and re-iconed, and deleting it takes its tables', () => {
  const w = workspace();
  call(w, 'weave_update_space', { space: 'Ops', name: 'Operations', icon: 'iconly:work' });
  let sp = call(w, 'weave_schema').find((s) => s.space === 'Operations');
  assert.equal(sp.icon, 'iconly:work');
  call(w, 'weave_delete_space', { space: 'Operations' });
  assert.equal(call(w, 'weave_schema').some((s) => s.space === 'Operations'), false);
});

test('a schema document applies through the tool, dry run first', () => {
  const w = workspace();
  const doc = call(w, 'weave_schema');
  doc.find((s) => s.space === 'Ops').tables[0].description = 'one bill';
  const dry = call(w, 'weave_apply_schema', { document: doc, dryRun: true });
  assert.deepEqual(dry.plan, [{ action: 'update-table', subject: 'Ops/Invoice' }]);
  assert.equal(call(w, 'weave_schema').find((s) => s.space === 'Ops').tables[0].description, '');
  call(w, 'weave_apply_schema', { document: doc });
  assert.equal(call(w, 'weave_schema').find((s) => s.space === 'Ops').tables[0].description, 'one bill');
});

test('views are created, read, shared and dropped', () => {
  const w = workspace();
  const v = call(w, 'weave_views', { action: 'create', name: 'Billing', blocks: [{ table: 'Invoice', view: 'board' }] });
  assert.equal(call(w, 'weave_views', { action: 'list' }).views.length, 1);
  const shared = call(w, 'weave_views', { action: 'share', view: v.id });
  assert.ok(shared.shareToken ?? shared.token ?? shared.url, 'sharing mints a capability');
  assert.equal(call(w, 'weave_views', { action: 'get', view: v.id }).name, 'Billing');
  call(w, 'weave_views', { action: 'unshare', view: v.id });
  call(w, 'weave_views', { action: 'delete', view: v.id });
  assert.equal(call(w, 'weave_views', { action: 'list' }).views.length, 0);
});

test('an automation can be read back, changed and removed', () => {
  const w = workspace();
  const made = call(w, 'weave_create_automation', {
    db: 'Invoice', name: 'stamp', trigger: { type: 'entity-created' },
    actions: [{ type: 'add-comment', text: 'filed {{Today}}' }],
  });
  assert.equal(call(w, 'weave_automations', { action: 'list', db: 'Invoice' }).automations.length, 1);
  assert.match(JSON.stringify(call(w, 'weave_automations', { action: 'describe', db: 'Invoice' })), /stamp/);
  call(w, 'weave_automations', { action: 'update', automation: made.id, patch: { enabled: false } });
  assert.equal(call(w, 'weave_automations', { action: 'list' }).automations[0].enabled, false);
  call(w, 'weave_automations', { action: 'delete', automation: made.id });
  assert.equal(call(w, 'weave_automations', { action: 'list' }).automations.length, 0);
});

test('the feed, the audit log and the map are readable', () => {
  const w = workspace();
  call(w, 'weave_create_entity', { db: 'Invoice', name: 'INV-1' });
  const feed = call(w, 'weave_activity', { table: 'Invoice' });
  assert.ok(feed.items.length > 0, 'the feed carries the create');
  assert.equal(call(w, 'weave_activity', { id: feed.items[0].id }).kind, feed.items[0].kind, 'and one event reads in full');
  assert.ok(call(w, 'weave_audit', { limit: 5 }).events.length > 0);
  assert.match(call(w, 'weave_relation_map').mermaid, /Invoice/);
  const registry = call(w, 'weave_registry');
  assert.deepEqual(registry.problems, [], 'the registry mirrors the structures with no drift');
  assert.ok(registry.rows > 0, 'and says how many rows it checked');
});

test('the workspace record, accounts and keys are agent business', () => {
  const w = workspace();
  call(w, 'weave_workspace', { action: 'update', name: 'ops-hub', description: 'the hub' });
  assert.equal(call(w, 'weave_workspace', { action: 'get' }).name, 'ops-hub');
  const account = call(w, 'weave_accounts', { action: 'create', name: 'reader-bot', role: 'reader' });
  assert.ok(account.token, 'a created account hands back its token once');
  assert.equal(call(w, 'weave_accounts', { action: 'list' }).accounts.length, 1);
  call(w, 'weave_accounts', { action: 'delete', account: account.id ?? 'reader-bot' });
  call(w, 'weave_keys', { action: 'set', name: 'stripe', value: 'sk_test_x' });
  const keys = call(w, 'weave_keys', { action: 'list' }).keys;
  assert.equal(JSON.stringify(keys).includes('sk_test_x'), false, 'a secret never leaves the process');
  call(w, 'weave_keys', { action: 'delete', name: 'stripe' });
});

test('the vocabulary is a tool, so the agent never guesses a color or an icon', () => {
  const v = call(workspace(), 'weave_vocabulary');
  assert.ok(v.fieldTypes.length >= 18);
  assert.ok(v.icons.names.includes('discovery'));
  assert.equal(v.icons.form, 'iconly:<name>', 'the value form, not just the name');
  assert.ok(v.optionColors.some((c) => c.name === 'green'));
  assert.equal(v.columnWidth.min, 60);
});

test('a file attached to an entity is readable and removable', () => {
  const w = workspace();
  const e = call(w, 'weave_create_entity', { db: 'Invoice', name: 'INV-2' });
  const file = call(w, 'weave_attach_file', { entity: e.id, name: 'note.txt', mime: 'text/plain', contentBase64: Buffer.from('hello').toString('base64') });
  const read = call(w, 'weave_files', { action: 'read', file: file.id });
  assert.equal(Buffer.from(read.contentBase64, 'base64').toString(), 'hello');
  call(w, 'weave_files', { action: 'delete', entity: e.id, file: file.id });
});

test('the workspace exports and re-imports as JSON', () => {
  const w = workspace();
  const dump = call(w, 'weave_export_json');
  const fresh = new Weave();
  call(fresh, 'weave_import_json', { state: dump });
  assert.equal(call(fresh, 'weave_schema').find((s) => s.space === 'Ops').tables[0].name, 'Invoice');
});

test('a comment can be taken back', () => {
  const w = workspace();
  const e = call(w, 'weave_create_entity', { db: 'Invoice', name: 'INV-3' });
  const c = call(w, 'weave_add_comment', { entity: e.id, text: 'wrong thread' });
  call(w, 'weave_delete_comment', { entity: e.id, comment: c.id ?? call(w, 'weave_get_entity', { entity: e.id }).comments[0].id });
  assert.deepEqual(call(w, 'weave_get_entity', { entity: e.id }).comments, []);
});
