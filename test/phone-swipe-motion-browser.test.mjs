import test from 'node:test';
import assert from 'node:assert/strict';
import { eventually, launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone swipe motion', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  for (let i = 0; i < 8; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: 'Open' } });
  weave.updateTable(issues, { description: 'Bugs found in weave, one row each.' });
  return { table: `#/table/${issues.id}` };
});

const drag = (page, n, dx, { fromLeft = false } = {}) => page.evaluate(async ([n, dx, fromLeft]) => {
  const row = document.querySelectorAll('#main tbody tr.entity-row')[n];
  const box = row.getBoundingClientRect();
  const x = fromLeft ? box.left + 40 : box.right - 40, y = box.top + box.height / 2;
  const target = document.elementFromPoint(x, y);
  const fire = (type, cx) => target.dispatchEvent(new PointerEvent(type, {
    pointerId: 5, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
    button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: cx, clientY: y,
  }));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const at = () => parseFloat(row.style.getPropertyValue('--swipe-x')) || 0;
  const samples = [];
  fire('pointerdown', x);
  for (let k = 1; k <= 10; k++) { await frame(); fire('pointermove', x + (dx * k) / 10); samples.push(at()); }
  await frame();
  fire('pointerup', x + dx);
  return samples;
}, [n, dx, fromLeft]);

const settledOpen = (page, n) => eventually(() => page.evaluate((n) => {
  const row = document.querySelectorAll('#main tbody tr.entity-row')[n];
  const cell = row.querySelector('.swipe-cell');
  return !!cell && row.classList.contains('swipe-open') && row.querySelector('td.pid-cell').getAnimations().every((a) => a.playState !== 'running');
}, n), true);

if (s) {
  const { base, browser, table } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', () => browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true })]];
  if (phone) engines.push(['webkit iPhone 15', () => phonePage(phone)]);
  const open = async (make, theme) => {
    const page = await make();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${table}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main tbody tr.entity-row .list-name');
    return page;
  };

  for (const [engine, make] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone a swipe tracks the finger both ways, rubber-bands past the ends and settles with one transition (${engine}, ${theme}, Issue #725)`, async () => {
        const page = await open(make, theme);
        try {
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          const left = await drag(page, 1, -300);
          await settledOpen(page, 1);
          const full = await page.evaluate(() => [...document.querySelectorAll('#main .swipe-cell > button')].reduce((w, b) => w + b.offsetWidth, 0));
          assert.equal(full, 176, 'two 88px actions');
          assert.ok(left.at(-1) > -300 && left.at(-1) < -full, `past the reveal the row resists (${left.at(-1)})`);
          const timing = await page.evaluate(() => {
            const row = document.querySelectorAll('#main tbody tr.entity-row')[1];
            return { td: getComputedStyle(row.querySelector('td.pid-cell')).transitionDuration, cell: getComputedStyle(row.querySelector('.swipe-cell')).transitionDuration };
          });
          assert.equal(timing.td, timing.cell, 'the row and its actions settle on one clock');
          const right = await drag(page, 1, 120, { fromLeft: true });
          assert.ok(Math.abs(right[4] - (-full + 60)) <= 1, `halfway through a right swipe from open the row sits at ${right[4]}, not ${-full + 60}: it follows the finger`);
          assert.ok(Math.abs(right.at(-1) - (-full + 120)) <= 1, `and keeps following to ${right.at(-1)}`);
          const closing = await page.evaluate(() => document.querySelectorAll('#main tbody tr.entity-row')[1].querySelector('td.pid-cell').getAnimations().length);
          assert.ok(closing > 0, 'the close settles with a transition too');
          await eventually(() => page.locator('.swipe-cell').count(), 0);
          const past = await drag(page, 2, 90, { fromLeft: true });
          assert.ok(past.at(-1) > 0 && past.at(-1) < 90, `a right swipe on a closed row stretches against the edge (${past.at(-1)})`);
          await eventually(() => page.evaluate(() => document.querySelectorAll('#main tbody tr.entity-row')[2].style.getPropertyValue('--swipe-x')), '');
        } finally { await page.close(); }
      });

      test(`on a phone closing a swiped row keeps its actions until the row is home (${engine}, ${theme}, Issue #731)`, async () => {
        const page = await open(make, theme);
        try {
          await drag(page, 3, -220);
          await settledOpen(page, 3);
          const frames = await page.evaluate(async () => {
            const row = document.querySelectorAll('#main tbody tr.entity-row')[3];
            const td = row.querySelector('td.pid-cell');
            const out = [];
            const read = () => out.push({ x: new DOMMatrix(getComputedStyle(td).transform).m41, cell: !!row.querySelector('.swipe-cell') });
            const box = row.getBoundingClientRect();
            const x = box.left + 40, y = box.top + box.height / 2;
            const target = document.elementFromPoint(x, y);
            for (const type of ['pointerdown', 'pointerup']) target.dispatchEvent(new PointerEvent(type, { pointerId: 6, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: x, clientY: y }));
            const t0 = performance.now();
            while (performance.now() - t0 < 600) { read(); await new Promise((r) => requestAnimationFrame(r)); }
            read();
            return out;
          });
          assert.ok(frames.some((f) => f.x < -1 && f.x > -175), `the row slides home over several frames: ${JSON.stringify(frames.slice(0, 6))}`);
          const early = frames.filter((f) => f.x < -0.5 && !f.cell);
          assert.deepEqual(early, [], 'the actions never vanish before the row reaches 0');
          assert.equal(frames.at(-1).cell, false, 'and they go once it is home');
        } finally { await page.close(); }
      });

      test(`on a phone the tap that closes a swiped row does nothing else (${engine}, ${theme}, Issue #720)`, async () => {
        const page = await open(make, theme);
        try {
          await drag(page, 4, -220);
          await settledOpen(page, 4);
          const desc = await page.locator('#main .view-desc').boundingBox();
          await page.touchscreen.tap(desc.x + 20, desc.y + desc.height / 2);
          await eventually(() => page.locator('.swipe-cell').count(), 0);
          await page.waitForTimeout(300);
          assert.equal(await page.locator('.view-desc-edit').count(), 0, 'the description editor stays shut');
          assert.equal(page.url().includes('?e='), false, 'and no row opens');
        } finally { await page.close(); }
      });

      test(`on a phone the revealed actions take exactly their measured width and every one takes a tap (${engine}, ${theme}, Issue #743)`, async () => {
        const page = await open(make, theme);
        try {
          await drag(page, 1, -220);
          await settledOpen(page, 1);
          const m = await page.evaluate(() => {
            const cell = document.querySelector('#main .swipe-cell');
            const buttons = [...cell.children];
            return {
              width: cell.getBoundingClientRect().width,
              need: buttons.reduce((w, b) => w + b.getBoundingClientRect().width, 0),
              hits: buttons.map((b) => { const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === b; }),
            };
          });
          assert.ok(Math.abs(m.width - m.need) <= 0.5, `the cell is ${m.width}px for ${m.need}px of actions`);
          assert.deepEqual(m.hits, m.hits.map(() => true), 'a tap at each action\'s centre lands on it');
        } finally { await page.close(); }
      });
    }
  }
}
