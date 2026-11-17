import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

const para = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1} with enough words to read as prose.`).join('\n\n');

let deals, contacts, acme, jane;
const s = await launch('header toolbar size', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  contacts = weave.createTable({ space: 'Sales', name: 'Contacts' });
  weave.addField(deals, { name: 'Stage', type: 'select', config: { options: ['Lead', 'Won'] } });
  weave.addRelation(deals, { name: 'Contact', targetDb: contacts.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  jane = weave.createEntity(contacts, { name: 'Jane Rivera' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital', values: { Stage: 'Lead' }, Contact: jane.id });
  weave.createEntity(deals, { name: 'Northwind rollout', values: { Stage: 'Won' } });
  weave.setDoc(acme.id, para(6));
  weave.tableView(`${deals.id}/Standard`, { filters: { Stage: ['Lead', 'Won'] } });
});

const NAMES = ['table-search', 'table-view-btn', 'activity-btn', 'eye-btn', 'table-share-btn', 'dots-btn', 'pose-btn', 'dock-close'];

const bar = (page, scope) => page.evaluate(([scope, names]) => {
  const half = (v) => Math.round(v * 2) / 2;
  const row = document.querySelector(`${scope} .view-header .crumb-row`);
  const header = row.closest('.view-header').getBoundingClientRect();
  const seen = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && n.getBoundingClientRect().width > 1.5;
  const tools = [...row.querySelectorAll(':scope > .crumb-actions > *, :scope > .dl-wrap')]
    .map((n) => (n.classList.contains('dl-wrap') ? n.querySelector('button') : n)).filter(seen);
  const items = tools.map((n) => {
    const r = n.getBoundingClientRect();
    const glyph = (n.classList.contains('table-search') ? n.querySelector('.table-search-btn') : n).querySelector('svg')?.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(14, r.width / 2), r.top + r.height / 2);
    return {
      name: names.find((c) => n.classList.contains(c)) ?? (/^Close/.test(n.getAttribute('aria-label') ?? '') ? 'close' : n.className),
      w: half(r.width), h: half(r.height), left: half(r.left), right: half(r.right), top: half(r.top),
      icon: glyph ? [half(glyph.width), half(glyph.height)] : null,
      inside: r.left >= header.left - 0.5 && r.right <= header.right + 0.5,
      reachable: !!hit && (hit === n || n.contains(hit)),
    };
  }).sort((a, b) => a.left - b.left);
  const rowBox = row.getBoundingClientRect();
  const copy = row.querySelector('.crumb-copy');
  const copyBox = seen(copy) ? copy.getBoundingClientRect() : null;
  const copyIcon = copyBox ? copy.querySelector('svg').getBoundingClientRect() : null;
  const title = document.querySelector(`${scope} :is(.view-title, .name-edit)`);
  return {
    tight: row.classList.contains('crumb-row-tight'),
    row: { h: half(rowBox.height), right: half(rowBox.right), padRight: parseFloat(getComputedStyle(row).paddingRight) },
    order: items.map((i) => i.name),
    items: Object.fromEntries(items.map((i) => [i.name, i])),
    gaps: items.slice(1).map((it, i) => half(it.left - items[i].right)),
    fromRight: Object.fromEntries(items.map((i) => [i.name, half(rowBox.right - i.right)])),
    copy: copyBox ? { w: half(copyBox.width), h: half(copyBox.height), icon: half(copyIcon.width), inside: copyBox.left >= header.left - 0.5 && copyBox.right <= header.right + 0.5 } : null,
    folded: !!row.querySelector('.crumb-more'),
    crumbsShown: [...row.querySelectorAll('.crumb-path > .crumb-slot')].filter(seen).length,
    titleTop: title ? half(title.getBoundingClientRect().top) : null,
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, [scope, NAMES]);

const paintOf = async (locator) => {
  await settled(locator);
  return locator.evaluate(readPaint);
};
const readPaint = (n) => {
  const cs = getComputedStyle(n);
  const clear = (c) => c === 'transparent' || /,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
  return {
    border: parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && !clear(cs.borderTopColor) ? cs.borderTopColor : 'none',
    fill: clear(cs.backgroundColor) ? 'none' : cs.backgroundColor,
    shadow: cs.boxShadow,
    color: cs.color,
  };
};
const tokenPaint = (page, declarations) => page.evaluate((declarations) => {
  const probe = document.createElement('span');
  probe.style.cssText = declarations;
  document.querySelector('#main').append(probe);
  const cs = getComputedStyle(probe);
  const out = { fill: cs.backgroundColor, border: cs.borderTopColor, color: cs.color };
  probe.remove();
  return out;
}, declarations);

const menuLabels = async (page, scope) => {
  await page.click(`${scope} .view-header .crumb-row .dots-btn`);
  await page.waitForSelector('.chip-pop.wv-menu[role="menu"] [role^="menuitem"]');
  const labels = await page.locator('.chip-pop.wv-menu .wv-menu-label, .chip-pop.wv-menu .hold-label').allTextContents();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.chip-pop.wv-menu', { state: 'detached' });
  return labels.map((l) => l.trim());
};

if (s) {
  const { base, browser } = s;
  const frames = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const open = async (hash, ready, { width = 1440, height = 900, theme = 'light', dock = 0 } = {}) => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript(([t, w]) => { localStorage.setItem('weave-theme', t); if (w) localStorage.setItem('wv-dock-width', String(w)); }, [theme, dock]);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    await settled(page.locator(`${ready.split(' ')[0]} .view-header .crumb-row`));
    await frames(page);
    return page;
  };
  const table = (opts) => open(`#/table/${deals.id}`, '#main .wv-grid tbody tr.entity-row', opts);
  const split = (opts) => open(`#/table/${deals.id}?e=${acme.id}`, '#dock:not([hidden]) .name-edit', opts);
  const record = (id, opts) => open(`#/entity/${id}`, '#main .name-edit', opts);
  const box28 = (m, names, where) => {
    for (const name of names) {
      const it = m.items[name];
      assert.ok(it, `${where}: ${name} shows in the bar (${m.order})`);
      assert.deepEqual([it.w, it.h], [28, 28], `${where}: ${name} is a 28 px box`);
      assert.deepEqual(it.icon, [16, 16], `${where}: ${name} draws a 16 px icon`);
    }
  };

  test('the table bar at 1440 px is one 28 px row of tools with 4 px gaps, the menu last', async () => {
    const page = await table();
    try {
      const m = await bar(page, '#main');
      assert.equal(m.tight, false);
      assert.deepEqual(m.order, ['table-search', 'table-view-btn', 'table-share-btn', 'dots-btn']);
      assert.equal(m.row.h, 28, 'the breadcrumb row is 28 px tall');
      assert.equal(m.row.padRight, 0, 'the row reserves no padding for the menu');
      box28(m, ['table-share-btn', 'dots-btn'], 'table');
      assert.equal(m.items['table-search'].h, 28, 'the search bar is 28 px tall');
      assert.ok(Math.abs(m.items['table-search'].w - 160) <= 4, `the search bar is about 160 px wide: ${m.items['table-search'].w}`);
      assert.deepEqual(m.items['table-search'].icon, [16, 16]);
      const searchBtn = await page.locator('#main .table-search-btn').boundingBox();
      assert.deepEqual([searchBtn.width, searchBtn.height], [28, 28], 'the search icon button is a 28 px box');
      assert.equal(m.items['table-view-btn'].h, 28, 'View is 28 px tall');
      assert.deepEqual(m.items['table-view-btn'].icon, [16, 16]);
      assert.ok(m.items['table-view-btn'].w > 28, 'View grows sideways for its count');
      assert.equal(await page.locator('#main .table-view-btn .view-count').isVisible(), true, 'View keeps its count badge');
      assert.deepEqual(m.gaps, [4, 4, 4]);
      assert.equal(m.fromRight['dots-btn'], 0, 'the menu ends the row');
      assert.deepEqual([m.copy.w, m.copy.h, m.copy.icon], [24, 24, 16], 'the permalink is a 24 px box with a 16 px icon');
    } finally { await page.close(); }
  });

  test('a tight table bar folds search to an icon at its left end and keeps View, Share and the menu in place', async () => {
    const wide = await table();
    const page = await split();
    try {
      const rest = await bar(wide, '#main');
      const m = await bar(page, '#main');
      assert.equal(m.tight, true, 'a docked record makes the table row tight');
      assert.deepEqual(m.order, ['table-search', 'table-view-btn', 'table-share-btn', 'dots-btn']);
      assert.deepEqual([m.items['table-search'].w, m.items['table-search'].h], [28, 28], 'search folds to a 28 px icon button');
      assert.deepEqual(m.items['table-search'].icon, [16, 16]);
      assert.ok(m.items['table-search'].reachable, 'the folded icon answers a click');
      assert.deepEqual(m.gaps, [4, 4, 4]);
      for (const name of ['table-view-btn', 'table-share-btn', 'dots-btn']) {
        assert.equal(m.fromRight[name], rest.fromRight[name], `${name} keeps its place from the right end`);
      }
      const labels = await menuLabels(page, '#main');
      assert.ok(!labels.some((l) => /^Search/.test(l)), `the menu repeats no visible search: ${labels}`);
      assert.ok(!labels.some((l) => /^Share \(/.test(l)), `the menu repeats no visible Share: ${labels}`);
    } finally { await page.close(); await wide.close(); }
  });

  test('the folded search icon opens the bar and focuses it, folds when empty and blurred, and stays open on a query', async () => {
    const page = await split();
    try {
      const folded = await bar(page, '#main');
      await page.click('#main .table-search-btn');
      await frames(page);
      let m = await bar(page, '#main');
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('table-search-input')), true, 'the icon focuses the input');
      assert.ok(Math.abs(m.items['table-search'].w - 160) <= 4, `the bar opens: ${m.items['table-search'].w}`);
      assert.equal(m.items['table-search'].h, 28);
      for (const name of ['table-view-btn', 'table-share-btn', 'dots-btn']) {
        assert.equal(m.items[name].left, folded.items[name].left, `${name} holds still while the bar opens`);
      }
      assert.equal(m.items['table-search'].right, folded.items['table-search'].right, 'the bar grows leftwards');
      await page.locator('#main .table-search-input').blur();
      await frames(page);
      m = await bar(page, '#main');
      assert.equal(m.items['table-search'].w, 28, 'an empty, blurred bar folds again');
      await page.click('#main .table-search-btn');
      await page.locator('#main .table-search-input').fill('acme');
      await page.waitForFunction(() => document.querySelectorAll('#main .wv-grid tbody tr.entity-row').length === 1);
      await page.locator('#main .table-search-input').blur().catch(() => {});
      await page.locator('#main .name-edit, #dock .name-edit').first().focus();
      await frames(page);
      m = await bar(page, '#main');
      assert.ok(m.items['table-search'].w > 100, `a query keeps the bar open: ${m.items['table-search'].w}`);
      assert.equal(await page.locator('#main .table-search-input').inputValue(), 'acme');
    } finally { await page.close(); }
  });

  test('the record page bar at 1440 px is 28 px boxes with 4 px gaps and a 12 px break before the window group', async () => {
    const page = await record(acme.id);
    try {
      const m = await bar(page, '#main');
      assert.deepEqual(m.order, ['activity-btn', 'eye-btn', 'table-share-btn', 'dots-btn', 'pose-btn', 'close']);
      box28(m, m.order, 'record page');
      assert.deepEqual(m.gaps, [4, 4, 4, 12, 4]);
      assert.equal(m.row.h, 28);
      assert.equal(m.fromRight.close, 0, 'Close ends the row');
      assert.deepEqual([m.copy.w, m.copy.h, m.copy.icon], [24, 24, 16]);
    } finally { await page.close(); }
  });

  test('the dock bar is 28 px boxes with 4 px gaps and a 12 px break before Expand and Close', async () => {
    const page = await split();
    try {
      const m = await bar(page, '#dock');
      assert.equal(m.tight, false, 'a 1440 px split leaves the dock row room');
      assert.deepEqual(m.order, ['activity-btn', 'eye-btn', 'table-share-btn', 'dots-btn', 'pose-btn', 'dock-close']);
      box28(m, m.order, 'dock');
      assert.deepEqual(m.gaps, [4, 4, 4, 12, 4]);
      assert.equal(m.row.h, 28);
      assert.deepEqual([m.copy.w, m.copy.h, m.copy.icon], [24, 24, 16]);
    } finally { await page.close(); }
  });

  test('a table title and a record title start at the same height', async () => {
    const onTable = await table();
    const onRecord = await record(acme.id);
    try {
      const t = await bar(onTable, '#main');
      const r = await bar(onRecord, '#main');
      assert.equal(t.row.h, r.row.h, 'both breadcrumb rows share one height');
      assert.equal(t.titleTop, r.titleTop, `table title ${t.titleTop} vs record title ${r.titleTop}`);
    } finally { await onTable.close(); await onRecord.close(); }
  });

  test('a 400 px dock clips no bar button and no permalink, and only the breadcrumb folds', async () => {
    const page = await split({ width: 1100, dock: 400 });
    try {
      assert.equal(await page.locator('#dock').evaluate((n) => Math.round(n.getBoundingClientRect().width)), 400);
      const m = await bar(page, '#dock');
      for (const name of ['eye-btn', 'table-share-btn', 'dots-btn', 'pose-btn', 'dock-close']) {
        assert.ok(m.items[name], `${name} stays in a 400 px dock bar: ${m.order}`);
      }
      box28(m, m.order, '400 px dock');
      for (const it of Object.values(m.items)) {
        assert.ok(it.inside, `${it.name} sits fully inside the dock header: ${JSON.stringify(it)}`);
        assert.ok(it.reachable, `${it.name} answers a click, nothing covers it`);
      }
      assert.ok(m.copy?.inside, `the permalink sits fully inside the dock header: ${JSON.stringify(m.copy)}`);
      assert.deepEqual([m.copy.w, m.copy.h], [24, 24]);
      assert.ok(m.crumbsShown >= 1, 'the current crumb still shows');
      assert.equal(m.scroll, 0, 'the page does not scroll sideways');
      const labels = await menuLabels(page, '#dock');
      assert.equal(labels.includes('Activity'), !m.items['activity-btn'], `the menu offers Activity only when the bar does not: ${labels}`);
      assert.ok(!labels.some((l) => /^Share \(|^Expand/.test(l)), `the menu repeats no visible button: ${labels}`);
    } finally { await page.close(); }
  });

  test('a tight 400 px dock sheds Activity into the menu and keeps the current crumb, the permalink and every other button whole', async () => {
    const page = await split({ width: 1100, dock: 400 });
    try {
      await page.click(`#dock a[href="#/entity/${jane.id}"]`);
      await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Jane Rivera');
      await settled(page.locator('#dock .view-header .crumb-row'));
      await frames(page);
      const m = await bar(page, '#dock');
      assert.equal(m.tight, true, 'a trail of two in a 400 px dock is tight');
      assert.deepEqual(m.order, ['eye-btn', 'table-share-btn', 'dots-btn', 'pose-btn', 'dock-close']);
      box28(m, m.order, 'tight dock');
      assert.deepEqual(m.gaps, [4, 4, 12, 4]);
      assert.equal(m.items['dock-close'].right - m.items['eye-btn'].left, 164, 'the tight bar measures 164 px');
      for (const it of Object.values(m.items)) assert.ok(it.inside && it.reachable, `${it.name} is whole and answers a click: ${JSON.stringify(it)}`);
      assert.ok(m.copy?.inside, `the permalink sits fully inside the dock header: ${JSON.stringify(m.copy)}`);
      assert.equal(await page.locator('#dock .crumb-row .crumb-cur').isVisible(), true, 'the current crumb still shows');
      assert.equal(await page.locator('#dock .crumb-row .dock-back').isVisible(), true, 'Back stays in the row');
      assert.equal(m.scroll, 0);
      const labels = await menuLabels(page, '#dock');
      assert.ok(labels.includes('Activity'), `the menu offers the shed Activity: ${labels}`);
      assert.ok(!labels.some((l) => /^Share \(|^Expand/.test(l)), `the menu repeats no visible button: ${labels}`);
    } finally { await page.close(); }
  });

  test('pane close buttons are 28 px boxes', async () => {
    const page = await table();
    try {
      await page.click('#main .table-view-btn');
      await page.waitForSelector('#view-pane .vp-close');
      const view = await page.locator('#view-pane .vp-close').boundingBox();
      assert.deepEqual([view.width, view.height], [28, 28], 'the View pane close button');
      await page.click('#main .table-share-btn');
      await page.waitForSelector('#share-pane .share-head button');
      const share = await page.locator('#share-pane .share-head button').boundingBox();
      assert.deepEqual([share.width, share.height], [28, 28], 'the Share pane close button');
    } finally { await page.close(); }
  });

  test('record body tools are 24 px boxes: the related eye, the document link and the document menu', async () => {
    const withDoc = await record(acme.id);
    const withRelated = await record(jane.id);
    try {
      await withRelated.waitForSelector('#main .related-head .eye-btn');
      const eye = await withRelated.locator('#main .related-head .eye-btn').first().boundingBox();
      assert.deepEqual([eye.width, eye.height], [24, 24], 'the related section eye');
      await withDoc.waitForSelector('#main .doc-section .doc-anchor.permalink-copy');
      const link = withDoc.locator('#main .doc-section .doc-anchor.permalink-copy').first();
      const anchor = await link.boundingBox();
      assert.deepEqual([anchor.width, anchor.height], [24, 24], 'the document copy-link button');
      const glyph = await link.locator('svg').boundingBox();
      assert.deepEqual([glyph.width, glyph.height], [16, 16], 'its icon');
      const dots = withDoc.locator('#main .doc-section .doc-dl > .dots-btn').first();
      const menu = await dots.boundingBox();
      assert.deepEqual([menu.width, menu.height], [24, 24], 'the document menu button');
      await withDoc.mouse.move(2, 2);
      assert.equal(await dots.evaluate((n) => getComputedStyle(n).opacity), '0', 'the document menu stays hidden until the section is hovered');
      await withDoc.locator('#main .doc-section .doc-section-head').first().hover();
      await withDoc.waitForFunction(() => Number(getComputedStyle(document.querySelector('#main .doc-section .doc-dl > .dots-btn')).opacity) > 0.6);
    } finally { await withDoc.close(); await withRelated.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: bar buttons rest with no outline and no fill, wash on hover, and light up while their pane or panel is open`, async () => {
      const page = await record(acme.id, { theme });
      const onTable = await table({ theme });
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        await page.mouse.move(2, 2);
        for (const sel of ['.activity-btn', '.eye-btn', '.table-share-btn', '.dots-btn', '.pose-btn', 'button[aria-label^="Close"]']) {
          const p = await paintOf(page.locator(`#main .view-header .crumb-actions ${sel}`));
          assert.deepEqual([p.border, p.fill, p.shadow], ['none', 'none', 'none'], `${sel} rests as a ghost`);
        }
        for (const sel of ['.table-search-btn', '.table-view-btn', '.table-share-btn', '.dots-btn']) {
          const p = await paintOf(onTable.locator(`#main .view-header .crumb-row ${sel}`));
          assert.deepEqual([p.border, p.fill, p.shadow], ['none', 'none', 'none'], `the table's ${sel} rests as a ghost`);
        }
        const wash = await tokenPaint(page, 'background: var(--wv-hover-wash)');
        await page.hover('#main .view-header .crumb-actions .eye-btn');
        assert.equal((await paintOf(page.locator('#main .view-header .crumb-actions .eye-btn'))).fill, wash.fill, 'hover paints the ghost wash');
        await page.mouse.move(2, 2);
        const lit = await tokenPaint(page, 'background: var(--tblr-primary-lt); border: 1px solid var(--tblr-primary); color: var(--tblr-primary)');
        await page.click('#main .view-header .crumb-actions .table-share-btn');
        await page.waitForSelector('#share-pane:not([hidden])');
        await page.mouse.move(2, 2);
        const share = await paintOf(page.locator('#main .view-header .crumb-actions .table-share-btn'));
        assert.deepEqual([share.fill, share.border, share.color], [lit.fill, lit.border, lit.color], 'Share lights up while its pane is open');
        await page.click('#main .view-header .crumb-actions .table-share-btn');
        await page.click('#main .view-header .crumb-actions .activity-btn');
        await page.waitForSelector('#main .activity-btn[aria-pressed="true"]');
        await page.mouse.move(2, 2);
        const activity = await paintOf(page.locator('#main .view-header .crumb-actions .activity-btn'));
        assert.deepEqual([activity.fill, activity.border, activity.color], [lit.fill, lit.border, lit.color], 'Activity lights up while its panel is open');
        await onTable.click('#main .table-view-btn');
        await onTable.waitForSelector('#view-pane .vp-close');
        await onTable.mouse.move(2, 2);
        const view = await paintOf(onTable.locator('#main .table-view-btn'));
        assert.deepEqual([view.fill, view.border, view.color], [lit.fill, lit.border, lit.color], 'View lights up while its pane is open');
      } finally { await page.close(); await onTable.close(); }
    });
  }
}
