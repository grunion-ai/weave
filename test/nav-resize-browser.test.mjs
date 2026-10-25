import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const s = await launch('nav resize', (weave) => {
  weave.createSpace({ name: 'Sales' });
  weave.createTable({ space: 'Sales', name: 'Deals' });
});
if (s) {
  const { base, browser } = s;
  const navWidth = (page) => page.evaluate(() => Math.round(document.querySelector('#sidebar').getBoundingClientRect().width));
  async function open(width = 1400) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => { localStorage.removeItem('weave-nav-width'); localStorage.removeItem('weave-nav-collapsed'); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#sidebar #nav', { state: 'attached' });
    return page;
  }
  async function drag(page, dx) {
    const box = await page.locator('#nav-resize').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y, { steps: 6 });
    await page.mouse.up();
  }

  test('the nav starts at 264px with a separator on its right edge (Issue #905)', async () => {
    const page = await open();
    assert.equal(await navWidth(page), 264);
    const grip = page.locator('#nav-resize');
    assert.ok(await grip.isVisible(), 'the handle shows on a desktop window');
    assert.equal(await grip.getAttribute('role'), 'separator');
    assert.equal(await grip.getAttribute('aria-orientation'), 'vertical');
    assert.equal(await grip.getAttribute('aria-valuemin'), '200');
    assert.equal(await grip.getAttribute('aria-valuemax'), '480');
    assert.equal(await grip.getAttribute('aria-valuenow'), '264');
    assert.equal(await grip.evaluate((n) => getComputedStyle(n).cursor), 'col-resize');
    const { edge, gripBox } = await page.evaluate(() => ({
      edge: document.querySelector('#sidebar').getBoundingClientRect().right,
      gripBox: document.querySelector('#nav-resize').getBoundingClientRect().toJSON(),
    }));
    assert.ok(gripBox.left <= edge && gripBox.right >= edge, `the handle straddles the nav edge ${edge}: ${gripBox.left}-${gripBox.right}`);
    await page.close();
  });

  test('dragging the handle widens the nav and the width survives a reload (Issue #905)', async () => {
    const page = await open();
    await drag(page, 100);
    const wide = await navWidth(page);
    assert.ok(Math.abs(wide - 364) <= 2, `the drag sets the width: ${wide}`);
    assert.equal(await page.locator('#nav-resize').getAttribute('aria-valuenow'), String(wide));
    const stored = await page.evaluate(() => Number(localStorage.getItem('weave-nav-width')));
    assert.equal(stored, wide, 'the width is stored');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#sidebar #nav');
    assert.equal(await navWidth(page), wide, 'the width survives a reload');
    await page.close();
  });

  test('the drag clamps between 200px and 480px (Issue #905)', async () => {
    const page = await open();
    await drag(page, 600);
    assert.equal(await navWidth(page), 480, 'an over-drag stops at 480px');
    await drag(page, -600);
    assert.equal(await navWidth(page), 200, 'an under-drag stops at 200px');
    assert.equal(await page.evaluate(() => localStorage.getItem('weave-nav-width')), '200');
    await page.close();
  });

  test('double-clicking the handle resets the nav to 264px (Issue #905)', async () => {
    const page = await open();
    await drag(page, 120);
    assert.notEqual(await navWidth(page), 264);
    await page.dblclick('#nav-resize');
    assert.equal(await navWidth(page), 264);
    assert.equal(await page.evaluate(() => localStorage.getItem('weave-nav-width')), null, 'the pin is forgotten');
    await page.close();
  });

  test('arrow keys on the handle nudge the width by 16px (Issue #905)', async () => {
    const page = await open();
    await page.focus('#nav-resize');
    await page.keyboard.press('ArrowRight');
    assert.equal(await navWidth(page), 280);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await navWidth(page), 248);
    assert.equal(await page.locator('#nav-resize').getAttribute('aria-valuenow'), '248');
    assert.equal(await page.evaluate(() => localStorage.getItem('weave-nav-width')), '248');
    await page.close();
  });

  test('the desktop peek panel opens at the dragged width (Issue #905)', async () => {
    const page = await open();
    await drag(page, 80);
    const wide = await navWidth(page);
    await page.click('#nav-collapse');
    await page.evaluate(() => document.querySelector('#app').classList.add('nav-peek'));
    assert.equal(await eventually(() => navWidth(page), wide), wide, "the peek uses the dragged width");
    await page.close();
  });

  test('the handle is absent while collapsed and below 900px (Issue #905)', async () => {
    const page = await open();
    await page.click('#nav-collapse');
    assert.equal(await page.locator('#nav-resize').isVisible(), false, 'no handle while collapsed');
    await page.click('#main .nav-menu');
    assert.equal(await page.locator('#nav-resize').isVisible(), true, 'the handle returns on expand');
    await page.setViewportSize({ width: 880, height: 900 });
    assert.equal(await page.locator('#nav-resize').isVisible(), false, 'no handle on a narrow window');
    await page.close();
  });

  test('a stored width leaves the narrow drawer at 264px (Issue #905)', async () => {
    const page = await open(880);
    await page.evaluate(() => localStorage.setItem('weave-nav-width', '420'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#sidebar #nav', { state: 'attached' });
    await page.evaluate(() => document.querySelector('#app').classList.add('nav-peek'));
    assert.equal(await eventually(() => navWidth(page), 264), 264, "the drawer keeps its own width");
    await page.close();
  });
}
