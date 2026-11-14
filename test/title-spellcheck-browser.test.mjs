import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
const s = await launch('title spellcheck', (weave) => {
  weave.createSpace({ name: 'Work' });
  const tasks = weave.createTable({ space: 'Work', name: 'Task' });
  const row = weave.createEntity(tasks, { name: 'Write API quickstart' });
  return { page: `#/entity/${row.id}` };
});
if (s) {
  const { base, browser, page: hash } = s;
  const spell = (page) => page.evaluate(() => document.querySelector('#main textarea.name-edit').spellcheck);
  test('the record title spellchecks only while it has focus (Issue #1405)', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main textarea.name-edit');
      assert.equal(await spell(page), false, 'no underline before the title is touched');
      await page.focus('#main textarea.name-edit');
      assert.equal(await spell(page), true, 'spellcheck is on while editing');
      await page.evaluate(() => document.querySelector('#main textarea.name-edit').blur());
      assert.equal(await spell(page), false, 'the underline goes away once focus leaves');
    } finally { await page.close(); }
  });
}
