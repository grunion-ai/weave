import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, rows = [];
const s = await launch('a cold table open', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    rows.push(weave.createEntity(tasks, { name, values: { Note: 'one' } }).id);
  }
});

const watch = (page) => page.evaluate(() => {
  const built = new WeakSet();
  for (const wrap of document.querySelectorAll('#main .table-wrap')) built.add(wrap);
  window.__draws = 0;
  new MutationObserver(() => {
    for (const wrap of document.querySelectorAll('#main .table-wrap')) {
      if (!built.has(wrap)) { built.add(wrap); window.__draws += 1; }
    }
  }).observe(document.querySelector('#main'), { childList: true, subtree: true });
});

if (s) {
  const { base, browser, weave } = s;

  const openCold = async (page) => {
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main');
    await watch(page);
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`#main .table-wrap tr[data-eid="${rows[0]}"]`);
    await page.waitForTimeout(500);
    return page.evaluate(() => window.__draws);
  };

  const warm = async (page) => {
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`#main .table-wrap tr[data-eid="${rows[0]}"]`);
  };

  test('a cold open whose cached page lost only its stamps draws the grid once (Issue #1702)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await warm(page);
      weave.updateEntity(rows[0], { Note: 'two' });
      weave.updateEntity(rows[0], { Note: 'one' });
      assert.equal(await openCold(page), 1, 'the fresh page redrew a grid the reader could not tell from the cached one');
      assert.equal(await page.locator(`tr[data-eid="${rows[0]}"] td[data-field="Note"]`).innerText(), 'one');
    } finally { await page.close(); }
  });

  test('a cold open whose cached page lost a drawn cell draws the fresh page over it (Issue #1702)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await warm(page);
      weave.updateEntity(rows[0], { Note: 'three' });
      assert.equal(await openCold(page), 2, 'the reader was left looking at the cached cell');
      assert.equal(await page.locator(`tr[data-eid="${rows[0]}"] td[data-field="Note"]`).innerText(), 'three');
    } finally { await page.close(); }
  });
}
