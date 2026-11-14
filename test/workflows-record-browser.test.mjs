import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage, styleOf } from './lib/browser.mjs';

const s = await launch('workflows record page', (w) => {
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  w.addField(t.id, { name: 'Notes', type: 'text' });
  const workflows = Object.values(w.state.tables).find((x) => x.system === 'workflows');
  const half = w.createEntity(workflows.id, { Name: 'Half built' });
  w.setDoc(half.id, JSON.stringify({ table: 'Ops/Request', trigger: { type: 'field-updated', field: 'Nope' }, actions: [{ type: 'add-comment', text: 'x' }] }), 'Script');
  return { workflows, half };
});

if (s) {
  const { weave, base, browser, half } = s;
  const on = (id) => weave.readEntity(id).fields.On;
  const openRecord = async (page) => {
    await page.goto(`${base}/#/entity/${half.id}`, { waitUntil: 'networkidle' });
    await page.locator('#main .entity-values').first().waitFor();
  };
  const toggleOf = (page) => page.locator('#main .entity-values .wv-toggle').first();
  const healthOf = (page) => page.locator('#main .entity-values .wf-health').first();

  for (const colorScheme of ['light', 'dark']) {
    test(`the record page locks On with its reason and reads Health as a chip, like the table (${colorScheme}) (Issue #1504)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme });
      await openRecord(page);
      const toggle = toggleOf(page);
      await toggle.waitFor();
      assert.equal(await toggle.evaluate((n) => n.classList.contains('is-locked')), true, 'the record page draws the locked toggle, not the plain switch');
      assert.equal(await toggle.locator('input').isDisabled(), true, 'the switch cannot be thrown from the record page');
      assert.match(await toggle.getAttribute('title'), /^Setup incomplete: .*Nope/, 'the reason shows on hover');
      await styleOf(toggle, 'opacity', '0.55');
      assert.equal(await toggle.evaluate((n) => getComputedStyle(n).cursor), 'not-allowed');

      const health = healthOf(page);
      await health.waitFor();
      assert.equal(await health.evaluate((n) => n.matches('input, select, textarea')), false, 'Health reads as a chip, not an editor');
      assert.match(await health.getAttribute('title'), /Nope|Health:/, 'the chip carries the reason');

      await toggle.click({ force: true });
      const pop = page.locator('.chip-pop .wf-reason');
      await pop.waitFor();
      assert.match(await pop.textContent(), /Nope/, 'a click on the record page names what is missing');
      assert.notEqual(await pop.evaluate((n) => getComputedStyle(n).color), await page.locator('.chip-pop').evaluate((n) => getComputedStyle(n).backgroundColor));
      assert.equal(on(half.id), false, 'the click never switched it On');
      await page.close();
    });
  }

  test('at phone width the record page keeps the locked toggle and the Health chip (Issue #1504)', async () => {
    const page = await phonePage(await phoneBrowser(), { colorScheme: 'light' });
    await openRecord(page);
    const toggle = toggleOf(page);
    await toggle.waitFor();
    assert.equal(await toggle.evaluate((n) => n.classList.contains('is-locked')), true);
    assert.equal(await toggle.locator('input').isDisabled(), true);
    await healthOf(page).waitFor();
    assert.equal(on(half.id), false);
    await page.close();
  });
}
