/* Issue #285, the rules list: the relation map stacks a table's automations as
   pills under its card, in the order GET /api/automations returns them. That
   order was the order the store happened to read the rules back in; it is now
   seq, the fire order. The seed builds two rules and then reorders the
   in-memory object backwards, which is what a pre-seq read that returned the
   rows in another order left behind. Playwright is NOT a dependency; the
   suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('automation seq', (w) => {
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Ticket' });
  w.createAutomation(t, { name: 'First', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'hi' }] });
  w.createAutomation(t, { name: 'Second', trigger: { type: 'entity-created' }, actions: [{ type: 'append-doc', text: 'x' }] });
  w.state.automations = Object.fromEntries(Object.entries(w.state.automations).reverse());
  return { table: t };
});

if (s) {
  const { base, browser, table } = s;

  test('the relation map stacks a table\'s rules in fire order', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const api = await (await fetch(`${base}/api/automations`)).json();
    assert.deepEqual(api.map((a) => [a.name, a.seq]), [['First', 1], ['Second', 2]], 'the API lists by seq');

    await page.goto(`${base}/#/map`, { waitUntil: 'networkidle' });
    await page.waitForSelector('svg.relmap g.auto');
    // Pills are drawn top to bottom in list order; read them back by height.
    const pills = await page.$$eval('svg.relmap g.auto', (gs) => gs
      .map((g) => ({ y: Number(g.querySelector('rect').getAttribute('y')), text: g.querySelector('title').textContent }))
      .sort((a, b) => a.y - b.y).map((p) => p.text));
    assert.deepEqual(pills, ['⚡ created ⇒ comment', '⚡ created ⇒ append Description'],
      `the first rule to fire sits on top (table ${table.name})`);
    await page.close();
  });
}
