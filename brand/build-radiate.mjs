#!/usr/bin/env node
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, H3, markParts } from "../src/mark.js";

export const SIZES = { "half-letter": { width: 816, height: 528 }, "4k": { width: 3840, height: 2160 } };

export const RADIATE = { ...SIZES["half-letter"], scale: 10, pitch: 16, weight: 3.8, clear: 39 };

export const THEMES = {
  dark: { bg: "#0f1115", line: PALETTE.sky, opacity: 0.5, c1: PALETTE.blue, c2: PALETTE.sky },
  light: { bg: PALETTE.white, line: PALETTE.blue, opacity: 0.4, c1: PALETTE.blue, c2: PALETTE.ink },
};

const { scale } = RADIATE;
const GRID = 0.25, MARGIN = 16;
const origin = ({ width, height }) => [width / 2 - 24 * scale, height / 2 - 24 * scale];

function cubics(d) {
  const n = d.match(/-?\d+(\.\d+)?/g).map(Number), segs = [];
  for (let i = 2; i < n.length; i += 6) segs.push([n[i - 2], n[i - 1], ...n.slice(i, i + 6)]);
  return segs;
}

function samples(d, steps = 120) {
  const pts = [];
  for (const [x0, y0, x1, y1, x2, y2, x3, y3] of cubics(d)) {
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      pts.push([a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3]);
    }
  }
  return pts;
}

function lens() {
  const back = cubics(H3.b).reverse().map(([x0, y0, x1, y1, x2, y2]) => `C${x2},${y2} ${x1},${y1} ${x0},${y0}`);
  const [ex, ey] = H3.b.match(/-?\d+(\.\d+)?/g).slice(-2);
  return `${H3.a} L${ex},${ey} ${back.join(" ")} Z`;
}

function grid(size) {
  const { width, height } = size, [OX, OY] = origin(size);
  const x0 = -OX / scale - MARGIN, y0 = -OY / scale - MARGIN;
  const nx = Math.ceil((width / scale + 2 * MARGIN) / GRID) + 1, ny = Math.ceil((height / scale + 2 * MARGIN) / GRID) + 1;
  return { x0, y0, nx, ny };
}

function distance(g, pts) {
  const d = new Float32Array(g.nx * g.ny);
  for (let j = 0; j < g.ny; j++) {
    const y = g.y0 + j * GRID;
    for (let i = 0; i < g.nx; i++) {
      const x = g.x0 + i * GRID;
      let m = Infinity;
      for (const [px, py] of pts) {
        const q = (x - px) ** 2 + (y - py) ** 2;
        if (q < m) m = q;
      }
      d[j * g.nx + i] = Math.sqrt(m);
    }
  }
  return d;
}

function blur(g, src, sigmaUnits) {
  const sig = sigmaUnits / GRID, r = Math.ceil(sig * 3), ker = [];
  for (let k = -r; k <= r; k++) ker.push(Math.exp(-k * k / (2 * sig * sig)));
  const total = ker.reduce((a, b) => a + b);
  const w = ker.map(v => v / total), { nx, ny } = g;
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const clamp = (v, hi) => v < 0 ? 0 : v > hi ? hi : v;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += w[k + r] * src[j * nx + clamp(i + k, nx - 1)];
    tmp[j * nx + i] = s;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += w[k + r] * tmp[clamp(j + k, ny - 1) * nx + i];
    out[j * nx + i] = s;
  }
  return out;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function field(size = SIZES["half-letter"]) {
  const g = grid(size), d = distance(g, [...samples(H3.a), ...samples(H3.b)]);
  const steps = [[1.4, 1.8, 3.2], [2.2, 3.5, 7], [2.5, 7, 16], [5, 16, 30]].map(([s, a, b]) => [blur(g, d, s), a, b]);
  const f = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) {
    let v = d[i];
    for (const [b, lo, hi] of steps) v += (b[i] - v) * smooth(lo, hi, d[i]);
    f[i] = v;
  }
  return { ...g, f };
}

function contour(F, level, [OX, OY]) {
  const { nx, ny, f } = F, pts = new Map(), links = new Map();
  const H = (i, j) => j * nx + i, V = (i, j) => nx * ny + j * nx + i;
  const at = (key, ax, ay, bx, by, va, vb) => {
    if (!pts.has(key)) { const t = (level - va) / (vb - va); pts.set(key, [ax + (bx - ax) * t, ay + (by - ay) * t]); }
    return key;
  };
  const link = (a, b) => {
    (links.get(a) || links.set(a, []).get(a)).push(b);
    (links.get(b) || links.set(b, []).get(b)).push(a);
  };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const v0 = f[j * nx + i], v1 = f[j * nx + i + 1], v2 = f[(j + 1) * nx + i + 1], v3 = f[(j + 1) * nx + i];
    const code = (v0 > level) | (v1 > level) << 1 | (v2 > level) << 2 | (v3 > level) << 3;
    if (code === 0 || code === 15) continue;
    const top = (v0 > level) !== (v1 > level) ? at(H(i, j), i, j, i + 1, j, v0, v1) : null;
    const right = (v1 > level) !== (v2 > level) ? at(V(i + 1, j), i + 1, j, i + 1, j + 1, v1, v2) : null;
    const bottom = (v3 > level) !== (v2 > level) ? at(H(i, j + 1), i, j + 1, i + 1, j + 1, v3, v2) : null;
    const left = (v0 > level) !== (v3 > level) ? at(V(i, j), i, j, i, j + 1, v0, v3) : null;
    const hits = [top, right, bottom, left].filter(k => k !== null);
    if (hits.length === 2) { link(hits[0], hits[1]); continue; }
    const above = (v0 + v1 + v2 + v3) / 4 > level;
    if ((code === 5) === above) { link(top, right); link(bottom, left); }
    else { link(left, top); link(right, bottom); }
  }
  const seen = new Set(), lines = [];
  const walk = start => {
    const line = [start];
    seen.add(start);
    let cur = start;
    for (;;) {
      const next = (links.get(cur) || []).find(k => !seen.has(k));
      if (next === undefined) break;
      seen.add(next); line.push(next); cur = next;
    }
    if ((links.get(cur) || []).includes(start) && line.length > 2) line.push(start);
    return line;
  };
  for (const [k, v] of links) if (v.length === 1 && !seen.has(k)) lines.push(walk(k));
  for (const k of links.keys()) if (!seen.has(k)) lines.push(walk(k));
  return lines.map(l => l.map(k => {
    const [gi, gj] = pts.get(k);
    return [OX + (F.x0 + gi * GRID) * scale, OY + (F.y0 + gj * GRID) * scale];
  }));
}

function clip(line, { width, height }, pad = RADIATE.weight * 2) {
  const inside = ([x, y]) => x > -pad && x < width + pad && y > -pad && y < height + pad;
  const runs = [];
  let run = [];
  for (const p of line) {
    if (inside(p)) { run.push(p); continue; }
    if (run.length > 1) runs.push(run);
    run = [];
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

const cached = new Map();
export function rings(size = SIZES["half-letter"]) {
  if (cached.has(size)) return cached.get(size);
  const F = field(size), far = Math.hypot(size.width, size.height) / scale, o = origin(size);
  const out = [];
  for (let level = RADIATE.clear / scale; level < far; level += RADIATE.pitch / scale) {
    for (const line of contour(F, level, o)) out.push(...clip(line, size));
  }
  cached.set(size, out);
  return out;
}

function simplify(line, tol = 0.12) {
  if (line.length < 3) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = line[a], [bx, by] = line[b], len = Math.hypot(bx - ax, by - ay);
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const dist = len < 1e-9 ? Math.hypot(line[i][0] - ax, line[i][1] - ay)
        : Math.abs((bx - ax) * (ay - line[i][1]) - (ax - line[i][0]) * (by - ay)) / len;
      if (dist > worst) { worst = dist; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

const num = n => String(Math.round(n * 10) / 10);

export function radiateSvg(theme = "dark", size = SIZES["half-letter"]) {
  const { width, height } = size, [OX, OY] = origin(size), t = THEMES[theme], { defs, body } = markParts({ c1: t.c1, c2: t.c2, id: "r" });
  const paths = rings(size).map(l => `<path d="M${simplify(l).map(([x, y]) => `${num(x)} ${num(y)}`).join("L")}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<rect width="${width}" height="${height}" fill="${t.bg}"/>` +
    `<g fill="none" stroke="${t.line}" stroke-opacity="${t.opacity}" stroke-width="${RADIATE.weight}" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    `<g transform="translate(${OX},${OY}) scale(${scale})"><defs>${defs}</defs><path d="${lens()}" fill="${t.bg}"/>${body}</g></svg>`;
}

export const FILES = { dark: "weave-radiate-half-letter-dark.svg", light: "weave-radiate-half-letter-light.svg" };

export const STAGE = { size: SIZES["4k"], files: { dark: "weave-radiate-dark.svg", light: "weave-radiate-light.svg" } };

export function build(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [theme, file] of Object.entries(FILES)) writeFileSync(join(dir, file), radiateSvg(theme));
}

export function buildStage(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [theme, file] of Object.entries(STAGE.files)) writeFileSync(join(dir, file), radiateSvg(theme, STAGE.size));
}

async function render(dir) {
  const { width, height } = SIZES["half-letter"];
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2550 / width });
  for (const [theme, file] of Object.entries(FILES)) {
    const svg = radiateSvg(theme), base = join(dir, file.replace(/\.svg$/, ""));
    await page.setContent(`<style>@page{size:8.5in 5.5in;margin:0}*{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({ path: `${base}.png` });
    await page.pdf({ path: `${base}.pdf`, width: "8.5in", height: "5.5in", printBackground: true, pageRanges: "1" });
    console.log(`rendered ${base}.{png,pdf}`);
  }
  await browser.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = dirname(fileURLToPath(import.meta.url)), dir = join(root, "assets", "marketing");
  build(dir);
  buildStage(join(root, "..", "public", "brand"));
  if (process.argv.includes("--render")) await render(dir);
}
