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

const measure = (page, mountSel) => page.evaluate((sel) => {
  const aside = document.querySelector('aside.wv-activity');
  const mount = document.querySelector(sel);
  const rect = (n) => (n ? n.getBoundingClientRect().toJSON() : null);
  return {
    count: document.querySelectorAll('aside.wv-activity').length,
    parentIsBody: aside.parentElement === document.body,
    insideMount: !!mount && mount.contains(aside),
    position: getComputedStyle(aside).position,
    aside: rect(aside),
    mount: rect(mount),
    body: rect(mount?.querySelector('.entity-grid')),
    table: rect(document.querySelector('#main .table-wrap')),
    mainMargin: getComputedStyle(document.querySelector('#main')).marginRight,
    hit: !!document.elementFromPoint(aside.getBoundingClientRect().left + 20, aside.getBoundingClientRect().top + 20)?.closest('aside.wv-activity'),
  };
}, mountSel);

const docked = (page, viewSel) => page.evaluate((sel) => {
  const view = document.querySelector(sel);
  const aside = view.querySelector(':scope > aside.wv-activity');
  const vr = view.getBoundingClientRect();
  const inner = { left: vr.left + view.clientLeft, top: vr.top + view.clientTop, width: view.clientWidth, height: view.clientHeight };
  inner.right = inner.left + inner.width; inner.bottom = inner.top + inner.height;
  const cs = getComputedStyle(aside);
  const values = [...view.querySelectorAll('.fieldrow > :not(.fieldrow-label), .entity-grid, .view-header .btn, .view-header textarea')].map((n) => n.getBoundingClientRect().toJSON()).filter((r) => r.width && r.height);
  return {
    view: inner, pane: aside.getBoundingClientRect().toJSON(), values,
    radius: cs.borderTopLeftRadius, borders: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], shadow: cs.boxShadow,
    scrollable: view.scrollHeight - view.clientHeight,
  };
}, viewSel);

const assertDocked = (m, where) => {
  const near = (a, b) => Math.abs(a - b) <= 1;
  assert.ok(near(m.pane.right, m.view.right), `${where}: the pane's right edge is the view's (${m.pane.right} vs ${m.view.right})`);
  assert.ok(near(m.pane.top, m.view.top), `${where}: the pane starts at the view's top (${m.pane.top} vs ${m.view.top})`);
  assert.ok(near(m.pane.height, m.view.height), `${where}: the pane is the view's full height (${m.pane.height} vs ${m.view.height})`);
  assert.equal(m.radius, '0px', `${where}: square edges`);
  assert.deepEqual(m.borders, ['0px', '0px', '0px', '1px'], `${where}: one left border`);
  assert.equal(m.shadow, 'none', `${where}: no shadow`);
  const under = m.values.filter((r) => overlap(r, m.pane) > 0);
  assert.deepEqual(under, [], `${where}: no field value, header control or record body passes under the pane`);
};

const scrollEnd = async (page, viewSel) => {
  await page.evaluate((sel) => { const v = document.querySelector(sel); v.scrollTop = v.scrollHeight; }, viewSel);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};

if (s) {
  const { browser, base } = s;
  const page = async (hash) => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return p;
  };

  test('on the full record page the Activity panel mounts inside the record, right of its body, and the body narrows (Issue #871)', async () => {
    const p = await page(`#/entity/${rowId}`);
    try {
      await p.waitForSelector('#main textarea.name-edit');
      const before = await p.locator('#main .entity-grid').evaluate((n) => n.getBoundingClientRect().width);
      await p.click('#main .activity-btn');
      await p.waitForSelector('aside.wv-activity .wv-act-row');
      const m = await measure(p, '#main');
      assert.equal(m.count, 1);
      assert.equal(m.parentIsBody, false, 'the panel is not hung on the page body');
      assert.ok(m.insideMount, 'the panel sits inside the record view');
      assert.notEqual(m.position, 'fixed', 'the panel is in the record layout, not pinned over it');
      assert.equal(overlap(m.aside, m.body), 0, `the panel covers none of the record body (${JSON.stringify([m.aside, m.body])})`);
      assert.ok(m.aside.left >= m.body.right, 'the panel sits right of the body');
      assert.ok(m.aside.right <= m.mount.right, 'the panel stays inside the record view');
      assert.ok(m.body.width < before, `the body narrows to make room (${m.body.width} < ${before})`);
      assert.equal(m.mainMargin, '8px', 'the page itself does not move');
      assert.ok(m.hit, 'nothing paints over the panel');
    } finally { await p.close(); }
  });

  test('on the full record page the Activity panel is a right-anchored pane, full height, square, and stays docked while the record scrolls (Issue #906)', async () => {
    const p = await page(`#/entity/${rowId}`);
    try {
      await p.waitForSelector('#main textarea.name-edit');
      await p.click('#main .activity-btn');
      await p.waitForSelector('aside.wv-activity .wv-act-row');
      const top = await docked(p, '#main');
      assert.ok(top.scrollable > 100, `the record is taller than the view (${top.scrollable}px to scroll)`);
      assertDocked(top, 'at the top');
      await scrollEnd(p, '#main');
      assertDocked(await docked(p, '#main'), 'scrolled to the end');
    } finally { await p.close(); }
  });

  test('the sticky section head never paints over the Activity panel head while the record scrolls (Issue #587)', async () => {
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
            asideZ: Number(getComputedStyle(aside).zIndex), sectionZ: Number(getComputedStyle(section).zIndex),
            sectionTop: Math.round(sr.top),
            head: head.toJSON(),
            hits: pts.map(([x, py]) => !!document.elementFromPoint(x, py)?.closest('aside.wv-activity')),
          };
        });
        assert.ok(m.head.top >= 0 && m.head.bottom <= 900, `scroll ${y}: the panel head stays on screen (${JSON.stringify(m.head)})`);
        assert.deepEqual(m.hits, [true, true, true], `scroll ${y} (at ${m.scrolled}): nothing paints over the panel head`);
        assert.ok(m.asideZ > m.sectionZ, `scroll ${y}: the panel stacks above the sticky section head (${m.asideZ} > ${m.sectionZ})`);
        if (y >= 400) pinned.push(m.sectionTop);
      }
      assert.equal(pinned[0], pinned[1], `the section head is pinned between scroll 400 and 800, so the case covers its sticky state (${pinned})`);
    } finally { await p.close(); }
  });

  test('in the peek the Activity panel is the same right-anchored pane, full height of the peek (Issue #906)', async () => {
    const p = await page(`#/table/${tableId}?e=${rowId}`);
    try {
      await p.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await p.click('#dock .activity-btn');
      await p.waitForSelector('aside.wv-activity .wv-act-row');
      assertDocked(await docked(p, '#dock'), 'peek, at the top');
      await scrollEnd(p, '#dock');
      assertDocked(await docked(p, '#dock'), 'peek, scrolled to the end');
    } finally { await p.close(); }
  });

  test('in the peek beside a table the Activity panel mounts inside the peek and covers neither the record nor the table (Issue #871)', async () => {
    const p = await page(`#/table/${tableId}?e=${rowId}`);
    try {
      await p.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      const tableBefore = await p.locator('#main .table-wrap').evaluate((n) => n.getBoundingClientRect().toJSON());
      await p.click('#dock .activity-btn');
      await p.waitForSelector('aside.wv-activity .wv-act-row');
      const m = await measure(p, '#dock');
      assert.equal(m.parentIsBody, false, 'the panel is not hung on the page body');
      assert.ok(m.insideMount, 'the panel sits inside the peek');
      assert.notEqual(m.position, 'fixed');
      assert.equal(overlap(m.aside, m.body), 0, `the panel covers none of the record body (${JSON.stringify([m.aside, m.body])})`);
      assert.equal(overlap(m.aside, m.table), 0, 'the panel covers none of the table');
      assert.ok(m.aside.left >= m.body.right, 'the panel sits right of the record body');
      assert.ok(m.aside.right <= m.mount.right + 1, 'the panel stays inside the peek');
      assert.deepEqual([m.table.left, m.table.width], [tableBefore.left, tableBefore.width], 'the table does not move');
      assert.ok(m.hit, 'nothing paints over the panel');
    } finally { await p.close(); }
  });

  test('collapsing the record into the peek carries the open panel with it (Issue #871)', async () => {
    const p = await page(`#/entity/${rowId}`);
    try {
      await p.waitForSelector('#main textarea.name-edit');
      await p.click('#main .activity-btn');
      await p.waitForSelector('aside.wv-activity .wv-act-row');
      await p.click('#main button[title="Collapse (⌘⇧E)"]');
      await p.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      assert.equal(await eventually(() => p.locator('#dock > aside.wv-activity').count(), 1), 1, 'the panel moved into the peek');
      assert.equal(await p.locator('aside.wv-activity').count(), 1, 'one panel');
      assert.equal(await p.locator('#dock .activity-btn').getAttribute('aria-pressed'), 'true');
    } finally { await p.close(); }
  });
}
