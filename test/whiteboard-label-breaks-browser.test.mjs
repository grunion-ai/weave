import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const MMD = 'flowchart TD\n  A[run in a frame\\n+ toggle for source] --> B[one line]\n  B --> C[two<br/>lines]\n';

let table, row;
const s = await launch('whiteboard label breaks', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  table = weave.createTable({ space: 'Scratch', name: 'Doc' });
  weave.addField(table, { name: 'Diagram', type: 'document' });
  row = weave.createEntity(table, { name: 'Breaks' });
  weave.setDoc(row.id, MMD, 'Diagram');
});

if (s) {
  const { base, browser } = s;
  const sec = '.doc-section:has(.doc-section-name:text-is("Diagram"))';

  for (const colorScheme of ['light', 'dark']) {
    test(`the whiteboard wraps a mermaid line break instead of printing it, in ${colorScheme} (Issue #471)`, async () => {
      const page = await browser.newPage({ colorScheme });
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme, 'the page resolved the theme under test');
      await page.waitForSelector(`${sec} .doc-diagram pre.mermaid`, { timeout: 20000 });
      await page.click(`${sec} .mmd-tools button[title="Open as a whiteboard"]`);
      await page.waitForFunction(
        () => (document.querySelector('#fsv-back .fsv-body')?._cyreg?.cy?.nodes().length ?? 0) >= 3,
        null,
        { timeout: 20000 },
      );
      const read = await page.evaluate(() => {
        const cy = document.querySelector('#fsv-back .fsv-body')._cyreg.cy;
        const n = (id) => cy.$id(id);
        return {
          escaped: n('A').data('label'),
          tag: n('C').data('label'),
          wrap: n('A').style('text-wrap'),
          heights: { A: n('A').height(), B: n('B').height(), C: n('C').height() },
        };
      });
      assert.equal(read.escaped, 'run in a frame\n+ toggle for source', 'the escaped break is a newline, not a backslash and an n');
      assert.equal(read.tag, 'two\nlines', 'the <br/> tag is a newline, not literal text');
      assert.equal(read.wrap, 'wrap', 'the node label wraps on the newline');
      assert.ok(read.heights.A > read.heights.B, `the two-line node is taller than the one-line node (${read.heights.A} vs ${read.heights.B})`);
      assert.ok(read.heights.C > read.heights.B, `the <br/> node is taller than the one-line node (${read.heights.C} vs ${read.heights.B})`);
      await page.close();
    });
  }
}
