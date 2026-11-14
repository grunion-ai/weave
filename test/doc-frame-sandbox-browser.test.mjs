import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const HTML_FRAME_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
const HOSTILE = [
  'Before the frames.',
  '',
  '<div><img class="hostile" src="/missing.png" onerror="window.__fired = true"></div>',
  '',
  '<iframe class="same" src="/leak.html"></iframe>',
  '',
  '<iframe class="foreign" src="https://frame.invalid/" allow="camera *" sandbox="allow-scripts allow-same-origin"></iframe>',
  '',
  '<iframe class="wv-file" src="/api/files/0123abcd" title="a.pdf"></iframe>',
  '',
  'After the frames.',
].join('\n');

let table;
let deck;
const s = await launch('a document cannot run script or frame a page outside the sandbox in the editor', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Task' });
  weave.createSpace({ name: 'Decks' });
  const slides = weave.createTable({ space: 'Decks', name: 'Slide' });
  const decks = weave.createTable({ space: 'Decks', name: 'Deck' });
  weave.addField(slides.id, { name: 'Model', type: 'document', config: { kind: 'code' } });
  weave.addRelation(decks.id, { name: 'Slides', targetDb: slides.id, cardinality: 'many-to-many', inverseName: 'Decks' });
  const slide = weave.createEntity(slides.id, { values: { Name: 'Cover' } });
  weave.setDoc(slide.id, JSON.stringify({ els: [{ role: 'Body', x: 60, y: 100, w: 800, html: 'Opening slide' }] }), 'Model');
  deck = weave.createEntity(decks.id, { values: { Name: 'Quarterly deck' } });
  weave.link(deck.id, 'Slides', [slide.id]);
});
if (s) {
  const { browser, base, weave } = s;
  const open = async (id) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.route('**/leak.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><script>try { parent.__leaked = true; } catch {}</script>' }));
    const puts = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && r.url().endsWith('/doc')) puts.push(r.url()); });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const root = page.locator('.doc-section[data-doc-field="Description"] .vditor-ir');
    await root.locator('iframe.same').waitFor({ state: 'attached' });
    return { context, page, root, puts };
  };
  const framesOf = (page) => page.evaluate(() => [...document.querySelectorAll('.doc-section .vditor-ir iframe')].map((f) => ({
    cls: f.className, sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow'), opaque: f.contentDocument === null,
  })));

  test('the editor is built with sanitize pinned and keeps the other markdown defaults (Issue #1598)', async () => {
    const id = weave.createEntity(table, { name: 'Options' }).id;
    weave.setDoc(id, HOSTILE);
    const tab = await open(id);
    try {
      const markdown = await tab.page.evaluate(() => {
        const { sanitize, codeBlockPreview, mathBlockPreview, footnotes, gfmAutoLink } = [...liveEditors][0].vditor.options.preview.markdown;
        return { sanitize, codeBlockPreview, mathBlockPreview, footnotes, gfmAutoLink };
      });
      assert.deepEqual(markdown, { sanitize: true, codeBlockPreview: true, mathBlockPreview: true, footnotes: true, gfmAutoLink: true });
    } finally {
      await tab.context.close();
    }
  });

  test('a stored handler never fires and never reaches the editor DOM (Issue #1598)', async () => {
    const id = weave.createEntity(table, { name: 'Handlers' }).id;
    weave.setDoc(id, HOSTILE);
    const tab = await open(id);
    try {
      await tab.page.waitForFunction(() => document.querySelector('.doc-section .vditor-ir img.hostile')?.complete === true);
      assert.equal(await tab.page.evaluate(() => window.__fired), undefined, 'the onerror handler never ran');
      const handlers = await tab.page.evaluate(() => [...document.querySelectorAll('.doc-section .vditor-ir *')]
        .flatMap((n) => [...n.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${n.tagName}.${a.name}`)));
      assert.deepEqual(handlers, [], 'no element in the editor carries an event-handler attribute');
    } finally {
      await tab.context.close();
    }
  });

  test('every frame a document holds runs sandboxed in the editor, except a bare workspace file frame, which a PDF needs (Issue #1598)', async () => {
    const id = weave.createEntity(table, { name: 'Frames' }).id;
    weave.setDoc(id, HOSTILE);
    const tab = await open(id);
    try {
      await eventually(async () => (await framesOf(tab.page)).find((f) => f.cls === 'same')?.opaque, true);
      const byClass = Object.fromEntries((await framesOf(tab.page)).map((f) => [f.cls, f]));
      assert.equal(byClass.same?.sandbox, HTML_FRAME_SANDBOX, 'a same-origin page runs in the HTML frame sandbox');
      assert.equal(byClass.same?.opaque, true, 'and so outside the workspace origin');
      assert.equal(await tab.page.evaluate(() => window.__leaked), undefined, 'the framed page never reached the editor window');
      assert.equal(byClass.foreign?.sandbox, HTML_FRAME_SANDBOX, 'an author sandbox that hands back the origin is replaced');
      assert.equal(byClass.foreign?.allow, null, 'and its permission delegation dropped');
      assert.equal(byClass['wv-file']?.sandbox, null, 'the file frame an upload writes stays unsandboxed, since Chromium refuses a PDF in a sandboxed frame');
      assert.deepEqual(tab.puts, [], 'opening the document saves nothing');
      assert.equal(weave.getDoc(id), HOSTILE, 'the stored text is the text the author wrote');
    } finally {
      await tab.context.close();
    }
  });

  test('an expanded deck runs in the same sandbox as the deck frame it expands, and still plays (Issue #1598)', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/#/entity/${deck.id}`, { waitUntil: 'networkidle' });
      const inline = page.locator('.deck-section iframe.deck-frame');
      await inline.waitFor();
      await page.locator('.deck-section .doc-anchor[title="Expand"]').click();
      const expanded = page.locator('.doc-expand iframe.doc-expand-frame');
      await expanded.waitFor();
      assert.equal(await expanded.getAttribute('sandbox'), await inline.getAttribute('sandbox'));
      assert.equal(await expanded.getAttribute('sandbox'), HTML_FRAME_SANDBOX);
      await page.frameLocator('.doc-expand iframe.doc-expand-frame').getByText('Opening slide').first().waitFor({ state: 'attached' });
      assert.equal(await expanded.evaluate((f) => f.contentDocument), null, 'the expanded deck runs outside the workspace origin');
    } finally {
      await context.close();
    }
  });

  test('frames stay sandboxed when an edit redraws the document, and the saved text keeps what the author wrote (Issue #1598)', async () => {
    const id = weave.createEntity(table, { name: 'Edits' }).id;
    weave.setDoc(id, HOSTILE);
    const tab = await open(id);
    try {
      await tab.root.locator('p', { hasText: 'After the frames.' }).click();
      await tab.page.keyboard.press('End');
      await tab.page.keyboard.type(' Edited.');
      await tab.page.evaluate(() => window.__weaveFlushDocSaves());
      assert.equal(await eventually(() => weave.getDoc(id).includes('Edited.'), true), true, 'the edit lands');
      const saved = weave.getDoc(id);
      assert.ok(saved.includes('allow="camera *" sandbox="allow-scripts allow-same-origin"'), `the author's markup is saved as written: ${saved}`);
      assert.ok(!saved.includes('allow-popups-to-escape-sandbox'), 'the live sandbox never reaches the stored text');
      for (const f of await framesOf(tab.page)) {
        assert.equal(f.sandbox, f.cls === 'wv-file' ? null : HTML_FRAME_SANDBOX, `${f.cls} after the edit`);
      }
    } finally {
      await tab.context.close();
    }
  });
}
