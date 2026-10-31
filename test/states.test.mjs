import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_TYPES, Weave } from '../src/engine.js';
import { CELLS, HOLD_PLATFORMS, LAYOUTS, OPENS, PROBES, ROUTES, SEEDS, STATES, THEMES, cellsOf, held, plan, seedsOf, themesOf, walked } from './lib/states.mjs';
import { JOURNEYS, cellsOf as journeyCells } from './lib/journeys.mjs';
import { OVERLAYS } from './lib/overlays.mjs';
import { SWEEP_JOURNEYS } from './lib/cutoff.mjs';

const names = (list) => list.map((s) => s.name);
const unique = (list) => [...new Set(list)];
const shared = STATES.filter((s) => !s.seeds);

test('the catalog spans route, layout, open state, data seed, width and theme', () => {
  assert.deepEqual(LAYOUTS, ['table', 'list', 'board']);
  assert.deepEqual(OPENS, ['journey', 'rest', 'overlay', 'hover', 'drag']);
  assert.deepEqual(CELLS, ['desktop', 'phone']);
  assert.deepEqual(THEMES, ['light', 'dark']);
  assert.deepEqual(Object.keys(SEEDS).sort(), ['a11y', 'grid', 'messy', 'touch']);
  assert.deepEqual(Object.keys(PROBES).sort(), ['a11y', 'budgets', 'cutoff', 'flicker', 'touch']);
});

test('every state names a known open state, layout, route, seed, cell and theme', () => {
  for (const s of STATES) {
    assert.ok(OPENS.includes(s.open), `${s.name}: open ${s.open}`);
    assert.ok(s.layout === null || LAYOUTS.includes(s.layout), `${s.name}: layout ${s.layout}`);
    if (s.open === 'journey') assert.equal(typeof s.run, 'function', `${s.name}: a journey runs`);
    else assert.ok(Object.hasOwn(ROUTES, s.route), `${s.name}: route ${s.route}`);
    if (s.open === 'overlay') assert.ok(typeof s.open === 'string' && typeof s.act === 'function' && typeof s.root === 'string', `${s.name}: an overlay has an opener and a root`);
    assert.ok(seedsOf(s).every((x) => Object.hasOwn(SEEDS, x)), `${s.name}: seeds`);
    assert.ok(cellsOf(s).length && cellsOf(s).every((c) => CELLS.includes(c)), `${s.name}: cells`);
    assert.ok(themesOf(s).length && themesOf(s).every((t) => THEMES.includes(t)), `${s.name}: themes`);
  }
});

test('a state that names no seed renders on every seed, so every probe walks it', () => {
  assert.deepEqual(seedsOf({}), Object.keys(SEEDS));
  for (const s of shared) {
    for (const probe of Object.keys(PROBES)) {
      if (!PROBES[probe].opens.includes(s.open)) continue;
      const mine = plan(probe).filter((p) => p.state === s);
      assert.ok(mine.length, `${probe} walks or holds ${s.name}`);
    }
  }
});

test('the board and list views enter every probe that walks a route at rest (Issue #1119)', () => {
  for (const layout of ['board', 'list']) {
    const s = shared.find((x) => x.layout === layout && x.open === 'rest');
    assert.ok(s, `the catalog lists the ${layout} view once, for every seed`);
    for (const probe of ['cutoff', 'flicker', 'a11y', 'touch']) {
      assert.ok(plan(probe).some((p) => p.state === s), `${probe} has the ${layout} view in its plan`);
    }
  }
});

test('a hold names the Issue rows that track it, and only holds a probe that would walk the state', () => {
  for (const s of STATES) {
    for (const [key, rows] of Object.entries(s.hold ?? {})) {
      const [probe, cell, platform, ...rest] = key.split('|');
      assert.deepEqual(rest, [], `${s.name}: hold ${key}`);
      assert.ok(platform === undefined || (cell !== undefined && HOLD_PLATFORMS.includes(platform)), `${s.name}: hold ${key} names a platform after its cell`);
      assert.ok(Object.hasOwn(PROBES, probe), `${s.name}: hold names probe ${probe}`);
      assert.ok(cell === undefined || cellsOf(s).includes(cell), `${s.name}: hold names cell ${cell}`);
      assert.ok(PROBES[probe].opens.includes(s.open) && seedsOf(s).includes(PROBES[probe].seed), `${s.name}: ${probe} would walk it, so the hold means something`);
      assert.ok(Array.isArray(rows) && rows.length && rows.every((n) => Number.isInteger(n) && n > 0), `${s.name}: hold ${key} names its Issue rows, got ${JSON.stringify(rows)}`);
    }
  }
});

test('a hold with a platform segment holds that platform alone and the others fall back to the plain key', () => {
  for (const s of STATES) {
    for (const [key, rows] of Object.entries(s.hold ?? {})) {
      const [probe, cell, platform] = key.split('|');
      if (!platform) continue;
      const fallback = s.hold[`${probe}|${cell}`] ?? s.hold[probe] ?? null;
      for (const p of plan(probe).filter((x) => x.state === s && x.cell === cell)) {
        assert.deepEqual(p.hold, process.platform === platform ? rows : fallback, `${s.name}: ${key} on ${process.platform}`);
      }
    }
  }
});
test('a held walk leaves the gate and lands in the held list with its Issue rows', () => {
  for (const probe of Object.keys(PROBES)) {
    const all = plan(probe);
    assert.deepEqual(walked(probe), all.filter((p) => !p.hold));
    assert.deepEqual(held(probe), all.filter((p) => p.hold));
    for (const p of all) {
      assert.ok(PROBES[probe].cells.includes(p.cell) && cellsOf(p.state).includes(p.cell), `${probe} ${p.state.name}: cell ${p.cell}`);
      assert.ok(PROBES[probe].themes.includes(p.theme) && themesOf(p.state).includes(p.theme), `${probe} ${p.state.name}: theme ${p.theme}`);
    }
  }
});

test('state names are unique inside every probe, and flicker can fingerprint every one', () => {
  for (const probe of Object.keys(PROBES)) {
    const list = unique(plan(probe).map((p) => p.state));
    assert.equal(new Set(names(list)).size, list.length, `${probe}: ${names(list).join(', ')}`);
  }
  for (const p of plan('flicker')) assert.match(p.state.name, /^[a-z-]+$/);
});

test('journeys, overlays and the cut-off sweep are filtered views of the catalog', () => {
  const states = (probe, open) => unique(plan(probe).filter((p) => p.state.open === open).map((p) => p.state));
  assert.deepEqual(names(JOURNEYS), names(states('budgets', 'journey')));
  assert.deepEqual(names(SWEEP_JOURNEYS), names(states('cutoff', 'journey')));
  assert.deepEqual(names(OVERLAYS), names(states('cutoff', 'overlay')));
  for (const j of JOURNEYS) assert.deepEqual(journeyCells(j), cellsOf(j));
  for (const o of OVERLAYS) assert.ok(Object.hasOwn(ROUTES, o.route), `${o.name}: route ${o.route}`);
  assert.ok(SWEEP_JOURNEYS.some((j) => j.name === 'activity-panel'), 'the cut-off sweep keeps its activity journey');
  assert.ok(!JOURNEYS.some((j) => j.name === 'activity-panel'), 'the budgets keep the journeys they hold numbers for');
});

test('each probe keeps the surfaces it walked before the catalog, and adds the board and list views and the kitchen sink', () => {
  const rests = (probe) => unique(plan(probe).filter((p) => p.state.open === 'rest').map((p) => p.state.name)).sort();
  const overlays = (probe) => unique(plan(probe).filter((p) => p.state.open === 'overlay').map((p) => p.state.name)).sort();
  assert.equal(JOURNEYS.length, 14);
  assert.equal(SWEEP_JOURNEYS.length, 15);
  assert.equal(OVERLAYS.length, 39);
  assert.deepEqual(rests('cutoff'), ['board-view', 'list-view', 'sink-board', 'sink-list', 'sink-row', 'sink-table']);
  assert.deepEqual(rests('flicker'), ['board-view', 'list-view', 'sink-board', 'sink-list', 'sink-row', 'sink-table']);
  assert.deepEqual(rests('a11y'), ['Issue table', 'Task table', 'activity', 'billing', 'board-view', 'entity page', 'forms builder', 'list-view', 'map', 'published form', 'settings', 'sink-board', 'sink-list', 'sink-row', 'sink-table', 'start', 'trash']);
  assert.deepEqual(overlays('a11y'), ['command palette', 'editor open', 'field dialog', 'filter popover', 'row menu', 'share pane', 'sort popover']);
  assert.deepEqual(rests('touch'), ['board-view', 'list-view', 'row page', 'sink-board', 'sink-list', 'sink-row', 'sink-table', 'table list', 'workspace home']);
  assert.deepEqual(overlays('touch'), ['bug panel', 'menu', 'picker sheet']);
});

const sinkOf = (weave, handles) => {
  const table = weave.getTable(handles.sink.table);
  const fields = Object.values(table.fields).filter((f) => !f.deletedAt);
  const rows = weave.listEntities(table.id);
  return { table, fields, rows, byName: (n) => fields.find((f) => f.name === n) };
};

test('every seed carries the kitchen-sink table with all 22 field types (Issue #1119)', async () => {
  for (const [name, build] of Object.entries(SEEDS)) {
    const weave = new Weave();
    const handles = await build(weave);
    assert.ok(handles.sink?.table, `${name} seed: builds the kitchen-sink table`);
    const { fields } = sinkOf(weave, handles);
    const types = new Set(fields.map((f) => f.type));
    assert.deepEqual(FIELD_TYPES.filter((t) => !types.has(t)), [], `${name} seed: the kitchen sink holds every field type`);
    assert.equal(FIELD_TYPES.length, 22);
  }
});

test('the kitchen-sink rows carry adversarial values: unbroken text, large currency, long options, states and ranges', async () => {
  const weave = new Weave();
  const handles = await SEEDS.touch(weave);
  const { rows, byName } = sinkOf(weave, handles);
  const value = (row, field) => row.values[byName(field).id];
  const words = (s) => String(s).split(/[\s/@.-]+/);
  const longest = (s) => Math.max(...words(s).map((w) => w.length));
  const full = rows.find((r) => r.id === handles.sink.row);
  assert.ok(longest(value(full, 'Name')) >= 80, 'the row name is one unbroken word');
  assert.ok(longest(value(full, 'Notes')) >= 80, 'the text value is one unbroken word');
  assert.ok(longest(value(full, 'Secret')) >= 80, 'the key value is one unbroken word');
  assert.ok(value(full, 'Amount') >= 1e10 && byName('Amount').config.format === 'currency', 'the currency runs to eleven digits');
  const longName = (opts) => Math.max(...opts.map((o) => o.name.length));
  assert.ok(longName(byName('Kind').config.options) >= 40, 'a select option name runs long');
  assert.ok(longName(byName('Tags').config.options) >= 40, 'a multiselect option name runs long');
  assert.ok(longName(byName('Status').config.states) >= 40, 'a workflow state name runs long');
  const { start, end } = value(full, 'Window');
  assert.ok(Number(end.slice(0, 4)) - Number(start.slice(0, 4)) >= 100, 'the date range spans a century');
  assert.ok(value(full, 'Tags').length >= 3 && value(full, 'Parts').length >= 2, 'the chips stack');
  assert.ok(weave.getEntity(full.id).files.length >= 2, 'the attachments and avatar hold files');
  assert.ok(rows.some((r) => value(r, 'Name').length <= 2), 'a short name sits beside the long ones');
  for (const layout of ['board', 'list']) assert.ok(handles.sink[layout], `the kitchen sink has a ${layout} view`);
});

test('every probe that walks a rest state walks the kitchen sink on the table, list and board layouts (Issue #1119)', () => {
  for (const probe of ['cutoff', 'flicker', 'a11y', 'touch']) {
    const mine = plan(probe).filter((p) => p.state.route?.startsWith('sink-'));
    assert.deepEqual(unique(mine.map((p) => p.state.layout)).filter(Boolean).sort(), ['board', 'list', 'table'], `${probe} walks the kitchen sink on every layout`);
    assert.ok(mine.some((p) => p.state.layout === null), `${probe} walks the kitchen-sink row with every field`);
  }
});

test('every seed builds the handles the shared states read, so their routes resolve', async () => {
  const ctx = (handles) => ({ base: 'http://x', ...handles, doors: { base: 'http://doors' } });
  for (const [name, build] of Object.entries(SEEDS)) {
    const handles = await build(new Weave());
    for (const s of shared) {
      for (const cell of cellsOf(s)) {
        const url = ROUTES[s.route].url(ctx(handles), cell);
        assert.doesNotMatch(url, /undefined|null|\[object/, `${name} seed: ${s.name} resolves to ${url}`);
      }
    }
  }
});
