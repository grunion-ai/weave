import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';
import { seedIssues, fieldsOf } from './lib/view-pane-fixture.mjs';
await import('../public/list-core.js');
await import('../public/view-pane-core.js');
const VP = globalThis.weaveViewPane;
const LC = globalThis.weaveListCore;

function fresh() {
  const w = new Weave();
  const { issue } = seedIssues(w);
  return { w, issue, fields: fieldsOf(w, issue.id) };
}

function tree(w, issue, fields, group, { deleted = false } = {}) {
  const view = w.tableView(`${issue.id}/Standard`, { group, deleted });
  const q = w.query(issue.id, { relations: 'chip', includeDeleted: deleted, groupBy: view.id });
  const items = q.items.map((it) => ({ ...it, deleted: !!it.deletedAt }));
  const levels = VP.levelsFor(view.group, fields, { items });
  return { levels, m: VP.model(VP.rowsFor(items, levels), { levels }) };
}

test('nested group headers name their parent path, top level names none (Feature #348)', () => {
  const { w, issue, fields } = fresh();
  const { m } = tree(w, issue, fields, ['Severity', 'Area', 'Status']);
  const deep = m.nodes.find((n) => n.level === 2 && n.path[0].label === 'High' && n.path[1].label === 'Nav');
  assert.deepEqual(VP.crumbs(deep), ['High', 'Nav']);
  assert.equal(VP.crumbText(deep), 'High › Nav ›');
  const top = m.nodes.find((n) => n.level === 0);
  assert.deepEqual(VP.crumbs(top), []);
  assert.equal(VP.crumbText(top), '');
});

test('a five-level path with a multi-select level and No value reads every ancestor', () => {
  const { w, issue, fields } = fresh();
  const { m } = tree(w, issue, fields, ['Area', 'Severity', 'Status', 'Symptom', 'Fixed in']);
  const leaf = m.leaves.find((n) => n.path[3].label === 'Looks broken' && n.label === VP.NO_VALUE);
  assert.ok(leaf, 'a leaf under a multi-select value with an empty Fixed in');
  assert.equal(VP.crumbs(leaf).length, 4);
  assert.equal(VP.crumbs(leaf)[3], 'Looks broken');
  assert.ok(!VP.crumbText(leaf).includes('undefined'));
});

test('the breakdown field is the first select or workflow field not grouped at or above the header', () => {
  const { w, issue, fields } = fresh();
  const first = tree(w, issue, fields, ['Area', 'Status']).levels;
  assert.equal(VP.breakdownField(fields, first, 0).name, 'Status', 'Area alone grouped: Status comes first in field order');
  assert.equal(VP.breakdownField(fields, first, 1).name, 'Severity', 'Status grouped at this level: the next one');
  const sym = tree(w, issue, fields, ['Status', 'Severity', 'Area']).levels;
  assert.equal(VP.breakdownField(fields, sym, 2), null, 'every single-select and workflow field is grouped: no breakdown');
  assert.equal(VP.breakdownField(fields, sym, 0).name, 'Severity', 'a deeper group field does not count against a shallower header');
});

test('the breakdown counts live rows in option order and skips empty values', () => {
  const { w, issue, fields } = fresh();
  const { levels, m } = tree(w, issue, fields, ['Area'], { deleted: true });
  const nav = m.nodes.find((n) => n.label === 'Nav');
  const f = VP.breakdownField(fields, levels, 0);
  assert.equal(f.name, 'Status');
  assert.equal(VP.breakdown(nav.rows, f), 'Open 1, Fixed 1', 'the deleted Nav rows do not count');
  const editor = m.nodes.find((n) => n.label === 'Editor');
  assert.equal(VP.breakdown(editor.rows, fields.find((x) => x.name === 'Severity')), 'Low 1, Medium 3');
  assert.equal(VP.breakdown([], f), '');
  assert.equal(VP.breakdown(nav.rows, null), '');
});

test('the grouping signature is the group fields with their orders, in level order', () => {
  assert.equal(LC.groupSig([{ field: 'a', order: 'option' }, { field: 'b', order: 'az', dir: 'desc' }]), LC.groupSig([{ field: 'a', order: 'option', dir: 'asc' }, { field: 'b', order: 'az', dir: 'desc' }]));
  assert.notEqual(LC.groupSig([{ field: 'a' }]), LC.groupSig([{ field: 'a', dir: 'desc' }]));
  assert.notEqual(LC.groupSig([{ field: 'a' }, { field: 'b' }]), LC.groupSig([{ field: 'b' }, { field: 'a' }]));
  assert.notEqual(LC.groupSig([{ field: 'a', order: 'option' }]), LC.groupSig([{ field: 'a', order: 'az' }]));
  assert.equal(LC.groupSig([]), '');
  assert.equal(LC.groupSig(null), '');
  assert.equal(VP.nextCollapsed([{ field: 'Area' }], [{ field: 'Area' }], ['Nav'])[0], 'Nav');
  assert.deepEqual(VP.nextCollapsed([{ field: 'Area' }], [{ field: 'Area', dir: 'desc' }], ['Nav']), ['Nav'], 'a new direction keeps the folds (Issue #1914)');
});

test('folded groups belong to the view that folded them (Issue #1909, ruled per view 2026-11-27)', () => {
  const { w, issue } = fresh();
  w.tableView(`${issue.id}/Standard`, { group: ['Severity', 'Area'] });
  w.tableView(`${issue.id}/Standard`, { collapsed: ['High', 'Low › Nav'] });
  const triage = w.tableView(`${issue.id}/Triage`, { group: ['Severity', 'Area'] });
  assert.equal(triage.collapsed, undefined, 'grouping another view the same way opens it expanded');
  w.tableView(`${issue.id}/Triage`, { collapsed: ['Medium'] });
  assert.deepEqual(w.tableView(`${issue.id}/Standard`).collapsed, ['High', 'Low › Nav'], 'a fold in one view leaves the other alone');
  w.tableView(`${issue.id}/Standard`, { collapsed: null });
  assert.deepEqual(w.tableView(`${issue.id}/Triage`).collapsed, ['Medium'], 'and so does expanding every group');
});

test('a group edit keeps every fold whose path still names the same levels (Issue #1914)', () => {
  const { w, issue } = fresh();
  w.tableView(`${issue.id}/Standard`, { group: ['Severity', 'Area'], collapsed: ['High', 'Low › Nav'] });
  assert.deepEqual(w.tableView(`${issue.id}/Standard`, { group: [{ field: 'Severity', dir: 'desc' }, 'Area'] }).collapsed, ['High', 'Low › Nav'], 'a new direction keeps every fold');
  assert.deepEqual(w.tableView(`${issue.id}/Standard`, { group: [{ field: 'Severity', dir: 'desc' }, 'Status'] }).collapsed, ['High'], 'a new second level keeps the first-level folds');
  assert.deepEqual(w.tableView(`${issue.id}/Standard`, { group: [{ field: 'Severity', dir: 'desc' }, 'Status', 'Area'] }).collapsed, ['High'], 'a level added below keeps them too');
  assert.equal(w.tableView(`${issue.id}/Standard`, { group: ['Area', 'Severity'] }).collapsed, undefined, 'a new first level leaves no fold that still names its group');
  w.tableView(`${issue.id}/Desc`, { group: [{ field: 'Severity', dir: 'desc' }, 'Area'], collapsed: ['Low'] });
  assert.equal(w.tableView(`${issue.id}/Standard`, { group: [{ field: 'Severity', dir: 'desc' }, 'Area'] }).collapsed, undefined, 'regrouping like another view adopts none of its folds');
});

test('a copied view starts with its source folds and then keeps its own (Issue #1909)', () => {
  const { w, issue } = fresh();
  w.tableView(`${issue.id}/Standard`, { group: ['Severity'], collapsed: ['High'] });
  assert.deepEqual(w.tableView(`${issue.id}/Copy`, { from: 'Standard' }).collapsed, ['High']);
  dispatchTool(w, 'weave_table_view', { view: 'Issue/Copy', collapsed: ['Low'] });
  assert.deepEqual(w.tableView(`${issue.id}/Standard`).collapsed, ['High']);
  assert.deepEqual(w.tableView(`${issue.id}/Copy`).collapsed, ['Low']);
});

test('each view keeps its own folds through export and import', () => {
  const { w, issue } = fresh();
  w.tableView(`${issue.id}/Standard`, { group: ['Severity', 'Area'], collapsed: ['High'] });
  w.tableView(`${issue.id}/Board`, { layout: 'board', group: ['Severity', 'Area'], collapsed: ['Medium'] });
  const w2 = new Weave();
  w2.importJSON(w.exportJSON({ blobs: false }));
  assert.deepEqual(w2.tableView(`${issue.id}/Board`).collapsed, ['Medium']);
  w2.tableView(`${issue.id}/Board`, { collapsed: ['Low'] });
  assert.deepEqual(w2.tableView(`${issue.id}/Standard`).collapsed, ['High']);
});
