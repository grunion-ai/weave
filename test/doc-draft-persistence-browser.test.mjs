import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let table;
const s = await launch('a pending document draft outlives the page', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Task' });
});

if (s) {
  const { browser, base, weave } = s;
  const SECTION = '.doc-section[data-doc-field="Description"]';
  const SURFACE = `${SECTION} .vditor-ir [contenteditable="true"]`;
  const BAR = `${SECTION} .doc-draft-bar`;

  const open = async (page, id) => {
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const surface = page.locator(SURFACE);
    await surface.waitFor();
    return surface;
  };

  const typeRefused = async (page, id, text) => {
    const surface = await open(page, id);
    weave.setDoc(id, 'someone else was here');
    await surface.click();
    await page.keyboard.type(text);
    await page.evaluate(() => window.__weaveFlushDocSaves());
    await page.locator('.save-glyph[data-state="failed"]').waitFor();
    return surface;
  };

  const held = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wv-doc-draft:')));

  test('a refused save comes back after a reload and lands once it is restored (Issue #1685)', async () => {
    const id = weave.createEntity(table, { name: 'Reload' }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await typeRefused(page, id, 'DRAFTSURVIVES');
      assert.equal((await held(page)).length, 1, 'the draft is written down while the save is pending');
      await page.reload({ waitUntil: 'networkidle' });
      const bar = page.locator(BAR);
      await bar.waitFor();
      assert.match(await bar.textContent(), /Draft from/, 'the bar names when the draft was written');
      await bar.getByRole('button', { name: 'Discard draft' }).waitFor();
      assert.doesNotMatch(await page.locator(SURFACE).textContent(), /DRAFTSURVIVES/, 'the reloaded editor starts from the served text');
      await bar.getByRole('button', { name: 'Restore draft' }).click();
      assert.match(await page.locator(SURFACE).textContent(), /DRAFTSURVIVES/, 'restoring puts the draft back in the editor');
      assert.equal(await eventually(() => (weave.getDoc(id) ?? '').includes('DRAFTSURVIVES'), true), true, 'the restored draft saves');
      await bar.waitFor({ state: 'detached' });
      assert.equal(await eventually(async () => (await held(page)).length, 0), 0, 'a saved draft leaves the store');
    } finally {
      await page.close();
    }
  });

  test('discarding leaves the served text and makes no second offer (Issue #1685)', async () => {
    const id = weave.createEntity(table, { name: 'Discard' }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await typeRefused(page, id, 'GONEDRAFT');
      await page.reload({ waitUntil: 'networkidle' });
      const bar = page.locator(BAR);
      await bar.waitFor();
      await bar.getByRole('button', { name: 'Discard draft' }).click();
      await bar.waitFor({ state: 'detached' });
      assert.deepEqual(await held(page), [], 'the discarded draft is gone from the store');
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator(SURFACE).waitFor();
      assert.equal(await page.locator(BAR).count(), 0, 'the reopened page makes no second offer');
      assert.match(await page.locator(SURFACE).textContent(), /someone else was here/, 'the served text is what is left');
      assert.equal(weave.getDoc(id), 'someone else was here', 'and the server kept it');
    } finally {
      await page.close();
    }
  });

  test('a draft past the keepalive ceiling is offered in the next tab (Issue #1685)', async () => {
    const id = weave.createEntity(table, { name: 'Large' }).id;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const first = await context.newPage();
      const surface = await open(first, id);
      await first.evaluate(() => { localStorage.clear(); });
      weave.setDoc(id, 'someone else was here');
      await surface.click();
      await first.keyboard.insertText(`${'filler filler filler filler filler filler\n'.repeat(1600)}OVERTHECEILING`);
      await first.evaluate(() => window.__weaveFlushDocSaves());
      await first.locator('.save-glyph[data-state="failed"]').waitFor();
      const stored = await first.evaluate(() => {
        const k = Object.keys(localStorage).find((n) => n.startsWith('wv-doc-draft:'));
        return k ? JSON.parse(localStorage.getItem(k)).value : null;
      });
      assert.ok(stored && stored.length > 60000, `the pending payload is past the 60,000 byte keepalive ceiling, it is ${stored?.length}`);
      assert.match(stored, /OVERTHECEILING/, 'and the whole draft was written down');
      await first.close();
      const next = await context.newPage();
      await open(next, id);
      const bar = next.locator(BAR);
      await bar.waitFor();
      await bar.getByRole('button', { name: 'Restore draft' }).click();
      assert.equal(await eventually(() => (weave.getDoc(id) ?? '').includes('OVERTHECEILING'), true), true, 'the large draft saves once it is restored');
    } finally {
      await context.close();
    }
  });
}
