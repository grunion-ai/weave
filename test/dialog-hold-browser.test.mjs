/* The tray, the full-screen viewer and the ⌘K palette hold the page the way
   modal() does (Issue #263, second half).

   The 2026-09-12 audit counted ten hand-rolled dialogs and found none that
   held the keyboard. modal() went through holdPage() first; this suite holds
   the other three surfaces that cover the page to the same contract: each is
   announced as a modal dialog with a name, Tab and Shift+Tab wrap inside it,
   the app behind is inert while it is open and free after it closes (by
   Escape and by the surface's own close), and focus goes back to what opened
   it. None is a straight modal(), so each keeps its own shape: the tray's
   pickers are appended after the hold and stay live, the viewer's frame is a
   Tab stop that Tab walks into and back out of, and the palette keeps its
   arrows. Two holds can stack (⌘K over a dialog, the tray replacing a
   modal), and the one underneath must neither free the page early nor stay
   held after. Both themes, since every one of them is chrome.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
const s = await launch('dialog hold', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  for (const name of ['Bluefin one', 'Bluefin two', 'Bluefin three']) weave.createEntity(tasks, { name });
});

if (s) {
  const { base, browser } = s;

  const open = async (theme, hash = '') => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#ws-new svg');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
    return page;
  };
  const openGrid = async (theme) => {
    const page = await open(theme, `#/table/${tasks.id}`);
    await page.waitForSelector('.add-field-head .add-field-btn');
    return page;
  };
  // What holds focus, named the way a reader would point at it.
  const focused = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    return a.id || a.getAttribute('name') || a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent.trim() || a.tagName;
  });
  // Every body child that is inert, by id or class, so a leak names itself.
  // Scripts are body children too, and an inert script is no one's concern.
  const inertNow = (page) => page.evaluate(() => [...document.body.children]
    .filter((n) => n.inert && n.tagName !== 'SCRIPT').map((n) => n.id || n.className || n.tagName));
  // The dialog contract read off one box: its role, modality and the name a
  // screen reader announces (a labelling element's text, else aria-label).
  const dialogOf = (page, sel) => page.evaluate((q) => {
    const d = document.querySelector(q);
    const by = d.getAttribute('aria-labelledby');
    return {
      role: d.getAttribute('role'),
      modal: d.getAttribute('aria-modal'),
      label: by ? document.getElementById(by)?.textContent ?? null : d.getAttribute('aria-label'),
    };
  }, sel);
  // Whether focus sits inside the given overlay.
  const inside = (page, sel) => page.evaluate((q) => !!document.querySelector(q)?.contains(document.activeElement), sel);

  for (const theme of ['light', 'dark']) {
    /* ── the tray ─────────────────────────────────────────────────────── */
    test(`the field tray is a labelled modal dialog that holds Tab and the page, and gives focus back (${theme})`, async () => {
      const page = await openGrid(theme);
      try {
        await page.focus('.add-field-head .add-field-btn');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#tray input[name="name"]');
        assert.deepEqual(await dialogOf(page, '#tray'), { role: 'dialog', modal: 'true', label: 'Add field' });
        assert.equal(await focused(page), 'name', 'the name input takes focus');
        assert.ok((await inertNow(page)).includes('app'), 'the table behind is inert');
        assert.equal(await page.evaluate(() => document.querySelector('#tray-back').inert), false, 'the tray itself is live');

        // Every Tab stays in the tray and a full lap comes back to the name.
        const lap = await page.evaluate(() => [...document.querySelector('#tray').querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
          .filter((n) => n.getClientRects().length).length);
        for (let i = 0; i < lap; i += 1) {
          await page.keyboard.press('Tab');
          assert.ok(await inside(page, '#tray'), `Tab ${i + 1} of ${lap} stays in the tray`);
        }
        assert.equal(await focused(page), 'name', 'a full lap of Tab wraps back to the name');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page), 'Close', 'Shift+Tab steps back to the close button');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page), 'Create', 'and from the first control wraps to the last');

        // Shift+Enter is the table's quick-create. A tile focused in the
        // tray is not the grid, and no row appears behind the held page.
        const rows = () => page.locator('.wv-grid tbody tr[data-eid]').count();
        const before = await rows();
        await page.focus('#tray-back .type-tile');
        await page.keyboard.down('Shift');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Shift');
        await page.waitForTimeout(300);
        assert.equal(await rows(), before, 'Shift+Enter in the tray creates no row behind it');

        await page.keyboard.press('Escape');
        await page.waitForSelector('#tray-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), [], 'Escape frees the page');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('add-field-btn')), true,
          'focus is back on the + that opened the tray');

        // The tray's own close does the same.
        await page.click('.add-field-head .add-field-btn');
        await page.waitForSelector('#tray input[name="name"]');
        assert.ok((await inertNow(page)).includes('app'));
        await page.click('#tray .tray-close');
        await page.waitForSelector('#tray-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), [], 'the ✕ frees the page');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('add-field-btn')), true,
          'and focus goes back to the +');
      } finally { await page.close(); }
    });

    test(`a picker opened inside the tray is appended after the hold and stays live (${theme})`, async () => {
      const page = await openGrid(theme);
      try {
        await page.click('.add-field-head .add-field-btn');
        await page.waitForSelector('#tray-back .type-tile');
        await page.click('#tray-back .type-tile[title="workflow"]');
        await page.waitForSelector('#tray-back .opt-list .picker-face');
        await page.click('#tray-back .opt-list .picker-face');
        await page.waitForSelector('.chip-pop .picker-search');
        assert.equal(await page.evaluate(() => document.querySelector('.chip-pop').inert), false, 'the picker is live');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('picker-search')), true,
          'the cursor is in the picker\'s search bar');
        await page.keyboard.type('done');
        assert.equal(await page.inputValue('.chip-pop .picker-search'), 'done', 'and it takes typing');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.chip-pop', { state: 'detached' });
        assert.equal(await page.locator('#tray-back').count(), 1, 'Escape closes the picker, not the tray');
        assert.ok((await inertNow(page)).includes('app'), 'the page stays held under the tray');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#tray-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), []);
      } finally { await page.close(); }
    });

    /* tray() opening over a modal removes the modal's backdrop. The modal's
       release runs after the tray has taken the page, and must not free the
       page from under the tray. */
    test(`the tray replacing a modal keeps the page held until the tray closes (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.focus('#ws-new');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#modal input[name="name"]');
        await page.evaluate(() => tray('Replacing', [Object.assign(document.createElement('input'), { name: 'b' })], async () => {}));
        await page.waitForSelector('#modal-back', { state: 'detached' });
        await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
        assert.ok((await inertNow(page)).includes('app'), 'the tray still holds the page after the modal let go');
        assert.equal(await page.evaluate(() => document.querySelector('#tray-back').inert), false, 'the tray is live');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#tray-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), [], 'closing the tray frees the page');
      } finally { await page.close(); }
    });

    /* ── the full-screen viewer ───────────────────────────────────────── */
    const FRAME = `data:text/html,${encodeURIComponent('<a href="#a">first</a> <a href="#b">second</a>')}`;
    test(`the full-screen viewer is a labelled modal dialog; Tab cycles the toolbar and walks through the frame (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.focus('#ws-new');
        await page.evaluate((url) => fullscreenViewer('Spec sheet', { url }), FRAME);
        await page.waitForSelector('#fsv-back iframe');
        await page.frameLocator('#fsv-back iframe').locator('a').first().waitFor();
        assert.deepEqual(await dialogOf(page, '#fsv-back'), { role: 'dialog', modal: 'true', label: 'Spec sheet' });
        assert.ok(await inside(page, '#fsv-back'), 'focus moves into the viewer');
        assert.ok((await inertNow(page)).includes('app'), 'the page behind is inert');

        await page.keyboard.press('Tab');
        assert.equal(await focused(page), 'Back', 'the first Tab lands on the toolbar\'s first control');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page), 'IFRAME', 'Shift+Tab from the first control wraps to the frame');
        await page.focus('#fsv-back button[title="Close (Esc)"]');
        await page.keyboard.press('Tab');
        assert.equal(await focused(page), 'IFRAME', 'Tab from the toolbar\'s last control enters the frame');
        const inFrame = () => page.frameLocator('#fsv-back iframe').locator(':focus').textContent();
        await page.keyboard.press('Tab');
        assert.equal(await inFrame(), 'first', 'Tab walks the framed page');
        await page.keyboard.press('Tab');
        assert.equal(await inFrame(), 'second');
        await page.keyboard.press('Tab');
        assert.equal(await focused(page), 'Back', 'Tab out of the frame\'s last stop wraps to the toolbar, not the page');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page), 'IFRAME', 'and Shift+Tab goes back into the frame');

        await page.focus('#fsv-back button[title="Back"]');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#fsv-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), [], 'Escape frees the page');
        assert.equal(await focused(page), 'ws-new', 'focus is back on what opened the viewer');
      } finally { await page.close(); }
    });

    test(`the whiteboard's viewer closes from its ✕ and gives the page and focus back (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.focus('#ws-new');
        await page.evaluate(() => fullscreenViewer('Whiteboard', { mount: () => {} }));
        await page.waitForSelector('#fsv-back .fsv-body');
        assert.deepEqual(await dialogOf(page, '#fsv-back'), { role: 'dialog', modal: 'true', label: 'Whiteboard' });
        assert.ok((await inertNow(page)).includes('app'));
        await page.keyboard.press('Tab');
        assert.equal(await focused(page), 'Close (Esc)', 'the one control is the first stop');
        await page.keyboard.press('Tab');
        assert.equal(await focused(page), 'Close (Esc)', 'and Tab stays on it');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#fsv-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), [], 'the ✕ frees the page');
        assert.equal(await focused(page), 'ws-new', 'focus is back on the opener');
      } finally { await page.close(); }
    });

    /* ── the ⌘K palette ───────────────────────────────────────────────── */
    const palette = async (page) => {
      await page.keyboard.press('Control+k');
      await page.waitForSelector('#cmdk-input');
      await page.keyboard.type('Bluefin');
      await page.waitForFunction(() => document.querySelectorAll('#cmdk-results .result .copy-btn').length === 3);
    };
    test(`the ⌘K palette is a labelled modal dialog around its combobox; Tab wraps, arrows still move (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.focus('#ws-new');
        await palette(page);
        assert.deepEqual(await dialogOf(page, '#cmdk'), { role: 'dialog', modal: 'true', label: 'Search' });
        assert.ok((await inertNow(page)).includes('app'), 'the page behind is inert');
        assert.equal(await focused(page), 'cmdk-input');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => [...document.querySelectorAll('#cmdk-results .result')].findIndex((r) => r.classList.contains('active'))), 1,
          'the arrows still move the highlight');

        const walk = [];
        for (let i = 0; i < 4; i += 1) { await page.keyboard.press('Tab'); walk.push(await focused(page)); }
        assert.deepEqual(walk, ['Copy permalink', 'Copy permalink', 'Copy permalink', 'cmdk-input'], 'Tab walks the copy buttons and wraps to the input');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focused(page), 'Copy permalink', 'Shift+Tab from the input wraps to the last copy button');
        assert.ok(await inside(page, '#cmdk'));

        await page.focus('#cmdk-input');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#cmdk-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), [], 'Escape frees the page');
        assert.equal(await focused(page), 'ws-new', 'focus is back where ⌘K was pressed');

        // A click on the backdrop is the palette's other close.
        await palette(page);
        await page.mouse.click(20, 20);
        await page.waitForSelector('#cmdk-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), [], 'the backdrop frees the page');
        assert.equal(await focused(page), 'ws-new', 'and focus goes back');
      } finally { await page.close(); }
    });

    /* ⌘K opens over an open dialog (the palette never checked for one, and
       still does not). The palette holds the dialog too while it is up;
       closing it hands the dialog back, still holding the page. */
    test(`⌘K over a modal holds the modal too, and closing the palette hands it back (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.focus('#ws-new');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#modal input[name="name"]');
        await palette(page);
        const under = await inertNow(page);
        assert.ok(under.includes('app') && under.includes('modal-back'), `the palette holds the page and the dialog under it: ${under}`);
        await page.mouse.click(20, 20);
        await page.waitForSelector('#cmdk-back', { state: 'detached' });
        await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
        const back = await inertNow(page);
        assert.ok(back.includes('app') && !back.includes('modal-back'), `the dialog is live again and the page still held: ${back}`);
        assert.equal(await focused(page), 'name', 'focus is back in the dialog');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#modal-back', { state: 'detached' });
        assert.deepEqual(await inertNow(page), [], 'closing the dialog frees the page');
        assert.equal(await focused(page), 'ws-new');
      } finally { await page.close(); }
    });
  }

  /* A document's reference command opens the palette and puts the cursor
     back in the editor as the palette closes. That refocus runs in the same
     turn as the close, so the page must already be free by then. */
  test('a reference picked from the palette returns the cursor to the document editor', async () => {
    const page = await open('light');
    try {
      await page.evaluate(() => {
        window.__refocused = null;
        const box = Object.assign(document.createElement('textarea'), { id: 'ref-probe' });
        document.querySelector('#main').append(box);
        box.focus();
        openCommandK({ onPick: () => { box.focus(); window.__refocused = document.activeElement?.id ?? null; } });
      });
      await page.keyboard.type('Bluefin');
      await page.waitForSelector('#cmdk-results .result-main');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__refocused), 'ref-probe', 'the editor takes focus inside onPick');
      assert.deepEqual(await inertNow(page), []);
    } finally { await page.close(); }
  });
}
