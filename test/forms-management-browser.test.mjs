import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { listForms, createForm, getForm } from '../src/forms.js';

const app = await launch('Native form management', w => {
  w.createSpace({ name: 'Intake' });
  const table = w.createTable({ space: 'Intake', name: 'Request' });
  w.addField(table.id, { name: 'Link', type: 'url' });
  w.addField(table.id, { name: 'Count', type: 'number' });
  w.addField(table.id, { name: 'Reporter', type: 'text' });
  w.addField(table.id, { name: 'Notes', type: 'document' });
  w.addField(table.id, { name: 'Period', type: 'date' });
  w.addField(table.id, { name: 'Tags', type: 'multiselect', config: { options: ['One', 'Two', 'Three'] } });
  w.addField(table.id, { name: 'Urgent', type: 'checkbox' });
  const preserved = createForm(w, { name: 'Existing intake', table: table.id, fields: [{ field: 'Name', key: 'title', aliases: ['old_title'], required: true }, { field: 'Notes', default: 'First line\nSecond line' }, { field: 'Period', default: '2026-10' }], hidden: { Reporter: '$actor' } });
  const observer = w.createAccount({ name: 'viewer', role: 'observer' });
  const architect = w.createAccount({ name: 'builder', role: 'architect' });
  return { table, preserved, observer, architect };
});

if (app) for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
  test(`native forms lifecycle at ${width}px in ${theme}`, async () => {
    const { browser, base, table, weave, architect } = app;
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    const page = await context.newPage();
    try {
      await page.context().addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: weave.createSession(architect.account.id).token, url: base }]);
      await page.goto(`${base}/#/db/${table.id}`);
      await page.locator('.table-tools-btn').waitFor({ state: 'attached' });
      await page.getByRole('button', { name: 'Table actions', exact: true }).filter({ visible: true }).click();
      await page.getByRole('menuitem', { name: 'Forms…', exact: true }).filter({ visible: true }).click();
      await page.getByRole('button', { name: 'Create form', exact: true }).click();
      assert.equal(await page.getByLabel('Audience', { exact: true }).count(), 0);
      assert.equal(await page.getByText('Anyone in this open workspace', { exact: true }).isVisible(), true);
      assert.equal(await page.getByText('Anyone with link requires public forms to be enabled by your server operator.', { exact: true }).count(), 0);
      const title = `Intake ${theme} ${width}`;
      await page.getByLabel('Form name', { exact: true }).fill(title);
      const name = page.locator('[data-form-field]').filter({ has: page.getByText('Name', { exact: true }) });
      await name.locator('summary').click();
      await name.getByLabel('Label', { exact: true }).fill('Request title');
      await name.getByLabel('Key', { exact: true }).fill('title');
      await name.getByLabel('Required', { exact: true }).check();
      const count = page.locator('[data-form-field]').filter({ has: page.getByText('Count', { exact: true }) });
      await count.locator('summary').click();
      await count.getByLabel('Include Count', { exact: true }).check();
      await count.getByLabel('Use a default', { exact: true }).check();
      await count.getByLabel('Default value', { exact: true }).fill('3');
      await page.screenshot({ path: `/tmp/weave-form-editor-${theme}-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Save form', exact: true }).click();
      await page.getByRole('heading', { name: 'Forms', exact: true }).waitFor();
      const form = listForms(weave).find(f => f.name === title);
      assert.ok(form);
      const item = page.locator('[data-form-id]').filter({ has: page.getByText(title, { exact: true }) });
      await item.getByRole('button', { name: 'Copy link' }).click();
      assert.equal(await item.getByRole('link', { name: 'Open', exact: true }).getAttribute('href'), `${base}/f/${form.id}`);
      const capture = await context.newPage();
      await capture.goto(`${base}/f/${form.id}`);
      await capture.getByLabel('Request title', { exact: true }).fill(`Submitted ${title}`);
      await capture.getByRole('button', { name: 'Send', exact: true }).click();
      await capture.getByRole('button', { name: 'Sent', exact: true }).waitFor();
      await capture.close();
      await item.getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByLabel('Form name', { exact: true }).fill(title + ' updated');
      await page.getByRole('button', { name: 'Save form', exact: true }).click();
      assert.equal(listForms(weave).find(f => f.name === title + ' updated').id, form.id);
      await page.locator(`[data-form-id="${form.id}"]`).getByRole('button', { name: 'Pause', exact: true }).click();
      await page.locator(`[data-form-id="${form.id}"]`).getByRole('button', { name: 'Enable', exact: true }).waitFor();
      assert.equal(listForms(weave).find(f => f.id === form.id).enabled, false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/weave-form-builder-${theme}-${width}.png`, fullPage: true });
    } finally { await context.close(); }
  });
}


if (app) test('editing preserves hidden fields and aliases, and observers have no form management action', async () => {
  const { browser, base, table, weave, preserved, observer, architect } = app;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.context().addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: weave.createSession(architect.account.id).token, url: base }]);
    await page.goto(`${base}/#/db/${table.id}`);
    await page.getByRole('button', { name: 'Table actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Forms…', exact: true }).filter({ visible: true }).click();
    await page.locator(`[data-form-id="${preserved.id}"]`).getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.getByLabel('Include Reporter', { exact: true }).count(), 0);
    const summary = page.locator('[data-form-field]').filter({ has: page.getByText('Name', { exact: true }) }).locator('summary');
    await page.getByLabel('Form name', { exact: true }).focus();
    for (let i = 0; i < 12 && !await summary.evaluate(node => node === document.activeElement); i++) await page.keyboard.press('Tab');
    assert.equal(await summary.evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.locator('[data-form-field]').filter({ has: page.getByText('Name', { exact: true }) }).getByLabel('Label', { exact: true }).waitFor({ state: 'visible' });
    const notes = page.locator('[data-form-field]').filter({ has: page.getByText('Notes', { exact: true }) });
    await notes.locator('summary').click();
    assert.equal(await notes.getByLabel('Default value', { exact: true }).evaluate(node => node.tagName), 'TEXTAREA');
    assert.equal(await notes.getByLabel('Default value', { exact: true }).inputValue(), 'First line\nSecond line');
    await page.getByLabel('Form name', { exact: true }).fill('Existing intake updated');
    await page.getByRole('button', { name: 'Save form', exact: true }).click();
    await page.getByRole('heading', { name: 'Forms', exact: true }).waitFor();
    const after = getForm(weave, preserved.id);
    assert.ok(after.fields[0].aliases.includes('old_title'));
    assert.equal(after.fields[0].key, 'title');
    assert.deepEqual(after.hidden, ['Reporter']);
    assert.equal(after.fields.find(f => f.field === 'Notes').default, 'First line\nSecond line');
    assert.equal(after.fields.find(f => f.field === 'Period').default, '2026-10');
  } finally { await page.close(); }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await context.addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: weave.createSession(observer.account.id).token, url: base }]);
    const viewer = await context.newPage();
    await viewer.goto(`${base}/#/db/${table.id}`);
    await viewer.getByRole('button', { name: 'Table actions', exact: true }).click();
    assert.equal(await viewer.getByRole('menuitem', { name: 'Forms…', exact: true }).count(), 0);
  } finally { await context.close(); }
});

if (app) test('a choice default is picked through the picker: several for a multiselect, Yes or No for a checkbox', async () => {
  const { browser, base, table, weave, architect } = app;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.context().addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: weave.createSession(architect.account.id).token, url: base }]);
    await page.goto(`${base}/#/db/${table.id}`);
    await page.getByRole('button', { name: 'Table actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Forms…', exact: true }).filter({ visible: true }).click();
    await page.getByRole('button', { name: 'Create form', exact: true }).click();
    await page.getByLabel('Form name', { exact: true }).fill('Picked defaults');
    assert.equal(await page.locator('#modal select').count(), 0, 'no native select in the form editor');
    const row = (name) => page.locator('[data-form-field]').filter({ has: page.getByText(name, { exact: true }) });
    const pickRow = (label) => page.locator('.picker-pop .picker-row', { has: page.getByText(label, { exact: true }) }).click();
    await row('Tags').locator('summary').click();
    await row('Tags').getByLabel('Include Tags', { exact: true }).check();
    await row('Tags').getByLabel('Use a default', { exact: true }).check();
    await row('Tags').locator('.picker-face').click();
    await pickRow('Three');
    await pickRow('One');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.picker-pop'));
    assert.equal((await row('Tags').locator('.picker-face').innerText()).trim(), 'Three, One');
    await row('Urgent').locator('summary').click();
    await row('Urgent').getByLabel('Include Urgent', { exact: true }).check();
    await row('Urgent').getByLabel('Use a default', { exact: true }).check();
    await row('Urgent').locator('.picker-face').click();
    await pickRow('Yes');
    await page.getByRole('button', { name: 'Save form', exact: true }).click();
    await page.getByRole('heading', { name: 'Forms', exact: true }).waitFor();
    const form = getForm(weave, listForms(weave).find(f => f.name === 'Picked defaults').id);
    assert.deepEqual(form.fields.find(f => f.field === 'Tags').default, ['Three', 'One']);
    assert.equal(form.fields.find(f => f.field === 'Urgent').default, true);
  } finally { await page.close(); }
});
