import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phonePage } from './lib/browser.mjs';

let notes;
const s = await launch('doc writing bar', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
}, { phone: true });

const WRITING = ['undo', 'redo', 'check', 'list', 'headings', 'wv-insert', 'wv-done'];

if (s) {
  const { base, browser, weave } = s;
  const settles = (page, want) => page.waitForFunction((w) =>
    window.__weaveEditors.values().next().value.getValue().trim() === w, want, { timeout: 10000 });
  const bar = (page) => page.evaluate(() => {
    const el = document.querySelector('.doc-editor .vditor-toolbar');
    const r = el.getBoundingClientRect();
    const shown = [...el.querySelectorAll('button[data-type]')].filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden');
    const sizes = shown.map((b) => { const x = b.getBoundingClientRect(); return [x.width, x.height]; });
    const covered = shown.filter((b) => { const x = b.getBoundingClientRect(); return !b.contains(document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2)); }).map((b) => b.dataset.type);
    const search = document.querySelector('.phone-bar');
    return {
      on: el.classList.contains('wv-show') && getComputedStyle(el).display !== 'none',
      caret: el.classList.contains('wv-bar-caret'),
      order: shown.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((b) => b.dataset.type),
      sizes, covered, searchShown: !!search && getComputedStyle(search).display !== 'none', top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight,
      undoOff: el.querySelector('button[data-type="undo"]').classList.contains('vditor-menu--disabled'),
      focused: !!document.activeElement?.closest('.vditor-ir'),
    };
  });
  const open = async (colorScheme = 'light', doc = 'First line.\n') => {
    const id = weave.createEntity(notes, { name: 'Writing bar', doc }).id;
    const page = await phonePage(browser, { colorScheme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.tap('.vditor-ir .vditor-reset > p');
    await page.keyboard.press('End');
    return { id, page };
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`on a phone a caret in the text shows the writing bar on the keyboard, in ${colorScheme} (Feature #289)`, async () => {
      const { page } = await open(colorScheme);
      try {
        await page.waitForFunction(() => document.querySelector('.doc-editor .vditor-toolbar.wv-show.wv-bar-caret'), null, { timeout: 5000 });
        const b = await bar(page);
        assert.deepEqual(b.order, WRITING, 'Undo, Redo, checklist, list, heading, insert, hide keyboard, left to right');
        for (const [w, h] of b.sizes) assert.ok(w >= 44 && h >= 44, `a button is ${w}x${h}px`);
        assert.deepEqual(b.covered, [], 'nothing sits on top of the bar');
        assert.equal(b.searchShown, false, 'the floating search and New step aside while writing');
        assert.ok(b.left >= 4 && b.right <= b.vw - 4, 'the bar floats clear of the screen edges');
        assert.ok(Math.abs(b.vh - b.bottom) <= 16, `the bar rides the bottom edge, ending at ${b.bottom} of ${b.vh}`);
      } finally { await page.close(); }
    });
  }

  test('on a phone the writing bar undoes and redoes typing without a hardware keyboard (Feature #289, Issue #707)', async () => {
    const { page } = await open();
    try {
      await page.keyboard.type(' more words');
      await settles(page, 'First line. more words');
      await page.waitForTimeout(1200);
      assert.equal((await bar(page)).undoOff, false, 'Undo is live once there is something to undo');
      await page.tap('.doc-editor .vditor-toolbar button[data-type="undo"]');
      await settles(page, 'First line.');
      assert.equal((await bar(page)).focused, true, 'the caret stays in the text, so the keyboard stays up');
      await page.tap('.doc-editor .vditor-toolbar button[data-type="redo"]');
      await settles(page, 'First line. more words');
    } finally { await page.close(); }
  });

  test('on a phone insert opens the slash menu at the caret, and hide keyboard puts the bar away (Feature #289)', async () => {
    const { page } = await open();
    try {
      await page.waitForSelector('.doc-editor .vditor-toolbar.wv-show.wv-bar-caret');
      await page.tap('.doc-editor .vditor-toolbar button[data-type="wv-insert"]');
      await page.waitForFunction(() => [...document.querySelectorAll('.vditor-hint')].some((h) => h.style.display !== 'none' && h.querySelector('.slash-item')), null, { timeout: 5000 });
      await page.keyboard.press('Escape');
      await page.tap('.doc-editor .vditor-toolbar button[data-type="wv-done"]');
      await page.waitForFunction(() => !document.querySelector('.doc-editor .vditor-toolbar.wv-show'), null, { timeout: 5000 });
      assert.equal((await bar(page)).focused, false, 'the text lets go of focus, which closes the keyboard');
    } finally { await page.close(); }
  });

  test('on a phone selecting text swaps the writing bar for the formatting row (Issue #693)', async () => {
    const { page } = await open();
    try {
      await page.evaluate(() => {
        const t = document.querySelector('.vditor-ir .vditor-reset > p').firstChild;
        const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
        getSelection().removeAllRanges(); getSelection().addRange(r);
      });
      await page.waitForFunction(() => { const b = document.querySelector('.doc-editor .vditor-toolbar.wv-show'); return b && !b.classList.contains('wv-bar-caret'); }, null, { timeout: 5000 });
      const b = await bar(page);
      assert.ok(b.order.includes('bold') && b.order.includes('link'), 'the formatting commands are back');
      assert.ok(!b.order.includes('wv-insert') && !b.order.includes('wv-done'), 'the writing-only buttons step aside');
    } finally { await page.close(); }
  });

  test('on a desktop a caret alone shows no bar', async () => {
    const id = weave.createEntity(notes, { name: 'Desktop caret', doc: 'First line.\n' }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await page.click('.vditor-ir .vditor-reset > p');
      await page.waitForTimeout(300);
      assert.equal((await bar(page)).on, false);
    } finally { await page.close(); }
  });
}
