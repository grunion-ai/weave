import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled, eventually } from './lib/browser.mjs';

await import('../public/column-resize.js');
const CR = globalThis.WeaveColumnResize;

const LONG = 'Synchronising every night';
let n = 0;
const s = await launch('toggle column floor', (weave) => {
  weave.createSpace({ name: 'Switches' });
});

if (s) {
  const { base, browser, weave } = s;
  const ownTable = () => {
    const db = weave.createTable({ space: 'Switches', name: `Switches ${++n}` });
    weave.addField(db, { name: 'On', type: 'toggle' });
    weave.addField(db, { name: 'Run', type: 'toggle', config: { on: 'Running', off: 'Paused' } });
    weave.addField(db, { name: 'Sync', type: 'toggle', config: { on: LONG, off: 'Off' } });
    weave.addField(db, { name: 'Note', type: 'text' });
    weave.createEntity(db, { name: 'Lit', values: { On: true, Run: true, Sync: true, Note: 'a' } });
    weave.createEntity(db, { name: 'Dark', values: { Note: 'b' } });
    return db;
  };
  const openGrid = async (db) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row td[data-field="Sync"] .wv-toggle');
    await page.evaluate(() => document.fonts.ready);
    await settled(page.locator('.wv-grid'));
    return page;
  };
  const head = (page, name) => page.locator(`.wv-grid thead th.col-head[data-col="${name}"]`);
  const widths = (page) => page.$$eval('.wv-grid thead th.col-head', (hs) => Object.fromEntries(hs.map((h) => [h.dataset.col, h.getBoundingClientRect().width])));
  const sameWidths = (before, after, except, label) => {
    for (const [name, w] of Object.entries(before)) {
      if (name === except) continue;
      assert.ok(Math.abs(after[name] - w) <= 0.5, `${label}: ${name} kept its width (${w} → ${after[name]})`);
    }
  };
  const read = (page, name) => page.evaluate(([col, metrics]) => {
    const th = document.querySelector(`.wv-grid thead th.col-head[data-col="${col}"]`);
    const hs = getComputedStyle(th);
    const label = Math.ceil(th.querySelector('.col-label').getBoundingClientRect().width + parseFloat(hs.paddingLeft) + parseFloat(hs.paddingRight));
    const rows = [...document.querySelectorAll(`.wv-grid tbody tr.entity-row td[data-field="${col}"]`)].map((td) => {
      const cs = getComputedStyle(td);
      const pad = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0);
      const sw = td.querySelector('.wv-toggle');
      const word = td.querySelector('.wv-toggle-word');
      const track = td.querySelector('.wv-toggle-track').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(word);
      const room = td.getBoundingClientRect().right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
      return {
        text: word.textContent,
        natural: range.getBoundingClientRect().width,
        pad,
        ellipsized: word.scrollWidth > word.clientWidth,
        track: track.width,
        overhang: Math.max(sw.getBoundingClientRect().right, word.getBoundingClientRect().right, track.right) - room,
      };
    });
    const pad = Math.max(...rows.map((r) => r.pad));
    const words = Math.max(...rows.map((r) => r.natural));
    return { width: th.getBoundingClientRect().width, label, value: Math.ceil(metrics.track + metrics.gap + words + pad), rows };
  }, [name, CR.TOGGLE_METRICS]);
  const whole = (got, name, label) => {
    for (const r of got.rows) {
      assert.equal(r.ellipsized, false, `${label}: ${name}'s "${r.text}" is not ellipsized at ${got.width}px`);
      assert.ok(r.overhang <= 0.5, `${label}: ${name}'s "${r.text}" switch ends inside the cell (${r.overhang}px over)`);
      assert.equal(Math.round(r.track), CR.TOGGLE_METRICS.track, `${label}: ${name}'s track is not squeezed`);
    }
  };

  test('the toggle cell paints the geometry the floor is computed from', async () => {
    const page = await openGrid(ownTable());
    try {
      const seen = await page.evaluate(() => {
        const td = document.querySelector('.wv-grid tbody tr.entity-row td[data-field="On"]');
        const cs = getComputedStyle(td);
        return {
          track: td.querySelector('.wv-toggle-track').getBoundingClientRect().width,
          gap: parseFloat(getComputedStyle(td.querySelector('.wv-toggle')).columnGap),
          pad: ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0),
        };
      });
      assert.deepEqual(seen, CR.TOGGLE_METRICS,
        'public/style.css paints a different track, gap or cell padding than public/column-resize.js computes with');
    } finally { await page.close(); }
  });

  test('a toggle opens at its default, or at its floor when a long word needs more; nothing is cut', async () => {
    const page = await openGrid(ownTable());
    try {
      for (const name of ['On', 'Run']) {
        const got = await read(page, name);
        assert.equal(Math.round(got.width), CR.DEFAULT_WIDTHS.toggle, `${name} opens at the 124 default`);
        whole(got, name, 'at open');
      }
      const sync = await read(page, 'Sync');
      assert.ok(sync.value > CR.DEFAULT_WIDTHS.toggle, `"${LONG}" needs more than 124px (${sync.value})`);
      assert.equal(Math.round(sync.width), sync.value, `Sync opens at its floor, ${sync.value}px, not the default`);
      whole(sync, 'Sync', 'at open');
    } finally { await page.close(); }
  });

  test('a drag, a keyboard nudge and a double-click fit stop at the switch and its wider word', async () => {
    const db = ownTable();
    const stored = (name) => weave.tableView(db.id).views[0].widths?.[name];
    const page = await openGrid(db);
    try {
      for (const name of ['On', 'Run', 'Sync']) {
        let before = await widths(page);
        const grip = await head(page, name).locator('.col-resize').boundingBox();
        const y = grip.y + grip.height / 2;
        await page.mouse.move(grip.x + grip.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(grip.x - 400, y, { steps: 6 });
        await page.mouse.up();
        await settled(page.locator('.wv-grid'));
        let got = await read(page, name);
        const floor = Math.max(got.label, got.value);
        assert.equal(Math.round(got.width), floor, `${name}: a drag stops at the floor, ${floor}px (label ${got.label}, switch and word ${got.value})`);
        assert.ok(got.value > got.label, `${name}: the switch and word, not the label, decide this floor`);
        whole(got, name, 'after a drag');
        sameWidths(before, await widths(page), name, `${name} drag`);

        before = await widths(page);
        await head(page, name).focus();
        const nudged = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/views\//.test(r.url()));
        for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowLeft');
        await nudged;
        await settled(page.locator('.wv-grid'));
        got = await read(page, name);
        assert.equal(Math.round(got.width), floor, `${name}: Alt+← past the floor changes nothing`);
        whole(got, name, 'after a nudge');
        assert.equal(await eventually(() => stored(name), floor), floor, `${name}: the view stores the floor, not a width under it`);
        sameWidths(before, await widths(page), name, `${name} nudge`);

        before = await widths(page);
        await head(page, name).locator('.col-resize').dblclick();
        await settled(page.locator('.wv-grid'));
        got = await read(page, name);
        assert.ok(Math.round(got.width) >= floor, `${name}: a double-click fit never lands under the floor (${got.width} < ${floor})`);
        whole(got, name, 'after a fit');
        sameWidths(before, await widths(page), name, `${name} fit`);
      }
    } finally { await page.close(); }
  });

  test('a stored width under the floor is raised to it, for that column only', async () => {
    const db = ownTable();
    const view = weave.tableView(db.id).views[0];
    weave.tableView(`${db.id}/${view.id}`, { widths: { On: 40, Run: 40, Note: 150 } });
    const page = await openGrid(db);
    try {
      for (const name of ['On', 'Run']) {
        const got = await read(page, name);
        assert.equal(Math.round(got.width), Math.max(got.label, got.value), `${name}: a stored 40px opens at the floor`);
        whole(got, name, 'from a stored 40px');
      }
      const w = await widths(page);
      assert.equal(Math.round(w.Note), 150, 'Note keeps its own stored width');
      assert.equal(Math.round(w.Name), 260, 'Name keeps its default');
    } finally { await page.close(); }
  });
}
