/* A code block's markdown source sits behind a </> toggle (Issue #96).

   Kyle, 2026-08-26, on a Description holding a mermaid diagram: "move show
   raw formatting behind a code icon in the upper righthand corner of the code
   panel and use this to hide and show". Vditor's IR mode expands a fenced
   block into its markdown the moment the caret enters it: the ``` fence and
   language line above the code, the closing fence below, and for a diagram
   the source in place of the drawing. His trace is six clicks on the diagram,
   each of which turned the picture back into text.

   What holds now, measured here in both themes: the caret in a block leaves
   it looking like itself (code stays code, a diagram stays a diagram), a
   </> button sits in the panel's upper right, and that button, and only that
   button, shows and hides the fence, the language and a diagram's source.
   Typing in the code with the fences hidden still writes the markdown.

   Playwright is NOT a dependency of weave; the suite skips without it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tableRef;

const s = await launch('code raw toggle', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
});

if (s) {
  const { base, browser, weave } = s;

  const JS_DOC = 'Intro\n\n```js\nconst x = 1;\n```\n\nEnd\n';
  const MERMAID_DOC = 'Intro\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nEnd\n';

  function entityWithDoc(name, md) {
    const e = weave.createEntity(tableRef, { name });
    weave.setDoc(e.id, md, 'Description');
    return e.id;
  }

  async function openEntity(id, theme = 'light') {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    return page;
  }

  // Waits for the debounced save to land and returns what the server holds.
  const settle = async (id, re) => {
    for (let i = 0; i < 60 && !re.test(weave.getDoc(id) ?? ''); i++) await new Promise((r) => setTimeout(r, 100));
    return weave.getDoc(id);
  };

  /* Everything the assertions read, in one pass: which parts of the block
     are on screen, where the toggle sits against the panel that is showing,
     and the colours it paints on that panel. */
  const readBlock = (page) => page.evaluate(() => {
    const node = document.querySelector('.vditor-ir [data-type="code-block"]');
    const shown = (n) => !!n && n.getClientRects().length > 0;
    const src = node.querySelector('pre.vditor-ir__marker--pre');
    const preview = node.querySelector('.vditor-ir__preview');
    const panel = [src, preview].find(shown);
    const btn = document.querySelector('button.doc-code-raw');
    const box = (n) => { const r = n?.getBoundingClientRect(); return r && { top: r.top, right: r.right, left: r.left, bottom: r.bottom, w: r.width, h: r.height }; };
    let bg = 'rgb(255, 255, 255)';
    for (let n = panel; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
    }
    return {
      expanded: node.classList.contains('vditor-ir__node--expand'),
      // Vditor draws the fences as the node's own ::before and ::after.
      fence: !/^(none|normal)$/.test(getComputedStyle(node, '::before').content),
      info: shown(node.querySelector('[data-type="code-block-info"]')),
      close: !/^(none|normal)$/.test(getComputedStyle(node, '::after').content),
      source: shown(src),
      preview: shown(preview),
      drawing: shown(preview?.querySelector('svg')),
      panel: box(panel),
      btn: shown(btn) ? box(btn) : null,
      pressed: btn?.getAttribute('aria-pressed') ?? null,
      label: btn?.getAttribute('title') ?? '',
      btnText: btn?.textContent.trim() ?? '',
      btnIcon: !!btn?.querySelector('.wv-icon svg'),
      btnColor: btn ? getComputedStyle(btn).color : '',
      bg,
    };
  });

  const contrast = (a, b) => {
    const lum = (c) => {
      const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map((n) => {
        const v = Number(n) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // The upper right of the panel on screen: inside it, near its top-right corner.
  const assertUpperRight = (r, where) => {
    assert.ok(r.btn, `${where}: the </> button is on screen`);
    assert.ok(r.btn.right <= r.panel.right + 0.5 && r.panel.right - r.btn.right <= 16,
      `${where}: the button hugs the panel's right edge (button right ${r.btn.right}, panel right ${r.panel.right})`);
    assert.ok(r.btn.top >= r.panel.top - 0.5 && r.btn.top - r.panel.top <= 12,
      `${where}: the button hugs the panel's top edge (button top ${r.btn.top}, panel top ${r.panel.top})`);
    assert.ok(r.btn.left > r.panel.left + r.panel.w / 2, `${where}: the button sits in the right half`);
  };

  for (const theme of ['light', 'dark']) {
    test(`the caret in a code block leaves the fence hidden, and </> shows and hides it (${theme})`, async () => {
      const id = entityWithDoc(`Toggle ${theme}`, JS_DOC);
      const page = await openEntity(id, theme);
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        await page.click('.vditor-ir__preview code');
        await page.waitForFunction(() => document.querySelector('.vditor-ir__node--expand[data-type="code-block"]'));
        await page.waitForSelector('button.doc-code-raw', { state: 'visible' });

        let r = await readBlock(page);
        assert.ok(r.expanded, 'the click put the caret in the block');
        assert.equal(r.fence, false, 'the opening ``` is not displayed');
        assert.equal(r.info, false, 'the language line is not displayed');
        assert.equal(r.close, false, 'the closing ``` is not displayed');
        assert.ok(r.source, 'the code itself stays on screen to edit');
        assertUpperRight(r, 'raw hidden');
        assert.ok(r.btnIcon, 'the button draws the inventory icon');
        assert.equal(r.btnText, '', 'the button is an icon, never a typed glyph or emoji');
        assert.match(r.label, /source/i, 'the button says what it does');
        assert.equal(r.pressed, 'false');
        const c = contrast(r.btnColor, r.bg);
        assert.ok(c >= 3, `${theme}: the icon (${r.btnColor}) reads on the slab (${r.bg}) at ${c.toFixed(2)}:1`);

        await page.click('button.doc-code-raw');
        await page.waitForFunction(() => document.querySelector('button.doc-code-raw')?.getAttribute('aria-pressed') === 'true');
        r = await readBlock(page);
        assert.ok(r.expanded, 'the click on the button keeps the caret in the block');
        assert.ok(r.fence && r.info && r.close, 'the fence, the language and the closing fence are on screen');
        assertUpperRight(r, 'raw shown');

        await page.click('button.doc-code-raw');
        await page.waitForFunction(() => document.querySelector('button.doc-code-raw')?.getAttribute('aria-pressed') === 'false');
        r = await readBlock(page);
        assert.ok(r.expanded, 'still editing the block');
        assert.equal(r.fence || r.info || r.close, false, 'a second click hides the raw lines again');
        assertUpperRight(r, 'raw hidden again');
      } finally { await page.close(); }
    });
  }

  test('typing in the code with the fence hidden writes the markdown', async () => {
    const id = entityWithDoc('Typing', JS_DOC);
    const page = await openEntity(id);
    try {
      await page.click('.vditor-ir__preview code');
      await page.waitForSelector('button.doc-code-raw', { state: 'visible' });
      await page.keyboard.press('End');
      await page.keyboard.type(' // hi');
      const saved = await settle(id, /\/\/ hi/);
      assert.match(saved, /```js\nconst x = 1; \/\/ hi\n```/, `the edit lands inside the fence: ${JSON.stringify(saved)}`);
      const r = await readBlock(page);
      assert.ok(r.expanded && r.source, 'the writer is still in the code');
      assert.equal(r.fence || r.info || r.close, false, 'typing does not bring the fence back');
    } finally { await page.close(); }
  });

  test('with the source shown, the language line edits the fence', async () => {
    const id = entityWithDoc('Language', JS_DOC);
    const page = await openEntity(id);
    try {
      await page.click('.vditor-ir__preview code');
      await page.waitForSelector('button.doc-code-raw', { state: 'visible' });
      await page.click('button.doc-code-raw');
      await page.waitForFunction(() => document.querySelector('button.doc-code-raw')?.getAttribute('aria-pressed') === 'true');
      await page.click('.vditor-ir__node--expand [data-type="code-block-info"]');
      await page.keyboard.press('End');
      await page.keyboard.type('x');
      const saved = await settle(id, /```jsx/);
      assert.match(saved, /```jsx\nconst x = 1;\n```/, `the language changed and the code did not: ${JSON.stringify(saved)}`);
      const r = await readBlock(page);
      assert.ok(r.info && r.fence, 'the raw lines stay open while the writer types in them');
      assert.equal(r.pressed, 'true');
    } finally { await page.close(); }
  });

  test('the raw view closes when the caret leaves the block', async () => {
    const id = entityWithDoc('Leave', JS_DOC);
    const page = await openEntity(id);
    try {
      await page.click('.vditor-ir__preview code');
      await page.waitForSelector('button.doc-code-raw', { state: 'visible' });
      await page.click('button.doc-code-raw');
      await page.waitForFunction(() => document.querySelector('button.doc-code-raw')?.getAttribute('aria-pressed') === 'true');
      await page.click('.vditor-ir .vditor-reset > p:last-of-type');
      await page.waitForFunction(() => !document.querySelector('.vditor-ir__node--expand[data-type="code-block"]'));
      await page.waitForFunction(() => !document.querySelector('button.doc-code-raw')?.getClientRects().length,
        null, { timeout: 3000 }).catch(() => assert.fail('the button leaves with the caret'));
      await page.click('.vditor-ir__preview code');
      await page.waitForSelector('button.doc-code-raw', { state: 'visible' });
      const r = await readBlock(page);
      assert.equal(r.fence || r.info || r.close, false, 'coming back, the fence starts hidden');
      assert.equal(r.pressed, 'false');
    } finally { await page.close(); }
  });

  test('no button outlives its editor', async () => {
    const id = entityWithDoc('Teardown', JS_DOC);
    const page = await openEntity(id);
    try {
      await page.click('.vditor-ir__preview code');
      await page.waitForSelector('button.doc-code-raw', { state: 'visible' });
      await page.click('button.doc-code-raw');
      await page.waitForFunction(() => document.querySelector('.doc-editor.wv-code-raw'));
      // A route change runs teardownDocEditors; the focusout it causes queues
      // one more placement pass, which must find nothing to put back.
      await page.evaluate(() => { location.hash = '#/'; });
      await page.waitForFunction(() => !document.querySelector('.doc-editor'));
      await page.waitForTimeout(300);
      assert.equal(await page.locator('button.doc-code-raw').count(), 0, 'the button left with the editor');
    } finally { await page.close(); }
  });

  /* Kyle's own surface: the trace is a Description with a mermaid diagram,
     clicked six times. A diagram's raw view is its source, so the drawing is
     what stays on screen until </> asks for the source. */
  test('clicking a diagram keeps the drawing; </> swaps in its source and back', async () => {
    const id = entityWithDoc('Diagram', MERMAID_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.vditor-ir__preview svg');
      const at = await page.evaluate(() => {
        const r = document.querySelector('.vditor-ir__preview svg').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await page.mouse.click(at.x, at.y);
      await page.waitForFunction(() => document.querySelector('.vditor-ir__node--expand[data-type="code-block"]'));
      await page.waitForSelector('button.doc-code-raw', { state: 'visible' });

      let r = await readBlock(page);
      assert.ok(r.drawing, 'the diagram is still drawn with the caret in it');
      assert.equal(r.source, false, 'its source is not on screen');
      assert.equal(r.fence || r.info || r.close, false, 'nor is its fence');
      assertUpperRight(r, 'diagram');

      await page.click('button.doc-code-raw');
      await page.waitForFunction(() => document.querySelector('button.doc-code-raw')?.getAttribute('aria-pressed') === 'true');
      r = await readBlock(page);
      assert.ok(r.source && r.fence && r.info && r.close, 'the source and its fence are on screen to edit');
      assert.equal(r.preview, false, 'the drawing steps aside while its source is shown');
      assertUpperRight(r, 'diagram source');

      await page.click('button.doc-code-raw');
      await page.waitForFunction(() => document.querySelector('button.doc-code-raw')?.getAttribute('aria-pressed') === 'false');
      r = await readBlock(page);
      assert.ok(r.drawing && !r.source, 'a second click puts the drawing back');
    } finally { await page.close(); }
  });

  test('typing into a diagram whose source is hidden shows the source first', async () => {
    const id = entityWithDoc('Diagram typing', MERMAID_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.vditor-ir__preview svg');
      const at = await page.evaluate(() => {
        const r = document.querySelector('.vditor-ir__preview svg').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
      await page.mouse.click(at.x, at.y);
      await page.waitForSelector('button.doc-code-raw', { state: 'visible' });
      await page.keyboard.press('End');
      await page.keyboard.type('X');
      await page.waitForFunction(() => document.querySelector('button.doc-code-raw')?.getAttribute('aria-pressed') === 'true',
        null, { timeout: 3000 }).catch(() => assert.fail('a keystroke into hidden source opens it'));
      const r = await readBlock(page);
      assert.ok(r.source, 'the writer sees the text they are changing');
      const saved = await settle(id, /X/);
      assert.match(saved, /```mermaid\n[^`]*X[^`]*\n```/, `the keystroke lands in the diagram source: ${JSON.stringify(saved)}`);
    } finally { await page.close(); }
  });
}
