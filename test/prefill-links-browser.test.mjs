import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let saves, reading;
const s = await launch('prefill-links', (weave) => {
  weave.createSpace({ name: 'Library' });
  saves = weave.createTable({ space: 'Library', name: 'Saves' });
  const topics = weave.createTable({ space: 'Library', name: 'Topics' });
  weave.addField(saves, { name: 'Link', type: 'url' });
  weave.addField(saves, { name: 'Source', type: 'select', config: { options: ['Squirrel', 'Manual'] } });
  weave.addRelation(saves, { name: 'Topic', targetDb: topics, cardinality: 'many-to-one', inverseName: 'Saves' });
  reading = weave.createEntity(topics, { name: 'Reading' });
});

if (s) {
  const { base, browser, weave } = s;
  const rows = () => weave.listEntities(saves.id).filter((e) => !e.deletedAt);
  const stubClipboard = (page) => page.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } } });
  });

  test('a prefill link opens the new-row form filled in, names the unknown field, and creates nothing until Save', async () => {
    const page = await browser.newPage();
    const q = new URLSearchParams([['Name', 'A good read'], ['Link', 'https://x.example/a?b=c'], ['Source', 'squirrel'], ['Topic', 'reading'], ['Bogus', '1']]);
    await page.goto(`${base}/t/${saves.id}/new?${q}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tray .wv-prefill [name="Name"]');
    assert.equal(await page.inputValue('#tray [name="Name"]'), 'A good read');
    assert.equal(await page.inputValue('#tray [name="Link"]'), 'https://x.example/a?b=c');
    assert.equal(await page.inputValue('#tray select[name="Source"]'), 'Squirrel');
    assert.equal(await page.inputValue('#tray [name="Topic"]'), 'Reading');
    assert.match(await page.textContent('#tray .wv-prefill-rows[data-field="Topic"]'), /Reading/);
    assert.match(await page.textContent('#tray .wv-prefill-notice'), /Bogus/);
    assert.equal(await page.evaluate(() => location.hash), `#/table/${saves.id}`);
    assert.equal(rows().length, 0, 'opening the link created no row');
    await page.click('#tray button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#tray'));
    assert.equal(rows().length, 1);
    const made = weave.readEntity(rows()[0].id).fields;
    assert.equal(made.Name, 'A good read');
    assert.equal(made.Link, 'https://x.example/a?b=c');
    assert.equal(made.Source, 'Squirrel');
    assert.equal(made.Topic?.id ?? made.Topic?.[0]?.id, reading.id);
    weave.deleteEntity(rows()[0].id);
    await page.close();
  });

  test('a value that does not resolve is reported and Cancel leaves no row', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/t/${saves.id}/new?Name=x&Source=Pigeon&Topic=Nowhere`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#tray .wv-prefill-notice');
    const notice = await page.textContent('#tray .wv-prefill-notice');
    assert.match(notice, /'Pigeon' is not an option of 'Source'/);
    assert.match(notice, /'Nowhere'/);
    assert.equal(await page.inputValue('#tray select[name="Source"]'), '');
    await page.click('#tray .tray-actions .btn:not(.btn-primary)');
    await page.waitForFunction(() => !document.querySelector('#tray'));
    assert.equal(rows().length, 0);
    await page.close();
  });

  test('Copy create link: the table menu copies the bare link, the form copies what is filled in so far', async () => {
    const page = await browser.newPage();
    await stubClipboard(page);
    await page.goto(`${base}/#/table/${saves.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .crumb-actions .dots-btn');
    await page.locator('.crumb-actions .dots-btn').last().click();
    await page.locator('.dl-menu .dropdown-item', { hasText: 'Copy create link' }).first().click();
    await page.waitForFunction(() => window.__copied.length === 1);
    assert.equal(await page.evaluate(() => window.__copied[0]), `${base}/t/${saves.id}/new`);
    await page.evaluate((id) => { location.hash = `#/table/${id}/new?Name=Draft`; }, saves.id);
    await page.waitForSelector('#tray .wv-prefill [name="Name"]');
    await page.fill('#tray [name="Link"]', 'https://y.example/');
    await page.selectOption('#tray select[name="Source"]', 'Manual');
    await page.click('#tray .wv-prefill-copy');
    await page.waitForFunction(() => window.__copied.length === 2);
    const copied = new URL(await page.evaluate(() => window.__copied[1]));
    assert.equal(copied.origin + copied.pathname, `${base}/t/${saves.id}/new`);
    assert.deepEqual(Object.fromEntries(copied.searchParams), { Name: 'Draft', Link: 'https://y.example/', Source: 'Manual' });
    assert.equal(rows().length, 0);
    await page.close();
  });
}
