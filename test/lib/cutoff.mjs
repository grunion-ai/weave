import { cellsOf, walk } from './journeys.mjs';
import { OVERLAYS, overlaysFor } from './overlays.mjs';
import { DENSITIES, ROUTES, SEEDS, journeyOf, plan, statesOf, walked } from './states.mjs';

export const KINDS = ['clipped', 'ellipsis', 'line-clamp', 'field-value', 'field-placeholder'];
export const ENDING_KINDS = ['sliced-line', 'lone-word', 'unreadable'];
export const DESKTOP = 'desktop';
export const NOTE = '_';

export const CELLS = {
  desktop: { engine: 'chromium', viewport: { width: 1440, height: 900 } },
  phone: { engine: 'webkit', device: 'iPhone 15', viewport: { width: 390, height: 844 } },
};

export function probe(target = null) {
  const { root: rootSelector = null, endings = false } = target && typeof target === 'object' ? target : { root: target };
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'OPTGROUP', 'SELECT', 'DATALIST', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG', 'BR', 'HR']);
  const NOT_TEXT = new Set(['checkbox', 'radio', 'hidden', 'range', 'color', 'file', 'submit', 'button', 'reset', 'image', 'password', 'date', 'time', 'datetime-local', 'month', 'week']);
  const BY_DESIGN = '.crumb-cur > .crumb-nm, .phone-lead > .k-state';
  const MIRRORED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'letterSpacing', 'wordSpacing', 'textTransform', 'textIndent', 'lineHeight', 'tabSize', 'wordBreak', 'overflowWrap',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];
  const styles = new Map();
  const style = (e) => {
    let cs = styles.get(e);
    if (!cs) styles.set(e, (cs = getComputedStyle(e)));
    return cs;
  };
  const clips = (v) => v === 'hidden' || v === 'clip';
  const scrolls = (v) => v === 'auto' || v === 'scroll';
  const clamped = (cs) => parseInt(cs.webkitLineClamp, 10) > 0;
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
  const unseen = (e) => {
    const own = e.getBoundingClientRect();
    if (!own.width || !own.height || style(e).visibility !== 'visible') return true;
    if (own.right <= 0 || own.bottom <= 0 || own.left >= innerWidth || (!endings && own.top >= innerHeight)) return true;
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
      const cs = style(x);
      if (Number(cs.opacity) === 0) return true;
      if (cs.display === 'contents') continue;
      const r = x.getBoundingClientRect();
      const fixed = cs.position === 'fixed';
      const positioned = fixed || cs.position === 'absolute';
      if (positioned && cs.clip && cs.clip !== 'auto') return true;
      if (/inset\((50|100)%/.test(cs.clipPath)) return true;
      if ((clips(cs.overflowX) || clips(cs.overflowY)) && (r.width <= 1 || r.height <= 1)) return true;
      if (positioned && (r.right <= 0 || r.bottom <= 0)) return true;
      if (fixed && (r.left >= innerWidth || r.top >= innerHeight)) return true;
    }
    return false;
  };
  const mirrorOverflow = (e, cs, text) => {
    const area = e.tagName === 'TEXTAREA';
    const m = document.createElement('cutoff-mirror');
    for (const k of MIRRORED) m.style[k] = cs[k];
    Object.assign(m.style, {
      position: 'absolute', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none',
      borderStyle: 'solid', boxSizing: 'border-box', maxWidth: 'none', minWidth: '0',
      display: area ? 'block' : 'inline-block', whiteSpace: area ? 'pre-wrap' : 'pre',
      width: area ? `${e.offsetWidth}px` : 'auto', height: 'auto',
    });
    m.textContent = text;
    document.body.append(m);
    const over = area ? m.offsetHeight - e.offsetHeight : m.offsetWidth - e.offsetWidth;
    m.remove();
    return over;
  };
  const clipBoxes = (e) => {
    const boxes = [];
    let alongX = true;
    let alongY = true;
    for (let x = e; x && x !== document.documentElement && (alongX || alongY); x = x.parentElement) {
      const cs = style(x);
      if (cs.display === 'inline' || cs.display === 'contents') continue;
      if (x !== e && cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible') alongX = false;
      if (x !== e && clamped(cs)) alongY = false;
      const cutX = alongX && clips(cs.overflowX);
      const cutY = alongY && clips(cs.overflowY);
      if (cutX || cutY) boxes.push({ box: paddingBox(x), cutX, cutY });
      if (scrolls(cs.overflowX)) alongX = false;
      if (scrolls(cs.overflowY)) alongY = false;
    }
    return boxes;
  };
  const textOverflow = (e, own) => {
    const boxes = clipBoxes(e);
    if (!boxes.length) return 0;
    let worst = 0;
    const range = document.createRange();
    for (const node of own) {
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (!r.width || !r.height) continue;
        for (const { box, cutX, cutY } of boxes) {
          if (cutX) worst = Math.max(worst, box.left - r.left, r.right - box.right);
          if (cutY) worst = Math.max(worst, box.top - r.top, r.bottom - box.bottom);
        }
      }
    }
    return worst;
  };
  const SLICE = 2;
  const slicedBy = (e, own) => {
    const boxes = clipBoxes(e).filter((b) => b.cutY);
    if (!boxes.length) return 0;
    let worst = 0;
    const range = document.createRange();
    for (const node of own) {
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (!r.width || !r.height) continue;
        for (const { box } of boxes) {
          if (r.top >= box.bottom - 1 || r.bottom <= box.top + 1) break;
          worst = Math.max(worst, r.bottom - box.bottom > SLICE ? r.bottom - box.bottom : 0, box.top - r.top > SLICE ? box.top - r.top : 0);
        }
      }
    }
    return worst;
  };
  const NOT_PROSE = 'button, label, summary, nav, pre, code, td, th, h1, h2, h3, h4, h5, h6, [role="menuitem"], [role="option"], .k, .wv-grid, .crumb';
  const PROSE_DISPLAY = new Set(['block', 'list-item', 'flow-root', '-webkit-box']);
  const words = (e, n) => {
    const nodes = [];
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) nodes.push(t);
    const out = [];
    for (let i = nodes.length - 1; i >= 0 && out.length < n; i--) {
      const hits = [...nodes[i].textContent.matchAll(/\S+/g)];
      for (let j = hits.length - 1; j >= 0 && out.length < n; j--) {
        const range = document.createRange();
        range.setStart(nodes[i], hits[j].index);
        range.setEnd(nodes[i], hits[j].index + hits[j][0].length);
        out.unshift(range);
      }
    }
    return out;
  };
  const loneWord = (e, cs) => {
    if (!PROSE_DISPLAY.has(cs.display) || clamped(cs) || cs.whiteSpace === 'pre' || cs.whiteSpace === 'nowrap' || e.closest(NOT_PROSE)) return 0;
    if (e.textContent.trim().split(/\s+/).length < 5) return 0;
    const [before, last] = words(e, 2);
    if (!last) return 0;
    const a = [...before.getClientRects()].filter((r) => r.width).at(-1);
    const b = [...last.getClientRects()].filter((r) => r.width)[0];
    if (!a || !b || b.top <= a.top + 1) return 0;
    if (a.width + b.width + 4 > e.clientWidth) return 0;
    return b.width;
  };
  const flat = (s) => String(s).replace(/\s+/g, '');
  const readable = (e, text) => {
    const want = flat(text);
    for (let x = e; x && x !== document.body; x = x.parentElement) {
      const title = x.getAttribute('title');
      if (title && flat(title).includes(want)) return true;
      if (x.parentElement?.querySelector(':scope > .view-desc-more')) return true;
    }
    return false;
  };

  const roots = rootSelector ? [...document.querySelectorAll(rootSelector)] : [document.body];
  const out = [];
  const visited = new Set();
  const push = (kind, e, text, px) => out.push({ kind, selector: selector(e), text: clean(text), px: Math.round(px) });
  const cut = (kind, e, text, px) => {
    if (!endings) push(kind, e, text, px);
    else if (!readable(e, text)) push('unreadable', e, text, px);
  };
  for (const root of roots) {
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (visited.has(e)) continue;
      visited.add(e);
      if (SKIP.has(e.tagName) || e instanceof SVGElement || e.matches(BY_DESIGN)) continue;
      const field = e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && !NOT_TEXT.has(e.type));
      const cs = style(e);
      const ellipsis = cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible';
      const clamp = clamped(cs);
      const own = field ? [] : [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!field && !own.length && !ellipsis && !clamp) continue;
      if (unseen(e)) continue;
      if (field) {
        const kind = e.value ? 'field-value' : 'field-placeholder';
        const text = e.value || e.placeholder;
        const over = text ? mirrorOverflow(e, cs, text) : 0;
        if (over > 1) cut(kind, e, text, over);
        continue;
      }
      if (endings && own.length) {
        const slice = slicedBy(e, own);
        if (slice) push('sliced-line', e, e.textContent, slice);
        const lone = loneWord(e, cs);
        if (lone) push('lone-word', e, e.textContent, lone);
      }
      if (ellipsis && e.scrollWidth - e.clientWidth > 1 && e.textContent.trim()) {
        cut('ellipsis', e, e.textContent, e.scrollWidth - e.clientWidth);
        continue;
      }
      if (clamp && e.scrollHeight - e.clientHeight > 1 && e.textContent.trim()) {
        cut('line-clamp', e, e.textContent, e.scrollHeight - e.clientHeight);
        continue;
      }
      if (!own.length) continue;
      const over = textOverflow(e, own);
      if (over > 1) cut('clipped', e, e.textContent, over);
    }
  }
  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const fingerprint = (f, cell = DESKTOP) => `${f.kind}|${String(f.selector).replace(UUID, '#').replace(/\d+/g, '#')}${cell && cell !== DESKTOP ? `|${cell}` : ''}`;
export const cellOf = (fp) => (fp.split('|')[2] ?? DESKTOP);

export function tally(findings) {
  const counts = {};
  for (const f of findings) {
    const fp = fingerprint(f, f.cell);
    counts[fp] = (counts[fp] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
}

const countsOf = (map) => Object.entries(map ?? {}).filter(([k]) => k !== NOTE);
const platformsOf = (file) => Object.keys(file ?? {}).filter((k) => k !== NOTE);

export const PLATFORM = process.platform;
export const sectionOf = (file, platform = PLATFORM) => file?.[platform] ?? {};

export function ratchet(seen, baseline, { cells = null } = {}) {
  const keep = (fp) => !cells || cells.includes(cellOf(fp));
  const added = [];
  const dropped = [];
  for (const [fp, n] of countsOf(seen)) {
    if (!keep(fp)) continue;
    const was = baseline[fp] ?? 0;
    if (n > was) added.push({ fp, seen: n, baseline: was });
  }
  for (const [fp, was] of countsOf(baseline)) {
    if (!keep(fp)) continue;
    const n = seen[fp] ?? 0;
    if (n < was) dropped.push({ fp, seen: n, baseline: was });
  }
  return { added, dropped };
}

export function verdict(seen, baseline, { cells = null } = {}) {
  const { added, dropped } = ratchet(seen, baseline, { cells });
  return { added, stale: dropped };
}

export function grew(before, after) {
  if (!before) return [];
  const out = [];
  for (const platform of platformsOf(after)) {
    if (!Object.hasOwn(before, platform)) continue;
    for (const [fp, n] of countsOf(after[platform])) {
      const was = before[platform][fp] ?? 0;
      if (n > was) out.push({ platform, fp, before: was, after: n });
    }
  }
  return out;
}

export function lower(file, counts, { cells, platform = PLATFORM }) {
  const out = { ...file };
  if (!Object.hasOwn(file, platform)) {
    out[platform] = Object.fromEntries(Object.entries(counts).filter(([fp]) => cells.includes(cellOf(fp))));
    return out;
  }
  const next = {};
  for (const [fp, was] of countsOf(file[platform])) {
    const n = cells.includes(cellOf(fp)) ? Math.min(was, counts[fp] ?? 0) : was;
    if (n) next[fp] = n;
  }
  out[platform] = next;
  return out;
}

export const seed = SEEDS.messy;

export const SWEEP_JOURNEYS = statesOf(plan('cutoff'), 'journey');
export const restsFor = (entries, cell) => entries.filter((p) => p.cell === cell && p.state.open === 'rest').map((p) => p.state);

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);

export async function settle(page) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 3000 }).catch(() => {});
  await frames(page, 2);
}

export async function sweepCell(browser, cell, ctx, { page: pageOptions = {}, journeys = SWEEP_JOURNEYS, overlays = OVERLAYS, rests = restsFor(walked('cutoff'), cell), target = (root) => root } = {}) {
  const findings = [];
  const failed = [];
  const timings = [];
  const read = async (page, where, root = null) => {
    await settle(page);
    const t0 = performance.now();
    const got = await page.evaluate(probe, target(root));
    timings.push(performance.now() - t0);
    for (const f of got) findings.push({ ...f, cell, where });
  };
  const noop = async () => {};
  const walks = [...journeys.filter((x) => cellsOf(x).includes(cell)), ...rests.map((x) => journeyOf(x, cell))];
  for (const j of walks) {
    const where = `${j.open}:${j.name}`;
    try {
      await walk(browser, j, ctx, { ...pageOptions, probe: { install: noop, reset: noop, read: (page) => read(page, where, j.root ?? null) } });
    } catch (err) {
      failed.push({ where, cell, error: String(err.message).split('\n')[0] });
    }
  }
  const page = await browser.newPage(pageOptions);
  page.setDefaultTimeout(8000);
  try {
    for (const route of Object.keys(ROUTES)) {
      const mine = overlaysFor(overlays, route, cell);
      if (!mine.length) continue;
      const ready = ROUTES[route].ready(cell);
      const fresh = async () => {
        await page.goto('about:blank');
        await page.goto(ROUTES[route].url(ctx, cell), { waitUntil: 'networkidle' });
        await page.waitForSelector(ready);
        await settle(page);
      };
      let clean = false;
      for (const o of mine) {
        try {
          if (!clean) await fresh();
          clean = false;
          await o.act(page, ctx, cell);
          await page.locator(`${o.root} >> visible=true`).first().waitFor({ timeout: 8000 });
          await read(page, `overlay:${o.name}`, o.root);
          await (o.close ?? ((p) => p.keyboard.press('Escape')))(page, ctx, cell);
          clean = await page.waitForFunction(([sel, home]) => ![...document.querySelectorAll(sel)].some((n) => n.getClientRects().length) && !!document.querySelector(home)?.getClientRects().length, [o.root, ready], { timeout: 2000 }).then(() => true, () => false);
        } catch (err) {
          failed.push({ where: `overlay:${o.name}`, cell, error: String(err.message).split('\n')[0] });
          clean = false;
        }
      }
    }
  } finally {
    await page.close();
  }
  return { findings, failed, timings };
}

export const proseSeed = SEEDS.prose;
export const endingPrint = (f) => `${f.kind}|${String(f.selector).replace(UUID, '#').replace(/\d+/g, '#')}|${f.cell}|${f.density}`;

export function setDensity(weave, density) {
  for (const table of weave.listTables()) {
    for (const view of weave.tableView(table).views) weave.tableView(`${table.id}/${view.name}`, { density });
  }
}

export async function sweepEndings(browser, cell, ctx, { page, densities = DENSITIES } = {}) {
  const findings = [];
  const failed = [];
  const entries = walked('endings').filter((p) => p.cell === cell);
  for (const density of densities) {
    setDensity(ctx.weave, density);
    const mine = entries.filter((p) => p.density === density || (p.density === null && density === 'comfortable'));
    const got = await sweepCell(browser, cell, ctx, {
      page,
      journeys: statesOf(mine, 'journey'),
      overlays: statesOf(mine, 'overlay'),
      rests: statesOf(mine, 'rest'),
      target: (root) => ({ root, endings: true }),
    });
    for (const f of got.findings) findings.push({ ...f, density });
    for (const f of got.failed) failed.push({ ...f, density });
  }
  return { findings, failed };
}
