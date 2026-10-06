import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let task, tasks;
const s = await launch('appears-as honours hidden views', (weave) => {
  weave.createSpace({ name: 'Dev' });
  tasks = weave.createTable({ space: 'Dev', name: 'Task' });
  weave.addField(tasks, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  task = weave.createEntity('Task', { name: 'Ship the editor', values: { Severity: 'High' } });
  weave.updateTable(tasks, { hiddenFields: [] });
});

if (s) {
  const { base, browser, weave } = s;
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${task.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.entity-values .fieldrow');
    return page;
  };
  const strip = (page) => page.evaluate(() => ({
    strip: !!document.querySelector('.wv-appears'),
    chip: !!document.querySelector('.wv-appears-chip'),
    card: !!document.querySelector('.wv-appears-card'),
  }));
  const hiddenNow = () => weave.describeSchema().flatMap((sp) => sp.tables).find((t) => t.id === tasks.id).hiddenFields ?? [];
  const switchReads = ([name, want]) => [...document.querySelectorAll('.eye-row')]
    .find((r) => r.querySelector('.eye-label')?.textContent === name)
    ?.getAttribute('aria-checked') === want;
  const flip = async (page, name) => {
    const was = hiddenNow().includes(name);
    await page.click('.eye-btn');
    await page.locator('.eye-row', { hasText: name }).first().click();
    await page.waitForFunction(switchReads, [name, was ? 'true' : 'false']);
    for (const t0 = Date.now(); hiddenNow().includes(name) === was && Date.now() - t0 < 5000;) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(hiddenNow().includes(name), !was, `the ${name} flip reached the table`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
  };

  test('both views shown: the strip carries a chip and a card', async () => {
    const page = await open();
    assert.deepEqual(await strip(page), { strip: true, chip: true, card: true });
    await page.close();
  });

  test('Chip switched off in the eye leaves the strip; Card alone remains', async () => {
    const page = await open();
    await flip(page, 'Chip');
    assert.ok(hiddenNow().includes('Chip'), 'the eye wrote the hidden set');
    await page.waitForFunction(() => !document.querySelector('.wv-appears-chip'));
    assert.deepEqual(await strip(page), { strip: true, chip: false, card: true });
    await page.close();
  });

  test('Card switched off too: no strip at all — and switching Chip back on brings it back', async () => {
    const page = await open();
    await flip(page, 'Card');
    await page.waitForFunction(() => !document.querySelector('.wv-appears'));
    assert.deepEqual(await strip(page), { strip: false, chip: false, card: false });
    await flip(page, 'Chip');
    await page.waitForFunction(() => !!document.querySelector('.wv-appears-chip'));
    assert.deepEqual(await strip(page), { strip: true, chip: true, card: false });
    await page.close();
  });
}
