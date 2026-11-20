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
  const slots = [...root.querySelectorAll('.crumb-row .crumb-path > .crumb-slot:not([hidden])')].filter((n) => n.getClientRects().length);
  const last = slots.at(-1).querySelector('.crumb-item');
  const cut = [last, ...last.querySelectorAll('*')].filter((n) => n.getClientRects().length && n.scrollWidth > n.clientWidth + 1).map((n) => n.className);
  return {
    text: last.innerText.replace(/\s+/g, ''),
    kind: [...last.classList].find((k) => k.startsWith('crumb-k-')),
    cut,
    folds: !!root.querySelector('.crumb-row .crumb-more'),
    trail: slots.map((n) => n.querySelector('.crumb-item').innerText.replace(/\s+/g, ' ').trim()),
    row2: root.querySelector('.head-bar .record-kind').innerText.trim(),
    header: root.querySelector('.view-header').innerText,
    heading: root.querySelector('textarea.name-edit').value,
  };
}, scope);
const once = (text, id) => text.match(new RegExp(`${id}(?!\\d)`, 'g'))?.length ?? 0;

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
    test(`a record on a phone shows its table in the crumb and its #id once, in row 2, and leaves the name to the title (${engine}, Issues #982, #1878)`, async () => {
      const page = await open(make, peek, '#dock:not([hidden]) textarea.name-edit');
      try {
        const c = await crumb(page, '#dock');
        assert.equal(c.text, 'Deal', 'the crumb is the table');
        assert.equal(c.kind, 'crumb-k-table');
        assert.equal(c.row2, '#1', 'row 2 carries the #id');
        assert.equal(once(c.header, '#1'), 1, `the header names the #id once: ${JSON.stringify(c.header)}`);
        assert.deepEqual(c.cut, [], 'nothing in the crumb is cut off');
        assert.equal(c.heading, NAME, 'the title carries the name');
      } finally { await page.close(); }
    });

    test(`the full record page on a phone ends its crumbs at the table (${engine}, Issues #982, #1878)`, async () => {
      const page = await open(make, full, '#main textarea.name-edit');
      try {
        const c = await crumb(page, '#main');
        assert.equal(c.text, 'Deal');
        assert.equal(c.row2, '#1');
        assert.equal(once(c.header, '#1'), 1, `the header names the #id once: ${JSON.stringify(c.header)}`);
        assert.deepEqual(c.cut, []);
      } finally { await page.close(); }
    });
  }

  for (const [table, hash] of [['a short table', peek], ['a long table', longPeek]]) {
    for (const width of [360, 375, 390]) {
      test(`at ${width}px the docked table crumb of ${table} stays clear of Copy permalink (Issues #765, #1878)`, async () => {
        const page = await open(() => browser.newPage({ viewport: { width, height: 844 } }), hash, '#dock:not([hidden]) textarea.name-edit');
        try {
          const m = await page.evaluate(() => {
            const row = document.querySelector('#dock .crumb-row');
            const box = (n) => n.getBoundingClientRect();
            const chip = row.querySelector('.crumb-path > .crumb-slot:last-child > .crumb-k-table');
            return { chip: box(chip).right, path: box(row.querySelector('.crumb-path')).right, copy: box(row.querySelector('.crumb-copy')).left, copyRight: box(row.querySelector('.crumb-copy')).right };
          });
          assert.ok(m.chip <= m.copy + 0.5, `the table chip stops before Copy permalink: ${JSON.stringify(m)}`);
          assert.ok(m.copyRight <= m.path + 0.5, `Copy permalink stays inside the path: ${JSON.stringify(m)}`);
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop the docked record crumb is its table, with the #id in row 2 (Issues #982, #1862, #1878)', async () => {
    const page = await open(() => browser.newPage({ viewport: { width: 1440, height: 900 } }), peek, '#dock:not([hidden]) textarea.name-edit');
    try {
      const c = await crumb(page, '#dock');
      assert.equal(c.text, 'Deal');
      assert.equal(c.row2, '#1');
    } finally { await page.close(); }
  });
}
