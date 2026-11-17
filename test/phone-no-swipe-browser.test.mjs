import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let issues;
const s = await launch('phone no swipe', (weave) => {
  weave.createSpace({ name: 'Development' });
  issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  for (let i = 0; i < 6; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: 'Open' } });
});
if (s) {
  const { base } = s;
  for (const colorScheme of ['light', 'dark']) {
    test(`on an iPhone a sideways drag on a list row reveals, moves and opens nothing, in ${colorScheme} (Feature #275 removed)`, async () => {
      const page = await phonePage(await phoneBrowser(), { colorScheme });
      try {
        await page.goto(`${base}/#/table/${issues.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#main tbody tr.entity-row');
        const status = await page.evaluate(async () => {
          const row = document.querySelectorAll('#main tbody tr.entity-row')[1];
          const box = row.getBoundingClientRect();
          const x = box.right - 40, y = box.top + box.height / 2;
          const target = document.elementFromPoint(x, y);
          const fire = (type, cx) => target.dispatchEvent(new PointerEvent(type, {
            pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true,
            button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, clientX: cx, clientY: y,
          }));
          const frame = () => new Promise((r) => requestAnimationFrame(r));
          fire('pointerdown', x);
          for (let k = 1; k <= 8; k++) { await frame(); fire('pointermove', x - (220 * k) / 8); }
          await frame();
          fire('pointerup', x - 220);
          await new Promise((r) => setTimeout(r, 400));
          const moved = [...row.children].some((td) => new DOMMatrix(getComputedStyle(td).transform).m41 !== 0);
          return { cells: document.querySelectorAll('.swipe-cell, .swipe-act').length, moved, open: row.classList.contains('swipe-open'), docked: document.querySelector('#dock')?.hidden === false };
        });
        assert.deepEqual(status, { cells: 0, moved: false, open: false, docked: false });
      } finally { await page.close(); }
    });
  }
}
