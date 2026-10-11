import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
const s = await launch('option preview follows the name', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.createEntity(tasks, { name: 'Ship it' });
});

if (s) {
  const { base, browser } = s;

  const openTray = async (type) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.click('.add-field-head .add-field-btn');
    await page.waitForSelector('#tray-back .type-tile');
    await page.click(`#tray-back .type-tile[title="${type}"]`);
    await page.waitForSelector('#tray-back .opt-list');
    return page;
  };

  const row = (page, i) => page.locator('#tray-back .opt-list .opt-row').nth(i);
  const previewText = (page, i) => row(page, i).locator('.opt-preview').textContent();
  const caretAtEnd = (page, i) => row(page, i).locator('.opt-name').evaluate((el) => ({
    focused: document.activeElement === el,
    caret: el.selectionStart,
    length: el.value.length,
  }));

  const typeInto = async (page, i, text) => {
    const seen = [];
    await row(page, i).locator('.opt-name').click();
    for (const ch of text) {
      await page.keyboard.type(ch);
      seen.push((await previewText(page, i)).trim());
    }
    return seen;
  };

  test('a select option\'s preview chip renames as you type (Issue #553)', async () => {
    const page = await openTray('select');
    try {
      await page.click('#tray-back .opt-add');
      assert.equal((await previewText(page, 0)).trim(), 'Option', 'an unnamed option previews its placeholder');

      const seen = await typeInto(page, 0, 'P1');
      assert.deepEqual(seen, ['P', 'P1'], 'the chip follows every keystroke');

      const more = await typeInto(page, 0, ' urgent');
      assert.equal(more.at(-1), 'P1 urgent', 'and keeps following an edit to an existing name');
      assert.equal((await row(page, 0).locator('.opt-name').inputValue()), 'P1 urgent');

      const caret = await caretAtEnd(page, 0);
      assert.ok(caret.focused, 'the input keeps focus: the list is not redrawn on input');
      assert.equal(caret.caret, caret.length, 'and the caret stays where the typist left it');
    } finally { await page.close(); }
  });

  test('clearing a select option\'s name puts the placeholder back in the chip', async () => {
    const page = await openTray('select');
    try {
      await page.click('#tray-back .opt-add');
      await typeInto(page, 0, 'P1');
      await row(page, 0).locator('.opt-name').click();
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      assert.equal((await previewText(page, 0)).trim(), 'Option');
    } finally { await page.close(); }
  });

  test('a workflow state\'s preview chip renames as you type (Issue #553)', async () => {
    const page = await openTray('workflow');
    try {
      const before = (await previewText(page, 0)).trim();
      await row(page, 0).locator('.opt-name').click();
      await row(page, 0).locator('.opt-name').evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
      const seen = [];
      for (const ch of ' by design') {
        await page.keyboard.type(ch);
        seen.push((await previewText(page, 0)).trim());
      }
      const want = `${before} by design`;
      assert.equal(seen.at(-1), want, 'the state chip follows the name');
      assert.deepEqual(seen, [...want.slice(before.length)].map((_, i) => want.slice(0, before.length + i + 1).trim()),
        `every keystroke moved the chip: ${JSON.stringify(seen)}`);
      const caret = await caretAtEnd(page, 0);
      assert.ok(caret.focused, 'the input keeps focus');
      assert.equal(caret.caret, caret.length);
    } finally { await page.close(); }
  });
}
