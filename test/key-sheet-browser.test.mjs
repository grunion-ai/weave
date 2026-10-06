import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let rows, first, second;
const s = await launch('key sheet', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  rows = weave.createTable({ space: 'Ledger', name: 'Rows' });
  weave.addField(rows, { name: 'Note', type: 'text' });
  first = weave.createEntity(rows, { name: 'first', values: { Note: 'a' } });
  second = weave.createEntity(rows, { name: 'second', values: { Note: 'b' } });
});

if (s) {
  const { base, browser } = s;

  const grid = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector(`tr[data-eid="${first.id}"] td[data-field="Note"]`);
    return page;
  };
  const cell = `tr[data-eid="${first.id}"] td[data-field="Note"]`;
  const focusIs = (page) => page.evaluate(() => {
    const a = document.activeElement;
    return { id: a?.id || null, field: a?.dataset?.field ?? null, tag: a?.tagName ?? null };
  });
  const sheetOpen = (page) => page.locator('#modal.wv-keys').count();

  const readSheet = (page) => page.evaluate(() => {
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => {
        const x = Number(v) / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const modal = document.querySelector('#modal.wv-keys');
    const td = modal.querySelector('.key-sheet-table td');
    const [hi, lo] = [lum(getComputedStyle(td).color), lum(getComputedStyle(modal).backgroundColor)].sort((a, b) => b - a);
    return {
      title: modal.querySelector('h2').textContent,
      keys: [...modal.querySelectorAll('.key-sheet-table kbd')].map((k) => k.textContent),
      does: [...modal.querySelectorAll('.key-sheet-table td')].map((d) => d.textContent),
      bindings: globalThis.WeaveGridKeymap.bindings.map((b) => ({ keys: b.keys, does: b.does })),
      contrast: (hi + 0.05) / (lo + 0.05),
    };
  });

  for (const theme of ['light', 'dark']) {
    test(`? on a resting grid cell opens the sheet with every grid verb; Esc puts focus back (${theme})`, async () => {
      const page = await grid(theme);
      try {
        await page.focus(cell);
        await page.keyboard.press('?');
        await page.waitForSelector('#modal.wv-keys');
        const sheet = await readSheet(page);
        assert.equal(sheet.title, 'Keyboard shortcuts');
        for (const b of sheet.bindings) {
          assert.ok(sheet.keys.includes(b.keys), `the sheet prints ${b.keys}`);
          assert.ok(sheet.does.includes(b.does), `and what it does: ${b.does}`);
        }
        for (const k of ['⌘K', '⌘Return', '/ or ⌘F', '?', '⌘Z']) assert.ok(sheet.keys.includes(k), `the sheet prints ${k}`);
        assert.ok(sheet.contrast >= 4.5, `the sheet's text is legible in ${theme}, contrast ${sheet.contrast.toFixed(2)}`);
        assert.equal((await page.$eval(cell, (td) => td.querySelector('input')?.value)), 'a', 'the ? opened no edit and typed nothing');

        await page.keyboard.press('Escape');
        await page.waitForSelector('#modal-back', { state: 'detached' });
        assert.deepEqual(await focusIs(page), { id: null, field: 'Note', tag: 'TD' }, 'focus is back on the cell it left');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(() => document.activeElement.closest('tr')?.dataset.eid), second.id, 'and the grid still has the keys');
      } finally { await page.close(); }
    });

    test(`? inside an open cell editor is typed, not the sheet (${theme})`, async () => {
      const page = await grid(theme);
      try {
        await page.focus(cell);
        await page.keyboard.press('Enter');
        assert.equal((await focusIs(page)).tag, 'INPUT', 'the cell is open');
        await page.keyboard.press('End');
        await page.keyboard.press('?');
        assert.equal(await page.$eval(`${cell} input`, (i) => i.value), 'a?', 'the ? went into the value');
        assert.equal(await sheetOpen(page), 0, 'and no sheet opened');
        await page.keyboard.press('Escape');
      } finally { await page.close(); }
    });

    test(`the rail's ? chip opens the same sheet, and Esc gives the chip its focus back (${theme})`, async () => {
      const page = await grid(theme);
      try {
        await page.focus('#rail-help');
        await page.keyboard.press('Enter');
        await page.waitForSelector('#modal.wv-keys');
        assert.equal((await readSheet(page)).title, 'Keyboard shortcuts');
        assert.equal(await page.locator('#modal .actions button').count(), 1, 'one button, Done: there is nothing to cancel');
        assert.deepEqual((await focusIs(page)).tag, 'BUTTON', 'the sheet holds focus, so the grid behind it does not take the keys');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#modal-back', { state: 'detached' });
        assert.equal((await focusIs(page)).id, 'rail-help', 'focus is back on the chip');
      } finally { await page.close(); }
    });

    test(`? with nothing focused opens the sheet; ? in a text field outside the grid is typed (${theme})`, async () => {
      const page = await grid(theme);
      try {
        await page.evaluate(() => document.activeElement?.blur());
        await page.keyboard.press('?');
        await page.waitForSelector('#modal.wv-keys');
        await page.click('#modal .actions button');
        await page.waitForSelector('#modal-back', { state: 'detached' });
        await page.click('.bug-fab');
        await page.waitForSelector('#bug-panel .bug-note');
        await page.keyboard.press('?');
        assert.equal(await page.$eval('#bug-panel .bug-note', (n) => n.value), '?', 'the note took the ?');
        assert.equal(await sheetOpen(page), 0, 'and no sheet opened');
      } finally { await page.close(); }
    });

    test(`the problem report shows that ⌘Return sends it (${theme})`, async () => {
      const page = await grid(theme);
      try {
        await page.click('.bug-fab');
        await page.waitForSelector('#bug-panel .bug-note');
        const hint = await page.$eval('#bug-panel .bug-foot', (foot) => {
          const k = foot.querySelector('kbd');
          const r = k?.getBoundingClientRect();
          return k ? { text: k.textContent, shown: r.width > 0 && r.height > 0, nextIsSend: k.nextElementSibling?.classList.contains('bug-send') } : null;
        });
        assert.deepEqual(hint, { text: '⌘↵', shown: true, nextIsSend: true }, 'a visible ⌘↵ beside Send');
        assert.match(await page.$eval('#bug-panel .bug-send', (b) => b.title), /⌘Return/, 'and Send names its key');
      } finally { await page.close(); }
    });
  }
}
