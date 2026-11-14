import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';
import { CELLS, settle } from './lib/cutoff.mjs';
import { walk } from './lib/journeys.mjs';
import { HOLD_PLATFORMS, ROUTES, SEEDS, STATES, cellsOf, readyOf, rootsOf, seedsOf } from './lib/states.mjs';
import { MIN, NOTE, SHRINK, SPAN, SWEEP, judge, keyOf, record, short, statesIn, tally } from './lib/touch.mjs';

const FILE = JSON.parse(readFileSync(new URL('./touch-baseline.json', import.meta.url), 'utf8'));
const PLATFORM = process.platform;
const SECTION = FILE[PLATFORM] ?? null;
const PHONE_STATES = STATES.filter((st) => cellsOf(st).includes('phone'));
const SEEDED = ['touch', 'prose'];
const seedOf = (st) => SEEDED.find((name) => seedsOf(st).includes(name));
const rootsFor = (st) => (st.open === 'journey' ? ['#app'] : rootsOf(st));
const named = (list) => list.map((x) => `${x.kind}: ${x.now ? `${x.now[0]}x${x.now[1]}` : 'not drawn'} against ${x.was[0]}x${x.was[1]}`).join('\n');

const servers = {};
for (const name of SEEDED) servers[name] = await launch(`phone touch baseline (${name} seed)`, SEEDS[name]);
const handset = servers.touch && servers.prose ? await engineOf(CELLS.phone.engine) : null;

test('a target with no recorded baseline is held to the 44px minimum and a recorded one may not shrink past it (Issue #1712)', () => {
  const section = { [keyOf('menu', 'button.dots-btn')]: [44, 28], [keyOf('menu', 'a.nav-db')]: [30, 30] };
  assert.deepEqual(judge('menu', { 'button.dots-btn': [44, 28], 'a.nav-db': [30, 30], 'button.btn': [44, 44] }, section).shrunk, [], 'targets at their baseline or at the minimum pass');
  assert.deepEqual(judge('menu', { 'button.btn': [44, 43] }, section).shrunk.map((x) => x.kind), [], 'one pixel of rounding under 44 is the 43px span the touch gate already allows');
  assert.deepEqual(judge('menu', { 'button.btn': [44, 30] }, section).shrunk.map((x) => x.kind), ['button.btn'], 'a new target under 44px fails');
  assert.deepEqual(judge('menu', { 'button.dots-btn': [40, 28] }, section).shrunk.map((x) => x.kind), ['button.dots-btn'], 'an axis that met 44px may not drop under it');
  assert.deepEqual(judge('menu', { 'a.nav-db': [30, 30 - SHRINK] }, section).shrunk, [], `a recorded short target may wobble ${SHRINK}px`);
  assert.deepEqual(judge('menu', { 'a.nav-db': [30, 30 - SHRINK - 0.5] }, section).shrunk.map((x) => x.kind), ['a.nav-db'], 'a recorded short target that shrinks further fails');
  assert.deepEqual(judge('row page', { 'a.nav-db': [20, 20] }, section).shrunk.map((x) => x.kind), ['a.nav-db'], 'a baseline belongs to one state');
  const { loose } = judge('menu', { 'a.nav-db': [44, 44] }, section);
  assert.deepEqual(loose.map((x) => x.kind), ['button.dots-btn', 'a.nav-db'], 'a recorded target that is gone or now meets 44px is reported so its entry can go');
});

test('only targets under the 44px minimum are recorded, keyed by state (Issue #1712)', () => {
  assert.deepEqual(record('menu', { 'b': [44, 30], 'a': [20, 44], 'c': [44, 44], 'd': [43, 43] }), { 'menu | a': [20, 44], 'menu | b': [44, 30] });
  assert.deepEqual(tally([
    { kind: 'button.k', left: 10, right: 10, up: 22, down: 22 },
    { kind: 'button.k', left: 22, right: 22, up: 5, down: 5 },
    { kind: 'a.nav-db', left: 0, right: 0, up: 0, down: 0, over: 'div.cover ""' },
  ]), { 'button.k': [20, 10], 'a.nav-db': [0, 0] }, 'a kind keeps the smallest reach of its instances on each axis');
});

test('test/touch-baseline.json names only phone-cell states of the catalogue, one section per platform the gate runs on (Issue #1712)', () => {
  const sections = Object.keys(FILE).filter((k) => k !== NOTE);
  assert.deepEqual(sections.slice().sort(), HOLD_PLATFORMS.slice().sort(), `one section for each platform the gate runs on, ${HOLD_PLATFORMS.join(' and ')}, so neither passes unread`);
  const phone = new Set(PHONE_STATES.map((st) => st.name));
  for (const platform of sections) {
    for (const state of statesIn(FILE[platform])) assert.ok(phone.has(state), `${platform} records ${state}, which is no phone-cell state in test/lib/states.mjs`);
    for (const [key, size] of Object.entries(FILE[platform])) {
      assert.ok(Array.isArray(size) && size.length === 2 && size.every((n) => typeof n === 'number' && n >= 0 && n <= MIN), `${platform} ${key}: a baseline is [across, down] reach in px, 0 to ${MIN}`);
      assert.ok(short(size), `${platform} ${key}: ${size.join('x')} meets the ${MIN}px minimum, so it needs no entry`);
    }
  }
  assert.equal(new Set(PHONE_STATES.map((st) => st.name)).size, PHONE_STATES.length, 'phone-cell state names are unique, so a baseline key names one state');
  assert.deepEqual(PHONE_STATES.filter((st) => !seedOf(st)).map((st) => st.name), [], `every phone-cell state renders on one of the ${SEEDED.join(' or ')} seeds this probe launches`);
});

if (handset) {
  const PAGE = { ...phoneProfile().page, viewport: CELLS.phone.viewport };
  const noop = async () => {};

  const open = async (ctx, state) => {
    const page = await handset.newPage(PAGE);
    page.setDefaultTimeout(10000);
    await page.goto(ROUTES[state.route].url(ctx, 'phone'), { waitUntil: 'networkidle' });
    await page.waitForSelector(readyOf(state, 'phone'), { state: 'attached' });
    if (state.open === 'overlay') {
      await state.act(page, ctx, 'phone');
      await page.locator(`${rootsFor(state)[0]} >> visible=true`).first().waitFor();
    }
    await settle(page);
    return page;
  };

  const measure = async (ctx, state, { plant = null } = {}) => {
    const roots = rootsFor(state);
    if (state.open === 'journey') {
      let seen = null;
      await walk(handset, state, ctx, { ...PAGE, probe: { install: noop, reset: noop, read: async (page) => { await settle(page); seen = await page.evaluate(SWEEP, roots); return []; } } });
      return seen;
    }
    const page = await open(ctx, state);
    try {
      if (plant) await page.evaluate(plant, roots[0]);
      return await page.evaluate(SWEEP, roots);
    } finally { await page.close(); }
  };

  for (const state of PHONE_STATES) {
    const ctx = servers[seedOf(state)];
    test(`on the phone the ${state.name} keeps every hit area at or above its recorded baseline (${state.open}, Issue #1712)`, async (t) => {
      const seen = await measure(ctx, state);
      assert.ok(seen.length >= 1, `the ${state.name} offers controls to measure in ${rootsFor(state).join(', ')}`);
      const sizes = tally(seen);
      if (!SECTION) t.diagnostic(`unrecorded ${PLATFORM}: ${JSON.stringify(record(state.name, sizes))}`);
      assert.ok(SECTION, `test/touch-baseline.json has no ${PLATFORM} section; record the entries this run printed for each state`);
      const { shrunk, loose } = judge(state.name, sizes, SECTION);
      if (loose.length) t.diagnostic(`test/touch-baseline.json ${PLATFORM} entries for the ${state.name} that are gone, met ${MIN}px or grew; drop or raise them:\n${named(loose)}`);
      assert.deepEqual(shrunk.map((x) => x.kind), [], `${shrunk.length} targets on the ${state.name} shrank below their ${PLATFORM} baseline in test/touch-baseline.json (an unrecorded target is held to ${MIN}px):\n${named(shrunk)}`);
    });
  }

  const PLANT = (root) => {
    const b = document.createElement('button');
    b.textContent = 'planted';
    b.setAttribute('aria-label', 'planted');
    b.style.cssText = 'position:fixed;left:50%;top:50%;width:12px;height:12px;min-width:0;min-height:0;padding:0;margin:0;font-size:4px;line-height:1;overflow:hidden;z-index:2147483647';
    (document.querySelector(root) ?? document.body).appendChild(b);
  };
  test('one undersized control planted on the phone row page fails the baseline (Issue #1712)', async () => {
    const state = PHONE_STATES.find((st) => st.name === 'row page');
    const sizes = tally(await measure(servers[seedOf(state)], state, { plant: PLANT }));
    const planted = sizes['button "planted"'];
    assert.ok(planted && planted[0] < SPAN && planted[1] < SPAN, `the sweep measures the 12px control, got ${JSON.stringify(planted)}`);
    const { shrunk } = judge(state.name, sizes, SECTION ?? {});
    assert.ok(shrunk.some((x) => x.kind === 'button "planted"'), 'a new control under 44px is a shrink against the implied 44px baseline');
  });
}
