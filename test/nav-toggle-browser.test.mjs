import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('nav toggle', (weave) => {
  weave.createSpace({ name: 'Sales' });
  weave.createTable({ space: 'Sales', name: 'Deals' });
});
if (s) {
  const { base, browser } = s;
  async function open(theme = 'light') {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => { localStorage.removeItem('weave-nav-collapsed'); localStorage.removeItem('weave-nav-width'); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('#nav-collapse');
    return page;
  }
  const box = (page, sel) => page.evaluate((q) => {
    const r = document.querySelector(q).getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, sel);
  const panelLeft = (page, sel) => page.evaluate((q) => {
    const svg = document.querySelector(`${q} svg`);
    if (!svg) return null;
    const rect = svg.querySelector('rect');
    const path = svg.querySelector('path');
    return {
      viewBox: svg.getAttribute('viewBox'),
      rect: rect && ['x', 'y', 'width', 'height', 'rx'].map((k) => rect.getAttribute(k)).join(' '),
      path: path?.getAttribute('d'),
      stroke: svg.getAttribute('stroke'),
    };
  }, sel);
  const PANEL_LEFT = { viewBox: '0 0 24 24', rect: '3 3 18 18 2', path: 'M9 3v18', stroke: 'currentColor' };

  test('both nav toggles draw the lucide panel-left icon and name their action (Issue #906)', async () => {
    const page = await open();
    assert.deepEqual(await panelLeft(page, '#nav-collapse'), PANEL_LEFT, 'the hide button draws panel-left');
    assert.deepEqual(await panelLeft(page, '#nav-expand'), PANEL_LEFT, 'the show button draws panel-left');
    assert.equal(await page.getAttribute('#nav-collapse', 'title'), 'Hide sidebar');
    assert.equal(await page.getAttribute('#nav-expand', 'title'), 'Show sidebar');
    assert.equal((await page.locator('#nav-collapse').textContent()).trim(), '', 'no arrow glyph left behind');
    assert.equal((await page.locator('#nav-expand').textContent()).trim(), '', 'no arrow glyph left behind');
    await page.close();
  });

  test('the toggle sits in one spot whether the nav is open or collapsed (Issue #906)', async () => {
    const page = await open();
    const opened = await box(page, '#nav-collapse');
    await page.click('#nav-collapse');
    await page.waitForSelector('#nav-expand:not(.hidden)');
    const collapsed = await box(page, '#nav-expand');
    assert.deepEqual(collapsed, opened, 'show sits exactly where hide was');
    await page.click('#nav-expand');
    await page.waitForSelector('#nav-expand.hidden', { state: 'attached' });
    assert.deepEqual(await box(page, '#nav-collapse'), opened, 'and hide comes back to the same spot');
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`the toggle is a soft borderless 28px square in the top-left corner (Issue #906, ${theme})`, async () => {
      const page = await open(theme);
      for (const sel of ['#nav-collapse', '#nav-expand']) {
        if (sel === '#nav-expand') {
          await page.click('#nav-collapse');
          await page.waitForSelector('#nav-expand:not(.hidden)');
        }
        const b = await box(page, sel);
        assert.equal(b.w, 28, `${sel} is 28px wide`);
        assert.equal(b.h, 28, `${sel} is 28px tall`);
        assert.ok(b.x < 120 && b.y < 30, `${sel} sits top-left: ${b.x},${b.y}`);
        const look = await page.evaluate((q) => {
          const cs = getComputedStyle(document.querySelector(q));
          return { radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, bg: cs.backgroundColor };
        }, sel);
        assert.equal(look.radius, '6px', `${sel} has 6px corners`);
        assert.equal(look.border, '0px', `${sel} has no border`);
        assert.notEqual(look.bg, 'rgba(0, 0, 0, 0)', `${sel} sits on a soft fill`);
      }
      await page.close();
    });
  }

  test('the collapsed page never slides under the show button (Issue #906)', async () => {
    const page = await open();
    await page.click('#nav-collapse');
    await page.waitForSelector('#nav-expand:not(.hidden)');
    const btn = await box(page, '#nav-expand');
    const main = await box(page, '#main');
    assert.ok(btn.x + btn.w <= main.x, `the button (${btn.x}+${btn.w}) stays left of the page (${main.x})`);
    await page.close();
  });

  test('resizing the nav leaves the toggle where it was (Issues #905, #906)', async () => {
    const page = await open();
    const before = await box(page, '#nav-collapse');
    const grip = await box(page, '#nav-resize');
    const y = grip.y + grip.h / 2;
    await page.mouse.move(grip.x + grip.w / 2, y);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.w / 2 + 100, y, { steps: 5 });
    await page.mouse.up();
    assert.ok(await page.evaluate(() => document.querySelector('#sidebar').getBoundingClientRect().width) > 300, 'the drag widened the nav');
    assert.deepEqual(await box(page, '#nav-collapse'), before, 'the hide button did not move');
    await page.click('#nav-collapse');
    await page.waitForSelector('#nav-expand:not(.hidden)');
    assert.deepEqual(await box(page, '#nav-expand'), before, 'nor does the show button');
    await page.close();
  });
}
