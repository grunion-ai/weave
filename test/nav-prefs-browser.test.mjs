import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const KEY = 'weave-folded-spaces';

let sales, ops;
const s = await launch('nav preferences', (weave) => {
  weave.createSpace({ name: 'Sales', icon: 'lucide:briefcase' });
  weave.createSpace({ name: 'Ops', icon: 'lucide:settings' });
  sales = weave.createTable({ space: 'Sales', name: 'Deals' });
  ops = weave.createTable({ space: 'Ops', name: 'Runs' });
  weave.createEntity(sales, { name: 'Acme' });
  weave.createEntity(ops, { name: 'Nightly' });
});

if (s) {
  const { base, browser } = s;
  const spaces = (page) => page.$$eval('#nav .nav-space .nav-space-name, #nav .nav-space', (ns) => ns.map((n) => n.textContent.trim()).filter(Boolean));
  const open = async (init) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.stack ?? String(err)));
    if (init) await page.addInitScript(init);
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    return { page, errors };
  };

  test('a malformed saved sidebar preference leaves navigation rendered (Issue #1448)', async () => {
    const { page, errors } = await open(`localStorage.setItem(${JSON.stringify(KEY)}, '{broken');`);
    try {
      assert.ok((await spaces(page)).length >= 2, `the sidebar still lists its spaces: ${JSON.stringify(await spaces(page))}`);
      assert.deepEqual(errors, [], 'no unhandled error reaches the page');
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), null, 'the one bad key is reset, nothing else is cleared');
    } finally { await page.close(); }
  });

  test('a wrong-shaped sidebar preference leaves navigation rendered (Issue #1448)', async () => {
    for (const raw of ['null', '3', '"a"', '{"a":1}', '[1,"b"]']) {
      const { page, errors } = await open(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(raw)});`);
      try {
        assert.ok((await spaces(page)).length >= 2, `${raw} still lists its spaces`);
        assert.deepEqual(errors, [], `${raw} raises no page error`);
        assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY), null, `${raw} is reset, since a parse that throws nothing is still the wrong shape`);
      } finally { await page.close(); }
    }
  });

  test('denied browser storage leaves navigation and a usable theme (Issue #1448)', async () => {
    const { page, errors } = await open(`Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });`);
    try {
      assert.ok((await spaces(page)).length >= 2, `the sidebar renders without storage: ${JSON.stringify(await spaces(page))}`);
      assert.match(await page.evaluate(() => document.documentElement.dataset.bsTheme ?? ''), /^(light|dark)$/, 'the theme falls back to a drawn default');
      assert.deepEqual(errors, [], 'no unhandled error reaches the page');
    } finally { await page.close(); }
  });
}
