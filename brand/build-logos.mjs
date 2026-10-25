#!/usr/bin/env node

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export { PALETTE, rope, H3, px, stroke, markParts, markPair } from "../src/mark.js";
import { PALETTE, rope, H3, px, stroke, markParts, markPair } from "../src/mark.js";

export const FAVICON_VIEWBOX = "8 8 32 32";

export function weaveSvg({ c1, c2, sw = 3.5, viewBox = "0 0 48 48" }) {
  const { defs, body } = markParts({ c1, c2, sw });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><defs>${defs}</defs>${body}</svg>`;
}

const anim = (attr, values, dur, extra = "") =>
  `<animate attributeName="${attr}" values="${values}" dur="${dur}s" ` +
  `repeatCount="indefinite"${extra}/>`;
const SPLINE = ".45 0 .25 1";
const eased = keyTimes =>
  ` calcMode="spline" keyTimes="${keyTimes.join(";")}" keySplines="` +
  Array(keyTimes.length - 1).fill(SPLINE).join(";") + `"`;

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
    maskOver: d(f => f.overs[0]) + track("stroke-width", t => t * (sw + 2.5)) + track("stroke-opacity", t => t),
  };
  const { defs, body } = markParts({ c1, c2, sw, id, r: frames[0], kids });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" ` +
    `aria-label="Loading"><defs>${defs}</defs>${wrap(body)}</svg>`;
}

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

export function loaderSpin({ c1, c2, sw = 3.5, id = "sp", dur = 2.2 }) {
  const amps = Array.from({ length: 9 }, (_, k) => +(4 * Math.cos((k * Math.PI) / 4)).toFixed(2));
  const keyTimes = amps.map((_, i) => String(+(i / (amps.length - 1)).toFixed(3)));
  return morphLoader({ c1, c2, sw, id, dur, amps, keyTimes, ease: false });
}

export function loaderDraw({ c1, c2, sw = 3.5, id = "dr", dur = 2 }) {
  const draw = anim("stroke-dashoffset", DRAW.offsets.join(";"), dur, eased(DRAW.keyTimes));
  const dash = ` pathLength="100" stroke-dasharray="100 110"`;
  return drawMark({ c1, c2, sw, id, dash, draw });
}

const DRAW = { keyTimes: ["0", ".45", ".62", "1"], offsets: [104, 0, 0, -104] };

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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" ` +
    `aria-label="Loading"><defs>${p.maskA}${p.maskB}</defs>${p.b}${p.a}</svg>`;
}

export const LOADER_CYCLE_MS = 2000;

function bezier(x1, y1, x2, y2) {
  const at = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return x => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; (at(m, x1, x2) < x ? (lo = m) : (hi = m)); }
    return at((lo + hi) / 2, y1, y2);
  };
}
const ease = bezier(...SPLINE.split(" ").map(Number));

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

export function strandPose(s) {
  const j = Math.min(2000, Math.max(0, s * 20)), i = Math.min(1999, Math.floor(j)), f = j - i;
  const [x, y, dx, dy] = ALONG[i].map((v, c) => v + f * (ALONG[i + 1][c] - v));
  return [x, y, Math.atan2(dy, dx) * 180 / Math.PI];
}

export function dashOffset(u) {
  const kt = DRAW.keyTimes.map(Number), o = DRAW.offsets;
  let leg = kt.findIndex((k, i) => i > 0 && u <= k);
  if (leg < 0) leg = kt.length - 1;
  const f = (u - kt[leg - 1]) / (kt[leg] - kt[leg - 1]);
  return o[leg - 1] + (o[leg] - o[leg - 1]) * ease(Math.min(1, Math.max(0, f)));
}

const REACHES = {};
const REACH = sw => REACHES[sw] ??= ALONG.map(([x, , dx, dy]) => [x - sw / 2 * Math.abs(dy) / Math.hypot(dx, dy),
  x + sw / 2 * Math.abs(dy) / Math.hypot(dx, dy)]);

export const ROPE = {
  park: { head: [6, 20, 0], tail: [42, 28, 0] }, whole: { head: 39, tail: 9 },
  tailScale: 0.987, halfWidth: 3.5, unit: 2, clear: 0.05, overlap: 1,
};

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

export function ropeStops(end, { tolerance = 0.03 } = {}) {
  const N = 8000, pts = Array.from({ length: N + 1 }, (_, i) => [i / N, ...ropePose(i / N, end)]);
  const keep = new Set([0, N]);
  const off = (a, b, i) => {
    const t = (pts[i][0] - pts[a][0]) / (pts[b][0] - pts[a][0]);
    const d = k => Math.abs(pts[a][k] + (pts[b][k] - pts[a][k]) * t - pts[i][k]);
    return Math.max(d(1), d(2), d(3), d(4) * Math.PI / 180 * 4);
  };
  const simplify = (a, b) => {
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) { const d = off(a, b, i); if (d > worst) { worst = d; at = i; } }
    if (worst > tolerance) { keep.add(at); simplify(a, at); simplify(at, b); }
  };
  simplify(0, N);
  return [...keep].sort((a, b) => a - b).map(i => pts[i]);
}

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
  const animated = [];
  for (const end of ["head", "tail"]) {
    const stops = ropeStops(end, { sw });
    const set = (name, sel, f) => {
      rules.push(`${sel} { ${run(name)} }`);
      animated.push(sel);
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
  const pose = (+DRAW.keyTimes[1] + +DRAW.keyTimes[2]) / 2;
  const park = `animation-delay: ${n(-pose * LOADER_CYCLE_MS)}ms; animation-play-state: paused;`;
  const still = `@media (prefers-reduced-motion: reduce) {\n`
    + animated.map(sel => `${sel} { ${park} }`).join("\n") + `\n}\n`;
  return rules.join("\n") + "\n" + frames + still;
}

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
    return `<span class="${cls}">` +
      strand("rope-b", svg(p.maskB, `<g transform="matrix(1 0 0 -1 0 48)">${p.b}</g>`)) +
      strand("rope-a", svg(p.maskA, p.a)) + `</span>`;
  };
  return `<style>\n${loaderRopeCss({ sw })}</style>` +
    mark("mark-light", PALETTE.ink, "rl") + mark("mark-dark", PALETTE.sky, "rd");
}

export const LOADER_STATUS_TEXT = "Loading the page";

export function loaderBootHtml({ c1 = PALETTE.blue, sw = 3.5 } = {}) {
  const mark = (cls, c2, id) => `<span class="${cls}">${loaderStill({ c1, c2, sw, id })}</span>`;
  return `<span class="loader-mark" aria-hidden="true">` +
    mark("mark-light", PALETTE.ink, "bl") + mark("mark-dark", PALETTE.sky, "bd") + `</span>` +
    `<span class="loader-status visually-hidden">${LOADER_STATUS_TEXT}</span>`;
}

export const SHELL_LOADER = /<div id="page-loader"[^>]*>[\s\S]*?<\/div>/;

export const SHELL_LOADER_HOST = '<div id="page-loader" class="boot" role="status" aria-hidden="true">';

export function shellWithBootMark(html) {
  if (!SHELL_LOADER.test(html)) throw new Error("the shell has no #page-loader host to fill");
  return html.replace(SHELL_LOADER, SHELL_LOADER_HOST + loaderBootHtml() + "</div>");
}

const MARK_HOST = /(<span data-mark="(\w+)"(?: data-viewbox="([^"]+)")?[^>]*>)[\s\S]*?(<\/span>)/g;
export const fillMarks = (html) =>
  html.replace(MARK_HOST, (all, open, prefix, viewBox, close) => open + markPair(prefix, viewBox ? { viewBox } : {}) + close);
export const MARK_PAGES = ["start.html", "404.html"];

export const LOADERS = {
  travel: { label: "Travel — endless rope through a fading window", fn: loaderTravel },
  twist: { label: "Twist-in — flat strands twist into the mark", fn: loaderTwist },
  spin: { label: "Spin — the rope turns on its long axis", fn: loaderSpin },
  draw: { label: "Weave-on — strands draw in, crossing locks, unweaves", fn: loaderDraw },
};

export function loaderSvg(variant, opts = {}) {
  const l = LOADERS[variant];
  if (!l) throw new Error(`unknown loader variant: ${variant}`);
  return l.fn({ c1: PALETTE.blue, c2: PALETTE.sky, id: variant, ...opts });
}

function appIconSvg() {
  const { defs, body } = markParts({ c1: PALETTE.cream, c2: PALETTE.ice, sw: 4 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${defs}</defs>` +
    `<rect width="512" height="512" rx="115" fill="${PALETTE.blue}"/>` +
    `<g transform="translate(256,256) scale(7.6) translate(-24,-24)">${body}</g></svg>`;
}

const WORDMARK = {
  d: "M28.1 0L18.7 0L0.6-48.3L13.8-48.3L25.6-13.2L21.6-13.1L33.7-48.3L43.2-48.3L55.3-13.1L51.3-13.2L63.1-48.3L76.3-48.3L58.3 0L48.8 0L36.6-33.4L40.3-33.4L28.1 0ZM102.7 1Q95.1 1 89.2-2.25Q83.3-5.5 79.85-11.2Q76.4-16.9 76.4-24.2Q76.4-31.4 79.75-37.05Q83.1-42.7 88.9-46.05Q94.7-49.4 101.8-49.4Q108.8-49.4 114.15-46.25Q119.5-43.1 122.55-37.65Q125.6-32.2 125.6-25.3Q125.6-24 125.45-22.65Q125.3-21.3 124.9-19.6L84.3-19.5L84.3-29.3L118.8-29.4L113.5-25.3Q113.3-29.6 111.95-32.5Q110.6-35.4 108.05-36.95Q105.5-38.5 101.8-38.5Q97.9-38.5 95-36.75Q92.1-35 90.55-31.85Q89-28.7 89-24.4Q89-20 90.65-16.75Q92.3-13.5 95.4-11.75Q98.5-10 102.6-10Q106.3-10 109.3-11.25Q112.3-12.5 114.5-15L122.2-7.3Q118.7-3.2 113.65-1.1Q108.6 1 102.7 1ZM151.9 1Q145.3 1 140-2.3Q134.7-5.6 131.7-11.3Q128.7-17 128.7-24.1Q128.7-31.3 131.7-37Q134.7-42.7 140-46Q145.3-49.3 151.9-49.3Q157.1-49.3 161.2-47.2Q165.3-45.1 167.75-41.35Q170.2-37.6 170.4-32.9L170.4-15.5Q170.2-10.7 167.75-7Q165.3-3.3 161.2-1.15Q157.1 1 151.9 1ZM154.3-11.1Q159.8-11.1 163.2-14.75Q166.6-18.4 166.6-24.2Q166.6-28 165.05-30.95Q163.5-33.9 160.75-35.55Q158-37.2 154.3-37.2Q150.7-37.2 147.95-35.55Q145.2-33.9 143.65-30.95Q142.1-28 142.1-24.2Q142.1-20.3 143.65-17.35Q145.2-14.4 147.95-12.75Q150.7-11.1 154.3-11.1ZM178.9 0L165.9 0L165.9-13L168-24.8L165.9-36.4L165.9-48.3L178.9-48.3L178.9 0ZM213.6 0L204.2 0L182.9-48.3L197.3-48.3L212.6-8.5L205.5-8.5L220.9-48.3L234.8-48.3L213.6 0ZM260.5 1Q252.9 1 247-2.25Q241.1-5.5 237.65-11.2Q234.2-16.9 234.2-24.2Q234.2-31.4 237.55-37.05Q240.9-42.7 246.7-46.05Q252.5-49.4 259.6-49.4Q266.6-49.4 271.95-46.25Q277.3-43.1 280.35-37.65Q283.4-32.2 283.4-25.3Q283.4-24 283.25-22.65Q283.1-21.3 282.7-19.6L242.1-19.5L242.1-29.3L276.6-29.4L271.3-25.3Q271.1-29.6 269.75-32.5Q268.4-35.4 265.85-36.95Q263.3-38.5 259.6-38.5Q255.7-38.5 252.8-36.75Q249.9-35 248.35-31.85Q246.8-28.7 246.8-24.4Q246.8-20 248.45-16.75Q250.1-13.5 253.2-11.75Q256.3-10 260.4-10Q264.1-10 267.1-11.25Q270.1-12.5 272.3-15L280-7.3Q276.5-3.2 271.45-1.1Q266.4 1 260.5 1Z",
  box: [0.6, -49.4, 283.4, 1],
  scale: 0.21,
};
const MARK_INK = [10.25, 18.25, 27.5, 11.5];
const LOCKUP_PAD = 1;
export const LOCKUP_SIZES = { email: { width: 131, height: 24 }, emailScale: 3 };

export function lockupLayout(layout = "inline") {
  const k = WORDMARK.scale, [bx0, by0, bx1, by1] = WORDMARK.box;
  const ww = (bx1 - bx0) * k, wh = (by1 - by0) * k, P = LOCKUP_PAD;
  let s, mark, word, viewBox;
  if (layout === "inline") {
    s = 1.6;
    const mw = MARK_INK[2] * s, mh = MARK_INK[3] * s, inner = Math.max(mh, wh);
    mark = [P, P + (inner - mh) / 2, mw, mh];
    word = [P + mw + 0.6 * wh, P + (inner - wh) / 2, ww, wh];
    viewBox = [0, 0, word[0] + ww + P, inner + 2 * P];
  } else if (layout === "stacked") {
    s = 0.75 * ww / MARK_INK[2];
    const mw = MARK_INK[2] * s, mh = MARK_INK[3] * s, W = Math.max(ww, mw) + 2 * P;
    mark = [(W - mw) / 2, P, mw, mh];
    word = [(W - ww) / 2, P + mh + 0.5 * wh, ww, wh];
    viewBox = [0, 0, W, word[1] + wh + P];
  } else throw new Error(`unknown lockup layout: ${layout}`);
  return { s, k, mark, word, viewBox };
}

export function lockupSvg(textColor, { c1 = PALETTE.blue, c2 = PALETTE.sky, layout = "inline", id = "w" } = {}) {
  const { s, k, mark, word, viewBox } = lockupLayout(layout);
  const { defs, body } = markParts({ c1, c2, sw: 3.5, id });
  const [, , vw, vh] = viewBox;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox.map(px).join(" ")}" ` +
    `width="${Math.round(vw * 2)}" height="${Math.round(vh * 2)}" role="img" aria-label="weave"><defs>${defs}</defs>` +
    `<g transform="translate(${px(mark[0] - MARK_INK[0] * s)} ${px(mark[1] - MARK_INK[1] * s)}) scale(${px(s)})">${body}</g>` +
    `<path d="${WORDMARK.d}" fill="${textColor}" ` +
    `transform="translate(${px(word[0] - WORDMARK.box[0] * k)} ${px(word[1] - WORDMARK.box[1] * k)}) scale(${k})"/></svg>`;
}

export const VARIANTS = [
  { file: "weave-mark-dark.svg",       svg: weaveSvg({ c1: PALETTE.blue, c2: PALETTE.sky }), served: true },
  { file: "weave-mark-light.svg",      svg: weaveSvg({ c1: PALETTE.blue, c2: PALETTE.ink }), served: true },
  { file: "weave-mark-mono-blue.svg",  svg: weaveSvg({ c1: PALETTE.blue, c2: PALETTE.blue }) },
  { file: "weave-mark-mono-cream.svg", svg: weaveSvg({ c1: PALETTE.cream, c2: PALETTE.cream }) },
  { file: "weave-mark-white.svg",      svg: weaveSvg({ c1: PALETTE.white, c2: PALETTE.white }) },
  { file: "weave-favicon.svg",         svg: weaveSvg({ c1: PALETTE.blue, c2: PALETTE.blue, sw: 4.5, viewBox: FAVICON_VIEWBOX }), served: true },
  { file: "weave-app-icon.svg",        svg: appIconSvg() },
  { file: "weave-loader-dark.svg",     svg: loaderSvg("draw", { c1: PALETTE.blue, c2: PALETTE.sky, id: "ld" }) },
  { file: "weave-loader-light.svg",    svg: loaderSvg("draw", { c1: PALETTE.blue, c2: PALETTE.ink, id: "ll" }) },
  { file: "weave-lockup-dark.svg",     svg: lockupSvg(PALETTE.cream) },
  { file: "weave-lockup-light.svg",    svg: lockupSvg(PALETTE.ink, { c2: PALETTE.ink }) },
  { file: "weave-lockup-stacked-dark.svg",  svg: lockupSvg(PALETTE.cream, { layout: "stacked" }) },
  { file: "weave-lockup-stacked-light.svg", svg: lockupSvg(PALETTE.ink, { c2: PALETTE.ink, layout: "stacked" }) },
  { file: "weave-lockup-email-light.svg", svg: lockupSvg(PALETTE.ink, { c2: PALETTE.ink }) },
  { file: "weave-lockup-email-dark.svg",  svg: lockupSvg("#eef2f8", { c1: "#3b82f6" }) },
];

export function build(assetsDir, servedDir = assetsDir, shellFile = "") {
  const written = [];
  const put = (dir, file, text) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), text + "\n");
    written.push(join(dir, file));
  };
  for (const { file, svg, served } of VARIANTS) put(served ? servedDir : assetsDir, file, svg);
  put(servedDir, "weave-loader-rope.html", loaderRopeHtml());
  if (shellFile) {
    writeFileSync(shellFile, shellWithBootMark(readFileSync(shellFile, "utf8")));
    written.push(shellFile);
  }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const assets = process.argv[2] || join(here, "assets");
  const served = process.argv[3] || join(here, "..", "public", "brand");
  const shell = process.argv[4] || join(here, "..", "public", "index.html");
  const files = build(assets, served, shell);
  for (const page of MARK_PAGES) {
    const file = join(here, "..", "public", page);
    writeFileSync(file, fillMarks(readFileSync(file, "utf8")));
    files.push(file);
  }
  console.log(`wrote ${files.length} files:\n  ` + files.join("\n  "));
}
