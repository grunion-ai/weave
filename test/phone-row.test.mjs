import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../public/phone-row.js';
import { Weave } from '../src/engine.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';
import { startServer } from '../src/server.js';

const PR = globalThis.weavePhoneRow;
const FIELDS = [
  { name: 'Name', type: 'text', role: 'name' },
  { name: 'Description', type: 'document' },
  { name: 'Status', type: 'workflow' },
  { name: 'Severity', type: 'select' },
  { name: 'Symptom', type: 'multiselect' },
  { name: 'Card', type: 'view' },
  { name: 'Due', type: 'date' },
];

function issues() {
  const w = new Weave();
  w.createSpace({ name: 'Development' });
  const t = w.createTable({ space: 'Development', name: 'Issue' });
  w.addField(t.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Fixed', category: 'done' }] } });
  w.addField(t.id, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  w.addField(t.id, { name: 'Symptom', type: 'multiselect', config: { options: ['Slow', 'Error'] } });
  w.addField(t.id, { name: 'Due', type: 'date' });
  return w;
}

test('a view nobody set leads with the first workflow field and chips the rest of its columns, long-form types off', () => {
  assert.deepEqual(PR.defaults(FIELDS, ['Name', 'Description', 'Status', 'Severity', 'Symptom', 'Card']),
    { lead: 'Status', chips: ['Severity', 'Symptom'], labels: false, wrap: false });
  assert.deepEqual(PR.defaults(FIELDS.filter((f) => f.type !== 'workflow'), ['Name', 'Severity']).lead, null, 'no workflow, no lead');
  assert.deepEqual(PR.defaults(FIELDS, ['Due', 'Severity']).chips, ['Due', 'Severity'], 'chips follow the desktop column order');
});

test('a saved phone row wins over the defaults, and names the table no longer has drop out', () => {
  const cfg = PR.resolve(FIELDS, ['Severity'], { lead: 'Severity', chips: ['Due', 'Gone', 'Severity', 'Name', 'Due'], wrap: true });
  assert.deepEqual(cfg, { lead: 'Severity', chips: ['Due'], labels: false, wrap: true });
  assert.equal(PR.resolve(FIELDS, [], { lead: 'Gone', chips: [] }).lead, null);
});

test('every field but the name takes one slot: lead, chips in drag order, then off', () => {
  const cfg = { lead: 'Status', chips: ['Symptom', 'Severity'], labels: false, wrap: false };
  assert.deepEqual(PR.rows(FIELDS, cfg).map((r) => `${r.name}:${r.slot}`),
    ['Status:lead', 'Symptom:chips', 'Severity:chips', 'Description:off', 'Card:off', 'Due:off']);
});

test('setting a slot moves the field, one lead at a time, and chips reorder by drag', () => {
  let cfg = { lead: 'Status', chips: ['Severity'], labels: false, wrap: false };
  cfg = PR.setSlot(cfg, 'Severity', 'lead');
  assert.deepEqual([cfg.lead, cfg.chips], ['Severity', []], 'the old lead goes off');
  cfg = PR.setSlot(cfg, 'Status', 'chips');
  cfg = PR.setSlot(cfg, 'Due', 'chips');
  assert.deepEqual(cfg.chips, ['Status', 'Due']);
  cfg = PR.moveChip(cfg, 'Due', 0);
  assert.deepEqual(cfg.chips, ['Due', 'Status']);
  cfg = PR.setSlot(cfg, 'Severity', 'off');
  assert.equal(cfg.lead, null);
  assert.throws(() => PR.setSlot(cfg, 'Due', 'middle'), /lead, chips or off/);
});

test('phoneRow is a view setting: absent until written, merged key by key, null clears it', () => {
  const w = issues();
  assert.equal(w.tableView('Issue/Standard').phoneRow, undefined);
  const v = w.tableView('Issue/Standard', { phoneRow: { chips: ['Symptom', 'Severity'] } });
  assert.deepEqual(v.phoneRow, { lead: 'Status', chips: ['Symptom', 'Severity'] }, 'an unnamed key keeps its default');
  assert.deepEqual(w.tableView('Issue/Standard', { phoneRow: { labels: true } }).phoneRow, { lead: 'Status', chips: ['Symptom', 'Severity'], labels: true });
  assert.deepEqual(w.tableView('Issue/Standard', { phoneRow: { lead: null, wrap: true } }).phoneRow, { lead: null, chips: ['Symptom', 'Severity'], labels: true, wrap: true });
  assert.deepEqual(w.tableView('Issue/Copy', { from: 'Standard' }).phoneRow.chips, ['Symptom', 'Severity'], 'a copied view keeps it');
  w.tableView('Issue/Standard', { show: ['Due'] });
  assert.deepEqual(w.tableView('Issue/Standard').phoneRow.chips, ['Symptom', 'Severity'], 'the desktop columns never move it');
  assert.equal(w.tableView('Issue/Standard', { phoneRow: null }).phoneRow, undefined);
});

test('phoneRow refuses the name field, unknown fields, duplicates and stray keys, and leaves the view as it was', () => {
  const w = issues();
  w.tableView('Issue/Standard', { phoneRow: { chips: ['Severity'] } });
  assert.throws(() => w.tableView('Issue/Standard', { phoneRow: { chips: ['Name'] } }), /line one/);
  assert.throws(() => w.tableView('Issue/Standard', { phoneRow: { lead: 'Nope' } }), /Nope/);
  assert.throws(() => w.tableView('Issue/Standard', { phoneRow: { chips: ['Severity', 'severity'] } }), /once/);
  assert.throws(() => w.tableView('Issue/Standard', { phoneRow: { lead: 'Severity', chips: ['Severity'] } }), /lead or a chip/);
  assert.throws(() => w.tableView('Issue/Standard', { phoneRow: { colour: 'red' } }), /lead, chips, labels, wrap/);
  assert.throws(() => w.tableView('Issue/Standard', { phoneRow: { labels: 'yes' } }), /true or false/);
  assert.throws(() => w.tableView('Issue/Standard', { phoneRow: ['Severity'] }), /lead, chips, labels, wrap/);
  assert.deepEqual(w.tableView('Issue/Standard').phoneRow, { lead: 'Status', chips: ['Severity'] });
});

test('phoneRow follows a renamed field and drops a deleted one', () => {
  const w = issues();
  w.tableView('Issue/Standard', { phoneRow: { chips: ['Severity', 'Due'] } });
  const t = w.findTable('Issue');
  w.updateField(t.id, 'Severity', { name: 'Priority' });
  w.deleteField(t.id, 'Due');
  assert.deepEqual(w.tableView('Issue/Standard').phoneRow.chips, ['Priority']);
});

test('describeSchema carries phoneRow, applySchema round-trips it, export/import keeps it', () => {
  const w = issues();
  w.tableView('Issue/Standard', { phoneRow: { chips: ['Severity'], wrap: true } });
  const doc = w.describeSchema();
  const t = doc.flatMap((s) => s.tables).find((x) => x.name === 'Issue');
  assert.deepEqual(t.views[0].phoneRow, { lead: 'Status', chips: ['Severity'], wrap: true });
  assert.deepEqual(w.applySchema(doc), [], 'an untouched document is a no-op');
  t.views[0].phoneRow = { lead: 'Severity', chips: ['Symptom'] };
  w.applySchema(doc);
  assert.deepEqual(w.tableView('Issue/Standard').phoneRow, { lead: 'Severity', chips: ['Symptom'] }, 'the document replaces it whole');
  delete t.views[0].phoneRow;
  w.applySchema(doc);
  assert.equal(w.tableView('Issue/Standard').phoneRow, undefined, 'a document without it is the default');
  w.tableView('Issue/Standard', { phoneRow: { chips: ['Due'] } });
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  assert.deepEqual(w2.tableView('Issue/Standard').phoneRow.chips, ['Due']);
});

test('MCP, REST and CLI speak phoneRow by name', async () => {
  const w = issues();
  assert.deepEqual(dispatchTool(w, 'weave_table_view', { view: 'Issue/Standard', phoneRow: { chips: ['Severity'] } }).phoneRow.chips, ['Severity']);
  const tool = TOOLS.find((x) => x.name === 'weave_table_view');
  assert.ok(tool.inputSchema.properties.phoneRow, 'the key is in the schema');
  assert.match(tool.description, /phoneRow/);
  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tables/Issue/views/Standard`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneRow: { lead: 'Severity' } }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).phoneRow.lead, 'Severity');
  } finally { server.close(); }
  const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
  const dir = mkdtempSync(join(tmpdir(), 'weave-phone-row-'));
  const data = join(dir, 'ws.db');
  const cli = (...args) => JSON.parse(execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' }));
  try {
    cli('space', 'create', 'Dev');
    cli('table', 'create', 'Dev', 'Task');
    cli('field', 'add', 'Task', 'Size', 'select', '--config', '{"options":["S","M"]}');
    assert.deepEqual(cli('table', 'view', 'Task/Standard', '--phone-row', '{"chips":["Size"],"labels":true}').phoneRow, { lead: null, chips: ['Size'], labels: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
