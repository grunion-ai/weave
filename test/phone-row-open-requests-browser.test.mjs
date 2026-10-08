import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone row open requests', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(weave.createEntity(issues, { name: `Issue ${i}`, values: { Severity: 'Low' } }));
  weave.setDoc(rows[1].id, 'A short description.');
  return { table: `#/table/${issues.id}` };
});

const depth = (calls) => {
  const memo = new Map();
  const of = (c) => {
    if (memo.has(c)) return memo.get(c);
    const before = calls.filter((o) => o !== c && o.end < c.start);
    const d = 1 + Math.max(0, ...before.map(of));
    memo.set(c, d);
    return d;
  };
  return Math.max(0, ...calls.map(of));
};

if (s) {
  const { base, browser, table } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', () => browser.newPage({ viewport: { width: 390, height: 844 } })]];
  if (phone) engines.push(['webkit iPhone 15', () => phonePage(phone)]);

  for (const [engine, make] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone opening a row fetches the row once and its references alongside it, one round trip deep (${engine}, ${theme}, Issue #735)`, async () => {
        const page = await make();
        try {
          await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
          await page.goto(`${base}/${table}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('#main tbody tr.entity-row .list-name');
          const id = await page.locator('#main tbody tr.entity-row').nth(1).getAttribute('data-eid');
          const calls = [];
          const t0 = Date.now();
          page.on('request', (r) => { if (r.url().includes('/api/')) calls.push({ url: new URL(r.url()).pathname, start: Date.now() - t0, end: Infinity, req: r }); });
          page.on('requestfinished', (r) => { const c = calls.find((x) => x.req === r); if (c) c.end = Date.now() - t0; });
          const box = await page.locator('#main tbody tr.entity-row').nth(1).locator('.list-name').boundingBox();
          await page.mouse.click(box.x + 20, box.y + 8);
          await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
          const painted = Date.now() - t0;
          await page.waitForLoadState('networkidle');
          const before = calls.filter((c) => c.end <= painted);
          const rowGets = calls.filter((c) => c.url.endsWith(`/api/entities/${id}`));
          assert.equal(rowGets.length, 1, `the row is fetched once: ${calls.map((c) => c.url)}`);
          const refs = calls.filter((c) => /\/references(-from)?$/.test(c.url));
          assert.equal(refs.length, 2, 'its references are fetched once each');
          for (const r of refs) assert.ok(r.start <= rowGets[0].end, `${r.url} starts with the row, not after it (${r.start} vs ${rowGets[0].end})`);
          assert.ok(depth(before) <= 1, `the name waits on one round trip after the tap, not ${depth(before)}: ${before.map((c) => `${c.url}@${c.start}-${c.end}`)}`);
          assert.ok(painted < 3000, `the row paints within budget (${painted}ms)`);
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        } finally { await page.close(); }
      });
    }
  }
}
