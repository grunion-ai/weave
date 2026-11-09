import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone new-row tray', (weave) => {
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
  const todos = weave.createTable({ space: 'Handbook', name: 'Todo' });
  weave.createEntity(todos, { name: 'Call Acme' });
  return { issues: issues.id, guides: guides.id, notes: notes.id, tasks: tasks.id, todos: todos.id };
});

const until = async (read, ok = Boolean, { timeout = 10000 } = {}) => {
  const end = Date.now() + timeout;
  let got = await read();
  while (!ok(got) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    got = await read();
  }
  return got;
};
const rows = (page, id) => page.evaluate(async (id) => (await (await fetch(`/api/tables/${id}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).items.map((e) => ({ name: e.name, Severity: e.fields.Severity ?? null, Symptom: e.fields.Symptom ?? [] })), id);
const CREATE = '#tray .tray-actions button[type="submit"]';

if (s) {
  const { base, browser, issues, guides, notes, tasks, todos } = s;
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
      test(`on a phone + opens the create tray, never a bottom sheet or a popover, and writes nothing until Create (${engine}, ${theme}, Issue #739, Issue #1471)`, async () => {
        const page = await open(make, issues, theme);
        try {
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          assert.equal(await page.getAttribute('.phone-bar .phone-new', 'aria-label'), 'New bug');
          const before = (await rows(page, issues)).length;
          await page.click('.phone-bar .phone-new');
          await page.waitForSelector('#tray-back #tray .new-row-name');
          assert.equal(await page.locator('.new-row-sheet').count(), 0, 'the phone + creates in the tray, not a bottom sheet');
          assert.equal(await page.locator('#modal-back').count(), 0, 'and never a centered modal');
          assert.equal(await page.textContent('#tray-title'), 'New bug', 'the tray names the row by its table');
          const labels = await page.locator('#tray .new-row-label').allTextContents();
          assert.deepEqual(labels, ['Name', 'Severity', 'Symptom'], 'the name and the table\'s choice fields');
          await page.keyboard.press('Escape');
          await page.waitForSelector('#tray-back', { state: 'detached' });
          assert.equal((await rows(page, issues)).length, before, 'dismissing writes nothing');
          await page.click('.phone-bar .phone-new');
          await page.waitForSelector(CREATE);
          assert.equal(await page.isDisabled(CREATE), true, 'Create waits for a name');
          await page.fill('#tray .new-row-name', `Looks broken: made in ${engine} ${theme}`);
          await page.click('#tray .new-row-opt[data-opt="High"]');
          await page.click('#tray .new-row-opt[data-opt="Slow"]');
          await page.click('#tray .new-row-opt[data-opt="Error"]');
          const heights = await page.locator(`#tray .new-row-opt, #tray .tray-actions .btn`).evaluateAll((bs) => bs.map((b) => b.getBoundingClientRect().height));
          assert.ok(heights.every((h) => h >= 44), `every create control is a 44px target: ${heights}`);
          assert.equal((await rows(page, issues)).length, before, 'picking writes nothing');
          await page.click(CREATE);
          const made = await until(async () => (await rows(page, issues)).find((r) => r.name === `Looks broken: made in ${engine} ${theme}`));
          assert.deepEqual(made, { name: `Looks broken: made in ${engine} ${theme}`, Severity: 'High', Symptom: ['Slow', 'Error'] });
          await page.click('#wv-toasts .wv-toast-action');
          await page.waitForSelector('#tray-back', { state: 'detached' });
          await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
          assert.equal(await page.inputValue('#dock textarea.name-edit'), made.name, 'the toast opens the new row');
        } finally { await page.close(); }
      });
    }

    test(`on a phone the tray names the row by its table's term, and by the table's name in singular form when it has none (${engine}, Issue #739, Issue #792)`, async () => {
      for (const [id, want, noun] of [[guides, 'New guide', 'guide'], [notes, 'New note', 'note'], [tasks, 'New task', 'task']]) {
        const page = await open(make, id);
        try {
          assert.equal(await page.getAttribute('.phone-bar .phone-new', 'aria-label'), want);
          await page.click('.phone-bar .phone-new');
          await page.waitForSelector('#tray .new-row-name');
          assert.equal(await page.textContent('#tray-title'), want);
          assert.equal(await page.getAttribute('#tray', 'aria-labelledby'), 'tray-title');
          assert.equal(await page.getAttribute('#tray .new-row-name', 'placeholder'), `Name this ${noun}`);
          await page.keyboard.press('Escape');
          await page.waitForSelector('#tray-back', { state: 'detached' });
        } finally { await page.close(); }
      }
    });

    test(`on a phone the tray opened from a table has no table select, and only a create with no table in context asks which table, inside the tray (${engine}, Issue #793, Issue #1471)`, async () => {
      const page = await open(make, issues);
      try {
        await page.click('.phone-bar .phone-new');
        await page.waitForSelector('#tray .new-row-name');
        assert.equal(await page.locator('#tray input[name="table"]').count(), 0, 'nothing switches the table');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#tray-back', { state: 'detached' });
        await page.evaluate(() => newRowTray());
        await page.waitForSelector('#tray .picker-face');
        assert.equal(await page.locator('#tray input[name="table"]').count(), 1, 'the table is chosen inside the tray');
        assert.equal(await page.locator('.picker-pop').count(), 0, 'and the tray opens no popover of its own');
        await page.click('#tray .picker-face');
        await page.waitForSelector('.picker-pop .picker-row');
        await page.locator('.picker-pop .picker-row', { hasText: 'Issue' }).first().click();
        await page.waitForSelector('.picker-pop', { state: 'detached' });
        assert.equal(await page.textContent('#tray .picker-face'), 'Issue', 'the face names the table');
        assert.equal(await page.textContent('#tray-title'), 'New bug', 'picking a table renames the tray');
        assert.deepEqual(await page.locator('#tray .new-row-label').allTextContents(), ['Table', 'Name', 'Severity', 'Symptom'], 'and draws that table\'s choice fields');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#tray-back', { state: 'detached' });
      } finally { await page.close(); }
    });

    test(`on a phone a cold load of a table view shows + without waiting on the workspace list (${engine}, Issue #1006)`, async () => {
      const page = await make();
      try {
        await page.route('**/api/workspaces*', async (r) => { await new Promise((ok) => setTimeout(ok, 6000)); await r.continue().catch(() => {}); });
        await page.goto(`${base}/#/table/${todos}`);
        await page.waitForSelector('#main .wv-grid');
        assert.equal(await until(() => page.evaluate(() => document.querySelector('.phone-bar .phone-new')?.hidden), (h) => h === false, { timeout: 3000 }), false, 'the + is up once the table paints');
        assert.equal(await page.getAttribute('.phone-bar .phone-new', 'aria-label'), 'New todo');
      } finally { await page.close(); }
    });

    test(`on a phone Create keeps the tray open with the name cleared and focus in it, so a second row needs no reopen (${engine}, Issue #988)`, async () => {
      const page = await open(make, issues);
      try {
        const before = (await rows(page, issues)).length;
        await page.click('.phone-bar .phone-new');
        await page.waitForSelector('#tray .new-row-name');
        await page.fill('#tray .new-row-name', `First of two in ${engine}`);
        await page.click('#tray .new-row-opt[data-opt="High"]');
        await page.click(CREATE);
        assert.equal(await page.inputValue('#tray .new-row-name'), '', 'the name clears at once');
        assert.ok(await page.isVisible('#tray'), 'the tray stays open');
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('new-row-name')), true, 'focus stays in the name, so the keyboard stays up');
        assert.equal(await page.getAttribute('#tray .new-row-opt[data-opt="High"]', 'aria-pressed'), 'false', 'choices reset with the name');
        assert.equal(await page.isDisabled(CREATE), true, 'Create waits for the next name');
        await page.keyboard.type(`Second of two in ${engine}`);
        await page.keyboard.press('Enter');
        assert.equal(await page.inputValue('#tray .new-row-name'), '');
        const made = await until(async () => (await rows(page, issues)).filter((r) => r.name.endsWith(`of two in ${engine}`)), (r) => r.length === 2);
        assert.deepEqual(made.map((r) => [r.name, r.Severity]).sort(), [[`First of two in ${engine}`, 'High'], [`Second of two in ${engine}`, null]]);
        assert.equal((await rows(page, issues)).length, before + 2, 'two rows, each written once');
        assert.ok(await page.isVisible('#tray'), 'still open for a third');
        assert.ok(await until(async () => (await page.locator('#wv-toasts .wv-toast-msg').allTextContents()).some((t) => t.includes(`Second of two in ${engine}`))), 'a toast names the new row');
        assert.equal(await page.locator('#dock:not([hidden]) textarea.name-edit').count(), 0, 'no row opened on its own');
      } finally { await page.close(); }
    });

    test(`on a phone a refused create puts the name back and says why (${engine}, Issue #988)`, async () => {
      const page = await open(make, notes);
      try {
        await page.route('**/api/tables/*/entities', (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Refused for the test"}' }) : r.continue()));
        await page.click('.phone-bar .phone-new');
        await page.waitForSelector('#tray .new-row-name');
        await page.fill('#tray .new-row-name', 'Comes back');
        await page.click(CREATE);
        assert.equal(await until(() => page.inputValue('#tray .new-row-name'), (v) => v === 'Comes back'), 'Comes back', 'the name comes back');
        assert.ok(await page.isVisible('#tray'));
        assert.match(await until(async () => (await page.locator('#wv-toasts .wv-toast.err .wv-toast-msg').allTextContents()).join(' '), (t) => t.includes('Refused for the test')), /Refused for the test/);
      } finally { await page.close(); }
    });

    test(`on a phone the Name is one line whose Return key reads Done and creates the row, never while empty or composing (${engine}, Issue #794)`, async () => {
      const page = await open(make, notes);
      const made = `Made by Return in ${engine}`;
      try {
        await page.click('.phone-bar .phone-new');
        await page.waitForSelector('#tray .new-row-name');
        assert.equal(await page.evaluate(() => document.querySelector('#tray .new-row-name').tagName), 'INPUT');
        assert.equal(await page.getAttribute('#tray .new-row-name', 'enterkeyhint'), 'done');
        const before = (await rows(page, notes)).length;
        await page.focus('#tray .new-row-name');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
        assert.equal((await rows(page, notes)).length, before, 'Return on an empty name writes nothing');
        assert.ok(await page.isVisible('#tray'), 'and the tray stays');
        await page.fill('#tray .new-row-name', made);
        await page.evaluate(() => document.querySelector('#tray .new-row-name').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
        await page.waitForTimeout(300);
        assert.equal((await rows(page, notes)).length, before, 'Return that ends an IME composition writes nothing');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        assert.equal(await eventually(async () => (await rows(page, notes)).filter((r) => r.name === made).length, 1), 1, 'Return wrote the row once');
        assert.ok(await page.isVisible('#tray'), 'the tray stays for the next row, as Create does');
        assert.equal(await page.inputValue('#tray .new-row-name'), '', 'with the name cleared');
      } finally { await page.close(); }
    });
  }

  test('on a desktop the tray keeps its two-line Name, where Return starts a new line, and Create opens the new row (Issue #794, Issue #1471)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${base}/#/table/${notes}`, { waitUntil: 'networkidle' });
      await page.evaluate((id) => newRowTray(allTables().find((t) => t.id === id)), notes);
      await page.waitForSelector('#tray .new-row-name');
      assert.equal(await page.evaluate(() => document.querySelector('#tray .new-row-name').tagName), 'TEXTAREA');
      assert.equal(await page.getAttribute('#tray .new-row-name', 'enterkeyhint'), null);
      await page.fill('#tray .new-row-name', 'two');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      assert.ok(await page.isVisible('#tray'), 'Return does not create on a desktop');
      await page.fill('#tray .new-row-name', 'Made on a desktop');
      await page.click(CREATE);
      await page.waitForSelector('#tray-back', { state: 'detached' });
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      assert.equal(await page.inputValue('#dock textarea.name-edit'), 'Made on a desktop', 'the tray closes on the new row');
    } finally { await page.close(); }
  });
}
