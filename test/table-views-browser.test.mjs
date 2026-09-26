/* The view strip (Feature #229; Kyle's rulings 2026-09-23 and 2026-09-25):
   tabs under the table title. Order is the only signal of the default: the
   leftmost tab opens with the table, and dragging a tab (mouse or touch, or
   Alt+Left / Alt+Right) reorders the strip. No star, no ⋯ button, no Blank
   tab: double-click renames a tab in place; right-click (or Shift+F10)
   opens Rename…, Duplicate view… and a hold-to-delete Delete view; + makes a
   view with every field, no filter, no sort. A table keeps at least one
   view. A change to the filter, the sort or the columns autosaves into the
   view on screen; the old …/view/blank link still opens the raw table,
   read-only. Every write here is the tableView verb an agent calls — the
   assertions read the engine back, not the DOM alone. Issue #341 rides
   along: + New on a filtered view makes a row the grid can show.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let jobs;
const s = await launch('table view strip', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(jobs, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Doing', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  weave.addField(jobs, { name: 'Owner', type: 'text' });
  for (const [name, Status] of [['A', 'Open'], ['B', 'Doing'], ['C', 'Done'], ['D', 'Open']]) {
    weave.createEntity(jobs, { name, values: { Status } });
  }
});

if (s) {
  const { base, browser, weave } = s;
  const reset = () => {
    if (!weave.tableView(jobs).views.some((v) => v.name === 'Default')) weave.tableView(`${jobs.id}/Default`, { from: 'blank' });
    for (const v of weave.tableView(jobs).views) if (v.name !== 'Default') weave.tableView(`${jobs.id}/${v.id}`, { delete: true });
    weave.tableView(`${jobs.id}/Default`, { position: 0, filters: {}, sort: [], fields: ['Name', 'Description', 'Status', 'Owner'] });
  };
  const order = () => weave.tableView(jobs).views.map((v) => v.name);
  const idOf = (name) => weave.tableView(`${jobs.id}/${name}`).id;
  const open = async (hash = `#/table/${jobs.id}`, theme = 'light', opts = {}) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, colorScheme: theme, ...opts });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.view-strip .view-tab');
    return page;
  };
  const tabs = (page) => page.$$eval('.view-strip .view-tab', (ts) => ts.map((t) => ({
    name: t.textContent.trim(), active: t.classList.contains('active'),
  })));
  const tab = (page, name) => page.locator('.view-strip').getByRole('tab', { name, exact: true });
  const waitOrder = async (page, want) => {
    await page.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('.view-strip .view-tab')].map((t) => t.textContent.trim())) === JSON.stringify(w), want);
  };
  const hold = async (page, locator, ms = 1400) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  };
  const rows = (page) => page.$$eval('.wv-grid tbody tr.entity-row', (rs) => rs.length);
  const heads = (page) => page.$$eval('.wv-grid thead th .col-label', (hs) => hs.map((h) => h.textContent.trim()));

  test('the strip sits under the title: the leftmost view open, then +; no star, no dots, no Blank tab', async () => {
    reset();
    const page = await open();
    try {
      assert.deepEqual(await tabs(page), [{ name: 'Default', active: true }]);
      assert.equal(await page.locator('.view-strip .view-add').count(), 1, 'the + makes a view');
      assert.equal(await page.locator('.view-strip .view-star').count(), 0, 'no star: order says which view is the default');
      assert.equal(await page.locator('.view-strip .dots-btn').count(), 0, 'no ⋯ button in the strip');
      assert.equal(await page.locator('.view-strip .view-tab.blank').count(), 0, 'no Blank tab');
      assert.ok(!/blank/i.test(await page.locator('.view-strip').textContent()), 'Blank is not in the strip at all');
      const order = await page.evaluate(() => {
        const title = document.querySelector('#main h1, #main .page-title, #main h2');
        const strip = document.querySelector('.view-strip');
        const grid = document.querySelector('.wv-grid');
        return [!!(title.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING), !!(strip.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING)];
      });
      assert.deepEqual(order, [true, true], 'title, then strip, then grid');
    } finally { await page.close(); }
  });

  test('a filter chip autosaves into the view on screen, through the view verb', async () => {
    reset();
    weave.tableView(`${jobs.id}/Mine`, { fields: ['Name', 'Status'] });
    const mine = weave.tableView(`${jobs.id}/Mine`);
    const page = await open(`#/table/${jobs.id}/view/${mine.id}`);
    try {
      const patched = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/tables/${jobs.id}/views/`));
      await page.click('.filter-strip .filter-chip:text-is("Done")');
      await patched;
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 1);
      assert.deepEqual(weave.tableView(`${jobs.id}/Mine`).filters, { Status: ['Done'] }, 'saved into Mine');
      assert.equal(weave.tableView(`${jobs.id}/Default`).filters, undefined, 'the default did not move');
      assert.deepEqual(await heads(page), ['Name', 'Status'], "the grid shows Mine's columns, in Mine's order");
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.view-tab.active');
      assert.equal((await tabs(page)).find((t) => t.active).name, 'Mine', 'the permalink reopens the view');
      assert.equal(await rows(page), 1);
    } finally { reset(); await page.close(); }
  });

  test('an old …/view/blank link still opens the raw table, read-only, and the note names a real control', async () => {
    reset();
    weave.tableView(`${jobs.id}/Default`, { filters: { Status: ['Open'] }, hide: ['Owner'] });
    const page = await open(`#/table/${jobs.id}/view/blank`);
    try {
      assert.equal(await rows(page), 4, 'every row');
      assert.ok((await heads(page)).includes('Owner'), 'every field');
      assert.deepEqual(await tabs(page), [{ name: 'Default', active: false }], 'no tab is lit: the raw table has none');
      await page.click('.filter-strip .filter-chip:text-is("Done")');
      await page.waitForFunction(() => /read-only/.test(document.body.textContent));
      const note = await page.evaluate(() => [...document.querySelectorAll('.toast, .wv-toast, [role=alert], [role=status]')].map((t) => t.textContent).join(' ') || document.body.textContent);
      assert.match(note, /\+/, 'it points at + (a control that exists), not at a Save as view item that is gone');
      assert.doesNotMatch(note, /Save as view/);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.filter-strip .filter-chip.on').count(), 0, 'the chip did not turn on');
      assert.deepEqual(weave.tableView(`${jobs.id}/Default`).filters, { Status: ['Open'] }, 'nothing moved');
    } finally { reset(); await page.close(); }
  });

  test('right-click a tab: Rename…, Duplicate view… and Delete view; Duplicate copies it and opens the copy', async () => {
    reset();
    weave.tableView(`${jobs.id}/Default`, { filters: { Status: ['Open'] } });
    const page = await open();
    try {
      await tab(page, 'Default').click({ button: 'right' });
      const items = await page.$$eval('.view-ctx .dropdown-item', (xs) => xs.map((x) => x.textContent.trim()));
      assert.deepEqual(items, ['Rename…', 'Duplicate view…', 'Delete view']);
      await page.click('.view-ctx .dropdown-item:text-is("Duplicate view…")');
      await page.fill('#modal input[name=name]', 'Open copy');
      await page.click('#modal button[type=submit]');
      await page.waitForFunction(() => document.querySelector('.view-tab.active')?.textContent.includes('Open copy'));
      const copy = weave.tableView(`${jobs.id}/Open copy`);
      assert.deepEqual(copy.filters, { Status: ['Open'] }, 'the copy carries the filter');
      assert.ok(new RegExp(`/view/${copy.id}$`).test(await page.evaluate(() => location.hash)), 'the URL names the copy');
      assert.equal(await rows(page), 2);
    } finally { reset(); await page.close(); }
  });

  test('+ makes a view with every field, no filter, no sort — even from a filtered view — and puts it last', async () => {
    reset();
    weave.tableView(`${jobs.id}/Default`, { filters: { Status: ['Open'] }, hide: ['Owner'], sort: [{ field: 'Name', dir: 'desc' }] });
    const page = await open();
    try {
      await page.click('.view-strip .view-add');
      await page.fill('#modal input[name=name]', 'Fresh');
      await page.click('#modal button[type=submit]');
      await page.waitForFunction(() => document.querySelector('.view-tab.active')?.textContent.includes('Fresh'));
      const fresh = weave.tableView(`${jobs.id}/Fresh`);
      assert.deepEqual(fresh.fields, ['Name', 'Description', 'Status', 'Owner']);
      assert.ok(!fresh.filters && !fresh.sort, 'the system default: no filter, no sort');
      assert.deepEqual(order(), ['Default', 'Fresh']);
      assert.equal(await rows(page), 4);
    } finally { reset(); await page.close(); }
  });

  test('drag a tab to the front with the mouse: the order saves, and the bare table route opens that view', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    weave.tableView(`${jobs.id}/B`, { from: 'blank', filters: { Status: ['Done'] } });
    const page = await open(`#/table/${jobs.id}/view/${idOf('A')}`);
    try {
      assert.equal(await tab(page, 'B').getAttribute('draggable'), 'false', 'the link\'s own native drag is off, so the pointer drag owns the gesture');
      const from = await tab(page, 'B').boundingBox();
      const to = await tab(page, 'Default').boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + 2, to.y + to.height / 2, { steps: 12 });
      await page.mouse.up();
      await waitOrder(page, ['B', 'Default', 'A']);
      await page.waitForLoadState('networkidle');
      assert.deepEqual(order(), ['B', 'Default', 'A'], 'saved through the verb');
      assert.equal((await tabs(page)).find((t) => t.active).name, 'A', 'the drag is not a click: the view on screen stays');
      await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.view-tab.active');
      assert.equal((await tabs(page)).find((t) => t.active).name, 'B', 'the leftmost view opens with the table');
      assert.equal(await rows(page), 1, "and it is B's grid");
    } finally { reset(); await page.close(); }
  });

  // CDP's touch input is Chromium's; WEAVE_BROWSER=webkit runs the rest.
  const cdpTouch = !process.env.WEAVE_BROWSER || process.env.WEAVE_BROWSER === 'chromium';
  test('drag with a finger: press and hold a tab, then slide it; a quick swipe does not reorder', { skip: cdpTouch ? false : 'CDP touch input is Chromium-only' }, async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    weave.tableView(`${jobs.id}/B`, { from: 'blank' });
    const page = await open(`#/table/${jobs.id}`, 'light', { hasTouch: true });
    try {
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      const from = await tab(page, 'A').boundingBox();
      const to = await tab(page, 'Default').boundingBox();
      const x0 = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      const slide = async () => { for (let k = 1; k <= 10; k++) await touch('touchMove', x0 + ((to.x + 2) - x0) * (k / 10), y); };
      await touch('touchStart', x0, y);
      await slide();
      await touch('touchEnd');
      await page.waitForTimeout(300);
      assert.deepEqual(order(), ['Default', 'A', 'B'], 'a finger that slides at once is a scroll, not a drag');
      assert.equal(await page.locator('.view-tab.dragging').count(), 0);
      await touch('touchStart', x0, y);
      await page.waitForTimeout(600);
      assert.equal(await page.locator('.view-tab.dragging').count(), 1, 'held still, the tab lifts');
      await slide();
      await touch('touchEnd');
      await waitOrder(page, ['A', 'Default', 'B']);
      await page.waitForLoadState('networkidle');
      assert.deepEqual(order(), ['A', 'Default', 'B'], 'a touch drag saves the same order a mouse drag does');
      assert.equal(await page.locator('.view-ctx').count(), 0, 'a hold that became a drag opens no menu');
      const a = await tab(page, 'A').boundingBox();
      await touch('touchStart', a.x + a.width / 2, a.y + a.height / 2);
      await page.waitForTimeout(600);
      await touch('touchEnd');
      await page.waitForSelector('.view-ctx');
      assert.deepEqual(order(), ['A', 'Default', 'B'], 'held and let go without sliding: the menu, and nothing moved');
    } finally { reset(); await page.close(); }
  });

  test('double-click a tab name to rename it in place: Enter commits, Escape cancels', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    const page = await open();
    try {
      await tab(page, 'A').dblclick();
      const input = page.locator('.view-strip .view-tab input');
      await input.waitFor();
      await input.fill('Alpha');
      await input.press('Enter');
      await waitOrder(page, ['Default', 'Alpha']);
      assert.deepEqual(order(), ['Default', 'Alpha']);
      await tab(page, 'Alpha').dblclick();
      await input.waitFor();
      await input.fill('Nope');
      await input.press('Escape');
      await waitOrder(page, ['Default', 'Alpha']);
      assert.deepEqual(order(), ['Default', 'Alpha'], 'Escape leaves the name alone');
      await tab(page, 'Alpha').click({ button: 'right' });
      await page.click('.view-ctx .dropdown-item:text-is("Rename…")');
      await input.waitFor();
      await input.fill('Again');
      await input.blur();
      await waitOrder(page, ['Default', 'Again']);
      assert.deepEqual(order(), ['Default', 'Again'], 'the menu\'s Rename… is the same editor; blur commits');
    } finally { reset(); await page.close(); }
  });

  test('Delete view from the menu is hold-to-confirm; the last view cannot go', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    const page = await open(`#/table/${jobs.id}/view/${idOf('A')}`);
    try {
      await tab(page, 'A').click({ button: 'right' });
      await hold(page, page.locator('.view-ctx .hold-btn'));
      await waitOrder(page, ['Default']);
      assert.deepEqual(order(), ['Default']);
      assert.equal((await tabs(page)).find((t) => t.active).name, 'Default', 'deleting the view on screen opens the leftmost');
      await tab(page, 'Default').click({ button: 'right' });
      await hold(page, page.locator('.view-ctx .hold-btn'));
      await page.waitForFunction(() => /at least one view/.test(document.body.textContent));
      assert.deepEqual(order(), ['Default'], 'the last view stays');
    } finally { reset(); await page.close(); }
  });

  test('keyboard: Alt+Left / Alt+Right move the focused tab; Shift+F10 opens its menu', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    weave.tableView(`${jobs.id}/B`, { from: 'blank' });
    const page = await open();
    try {
      await tab(page, 'B').focus();
      await page.keyboard.press('Alt+ArrowLeft');
      await waitOrder(page, ['Default', 'B', 'A']);
      await page.waitForFunction(() => document.activeElement?.classList.contains('view-tab') && document.activeElement.textContent.trim() === 'B');
      await page.keyboard.press('Alt+ArrowLeft');
      await waitOrder(page, ['B', 'Default', 'A']);
      assert.deepEqual(order(), ['B', 'Default', 'A'], 'saved');
      await page.keyboard.press('Alt+ArrowRight');
      await waitOrder(page, ['Default', 'B', 'A']);
      assert.deepEqual(order(), ['Default', 'B', 'A']);
      assert.ok(page.url().includes(`#/table/${jobs.id}`), 'Alt+Left moved the tab, not the browser back');
      await page.keyboard.press('Shift+F10');
      await page.waitForSelector('.view-ctx');
      assert.deepEqual(await page.$$eval('.view-ctx .dropdown-item', (xs) => xs.map((x) => x.textContent.trim())), ['Rename…', 'Duplicate view…', 'Delete view']);
    } finally { reset(); await page.close(); }
  });

  test('hiding a column with the eye hides it in this view only', async () => {
    reset();
    weave.tableView(`${jobs.id}/Narrow`, { from: 'Default' });
    const page = await open(`#/table/${jobs.id}/view/${weave.tableView(`${jobs.id}/Narrow`).id}`);
    try {
      await page.click('.eye-btn');
      await page.click('.chip-pop .eye-row:has(.eye-label:text-is("Owner"))');
      await page.waitForFunction(() => ![...document.querySelectorAll('.wv-grid thead .col-label')].some((h) => h.textContent.trim() === 'Owner'));
      assert.ok(!weave.tableView(`${jobs.id}/Narrow`).fields.includes('Owner'));
      assert.ok(weave.tableView(`${jobs.id}/Default`).fields.includes('Owner'), 'the default still shows it');
    } finally { reset(); await page.close(); }
  });

  test('+ New on a filtered view makes a row the grid can show (Issue #341)', async () => {
    reset();
    weave.tableView(`${jobs.id}/Default`, { filters: { Status: ['Done'] } });
    const page = await open();
    try {
      assert.equal(await rows(page), 1);
      const before = weave.query(jobs).total;
      await page.click('.wv-grid tr.add-entity-row .add-entity-btn');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 2);
      assert.equal(weave.query(jobs).total, before + 1);
      const made = weave.query(jobs).items.find((e) => !['A', 'B', 'C', 'D'].includes(e.name));
      assert.equal(made.fields.Status, 'Done', 'the new row starts inside the filter');
    } finally {
      for (const e of weave.query(jobs).items) if (!['A', 'B', 'C', 'D'].includes(e.name)) weave.deleteEntity(e.id, { hard: true });
      reset(); await page.close();
    }
  });

  test('both themes: the active tab is marked by an underline the theme can see', async () => {
    reset();
    for (const theme of ['light', 'dark']) {
      const page = await open(`#/table/${jobs.id}`, theme);
      try {
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        const { line, bg, color } = await page.$eval('.view-tab.active', (a) => {
          const cs = getComputedStyle(a);
          return { line: cs.borderBottomColor, bg: getComputedStyle(document.body).backgroundColor, color: cs.color };
        });
        assert.notEqual(line, 'rgba(0, 0, 0, 0)', `${theme}: the underline is drawn`);
        assert.notEqual(line, bg, `${theme}: and it is not the page colour`);
        assert.notEqual(color, bg, `${theme}: the label reads`);
      } finally { await page.close(); }
    }
  });
}
