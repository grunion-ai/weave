import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { cellsOf } from './lib/journeys.mjs';
import { CELLS, GATE_CELLS, PLATFORM, SWEEP_JOURNEYS, fingerprint, held, restsFor, sectionOf, seed, sweep, tally, verdict, walked } from './lib/collision.mjs';

const holds = sectionOf(JSON.parse(readFileSync(new URL('./collision-held.json', import.meta.url), 'utf8')));

const s = await launch('collision gate', seed);

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const matrix = {
    desktop: { browser: s.browser, page: { viewport: CELLS.desktop.viewport } },
    phone: handset && { browser: handset, page: { ...phoneProfile().page, viewport: CELLS.phone.viewport } },
  };

  for (const cell of GATE_CELLS) {
    const floor = SWEEP_JOURNEYS.filter((j) => cellsOf(j).includes(cell)).length + restsFor(walked('collision'), cell).length;

    test(`${cell}: nothing overlaps, no control is pushed off the screen and the page is no wider than the viewport`, async (t) => {
      const m = matrix[cell];
      if (!m) return t.skip(`${CELLS[cell].engine} cannot launch here, and the ${cell} holds are measured in it`);
      const { findings, failed, timings } = await sweep(m.browser, cell, s, { page: m.page });
      assert.deepEqual(failed, [], 'a journey or overlay could not finish: its selectors rotted');
      assert.ok(timings.length >= floor, `the probe ran on ${timings.length} states and the catalog plans at least ${floor}: a gate that cannot run reports zero findings, which is not a pass (Issue #1675)`);
      const seen = tally(findings);
      const { unheld, gone } = verdict(seen, holds, { cells: [cell] });
      for (const u of unheld) {
        const e = findings.find((x) => fingerprint(x, x.cell) === u.fp);
        t.diagnostic(`new: ${u.fp} at ${e.where}: ${JSON.stringify(e.text)} by ${e.px}px`);
      }
      for (const g of gone) t.diagnostic(`gone: ${g.fp} held for Issue #${g.hold.join(', #')} no longer reproduces: drop its hold from test/collision-held.json`);
      if (unheld.length || gone.length) t.diagnostic(`${PLATFORM} ${cell} measured: ${JSON.stringify(seen)}`);
      assert.deepEqual(unheld, [], `new collision on ${PLATFORM} ${cell}: fix it; test/collision-held.json takes an entry only for a finding an Issue row already tracks`);
      assert.deepEqual(gone, [], `a hold on ${PLATFORM} ${cell} no longer reproduces: drop it in the change that fixed it`);
    });

    const mine = held('collision').filter((p) => p.cell === cell);
    if (!mine.length) continue;
    test(`${cell}: every state held out of the gate still shows the collision its Issue rows track`, async (t) => {
      const m = matrix[cell];
      if (!m) return t.skip(`${CELLS[cell].engine} cannot launch here`);
      const { findings, failed } = await sweep(m.browser, cell, s, { page: m.page, journeys: [], overlays: [], rests: mine.map((p) => p.state) });
      assert.deepEqual(failed, [], 'a held state could not open: its selectors rotted');
      for (const p of mine) {
        const here = findings.filter((f) => f.where === `${p.state.open}:${p.state.name}`);
        t.diagnostic(`held: ${p.state.name} ${cell} for Issue #${p.hold.join(', #')} measured ${here.length}: ${JSON.stringify(tally(here))}`);
        assert.ok(here.length, `${p.state.name} shows no collision on ${cell}: once Issue #${p.hold.join(', #')} is fixed, drop its hold in test/lib/states.mjs so the gate walks it`);
      }
    });
  }
}
