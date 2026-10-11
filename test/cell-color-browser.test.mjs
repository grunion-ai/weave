import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, accounts, acme, big, small;
const s = await launch('cell colour setting', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  accounts = weave.createTable({ space: 'Sales', name: 'Account' });
  weave.addField(deals, { name: 'Delta', type: 'number' });
  for (const color of ['ink', 'icon', 'accent']) {
    weave.addField(deals, { name: `Bar ${color}`, type: 'number', config: { display: 'bar', color } });
    weave.addField(deals, { name: `Star ${color}`, type: 'rating', config: { max: 5, icon: 'lucide:star', color } });
  }
  weave.addField(deals, { name: 'Heart', type: 'rating', config: { max: 5, icon: 'lucide:heart', color: 'icon' } });
  weave.addField(deals, { name: 'Ring', type: 'number', config: { display: 'ring', scale: 10 } });
  weave.addField(deals, { name: 'Ten', type: 'rating', config: { max: 10, icon: 'lucide:zap' } });
  weave.addRelation(deals, { name: 'Account', targetDb: accounts, cardinality: 'many-to-one', inverseName: 'Deals' });
  weave.addField(accounts, { name: 'Deltas', type: 'lookup', config: { relationField: 'Deals', targetField: 'Delta' } });
  for (const color of ['ink', 'icon', 'accent']) {
    weave.addField(accounts, { name: `Line ${color}`, type: 'formula', config: { expression: '[Deltas]', display: 'sparkline', color } });
    weave.addField(accounts, { name: `WL ${color}`, type: 'formula', config: { expression: '[Deltas]', display: 'sparkline', style: 'winloss', color } });
  }
  weave.addField(accounts, { name: 'Avg fit', type: 'rollup', config: { relationField: 'Deals', targetField: 'Star icon', aggregate: 'avg' } });
  weave.addField(accounts, { name: 'Plain count', type: 'rollup', config: { relationField: 'Deals', aggregate: 'count' } });
  acme = weave.createEntity(accounts, { name: 'Acme' });
  const v = (n) => ({ 'Bar ink': n, 'Bar icon': n, 'Bar accent': n, 'Star ink': 4, 'Star icon': 4, 'Star accent': 4, Heart: 3, Ring: 7, Ten: 7, Account: acme.id });
  big = weave.createEntity(deals, { name: 'Big', values: { ...v(80), Delta: 5 } });
  small = weave.createEntity(deals, { name: 'Small', values: { ...v(20), Delta: -3, Ten: 2 } });
  weave.createEntity(deals, { name: 'Third', values: { ...v(50), Delta: 2 } });
});

if (s) {
  const { base, browser, weave } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  const cell = (id, field) => `tr[data-eid="${id}"] td[data-field="${field}"]`;
  const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  async function grid(tableId, colorScheme = 'light', width = 2600) {
    const page = await browser.newPage({ viewport: { width, height: 700 }, colorScheme });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await settle(page);
    return page;
  }
  async function openFieldDialog(page, field) {
    const th = page.locator('.wv-grid thead th.col-head', { hasText: field }).first();
    await th.scrollIntoViewIfNeeded();
    await th.hover();
    await th.locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Edit field' }).click();
    await page.waitForSelector('.tray-form');
  }
  const paint = (page, sel, prop) => page.$eval(sel, (n, p) => getComputedStyle(n)[p], prop);

  for (const colorScheme of ['light', 'dark']) {
    test(`each colour setting paints the bar, the rating and the sparkline in its own colours (${colorScheme})`, async () => {
      const page = await grid(deals.id, colorScheme);
      const acc = await grid(accounts.id, colorScheme);
      try {
        const ink = await page.$eval('body', (n) => getComputedStyle(n).color);
        const bar = {}, star = {}, line = {}, win = {}, loss = {};
        for (const c of ['ink', 'icon', 'accent']) {
          bar[c] = await paint(page, `${cell(big.id, `Bar ${c}`)} .cg-fill`, 'fill');
          star[c] = await paint(page, `${cell(big.id, `Star ${c}`)} .wv-rate-ico.on`, 'color');
          line[c] = await paint(acc, `${cell(acme.id, `Line ${c}`)} .cg-fill`, 'stroke');
          win[c] = await paint(acc, `${cell(acme.id, `WL ${c}`)} .cg-win`, 'fill');
          loss[c] = await paint(acc, `${cell(acme.id, `WL ${c}`)} .cg-loss`, 'fill');
          assert.ok(await page.locator(`${cell(big.id, `Bar ${c}`)} .cg-wrap.cg-c-${c}`).count(), `the bar wears cg-c-${c}`);
        }
        assert.equal(bar.ink, ink, 'an ink bar is the text colour');
        assert.equal(star.ink, ink, 'ink stars are filled in the text colour');
        assert.notEqual(line.ink, ink, 'an ink sparkline is the secondary text colour');
        assert.notEqual(win.ink, loss.ink, 'ink win/loss: text colour and muted');
        for (const set of [bar, star, line]) assert.equal(new Set(Object.values(set)).size, 3, JSON.stringify(set));
        const heart = await paint(page, `${cell(big.id, 'Heart')} .wv-rate-ico.on`, 'color');
        assert.notEqual(heart, star.icon, 'a heart is not a star\'s amber');
        assert.notEqual(win.icon, loss.icon);
        assert.equal(star.accent, bar.accent);
        assert.equal(line.accent, bar.accent);
        assert.equal(await paint(page, `${cell(big.id, 'Star ink')} .wv-rate-ico:not(.on) svg`, 'fill'), 'none');
        if (shots) await page.locator('.wv-grid').screenshot({ path: `${shots}/cell-color-grid-${colorScheme}.png` });
        if (shots) await acc.locator('.wv-grid').screenshot({ path: `${shots}/cell-color-spark-${colorScheme}.png` });
      } finally { await page.close(); await acc.close(); }
    });
  }

  test('the cells are the mockup shapes: a 6px bar on an 80px track, a 16px ring, 14px icons 1px apart, an 80 by 18 sparkline', async () => {
    const page = await grid(deals.id);
    try {
      const box = (sel) => page.$eval(sel, (n) => { const r = n.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
      assert.deepEqual(await box(`${cell(big.id, 'Bar ink')} svg.cg-bar`), [80, 6]);
      assert.deepEqual(await box(`${cell(big.id, 'Ring')} svg.cg-ring`), [16, 16]);
      const acc = await grid(accounts.id);
      assert.deepEqual(await acc.$eval(`${cell(acme.id, 'Line ink')} svg.cg-spark`, (n) => { const r = n.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }), [80, 18]);
      await acc.close();
      const icons = await page.$$eval(`${cell(big.id, 'Star ink')} .wv-rate-ico`, (ns) => ns.map((n) => n.getBoundingClientRect()));
      assert.equal(Math.round(icons[0].width), 14);
      assert.equal(Math.round(icons[1].left - icons[0].right), 1, 'a 1px gap');
      const [barR, textL] = await page.$eval(`${cell(big.id, 'Bar ink')} .cg-wrap`, (n) => [n.querySelector('svg').getBoundingClientRect().right, n.querySelector('.cg-text').getBoundingClientRect().left]);
      assert.ok(textL >= barR, 'the figure is to the right of the bar');
      assert.equal(await paint(page, `${cell(big.id, 'Bar ink')} .cg-wrap`, 'fontVariantNumeric'), 'tabular-nums');
    } finally { await page.close(); }
  });

  test('the Σ and ƒ marks stay in the header and leave the rich cells', async () => {
    const acc = await grid(accounts.id);
    try {
      await acc.waitForSelector(`${cell(acme.id, 'Line ink')} .cg-sparkwrap`);
      assert.equal(await acc.locator(`${cell(acme.id, 'Line ink')} .computed-mark`).count(), 0, 'no ƒ in a sparkline cell');
      assert.equal(await acc.locator('.wv-grid thead th.col-head', { hasText: 'Line ink' }).first().locator('.field-mark').count(), 1, 'the header keeps its ƒ');
      await acc.waitForSelector(`${cell(acme.id, 'Avg fit')} .wv-rating`);
      assert.equal(await acc.locator(`${cell(acme.id, 'Avg fit')} .computed-mark`).count(), 0, 'no Σ beside a rollup\'s stars');
      assert.equal(await acc.locator(`${cell(acme.id, 'Plain count')} .computed-mark`).count(), 0, 'a plain rollup leaves its Σ to the header too');
      assert.equal(await acc.locator('.wv-grid thead th.col-head', { hasText: 'Avg fit' }).first().locator('.field-mark').count(), 1);
    } finally { await acc.close(); }
  });

  test('a 10-icon rating opens without clipping; stored narrower it is raised to every icon; past the fit cap it draws the compact form (Issues #404, #614)', async () => {
    const iconsFit = (td) => {
      const r = td.querySelector('.wv-rating');
      const cs = getComputedStyle(td);
      const inner = td.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const last = [...r.querySelectorAll('.wv-rate-ico')].pop().getBoundingClientRect();
      return { need: r.scrollWidth, inner, lastRight: last.right, tdRight: td.getBoundingClientRect().right, clipped: td.classList.contains('clipped') };
    };
    const page = await grid(deals.id, 'light', 1400);
    try {
      const sel = `${cell(big.id, 'Ten')}`;
      await page.locator(sel).scrollIntoViewIfNeeded();
      const fit = await page.$eval(sel, iconsFit);
      assert.ok(fit.need <= fit.inner, `ten icons (${fit.need}px) fit the column (${fit.inner}px)`);
      assert.ok(fit.lastRight <= fit.tdRight, 'the tenth icon is inside the cell');
      assert.equal(fit.clipped, false);
      assert.equal(await page.locator(`${sel} .wv-rating-compact`).isVisible(), false, 'the full row, not the compact form');
      if (shots) await page.locator('.wv-grid').screenshot({ path: `${shots}/cell-color-ten-${'light'}.png` });
    } finally { await page.close(); }
    weave.updateField(deals, 'Ten', { config: { width: 90 } });
    const narrow = await grid(deals.id, 'light', 1400);
    try {
      const sel = `${cell(big.id, 'Ten')}`;
      await narrow.locator(sel).scrollIntoViewIfNeeded();
      const fit = await narrow.$eval(sel, iconsFit);
      assert.ok(fit.need <= fit.inner, `a stored 90px is raised: ten icons (${fit.need}px) fit the column (${fit.inner}px)`);
      assert.ok(fit.lastRight <= fit.tdRight, 'the tenth icon is inside the cell');
      assert.equal(await narrow.locator(`${sel} .wv-rating-compact`).isVisible(), false, 'the full row, not the compact form');
    } finally { await narrow.close(); }
    weave.updateField(deals, 'Ten', { config: { max: 24 } });
    const long = await grid(deals.id, 'light', 1400);
    try {
      const sel = `${cell(big.id, 'Ten')}`;
      await long.locator(sel).scrollIntoViewIfNeeded();
      await long.waitForSelector(`${sel} .wv-rating-compact`, { state: 'visible' });
      assert.equal(await long.textContent(`${sel} .wv-rating-n`), '7/24');
      assert.equal(await long.locator(`${sel} .wv-rate-ico`).first().isVisible(), false, 'no icon is cut off: the row gives way to the compact form');
      assert.equal(await long.getAttribute(`${sel} .wv-rating`, 'aria-label'), '7 of 24', 'a screen reader hears the same');
    } finally {
      await long.close();
      weave.updateField(deals, 'Ten', { config: { max: 10, width: null } });
    }
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the tray's Color picker draws three live swatches and saves the pick (${colorScheme})`, async () => {
      const page = await grid(deals.id, colorScheme, 1400);
      try {
        await openFieldDialog(page, 'Star ink');
        const color = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Color$/ }) });
        await color.waitFor();
        const opts = color.locator('.wv-color-opt');
        assert.equal(await opts.count(), 3);
        assert.deepEqual(await opts.evaluateAll((ns) => ns.map((n) => n.querySelector('.wv-color-label').textContent.trim())), ['Quiet ink', 'Color by icon', 'One accent hue']);
        for (const c of ['ink', 'icon', 'accent']) {
          assert.equal(await color.locator(`.wv-color-opt[data-color="${c}"] .wv-rating.cg-c-${c} .wv-rate-ico`).count(), 3, `the ${c} swatch is three of the field's stars`);
        }
        assert.equal(await color.locator('.wv-color-opt[aria-pressed="true"]').getAttribute('data-color'), 'ink');
        await color.locator('.wv-color-opt[data-color="accent"]').click();
        assert.equal(await color.locator('.wv-color-opt[aria-pressed="true"]').getAttribute('data-color'), 'accent');
        assert.ok(await page.locator('.tray-form .wv-rating-default .wv-rating.cg-c-accent').count(), 'the default picker wears the pick');
        if (shots) await page.locator('.tray-form').screenshot({ path: `${shots}/cell-color-tray-${colorScheme}.png` });
        await page.locator('.tray-form button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('.tray-form'));
        assert.equal(weave.getField(deals, 'Star ink').config.color, 'accent');
        await page.waitForSelector(`${cell(big.id, 'Star ink')} .wv-rating.cg-c-accent`);
      } finally {
        await page.close();
        weave.updateField(deals, 'Star ink', { config: { color: null } });
      }
    });
  }

  test("a number's Color picker redraws the Sample in the pick, and a sparkline's does too", async () => {
    let page = await grid(deals.id, 'light', 1400);
    try {
      await openFieldDialog(page, 'Bar ink');
      await page.waitForSelector('.tray-form .cg-preview .cg-wrap.cg-bar.cg-c-ink');
      const color = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Color$/ }) });
      assert.equal(await color.locator('.wv-color-opt .cg-wrap.cg-bar').count(), 3, 'each swatch is a bar');
      await color.locator('.wv-color-opt[data-color="icon"]').click();
      await page.waitForSelector('.tray-form .cg-preview .cg-wrap.cg-bar.cg-c-icon');
      await page.locator('.tray-form button[type="submit"]').click();
      await page.waitForFunction(() => !document.querySelector('.tray-form'));
      assert.equal(weave.getField(deals, 'Bar ink').config.color, 'icon');
      await page.close();
      page = await grid(accounts.id, 'light', 1400);
      await openFieldDialog(page, 'Line ink');
      const sc = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Color$/ }) });
      await sc.waitFor();
      await sc.locator('.wv-color-opt .cg-sparkwrap').nth(2).waitFor();
      assert.equal(await sc.locator('.wv-color-opt .cg-sparkwrap').count(), 3, 'each swatch is a sparkline');
      await sc.locator('.wv-color-opt[data-color="accent"]').click();
      await page.waitForSelector('.tray-form .cg-spark-preview .cg-sparkwrap.cg-c-accent');
    } finally {
      await page.close();
      weave.updateField(deals, 'Bar ink', { config: { color: null } });
    }
  });
}
