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
  const focused = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    return a.id || a.getAttribute('name') || a.textContent.trim() || a.tagName;
  });
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
