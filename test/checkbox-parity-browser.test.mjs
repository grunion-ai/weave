import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { openPane } from './lib/view-pane.mjs';

let jobs;
const s = await launch('one checkbox', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(jobs, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Done', category: 'done' }] } });
  weave.addField(jobs, { name: 'Owner', type: 'text' });
  weave.addField(jobs, { name: 'Hours', type: 'number' });
  weave.createEntity(jobs, { name: 'Alpha', values: { Status: 'Open', Hours: 3 } });
  const spaces = Object.values(weave.state.tables).find((t) => t.system === 'spaces');
  weave.addField(spaces.id, { name: 'Job · Hours · sum', type: 'rollup', config: { via: 'Ops/Job', targetField: 'Hours', aggregate: 'sum' } });
  weave.updateTable(jobs.id, { hideRollups: false });
});

if (s) {
  const { base, browser } = s;
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
    if (box.checked !== want) box.checked = want;
    return { tag: box.tagName, type: box.type, cls: box.className, role: box.getAttribute('role'), ...read(box) };
  }, [look.toString(), checked]);

  for (const theme of ['light', 'dark']) {
    test(`the grid, Fields, the Σ picker and Filters draw the field dialog's checkbox (${theme}, Issues #441, #915)`, async () => {
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
        const grid = await readBox(page, surfaces.grid, true);
        await openPane(page, 'fields');
        await page.waitForSelector('#view-pane .table-field-row');
        assert.equal(await page.locator('.field-visible-check').count(), 0, 'no hand-drawn box');
        assert.equal(await page.locator('#view-pane .vp-fields :is([role="switch"], .switch)').count(), 0, 'no switch in the Fields list (Issue #915)');
        for (const checked of [false, true]) {
          const got = await readBox(page, '.table-field-row[data-field="Owner"] input[type="checkbox"]', checked);
          assert.match(got.cls, /\bform-check-input\b/, 'Fields: the shared checkbox');
          const w = checked ? want.on : want.off;
          for (const k of ['w', 'h', 'radius', 'border', 'borderWidth', 'appearance', 'bg']) assert.equal(got[k], w[k], `Fields ${checked ? 'checked' : 'unchecked'}: ${k}`);
        }
        const fieldsOn = await readBox(page, '.table-field-row[data-field="Owner"] input[type="checkbox"]', true);
        for (const k of ['w', 'h', 'radius', 'bg']) assert.equal(fieldsOn[k], grid[k], `Fields matches the grid row selector: ${k}`);
        const rowsBoxes = await page.$$eval('#view-pane .vp-fields .eye-row', (rows) => rows.map((r) => !!r.querySelector('input.form-check-input[type="checkbox"]')));
        assert.ok(rowsBoxes.length > 3 && rowsBoxes.every(Boolean), 'every show/hide row holds the checkbox');
        await page.click('#view-pane .vp-close');
        await page.click('thead tr.wv-foot td.foot-cell[data-col="Hours"]');
        await page.waitForSelector('.chip-pop .foot-row');
        assert.equal(await page.locator('.chip-pop :is([role="switch"], .switch)').count(), 0, 'no switch in the Σ picker (Issue #915)');
        const footBoxes = await page.locator('.chip-pop .foot-row').evaluateAll((rows) => rows.map((r) => !!r.querySelector('input.form-check-input[type="checkbox"]')));
        assert.ok(footBoxes.length > 3 && footBoxes.every(Boolean), 'every Σ picker row holds the checkbox');
        for (const checked of [false, true]) {
          const got = await readBox(page, '.chip-pop .foot-row[data-agg="avg"] input[type="checkbox"]', checked);
          const w = checked ? want.on : want.off;
          for (const k of ['w', 'h', 'radius', 'border', 'borderWidth', 'appearance', 'bg']) assert.equal(got[k], w[k], `Σ picker ${checked ? 'checked' : 'unchecked'}: ${k}`);
        }
        await page.locator('.chip-pop .foot-row[data-agg="avg"] input').evaluate((b) => { b.checked = false; });
        await page.keyboard.press('Escape');
        await openPane(page, 'filters');
        await page.waitForSelector('#view-pane .filter-chip');
        for (const checked of [false, true]) {
          const got = await readBox(page, '#view-pane .filter-chip input[type="checkbox"]', checked);
          assert.match(got.cls, /\bform-check-input\b/, 'Filters: the shared checkbox');
          const w = checked ? want.on : want.off;
          for (const k of ['w', 'h', 'radius', 'border', 'borderWidth', 'appearance', 'bg']) assert.equal(got[k], w[k], `Filters ${checked ? 'checked' : 'unchecked'}: ${k}`);
        }
      } finally { await page.close(); }
    });
  }

  test('a Fields row is a labelled checkbox: a click on its name flips it and the grid follows (Issue #915)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      await openPane(page, 'fields');
      const box = page.locator('#view-pane').getByRole('checkbox', { name: 'Owner', exact: true });
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

  test('a Σ picker row is a labelled checkbox the arrow keys walk, and the settings row keeps its switch (Issue #915)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      await page.click('thead tr.wv-foot td.foot-cell[data-col="Hours"]');
      const pop = page.locator('.chip-pop');
      const sum = pop.locator('.foot-row[data-agg="sum"]').getByRole('checkbox');
      await sum.waitFor();
      assert.equal(await sum.isChecked(), true, 'the existing rollup reads as checked');
      assert.equal(await page.evaluate(() => document.activeElement?.closest('.foot-row')?.dataset.agg), 'sum', 'the first checkbox takes focus on open');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement?.matches('.foot-row input[type="checkbox"]') && document.activeElement.closest('.foot-row').dataset.agg), 'avg', 'ArrowDown walks to the next checkbox');
      await page.keyboard.press('Escape');
      await page.locator('#ws-list .ws-icon').first().click({ button: 'right' });
      const setting = page.locator('.ws-ctx .wv-menu-row', { hasText: 'Link preview before sign-in' });
      await setting.waitFor();
      assert.equal(await setting.locator('.switch .switch-knob').count(), 1, 'a setting stays a switch');
    } finally { await page.close(); }
  });

  test('a filter option is a labelled checkbox (Issue #441)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      await openPane(page, 'filters');
      const open = page.locator('#view-pane').getByRole('checkbox', { name: 'Open', exact: true });
      await open.check();
      await page.waitForFunction(() => document.querySelector('#main .table-view-btn .view-count')?.textContent === '1');
      assert.equal(await page.locator('#view-pane .filter-chip:has(input:checked)').count(), 1);
      await open.uncheck();
      await page.waitForFunction(() => !document.querySelector('#main .table-view-btn .view-count'));
    } finally { await page.close(); }
  });

  test('the field dialog puts each checkbox on its label\'s line and formats its hint (Issue #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      const th = page.locator('.wv-grid thead th.col-head', { hasText: 'Owner' }).first();
      await th.hover();
      await th.locator('.field-menu').click();
      await page.locator('.chip-pop .wv-menu-row', { hasText: 'Field settings' }).click();
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
