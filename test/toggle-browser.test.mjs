/* The toggle field in a real browser (Feature #202): the cell rests as a
   switch wearing the word of its state; a click flips it and so does Space
   on the resting cell — the one cell where Space is not row selection; the
   entity page draws the same switch; the field dialog edits the two labels
   and the default and round-trips them; the filter strip offers the labels;
   and the switch reads in the dark theme too. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let feeds, active, live, paused;
const s = await launch('toggle field', (weave) => {
  weave.createSpace({ name: 'Ops' });
  feeds = weave.createTable({ space: 'Ops', name: 'Feed' });
  weave.addField(feeds, { name: 'Note', type: 'text' });
  active = weave.addField(feeds, { name: 'Active', type: 'toggle', config: { on: 'Live', off: 'Paused' } });
  live = weave.createEntity(feeds, { name: 'Prices', values: { Active: true } });
  paused = weave.createEntity(feeds, { name: 'Weather' });
});

if (s) {
  const { base, browser, weave } = s;
  const cell = (id) => `tr[data-eid="${id}"] td[data-field="Active"]`;
  const stored = (id) => weave.getEntity(id).values[active.id] ?? false;
  async function open(path, { colorScheme = 'light' } = {}) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' });
    return page;
  }
  const grid = (opts) => open(`#/table/${feeds.id}`, opts).then(async (page) => {
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  });
  const word = (page, id) => page.locator(`${cell(id)} .wv-toggle-word`).textContent();
  const isOn = (page, id) => page.locator(`${cell(id)} .wv-toggle`).evaluate((l) => l.classList.contains('on'));
  /* A flip paints at once and then reconciles through PATCH → GET → a grid
     redraw that puts the focus back a frame later. `flip` marks the tbody
     before the gesture and waits for the redraw to take the mark away, the
     word to read as expected, and the cursor to be back on the cell — or
     the next press lands in the frame the old row is already gone. */
  const flip = async (page, id, gesture, expect) => {
    await page.evaluate(() => { document.querySelector('#main tbody').dataset.mark = '1'; });
    await gesture();
    await page.waitForFunction(() => !document.querySelector('#main tbody')?.dataset.mark);
    await page.waitForFunction(([sel, w]) => document.querySelector(sel)?.textContent === w, [`${cell(id)} .wv-toggle-word`, expect]);
    await page.waitForFunction((sel) => document.activeElement === document.querySelector(sel), cell(id));
    assert.equal(await word(page, id), expect);
  };

  test('the cell rests as a switch wearing its state\'s word; a click flips it and saves', async () => {
    const page = await grid();
    try {
      await page.waitForSelector(`${cell(live.id)} .wv-toggle`);
      assert.equal(await word(page, live.id), 'Live');
      assert.equal(await isOn(page, live.id), true);
      assert.equal(await word(page, paused.id), 'Paused');
      assert.equal(await isOn(page, paused.id), false);
      assert.equal(await page.locator(`${cell(paused.id)} input[role="switch"]`).count(), 1, 'a real switch underneath');

      await flip(page, paused.id, () => page.locator(`${cell(paused.id)} .wv-toggle-track`).click(), 'Live');
      assert.equal(await isOn(page, paused.id), true, 'the word follows the state');
      assert.equal(stored(paused.id), true, 'one click, one flip, saved');
      weave.updateEntity(paused.id, { Active: false });
    } finally { await page.close(); }
  });

  test('Space on the resting cell flips the switch instead of picking the row up', async () => {
    const page = await grid();
    try {
      await page.waitForSelector(`${cell(paused.id)} .wv-toggle`);
      await page.focus(cell(paused.id));
      await flip(page, paused.id, () => page.keyboard.press('Space'), 'Live');
      assert.equal(stored(paused.id), true);
      assert.equal(await page.locator('tr.entity-row .sel-box:checked').count(), 0, 'the row was not picked up');
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'TD', 'the cell keeps the focus, not the box');
      await flip(page, paused.id, () => page.keyboard.press('Space'), 'Paused');
      assert.equal(stored(paused.id), false, 'and back — one flip per press, never two');
      // Space on a text cell still picks the row up.
      await page.focus(`tr[data-eid="${paused.id}"] td[data-field="Note"]`);
      await page.keyboard.press('Space');
      assert.equal(stored(paused.id), false, 'a text cell does not flip the neighbour');
    } finally { await page.close(); }
  });

  test('the entity page draws the same switch', async () => {
    const page = await open(`#/entity/${live.id}`);
    try {
      const sw = page.locator('.wv-toggle').first();
      await sw.waitFor();
      assert.equal(await sw.locator('.wv-toggle-word').textContent(), 'Live');
      assert.equal(await sw.evaluate((l) => l.classList.contains('on')), true);
    } finally { await page.close(); }
  });

  test('the field dialog edits the two labels and the default, and they round-trip', async () => {
    const page = await grid();
    try {
      const th = page.locator('.wv-grid thead th.col-head', { hasText: 'Active' }).first();
      await th.hover();
      await th.locator('.field-menu').click();
      await page.locator('.chip-pop .wv-menu-row', { hasText: 'Edit field' }).click();
      const on = page.locator('.tray-form input[data-toggle-label="on"]');
      const off = page.locator('.tray-form input[data-toggle-label="off"]');
      await on.waitFor();
      assert.equal(await on.inputValue(), 'Live', 'the dialog opens on the stored labels');
      assert.equal(await off.inputValue(), 'Paused');
      await on.fill('Enabled');
      await on.press('Tab');
      await off.fill('Disabled');
      await off.press('Tab');
      // The default control names the states with the words just typed.
      const enabled = page.locator('.tray-form .seg-ctl .seg-opt', { hasText: 'Enabled' });
      await enabled.waitFor();
      await enabled.click();
      await page.locator('.tray-form button[type="submit"]').click();
      await page.waitForFunction(() => !document.querySelector('.tray-form'));
      const f = weave.getField(feeds, 'Active');
      assert.deepEqual(f.config, { on: 'Enabled', off: 'Disabled', default: true });
      await page.waitForFunction((sel) => document.querySelector(sel)?.textContent === 'Disabled', `${cell(paused.id)} .wv-toggle-word`);
      assert.equal(await word(page, live.id), 'Enabled', 'the grid wears the new words');
      weave.updateField(feeds, 'Active', { config: { on: 'Live', off: 'Paused', default: null } });
    } finally { await page.close(); }
  });

  test('the filter strip offers the two labels and narrows the rows', async () => {
    const page = await grid();
    try {
      const chip = page.locator('.filter-strip .filter-chip', { hasText: 'Live' });
      await chip.waitFor();
      assert.equal(await page.locator('.filter-strip .filter-chip', { hasText: 'Paused' }).count(), 1);
      await chip.click();
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 1);
      assert.equal(await page.locator('.wv-grid tbody tr.entity-row').getAttribute('data-eid'), live.id);
      assert.deepEqual(weave.getTable(feeds).filters, { Active: ['Live'] });
      weave.updateTable(feeds, { filters: {} });
    } finally { await page.close(); }
  });

  test('in the dark theme the switch still says its state: on and off tracks differ', async () => {
    const page = await grid({ colorScheme: 'dark' });
    try {
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), 'dark', 'the page resolved the theme under test');
      await page.waitForSelector(`${cell(live.id)} .wv-toggle`);
      const bg = (id) => page.locator(`${cell(id)} .wv-toggle-track`).evaluate((t) => getComputedStyle(t).backgroundColor);
      assert.notEqual(await bg(live.id), await bg(paused.id), 'on and off are two colours');
      const knob = await page.locator(`${cell(live.id)} .wv-toggle-knob`).evaluate((k) => getComputedStyle(k).transform);
      assert.notEqual(knob, 'none', 'the knob sits at the on end');
      await page.locator(`${cell(live.id)} .wv-toggle`).screenshot({ path: process.env.WEAVE_SHOT_DIR ? `${process.env.WEAVE_SHOT_DIR}/toggle-dark.png` : undefined }).catch(() => {});
    } finally { await page.close(); }
  });
}
