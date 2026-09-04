/* The document toolbar as a selection bubble (Kyle's Toolbar Lab pick,
   2026-08-30): the full item set floats over selected text instead of
   sitting in the flow. Everything here is runtime behavior — bubble
   geometry, Vditor's own commands, the headings dropdown, real uploads —
   so it runs through Playwright like the phase 4 suite, and skips clean
   when Playwright is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launch } from './lib/browser.mjs';

let tableRef;

const s = await launch('toolbar', (weave) => {
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

  // Select the first `len` characters of the first paragraph — the gesture
  // that summons the bubble.
  const selectStart = (page, len = 8) => page.evaluate((n) => {
    // First text node, not firstChild: after an edit the paragraph may lead
    // with a marker span, and a Range refuses element offsets.
    const p = document.querySelector('.vditor-ir .vditor-reset p');
    const t = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
    const r = document.createRange();
    r.setStart(t, 0); r.setEnd(t, Math.min(n, t.length));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }, len);

  const barVisible = (page) => page.evaluate(() => {
    const bar = document.querySelector('.doc-editor .vditor-toolbar');
    return !!bar && getComputedStyle(bar).display !== 'none' && bar.offsetHeight > 0;
  });

  const value = (page) => page.evaluate(() =>
    window.__weaveEditors.values().next().value.getValue());

  /* ---------- the bubble itself ---------- */

  test('the toolbar is hidden at rest and floats over a selection', async () => {
    const id = entityWithDoc('Bubble', 'plain paragraph of text to select\n');
    const page = await openEntity(id);
    try {
      assert.equal(await barVisible(page), false, 'no selection, no bar');
      await selectStart(page, 10);
      await page.waitForFunction(() => {
        const bar = document.querySelector('.doc-editor .vditor-toolbar');
        return bar && bar.offsetHeight > 0;
      }, null, { timeout: 20000 });
      const geom = await page.evaluate(() => {
        const bar = document.querySelector('.doc-editor .vditor-toolbar');
        const host = document.querySelector('.doc-editor').getBoundingClientRect();
        const sel = getSelection().getRangeAt(0).getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        return {
          clear: b.bottom <= sel.top + 1 || b.top >= sel.bottom - 1,
          inHost: b.left >= host.left - 1 && b.right <= host.right + 1,
        };
      });
      // Above by default; below when the selection touches the host's top —
      // either way it floats beside the text, never over it.
      assert.ok(geom.clear, 'the bubble does not cover the selected text');
      assert.ok(geom.inHost, 'and stays inside the editor');
      // collapse: the bar goes away
      await page.evaluate(() => getSelection().removeAllRanges());
      await page.waitForFunction(() => {
        const bar = document.querySelector('.doc-editor .vditor-toolbar');
        return !bar || bar.offsetHeight === 0;
      }, null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  test('every configured control is present, with a hover label', async () => {
    const id = entityWithDoc('Controls', 'select me please\n');
    const page = await openEntity(id);
    try {
      await selectStart(page);
      await page.waitForSelector('.doc-editor .vditor-toolbar [data-type="bold"]', { timeout: 20000 });
      const r = await page.evaluate(() => {
        const bar = document.querySelector('.doc-editor .vditor-toolbar');
        const items = [...bar.querySelectorAll('[data-type]')].map((b) => b.dataset.type);
        const labeled = [...bar.querySelectorAll('.vditor-tooltipped')].filter((b) => b.getAttribute('aria-label'));
        return { items, labeled: labeled.length };
      });
      for (const it of ['headings', 'bold', 'italic', 'strike', 'inline-code', 'link',
        'list', 'ordered-list', 'check', 'outdent', 'indent',
        'quote', 'code', 'table', 'line', 'undo', 'redo', 'upload']) {
        assert.ok(r.items.includes(it), `toolbar is missing: ${it}`);
      }
      assert.ok(r.labeled >= 15, `hover labels ride the buttons (found ${r.labeled})`);
      // The buttons draw the Toolbar Lab glyphs — inline stroked paths, not
      // Vditor's <use> sprite references.
      const icons = await page.evaluate(() => {
        const bar = document.querySelector('.doc-editor .vditor-toolbar');
        return {
          sprites: bar.querySelectorAll('svg use').length,
          strokes: bar.querySelectorAll('svg[stroke="currentColor"]').length,
        };
      });
      assert.equal(icons.sprites, 0, 'no sprite icons remain');
      assert.ok(icons.strokes >= 15, `the lab glyphs are in place (found ${icons.strokes})`);
    } finally { await page.close(); }
  });

  test('list and check icons are drawn at a legible size', async () => {
    const id = entityWithDoc('Legible', 'select me please\n');
    const page = await openEntity(id);
    try {
      await selectStart(page);
      await page.waitForSelector('.doc-editor .vditor-toolbar [data-type="ordered-list"]', { timeout: 20000 });
      for (const t of ['ordered-list', 'check']) {
        const r = await page.evaluate((type) => {
          const svg = document.querySelector(`.doc-editor .vditor-toolbar [data-type="${type}"] svg`);
          return { w: svg?.getBoundingClientRect().width,
            stroke: getComputedStyle(svg.querySelector('path')).strokeWidth };
        }, t);
        assert.ok(r.w >= 16, `${t} icon is ${r.w}px wide — Kyle flagged it as hard to see below 16`);
        // The dense glyphs draw finer than the rest — 2px reads as a clot
        // in a 16px box (Kyle, 2026-08-31: "still too thick").
        assert.equal(r.stroke, '1.4px', `${t} draws at the fine stroke, got ${r.stroke}`);
      }
      const bold = await page.evaluate(() =>
        getComputedStyle(document.querySelector('.doc-editor .vditor-toolbar [data-type="bold"] svg path')).strokeWidth);
      assert.equal(bold, '2px', 'the simple glyphs keep the full stroke');
    } finally { await page.close(); }
  });

  /* ---------- marks ---------- */

  for (const [type, mark] of [['bold', '**'], ['italic', '*'], ['strike', '~~'], ['inline-code', '`']]) {
    test(`${type} wraps the selection in ${mark}`, async () => {
      const id = entityWithDoc(`Mark-${type}`, 'wrapme rest of the line\n');
      const page = await openEntity(id);
      try {
        await selectStart(page, 6);
        await page.waitForSelector(`.doc-editor .vditor-toolbar [data-type="${type}"]`, { timeout: 20000 });
        await page.click(`.doc-editor .vditor-toolbar [data-type="${type}"]`);
        await page.waitForFunction((m) =>
          window.__weaveEditors.values().next().value.getValue().includes(`${m}wrapme${m}`),
        mark, { timeout: 20000 });
      } finally { await page.close(); }
    });
  }

  test('link wraps the selection in []()', async () => {
    const id = entityWithDoc('Mark-link', 'wrapme rest of the line\n');
    const page = await openEntity(id);
    try {
      await selectStart(page, 6);
      await page.waitForSelector('.doc-editor .vditor-toolbar [data-type="link"]', { timeout: 20000 });
      await page.click('.doc-editor .vditor-toolbar [data-type="link"]');
      await page.waitForFunction(() =>
        /\[wrapme\]\(/.test(window.__weaveEditors.values().next().value.getValue()),
      null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  /* ---------- the headings dropdown ---------- */

  test('headings opens a dropdown and applies the picked level', async () => {
    const id = entityWithDoc('Heads', 'make me a heading\n');
    const page = await openEntity(id);
    try {
      await selectStart(page, 4);
      await page.waitForSelector('.doc-editor .vditor-toolbar [data-type="headings"]', { timeout: 20000 });
      await page.click('.doc-editor .vditor-toolbar [data-type="headings"]');
      // The dropdown is Vditor's arrow panel, distinct from the slash hint.
      await page.waitForSelector('.vditor-hint.vditor-panel--arrow button[data-value="## "]', { state: 'visible', timeout: 20000 });
      await page.click('.vditor-hint.vditor-panel--arrow button[data-value="## "]');
      await page.waitForFunction(() =>
        window.__weaveEditors.values().next().value.getValue().startsWith('## make me a heading'),
      null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  /* ---------- lists, indent, blocks ---------- */

  for (const [type, prefix] of [['list', '* '], ['ordered-list', '1. '], ['check', '* [ ] ']]) {
    test(`${type} turns the line into "${prefix.trim()}"`, async () => {
      const id = entityWithDoc(`List-${type}`, 'a plain line\n');
      const page = await openEntity(id);
      try {
        await selectStart(page, 5);
        await page.waitForSelector(`.doc-editor .vditor-toolbar [data-type="${type}"]`, { timeout: 20000 });
        await page.click(`.doc-editor .vditor-toolbar [data-type="${type}"]`);
        await page.waitForFunction((p) =>
          window.__weaveEditors.values().next().value.getValue().startsWith(p),
        prefix, { timeout: 20000 });
      } finally { await page.close(); }
    });
  }

  test('quote, code block, table and divider insert their blocks', async () => {
    for (const [type, probe] of [['quote', /^>/m], ['code', /```/], ['table', /\|.*\|/], ['line', /^---/m]]) {
      const id = entityWithDoc(`Block-${type}`, 'block target line\n');
      const page = await openEntity(id);
      try {
        await selectStart(page, 5);
        await page.waitForSelector(`.doc-editor .vditor-toolbar [data-type="${type}"]`, { timeout: 20000 });
        await page.click(`.doc-editor .vditor-toolbar [data-type="${type}"]`);
        await page.waitForFunction((src) =>
          new RegExp(src.source, src.flags).test(window.__weaveEditors.values().next().value.getValue()),
        { source: probe.source, flags: probe.flags }, { timeout: 20000 });
      } finally { await page.close(); }
    }
  });

  test('indent and outdent move a list item', async () => {
    const id = entityWithDoc('Indent', '* one\n* two\n');
    const page = await openEntity(id);
    try {
      // A real click first: Vditor arms outdent/indent from its own caret
      // handlers, which a programmatic selection never runs.
      await page.click('.vditor-ir .vditor-reset li:last-child');
      // Then select the word "two" so the bubble shows.
      await page.evaluate(() => {
        const root = document.querySelector('.vditor-ir .vditor-reset');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.nodeValue.includes('two')) node = n;
        }
        const i = node.nodeValue.indexOf('two');
        const r = document.createRange();
        r.setStart(node, i); r.setEnd(node, i + 3);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      });
      await page.waitForSelector('.doc-editor .vditor-toolbar [data-type="indent"]:not(.vditor-menu--disabled)', { timeout: 20000 });
      await page.click('.doc-editor .vditor-toolbar [data-type="indent"]');
      await page.waitForFunction(() =>
        /\n(?: {2,4}|\t)\* two/.test(window.__weaveEditors.values().next().value.getValue()),
      null, { timeout: 20000 });
      await page.click('.doc-editor .vditor-toolbar [data-type="outdent"]');
      await page.waitForFunction(() =>
        /\n\* two/.test(window.__weaveEditors.values().next().value.getValue()),
      null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  /* ---------- undo / redo ---------- */

  test('the undo and redo buttons revert and replay a typed edit', async () => {
    // Vditor arms its undo stack from the typing pipeline (a toolbar-applied
    // format alone never arms it — a Vditor quirk, ⌘Z behaves the same), so
    // the undoable edit here is typed and the BUTTONS do the reverting.
    const id = entityWithDoc('Undo', 'wrapme rest of the line\n');
    const page = await openEntity(id);
    try {
      await page.click('.vditor-ir [contenteditable="true"]');
      // lastText is Vditor's own caret-annotated snapshot — capture it
      // before the edit, exactly what the debounce would have diffed against.
      const before = await page.evaluate(() =>
        window.__weaveEditors.values().next().value.vditor.undo.ir.lastText);
      await page.keyboard.press('End');
      await page.keyboard.type(' typed');
      /* Vditor snapshots its undo stack on an 800ms setTimeout AND refreshes
         lastText on every keydown while the stack is fresh; a throttled
         headless page may never run the timer, so the stack never grows
         there. Rebuild the snapshot the debounce would have taken — looped
         synchronously, since the first diff can be absorbed — then let the
         BUTTONS do all the work; that policy is Chrome's, not weave's. */
      await page.evaluate((pre) => {
        const ed = window.__weaveEditors.values().next().value;
        const u = ed.vditor.undo.ir;
        for (let i = 0; i < 3 && u.undoStack.length < 2; i++) {
          u.lastText = pre;
          ed.vditor.undo.addToUndoStack(ed.vditor);
        }
      }, before);
      // Summon the bubble on a word that exists in both document states.
      const selectWord = () => page.evaluate(() => {
        const root = document.querySelector('.vditor-ir .vditor-reset');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.nodeValue.indexOf('wrapme');
          if (i < 0) continue;
          const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 6);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r);
          return;
        }
      });
      const clickUntil = async (type, want) => {
        for (let i = 0; i < 5; i++) {
          await selectWord();
          await page.click(`.doc-editor .vditor-toolbar [data-type="${type}"]`);
          const done = await page.waitForFunction((w) =>
            window.__weaveEditors.values().next().value.getValue().includes('typed') === w,
          want, { timeout: 4000 }).then(() => true, () => false);
          if (done) return;
        }
        assert.fail(`${type} never ${want ? 'replayed' : 'reverted'} the edit`);
      };
      await clickUntil('undo', false);
      await clickUntil('redo', true);
    } finally { await page.close(); }
  });

  /* ---------- upload: every kind of file weave stores ---------- */

  test('upload attaches png, pdf and txt to the entity and links them in the doc', async () => {
    const id = entityWithDoc('Upload', 'upload target paragraph\n');
    const page = await openEntity(id);
    const dir = mkdtempSync(join(tmpdir(), 'weave-up-'));
    // A real 1×1 PNG, a minimal PDF header, plain text — three mimes, three
    // renderings: image embeds, the rest link.
    const png = join(dir, 'dot.png');
    writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==', 'base64'));
    const pdf = join(dir, 'note.pdf');
    writeFileSync(pdf, '%PDF-1.4\n%%EOF\n');
    const txt = join(dir, 'read.txt');
    writeFileSync(txt, 'plain words\n');
    try {
      await selectStart(page, 6);
      await page.waitForSelector('.doc-editor .vditor-toolbar [data-type="upload"] input[type="file"]', { timeout: 20000 });
      await page.setInputFiles('.doc-editor .vditor-toolbar [data-type="upload"] input[type="file"]', [png, pdf, txt]);
      await page.waitForFunction(() => {
        const v = window.__weaveEditors.values().next().value.getValue();
        return v.includes('![dot.png](') && v.includes('title="note.pdf"') && v.includes('[read.txt](');
      }, null, { timeout: 20000 });
      const v = await value(page);
      assert.match(v, /<iframe class="wv-file"[^>]*title="note.pdf">/, 'the pdf embeds a viewer, not a bare link');
      const urls = [...new Set(v.match(/\/api\/files\/[a-f0-9-]+/g) ?? [])];
      assert.equal(urls.length, 3, 'three attached files, three references');
      // The links resolve: every uploaded byte stream comes back with its mime.
      for (const [u, mime] of [[urls[0], 'image/png'], [urls[1], 'application/pdf'], [urls[2], 'text/plain']]) {
        const rsp = await fetch(base + u);
        assert.equal(rsp.status, 200, `${u} serves`);
        assert.ok((rsp.headers.get('content-type') ?? '').startsWith(mime), `${u} keeps mime ${mime}`);
      }
      // And the entity's file list carries all three.
      const entity = weave.readEntity(id);
      assert.equal(entity.files.length, 3, 'all three files attached to the entity');
    } finally { await page.close(); }
  });

  /* ---------- file viewers in the document (Kyle, 2026-08-31) ----------
     Uploaded images, PDFs and HTML files render as inline viewers in the
     editor — centered, medium-sized by default, with the native resize
     grip — and a hover toolbar can demote any viewer to a plain link.
     The three exports must survive them: .md verbatim, .html rendering
     the viewers, .pdf still building. */

  const FILE_DOC = 'intro paragraph line\n' +
    '\n![pic](/api/files/00000000000000000000000000000001)\n' +
    '\n<iframe class="wv-file" src="/api/files/00000000000000000000000000000002" title="doc.pdf"></iframe>\n';

  test('file viewers default to centered, medium and resizable', async () => {
    const id = entityWithDoc('Viewers', FILE_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.vditor-ir .vditor-reset img', { timeout: 20000 });
      await page.waitForSelector('.doc-editor iframe.wv-file', { timeout: 20000 });
      const r = await page.evaluate(() => {
        const probe = (el) => {
          const cs = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          const host = el.closest('.vditor-reset') ?? el.closest('.doc-editor');
          const hostBox = host.getBoundingClientRect();
          return {
            display: cs.display, resize: cs.resize,
            centered: Math.abs((box.left - hostBox.left) - (hostBox.right - box.right)) < 2,
            medium: box.width <= hostBox.width * 0.62 + 2,
          };
        };
        return {
          img: probe(document.querySelector('.vditor-ir .vditor-reset img')),
          pdf: probe(document.querySelector('.doc-editor iframe.wv-file')),
        };
      });
      for (const [kind, p] of Object.entries(r)) {
        assert.equal(p.display, 'block', `${kind}: block, not inline in the text run`);
        assert.equal(p.resize, 'both', `${kind}: the native resize grip is on`);
        assert.ok(p.centered, `${kind}: centered in the document column`);
        assert.ok(p.medium, `${kind}: defaults to the medium width, not full bleed`);
      }
    } finally { await page.close(); }
  });

  test('uploaded pdf and html files embed live viewers in the editor', async () => {
    const id = entityWithDoc('ViewerUp', 'viewer paragraph target\n');
    const page = await openEntity(id);
    const dir = mkdtempSync(join(tmpdir(), 'weave-view-'));
    const pdf = join(dir, 'view.pdf');
    writeFileSync(pdf, '%PDF-1.4\n%%EOF\n');
    const html = join(dir, 'page.html');
    writeFileSync(html, '<h1>embedded page</h1>\n');
    try {
      await selectStart(page, 6);
      await page.waitForSelector('.doc-editor .vditor-toolbar [data-type="upload"] input[type="file"]', { timeout: 20000 });
      await page.setInputFiles('.doc-editor .vditor-toolbar [data-type="upload"] input[type="file"]', [pdf, html]);
      await page.waitForFunction(() => {
        const v = window.__weaveEditors.values().next().value.getValue();
        return v.includes('title="view.pdf"') && v.includes('title="page.html"');
      }, null, { timeout: 20000 });
      // The IR editor shows both as rendered html-block previews with the
      // iframe alive inside — the viewer, not the markup.
      await page.waitForFunction(() =>
        document.querySelectorAll('.doc-editor .vditor-ir__preview iframe.wv-file').length >= 2,
      null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  test('hovering a viewer raises a toolbar that demotes it to a plain link', async () => {
    const id = entityWithDoc('FileTools', FILE_DOC);
    const page = await openEntity(id);
    try {
      await page.waitForSelector('.vditor-ir .vditor-reset img', { timeout: 20000 });
      await page.hover('.vditor-ir .vditor-reset img');
      await page.waitForSelector('.wv-file-tools', { state: 'visible', timeout: 20000 });
      await page.click('.wv-file-tools button');
      await page.waitForFunction(() => {
        const v = window.__weaveEditors.values().next().value.getValue();
        return v.includes('[pic](/api/files/') && !v.includes('![pic](');
      }, null, { timeout: 20000 });
      // Same demotion for the pdf viewer.
      await page.hover('.doc-editor iframe.wv-file');
      await page.waitForSelector('.wv-file-tools', { state: 'visible', timeout: 20000 });
      await page.click('.wv-file-tools button');
      await page.waitForFunction(() => {
        const v = window.__weaveEditors.values().next().value.getValue();
        return v.includes('[doc.pdf](/api/files/') && !v.includes('<iframe');
      }, null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  test('md, html and pdf exports all survive embedded files', async () => {
    const id = entityWithDoc('Exports', FILE_DOC);
    const md = await fetch(`${base}/e/${id}/doc/Description.md`).then((r) => r.text());
    assert.ok(md.includes('![pic](/api/files/'), 'the .md export keeps the image markdown verbatim');
    assert.match(md, /<iframe class="wv-file"[^>]*title="doc.pdf">/, 'and the viewer block verbatim');
    const html = await fetch(`${base}/e/${id}/doc/Description.html`).then((r) => r.text());
    assert.match(html, /<img [^>]*src="\/api\/files\//, 'the .html export renders the image');
    assert.match(html, /<iframe class="wv-file"/, 'and the viewer iframe');
    assert.match(html, /\.wv-file\s*\{/, 'with the centered-medium styling on the page');
    const pdf = await fetch(`${base}/e/${id}/doc/Description.pdf`);
    assert.equal(pdf.status, 200, 'the .pdf export still builds');
    const head = Buffer.from(await pdf.arrayBuffer()).slice(0, 5).toString();
    assert.equal(head, '%PDF-', 'and is a real PDF');
  });
}
