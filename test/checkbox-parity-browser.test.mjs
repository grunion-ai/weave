/* One checkbox (Issue #441, Issue #384; Kyle, 2026-09-27: "checkboxes should
   be the same as all of our other checkboxes"). weave's checkbox is the
   `input.form-check-input` the field dialog, settings and the checkbox cell
   draw. The grid's row selector, the Fields popover and the Filters popover
   use that same input, so every surface computes the same box, radius,
   border and checked fill in both themes, and each is a real checkbox: no
   hand-drawn `.field-visible-check`, no role="switch" on a box. The field
   dialog's checkbox rows sit on one line with their labels (Issue #384).
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let jobs;
const s = await launch('one checkbox', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(jobs, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Done', category: 'done' }] } });
  weave.addField(jobs, { name: 'Owner', type: 'text' });
  weave.createEntity(jobs, { name: 'Alpha', values: { Status: 'Open' } });
});

if (s) {
  const { base, browser } = s;
  // The parts of a checkbox a reader sees, unchecked and checked.
  const look = (box) => {
    const cs = getComputedStyle(box);
    return { w: cs.width, h: cs.height, radius: cs.borderTopLeftRadius, border: cs.borderTopColor, borderWidth: cs.borderTopWidth, appearance: cs.appearance, bg: cs.backgroundColor };
  };
  const probe = async (page) => page.evaluate((src) => {
    const read = new Function(`return (${src})`)();
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'form-check-input' });
    document.body.append(box);
    const off = read(box);
    box.checked = true;
    const on = read(box);
    box.remove();
    return { off, on };
  }, look.toString());
  const readBox = (page, selector, checked) => page.$eval(selector, (box, [src, want]) => {
    const read = new Function(`return (${src})`)();
    if (box.checked !== want) box.checked = want; // a look, never a write: no change event
    return { tag: box.tagName, type: box.type, cls: box.className, role: box.getAttribute('role'), ...read(box) };
  }, [look.toString(), checked]);

  for (const theme of ['light', 'dark']) {
    test(`the grid, Fields and Filters draw the field dialog's checkbox (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
      try {
        await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
        const want = await probe(page);
        await page.hover('.wv-grid tbody tr.entity-row');
        const surfaces = { grid: '.wv-grid tbody tr.entity-row .sel-box', head: '.wv-grid thead .sel-box' };
        for (const [name, sel] of Object.entries(surfaces)) {
          for (const checked of [false, true]) {
            const got = await readBox(page, sel, checked);
            assert.equal(got.type, 'checkbox', `${name}: a real checkbox`);
            assert.match(got.cls, /\bform-check-input\b/, `${name}: the shared checkbox`);
            const w = checked ? want.on : want.off;
            for (const k of ['w', 'h', 'radius', 'border', 'borderWidth', 'appearance', 'bg']) assert.equal(got[k], w[k], `${name} ${checked ? 'checked' : 'unchecked'}: ${k}`);
          }
        }
        await page.click('.eye-btn');
        await page.waitForSelector('.table-fields-popover .table-field-row');
        assert.equal(await page.locator('.field-visible-check').count(), 0, 'no hand-drawn box');
        assert.equal(await page.locator('.table-fields-popover [role="switch"]').count(), 0, 'no box announced as a switch');
        for (const checked of [false, true]) {
          const got = await readBox(page, '.table-field-row[data-field="Owner"] input[type="checkbox"]', checked);
          assert.match(got.cls, /\bform-check-input\b/, 'Fields: the shared checkbox');
          const w = checked ? want.on : want.off;
          for (const k of ['w', 'h', 'radius', 'border', 'borderWidth', 'appearance', 'bg']) assert.equal(got[k], w[k], `Fields ${checked ? 'checked' : 'unchecked'}: ${k}`);
        }
        const rowsBoxes = await page.$$eval('.table-fields-popover .eye-row', (rows) => rows.map((r) => !!r.querySelector('input.form-check-input[type="checkbox"]')));
        assert.ok(rowsBoxes.length > 3 && rowsBoxes.every(Boolean), 'every show/hide row, Deleted rows and the Σ row included, holds the checkbox');
        await page.keyboard.press('Escape');
        await page.click('.table-filter-btn');
        await page.waitForSelector('.table-filter-popover .filter-chip');
        for (const checked of [false, true]) {
          const got = await readBox(page, '.table-filter-popover .filter-chip input[type="checkbox"]', checked);
          assert.match(got.cls, /\bform-check-input\b/, 'Filters: the shared checkbox');
          const w = checked ? want.on : want.off;
          for (const k of ['w', 'h', 'radius', 'border', 'borderWidth', 'appearance', 'bg']) assert.equal(got[k], w[k], `Filters ${checked ? 'checked' : 'unchecked'}: ${k}`);
        }
      } finally { await page.close(); }
    });
  }

  test('a Fields row is a labelled checkbox: a click on its name flips it and the grid follows', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      await page.click('.eye-btn');
      const box = page.getByRole('checkbox', { name: 'Owner', exact: true });
      assert.equal(await box.isChecked(), true);
      await page.locator('.table-field-row[data-field="Owner"] .eye-label').click();
      await page.waitForFunction(() => ![...document.querySelectorAll('.wv-grid .col-label')].some((h) => h.textContent.trim() === 'Owner'));
      assert.equal(await box.isChecked(), false);
      await box.focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].some((h) => h.textContent.trim() === 'Owner'));
      assert.equal(await box.isChecked(), true, 'Space flips it from the keyboard');
    } finally { await page.close(); }
  });

  test('a filter option is a labelled checkbox (Issue #441)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      await page.click('.table-filter-btn');
      const open = page.locator('.table-filter-popover').getByRole('checkbox', { name: 'Open', exact: true });
      await open.check();
      await page.waitForFunction(() => document.querySelector('.table-filter-btn .table-filter-count')?.textContent === '1');
      assert.equal(await page.locator('.table-filter-popover .filter-chip:has(input:checked)').count(), 1);
      await open.uncheck();
      await page.waitForFunction(() => !document.querySelector('.table-filter-btn .table-filter-count'));
    } finally { await page.close(); }
  });

  test('the field dialog puts each checkbox on its label\'s line and formats its hint (Issue #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      const th = page.locator('.wv-grid thead th.col-head', { hasText: 'Owner' }).first();
      await th.hover();
      await th.locator('.field-menu').click();
      await page.locator('.chip-pop .wv-menu-row', { hasText: 'Edit field' }).click();
      await page.waitForSelector('.tray-form');
      const row = page.locator('.tray-form label.form-check', { hasText: 'Literal' });
      const geo = await row.evaluate((label) => {
        const box = label.querySelector('.form-check-input').getBoundingClientRect();
        const text = label.querySelector('.form-check-label').getBoundingClientRect();
        return { boxRight: box.right, textLeft: text.left, boxMid: box.top + box.height / 2, textMid: text.top + parseFloat(getComputedStyle(label.querySelector('.form-check-label')).lineHeight) / 2, raw: /\*\*|`/.test(label.querySelector('.form-check-label').innerText.replace(/\*\*marks\*\*|`syntax`/g, '')), codes: label.querySelectorAll('code').length };
      });
      assert.ok(geo.boxRight <= geo.textLeft, `the box ends before its label starts (${geo.boxRight} vs ${geo.textLeft})`);
      assert.ok(Math.abs(geo.boxMid - geo.textMid) <= 4, `box and the label's first line share a centre (${geo.boxMid} vs ${geo.textMid})`);
      assert.ok(geo.codes >= 2, 'the syntax in the hint is set as code, not printed as raw markdown');
      assert.equal(geo.raw, false);
    } finally { await page.close(); }
  });
}
