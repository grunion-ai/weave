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

test('the trail is uncapped: every hop stays, oldest first', () => {
  let trail = [];
  let prev = { page: 'db' };
  for (let i = 0; i < 10; i++) {
    const e = { ...ada, id: `e${i}`, name: `E${i}` };
    trail = pushTrail(trail, prev, e);
    prev = { page: 'entity', entity: e };
  }
  assert.deepEqual(trail.map((e) => e.id), ['e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8']);
  assert.equal(globalThis.weaveBreadcrumbs.MAX_TRAIL, undefined, 'no cap left to apply');
  const cut = pushTrail(trail, { page: 'entity', entity: { ...ada, id: 'e9' } }, { ...ada, id: 'e2' });
  assert.deepEqual(cut.map((e) => e.id), ['e0', 'e1']);
});

test('foldPlan: nothing folds when the trail fits', () => {
  const { foldPlan } = globalThis.weaveBreadcrumbs;
  assert.deepEqual(foldPlan([100, 100, 100], 300), []);
  assert.deepEqual(foldPlan([100, 100, 100, 100, 100], 600, { more: 40 }), []);
});

test('foldPlan: the middle folds in order until the rest and the button fit', () => {
  const { foldPlan } = globalThis.weaveBreadcrumbs;
  assert.deepEqual(foldPlan([100, 100, 100, 100, 100, 100], 400, { more: 40 }), [1, 2, 3]);
  assert.deepEqual(foldPlan([100, 100, 100, 100, 100, 100], 560, { more: 40 }), [1]);
});

test('foldPlan: the first crumb and the last two never fold, whatever the box', () => {
  const { foldPlan } = globalThis.weaveBreadcrumbs;
  for (const n of [3, 4, 6, 12]) {
    const plan = foldPlan(Array(n).fill(150), 50, { more: 40 });
    assert.ok(!plan.includes(0), `n=${n}: the first crumb stays`);
    assert.ok(!plan.includes(n - 1) && !plan.includes(n - 2), `n=${n}: the last two stay`);
    assert.equal(plan.length, Math.max(0, n - 3), `n=${n}: everything else folds`);
  }
  assert.deepEqual(foldPlan([100, 300], 200), [], 'two crumbs: nothing can fold; the current crumb ellipsizes');
});

test('foldPlan: `from` keeps a head on screen (the full page keeps workspace › space › table and the first row)', () => {
  const { foldPlan } = globalThis.weaveBreadcrumbs;
  const plan = foldPlan([60, 80, 70, 120, 120, 120, 120, 200], 600, { from: 4, more: 40 });
  assert.deepEqual(plan, [4, 5]);
  assert.deepEqual(foldPlan([60, 80, 70, 120, 120, 200], 100, { from: 4, more: 40 }), [], 'from at the tail: nothing left to fold');
});

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

test('docTitle: <row or table> · <workspace>, the workspace alone, Weave with neither', () => {
  const { docTitle } = globalThis.weaveBreadcrumbs;
  assert.equal(docTitle('Issue', 'weave'), 'Issue · weave');
  assert.equal(docTitle('Acme Working Capital', 'uno'), 'Acme Working Capital · uno');
  assert.equal(docTitle(null, 'weave'), 'weave');
  assert.equal(docTitle('weave', 'weave'), 'weave');
  assert.equal(docTitle('  ', 'weave'), 'weave');
  assert.equal(docTitle('Deals', ''), 'Deals');
  assert.equal(docTitle(null, ''), 'Weave');
  assert.equal(docTitle(undefined, undefined), 'Weave');
});

const N = () => globalThis.weaveBreadcrumbs;
const h = (id) => ({ id, name: id.toUpperCase(), tableId: 't1', table: 'People' });
const ids = (hops) => hops.map((x) => x.id);

test('nav: a fresh open starts the history; a hop extends it; reopening the current row keeps it', () => {
  const { navOpen, navHop, navPath, navCurrent } = N();
  let nav = navOpen(undefined, h('a'));
  assert.deepEqual(ids(navPath(nav)), ['a']);
  nav = navHop(nav, h('b'));
  nav = navHop(nav, h('c'));
  assert.deepEqual(ids(navPath(nav)), ['a', 'b', 'c']);
  assert.equal(navCurrent(nav).id, 'c');
  assert.equal(navOpen(nav, h('c')), nav, 'expand and collapse reopen the current row: the path survives the pose flip');
  assert.equal(navHop(nav, h('c')), nav, 'a hop to the row you are on changes nothing');
  assert.deepEqual(ids(navPath(navOpen(nav, h('z')))), ['z'], 'opening another row afresh starts over');
});

test('nav: the crumb cuts back on a revisit; Back and Forward replay the clicks', () => {
  const { navOpen, navHop, navBack, navForward, navPath, navCanBack, navCanForward } = N();
  let nav = navOpen(undefined, h('i583'));
  nav = navHop(nav, h('r54'));
  nav = navHop(nav, h('i589'));
  nav = navHop(nav, h('r54'));
  assert.deepEqual(ids(navPath(nav)), ['i583', 'r54'], 'crumb after click 3: #583 › v0.4.55');
  assert.ok(!navCanForward(nav));
  nav = navBack(nav);
  assert.deepEqual(ids(navPath(nav)), ['i583', 'r54', 'i589'], 'Back returns to #589, the row you came from');
  assert.ok(navCanForward(nav));
  nav = navForward(nav);
  assert.deepEqual(ids(navPath(nav)), ['i583', 'r54'], 'Forward returns to v0.4.55');
  nav = navBack(navBack(navBack(nav)));
  assert.deepEqual(ids(navPath(nav)), ['i583']);
  assert.ok(!navCanBack(nav), 'nothing before the first click');
  assert.equal(navBack(nav), nav);
  nav = navHop(navForward(nav), h('x'));
  assert.ok(!navCanForward(nav), 'a new hop after Back discards the forward stack');
  assert.deepEqual(ids(navPath(nav)), ['i583', 'r54', 'x']);
});

test('nav: navUpdate fills a hop in wherever it sits (a name learnt after the fetch, a rename)', () => {
  const { navOpen, navHop, navUpdate, navPath } = N();
  let nav = navHop(navOpen(undefined, { id: 'a' }), { id: 'b' });
  nav = navUpdate(nav, { id: 'a', name: 'Ada', publicId: 7 });
  assert.deepEqual(navPath(nav).map((x) => [x.id, x.name, x.publicId]), [['a', 'Ada', 7], ['b', undefined, undefined]]);
});
