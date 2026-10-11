import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, PLATFORM, fingerprint, ratchet, sectionOf, seed, sweepCell, tally } from './lib/cutoff.mjs';

const baseline = sectionOf(JSON.parse(readFileSync(new URL('./cutoff-baseline.json', import.meta.url), 'utf8')));

const s = await launch('cutoff ratchet', seed);

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const matrix = {
    desktop: { browser: s.browser, page: { viewport: CELLS.desktop.viewport } },
    phone: handset && { browser: handset, page: { ...phoneProfile().page, viewport: CELLS.phone.viewport } },
  };

  for (const cell of Object.keys(CELLS)) {
    test(`${cell}: every surface opens, no new cut-off text appears, and every fixed one has left the baseline`, async (t) => {
      const m = matrix[cell];
      if (!m) return t.skip(`${CELLS[cell].engine} cannot launch here, and the ${cell} baseline is measured in it`);
      const { findings, failed } = await sweepCell(m.browser, cell, s, { page: m.page });
      assert.deepEqual(failed, [], 'a journey or overlay could not finish: its selectors rotted');
      const seen = tally(findings);
      const { added, dropped } = ratchet(seen, baseline, { cells: [cell] });
      for (const a of added) {
        const e = findings.find((x) => fingerprint(x, x.cell) === a.fp);
        t.diagnostic(`new: ${a.fp} at ${e.where}: ${JSON.stringify(e.text)} cut by ${e.px}px`);
      }
      if (added.length || dropped.length) t.diagnostic(`${PLATFORM} ${cell} measured: ${JSON.stringify(seen)}`);
      assert.deepEqual(added, [], `new cut-off text on ${PLATFORM}: fix it; test/cutoff-baseline.json never gains a row or a count`);
      assert.deepEqual(dropped, [], `cut-offs were fixed on ${PLATFORM}: lower test/cutoff-baseline.json in this change (node scripts/cutoff-sweep.mjs --lower)`);
    });
  }
}
