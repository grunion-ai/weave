import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { launch, eventually } from './lib/browser.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex');

let table;
const s = await launch('document saves send a base without crypto.subtle', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Task' });
});

if (s) {
  const { browser, base, weave } = s;

  const open = async (id) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true }));
    const page = await context.newPage();
    const puts = [];
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().endsWith('/doc')) puts.push(JSON.parse(r.postData()));
    });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const surface = page.locator('.doc-section[data-doc-field="Description"] .vditor-ir [contenteditable="true"]');
    await surface.waitFor();
    const type = async (text) => {
      await surface.click();
      await page.keyboard.press('End');
      await page.keyboard.type(text);
      await page.evaluate(() => window.__weaveFlushDocSaves());
    };
    return { context, page, type, puts };
  };

  test('with no crypto.subtle, as over plain http, an editor save sends the base of the text it opened (Issue #1682)', async () => {
    const id = weave.createEntity(table, { name: 'Plain http' }).id;
    weave.actor = 'web';
    weave.setDoc(id, 'START');
    const tab = await open(id);
    try {
      assert.equal(await tab.page.evaluate(() => typeof globalThis.crypto.subtle), 'undefined', 'the page has no crypto.subtle');
      await tab.type(' MINE');
      assert.equal(await eventually(() => weave.getDoc(id).includes('MINE'), true), true, 'the save lands');
      assert.equal(tab.puts[0]?.base, hash('START'), 'and names the text it replaces');
    } finally {
      await tab.context.close();
    }
  });

  test('the page hashes text exactly as the server does when it has no crypto.subtle (Issue #1682)', async () => {
    const id = weave.createEntity(table, { name: 'Hashes' }).id;
    const tab = await open(id);
    try {
      const samples = ['', 'a', 'START', 'é à ü', '日本語のテキスト', '🧵 weave 🪡', '\n\n- [ ] task\n', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'ü'.repeat(60), 'line\n'.repeat(4000)];
      const page = await tab.page.evaluate((texts) => Promise.all(texts.map((t) => docBaseOf(t))), samples);
      assert.deepEqual(page, samples.map(hash));
    } finally {
      await tab.context.close();
    }
  });

  test('with no crypto.subtle, a save over a change made elsewhere is refused and overwrites nothing (Issue #1682)', async () => {
    const id = weave.createEntity(table, { name: 'Changed elsewhere' }).id;
    weave.actor = 'web';
    weave.setDoc(id, 'START');
    const tab = await open(id);
    try {
      weave.actor = 'mcp:agent';
      weave.setDoc(id, 'AGENT_TEXT');
      const refused = tab.page.waitForResponse((r) => r.url().endsWith('/doc') && r.request().method() === 'PUT');
      await tab.type(' MINE');
      assert.equal((await refused).status(), 412, 'the save from the opened text is refused');
      assert.equal(weave.getDoc(id), 'AGENT_TEXT', 'the agent text survives');
    } finally {
      await tab.context.close();
    }
  });
}
