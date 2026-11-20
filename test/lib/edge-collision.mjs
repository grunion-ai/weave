import { SEEDS, ROUTES } from './states.mjs';
import { settle } from './cutoff.mjs';

export const KINDS = ['overlap', 'clipped', 'off-screen'];
export const TOLERANCE = 2;
export const DESKTOP_WIDTHS = [1920, 1440, 1280, 1024, 960, 768];
export const PHONE_WIDTH = 390;
export const WIDTHS = [...DESKTOP_WIDTHS, PHONE_WIDTH];
export const THEME = 'light';
export const PLATFORMS = ['darwin', 'linux'];
export const PLATFORM = process.platform;
export const seed = SEEDS.messy;

export const sectionOf = (file, platform = PLATFORM) => file?.[platform] ?? [];

const fold = (s) => String(s ?? '').replace(/\d+/g, '#');
export const keyOf = (f) => `${f.screen}|${f.width}|${f.theme}|${f.kind}|${[f.a, f.b].filter((n) => n != null).map(fold).sort().join(' + ')}`;

export function ratchet(found, entries) {
  const seen = new Map();
  for (const f of found) if (!seen.has(keyOf(f))) seen.set(keyOf(f), f);
  const held = new Map();
  const doubled = [];
  for (const e of entries) {
    if (held.has(keyOf(e))) doubled.push(keyOf(e));
    else held.set(keyOf(e), e);
  }
  return {
    fresh: [...seen].filter(([k]) => !held.has(k)).map(([, f]) => f),
    gone: [...held].filter(([k]) => !seen.has(k)).map(([, e]) => e),
    unfiled: entries.filter((e) => !(Number.isInteger(e.issue) && e.issue > 0)),
    doubled,
  };
}

export function probe(tolerance = 2) {
  const PICK = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])';
  const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog, [popover], .chip-pop, .picker-pop, .date-pop, .cell-pop, .wv-menu';
  const styles = new Map();
  const style = (e) => {
    let cs = styles.get(e);
    if (!cs) styles.set(e, (cs = getComputedStyle(e)));
    return cs;
  };
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const part = (x) => x.tagName.toLowerCase() + (x.id ? `#${x.id}` : '') + [...x.classList].slice(0, 2).map((c) => `.${c}`).join('');
  const selector = (e) => {
    const parts = [];
    for (let x = e; x && x !== document.body && parts.length < 4; x = x.parentElement) parts.unshift(part(x));
    return parts.join(' > ');
  };
  const nameOf = (e) => {
    const by = e.getAttribute('aria-labelledby');
    const labelled = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '';
    const field = e.matches('input, select, textarea') ? (e.labels?.[0]?.textContent || e.getAttribute('placeholder') || e.getAttribute('title') || e.name || e.type) : '';
    return clean(e.getAttribute('aria-label') || labelled || field || e.textContent || e.getAttribute('title') || e.querySelector('img[alt]')?.alt) || part(e);
  };
  const view = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
  const meet = (a, b) => ({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const real = (b) => b.right - b.left > tolerance && b.bottom - b.top > tolerance;
  const round = (b) => [b.left, b.top, b.right, b.bottom].map(Math.round);
  const unseen = (e) => {
    if (style(e).visibility !== 'visible' || style(e).pointerEvents === 'none') return true;
    for (let x = e; x; x = x.parentElement) if (Number(style(x).opacity) === 0) return true;
    return false;
  };
  const sealed = (o) => o === 'hidden' || o === 'clip';
  const clipOf = (e, r) => {
    const box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    let cut = null;
    let mode = style(e).position;
    for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
      const cs = style(x);
      const contains = cs.transform !== 'none' || cs.filter !== 'none' || /paint|strict|content/.test(cs.contain);
      if (mode === 'fixed' && !contains) continue;
      if (mode === 'absolute' && !contains && cs.position === 'static') continue;
      mode = cs.position === 'fixed' || cs.position === 'absolute' ? cs.position : 'static';
      if (cs.display === 'contents' || cs.display === 'inline') continue;
      const ox = cs.overflowX;
      const oy = cs.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      const b = x.getBoundingClientRect();
      const p = { left: b.left + x.clientLeft, top: b.top + x.clientTop, right: b.left + x.clientLeft + x.clientWidth, bottom: b.top + x.clientTop + x.clientHeight };
      const seen = meet(r, box);
      if (ox !== 'visible') {
        box.left = Math.max(box.left, p.left);
        box.right = Math.min(box.right, p.right);
        const lost = Math.max(p.left - seen.left, seen.right - p.right);
        if (!cut && (sealed(ox) ? lost > tolerance : p.left - seen.left > tolerance && x.scrollLeft <= 0)) cut = { by: x, px: Math.round(lost) };
      }
      if (oy !== 'visible') {
        box.top = Math.max(box.top, p.top);
        box.bottom = Math.min(box.bottom, p.bottom);
        const lost = Math.max(p.top - seen.top, seen.bottom - p.bottom);
        if (!cut && (sealed(oy) ? lost > tolerance : p.top - seen.top > tolerance && x.scrollTop <= 0)) cut = { by: x, px: Math.round(lost) };
      }
    }
    return { box, cut };
  };
  const points = (b) => {
    const xs = [b.left + 1, (b.left + b.right) / 2, b.right - 1];
    const ys = [b.top + 1, (b.top + b.bottom) / 2, b.bottom - 1];
    return xs.flatMap((x) => ys.map((y) => document.elementFromPoint(x, y)));
  };
  const layerOf = (e) => {
    const overlay = e.closest(OVERLAY);
    if (overlay) return overlay;
    for (let x = e.parentElement; x; x = x.parentElement) if (style(x).position === 'fixed') return x;
    return null;
  };
  const roomy = (x) => {
    const cs = style(x);
    const across = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && x.scrollWidth > x.clientWidth + 1;
    const down = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && x.scrollHeight > x.clientHeight + 1;
    return across || down;
  };
  const stickyRoot = (e, S) => {
    let root = null;
    for (let x = e; x && x !== S; x = x.parentElement) if (style(x).position === 'sticky') root = x;
    return root;
  };
  const slidesUnder = (x, y) => {
    for (let S = x.parentElement; S && S !== document.body; S = S.parentElement) {
      if (!roomy(S)) continue;
      if (S.contains(y) ? stickyRoot(x, S) !== stickyRoot(y, S) : !stickyRoot(x, S)) return true;
    }
    return false;
  };

  const out = [];
  const items = [];
  const canScrollDown = document.scrollingElement.scrollHeight > innerHeight + tolerance;
  for (const e of document.querySelectorAll(PICK)) {
    if (e.closest('[inert]') || !e.getClientRects().length || unseen(e)) continue;
    const r = e.getBoundingClientRect();
    const { box, cut } = clipOf(e, r);
    const inside = meet(r, box);
    const shown = meet(inside, view);
    if (!real(shown)) continue;
    const name = nameOf(e);
    if (cut) out.push({ kind: 'clipped', a: name, sa: selector(e), sb: selector(cut.by), px: cut.px, boxA: round(r), boxB: round(cut.by.getBoundingClientRect()) });
    else {
      const past = Math.max(inside.right - view.right, view.left - inside.left, canScrollDown ? 0 : inside.bottom - view.bottom);
      if (past > tolerance) out.push({ kind: 'off-screen', a: name, sa: selector(e), px: Math.round(past), boxA: round(r) });
    }
    const seen = points(shown);
    items.push({ e, name, shown, seen, layer: layerOf(e), floats: style(e).position === 'fixed', live: seen.some((at) => at && e.contains(at)) });
  }
  const owner = (n) => items.find((i) => i.e.contains(n) && !items.some((j) => j !== i && i.e.contains(j.e) && j.e.contains(n)));
  const counted = items.filter((i) => i.live || i.seen.every((at) => {
    const by = at && owner(at);
    return !!by && by !== i && (by.layer === i.layer || by.floats);
  }));
  counted.sort((a, b) => a.shown.top - b.shown.top);
  for (let i = 0; i < counted.length; i++) {
    const a = counted[i];
    for (let j = i + 1; j < counted.length && counted[j].shown.top < a.shown.bottom - tolerance; j++) {
      const b = counted[j];
      if ((a.layer !== b.layer && !a.floats && !b.floats) || a.e.contains(b.e) || b.e.contains(a.e) || slidesUnder(a.e, b.e) || slidesUnder(b.e, a.e)) continue;
      const o = meet(a.shown, b.shown);
      if (!real(o)) continue;
      const top = document.elementFromPoint((o.left + o.right) / 2, (o.top + o.bottom) / 2);
      const inA = !!top && a.e.contains(top);
      const inB = !!top && b.e.contains(top);
      if (inA && inB) continue;
      out.push({ kind: 'overlap', a: a.name, b: b.name, on: inA ? a.name : inB ? b.name : top ? part(top) : null, sa: selector(a.e), sb: selector(b.e), px: [Math.round(o.right - o.left), Math.round(o.bottom - o.top)], boxA: round(a.shown), boxB: round(b.shown) });
    }
  }
  return out;
}

const ROW = '.wv-grid tbody tr.entity-row';
const tap = (page, sel, phone) => {
  const target = page.locator(`${sel} >> visible=true`).first();
  return phone ? target.tap() : target.click();
};
const tools = async (page, phone) => {
  if (!phone || await page.locator('#main .crumb-row.tools-open > .crumb-actions').count()) return;
  await tap(page, '#main .table-tools-btn', phone);
  await page.waitForSelector('#main .crumb-row.tools-open > .crumb-actions');
};
const table = { url: (c) => ROUTES.table.url(c), ready: () => ROW };

export const SCREENS = [
  { name: 'home', url: (c) => ROUTES.home.url(c), ready: () => '#main .view-header' },
  { name: 'space', url: (c) => ROUTES.space.url(c), ready: (phone) => (phone ? '#main .view-header' : ROUTES.space.ready()) },
  { name: 'table', ...table },
  { name: 'board', url: (c) => ROUTES.board.url(c), ready: () => ROUTES.board.ready() },
  {
    name: 'view-panel', ...table,
    async act(page, c, phone) {
      await tools(page, phone);
      await tap(page, '#main .table-view-btn', phone);
      await page.waitForSelector(phone ? '.table-view-popover' : '#view-pane:not([hidden]) .vp-foot');
    },
  },
  {
    name: 'share-panel', ...table,
    async act(page, c, phone) {
      await tools(page, phone);
      await tap(page, '#main .table-share-btn', phone);
      await page.waitForSelector('#share-pane:not([hidden]) .share-add');
    },
  },
  { name: 'record-beside', url: (c) => `${c.base}/#/table/${c.table}?e=${c.ids[3]}`, ready: () => '#dock:not([hidden]) .entity-fields .fieldrow[data-field="Status"]' },
  { name: 'record-page', url: (c, phone) => ROUTES.entity.url(c, phone ? 'phone' : 'desktop'), ready: (phone) => ROUTES.entity.ready(phone ? 'phone' : 'desktop') },
  { name: 'document', url: (c, phone) => (phone ? `${c.base}/#/table/${c.table}?e=${c.doc}` : `${c.base}/#/entity/${c.doc}`), ready: () => '.vditor-ir [contenteditable="true"]' },
  {
    name: 'command-menu', url: (c) => ROUTES.home.url(c), ready: () => '#main .view-header',
    async act(page, c, phone) {
      const opener = page.locator(`${phone ? '.phone-search' : '.search-like'} >> visible=true`);
      if (await opener.count()) await tap(page, phone ? '.phone-search' : '.search-like', phone);
      else await page.evaluate(() => openPalette());
      await page.waitForSelector('#cmdk-input');
      await page.keyboard.type('Task');
      await page.waitForSelector('#cmdk-results .result');
    },
  },
];

export async function sweepScreen(screen, ctx, cells) {
  const findings = [];
  const failed = [];
  let measured = 0;
  for (const cell of cells) {
    if (!cell.browser) {
      failed.push({ width: cell.width, error: 'no browser for this width' });
      continue;
    }
    const page = await cell.browser.newPage(cell.page);
    page.setDefaultTimeout(10000);
    try {
      await page.goto(screen.url(ctx, !!cell.phone), { waitUntil: 'networkidle' });
      await page.waitForSelector(screen.ready(!!cell.phone));
      await settle(page);
      await screen.act?.(page, ctx, !!cell.phone);
      await settle(page);
      const got = await page.evaluate(probe, TOLERANCE);
      measured++;
      for (const f of got) findings.push({ screen: screen.name, width: cell.width, theme: THEME, ...f });
    } catch (err) {
      failed.push({ width: cell.width, error: String(err.message).split('\n')[0] });
    } finally {
      await page.close();
    }
  }
  return { findings, failed, measured };
}
