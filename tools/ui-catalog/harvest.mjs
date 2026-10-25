export const PAGE_LIB = () => {
  const CONTAINERS = [
    ['dialog', '.modal-dialog, dialog[open], [role=dialog], [role=alertdialog], .attach-sheet, .new-row-sheet, .key-sheet, .cmdk, .bug-sheet, [class$=-sheet], [class*="-sheet "]'],
    ['popover', '[class*=popover], [role=tooltip], .tooltip'],
    ['menu', '[role=menu], [role=listbox]:not(select), .wv-menu, .nav-menu, .field-menu, .dl-menu, .dropdown-menu, .crumb-fold-menu, .nav-account-menu'],
    ['picker', '.picker-pop, .chip-pop, .date-pop, .cell-pop, .value-pop'],
    ['toast', '.wv-toast'],
  ];
  const LEAVES = [
    ['chip', '.chip, .chip-trigger, .k-select, .k-state, .k-multi, .wv-tag, .filter-chip, .auto-pill, .share-chip, .doc-chip, .picker-chip, .list-chip, .fx-chip, .badge, .list-group-chip, .nav-account-chip, .wv-chip-id, .opt-dot, .wv-card-state'],
    ['toggle', 'input[type=checkbox], input[type=radio], [role=switch], .wv-toggle, .switch, .form-check, .form-switch'],
    ['tabs', '[role=tablist], .seg-ctl, .list-segs, .new-row-seg, .view-tab'],
    ['button', 'button, a.btn, [role=button], summary, input[type=button], input[type=submit]'],
    ['input', 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=button]):not([type=submit]), textarea, select'],
    ['card', '.wv-card, .card, .sk-card, .fx-sigcard, .wv-act-card'],
    ['empty', '.wv-empty, .is-empty, .empty-note, .k-empty, .picker-empty, .table-search-empty, .wv-members-empty, .cmdk-empty, .view-desc-empty'],
    ['nav', '.crumb-row, .nav-space-row, .nav-db, .ws-icon, .nav-foot, .nav-account, .nav-identity, .nav-menu-row, .crumb-nav'],
    ['bar', '.wv-toolbar, .table-tools, .view-header, .sk-toolbar, .vditor-toolbar, .wv-act-bar, .wv-bar-dock, .phone-bar, .file-viewer-bar, .fsv-bar, .doc-expand-bar'],
    ['cell', '.table-wrap tbody td, .table-wrap thead th, .table-wrap tfoot td, .fieldrow'],
  ];
  const ROWISH = '[role=menuitem], [role=option], .wv-menu-row, .nav-menu-row, .picker-row, .chip-pop-row, .dropdown-item';
  const MENUISH = CONTAINERS.slice(1, 4).map((c) => c[1]).join(',');
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const clsOf = (el) => [...el.classList].filter((c) => !/^(hover|focus|focus-visible|wv-flash|is-hover)$/.test(c)).sort().join('.');
  const look = (el) => {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return [cs.backgroundColor, cs.color, cs.borderTopColor, cs.borderTopWidth, cs.borderRadius, Math.round(r.height / 2) * 2, cs.fontSize, cs.fontWeight, cs.paddingLeft, cs.textTransform].join('|');
  };
  const textOf = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const opaqueBg = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && b !== 'transparent' && !/rgba\(.*, 0\)$/.test(b)) return b; } return getComputedStyle(document.body).backgroundColor; };
  const chain = (el) => { const out = []; for (let e = el.parentElement; e; e = e.parentElement) { const a = {}; for (const at of e.attributes) if (/^(id|class|role|data-bs-theme|data-kind|data-type|data-view|data-density|data-field-type)$/.test(at.name)) a[at.name] = at.value.slice(0, 300); out.unshift({ t: e.tagName.toLowerCase(), a }); } return out; };
  const tidy = (c, el) => {
    c.querySelectorAll('script, noscript').forEach((n) => n.remove());
    for (const n of [c, ...c.querySelectorAll('*')]) {
      for (const at of [...n.attributes]) if (/^on|^data-cat-id$|^data-trig$|^data-sub$/.test(at.name)) n.removeAttribute(at.name);
      const kids = [...n.children];
      if (kids.length > 14 && n.tagName !== 'svg' && n.tagName !== 'SVG') kids.slice(12).forEach((k) => k.remove());
    }
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode());) if (t.nodeValue.length > 140) t.nodeValue = t.nodeValue.slice(0, 137) + '…';
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) c.setAttribute('value', el.value || '');
    return c;
  };
  const clean = (el) => tidy(el.cloneNode(true), el).outerHTML;
  const miniTable = (cell) => {
    const table = cell.closest('table');
    const row = cell.parentElement;
    const idx = [...row.children].indexOf(cell);
    const cols = [...new Set([0, 1, idx])].filter((i) => i <= idx).sort((a, b) => a - b);
    const t = table.cloneNode(false);
    t.removeAttribute('style');
    const part = (tag, src) => {
      if (!src) return;
      const sec = document.createElement(tag);
      const tr = src.cloneNode(false);
      for (const i of cols) if (src.children[i]) tr.appendChild(tidy(src.children[i].cloneNode(true)));
      sec.appendChild(tr);
      t.appendChild(sec);
    };
    const firstBody = table.tBodies[0] && [...table.tBodies[0].rows].find(vis);
    part('thead', table.tHead?.rows[0]);
    part('tbody', row.parentElement.tagName === 'TBODY' ? row : firstBody);
    if (row.parentElement.tagName === 'TFOOT') part('tfoot', row);
    return { html: t.outerHTML, chainEl: table };
  };
  let seq = 0;
  const rec = (el, cat, extra = {}) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const asTable = cat === 'cell' && /^T[DH]$/.test(el.tagName) && el.closest('table');
    const mt = asTable ? miniTable(el) : null;
    const html = mt ? mt.html : clean(el);
    if (html.length > 90000) return null;
    const id = 'c' + (++seq) + '_' + Date.now().toString(36);
    el.setAttribute('data-cat-id', id);
    const isCont = CONTAINERS.some((c) => c[0] === cat) || extra.overlay;
    const rows = isCont ? [...el.querySelectorAll(ROWISH + ', button')].filter(vis).map(textOf).filter(Boolean).slice(0, 10) : [];
    const sig = el.tagName.toLowerCase() + '.' + clsOf(el);
    const key = cat + '::' + sig + '::' + (isCont ? rows.join('/').toLowerCase().replace(/\d+/g, '#') : look(el));
    return { id, cat, sig, key, html, chain: chain(mt ? mt.chainEl : el), bg: opaqueBg(el), w: Math.round(r.width), h: Math.round(r.height), pos: cs.position, text: textOf(el), rows, ...extra };
  };
  const outermost = (els, sel) => els.filter((e) => !e.parentElement?.closest(sel));
  window.__cat = {
    CONTAINERS, LEAVES, ROWISH, vis, textOf, rec,
    harvest(root = document.body, extra = {}) {
      const out = [];
      const allCont = CONTAINERS.map((c) => c[1]).join(',');
      for (const [cat, sel] of CONTAINERS) for (const el of outermost([...root.querySelectorAll(sel)], allCont)) if (vis(el)) { const r = rec(el, cat, extra); if (r) out.push(r); }
      const taken = new Set();
      for (const [cat, sel] of LEAVES) {
        let els = [...root.querySelectorAll(sel)].filter((e) => vis(e) && !(e instanceof SVGElement));
        if (cat === 'button') els = els.filter((e) => !e.closest(MENUISH) && !e.matches(ROWISH));
        if (['toggle', 'tabs', 'chip', 'card', 'bar', 'nav'].includes(cat)) els = outermost(els, sel);
        if (cat === 'cell') els = els.filter((e) => !/^T[DH]$/.test(e.tagName) || e.parentElement === [...e.parentElement.parentElement.rows].find(vis));
        for (const el of els) {
          if (taken.has(el) || [...taken].some((t) => t.contains(el) && cat !== 'button' && cat !== 'input' && !(cat === 'cell' && /^T[DH]$/.test(el.tagName)))) continue;
          if (cat === 'button' && el.closest(LEAVES[0][1]) && el.closest(LEAVES[0][1]) !== el) continue;
          taken.add(el);
          const r = rec(el, cat, extra);
          if (r) out.push(r);
          if (out.length > 1500) return out;
        }
      }
      return out;
    },
    mark() { for (const e of document.querySelectorAll('*')) e.__pre = 1; window.__preVis = new Set([...document.querySelectorAll(CONTAINERS.map((c) => c[1]).join(','))].filter(vis)); },
    overlays() {
      const allCont = CONTAINERS.map((c) => c[1]).join(',');
      const roots = [];
      for (const e of document.querySelectorAll('body *')) {
        if (e.__pre || !e.parentElement?.__pre || !vis(e)) continue;
        const r = e.getBoundingClientRect(); if (r.width * r.height < 300) continue;
        let floating = false;
        for (let x = e; x && x !== document.body; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === 'fixed' || p === 'absolute' || x.tagName === 'DIALOG') { floating = true; break; } }
        if (floating || e.matches(allCont) || e.querySelector(allCont)) roots.push(e);
      }
      for (const e of document.querySelectorAll(allCont)) if (vis(e) && !window.__preVis.has(e) && e.__pre && !roots.some((r) => r.contains(e) || e.contains(r))) roots.push(e);
      return roots.filter((r) => !roots.some((o) => o !== r && o.contains(r)));
    },
    catOf(el) {
      for (const [cat, sel] of CONTAINERS) if (el.matches(sel)) return cat;
      for (const [cat, sel] of CONTAINERS) { const inner = el.querySelector(sel); if (inner && inner.getBoundingClientRect().width * inner.getBoundingClientRect().height > 0.6 * el.getBoundingClientRect().width * el.getBoundingClientRect().height) return cat; }
      return 'popover';
    },
    capture(trig) {
      const out = [];
      for (const o of this.overlays()) {
        const cat = this.catOf(o);
        const r = rec(o, cat, { overlay: true, trigger: trig });
        if (r) { r.cat = cat; r.key = r.key.replace(/^[a-z]+::/, cat + '::'); out.push(r); }
        out.push(...this.harvest(o, { inOverlay: true }).filter((x) => !['dialog', 'menu', 'picker', 'popover'].includes(x.cat)));
      }
      return out;
    },
  };
};

export const TOASTS = [
  ['Info', `toast('Link copied')`],
  ['Success with Undo', `toast('Moved 3 bugs to trash', false, { label: 'Undo', run() {} })`],
  ['Error', `toast('Could not save: the server is offline', true)`],
  ['Automation', `toast('Workflow "Notify on High" ran', false, null, { kind: 'automation' })`],
  ['Repeated (×3)', `toast('Saved'); toast('Saved'); toast('Saved')`],
  ['Long message', `toast('This field is used by 4 views and 2 workflows. Rename it in each workflow before you delete it, or those workflows will stop on their next run.', true)`],
];

const TRIG = 'button, [role=button], [aria-haspopup], .crumb-item, .table-wrap thead th, .chip-trigger, .picker-face, .search-like, .nav-account-chip, .view-tab';
const NEVER = '.nav-theme-row, [title^="Theme"], [aria-label^="Theme"]';
const SKIP = /theme|delete|remove|trash|archive|sign ?out|log ?out|discard|purge|empty trash|restore|duplicate|clear/i;
const SUB_SKIP = /delete|remove|trash|archive|sign ?out|discard|purge|theme/i;

export const LANE_VIEWPORT = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
};

export async function harvestLane(browser, { base, routes, theme, width, maxTriggers = 70, toastRoute, extrasRoute, log = () => {}, quality = 0.6 }) {
  const opts = LANE_VIEWPORT[width];
  const ctx = await browser.newContext({ ...opts, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem('weave-theme', t); } catch {} }, theme);
  await ctx.addInitScript(PAGE_LIB);
  let blocked = 0, themeFlips = 0;
  await ctx.route('**/*', (r) => {
    const req = r.request();
    if (req.method() !== 'GET' && !/\/(query|search|preview|parse|resolve)(\?|$)/.test(req.url())) { blocked++; return r.abort(); }
    return r.continue();
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const conv = await browser.newPage();
  const webp = async (png) => conv.evaluate(async ([b64, q]) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', q);
  }, [png.toString('base64'), quality]);

  const store = new Map();
  const add = (r, route, shot) => {
    const s = store.get(r.key);
    if (s) { s.count++; s.routes.add(route); if (r.text && s.texts.size < 10) s.texts.add(r.text); return; }
    store.set(r.key, { ...r, count: 1, routes: new Set([route]), texts: new Set(r.text ? [r.text] : []), shot });
  };
  const vw = opts.viewport.width, vh = opts.viewport.height;
  const shoot = async (id) => {
    try {
      const loc = page.locator(`[data-cat-id="${id}"]`).first();
      const box = await loc.boundingBox({ timeout: 800 });
      if (!box || box.width * box.height > 1100 * 900 || box.width < 2) return null;
      return await webp(await loc.screenshot({ timeout: 2500, animations: 'disabled' }));
    } catch { return null; }
  };
  const ingest = async (list, route) => { let n = 0; for (const r of list) if (!store.has(r.key)) { add(r, route, await shoot(r.id)); n++; } else add(r, route); return n; };
  const settle = (ms) => page.waitForTimeout(ms);
  const go = async (hash) => { await page.goto(base + hash, { waitUntil: 'domcontentloaded' }); await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await settle(700); };
  const themeHolds = async () => {
    const t = await page.evaluate(() => document.documentElement.dataset.bsTheme).catch(() => theme);
    if (t === theme) return true;
    themeFlips++;
    await page.evaluate((x) => localStorage.setItem('weave-theme', x), theme).catch(() => {});
    return false;
  };

  const lines = [];
  const prefix = width === 'phone' ? 'Phone · ' : '';
  for (const [name0, hash] of routes) {
    const name = prefix + name0;
    await go(hash);
    const url0 = page.url();
    let n = await ingest(await page.evaluate(() => window.__cat.harvest()), name);
    const markTrigs = () => page.evaluate(({ TRIG, NEVER, SKIP }) => {
      const seen = new Set(), out = [];
      for (const el of document.querySelectorAll(TRIG)) {
        if (!window.__cat.vis(el) || el.closest('a[href]:not([href^="#"])') || el.closest(NEVER) || el.querySelector(NEVER)) continue;
        const t = window.__cat.textOf(el);
        if (new RegExp(SKIP, 'i').test(t + ' ' + (el.title || '') + ' ' + (el.getAttribute('aria-label') || ''))) continue;
        const land = (el.closest('[id]')?.id || '') + '>' + (el.parentElement?.className || '').toString().split(' ')[0];
        const k = el.tagName + '.' + [...el.classList].filter((c) => !/^hue-/.test(c)).sort().join('.') + '@' + land;
        if (seen.has(k)) continue;
        seen.add(k);
        const tag = 't' + Array.from(k).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
        el.setAttribute('data-trig', tag);
        out.push({ sel: `[data-trig="${tag}"]`, k, t, html: el.outerHTML.replace(/\sdata-(trig|cat-id)="[^"]*"/g, '').slice(0, 4000) });
      }
      return out;
    }, { TRIG, NEVER, SKIP: SKIP.source });
    const trigs = await markTrigs();
    const reset = async () => { await go(hash); await markTrigs(); };
    let opened = 0;
    for (const tr of trigs.slice(0, maxTriggers)) {
      if (page.url() !== url0 || !(await page.locator(tr.sel).count())) await reset();
      try {
        await page.evaluate(() => window.__cat.mark());
        await page.locator(tr.sel).first().click({ timeout: 1500 });
        await settle(650);
        if (page.url() !== url0) { await reset(); continue; }
        if (!(await themeHolds())) { await reset(); continue; }
        const res = await page.evaluate((trig) => window.__cat.capture(trig), { text: tr.t, html: tr.html });
        if (res.length) opened++;
        n += await ingest(res, name);
        const subs = await page.evaluate((skip) => {
          let i = 0; const out = [];
          for (const o of window.__cat.overlays()) for (const el of o.querySelectorAll(window.__cat.ROWISH + ', button')) {
            const t = window.__cat.textOf(el);
            if (!window.__cat.vis(el) || !(/…$|\.\.\.$/.test(t) || el.hasAttribute('aria-haspopup') || el.querySelector('[class*=caret], [class*=chevron-right]'))) continue;
            if (new RegExp(skip, 'i').test(t)) continue;
            el.setAttribute('data-sub', 's' + (++i)); out.push({ sel: `[data-sub="s${i}"]`, t });
          }
          return out.slice(0, 8);
        }, SUB_SKIP.source);
        for (const sb of subs) {
          if (!(await page.locator(sb.sel).count())) {
            await page.keyboard.press('Escape'); await settle(150);
            if (page.url() !== url0) await reset();
            await page.locator(tr.sel).first().click({ timeout: 1500 }).catch(() => {}); await settle(350);
            await page.evaluate((skip) => { let i = 0; for (const o of window.__cat.overlays()) for (const el of o.querySelectorAll(window.__cat.ROWISH + ', button')) { const t = window.__cat.textOf(el); if ((/…$|\.\.\.$/.test(t) || el.hasAttribute('aria-haspopup') || el.querySelector('[class*=caret], [class*=chevron-right]')) && !new RegExp(skip, 'i').test(t)) el.setAttribute('data-sub', 's' + (++i)); } }, SUB_SKIP.source);
          }
          try {
            await page.evaluate(() => window.__cat.mark());
            await page.locator(sb.sel).first().click({ timeout: 1200 });
            await settle(400);
            if (!(await themeHolds())) break;
            n += await ingest(await page.evaluate((trig) => window.__cat.capture(trig), { text: tr.t + ' › ' + sb.t, html: tr.html }), name);
          } catch {}
        }
      } catch {}
      await page.keyboard.press('Escape'); await settle(120); await page.keyboard.press('Escape'); await settle(120);
      const left = await page.evaluate(() => document.querySelectorAll('.modal.show, dialog[open], [role=dialog], [role=menu]').length).catch(() => 1);
      if (left || page.url() !== url0) await reset();
    }
    lines.push(`${name}: triggers ${trigs.length}, opened ${opened}, new ${n}, store ${store.size}`);
    log(`${width}-${theme} ${lines.at(-1)}`);
  }

  if (extrasRoute) {
    for (const [combo, label] of [[width === 'phone' ? null : 'Control+k', 'Command palette (⌘K)'], [width === 'phone' ? null : 'Meta+k', 'Command palette (⌘K)'], [width === 'phone' ? null : '?', 'Keyboard sheet (?)']]) {
      if (!combo) continue;
      await go(extrasRoute);
      await page.evaluate(() => window.__cat.mark());
      await page.keyboard.press(combo); await settle(500);
      if (!(await themeHolds())) continue;
      await ingest(await page.evaluate((trig) => window.__cat.capture(trig), { text: label, html: '' }), 'Keyboard');
    }
    if (width === 'desktop') try {
      await go(extrasRoute);
      await page.evaluate(() => window.__cat.mark());
      await page.keyboard.press('Escape'); await settle(150);
      await page.locator('.table-wrap tbody tr').nth(1).click({ button: 'right', timeout: 5000 }); await settle(400);
      const res = await page.evaluate((trig) => window.__cat.overlays().map((o) => { const cat = window.__cat.catOf(o); const r = window.__cat.rec(o, cat, { overlay: true, trigger: trig }); if (r) { r.cat = cat; r.key = r.key.replace(/^[a-z]+::/, cat + '::'); } return r; }).filter(Boolean), { text: 'Right-click a table row', html: '' });
      await ingest(res, 'Table view');
    } catch (e) { log(`${width}-${theme} context menu: ${e.message}`); }
  }

  if (toastRoute) {
    await go(toastRoute);
    for (const [label, code] of TOASTS) {
      await page.evaluate(() => document.querySelectorAll('#wv-toasts .wv-toast').forEach((n) => n.remove()));
      await page.evaluate(code); await settle(350);
      const r = await page.evaluate((label) => { const n = [...document.querySelectorAll('#wv-toasts .wv-toast')].at(-1); if (!n) return null; const x = window.__cat.rec(n, 'toast', { trigger: { text: label, html: '' } }); x.key = 'toast::' + label; return x; }, label);
      if (!r) { log(`${width}-${theme} no toast for ${label}`); continue; }
      add(r, 'Toast', await shoot(r.id));
    }
  }

  await conv.close();
  await ctx.close();
  return {
    meta: { lane: { theme, width, vw, vh }, blocked, routes: lines, themeFlips, at: new Date().toISOString() },
    specs: [...store.values()].map((s) => ({ ...s, routes: [...s.routes], texts: [...s.texts] })),
  };
}
