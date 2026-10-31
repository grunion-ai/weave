import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let tableId, rowId;
const s = await launch('activity panel placement', (weave) => {
  weave.createSpace({ name: 'Dev' });
  const t = weave.createTable({ space: 'Dev', name: 'Issue' });
  weave.addField(t, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  tableId = t.id;
  rowId = weave.createEntity(t, { name: 'Panel placement', doc: ['a description long enough to fill the body of the record', ...Array.from({ length: 40 }, (_, n) => `Paragraph ${n} keeps the record taller than the view.`)].join('\n\n'), values: { Severity: 'Low' } }).id;
  weave.updateEntity(rowId, { Severity: 'High' });
  for (let n = 0; n < 6; n++) weave.createEntity(t, { name: `Row ${n}`, values: { Severity: 'Low' } });
});

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

const row = (page) => page.evaluate(() => {
  const rect = (sel) => { const n = document.querySelector(sel); return n && !n.hidden ? n.getBoundingClientRect().toJSON() : null; };
  const card = (sel) => { const n = document.querySelector(sel); if (!n) return null; const cs = getComputedStyle(n); return { radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, background: cs.backgroundColor, marginTop: cs.marginTop, marginBottom: cs.marginBottom }; };
  const aside = document.querySelector('aside.wv-activity');
  return {
    count: document.querySelectorAll('aside.wv-activity').length,
    inSide: !!aside && aside.parentElement === document.querySelector('#side'),
    order: [...document.querySelector('#app').children].map((n) => n.id).filter((id) => ['main', 'dock-gutter', 'dock', 'side-gutter', 'side'].includes(id)),
    main: rect('#main'), dock: rect('#dock'), side: rect('#side'), sideGutter: rect('#side-gutter'),
    mainCard: card('#main'), sideCard: card('#side'),
    hash: location.hash,
    hit: !!aside && !!document.elementFromPoint(aside.getBoundingClientRect().left + 20, aside.getBoundingClientRect().top + 20)?.closest('#side'),
  };
});

const assertCard = (m, where) => {
  assert.deepEqual(m.order, ['main', 'dock-gutter', 'dock', 'side-gutter', 'side'], `${where}: the panes read left to right in one row`);
  assert.equal(m.count, 1, `${where}: one Activity`);
  assert.ok(m.inSide, `${where}: Activity lives in the context pane`);
  assert.ok(m.sideGutter, `${where}: a gutter sits before the context pane`);
  assert.deepEqual(m.sideCard, m.mainCard, `${where}: the context pane is the same card as the table and entity panes`);
  assert.ok(m.hit, `${where}: nothing paints over it`);
};

if (s) {
  const { browser, base } = s;
  const page = async (hash, width = 1440) => {
    const p = await browser.newPage({ viewport: { width, height: 900 } });
    await p.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return p;
  };

  test('on the full record page Activity opens in the context pane, a card right of the record that leaves the record uncovered (Feature #348)', async () => {
    const p = await page(`#/entity/${rowId}`);
    try {
      await p.waitForSelector('#main textarea.name-edit');
      await p.click('#main .activity-btn');
      await p.waitForSelector('#side:not([hidden]) aside.wv-activity .wv-act-row');
      const m = await row(p);
      assertCard(m, 'full page');
      assert.equal(m.dock, null, 'no entity pane on the full page');
      assert.ok(m.side.left >= m.main.right, `right of the record (${m.side.left} >= ${m.main.right})`);
      assert.equal(overlap(m.side, m.main), 0, 'covers none of the record');
      assert.ok(Math.abs(m.side.width - 340) <= 1, `340px by default (${m.side.width})`);
      assert.match(m.hash, /[?&]side=activity\b/, 'the URL names the open pane');
      assert.equal(await p.locator('#main .activity-btn').getAttribute('aria-pressed'), 'true');
    } finally { await p.close(); }
  });

  test('the sticky section head never paints over the Activity panel head while the record scrolls (Issue #587, Feature #348)', async () => {
    const p = await page(`#/entity/${rowId}`);
    try {
      await p.waitForSelector('#main .doc-section-head');
      await p.click('#main .activity-btn');
      await p.waitForSelector('aside.wv-activity .wv-act-head');
      const pinned = [];
      for (const y of [0, 200, 400, 800]) {
        await p.evaluate((top) => { document.querySelector('#main').scrollTop = top; }, y);
        await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const m = await p.evaluate(() => {
          const aside = document.querySelector('aside.wv-activity');
          const head = aside.querySelector('.wv-act-head').getBoundingClientRect();
          const section = document.querySelector('#main .doc-section-head');
          const sr = section.getBoundingClientRect();
          const mid = head.top + head.height / 2;
          const pts = [[head.left + 16, mid], [head.left + head.width / 2, mid], [head.right - 16, mid]];
          return {
            scrolled: document.querySelector('#main').scrollTop,
            ownCard: !document.querySelector('#main').contains(aside),
            sectionTop: Math.round(sr.top),
            head: head.toJSON(),
            hits: pts.map(([x, py]) => !!document.elementFromPoint(x, py)?.closest('aside.wv-activity')),
          };
        });
        assert.ok(m.head.top >= 0 && m.head.bottom <= 900, `scroll ${y}: the panel head stays on screen (${JSON.stringify(m.head)})`);
        assert.deepEqual(m.hits, [true, true, true], `scroll ${y} (at ${m.scrolled}): nothing paints over the panel head`);
        assert.ok(m.ownCard, `scroll ${y}: the panel is its own card, outside the scrolling record`);
        if (y >= 400) pinned.push(m.sectionTop);
      }
      assert.equal(pinned[0], pinned[1], `the section head is pinned between scroll 400 and 800, so the case covers its sticky state (${pinned})`);
    } finally { await p.close(); }
  });

  test('in the peek Activity opens in the context pane right of the entity pane, and neither the table nor the record moves under it (Feature #348)', async () => {
    const p = await page(`#/table/${tableId}?e=${rowId}`);
    try {
      await p.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await p.click('#dock .activity-btn');
      await p.waitForSelector('#side:not([hidden]) aside.wv-activity .wv-act-row');
      const m = await row(p);
      assertCard(m, 'peek');
      assert.ok(m.dock.right <= m.side.left, `right of the entity pane (${m.dock.right} <= ${m.side.left})`);
      assert.ok(m.main.right <= m.dock.left, 'the table stays left of the entity pane');
      assert.equal(overlap(m.side, m.dock), 0, 'covers none of the record');
      assert.equal(overlap(m.side, m.main), 0, 'covers none of the table');
      assert.match(m.hash, new RegExp(`\\?e=${rowId}&side=activity\\b`), 'the URL keeps the record and names the pane');
    } finally { await p.close(); }
  });

  test('a reload with side=activity in the URL reopens the context pane on the same record (Feature #348)', async () => {
    const p = await page(`#/table/${tableId}?e=${rowId}&side=activity`);
    try {
      await p.waitForSelector('#side:not([hidden]) aside.wv-activity .wv-act-row');
      assertCard(await row(p), 'after reload');
      assert.equal(await p.locator('#dock .activity-btn').getAttribute('aria-pressed'), 'true');
    } finally { await p.close(); }
  });

  test('Esc closes the context pane first, then the entity pane, right to left (Feature #348)', async () => {
    const p = await page(`#/table/${tableId}?e=${rowId}`);
    try {
      await p.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await p.click('#dock .activity-btn');
      await p.waitForSelector('#side:not([hidden]) aside.wv-activity');
      await p.locator('#side .wv-act-head h3').click();
      await p.keyboard.press('Escape');
      assert.equal(await eventually(() => p.locator('#side:not([hidden])').count(), 0), 0, 'the context pane closes');
      assert.equal(await p.locator('#side-gutter:not([hidden])').count(), 0, 'with its gutter');
      assert.equal(await p.locator('#dock:not([hidden])').count(), 1, 'the entity pane stays');
      assert.doesNotMatch(await p.evaluate(() => location.hash), /side=/, 'the URL drops the pane');
      await p.keyboard.press('Escape');
      assert.equal(await eventually(() => p.locator('#dock:not([hidden])').count(), 0), 0, 'a second Esc closes the entity pane');
    } finally { await p.close(); }
  });

  test('collapsing the record into the peek keeps the context pane open on the same record (Feature #348)', async () => {
    const p = await page(`#/entity/${rowId}`);
    try {
      await p.waitForSelector('#main textarea.name-edit');
      await p.click('#main .activity-btn');
      await p.waitForSelector('#side:not([hidden]) aside.wv-activity .wv-act-row');
      await p.click('#main button[title="Collapse (⌘⇧E)"]');
      await p.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      assert.equal(await eventually(() => p.locator('#dock .activity-btn[aria-pressed="true"]').count(), 1), 1, 'the peek shows Activity pressed');
      const m = await row(p);
      assertCard(m, 'after collapse');
      assert.ok(m.dock.right <= m.side.left, 'and the context pane now follows the entity pane');
    } finally { await p.close(); }
  });

  test('dragging the context pane gutter pins its width, the width survives a reload, and a double-click resets it (Feature #348)', async () => {
    const p = await page(`#/table/${tableId}?e=${rowId}&side=activity`, 1600);
    try {
      await p.waitForSelector('#side:not([hidden]) aside.wv-activity');
      const g = await p.locator('#side-gutter').boundingBox();
      await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await p.mouse.down();
      await p.mouse.move(g.x + g.width / 2 - 80, g.y + g.height / 2, { steps: 4 });
      await p.mouse.up();
      const wide = (await row(p)).side.width;
      assert.ok(wide >= 410, `the drag widened it (${wide})`);
      await p.reload({ waitUntil: 'networkidle' });
      await p.waitForSelector('#side:not([hidden]) aside.wv-activity');
      assert.ok(Math.abs((await row(p)).side.width - wide) <= 1, 'the width is kept');
      await p.locator('#side-gutter').dblclick();
      assert.ok(Math.abs((await row(p)).side.width - 340) <= 1, 'a double-click resets to 340px');
    } finally { await p.close(); }
  });
}
