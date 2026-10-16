import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, JOURNEYS, cellsOf, seed, walk } from './lib/journeys.mjs';
import { clickKey, judge } from './lib/clicks.mjs';

const { clicks: budget } = JSON.parse(readFileSync(new URL('./click-budget.json', import.meta.url), 'utf8'));

const s = await launch('click budget', seed);

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const matrix = {
    desktop: { browser: s.browser, options: CELLS.desktop },
    phone: { browser: handset ?? s.browser, options: { engine: handset ? CELLS.phone.engine : CELLS.desktop.engine, ...phoneProfile().page } },
  };

  for (const j of JOURNEYS) {
    for (const cell of cellsOf(j)) {
      const key = clickKey(j.name, cell);
      test(`${key}: the journey finishes within its click budget (Feature #338)`, async (t) => {
        const { clicks } = await walk(matrix[cell].browser, j, s, matrix[cell].options);
        t.diagnostic(`clicks ${key} ${clicks} budget ${budget[key] ?? 'none'}`);
        assert.equal(judge(key, clicks, budget), null, judge(key, clicks, budget) ?? '');
      });
    }
  }

  const fixture = async (page) => {
    await page.route('**/click-probe', (r) => r.fulfill({ contentType: 'text/html', body: '<meta name=viewport content="width=device-width"><button id=a style="width:120px;height:60px">a</button><input id=i>' }));
    await page.goto(`${s.base}/click-probe`);
  };

  test('a click counts once and a double click twice; keys, scripted clicks and setup clicks count nothing', async () => {
    const probe = {
      name: 'probe',
      async setup(page) {
        await fixture(page);
        await page.click('#a');
      },
      async run(page) {
        await page.click('#a');
        await page.focus('#i');
        await page.keyboard.type('xy');
        await page.keyboard.press('Enter');
        await page.evaluate(() => document.querySelector('#a').click());
        await page.dblclick('#a');
      },
    };
    const { clicks } = await walk(s.browser, probe, s, CELLS.desktop);
    assert.equal(clicks, 3);
  });

  test('a tap on the phone counts once', async () => {
    const tap = { name: 'tap', setup: fixture, async run(page) { await page.tap('#a'); } };
    const { clicks } = await walk(matrix.phone.browser, tap, s, matrix.phone.options);
    assert.equal(clicks, 1);
  });
}
