import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const FIDELITY = [
  '# Buyer notes',
  '',
  'First paragraph to edit.',
  '',
  '| Merchant | Price |',
  '| --- | --- |',
  '| Direct | $939 |',
  '',
  '**Cashback portals**<br>*none found*',
  '',
  'Some _emphasis_, ~strike~ and a \\~tilde.',
  '',
  '* star bullet',
  '* second star',
  '',
  '1) paren list',
  '2) second',
  '',
  '<iframe class="wv-file" src="/api/files/x" title="a.pdf"></iframe>',
  '',
  '***',
  '',
  'Last paragraph.',
  '',
].join('\n');
const LONG = '# Notes\n\n' + Array.from({ length: 30 }, (_, i) => `Line ${i} of filler text.`).join('\n\n') + '\n';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==';

for (const engine of ['chromium', 'webkit']) {
  let tableRef;
  const s = await launch(`tiptap editor (${engine})`, (weave) => {
    weave.createSpace({ name: 'Scratch' });
    tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
  }, { engine });
  if (!s) continue;
  const { base, browser, weave } = s;
  const ROOT = '.wv-tiptap .ProseMirror[contenteditable="true"]';
  const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

  async function open(name, doc = '', viewport = { width: 1280, height: 800 }) {
    const e = weave.createEntity(tableRef, { name });
    if (doc) weave.setDoc(e.id, doc, 'Description');
    const page = await browser.newPage({ viewport });
    await page.addInitScript(() => localStorage.setItem('weave.editor', 'tiptap'));
    await page.goto(`${base}/#/entity/${e.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ROOT, { timeout: 30000 });
    return { page, id: e.id, entity: e };
  }
  const focusEnd = async (page) => { await page.click(ROOT); await page.keyboard.press(`${MOD}+End`).catch(() => {}); await page.evaluate(() => [...window.__weaveEditors][0].tiptap.commands.focus('end')); };
  const press = async (page, key) => { await page.keyboard.press(key); await page.waitForTimeout(80); };
  async function saved(page, id, want) {
    await page.evaluate(() => window.__weaveFlushDocSaves());
    let doc = '';
    for (let i = 0; i < 40; i++) {
      doc = (await fetch(`${base}/api/entities/${id}`).then((r) => r.json())).docs?.Description ?? '';
      if (want.test(doc)) return doc;
      await page.waitForTimeout(100);
    }
    return doc;
  }
  const topResult = (page, name) => page.waitForFunction((n) => document.querySelector('#cmdk-results .result')?.textContent.includes(n), name, { timeout: 10000 });

  test(`${engine}: Tab nests a list item with the caret at its end and Shift+Tab brings it back`, async () => {
    const { page, id } = await open('Tab');
    try {
      await focusEnd(page);
      await page.keyboard.type('- alpha', { delay: 30 });
      await press(page, 'Enter');
      await page.keyboard.type('beta', { delay: 30 });
      await press(page, 'Tab');
      await page.keyboard.type('X', { delay: 30 });
      assert.match(await saved(page, id, /betaX/), /^- alpha\n\s+- betaX/m);
      await press(page, 'Shift+Tab');
      await page.keyboard.type('Y', { delay: 30 });
      assert.match(await saved(page, id, /betaXY/), /^- betaXY$/m);
    } finally { await page.close(); }
  });

  test(`${engine}: Return on an empty nested item moves up one level`, async () => {
    const { page, id } = await open('Nested return');
    try {
      await focusEnd(page);
      await page.keyboard.type('- alpha', { delay: 30 });
      await press(page, 'Enter');
      await page.keyboard.type('beta', { delay: 30 });
      await press(page, 'Tab');
      await press(page, 'Enter');
      await press(page, 'Enter');
      await page.keyboard.type('X', { delay: 30 });
      const doc = await saved(page, id, /X/);
      assert.match(doc, /^- X$/m);
      assert.match(doc, /^\s+- beta$/m);
    } finally { await page.close(); }
  });

  test(`${engine}: markdown shortcuts as you type: heading, quote, numbered, task, rule, code fence, bold`, async () => {
    const { page, id } = await open('Shortcuts');
    try {
      await focusEnd(page);
      const lines = [['## Title', 'Enter'], ['> quoted', 'Enter'], ['Enter'], ['1. first', 'Enter'], ['Enter'], ['[ ] todo', 'Enter'], ['Enter'], ['---'], ['```', 'Enter'], ['let x = 1']];
      for (const [text, key] of lines) {
        if (text === 'Enter') { await press(page, 'Enter'); continue; }
        await page.keyboard.type(text, { delay: 25 });
        if (key) await press(page, key);
      }
      await page.evaluate(() => [...window.__weaveEditors][0].tiptap.commands.focus('end'));
      await page.keyboard.press('ArrowDown').catch(() => {});
      const doc = await saved(page, id, /let x = 1/);
      assert.match(doc, /^## Title$/m, 'heading');
      assert.match(doc, /^> quoted$/m, 'quote');
      assert.match(doc, /^1\. first$/m, 'numbered list');
      assert.match(doc, /^- \[ \] todo$/m, 'task item');
      assert.match(doc, /^---$/m, 'rule');
      assert.match(doc, /```\w*\nlet x = 1\n```/, 'code block');
    } finally { await page.close(); }
  });

  test(`${engine}: ${'⌘'}B bolds a selection and the bubble toolbar shows on a selection only`, async () => {
    const { page, id } = await open('Bold', 'Make this bold now.\n');
    try {
      await page.click(`${ROOT} p`);
      assert.equal(await page.locator('.wv-bubble').isVisible(), false, 'a bare caret shows no bubble');
      await page.evaluate(() => {
        const tt = [...window.__weaveEditors][0].tiptap;
        let at = 0;
        tt.state.doc.descendants((n, pos) => { if (n.isText && n.text.includes('bold')) at = pos + n.text.indexOf('bold'); });
        tt.chain().focus().setTextSelection({ from: at, to: at + 4 }).run();
      });
      await page.waitForSelector('.wv-bubble', { state: 'visible', timeout: 5000 });
      await press(page, `${MOD}+b`);
      assert.match(await saved(page, id, /\*\*bold\*\*/), /Make this \*\*bold\*\* now\./);
      await page.locator('.wv-bubble-btn[data-mark="italic"]').click();
      assert.match(await saved(page, id, /\*\*\*bold\*\*\*|_\*\*bold\*\*_|\*\*_bold_\*\*|\*\*\*bold\*\*\*/), /bold/);
    } finally { await page.close(); }
  });

  test(`${engine}: /code puts the caret inside the new code block, /divider puts it on a new line under the rule`, async () => {
    const { page, id } = await open('Slash code', LONG);
    try {
      await page.click(`${ROOT} p:has-text("Line 10 of")`);
      await page.keyboard.press('End');
      await press(page, 'Enter');
      await page.keyboard.type('/code', { delay: 30 });
      await page.waitForSelector('.wv-slash', { timeout: 10000 });
      await press(page, 'Enter');
      await page.keyboard.type('let x = 1', { delay: 30 });
      assert.match(await saved(page, id, /let x = 1/), /```\w*\nlet x = 1\n```/);
      await page.click(`${ROOT} p:has-text("Line 20 of")`);
      await page.keyboard.press('End');
      await press(page, 'Enter');
      await page.keyboard.type('/divider', { delay: 30 });
      await page.waitForSelector('.wv-slash', { timeout: 10000 });
      await press(page, 'Enter');
      await page.keyboard.type('After', { delay: 30 });
      assert.match(await saved(page, id, /After/), /Line 20 of filler text\.\n\n---\n\nAfter\n\nLine 21 of filler text\./);
    } finally { await page.close(); }
  });

  test(`${engine}: a stored [[reference]] renders as a chip, typing [[ and the slash Entity item both pick one`, async () => {
    const target = weave.createEntity(tableRef, { name: 'Bluefin' });
    weave.createEntity(tableRef, { name: 'Marlin' });
    const { page, id } = await open('Refs', `See [[Note#${target.publicId}]] here.\n`);
    try {
      const chip = page.locator('.wv-tiptap .wv-ref-chip a.mention');
      await chip.waitFor({ timeout: 10000 });
      assert.equal((await chip.textContent()).trim(), 'Bluefin');
      await focusEnd(page);
      await press(page, 'Enter');
      await page.keyboard.type('Ask [[', { delay: 30 });
      await page.waitForSelector('#cmdk-input:focus', { timeout: 10000 });
      await page.keyboard.type('Marlin', { delay: 30 });
      await topResult(page, 'Marlin');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
      await press(page, 'Enter');
      await page.keyboard.type('/entity', { delay: 30 });
      await page.waitForSelector('.wv-slash', { timeout: 10000 });
      await press(page, 'Enter');
      await page.waitForSelector('#cmdk-input:focus', { timeout: 10000 });
      await page.keyboard.type('Bluefin', { delay: 30 });
      await topResult(page, 'Bluefin');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
      const doc = await saved(page, id, /Marlin[\s\S]*Bluefin\]\]\s*$/);
      assert.match(doc, new RegExp(`^See \\[\\[Note#${target.publicId}\\]\\] here\\.$`, 'm'), 'the stored reference keeps its text');
      assert.match(doc, /^Ask \[\[[^\]\n]*#\d+\|Marlin\]\]$/m);
      assert.match(doc, /^\[\[[^\]\n]*#\d+\|Bluefin\]\]$/m);
      assert.doesNotMatch(doc, /\\\[|\\\]/, 'no escaped brackets');
    } finally { await page.close(); }
  });

  test(`${engine}: pasted and dropped files attach to the record and land as an image and a link`, async () => {
    for (const how of ['paste', 'drop']) {
      const { page, id } = await open(`Upload ${how}`);
      try {
        await focusEnd(page);
        await page.keyboard.type('Files:', { delay: 30 });
        await page.evaluate(({ how, png }) => {
          const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
          const data = new DataTransfer();
          data.items.add(new File([bytes], 'dot.png', { type: 'image/png' }));
          data.items.add(new File(['plain words\n'], 'read.txt', { type: 'text/plain' }));
          const target = document.querySelector('.wv-tiptap .ProseMirror');
          target.dispatchEvent(how === 'paste'
            ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
            : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
        }, { how, png: PNG_B64 });
        const doc = await saved(page, id, /!\[[^\]]*\]\([^)]*\/api\/files\/[\w-]+\)[\s\S]*\[read\.txt\]/);
        assert.match(doc, /!\[[^\]]*\]\([^)]*\/api\/files\/[\w-]+\)/, `${how}: the png lands as an image`);
        assert.match(doc, /\[read\.txt\]\([^)]*\/api\/files\/[\w-]+\)/, `${how}: the text file lands as a link`);
        assert.equal(weave.readEntity(id).files.length, 2);
      } finally { await page.close(); }
    }
  });

  test(`${engine}: an edit leaves every block it did not touch byte for byte, raw HTML and <br> included`, async () => {
    const { page, id } = await open('Fidelity', FIDELITY);
    try {
      await page.click(`${ROOT} p:has-text("First paragraph")`);
      await page.keyboard.press('End');
      await page.keyboard.type(' Edited.', { delay: 30 });
      assert.equal(await saved(page, id, /Edited\./), FIDELITY.replace('First paragraph to edit.', 'First paragraph to edit. Edited.'));
      await page.click(`${ROOT} p:has-text("Last paragraph")`);
      await page.keyboard.press('End');
      await page.keyboard.type(' More.', { delay: 30 });
      assert.equal(await saved(page, id, /More\./), FIDELITY.replace('First paragraph to edit.', 'First paragraph to edit. Edited.').replace('Last paragraph.', 'Last paragraph. More.'));
      await page.click(`${ROOT} li:has-text("second star")`);
      await page.keyboard.press('End');
      await press(page, 'Enter');
      await press(page, 'Enter');
      await page.keyboard.type('Between lists.', { delay: 30 });
      const third = await saved(page, id, /Between lists\./);
      assert.ok(third.includes('* star bullet\n* second star\n\nBetween lists.\n\n1) paren list\n2) second'), `a new block between untouched ones changes nothing else:\n${third}`);
      assert.ok(third.startsWith('# Buyer notes\n\nFirst paragraph to edit. Edited.\n\n| Merchant | Price |\n| --- | --- |\n| Direct | $939 |'), 'the table keeps its text');
      assert.ok(third.endsWith('***\n\nLast paragraph. More.\n'), 'the tail keeps its text');
      const shown = await page.evaluate(() => document.querySelector('.wv-tiptap .ProseMirror').innerText);
      assert.doesNotMatch(shown, /<br/, '<br> shows as a line break');
      assert.match(shown, /<iframe class="wv-file"/, 'the raw HTML block stays visible as source');
    } finally { await page.close(); }
  });

  test(`${engine}: a click in a table cell puts the caret there, so typing joins the cell text`, async () => {
    const { page, id } = await open('Cell', FIDELITY);
    try {
      const at = await page.evaluate(() => {
        const td = [...document.querySelectorAll('.wv-tiptap td')].find((t) => t.textContent.includes('Direct'));
        const range = document.createRange();
        range.selectNodeContents(td.querySelector('p') ?? td);
        const r = range.getClientRects()[0];
        return [r.right - 1, r.top + r.height / 2];
      });
      await page.mouse.click(at[0], at[1]);
      await page.waitForTimeout(150);
      await page.keyboard.type('X', { delay: 30 });
      assert.match(await saved(page, id, /X/), /\| DirectX/);
    } finally { await page.close(); }
  });

  test(`${engine}: Return and the slash menu leave the page where it was, and arrows scroll the menu only as rows run out`, async () => {
    const { page } = await open('Still', LONG, { width: 1184, height: 793 });
    try {
      await page.click(`${ROOT} p:has-text("Line 10 of")`);
      await page.keyboard.press('End');
      const before = await page.evaluate(() => document.querySelector('#main').scrollTop);
      await press(page, 'Enter');
      await page.keyboard.type('/', { delay: 40 });
      await page.waitForSelector('.wv-slash');
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => document.querySelector('#main').scrollTop);
      assert.ok(Math.abs(after - before) <= 40, `the page held still: ${before} then ${after}`);
      const tops = [];
      for (let i = 0; i < 14; i++) {
        await press(page, 'ArrowDown');
        tops.push(await page.evaluate(() => {
          const box = document.querySelector('.wv-slash');
          const row = box.querySelector('.wv-slash-row.on').getBoundingClientRect();
          const b = box.getBoundingClientRect();
          return { top: Math.round(box.scrollTop), inside: row.top >= b.top - 1 && row.bottom <= b.bottom + 1 };
        }));
      }
      assert.equal(tops[0].top, 0, 'the list stays put while rows are in view');
      assert.ok(tops.every((t) => t.inside), 'the active row is always fully visible');
    } finally { await page.close(); }
  });

  test(`${engine}: the outline rail, heading folds and title echo work`, async () => {
    const doc = '# Folds\n\n## Fold me\n\nhidden one\n\n### Deeper\n\nalso hidden\n\n## After\n\nvisible\n\n' + 'filler\n\n'.repeat(30) + '## Last\n\nend\n';
    const { page } = await open('Folds', doc);
    try {
      await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
      const labels = await page.$$eval('.doc-rail-dash', (ns) => ns.map((n) => n.getAttribute('aria-label')));
      assert.deepEqual(labels, ['Fold me', 'Deeper', 'After', 'Last']);
      assert.ok(await page.evaluate(() => {
        const h = document.querySelector('.wv-tiptap .ProseMirror > h1');
        return h.classList.contains('wv-title-echo') && h.offsetParent === null;
      }), 'the heading that repeats the record name hides');
      await page.waitForSelector('.doc-fold-layer .doc-fold', { timeout: 20000 });
      await page.evaluate(() => document.querySelectorAll('.doc-fold')[0].click());
      await page.waitForFunction(() => [...document.querySelectorAll('.wv-tiptap .wv-folded')].some((b) => b.textContent.includes('hidden one') && b.offsetParent === null), null, { timeout: 10000 });
    } finally { await page.close(); }
  });
}
