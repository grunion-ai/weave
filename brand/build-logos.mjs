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

// Parametric rope, horizontal, centered on (24,24), amplitude 8.
// Strand A starts top, B starts bottom; A is re-drawn over B at odd crossings.
export function rope(n, pitch) {
  const p = pitch, x0 = 24 - (n * p) / 2, yT = 20, yB = 28;
  const seg = (x, yf, yt) => `C${x + p / 2},${yf} ${x + p / 2},${yt} ${x + p},${yt}`;
  let a = `M${x0},${yT}`, b = `M${x0},${yB}`;
  for (let k = 0; k < n; k++) {
    const x = x0 + k * p;
    a += " " + seg(x, k % 2 ? yB : yT, k % 2 ? yT : yB);
    b += " " + seg(x, k % 2 ? yT : yB, k % 2 ? yB : yT);
  }
  const overs = [];
  for (let k = 1; k < n; k += 2) {
    const x = x0 + k * p;
    overs.push(`M${(x + 0.34 * p).toFixed(1)},26.3 Q${x + 0.5 * p},24 ${(x + 0.66 * p).toFixed(1)},21.7`);
  }
  return { a, b, overs };
}

const H3 = rope(3, 8);

const px = n => String(+n.toFixed(2)).replace(/\.0+$/, "");
const stroke = (d, color, w, extra = "") =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${px(w)}" stroke-linecap="round"${extra}/>`;

// The weave body + its two masks. `id` namespaces the masks so several marks
// can share one document.
export function markParts({ c1, c2, sw = 3.5, id = "w" }) {
  const gw = sw + 2.5;
  const region = 'maskUnits="userSpaceOnUse" x="-24" y="-24" width="96" height="96"';
  const defs =
    `<mask id="${id}A" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
    stroke(H3.b, "#000", gw) + `</mask>` +
    `<mask id="${id}B" ${region}><rect x="-24" y="-24" width="96" height="96" fill="#fff"/>` +
    H3.overs.map(o => stroke(o, "#000", gw)).join("") + `</mask>`;
  const body =
    stroke(H3.a, c1, sw, ` mask="url(#${id}A)"`) +
    stroke(H3.b, c2, sw, ` mask="url(#${id}B)"`) +
    H3.overs.map(o => stroke(o, c1, sw)).join("");
  return { defs, body };
}

// A standalone square mark SVG (transparent background).
export function weaveSvg({ c1, c2, sw = 3.5, viewBox = "0 0 48 48" }) {
  const { defs, body } = markParts({ c1, c2, sw });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs>${defs}</defs>${body}</svg>`;
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
