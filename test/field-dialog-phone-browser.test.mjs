import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneMatrix, eachPhone, settled } from './lib/browser.mjs';
import { seedDemo, openRecord } from './lib/phone-matrix.mjs';
import { probe } from './lib/cutoff.mjs';

const s = await launch('field dialog on a phone', (weave) => seedDemo(weave));

if (s) {
  const { base, browser, tasks, t4 } = s;
  const matrix = await phoneMatrix(browser);
  const openBudget = async (page) => {
    await openRecord(page, base, tasks, t4);
    await page.locator('#dock .fieldrow[data-field="Project Budget"] .fieldrow-label').click();
    await page.waitForSelector('#tray-back textarea.field-desc');
    await settled(page.locator('#tray-back .tray-form'));
  };
  const descCut = (page) => page.evaluate(probe, '#tray-back').then((found) => found.filter((f) => /field-desc/.test(f.selector)));

  test('the phone field dialog fits the whole Description placeholder in its box (Issue #1397)', async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openBudget(page);
      const box = await page.locator('#tray-back textarea.field-desc').evaluate((n) => ({ value: n.value, placeholder: n.placeholder }));
      assert.equal(box.value, '', 'Project Budget has no description, so the placeholder shows');
      assert.deepEqual(await descCut(page), [], 'the placeholder runs past the bottom of the Description box');
    });
  });

  test('a long description grows the box instead of hiding its lines (Issue #1397)', async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openBudget(page);
      const desc = page.locator('#tray-back textarea.field-desc');
      await desc.fill(Array.from({ length: 6 }, (_, i) => `Line ${i + 1} of what this budget holds and where the number comes from.`).join(' '));
      await settled(desc);
      assert.deepEqual(await descCut(page), [], 'the typed description runs past the bottom of the Description box');
    });
  });

  test('the fixed-type note keeps a field gap above the next label (Issue #1398)', async (t) => {
    await eachPhone(t, matrix, async (page) => {
      await openBudget(page);
      const gaps = await page.evaluate(() => {
        const body = document.querySelector('#tray-back .tray-body');
        const note = [...body.querySelectorAll('.modal-note')].find((n) => /type is fixed/.test(n.textContent));
        const labels = [...body.querySelectorAll('.dlg-lbl')].filter((l) => l.getClientRects().length);
        const after = labels.find((l) => note.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
        const name = body.querySelector('input[name="name"]');
        const descLabel = labels.find((l) => l.textContent.trim() === 'Description');
        return {
          note: after.getBoundingClientRect().top - note.getBoundingClientRect().bottom,
          field: descLabel.getBoundingClientRect().top - name.getBoundingClientRect().bottom,
          next: after.textContent.trim(),
        };
      });
      assert.ok(gaps.note >= gaps.field - 1, `the note sits ${gaps.note.toFixed(1)}px above ${gaps.next}; a field sits ${gaps.field.toFixed(1)}px above the next label`);
    });
  });
}
