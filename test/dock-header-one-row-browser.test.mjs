/* The docked entity has one header row, and it holds while the pane scrolls
   (Issue #583).
   Kyle's screenshot, Icons #1 in the dock: expand and close sat in a
   `.dock-head` row of their own above the breadcrumb. Only the entity's
   `.view-header` is sticky in the dock (Issue #411), so that row left the
   screen with the first scroll, and the pane showed two toolbars stacked:
   back / expand / close on top, the crumb with the eye and the ⋮ below.
   The full page already wears its pose controls in the crumb row, so the
   dock now does too: back left of the crumb path, expand and close after
   the eye and the ⋮, all inside the one pinned band.
   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const para = (word, n) => Array.from({ length: n }, (_, i) => `${word} paragraph ${i + 1} with enough words to read as prose.`).join('\n\n');

let deals, contacts, acme, jane;
const s = await launch('dock header one row', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  contacts = weave.createTable({ space: 'Sales', name: 'Contacts' });
  weave.addRelation(deals, { name: 'Contact', targetDb: contacts.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  jane = weave.createEntity(contacts, { name: 'Jane Rivera' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital', Contact: jane.id });
  weave.setDoc(acme.id, para('Acme', 60));
  weave.setDoc(jane.id, para('Jane', 60));
});

if (s) {
  const { base, browser } = s;

  const openDocked = async ({ width = 1280, height = 720, theme = null } = {}) => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${base}/#/table/${deals.id}?e=${acme.id}`, { waitUntil: 'networkidle' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    await page.waitForTimeout(400); // the header height is published on a ResizeObserver
    return page;
  };
  const toBottom = (page) => page.evaluate(() => {
    const d = document.querySelector('#dock');
    d.scrollTo({ top: d.scrollHeight, behavior: 'instant' });
    return d.scrollTop;
  });
  /* One reading of the dock's chrome after a scroll: where each control is,
     which row holds it, and whether a tap at its centre reaches it. */
  const read = (page) => page.evaluate(() => {
    const dock = document.querySelector('#dock');
    const pane = dock.getBoundingClientRect();
    const row = dock.querySelector('.dock-entity > .view-header .crumb-row');
    const path = row?.querySelector('.crumb-path');
    const pick = (sel) => {
      const n = dock.querySelector(sel);
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        top: r.top, bottom: r.bottom, left: r.left, rowTop: n.closest('.crumb-row')?.getBoundingClientRect().top ?? null,
        inRow: !!row && row.contains(n),
        reachable: !!hit && (hit === n || n.contains(hit)),
      };
    };
    const actions = row ? [...row.querySelectorAll('.crumb-actions > *')] : [];
    return {
      scrollTop: dock.scrollTop,
      pane: { top: pane.top, bottom: dock.getBoundingClientRect().top + dock.clientHeight },
      dockHeads: dock.querySelectorAll('.dock-head').length,
      header: dock.querySelector('.dock-entity > .view-header')?.getBoundingClientRect().top ?? null,
      row: row ? { top: row.getBoundingClientRect().top } : null,
      path: path ? { left: path.getBoundingClientRect().left, top: path.getBoundingClientRect().top, bottom: path.getBoundingClientRect().bottom } : null,
      expand: pick('.pose-btn'),
      close: pick('button[aria-label="Close"]'),
      back: pick('.dock-back'),
      order: actions.map((n) => n.classList.contains('eye-btn') ? 'eye'
        : n.classList.contains('pose-btn') ? 'expand'
        : n.getAttribute('aria-label') === 'Close' ? 'close'
        : n.querySelector?.('.dots-btn, [aria-haspopup]') || n.matches?.('.dots-btn, [aria-haspopup], .dropdown') ? 'menu' : n.className),
    };
  });
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 3, `${msg}: ${a} vs ${b}`);
  const visibleOneRow = (r, name, ctl) => {
    assert.ok(ctl, `${name} is in the dock`);
    assert.ok(ctl.inRow, `${name} sits in the breadcrumb's row`);
    assert.ok(ctl.top >= r.pane.top - 1 && ctl.bottom <= r.pane.bottom + 1, `${name} is on screen after the scroll: ${JSON.stringify(ctl)} in ${JSON.stringify(r.pane)}`);
    assert.ok(ctl.reachable, `${name} answers a tap at its centre, nothing paints over it`);
    assert.ok(ctl.top < r.path.bottom && ctl.bottom > r.path.top, `${name} overlaps the breadcrumb's line instead of stacking above or below it (${JSON.stringify(r)})`);
    near(ctl.rowTop, r.row.top, `${name}'s row top is the breadcrumb's row top`);
  };

  for (const theme of ['light', 'dark']) {
    test(`${theme}: expand and close stay pinned in the breadcrumb's row at the bottom of the pane`, async () => {
      const page = await openDocked({ theme });
      const r0 = await read(page);
      assert.equal(r0.dockHeads, 0, 'no separate .dock-head row above the breadcrumb');
      assert.ok(await toBottom(page) > 400, 'the pane really scrolls');
      const r = await read(page);
      assert.ok(r.row, 'the dock has a crumb row');
      // The header band meets the pane's top edge and carries the pane's
      // padding as its ground, so the crumb row holds where it rested
      // (Issue #608) instead of climbing into the padding.
      near(r.header, r.pane.top, 'the header band is pinned to the top of the pane while the body scrolls');
      near(r.row.top, r0.row.top, 'the crumb row keeps the top it had at rest');
      visibleOneRow(r, 'expand', r.expand);
      visibleOneRow(r, 'close', r.close);
      assert.deepEqual(r.order.filter((x) => ['eye', 'expand', 'close'].includes(x)), ['eye', 'expand', 'close'], `expand and close follow the eye: ${r.order}`);
      assert.ok(r.order.indexOf('expand') === r.order.length - 2 && r.order.indexOf('close') === r.order.length - 1, `expand and close end the row, after the ⋮: ${r.order}`);
      await page.close();
    });
  }

  test('after a hop, back sits left of the crumb path in the same pinned row and walks the chain', async () => {
    const page = await openDocked();
    await page.click(`#dock a[href="#/entity/${jane.id}"]`);
    await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Jane Rivera');
    await page.waitForTimeout(300);
    await toBottom(page);
    const r = await read(page);
    visibleOneRow(r, 'back', r.back);
    assert.ok(r.back.left < r.path.left, `back is left of the crumb path: ${r.back.left} vs ${r.path.left}`);
    visibleOneRow(r, 'expand', r.expand);
    visibleOneRow(r, 'close', r.close);
    await page.click('#dock .dock-back');
    await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Acme Working Capital');
    assert.equal(await page.locator('#dock .dock-back').count(), 0, 'nothing behind the root: no back arrow');
    await page.close();
  });

  test('the in-row close button and the in-row expand still do their jobs', async () => {
    let page = await openDocked();
    await toBottom(page);
    await page.click('#dock .crumb-row button[aria-label="Close"]');
    await page.waitForSelector('#dock', { state: 'hidden' });
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}`, 'close strips ?e=');
    await page.close();
    page = await openDocked();
    await toBottom(page);
    await page.click('#dock .crumb-row .pose-btn');
    await page.waitForSelector('#main .name-edit');
    assert.equal(await page.evaluate(() => location.hash), `#/entity/${acme.id}`);
    await page.close();
  });

  test('phone: the full-screen dock keeps expand and close in its one header row', async () => {
    const page = await openDocked({ width: 390, height: 844 });
    await toBottom(page);
    const r = await read(page);
    assert.equal(r.dockHeads, 0);
    for (const [name, ctl] of [['expand', r.expand], ['close', r.close]]) {
      assert.ok(ctl?.inRow, `${name} sits in the crumb row`);
      assert.ok(ctl.top >= r.pane.top - 1 && ctl.bottom <= r.pane.bottom + 1, `${name} is on screen: ${JSON.stringify(ctl)}`);
      assert.ok(ctl.reachable, `${name} answers a tap`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'no sideways scroll');
    await page.click('#dock .crumb-row button[aria-label="Close"]');
    await page.waitForSelector('#dock', { state: 'hidden' });
    await page.close();
  });
}
