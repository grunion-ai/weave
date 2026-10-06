import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const rows = {};
let decks;

const s = await launch('attachment drop', (weave) => {
  weave.createSpace({ name: 'Product' });
  decks = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(decks, { name: 'Files', type: 'attachments' });
  for (const n of ['grid-light', 'grid-dark', 'leave', 'text', 'many', 'page-light', 'page-dark', 'button']) {
    rows[n] = weave.createEntity(decks, { name: n });
  }
  rows.full = weave.createEntity(decks, { name: 'full' });
  weave.attachToField(rows.full.id, 'Files', { name: 'deck.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF') });
});

if (s) {
  const { base, browser, weave } = s;

  async function open(hash, theme, ready) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#${hash}`, { waitUntil: 'networkidle' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector(ready);
    return page;
  }

  const drag = (page, sel, types, { files = [], text = null } = {}) => page.evaluate(({ sel, types, files, text }) => {
    const node = document.querySelector(sel);
    const dt = new DataTransfer();
    for (const [name, body] of files) dt.items.add(new File([body], name, { type: 'text/plain' }));
    if (text != null) dt.setData('text/plain', text);
    return types.map((type) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt });
      node.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
  }, { sel, types, files, text });

  const cellSel = (row) => `tr[data-eid="${rows[row].id}"] td[data-field="Files"]`;
  const stored = (row) => {
    const e = weave.readEntity ? weave.readEntity(rows[row].id) : weave.getEntity(rows[row].id);
    return (e.files ?? []).map((f) => ({ name: f.name, bytes: weave.readFile(f.id).bytes.toString() }));
  };
  const hasClass = (page, sel) => page.$eval(sel, (n) => n.classList.contains('is-file-drop'));

  for (const theme of ['light', 'dark']) {
    test(`files dragged over an empty grid cell show a drop target, and the drop uploads them (${theme})`, async () => {
      const row = `grid-${theme}`;
      const sel = cellSel(row);
      const page = await open(`/table/${decks.id}`, theme, sel);
      try {
        const before = await page.$eval(sel, (n) => { const r = n.getBoundingClientRect(); return [r.width, r.height, getComputedStyle(n).boxShadow]; });
        const taken = await drag(page, sel, ['dragenter', 'dragover'], { files: [['brief.txt', 'the brief']] });
        assert.deepEqual(taken, [true, true], 'a file drag over the cell is not accepted');
        assert.ok(await hasClass(page, sel), 'the cell shows no drop target while files hover it');
        const during = await page.$eval(sel, (n) => { const r = n.getBoundingClientRect(); return [r.width, r.height, getComputedStyle(n).boxShadow]; });
        assert.deepEqual(during.slice(0, 2), before.slice(0, 2), 'the drop target moved the layout');
        assert.notEqual(during[2], before[2], 'the drop target is a class with no visible style');
        assert.notEqual(during[2], 'none', 'the drop target draws nothing');

        const upload = page.waitForResponse((r) => r.request().method() === 'POST' && /\/fields\/Files\/files$/.test(r.url()));
        await drag(page, sel, ['drop'], { files: [['brief.txt', 'the brief']] });
        assert.equal((await upload).status(), 201, 'the drop did not upload through the field files route');
        await page.waitForFunction((s) => document.querySelector(s)?.textContent.includes('brief.txt'), sel);
        assert.equal(await hasClass(page, sel), false, 'the drop target outlived the drop');
        assert.deepEqual(stored(row), [{ name: 'brief.txt', bytes: 'the brief' }], 'the server does not hold the dropped file');
      } finally { await page.close(); }
    });

    test(`the entity page's attachments box takes a dropped file (${theme})`, async () => {
      const row = `page-${theme}`;
      const page = await open(`/entity/${rows[row].id}`, theme, '.attach-box');
      try {
        await drag(page, '.attach-box', ['dragenter', 'dragover'], { files: [['notes.txt', 'n']] });
        assert.ok(await hasClass(page, '.attach-box'), 'the entity page shows no drop target');
        await drag(page, '.attach-box', ['drop'], { files: [['notes.txt', 'n']] });
        await page.waitForSelector('.attach-item a:text("notes.txt")');
        assert.deepEqual(stored(row), [{ name: 'notes.txt', bytes: 'n' }]);
      } finally { await page.close(); }
    });
  }

  for (const theme of ['light', 'dark']) {
    test(`an empty file cell keeps the row the height of a full one (${theme})`, async () => {
      const page = await open(`/table/${decks.id}`, theme, cellSel('full'));
      try {
        const h = await page.$$eval('.wv-grid tbody tr[data-eid]', (trs) => trs.map((tr) => Math.round(tr.getBoundingClientRect().height)));
        assert.equal(new Set(h).size, 1, `every row is the same height (${h.join(', ')})`);
        const chip = await page.$eval(`${cellSel('text')} .k-attach`, (n) => ({ cls: [...n.classList], border: getComputedStyle(n).borderTopStyle }));
        assert.ok(chip.cls.includes('is-empty') && !chip.cls.includes('empty'), 'the empty chip answers to the framework `.empty`');
        assert.equal(chip.border, 'dashed', 'the empty file chip lost the dashed edge every empty pointer chip wears');
      } finally { await page.close(); }
    });
  }

  test('dragging back out of the cell clears the drop target', async () => {
    const sel = cellSel('leave');
    const page = await open(`/table/${decks.id}`, 'light', sel);
    try {
      await drag(page, sel, ['dragenter', 'dragover'], { files: [['x.txt', 'x']] });
      assert.ok(await hasClass(page, sel));
      await drag(page, `${sel} .k-attach`, ['dragenter'], { files: [['x.txt', 'x']] });
      await drag(page, sel, ['dragleave'], { files: [['x.txt', 'x']] });
      assert.ok(await hasClass(page, sel), 'moving onto the chip dropped the target');
      await drag(page, `${sel} .k-attach`, ['dragleave'], { files: [['x.txt', 'x']] });
      assert.equal(await hasClass(page, sel), false, 'dragleave left the drop target on');
      assert.deepEqual(stored('leave'), [], 'a drag that left uploaded anyway');
    } finally { await page.close(); }
  });

  test('a drag that carries no files shows no target and is not swallowed', async () => {
    const sel = cellSel('text');
    const page = await open(`/table/${decks.id}`, 'light', sel);
    try {
      const taken = await drag(page, sel, ['dragenter', 'dragover', 'drop'], { text: 'just words' });
      assert.deepEqual(taken, [false, false, false], 'a text drag was taken by the file cell');
      assert.equal(await hasClass(page, sel), false, 'a text drag lit the file drop target');
      assert.deepEqual(stored('text'), []);
    } finally { await page.close(); }
  });

  test('every dropped file is uploaded, and the cell names them all', async () => {
    const sel = cellSel('many');
    const page = await open(`/table/${decks.id}`, 'light', sel);
    try {
      const files = [['a.txt', 'A'], ['b.txt', 'B'], ['c.txt', 'C']];
      await drag(page, sel, ['dragenter', 'dragover', 'drop'], { files });
      await page.waitForFunction((s) => /a\.txt.*b\.txt.*c\.txt/.test(document.querySelector(s)?.textContent), sel);
      assert.deepEqual(stored('many'), files.map(([name, bytes]) => ({ name, bytes })));
    } finally { await page.close(); }
  });

  test('the + file button still uploads through the same path', async () => {
    const page = await open(`/entity/${rows.button.id}`, 'light', '.attach-box');
    try {
      await page.setInputFiles('.attach-box input[type=file]', { name: 'picked.txt', mimeType: 'text/plain', buffer: Buffer.from('p') });
      await page.waitForSelector('.attach-item a:text("picked.txt")');
      assert.deepEqual(stored('button'), [{ name: 'picked.txt', bytes: 'p' }]);
    } finally { await page.close(); }
  });
}
