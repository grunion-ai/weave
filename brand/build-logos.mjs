#!/usr/bin/env node
// weave brand asset generator — single source of truth for the logo mark.
//
// The mark ("h3"): a horizontal rope of two strands with 3 crossings and true
// alternating over-under weave. Chosen 2026-08-16 from the rope matrix
// (see brand/docs/). Decisions applied: 1A 2B 3A 4B 5B 6A (see brand/README.md).
//
// Standalone SVGs stay transparent-safe by cutting the under-strand with masks
// instead of painting background-colored gap strokes.
//
// Usage: node brand/build-logos.mjs [outDir=brand/assets]

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export { PALETTE, rope, H3, px, stroke, markParts } from "../src/mark.js";
import { PALETTE, rope, H3, px, stroke, markParts } from "../src/mark.js";

// A standalone square mark SVG (transparent background).
export function weaveSvg({ c1, c2, sw = 3.5, viewBox = "0 0 48 48" }) {
  const { defs, body } = markParts({ c1, c2, sw });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs>${defs}</defs>${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Loading animations (round 6). The mark's own parts twist into place; nothing
// is drawn that the static mark doesn't already contain. All motion is SMIL so
// a loader works inline, in an <img>, and in a CSS background — no JS, no
// build step, and it animates even where CSS `d:` is unsupported.
// ---------------------------------------------------------------------------

const anim = (attr, values, dur, extra = "") =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}s" ` +
  `repeatCount="indefinite"${extra}/>`;
// Ease every leg of a keyframe list with the same spline (n stops → n-1 legs).
const SPLINE = ".45 0 .25 1";
const eased = keyTimes =>
  ` calcMode="spline" keyTimes="${keyTimes.join(";")}" keySplines="` +
  Array(keyTimes.length - 1).fill(SPLINE).join(";") + `"`;

// Morph loaders: interpolate the rope through a list of amplitudes. Strand,
// mask, and over-segment all carry the SAME keyframe list, so the under-strand
// cut stays registered with the strand cutting it at every frame.
//
// As the rope flattens the two strands converge, and a full-width gap would eat
// the line and leave the over-segment floating in it. So the cut tapers with
// the amplitude (closed below |amp| 2) and the over-segment fades with it: at
// amp 0 the mark is one clean edge-on line.
function morphLoader({ c1, c2, sw, id, amps, keyTimes, dur, ease = true, wrap = b => b }) {
  const frames = amps.map(a => rope(3, 8, a));
  const timing = ease ? eased(keyTimes) : ` keyTimes="${keyTimes.join(";")}"`;
  const taper = Math.min(...amps) < 2 ? amps.map(a => Math.min(1, Math.abs(a) / 2)) : null;
  const track = (attr, f) => taper ? anim(attr, taper.map(f).map(px).join(";"), dur, timing) : "";
  const d = pick => anim("d", frames.map(pick).join(";"), dur, timing);
  const kids = {
    a: d(f => f.a),
    b: d(f => f.b),
    maskB: d(f => f.b) + track("stroke-width", t => t * (sw + 2.5)),
    over: d(f => f.overs[0]) + track("opacity", t => t),
    maskOver: d(f => f.overs[0]) + track("stroke-width", t => t * (sw + 2.5)),
  };
  const { defs, body } = markParts({ c1, c2, sw, id, r: frames[0], kids });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" ` +
    `aria-label="Loading"><defs>${defs}</defs>${wrap(body)}</svg>`;
}

// A — travel: an endless rope pulled through a fading window. Seamless because
// the translation equals one full weave period (2 x pitch).
export function loaderTravel({ c1, c2, sw = 3.5, id = "lt", dur = 1.8 }) {
  const r = rope(11, 8);
  const { defs, body } = markParts({ c1, c2, sw, id, r });
  const fade =
    `<linearGradient id="${id}G" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="#000"/><stop offset=".2" stop-color="#fff"/>` +
    `<stop offset=".8" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>` +
    `<mask id="${id}F"><rect width="48" height="48" fill="url(#${id}G)"/></mask>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" ` +
    `aria-label="Loading"><defs>${defs}${fade}</defs><g mask="url(#${id}F)"><g>${body}` +
    `<animateTransform attributeName="transform" type="translate" values="0 0;-16 0" ` +
    `dur="${dur}s" repeatCount="indefinite"/></g></g></svg>`;
}

// B — twist-in: two flat strands lift, cross, and settle into the mark, hold,
// then fade out and start over. The literal "parts twisting into place".
export function loaderTwist({ c1, c2, sw = 3.5, id = "tw", dur = 1.8 }) {
  const keyTimes = ["0", ".12", ".45", ".78", "1"];
  return morphLoader({
    c1, c2, sw, id, dur,
    amps: [0, 0, 4, 4, 4],
    keyTimes,
    wrap: body => `<g opacity="0">${body}` +
      anim("opacity", "0;1;1;1;0", dur, eased(keyTimes)) + `</g>`,
  });
}

// C — spin: the settled rope keeps turning on its long axis — amplitude runs a
// full cosine, so the strands swap sides through an edge-on line and back.
export function loaderSpin({ c1, c2, sw = 3.5, id = "sp", dur = 2.2 }) {
  const amps = Array.from({ length: 9 }, (_, k) => +(4 * Math.cos((k * Math.PI) / 4)).toFixed(2));
  const keyTimes = amps.map((_, i) => String(+(i / (amps.length - 1)).toFixed(3)));
  return morphLoader({ c1, c2, sw, id, dur, amps, keyTimes, ease: false });
}

// D — weave-on: the strands draw themselves left to right, then the rope
// unweaves the same way. Two paths, nothing else.
//
// The static mark builds the crossing as a THIRD path laid over the top. Under
// a draw-on that third path has no honest moment to arrive: the strands reach
// the crossing a quarter of the way in, so anything timed later leaves a hole
// in the middle of the mark. Instead mask A paints the crossing back in white —
// strand A stays continuous through it, so the crossing is simply part of the
// strand and draws with it. B keeps its cut, so the over-under still reads.
export function loaderDraw({ c1, c2, sw = 3.5, id = "dr", dur = 2 }) {
  // pathLength normalizes both strands to 100 so they draw at the same rate.
  // The off-gap (110) must exceed offset + pathLength (104 + 100 = 204 across
  // the pattern), or the dash wraps at the far end and a round cap paints a
  // stray dot there on the hidden frames.
  const draw = anim("stroke-dashoffset", DRAW.offsets.join(";"), dur, eased(DRAW.keyTimes));
  const dash = ` pathLength="100" stroke-dasharray="100 110"`;
  return drawMark({ c1, c2, sw, id, dash, draw });
}

// The weave-on timeline: dash offsets at key times, each leg on SPLINE.
const DRAW = { keyTimes: ["0", ".45", ".62", "1"], offsets: [104, 0, 0, -104] };

// The weave-on rope at rest (Issue #390): loaderDraw's paths and masks with no
// dash and no SMIL. The app reveals it with a wipe the compositor animates
// (loaderWipeCss), because Chrome and Safari tick SMIL on the main thread and
// the rope froze whenever the page was busy.
export function loaderStill({ c1, c2, sw = 3.5, id = "st" }) {
  return drawMark({ c1, c2, sw, id });
}

function drawMark({ c1, c2, sw, id, dash = "", draw = "" }) {
  const gw = sw + 2.5;
  const region = 'maskUnits="userSpaceOnUse" x="-24" y="-24" width="96" height="96"';
  const white = H3.overs.map(o => stroke(o, "#fff", gw)).join("");
  const defs =
    `<mask id="${id}A" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
    stroke(H3.b, "#000", gw) + white + `</mask>` +
    `<mask id="${id}B" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
    H3.overs.map(o => stroke(o, "#000", gw)).join("") + `</mask>`;
  // B first, so A can pass over it where the mask restored the crossing.
  const body =
    stroke(H3.b, c2, sw, ` mask="url(#${id}B)"` + dash, draw) +
    stroke(H3.a, c1, sw, ` mask="url(#${id}A)"` + dash, draw);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" ` +
    `aria-label="Loading"><defs>${defs}</defs>${body}</svg>`;
}

// The shipped loaders run at this period. The UI imports the number (via the
// data-cycle attribute it is stamped into) so "let it finish one cycle" is one
// fact, not two that can drift.
export const LOADER_CYCLE_MS = 2000;

// ---------------------------------------------------------------------------
// The compositor wipe (Issue #390). Both strands run left to right and are
// monotonic in x, and they are mirror images, so at any moment the dash on
// each covers the same x-span. A window that shows only that span, over the
// still mark, therefore shows what the dash drew. The window slides with
// transform; its content counter-slides so the mark stays put. Transform is
// the one thing Chrome and Safari animate off the main thread.
// ---------------------------------------------------------------------------

// A cubic-bezier easing, solved for progress x by bisection.
function bezier(x1, y1, x2, y2) {
  const at = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return x => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; (at(m, x1, x2) < x ? (lo = m) : (hi = m)); }
    return at((lo + hi) / 2, y1, y2);
  };
}
const ease = bezier(...SPLINE.split(" ").map(Number));

// x at each 1/2000 of strand A's length (pathLength 100 → index s * 20).
const ALONG = (() => {
  const n = H3.a.match(/-?[\d.]+/g).map(Number);
  const pts = [];
  for (let i = 2; i < n.length; i += 6) {
    const [x0, y0] = i === 2 ? [n[0], n[1]] : [n[i - 2], n[i - 1]];
    for (let k = i === 2 ? 0 : 1; k <= 400; k++) {
      const t = k / 400, u = 1 - t;
      pts.push([u ** 3 * x0 + 3 * u * u * t * n[i] + 3 * u * t * t * n[i + 2] + t ** 3 * n[i + 4],
        u ** 3 * y0 + 3 * u * u * t * n[i + 1] + 3 * u * t * t * n[i + 3] + t ** 3 * n[i + 5]]);
    }
  }
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1];
  return Array.from({ length: 2001 }, (_, j) => {
    const want = (j / 2000) * total;
    let i = len.findIndex(l => l >= want);
    if (i <= 0) return pts[0][0];
    const f = (want - len[i - 1]) / (len[i] - len[i - 1]);
    return pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0]);
  });
})();
const xAt = s => { const j = s * 20, i = Math.floor(j); return i >= 2000 ? ALONG[2000] : ALONG[i] + (j - i) * (ALONG[i + 1] - ALONG[i]); };

// The mark's x-span with its round caps, in the 48-unit viewBox.
export function markExtent(sw = 3.5) { return [xAt(0) - sw / 2, xAt(100) + sw / 2]; }

// The x-span the weave-on dash paints at cycle phase u (0..1), caps included,
// or null on a frame where it paints nothing.
export function dashExtent(u, sw = 3.5) {
  const kt = DRAW.keyTimes.map(Number), o = DRAW.offsets;
  let leg = kt.findIndex((k, i) => i > 0 && u <= k);
  if (leg < 0) leg = kt.length - 1;
  const f = (u - kt[leg - 1]) / (kt[leg] - kt[leg - 1]);
  const offset = o[leg - 1] + (o[leg] - o[leg - 1]) * ease(Math.min(1, Math.max(0, f)));
  const from = Math.max(0, -offset), to = Math.min(100, 100 - offset);
  return from < to ? [xAt(from) - sw / 2, xAt(to) + sw / 2] : null;
}

// Keyframes for the window's left edge: [phase, x] stops, linear between, as
// few as keep every frame within `tolerance` units of the dash (48 units span
// the 96px rope, so 0.05 is 0.1px). The window's edges sit `margin` outside
// the dash's own span, so the compositor's pixel-snapped clip never shaves the
// round caps' antialiasing; on the empty frames it parks a margin clear of the
// mark, so no sliver of a cap shows either.
export function loaderWipe({ sw = 3.5, tolerance = 0.05, margin = 0.25 } = {}) {
  const [lo, hi] = markExtent(sw), width = hi - lo + 2 * margin;
  const left = u => {
    const e = dashExtent(u, sw);
    if (e) return e[0] > lo + 1e-9 ? e[0] - margin : e[1] + margin - width; // unweaving : drawing in
    return u < +DRAW.keyTimes[1] ? lo - margin - width : hi + margin;        // not yet drawn : all gone
  };
  const N = 8000, pts = Array.from({ length: N + 1 }, (_, i) => [i / N, left(i / N)]);
  const keep = new Set([0, N]);
  const simplify = (a, b) => { // Ramer-Douglas-Peucker on the phase axis
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const [u0, p0] = pts[a], [u1, p1] = pts[b];
      const d = Math.abs(p0 + (p1 - p0) * (pts[i][0] - u0) / (u1 - u0) - pts[i][1]);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { keep.add(at); simplify(a, at); simplify(at, b); }
  };
  simplify(0, N);
  const stops = [...keep].sort((a, b) => a - b).map(i => pts[i]);
  return { width, margin, stops };
}

// The CSS the app ships for the wipe, pasted verbatim into public/style.css
// between the Issue #390 markers (test/page-loader.test.mjs checks it). The
// window is the mark's own width; its offsets are percents of the elements'
// own widths, so the rope scales with whatever box holds it.
export function loaderWipeCss({ sw = 3.5 } = {}) {
  const { width, stops } = loaderWipe({ sw });
  const n = v => String(+v.toFixed(3));
  const pct = u => n(u * 100) + "%";
  const frames = (name, f) => `@keyframes ${name} {\n` +
    stops.map(([u, p]) => `  ${pct(u)} { transform: translateX(${n(f(p))}%); }\n`).join("") + `}\n`;
  return `.rope-wipe { position: absolute; top: 0; bottom: 0; left: 0; width: ${n(width / 48 * 100)}%; ` +
    `overflow: hidden; animation: rope-wipe ${LOADER_CYCLE_MS}ms linear infinite; }\n` +
    `.rope-wipe-in { position: absolute; top: 0; bottom: 0; left: 0; width: ${n(48 / width * 100)}%; ` +
    `animation: rope-wipe-in ${LOADER_CYCLE_MS}ms linear infinite; }\n` +
    frames("rope-wipe", p => p / width * 100) +
    frames("rope-wipe-in", p => -p / 48 * 100);
}

export const LOADERS = {
  travel: { label: "Travel — endless rope through a fading window", fn: loaderTravel },
  twist: { label: "Twist-in — flat strands twist into the mark", fn: loaderTwist },
  spin: { label: "Spin — the rope turns on its long axis", fn: loaderSpin },
  draw: { label: "Weave-on — strands draw in, crossing locks, unweaves", fn: loaderDraw },
};

// One loader SVG. `variant` is a key of LOADERS; opts are passed through.
export function loaderSvg(variant, opts = {}) {
  const l = LOADERS[variant];
  if (!l) throw new Error(`unknown loader variant: ${variant}`);
  return l.fn({ c1: PALETTE.blue, c2: PALETTE.sky, id: variant, ...opts });
}

// App icon (decision 1A): blue squircle, cream + ice strands, sw 4.
function appIconSvg() {
  const { defs, body } = markParts({ c1: PALETTE.cream, c2: PALETTE.ice, sw: 4 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${defs}</defs>` +
    `<rect width="512" height="512" rx="115" fill="${PALETTE.blue}"/>` +
    `<g transform="translate(256,256) scale(7.6) translate(-24,-24)">${body}</g></svg>`;
}

// Inline lockup (decisions 3A + 4B): mark at x-height, "weave" in Outfit 600.
// Outfit must be available (or loaded) wherever the SVG is consumed; falls back
// to the system stack.
function lockupSvg(textColor) {
  const { defs, body } = markParts({ c1: PALETTE.blue, c2: PALETTE.sky, sw: 3.5 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 12 106 24"><defs>${defs}</defs>${body}` +
    `<text x="42" y="31.5" font-family="Outfit, -apple-system, 'Segoe UI', sans-serif" ` +
    `font-size="21" font-weight="600" letter-spacing="-0.4" fill="${textColor}">weave</text></svg>`;
}

export const VARIANTS = [
  // core marks (decision 5B gives the light pair; 6A the canonical mono)
  { file: "weave-mark-dark.svg",       svg: weaveSvg({ c1: PALETTE.blue, c2: PALETTE.sky }) },
  { file: "weave-mark-light.svg",      svg: weaveSvg({ c1: PALETTE.blue, c2: PALETTE.ink }) },
  { file: "weave-mark-mono-blue.svg",  svg: weaveSvg({ c1: PALETTE.blue, c2: PALETTE.blue }) },
  { file: "weave-mark-mono-cream.svg", svg: weaveSvg({ c1: PALETTE.cream, c2: PALETTE.cream }) },
  { file: "weave-mark-white.svg",      svg: weaveSvg({ c1: PALETTE.white, c2: PALETTE.white }) },
  // favicon (decision 2B): mono blue, optically thickened
  { file: "weave-favicon.svg",         svg: weaveSvg({ c1: PALETTE.blue, c2: PALETTE.blue, sw: 4.5 }) },
  // app icon (decision 1A)
  { file: "weave-app-icon.svg",        svg: appIconSvg() },
  // loaders (decision 7): weave-on, the same strand pairs as the marks
  { file: "weave-loader-dark.svg",     svg: loaderSvg("draw", { c1: PALETTE.blue, c2: PALETTE.sky, id: "ld" }) },
  { file: "weave-loader-light.svg",    svg: loaderSvg("draw", { c1: PALETTE.blue, c2: PALETTE.ink, id: "ll" }) },
  // the app's loader (Issue #390): the same rope at rest, revealed by loaderWipeCss()
  { file: "weave-loader-still-dark.svg",  svg: loaderStill({ c1: PALETTE.blue, c2: PALETTE.sky, id: "sd" }) },
  { file: "weave-loader-still-light.svg", svg: loaderStill({ c1: PALETTE.blue, c2: PALETTE.ink, id: "sl" }) },
  // lockups (decisions 3A + 4B)
  { file: "weave-lockup-dark.svg",     svg: lockupSvg(PALETTE.cream) },
  { file: "weave-lockup-light.svg",    svg: lockupSvg(PALETTE.ink) },
];

export function build(outDir) {
  mkdirSync(outDir, { recursive: true });
  return VARIANTS.map(({ file, svg }) => {
    writeFileSync(join(outDir, file), svg + "\n");
    return file;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "assets");
  const files = build(out);
  console.log(`wrote ${files.length} assets to ${out}:\n  ` + files.join("\n  "));
}
