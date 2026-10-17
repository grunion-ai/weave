import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('rail routes', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Task' });
});

if (s) {
  const { base, browser } = s;
  const ROUTES = ['Workflows', 'Users', 'Activity', 'Trash'];

  async function open({ collapsed }) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.evaluate((c) => localStorage.setItem('weave-nav-collapsed', c ? '1' : ''), collapsed);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#rail-routes .rail-route', { state: 'attached' });
    return page;
  }

  const shown = (page, label) => page.evaluate((l) => {
    const a = [...document.querySelectorAll('#rail-routes .rail-route')].find((n) => n.getAttribute('aria-label') === l);
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 0, title: a.getAttribute('title'), href: a.getAttribute('href'), current: a.getAttribute('aria-current') };
  }, label);

  test('the collapsed rail carries every pinned route as a one-click button (Issue #909)', async () => {
    const page = await open({ collapsed: true });
    for (const label of ROUTES) {
      const seen = await shown(page, label);
      assert.ok(seen, `${label} is missing from the rail`);
      assert.ok(seen.visible, `${label} is in the rail but not visible`);
      assert.equal(seen.title, label, `${label} needs a tooltip label`);
      assert.ok(seen.href && seen.href !== '/', `${label} needs a destination, got ${seen.href}`);
    }
    await page.close();
  });

  test('a divider sits above the rail routes and the current route is a filled tile (Issue #909)', async () => {
    const page = await open({ collapsed: true });
    const divider = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#rail-routes'));
      return { width: cs.borderTopWidth, style: cs.borderTopStyle };
    });
    assert.notEqual(divider.width, '0px', 'the rail routes need a divider above them');
    assert.notEqual(divider.style, 'none', 'the rail routes need a divider above them');
    const link = page.locator('#rail-routes .rail-route[aria-label="Activity"]');
    await link.click();
    await page.waitForFunction(() => location.hash === '#/activity');
    const seen = await shown(page, 'Activity');
    assert.equal(seen.current, 'page', 'the route the page is on carries aria-current');
    const filled = await page.evaluate(() => document.querySelector('#rail-routes .rail-route[aria-label="Activity"]').classList.contains('active'));
    assert.ok(filled, 'the current route is drawn as a filled tile');
    await page.close();
  });

  test('a route is never claimed by both the rail and the sidebar at once (Issue #909)', async () => {
    const page = await open({ collapsed: false });
    for (const label of ROUTES) {
      const copies = await page.evaluate((l) => [...document.querySelectorAll('#ws-rail a, #sidebar a')]
        .filter((a) => (a.getAttribute('aria-label') ?? a.textContent.trim()) === l)
        .filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length, label);
      assert.equal(copies, 1, `${label} is visible ${copies} times with the nav open`);
    }
    await page.close();
  });
}
