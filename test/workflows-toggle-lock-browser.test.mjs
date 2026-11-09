import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phonePage, phoneBrowser, styleOf, eventually } from './lib/browser.mjs';

const s = await launch('workflows toggle lock', (w) => {
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  w.addField(t.id, { name: 'Notes', type: 'text' });
  w.addField(t.id, { name: 'Gone', type: 'text' });
  const workflows = Object.values(w.state.tables).find((x) => x.system === 'workflows');
  const half = w.createEntity(workflows.id, { Name: 'Half built' });
  w.setDoc(half.id, JSON.stringify({ table: 'Ops/Request', trigger: { type: 'field-updated', field: 'Nope' }, actions: [{ type: 'add-comment', text: 'x' }] }), 'Script');
  const broken = w.createAutomation(t.id, { name: 'Broke while on', trigger: { type: 'field-updated', field: 'Gone' }, actions: [{ type: 'add-comment', text: 'x' }] });
  w.deleteField(t.id, 'Gone');
  return { workflows, half, broken };
});

if (s) {
  const { weave, base, browser, workflows, half, broken } = s;
  const on = (id) => weave.readEntity(id).fields.On;
  const open = async (page) => {
    await page.goto(`${base}/#/table/${workflows.id}`, { waitUntil: 'networkidle' });
    await page.locator(`tr[data-eid="${half.id}"] td[data-field="On"] .wv-toggle`).first().waitFor();
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`a Setup incomplete row that is Off has a greyed On toggle that says why (${colorScheme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme });
      await open(page);
      const toggle = page.locator(`tr[data-eid="${half.id}"] td[data-field="On"] .wv-toggle`);
      assert.equal(await toggle.locator('input').isDisabled(), true, 'the switch cannot be thrown');
      assert.match(await toggle.getAttribute('title'), /^Setup incomplete: .*Nope/, 'the reason shows on hover');
      await styleOf(toggle, 'opacity', '0.55');
      assert.equal(await toggle.evaluate((n) => getComputedStyle(n).cursor), 'not-allowed');
      await page.locator(`tr[data-eid="${half.id}"] td[data-field="On"]`).click();
      const pop = page.locator('.chip-pop .wf-reason');
      await pop.waitFor();
      assert.match(await pop.textContent(), /Nope/, 'a click names what is missing');
      assert.notEqual(await pop.evaluate((n) => getComputedStyle(n).color), await page.locator('.chip-pop').evaluate((n) => getComputedStyle(n).backgroundColor));
      await page.keyboard.press('Escape');
      await page.locator(`tr[data-eid="${half.id}"] td[data-field="On"]`).focus();
      await page.keyboard.press(' ');
      assert.equal(on(half.id), false, 'neither the click nor Space switched it On');
      assert.equal(await toggle.locator('input').isChecked(), false);
      await page.close();
    });
  }

  test('a row that broke while On keeps a live toggle, and switching it Off works', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await open(page);
    const toggle = page.locator(`tr[data-eid="${broken.id}"] td[data-field="On"] .wv-toggle`);
    assert.equal(await toggle.locator('input').isDisabled(), false);
    assert.equal(await toggle.evaluate((n) => n.classList.contains('is-locked')), false);
    await toggle.click();
    assert.equal(await eventually(() => on(broken.id), false), false, 'the click switched it Off');
    const after = page.locator(`tr[data-eid="${broken.id}"] td[data-field="On"] .wv-toggle`);
    assert.equal(await eventually(() => after.evaluate((n) => n.classList.contains('is-locked')).catch(() => null), true), true);
    assert.match(await after.getAttribute('title'), /^Setup incomplete: .*Gone/, 'once Off it locks, and says why');
    await page.close();
  });

  test('on a phone a tap on the locked toggle shows why', async () => {
    const page = await phonePage(await phoneBrowser());
    await open(page);
    await page.locator(`[data-eid="${half.id}"] [data-field="On"]`).first().tap();
    const pop = page.locator('.chip-pop .wf-reason');
    await pop.waitFor();
    assert.match(await pop.textContent(), /Nope/);
    assert.equal(on(half.id), false);
    await page.close();
  });
}
