import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, JOURNEYS, cellsOf, seed, walk } from './lib/journeys.mjs';
import { clickKey } from './lib/clicks.mjs';
import { RUNS, busyFaults, feedbackOf, feedbackProbe, judgeMs, median, skeletonDelay } from './lib/feedback.mjs';

const { ms: budget } = JSON.parse(readFileSync(new URL('./feedback-budget.json', import.meta.url), 'utf8'));
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
        const faults = [];
        let acts = [];
        for (let i = 0; i < RUNS; i++) {
          const { events } = await run(undefined);
          times.push(feedbackOf(events.acts));
          acts = events.acts;
          faults.push(...busyFaults(events.spans, skeletonMs));
        }
        const ms = median(times);
        t.diagnostic(`feedback ${key} ${Math.round(ms)} ms runs ${times.map(Math.round).join(',')} budget ${budget[key] ?? 'none'} acts ${acts.map((a) => `${a.kind}:${a.ms == null ? '-' : Math.round(a.ms)}`).join(' ')}`);
        assert.deepEqual(faults, []);
        assert.equal(judgeMs(key, ms, budget), null, judgeMs(key, ms, budget) ?? '');
      });

      test(`${key}: an action that settles inside the skeleton delay shows no spinner and no aria-busy (Issue #1003)`, async () => {
        const { events } = await run(0);
        assert.deepEqual(busyFaults(events.spans, skeletonMs), []);
      });
    }
  }
}
