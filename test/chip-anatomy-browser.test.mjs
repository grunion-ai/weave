/* Feature #180: the Handbook's "Chip and card anatomy" guide renders in-app.
   Its figures are raw HTML carrying the real chip and card classes. Vditor's
   IR renderer has to let them through whole — classes, inline outlines, the
   numbered badges — at the app's own chip size, so the page shows the thing
   it documents, not a picture of it. Playwright is imported by the shared
   harness and the suite skips without it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seedWeaver } from '../src/weaver-seed.js';

const s = await launch('chip anatomy guide', (weave) => {
  seedWeaver(weave);
  return { guide: weave.findEntity(weave.getTable('Handbook/Guide'), 'Chip and card anatomy') };
});
if (s) {
  const { base, browser, guide } = s;
  test('the Chip and card anatomy guide renders its figures in the app, with every hitbox outlined', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(`${base}/#/entity/${guide.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-anat .k-rel');
    const seen = await page.evaluate(() => ({
      figures: document.querySelectorAll('.wv-anat').length,
      badges: [...document.querySelectorAll('.wv-anat .wv-anat-n')].map((n) => n.textContent),
      outlined: [...document.querySelectorAll('.wv-anat [style*="dashed"]')].filter((n) => getComputedStyle(n).outlineStyle === 'dashed').length,
      chipFont: getComputedStyle(document.querySelector('.wv-anat .k-rel')).fontSize,
      card: !!document.querySelector('.wv-anat .wv-card .wv-card-fields dd'),
      sans: !/mono|Menlo|Consolas/i.test(getComputedStyle(document.querySelector('.wv-anat .k-rel > a')).fontFamily),
    }));
    assert.equal(seen.figures, 2, 'the chip figure and the card figure');
    assert.deepEqual(seen.badges, ['1', '2', '3', '4', '5', '6', '7', '8', '10', '9', '11', '12', '13'], 'every element is numbered');
    assert.equal(seen.outlined, 13, 'every numbered element draws its hitbox as a dashed outline');
    assert.equal(seen.chipFont, '13px', 'the specimen is the real chip at the token size, not a picture of one');
    assert.ok(seen.card, 'the card figure carries its field pairs');
    assert.ok(seen.sans, 'the figure escapes the raw-HTML preview\'s monospace — it reads as the app draws it');
    assert.equal(await page.$eval('.wv-anat .mention-caret', (c) => c.closest('.mention-wrap').classList.contains('open')), true,
      'the specimen is drawn open, so the segments and the retract caret (‹) are on show');
    await page.close();
  });

}
