import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

let list, bare, ids;
const s = await launch('board cover drop', (weave) => {
  weave.createSpace({ name: 'Buyer' });
  list = weave.createTable({ space: 'Buyer', name: 'Shopping List' });
  weave.addField(list.id, { name: 'State', type: 'select', config: { options: [{ name: 'Research' }, { name: 'Ready to Buy' }] } });
  weave.addField(list.id, { name: 'Photo', type: 'attachments', config: { multiple: false, preview: 'cover', size: 'medium' } });
  bare = weave.createTable({ space: 'Buyer', name: 'Wish List' });
  weave.addField(bare.id, { name: 'State', type: 'select', config: { options: [{ name: 'Research' }] } });
});

if (s) {
  const { base, browser, weave } = s;
  const seed = () => {
    for (const t of [list, bare]) for (const e of weave.listEntities(t.id)) weave.deleteEntity(e.id, { hard: true });
    ids = {
      desk: weave.createEntity(list.id, { name: 'Standing desk', values: { State: 'Ready to Buy' } }).id,
      chair: weave.createEntity(list.id, { name: 'Chair', values: { State: 'Research' } }).id,
      lamp: weave.createEntity(bare.id, { name: 'Lamp', values: { State: 'Research' } }).id,
    };
    weave.attachToField(ids.chair, 'Photo', { name: 'old.png', mime: 'image/png', bytes: Buffer.from(PNG, 'base64') });
    weave.tableView(`${list.id}/Standard`, { layout: 'board', group: ['State'], fields: ['Name', 'State', 'Photo'], picture: 'medium', sort: [] });
    weave.tableView(`${bare.id}/Standard`, { layout: 'board', group: ['State'], sort: [] });
  };
  const open = async (table, { theme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-board .tile');
    return page;
  };
  const tile = (id) => `.wv-board .tile[data-eid="${id}"]`;
  const drag = (page, sel, types, files) => page.evaluate(({ sel, types, files, png }) => {
    const node = document.querySelector(sel);
    const dt = new DataTransfer();
    for (const [name, type] of files) {
      const body = type === 'image/png' ? Uint8Array.from(atob(png), (c) => c.charCodeAt(0)) : 'words';
      dt.items.add(new File([body], name, { type }));
    }
    return types.map((type) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      node.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
  }, { sel, types, files, png: PNG });
  const lit = (page, sel) => page.$eval(sel, (n) => n.classList.contains('is-file-drop'));
  const photo = (id) => weave.readEntity(id).raw.Photo ?? [];
  const until = async (read, { timeout = 10000 } = {}) => {
    const end = Date.now() + timeout;
    let got = await read();
    while (!got && Date.now() < end) { await new Promise((r) => setTimeout(r, 50)); got = await read(); }
    return got;
  };

  for (const theme of ['light', 'dark']) {
    test(`a desktop file dragged over a card lights it, and leaving clears it (${theme})`, async () => {
      seed();
      const page = await open(list, { theme });
      try {
        const sel = tile(ids.desk);
        const before = await page.$eval(sel, (n) => getComputedStyle(n).boxShadow);
        assert.deepEqual(await drag(page, sel, ['dragenter', 'dragover'], [['desk.png', 'image/png']]), [true, true], 'the card takes the file drag');
        assert.ok(await lit(page, sel), 'the card wears is-file-drop');
        const during = await page.$eval(sel, (n) => getComputedStyle(n).boxShadow);
        assert.notEqual(during, before, 'the highlight draws');
        await drag(page, sel, ['dragleave'], [['desk.png', 'image/png']]);
        assert.equal(await lit(page, sel), false);
        assert.deepEqual(photo(ids.desk), [], 'a drag that left uploads nothing');
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    });
  }

  test('a picture dropped on a card uploads into its cover field and the card repaints with it', async () => {
    seed();
    const page = await open(list);
    try {
      const upload = page.waitForResponse((r) => r.request().method() === 'POST' && /\/fields\/Photo\/files$/.test(r.url()));
      await drag(page, tile(ids.desk), ['dragenter', 'dragover', 'drop'], [['desk.png', 'image/png']]);
      assert.equal((await upload).status(), 201, 'the drop goes through the field files route');
      const [fid] = await until(() => (photo(ids.desk).length ? photo(ids.desk) : null));
      assert.ok(fid, 'the row holds the dropped file');
      await page.waitForFunction(({ sel, fid }) => (document.querySelector(`${sel} .tile-cover img`)?.getAttribute('src') ?? '').includes(fid), { sel: tile(ids.desk), fid });
      assert.equal(await lit(page, tile(ids.desk)), false, 'the highlight ends with the drop');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('a picture dropped on a card that has a cover replaces it', async () => {
    seed();
    const page = await open(list);
    try {
      const [old] = photo(ids.chair);
      await drag(page, tile(ids.chair), ['dragenter', 'dragover', 'drop'], [['new.png', 'image/png']]);
      const [fid] = await until(() => (photo(ids.chair)[0] !== old ? photo(ids.chair) : null));
      assert.equal(photo(ids.chair).length, 1);
      await page.waitForFunction(({ sel, fid }) => (document.querySelector(`${sel} .tile-cover img`)?.getAttribute('src') ?? '').includes(fid), { sel: tile(ids.chair), fid });
      assert.equal(await page.locator('.wv-toast.err').count(), 0, 'no refusal toast');
    } finally { await page.close(); }
  });

  test('a file that is no picture is refused with a toast that says why', async () => {
    seed();
    const page = await open(list);
    try {
      let posted = 0;
      page.on('request', (r) => { if (r.method() === 'POST' && /\/files$/.test(r.url())) posted += 1; });
      await drag(page, tile(ids.desk), ['dragenter', 'dragover', 'drop'], [['quote.pdf', 'application/pdf']]);
      await page.locator('.wv-toast', { hasText: 'quote.pdf is not a picture' }).waitFor();
      assert.match(await page.locator('.wv-toast').last().textContent(), /PNG, JPEG, GIF or WebP/);
      assert.equal(posted, 0, 'nothing uploads');
      assert.deepEqual(photo(ids.desk), []);
    } finally { await page.close(); }
  });

  test('a table with no cover field offers Add a Photo field, which adds it and sets the cover', async () => {
    seed();
    const page = await open(bare);
    try {
      await drag(page, tile(ids.lamp), ['dragenter', 'dragover', 'drop'], [['lamp.png', 'image/png']]);
      const note = page.locator('.wv-toast', { hasText: 'no picture field' });
      await note.waitFor();
      await note.locator('.wv-toast-action', { hasText: 'Add a Photo field' }).click();
      const field = await until(() => weave.describeSchema().flatMap((x) => x.tables).find((t) => t.name === 'Wish List')?.fields.find((f) => f.name === 'Photo'));
      assert.equal(field.type, 'attachments');
      const [fid] = await until(() => (weave.readEntity(ids.lamp).raw.Photo?.length ? weave.readEntity(ids.lamp).raw.Photo : null));
      await page.waitForFunction(({ sel, fid }) => (document.querySelector(`${sel} .tile-cover img`)?.getAttribute('src') ?? '').includes(fid), { sel: tile(ids.lamp), fid });
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}
