/* Issue #121 — "file missing?".

   An attachment whose blob is gone kept the full chrome of one that is
   there: the entity page drew a live-looking anchor, and clicking it landed
   the reader on raw 404 JSON. That is why the report is a question — the
   reporter could not tell whether the file was lost or the app was broken.

   A blob that is gone must SAY it is gone, on the entity page and in the
   grid cell, in both themes, and it must not offer a link that cannot work.

   Rendering, not engine state: this suite drives a real browser. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let decks;
let row;
let here;
let gone;

const s = await launch('missing attachments', (weave) => {
  weave.createSpace({ name: 'Product' });
  decks = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(decks, { name: 'Slides', type: 'attachments' });
  row = weave.createEntity(decks, { name: 'Q3 review' });
  here = weave.attachToField(row.id, 'Slides', { name: 'kept.html', mime: 'text/html', bytes: Buffer.from('<h1>a</h1>') });
  gone = weave.attachToField(row.id, 'Slides', { name: 'c-json-editor.html', mime: 'text/html', bytes: Buffer.from('<h1>b</h1>') });
  // The blob evaporates; the metadata row survives. Exactly the state Kyle's
  // uno workspace was in — an export/import round trip left it that way.
  delete weave.state.fileBlobs[gone.id];
});

if (s) {
  const { base, browser } = s;

  async function open(hash, theme, ready) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#${hash}`, { waitUntil: 'networkidle' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector(ready);
    return page;
  }

  for (const theme of ['light', 'dark']) {
    test(`the entity page marks the lost file and links only the live one (${theme})`, async () => {
      const page = await open(`/entity/${row.id}`, theme, '.attach-item');
      const items = await page.$$eval('.attach-item', (ns) => ns.map((n) => ({
        text: n.textContent,
        missing: n.classList.contains('is-missing'),
        href: n.querySelector('a')?.getAttribute('href') ?? null,
      })));
      const kept = items.find((i) => i.text.includes('kept.html'));
      const lost = items.find((i) => i.text.includes('c-json-editor.html'));
      assert.ok(kept?.href?.includes('/api/files/'), 'the live file lost its link');
      assert.equal(kept.missing, false, 'a live file must not be marked missing');
      assert.equal(lost.missing, true, 'the lost file is not marked');
      assert.equal(lost.href, null, 'a lost file still offers a link that 404s');
      assert.match(lost.text, /missing/i, 'the lost file does not say it is gone');
      // The mark must be visible, not merely in the DOM: it reads in the
      // colour the rest of the app dims with, in both themes.
      const dimmed = await page.$eval('.attach-item.is-missing', (n) => {
        const rgb = getComputedStyle(n).color.match(/[\d.]+/g).map(Number);
        return { rgb, opaque: rgb.length < 4 || rgb[3] > 0.5 };
      });
      assert.ok(dimmed.opaque, 'the missing mark is invisible');
      await page.close();
    });

    test(`the grid cell names the lost file as missing (${theme})`, async () => {
      const page = await open(`/table/${decks.id}`, theme, '.wv-grid tbody tr');
      const cell = await page.$eval('td[data-field="Slides"]', (n) => n.textContent);
      assert.match(cell, /kept\.html/, 'the cell stopped naming its files');
      assert.match(cell, /c-json-editor\.html \(missing\)/, 'the grid cell hides the loss');
      await page.close();
    });
  }
}
