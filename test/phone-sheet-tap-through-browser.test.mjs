import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile, settled } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('phone sheet tap through', (weave) => {
  weave.createSpace({ name: 'Product' });
  const tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Priority', type: 'select', config: { options: ['Low', 'High'] } });
  const row = weave.createEntity(tasks, { name: 'Ship the sheet', values: { Priority: 'Low' } });
  return { entity: `#/entity/${row.id}` };
});

if (s) {
  const { base, browser, entity } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]];
  engines.push(['webkit iPhone 15', await engineOf('webkit'), IPHONE]);

  const open = async (b, profile, theme) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${entity}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .title-edit.name-edit');
    return page;
  };

  const tapOverTitle = async (page, sheet) => {
    await page.waitForSelector(sheet);
    await settled(page.locator(sheet));
    const title = await page.locator('#main .title-edit.name-edit').boundingBox();
    const was = await page.evaluate(() => ({
      theme: document.documentElement.dataset.bsTheme,
      name: document.querySelector('#main .title-edit.name-edit').value,
    }));
    await page.touchscreen.tap(Math.round(title.x + title.width / 2), Math.round(title.y + title.height / 2));
    await page.waitForSelector(sheet, { state: 'detached' });
    await page.keyboard.type('x');
    return page.evaluate((before) => {
      const box = document.querySelector('#main .title-edit.name-edit');
      return {
        theme: document.documentElement.dataset.bsTheme,
        editing: document.activeElement === box,
        focus: document.activeElement?.tagName ?? '',
        renamed: box.value !== before.name,
        before: before.name,
        now: box.value,
      };
    }, was);
  };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`the tap that closes the phone record menu does not reach the title under it (${engine}, ${theme}, Issue #1384)`, async () => {
        const page = await open(b, profile, theme);
        try {
          await page.click('#main .view-header .dots-btn');
          const seen = await tapOverTitle(page, '.chip-pop.wv-menu-sheet');
          assert.equal(seen.theme, theme);
          assert.equal(seen.editing, false, `the title took focus from the closing tap (${seen.focus})`);
          assert.equal(seen.renamed, false, `a keypress after the tap renamed the record: ${seen.before} → ${seen.now}`);
        } finally { await page.close(); }
      });

      test(`the tap that closes a phone picker sheet does not reach the title under it (${engine}, ${theme}, Issue #1384)`, async () => {
        const page = await open(b, profile, theme);
        try {
          await page.click('#main .chip-trigger[title="Priority"]');
          const seen = await tapOverTitle(page, '.chip-pop.picker-pop');
          assert.equal(seen.theme, theme);
          assert.equal(seen.editing, false, `the title took focus from the closing tap (${seen.focus})`);
          assert.equal(seen.renamed, false, `a keypress after the tap renamed the record: ${seen.before} → ${seen.now}`);
        } finally { await page.close(); }
      });
    }
  }
}
