/* Issue #574: a column of amounts reads as one column. A number cell whose
   costume printed the same text as the raw value (44.22 at two decimals)
   rested as the bare input, which sat flush left, while 44.20 and 50.00
   rested as the dressed span on the right; formula and rollup cells holding
   a number took no right-align at all. Every figure in a numeric column ends
   on the same right edge, whichever element paints it.

   Issue #575: a Description column with nothing in it opened at 280px, the
   widest default on the grid, for a column of placeholders. An empty one
   opens at the text width; one with prose keeps the long-text width. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let ledger, accounts, notes, rows;
const s = await launch('number alignment', (weave) => {
  weave.createSpace({ name: 'Money' });
  ledger = weave.createTable({ space: 'Money', name: 'Transaction' });
  accounts = weave.createTable({ space: 'Money', name: 'Account' });
  notes = weave.createTable({ space: 'Money', name: 'Note' });
  weave.addField(ledger, { name: 'Amount', type: 'number', config: { decimals: 2 } });
  weave.addField(ledger, { name: 'Plain', type: 'number' });
  weave.addField(ledger, { name: 'Grouped', type: 'number', config: { separator: true } });
  weave.addField(ledger, { name: 'Double', type: 'formula', config: { expression: '[Plain] * 2' } });
  weave.addRelation(ledger, { name: 'Account', targetDb: accounts, cardinality: 'many-to-one', inverseName: 'Transactions' });
  weave.addField(accounts, { name: 'Total', type: 'rollup', config: { relationField: 'Transactions', targetField: 'Plain', aggregate: 'sum' } });
  weave.addField(accounts, { name: 'Count', type: 'rollup', config: { relationField: 'Transactions', aggregate: 'count' } });
  const a = weave.createEntity(accounts, { name: 'Checking' });
  const b = weave.createEntity(accounts, { name: 'Savings' });
  rows = [44.22, 44.2, 50, 1234.5].map((n, i) => weave.createEntity(ledger, {
    name: `T${i}`, values: { Amount: n, Plain: n, Grouped: n, Account: i % 2 ? b.id : a.id },
  }));
  weave.createEntity(notes, { name: 'Empty one' });
  weave.createEntity(notes, { name: 'Empty two' });
});

if (s) {
  const { base, browser } = s;
  const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  async function grid(tableId) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 700 } });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await settle(page);
    return page;
  }
  /* Where each cell's figure ends, measured against its cell's content box:
     a text input's glyphs are not boxes, so the input reports where its text
     is aligned and how much room it leaves; anything else reports the right
     edge of its painted text. 0 is flush right. */
  const gaps = (page, field) => page.$$eval(`.wv-grid tbody tr.entity-row td[data-field="${field}"]`, (tds) => tds.map((td) => {
    const box = td.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(td).paddingRight) + parseFloat(getComputedStyle(td).borderRightWidth);
    const input = td.querySelector('input');
    // The last painted text node: a computed cell leads with its ƒ or Σ mark.
    const walk = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    let shown = null;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.textContent.trim() && n.parentElement.offsetParent) shown = n;
    if (input && input.offsetParent && !shown) {
      const cs = getComputedStyle(input);
      return { text: input.value, align: cs.textAlign };
    }
    const range = document.createRange();
    range.selectNodeContents(shown);
    const r = range.getBoundingClientRect();
    return { text: shown.textContent.trim(), gap: Math.round(box.right - pad - r.right) };
  }));
  const flushRight = (cells, label) => {
    for (const c of cells) {
      if ('align' in c) assert.ok(['right', 'end'].includes(c.align), `${label} ${c.text}: the input aligns ${c.align}`);
      else assert.ok(c.gap <= 8, `${label} ${c.text}: ${c.gap}px short of the right edge`);
    }
  };

  test('every amount in a two-decimal column ends on the right edge, 44.22 included (Issue #574)', async () => {
    const page = await grid(ledger.id);
    try {
      flushRight(await gaps(page, 'Amount'), 'Amount');
      flushRight(await gaps(page, 'Plain'), 'Plain');
    } finally { await page.close(); }
  });

  test('a separator costume keeps the decimals it was given (Issue #574)', async () => {
    const page = await grid(ledger.id);
    try {
      const texts = (await gaps(page, 'Grouped')).map((c) => c.text);
      assert.deepEqual(texts, ['44.22', '44.2', '50', '1,234.5']);
    } finally { await page.close(); }
  });

  test('formula and rollup cells holding a number sit on the right like a number (Issue #574)', async () => {
    const page = await grid(ledger.id);
    try {
      flushRight(await gaps(page, 'Double'), 'Double');
    } finally { await page.close(); }
    const acc = await grid(accounts.id);
    try {
      flushRight(await gaps(acc, 'Total'), 'Total');
      flushRight(await gaps(acc, 'Count'), 'Count');
    } finally { await acc.close(); }
  });

  test('an empty Description column opens at the text width, not the widest slot (Issue #575)', async () => {
    const page = await grid(notes.id);
    const width = (p) => p.$eval('.wv-grid thead th.col-head[data-col="Description"]', (th) => Math.round(th.getBoundingClientRect().width));
    try {
      assert.equal(await width(page), 180, 'an empty description opens at the text width');
    } finally { await page.close(); }
    s.weave.setDoc(rows[0].id, 'Groceries for the week, split with Sam.');
    const full = await grid(ledger.id);
    try {
      assert.equal(await width(full), 280, 'a description with prose keeps the long-text width');
    } finally { await full.close(); }
  });
}
