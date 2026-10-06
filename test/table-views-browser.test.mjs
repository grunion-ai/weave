import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf } from './lib/browser.mjs';

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
    if (!weave.tableView(jobs).views.some((v) => v.name === 'Standard')) weave.tableView(`${jobs.id}/Standard`, { from: 'blank' });
    for (const v of weave.tableView(jobs).views) if (v.name !== 'Standard') weave.tableView(`${jobs.id}/${v.id}`, { delete: true });
    weave.tableView(`${jobs.id}/Standard`, { position: 0, filters: {}, sort: [], fields: ['Name', 'Description', 'Status', 'Owner'] });
  };
  const order = () => weave.tableView(jobs).views.map((v) => v.name);
  const idOf = (name) => weave.tableView(`${jobs.id}/${name}`).id;
  const open = async (hash = `#/table/${jobs.id}`, theme = 'light', opts = {}) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, colorScheme: theme, ...opts });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.click('.table-view-btn');
    await page.waitForSelector('.view-strip .view-row');
    return page;
  };
  const ensureViews = async (page) => {
    if (!await page.locator('.table-view-popover').isVisible()) await page.click('.table-view-btn');
  };
  const tabs = async (page) => {
    await ensureViews(page);
    return page.$$eval('.view-strip .view-row', (ts) => ts.map((t) => ({
      name: t.querySelector('.view-name').textContent.trim(), active: t.classList.contains('active'),
    })));
  };
  const tab = (page, name) => page.locator('.view-strip .view-row').filter({ has: page.locator('.view-name', { hasText: new RegExp(`^${name}$`) }) });
  const grip = (page, name) => tab(page, name).locator('.view-grip');
  const waitOrder = async (page, want) => {
    await ensureViews(page);
    await page.waitForFunction((w) => JSON.stringify([...document.querySelectorAll('.view-strip .view-row .view-name')].map((t) => t.textContent.trim())) === JSON.stringify(w), want);
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

  test('the menu opens from the eyebrow: the first view active, then Add view; no star, no dots, no Blank tab', async () => {
    reset();
    const page = await open();
    try {
      assert.deepEqual(await tabs(page), [{ name: 'Standard', active: true }]);
      assert.equal(await page.locator('.view-strip .view-add').count(), 1, 'the + makes a view');
      assert.equal(await page.locator('.view-strip .view-star').count(), 0, 'no star: order says which view is the default');
      assert.equal(await page.locator('.view-strip .dots-btn').count(), 0, 'no ⋯ button in the strip');
      assert.equal(await page.locator('.view-strip .view-tab.blank').count(), 0, 'no Blank tab');
      assert.ok(!/blank/i.test(await page.locator('.view-strip').textContent()), 'Blank is not in the strip at all');
      assert.equal(await page.locator('.table-view-popover .view-strip').isVisible(), true, 'views live inside their eyebrow dropdown');
    } finally { await page.close(); }
  });

  test('a filter chip autosaves into the view on screen, through the view verb', async () => {
    reset();
    weave.tableView(`${jobs.id}/Mine`, { fields: ['Name', 'Status'] });
    const mine = weave.tableView(`${jobs.id}/Mine`);
    const page = await open(`#/table/${jobs.id}/view/${mine.id}`);
    try {
      const patched = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/tables/${jobs.id}/views/`));
      await page.click('.table-filter-btn');
      await page.click('.filter-strip .filter-chip:text-is("Done")');
      await patched;
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 1);
      assert.deepEqual(weave.tableView(`${jobs.id}/Mine`).filters, { Status: ['Done'] }, 'saved into Mine');
      assert.equal(weave.tableView(`${jobs.id}/Standard`).filters, undefined, 'the default did not move');
      assert.deepEqual(await heads(page), ['Name', 'Status'], "the grid shows Mine's columns, in Mine's order");
      await page.reload({ waitUntil: 'networkidle' });
      await page.click('.table-view-btn');
      await page.waitForSelector('.view-tab.active');
      assert.equal((await tabs(page)).find((t) => t.active).name, 'Mine', 'the permalink reopens the view');
      assert.equal(await rows(page), 1);
    } finally { reset(); await page.close(); }
  });

  test('an old …/view/blank link still opens the raw table, read-only, and the note names a real control', async () => {
    reset();
    weave.tableView(`${jobs.id}/Standard`, { filters: { Status: ['Open'] }, hide: ['Owner'] });
    const page = await open(`#/table/${jobs.id}/view/blank`);
    try {
      assert.equal(await rows(page), 4, 'every row');
      assert.ok((await heads(page)).includes('Owner'), 'every field');
      assert.deepEqual(await tabs(page), [{ name: 'Standard', active: false }], 'no tab is lit: the raw table has none');
      await page.click('.table-filter-btn');
      await page.click('.filter-strip .filter-chip:text-is("Done")');
      await page.waitForFunction(() => /read-only/.test(document.body.textContent));
      const note = await page.evaluate(() => [...document.querySelectorAll('.toast, .wv-toast, [role=alert], [role=status]')].map((t) => t.textContent).join(' ') || document.body.textContent);
      assert.match(note, /Add view|\+/, 'it points at Add view, not at a Save as view item that is gone');
      assert.doesNotMatch(note, /Save as view/);
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.filter-strip .filter-chip.on').count(), 0, 'the chip did not turn on');
      assert.deepEqual(weave.tableView(`${jobs.id}/Standard`).filters, { Status: ['Open'] }, 'nothing moved');
    } finally { reset(); await page.close(); }
  });

  test('every row: a drag handle, the name, row buttons on hover and focus, "Opens first" on the first; no context menu', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    const page = await open();
    try {
      const first = tab(page, 'Standard');
      assert.equal(await first.locator('.view-grip').count(), 1, 'the first row has its handle');
      assert.equal(await tab(page, 'A').locator('.view-grip').isVisible(), true, 'every row shows its handle');
      assert.equal(await first.locator('.view-first').textContent(), 'Opens first');
      assert.equal(await tab(page, 'A').locator('.view-first').count(), 0, 'only the first view carries the caption');
      const acts = tab(page, 'A').locator('.view-acts');
      assert.equal(await acts.evaluate((n) => getComputedStyle(n).opacity), '0', 'the row buttons rest hidden');
      await tab(page, 'A').hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelectorAll('.view-strip .view-row')[1].querySelector('.view-acts')).opacity === '1');
      assert.deepEqual(await acts.locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label'))), ['Rename A', 'Duplicate A', 'Hold to delete A']);
      await page.mouse.move(5, 5);
      await tab(page, 'A').locator('.view-name').focus();
      assert.equal(await styleOf(acts, 'opacity', '1'), '1', 'keyboard focus shows them too');
      await tab(page, 'A').locator('.view-name').click({ button: 'right' });
      await page.keyboard.press('Shift+F10');
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.view-ctx, .dropdown-menu.show').count(), 0, 'no right-click or context menu');
    } finally { reset(); await page.close(); }
  });

  test('Duplicate names the copy inline, prefilled; Enter creates it after its source and opens it, the dropdown open', async () => {
    reset();
    weave.tableView(`${jobs.id}/Standard`, { filters: { Status: ['Open'] } });
    const page = await open();
    try {
      await tab(page, 'Standard').hover();
      await tab(page, 'Standard').locator('.view-dup-btn').click();
      const input = page.locator('.view-strip .view-name-input');
      await input.waitFor();
      assert.equal(await input.evaluate((i) => i === document.activeElement), true, 'focused');
      assert.equal(await input.inputValue(), 'Standard 2');
      assert.equal(await page.locator('#modal:visible, .modal.show').count(), 0, 'no modal');
      await input.fill('Open copy');
      await input.press('Enter');
      await page.waitForFunction(() => document.querySelector('.table-view-btn')?.textContent.includes('Open copy'));
      assert.equal(await page.locator('.table-view-popover').isVisible(), true, 'the dropdown stays open');
      await waitOrder(page, ['Standard', 'Open copy']);
      const copy = weave.tableView(`${jobs.id}/Open copy`);
      assert.deepEqual(copy.filters, { Status: ['Open'] }, 'the copy carries the filter');
      assert.ok(new RegExp(`/view/${copy.id}$`).test(await page.evaluate(() => location.hash)), 'the URL names the copy');
      assert.equal((await tabs(page)).find((t) => t.active).name, 'Open copy');
      assert.equal(await rows(page), 2);
    } finally { reset(); await page.close(); }
  });

  test('+ Add view appends an inline row named View 2: Enter makes a view with every field, no filter, no sort, and opens it', async () => {
    reset();
    weave.tableView(`${jobs.id}/Standard`, { filters: { Status: ['Open'] }, hide: ['Owner'], sort: [{ field: 'Name', dir: 'desc' }] });
    const page = await open();
    try {
      await page.click('.view-strip .view-add');
      const input = page.locator('.view-strip .view-name-input');
      await input.waitFor();
      assert.equal(await input.inputValue(), 'View 2', 'the first free View N');
      assert.equal(await input.evaluate((i) => i === document.activeElement && i.selectionStart === 0 && i.selectionEnd === i.value.length), true, 'focused and selected');
      assert.equal(await page.locator('#modal:visible').count(), 0, 'no modal');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.table-view-btn')?.textContent.includes('View 2'));
      assert.equal(await page.locator('.table-view-popover').isVisible(), true, 'the dropdown stays open');
      const fresh = weave.tableView(`${jobs.id}/View 2`);
      assert.deepEqual(fresh.fields, ['Name', 'Description', 'Status', 'Owner']);
      assert.ok(!fresh.filters && !fresh.sort, 'the system default: no filter, no sort');
      assert.deepEqual(order(), ['Standard', 'View 2']);
      assert.equal(await rows(page), 4);
      await page.click('.view-strip .view-add');
      assert.equal(await page.locator('.view-strip .view-name-input').inputValue(), 'View 3');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.view-strip .view-name-input'));
      assert.deepEqual(order(), ['Standard', 'View 2'], 'Escape drops the row and makes nothing');
      assert.equal(await page.locator('.table-view-popover').isVisible(), true);
    } finally { reset(); await page.close(); }
  });

  test('a click away from the inline name creates the view, as Enter does', async () => {
    reset();
    const page = await open();
    try {
      await page.click('.view-strip .view-add');
      await page.locator('.view-strip .view-name-input').fill('Clicked away');
      await page.mouse.click(700, 600);
      await page.waitForFunction(() => document.querySelector('.table-view-btn')?.textContent.includes('Clicked away'));
      assert.deepEqual(order(), ['Standard', 'Clicked away']);
    } finally { reset(); await page.close(); }
  });

  test('Rename edits the name in place: Enter commits, Escape cancels, blur commits', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    const page = await open();
    try {
      const input = page.locator('.view-strip .view-name-input');
      await tab(page, 'A').hover();
      await tab(page, 'A').locator('.view-rename-btn').click();
      await input.waitFor();
      assert.equal(await input.inputValue(), 'A');
      await input.fill('Alpha');
      await input.press('Enter');
      await waitOrder(page, ['Standard', 'Alpha']);
      assert.deepEqual(order(), ['Standard', 'Alpha']);
      await tab(page, 'Alpha').hover();
      await tab(page, 'Alpha').locator('.view-rename-btn').click();
      await input.waitFor();
      await input.fill('Nope');
      await input.press('Escape');
      await waitOrder(page, ['Standard', 'Alpha']);
      assert.deepEqual(order(), ['Standard', 'Alpha'], 'Escape leaves the name alone');
      assert.equal(await page.locator('.table-view-popover').isVisible(), true, 'and keeps the dropdown open');
      await tab(page, 'Alpha').hover();
      await tab(page, 'Alpha').locator('.view-rename-btn').click();
      await input.waitFor();
      await input.fill('Again');
      await input.blur();
      await waitOrder(page, ['Standard', 'Again']);
      assert.deepEqual(order(), ['Standard', 'Again'], 'blur commits');
    } finally { reset(); await page.close(); }
  });

  test('drag a row by its handle to the top: the order saves, the caption follows it, and the bare table route opens that view', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    weave.tableView(`${jobs.id}/B`, { from: 'blank', filters: { Status: ['Done'] } });
    const page = await open(`#/table/${jobs.id}/view/${idOf('A')}`);
    try {
      const from = await grip(page, 'B').boundingBox();
      const to = await tab(page, 'Standard').boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2, to.y + 2, { steps: 12 });
      assert.equal(await page.evaluate(() => getComputedStyle(document.elementFromPoint(10, 10)).cursor), 'grabbing', 'the drag holds the grabbing cursor');
      const line = await page.$eval('.view-strip .drop-line', (l) => getComputedStyle(l).borderTopLeftRadius);
      assert.equal(line, '0px', 'a straight, square-ended insertion line');
      await page.mouse.up();
      await waitOrder(page, ['B', 'Standard', 'A']);
      await page.waitForLoadState('networkidle');
      assert.deepEqual(order(), ['B', 'Standard', 'A'], 'saved through the verb');
      assert.equal(await tab(page, 'B').locator('.view-first').textContent(), 'Opens first', 'the caption moved with the view');
      assert.equal(await tab(page, 'Standard').locator('.view-first').count(), 0);
      assert.equal((await tabs(page)).find((t) => t.active).name, 'A', 'the drag is not a click: the view on screen stays');
      await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      await page.click('.table-view-btn');
      await page.waitForSelector('.view-row.active');
      assert.equal((await tabs(page)).find((t) => t.active).name, 'B', 'the first view opens with the table');
      assert.equal(await rows(page), 1, "and it is B's grid");
    } finally { reset(); await page.close(); }
  });

  test('a drag whose first move already lands on another row still picks the row up (Issue #400)', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    const page = await open();
    try {
      const from = await grip(page, 'A').boundingBox();
      const to = await tab(page, 'Standard').boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2, to.y + 2);
      await page.mouse.up();
      await waitOrder(page, ['A', 'Standard']);
      await page.waitForLoadState('networkidle');
      assert.deepEqual(order(), ['A', 'Standard']);
    } finally { reset(); await page.close(); }
  });

  const cdpTouch = !process.env.WEAVE_BROWSER || process.env.WEAVE_BROWSER === 'chromium';
  test('drag with a finger by the handle', { skip: cdpTouch ? false : 'CDP touch input is Chromium-only' }, async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    weave.tableView(`${jobs.id}/B`, { from: 'blank' });
    const page = await open(`#/table/${jobs.id}`, 'light', { hasTouch: true });
    try {
      const cdp = await page.context().newCDPSession(page);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      const from = await grip(page, 'A').boundingBox();
      const to = await tab(page, 'Standard').boundingBox();
      const x0 = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      await touch('touchStart', x0, y);
      for (let k = 1; k <= 10; k++) await touch('touchMove', x0, y + ((to.y + 2) - y) * (k / 10));
      await touch('touchEnd');
      await waitOrder(page, ['A', 'Standard', 'B']);
      await page.waitForLoadState('networkidle');
      assert.deepEqual(order(), ['A', 'Standard', 'B'], 'a touch drag saves the same order a mouse drag does');
    } finally { reset(); await page.close(); }
  });

  test('Delete is a hold on the row button; the last view cannot go', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    const page = await open(`#/table/${jobs.id}/view/${idOf('A')}`);
    try {
      await tab(page, 'A').hover();
      await tab(page, 'A').locator('.view-del').click();
      await page.waitForTimeout(300);
      assert.deepEqual(order(), ['Standard', 'A'], 'a click is not a hold');
      await tab(page, 'A').hover();
      await hold(page, tab(page, 'A').locator('.view-del'));
      await waitOrder(page, ['Standard']);
      assert.deepEqual(order(), ['Standard']);
      assert.equal((await tabs(page)).find((t) => t.active).name, 'Standard', 'deleting the view on screen opens the first');
      await tab(page, 'Standard').hover();
      await hold(page, tab(page, 'Standard').locator('.view-del'));
      await page.waitForFunction(() => /at least one view/.test(document.body.textContent));
      assert.deepEqual(order(), ['Standard'], 'the last view stays');
    } finally { reset(); await page.close(); }
  });

  test('keyboard: Alt+Up / Alt+Down move the focused row and keep its focus', async () => {
    reset();
    weave.tableView(`${jobs.id}/A`, { from: 'blank' });
    weave.tableView(`${jobs.id}/B`, { from: 'blank' });
    const page = await open();
    try {
      await tab(page, 'B').locator('.view-name').focus();
      await page.keyboard.press('Alt+ArrowUp');
      await waitOrder(page, ['Standard', 'B', 'A']);
      await page.waitForFunction(() => document.activeElement?.classList.contains('view-name') && document.activeElement.textContent.trim() === 'B');
      await page.keyboard.press('Alt+ArrowUp');
      await waitOrder(page, ['B', 'Standard', 'A']);
      assert.deepEqual(order(), ['B', 'Standard', 'A'], 'saved');
      assert.equal(await tab(page, 'B').locator('.view-first').count(), 1, 'the caption follows the view to the top');
      await page.waitForFunction(() => document.activeElement?.textContent.trim() === 'B');
      await page.keyboard.press('Alt+ArrowDown');
      await waitOrder(page, ['Standard', 'B', 'A']);
      assert.deepEqual(order(), ['Standard', 'B', 'A']);
      assert.ok(page.url().includes(`#/table/${jobs.id}`), 'Alt+Up moved the row, not the browser');
      await tab(page, 'A').locator('.view-grip').focus();
      await page.keyboard.press('Alt+ArrowUp');
      await waitOrder(page, ['Standard', 'A', 'B']);
      await page.waitForFunction(() => document.activeElement?.classList.contains('view-grip'));
    } finally { reset(); await page.close(); }
  });

  test('hiding a column with the eye hides it in this view only', async () => {
    reset();
    weave.tableView(`${jobs.id}/Narrow`, { from: 'Standard' });
    const page = await open(`#/table/${jobs.id}/view/${weave.tableView(`${jobs.id}/Narrow`).id}`);
    try {
      await page.click('.eye-btn');
      await page.click('.chip-pop .eye-row:has(.eye-label:text-is("Owner"))');
      await page.waitForFunction(() => ![...document.querySelectorAll('.wv-grid thead .col-label')].some((h) => h.textContent.trim() === 'Owner'));
      assert.ok(!weave.tableView(`${jobs.id}/Narrow`).fields.includes('Owner'));
      assert.ok(weave.tableView(`${jobs.id}/Standard`).fields.includes('Owner'), 'the default still shows it');
    } finally { reset(); await page.close(); }
  });

  test('+ New on a filtered view makes a row the grid can show (Issue #341)', async () => {
    reset();
    weave.tableView(`${jobs.id}/Standard`, { filters: { Status: ['Done'] } });
    const page = await open();
    try {
      assert.equal(await rows(page), 1);
      const before = weave.query(jobs).total;
      await page.keyboard.press('Escape');
      await page.waitForSelector('.table-view-popover', { state: 'detached' });
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

  test('both themes: the view on screen is marked by a fill and a check the theme can see', async () => {
    reset();
    for (const theme of ['light', 'dark']) {
      const page = await open(`#/table/${jobs.id}`, theme);
      try {
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        const { fill, pop, color, check } = await page.$eval('.view-row.active', (r) => ({
          fill: getComputedStyle(r).backgroundColor, pop: getComputedStyle(r.closest('.chip-pop')).backgroundColor,
          color: getComputedStyle(r.querySelector('.view-name')).color, check: r.querySelector('.view-check').textContent,
        }));
        assert.notEqual(fill, pop, `${theme}: the active row has its own fill`);
        assert.notEqual(color, pop, `${theme}: the name reads`);
        assert.equal(check, '✓', `${theme}: and a check`);
      } finally { await page.close(); }
    }
  });
}
