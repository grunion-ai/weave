import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const NAME = 'Acme renewal for the three year enterprise plan';
const s = await launch('phone record crumb', (weave) => {
  weave.createSpace({ name: 'Sales' });
  const deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  const row = weave.createEntity(deals, { name: NAME });
  return { peek: `#/table/${deals.id}?e=${row.id}`, page: `#/entity/${row.id}` };
});

const crumb = (page, scope) => page.evaluate((sc) => {
  const root = document.querySelector(sc);
  const cur = root.querySelector('.crumb-row .crumb-cur');
  const cut = [cur, ...cur.querySelectorAll('*')].filter((n) => n.getClientRects().length && n.scrollWidth > n.clientWidth + 1).map((n) => n.className);
  return {
    text: cur.innerText.replace(/\s+/g, ''),
    title: cur.getAttribute('title'),
    cut,
    trail: [...root.querySelectorAll('.crumb-row .crumb-slot:not([hidden]) .crumb-item')].filter((n) => n.getClientRects().length).map((n) => n.innerText.replace(/\s+/g, ' ').trim()),
    heading: root.querySelector('textarea.name-edit').value,
  };
}, scope);

if (s) {
  const { base, browser, peek, page: full } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', () => browser.newPage({ viewport: { width: 390, height: 844 } })]];
  if (phone) engines.push(['webkit iPhone 15', () => phonePage(phone)]);
  const open = async (make, hash, ready) => {
    const page = await make();
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    return page;
  };

  for (const [engine, make] of engines) {
    test(`a record on a phone shows its table and number in the crumb and leaves the name to the title (${engine}, Issue #982)`, async () => {
      const page = await open(make, peek, '#dock:not([hidden]) textarea.name-edit');
      try {
        const c = await crumb(page, '#dock');
        assert.equal(c.text, 'Deal#1', 'the crumb carries the table and the number');
        assert.deepEqual(c.cut, [], 'nothing in the crumb is cut off');
        assert.equal(c.heading, NAME, 'the title carries the name');
        assert.match(c.title, /Acme renewal/, 'the crumb still names the record for a hover or a screen reader');
      } finally { await page.close(); }
    });

    test(`the full record page on a phone shows only the number after its table crumb (${engine}, Issue #982)`, async () => {
      const page = await open(make, full, '#main textarea.name-edit');
      try {
        const c = await crumb(page, '#main');
        assert.equal(c.text, '#1');
        assert.equal(c.trail.at(-2), 'Deal', `the table crumb comes first (${c.trail.join(' › ')})`);
        assert.deepEqual(c.cut, []);
      } finally { await page.close(); }
    });
  }

  test('on a desktop the record crumb keeps its name (Issue #982)', async () => {
    const page = await open(() => browser.newPage({ viewport: { width: 1440, height: 900 } }), peek, '#dock:not([hidden]) textarea.name-edit');
    try {
      const c = await crumb(page, '#dock');
      assert.match(c.text, /^#1Acmerenewal/);
    } finally { await page.close(); }
  });
}
