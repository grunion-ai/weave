import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let table;
const s = await launch('document saves keep the draft and refuse a stale base', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Task' });
});

if (s) {
  const { browser, base, weave } = s;

  const open = async (id) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const section = page.locator('.doc-section[data-doc-field="Description"]');
    const surface = section.locator('.vditor-ir [contenteditable="true"]');
    await surface.waitFor();
    const type = async (text) => {
      await surface.click();
      await page.keyboard.press('End');
      await page.keyboard.type(text);
      await page.evaluate(() => window.__weaveFlushDocSaves());
    };
    const kept = (marker) => page.evaluate((m) => [...window.__weaveDocSaves.values()].some((p) => String(p.value ?? '').includes(m)), marker);
    const glyph = () => page.locator('#main .view-header .crumb-row > .save-glyph').getAttribute('data-state');
    return { context, page, surface, type, kept, glyph };
  };

  test('two tabs on one document: the stale save is refused, keeps its draft, and lands only on Use mine (Issue #1443)', async () => {
    const id = weave.createEntity(table, { name: 'Shared' }).id;
    weave.setDoc(id, 'START');
    const ann = await open(id);
    const bo = await open(id);
    try {
      await ann.type(' ANN_TEXT');
      assert.equal(await eventually(() => weave.getDoc(id).includes('ANN_TEXT'), true), true, 'the first tab saves');
      const refused = bo.page.waitForResponse((r) => r.url().endsWith('/doc') && r.request().method() === 'PUT');
      await bo.type(' BO_TEXT');
      assert.equal((await refused).status(), 412, 'the second tab wrote from a stale base and is refused');
      assert.match(weave.getDoc(id), /ANN_TEXT/, 'the first tab text survives');
      assert.doesNotMatch(weave.getDoc(id), /BO_TEXT/, 'the stale draft overwrote nothing');
      assert.equal(await bo.kept('BO_TEXT'), true, 'the second tab keeps its draft');
      assert.equal(await eventually(bo.glyph, 'failed'), 'failed', 'the save mark says the change is not saved');
      await bo.page.locator('.wv-toast-action', { hasText: 'Use mine' }).click();
      assert.equal(await eventually(() => weave.getDoc(id).includes('BO_TEXT'), true), true, 'Use mine saves the draft on purpose');
      assert.equal(await eventually(() => bo.kept('BO_TEXT'), false), false, 'a saved draft leaves the queue');
    } finally {
      await ann.context.close();
      await bo.context.close();
    }
  });

  for (const status of [409, 413]) {
    test(`a ${status} refusal keeps the draft, says it is not saved, and Try again sends it (Issue #1443)`, async () => {
      const id = weave.createEntity(table, { name: `Refused ${status}` }).id;
      const tab = await open(id);
      let refused = 0;
      const refuse = (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        refused++;
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: `refused ${status}`, code: status === 409 ? 'conflict' : 'too-large' }) });
      };
      try {
        await tab.page.route('**/doc', refuse);
        await tab.type(` DRAFT_${status}`);
        assert.equal(await eventually(() => refused > 0, true), true, 'the save reached the server and was refused');
        assert.equal(await eventually(tab.glyph, 'failed'), 'failed', 'the save mark says the change is not saved');
        assert.equal(await tab.kept(`DRAFT_${status}`), true, 'the draft stays queued');
        await tab.page.unroute('**/doc', refuse);
        await tab.page.locator('#main .view-header .crumb-row > .save-glyph').click();
        assert.equal(await eventually(() => (weave.getDoc(id) ?? '').includes(`DRAFT_${status}`), true), true, 'Try again lands the draft');
        assert.equal(await eventually(tab.glyph, 'saved'), 'saved');
      } finally {
        await tab.context.close();
      }
    });
  }

  test('a dropped connection keeps the draft and Try again sends it (Issue #1443)', async () => {
    const id = weave.createEntity(table, { name: 'Offline' }).id;
    const tab = await open(id);
    let dropped = 0;
    const drop = (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      dropped++;
      return route.abort('failed');
    };
    try {
      await tab.page.route('**/doc', drop);
      await tab.type(' OFFLINE_DRAFT');
      assert.equal(await eventually(() => dropped >= 2, true), true, 'the save is tried and retried once');
      assert.equal(await eventually(tab.glyph, 'failed'), 'failed');
      assert.equal(await tab.kept('OFFLINE_DRAFT'), true);
      await tab.page.unroute('**/doc', drop);
      await tab.page.locator('#main .view-header .crumb-row > .save-glyph').click();
      assert.equal(await eventually(() => (weave.getDoc(id) ?? '').includes('OFFLINE_DRAFT'), true), true);
    } finally {
      await tab.context.close();
    }
  });

  test('closing the tab before the save fires still lands the draft (Issue #1443)', async () => {
    const id = weave.createEntity(table, { name: 'Closed' }).id;
    const tab = await open(id);
    try {
      await tab.surface.click();
      await tab.page.keyboard.type('CLOSED_DRAFT');
      await eventually(() => tab.page.evaluate(() => [...window.__weaveDocSaves.values()].some((p) => String(p.value ?? '').includes('CLOSED_DRAFT'))), true);
      await tab.page.close({ runBeforeUnload: true });
      assert.equal(await eventually(() => (weave.getDoc(id) ?? '').includes('CLOSED_DRAFT'), true), true, 'the pagehide flush lands the draft');
    } finally {
      await tab.context.close();
    }
  });
}
