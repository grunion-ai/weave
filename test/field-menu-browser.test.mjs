import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, styleOf } from './lib/browser.mjs';

let tasks;
const s = await launch('field menu', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2'] } });
  weave.addField(tasks, { name: 'Estimate', type: 'number' });
  for (const [name, p] of [['Echo', 'P2'], ['Delta', 'P0'], ['Charlie', 'P1']]) {
    weave.createEntity(tasks, { name, values: { Priority: p } });
  }
});
if (s) {
  const { base, browser, weave } = s;

  async function grid() {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }

  async function openMenu(page, column = 'Priority') {
    const th = page.locator('.wv-grid thead th.col-head', { hasText: column }).first();
    await th.hover();
    await th.locator('.field-menu').click();
    await page.waitForSelector('.chip-pop .wv-menu-row');
    await page.locator('.chip-pop').evaluate((p) => Promise.all(p.getAnimations().map((a) => a.finished)));
    return page.locator('.chip-pop');
  }

  const setTheme = (page, want) => page.evaluate((w) => {
    const btn = document.querySelector('#theme-toggle');
    for (let i = 0; i < 4 && document.documentElement.dataset.bsTheme !== w; i++) btn.click();
  }, want);

  const rowMetrics = (page) => page.evaluate(() => {
    const round = (n) => Math.round(n * 10) / 10;
    return [...document.querySelectorAll('.chip-pop .wv-menu-row')].map((row) => {
      const label = row.querySelector('.wv-menu-label, .hold-label');
      const icon = row.querySelector('.wv-menu-icon');
      const svg = icon?.querySelector('svg');
      const cs = getComputedStyle(row);
      const ib = icon?.getBoundingClientRect();
      const sb = svg?.getBoundingClientRect();
      return {
        text: label?.textContent?.trim() ?? row.textContent.trim(),
        labelLeft: round(label.getBoundingClientRect().left),
        height: round(row.getBoundingClientRect().height),
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        fontSize: cs.fontSize,
        iconBox: ib ? [round(ib.width), round(ib.height)] : null,
        svgBox: sb ? [round(sb.width), round(sb.height)] : null,
        drawn: !!svg,
      };
    });
  });

  test('one panel, one left edge — every label starts at the same x', async () => {
    const page = await grid();
    try {
      await openMenu(page);
      const rows = await rowMetrics(page);
      assert.ok(rows.length >= 5, `expected the full menu, got ${rows.length} rows`);
      const lefts = new Set(rows.map((r) => r.labelLeft));
      assert.equal(lefts.size, 1,
        `labels must share one left edge, found ${[...lefts].join(', ')} — ${rows.map((r) => r.text).join(' | ')}`);
      const boxes = new Set(rows.map((r) => r.padding + '/' + r.fontSize));
      assert.equal(boxes.size, 1, `one row metric for every row, found: ${[...boxes].join(' AND ')}`);
      const heights = rows.map((r) => r.height);
      assert.ok(Math.max(...heights) - Math.min(...heights) < 0.6,
        `rows must be the same height, got ${heights.join(', ')}`);
    } finally { await page.close(); }
  });

  test('every mark in the menu is drawn, at the one icon scale', async () => {
    const page = await grid();
    try {
      await openMenu(page);
      const rows = await rowMetrics(page);
      for (const r of rows) {
        assert.ok(r.drawn, `"${r.text}" must draw an svg, not type a character`);
        assert.deepEqual(r.iconBox, [16, 16], `"${r.text}" icon box is off the scale`);
        assert.deepEqual(r.svgBox, [16, 16], `"${r.text}" svg is off the scale`);
      }
    } finally { await page.close(); }
  });

  test('the panel says which column it belongs to', async () => {
    const page = await grid();
    try {
      const pop = await openMenu(page, 'Priority');
      assert.equal((await pop.locator('.wv-menu-title').textContent()).trim(), 'Priority');
      assert.equal((await pop.locator('.wv-menu-kind').textContent()).trim(), 'select');
      const headBottom = (await pop.locator('.wv-menu-head').boundingBox()).y;
      const firstRow = (await pop.locator('.wv-menu-row').first().boundingBox()).y;
      assert.ok(headBottom < firstRow, 'the title opens the panel');
    } finally { await page.close(); }
  });

  test('the arrow walk reaches the delete row', async () => {
    const page = await grid();
    try {
      await openMenu(page);
      const seen = [];
      for (let i = 0; i < 8; i++) {
        seen.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
        await page.keyboard.press('ArrowDown');
      }
      assert.ok(seen.some((t) => /Delete field/.test(t)),
        `↑↓ never landed on the delete row — visited: ${seen.join(' → ')}`);
    } finally { await page.close(); }
  });

  test('a live sort is the popover check, and the menu opens on it', async () => {
    const page = await grid();
    try {
      const sortRow = (pop, label) => pop.locator('.wv-menu-row').filter({ has: page.getByText(label, { exact: true }) });
      let pop = await openMenu(page);
      await sortRow(pop, 'Option order').click();
      await page.waitForTimeout(250);
      pop = await openMenu(page);
      const asc = sortRow(pop, 'Option order');
      assert.equal(await asc.locator('.chip-pop-check').count(), 1, 'the live sort wears the check');
      assert.equal(await sortRow(pop, 'Reverse option order')
        .locator('.chip-pop-check').count(), 0, 'and only it does');
      assert.equal((await asc.locator('.wv-menu-label').textContent()).trim(), 'Option order');
      assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ''), /^Option order/);
      assert.equal(await pop.locator('.wv-menu-row', { hasText: 'Clear sort' }).count(), 1);
    } finally { await page.close(); }
  });

  const hasField = (name) =>
    Object.values(weave.getTable(tasks.id).fields).some((f) => f.name === name);

  const hold = async (page, locator, ms) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  };

  test('the hold still gates the delete, and says so before it is pressed', async () => {
    const page = await grid();
    try {
      const pop = await openMenu(page, 'Estimate');
      const del = pop.locator('.wv-menu-row.wv-menu-danger');
      assert.equal((await del.locator('.hold-hint').textContent()).trim().toLowerCase(), 'hold',
        'the row advertises its gesture at rest');

      await hold(page, del, 200);
      await page.waitForTimeout(350);
      assert.ok(hasField('Estimate'), 'a cancelled hold must delete nothing');

      const box = await del.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      const fillA = () => { const f = document.querySelector('.hold-btn.holding .hold-fill'); return f ? new DOMMatrixReadOnly(getComputedStyle(f).transform).a : null; };
      await page.waitForFunction(`(${fillA})() > 0.15`, null, { polling: 'raf', timeout: 10000 }).catch(() => {});
      const mid = await page.evaluate(fillA);
      assert.ok(mid > 0.15 && mid < 0.95, `the fill must be part-swept mid-hold, was ${mid}`);
      assert.equal(await styleOf(del.locator('.hold-hint'), 'opacity', '0'), '0',
        'and the hint gets out of the way once the press starts');
      await page.waitForSelector('.hold-btn.holding', { state: 'detached', timeout: 10000 }).catch(() => {});
      await page.mouse.up();

      assert.equal(await eventually(() => hasField('Estimate'), false), false, 'a completed hold deletes the field');
    } finally { await page.close(); }
  });

  test('the panel holds its shape in both themes', async () => {
    const page = await grid();
    try {
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await openMenu(page, 'Priority');
        const rows = await rowMetrics(page);
        assert.equal(new Set(rows.map((r) => r.labelLeft)).size, 1, `${theme}: one left edge`);
        const paint = await page.evaluate(() => {
          const lum = (c) => {
            const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((n) => {
              const v = Number(n) / 255;
              return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const pop = document.querySelector('.chip-pop');
          const danger = pop.querySelector('.wv-menu-danger');
          const normal = pop.querySelector('.wv-menu-row:not(.wv-menu-danger)');
          const bg = (n) => {
            for (let e = n; e; e = e.parentElement) {
              const c = getComputedStyle(e).backgroundColor;
              if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
            }
            return 'rgb(255, 255, 255)';
          };
          return {
            panelLum: lum(bg(pop)),
            dangerLum: lum(getComputedStyle(danger).color),
            normalLum: lum(getComputedStyle(normal).color),
            fill: getComputedStyle(pop.querySelector('.hold-fill')).backgroundImage,
          };
        });
        assert.ok(theme === 'light' ? paint.panelLum > 0.5 : paint.panelLum < 0.5,
          `${theme}: the panel paints the wrong way (luminance ${paint.panelLum.toFixed(3)})`);
        assert.ok(Math.abs(paint.dangerLum - paint.normalLum) > 0.02,
          `${theme}: the destructive row does not read as destructive`);
        assert.match(paint.fill, /gradient/, `${theme}: the sweep keeps its leading edge`);
        await page.keyboard.press('Escape');
      }
    } finally { await page.close(); }
  });
}
