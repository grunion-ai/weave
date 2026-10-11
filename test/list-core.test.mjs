import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/list-core.js');
const core = globalThis.weaveListCore;

const k = (key, label = key) => [{ key, label }];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const row = (id, trip, prio, extra = {}) => ({ id, keys: [trip ? k(trip, cap(trip)) : [], prio ? k(prio) : []], parent: null, done: false, ...extra });
const levels = () => [
  { order: 'table', domain: [{ key: 'japan', label: 'Japan' }, { key: 'peru', label: 'Peru' }], nullLabel: 'No Trip' },
  { order: 'option', domain: [{ key: 'P1', label: 'P1' }, { key: 'P2', label: 'P2' }, { key: 'P3', label: 'P3' }], nullLabel: 'No Priority' },
];
const labels = (groups) => groups.map((g) => g.label);
const ids = (items) => items.map((i) => i.row.id);

test('a level takes defaults by field type and refuses what the type cannot do', () => {
  assert.deepEqual(core.levelDefaults('relation'), { heading: 'label', order: 'table' });
  assert.deepEqual(core.levelDefaults('date'), { heading: 'label', order: 'option', grain: 'month' });
  assert.deepEqual(core.normalizeLevel({ name: 'Trip', type: 'relation' }, { heading: 'chip' }), { heading: 'chip', order: 'table' });
  assert.throws(() => core.normalizeLevel({ name: 'Priority', type: 'select' }, { heading: 'chip' }), /Only a link field/);
  assert.throws(() => core.normalizeLevel({ name: 'Priority', type: 'select' }, { order: 'table' }), /only a link field/);
  assert.throws(() => core.normalizeLevel({ name: 'Trip', type: 'relation' }, { order: 'option' }), /table or az/);
  assert.throws(() => core.normalizeLevel({ name: 'Due', type: 'date' }, { grain: 'hour' }), /day, week, month or year/);
  assert.throws(() => core.normalizeLevel({ name: 'Notes', type: 'text' }), /cannot group/);
  assert.deepEqual(core.compactLevel('relation', { heading: 'chip', order: 'table' }), { heading: 'chip' }, 'defaults drop out of a read');
  assert.deepEqual(core.parseGroup('Trip › Priority'), [{ field: 'Trip' }, { field: 'Priority' }]);
  assert.deepEqual(core.parseGroup(['Trip', { field: 'Due', grain: 'week' }]), [{ field: 'Trip' }, { field: 'Due', grain: 'week' }]);
  assert.throws(() => core.parseGroup(['A', 'B', 'C', 'D']), /at most 3/);
});

test('dates group by grain: the key sorts, the label reads, the value is the first day', () => {
  assert.deepEqual(core.dateBucket('2026-10-07', 'day'), { key: '2026-10-07', label: 'Oct 7, 2026', value: '2026-10-07' });
  assert.deepEqual(core.dateBucket('2026-10-07', 'week'), { key: '2026-10-05', label: 'Week of Oct 5, 2026', value: '2026-10-05' });
  assert.deepEqual(core.dateBucket('2026-10-07T09:00:00Z', 'month'), { key: '2026-10', label: 'October 2026', value: '2026-10-01' });
  assert.deepEqual(core.dateBucket('2026-10-07', 'year'), { key: '2026', label: '2026', value: '2026-01-01' });
  assert.equal(core.dateBucket(null), null);
});

test('levels nest groups in their order; the empty group sits last; A to Z reorders by label', () => {
  const rows = [row('a', 'peru', 'P2'), row('b', 'japan', 'P3'), row('c', null, 'P1'), row('d', 'japan', 'P1')];
  const out = core.arrange(rows, { levels: levels() });
  assert.deepEqual(labels(out.groups), ['Japan', 'Peru', 'No Trip']);
  assert.deepEqual(labels(out.groups[0].groups), ['P1', 'P3']);
  assert.equal(out.groups[0].groups[0].key, 'Japan › P1', 'the key is the path of labels, the form collapsed stores');
  assert.equal(out.groups[0].count, 2);
  const az = core.arrange(rows, { levels: [{ ...levels()[0], order: 'az', domain: [{ key: 'peru', label: 'Peru' }, { key: 'japan', label: 'Japan' }] }] });
  assert.deepEqual(labels(az.groups), ['Japan', 'Peru', 'No Trip']);
});

test('empty groups show from the domain only when asked, at every level', () => {
  const rows = [row('a', 'japan', 'P1')];
  assert.deepEqual(labels(core.arrange(rows, { levels: levels() }).groups), ['Japan']);
  const all = core.arrange(rows, { levels: levels(), showEmpty: true });
  assert.deepEqual(labels(all.groups), ['Japan', 'Peru']);
  assert.deepEqual(labels(all.groups[1].groups), ['P1', 'P2', 'P3']);
  assert.equal(all.groups[1].count, 0);
});

test('checked rows leave their group for Completed; with no completedBy a tick is just a field', () => {
  const rows = [row('a', 'japan', 'P1', { done: true }), row('b', 'japan', 'P1')];
  const out = core.arrange(rows, { levels: levels(), completedBy: true });
  assert.deepEqual(ids(out.groups[0].groups[0].items), ['b']);
  assert.deepEqual(ids(out.completed.items), ['a']);
  assert.equal(out.completed.key, 'Completed');
  assert.equal(out.done, 1);
  assert.equal(out.shown, 2);
  const plain = core.arrange(rows, { levels: levels() });
  assert.deepEqual(ids(plain.groups[0].groups[0].items), ['a', 'b']);
  assert.equal(plain.completed, undefined);
});

test('nest puts a child under its parent inside one group; a ghost parent shows and does not count', () => {
  const rows = [
    row('p', 'japan', 'P1', { ghost: true }),
    row('c1', 'japan', 'P1', { parent: 'p' }),
    row('c2', 'japan', 'P1', { parent: 'c1' }),
    row('x', 'japan', 'P2', { parent: 'p' }),
  ];
  const out = core.arrange(rows, { levels: levels(), nest: true });
  const p1 = out.groups[0].groups[0];
  assert.deepEqual(ids(p1.items), ['p']);
  assert.deepEqual(ids(p1.items[0].children), ['c1']);
  assert.equal(p1.items[0].children[0].children[0].depth, 2);
  assert.equal(p1.count, 2, 'the dimmed parent is not counted');
  assert.deepEqual(ids(out.groups[0].groups[1].items), ['x'], 'a child whose parent is in another group is a root of its own group');
  assert.equal(out.shown, 3);
  const loop = core.nestItems([{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }], true);
  assert.equal(loop.length, 1, 'a cycle still draws every row once');
});

test('the manual order wins with no sort; rows it never saw keep their incoming order after it', () => {
  const rows = [row('a'), row('b'), row('c'), row('d')];
  assert.deepEqual(ids(core.arrange(rows, { manual: ['c', 'a'] }).items), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids(core.arrange(rows, { manual: null }).items), ['a', 'b', 'c', 'd'], 'a sort hands in the order');
  assert.deepEqual(core.moveInOrder(['a', 'b', 'c'], 'a', 'c', true), ['b', 'c', 'a']);
  assert.deepEqual(core.moveInOrder(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
});

test('a multi-valued level puts the row in each of its groups', () => {
  const rows = [{ id: 'a', keys: [[{ key: 'x', label: 'X' }, { key: 'y', label: 'Y' }]], parent: null }];
  const out = core.arrange(rows, { levels: [{ order: 'az' }] });
  assert.deepEqual(labels(out.groups), ['X', 'Y']);
  assert.equal(out.shown, 1);
});

test('collapsed: Completed folds by default; a toggle writes the whole list', () => {
  assert.equal(core.isCollapsed(undefined, 'Completed'), true);
  assert.equal(core.isCollapsed(undefined, 'Japan'), false);
  assert.deepEqual(core.toggleCollapsed(undefined, 'Japan'), ['Completed', 'Japan']);
  assert.deepEqual(core.toggleCollapsed(undefined, 'Completed'), []);
  assert.equal(core.isCollapsed([], 'Completed'), false);
});

test('locate finds siblings and parent; changedLevels names every level a drag changes', () => {
  const items = core.nestItems([{ id: 'a' }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'a' }, { id: 'd' }], true);
  const hit = core.locate(items, 'c');
  assert.equal(hit.index, 1);
  assert.equal(hit.parent.row.id, 'a');
  assert.equal(core.locate(items, 'd').parent, null);
  assert.deepEqual(core.changedLevels([{ key: 'japan' }, { key: 'P1' }], [{ key: 'peru' }, { key: 'P1' }]), [0]);
  assert.deepEqual(core.changedLevels([{ key: 'japan' }, { key: 'P1' }], [{ key: 'peru' }, { key: 'P3' }]), [0, 1]);
});

test('the footer reads X of N with the row term, then the completed count', () => {
  const term = { singular: 'to-do', plural: 'to-dos' };
  assert.equal(core.footerText({ shown: 3, all: 8, done: 1, term }), '3 of 8 to-dos · 1 completed');
  assert.equal(core.footerText({ shown: 1, all: 1, term }), '1 of 1 to-do');
});
