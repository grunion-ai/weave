import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
await import('../public/column-resize.js');
const CR = globalThis.WeaveColumnResize;

let vendors, accounts, acme, a, b;
const s = await launch('rating field type', (weave) => {
  weave.createSpace({ name: 'Buy' });
  vendors = weave.createTable({ space: 'Buy', name: 'Vendor' });
  accounts = weave.createTable({ space: 'Buy', name: 'Account' });
  weave.addField(vendors, { name: 'Fit', type: 'rating', config: { max: 5, icon: 'lucide:star' } });
  weave.addField(vendors, { name: 'Love', type: 'rating', config: { max: 3, icon: 'lucide:heart' } });
  weave.addRelation(vendors, { name: 'Account', targetDb: accounts, cardinality: 'many-to-one', inverseName: 'Vendors' });
  weave.addField(accounts, { name: 'Avg fit', type: 'rollup', config: { relationField: 'Vendors', targetField: 'Fit', aggregate: 'avg' } });
  acme = weave.createEntity(accounts, { name: 'Acme' });
  a = weave.createEntity(vendors, { name: 'A', values: { Fit: 3, Love: 1, Account: acme.id } });
  b = weave.createEntity(vendors, { name: 'B', values: { Fit: 4, Account: acme.id } });
});

if (s) {
  const { base, browser, weave } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  const cell = (id, field) => `tr[data-eid="${id}"] td[data-field="${field}"]`;
  const stored = (id, field) => weave.readEntity(id).raw[field];
  async function grid(tableId, colorScheme = 'light') {
    const page = await browser.newPage({ viewport: { width: 1300, height: 600 }, colorScheme });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }
  const filled = (page, sel) => page.locator(`${sel} .wv-rate-ico.on`).count();
  const label = (page, sel) => page.getAttribute(`${sel} .wv-rating`, 'aria-label');
  const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const patched = (page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));

  for (const colorScheme of ['light', 'dark']) {
    test(`the cell shows max icons with n filled, and a screen reader hears "n of max" (${colorScheme})`, async () => {
      const page = await grid(vendors.id, colorScheme);
      try {
        await page.waitForSelector(`${cell(a.id, 'Fit')} .wv-rating`);
        assert.equal(await page.locator(`${cell(a.id, 'Fit')} .wv-rate-ico`).count(), 5);
        assert.equal(await filled(page, cell(a.id, 'Fit')), 3);
        assert.equal(await label(page, cell(a.id, 'Fit')), '3 of 5');
        assert.equal(await page.locator(`${cell(a.id, 'Love')} .wv-rate-ico`).count(), 3, 'the max is per field');
        assert.equal(await page.locator(`${cell(a.id, 'Love')} .wv-rate-ico svg`).count(), 3, 'the icon is the field\'s, drawn from the inventory');
        assert.equal(await label(page, cell(b.id, 'Love')), 'unrated, of 3');
        const on = await page.$eval(`${cell(a.id, 'Fit')} .wv-rate-ico.on`, (n) => getComputedStyle(n).color);
        const off = await page.$eval(`${cell(a.id, 'Fit')} .wv-rate-ico:not(.on)`, (n) => getComputedStyle(n).color);
        assert.notEqual(on, off, 'filled and empty icons read differently');
        if (shots) await page.locator('.wv-grid').screenshot({ path: `${shots}/rating-grid-${colorScheme}.png` });
      } finally { await page.close(); }
    });
  }

  test('clicking the nth icon sets n; clicking the current one clears to 0', async () => {
    const page = await grid(vendors.id);
    try {
      let landed = patched(page);
      await page.click(`${cell(a.id, 'Fit')} .wv-rate-ico[data-n="5"]`);
      await landed;
      assert.equal(stored(a.id, 'Fit'), 5);
      await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 5, `${cell(a.id, 'Fit')} .wv-rate-ico.on`);
      landed = patched(page);
      await page.click(`${cell(a.id, 'Fit')} .wv-rate-ico[data-n="5"]`);
      await landed;
      assert.equal(stored(a.id, 'Fit'), 0, 'the current value clicked again clears to 0');
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-label') === '0 of 5', `${cell(a.id, 'Fit')} .wv-rating`);
    } finally {
      await page.close();
      weave.updateEntity(a.id, { Fit: 3 });
    }
  });

  test('on the resting cell a digit sets the rating and Backspace clears it', async () => {
    const page = await grid(vendors.id);
    try {
      await page.focus(cell(b.id, 'Fit'));
      let landed = patched(page);
      await page.keyboard.press('2');
      await landed;
      assert.equal(stored(b.id, 'Fit'), 2);
      await settle(page);
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-label') === '2 of 5', `${cell(b.id, 'Fit')} .wv-rating`);
      await page.focus(cell(b.id, 'Fit'));
      landed = patched(page);
      await page.keyboard.press('9');
      await landed;
      assert.equal(stored(b.id, 'Fit'), 5, 'a digit past the max sets the max');
      await settle(page);
      await page.focus(cell(b.id, 'Fit'));
      landed = patched(page);
      await page.keyboard.press('Backspace');
      await landed;
      assert.equal(stored(b.id, 'Fit'), 0);
      assert.equal(await page.locator(`${cell(b.id, 'Fit')} input`).count(), 0, 'no text box ever opened');
    } finally {
      await page.close();
      weave.updateEntity(b.id, { Fit: 4 });
    }
  });

  test('a rollup over a rating draws the same icons, read-only, rounded', async () => {
    const page = await grid(accounts.id);
    try {
      await page.waitForSelector(`${cell(acme.id, 'Avg fit')} .wv-rating`);
      assert.equal(await filled(page, cell(acme.id, 'Avg fit')), 4, 'an average of 3.5 fills four');
      assert.equal(await label(page, cell(acme.id, 'Avg fit')), '4 of 5');
      assert.equal(await page.locator(`${cell(acme.id, 'Avg fit')} .wv-rating button`).count(), 0, 'no buttons: read-only');
      assert.equal(weave.readEntity(acme.id).raw['Avg fit'], 3.5, 'the API keeps the figure');
    } finally { await page.close(); }
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the field dialog makes a rating: presets, the icon picker and the preview (${colorScheme})`, async () => {
      const page = await grid(vendors.id, colorScheme);
      try {
        await page.click('.wv-grid .add-field-btn');
        await page.waitForSelector('.tray-form');
        await page.fill('.tray-form input[name="name"]', `Quality ${colorScheme}`);
        await page.locator('.tray-form .type-tile', { hasText: 'rating' }).click();
        const max = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Max$/ }) });
        await max.locator('.seg-opt', { hasText: '7' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.tray-form .wv-rating-default .wv-rate-ico').length === 7);
        await page.click('.tray-form .wv-rating-icon');
        await page.fill('.picker-pop input', 'heart');
        await page.locator('.picker-pop .picker-cell[aria-label="heart"]').first().click();
        await page.waitForFunction(() => document.querySelector('.tray-form .wv-rating-icon')?.textContent.includes('heart'));
        if (shots) await page.locator('.tray-form').screenshot({ path: `${shots}/rating-dialog-${colorScheme}.png` });
        await page.locator('.tray-form button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('.tray-form'));
        const f = weave.getField(vendors, `Quality ${colorScheme}`);
        assert.equal(f.type, 'rating');
        assert.deepEqual(f.config, { max: 7, icon: 'lucide:heart' });
        await page.waitForSelector(`${cell(a.id, `Quality ${colorScheme}`)} .wv-rating`);
        assert.equal(await page.locator(`${cell(a.id, `Quality ${colorScheme}`)} .wv-rate-ico`).count(), 7);
      } finally {
        await page.close();
        try { weave.deleteField(vendors, `Quality ${colorScheme}`); } catch {}
      }
    });
  }
}

if (s) {
  const { base, browser, weave } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  const preview = '.tray-form .wv-rating-default .wv-rating';
  const labelIs = (page, want) => page.waitForFunction(([sel, w]) => document.querySelector(sel)?.getAttribute('aria-label') === w, [preview, want]);
  for (const colorScheme of ['light', 'dark']) {
    test(`the default is set by clicking the preview, and a new row starts at it (${colorScheme})`, async () => {
      const name = `Grade ${colorScheme}`;
      const page = await browser.newPage({ viewport: { width: 1300, height: 700 }, colorScheme });
      const before = new Set(weave.query(vendors, {}).items.map((e) => e.id));
      try {
        await page.goto(`${base}/#/table/${vendors.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-grid tbody tr.entity-row');
        await page.click('.wv-grid .add-field-btn');
        await page.waitForSelector('.tray-form');
        await page.fill('.tray-form input[name="name"]', name);
        await page.locator('.tray-form .type-tile', { hasText: 'rating' }).click();
        const maxBox = page.locator('.tray-form input[aria-label="Max"]');
        assert.equal(await maxBox.inputValue(), '5', 'the max box is prefilled with 5');
        await labelIs(page, 'Default: none, of 5');
        assert.equal(await page.locator(`${preview} .wv-rate-ico`).count(), 5);
        assert.equal(await page.locator('.tray-form .dlg-sec input[placeholder="none"]').count(), 0, 'no default text box');
        await maxBox.fill('12');
        await page.waitForFunction((sel) => document.querySelectorAll(`${sel} .wv-rate-ico`).length === 12, preview);
        await page.click(`${preview} .wv-rate-ico[data-n="9"]`);
        await labelIs(page, 'Default: 9 of 12');
        assert.equal(await page.locator(`${preview} .wv-rate-ico.on`).count(), 9);
        await page.click(`${preview} .wv-rate-ico[data-n="9"]`);
        await labelIs(page, 'Default: none, of 12');
        await page.focus(preview);
        await page.keyboard.press('ArrowRight');
        await labelIs(page, 'Default: 1 of 12');
        await page.keyboard.press('7');
        await labelIs(page, 'Default: 7 of 12');
        await page.keyboard.press('ArrowLeft');
        await labelIs(page, 'Default: 6 of 12');
        assert.equal(await page.evaluate((sel) => document.activeElement === document.querySelector(sel), preview), true, 'focus stays on the row');
        await page.keyboard.press('Backspace');
        await labelIs(page, 'Default: none, of 12');
        await page.click(`${preview} .wv-rate-ico[data-n="11"]`);
        await labelIs(page, 'Default: 11 of 12');
        await page.locator('.tray-form .seg-opt', { hasText: /^3$/ }).click();
        await labelIs(page, 'Default: 3 of 3');
        assert.equal(await maxBox.inputValue(), '3');
        await page.locator('.tray-form .seg-opt', { hasText: /^5$/ }).click();
        await page.click(`${preview} .wv-rate-ico[data-n="4"]`);
        await labelIs(page, 'Default: 4 of 5');
        await page.click('.tray-form .wv-rating-icon');
        await page.fill('.picker-pop input', 'heart');
        await page.locator('.picker-pop .picker-cell[aria-label="heart"]').first().click();
        await page.waitForFunction(() => document.querySelector('.tray-form .wv-rating-icon')?.textContent.includes('heart'));
        await labelIs(page, 'Default: 4 of 5');
        assert.equal(await page.locator(`${preview} .wv-rate-ico.on`).count(), 4, 'the default survives an icon change');
        if (shots) await page.locator('.tray-form').screenshot({ path: `${shots}/rating-default-${colorScheme}.png` });
        await page.locator('.tray-form button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('.tray-form'));
        assert.deepEqual(weave.getField(vendors, name).config, { max: 5, icon: 'lucide:heart', default: 4 });
        await page.click('.wv-grid .add-entity-btn');
        let fresh = null;
        for (let i = 0; i < 50 && !fresh; i++) {
          fresh = weave.query(vendors, {}).items.find((e) => !before.has(e.id)) ?? null;
          if (!fresh) await page.waitForTimeout(100);
        }
        assert.ok(fresh, 'the + New record click made a row');
        assert.equal(weave.readEntity(fresh.id).raw[name], 4, 'the new row starts at the default');
        await page.keyboard.press('Escape');
        await page.waitForSelector(`tr[data-eid="${fresh.id}"] td[data-field="${name}"] .wv-rating`);
        assert.equal(await page.getAttribute(`tr[data-eid="${fresh.id}"] td[data-field="${name}"] .wv-rating`, 'aria-label'), '4 of 5', 'and the grid draws it');
      } finally {
        await page.close();
        for (const e of weave.query(vendors, {}).items) if (!before.has(e.id)) weave.deleteEntity(e.id);
        try { weave.deleteField(vendors, name); } catch {}
      }
    });
  }
}

if (s) {
  const { base, browser, weave } = s;
  let gauge;
  const open = async (tableId, colorScheme) => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, colorScheme });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row td[data-field="Brightness"] .wv-rating');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page;
  };
  const gaugeTable = () => {
    if (gauge) return gauge;
    gauge = weave.createTable({ space: 'Buy', name: 'Gauge' });
    weave.addField(gauge, { name: 'Effort', type: 'rating', config: { max: 3, icon: 'lucide:zap' } });
    weave.addField(gauge, { name: 'Fit', type: 'rating', config: { max: 5, icon: 'lucide:star' } });
    weave.addField(gauge, { name: 'Love', type: 'rating', config: { max: 7, icon: 'lucide:heart' } });
    weave.addField(gauge, { name: 'Brightness', type: 'rating', config: { max: 12, icon: 'lucide:sun' } });
    weave.createEntity(gauge, { name: 'g1', values: { Effort: 2, Fit: 4, Love: 7, Brightness: 9 } });
    return gauge;
  };
  const geometry = (page) => page.evaluate(() => {
    const td = document.querySelector('.wv-grid tbody tr.entity-row td[data-field="Love"]');
    const icons = td.querySelectorAll('.wv-rating > .wv-rate-ico');
    const cs = getComputedStyle(td);
    const ico = icons[0].getBoundingClientRect();
    return {
      icon: Math.round(ico.width),
      gap: Math.round(icons[1].getBoundingClientRect().left - ico.right),
      pad: ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0),
    };
  });
  const columns = (page) => page.evaluate(() => {
    const tr = document.querySelector('.wv-grid tbody tr.entity-row');
    return Object.fromEntries([...tr.querySelectorAll('td[data-field]')].flatMap((td) => {
      const box = td.querySelector('.wv-rating');
      if (!box || !box.querySelector('.wv-rate-ico')) return [];
      const cs = getComputedStyle(td);
      const pad = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0);
      const rect = td.getBoundingClientRect();
      const last = box.children[box.children.length - 1].getBoundingClientRect();
      return [[td.dataset.field, {
        width: Math.round(rect.width),
        icons: box.scrollWidth,
        room: Math.round(rect.width - pad),
        overhang: Math.round(last.right - (rect.right - (parseFloat(cs.paddingRight) || 0))),
      }]];
    }));
  });

  test('the cell icon geometry is the geometry the width is computed from', async () => {
    const page = await open(gaugeTable().id, 'light');
    try {
      const seen = await geometry(page);
      assert.deepEqual(seen, CR.RATING_METRICS,
        'public/style.css paints a different icon box, gap or cell padding than public/column-resize.js measures with');
    } finally { await page.close(); }
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`a rating column opens wide enough for every icon (${colorScheme}, Issue #404)`, async () => {
      const page = await open(gaugeTable().id, colorScheme);
      try {
        const cols = await columns(page);
        for (const [field, max] of [['Effort', 3], ['Fit', 5], ['Love', 7], ['Brightness', 12]]) {
          const c = cols[field];
          assert.ok(c, `${field} drew a rating`);
          assert.ok(c.icons <= c.room, `${field} (max ${max}): ${c.icons}px of icons in a ${c.room}px content box`);
          assert.ok(c.overhang <= 1, `${field} (max ${max}): the last icon hangs ${c.overhang}px past the cell's content edge`);
        }
        assert.equal(cols.Effort.width, 104, 'a short rating keeps the type default');
        assert.equal(cols.Fit.width, 104, 'five icons are what the 104px default was always for');
        assert.ok(cols.Love.width > cols.Fit.width, 'seven icons open wider than five');
        assert.ok(cols.Brightness.width > cols.Love.width, 'twelve wider still');
      } finally { await page.close(); }
    });
  }

  test('the right-most icon of a long rating can be clicked (Issue #404)', async () => {
    const page = await open(gaugeTable().id, 'light');
    try {
      const sel = 'tr.entity-row td[data-field="Brightness"]';
      await page.locator(`${sel} .wv-rate-ico[data-n="12"]`).click();
      await page.waitForFunction((s2) => document.querySelector(`${s2} .wv-rating`)?.getAttribute('aria-label') === '12 of 12', sel);
      assert.equal(await page.getAttribute(`${sel} .wv-rating`, 'aria-label'), '12 of 12');
    } finally { await page.close(); }
  });
}

if (s) {
  const { base, browser, weave } = s;
  test('the chip draws a rating as its icons (a segment keeps its rating through view-core)', async () => {
    weave.updateField(vendors, 'Chip', { config: { fields: ['Fit'] } });
    const deal = weave.createTable({ space: 'Buy', name: 'Order' });
    weave.addRelation(deal, { name: 'Vendor', targetDb: vendors, cardinality: 'many-to-one', inverseName: 'Orders' });
    weave.createEntity(deal, { name: 'o1', values: { Vendor: a.id } });
    const page = await browser.newPage({ viewport: { width: 1300, height: 500 } });
    try {
      await page.goto(`${base}/#/table/${deal.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.locator('td[data-field="Vendor"] .mention-wrap .mention-caret').first().click();
      await page.waitForSelector('td[data-field="Vendor"] .mention-f .wv-rating');
      assert.equal(await page.getAttribute('td[data-field="Vendor"] .mention-f .wv-rating', 'aria-label'), '3 of 5');
    } finally { await page.close(); }
  });
}
