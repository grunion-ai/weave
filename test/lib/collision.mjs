import { CELLS, DESKTOP, GATE_CELLS, NOTE, PLATFORM, likeOf, settle, sweepCell } from './cutoff.mjs';
import { SEEDS, held, plan, statesOf, walked } from './states.mjs';

export { CELLS, DESKTOP, GATE_CELLS, NOTE, PLATFORM, likeOf, settle, held, walked };

export const KINDS = ['overlap', 'protrusion', 'page-wide'];
export const TOLERANCE = 2;

export function overlapOf(a, b, tolerance = TOLERANCE) {
  const wide = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const tall = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (wide <= tolerance || tall <= tolerance) return 0;
  return Math.round(Math.min(wide, tall));
}

export function collide(a, b, tolerance = TOLERANCE) {
  if (a.layer !== b.layer) return 0;
  let worst = 0;
  for (const x of a.rects) for (const y of b.rects) worst = Math.max(worst, overlapOf(x, y, tolerance));
  return worst;
}

export function pastEdge(box, view, tolerance = TOLERANCE) {
  const out = Math.max(box.right - view.width, -box.left);
  return out > tolerance ? Math.round(out) : 0;
}

export function pageWide(scrollWidth, view, tolerance = TOLERANCE) {
  const out = scrollWidth - view.width;
  return out > tolerance ? Math.round(out) : 0;
}

export function probe(target = null) {
  const { root: rootSelector = null, tolerance = 2 } = target && typeof target === 'object' ? target : { root: target };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'OPTGROUP', 'SELECT', 'DATALIST', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'BR', 'HR']);
  const CONTROL = 'button, a[href], input, textarea, summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"]';
  const ABOVE = 'dialog, [popover], .drag-ghost, .dragging, [aria-grabbed="true"]';
  const styles = new Map();
  const style = (e) => {
    let cs = styles.get(e);
    if (!cs) styles.set(e, (cs = getComputedStyle(e)));
    return cs;
  };
  const clips = (v) => v === 'hidden' || v === 'clip';
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  const clean = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 60);
  const part = (x) => x.tagName.toLowerCase() + (x.id ? `#${x.id}` : '') + [...x.classList].slice(0, 2).map((c) => `.${c}`).join('');
  const selector = (e) => {
    const parts = [];
    for (let x = e; x && x !== document.body && x !== document.documentElement && parts.length < 4; x = x.parentElement) parts.unshift(part(x));
    return parts.join(' > ') || part(e);
  };
  const paddingBox = (x) => {
    const r = x.getBoundingClientRect();
    const left = r.left + x.clientLeft;
    const top = r.top + x.clientTop;
    return { left, top, right: left + x.clientWidth, bottom: top + x.clientHeight };
  };
  const rectOf = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const view = { width: innerWidth, height: innerHeight };
  const clipTo = (box, by) => ({ left: Math.max(box.left, by.left), top: Math.max(box.top, by.top), right: Math.min(box.right, by.right), bottom: Math.min(box.bottom, by.bottom) });
  const positive = (b) => b.right - b.left > 0 && b.bottom - b.top > 0;
  const clipBox = (from) => {
    const box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    for (let x = from; x && x !== document.documentElement; x = x.parentElement) {
      const cs = style(x);
      if (cs.display === 'inline' || cs.display === 'contents') continue;
      const cutX = clips(cs.overflowX) || scrolls(cs.overflowX);
      const cutY = clips(cs.overflowY) || scrolls(cs.overflowY);
      if (!cutX && !cutY) continue;
      const p = paddingBox(x);
      if (cutX) { box.left = Math.max(box.left, p.left); box.right = Math.min(box.right, p.right); }
      if (cutY) { box.top = Math.max(box.top, p.top); box.bottom = Math.min(box.bottom, p.bottom); }
    }
    return box;
  };
  const unseen = (e) => {
    const own = e.getBoundingClientRect();
    if (!own.width || !own.height || style(e).visibility !== 'visible') return true;
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
      const cs = style(x);
      if (Number(cs.opacity) === 0) return true;
      if (cs.display === 'contents') continue;
      const r = x.getBoundingClientRect();
      const positioned = cs.position === 'fixed' || cs.position === 'absolute';
      if (positioned && cs.clip && cs.clip !== 'auto') return true;
      if (/inset\((50|100)%/.test(cs.clipPath)) return true;
      if ((clips(cs.overflowX) || clips(cs.overflowY)) && (r.width <= 1 || r.height <= 1)) return true;
    }
    return false;
  };
  const layers = new Map();
  const layerOf = (e) => {
    let root = document.documentElement;
    for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
      const cs = style(x);
      if (x.matches(ABOVE) || cs.position === 'fixed' || cs.position === 'sticky' || (cs.zIndex !== 'auto' && cs.position !== 'static')) { root = x; break; }
    }
    if (!layers.has(root)) layers.set(root, layers.size);
    return layers.get(root);
  };
  const glyphs = (own) => {
    const range = document.createRange();
    const out = [];
    for (const node of own) {
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) out.push(rectOf(r));
    }
    return out;
  };
  const paints = (e, cs) => {
    if (cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (cs[`border${side}Style`] !== 'none' && parseFloat(cs[`border${side}Width`]) > 0) return true;
    }
    const bg = cs.backgroundColor;
    return !(bg === 'transparent' || /^rgba\(.*,\s*0\)$/.test(bg));
  };
  const union = (rects) => rects.reduce((acc, r) => ({ left: Math.min(acc.left, r.left), top: Math.min(acc.top, r.top), right: Math.max(acc.right, r.right), bottom: Math.max(acc.bottom, r.bottom) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const overlapPx = (a, b) => {
    const wide = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const tall = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return wide > tolerance && tall > tolerance ? Math.min(wide, tall) : 0;
  };

  const roots = rootSelector ? [...document.querySelectorAll(rootSelector)] : [document.body];
  const out = [];
  const atoms = [];
  const visited = new Set();
  for (const root of roots) {
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (visited.has(e)) continue;
      visited.add(e);
      if (SKIP.has(e.tagName)) continue;
      const svg = e instanceof SVGElement;
      if (svg && e.tagName !== 'svg') continue;
      const own = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      const icon = svg || e.tagName === 'IMG';
      const control = !svg && e.matches(CONTROL) && !e.textContent.trim();
      if (!own.length && !icon && !control) continue;
      if (unseen(e)) continue;
      const marks = own.length > 0 || icon || paints(e, style(e));
      const outside = clipBox(e.parentElement);
      const shell = clipTo(rectOf(e.getBoundingClientRect()), outside);
      const by = clipBox(e);
      const drawn = (own.length ? glyphs(own).map((r) => clipTo(r, by)) : [shell]).filter(positive);
      if (!drawn.length) continue;
      const rects = drawn.map((r) => clipTo(r, { left: 0, top: 0, right: view.width, bottom: view.height })).filter(positive);
      const label = own.length ? e.textContent : (e.getAttribute('aria-label') ?? e.getAttribute('alt') ?? e.tagName.toLowerCase());
      atoms.push({ e, rects, shell, marks, box: rects.length ? union(rects) : union(drawn), layer: layerOf(e), text: clean(label) });
    }
  }

  atoms.sort((a, b) => a.box.top - b.box.top);
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i];
    for (let j = i + 1; j < atoms.length && atoms[j].box.top < a.box.bottom - tolerance; j++) {
      const b = atoms[j];
      if (a.layer !== b.layer) continue;
      if (!a.marks || !b.marks) continue;
      if (!a.rects.length || !b.rects.length) continue;
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      let worst = 0;
      for (const x of a.rects) for (const y of b.rects) worst = Math.max(worst, overlapPx(x, y));
      if (worst) out.push({ kind: 'overlap', selector: selector(a.e), with: selector(b.e), text: `${a.text} over ${b.text}`.slice(0, 60), px: Math.round(worst) });
    }
  }

  for (const a of atoms) {
    const { left, right, bottom } = a.shell;
    if (right <= 0 || bottom <= 0) continue;
    const past = Math.max(right - view.width, -left);
    if (past > tolerance) out.push({ kind: 'protrusion', selector: selector(a.e), text: a.text, px: Math.round(past) });
  }

  const wide = document.documentElement.scrollWidth - view.width;
  if (!rootSelector && wide > tolerance) out.push({ kind: 'page-wide', selector: 'html', text: `${view.width}px viewport`, px: Math.round(wide) });

  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const norm = (s) => String(s).replace(UUID, '#').replace(/\d+/g, '#');
export const fingerprint = (f, cell = DESKTOP) => `${f.kind}|${norm(f.selector)}${f.with ? `~${norm(f.with)}` : ''}${cell && cell !== DESKTOP ? `|${cell}` : ''}`;
export const cellOf = (fp) => (fp.split('|')[2] ?? DESKTOP);

export function tally(findings) {
  const counts = {};
  for (const f of findings) {
    const fp = fingerprint(f, f.cell);
    counts[fp] = (counts[fp] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export const sectionOf = (file, platform = PLATFORM) => file?.[platform] ?? {};

export function verdict(seen, holds, { cells = null } = {}) {
  const keep = (fp) => !cells || cells.includes(cellOf(fp));
  const unheld = [];
  const gone = [];
  for (const [fp, n] of Object.entries(seen)) if (keep(fp) && !Object.hasOwn(holds, fp)) unheld.push({ fp, seen: n });
  for (const fp of Object.keys(holds)) if (fp !== NOTE && keep(fp) && !Object.hasOwn(seen, fp)) gone.push({ fp, hold: holds[fp] });
  return { unheld, gone };
}

export const seed = SEEDS.messy;
export const SWEEP_JOURNEYS = statesOf(plan('collision'), 'journey');
export const restsFor = (entries, cell) => entries.filter((p) => p.cell === likeOf(cell) && p.state.open === 'rest').map((p) => p.state);

export async function sweep(browser, cell, ctx, options = {}) {
  return sweepCell(browser, cell, ctx, {
    journeys: SWEEP_JOURNEYS,
    rests: restsFor(walked('collision'), cell),
    ...options,
    fn: probe,
    target: (root) => ({ root }),
  });
}
