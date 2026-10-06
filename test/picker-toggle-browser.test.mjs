import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let sprints;
const s = await launch('picker toggle', (weave) => {
  weave.createSpace({ name: 'Product' });
  sprints = weave.createTable({ space: 'Product', name: 'Sprint' });
  weave.addField(sprints, { name: 'Due', type: 'date', config: { format: 'iso' } });
  weave.addField(sprints, { name: 'Window', type: 'daterange', config: { format: 'iso' } });
  weave.addField(sprints, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2'] } });
  weave.addField(sprints, { name: 'Tags', type: 'multiselect', config: { options: ['bug', 'chore'] } });
});

if (s) {
  const { base, browser, weave } = s;
  const fresh = () => weave.createEntity(sprints, { name: 'Toggle case', values: { Due: '2026-09-15', Priority: 'P1' } }).id;
  const count = (page, sel) => page.evaluate((q) => document.querySelectorAll(q).length, sel);
  const settle = (page) => page.evaluate(() => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
  const entity = async (id, colorScheme) => {
    const page = await browser.newPage({ colorScheme, viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), colorScheme);
    await page.waitForSelector('.entity-fields .fieldrow .date-pick-btn');
    return page;
  };
  const trigger = (page, field, sel) => page.locator('.entity-fields .fieldrow', { hasText: field }).first().locator(sel);
  const SURFACES = [
    ['the date calendar button', 'Due', '.date-pick-btn', '.date-pop'],
    ['the range calendar button', 'Window', '.date-pick-btn', '.date-pop.range'],
    ['a select chip', 'Priority', '.chip-trigger', '.chip-pop'],
    ['a multiselect box', 'Tags', '.ms-box', '.chip-pop'],
  ];

  for (const colorScheme of ['light', 'dark']) {
    for (const [what, field, sel, pop] of SURFACES) {
      test(`a second click on ${what} closes what it opened, and a third opens it (${colorScheme})`, async () => {
        const page = await entity(fresh(), colorScheme);
        try {
          await trigger(page, field, sel).click();
          await page.waitForSelector(pop);
          await trigger(page, field, sel).click();
          await settle(page);
          assert.equal(await count(page, pop), 0, 'the second click closed it and it stayed closed');
          await trigger(page, field, sel).click();
          await page.waitForSelector(pop);
          assert.equal(await count(page, pop), 1, 'one open');
        } finally { await page.close(); }
      });
    }

    for (const [what, field, sel, pop] of [SURFACES[0], SURFACES[2]]) {
      test(`Escape and a genuine outside click still close ${what}'s dialog, and it reopens after either (${colorScheme})`, async () => {
        const page = await entity(fresh(), colorScheme);
        try {
          await trigger(page, field, sel).click();
          await page.waitForSelector(pop);
          await page.keyboard.press('Escape');
          await page.waitForFunction((q) => !document.querySelector(q), pop);
          await trigger(page, field, sel).click();
          await page.waitForSelector(pop);
          await page.mouse.click(4, 4);
          await settle(page);
          assert.equal(await count(page, pop), 0, 'an outside click closed it');
          await trigger(page, field, sel).click();
          await page.waitForSelector(pop);
        } finally { await page.close(); }
      });
    }
  }

  test("with the range's calendar open, the date's button switches to its own dialog in one click", async () => {
    const page = await entity(fresh(), 'light');
    try {
      await trigger(page, 'Window', '.date-pick-btn').click();
      await page.waitForSelector('.date-pop.range');
      await trigger(page, 'Due', '.date-pick-btn').click();
      await settle(page);
      assert.equal(await count(page, '.date-pop'), 1, 'one dialog open');
      assert.equal(await count(page, '.date-pop:not(.range)'), 1, "it is the date's dialog");
    } finally { await page.close(); }
  });

  test("with the multiselect's picker open, the select chip switches to its own in one click", async () => {
    const page = await entity(fresh(), 'dark');
    try {
      await trigger(page, 'Tags', '.ms-box').click();
      await page.waitForSelector('.chip-pop .picker-row');
      await trigger(page, 'Priority', '.chip-trigger').click();
      await settle(page);
      assert.equal(await count(page, '.chip-pop'), 1, 'one picker open');
      assert.ok(await page.locator('.chip-pop .picker-row', { hasText: 'P2' }).count(), "it is the select's picker");
    } finally { await page.close(); }
  });

  test('a calendar pick closes the dialog, and the next click on the button opens it', async () => {
    const id = fresh();
    const page = await entity(id, 'dark');
    try {
      await trigger(page, 'Due', '.date-pick-btn').click();
      const pop = page.locator('.date-pop');
      await pop.waitFor();
      await pop.locator('.date-day.in', { hasText: /^20$/ }).click();
      await page.waitForFunction(() => !document.querySelector('.date-pop'));
      assert.equal(weave.readEntity(id).raw.Due, '2026-09-20', 'the pick landed');
      await trigger(page, 'Due', '.date-pick-btn').click();
      await page.waitForSelector('.date-pop');
    } finally { await page.close(); }
  });

  test('the click on the multiselect box that closes its picker commits what was staged', async () => {
    const id = fresh();
    const page = await entity(id, 'light');
    try {
      await trigger(page, 'Tags', '.ms-box').click();
      await page.locator('.chip-pop .picker-row', { hasText: 'bug' }).click();
      await page.waitForSelector('.chip-pop .picker-chip');
      await trigger(page, 'Tags', '.ms-box').click();
      await page.waitForFunction(() => !document.querySelector('.chip-pop'));
      await page.waitForFunction(() => document.querySelector('.entity-fields .ms-box')?.textContent.includes('bug'));
      assert.deepEqual(weave.readEntity(id).raw.Tags, ['bug'], 'the staged tag was written');
      await settle(page);
      assert.equal(await count(page, '.chip-pop'), 0, 'and the picker stayed closed');
    } finally { await page.close(); }
  });
}
