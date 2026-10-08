import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const BODY = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog.`).join('\n\n');
const PHONE = { width: 375, height: 812 };
const COLUMN = 335;
const GUTTER = 20;
const RIGHT_GUTTER = 24;

let notes, row;
const s = await launch('phone doc width', (weave) => {
  weave.createSpace({ name: 'Writing' });
  notes = weave.createTable({ space: 'Writing', name: 'Note' });
  row = weave.createEntity(notes, { name: 'Phone column' });
  weave.setDoc(row.id, BODY);
});

if (s) {
  const { base, browser } = s;

  const column = (page) => page.evaluate(() => {
    const para = [...document.querySelectorAll('.doc-section .vditor-reset > p')][0].getBoundingClientRect();
    const sec = document.querySelector('.doc-section');
    return {
      left: Math.round(para.left), width: Math.round(para.width),
      right: Math.round(innerWidth - para.right),
      sectionPad: getComputedStyle(sec).paddingLeft,
    };
  });

  const open = async (url, viewport, wait) => {
    const page = await browser.newPage({ viewport });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-section .vditor-ir [contenteditable="true"]');
    if (wait) await page.waitForSelector(wait);
    await page.waitForSelector('.doc-section .vditor-reset > p');
    return page;
  };

  test('on a phone a row opened by permalink gives the text a full column (Issue #709)', async () => {
    const page = await open(`${base}/#/entity/${row.id}`, PHONE);
    try {
      const c = await column(page);
      assert.ok(c.width >= COLUMN, `the text column is ${c.width}px of a 375px screen, wanted at least ${COLUMN}px (${JSON.stringify(c)})`);
      assert.ok(c.left <= GUTTER, `the text starts ${c.left}px in, wanted at most ${GUTTER}px`);
      assert.ok(c.right <= RIGHT_GUTTER, `and ends ${c.right}px from the right edge, the gutter plus the pane card's own 8px margin`);
    } finally { await page.close(); }
  });

  test('on a phone a row opened from a table gives the text a full column (Issue #709)', async () => {
    const page = await open(`${base}/#/table/${notes.id}?e=${row.id}`, PHONE, '#dock .dock-entity');
    try {
      const c = await column(page);
      assert.ok(c.width >= COLUMN, `the docked text column is ${c.width}px of a 375px screen, wanted at least ${COLUMN}px (${JSON.stringify(c)})`);
      assert.ok(c.left <= GUTTER, `the text starts ${c.left}px in, wanted at most ${GUTTER}px`);
    } finally { await page.close(); }
  });

  test('a desktop keeps the section handle gutter beside the text', async () => {
    const page = await open(`${base}/#/entity/${row.id}`, { width: 1280, height: 900 });
    try {
      const c = await column(page);
      assert.equal(c.sectionPad, '18px', 'the drag handle keeps its own gutter outside the text on a desktop');
      assert.ok(c.left >= 40, `and the text still starts inside the pane padding: ${c.left}px`);
    } finally { await page.close(); }
  });
}
