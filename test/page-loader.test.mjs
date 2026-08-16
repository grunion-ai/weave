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
import { LOADER_CYCLE_MS, VARIANTS } from '../brand/build-logos.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const APP = read('public/app.js');
const CSS = read('public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const HTML = read('public/index.html');

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

test('showing the loader restarts the clock so the cycle starts at the start', () => {
  const show = APP.slice(APP.indexOf('function showPageLoader'));
  assert.match(show.slice(0, 500), /setCurrentTime\(0\)/,
    'an <img> timeline free-runs; only a restarted inline SVG begins a whole weave');
});

test('a fast route never pays for the loader', () => {
  assert.match(APP, /const LOADER_SHOW_AFTER_MS = \d+;/);
  const after = Number(APP.match(/const LOADER_SHOW_AFTER_MS = (\d+);/)[1]);
  assert.ok(after > 0 && after < LOADER_CYCLE_MS / 2, 'threshold sits well inside one cycle');
  // Finished before it appeared: cancel, and never show.
  assert.match(APP, /if \(loading\.showTimer\) \{[\s\S]*?clearTimeout\(loading\.showTimer\)/);
});

test('every route change goes through the loader, including boot', () => {
  assert.match(APP, /function route\(\) \{\s*return withPageLoader\(renderRoute\);/);
  assert.match(APP, /window\.addEventListener\('hashchange', route\)/);
  assert.match(APP, /withPageLoader\(\(\) => loadSchema\(\)\.then\(renderRoute\)\)/);
  // Overlapping routes must not let the first one to finish hide the loader.
  assert.match(APP, /if \(loading\.depth > 0\) return;/);
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
  assert.match(APP, /weave-loader-\$\{theme\}\.svg/);
  assert.match(CSS, /\[data-bs-theme="dark"\] #page-loader \.mark-light \{ display: none; \}/);
  assert.match(CSS, /\[data-bs-theme="dark"\] #page-loader \.mark-dark \{ display: block; \}/);
});

test('the served loaders are byte-identical to the generated brand assets', () => {
  for (const theme of ['dark', 'light']) {
    const file = `weave-loader-${theme}.svg`;
    assert.ok(VARIANTS.some((v) => v.file === file), `${file} is a build variant`);
    assert.equal(read(`public/brand/${file}`), read(`brand/assets/${file}`),
      `public/brand/${file} is a stale copy — re-run brand/build-logos.mjs and copy it across`);
  }
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
