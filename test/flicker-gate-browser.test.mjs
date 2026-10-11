import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, JOURNEYS, cellsOf, seed, walk } from './lib/journeys.mjs';
import { installProbe, readProbe, resetProbe, regressed, fingerprint, GATED } from './lib/flicker.mjs';

const fixed = JSON.parse(readFileSync(new URL('./flicker-fixed.json', import.meta.url), 'utf8'));
const probe = { install: installProbe, read: readProbe, reset: resetProbe };

const s = await launch('flicker ratchet', seed);

if (s) {
  const { base, browser } = s;
  const ctx = { ...s, base };
  const phone = phoneProfile();
  const handset = await engineOf(CELLS.phone.engine);
  const matrix = {
    desktop: { browser, options: CELLS.desktop },
    phone: { browser: handset ?? browser, options: { engine: handset ? CELLS.phone.engine : CELLS.desktop.engine, ...phone.page } },
  };

  test('the phone cell walks the iPhone profile in WebKit (Issue #732)', (t) => {
    if (!handset) return t.skip('webkit cannot launch here; the phone cell falls back to chromium');
    assert.equal(matrix.phone.browser.browserType().name(), 'webkit');
    assert.equal(CELLS.phone.device, 'iPhone 15');
    assert.ok(matrix.phone.options.hasTouch && matrix.phone.options.isMobile);
  });

  for (const j of JOURNEYS) {
    for (const cell of cellsOf(j)) {
      test(`${j.name} (${cell}): the journey finishes and no fixed flicker is back`, async (t) => {
        const { events } = await walk(matrix[cell].browser, j, ctx, { probe, ...matrix[cell].options });
        const seen = events.map((e) => ({ ...e, cell }));
        const gated = seen.filter((e) => GATED.includes(e.kind));
        if (gated.length) t.diagnostic(`seen: ${[...new Set(gated.map((e) => fingerprint(j.name, e)))].join(' ; ')}`);
        assert.deepEqual(regressed({ [j.name]: seen }, fixed), [], 'a fixed flicker came back');
      });
    }
  }
}
