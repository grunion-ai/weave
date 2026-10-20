import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, JOURNEYS, cellsOf, seed, walk } from './lib/journeys.mjs';
import { clickKey } from './lib/clicks.mjs';
import { RUNS, busyFaults, feedbackOf, feedbackProbe, judgeMs, median, skeletonDelay } from './lib/feedback.mjs';

const { ms: budget, busy: allowed } = JSON.parse(readFileSync(new URL('./feedback-budget.json', import.meta.url), 'utf8'));
const skeletonMs = skeletonDelay();

const s = await launch('feedback budget', seed);

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const matrix = {
    desktop: { browser: s.browser, options: CELLS.desktop },
    phone: { browser: handset ?? s.browser, options: { engine: handset ? CELLS.phone.engine : CELLS.desktop.engine, ...phoneProfile().page } },
  };

  for (const j of JOURNEYS) {
    for (const cell of cellsOf(j)) {
      const key = clickKey(j.name, cell);
      const run = (delay) => walk(matrix[cell].browser, j, s, { ...matrix[cell].options, probe: feedbackProbe({ delay }) });

      test(`${key}: the action paints its answer before a slow server does, within its feedback budget (Issue #1003)`, async (t) => {
        const times = [];
        let acts = [];
        for (let i = 0; i < RUNS; i++) {
          ({ events: { acts } } = await run(undefined));
          times.push(feedbackOf(acts));
        }
        const ms = median(times);
        const shown = (n) => (n == null ? '-' : Math.round(n));
        t.diagnostic(`feedback ${key} ${shown(ms)} ms runs ${times.map(shown).join(',')} budget ${budget[key] ?? 'none'} acts ${acts.map((a) => `${a.kind}:${shown(a.ms)}`).join(' ')}`);
        assert.equal(judgeMs(key, ms, budget), null, judgeMs(key, ms, budget) ?? '');
      });

      test(`${key}: an action that settles inside the skeleton delay shows no spinner and no aria-busy (Issue #1003)`, async (t) => {
        const { events } = await run(0);
        const faults = busyFaults(events.spans, skeletonMs);
        if (allowed[key]) return t.diagnostic(`busy ${key} held open by ${allowed[key]}: ${faults.join('; ') || 'none this run'}`);
        assert.deepEqual(faults, []);
      });
    }
  }
}
