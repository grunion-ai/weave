/* The formula builder's chips teach, driven through a real browser
   (design review 2026-09-01, direction A; landed 2026-09-07).

   Twenty-two flat chips made the vocabulary look bigger than it is, and the
   title-attribute tooltip was the only place a signature lived — invisible
   on touch and to an agent reading the DOM. Now the function chips sit in
   the four groups the grammar has (logic, text, number, date), and hovering,
   focusing or tapping a chip shows a card with the signature, one sentence
   of doc and an example. Fields a formula cannot read (documents,
   attachments) are listed greyed with the reason instead of vanishing —
   a silent absence reads as a bug.

   Playwright is NOT a dependency of weave; it is imported dynamically and
   the suite skips when absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals;

const s = await launch('formula builder chips', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  weave.addField(deals, { name: 'Close Date', type: 'date' });
  weave.addField(deals, { name: 'Notes', type: 'document' });
  weave.addField(deals, { name: 'Files', type: 'attachments' });
  weave.createEntity(deals, { name: 'Acme deal', values: { Amount: 12000 } });
});

if (s) {
  const { browser, base } = s;

  /* The add-field tray with the ƒ toggle on: the builder is drawn. */
  const openBuilder = async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.click('.wv-grid .add-field-btn');
    await page.waitForSelector('#tray');
    await page.locator('#tray .fx-toggle input').check();
    await page.waitForSelector('#tray .fx-expr');
    return page;
  };

  test('function chips sit in four labelled groups, every function once', async () => {
    const page = await openBuilder();
    const labels = await page.locator('#tray .fx-chip-row.fn-group .fx-chip-lbl').allTextContents();
    assert.deepEqual(labels, ['logic', 'text', 'number', 'date']);
    const names = await page.locator('#tray .fx-chip.fn').allTextContents();
    assert.equal(new Set(names).size, names.length, 'no chip twice');
    assert.ok(names.includes('dateadd()') && names.includes('if()'));
    const dateRow = page.locator('#tray .fx-chip-row.fn-group', { has: page.locator('.fx-chip-lbl', { hasText: /^date$/ }) });
    assert.ok((await dateRow.locator('.fx-chip', { hasText: 'today()' }).count()) === 1, 'today lives under date');
    await page.close();
  });

  test('hover and focus show a signature card, not a title tooltip', async () => {
    const page = await openBuilder();
    const chip = page.locator('#tray .fx-chip.fn', { hasText: 'dateadd()' });
    assert.equal(await chip.getAttribute('title'), null, 'the card replaces the title attribute');
    const card = page.locator('#tray .fx-sigcard');
    assert.equal(await card.isVisible(), false, 'no card until a chip is pointed at');
    await chip.hover();
    await card.waitFor({ state: 'visible' });
    assert.equal(await card.locator('.sig').textContent(), 'dateadd(date, n, unit)');
    assert.match(await card.locator('.doc').textContent(), /\w{4,}/);
    assert.match(await card.locator('.eg').textContent(), /^dateadd\(/);
    // Leave the chip: the card goes. Focus it from the keyboard: the card returns.
    await page.mouse.move(5, 5);
    await card.waitFor({ state: 'hidden' });
    await chip.focus();
    await card.waitFor({ state: 'visible' });
    assert.equal(await card.locator('.sig').textContent(), 'dateadd(date, n, unit)');
    await page.close();
  });

  test('a tap on a chip inserts the call and keeps the card up', async () => {
    const page = await openBuilder();
    const chip = page.locator('#tray .fx-chip.fn', { hasText: 'upper()' });
    await chip.click();
    assert.equal(await page.inputValue('#tray .fx-expr'), 'upper()');
    // The caret landed between the parens.
    const pos = await page.evaluate(() => document.querySelector('#tray .fx-expr').selectionStart);
    assert.equal(pos, 6);
    await page.close();
  });

  test('documents and attachments are listed greyed with the reason, and insert nothing', async () => {
    const page = await openBuilder();
    const notes = page.locator('#tray .fx-chip.excluded', { hasText: 'Notes' });
    assert.equal(await notes.count(), 1, 'the document field is still listed');
    assert.equal(await notes.isDisabled(), true);
    assert.match(await notes.getAttribute('aria-label'), /document/);
    const files = page.locator('#tray .fx-chip.excluded', { hasText: 'Files' });
    assert.equal(await files.isDisabled(), true);
    await notes.hover({ force: true });
    const card = page.locator('#tray .fx-sigcard');
    await card.waitFor({ state: 'visible' });
    assert.match(await card.locator('.doc').textContent(), /document/);
    await notes.click({ force: true });
    assert.equal(await page.inputValue('#tray .fx-expr'), '', 'a greyed chip inserts nothing');
    // A readable field still inserts its token.
    await page.locator('#tray .fx-chip:not(.fn):not(.excluded)', { hasText: 'Close Date' }).click();
    assert.equal(await page.inputValue('#tray .fx-expr'), '[Close Date]');
    await page.close();
  });
}
