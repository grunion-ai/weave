/* Issue #428 in a real browser: a field configuration change saved silently,
   with no toast, no Undo and nothing in Activity. Now the field tray's save
   shows the existing toast with Undo, the Undo puts the definition back, the
   change is an Activity entry whose page offers Roll back, and a roll back
   that has gone stale refuses instead of overwriting the newer change. Both
   themes. Playwright is imported dynamically by ./lib/browser.mjs; the suite
   skips on a bare checkout (house rule: zero runtime deps). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let t;
const s = await launch('field config undo', (weave) => {
  weave.createSpace({ name: 'Ops' });
  t = weave.createTable({ space: 'Ops', name: 'Ticket' });
  weave.createEntity(t, { name: 'first' });
});

if (s) {
  const { base, browser, weave } = s;
  const entryFor = (fieldId) => weave.activityFeed({ entityId: t.id }).items.find((a) => a.detail.fieldId === fieldId);
  const toastText = (page) => page.$$eval('#wv-toasts .wv-toast', (ns) => ns.map((n) => ({
    text: n.querySelector('.wv-toast-msg')?.textContent ?? '',
    action: n.querySelector('.wv-toast-action')?.textContent ?? null,
    kind: n.className,
    fg: getComputedStyle(n.querySelector('.wv-toast-msg')).color,
    bg: getComputedStyle(n).backgroundColor,
  })));

  for (const colorScheme of ['light', 'dark']) {
    test(`saving a field shows the toast with Undo, and Undo puts it back (${colorScheme})`, async () => {
      const name = `Qty ${colorScheme}`;
      const f = weave.addField(t, { name, type: 'number' });
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/table/${t.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-grid th.col-head');
        await page.evaluate((n) => [...document.querySelectorAll('.wv-grid th.col-head')].find((h) => h.textContent.includes(n)).click(), name);
        await page.waitForSelector('textarea.field-desc');
        await page.fill('textarea.field-desc', 'How many units');
        await page.click('.tray-actions .btn-primary, .tray .btn-primary');
        await page.waitForFunction((n) => [...document.querySelectorAll('#wv-toasts .wv-toast-msg')].some((m) => m.textContent.startsWith(`${n} updated`)), name, { timeout: 10000 });
        assert.equal(weave.getField(t.id, f.id).config.description, 'How many units', 'the change landed');
        const up = (await toastText(page)).find((x) => x.text.startsWith(`${name} updated`));
        assert.equal(up.action, 'Undo', 'the toast offers Undo');
        assert.notEqual(up.fg, up.bg, 'legible in this theme');
        assert.ok(entryFor(f.id), 'and the change is in Activity');
        await page.click('#wv-toasts .wv-toast-action');
        await page.waitForFunction((n) => [...document.querySelectorAll('#wv-toasts .wv-toast-msg')].some((m) => m.textContent.startsWith(`${n} restored`)), name, { timeout: 10000 });
        assert.equal(weave.getField(t.id, f.id).config.description, undefined, 'Undo applied the definition before');
        const kinds = weave.activityFeed({ entityId: t.id }).items.filter((a) => a.detail.fieldId === f.id).map((a) => a.kind);
        assert.deepEqual(kinds, ['undo', 'field-config-updated'], 'the Undo wrote its own entry');
      } finally { await page.close(); }
    });

    test(`the Activity entry offers Roll back, and it rolls back (${colorScheme})`, async () => {
      const f = weave.addField(t, { name: `Stage ${colorScheme}`, type: 'select', config: { options: [{ id: 'a', name: 'Alpha', hue: 'green' }, { id: 'b', name: 'Beta', hue: 'red' }] } });
      weave.updateField(t.id, f.id, { config: { options: [{ id: 'a', name: 'Alpha', hue: 'green' }] } });
      const entry = entryFor(f.id);
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/activity`, { waitUntil: 'networkidle' });
        await page.waitForSelector(`.activity-row[data-href="#/activity/${entry.id}"]`);
        const summary = await page.$eval(`.activity-row[data-href="#/activity/${entry.id}"]`, (r) => r.textContent);
        assert.match(summary, /options changed/, 'the table row says what changed');
        await page.click(`.activity-row[data-href="#/activity/${entry.id}"]`);
        await page.waitForSelector('.activity-rollback');
        const btn = await page.$eval('.activity-rollback', (b) => ({ text: b.textContent, fg: getComputedStyle(b).color, bg: getComputedStyle(document.body).backgroundColor }));
        assert.equal(btn.text, `Roll back ${f.name}`);
        assert.notEqual(btn.fg, btn.bg, 'legible in this theme');
        await page.click('.activity-rollback');
        await page.waitForSelector('.activity-rollback-reason');
        assert.equal(weave.getField(t.id, f.id).config.options.length, 2, 'the removed option is back');
        assert.match(await page.$eval('.activity-rollback-reason', (n) => n.textContent), /changed again/, 'the entry it reversed offers nothing now');
      } finally { await page.close(); }
    });

    test(`a stale roll back refuses and keeps the newer change (${colorScheme})`, async () => {
      const f = weave.addField(t, { name: `Size ${colorScheme}`, type: 'select', config: { options: [{ id: 's', name: 'S' }, { id: 'm', name: 'M' }] } });
      weave.updateField(t.id, f.id, { config: { options: [{ id: 's', name: 'S' }] } });
      const entry = entryFor(f.id);
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/activity/${entry.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.activity-rollback');
        // Another tab changes the field after this page loaded.
        weave.updateField(t.id, f.id, { config: { options: [{ id: 's', name: 'S' }, { id: 'l', name: 'L' }] } });
        await page.click('.activity-rollback');
        await page.waitForFunction(() => [...document.querySelectorAll('#wv-toasts .wv-toast.err .wv-toast-msg')].some((m) => /changed again/.test(m.textContent)), null, { timeout: 10000 });
        assert.deepEqual(weave.getField(t.id, f.id).config.options.map((o) => o.name), ['S', 'L'], 'the newer change stands');
        await page.waitForSelector('.activity-rollback-reason');
      } finally { await page.close(); }
    });
  }
}
