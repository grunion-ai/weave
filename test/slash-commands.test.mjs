import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch } from './lib/browser.mjs';

const slash = test.suite ?? test;

let dir, tableRef;
const s = await launch('slash commands', (weave) => {
  dir = mkdtempSync(join(tmpdir(), 'weave-slash-'));
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
  weave.createEntity(tableRef, { name: 'Zebrafish target' });
});
if (s) {
  const { base, browser, weave } = s;
  test.after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  function freshEntity(name = 'Slash case') {
    return weave.createEntity(tableRef, { name }).id;
  }

  const hintFiltered = (page) => page.waitForFunction(() => {
    const first = document.querySelector('.vditor-hint:not(.vditor-panel--arrow) button');
    return !!first && !/^ALL COMMANDS/.test(first.textContent.trim());
  }, null, { timeout: 15000 });

  async function hintSettled(page) {
    let seen = null;
    for (let i = 0; i < 60; i++) {
      const now = await page.$$eval('.vditor-hint:not(.vditor-panel--arrow) button',
        (ns) => ns.map((n) => n.textContent).join('\u0000'));
      if (seen !== null && now === seen) return now;
      seen = now;
      await page.waitForTimeout(50);
    }
    return seen;
  }

  async function scrollStopped(page, quiet = 250) {
    await page.evaluate(() => {
      if (!window.__scrollMark) {
        window.__scrollMark = () => { window.__scrolledAt = performance.now(); };
        document.addEventListener('scroll', window.__scrollMark, { capture: true, passive: true });
      }
      window.__scrollMark();
    });
    await page.waitForFunction((ms) => performance.now() - window.__scrolledAt > ms,
      quiet, { timeout: 15000, polling: 50 });
  }

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
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
    await hintFiltered(page);
    const label = await page.textContent('.vditor-hint:not(.vditor-panel--arrow) button');
    await page.keyboard.press('Enter');
    let markdown = '';
    for (let i = 0; i < 30; i++) {
      const now = await page.evaluate(() =>
        window.__weaveEditors.values().next().value.getValue());
      if (i && now === markdown && !/⁣/.test(now)) break;
      markdown = now;
      await page.waitForTimeout(50);
    }
    return { label: label.trim(), markdown };
    } finally { await page.close(); }
  }

  const CASES = [
    ['text', /^Text$/m],
    ['head', /^# /m],
    ['heading 2', /^## /m],
    ['heading 3', /^### /m],
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
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
    await hintSettled(page);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cmdk', { state: 'visible' });
    await page.keyboard.type('Zebrafish');
    await page.waitForSelector('#cmdk-results[data-query="Zebrafish"] [role="option"]');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const markdown = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.getValue());
    assert.match(markdown, /\[\[[^\]]+#\d+(\|[^\]]+)?\]\]/,
      `expected a [[Table#id]] reference, got: ${JSON.stringify(markdown)}`);

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

  test('the menu is grouped, and every row shows the syntax it writes', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${freshEntity()}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.type('/');
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
    await hintSettled(page);

    const menu = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) .slash-group')].map((g) => g.textContent),
      rows: document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) button').length,
      labels: [...document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) .slash-item b')].map((b) => b.textContent),
      syntax: [...document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) .slash-item')]
        .map((i) => i.querySelector('.slash-syntax')?.textContent ?? null),
      icons: [...document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) .slash-item')]
        .map((i) => {
          const slot = i.querySelector('.slash-icon');
          return slot ? (slot.querySelector('svg') ? 'svg' : slot.textContent) : null;
        }),
    }));

    assert.deepEqual(menu.groups, ['ALL COMMANDS', 'REFERENCE', 'FORMAT · APPLIES TO SELECTION'],
      'an unfiltered menu is the catalogue, grouped by what the commands do');
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
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
    await hintSettled(page);
    const menu = await page.evaluate(() => ({
      groups: [...document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) .slash-group')].map((g) => g.textContent),
      labels: [...document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) .slash-item b')].map((b) => b.textContent),
    }));
    assert.equal(menu.groups[0], 'INSERT', 'matches lead the menu');
    assert.deepEqual(menu.labels.slice(0, 2).sort(), ['Table', 'Task list'],
      'and they are the rows whose names start with what was typed');
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
    await page.click('.vditor-ir [contenteditable="true"] p');
    await page.keyboard.press('End');
    await page.keyboard.down('Shift');
    await page.keyboard.press('Home');
    await page.keyboard.up('Shift');
    await page.keyboard.type('/bold');
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
    await hintSettled(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const markdown = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.getValue());
    assert.match(markdown, /\*\*vermilion\*\*/, `expected the selection wrapped, got ${JSON.stringify(markdown)}`);
    assert.doesNotMatch(markdown, /\*\*text\*\*/, 'the placeholder is the fallback, not the answer');
    await page.close();
  });

  async function convertLine(md, query, { sel = null, back = 0, then = null, recorded = false } = {}) {
    const id = freshEntity('Convert case');
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.vditor-ir [contenteditable="true"]');
      await page.evaluate(({ md, sel, back }) => {
        const ed = window.__weaveEditors.values().next().value;
        ed.setValue(md);
        ed.focus();
        if (!md) return;
        const root = document.querySelector('.vditor-ir .vditor-reset');
        const block = sel ? root.querySelector(sel) : root.lastElementChild;
        const texts = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let last = null;
        for (let n = texts.nextNode(); n; n = texts.nextNode()) {
          if (n.textContent.trim() && n.parentElement.closest('li, [data-block]') === block.closest('li, [data-block]')) last = n;
        }
        const range = document.createRange();
        range.setStart(last, last.textContent.replace(/\n$/, '').length - back);
        range.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }, { md, sel, back });
      if (!md) await page.click('.vditor-ir [contenteditable="true"]');
      if (recorded) {
        await page.waitForFunction((text) =>
          window.__weaveEditors.values().next().value.vditor.undo.ir.lastText.includes(text),
        md, { timeout: 15000, polling: 100 });
      }
      await page.keyboard.type(md ? ` /${query}` : `/${query}`);
      await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
      await hintFiltered(page);
      const label = (await page.textContent('.vditor-hint:not(.vditor-panel--arrow) button')).trim();
      await page.keyboard.press('Enter');
      let markdown = null;
      for (let i = 0; i < 60; i++) {
        const now = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
        if (now === markdown && !/\u2063/.test(now) && !now.includes(`/${query}`)) break;
        markdown = now;
        await page.waitForTimeout(50);
      }
      const caret = await page.evaluate(() => {
        const s = getSelection();
        if (!s.rangeCount) return null;
        const r = s.getRangeAt(0);
        const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
        const block = el.closest('li, [data-block]');
        if (!block) return null;
        const before = document.createRange();
        before.selectNodeContents(block);
        before.setEnd(r.startContainer, r.startOffset);
        const own = [...block.childNodes].filter((n) => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName)))
          .map((n) => n.textContent).join('');
        return { collapsed: r.collapsed, before: before.toString().trim(), line: own.trim(), inEditor: !!el.closest('.vditor-ir') };
      });
      await page.evaluate(() => window.__weaveFlushDocSaves());
      let saved = null;
      for (let i = 0; i < 40; i++) {
        saved = await (await fetch(`${base}/e/${id}/doc.md`)).text();
        if (saved.trim() === markdown.trim()) break;
        await page.waitForTimeout(50);
      }
      const after = then ? await then(page) : null;
      return { label, markdown, caret, saved, after };
    } finally { await page.close(); }
  }

  const said = (r) => `chose "${r.label}" and produced:\n${JSON.stringify(r.markdown)}`;

  const CONVERSIONS = [
    ['a paragraph becomes a task', 'Buy milk', 'task', {}, /^- \[ \] +Buy milk$/m, /To do|^Buy milk/m],
    ['a heading becomes a task', '## Plan', 'task', {}, /^- \[ \] +Plan$/m, /To do|^#/m],
    ['a task becomes a heading', '- [ ] Plan', 'h2', { sel: 'li' }, /^## Plan$/m, /Heading|\[ \]/],
    ['a paragraph becomes a quote', 'Buy milk', 'quote', {}, /^> Buy milk$/m, /Quote|^Buy milk/m],
    ['a bulleted item becomes a numbered one', '- Buy milk', 'number', { sel: 'li' }, /^1\. Buy milk$/m, /List item|^- /m],
    ['Text on a heading gives a paragraph', '## Plan', 'text', {}, /^Plan$/m, /^Text$|#/m],
    ['inline marks stay', '**Buy** `milk`', 'h3', {}, /^### \*\*Buy\*\* `milk`$/m, /Heading/],
  ];

  for (const [name, md, query, options, expected, gone] of CONVERSIONS) {
    test(`convert: ${name}`, async () => {
      const r = await convertLine(md, query, options);
      assert.match(r.markdown, expected, `"${md}" + "/${query}" ${said(r)}`);
      assert.doesNotMatch(r.markdown, gone, `nothing is left behind and no placeholder arrives: ${said(r)}`);
      assert.equal(r.markdown.trim().split('\n').filter(Boolean).length, 1, `one line in, one line out: ${said(r)}`);
      assert.doesNotMatch(r.markdown, /\u2063/, 'the marker never stays in the document');
      assert.ok(r.caret?.inEditor && r.caret.collapsed, 'the caret is back in the document');
      assert.equal(r.caret.before, r.caret.line, 'at the end of the converted line');
      assert.equal(r.saved.trim(), r.markdown.trim(), 'and the conversion is what was saved');
    });
  }

  test('convert: the words on both sides of the caret survive', async () => {
    const r = await convertLine('Buy milk today', 'task', { back: ' today'.length });
    assert.match(r.markdown, /^- \[ \] +Buy milk +today$/m, said(r));
    assert.doesNotMatch(r.markdown, /To do|\u2063/, said(r));
    assert.equal(r.caret.before, r.caret.line, 'the caret goes to the end of the line, past the words that were after it');
  });

  test('convert: a nested item keeps its indent between list types', async () => {
    const r = await convertLine('- one\n  - two', 'number', { sel: 'li li' });
    assert.match(r.markdown, /^- one$/m, `the parent item is untouched: ${said(r)}`);
    assert.match(r.markdown, /^ {2,4}1\. two$/m, `the nested item is numbered where it was: ${said(r)}`);
    assert.doesNotMatch(r.markdown, /List item|\u2063/, said(r));
    assert.equal(r.caret.line, 'two');
    assert.equal(r.caret.before, 'two', 'the caret is at the end of the nested item');
  });

  test('convert: only the line the command ran on changes', async () => {
    const r = await convertLine('# Title\n\nBuy milk\n\nLast line', 'task', { sel: 'p' });
    assert.match(r.markdown, /^# Title\n\n- \[ \] +Buy milk\n\nLast line\n?$/, said(r));
    assert.equal(r.caret.before, 'Buy milk', 'the caret stays on the line that was converted');
  });

  test('convert: the next keystroke lands at the end of the converted line', async () => {
    const r = await convertLine('Buy milk', 'task', {
      then: async (page) => {
        await page.keyboard.type(' and eggs');
        return page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
      },
    });
    assert.match(r.after, /^- \[ \] +Buy milk and eggs\n?$/, `typed on and got ${JSON.stringify(r.after)}`);
  });

  test('convert: undo goes back to what was typed, never to the marker', async () => {
    const r = await convertLine('Buy milk', 'task', {
      recorded: true,
      then: async (page) => {
        const state = () => page.evaluate(() => {
          const v = window.__weaveEditors.values().next().value.vditor;
          return { depth: v.undo.ir.undoStack.length, last: v.undo.ir.lastText };
        });
        await page.waitForFunction(() =>
          /checkbox/.test(window.__weaveEditors.values().next().value.vditor.undo.ir.lastText),
        null, { timeout: 15000, polling: 100 });
        const converted = await state();
        await page.evaluate(() => {
          const v = window.__weaveEditors.values().next().value.vditor;
          v.undo.undo(v);
        });
        const undone = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
        return { converted, undone, then: await state() };
      },
    });
    assert.doesNotMatch(r.after.converted.last, /\u2063/, 'the state on the stack is the converted line');
    assert.doesNotMatch(r.after.undone, /\u2063|block:/, `undo never shows the marker, got ${JSON.stringify(r.after.undone)}`);
    assert.doesNotMatch(r.after.undone, /\[ \]/, `and the line is no longer a task, got ${JSON.stringify(r.after.undone)}`);
    assert.match(r.after.undone, /Buy milk/, 'the words are still there');
    assert.ok(r.after.then.depth < r.after.converted.depth, 'undo went down the stack and stayed there');
  });

  test('convert: an empty line still gets the marker and its placeholder', async () => {
    const r = await convertLine('', 'task');
    assert.match(r.markdown, /^- \[ \] +To do\n?$/, said(r));
    assert.equal(r.caret.before, 'To do', 'with the caret after the placeholder, where Vditor used to leave it');
    assert.equal(r.saved.trim(), r.markdown.trim());
  });

  test('convert: a block that is not a line prefix still inserts beside the text', async () => {
    const r = await convertLine('Buy milk', 'divider');
    assert.match(r.markdown, /Buy milk/, said(r));
    assert.match(r.markdown, /^(---|\*\*\*)$/m, said(r));
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
    await page.keyboard.type('/link table');
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
    await hintSettled(page);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cmdk', { state: 'visible' });
    await page.keyboard.type('Note');
    await page.waitForSelector('#cmdk-results[data-query="Note"] [role="option"]');
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

  test('# searches records under the caret and Enter drops the reference in', async () => {
    const page = await browser.newPage();
    const id = freshEntity('Hash search case');
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.evaluate(() => {
      const ed = window.__weaveEditors.values().next().value;
      ed.setValue('');
      ed.focus();
    });
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.type('Blocked by #zeb');
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible', timeout: 10000 });
    await hintSettled(page);
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow) .slash-item b')].map((b) => b.textContent));
    assert.ok(labels.some((l) => /Zebrafish/.test(l)), `expected the fixture record, got ${labels.join(' | ')}`);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    const highlighted = await page.evaluate(() =>
      document.querySelector('.vditor-hint--current .slash-item b')?.textContent);
    assert.ok(highlighted && labels.includes(highlighted), 'the highlight moved to another row');

    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const markdown = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.getValue());
    assert.match(markdown, /^Blocked by \[\[[^\]]+#\d+\|[^\]]+\]\]/,
      `the reference lands inline, got ${JSON.stringify(markdown)}`);

    await page.waitForTimeout(600);
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('.doc-ref-chip')].map((c) => getComputedStyle(c).backgroundColor));
    assert.equal(chips.length, 1, 'the reference renders as one chip');
    assert.doesNotMatch(chips[0], /rgba\(.*0\.0?\d+\)$/, 'an see-through chip shows the literal underneath');
    await page.close();
  });

  test('a heading is still a heading — # alone never opens a search', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${freshEntity('Heading case')}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.type('# Heading');
    await page.waitForTimeout(500);
    const open = await page.evaluate(() =>
      [...document.querySelectorAll('.vditor-hint:not(.vditor-panel--arrow)')].some((n) => getComputedStyle(n).display !== 'none'));
    assert.equal(open, false, 'the search must not hijack a heading');
    await page.close();
  });

  test('a fence with no language is detected, and a diagram source is not', async () => {
    const page = await browser.newPage();
    const id = freshEntity('Detect case');
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.evaluate(() => {
      const ed = window.__weaveEditors.values().next().value;
      ed.setValue('```\n{ "a": 1, "b": [true, null] }\n```\n\n```\ngraph TD\n  A --> B\n```\n');
      ed.focus();
    });
    let blocks = [];
    for (let i = 0; i < 120; i++) {
      blocks = await page.evaluate(() => [...document.querySelectorAll('.vditor-ir__preview > code')]
        .map((c) => ({ cls: c.className, spans: c.querySelectorAll('span').length })));
      if (blocks[0]?.spans > 0) break;
      await page.waitForTimeout(100);
    }
    assert.equal(blocks.length, 2, 'both fences render');
    assert.match(blocks[0].cls, /language-json/, 'JSON that parses is JSON');
    assert.ok(blocks[0].spans > 0, 'and it is tokenised');
    assert.equal(blocks[1].spans, 0, 'a mermaid source in a plain fence stays plain text');
    await page.close();
  });
  test('a wheel over the slash menu never scrolls the page out from under it', async () => {
    const id = freshEntity('Wheel case');
    weave.setDoc(id, '# Top\n\n' + 'filler line\n\n'.repeat(80) + 'end\n', 'Description');
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"] p');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await scrollStopped(page);
    const centred = await page.evaluate(() => {
      const n = getSelection().anchorNode;
      const el = n?.nodeType === 1 ? n : n?.parentElement;
      el?.scrollIntoView({ block: 'center' });
      return !!el;
    });
    assert.ok(centred, 'the caret is in the document');
    await scrollStopped(page);
    await page.keyboard.type('/');
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
    await hintSettled(page);
    await page.waitForFunction(() => {
      const h = document.querySelector('.vditor-hint:not(.vditor-panel--arrow)');
      return !!h && h.style.display !== 'none' && h.style.maxHeight !== '';
    }, null, { timeout: 10000 });
    const before = await page.evaluate(() => {
      const h = document.querySelector('.vditor-hint:not(.vditor-panel--arrow)');
      const r = h.getBoundingClientRect();
      return { y: Math.round(scrollY), h: Math.round(r.height), scrolls: h.scrollHeight > h.clientHeight, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    assert.ok(before.h <= 400, `the menu is capped short (${before.h}px)`);
    await page.mouse.move(before.cx, before.cy);
    const onMenu = await page.evaluate(([x, y]) =>
      !!document.elementFromPoint(x, y)?.closest('.vditor-hint'), [before.cx, before.cy]);
    assert.ok(onMenu, 'the pointer sits over the menu');
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 600);
    await scrollStopped(page);
    const after = await page.evaluate(() => ({
      y: Math.round(scrollY),
      shown: document.querySelector('.vditor-hint:not(.vditor-panel--arrow)').style.display !== 'none',
    }));
    assert.equal(after.y, before.y, 'the page did not move');
    assert.ok(after.shown, 'and the menu is still open');
    await page.close();
  });
  test('Enter in an 80-paragraph document keeps the page still, and the next / opens a menu that stays', async () => {
    const id = freshEntity('Enter scroll case');
    weave.setDoc(id, '# Top\n\n' + 'filler line\n\n'.repeat(80) + 'end\n', 'Description');
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"] p');
    const before = await page.evaluate(() => {
      const main = document.querySelector('main');
      window.__far = 0;
      window.__from = main.scrollTop;
      addEventListener('scroll', () => {
        window.__far = Math.max(window.__far, Math.abs(main.scrollTop - window.__from));
      }, { capture: true, passive: true });
      return { top: main.scrollTop, room: main.scrollHeight - main.clientHeight };
    });
    assert.ok(before.room > 1000, `the document is longer than the viewport (${before.room}px of it)`);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await scrollStopped(page);
    const moved = await page.evaluate(() => {
      const main = document.querySelector('main');
      const first = document.querySelector('.vditor-ir [contenteditable="true"] p');
      const r = first.getBoundingClientRect();
      return {
        far: Math.round(window.__far), now: Math.round(main.scrollTop),
        firstOnScreen: r.bottom > 0 && r.top < innerHeight,
      };
    });
    assert.ok(Math.abs(moved.now - before.top) <= 120,
      `Enter left the page where it was (from ${before.top}, furthest ${moved.far}px, now ${moved.now})`);
    assert.ok(moved.firstOnScreen, 'the paragraph the caret was in is still on screen');
    await page.keyboard.type('/');
    await page.waitForFunction(() =>
      !!document.querySelector('.vditor-hint:not(.vditor-panel--arrow) button'), null, { timeout: 15000 });
    await hintSettled(page);
    await scrollStopped(page);
    const menu = await page.evaluate(() => {
      const h = document.querySelector('.vditor-hint:not(.vditor-panel--arrow)');
      return { display: h.style.display, rows: h.querySelectorAll('button').length, y: Math.round(scrollY) };
    });
    assert.notEqual(menu.display, 'none', `the slash menu is still open at scrollY ${menu.y}`);
    assert.ok(menu.rows > 0, 'and it has its rows');
    await page.close();
  });
  test('a scroll the reader did not start leaves the slash menu open, and escape still closes it', async () => {
    const id = freshEntity('Menu scroll case');
    weave.setDoc(id, '# Top\n\n' + 'filler line\n\n'.repeat(80) + 'end\n', 'Description');
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"] p');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await scrollStopped(page);
    await page.keyboard.type('/');
    await page.waitForFunction(() =>
      !!document.querySelector('.vditor-hint:not(.vditor-panel--arrow) button'), null, { timeout: 15000 });
    await hintSettled(page);
    const shown = await page.evaluate(() => {
      const open = document.querySelector('.vditor-hint:not(.vditor-panel--arrow)').style.display;
      const main = document.querySelector('main');
      main.scrollTo({ top: main.scrollTop + 400, behavior: 'instant' });
      dispatchEvent(new Event('scroll'));
      return open;
    });
    assert.notEqual(shown, 'none', 'the menu was open before the scroll');
    await scrollStopped(page);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => {
      const h = document.querySelector('.vditor-hint:not(.vditor-panel--arrow)');
      return { display: h.style.display, rows: h.querySelectorAll('button').length };
    });
    assert.notEqual(after.display, 'none', 'a scroll nobody asked for left the menu open');
    assert.ok(after.rows > 0, 'with its rows');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() =>
      document.querySelector('.vditor-hint:not(.vditor-panel--arrow)').style.display === 'none',
      null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() =>
      document.querySelector('.vditor-hint:not(.vditor-panel--arrow)').style.display);
    assert.equal(closed, 'none', 'escape closes the menu and it stays closed');
    await page.close();
  });
  async function surfaceWhile(page, ms = 600) {
    const seen = [];
    const until = Date.now() + ms;
    while (Date.now() < until) {
      seen.push(await page.evaluate(() =>
        document.querySelector('.vditor-ir .vditor-reset').textContent));
    }
    return seen;
  }

  test('raw html: the marker is never painted, and the first undo goes back to the text before the command', async () => {
    const id = freshEntity('Raw html case');
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.type('First words');
    await page.waitForFunction(() =>
      window.__weaveEditors.values().next().value.vditor.undo.ir.lastText.includes('First words'),
    null, { timeout: 15000, polling: 100 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('/raw html');
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
    await hintFiltered(page);
    await page.keyboard.press('Enter');
    const painted = (await surfaceWhile(page)).filter((t) => t.includes('raw-html'));
    assert.equal(painted.length, 0, `the marker never reaches the surface, saw ${JSON.stringify(painted[0])}`);
    await page.waitForFunction(() =>
      /<div>html<\/div>/.test(window.__weaveEditors.values().next().value.getValue()),
    null, { timeout: 15000, polling: 50 });
    await page.waitForFunction(() =>
      /html/.test(window.__weaveEditors.values().next().value.vditor.undo.ir.lastText),
    null, { timeout: 15000, polling: 50 });
    const recorded = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.vditor.undo.ir.lastText);
    assert.doesNotMatch(recorded, /\u2063/, 'the state on the undo stack carries no marker');
    await page.evaluate(() => {
      const v = window.__weaveEditors.values().next().value.vditor;
      v.undo.undo(v);
    });
    const undone = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.getValue());
    assert.doesNotMatch(undone, /\u2063|raw-html/, `undo never shows the marker, got ${JSON.stringify(undone)}`);
    assert.match(undone, /First words/, 'the words typed before the command are still there');
    await page.close();
  });

  test('a reference command opens its picker on the keypress, and the undo after a pick never brings the marker back', async () => {
    const id = freshEntity('Ref timing case');
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.type('/link table');
    await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
    await hintSettled(page);
    await page.keyboard.press('Enter');
    const opened = await page.evaluate(async () => {
      const at = performance.now();
      for (let i = 0; i < 300; i++) {
        const box = document.querySelector('#cmdk');
        if (box && getComputedStyle(box).display !== 'none') return { ms: performance.now() - at };
        await new Promise((r) => setTimeout(r, 10));
      }
      return { ms: performance.now() - at, missing: true };
    });
    assert.ok(!opened.missing, 'the picker opened');
    assert.ok(opened.ms < 400, `the picker opened on the keypress, not on Vditor's 800ms timer (${Math.round(opened.ms)}ms)`);
    await page.keyboard.type('Note');
    await page.waitForSelector('#cmdk-results[data-query="Note"] [role="option"]');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() =>
      /\[\[table:/.test(window.__weaveEditors.values().next().value.getValue()),
    null, { timeout: 15000, polling: 50 });
    await page.waitForFunction(() =>
      /\[\[table:/.test(window.__weaveEditors.values().next().value.vditor.undo.ir.lastText),
    null, { timeout: 15000, polling: 50 });
    const recorded = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.vditor.undo.ir.lastText);
    assert.doesNotMatch(recorded, /\u2063/, 'the state on the undo stack carries no marker');
    await page.evaluate(() => {
      const v = window.__weaveEditors.values().next().value.vditor;
      v.undo.undo(v);
    });
    const undone = await page.evaluate(() =>
      window.__weaveEditors.values().next().value.getValue());
    assert.doesNotMatch(undone, /\u2063|ref:table/, `undo never shows the marker, got ${JSON.stringify(undone)}`);
    await page.close();
  });
}
