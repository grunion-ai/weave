import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf, settled, eventually } from './lib/browser.mjs';

const s = await launch('nav toggle', (weave) => {
  weave.createSpace({ name: 'Sales' });
  weave.createTable({ space: 'Sales', name: 'Deals' });
});
if (s) {
  const { base, browser } = s;
  const SHOW = '#main .crumb-row > .nav-menu';
  async function open(theme = 'light') {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => { localStorage.removeItem('weave-nav-collapsed'); localStorage.removeItem('weave-nav-width'); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('#nav-collapse');
    await page.waitForSelector(SHOW, { state: 'attached' });
    return page;
  }
  async function hide(page) {
    await page.click('#nav-collapse');
    await page.waitForSelector('#app.nav-collapsed');
    assert.equal(await styleOf(page.locator(SHOW), 'width', '28px'), '28px', 'the show button finishes sliding in');
  }
  const box = (page, sel) => page.evaluate((q) => {
    const r = document.querySelector(q).getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, sel);
  const seen = (page, sel) => page.evaluate((q) => {
    const n = document.querySelector(q);
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden';
  }, sel);
  const panelLeft = (page, sel) => page.evaluate((q) => {
    const svg = [...document.querySelectorAll(`${q} svg`)].find((n) => getComputedStyle(n).display !== 'none');
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

  test('hide and show both draw the lucide panel-left icon and name their action (Issues #906, #927)', async () => {
    const page = await open();
    assert.deepEqual(await panelLeft(page, '#nav-collapse'), PANEL_LEFT, 'the hide button draws panel-left');
    await hide(page);
    assert.deepEqual(await panelLeft(page, SHOW), PANEL_LEFT, 'the show button draws panel-left');
    assert.equal(await page.getAttribute('#nav-collapse', 'title'), 'Hide sidebar');
    assert.equal(await page.getAttribute(SHOW, 'title'), 'Show sidebar');
    assert.equal(await page.getAttribute(SHOW, 'aria-label'), 'Show sidebar');
    assert.equal(await page.locator('#nav-expand').count(), 0, 'the floating show button is gone');
    await page.close();
  });

  test('the hide button sits after the workspace name, as in Fibery (Issue #927)', async () => {
    const page = await open();
    const name = await box(page, '#ws-name');
    const hideBtn = await box(page, '#nav-collapse');
    assert.ok(hideBtn.x >= name.x + name.w, `hide (${hideBtn.x}) sits right of the name (${name.x}+${name.w})`);
    assert.ok(Math.abs((hideBtn.y + hideBtn.h / 2) - (name.y + name.h / 2)) <= 2, 'and shares its centreline');
    await page.close();
  });

  test('hiding the nav hides the workspace switcher too and the page sits flush (Issue #927)', async () => {
    const page = await open();
    await hide(page);
    assert.equal(await seen(page, '#ws-rail'), false, 'the workspace rail hides with the nav');
    assert.equal(await seen(page, '#sidebar'), false, 'the nav hides');
    const main = await box(page, '#main');
    const right = await page.evaluate(() => innerWidth - Math.round(document.querySelector('#main').getBoundingClientRect().right));
    assert.equal(main.x, right, `the page keeps an even gutter: left ${main.x}, right ${right}`);
    await page.close();
  });

  test('the show button slides in ahead of the workspace icon and name (Issue #927)', async () => {
    const page = await open();
    assert.equal(await seen(page, SHOW), false, 'no show button while the nav is open');
    const row = await box(page, '#main .crumb-row');
    const wsOpen = await box(page, '#main .crumb-k-ws');
    assert.ok(wsOpen.x - row.x <= 1, `the workspace crumb leads the row while the nav is open (${wsOpen.x} vs ${row.x})`);
    const motion = await page.evaluate((q) => getComputedStyle(document.querySelector(q)).transitionProperty, SHOW);
    assert.match(motion, /width/, 'the button grows in, so the crumbs slide rather than jump');
    await hide(page);
    const btn = await box(page, SHOW);
    const ws = await box(page, '#main .crumb-k-ws');
    assert.ok(btn.x - row.x <= 1, 'the show button takes the head of the row');
    assert.ok(ws.x >= btn.x + btn.w + 4, `the workspace crumb moved over (${ws.x}) to make room for the button (${btn.x}+${btn.w})`);
    assert.ok(await page.locator('#main .crumb-k-ws .crumb-ic').count(), 'the crumb keeps the workspace icon');
    assert.ok((await page.locator('#main .crumb-k-ws').textContent()).trim().length, 'and the workspace name');
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`both toggles are soft borderless 28px squares at the top of the page (Issue #906, ${theme})`, async () => {
      const page = await open(theme);
      for (const sel of ['#nav-collapse', SHOW]) {
        if (sel === SHOW) await hide(page);
        const b = await box(page, sel);
        assert.equal(b.w, 28, `${sel} is 28px wide`);
        assert.equal(b.h, 28, `${sel} is 28px tall`);
        assert.ok(b.y < 60, `${sel} sits at the top: ${b.y}`);
        const look = await page.evaluate((q) => {
          const cs = getComputedStyle(document.querySelector(q));
          return { radius: cs.borderTopLeftRadius, border: cs.borderTopWidth, bg: cs.backgroundColor };
        }, sel);
        assert.equal(look.radius, '6px', `${sel} has 6px corners`);
        assert.equal(look.border, '0px', `${sel} has no border`);
        assert.notEqual(look.bg, 'rgba(0, 0, 0, 0)', `${sel} sits on a soft fill`);
      }
      assert.ok((await box(page, SHOW)).x < 60, 'the show button sits in the top-left corner');
      await page.close();
    });
  }

  test('show brings the rail and the nav back and remembers it (Issue #927)', async () => {
    const page = await open();
    await hide(page);
    assert.equal(await page.evaluate(() => localStorage.getItem('weave-nav-collapsed')), '1');
    await page.click(SHOW);
    await page.waitForSelector('#app:not(.nav-collapsed)');
    assert.equal(await seen(page, '#ws-rail'), true, 'the rail is back');
    assert.equal(await seen(page, '#sidebar'), true, 'the nav is back');
    assert.equal(await page.evaluate(() => localStorage.getItem('weave-nav-collapsed')), '');
    await page.close();
  });

  test('resting on the left edge peeks the rail and the nav together (Issues #77, #927)', async () => {
    const page = await open();
    await hide(page);
    await page.mouse.move(700, 400);
    await page.mouse.move(4, 400);
    await page.waitForSelector('#app.nav-peek');
    assert.equal(await seen(page, '#ws-rail'), true, 'the rail rides along in the peek');
    assert.equal(await seen(page, '#sidebar'), true, 'the nav peeks');
    await settled(page.locator('#ws-rail'));
    await settled(page.locator('#sidebar'));
    const rail = await box(page, '#ws-rail');
    const nav = await box(page, '#sidebar');
    assert.equal(rail.x, 0, 'the rail peeks from the window edge');
    assert.equal(nav.x, rail.x + rail.w, 'the nav sits beside the rail');
    await page.mouse.move(rail.w / 2, 300);
    assert.ok(await page.locator('#app.nav-peek').count(), 'moving onto the rail keeps the peek open');
    await page.mouse.move(1000, 400);
    await page.waitForSelector('#app:not(.nav-peek)');
    await page.close();
  });

  test('resizing the nav carries the hide button with its edge and leaves the show button put (Issues #905, #927)', async () => {
    const page = await open();
    const before = await box(page, '#nav-collapse');
    const edge = await box(page, '#sidebar');
    const grip = await box(page, '#nav-resize');
    const y = grip.y + grip.h / 2;
    await page.mouse.move(grip.x + grip.w / 2, y);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.w / 2 + 100, y, { steps: 5 });
    await page.mouse.up();
    const wider = await box(page, '#sidebar');
    assert.ok(wider.w > 300, 'the drag widened the nav');
    const after = await box(page, '#nav-collapse');
    assert.equal(after.y, before.y, 'the hide button stays on its line');
    assert.equal((wider.x + wider.w) - (after.x + after.w), (edge.x + edge.w) - (before.x + before.w), 'and keeps its inset from the nav edge');
    await hide(page);
    const shown = await box(page, SHOW);
    await page.click(SHOW);
    await page.waitForSelector('#app:not(.nav-collapsed)');
    await page.evaluate(() => { localStorage.removeItem('weave-nav-width'); });
    await page.reload({ waitUntil: 'networkidle' });
    await hide(page);
    assert.deepEqual(await eventually(() => box(page, SHOW), shown), shown, 'the show button does not depend on the nav width');
    await page.close();
  });
}
