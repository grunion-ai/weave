import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let acme;
const s = await launch('use template', (root) => {
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'CRM' });
  const deal = root.createTable({ space: 'CRM', name: 'Deal' });
  root.addField(deal.id, { name: 'Amount', type: 'number' });
  root.createEntity(deal.id, { name: 'Big one', values: { Amount: 5 } });
  root.createSpace({ name: 'Plain' });
  acme = new Weave();
  acme.updateWorkspace({ name: 'acme' });
}, { server: () => ({ workspaces: { acme } }) });

if (s) {
  const { base, browser, weave: root } = s;
  const until = async (cond, what) => {
    for (let i = 0; i < 200; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 25)); }
    assert.fail(`timed out waiting for ${what}`);
  };
  const spacesRow = () => root.listEntities(root.getTable('Workspace/Spaces').id).find((e) => root.entityName(e) === 'CRM');

  test('the Template box on the Spaces row marks the space, in the grid and on the row\'s page', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${root.getTable('Workspace/Spaces').id}`, { waitUntil: 'load' });
      const box = page.locator(`tbody tr[data-eid="${spacesRow().id}"]`).getByRole('checkbox', { name: 'Template, CRM' });
      await box.waitFor();
      assert.equal(await box.isChecked(), false);
      await box.click();
      await until(() => root.getSpace('CRM').template === true, 'the grid write');
    } finally { await page.close(); }
    const rowPage = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await rowPage.goto(`${base}/#/entity/${spacesRow().id}`, { waitUntil: 'load' });
      const onPage = rowPage.getByRole('checkbox', { name: 'Template', exact: true });
      await onPage.waitFor();
      assert.equal(await onPage.isChecked(), true, 'the row page shows the mark');
      await onPage.click();
      await until(() => !root.getSpace('CRM').template, 'the row page write');
      await onPage.click();
      await until(() => root.getSpace('CRM').template === true, 'the row page write back');
    } finally { await rowPage.close(); }
  });

  test('Use template copies the schema into the other workspace; a taken name is said in the dialog', async () => {
    root.updateSpace('CRM', { template: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${base}/#/space/${root.getSpace('CRM').id}`, { waitUntil: 'load' });
      await page.click('.use-template-btn');
      await page.waitForSelector('#modal');
      assert.equal((await page.locator('#modal .picker-face').innerText()).trim(), 'acme', 'the one other workspace is offered');
      assert.equal(await page.locator('#modal input[name="name"]').inputValue(), 'CRM', 'the name starts as the space\'s');
      await page.fill('#modal input[name="name"]', 'Sales');
      await page.click('#modal button[type="submit"]');
      await page.waitForSelector('.wv-toast', { state: 'attached' });
      assert.match(await page.locator('.wv-toast').last().innerText(), /Sales is in acme/);
      assert.equal(await page.locator('#modal').count(), 0, 'success closes the dialog');
      const made = acme.getSpace('Sales');
      assert.equal(acme.getTable('Sales/Deal').fieldOrder.length, root.getTable('CRM/Deal').fieldOrder.length);
      assert.equal(acme.listEntities(acme.getTable('Sales/Deal').id).length, 0, 'no rows travel');
      const schema = await (await fetch(`${base}/w/acme/api/schema`)).json();
      assert.ok(schema.find((x) => x.spaceId === made.id), 'the target serves the new space');

      await page.click('.use-template-btn');
      await page.waitForSelector('#modal');
      await page.fill('#modal input[name="name"]', 'Sales');
      await page.click('#modal button[type="submit"]');
      const said = page.locator('#modal .use-template-said');
      await said.waitFor({ state: 'visible' });
      assert.match(await said.innerText(), /already has a space named 'Sales'/);
      assert.equal(await page.locator('#modal').count(), 1, 'the dialog stays open');
    } finally { await page.close(); }
  });

  test('a space that is not a template shows no Use template', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${base}/#/space/${root.getSpace('Plain').id}`, { waitUntil: 'load' });
      await page.waitForSelector('.space-tables');
      assert.equal(await page.locator('.use-template-btn').count(), 0);
    } finally { await page.close(); }
  });

  test('with no other workspace the dialog says so and Use is off', async () => {
    root.updateSpace('CRM', { template: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.route('**/api/workspaces', async (route) => {
        const list = await (await route.fetch()).json();
        await route.fulfill({ json: list.filter((w) => w.default) });
      });
      await page.goto(`${base}/#/space/${root.getSpace('CRM').id}`, { waitUntil: 'load' });
      await page.click('.use-template-btn');
      await page.waitForSelector('#modal .use-template-none');
      assert.equal(await page.locator('#modal button[type="submit"]').isDisabled(), true);
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`the dialog fits a 375px screen and says a refusal legibly (${theme})`, async () => {
      root.updateSpace('CRM', { template: true });
      const page = await browser.newPage({ viewport: { width: 375, height: 760 }, colorScheme: theme });
      try {
        await page.goto(`${base}/#/space/${root.getSpace('CRM').id}`, { waitUntil: 'load' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.click('.use-template-btn');
        await page.waitForSelector('#modal');
        await page.fill('#modal input[name="name"]', 'Sales');
        await page.click('#modal button[type="submit"]');
        await page.locator('#modal .use-template-said').waitFor({ state: 'visible' });
        const box = await page.evaluate(() => {
          const r = document.querySelector('#modal').getBoundingClientRect();
          const said = getComputedStyle(document.querySelector('#modal .use-template-said'));
          const modal = getComputedStyle(document.querySelector('#modal'));
          return { left: r.left, right: r.right, vw: innerWidth, scroll: document.documentElement.scrollWidth, color: said.color, bg: modal.backgroundColor };
        });
        assert.ok(box.left >= 0 && box.right <= box.vw, `the dialog sits on screen: ${JSON.stringify(box)}`);
        assert.ok(box.scroll <= box.vw, 'no sideways scroll');
        assert.notEqual(box.color, box.bg, 'the refusal reads against the dialog');
        if (process.env.WEAVE_SHOTS) await page.screenshot({ path: `${process.env.WEAVE_SHOTS}/use-template-${theme}.png` });
      } finally { await page.close(); }
    });
  }
}
