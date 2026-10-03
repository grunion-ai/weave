/* Contract tests for the page loader (brand decision 7).

   Like ui-contract.test.mjs these assert source-level contracts: the UI is
   dependency-free vanilla JS with no DOM runtime available, so the guarantees
   are pinned where they are written. Each test names the rule it protects.

   The loader has one cross-file invariant worth guarding above all: the cycle
   length is published by the generator and consumed by the app, and "let it
   finish a cycle" is only true while those two agree. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LOADER_CYCLE_MS, VARIANTS, PALETTE, ROPE, loaderDraw, loaderStill, loaderRopeHtml, loaderRopeCss,
  ropePose, ropeStops, strandPose, dashOffset,
} from '../brand/build-logos.mjs';
import { APP, HTML, CSS, px } from './lib/source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the app cycle constant tracks the one the generator publishes', () => {
  const declared = Number(APP.match(/const LOADER_CYCLE_MS = (\d+);/)[1]);
  assert.equal(declared, LOADER_CYCLE_MS,
    'app.js and brand/build-logos.mjs must agree, or the hide lands mid-weave');
});

test('a shown loader always finishes at least one whole cycle', () => {
  // Round the wait up to the end of the cycle it is in: a loader that just
  // appeared gets a full cycle, and a long wait rounds to the next boundary.
  assert.match(APP, /LOADER_CYCLE_MS - \(elapsed % LOADER_CYCLE_MS\)/);
  assert.match(APP, /const elapsed = Date\.now\(\) - loading\.shownAt/);
});

test('showing the loader restarts the rope so the cycle starts at the start', () => {
  // The rope's animations are CSS on elements inside the host, and [hidden] is
  // display:none, so un-hiding the host starts it again at 0 (Issue #390).
  // SMIL's setCurrentTime is gone with SMIL.
  assert.match(CSS, /#page-loader\[hidden\] \{ display: none; \}/);
  assert.match(CSS, /#main > \.grid-loader\[hidden\] \{ display: none; \}/);
  const show = APP.slice(APP.indexOf('function showPageLoader'));
  assert.match(show.slice(0, 400), /host\.hidden = false/);
  assert.doesNotMatch(APP, /setCurrentTime/, 'no SMIL clock is left to restart');
});

/* Issue #390: the rope froze whenever the main thread was busy, because it
   animated stroke-dashoffset with SMIL. The app now shows the weave-on rope at
   rest through windows that move by transform only; the compositor owns that
   motion. Kyle ruled on the look (2026-09-28): the moving ends are the old
   round caps and the unweave ends on the two end dots. The browser half of the
   gate is page-loader-browser. */
const FRAGMENT = loaderRopeHtml();
const strip = (svg) => svg.replace(/ pathLength="100" stroke-dasharray="100 110"/g, '')
  .replace(/<animate [^>]*\/>/g, '').replace(/(<path [^>]*)><\/path>/g, '$1/>');

test('the still rope is the weave-on mark at rest: same paths, same masks', () => {
  for (const [c2, id] of [[PALETTE.sky, 'sd'], [PALETTE.ink, 'sl']]) {
    assert.equal(loaderStill({ c1: PALETTE.blue, c2, id }), strip(loaderDraw({ c1: PALETTE.blue, c2, id })));
  }
  // Each strand the app shows is that mark's own path under its own mask.
  for (const [c2, id] of [[PALETTE.sky, 'rd'], [PALETTE.ink, 'rl']]) {
    const drawn = strip(loaderDraw({ c1: PALETTE.blue, c2, id }));
    for (const el of drawn.match(/<mask [\s\S]*?<\/mask>|<path [^>]*mask="url[^>]*\/>/g)) {
      assert.ok(FRAGMENT.includes(el), `the fragment carries ${el.slice(0, 60)}`);
    }
  }
});

test('each end of the rope rides the dash end it replaces', () => {
  const K = ROPE.tailScale;
  for (const end of ['head', 'tail']) {
    const stops = ropeStops(end);
    for (let k = 0; k <= 400; k++) {
      const u = k / 400;
      const i = Math.max(1, stops.findIndex(([o]) => o >= u));
      const [a, b] = [stops[i - 1], stops[i]];
      const got = a.map((v, c) => v + (b[c] - v) * (u - a[0]) / (b[0] - a[0] || 1));
      const want = ropePose(u, end);
      for (const c of [1, 2, 3]) assert.ok(Math.abs(got[c] - want[c - 1]) <= 0.05, `${end} u=${u}: coordinate ${c}`);
      assert.ok(Math.abs(got[4] - want[3]) <= 1, `${end} u=${u}: direction`);
      // And the pose is where the old dash had that end.
      const o = dashOffset(u), s = end === 'head' ? 100 - o : -o * K;
      const on = end === 'head' ? u < 0.62 && s > 0 : u >= 0.62 && s < 100;
      const whole = on && (end === 'head' ? s >= 100 : s <= 0);
      if (whole) {
        // At rest the far-side window alone shows the whole strand, the rest parked.
        assert.deepEqual(want, [ROPE.whole[end], ...ROPE.park[end === 'head' ? 'tail' : 'head']], `${end} u=${u} shows it whole`);
      } else if (on) assert.deepEqual(want.slice(1), strandPose(Math.min(s, 100)), `${end} u=${u} sits on the dash end`);
      else assert.deepEqual(want.slice(1), ROPE.park[end], `${end} u=${u} waits off the strand`);
    }
  }
});

test('the rope moves by transform only, on the published cycle', () => {
  const css = loaderRopeCss();
  assert.ok(FRAGMENT.includes(`<style>\n${css}</style>`), 'the fragment carries the generated CSS');
  const frames = css.slice(css.indexOf('@keyframes'));
  const props = new Set([...frames.matchAll(/\{\s*([a-z-]+):/g)].map((m) => m[1]));
  assert.deepEqual([...props], ['transform'], 'only transform keeps the rope on the compositor');
  const runs = [...css.matchAll(/animation: (rope-[a-z-]+) (\d+)ms linear infinite;/g)];
  assert.equal(runs.length, 12, 'three windows and their contents at each end');
  for (const [, , ms] of runs) assert.equal(Number(ms), LOADER_CYCLE_MS);
  assert.doesNotMatch(css, /stroke-dashoffset|clip-path|mask-position/);
  assert.doesNotMatch(CSS, /stroke-dashoffset/);
});

test('a fast route never pays for the loader', () => {
  assert.match(APP, /const LOADER_SHOW_AFTER_MS = \d+;/);
  const after = Number(APP.match(/const LOADER_SHOW_AFTER_MS = (\d+);/)[1]);
  assert.ok(after > 0 && after < LOADER_CYCLE_MS / 2, 'threshold sits well inside one cycle');
  // Finished before it appeared: cancel, and never show.
  assert.match(APP, /if \(loading\.showTimer\) \{[\s\S]*?clearTimeout\(loading\.showTimer\)/);
});

test('the rope waits 500ms; the skeleton covers everything shorter', () => {
  // Feature #148 (Kyle, 2026-08-28): the rope is for loads genuinely
  // expected to run long — longer than 500ms. Every route still goes
  // through the loader so a slow one earns the rope, but the API answers
  // in milliseconds, so routine navs finish on the skeleton alone. At the
  // old 200ms threshold the full-cycle rule WAS the wait: navs paid up to
  // ~2.2s for fetches a tenth that long.
  // renderRouteSafely is renderRoute with the Issue #118 catch around it: still
  // one call, still inside the loader, so the threshold below still governs it.
  assert.match(APP, /function route\(\) \{\s*return withPageLoader\(renderRouteSafely\);/);
  assert.match(APP, /window\.addEventListener\('hashchange', route\)/);
  assert.match(APP, /withPageLoader\(\(\) => loadSchema\(\)\.then\(renderRoute\)\.catch\(paintRouteError\)\)/);
  const after = Number(APP.match(/const LOADER_SHOW_AFTER_MS = (\d+);/)[1]);
  assert.equal(after, 500, 'the rope belongs to loads longer than 500ms');
  // Overlapping routes must not let the first one to finish hide the loader.
  assert.match(APP, /if \(loading\.depth > 0\) return;/);
});

test('the table skeleton draws the destination table\'s real columns', () => {
  // The skeleton is only convincing when it has the shape of where you are
  // going; the schema is already client-side, so the real column count is
  // free (Feature #148).
  assert.match(APP, /function paintSkeleton\(kind, db\)/);
  const fn = APP.slice(APP.indexOf('function paintSkeleton'));
  assert.match(fn.slice(0, 1200), /visibleCols\(db\)/,
    'db skeletons take their column count from the destination table');
});


test('the loader host survives a page render', () => {
  // #main gets replaceChildren() on every render, so a loader inside it would
  // be destroyed exactly when a slow render finally landed.
  const app = HTML.slice(HTML.indexOf('<div id="app">'));
  const loaderAt = app.indexOf('id="page-loader"');
  const mainEnd = app.indexOf('</main>');
  assert.ok(loaderAt > mainEnd, 'the loader is a sibling of <main>, not a child');
  assert.match(HTML, /<div id="page-loader" hidden/, 'hidden is the resting state');
});

test('the loader overlays the page without swallowing clicks', () => {
  const rules = {};
  for (const [, sels, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').map((s) => s.trim()).includes('#page-loader')) continue;
    for (const d of body.split(';')) {
      const i = d.indexOf(':');
      if (i > 0) rules[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  assert.equal(rules.position, 'fixed');
  assert.equal(rules['pointer-events'], 'none');
  // The rail sets z-index to clear #main; the loader must clear the rail, or
  // the wash stops at the chrome and the page load looks half-applied.
  const railZ = Number((CSS.match(/#ws-rail \{[^}]*z-index: (\d+)/) ?? [])[1]);
  assert.ok(Number(rules['z-index']) > railZ, `loader z-index must beat #ws-rail (${railZ})`);
  assert.match(CSS, /#page-loader\[hidden\] \{ display: none; \}/,
    'display:flex would otherwise beat the hidden attribute — the .hidden defect again');
});

test('the inlined rope is given a size', () => {
  // Caught in a live browser: the contract tests all passed while the loader
  // rendered 0x0. An inline <svg> with only a viewBox has no intrinsic size,
  // and as a flex item it collapses unless CSS sizes it.
  assert.match(CSS, /#page-loader \.mark-light, #page-loader \.mark-dark \{[^}]*width: \d+px/);
  assert.match(CSS, /#page-loader svg \{[^}]*width: 100%[^}]*height: 100%/);
  assert.ok(!/#page-loader img/.test(CSS),
    'the loader is inlined SVG, not <img> — an img rule here sizes nothing');
});

test('both themes are shipped and selected the same way as the rail mark', () => {
  assert.match(APP, /fetch\('\/brand\/weave-loader-rope\.html'\)/);
  assert.match(FRAGMENT, /<span class="mark-light">/);
  assert.match(FRAGMENT, /<span class="mark-dark">/);
  assert.match(CSS, /\[data-bs-theme="dark"\] #page-loader \.mark-light \{ display: none; \}/);
  assert.match(CSS, /\[data-bs-theme="dark"\] #page-loader \.mark-dark \{ display: block; \}/);
});

test('the served loaders are byte-identical to the generated brand assets', () => {
  const file = 'weave-loader-rope.html';
  assert.equal(read(`public/brand/${file}`), read(`brand/assets/${file}`),
    `public/brand/${file} is a stale copy — re-run brand/build-logos.mjs and copy it across`);
  assert.equal(read(`brand/assets/${file}`), FRAGMENT + '\n', `brand/assets/${file} is stale — re-run brand/build-logos.mjs`);
});

test('the README\'s inline HTML survives GitHub\'s tag scanner', () => {
  // A bare > inside an attribute value is legal HTML but ends the tag as far
  // as GitHub's markdown scanner is concerned: alt="Node >= 22.16" rendered as
  // a broken image followed by the rest of the tag as visible text.
  const readme = read('README.md');
  const bad = [...readme.matchAll(/<[a-z]+\s[^>]*?\w+="[^"]*[<>][^"]*"/gi)].map((m) => m[0]);
  assert.deepEqual(bad, [], 'escape < and > inside attribute values as &lt; / &gt;');
});

test('the README hero is a GIF pair, because GitHub will not run SMIL', () => {
  const readme = read('README.md');
  assert.match(readme, /<source media="\(prefers-color-scheme: dark\)" srcset="brand\/assets\/png\/weave-loader-dark\.gif">/);
  assert.match(readme, /<img src="brand\/assets\/png\/weave-loader-light\.gif"/);
  assert.match(readme, /alt="weave logo[^"]*"/, 'the hero carries alt text');
  for (const theme of ['dark', 'light']) {
    assert.ok(existsSync(join(ROOT, `brand/assets/png/weave-loader-${theme}.gif`)),
      `brand/assets/png/weave-loader-${theme}.gif is missing — run brand/render-gif.mjs`);
  }
});
