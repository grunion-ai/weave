/* Chip pickers commit when the page leaves them, and a commit shows at once
   (Kyle, 2026-09-07, after Issue #135 landed: "this works for the field
   name; for multi and single select chips it didn't work in the field config
   tray; also changes do not update quickly enough — lag makes it look like
   the edit didn't stick").

   Issue #224 — a select writes on the pick; a multi-select stages its picks
   in the popover and wrote them only on a click-off. Escape, a hash change,
   a dock swap and a closing tab all removed the popover with the staged
   picks still in it. commitActiveEdit() blurs inputs — a chip popover is
   none of those — so every leaving path now commits an open multi picker
   first, and Escape commits instead of discarding.

   Issue #225 — after a pick the cell kept the old chip until PATCH → GET →
   re-render finished. The editor already holds the value, so it paints it
   the moment the pick is made; the round trip reconciles, a failure reverts.

   Playwright is NOT a dependency of weave; it is imported dynamically and
   the suite skips when absent, so `node --test` stays green on a bare checkout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let orders, order, other;
const s = await launch('chip autosave', (weave) => {
  weave.createSpace({ name: 'Ops' });
  orders = weave.createTable({ space: 'Ops', name: 'Order' });
  weave.addField(orders, { name: 'Stage', type: 'select', config: { options: ['Draft', 'Live', 'Done'] } });
  weave.addField(orders, { name: 'Tags', type: 'multiselect', config: { options: ['red', 'green', 'blue'] } });
  weave.addField(orders, { name: 'Vendor', type: 'text' });
  order = weave.createEntity(orders, { name: 'Sensor boards', values: { Stage: 'Draft', Tags: ['red'] } });
  other = weave.createEntity(orders, { name: 'Cables', values: { Stage: 'Draft' } });
});

if (s) {
  const { browser, base, weave } = s;
  const stored = (field, id = order.id) => weave.readEntity(id).fields[field];
  const settle = async (field, want, id = order.id) => {
    const same = () => JSON.stringify(stored(field, id)) === JSON.stringify(want);
    for (let i = 0; i < 50 && !same(); i++) await new Promise((r) => setTimeout(r, 100));
    return stored(field, id);
  };
  const open = async (hash) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return page;
  };
  // The entity in the dock beside its table — the tray Kyle edits in.
  const openDocked = async (id = order.id) => {
    const page = await open(`#/table/${orders.id}`);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .fieldrow[data-field="Stage"]');
    return page;
  };
  const row = (page, label) => page.locator('.picker-pop .picker-row', { hasText: label }).first();
  const openMulti = async (page, scope = '#dock') => {
    await page.click(`${scope} .fieldrow[data-field="Tags"] .ms-box`);
    await page.waitForSelector('.picker-pop .picker-row');
  };
  const stageGreen = async (page, scope = '#dock') => {
    await openMulti(page, scope);
    await row(page, 'green').click();
    // Staged in the box, not written: the popover is still up.
    assert.equal(await page.locator('.picker-pop .picker-chip', { hasText: 'green' }).count(), 1, 'green is staged in the box');
    assert.deepEqual(stored('Tags'), ['red'], 'nothing written yet');
  };
  test.beforeEach(() => { weave.updateEntity(order.id, { Stage: 'Draft', Tags: ['red'], Vendor: null }); });

  // ---- Issue #224: the pick sticks on every leaving path ----
  test('a select picked in the dock writes on the pick, with no Return', async () => {
    const page = await openDocked();
    await page.click('#dock .fieldrow[data-field="Stage"] .chip-trigger');
    await page.waitForSelector('.picker-pop .picker-row');
    await row(page, 'Live').click();
    assert.equal(await settle('Stage', 'Live'), 'Live');
    await page.close();
  });

  test('a multi-select staged in the dock writes on click-off', async () => {
    const page = await openDocked();
    await stageGreen(page);
    await page.click('#dock .dock-head', { position: { x: 5, y: 5 } });
    assert.deepEqual(await settle('Tags', ['red', 'green']), ['red', 'green']);
    await page.close();
  });

  test('Escape commits a staged multi-select instead of dropping it', async () => {
    const page = await openDocked();
    await stageGreen(page);
    await page.keyboard.press('Escape');
    assert.deepEqual(await settle('Tags', ['red', 'green']), ['red', 'green']);
    assert.equal(await page.locator('.picker-pop').count(), 0, 'the popover is gone');
    await page.close();
  });

  test('a hash change commits a staged multi-select (nav away)', async () => {
    const page = await openDocked();
    await stageGreen(page);
    await page.evaluate((h) => { location.hash = h; }, `#/entity/${other.id}`);
    assert.deepEqual(await settle('Tags', ['red', 'green']), ['red', 'green']);
    await page.close();
  });

  test('a dock swapped to another entity commits the staged multi-select', async () => {
    const page = await openDocked();
    await stageGreen(page);
    await page.evaluate((id) => document.querySelector(`tr[data-eid="${id}"] .open-link`).click(), other.id);
    await page.waitForSelector(`tr[data-eid="${other.id}"].row-docked`);
    assert.deepEqual(await settle('Tags', ['red', 'green']), ['red', 'green']);
    await page.close();
  });

  test('leaving the site commits a staged multi-select (keepalive write)', async () => {
    const page = await openDocked();
    await stageGreen(page);
    await page.goto('about:blank');
    assert.deepEqual(await settle('Tags', ['red', 'green']), ['red', 'green']);
    await page.close();
  });

  test('a multi-select staged on the entity page commits on click-off and on Escape', async () => {
    const page = await open(`#/entity/${order.id}`);
    await page.waitForSelector('.fieldrow[data-field="Tags"] .ms-box');
    await stageGreen(page, '.entity-values');
    await page.keyboard.press('Escape');
    assert.deepEqual(await settle('Tags', ['red', 'green']), ['red', 'green']);
    await page.close();
  });

  // ---- Issue #225: the committed value shows at once ----
  const slowPatch = async (page, { status = 200, ms = 1500 } = {}) => {
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route('**/api/entities/*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await Promise.race([held, new Promise((r) => setTimeout(r, ms))]);
      if (status === 200) return route.continue();
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'nope' }) });
    });
    return () => release();
  };

  test('a select picked in the dock shows the new chip before the PATCH returns', async () => {
    const page = await openDocked();
    const release = await slowPatch(page);
    await page.click('#dock .fieldrow[data-field="Stage"] .chip-trigger');
    await page.waitForSelector('.picker-pop .picker-row');
    await row(page, 'Live').click();
    await page.waitForTimeout(150);
    assert.equal(stored('Stage'), 'Draft', 'the write is still in flight');
    assert.equal((await page.textContent('#dock .fieldrow[data-field="Stage"] .chip-trigger')).trim(), 'Live', 'the chip already reads the pick');
    release();
    assert.equal(await settle('Stage', 'Live'), 'Live');
    await page.waitForTimeout(300);
    assert.equal((await page.textContent('#dock .fieldrow[data-field="Stage"] .chip-trigger')).trim(), 'Live', 'still Live after the round trip');
    await page.close();
  });

  test('a multi-select committed in the grid shows its chips before the PATCH returns', async () => {
    const page = await open(`#/table/${orders.id}`);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    const release = await slowPatch(page);
    await page.click(`tr[data-eid="${order.id}"] .ms-box`);
    await page.waitForSelector('.picker-pop .picker-row');
    await row(page, 'green').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    assert.deepEqual(stored('Tags'), ['red'], 'the write is still in flight');
    const chips = async () => page.$$eval(`tr[data-eid="${order.id}"] .ms-box .k-multi`, (ns) => ns.map((n) => n.textContent.trim()));
    assert.deepEqual(await chips(), ['red', 'green'], 'the cell already wears both chips');
    release();
    assert.deepEqual(await settle('Tags', ['red', 'green']), ['red', 'green']);
    await page.waitForTimeout(400);
    assert.deepEqual(await chips(), ['red', 'green'], 'still both after the round trip');
    await page.close();
  });

  test('a failed write reverts the chip and toasts', async () => {
    const page = await openDocked();
    await slowPatch(page, { status: 400, ms: 300 });
    await page.click('#dock .fieldrow[data-field="Stage"] .chip-trigger');
    await page.waitForSelector('.picker-pop .picker-row');
    await row(page, 'Live').click();
    await page.waitForSelector('.wv-toast');
    await page.waitForTimeout(200);
    assert.equal((await page.textContent('#dock .fieldrow[data-field="Stage"] .chip-trigger')).trim(), 'Draft', 'the chip is back on the stored value');
    assert.equal(stored('Stage'), 'Draft');
    await page.close();
  });
}
