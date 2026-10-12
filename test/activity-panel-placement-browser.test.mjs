import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let tableId, rowId;
const s = await launch('activity panel placement', (weave) => {
  weave.createSpace({ name: 'Dev' });
  const t = weave.createTable({ space: 'Dev', name: 'Issue' });
  weave.addField(t, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  tableId = t.id;
  rowId = weave.createEntity(t, { name: 'Panel placement', doc: 'a description long enough to fill the body of the record', values: { Severity: 'Low' } }).id;
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

  test('in the peek beside a table the Activity panel mounts inside the peek and covers neither the record nor the table (Issue #871)', async () => {
    const p = await page(`#/table/${tableId}?e=${rowId}`);
    try {
      await p.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      const tableBefore = await p.locator('#main .table-wrap').evaluate((n) => n.getBoundingClientRect().toJSON());
      await p.click('#dock .activity-btn');
      await p.waitForSelector('aside.wv-activity .wv-act-row');
      const m = await measure(p, '#dock .dock-entity');
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
      assert.equal(await eventually(() => p.locator('#dock .dock-entity aside.wv-activity').count(), 1), 1, 'the panel moved into the peek');
      assert.equal(await p.locator('aside.wv-activity').count(), 1, 'one panel');
      assert.equal(await p.locator('#dock .activity-btn').getAttribute('aria-pressed'), 'true');
    } finally { await p.close(); }
  });
}
