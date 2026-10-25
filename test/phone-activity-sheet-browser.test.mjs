import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone activity sheet', (weave) => {
  weave.revisionWindowMs = 0;
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  const row = weave.createEntity(issues, { name: 'Looks broken', doc: 'The sheet hides the diff.', values: { Severity: 'Low' } });
  weave.setDoc(row.id, 'The sheet hides the diff behind the record.', 'Description');
  weave.updateEntity(row.id, { Severity: 'High' });
  return { hash: `#/table/${issues.id}?e=${row.id}` };
});

const sheet = (page) => page.evaluate(() => {
  const p = document.querySelector('aside.wv-activity');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const list = p.querySelector('.wv-act-list').getBoundingClientRect();
  const close = p.querySelector('.wv-act-close').getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    theme: document.documentElement.dataset.bsTheme, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
    vw: document.documentElement.clientWidth, vh: innerHeight, list: list.width, close: [close.width, close.height],
    onTop: !!hit?.closest('aside.wv-activity'), rows: p.querySelectorAll('.wv-act-row').length,
    filters: [...p.querySelectorAll('.wv-act-filters button:not([hidden])')].map((b) => Math.round(b.getBoundingClientRect().height)),
  };
});

if (s) {
  const { base, browser, hash } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', () => browser.newPage({ viewport: { width: 390, height: 844 } })]];
  if (phone) engines.push(['webkit iPhone 15', () => phonePage(phone)]);
  const open = async (make, theme = 'light') => {
    const page = await make();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
    await page.click('#dock .activity-btn');
    await page.waitForSelector('aside.wv-activity .wv-act-list');
    return page;
  };

  const shown = (page, sel) => page.evaluate((q) => {
    const n = document.querySelector(q);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + Math.min(r.height / 2, 12));
    return { top: r.top, bottom: r.bottom, height: r.height, onTop: !!hit && (hit === n || n.contains(hit)), inSheet: !!n.closest('aside.wv-activity'), text: n.textContent };
  }, sel);
  const chipLook = (page) => page.evaluate(() => {
    const p = document.querySelector('aside.wv-activity');
    const bg = (n) => getComputedStyle(n).backgroundColor;
    const clear = (c) => c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);
    return {
      sheet: bg(p),
      rest: [...p.querySelectorAll('.wv-act-filters button[data-filter][aria-pressed="false"]:not([hidden])')].map((b) => ({ bg: bg(b), clear: clear(bg(b)), h: Math.round(b.getBoundingClientRect().height) })),
      on: bg(p.querySelector('.wv-act-filters button[aria-pressed="true"]')),
    };
  });

  for (const [engine, make] of engines) {
    test(`on a phone selecting a revision draws its diff inside the sheet under the row, with Restore beside it (${engine}, Issue #978)`, async () => {
      const page = await open(make);
      try {
        await page.click('aside.wv-activity .wv-act-filters button[data-filter="doc:Description"]');
        const rows = page.locator('aside.wv-activity .wv-act-row');
        assert.equal(await rows.count(), 2, 'two Description revisions');
        await rows.nth(1).locator('.wv-act-what').click();
        await page.waitForSelector('aside.wv-activity .wv-act-row.sel .wv-act-view .wv-act-diff');
        const view = await shown(page, 'aside.wv-activity .wv-act-row.sel .wv-act-view');
        assert.ok(view.inSheet, 'the diff sits in the sheet');
        assert.ok(view.onTop, `the diff is the topmost thing where it is drawn (${JSON.stringify(view)})`);
        assert.ok(view.top >= 0 && view.top < await page.evaluate(() => innerHeight), `the diff starts on screen (${view.top})`);
        assert.match(view.text, /hides the diff/, 'the diff shows the document text');
        assert.equal(await page.locator('#dock .wv-act-view').count(), 0, 'nothing is drawn in the record body under the sheet');
        assert.equal(await page.locator('#dock .doc-section-body[hidden]').count(), 0, 'the record keeps its editor');
        const restore = await shown(page, 'aside.wv-activity .wv-act-row.sel .wv-act-tray .btn-primary');
        assert.match(restore.text, /Restore/);
        assert.ok(restore.onTop && restore.bottom <= view.top + 1, `Restore sits on screen just above the diff (${JSON.stringify(restore)})`);
        await page.click('aside.wv-activity .wv-act-filters button[data-filter="fields"]');
        await page.locator('aside.wv-activity .wv-act-row').first().locator('.wv-act-what').click();
        await page.waitForSelector('aside.wv-activity .wv-act-row.sel .wv-act-view .wv-act-card');
        const card = await shown(page, 'aside.wv-activity .wv-act-row.sel .wv-act-card');
        assert.ok(card.inSheet && card.onTop, `the field change card shows in the sheet (${JSON.stringify(card)})`);
        assert.match(card.text, /Severity.*Low.*High/);
        assert.equal(await page.locator('#dock .wv-act-view').count(), 0, 'and not in the record body');
      } finally { await page.close(); }
    });

    test(`the phone Activity sheet names its record as the first crumb, and the crumb goes back (${engine}, Issue #979)`, async () => {
      const page = await open(make);
      try {
        const head = (await page.locator('aside.wv-activity .wv-act-head h3 > *').allInnerTexts()).join(' ');
        assert.equal(head, 'Looks broken › Activity');
        const crumb = page.locator('aside.wv-activity .wv-act-head button.wv-act-subject');
        const box = await crumb.boundingBox();
        assert.ok(box.height >= 44, `the crumb is a 44px target (${box.height})`);
        await crumb.click();
        assert.equal(await eventually(() => page.locator('aside.wv-activity').count(), 0), 0, 'the crumb closes the sheet');
        assert.equal(await page.locator('#dock:not([hidden]) textarea.name-edit').count(), 1, 'back on the record');
        assert.ok(await page.evaluate(() => history.state?.wvSheet !== 'activity'), 'and takes back the history step');
      } finally { await page.close(); }
    });

    for (const theme of ['light', 'dark']) {
      test(`on a phone every Activity filter carries the soft chip at rest, 44px tall (${engine}, ${theme}, Issue #980)`, async () => {
        const page = await open(make, theme);
        try {
          const c = await chipLook(page);
          assert.ok(c.rest.length >= 2, `unselected filters show (${c.rest.length})`);
          for (const b of c.rest) {
            assert.ok(!b.clear && b.bg !== c.sheet, `an unselected filter has a chip background (${b.bg} on ${c.sheet})`);
            assert.notEqual(b.bg, c.on, 'and reads apart from the selected one');
            assert.ok(b.h >= 44, `a 44px target (${b.h})`);
          }
        } finally { await page.close(); }
      });
    }

    for (const theme of ['light', 'dark']) {
      test(`on a phone a row's Activity opens as a full-screen sheet with 44px controls, and Back closes it (${engine}, ${theme}, Issue #733)`, async () => {
        const page = await open(make, theme);
        try {
          const p = await sheet(page);
          assert.equal(p.theme, theme);
          assert.deepEqual([p.left, p.top, Math.round(p.right), Math.round(p.bottom)], [0, 0, p.vw, p.vh], 'the sheet covers the screen');
          assert.ok(p.onTop, 'above the row');
          assert.ok(p.list >= 300, `its list is ${p.list}px wide`);
          assert.deepEqual(p.close.map(Math.round), [44, 44], 'Close is a 44px target');
          assert.ok(p.filters.every((h) => h >= 44), `filters are 44px targets: ${p.filters}`);
          assert.ok(p.rows >= 1, 'the history shows');
          await page.goBack();
          assert.equal(await eventually(() => page.locator('aside.wv-activity').count(), 0), 0, 'Back closes the sheet');
          assert.equal(await page.locator('#dock:not([hidden]) textarea.name-edit').count(), 1, 'and leaves the row open');
          await page.click('#dock .activity-btn');
          await page.waitForSelector('aside.wv-activity');
          const before = await page.evaluate(() => history.length);
          await page.click('aside.wv-activity .wv-act-close');
          assert.equal(await eventually(() => page.locator('aside.wv-activity').count(), 0), 0, 'Close shuts it');
          await page.waitForTimeout(200);
          assert.equal(await page.locator('#dock:not([hidden]) textarea.name-edit').count(), 1, 'the row stays open after Close');
          assert.ok(await page.evaluate(() => history.state?.wvSheet !== 'activity'), `Close takes back the history step it added (${before})`);
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop Activity is the context pane right of the peek, 340px wide, not a sheet (Issue #733, Feature #348)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 844 } });
    try {
      await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await page.click('#dock .activity-btn');
      await page.waitForSelector('aside.wv-activity');
      const p = await sheet(page);
      const width = Math.round(p.right - p.left);
      assert.ok(Math.abs(width - 340) <= 1, `a pane, not a sheet (${width}px)`);
      assert.ok(await page.evaluate(() => document.querySelector('aside.wv-activity').parentElement === document.querySelector('#side')), 'in the context pane');
      assert.ok(await page.evaluate(() => document.querySelector('#dock').getBoundingClientRect().right <= document.querySelector('#side').getBoundingClientRect().left), 'right of the peek');
      assert.equal((await page.locator('aside.wv-activity .wv-act-head h3 > *').allInnerTexts()).join(' '), 'Looks broken › Activity', 'the pane head names its record too (Issue #979)');
      const c = await chipLook(page);
      assert.ok(c.rest.every((b) => !b.clear && b.bg !== c.sheet && b.bg !== c.on), `the pane filters carry the chip at rest (Issue #980): ${JSON.stringify(c)}`);
      await page.locator('aside.wv-activity .wv-act-row').filter({ hasText: 'Severity' }).first().locator('.wv-act-what').click();
      await page.waitForSelector('#dock .wv-act-view .wv-act-card');
      assert.equal(await page.locator('aside.wv-activity .wv-act-view').count(), 0, 'on a desktop the change still draws in the record (Issue #978)');
    } finally { await page.close(); }
  });
}
