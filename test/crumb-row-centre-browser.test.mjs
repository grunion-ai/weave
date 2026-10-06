/* Crumb text and the crumb row's buttons share one vertical centre
   (Issue #585). `.crumb-actions` wears `wv-toolbar`, whose 16px
   margin-bottom made the actions box 28px of buttons plus 16px of margin;
   `.crumb-row` centred that 44px box, so the buttons sat about 8px above
   the breadcrumb text beside them, on the entity page and in the dock.
   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, acme;
const s = await launch('crumb row centre', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital' });
});

if (s) {
  const { base, browser } = s;
  /* Every button in the row's actions that sits on the path's line, with
     its centre against the path's centre. A table toolbar that wraps to a
     second line is a second line, not a misalignment, so it is left out. */
  const read = (page, scope) => page.evaluate((scope) => {
    const row = document.querySelector(`${scope} .view-header .crumb-row`);
    const path = row.querySelector('.crumb-path').getBoundingClientRect();
    const mid = (r) => r.top + r.height / 2;
    const buttons = [...row.querySelectorAll('.crumb-actions button')]
      .map((b) => ({ label: b.getAttribute('aria-label') || b.title || b.className, r: b.getBoundingClientRect() }))
      .filter((b) => b.r.height && b.r.top < path.bottom && b.r.bottom > path.top);
    return { path: mid(path), buttons: buttons.map((b) => ({ label: b.label, mid: mid(b.r) })) };
  }, scope);
  const aligned = (m, where) => {
    assert.ok(m.buttons.length, `${where}: the crumb row has buttons on the path's line`);
    for (const b of m.buttons) {
      assert.ok(Math.abs(b.mid - m.path) <= 2, `${where}: ${b.label} centre ${b.mid} vs crumb path centre ${m.path}`);
    }
  };

  test('the entity page: crumb-row buttons centre on the crumb text', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .name-edit');
    aligned(await read(page, '#main'), 'entity page');
    await page.close();
  });

  test('the dock: crumb-row buttons centre on the crumb text', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}?e=${acme.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    aligned(await read(page, '#dock'), 'dock');
    await page.close();
  });

  test('the table page: crumb-row buttons centre on the crumb text', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    aligned(await read(page, '#main'), 'table page');
    await page.close();
  });
}
