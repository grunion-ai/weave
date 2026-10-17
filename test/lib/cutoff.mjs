import { JOURNEYS, cellsOf, seed as journeySeed, walk } from './journeys.mjs';
import { OVERLAYS, SURFACES, overlaysFor } from './overlays.mjs';

export const KINDS = ['clipped', 'ellipsis', 'line-clamp', 'field-value', 'field-placeholder'];
export const DESKTOP = 'desktop';
export const NOTE = '_';

export const CELLS = {
  desktop: { engine: 'chromium', viewport: { width: 1440, height: 900 } },
  phone: { engine: 'webkit', device: 'iPhone 15', viewport: { width: 390, height: 844 } },
};

export function probe(rootSelector = null) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION', 'OPTGROUP', 'SELECT', 'DATALIST', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO', 'IMG', 'BR', 'HR']);
  const NOT_TEXT = new Set(['checkbox', 'radio', 'hidden', 'range', 'color', 'file', 'submit', 'button', 'reset', 'image', 'password', 'date', 'time', 'datetime-local', 'month', 'week']);
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
    if (own.right <= 0 || own.bottom <= 0 || own.left >= innerWidth || own.top >= innerHeight) return true;
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
  const textOverflow = (e, own) => {
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

  const roots = rootSelector ? [...document.querySelectorAll(rootSelector)] : [document.body];
  const out = [];
  const visited = new Set();
  const push = (kind, e, text, px) => out.push({ kind, selector: selector(e), text: clean(text), px: Math.round(px) });
  for (const root of roots) {
    for (const e of [root, ...root.querySelectorAll('*')]) {
      if (visited.has(e)) continue;
      visited.add(e);
      if (SKIP.has(e.tagName) || e instanceof SVGElement) continue;
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
        if (over > 1) push(kind, e, text, over);
        continue;
      }
      if (ellipsis && e.scrollWidth - e.clientWidth > 1 && e.textContent.trim()) {
        push('ellipsis', e, e.textContent, e.scrollWidth - e.clientWidth);
        continue;
      }
      if (clamp && e.scrollHeight - e.clientHeight > 1 && e.textContent.trim()) {
        push('line-clamp', e, e.textContent, e.scrollHeight - e.clientHeight);
        continue;
      }
      if (!own.length) continue;
      const over = textOverflow(e, own);
      if (over > 1) push('clipped', e, e.textContent, over);
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

export function seed(weave) {
  const handles = journeySeed(weave);
  const { tasks, ids } = handles;
  weave.addField(tasks, { name: 'Due', type: 'date' });
  weave.addField(tasks, { name: 'Window', type: 'daterange', config: { format: 'long' } });
  weave.addField(tasks, { name: 'Link', type: 'url' });
  weave.addField(tasks, { name: 'Tags', type: 'multiselect', config: { options: ['Short', 'A tag whose label runs long enough to need a wrap'] } });
  for (const [i, id] of ids.entries()) {
    if (i % 3) continue;
    weave.updateEntity(id, {
      Due: `2026-${String((i % 12) + 1).padStart(2, '0')}-15`,
      Window: { start: '2026-08-01', end: '2026-09-15' },
      Link: i % 2 ? 'https://example.com/' : `https://docs.example.com/guides/a-path-that-keeps-going/${i}/and-going`,
      Tags: i % 2 ? ['Short'] : ['Short', 'A tag whose label runs long enough to need a wrap'],
    });
  }
  const notes = weave.createTable({ space: 'Work', name: 'Note' });
  weave.addField(notes, { name: 'Link', type: 'url' });
  for (const name of ['Spec', 'Release note', 'Customer summary']) weave.addField(notes, { name, type: 'document' });
  const activity = weave.createEntity(notes, { name: 'Log', doc: 'First draft.' }).id;
  weave.setDoc(activity, 'Spec text.', 'Spec');
  weave.setDoc(activity, 'Release text.', 'Release note');
  weave.setDoc(activity, 'Summary text.', 'Customer summary');
  weave.updateEntity(activity, { Link: 'https://adriany.fibery.io/Task_Management/Task/a-path-that-keeps-going-past-the-panel-1234' });
  return { ...handles, notes, activity };
}

const phoneCell = (page) => (page.viewportSize()?.width ?? 1440) < 768;

export const ACTIVITY_JOURNEY = {
  name: 'activity-panel',
  cells: ['desktop', 'phone'],
  root: 'aside.wv-activity, .wv-act-view',
  async setup(page, ctx) {
    const phone = phoneCell(page);
    await page.goto(phone ? `${ctx.base}/#/table/${ctx.notes.id}?e=${ctx.activity}` : `${ctx.base}/#/entity/${ctx.activity}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${phone ? '#dock:not([hidden])' : '#main'} .activity-btn`);
  },
  async run(page) {
    const phone = phoneCell(page);
    const btn = page.locator(`${phone ? '#dock' : '#main'} .activity-btn >> visible=true`).first();
    await (phone ? btn.tap() : btn.click());
    const link = page.locator('.wv-activity .wv-act-row').filter({ has: page.locator('.name', { hasText: /^Link$/ }) }).first();
    await link.waitFor();
    await (phone ? link.locator('.wv-act-what').tap() : link.locator('.wv-act-what').click());
    await page.waitForSelector('.wv-activity .wv-act-row.sel .wv-act-tray');
  },
};

export const SWEEP_JOURNEYS = [...JOURNEYS, ACTIVITY_JOURNEY];

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);

export async function settle(page) {
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 3000 }).catch(() => {});
  await frames(page, 2);
}

export async function sweepCell(browser, cell, ctx, { page: pageOptions = {}, journeys = SWEEP_JOURNEYS, overlays = OVERLAYS } = {}) {
  const findings = [];
  const failed = [];
  const timings = [];
  const read = async (page, where, root = null) => {
    await settle(page);
    const t0 = performance.now();
    const got = await page.evaluate(probe, root);
    timings.push(performance.now() - t0);
    for (const f of got) findings.push({ ...f, cell, where });
  };
  const noop = async () => {};
  for (const j of journeys.filter((x) => cellsOf(x).includes(cell))) {
    try {
      await walk(browser, j, ctx, { ...pageOptions, probe: { install: noop, reset: noop, read: (page) => read(page, `journey:${j.name}`, j.root ?? null) } });
    } catch (err) {
      failed.push({ where: `journey:${j.name}`, cell, error: String(err.message).split('\n')[0] });
    }
  }
  const page = await browser.newPage(pageOptions);
  page.setDefaultTimeout(8000);
  try {
    for (const surface of Object.keys(SURFACES)) {
      const mine = overlaysFor(overlays, surface, cell);
      if (!mine.length) continue;
      const ready = SURFACES[surface].ready(cell);
      const fresh = async () => {
        await page.goto('about:blank');
        await page.goto(SURFACES[surface].url(ctx, cell), { waitUntil: 'networkidle' });
        await page.waitForSelector(ready);
        await settle(page);
      };
      let clean = false;
      for (const o of mine) {
        try {
          if (!clean) await fresh();
          clean = false;
          await o.open(page, ctx, cell);
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
