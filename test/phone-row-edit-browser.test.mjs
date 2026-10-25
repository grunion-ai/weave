import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, settled, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('phone row edit', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  weave.addField(issues, { name: 'Done', type: 'checkbox' });
  weave.addField(issues, { name: 'Points', type: 'number' });
  weave.addField(issues, { name: 'Due', type: 'date' });
  for (let i = 0; i < 30; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: 'Open', Severity: 'High', Done: false, Points: 3, Due: '2026-10-12' } });
  weave.tableView('Development/Issue/Standard', { fields: ['Name', 'Status', 'Severity'], phoneRow: { lead: 'Status', chips: ['Severity', 'Done', 'Points', 'Due'] } });
  return { id: issues.id };
});

const drag = (page, n, field, dy) => page.evaluate(([n, field, dy]) => {
  const row = document.querySelectorAll('#main :is(tbody tr.entity-row, .wv-list .list-row)')[n];
  const r = row.querySelector(`:is(td, .phone-chip)[data-field="${field}"]`).getBoundingClientRect();
  const x = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const opts = (type, y) => ({ bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true, pointerId: 41, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y });
  row.dispatchEvent(new PointerEvent('pointerdown', opts('pointerdown', y0)));
  for (let k = 1; k <= 10; k++) document.elementFromPoint(x, y0 + (dy * k) / 10)?.dispatchEvent(new PointerEvent('pointermove', opts('pointermove', y0 + (dy * k) / 10)));
  const end = document.elementFromPoint(x, y0 + dy) ?? row;
  end.dispatchEvent(new PointerEvent('pointerup', opts('pointerup', y0 + dy)));
  end.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y0 + dy }));
}, [n, field, dy]);

if (s) {
  const { base, browser, id, weave } = s;
  const engines = [['chromium 390x844 touch', browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const open = async (b, profile, theme = 'light') => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main :is(tbody tr.entity-row, .wv-list .list-row) :is(td, .phone-chip)[data-field="Severity"]');
    await settled(page.locator('#main :is(.table-wrap, .list-wrap)'));
    return page;
  };
  const row = (page, n) => page.locator('#main :is(tbody tr.entity-row, .wv-list .list-row)').nth(n);
  const value = (n, field) => weave.readEntity(weave.listEntities(id)[n].id).fields[field];
  const tapOn = async (page, locator, { dx = 0, dy = 0 } = {}) => {
    await locator.evaluate((n) => n.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    const b = await locator.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy);
  };
  const reset = () => { for (const e of weave.listEntities(id)) weave.updateEntity(e.id, { Status: 'Open', Severity: 'High', Done: false, Points: 3, Due: '2026-10-12' }); };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone a tap on the Severity chip opens its picker sheet and writes the row without opening it, with Undo in the top toast (${engine}, ${theme}, Feature #300)`, async () => {
        reset();
        const page = await open(b, profile, theme);
        try {
          await tapOn(page, row(page, 1).locator(':is(td, .phone-chip)[data-field="Severity"]'));
          await page.waitForSelector('.picker-pop');
          assert.equal(page.url().includes('?e='), false, 'the row did not open');
          await page.locator('.picker-pop button', { hasText: 'Low' }).first().click();
          await page.waitForFunction(() => document.querySelectorAll('#main :is(tbody tr.entity-row, .wv-list .list-row)')[1]?.querySelector(':is(td, .phone-chip)[data-field="Severity"]')?.textContent.includes('Low'), null, { timeout: 10000 });
          assert.equal(value(1, 'Severity'), 'Low');
          assert.equal(page.url().includes('?e='), false, 'still on the list');
          const t = await page.evaluate(() => {
            const toast = document.querySelector('#wv-toasts .wv-toast:last-child');
            return { text: toast?.textContent ?? '', top: toast?.getBoundingClientRect().top ?? 999, theme: document.documentElement.dataset.bsTheme };
          });
          assert.equal(t.theme, theme);
          assert.match(t.text, /Severity/);
          assert.ok(t.top < 120, `the toast sits at the top (${t.top})`);
          await page.locator('#wv-toasts .wv-toast-action', { hasText: 'Undo' }).last().click();
          await page.waitForFunction(() => document.querySelectorAll('#main :is(tbody tr.entity-row, .wv-list .list-row)')[1]?.querySelector(':is(td, .phone-chip)[data-field="Severity"]')?.textContent.includes('High'), null, { timeout: 10000 });
          assert.equal(value(1, 'Severity'), 'High', 'Undo puts the old value back');
        } finally { await page.close(); }
      });
    }

    test(`on a phone the lead mark opens the state picker, a checkbox flips in place, a number opens a one-field sheet with a Done key, a date opens the date sheet (${engine}, Feature #300)`, async () => {
      reset();
      const page = await open(b, profile);
      try {
        await tapOn(page, row(page, 2).locator('.phone-lead'));
        await page.waitForSelector('.picker-pop');
        await page.locator('.picker-pop button', { hasText: 'Fixed' }).first().click();
        await page.waitForFunction(() => document.querySelectorAll('#main :is(tbody tr.entity-row, .wv-list .list-row)')[2]?.querySelector('.phone-lead')?.textContent.includes('Fixed'), null, { timeout: 10000 });
        assert.equal(value(2, 'Status'), 'Fixed');

        await tapOn(page, row(page, 3).locator(':is(td, .phone-chip)[data-field="Done"]'));
        await page.waitForFunction(() => document.querySelectorAll('#main :is(tbody tr.entity-row, .wv-list .list-row)')[3]?.querySelector(':is(td, .phone-chip)[data-field="Done"] input')?.checked, null, { timeout: 10000 });
        assert.equal(value(3, 'Done'), true);
        assert.equal(await page.locator('.picker-pop, .value-pop').count(), 0, 'a checkbox needs no sheet');

        await tapOn(page, row(page, 4).locator(':is(td, .phone-chip)[data-field="Points"]'));
        const input = page.locator('.value-pop input');
        await input.waitFor();
        assert.equal(await input.getAttribute('enterkeyhint'), 'done');
        assert.equal(await input.inputValue(), '3', 'the sheet starts from the current value');
        await input.fill('8');
        await input.press('Enter');
        await page.waitForFunction(() => document.querySelectorAll('#main :is(tbody tr.entity-row, .wv-list .list-row)')[4]?.querySelector(':is(td, .phone-chip)[data-field="Points"]')?.textContent.includes('8') || document.querySelectorAll('#main :is(tbody tr.entity-row, .wv-list .list-row)')[4]?.querySelector(':is(td, .phone-chip)[data-field="Points"] input')?.value === '8', null, { timeout: 10000 });
        assert.equal(value(4, 'Points'), 8);

        await tapOn(page, row(page, 0).locator(':is(td, .phone-chip)[data-field="Due"]'));
        await page.waitForSelector('.date-pop');
        assert.equal(page.url().includes('?e='), false);
      } finally { await page.close(); }
    });

    test(`on a phone the name and the #id still open the row, and a scroll that starts on a chip never edits (${engine}, Feature #300)`, async () => {
      reset();
      const page = await open(b, profile);
      try {
        await drag(page, 2, 'Severity', -160);
        await page.waitForTimeout(300);
        assert.equal(await page.locator('.picker-pop').count(), 0, 'a drag opens no picker');
        assert.equal(page.url().includes('?e='), false, 'and no row');
        await tapOn(page, row(page, 1).locator('.list-title'), { dx: -20 });
        await page.waitForURL(/\?e=/);
        assert.equal(await page.locator('.picker-pop').count(), 0);
        await page.click('#dock button[aria-label="Close"]');
        await page.waitForSelector('#dock', { state: 'hidden' });
        await tapOn(page, row(page, 3).locator('.open-link'));
        await page.waitForURL(/\?e=/);
        assert.equal(value(1, 'Severity'), 'High', 'nothing was written');
      } finally { await page.close(); }
    });
  }

  test('on a desktop a click on a Severity cell keeps the grid editor, and there is no phone lead mark (Feature #300)', async () => {
    reset();
    const page = await open(browser, { viewport: { width: 1280, height: 844 } });
    try {
      assert.equal(await page.locator('#main .phone-lead:visible').count(), 0);
      await row(page, 1).locator(':is(td, .phone-chip)[data-field="Severity"] .chip-trigger').click();
      await page.waitForSelector('.picker-pop');
      assert.equal(page.url().includes('?e='), false);
    } finally { await page.close(); }
  });
}
