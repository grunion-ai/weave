import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const N = 1200;
const TRASHED = 120;
let cases, suites;

const s = await launch('the show-deleted page', (weave) => {
  weave.createSpace({ name: 'Quality' });
  suites = weave.createTable({ space: 'Quality', name: 'Suite' });
  cases = weave.createTable({ space: 'Quality', name: 'Case' });
  weave.addField(cases, { name: 'Status', type: 'select', config: { options: ['pass', 'fail'] } });
  weave.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  const st = weave.createEntity(suites, { name: 'engine.test.mjs' });
  const made = [];
  for (let i = 0; i < N; i++) {
    made.push(weave.createEntity(cases, {
      name: `case ${String(i).padStart(4, '0')}`,
      values: { Status: i % 2 ? 'pass' : 'fail', Suite: st.id },
      doc: `description ${i} `.repeat(40),
    }));
  }
  for (let i = 0; i < TRASHED; i++) weave.deleteEntity(made[i * 7].id);
  weave.tableView('Quality/Case/Standard', { deleted: true });
});

if (s) {
  const { base, browser, weave } = s;

  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const calls = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/')) calls.push({ path: req.url().replace(base, ''), method: req.method(), body: req.postData() });
    });
    const bytes = [];
    page.on('response', async (res) => {
      if (!res.url().includes('/api/')) return;
      bytes.push({ path: res.url().replace(base, ''), size: await res.body().then((b) => b.length).catch(() => 0) });
    });
    await page.goto(`${base}/#/table/${cases.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return { page, calls, bytes };
  };

  const queries = (calls) => calls
    .filter((c) => c.method === 'POST' && c.path === `/api/tables/${cases.id}/query`)
    .map((c) => JSON.parse(c.body ?? '{}'));

  test('Issue #1269: a show-deleted view opens on a page, not the whole table', async () => {
    const { page, calls } = await open();
    try {
      const sent = queries(calls);
      assert.ok(sent.length >= 1, 'the table was queried');
      assert.equal(sent[0].includeDeleted, true, 'the open asks for the trashed rows');
      assert.equal(typeof sent[0].limit, 'number', `the open sends a limit (${JSON.stringify(sent[0])})`);
      assert.ok(sent[0].limit > 0 && sent[0].limit <= 200, `the limit is a page, not the table (${sent[0].limit})`);
      for (const q of sent) assert.ok(q.limit > 0, `no query reads the table whole (${q.limit})`);
    } finally { await page.close(); }
  });

  test('Issue #1269: the show-deleted open downloads a fraction of what the whole table costs', async () => {
    const { page, calls, bytes } = await open();
    try {
      const first = queries(calls)[0];
      const paged = bytes.filter((b) => b.path === `/api/tables/${cases.id}/query`).reduce((a, b) => a + b.size, 0);
      const whole = await page.evaluate(async ([id, query]) => {
        const res = await fetch(`/api/tables/${id}/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...query, limit: -1, offset: 0 }),
        });
        return (await res.text()).length;
      }, [cases.id, first]);
      assert.ok(paged < whole * 0.3, `the open downloaded ${paged} bytes of the ${whole} the whole table costs`);
    } finally { await page.close(); }
  });

  test('Issue #1269: a trashed row fed in on a later page is still struck through', async () => {
    const { page } = await open();
    try {
      const first = await page.evaluate(() => [...document.querySelectorAll('.wv-grid tbody tr.entity-row')]
        .map((r) => ({ id: r.dataset.eid, struck: r.classList.contains('row-deleted') })));
      const drawnGone = new Set(first.filter((r) => r.struck).map((r) => r.id));
      assert.ok(drawnGone.size > 0, 'the first drawn window already shows trashed rows struck through');
      const got = await page.evaluate(async () => {
        const grid = document.querySelector('#main').wvDraw;
        await grid.pager.through(grid.pager.total - 1);
        const late = grid.pager.rows
          .map((r, i) => ({ i, gone: !!r?.deletedAt, marked: !!r?.deleted }))
          .filter((r) => r.gone && r.i >= 200);
        return { total: grid.pager.total, late: late.length, unmarked: late.filter((r) => !r.marked).length };
      });
      assert.ok(got.late > 0, `trashed rows sit past the first page (${JSON.stringify(got)})`);
      assert.equal(got.unmarked, 0, `every trashed row fed in later carries its tombstone (${JSON.stringify(got)})`);
    } finally { await page.close(); }
  });

  test('Issue #1269: the filter readout counts the live rows of the whole table, not of the loaded page', async () => {
    const { page } = await open();
    try {
      const answer = await page.evaluate(async (id) => {
        const res = await fetch(`/api/tables/${id}/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ includeDeleted: true, limit: 200, offset: 0, countAll: true }),
        });
        return res.json();
      }, cases.id);
      assert.equal(answer.total, N, 'total counts every matching row, trashed ones included');
      assert.equal(answer.liveTotal, N - TRASHED, `liveTotal counts the live ones over the whole match, not the page (${answer.liveTotal})`);
      assert.equal(answer.items.length, 200, 'and the answer is still one page');
    } finally { await page.close(); }
  });
}
