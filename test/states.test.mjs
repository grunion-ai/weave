import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { CELLS, LAYOUTS, OPENS, PROBES, ROUTES, SEEDS, STATES, THEMES, cellsOf, held, plan, seedsOf, themesOf, walked } from './lib/states.mjs';
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
      const [probe, cell, ...rest] = key.split('|');
      assert.deepEqual(rest, [], `${s.name}: hold ${key}`);
      assert.ok(Object.hasOwn(PROBES, probe), `${s.name}: hold names probe ${probe}`);
      assert.ok(cell === undefined || cellsOf(s).includes(cell), `${s.name}: hold names cell ${cell}`);
      assert.ok(PROBES[probe].opens.includes(s.open) && seedsOf(s).includes(PROBES[probe].seed), `${s.name}: ${probe} would walk it, so the hold means something`);
      assert.ok(Array.isArray(rows) && rows.length && rows.every((n) => Number.isInteger(n) && n > 0), `${s.name}: hold ${key} names its Issue rows, got ${JSON.stringify(rows)}`);
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

test('each probe keeps the surfaces it walked before the catalog, and adds the board and list views', () => {
  const rests = (probe) => unique(plan(probe).filter((p) => p.state.open === 'rest').map((p) => p.state.name)).sort();
  const overlays = (probe) => unique(plan(probe).filter((p) => p.state.open === 'overlay').map((p) => p.state.name)).sort();
  assert.equal(JOURNEYS.length, 14);
  assert.equal(SWEEP_JOURNEYS.length, 15);
  assert.equal(OVERLAYS.length, 39);
  assert.deepEqual(rests('cutoff'), ['board-view', 'list-view']);
  assert.deepEqual(rests('flicker'), ['board-view', 'list-view']);
  assert.deepEqual(rests('a11y'), ['Issue table', 'Task table', 'activity', 'billing', 'board-view', 'entity page', 'forms builder', 'list-view', 'map', 'published form', 'settings', 'start', 'trash']);
  assert.deepEqual(overlays('a11y'), ['command palette', 'editor open', 'field dialog', 'filter popover', 'row menu', 'share dialog', 'sort popover']);
  assert.deepEqual(rests('touch'), ['board-view', 'list-view', 'row page', 'table list', 'workspace home']);
  assert.deepEqual(overlays('touch'), ['bug panel', 'menu', 'picker sheet']);
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
