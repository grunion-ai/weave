import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
let doc;
const s = await launch('menu opacity', (weave) => {
  weave.createSpace({ name: 'Showcase' });
  const docs = weave.createTable({ space: 'Showcase', name: 'Documents' });
  weave.addField(docs, { name: 'Brief', type: 'document' });
  doc = weave.createEntity(docs, {
    name: 'Handbook',
    docs: { Brief: '# Brief\n\nhandbook sync +218\n\ncli +2117\n\nThe body of the document, long enough to draw.' },
  });
});
if (s) {
  const { base, browser } = s;
  const setTheme = (page, want) => page.evaluate((w) => {
    const btn = document.querySelector('#theme-toggle');
    for (let i = 0; i < 4 && document.documentElement.dataset.bsTheme !== w; i++) btn.click();
  }, want);
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/#/entity/${doc.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-section .doc-dl .dots-btn');
    return page;
  };
  const opacityOf = (page, sel) => page.$eval(sel, (n) => getComputedStyle(n).opacity);
  for (const theme of ['light', 'dark']) {
    test(`the open document downloads menu is fully opaque (${theme}, Issue #430)`, async () => {
      const page = await open();
      await setTheme(page, theme);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(250);
      assert.equal(await opacityOf(page, '.doc-section .doc-dl > .dots-btn'), '0', 'the trigger rests hidden');
      await page.hover('.doc-section');
      await page.waitForTimeout(250);
      assert.equal(await opacityOf(page, '.doc-section .doc-dl > .dots-btn'), '0.7', 'the trigger fades in on hover');
      await page.click('.doc-section .doc-dl > .dots-btn');
      await page.waitForSelector('.doc-section .doc-dl .dl-menu:not(.hidden)');
      await page.waitForTimeout(250);
      const chain = await page.$eval('.doc-section .doc-dl .dl-menu', (menu) => {
        const out = [];
        for (let n = menu; n; n = n.parentElement) out.push(Number(getComputedStyle(n).opacity));
        return out;
      });
      const product = chain.reduce((a, b) => a * b, 1);
      assert.equal(product, 1, `opacity chain from the menu to the root is ${JSON.stringify(chain)}`);
      assert.equal(await opacityOf(page, '.doc-section .doc-dl > .dots-btn'), '1', 'the trigger is held lit while its menu is open');
      await page.close();
    });
  }
}
