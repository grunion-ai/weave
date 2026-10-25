import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf, eventually } from './lib/browser.mjs';

let bare;
let mixed;
let gone;
let placed;
let feature;
let featureTable;
let notes;

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

  notes = weave.createTable({ space: 'Development', name: 'Note' });
  weave.addField(notes, { name: 'Owner', type: 'text' });
  placed = weave.createEntity(notes, { name: 'Standup', values: { Owner: 'Kyle' } });
  weave.attachFile(placed.id, { name: 'agenda.txt', mime: 'text/plain', bytes: Buffer.from('a') });

  featureTable = weave.createTable({ space: 'Development', name: 'Feature' });
  weave.addField(featureTable, { name: 'Files', type: 'text' });
  feature = weave.createEntity(featureTable, { name: 'View pane' });
  weave.attachFile(feature.id, { name: 'weave-view-pane-mockup.html', mime: 'text/html', bytes: Buffer.from('<h1>m</h1>') });
  weave.attachFile(feature.id, { name: 'notes.txt', mime: 'text/plain', bytes: Buffer.from('n') });
});

if (s) {
  const { base, browser, weave } = s;
  async function open(hash, theme, ready, width = 1400) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
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

  for (const theme of ['light', 'dark']) {
    test(`the Files card is a body block with a grip and a caret that remembers (${theme})`, async () => {
      const page = await open(`/entity/${bare.id}`, theme, '.entity-files-card');
      const card = page.locator('.entity-files-card');
      assert.equal(await card.getAttribute('data-block'), '@files', 'the card has no place among the body blocks');
      assert.equal(await card.locator('.opt-grip.wv-reorder-handle').count(), 1, 'the card has no drag grip');
      const caret = card.locator('.doc-caret');
      assert.equal(await caret.getAttribute('aria-expanded'), 'true');
      await caret.click();
      assert.equal(await styleOf(card.locator('.attach-chips'), 'display', 'none'), 'none', 'the caret does not fold the card');
      assert.equal(await caret.getAttribute('aria-expanded'), 'false', 'the caret does not say the card is closed');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.entity-files-card');
      assert.equal(await styleOf(page.locator('.entity-files-card .attach-chips'), 'display', 'none'), 'none', 'the fold is forgotten on reload');
      const button = page.locator('.entity-files-card .entity-files-make');
      assert.equal((await button.textContent()).trim(), 'Make a field');
      const [fg, bg] = await button.evaluate((n) => [getComputedStyle(n).color, getComputedStyle(document.body).backgroundColor]);
      assert.notEqual(fg, bg, 'the button text vanishes into the page');
      await page.close();
    });
  }

  test('the Files card takes the place the body order gives it', async () => {
    weave.updateTable(notes, { bodyOrder: ['@files', '@values'] });
    const page = await open(`/entity/${placed.id}`, null, '.entity-files-card');
    const order = await page.$$eval('.entity-body > [data-block]', (ns) => ns.map((n) => n.dataset.block));
    assert.deepEqual(order.slice(0, 2), ['@files', '@values'], 'the card ignores the body order');
    await page.close();
  });

  test('the Files card fits a phone screen', async () => {
    const page = await open(`/entity/${bare.id}`, null, '.entity-files-card', 390);
    const fit = await page.$eval('.entity-files-card', (card) => {
      const c = card.getBoundingClientRect();
      const b = card.querySelector('.entity-files-make').getBoundingClientRect();
      return { inside: b.right <= c.right + 0.5 && b.left >= c.left - 0.5, scroll: document.scrollingElement.scrollWidth <= innerWidth };
    });
    assert.deepEqual(fit, { inside: true, scroll: true }, 'the card header spills off a phone screen');
    await page.close();
  });

  test('Make a field moves the loose files into a new attachments field', async () => {
    const page = await open(`/entity/${feature.id}`, null, '.entity-files-card');
    const ids = weave.getEntity(feature.id).files.map((f) => f.id);
    await page.locator('.entity-files-card .entity-files-make').click();
    await page.waitForSelector('.entity-files-card', { state: 'detached' });
    const field = weave.findField(weave.getTable(featureTable), 'Files 2');
    assert.equal(field?.type, 'attachments', 'no attachments field was made, or its name collides with Files');
    assert.deepEqual(weave.getEntity(feature.id).values[field.id], ids, 'the field value does not list the files');
    assert.equal(weave.getEntity(feature.id).files.length, 2, 'the bytes were uploaded again');
    const drawn = await eventually(() => page.$$eval('[data-block="Files 2"] .attach-item', (ns) => ns.length), 2);
    assert.equal(drawn, 2, 'the field block does not show the files');
    await page.close();
  });
}
