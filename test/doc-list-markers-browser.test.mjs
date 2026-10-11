import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table;
const s = await launch('list markers convert on the space', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Note' });
});

if (s) {
  const { browser, base, weave } = s;
  let n = 0;

  const open = async (doc = '') => {
    const id = weave.createEntity(table, { name: `Row ${++n}`, doc }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const surface = page.locator('.doc-section[data-doc-field="Description"] .vditor-ir [contenteditable="true"]');
    await surface.waitFor();
    return { id, page, surface };
  };

  const settled = async (id, want) => {
    for (let i = 0; i < 60 && (weave.getDoc(id, 'Description') ?? '') !== want; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return weave.getDoc(id, 'Description') ?? '';
  };

  const saved = async (page, surface, id, want) => {
    await surface.evaluate((node) => node.blur());
    await page.evaluate(() => window.__weaveFlushDocSaves());
    return settled(id, want);
  };

  const shape = (surface) => surface.evaluate((root) => {
    const list = root.querySelector(':scope > ul, :scope > ol');
    const li = list?.querySelector(':scope > li');
    const sel = getSelection();
    const at = sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    return {
      tag: list?.tagName ?? null,
      start: list?.getAttribute('start') ?? null,
      marker: li?.getAttribute('data-marker') ?? null,
      task: li?.classList.contains('vditor-task') ?? false,
      checked: li?.querySelector('input[type=checkbox]')?.checked ?? null,
      text: (li?.textContent ?? '').replace(/[\u200b\s]/g, ''),
      caretInItem: !!li && li.contains(at),
      paragraphs: [...root.querySelectorAll(':scope > p')].map((p) => p.textContent),
    };
  });

  const cases = [
    { typed: '- ', tag: 'UL', marker: '-', after: 'Buy milk', want: '- Buy milk\n' },
    { typed: '* ', tag: 'UL', marker: '*', after: 'Buy milk', want: '* Buy milk\n' },
    { typed: '+ ', tag: 'UL', marker: '+', after: 'Buy milk', want: '+ Buy milk\n' },
    { typed: '1. ', tag: 'OL', marker: '1.', after: 'First step', want: '1. First step\n' },
    { typed: '7) ', tag: 'OL', marker: '7)', start: '7', after: 'Seventh step', want: '7) Seventh step\n' },
  ];

  for (const c of cases) {
    test(`"${c.typed}" becomes a list item on the space, not on Return (Issue #750)`, async () => {
      const { id, page, surface } = await open();
      try {
        await surface.click();
        await page.keyboard.type(c.typed);
        const got = await shape(surface);
        assert.equal(got.tag, c.tag, `the paragraph became a list: ${JSON.stringify(got)}`);
        assert.equal(got.marker, c.marker);
        if (c.start) assert.equal(got.start, c.start, 'the list starts at the typed number');
        assert.equal(got.text, '', 'the new item is empty');
        assert.ok(got.caretInItem, 'the caret sits inside the new item');
        assert.deepEqual(got.paragraphs, [], 'no paragraph keeps the marker text');
        await page.keyboard.type(c.after);
        assert.equal(await saved(page, surface, id, c.want), c.want);
      } finally { await page.close(); }
    });
  }

  for (const [typed, checked, want] of [['- [ ] ', false, '- [ ] Ship it\n'], ['- [x] ', true, '- [x] Ship it\n']]) {
    test(`"${typed}" becomes a task item on the space (Issue #750)`, async () => {
      const { id, page, surface } = await open();
      try {
        await surface.click();
        await page.keyboard.type(typed);
        const got = await shape(surface);
        assert.equal(got.tag, 'UL', JSON.stringify(got));
        assert.ok(got.task, `the item is a task: ${JSON.stringify(got)}`);
        assert.equal(got.checked, checked);
        assert.equal(got.text, '', 'the box text is gone from the item');
        assert.ok(got.caretInItem, 'the caret sits inside the new item');
        await page.keyboard.type('Ship it');
        assert.equal(await saved(page, surface, id, want), want);
      } finally { await page.close(); }
    });
  }

  test('the conversion runs the editor\'s input path, so a save follows the space alone (Issue #750)', async () => {
    const { page, surface } = await open('Intro\n');
    const puts = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/doc')) puts.push(r.postData()); });
    try {
      await page.click('.doc-section[data-doc-field="Description"] .vditor-reset > p:first-of-type');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('-');
      for (let i = 0; i < 60 && !puts.some((d) => d.includes('-')); i++) await page.waitForTimeout(50);
      await page.waitForTimeout(500);
      const before = puts.length;
      await page.keyboard.type(' ');
      assert.equal((await shape(surface)).tag, 'UL');
      for (let i = 0; i < 80 && puts.length === before; i++) await page.waitForTimeout(50);
      assert.ok(puts.length > before, 'a save went out after the space with no other keystroke and no blur');
    } finally { await page.close(); }
  });

  test('Backspace at the start of a just-converted item gives back the typed marker (Issue #750)', async () => {
    const { page, surface } = await open();
    try {
      await surface.click();
      await page.keyboard.type('1. ');
      assert.equal((await shape(surface)).tag, 'OL');
      await page.keyboard.press('Backspace');
      const got = await shape(surface);
      assert.equal(got.tag, null, `the list is gone: ${JSON.stringify(got)}`);
      assert.deepEqual(got.paragraphs, ['1. ']);
      const caret = await surface.evaluate((root) => {
        const sel = getSelection();
        const r = document.createRange();
        r.setStart(root.querySelector(':scope > p'), 0);
        r.setEnd(sel.anchorNode, sel.anchorOffset);
        return r.toString();
      });
      assert.equal(caret, '1. ', 'the caret sits after the restored marker');
    } finally { await page.close(); }
  });

  test('a marker typed inside a code block stays code (Issue #750)', async () => {
    const { page, surface } = await open('```\nx\n```\n');
    try {
      await surface.evaluate((root) => {
        root.focus();
        const code = root.querySelector('[data-type="code-block"] .vditor-ir__marker--pre code');
        const text = [...code.childNodes].find((c) => c.nodeType === 3);
        text.textContent = '';
        const r = document.createRange();
        r.setStart(text, 0);
        r.collapse(true);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
      });
      await page.keyboard.type('- ');
      const lists = await surface.evaluate((root) => root.querySelectorAll('ul, ol').length);
      assert.equal(lists, 0, 'no list appeared inside or beside the code block');
      const code = await surface.evaluate((root) => root.querySelector('[data-type="code-block"] .vditor-ir__marker--pre code').textContent);
      assert.match(code, /^- /, 'the marker text stays in the code');
    } finally { await page.close(); }
  });
}
