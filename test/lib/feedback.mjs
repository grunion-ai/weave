import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BUDGET_FILE = 'test/feedback-budget.json';

export const API_DELAY_MS = 1000;

export const RUNS = 3;

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));

export function skeletonDelay(dir = PUBLIC) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const m = /\bSKELETON_SHOW_AFTER_MS\s*=\s*(\d+)/.exec(readFileSync(`${dir}${f}`, 'utf8'));
    if (m) return Number(m[1]);
  }
  throw new Error('no SKELETON_SHOW_AFTER_MS in public/*.js (app.js holds the skeleton delay)');
}

export const VISUAL_BUSY = '.sk-toolbar, .sk-card, .sk-entity, .grid-loader, #page-loader';
export const ARIA_BUSY = '[aria-busy="true"]';

export function median(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
}

export const feedbackOf = (acts) => {
  const answered = acts.filter((a) => Number.isFinite(a.ms));
  return answered.length ? Math.max(...answered.map((a) => a.ms)) : null;
};

export function judgeMs(key, ms, budget) {
  if (!Number.isFinite(ms)) return `${key} painted nothing after its action, so it has no feedback time: the journey must change the screen`;
  const n = Math.round(ms);
  if (!(key in budget)) return `${key} has no feedback budget: add "${key}": ${n} to ${BUDGET_FILE}`;
  const cap = budget[key];
  if (n > cap) return `${key} first answered on screen ${n} ms after its action, budget ${cap} ms, with the API held ${API_DELAY_MS} ms: paint the action before the server answers, or raise ms["${key}"] in ${BUDGET_FILE} and write why under raised["${key}"]`;
  return null;
}

export function busyFaults(spans, skeletonMs) {
  const out = [];
  for (const s of spans) {
    if (s.visual && s.since < skeletonMs) out.push(`${s.sel} showed a loading state ${Math.round(s.since)} ms after ${s.act}, inside the ${skeletonMs} ms skeleton delay`);
    else if (s.off != null && s.off - s.at < skeletonMs) out.push(`${s.sel} went busy ${Math.round(s.since)} ms after ${s.act} and settled ${Math.round(s.off - s.at)} ms after it: an action that settles inside the ${skeletonMs} ms skeleton delay shows no busy state`);
  }
  return out;
}

function probe({ visual, aria }) {
  const now = () => performance.now();
  const acts = (window.__fbActs = [{ t: 0, kind: 'load', mutated: null, answer: null }]);
  const spans = (window.__fbSpans = []);
  const act = (kind) => acts.push({ t: now(), kind, mutated: null, answer: null });
  addEventListener('pointerdown', (e) => { if (e.isTrusted && e.isPrimary && e.button === 0) act('press'); }, true);
  addEventListener('keydown', (e) => { if (e.isTrusted && /^(Enter|Tab|Escape)$/.test(e.key)) act(e.key); }, true);
  const open = new Map();
  window.__fbStart = () => { acts.length = 0; spans.length = 0; open.clear(); act('start'); };
  const busyHost = `${visual}, .sk`;
  const shown = (n) => n.isConnected && (n.checkVisibility ? n.checkVisibility() : true);
  const answers = (r) => {
    const t = r.target.nodeType === 1 ? r.target : r.target.parentElement;
    if (!t || !document.body?.contains(t)) return false;
    if (t.closest(busyHost)) return false;
    if (r.type === 'attributes' && r.attributeName === 'aria-busy') return false;
    if (r.type === 'childList' && [...r.addedNodes].some((n) => n.nodeType === 1 && (n.matches(busyHost) || n.querySelector(busyHost)))) return false;
    return shown(t);
  };
  const mo = new MutationObserver((records) => {
    const a = acts.at(-1);
    if (a && a.mutated == null && records.some(answers)) a.mutated = now();
  });
  const start = () => mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  if (document.documentElement) start(); else document.addEventListener('readystatechange', start, { once: true });
  const label = (n) => n.id ? `#${n.id}` : `${n.localName}${[...n.classList].slice(0, 2).map((c) => `.${c}`).join('')}`;
  const tick = () => {
    const t = now();
    const a = acts.at(-1);
    if (a && a.mutated != null && a.answer == null) a.answer = t;
    const seen = new Set();
    const mark = (n, isVisual) => {
      const key = `${isVisual ? 'v' : 'a'}:${label(n)}`;
      seen.add(key);
      if (open.has(key)) return;
      const cur = acts.at(-1) ?? { t: 0, kind: 'load' };
      open.set(key, { sel: isVisual ? label(n) : `${label(n)}[aria-busy]`, visual: isVisual, on: t, at: cur.t, since: t - cur.t, act: cur.kind });
    };
    for (const n of document.querySelectorAll(visual)) {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && n.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false) mark(n, true);
    }
    for (const n of document.querySelectorAll(aria)) mark(n, false);
    for (const [key, s] of open) if (!seen.has(key)) { open.delete(key); spans.push({ ...s, off: t }); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__fbRead = () => ({
    acts: acts.map((x) => ({ kind: x.kind, ms: x.answer == null ? null : x.answer - x.t })),
    spans: [...spans, ...[...open.values()].map((s) => ({ ...s, off: null }))],
  });
}

export function feedbackProbe({ delay = API_DELAY_MS } = {}) {
  return {
    install: (page) => page.addInitScript(probe, { visual: VISUAL_BUSY, aria: ARIA_BUSY }),
    async reset(page) {
      if (delay) await page.route(/\/api\//, async (r) => { await new Promise((res) => setTimeout(res, delay)); await r.continue().catch(() => {}); });
      await page.evaluate(() => window.__fbStart?.());
    },
    read: (page) => page.evaluate(() => window.__fbRead?.() ?? { acts: [], spans: [] }),
  };
}
