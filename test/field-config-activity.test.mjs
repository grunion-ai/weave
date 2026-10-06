import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

function workspace(opts = {}) {
  const w = new Weave(opts);
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  w.addField(t, { name: 'Priority', type: 'select', config: { options: [
    { id: 'low', name: 'Low', hue: 'green' },
    { id: 'high', name: 'High', hue: 'red' },
  ] } });
  return { w, t };
}

const configEntries = (w, kinds = ['field-config-updated', 'undo']) =>
  w.activityFeed({ kinds }).items.filter((a) => a.detail?.fieldId).reverse();

test('a config change records one field-config-updated entry with before, after and seq', () => {
  const { w, t } = workspace();
  const row = w.createEntity(t, { name: 'first' });
  const rowSeq = w.activityFeed({ entityId: row.id }).items[0].seq;
  const f = w.getField(t.id, 'Priority');
  w.updateField(t.id, f.id, { config: { options: [
    { id: 'low', name: 'Low', hue: 'blue' },
    { id: 'high', name: 'High', hue: 'red' },
    { id: 'urgent', name: 'Urgent', hue: 'orange' },
  ] } });
  const items = configEntries(w);
  assert.equal(items.length, 1, 'one entry for one save');
  const [a] = items;
  assert.equal(a.kind, 'field-config-updated');
  assert.equal(a.detail.table, 'Ops/Ticket');
  assert.equal(a.detail.field, 'Priority');
  assert.equal(a.detail.fieldId, f.id);
  assert.equal(a.dbId, t.id, 'the entry belongs to the table');
  assert.equal(a.entityId, t.id, 'its address is the table');
  assert.equal(a.entityName, 'Priority', 'the Name column names the field');
  assert.deepEqual(a.detail.changed, ['options']);
  assert.equal(a.detail.before.config.options.length, 2);
  assert.equal(a.detail.before.config.options[0].hue, 'green', 'the colour before is kept');
  assert.equal(a.detail.after.config.options.length, 3);
  assert.equal(typeof a.seq, 'number');
  assert.ok(a.seq > rowSeq, 'one counter orders it against entity activity');
  assert.equal(w.getActivity(a.id).detail.fieldId, f.id);
  assert.equal(w.activityFeed({ tableRef: t.id }).items.filter((x) => x.kind === 'field-config-updated').length, 1);
  assert.equal(w.activityFeed({ entityId: t.id }).items.length, 1, 'a table id narrows to its config history');
});

test('a no-op and a width-only patch record nothing', () => {
  const { w, t } = workspace();
  const f = w.getField(t.id, 'Priority');
  w.updateField(t.id, f.id, { config: { options: structuredClone(f.config.options) } });
  w.updateField(t.id, f.id, { config: { width: 240 } });
  w.updateField(t.id, f.id, { config: { width: null } });
  assert.equal(configEntries(w).length, 0);
});

test('a rename and a description are part of the definition', () => {
  const { w, t } = workspace();
  const f = w.getField(t.id, 'Priority');
  w.updateField(t.id, f.id, { name: 'Urgency', config: { description: 'How soon' } });
  const [a] = configEntries(w);
  assert.deepEqual([...a.detail.changed].sort(), ['description', 'name']);
  assert.equal(a.detail.before.name, 'Priority');
  assert.equal(a.detail.after.name, 'Urgency');
  w.rollbackFieldConfig(a.id);
  assert.equal(w.getField(t.id, f.id).name, 'Priority');
  assert.equal(w.getField(t.id, f.id).config.description, undefined, 'a key the before did not have is cleared');
});

test('roll back applies before through the same path and records an undo entry', () => {
  const { w, t } = workspace();
  const f = w.getField(t.id, 'Priority');
  const before = structuredClone(f.config);
  w.updateField(t.id, f.id, { config: { options: [{ id: 'low', name: 'Low', hue: 'blue' }], default: 'low' } });
  const [a] = configEntries(w);
  const out = w.rollbackFieldConfig(a.id);
  assert.equal(out.field.id, f.id);
  assert.deepEqual(w.getField(t.id, f.id).config.options, before.options, 'options and colours come back');
  assert.equal(w.getField(t.id, f.id).config.default, undefined, 'the default the change added goes');
  const undo = w.getActivity(out.activity);
  assert.equal(undo.kind, 'undo');
  assert.equal(undo.detail.of, a.id, 'the undo names the entry it reversed');
  assert.equal(undo.detail.fieldId, f.id);
  assert.ok(undo.seq > a.seq);
  assert.equal(w.getActivity(a.id).rollback.ok, false);
  assert.equal(w.getActivity(out.activity).rollback.ok, true);
  w.rollbackFieldConfig(out.activity);
  assert.equal(w.getField(t.id, f.id).config.default, 'low', 'rolling back the undo re-applies the change');
});

test('a stale roll back refuses and leaves the field as it is', () => {
  const { w, t } = workspace();
  const f = w.getField(t.id, 'Priority');
  w.updateField(t.id, f.id, { config: { options: [{ id: 'low', name: 'Low' }] } });
  const [first] = configEntries(w);
  w.updateField(t.id, f.id, { config: { options: [{ id: 'low', name: 'Low' }, { id: 'mid', name: 'Mid' }] } });
  const now = structuredClone(w.getField(t.id, f.id).config);
  assert.equal(w.getActivity(first.id).rollback.ok, false);
  assert.match(w.getActivity(first.id).rollback.reason, /changed again/);
  assert.throws(() => w.rollbackFieldConfig(first.id), (err) => err.code === 'conflict' && /changed again/.test(err.message));
  assert.deepEqual(w.getField(t.id, f.id).config, now, 'nothing applied');
  assert.equal(configEntries(w, ['undo']).length, 0, 'and nothing recorded');
});

test('a definition changed by a path that records nothing still counts as changed since', () => {
  const { w, t } = workspace();
  const f = w.getField(t.id, 'Priority');
  w.updateField(t.id, f.id, { config: { options: [{ id: 'low', name: 'Low' }] } });
  const [a] = configEntries(w);
  f.config.options.push({ id: 'x', name: 'X', hue: 'slate', icon: '', color: '' });
  assert.throws(() => w.rollbackFieldConfig(a.id), (err) => err.code === 'conflict' && /changed since/.test(err.message));
});

test('a type change is recorded as lossy and, since Issue #467, rolls back with its values', () => {
  const { w, t } = workspace();
  const row = w.createEntity(t, { name: 'hot', values: { Priority: 'High' } });
  const f = w.getField(t.id, 'Priority');
  w.updateField(t.id, f.id, { type: 'text' });
  const [a] = configEntries(w);
  assert.equal(a.detail.lossy, true);
  assert.ok(a.detail.changed.includes('type'));
  assert.equal(w.getActivity(a.id).rollback.ok, true);
  w.rollbackFieldConfig(a.id);
  assert.equal(w.getField(t.id, f.id).type, 'select');
  assert.equal(w.readEntity(row.id).fields.Priority, 'High');
});

test('removing an option and rolling it back brings the stored values back', () => {
  const { w, t } = workspace();
  const row = w.createEntity(t, { name: 'hot', values: { Priority: 'High' } });
  const f = w.getField(t.id, 'Priority');
  w.updateField(t.id, f.id, { config: { options: [{ id: 'low', name: 'Low', hue: 'green' }] } });
  assert.notEqual(w.readEntity(row.id).fields.Priority, 'High', 'the value has no option to show');
  const [a] = configEntries(w);
  w.rollbackFieldConfig(a.id);
  assert.equal(w.readEntity(row.id).fields.Priority, 'High', 'the value kept its option id, so it reads again');
});

test('formula, workflow and number costume edits roll back', () => {
  const { w, t } = workspace();
  w.addField(t, { name: 'Qty', type: 'number' });
  w.addField(t, { name: 'Twice', type: 'formula', config: { expression: 'Qty * 2' } });
  w.addField(t, { name: 'Stage', type: 'workflow' });
  const qty = w.getField(t.id, 'Qty');
  const twice = w.getField(t.id, 'Twice');
  const stage = w.getField(t.id, 'Stage');
  const was = { qty: structuredClone(qty.config), twice: structuredClone(twice.config), stage: structuredClone(stage.config) };
  w.updateField(t.id, qty.id, { config: { format: 'currency', unit: 'EUR', decimals: 2 } });
  w.updateField(t.id, twice.id, { config: { expression: 'Qty * 3' } });
  w.updateField(t.id, stage.id, { config: { states: [{ name: 'Open', category: 'not-started' }, { name: 'Done', category: 'done' }] } });
  const entries = configEntries(w);
  assert.equal(entries.length, 3);
  for (const a of entries) w.rollbackFieldConfig(a.id);
  assert.deepEqual(w.getField(t.id, qty.id).config, was.qty);
  assert.deepEqual(w.getField(t.id, twice.id).config, was.twice);
  assert.deepEqual(w.getField(t.id, stage.id).config, was.stage);
});

test('the registry door records the same entry', () => {
  const { w, t } = workspace();
  const fieldsT = w.findTable('Workspace/Fields');
  const f = w.getField(t.id, 'Priority');
  const row = w.listEntities(fieldsT.id).find((e) => e.sysId === f.id);
  w.updateEntity(row.id, { Definition: { type: 'select', config: { options: [{ id: 'low', name: 'Low' }] } } });
  const items = configEntries(w);
  assert.equal(items.length, 1);
  assert.equal(items[0].detail.fieldId, f.id);
});

test('applying a schema records the fields it changes, not the ones a new table mints', () => {
  const { w } = workspace();
  const doc = w.describeSchema();
  const ops = doc.find((sp) => sp.space === 'Ops');
  const pf = ops.tables.find((x) => x.name === 'Ticket').fields.find((f) => f.name === 'Priority');
  pf.options = pf.options.slice(0, 1);
  ops.tables.push({ name: 'Fresh', fields: [{ name: 'Title', role: 'name', type: 'text' }, { name: 'Notes', role: 'description', type: 'document' }] });
  w.applySchema(doc, {});
  assert.ok(w.findTable('Ops/Fresh'), 'the new table landed');
  const items = configEntries(w);
  assert.deepEqual(items.map((a) => `${a.detail.table}.${a.detail.field}`), ['Ops/Ticket.Priority']);
});

test('a system table records nothing', () => {
  const { w } = workspace();
  const fieldsT = w.findTable('Workspace/Fields');
  w.updateField(fieldsT.id, fieldsT.nameFieldId, { config: { description: 'the field' } });
  assert.equal(configEntries(w).length, 0);
});

test('the entries survive a reopen and are not in the table blob', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wv-428-'));
  try {
    const data = join(dir, 'w.db');
    const { w, t } = workspace({ path: data });
    const f = w.getField(t.id, 'Priority');
    w.updateField(t.id, f.id, { config: { options: [{ id: 'low', name: 'Low' }] } });
    assert.equal(w.state.tables[t.id].activity, undefined, 'the table object carries no history');
    const again = new Weave({ path: data });
    const [a] = configEntries(again);
    assert.equal(a.detail.fieldId, f.id);
    again.rollbackFieldConfig(a.id);
    assert.equal(again.getField(t.id, f.id).config.options.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the HTTP door: PATCH names the entry, rollback needs the schema rung', async () => {
  const { w, t } = workspace();
  const writer = w.createAccount({ name: 'writer-bot', role: 'writer' }).token;
  const admin = w.createAccount({ name: 'admin-bot', role: 'admin' }).token;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, body, token) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const f = w.getField(t.id, 'Priority');
    const res = await call('PATCH', `/api/tables/${t.id}/fields/${f.id}`, { config: { options: [{ id: 'low', name: 'Low' }] } }, admin);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, f.id, 'still the field');
    assert.ok(body.activity, 'and the entry it recorded');
    assert.equal(body.lossy, false);
    const widthOnly = await (await call('PATCH', `/api/tables/${t.id}/fields/${f.id}`, { config: { width: 200 } }, admin)).json();
    assert.equal(widthOnly.activity, null, 'a width records nothing, so there is nothing to undo');
    const denied = await call('POST', `/api/tables/${t.id}/fields/${f.id}/rollback`, { activity: body.activity }, writer);
    assert.equal(denied.status, 403, 'a writer cannot roll back what a writer cannot change');
    const ok = await call('POST', `/api/tables/${t.id}/fields/${f.id}/rollback`, { activity: body.activity, via: 'undo' }, admin);
    assert.equal(ok.status, 200);
    const out = await ok.json();
    assert.equal(out.field.config.options.length, 2);
    assert.ok(out.activity);
    const stale = await call('POST', `/api/tables/${t.id}/fields/${f.id}/rollback`, { activity: body.activity }, admin);
    assert.equal(stale.status, 409, 'a stale roll back is a conflict');
    const wrongField = await call('POST', `/api/tables/${t.id}/fields/Name/rollback`, { activity: out.activity }, admin);
    assert.equal(wrongField.status, 400, 'the entry must belong to the field in the path');
    const one = await (await call('GET', `/api/activity/${encodeURIComponent(out.activity)}`, undefined, admin)).json();
    assert.equal(one.kind, 'undo');
    assert.equal(one.detail.via, 'undo');
    assert.equal(one.rollback.ok, true);
  } finally { server.close(); }
});

test('MCP and CLI reach the same verb', () => {
  const { w, t } = workspace();
  const f = w.getField(t.id, 'Priority');
  w.updateField(t.id, f.id, { config: { options: [{ id: 'low', name: 'Low' }] } });
  const [a] = configEntries(w);
  const out = dispatchTool(w, 'weave_rollback_field', { db: 'Ops/Ticket', field: 'Priority', activity: a.id });
  assert.equal(out.field.config.options.length, 2);

  const dir = mkdtempSync(join(tmpdir(), 'wv-428-cli-'));
  try {
    const data = join(dir, 'w.db');
    const { w: fw, t: ft } = workspace({ path: data });
    const ff = fw.getField(ft.id, 'Priority');
    fw.updateField(ft.id, ff.id, { config: { options: [{ id: 'low', name: 'Low' }] } });
    const [entry] = configEntries(fw);
    const cli = (...args) => JSON.parse(execFileSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const res = cli('field', 'rollback', 'Ops/Ticket', 'Priority', '--activity', entry.id);
    assert.equal(res.field.config.options.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
