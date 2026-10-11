import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, painted } from './lib/browser.mjs';
import { decodePng } from './lib/png.mjs';

let shop, rows;
const s = await launch('the frozen pair paints a solid ground', (weave) => {
  weave.createSpace({ name: 'Buyer' });
  shop = weave.createTable({ space: 'Buyer', name: 'Shopping List' });
  weave.addField(shop, { name: 'Requirements', type: 'text' });
  weave.addField(shop, { name: 'Best Price', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 0 } });
  weave.addField(shop, { name: 'Buy URL', type: 'url' });
  weave.addField(shop, { name: 'Recommended Card', type: 'text' });
  weave.addField(shop, { name: 'Destination', type: 'text' });
  rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push(weave.createEntity(shop, {
      name: `Libernovo Omni ergonomic standing desk chair, lumbar support, footrest ${i}`,
      values: {
        Requirements: 'mesh back, adjustable arms, under $1,200 delivered',
        'Best Price': 1119 + i * 111,
        'Buy URL': 'https://libernovo.com/products/omni',
        'Recommended Card': 'Chase Freedom Unlimited',
        Destination: 'Home office',
      },
    }));
  }
});

if (s) {
  const { base, browser } = s;
  const engines = [['default', browser]];
  if (process.env.WEAVE_BROWSER !== 'webkit') {
    const webkit = await engineOf('webkit');
    if (webkit) engines.push(['webkit', webkit]);
  }

  const open = async (b, { theme, viewport, docked }) => {
    const page = await b.newPage({ viewport, deviceScaleFactor: 1 });
    const q = docked ? `?e=${rows[0].id}` : '';
    await page.goto(`${base}/#/table/${shop.id}${q}`, { waitUntil: 'load' });
    await painted(page, '.wv-grid tbody tr.entity-row');
    if (docked) await painted(page, `tr[data-eid="${rows[0].id}"].row-docked`);
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    const scrolled = await page.evaluate(() => {
      const wrap = document.querySelector('.table-wrap');
      const row = document.querySelector('.wv-grid tbody tr.entity-row');
      const price = row.querySelector('td[data-field="Best Price"]');
      const pid = row.querySelector('td.pid-cell');
      const pr = price.getBoundingClientRect(), dr = pid.getBoundingClientRect();
      wrap.scrollLeft += pr.right - (dr.left + dr.width / 2);
      return wrap.scrollLeft;
    });
    assert.ok(scrolled > 0, `the grid scrolls sideways (scrollLeft ${scrolled})`);
    await page.waitForTimeout(120);
    return page;
  };

  const sample = async (page, i) => {
    const g = await page.evaluate((n) => {
      const row = document.querySelectorAll('.wv-grid tbody tr.entity-row')[n];
      const rect = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
      const sel = row.querySelector('td.sel-cell'), pid = row.querySelector('td.pid-cell');
      const past = [...row.querySelectorAll('td[data-field]')]
        .find((td) => td.getBoundingClientRect().left > pid.getBoundingClientRect().right + 1);
      return {
        pair: [rect(sel)[0], rect(sel)[1], rect(pid)[2], rect(pid)[3]],
        holes: [sel.querySelector('.sel-hit'), pid.firstElementChild].filter(Boolean).map(rect),
        past: rect(past),
      };
    }, i);
    const png = decodePng(await page.screenshot());
    const [l, t, r, b] = g.pair.map(Math.round);
    const ground = png.at(Math.round(g.past[0]) + 2, Math.round(g.past[1]) + 3);
    const inHole = (x, y) => g.holes.some(([hl, ht, hr, hb]) => x >= hl - 1 && x <= hr + 1 && y >= ht - 1 && y <= hb + 1);
    const foreign = [];
    for (let y = t + 2; y < b - 2; y++) {
      for (let x = l; x < r - 2; x++) {
        if (inHole(x, y)) continue;
        const px = png.at(x, y);
        if (px.some((v, k) => Math.abs(v - ground[k]) > 2)) foreign.push(`${x - l},${y - t}:${px.join(',')}`);
      }
    }
    return { ground: ground.join(','), foreign };
  };

  const VIEWPORTS = [{ width: 1024, height: 600 }, { width: 640, height: 844 }];
  for (const [name, b] of engines) {
    for (const theme of ['light', 'dark']) {
      for (const viewport of VIEWPORTS) {
        const at = `${name}, ${theme}, ${viewport.width}x${viewport.height}`;

        test(`${at}: a row under the pointer shows nothing through its frozen pair`, async () => {
          const page = await open(b, { theme, viewport });
          try {
            const row = page.locator('.wv-grid tbody tr.entity-row').nth(0);
            const box = await row.locator('td[data-field="Buy URL"]').boundingBox();
            await page.mouse.move(box.x + box.width - 4, box.y + 4);
            await page.waitForTimeout(250);
            const { ground, foreign } = await sample(page, 0);
            assert.deepEqual(foreign.slice(0, 6), [], `every frozen pixel is the row's ground ${ground}`);
          } finally { await page.close(); }
        });

        if (viewport.width >= 1024) test(`${at}: the row open in the dock keeps its frozen pair opaque`, async () => {
          const page = await open(b, { theme, viewport, docked: true });
          try {
            await page.mouse.move(1, viewport.height - 1);
            await page.waitForTimeout(150);
            const rest = await sample(page, 0);
            assert.deepEqual(rest.foreign.slice(0, 6), [],
              `the docked row's frozen pixels are its own light ${rest.ground}, not the value scrolled beneath`);
            const row = page.locator('.wv-grid tbody tr.entity-row').nth(0);
            const box = await row.locator('td[data-field="Buy URL"]').boundingBox();
            await page.mouse.move(box.x + box.width - 4, box.y + 4);
            await page.waitForTimeout(250);
            const hover = await sample(page, 0);
            assert.deepEqual(hover.foreign.slice(0, 6), [], `and under the pointer too (${hover.ground})`);
          } finally { await page.close(); }
        });
      }
    }

    test(`${name}: a field frozen beside # wears the docked light over the surface, not over nothing`, async () => {
      const views = await (await fetch(`${base}/api/tables/${shop.id}/views`)).json();
      const view = (views.views ?? views).find((v) => v.default) ?? (views.views ?? views)[0];
      const url = `${base}/api/tables/${shop.id}/views/${encodeURIComponent(view.name)}`;
      const patch = (body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.ok((await patch({ frozen: 1, widths: { Name: 200 } })).ok, 'the view takes a frozen field');
      const page = await open(b, { theme: 'light', viewport: { width: 1600, height: 800 }, docked: true });
      try {
        const bg = await page.evaluate(() => {
          const row = document.querySelector('.wv-grid tbody tr.row-docked');
          const name = row.querySelector('td[data-field="Name"]');
          return { name: getComputedStyle(name).backgroundImage, position: getComputedStyle(name).position,
            color: getComputedStyle(name).backgroundColor };
        });
        assert.equal(bg.position, 'sticky', 'Name is frozen for this case');
        assert.match(bg.name, /gradient/, `the light is a layer over the ground, got ${bg.name}`);
        assert.doesNotMatch(bg.color, /rgba\(.*, 0(\.\d+)?\)$/, `over an opaque ground, got ${bg.color}`);
      } finally {
        await page.close();
        await patch({ frozen: 0, widths: { Name: null } });
      }
    });

    test(`${name}: a chosen row's frozen pair is its tint, with nothing through it`, async () => {
      const page = await open(b, { theme: 'light', viewport: VIEWPORTS[0] });
      try {
        await page.click('.wv-grid tbody tr.entity-row td.sel-cell .sel-box');
        await painted(page, '.wv-grid tbody tr.row-selected');
        await page.evaluate(() => document.activeElement?.blur());
        await page.mouse.move(1, VIEWPORTS[0].height - 1);
        await page.waitForTimeout(250);
        const { ground, foreign } = await sample(page, 0);
        assert.deepEqual(foreign.slice(0, 6), [], `every frozen pixel is the chosen tint ${ground}`);
      } finally { await page.close(); }
    });
  }

  test('a first-paint wait that misses says what the page had instead', async () => {
    const page = await browser.newPage({ viewport: VIEWPORTS[0], deviceScaleFactor: 1 });
    try {
      await page.goto(`${base}/#/table/${shop.id}`, { waitUntil: 'load' });
      await painted(page, '.wv-grid tbody tr.entity-row');
      await assert.rejects(() => painted(page, '.wv-grid tbody tr.nothing-paints-this', { timeout: 500 }), (err) => {
        assert.match(err.message, /never painted within 500 ms/);
        const said = JSON.parse(err.message.slice(err.message.indexOf('{')));
        assert.equal(said.skeleton, false, 'the route skeleton stood down once the grid drew (Issue #713)');
        assert.ok(said.rows > 0, `the page accounts for its rows, and says it has ${said.rows}`);
        assert.ok(said.main.length > 0, 'and for what stands in #main');
        return true;
      });
    } finally { await page.close(); }
  });
}
