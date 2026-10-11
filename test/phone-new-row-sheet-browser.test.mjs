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
  const tasks = weave.createTable({ space: 'Handbook', name: 'Tasks' });
  return { issues: issues.id, guides: guides.id, notes: notes.id, tasks: tasks.id };
});

const rows = (page, id) => page.evaluate(async (id) => (await (await fetch(`/api/tables/${id}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).items.map((e) => ({ name: e.name, Severity: e.fields.Severity ?? null, Symptom: e.fields.Symptom ?? [] })), id);
const touchOutside = (page) => page.evaluate(() => {
  const x = 40, y = 40;
  const t = document.elementFromPoint(x, y);
  for (const type of ['pointerdown', 'pointerup']) t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true, pointerId: 21, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: x, clientY: y }));
});

if (s) {
  const { base, browser, issues, guides, notes, tasks } = s;
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

    test(`on a phone the sheet names the row by its table's term, and by the table's name in singular form when it has none (${engine}, Issue #739, Issue #792)`, async () => {
      for (const [id, want, noun] of [[guides, 'New guide', 'guide'], [notes, 'New note', 'note'], [tasks, 'New task', 'task']]) {
        const page = await open(make, id);
        try {
          assert.equal(await page.getAttribute('.phone-bar .phone-new', 'aria-label'), want);
          await page.click('.phone-bar .phone-new');
          await page.waitForSelector('.new-row-sheet');
          assert.equal(await page.textContent('.new-row-sheet .new-row-title'), want);
          assert.equal(await page.getAttribute('.new-row-sheet', 'aria-label'), want);
          assert.equal(await page.getAttribute('.new-row-name', 'placeholder'), `Name this ${noun}`);
          await page.keyboard.press('Escape');
          await page.waitForSelector('.new-row-sheet', { state: 'detached' });
        } finally { await page.close(); }
      }
    });

    test(`on a phone the sheet opened from a table has no table chip, and only a create with no table in context asks which table (${engine}, Issue #793)`, async () => {
      const page = await open(make, issues);
      try {
        await page.click('.phone-bar .phone-new');
        await page.waitForSelector('.new-row-sheet');
        assert.equal(await page.locator('.new-row-sheet .new-row-table').count(), 0, 'no chip switches the table');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.new-row-sheet', { state: 'detached' });
        await page.evaluate(() => newRowSheet());
        await page.waitForSelector('.new-row-sheet .new-row-table');
        assert.match(await page.getAttribute('.new-row-sheet .new-row-table', 'aria-label'), /^Table: /);
        await page.keyboard.press('Escape');
        await page.waitForSelector('.new-row-sheet', { state: 'detached' });
      } finally { await page.close(); }
    });

    test(`on a phone the Name is one line whose Return key reads Done and creates the row, never while empty or composing (${engine}, Issue #794)`, async () => {
      const page = await open(make, notes);
      const made = `Made by Return in ${engine}`;
      try {
        await page.click('.phone-bar .phone-new');
        await page.waitForSelector('.new-row-sheet');
        assert.equal(await page.evaluate(() => document.querySelector('.new-row-name').tagName), 'INPUT');
        assert.equal(await page.getAttribute('.new-row-name', 'enterkeyhint'), 'done');
        const before = (await rows(page, notes)).length;
        await page.focus('.new-row-name');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        assert.equal((await rows(page, notes)).length, before, 'Return on an empty name writes nothing');
        assert.ok(await page.isVisible('.new-row-sheet'), 'and the sheet stays');
        await page.fill('.new-row-name', made);
        await page.evaluate(() => document.querySelector('.new-row-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
        await page.waitForTimeout(300);
        assert.equal((await rows(page, notes)).length, before, 'Return that ends an IME composition writes nothing');
        await page.keyboard.press('Enter');
        await page.waitForSelector('.new-row-sheet', { state: 'detached' });
        await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
        assert.equal(await eventually(async () => (await rows(page, notes)).filter((r) => r.name === made).length, 1), 1, 'Return wrote the row once');
        assert.equal(await page.inputValue('#dock textarea.name-edit'), made, 'the new row opens, as Create does');
      } finally { await page.close(); }
    });
  }

  test('on a desktop the sheet keeps its two-line Name, where Return starts a new line (Issue #794)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${base}/#/table/${notes}`, { waitUntil: 'networkidle' });
      await page.evaluate((id) => newRowSheet(allTables().find((t) => t.id === id)), notes);
      await page.waitForSelector('.new-row-sheet');
      assert.equal(await page.evaluate(() => document.querySelector('.new-row-name').tagName), 'TEXTAREA');
      assert.equal(await page.getAttribute('.new-row-name', 'enterkeyhint'), null);
      await page.fill('.new-row-name', 'two');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      assert.ok(await page.isVisible('.new-row-sheet'), 'Return does not create on a desktop');
    } finally { await page.close(); }
  });
}
