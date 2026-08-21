/* Phase 4 editor behaviors, driven through a real browser.
   Everything here is about what Vditor, Lute and contenteditable actually do
   at runtime — span counts, overlay geometry, scroll tracking — none of which
   a source-level assertion can see (the lesson of test/slash-commands.test.mjs).
   Playwright is NOT a dependency of weave (house rule: zero runtime deps);
   it is imported dynamically and the whole suite skips when absent, so
   `node --test` stays green on a bare checkout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('phase 4 editor (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, tableRef;

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Scratch' });
    tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  function entityWithDoc(name, md) {
    const e = weave.createEntity(tableRef, { name });
    weave.setDoc(e.id, md, 'Description');
    return e.id;
  }

  async function openEntity(id) {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    return page;
  }

  /* ---------- Issue #35: syntax highlighting ---------- */

  test('a ```js block tokenizes in the IR editor preview', async () => {
    const id = entityWithDoc('Hl', '```js\nconst x = 1;\nfunction f(a) { return a; }\n```\n');
    const page = await openEntity(id);
    try {
      await page.waitForFunction(() =>
        document.querySelector('.vditor-ir__preview code.hljs')?.querySelectorAll('span').length > 0);
      const r = await page.evaluate(() => {
        const code = document.querySelector('.vditor-ir__preview code.hljs');
        return {
          spans: code.querySelectorAll('span').length,
          keyword: !!code.querySelector('.hljs-keyword'),
          visible: code.closest('.vditor-ir__preview').offsetHeight > 0,
        };
      });
      assert.ok(r.spans >= 3, `expected token spans, got ${r.spans}`);
      assert.ok(r.keyword, 'const/function must tokenize as keywords');
      assert.ok(r.visible, 'the highlighted preview must be the visible copy at rest');
    } finally { await page.close(); }
  });

  test('the slash Code block command produces a block hljs can tokenize', async () => {
    const id = entityWithDoc('SlashHl', '');
    const page = await openEntity(id);
    try {
      await page.click('.vditor-ir [contenteditable="true"]');
      await page.keyboard.type('/code block');
      await page.waitForSelector('.vditor-hint button', { state: 'visible' });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      const md = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
      assert.match(md, /```\w+/, 'the stored fence keeps the placeholder language');
      // The placeholder word "code" is a bare identifier — zero tokens in any
      // grammar. Once real code replaces it, the block must light up.
      await page.evaluate(() => {
        const ed = window.__weaveEditors.values().next().value;
        ed.setValue(ed.getValue().replace('code', 'const x = 1;'));
      });
      await page.waitForFunction(() =>
        document.querySelector('.vditor-ir__preview code.hljs')?.querySelectorAll('span').length > 0);
    } finally { await page.close(); }
  });

  test('the rendered document page tokenizes the same block', async () => {
    const id = entityWithDoc('PageHl', '```js\nconst x = 1;\n```\n');
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/e/${id}/doc.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() =>
        document.querySelector('pre > code.hljs')?.querySelectorAll('span').length > 0);
      const spans = await page.evaluate(() =>
        document.querySelector('pre > code.hljs').querySelectorAll('span').length);
      assert.ok(spans >= 2, `expected token spans on the rendered page, got ${spans}`);
    } finally { await page.close(); }
  });
}
