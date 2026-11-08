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
  const board = '#fsv-back .fsv-body';
  const nodes = (page) => page.evaluate((sel) => {
    const box = (id) => {
      const n = document.querySelector(`${sel} g.node[id*="-${id}-"]`);
      return n && { text: n.textContent.trim(), h: n.getBoundingClientRect().height, br: n.querySelectorAll('br').length };
    };
    return { A: box('A'), B: box('B'), C: box('C') };
  }, board);

  for (const colorScheme of ['light', 'dark']) {
    test(`the whiteboard draws the document's mermaid and wraps its line breaks, in ${colorScheme} (Issue #471, Issue #662)`, async () => {
      const page = await browser.newPage({ colorScheme });
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme, 'the page resolved the theme under test');
      await page.waitForSelector(`${sec} .doc-diagram pre.mermaid svg`, { timeout: 20000 });
      await page.click(`${sec} .mmd-tools button[title="Open as a whiteboard"]`);
      await page.waitForSelector(`${board} .wb-stage svg g.node`, { timeout: 20000 });
      const n = await nodes(page);
      assert.ok(n.A && n.B && n.C, 'the three nodes are drawn');
      assert.equal(await page.locator(`${board} .wb-stage svg g.node`).count(), await page.locator(`${sec} .doc-diagram pre.mermaid svg g.node`).count(), 'the whiteboard draws every node the document draws');
      assert.ok(!n.A.text.includes('\\n'), `the escaped break is not printed as a backslash and an n (${n.A.text})`);
      assert.ok(!n.C.text.includes('<br'), 'the <br/> tag is not literal text');
      assert.ok(n.A.br >= 1 && n.C.br >= 1, 'both labels break onto a second line');
      assert.ok(n.A.h > n.B.h, `the two-line node is taller than the one-line node (${n.A.h} vs ${n.B.h})`);
      assert.ok(n.C.h > n.B.h, `the <br/> node is taller than the one-line node (${n.C.h} vs ${n.B.h})`);
      await page.close();
    });
  }

  test('the whiteboard pans on drag and zooms on the wheel (Feature #46)', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${sec} .doc-diagram pre.mermaid svg`, { timeout: 20000 });
    await page.click(`${sec} .mmd-tools button[title="Open as a whiteboard"]`);
    await page.waitForSelector(`${board} .wb-stage svg`, { timeout: 20000 });
    const view = () => page.$eval(board, (b) => ({ ...b.weaveBoard }));
    await page.waitForFunction((sel) => /scale/.test(document.querySelector(`${sel} .wb-stage`).style.transform), board);
    const start = await view();
    const r = await page.locator(board).boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.wheel(0, -400);
    await page.waitForFunction((sel) => document.querySelector(sel).weaveBoard.k !== undefined, board);
    const zoomed = await view();
    assert.ok(zoomed.k > start.k, `the wheel zooms in (${start.k} to ${zoomed.k})`);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2 + 120, r.y + r.height / 2 + 60, { steps: 4 });
    await page.mouse.up();
    const panned = await view();
    assert.ok(Math.round(panned.x - zoomed.x) === 120 && Math.round(panned.y - zoomed.y) === 60, `a drag pans by its distance (${panned.x - zoomed.x}, ${panned.y - zoomed.y})`);
    await page.close();
  });
}
