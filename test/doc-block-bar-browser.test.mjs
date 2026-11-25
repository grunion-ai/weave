import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let notes;
const s = await launch('doc block bar', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
});

const BLOCK = ['undo', 'redo', 'check', 'list', 'headings', 'wv-insert'];
const DOC = 'First paragraph of the note.\n\nSecond paragraph, where the caret lands.\n\nThird paragraph below it.\n';

if (s) {
  const { base, browser, weave } = s;
  const open = async (colorScheme = 'light') => {
    const id = weave.createEntity(notes, { name: 'Block bar', doc: DOC }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    return page;
  };
  const clickInto = (page, nth) => page.click(`.vditor-ir .vditor-reset > p:nth-of-type(${nth})`, { position: { x: 30, y: 8 } });
  const shown = (page) => page.waitForSelector('.doc-editor .vditor-toolbar.wv-show.wv-bar-block', { timeout: 10000 });
  const hidden = (page) => page.waitForFunction(() => {
    const bar = document.querySelector('.doc-editor .vditor-toolbar');
    return !bar || getComputedStyle(bar).display === 'none' || bar.offsetHeight === 0;
  }, null, { timeout: 10000 });
  const bar = (page, nth) => page.evaluate((n) => {
    const el = document.querySelector('.doc-editor .vditor-toolbar');
    const b = el.getBoundingClientRect();
    const block = document.querySelector(`.vditor-ir .vditor-reset > p:nth-of-type(${n})`).getBoundingClientRect();
    const host = document.querySelector('.doc-editor').getBoundingClientRect();
    const buttons = [...el.querySelectorAll('button[data-type]')].filter((x) => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden');
    return {
      on: el.classList.contains('wv-show') && getComputedStyle(el).display !== 'none' && b.height > 0,
      block: el.classList.contains('wv-bar-block'),
      order: buttons.sort((x, y) => x.getBoundingClientRect().left - y.getBoundingClientRect().left).map((x) => x.dataset.type),
      clear: b.bottom <= block.top + 1 || b.top >= block.bottom - 1,
      near: Math.min(Math.abs(b.bottom - block.top), Math.abs(b.top - block.bottom)) <= 16,
      leftAligned: Math.abs(b.left - block.left) <= 16,
      inHost: b.left >= host.left - 1 && b.right <= host.right + 1,
      position: getComputedStyle(el).position,
    };
  }, nth);

  test('on a desktop a click into a document shows the block bar beside the caret\'s block, clear of its text (Issue #1883)', async () => {
    const page = await open();
    try {
      await clickInto(page, 2);
      await shown(page);
      const b = await bar(page, 2);
      assert.equal(b.on, true, 'a caret with no selection shows a bar');
      assert.equal(b.position, 'absolute', 'the bar floats in the editor, not docked');
      assert.deepEqual(b.order, BLOCK, 'Undo, Redo, checklist, list, heading and insert, left to right');
      assert.ok(b.clear, 'the bar does not cover the block being edited');
      assert.ok(b.near, 'the bar sits against that block');
      assert.ok(b.leftAligned, 'the bar lines up with the block\'s left edge');
      assert.ok(b.inHost, 'the bar stays inside the editor');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(() => {
        const sel = getSelection();
        return sel.rangeCount && sel.getRangeAt(0).startContainer.parentElement?.closest('p')?.textContent.startsWith('Third');
      }, null, { timeout: 5000 });
      await page.waitForTimeout(50);
      const next = await bar(page, 3);
      assert.ok(next.on && next.clear && next.near, 'the bar follows the caret to the next block');
    } finally { await page.close(); }
  });

  test('on a desktop a selection still shows the mark bubble rather than the block bar (Issue #1883)', async () => {
    const page = await open();
    try {
      await clickInto(page, 2);
      await shown(page);
      await page.evaluate(() => {
        const t = document.querySelectorAll('.vditor-ir .vditor-reset > p')[1].firstChild;
        const r = document.createRange();
        r.setStart(t, 0); r.setEnd(t, 6);
        getSelection().removeAllRanges(); getSelection().addRange(r);
      });
      await page.waitForFunction(() => !document.querySelector('.doc-editor .vditor-toolbar').classList.contains('wv-bar-block'), null, { timeout: 5000 });
      const b = await bar(page, 2);
      assert.equal(b.on, true);
      for (const t of ['bold', 'italic', 'link']) assert.ok(b.order.includes(t), `the selection bubble holds ${t}`);
      assert.ok(!b.order.includes('wv-insert'), 'insert stays on the block bar');
    } finally { await page.close(); }
  });

  test('on a desktop Escape and leaving the editor hide the block bar, and Tab after Escape still leaves (Issues #1883, #1888)', async () => {
    const page = await open();
    try {
      await clickInto(page, 2);
      await shown(page);
      await page.keyboard.press('Escape');
      await hidden(page);
      await page.keyboard.press('Tab');
      await page.waitForFunction(() => !document.activeElement?.closest('.vditor-ir'), null, { timeout: 5000 });
      await hidden(page);
      await clickInto(page, 1);
      await shown(page);
      await page.evaluate(() => document.activeElement.blur());
      await hidden(page);
    } finally { await page.close(); }
  });

  test('on a desktop insert on the block bar opens the slash menu at the caret (Issue #1883)', async () => {
    const page = await open();
    try {
      await clickInto(page, 3);
      await page.keyboard.press('End');
      await shown(page);
      await page.click('.doc-editor .vditor-toolbar button[data-type="wv-insert"]');
      await page.waitForFunction(() => {
        const h = document.querySelector('.doc-editor .vditor-hint:not(.vditor-toolbar *)');
        return h && h.style.display !== 'none' && h.querySelectorAll('button').length > 0;
      }, null, { timeout: 10000 });
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`on a desktop the block bar paints on the surface colour, in ${theme} (Issue #1883)`, async () => {
      const page = await open(theme);
      try {
        await clickInto(page, 2);
        await shown(page);
        const paint = await page.evaluate(() => {
          const el = document.querySelector('.doc-editor .vditor-toolbar');
          const probe = document.createElement('div');
          probe.style.background = 'var(--tblr-bg-surface)';
          document.querySelector('.doc-editor').append(probe);
          const want = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return { got: getComputedStyle(el).backgroundColor, want, mode: document.documentElement.dataset.bsTheme };
        });
        assert.equal(paint.mode, theme);
        assert.equal(paint.got, paint.want, 'the bar sits on the surface colour');
      } finally { await page.close(); }
    });
  }
}
