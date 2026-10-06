import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, contacts, ann;
const s = await launch('eye rows are taught, not swapped', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  weave.addField(deals, { name: 'Stage', type: 'text' });
  weave.createEntity(deals, { name: 'Acme', values: { Amount: 12 } });
  weave.createEntity(deals, { name: 'Globex', values: { Amount: 30 } });
  weave.updateTable(deals, { hideRollups: false });
  contacts = weave.createTable({ space: 'Sales', name: 'Contact' });
  weave.addField(contacts, { name: 'Phone', type: 'text' });
  ann = weave.createEntity(contacts, { name: 'Ann', values: { Phone: '555' } });
});

if (s) {
  const { base, browser, weave } = s;
  const hiddenOf = (table) => [...(weave.describeSchema().flatMap((sp) => sp.tables).find((t) => t.id === table.id).hiddenFields ?? [])].sort();
  const hiddenNow = () => hiddenOf(deals);
  const switchReads = ([name, want]) => [...document.querySelectorAll('.chip-pop .eye-row')]
    .find((r) => r.querySelector('.eye-label')?.textContent === name)
    ?.matches(':has(input:checked), [aria-checked="true"]') === (want === 'true');
  const focusedLabel = () => document.activeElement?.closest?.('.eye-row')?.querySelector('.eye-label')?.textContent ?? null;
  const until = async (ok, what) => {
    for (const t0 = Date.now(); !ok();) {
      if (Date.now() - t0 > 5000) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const flip = (page, name) => page.locator('.chip-pop .eye-row', { hasText: name }).first().click();
  const tableWrites = (table) => new RegExp(`/api/tables/${table.id}(/views/[^/?]+)?$`);
  const holdFirstPatch = async (page, table) => {
    let release, seen = 0;
    const held = new Promise((r) => { release = r; });
    await page.route(tableWrites(table), async (route) => {
      if (route.request().method() === 'PATCH' && ++seen === 1) await held;
      await route.continue();
    });
    return { release, seen: () => seen };
  };
  const gridHeads = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#main .wv-grid thead th')].map((th) => th.textContent));
  const open = async () => {
    weave.updateTable(deals, { hiddenFields: [] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'load' });
    await page.click('.eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    await page.locator('.chip-pop').evaluate(pop => Promise.all(pop.getAnimations().map(a => a.finished)));
    return page;
  };

  test('a rebuild that lands mid-gesture does not swallow the click', async () => {
    const page = await open();
    await page.route('**/api/schema', async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    const stage = await page.locator('.chip-pop .eye-row', { hasText: 'Stage' }).first().boundingBox();
    await page.locator('.chip-pop .eye-row', { hasText: 'Amount' }).first().click();
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.down();
    await page.waitForFunction(switchReads, ['Amount', 'false']);
    await page.mouse.up();
    await page.waitForFunction(switchReads, ['Stage', 'false']);
    await until(() => JSON.stringify(hiddenNow()) === JSON.stringify(['Amount', 'Stage']), 'the hidden set').catch(() => {});
    assert.deepEqual(hiddenNow(), ['Amount', 'Stage'], 'both flips reached the table');
    assert.ok(await page.evaluate(() => !!document.activeElement?.closest?.('.chip-pop')),
      'focus stayed inside the popover');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await page.close();
  });

  test('the rows stay the same nodes, and their handlers read the live table', async () => {
    const page = await open();
    const rowCount = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.chip-pop .eye-row')];
      rows.forEach((r, i) => { r.dataset.stamp = String(i); });
      return rows.length;
    });
    await page.locator('.chip-pop .eye-row', { hasText: 'Amount' }).first().click();
    await page.waitForFunction(switchReads, ['Amount', 'false']);
    assert.equal(
      await page.evaluate(() => document.querySelectorAll('.chip-pop .eye-row[data-stamp]').length),
      rowCount, 'every row is the node it was before the flip');
    assert.equal(await page.evaluate(focusedLabel), 'Amount', 'the pressed row kept focus');
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await page.evaluate(focusedLabel), 'Amount', 'ArrowDown still walks the rows');
    await page.locator('.chip-pop .eye-row', { hasText: 'Stage' }).first().click();
    await page.waitForFunction(switchReads, ['Stage', 'false']);
    await until(() => JSON.stringify(hiddenNow()) === JSON.stringify(['Amount', 'Stage']), 'the hidden set').catch(() => {});
    assert.deepEqual(hiddenNow(), ['Amount', 'Stage'], 'the second flip added to the hidden set');
    await page.close();
  });

  test('two flips that overlap both reach the table', async () => {
    const page = await open();
    const patches = [];
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route(tableWrites(deals), async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patches.push(route.request().postDataJSON());
      if (patches.length === 1) await held;
      await route.continue();
    });
    let draws = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith(`/api/tables/${deals.id}/query`)) draws++;
    });
    await page.locator('.chip-pop .eye-row', { hasText: 'Amount' }).first().click();
    await until(() => patches.length === 1, 'the first PATCH');
    await page.locator('.chip-pop .eye-row', { hasText: 'Stage' }).first().click();
    await page.waitForTimeout(400);
    assert.equal(patches.length, 1, 'the second flip is not on the wire while the first PATCH is out');
    release();
    await page.waitForFunction(switchReads, ['Amount', 'false']);
    await page.waitForFunction(switchReads, ['Stage', 'false']);
    await until(() => JSON.stringify(hiddenNow()) === JSON.stringify(['Amount', 'Stage']), 'the hidden set').catch(() => {});
    assert.deepEqual(hiddenNow(), ['Amount', 'Stage'], 'neither flip overwrote the other');
    assert.deepEqual(patches, [{ hide: ['Amount'] }, { hide: ['Stage'] }],
      'the second flip read the table after the first one landed');
    await until(() => draws >= 1, 'the redraw').catch(() => {});
    await page.waitForLoadState('networkidle');
    assert.equal(draws, 1, 'the pair redrew the grid once');
    await page.close();
  });

  test("a late repaint leaves a column's ⋮ menu alone", async () => {
    const page = await open();
    const hold = await holdFirstPatch(page, deals);
    await flip(page, 'Amount');
    await until(() => hold.seen() === 1, 'the PATCH');
    await page.click('#main .eye-btn');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await page.evaluate(() => document.querySelector('#main .wv-grid thead th:has(.field-menu[aria-label="Configure field Stage"])')
      .scrollIntoView({ block: 'nearest', inline: 'center' }));
    await page.locator('#main .wv-grid thead th:has(.field-menu[aria-label="Configure field Stage"]) .field-menu').click({ force: true });
    await page.waitForSelector('.chip-pop');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.chip-pop .eye-row').length), 0, 'the ⋮ menu opened');
    hold.release();
    await page.waitForFunction(() => ![...document.querySelectorAll('#main .wv-grid thead th')].some((th) => th.textContent.includes('Amount')));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.chip-pop .eye-row').length), 0,
      'the eye did not swap its switches into the ⋮ menu');
    await page.close();
  });

  test("a flip on one table still repaints when another table's eye flips behind it", async () => {
    weave.updateTable(deals, { hiddenFields: [] });
    weave.updateTable(contacts, { hiddenFields: [] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}?e=${ann.id}`, { waitUntil: 'load' });
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    const hold = await holdFirstPatch(page, deals);
    await page.click('#main .eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    await flip(page, 'Amount');
    await until(() => hold.seen() === 1, 'the PATCH');
    await page.click('#dock .eye-btn');
    await page.waitForFunction(() => [...document.querySelectorAll('.chip-pop .eye-label')].some((l) => l.textContent === 'Phone'));
    await flip(page, 'Phone');
    hold.release();
    await until(() => hiddenOf(contacts).includes('Phone'), "the dock's write");
    const redrawn = await page.waitForFunction(() =>
      ![...document.querySelectorAll('#main .wv-grid thead th')].some((th) => th.textContent.includes('Amount')),
    null, { timeout: 5000 }).then(() => true, () => false);
    assert.ok(redrawn, 'the grid dropped the column its own flip hid');
    await page.close();
  });

  test('a late repaint does not draw its table over the page the reader moved to', async () => {
    weave.updateTable(contacts, { hiddenFields: [] });
    const page = await open();
    const hold = await holdFirstPatch(page, deals);
    await flip(page, 'Amount');
    await until(() => hold.seen() === 1, 'the PATCH');
    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, contacts.id);
    await page.waitForFunction(() => [...document.querySelectorAll('#main .wv-grid thead th')].some((th) => th.textContent.includes('Phone')));
    hold.release();
    await until(() => hiddenNow().includes('Amount'), 'the write');
    await page.waitForTimeout(800);
    const heads = await gridHeads(page);
    assert.ok(heads.some((h) => h.includes('Phone')) && !heads.some((h) => h.includes('Stage')),
      `the page still shows Contact, not Deal (${heads.join(' | ')})`);
    await page.close();
  });

  test('a row set that actually changed still rebuilds, and focus follows the pressed row', async () => {
    const page = await open();
    weave.addField(deals, { name: 'Owner', type: 'text' });
    await page.locator('.chip-pop .eye-row', { hasText: 'Amount' }).first().click();
    await page.waitForFunction(switchReads, ['Amount', 'false']);
    await page.waitForFunction(() => [...document.querySelectorAll('.chip-pop .eye-row')]
      .some((r) => r.querySelector('.eye-label')?.textContent === 'Owner'));
    assert.equal(await page.evaluate(focusedLabel), 'Amount',
      'focus followed the pressed row onto its replacement');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await page.close();
  });

  test('the Σ row picker holds its rows across a flip too', async () => {
    weave.updateTable(deals, { hiddenFields: [] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'load' });
    await page.waitForSelector('thead tr.wv-foot td.foot-cell[data-col="Amount"]');
    await page.click('thead tr.wv-foot td.foot-cell[data-col="Amount"]');
    await page.waitForSelector('.chip-pop .foot-row[data-agg="sum"]');
    const rowCount = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.chip-pop .foot-row')];
      rows.forEach((r, i) => { r.dataset.stamp = String(i); });
      return rows.length;
    });
    await page.click('.chip-pop .foot-row[data-agg="sum"]');
    await page.waitForFunction(() => document.querySelector('.chip-pop .foot-row[data-agg="sum"]')?.matches(':has(input:checked), [aria-checked="true"]'));
    assert.equal(
      await page.evaluate(() => document.querySelectorAll('.chip-pop .foot-row[data-stamp]').length),
      rowCount, 'every aggregate row is the node it was before the flip');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.agg), 'sum', 'the pressed row kept focus');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await page.close();
  });
}
