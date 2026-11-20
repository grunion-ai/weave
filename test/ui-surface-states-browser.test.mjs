import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { ROUTES, SEEDS, STATES, readyOf } from './lib/states.mjs';

const stateNamed = (name) => {
  const found = STATES.find((s) => s.name === name);
  assert.ok(found, `test/lib/states.mjs lists a state named ${name}`);
  return found;
};

async function openState(browser, ctx, state, cell = 'desktop') {
  const page = await browser.newPage();
  try {
    await page.goto(ROUTES[state.route].url(ctx, cell), { waitUntil: 'networkidle' });
    await page.waitForSelector(readyOf(state, cell));
    await state.act(page, ctx, cell);
    await page.waitForSelector(`${state.root} >> visible=true`, { timeout: 15000 });
    return page.locator(`${state.root} >> visible=true`).first();
  } finally {
    await page.close();
  }
}

const messy = await launch('the related-block new-record tray', SEEDS.messy);
if (messy) {
  const { browser, base, ...handles } = messy;
  test('the related-new-row state opens the tray behind the record add button (Issue #1847)', async () => {
    const state = stateNamed('related-new-row');
    assert.equal(state.root, '#tray-back');
    await openState(browser, { base, ...handles }, state);
  });
}

const a11y = await launch('the reference chip state picker', SEEDS.a11y);
if (a11y) {
  const { browser, base, ...handles } = a11y;
  test('the chip state picker state opens the picker from a reference chip state mark (Issue #1847)', async () => {
    const state = stateNamed('chip state picker');
    assert.equal(state.root, '.picker-pop');
    await openState(browser, { base, ...handles }, state);
  });
}
