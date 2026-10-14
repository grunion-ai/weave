import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage, settled, eventually } from './lib/browser.mjs';

const LANDSCAPE = { viewport: { width: 852, height: 393 }, isLandscape: true };
const MIN = 24;
const COL = 'Name';
const HAIRLINE = 6;
let n = 0;

const s = await launch('phone column resize', (weave) => {
  weave.createSpace({ name: 'Wide' });
});
if (s) {
  const { base, browser, weave } = s;
  const ownTable = () => {
    const db = weave.createTable({ space: 'Wide', name: `Wide ${++n}` });
    for (const name of ['Owner', 'Stage', 'Note']) weave.addField(db, { name, type: 'text' });
    for (let i = 0; i < 4; i += 1) weave.createEntity(db, { name: `Row ${i}`, values: { Owner: 'Sam', Stage: 'Open', Note: 'n' } });
    return db;
  };
  const ready = async (page, db) => {
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid thead th.col-head .col-resize');
    await settled(page.locator('.wv-grid'));
    await page.evaluate(() => { const w = document.querySelector('.table-wrap'); if (w) w.scrollLeft = 0; });
    return page;
  };
  const phone = async (db, theme = 'light') => {
    const page = await phonePage(await phoneBrowser(), LANDSCAPE);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    return ready(page, db);
  };
  const desktop = async (db, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    return ready(page, db);
  };
  const head = (page, name) => page.locator(`.wv-grid thead th.col-head[data-col="${name}"]`);
  const hitAt = (page, x, y) => page.evaluate(([px, py]) => {
    const n = document.elementFromPoint(px, py);
    if (!n) return 'none';
    const own = n.closest('.col-resize') ? 'col-resize' : n.closest('.field-menu') ? 'field-menu' : n.closest('th.col-head') ? 'header' : null;
    return own ?? `${n.tagName.toLowerCase()}.${String(n.getAttribute?.('class') ?? '')}`;
  }, [x, y]);

  test('a column resize target is wide enough for a finger on a phone (Issue #807)', async () => {
    const page = await phone(ownTable());
    const box = await head(page, COL).locator('.col-resize').boundingBox();
    assert.ok(Math.round(box.width) >= MIN, `the resize target is ${Math.round(box.width)}px wide, under the ${MIN}px a finger needs`);
    const y = box.y + box.height / 2;
    for (const inset of [3, 12, 20]) {
      assert.equal(await hitAt(page, box.x + box.width - inset, y), 'col-resize',
        `a touch ${inset}px inside the column edge lands on the resize target`);
    }
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`the widened target still draws a hairline, not a band (${theme}, Issue #807)`, async () => {
      const page = await phone(ownTable(), theme);
      const paint = await head(page, COL).locator('.col-resize').evaluate((n) => ({
        own: getComputedStyle(n).backgroundColor,
        line: getComputedStyle(n, '::after').width,
      }));
      assert.match(paint.own, /rgba\(0, 0, 0, 0\)|transparent/, `the widened box paints nothing itself, got ${paint.own}`);
      assert.equal(paint.line, `${HAIRLINE}px`, `the painted line stays a ${HAIRLINE}px hairline, got ${paint.line}`);
      await page.close();
    });
  }

  test('the wider target leaves the header its own drag and tap area (Issue #807)', async () => {
    const page = await phone(ownTable());
    const th = await head(page, COL).boundingBox();
    const strip = await head(page, COL).locator('.col-resize').boundingBox();
    assert.ok(strip.width <= th.width * 0.4 + 0.5,
      `the target takes ${Math.round(strip.width)}px of a ${Math.round(th.width)}px header, over two fifths of it`);
    assert.equal(await hitAt(page, th.x + th.width / 2, th.y + th.height / 2), 'header',
      'the middle of the header still belongs to the header, which is what a long press drags and a tap edits');
    await page.close();
  });

  test('a finger drag on the wider target resizes the column (Issue #807)', async () => {
    const db = ownTable();
    const page = await phone(db);
    const width = () => head(page, COL).evaluate((n) => Math.round(n.getBoundingClientRect().width));
    const before = await width();
    const box = await head(page, COL).locator('.col-resize').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 12, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 12 + 40, y, { steps: 8 });
    assert.equal(await page.evaluate(() => document.body.classList.contains('wv-col-resizing')), true,
      'the drag is a column resize, not a column move');
    await page.mouse.up();
    await settled(page.locator('.wv-grid'));
    assert.equal(await eventually(width, before + 40), before + 40, `the column grew with the finger, ${before} to ${await width()}`);
    assert.equal(await eventually(() => weave.tableView(db.id).views[0].widths?.[COL] ?? null, before + 40), before + 40,
      'and the view stored the new width');
    await page.close();
  });

  test('the wider target adds no sideways scroll at phone width (Issue #807)', async () => {
    const page = await phone(ownTable());
    const spill = await page.evaluate(() => {
      const wrap = document.querySelector('.table-wrap');
      const grid = document.querySelector('.wv-grid').getBoundingClientRect();
      const last = [...document.querySelectorAll('.wv-grid thead th .col-resize')].pop().getBoundingClientRect();
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        past: Math.round(last.right - grid.right),
        wrapPast: Math.round(last.right - wrap.getBoundingClientRect().right - wrap.scrollWidth + wrap.clientWidth + wrap.scrollLeft),
      };
    });
    assert.equal(spill.page, 0, `the page gains no horizontal scroll, got ${spill.page}px`);
    assert.ok(spill.past <= 0, `the last column target stays inside the grid, it overhangs by ${spill.past}px`);
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`a desktop pointer keeps the 6px strip and its hover paint (${theme}, Issue #807)`, async () => {
      const page = await desktop(ownTable(), theme);
      const grip = head(page, COL).locator('.col-resize');
      const box = await grip.boundingBox();
      assert.equal(Math.round(box.width), HAIRLINE, `the desktop strip stays ${HAIRLINE}px, got ${Math.round(box.width)}px`);
      const paintOf = () => grip.evaluate((n) => getComputedStyle(n, '::after').backgroundColor);
      const rest = await paintOf();
      await head(page, COL).hover();
      assert.equal(await eventually(async () => (await paintOf()) !== rest, true), true,
        `hovering a header still shows where the edge is, it stayed ${rest}`);
      assert.doesNotMatch(await paintOf(), /rgba\(0, 0, 0, 0\)/, 'the hovered edge paints a colour');
      await page.close();
    });
  }
}
