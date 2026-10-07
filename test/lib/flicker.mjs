import { decodePng } from './png.mjs';

export const FLASH_MS = 150;

export const GATED = ['transient', 'blank', 'revert', 'shift'];

export const fingerprint = (journey, e) => `${journey}|${e.kind}|${String(e.sel).split(' > ').slice(-2).join(' > ')}`;

function probe(MAX) {
  const out = window.__flicker = [];
  const now = () => performance.now();
  const push = (e) => out.push({ ...e, at: Date.now() });
  const word = (s) => !/\d{3,}|[0-9a-f]{8}/i.test(s);
  const sel = (n) => {
    const parts = [];
    for (let el = n; el && el.nodeType === 1 && parts.length < 3; el = el.parentElement) {
      if (el === document.body || el === document.documentElement) break;
      let p = el.localName;
      if (el.id && word(el.id)) p += `#${el.id}`;
      const cls = [...el.classList].filter(word).slice(0, 2);
      if (cls.length) p += `.${cls.join('.')}`;
      parts.unshift(p);
      if (el.id && word(el.id)) break;
    }
    return parts.join(' > ') || '?';
  };
  const seen = (n) => {
    if (!n || n.nodeType !== 1 || !n.isConnected) return false;
    const r = n.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
    return n.checkVisibility ? n.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
  };
  let input = -Infinity;
  for (const type of ['keydown', 'pointerdown', 'input', 'beforeinput', 'scroll']) {
    addEventListener(type, () => { input = now(); }, { capture: true, passive: true });
  }
  const answering = (t) => t - input < 50;
  const born = new Map();
  const emptied = new Map();
  const attrs = new Map();
  const tokens = (a, b) => {
    const A = new Set(String(a ?? '').split(/\s+/).filter(Boolean));
    const B = new Set(String(b ?? '').split(/\s+/).filter(Boolean));
    return [...[...B].filter((t) => !A.has(t)).map((t) => `+${t}`), ...[...A].filter((t) => !B.has(t)).map((t) => `-${t}`)].join(' ');
  };
  const mo = new MutationObserver((records) => {
    const t = now();
    const added = [];
    for (const r of records) {
      if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          added.push(n);
          if (!born.has(n)) born.set(n, { t, painted: false, sel: null });
        }
        const e = emptied.get(r.target);
        if (e && r.target.firstElementChild) {
          emptied.delete(r.target);
          if (e.painted && t - e.t < MAX && !answering(t)) push({ kind: 'blank', sel: e.sel, ms: Math.round(t - e.t) });
        }
        if (r.removedNodes.length && r.target.nodeType === 1 && !r.target.firstElementChild && !emptied.has(r.target)) {
          emptied.set(r.target, { t, painted: false, sel: null });
        }
      } else if (r.type === 'attributes') {
        const n = r.target;
        let m = attrs.get(n);
        if (!m) attrs.set(n, (m = new Map()));
        const e = m.get(r.attributeName);
        if (!e) m.set(r.attributeName, { orig: r.oldValue, t, painted: false });
        else if (n.getAttribute(r.attributeName) === e.orig) {
          m.delete(r.attributeName);
          if (e.painted && t - e.t < MAX && !answering(t)) {
            const detail = r.attributeName === 'class' ? tokens(e.orig, e.mid) : `${r.attributeName}: ${String(e.mid ?? '(none)').slice(0, 80)}`;
            push({ kind: 'revert', sel: e.sel, ms: Math.round(t - e.t), detail });
          }
        }
      }
    }
    const gone = new Map();
    for (const [n, b] of born) if (!n.isConnected) { born.delete(n); gone.set(n, b); }
    const groups = new Map();
    for (const [n, b] of gone) {
      if (!b.painted || t - b.t >= MAX || answering(t)) continue;
      let up = n.parentElement;
      while (up && !gone.has(up)) up = up.parentElement;
      if (up) continue;
      const twin = added.find((a) => a.isConnected && a.parentElement === b.parent && a.localName === n.localName && a.outerHTML === n.outerHTML);
      if (twin) { push({ kind: 'rerender', sel: b.sel, ms: Math.round(t - b.t) }); continue; }
      const g = groups.get(b.parent) ?? [];
      groups.set(b.parent, [...g, b]);
    }
    for (const [, g] of groups) {
      const ms = Math.round(t - Math.min(...g.map((b) => b.t)));
      push(g.length > 1 ? { kind: 'transient', sel: `${g[0].parentSel} > *`, ms } : { kind: 'transient', sel: g[0].sel, ms });
    }
  });
  const start = () => mo.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'hidden', 'style'],
  });
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });

  const chan = new MessageChannel();
  chan.port1.onmessage = () => {
    const t = now();
    for (const [n, b] of born) {
      if (t - b.t > MAX) born.delete(n);
      else if (!b.painted && seen(n)) { b.painted = true; b.sel = sel(n); b.parent = n.parentElement; b.parentSel = sel(n.parentElement); }
    }
    for (const [n, e] of emptied) {
      if (t - e.t > MAX || n.firstElementChild) emptied.delete(n);
      else if (!e.painted && seen(n)) { e.painted = true; e.sel = sel(n); }
    }
    for (const [n, m] of attrs) {
      for (const [name, e] of m) {
        if (t - e.t > MAX) m.delete(name);
        else if (!e.painted && (seen(n) || seen(n.parentElement))) {
          const mid = n.getAttribute(name);
          if (name === 'class' ? !tokens(e.orig, mid) : mid === e.orig) continue;
          e.painted = true; e.sel = sel(n); e.mid = mid;
        }
      }
      if (!m.size) attrs.delete(n);
    }
  };
  const tick = () => { chan.port2.postMessage(0); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput || e.value < 0.001 || answering(e.startTime)) continue;
        for (const s of e.sources ?? []) {
          const r0 = s.previousRect, r1 = s.currentRect;
          push({ kind: 'shift', sel: s.node ? sel(s.node.nodeType === 1 ? s.node : s.node.parentElement) : '?', ms: 0, value: Number(e.value.toFixed(4)),
            detail: `y ${Math.round(r0.y)}→${Math.round(r1.y)}, h ${Math.round(r0.height)}→${Math.round(r1.height)}` });
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < 100) continue;
        const s = e.scripts?.[0];
        const who = s ? (s.sourceFunctionName || String(s.invoker || 'script').replace(/^https?:\/\/[^/]+/, '')) : 'render';
        push({ kind: 'jank', sel: who, ms: Math.round(e.duration) });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {}
}

export const installProbe = (page, { maxMs = FLASH_MS } = {}) => page.addInitScript(probe, maxMs);
export const readProbe = (page) => page.evaluate(() => window.__flicker?.slice() ?? []);
export const resetProbe = (page) => page.evaluate(() => { if (window.__flicker) window.__flicker.length = 0; });

export async function recordFrames(page, { maxWidth = 640, maxHeight = 480 } = {}) {
  const cdp = await page.context().newCDPSession(page).catch(() => null);
  if (!cdp) return null;
  const shots = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    shots.push({ t: metadata.timestamp * 1000, png: Buffer.from(data, 'base64') });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth, maxHeight, everyNthFrame: 1 });
  return {
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      return shots.map((s) => ({ ...s, px: decodePng(s.png) }));
    },
  };
}

const differ = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]) > 24;
const stepOf = (a) => Math.max(1, Math.floor(Math.min(a.width, a.height) / 120));

export function diffRatio(a, b) {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const step = stepOf(a);
  let n = 0, d = 0;
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) { n++; if (differ(a.at(x, y), b.at(x, y))) d++; }
  }
  return n ? d / n : 0;
}

export function diffBox(a, b) {
  const step = stepOf(a);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) {
      if (!differ(a.at(x, y), b.at(x, y))) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + step, h: y1 - y0 + step };
}

export function frameFlashes(frames, { maxMs = 120, eps = 0.002, min = 0.005 } = {}) {
  const out = [];
  for (let i = 1; i + 1 < frames.length; i++) {
    const [a, b, c] = [frames[i - 1], frames[i], frames[i + 1]];
    const ms = c.t - b.t;
    if (ms >= maxMs) continue;
    if (diffRatio(a.px, c.px) > eps) continue;
    const ratio = diffRatio(a.px, b.px);
    if (ratio < min) continue;
    out.push({ i, at: b.t, ms: Math.round(ms), ratio: Number(ratio.toFixed(3)) });
  }
  return out;
}

export function evidenceFrames(frames, e) {
  if (!frames.length) return [];
  const at = (k) => frames[Math.min(frames.length - 1, Math.max(0, k))];
  if (e.kind === 'frame' && Number.isInteger(e.i)) return [at(e.i - 1), at(e.i), at(e.i + 1)];
  const last = (t) => frames.findLastIndex((x) => x.t < t);
  const after = frames.findIndex((x) => x.t >= e.at);
  return [at(last(e.at - (e.ms || 0))), at(last(e.at)), at(after < 0 ? frames.length - 1 : after)];
}

export function confirm(runs, { min = 2 } = {}) {
  const agg = new Map();
  for (const run of runs) {
    const once = new Set();
    for (const [journey, events] of Object.entries(run)) {
      for (const e of events) {
        const fp = fingerprint(journey, e);
        let a = agg.get(fp);
        if (!a) agg.set(fp, (a = { fp, journey, kind: e.kind, sel: e.sel, runs: 0, ms: 0, value: 0, detail: e.detail ?? '' }));
        a.ms = Math.max(a.ms, e.ms ?? 0);
        a.value = Math.max(a.value, e.value ?? 0);
        if (!once.has(fp)) { once.add(fp); a.runs++; }
      }
    }
  }
  return [...agg.values()].filter((a) => a.runs >= min).sort((x, y) => y.runs - x.runs || x.fp.localeCompare(y.fp));
}

export function regressed(seen, fixed) {
  const back = new Set();
  for (const [journey, events] of Object.entries(seen)) {
    for (const e of events) {
      const fp = fingerprint(journey, e);
      if (GATED.includes(e.kind) && Object.hasOwn(fixed, fp)) back.add(fp);
    }
  }
  return [...back];
}
