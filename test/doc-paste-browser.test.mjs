import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

for (const engine of ['chromium', 'webkit']) {
  let table;
  const s = await launch(`a pasted list line joins the bullet under the caret in ${engine}`, (weave) => {
    weave.createSpace({ name: 'Work' });
    table = weave.createTable({ space: 'Work', name: 'Note' });
  }, { engine });

  if (s) {
    const { browser, base, weave } = s;
    let n = 0;

    const open = async (doc) => {
      const id = weave.createEntity(table, { name: `Row ${++n}`, doc }).id;
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      const surface = page.locator('.doc-section[data-doc-field="Description"] .vditor-ir [contenteditable="true"]');
      await surface.waitFor();
      return { id, page, surface };
    };

    const saved = async (page, surface, id, want) => {
      await surface.evaluate((node) => node.blur());
      await page.evaluate(() => window.__weaveFlushDocSaves());
      for (let i = 0; i < 60 && (weave.getDoc(id, 'Description') ?? '') !== want; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return weave.getDoc(id, 'Description') ?? '';
    };

    const item = (page, text) => page.locator('.doc-section[data-doc-field="Description"] .vditor-reset li', { hasText: text }).first();

    const paste = (surface, text, html) => surface.evaluate((node, [text, html]) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      data.setData('text/html', html);
      node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, [text, html]);

    test(`${engine}: one copied list line pasted into a bullet joins that bullet (Issue #1873)`, async () => {
      const { id, page, surface } = await open('- alpha bravo\n- charlie\n');
      try {
        await item(page, 'charlie').click();
        await page.keyboard.press('End');
        await paste(surface, 'bravo', '<meta charset="utf-8"><ul style="color: rgb(0, 0, 0);"><li>bravo</li></ul>');
        const want = '- alpha bravo\n- charliebravo\n';
        assert.equal(await saved(page, surface, id, want), want);
      } finally { await page.close(); }
    });

    test(`${engine}: undo after an inline list-line paste takes the pasted text back out (Issue #1873)`, async () => {
      const { id, page, surface } = await open('- alpha bravo\n- charlie\n');
      try {
        await item(page, 'charlie').click();
        await page.keyboard.press('End');
        await paste(surface, 'bravo', '<ul><li>bravo</li></ul>');
        await item(page, 'charliebravo').waitFor();
        await page.waitForTimeout(1200);
        await page.keyboard.press('ControlOrMeta+z');
        const want = '- alpha bravo\n- charlie\n';
        assert.equal(await saved(page, surface, id, want), want);
      } finally { await page.close(); }
    });

    test(`${engine}: a whole bullet copied inside the editor and pasted at the end of another bullet joins it (Issue #1873)`, async () => {
      const { id, page, surface } = await open('- alpha bravo\n- charlie\n');
      try {
        await page.context().grantPermissions?.(['clipboard-read', 'clipboard-write']).catch(() => {});
        await item(page, 'alpha bravo').click();
        await page.evaluate(() => {
          const li = [...document.querySelectorAll('.doc-section[data-doc-field="Description"] .vditor-reset li')].find((n) => n.textContent.includes('alpha bravo'));
          const r = document.createRange();
          r.selectNodeContents(li);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
        });
        await page.keyboard.press('ControlOrMeta+c');
        await page.evaluate(() => {
          const li = [...document.querySelectorAll('.doc-section[data-doc-field="Description"] .vditor-reset li')].find((n) => n.textContent === 'charlie');
          const r = document.createRange();
          r.selectNodeContents(li);
          r.collapse(false);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
        });
        await page.keyboard.press('ControlOrMeta+v');
        const want = '- alpha bravo\n- charliealpha bravo\n';
        assert.equal(await saved(page, surface, id, want), want);
      } finally { await page.close(); }
    });

    test(`${engine}: a whole bullet copied from a rendered list outside the editor and pasted at the end of a bullet joins it (Issue #1873)`, async () => {
      const { id, page, surface } = await open('- alpha bravo\n- charlie\n');
      try {
        await page.context().grantPermissions?.(['clipboard-read', 'clipboard-write']).catch(() => {});
        await page.evaluate(() => {
          const list = document.createElement('ul');
          list.id = 'copy-source';
          list.innerHTML = '<li>delta echo</li><li>foxtrot</li>';
          document.body.prepend(list);
          const r = document.createRange();
          r.selectNodeContents(list.firstElementChild);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
        });
        await page.keyboard.press('ControlOrMeta+c');
        await page.evaluate(() => {
          document.getElementById('copy-source').remove();
          const li = [...document.querySelectorAll('.doc-section[data-doc-field="Description"] .vditor-reset li')].find((n) => n.textContent === 'charlie');
          li.closest('[contenteditable="true"]').focus();
          const r = document.createRange();
          r.selectNodeContents(li);
          r.collapse(false);
          getSelection().removeAllRanges();
          getSelection().addRange(r);
        });
        await page.keyboard.press('ControlOrMeta+v');
        const want = '- alpha bravo\n- charliedelta echo\n';
        assert.equal(await saved(page, surface, id, want), want);
      } finally { await page.close(); }
    });

    test(`${engine}: two copied list lines pasted into a bullet stay two new bullets (Issue #1873)`, async () => {
      const { id, page, surface } = await open('- alpha bravo\n- charlie\n');
      try {
        await item(page, 'charlie').click();
        await page.keyboard.press('End');
        await paste(surface, 'delta\necho', '<ul><li>delta</li><li>echo</li></ul>');
        const got = await saved(page, surface, id, '');
        assert.match(got, /^[-*] delta$/m);
        assert.match(got, /^[-*] echo$/m);
      } finally { await page.close(); }
    });

    test(`${engine}: one copied list line pasted outside a list keeps the editor's own paste (Issue #1873)`, async () => {
      const { id, page, surface } = await open('plain line\n');
      try {
        await page.locator('.doc-section[data-doc-field="Description"] .vditor-reset p', { hasText: 'plain line' }).click();
        await page.keyboard.press('End');
        await paste(surface, 'bravo', '<ul><li>bravo</li></ul>');
        const got = await saved(page, surface, id, '');
        assert.match(got, /^[-*] bravo$/m);
      } finally { await page.close(); }
    });
  }
}
