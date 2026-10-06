import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let cases, grid;
const s = await launch('grid asks for its columns', (weave) => {
  weave.createSpace({ name: 'Quality' });
  const suites = weave.createTable({ space: 'Quality', name: 'Suite' });
  cases = weave.createTable({ space: 'Quality', name: 'Case' });
  weave.addField(suites, { name: 'File', type: 'text' });
  weave.addField(cases, { name: 'Line', type: 'number' });
  weave.addField(cases, { name: 'Owner', type: 'text' });
  weave.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  grid = weave.createEntity(suites, { name: 'grid.test.mjs', values: { File: 'test/grid.test.mjs' }, doc: 'A long description. '.repeat(40) });
  for (let i = 0; i < 5; i++) {
    const c = weave.createEntity(cases, { name: `case ${i}`, values: { Line: i * 10, Owner: `owner ${i}`, Suite: grid.id }, doc: `about case ${i}` });
    weave.addComment(c.id, { text: 'a comment the grid never draws' });
  }
  weave.updateTable(cases, { hiddenFields: ['Owner'], systemFields: ['Activity'], sort: [{ field: 'Line', dir: 'asc' }] });
});

if (s) {
  const { base, browser } = s;
  const queries = (page) => {
    const seen = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === `/api/tables/${cases.id}/query`) {
        seen.push({ body: r.postDataJSON(), res: r.response().then((x) => x.json()) });
      }
    });
    return seen;
  };

  for (const theme of ['light', 'dark']) {
    test(`the page names its columns and asks for chip-level relations (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.emulateMedia({ colorScheme: theme });
      const seen = queries(page);
      await page.goto(`${base}/#/table/${cases.id}`, { waitUntil: 'load' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 5);
      assert.equal(seen.length, 1, 'one query opens the table');
      const { body } = seen[0];
      assert.deepEqual([...body.fields].sort(), ['Activity', 'Card', 'Chip', 'Description', 'Line', 'Name', 'Suite'],
        'the visible columns, and the shown system column; the hidden Owner is not asked for');
      assert.equal(body.relations, 'chip');
      const res = await seen[0].res;
      assert.deepEqual(Object.keys(res.chips), [grid.id], 'the suite rides once');
      assert.equal('comments' in res.items[0], false, 'no comments on a grid row');
      assert.equal('Owner' in res.items[0].fields, false);

      const chip = await page.$$eval('.wv-grid tbody td[data-field="Suite"] .k-rel', (ks) => ks.map((k) => ({
        label: k.querySelector('.k-label')?.textContent, segs: k.classList.contains('has-segs'),
        caret: !!k.querySelector('.mention-caret'), fields: k.querySelector('.mention-fields')?.textContent ?? '',
      })));
      assert.equal(chip.length, 5);
      for (const c of chip) {
        assert.equal(c.label, 'grid.test.mjs');
        assert.ok(c.segs && c.caret, 'the chip keeps its caret');
        assert.match(c.fields, /test\/grid\.test\.mjs/, 'and its segments');
      }
      const acts = await page.$$eval('.wv-grid tbody tr.entity-row td.sys-cell', (tds) => tds.map((t) => t.textContent));
      assert.ok(acts.every((t) => /^[1-9]\d*⚡$/.test(t)), `activity counted: ${acts.join(' ')}`);
      assert.match(await page.textContent('.wv-grid tbody tr.entity-row td[data-field="Description"]'), /about case 0/);
      await page.close();
    });
  }

  test('showing a hidden field from the eye fetches it and paints its values', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const seen = queries(page);
    await page.goto(`${base}/#/table/${cases.id}`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 5);
    assert.equal(await page.$('.wv-grid tbody td[data-field="Owner"]'), null, 'Owner is hidden');
    await page.click('.eye-btn');
    await page.locator('.chip-pop .eye-row', { hasText: 'Owner' }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody td[data-field="Owner"]').length === 5);
    await page.waitForFunction(() => /owner 0/.test(document.querySelector('.wv-grid tbody td[data-field="Owner"]')?.textContent
      + (document.querySelector('.wv-grid tbody td[data-field="Owner"] input')?.value ?? '')));
    const last = seen.at(-1).body;
    assert.ok(last.fields.includes('Owner'), `the re-read names Owner: ${JSON.stringify(last.fields)}`);
    const owners = await page.$$eval('.wv-grid tbody td[data-field="Owner"]', (tds) => tds.map((t) => t.querySelector('input')?.value ?? t.textContent.trim()));
    assert.deepEqual(owners, ['owner 0', 'owner 1', 'owner 2', 'owner 3', 'owner 4']);
    await page.close();
  });
}
