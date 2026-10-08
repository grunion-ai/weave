import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone next-state with two state fields', (weave) => {
  weave.createSpace({ name: 'Development' });
  const changes = weave.createTable({ space: 'Development', name: 'Change' });
  weave.addField(changes, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(changes, { name: 'Review', type: 'workflow', config: { states: [
    { name: 'Pending', category: 'not-started' },
    { name: 'Approved', category: 'in-progress' },
    { name: 'Shipped', category: 'done' }] } });
  const at = (e) => [e.id, `#/table/${changes.id}?e=${e.id}`];
  const rows = {};
  for (const engine of ['chromium', 'webkit']) {
    for (const theme of ['light', 'dark']) rows[`${engine} ${theme}`] = at(weave.createEntity(changes, { name: `Both move, ${engine} ${theme}`, values: { Status: 'Open', Review: 'Pending' } }));
    rows[`${engine} last`] = at(weave.createEntity(changes, { name: `Status done, review empty, ${engine}`, values: { Status: 'Fixed', Review: null } }));
  }
  for (let i = 0; i < 4; i++) weave.createEntity(changes, { name: `Change ${i}`, values: { Status: 'Open', Review: 'Pending' } });
  return { table: `#/table/${changes.id}`, rows };
});

const buttons = (page) => page.evaluate(() => [...document.querySelectorAll('.next-state-fab')]
  .filter((b) => b.getClientRects().length && getComputedStyle(b).display !== 'none')
  .map((b) => { const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { text: b.textContent.trim(), height: r.height, width: r.width, top: r.top, onTop: !!hit?.closest('.next-state-fab') }; }));
const fields = (page, id) => page.evaluate(async (id) => { const f = (await (await fetch(`/api/entities/${id}`)).json()).fields; return { Status: f.Status ?? null, Review: f.Review ?? null }; }, id);

if (s) {
  const { base, browser, table, rows } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', () => browser.newPage({ viewport: { width: 390, height: 844 } })]];
  if (phone) engines.push(['webkit iPhone 15', () => phonePage(phone)]);
  const open = async (make, hash, theme = 'light') => {
    const page = await make();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return page;
  };

  for (const [engine, make] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone a row with two state fields stacks one named next-step button per field, each moving only its own field (${engine}, ${theme}, Issue #742)`, async () => {
        const [id, hash] = rows[`${engine.split(' ')[0]} ${theme}`];
        const page = await open(make, hash, theme);
        try {
          await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          const seen = await buttons(page);
          assert.deepEqual(seen.map((b) => b.text), ['Move Status to In Progress', 'Move Review to Approved']);
          assert.ok(seen.every((b) => b.height >= 44 && b.onTop), `each is an uncovered 44px button: ${JSON.stringify(seen)}`);
          assert.ok(seen[0].top < seen[1].top, 'stacked');
          await page.click('.next-state-fab:has-text("Move Review to Approved")');
          assert.deepEqual(await eventually(() => fields(page, id), { Status: 'Open', Review: 'Approved' }), { Status: 'Open', Review: 'Approved' }, 'only Review moves');
          const toast = page.locator('.wv-toast', { hasText: 'Review' });
          await toast.waitFor();
          await toast.locator('button', { hasText: 'Undo' }).click();
          assert.deepEqual(await eventually(() => fields(page, id), { Status: 'Open', Review: 'Pending' }), { Status: 'Open', Review: 'Pending' }, 'Undo restores only Review');
          await page.click('.next-state-fab:has-text("Move Status to In Progress")');
          assert.deepEqual(await eventually(() => fields(page, id), { Status: 'In Progress', Review: 'Pending' }), { Status: 'In Progress', Review: 'Pending' }, 'only Status moves');
        } finally { await page.close(); }
      });
    }

    test(`on a phone a field at its last state offers no button, and an empty one moves to its first state (${engine}, Issue #742)`, async () => {
      const [id, hash] = rows[`${engine.split(' ')[0]} last`];
      const page = await open(make, hash);
      try {
        await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
        assert.deepEqual((await buttons(page)).map((b) => b.text), ['Move Review to Pending']);
        await page.click('.next-state-fab');
        assert.deepEqual(await eventually(() => fields(page, id), { Status: 'Fixed', Review: 'Pending' }), { Status: 'Fixed', Review: 'Pending' });
      } finally { await page.close(); }
    });

    test(`on a phone a table with two state fields offers no swipe actions (${engine}, Issue #742)`, async () => {
      const page = await open(make, table);
      try {
        await page.waitForSelector('#main tbody tr.entity-row .list-name');
        await page.evaluate(async () => {
          const row = document.querySelectorAll('#main tbody tr.entity-row')[1];
          const box = row.getBoundingClientRect();
          const x = box.right - 40, y = box.top + box.height / 2;
          const target = document.elementFromPoint(x, y);
          const fire = (type, cx) => target.dispatchEvent(new PointerEvent(type, { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: cx, clientY: y }));
          fire('pointerdown', x);
          for (let k = 1; k <= 8; k++) { await new Promise((r) => requestAnimationFrame(r)); fire('pointermove', x - (220 * k) / 8); }
          fire('pointerup', x - 220);
        });
        await page.waitForTimeout(300);
        assert.equal(await page.locator('.swipe-cell').count(), 0, 'a swipe cannot say which field it moves, so it offers none');
      } finally { await page.close(); }
    });
  }

  test('on a desktop the row pane shows no next-step buttons (Issue #742)', async () => {
    const page = await open(() => browser.newPage({ viewport: { width: 1280, height: 844 } }), rows['chromium light'][1]);
    try {
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      assert.deepEqual(await buttons(page), []);
    } finally { await page.close(); }
  });
}
