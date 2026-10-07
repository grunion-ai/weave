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
import { FLASH_MS } from './lib/flicker.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the app cycle constant tracks the one the generator publishes', () => {
  const declared = Number(APP.match(/const LOADER_CYCLE_MS = (\d+);/)[1]);
  assert.equal(declared, LOADER_CYCLE_MS,
    'app.js and brand/build-logos.mjs must agree, or the hide lands mid-weave');
});

test('a shown loader always finishes at least one whole cycle', () => {
  assert.match(APP, /LOADER_CYCLE_MS - \(elapsed % LOADER_CYCLE_MS\)/);
  assert.match(APP, /const elapsed = Date\.now\(\) - loading\.shownAt/);
});

test('showing the loader restarts the rope so the cycle starts at the start', () => {
  assert.match(CSS, /#page-loader\[hidden\] \{ display: none; \}/);
  assert.match(CSS, /#main > \.grid-loader\[hidden\] \{ display: none; \}/);
  const show = APP.slice(APP.indexOf('function showPageLoader'));
  assert.match(show.slice(0, 400), /host\.hidden = false/);
  assert.doesNotMatch(APP, /setCurrentTime/, 'no SMIL clock is left to restart');
});

const FRAGMENT = loaderRopeHtml();
const strip = (svg) => svg.replace(/ pathLength="100" stroke-dasharray="100 110"/g, '')
  .replace(/<animate [^>]*\/>/g, '').replace(/(<path [^>]*)><\/path>/g, '$1/>');

test('the still rope is the weave-on mark at rest: same paths, same masks', () => {
  for (const [c2, id] of [[PALETTE.sky, 'sd'], [PALETTE.ink, 'sl']]) {
    assert.equal(loaderStill({ c1: PALETTE.blue, c2, id }), strip(loaderDraw({ c1: PALETTE.blue, c2, id })));
  }
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
      const o = dashOffset(u), s = end === 'head' ? 100 - o : -o * K;
      const on = end === 'head' ? u < 0.62 && s > 0 : u >= 0.62 && s < 100;
      const whole = on && (end === 'head' ? s >= 100 : s <= 0);
      if (whole) {
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
  assert.match(APP, /if \(loading\.showTimer\) \{[\s\S]*?clearTimeout\(loading\.showTimer\)/);
});

test('the rope waits 500ms; the skeleton covers the band above the flash ceiling', () => {
  assert.match(APP, /function route\(\) \{\s*return withPageLoader\(renderRouteSafely\);/);
  assert.match(APP, /window\.addEventListener\('hashchange', route\)/);
  assert.match(APP, /withPageLoader\(\(\) => loadSchema\(\)\.then\(renderRoute\)\.catch\(paintRouteError\)\)/);
  const after = Number(APP.match(/const LOADER_SHOW_AFTER_MS = (\d+);/)[1]);
  assert.equal(after, 500, 'the rope belongs to loads longer than 500ms');
  assert.match(APP, /if \(loading\.depth > 0\) return;/);
});

test('a load shorter than the flash ceiling paints no skeleton (Issue #630)', () => {
  const after = Number(APP.match(/const SKELETON_SHOW_AFTER_MS = (\d+);/)[1]);
  assert.equal(after, FLASH_MS, 'the skeleton is earned at the same ceiling the flicker probe calls a flash');
  assert.ok(after < Number(APP.match(/const LOADER_SHOW_AFTER_MS = (\d+);/)[1]),
    'the skeleton still comes before the rope');
  assert.match(APP, /function scheduleSkeleton\(kind, db\) \{[\s\S]*?setTimeout\([\s\S]*?paintSkeleton\(kind, db\)[\s\S]*?SKELETON_SHOW_AFTER_MS\)/,
    'renderRoute schedules the skeleton rather than painting it');
  assert.match(APP, /function renderRoute\(\) \{\s*return Promise\.resolve\(\)\.then\(dispatchRoute\)\.finally\(cancelSkeleton\);/,
    'every route path cancels the pending skeleton when it paints, so the old page holds');
  assert.match(APP, /function cancelSkeleton\(\) \{\s*clearTimeout\(skeleton\.timer\);/);
});

test('the table skeleton draws the destination table\'s real columns', () => {
  assert.match(APP, /function paintSkeleton\(kind, db\)/);
  const fn = APP.slice(APP.indexOf('function paintSkeleton'));
  assert.match(fn.slice(0, 1200), /visibleCols\(db\)/,
    'db skeletons take their column count from the destination table');
});


test('the loader host survives a page render', () => {
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
  const railZ = Number((CSS.match(/#ws-rail \{[^}]*z-index: (\d+)/) ?? [])[1]);
  assert.ok(Number(rules['z-index']) > railZ, `loader z-index must beat #ws-rail (${railZ})`);
  assert.match(CSS, /#page-loader\[hidden\] \{ display: none; \}/,
    'display:flex would otherwise beat the hidden attribute — the .hidden defect again');
});

test('the inlined rope is given a size', () => {
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

test('the served brand files are the generator output, kept in public/brand only (Issue #651)', () => {
  assert.equal(read('public/brand/weave-loader-rope.html'), FRAGMENT + '\n',
    'public/brand/weave-loader-rope.html is stale — re-run node brand/build-logos.mjs');
  for (const { file, svg } of VARIANTS.filter((v) => v.served)) {
    assert.equal(read(`public/brand/${file}`), svg + '\n', `public/brand/${file} is stale — re-run node brand/build-logos.mjs`);
  }
  for (const file of [...VARIANTS.map((v) => v.file), 'weave-loader-rope.html', 'png/favicon-32.png', 'png/favicon.ico']) {
    const name = file.replace('png/', '');
    assert.ok(!(existsSync(join(ROOT, 'brand/assets', file)) && existsSync(join(ROOT, 'public/brand', name))),
      `${name} is in both brand/assets and public/brand; keep one`);
  }
});

test('the README\'s inline HTML survives GitHub\'s tag scanner', () => {
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
