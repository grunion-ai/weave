/* The flicker ratchet (harness routine weave-flicker).

   Every journey in test/lib/journeys.mjs is walked once with the probe on.
   Two things fail the gate: a journey that cannot finish (its selectors
   rotted, so the nightly sweep would have gone quiet), and a flicker in
   test/flicker-fixed.json that came back. A flicker nobody has fixed yet is
   the sweep's to file, never the gate's to refuse: the gate shares a machine
   at load average 80, and only the kinds that load cannot invent (GATED)
   are read at all. What each journey saw is printed as a diagnostic, so a
   gate log doubles as a cheap sweep.

   Playwright is NOT a dependency of weave; the harness skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { JOURNEYS, seed, walk } from './lib/journeys.mjs';
import { installProbe, readProbe, resetProbe, regressed, fingerprint, GATED } from './lib/flicker.mjs';

const fixed = JSON.parse(readFileSync(new URL('./flicker-fixed.json', import.meta.url), 'utf8'));
const probe = { install: installProbe, read: readProbe, reset: resetProbe };

const s = await launch('flicker ratchet', seed);

if (s) {
  const { base, browser } = s;
  const ctx = { ...s, base };

  for (const j of JOURNEYS) {
    test(`${j.name}: the journey finishes and no fixed flicker is back`, async (t) => {
      const { events } = await walk(browser, j, ctx, { probe });
      const gated = events.filter((e) => GATED.includes(e.kind));
      if (gated.length) t.diagnostic(`seen: ${[...new Set(gated.map((e) => fingerprint(j.name, e)))].join(' ; ')}`);
      assert.deepEqual(regressed({ [j.name]: events }, fixed), [], 'a fixed flicker came back');
    });
  }
}
