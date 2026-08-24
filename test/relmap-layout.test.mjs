/* One relation map, two altitudes.

   Weave carried two maps: the mermaid render on the workspace home had the
   right CONTENT (user tables only, grouped by space, a labelled arrow per
   relation) and the SVG behind #/map had the right DESIGN (weave's own cards
   and type, clickable, automations drawn). This suite pins the shared half —
   the layout — so the same view serves the workspace, the home card and a
   single space page, and the per-space Map button can go away. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('../public/relmap-layout.js');
const { relmapLayout } = globalThis.WeaveRelmap;
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const INDEX = readFileSync(join(ROOT, 'public/index.html'), 'utf8');

const rel = (name, target, { many = false, id = name, inverseFieldId = null } = {}) =>
  ({ id, name, type: 'relation', many, targetDbId: target, inverseFieldId });

const SCHEMA = [
  { id: 'proj', name: 'Project', space: 'Product', spaceId: 's1', entityCount: 3,
    fields: [rel('Tasks', 'task', { many: true, id: 'f1', inverseFieldId: 'f2' })] },
  { id: 'task', name: 'Task', space: 'Product', spaceId: 's1', entityCount: 5,
    fields: [rel('Project', 'proj', { id: 'f2', inverseFieldId: 'f1' }),
             rel('Owner', 'person', { id: 'f3', inverseFieldId: 'f4' })] },
  { id: 'person', name: 'Person', space: 'People', spaceId: 's2', entityCount: 2,
    fields: [rel('Tasks', 'task', { many: true, id: 'f4', inverseFieldId: 'f3' }),
             rel('Peers', 'person', { many: true, id: 'f5', inverseFieldId: 'f5' })] },
  { id: 'reg', name: 'Tables', space: 'Workspace', spaceId: 's3', entityCount: 9, system: 'tables', fields: [] },
];

/* ---------- content: what the mermaid map got right ---------- */

test('the registry stays out of it — user structure only', () => {
  const m = relmapLayout(SCHEMA);
  assert.deepEqual(m.nodes.map((n) => n.name), ['Project', 'Task', 'Person']);
  assert.ok(!m.groups.some((g) => g.name === 'Workspace'), 'and its space with it');
});

test('nodes are grouped into one column per space, in schema order', () => {
  const m = relmapLayout(SCHEMA);
  assert.deepEqual(m.groups.map((g) => g.name), ['Product', 'People']);
  const [product, people] = m.groups;
  assert.ok(people.x > product.x + product.w, 'columns do not overlap');
  const inProduct = m.nodes.filter((n) => n.space === 'Product');
  assert.equal(inProduct.length, 2);
  assert.equal(inProduct[0].x, inProduct[1].x, 'a column is a column');
  assert.ok(inProduct[1].y > inProduct[0].y, 'stacked, not piled');
  assert.ok(product.h >= inProduct[1].y + inProduct[1].h / 2 - product.y, 'the box holds its nodes');
});

test('every relation is one labelled edge, cardinality on both ends', () => {
  const m = relmapLayout(SCHEMA);
  const labels = m.edges.map((e) => e.label).sort();
  // Read the label with the arrow: many Tasks to one Person, one Project to
  // many Tasks — the source's cardinality first, crow's-foot order.
  assert.deepEqual(labels, ['Owner ∗–1', 'Peers ∗–∗', 'Tasks 1–∗']);
  assert.equal(m.edges.length, 3, 'a relation and its inverse are one line');
});

test('an edge lands on the card, not in its middle', () => {
  const m = relmapLayout(SCHEMA);
  const e = m.edges.find((x) => !x.self);
  const from = m.nodes.find((n) => n.id === e.fromId);
  assert.ok(Math.abs(e.x1 - from.x) <= from.w / 2 + 0.01 && Math.abs(e.y1 - from.y) <= from.h / 2 + 0.01,
    'the endpoint sits on the border box');
  assert.ok(Math.abs(e.x1 - from.x) > from.w / 2 - 0.01 || Math.abs(e.y1 - from.y) > from.h / 2 - 0.01,
    'and on the border itself, not inside');
});

test('a self-relation loops instead of collapsing to a point', () => {
  const loop = relmapLayout(SCHEMA).edges.find((e) => e.self);
  assert.ok(loop, 'Person.Peers is drawn');
  assert.equal(loop.fromId, loop.toId);
  assert.notEqual(loop.y1, loop.y2, 'the loop has length');
});

/* ---------- the space altitude ---------- */

test('a space map is that space plus what it actually touches', () => {
  const m = relmapLayout(SCHEMA, { spaceId: 's1' });
  assert.deepEqual(m.nodes.map((n) => n.name).sort(), ['Person', 'Project', 'Task']);
  assert.equal(m.nodes.find((n) => n.name === 'Person').foreign, true, 'the neighbour is marked as one');
  assert.equal(m.nodes.find((n) => n.name === 'Task').foreign, false);
});

test('a space with no relations out is just its own tables', () => {
  const m = relmapLayout(SCHEMA, { spaceId: 's2' });
  assert.ok(m.nodes.some((n) => n.name === 'Person'));
  assert.ok(m.nodes.some((n) => n.name === 'Task'), 'Person.Tasks reaches Task, so Task comes along');
});

test('an empty workspace lays out to nothing, not to NaN', () => {
  const m = relmapLayout([]);
  assert.deepEqual(m, { width: 0, height: 0, groups: [], nodes: [], edges: [] });
  assert.deepEqual(relmapLayout([SCHEMA[3]]).nodes, [], 'a registry-only workspace too');
});

test('the canvas is big enough for what is on it', () => {
  const m = relmapLayout(SCHEMA);
  const right = Math.max(...m.groups.map((g) => g.x + g.w));
  assert.ok(m.width >= right, 'nothing hangs off the right');
  assert.ok(m.height >= Math.max(...m.groups.map((g) => g.y + g.h)), 'nor off the bottom');
  // Person's loop arcs past its own column — off the last one there is no
  // gap to arc into, so the canvas has to grow instead.
  const loop = m.edges.find((e) => e.self);
  assert.ok(m.width > loop.x1 + 30, 'the loop is inside the canvas');
});

test('a self-relation and its automations get room reserved, not overlap', () => {
  const plain = relmapLayout(SCHEMA);
  const person = plain.nodes.find((n) => n.name === 'Person');
  assert.equal(person.loop, true, 'the node knows it wears a loop');
  assert.equal(plain.nodes.find((n) => n.name === 'Task').loop, false);
  const withAutos = relmapLayout(SCHEMA, { autoCounts: { proj: 2 } });
  const [, taskPlain] = plain.nodes;
  const taskBelow = withAutos.nodes.find((n) => n.name === 'Task');
  assert.ok(taskBelow.y > taskPlain.y, "two pills under Project push Task down");
  assert.ok(withAutos.groups[0].h > plain.groups[0].h, 'and the space box grows with them');
});

/* ---------- one view, drawn in three places ---------- */

test('the map is one renderer, used by the page, the home and a space', () => {
  assert.match(INDEX, /relmap-layout\.js/, 'the layout ships with the app');
  assert.match(APP, /function relationMapView\(/, 'one renderer');
  assert.equal((APP.match(/relationMapView\(/g) ?? []).length, 3,
    'defined once, drawn full-page and inside the card');
  assert.equal((APP.match(/relationMapCard\(/g) ?? []).length, 3,
    'the card is defined once and drawn on the home and on a space');
  assert.match(APP, /relationMapCard\('Relation map', \{ spaceId \}\)/, 'the space card is scoped to the space');
});

test('the mermaid map and the per-space Map button are gone', () => {
  assert.ok(!APP.includes('relation-map.mmd'), 'the home draws the same view as everything else');
  assert.ok(!/href: '#\/map' \}, iconEl\('iconly:discovery', 'wv-icon'\), ' Map'/.test(APP),
    'a space shows its map, it does not link to the workspace one');
});
