/* The token-box picker, driven through a real browser.

   The grammar is pure and covered in test/picker-core.test.mjs; what needs a
   browser is the claim those cases cannot make — that the keys a person
   presses reach that grammar and that the list they see is the list it
   reasons about. Issue #63 was exactly that gap: every source-level assertion
   passed while ↓ then Enter took a tag OUT of the field, because the row the
   arrow landed on was one already chosen and Enter toggled it.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps,
   nothing npm-installed). It is imported dynamically and the whole suite skips
   when it is absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('picker (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, tasks;

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Product' });
    tasks = weave.createTable({ space: 'Product', name: 'Task' });
    weave.addField(tasks, { name: 'Tags', type: 'multiselect', config: { options: ['bug', 'feature', 'chore', 'design'] } });
    weave.addField(tasks, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2'] } });
    weave.addField(tasks, {
      name: 'State', type: 'workflow', config: {
        states: [
          { name: 'Open', category: 'not-started', default: true },
          { name: 'In Progress', category: 'in-progress' },
          { name: 'Done', category: 'done' },
        ],
      },
    });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  /* One entity per case: a picker commits to the record, so cases that share
     an entity would read each other's writes. */
  const freshTask = (values) => weave.createEntity(tasks, { name: 'Picker case', values }).id;

  /* Opens a field's picker on the entity page and hands back the page with it
     on screen, focused, exactly as a click would leave it. */
  async function openPicker(id, label) {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    await page.evaluate((name) => {
      const row = [...document.querySelectorAll('.entity-fields .fieldrow')]
        .find((r) => r.querySelector('.fieldrow-label')?.textContent.trim() === name);
      (row.querySelector('.ms-box') ?? row.querySelector('.chip-trigger') ?? row.querySelector('.cell-pick')).click();
    }, label);
    await page.waitForSelector('.picker-pop .picker-search');
    return page;
  }

  // A multiselect option draws as its own chip, a select option as a label —
  // both are "the row's name" to a reader, so both count as one here.
  const NAME = '.picker-label, .k';
  const rows = (page) => page.$$eval(`.picker-row :is(${NAME})`, (ns) => ns.map((n) => n.textContent.trim()));
  const armed = (page) => page.$$eval(`.picker-row.active :is(${NAME})`, (ns) => ns.map((n) => n.textContent.trim()));
  const chips = (page) => page.$$eval('.picker-chip', (ns) => ns.map((n) => n.textContent.replace('×', '').trim()));
  // Entity values are keyed by field id; the picker's job is done when the
  // record carries them, so read the record the way the engine stores it.
  const valueOf = (id, field) => weave.resolveField(weave.getEntity(id), field);

  /* A chip is a chip wherever it is drawn. The workflow picker handed its
     rows and its staged chip a class without the `k` base, so every state
     drew as tinted text with no padding and no corners — the cell beside it
     had both (Kyle, 2026-09-02). The classes are read, not the pixels: the
     `.k` rule is what carries the padding and the radius, so its presence is
     the claim. */
  test('every chip in a picker wears the k base class, in the box and in the rows', async () => {
    const dressed = (page) => page.$$eval('.picker-pop :is(.k-state, .k-select, .k-multi)', (ns) => ns.map((n) => ({
      text: n.textContent.replace('×', '').trim(),
      k: n.classList.contains('k'),
      hue: [...n.classList].find((c) => c.startsWith('hue-')) ?? null,
      pad: getComputedStyle(n).paddingLeft,
      radius: getComputedStyle(n).borderRadius,
    })));
    let page = await openPicker(freshTask({ State: 'Done' }), 'State');
    try {
      const chips = await dressed(page);
      assert.deepEqual(chips.map((c) => c.text), ['Done', 'Open', 'In Progress', 'Done'], 'the staged chip, then every state as a row');
      assert.ok(chips.every((c) => c.k), 'each one carries the k base');
      assert.ok(chips.every((c) => c.pad === '8px' && c.radius === '4px'), 'so each one has a chip’s padding and corners');
      assert.deepEqual(chips.map((c) => c.hue), ['hue-green', 'hue-slate', 'hue-blue', 'hue-green'], 'and the hue its category wears in the cell');
    } finally { await page.close(); }
    page = await openPicker(freshTask({ Priority: 'P1' }), 'Priority');
    try {
      const chips = await dressed(page);
      assert.deepEqual(chips.map((c) => c.text), ['P1', '—', 'P0', 'P1', 'P2'],
        'a select stages its value and lists every option as a chip — the clear row too, since the empty cell is a — chip');
      assert.ok(chips.every((c) => c.k && c.pad === '8px'), 'dressed the same way');
    } finally { await page.close(); }
    page = await openPicker(freshTask({ Tags: ['bug'] }), 'Tags');
    try {
      const chips = await dressed(page);
      assert.deepEqual(chips.map((c) => c.text), ['bug', 'feature', 'chore', 'design']);
      assert.ok(chips.every((c) => c.k && c.hue), 'multiselect chips are dressed and hued too');
    } finally { await page.close(); }
  });

  /* Issue #64. The chip in the box already says it; the row would say it
     twice, and every row it pushes down is one you could still pick. */
  test('a chosen option is a chip in the box and not a row in the list', async () => {
    const page = await openPicker(freshTask({ Tags: ['bug'] }), 'Tags');
    try {
      assert.deepEqual(await chips(page), ['bug']);
      assert.deepEqual(await rows(page), ['feature', 'chore', 'design'], 'bug is not listed under its own chip');
      assert.equal(await page.locator('.picker-row .chip-pop-check').count(), 0, 'and no row wears a ✓');
    } finally { await page.close(); }
  });

  /* Issue #63, the reported gesture on the data that produced it. Before the
     fix ↓ armed "bug" — already chosen — and Enter emptied the field. */
  test('↓ then Enter adds a tag, and never takes the arrowed row back out', async () => {
    const page = await openPicker(freshTask({ Tags: ['bug'] }), 'Tags');
    try {
      await page.keyboard.press('ArrowDown');
      assert.deepEqual(await armed(page), ['feature'], '↓ arms the first row you can add');
      await page.keyboard.press('Enter');
      assert.deepEqual(await chips(page), ['bug', 'feature'], 'Enter adds it');
      assert.deepEqual(await rows(page), ['chore', 'design'], 'and it leaves the list on the way into the box');
      assert.equal(await page.locator('.picker-row.active').count(), 0, 'a pick disarms the list');
    } finally { await page.close(); }
  });

  /* The second half of the same grammar: nothing armed means Enter saves, so
     pick-then-Enter is the whole edit without touching the mouse. */
  test('the Enter after a pick saves the set to the record', async () => {
    const id = freshTask({ Tags: ['bug'] });
    const page = await openPicker(id, 'Tags');
    try {
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.picker-pop', { state: 'detached' });
    } finally { await page.close(); }
    // The save is a PATCH behind the closing box; poll rather than sleep.
    let saved;
    for (let i = 0; i < 20; i++) {
      saved = valueOf(id, 'Tags');
      if (saved?.length === 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.deepEqual(saved, ['bug', 'feature'], 'the record carries what the box held');
  });

  /* Issue #65: "numbering" is quick-pick keys. ⌥ and not a bare digit — the
     box is a search field and 1 has to be able to type a 1. */
  test('the rows are numbered and ⌥2 takes the second one', async () => {
    const page = await openPicker(freshTask({ Tags: [] }), 'Tags');
    try {
      assert.deepEqual(await page.$$eval('.picker-num', (ns) => ns.map((n) => n.textContent)), ['1', '2', '3', '4'],
        'every row carries the number that picks it');
      await page.keyboard.press('Alt+Digit2');
      assert.deepEqual(await chips(page), ['feature'], '⌥2 picks the second row without arrowing');
      assert.deepEqual(await page.$$eval('.picker-num', (ns) => ns.map((n) => n.textContent)), ['1', '2', '3'],
        'and the numbers renumber what is left');
    } finally { await page.close(); }
  });

  test('a bare digit still types into the search box', async () => {
    const page = await openPicker(freshTask({ Tags: [] }), 'Tags');
    try {
      await page.keyboard.press('Digit2');
      assert.equal(await page.inputValue('.picker-search'), '2', 'the number is text, not a chord');
      assert.deepEqual(await chips(page), [], 'and picks nothing');
    } finally { await page.close(); }
  });

  /* Single select is the other dialect: it overwrites, so its current value
     stays listed, stays ticked, and a pick closes the picker on the spot. */
  test('a select keeps its current value listed and ticked', async () => {
    const page = await openPicker(freshTask({ Priority: 'P1' }), 'Priority');
    try {
      // '—' is the select's own empty value, which is why it leads the list.
      assert.deepEqual(await rows(page), ['—', 'P0', 'P1', 'P2'], 'nothing is filtered out of a single picker');
      assert.equal(await page.locator('.picker-row .chip-pop-check').count(), 1, 'the current value keeps its ✓');
    } finally { await page.close(); }
  });
}
