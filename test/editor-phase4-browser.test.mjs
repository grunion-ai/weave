import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tableRef;

const s = await launch('phase 4 editor', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
});
if (s) {
  const { base, browser, weave } = s;
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

  const worstTokenContrast = (page, selector) => page.evaluate((sel) => {
    const lum = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((n) => {
        const v = Number(n) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const code = document.querySelector(sel);
    let bg = 'rgb(255, 255, 255)';
    for (let n = code; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
    }
    let worst = { ratio: Infinity, token: 'none', color: '', bg, bgLum: lum(bg) };
    for (const span of code.querySelectorAll('span[class^="hljs-"]')) {
      const color = getComputedStyle(span).color;
      const r = ratio(color, bg);
      if (r < worst.ratio) worst = { ratio: r, token: span.className, color, bg, bgLum: lum(bg) };
    }
    return worst;
  }, selector);

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

  test('the code slab follows the theme and every token clears 4.5:1 on it', async () => {
    const id = entityWithDoc('Contrast', '```js\nconst pick = vis[state.active] ?? (state.query.trim() ? vis[0] : null);\nfunction toggle(state, option) { return { ...state, active: -1 }; }\n```\n');
    const page = await openEntity(id);
    try {
      await page.waitForFunction(() =>
        document.querySelector('.vditor-ir__preview code.hljs')?.querySelectorAll('span').length > 2);
      for (const theme of ['light', 'dark']) {
        await page.evaluate((want) => {
          const btn = document.querySelector('#theme-toggle');
          for (let i = 0; i < 4 && document.documentElement.dataset.bsTheme !== want; i++) btn.click();
        }, theme);
        await page.waitForTimeout(120);
        const worst = await worstTokenContrast(page, '.vditor-ir__preview code.hljs');
        assert.ok(theme === 'light' ? worst.bgLum > 0.5 : worst.bgLum < 0.5,
          `${theme}: the slab is ${worst.bg} (luminance ${worst.bgLum.toFixed(3)})`);
        assert.ok(worst.ratio >= 4.5,
          `${theme}: ${worst.token} is ${worst.color} on ${worst.bg} — ${worst.ratio.toFixed(2)}:1`);
      }
    } finally { await page.close(); }
  });

  test('the slash Code block command produces a block hljs can tokenize', async () => {
    const id = entityWithDoc('SlashHl', '');
    const page = await openEntity(id);
    try {
      await page.click('.vditor-ir [contenteditable="true"]');
      await page.keyboard.type('/code block');
      await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) button', { state: 'visible' });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      const md = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
      assert.match(md, /^```\n/, 'the command inserts a fence, and guesses nothing');
      await page.evaluate(() => {
        const ed = window.__weaveEditors.values().next().value;
        ed.setValue(ed.getValue().replace('code', 'const x = 1;'));
      });
      await page.waitForFunction(() =>
        document.querySelector('.vditor-ir__preview code.hljs')?.querySelectorAll('span').length > 0);
    } finally { await page.close(); }
  });

  test('a [[…]] reference paints a resolved chip at its literal, sized to its label', async () => {
    const target = weave.createEntity(tableRef, { name: 'Chip target' });
    const id = entityWithDoc('Chips', `points at [[Note#${target.publicId}]] here\n`);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-ref-layer .doc-ref-slot a.mention', { timeout: 20000 });
      const r = await page.evaluate(() => {
        const slot = document.querySelector('.doc-ref-layer .doc-ref-slot');
        const chip = slot.querySelector('a.mention');
        const label = slot.querySelector('.k-label');
        const slotRect = slot.getBoundingClientRect();
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
        const text = document.createRange();
        text.selectNodeContents(label);
        return {
          label: slot.textContent,
          href: chip.getAttribute('href'),
          startsAtLiteral: textRect && Math.abs(slotRect.left - textRect.left) < 2,
          fitsInLiteral: textRect && slotRect.width <= textRect.width + 2,
          labelWhole: text.getBoundingClientRect().width <= label.getBoundingClientRect().width + 1,
          value: window.__weaveEditors.values().next().value.getValue(),
        };
      });
      assert.ok(r.label.includes('Chip target'), `chip must carry the resolved name, got "${r.label}"`);
      assert.match(r.href, /#\/entity\//, 'an entity chip opens the entity page in-app');
      assert.ok(r.startsAtLiteral, 'the chip starts where its reference starts');
      assert.ok(r.fitsInLiteral, 'and ends inside it, so it never covers the words after it');
      assert.ok(r.labelWhole, 'the name reads whole: the chip is sized to its label, not to the literal (Issue #679)');
      assert.match(r.value, /\[\[Note#\d+\|Chip target\]\]/,
        'a bare reference is stored aliased once the editor resolves it, which is what reserves the room');
    } finally { await page.close(); }
  });

  test('the caret inside a reference degrades the chip to literal text', async () => {
    const target = weave.createEntity(tableRef, { name: 'Caret target' });
    const id = entityWithDoc('CaretChip', `edit [[Note#${target.publicId}]] live\n`);
    const page = await openEntity(id);
    try {
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
      await page.waitForTimeout(1200);
      const chips = await page.evaluate(() =>
        document.querySelectorAll('.doc-ref-layer a.mention').length);
      assert.equal(chips, 0, 'code is literal text by definition');
    } finally { await page.close(); }
  });

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
      await page.evaluate(() => document.querySelector('.doc-rail').click());
      await page.waitForSelector('.doc-rail.open', { timeout: 20000 });
      await page.evaluate(() => document.querySelectorAll('.doc-rail-dash')[1].click());
      await page.waitForFunction(() => !document.querySelector('.doc-rail.open'),
        null, { timeout: 20000 });
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

  test('the outline opens on click, in place, and Escape closes it', async () => {
    const id = entityWithDoc('RailOpen', RAIL_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
      const labelDisplay = () => page.evaluate(() =>
        getComputedStyle(document.querySelector('.doc-rail-label')).display);
      assert.equal(await labelDisplay(), 'none', 'the resting rail is a minimap, not a table of contents');
      await page.hover('.doc-rail');
      assert.equal(await labelDisplay(), 'none', 'hover reveals nothing — the outline is click-to-open');
      await page.evaluate(() => document.querySelector('.doc-rail').click());
      await page.waitForSelector('.doc-rail.open', { timeout: 20000 });
      const after = await page.evaluate(() => {
        const l = document.querySelector('.doc-rail-label');
        const t = document.querySelector('.doc-rail-track').getBoundingClientRect();
        return { display: getComputedStyle(l).display, text: l.textContent,
          width: l.getBoundingClientRect().width, top: t.top, vh: innerHeight };
      });
      assert.notEqual(after.display, 'none', 'clicking shows the headings');
      assert.equal(after.text, 'One', 'the label is the heading');
      assert.ok(after.width > 0, 'and it takes real space');
      assert.ok(after.top < after.vh / 3,
        `the open outline stays at the minimap's anchor near the top (top ${after.top} of ${after.vh})`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.doc-rail.open'), null, { timeout: 20000 });
      assert.equal(await labelDisplay(), 'none', 'Escape folds it back to a minimap');
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
      await page.evaluate(() => document.querySelector('#main').scrollBy({ top: 600, behavior: 'instant' }));
      await page.waitForFunction(() => document.querySelector('#main').scrollTop >= 590, null, { timeout: 20000 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
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

  test('the toolbar exists but stays out of the flow until text is selected', async () => {
    const id = entityWithDoc('Toolbar', '# T\n\ntext\n');
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-editor .vditor-toolbar', { state: 'attached', timeout: 20000 });
      const r = await page.evaluate(() => {
        const bar = document.querySelector('.doc-editor .vditor-toolbar');
        return {
          display: getComputedStyle(bar).display,
          buttons: bar.querySelectorAll('.vditor-toolbar__item').length,
          bold: !!bar.querySelector('[data-type="bold"]'),
          table: !!bar.querySelector('[data-type="table"]'),
        };
      });
      assert.equal(r.display, 'none', 'no selection: the bubble is hidden, the document is the only chrome');
      assert.ok(r.buttons >= 15, `the full control set is mounted, found ${r.buttons}`);
      assert.ok(r.bold && r.table, 'bold and table are reachable from it');
    } finally { await page.close(); }
  });

  const FOLD_DOC = '# Top\n\nintro\n\n## Fold me\n\nhidden one\n\nhidden two\n\n### Deeper\n\nalso hidden\n\n## After\n\nvisible\n';

  test('folding a heading hides its blocks up to the next same-level heading', async () => {
    const id = entityWithDoc('Folds', FOLD_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.doc-fold-layer .doc-fold', { timeout: 20000 });
      const before = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
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
      await page.evaluate(() => document.querySelector('.doc-fold.folded').click());
      await page.waitForFunction(() => document.querySelectorAll('.wv-folded').length === 0,
        null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  test('mount/unmount cycles do not accumulate icon sprites', async () => {
    const e = weave.createEntity(tableRef, { name: 'SpriteRow' });
    weave.setDoc(e.id, 'sprite probe\n', 'Description');
    const page = await openEntity(e.id);
    try {
      const sprites = await page.evaluate(() =>
        [...document.querySelectorAll('body > svg')].filter((v) => v.querySelector('symbol')).length);
      assert.ok(sprites <= 1, `one icon sprite for the page, got ${sprites}`);
    } finally { await page.close(); }
  });

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
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        await page.waitForTimeout(80);
        const worst = await worstTokenContrast(page, 'pre > code.hljs');
        assert.ok(worst.ratio >= 4.5,
          `${colorScheme}: ${worst.token} is ${worst.color} on ${worst.bg} — ${worst.ratio.toFixed(2)}:1`);
      }
    } finally { await page.close(); }
  });
}
