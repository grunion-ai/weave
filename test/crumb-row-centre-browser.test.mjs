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
  const read = (page, scope) => page.evaluate((scope) => {
    const row = document.querySelector(`${scope} .view-header .crumb-row`);
    const bar = document.querySelector(`${scope} .view-header .head-bar`);
    const path = row.querySelector('.crumb-path').getBoundingClientRect();
    const line = bar.getBoundingClientRect();
    const mid = (r) => r.top + r.height / 2;
    const of = (list) => [...list]
      .map((b) => ({ label: b.getAttribute('aria-label') || b.title || b.className, r: b.getBoundingClientRect() }))
      .filter((b) => b.r.height)
      .map((b) => ({ label: b.label, mid: mid(b.r) }));
    return {
      path: mid(path), line: mid(line),
      buttons: of(row.querySelectorAll('.crumb-pane button, .crumb-copy')),
      tools: of(bar.querySelectorAll('button')),
    };
  }, scope);
  const aligned = (m, where) => {
    assert.ok(m.buttons.length, `${where}: the crumb row has buttons on the path's line`);
    for (const b of m.buttons) {
      assert.ok(Math.abs(b.mid - m.path) <= 2, `${where}: ${b.label} centre ${b.mid} vs crumb path centre ${m.path}`);
    }
    assert.ok(m.tools.length, `${where}: row 2 has buttons`);
    for (const b of m.tools) {
      assert.ok(Math.abs(b.mid - m.line) <= 2, `${where}: ${b.label} centre ${b.mid} vs row 2 centre ${m.line}`);
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
