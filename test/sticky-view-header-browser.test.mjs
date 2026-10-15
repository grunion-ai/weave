import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const DESC = 'A description with enough words in it to wrap onto a second line of the header, so the measured height is not the bare title.';

let tasks, wide, alpha, long;
const s = await launch('sticky view header', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Tasks', description: DESC });
  weave.addField(tasks, { name: 'Note', type: 'number' });
  for (let i = 0; i < 200; i++) weave.createEntity('Tasks', { name: `task ${i}`, values: { Note: i } });
  wide = weave.createTable({ space: 'Work', name: 'Wide', description: DESC });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'text' });
  for (let i = 0; i < 200; i++) weave.createEntity('Wide', { name: `w${i}` });
  const spacesT = Object.values(weave.state.tables).find((t) => t.system === 'spaces');
  weave.addField(spacesT.id, { name: 'Tasks · Note · sum', type: 'rollup', config: { via: 'Work/Tasks', targetField: 'Note', aggregate: 'sum' } });
  weave.updateTable(tasks.id, { hideRollups: false });
  const projects = weave.createTable({ space: 'Work', name: 'Projects' });
  alpha = weave.createEntity(projects, { name: 'Alpha' });
  long = weave.createTable({
    space: 'Work', name: 'Long',
    description: Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of a description nobody should have to scroll past to reach the rows.`).join('\n\n'),
  });
  for (let i = 0; i < 300; i++) weave.createEntity('Long', { name: `l${String(i).padStart(4, '0')}` });
});

if (s) {
  const { base, browser } = s;
  const box = (page, sel) => page.evaluate((q) => {
    const n = document.querySelector(q);
    return n ? { ...n.getBoundingClientRect().toJSON(), ih: innerHeight, iw: innerWidth } : null;
  }, sel);
  const onScreen = (r) => r && r.height > 0 && r.top >= -1 && r.bottom <= r.ih + 1;
  const scrollMain = (page, y) => page.evaluate((t) => document.querySelector('#main').scrollTo({ top: t, behavior: 'instant' }), y);
  const mainTop = (page) => page.evaluate(() => ({ top: document.querySelector('#main').getBoundingClientRect().top, scrolled: document.querySelector('#main').scrollTop }));
  const open = async (id, theme = null) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody tr[data-eid]');
    await page.waitForSelector('.view-desc-body');
    await page.waitForTimeout(400);
    return page;
  };

  test('the page scrolls under the header: crumb, title, description and toolbar all hold', async () => {
    const page = await open(tasks.id);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.table-wrap')).overflowX), 'clip',
      'the fitting grid clips, so the page is the box that scrolls');
    await scrollMain(page, 2000);
    await page.waitForTimeout(200);
    const main = await mainTop(page);
    assert.ok(main.scrolled > 500, 'the page really scrolled');
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0, 'inside the panel, never the window');
    const header = await box(page, '#main > .view-header');
    assert.ok(Math.abs(header.top - main.top) < 2, `the header is parked at the top of the panel: top=${header.top} panel=${main.top}`);
    for (const sel of ['.view-header .crumb-path', '.view-header .view-title', '.view-header .view-desc-body', '.view-header .crumb-actions']) {
      assert.ok(onScreen(await box(page, sel)), `${sel} is still on screen after scrolling`);
    }
    await page.close();
  });

  test('the field headers and the Σ row start where the view header ends', async () => {
    const page = await open(tasks.id);
    await page.waitForSelector('.wv-grid thead tr.wv-foot td');
    await scrollMain(page, 2000);
    await page.waitForTimeout(200);
    assert.ok((await mainTop(page)).scrolled > 500, 'the rows have gone under the headers');
    const header = await box(page, '#main > .view-header');
    const th = await box(page, '.wv-grid thead th.col-head');
    const foot = await box(page, '.wv-grid thead tr.wv-foot td');
    assert.ok(th.top >= header.bottom - 1 && th.top <= header.bottom + 2,
      `the field headers rest against the view header's lower edge: th=${th.top} header bottom=${header.bottom}`);
    assert.ok(th.top >= 0 && th.bottom <= th.ih, 'and are on screen');
    assert.ok(foot.top >= th.bottom - 1, `the sigma row sits below the field headers: foot=${foot.top} th bottom=${th.bottom}`);
    await page.close();
  });

  test('a grid that scrolls in its own box keeps the header too', async () => {
    const page = await open(wide.id);
    assert.ok(await page.evaluate(() => document.querySelector('.table-wrap').classList.contains('wv-grid-scroll')),
      'the wide grid carries its own vertical scroller');
    await page.evaluate(() => { document.querySelector('.table-wrap').scrollTop = 1500; });
    await page.waitForTimeout(200);
    const header = await box(page, '#main > .view-header');
    assert.ok(onScreen(header), `the header is on screen after the wrap scrolled: ${JSON.stringify(header)}`);
    const wrap = await box(page, '.table-wrap');
    const th = await box(page, '.wv-grid thead th.col-head');
    assert.ok(th.top >= wrap.top - 1 && th.top < wrap.top + 40, `the field headers hold at the top of the wrap: th=${th.top} wrap=${wrap.top}`);
    assert.ok(th.top >= header.bottom - 1, 'and below the view header, not under it');
    await page.close();
  });

  test('the header paints an opaque band in both themes', async () => {
    for (const theme of ['light', 'dark']) {
      const page = await open(tasks.id, theme);
      const paint = await page.evaluate(() => {
        const h = document.querySelector('#main > .view-header');
        const cs = getComputedStyle(h);
        return { pos: cs.position, bg: cs.backgroundColor, main: getComputedStyle(document.querySelector('#main')).backgroundColor, pad: cs.paddingBottom, mar: cs.marginBottom };
      });
      assert.equal(paint.pos, 'sticky', `${theme}: the header is sticky`);
      assert.equal(paint.bg, paint.main, `${theme}: it wears the panel's own background, so rows cannot show through`);
      assert.ok(!/rgba\(0, 0, 0, 0\)/.test(paint.bg), `${theme}: and that background is opaque`);
      assert.equal(paint.mar, '0px', `${theme}: the gap under the header is padding`);
      assert.ok(parseFloat(paint.pad) >= 8, `${theme}: and the padding is the gap`);
      await page.close();
    }
  });

  test('the docked entity pane pins its header too (Issue #411)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${base}/#/entity/${alpha.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main > .view-header');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#main > .view-header')).position), 'sticky');
    assert.equal(await page.evaluate(() => {
      const d = document.createElement('div');
      d.innerHTML = '<div class="dock-entity"><div class="view-header"></div></div>';
      document.querySelector('#dock').append(d);
      const p = getComputedStyle(d.querySelector('.view-header')).position;
      d.remove();
      return p;
    }), 'sticky');
    await page.close();
  });

  test('the docked pane has a header of its own and never takes the page header\'s place', async () => {
    const page = await open(tasks.id);
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wv-view-h'));
    await page.goto(`${base}/#/table/${tasks.id}?e=${alpha.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock .dock-entity .view-header');
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const page = document.querySelector('#main > .view-header');
      return {
        v: root.getPropertyValue('--wv-view-h'),
        measured: `${page.getBoundingClientRect().height}px`,
        pos: getComputedStyle(page).position,
        dockPos: getComputedStyle(document.querySelector('#dock .dock-entity .view-header')).position,
      };
    });
    assert.equal(after.pos, 'sticky', 'the page header still holds');
    assert.equal(after.dockPos, 'sticky', 'the dock\'s holds in its own pane (Issue #411)');
    assert.equal(after.v, after.measured, 'the reading still tracks the page header, not the dock\'s');
    assert.ok(parseFloat(before) > 0 && parseFloat(after.v) > 0, `both readings are real: ${before} then ${after.v}`);
    await page.setViewportSize({ width: 900, height: 720 });
    await page.waitForTimeout(400);
    const narrow = await page.evaluate(() => {
      const h = document.querySelector('#main > .view-header');
      return {
        v: getComputedStyle(document.documentElement).getPropertyValue('--wv-view-h'),
        want: getComputedStyle(h).position === 'sticky' ? `${h.getBoundingClientRect().height}px` : '0px',
      };
    });
    assert.equal(narrow.v, narrow.want, `the reading followed the page header: ${JSON.stringify(narrow)}`);
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`an opened long description is capped, so the held block leaves the rows the viewport (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
      try {
        await page.goto(`${base}/#/table/${long.id}`, { waitUntil: 'networkidle' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.waitForSelector('.wv-grid tbody tr[data-eid]');
        await page.waitForSelector('.view-desc-more');
        await page.click('.view-desc-more');
        await page.waitForTimeout(400);
        await scrollMain(page, 4000);
        await page.waitForTimeout(400);
        const m = await page.evaluate(() => {
          const rect = (n) => n.getBoundingClientRect().toJSON();
          const hdr = document.querySelector('#main > .view-header');
          const th = document.querySelector('.wv-grid thead th.col-head');
          const body = hdr.querySelector('.view-desc-body');
          const h = rect(hdr);
          const x = rect(th).left + 20;
          return {
            scrollY: document.querySelector('#main').scrollTop, mainTop: document.querySelector('#main').getBoundingClientRect().top, ih: innerHeight, hdr: h, th: rect(th),
            pos: getComputedStyle(hdr).position,
            parts: Object.fromEntries(['.crumb-path', '.view-title', '.view-desc', '.crumb-actions', '.view-desc-more']
              .map((q) => [q, rect(hdr.querySelector(q))])),
            rowUnderHead: !!document.elementFromPoint(x, rect(th).bottom + 3)?.closest('tbody tr[data-eid]'),
            body: { clamped: body.classList.contains('clamped'), scroll: body.scrollHeight, client: body.clientHeight, overflow: getComputedStyle(body).overflowY },
          };
        });
        assert.ok(m.scrollY > 3000, `the page scrolled: ${m.scrollY}`);
        assert.equal(m.pos, 'sticky', 'the header still holds');
        assert.ok(Math.abs(m.hdr.top - m.mainTop) < 2, `the block rests at the top of the panel: ${JSON.stringify(m.hdr)}`);
        for (const [q, r] of Object.entries(m.parts)) {
          assert.ok(r.top >= -1 && r.bottom <= m.hdr.bottom + 0.5, `long description, opened: ${q} is on screen inside the header block ${JSON.stringify({ r, hdr: m.hdr })}`);
        }
        assert.ok(m.hdr.bottom <= m.ih * 0.45, `the held block takes under half the viewport ${JSON.stringify({ hdr: m.hdr, ih: m.ih })}`);
        assert.ok(Math.abs(m.th.top - m.hdr.bottom) <= 2, `the field headers sit right under it: th=${m.th.top} header bottom=${m.hdr.bottom}`);
        assert.ok(m.rowUnderHead, 'and a body row shows under them');
        assert.equal(m.body.clamped, false, 'the description is open');
        assert.ok(m.body.scroll > m.body.client && m.body.overflow === 'auto', `the rest of it scrolls inside the block ${JSON.stringify(m.body)}`);

        await page.click('.view-desc-body p');
        await page.waitForSelector('.view-desc-edit');
        await page.waitForTimeout(300);
        const e = await page.evaluate(() => {
          const hdr = document.querySelector('#main > .view-header');
          const ta = hdr.querySelector('.view-desc-edit');
          return { hdr: hdr.getBoundingClientRect().toJSON(), ih: innerHeight, pos: getComputedStyle(hdr).position, scroll: ta.scrollHeight, client: ta.clientHeight, overflow: getComputedStyle(ta).overflowY };
        });
        assert.equal(e.pos, 'sticky', 'editing, the header still holds');
        assert.ok(e.hdr.bottom <= e.ih * 0.45, `editing, the block takes under half the viewport ${JSON.stringify(e)}`);
        assert.ok(e.scroll > e.client && e.overflow === 'auto', `the editor scrolls inside the block ${JSON.stringify(e)}`);
      } finally {
        await page.close();
      }
    });
  }

  test('a window shrunk under the header lets it go, and gives it back', async () => {
    const page = await open(tasks.id);
    const read = () => page.evaluate(() => ({
      pos: getComputedStyle(document.querySelector('#main > .view-header')).position,
      v: getComputedStyle(document.documentElement).getPropertyValue('--wv-view-h'),
    }));
    assert.equal((await read()).pos, 'sticky');
    await page.setViewportSize({ width: 1280, height: 200 });
    await page.waitForTimeout(400);
    const short = await read();
    assert.equal(short.pos, 'static', 'a 200px window keeps the header in the flow');
    assert.equal(short.v, '0px');
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(400);
    assert.equal((await read()).pos, 'sticky', 'and it pins again when there is room');
    await page.close();
  });
}
