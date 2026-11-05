import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';
import { hold, releaseEarly } from './lib/hold.mjs';

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
  const definitionOf = (id) => weave.readEntity(id).raw.Definition ?? null;

  const openEntity = async (id) => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    return page;
  };

  const openClear = async (id) => {
    const page = await openEntity(id);
    await page.locator('.entity-fields .fieldrow', { hasText: 'Definition' }).first().locator('.fielddef-edit .k-computed').click();
    const clear = page.locator('#modal .hold-btn');
    await clear.waitFor();
    return { page, clear };
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
    const { page, clear } = await openClear(id);
    assert.match(await clear.textContent(), /clear/i);

    await releaseEarly(clear);
    assert.deepEqual(definitionOf(id), MONEY, 'a cancelled hold must change nothing');
    assert.equal(await page.locator('#modal-back').count(), 1, 'the editor is still open after a hold let go early');

    await hold(clear);
    assert.equal(await eventually(() => definitionOf(id), null), null);
    await page.close();
  });

  test('what the clear took, it offers straight back', async () => {
    const id = freshSpec();
    const { page, clear } = await openClear(id);
    await hold(clear);

    const offer = page.locator('.wv-toast', { has: page.locator('.wv-toast-action') });
    await offer.waitFor();
    assert.match(await offer.textContent(), /currency/i,
      'the toast names what went, not just that something did');
    await offer.locator('.wv-toast-action').click();
    assert.deepEqual(await eventually(() => definitionOf(id), MONEY), MONEY, 'undo restores the exact type and config');
    await page.close();
  });
}
