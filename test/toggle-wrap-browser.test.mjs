import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, probe, seed, settle } from './lib/cutoff.mjs';
import { ROUTES } from './lib/states.mjs';

const ON = 'Published to every customer';
const OFF = 'Held back for review';

const s = await launch('toggle word wrap', seed);

if (s) {
  const cutWords = (page, root) => page.evaluate(probe, root).then((all) => all.filter((f) => String(f.selector).includes('wv-toggle-word')));
  const whole = (locator) => locator.evaluate((w) => ({ text: w.textContent, over: w.scrollWidth - w.clientWidth, lines: Math.round(w.getBoundingClientRect().height / parseFloat(getComputedStyle(w).lineHeight)) }));

  for (const colorScheme of ['light', 'dark']) {
    test(`${colorScheme}: a board tile prints both toggle labels whole beside the switch (Issue #1156)`, async () => {
      const page = await s.browser.newPage({ viewport: CELLS.desktop.viewport, colorScheme });
      try {
        await page.goto(ROUTES['sink-board'].url(s, 'desktop'), { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-board .tile .tile-field .wv-toggle-word');
        await settle(page);
        const words = page.locator('.wv-board .tile .tile-field .wv-toggle-word');
        const seen = await Promise.all((await words.all()).map(whole));
        const texts = seen.map((w) => w.text);
        assert.ok(texts.includes(ON) && texts.includes(OFF), `tiles wear both labels: ${texts.join(', ')}`);
        for (const w of seen) assert.ok(w.over <= 1, `"${w.text}" still hides ${w.over}px of itself`);
        assert.ok(seen.some((w) => w.lines > 1), 'the long label wraps instead of shrinking the switch');
        assert.deepEqual(await cutWords(page, '.wv-board'), []);
      } finally { await page.close(); }
    });
  }

  test('the phone record page prints the toggle label whole beside the switch (Issue #1156)', async (t) => {
    const handset = await engineOf(CELLS.phone.engine);
    if (!handset) return t.skip(`${CELLS.phone.engine} cannot launch here`);
    const page = await handset.newPage({ ...phoneProfile().page, viewport: CELLS.phone.viewport });
    try {
      await page.goto(ROUTES['sink-row'].url(s, 'phone'), { waitUntil: 'networkidle' });
      await page.waitForSelector(ROUTES['sink-row'].ready('phone'));
      await settle(page);
      const word = page.locator('#dock .fieldrow .wv-toggle-word');
      const seen = await whole(word);
      assert.equal(seen.text, ON);
      assert.ok(seen.over <= 1, `"${seen.text}" still hides ${seen.over}px of itself`);
      assert.deepEqual(await cutWords(page, '#dock'), []);
    } finally { await page.close(); }
  });
}
