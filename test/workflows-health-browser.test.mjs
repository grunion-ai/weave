import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phonePage, phoneBrowser } from './lib/browser.mjs';

const REASON = 'POST hooks.example.com: answered 500';

const s = await launch('workflows health', (w) => {
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  const mk = (name) => w.createAutomation(t.id, { name, trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'x' }] });
  const healthy = mk('Runs fine');
  const failed = mk('Ping the hook');
  const quiet = mk('Never fired');
  w.updateEntity(healthy.id, { Health: 'Healthy', 'Last Run': '2026-11-09T09:00:00.000Z' });
  w.updateEntity(failed.id, { Health: 'Failed', 'Health Reason': REASON, 'Last Run': '2026-11-09T09:05:00.000Z' });
  const workflows = Object.values(w.state.tables).find((x) => x.system === 'workflows');
  return { workflows, healthy, failed, quiet };
});

if (s) {
  const { weave, base, browser, workflows, healthy, failed, quiet } = s;
  const open = async (page) => {
    await page.goto(`${base}/#/table/${workflows.id}`, { waitUntil: 'networkidle' });
    await page.locator(`tr[data-eid="${failed.id}"] td[data-field="Health"] .wf-health`).first().waitFor();
  };
  const chip = (page, id) => page.locator(`tr[data-eid="${id}"] td[data-field="Health"] .wf-health`);

  for (const colorScheme of ['light', 'dark']) {
    test(`Health reads as a coloured state, and a Failed row says why on hover and on click (${colorScheme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme });
      await open(page);
      const paint = async (id) => chip(page, id).evaluate((n) => ({ text: n.textContent.trim(), color: getComputedStyle(n).color, bg: getComputedStyle(n).backgroundColor }));
      const [ok, bad, none] = [await paint(healthy.id), await paint(failed.id), await paint(quiet.id)];
      assert.deepEqual([ok.text, bad.text, none.text], ['Healthy', 'Failed', 'No runs']);
      assert.equal(new Set([ok.bg, bad.bg, none.bg]).size, 3, 'each state wears its own colour');
      for (const p of [ok, bad, none]) assert.notEqual(p.color, p.bg, `${p.text} is legible`);
      assert.equal(await chip(page, failed.id).getAttribute('title'), REASON, 'the reason shows on hover');
      await chip(page, failed.id).click();
      const pop = page.locator('.chip-pop .wf-reason');
      await pop.waitFor();
      assert.equal(await pop.textContent(), REASON, 'and on click');
      assert.equal(await page.locator('.picker-pop').count(), 0, 'Health is the engine\'s: no picker opens');
      await page.keyboard.press('Escape');
      assert.equal(weave.readEntity(failed.id).fields.Health, 'Failed', 'nothing was written');
      await page.close();
    });
  }

  test('on a phone a tap on Health shows the reason', async () => {
    const page = await phonePage(await phoneBrowser());
    await page.goto(`${base}/#/table/${workflows.id}`, { waitUntil: 'networkidle' });
    const lead = page.locator(`[data-eid="${failed.id}"] .phone-lead[data-field="Health"]`).first();
    await lead.waitFor();
    const box = await lead.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    const pop = page.locator('.chip-pop .wf-reason');
    await pop.waitFor();
    assert.equal(await pop.textContent(), REASON);
    assert.equal(await page.locator('.picker-pop').count(), 0);
    assert.equal(weave.readEntity(failed.id).fields.Health, 'Failed');
    await page.close();
  });
}
