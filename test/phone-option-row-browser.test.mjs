import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage, PHONE } from './lib/browser.mjs';
import { seedReorder, surfaces } from './lib/reorder-surfaces.mjs';
const MIN_NAME = 140;
const MIN_TARGET = 44;
const LISTS = ['workflow state list', 'select option list'];
let ids;
const s = await launch(`option and state rows on ${PHONE} (Issue #842)`, (weave) => { ids = seedReorder(weave); });
if (s) {
  const { base, weave } = s;
  const all = surfaces({ weave, base, ids });
  for (const name of LISTS) {
    const surface = all.find((x) => x.name === name);
    for (const theme of ['light', 'dark']) {
      test(`${name}: every name box is at least ${MIN_NAME}px wide and the row keeps all its controls on screen on ${PHONE} (${theme}, Issue #842)`, async () => {
        const p = await phonePage(await phoneBrowser());
        try {
          await p.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
          await surface.open(p);
          assert.equal(await p.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          assert.equal(await p.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the profile is a coarse pointer');
          const rows = await p.locator('#tray-back .opt-list .opt-row').evaluateAll((nodes) => {
            const view = window.innerWidth;
            const tray = document.querySelector('#tray-back .tray-body').getBoundingClientRect();
            return nodes.map((row) => {
              const name = row.querySelector('.opt-name').getBoundingClientRect();
              const del = row.querySelector('.opt-del').getBoundingClientRect();
              const kids = [...row.children].map((n) => {
                const r = n.getBoundingClientRect();
                return { cls: n.className, left: r.left, right: r.right, w: r.width, h: r.height };
              });
              return { view, tray: { left: tray.left, right: tray.right }, name: { w: name.width, bottom: name.bottom }, del: { w: del.width, h: del.height, top: del.top }, kids, count: row.children.length };
            });
          });
          assert.ok(rows.length >= 3, `${rows.length} rows listed`);
          for (const row of rows) {
            assert.ok(row.name.w >= MIN_NAME, `name box is ${row.name.w}px, wants at least ${MIN_NAME}px`);
            assert.ok(row.del.w >= MIN_TARGET && row.del.h >= MIN_TARGET, `delete is ${row.del.w}x${row.del.h}, wants at least ${MIN_TARGET}x${MIN_TARGET}`);
            assert.ok(row.del.top >= row.name.bottom - 1, 'delete sits on the second line, below the name');
            for (const k of row.kids) {
              assert.ok(k.w > 0 && k.h > 0, `${k.cls} is rendered`);
              assert.ok(k.left >= 0 && k.right <= row.view, `${k.cls} spans ${k.left}..${k.right} inside the ${row.view}px screen`);
              assert.ok(k.right <= row.tray.right + 0.5, `${k.cls} ends at ${k.right}, inside the tray edge ${row.tray.right}`);
            }
          }
        } finally { await p.close(); }
      });
    }
  }
}
