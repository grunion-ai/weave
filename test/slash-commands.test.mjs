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
    ['text', /^Text$/m],
    ['head', /^# /m],
    ['heading 2', /^## /m],
    ['heading 3', /^### /m],
    // One "Heading 1–6" row, six levels behind it: /h4 must reach level four
    // without the menu carrying six rows for headings alone.
    ['h4', /^#### /m],
    ['raw html', /^<div>/m],
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

  /* ---------- the menu itself ----------
     With the toolbar hidden the menu IS the editor's UI, so its shape is a
     contract: what it groups, what it teaches, and what it puts first. */

  test('the menu is grouped, and every row shows the syntax it writes', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${freshEntity()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.type('/');
    await page.waitForSelector('.vditor-hint button', { state: 'visible' });

    const menu = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('.vditor-hint .slash-group')].map((g) => g.textContent),
      rows: document.querySelectorAll('.vditor-hint button').length,
      labels: [...document.querySelectorAll('.vditor-hint .slash-item b')].map((b) => b.textContent),
      syntax: [...document.querySelectorAll('.vditor-hint .slash-item')]
        .map((i) => i.querySelector('.slash-syntax')?.textContent ?? null),
      icons: [...document.querySelectorAll('.vditor-hint .slash-item')]
        .map((i) => i.querySelector('.slash-icon')?.textContent ?? null),
    }));

    assert.deepEqual(menu.groups, ['ALL COMMANDS', 'REFERENCE', 'FORMAT · APPLIES TO SELECTION'],
      'an unfiltered menu is the catalogue, grouped by what the commands do');
    // The vendored hint renders at most 64 rows (patched up from 8): the whole
    // catalogue has to fit, or the groups below the fold are unreachable.
    assert.ok(menu.rows >= 20, `the whole catalogue renders, got ${menu.rows} rows`);
    assert.ok(menu.syntax.every(Boolean), 'every row carries its syntax hint');
    assert.ok(menu.icons.every(Boolean), 'and its glyph');
    for (const label of ['Text', 'Heading 1–6', 'Raw HTML', 'Entity', 'Space / workspace', 'Bold', 'Link']) {
      assert.ok(menu.labels.includes(label), `the menu is missing: ${label}`);
    }
    await page.close();
  });

  test('typing promotes the best matches into an INSERT group, keeping the rest', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${freshEntity()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.type('/ta');
    await page.waitForSelector('.vditor-hint button', { state: 'visible' });
    const menu = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('.vditor-hint .slash-group')].map((g) => g.textContent),
      labels: [...document.querySelectorAll('.vditor-hint .slash-item b')].map((b) => b.textContent),
    }));
    assert.equal(menu.groups[0], 'INSERT', 'matches lead the menu');
    assert.deepEqual(menu.labels.slice(0, 2).sort(), ['Table', 'Task list'],
      'and they are the rows whose names start with what was typed');
    // A query narrows the top of the menu without emptying the rest of it:
    // a near-miss must never leave the writer with nothing to pick.
    assert.ok(menu.groups.includes('ALL COMMANDS'), 'the catalogue stays underneath');
    assert.ok(menu.labels.includes('Quote'), 'including commands that do not match at all');
    await page.close();
  });

  test('a format command wraps what was selected, not a placeholder', async () => {
    const page = await browser.newPage();
    const id = freshEntity('Selection case');
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.evaluate(() => {
      const ed = window.__weaveEditors.values().next().value;
      ed.setValue('vermilion');
      ed.focus();
    });
    /* Select the line, the way a writer would before reaching for bold.
       Typing "/" then replaces the selection — which is exactly why the menu
       has to have remembered it. (A dblclick lands on the padding as often as
       the word in a one-line document, so the keyboard does the selecting.) */
    await page.click('.vditor-ir [contenteditable="true"] p');
    await page.keyboard.press('End');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Home');
    await page.keyboard.up('Shift');
    await page.keyboard.type('/bold');
    await page.waitForSelector('.vditor-hint button', { state: 'visible' });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const markdown = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.getValue());
    assert.match(markdown, /\*\*vermilion\*\*/, `expected the selection wrapped, got ${JSON.stringify(markdown)}`);
    assert.doesNotMatch(markdown, /\*\*text\*\*/, 'the placeholder is the fallback, not the answer');
    await page.close();
  });

  test('a table reference is picked from search and resolves to a live chip', async () => {
    const page = await browser.newPage();
    const id = freshEntity('Table ref case');
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.evaluate(() => {
      const ed = window.__weaveEditors.values().next().value;
      ed.setValue('');
      ed.focus();
    });
    await page.click('.vditor-ir [contenteditable="true"]');
    // The alias, because "table" itself belongs to the block that inserts one.
    await page.keyboard.type('/link table');
    await page.waitForSelector('.vditor-hint button', { state: 'visible' });
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cmdk', { state: 'visible' });
    await page.keyboard.type('Note');
    await page.waitForSelector('#cmdk-results .result-main');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const markdown = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.getValue());
    assert.match(markdown, /\[\[table:[^\]]+\]\]/, `expected a table reference, got ${JSON.stringify(markdown)}`);

    let html = '';
    for (let i = 0; i < 40 && !html.includes('mention'); i++) {
      await page.waitForTimeout(50);
      await page.evaluate(() => window.__weaveFlushDocSaves?.());
      html = await (await fetch(`${base}/e/${id}/doc.html`)).text();
    }
    assert.match(html, /class="mention mention-table"/, 'the reference must render as a live table chip');
    assert.doesNotMatch(html, /class="mention broken"/);
    await page.close();
  });
}
