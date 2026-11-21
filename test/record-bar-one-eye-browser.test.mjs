import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';
import { bar, menuLabels, paintOf, tokenPaint } from './lib/header-bar.mjs';
import { openPane } from './lib/view-pane.mjs';

let deals, contacts, acme, jane;
const s = await launch('record bar one eye', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  contacts = weave.createTable({ space: 'Sales', name: 'Contacts' });
  weave.addField(deals, { name: 'Stage', type: 'select', config: { options: ['Lead', 'Won'] } });
  weave.addRelation(deals, { name: 'Contact', targetDb: contacts.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  jane = weave.createEntity(contacts, { name: 'Jane Rivera' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital', values: { Stage: 'Lead' }, Contact: jane.id });
  weave.createEntity(deals, { name: 'Northwind rollout', values: { Stage: 'Won' } });
});

if (s) {
  const { base, browser } = s;
  const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const open = async (hash, ready, { width = 1440, height = 900, theme = 'light', dock = 0 } = {}) => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript(([t, w]) => { localStorage.setItem('weave-theme', t); if (w) localStorage.setItem('wv-dock-width', String(w)); }, [theme, dock]);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    await settled(page.locator(`${ready.split(' ')[0]} .view-header .crumb-row`));
    await frames(page);
    return page;
  };
  const record = (opts) => open(`#/entity/${acme.id}`, '#main .name-edit', opts);
  const split = (opts) => open(`#/table/${deals.id}?e=${acme.id}`, '#dock:not([hidden]) .name-edit', opts);
  const boxes = (m, where) => {
    for (const name of m.order) {
      assert.deepEqual([m.items[name].w, m.items[name].h], [28, 28], `${where}: ${name} is a 28 px box`);
      assert.deepEqual(m.items[name].icon, [16, 16], `${where}: ${name} draws a 16 px icon`);
    }
  };
  const eyePopover = async (page, scope) => {
    await page.click(`${scope} .view-header .crumb-actions > .eye-btn`);
    await page.waitForSelector('.table-fields-popover');
    return page.locator('.table-fields-popover');
  };
  const activityRow = '.table-fields-popover [data-record-activity]';

  test('the record page bar is the eye, Share and the menu in row 2, and Close in row 1 (Feature #384)', async () => {
    const page = await record();
    try {
      const m = await bar(page, '#main');
      assert.deepEqual(m.pane, ['close']);
      assert.deepEqual(m.tools, ['eye-btn', 'table-share-btn', 'dots-btn']);
      boxes(m, 'record page');
      assert.deepEqual(m.gaps, [4, 4]);
      assert.equal(m.fromRight.close, 0, 'Close ends row 1');
      assert.equal(m.fromRight['dots-btn'], 0, 'the menu ends row 2');
      assert.equal(m.row.h, 28);
      assert.deepEqual([m.copy.w, m.copy.h, m.copy.icon], [28, 28, 16], 'Copy permalink is the md step like the rest of the header (Issue #1865)');
      assert.equal(await page.locator('#main .view-header .activity-btn').isVisible(), false, 'no Activity button in the bar');
      assert.equal(await page.locator('#main .view-header .pose-btn').isVisible(), false, 'no Collapse button in the bar');
    } finally { await page.close(); }
  });

  test('the dock bar is the eye, Share and the menu in row 2, and Expand and Close in row 1 (Feature #384)', async () => {
    const page = await split();
    try {
      const m = await bar(page, '#dock');
      assert.deepEqual(m.pane, ['pose-btn', 'dock-close']);
      assert.deepEqual(m.tools, ['eye-btn', 'table-share-btn', 'dots-btn']);
      boxes(m, 'dock');
      assert.deepEqual(m.gaps, [4, 4]);
      assert.deepEqual(m.paneGaps, [4]);
      assert.equal(m.items['dots-btn'].right - m.items['eye-btn'].left, 92);
      assert.equal(m.row.h, 28);
      assert.deepEqual([m.copy.w, m.copy.h, m.copy.icon], [28, 28, 16], 'Copy permalink is the md step like the rest of the header (Issue #1865)');
      assert.equal(await page.locator('#dock .view-header .activity-btn').isVisible(), false, 'no Activity button in the dock bar');
    } finally { await page.close(); }
  });

  test('the eye popover opens on a This record section whose Activity row opens and closes the Activity panel', async () => {
    const page = await record();
    try {
      const pop = await eyePopover(page, '#main');
      const outline = await pop.evaluate((n) => [...n.children].map((c) => (c.querySelector('.eye-head')?.textContent ?? [...c.classList].find((k) => /table-control-head|field-visibility-actions|table-field-legend|table-field-list|fields-add/.test(k)) ?? c.tagName.toLowerCase())));
      assert.deepEqual(outline, ['table-control-head', 'This record', 'field-visibility-actions', 'table-field-legend', 'table-field-list', 'hr', 'fields-add', 'Reference panels'], 'the record section leads, the rest keeps its order');
      const row = page.locator(activityRow);
      assert.equal((await row.textContent()).trim(), 'Activity');
      assert.equal(await row.evaluate((n) => n.matches('label.chip-pop-row.eye-row') && !!n.closest('.table-field-line')), true, 'the row is a check row on a field line, like Reference panels');
      assert.equal(await row.locator('input').isChecked(), false);
      await row.click();
      await page.waitForSelector('aside.wv-activity');
      assert.equal(await row.locator('input').isChecked(), true, 'the row is checked while the panel is open');
      assert.equal(await page.locator('.table-fields-popover').isVisible(), true, 'the popover stays open, as it does for a field');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.table-fields-popover', { state: 'detached' });
      assert.equal(await page.locator('aside.wv-activity').isVisible(), true, 'closing the popover leaves the panel open');
      const again = await eyePopover(page, '#main');
      assert.equal(await again.locator('[data-record-activity] input').isChecked(), true, 'a reopened popover reads the open panel');
      await page.locator(activityRow).click();
      await page.waitForSelector('aside.wv-activity', { state: 'detached' });
      assert.equal(await page.locator(`${activityRow} input`).isChecked(), false);
    } finally { await page.close(); }
  });

  test('the dock eye popover toggles the docked record\'s Activity', async () => {
    const page = await split();
    try {
      await eyePopover(page, '#dock');
      await page.locator(activityRow).click();
      await page.waitForSelector('aside.wv-activity');
      assert.match(await page.evaluate(() => location.hash), /side=activity/, 'the address remembers the open panel');
      await page.locator(activityRow).click();
      await page.waitForSelector('aside.wv-activity', { state: 'detached' });
    } finally { await page.close(); }
  });

  test('the View pane field list has no record section', async () => {
    const page = await open(`#/table/${deals.id}`, '#main .wv-grid tbody tr.entity-row');
    try {
      await openPane(page, 'fields');
      await page.waitForSelector('#view-pane .table-field-list');
      assert.equal(await page.locator('#view-pane [data-record-activity]').count(), 0);
      assert.equal(await page.locator('#view-pane .eye-head', { hasText: 'This record' }).count(), 0);
    } finally { await page.close(); }
  });

  test('the full-page record menu docks the record with Dock beside table and repeats no bar control', async () => {
    const page = await record();
    try {
      const labels = await menuLabels(page, '#main');
      assert.ok(labels.includes('Dock beside table'), `the menu offers Dock beside table: ${labels}`);
      assert.ok(labels.indexOf('Dock beside table') < labels.indexOf('Duplicate'), 'in the Organize section, ahead of Duplicate');
      assert.ok(!labels.some((l) => /^Activity$|field|^Share \(|^Collapse/i.test(l)), `no Activity, Fields, Share or Collapse row: ${labels}`);
      assert.deepEqual(await menuLabels(page, '#main', { on: '.crumb-actions > .eye-btn', button: 'right' }), labels, 'a right-click on the header opens the same rows');
      await page.click('#main .view-header .head-bar .dots-btn');
      const row = page.locator('.chip-pop.wv-menu [role="menuitem"]', { hasText: 'Dock beside table' });
      assert.equal((await row.locator('.wv-menu-hint').textContent()).trim(), '⌘⇧E', 'the row carries the shortcut');
      await row.click();
      await page.waitForSelector('#dock:not([hidden]) .name-edit');
      assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}?e=${acme.id}`);
      assert.equal(await page.inputValue('#dock .name-edit'), 'Acme Working Capital');
      const docked = await menuLabels(page, '#dock');
      assert.ok(!docked.some((l) => /^Dock beside|^Expand|^Activity$/.test(l)), `the dock menu repeats no bar control: ${docked}`);
    } finally { await page.close(); }
  });

  test('⌘⇧E still docks the page record and expands the docked one', async () => {
    const page = await record();
    try {
      await page.keyboard.press('Control+Shift+E');
      await page.waitForSelector('#dock:not([hidden]) .name-edit');
      assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}?e=${acme.id}`);
      await page.keyboard.press('Control+Shift+E');
      await page.waitForSelector('#main .name-edit');
      assert.equal(await page.evaluate(() => location.hash), `#/entity/${acme.id}`);
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the eye lights up while the record's Activity panel is open`, async () => {
      const page = await record({ theme });
      try {
        const eye = page.locator('#main .view-header .crumb-actions > .eye-btn');
        const lit = await tokenPaint(page, 'background: var(--tblr-primary-lt); border: 1px solid var(--tblr-primary); color: var(--tblr-primary)');
        await eyePopover(page, '#main');
        await page.locator(activityRow).click();
        await page.waitForSelector('aside.wv-activity');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.table-fields-popover', { state: 'detached' });
        await page.mouse.move(2, 2);
        const open = await paintOf(eye);
        assert.deepEqual([open.fill, open.border, open.color], [lit.fill, lit.border, lit.color], 'lit with the popover shut and the panel open');
        await eyePopover(page, '#main');
        await page.locator(activityRow).click();
        await page.waitForSelector('aside.wv-activity', { state: 'detached' });
        await page.keyboard.press('Escape');
        await page.waitForSelector('.table-fields-popover', { state: 'detached' });
        await page.mouse.move(2, 2);
        await eye.blur();
        const shut = await paintOf(eye);
        assert.deepEqual([shut.fill, shut.border], ['none', 'none'], 'a ghost again once the panel shuts');
      } finally { await page.close(); }
    });
  }
}
