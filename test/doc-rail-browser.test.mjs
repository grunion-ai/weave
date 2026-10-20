import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, atRest } from './lib/browser.mjs';

const DOC = '# One\n\ntext\n\n## Two\n\n' + 'filler\n\n'.repeat(40)
  + '## Three\n\n' + 'more\n\n'.repeat(40) + '### Four\n\nend\n';

let table, target;
const s = await launch('outline rail placement', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  table = weave.createTable({ space: 'Scratch', name: 'Note' });
  target = weave.createEntity(table, { name: 'Outlined' });
  weave.setDoc(target.id, DOC, 'Description');
});

if (s) {
  const { base, browser } = s;
  const open = async () => {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${base}/#/entity/${target.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
    return page;
  };
  const card = (page) => page.evaluate(() => {
    const c = document.querySelector('.doc-rail-card');
    const r = c.getBoundingClientRect();
    return {
      shown: getComputedStyle(c).display !== 'none' && r.height > 0,
      title: c.querySelector('.doc-rail-card-title').textContent,
      text: c.querySelector('.doc-rail-card-text').textContent,
      top: r.top, left: r.left,
    };
  });
  const ticks = (page) => page.$$eval('.doc-rail-tick', (ns) => ns.map((n) => Math.round(n.getBoundingClientRect().width)));
  const dash = (page, i) => page.locator('.doc-rail-dash').nth(i);

  test('the resting rail is a column of equal dashes with no card', async () => {
    const page = await open();
    try {
      const w = await ticks(page);
      assert.equal(new Set(w).size, 1, `every resting dash is one length (${w})`);
      assert.equal((await card(page)).shown, false, 'no card until a dash is hovered');
      const titled = await page.$$eval('.doc-rail [title]', (ns) => ns.length);
      assert.equal(titled, 0, 'no native tooltip anywhere on the rail');
    } finally { await page.close(); }
  });

  test('scrolled into the document, the rail sits in the vertical middle of the page', async () => {
    const page = await open();
    try {
      await page.evaluate(() => document.querySelector('#main').scrollTo({ top: 600, behavior: 'instant' }));
      await page.waitForFunction(() => document.querySelector('#main').scrollTop >= 595, null, { timeout: 20000 });
      await atRest(page.locator('.doc-rail-track'));
      const r = await page.evaluate(() => {
        const t = document.querySelector('.doc-rail-track').getBoundingClientRect();
        const m = document.querySelector('#main').getBoundingClientRect();
        return { rail: t.top + t.height / 2, box: m.top + m.height / 2, h: m.height };
      });
      assert.ok(Math.abs(r.rail - r.box) < 60, `rail centre ${Math.round(r.rail)} near box centre ${Math.round(r.box)}`);
    } finally { await page.close(); }
  });

  test('hovering a dash grows the rail and shows that section in a card beside it', async () => {
    const page = await open();
    try {
      await dash(page, 1).hover();
      await page.waitForFunction(() => document.querySelector('.doc-rail.peek'), null, { timeout: 5000 });
      await atRest(page.locator('.doc-rail-tick').first());
      const w = await ticks(page);
      assert.ok(w[0] > w[1] && w[1] > w[3], `hovered dashes take their depth length (${w})`);
      const c = await card(page);
      assert.equal(c.shown, true);
      assert.equal(c.title, 'Two');
      assert.match(c.text, /^filler filler/, 'the card previews the section text');
      const d = await dash(page, 1).boundingBox();
      assert.ok(c.left >= d.x + d.width, 'the card sits to the right of the rail');
      assert.ok(Math.abs(c.top - d.y) < 24, `the card is level with its dash (dash ${d.y}, card ${c.top})`);
      await dash(page, 2).hover();
      await page.waitForFunction(() => document.querySelector('.doc-rail-card-title').textContent === 'Three', null, { timeout: 5000 });
      assert.match((await card(page)).text, /^more more/, 'moving along the rail swaps the card');
    } finally { await page.close(); }
  });

  test('leaving the rail hides the card and the dashes rest again', async () => {
    const page = await open();
    try {
      await dash(page, 1).hover();
      await page.waitForFunction(() => document.querySelector('.doc-rail.peek'), null, { timeout: 5000 });
      await page.mouse.move(900, 400);
      await page.waitForFunction(() => !document.querySelector('.doc-rail.peek'), null, { timeout: 5000 });
      assert.equal((await card(page)).shown, false);
      await atRest(page.locator('.doc-rail-tick').first());
      assert.equal(new Set(await ticks(page)).size, 1);
    } finally { await page.close(); }
  });

  test('a keyboard user gets the same card on focus, and Escape puts it away', async () => {
    const page = await open();
    try {
      await dash(page, 2).focus();
      await page.waitForFunction(() => document.querySelector('.doc-rail-card-title')?.textContent === 'Three', null, { timeout: 5000 });
      assert.equal((await card(page)).shown, true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.doc-rail.peek'), null, { timeout: 5000 });
    } finally { await page.close(); }
  });

  test('clicking a dash jumps to its heading and opens no panel', async () => {
    const page = await open();
    try {
      await dash(page, 2).click();
      await page.waitForFunction(() => {
        const h = [...document.querySelectorAll('.vditor-ir .vditor-reset h2')].find((x) => x.textContent.includes('Three'));
        const t = h.getBoundingClientRect().top;
        return t > -10 && t < 200;
      }, null, { timeout: 20000 });
      const w = await page.evaluate(() => document.querySelector('.doc-rail-track').getBoundingClientRect().width);
      assert.ok(w < 60, `the rail stays a rail, never a panel (${w}px)`);
    } finally { await page.close(); }
  });

  test('a burst of resize events reschedules the rails once per frame', async () => {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${base}/#/entity/${target.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-rail .doc-rail-dash', { timeout: 20000 });
    const calls = await page.evaluate(async () => {
      const real = window.setTimeout;
      let n = 0;
      window.setTimeout = (fn, ms, ...rest) => { if (ms === 250 && /refreshDashRail/.test(String(fn))) n++; return real(fn, ms, ...rest); };
      try {
        for (let i = 0; i < 30; i++) window.dispatchEvent(new Event('resize'));
        const sync = n;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { sync, framed: n, rails: document.querySelectorAll('.doc-rail').length };
      } finally { window.setTimeout = real; }
    });
    assert.ok(calls.rails >= 1, 'the page has a rail to reschedule');
    assert.equal(calls.sync, 0, `no rail work inside the burst (saw ${calls.sync})`);
    assert.ok(calls.framed >= 1 && calls.framed <= calls.rails, `one reschedule per rail after the frame (saw ${calls.framed} for ${calls.rails})`);
    await page.close();
  });
}
