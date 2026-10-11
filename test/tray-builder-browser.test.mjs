import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let orders, order;
const s = await launch('tray builder', (weave) => {
  weave.createSpace({ name: 'Ops' });
  orders = weave.createTable({ space: 'Ops', name: 'Order' });
  weave.addField(orders, { name: 'Vendor', type: 'text' });
  weave.addField(orders, { name: 'Qty', type: 'number' });
  order = weave.createEntity(orders, { name: 'Sensor boards', values: { Vendor: 'Nordic', Qty: 12 } });
});

if (s) {
  const { base, browser } = s;
  const openTable = async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${orders.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid .add-field-btn');
    return page;
  };
  const openNewField = async (page) => {
    await page.click('.wv-grid .add-field-btn');
    await page.waitForSelector('#tray input');
  };
  const focusIsOpener = (page) => page.evaluate(() => document.activeElement?.classList.contains('add-field-btn'));

  test('Escape closes the New field tray and focus goes back to the + that opened it', async () => {
    const page = await openTable();
    try {
      await openNewField(page);
      assert.equal(await page.evaluate(() => document.querySelector('#tray').contains(document.activeElement)), true, 'focus starts inside the tray');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#tray-back', { state: 'detached' });
      assert.equal(await focusIsOpener(page), true, 'focus is back on the opener');
    } finally { await page.close(); }
  });

  for (const [how, act] of [
    ['Cancel', (page) => page.click('#tray .tray-actions .btn:not(.btn-primary)')],
    ['the close button', (page) => page.click('#tray .tray-close')],
    ['a click on the backdrop', (page) => page.mouse.click(20, 450)],
  ]) {
    test(`${how} closes the tray and returns focus to the opener`, async () => {
      const page = await openTable();
      try {
        await openNewField(page);
        await act(page);
        await page.waitForSelector('#tray-back', { state: 'detached' });
        assert.equal(await focusIsOpener(page), true);
      } finally { await page.close(); }
    });
  }

  test('the tray is a labelled dialog', async () => {
    const page = await openTable();
    try {
      await openNewField(page);
      const a11y = await page.evaluate(() => {
        const t = document.querySelector('#tray');
        return { role: t.getAttribute('role'), modal: t.getAttribute('aria-modal'), label: document.getElementById(t.getAttribute('aria-labelledby'))?.textContent };
      });
      assert.deepEqual(a11y, { role: 'dialog', modal: 'true', label: 'New field' });
    } finally { await page.close(); }
  });

  test('Escape in the tray belongs to the tray: the activity panel behind it stays open', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${base}/#/entity/${order.id}`, { waitUntil: 'networkidle' });
      await page.click('.activity-btn');
      await page.waitForSelector('.wv-activity');
      await page.click('.fieldrow[data-field="Vendor"] .fieldrow-label');
      await page.waitForSelector('#tray input');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#tray-back', { state: 'detached', timeout: 3000 });
      assert.equal(await page.locator('.wv-activity').count(), 1, 'the panel behind the tray did not take the Escape');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.wv-activity', { state: 'detached', timeout: 3000 });
    } finally { await page.close(); }
  });

  test('Escape with focus lost to the page still closes the tray', async () => {
    const page = await openTable();
    try {
      await openNewField(page);
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press('Escape');
      await page.waitForSelector('#tray-back', { state: 'detached', timeout: 3000 });
    } finally { await page.close(); }
  });

  test('an error the form already showed is not toasted again; any other is, and the tray stays open', async () => {
    const page = await openTable();
    try {
      await page.evaluate(() => {
        window.trayTried = 0;
        tray('New thing', [document.createElement('input')], async () => {
          window.trayTried++;
          throw Object.assign(new Error('said inline'), { shown: true });
        });
      });
      await page.click('#tray .tray-actions .btn-primary');
      await page.waitForFunction(() => window.trayTried === 1);
      await page.evaluate(() => toast('marker'));
      await page.waitForSelector('#wv-toasts .wv-toast:has-text("marker")');
      assert.equal(await page.locator('#wv-toasts .wv-toast', { hasText: 'said inline' }).count(), 0, 'shown errors are not toasted');
      assert.equal(await page.locator('#tray').count(), 1, 'the tray stays open');
      await page.evaluate(() => tray('New thing', [document.createElement('input')], async () => { throw new Error('server said no'); }));
      await page.click('#tray .tray-actions .btn-primary');
      await page.waitForSelector('#wv-toasts .wv-toast:has-text("server said no")');
      assert.equal(await page.locator('#tray').count(), 1, 'still open after a toasted error');
    } finally { await page.close(); }
  });

  test('New field still creates the field, and a refused name keeps the tray open with the error', async () => {
    const page = await openTable();
    try {
      await openNewField(page);
      await page.fill('#tray input', 'Qty');
      await page.click('#tray .tray-actions .btn-primary');
      await page.waitForSelector('#wv-toasts .wv-toast.err');
      assert.equal(await page.locator('#tray').count(), 1, 'a duplicate name keeps the tray open');
      await page.fill('#tray input', 'Supplier');
      await page.click('#tray .tray-actions .btn-primary');
      await page.waitForSelector('#tray-back', { state: 'detached' });
      await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid th.col-head')].some((t) => t.textContent.includes('Supplier')));
    } finally { await page.close(); }
  });

  test('on a phone the tray fills the screen from the right edge, safe-area aware', async () => {
    const page = await phonePage(await phoneBrowser());
    try {
      await page.goto(`${base}/#/table/${orders.id}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => tray('New field', [document.createElement('input')], async () => {}));
      await page.waitForSelector('#tray');
      await page.waitForFunction(() => document.querySelector('#tray').getAnimations().every((a) => a.playState === 'finished'));
      const box = await page.evaluate(() => {
        const t = document.querySelector('#tray');
        const r = t.getBoundingClientRect();
        const cs = getComputedStyle(t);
        return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, borderLeft: cs.borderLeftWidth, animation: cs.animationName };
      });
      assert.equal(box.w, box.vw, `full width (${box.w} of ${box.vw})`);
      assert.equal(box.x, 0);
      assert.equal(box.h, box.vh, 'full height');
      assert.equal(box.borderLeft, '0px', 'no edge line against the screen edge');
      assert.equal(box.animation, 'wv-tray-in', 'it slides in from the right');
      const css = await page.evaluate(() => [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } })
        .flatMap((r) => r.cssRules ? [...r.cssRules].map((c) => c.cssText) : [r.cssText]).filter((t) => /tray/.test(t)).join('\n'));
      assert.match(css, /\.tray-actions[^}]*safe-area-inset-bottom/, 'the action bar clears the home indicator');
      assert.match(css, /#tray[^}]*safe-area-inset-top/, 'the head clears the notch');
    } finally { await page.close(); }
  });
}
