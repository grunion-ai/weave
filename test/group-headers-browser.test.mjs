import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';
import { seedIssues, STANDARD_FIELDS, AREA, SYMPTOM, STATES } from './lib/view-pane-fixture.mjs';

const EXTRA = 120;
let issue;
const s = await launch('group headers: parent path, pinned first level, breakdown, collapse memory', (weave) => {
  ({ issue } = seedIssues(weave));
  for (let n = 0; n < EXTRA; n++) {
    weave.createEntity(issue.id, { name: `Backlog item ${n}`, values: {
      Severity: 'Low', Area: AREA[n % AREA.length], Status: STATES[n % STATES.length],
      Symptom: n % 4 ? [SYMPTOM[n % 4]] : [],
    } });
  }
});

if (s) {
  const { base, browser, weave } = s;
  const view = (name, patch) => weave.tableView(`${issue.id}/${name}`, { fields: STANDARD_FIELDS, filters: {}, deleted: false, sort: [], density: 'comfortable', ...patch });
  const open = async (v, { theme = 'light', height = 900 } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1440, height }, colorScheme: theme });
    await page.goto(`${base}/#/table/${issue.id}/view/${v.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main :is(.wv-grid, .wv-board)');
    return page;
  };
  const heads = (page) => page.$$eval('#main tr.group-head', (trs) => trs.map((t) => ({
    key: t.dataset.key, level: Number(t.dataset.level),
    crumb: t.querySelector('.group-crumb')?.textContent ?? null,
    crumbFirst: t.querySelector('.group-head-in > :not(.group-fold)')?.classList.contains('group-crumb') ?? false,
    crumbColor: t.querySelector('.group-crumb') ? getComputedStyle(t.querySelector('.group-crumb')).color : null,
    fieldColor: getComputedStyle(t.querySelector('.group-head-field')).color,
    summary: t.querySelector('.group-summary')?.textContent ?? null,
    text: t.textContent,
  })));
  const statusOf = (key) => {
    const [sev, area] = key.split(' › ');
    const rows = weave.query(issue.id, {}).items.filter((it) => it.fields.Severity === sev && (area == null || it.fields.Area === area));
    return STATES.map((st) => [st, rows.filter((r) => r.fields.Status === st).length]).filter(([, n]) => n).map(([st, n]) => `${st} ${n}`).join(', ');
  };

  test('table: a nested header shows its parent path, muted, before its own field and value', async () => {
    const v = view('Standard', { group: ['Severity', 'Area', 'Status'], rollups: false, layout: null, collapsed: null });
    const page = await open(v, { height: 6000 });
    try {
      const hs = await heads(page);
      const deep = hs.find((h) => h.key === 'High › Nav › Open');
      assert.ok(deep, JSON.stringify(hs.slice(0, 4)));
      assert.equal(deep.crumb, 'High › Nav ›');
      assert.ok(deep.crumbFirst, 'the path comes before the field name');
      assert.equal(deep.crumbColor, deep.fieldColor, 'muted like the field name');
      for (const h of hs) {
        assert.equal(h.crumb === null, h.level === 0, `${h.key}: only nested headers carry a path`);
        if (h.level) assert.equal(h.crumb, `${h.key.split(' › ').slice(0, -1).join(' › ')} ›`);
      }
    } finally { await page.close(); }
  });

  test('rollups off: each header shows its count and the first ungrouped select breakdown; rollups on: the count only', async () => {
    const v = view('Standard', { group: ['Severity', 'Area'], rollups: false, layout: null, collapsed: null });
    const page = await open(v, { height: 6000 });
    try {
      const hs = await heads(page);
      assert.ok(hs.length > 3);
      for (const h of hs) assert.equal(h.summary ?? '', statusOf(h.key), `${h.key}: Status breakdown`);
      assert.match(hs[0].text, /\d+ issues?/, 'the count stays');
      view('Standard', { rollups: true });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#main tr.group-sum.grand');
      const on = await heads(page);
      assert.ok(on.every((h) => h.summary === null), 'rollups on: the subtotal rows carry the numbers');
      assert.ok(on.every((h) => /\d+ issues?/.test(h.text)));
    } finally { await page.close(); }
  });

  const underHead = async (page) => page.evaluate(() => {
    const top = Math.max(...[...document.querySelectorAll('#main .wv-grid thead :is(th, td)')].map((c) => c.getBoundingClientRect().bottom));
    const x = document.querySelector('#main .wv-grid').getBoundingClientRect().left + 60;
    const hit = document.elementFromPoint(x, top + 4);
    const head = hit?.closest('tr.group-head');
    if (!head) return { hit: hit?.className ?? null };
    return { key: head.dataset.key, level: Number(head.dataset.level), gap: Math.round(head.firstElementChild.getBoundingClientRect().top - top) };
  });

  test('table: the top-level header stays pinned under the column headers while its rows scroll', async () => {
    const v = view('Standard', { group: ['Severity', 'Area'], rollups: false, layout: null, collapsed: null });
    const page = await open(v);
    try {
      const scroll = (y) => page.evaluate((y) => {
        const box = document.querySelector('#main .wv-grid-scroll') ?? document.querySelector('#main');
        box.scrollTop = y;
      }, y);
      for (const y of [1600, 4200]) {
        await scroll(y);
        const got = await eventually(() => underHead(page), { key: 'Low', level: 0, gap: 0 });
        assert.deepEqual(got, { key: 'Low', level: 0, gap: 0 }, `scrolled ${y}px into Low`);
      }
    } finally { await page.close(); }
  });

  test('collapsed groups follow the grouping across views; a different order starts expanded', async () => {
    weave.tableView(`${issue.id}/Standard`, { collapsed: null });
    const a = view('Standard', { group: ['Severity', 'Area'], rollups: false, layout: null, collapsed: null });
    const b = view('Triage', { group: ['Severity', 'Area'], layout: null });
    const c = view('Reversed', { group: [{ field: 'Severity', dir: 'desc' }, 'Area'], layout: null });
    const page = await open(a, { height: 3000 });
    try {
      await page.click('#main tr.group-head[data-key="Medium"] .group-fold');
      await page.goto(`${base}/#/table/${issue.id}/view/${b.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main tr.group-head[data-key="Medium"]');
      assert.equal(await page.locator('#main tr.group-head[data-key="Medium"].shut').count(), 1, 'Triage opens with Medium collapsed');
      assert.equal(await page.locator('#main tr.group-head.shut').count(), 1);
      assert.deepEqual(await eventually(() => weave.tableView(`${issue.id}/Triage`).collapsed ?? [], ['Medium']), ['Medium'], 'and the server remembers it for Triage');
      await page.goto(`${base}/#/table/${issue.id}/view/${c.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main tr.group-head[data-key="Medium"]');
      assert.equal(await page.locator('#main tr.group-head.shut').count(), 0, 'a different order starts expanded');
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`messy data (${theme}): five levels, a multi-select level, empty values and a hidden grouped field`, async () => {
      const v = view('Standard', {
        fields: STANDARD_FIELDS.filter((n) => n !== 'Severity'), rollups: false, layout: null, collapsed: null,
        group: [{ field: 'Area' }, { field: 'Severity' }, { field: 'Status', dir: 'desc' }, { field: 'Symptom' }, { field: 'Fixed in' }],
      });
      const page = await open(v, { theme, height: 9000 });
      try {
        const hs = await heads(page);
        const q = weave.query(issue.id, { groupBy: v.id });
        assert.equal(hs.length, q.groups.length, 'one header per group');
        assert.ok(hs.every((h) => !/undefined|NaN|null/.test(h.text)), 'nothing draws undefined');
        const leaf = hs.find((h) => h.level === 4 && h.key.endsWith('No value') && h.key.split(' › ')[3] !== 'No value');
        assert.ok(leaf, 'a leaf under a multi-select value with an empty link');
        assert.equal(leaf.crumb.split(' › ').length, 4);
        assert.ok(hs.some((h) => h.level === 1 && /Severity/.test(h.text)), 'the hidden grouped field keeps its headers');
        const top = hs.find((h) => h.level === 0);
        assert.match(top.summary, /^(Open|In Progress|Fixed) \d/, 'Area at the top: Status is the first ungrouped select at that level');
        const deep = hs.find((h) => h.level >= 2);
        assert.equal(deep.summary, null, 'Status and Severity grouped above: no other single select is left');
      } finally { await page.close(); }
    });
  }

  test('Table and Board read the same group levels from the view', async () => {
    const v = view('Standard', { group: ['Severity', 'Area'], rollups: false, layout: null, collapsed: null, groups: null });
    const page = await open(v, { height: 6000 });
    try {
      const table = (await heads(page)).filter((h) => h.level === 0).map((h) => h.key);
      view('Standard', { layout: 'board', groups: 'stacked' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#main .wv-board');
      const board = await page.$$eval('#main .wv-board .board-group[data-depth="0"]', (ss) => ss.map((x) => x.dataset.key));
      const nested = await page.locator('#main .wv-board .board-group[data-depth="1"]').count();
      assert.deepEqual(board.filter((k) => table.includes(k)), table);
      assert.ok(nested > 0, 'the board draws the second level too');
    } finally {
      view('Standard', { layout: null, groups: null });
      await page.close();
    }
  });
}
