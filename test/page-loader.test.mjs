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
  LOADER_CYCLE_MS, VARIANTS, PALETTE, loaderDraw, loaderStill, loaderWipe, loaderWipeCss, dashExtent, markExtent,
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

test('showing the loader restarts the wipe so the cycle starts at the start', () => {
  // The wipe is a CSS animation on elements inside the host, and [hidden] is
  // display:none, so un-hiding the host starts it again at 0 (Issue #390).
  // SMIL's setCurrentTime is gone with SMIL.
  assert.match(CSS, /#page-loader\[hidden\] \{ display: none; \}/);
  assert.match(CSS, /#main > \.grid-loader\[hidden\] \{ display: none; \}/);
  const show = APP.slice(APP.indexOf('function showPageLoader'));
  assert.match(show.slice(0, 400), /host\.hidden = false/);
  assert.doesNotMatch(APP, /setCurrentTime/, 'no SMIL clock is left to restart');
});

/* Issue #390: the rope froze whenever the main thread was busy, because it
   animated stroke-dashoffset with SMIL. The still mark is the weave-on rope at
   rest, and a window that animates transform only reveals it; the compositor
   owns that motion. The browser half of the gate is page-loader-browser. */
test('the still rope is the weave-on mark at rest: same paths, same masks', () => {
  for (const [c2, id] of [[PALETTE.sky, 'sd'], [PALETTE.ink, 'sl']]) {
    const drawn = loaderDraw({ c1: PALETTE.blue, c2, id })
      .replace(/ pathLength="100" stroke-dasharray="100 110"/g, '')
      .replace(/<animate [^>]*\/>/g, '')
      .replace(/(<path [^>]*)><\/path>/g, '$1/>');
    assert.equal(loaderStill({ c1: PALETTE.blue, c2, id }), drawn);
  }
});

test('the wipe reveals what the dash drew, frame by frame', () => {
  const { width, margin, stops } = loaderWipe();
  assert.ok(margin > 0 && margin <= 0.5, 'the edge may clear the caps by at most one CSS pixel');
  const at = (u) => {
    const i = stops.findIndex(([o]) => o >= u);
    if (i <= 0) return stops[Math.max(i, 0)][1];
    const [[u0, p0], [u1, p1]] = [stops[i - 1], stops[i]];
    return p0 + (p1 - p0) * (u - u0) / (u1 - u0);
  };
  const [lo, hi] = markExtent();
  for (let k = 0; k <= 400; k++) {
    const u = k / 400, p = at(u), want = dashExtent(u);
    if (!want) {
      assert.ok(p + width <= lo - margin + 0.05 || p >= hi + margin - 0.05,
        `u=${u}: the dash shows nothing, the wipe window sits at ${p.toFixed(2)}`);
      continue;
    }
    // The window reaches `margin` past the dash; clip both to the mark.
    const shown = [Math.max(p + margin, lo), Math.min(p + width - margin, hi)];
    assert.ok(Math.abs(shown[0] - want[0]) <= 0.05 && Math.abs(shown[1] - want[1]) <= 0.05,
      `u=${u}: dash spans ${want.map((x) => x.toFixed(2))}, wipe ${shown.map((x) => x.toFixed(2))}`);
  }
});

test('style.css carries the generated wipe verbatim, on transform only', () => {
  const css = loaderWipeCss();
  assert.ok(CSS.includes(css),
    'public/style.css is stale: paste loaderWipeCss() from brand/build-logos.mjs between the Issue #390 markers');
  const frames = css.slice(css.indexOf('@keyframes'));
  const props = new Set([...frames.matchAll(/\{\s*([a-z-]+):/g)].map((m) => m[1]));
  assert.deepEqual([...props], ['transform'], 'only transform keeps the rope on the compositor');
  assert.match(css, new RegExp(`animation: rope-wipe ${LOADER_CYCLE_MS}ms linear infinite`));
  assert.match(css, new RegExp(`animation: rope-wipe-in ${LOADER_CYCLE_MS}ms linear infinite`));
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
  assert.match(APP, /weave-loader-still-\$\{theme\}\.svg/);
  assert.match(CSS, /\[data-bs-theme="dark"\] #page-loader \.mark-light \{ display: none; \}/);
  assert.match(CSS, /\[data-bs-theme="dark"\] #page-loader \.mark-dark \{ display: block; \}/);
});

test('the served loaders are byte-identical to the generated brand assets', () => {
  for (const theme of ['dark', 'light']) {
    const file = `weave-loader-still-${theme}.svg`;
    assert.ok(VARIANTS.some((v) => v.file === file), `${file} is a build variant`);
    assert.equal(read(`public/brand/${file}`), read(`brand/assets/${file}`),
      `public/brand/${file} is a stale copy — re-run brand/build-logos.mjs and copy it across`);
  }
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
