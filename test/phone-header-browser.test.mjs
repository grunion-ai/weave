import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage } from './lib/browser.mjs';

const BODY = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog and keeps going.`).join('\n\n');
const PINNED = { loose: false, position: 'sticky' };
const LOOSE = { loose: true, position: 'static', viewH: '0px' };

let notes, row;
const s = await launch('phone header', (weave) => {
  weave.createSpace({ name: 'Writing' });
  notes = weave.createTable({ space: 'Writing', name: 'Note' });
  row = weave.createEntity(notes, { name: 'A note whose title runs long enough to wrap the phone header onto a second line' });
  weave.setDoc(row.id, BODY);
});

if (s) {
  const { base, browser } = s;

  const openKeyboard = (page, height) => page.evaluate(async (h) => {
    const real = window.visualViewport;
    const fake = { height: h, offsetTop: 0 };
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      get: () => new Proxy(real, { get: (t, k) => (k in fake ? fake[k] : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) }),
    });
    real.dispatchEvent(new Event('resize'));
    await new Promise((r) => requestAnimationFrame(() => r()));
    return Math.max(0, innerHeight - fake.height - fake.offsetTop);
  }, height);

  const readHeader = (page, pane, header) => page.evaluate(([p, h]) => {
    const holder = p === '#main' ? document.documentElement : document.querySelector(p);
    return {
      loose: holder.classList.contains('view-header-loose'),
      position: getComputedStyle(document.querySelector(h)).position,
      viewH: holder.style.getPropertyValue('--wv-view-h'),
    };
  }, [pane, header]);

  const measure = (page, pane, header) => page.evaluate(([p, h]) => ({
    header: Math.round(document.querySelector(h).getBoundingClientRect().height),
    pane: document.querySelector(p).clientHeight,
  }), [pane, header]);

  const chromeDepth = (page, pane) => page.evaluate((p) => {
    const scroller = document.querySelector(p);
    scroller.scrollTo({ top: 4000, behavior: 'instant' });
    const r = scroller.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    for (let y = Math.ceil(r.top); y < r.top + 600; y += 1) {
      if (document.elementFromPoint(x, y)?.closest('.doc-section .vditor-reset')) return { reach: Math.round(y - r.top), scrolled: scroller.scrollTop };
    }
    return { reach: null, scrolled: scroller.scrollTop };
  }, pane);

  const openRow = async (page, url) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-section .vditor-ir [contenteditable="true"]');
    await page.waitForSelector('.doc-section .vditor-reset > p');
  };

  const unpins = async (pane, header, url) => {
    const page = await phonePage(await phoneBrowser());
    try {
      await openRow(page, url);
      if (pane === '#dock') await page.waitForSelector('#dock .dock-entity > .view-header');
      const m = await measure(page, pane, header);
      const held = await readHeader(page, pane, header);
      assert.deepEqual({ loose: held.loose, position: held.position }, PINNED,
        `with no keyboard a ${m.header}px header on a ${m.pane}px pane still holds, as Issue #411 asked`);
      assert.equal(held.viewH, `${m.header}px`, 'and the reading tracks it');
      const before = await chromeDepth(page, pane);
      assert.ok(before.scrolled > 200, `the document really scrolled: ${before.scrolled}`);

      const inset = await openKeyboard(page, await page.evaluate(() => innerHeight - 412));
      assert.ok(inset > 350, `the fake keyboard hides ${inset}px of the layout viewport`);
      const loose = await eventually(() => readHeader(page, pane, header), LOOSE);
      assert.deepEqual(loose, LOOSE,
        `with ${m.pane - inset}px of writing area left, the ${m.header}px header lets go`);

      const after = await chromeDepth(page, pane);
      assert.ok(after.reach <= 72, `the first readable line sits ${after.reach}px below the top of the pane, was ${before.reach}px`);
      assert.ok(after.reach < before.reach - 60, `that is a real drop: ${before.reach}px to ${after.reach}px`);
    } finally { await page.close(); }
  };

  test('on a phone the keyboard un-pins the row header opened by permalink (Issue #708)', () =>
    unpins('#main', '#main > .view-header', `${base}/#/entity/${row.id}`));

  test('on a phone the keyboard un-pins the row header opened from a table (Issue #708)', () =>
    unpins('#dock', '#dock .dock-entity > .view-header', `${base}/#/table/${notes.id}?e=${row.id}`));

  test('a desktop keeps its sticky row header, keyboard or not (Issue #411)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await openRow(page, `${base}/#/entity/${row.id}`);
      const before = await readHeader(page, '#main', '#main > .view-header');
      assert.deepEqual({ loose: before.loose, position: before.position }, PINNED, 'no phone branch on a desktop');
      assert.ok(parseFloat(before.viewH) > 0, `the reading is real: ${before.viewH}`);

      await openKeyboard(page, 400);
      const after = await eventually(() => readHeader(page, '#main', '#main > .view-header'), before);
      assert.deepEqual(after, before, 'a shrunken visual viewport on a desktop leaves the header alone');
    } finally { await page.close(); }
  });
}
