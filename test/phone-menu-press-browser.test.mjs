import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';
import { API_DELAY_MS } from './lib/feedback.mjs';

const PRESS_BUDGET_MS = 100;

const s = await launch('phone menu press', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.createTable({ space: 'Development', name: 'Feature' });
  weave.createEntity(issues, { name: 'First issue' });
  weave.createSpace({ name: 'Handbook' });
  weave.createTable({ space: 'Handbook', name: 'Guide' });
  return { hash: `#/table/${issues.id}` };
});

const watch = () => {
  const marks = (window.__press = { down: null, up: null, click: null, peek: null, frames: [] });
  const at = () => performance.now();
  const app = () => document.querySelector('#app');
  addEventListener('pointerdown', (e) => { if (e.isTrusted && marks.down == null) marks.down = at(); }, true);
  addEventListener('pointerup', (e) => { if (e.isTrusted && marks.up == null) marks.up = at(); }, true);
  addEventListener('click', (e) => { if (e.isTrusted && marks.click == null) marks.click = at(); }, true);
  const frame = (left) => requestAnimationFrame(() => {
    marks.frames.push({ t: at(), held: app().classList.contains('nav-held') });
    if (left > 1) frame(left - 1);
  });
  const seen = () => {
    if (marks.peek != null || !app()?.classList.contains('nav-peek')) return;
    marks.peek = at();
    frame(4);
  };
  new MutationObserver(seen).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
};

if (s) {
  const { base, hash } = s;

  const press = async () => {
    const page = await phonePage(await phoneBrowser());
    try {
      await page.addInitScript(watch);
      await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .nav-menu');
      await page.waitForFunction(() => !!document.querySelector('#app'));
      await page.route(/\/api\//, async (r) => {
        await new Promise((res) => setTimeout(res, API_DELAY_MS));
        await r.continue().catch(() => {});
      });
      await page.tap('#main .nav-menu');
      await page.waitForFunction(() => document.querySelector('#app').classList.contains('nav-peek'));
      await page.waitForFunction(() => window.__press.frames.length >= 4);
      await page.unroute(/\/api\//);
      const marks = await page.evaluate(() => ({ ...window.__press, held: document.querySelector('#app').classList.contains('nav-held') }));
      return marks;
    } finally {
      await page.close();
    }
  };

  const shape = (m) => {
    const span = (a, b) => (m[a] == null || m[b] == null ? null : Math.round(m[b] - m[a]));
    return `press to up ${span('down', 'up')} ms, press to click ${span('down', 'click')} ms, press to peek ${span('down', 'peek')} ms, frames after the class ${m.frames.map((f) => `${Math.round(f.t - m.peek)}${f.held ? ' held' : ''}`).join(', ')} ms, API held ${API_DELAY_MS} ms`;
  };

  test(`the phone menu opens within ${PRESS_BUDGET_MS} ms of the press (Issue #1061)`, async (t) => {
    const m = await press();
    t.diagnostic(shape(m));
    assert.notEqual(m.down, null, 'the tap is a trusted press');
    assert.notEqual(m.peek, null, 'the press opens the menu');
    const ms = Math.round(m.peek - m.down);
    assert.ok(ms <= PRESS_BUDGET_MS, `the menu opened ${ms} ms after the press, budget ${PRESS_BUDGET_MS} ms`);
  });

  test('the menu paints its first frame before the focus hold reads the panel back (Issue #1061)', async (t) => {
    const m = await press();
    t.diagnostic(shape(m));
    assert.equal(m.frames.length >= 2, true, 'the open menu renders at least two frames');
    assert.equal(m.frames[0].held, false, 'the first frame after the class lands paints the panel and leaves the focus hold for later');
    assert.equal(m.held, true, 'the focus hold still runs, so the menu keeps focus and the Escape and Tab keys');
  });
}
