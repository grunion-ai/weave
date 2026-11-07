import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const N = 1200;
const TRASHED = 40;
let cases, suites;

const s = await launch('the table-open payload', (weave) => {
  weave.createSpace({ name: 'Quality' });
  suites = weave.createTable({ space: 'Quality', name: 'Suite' });
  cases = weave.createTable({ space: 'Quality', name: 'Case' });
  weave.addField(cases, { name: 'Status', type: 'select', config: { options: ['pass', 'fail'] } });
  weave.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  const st = weave.createEntity(suites, { name: 'engine.test.mjs', doc: 'x'.repeat(4000) });
  const made = [];
  for (let i = 0; i < N; i++) {
    made.push(weave.createEntity(cases, {
      name: `case ${String(i).padStart(4, '0')}`,
      values: { Status: i % 2 ? 'pass' : 'fail', Suite: st.id },
      doc: `description ${i} `.repeat(40),
    }));
  }
  for (let i = 0; i < TRASHED; i++) weave.deleteEntity(made[i].id);
});

if (s) {
  const { base, browser, weave } = s;

  const openWithTraffic = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const calls = [];
    page.on('request', (req) => {
      if (!req.url().includes('/api/')) return;
      calls.push({ path: req.url().replace(base, ''), method: req.method(), body: req.postData() });
    });
    const bytes = [];
    page.on('response', async (res) => {
      if (!res.url().includes('/api/')) return;
      const size = await res.body().then((b) => b.length).catch(() => 0);
      bytes.push({ path: res.url().replace(base, ''), size });
    });
    await page.goto(`${base}/#/table/${cases.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return { page, calls, bytes };
  };

  const tableQueries = (calls) => calls
    .filter((c) => c.method === 'POST' && c.path === `/api/tables/${cases.id}/query`)
    .map((c) => JSON.parse(c.body ?? '{}'));

  test('Issue #1357: opening the table asks for one page, never the whole table', async () => {
    const { page, calls } = await openWithTraffic();
    try {
      const sent = tableQueries(calls);
      assert.ok(sent.length >= 1, `the table was queried (${calls.map((c) => c.path).join(', ')})`);
      const first = sent[0];
      assert.equal(typeof first.limit, 'number', `the table-open query sends a limit (${JSON.stringify(first)})`);
      assert.ok(first.limit > 0 && first.limit <= 200, `the limit is a page, not the table (${first.limit})`);
      assert.ok(first.limit < N, `the limit is under the ${N} rows the table holds`);
      for (const q of sent) assert.ok(q.limit > 0 && q.limit <= 400, `every table-open query is bounded (${q.limit})`);
    } finally { await page.close(); }
  });

  test('Issue #1357: the table-open query asks for the drawn columns and chip relations, not whole related rows', async () => {
    const { page, calls } = await openWithTraffic();
    try {
      const first = tableQueries(calls)[0];
      assert.equal(first.relations, 'chip', `relations are chips (${JSON.stringify(first.relations)})`);
      assert.ok(Array.isArray(first.fields) && first.fields.length, `the query names the drawn columns (${JSON.stringify(first.fields)})`);
      const row = weave.query(cases, { limit: 1, fields: first.fields, relations: 'chip' }).items[0];
      assert.deepEqual(Object.keys(row.fields.Suite).sort(), ['id', 'name', 'publicId'], 'a relation arrives as id, publicId and name');
      for (const k of ['comments', 'activity', 'files']) {
        assert.equal(k in row, false, `a drawn row spends no bytes on ${k}`);
      }
    } finally { await page.close(); }
  });

  test('Issue #1357: the trash is counted on the table query, never fetched as a second whole table', async () => {
    const { page, calls } = await openWithTraffic();
    try {
      const trash = calls.filter((c) => c.path.includes('/trash'));
      assert.deepEqual(trash.map((c) => c.path), [], 'nothing fetches the trash on table open');
      assert.equal(tableQueries(calls)[0].trashCount, true, 'the table-open query asks for the trash count instead');
      const count = await page.evaluate(() => document.querySelector('#main')?.wvDraw?.trashCount ?? null);
      assert.equal(count, TRASHED, `and the count arrives (${count})`);
    } finally { await page.close(); }
  });

  test('Issue #1357: the table-open download stays a page of the table, not all of it', async () => {
    const { page, calls, bytes } = await openWithTraffic();
    try {
      const first = tableQueries(calls)[0];
      const paged = bytes.filter((b) => b.path === `/api/tables/${cases.id}/query`).reduce((a, b) => a + b.size, 0);
      const whole = await page.evaluate(async ([id, query]) => {
        const res = await fetch(`/api/tables/${id}/query`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...query, limit: -1, offset: 0 }),
        });
        return (await res.text()).length;
      }, [cases.id, first]);
      assert.ok(whole > 0, 'the whole table has a size to compare against');
      assert.ok(paged < whole * 0.3, `the open downloaded ${paged} bytes of the ${whole} the whole table costs`);
    } finally { await page.close(); }
  });
}
