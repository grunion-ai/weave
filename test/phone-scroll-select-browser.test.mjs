import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('phone list scrolls without selecting', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Fixed', category: 'done' }] } });
  for (let i = 0; i < 30; i++) weave.createEntity(issues, { name: `Issue ${i}: a name long enough to wrap onto a second line on a phone`, values: { Status: 'Open' } });
  return { table: `#/table/${issues.id}` };
});

const drag = (page, dy, { click = false } = {}) => page.evaluate(([dy, click]) => {
  const row = document.querySelectorAll('#main tbody tr.entity-row')[2];
  const r = row.querySelector('.list-name').getBoundingClientRect();
  const x = r.left + 30, y0 = r.top + 8;
  const fire = (type, y) => document.elementFromPoint(x, Math.max(1, Math.min(innerHeight - 1, y)))?.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true, pointerId: 31, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y }));
  row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true, pointerId: 31, button: 0, buttons: 1, clientX: x, clientY: y0 }));
  for (let k = 1; k <= 10; k++) fire('pointermove', y0 + (dy * k) / 10);
  fire('pointerup', y0 + dy);
  if (click) document.elementFromPoint(x, y0 + dy)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y0 + dy }));
}, [dy, click]);

const state = (page) => page.evaluate(() => ({
  theme: document.documentElement.dataset.bsTheme,
  text: String(getSelection()),
  chosen: document.querySelectorAll('#main .sel-box:checked, #main tr.row-selected, #main tr[aria-selected="true"]').length,
  docked: location.href.includes('?e='),
  userSelect: getComputedStyle(document.querySelector('#main tbody tr.entity-row')).webkitUserSelect || getComputedStyle(document.querySelector('#main tbody tr.entity-row')).userSelect,
}));

if (s) {
  const { base, browser, table } = s;
  const engines = [['chromium 390x844 touch', browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const open = async (b, profile, theme) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${table}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main tbody tr.entity-row .list-name');
    return page;
  };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone a 200px touch drag down the list selects nothing and opens nothing, and a tap still opens the row (${engine}, ${theme}, Issue #738)`, async () => {
        const page = await open(b, profile, theme);
        try {
          await drag(page, 200);
          await drag(page, 120, { click: true });
          await page.waitForTimeout(150);
          const seen = await state(page);
          assert.equal(seen.theme, theme);
          assert.equal(seen.userSelect, 'none', 'a list row never starts a text selection under the finger');
          assert.equal(seen.text, '', 'no text is selected');
          assert.equal(seen.chosen, 0, 'no row is selected');
          assert.equal(seen.docked, false, 'a drag is a scroll: no row opens, even if a click follows it');
          await page.waitForTimeout(700);
          const name = await page.locator('#main tbody tr.entity-row').nth(1).locator('.list-name').boundingBox();
          await page.touchscreen.tap(name.x + 20, name.y + 8);
          await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
          assert.ok(page.url().includes('?e='), 'a tap opens the row');
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop the grid keeps text selection in its cells (Issue #738)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 844 } });
    try {
      await page.goto(`${base}/${table}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main tbody tr.entity-row');
      assert.notEqual(await page.locator('#main tbody tr.entity-row').first().evaluate((tr) => getComputedStyle(tr).userSelect), 'none');
    } finally { await page.close(); }
  });
}
