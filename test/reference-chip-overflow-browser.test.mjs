import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = 'Error: command click on an entity link should always open the entity in a new tab, never the same one, whatever the surface';
let issue, target, short;

const s = await launch('reference chip overflow', (weave) => {
  weave.createSpace({ name: 'Dev' });
  weave.createTable({ space: 'Dev', name: 'Task' });
  const issues = weave.createTable({ space: 'Dev', name: 'Issue' });
  target = weave.createEntity('Task', { name: LONG });
  short = weave.createEntity('Task', { name: 'Short one' });
  issue = weave.createEntity('Issue', { name: 'Overflowing chip', doc: 'see [[Task#1]] and [[Task#2]]' });
  weave.updateTable(issues.id, { systemFields: ['Activity'] });
});

if (s) {
  const { base, browser } = s;
  const open = async (colorScheme) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme });
    await page.goto(`${base}/#/entity/${issue.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.ref-outbound-card .k.k-rel');
    return page;
  };
  const measure = (page) => page.$eval('.ref-outbound-card', (card) => {
    const body = card.querySelector('.card-body');
    const cs = getComputedStyle(body);
    const inner = body.getBoundingClientRect().right - parseFloat(cs.paddingRight);
    const chips = [...card.querySelectorAll('.k.k-rel')].map((k) => {
      const a = k.querySelector('a');
      const label = a.querySelector('.k-label');
      const mark = getComputedStyle(a, '::after');
      return {
        right: k.getBoundingClientRect().right,
        text: a.textContent,
        title: a.getAttribute('title'),
        labelOverflow: label ? getComputedStyle(label).textOverflow : null,
        labelClipped: label ? label.scrollWidth > label.clientWidth + 1 : null,
        home: k.querySelector('.k-home')?.getBoundingClientRect() ?? null,
        mark: mark.content,
      };
    });
    return {
      inner,
      chips,
      sideScroll: (() => { const side = card.closest('.entity-side'); return side.scrollWidth - side.clientWidth; })(),
    };
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`a long reference chip truncates inside the card, keeping its badge (${colorScheme})`, async () => {
      const page = await open(colorScheme);
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme, 'the page resolved the theme under test');
      const m = await measure(page);
      assert.equal(m.chips.length, 2, 'both references are drawn');
      for (const c of m.chips) {
        assert.ok(c.right <= m.inner + 0.5, `chip right edge ${c.right} stays inside the card content box ${m.inner}: ${c.text.slice(0, 30)}…`);
        assert.ok(c.home && c.home.right <= m.inner + 0.5 && c.home.width > 0, 'the home badge is visible at the right end');
      }
      const long = m.chips.find((c) => c.title === LONG);
      assert.ok(long, 'the full name rides in the title');
      assert.equal(long.labelOverflow, 'ellipsis', 'the label truncates with an ellipsis');
      assert.equal(long.labelClipped, true, 'and it is in fact clipped at 1280px');
      assert.equal(m.sideScroll, 0, 'no horizontal overflow in the side column');
      await page.close();
    });
  }
}
