import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;
const LONG = 'Billing rewrite with a name long enough to wrap in a chip';

const s = await launch('phone row whole chips', (weave) => {
  weave.createSpace({ name: 'Work' });
  const epics = weave.createTable({ space: 'Work', name: 'Epic' });
  const tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Done', category: 'done' }] } });
  weave.addField(tasks, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  weave.addRelation(tasks, { name: 'Epic', targetDb: epics, cardinality: 'many-to-one', inverseName: 'Tasks' });
  weave.addField(tasks, { name: 'Due', type: 'date' });
  const epic = weave.createEntity(epics, { name: LONG }).id;
  weave.createEntity(tasks, { name: 'Task 0', values: { Status: 'Open', Severity: 'High', Epic: epic } });
  weave.tableView('Work/Task/Standard', { fields: ['Name', 'Status', 'Severity', 'Epic', 'Due'] });
  return { id: tasks.id };
});

if (s) {
  const { base, browser, id } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const write = (page, phoneRow) => page.evaluate(async ([id, phoneRow]) => (await fetch(`/api/tables/${id}/views/Standard`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phoneRow }),
  })).status, [id, phoneRow]);
  const chips = (page) => page.evaluate(() => [...document.querySelectorAll('#main :is(tbody tr.entity-row, .wv-list .list-row):first-child :is(td, .phone-chip)[data-field]')]
    .filter((td) => td.getClientRects().length)
    .map((td) => ({
      field: td.dataset.field,
      more: td.dataset.more ?? null,
      cut: [...td.querySelectorAll('.k-label')].filter((n) => n.getClientRects().length && n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent),
      text: [...td.querySelectorAll('.k-label')].filter((n) => n.getClientRects().length).map((n) => n.textContent),
    })));
  const showing = async (b, profile, phoneRow) => {
    const page = await b.newPage(profile);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    assert.equal(await write(page, phoneRow), 200);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#main :is(tbody tr.entity-row, .wv-list .list-row)');
    return page;
  };

  for (const [engine, b, profile] of engines) {
    test(`on a phone a chip too long for the row is counted in the +N, never drawn cut off (${engine}, Issue #873)`, async () => {
      const page = await showing(b, profile, { lead: 'Status', chips: ['Epic', 'Severity'] });
      try {
        const seen = await chips(page);
        assert.deepEqual(seen.flatMap((c) => c.cut), [], 'no chip label is cut');
        assert.deepEqual(seen.map((c) => c.field), ['Severity'], 'the long relation chip leaves the row');
        assert.equal(seen[0].more, '+1', 'and the row still counts it');
      } finally { await write(page, null); await page.close(); }
    });

    test(`on a phone a row whose only chip is too long shows its count alone (${engine}, Issue #873)`, async () => {
      const page = await showing(b, profile, { lead: 'Status', chips: ['Epic'] });
      try {
        const seen = await chips(page);
        assert.deepEqual(seen.flatMap((c) => c.cut), [], 'no chip label is cut');
        assert.deepEqual(seen.map((c) => [c.field, c.more, c.text.length]), [['Epic', '+1', 0]], 'the chip keeps only its count');
      } finally { await write(page, null); await page.close(); }
    });

    test(`on a phone an empty date is no chip, so its placeholder never shows cut off (${engine}, Issue #873)`, async () => {
      const page = await showing(b, profile, { lead: 'Status', chips: ['Due', 'Severity'] });
      try {
        const seen = await page.evaluate(() => [...document.querySelectorAll('#main :is(tbody tr.entity-row, .wv-list .list-row):first-child :is(td, .phone-chip)[data-field]')]
          .filter((td) => td.getClientRects().length).map((td) => [td.dataset.field, td.dataset.more ?? null]));
        assert.deepEqual(seen, [['Severity', null]]);
      } finally { await write(page, null); await page.close(); }
    });
  }
}
