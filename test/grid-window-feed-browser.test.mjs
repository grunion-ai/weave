import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const N = 900;
let cases, ids = [];
const s = await launch('the row feed', (weave) => {
  weave.createSpace({ name: 'Ops' });
  cases = weave.createTable({ space: 'Ops', name: 'Run' });
  for (let i = 0; i < N; i++) ids.push(weave.createEntity(cases, { name: `run ${String(i).padStart(4, '0')}` }).id);
});

if (s) {
  const { base, browser } = s;

  const open = async ({ delay = 400 } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await page.route('**/api/tables/*/query', async (route) => {
      const body = route.request().postDataJSON?.() ?? {};
      if (body.offset > 0 || body.limit > 200) await new Promise((r) => setTimeout(r, delay));
      await route.continue();
    });
    await page.goto(`${base}/#/table/${cases.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const box = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    return wrap.classList.contains('wv-grid-scroll') ? 'wrap' : 'main';
  });
  const scrollTo = (page, top) => page.evaluate((t) => {
    const wrap = document.querySelector('.table-wrap');
    const el = wrap.classList.contains('wv-grid-scroll') ? wrap : document.querySelector('#main');
    el.scrollTop = t === 'max' ? el.scrollHeight : t;
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, top);
  const view = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const el = wrap.classList.contains('wv-grid-scroll') ? wrap : document.querySelector('#main');
    const r = el.getBoundingClientRect();
    const head = document.querySelector('.wv-grid thead th').getBoundingClientRect().bottom;
    const top = Math.max(r.top, head);
    const inView = [...document.querySelectorAll('.wv-grid tbody tr')].filter((tr) => {
      const b = tr.getBoundingClientRect();
      return b.height > 0 && b.bottom > top + 1 && b.top < r.bottom - 1;
    });
    const more = document.querySelector('.wv-grid tbody tr.wv-load-more');
    return {
      top: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
      pending: inView.filter((tr) => tr.classList.contains('entity-row-pending')).length,
      spacer: inView.filter((tr) => tr.classList.contains('wv-spacer')).length,
      empty: inView.filter((tr) => tr.classList.contains('entity-row') && !tr.querySelector('td[data-field="Name"] input')?.value).length,
      rows: inView.filter((tr) => tr.classList.contains('entity-row')).map((tr) => Number(tr.dataset.i)),
      more: more ? {
        inView: inView.includes(more),
        running: more.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length,
      } : null,
      last: !!document.querySelector('.wv-grid tbody tr.entity-row:last-of-type') && Math.max(...[...document.querySelectorAll('.wv-grid tbody tr.entity-row')].map((tr) => Number(tr.dataset.i))),
    };
  });

  test('Issue #962: a flick to the bottom stops at the loaded rows on an animated load-more row, never on blank rows', async () => {
    const page = await open();
    try {
      let seen = [];
      for (let k = 0; k < 40; k++) {
        await scrollTo(page, 'max');
        const v = await view(page);
        seen.push(v);
        assert.equal(v.pending, 0, `flick ${k}: ${v.pending} blank pending rows on screen at scrollTop ${v.top}`);
        assert.equal(v.spacer, 0, `flick ${k}: an empty spacer band on screen at scrollTop ${v.top}`);
        if (v.more) {
          assert.equal(v.more.inView, true, `flick ${k}: the bottom of the scroll is not the load-more row`);
          assert.ok(v.more.running >= 1, `flick ${k}: the load-more row is on screen but nothing in it moves`);
        }
        if (!v.more && v.rows.includes(N - 1)) break;
        await page.waitForTimeout(150);
      }
      const end = seen.at(-1);
      assert.ok(end.rows.includes(N - 1), `the feed reached row ${N - 1} (last view rows ${end.rows[0]}-${end.rows.at(-1)})`);
      assert.equal(end.more, null, 'the load-more row leaves once every row is here');
    } finally { await page.close(); }
  });

  test('Issue #962: the next page is asked for while it is still two screens below the fold', async () => {
    const page = await open({ delay: 0 });
    try {
      const asked = [];
      page.on('request', (r) => { if (/\/query$/.test(r.url())) asked.push(r.postDataJSON()?.offset ?? 0); });
      const v0 = await view(page);
      const rowH = await page.evaluate(() => document.querySelector('.wv-grid tbody tr.entity-row').getBoundingClientRect().height);
      const viewportH = await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        return (wrap.classList.contains('wv-grid-scroll') ? wrap : document.querySelector('#main')).clientHeight;
      });
      assert.ok(v0.more, 'a 900-row table opens with a load-more row under the first page');
      await scrollTo(page, 200 * rowH - 3 * viewportH);
      await eventually(() => asked.includes(200), true, { timeout: 3000 });
      assert.ok(asked.includes(200), `no fetch for rows 200+ with three screens left (asked ${JSON.stringify(asked)})`);
    } finally { await page.close(); }
  });

  test('Issue #961: scrolling back up shows every row already seen, filled, in the next frame', async () => {
    const page = await open();
    try {
      for (let k = 0; k < 40; k++) {
        await scrollTo(page, 'max');
        const v = await view(page);
        if (v.rows.some((i) => i >= 700)) break;
        await page.waitForTimeout(150);
      }
      const start = await view(page);
      assert.ok(start.rows.some((i) => i >= 700), `scrolled past row 700 (${start.rows.at(-1)})`);
      const step = await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        return (wrap.classList.contains('wv-grid-scroll') ? wrap : document.querySelector('#main')).clientHeight;
      });
      for (let top = start.top - step; top > -step; top -= step) {
        await scrollTo(page, Math.max(0, top));
        const v = await view(page);
        assert.equal(v.pending, 0, `scrolling up to ${v.top}: ${v.pending} rows came back blank`);
        assert.equal(v.spacer, 0, `scrolling up to ${v.top}: an empty band where seen rows were`);
        assert.equal(v.empty, 0, `scrolling up to ${v.top}: ${v.empty} rows drawn with empty cells`);
      }
    } finally { await page.close(); }
  });

  test('Issue #961: a refresh deep in the table keeps every loaded row, so scrolling up after it never waits', async () => {
    const page = await open();
    try {
      for (let k = 0; k < 40; k++) {
        await scrollTo(page, 'max');
        const v = await view(page);
        if (v.rows.some((i) => i >= 650)) break;
        await page.waitForTimeout(150);
      }
      const asked = [];
      page.on('request', (r) => { if (/\/query$/.test(r.url())) asked.push(r.postDataJSON()); });
      await page.evaluate(() => document.querySelector('#main .table-wrap').wvRefresh());
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const after = await view(page);
      assert.ok(after.rows.some((i) => i >= 600), `the refresh kept the reader deep in the table (rows ${after.rows[0]}-${after.rows.at(-1)})`);
      const step = 800;
      for (let top = after.top - step; top > -step; top -= step) {
        await scrollTo(page, Math.max(0, top));
        const v = await view(page);
        assert.equal(v.pending, 0, `after a refresh, scrolling up to ${v.top} showed ${v.pending} blank rows`);
      }
      const reread = asked.filter((q) => q.limit > 200);
      assert.ok(reread.length >= 1 && reread.length <= 2, `the refresh re-read the loaded rows in ${reread.length} batch requests: ${JSON.stringify(asked)}`);
    } finally { await page.close(); }
  });
}
