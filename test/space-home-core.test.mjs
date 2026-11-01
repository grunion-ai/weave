import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/space-home-core.js');
const H = globalThis.WeaveSpaceHome;

const payload = (over = {}) => ({
  space: { id: 's1', name: 'Sales', icon: null, description: 'Pipeline' },
  tables: [
    { id: 't1', name: 'Deal', icon: null, rowCount: 48, views: [{ id: 'v1', name: 'Pipeline', layout: 'board' }, { id: 'v2', name: 'Closing', layout: 'list' }] },
    { id: 't2', name: 'Contact', icon: null, rowCount: 0, views: [] },
  ],
  runs: [],
  ...over,
});
const row = (id, dbId, over = {}) => ({ kind: 'entity', id, name: id, db: 'Sales/Deal', dbId, publicId: 1, url: `/e/${id}`, at: 5, ...over });
const view = (id, tableId, over = {}) => ({ kind: 'table-view', id, name: id, tableId, table: 'Deal', layout: 'grid', url: `#/table/${tableId}/view/${id}`, at: 7, ...over });

test('homeSections keeps recents from this space\'s tables and splits views from rows', () => {
  const out = H.homeSections(payload(), [
    view('v1', 't1'),
    row('r1', 't1'),
    view('v9', 'other'),
    row('r9', 'other', { db: 'Ops/Task' }),
    { kind: 'table', id: 't1', name: 'Sales/Deal', url: '#/table/t1' },
  ]);
  assert.deepEqual(out.views.map((v) => v.id), ['v1']);
  assert.deepEqual(out.rows.map((r) => r.id), ['r1']);
  assert.deepEqual(out.tables.map((t) => t.id), ['t1', 't2']);
});

test('homeSections leaves every empty section out', () => {
  const none = H.homeSections({ space: { id: 's', name: 'S', icon: null, description: '' }, tables: [], runs: [] }, []);
  assert.deepEqual(none, {});
  const onlyTables = H.homeSections(payload({ space: { id: 's', name: 'S', icon: null, description: '' } }), []);
  assert.deepEqual(Object.keys(onlyTables), ['tables', 'overview']);
});

test('homeSections holds the description in the overview, even with no tables', () => {
  const out = H.homeSections({ space: { id: 's', name: 'S', icon: null, description: 'Words' }, tables: [], runs: [] }, []);
  assert.deepEqual(out, { overview: { description: 'Words' } });
});

test('homeSections passes the runs through in the order the server gave', () => {
  const runs = [{ workflowId: 'w2', outcome: 'attention' }, { workflowId: 'w1', outcome: 'success' }];
  assert.deepEqual(H.homeSections(payload({ runs }), []).runs, runs);
});

test('an older row recent with no dbId matches by its qualified name', () => {
  const old = { kind: 'entity', id: 'r1', name: 'Old', db: 'Sales/Deal', publicId: 3, url: '/e/r1' };
  const other = { kind: 'entity', id: 'r2', name: 'Other', db: 'Ops/Deal', publicId: 4, url: '/e/r2' };
  assert.deepEqual(H.homeSections(payload(), [old, other]).rows.map((r) => r.id), ['r1']);
});

test('a recent view that was deleted drops out, and a renamed one reads its current name and layout', () => {
  const out = H.homeSections(payload(), [view('v2', 't1', { name: 'Old name' }), view('gone', 't1')]);
  assert.deepEqual(out.views.map((v) => [v.id, v.name, v.layout]), [['v2', 'Closing', 'list']]);
});

test('homeSections survives a garbled recent list', () => {
  assert.deepEqual(H.homeSections(payload(), null).views, undefined);
  assert.deepEqual(H.homeSections(payload(), [null, 7, {}]).rows, undefined);
});

test('filterRuns picks by outcome, and all keeps everything', () => {
  const runs = [{ outcome: 'attention' }, { outcome: 'success' }];
  assert.deepEqual(H.filterRuns(runs, 'all'), runs);
  assert.deepEqual(H.filterRuns(runs, 'attention'), [runs[0]]);
  assert.deepEqual(H.filterRuns(runs, 'success'), [runs[1]]);
});

test('runSubject reads origin to here, and the changed count', () => {
  assert.equal(H.runSubject({ originSpace: 'Ops', changedCount: 1 }, 'Sales'), 'Ops → Sales · 1 row changed');
  assert.equal(H.runSubject({ originSpace: 'Sales', changedCount: 2 }, 'Sales'), 'Sales · 2 rows changed');
  assert.equal(H.runSubject({ originSpace: 'Sales', changedCount: 0 }, 'Sales'), 'Sales · no rows changed');
});

test('runResult names the failed step, the reason alone when the step is not recorded, or success', () => {
  assert.equal(H.runResult({ outcome: 'success', failedStep: null }), 'Succeeded');
  assert.equal(H.runResult({ outcome: 'attention', failedStep: { step: 2, error: 'boom' } }), 'Step 2 failed: boom');
  assert.equal(H.runResult({ outcome: 'attention', failedStep: { step: null, error: 'POST x: HTTP 500' } }), 'Failed: POST x: HTTP 500');
});

test('viewRecent notes a saved view the reader asked for, never the table\'s default or a blank', () => {
  const table = { id: 't1', name: 'Deal', qualified: 'Sales/Deal', views: [{ id: 'v0', name: 'All' }, { id: 'v1', name: 'Pipeline', layout: 'board' }] };
  assert.deepEqual(H.viewRecent(table, 'v1'), { kind: 'table-view', id: 'v1', name: 'Pipeline', tableId: 't1', table: 'Deal', layout: 'board', url: '#/table/t1/view/v1' });
  assert.equal(H.viewRecent(table, 'v0'), null, 'the first view is the table itself');
  assert.equal(H.viewRecent(table, undefined), null);
  assert.equal(H.viewRecent(table, 'blank'), null);
  assert.equal(H.viewRecent(table, 'gone'), null);
});
