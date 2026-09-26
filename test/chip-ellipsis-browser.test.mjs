/* A value chip longer than its column ends in an ellipsis inside its own fill
   (Issue #423). Kyle's screenshot, uno › Travel › Points Balances: the Program
   chips read "Chase Ultimate Re", "Amex Membership", "United MileagePlu". The
   chip box was capped at the column (`.wv-grid .k { max-width: 100% }`) but
   its text was an anonymous flex item with overflow visible, so it ran past
   the fill and the <td> cut it mid-letter. The td's own text-overflow never
   reaches text inside an inline-flex child. The label is now its own span that
   truncates, the chip clips at its fill, and a truncated label carries the
   whole value as its title. State, multi-select and key chips share `.k`, so
   they are held to the same rule.
   Geometry, not source: this suite drives a real browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const PROGRAM = 'Amex Membership Rewards Program';
const STATE = 'Waiting on the issuing bank';
const TAG = 'Transferable to airline partners';
const KEY = 'stripe-live-production-account';
const COL = 124;

let table, row, shortRow, pairRow;
const s = await launch('chip ellipsis', (weave) => {
  weave.createSpace({ name: 'Travel' });
  table = weave.createTable({ space: 'Travel', name: 'Balance' });
  weave.addField(table, { name: 'Program', type: 'select', config: { options: [PROGRAM, 'Hyatt'] } });
  weave.addField(table, {
    name: 'Stage', type: 'workflow',
    config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: STATE, category: 'in-progress' }] },
  });
  weave.addField(table, { name: 'Tags', type: 'multiselect', config: { options: [TAG, 'Cash'] } });
  weave.addField(table, { name: 'Secret', type: 'key' });
  row = weave.createEntity(table, { name: 'Long', values: { Program: PROGRAM, Tags: [TAG], Secret: KEY } });
  weave.setState(row.id, 'Stage', STATE);
  shortRow = weave.createEntity(table, { name: 'Short', values: { Program: 'Hyatt', Tags: ['Cash'] } });
  pairRow = weave.createEntity(table, { name: 'Pair', values: { Tags: ['Cash', TAG] } });
  const v = weave.tableView(table.id).views[0];
  weave.tableView(`${table.id}/${v.id}`, { widths: { Program: COL, Stage: COL, Tags: COL, Secret: COL } });
});

if (s) {
  const { base, browser } = s;
  const CHIPS = { Program: '.k-select', Stage: '.k-state', Tags: '.k-multi', Secret: '.k-key' };

  async function grid(colorScheme) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${row.id}"] .k-select`);
    await page.waitForTimeout(300); // the clipped marker is written in a rAF after layout
    return page;
  }
  const measure = (page, id) => page.evaluate(({ id, chips }) => {
    const tr = document.querySelector(`tr[data-eid="${id}"]`);
    const out = {};
    for (const [field, sel] of Object.entries(chips)) {
      const td = tr.querySelector(`td[data-field="${field}"]`);
      const chip = td?.querySelector(sel);
      const label = chip?.querySelector(':scope > .k-label');
      if (!chip || !label) { out[field] = { chip: !!chip, label: false }; continue; }
      const c = chip.getBoundingClientRect();
      const l = label.getBoundingClientRect();
      const t = td.getBoundingClientRect();
      const ccs = getComputedStyle(chip);
      out[field] = {
        chip: true, label: true,
        text: label.textContent,
        truncated: label.scrollWidth > label.clientWidth + 1,
        textOverflow: getComputedStyle(label).textOverflow,
        chipOverflow: ccs.overflowX,
        // the label ends inside the fill, keeping the chip's right padding
        insideFill: l.right <= c.right - parseFloat(ccs.paddingRight) + 0.5,
        insideCell: c.right <= t.right + 0.5,
        title: label.title,
        clipped: td.classList.contains('clipped'),
      };
    }
    return out;
  }, { id, chips: CHIPS });

  for (const colorScheme of ['light', 'dark']) {
    test(`a chip longer than its column ends in an ellipsis inside its fill (${colorScheme})`, async () => {
      const page = await grid(colorScheme);
      try {
        const m = await measure(page, row.id);
        for (const [field, r] of Object.entries(m)) {
          assert.ok(r.chip, `${field}: the chip is drawn`);
          assert.ok(r.label, `${field}: the chip's label is its own span, so it can truncate`);
          assert.equal(r.truncated, true, `${field}: the long value really is cut short (it needs more than ${COL}px)`);
          assert.equal(r.textOverflow, 'ellipsis', `${field}: and it is cut with an ellipsis, not mid-letter`);
          assert.equal(r.chipOverflow, 'hidden', `${field}: nothing paints past the chip's fill`);
          assert.ok(r.insideFill, `${field}: the label ends inside the fill, before the chip's right padding`);
          assert.ok(r.insideCell, `${field}: the chip fits its column`);
          assert.equal(r.title, r.text, `${field}: hovering the cut label shows the whole value`);
          assert.equal(r.clipped, true, `${field}: the cell is marked clipped, so the hover expansion still opens`);
        }
      } finally { await page.close(); }
    });
  }

  test('a chip that fits is left whole: no ellipsis, no title, no clipped marker', async () => {
    const page = await grid('light');
    try {
      const m = await measure(page, shortRow.id);
      for (const field of ['Program', 'Tags']) {
        assert.ok(m[field].label, `${field}: the short chip has its label span too`);
        assert.equal(m[field].truncated, false, `${field}: a value that fits is not cut`);
        assert.equal(m[field].title, '', `${field}: and carries no title, since nothing is hidden`);
        assert.equal(m[field].clipped, false, `${field}: and the cell is not marked`);
      }
    } finally { await page.close(); }
  });

  test('a short multi chip beside a long one keeps its width: the cell clips the row, not each chip', async () => {
    const page = await grid('light');
    try {
      const cut = await page.evaluate((id) => {
        const td = document.querySelector(`tr[data-eid="${id}"] td[data-field="Tags"]`);
        return [...td.querySelectorAll('.k-multi')].map((k) => {
          const l = k.querySelector(':scope > .k-label');
          return { text: l?.textContent, cut: l ? l.scrollWidth - l.clientWidth : null };
        });
      }, pairRow.id);
      const cash = cut.find((c) => c.text === 'Cash');
      assert.ok(cash, 'the short chip is drawn with its label span');
      assert.ok(cash.cut <= 1, `a neighbour never squeezes a short chip into an ellipsis (${cash.cut}px hidden)`);
    } finally { await page.close(); }
  });

  test('a repainted select chip keeps its truncating label', async () => {
    const page = await grid('light');
    try {
      await page.click(`tr[data-eid="${shortRow.id}"] td[data-field="Program"] .k-select`);
      await page.keyboard.type('Amex');
      await page.keyboard.press('Enter');
      await page.waitForFunction((id) => document.querySelector(`tr[data-eid="${id}"] td[data-field="Program"] .k-select`)?.textContent.includes('Amex'), shortRow.id);
      await page.waitForTimeout(300);
      const m = await measure(page, shortRow.id);
      assert.ok(m.Program.label, 'the repainted chip still has its label span');
      assert.equal(m.Program.textOverflow, 'ellipsis');
      assert.equal(m.Program.truncated, true);
      assert.ok(m.Program.insideFill, 'and still ends inside its fill');
    } finally { await page.close(); }
  });
}
