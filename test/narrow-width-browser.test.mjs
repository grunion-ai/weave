import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const WIDE = 1440;
const NARROW = 375;
const STEP = 20;
const FLOOR = 110;

const READ = () => {
  const label = (f) => (f.children[1]?.textContent || '').trim().slice(0, 12);
  return {
    vw: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    values: [...document.querySelectorAll('#dock .entity-values .fieldrow')]
      .filter((f) => f.getClientRects().length)
      .map((f) => {
        const tracks = getComputedStyle(f).gridTemplateColumns.split(' ').map(parseFloat);
        return [label(f), Math.round(tracks[tracks.length - 1])];
      }),
    squashed: [...document.querySelectorAll('#dock .entity-values .fieldrow > :nth-child(3)')]
      .filter((v) => v.getClientRects().length && !v.matches('input, textarea') && v.scrollWidth > v.clientWidth + 1)
      .map((v) => `${(v.textContent || '').trim().slice(0, 12)} ${v.scrollWidth}>${v.clientWidth}`),
  };
};

const s = await launch('narrow width sweep', (weave) => {
  weave.createSpace({ name: 'Money' });
  const expense = weave.createTable({ space: 'Money', name: 'Expense' });
  weave.addField(expense, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Paid', category: 'done' }] } });
  weave.addField(expense, { name: 'Category', type: 'select', config: { options: ['Rent', 'Food', 'Travel'] } });
  weave.addField(expense, { name: 'Amount', type: 'number' });
  weave.addField(expense, { name: 'Vendor', type: 'text' });
  weave.addField(expense, { name: 'Due', type: 'date' });
  weave.addField(expense, { name: 'Note', type: 'text' });
  const rows = [];
  for (let i = 0; i < 12; i++) {
    rows.push(weave.createEntity(expense, {
      name: `Expense ${i}: a reasonably long record name`,
      values: { Status: 'Open', Category: 'Food', Amount: 120 + i, Vendor: 'A vendor name', Note: 'a note that is a little long' },
    }));
  }
  return { table: expense.id, row: rows[0].id };
});

if (s) {
  const { base, browser, table, row } = s;
  const sweep = async (theme, hash, ready) => {
    const page = await browser.newPage({ viewport: { width: WIDE, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    const seen = [];
    for (let w = WIDE; w >= NARROW; w -= STEP) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForFunction((want) => innerWidth === want, w);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      seen.push(await page.evaluate(READ));
    }
    await page.close();
    return seen;
  };

  for (const theme of ['light', 'dark']) {
    test(`the row page keeps every field value readable from ${WIDE}px down to ${NARROW}px (${theme}, Issue #577)`, async () => {
      const seen = await sweep(theme, `#/table/${table}?e=${row}`, '#dock .entity-values .fieldrow');
      const thin = [];
      for (const step of seen) {
        assert.ok(step.values.length >= 6, `the row pane shows its fields at ${step.vw}px`);
        for (const [name, width] of step.values) if (width < FLOOR) thin.push(`${step.vw}px: ${name} has ${width}px of value column`);
        for (const v of step.squashed) thin.push(`${step.vw}px: ${v} is squashed inside its column`);
      }
      assert.deepEqual(thin, [], `the field value column fell under ${FLOOR}px:\n${thin.join('\n')}`);
    });
  }

  test(`no page spills past the window from ${WIDE}px down to ${NARROW}px (Issue #577)`, async () => {
    for (const [name, hash, ready] of [
      ['table page', `#/table/${table}`, '#main .wv-grid tbody tr.entity-row'],
      ['row page', `#/table/${table}?e=${row}`, '#dock .entity-values .fieldrow'],
    ]) {
      const seen = await sweep('light', hash, ready);
      const spills = seen.filter((step) => step.scrollWidth > step.vw + 1)
        .map((step) => `${name} at ${step.vw}px scrolls to ${step.scrollWidth}px`);
      assert.deepEqual(spills, [], spills.join('\n'));
    }
  });
}
