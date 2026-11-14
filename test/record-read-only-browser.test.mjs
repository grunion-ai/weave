import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf } from './lib/browser.mjs';

let ada, grace, quickstart;
const s = await launch('record read-only for observers', (w) => {
  w.updateWorkspace({ name: 'handbook' });
  w.createSpace({ name: 'Handbook' });
  const guide = w.createTable({ space: 'Handbook', name: 'Guide' });
  w.addField(guide.id, { name: 'Summary', type: 'text' });
  w.addField(guide.id, { name: 'Status', type: 'select', config: { options: ['Draft', 'Live'] } });
  w.addField(guide.id, { name: 'Body', type: 'document' });
  quickstart = w.createEntity(guide.id, { name: 'Quickstart', values: { Summary: 'Start here', Status: 'Live' }, docs: { Body: 'Install weave.' } });
  ada = w.createAccount({ name: 'Ada', role: 'editor' }).account;
  grace = w.createAccount({ name: 'Grace', role: 'observer' }).account;
});

if (s) {
  const { base, browser, weave } = s;
  const open = async (account) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: weave.createSession(account.id).token, url: base }]);
    const page = await ctx.newPage();
    const writes = [];
    page.on('request', (r) => { if (!['GET', 'HEAD'].includes(r.method()) && /\/api\/entities\/|\/api\/tables\//.test(r.url()) && !/\/comments|\/query$/.test(r.url())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.goto(`${base}/#/entity/${quickstart.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.entity-body .fieldrow[data-field="Summary"]');
    await page.waitForSelector('[data-doc-field="Body"] .vditor-ir');
    return { ctx, page, writes };
  };
  const EDITABLE = 'input:not([readonly]), textarea:not([readonly]), select, [contenteditable="true"]';

  test('an observer cannot type into the record title (Issue #1537)', async () => {
    const { ctx, page, writes } = await open(grace);
    const name = page.locator('textarea.name-edit');
    assert.equal(await name.getAttribute('readonly'), '');
    await name.click();
    await page.keyboard.type(' edited');
    await name.blur();
    assert.equal(await name.inputValue(), 'Quickstart');
    assert.deepEqual(writes, []);
    await ctx.close();
  });

  test('an observer sees the field values with no editor to type into or pick from', async () => {
    const { ctx, page, writes } = await open(grace);
    const summary = page.locator('.entity-body .fieldrow[data-field="Summary"]');
    assert.match(await summary.innerText(), /Start here/);
    await summary.getByText('Start here').click();
    assert.equal(await summary.locator(EDITABLE).count(), 0);
    const status = page.locator('.entity-body .fieldrow[data-field="Status"]');
    assert.match(await status.innerText(), /Live/);
    assert.equal(await status.locator(`${EDITABLE}, button`).count(), 0);
    await status.getByText('Live').click();
    assert.equal(await page.locator('.chip-pop').count(), 0, 'the select opens no picker');
    await summary.locator('.fieldrow-label').click();
    assert.equal(await page.locator('#modal-back').count(), 0, 'the field label opens no field dialog');
    assert.deepEqual(writes, []);
    await ctx.close();
  });

  test('an observer reads the document body without an editable surface or drag grips', async () => {
    const { ctx, page } = await open(grace);
    const body = page.locator('[data-doc-field="Body"]');
    assert.match(await body.innerText(), /Install weave\./);
    await page.waitForFunction(() => document.querySelector('[data-doc-field="Body"] .vditor-ir .vditor-reset')?.getAttribute('contenteditable') === 'false');
    assert.equal(await body.locator('.vditor-ir [contenteditable="true"]').count(), 0);
    await styleOf(body.locator('.vditor-ir .vditor-reset'), 'opacity', '1');
    assert.equal(await page.locator('.entity-body .opt-grip .wv-icon').count(), 0);
    await ctx.close();
  });

  test('an editor still edits the same record title, fields and body', async () => {
    const { ctx, page } = await open(ada);
    assert.equal(await page.locator('textarea.name-edit').getAttribute('readonly'), null);
    const summary = page.locator('.entity-body .fieldrow[data-field="Summary"]');
    await summary.getByText('Start here').click();
    await summary.locator(EDITABLE).first().waitFor();
    await page.waitForSelector('[data-doc-field="Body"] .vditor-ir [contenteditable="true"]');
    assert.ok(await page.locator('.entity-body .opt-grip .wv-icon').count() > 0);
    await ctx.close();
  });
}
