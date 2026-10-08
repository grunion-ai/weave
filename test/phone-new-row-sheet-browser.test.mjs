import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone new-row sheet', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.updateField(issues, 'Name', { config: { term: { singular: 'bug', plural: 'bugs' } } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField(issues, { name: 'Symptom', type: 'multiselect', config: { options: ['Looks broken', 'Slow', 'Wrong data', 'Error'] } });
  for (let i = 0; i < 3; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Severity: 'Low' } });
  weave.createSpace({ name: 'Handbook' });
  const guides = weave.createTable({ space: 'Handbook', name: 'Guide' });
  weave.updateField(guides, 'Name', { config: { term: { singular: 'guide', plural: 'guides' } } });
  const notes = weave.createTable({ space: 'Handbook', name: 'Note' });
  return { issues: issues.id, guides: guides.id, notes: notes.id };
});

const rows = (page, id) => page.evaluate(async (id) => (await (await fetch(`/api/tables/${id}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).items.map((e) => ({ name: e.name, Severity: e.fields.Severity ?? null, Symptom: e.fields.Symptom ?? [] })), id);
const touchOutside = (page) => page.evaluate(() => {
  const x = 40, y = 40;
  const t = document.elementFromPoint(x, y);
  for (const type of ['pointerdown', 'pointerup']) t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true, pointerId: 21, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: x, clientY: y }));
});

if (s) {
  const { base, browser, issues, guides, notes } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', () => browser.newPage({ viewport: { width: 390, height: 844 } })]];
  if (phone) engines.push(['webkit iPhone 15', () => phonePage(phone)]);
  const open = async (make, id, theme = 'light') => {
    const page = await make();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.phone-bar .phone-new:not([hidden])');
    return page;
  };

  for (const [engine, make] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone + opens a New bug sheet that writes nothing until Create, then Create writes the name and choices (${engine}, ${theme}, Issue #739)`, async () => {
        const page = await open(make, issues, theme);
        try {
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          assert.equal(await page.getAttribute('.phone-bar .phone-new', 'aria-label'), 'New bug');
          const before = (await rows(page, issues)).length;
          await page.click('.phone-bar .phone-new');
          await page.waitForSelector('.new-row-sheet');
          assert.equal(await page.textContent('.new-row-sheet .new-row-title'), 'New bug');
          assert.equal(await page.getAttribute('.new-row-sheet', 'aria-label'), 'New bug');
          const labels = await page.locator('.new-row-sheet .new-row-label').allTextContents();
          assert.deepEqual(labels, ['Name', 'Severity', 'Symptom'], 'the name and the table\'s choice fields');
          await touchOutside(page);
          await page.waitForSelector('.new-row-sheet', { state: 'detached' });
          assert.equal((await rows(page, issues)).length, before, 'dismissing writes nothing');
          await page.waitForTimeout(700);
          await page.click('.phone-bar .phone-new');
          await page.waitForSelector('.new-row-sheet');
          assert.equal(await page.isDisabled('.new-row-create'), true, 'Create waits for a name');
          await page.fill('.new-row-name', `Looks broken: made in ${engine} ${theme}`);
          await page.click('.new-row-sheet .new-row-opt[data-opt="High"]');
          await page.click('.new-row-sheet .new-row-opt[data-opt="Slow"]');
          await page.click('.new-row-sheet .new-row-opt[data-opt="Error"]');
          const heights = await page.locator('.new-row-sheet button').evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
          assert.ok(heights.every((h) => h >= 44), `every sheet control is a 44px target: ${heights}`);
          assert.equal((await rows(page, issues)).length, before, 'picking writes nothing');
          await page.click('.new-row-create');
          await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
          const made = (await rows(page, issues)).find((r) => r.name === `Looks broken: made in ${engine} ${theme}`);
          assert.deepEqual(made, { name: `Looks broken: made in ${engine} ${theme}`, Severity: 'High', Symptom: ['Slow', 'Error'] });
          assert.equal(await page.inputValue('#dock textarea.name-edit'), made.name, 'and the new row opens');
        } finally { await page.close(); }
      });
    }

    test(`on a phone the sheet names the row by its table's term, and row when the table has none (${engine}, Issue #739)`, async () => {
      for (const [id, want] of [[guides, 'New guide'], [notes, 'New row']]) {
        const page = await open(make, id);
        try {
          assert.equal(await page.getAttribute('.phone-bar .phone-new', 'aria-label'), want);
          await page.click('.phone-bar .phone-new');
          await page.waitForSelector('.new-row-sheet');
          assert.equal(await page.textContent('.new-row-sheet .new-row-title'), want);
          await page.keyboard.press('Escape');
          await page.waitForSelector('.new-row-sheet', { state: 'detached' });
        } finally { await page.close(); }
      }
    });
  }
}
