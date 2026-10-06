import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('search views', (weave) => {
  weave.createSpace({ name: 'Ops' });
  const tickets = weave.createTable({ space: 'Ops', name: 'Ticket' });
  weave.createEntity(tickets, { name: 'Printer jam' });
  const view = weave.createView({ name: 'Triage board', blocks: [{ table: tickets.id }] });
  return { view };
});

if (s) {
  const { base, browser } = s;

  test('a ⌘K view hit is labelled a view and a pick opens the view', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('#search-btn');
    await page.fill('#cmdk-input', 'triage');
    await page.waitForSelector('#cmdk-results[data-query="triage"] .result');
    const label = await page.locator('#cmdk-results .result .cmdk-where').first().textContent();
    assert.match(label, /view/, `the hit says what it is (got "${label}")`);
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => location.hash === `#/view/${id}`, s.view.id, { timeout: 5000 });
    await ctx.close();
  });
}
