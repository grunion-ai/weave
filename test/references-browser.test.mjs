/* The reference cards on an entity page, driven through a real browser
   (Kyle, 2026-09-02). Two rulings the source-level gates in backlinks.test.mjs
   can only spell, this file proves in a DOM:

   1. Closed by default. Both cards — "References" (what this entity's documents
      mention) and "Referenced by" (who mentions it) — are native <details>,
      collapsed on load so a page with many mentions stays quiet, opened by a
      click on the summary, and closed again on the next load: nothing is
      remembered, because the resting page is the quiet one.
   2. The house chip. Every reference is the SAME k k-rel chip a relation field
      wears — the pointer tier of the chip system: a 1px outline, no fill, the
      ↗ mark inside the link, a k-home badge naming the home table — and no ×,
      because a reference is text and there is nothing to unlink. Both themes.

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
  test('reference cards (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, target, issue, loner;

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Dev' });
    weave.createTable({ space: 'Dev', name: 'Task' });
    weave.createTable({ space: 'Dev', name: 'Issue' });
    target = weave.createEntity('Task', { name: 'Ship the editor' });
    issue = weave.createEntity('Issue', { name: 'Editor loses focus', doc: 'blocks [[Task#1]] until fixed' });
    loner = weave.createEntity('Issue', { name: 'Nobody mentions me' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  const open = async (id, { colorScheme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.entity-grid');
    return page;
  };
  const card = (page, sel) => page.waitForSelector(sel, { state: 'attached' });
  const isOpen = (page, sel) => page.$eval(sel, (d) => d.open);
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
      label: a.childNodes[0].textContent,
      home: a.querySelector('.k-home')?.textContent,
      mark: getComputedStyle(a, '::after').content,
      unlink: !!chip.querySelector('.x'),
    };
  });

  test('the outbound card is a closed <details> on load and opens on a click', async () => {
    const page = await open(issue.id);
    await card(page, '.ref-outbound-card');
    assert.equal(await page.$eval('.ref-outbound-card', (d) => d.tagName), 'DETAILS', 'a native disclosure, no script state');
    assert.equal(await isOpen(page, '.ref-outbound-card'), false, 'closed on load');
    assert.equal(await page.$eval('.ref-outbound-card > summary', (s) => s.textContent), 'References · 1',
      'the summary IS the resting card: title and count');
    assert.equal(await page.isVisible('.ref-outbound-card .k-rel'), false, 'the chips are hidden until asked');
    await page.click('.ref-outbound-card > summary');
    assert.equal(await isOpen(page, '.ref-outbound-card'), true, 'one click opens it');
    assert.equal(await page.isVisible('.ref-outbound-card .k-rel'), true, 'and the chips show');
    // Nothing is remembered: the next load is quiet again.
    await page.reload({ waitUntil: 'load' });
    await card(page, '.ref-outbound-card');
    assert.equal(await isOpen(page, '.ref-outbound-card'), false, 'closed again on the next load');
    await page.close();
  });

  test('the inbound card mirrors it on the target', async () => {
    const page = await open(target.id);
    await card(page, '.ref-inbound-card');
    assert.equal(await page.$eval('.ref-inbound-card', (d) => d.tagName), 'DETAILS');
    assert.equal(await isOpen(page, '.ref-inbound-card'), false, 'closed on load');
    assert.equal(await page.$eval('.ref-inbound-card > summary', (s) => s.textContent), 'Referenced by · 1');
    assert.equal(await page.$('.ref-outbound-card'), null, 'a direction with nothing to say is absent');
    await page.click('.ref-inbound-card > summary');
    const chip = await chipStyle(page, '.ref-inbound-card');
    assert.equal(chip.href, `#/entity/${issue.id}`, 'the chip points back at the mentioning entity');
    assert.equal(chip.label, 'Editor loses focus');
    assert.equal(chip.home, 'Issue', 'the k-home badge names the home table, short form');
    await page.close();
  });

  test('an entity nobody mentions, mentioning nobody, shows neither card', async () => {
    const page = await open(loner.id);
    // Give the two fetches a moment to land — a card must never appear.
    await page.waitForTimeout(150);
    assert.equal(await page.$('.ref-backlinks-card'), null);
    await page.close();
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the reference chip is the pointer-tier k k-rel chip in ${colorScheme}`, async () => {
      const page = await open(issue.id, { colorScheme });
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme, 'the page resolved the theme under test');
      await card(page, '.ref-outbound-card');
      await page.click('.ref-outbound-card > summary');
      const chip = await chipStyle(page, '.ref-outbound-card');
      assert.equal(chip.tag, 'SPAN');
      assert.deepEqual(chip.classes, ['k', 'k-rel'], 'exactly the relation chip — no bespoke reference class');
      assert.equal(chip.borderWidth, '1px', 'pointer tier: a 1px outline');
      assert.equal(chip.borderStyle, 'solid');
      assert.notEqual(chip.borderColor, 'rgba(0, 0, 0, 0)', `the outline is visible in ${colorScheme}`);
      assert.equal(chip.background, 'rgba(0, 0, 0, 0)', 'pointer tier: no fill');
      assert.notEqual(chip.color, 'rgba(0, 0, 0, 0)', `the label is visible in ${colorScheme}`);
      assert.equal(chip.href, `#/entity/${target.id}`, 'the chip is the link');
      assert.equal(chip.label, 'Ship the editor');
      assert.equal(chip.home, 'Task', 'the k-home badge names the home table');
      assert.match(chip.mark, /↗/, 'the open mark rides inside the link');
      assert.equal(chip.unlink, false, 'no ×: a reference is text, there is nothing to unlink');
      await page.close();
    });
  }

  test('light and dark paint the chip differently, so neither theme is the other one unthemed', async () => {
    const light = await open(issue.id, { colorScheme: 'light' });
    await card(light, '.ref-outbound-card');
    await light.click('.ref-outbound-card > summary');
    const a = await chipStyle(light, '.ref-outbound-card');
    await light.close();
    const dark = await open(issue.id, { colorScheme: 'dark' });
    await card(dark, '.ref-outbound-card');
    await dark.click('.ref-outbound-card > summary');
    const b = await chipStyle(dark, '.ref-outbound-card');
    await dark.close();
    assert.notEqual(a.color, b.color, 'body colour follows the theme');
    assert.notEqual(a.borderColor, b.borderColor, 'and so does the outline');
  });
}
