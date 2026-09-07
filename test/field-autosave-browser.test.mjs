/* A field mid-edit saves when the page leaves it, driven through a real
   browser (Kyle, 2026-09-07: "automatic save for any field on click off or
   nav away").
   A plain input commits through its native `change`, which the browser fires
   on blur — so a click elsewhere already saved. A route change (back button,
   a typed hash, a keyboard shortcut), a dock closing, and a tab closing all
   tore the input out of the page with no blur, and the keystrokes went with
   it. Now every one of those commits the active edit first, and a write
   started while the page unloads rides `keepalive` so the browser finishes it.
   Playwright is NOT a dependency of weave; it is imported dynamically and
   the suite skips when absent, so `node --test` stays green on a bare checkout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let orders, order, other;
const s = await launch('field autosave', (weave) => {
  weave.createSpace({ name: 'Ops' });
  orders = weave.createTable({ space: 'Ops', name: 'Order' });
  weave.addField(orders, { name: 'Vendor', type: 'text' });
  weave.addField(orders, { name: 'Qty', type: 'number' });
  weave.addField(orders, { name: 'Note', type: 'text' });
  order = weave.createEntity(orders, { name: 'Sensor boards', values: { Vendor: 'Nordic', Qty: 12 } });
  other = weave.createEntity(orders, { name: 'Cables', values: { Vendor: 'Molex', Qty: 3 } });
});

if (s) {
  const { browser, base, weave } = s;
  const open = async (hash) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return page;
  };
  const stored = (field) => weave.readEntity(order.id).fields[field];
  const settle = async (field, want) => {
    for (let i = 0; i < 50 && stored(field) !== want; i++) await new Promise((r) => setTimeout(r, 100));
    return stored(field);
  };
  // The entity page's row for a field: its input, focused with fresh text.
  const typeInto = async (page, field, text) => {
    const sel = `.entity-values .fieldrow[data-field="${field}"] input, .fieldrow[data-field="${field}"] input`;
    await page.waitForSelector(sel);
    await page.fill(sel, text);
    assert.equal(await page.evaluate((q) => document.activeElement === document.querySelector(q), sel), true, 'the input holds focus');
  };

  test('a click off the field commits it, with no Saved toast (Issue #135)', async () => {
    const page = await open(`#/entity/${order.id}`);
    await typeInto(page, 'Vendor', 'Nordic AS');
    await page.click('h1, .page-title, main', { position: { x: 5, y: 5 } });
    assert.equal(await settle('Vendor', 'Nordic AS'), 'Nordic AS');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await page.locator('.wv-toast').count(), 0, 'a save is the default outcome, not a message');
    await page.close();
  });

  test('a hash change with a dirty field commits it (nav away)', async () => {
    const page = await open(`#/entity/${order.id}`);
    await typeInto(page, 'Vendor', 'Nordic Semi');
    await page.evaluate((h) => { location.hash = h; }, `#/table/${orders.id}`);
    assert.equal(await settle('Vendor', 'Nordic Semi'), 'Nordic Semi');
    await page.close();
  });

  test('the back button commits a dirty field', async () => {
    const page = await open(`#/table/${orders.id}`);
    await page.evaluate((h) => { location.hash = h; }, `#/entity/${order.id}`);
    await typeInto(page, 'Note', 'ships Friday');
    await page.goBack();
    assert.equal(await settle('Note', 'ships Friday'), 'ships Friday');
    await page.close();
  });

  test('leaving the site commits a dirty field (keepalive write)', async () => {
    const page = await open(`#/entity/${order.id}`);
    await typeInto(page, 'Qty', '40');
    await page.goto('about:blank');
    assert.equal(await settle('Qty', 40), 40);
    await page.close();
  });

  test('a reload commits a dirty field', async () => {
    const page = await open(`#/entity/${order.id}`);
    await typeInto(page, 'Vendor', 'Nordic ASA');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await settle('Vendor', 'Nordic ASA'), 'Nordic ASA');
    assert.equal(await page.inputValue('.fieldrow[data-field="Vendor"] input'), 'Nordic ASA', 'the reloaded page shows the saved value');
    await page.close();
  });

  test('a dock swapped to another entity commits its dirty field', async () => {
    const page = await open(`#/table/${orders.id}`);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${order.id}"] .open-link`);
    await page.waitForSelector(`#dock:not([hidden]) .fieldrow[data-field="Note"] input`);
    await page.fill(`#dock .fieldrow[data-field="Note"] input`, 'docked note');
    // A scripted click (a shortcut, a palette pick) swaps the dock with no pointerdown to blur the input.
    await page.evaluate((id) => document.querySelector(`tr[data-eid="${id}"] .open-link`).click(), other.id);
    await page.waitForSelector(`tr[data-eid="${other.id}"].row-docked`);
    assert.equal(await settle('Note', 'docked note'), 'docked note');
    await page.close();
  });
}
