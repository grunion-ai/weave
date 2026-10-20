import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, phoneProfile } from './lib/browser.mjs';
import { CELLS, seed } from './lib/journeys.mjs';
import { median } from './lib/feedback.mjs';
import { METRICS, RUNS, VITALS, installVitals, judgeVital, readVitals, vitalKey } from './lib/vitals.mjs';

const { vitals: budget } = JSON.parse(readFileSync(new URL('./vitals-budget.json', import.meta.url), 'utf8'));

const s = await launch('vitals budget', seed);

if (s) {
  const options = { desktop: CELLS.desktop, phone: phoneProfile().page };

  async function once(j, cell) {
    const page = await s.browser.newPage(options[cell]);
    try {
      await installVitals(page);
      await page.goto(`${s.base}${j.url(s)}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(j.ready);
      await j.interact(page, cell, s);
      return await readVitals(page);
    } finally {
      await page.close();
    }
  }

  for (const j of VITALS) {
    for (const cell of ['desktop', 'phone']) {
      test(`${j.name}|${cell}: LCP, CLS and INP stay inside their budgets (Issue #1003)`, async (t) => {
        await once(j, cell);
        const runs = [];
        for (let i = 0; i < RUNS; i++) runs.push(await once(j, cell));
        const faults = [];
        for (const m of METRICS) {
          const key = vitalKey(j.name, cell, m);
          const value = median(runs.map((r) => r[m]));
          t.diagnostic(`vitals ${key} ${m === 'cls' ? value.toFixed(3) : Math.round(value)} runs ${runs.map((r) => (m === 'cls' ? r[m].toFixed(3) : Math.round(r[m]))).join(',')} budget ${budget[key] ?? 'none'}`);
          const why = judgeVital(key, value, budget);
          if (why) faults.push(why);
        }
        assert.deepEqual(faults, []);
      });
    }
  }
}
