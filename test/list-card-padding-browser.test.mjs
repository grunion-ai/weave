import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let space, tasks, scratch;
const s = await launch('list card padding', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'main';
  space = weave.createSpace({ name: 'Sales' });
  weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.createTable({ space: 'Sales', name: 'Company' });
  tasks = weave.createTable({ space: 'Sales', name: 'Task' });
  weave.createEntity(tasks, { name: 'Call Acme' });
  weave.tableView(`${tasks.id}/Standard`, { layout: 'list' });
  scratch = new Weave();
  scratch.state.meta.name = 'scratch';
  scratch.createSpace({ name: 'Notes' });
}, { server: () => ({ workspaces: { scratch } }) });

const inset = (scope) => [...document.querySelectorAll(`${scope} .list-row`)].map((r) => {
  const cs = getComputedStyle(r);
  return { text: r.textContent.trim().slice(0, 24), left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight), top: parseFloat(cs.paddingTop) };
});

if (s) {
  const { base, browser } = s;
  const roomy = (rows, where) => {
    assert.ok(rows.length, `${where}: rows are on the page`);
    const tight = rows.filter((r) => r.left < 12 || r.right < 12 || r.top < 6);
    assert.deepEqual(tight, [], `${where}: every row in a list card keeps its inset`);
  };

  test('the space page table list keeps its inset, the New table row included', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/space/${space.spaceId ?? space.id}`, { waitUntil: 'networkidle' });
      await page.click('details.space-home-overview > summary');
      await page.waitForSelector('.card.list-rows.space-tables .list-row');
      const rows = await page.evaluate(inset, '.card.list-rows.space-tables');
      roomy(rows, 'space tables');
      assert.ok(await page.locator('.space-tables .list-row-add').count(), 'the add row is measured');
    } finally { await page.close(); }
  });

  test('the workspace home system tables keep their inset', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.card.list-rows.system-tables .list-row');
      roomy(await page.evaluate(inset, '.card.list-rows.system-tables'), 'system tables');
    } finally { await page.close(); }
  });

  test('the List layout keeps its own row height and indent', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-list .list-row');
      const r = await page.locator('.wv-list .list-row').first().evaluate((n) => {
        const cs = getComputedStyle(n);
        return { h: n.getBoundingClientRect().height, left: parseFloat(cs.paddingLeft), right: parseFloat(cs.paddingRight) };
      });
      assert.ok(r.h >= 40, `a comfortable list row is at least 40px, got ${r.h}`);
      assert.deepEqual([r.left, r.right], [4, 12], 'the list row keeps its 4px lead and 12px trail');
    } finally { await page.close(); }
  });
}
