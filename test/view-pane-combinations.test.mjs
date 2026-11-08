import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';
import {
  seedIssues, combinations, fieldsOf, sortValue, STANDARD_FIELDS, ROLLUPS, LIVE, GONE,
} from './lib/view-pane-fixture.mjs';

await import('../public/list-core.js');
await import('../public/view-pane-core.js');
const VP = globalThis.weaveViewPane;
const LC = globalThis.weaveListCore;

const w = new Weave();
const { issue, release } = seedIssues(w);
const FIELDS = fieldsOf(w, issue.id);
const SORT_VALUE = sortValue(FIELDS);
const TARGETS = w.query(release.id, {}).items.map((r) => ({ id: r.id, publicId: r.publicId, name: r.name }));
const TERM = { singular: 'issue', plural: 'issues' };

function gridQuery(x, t, view) {
  const where = Object.entries(view.filters ?? {}).filter(([, v]) => v.length).map(([k, v]) => [k, 'in', v]);
  return x.query(t.id, { where, sort: view.sort ?? [], includeDeleted: !!view.deleted, relations: 'chip', ...(view.group?.length ? { groupBy: view.id } : {}) });
}

function draw(view) {
  const q = gridQuery(w, issue, view);
  const items = q.items.map((it) => ({ ...it, deleted: !!it.deletedAt }));
  const levels = VP.levelsFor(view.group, FIELDS, { domains: (view.group ?? []).map((l) => (l.field === 'Fixed in' ? TARGETS : null)), items });
  const rows = VP.rowsFor(items, levels);
  const m = VP.model(rows, { levels, collapsed: view.collapsed ?? null, rollups: !!view.rollups, subtotals: view.subtotals ?? 'all' });
  const sums = new Map((q.groups ?? []).map((g) => [g.path.map((p) => p.value).join(LC.SEP), g]));
  const grand = q.groupTotal ?? { count: VP.liveRows(items).length, rollups: w.tableStats(issue.id).rollups.map((r) => ({ field: r.targetField ?? 'Name', aggregate: r.aggregate, display: r.display })) };
  const text = [];
  for (const s of m.slots) {
    if (s.kind === 'head') text.push(`${s.node.label} ${VP.nodeCount(s.node.rows, TERM)}`);
    if (s.kind === 'row') text.push(s.row.item.name);
    if (s.kind === 'sum' || s.kind === 'grand') {
      const g = s.kind === 'grand' ? grand : sums.get(s.node.key);
      text.push(`${s.kind === 'grand' ? 'All' : s.node.label} · ${VP.countText(s.rows, TERM)}`);
      for (const r of g?.rollups ?? []) if (view.fields.includes(r.field)) text.push(r.display ?? '—');
    }
  }
  return { q, items, levels, rows, m, sums, text: text.join('\n') };
}

const siblingsOrdered = (nodes, levels) => {
  if (!nodes.length) return true;
  const level = levels[nodes[0].level];
  const at = nodes[0].level;
  const want = LC.arrange(nodes.flatMap((n) => n.rows).map((r) => ({ ...r, keys: [r.keys[at]] })), { levels: [level], showEmpty: true }).groups?.map((g) => g.label) ?? [];
  const got = nodes.map((n) => n.label);
  const kept = want.filter((x) => got.includes(x));
  return got.join('|') === kept.join('|') && !got.slice(0, -1).includes(VP.NO_VALUE)
    && nodes.every((n) => !n.groups || siblingsOrdered(n.groups, levels));
};

test('the View pane combination suite: 960 view setups over Issue, 14 checks each', (t) => {
  const inv = {};
  const fails = [];
  const ok = (name, cond, ctx) => {
    inv[name] ??= { pass: 0, fail: 0 };
    if (cond) inv[name].pass++;
    else { inv[name].fail++; if (fails.length < 12) fails.push(`${name}: ${ctx}`); }
  };
  let combos = 0;
  for (const c of combinations()) {
    combos++;
    const fields = STANDARD_FIELDS.filter((n) => !c.hidden.includes(n));
    const ctx = JSON.stringify({ f: c.filters, d: c.deleted, s: c.sort.map((x) => `${x.field} ${x.dir}`), g: c.group.map((x) => x.field), la: c.layout, ro: c.rollups, su: c.subtotals, hidden: c.hidden });
    w.tableView(`${issue.id}/Standard`, { group: null, sort: [] });
    const view = w.tableView(`${issue.id}/Standard`, {
      fields, filters: c.filters, deleted: c.deleted, group: c.group, sort: c.sort,
      layout: null, rollups: c.rollups, subtotals: c.subtotals, collapsed: null,
    });
    const overlap = c.sort.some((s) => c.group.some((g) => g.field === s.field));
    const { q, items, levels, m, sums, text } = draw(view);
    const leaves = m.arranged.groups ? m.leaves : [{ rows: m.arranged.items.map((i) => i.row), items: m.arranged.items }];
    const want = w.query(issue.id, { includeDeleted: c.deleted, where: Object.entries(c.filters).map(([k, v]) => [k, 'in', v]) }).items.filter((it) => c.deleted || !it.deletedAt);
    ok('Sort and group never share a field', !(view.sort ?? []).some((s) => (view.group ?? []).some((g) => g.field === s.field))
      && (view.sort ?? []).length <= VP.SORT_CAP && (view.group ?? []).length <= VP.GROUP_CAP, ctx);
    ok('A field moved out of Sort is announced', overlap === ((view.notes ?? []).length > 0), ctx);
    ok('Every row shown passes the filters', leaves.every((l) => l.rows.every((r) => VP.passes(r.item, c.filters, FIELDS) && (!r.deleted || c.deleted))), ctx);
    const seen = new Set(leaves.flatMap((l) => l.rows.map((r) => r.id)));
    ok('Every matching row is shown', seen.size === want.length && want.every((r) => seen.has(r.id)), ctx);
    ok('No row repeats inside one group', leaves.every((l) => new Set(l.rows.map((r) => r.id)).size === l.rows.length), ctx);
    const cmp = VP.comparator(view.sort ?? [], (r, f) => SORT_VALUE(r.item, f), (a, b) => a.item.publicId - b.item.publicId);
    ok('Rows follow every sort level inside each group', leaves.every((l) => l.rows.every((r, i) => i === 0 || cmp(l.rows[i - 1], r) <= 0)), ctx);
    ok('Groups follow their level order, No value last', !m.arranged.groups || siblingsOrdered(m.arranged.groups, levels), ctx);
    ok('Every group nests to the full depth', !m.arranged.groups || m.leaves.every((n) => n.level === levels.length - 1 && n.path.length === levels.length), ctx);
    ok('Group totals count each row once', m.nodes.every((n) => n.count === VP.liveRows(n.rows).length
      && (!n.groups || new Set(n.groups.flatMap((g) => VP.liveRows(g.rows).map((r) => r.id))).size === n.count)), ctx);
    const count = (k) => m.slots.filter((s) => s.kind === k).length;
    const expSum = c.rollups ? m.nodes.filter((n) => VP.subtotalAt(n.level, { rollups: true, subtotals: c.subtotals })).length : 0;
    ok('Rendered rows, headers and rollups match the data', count('row') === leaves.reduce((a, l) => a + l.rows.length, 0)
      && count('head') === m.nodes.length && count('sum') === expSum && count('grand') === (c.rollups ? 1 : 0), ctx);
    ok('Nothing renders undefined or NaN', !/undefined|NaN/.test(text), ctx);
    ok('Grand total names the live count', !c.rollups || text.includes(`All · ${VP.countText(items, TERM)}`), ctx);
    if (view.group?.length) {
      const mcp = dispatchTool(w, 'weave_query', { db: issue.id, view: view.id, relations: 'chip' });
      const live = (n) => VP.liveRows(n.rows).map((r) => r.item.id);
      ok('weave_query subtotals equal the grid\'s, cell for cell', JSON.stringify(mcp.groups) === JSON.stringify(q.groups)
        && JSON.stringify(mcp.groupTotal) === JSON.stringify(q.groupTotal)
        && q.groups.length === m.nodes.length
        && m.nodes.every((n, i) => q.groups[i].path.map((p) => p.value).join(LC.SEP) === n.key && sums.get(n.key)?.count === n.count
          && sums.get(n.key).rollups.length === ROLLUPS.length
          && sums.get(n.key).rollups.find((r) => r.aggregate === 'count').value === live(n).length), ctx);
    } else ok('weave_query subtotals equal the grid\'s, cell for cell', !('groups' in q) && !('groupTotal' in q), ctx);
    ok('Hidden grouped fields keep their headers', !m.arranged.groups?.length || levels.every((_, i) => m.slots.some((s) => s.kind === 'head' && s.node.level === i)), ctx);
  }
  const lines = Object.entries(inv).map(([k, v]) => `${v.fail ? 'FAIL' : 'ok  '} ${k} ${v.pass}/${v.pass + v.fail}`);
  for (const line of lines) t.diagnostic(line);
  assert.equal(combos, 960, '6 filters × 4 sorts × 5 groups × 4 rollup modes × 2 field sets');
  assert.equal(Object.keys(inv).length, 14, 'the mockup\'s 13 checks plus weave_query parity');
  assert.deepEqual(fails, [], lines.join('\n'));
});

const fresh = () => { const x = new Weave(); return { x, ...seedIssues(x) }; };

test('rule: grouping a sorted field moves it out of Sort and says so', () => {
  const { x, issue: t } = fresh();
  x.tableView(`${t.id}/Standard`, { sort: [{ field: 'Severity', dir: 'desc' }, { field: 'Name', dir: 'asc' }] });
  const v = x.tableView(`${t.id}/Standard`, { group: ['Severity'] });
  assert.deepEqual(v.sort, [{ field: 'Name', dir: 'asc' }]);
  assert.deepEqual(v.notes, ['Severity now orders the groups, so it left Sort.']);
  const back = x.tableView(`${t.id}/Standard`, { sort: [{ field: 'Severity', dir: 'asc' }, { field: 'Name', dir: 'asc' }] });
  assert.deepEqual(back.sort, [{ field: 'Name', dir: 'asc' }], 'a sort level on a grouped field never lands');
  assert.equal(back.notes.length, 1);
  const n = VP.normalize({ sort: [{ field: 'Severity', dir: 'desc' }, { field: 'Name' }], group: [{ field: 'Severity' }] });
  assert.deepEqual(n.sort, [{ field: 'Name', dir: 'asc' }]);
  assert.equal(n.notes.length, 1);
});

test('rule: Sort keeps 3 levels, Group keeps 5', () => {
  const { x, issue: t } = fresh();
  assert.throws(() => x.tableView(`${t.id}/Standard`, { sort: ['Name', 'Area', 'Status', 'Severity'].map((field) => ({ field })) }), /at most 3/);
  assert.throws(() => x.tableView(`${t.id}/Standard`, { group: ['Status', 'Severity', 'Symptom', 'Fixed in', 'Area', 'Name'] }), /at most 5/);
  assert.equal(x.tableView(`${t.id}/Standard`, { group: ['Status', 'Severity', 'Symptom', 'Fixed in', 'Area'] }).group.length, 5);
  const n = VP.normalize({ sort: ['Name', 'Area', 'Status', 'Severity'].map((field) => ({ field })), group: [] });
  assert.equal(n.sort.length, 3);
});

test('rule: a field cannot repeat inside Sort or Group', () => {
  const { x, issue: t } = fresh();
  assert.throws(() => x.tableView(`${t.id}/Standard`, { sort: [{ field: 'Name' }, { field: 'Name', dir: 'desc' }] }), /once/);
  assert.throws(() => x.tableView(`${t.id}/Standard`, { group: ['Area', 'Area'] }), /once/);
  const n = VP.normalize({ sort: [{ field: 'Name' }, { field: 'Name', dir: 'desc' }], group: [{ field: 'Area' }, { field: 'Area', dir: 'desc' }] });
  assert.equal(n.sort.length, 1);
  assert.equal(n.group.length, 1);
});

test('rule: empty values sort last in both directions, ties fall back to #', () => {
  const { x, issue: t } = fresh();
  for (const dir of ['asc', 'desc']) {
    const rows = x.query(t.id, { sort: [{ field: 'Fixed in', dir }], relations: 'chip' }).items;
    const i = rows.findIndex((r) => !r.fields['Fixed in']);
    assert.ok(i > 0, dir);
    assert.ok(rows.slice(i).every((r) => !r.fields['Fixed in']), `${dir}: every empty row after the filled ones`);
    const empties = rows.slice(i).map((r) => r.publicId);
    assert.deepEqual(empties, [...empties].sort((a, b) => a - b), `${dir}: ties keep # order`);
  }
  const names = x.query(t.id, { sort: [{ field: 'Area', dir: 'desc' }] }).items;
  const grid = names.filter((r) => r.fields.Area === 'Grid').map((r) => r.publicId);
  assert.deepEqual(grid, [...grid].sort((a, b) => a - b));
});

test('rule: a row with two symptoms sits in both groups and the total counts it once', () => {
  const { x, issue: t } = fresh();
  const v = x.tableView(`${t.id}/Standard`, { group: ['Symptom'], rollups: true });
  const q = x.query(t.id, { view: v.id, relations: 'chip' });
  const fields = fieldsOf(x, t.id);
  const levels = VP.levelsFor(v.group, fields, { items: q.items });
  const m = VP.model(VP.rowsFor(q.items, levels), { levels, rollups: true });
  const three = (label) => m.arranged.groups.find((g) => g.label === label).rows.some((r) => r.publicId === 3);
  assert.ok(three('Looks broken') && three('Slow'));
  assert.equal(VP.countText(m.slots.at(-1).rows, TERM), `${LIVE.length} issues`);
  assert.equal(q.groupTotal.count, LIVE.length, 'the server total counts the two-symptom row once');
  const count = (g) => g.rollups.find((r) => r.aggregate === 'count').value;
  assert.equal(count(q.groupTotal), LIVE.length);
  assert.ok(q.groups.reduce((a, g) => a + g.count, 0) > LIVE.length, 'while the symptom groups together hold it twice');
});

test('rule: collapsing a group hides its rows, keeps its header and its subtotal', () => {
  const { x, issue: t } = fresh();
  const fields = fieldsOf(x, t.id);
  const items = x.query(t.id, { relations: 'chip' }).items;
  const levels = VP.levelsFor([{ field: 'Area' }, { field: 'Severity' }], fields, { items });
  const rows = VP.rowsFor(items, levels);
  const open = VP.model(rows, { levels, rollups: true, subtotals: 'all' });
  const first = open.arranged.groups[0];
  const shut = VP.model(rows, { levels, rollups: true, subtotals: 'all', collapsed: [first.key] });
  const n = (mm, k) => mm.slots.filter((s) => s.kind === k).length;
  assert.equal(n(shut, 'row'), n(open, 'row') - first.rows.length);
  assert.ok(shut.slots.some((s) => s.kind === 'head' && s.node.key === first.key));
  assert.ok(shut.slots.some((s) => s.kind === 'sum' && s.node.key === first.key), 'the collapsed group keeps its subtotal');
  assert.equal(n(shut, 'sum'), n(open, 'sum') - first.groups.length);
  assert.equal(n(shut, 'head'), n(open, 'head') - first.groups.length);
});

test('rule: deleted rows show but never add to a total', () => {
  const { x, issue: t } = fresh();
  const v = x.tableView(`${t.id}/Standard`, { group: ['Area'], deleted: true, rollups: true });
  const q = x.query(t.id, { view: v.id, relations: 'chip' });
  const items = q.items.map((it) => ({ ...it, deleted: !!it.deletedAt }));
  const m = VP.model(VP.rowsFor(items, VP.levelsFor(v.group, fieldsOf(x, t.id), { items })), { levels: VP.levelsFor(v.group, fieldsOf(x, t.id), { items }), rollups: true });
  assert.equal(m.slots.filter((s) => s.kind === 'row').length, LIVE.length + GONE.length, 'a grouped view shows its deleted rows');
  assert.equal(VP.countText(m.slots.at(-1).rows, TERM), `${LIVE.length} issues`);
  assert.equal(q.groupTotal.rollups.find((r) => r.aggregate === 'count').value, LIVE.length, 'the server total leaves them out');
  const nav = q.groups.find((g) => g.path[0].value === 'Nav');
  assert.equal(nav.count, LIVE.filter((r) => r[6] === 'Nav').length);
  assert.equal(nav.rollups.find((r) => r.aggregate === 'count').value, nav.count);
  const sum = q.groupTotal.rollups.find((r) => r.aggregate === 'sum');
  assert.equal(sum.value, LIVE.reduce((a, r) => a + (r[0] % 5) * 1.5, 0));
  assert.match(sum.display, /^\$/, 'the Σ value wears the column\'s currency costume');
});

test('rule: changing the group fields or their orders expands every group again (Feature #348)', () => {
  const { x, issue: t } = fresh();
  x.tableView(`${t.id}/Standard`, { group: ['Area'], collapsed: ['Nav'] });
  assert.deepEqual(x.tableView(`${t.id}/Standard`, { group: ['Area'] }).collapsed, ['Nav'], 'same grouping: still collapsed');
  assert.equal(x.tableView(`${t.id}/Standard`, { group: [{ field: 'Area', dir: 'desc' }] }).collapsed, undefined, 'same field, new order: a new grouping, every group open');
  x.tableView(`${t.id}/Standard`, { collapsed: ['Nav'] });
  assert.equal(x.tableView(`${t.id}/Standard`, { group: ['Severity'] }).collapsed, undefined, 'new field: every group open');
  assert.equal(VP.nextCollapsed([{ field: 'Area' }], [{ field: 'Severity' }], ['Nav']), null);
  assert.equal(VP.nextCollapsed([{ field: 'Area' }], [{ field: 'Area', dir: 'desc' }], ['Nav']), null);
  assert.deepEqual(VP.nextCollapsed([{ field: 'Area' }], [{ field: 'Area' }], ['Nav']), ['Nav']);
});

test('rule: a group order reverses and No value stays last', () => {
  const { x, issue: t, release: r } = fresh();
  const fields = fieldsOf(x, t.id);
  const items = x.query(t.id, { relations: 'chip' }).items;
  const targets = x.query(r.id, {}).items;
  const levels = VP.levelsFor([{ field: 'Fixed in', dir: 'desc' }], fields, { domains: [targets.map((r) => ({ id: r.id, name: r.name }))], items });
  const keys = VP.model(VP.rowsFor(items, levels), { levels }).arranged.groups.map((g) => g.label);
  assert.equal(keys.at(-1), VP.NO_VALUE);
  assert.equal(keys[0], 'v0.5');
});

test('weave_stats by a field carries the same per-group rollups', () => {
  const { x, issue: t } = fresh();
  const st = x.tableStats(t.id, { by: 'Area' });
  const nav = st.groups.find((g) => g.value === 'Nav');
  const v = x.tableView(`${t.id}/Standard`, { group: ['Area'] });
  const q = x.query(t.id, { view: v.id });
  assert.deepEqual(nav.rollups, q.groups.find((g) => g.path[0].value === 'Nav').rollups);
  const mcp = dispatchTool(x, 'weave_stats', { table: t.id, by: 'Area' });
  assert.deepEqual(mcp.groups.find((g) => g.value === 'Nav').rollups, nav.rollups);
});

test('weave_query without a grouped view answers as before: no groups', () => {
  const { x, issue: t } = fresh();
  const v = x.tableView(`${t.id}/Standard`, { rollups: true, deleted: true });
  const q = x.query(t.id, { view: v.id });
  assert.ok(!('groups' in q) && !('groupTotal' in q));
  assert.equal(q.items.length, LIVE.length, 'an ungrouped view still leaves its deleted rows to includeDeleted');
});
