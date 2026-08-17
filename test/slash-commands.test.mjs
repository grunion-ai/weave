/* Every slash command, driven through a real browser.

   The rest of the editor's contracts are asserted at source level, because the
   UI is dependency-free vanilla JS with no DOM runtime under `node --test`.
   Insertion is different: what a menu item actually produces depends on Lute,
   contenteditable and Vditor's IR reconciliation, and none of that can be
   inferred from reading app.js. "Code blocks are broken" was invisible to
   every source-level test in the suite.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps,
   nothing npm-installed). It is imported dynamically and the whole suite skips
   when it is absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

const slash = test.suite ?? test;

if (!chromium) {
  test('slash commands (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, dir, weave, tableRef;

  test.before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'weave-slash-'));
    weave = new Weave();
    weave.createSpace({ name: 'Scratch' });
    // A new table already carries a Description document field.
    tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
    // A stable, distinctly named entity for the link picker to find.
    weave.createEntity(tableRef, { name: 'Zebrafish target' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /* Each case gets its own entity. Saves are debounced, so a document shared
     across cases receives a previous case's write after the next one has
     navigated — the suite then asserts against whichever save landed last. */
  function freshEntity(name = 'Slash case') {
    return weave.createEntity(tableRef, { name }).id;
  }

  /* Runs one slash command end to end: clear the document, type the trigger,
     let the menu filter, take the highlighted item, and return the markdown
     the editor actually holds afterwards. */
  async function runSlash(query) {
    const page = await browser.newPage();
    try {
    await page.goto(`${base}/#/entity/${freshEntity()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.evaluate(() => {
      const ed = window.__weaveEditors?.values().next().value;
      ed.setValue('');
      ed.focus();
    });
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.type(`/${query}`);
    await page.waitForSelector('.vditor-hint button', { state: 'visible' });
    const label = await page.textContent('.vditor-hint button');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(120);
    const markdown = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.getValue());
    return { label: label.trim(), markdown };
    } finally { await page.close(); }
  }

  // query → what the resulting markdown must contain. One case per menu item,
  // so a regression names the command that broke rather than "the menu".
  const CASES = [
    ['head', /^# /m],
    ['heading 2', /^## /m],
    ['heading 3', /^### /m],
    ['bold', /\*\*.+\*\*/],
    ['ital', /(?<!\*)\*[^*]+\*/],
    ['strike', /~~.+~~/],
    ['inline', /`[^`]+`/],
    ['code block', /```[\s\S]*```/],
    ['quote', /^> /m],
    ['bullet', /^- /m],
    ['number', /^1\. /m],
    ['task', /^- \[ \] /m],
    ['table', /\|.*\|[\s\S]*\| ?-{3}/],
    ['divider', /^---$/m],
    ['link', /\[.*\]\(.*\)/],
    ['image', /!\[.*\]\(.*\)/],
    ['mermaid', /```mermaid[\s\S]*```/],
  ];

  for (const [query, expected] of CASES) {
    test(`slash: ${query}`, async () => {
      const { label, markdown } = await runSlash(query);
      assert.match(markdown, expected,
        `"/${query}" chose "${label}" and produced:\n${JSON.stringify(markdown)}`);
    });
  }

  test('slash: a fenced block is a real block, not escaped text', async () => {
    // The reported defect: the fence arrived as literal characters inside a
    // paragraph, so the document held \`\`\` as text rather than a code block.
    const { markdown } = await runSlash('code block');
    assert.doesNotMatch(markdown, /\\`/, 'backticks must not arrive escaped');
    assert.doesNotMatch(markdown, /&#96;|&gt;|&lt;/, 'no HTML entities in stored markdown');
    const fences = markdown.match(/```/g) ?? [];
    assert.equal(fences.length, 2, `a code block needs exactly two fences, got ${fences.length}`);
  });

  test('slash: the entity link command searches entities and inserts a reference', async () => {
    const linkEntity = freshEntity('Link case');
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${linkEntity}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.type('/entity');
    await page.waitForSelector('.vditor-hint button', { state: 'visible' });
    await page.keyboard.press('Enter');
    // The command hands off to the same search the ⌘K palette uses, rather
    // than inserting a placeholder the writer has to fix up by hand.
    await page.waitForSelector('#cmdk', { state: 'visible' });
    await page.keyboard.type('Zebrafish');
    // .result-main, not .result — the "No results" placeholder is also a
    // .result, and waiting on it would let Enter fire against an empty list.
    await page.waitForSelector('#cmdk-results .result-main');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const markdown = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.getValue());
    assert.match(markdown, /\[\[[^\]]+#\d+(\|[^\]]+)?\]\]/,
      `expected a [[Table#id]] reference, got: ${JSON.stringify(markdown)}`);

    /* The reference has to RESOLVE, not just be shaped right. A qualified
       Space/Table#id that the renderer cannot find still parses — it just
       renders as a broken chip, which would make the command look like it
       worked while producing dead links.

       Flush rather than wait: a headless page is backgrounded and Chrome
       throttles its timers, so the 600ms debounce may not fire for a minute.
       This is the same flush the app runs on unload and on route change. */
    await page.evaluate(() => window.__weaveFlushDocSaves());
    let html = '';
    for (let i = 0; i < 40 && !html.includes('mention'); i++) {
      await page.waitForTimeout(50);
      html = await (await fetch(`${base}/e/${linkEntity}/doc.html`)).text();
    }
    const stored = await (await fetch(`${base}/e/${linkEntity}/doc.md`)).text();
    assert.match(html, /class="mention mention-entity"/,
      `the picked reference must render as a live entity chip; stored markdown was ${JSON.stringify(stored)}`);
    assert.doesNotMatch(html, /class="mention broken"/,
      'no broken references');
    await page.close();
  });
}
