import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPageData } from '../tools/ui-catalog/build.mjs';
import { ROUTES, STATES, harvested, uncatalogued } from './lib/states.mjs';

const PAGE = new URL('../docs/ui-catalog/index.html', import.meta.url);
const data = readPageData(readFileSync(PAGE, 'utf8'));
const found = harvested(data);

const fake = (routes, triggers) => ({
  meta: { routes },
  controls: triggers.map((sig, i) => ({ code: `X-${i}`, sig, opens: ['P-01'], routes: [] })),
});

test('the harvest reads route kinds and the controls that opened an overlay out of the catalog page', () => {
  assert.ok(found.routes.includes('Table') && found.routes.includes('Entity'), `route kinds: ${found.routes.join(', ')}`);
  assert.ok(found.triggers.length >= 10, `${found.triggers.length} triggers`);
  assert.deepEqual(harvested(fake(['Home', 'Table: Issue', 'Table: Task', 'Phone · Space: Dev'], ['button.a', 'button.a'])), { routes: ['Home', 'Space', 'Table'], triggers: ['button.a'] });
});

test('a route or trigger the harvest found and the state catalog does not list fails the gate (Issue #1119)', () => {
  const extra = fake([...found.routes, 'Wizard: Setup'], [...found.triggers, 'button.brand-new-btn']);
  assert.deepEqual(uncatalogued(extra), { routes: ['Wizard'], triggers: ['button.brand-new-btn'] });
});

test('every route the ui-catalog harvests is a route the state catalog walks, and every trigger opens a state it walks (Issue #1119)', () => {
  assert.deepEqual(uncatalogued(data), { routes: [], triggers: [] }, 'add a state for each to test/lib/states.mjs: a route names its harvest kind, an overlay names its trigger');
});

test('the state catalog names only harvested routes and triggers, so the map never drifts from the catalog', () => {
  const kinds = Object.values(ROUTES).map((r) => r.harvest).filter(Boolean);
  const triggers = STATES.flatMap((s) => s.trigger ?? []);
  assert.deepEqual(kinds.filter((k) => !found.routes.includes(k)), [], 'a route names a harvest kind the catalog never saw');
  assert.deepEqual([...new Set(triggers)].filter((t) => !found.triggers.includes(t)), [], 'a state names a trigger the catalog never saw');
  for (const s of STATES.filter((x) => x.trigger)) assert.equal(s.open, 'overlay', `${s.name}: only an overlay names the trigger that opens it`);
});
