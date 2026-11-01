import test from 'node:test';
import assert from 'node:assert/strict';
import { atRest, launch } from './lib/browser.mjs';

const ROWS = 2000;
const NODE_BUDGET = 6000;
const BOARD_CAP = 40;
const STATES = ['Open', 'Doing', 'Done'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const MESSY = ['', 'x'.repeat(400), '<b>bold</b> & <script>1</script>', '   padded   ', 'Ünï 🧪 右から左 \u202e', 'line\nbreak'];
const messyName = (i) => MESSY[i % MESSY.length] || `Row ${i}`;

let big, edge, gallery;
const s = await launch('board volume', (weave) => {
  weave.createSpace({ name: 'Volume' });
  big = weave.createTable({ space: 'Volume', name: 'Case' });
  weave.addField(big.id, { name: 'State', type: 'select', config: { options: STATES.map((name) => ({ name })) } });
  for (let i = 0; i < ROWS; i++) weave.createEntity(big.id, { name: `Case ${i}`, values: { State: STATES[i % STATES.length] } });
  edge = weave.createTable({ space: 'Volume', name: 'Edge' });
  weave.addField(edge.id, { name: 'State', type: 'select', config: { options: [{ name: 'At' }, { name: 'Past' }, { name: 'Empty' }] } });
  for (let i = 0; i < BOARD_CAP; i++) weave.createEntity(edge.id, { name: messyName(i), values: { State: 'At' } });
  for (let i = 0; i <= BOARD_CAP; i++) weave.createEntity(edge.id, { name: messyName(i), values: { State: 'Past' } });
  gallery = weave.createTable({ space: 'Volume', name: 'Gallery' });
  weave.addField(gallery.id, { name: 'Photo', type: 'attachments', config: { multiple: false, preview: 'cover', size: 'medium' } });
  for (let i = 0; i < BOARD_CAP + 5; i++) {
    const made = weave.createEntity(gallery.id, { name: messyName(i) });
    if (i % 3 === 0) weave.attachToField(made.id, 'Photo', { name: `p${i}.png`, mime: 'image/png', bytes: PNG });
  }
});

if (s) {
  const { base, browser, weave } = s;
  const layout = (view, table = big) => {
    for (const v of weave.tableView(table).views) if (v.name !== 'Standard') weave.tableView(`${table.id}/${v.id}`, { delete: true });
    weave.tableView(`${table.id}/Standard`, {
      groups: null, picture: null, completedBy: null, collapsed: null, order: null, filters: {}, sort: [],
      fields: ['Name', 'State'], ...view,
    });
  };
  const open = async (theme = 'light', table = big, viewport = { width: 1440, height: 900 }) => {
    const page = await browser.newPage({ viewport, colorScheme: theme });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.errors = errors;
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    return page;
  };
  const elements = (page) => page.evaluate(() => document.querySelectorAll('*').length);

  test(`a ${ROWS}-row board draws capped columns, not every card (Issue #1266)`, async (t) => {
    layout({ layout: 'board', group: ['State'] });
    const page = await open();
    await page.waitForSelector('.wv-board .tile');
    const per = await page.evaluate(() => [...document.querySelectorAll('.board-cards')].map((c) => c.querySelectorAll('.tile').length));
    const total = await elements(page);
    t.diagnostic(`board: columns ${per.join(', ')}, ${total} elements`);
    assert.equal(per.length, STATES.length, `one column per State, saw ${per.length}`);
    assert.ok(per.every((n) => n <= BOARD_CAP), `every column draws at most one cap of cards, saw ${per.join(', ')}`);
    assert.ok(total < NODE_BUDGET, `${total} elements, budget ${NODE_BUDGET}: Issue #1266 measured 120,644 nodes drawing all ${ROWS} cards`);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('a capped board column extends from its own Show more (Issue #1266)', async () => {
    layout({ layout: 'board', group: ['State'] });
    const page = await open();
    await page.waitForSelector('.wv-board .tile');
    const column = page.locator('.board-cards').first();
    await column.locator('.wv-more').click();
    assert.equal(await column.locator('.tile').count(), BOARD_CAP * 2, 'the column grows by one cap and the others stay put');
    const per = await page.evaluate(() => [...document.querySelectorAll('.board-cards')].map((c) => c.querySelectorAll('.tile').length));
    assert.deepEqual(per.slice(1), per.slice(1).map(() => BOARD_CAP), 'only the clicked column grew');
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('the Show more control draws in both themes (Issue #1266)', async () => {
    layout({ layout: 'board', group: ['State'] });
    for (const theme of ['light', 'dark']) {
      const page = await open(theme);
      const more = page.locator('.board-cards .wv-more').first();
      await more.waitFor();
      assert.ok(await more.isVisible(), `${theme}: the Show more button is visible`);
      const box = await more.boundingBox();
      assert.ok(box.height >= 24 && box.width >= 80, `${theme}: the control has a real hitbox, saw ${box.width}x${box.height}`);
      await page.close();
    }
  });

  test('a group at the cap draws no Show more and one past it offers the one left, with messy names (Issue #1266)', async () => {
    layout({ layout: 'board', groups: 'stacked', group: ['State'], fields: ['Name'] }, edge);
    const page = await open('light', edge);
    try {
      await page.waitForSelector('.wv-board .tile');
      const at = page.locator('.board-group[data-key="At"]');
      const past = page.locator('.board-group[data-key="Past"]');
      assert.equal(await at.locator('.tile').count(), BOARD_CAP);
      assert.equal(await at.locator('.wv-more').count(), 0, 'a group of exactly the cap has nothing more to show');
      assert.equal((await past.locator('.wv-more').textContent()).trim(), `Show 1 more · ${BOARD_CAP} of ${BOARD_CAP + 1} rows`);
      assert.equal(await page.locator('.board-group[data-key="Empty"] .wv-more').count(), 0);
      await past.locator('.wv-more').click();
      assert.equal(await past.locator('.tile').count(), BOARD_CAP + 1);
      assert.equal(await past.locator('.wv-more').count(), 0, 'the button goes once every card is drawn');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('a redraw keeps the cards Show more drew (Issue #1266)', async () => {
    layout({ layout: 'board', group: ['State'] });
    const page = await open();
    try {
      const column = page.locator('.board-cards').first();
      await column.locator('.wv-more').click();
      const drawn = await page.locator('.wv-board').elementHandle();
      await page.evaluate((id) => showDatabase(id), big.id);
      await page.waitForFunction((n) => !n.isConnected, drawn);
      await page.waitForSelector('.wv-board .tile');
      assert.equal(await page.locator('.board-cards').first().locator('.tile').count(), BOARD_CAP * 2, 'the redraw kept both batches');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('Show more keeps its own height in a masonry gallery and overlaps no card (Issue #1266, Issue #1280)', async () => {
    layout({ layout: 'board', group: null, groups: 'stacked', picture: 'medium', fit: 'original', fields: ['Name', 'Photo'] }, gallery);
    const page = await open('light', gallery, { width: 900, height: 900 });
    const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    try {
      await page.waitForSelector('.wv-board .tile');
      await atRest(page.locator('.wv-board'));
      assert.equal(await page.locator('.wv-board').getAttribute('data-flow'), 'masonry');
      const more = page.locator('.board-cards > .wv-more');
      const box = await more.boundingBox();
      assert.ok(box.height >= 24, `a real button, saw ${box.height} px`);
      const band = await page.locator('.board-cards').boundingBox();
      assert.ok(box.y + box.height <= band.y + band.height, `Show more ends inside its column: button bottom ${box.y + box.height}, column bottom ${band.y + band.height}`);
      const others = await page.$$eval('.board-cards > .tile, .board-cards > .board-tail', (ns) => ns.map((n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, name: n.className }; }));
      const struck = others.filter((o) => hit(box, o));
      assert.deepEqual(struck, [], 'Show more sits in its own band');
      await more.click();
      assert.equal(await page.locator('.board-cards > .tile').count(), BOARD_CAP + 5);
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('Show more fits a phone with a long noun and a 44 px target (Issue #1266)', async () => {
    weave.updateTable(edge.id, { noun: 'procurement requisition overdue' });
    layout({ layout: 'board', groups: 'stacked', group: ['State'], fields: ['Name'] }, edge);
    const viewport = { width: 390, height: 844 };
    const page = await browser.newPage({ viewport, hasTouch: true, isMobile: true });
    try {
      await page.goto(`${base}/#/table/${edge.id}`, { waitUntil: 'networkidle' });
      const more = page.locator('.board-group[data-key="Past"] .wv-more');
      await more.waitFor();
      await more.scrollIntoViewIfNeeded();
      const box = await more.boundingBox();
      assert.ok(box.height >= 44, `a 44 px target, saw ${box.height}`);
      assert.ok(box.x + box.width <= viewport.width, `inside the screen, right edge ${box.x + box.width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page does not scroll sideways');
    } finally {
      await page.close();
      weave.updateTable(edge.id, { noun: 'row' });
    }
  });
}
