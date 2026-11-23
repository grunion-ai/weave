import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const RAIL_DOC = '# One\n\ntext\n\n## Two\n\n' + 'filler\n\n'.repeat(30) + '## Three\n\n' + 'more\n\n'.repeat(30) + '### Four\n\nend\n';
const FOLD_DOC = '# Top\n\nintro\n\n## Fold me\n\nhidden one\n\nhidden two\n\n### Deeper\n\nalso hidden\n\n## After\n\nvisible\n';

let tableRef;
const s = await launch('crepe outline rail and folds', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
});

if (s) {
  const { base, browser, weave } = s;
  const ROOT = '.wv-crepe .ProseMirror[contenteditable="true"]';

  async function open(name, doc) {
    const e = weave.createEntity(tableRef, { name });
    weave.setDoc(e.id, doc, 'Description');
    const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
    await page.addInitScript(() => localStorage.setItem('weave.editor', 'crepe'));
    await page.goto(`${base}/#/entity/${e.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ROOT, { timeout: 30000 });
    return page;
  }

  test('the outline rail lists the Crepe document headings and jumps to one (Feature #87)', async () => {
    const page = await open('Rail', RAIL_DOC);
    try {
      await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
      const labels = await page.$$eval('.doc-rail-dash', (ns) => ns.map((n) => n.getAttribute('aria-label')));
      assert.deepEqual(labels.filter((l) => l !== 'One'), ['Two', 'Three', 'Four']);
      await page.locator('.doc-rail-dash[aria-label="Four"]').click();
      await page.waitForFunction(() => {
        const h = [...document.querySelectorAll('.wv-crepe .ProseMirror h3')].find((x) => x.textContent.trim() === 'Four');
        const r = h?.getBoundingClientRect();
        return r && r.top >= 0 && r.bottom <= innerHeight;
      }, null, { timeout: 10000 });
    } finally { await page.close(); }
  });

  test('folding a Crepe heading hides its section, survives an edit, and leaves the markdown alone (Feature #88)', async () => {
    const page = await open('Folds', FOLD_DOC);
    try {
      await page.waitForSelector('.doc-fold-layer .doc-fold', { timeout: 20000 });
      const before = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
      await page.evaluate(() => document.querySelectorAll('.doc-fold')[1].click());
      await page.waitForFunction(() => document.querySelectorAll('.wv-crepe .wv-folded').length > 0, null, { timeout: 20000 });
      const read = () => page.evaluate((sel) => {
        const root = document.querySelector(sel);
        const hidden = [...root.querySelectorAll('.wv-folded')].filter((b) => b.offsetParent === null).map((b) => b.textContent.trim());
        const visible = (t) => [...root.children].some((b) => b.textContent.includes(t) && b.offsetParent !== null);
        return { hidden, top: visible('intro'), after: visible('After') };
      }, ROOT);
      const r = await read();
      assert.ok(r.hidden.some((t) => t.includes('hidden one')), 'the section body folds');
      assert.ok(r.hidden.some((t) => t.includes('Deeper')), 'a deeper heading folds along');
      assert.ok(r.top && r.after, 'blocks outside the section stay visible');
      await page.click(`${ROOT} p:has-text("visible")`);
      await page.keyboard.press('End');
      await page.keyboard.type(' again', { delay: 30 });
      await page.waitForTimeout(600);
      const again = await read();
      assert.ok(again.hidden.some((t) => t.includes('hidden one')), 'the fold holds after typing elsewhere');
      const after = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
      assert.equal(after, before.replace('visible', 'visible again'), 'folding never touches the stored markdown');
    } finally { await page.close(); }
  });
  test('an opening heading that repeats the record name hides under Crepe, as under Vditor', async () => {
    const page = await open('Echo Title', '# Echo Title\n\nBody words.');
    try {
      await page.waitForFunction(() => {
        const h = document.querySelector('.wv-crepe .ProseMirror > h1');
        return h && h.classList.contains('wv-title-echo') && h.offsetParent === null;
      }, null, { timeout: 20000 });
    } finally { await page.close(); }
  });
}
