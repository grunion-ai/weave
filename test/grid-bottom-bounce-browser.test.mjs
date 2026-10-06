import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const N = 800;
let wide, tall;
const s = await launch('the bottom of a table holds still', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  wide = weave.createTable({ space: 'Ledger', name: 'Wide' });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'number' });
  for (let i = 0; i < N; i++) {
    weave.createEntity('Wide', {
      name: `w${String(i).padStart(4, '0')}`,
      values: { Description: i % 7 === 0 ? 'A body with `code` in it and words after' : '', 'A long column name 0': i },
    });
  }
  tall = weave.createTable({ space: 'Ledger', name: 'Tall' });
  weave.addField(tall, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  for (let i = 0; i < 600; i++) {
    weave.createEntity('Tall', {
      name: `t${String(i).padStart(4, '0')}`,
      values: {
        Description: i % 3 === 0 ? 'A body with `code` in it and a few more words after' : '',
        ...(i % 5 === 0 ? { Severity: 'High' } : {}),
      },
    });
  }
});

if (s) {
  const { base, browser } = s;

  const atTheBottom = async () => {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForFunction(() => !!document.querySelector('.table-wrap.wv-grid-scroll')?.style.maxHeight);
    const box = await page.evaluate(() => {
      const r = document.querySelector('.table-wrap.wv-grid-scroll').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    const atEnd = () => page.evaluate(() => {
      const w = document.querySelector('.table-wrap.wv-grid-scroll');
      return w.scrollTop >= w.scrollHeight - w.clientHeight - 1;
    });
    for (let i = 0; i < 80 && !(await atEnd()); i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(40); }
    await page.waitForTimeout(400);
    const heights = await page.evaluate(() => new Set([...document.querySelectorAll('.wv-grid tbody tr.entity-row')]
      .map((r) => Math.round(r.getBoundingClientRect().height))).size);
    assert.equal(heights, 1, 'every row of the grid under test is one declared height');
    return page;
  };

  const atTheBottomOfTall = async () => {
    const page = await browser.newPage({ viewport: { width: 2187, height: 1359 } });
    await page.goto(`${base}/#/table/${tall.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForFunction(() => document.querySelector('.table-wrap')?.classList.contains('wv-fit'));
    await page.mouse.move(1000, 1000);
    for (let i = 0; i < 80 && !(await page.evaluate(() => scrollY >= document.documentElement.scrollHeight - innerHeight - 1)); i++) {
      await page.mouse.wheel(0, 900); await page.waitForTimeout(25);
    }
    await page.waitForTimeout(1200);
    const heights = await page.evaluate(() => new Set([...document.querySelectorAll('.wv-grid tbody tr.entity-row')]
      .map((r) => Math.round(r.getBoundingClientRect().height))).size);
    assert.equal(heights, 1, 'every row of the grid under test is one declared height');
    return page;
  };

  test('the last row of a page-scrolled grid comes to rest (Issue #324)', async () => {
    const page = await atTheBottomOfTall();
    try {
      await page.evaluate(() => {
        window.__moves = [];
        addEventListener('scroll', () => window.__moves.push(Math.round(scrollY)), true);
      });
      await page.waitForTimeout(2000);
      const moves = await page.evaluate(() => window.__moves);
      assert.deepEqual(moves, [], `the page does not scroll itself: ${JSON.stringify(moves.slice(0, 9))}`);
    } finally {
      await page.close();
    }
  });

  test('+ New at the bottom lands the caret and leaves the page still (Issue #324)', async () => {
    const page = await atTheBottomOfTall();
    try {
      await page.click('.add-entity-btn');
      await page.waitForFunction(() => document.activeElement?.closest?.('td')?.dataset?.field === 'Name', null, { timeout: 8000 });
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        window.__moves = [];
        addEventListener('scroll', () => window.__moves.push(Math.round(scrollY)), true);
      });
      await page.waitForTimeout(1500);
      const moves = await page.evaluate(() => window.__moves);
      assert.deepEqual(moves, [], `the page rests after the new row (Issue #324): ${JSON.stringify(moves.slice(0, 9))}`);
    } finally {
      await page.close();
    }
  });

  test('a density flip re-measures the row the spacer stands in for (Issue #324)', async () => {
    const page = await browser.newPage({ viewport: { width: 2187, height: 1359 } });
    try {
      await page.goto(`${base}/#/table/${tall.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.mouse.move(1000, 1000);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(25); }
      await page.waitForTimeout(600);
      const spacerRow = () => page.evaluate(() => {
        const tb = document.querySelector('.wv-grid tbody');
        const first = tb.querySelector('tr.entity-row');
        return {
          estimate: parseFloat(tb.querySelector('tr.wv-spacer td').style.height) / Number(first.dataset.i),
          real: first.getBoundingClientRect().height,
        };
      });
      const roomy = await spacerRow();
      assert.ok(Math.abs(roomy.estimate - roomy.real) < 2, `the spacer stands in at the row's own height: ${JSON.stringify(roomy)}`);
      await page.click('.table-density-btn');
      await page.click('.seg-opt[title="Short rows, for scanning"]');
      await page.waitForTimeout(600);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(25); }
      await page.waitForTimeout(600);
      const compact = await spacerRow();
      assert.ok(compact.real < roomy.real - 4, `compact rows are shorter: ${JSON.stringify({ roomy, compact })}`);
      assert.ok(Math.abs(compact.estimate - compact.real) < 2, `and the spacer follows them down: ${JSON.stringify(compact)}`);
    } finally {
      await page.close();
    }
  });

  test('pushing past the last row moves nothing (Issue #317)', async () => {
    const page = await atTheBottom();
    try {
      await page.evaluate(() => {
        const w = document.querySelector('.table-wrap.wv-grid-scroll');
        window.__moves = [];
        w.addEventListener('scroll', () => window.__moves.push([Math.round(w.scrollTop), w.scrollHeight]));
      });
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(90); }
      await page.waitForTimeout(300);
      const moves = await page.evaluate(() => window.__moves);
      const back = moves.filter((m, i) => i > 0 && m[0] < moves[i - 1][0] - 2).length;
      assert.equal(back, 0, `the box never travels backwards under a push forward: ${JSON.stringify(moves.slice(0, 8))}`);
      const rest = await page.evaluate(() => {
        const w = document.querySelector('.table-wrap.wv-grid-scroll');
        return { top: Math.round(w.scrollTop), end: w.scrollHeight - w.clientHeight };
      });
      assert.equal(rest.top, rest.end, `and rests on the last row: ${JSON.stringify(rest)}`);
    } finally {
      await page.close();
    }
  });

}
