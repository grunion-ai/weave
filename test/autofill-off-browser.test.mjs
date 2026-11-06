import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';

let table;

const s = await launch('autofill off', (weave) => {
  weave.createSpace({ name: 'Lab' });
  table = weave.createTable({ space: 'Lab', name: 'Session' });
  weave.addField(table, { name: 'Owner', type: 'text' });
  weave.addField(table, { name: 'Phone', type: 'text' });
  weave.createEntity(table, { name: 'Latest Plumbline demo', values: { Owner: 'Kyle', Phone: '555' } });
});

const unguarded = () => [...document.querySelectorAll('input, textarea')]
  .filter((n) => !['checkbox', 'radio', 'file', 'hidden', 'range', 'color', 'submit', 'button'].includes(n.type))
  .filter((n) => !n.hasAttribute('autocomplete'))
  .map((n) => n.outerHTML.slice(0, 120));

if (s) {
  test('every grid editor opts out of browser autofill, so Safari offers no contact card in a Name cell', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${s.base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.inline-edit');
      assert.deepEqual(await page.evaluate(unguarded), []);
    } finally { await page.close(); }
  });
}

test('the stylesheet hides the WebKit contacts autofill button on fields that opt out', () => {
  const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\[autocomplete="off"\]::-webkit-contacts-auto-fill-button/);
});
