import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let specs;

const MONEY = { type: 'number', config: { format: 'currency', currency: 'EUR', decimals: 2 } };

const s = await launch('field definition', (weave) => {
  weave.createSpace({ name: 'Showcase' });
  specs = weave.createTable({ space: 'Showcase', name: 'Spec' });
  weave.addField(specs, { name: 'Definition', type: 'field' });
});
if (s) {
  const { base, browser, weave } = s;
  const freshSpec = () => weave.createEntity(specs, { name: 'Sensor board', values: { Definition: MONEY } }).id;

  const openEntity = async (id) => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    return page;
  };

  const hold = async (page, locator, ms = 1400) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  };

  test('no bare × sits beside a definition — one click cannot erase it', async () => {
    const id = freshSpec();
    const page = await openEntity(id);
    const row = page.locator('.entity-fields .fieldrow', { hasText: 'Definition' }).first();
    const crosses = await row.locator('button', { hasText: /^[×✕]$/ }).count();
    assert.equal(crosses, 0, 'a definition must not be one click from gone');
    assert.deepEqual(weave.readEntity(id).raw.Definition, MONEY);
    await page.close();
  });

  test('the definition editor clears it, and only after the gesture completes', async () => {
    const id = freshSpec();
    const page = await openEntity(id);
    await page.locator('.entity-fields .fieldrow', { hasText: 'Definition' }).first().locator('.fielddef-edit .k-computed').click();
    const clear = page.locator('#modal .hold-btn');
    await clear.waitFor();
    assert.match(await clear.textContent(), /clear/i);

    await hold(page, clear, 200);
    await page.waitForTimeout(300);
    assert.deepEqual(weave.readEntity(id).raw.Definition, MONEY, 'a cancelled hold must change nothing');

    await hold(page, clear);
    await page.waitForTimeout(400);
    assert.equal(weave.readEntity(id).raw.Definition ?? null, null);
    await page.close();
  });

  test('what the clear took, it offers straight back', async () => {
    const id = freshSpec();
    const page = await openEntity(id);
    await page.locator('.entity-fields .fieldrow', { hasText: 'Definition' }).first().locator('.fielddef-edit .k-computed').click();
    await hold(page, page.locator('#modal .hold-btn'));
    await page.waitForTimeout(400);

    const offer = page.locator('.wv-toast', { has: page.locator('.wv-toast-action') });
    await offer.waitFor({ timeout: 3000 });
    assert.match(await offer.textContent(), /currency/i,
      'the toast names what went, not just that something did');
    const undo = offer.locator('.wv-toast-action');
    await undo.click();
    await page.waitForTimeout(400);
    assert.deepEqual(weave.readEntity(id).raw.Definition, MONEY, 'undo restores the exact type and config');
    await page.close();
  });
}
