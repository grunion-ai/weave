import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { TOOLS } from '../src/mcp.js';

test('a new table opens on a view named Standard', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  assert.deepEqual(w.tableView('Task').views.map((v) => v.name), ['Standard']);
  w.updateTable('Task', { filters: {}, sort: [{ field: 'Name', dir: 'desc' }] });
  assert.deepEqual(w.tableView('Task/Standard').sort, [{ field: 'Name', dir: 'desc' }]);
});

test('a workspace saved with "Default" views opens with them named Standard, registry row and all, once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-standard-'));
  const path = join(dir, 'w.db');
  try {
    let w = new Weave({ path });
    w.createSpace({ name: 'Dev' });
    const t = w.createTable({ space: 'Dev', name: 'Task' });
    const other = w.createTable({ space: 'Dev', name: 'Note' });
    for (const db of [t, other]) {
      const first = w.tableView(db.id).views[0];
      w.tableView(`${db.id}/${first.id}`, { name: 'Default' });
      delete w.getTable(db.id).standardViewNamed;
    }
    w.tableView(`${t.id}/Open`, { from: 'Default' });
    w.save();
    w = new Weave({ path });
    assert.deepEqual(w.tableView(t.id).views.map((v) => v.name), ['Standard', 'Open']);
    assert.deepEqual(w.tableView(other.id).views.map((v) => v.name), ['Standard']);
    const rows = w.query('Workspace/Views').items.map((e) => e.name);
    assert.ok(!rows.includes('Default'), `no Views row is still named Default (${rows.join(', ')})`);
    assert.ok(rows.filter((n) => n === 'Standard').length >= 2, 'both first views read Standard on their rows');
    w.tableView(`${t.id}/Default`, { from: 'blank' });
    w.save();
    w = new Weave({ path });
    assert.deepEqual(w.tableView(t.id).views.map((v) => v.name), ['Standard', 'Open', 'Default']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a table whose views already include one named Standard keeps both names apart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-standard-'));
  const path = join(dir, 'w.db');
  try {
    let w = new Weave({ path });
    w.createSpace({ name: 'Dev' });
    const t = w.createTable({ space: 'Dev', name: 'Task' });
    const first = w.tableView(t.id).views[0];
    w.tableView(`${t.id}/${first.id}`, { name: 'Default' });
    w.tableView(`${t.id}/Standard`, { from: 'blank' });
    delete w.getTable(t.id).standardViewNamed;
    w.save();
    w = new Weave({ path });
    assert.deepEqual(w.tableView(t.id).views.map((v) => v.name), ['Default', 'Standard'], 'a clash is left alone, never merged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the agent surface names the first view Standard', () => {
  const tool = TOOLS.find((t) => t.name === 'weave_table_view');
  assert.match(tool.description, /Standard/, 'weave_table_view says what the first view is called');
  assert.doesNotMatch(tool.description, /\bDefault\b/);
});
