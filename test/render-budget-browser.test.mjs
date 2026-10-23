import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, JOURNEYS, cellsOf, seed, walk } from './lib/journeys.mjs';
import { clickKey } from './lib/clicks.mjs';
import { median } from './lib/feedback.mjs';
import { installProbe, readRenders, resetProbe } from './lib/flicker.mjs';
import { RUNS, judgeRenders } from './lib/renders.mjs';

const { renders: budget } = JSON.parse(readFileSync(new URL('./render-budget.json', import.meta.url), 'utf8'));
const probe = { install: installProbe, reset: resetProbe, read: readRenders };

const s = await launch('render budget', seed);

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const matrix = {
    desktop: { browser: s.browser, options: CELLS.desktop },
    phone: { browser: handset ?? s.browser, options: { engine: handset ? CELLS.phone.engine : CELLS.desktop.engine, ...phoneProfile().page } },
  };

  for (const j of JOURNEYS) {
    for (const cell of cellsOf(j)) {
      const key = clickKey(j.name, cell);
      test(`${key}: the journey renders in no more frames than its budget (Issue #1042)`, async (t) => {
        const counts = [];
        for (let i = 0; i < RUNS; i++) counts.push((await walk(matrix[cell].browser, j, s, { ...matrix[cell].options, probe })).events);
        const n = median(counts);
        t.diagnostic(`renders ${key} ${n} runs ${counts.join(',')} budget ${budget[key] ?? 'none'}`);
        assert.equal(judgeRenders(key, n, budget), null, judgeRenders(key, n, budget) ?? '');
      });
    }
  }
}
