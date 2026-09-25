/* modal() is a modal dialog, not a box drawn over the page (Issue #263).

   The 2026-09-12 audit counted ten hand-rolled dialogs and found none that
   held the keyboard: Tab walked out of every one of them into the page
   behind, a click-free reader could type into a grid cell the backdrop
   covered, and nothing told a screen reader a dialog had opened. Issue #158
   (the New workspace dialog read unstyled) was one symptom of the same
   hand-rolling. This suite holds the shared primitive to the dialog
   contract: it is announced as a modal dialog named by its title, Tab and
   Shift+Tab cycle inside it, the page behind is inert while it is open and
   comes back when it closes (however it closes), Escape closes it, and focus
   returns to what opened it. The New workspace dialog is the case in point.
   Both themes, since the dialog is chrome.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('modal trap', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Task' });
});

if (s) {
  const { base, browser } = s;

  const open = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#ws-new svg');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
    return page;
  };
  // What holds focus, named the way a reader would point at it.
  const focused = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    return a.id || a.getAttribute('name') || a.textContent.trim() || a.tagName;
  });
  // Every body child that is inert, by id or class, so a leak names itself.
  const inertNow = (page) => page.evaluate(() => [...document.body.children]
    .filter((n) => n.inert).map((n) => n.id || n.className || n.tagName));

  for (const theme of ['light', 'dark']) {
    test(`New workspace opens through modal() as a labelled modal dialog, its input in the modal's own style (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.focus('#ws-new');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#modal input[name="name"]');
        const dlg = await page.evaluate(() => {
          const m = document.querySelector('#modal');
          const input = m.querySelector('input[name="name"]');
          const form = m.querySelector('form');
          const pad = parseFloat(getComputedStyle(form).paddingLeft) + parseFloat(getComputedStyle(form).paddingRight);
          return {
            role: m.getAttribute('role'),
            modal: m.getAttribute('aria-modal'),
            label: document.getElementById(m.getAttribute('aria-labelledby') ?? '')?.textContent ?? null,
            inlineStyle: input.getAttribute('style'),
            fills: Math.abs(input.getBoundingClientRect().width - (form.clientWidth - pad)) <= 1,
          };
        });
        assert.deepEqual(dlg, { role: 'dialog', modal: 'true', label: 'New workspace', inlineStyle: null, fills: true },
          'a modal dialog named by its title, and an input with no inline style that still fills the form');
        assert.equal(await focused(page), 'name', 'the name input takes focus');
      } finally { await page.close(); }
    });

    test(`Tab from the last control wraps to the first; Shift+Tab from the first wraps to the last (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.click('#ws-new');
        await page.waitForSelector('#modal input[name="name"]');
        const walk = [await focused(page)];
        for (let i = 0; i < 3; i += 1) { await page.keyboard.press('Tab'); walk.push(await focused(page)); }
        assert.deepEqual(walk, ['name', 'Cancel', 'Create', 'name'], 'Tab cycles inside the dialog');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page), 'Create', 'Shift+Tab from the first control lands on the last');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page), 'Cancel', 'and steps back from there as usual');
        // Focus the page drops on the body (a click on the dialog's text) is
        // still inside the trap: the next Tab lands on the dialog, not the page.
        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press('Tab');
        assert.equal(await focused(page), 'name', 'Tab from nowhere lands on the dialog\'s first control');
      } finally { await page.close(); }
    });

    test(`the page behind is inert while the dialog is open; Escape closes it, frees the page and returns focus (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.focus('#ws-new');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#modal input[name="name"]');
        const behind = await page.evaluate(() => {
          const ws = document.querySelector('#ws-new');
          const input = document.querySelector('#modal input[name="name"]');
          ws.focus();
          const r = ws.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            appInert: document.querySelector('#app').inert,
            focusStayed: document.activeElement === input,
            hit: hit?.id || hit?.className,
          };
        });
        assert.deepEqual(behind, { appInert: true, focusStayed: true, hit: 'modal-back' },
          'the app is inert: focusing a control behind the dialog does nothing, and a click there lands on the backdrop');
        assert.equal(await page.evaluate(() => document.querySelector('#modal-back').inert), false, 'the dialog itself is live');
        assert.equal(await page.evaluate(() => document.querySelector('.bug-fab')?.inert ?? false), false,
          'the problem reporter floats above dialogs on purpose and stays reachable');

        await page.keyboard.press('Escape');
        await page.waitForSelector('#modal-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), [], 'closing frees the page');
        assert.equal(await focused(page), 'ws-new', 'focus is back on the + that opened it');
      } finally { await page.close(); }
    });

    /* Callers close a dialog by removing its backdrop (Restore in the
       workspace trash, a field definition's Clear, tray() opening over a
       modal), and one modal can replace another. The page comes back in the
       first case and stays held in the second. */
    test(`a backdrop removed by a caller frees the page; a modal replacing a modal keeps it held (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.click('#ws-new');
        await page.waitForSelector('#modal input[name="name"]');
        await page.evaluate(() => modal('Second', [Object.assign(document.createElement('input'), { name: 'b' })], async () => {}));
        await page.waitForFunction(() => document.querySelector('#modal h2')?.textContent === 'Second');
        await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
        assert.ok((await inertNow(page)).includes('app'), 'the replacing modal still holds the page');
        assert.equal(await page.locator('#modal-back').count(), 1, 'one backdrop');
        await page.evaluate(() => document.querySelector('#modal-back').remove());
        await page.waitForFunction(() => ![...document.body.children].some((n) => n.inert));
        assert.deepEqual(await inertNow(page), [], 'a removed backdrop frees the page');
      } finally { await page.close(); }
    });
  }
}
