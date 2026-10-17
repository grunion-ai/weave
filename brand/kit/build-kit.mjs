import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : HERE;
const SVG_DIR = join(OUT, 'svg');
mkdirSync(SVG_DIR, { recursive: true });

const C = {
  blue: '#2563eb', sky: '#60a5fa', ink: '#0c1b33', cream: '#e0dcd4', ice: '#bcd3ff',
  canvasL: '#eceff3', panelL: '#ffffff', sunkL: '#e2e6ec', divL: '#d9dee6',
  canvasD: '#0f1115', panelD: '#181b21', sunkD: '#222731', divD: '#2a2f38',
};

const THEMES = {
  light: { a: C.blue, b: C.ink, gap: C.panelL, fill: C.sunkL, soft: C.divL },
  dark: { a: C.blue, b: C.sky, gap: C.panelD, fill: C.sunkD, soft: C.divD },
};

const LABELS = JSON.parse(readFileSync(join(HERE, 'labels.json'), 'utf8'));

const f = (n) => +n.toFixed(1);
const stroke = (c, w, extra = '') => `style="fill:none;stroke:${c};stroke-width:${w};stroke-linecap:round;stroke-linejoin:round${extra}"`;
const fill = (c) => `style="fill:${c};stroke:none"`;
const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img"><title>${title}</title>${body}</svg>`;

const line = (x0, y0, x1, y1) => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = [-(y1 - y0) / len, (x1 - x0) / len];
  return { p: (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t], n: () => n };
};
const circle = (cx, cy, r) => ({
  p: (t) => [cx + r * Math.cos(2 * Math.PI * t - Math.PI / 2), cy + r * Math.sin(2 * Math.PI * t - Math.PI / 2)],
  n: (t) => [Math.cos(2 * Math.PI * t - Math.PI / 2), Math.sin(2 * Math.PI * t - Math.PI / 2)],
});

function strandPts(base, amp, half, sgn, phase, t0, t1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + (t1 - t0) * (i / steps);
    const [x, y] = base.p(t);
    const [nx, ny] = base.n(t);
    const o = sgn * amp * Math.sin(Math.PI * half * t + phase);
    pts.push([x + nx * o, y + ny * o]);
  }
  return pts;
}
const pathD = (pts, closed) => 'M' + pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' L') + (closed ? ' Z' : '');

function woven(base, { amp, half, w, a, b, gap, closed = false, gapScale = 0.5 }) {
  const phase = closed ? 0 : Math.PI / 2;
  const steps = Math.max(60, half * 12);
  const strands = [[a, 1], [b, -1]];
  let out = strands.map(([c, s]) => `<path d="${pathD(strandPts(base, amp, half, s, phase, 0, 1, steps), closed)}" ${stroke(c, w)}/>`).join('');
  const ts = closed ? [...Array(half).keys()].map((i) => i / half) : [...Array(half).keys()].map((i) => (i + 0.5) / half);
  const d = 0.34 / half;
  const e = 0.12 / half;
  ts.forEach((t, i) => {
    const [c, s] = strands[i % 2];
    const g = strandPts(base, amp, half, s, phase, t - d, t + d, 10);
    const k = strandPts(base, amp, half, s, phase, t - d - e, t + d + e, 12);
    out += `<path d="${pathD(g)}" ${stroke(gap, w + 2 * w * gapScale)}/><path d="${pathD(k)}" ${stroke(c, w)}/>`;
  });
  return out;
}

const MARKS = Object.fromEntries(['weave-mark-light', 'weave-mark-dark', 'weave-mark-white', 'weave-mark-mono-cream', 'weave-mark-mono-blue'].map((n) => [n, readFileSync(n === 'weave-mark-light' || n === 'weave-mark-dark' ? join(HERE, '..', '..', 'public', 'brand', n + '.svg') : join(HERE, '..', 'assets', n + '.svg'), 'utf8')]));
let markSeq = 0;
function mark(name, cx, cy, width, recolor) {
  const id = `m${++markSeq}`;
  const inner = MARKS[name].replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/id="w([AB])"/g, `id="${id}$1"`).replace(/url\(#w([AB])\)/g, `url(#${id}$1)`);
  const h = width * (16 / 28);
  const body = recolor ? inner.replace(/stroke="#ffffff"/g, `stroke="${recolor}"`) : inner;
  return `<svg x="${f(cx - width / 2)}" y="${f(cy - h / 2)}" width="${f(width)}" height="${f(h)}" viewBox="10 16 28 16">${body}</svg>`;
}

function sawtooth(cx, cy, ro, ri, teeth) {
  const pts = [];
  for (let i = 0; i < teeth * 2; i++) {
    const r = i % 2 ? ri : ro;
    const t = (i / (teeth * 2)) * 2 * Math.PI - Math.PI / 2;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pathD(pts, true);
}
function rays(cx, cy, r0, r1, n, c, w) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    d += `M${f(cx + r0 * Math.cos(t))},${f(cy + r0 * Math.sin(t))} L${f(cx + r1 * Math.cos(t))},${f(cy + r1 * Math.sin(t))} `;
  }
  return `<path d="${d}" ${stroke(c, w, ';stroke-linecap:butt')}/>`;
}
let ringSeq = 0;
function ringText(cx, cy, r, text, { bottom = false, size, color, spacing = 0.18 }) {
  const id = `r${++ringSeq}`;
  const d = bottom
    ? `M${f(cx - r)},${f(cy)} A${r},${r} 0 0 0 ${f(cx + r)},${f(cy)}`
    : `M${f(cx - r)},${f(cy)} A${r},${r} 0 0 1 ${f(cx + r)},${f(cy)}`;
  return `<path id="${id}" d="${d}" fill="none"/><text style="fill:${color};font-family:Outfit,'Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:${size}px;letter-spacing:${spacing}em" text-anchor="middle"><textPath href="#${id}" startOffset="50%">${text}</textPath></text>`;
}

const assets = [];
const fileId = (id) => id.replace(/^seal-/, 'badge-').replace(/^mark-fabric-/, 'pattern-rope-').replace(/^mark-halftone-vignette$/, 'pattern-dots-vignette').replace(/^mark-/, 'pattern-');
const add = (rawId, group, name, w, h, body, meta = {}) => {
  const id = fileId(rawId);
  const s = svg(w, h, body, name);
  assets.push({ id, group, name, w, h, ...meta });
  writeFileSync(join(SVG_DIR, id + '.svg'), s + '\n');
};

const SEAL_CW = {
  blue: { edge: C.blue, ring: C.cream, text: C.cream, disc: C.ink, rays: C.blue, mk: 'weave-mark-dark' },
  ink: { edge: C.ink, ring: C.ice, text: C.cream, disc: C.blue, rays: C.ink, mk: 'weave-mark-white' },
  cream: { edge: C.cream, ring: C.ink, text: C.ink, disc: C.ink, rays: C.blue, mk: 'weave-mark-dark' },
};
const MONO_MASK = { edge: '#fff', ring: '#000', text: '#000', disc: '#fff', rays: '#000', mk: 'weave-mark-white', recolor: '#000' };
function sealParts(cw, top, bottom) {
  const cx = 120, cy = 120;
  return `<path d="${sawtooth(cx, cy, 118, 110, 54)}" ${fill(cw.edge)}/>`
    + `<circle cx="${cx}" cy="${cy}" r="100" ${stroke(cw.ring, 2.5)}/>`
    + ringText(cx, cy, 81, top, { size: Math.min(17, 232 / (top.length * 0.8)), color: cw.text })
    + ringText(cx, cy, 92, bottom, { bottom: true, size: Math.min(17, 232 / (bottom.length * 0.8)), color: cw.text })
    + `<circle cx="${cx - 89}" cy="${cy}" r="3" ${fill(cw.ring)}/><circle cx="${cx + 89}" cy="${cy}" r="3" ${fill(cw.ring)}/>`
    + `<circle cx="${cx}" cy="${cy}" r="70" ${fill(cw.disc)}/>`
    + rays(cx, cy, 50, 66, 60, cw.rays, 2.2)
    + `<circle cx="${cx}" cy="${cy}" r="70" ${stroke(cw.ring, 2.5)}/>`
    + mark(cw.mk, cx, cy, 82, cw.recolor);
}
let monoSeq = 0;
function sealMono(color, opacity = 1, top = LABELS.sealTop, bottom = LABELS.sealBottom) {
  const id = `mono${++monoSeq}`;
  return `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="240">${sealParts(MONO_MASK, top, bottom)}</mask><rect width="240" height="240" style="fill:${color};fill-opacity:${opacity}" mask="url(#${id})"/>`;
}
function seal(colorway, top = LABELS.sealTop, bottom = LABELS.sealBottom) {
  return sealParts(SEAL_CW[colorway], top, bottom);
}
function sealSmall(colorway) {
  const cw = SEAL_CW[colorway];
  return `<path d="${sawtooth(120, 120, 118, 104, 30)}" ${fill(cw.edge)}/><circle cx="120" cy="120" r="94" ${stroke(cw.ring, 6)}/><circle cx="120" cy="120" r="82" ${fill(cw.disc)}/>` + mark(cw.mk, 120, 120, 128);
}


function footerBadge(theme) {
  const dark = theme === 'dark';
  const bg = dark ? C.ink : C.panelL;
  const tx = dark ? C.cream : C.ink;
    return `<rect x="1" y="1" width="154" height="38" rx="19" style="fill:${bg};stroke:${dark ? C.ink : C.divL};stroke-width:2"/>`
    + mark(dark ? 'weave-mark-dark' : 'weave-mark-light', 26, 20, 30)
    + `<text x="44" y="25" style="fill:${tx};font-family:Outfit,'Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:14px;letter-spacing:0.01em">${LABELS.footer}</text>`;
}
add('badge-footer-light', 'Seals and badges', 'Footer badge, light', 156, 40, footerBadge('light'), { code: 'B5' });
add('badge-footer-dark', 'Seals and badges', 'Footer badge, dark', 156, 40, footerBadge('dark'), { code: 'B5' });

function releaseBadge() {
  const cx = 70, cy = 70;
  return `<circle cx="${cx}" cy="${cy}" r="66" ${fill(C.ink)}/>`
    + woven(circle(cx, cy, 58), { amp: 3, half: 18, w: 3, a: C.blue, b: C.sky, gap: C.ink, closed: true })
    + ringText(cx, cy, 38, LABELS.release, { size: 10.5, color: C.cream, spacing: 0.22 })
    + `<text x="${cx}" y="${cy + 14}" text-anchor="middle" style="fill:${C.cream};font-family:Outfit,'Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:30px;letter-spacing:-0.02em">${LABELS.version}</text>`;
}
add('badge-release', 'Seals and badges', 'Release badge', 140, 140, releaseBadge(), { code: 'B3' });

function band(a, b, bg, width = 600) {
  let s = `<rect width="${width}" height="96" ${fill(bg)}/>`;
  [24, 48, 72].forEach((y, i) => { s += woven(line(-12 + i * 10, y, width + 12, y), { amp: 7, half: Math.round(22 * width / 600), w: 4, a, b, gap: bg }); });
  return s;
}

function polyBase(pts, closed = true) {
  const P = closed ? [...pts, pts[0]] : pts;
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = L.at(-1);
  const at = (t) => {
    let s = (closed ? ((t % 1) + 1) % 1 : Math.min(1, Math.max(0, t))) * total;
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
    const u = (s - L[lo]) / ((L[hi] - L[lo]) || 1);
    return [P[lo][0] + (P[hi][0] - P[lo][0]) * u, P[lo][1] + (P[hi][1] - P[lo][1]) * u];
  };
  return {
    total,
    p: at,
    n: (t) => {
      const e = 0.5 / total, [x0, y0] = at(t - e), [x1, y1] = at(t + e), d = Math.hypot(x1 - x0, y1 - y0) || 1;
      return [(y1 - y0) / d, -(x1 - x0) / d];
    },
  };
}
const squircle = (cx, cy, a, b, m = 4, n = 720) => [...Array(n).keys()].map((i) => {
  const th = (i / n) * 2 * Math.PI, c = Math.cos(th), s = Math.sin(th);
  return [cx + a * Math.sign(c) * Math.abs(c) ** (2 / m), cy + b * Math.sign(s) * Math.abs(s) ** (2 / m)];
});

const A_PATH = 'M12,20 C16,20 16,28 20,28 C24,28 24,20 28,20 C32,20 32,28 36,28';
const B_PATH = 'M12,28 C16,28 16,20 20,20 C24,20 24,28 28,28 C32,28 32,20 36,20';
const strandSamples = () => {
  const out = [];
  for (const start of [20, 28]) {
    let a = start, b = start === 20 ? 28 : 20;
    for (let x = 12; x < 36; x += 8) {
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, u = 1 - t;
        out.push([u ** 3 * x + 3 * u * u * t * (x + 4) + 3 * u * t * t * (x + 4) + t ** 3 * (x + 8), u ** 3 * a + 3 * u * u * t * a + 3 * u * t * t * b + t ** 3 * b]);
      }
      [a, b] = [b, a];
    }
  }
  return out;
};
const STRAND_PTS = strandSamples();

const PAL = {
  light: { bg: C.panelL, line: C.sky, lineA: 0.55, a: C.blue, b: C.ink, mk: 'weave-mark-light' },
  dark: { bg: C.canvasD, line: C.sky, lineA: 0.45, a: C.blue, b: C.sky, mk: 'weave-mark-dark' },
};
const W2 = 1200, H2 = 800;

let fieldSeq = 0;
function contourField(theme, { W = W2, H = H2, cols = 3, rows = 3, s = 6, gap = 1.9, lw = 0.3, rings = 18, r0 = 3.4, spread = 1 } = {}) {
  const t = PAL[theme], id = `cf${++fieldSeq}`;
  const dx = W / cols, dy = H / rows;
  const spots = [];
  for (let j = -1; j <= rows; j++) for (let i = -1; i <= cols; i++) spots.push([dx * (i + 0.5) + (j % 2 ? dx / 2 : 0), dy * (j + 0.5)]);
  const paths = spots.map(([x, y]) => `<g transform="translate(${f(x - 24 * s)} ${f(y - 24 * s)}) scale(${s})"><path d="${A_PATH}"/><path d="${B_PATH}"/></g>`).join('');
  let body = `<rect width="${W}" height="${H}" ${fill(t.bg)}/><defs><g id="${id}" style="fill:none;stroke-linecap:round;stroke-linejoin:round">${paths}</g></defs>`;
  for (let k = rings; k >= 0; k--) {
    const r = r0 + k * gap * spread;
    body += `<use href="#${id}" style="stroke:${t.line};stroke-opacity:${t.lineA};stroke-width:${f(2 * r + lw)}"/><use href="#${id}" style="stroke:${t.bg};stroke-width:${f(2 * r - lw)}"/>`;
  }
  body += spots.map(([x, y]) => mark(t.mk, x, y, 28 * s)).join('');
  return body;
}

function ropeRow(y0, x0, x1, s, phaseFlip, colA, colB, bg) {
  const seg = (k, startHigh) => {
    const x = x0 + k * 8 * s, a = startHigh ? y0 : y0 + 8 * s, b = startHigh ? y0 + 8 * s : y0;
    return `M${f(x)},${f(a)} C${f(x + 4 * s)},${f(a)} ${f(x + 4 * s)},${f(b)} ${f(x + 8 * s)},${f(b)}`;
  };
  const n = Math.ceil((x1 - x0) / (8 * s)) + 1;
  const A = [], B = [];
  for (let k = 0; k < n; k++) { A.push(seg(k, (k % 2 === 0) !== phaseFlip)); B.push(seg(k, (k % 2 === 1) !== phaseFlip)); }
  const w = 3.5 * s, g = 6 * s;
  let out = `<path d="${A.join(' ')}" ${stroke(colA, w)}/><path d="${B.join(' ')}" ${stroke(colB, w)}/>`;
  for (let k = 0; k < n; k++) {
    const overA = k % 2 === 1;
    const d = overA ? A[k] : B[k];
    out += `<path d="${d}" ${stroke(bg, g, ';stroke-linecap:butt')}/><path d="${d}" ${stroke(overA ? colA : colB, w)}/>`;
  }
  return out;
}
function fabric(theme, { W = W2, H = H2, s = 4, pitch = 17, knock = true } = {}) {
  const t = PAL[theme];
  let body = `<rect width="${W}" height="${H}" ${fill(t.bg)}/>`;
  const rowH = pitch * s;
  for (let j = 0, y = -4 * s; y < H; j++, y += rowH) body += ropeRow(y, -16 * s - (j % 2 ? 8 * s : 0), W + 16 * s, s, false, t.a, t.b, t.bg);
  if (knock) {
    const kw = 300, kh = 150;
    body += `<rect x="${(W - kw) / 2}" y="${(H - kh) / 2}" width="${kw}" height="${kh}" rx="${kh / 2}" ${fill(t.bg)}/>` + mark(t.mk, W / 2, H / 2, 200);
  }
  return body;
}

const MPAT = [
  ['M1', 'contour', 'Contour field', 'Radiate contours from a half-drop grid of marks; the rings meet between marks and close into cells.', contourField],
  ['M2', 'fabric', 'Endless rope', 'The mark’s own strand curve run edge to edge, row on row, every crossing cut over and under as the mark cuts it.', fabric],
];
for (const [code, key, name, note, fn] of MPAT) {
  for (const theme of ['light', 'dark']) add(`mark-${key}-${theme}`, 'Mark patterns', `${name}, ${theme}`, W2, H2, fn(theme), { code, theme, note, pname: name });
}

function iconProduct() {
  return `<circle cx="24" cy="24" r="23" ${fill(C.blue)}/>`
    + `<path d="M24,10.5 C30.5,15 31.5,23.5 28.8,31 L19.2,31 C16.5,23.5 17.5,15 24,10.5 Z" ${stroke(C.cream, 3)}/>`
    + `<circle cx="24" cy="21" r="2.6" ${stroke(C.cream, 2.6)}/>`
    + `<path d="M21.5,36 L26.5,36" ${stroke(C.cream, 3)}/>`;
}
add('icon-product', 'Icon', 'Product and engineering', 48, 48, iconProduct(), { code: 'I6' });

const font = (size, color, extra = '') => `style="fill:${color};font-family:Outfit,'Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:${size}px${extra}"`;
const wordmark = (x, y, size, color, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}" ${font(size, color, ';letter-spacing:-0.02em')}>weave</text>`;
const tagline = (x, y, size, color, anchor = 'start') => `<text x="${x}" y="${y}" text-anchor="${anchor}" ${font(size, color, ';letter-spacing:0.16em')}>${LABELS.posterLine}</text>`;
const sealAt = (cw, x, y, size) => `<g transform="translate(${f(x)} ${f(y)}) scale(${f(size / 240)})">${seal(cw)}</g>`;
const nest = (w, h, inner, x = 0, y = 0, vw = W2, vh = H2, par = 'xMidYMid slice') => `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="${par}">${inner}</svg>`;

function posterOG({ field, sealCw, word, line, bandA, bandB, bandBg }) {
  return `<rect width="1200" height="630" ${fill(field)}/>`
    + `<g transform="translate(0 534)">${band(bandA, bandB, bandBg, 1200)}</g>`
    + sealAt(sealCw, 96, 72, 384)
    + wordmark(560, 300, 190, word) + tagline(566, 372, 22, line);
}
const POSTERS = [
  ['X1', 'poster-og', 'Link preview, blue', 1200, 630, () => posterOG({ field: C.blue, sealCw: 'ink', word: C.cream, line: C.ice, bandA: C.cream, bandB: C.ice, bandBg: C.ink })],
  ['X2', 'poster-og-ink', 'Link preview, ink', 1200, 630, () => posterOG({ field: C.ink, sealCw: 'blue', word: C.cream, line: C.sky, bandA: C.cream, bandB: C.ice, bandBg: C.blue })],
  ['X3', 'poster-og-slate', 'Link preview, slate', 1200, 630, () => posterOG({ field: C.canvasL, sealCw: 'blue', word: C.ink, line: C.blue, bandA: C.blue, bandB: C.ink, bandBg: C.panelL })],
  ['X4', 'poster-square', 'Square post, blue', 1080, 1080, () => `<rect width="1080" height="1080" ${fill(C.blue)}/>`
    + `<g transform="translate(0 984)">${band(C.cream, C.ice, C.ink, 1080)}</g>`
    + sealAt('ink', 330, 96, 420) + wordmark(540, 760, 190, C.cream, 'middle') + tagline(540, 834, 24, C.ice, 'middle')],
  ['X5', 'poster-banner', 'Profile banner, ink', 1584, 396, () => `<rect width="1584" height="396" ${fill(C.ink)}/>`
    + `<g transform="translate(0 348)">${nest(1584, 48, band(C.cream, C.ice, C.blue, 1584), 0, 0, 1584, 96)}</g>`
    + sealAt('blue', 1236, 36, 276) + wordmark(96, 214, 150, C.cream) + tagline(102, 270, 22, C.sky)],
  ['X6', 'poster-og-contour', 'Link preview, contour field', 1200, 630, () => nest(1200, 630, contourField('dark', { W: 1200, H: 630, cols: 3, rows: 2, s: 5 }), 0, 0, 1200, 630)
    + `<rect x="64" y="96" width="1072" height="438" rx="219" ${fill(C.canvasD)}/>`
    + sealAt('blue', 120, 135, 360) + wordmark(540, 330, 170, C.cream) + tagline(546, 396, 20, C.sky)],
];
for (const [code, id, name, w, h, fn] of POSTERS) add(id, 'Posters', name, w, h, fn(), { code });


PAL.blue = { bg: C.blue, line: C.ice, lineA: 0.5, a: C.cream, b: C.ice, mk: 'weave-mark-white' };

const tp = (d, s, x, y) => d.replace(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g, (_, a, b) => `${f(x + (a - 24) * s)},${f(y + (b - 24) * s)}`);
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gridSpots = (W, H, cols, rows, s) => {
  const out = [], dx = W / cols, dy = H / rows;
  for (let j = -1; j <= rows; j++) for (let i = -1; i <= cols; i++) out.push({ x: dx * (i + 0.5) + (j % 2 ? dx / 2 : 0), y: dy * (j + 0.5), s });
  return out;
};
const centreFirst = (spots, W, H) => {
  const big = spots.slice(0, 4).reduce((a, b) => (Math.hypot(a.x - W / 2, a.y - H / 2) < Math.hypot(b.x - W / 2, b.y - H / 2) ? a : b));
  return spots.map((p) => ({ ...p, show: p === big }));
};
function scatter(W, H, n, sMin, sMax, seed, minGap = 1.15) {
  const r = rng(seed), out = [];
  for (let tries = 0; out.length < n && tries < 5000; tries++) {
    const s = sMin + (sMax - sMin) * r() ** 1.6, x = -40 + r() * (W + 80), y = -40 + r() * (H + 80);
    if (out.every((o) => Math.hypot((o.x - x) / 1.6, o.y - y) > (o.s + s) * 14 * minGap)) out.push({ x, y, s });
  }
  return out.sort((a, b) => b.s - a.s);
}

let c2 = 0;
function contour2({ W = W2, H = H2, spots, gap = 11, lw = 1.8, rings, r0, pal, index = 0, lwIdx = 3.2, idxColor, idxA = 0.9 }) {
  const id = `c2_${++c2}`;
  const sMax = Math.max(...spots.map((p) => p.s));
  r0 ??= 3.4 * sMax;
  rings ??= Math.ceil(Math.hypot(W, H) / 2 / gap);
  const paths = spots.map((p) => `<path d="${tp(A_PATH, p.s, p.x, p.y)}"/><path d="${tp(B_PATH, p.s, p.x, p.y)}"/>`).join('');
  let body = `<rect width="${W}" height="${H}" ${fill(pal.bg)}/><defs><g id="${id}" style="fill:none;stroke-linecap:round;stroke-linejoin:round">${paths}</g></defs>`;
  for (let k = rings; k >= 0; k--) {
    const r = r0 + k * gap, big = index && k % index === 0;
    const w = big ? lwIdx : lw;
    body += `<use href="#${id}" style="stroke:${big ? idxColor : pal.line};stroke-opacity:${big ? idxA : pal.lineA};stroke-width:${f(2 * r + w)}"/><use href="#${id}" style="stroke:${pal.bg};stroke-width:${f(2 * r - w)}"/>`;
  }
  const shown = spots.filter((p) => p.show !== false);
  body += shown.map((p) => {
    if (3.4 * p.s <= r0 + gap / 2) return '';
    const kr = r0 + (Math.round((3.4 * p.s - r0) / gap) + 0.5) * gap;
    return `<g style="fill:none;stroke:${pal.bg};stroke-width:${f(2 * kr)};stroke-linecap:round"><path d="${tp(A_PATH, p.s, p.x, p.y)}"/><path d="${tp(B_PATH, p.s, p.x, p.y)}"/></g>`;
  }).join('');
  body += shown.map((p) => mark(pal.mk, p.x, p.y, 28 * p.s)).join('');
  return body;
}

const M1V = [
  ['M1a', 'contour-dense', 'Dense grid', 'Axis: density. Five columns of small marks; the contours turn into a fine texture.', () => contour2({ spots: gridSpots(W2, H2, 5, 5, 3.4), gap: 7, lw: 1.3, pal: PAL.light })],
  ['M1c', 'contour-peaks', 'Hidden peaks', 'Axis: what shows. The same relief map with only the largest mark drawn; the rest are rope-shaped peaks in the lines.', () => contour2({ spots: centreFirst(scatter(W2, H2, 9, 3, 9, 7), W2, H2), gap: 10, lw: 1.7, r0: 4, pal: PAL.light })],
  ['M1e', 'contour-blue', 'On brand blue', 'Axis: colour. The M1 grid on a blue field with ice lines and the white mark.', () => contour2({ spots: gridSpots(W2, H2, 3, 3, 6), gap: 11, lw: 1.8, pal: PAL.blue })],
];
for (const [code, key, name, note, fn, w = W2, h = H2] of M1V) add(`mark-${key}`, 'Contour variants', name, w, h, fn(), { code, note, pname: name });

function ropeRows(rows, { W = W2, H = H2, pal, knock = 300 }) {
  let body = `<rect width="${W}" height="${H}" ${fill(pal.bg)}/>`;
  for (const r of rows) body += ropeRow(r.y, r.x0, W + 16 * r.s, r.s, false, pal.a, pal.b, pal.bg);
  if (knock) body += `<rect x="${(W - knock) / 2}" y="${(H - knock / 2) / 2}" width="${knock}" height="${knock / 2}" rx="${knock / 4}" ${fill(pal.bg)}/>` + mark(pal.mk, W / 2, H / 2, knock * 0.66);
  return body;
}
const evenRows = (s, pitch, shift = () => 0, H = H2) => {
  const out = [];
  for (let j = 0, y = -4 * s; y < H; j++, y += pitch * s) out.push({ y, s, x0: -16 * s - shift(j) * s });
  return out;
};
const M2V = [
  ['M2d', 'rope-twill', 'Twill', 'Axis: offset. Each row slides two units further, so the crossings run on a diagonal, as in twill cloth.', () => ropeRows(evenRows(4, 13, (j) => (j * 2) % 16), { pal: PAL.light })],
  ['M2e', 'rope-blue', 'On brand blue', 'Axis: colour. M2 in cream and ice on blue, with the white mark.', () => ropeRows(evenRows(4, 17, (j) => (j % 2 ? 8 : 0)), { pal: PAL.blue })],
];
for (const [code, key, name, note, fn] of M2V) add(`mark-${key}`, 'Rope variants', name, W2, H2, fn(), { code, note, pname: name });

function halftone2({ W = W2, H = H2, spots = [{ x: W2 / 2, y: H2 / 2, s: 10 }], pal, step = 22, rmax = 8.5, d0 = 7, k = 22, mode = 'dot', inverse = false, two = false, showMarks = true }) {
  let body = `<rect width="${W}" height="${H}" ${fill(pal.bg)}/>`;
  const groups = { a: [], b: [] }, half = STRAND_PTS.length / 2;
  for (let y = step / 2, j = 0; y < H + step; y += step * 0.866, j++) {
    for (let x = (j % 2 ? step : step / 2); x < W + step; x += step) {
      let m = Infinity, mi = 0, ms = spots[0].s;
      for (const p of spots) for (let i = 0; i < STRAND_PTS.length; i++) {
        const px = p.x + (STRAND_PTS[i][0] - 24) * p.s, py = p.y + (STRAND_PTS[i][1] - 24) * p.s, q = ((x - px) / p.s) ** 2 + ((y - py) / p.s) ** 2;
        if (q < m) { m = q; mi = i; ms = p.s; }
      }
      const d = Math.sqrt(m) * (ms / 10);
      if (d < d0) continue;
      const e = Math.exp(-(d - d0) / k);
      const r = rmax * (inverse ? 0.12 + 0.88 * (1 - e) : e);
      if (r < 0.9) continue;
      const g = two && mi >= half ? groups.b : groups.a;
      if (mode === 'dash') {
        const i0 = Math.max(0, mi - 1), i1 = Math.min(STRAND_PTS.length - 1, mi + 1);
        let tx = STRAND_PTS[i1][0] - STRAND_PTS[i0][0], ty = STRAND_PTS[i1][1] - STRAND_PTS[i0][1];
        const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
        const h = r * 1.8;
        g.push(`M${f(x - tx * h)},${f(y - ty * h)}L${f(x + tx * h)},${f(y + ty * h)}`);
      } else g.push(`M${f(x - r)},${f(y)}a${f(r)},${f(r)} 0 1 0 ${f(2 * r)},0a${f(r)},${f(r)} 0 1 0 ${f(-2 * r)},0`);
    }
  }
  const paint = (list, color, a) => !list.length ? '' : mode === 'dash'
    ? `<path d="${list.join('')}" style="fill:none;stroke:${color};stroke-opacity:${a};stroke-width:${f(rmax * 0.62)};stroke-linecap:round"/>`
    : `<path d="${list.join('')}" style="fill:${color};fill-opacity:${a}"/>`;
  body += two ? paint(groups.a, pal.a, 0.9) + paint(groups.b, pal.b, 0.9) : paint(groups.a, pal.line, Math.min(1, pal.lineA + 0.3));
  if (showMarks) body += spots.map((p) => mark(pal.mk, p.x, p.y, 28 * p.s)).join('');
  return body;
}
const M3V = [
  ['M3c', 'halftone-vignette', 'Vignette', 'Axis: direction. Dots grow toward the edges instead of the mark; cream on brand blue.', () => halftone2({ pal: { ...PAL.blue, line: C.cream, lineA: 0.7 }, inverse: true, rmax: 9, k: 26 })],
];
for (const [code, key, name, note, fn] of M3V) add(`mark-${key}`, 'Halftone variants', name, W2, H2, fn(), { code, note, pname: name });

function x6({ W = 1200, H = 630, field, lozenge, sealCw, word, line, box = [64, 96, 1072, 438], sealXY = [120, 135], sealSize = 360, wordXY = [540, 330], wordSize = 170, lineSize = 20, anchor = 'start' }) {
  const [bx, by, bw, bh] = box;
  return field + `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${Math.min(bw, bh) / 2}" ${fill(lozenge)}/>`
    + sealAt(sealCw, sealXY[0], sealXY[1], sealSize) + wordmark(wordXY[0], wordXY[1], wordSize, word, anchor) + tagline(wordXY[0] + (anchor === 'start' ? 6 : 0), wordXY[1] + 66 * wordSize / 170, lineSize, line, anchor);
}
const X6V = [
  ['X6a', 'poster-contour-light', 'X6, light', 1200, 630, 'Axis: colour. Light contour field, white pill, ink wordmark.', () => x6({ field: contour2({ W: 1200, H: 630, spots: gridSpots(1200, 630, 3, 2, 5), gap: 10, lw: 1.6, pal: PAL.light }), lozenge: C.panelL, sealCw: 'blue', word: C.ink, line: C.blue })],
  ['X6b', 'poster-contour-blue', 'X6, brand blue', 1200, 630, 'Axis: colour. Ice contours on blue, ink seal, cream wordmark.', () => x6({ field: contour2({ W: 1200, H: 630, spots: gridSpots(1200, 630, 3, 2, 5), gap: 10, lw: 1.6, pal: PAL.blue }), lozenge: C.blue, sealCw: 'ink', word: C.cream, line: C.ice })],
  ['X6c', 'poster-contour-topo', 'X6, topography', 1200, 630, 'Axis: field. The M1c relief map behind the X6 layout.', () => x6({ field: contour2({ W: 1200, H: 630, spots: scatter(1200, 630, 8, 3, 8, 11).map((p) => ({ ...p, show: false })), gap: 10, lw: 1.6, r0: 4, pal: PAL.dark }), lozenge: C.canvasD, sealCw: 'blue', word: C.cream, line: C.sky })],
  ['X6d', 'poster-contour-square', 'X6, square', 1080, 1080, 'Axis: format. 1080 square post; seal over wordmark in a tall pill.', () => x6({ W: 1080, H: 1080, field: contour2({ W: 1080, H: 1080, spots: gridSpots(1080, 1080, 3, 4, 5), gap: 10, lw: 1.6, pal: PAL.dark }), lozenge: C.canvasD, sealCw: 'blue', word: C.cream, line: C.sky, box: [230, 120, 620, 840], sealXY: [345, 200], sealSize: 390, wordXY: [540, 760], wordSize: 150, lineSize: 18, anchor: 'middle' })],
  ['X6e', 'poster-contour-banner', 'X6, banner', 1584, 396, 'Axis: format. 1584 × 396 profile header over the M1f row field.', () => x6({ W: 1584, H: 396, field: contour2({ W: 1584, H: 396, spots: [-1, 0, 1, 2, 3, 4].map((i) => ({ x: 120 + i * 300, y: 198, s: 4.4 })), gap: 9, lw: 1.5, pal: PAL.dark }), lozenge: C.canvasD, sealCw: 'blue', word: C.cream, line: C.sky, box: [300, 48, 984, 300], sealXY: [348, 70], sealSize: 256, wordXY: [650, 222], wordSize: 130, lineSize: 17 })],
  ['X7b', 'poster-story-contour', 'Story, contour field', 1080, 1920, 'Axis: field. X7 with the M1 contour field in place of the woven rings.', () => contour2({ W: 1080, H: 1920, spots: gridSpots(1080, 1920, 2, 5, 6), gap: 11, lw: 1.8, pal: PAL.dark })
    + `<circle cx="540" cy="900" r="250" ${fill(C.canvasD)}/>` + sealAt('blue', 330, 690, 420)
    + `<rect x="120" y="1500" width="840" height="300" rx="150" ${fill(C.canvasD)}/>` + wordmark(540, 1665, 170, C.cream, 'middle') + tagline(540, 1730, 22, C.sky, 'middle')],
];
for (const [code, id, name, w, h, note, fn] of X6V) add(id, 'Poster variants', name, w, h, fn(), { code, note });



const TREAT = [
  ['B1', 'seal-blue', 'Blue', 240, 240, 'Default. Light pages, stickers, posters on slate.', () => seal('blue')],
  ['B2', 'seal-ink', 'Ink', 240, 240, 'On brand blue fields and photography.', () => seal('ink')],
  ['B6', 'seal-cream', 'Cream', 240, 240, 'On ink or night surfaces where blue would sink.', () => seal('cream')],
  ['B7', 'seal-mono-blue', 'One colour, blue', 240, 240, 'Print and stamps. Ring type and rays are knocked out to whatever is behind.', () => sealMono(C.blue)],
  ['B8', 'seal-mono-ink', 'One colour, ink', 240, 240, 'Single-ink print: invoices, letterhead, packing slips.', () => sealMono(C.ink)],
  ['B9', 'seal-mono-cream', 'One colour, cream', 240, 240, 'Over dark photography or video.', () => sealMono(C.cream)],
  ['B10', 'seal-mono-white', 'One colour, white', 240, 240, 'Reversed out of brand blue: buttons, banners, merch on blue.', () => sealMono('#ffffff')],
  ['B11', 'seal-watermark', 'Watermark', 240, 240, 'White at 14% for tonal backgrounds and certificate grounds.', () => sealMono('#ffffff', 0.14)],
  ['B12', 'seal-small', 'Small', 240, 240, 'Below 72px: no ring type, no rays, mark enlarged. Favicons, avatars, chips.', () => sealSmall('blue')],
  ['B13', 'seal-sticker', 'Die-cut sticker', 260, 260, 'Cream bleed ring is the die line, 10px outside the teeth.', () => `<circle cx="130" cy="130" r="128" ${fill(C.cream)}/><g transform="translate(10 10)">${seal('blue')}</g>`],
  ['B17', 'seal-small-ink', 'Small, ink', 240, 240, 'Small badge for dark avatars and app chrome.', () => sealSmall('ink')],
  ['B16', 'seal-lockup-stacked', 'Lockup, stacked', 240, 330, 'Seal over wordmark for narrow spaces and covers.', () => seal('blue') + wordmark(120, 316, 76, C.ink, 'middle')],
  ['B14', 'seal-lockup-light', 'Lockup, light', 660, 240, 'Seal beside the wordmark for light pages and documents.', () => seal('blue') + wordmark(272, 158, 128, C.ink)],
  ['B15', 'seal-lockup-dark', 'Lockup, dark', 660, 240, 'Same lockup on dark surfaces.', () => seal('blue') + wordmark(272, 158, 128, C.cream)],
];
for (const [code, id, name, w, h, note, fn] of TREAT) add(id, 'Badge', name, w, h, fn(), { code, note });
const GUIDE = JSON.parse(readFileSync(join(HERE, 'guide.json'), 'utf8'));
const FAMILY = { 'Seals and badges': 'badge', Badge: 'badge', Icon: 'icon', Posters: 'poster', 'Poster variants': 'poster', 'Mark patterns': 'pattern', 'Contour variants': 'pattern', 'Rope variants': 'pattern', 'Halftone variants': 'pattern' };
const manifest = {
  badgeWords: { top: LABELS.sealTop, bottom: LABELS.sealBottom },
  regenerate: 'node brand/kit/build-kit.mjs && node brand/kit/render-kit-png.mjs',
  assets: assets.map((a) => ({
    code: a.code, id: a.id, name: a.pname || a.name, family: FAMILY[a.group], theme: a.theme ?? null,
    svg: `svg/${a.id}.svg`, png: `png/${a.id}.png`, width: a.w, height: a.h,
    ground: GUIDE[a.id]?.ground ?? null, use: GUIDE[a.id]?.use ?? [], note: a.note ?? null,
  })),
};
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${assets.length} assets -> ${SVG_DIR}`);
