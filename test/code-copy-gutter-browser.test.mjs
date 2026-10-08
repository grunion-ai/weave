import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const LONG = 'const aVeryLongVariableNameThatShouldScrollInsideItsOwnBox = someFunction(argumentOne, argumentTwo);';
let id;
const s = await launch('code copy gutter', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  const notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  id = weave.createEntity(notes, { name: 'Code case' }).id;
  weave.setDoc(id, `Before\n\n\`\`\`js\n${LONG}\n\`\`\`\n\nAfter\n`);
});
if (s) {
  const { base, browser } = s;
  for (const [width, colorScheme] of [['iPhone profile', 'light'], ['iPhone profile', 'dark'], [1280, 'light']]) {
    test(`the code block copy button sits in its own gutter, not on the code, at ${typeof width === 'number' ? `${width}px` : `the ${width}`} in ${colorScheme} (Issue #694)`, async () => {
      const page = typeof width === 'number' ? await browser.newPage({ viewport: { width, height: 800 }, colorScheme }) : await phonePage(await phoneBrowser(), { colorScheme });
      try {
        await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.doc-editor .vditor-copy span');
        const box = await page.evaluate(() => {
          const copy = document.querySelector('.doc-editor .vditor-copy span').getBoundingClientRect();
          const code = document.querySelector('.doc-editor .vditor-copy').parentElement.querySelector('code');
          const scroller = [code, code.parentElement].find((n) => n.scrollWidth > n.clientWidth) ?? code;
          const r = scroller.getBoundingClientRect();
          const cs = getComputedStyle(scroller);
          return {
            copyLeft: copy.left, copyTop: copy.top, copyBottom: copy.bottom,
            textRight: r.left + scroller.clientLeft + scroller.clientWidth - parseFloat(cs.paddingRight),
            textTop: r.top, sw: document.documentElement.scrollWidth, iw: innerWidth,
          };
        });
        assert.ok(box.textRight <= box.copyLeft + 0.5,
          `the visible code ends at ${box.textRight.toFixed(1)}px, under the copy button that starts at ${box.copyLeft.toFixed(1)}px`);
        assert.ok(box.sw <= box.iw, 'the page itself does not scroll sideways');
      } finally { await page.close(); }
    });
  }
}
