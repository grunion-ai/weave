/* Document history in the chrome (Feature #225). A `lucide:history` control
   in the doc-section-head, hidden until the document has a past to show;
   it opens a panel INSIDE the section (never a modal) listing revisions
   newest first — relative time, actor, size delta — and selecting one swaps
   the editor for a read-only render under a "Viewing revision" bar with
   Restore and Back. Restore writes the text back through the ordinary doc
   write and the editor shows it. Escape returns to the editor. Both themes.

   Playwright is NOT a dependency of weave; the harness skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let id;
const s = await launch('document history', (weave) => {
  weave.revisionWindowMs = 0; // every save is its own revision, so the test needs no clock
  weave.createSpace({ name: 'Wiki' });
  const t = weave.createTable({ space: 'Wiki', name: 'Article' });
  id = weave.createEntity(t, { name: 'Guide', doc: 'first draft' }).id;
});

if (s) {
  const { browser, base, weave } = s;
  const revisions = () => weave.listDocRevisions(id).revisions;
  // Waits for the debounced save to land: a string is an exact match, a
  // regex a contains (Vditor may open a paragraph under the click).
  const settle = async (want) => {
    const ok = () => (want instanceof RegExp ? want.test(weave.getDoc(id)) : weave.getDoc(id) === want);
    for (let i = 0; i < 60 && !ok(); i++) await new Promise((r) => setTimeout(r, 100));
    return weave.getDoc(id);
  };
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    return page;
  };
  const typeAtEnd = async (page, text) => {
    await page.click('.vditor-ir [contenteditable="true"]');
    await page.keyboard.press('End');
    await page.keyboard.type(text);
  };

  test('the History control appears once a document has more than one revision', async () => {
    const page = await open();
    try {
      assert.equal(revisions().length, 1);
      assert.equal(await page.locator('.doc-history-btn').getAttribute('hidden'), '', 'one revision: nothing to browse, the control is hidden');
      await typeAtEnd(page, ' plus one');
      assert.match(await settle(/plus one/), /first draft[\s\S]*plus one/);
      await page.waitForSelector('.doc-history-btn:not([hidden])');
      await typeAtEnd(page, ' plus two');
      assert.match(await settle(/plus two/), /plus one[\s\S]*plus two/);
      // Vditor also writes on the click that opens a paragraph, so the count
      // is at least the two sessions plus the create — never fewer.
      assert.ok(revisions().length >= 3, `sessions became revisions (${revisions().length})`);
    } finally { await page.close(); }
  });

  test('the panel lists newest first, a row previews read-only, Restore writes the text back', async () => {
    const page = await open();
    try {
      await page.click('.doc-history-btn');
      await page.waitForSelector('.wv-doc-history .wv-rev-row');
      const rows = page.locator('.wv-doc-history .wv-rev-row');
      const before = revisions().length;
      assert.equal(await rows.count(), before);
      assert.match(await rows.first().textContent(), /Current/, 'the newest row is the current text');
      assert.match(await rows.first().textContent(), /web/, 'the actor is on the row (the browser writes as web)');
      assert.match(await rows.nth(1).textContent(), /\+\d+/, 'the size delta against the revision before it');
      assert.match(await rows.last().textContent(), /ago|just now/, 'a relative time');
      assert.equal(await page.locator('.wv-doc-history').evaluate((n) => n.closest('.doc-section') != null), true, 'inside the section, not a modal');

      await rows.last().click();
      await page.waitForSelector('.wv-rev-view');
      assert.match(await page.locator('.wv-rev-bar').textContent(), /Viewing revision from/);
      assert.match(await page.locator('.wv-rev-view').textContent(), /first draft/);
      assert.doesNotMatch(await page.locator('.wv-rev-view').textContent(), /plus one/);
      assert.equal(await page.locator('.doc-editor').evaluate((n) => n.classList.contains('hidden')), true, 'the editor steps aside while a revision is viewed');
      assert.equal(await page.locator('.wv-rev-view [contenteditable="true"]').count(), 0, 'the render is read-only');

      await page.click('.wv-rev-restore');
      assert.equal(await settle('first draft'), 'first draft');
      await page.waitForFunction(() => document.querySelector('.doc-editor .vditor-ir .vditor-reset')?.textContent.trim() === 'first draft');
      assert.equal(await page.locator('.wv-doc-history').count(), 0, 'restore returns to the editor');
      assert.equal(revisions().length, before + 1, 'the restore is a new revision; nothing was destroyed');
      assert.match(weave.getDocRevision(id, null, revisions()[1].seq).text, /plus two/, 'the text it replaced is still in the log');
    } finally { await page.close(); }
  });

  test('Escape and Back return to the editor; the panel paints in both themes', async () => {
    const page = await open();
    try {
      await page.click('.doc-history-btn');
      await page.waitForSelector('.wv-doc-history .wv-rev-row');
      await page.locator('.wv-rev-row').last().click();
      await page.waitForSelector('.wv-rev-view');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.wv-doc-history', { state: 'detached' });
      assert.equal(await page.locator('.doc-editor').evaluate((n) => n.classList.contains('hidden')), false, 'Escape: the editor is back');

      await page.click('.doc-history-btn');
      await page.waitForSelector('.wv-doc-history .wv-rev-row');
      await page.locator('.wv-rev-row').last().click();
      await page.waitForSelector('.wv-rev-view');
      await page.click('.wv-rev-back');
      await page.waitForSelector('.wv-doc-history', { state: 'detached' });
      assert.equal(await page.locator('.wv-rev-view').count(), 0, 'Back: the preview is gone');

      const paint = async (theme) => {
        await page.evaluate((want) => {
          const btn = document.querySelector('#theme-toggle');
          for (let i = 0; i < 4 && document.documentElement.dataset.bsTheme !== want; i++) btn.click();
        }, theme);
        await page.click('.doc-history-btn');
        await page.waitForSelector('.wv-doc-history .wv-rev-row');
        const colours = await page.locator('.wv-doc-history').evaluate((n) => {
          const cs = getComputedStyle(n);
          const row = getComputedStyle(n.querySelector('.wv-rev-row'));
          return { bg: cs.backgroundColor, border: cs.borderTopColor, text: row.color };
        });
        await page.keyboard.press('Escape');
        await page.waitForSelector('.wv-doc-history', { state: 'detached' });
        return colours;
      };
      const light = await paint('light');
      const dark = await paint('dark');
      for (const c of [light, dark]) {
        assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(c.bg), `the panel paints a surface (${JSON.stringify(c)})`);
      }
      assert.notEqual(light.bg, dark.bg, 'the surface follows the theme');
      assert.notEqual(light.text, dark.text, 'the text follows the theme');
    } finally { await page.close(); }
  });
}
