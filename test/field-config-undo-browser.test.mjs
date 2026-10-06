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

    test(`a recolour reads as the option's two chips; the definitions wait behind Show definitions (Issue #554, ${colorScheme})`, async () => {
      const opts = (p3) => [{ id: 'p0', name: 'P0', hue: 'red' }, { id: 'p1', name: 'P1', hue: 'orange' }, { id: 'p2', name: 'P2', hue: 'amber' }, { id: 'p3', name: 'P3', hue: p3 }];
      const f = weave.addField(t, { name: `Priority ${colorScheme}`, type: 'select', config: { options: opts('teal') } });
      weave.updateField(t.id, f.id, { config: { options: opts('green') } });
      const entry = entryFor(f.id);
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/activity/${entry.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.field-change');
        const items = page.locator('.field-change-item');
        assert.equal(await items.count(), 1, 'only the option that changed is listed');
        const item = await items.first().evaluate((n) => ({
          chips: [...n.querySelectorAll('.k-select')].map((c) => ({ text: c.textContent.trim(), cls: c.className })),
          marks: n.querySelector('.field-change-marks')?.textContent ?? '',
        }));
        assert.deepEqual(item.chips.map((c) => c.text), ['P3', 'P3'], 'the option before and after, as chips');
        assert.match(item.chips[0].cls, /hue-teal/);
        assert.match(item.chips[1].cls, /hue-green/);
        assert.match(item.marks, /recoloured/i);
        assert.match(await page.locator('.field-change-unchanged').textContent(), /3 unchanged/);
        assert.equal(await page.locator('.activity-defs').evaluate((n) => n.open), false, 'the definitions start folded');
        assert.equal(await page.locator('.activity-defs pre').first().isVisible(), false, 'no raw JSON on the page until asked');
        await page.click('.activity-defs > summary');
        const before = await page.locator('.activity-defs pre').first().textContent();
        assert.match(before, /^\{\n {2}"name": "Priority/, 'pretty-printed with a two-space indent');
        assert.ok(await page.locator('.activity-rollback').isVisible(), 'Roll back is still on the page');
        const colours = await page.locator('.field-change-item .k-select').first().evaluate((n) => ({ fg: getComputedStyle(n).color, bg: getComputedStyle(n).backgroundColor }));
        assert.notEqual(colours.fg, colours.bg, 'the chip is legible in this theme');
      } finally { await page.close(); }
    });

    test(`a type change in the tray offers Undo, and Undo brings the numbers back (${colorScheme})`, async () => {
      const name = `Count ${colorScheme}`;
      const f = weave.addField(t, { name, type: 'number' });
      const rows = [weave.createEntity(t, { name: `n1 ${colorScheme}`, values: { [name]: 12.5 } }), weave.createEntity(t, { name: `n2 ${colorScheme}`, values: { [name]: 3 } })];
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/table/${t.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-grid th.col-head');
        await page.evaluate((n) => [...document.querySelectorAll('.wv-grid th.col-head')].find((h) => h.textContent.includes(n)).click(), name);
        await page.waitForSelector('#tray-back .type-tile');
        await page.click('#tray-back .type-tile[title^="Convert to text"]');
        await page.click('.tray-actions .btn-primary, .tray .btn-primary');
        await page.waitForFunction((n) => [...document.querySelectorAll('#wv-toasts .wv-toast-msg')].some((m) => m.textContent.startsWith(`${n} is now text`)), name, { timeout: 10000 });
        assert.equal(weave.getField(t.id, f.id).type, 'text');
        const up = (await toastText(page)).find((x) => x.text.startsWith(`${name} is now text`));
        assert.equal(up.action, 'Undo', 'a type change offers Undo like any other change');
        assert.ok(!/no Undo|converted/.test(up.text), 'and no longer says the values are gone');
        assert.notEqual(up.fg, up.bg, 'legible in this theme');
        await page.evaluate((n) => [...document.querySelectorAll('#wv-toasts .wv-toast')].find((x) => x.textContent.includes(`${n} is now text`)).querySelector('.wv-toast-action').click(), name);
        await page.waitForFunction((n) => [...document.querySelectorAll('#wv-toasts .wv-toast-msg')].some((m) => m.textContent.startsWith(`${n} restored: 2 values back`)), name, { timeout: 10000 });
        assert.equal(weave.getField(t.id, f.id).type, 'number');
        assert.deepEqual(rows.map((r) => weave.getEntity(r.id).values[f.id]), [12.5, 3], 'the exact numbers');
      } finally { await page.close(); }
    });

    test(`Roll back of a type change counts the edited and the newer rows (${colorScheme})`, async () => {
      const name = `Grade ${colorScheme}`;
      const f = weave.addField(t, { name, type: 'select', config: { options: [{ id: 'g-a', name: 'A', hue: 'green' }, { id: 'g-b', name: 'B', hue: 'red' }] } });
      const kept = weave.createEntity(t, { name: `k ${colorScheme}`, values: { [name]: 'A' } });
      const edited = weave.createEntity(t, { name: `e ${colorScheme}`, values: { [name]: 'A' } });
      weave.updateField(t.id, f.id, { type: 'text' });
      const entry = entryFor(f.id);
      weave.updateEntity(edited.id, { [name]: 'B' });
      const newer = weave.createEntity(t, { name: `n ${colorScheme}`, values: { [name]: 'B' } });
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/activity/${entry.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.activity-rollback');
        assert.match(await page.locator('.fieldrow', { hasText: 'Values' }).first().innerText(), /2 values from before this change kept/);
        await page.click('.activity-rollback');
        await page.waitForFunction((n) => [...document.querySelectorAll('#wv-toasts .wv-toast-msg')].some((m) => m.textContent.startsWith(`${n} rolled back: 1 value back, 1 edited since, kept, 1 newer row converted`)), name, { timeout: 10000 });
        assert.equal(weave.getField(t.id, f.id).type, 'select');
        assert.equal(weave.getEntity(kept.id).values[f.id], 'g-a', 'the option id came back');
        assert.equal(weave.getEntity(edited.id).values[f.id], 'g-b', 'the edit stands');
        assert.equal(weave.getEntity(newer.id).values[f.id], 'g-b', 'the newer row converted');
      } finally { await page.close(); }
    });

    test(`a dropped snapshot says so plainly (${colorScheme})`, async () => {
      const name = `Level ${colorScheme}`;
      const f = weave.addField(t, { name, type: 'number' });
      weave.createEntity(t, { name: `l ${colorScheme}`, values: { [name]: 4 } });
      weave.updateField(t.id, f.id, { type: 'text' });
      const first = entryFor(f.id);
      weave.updateField(t.id, f.id, { type: 'number' });
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/activity/${first.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.activity-rollback-reason');
        assert.match(await page.$eval('.activity-rollback-reason', (n) => n.textContent), /no longer kept/);
        assert.match(await page.locator('.fieldrow', { hasText: 'Values' }).first().innerText(), /No longer kept/);
        const legible = await page.$eval('.activity-rollback-reason', (n) => getComputedStyle(n).color !== getComputedStyle(document.body).backgroundColor);
        assert.ok(legible, 'legible in this theme');
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
        weave.updateField(t.id, f.id, { config: { options: [{ id: 's', name: 'S' }, { id: 'l', name: 'L' }] } });
        await page.click('.activity-rollback');
        await page.waitForFunction(() => [...document.querySelectorAll('#wv-toasts .wv-toast.err .wv-toast-msg')].some((m) => /changed again/.test(m.textContent)), null, { timeout: 10000 });
        assert.deepEqual(weave.getField(t.id, f.id).config.options.map((o) => o.name), ['S', 'L'], 'the newer change stands');
        await page.waitForSelector('.activity-rollback-reason');
      } finally { await page.close(); }
    });
  }
}
