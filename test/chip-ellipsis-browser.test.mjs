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

  async function grid(colorScheme, width = 1400) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${row.id}"] .k-select`);
    await page.waitForTimeout(300);
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
        insideFill: l.right <= c.right - parseFloat(ccs.paddingRight) + 0.5,
        insideCell: c.right <= t.right + 0.5,
        title: chip.title,
        labelTitle: label.title,
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
          assert.equal(r.textOverflow, 'ellipsis', `${field}: a cut label ends in an ellipsis, not mid-letter`);
          assert.equal(r.chipOverflow, 'hidden', `${field}: nothing paints past the chip's fill`);
          assert.ok(r.insideFill, `${field}: the label ends inside the fill, before the chip's right padding`);
          assert.ok(r.insideCell, `${field}: the chip fits its column`);
          assert.equal(r.labelTitle, '', `${field}: the chip owns the tooltip, so the label carries none of its own`);
          if (field !== 'Secret') {
            assert.equal(r.truncated, false, `${field}: the column is raised to the long option, so it is not cut`);
            assert.equal(r.clipped, false, `${field}: and the cell is not marked clipped`);
            continue;
          }
          assert.equal(r.truncated, true, `${field}: the long value really is cut short (it needs more than ${COL}px)`);
          assert.equal(r.title, r.text, `${field}: hovering anywhere on the cut chip shows the whole value (Issue #584)`);
          assert.equal(r.clipped, true, `${field}: the cell is marked clipped, so the hover expansion still opens`);
        }
      } finally { await page.close(); }
    });
  }

  test('a chip that fits is left whole: no ellipsis, its own title, no clipped marker', async () => {
    const page = await grid('light');
    try {
      const m = await measure(page, shortRow.id);
      for (const field of ['Program', 'Tags']) {
        assert.ok(m[field].label, `${field}: the short chip has its label span too`);
        assert.equal(m[field].truncated, false, `${field}: a value that fits is not cut`);
        assert.equal(m[field].clipped, false, `${field}: and the cell is not marked`);
      }
      assert.equal(m.Program.title, 'Program', 'a select chip that fits keeps its field name as its title');
      assert.equal(m.Tags.title, '', 'a multi chip that fits carries no title');
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
      assert.equal(m.Program.truncated, false, 'the column already holds the widest option, so the picked one lands whole (Issue #614)');
      assert.ok(m.Program.insideFill, 'and still ends inside its fill');
    } finally { await page.close(); }
  });

  test('a column resize rechecks the title: widened to fit, the chip gets its field name back (Issue #584)', async () => {
    const page = await grid('light', 2400);
    const chip = `tr[data-eid="${row.id}"] td[data-field="Secret"] .k-key`;
    try {
      const whole = await page.textContent(`${chip} > .k-label`);
      assert.equal(await page.getAttribute(chip, 'title'), whole, 'cut at the start, the chip shows the whole value');
      const grip = await page.locator('table.wv-grid th.col-head:has(.col-label:text-is("Secret")) .col-resize').boundingBox();
      const y = grip.y + grip.height / 2;
      await page.mouse.move(grip.x + grip.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(grip.x + 300, y, { steps: 6 });
      await page.mouse.up();
      await page.waitForFunction((sel) => {
        const l = document.querySelector(`${sel} > .k-label`);
        return l && l.scrollWidth <= l.clientWidth;
      }, chip);
      await page.waitForTimeout(300);
      assert.match(await page.getAttribute(chip, 'title'), /^Secret — /, 'the value fits now, so the title is the one the chip was drawn with again');
    } finally { await page.close(); }
  });
}
