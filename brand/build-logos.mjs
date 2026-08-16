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

export const PALETTE = {
  blue: "#2563eb",   // brand primary
  sky: "#60a5fa",    // accent (dark-mode secondary strand)
  ink: "#0c1b33",    // light-mode secondary strand (decision 5B)
  cream: "#e0dcd4",
  ice: "#bcd3ff",    // app-icon secondary strand on blue
  white: "#ffffff",
};

// Parametric rope, horizontal, centered on (24,24), half-amplitude `amp`.
// Strand A starts top, B starts bottom; A is re-drawn over B at odd crossings.
// `amp` is a knob for animation only: every amplitude emits the SAME path
// command sequence, so two ropes can be interpolated with <animate d>.
// amp 0 = both strands flat on the centerline; amp < 0 = strands swapped.
export function rope(n, pitch, amp = 4) {
  const p = pitch, x0 = 24 - (n * p) / 2, yT = 24 - amp, yB = 24 + amp;
  const seg = (x, yf, yt) => `C${x + p / 2},${yf} ${x + p / 2},${yt} ${x + p},${yt}`;
  let a = `M${x0},${yT}`, b = `M${x0},${yB}`;
  for (let k = 0; k < n; k++) {
    const x = x0 + k * p;
    a += " " + seg(x, k % 2 ? yB : yT, k % 2 ? yT : yB);
    b += " " + seg(x, k % 2 ? yT : yB, k % 2 ? yB : yT);
  }
  const overs = [];
  for (let k = 1; k < n; k += 2) {
    const x = x0 + k * p, o = 0.575 * amp;
    overs.push(`M${(x + 0.34 * p).toFixed(1)},${(24 + o).toFixed(1)} ` +
      `Q${x + 0.5 * p},24 ${(x + 0.66 * p).toFixed(1)},${(24 - o).toFixed(1)}`);
  }
  return { a, b, overs };
}

const H3 = rope(3, 8);

const px = n => String(+n.toFixed(2)).replace(/\.0+$/, "");
const stroke = (d, color, w, extra = "", kids = "") =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${px(w)}" stroke-linecap="round"${extra}` +
  (kids ? `>${kids}</path>` : `/>`);

// The weave body + its two masks. `id` namespaces the masks so several marks
// can share one document. `r` is any rope() result (default: the h3 mark);
// `kids` injects SMIL children into the matching element (see loaders below).
export function markParts({ c1, c2, sw = 3.5, id = "w", r = H3, kids = {} }) {
  const gw = sw + 2.5;
  const region = 'maskUnits="userSpaceOnUse" x="-24" y="-24" width="96" height="96"';
  const defs =
    `<mask id="${id}A" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
    stroke(r.b, "#000", gw, "", kids.maskB || "") + `</mask>` +
    `<mask id="${id}B" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
    r.overs.map(o => stroke(o, "#000", gw, "", kids.maskOver || "")).join("") + `</mask>`;
  const body =
    stroke(r.a, c1, sw, ` mask="url(#${id}A)"`, kids.a || "") +
    stroke(r.b, c2, sw, ` mask="url(#${id}B)"`, kids.b || "") +
    r.overs.map(o => stroke(o, c1, sw, "", kids.over || "")).join("");
  return { defs, body };
}

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
const eased = keyTimes =>
  ` calcMode="spline" keyTimes="${keyTimes.join(";")}" keySplines="` +
  Array(keyTimes.length - 1).fill(".45 0 .25 1").join(";") + `"`;

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
  const kt = ["0", ".45", ".62", "1"];
  // pathLength normalizes both strands to 100 so they draw at the same rate.
  // The off-gap (110) must exceed offset + pathLength (104 + 100 = 204 across
  // the pattern), or the dash wraps at the far end and a round cap paints a
  // stray dot there on the hidden frames.
  const draw = anim("stroke-dashoffset", "104;0;0;-104", dur, eased(kt));
  const dash = ` pathLength="100" stroke-dasharray="100 110"`;
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
