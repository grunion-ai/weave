/* The Appears-as strip obeys the eye (Kyle, 2026-09-07: "chip and card
   visibility toggled off but are still showing. this should fail a test").
   One hidden set per table rules the grid, the field rows and this strip
   alike: a Chip switched off leaves the strip, a Card switched off leaves
   it, and with both off the strip is not drawn at all. Driven through the
   page's own eye so the toggle → PATCH → redraw path is what is proved,
   not a hand-edited hidden set.
   Playwright is NOT a dependency of weave (house rule: zero runtime deps);
   it is imported dynamically and the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let task, tasks;
const s = await launch('appears-as honours hidden views', (weave) => {
  weave.createSpace({ name: 'Dev' });
  tasks = weave.createTable({ space: 'Dev', name: 'Task' });
  weave.addField(tasks, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  task = weave.createEntity('Task', { name: 'Ship the editor', values: { Severity: 'High' } });
  // A new table hides both views from the grid; this suite starts with both
  // on, so every step below is one switch moving one way.
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
  /* Flip one row of the page's own eye and wait for the round trip it starts.

     A flip is three steps, in this order: the switch PATCHes the table, the
     page redraws from the fresh schema, and only then does the popover teach
     its own rows the new truth (app.js, `save`). The switch reading the new
     state is therefore the signal that ALL THREE have landed — so that is
     what this waits on, before the Escape and before handing the page to the
     next flip.

     It used to wait on the popover's absence and then sleep 400ms, which let
     that last step land inside the NEXT flip's click: the popover rebuild
     replaces its rows, so a mousedown that focused a row is orphaned, the
     mouseup lands on the replacement, no `click` fires at all, and focus is
     left on <body> — where the Escape below cannot reach the popover, whose
     keydown listener is its own. The popover then stayed open and the wait
     burned its full 30s (Issue #216: two of four full-gate runs). */
  const hiddenNow = () => weave.getTable(tasks.id).hiddenFields ?? [];
  const switchReads = ([name, want]) => [...document.querySelectorAll('.eye-row')]
    .find((r) => r.querySelector('.eye-label')?.textContent === name)
    ?.getAttribute('aria-checked') === want;
  const flip = async (page, name) => {
    const was = hiddenNow().includes(name);
    await page.click('.eye-btn');
    await page.locator('.eye-row', { hasText: name }).first().click();
    // Hidden means the switch is off, so a flip lands on the opposite state.
    await page.waitForFunction(switchReads, [name, was ? 'true' : 'false']);
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
    assert.deepEqual(await strip(page), { strip: true, chip: false, card: true });
    await page.close();
  });

  test('Card switched off too: no strip at all — and switching Chip back on brings it back', async () => {
    const page = await open();
    await flip(page, 'Card');
    assert.deepEqual(await strip(page), { strip: false, chip: false, card: false });
    await flip(page, 'Chip');
    assert.deepEqual(await strip(page), { strip: true, chip: true, card: false });
    await page.close();
  });
}
