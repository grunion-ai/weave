/* The reference panels on an entity page, driven through a real browser
   (Kyle, 2026-09-02). Two rulings the source-level gates in backlinks.test.mjs
   can only spell, this file proves in a DOM:

   1. Hidden with comments and activity. "References" (what this entity's
      documents mention) and "Referenced by" (who mentions it) live in the
      entity-side column the Activity button opens — off by default, remembered
      per browser once opened, exactly the comments/activity contract. The
      resting page never mentions them, and nothing is even fetched until the
      column is open. They wear the same card dress as Activity and sit below
      it, so the column reads: what people said, what happened, what this
      points at, what points here.
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
  test('reference panels (browser)', { skip: 'playwright not installed' }, () => {});
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

  /* Every page is a fresh context — fresh localStorage — so "off by default"
     is what a first visit sees. `side: true` pre-remembers the column open,
     the way a browser that opened it once remembers it. */
  const open = async (id, { colorScheme = 'light', side = false } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    page.refRequests = [];
    page.on('request', (r) => { if (/\/references(-from)?$/.test(r.url())) page.refRequests.push(r.url()); });
    if (side) {
      // Remembered the way a browser remembers it: written once, then left
      // alone — an init script would re-arm it on every reload and hide the
      // very forgetting the tests below look for.
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await page.evaluate(() => localStorage.setItem('wv-entity-side', '1'));
    }
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.entity-grid');
    return page;
  };
  const card = (page, sel) => page.waitForSelector(sel, { state: 'attached' });
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
      label: a.childNodes[0].textContent,
      home: a.querySelector('.k-home')?.textContent,
      mark: getComputedStyle(a, '::after').content,
      unlink: !!chip.querySelector('.x'),
    };
  });

  test('references are hidden with comments and activity, and not even fetched, until the Activity button opens the column', async () => {
    const page = await open(issue.id);
    await page.waitForTimeout(150); // a fetch that was going to happen has happened by now
    assert.equal(await page.$('.ref-backlinks-card'), null, 'the resting page never mentions references');
    assert.equal(await page.isVisible('.entity-side'), false, 'the side column is closed');
    assert.deepEqual(page.refRequests, [], 'nothing is fetched until the reader asks');
    await page.click('.activity-btn');
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

  test('closing the column hides the references again, and the choice is remembered per browser', async () => {
    const page = await open(issue.id, { side: true });
    await card(page, '.ref-outbound-card');
    assert.equal(await page.isVisible('.ref-outbound-card'), true, 'a browser that opened the column once sees references on load');
    await page.click('.activity-btn');
    await page.waitForSelector('.entity-grid:not(.side-open)');
    assert.equal(await page.$('.ref-backlinks-card'), null, 'closing the column takes the references with it');
    assert.equal(await page.isVisible('.entity-side'), false);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.entity-grid');
    await page.waitForTimeout(150);
    assert.equal(await page.$('.ref-backlinks-card'), null, 'and the next load remembers it closed');
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
