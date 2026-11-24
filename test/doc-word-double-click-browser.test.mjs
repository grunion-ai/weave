import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const CASES = [
  ['bold', 'We agreed to ship the **floating toolbar** next week.'],
  ['italic', 'We agreed to ship the *floating toolbar* next week.'],
  ['code', 'We agreed to ship the `floating toolbar` next week.'],
];
const ids = {};
const s = await launch('doc word double click', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  const notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  for (const [kind, line] of CASES) ids[kind] = weave.createEntity(notes, { name: `Double click ${kind}`, doc: `${line}\n` }).id;
});

if (s) {
  const { base, browser } = s;
  const GESTURES = [
    [2, 'a double-click on a word inside', 'selects that word', 'floating'],
    [3, 'a triple-click inside', 'still selects the whole line', 'We agreed to ship the floating toolbar next week.'],
  ];
  for (const [kind] of CASES) for (const [clicks, gesture, outcome, want] of GESTURES) {
    test(`${gesture} ${kind} ${outcome} (Issue #1901)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      try {
        await page.goto(`${base}/#/entity/${ids[kind]}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.vditor-ir .vditor-reset p');
        const at = await page.evaluate(() => {
          const p = document.querySelector('.vditor-ir .vditor-reset p');
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.textContent.indexOf('floating');
            if (i < 0 || n.parentElement.closest('.vditor-ir__marker')) continue;
            const range = document.createRange();
            range.setStart(n, i);
            range.setEnd(n, i + 1);
            const r = range.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
          return null;
        });
        assert.ok(at, 'the word is on screen');
        await page.mouse.click(at.x, at.y, { clickCount: clicks });
        assert.equal((await page.evaluate(() => getSelection().toString())).replace(/[*`]/g, '').trim(), want);
      } finally { await page.close(); }
    });
  }
}
