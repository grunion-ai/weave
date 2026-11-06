import test from 'node:test';
import assert from 'node:assert/strict';
import { eventually, launch, phoneBrowser, phonePage, styleOf } from './lib/browser.mjs';
import { probe, seed } from './lib/cutoff.mjs';
import { ROUTES, UNBROKEN } from './lib/states.mjs';

const s = await launch('unbroken text', seed);

if (s) {
  const INPUT_FACES = / > (?:dd|div\.fieldrow[\w.-]*) > input\.form-control/;
  const inputFaces = (page, root) => page.evaluate(probe, root).then((xs) => xs.filter((f) => f.kind === 'field-value' && INPUT_FACES.test(f.selector)));

  const wraps = async (page, holder, root) => {
    const rest = holder.locator(':scope > .text-dressed');
    await rest.waitFor();
    await styleOf(rest, 'overflow-wrap', 'anywhere');
    const box = await rest.boundingBox();
    const line = await rest.evaluate((n) => parseFloat(getComputedStyle(n).lineHeight) || 20);
    assert.ok(box.height > line * 2, `the ${UNBROKEN.length}-character word wraps onto more than one line (${Math.round(box.height)}px tall)`);
    assert.equal(await rest.evaluate((n) => n.textContent), UNBROKEN, 'the whole value is on the page');
    assert.deepEqual(await inputFaces(page, root), [], 'no text input holds a value wider than itself');
    await rest.click();
    const input = holder.locator(':scope > input.inline-edit');
    await input.waitFor();
    assert.equal(await input.inputValue(), UNBROKEN);
    assert.equal(await input.evaluate((n) => document.activeElement === n), true, 'a click opens the input for editing');
  };

  test('a board tile rests a long text value as wrapping text and edits it on click (Issue #1161)', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(ROUTES['sink-board'].url(s), { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-board .tile');
      await wraps(page, page.locator(`.wv-board .tile[data-eid="${s.sink.row}"] .tile-field[data-field="Notes"] > dd`), '.wv-board');
    } finally { await page.close(); }
  });

  test('the record page rests a long text value as wrapping text and edits it on click (Issue #1161)', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(ROUTES['sink-row'].url(s, 'desktop'), { waitUntil: 'networkidle' });
      await page.waitForSelector(ROUTES['sink-row'].ready('desktop'));
      await wraps(page, page.locator('.entity-fields .fieldrow[data-field="Notes"]'), '.entity-fields');
    } finally { await page.close(); }
  });

  test('the grid rests a literal text value as one line of text ending in an ellipsis (Issue #447)', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(ROUTES['sink-table'].url(s), { waitUntil: 'networkidle' });
      const cell = page.locator('tr.entity-row td[data-field="Notes"] .wv-cb > .text-dressed').first();
      await cell.waitFor();
      assert.equal(await cell.textContent(), UNBROKEN);
      assert.deepEqual(await cell.evaluate((n) => [getComputedStyle(n).whiteSpace, getComputedStyle(n).textOverflow, n.scrollWidth > n.clientWidth + 1]), ['nowrap', 'ellipsis', true], 'one line, cut at an ellipsis');
      await cell.click();
      const editor = await page.evaluate(() => ({ tag: document.activeElement.tagName, value: document.activeElement.value, field: document.activeElement.closest('td')?.dataset.field }));
      assert.ok(['INPUT', 'TEXTAREA'].includes(editor.tag), `a click opens an editor: ${editor.tag}`);
      assert.deepEqual({ value: editor.value, field: editor.field }, { value: UNBROKEN, field: 'Notes' }, 'with the whole value, in the Notes cell');
    } finally { await page.close(); }
  });

  const webkit = await phoneBrowser();
  test('on a phone the resting text keeps the input\'s 44px height and 16px type (Issue #1161)', { skip: !webkit && 'webkit cannot launch here' }, async () => {
    const short = s.weave.createEntity(s.sink.table, { name: 'Short note', values: { Notes: 'a note' } }).id;
    const page = await phonePage(webkit, { viewport: { width: 390, height: 844 } });
    try {
      await page.goto(`${s.base}/#/table/${s.sink.table}?e=${short}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(ROUTES['sink-row'].ready('phone'));
      const rest = page.locator('#dock .fieldrow[data-field="Notes"] > .text-dressed');
      await rest.waitFor();
      assert.equal(await rest.textContent(), 'a note');
      assert.equal(await styleOf(rest, 'fontSize', '16px'), '16px', 'the resting text is the size the phone input would be');
      const box = await rest.boundingBox();
      assert.ok(box.height >= 44, `the resting text is a 44px target (${Math.round(box.height)}px tall)`);
    } finally { await page.close(); }
  });

  test('the keyboard opens the resting text and the input carries the field name (Issue #1161)', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(ROUTES['sink-row'].url(s, 'desktop'), { waitUntil: 'networkidle' });
      await page.waitForSelector(ROUTES['sink-row'].ready('desktop'));
      const row = page.locator('.entity-fields .fieldrow[data-field="Notes"]');
      const rest = row.locator(':scope > .text-dressed');
      const input = row.locator(':scope > input.inline-edit');
      await rest.focus();
      await page.keyboard.press('Enter');
      await input.waitFor();
      assert.equal(await input.getAttribute('aria-label'), 'Notes', 'the swapped-in input is labelled like the one it replaces');
      assert.deepEqual(await input.evaluate((n) => [document.activeElement === n, n.value, n.selectionStart, n.selectionEnd]), [true, UNBROKEN, 0, UNBROKEN.length], 'Enter opens the input with the value selected');
      await input.evaluate((n) => n.blur());
      await rest.waitFor();
      await rest.focus();
      await page.keyboard.press('x');
      await input.waitFor();
      assert.equal(await input.inputValue(), 'x', 'a typed character replaces the selected value');
      await page.keyboard.press('Enter');
      const saved = () => page.evaluate(async (id) => (await fetch(`api/entities/${id}`).then((r) => r.json())).fields.Notes, s.sink.row);
      assert.equal(await eventually(saved, 'x'), 'x', 'the typed value reaches the engine');
    } finally { await page.close(); }
  });
}
