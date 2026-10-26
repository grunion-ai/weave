import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let bare;
let mixed;
let gone;

const s = await launch('ledger files on the entity page', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  bare = weave.createEntity(issues, { name: 'Grid drops a row' });
  weave.attachFile(bare.id, { name: 'before-light.png', mime: 'image/png', bytes: Buffer.from('a') });
  gone = weave.attachFile(bare.id, { name: 'after-dark.png', mime: 'image/png', bytes: Buffer.from('b') });
  delete weave.state.fileBlobs[gone.id];

  const decks = weave.createTable({ space: 'Development', name: 'Deck' });
  weave.addField(decks, { name: 'Slides', type: 'attachments' });
  mixed = weave.createEntity(decks, { name: 'Q3 review' });
  weave.attachToField(mixed.id, 'Slides', { name: 'in-field.html', mime: 'text/html', bytes: Buffer.from('<h1>a</h1>') });
  weave.attachFile(mixed.id, { name: 'ledger-only.html', mime: 'text/html', bytes: Buffer.from('<h1>b</h1>') });
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
  const itemsOn = (page) => page.$$eval('.entity-files-card .attach-item', (ns) => ns.map((n) => ({
    text: n.textContent,
    missing: n.classList.contains('is-missing'),
    href: n.querySelector('a')?.getAttribute('href') ?? null,
  })));

  for (const theme of ['light', 'dark']) {
    test(`a row whose table has no attachments field still reaches its files (${theme})`, async () => {
      const page = await open(`/entity/${bare.id}`, theme, '.entity-files-card');
      const items = await itemsOn(page);
      assert.equal(items.length, 2, 'the Files card does not list the whole ledger');
      const kept = items.find((i) => i.text.includes('before-light.png'));
      const lost = items.find((i) => i.text.includes('after-dark.png'));
      assert.ok(kept?.href?.includes('/api/files/'), 'the live file is not downloadable from the page');
      assert.equal(kept.missing, false, 'a live file must not be marked missing');
      assert.equal(lost.missing, true, 'the lost file is not marked');
      assert.equal(lost.href, null, 'a lost file still offers a link that 404s');
      assert.match(lost.text, /missing/i, 'the lost file does not say it is gone');
      const dimmed = await page.$eval('.entity-files-card .attach-item.is-missing', (n) => {
        const rgb = getComputedStyle(n).color.match(/[\d.]+/g).map(Number);
        return rgb.length < 4 || rgb[3] > 0.5;
      });
      assert.ok(dimmed, 'the missing mark is invisible');
      await page.close();
    });

    test(`the Files card is drawn outside the side column (${theme})`, async () => {
      const page = await open(`/entity/${bare.id}`, theme, '.entity-files-card');
      const outside = await page.$eval('.entity-files-card', (n) => !n.closest('.entity-side'));
      assert.ok(outside, 'the Files card hides with the side column');
      const shown = await page.$eval('.entity-files-card', (n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      assert.ok(shown, 'the Files card has no box');
      await page.close();
    });
  }

  test('a file an attachments field already draws is not listed twice', async () => {
    const page = await open(`/entity/${mixed.id}`, null, '.entity-files-card');
    const items = await itemsOn(page);
    assert.deepEqual(items.map((i) => i.text.trim()), ['ledger-only.html'],
      'the Files card repeats what the field already shows');
    await page.close();
  });
}
