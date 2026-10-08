import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phoneProfile } from './lib/browser.mjs';

let table;
const s = await launch('document autosave on a phone', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(table, { name: 'Brief', type: 'document' });
});

const WRITE_CEILING_MS = 15000;

if (s) {
  const { base, weave } = s;
  let n = 0;

  const noDebounce = (ctx) => ctx.addInitScript(() => {
    let saves = null;
    Object.defineProperty(window, '__weaveDocSaves', {
      configurable: true,
      get: () => saves,
      set: (map) => {
        const set = map.set.bind(map);
        map.set = (key, value) => {
          clearTimeout(value.timer);
          return set(key, { ...value, timer: 0 });
        };
        saves = map;
        window.__debounceCancelled = true;
      },
    });
  });

  const twoFrames = (page) => page.evaluate(() =>
    new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

  const open = async (field, { hash } = {}) => {
    const id = weave.createEntity(table, { name: `Row ${++n}` }).id;
    const ctx = await (await phoneBrowser()).newContext(phoneProfile().page);
    await noDebounce(ctx);
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.goto(`${base}/${hash ? hash(id) : `#/entity/${id}`}`, { waitUntil: 'networkidle' });
    const section = page.locator('.doc-section', { has: page.locator('.doc-section-name', { hasText: new RegExp(`^${field}$`) }) });
    const surface = section.locator('.vditor-ir [contenteditable="true"]');
    await surface.waitFor();
    assert.equal(await page.evaluate(() => window.__debounceCancelled === true), true,
      'the autosave debounce is cancelled in the page, so only a flush can write');
    return { id, ctx, page, section, surface };
  };

  const typeAndWatch = async (page, surface, word, { compose = false } = {}) => {
    await surface.tap();
    if (compose) {
      await surface.evaluate((node) => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' })));
      await page.keyboard.insertText(word);
      await surface.evaluate((node, w) => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: w })), word);
    } else {
      await page.keyboard.type(word);
    }
    return { put: page.waitForRequest((r) => r.method() === 'PUT' && r.url().includes('/doc') && (r.postData() ?? '').includes(word), { timeout: WRITE_CEILING_MS }) };
  };

  const hide = (page) => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  const persisted = async (id, field, word) => {
    for (let i = 0; i < 40 && !(weave.getDoc(id, field) ?? '').includes(word); i++) await new Promise((r) => setTimeout(r, 50));
    return weave.getDoc(id, field) ?? '';
  };

  for (const field of ['Description', 'Brief']) {
    test(`${field}: the field is edited in its rendered form, with no Save button`, async () => {
      const { ctx, page, section } = await open(field);
      try {
        const shown = await section.locator('.vditor').evaluate((v) =>
          [...v.querySelectorAll(':scope > .vditor-content > .vditor-ir, :scope > .vditor-content > .vditor-sv, :scope > .vditor-content > .vditor-wysiwyg')]
            .filter((d) => getComputedStyle(d).display !== 'none').map((d) => d.className.split(' ')[0]));
        assert.deepEqual(shown, ['vditor-ir'], 'instant rendering is the one surface; no raw-text pane');
        assert.equal(await page.locator('button', { hasText: /^\s*save\s*$/i }).count(), 0, 'nothing to press');
      } finally { await ctx.close(); }
    });

    test(`${field}: backgrounding the tab writes the text at once`, async () => {
      const { id, ctx, page, surface } = await open(field);
      try {
        const { put } = await typeAndWatch(page, surface, 'backgrounded');
        await hide(page);
        await put;
        assert.match(await persisted(id, field, 'backgrounded'), /backgrounded/);
      } finally { await ctx.close(); }
    });

    test(`${field}: pagehide alone writes the text at once`, async () => {
      const { id, ctx, page, surface } = await open(field);
      try {
        const { put } = await typeAndWatch(page, surface, 'pagehidden');
        await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
        await put;
        assert.match(await persisted(id, field, 'pagehidden'), /pagehidden/);
      } finally { await ctx.close(); }
    });

    test(`${field}: a composed word is written on background`, async () => {
      const { id, ctx, page, surface } = await open(field);
      try {
        const { put } = await typeAndWatch(page, surface, 'composedword', { compose: true });
        await hide(page);
        await put;
        assert.match(await persisted(id, field, 'composedword'), /composedword/);
      } finally { await ctx.close(); }
    });

    test(`${field}: tapping outside the field writes the text at once`, async () => {
      const { id, ctx, page, surface } = await open(field);
      try {
        const { put } = await typeAndWatch(page, surface, 'tappedout');
        await page.locator('.name-edit').tap();
        await put;
        assert.match(await persisted(id, field, 'tappedout'), /tappedout/);
      } finally { await ctx.close(); }
    });

    test(`${field}: navigating back writes the text at once`, async () => {
      const { id, ctx, page, surface } = await open(field);
      try {
        const { put } = await typeAndWatch(page, surface, 'wentback');
        await page.goBack();
        await put;
        assert.match(await persisted(id, field, 'wentback'), /wentback/);
      } finally { await ctx.close(); }
    });

    test(`${field}: closing the entity panel writes the text at once`, async () => {
      const { id, ctx, page, surface } = await open(field, { hash: (eid) => `#/table/${table.id}?e=${eid}` });
      try {
        const { put } = await typeAndWatch(page, surface, 'panelclosed');
        await page.locator('#dock button[aria-label="Close"]').tap();
        await put;
        assert.match(await persisted(id, field, 'panelclosed'), /panelclosed/);
      } finally { await ctx.close(); }
    });

    test(`${field}: an untouched document writes nothing when the phone leaves it`, async () => {
      const { id, ctx, page, surface } = await open(field);
      try {
        weave.setDoc(id, '* one\n* two', field);
        await page.reload({ waitUntil: 'networkidle' });
        await surface.waitFor();
        const puts = [];
        page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/doc')) puts.push(r.url()); });
        await surface.tap();
        await page.locator('.name-edit').tap();
        assert.equal(await page.evaluate(() => window.__weaveDocSaves.size), 0,
          'nothing is scheduled for a document nobody changed');
        await hide(page);
        await twoFrames(page);
        assert.deepEqual(puts, [], 'no write for a document nobody changed');
        assert.equal(weave.getDoc(id, field), '* one\n* two');
      } finally { await ctx.close(); }
    });

    test(`${field}: a document over the 64KB keepalive cap still saves on background`, async () => {
      const { id, ctx, page, surface } = await open(field);
      try {
        weave.setDoc(id, 'é'.repeat(40_000), field);
        await page.reload({ waitUntil: 'networkidle' });
        await surface.waitFor();
        const { put } = await typeAndWatch(page, surface, 'bigdocument');
        await hide(page);
        await put;
        assert.match(await persisted(id, field, 'bigdocument'), /bigdocument/);
      } finally { await ctx.close(); }
    });

    test(`${field}: a reload straight after typing keeps the text`, async () => {
      const { id, ctx, page, surface } = await open(field);
      try {
        await surface.tap();
        await page.keyboard.type('reloaded');
        await page.reload({ waitUntil: 'networkidle' });
        assert.match(await persisted(id, field, 'reloaded'), /reloaded/);
      } finally { await ctx.close(); }
    });
  }
}
