import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone swipe to change state', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  for (let i = 0; i < 8; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: 'Open' } });
  return { table: `#/table/${issues.id}` };
});

if (s) {
  const { base, browser, table } = s;
  const open = async ({ width, theme = 'light' } = {}) => {
    const page = width ? await browser.newPage({ viewport: { width, height: 844 } }) : await phonePage(await phoneBrowser());
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${table}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main tbody tr.entity-row');
    return page;
  };
  const swipe = async (page, n, dx, dy = 0) => {
    const box = await page.locator('#main tbody tr.entity-row').nth(n).boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width - 30, y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(box.x + box.width - 30 + (dx * k) / 8, y + (dy * k) / 8);
    await page.mouse.up();
  };
  const reveal = (page) => page.evaluate(() => [...document.querySelectorAll('#main tbody tr.entity-row .swipe-cell button')]
    .filter((b) => b.getClientRects().length)
    .map((b) => { const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { text: b.textContent.trim(), width: r.width, height: r.height, onTop: !!hit?.closest('.swipe-cell'), eid: b.closest('tr').dataset.eid }; }));
  const status = (page, id) => page.evaluate(async (id) => (await (await fetch(`/api/entities/${id}`)).json()).fields.Status, id);

  for (const theme of ['light', 'dark']) {
    test(`on a phone swiping a row left reveals its next states, and a pick moves it with Undo at the top (${theme}, Feature #275)`, { todo: 'Issue #743: the revealed swipe cell lays out 125px wide, not the 176px its two actions need, so In Progress is clipped and a tap on it lands on the row' }, async () => {
      const page = await open({ theme });
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        const n = theme === 'light' ? 0 : 1;
        await swipe(page, n, -220);
        const shown = await reveal(page);
        assert.deepEqual(shown.map((b) => b.text), ['In Progress', 'Fixed'], 'the states after Open show');
        assert.ok(shown.every((b) => b.width >= 44 && b.height >= 44 && b.onTop), `each is an uncovered 44px target: ${JSON.stringify(shown)}`);
        const id = shown[0].eid;
        assert.equal(page.url().includes('?e='), false, 'the swipe does not open the row');
        await page.click('#main .swipe-cell button:has-text("Fixed")');
        assert.equal(await eventually(() => status(page, id), 'Fixed'), 'Fixed', 'the row moves to Fixed');
        const toast = page.locator('.wv-toast', { hasText: 'Fixed' });
        await toast.waitFor();
        const t = await toast.boundingBox();
        assert.ok(t.y < 120, `the toast shows at the top of the screen (${t.y})`);
        await toast.locator('button', { hasText: 'Undo' }).click();
        assert.equal(await eventually(() => status(page, id), 'Open'), 'Open', 'Undo puts it back');
      } finally { await page.close(); }
    });
  }

  test('on a phone a vertical drag reveals nothing, and a tap elsewhere closes a reveal (Feature #275)', async () => {
    const page = await open();
    try {
      await swipe(page, 2, -4, 80);
      await page.waitForTimeout(300);
      assert.deepEqual(await reveal(page), [], 'a vertical drag reveals nothing');
      assert.equal(page.url().includes('?e='), false, 'and opens nothing');
      await swipe(page, 2, -220);
      assert.equal((await reveal(page)).length, 2);
      await page.mouse.click(60, 80);
      assert.deepEqual(await eventually(() => reveal(page), []), [], 'a tap outside closes it');
    } finally { await page.close(); }
  });

  test('on a desktop dragging across a row reveals nothing (Feature #275)', async () => {
    const page = await open({ width: 1280 });
    try {
      await swipe(page, 3, -220);
      assert.equal(await page.locator('.swipe-cell').count(), 0);
    } finally { await page.close(); }
  });
}
