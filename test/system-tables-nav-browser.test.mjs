import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let wfId;
const s = await launch('system tables nav', (weave) => {
  weave.createSpace({ name: 'Work' });
  const t = weave.createTable({ space: 'Work', name: 'Tasks' });
  const e = weave.createEntity(t.id, { Name: 'binned' });
  weave.deleteEntity(e.id);
  wfId = weave.getTable('Workspace/Workflows').id;
});

if (s) {
  const { base, browser } = s;

  test('browser: three fixed rows under the spaces; Trash opens the workspace trash', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#sidebar .nav-system a');
    const rows = await page.$$eval('#sidebar .nav-system a', (as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href'), !!a.querySelector('.nav-db-menu')]));
    assert.deepEqual(rows, [['Activity', '#/activity', false], ['Trash', '#/trash', false], ['Workflows', `#/table/${wfId}`, false]]);
    const inList = await page.$$eval('#nav .nav-db', (as) => as.map((a) => a.textContent.trim()));
    assert.ok(!inList.includes('Workflows'), 'Workflows is not listed twice');
    const below = await page.evaluate(() => {
      const last = [...document.querySelectorAll('#nav > *')].pop().getBoundingClientRect();
      return document.querySelector('#sidebar .nav-system').getBoundingClientRect().top >= last.bottom - 1;
    });
    assert.ok(below, 'the group is at the bottom, under every space');
    await page.click('#sidebar .nav-system a[href="#/trash"]');
    await page.waitForSelector('#main .trash-when');
    assert.match(await page.textContent('#main'), /binned/);
    assert.equal(await page.$eval('#sidebar .nav-system a[href="#/trash"]', (a) => a.classList.contains('active')), true);
    await page.click('#sidebar .nav-system a[href^="#/table/"]');
    await page.waitForSelector('#main input.view-title');
    assert.equal(await page.$eval('#main input.view-title', (i) => i.readOnly), true, 'Workflows cannot be renamed from its page');
    await page.close();
  });
}
