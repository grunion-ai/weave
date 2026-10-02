/* The slash menu against the chrome it opens over (Issue #550).

   A menu that flips upward lands across two sticky bands: the record header
   with the title, and the document's own section head. Vditor paints its
   .vditor-hint at z-index 4, under both of them, so the rows that fell in
   those bands could be neither read nor clicked — document.elementFromPoint
   over the menu's own box answered TEXTAREA.name-edit and
   DIV.doc-section-head.

   The geometry is the whole subject, so it runs in a real browser: an eight
   paragraph document at 1280x800 puts the caret low enough for the flip and
   high enough that the 400px menu reaches the header, which is the window
   the bug lives in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tableRef;
const s = await launch('slash menu stacking', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
});

if (s) {
  const { base, browser, weave } = s;

  /* Eight paragraphs, not eight soft-wrapped lines: a single newline is a
     break inside one paragraph, and the caret has to reach the document's
     last block for the menu to flip. */
  const paragraphs = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1} of the description`).join('\n\n');

  async function openMenuAtEnd(name, n) {
    const e = weave.createEntity(tableRef, { name });
    weave.setDoc(e.id, paragraphs(n), 'Description');
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/entity/${e.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"]');
    // To the end of the document, then a fresh empty line under it: "/" only
    // opens the menu at the start of a line.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
    await page.waitForFunction(() => {
      const ed = document.querySelector('.vditor-ir [contenteditable="true"]');
      const a = getSelection().anchorNode;
      return a && ed.contains(a) && a.parentElement === ed.lastElementChild;
    }, null, { timeout: 20000 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible', timeout: 20000 });
    await page.waitForFunction(() => {
      const h = [...document.querySelectorAll('.vditor-hint')].find((x) => x.offsetHeight > 0 && x.style.display !== 'none');
      return h && h.getBoundingClientRect().height > 100;
    }, null, { timeout: 20000 });
    return page;
  }

  /* Every pixel row of the open menu answers with a node inside the menu —
     the reader's own hit test, and the click's. */
  const readStack = (page) => page.evaluate(() => {
    const hint = [...document.querySelectorAll('.vditor-hint')].find((h) => h.offsetHeight > 0 && h.style.display !== 'none');
    const r = hint.getBoundingClientRect();
    const head = document.querySelector('#main > .view-header').getBoundingClientRect();
    const blocked = [];
    for (const dy of [4, 12, 30, 60, 120, r.height / 2, r.height - 10]) {
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + dy);
      if (!el || !hint.contains(el)) blocked.push(`${Math.round(dy)}px: ${el?.tagName}.${String(el?.className).split(' ')[0]}`);
    }
    return {
      blocked,
      flippedUp: r.bottom - r.height < head.bottom + 420,
      clears: r.top >= head.bottom - 1,
      scrolls: hint.scrollHeight > hint.clientHeight + 1,
      rows: hint.querySelectorAll('button').length,
      z: Number(getComputedStyle(hint).zIndex),
      headZ: Number(getComputedStyle(document.querySelector('#main > .view-header')).zIndex),
      sectionZ: Number(getComputedStyle(document.querySelector('.doc-section-head')).zIndex),
    };
  });

  test('an upward slash menu is hit-testable over the record header and the section head', async () => {
    const page = await openMenuAtEnd('Stacking', 8);
    try {
      const got = await readStack(page);
      assert.ok(got.rows > 10, `the whole catalogue is open (${got.rows} rows)`);
      assert.deepEqual(got.blocked, [], 'no band of the menu answers with something else');
      assert.ok(got.z > got.headZ, `the menu (${got.z}) outranks the record header (${got.headZ})`);
      assert.ok(got.z > got.sectionZ, `and the section head (${got.sectionZ})`);
    } finally { await page.close(); }
  });

  test('the upward menu clamps to the header and scrolls instead of sliding under it', async () => {
    const page = await openMenuAtEnd('Clamp', 8);
    try {
      const got = await readStack(page);
      assert.ok(got.clears, 'the menu starts at or below the pinned header');
      assert.ok(got.scrolls, 'the rows it gave up to fit are reachable by scrolling');
    } finally { await page.close(); }
  });

  /* The fix is a stacking order, which a theme cannot change — the dark
     theme only ever reskins the bands. Read it back so a future theme sheet
     that sets its own z-index fails here. */
  test('the stacking order holds in the dark theme', async () => {
    const page = await openMenuAtEnd('Dark', 8);
    try {
      await page.evaluate(() => { document.documentElement.dataset.bsTheme = 'dark'; });
      const got = await readStack(page);
      assert.deepEqual(got.blocked, [], 'no band of the menu answers with something else');
      assert.ok(got.z > got.headZ && got.z > got.sectionZ, 'the menu still outranks both bands');
    } finally { await page.close(); }
  });
}
