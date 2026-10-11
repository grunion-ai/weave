import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LOADER_CYCLE_MS, VARIANTS, PALETTE, ROPE, loaderDraw, loaderStill, loaderRopeHtml, loaderRopeCss,
  loaderBootHtml, ropePose, ropeStops, strandPose, dashOffset,
} from '../brand/build-logos.mjs';
import { APP, HTML, CSS, px, rulesFor, fnBody } from './lib/source.mjs';
import { FLASH_MS } from './lib/flicker.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the app cycle constant tracks the one the generator publishes', () => {
  const declared = Number(APP.match(/const LOADER_CYCLE_MS = (\d+);/)[1]);
  assert.equal(declared, LOADER_CYCLE_MS,
    'app.js and brand/build-logos.mjs must agree, or the hide lands mid-weave');
});

test('a finished page leaves on the woven pose, not at the cycle end (Issue #392)', () => {
  assert.doesNotMatch(APP, /LOADER_CYCLE_MS - \(elapsed % LOADER_CYCLE_MS\)/,
    'rounding the hide up to the cycle end shows the empty wash and taxes the page up to 2 s');
  const woven = [];
  for (let k = 0; k <= 2000; k++) {
    const u = k / 2000;
    if (Math.abs(dashOffset(u)) < 1e-9) woven.push(u);
  }
  assert.equal(Number(APP.match(/const LOADER_POSE_FROM = ([\d.]+);/)[1]), woven[0],
    'the exit pose starts where the generator finishes weaving the mark');
  assert.equal(Number(APP.match(/const LOADER_POSE_TO = ([\d.]+);/)[1]), woven[woven.length - 1],
    'the exit pose ends before the generator starts unweaving');
  assert.ok(Number(APP.match(/const LOADER_EXIT_RATE = ([\d.]+);/)[1]) > 1,
    'the exit fast-forwards to the pose instead of waiting for it');
  const settle = fnBody('settleLoader');
  assert.match(settle, /playbackRate = LOADER_EXIT_RATE/);
  assert.match(settle, /updateTiming\(\{ iterations:/,
    'fractional iterations end the rope on the pose even when the main thread is busy');
  assert.match(settle, /\.finished\.then\(fade/,
    'the fade follows the animation clock, never a timer that jank can overshoot');
  assert.match(settle, /classList\.add\('loader-out'\)/);
  assert.match(settle, /setTimeout\(hide, LOADER_HOLD_MS \+ LOADER_FADE_MS\)/);
});

test('the grid loader leaves the same way as the page loader (Issue #392)', () => {
  const grid = fnBody('paintGridWait');
  assert.doesNotMatch(grid, /LOADER_CYCLE_MS/,
    'two loaders on one screen must agree on when they go');
  assert.match(grid, /settleLoader\(gridLoaderNode\(\), gridWait, hideGridLoader\)/);
  assert.match(fnBody('withPageLoader'), /settleLoader\(\$\('#page-loader'\), loading, hidePageLoader\)/);
  for (const [fn, state] of [['withPageLoader', 'loading'], ['paintGridWait', 'gridWait']]) {
    assert.match(fnBody(fn), new RegExp(`if \\(${state}\\.exit\\) keepLoader\\(`),
      `a fresh wait during the exit puts ${state} back on the rope instead of leaving it faded out`);
  }
  assert.match(fnBody('showPageLoader'), /keepLoader\(host, loading\)/,
    'the show takes the faded-out class and the fast-forwarded timing back off');
  assert.match(fnBody('showGridLoader'), /keepLoader\(node, gridWait\)/);
  assert.match(fnBody('hidePageLoader'), /loading\.exit = null/);
  assert.match(fnBody('hideGridLoader'), /gridWait\.exit = null/);
  for (const fn of ['hidePageLoader', 'hideGridLoader']) {
    assert.doesNotMatch(fnBody(fn), /loader-out/,
      `${fn} leaves the class on: dropping it as the host goes dark is a class that flips and flips back`);
  }
});

test('the exit holds the pose, then fades, in both motion settings (Issue #392)', () => {
  const timing = {};
  for (const name of ['LOADER_HOLD_MS', 'LOADER_FADE_MS']) {
    const found = APP.match(new RegExp(`const ${name} = (\\d+);`));
    assert.ok(found, `app.js must declare ${name}, so the CSS and the hide timer read one number`);
    timing[name] = Number(found[1]);
  }
  const [hold, fade] = [timing.LOADER_HOLD_MS, timing.LOADER_FADE_MS];
  for (const host of ['#page-loader', '#main > \\.grid-loader']) {
    const rule = new RegExp(`${host}\\.loader-out \\{ animation: loader-out (\\d+)ms linear (\\d+)ms both; \\}`);
    const found = CSS.match(rule);
    assert.ok(found, `${host}.loader-out must hold the pose and then fade, filled both ways`);
    assert.deepEqual([Number(found[1]), Number(found[2])], [fade, hold],
      `${host}.loader-out: the CSS fade and delay must match LOADER_FADE_MS and LOADER_HOLD_MS`);
  }
  assert.ok(CSS.indexOf('#page-loader.loader-out') > CSS.indexOf('#page-loader.boot'),
    'the exit rule must outrank the boot gate, which is still on the host while it fades');
  assert.match(CSS, /@keyframes loader-out \{ from \{ opacity: 1; \} to \{ opacity: 0; \} \}/);
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*#page-loader \{ animation: none; \}\s*#page-loader\.boot \{[^}]*\}\s*#page-loader\.loader-out \{ animation: loader-out 0s[^}]*\}/,
    'reduced motion keeps the hold and drops the fade');
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
  assert.match(HTML, /<div id="page-loader" class="boot" aria-hidden="true">\S/,
    'the host ships the boot mark, gated by CSS until the threshold (Issue #391)');
  assert.match(fnBody('hidePageLoader'), /host\.hidden = true/,
    'hidden is the resting state once the script has run');
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

test('the boot mark ships in the first HTML byte, drawn by the generator (Issue #391)', () => {
  const div = HTML.match(/<div id="page-loader"([^>]*)>([\s\S]*?)<\/div>/);
  assert.ok(div, 'public/index.html must still carry the #page-loader host');
  assert.doesNotMatch(div[1], /(?:^|\s)hidden(?=[\s=]|$)/,
    'a hidden host cannot paint before app.js runs — the whole point of Issue #391');
  assert.equal(div[2], loaderBootHtml(),
    'public/index.html loader block is stale — re-run node brand/build-logos.mjs');
  assert.match(loaderBootHtml(), /<span class="mark-light">/);
  assert.match(loaderBootHtml(), /<span class="mark-dark">/);
});

test('the boot mark is the same drawing as the rope at rest (Issue #391)', () => {
  for (const [c2, id] of [[PALETTE.ink, 'bl'], [PALETTE.sky, 'bd']]) {
    assert.ok(loaderBootHtml().includes(loaderStill({ c1: PALETTE.blue, c2, id })),
      'the boot mark is loaderStill, never a second drawing of the mark');
  }
});

test('CSS gates the first appearance at the threshold app.js uses (Issue #391)', () => {
  const declared = Number(APP.match(/const LOADER_SHOW_AFTER_MS = (\d+);/)[1]);
  const gate = rulesFor('#page-loader.boot').animation;
  assert.ok(gate, '#page-loader.boot must carry the gating animation');
  const delay = Number((gate.match(/(\d+)ms/) ?? [])[1]);
  assert.equal(delay, declared,
    'the CSS delay and LOADER_SHOW_AFTER_MS must agree, or the shell shows bare or flashes');
});

test('reduced motion keeps the gate and drops only the fade (Issue #391)', () => {
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{\s*#page-loader \{ animation: none; \}\s*#page-loader\.boot \{ animation:[^;]*\b500ms\b[^;]*; \}/,
    'animation:none alone would paint the loader from the first byte on a fast boot');
});

test('showing the loader no longer waits on the fetched rope (Issue #391)', () => {
  const show = fnBody('showPageLoader');
  assert.doesNotMatch(show, /loading\.ready/,
    'the mark is in the HTML now; gating the show on the fetch is the Issue #391 defect');
  assert.match(fnBody('hidePageLoader'), /classList\.remove\('boot'\)/,
    'hiding retires the CSS gate, so a later show fades in at once instead of 500 ms late');
  assert.doesNotMatch(show, /classList\.remove\('boot'\)/,
    'showing must leave the gate alone: removing it here re-runs the fade on a visible loader');
  const wrap = fnBody('withPageLoader');
  const finallyBody = wrap.slice(wrap.indexOf('finally'));
  assert.equal((finallyBody.match(/hidePageLoader\(\)/g) ?? []).length, 2,
    'every exit hides: the CSS gate would otherwise strand a loader the script never showed');
});
