import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let wide, narrow, loaded;
const s = await launch('fields popover drag and height', (weave) => {
  weave.createSpace({ name: 'Ops' });
  wide = weave.createTable({ space: 'Ops', name: 'Wide' });
  for (let i = 1; i <= 24; i++) weave.addField(wide, { name: `Field ${String(i).padStart(2, '0')}`, type: 'text' });
  weave.createEntity(wide, { name: 'Row' });
  narrow = weave.createTable({ space: 'Ops', name: 'Narrow' });
  weave.addField(narrow, { name: 'Owner', type: 'text' });
  weave.createEntity(narrow, { name: 'Row' });
  loaded = weave.createTable({ space: 'Ops', name: 'Loaded' });
  weave.addField(loaded, { name: 'Owner', type: 'text' });
  weave.addField(loaded, { name: 'Stage', type: 'text' });
  weave.addField(loaded, { name: 'Amount', type: 'number' });
  for (let i = 1; i <= 3; i++) {
    weave.createEntity(loaded, { name: `Case ${i}`, values: { Owner: `Owner ${i}`, Stage: 'Open', Amount: i * 10 } });
  }
});

if (s) {
  const { base, browser, weave } = s;
  const cursorAt = (page, x, y) => page.evaluate(([x, y]) => { const n = document.elementFromPoint(x, y); return getComputedStyle(n).cursor + (n.closest('.field-reorder-handle, .eye-row, .table-field-row') ? '' : ` (on ${n.tagName}.${n.className?.baseVal ?? n.className})`); }, [x, y]);

  test('a field row reads grab at rest, grabbing for the whole drag, and the drop line is square (Issue #445)', async () => {
    weave.tableView(`${narrow.id}/${weave.tableView(narrow).views[0].id}`, { fields: ['Name', 'Description', 'Owner'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${narrow.id}`, { waitUntil: 'networkidle' });
      await page.click('.eye-btn');
      await page.locator('.table-fields-popover').evaluate((pop) => Promise.all(pop.getAnimations().map((a) => a.finished)));
      const owner = await page.locator('.table-field-row[data-field="Owner"] .eye-label').boundingBox();
      const grip = await page.locator('.table-field-row[data-field="Owner"] .field-reorder-handle').boundingBox();
      const name = await page.locator('.table-field-row[data-field="Name"]').boundingBox();
      assert.equal(await cursorAt(page, owner.x + 4, owner.y + owner.height / 2), 'grab', 'the name reads grab, not an I-beam');
      assert.equal(await cursorAt(page, grip.x + grip.width / 2, grip.y + grip.height / 2), 'grab', 'the grip reads grab');
      await page.mouse.move(owner.x + 4, owner.y + owner.height / 2);
      await page.mouse.down();
      await page.mouse.move(owner.x + 4, owner.y - 8, { steps: 3 });
      await page.mouse.move(name.x + 20, name.y + 3, { steps: 4 });
      assert.equal(await cursorAt(page, name.x + 20, name.y + name.height / 2), 'grabbing', 'over another row, mid-drag');
      assert.match(await cursorAt(page, 40, 600), /^grabbing/, 'outside the list, mid-drag');
      assert.equal(await page.evaluate(() => getSelection().toString()), '', 'the drag selects no text');
      const line = await page.$eval('.table-fields-popover .drop-line', (l) => ({ radius: getComputedStyle(l).borderTopLeftRadius, h: l.getBoundingClientRect().height }));
      assert.equal(line.radius, '0px', 'the insertion line has square ends');
      await page.mouse.up();
      await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].map((h) => h.textContent.trim()).join(',') === 'Owner,Name,Description');
      assert.deepEqual(weave.tableView(narrow).views[0].fields, ['Owner', 'Name', 'Description']);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('wv-grabbing')), false, 'the drop lets the cursor go');
      assert.equal(await page.locator('.table-fields-popover .drop-line').count(), 0);
      assert.equal(await page.locator('.table-field-row[data-field="Owner"] input').isChecked(), true, 'a drag is not a click: the field still shows');
      const desc = await page.locator('.table-field-row[data-field="Description"] .eye-label').boundingBox();
      await page.mouse.move(desc.x + 4, desc.y + desc.height / 2);
      await page.mouse.down();
      await page.mouse.move(desc.x + 4, desc.y - 30, { steps: 4 });
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('wv-grabbing')), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('wv-grabbing')), false, 'Escape lets the cursor go');
      await page.mouse.up();
      await page.waitForLoadState('networkidle');
      assert.deepEqual(weave.tableView(narrow).views[0].fields, ['Owner', 'Name', 'Description'], 'Escape moved nothing');
    } finally { await page.close(); }
  });

  test('a hide leaves the grid with no read of its own, and a show reads once (Issue #328)', async () => {
    const viewId = weave.tableView(loaded).views[0].id;
    weave.tableView(`${loaded.id}/${viewId}`, { fields: ['Name', 'Owner', 'Stage', 'Amount'] });
    const viewFields = () => weave.tableView(`${loaded.id}/${viewId}`).fields;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      let queries = 0;
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().endsWith(`/api/tables/${loaded.id}/query`)) queries++;
      });
      const patches = [];
      let gate = null;
      await page.route(`**/api/tables/${loaded.id}/views/**`, async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        patches.push(route.request().postDataJSON());
        if (gate) await gate.held;
        await route.continue();
      });
      const colWidths = () => page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll('#main .wv-grid thead th.col-head')]
          .map((th) => [th.dataset.col, Math.round(th.getBoundingClientRect().width)])));
      const columns = () => page.evaluate(() => [...document.querySelectorAll('#main .wv-grid thead th.col-head')].map((th) => th.dataset.col));
      const cellsOf = (col) => page.evaluate((c) => [...document.querySelectorAll(`#main .wv-grid tbody td[data-field="${c}"]`)]
        .map((td) => (td.textContent.trim() || td.querySelector('input')?.value || '').trim()), col);
      const until = async (ok, what) => {
        for (const t0 = Date.now(); !ok();) {
          if (Date.now() - t0 > 5000) throw new Error(`timed out waiting for ${what}`);
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      await page.goto(`${base}/#/table/${loaded.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .wv-grid thead th.col-head[data-col="Stage"]');
      const before = await colWidths();
      assert.deepEqual(await columns(), ['Name', 'Owner', 'Stage', 'Amount']);

      queries = 0;
      await page.click('.eye-btn');
      await page.locator('.table-fields-popover').evaluate((pop) => Promise.all(pop.getAnimations().map((a) => a.finished)));
      let release;
      gate = { held: new Promise((r) => { release = r; }) };
      await page.click('.table-field-row[data-field="Stage"] input');
      await page.waitForFunction(() => ![...document.querySelectorAll('#main .wv-grid thead th.col-head')].some((th) => th.dataset.col === 'Stage'), null, { timeout: 2000 });
      assert.equal(patches.length, 1, 'the hide is on the wire');
      assert.equal(queries, 0, 'the column left the grid before its PATCH answered, with no table read');
      release();
      await until(() => !viewFields().includes('Stage'), 'the hide to reach the view');
      await page.waitForTimeout(600);
      assert.deepEqual(viewFields(), ['Name', 'Owner', 'Amount'], 'the hide reached the view');
      assert.deepEqual(await columns(), ['Name', 'Owner', 'Amount'], 'the grid drew the remaining columns');
      assert.equal(queries, 0, 'a hide reads no rows at all');
      const afterHide = await colWidths();
      for (const c of ['Name', 'Owner', 'Amount']) {
        assert.equal(afterHide[c], before[c], `${c} kept its width through the hide`);
      }

      gate = null;
      queries = 0;
      await page.click('.table-field-row[data-field="Stage"] input');
      await page.waitForFunction(() => [...document.querySelectorAll('#main .wv-grid thead th.col-head')].some((th) => th.dataset.col === 'Stage'), null, { timeout: 4000 });
      await page.waitForTimeout(600);
      assert.deepEqual(await cellsOf('Stage'), ['Open', 'Open', 'Open'], 'the shown column carries its data');
      assert.equal(queries, 1, 'a show reads the rows once');
      const afterShow = await colWidths();
      for (const c of ['Name', 'Owner', 'Amount']) {
        assert.equal(afterShow[c], before[c], `${c} kept its width through the show`);
      }
      assert.deepEqual(await columns(), ['Name', 'Owner', 'Stage', 'Amount'], 'the column came back where it was');
    } finally { await page.close(); }
  });

  for (const height of [900, 560]) {
    test(`the Fields list grows to the room below its button before it scrolls, header outside the scroll box (Issue #446, ${height}px)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height } });
      try {
        await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'networkidle' });
        await page.click('.eye-btn');
        await page.locator('.table-fields-popover').evaluate((pop) => Promise.all(pop.getAnimations().map((a) => a.finished)));
        const m = await page.evaluate(() => {
          const pop = document.querySelector('.table-fields-popover');
          const list = pop.querySelector('.table-field-list');
          const btn = document.querySelector('.eye-btn').getBoundingClientRect();
          return {
            popScrolls: pop.scrollHeight > pop.clientHeight + 1,
            listScrolls: list.scrollHeight > list.clientHeight + 1,
            bottomGap: innerHeight - pop.getBoundingClientRect().bottom,
            below: pop.getBoundingClientRect().top >= btn.bottom,
            legendInList: !!list.querySelector('.table-field-legend'),
            headInList: !!list.querySelector('.table-control-head'),
          };
        });
        assert.equal(m.popScrolls, false, 'the popover itself never scrolls; only the list does');
        assert.equal(m.below, true, 'it opens under its button');
        assert.equal(m.legendInList || m.headInList, false, 'the header sits outside the scroll box');
        if (m.listScrolls) assert.ok(m.bottomGap <= 32, `a scrolling list has used the room below (${m.bottomGap}px left)`);
        if (height === 560) assert.equal(m.listScrolls, true, 'a short window scrolls the list');
        if (m.listScrolls) {
          await page.$eval('.table-field-list', (l) => { l.scrollTop = 50; });
          await page.waitForTimeout(400);
          const cut = await page.$eval('.table-field-list', (l) => {
            const top = l.getBoundingClientRect().top;
            const first = [...l.querySelectorAll('.table-field-row')].find((r) => r.getBoundingClientRect().bottom > top + 1);
            return first.getBoundingClientRect().top - top;
          });
          assert.ok(Math.abs(cut) <= 3, `the first visible row starts at the top of the list, not half under it (${cut}px)`);
        }
      } finally { await page.close(); }
    });
  }
}
