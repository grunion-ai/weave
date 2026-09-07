/* A link that leaves weave opens in a new tab (Kyle, 2026-09-07): a markdown
   link in a table's description, rendered by the server, opens beside the
   page rather than over it, and the far page never holds the opener. A
   route stays a route: the entity link in the same description docks in
   place. The far host is fulfilled by the test, so nothing leaves the
   machine. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { renderMarkdown } from '../src/markdown.js';

const FAR = 'https://docs.example.test/guide';
let glossary;
const s = await launch('external links', (weave) => {
  weave.createSpace({ name: 'Ops' });
  glossary = weave.createTable({ space: 'Ops', name: 'Glossary', description: `Terms live in [the guide](${FAR}) and in [this space](#/table/x).` });
});

test('the server marks a link that leaves weave and leaves a route alone', () => {
  const html = renderMarkdown('[far](https://a.b/c) [route](#/entity/1) [path](/e/1) [frag](#top)');
  assert.match(html, /<a href="https:\/\/a.b\/c" target="_blank" rel="noopener">far<\/a>/);
  assert.match(html, /<a href="#\/entity\/1">route<\/a>/);
  assert.match(html, /<a href="\/e\/1">path<\/a>/);
  assert.match(html, /<a href="#top">frag<\/a>/);
});

if (s) {
  const { base, browser } = s;
  test('a description link to a far site opens a new tab and the page stays put', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.context().route('https://docs.example.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>guide</title>ok' }));
    await page.goto(`${base}/#/table/${glossary.id}`, { waitUntil: 'networkidle' });
    const far = page.locator(`.view-desc-body a[href="${FAR}"]`);
    await far.waitFor();
    assert.equal(await far.getAttribute('target'), '_blank', 'marked by the server render');
    const [popup] = await Promise.all([page.context().waitForEvent('page'), far.click()]);
    await popup.waitForLoadState();
    assert.equal(popup.url(), FAR);
    assert.equal(await popup.evaluate(() => window.opener), null, 'noopener held');
    assert.ok(page.url().includes(`#/table/${glossary.id}`), 'the table is still open');
    const route = page.locator('.view-desc-body a[href="#/table/x"]');
    assert.equal(await route.getAttribute('target'), null, 'a route carries no target');
    await popup.close();
    await page.close();
  });

  test('an anchor drawn by the client without a target is retargeted the moment it is clicked', async () => {
    const page = await browser.newPage();
    await page.context().route('https://far.example.test/**', (route) => route.fulfill({ body: 'ok' }));
    await page.goto(`${base}/#/table/${glossary.id}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const a = document.createElement('a'); a.id = 'stray'; a.href = 'https://far.example.test/x'; a.textContent = 'stray';
      document.body.append(a);
      const r = document.createElement('a'); r.id = 'home'; r.href = '#/'; r.textContent = 'home';
      document.body.append(r);
    });
    const [popup] = await Promise.all([page.context().waitForEvent('page'), page.click('#stray')]);
    assert.equal(popup.url(), 'https://far.example.test/x');
    assert.ok(page.url().includes(`#/table/${glossary.id}`), 'the page did not follow');
    assert.equal(await page.getAttribute('#home', 'target'), null, 'a route is never retargeted');
    await popup.close();
    await page.close();
  });
}
