import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const LONG = 'A plain name long enough to run past its column and onto a second line at the roomy density, one hundred';
let table, row;
const s = await launch('plain text wraps at Spacious', (weave) => {
  weave.createSpace({ name: 'Ops' });
  table = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.addField(table, { name: 'Note', type: 'text' });
  row = weave.createEntity(table, { name: LONG, values: { Note: LONG } });
  weave.createEntity(table, { name: 'Short', values: { Note: '' } });
});

if (s) {
  const { base, browser } = s;
  const ROOMY = '.seg-opt[title="Two lines per row, for long values"]';
  const COMFY = '.seg-opt[title="Roomy rows, for reading"]';
  const open = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const density = async (page, pick) => {
    await page.click('.table-density-btn');
    await page.click(pick);
    await page.keyboard.press('Escape');
  };
  const cell = (field) => `tr[data-eid="${row.id}"] td[data-field="${field}"] .wv-cb`;
  const lines = (page, field) => page.evaluate((q) => {
    const box = document.querySelector(q);
    const rest = box?.querySelector(':scope > .text-dressed');
    if (!rest) return { rest: null, input: !!box?.querySelector('input.inline-edit') };
    const cs = getComputedStyle(rest);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return { rest: rest.textContent, lines: Math.round((rest.getBoundingClientRect().height - pad) / lh), clamp: cs.webkitLineClamp, input: false };
  }, cell(field));

  for (const theme of ['light', 'dark']) {
    test(`at Spacious a plain text value rests as two clamped lines, the Name included (${theme}, Issue #447)`, async () => {
      const page = await open(theme);
      try {
        await density(page, ROOMY);
        await page.waitForSelector('.wv-grid[data-density="spacious"]');
        for (const field of ['Name', 'Note']) {
          const m = await lines(page, field);
          assert.equal(m.rest, LONG, `${field} rests as text, not an input: ${JSON.stringify(m)}`);
          assert.equal(m.clamp, '2', `${field} clamps to the density's lines`);
          assert.equal(m.lines, 2, `${field} reads two lines at Spacious`);
        }
        await density(page, COMFY);
        await page.waitForSelector('.wv-grid[data-density="comfortable"]');
        for (const field of ['Name', 'Note']) assert.equal((await lines(page, field)).lines, 1, `${field} is one line at Comfortable`);
      } finally { await page.close(); }
    });
  }

  test('a click on a resting plain text value edits it in place and saves on Return (Issue #447)', async () => {
    const page = await open('light');
    try {
      await page.click(`${cell('Note')} > .text-dressed`);
      const input = page.locator(`${cell('Note')} > input.inline-edit`);
      await input.waitFor();
      assert.equal(await input.inputValue(), LONG);
      assert.ok(await input.evaluate((n) => n === document.activeElement), 'the input takes focus');
      await input.fill('Edited note');
      await input.press('Enter');
      const saved = () => page.evaluate(async (id) => (await (await fetch(`/api/entities/${id}`)).json()).fields.Note, row.id);
      assert.equal(await eventually(saved, 'Edited note'), 'Edited note');
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForSelector(`${cell('Note')} > .text-dressed`, { timeout: 5000 });
      assert.equal((await lines(page, 'Note')).input, false, 'the cell rests as text again');
    } finally { await page.close(); }
  });

  test('an empty plain text cell keeps its input to type into (Issue #447)', async () => {
    const page = await open('light');
    try {
      const short = (await page.$$eval('tr.entity-row', (rs) => rs.map((r) => r.dataset.eid))).find((id) => id !== row.id);
      assert.equal(await page.locator(`tr[data-eid="${short}"] td[data-field="Note"] .wv-cb > input.inline-edit`).count(), 1);
    } finally { await page.close(); }
  });
}
