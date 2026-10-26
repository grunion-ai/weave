import { NOTE, PLATFORM, sectionOf } from './cutoff.mjs';
import { ROUTES, plan, readyOf, rootsOf } from './states.mjs';

export { NOTE, PLATFORM, sectionOf };
export const MIN = 44;
export const SPAN = MIN - 1;
export const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
export const ENGINES = ['chromium', 'webkit'];
export const themesOn = (engine) => (engine === 'chromium' ? ['light', 'dark'] : ['light']);

export const SWEEP = (roots) => {
  const SEL = 'a[href], button, [role="button"], summary, input:not([type="hidden"]), select, textarea, tbody tr.entity-row';
  const tops = roots.flatMap((r) => [...document.querySelectorAll(r)]);
  const inRoot = (n) => tops.some((t) => t.contains(n));
  const shown = (n) => {
    const r = n.getBoundingClientRect();
    if (!r.width || !r.height || !n.getClientRects().length) return false;
    const shut = n.closest('details:not([open])');
    if (n.disabled || (shut && n !== shut.querySelector(':scope > summary'))) return false;
    const cs = getComputedStyle(n);
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none';
  };
  const label = (n) => {
    const cls = [...n.classList].slice(0, 2).join('.');
    const name = (n.getAttribute('aria-label') || n.title || n.dataset.field || (n.textContent || '').trim().slice(0, 32) || '').replace(/\s+/g, ' ');
    return `${n.tagName.toLowerCase()}${cls ? `.${cls}` : ''} "${name}"`;
  };
  const owns = (n, hit) => !!hit && (hit === n || n.contains(hit));
  const overlay = (n, hit) => {
    for (let p = hit; p && p !== document.documentElement; p = p.parentElement) {
      if (/fixed|sticky/.test(getComputedStyle(p).position)) return !p.contains(n);
    }
    return false;
  };
  const reach = (n, cx, cy, dx, dy) => {
    let far = 0;
    for (let d = 0.5; d <= 22; d += 0.5) {
      const x = cx + dx * d, y = cy + dy * d;
      if (x < 0 || y < 0 || x > innerWidth - 1 || y > innerHeight - 1) return 22;
      const hit = document.elementFromPoint(x, y);
      if (!owns(n, hit)) return overlay(n, hit) ? 22 : far;
      far = d;
    }
    return far;
  };
  const found = tops.flatMap((t) => [...t.querySelectorAll(SEL)]).filter(shown);
  const candidates = new Set(found);
  const out = [];
  for (const n of found) {
    const r = n.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!owns(n, hit)) {
      if (!hit || !inRoot(hit) || overlay(n, hit)) continue;
      let up = hit;
      while (up && !candidates.has(up)) up = up.parentElement;
      if (up && up.contains(n)) continue;
      out.push({ label: label(n), left: 0, right: 0, up: 0, down: 0, over: label(hit) });
      continue;
    }
    out.push({
      label: label(n),
      left: reach(n, cx, cy, -1, 0), right: reach(n, cx, cy, 1, 0),
      up: reach(n, cx, cy, 0, -1), down: reach(n, cx, cy, 0, 1),
    });
  }
  return out;
};

export const small = (seen) => seen.filter((c) => c.left + c.right < SPAN || c.up + c.down < SPAN);
export const say = (c) => (c.over ? `${c.label} is covered by ${c.over}` : `${c.label} taps ${c.left + c.right}x${c.up + c.down} of the ${MIN}px minimum`);
export const controlOf = (c) => `${c.label.replace(/ ".*$/s, '')}${c.over ? ' covered' : ''}`;
export const fingerprint = (state, c, engine) => `${state}|${controlOf(c)}|${engine}`;
export const rowKey = (fp) => fp.split('|').slice(0, 2).join('|');
export const engineOf = (fp) => fp.split('|')[2];

export function tally(findings) {
  const counts = {};
  for (const f of findings) counts[f.fp] = (counts[f.fp] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export function lower(file, counts, { engines, platform = PLATFORM }) {
  const mine = (fp) => engines.includes(engineOf(fp));
  if (!Object.hasOwn(file, platform)) return { ...file, [platform]: Object.fromEntries(Object.entries(counts).filter(([fp]) => mine(fp))) };
  const next = {};
  for (const [fp, was] of Object.entries(file[platform])) {
    const n = mine(fp) ? Math.min(was, counts[fp] ?? 0) : was;
    if (n) next[fp] = n;
  }
  return { ...file, [platform]: next };
}

export const surfaces = () => plan('touch');

export async function measure(browser, profile, theme, entry, ctx) {
  const { state } = entry;
  const page = await browser.newPage(profile);
  page.setDefaultTimeout(10000);
  try {
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(ROUTES[state.route].url(ctx, 'phone'), { waitUntil: 'networkidle' });
    await page.waitForSelector(readyOf(state, 'phone'), { state: 'attached' });
    if (state.act) {
      await state.act(page, ctx, 'phone');
      await page.waitForSelector(rootsOf(state)[0]);
    }
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
    return await page.evaluate(SWEEP, rootsOf(state));
  } finally { await page.close(); }
}
