import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, styleOf } from './lib/browser.mjs';

let tasks;
const s = await launch('dialog hold', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.createTable({ space: 'Product', name: 'Bluefin board' });
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
    await page.waitForSelector('.wv-grid .add-field-btn');
    return page;
  };
  const focused = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    return a.id || a.getAttribute('name') || a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent.trim() || a.tagName;
  });
  const inertNow = (page) => page.evaluate(() => [...document.body.children]
    .filter((n) => n.inert && n.tagName !== 'SCRIPT').map((n) => n.id || n.className || n.tagName));
  const freed = async (page) => eventually(() => inertNow(page), []);
  const dialogOf = (page, sel) => page.evaluate((q) => {
    const d = document.querySelector(q);
    const by = d.getAttribute('aria-labelledby');
    return {
      role: d.getAttribute('role'),
      modal: d.getAttribute('aria-modal'),
      label: by ? document.getElementById(by)?.textContent ?? null : d.getAttribute('aria-label'),
    };
  }, sel);
  const inside = (page, sel) => page.evaluate((q) => !!document.querySelector(q)?.contains(document.activeElement), sel);
  const STOPS = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';
  const stopIndex = (page, sel) => page.evaluate(([q, stops]) => {
    const list = [...document.querySelector(q).querySelectorAll(stops)].filter((n) => n.getClientRects().length && !n.classList.contains('hold-wrap'));
    return { at: list.indexOf(document.activeElement), count: list.length };
  }, [sel, STOPS]);

  for (const theme of ['light', 'dark']) {
    test(`the field tray is a labelled modal dialog that holds Tab and the page, and gives focus back (${theme})`, async () => {
      const page = await openGrid(theme);
      try {
        await page.focus('.wv-grid .add-field-btn');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#tray input');
        assert.deepEqual(await dialogOf(page, '#tray'), { role: 'dialog', modal: 'true', label: 'New field' });
        assert.ok(await inside(page, '#tray'), 'focus starts in the tray');
        assert.ok((await inertNow(page)).includes('app'), 'the table behind is inert');
        assert.equal(await page.evaluate(() => document.querySelector('#tray-back').inert), false, 'the tray itself is live');

        const start = await stopIndex(page, '#tray');
        assert.ok(start.count > 2 && start.at >= 0, `focus rests on a stop: ${JSON.stringify(start)}`);
        for (let i = 0; i < start.count; i += 1) {
          await page.keyboard.press('Tab');
          assert.ok(await inside(page, '#tray'), `Tab ${i + 1} of ${start.count} stays in the tray`);
        }
        assert.deepEqual(await stopIndex(page, '#tray'), start, 'a full lap of Tab comes back to where it began');
        await page.focus('#tray .tray-close');
        assert.equal((await stopIndex(page, '#tray')).at, 0, 'the close button is the first stop');
        await page.keyboard.press('Shift+Tab');
        assert.equal((await stopIndex(page, '#tray')).at, start.count - 1, 'Shift+Tab from the first stop wraps to the last');

        await page.evaluate(() => {
          window.__quick = null;
          addEventListener('keydown', function probe(e) {
            if (e.key !== 'Enter' || !e.shiftKey) return;
            window.__quick = e.defaultPrevented;
            removeEventListener('keydown', probe);
          });
        });
        await page.focus('#tray-back .type-tile');
        await page.keyboard.press('Shift+Enter');
        assert.equal(await page.evaluate(() => window.__quick), false, 'Shift+Enter in the tray is not the grid\'s quick-create');

        await page.keyboard.press('Escape');
        await page.waitForSelector('#tray-back', { state: 'detached' });
        assert.deepEqual(await freed(page), [], 'Escape frees the page');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('add-field-btn')), true,
          'focus is back on the + that opened the tray');

        await page.click('.wv-grid .add-field-btn');
        await page.waitForSelector('#tray input');
        assert.ok((await inertNow(page)).includes('app'));
        await page.click('#tray .tray-close');
        await page.waitForSelector('#tray-back', { state: 'detached' });
        assert.deepEqual(await freed(page), [], 'the close button frees the page');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('add-field-btn')), true,
          'and focus goes back to the +');
      } finally { await page.close(); }
    });

    test(`a node appended after the tray takes the page stays live, and the tray keeps its Escape (${theme})`, async () => {
      const page = await openGrid(theme);
      try {
        await page.click('.wv-grid .add-field-btn');
        await page.waitForSelector('#tray input');
        const late = await page.evaluate(() => {
          const pop = Object.assign(document.createElement('div'), { className: 'chip-pop' });
          const field = Object.assign(document.createElement('input'), { className: 'picker-search' });
          pop.append(field);
          document.body.append(pop);
          field.focus();
          return { inert: pop.inert, focus: document.activeElement === field };
        });
        assert.deepEqual(late, { inert: false, focus: true }, 'a picker appended to the body after the hold is live and takes focus');
        await page.keyboard.type('done');
        assert.equal(await page.inputValue('.chip-pop .picker-search'), 'done', 'and it takes typing');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#tray-back').count(), 1, 'Escape with a picker open leaves the tray up');
        assert.ok((await inertNow(page)).includes('app'), 'the page stays held under the tray');
        await page.evaluate(() => document.querySelector('.chip-pop').remove());
        await page.focus('#tray input');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#tray-back', { state: 'detached' });
        assert.deepEqual(await freed(page), []);
      } finally { await page.close(); }
    });

    test(`the tray replacing a modal keeps the page held until the tray closes (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.focus('#ws-new');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#modal input[name="name"]');
        await page.evaluate(() => tray('Replacing', [Object.assign(document.createElement('input'), { name: 'b' })], async () => {}));
        await page.waitForSelector('#modal-back', { state: 'detached' });
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
        assert.ok((await inertNow(page)).includes('app'), 'the tray still holds the page after the modal let go');
        assert.equal(await page.evaluate(() => document.querySelector('#tray-back').inert), false, 'the tray is live');
        assert.equal(await page.evaluate(() => document.querySelector('#tray').getAttribute('aria-labelledby')), 'tray-title', 'the tray keeps its own label id');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#tray-back', { state: 'detached' });
        assert.deepEqual(await freed(page), [], 'closing the tray frees the page');
      } finally { await page.close(); }
    });

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
        assert.equal(await styleOf(page.locator('#fsv-back'), 'outlineStyle', 'none'), 'none', 'the focused viewer draws no ring');

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

        await page.focus('#fsv-back button[title="Back"]');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#fsv-back', { state: 'detached' });
        assert.deepEqual(await freed(page), [], 'Escape frees the page');
        assert.equal(await focused(page), 'ws-new', 'focus is back on what opened the viewer');
      } finally { await page.close(); }
    });

    test(`the whiteboard's viewer closes from its close button and gives the page and focus back (${theme})`, async () => {
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
        assert.deepEqual(await freed(page), [], 'the close button frees the page');
        assert.equal(await focused(page), 'ws-new', 'focus is back on the opener');
      } finally { await page.close(); }
    });

    const palette = async (page) => {
      await page.keyboard.press('Control+k');
      await page.waitForSelector('#cmdk-input');
      await page.keyboard.type('Bluefin');
      await page.waitForFunction(() => document.querySelectorAll('#cmdk-results .cmdk-group').length >= 2);
    };
    const activeGroup = (page) => page.evaluate(() => [...document.querySelectorAll('#cmdk-results .cmdk-group')]
      .findIndex((g) => g.querySelector('.active')));
    test(`the ⌘K palette is a labelled modal dialog; Tab still jumps groups inside the input (${theme})`, async () => {
      const page = await open(theme);
      try {
        await page.focus('#ws-new');
        await palette(page);
        assert.deepEqual(await dialogOf(page, '#cmdk'), { role: 'dialog', modal: 'true', label: 'Search' });
        assert.ok((await inertNow(page)).includes('app'), 'the page behind is inert');
        assert.equal(await focused(page), 'cmdk-input');
        assert.equal(await activeGroup(page), 0);
        await page.keyboard.press('Tab');
        assert.equal(await activeGroup(page), 1, 'Tab moves the highlight to the next group');
        assert.equal(await focused(page), 'cmdk-input', 'and focus stays in the input');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await activeGroup(page), 0, 'Shift+Tab moves it back');
        assert.equal(await focused(page), 'cmdk-input');

        await page.keyboard.press('Escape');
        await page.waitForSelector('#cmdk-back', { state: 'detached' });
        assert.deepEqual(await freed(page), [], 'Escape frees the page');
        assert.equal(await focused(page), 'ws-new', 'focus is back where ⌘K was pressed');

        await palette(page);
        await page.mouse.click(20, 20);
        await page.waitForSelector('#cmdk-back', { state: 'detached' });
        assert.deepEqual(await freed(page), [], 'the backdrop frees the page');
        assert.equal(await focused(page), 'ws-new', 'and focus goes back');
      } finally { await page.close(); }
    });

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
        await page.waitForFunction(() => !document.querySelector('#modal-back').inert);
        assert.ok((await inertNow(page)).includes('app'), 'the dialog is live again and the page still held');
        assert.equal(await focused(page), 'name', 'focus is back in the dialog');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#modal-back', { state: 'detached' });
        assert.deepEqual(await freed(page), [], 'closing the dialog frees the page');
        assert.equal(await focused(page), 'ws-new');
      } finally { await page.close(); }
    });
  }

  const probe = (page, opts) => page.evaluate((o) => {
    window.__refocused = null;
    const box = Object.assign(document.createElement('textarea'), { id: 'ref-probe' });
    document.querySelector('#main').append(box);
    box.focus();
    const back = () => { box.focus(); window.__refocused = document.activeElement?.id ?? null; };
    openCommandK({
      ...(o.multi ? { multi: true, onCommit: back } : { onPick: back, onDismiss: back }),
      ...(o.create ? { create: [{ label: 'New record', run: async (q) => ({ id: 'made', name: q }) }] } : {}),
    });
  }, opts);

  test('a reference picked from the palette returns the cursor to the document editor', async () => {
    const page = await open('light');
    try {
      await probe(page, {});
      await page.keyboard.type('Bluefin');
      await page.waitForSelector('#cmdk-results .result');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__refocused), 'ref-probe', 'the editor takes focus inside onPick');
      assert.deepEqual(await inertNow(page), []);
    } finally { await page.close(); }
  });

  test('a palette dismissed by Escape frees the page before onDismiss refocuses', async () => {
    const page = await open('light');
    try {
      await probe(page, {});
      await page.waitForSelector('#cmdk-input');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__refocused), 'ref-probe');
      assert.deepEqual(await inertNow(page), []);
    } finally { await page.close(); }
  });

  test('a multi-pick palette frees the page before onCommit refocuses', async () => {
    const page = await open('light');
    try {
      await probe(page, { multi: true });
      await page.waitForSelector('#cmdk-input');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__refocused), 'ref-probe');
      assert.deepEqual(await inertNow(page), []);
    } finally { await page.close(); }
  });

  test('a record created from the palette frees the page before onPick refocuses', async () => {
    const page = await open('light');
    try {
      await probe(page, { create: true });
      await page.keyboard.type('Bluefin');
      await page.waitForSelector('#cmdk-results .result');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
      assert.equal(await page.evaluate(() => window.__refocused), 'ref-probe');
      assert.deepEqual(await inertNow(page), []);
    } finally { await page.close(); }
  });
}
