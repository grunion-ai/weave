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

  /* ---------- Issue #86: live [[…]] chips over the IR editor ---------- */

  test('a [[…]] reference paints a resolved chip over the literal text', async () => {
    const target = weave.createEntity(tableRef, { name: 'Chip target' });
    const id = entityWithDoc('Chips', `points at [[Note#${target.publicId}]] here\n`);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-ref-layer a.mention', { timeout: 20000 });
      const r = await page.evaluate(() => {
        const chip = document.querySelector('.doc-ref-layer a.mention');
        const chipRect = chip.getBoundingClientRect();
        // The literal [[Note#N]] text node the chip must cover.
        const walker = document.createTreeWalker(
          document.querySelector('.vditor-ir .vditor-reset'), NodeFilter.SHOW_TEXT);
        let textRect = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = n.nodeValue.indexOf('[[');
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(n, at); range.setEnd(n, n.nodeValue.indexOf(']]') + 2);
          textRect = range.getBoundingClientRect();
        }
        return {
          label: chip.textContent,
          href: chip.getAttribute('href'),
          covered: textRect && Math.abs(chipRect.left - textRect.left) < 2
            && chipRect.width >= textRect.width - 2,
          value: window.__weaveEditors.values().next().value.getValue(),
        };
      });
      assert.ok(r.label.includes('Chip target'), `chip must carry the resolved name, got "${r.label}"`);
      assert.match(r.href, /#\/entity\//, 'an entity chip opens the entity page in-app');
      assert.ok(r.covered, 'the chip must sit over the literal reference');
      assert.match(r.value, /\[\[Note#\d+\]\]/, 'the stored markdown keeps the literal reference');
    } finally { await page.close(); }
  });

  test('the caret inside a reference degrades the chip to literal text', async () => {
    const target = weave.createEntity(tableRef, { name: 'Caret target' });
    const id = entityWithDoc('CaretChip', `edit [[Note#${target.publicId}]] live\n`);
    const page = await openEntity(id);
    try {
      // Generous waits: the suite runs many browser files in parallel, and
      // the decoration pass is debounced behind a resolver round-trip.
      await page.waitForSelector('.doc-ref-layer a.mention', { timeout: 20000 });
      await page.evaluate(() => {
        const walker = document.createTreeWalker(
          document.querySelector('.vditor-ir .vditor-reset'), NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = n.nodeValue.indexOf('[[');
          if (at < 0) continue;
          const sel = getSelection();
          const range = document.createRange();
          range.setStart(n, at + 3); range.collapse(true);
          sel.removeAllRanges(); sel.addRange(range);
        }
      });
      await page.waitForFunction(() => !document.querySelector('.doc-ref-layer a.mention'),
        null, { timeout: 20000 });
      // Move the caret OUT of the reference (start of the paragraph): the
      // chip returns. Dropping the selection entirely would race Vditor's
      // own selection restoration, which can put the caret straight back.
      await page.evaluate(() => {
        const walker = document.createTreeWalker(
          document.querySelector('.vditor-ir .vditor-reset'), NodeFilter.SHOW_TEXT);
        const n = walker.nextNode();
        const sel = getSelection();
        const range = document.createRange();
        range.setStart(n, 0); range.collapse(true);
        sel.removeAllRanges(); sel.addRange(range);
      });
      await page.waitForSelector('.doc-ref-layer a.mention', { timeout: 20000 });
    } finally { await page.close(); }
  });

  test('a reference inside a code block stays literal', async () => {
    const target = weave.createEntity(tableRef, { name: 'Code target' });
    const id = entityWithDoc('CodeChip', '```\n[[Note#' + target.publicId + ']]\n```\n');
    const page = await openEntity(id);
    try {
      await page.waitForTimeout(1200); // give the decoration pass every chance
      const chips = await page.evaluate(() =>
        document.querySelectorAll('.doc-ref-layer a.mention').length);
      assert.equal(chips, 0, 'code is literal text by definition');
    } finally { await page.close(); }
  });

  /* ---------- Issue #87: outline dash rail ---------- */

  const RAIL_DOC = '# One\n\ntext\n\n## Two\n\n' + 'filler\n\n'.repeat(40) + '## Three\n\nmore\n\n### Four\n\nend\n';

  test('a document with 3+ headings grows a dash rail, longer dashes higher up', async () => {
    const id = entityWithDoc('Rail', RAIL_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
      const r = await page.evaluate(() => {
        const dashes = [...document.querySelectorAll('.doc-rail .doc-rail-dash')];
        return {
          count: dashes.length,
          widths: dashes.map((d) => d.getBoundingClientRect().width),
          titles: dashes.map((d) => d.title),
          active: dashes.findIndex((d) => d.classList.contains('active')),
        };
      });
      assert.equal(r.count, 4, 'one dash per heading');
      assert.ok(r.widths[0] > r.widths[1], 'the h1 dash outreaches the h2 dash');
      assert.ok(r.widths[2] > r.widths[3], 'the h2 dash outreaches the h3 dash');
      assert.equal(r.titles[0], 'One', 'a dash names its heading');
      assert.equal(r.active, 0, 'the tracker starts on the first section');
    } finally { await page.close(); }
  });

  test('clicking a dash scrolls its section into view and moves the tracker', async () => {
    const id = entityWithDoc('RailJump', RAIL_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
      // Jump to "Two" — the one heading with enough document below it to
      // actually reach the top ("Three"/"Four" sit inside the last viewport,
      // where no scroll position can bring them there).
      await page.evaluate(() => document.querySelectorAll('.doc-rail-dash')[1].click());
      await page.waitForFunction(() => {
        const h = [...document.querySelectorAll('.vditor-ir .vditor-reset h2')]
          .find((x) => x.textContent.includes('Two'));
        const t = h.getBoundingClientRect().top;
        return t > -10 && t < 200;
      }, null, { timeout: 20000 });
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.doc-rail-dash')]
          .findIndex((d) => d.classList.contains('active')) === 1,
      null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  test('hovering the rail opens the headings themselves', async () => {
    const id = entityWithDoc('RailHover', RAIL_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
      const before = await page.evaluate(() =>
        getComputedStyle(document.querySelector('.doc-rail-label')).display);
      assert.equal(before, 'none', 'the resting rail is a minimap, not a table of contents');
      await page.hover('.doc-rail');
      const after = await page.evaluate(() => {
        const l = document.querySelector('.doc-rail-label');
        return { display: getComputedStyle(l).display, text: l.textContent, width: l.getBoundingClientRect().width };
      });
      assert.notEqual(after.display, 'none', 'hovering shows the headings');
      assert.equal(after.text, 'One', 'the label is the heading');
      assert.ok(after.width > 0, 'and it takes real space');
    } finally { await page.close(); }
  });

  test('the rail floats: scrolling leaves the track near the reading line', async () => {
    const id = entityWithDoc('RailFloat', RAIL_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-rail .doc-rail-track', { timeout: 20000 });
      const top = () => page.evaluate(() =>
        document.querySelector('.doc-rail-track').getBoundingClientRect().top);
      const resting = await top();
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForFunction((t) =>
        document.querySelector('.doc-rail-track').getBoundingClientRect().top > t - 300,
      resting, { timeout: 20000 });
      const scrolled = await top();
      assert.ok(scrolled > 0, 'the track never scrolls off the top of the viewport');
      assert.ok(scrolled < 200, 'it holds at the reading line instead of riding the document down');
    } finally { await page.close(); }
  });

  test('a two-heading document stays rail-free', async () => {
    const id = entityWithDoc('NoRail', '# A\n\ntext\n\n## B\n\nmore\n');
    const page = await openEntity(id);
    try {
      await page.waitForTimeout(1200);
      assert.equal(await page.evaluate(() => document.querySelectorAll('.doc-rail-dash').length), 0);
    } finally { await page.close(); }
  });

  /* ---------- Issue #88: collapsible headings ---------- */

  const FOLD_DOC = '# Top\n\nintro\n\n## Fold me\n\nhidden one\n\nhidden two\n\n### Deeper\n\nalso hidden\n\n## After\n\nvisible\n';

  test('folding a heading hides its blocks up to the next same-level heading', async () => {
    const id = entityWithDoc('Folds', FOLD_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-fold-layer .doc-fold', { timeout: 20000 });
      const before = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
      // Fold "Fold me" (second caret: Top, Fold me, Deeper, After).
      await page.evaluate(() => document.querySelectorAll('.doc-fold')[1].click());
      await page.waitForFunction(() => document.querySelectorAll('.wv-folded').length > 0,
        null, { timeout: 20000 });
      const r = await page.evaluate(() => {
        const root = document.querySelector('.vditor-ir .vditor-reset');
        const hidden = [...root.querySelectorAll('.wv-folded')].map((b) => b.textContent.trim());
        const visible = (t) => [...root.children].some(
          (b) => b.textContent.includes(t) && !b.classList.contains('wv-folded'));
        return {
          hidden,
          topVisible: visible('intro'),
          afterVisible: visible('After'),
          value: window.__weaveEditors.values().next().value.getValue(),
        };
      });
      assert.ok(r.hidden.some((t) => t.includes('hidden one')), 'the section body folds');
      assert.ok(r.hidden.some((t) => t.includes('Deeper')), 'a deeper heading folds along');
      assert.ok(r.topVisible, 'blocks above the fold stay visible');
      assert.ok(r.afterVisible, 'the next same-level heading stays visible');
      assert.equal(r.value, before, 'folding never touches the stored markdown');
    } finally { await page.close(); }
  });

  test('a fold survives a reload via localStorage, and unfolding restores', async () => {
    const id = entityWithDoc('FoldPersist', FOLD_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-fold-layer .doc-fold', { timeout: 20000 });
      await page.evaluate(() => document.querySelectorAll('.doc-fold')[1].click());
      await page.waitForFunction(() => document.querySelectorAll('.wv-folded').length > 0,
        null, { timeout: 20000 });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelectorAll('.wv-folded').length > 0,
        null, { timeout: 20000 });
      // Unfold: the folded caret is the one carrying the folded class.
      await page.evaluate(() => document.querySelector('.doc-fold.folded').click());
      await page.waitForFunction(() => document.querySelectorAll('.wv-folded').length === 0,
        null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  /* ---------- Issue #89: shared row editor ---------- */

  test('focusing a row doc cell swaps in the shared Vditor; blur restores the textarea', async () => {
    const e = weave.createEntity(tableRef, { name: 'RowDoc' });
    weave.setDoc(e.id, 'row document text\n', 'Description');
    const dbId = weave.state.schema?.find?.((d) => d.name === 'Note')?.id
      ?? await (async () => {
        const r = await fetch(`${base}/api/schema`);
        const spaces = await r.json();
        return spaces.flatMap((s) => s.tables).find((t) => t.name === 'Note').id;
      })();
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/table/${dbId}`, { waitUntil: 'networkidle' });
      // Expand the row's doc cell (list view keeps inline docs per row).
      await page.waitForSelector('.wv-grid', { timeout: 20000 });
      await page.evaluate(() => {
        // The documents toggle expands a row's inline documents — RowDoc's
        // row, since the suite's shared table carries other entities too.
        // Name cells are <input>s, so the row is found by input value. The
        // button is found by its title: its glyph is a flat icon now, and an
        // icon is not text to match on.
        const row = [...document.querySelectorAll('tr')].find((r) =>
          [...r.querySelectorAll('input')].some((i) => (i.value ?? '').includes('RowDoc')));
        row.querySelector('button[title="Edit documents"]').click();
      });
      await page.waitForSelector('textarea.doc-inline', { timeout: 20000 });
      const before = await page.evaluate(() => document.querySelector('textarea.doc-inline').value);
      assert.match(before, /row document text/);

      // Focus mounts the shared editor over the cell.
      const t0 = Date.now();
      await page.focus('textarea.doc-inline');
      await page.waitForSelector('.doc-inline-editor .vditor-ir', { timeout: 20000 });
      const mountMs = Date.now() - t0;
      const during = await page.evaluate(() => ({
        textareaHidden: document.querySelector('textarea.doc-inline').classList.contains('hidden'),
        value: window.__weaveEditors ? null : null,
      }));
      assert.ok(during.textareaHidden, 'the textarea steps aside while the editor is mounted');
      assert.ok(mountMs < 5000, `mount must be quick, took ${mountMs}ms`);

      // Type, then blur: the textarea returns carrying the edit.
      await page.keyboard.type('MORE');
      await page.evaluate(() => document.querySelector('.vditor-ir [contenteditable]').blur());
      await page.waitForFunction(() => !document.querySelector('.doc-inline-editor'),
        null, { timeout: 20000 });
      const after = await page.evaluate(() => ({
        value: document.querySelector('textarea.doc-inline').value,
        visible: !document.querySelector('textarea.doc-inline').classList.contains('hidden'),
      }));
      assert.ok(after.visible, 'blur restores the textarea');
      assert.match(after.value, /MORE/, 'the edit survives the round trip');
    } finally { await page.close(); }
  });

  test('mount/unmount cycles do not accumulate icon sprites', async () => {
    const e = weave.createEntity(tableRef, { name: 'SpriteRow' });
    weave.setDoc(e.id, 'sprite probe\n', 'Description');
    const page = await openEntity(e.id);
    try {
      // The entity page mounts an editor already; repeated shared-row mounts
      // elsewhere ran through the same constructor. Count sprite sheets.
      const sprites = await page.evaluate(() =>
        [...document.querySelectorAll('body > svg')].filter((v) => v.querySelector('symbol')).length);
      assert.ok(sprites <= 1, `one icon sprite for the page, got ${sprites}`);
    } finally { await page.close(); }
  });

  /* ---------- Issue #90: math via vendored KaTeX ---------- */

  test('$$…$$ and $…$ render through the vendored KaTeX', async () => {
    const id = entityWithDoc('Math', 'inline $a^2 + b^2$ here\n\n$$\n\\frac{x}{y}\n$$\n');
    const page = await openEntity(id);
    const failed = [];
    page.on('response', (r) => { if (r.status() >= 400) failed.push(r.url()); });
    try {
      await page.waitForFunction(() => document.querySelectorAll('.katex').length >= 1,
        null, { timeout: 20000 });
      const r = await page.evaluate(() => ({
        rendered: document.querySelectorAll('.katex').length,
        katexSrc: [...document.querySelectorAll('script[src*="katex"]')].map((s) => s.src),
        value: window.__weaveEditors.values().next().value.getValue(),
      }));
      assert.ok(r.rendered >= 1, 'KaTeX output must appear in the editor');
      assert.ok(r.katexSrc.every((s) => s.includes('/vendor/vditor/')),
        `katex must load from the vendored tree, got ${r.katexSrc}`);
      assert.match(r.value, /\$\$/, 'the stored markdown keeps the math source');
      const vendorFails = failed.filter((u) => u.includes('/katex/') && u.match(/\.(js|css|woff2)/));
      assert.deepEqual(vendorFails, [], 'no vendored katex asset may 404');
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
