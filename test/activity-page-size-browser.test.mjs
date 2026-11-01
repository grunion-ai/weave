import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const PAGE = 500;
const EXTRA = 60;
const BYSTANDERS = 200;
const ISS = 'https://idp.test';

let table, row, dana;
const s = await launch('activity page size', (w) => {
  w.inviteIssuer = ISS;
  const users = w.getTable('System/Users');
  dana = w.createEntity(users.id, { name: 'Dana Quinn', values: { Email: 'dana@example.com', Role: 'Architect' } });
  for (let i = 0; i < BYSTANDERS; i++) {
    w.createEntity(users.id, { name: `Bystander ${i}`, values: { Email: `b${i}@example.com`, Role: 'Observer' } });
  }
  w.createSpace({ name: 'Ops' });
  table = w.createTable({ space: 'Ops', name: 'Ticket' });
  w.updateTable(table.id, { systemFields: ['Created By', 'Modified By'] });
  w.actor = 'Dana Quinn';
  row = w.createEntity(table.id, { name: 'Printer jam' });
  for (let i = 0; i < PAGE + EXTRA; i++) w.createEntity(table.id, { name: `t${i}` });
  w.actor = 'local';
  return { table, row, dana };
});

function watchUsers(page, usersId) {
  const calls = [];
  page.on('request', (r) => {
    if (r.method() !== 'POST' || !r.url().includes(`/tables/${usersId}/query`)) return;
    let body = null;
    try { body = JSON.parse(r.postData() ?? 'null'); } catch { body = null; }
    calls.push(body);
  });
  return calls;
}

if (s) {
  const { base, browser, weave } = s;
  const usersId = weave.getTable('System/Users').id;
  const total = weave.activityFeed().total;

  test('the Activity page paints one page of the feed, not every event (Issue #850)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.goto(`${base}/#/activity`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.activity-row');
      assert.ok(total > PAGE, `the fixture must exceed one page, got ${total}`);
      assert.equal(await page.locator('.activity-row').count(), PAGE, 'the view stops at one page');
      const note = await page.textContent('.wv-note');
      assert.match(note, new RegExp(`${total}`), 'the note still reports every event');
      assert.match(note, new RegExp(`newest ${PAGE}`), 'the note says which page the reader has');
    } finally { await page.close(); }
  });

  test('the Activity page asks Users only for the actors it draws', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const calls = watchUsers(page, usersId);
    try {
      await page.goto(`${base}/#/activity`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.activity-row');
      await page.locator('.k-actor .k-label').first().waitFor();
      assert.equal(calls.length, 1, `one batched Users read, got ${calls.length}`);
      const [sent] = calls;
      const wanted = sent?.where?.[0];
      assert.deepEqual(wanted?.slice(0, 2), ['Name', 'in'], 'the read names the handles, never the whole table');
      assert.ok(wanted[2].length < BYSTANDERS, `asked for ${wanted[2].length} handles, the table holds ${BYSTANDERS + 1}`);
      assert.ok(wanted[2].includes('Dana Quinn'), 'the actor the page draws is in the list');
    } finally { await page.close(); }
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the actor chip still resolves on the Activity page, the grid and the record panel (${colorScheme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      try {
        await page.goto(`${base}/#/activity/${row.id}`, { waitUntil: 'networkidle' });
        const feedChip = page.locator('.activity-row .k-actor').first();
        await feedChip.locator('.k-label').waitFor();
        assert.equal(await feedChip.locator('.k-label').first().textContent(), 'Dana Quinn');
        assert.equal(await feedChip.getAttribute('class'), 'k k-actor', 'a resolved chip is not is-unknown');
        assert.match(await feedChip.locator('a').first().getAttribute('href'), new RegExp(`#/entity/${dana.id}$`));

        await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
        const panelChip = page.locator('.fieldrow-system[data-field="Created By"] .k-actor');
        await panelChip.locator('.k-label').waitFor();
        assert.equal(await panelChip.locator('.k-label').textContent(), 'Dana Quinn');
        assert.equal(await panelChip.locator('.actor-av').textContent(), 'DQ', 'a person still wears initials');

        await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
        const gridChip = page.locator('td .k-actor').first();
        await gridChip.locator('.k-label').waitFor();
        assert.equal(await gridChip.locator('.k-label').first().textContent(), 'Dana Quinn');
      } finally { await page.close(); }
    });
  }
}
