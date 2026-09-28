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
// dash and no SMIL. The app shows each strand of it through windows the
// compositor moves (loaderRopeHtml, loaderRopeCss), because Chrome and Safari
// tick SMIL on the main thread and the rope froze whenever the page was busy.
export function loaderStill({ c1, c2, sw = 3.5, id = "st" }) {
  return drawMark({ c1, c2, sw, id });
}

function drawParts({ c1, c2, sw, id, dash = "", draw = "" }) {
  const gw = sw + 2.5;
  const region = 'maskUnits="userSpaceOnUse" x="-24" y="-24" width="96" height="96"';
  const white = H3.overs.map(o => stroke(o, "#fff", gw)).join("");
  return {
    maskA: `<mask id="${id}A" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
      stroke(H3.b, "#000", gw) + white + `</mask>`,
    maskB: `<mask id="${id}B" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
      H3.overs.map(o => stroke(o, "#000", gw)).join("") + `</mask>`,
    a: stroke(H3.a, c1, sw, ` mask="url(#${id}A)"` + dash, draw),
    b: stroke(H3.b, c2, sw, ` mask="url(#${id}B)"` + dash, draw),
  };
}

function drawMark(opts) {
  const p = drawParts(opts);
  // B first, so A can pass over it where the mask restored the crossing.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" ` +
    `aria-label="Loading"><defs>${p.maskA}${p.maskB}</defs>${p.b}${p.a}</svg>`;
}

// The shipped loaders run at this period. The UI imports the number (via the
// data-cycle attribute it is stamped into) so "let it finish one cycle" is one
// fact, not two that can drift.
export const LOADER_CYCLE_MS = 2000;

// ---------------------------------------------------------------------------
// The compositor rope (Issue #390). The weave-on dash paints each strand from
// a tail to a head, both with round caps. The app shows the same thing with
// the still strands and no dash: each end of the dash is an anchor holding
// windows onto a copy of the strand (see loaderRopeCss), and each copy moves
// by the inverse of its windows so the strand stays put. Everything moves by
// translate and rotate only, which Chrome and Safari animate on the
// compositor, so the rope keeps moving while the main thread is busy. Strand
// B is strand A mirrored about y = 24, so B reuses A's keyframes inside a
// static flip.
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

// Strand A by arc length: [x, y, dx, dy] at each 1/2000 of its length, so
// pathLength position s (0..100) is index s * 20. dx, dy is the Bezier's own
// derivative, so the tangent at the ends is exactly the mark's (flat).
const ALONG = (() => {
  const n = H3.a.match(/-?[\d.]+/g).map(Number);
  const pts = [];
  for (let i = 2; i < n.length; i += 6) {
    const [x0, y0] = i === 2 ? [n[0], n[1]] : [n[i - 2], n[i - 1]];
    const P = [[x0, y0], [n[i], n[i + 1]], [n[i + 2], n[i + 3]], [n[i + 4], n[i + 5]]];
    for (let k = i === 2 ? 0 : 1; k <= 400; k++) {
      const t = k / 400, u = 1 - t;
      const at = c => u ** 3 * P[0][c] + 3 * u * u * t * P[1][c] + 3 * u * t * t * P[2][c] + t ** 3 * P[3][c];
      const d = c => 3 * (u * u * (P[1][c] - P[0][c]) + 2 * u * t * (P[2][c] - P[1][c]) + t * t * (P[3][c] - P[2][c]));
      pts.push([at(0), at(1), d(0), d(1)]);
    }
  }
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1];
  let i = 1;
  return Array.from({ length: 2001 }, (_, j) => {
    const want = (j / 2000) * total;
    while (i < len.length - 1 && len[i] < want) i++;
    const f = Math.min(1, Math.max(0, (want - len[i - 1]) / (len[i] - len[i - 1])));
    return pts[i - 1].map((v, c) => v + f * (pts[i][c] - v));
  });
})();

// Point and direction (degrees, y down) of strand A at pathLength position s.
export function strandPose(s) {
  const j = Math.min(2000, Math.max(0, s * 20)), i = Math.min(1999, Math.floor(j)), f = j - i;
  const [x, y, dx, dy] = ALONG[i].map((v, c) => v + f * (ALONG[i + 1][c] - v));
  return [x, y, Math.atan2(dy, dx) * 180 / Math.PI];
}

// The weave-on dash offset at cycle phase u (0..1).
export function dashOffset(u) {
  const kt = DRAW.keyTimes.map(Number), o = DRAW.offsets;
  let leg = kt.findIndex((k, i) => i > 0 && u <= k);
  if (leg < 0) leg = kt.length - 1;
  const f = (u - kt[leg - 1]) / (kt[leg] - kt[leg - 1]);
  return o[leg - 1] + (o[leg] - o[leg - 1]) * ease(Math.min(1, Math.max(0, f)));
}

// How far right (+) or left (-) of its centreline the stroke reaches at each
// sample, so a vertical line can be kept clear of every part of the strand
// ahead of the head (or behind the tail).
const REACHES = {};
const REACH = sw => REACHES[sw] ??= ALONG.map(([x, , dx, dy]) => [x - sw / 2 * Math.abs(dy) / Math.hypot(dx, dy),
  x + sw / 2 * Math.abs(dy) / Math.hypot(dx, dy)]);

// Where an end waits when it is not on screen: clear of the strand's caps
// (x 10.25 to 37.75) and of its own cap disc (1.75 units), so its windows
// show nothing.
//
// tailScale: Chromium places the dash on an arc length about 1.3% longer than
// the path's, so its unweave trails the geometry and ends on the two end dots,
// which it keeps until the dash start passes s = 100 / 0.987 = 101.3 (measured
// 2026-09-28: a dot at offset -101.2, none at -101.4). Those dots are the old
// rope's last frames, so the tail follows the same scale. The draw-in and the
// rest pose keep the exact geometry, where WebKit's old rope matches it.
//
// halfWidth: how far across the strand the square cut at an end reaches, in
// units: past the stroke (1.75) and its bend near the end, short of the
// strand's other passes, which lie 8 units or more away.
//
// whole: at rest, and at the unweave's first instant, an end shows the whole
// strand through its far-side window alone (the line at x = whole), with the
// square cut and the cap parked off the strand, so the rest frame is the still
// mark itself.
//
// overlap: the near-side column reaches this many px past x = e into the far
// side. Abutting windows leave a hairline between them in WebKit; the overlap
// only ever holds strand the dash has drawn, so it never shows anything new.
export const ROPE = {
  park: { head: [6, 20, 0], tail: [42, 28, 0] }, whole: { head: 39, tail: 9 },
  tailScale: 0.987, halfWidth: 3.5, unit: 2, clear: 0.05, overlap: 1,
};

// One end of the dash at phase u, in strand A's frame: [e, x, y, deg]. (x, y)
// is the end's point on the centreline and deg its direction; e is the x of the
// vertical line the rest of the strand is shown up to (head) or from (tail).
export function ropePose(u, end, sw = 3.5) {
  const unweave = +DRAW.keyTimes[2], o = dashOffset(u), reach = REACH(sw);
  if (end === "head") {
    const s = 100 - o;
    if (u >= unweave || s <= 0) { const [x, y, a] = ROPE.park.head; return [x, x, y, a]; }
    if (s >= 100) return [ROPE.whole.head, ...ROPE.park.tail];
    const j = Math.round(Math.min(s, 100) * 20);
    let e = Infinity;
    for (let k = j; k <= 2000; k++) e = Math.min(e, reach[k][0]);
    return [Math.min(e, strandPose(s)[0]) - ROPE.clear, ...strandPose(Math.min(s, 100))];
  }
  const s = -o * ROPE.tailScale;
  if (u < unweave || s >= 100) { const [x, y, a] = ROPE.park.tail; return [x, x, y, a]; }
  if (s <= 0) return [ROPE.whole.tail, ...ROPE.park.head];
  const j = Math.round(Math.min(s, 100) * 20);
  let e = -Infinity;
  for (let k = 0; k <= j; k++) e = Math.max(e, reach[k][1]);
  return [Math.max(e, strandPose(Math.min(s, 100))[0]) + ROPE.clear, ...strandPose(Math.min(s, 100))];
}

// Keyframes for one end: [phase, e, x, y, deg] stops, linear between, as few
// as keep every frame within `tolerance` units of the exact pose (a turn is
// weighed at 4 units of lever).
export function ropeStops(end, { tolerance = 0.03 } = {}) {
  const N = 8000, pts = Array.from({ length: N + 1 }, (_, i) => [i / N, ...ropePose(i / N, end)]);
  const keep = new Set([0, N]);
  const off = (a, b, i) => {
    const t = (pts[i][0] - pts[a][0]) / (pts[b][0] - pts[a][0]);
    const d = k => Math.abs(pts[a][k] + (pts[b][k] - pts[a][k]) * t - pts[i][k]);
    return Math.max(d(1), d(2), d(3), d(4) * Math.PI / 180 * 4);
  };
  const simplify = (a, b) => { // Ramer-Douglas-Peucker on the phase axis
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) { const d = off(a, b, i); if (d > worst) { worst = d; at = i; } }
    if (worst > tolerance) { keep.add(at); simplify(a, at); simplify(at, b); }
  };
  simplify(0, N);
  return [...keep].sort((a, b) => a - b).map(i => pts[i]);
}

// The CSS for the rope. Each end is an anchor (.rope-head, .rope-tail) at
// (e, 0) holding three windows onto a copy of the strand:
//   .rope-v   everything on the far side of x = e (translate only);
//   .rope-n > .rope-tip > .rope-p   the near side of x = e, cut square to the
//             strand at the end's point, ROPE.halfWidth either side of it
//             (translate + rotate);
//   .rope-disc > .rope-c   the round cap, a disc on the end's point.
// Each copy (.rope-in) moves by the inverse of everything above it, so the
// strand stays put and only what is shown changes. The box is 96px,
// ROPE.unit px to the viewBox unit.
export function loaderRopeCss({ sw = 3.5 } = {}) {
  const U = ROPE.unit, r = sw / 2 * U, h = ROPE.halfWidth * U, ov = ROPE.overlap, n = v => String(+(+v).toFixed(3)), B = 400;
  const run = name => `animation: ${name} ${LOADER_CYCLE_MS}ms linear infinite;`;
  const rules = [
    `.rope-a, .rope-b { position: absolute; inset: 0; }`,
    `.rope-b { transform: scaleY(-1); }`,
    `.rope-head, .rope-tail, .rope-tip, .rope-disc { position: absolute; left: 0; top: 0; width: 0; height: 0; transform-origin: 0 0; }`,
    `.rope-v, .rope-n, .rope-p, .rope-c { position: absolute; overflow: hidden; }`,
    `.rope-v, .rope-n, .rope-p { top: -${B}px; width: ${B}px; height: ${2 * B}px; }`,
    `.rope-p { top: -${n(h)}px; height: ${n(2 * h)}px; }`,
    `.rope-head > .rope-v, .rope-tail > .rope-n, .rope-head .rope-p { left: -${B}px; }`,
    `.rope-tail > .rope-v, .rope-head > .rope-n, .rope-tail .rope-p { left: 0; }`,
    `.rope-n > .rope-tip { top: ${B}px; }`,
    `.rope-head > .rope-n { left: -${ov}px; width: ${B + ov}px; }`,
    `.rope-head > .rope-n > .rope-tip { left: ${ov}px; }`,
    `.rope-tail > .rope-n { width: ${B + ov}px; }`,
    `.rope-tail > .rope-n > .rope-tip { left: ${B}px; }`,
    `.rope-c { left: -${n(r)}px; top: -${n(r)}px; width: ${n(2 * r)}px; height: ${n(2 * r)}px; border-radius: 50%; }`,
    `.rope-in { position: absolute; top: ${B}px; width: ${48 * U}px; height: ${48 * U}px; transform-origin: 0 0; }`,
    `.rope-in svg { width: 100%; height: 100%; display: block; }`,
    `.rope-head > .rope-v > .rope-in, .rope-head .rope-p > .rope-in { left: ${B}px; }`,
    `.rope-tail > .rope-v > .rope-in, .rope-tail .rope-p > .rope-in { left: 0; }`,
    `.rope-p > .rope-in { top: ${n(h)}px; }`,
    `.rope-c > .rope-in { left: ${n(r)}px; top: ${n(r)}px; }`,
  ];
  let frames = "";
  for (const end of ["head", "tail"]) {
    const stops = ropeStops(end, { sw });
    const set = (name, sel, f) => {
      rules.push(`${sel} { ${run(name)} }`);
      frames += `@keyframes ${name} {\n` + stops.map(([u, e, x, y, a]) => {
        const [E, D, Y] = [e * U, (x - e) * U, y * U];
        return `  ${n(u * 100)}% { transform: ${f(n(E), n(D), n(Y), n(a))}; }\n`;
      }).join("") + `}\n`;
    };
    const neg = v => n(-v);
    set(`rope-${end}`, `.rope-${end}`, E => `translate(${E}px, 0px)`);
    set(`rope-${end}-v`, `.rope-${end} > .rope-v > .rope-in`, E => `translate(${neg(E)}px, 0px)`);
    set(`rope-${end}-tip`, `.rope-${end} .rope-tip`, (E, D, Y, A) => `translate(${D}px, ${Y}px) rotate(${A}deg)`);
    set(`rope-${end}-p`, `.rope-${end} .rope-p > .rope-in`,
      (E, D, Y, A) => `rotate(${neg(A)}deg) translate(${neg(D)}px, ${neg(Y)}px) translate(${neg(E)}px, 0px)`);
    set(`rope-${end}-disc`, `.rope-${end} > .rope-disc`, (E, D, Y) => `translate(${D}px, ${Y}px)`);
    set(`rope-${end}-c`, `.rope-${end} .rope-c > .rope-in`,
      (E, D, Y) => `translate(${neg(D)}px, ${neg(Y)}px) translate(${neg(E)}px, 0px)`);
  }
  return rules.join("\n") + "\n" + frames;
}

// The loader the app inlines, both themes and the CSS in one fragment. Strand
// B's SVG is drawn flipped so the .rope-b flip rights it, which lets B's ends
// reuse A's keyframes.
export function loaderRopeHtml({ c1 = PALETTE.blue, sw = 3.5 } = {}) {
  const mark = (cls, c2, id) => {
    const p = drawParts({ c1, c2, sw, id });
    const svg = (mask, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true">` +
      `<defs>${mask}</defs>${body}</svg>`;
    const strand = (sc, art) => {
      const copy = `<span class="rope-in">${art}</span>`;
      const end = e => `<span class="rope-${e}"><span class="rope-v">${copy}</span>` +
        `<span class="rope-n"><span class="rope-tip"><span class="rope-p">${copy}</span></span></span>` +
        `<span class="rope-disc"><span class="rope-c">${copy}</span></span></span>`;
      return `<span class="${sc}">${end("head")}${end("tail")}</span>`;
    };
    // B first, so A passes over it where mask A restored the crossing.
    return `<span class="${cls}">` +
      strand("rope-b", svg(p.maskB, `<g transform="matrix(1 0 0 -1 0 48)">${p.b}</g>`)) +
      strand("rope-a", svg(p.maskA, p.a)) + `</span>`;
  };
  return `<style>\n${loaderRopeCss({ sw })}</style>` +
    mark("mark-light", PALETTE.ink, "rl") + mark("mark-dark", PALETTE.sky, "rd");
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
  // lockups (decisions 3A + 4B)
  { file: "weave-lockup-dark.svg",     svg: lockupSvg(PALETTE.cream) },
  { file: "weave-lockup-light.svg",    svg: lockupSvg(PALETTE.ink) },
];

export function build(outDir) {
  mkdirSync(outDir, { recursive: true });
  const files = VARIANTS.map(({ file, svg }) => {
    writeFileSync(join(outDir, file), svg + "\n");
    return file;
  });
  // The app's loader (Issue #390): both themes' rope at rest in compositor
  // windows, with its CSS. Copy it to public/brand/.
  writeFileSync(join(outDir, "weave-loader-rope.html"), loaderRopeHtml() + "\n");
  return [...files, "weave-loader-rope.html"];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "assets");
  const files = build(out);
  console.log(`wrote ${files.length} assets to ${out}:\n  ` + files.join("\n  "));
}
