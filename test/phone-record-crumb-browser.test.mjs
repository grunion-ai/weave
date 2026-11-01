import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const NAME = 'Acme renewal for the three year enterprise plan';
const s = await launch('phone record crumb', (weave) => {
  weave.createSpace({ name: 'Sales' });
  const deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  const row = weave.createEntity(deals, { name: NAME });
  const apps = weave.createTable({ space: 'Sales', name: 'Underwriting Applications' });
  const app = weave.createEntity(apps, { name: NAME });
  return { peek: `#/table/${deals.id}?e=${row.id}`, page: `#/entity/${row.id}`, longPeek: `#/table/${apps.id}?e=${app.id}` };
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
  const { base, browser, peek, page: full, longPeek } = s;
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

  for (const [table, hash] of [['a short table', peek], ['a long table', longPeek]]) {
    for (const width of [360, 375, 390]) {
      test(`at ${width}px the docked crumb of ${table} keeps its number whole and clear of Copy permalink (Issue #765)`, async () => {
        const page = await open(() => browser.newPage({ viewport: { width, height: 844 } }), hash, '#dock:not([hidden]) textarea.name-edit');
        try {
          const m = await page.evaluate(() => {
            const row = document.querySelector('#dock .crumb-row');
            const box = (sel) => row.querySelector(sel).getBoundingClientRect();
            const pid = row.querySelector('.crumb-cur .crumb-pid');
            return { chip: box('.crumb-cur').right, pid: box('.crumb-cur .crumb-pid').right, copy: box('.crumb-copy').left, pidCut: pid.scrollWidth > pid.clientWidth + 1 };
          });
          assert.equal(m.pidCut, false, 'the number is whole');
          assert.ok(m.pid <= m.chip + 0.5, `the number stays inside its chip: ${JSON.stringify(m)}`);
          assert.ok(m.chip <= m.copy + 0.5, `the chip stops before Copy permalink: ${JSON.stringify(m)}`);
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop the record crumb keeps its name (Issue #982)', async () => {
    const page = await open(() => browser.newPage({ viewport: { width: 1440, height: 900 } }), peek, '#dock:not([hidden]) textarea.name-edit');
    try {
      const c = await crumb(page, '#dock');
      assert.match(c.text, /^#1Acmerenewal/);
    } finally { await page.close(); }
  });
}
