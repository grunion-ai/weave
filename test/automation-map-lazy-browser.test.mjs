import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { LAZY, read } from './lib/source.mjs';

const FILE = '/automation-map.js';
let plain, ticket, row;
const s = await launch('automation map lazy', (weave) => {
  weave.createSpace({ name: 'Ops' });
  ticket = weave.createTable({ space: 'Ops', name: 'Ticket' });
  plain = weave.createTable({ space: 'Ops', name: 'Note' });
  row = weave.createEntity(plain, { name: 'Plain' });
  weave.createAutomation(ticket, { name: 'Greet', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'hi' }] });
});

test('the automation pills live in automation-map.js, and app.js keeps only their loader (Issue #1041)', () => {
  const app = read('public/app.js');
  const view = read(`public${FILE}`);
  for (const fn of ['drawAutomationPills', 'automationTrigger']) {
    assert.match(view, new RegExp(`function ${fn}\\(`), `${fn} is in automation-map.js`);
    assert.doesNotMatch(app, new RegExp(`function ${fn}\\(`), `app.js no longer carries ${fn}`);
  }
  assert.match(view, /const AUTO_ACTION = /);
  assert.doesNotMatch(app, /const AUTO_ACTION = /);
  assert.ok(LAZY.includes(`public${FILE}`), 'the cold-load gate watches the file');
});

if (s) {
  const { base, browser } = s;
  const watch = (page) => {
    const fetched = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname === FILE) fetched.push(FILE); });
    return fetched;
  };

  for (const [name, hash, ready] of [
    ['table', () => `#/table/${plain.id}`, '.wv-grid tbody tr.entity-row'],
    ['row', () => `#/entity/${row.id}`, '.wv-entity, main h1, main'],
  ]) {
    test(`a cold ${name} load fetches no ${FILE} (Issue #1041)`, async () => {
      const page = await browser.newPage();
      try {
        const fetched = watch(page);
        await page.goto(`${base}/${hash()}`, { waitUntil: 'networkidle' });
        await page.waitForSelector(ready);
        assert.deepEqual(fetched, []);
      } finally { await page.close(); }
    });
  }

  test('a map with an automation fetches the file once and draws its pill (Issue #1041)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      const fetched = watch(page);
      await page.goto(`${base}/#/map`, { waitUntil: 'networkidle' });
      await page.locator('svg.relmap g.auto title', { hasText: '⚡ created ⇒ comment' }).waitFor({ state: 'attached' });
      assert.deepEqual(fetched, [FILE]);
      await page.evaluate(() => { location.hash = '#/'; });
      await page.locator('.home-map svg.relmap g.auto').first().waitFor({ state: 'attached' });
      assert.deepEqual(fetched, [FILE], 'the home map reuses the loaded file');
    } finally { await page.close(); }
  });

  test('a map whose automation file fails to load says so and still draws its tables (Issue #1041)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.route(`**${FILE}`, (r) => r.abort());
      await page.goto(`${base}/#/map`, { waitUntil: 'networkidle' });
      await page.locator('#wv-toasts', { hasText: 'Automations did not load' }).waitFor();
      await page.locator('svg.relmap g.table-node', { hasText: 'Ticket' }).waitFor();
      assert.equal(await page.locator('svg.relmap g.auto').count(), 0);
    } finally { await page.close(); }
  });
}
