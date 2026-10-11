import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let target, issue, loner;

const s = await launch('reference panels', (weave) => {
  weave.createSpace({ name: 'Dev' });
  weave.createTable({ space: 'Dev', name: 'Task' });
  weave.createTable({ space: 'Dev', name: 'Issue' });
  target = weave.createEntity('Task', { name: 'Ship the editor' });
  issue = weave.createEntity('Issue', { name: 'Editor loses focus', doc: 'blocks [[Task#1]] until fixed' });
  loner = weave.createEntity('Issue', { name: 'Nobody mentions me' });
});
if (s) {
  const { base, browser, weave } = s;
  const open = async (id, { colorScheme = 'light', side = false } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    page.refRequests = [];
    page.on('request', (r) => { if (/\/references(-from)?$/.test(r.url())) page.refRequests.push(r.url()); });
    const db = weave.getEntity(id).dbId;
    weave.updateTable(db, { systemFields: side ? ['Activity'] : [] });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.entity-grid');
    return page;
  };
  const card = (page, sel) => page.waitForSelector(sel, { state: 'attached' });
  const flipActivity = async (page) => {
    await page.click('.eye-btn');
    await page.click('.chip-pop .eye-row:has(.eye-label:text-is("Activity"))');
  };
  const panelTitles = (page) => page.$$eval('.entity-side > .card.panel', (ns) =>
    ns.map((n) => n.querySelector('.card-title')?.textContent));
  const chipStyle = (page, sel) => page.$eval(`${sel} .k.k-rel`, (chip) => {
    const cs = getComputedStyle(chip);
    const a = chip.querySelector('a');
    return {
      tag: chip.tagName,
      classes: [...chip.classList],
      borderWidth: cs.borderTopWidth,
      borderStyle: cs.borderTopStyle,
      borderColor: cs.borderTopColor,
      background: cs.backgroundColor,
      color: cs.color,
      href: a.getAttribute('href'),
      label: chip.querySelector('.k-label').textContent,
      home: chip.querySelector('.k-home')?.textContent,
      mark: getComputedStyle(a, '::after').content,
      unlink: !!chip.querySelector('.x'),
    };
  });

  test('references are hidden with comments and activity, and not even fetched, until the Activity toggle opens the column', async () => {
    const page = await open(issue.id);
    await page.waitForTimeout(150);
    assert.equal(await page.$('.ref-backlinks-card'), null, 'the resting page never mentions references');
    assert.equal(await page.isVisible('.entity-side'), false, 'the side column is closed');
    assert.deepEqual(page.refRequests, [], 'nothing is fetched until the reader asks');
    await flipActivity(page);
    await card(page, '.ref-outbound-card');
    assert.ok(await page.$eval('.entity-grid', (g) => g.classList.contains('side-open')), 'the column is open');
    assert.equal(await page.isVisible('.ref-outbound-card'), true, 'and the panel shows in it');
    assert.equal(await page.$eval('.ref-outbound-card', (n) => n.parentElement.className), 'entity-side',
      'the panel is in the side column, never the body');
    assert.deepEqual(await panelTitles(page), ['Comments (0)', 'Activity', 'References · 1'],
      'dressed like Activity and below it: what people said, what happened, what this points at');
    assert.deepEqual(page.refRequests.map((u) => u.split('/').pop()).sort(), ['references', 'references-from'],
      'both directions are fetched once the column opens');
    await page.close();
  });

  test('closing the column hides the references again, and the choice is remembered on the table', async () => {
    const page = await open(issue.id, { side: true });
    await card(page, '.ref-outbound-card');
    assert.equal(await page.isVisible('.ref-outbound-card'), true, 'a table with Activity on sees references on load');
    await flipActivity(page);
    await page.waitForSelector('.entity-grid:not(.side-open)');
    assert.equal(await page.$('.ref-backlinks-card'), null, 'closing the column takes the references with it');
    assert.equal(await page.isVisible('.entity-side'), false);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.entity-grid');
    await page.waitForTimeout(150);
    assert.equal(await page.$('.ref-backlinks-card'), null, 'and the next load finds it closed — the table remembers, not the browser');
    await page.close();
  });

  test('the inbound panel mirrors it on the target', async () => {
    const page = await open(target.id, { side: true });
    await card(page, '.ref-inbound-card');
    assert.deepEqual(await panelTitles(page), ['Comments (0)', 'Activity', 'Referenced by · 1']);
    assert.equal(await page.$('.ref-outbound-card'), null, 'a direction with nothing to say is absent');
    const chip = await chipStyle(page, '.ref-inbound-card');
    assert.equal(chip.href, `#/entity/${issue.id}`, 'the chip points back at the mentioning entity');
    assert.equal(chip.label, 'Editor loses focus');
    assert.equal(chip.home, 'Issue', 'the k-home badge names the home table, short form');
    await page.close();
  });

  test('an entity nobody mentions, mentioning nobody, adds nothing to the open column', async () => {
    const page = await open(loner.id, { side: true });
    await page.waitForTimeout(150);
    assert.deepEqual(await panelTitles(page), ['Comments (0)', 'Activity'], 'no empty reference panel');
    await page.close();
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the reference chip is the pointer-tier k k-rel chip in ${colorScheme}`, async () => {
      const page = await open(issue.id, { colorScheme, side: true });
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme, 'the page resolved the theme under test');
      await card(page, '.ref-outbound-card');
      const chip = await chipStyle(page, '.ref-outbound-card');
      assert.equal(chip.tag, 'SPAN');
      assert.deepEqual(chip.classes.slice(0, 3), ['k', 'k-rel', 'kind-entity'], 'exactly the relation chip — no bespoke reference class');
      assert.equal(chip.borderWidth, '1px', 'pointer tier: a 1px outline');
      assert.equal(chip.borderStyle, 'solid');
      assert.notEqual(chip.borderColor, 'rgba(0, 0, 0, 0)', `the outline is visible in ${colorScheme}`);
      assert.equal(chip.background, 'rgba(0, 0, 0, 0)', 'pointer tier: no fill');
      assert.notEqual(chip.color, 'rgba(0, 0, 0, 0)', `the label is visible in ${colorScheme}`);
      assert.equal(chip.href, `#/entity/${target.id}`, 'the chip is the link');
      assert.equal(chip.label, 'Ship the editor');
      assert.equal(chip.home, 'Task', 'the k-home badge names the home table');
      assert.equal(chip.mark, 'none', 'Feature #185 dropped the open mark: the chip is the link');
      assert.equal(chip.unlink, false, 'no ×: a reference is text, there is nothing to unlink');
      await page.close();
    });
  }

  test('light and dark paint the chip differently, so neither theme is the other one unthemed', async () => {
    const paint = async (colorScheme) => {
      const page = await open(issue.id, { colorScheme, side: true });
      await card(page, '.ref-outbound-card');
      const chip = await chipStyle(page, '.ref-outbound-card');
      await page.close();
      return chip;
    };
    const a = await paint('light');
    const b = await paint('dark');
    assert.notEqual(a.color, b.color, 'body colour follows the theme');
    assert.notEqual(a.borderColor, b.borderColor, 'and so does the outline');
  });
}
