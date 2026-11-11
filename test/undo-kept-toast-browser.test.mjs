import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let tasks, row;
const s = await launch('cmd-z names the field it kept for another actor', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  row = weave.createEntity(tasks, { name: 'Launch', values: { Note: 'n0' } });
});

if (s) {
  const { base, browser, weave } = s;
  const stored = (id, f) => weave.readEntity(id).fields[f];
  const cell = (id, f) => `tr[data-eid="${id}"] td[data-field="${f}"]`;

  async function tab(theme) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: theme });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${cell(row.id, 'Note')} .text-dressed`);
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-bs-theme', t);
      window.__said = [];
      const shown = window.toast;
      window.toast = (msg, ...rest) => { window.__said.push(String(msg)); return shown(msg, ...rest); };
    }, theme);
    return page;
  }

  async function edit(page, f, text) {
    await page.click(`${cell(row.id, f)} .text-dressed`);
    await page.fill(`${cell(row.id, f)} input`, text);
    await page.keyboard.press('Tab');
    assert.equal(await eventually(() => stored(row.id, f), text), text, `${f} saved as ${text}`);
  }

  async function said(page, run) {
    const before = await page.evaluate(() => window.__said.length);
    await run();
    await page.waitForFunction((n) => window.__said.length > n, before);
    return page.evaluate(() => window.__said.at(-1));
  }

  for (const theme of ['light', 'dark']) {
    test(`an agent's later write is named in the undo toast, not silently replaced (${theme})`, async () => {
      weave.actor = 'local';
      weave.updateEntity(row.id, { Note: 'n0' });
      const page = await tab(theme);
      try {
        await edit(page, 'Note', 'from the tab');
        weave.actor = 'agent-bo';
        weave.updateEntity(row.id, { Note: 'from the agent' });
        weave.actor = 'local';
        const toast = await said(page, () => page.keyboard.press('ControlOrMeta+z'));
        assert.match(toast, /Kept: Note, changed since by agent-bo/, toast);
        assert.equal(stored(row.id, 'Note'), 'from the agent', "the agent's value stands");
        const note = page.locator('#wv-toasts .wv-toast', { hasText: 'Kept: Note' }).last();
        assert.ok(await note.isVisible(), `the kept note is on screen in ${theme}`);
      } finally {
        await page.close();
      }
    });
  }
}
