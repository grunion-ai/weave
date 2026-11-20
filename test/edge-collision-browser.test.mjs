import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { DESKTOP_WIDTHS, PHONE_WIDTH, PLATFORM, SCREENS, keyOf, probe, ratchet, sectionOf, seed, sweepScreen } from './lib/edge-collision.mjs';

const baseline = sectionOf(JSON.parse(readFileSync(new URL('./edge-collision-baseline.json', import.meta.url), 'utf8')));

const s = await launch('edge collision', seed);

if (s) {
  const handset = await engineOf(phoneProfile().engine);
  const fixture = async (html, viewport = { width: 800, height: 600 }) => {
    const page = await s.browser.newPage({ viewport });
    try {
      await page.setContent(`<!doctype html><body style="margin: 0; font: 14px/20px sans-serif">${html}</body>`);
      return await page.evaluate(probe);
    } finally { await page.close(); }
  };
  const BTN = 'position: absolute; width: 140px; height: 28px; padding: 0; border: 1px solid #888;';
  const cases = [
    ['a fixed button over the end of another is an overlap, and the probe says which is on top',
      `<button style="${BTN} left: 500px; top: 552px">Clear all</button><button aria-label="Report a problem" style="position: fixed; right: 158px; bottom: 16px; width: 26px; height: 26px; z-index: 5">!</button>`,
      [{ kind: 'overlap', names: ['Clear all', 'Report a problem'], on: 'Report a problem' }]],
    ['a link under a positioned button with tabindex is an overlap',
      `<a href="#x" style="position: absolute; left: 20px; top: 20px; width: 120px; height: 24px; display: block">Open the record</a><div role="button" tabindex="0" style="position: absolute; left: 100px; top: 24px; width: 60px; height: 24px; background: #eee">Menu</div>`,
      [{ kind: 'overlap', names: ['Menu', 'Open the record'], on: 'Menu' }]],
    ['a control inside another is nesting, never a collision',
      `<div role="button" tabindex="0" style="${BTN} left: 20px; top: 20px; width: 300px; height: 40px">Row <button style="margin-left: 40px">Edit</button></div>`,
      []],
    ['two controls that meet by 2 px are a seam, not a collision',
      `<button style="${BTN} left: 20px; top: 20px">One</button><button style="${BTN} left: 158px; top: 20px">Two</button>`,
      []],
    ['a control cut by an overflow hidden box is clipped',
      `<div style="position: absolute; left: 20px; top: 20px; width: 100px; height: 40px; overflow: hidden"><button style="${BTN} position: static">Cut short</button></div>`,
      [{ kind: 'clipped', names: ['Cut short'] }]],
    ['a control its scroll container reaches by scrolling is not clipped',
      `<div style="position: absolute; left: 20px; top: 20px; width: 100px; height: 40px; overflow-x: auto"><button style="${BTN} position: static">Scroll to me</button></div>`,
      []],
    ['a control a scroll box inside a sealed box reaches by scrolling is not clipped',
      `<div style="position: absolute; left: 20px; top: 20px; width: 200px; height: 80px; overflow: hidden"><div style="height: 60px; overflow-y: auto">${Array.from({ length: 4 }, (_, i) => `<button style="display: block; width: 180px; height: 28px">Row ${i}</button>`).join('')}</div></div>`,
      []],
    ['a control past the right edge of the viewport is off the screen',
      `<button style="${BTN} left: 720px; top: 20px">Out of reach</button>`,
      [{ kind: 'off-screen', names: ['Out of reach'] }]],
    ['a page held by a dialog is inert, so the dialog covering it is no collision',
      `<main inert><button style="${BTN} left: 20px; top: 20px">Under the dialog</button></main><div role="dialog" aria-modal="true" style="position: fixed; inset: 0"><button style="${BTN} left: 30px; top: 24px">In the dialog</button></div>`,
      []],
    ['a popover over the row it opened from is no collision',
      `<button style="${BTN} left: 20px; top: 20px">Status</button><div role="menu" style="position: absolute; left: 40px; top: 30px; background: #fff"><button role="menuitem" style="display: block; width: 140px">Done</button></div>`,
      []],
    ['a row that scrolls under a sticky footer in its own scroll box is no collision',
      `<div style="position: absolute; left: 20px; top: 20px; width: 200px; height: 100px; overflow-y: auto">${Array.from({ length: 8 }, (_, i) => `<button style="display: block; width: 180px; height: 28px">Row ${i}</button>`).join('')}<button style="position: sticky; bottom: 0; display: block; width: 180px; height: 28px; background: #fff">New record</button></div>`,
      []],
    ['a fixed control over a list that scrolls out from under it is no collision',
      `<div style="position: absolute; left: 20px; top: 20px; width: 200px; height: 100px; overflow-y: auto">${Array.from({ length: 8 }, (_, i) => `<button style="display: block; width: 180px; height: 28px">Row ${i}</button>`).join('')}</div><button style="position: fixed; left: 150px; top: 90px; width: 26px; height: 26px">!</button>`,
      []],
    ['a fixed sheet over the page is an overlay, so it covering the page is no collision',
      `<button style="${BTN} left: 20px; top: 20px">Tools</button><aside style="position: fixed; inset: 8px; background: #fff"><button style="${BTN} left: 30px; top: 24px">Close share panel</button></aside>`,
      []],
    ['a floating control over a control in a fixed sheet is still an overlap',
      `<aside style="position: fixed; inset: 8px; background: #fff"><button style="${BTN} right: 10px; bottom: 10px">Clear all</button></aside><button aria-label="Report a problem" style="position: fixed; right: 12px; bottom: 12px; width: 26px; height: 26px; z-index: 5">!</button>`,
      [{ kind: 'overlap', names: ['Clear all', 'Report a problem'], on: 'Report a problem' }]],
    ['a hidden, transparent or click-through control is never measured',
      `<button style="${BTN} left: 20px; top: 20px">Seen</button><button style="${BTN} left: 40px; top: 24px; visibility: hidden">Hidden</button><button style="${BTN} left: 40px; top: 24px; opacity: 0">Clear</button><button style="${BTN} left: 40px; top: 24px; pointer-events: none">Through</button>`,
      []],
  ];
  for (const [name, html, want] of cases) {
    test(`the probe: ${name}`, async () => {
      const got = (await fixture(html)).map((f) => ({ kind: f.kind, names: [f.a, f.b].filter(Boolean).sort(), ...(f.kind === 'overlap' ? { on: f.on } : {}) }));
      assert.deepEqual(got, want.map((w) => ({ ...w, names: [...w.names].sort() })));
    });
  }

  const cells = [
    ...DESKTOP_WIDTHS.map((width) => ({ width, browser: s.browser, page: { viewport: { width, height: 900 } } })),
    { width: PHONE_WIDTH, browser: handset, phone: true, page: { ...phoneProfile().page, viewport: { width: PHONE_WIDTH, height: 844 } } },
  ];

  for (const screen of SCREENS) {
    test(`${screen.name}: no control covers another, is cut by its box or is pushed off the screen at ${cells.map((c) => c.width).join(', ')} px (Feature #388)`, async (t) => {
      const { findings, failed, measured } = await sweepScreen(screen, s, cells);
      assert.deepEqual(failed, [], `${screen.name} could not open at every width: its selectors rotted`);
      assert.equal(measured, cells.length, `${screen.name} was measured at every width: a sweep that cannot run reports nothing, which is not a pass`);
      const { fresh, gone } = ratchet(findings, baseline.filter((e) => e.screen === screen.name));
      for (const f of fresh) t.diagnostic(`new: ${keyOf(f)} ${JSON.stringify({ on: f.on, px: f.px, a: f.boxA, b: f.boxB, sa: f.sa, sb: f.sb })}`);
      for (const g of gone) t.diagnostic(`gone: ${keyOf(g)} held for Issue #${g.issue} no longer reproduces: drop it from test/edge-collision-baseline.json`);
      assert.deepEqual(fresh.map(keyOf), [], `new collision on ${PLATFORM}: fix it, or file an Issue and add an entry naming it to test/edge-collision-baseline.json`);
      assert.deepEqual(gone.map(keyOf), [], `a baseline entry on ${PLATFORM} no longer reproduces: drop it in the change that fixed it`);
    });
  }
}
