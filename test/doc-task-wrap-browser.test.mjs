import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const LONG = 'Kyle tries the demo deck and sends back what felt wrong about reach, hold, grid weight on screen and which lines win';
const URL = `https://example.com/${'a'.repeat(200)}`;
let id;
const s = await launch('doc task wrap', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  const notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  id = weave.createEntity(notes, { name: 'Wrap case', doc: `- [ ] ${LONG}\n- [ ] ${URL}\n` }).id;
});

if (s) {
  const { base } = s;
  test('a checklist item wraps between words, and a long URL still fits the column (Issue #715)', async () => {
    const page = await phonePage(await phoneBrowser());
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.vditor-ir .vditor-task input');
      const m = await page.evaluate(() => {
        const [first, second] = document.querySelectorAll('.vditor-ir .vditor-task');
        const node = [...first.childNodes].find((c) => c.nodeType === 3 && c.textContent.trim().length > 20);
        const text = node.textContent;
        const range = document.createRange();
        const tops = [...text].map((_, i) => { range.setStart(node, i); range.setEnd(node, i + 1); return Math.round(range.getBoundingClientRect().top); });
        const breaks = [];
        for (let i = 1; i < text.length; i++) if (tops[i] > tops[i - 1] && text[i - 1] !== ' ' && text[i] !== ' ') breaks.push(text.slice(Math.max(0, i - 4), i) + '|' + text.slice(i, i + 4));
        const lines = new Set(tops).size;
        return { breaks, lines, urlFits: second.scrollWidth <= second.clientWidth + 1 };
      });
      assert.ok(m.lines > 1, 'the item wraps');
      assert.deepEqual(m.breaks, [], 'no line ends inside a word');
      assert.ok(m.urlFits, 'the URL wraps inside the column');
    } finally { await page.close(); }
  });
}
