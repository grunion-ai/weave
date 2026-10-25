import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { CELLS, OPENS, SEEDS, STATES, SURFACES, TAGS, bySurface, states } from './lib/states.mjs';
import { JOURNEYS } from './lib/journeys.mjs';

const a11yBaseline = JSON.parse(readFileSync(new URL('./a11y-baseline.json', import.meta.url), 'utf8')).violations;

test('every state has one id, and every surface and open state one name', () => {
  const ids = STATES.map((st) => st.id);
  assert.equal(new Set(ids).size, ids.length, 'state ids are unique');
  const opens = OPENS.map((o) => o.name);
  assert.equal(new Set(opens).size, opens.length, 'open state names are unique');
  const titles = Object.values(SURFACES).map((s) => s.title);
  assert.equal(new Set(titles).size, titles.length, 'surface titles are unique, since a probe keys its findings on them');
});

test('every surface says how to reach it: a url, a ready selector, a root, a route and the seeds it is built for', () => {
  for (const [name, s] of Object.entries(SURFACES)) {
    for (const k of ['url', 'ready', 'root']) assert.equal(typeof s[k], 'function', `${name}: ${k}`);
    assert.equal(typeof s.title, 'string', `${name}: title`);
    assert.equal(typeof s.route, 'string', `${name}: route`);
    assert.ok(s.seeds.length && s.seeds.every((seed) => Object.hasOwn(SEEDS, seed)), `${name}: seeds`);
    assert.ok(s.states.length, `${name}: walks at least one state`);
    for (const cell of Object.keys(CELLS)) {
      assert.equal(typeof s.ready(cell), 'string', `${name}: ready on ${cell}`);
      assert.equal(typeof s.root(cell), 'string', `${name}: root on ${cell}`);
    }
  }
});

test('every state names a known cell, a seed its surface is built for, known tags, a root and a resolved opener', () => {
  for (const st of STATES) {
    assert.ok(Object.hasOwn(CELLS, st.cell), `${st.id}: cell`);
    assert.ok(st.surface.seeds.includes(st.seed), `${st.id}: the surface is built for the ${st.seed} seed`);
    assert.ok(st.tags.length && st.tags.every((t) => TAGS.includes(t)), `${st.id}: tags`);
    assert.equal(typeof st.root, 'string', `${st.id}: root`);
    assert.equal(typeof st.title, 'string', `${st.id}: title`);
    if (st.open) {
      assert.equal(typeof st.open.open, 'function', `${st.id}: ${st.open.name} is an open state in OPENS`);
      assert.equal(st.root, st.open.root, `${st.id}: an open state is read inside its own root`);
      assert.ok(!st.open.close || typeof st.open.close === 'function', `${st.id}: close`);
    }
  }
});

test('every open state is walked by some surface, so the catalog holds no dead entry', () => {
  const used = new Set(STATES.filter((st) => st.open).map((st) => st.open.name));
  assert.deepEqual(OPENS.map((o) => o.name).filter((n) => !used.has(n)), []);
});

test('every probe walks a non-empty subset, and the filters compose', () => {
  for (const tag of TAGS) assert.ok(states({ tag }).length > 0, `${tag} walks something`);
  assert.equal(states().length, STATES.length, 'no filter is every state');
  for (const tag of TAGS) for (const cell of Object.keys(CELLS)) {
    for (const st of states({ tag, cell })) assert.ok(st.tags.includes(tag) && st.cell === cell);
  }
  assert.ok(states({ open: null }).every((st) => !st.open), 'open: null is the surfaces at rest');
  const grouped = bySurface(STATES);
  assert.equal([...grouped.values()].flat().length, STATES.length, 'bySurface keeps every state');
  for (const [name, list] of grouped) assert.ok(list.every((st) => st.surface.name === name));
});

test('the cut-off sweep opens overlays on both cells, and the touch probe walks the phone', () => {
  for (const cell of Object.keys(CELLS)) assert.ok(states({ tag: 'cutoff', cell }).some((st) => st.open), `cut-off opens an overlay on ${cell}`);
  assert.ok(states({ tag: 'touch' }).every((st) => st.cell === 'phone'));
});

test('every seed builds in memory, and every state url fills from the handles its seed returns', () => {
  const handles = {};
  for (const [name, seed] of Object.entries(SEEDS)) {
    assert.equal(typeof seed.build, 'function', `${name}: build`);
    assert.equal(typeof seed.about, 'string', `${name}: about`);
    assert.ok(!seed.extends || Object.hasOwn(SEEDS, seed.extends), `${name}: extends a known seed`);
    handles[name] = { ...seed.build(new Weave()), base: 'http://x' };
  }
  for (const st of STATES) {
    const url = st.surface.url(handles[st.seed], st.cell);
    assert.ok(url.startsWith('http://x/') && !/undefined|null|\[object/.test(url), `${st.id}: ${url}`);
  }
});

test('every a11y baseline entry names a route and an open state the catalog walks', () => {
  const walked = new Set(states({ tag: 'a11y' }).map((st) => `${st.surface.title} | ${st.open ? st.open.title : 'at rest'}`));
  for (const k of Object.keys(a11yBaseline)) {
    const [route, state] = k.split(' | ');
    assert.ok(walked.has(`${route} | ${state}`), `${k}: not a state the a11y gate walks`);
  }
});

test('a journey that names a surface names one the catalog holds', () => {
  for (const j of JOURNEYS) assert.ok(!j.surface || Object.hasOwn(SURFACES, j.surface), `${j.name}: ${j.surface}`);
  assert.ok(JOURNEYS.some((j) => j.surface), 'the flicker journeys reach their surfaces through the catalog');
});

test('the board and list views are walked at rest and open by the cut-off sweep on both cells, and at rest by the touch probe (Feature #TBD)', () => {
  for (const surface of ['board', 'list']) {
    for (const cell of Object.keys(CELLS)) {
      const cut = states({ tag: 'cutoff', surface, cell });
      assert.ok(cut.some((st) => !st.open), `${surface} at rest on ${cell}`);
      assert.ok(cut.some((st) => st.open), `${surface} opens something on ${cell}`);
    }
    assert.ok(states({ tag: 'touch', surface, open: null }).length, `${surface} at rest on the phone`);
  }
  const seeded = { ...SEEDS.messy.build(new Weave()), base: 'http://x' };
  for (const name of ['board', 'list']) assert.ok(seeded[name]?.id, `the messy seed returns its ${name} view`);
});
