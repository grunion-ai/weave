/* The navigation trail behind entity breadcrumbs (2026-08-23). Kyle went
   People → Ada Chen → (relation link) Sensor board and the crumb showed
   only Showcase › Sensor board. The crumb now carries the path taken:
   ws › Showcase › People › Ada Chen › Field Types › Sensor board. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/breadcrumbs.js');
const { pushTrail, entityCrumbs } = globalThis.weaveBreadcrumbs;

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

test('entityCrumbs: structural path when there is no trail', () => {
  const c = entityCrumbs('weave', [], board).map((x) => x.label);
  assert.deepEqual(c, ['weave', 'Showcase', 'Field Types']);
});

test('entityCrumbs: the path taken, with space/table only where they change', () => {
  const c = entityCrumbs('weave', [ada], board);
  assert.deepEqual(c.map((x) => x.label), ['weave', 'Showcase', 'People', 'Ada Chen', 'Field Types']);
  assert.equal(c[3].href, '#/entity/a');
  assert.equal(c[4].href, '#/table/t2');
  // Same table twice in a row: no repeated table crumb.
  const same = entityCrumbs('weave', [ada], leo).map((x) => x.label);
  assert.deepEqual(same, ['weave', 'Showcase', 'People', 'Ada Chen']);
});
