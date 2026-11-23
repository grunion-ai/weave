import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = '# Notes\n\n' + Array.from({ length: 30 }, (_, i) => `Line ${i} of filler text.`).join('\n\n') + '\n';
let tableRef;
const s = await launch('crepe slash menu polish', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
});

if (s) {
  const { base, browser, weave } = s;
  const ROOT = '.wv-crepe .ProseMirror[contenteditable="true"]';
  const MENU = '.milkdown-slash-menu[data-show="true"]';

  async function open(name, doc = LONG) {
    const e = weave.createEntity(tableRef, { name });
    weave.setDoc(e.id, doc, 'Description');
    const page = await browser.newPage({ viewport: { width: 1184, height: 793 } });
    await page.addInitScript(() => localStorage.setItem('weave.editor', 'crepe'));
    await page.goto(`${base}/#/entity/${e.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ROOT, { timeout: 30000 });
    return { page, id: e.id };
  }

  async function lineEnd(page, n) {
    await page.click(`${ROOT} p:has-text("Line ${n} of")`);
    await page.keyboard.press('End');
  }

  async function saved(page, id, want) {
    await page.evaluate(() => window.__weaveFlushDocSaves());
    let doc = '';
    for (let i = 0; i < 40; i++) {
      doc = (await fetch(`${base}/api/entities/${id}`).then((r) => r.json())).docs?.Description ?? '';
      if (want.test(doc)) return doc;
      await page.waitForTimeout(100);
    }
    return doc;
  }

  const lum = (rgb) => {
    const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => {
      const c = +v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  for (const theme of ['light', 'dark']) {
    test(`slash menu icons read clearly and the active row carries the weave highlight (${theme})`, async () => {
      const { page } = await open(`Icons ${theme}`, 'Start.\n');
      try {
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.click(`${ROOT} p`);
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('/', { delay: 40 });
        await page.waitForSelector(MENU);
        const paint = await page.evaluate(() => {
          const menu = document.querySelector('.milkdown-slash-menu');
          const items = [...menu.querySelectorAll('.menu-group li')];
          const icon = (li) => getComputedStyle(li.querySelector('svg')).color;
          const probe = document.createElement('div');
          probe.style.background = 'color-mix(in srgb, var(--tblr-primary) 9%, transparent)';
          menu.append(probe);
          const want = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const entity = items.find((li) => li.textContent.includes('Entity'));
          const tableRef = items.find((li) => li.textContent.trim() === 'Table' && li.closest('.menu-group').textContent.includes('Reference'));
          return {
            surface: getComputedStyle(menu).backgroundColor,
            icons: items.map(icon),
            active: getComputedStyle(menu.querySelector('.menu-group li.hover')).backgroundColor,
            want,
            refFills: [entity, tableRef].map((li) => [...li.querySelectorAll('svg *')].map((n) => getComputedStyle(n).fill)),
          };
        });
        for (const c of paint.icons) assert.ok(contrast(c, paint.surface) >= 3, `icon colour ${c} on ${paint.surface} reads at 3:1 or better`);
        assert.equal(paint.active, paint.want, 'the active row uses the palette highlight');
        for (const fills of paint.refFills) assert.ok(fills.every((f) => f === 'none'), `reference icons are line drawings, got ${fills}`);
      } finally { await page.close(); }
    });
  }

  test('arrowing through the slash menu scrolls the list only when the next row would leave it', async () => {
    const { page } = await open('Menu scroll');
    try {
      await lineEnd(page, 10);
      await page.keyboard.press('Enter');
      await page.keyboard.type('/', { delay: 40 });
      await page.waitForSelector(MENU);
      const tops = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(60);
        tops.push(await page.evaluate(() => {
          const list = document.querySelector('.milkdown-slash-menu .menu-groups');
          const row = list.querySelector('li.hover').getBoundingClientRect();
          const box = list.getBoundingClientRect();
          return { top: Math.round(list.scrollTop), inside: row.top >= box.top - 1 && row.bottom <= box.bottom + 1 };
        }));
      }
      assert.equal(tops[0].top, 0, 'the second row is already in view, so the list stays put');
      assert.equal(tops[1].top, 0, 'the third row is already in view, so the list stays put');
      assert.ok(tops.every((t) => t.inside), 'the active row is always fully visible');
      const moves = tops.slice(1).filter((t, i) => t.top !== tops[i].top).length;
      assert.ok(moves <= 7, `the list scrolls only as rows run out, moved on ${moves} of 11 presses`);
    } finally { await page.close(); }
  });

  test('Return and the slash menu leave the page where it was', async () => {
    const { page } = await open('Page still');
    try {
      await lineEnd(page, 10);
      const before = await page.evaluate(() => document.querySelector('#main').scrollTop);
      await page.keyboard.press('Enter');
      await page.keyboard.type('/', { delay: 40 });
      await page.waitForSelector(MENU);
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => document.querySelector('#main').scrollTop);
      assert.ok(Math.abs(after - before) <= 40, `the page held still: ${before} then ${after}`);
    } finally { await page.close(); }
  });

  test('/divider puts the caret on a new line under the rule', async () => {
    const { page, id } = await open('Divider caret');
    try {
      await lineEnd(page, 10);
      await page.keyboard.press('Enter');
      await page.keyboard.type('/divider', { delay: 40 });
      await page.waitForSelector(MENU);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      await page.keyboard.type('After', { delay: 40 });
      const doc = await saved(page, id, /After/);
      assert.match(doc, /Line 10 of filler text\.\n\n---\n\nAfter\n\nLine 11 of filler text\./);
    } finally { await page.close(); }
  });
  test('a wheel scroll right after typing is never pulled back', async () => {
    const { page } = await open('Wheel after typing');
    try {
      await lineEnd(page, 3);
      await page.keyboard.type(' more', { delay: 20 });
      const before = await page.evaluate(() => document.querySelector('#main').scrollTop);
      await page.hover(`${ROOT} p:has-text("Line 6 of")`);
      await page.mouse.wheel(0, 400);
      await page.waitForFunction((b) => document.querySelector('#main').scrollTop - b >= 300, before, { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => document.querySelector('#main').scrollTop);
      assert.ok(after - before >= 300, `the wheel moved the page: ${before} then ${after}`);
    } finally { await page.close(); }
  });
}
