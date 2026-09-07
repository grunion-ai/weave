/* The url cell in a real browser: a click opens the link in a new tab and
   the page stays where it was; the pencil, a double-click, and Return swap
   the input in; blur saves and the link returns with the new address; an
   empty or non-http value is the plain text box. The link points at a host
   the test fulfils itself, so nothing leaves the machine. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const DOCS = 'https://docs.example.test/api/v2#entities';
let vendors, website, fibery, blank, junk;
const s = await launch('url cell', (weave) => {
  weave.createSpace({ name: 'Ops' });
  vendors = weave.createTable({ space: 'Ops', name: 'Vendor' });
  website = weave.addField(vendors, { name: 'Website', type: 'url' });
  fibery = weave.createEntity(vendors, { name: 'Fibery', values: { Website: DOCS } });
  blank = weave.createEntity(vendors, { name: 'Nobody' });
  junk = weave.createEntity(vendors, { name: 'Scribble', values: { Website: 'not a url' } });
});

if (s) {
  const { base, browser } = s;
  const cell = (id) => `tr[data-eid="${id}"] td[data-field="Website"]`;
  async function open(path) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.context().route('https://docs.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>docs</title>ok' }));
    await page.goto(`${base}/${path}`, { waitUntil: 'networkidle' });
    return page;
  }

  test('a url cell rests as a link; empty and non-http values rest as the text box', async () => {
    const page = await open(`#/table/${vendors.id}`);
    const a = page.locator(`${cell(fibery.id)} a.url-link`);
    await a.waitFor();
    assert.equal(await a.getAttribute('href'), DOCS);
    assert.equal(await a.getAttribute('target'), '_blank');
    assert.match(await a.getAttribute('rel'), /noopener/);
    assert.equal(await a.locator('.url-host').textContent(), 'docs.example.test');
    assert.equal(await a.locator('.url-rest').textContent(), '/api/v2#entities');
    assert.equal(await page.locator(`${cell(blank.id)} input`).count(), 1, 'empty: the text box');
    assert.equal(await page.locator(`${cell(junk.id)} input`).inputValue(), 'not a url', 'not a url: the text box, value intact');
    assert.equal(await page.locator(`${cell(junk.id)} a`).count(), 0);
    await page.close();
  });

  test('a click opens the link in a new tab and the grid stays put', async () => {
    const page = await open(`#/table/${vendors.id}`);
    await page.waitForSelector(`${cell(fibery.id)} a.url-link`);
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.click(`${cell(fibery.id)} a.url-link`),
    ]);
    await popup.waitForLoadState();
    assert.equal(popup.url(), DOCS);
    assert.equal(await popup.evaluate(() => window.opener), null, 'noopener held');
    assert.ok(page.url().includes(`#/table/${vendors.id}`), 'the grid did not navigate');
    assert.equal(await page.locator('#dock').isVisible(), false, 'nothing docked');
    await popup.close();
    await page.close();
  });

  test('the pencil swaps the input in, blur saves, and the link returns with the new address', async () => {
    const page = await open(`#/table/${vendors.id}`);
    await page.waitForSelector(`${cell(fibery.id)} a.url-link`);
    await page.hover(`${cell(fibery.id)} .url-dressed`);
    await page.click(`${cell(fibery.id)} .url-edit`);
    const input = page.locator(`${cell(fibery.id)} input`);
    assert.equal(await input.inputValue(), DOCS, 'the input carries the stored value');
    await input.fill('https://docs.example.test/api/v3');
    await page.keyboard.press('Tab');
    await page.waitForSelector(`${cell(fibery.id)} a.url-link[href="https://docs.example.test/api/v3"]`);
    assert.equal(s.weave.getEntity(fibery.id).values[website.id], 'https://docs.example.test/api/v3');
    // put it back for the suites after this one
    s.weave.updateEntity(fibery.id, { Website: DOCS });
    await page.close();
  });

  test('double-click and Return on the focused cell also open the editor', async () => {
    const page = await open(`#/table/${vendors.id}`);
    await page.waitForSelector(`${cell(fibery.id)} a.url-link`);
    await page.dblclick(`${cell(fibery.id)} .url-dressed`);
    assert.equal(await page.locator(`${cell(fibery.id)} input`).count(), 1, 'double-click edits');
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector(`${cell(fibery.id)} a.url-link`);
    await page.focus(cell(fibery.id));
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(`${cell(fibery.id)} input`).count(), 1, 'Return edits');
    await page.close();
  });

  test('the entity page draws the same link', async () => {
    const page = await open(`#/entity/${fibery.id}`);
    const a = page.locator('.fieldrow a.url-link');
    await a.waitFor();
    assert.equal(await a.getAttribute('href'), DOCS);
    assert.equal(await a.getAttribute('target'), '_blank');
    await page.close();
  });
}
