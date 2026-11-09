import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phonePage, phoneBrowser } from './lib/browser.mjs';

const s = await launch('workflows control panel', (w) => {
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Request' });
  w.addField(t.id, { name: 'Status', type: 'workflow', config: { states: [{ name: 'New', default: true }, { name: 'Approved' }] } });
  w.addField(t.id, { name: 'Notes', type: 'text' });
  const rule = w.createAutomation(t.id, {
    name: 'Tag approved',
    trigger: { type: 'state-changed', field: 'Status', toState: 'Approved' },
    actions: [{ type: 'set-field', field: 'Notes', value: 'approved' }, { type: 'add-comment', text: 'Approved' }],
  });
  const workflows = Object.values(w.state.tables).find((x) => x.system === 'workflows');
  return { rule, workflows };
});

if (s) {
  const { base, browser, rule, workflows } = s;
  const WHEN = 'Status moves to Approved in Ops/Request';
  const THEN = 'Set Notes to "approved", then Add a comment';
  const open = async (page) => {
    await page.goto(`${base}/#/table/${workflows.id}`, { waitUntil: 'networkidle' });
    await page.locator(`tr[data-eid="${rule.id}"] td[data-field="When"] .wf-kept`).waitFor();
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`the Workflows grid reads On, Name, When, Then, Health, Last run, and a reader never opens the Script (${colorScheme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme });
      await open(page);
      const heads = await page.locator('.wv-grid thead th[data-col]').evaluateAll((ths) => ths.map((th) => th.dataset.col));
      assert.deepEqual(heads, ['On', 'Name', 'When', 'Then', 'Health', 'Last Run']);
      const row = page.locator(`tr[data-eid="${rule.id}"]`);
      assert.equal(await row.locator('td[data-field="When"] .wf-kept').textContent(), WHEN);
      assert.equal(await row.locator('td[data-field="Then"] .wf-kept').textContent(), THEN);
      assert.equal(await row.locator('td[data-field="Then"] .wf-kept').getAttribute('title'), THEN, 'a clipped sentence reads whole on hover');
      assert.equal(await row.locator('td[data-field="When"] input, td[data-field="Then"] input, td[data-field="Last Run"] input').count(), 0, 'the engine writes them: no editor');
      const paint = await row.locator('td[data-field="When"] .wf-kept').evaluate((n) => {
        const bg = (x) => { for (; x; x = x.parentElement) { const c = getComputedStyle(x).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)') return c; } return ''; };
        return { color: getComputedStyle(n).color, bg: bg(n) };
      });
      assert.notEqual(paint.color, paint.bg, 'the sentence is visible on its row');
      await page.close();
    });
  }

  test('on a phone the Workflows row leads on Health and shows the switch and both sentences', async () => {
    const page = await phonePage(await phoneBrowser());
    await open(page);
    const row = page.locator(`[data-eid="${rule.id}"]`).first();
    assert.equal(await row.locator('.phone-lead[data-field="Health"]').count(), 1, 'Health leads the row');
    for (const name of ['On', 'When', 'Then']) {
      assert.ok(await row.locator(`[data-phone-chip][data-field="${name}"]`).isVisible(), `${name} is on the chip line`);
    }
    assert.equal(await row.locator('[data-field="When"] .wf-kept').textContent(), WHEN);
    await page.close();
  });
}
