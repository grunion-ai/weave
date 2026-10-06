/* The navigation trail behind entity breadcrumbs (2026-08-23). Kyle went
   People → Ada Chen → (relation link) Sensor board and the crumb showed
   only Showcase › Sensor board. The crumb now carries the path taken:
   ws › Showcase › People › Ada Chen › Field Types › Sensor board. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/breadcrumbs.js');
const { pushTrail, entityCrumbs, dockCrumbs } = globalThis.weaveBreadcrumbs;

const ada = { id: 'a', name: 'Ada Chen', space: 'Showcase', spaceId: 's1', table: 'People', tableId: 't1' };
const board = { id: 'b', name: 'Sensor board', space: 'Showcase', spaceId: 's1', table: 'Field Types', tableId: 't2' };
const leo = { id: 'l', name: 'Leo Marsh', space: 'Showcase', spaceId: 's1', table: 'People', tableId: 't1' };

test('an entity reached from another entity extends the trail; from anywhere else it starts fresh', () => {
  assert.deepEqual(pushTrail([], { page: 'db' }, ada), []);
  assert.deepEqual(pushTrail([], { page: 'entity', entity: ada }, board).map((e) => e.id), ['a']);
  const two = pushTrail([ada], { page: 'entity', entity: board }, leo);
  assert.deepEqual(two.map((e) => e.id), ['a', 'b']);
});

test('going back to an entity already on the trail truncates to it (no loops)', () => {
  const t = pushTrail([ada, board], { page: 'entity', entity: leo }, ada);
  assert.deepEqual(t, []);
  const t2 = pushTrail([ada, board], { page: 'entity', entity: leo }, board);
  assert.deepEqual(t2.map((e) => e.id), ['a']);
});

test('a refresh of the same entity leaves the trail alone', () => {
  assert.deepEqual(pushTrail([ada], { page: 'entity', entity: board }, board).map((e) => e.id), ['a']);
});

test('the trail is capped so the crumb stays a line', () => {
  let trail = [];
  let prev = { page: 'db' };
  for (let i = 0; i < 10; i++) {
    const e = { ...ada, id: `e${i}`, name: `E${i}` };
    trail = pushTrail(trail, prev, e);
    prev = { page: 'entity', entity: e };
  }
  assert.ok(trail.length <= 4);
  assert.equal(trail[trail.length - 1].id, 'e8', 'the most recent hops survive');
});

/* Issues #669 and #673 (Kyle, 2026-10-05): every crumb wears its icon; a
   row crumb is its table's icon, a muted #id and the Name, the current row
   included. The full page keeps workspace › space › table in front; the
   row icons carry later tables, so no table crumb sits mid-trail. */
const adaH = { ...ada, publicId: 7, tableIcon: 'lucide:user', spaceIcon: 'lucide:briefcase' };
const boardH = { ...board, publicId: 3, tableIcon: 'lucide:cpu', spaceIcon: 'lucide:briefcase' };
const leoH = { ...leo, publicId: 9, tableIcon: 'lucide:user', spaceIcon: 'lucide:briefcase' };

test('entityCrumbs: the head and the current row when there is no trail', () => {
  const c = entityCrumbs('weave', [], boardH);
  assert.deepEqual(c.map((x) => [x.kind, x.label]), [['ws', 'weave'], ['space', 'Showcase'], ['table', 'Field Types'], ['row', 'Sensor board']]);
  assert.equal(c[1].icon, 'lucide:briefcase', 'the space crumb wears the space icon');
  assert.equal(c[2].icon, 'lucide:cpu', 'the table crumb wears the table icon');
  const cur = c[3];
  assert.equal(cur.current, true, 'the last crumb is the row you are on');
  assert.equal(cur.publicId, 3);
  assert.equal(cur.icon, 'lucide:cpu', 'the row crumb wears its table icon');
  assert.equal(cur.href, '#/entity/b');
});

test('entityCrumbs: the head is where the path started; rows follow with their own icons', () => {
  const c = entityCrumbs('weave', [adaH], boardH);
  assert.deepEqual(c.map((x) => x.label), ['weave', 'Showcase', 'People', 'Ada Chen', 'Sensor board'], 'no Field Types crumb mid-trail');
  assert.equal(c[3].href, '#/entity/a');
  assert.equal(c[3].current, false);
  assert.equal(c[3].icon, 'lucide:user');
  assert.equal(c[3].title, 'People \u00b7 Ada Chen', 'the tooltip names the table');
  assert.equal(c[4].icon, 'lucide:cpu', 'the hop into Field Types shows in its icon');
  assert.deepEqual(entityCrumbs('weave', [adaH], leoH).map((x) => x.label), ['weave', 'Showcase', 'People', 'Ada Chen', 'Leo Marsh']);
});

test('dockCrumbs: the rows of the path, no table in front, the last one current', () => {
  assert.deepEqual(dockCrumbs([adaH]).map((c) => [c.kind, c.label, c.current]), [['row', 'Ada Chen', true]], 'one docked row: just that row');
  const hop = dockCrumbs([adaH, boardH, leoH]);
  assert.deepEqual(hop.map((c) => c.label), ['Ada Chen', 'Sensor board', 'Leo Marsh']);
  assert.deepEqual(hop.map((c) => c.publicId), [7, 3, 9]);
  assert.deepEqual(hop.map((c) => c.current), [false, false, true]);
  assert.equal(hop[1].icon, 'lucide:cpu', 'the hop into another table is its icon');
  assert.deepEqual(dockCrumbs([]), []);
});

/* Issue #267: the tab title reads the place — the row or table in front of
   the reader, then the workspace — so tabs, history entries and bookmarks
   stop all reading "Weave". The bare workspace page is the workspace name;
   "Weave" is left only where no workspace has loaded. */
test('docTitle: <row or table> · <workspace>, the workspace alone, Weave with neither', () => {
  const { docTitle } = globalThis.weaveBreadcrumbs;
  assert.equal(docTitle('Issue', 'weave'), 'Issue · weave');
  assert.equal(docTitle('Acme Working Capital', 'uno'), 'Acme Working Capital · uno');
  assert.equal(docTitle(null, 'weave'), 'weave');
  // The workspace page: its own name IS the workspace's, and a tab reading
  // "weave \u00b7 weave" says nothing the first word did not.
  assert.equal(docTitle('weave', 'weave'), 'weave');
  assert.equal(docTitle('  ', 'weave'), 'weave');
  assert.equal(docTitle('Deals', ''), 'Deals');
  assert.equal(docTitle(null, ''), 'Weave');
  assert.equal(docTitle(undefined, undefined), 'Weave');
});
