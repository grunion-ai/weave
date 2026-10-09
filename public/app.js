'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
};
const svgEl = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) node.append(c.nodeType ? c : document.createTextNode(c));
  return node;
};

const chevron = () => iconEl('lucide:chevron-right', 'wv-icon');

const WS_PREFIX = (location.pathname.match(/^\/w\/[^/]+/) ?? [''])[0];

const LOCAL_ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
function commitActiveEdit() {
  const a = document.activeElement;
  if (a && a.matches?.('input, textarea, select')) a.blur();
  document.querySelector('.picker-pop')?.commit?.();
}
let leaving = false;
for (const ev of ['beforeunload', 'pagehide']) {
  window.addEventListener(ev, () => { leaving = true; commitActiveEdit(); });
}

let loadedSchemaVersion = null;
let lastSchemaVersion = null;
let schemaLoading = false;
let schemaFetch = null;

function noteSchemaVersion(version, isRead) {
  if (!version) return;
  lastSchemaVersion = version;
  if (schemaLoading) return;
  if (loadedSchemaVersion === null || !isRead) { loadedSchemaVersion = version; return; }
  if (version === loadedSchemaVersion) return;
  syncSchema();
}

function fileBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => rej(reader.error);
    reader.readAsDataURL(file);
  });
}

const warmGets = new Map();
const WARM_MS = 5000;
function warmGet(path, ready = null) {
  const p = ready ?? api('GET', path);
  p.catch(() => {});
  warmGets.set(path, { at: Date.now(), p });
  return p;
}
async function api(method, path, body, { signal } = {}) {
  if (method === 'GET' && warmGets.has(path)) {
    const hit = warmGets.get(path);
    warmGets.delete(path);
    if (Date.now() - hit.at < WARM_MS) return hit.p;
  }
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(WS_PREFIX + '/api' + path, {
    method,
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Weave-Zone': LOCAL_ZONE },
    body: payload,
    keepalive: (leaving || document.visibilityState === 'hidden')
      && new TextEncoder().encode(payload ?? '').length < 60_000,
  });
  const data = await res.json().catch(() => ({}));
  noteSchemaVersion(res.headers.get('X-Weave-Schema-Version'), method === 'GET' || path.endsWith('/query'));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `${res.status}`), { status: res.status, code: data.code });
  if (method !== 'GET' && data?.id && Array.isArray(data.activity)) {
    noteAutomationWrites(data, Date.parse(res.headers.get('Date')) || Date.now());
  }
  return data;
}

async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
    return;
  } catch {}
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  toast(ok ? label : text, !ok);
}

const TOAST_MS = { info: 4000, action: 8000, err: 10000, perChar: 60, max: 20000 };
const TOAST_LIMIT = 3;
const TOAST_ICON = { info: 'lucide:info', success: 'lucide:check', err: 'lucide:circle-alert', automation: 'lucide:workflow' };
const toastsUp = [];

function toastLayer() {
  let layer = document.querySelector('#wv-toasts');
  if (layer) return layer;
  layer = el('div', { id: 'wv-toasts', role: 'region', 'aria-label': 'Notifications' },
    el('div', { id: 'wv-live-status', class: 'visually-hidden', role: 'status', 'aria-live': 'polite' }),
    el('div', { id: 'wv-live-alert', class: 'visually-hidden', role: 'alert' }));
  layer.held = { hover: false, focus: false };
  layer.addEventListener('pointerenter', () => { layer.held.hover = true; });
  layer.addEventListener('pointerleave', () => { layer.held.hover = false; });
  layer.addEventListener('focusin', () => { layer.held.focus = true; });
  layer.addEventListener('focusout', (e) => { layer.held.focus = layer.contains(e.relatedTarget); });
  document.body.append(layer);
  return layer;
}

function toast(msg, isErr = false, action = null, { kind } = {}) {
  kind ??= isErr ? 'err' : action ? 'success' : 'info';
  const text = String(msg);
  const layer = toastLayer();
  const same = !action && toastsUp.find((t) => !t.action && t.kind === kind && t.msg === text);
  if (same) {
    same.count += 1;
    same.countEl.textContent = `×${same.count}`;
    same.countEl.hidden = false;
    same.left = same.life;
    return same.node;
  }
  const floor = action ? TOAST_MS.action : kind === 'err' ? TOAST_MS.err : TOAST_MS.info;
  const life = Math.min(TOAST_MS.max, Math.max(floor, text.length * TOAST_MS.perChar));
  const countEl = el('span', { class: 'wv-toast-count' });
  countEl.hidden = true;
  const node = el('div', { class: `wv-toast ${kind}` },
    iconEl(TOAST_ICON[kind], 'wv-toast-icon'),
    el('span', { class: 'wv-toast-msg' }, text, countEl));
  const item = { msg: text, kind, action, node, countEl, count: 1, life, left: life };
  if (action) {
    node.append(el('button', {
      class: 'wv-toast-action', type: 'button',
      onclick: async () => { dropToast(item); await action.run(); },
    }, action.label));
  }
  node.append(el('button', {
    class: 'wv-toast-close', type: 'button', 'aria-label': 'Dismiss', title: 'Dismiss',
    onclick: () => dropToast(item),
  }, iconEl('lucide:x', 'wv-toast-x')));
  let x0 = null;
  node.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') x0 = e.clientX; });
  node.addEventListener('pointerup', (e) => { if (x0 != null && Math.abs(e.clientX - x0) >= 48) dropToast(item); x0 = null; });
  toastsUp.push(item);
  layer.append(node);
  while (toastsUp.length > TOAST_LIMIT) dropToast(toastsUp.find((t) => t.kind !== 'err') ?? toastsUp[0]);
  const live = layer.querySelector(kind === 'err' ? '#wv-live-alert' : '#wv-live-status');
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 50);
  toastClock();
  return node;
}

function dropToast(item) {
  const i = toastsUp.indexOf(item);
  if (i === -1) return;
  toastsUp.splice(i, 1);
  item.node.remove();
}

let toastTick = null;
function toastClock() {
  if (toastTick) return;
  let last = performance.now();
  toastTick = setInterval(() => {
    const now = performance.now(), dt = now - last;
    last = now;
    const held = document.querySelector('#wv-toasts')?.held;
    if (!(held?.hover || held?.focus || document.hidden)) {
      for (const t of [...toastsUp]) if ((t.left -= dt) <= 0) dropToast(t);
    }
    if (!toastsUp.length) { clearInterval(toastTick); toastTick = null; }
  }, 100);
}

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !toastsUp.length) return;
  const at = document.activeElement;
  const inStack = at?.closest?.('#wv-toasts');
  const claimed = document.querySelector('#modal-back, #tray-back, #bug-panel, .chip-pop, .dl-menu:not(.hidden), [role="menu"], [role="dialog"]');
  if (inStack || ((!at || at === document.body) && !claimed)) dropToast(toastsUp.at(-1));
}, true);

const MODAL_LIVE = '#wv-toasts, .bug-fab, #bug-panel';
const MODAL_STOPS = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let pageHeld = [];
function releasePage() {
  if (document.querySelector('#modal-back')) return;
  for (const n of pageHeld) n.inert = false;
  pageHeld = [];
}
function holdPage(back, box) {
  const opener = document.activeElement;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const heading = box.querySelector('h2');
  if (heading) { heading.id = 'modal-title'; box.setAttribute('aria-labelledby', 'modal-title'); }
  document.body.append(back);
  for (const n of document.body.children) {
    if (n === back || n.inert || n.matches(MODAL_LIVE)) continue;
    n.inert = true;
    pageHeld.push(n);
  }
  addEventListener('keydown', function trap(e) {
    if (!back.isConnected) return removeEventListener('keydown', trap);
    const at = document.activeElement ?? document.body;
    if (e.key !== 'Tab' || (at !== document.body && !back.contains(at))) return;
    const stops = [...box.querySelectorAll(MODAL_STOPS)].filter((n) => n.getClientRects().length);
    if (!stops.length) return;
    e.preventDefault();
    const i = stops.indexOf(at);
    const next = i === -1 ? (e.shiftKey ? -1 : 0) : i + (e.shiftKey ? -1 : 1);
    stops.at(next % stops.length).focus();
  });
  new MutationObserver((_, watch) => {
    if (back.isConnected) return;
    watch.disconnect();
    releasePage();
    const at = document.activeElement;
    if ((!at || at === document.body) && opener?.isConnected) opener.focus();
  }).observe(document.body, { childList: true });
}

function modal(title, bodyNodes, onSubmit, submitLabel = 'Create') {
  document.querySelector('#modal-back')?.remove();
  const opener = document.activeElement;
  const close = () => {
    const held = back.contains(document.activeElement);
    back.remove();
    releasePage();
    if (held && opener?.isConnected) opener.focus();
  };
  const back = el('div', { id: 'modal-back', onclick: (e) => { if (e.target === back) close(); } });
  const done = el('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);
  const form = el('form', {}, ...bodyNodes,
    el('div', { class: 'actions' },
      onSubmit ? el('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel') : null,
      done));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await onSubmit?.(new FormData(form));
      close();
    } catch (err) {
      if (!err.shown) toast(err.message, true);
    }
  });
  const box = el('div', { id: 'modal' }, el('h2', {}, title), form);
  back.append(box);
  holdPage(back, box);
  addEventListener('keydown', function esc(e) {
    if (!back.isConnected) return removeEventListener('keydown', esc);
    if (e.key === 'Escape') { close(); removeEventListener('keydown', esc); }
  });
  const first = form.querySelector('input,select,textarea') ?? (onSubmit ? null : done);
  if (first) first.focus();
}

function tray(title, bodyNodes, onSubmit, submitLabel = 'Create') {
  document.querySelector('#tray-back')?.remove();
  document.querySelector('#modal-back')?.remove();
  const back = el('div', { id: 'tray-back', onclick: (e) => { if (e.target === back) back.remove(); } });
  const form = el('form', { class: 'tray-form' },
    el('div', { class: 'tray-body' }, ...bodyNodes),
    el('div', { class: 'tray-actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => back.remove() }, 'Cancel'),
      el('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await onSubmit(new FormData(form));
      back.remove();
    } catch (err) {
      toast(err.message, true);
    }
  });
  back.append(el('div', { id: 'tray' },
    el('div', { class: 'tray-head' }, el('h2', {}, title),
      el('button', { class: 'tray-close', type: 'button', 'aria-label': 'Close', onclick: () => back.remove() }, iconEl('✕'))),
    form));
  document.body.append(back);
  addEventListener('keydown', function esc(e) {
    if (!back.isConnected) return removeEventListener('keydown', esc);
    if (e.key === 'Escape' && !document.querySelector('.chip-pop')) { back.remove(); removeEventListener('keydown', esc); }
  });
  const first = form.querySelector('input:not([type=hidden]),select,textarea');
  if (first) first.focus();
  return back;
}

const state = { schema: [], route: null, refocus: null, trail: [], showDeleted: new Set(),
  selected: new Map() };

async function openEntity(id, { drill = false } = {}) {
  let entity;
  const here = allTables().find((d) => d.id === state.route?.dbId);
  const docs = (here?.fields ?? []).filter((f) => f.type === 'document').map((f) => `/doc/revisions?field=${encodeURIComponent(f.name)}&limit=2`);
  for (const tail of ['/references', '/references-from', ...docs]) warmGet(`/entities/${id}${tail}`);
  try { entity = await api('GET', `/entities/${id}`); } catch (err) { return toast(err.message, true); }
  warmGet(`/entities/${id}`, Promise.resolve(entity));
  const db = allTables().find((d) => d.id === entity.dbId);
  if (!db) { location.hash = `#/entity/${id}`; return; }
  if (state.route?.page !== 'db') {
    teardownDocEditors();
    dockClose();
    history.pushState(null, '', `#/table/${db.id}`);
    await withPageLoader(() => showDatabase(db.id));
  }
  await dockEntity(db, id, { drill, step: true });
}

document.addEventListener('click', (e) => {
  if (nativeClick(e)) return;
  const a = e.target.closest?.('a[href^="#/entity/"]');
  if (!a || e.target.closest('button, input, select, textarea, label')) return;
  const m = a.getAttribute('href').match(/^#\/entity\/([^/?]+)$/);
  if (!m) return;
  e.preventDefault();
  openEntity(m[1], { drill: !!a.closest('#dock') || (state.route?.page === 'entity' && !!a.closest('#main')) });
}, true);

function nativeClick(e) {
  return !!(e.metaKey || e.ctrlKey || e.shiftKey) || (e.button ?? 0) !== 0;
}

function externalLinksOpenInTabs(e) {
  const a = e.target?.closest?.('a[href]');
  if (!a || a.target) return;
  let u;
  try { u = new URL(a.getAttribute('href'), location.href); } catch { return; }
  if (u.origin === location.origin || !/^https?:$/.test(u.protocol)) return;
  a.target = '_blank';
  a.rel = 'noopener';
}
addEventListener('click', externalLinksOpenInTabs, true);

const NATIVE_CLICK_KEEPS = 'a[href], input, textarea, select, button, label, [contenteditable]';
function openNativeClick(e) {
  if (!nativeClick(e)) return;
  if (e.target?.closest?.(NATIVE_CLICK_KEEPS)) return;
  const host = e.target?.closest?.('[data-href]');
  if (!host) return;
  e.preventDefault();
  e.stopPropagation();
  window.open(new URL(host.dataset.href, location.href).href, '_blank');
}
addEventListener('click', openNativeClick, true);
addEventListener('auxclick', openNativeClick, true);
let headCheck = 0;
const markStuckHeads = () => {
  headCheck = 0;
  for (const grid of document.querySelectorAll('.table-wrap > .wv-grid')) {
    const th = grid.tHead?.rows[0]?.cells[0];
    if (th) grid.parentElement.classList.toggle('wv-head-stuck', th.getBoundingClientRect().top - grid.getBoundingClientRect().top > 0.5);
  }
};
addEventListener('scroll', (e) => {
  const wrap = e.target;
  if (wrap instanceof HTMLElement && wrap.classList.contains('table-wrap')) {
    wrap.classList.toggle('wv-scrolled-x', wrap.scrollLeft > 0);
  }
  headCheck ||= requestAnimationFrame(markStuckHeads);
}, { capture: true, passive: true });
function nameFieldOf(db) {
  return db?.fields?.find((f) => f.role === 'name') ?? db?.fields?.find((f) => f.name === 'Name');
}
function computedName(db) { return nameFieldOf(db)?.type === 'formula'; }
function termOfTable(id) {
  for (const s of state.schema ?? []) for (const t of s.tables) if (t.id === id) return t.term ?? WeaveTerm.DEFAULT;
  return WeaveTerm.DEFAULT;
}

let dock = null;

function markDockedRow() {
  const id = dock ? weaveEntitySurface.selectionId(dock.state) : null;
  for (const tr of document.querySelectorAll('tr.entity-row.row-docked')) tr.classList.remove('row-docked');
  if (id) $(`tr[data-eid="${id}"]`)?.classList.add('row-docked');
}

function releaseDockPanel() {
  const panel = $('#dock');
  if (!panel) return;
  flushDocSaves();
  if (dock) {
    for (const ed of dock.editors.splice(0)) {
      try { ed.destroy(); } catch {}
      liveEditors.delete(ed);
    }
  }
  for (const set of [refChipLayers, docRails, docFolds, docCodeAuto]) {
    for (const st of [...set]) {
      if (panel.contains(st.host)) {
        clearTimeout(st.timer);
        (st.layer ?? st.rail)?.remove();
        set.delete(st);
      }
    }
  }
}

function poseGlyph(expanded) {
  const span = el('span', { class: 'pose-glyph' });
  span.innerHTML = expanded
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 10h-4v-4"/><path d="M20 4l-6 6"/><path d="M6 14h4v4"/><path d="M4 20l6 -6"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h4v4"/><path d="M14 10l6 -6"/><path d="M8 20h-4v-4"/><path d="M10 14l-6 6"/></svg>';
  return span;
}

let crumbNav = null;

function navArrows(go) {
  if (!crumbNav || crumbNav.stack.length < 2) return [];
  const B = weaveBreadcrumbs;
  return [
    el('button', {
      class: 'btn btn-sm btn-ghost-secondary crumb-nav dock-back', type: 'button',
      title: 'Back (Esc)', 'aria-label': 'Back to the previous entity', disabled: B.navCanBack(crumbNav) ? undefined : '',
      onclick: () => go(B.navBack(crumbNav)),
    }, lucideEl('arrow-left')),
    el('button', {
      class: 'btn btn-sm btn-ghost-secondary crumb-nav dock-forward', type: 'button',
      title: 'Forward', 'aria-label': 'Forward to the next entity', disabled: B.navCanForward(crumbNav) ? undefined : '',
      onclick: () => go(B.navForward(crumbNav)),
    }, lucideEl('arrow-right')),
  ];
}

function dockExpand() {
  if (!dock) return;
  const top = dock.state.chain[dock.state.chain.length - 1];
  if (!top) return;
  dockClose();
  teardownDocEditors();
  history.replaceState(null, '', `#/entity/${top.id}`);
  withPageLoader(() => showEntity(top.id));
}

async function closeToTable(entity) {
  crumbNav = null;
  teardownDocEditors();
  history.replaceState(null, '', `#/table/${entity.dbId}`);
  await showDatabase(entity.dbId);
}

async function collapseToSplit(entity) {
  const db = allTables().find((d) => d.id === entity.dbId);
  if (!db) return;
  teardownDocEditors();
  history.replaceState(null, '', `#/table/${db.id}`);
  await showDatabase(db.id);
  await dockEntity(db, entity.id);
}

function dockClose() {
  if (!dock) return;
  commitActiveEdit();
  releaseDockPanel();
  const panel = $('#dock');
  panel.hidden = true;
  panel.replaceChildren();
  delete panel.dataset.eid;
  $('#dock-gutter').hidden = true;
  dock = null;
  syncDocTitle();
  markDockedRow();
}

function anchorTable(db) {
  return (state.route?.page === 'db' && allTables().find((d) => d.id === state.route.dbId)) || db;
}

async function dockEntity(db, id, { drill = false, step = false } = {}) {
  commitActiveEdit();
  const S = weaveEntitySurface;
  const frame = { kind: 'entity', id, tableId: db.id, tableName: db.name };
  const anchor = anchorTable(db);
  let st = dock && dock.state.anchor.tableId === anchor.id
    ? dock.state
    : S.init({ tableId: anchor.id, tableName: anchor.name });
  if (!st.chain.length) st = S.open(st, frame);
  const known = crumbNav?.stack.find((h) => h.id === id);
  const hop = { ...known, ...tableHop(db), id };
  crumbNav = drill ? weaveBreadcrumbs.navHop(crumbNav, hop) : weaveBreadcrumbs.navOpen(crumbNav, hop);
  dock = { db, state: st, editors: dock?.editors ?? [] };
  syncDockChain();
  dockSyncUrl({ step });
  await drawDock();
}

function syncDockChain() {
  if (!dock) return;
  dock.state = {
    ...dock.state,
    chain: weaveBreadcrumbs.navPath(crumbNav).map((h) => ({ kind: 'entity', id: h.id, name: h.name, publicId: h.publicId, tableId: h.tableId, tableName: h.table })),
  };
}

function tableHop(db) {
  return { tableId: db.id, table: db.name, tableIcon: db.icon ?? null, space: db.space ?? '', spaceId: db.spaceId ?? '', spaceIcon: db.spaceIcon ?? null };
}

const dockCoversScreen = matchMedia('(max-width: 600px)');
const touchOnly = matchMedia('(hover: none) and (pointer: coarse)');
const SHORTCUT_CLAUSE = /\s*(?:\([^()]*(?:⌘|Ctrl)[^()]*\)|— ⌘-click for a new tab|<[^<>]*(?:⌘|Ctrl)[^<>]*>)/g;
const keyHint = (text) => (touchOnly.matches ? text.replace(SHORTCUT_CLAUSE, '') : text);

function dockSyncUrl({ step = false } = {}) {
  const m = location.hash.match(/^#\/(?:table|db)\/[^/?]+(?:\/view\/[^/?]+)?/);
  if (!m) return;
  const top = dock?.state.chain[dock.state.chain.length - 1];
  const url = top ? `${m[0]}?e=${top.id}` : m[0];
  if (step && top && dockCoversScreen.matches && url !== location.hash) {
    history.pushState({ wvDock: true }, '', url);
    return;
  }
  history.replaceState(top && history.state?.wvDock ? history.state : null, '', url);
}

function dockDismiss() {
  crumbNav = null;
  if (history.state?.wvDock) {
    dockClose();
    history.back();
    return;
  }
  dockClose();
  dockSyncUrl();
}

function dockGo(next) {
  if (!dock || next === crumbNav) return;
  crumbNav = next;
  syncDockChain();
  dockSyncUrl();
  drawDock();
}

async function drawDock() {
  if (!dock) return;
  const top = dock.state.chain[dock.state.chain.length - 1];
  let entity;
  try { entity = await api('GET', `/entities/${top.id}`); } catch (err) { dockClose(); return toast(err.message, true); }
  crumbNav = weaveBreadcrumbs.navUpdate(crumbNav, entityHop(entity));
  syncDockChain();
  noteEntityRecent(entity);
  syncDocTitle();
  dock.db = allTables().find((d) => d.id === top.tableId) ?? dock.db;
  const crumbs = weaveBreadcrumbs.dockCrumbs(weaveBreadcrumbs.navPath(crumbNav));
  releaseDockPanel();
  const panel = $('#dock');
  panel.hidden = false;
  const swapped = panel.dataset.eid !== top.id;
  panel.dataset.eid = top.id;
  wireDockGutter(panel);
  applyDockWidth(panel);
  const host = el('div', { class: 'dock-entity' });
  panel.replaceChildren(host);
  if (swapped) panel.scrollTop = 0;
  const dockControls = {
    nav: navArrows(dockGo),
    pose: [
      el('button', {
        class: 'btn btn-sm btn-ghost-secondary pose-btn', type: 'button',
        title: keyHint('Expand (⌘⇧E)'), 'aria-label': 'Expand to the full page',
        onclick: () => dockExpand(),
      }, poseGlyph(false)),
      el('button', {
        class: 'btn btn-sm btn-ghost-secondary dock-close', type: 'button',
        title: 'Close (Esc)', 'aria-label': 'Close',
        onclick: () => dockDismiss(),
      }, iconEl('✕')),
    ],
  };
  await renderEntityView(entity, { mount: host, refresh: drawDock, inPeek: true, onClose: dockDismiss, editors: dock.editors, crumbs, dockControls });
  markDockedRow();
}

const DOCK_MIN = 360;
function pinDock(panel, px) {
  panel.style.width = '';
  panel.style.flex = px ? `0 1 ${px}px` : '';
}
function applyDockWidth(panel) {
  const px = Number(localStorage.getItem('wv-dock-width'));
  pinDock(panel, px >= DOCK_MIN ? px : 0);
}
function wireDockGutter(panel) {
  const grip = $('#dock-gutter');
  grip.hidden = false;
  if (grip.dataset.wired) return;
  grip.dataset.wired = '1';
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('dock-resizing');
    const right = panel.getBoundingClientRect().right;
    const move = (ev) => pinDock(panel, Math.max(DOCK_MIN, Math.round(right - ev.clientX)));
    const up = () => {
      document.body.classList.remove('dock-resizing');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      const px = Math.max(DOCK_MIN, Math.round(panel.getBoundingClientRect().width));
      localStorage.setItem('wv-dock-width', String(px));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => {
    localStorage.removeItem('wv-dock-width');
    applyDockWidth(panel);
  });
}

document.addEventListener('keydown', (e) => {
  if (!((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'e' || e.key === 'E'))) return;
  if (dock) { e.preventDefault(); return dockExpand(); }
  if (state.route?.page === 'entity') {
    e.preventDefault();
    api('GET', `/entities/${state.route.id}`).then(collapseToSplit).catch(() => {});
  }
});

const DOCK_ESC_OWNERS = '.chip-pop, .cell-pop, .date-pop, .doc-rail.open, #tray-back, #modal-back, #cmdk-back, #fsv-back';
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !dock) return;
  if (document.querySelector(DOCK_ESC_OWNERS)) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (!weaveBreadcrumbs.navCanBack(crumbNav)) return dockDismiss();
  dockGo(weaveBreadcrumbs.navBack(crumbNav));
});

function allTables() {
  return state.schema.flatMap((s) => s.tables.map((d) => ({ ...d, space: s.space, spaceId: s.spaceId, spaceIcon: s.icon ?? null })));
}

async function readRegistry() {
  const res = await fetch('/api/schema', { headers: { 'X-Weave-Zone': LOCAL_ZONE } });
  if (res.status === 401 || res.status === 403) return [];
  if (!res.ok) throw new Error(`${res.status}`);
  const rootSchema = await res.json();
  return Array.isArray(rootSchema) ? rootSchema.filter((sp) => sp.system === 'workspace') : [];
}

async function loadSchema() {
  const registryRead = WS_PREFIX && state.registry !== null ? readRegistry() : null;
  registryRead?.catch(() => {});
  const idRead = state.wsId ? null : api('GET', '/workspace').then((w) => w.id, () => null);
  schemaLoading = true;
  try {
    state.schema = await api('GET', '/schema');
    loadedSchemaVersion = lastSchemaVersion;
  } finally { schemaLoading = false; }
  if (WS_PREFIX && !state.schema.some((sp) => sp.system === 'workspace')) {
    try {
      state.registry = await (registryRead ?? readRegistry());
    } catch (err) {
      state.registry = [];
      toast(`Couldn't load the workspace registry: ${err.message}`, true);
    }
  } else state.registry = null;
  if (idRead) state.wsId = await idRead;
  renderNav();
}

function inlineNameInput(placeholder, onCommit) {
  document.querySelectorAll('.nav-inline-add').forEach((n) => n.remove());
  const input = el('input', { class: 'form-control form-control-sm nav-inline-add', placeholder });
  const cancel = () => { input.remove(); renderNav(); };
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') return cancel();
    if (e.key !== 'Enter' || !input.value.trim()) return;
    input.disabled = true;
    try { await onCommit(input.value.trim()); } catch (err) { input.disabled = false; toast(err.message, true); }
  });
  input.addEventListener('blur', () => { if (!input.disabled && !input.value.trim()) cancel(); });
  requestAnimationFrame(() => input.focus());
  return input;
}

function navTableMenu(db, space, row) {
  const wrap = dotsMenu([
    {
      label: 'Rename table…',
      run: () => {
        const input = inlineNameInput('Table name…', async (name) => {
          await api('PATCH', `/tables/${db.id}`, { name });
          await loadSchema();
        });
        input.value = db.name;
        input.addEventListener('blur', () => { if (!input.disabled && input.isConnected) { input.remove(); renderNav(); } });
        row.style.display = 'none';
        row.after(input);
      },
    },
    {
      label: 'Change icon…',
      run: () => searchPicker({
        anchor: wrap, title: 'Icon', placeholder: 'Search by name or category…',
        options: iconCatalogue(), grid: true, currentId: db.icon ?? '',
        onPick: async (o) => {
          await api('PATCH', `/tables/${db.id}`, { icon: o.id || '' });
          await loadSchema();
        },
      }),
    },
    'divider',
    {
      label: 'Move to space…',
      run: () => searchPicker({
        anchor: wrap, title: `Move ${db.name} to…`, placeholder: 'Space…',
        options: state.schema.filter((s) => s.space !== space.space && !s.system)
          .map((s) => ({ id: s.space, label: s.space })),
        onPick: async (o) => {
          await api('POST', `/tables/${db.id}/move`, { space: o.id });
          await loadSchema();
          toast(`Moved ${db.name} to ${o.id}`);
        },
      }),
    },
    {
      label: 'Duplicate table',
      run: async () => {
        const copy = await api('POST', `/tables/${db.id}/duplicate`);
        await loadSchema();
        location.hash = `#/table/${copy.id}`;
        toast(`Duplicated ${db.name} as ${copy.name}`);
      },
    },
    'divider',
    {
      hold: 'Delete table', holdingLabel: 'Hold to delete table…',
      run: async () => {
        await api('DELETE', `/tables/${db.id}`);
        await loadSchema();
        if (state.route?.dbId === db.id) location.hash = `#/space/${space.spaceId}`;
        toast(`Deleted ${db.name}`);
      },
    },
  ], { title: `${db.name} actions`, align: 'right', extraClass: 'nav-db-menu' });
  wrap.addEventListener('click', (e) => e.preventDefault(), true);
  return wrap;
}

const iconRuns = new WeakMap();
function playIcon(host) {
  const ms = Number(host.dataset.ms) || 0;
  if (!ms || iconRuns.has(host) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const parts = [...host.querySelectorAll('[data-mi]')];
  for (const p of parts) p.classList.add(...p.dataset.mi.split(' '));
  iconRuns.set(host, setTimeout(() => {
    for (const p of parts) p.classList.remove(...p.dataset.mi.split(' '));
    iconRuns.delete(host);
  }, ms));
}
function lucideEl(name, cls = 'wv-icon') {
  const reg = window.weaveIconRegistry;
  const span = el('span', { class: `${cls} mi mi-${name}`, 'data-ms': String(reg.MOTION[name] || 0) });
  span.innerHTML = window.LUCIDE_MOVING[name];
  return span;
}
const canHover = matchMedia('(hover: hover)');
document.addEventListener('mouseover', (e) => {
  if (!canHover.matches) return;
  const host = e.target.closest?.('.mi');
  if (host && !(e.relatedTarget && host.contains(e.relatedTarget))) playIcon(host);
});
document.addEventListener('pointerdown', (e) => {
  const host = e.target.closest?.('.mi');
  if (host) playIcon(host);
});
function iconEl(icon, cls = 'wv-icon') {
  if (!icon) return null;
  const twin = window.weaveMarkIcons?.twin(icon);
  if (twin) return lucideEl(twin, cls);
  const mark = window.weaveMarkIcons?.markSvg(icon);
  if (mark) {
    const span = el('span', { class: cls });
    span.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">${mark}</svg>`;
    return span;
  }
  const name = window.weaveIconRegistry?.resolve(icon);
  if (name) return lucideEl(name, cls);
  if (name === '') {
    return el('span', {
      class: `${cls} icon-ghost`, title: `${String(icon).replace(/^\w+:/, '')} — this icon is no longer in the set`,
    }, '◌');
  }
  return null;
}

function iconCatalogue() {
  const reg = window.weaveIconRegistry;
  return fieldDialogCore.iconChoices(fieldDialogCore.ICON_INVENTORY, (n) => reg.CATEGORY[n]);
}

function iconButton(current, onPick) {
  const btn = el('button', { class: 'icon-btn', type: 'button', title: 'Set icon' },
    iconEl(current) ?? el('span', { class: 'wv-icon icon-ghost' }, '◌'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    searchPicker({
      anchor: btn, title: 'Icon', placeholder: 'Search by name or category…',
      options: iconCatalogue(), grid: true,
      currentId: current ?? '',
      onPick: (o) => onPick(o.id || null),
    });
  });
  return btn;
}

function publishViewHeaderHeight() {
  publishHeaderOn(document.documentElement, document.querySelector('#main > .view-header'), document.querySelector('#main')?.clientHeight || innerHeight);
  const dock = document.querySelector('#dock');
  publishHeaderOn(dock, dock?.querySelector('.dock-entity > .view-header'), dock?.clientHeight ?? 0);
}
function keyboardInset() {
  const vv = window.visualViewport;
  return vv ? Math.max(0, innerHeight - vv.height - vv.offsetTop) : 0;
}
function publishHeaderOn(holder, box, pane) {
  if (!holder || !box) return;
  const h = box.getBoundingClientRect().height;
  const keyboard = keyboardInset();
  const writing = keyboard > 0 && dockCoversScreen.matches;
  const holds = h <= (pane - keyboard) / (writing ? 4 : 2);
  holder.classList.toggle('view-header-loose', !holds);
  const v = holds ? `${h}px` : '0px';
  if (holder.style.getPropertyValue('--wv-view-h') !== v) holder.style.setProperty('--wv-view-h', v);
}
function stickViewHeader(box) {
  new ResizeObserver(publishViewHeaderHeight).observe(box);
  return box;
}
addEventListener('resize', publishViewHeaderHeight);
window.visualViewport?.addEventListener('resize', publishViewHeaderHeight);

const CRUMB_ICON_FALLBACK = { space: 'lucide:folder', table: 'lucide:table', row: 'lucide:table' };
function crumbIconEl(c) {
  if (c.kind === 'ws') return wsMarkEl();
  return iconEl(c.icon, 'wv-icon crumb-ic') ?? (CRUMB_ICON_FALLBACK[c.kind] ? iconEl(CRUMB_ICON_FALLBACK[c.kind], 'wv-icon crumb-ic') : null);
}
function crumbInner(c) {
  return [
    crumbIconEl(c),
    c.publicId != null ? el('span', { class: 'crumb-pid' }, `#${c.publicId}`) : null,
    el('span', { class: 'crumb-nm' }, c.label ?? ''),
  ];
}
function crumbPath(crumbs, { copy = null, foldFrom = 1 } = {}) {
  const path = el('span', { class: 'crumb-path' });
  crumbs.forEach((c, i) => {
    const node = c.current
      ? el('span', { class: 'crumb-cur-wrap' },
        el('span', { class: `crumb-item crumb-cur crumb-k-${c.kind ?? 'page'}`, title: c.title ?? c.label, 'aria-current': 'page' }, ...crumbInner(c)),
        copy ? el('button', {
          type: 'button', class: 'btn btn-sm btn-ghost-secondary crumb-copy', title: copy.title, 'aria-label': copy.title,
          onclick: copy.run,
        }, lucideEl('link')) : null)
      : el('a', {
        class: `crumb-item crumb-k-${c.kind ?? 'page'}`, href: c.kind === 'ws' ? wsHomeHref() : c.href,
        title: c.title ?? c.label,
      }, ...crumbInner(c));
    const slot = el('span', { class: 'crumb-slot' + (c.current ? ' crumb-slot-cur' : '') },
      i ? el('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›') : null, node);
    slot.crumb = c;
    path.append(slot);
  });
  new ResizeObserver(() => fitCrumbs(path, foldFrom)).observe(path);
  return path;
}

function fitCrumbs(path, foldFrom) {
  if (!path.isConnected) return;
  path.querySelector(':scope > .crumb-more-slot')?.remove();
  const slots = [...path.querySelectorAll(':scope > .crumb-slot')];
  for (const sl of slots) sl.hidden = false;
  path.classList.add('crumb-measure');
  const widths = slots.map((sl) => sl.getBoundingClientRect().width);
  path.classList.remove('crumb-measure');
  const fold = weaveBreadcrumbs.foldPlan(widths, path.clientWidth, { from: foldFrom, more: CRUMB_MORE_PX });
  if (!fold.length) return;
  for (const i of fold) slots[i].hidden = true;
  const hidden = fold.map((i) => slots[i].crumb);
  const btn = el('button', {
    type: 'button', class: 'btn btn-sm btn-ghost-secondary crumb-more', title: `${hidden.length} more on the trail`,
    'aria-label': `${hidden.length} more on the trail`, 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: (e) => { e.stopPropagation(); crumbFoldMenu(btn, hidden); },
  }, lucideEl('ellipsis'));
  slots[fold[0]].before(el('span', { class: 'crumb-slot crumb-more-slot' },
    el('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›'), btn));
}
const CRUMB_MORE_PX = 40;

function crumbFoldMenu(btn, hidden) {
  const row = btn.closest('.crumb-row');
  const open = row.querySelector('.crumb-fold-menu');
  if (open) { open.remove(); return; }
  const r = btn.getBoundingClientRect();
  const menu = el('div', { class: 'chip-pop crumb-fold-menu', role: 'menu', style: `top:${r.bottom + 4}px;left:${r.left}px` },
    ...hidden.map((c) => el('a', {
      class: 'chip-pop-row crumb-fold-row', role: 'menuitem', href: c.kind === 'ws' ? wsHomeHref() : c.href, title: c.title ?? c.label,
    }, ...crumbInner(c))));
  let off = () => {};
  const close = () => {
    menu.remove();
    btn.setAttribute('aria-expanded', 'false');
    off();
    removeEventListener('keydown', esc, true);
  };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } };
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setTimeout(close); });
  row.append(menu);
  const over = menu.getBoundingClientRect().right - (innerWidth - 8);
  if (over > 0) menu.style.left = `${Math.max(8, r.left - over)}px`;
  btn.setAttribute('aria-expanded', 'true');
  off = dismissOutside({ open: () => menu.isConnected, inside: (t) => menu.contains(t), swallow: (t) => btn.contains(t), close });
  addEventListener('keydown', esc, true);
  menu.querySelector('a')?.focus();
}

function crumbOfHref(c) {
  if (c.kind) return c;
  const sp = c.href?.match(/^#\/space\/([^/?]+)/);
  if (sp) return { ...c, kind: 'space', icon: state.schema.find((x) => x.spaceId === sp[1])?.icon ?? null };
  const tb = c.href?.match(/^#\/(?:table|db)\/([^/?]+)/);
  if (tb) return { ...c, kind: 'table', icon: allTables().find((d) => d.id === tb[1])?.icon ?? null };
  if (c.href === wsHomeHref()) return { ...c, kind: 'ws' };
  return { ...c, kind: 'page' };
}

function wsMarkEl() {
  return fillWsMark(el('span', { class: 'wv-icon crumb-ic crumb-ws-mark' }));
}
let wsMarkIds = 0;
function fillWsMark(span) {
  const weave = $('#rail-weave.active');
  const chip = $('#ws-list .ws-icon.active');
  if (weave) {
    const n = ++wsMarkIds;
    span.innerHTML = [...weave.querySelectorAll('svg')].map((svg) => svg.outerHTML).join('')
      .replace(/id="([^"]+)"/g, `id="$1-c${n}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-c${n})`);
  } else if (chip?.querySelector('img')) {
    span.replaceChildren(el('img', { src: chip.querySelector('img').src, alt: '' }));
  } else {
    const name = $('#ws-name')?.textContent || 'w';
    span.replaceChildren(el('span', { class: 'crumb-ws-letter' }, name.slice(0, 1).toUpperCase()));
  }
  return span;
}
function refreshWsMarks() {
  for (const span of document.querySelectorAll('.crumb-ws-mark')) fillWsMark(span);
}

function viewHeader({ crumbs = [], permalink, title, onRename = null, description = null, onSaveDescription = null, actions = [], icon = null, onSetIcon = null, kind = 'page' }) {
  const box = el('div', { class: 'view-header' });
  box.append(el('div', { class: 'crumb crumb-row' },
    navMenuButton(),
    crumbPath([...crumbs.map(crumbOfHref), { kind, label: title, icon, current: true }], {
      copy: {
        title: 'Copy permalink',
        run: () => copyText(typeof permalink === 'function' ? permalink() : permalink, 'Permalink copied'),
      },
    }),
    el('span', { class: 'crumb-actions wv-toolbar' }, ...actions.filter(Boolean))));

  syncDocTitle(title);
  const titleInput = el('input', { class: 'view-title', value: title, 'aria-label': 'Title', title: onRename ? 'Click to rename' : '' });
  if (onRename) {
    titleInput.addEventListener('change', async () => {
      const name = titleInput.value.trim();
      if (!name || name === title) { titleInput.value = title; return; }
      try { await onRename(name); syncDocTitle(name); toast('Renamed'); } catch (err) { titleInput.value = title; toast(err.message, true); }
    });
  } else {
    titleInput.readOnly = true;
  }
  box.append(el('div', { class: 'wv-toolbar view-title-row' },
    onSetIcon ? iconButton(icon, onSetIcon) : (icon ? iconEl(icon) : null),
    el('h1', { class: 'view-title-h' }, titleInput)));

  if (onSaveDescription) {
    const descBox = el('div', { class: 'view-desc' });
    const showRendered = async (md) => {
      descBox.classList.remove('editing');
      if (!md.trim()) {
        descBox.replaceChildren(el('span', { class: 'view-desc-empty' }, 'Add description…'));
        return;
      }
      const body = el('div', { class: 'view-desc-body clamped' });
      try {
        const { html } = await api('POST', '/markdown', { md });
        body.innerHTML = html;
      } catch {
        body.textContent = md;
      }
      descBox.replaceChildren(body);
      if (body.scrollHeight > body.clientHeight + 1) {
        const more = el('button', { class: 'view-desc-more', type: 'button' }, 'Show more');
        more.addEventListener('click', () => {
          const folded = body.classList.toggle('clamped');
          more.textContent = folded ? 'Show more' : 'Show less';
        });
        descBox.append(more);
      } else {
        body.classList.remove('clamped');
      }
    };
    let current = description ?? '';
    const startEdit = () => {
      if (descBox.classList.contains('editing')) return;
      descBox.classList.add('editing');
      const ta = el('textarea', { class: 'view-desc-edit', placeholder: 'Description (markdown)…' });
      ta.value = current;
      const save = async () => {
        const md = ta.value;
        if (md === current) { showRendered(current); return; }
        try {
          await onSaveDescription(md);
          current = md;
        } catch (err) { toast(err.message, true); }
        showRendered(current);
      };
      ta.addEventListener('blur', save);
      ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') ta.blur(); });
      descBox.replaceChildren(ta);
      requestAnimationFrame(() => { ta.focus(); ta.style.height = Math.max(38, ta.scrollHeight) + 'px'; });
    };
    descBox.addEventListener('click', (e) => { if (!e.target.closest('a,textarea,button')) startEdit(); });
    showRendered(current);
    box.append(descBox);
  }
  return stickViewHeader(box);
}

function wsHomeHref() {
  return (WS_PREFIX || '') + '/';
}

function fmtSize(bytes) {
  const gb = bytes / 1e9;
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${gb.toFixed(2)} GB`;
}

function renderNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  const folded = new Set(JSON.parse(localStorage.getItem('weave-folded-spaces') ?? '[]'));
  const toggleFold = (spaceId) => {
    if (folded.has(spaceId)) folded.delete(spaceId);
    else folded.add(spaceId);
    localStorage.setItem('weave-folded-spaces', JSON.stringify([...folded]));
    renderNav();
  };
  for (const space of state.schema) {
    const isFolded = folded.has(space.spaceId);
    const spaceRow = el('div', { class: 'nav-space-row' },
      el('a', {
        class: 'nav-space', href: `#/space/${space.spaceId}`,
        onclick: (e) => {
          if (nativeClick(e)) return;
          if (state.route?.page === 'space' && state.route.spaceId === space.spaceId) {
            e.preventDefault();
            toggleFold(space.spaceId);
          }
        },
      }, iconEl(space.icon, 'wv-icon nav-icon'), space.space),
      el('button', {
        class: 'nav-caret' + (isFolded ? '' : ' open'),
        title: isFolded ? `Expand ${space.space}` : `Collapse ${space.space}`, type: 'button',
        'aria-expanded': String(!isFolded),
        onclick: () => toggleFold(space.spaceId),
      }, chevron()),
      el('button', {
        class: 'btn btn-sm btn-icon btn-ghost-secondary tiny nav-add-table',
        title: `New table in ${space.space}`, type: 'button',
        onclick: () => spaceRow.after(inlineNameInput('New table name…', async (name) => {
          await api('POST', '/tables', { space: space.space, name });
          await loadSchema();
        })),
      }, iconEl('+', 'wv-icon')));
    nav.append(spaceRow);
    if (isFolded) continue;
    for (const db of space.tables) {
      if (db.system === 'workflows') continue;
      const row = el('a', {
        class: 'nav-db' + (state.route?.dbId === db.id ? ' active' : ''),
        href: `#/table/${db.id}`,
      }, iconEl(db.icon, 'wv-icon nav-icon'), db.name);
      if (!db.system) row.append(navTableMenu(db, space, row));
      nav.append(row);
    }
  }
  const foot = el('div', { class: 'nav-foot' },
    el('button', {
      class: 'btn btn-sm btn-ghost-secondary', type: 'button',
      onclick: () => foot.append(inlineNameInput('New space name…', async (name) => {
        await api('POST', '/spaces', { name });
        await loadSchema();
      })),
    }, '+ New space'));
  const entityTotal = state.schema.reduce((n, s) => n + s.tables.reduce((m, d) => m + (d.entityCount ?? 0), 0), 0);
  const line = el('span', { class: 'nav-stats-line', title: 'Rows in this workspace · storage on disk' },
    `${entityTotal.toLocaleString()} ${entityTotal === 1 ? WeaveTerm.DEFAULT.singular : WeaveTerm.DEFAULT.plural}`);
  const stats = el('div', { class: 'nav-stats' }, foot, line);
  const wf = allTables().find((d) => d.system === 'workflows');
  const sysRow = (href, icon, label, on) => el('a', { class: 'nav-db' + (on ? ' active' : ''), href }, lucideEl(icon, 'wv-icon nav-icon'), label);
  const system = el('div', { class: 'nav-system', role: 'group', 'aria-label': 'Workspace system tables' },
    ...(wf ? [sysRow(`#/table/${wf.id}`, 'workflow', 'Workflows', state.route?.dbId === wf.id)] : []),
    sysRow('#/activity', 'activity', 'Activity', state.route?.page === 'activity'),
    sysRow('#/trash', 'trash-2', 'Trash', state.route?.page === 'trash' && !state.route.dbId));
  document.querySelector('#sidebar .nav-system')?.remove();
  document.querySelector('#sidebar .nav-stats')?.remove();
  $('#sidebar').append(system);
  $('#sidebar').append(stats);
  (state.healthP ??= api('GET', '/health')).then((h) => {
    if (h.sizeBytes != null) line.append(` · ${fmtSize(h.sizeBytes)}`);
  }).catch(() => {});
  if (state.healthChip) stats.append(state.healthChip);
  else {
    const status = state.healthChip = el('div', { class: 'nav-health', title: 'This weave instance' }, '…');
    (state.healthP ??= api('GET', '/health')).then((h) => {
      const up = h.uptime == null ? '' : ` · up ${h.uptime < 3600 ? Math.round(h.uptime / 60) + 'm' : Math.round(h.uptime / 3600) + 'h'}`;
      state.health = h;
      status.textContent = `v${h.version}${up}`;
      if (h.startedAt) status.title = `This weave instance — started ${h.startedAt}`;
      if (h.stale) {
        status.classList.add('is-stale');
        status.textContent += ` · ${h.sha} ≠ ${h.diskSha}`;
        status.title = `This server booted at ${h.sha}; the checkout it serves is at ${h.diskSha} — restart weave`;
        toast(`This page was served by ${h.diskSha} but the server is still running ${h.sha} — restart weave; until then saving can fail silently`, true);
      } else if (h.releaseBehind) {
        status.classList.add('is-behind');
        status.textContent += ` · v${h.latestRelease} available`;
        status.title = `weave v${h.latestRelease} is out; this instance runs v${h.version}. Checked ${h.releaseCheckedAt}.`;
        let seen = null;
        try { seen = localStorage.getItem('wv-release-seen'); } catch {}
        if (seen !== h.latestRelease) {
          toast(`weave v${h.latestRelease} is available. This instance runs v${h.version}.`);
          try { localStorage.setItem('wv-release-seen', h.latestRelease); } catch {}
        }
      } else if (h.behind) {
        status.classList.add('is-behind');
        status.textContent += ` · ${h.sha} ≠ ${h.latestSha}`;
        status.title = `This instance runs ${h.sha}; main is at ${h.latestSha}. Run git pull, then restart weave.`;
        toast(`This instance is behind main (${h.sha} → ${h.latestSha}). Run git pull, then restart weave.`, true);
      }
    }).catch(() => { status.textContent = 'offline'; });
    stats.append(status);
  }
  stats.append(accountSlot());
}

const ACCOUNT_ROLE_LABELS = { architect: 'Architect', editor: 'Editor', observer: 'Observer', admin: 'Architect', writer: 'Editor', reader: 'Observer' };

function accountSlot() {
  return state.accountSlot ??= el('div', { class: 'nav-account' });
}

function accountDisplayName(name) {
  const s = String(name ?? '').trim();
  return s.includes('@') ? s.split('@')[0] : s;
}

function accountWorkspaceName() {
  return state.wsCurrent || $('#ws-name')?.textContent || 'this workspace';
}

async function refreshAccountChip() {
  const slot = accountSlot();
  let me = null;
  try { me = await api('GET', '/auth/me'); } catch (err) {
    if (err.status !== 401) return;
  }
  closeAccountMenu();
  if (me?.account) {
    slot.dataset.state = 'signed-in';
    slot.replaceChildren(accountChip(me));
    return;
  }
  const walled = await api('GET', '/workspace').then((w) => !!w.requireAuth, (err) => err.status === 401);
  slot.dataset.state = walled ? 'signed-out' : 'none';
  slot.replaceChildren(...(walled ? [el('a', {
    class: 'nav-account-chip nav-account-signin',
    href: `${WS_PREFIX}/auth?next=${encodeURIComponent(location.pathname + location.hash)}`,
    title: `Sign in to ${accountWorkspaceName()}`,
  }, lucideEl('log-in', 'wv-icon nav-account-ic'), el('span', { class: 'nav-account-name' }, 'Sign in'))] : []));
}

function accountChip(me) {
  const name = accountDisplayName(me.account.name) || 'Signed in';
  const role = ACCOUNT_ROLE_LABELS[me.role] ?? me.role ?? '';
  const avatar = el('span', { class: `av nav-account-av hue-${chipCore.hueForName(name)}`, 'aria-hidden': 'true' }, chipCore.initialsFor(name));
  const btn = el('button', {
    type: 'button', class: 'nav-account-chip', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    title: `${name}${role ? `, ${role}` : ''} in ${accountWorkspaceName()}`,
    onclick: (e) => { e.stopPropagation(); accountMenu(btn); },
  }, avatar, el('span', { class: 'nav-account-name' }, name), role ? el('span', { class: 'nav-account-role' }, role) : null);
  return btn;
}

function closeAccountMenu() {
  document.querySelector('.nav-account-menu')?.close?.();
}

function accountMenu(btn) {
  if (document.querySelector('.nav-account-menu')) { closeAccountMenu(); return; }
  const r = btn.getBoundingClientRect();
  const ws = accountWorkspaceName();
  const row = (label, icon, prefixes) => el('button', {
    type: 'button', class: 'chip-pop-row wv-menu-row', role: 'menuitem',
    onclick: () => { close(); signOutOf(prefixes); },
  }, lucideEl(icon, 'wv-icon'), label);
  const everywhere = [WS_PREFIX, ...(state.wsList ?? []).filter((w) => w.name !== state.wsCurrent).map((w) => `/w/${encodeURIComponent(w.name)}`)];
  const menu = el('div', {
    class: 'chip-pop nav-account-menu', role: 'menu', 'aria-label': 'Account',
    style: `left:${Math.round(r.left)}px;bottom:${Math.round(innerHeight - r.top + 4)}px;min-width:${Math.round(r.width)}px`,
  }, row(`Sign out of ${ws}`, 'log-out', [WS_PREFIX]), row('Sign out everywhere', 'log-out', everywhere));
  const rows = [...menu.querySelectorAll('[role="menuitem"]')];
  let off = () => {};
  const close = () => {
    menu.remove();
    btn.setAttribute('aria-expanded', 'false');
    off();
    removeEventListener('keydown', keys, true);
  };
  const keys = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); return; }
    if (e.key === 'Tab') { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = rows.indexOf(document.activeElement);
      rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus();
    }
  };
  menu.close = close;
  document.body.append(menu);
  btn.setAttribute('aria-expanded', 'true');
  off = dismissOutside({ open: () => menu.isConnected, inside: (t) => menu.contains(t) || btn.contains(t), close });
  addEventListener('keydown', keys, true);
  rows[0].focus();
}

async function signOutOf(prefixes) {
  await Promise.allSettled([...new Set(prefixes)].map((p) => fetch(`${p}/api/auth/logout`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin',
  })));
  location.assign(`${WS_PREFIX}/auth?signed-out=1`);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.accountSlot) refreshAccountChip();
});

function fieldValueCell(value) {
  if (value == null || value === '') return '';
  if (Array.isArray(value)) {
    return value.map((v) => (v && typeof v === 'object' ? v.name : String(v))).join(', ');
  }
  if (typeof value === 'object') return value.name ?? JSON.stringify(value);
  if (typeof value === 'boolean') return value ? '✓' : '';
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  return String(value);
}

const isIconRef = (v) => /^(lucide|iconly):/.test(String(v ?? ''));
function stateLabel(fieldSchema, stateName) {
  if (stateName == null) return '—';
  const icon = fieldSchema.states?.find((s) => s.name === stateName)?.icon;
  return icon && !isIconRef(icon) ? `${icon} ${stateName}` : stateName;
}
function stateNodes(fieldSchema, stateName) {
  if (stateName == null) return [chipLabel('—')];
  const icon = fieldSchema.states?.find((s) => s.name === stateName)?.icon;
  if (!icon) return [chipLabel(stateName)];
  return isIconRef(icon)
    ? [iconEl(icon, 'ico wv-icon'), chipLabel(stateName)]
    : [chipLabel(`${icon} ${stateName}`)];
}
function chipLabel(text) {
  return el('span', { class: 'k-label' }, text);
}
function stateCategory(fieldSchema, stateName) {
  const found = fieldSchema.states?.find((s) => s.name === stateName)?.category;
  return found ? chipCore.categoryOrDefault(found) : 'not-started';
}

function stateChipClass(fieldSchema, stateName) {
  const cat = stateCategory(fieldSchema, stateName);
  const st = fieldSchema.states?.find((s) => s.name === stateName);
  return `k k-state cat-${cat} hue-${chipCore.stateHue(st, cat)}`;
}

const PERSON_TABLE = /^(people|persons?|members?|users?|contacts?|owners?|team|staff|employees?)$/i;
function relationIsPerson(f) {
  const table = String(f?.targetDb ?? '').split('/').pop() ?? '';
  return PERSON_TABLE.test(table.trim());
}
function personAvatar(f, target) {
  if (!relationIsPerson(f)) return null;
  const name = target?.name ?? '';
  if (!name) return el('span', { class: 'av unknown' }, '?');
  return el('span', { class: `av hue-${chipCore.hueForName(name)}` }, chipCore.initialsFor(name));
}

function deckRoleOf(db) {
  if (!db?.fields) return null;
  const isSlideTable = (t) => !!t?.fields?.some((f) => f.name === 'Model' && f.type === 'document');
  const slides = db.fields.find((f) => f.name === 'Slides');
  if (slides?.type === 'relation' && slides.many
    && isSlideTable(allTables().find((t) => t.id === slides.targetDbId))) return 'deck';
  if (isSlideTable(db)) return 'slide';
  return null;
}

let mermaidLoading = null;


function expandDocument(grid, url, title) {
  grid.parentElement?.querySelector('.doc-expand')?.remove();
  const frame = el('iframe', { class: 'doc-expand-frame', src: url, allowfullscreen: '', allow: 'fullscreen', title });
  const collapse = () => { wrap.remove(); grid.classList.remove('hidden'); };
  const wrap = el('div', { class: 'doc-expand' },
    el('div', { class: 'doc-expand-bar' },
      el('button', { class: 'btn btn-sm', title: 'Collapse (Esc)', onclick: collapse }, '‹ Collapse'),
      el('span', { class: 'fsv-title' }, title),
      el('span', { style: 'flex:1' }),
      el('button', { class: 'btn btn-sm', title: 'Refresh', onclick: () => { try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; } } }, iconEl('⟳')),
      el('a', { class: 'btn btn-sm', href: url, target: '_blank', title: 'Open in a browser tab' }, iconEl('lucide:arrow-up-right', 'wv-icon'))),
    frame);
  grid.classList.add('hidden');
  grid.after(wrap);
  const onKey = (e) => { if (e.key === 'Escape') collapse(); };
  addEventListener('keydown', function esc(e) {
    if (!wrap.isConnected) return removeEventListener('keydown', esc);
    onKey(e);
  });
  frame.addEventListener('load', () => {
    try { frame.contentWindow.addEventListener('keydown', onKey); } catch {}
  });
  return wrap;
}

function fullscreenViewer(title, { url = null, mount = null, sandbox = null, prev = null, next = null } = {}) {
  document.querySelector('#fsv-back')?.remove();
  const frame = url ? el('iframe', { class: 'fsv-frame', src: url, allowfullscreen: '', allow: 'fullscreen', sandbox: sandbox ?? undefined }) : null;
  const close = () => back.remove();
  const goBack = () => {
    const h = frame?.contentWindow?.history;
    if (h && h.length > 1) h.back(); else close();
  };
  const back = el('div', { id: 'fsv-back' },
    el('div', { class: 'fsv-bar' },
      url ? el('button', { class: 'btn btn-sm', title: 'Back', onclick: goBack }, iconEl('‹')) : null,
      url ? el('button', { class: 'btn btn-sm', title: 'Refresh', onclick: () => { try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; } } }, iconEl('⟳')) : null,
      el('span', { class: 'fsv-title' }, title),
      el('span', { style: 'flex:1' }),
      prev || next ? el('span', { class: 'fsv-nav' },
        el('button', { class: 'btn btn-sm', title: 'Previous (←)', disabled: prev ? undefined : '', onclick: () => prev?.() }, iconEl('‹')),
        el('button', { class: 'btn btn-sm', title: 'Next (→)', disabled: next ? undefined : '', onclick: () => next?.() }, iconEl('›'))) : null,
      url ? el('a', { class: 'btn btn-sm', href: url, target: '_blank', title: 'Open in a browser tab' }, iconEl('lucide:arrow-up-right', 'wv-icon')) : null,
      el('button', { class: 'btn btn-sm', title: 'Close (Esc)', onclick: close }, iconEl('✕'))),
    frame ?? el('div', { class: 'fsv-body' }));
  document.body.append(back);
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && prev) prev();
    else if (e.key === 'ArrowRight' && next) next();
  };
  addEventListener('keydown', function esc(e) {
    if (!back.isConnected) return removeEventListener('keydown', esc);
    onKey(e);
  });
  frame?.addEventListener('load', () => {
    try { frame.contentWindow.addEventListener('keydown', onKey); } catch {}
  });
  if (mount) mount(back.querySelector('.fsv-body'));
  return back;
}

let cytoscapeLoading = null;
function openWhiteboard(mmdSource, title = 'Whiteboard') {
  cytoscapeLoading ??= new Promise((resolve) => {
    if (window.cytoscape) return resolve();
    const sc = document.createElement('script');
    sc.src = '/vendor/cytoscape.min.js';
    sc.onload = resolve;
    sc.onerror = () => resolve();
    document.head.append(sc);
  });
  fullscreenViewer(title, {
    mount: (body) => cytoscapeLoading.then(() => {
      if (!window.cytoscape) { body.textContent = 'cytoscape failed to load'; return; }
      const g = window.parseMermaidGraph?.(mmdSource) ?? { nodes: [], edges: [] };
      if (!g.nodes.length) { body.textContent = 'Nothing drawable in this diagram.'; return; }
      const dark = document.documentElement.dataset.bsTheme === 'dark';
      const fg = dark ? '#e5e7eb' : '#1a1d21';
      const box = dark ? '#2b3038' : '#f4f6f8';
      const line = dark ? '#4b5563' : '#9ca3af';
      const cy = window.cytoscape({
        container: body,
        elements: [
          ...g.nodes.map((n) => ({ data: { id: n.id, label: n.label }, classes: n.shape })),
          ...g.edges.map((e2, i) => ({ data: { id: 'e' + i, source: e2.from, target: e2.to, label: e2.label } })),
        ],
        layout: { name: 'breadthfirst', directed: true, spacingFactor: 1.2 },
        style: [
          { selector: 'node', style: { label: 'data(label)', shape: 'round-rectangle', 'background-color': box, 'border-color': line, 'border-width': 1, color: fg, 'font-size': 13, 'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap', width: 'label', height: 'label', padding: '10px' } },
          { selector: 'node.diamond', style: { shape: 'diamond', padding: '18px' } },
          { selector: 'node.circle', style: { shape: 'ellipse', padding: '14px' } },
          { selector: 'edge', style: { label: 'data(label)', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'line-color': line, 'target-arrow-color': line, color: fg, 'font-size': 11, 'text-wrap': 'wrap', width: 1.5 } },
        ],
        wheelSensitivity: 0.2,
      });
      requestAnimationFrame(() => { cy.resize(); cy.fit(undefined, 80); });
    }),
  });
}

function renderMermaidIn(container) {
  const nodes = container.querySelectorAll('pre.mermaid');
  if (!nodes.length) return;
  mermaidLoading ??= new Promise((resolve) => {
    if (window.mermaid) return resolve();
    const s = document.createElement('script');
    s.src = '/vendor/mermaid.min.js';
    s.onload = () => {
      window.mermaid?.initialize({
        startOnLoad: false,
        theme: document.documentElement.dataset.bsTheme === 'dark' ? 'dark' : 'default',
      });
      resolve();
    };
    s.onerror = () => resolve();
    document.head.append(s);
  });
  for (const pre of nodes) {
    if (!pre.dataset.mmd) pre.dataset.mmd = pre.textContent;
    const holder = el('span', { class: 'mmd-tools' },
      el('button', {
        class: 'btn btn-sm btn-ghost-secondary tiny', title: 'Open as a whiteboard',
        onclick: () => openWhiteboard(pre.dataset.mmd, 'Whiteboard'),
      }, iconEl('⛶')));
    if (!pre.previousElementSibling?.classList?.contains('mmd-tools')) pre.before(holder);
  }
  mermaidLoading.then(() => window.mermaid?.run({ nodes }));
}

function dismissOutside({ inside, close, open = () => true, swallow = () => false }) {
  const away = (e) => {
    if (!open()) return off();
    if (inside(e.target)) return;
    off();
    if (swallow(e.target)) swallowClick();
    close(e);
  };
  const off = () => removeEventListener('pointerdown', away, true);
  addEventListener('pointerdown', away, true);
  return off;
}
function swallowClick(ms = 600) {
  const eat = (e) => { e.preventDefault(); e.stopImmediatePropagation(); off(); };
  const off = () => { clearTimeout(timer); removeEventListener('click', eat, true); };
  const timer = setTimeout(off, ms);
  addEventListener('click', eat, true);
}

function showPopover(trigger, rows, { owns = (t) => trigger.contains(t) } = {}) {
  document.querySelector('.chip-pop')?.remove();
  const pop = el('div', { class: 'chip-pop' }, ...rows);
  document.body.append(pop);
  const r = trigger.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = (r.bottom + 4 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 4 : r.bottom + 4) + 'px';
  dismissOutside({ open: () => pop.isConnected, inside: (t) => pop.contains(t), swallow: owns, close: () => pop.remove() });

  const opts = [...pop.querySelectorAll('.chip-pop-row')];
  const focusAt = (i) => opts[((i % opts.length) + opts.length) % opts.length].focus();
  pop.addEventListener('keydown', (ev) => {
    const i = opts.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); focusAt(i + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); focusAt(i - 1); }
    else if (ev.key === 'Escape') { ev.preventDefault(); pop.remove(); trigger.focus(); }
    else if (ev.key === 'Tab') pop.remove();
  });
  const checked = opts.findIndex((o) => o.querySelector('.chip-pop-check'));
  if (opts.length) focusAt(checked < 0 ? 0 : checked);

  const cell = trigger.closest?.('tr[data-eid] > td');
  state.refocus = cell
    ? { eid: cell.parentElement.dataset.eid, col: [...cell.parentElement.children].indexOf(cell) }
    : null;
  pop.cellFrom = cell;
  return pop;
}

function relearnRows(pop, next, refocus = null) {
  const shape = (nodes) => nodes
    .map((n) => `${n.className} ${n.querySelector?.('.eye-label')?.textContent ?? n.textContent}`)
    .join('');
  const live = [...pop.children];
  if (shape(live) === shape(next)) {
    live.forEach((node, i) => {
      if (!node.classList.contains('eye-row')) return;
      const on = next[i].getAttribute('aria-checked') === 'true';
      node.setAttribute('aria-checked', on ? 'true' : 'false');
      node.querySelector('.switch')?.classList.toggle('on', on);
    });
    return;
  }
  const scroll = pop.scrollTop;
  pop.replaceChildren(...next);
  pop.scrollTop = scroll;
  refocus?.(pop);
}

function holdToConfirm(label, onConfirm, {
  holdingLabel = 'Hold to confirm…', rowClass = 'dropdown-item', icon = null, hint = null,
} = {}) {
  const fill = el('span', { class: 'hold-fill' });
  const text = el('span', { class: 'hold-label' }, label);
  const btn = el('button', { class: `${rowClass} text-danger hold-btn`, type: 'button' },
    fill, icon ? iconEl(icon, 'wv-icon wv-menu-icon hold-icon') : null, text,
    hint ? el('span', { class: 'hold-hint' }, hint) : null);
  let armed = false;
  let press = 0;
  const start = (e) => {
    if (armed) return;
    armed = true;
    press++;
    if (e?.pointerId != null) { try { btn.setPointerCapture(e.pointerId); } catch {} }
    btn.classList.add('holding');
    text.textContent = holdingLabel;
  };
  const stop = () => {
    armed = false;
    btn.classList.remove('holding');
    text.textContent = label;
  };
  btn.addEventListener('pointerdown', start);
  for (const ev of ['pointerup', 'pointerleave', 'blur', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, stop);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } });
  btn.addEventListener('keyup', stop);
  fill.addEventListener('transitionend', (e) => {
    if (!armed || e.propertyName !== 'transform') return;
    const thisPress = press;
    setTimeout(async () => {
      if (!armed || press !== thisPress) return;
      stop();
      await onConfirm();
    }, 80);
  });
  return btn;
}

function rememberGridFocus() {
  const at = document.activeElement;
  const cell = at?.closest?.('tr[data-eid] > td');
  if (!cell) return;
  let caret = null;
  try {
    if (at.selectionStart != null) caret = [at.selectionStart, at.selectionEnd];
  } catch {}
  state.refocus = { eid: cell.parentElement.dataset.eid, col: [...cell.parentElement.children].indexOf(cell), caret, open: at !== cell };
}

function restoreGridFocus({ now = false } = {}) {
  const want = state.refocus;
  state.refocus = null;
  if (!want) return;
  (now ? (fn) => fn() : requestAnimationFrame)(() => {
    const td = $(`tr[data-eid="${want.eid}"]`)?.children[want.col];
    if (!td) return;
    if (want.open === false) return td.focus();
    const box = td.querySelector('button,input,select,textarea,[tabindex]');
    if (!box) return td.focus();
    box.focus();
    if (want.caret) { try { box.setSelectionRange(want.caret[0], want.caret[1]); } catch {} }
  });
}


function searchPicker({ anchor = null, title = '', placeholder = 'Search…', options, currentId = null, onPick, multi = null, clearId = null, grid = false, groups = false, custom = null }) {
  document.querySelector('.chip-pop')?.remove();
  const core = globalThis.pickerCore;
  if (grid) currentId = window.weaveIconRegistry?.canonical(currentId) ?? currentId;
  let st = core.blank({
    mode: multi ? 'multi' : 'single',
    options,
    staged: multi ? multi.selected.map((x) => ({ ...x })) : [],
    currentId,
    clearId,
  });
  const input = el('input', { class: 'picker-search', placeholder, type: 'text' });
  const chips = el('span', { class: 'picker-chips' });
  const readout = el('span', { class: 'picker-name', 'aria-hidden': 'true' });
  const box = el('div', { class: 'picker-box' }, chips, input, readout);
  const list = el('div', { class: 'picker-list' });
  const sheet = dockCoversScreen.matches;
  const quiet = sheet && !grid && !groups && options.length <= PHONE_SHORT_LIST;
  const heading = title || (sheet ? anchor?.dataset?.fieldTitle || anchor?.getAttribute?.('title') || '' : '');
  const pop = el('div', { class: 'chip-pop picker-pop' + (quiet ? ' picker-quiet' : '') + (quiet && !multi ? ' picker-short' : '') },
    heading ? el('div', { class: 'picker-title' }, heading) : null,
    box, list);
  const commit = async () => { pop.remove(); await multi.onCommit(core.ids(st)); };
  const dismiss = () => { if (multi) commit(); else pop.remove(); anchor?.focus?.(); };
  if (multi) pop.commit = commit;
  const pick = async (o) => { pop.remove(); await onPick(o); };
  const apply = (next) => { st = next; input.value = st.query; drawChips(); draw(); if (!quiet) input.focus(); };

  const drawChips = () => {
    if (grid || groups) {
      chips.replaceChildren();
      input.placeholder = placeholder;
      return;
    }
    chips.replaceChildren(...st.staged.map((x, i) => el('span', {
      class: `${x.cls ?? 'k k-multi hue-slate'} picker-chip${st.caret === i ? ' sel' : ''}`,
      onclick: (ev) => { ev.stopPropagation(); apply({ ...st, caret: i, active: -1 }); },
    }, x.label,
      (multi || clearId) ? el('span', {
        class: 'x', title: 'Remove',
        onclick: (ev) => {
          ev.stopPropagation();
          if (multi) apply(core.removeId(st, x.id)); else pick({ id: clearId, label: clearId });
        },
      }, iconEl('lucide:x', 'wv-icon wv-icon-xs')) : null)));
    input.placeholder = st.staged.length ? '' : placeholder;
  };
  const restName = () => (currentId ? options.find((o) => o.id === currentId)?.label ?? '' : '');
  let hovering = null, focusing = null;
  const showName = () => { readout.textContent = focusing ?? hovering ?? restName(); };
  const drawGrid = () => {
    const vis = core.visible(st);
    const groups = fieldDialogCore.iconGroups(vis);
    const clear = vis.find((o) => !o.id);
    const cell = (o, extra = '') => el('button', {
      class: `picker-cell${extra}` + (o.id === currentId ? ' on' : ''), type: 'button',
      title: o.label, 'aria-label': o.label,
      onclick: async () => { await pick(o); },
      onmouseenter: () => { hovering = o.label; showName(); },
      onmouseleave: () => { if (hovering === o.label) hovering = null; showName(); },
      onfocus: () => { focusing = o.label; showName(); },
      onblur: () => { if (focusing === o.label) focusing = null; showName(); },
    }, o.lucide ? iconEl(`lucide:${o.lucide}`) : iconEl(o.mark) ?? el('span', { class: 'wv-icon icon-ghost' }, '◌'));
    list.replaceChildren(
      ...(clear ? [el('div', { class: 'picker-cells' }, cell(clear, ' picker-none'))] : []),
      ...groups.flatMap((g) => [
        el('div', { class: 'picker-cat' }, g.name),
        el('div', { class: 'picker-cells' }, ...g.items.map((o) => cell(o))),
      ]));
    if (!groups.length && !clear) list.append(el('div', { class: 'picker-empty' }, 'No matches'));
    hovering = focusing = null;
    showName();
  };
  const drawGroups = () => {
    const vis = core.visible(st);
    const byGroup = new Map();
    for (const o of vis) { if (!byGroup.has(o.group)) byGroup.set(o.group, []); byGroup.get(o.group).push(o); }
    list.replaceChildren(...[...byGroup].flatMap(([name, items]) => [
      el('div', { class: 'picker-cat' }, name),
      el('div', { class: 'picker-cells picker-terms' }, ...items.map((o) => el('button', {
        class: 'picker-cell picker-term' + (o.id === currentId ? ' on' : ''), type: 'button', title: o.label,
        onclick: async () => { await pick(o); },
      }, o.label))),
    ]));
    const q = st.query.trim();
    const exact = q && options.some((o) => o.label.toLowerCase() === q.toLowerCase() || o.id === q.toLowerCase());
    if (!vis.length && !(custom && q)) list.append(el('div', { class: 'picker-empty' }, 'No matches'));
    if (custom && q && !exact) {
      list.append(el('button', {
        class: 'picker-custom', type: 'button',
        onclick: async () => { pop.remove(); await custom(q); },
      }, `Use “${q.charAt(0).toUpperCase() + q.slice(1)}” as a custom term`));
    }
  };
  const draw = () => {
    if (grid) return drawGrid();
    if (groups) return drawGroups();
    const vis = core.visible(st);
    list.replaceChildren(...vis.map((o, i) => el('button', {
      class: 'chip-pop-row picker-row' + (i === st.active ? ' active' : ''), type: 'button',
      title: i < 9 ? `⌥${i + 1}` : null,
      onclick: async () => {
        if (multi) { apply(core.toggle(st, o)); return; }
        await pick(o);
      },
    },
      el('span', { class: 'picker-num' }, i < 9 ? String(i + 1) : ''),
      o.chip ? el('span', { class: o.cls ?? 'k k-multi hue-slate' }, o.label)
        : o.lucide ? el('span', { class: 'picker-label picker-iconly' }, iconEl(`lucide:${o.lucide}`), o.label)
        : o.mark ? el('span', { class: 'picker-label picker-iconly' }, iconEl(o.mark), o.label)
        : el('span', { class: 'picker-label' }, o.label),
      o.hint ? el('span', { class: 'picker-hint' }, o.hint) : null,
      (multi ? false : o.id === currentId) ? el('span', { class: 'chip-pop-check' }, '✓') : null)));
    if (!vis.length) {
      list.append(el('div', { class: 'picker-empty' },
        multi && st.staged.length && !st.query.trim() ? 'Everything is chosen' : 'No matches'));
    }
  };
  box.addEventListener('click', (ev) => {
    if (ev.target !== box && ev.target !== chips) return;
    apply({ ...st, caret: null });
  });
  input.addEventListener('input', () => { st = core.search(st, input.value); drawChips(); draw(); });
  input.addEventListener('keydown', async (ev) => {
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const quick = ev.altKey && /^Digit[1-9]$/.test(ev.code) ? Number(ev.code.slice(5)) : null;
    if (groups && custom && ev.key === 'Enter' && st.query.trim()) {
      const q = st.query.trim();
      const exact = options.find((o) => o.label.toLowerCase() === q.toLowerCase() || o.id === q.toLowerCase());
      if (!exact) { ev.preventDefault(); pop.remove(); await custom(q); return; }
    }
    const r = core.keyDown(st, { key: ev.key, atStart, quick });
    if (!r.handled) return;
    ev.preventDefault();
    if (r.state) { st = r.state; input.value = st.query; drawChips(); draw(); }
    if (!r.effect) return;
    if (r.effect.type === 'pick') await pick(r.effect.option);
    else if (r.effect.type === 'close') { ev.stopPropagation(); dismiss(); }
    else if (multi) await commit();
    else dismiss();
  });
  document.body.append(pop);
  pop.cellFrom = anchor?.closest?.('tr[data-eid] > td') ?? null;
  dismissOutside({
    open: () => pop.isConnected, inside: (t) => pop.contains(t), swallow: (t) => !!anchor?.contains?.(t),
    close: () => (multi ? commit() : pop.remove()),
  });
  if (!quiet) input.focus();
  drawChips();
  draw();
  anchorPop(pop, anchor);
  if (quiet) (list.querySelector('.chip-pop-check')?.closest('button') ?? list.querySelector('button'))?.focus({ preventScroll: true });
  return pop;
}
const PHONE_SHORT_LIST = 8;
const PHONE_ROW_H = { compact: 68, comfortable: 88, spacious: 88 };

function anchorPop(pop, anchor) {
  if (anchor?.getBoundingClientRect) {
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = (r.bottom + 4 + pop.offsetHeight > innerHeight ? Math.max(8, r.top - pop.offsetHeight - 4) : r.bottom + 4) + 'px';
  } else {
    pop.classList.add('picker-centered');
  }
}

function valuePop({ anchor = null, title = '', type = 'text', placeholder = '', apply = 'Apply', onApply }) {
  document.querySelector('.chip-pop')?.remove();
  const input = el('input', { class: 'form-control form-control-sm', type, placeholder });
  const pop = el('div', { class: 'chip-pop picker-pop value-pop' },
    title ? el('div', { class: 'picker-title' }, title) : null,
    el('form', {
      class: 'value-form',
      onsubmit: async (ev) => { ev.preventDefault(); pop.remove(); await onApply(input.value); },
    }, input, el('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, apply)));
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); pop.remove(); anchor?.focus?.(); } });
  document.body.append(pop);
  anchorPop(pop, anchor);
  dismissOutside({ open: () => pop.isConnected, inside: (t) => pop.contains(t), close: () => pop.remove() });
  input.focus();
  return pop;
}

function pickerSelect({ name, options, value = null, placeholder = 'Choose…', title = '' }) {
  const input = el('input', { type: 'hidden', name, value: value ?? '' });
  const face = el('button', { class: 'form-select picker-face', type: 'button' },
    options.find((o) => o.id === value)?.label ?? placeholder);
  face.addEventListener('click', (e) => {
    e.stopPropagation();
    searchPicker({
      anchor: face, title, options, currentId: input.value || null,
      onPick: (o) => {
        input.value = o.id;
        face.textContent = o.label;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
    });
  });
  const wrap = el('span', { class: 'picker-wrap' }, input, face);
  wrap.input = input;
  return wrap;
}

function chipPicker({ trigger, options, current, onPick, clearId = null }) {
  trigger.classList.add('chip-trigger');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const cell = trigger.closest('td');
    state.refocus = cell
      ? { eid: cell.parentElement.dataset.eid, col: [...cell.parentElement.children].indexOf(cell) }
      : null;
    searchPicker({
      anchor: trigger,
      options: options.map((o) => ({ id: o.name, label: o.label ?? o.name, cls: o.cls, chip: true })),
      currentId: current,
      clearId,
      onPick: async (o) => { if (o.id !== current) await onPick(o.id); },
    });
  });
  return trigger;
}

function chipPickerMulti({ trigger, options, selected, onCommit }) {
  trigger.classList.add('chip-trigger');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const cell = trigger.closest('td');
    state.refocus = cell
      ? { eid: cell.parentElement.dataset.eid, col: [...cell.parentElement.children].indexOf(cell) }
      : null;
    searchPicker({
      anchor: trigger, options,
      multi: { selected, onCommit },
    });
  });
  return trigger;
}

function credentialLinkFor(keystore, ref) {
  const r = encodeURIComponent(String(ref ?? ''));
  switch (keystore) {
    case '1password': return `onepassword://search/?q=${r}`;
    case 'aws-sm': return `https://console.aws.amazon.com/secretsmanager/secret?name=${r}`;
    case 'google-sm': return `https://console.cloud.google.com/security/secret-manager/secret/${r}`;
    case 'cloudflare': return 'https://dash.cloudflare.com/?to=/:account/workers/services';
    case 'apple-passwords': return 'x-apple.systempreferences:com.apple.Passwords-Settings.extension';
    default: return null;
  }
}

function credentialReveal(name, keystore) {
  if (keystore && keystore !== 'local') {
    return el('a', { class: 'cred-open', href: credentialLinkFor(keystore, name), target: '_blank', rel: 'noopener' },
      `Open in ${KEYSTORE_LABELS[keystore] ?? keystore} ↗`);
  }
  const take = async (via) => {
    try {
      const { value } = await api('POST', `/keys/${encodeURIComponent(name)}/reveal`, { via });
      if (via === 'copy') return copyText(value, 'Copied — the reveal is on the record');
      shown.replaceChildren(el('code', { class: 'cred-plain' }, value));
      setTimeout(() => shown.replaceChildren(), 15000);
    } catch (e) {
      toast(String(e.message).match(/not shared|forbidden/i)
        ? `${name} is not shared with you — its owner has to grant it` : e.message, true);
    }
  };
  const shown = el('span', { class: 'cred-shown' });
  return el('span', { class: 'cred-actions' },
    el('button', { class: 'btn btn-sm', type: 'button', onclick: () => take('copy') }, 'Copy'),
    el('button', { class: 'btn btn-sm', type: 'button', onclick: () => take('show') }, 'Show'),
    shown);
}

const PICKER_FIELD_TYPES = ['select', 'multiselect', 'workflow'];
const READONLY_FIELD_TYPES = ['lookup', 'rollup', 'formula', 'document', 'view'];
const isNumCell = (f, item) => f.type === 'number' || ((f.type === 'formula' || f.type === 'rollup') && typeof item?.raw?.[f.name] === 'number');

const CREDENTIAL_GLYPHS = { apikey: 'lucide:key-round', token: 'lucide:key', password: 'lucide:lock', id: 'lucide:id-card', pair: 'lucide:key-square' };
const CREDENTIAL_KIND_LABELS = {
  apikey: 'API key', token: 'token', password: 'password', id: 'protected id', pair: 'id + secret pair',
};
const KEYSTORE_LABELS = {
  local: 'this workspace’s keystore', '1password': '1Password', 'aws-sm': 'AWS',
  'google-sm': 'Google', cloudflare: 'Cloudflare', 'apple-passwords': 'Apple Passwords',
};

function computedMark(type) {
  return { formula: 'ƒ', rollup: 'Σ', lookup: 'lucide:arrow-up-right', document: 'lucide:file-text', field: 'lucide:sliders-horizontal' }[type] ?? '·';
}
const computedMarkNode = (type) => { const m = computedMark(type); return iconEl(m, 'ico wv-icon') ?? m; };

const COMPUTED_NAME_MARKS = { formula: 'formula', rollup: 'rollup', lookup: 'lookup' };
function fieldDescription(f) {
  return f && f.type !== 'view' && typeof f.description === 'string' ? f.description : '';
}

function fieldNameLabel(f, text = f?.name) {
  const kind = COMPUTED_NAME_MARKS[f?.type];
  if (!kind) return [text];
  return [text, el('sup', {
    class: 'field-mark',
    title: `${kind} — computed from other values, not editable`,
  }, computedMarkNode(f.type))];
}

function openCellPicker(cell) {
  const trigger = cell.querySelector('.chip-trigger');
  if (trigger) return trigger.click();
  const sel = cell.querySelector('select');
  if (!sel) return;
  sel.focus();
  try { sel.showPicker?.(); } catch {}
}

function activateCell(cell) {
  switch (globalThis.WeaveEditorLib.cellActivation(cell.dataset.ftype)) {
    case 'none': return;
    case 'rate': return;
    case 'toggle': {
      const box = cell.querySelector('input[type="checkbox"]');
      if (box) { box.checked = !box.checked; box.dispatchEvent(new Event('change')); }
      return;
    }
    case 'open-picker': return (cell.querySelector('.chip-trigger') ?? cell.querySelector('.ms-box'))?.click();
    case 'open-button': return cell.querySelector('button')?.click();
    default: {
      let input = cell.querySelector('input, select');
      if (!input) { cell.querySelector('.num-dressed, .text-dressed, .url-edit')?.click(); input = cell.querySelector('input, select'); }
      if (!input) return;
      input.focus();
      try { input.select(); } catch {}
    }
  }
}

const GRID_BOX_GUTTER = 40;
const GRID_BOX_MIN = 120;
function fitGridScroller(wrap, was = null) {
  if (!wrap.isConnected || !wrap.classList.contains('wv-grid-scroll')) { wrap.style.maxHeight = ''; return; }
  const top = Math.round(wrap.getBoundingClientRect().top + (paneOf(wrap)?.scrollTop ?? window.scrollY));
  wrap.style.maxHeight = window.innerHeight - top - GRID_BOX_GUTTER < GRID_BOX_MIN
    ? '' : `calc(100vh - ${top}px - ${GRID_BOX_GUTTER}px)`;
  if (top !== was) requestAnimationFrame(() => fitGridScroller(wrap, top));
}

const smoothScrollOk = () =>
  !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches;

function paneOf(node) {
  return node?.closest?.('#main, #dock') ?? null;
}

function scrollBoxOf(target) {
  const chain = [];
  for (let p = target.parentElement; p && p !== document.body; p = p.parentElement) {
    chain.push({
      el: p,
      overflowY: getComputedStyle(p).overflowY,
      scrollHeight: p.scrollHeight,
      clientHeight: p.clientHeight,
    });
  }
  const i = globalThis.WeaveEditorLib.scrollBoxIndex(chain);
  return i < 0 ? null : chain[i].el;
}

function scrollTargetIntoView(target, { block = 'start', padding = 0, bottom = 0, instant = false } = {}) {
  if (!target?.isConnected) return;
  const box = scrollBoxOf(target);
  const t = target.getBoundingClientRect();
  const view = box ? box.getBoundingClientRect() : null;
  const top = globalThis.WeaveEditorLib.scrollTopFor({
    scrollTop: box ? box.scrollTop : window.scrollY,
    scrollHeight: box ? box.scrollHeight : document.documentElement.scrollHeight,
    viewTop: view ? view.top : 0,
    viewHeight: box ? box.clientHeight : window.innerHeight,
    targetTop: t.top, targetHeight: t.height, block, padding, bottom,
  });
  const behavior = !instant && smoothScrollOk() ? 'smooth' : 'instant';
  (box ?? window).scrollTo({ top, behavior });
}

let newRowTurn = 0;
function stuckHeaderHeight(node) {
  if (!node?.closest || node.closest('.wv-grid-scroll')) return 0;
  const header = node.closest('#main')?.querySelector(':scope > .view-header');
  return header && getComputedStyle(header).position === 'sticky' ? header.getBoundingClientRect().height : 0;
}
function stickyFootHeight(row) {
  const foot = row.closest('table')?.querySelector('tr.add-entity-row td');
  if (!foot || getComputedStyle(foot).position !== 'sticky') return 0;
  const pane = row.closest('.wv-grid-scroll') ? null : paneOf(row);
  return foot.offsetHeight + (pane ? parseFloat(getComputedStyle(pane).paddingBottom) || 0 : 0);
}
function focusNewRow(eid, { field = null, scope = '#main', select = false, frames = 120, grace = 30 } = {}) {
  const turn = ++newRowTurn;
  let placed = false;
  const done = () => { if (turn === newRowTurn) newRowTurn++; };
  const step = () => {
    if (turn !== newRowTurn || frames-- <= 0 || (placed && grace-- <= 0)) return;
    const row = document.querySelector(`${scope} tr[data-eid="${eid}"]`);
    const input = (field && row?.querySelector(`td[data-field="${CSS.escape(field)}"] input`))
      || row?.querySelector('td input:not([type="checkbox"])');
    if (input && (!placed || document.activeElement === document.body)) {
      scrollTargetIntoView(row, { block: 'nearest', instant: true, padding: stuckHeaderHeight(row), bottom: stickyFootHeight(row) });
      activateCell(input.closest('td'));
      if (select) input.select();
      if (!placed) {
        for (const ev of ['keydown', 'pointerdown']) document.addEventListener(ev, done, { once: true, capture: true });
      }
      placed = true;
    }
    requestAnimationFrame(step);
  };
  step();
}

function cellPopLayer(wrap) {
  let layer = wrap.querySelector(':scope > .cell-pop-layer');
  if (!layer) { layer = el('div', { class: 'cell-pop-layer' }); wrap.append(layer); }
  return layer;
}

const CELL_TYPE_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
  'letterSpacing', 'lineHeight', 'color', 'textAlign'];
const CLIPPABLE_CONTROLS = 'input:not([type="checkbox"]), textarea';
function copyCellType(src, dst) {
  const cs = getComputedStyle(src);
  for (const p of CELL_TYPE_PROPS) dst.style[p] = cs[p];
}
function contentRect(node) {
  if (node.firstElementChild) return node.firstElementChild.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(node);
  const r = range.getBoundingClientRect();
  return r.width || r.height ? r : node.getBoundingClientRect();
}
const CELL_POP_DELAY = 180;
function showCellPop(td, wrap) {
  const layer = cellPopLayer(wrap);
  const base = wrap.getBoundingClientRect();
  const r = td.getBoundingClientRect();
  const left = r.left - base.left + wrap.scrollLeft;
  const top = r.top - base.top + wrap.scrollTop;
  const pop = el('div', {
    class: 'cell-pop',
    style: `left:${left}px; top:${top}px; min-width:${r.width}px;`,
  });
  const cs = getComputedStyle(td);
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'color', 'textAlign']) {
    pop.style[prop] = cs[prop];
  }
  for (const node of td.childNodes) pop.append(node.cloneNode(true));
  copyCellType(td, pop);
  const src = td.querySelectorAll('*');
  const clones = pop.querySelectorAll('*');
  for (let i = 0; i < clones.length && i < src.length; i++) copyCellType(src[i], clones[i]);
  for (const n of pop.querySelectorAll('.wv-cb > .ms-box > [hidden]')) n.hidden = false;
  for (const n of pop.querySelectorAll('.wv-cb > .ms-box > .k-more')) n.remove();
  const controls = td.querySelectorAll(CLIPPABLE_CONTROLS);
  pop.querySelectorAll(CLIPPABLE_CONTROLS).forEach((copy, i) => {
    const from = controls[i];
    if (!from) return;
    const text = el('span', { class: copy.className }, from.value || from.placeholder || '');
    copyCellType(from, text);
    for (const prop of ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']) {
      text.style[prop] = getComputedStyle(from)[prop];
    }
    text.style.borderStyle = 'solid';
    copy.replaceWith(text);
  });
  layer.replaceChildren(pop);
  const want = contentRect(td);
  const got = contentRect(pop);
  pop.style.left = `${left + (want.left - got.left)}px`;
  const at = pop.getBoundingClientRect();
  const visibleTop = Math.max(base.top + wrap.clientTop, 0);
  const above = r.top - visibleTop >= at.height + CELL_POP_GAP;
  const rowBottom = (td.closest('tr') ?? td).getBoundingClientRect().bottom;
  const goal = above ? r.top - CELL_POP_GAP - at.height : rowBottom + CELL_POP_GAP;
  pop.style.top = `${top + (goal - at.top)}px`;
  pop.classList.toggle('cell-pop-below', !above);
}
const CELL_POP_GAP = 4;
function cellIsEditing(td) {
  const a = document.activeElement;
  return !!a && a !== td && td.contains(a);
}

function hideCellPop(wrap) {
  wrap.querySelector(':scope > .cell-pop-layer')?.replaceChildren();
}

const overflowsX = (n) => n.scrollWidth > n.clientWidth + 1;
const WEAVE_CELLS = /<!--weave-cells:([^->]*)-->/;
let lastCopiedBlock = null;
const htmlText = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
function weaveCellsHTML(block) {
  const label = (d) => (d == null ? '' : Array.isArray(d) ? d.join(', ') : String(d));
  const rows = block.cells.map((row) => `<tr>${row.map((c) => `<td>${htmlText(label(c.d))}</td>`).join('')}</tr>`).join('');
  return `<!--weave-cells:${encodeURIComponent(JSON.stringify(block))}--><table>${rows}</table>`;
}
function readWeaveCells(html) {
  const m = WEAVE_CELLS.exec(html ?? '');
  if (!m) return null;
  try {
    const block = JSON.parse(decodeURIComponent(m[1]));
    return Array.isArray(block?.cells) && block.h > 0 && block.w > 0 ? block : null;
  } catch { return null; }
}

function fitChips(grid) {
  for (const box of grid.querySelectorAll('tbody td > .wv-cb > .ms-box')) {
    const cb = box.parentElement;
    const chips = [...box.children].filter((n) => n.matches('.k:not(.k-more):not(.k-add), .mention-wrap'));
    let more = box.querySelector(':scope > .k-more');
    box.classList.remove('wv-fit-one');
    for (const c of chips) c.hidden = false;
    if (more) more.hidden = true;
    if (chips.length < 2) continue;
    const c = cb.getBoundingClientRect();
    const out = (n) => { const r = n.getBoundingClientRect(); return r.right > c.right + 0.5 || r.bottom > c.bottom + 0.5 || r.top < c.top - 0.5; };
    let shown = chips.length;
    while (shown > 1 && (out(chips[shown - 1]) || (more && !more.hidden && out(more)))) {
      chips[--shown].hidden = true;
      if (!more) { more = el('span', { class: 'k k-more' }); chips.at(-1).after(more); }
      more.hidden = false;
      more.textContent = `+${chips.length - shown}`;
      more.title = `${chips.length - shown} more — open the cell to see them`;
    }
    if (out(chips[0]) || (more && !more.hidden && out(more))) box.classList.add('wv-fit-one');
  }
}
const overflowsY = (n) => n.scrollHeight > n.clientHeight + 1;
const WEAVE_DEV = ['localhost', '127.0.0.1'].includes(location.hostname);
function checkRowPitch(grid) {
  const tr = grid.querySelector('tbody tr.entity-row');
  const want = parseFloat(getComputedStyle(grid).getPropertyValue('--wv-row-h'));
  if (!tr || !want) return;
  const got = tr.getBoundingClientRect().height;
  if (Math.abs(got - want) < 0.5) return;
  const tallest = [...tr.children].map((td) => ({ type: td.dataset.ftype ?? td.className, h: td.firstElementChild?.getBoundingClientRect().height ?? 0, boxed: !!td.querySelector(':scope > .wv-cb') }))
    .sort((a, b) => (a.boxed - b.boxed) || (b.h - a.h))[0];
  console.warn(`weave: a ${grid.dataset.density} row painted ${got}px, not its ${want}px token; tallest cell: ${tallest?.type} (${tallest?.h}px${tallest?.boxed ? '' : ', no clip box'})`);
}

const PHONE_MORE_W = 44;
function fitPhoneChipLines(grid) {
  const phone = dockCoversScreen.matches && grid.closest('#main > .table-wrap');
  for (const tr of grid.querySelectorAll('tbody tr.entity-row')) {
    const cells = [...tr.querySelectorAll(':scope > td[data-field]')];
    for (const td of cells) { td.classList.remove('list-hide'); delete td.dataset.more; }
    if (!phone) continue;
    const shown = cells.filter((td) => td.getClientRects().length);
    if (!shown.length) continue;
    const top = shown[0].getBoundingClientRect().top;
    const edge = tr.getBoundingClientRect().right - (parseFloat(getComputedStyle(tr).paddingRight) || 0);
    let n = shown.length;
    const fits = () => {
      const r = shown[n - 1].getBoundingClientRect();
      return r.top - top < 1 && (n === shown.length || r.right + PHONE_MORE_W <= edge);
    };
    while (n > 1 && !fits()) shown[--n].classList.add('list-hide');
    if (n < shown.length) shown[n - 1].dataset.more = `+${shown.length - n}`;
  }
}
function markClippedCells(grid) {
  fitPhoneChipLines(grid);
  fitChips(grid);
  const cutOff = new Set();
  for (const c of grid.querySelectorAll(`tbody td :is(${CLIPPABLE_CONTROLS})`)) {
    if (overflowsX(c)) cutOff.add(c.closest('td'));
  }
  for (const label of grid.querySelectorAll('tbody td .k > .k-label')) {
    const chip = label.parentElement;
    chip.dataset.fieldTitle ??= chip.getAttribute('title') ?? '';
    if (overflowsX(label)) { cutOff.add(label.closest('td')); chip.title = label.textContent; }
    else if (chip.dataset.fieldTitle) chip.title = chip.dataset.fieldTitle;
    else chip.removeAttribute('title');
  }
  for (const td of grid.querySelectorAll('tbody td')) {
    const hasHiddenLines = td.querySelectorAll('.doc-preview-line').length > (grid.dataset.density === 'spacious' ? 2 : 1);
    if (td.querySelector('.cg-wrap')) { td.classList.remove('clipped'); continue; }
    const cb = td.matches('[data-field], .sys-cell') ? td.querySelector(':scope > .wv-cb') : null;
    const boxCut = !!cb && (overflowsX(cb) || overflowsY(cb)
      || [...cb.children].some((n) => overflowsX(n) || overflowsY(n))
      || !!cb.querySelector('.ms-box > .k-more:not([hidden])'));
    td.classList.toggle('clipped', overflowsX(td) || boxCut || cutOff.has(td) || hasHiddenLines);
  }
  if (WEAVE_DEV && grid.dataset.density) checkRowPitch(grid);
}

const DENSITY_LABELS = { compact: 'Compact', comfortable: 'Comfortable', spacious: 'Spacious' };
const densityKey = (dbId) => `weave-grid-density:${dbId}`;
const hasView = (db) => !!db.view && !db.view.blank;
function gridDensity(db) {
  if (hasView(db)) return db.view.density ?? 'comfortable';
  try { const d = localStorage.getItem(densityKey(db.id)); return DENSITY_LABELS[d] ? d : 'comfortable'; }
  catch { return 'comfortable'; }
}
function saveGridDensity(db, mode) {
  if (!hasView(db)) {
    try { localStorage.setItem(densityKey(db.id), mode); } catch {}
    return;
  }
  if (mode === 'comfortable') delete db.view.density; else db.view.density = mode;
  gridConfigWrite(db, null, { density: mode }).catch((err) => toast(err.message, true));
}
function adoptLegacyDensity(db) {
  if (!hasView(db) || db.view.density) return;
  let old = null;
  try { old = localStorage.getItem(densityKey(db.id)); localStorage.removeItem(densityKey(db.id)); }
  catch { return; }
  if (DENSITY_LABELS[old] && old !== 'comfortable') saveGridDensity(db, old);
}

function registryTable(kind) {
  for (const sp of [...state.schema, ...(state.registry ?? [])]) {
    if (sp.system !== 'workspace') continue;
    const db = sp.tables.find((t) => t.system === kind);
    if (db) return db;
  }
  return null;
}

function registryHref(db, item) {
  if (db.system === 'workspaces' && item.sysId) return item.sysId === state.wsId ? '#/' : `/w/${item.sysId}/`;
  const here = !item.sysWorkspaceId || !state.wsId || item.sysWorkspaceId === state.wsId;
  const at = (hash) => (here ? hash : `/w/${item.sysWorkspaceId}/${hash}`);
  if (db.system === 'tables' && item.sysId) return at(`#/table/${item.sysId}`);
  if (db.system === 'spaces' && item.sysId) return at(`#/space/${item.sysId}`);
  return null;
}
const mineOnly = (items) => (WS_PREFIX ? items.filter((i) => !i.sysWorkspaceId || !state.wsId || i.sysWorkspaceId === state.wsId) : items);

function rowClickTarget(e) {
  if (e.target.closest('input,select,textarea,button,a,label,.ms-box,.chip')) return 'ignore';
  return e.target.closest('.cell-pick');
}

function menuSide({ anchorLeft, anchorRight, width, boundsLeft, boundsRight, prefer = 'left', pad = 4 }) {
  const fits = (left) => left >= boundsLeft + pad && left + width <= boundsRight - pad;
  const other = prefer === 'right' ? 'left' : 'right';
  const start = (side) => (side === 'right' ? anchorRight - width : anchorLeft);
  if (fits(start(prefer))) return prefer;
  return fits(start(other)) ? other : prefer;
}

function menuBounds(node) {
  const viewport = { left: 0, right: document.documentElement.clientWidth };
  for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
    if (getComputedStyle(p).overflowX === 'visible') continue;
    const r = p.getBoundingClientRect();
    return { left: Math.max(viewport.left, r.left), right: Math.min(viewport.right, r.right) };
  }
  return viewport;
}

function dotsMenu(items, { title = 'Actions', align = 'left', extraClass = '' } = {}) {
  const menu = el('div', { class: `dl-menu hidden${align === 'right' ? ' dl-menu-right' : ''}` });
  const close = () => menu.classList.add('hidden');
  for (const it of items.filter(Boolean)) {
    if (it === 'divider') { menu.append(el('div', { class: 'dropdown-divider' })); continue; }
    if (it.href) {
      menu.append(el('a', { class: 'dropdown-item', href: it.href, download: it.download, onclick: close }, it.label));
      continue;
    }
    if (it.hold) {
      menu.append(holdToConfirm(it.hold, async () => { close(); await it.run(); },
        { holdingLabel: it.holdingLabel ?? 'Hold to confirm…' }));
      continue;
    }
    menu.append(el('button', {
      class: 'dropdown-item' + (it.danger ? ' text-danger' : '') + (it.phone ? ' phone-only' : ''), type: 'button',
      onclick: async () => { close(); await it.run(); },
    }, it.label));
  }
  const place = () => {
    const a = wrap.getBoundingClientRect();
    const bounds = menuBounds(wrap);
    const side = menuSide({
      anchorLeft: a.left, anchorRight: a.right, width: menu.offsetWidth,
      boundsLeft: bounds.left, boundsRight: bounds.right, prefer: align,
    });
    menu.classList.toggle('dl-menu-right', side === 'right');
  };
  const wrap = el('span', { class: `dl-wrap ${extraClass}`.trim() },
    el('button', {
      class: 'btn btn-sm btn-ghost-secondary dots-btn', title, type: 'button',
      onclick: (e) => {
        e.stopPropagation();
        const opening = menu.classList.contains('hidden');
        for (const m of document.querySelectorAll('.dl-menu')) m.classList.add('hidden');
        if (!opening) return;
        menu.classList.remove('hidden');
        place();
        menu.off?.();
        menu.off = dismissOutside({ open: () => !menu.classList.contains('hidden'), inside: (t) => wrap.contains(t), close });
      },
    }, iconEl('lucide:ellipsis-vertical', 'wv-icon')),
    menu);
  return wrap;
}

function hasInlineMarkup(text) {
  return globalThis.WeaveEditorLib.inlineTokens(text, inlineIconAccept).some((t) => t.mark);
}

const INLINE_TAG = { strong: 'strong', em: 'em', code: 'code', strike: 's', link: 'span', ref: 'span' };
function inlineIconAccept(token) {
  const hit = window.weaveIconRegistry?.inline(token);
  return hit ? (hit.name ? `lucide:${hit.name}` : hit.mark) : null;
}

function dressTokens(into, tokens) {
  for (const t of tokens) {
    if (t.mark === 'icon') { into.append(iconEl(t.icon, 'wv-icon md-icon')); continue; }
    const cls = t.mark === 'link' ? 'md-link' : t.mark === 'ref' ? 'md-ref' : null;
    into.append(t.mark ? el(INLINE_TAG[t.mark], cls ? { class: cls } : {}, t.text) : t.text);
  }
  return into;
}

function dressedText(md, input) {
  const tokens = globalThis.WeaveEditorLib.inlineTokens(md, inlineIconAccept);
  const dressed = el('span', { class: 'text-dressed', tabindex: 0, title: tokens.map((t) => t.text).join('') });
  dressTokens(dressed, tokens);
  dressed.addEventListener('click', (e) => {
    e.stopPropagation();
    dressed.replaceWith(input);
    input.focus();
    input.select();
  });
  input.addEventListener('blur', () => { if (input.isConnected) input.replaceWith(dressed); });
  return dressed;
}

function dressedUrl(value, input) {
  const parts = globalThis.WeaveEditorLib.urlParts(value);
  const dressed = el('span', { class: 'url-dressed', tabindex: 0, title: parts.href });
  const edit = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dressed.replaceWith(input);
    input.focus();
    input.select();
  };
  const link = el('a', {
    class: 'url-link', href: parts.href,
    target: parts.external ? '_blank' : null, rel: parts.external ? 'noopener' : null,
    onclick: (e) => e.stopPropagation(),
  }, el('span', { class: 'url-host' }, parts.host), el('span', { class: 'url-rest' }, parts.rest));
  const pen = el('button', { class: 'url-edit', type: 'button', title: 'Edit the link', onclick: edit },
    iconEl('lucide:pencil', 'wv-icon'));
  dressed.append(link, pen);
  dressed.addEventListener('dblclick', edit);
  input.addEventListener('blur', () => { if (input.isConnected) input.replaceWith(dressed); });
  return dressed;
}

const viewCore = globalThis.weaveViewCore;
function viewFieldOf(db, shape) {
  return db?.fields?.find((f) => f.type === 'view' && f.role === shape) ?? null;
}
const cellGraphics = globalThis.weaveCellGraphics;
const numberCore = globalThis.weaveNumberCore;
function scaleText(f, scale) {
  if (scale == null) return null;
  return f?.format === 'percent' ? `${Math.round(scale * 1e4) / 100}%` : Number(scale).toLocaleString();
}
let figureCanvas = null;
function figureWidth(text) {
  try {
    figureCanvas ??= document.createElement('canvas').getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    figureCanvas.font = `${cs.getPropertyValue('--wv-grid-font').trim() || '13px'} ${getComputedStyle(document.body).fontFamily}`;
    return Math.ceil(figureCanvas.measureText(String(text).replace(/\d/g, '0')).width) + 2;
  } catch { return null; }
}
function numberGraphic(display, value, scale, text, f = null, color = f?.color) {
  const shown = String(text ?? value ?? '');
  const box = el('span', {
    class: `cg-wrap cg-${display} ${cellGraphics.colorClass(color)}`, role: 'img', 'aria-label': shown,
    title: cellGraphics.meterTitle(shown, value, scale, scaleText(f, scale)),
  });
  box.innerHTML = cellGraphics.meterSvg(display, cellGraphics.share(value, scale) ?? 0);
  box.append(el('span', { class: 'cg-text', 'aria-hidden': 'true' }, shown));
  return box;
}
function numberGraphicFor(f, item, text) {
  if (!cellGraphics.isGraphic(f.display)) return null;
  const value = item?.raw?.[f.name];
  if (typeof value !== 'number') return null;
  return numberGraphic(f.display, value, item?.scales?.[f.name] ?? f.scale ?? null, text ?? value, f);
}
function ratingEl(max, icon, value, { onSet = null, title = null, color = 'ink' } = {}) {
  const box = el('span', {
    class: `wv-rating ${cellGraphics.colorClass(color)}` + (onSet ? ' editable' : ''), role: onSet ? 'group' : 'img',
    dataset: { max: String(max ?? 5), hue: cellGraphics.ratingHue(icon) },
  });
  const paint = (v) => {
    const { filled, max: m, label } = cellGraphics.ratingParts(v, max);
    box.setAttribute('aria-label', label);
    box.title = title ?? label;
    box.dataset.value = v == null ? '' : String(v);
    const compact = el('span', { class: 'wv-rating-compact', 'aria-hidden': 'true' },
      el('span', { class: 'wv-rate-mini' + (filled > 0 ? ' on' : '') }, iconEl(icon || 'lucide:star', 'wv-icon') ?? '★'),
      el('span', { class: 'wv-rating-n' }, `${filled}/${m}`));
    box.replaceChildren(compact, ...Array.from({ length: m }, (_, i) => {
      const n = i + 1;
      const glyph = iconEl(icon || 'lucide:star', 'wv-icon') ?? '★';
      return onSet
        ? el('button', { type: 'button', tabindex: '-1', class: 'wv-rate-ico' + (n <= filled ? ' on' : ''), 'aria-hidden': 'true', dataset: { n: String(n) },
          onclick: (e) => { e.stopPropagation(); onSet(cellGraphics.ratingClick(box.dataset.value === '' ? null : Number(box.dataset.value), n)); } }, glyph)
        : el('span', { class: 'wv-rate-ico' + (n <= filled ? ' on' : ''), 'aria-hidden': 'true' }, glyph);
    }));
  };
  paint(value);
  box.paint = paint;
  if (onSet) box.addEventListener('rate', (e) => onSet(e.detail));
  return box;
}
function ratingListEl(rating, values, { label = null } = {}) {
  const box = el('span', { class: 'ms-box wv-rating-list', role: 'group', ...(label ? { 'aria-label': label } : {}) });
  for (const v of values) box.append(ratingEl(rating.max, rating.icon, typeof v === 'number' ? v : null, { color: rating.color }));
  return box;
}
function sparkEl(style, values, color = 'ink') {
  const svg = cellGraphics.sparkSvg(style || 'line', values);
  if (!svg) return null;
  const box = el('span', { class: `cg-wrap cg-sparkwrap cg-${style || 'line'} ${cellGraphics.colorClass(color)}`, role: 'img', 'aria-label': cellGraphics.sparkLabel(values), title: cellGraphics.sparkTitle(values) });
  box.innerHTML = svg;
  return box;
}
function segmentValueEl(seg) {
  if (seg.spark) return sparkEl(seg.spark.style, seg.spark.values, seg.spark.color) ?? seg.value;
  if (seg.rating) {
    return seg.rating.values
      ? ratingListEl(seg.rating, seg.rating.values, { label: seg.label })
      : ratingEl(seg.rating.max, seg.rating.icon, seg.rating.value, { title: `${seg.label}: ${seg.value}`, color: seg.rating.color });
  }
  return seg.meter && cellGraphics.isGraphic(seg.meter.display)
    ? numberGraphic(seg.meter.display, seg.meter.value, seg.meter.scale, seg.value, null, seg.meter.color)
    : seg.value;
}
function viewSegmentEl(seg) {
  if (seg.kind === 'state') {
    const cat = chipCore.categoryOrDefault(seg.category);
    return el('span', { class: `k k-state cat-${cat} hue-${chipCore.stateHue(seg, cat)} wv-seg-state` }, seg.value);
  }
  return el('span', { class: 'mention-f' }, el('span', { class: 'mention-f-label' }, seg.label), segmentValueEl(seg));
}
function viewChipEl(v, { lead = null, tail = null, extra = null, href = null } = {}) {
  const segs = viewCore.viewSegments(v);
  const a = el('a', { href: href ?? `#/entity/${v.id}`, title: String(v?.name ?? ''), onclick: (e) => e.stopPropagation() },
    lead, el('span', { class: 'k-label' }, viewCore.viewTitle(v)), tail,
    segs.length ? el('span', { class: 'mention-fields' }, ...segs.map(viewSegmentEl)) : '');
  const chip = el('span', { class: 'k k-rel' + (segs.length ? ' has-segs' : '') }, a,
    segs.length ? el('button', {
      type: 'button', class: 'mention-caret', 'aria-expanded': 'false', title: 'Show fields',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); toggleMentionCaret(e.currentTarget); },
    }, '›') : '');
  if (extra) chip.append(extra);
  return el('span', { class: 'mention-wrap' }, chip);
}
function viewCardEl(v, { compact = false } = {}) {
  const segs = viewCore.viewSegments(v);
  const state = segs.find((x) => x.kind === 'state');
  const head = el('div', { class: 'wv-card-head' },
    el('a', { class: 'wv-card-title', href: `#/entity/${v.id}`, onclick: (e) => e.stopPropagation() },
      v.link ? el('span', { class: 'wv-card-id' }, `#${v.publicId}`) : '',
      v.name || (v.link ? '' : `#${v.publicId}`)),
    state ? viewSegmentEl(state) : '');
  const card = el('div', { class: 'wv-card' + (compact ? ' compact' : ''), dataset: { eid: v.id } }, head);
  if (v.description) card.append(el('div', { class: 'wv-card-desc' }, v.description));
  const fields = segs.filter((x) => x.kind === 'field');
  if (fields.length) {
    card.append(el('dl', { class: 'wv-card-fields' },
      ...fields.flatMap((f) => [el('dt', {}, f.label), el('dd', { dataset: { field: f.label } }, segmentValueEl(f))])));
  }
  return card;
}
function viewCell(v, f, { compact = false } = {}) {
  if (!v || typeof v !== 'object') return el('span', { class: 'k k-empty' }, '—');
  return f.shape === 'card' || v.shape === 'card' ? viewCardEl(v, { compact }) : viewChipEl(v);
}
function relationChipEl(f, s, { extra = null } = {}) {
  const v = s.chip ?? { id: s.id, publicId: s.publicId, name: s.name, link: false, state: null, fields: [] };
  return viewChipEl(v, {
    lead: personAvatar(f, s),
    tail: f.targetDbIds && s.db ? el('span', { class: 'k-home' }, s.db.split('/').pop()) : null,
    extra,
  });
}
function toggleMentionCaret(caret) {
  const open = caret.closest('.mention-wrap').classList.toggle('open');
  caret.setAttribute('aria-expanded', String(open));
}
document.addEventListener('click', (ev) => {
  const caret = ev.target.closest('.mention-caret');
  if (!caret || !caret.closest('#app, .modal, .cell-pop')) return;
  ev.preventDefault();
  toggleMentionCaret(caret);
});

function toggleSwitch(f, val, patch) {
  const input = el('input', { type: 'checkbox', role: 'switch', class: 'wv-toggle-input', 'aria-label': f.name });
  const word = el('span', { class: 'wv-toggle-word' });
  const wrap = el('label', { class: 'wv-toggle', title: f.name }, input,
    el('span', { class: 'wv-toggle-track', 'aria-hidden': 'true' }, el('span', { class: 'wv-toggle-knob' })), word);
  const paint = (on) => {
    input.checked = !!on;
    wrap.classList.toggle('on', !!on);
    word.textContent = on ? (f.on ?? 'On') : (f.off ?? 'Off');
  };
  input.addEventListener('change', () => patch(input.checked, paint));
  input.addEventListener('focus', () => { const td = input.closest('td.wv-cell, td'); if (td) td.focus(); });
  paint(val);
  return wrap;
}

const HTML_FRAME_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
const fileUrl = (file) => `${WS_PREFIX}/api/files/${file.id}`;
function fileKind(file) {
  const mime = String(file.mime ?? '').split(';')[0].trim().toLowerCase();
  if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/plain') return 'text';
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html';
  return 'other';
}
const isPictureFile = (file) => fileKind(file) === 'image';
const fileIconName = (file) => ({ image: 'lucide:image', pdf: 'lucide:file-text', text: 'lucide:file-text', html: 'lucide:code' })[fileKind(file)] ?? 'lucide:file';
const fileSizeText = (n) => n == null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
function attachItemEl(file, { remove = null } = {}) {
  return el('span', { class: 'attach-item' + (file.missing ? ' is-missing' : '') },
    file.missing
      ? el('span', { title: 'The stored file is gone — only its name is left' },
        file.name, el('span', { class: 'attach-gone' }, '(missing)'))
      : el('a', { href: fileUrl(file), target: '_blank' }, file.name),
    ...(remove ? [remove(file)] : []));
}
function attachSheetEl(files, { size = 'medium', fit = 'trim' } = {}, { remove = null } = {}) {
  const sheet = el('div', { class: `attach-sheet size-${size} fit-${fit}` });
  files.forEach((file, i) => {
    const kind = fileKind(file);
    const cell = el('a', {
      class: 'attach-cell' + (kind === 'image' ? '' : ' is-glyph'), href: fileUrl(file), title: file.name,
      onclick: (e) => { e.preventDefault(); fileLightbox(files, i); },
    });
    if (kind === 'image') {
      const img = el('img', { src: fileUrl(file), alt: file.name, loading: 'lazy' });
      img.addEventListener('load', () => { if (img.naturalHeight) cell.style.setProperty('--ar', (img.naturalWidth / img.naturalHeight).toFixed(3)); });
      cell.append(img);
    } else {
      cell.append(iconEl(fileIconName(file), 'wv-icon'), el('span', { class: 'attach-cell-kind' }, kind === 'other' ? 'file' : kind));
    }
    cell.append(el('span', { class: 'attach-cell-label' }, file.name), remove ? remove(file) : null);
    sheet.append(cell);
  });
  if (fit === 'trim') sheet.append(el('span', { class: 'attach-sheet-filler' }));
  return sheet;
}
function fileViewerEl(file, { size = 'medium' } = {}) {
  const kind = fileKind(file);
  const url = fileUrl(file);
  const body = kind === 'image' ? el('img', { src: url, alt: file.name })
    : kind === 'pdf' || kind === 'text' ? el('iframe', { class: 'file-viewer-frame', src: url, title: file.name })
      : kind === 'html' ? el('iframe', { class: 'file-viewer-frame', src: `${url}?view`, title: file.name, sandbox: HTML_FRAME_SANDBOX })
        : null;
  if (!body) return null;
  return el('div', { class: `file-viewer size-${size} kind-${kind}` },
    el('div', { class: 'file-viewer-bar' },
      iconEl(fileIconName(file), 'wv-icon'),
      el('span', { class: 'file-viewer-name' }, file.name),
      el('span', { class: 'file-viewer-size' }, fileSizeText(file.size)),
      el('a', { class: 'btn btn-sm btn-ghost-secondary tiny', href: url, target: '_blank', title: 'Open in a browser tab' }, iconEl('lucide:arrow-up-right', 'wv-icon wv-icon-xs'))),
    body);
}
function entityCoverEl(file, { size = 'medium', fit = 'trim' } = {}) {
  return el('div', { class: `entity-cover size-${size} fit-${fit}`, title: file.name },
    el('img', { src: fileUrl(file), alt: file.name }));
}
function fileLightbox(files, index) {
  const file = files[index];
  const kind = fileKind(file);
  if (kind === 'other') { window.open(fileUrl(file), '_blank'); return; }
  fullscreenViewer(`${file.name} · ${index + 1} / ${files.length}`, {
    url: fileUrl(file) + (kind === 'html' ? '?view' : ''),
    sandbox: kind === 'html' ? HTML_FRAME_SANDBOX : null,
    prev: index > 0 ? () => fileLightbox(files, index - 1) : null,
    next: index < files.length - 1 ? () => fileLightbox(files, index + 1) : null,
  });
}

function labeledEditorFor(f, item, db, onSaved, { compact = false, fit = false, label } = {}) {
  const node = editorFor(f, item, db, onSaved, { compact, fit });
  if (node instanceof Element) {
    const name = label ?? `${f.name}, ${item.name || `#${item.publicId}`}`;
    for (const n of [node, ...node.querySelectorAll('*')]) {
      if (n.matches('input, select, textarea') && !n.hasAttribute('aria-label') && !n.hasAttribute('aria-labelledby')) n.setAttribute('aria-label', name);
    }
  }
  return node;
}
function fileDropZone(zone, take) {
  let depth = 0;
  const carriesFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const off = () => { depth = 0; zone.classList.remove('is-file-drop'); };
  zone.addEventListener('dragenter', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth += 1;
    zone.classList.add('is-file-drop');
  });
  zone.addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    zone.classList.add('is-file-drop');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) off();
  });
  zone.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    off();
    const files = [...(e.dataTransfer.files ?? [])];
    if (files.length) take(files);
  });
  return zone;
}

function optionHue(field, name) {
  const o = (field.optionsFull ?? []).find((x) => x.name === name);
  return `hue-${chipCore.hueFromHex(o?.color)}`;
}
function optionIcon(field, name) {
  const ico = (field.optionsFull ?? []).find((x) => x.name === name)?.icon;
  return ico ? iconEl(ico, 'ico wv-icon') : null;
}
function optionChipEl(f, name) {
  const unset = name == null ? ' is-empty' : '';
  switch (f.type) {
    case 'workflow': return el('button', { class: `${stateChipClass(f, name)}${unset} chip-trigger`, type: 'button', title: f.name }, ...stateNodes(f, name));
    case 'multiselect': return el('span', { class: `k k-multi ${optionHue(f, name)}` }, optionIcon(f, name), chipLabel(name));
    default: return el('button', { class: `k k-select ${optionHue(f, name)}${unset} chip-trigger`, type: 'button', title: f.name }, optionIcon(f, name), chipLabel(name ?? '—'));
  }
}

function editorFor(f, item, db, onSaved, { compact = false, fit = false } = {}) {
  const id = item.id;
  const val = item.fields[f.name];
  const saved = async () => {
    const fresh = await api('GET', `/entities/${id}`);
    onSaved(fresh);
  };
  const patch = async (value, paint = null) => {
    paint?.(value);
    try {
      const fresh = await api('PATCH', `/entities/${id}`, { values: { [f.name]: value } });
      await onSaved(fresh, f.name);
    } catch (err) { paint?.(val); toast(err.message, true); }
  };

  if (f.type === 'view') return viewCell(item.raw?.[f.name], f, { compact });
  const farRel = lookupTargetOf(db, f);
  if (farRel?.type === 'relation' && val != null && (!Array.isArray(val) || val.length)) {
    const all = Array.isArray(val) ? val : [val];
    const CAP = 3;
    const shown = compact && !fit && all.length > CAP ? all.slice(0, CAP) : all;
    const box = el('span', { class: 'ms-box', title: `${f.name} — lookup, read-only` });
    for (const s of shown) box.append(relationChipEl(farRel, s), ' ');
    if (all.length > shown.length) {
      box.append(el('span', { class: 'k k-more', title: `${all.length - shown.length} more — open the cell to see them` }, `+${all.length - shown.length}`), ' ');
    }
    return box;
  }
  if (READONLY_FIELD_TYPES.includes(f.type) && f.type !== 'document') {
    const text = fieldValueCell(val);
    const rawVal = item?.raw?.[f.name];
    const graphic = (f.type === 'formula' && f.display === 'sparkline' && Array.isArray(rawVal) ? sparkEl(f.style, rawVal, f.color) : null)
      ?? (f.rating && typeof rawVal === 'number'
        ? ratingEl(f.rating.max, f.rating.icon, rawVal, { title: `${f.name}: ${text}`, color: f.rating.color }) : null)
      ?? (f.rating && Array.isArray(rawVal) && rawVal.length
        ? ratingListEl(f.rating, rawVal, { label: f.name }) : null)
      ?? numberGraphicFor(f, item, text);
    const rich = f.display === 'sparkline' || !!f.rating || cellGraphics.isGraphic(f.display);
    const box = el('span', { class: 'computed k k-computed' + (graphic || text ? '' : ' is-empty'), title: `${f.type} — read-only` },
      rich ? null : el('span', { class: 'computed-mark' }, computedMarkNode(f.type)),
      graphic ?? (text || '—'));
    if (!compact) box.append(el('span', { class: 'wv-tag' }, f.type));
    return box;
  }
  if (f.type === 'rating') {
    const box = ratingEl(f.max, f.icon, item.raw?.[f.name] ?? null, { onSet: (v) => patch(v, (x) => box.paint(x)), color: f.color });
    return box;
  }
  if (f.type === 'workflow') {
    const trigger = optionChipEl(f, val);
    const paint = (name) => { const next = optionChipEl(f, name); trigger.className = next.className; trigger.replaceChildren(...next.childNodes); };
    return chipPicker({
      trigger,
      options: [{ name: '—' }, ...f.states.map((s) => ({ name: s.name, cls: stateChipClass(f, s.name), label: stateLabel(f, s.name) }))],
      current: val ?? null,
      clearId: '—',
      onPick: async (picked) => {
        const name = picked === '—' ? null : picked;
        paint(name);
        try {
          await api('POST', `/entities/${id}/state`, { field: f.name, state: name });
          await saved();
        } catch (err) { paint(val); toast(err.message, true); }
      },
    });
  }
  if (f.type === 'select') {
    const trigger = optionChipEl(f, val);
    if (db?.system === 'workflows' && f.name === 'Health' && item.fields?.['Health Reason']) trigger.title = item.fields['Health Reason'];
    const paint = (v) => { const next = optionChipEl(f, v); trigger.className = next.className; trigger.replaceChildren(...next.childNodes); };
    return chipPicker({
      trigger,
      options: [{ name: '—' }, ...f.options.map((o) => ({ name: o, cls: `k k-select ${optionHue(f, o)}` }))],
      current: val ?? null,
      clearId: '—',
      onPick: (name) => patch(name === '—' ? null : name, paint),
    });
  }
  if (f.type === 'multiselect') {
    const current = Array.isArray(val) ? val : [];
    const box = el('span', { class: 'ms-box', title: 'Edit selections' });
    const paint = (ids) => {
      box.replaceChildren();
      for (const v of ids ?? []) box.append(optionChipEl(f, v), ' ');
      if (!ids?.length) box.append(el('span', { class: 'k k-add' }, iconEl('+', 'wv-icon wv-icon-xs')));
    };
    paint(current);
    chipPickerMulti({
      trigger: box,
      options: f.options.map((o) => ({ id: o, label: o, chip: true, cls: `k k-multi ${optionHue(f, o)}` })),
      selected: current.map((v) => ({ id: v, label: v, cls: `k k-multi ${optionHue(f, v)}` })),
      onCommit: (ids) => (ids.join('\u0000') === current.join('\u0000') ? null : patch(ids, paint)),
    });
    return box;
  }
  if (f.type === 'key') {
    const kind = f.kind ?? 'apikey';
    const store = f.keystore ?? 'local';
    const shown = String(fieldValueCell(val) ?? '').replace(/^✱+\s*/, '');
    const chip = el('span', {
      class: 'k k-key hue-slate' + (shown ? '' : ' is-empty'),
      title: `${f.name} — ${CREDENTIAL_KIND_LABELS[kind] ?? kind} in ${KEYSTORE_LABELS[store] ?? store}`,
    }, iconEl(CREDENTIAL_GLYPHS[kind] ?? CREDENTIAL_GLYPHS.apikey, 'ico wv-icon'), chipLabel(shown || '—'));
    if (store !== 'local' && val) chip.append(el('span', { class: 'store' }, KEYSTORE_LABELS[store]));
    const ref = item?.raw?.[f.name] ?? null;
    if (compact || !ref) return chip;
    if (store === 'local' && /\(unset\)$/.test(String(val ?? ''))) return chip;
    return el('span', { class: 'cred-cell' }, chip, credentialReveal(ref, store));
  }
  if (f.type === 'checkbox') {
    const cb = el('input', { type: 'checkbox', class: 'form-check-input', onchange: () => patch(cb.checked) });
    cb.checked = !!val;
    return cb;
  }
  if (f.type === 'toggle') return toggleSwitch(f, val, patch);
  if (f.type === 'relation') {
    const box = el('span', { class: 'ms-box' });
    const all = val == null ? [] : Array.isArray(val) ? val : [val];
    const CAP = 3;
    const current = compact && !fit && all.length > CAP ? all.slice(0, CAP) : all;
    const hidden = all.length - current.length;
    for (const s of current) {
      const x = compact ? null : el('span', {
        class: 'x',
        onclick: async () => {
          try {
            await api('POST', `/entities/${id}/unlink`, { field: f.name, targets: [s.id] });
            await saved();
          } catch (err) { toast(err.message, true); }
        },
      }, iconEl('lucide:x', 'wv-icon wv-icon-xs'));
      box.append(relationChipEl(f, s, { extra: x }), ' ');
    }
    if (hidden > 0) {
      box.append(el('span', {
        class: 'k k-more', title: `${hidden} more — open the cell to see them`,
      }, `+${hidden}`), ' ');
    }
    box.append(el('button', {
      class: 'btn btn-sm btn-ghost-secondary tiny',
      onclick: () => linkSearch(f, {
        linked: all,
        commit: async (add, drop) => {
          if (add.length) await api('POST', `/entities/${id}/link`, { field: f.name, targets: add });
          if (drop.length) await api('POST', `/entities/${id}/unlink`, { field: f.name, targets: drop });
          await saved();
        },
      }),
    }, '+ link'));
    return box;
  }
  if (f.type === 'document') {
    if (f.role === 'description') return docPreviewCell(item.docs?.[f.name], f.name, () => dockEntity(db, id, { step: true }));
    return docChipCell(f, item, () => dockEntity(db, id, { step: true }));
  }
  if (f.type === 'field') {
    const def = item.raw?.[f.name] ?? null;
    const chip = el('span', { class: 'computed k k-computed' + (def == null ? ' is-empty' : ''), title: compact ? `field definition — edit on the ${db?.term?.singular ?? WeaveTerm.DEFAULT.singular} page` : 'field definition — click to edit' },
      el('span', { class: 'computed-mark' }, computedMarkNode('field')),
      def == null ? '—' : String(val));
    if (compact) return chip;
    chip.style.cursor = 'pointer';
    chip.onclick = () => {
      const types = f.types ?? [];
      const typeSel = pickerSelect({ name: 'type', title: 'Field type', options: types.map((t) => ({ id: t, label: t })), value: def?.type ?? types[0] });
      const cfgArea = el('textarea', {
        name: 'config', class: 'form-control', rows: 6, spellcheck: 'false',
        placeholder: '{} — config as JSON (options, states, depth…)',
      });
      cfgArea.value = JSON.stringify(def?.config ?? {}, null, 2);
      const clearRow = def == null ? [] : [el('div', { class: 'fielddef-clear' },
        holdToConfirm(`Clear the ${String(val)} definition`, async () => {
          document.querySelector('#modal-back')?.remove();
          await patch(null);
          toast(`Cleared the ${String(val)} definition.`, false,
            { label: 'Undo', run: () => patch(def) });
        }))];
      modal(`${f.name} — field definition`, [
        el('label', { class: 'form-label' }, 'Type'), typeSel,
        el('label', { class: 'form-label', style: 'margin-top:8px' }, 'Config'), cfgArea,
        ...clearRow,
      ], async (fd) => {
        let config;
        try { config = JSON.parse(String(fd.get('config') || '{}')); }
        catch { throw new Error('Config is not valid JSON'); }
        await api('PATCH', `/entities/${id}`, { values: { [f.name]: { type: String(fd.get('type')), config } } });
        await saved();
        toast(`${f.name} saved`, false, { label: 'Undo', run: () => patch(def) });
      }, 'Save');
    };
    return el('span', { class: 'fielddef-edit' }, chip);
  }
  if (f.type === 'attachments') {
    const ids = item.raw?.[f.name] ?? [];
    const upload = async (files) => {
      let landed = 0;
      try {
        for (const file of files) {
          const bytes = await fileBase64(file);
          await api('POST', `/entities/${id}/fields/${encodeURIComponent(f.name)}/files`, {
            name: file.name, mime: file.type || 'application/octet-stream', bytes,
          });
          landed += 1;
        }
      } catch (err) { toast(err.message, true); }
      if (landed) await saved().catch((err) => toast(err.message, true));
    };
    const chip = el('span', { class: 'k k-attach' + (ids.length ? '' : ' is-empty'), title: 'attachments' },
      el('span', { class: 'ico' }, iconEl('lucide:file', 'wv-icon')),
      ids.length ? String(val ?? `${ids.length}`) : '—');
    chip.dropFiles = upload;
    if (compact) return chip;
    const files = (item.files ?? []).filter((x) => ids.includes(x.id));
    const remove = (file) => el('button', {
      class: 'btn btn-sm btn-ghost-secondary tiny', title: 'Remove from this field',
      onclick: (e) => { e.preventDefault(); e.stopPropagation(); patch(ids.filter((x) => x !== file.id)); },
    }, iconEl('lucide:x', 'wv-icon wv-icon-xs'));
    const chipFor = (file) => attachItemEl(file, { remove });
    const mode = f.preview || (f.multiple === false ? 'inline' : 'auto');
    const look = { size: f.size ?? 'medium', fit: f.fit ?? 'trim' };
    const present = files.filter((x) => !x.missing);
    const sheet = mode === 'inline' && f.multiple !== false ? present
      : mode === 'auto' ? present.filter(isPictureFile) : [];
    const box = el('span', { class: 'attach-box' + (mode === 'link' || mode === 'cover' ? '' : ' attach-box-wide') });
    const viewer = mode === 'inline' && f.multiple === false && present[0] ? fileViewerEl(present[0], look) : null;
    if (viewer) box.append(viewer);
    if (sheet.length) box.append(attachSheetEl(sheet, look, { remove }));
    const chips = el('span', { class: 'attach-chips' });
    for (const file of files) if (!sheet.includes(file)) chips.append(chipFor(file));
    box.append(chips);
    const input = el('input', { type: 'file', style: 'display:none' });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) upload([file]);
    });
    chips.append(input, el('button', {
      class: 'btn btn-sm btn-ghost-secondary tiny', title: 'Upload a file into this field, or drop files here',
      onclick: () => input.click(),
    }, '+ file'));
    return fileDropZone(box, upload);
  }
  if (f.type === 'date') {
    return dateControl({
      value: item.raw?.[f.name] ?? '', costume: f,
      placeholder: 'today, 15 sep, 9/15/26…', onChange: (iso) => patch(iso),
    });
  }
  if (f.type === 'daterange') {
    return rangeControl({ value: item.raw?.[f.name] ?? null, costume: f, compact, onChange: (r) => patch(r) });
  }
  const rawVal = item.raw?.[f.name] ?? val;
  if (rawVal != null && typeof rawVal === 'object') {
    return el('span', { class: 'k k-computed wv-unrendered', title: `${f.type} — no cell renderer for this value` },
      `unrendered ${f.type}`);
  }
  const isPercent = f.type === 'number' && f.format === 'percent';
  const boxVal = isPercent && typeof rawVal === 'number' ? Math.round(rawVal * 100 * 1e8) / 1e8 : rawVal;
  const input = el('input', {
    class: 'form-control form-control-sm inline-edit',
    type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text',
    value: boxVal ?? '',
    onclick: (e) => e.stopPropagation(),
  });
  input.addEventListener('change', () => patch(input.value === '' ? null
    : f.type === 'number' ? (isPercent ? Math.round(Number(input.value) * 1e8) / 1e10 : Number(input.value))
    : input.value));
  if (f.type === 'text' && !f.literal && typeof rawVal === 'string' && hasInlineMarkup(rawVal)) {
    return dressedText(rawVal, input);
  }
  if (f.type === 'url' && globalThis.WeaveEditorLib.urlParts(rawVal)) {
    return dressedUrl(rawVal, input);
  }
  const graphic = f.type === 'number' ? numberGraphicFor(f, item, val) : null;
  if (graphic) {
    graphic.tabIndex = 0;
    graphic.classList.add('num-dressed');
    graphic.addEventListener('click', (e) => {
      e.stopPropagation();
      graphic.replaceWith(input);
      input.focus();
    });
    input.addEventListener('blur', () => { if (input.isConnected) input.replaceWith(graphic); });
    return graphic;
  }
  if (f.type === 'number' && val != null && String(val) !== String(rawVal)) {
    const dressed = el('span', { class: 'num-dressed', tabindex: 0, onclick: (e) => {
      e.stopPropagation();
      dressed.replaceWith(input);
      input.focus();
    } }, String(val));
    input.addEventListener('blur', () => { if (input.isConnected) input.replaceWith(dressed); });
    return dressed;
  }
  return input;
}

function docPreviewCell(md, name, onOpen) {
  const { kind, lines, label } = globalThis.WeaveEditorLib.docPreview(md);
  const box = el('span', {
    class: 'doc-preview' + (kind ? '' : ' is-empty'),
    tabindex: 0,
    title: kind ? `Open ${name}` : `${name} is empty — click to write it`,
    onclick: (e) => { e.stopPropagation(); onOpen(); },
  });
  if (!kind) {
    box.append(el('span', { class: 'doc-preview-line' }, `Add ${name.toLowerCase()}…`));
    return box;
  }
  if (!lines.length) {
    box.append(el('span', { class: 'doc-preview-line k k-doc' }, label || kind));
    return box;
  }
  for (const line of lines) {
    box.append(dressTokens(el('span', { class: 'doc-preview-line' }), globalThis.WeaveEditorLib.inlineTokens(line, inlineIconAccept)));
  }
  return box;
}

function docChipCell(f, item, onOpen) {
  const kind = globalThis.WeaveEditorLib.docChipKind(f.kind, item.docs?.[f.name]);
  return el('button', {
    class: 'k k-doc doc-chip' + (kind ? '' : ' is-empty'),
    type: 'button',
    title: kind ? `Open ${f.name} (${kind})` : `${f.name} is empty — click to write it`,
    onclick: (e) => { e.stopPropagation(); onOpen(); },
  }, f.name, el('span', { class: 'doc-kind' }, kind ?? 'empty'));
}


async function showTrash(dbId) {
  const db = dbId ? allTables().find((d) => d.id === dbId) : null;
  if (dbId && !db) return showHome();
  state.route = { page: 'trash', dbId };
  renderNav();
  let { items } = await api('GET', db ? `/tables/${db.id}/trash` : '/trash');
  if (!db) items = items.filter((i) => allTables().find((d) => d.id === i.dbId)?.system !== 'views');
  const main = $('#main');
  main.replaceChildren();
  main.append(viewHeader({
    crumbs: [
      { label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() },
      ...(db ? [{ label: db.space, href: `#/space/${db.spaceId}` }, { label: db.name, href: `#/table/${db.id}` }] : []),
    ],
    permalink: `${location.origin}${WS_PREFIX}/#/trash${db ? `/${db.id}` : ''}`,
    title: db ? `${db.name} — trash` : 'Trash',
  }));

  const wsTrashed = db ? [] : await trashedWorkspaces();
  if (!items.length && !wsTrashed.length) {
    main.append(el('div', { class: 'card panel empty-note' }, 'Nothing in the trash.'));
    return;
  }
  const rows = el('tbody');
  for (const item of items) {
    rows.append(el('tr', {},
      el('td', { class: 'pid-cell' }, `#${item.publicId}`),
      el('td', {}, item.name || el('span', { class: 'view-desc-empty' }, 'Untitled')),
      ...(db ? [] : [el('td', { class: 'trash-table' }, item.db)]),
      el('td', { class: 'trash-when' }, new Date(item.deletedAt).toLocaleString()),
      el('td', { class: 'trash-acts' },
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: async () => {
            try {
              await api('POST', `/entities/${item.id}/restore`);
              toast('Restored');
              await loadSchema();
              showTrash(dbId);
            } catch (err) { toast(err.message, true); }
          },
        }, 'Restore'),
        holdToConfirm('Delete forever', async () => {
          try {
            await api('DELETE', `/entities/${item.id}?hard=1`);
            toast('Purged');
            await loadSchema();
            showTrash(dbId);
          } catch (err) { toast(err.message, true); }
        }, { holdingLabel: 'Hold to purge…' }))));
  }
  if (items.length) main.append(el('div', { class: 'card table-wrap' },
    el('table', { class: 'table table-sm table-vcenter card-table wv-grid' },
      el('thead', {}, el('tr', {},
        el('th', { class: 'pid-head' }, '#'), el('th', {}, 'Name'),
        ...(db ? [] : [el('th', {}, 'Table')]),
        el('th', {}, 'Deleted'), el('th', {}, ''))),
      rows)));
  if (wsTrashed.length) main.append(trashedWorkspacesCard(wsTrashed, () => showTrash(dbId)));
}

const BLANK_READ_ONLY = 'The raw table is read-only. Open Views and choose + Add view, or Duplicate a view.';
function blankView(db) {
  return { id: 'blank', name: 'Blank', blank: true, fields: db.fields.filter((f) => f.type !== 'view').map((f) => f.name) };
}
function pickTableView(db, ref) {
  const views = db.views ?? [];
  if (ref === 'blank' || !views.length) return blankView(db);
  return views.find((v) => v.id === ref) ?? views[0];
}
function viewed(db, v) {
  if (!v) return db;
  const by = new Map(db.fields.map((f) => [f.name, f]));
  const shown = v.fields.map((n) => by.get(n)).filter(Boolean);
  const on = new Set(shown);
  const hidden = db.fields.filter((f) => !on.has(f));
  const sys = (n) => !by.has(n) && !!SYSTEM_COLS[n];
  const columns = v.blank
    ? [...shown.map((f) => f.name), ...(db.systemFields ?? []).filter((n) => SYSTEM_COLS[n])]
    : v.fields.filter((n) => by.has(n) || sys(n));
  return { ...db, fields: [...shown, ...hidden], hiddenFields: hidden.map((f) => f.name), filters: v.filters, sort: v.sort, view: v, columns };
}
async function gridConfigWrite(db, tablePatch, viewPatch = tablePatch) {
  if (db.view?.blank) { toast(BLANK_READ_ONLY, true); return false; }
  if (db.view) await api('PATCH', `/tables/${db.id}/views/${encodeURIComponent(db.view.id)}`, viewPatch);
  else await api('PATCH', `/tables/${db.id}`, tablePatch);
  await loadSchema();
  return true;
}
const viewHref = (db, v) => `#/table/${db.id}/view/${v.blank ? 'blank' : v.id}`;
const showsDeleted = (db) => (db.view && !db.view.blank ? !!db.view.deleted : state.showDeleted.has(db.id));
const showsRollups = (db) => !db.system && (db.view && !db.view.blank && typeof db.view.rollups === 'boolean' ? db.view.rollups : db.hideRollups === false);
function systemDefault(db, view = null) {
  const table = allTables().find((d) => d.id === db.id) || db;
  return {
    fields: [...blankView(table).fields, ...(table.systemFields || []).filter((n) => SYSTEM_COLS[n] && n !== 'Activity')],
    filters: {}, sort: [],
    ...(view ? { widths: Object.fromEntries(Object.keys(view.widths || {}).map((n) => [n, null])) } : {}),
    frozen: 0, density: 'comfortable', deleted: false, rollups: false,
    layout: 'table', group: null, completedBy: null, nest: null, collapsed: null, order: null,
  };
}
function nextViewName(db, base = 'View') {
  const taken = new Set((db.views ?? []).map((v) => v.name.toLowerCase()));
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}
let viewEdit = null;
function viewStrip(db) {
  const cur = db.view;
  const views = db.views ?? [];
  const strip = el('div', { class: 'view-strip', role: 'list', 'aria-label': 'Views' });
  const at = (id) => `/tables/${db.id}/views/${encodeURIComponent(id)}`;
  const redraw = () => strip.closest('.table-view-popover')?.refresh?.(db, { force: true });
  const write = async (fn, { focus, part = '.view-name' } = {}) => {
    try { await fn(); } catch (err) { toast(err.message, true); }
    await loadSchema();
    await showDatabase(db.id);
    if (focus) document.querySelector(`.view-strip .view-tab[data-view="${CSS.escape(focus)}"] ${part}`)?.focus({ preventScroll: true });
  };
  const move = (v, to, part) => write(() => api('PATCH', at(v.id), { position: to }), { focus: v.id, part });
  const edit = (spec) => { viewEdit = { dbId: db.id, ...spec }; redraw(); };
  let editorInput = null;
  const editor = () => {
    const e = viewEdit;
    const input = el('input', { class: 'view-name-input', value: e.name, 'aria-label': e.mode === 'rename' ? `Rename ${e.orig}` : 'New view name', autocomplete: 'off' });
    const row = el('div', { class: 'view-tab view-edit', role: 'listitem' }, input,
      el('span', { class: 'view-edit-hint', 'aria-hidden': 'true' }, e.mode === 'rename' ? '↵ save · esc' : '↵ create · esc'));
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      viewEdit = null;
      const name = input.value.trim() || e.name;
      row.remove();
      if (!commit || (e.mode === 'rename' && name === e.orig)) { redraw(); return; }
      if (e.mode === 'rename') return write(() => api('PATCH', at(e.id), { name }), { focus: e.id });
      let made;
      try {
        made = await api('PATCH', at(name), { from: e.from, ...(e.from === 'blank' ? systemDefault(db) : {}), ...(e.position != null ? { position: e.position } : {}) });
        if (e.from === 'blank') { stopTableSearchTimer(); tableSearch = { ...tableSearch, text: '', focus: false, only: null }; }
      } catch (err) { toast(err.message, true); redraw(); return; }
      await loadSchema();
      const hash = `#/table/${db.id}/view/${made.id}`;
      if (location.hash === hash) await showDatabase(db.id, made.id); else location.hash = hash;
    };
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        finish(false).then(() => document.querySelector('.table-view-popover .view-add')?.focus({ preventScroll: true }));
      }
    });
    input.addEventListener('blur', () => finish(true));
    editorInput = input;
    return row;
  };
  const editing = viewEdit?.dbId === db.id ? viewEdit : null;
  views.forEach((v, i) => {
    if (editing?.mode === 'rename' && editing.id === v.id) { strip.append(editor()); return; }
    const active = cur && !cur.blank && v.id === cur.id;
    const grip = el('button', { class: 'view-grip', type: 'button', 'aria-label': `Reorder ${v.name}`, title: 'Drag to reorder; Alt+↑ / Alt+↓ to move' }, lucideEl('grip-vertical'));
    const name = el('a', { class: 'view-name', href: viewHref(db, v), draggable: 'false', ...(active ? { 'aria-current': 'true' } : {}) }, v.name);
    name.addEventListener('click', (e) => { if (active) e.preventDefault(); });
    const act = (cls, icon, label, run) => el('button', { class: `view-act ${cls}`, type: 'button', 'aria-label': `${label} ${v.name}`, title: label, onclick: run }, lucideEl(icon));
    const del = holdToConfirm('', async () => {
      try { await api('DELETE', at(v.id)); } catch (err) { toast(err.message, true); return; }
      await loadSchema();
      if (cur?.id !== v.id) return showDatabase(db.id);
      const bare = `#/table/${db.id}`;
      if (location.hash === bare) showDatabase(db.id, null); else location.hash = bare;
    }, { rowClass: 'view-act view-del', holdingLabel: '' });
    del.classList.remove('text-danger');
    del.insertBefore(lucideEl('trash-2', 'wv-icon hold-icon'), del.querySelector('.hold-label'));
    del.setAttribute('aria-label', `Hold to delete ${v.name}`);
    del.title = 'Hold to delete';
    const row = el('div', { class: 'view-tab view-row' + (active ? ' active' : ''), role: 'listitem', dataset: { view: v.id } },
      grip, name,
      i === 0 ? el('span', { class: 'view-first', title: 'This view opens with the table' }, 'Opens first') : null,
      el('span', { class: 'view-acts' },
        act('view-rename-btn', 'pencil', 'Rename', () => edit({ mode: 'rename', id: v.id, name: v.name, orig: v.name })),
        act('view-dup-btn', 'copy', 'Duplicate', () => edit({ mode: 'dup', after: v.id, from: v.id, position: i + 1, name: nextViewName(db, v.name) })),
        del),
      el('span', { class: 'view-check', 'aria-hidden': 'true' }, active ? '✓' : ''));
    RO().guard(grip);
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      startRowDrag(strip, row, e, (target, after) => {
        const rest = views.filter((x) => x.id !== v.id);
        const to = target === v.id ? i : rest.findIndex((x) => x.id === target) + (after ? 1 : 0);
        if (to !== i) move(v, to, '.view-grip');
      }, { rows: '.view-row', key: (r) => r.dataset.view });
    });
    row.addEventListener('keydown', (e) => {
      if (!e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const to = i + (e.key === 'ArrowUp' ? -1 : 1);
      const part = e.target.closest('.view-grip') ? '.view-grip' : '.view-name';
      if (to >= 0 && to < views.length) move(v, to, part);
    });
    strip.append(row);
    if (editing?.mode === 'dup' && editing.after === v.id) strip.append(editor());
  });
  if (editing?.mode === 'new') strip.append(editor());
  strip.append(el('button', {
    class: 'btn btn-sm btn-ghost-secondary view-add', type: 'button', title: 'New view: every field, no filter, no sort',
    onclick: () => edit({ mode: 'new', from: 'blank', name: nextViewName(db) }),
  }, '+ Add view'));
  if (editorInput) queueMicrotask(() => { if (editorInput.isConnected) { editorInput.focus({ preventScroll: true }); editorInput.select(); } });
  return strip;
}
function filterSeed(db) {
  const values = {};
  for (const [name, states] of Object.entries(tableFilters(db))) {
    const f = db.fields.find((x) => x.name === name);
    if (!f || !states?.length) continue;
    if (f.type === 'toggle') { if (!states.includes(f.off)) values[name] = true; continue; }
    if (f.type === 'select') { values[name] = states[0]; continue; }
    if (f.type === 'multiselect') { values[name] = [states[0]]; continue; }
    const def = f.states?.find((s) => s.default)?.name;
    if (!states.includes(def)) values[name] = states[0];
  }
  return values;
}


function tableFilters(db) {
  return db.filters ?? {};
}
async function setTableFilters(db, filters) {
  return gridConfigWrite(db, { filters });
}
const FILTER_KINDS = {
  workflow: { label: 'Workflow', icon: 'refresh-cw' },
  toggle: { label: 'Toggle', icon: 'square-check' },
  select: { label: 'Single select', icon: 'list' },
  multiselect: { label: 'Multi select', icon: 'list-checks' },
};
const isFilterField = (f) => Object.hasOwn(FILTER_KINDS, f.type);
const filterStates = (f) => (f.type === 'toggle'
  ? [{ name: f.on, category: 'done', on: true }, { name: f.off, category: 'not-started', on: false }]
  : f.type === 'select' || f.type === 'multiselect'
    ? (f.optionsFull ?? (f.options ?? []).map((name) => ({ name }))).map((o) => ({ name: o.name, hue: o.hue || 'slate' }))
    : f.states);
const filterCounts = new Map();
function setFilterTotal(db, x, n) {
  if (x != null && n != null) filterCounts.set(db.id, { x, n });
  const c = filterCounts.get(db.id);
  const out = document.querySelector('.table-filter-popover .filter-total');
  if (!out || !c || out.closest('.chip-pop')?.tableId !== db.id) return;
  const text = `${c.x} of ${c.n} ${db.term?.plural ?? 'rows'}`;
  if (out.textContent !== text) out.textContent = text;
  out.classList.remove('stale');
}
function filterWhere(db) {
  const active = tableFilters(db);
  const conds = Object.entries(active)
    .map(([field, states]) => [db.fields.find((f) => f.name === field), states])
    .filter(([f, states]) => f && isFilterField(f) && states?.length)
    .map(([f, states]) => (f.type === 'toggle'
      ? [f.name, 'in', filterStates(f).filter((st) => states.includes(st.name)).map((st) => st.on)]
      : [f.name, 'in', states]));
  return conds.length ? conds : undefined;
}
const FILTER_DEBOUNCE = 250;
let filterWrites = Promise.resolve();
function filterStrip(db, onChange) {
  const wfFields = db.fields.filter(isFilterField);
  if (!wfFields.length) return null;
  const active = Object.fromEntries(Object.entries(tableFilters(db)).map(([k, v]) => [k, [...v]]));
  const strip = el('div', { class: 'filter-strip' });
  const chips = [];
  let timer = 0, dirty = false, inflight = 0, release = null;
  const hold = () => { release ??= gridHold(); };
  const note = el('span', { class: 'filter-total', role: 'status', 'aria-live': 'polite' });
  const clear = el('button', { class: 'btn btn-sm btn-ghost-primary tiny filter-clear', type: 'button', onclick: () => {
    if (db.view?.blank) return toast(BLANK_READ_ONLY, true);
    for (const k of Object.keys(active)) delete active[k];
    dirty = true; hold(); paint(); flush();
  } }, 'Clear all');
  const paint = () => {
    for (const { chip, field, name } of chips) {
      const on = (active[field] || []).includes(name);
      chip.classList.toggle('on', on); chip.querySelector('input').checked = on;
    }
    const count = Object.values(active).filter((v) => v.length).length;
    clear.disabled = !count;
    setFilterCount(document.querySelector('#main .table-filter-btn'), count);
  };
  const flush = () => {
    clearTimeout(timer);
    if (!dirty) return filterWrites;
    dirty = false;
    const next = Object.fromEntries(Object.entries(active).map(([k, v]) => [k, [...v]]));
    note.classList.add('stale'); strip.setAttribute('aria-busy', 'true');
    inflight += 1;
    filterWrites = filterWrites.catch(() => {}).then(async () => {
      await setTableFilters(db, next);
      if (state.route?.page === 'db' && state.route.dbId === db.id && state.route.view === db.view?.id) await onChange();
    }).catch((err) => {
      toast(err.message, true);
      const view = allTables().find((t) => t.id === db.id)?.views?.find((v) => v.id === db.view?.id);
      if (!dirty) { for (const k of Object.keys(active)) delete active[k]; Object.assign(active, view?.filters || {}); paint(); }
    }).finally(() => {
      inflight -= 1;
      if (dirty || inflight) return;
      strip.setAttribute('aria-busy', 'false');
      setFilterTotal(db);
      release?.(); release = null;
    });
    return filterWrites;
  };
  strip.flushPending = flush;
  const scroll = el('div', { class: 'filter-scroll' });
  for (const f of wfFields) {
    const row = el('div', { class: 'filter-group', role: 'group', 'aria-label': f.name },
      el('div', { class: 'filter-label' }, lucideEl(FILTER_KINDS[f.type].icon), f.name,
        el('span', { class: 'filter-type' }, FILTER_KINDS[f.type].label)));
    const values = el('div', { class: 'filter-values' });
    for (const st of filterStates(f)) {
      const box = el('input', { type: 'checkbox', class: 'form-check-input', onchange: () => {
        if (db.view?.blank) { box.checked = !box.checked; return toast(BLANK_READ_ONLY, true); }
        const cur = new Set(active[f.name] || []);
        box.checked ? cur.add(st.name) : cur.delete(st.name);
        if (cur.size) active[f.name] = [...cur]; else delete active[f.name];
        dirty = true; hold(); paint(); note.classList.add('stale');
        clearTimeout(timer); timer = setTimeout(flush, FILTER_DEBOUNCE);
      } });
      const chip = st.hue
        ? el('label', { class: `filter-chip hue-${st.hue}` }, box, el('span', { class: 'opt-dot', 'aria-hidden': 'true' }), st.name)
        : el('label', { class: `filter-chip cat-${st.category}` }, box, st.name);
      chips.push({ chip, field: f.name, name: st.name }); values.append(chip);
    }
    row.append(values); scroll.append(row);
  }
  strip.append(scroll, el('div', { class: 'filter-footer' }, note, clear)); paint();
  queueMicrotask(() => setFilterTotal(db));
  return strip;
}

const TABLE_SEARCH_DEBOUNCE = 150;
let tableSearch = { dbId: null, text: '', open: false, focus: false, only: null };
let tableSearchTimer = 0;
let tableSearchRelease = null;
function stopTableSearchTimer() {
  clearTimeout(tableSearchTimer); tableSearchTimer = 0;
  tableSearchRelease?.(); tableSearchRelease = null;
}
const tableSearchText = (db) => (tableSearch.dbId === db.id ? tableSearch.text.trim() : '');
function setTableSearch(db, text, { open = tableSearch.open, focus = false } = {}) {
  clearTimeout(tableSearchTimer); tableSearchTimer = 0;
  tableSearch = { ...tableSearch, dbId: db.id, text, open, focus };
  return showDatabase(db.id, state.route.view).finally(() => {
    if (!tableSearchTimer) { tableSearchRelease?.(); tableSearchRelease = null; }
  });
}
function openTableSearch(root = document) {
  const box = root.querySelector('.table-search');
  if (!box) return;
  tableSearch.open = true;
  box.classList.add('open');
  box.querySelector('.table-search-input').focus();
}
function tableSearchBox(db) {
  const input = el('input', {
    class: 'form-control form-control-sm table-search-input', type: 'search',
    placeholder: `Search ${db.term.plural}`, 'aria-label': `Search ${db.term.plural}`,
    value: tableSearchText(db) ? tableSearch.text : '',
  });
  const box = el('span', { class: 'table-search open' },
    el('button', {
      class: 'btn btn-sm table-search-btn', type: 'button', title: 'Search this table (/)', 'aria-label': 'Search this table',
      onclick: () => openTableSearch(box.parentElement),
    }, lucideEl('search')),
    input);
  input.addEventListener('input', () => {
    tableSearch = { ...tableSearch, dbId: db.id, text: input.value, open: true };
    clearTimeout(tableSearchTimer);
    tableSearchRelease ??= gridHold();
    tableSearchTimer = setTimeout(() => setTableSearch(db, input.value).catch((err) => toast(err.message, true)), TABLE_SEARCH_DEBOUNCE);
  });
  input.addEventListener('keydown', async (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      const had = tableSearchText(db) || input.value.trim();
      if (!had) { stopTableSearchTimer(); tableSearch.open = false; box.querySelector('button').focus(); return; }
      await setTableSearch(db, '', { open: false });
      document.querySelector('.table-search-btn')?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (input.value.trim() !== tableSearchText(db)) await setTableSearch(db, input.value, { focus: true });
      if (tableSearch.only) openEntity(tableSearch.only);
    }
  });
  return box;
}

async function showDatabase(dbId, view) {
  const table = allTables().find((d) => d.id === dbId);
  if (!table) return showHome();
  if (view === undefined && state.route?.page === 'db' && state.route.dbId === dbId) view = state.route.view;
  if (!(state.route?.page === 'db' && state.route.dbId === dbId)) noteRecent({ kind: 'table', id: table.id, name: table.qualified ?? table.name, url: `${WS_PREFIX}/#/table/${table.id}` });
  const db = viewed(table, pickTableView(table, view));
  if (tableSearch.dbId !== dbId) { stopTableSearchTimer(); tableSearch = { dbId, text: '', open: false, focus: false, only: null }; }
  const search = tableSearch.text.trim();
  const again = tableChromeOn(dbId);
  state.route = { page: 'db', dbId, view: db.view.id };
  if (!again) renderNav();
  const release = again ? gridHold() : () => {};
  try { await readAndDrawTable(db, dbId, search); } finally { release(); }
}
async function readAndDrawTable(db, dbId, search) {
  if (isListLayout(db)) return readAndDrawList(db, dbId, search);
  const where = filterWhere(db);
  const showDeleted = showsDeleted(db);
  const query = {
    ...(where ? { where } : {}),
    ...(gridSort(db) ? { sort: gridSort(db) } : {}),
    ...(search ? { search } : {}),
    ...(showDeleted ? {} : { limit: globalThis.WeaveGridWindow.PAGE, offset: 0 }),
    fields: gridFields(db),
    relations: 'chip',
  };
  const [result, trash] = await Promise.all([
    api('POST', `/tables/${db.id}/query`, { ...query, trashCount: true, countAll: true }).then((res) => graftChips(db, res)),
    showDeleted
      ? api('GET', `/tables/${db.id}/trash`).catch(() => ({ total: 0, items: [] }))
      : null,
  ]);
  if (tableSearch.dbId === dbId && tableSearch.text.trim() !== search) return;
  tableSearch.only = search && result.total === 1 ? result.items[0]?.id ?? null : null;
  setFilterTotal(db, result.total, result.all);
  const items = showDeleted && !search
    ? [...result.items, ...(trash.items ?? []).map((e) => ({ ...e, deleted: true }))]
    : result.items;
  drawDatabase(db, items, trash?.total ?? result.trashCount ?? 0, showDeleted ? null : gridPager(db, query, result));
}

function gridMoves(db, field) {
  if (!field) return true;
  if ((gridSort(db) ?? []).some((s) => s.field === field || s.field === 'Modified At' || s.field === 'Modified By')) return true;
  return Object.keys(tableFilters(db) ?? {}).includes(field);
}

function gridFields(db) {
  const names = new Set(visibleCols(db));
  for (const s of gridSort(db) ?? []) if (db.fields.some((f) => f.name === s.field)) names.add(s.field);
  for (const n of db.systemFields ?? []) names.add(n);
  return [...names];
}

function graftChips(db, res) {
  if (!res?.chips) return res;
  const rels = db.fields.filter((f) => f.type === 'relation' || lookupTargetOf(db, f)?.type === 'relation').map((f) => f.name);
  for (const item of res.items ?? []) {
    for (const name of rels) {
      const v = item.fields?.[name];
      for (const ref of Array.isArray(v) ? v : [v]) if (ref?.id && res.chips[ref.id]) Object.assign(ref, res.chips[ref.id]);
    }
  }
  return res;
}

function gridSort(db) {
  const sort = (db.sort ?? []).filter((s) => db.fields.some((f) => f.name === s.field) || fieldDialogCore.SYSTEM_SORT[s.field]);
  return sort.length ? sort : null;
}

function gridPager(db, query, first) {
  const GW = globalThis.WeaveGridWindow;
  const rows = new Array(first.total);
  const pages = new Map();
  const put = (offset, res) => {
    pager.total = res.total;
    res.items.forEach((e, i) => { rows[offset + i] = e; });
    rows.length = res.total;
  };
  const fetch = (offset) => {
    if (pages.has(offset)) return pages.get(offset);
    const p = api('POST', `/tables/${db.id}/query`, { ...query, limit: GW.PAGE, offset }).then((res) => put(offset, graftChips(db, res)));
    p.catch(() => pages.delete(offset));
    pages.set(offset, p);
    return p;
  };
  const pager = {
    rows, total: first.total, page: GW.PAGE, search: query.search ?? '',
    window: { start: 0, end: 0 },
    has: (offset) => pages.has(offset),
    fetch,
    pageOf: (i) => Math.floor(i / GW.PAGE) * GW.PAGE,
    refresh: async () => {
      const want = GW.pagesFor(pager.window, GW.PAGE, pager.total);
      pages.clear();
      rows.length = 0;
      await Promise.all((want.length ? want : [0]).map(fetch));
      rows.length = pager.total;
    },
    indexOf: async (id) => {
      const found = () => rows.findIndex((r) => r && r.id === id);
      let i = found();
      if (i < 0 && pager.total) { await fetch(pager.pageOf(pager.total - 1)); i = found(); }
      for (let o = 0; i < 0 && o < pager.total; o += GW.PAGE) { await fetch(o); i = found(); }
      return i;
    },
  };
  put(0, first);
  pages.set(0, Promise.resolve());
  return pager;
}

function tableControlPopover(anchor, db, className, rows) {
  const selector = `.${[...anchor.classList].find((c) => /^table-.*-btn$/.test(c)) || 'eye-btn'}`;
  const old = document.querySelector('.chip-pop');
  const same = old?.classList.contains(className) && old.tableId === db.id;
  old?.remove();
  if (same) return null;
  const pop = el('div', { class: `chip-pop table-control-popover ${className}`, role: 'dialog', 'aria-label': anchor.getAttribute('aria-label') || anchor.textContent.trim() }, ...rows);
  pop.tableId = db.id;
  pop.viewId = db.view?.id;
  pop.triggerSelector = selector;
  const trigger = () => document.querySelector(`#main ${selector}`) || anchor;
  const position = () => {
    const r = trigger().getBoundingClientRect();
    if (className === 'table-fields-popover' || className === 'table-filter-popover') pop.style.maxHeight = `${Math.max(220, innerHeight - r.bottom - 22)}px`;
    pop.style.left = `${Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8))}px`;
    pop.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8))}px`;
  };
  let off = () => {};
  const remove = pop.remove.bind(pop);
  pop.remove = () => {
    if (!pop.isConnected) return;
    pop.beforeClose?.();
    trigger().setAttribute('aria-expanded', 'false');
    off();
    window.removeEventListener('resize', position);
    remove();
  };
  pop.addEventListener('click', (e) => {
    const hit = e.target.closest('button:not(.hold-btn),a,label');
    const target = hit?.tagName === 'LABEL' ? hit.control : hit;
    if (pop.isConnected && target && pop.contains(target) &&
        (document.activeElement === document.body || pop.contains(document.activeElement))) target.focus({ preventScroll: true });
  });
  pop.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.target.matches('input:not([type="checkbox"])') || (e.target.closest('.field-reorder-handle') && ['ArrowUp', 'ArrowDown'].includes(e.key))) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pop.remove(); trigger().focus({ preventScroll: true }); }
    else if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
      const opts = [...pop.querySelectorAll('.view-name,.view-add,.seg-opt,.eye-row:not(label),.eye-row > input,.filter-chip:not(label),.filter-chip > input,.chip-pop-row:not(label)')].filter((b) => !b.disabled);
      if (!opts.length) return;
      e.preventDefault();
      const i = opts.indexOf(document.activeElement), step = e.key === 'ArrowUp' ? -1 : 1;
      opts[(i + step + opts.length) % opts.length].focus({ preventScroll: true });
    }
  });
  pop.reposition = position;
  document.body.append(pop);
  trigger().setAttribute('aria-expanded', 'true');
  position();
  off = dismissOutside({ inside: (t) => pop.contains(t) || !!t.closest?.(selector), close: () => pop.remove() });
  window.addEventListener('resize', position);
  pop.querySelector('.view-tab.active .view-name,.seg-opt.on,.eye-row:not(label),.eye-row > input,.filter-chip:not(label),.filter-chip > input,.chip-pop-row:not(label)')?.focus({ preventScroll: true });
  return pop;
}
function tableControlButton(className, label, icon, dropdown = false) {
  return el('button', { class: `btn btn-sm ${className}`, type: 'button', 'aria-expanded': 'false', 'aria-haspopup': 'dialog' },
    lucideEl(icon), el('span', { class: 'table-control-label' }, label), dropdown ? lucideEl('chevron-down') : null);
}
function tableControlHeader(title, close) {
  return el('div', { class: 'table-control-head' }, el('strong', {}, title),
    el('button', { class: 'btn btn-sm btn-icon btn-ghost-secondary', type: 'button', 'aria-label': `Close ${title.toLowerCase()}`, onclick: close }, lucideEl('x')));
}
function tableViewButton(ref) {
  const btn = tableControlButton('table-view-btn', '', 'table', true);
  btn.label = () => {
    const name = ref.db.view?.name || 'Standard';
    btn.querySelector('.table-control-label').textContent = name;
    btn.setAttribute('aria-label', `View: ${name}`);
  };
  btn.label();
  btn.addEventListener('click', () => {
    const db = ref.db;
    let pop;
    viewEdit = null;
    const reset = async (raw, current) => {
      if (current.view?.blank) return toast(BLANK_READ_ONLY, true);
      pop?.remove();
      const release = gridHold();
      try {
        await filterWrites;
        await eyeWrites;
        stopTableSearchTimer();
        tableSearch = { ...tableSearch, text: '', focus: false, only: null };
        const patch = raw ? systemDefault(db, current.view) : { filters: {}, sort: [] };
        await gridConfigWrite(current, null, patch);
        await showDatabase(db.id, current.view?.id);
        document.querySelector('.table-view-btn')?.focus({ preventScroll: true });
      } catch (err) { toast(err.message, true); } finally { release(); }
    };
    const setLayout = async (current, layout) => {
      const release = gridHold();
      try {
        if (await gridConfigWrite(current, null, { layout })) await showDatabase(db.id, current.view?.id);
      } catch (err) { toast(err.message, true); } finally { release(); }
    };
    const build = (current) => [
      tableControlHeader('Views', () => pop?.remove()), viewStrip(current),
      el('div', { class: 'view-layout' }, el('span', { class: 'view-layout-label' }, 'Layout'),
        segCtl([{ id: 'table', label: 'Table', title: 'Records to compare' }, { id: 'list', label: 'List', title: 'Things to finish: grouped, ordered, checkable' }],
          current.view?.layout === 'list' ? 'list' : 'table', (layout) => setLayout(current, layout))),
      el('hr'),
      el('button', { class: 'chip-pop-row view-reset', type: 'button', onclick: () => reset(true, current) }, lucideEl('undo'), 'Reset view'),
      el('button', { class: 'chip-pop-row view-clear', type: 'button', onclick: () => reset(false, current) }, lucideEl('list-filter'), 'Clear filters, search, and sorting'),
      el('p', { class: 'table-control-note' }, 'Changes save automatically. Reset shows every field in schema order as a Table with no grouping, turns off filters, sorting, search, deleted rows and the Σ rollup row, and sets Comfortable density.'),
    ];
    pop = tableControlPopover(btn, db, 'table-view-popover', build(db));
    if (!pop) return;
    pop.refresh = (current, { force = false } = {}) => {
      if (!force && pop.querySelector('.view-name-input')) return;
      const at = document.activeElement?.closest('.view-tab');
      const focused = at?.dataset.view;
      const part = ['view-grip', 'view-name', 'view-rename-btn', 'view-dup-btn', 'view-del'].find((c) => document.activeElement?.classList.contains(c));
      pop.replaceChildren(...build(current));
      if (focused) pop.querySelector(`[data-view="${CSS.escape(focused)}"] ${part ? `.${part}` : '.view-name'}`)?.focus({ preventScroll: true });
    };
    pop.querySelector('.view-tab.active .view-name, .view-tab .view-name')?.focus({ preventScroll: true });
  });
  return btn;
}
function tableDensityButton(ref) {
  const btn = tableControlButton('table-density-btn', '', 'list', true);
  btn.label = (mode = gridDensity(ref.db)) => {
    btn.querySelector('.table-control-label').textContent = DENSITY_LABELS[mode];
    btn.setAttribute('aria-label', `Row density: ${DENSITY_LABELS[mode]}`);
  };
  btn.label();
  btn.addEventListener('click', () => {
    const db = ref.db;
    let pop;
    const choices = segCtl([
      { id: 'compact', label: 'Compact', title: 'Short rows, for scanning' },
      { id: 'comfortable', label: 'Comfortable', title: 'Roomy rows, for reading' },
      { id: 'spacious', label: 'Spacious', title: 'Two lines per row, for long values' },
    ], gridDensity(db), (next) => {
      const wrap = document.querySelector('.wv-grid')?.closest('.table-wrap') ?? document.querySelector('#main .list-wrap');
      if (wrap?.wvSetDensity) wrap.wvSetDensity(next); else saveGridDensity(db, next);
      btn.label(next);
      pop?.remove(); btn.focus({ preventScroll: true });
    });
    for (const b of choices.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.classList.contains('on')));
    pop = tableControlPopover(btn, db, 'table-density-popover', [tableControlHeader('Row density', () => pop?.remove()), choices]);
    pop?.querySelector('.seg-opt.on')?.focus({ preventScroll: true });
  });
  return btn;
}
function setFilterCount(btn, count) {
  if (!btn) return;
  let badge = btn.querySelector('.table-filter-count');
  if (!count) { badge?.remove(); return; }
  if (!badge) btn.append(badge = el('span', { class: 'table-filter-count' }));
  if (badge.textContent !== String(count)) badge.textContent = String(count);
}
function tableFilterButton(ref) {
  const btn = tableControlButton('table-filter-btn', 'Filters', 'list-filter');
  btn.setAttribute('aria-label', 'Filters');
  btn.label = () => setFilterCount(btn, Object.values(tableFilters(ref.db)).filter((v) => v?.length).length);
  btn.label();
  btn.addEventListener('click', () => {
    const db = ref.db;
    let pop;
    const strip = filterStrip(db, () => keepScroll(() => showDatabase(db.id, db.view?.id)));
    const content = strip || el('div', { class: 'table-control-note' },
      'Workflow, toggle and select fields provide filters. This table has none.',
      el('button', { class: 'chip-pop-row table-filter-add-field', type: 'button', onclick: () => { pop?.remove(); addFieldDialog(db); } }, lucideEl('plus'), 'New field'));
    pop = tableControlPopover(btn, db, 'table-filter-popover', [tableControlHeader('Filters', () => pop?.remove()), content]);
    if (pop) pop.beforeClose = () => strip?.flushPending();
  });
  return btn;
}
function tableSortButton(ref) {
  const btn = tableControlButton('table-sort-btn', 'Sort', 'arrow-down', true);
  const value = el('span', { class: 'table-sort-value' });
  btn.querySelector('.table-control-label').after(value);
  const fieldOf = (name) => ref.db.fields.find((f) => f.name === name) ?? fieldDialogCore.SYSTEM_SORT[name] ?? { name, type: 'text' };
  const words = (name, dir) => sortLabelsFor(ref.db, fieldOf(name))[dir === 'desc' ? 'desc' : 'asc'];
  btn.label = () => {
    const s = ref.db.sort?.[0];
    value.textContent = s ? `${s.field}, ${words(s.field, s.dir)}` : 'None';
    btn.setAttribute('aria-label', s ? `Sort: ${s.field}, ${words(s.field, s.dir)}` : 'Sort: none');
  };
  btn.label();
  btn.addEventListener('click', () => {
    const db = ref.db;
    let pop;
    const write = async (sort) => {
      pop?.remove();
      const release = gridHold();
      try {
        if (await gridConfigWrite(db, { sort })) await keepScroll(() => showDatabase(db.id, db.view?.id));
      } catch (err) { toast(err.message, true); } finally { release(); }
    };
    const now = db.sort?.[0] ?? null;
    const fields = db.fields.filter((f) => f.type !== 'view' && f.type !== 'document');
    const rows = fields.map((f) => el('button', {
      class: 'chip-pop-row table-sort-field', type: 'button', 'aria-pressed': String(now?.field === f.name),
      onclick: () => write([{ field: f.name, dir: now?.field === f.name ? now.dir : 'asc' }]),
    }, el('span', { class: 'table-sort-name' }, f.name), now?.field === f.name ? lucideEl('check', 'wv-icon chip-pop-check') : null));
    const dir = now ? segCtl([
      { id: 'asc', label: words(now.field, 'asc') },
      { id: 'desc', label: words(now.field, 'desc') },
    ], now.dir === 'desc' ? 'desc' : 'asc', (d) => write([{ field: now.field, dir: d }])) : null;
    const clear = now ? el('button', { class: 'chip-pop-row table-sort-clear', type: 'button', onclick: () => write([]) }, lucideEl('x'), 'Clear sort') : null;
    pop = tableControlPopover(btn, db, 'table-sort-popover', [tableControlHeader('Sort', () => pop?.remove()), dir, el('div', { class: 'table-sort-list' }, ...rows), clear]);
  });
  return btn;
}
function tableSheetGroup(title, items) {
  const rows = [];
  for (const it of items.filter(Boolean)) {
    if (it === 'divider') continue;
    if (it.href) rows.push(el('a', { class: 'tools-row', href: it.href, download: it.download }, it.label));
    else if (it.hold) rows.push(holdToConfirm(it.hold, () => it.run(), { holdingLabel: it.holdingLabel ?? 'Hold to confirm…', rowClass: 'tools-row tools-row-danger' }));
    else rows.push(el('button', { class: 'tools-row', type: 'button', onclick: () => it.run() }, it.label));
  }
  return el('div', { class: 'tools-group', role: 'group', 'aria-label': title }, el('div', { class: 'tools-group-head' }, title), ...rows);
}
const RO = () => globalThis.WeaveReorder;
function startRowDrag(list, row, down, drop, { rows = '.table-field-row', key = (r) => r.dataset.field } = {}) {
  return RO().sortable(down, {
    source: row,
    items: () => [...list.querySelectorAll(rows)],
    zone: () => list.closest('.chip-pop') ?? list,
    lock: true,
    onDrop: () => {
      row.dragged = true;
      setTimeout(() => { row.dragged = false; });
      const all = [...list.querySelectorAll(rows)].filter((n) => !RO().lifting(n));
      const i = all.indexOf(row);
      if (all[i + 1]) drop(key(all[i + 1]), false);
      else if (all[i - 1]) drop(key(all[i - 1]), true);
    },
  });
}
function tableFieldsPopover(anchor, db, trashCount) {
  let pop;
  const raw = () => allTables().find((t) => t.id === db.id) || db;
  const current = () => { const t = raw(); return viewed(t, db.view?.blank ? blankView(t) : t.views.find((v) => v.id === db.view.id) || db.view); };
  const systemColumns = Object.keys(SYSTEM_COLS).filter((n) => n !== 'Activity');
  let order = [...new Set([...(db.columns || []), ...raw().fields.map((f) => f.name), ...systemColumns])];
  const movedHidden = new Set();
  const here = () => state.route?.page === 'db' && state.route.dbId === db.id && state.route.view === db.view?.id;
  const write = (make, { hides = null } = {}) => {
    if (db.view?.blank) { toast(BLANK_READ_ONLY, true); return; }
    const painted = hides && here() && dropDrawnColumn(db.id, hides);
    const release = eyeGesture(painted ? () => {} : gridHold());
    const turn = eyeWrites.then(async () => {
      const patch = make(current());
      if (patch.table) { await api('PATCH', `/tables/${db.id}`, patch.table); await loadSchema(); }
      else await gridConfigWrite(db, null, patch);
    }).catch((err) => toast(err.message, true));
    eyeWrites = turn; eyeTails.set(db.id, turn);
    turn.then(async () => {
      try {
        if (eyeTails.get(db.id) !== turn) return;
        eyeTails.delete(db.id);
        if (!here()) return;
        try {
          if (!painted || !drawnMatches(current())) await keepScroll(() => showDatabase(db.id, db.view.id));
          if (dock?.db.id === db.id) await drawDock();
        } catch (err) { toast(err.message, true); }
        if (pop?.isConnected) refresh(current());
      } finally { release(); }
    });
  };
  const flip = (name) => write((t) => {
    const shown = t.columns || [];
    if (shown.includes(name)) return { hide: [name] };
    if (!movedHidden.has(name)) return { show: [name] };
    movedHidden.delete(name);
    const next = order.slice(order.indexOf(name) + 1).find((n) => shown.includes(n));
    const previous = order.slice(0, order.indexOf(name)).reverse().find((n) => shown.includes(n));
    return { show: [name], ...(next ? { move: { field: name, before: next } } : previous ? { move: { field: name, after: previous } } : {}) };
  }, { hides: (current().columns || []).includes(name) ? name : null });
  const move = (from, target, after) => {
    if (from === target || db.view?.blank) return;
    order = order.filter((n) => n !== from);
    order.splice(order.indexOf(target) + (after ? 1 : 0), 0, from);
    const list = pop.querySelector('.table-field-list');
    for (const name of order) { const row = [...list.children].find((r) => r.dataset.field === name); if (row) list.append(row); }
    write((t) => {
      if (!(t.columns || []).includes(from)) movedHidden.add(from);
      return { fields: order.filter((n) => (t.columns || []).includes(n)) };
    });
  };
  const makeRow = (name, shown) => {
    const box = el('input', { type: 'checkbox', class: 'form-check-input', checked: shown ? '' : undefined, onchange: () => flip(name) });
    const toggle = el('label', { class: 'chip-pop-row eye-row' }, box, el('span', { class: 'eye-label' }, name));
    const handle = el('button', { class: 'field-reorder-handle', type: 'button', 'aria-label': `Reorder ${name}`, title: 'Drag to reorder; ↑ / ↓ to move' }, lucideEl('grip-vertical'));
    const row = el('div', { class: 'table-field-row', dataset: { field: name } }, toggle, handle);
    RO().guard(row);
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target === box || db.view?.blank) return;
      startRowDrag(pop.querySelector('.table-field-list'), row, e, (target, after) => move(name, target, after));
    });
    row.addEventListener('click', (e) => { if (row.dragged) { row.dragged = false; e.preventDefault(); e.stopPropagation(); } }, true);
    handle.addEventListener('keydown', (e) => {
      if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
      e.preventDefault(); const i = order.indexOf(name), to = i + (e.key === 'ArrowUp' ? -1 : 1);
      if (to >= 0 && to < order.length) { move(name, order[to], to > i); handle.focus({ preventScroll: true }); }
    });
    return row;
  };
  const refresh = (t) => {
    if (!pop?.isConnected) return;
    const names = new Set([...raw().fields.map((f) => f.name), ...systemColumns]);
    const list = pop.querySelector('.table-field-list');
    for (const row of [...list.children]) if (!names.has(row.dataset.field)) row.remove();
    order = order.filter((n) => names.has(n));
    for (const name of names) if (!order.includes(name)) { order.push(name); list.append(makeRow(name, (t.columns || []).includes(name))); }
    const shown = new Set(t.columns || []);
    for (const r of pop.querySelectorAll('.table-field-row')) r.querySelector('.eye-row input').checked = shown.has(r.dataset.field);
    const rollups = pop.querySelector('[data-rollups] input');
    if (rollups) rollups.checked = showsRollups(t);
    const deleted = pop.querySelector('[data-deleted] input');
    if (deleted) deleted.checked = showsDeleted(t);
  };
  const shown = new Set(db.columns || []);
  const rows = [tableControlHeader('Fields', () => pop?.remove()),
    el('div', { class: 'field-visibility-actions' },
      el('button', { class: 'btn btn-sm btn-ghost-primary', type: 'button', onclick: () => write(() => ({ fields: [...order] })) }, 'Show all'),
      el('button', { class: 'btn btn-sm btn-ghost-primary', type: 'button', onclick: () => write(() => ({ fields: [] })) }, 'Hide all')),
    el('div', { class: 'table-field-legend' }, 'Show / hide', el('span', {}, 'Drag to reorder')),
    el('div', { class: 'table-field-list' }, ...order.map((n) => makeRow(n, shown.has(n)))),
    el('hr'), el('button', { class: 'chip-pop-row fields-add', type: 'button', onclick: () => { pop?.remove(); addFieldDialog(db); } }, lucideEl('plus'), 'New field'),
    el('div', { class: 'eye-head' }, 'Rows'),
    el('label', { class: 'chip-pop-row eye-row', 'data-deleted': '' },
      el('input', { type: 'checkbox', class: 'form-check-input', checked: showsDeleted(db) ? '' : undefined, onchange: () => write((t) => ({ deleted: !showsDeleted(t) })) }),
      el('span', { class: 'eye-label' }, `Deleted ${db.term.plural}${trashCount ? ` (${trashCount})` : ''}`)),
    ...(db.system ? [] : [el('label', { class: 'chip-pop-row eye-row', 'data-rollups': '' },
      el('input', { type: 'checkbox', class: 'form-check-input', checked: showsRollups(db) ? '' : undefined, onchange: () => write((t) => ({ rollups: !showsRollups(t) })) }),
      el('span', { class: 'eye-label' }, 'Σ rollup row'))]),
  ];
  pop = tableControlPopover(anchor, db, 'table-fields-popover', rows);
  if (pop) { pop.eyeOf = db.id; pop.relearnEye = () => refresh(current()); }
}

const tableChromeSig = (db) => JSON.stringify([db.name, db.icon, db.description, db.space, db.spaceId, db.term?.singular, db.term?.plural]);
function tableChromeOn(dbId) {
  const main = $('#main');
  const chrome = main?.wvTable;
  return !!chrome && chrome.dbId === dbId && chrome.header.parentElement === main ? chrome : null;
}
function tableChrome(db, trashCount) {
  const ref = { db, trashCount };
  const chrome = { dbId: db.id, sig: tableChromeSig(db), ref };
  const viewBtn = tableViewButton(ref);
  const densityBtn = tableDensityButton(ref);
  const filterBtn = tableFilterButton(ref);
  const groupBtn = tableGroupButton(ref);
  const sortBtn = tableSortButton(ref);
  const search = tableSearchBox(db);
  chrome.set = (next, count) => {
    ref.db = next; ref.trashCount = count;
    viewBtn.label(); densityBtn.label(); filterBtn.label(); groupBtn.label(); sortBtn.label(); tools.label();
    const input = search.querySelector('.table-search-input');
    const want = tableSearchText(next) ? tableSearch.text : '';
    if (input.value.trim() !== want.trim()) input.value = want;
  };
  const tableActions = [
    { label: 'Column stats…', run: () => columnStatsPanel(ref.db) },
    { label: 'Export CSV', href: `${WS_PREFIX}/api/tables/${db.id}/export.csv`, download: `${db.name}.csv` },
    'divider',
    {
      label: 'New share page…',
      run: () => modal('New share page', [
        el('input', { name: 'name', placeholder: 'Page name', class: 'form-control full' }),
      ], async (fd) => {
        const where = filterWhere(ref.db);
        await api('POST', '/views', { name: fd.get('name'), blocks: [{ table: db.id, ...(where ? { where } : {}) }] });
        toast('Share page saved — find it on the workspace page');
      }, 'Save'),
    },
    'divider',
    {
      label: `Row term (${db.term.singular})…`,
      run: () => editFieldDialog(ref.db, nameFieldOf(ref.db)),
    },
    'divider',
    {
      hold: 'Delete table', holdingLabel: 'Hold to delete table…',
      run: async () => {
        try {
          await api('DELETE', `/tables/${db.id}`);
          await loadSchema();
          location.hash = `#/space/${db.spaceId}`;
          toast(`Deleted ${db.name}`);
        } catch (err) { toast(err.message, true); }
      },
    },
  ];
  chrome.header = viewHeader({
    crumbs: [
      { label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() },
      { label: db.space, href: `#/space/${db.spaceId}` },
    ],
    permalink: () => {
      const v = ref.db.view;
      const byDefault = !v || v.id === pickTableView(allTables().find((d) => d.id === ref.db.id) ?? ref.db, null)?.id;
      return `${location.origin}${WS_PREFIX}/${byDefault ? `t/${ref.db.id}` : viewHref(ref.db, v)}`;
    },
    title: db.name,
    icon: db.icon,
    kind: 'table',
    onSetIcon: async (icon) => {
      await api('PATCH', `/tables/${db.id}`, { icon: icon ?? '' });
      await loadSchema();
      showDatabase(db.id, state.route.view);
    },
    onRename: db.system ? null : async (name) => {
      await api('PATCH', `/tables/${db.id}`, { name });
      await loadSchema();
      await showDatabase(db.id, state.route.view);
    },
    description: db.description,
    onSaveDescription: async (md) => {
      await api('PATCH', `/tables/${db.id}`, { description: md });
      await loadSchema();
      const saved = allTables().find((d) => d.id === db.id);
      if (saved) chrome.sig = tableChromeSig(saved);
    },
    actions: [
      search,
      viewBtn,
      densityBtn,
      (() => {
        const eye = tableControlButton('eye-btn', 'Fields', 'eye');
        eye.setAttribute('aria-label', 'Show or hide fields');
        eye.addEventListener('click', () => fieldVisibilityPopover(eye, ref.db, ref.trashCount));
        return eye;
      })(),
      filterBtn,
      groupBtn,
      sortBtn,
      dotsMenu(tableActions, { title: 'Table actions', align: 'right' }),
      tableSheetGroup('Table', tableActions),
    ],
  });
  const tools = tableToolsButton(chrome.header, ref);
  chrome.header.querySelector('.crumb-row').append(tools);
  return chrome;
}

function tableToolsButton(header, ref) {
  const count = el('span', { class: 'table-tools-count', hidden: '' });
  const btn = el('button', {
    class: 'btn table-tools-btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
    'aria-label': 'View, filters, fields and row height', title: 'View, filters, fields and row height',
  }, lucideEl('sliders-horizontal'), count);
  const row = () => header.querySelector('.crumb-row');
  const sheet = () => header.querySelector('.crumb-row > .crumb-actions');
  btn.label = () => {
    const n = Object.values(tableFilters(ref.db)).filter((v) => v?.length).length;
    count.textContent = n ? String(n) : '';
    count.hidden = !n;
  };
  btn.label();
  let off = () => {};
  const shut = () => {
    row()?.classList.remove('tools-open');
    btn.setAttribute('aria-expanded', 'false');
    off();
    removeEventListener('keydown', esc, true);
  };
  const esc = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.chip-pop, .picker-pop, #modal-back, #cmdk-back') || sheet()?.querySelector('.dl-menu:not(.hidden)')) return;
    shut();
    btn.focus({ preventScroll: true });
  };
  header.addEventListener('click', (e) => { if (e.target.closest('.tools-group .tools-row:not(.hold-btn)')) shut(); });
  btn.addEventListener('click', () => {
    if (row().classList.contains('tools-open')) return shut();
    const r = btn.getBoundingClientRect();
    row().style.setProperty('--tools-top', `${r.bottom + 8}px`);
    row().style.setProperty('--tools-right', `${document.documentElement.clientWidth - r.right}px`);
    row().classList.add('tools-open');
    btn.setAttribute('aria-expanded', 'true');
    off = dismissOutside({
      open: () => btn.isConnected || (shut(), false),
      inside: (t) => btn.contains(t) || !!sheet()?.contains(t) || !!t.closest?.('.chip-pop, .picker-pop, #modal-back, #cmdk-back'),
      swallow: () => true, close: shut,
    });
    addEventListener('keydown', esc, true);
  });
  return btn;
}

function drawDatabase(db, items, trashCount = 0, pager = null, list = null) {
  const main = $('#main');
  let chrome = tableChromeOn(db.id);
  if (chrome && chrome.sig === tableChromeSig(db)) {
    chrome.set(db, trashCount);
    syncDocTitle(db.name);
    for (const n of [...main.children]) if (n !== chrome.header && !n.classList.contains('grid-loader')) n.remove();
  } else {
    const typing = document.activeElement?.classList?.contains('table-search-input') ? document.activeElement : null;
    const caret = typing ? [typing.selectionStart, typing.selectionEnd] : null;
    main.replaceChildren();
    chrome = tableChrome(db, trashCount);
    main.wvTable = chrome;
    main.append(chrome.header);
    const searchInput = main.querySelector('.table-search-input');
    if (searchInput && typing) {
      searchInput.focus();
      if (caret) searchInput.setSelectionRange(...caret);
    }
  }
  if (tableSearch.focus) {
    tableSearch.focus = false;
    const searchInput = main.querySelector('.table-search-input');
    if (searchInput && document.activeElement !== searchInput) searchInput.focus();
  }

  const controlPop = document.querySelector('.table-control-popover');
  if (controlPop?.tableId === db.id && (controlPop.viewId === db.view?.id || controlPop.classList.contains('table-view-popover'))) {
    controlPop.viewId = db.view?.id;
    main.querySelector(controlPop.triggerSelector)?.setAttribute('aria-expanded', 'true');
    controlPop.refresh?.(db);
  }

  const searching = tableSearchText(db);
  if (searching && !(pager ? pager.total : items.length)) {
    main.append(el('div', { class: 'table-search-empty wv-note' },
      `No ${db.term.plural} match “${searching}”. `,
      el('button', {
        class: 'btn btn-sm btn-ghost-secondary tiny table-search-clear', type: 'button',
        onclick: () => setTableSearch(db, '', { focus: true }),
      }, 'Clear search')));
  }

  if (list) {
    state.inlineAdd = async () => main.querySelector('.list-add-name')?.focus();
    renderList(main, db, items, list);
    main.wvDraw = { db, items, trashCount, pager: null };
    paintGridWait();
    return;
  }

  const onSaved = async (written = null, field = null) => {
    if (written?.affected && !db.system && !gridMoves(db, field)
      && await main.querySelector('.table-wrap')?.wvPatchRows?.(written)) return;
    rememberGridFocus();
    if (db.system) await loadSchema();
    let fresh = items;
    if (pager) await pager.refresh();
    else {
      const w2 = filterWhere(db);
      fresh = (await api('POST', `/tables/${db.id}/query`, { ...(w2 ? { where: w2 } : {}), ...(searching ? { search: searching } : {}) })).items;
    }
    await keepScroll(() => drawDatabase(db, fresh, trashCount, pager));
    restoreGridFocus({ now: true });
  };

  const redraw = async () => {
    if (!pager) {
      const fresh = await api('POST', `/tables/${db.id}/query`, {});
      return drawDatabase(db, fresh.items, trashCount);
    }
    await pager.refresh();
    await keepScroll(() => drawDatabase(db, items, trashCount, pager));
  };
  state.inlineAdd = async () => {
    if (searching) {
      await setTableSearch(db, '', { open: false });
      return state.inlineAdd();
    }
    try {
      if (db.system === 'tables') return newTableDialog(db, redraw);
      if (db.system === 'fields') return newFieldDialog(redraw);
      const seed = { name: db.system === 'spaces' ? 'New space' : '' };
      const inside = db.system ? {} : filterSeed(db);
      if (Object.keys(inside).length) seed.values = inside;
      const created = await api('POST', `/tables/${db.id}/entities`, seed);
      await loadSchema();
      await redraw();
      if (pager) {
        const i = await pager.indexOf(created.id);
        if (i >= 0) main.querySelector('.table-wrap')?.wvScrollToRow?.(i);
      }
      focusNewRow(created.id, { field: nameFieldOf(db)?.name, select: !!seed.name });
    } catch (err) { toast(err.message, true); }
  };

  renderTable(main, db, items, onSaved, state.inlineAdd, pager);
  main.wvDraw = { db, items, trashCount, pager };
  syncPhoneBar();
  paintGridWait();
  main.querySelector('.table-wrap')?.addEventListener('keydown', (e) => {
    if (e.isComposing || e.altKey) return;
    const td = e.target?.closest?.('tbody tr.entity-row > td[tabindex="0"]');
    if (!td || e.target !== td) return;
    const slash = e.key === '/' && !e.metaKey && !e.ctrlKey;
    const find = (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f';
    if (!slash && !find) return;
    e.preventDefault(); e.stopPropagation();
    openTableSearch(main);
  }, true);
}

const listCore = globalThis.weaveListCore;
const isListLayout = (db) => !!db.view && !db.view.blank && db.view.layout === 'list';
function listSetup(db) {
  const v = db.view ?? {};
  const fieldOf = (n) => (n ? db.fields.find((f) => f.name === n) : null) ?? null;
  const levels = (v.group ?? []).map((l) => {
    const f = fieldOf(l.field);
    return f && listCore.groupable(f) ? { ...listCore.levelDefaults(f.type), ...l, f } : null;
  }).filter(Boolean);
  const shown = new Set(db.columns ?? []);
  const dates = db.fields.filter((f) => f.type === 'date');
  return {
    levels,
    completedBy: fieldOf(v.completedBy),
    nest: fieldOf(v.nest),
    chip: viewFieldOf(db, 'chip'),
    dateField: dates.find((f) => shown.has(f.name)) ?? dates[0] ?? null,
  };
}
const listBoolKey = (f, on) => ({
  key: String(on),
  label: f.type === 'toggle' ? (on ? f.on : f.off) : (on ? f.name : `Not ${f.name.toLowerCase()}`),
  value: on,
});
function listKeys(level, item) {
  const f = level.f;
  if (f.type === 'relation') {
    const v = item.fields?.[f.name];
    return (Array.isArray(v) ? v : v ? [v] : []).filter((x) => x?.id).map((x) => ({ key: x.id, label: x.name || `#${x.publicId}`, value: x.id, summary: x }));
  }
  if (f.type === 'date') { const b = listCore.dateBucket(item.raw?.[f.name], level.grain); return b ? [b] : []; }
  if (f.type === 'checkbox' || f.type === 'toggle') return [listBoolKey(f, !!item.raw?.[f.name])];
  const v = item.fields?.[f.name];
  return (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []).map((n) => ({ key: String(n), label: String(n), value: String(n) }));
}
function listDomain(level, targets, items) {
  const f = level.f;
  if (f.type === 'relation') return (targets ?? []).map((t) => ({ key: t.id, label: t.name || `#${t.publicId}`, value: t.id, summary: t }));
  if (f.type === 'select' || f.type === 'multiselect') return (f.options ?? []).map((n) => ({ key: n, label: n, value: n }));
  if (f.type === 'workflow') return (f.states ?? []).map((st) => ({ key: st.name, label: st.name, value: st.name }));
  if (f.type === 'checkbox' || f.type === 'toggle') return [listBoolKey(f, false), listBoolKey(f, true)];
  const seen = new Map();
  for (const it of items) for (const k of listKeys(level, it)) seen.set(k.key, k);
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
}
async function listTargetRows(f) {
  const target = allTables().find((t) => t.id === f.targetDbId);
  if (!target) return [];
  const chip = viewFieldOf(target, 'chip');
  const first = target.views?.[0];
  const sort = (first?.sort ?? []).length ? first.sort : null;
  const res = await api('POST', `/tables/${target.id}/query`, { fields: chip ? [chip.name] : [], ...(sort ? { sort } : {}), limit: 500 });
  const rows = res.items.map((it) => ({ id: it.id, publicId: it.publicId, name: it.name, db: target.qualified ?? target.name, chip: chip ? it.raw?.[chip.name] ?? null : null }));
  if (sort || !first?.order?.length) return rows;
  const at = new Map(first.order.map((p, i) => [p, i]));
  return rows.map((r, i) => ({ r, i })).sort((a, b) => (at.get(a.r.publicId) ?? Infinity) - (at.get(b.r.publicId) ?? Infinity) || a.i - b.i).map((x) => x.r);
}
async function readAndDrawList(db, dbId, search) {
  const s = listSetup(db);
  const where = filterWhere(db);
  const sort = gridSort(db);
  const names = [nameFieldOf(db)?.name, s.chip?.name, ...s.levels.map((l) => l.f.name), s.completedBy?.name, s.nest?.name, s.dateField?.name,
    ...(sort ?? []).map((x) => x.field).filter((n) => db.fields.some((f) => f.name === n))].filter(Boolean);
  const base = { fields: [...new Set(names)], relations: 'chip' };
  const filtered = !!(where || search);
  const [result, everyone, domains] = await Promise.all([
    api('POST', `/tables/${db.id}/query`, { ...base, ...(where ? { where } : {}), ...(sort ? { sort } : {}), ...(search ? { search } : {}), trashCount: true, countAll: true }).then((r) => graftChips(db, r)),
    filtered && (s.nest || !sort) ? api('POST', `/tables/${db.id}/query`, base).then((r) => graftChips(db, r).items) : null,
    Promise.all(s.levels.map((l) => (l.f.type === 'relation' && l.f.targetDbId ? listTargetRows(l.f).catch(() => []) : null))),
  ]);
  if (tableSearch.dbId === dbId && tableSearch.text.trim() !== search) return;
  tableSearch.only = search && result.total === 1 ? result.items[0]?.id ?? null : null;
  setFilterTotal(db, result.total, result.all);
  drawDatabase(db, result.items, result.trashCount ?? 0, null, { setup: s, all: result.all ?? result.total, everyone, domains, filtered, sorted: !!sort });
}
let listWrites = Promise.resolve();
function listViewWrite(db, patch) {
  listWrites = listWrites.catch(() => {}).then(() => api('PATCH', `/tables/${db.id}/views/${encodeURIComponent(db.view.id)}`, patch))
    .then(() => loadSchema()).catch((err) => toast(err.message, true));
  return listWrites;
}
function listLevelValue(level, item, from, to) {
  const f = level.f;
  if (f.type === 'checkbox' || f.type === 'toggle') return to.value === true || to.key === 'true';
  if (f.type === 'date') return to.key === '' ? null : to.value;
  if (f.type === 'relation' || f.type === 'multiselect') {
    const cur = f.type === 'relation'
      ? (Array.isArray(item?.fields?.[f.name]) ? item.fields[f.name] : item?.fields?.[f.name] ? [item.fields[f.name]] : []).map((x) => x.id)
      : (item?.fields?.[f.name] ?? []);
    const many = f.type === 'multiselect' || f.many;
    if (!many) return to.key === '' ? [] : [to.value];
    const kept = cur.filter((x) => x !== from?.value);
    return to.key === '' ? kept : [...new Set([...kept, to.value])];
  }
  return to.key === '' ? null : to.value;
}
function listPathValues(s, path, item = null, from = null) {
  const values = {};
  const changed = from ? listCore.changedLevels(from, path) : path.map((_, i) => i);
  for (const i of changed) {
    const level = s.levels[i];
    if (!level || !path[i]) continue;
    if (!from && path[i].key === '') continue;
    values[level.f.name] = listLevelValue(level, item, from?.[i], path[i]);
  }
  return values;
}
function renderList(main, db, items, ctx) {
  const { setup: s, all, everyone, domains, filtered, sorted } = ctx;
  const v = db.view;
  const parentOf = (it) => {
    if (!s.nest) return null;
    const p = it?.fields?.[s.nest.name];
    return (Array.isArray(p) ? p[0] : p)?.id ?? null;
  };
  const rowOf = (it, extra = {}) => ({
    id: it.id, keys: s.levels.map((l) => listKeys(l, it)), parent: parentOf(it),
    done: s.completedBy ? !!it.raw?.[s.completedBy.name] : false, item: it, ...extra,
  });
  const rows = items.map((it) => rowOf(it));
  const known = new Map((everyone ?? items).map((it) => [it.id, it]));
  if (s.nest && everyone) {
    const have = new Set(rows.map((r) => r.id));
    for (const r of [...rows]) {
      const seen = new Set();
      for (let p = r.parent; p && !have.has(p) && !seen.has(p) && known.has(p); p = parentOf(known.get(p))) {
        seen.add(p);
        have.add(p);
        rows.push(rowOf(known.get(p), { keys: r.keys, done: false, ghost: true }));
      }
    }
  }
  const byPid = new Map([...known.values(), ...items].map((it) => [it.publicId, it.id]));
  const manual = sorted ? null : (v.order ?? []).map((p) => byPid.get(p)).filter(Boolean);
  const levels = s.levels.map((l, i) => ({ order: l.order, domain: listDomain(l, domains?.[i], items), nullLabel: `No ${l.f.name}` }));
  const arranged = listCore.arrange(rows, { levels, completedBy: !!s.completedBy, nest: !!s.nest, manual, showEmpty: !filtered });
  const everyRow = (everyone ?? items).map((it) => ({ id: it.id }));
  const effective = () => listCore.applyManual(everyRow, manual).map((r) => r.id);
  let collapsed = Array.isArray(v.collapsed) ? [...v.collapsed] : undefined;

  const reload = async (focusId = null) => {
    await keepScroll(() => showDatabase(db.id, db.view.id));
    if (focusId) document.querySelector(`#main .list-row[data-eid="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
  };
  const write = async (it, values, order = null, focusId = it?.id) => {
    const release = gridHold();
    try {
      if (it && Object.keys(values).length) await api('PATCH', `/entities/${it.id}`, { values });
      if (order) await listViewWrite(db, { order });
      await reload(focusId);
    } catch (err) { toast(err.message, true); } finally { release(); }
  };
  const fold = (sec, key) => {
    collapsed = listCore.toggleCollapsed(collapsed, key);
    const shut = listCore.isCollapsed(collapsed, key);
    sec.classList.toggle('shut', shut);
    sec.querySelector(':scope > .list-group-head .list-fold')?.setAttribute('aria-expanded', String(!shut));
    v.collapsed = collapsed;
    listViewWrite(db, { collapsed });
  };
  const headingEl = (depth, node) => {
    const level = s.levels[depth];
    const f = level?.f;
    if (f && level.heading === 'chip' && node.value !== '' && f.type === 'relation') {
      const summary = node.path[node.path.length - 1]?.summary ?? { id: node.value, name: node.label };
      const chip = relationChipEl(f, summary);
      const caret = chip.querySelector('.mention-caret');
      if (caret) { chip.classList.add('open'); caret.setAttribute('aria-expanded', 'true'); }
      return el('span', { class: 'list-group-chip' }, chip);
    }
    let hue = 'slate';
    if (f?.type === 'select' || f?.type === 'multiselect') hue = (f.optionsFull ?? []).find((o) => o.name === node.label)?.hue || 'slate';
    if (f?.type === 'workflow') { const st = f.states?.find((x) => x.name === node.label); if (st) hue = chipCore.stateHue(st, st.category); }
    return el('span', { class: `list-group-label hue-${hue}` + (node.value === '' ? ' is-none' : '') }, el('span', { class: 'list-dot', 'aria-hidden': 'true' }), node.label);
  };
  const rowEls = (item, path) => {
    const r = item.row;
    const it = r.item;
    const raw = s.chip ? it.raw?.[s.chip.name] : null;
    const chipV = raw && typeof raw === 'object' ? raw : { id: it.id, publicId: it.publicId, name: it.name, link: false, state: null, fields: [] };
    const segs = viewCore.viewSegments(chipV);
    const box = s.completedBy && !r.ghost ? el('input', {
      type: 'checkbox', class: 'form-check-input list-check', 'aria-label': `${s.completedBy.name}: ${it.name || `#${it.publicId}`}`,
      ...(r.done ? { checked: '' } : {}),
      onchange: (e) => write(it, { [s.completedBy.name]: e.target.checked }),
    }) : (s.completedBy ? el('span', { class: 'list-check-gap', 'aria-hidden': 'true' }) : null);
    const grip = el('button', {
      class: 'list-grip', type: 'button', tabindex: '-1', 'aria-label': `Move ${it.name}`,
      title: sorted ? 'Sorted: drag into another group, or sideways to nest' : 'Drag to reorder; sideways to nest',
    }, lucideEl('grip-vertical'));
    const line = el('div', {
      class: 'list-row' + (r.ghost ? ' ghost' : '') + (r.done ? ' done' : ''), role: 'listitem',
      tabindex: r.ghost ? '-1' : '0', dataset: { eid: it.id, depth: String(item.depth) }, style: `--depth:${item.depth}`,
      ...(r.ghost ? { title: 'Shown for its matching sub-rows; the filter leaves it out' } : {}),
    }, grip, box,
      el('span', { class: 'list-chip' },
        el('a', { class: 'list-title', href: `#/entity/${it.id}`, tabindex: '-1' }, viewCore.viewTitle(chipV) || `#${it.publicId}`),
        segs.length ? el('span', { class: 'list-segs' }, ...segs.map(viewSegmentEl)) : null));
    line.wvPath = path;
    line.wvItem = item;
    if (!r.ghost) grip.addEventListener('pointerdown', (e) => listDrag(e, line));
    return [line, ...item.children.flatMap((c) => rowEls(c, path))];
  };
  const addEl = (path) => {
    const where = path.map((p) => p.label).join(listCore.SEP);
    const name = el('input', { class: 'form-control form-control-sm list-add-name', placeholder: `Add ${db.term.singular}`, 'aria-label': `Add ${db.term.singular}${where ? ` to ${where}` : ''}` });
    const date = s.dateField ? el('input', { class: 'form-control form-control-sm list-add-date', placeholder: s.dateField.name, 'aria-label': `${s.dateField.name}: today, fri, oct 12` }) : null;
    const form = el('form', { class: 'list-add', dataset: { key: where } }, lucideEl('plus'), name, date);
    form.wvPath = path;
    form.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      form.requestSubmit();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = name.value.trim();
      if (!text) return;
      const values = { ...filterSeed(db), ...listPathValues(s, path) };
      if (date?.value.trim()) {
        const day = parseNaturalDate(date.value);
        if (!day) { toast(`“${date.value}” is not a date weave can read: try today, fri, oct 12 or 2026-10-12`, true); date.focus(); return; }
        values[s.dateField.name] = day;
      }
      const release = gridHold();
      try {
        await api('POST', `/tables/${db.id}/entities`, { name: text, values });
        await keepScroll(() => showDatabase(db.id, db.view.id));
        document.querySelector(`#main .list-add[data-key="${CSS.escape(where)}"] .list-add-name`)?.focus({ preventScroll: true });
      } catch (err) { toast(err.message, true); } finally { release(); }
    });
    return form;
  };
  const groupEl = (node, depth) => {
    const shut = listCore.isCollapsed(collapsed, node.key);
    const sec = el('section', { class: 'list-group' + (shut ? ' shut' : ''), dataset: { key: node.key, depth: String(depth) }, 'aria-label': node.key });
    const body = node.groups
      ? node.groups.map((g) => groupEl(g, depth + 1))
      : [...node.items.flatMap((i) => rowEls(i, node.path)), addEl(node.path)];
    sec.append(
      el('div', { class: 'list-group-head', style: `--level:${depth}` },
        el('button', { class: 'list-fold', type: 'button', 'aria-expanded': String(!shut), 'aria-label': `Fold ${node.key}`, onclick: () => fold(sec, node.key) }, lucideEl('chevron-right')),
        headingEl(depth, node),
        el('span', { class: 'list-count' }, String(node.count))),
      el('div', { class: 'list-group-body' }, ...body));
    sec.wvPath = node.path;
    sec.wvItems = node.items ?? null;
    return sec;
  };
  const list = el('div', { class: 'wv-list', role: 'list', 'aria-label': `${db.name} · ${v.name}` });
  if (arranged.groups) list.append(...arranged.groups.map((g) => groupEl(g, 0)));
  else { list.append(...arranged.items.flatMap((i) => rowEls(i, [])), addEl([])); list.wvItems = arranged.items; list.wvPath = []; }
  if (arranged.completed?.count) {
    const c = arranged.completed;
    const shut = listCore.isCollapsed(collapsed, c.key);
    const sec = el('section', { class: 'list-group list-completed' + (shut ? ' shut' : ''), dataset: { key: c.key, depth: '0' }, 'aria-label': c.key });
    sec.append(
      el('div', { class: 'list-group-head', style: '--level:0' },
        el('button', { class: 'list-fold', type: 'button', 'aria-expanded': String(!shut), 'aria-label': `Fold ${c.key}`, onclick: () => fold(sec, c.key) }, lucideEl('chevron-right')),
        el('span', { class: 'list-group-label' }, c.label),
        el('span', { class: 'list-count' }, String(c.count))),
      el('div', { class: 'list-group-body' }, ...c.items.flatMap((i) => rowEls(i, null))));
    sec.wvItems = c.items;
    list.append(sec);
  }
  const footer = el('div', { class: 'list-footer', role: 'status', 'aria-live': 'polite' },
    listCore.footerText({ shown: arranged.shown, all, done: s.completedBy ? arranged.done : null, term: db.term }));
  const wrap = el('div', { class: 'card list-wrap', dataset: { density: gridDensity(db), layout: 'list' } }, list, footer);
  wrap.wvSetDensity = (mode) => { wrap.dataset.density = mode; saveGridDensity(db, mode); };
  main.append(wrap);

  const siblingsOf = (line) => {
    const holder = line.closest('.list-group') ?? list;
    return listCore.locate(holder.wvItems ?? [], line.dataset.eid);
  };
  const renest = (line, parentId) => {
    const item = line.wvItem.row.item;
    const order = sorted ? null : parentId ? listCore.moveInOrder(effective(), item.id, parentId, true) : null;
    return write(item, { [s.nest.name]: parentId ? [parentId] : [] }, order);
  };
  list.addEventListener('keydown', (e) => {
    const line = e.target.closest?.('.list-row');
    if (!line || e.target !== line) return;
    const visible = () => [...list.querySelectorAll('.list-row[tabindex="0"]')].filter((x) => x.offsetParent);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = visible();
      const at = all.indexOf(line);
      if (e.altKey && !sorted) {
        const hit = siblingsOf(line);
        const to = hit?.siblings[hit.index + (e.key === 'ArrowUp' ? -1 : 1)];
        if (to) write(line.wvItem.row.item, {}, listCore.moveInOrder(effective(), line.dataset.eid, to.row.id, e.key === 'ArrowDown'));
        return;
      }
      all[at + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openEntity(line.dataset.eid);
    } else if (e.key === ' ' && s.completedBy) {
      e.preventDefault();
      line.querySelector('.list-check')?.click();
    } else if (e.key === 'Tab' && s.nest) {
      const hit = siblingsOf(line);
      if (!hit) return;
      if (!e.shiftKey && hit.index > 0) { e.preventDefault(); renest(line, hit.siblings[hit.index - 1].row.id); }
      if (e.shiftKey && hit.parent) {
        e.preventDefault();
        const up = hit.parent.row.parent && known.has(hit.parent.row.parent) ? hit.parent.row.parent : null;
        renest(line, up);
      }
    }
  });

  function listDrag(down, line) {
    if (down.button !== 0) return;
    const inside = (row) => line.wvItem.children.some(function walk(c) { return c.row.id === row.dataset.eid || c.children.some(walk); });
    const depth0 = line.style.getPropertyValue('--depth');
    const modeOf = (p, start) => {
      const dx = p.x - start.x;
      return s.nest && dx > 40 ? 'nest' : s.nest && dx < -40 ? 'unnest' : 'move';
    };
    const resolve = ({ node, before, point, start }) => {
      const mode = modeOf(point, start);
      const target = node.classList.contains('list-row') ? node : null;
      const sec = node.closest('.list-group:not(.list-completed)');
      if (!target && !sec) return null;
      let above = target?.previousElementSibling;
      while (above && (above === line || inside(above) || !above.classList.contains('list-row'))) above = above.previousElementSibling;
      return { target, sec, after: target ? !before : true, mode, above };
    };
    RO().guard(down.currentTarget);
    RO().sortable(down, {
      source: line,
      items: () => [...list.querySelectorAll('.list-row, .list-add')],
      members: () => [line, ...[...list.querySelectorAll('.list-row')].filter((r) => r !== line && inside(r))],
      tail: (n) => n.classList.contains('list-add'),
      zone: () => list,
      onPlace: (placed) => {
        const mode = modeOf(placed.point, placed.start);
        const base = Number(placed.node.dataset.depth ?? 0);
        line.style.setProperty('--depth', String(Math.max(0, base + (mode === 'nest' ? 1 : mode === 'unnest' ? -1 : 0))));
      },
      onCancel: () => line.style.setProperty('--depth', depth0),
      onDrop: (placed) => {
        const drop = resolve(placed);
        if (drop) commit(drop);
      },
    });
    const commit = ({ target, sec, after, mode, above }) => {
      const item = line.wvItem.row.item;
      const from = line.wvPath;
      const to = target?.wvPath ?? sec?.wvPath ?? [];
      const values = from ? listPathValues(s, to, item, from) : listPathValues(s, to, item, to.map(() => ({ key: null })));
      if (!from && s.completedBy) values[s.completedBy.name] = false;
      let order = null;
      if (s.nest) {
        const own = line.wvItem.row.parent;
        let parent = own;
        if (mode === 'nest' && target) {
          const anchor = after ? target : above;
          parent = anchor && anchor !== line ? anchor.dataset.eid : own;
        } else if (mode === 'unnest') {
          parent = own && known.has(own) ? parentOf(known.get(own)) : null;
        } else if (target) parent = target.wvItem.row.parent && target.wvItem.row.parent !== item.id ? target.wvItem.row.parent : null;
        if (parent !== own) values[s.nest.name] = parent ? [parent] : [];
      }
      if (!sorted && target) order = listCore.moveInOrder(effective(), item.id, target.dataset.eid, after);
      if (!Object.keys(values).length && !order) return;
      write(item, values, order);
    };
  }
}
function groupFieldOptions(db, { dates = true } = {}) {
  return db.fields.filter((f) => listCore.groupable(f) && (dates || f.type !== 'date'))
    .map((f) => ({ id: f.name, label: f.name, hint: f.type === 'relation' ? 'link' : f.type }));
}
const LEVEL_ORDERS = { option: 'Option order', table: 'Table order', az: 'A to Z' };
function groupPopoverRows(db, close, save) {
  const v = db.view ?? {};
  const levels = (v.group ?? []).map((l) => ({ ...l }));
  const fieldOf = (n) => db.fields.find((f) => f.name === n);
  const options = groupFieldOptions(db);
  const writeLevels = (next) => save({ group: next });
  const box = el('div', { class: 'group-levels' });
  levels.forEach((l, i) => {
    const f = fieldOf(l.field);
    const d = { ...listCore.levelDefaults(f?.type), ...l };
    const put = (patch) => { const next = levels.map((x) => ({ ...x })); next[i] = { ...next[i], ...patch }; writeLevels(next); };
    const fieldSel = pickerSelect({ name: `group-${i}`, title: `Level ${i + 1}`, value: l.field,
      options: options.filter((o) => o.id === l.field || !levels.some((x) => x.field === o.id)) });
    fieldSel.classList.add('group-field');
    fieldSel.input.addEventListener('change', () => { const next = levels.map((x) => ({ ...x })); next[i] = { field: fieldSel.input.value }; writeLevels(next); });
    const heading = f?.type === 'relation'
      ? segCtl([{ id: 'label', label: 'Label' }, { id: 'chip', label: 'Chip', title: "The linked row's Chip heads the group" }], d.heading, (h) => put({ heading: h }))
      : null;
    heading?.classList.add('group-heading');
    let orderSel = null;
    if (f && f.type !== 'date') {
      orderSel = pickerSelect({ name: `order-${i}`, title: 'Group order', value: d.order,
        options: (f.type === 'relation' ? ['table', 'az'] : ['option', 'az']).map((id) => ({ id, label: LEVEL_ORDERS[id] })) });
      orderSel.classList.add('group-order');
      orderSel.input.addEventListener('change', () => put({ order: orderSel.input.value }));
    }
    let grainSel = null;
    if (f?.type === 'date') {
      grainSel = pickerSelect({ name: `grain-${i}`, title: 'Grain', value: d.grain, options: listCore.GRAINS.map((g) => ({ id: g, label: `By ${g}` })) });
      grainSel.classList.add('group-grain');
      grainSel.input.addEventListener('change', () => put({ grain: grainSel.input.value }));
    }
    const grip = el('button', { class: 'view-grip group-grip', type: 'button', 'aria-label': `Reorder ${l.field}`, title: 'Drag to reorder levels' }, lucideEl('grip-vertical'));
    const row = el('div', { class: 'group-level', dataset: { level: l.field } },
      grip, el('span', { class: 'group-level-n' }, String(i + 1)), fieldSel, heading, orderSel, grainSel,
      el('button', { class: 'btn btn-sm btn-icon btn-ghost-secondary group-remove', type: 'button', 'aria-label': `Remove ${l.field}`, title: 'Remove level',
        onclick: () => writeLevels(levels.filter((_, k) => k !== i)) }, lucideEl('x')));
    RO().guard(grip);
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      startRowDrag(box, row, e, (target, after) => {
        const rest = levels.filter((x) => x.field !== l.field);
        const at = rest.findIndex((x) => x.field === target);
        if (target === l.field || at < 0) return;
        rest.splice(at + (after ? 1 : 0), 0, l);
        writeLevels(rest);
      }, { rows: '.group-level', key: (r) => r.dataset.level });
    });
    box.append(row);
  });
  const left = options.filter((o) => !levels.some((x) => x.field === o.id));
  const add = el('button', { class: 'chip-pop-row group-add', type: 'button', ...(levels.length >= listCore.GROUP_CAP || !left.length ? { disabled: '' } : {}) },
    lucideEl('plus'), levels.length ? 'Add level' : 'Group by…');
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    searchPicker({ anchor: add, title: 'Group by', options: left, onPick: (o) => writeLevels([...levels, { field: o.id }]) });
  });
  const pick = (name, label, value, fields) => {
    const sel = pickerSelect({ name, title: label, value: value ?? '', placeholder: 'None',
      options: [{ id: '', label: 'None' }, ...fields.map((f) => ({ id: f.name, label: f.name }))] });
    sel.classList.add(`group-${name}`);
    return sel;
  };
  const doneSel = pick('completed', 'Completed by', v.completedBy, db.fields.filter((f) => f.type === 'checkbox' || f.type === 'toggle'));
  doneSel.input.addEventListener('change', () => save({ completedBy: doneSel.input.value || null }));
  const nestSel = pick('nest', 'Nest by', v.nest, db.fields.filter((f) => f.type === 'relation' && f.targetDbId === db.id && !f.many));
  nestSel.input.addEventListener('change', () => save({ nest: nestSel.input.value || null }));
  const list = v.layout === 'list';
  return [
    tableControlHeader('Group', close),
    box, add,
    el('hr'),
    el('div', { class: 'eye-head' }, 'Rows'),
    el('label', { class: 'group-pref' }, el('span', {}, 'Completed by'), doneSel),
    el('label', { class: 'group-pref' }, el('span', {}, 'Nest by'), nestSel),
    list ? el('p', { class: 'table-control-note' }, 'Saved in this view. A sort orders rows inside each group; with no sort, drag sets the order.')
      : el('p', { class: 'table-control-note group-table-note' }, 'Table layout keeps these and ignores them for now. ',
        el('button', { class: 'btn btn-sm btn-ghost-primary tiny group-show-list', type: 'button', onclick: () => save({ layout: 'list' }) }, 'Show as list')),
  ];
}
function tableGroupButton(ref) {
  const btn = tableControlButton('table-group-btn', 'Group', 'layers');
  btn.label = () => {
    const names = (ref.db.view?.group ?? []).map((l) => l.field);
    const text = names.length ? `Group: ${names.join(listCore.SEP)}` : 'Group';
    if (btn.querySelector('.table-control-label').textContent !== text) btn.querySelector('.table-control-label').textContent = text;
    btn.setAttribute('aria-label', text);
    btn.hidden = !isListLayout(ref.db);
  };
  btn.label();
  btn.addEventListener('click', () => {
    let pop;
    const save = async (patch) => {
      const db = ref.db;
      const release = gridHold();
      try {
        if (await gridConfigWrite(db, null, patch)) await showDatabase(db.id, db.view?.id);
      } catch (err) { toast(err.message, true); } finally { release(); }
    };
    const rows = (db) => groupPopoverRows(db, () => pop?.remove(), save);
    pop = tableControlPopover(btn, ref.db, 'table-group-popover', rows(ref.db));
    if (pop) pop.refresh = (db) => { pop.replaceChildren(...rows(db)); pop.reposition?.(); };
  });
  return btn;
}

function eyeGlyph() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  return svg;
}

let eyeWrites = Promise.resolve();
const eyeTails = new Map();
let eyeGestures = 0;
function eyeGesture(hold) {
  eyeGestures++;
  let done = false;
  return () => { if (done) return; done = true; eyeGestures--; hold(); };
}
function showSwitch(node, on = node.getAttribute('aria-checked') !== 'true') {
  node.setAttribute('aria-checked', on ? 'true' : 'false');
  node.querySelector('.switch')?.classList.toggle('on', on);
}

function fieldVisibilityPopover(anchor, db, trashCount = 0, { redraw = null, rowsSection = true } = {}) {
  if (db.view && rowsSection) return tableFieldsPopover(anchor, db, trashCount);
  const row = (on, label, run) => el('button', {
    class: 'chip-pop-row eye-row', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false',
    onclick: (e) => { e.stopPropagation(); showSwitch(e.currentTarget); run(); },
  }, el('span', { class: 'eye-label' }, label), el('span', { class: 'switch' + (on ? ' on' : '') }, el('span', { class: 'switch-knob' })));
  const save = (patchOf, { hides = null } = {}) => {
    const painted = hides && home?.id === 'main' && !redraw && stillShown() && dropDrawnColumn(db.id, hides);
    const release = eyeGesture(home?.id === 'main' && !painted ? gridHold() : () => {});
    const turn = eyeWrites.then(async () => {
      const patch = patchOf(liveTable());
      if (patch.view) await gridConfigWrite(db, null, patch.view);
      else { await api('PATCH', `/tables/${db.id}`, patch); await loadSchema(); }
    }).catch((err) => toast(err.message, true));
    eyeWrites = turn;
    eyeTails.set(db.id, turn);
    turn.then(async () => {
      try {
        if (eyeTails.get(db.id) !== turn) return;
        eyeTails.delete(db.id);
        if (painted && drawnMatches(liveTable())) {
          const open = document.querySelector('.chip-pop');
          if (open?.eyeOf === db.id) open.relearnEye();
        } else await paint();
      } finally { release(); }
    });
  };
  const home = anchor.closest('#main, #dock');
  const pageOf = (r) => (r?.page === 'db' ? `db:${r.dbId}` : r?.page === 'entity' ? `entity:${r.id}` : r?.page);
  const openedOn = pageOf(state.route);
  const stillShown = () => home?.id !== 'main' || pageOf(state.route) === openedOn;
  const paint = async () => {
    try {
      if (stillShown()) redraw ? await redraw() : await keepScroll(() => showDatabase(db.id, state.route.view));
      if (dock && dock.db.id === db.id) {
        dock.db = allTables().find((d) => d.id === db.id) ?? dock.db;
        if (redraw !== drawDock) await drawDock();
        else if (state.route?.page === 'db' && state.route.dbId === db.id) {
          await keepScroll(() => showDatabase(db.id, state.route.view));
        }
      }
      const pop = document.querySelector('.chip-pop');
      if (pop?.eyeOf === db.id) pop.relearnEye();
    } catch (err) { toast(err.message, true); }
  };
  const liveTable = () => {
    const raw = allTables().find((d) => d.id === db.id) ?? db;
    return db.view ? viewed(raw, db.view.blank ? blankView(raw) : (raw.views ?? []).find((v) => v.id === db.view.id) ?? db.view) : raw;
  };
  const buildRows = (cur) => {
    const hidden = new Set(cur.hiddenFields ?? []);
    const sysOn = new Set(cur.columns ? cur.columns.filter((n) => SYSTEM_COLS[n] && !colField(cur, n)) : cur.systemFields ?? []);
    const listed = (allTables().find((d) => d.id === cur.id) ?? cur).fields;
    return [
      el('div', { class: 'eye-head' }, 'Fields'),
      ...listed.map((f) => row(!hidden.has(f.name), f.name, () => save((t) => {
        const next = new Set(t.hiddenFields ?? []);
        if (db.view) return { view: { [next.has(f.name) ? 'show' : 'hide']: [f.name] } };
        if (next.has(f.name)) next.delete(f.name); else next.add(f.name);
        return { hiddenFields: [...next] };
      }, { hides: visibleCols(liveTable()).includes(f.name) ? f.name : null }))),
      el('div', { class: 'eye-head' }, 'System'),
      ...Object.keys(SYSTEM_COLS).map((n) => row(sysOn.has(n), n, () => save((t) => {
        if (db.view) return { view: { [(t.columns ?? []).includes(n) ? 'hide' : 'show']: [n] } };
        const next = new Set(t.systemFields ?? []);
        if (next.has(n)) next.delete(n); else next.add(n);
        return { systemFields: [...next] };
      }))),
      ...(rowsSection ? [
        el('div', { class: 'eye-head' }, 'Rows'),
        row(state.showDeleted.has(cur.id), `Deleted ${cur.term.plural}${trashCount ? ` (${trashCount})` : ''}`, () => {
          if (state.showDeleted.has(cur.id)) state.showDeleted.delete(cur.id); else state.showDeleted.add(cur.id);
          document.querySelector('.chip-pop')?.remove();
          keepScroll(() => showDatabase(cur.id, state.route.view));
        }),
        ...(cur.system ? [] : [row(cur.hideRollups === false, 'Σ rollup row', () => save((t) => ({ hideRollups: t.hideRollups === false })))]),
      ] : []),
    ];
  };
  const pop = showPopover(anchor, buildRows(db), { owns: (t) => t.closest?.('.eye-btn')?.closest('#main, #dock') === home });
  pop.eyeOf = db.id;
  pop.relearnEye = () => {
    const wasFocused = document.activeElement?.closest?.('.eye-row')?.querySelector('.eye-label')?.textContent ?? null;
    relearnRows(pop, buildRows(liveTable()), (p) => {
      if (wasFocused != null) [...p.querySelectorAll('.eye-row')].find((r) => r.querySelector('.eye-label')?.textContent === wasFocused)?.focus();
    });
  };
}

function dropDrawnColumn(dbId, name) {
  const drawn = $('#main')?.wvDraw;
  if (!drawn || drawn.db.id !== dbId || !visibleCols(drawn.db).includes(name)) return false;
  if (!drawn.db.columns && !colField(drawn.db, name)) return false;
  const db = drawn.db.columns
    ? { ...drawn.db, columns: drawn.db.columns.filter((n) => n !== name) }
    : { ...drawn.db, hiddenFields: [...(drawn.db.hiddenFields ?? []), name] };
  keepScroll(() => drawDatabase(db, drawn.items, drawn.trashCount, drawn.pager)).catch((err) => toast(err.message, true));
  return true;
}
function drawnMatches(db) {
  const drawn = $('#main')?.wvDraw?.db;
  return !!drawn && drawn.id === db.id
    && String(visibleCols(drawn)) === String(visibleCols(db))
    && (drawn.view?.frozen ?? 0) === (db.view?.frozen ?? 0)
    && String(drawn.systemFields ?? []) === String(db.systemFields ?? []);
}

function visibleCols(db) {
  if (db.columns) return [...db.columns];
  const hidden = new Set(db.hiddenFields ?? []);
  return db.fields.filter((f) => !hidden.has(f.name)).map((f) => f.name);
}

let GRID_SEQ = 0;
function renderTable(main, db, items, onSaved, onAdd = null, pager = null) {
  adoptLegacyDensity(db);
  let cols = visibleCols(db);
  const isSysCol = (c) => !colField(db, c) && !!SYSTEM_COLS[c];
  const sysTail = db.columns ? [] : (db.systemFields ?? []);
  const cellBox = (...kids) => el('div', { class: 'wv-cb' }, ...kids);
  const sysValue = (n, item) => el('span', { class: 'wv-cb-text' }, SYSTEM_COLS[n]?.(item) ?? '');
  const sysCell = (n, item) => el('td', { class: 'cell-computed sys-cell', dataset: { sys: n } }, cellBox(sysValue(n, item)));
  const colCount = cols.length + 3;
  let sortKey = db.sort?.[0]?.field ?? null, sortDir = db.sort?.[0]?.dir === 'desc' ? -1 : 1;
  const wrap = el('div', { class: 'card table-wrap' });
  let fitFrame = 0;
  const refit = () => {
    fitFrame = 0;
    if (!wrap.isConnected) return;
    const fit = wrap.scrollWidth <= wrap.clientWidth + 1;
    wrap.classList.toggle('wv-fit', fit);
    wrap.classList.toggle('wv-overflow-x', !fit);
    wrap.classList.toggle('wv-grid-scroll', !fit && state.route?.page === 'db');
    fitGridScroller(wrap);
    settle();
    rewindow();
  };
  const fitWatch = new ResizeObserver(() => { fitFrame ||= requestAnimationFrame(refit); });

  const SEL = () => globalThis.WeaveSelection;
  let repaintRange = () => {};
  const chosen = () => state.selected.get(db.id) ?? new Set();
  let anchor = null;
  const drawnIds = () => [...wrap.querySelectorAll('tbody tr.entity-row')].map((r) => r.dataset.eid);
  let sortedItems = items;
  const ordered = () => (pager ? pager.rows : sortedItems);
  const total = () => ordered().length;
  const itemAt = (i) => ordered()[i] ?? null;
  const itemOf = (id) => ordered().find((x) => x && x.id === id) ?? null;
  const loadedIds = () => ordered().filter(Boolean).map((x) => x.id);

  const paintSelection = () => {
    const sel = chosen();
    const table = wrap.querySelector('.wv-grid');
    if (!table) return;
    for (const row of table.querySelectorAll('tbody tr.entity-row')) {
      const on = sel.has(row.dataset.eid);
      const box = row.querySelector('.sel-box');
      if (box) box.checked = on;
      row.classList.toggle('row-selected', on);
    }
    const head = table.querySelector('thead .sel-box');
    if (head) {
      const st = SEL().headState(sel.size, loadedIds().length);
      head.checked = st === 'all';
      head.indeterminate = st === 'some';
    }
    if (sel.size) table.dataset.selecting = 'on'; else delete table.dataset.selecting;
    wrap.classList.toggle('has-selection', sel.size > 0);
    drawPuck();
  };
  const setChosen = (next) => { state.selected.set(db.id, next); paintSelection(); };
  const clearChosen = () => { anchor = null; setChosen(new Set()); };

  const onBox = (e, id) => {
    const L = SEL();
    let next;
    if (e.shiftKey && anchor && anchor !== id) {
      next = new Set(chosen());
      for (const x of L.range(drawnIds(), anchor, id)) next.add(x);
    } else {
      next = L.toggle(chosen(), id);
    }
    anchor = id;
    setChosen(next);
  };

  const BUILT = ['fields', 'link', 'dup', 'more', 'trash'];
  const MORE_BUILT = ['move', 'rollup', 'copy'];
  const CMD_ICON = { fields: 'lucide:pencil', link: 'lucide:arrow-left-right', dup: '⧉', more: 'lucide:ellipsis', trash: 'lucide:trash-2' };
  const MORE_ICON = { move: 'send', rollup: 'layers', copy: 'link' };
  const puck = el('div', { class: 'sel-puck-wrap' });

  const runOnSelection = async (verb, each, undoable = null) => {
    const ids = [...chosen()];
    const failed = [];
    for (const id of ids) {
      try { await each(id); } catch { failed.push(id); }
    }
    const done = ids.filter((id) => !failed.includes(id));
    const action = undoable && done.length ? undoable(done) : null;
    if (failed.length) toast(`${verb}: ${failed.length} of ${ids.length} failed`, true, action);
    else toast(`${verb} ${SEL().countLabel(ids.length, db.term)}`, false, action);
    clearChosen();
    await onSaved?.();
  };

  const trashChosen = async () => {
    const ids = chosen(), drawn = drawnIds();
    const last = Math.max(...[...ids].map((id) => drawn.indexOf(id)));
    const keep = (id) => !ids.has(id);
    const next = drawn.slice(last + 1).find(keep) ?? drawn.slice(0, last).reverse().find(keep) ?? null;
    const gesture = { kind: 'delete', ids: [] };
    await runOnSelection('Moved to trash', (id) => api('DELETE', `/entities/${id}`), (done) => {
      gesture.ids = done;
      lastGesture = gesture;
      return { label: 'Undo', run: () => undoGesture(gesture) };
    });
    focusGridRow(next, main);
  };

  const runBulk = async (verb, op, params) => {
    const ids = [...chosen()];
    let result;
    try { result = await api('POST', '/bulk', { ids, op, ...params }); } catch (err) { toast(err.message, true); return; }
    const t = SEL().bulkToast({ verb, count: ids.length, term: db.term, result });
    toast(t.msg, t.err);
    clearChosen();
    await onSaved?.();
  };
  const relations = () => db.fields.filter((f) => f.type === 'relation');
  const otherTables = () => allTables().filter((t) => !t.system && t.id !== db.id);
  const nRows = () => SEL().countLabel(chosen().size, db.term);
  const picker = (anchor, opts) => searchPicker({ anchor, ...opts });

  const setField = (anchor) => picker(anchor, {
    title: `Set a field on ${nRows()}`, placeholder: 'Search fields…',
    options: SEL().settableFields(db.fields).map((f) => ({ id: f.name, label: f.name, hint: f.type })),
    onPick: (o) => setValue(anchor, db.fields.find((f) => f.name === o.id)),
  });
  const setValue = (anchor, f) => {
    const write = (v) => runBulk('Set', 'set', { values: { [f.name]: v } });
    const title = `${f.name} on ${nRows()}`;
    if (f.type === 'workflow') {
      return picker(anchor, { title, placeholder: 'Search states…',
        options: f.states.map((st) => ({ id: st.name, label: stateLabel(f, st.name), cls: stateChipClass(f, st.name), chip: true })),
        onPick: (o) => write(o.id) });
    }
    if (f.type === 'select') {
      return picker(anchor, { title, placeholder: 'Search options…',
        options: [{ id: '—', label: '—' }, ...f.options.map((name) => ({ id: name, label: name, chip: true, cls: `k k-select hue-${chipCore.hueFromHex((f.optionsFull ?? []).find((x) => x.name === name)?.color)}` }))],
        onPick: (o) => write(o.id === '—' ? null : o.id) });
    }
    if (f.type === 'multiselect') {
      return picker(anchor, { title, placeholder: 'Search options…',
        options: f.options.map((name) => ({ id: name, label: name, chip: true, cls: `k k-multi hue-${chipCore.hueFromHex((f.optionsFull ?? []).find((x) => x.name === name)?.color)}` })),
        multi: { selected: [], onCommit: (ids) => write(ids) } });
    }
    if (f.type === 'checkbox') {
      return picker(anchor, { title, placeholder: 'Checked or unchecked…',
        options: [{ id: 'on', label: 'Checked' }, { id: 'off', label: 'Unchecked' }],
        onPick: (o) => write(o.id === 'on') });
    }
    if (f.type === 'toggle') {
      return picker(anchor, { title, placeholder: `${f.on} or ${f.off}…`,
        options: [{ id: 'on', label: f.on }, { id: 'off', label: f.off }],
        onPick: (o) => write(o.id === 'on') });
    }
    valuePop({ anchor, title, apply: `Set on ${nRows()}`,
      type: f.type === 'number' || f.type === 'rating' ? 'number' : f.type === 'date' ? (f.time ? 'datetime-local' : 'date') : f.type === 'url' ? 'url' : f.type === 'email' ? 'email' : 'text',
      onApply: (v) => write(v === '' ? null : v) });
  };

  const relationPicker = (anchor, title, onPick) => picker(anchor, {
    title, placeholder: 'Search relations…',
    options: relations().map((f) => ({ id: f.name, label: f.name, hint: f.targetDbs ? f.targetDbs.join(', ') : f.targetDb })),
    onPick: (o) => onPick(relations().find((f) => f.name === o.id)),
  });
  const linkTo = (anchor) => relationPicker(anchor, `Link ${nRows()} to…`, (f) => linkSearch(f, {
    commit: (add) => runBulk('Linked', 'link', { field: f.name, targets: add }),
  }));

  const MORE_CMDS = {
    move: (anchor) => picker(anchor, {
      title: `Move ${nRows()} to…`, placeholder: 'Search tables…',
      options: otherTables().map((t) => ({ id: t.id, label: t.name, hint: t.space })),
      onPick: (o) => runBulk('Moved', 'move', { table: o.id }),
    }),
    rollup: (anchor) => relationPicker(anchor, `Roll ${nRows()} up through…`, (f) => {
      const term = termOfTable(f.targetDbId);
      valuePop({ anchor, title: `New ${term.singular}`, placeholder: 'Name', apply: 'Create & link',
        onApply: (name) => runBulk('Rolled up', 'rollup', { field: f.name, name }) });
    }),
    copy: () => copyText([...chosen()].map((id) => `${location.origin}${WS_PREFIX}/e/${id}`).join('\n'),
      `${SEL().countLabel(chosen().size, db.term)} — links copied`),
  };
  const more = (anchor) => picker(anchor, {
    title: 'More', placeholder: 'Search…',
    options: moreCmds().map((c) => ({ id: c.id, label: c.label, lucide: MORE_ICON[c.id] })),
    onPick: (o) => MORE_CMDS[o.id](anchor),
  });
  const moreCmds = () => SEL().moreCommands({ built: MORE_BUILT, term: db.term, relations: relations().map((f) => f.name), otherTables: otherTables().length });

  const COMMANDS = {
    fields: setField,
    link: linkTo,
    more,
    dup: () => runOnSelection('Duplicated', async (id) => {
      const row = await api('GET', `/entities/${id}`);
      const values = { ...row.fields };
      for (const f of db.fields) {
        if (READONLY_FIELD_TYPES.includes(f.type) || f.type === 'document') delete values[f.name];
      }
      await api('POST', `/tables/${db.id}/entities`, { values });
    }),
    trash: trashChosen,
  };

  const drawPuck = () => {
    const sel = chosen();
    if (!sel.size) { puck.replaceChildren(); return; }
    const L = SEL();
    const cmds = L.barCommands({
      relations: relations().map((f) => f.name),
      writableFields: L.settableFields(db.fields).map((f) => f.name),
      built: BUILT,
      more: moreCmds(),
    });
    puck.replaceChildren(el('div', { class: 'sel-puck glass' },
      el('span', { class: 'sel-count' }, L.countLabel(sel.size, db.term)),
      ...cmds.map((c) => [
        c.danger ? el('span', { class: 'sel-sep' }) : null,
        el('button', {
          class: 'sel-act' + (c.danger ? ' danger' : ''), type: 'button',
          title: c.label, 'aria-label': c.label,
          onclick: (ev) => COMMANDS[c.id]?.(ev.currentTarget),
        }, iconEl(CMD_ICON[c.id], 'wv-icon'), el('span', { class: 'sel-tip' }, c.label)),
      ]).flat()));
  };

  addEventListener('keydown', function esc(e) {
    if (!wrap.isConnected) return removeEventListener('keydown', esc);
    if (e.key !== 'Escape' || !chosen().size) return;
    if (document.querySelector(DOCK_ESC_OWNERS)) return;
    clearChosen();
  });

  const buildRow = (item) => {
    const row = el('tr', {
      class: 'entity-row' + (item.deleted ? ' row-deleted' : ''),
      dataset: { eid: item.id, href: registryHref(db, item) ?? `#/entity/${item.id}` },
      onclick: (e) => {
        if (e.target.closest('a, button, input, select, textarea, label')) return;
        const cell = e.target.closest('td');
        if (cell) activateCell(cell);
      },
    },
      el('td', { class: 'sel-cell' }, cellBox(
        item.deleted ? null : el('label', { class: 'sel-hit' },
          el('input', {
            class: 'sel-box form-check-input', type: 'checkbox',
            'aria-label': `Select #${item.publicId}`,
            onclick: (e) => onBox(e, item.id),
          })))),
      el('td', { class: 'pid-cell' }, cellBox(
        el('a', {
          class: 'open-link',
          href: registryHref(db, item) ?? `#/entity/${item.id}`,
          title: db.system === 'tables' ? 'Open table' : db.system === 'spaces' ? 'Open space' : keyHint(`Open ${db.term.singular} beside the table — ⌘-click for a new tab`),
        }, `#${item.publicId} ↗`),
        el('span', { class: 'list-name' }, item.name ?? ''))),
      ...cols.map((c) => {
        if (isSysCol(c)) return sysCell(c, item);
        const f = db.fields.find((x) => x.name === c);
        const kind = PICKER_FIELD_TYPES.includes(f.type) ? ' cell-pick'
          : (READONLY_FIELD_TYPES.includes(f.type) && f.type !== 'document') ? ' cell-computed'
          : (f.type === 'document' && f.role !== 'description') ? ' cell-nostop' : '';
        const td = el('td', {
          dataset: { ftype: f.type, field: f.name },
          class: (isNumCell(f, item) ? 'num' : '')
            + (c === cols[0] ? ' name-cell' : '') + kind,
        }, cellBox(labeledEditorFor(f, item, db, onSaved, { compact: true, fit: true })));
        return f.type === 'attachments'
          ? fileDropZone(td, (files) => td.querySelector('.k-attach')?.dropFiles?.(files))
          : td;
      }),
      ...sysTail.map((n) => sysCell(n, item)));
    for (const td of row.querySelectorAll(':scope > td[data-field]:not(.cell-nostop)')) td.tabIndex = 0;
    for (const n of row.querySelectorAll('td :is(input, button, select, textarea, a, [tabindex])')) n.tabIndex = -1;
    return row;
  };

  const GW = () => globalThis.WeaveGridWindow;
  let table = null, tbody = null, topSpacer = null, bottomSpacer = null, loadedNote = null;
  const live = new Map();
  const built = new Map();
  const win = { start: 0, end: 0, lastTop: 0, dir: 1 };

  const CR = globalThis.WeaveColumnResize;
  const gid = `g${++GRID_SEQ}`;
  const layoutSheet = el('style', { class: 'wv-grid-layout' });
  const floors = new Map();
  const valueFloors = new Map();
  const chipWidths = new Map();
  const cellPads = new Map();
  const override = new Map();
  let frozenShown = 0;
  let lead = 0;
  let pidWidth = 0;
  let grabbed = null;
  let colShift = null;
  const nudgeTimers = new Map();
  const SYS_WIDTHS = { 'Created At': 150, 'Modified At': 150, 'Created By': 160, 'Modified By': 160, Activity: 88 };
  const canFreezeHere = () => !!db.view && !db.view.blank;
  const storedFrozen = () => (canFreezeHere() ? db.view.frozen ?? 0 : 0);
  const storedWidth = (c) => db.view?.widths?.[c] ?? colField(db, c)?.width;
  const widest = new Map();
  const widestOf = (c) => {
    const f = colField(db, c);
    if (!f || !cellGraphics.isGraphic(f.display)) return null;
    if (!widest.has(c)) {
      const scale = items.find((it) => it?.scales?.[c] != null)?.scales?.[c] ?? f.scale ?? null;
      widest.set(c, scale == null ? null : figureWidth(String(numberCore.dressNumber(f, scale))));
    }
    return widest.get(c);
  };
  const emptyDoc = (c) => colField(db, c)?.type === 'document' && items.every((it) => !String(it?.docs?.[c] ?? '').trim());
  const widthOf = (c) => override.get(c)
    ?? CR.layout([{ ...colField(db, c), name: c, pad: cellPads.get(c), stored: storedWidth(c) ?? (isSysCol(c) ? SYS_WIDTHS[c] : undefined), floor: floors.get(c), widest: widestOf(c), empty: emptyDoc(c) }])[c];
  const headOf = (c) => table?.tHead?.rows[0]?.querySelector(`th.col-head[data-col="${CSS.escape(c)}"]`) ?? null;
  const leadCount = () => {
    const head = table?.tHead?.rows[0];
    const i = head ? [...head.children].findIndex((h) => !h.classList.contains('sel-head') && !h.classList.contains('pid-head')) : -1;
    return i < 0 ? 2 : i;
  };
  const refreeze = () => {
    const n = storedFrozen();
    frozenShown = CR.frozenFit({ lead, widths: cols.slice(0, n).map(widthOf), frozen: n, viewport: wrap.clientWidth || Infinity });
  };
  const layoutCss = () => {
    const at = leadCount();
    const scope = `.wv-grid[data-gid="${gid}"]`;
    const cell = (k, section = '*') => `${scope} > ${section} > tr > :nth-child(${k}):not([colspan])`;
    const fixed = (w) => `{width:${w}px;min-width:${w}px;max-width:${w}px}`;
    const out = [];
    if (pidWidth) out.push(`${scope} > * > tr > :is(th.pid-head, td.pid-cell){min-width:${pidWidth}px}`);
    cols.forEach((c, i) => {
      out.push(cell(at + i + 1) + fixed(widthOf(c)));
      const f = colField(db, c);
      if (f?.type === 'rating' && !CR.ratingFits(widthOf(c), f.max, cellPads.get(c))) {
        out.push(`${cell(at + i + 1, 'tbody')} .wv-rating > .wv-rate-ico{display:none}`,
          `${cell(at + i + 1, 'tbody')} .wv-rating > .wv-rating-compact{display:inline-flex}`);
      }
    });
    sysTail.forEach((n, j) => out.push(cell(at + cols.length + j + 1) + fixed(Math.max(SYS_WIDTHS[n] ?? 136, floors.get(n) ?? 0))));
    let left = lead;
    for (let i = 0; i < frozenShown; i++) {
      const k = at + i + 1;
      out.push(`${cell(k)}{position:sticky;left:${left}px}`,
        `${cell(k, 'tbody')}{z-index:1;background:var(--tblr-bg-surface)}`,
        `${scope} > tbody > tr.row-selected > :nth-child(${k}):not([colspan]){background:color-mix(in srgb,var(--tblr-primary) 9%,var(--tblr-bg-surface))}`,
        `${scope} > tbody > tr.row-docked > :nth-child(${k}):not([colspan]){background:linear-gradient(var(--tblr-active-bg),var(--tblr-active-bg)) var(--tblr-bg-surface)}`,
        `${scope} > thead > tr > th:nth-child(${k}){z-index:5}`,
        `${scope} > thead > tr.wv-foot > td:nth-child(${k}){z-index:3}`);
      left += widthOf(cols[i]);
    }
    if (frozenShown) {
      const k = at + frozenShown;
      out.push(`${cell(k)}{border-right:1px solid transparent}`,
        `.table-wrap.wv-scrolled-x ${cell(k)}{border-right-color:var(--tblr-border-color)}`);
    }
    if (grabbed && cols.includes(grabbed)) out.push(`${cell(at + cols.indexOf(grabbed) + 1)}{opacity:var(--wv-source-opacity)}`);
    if (colShift) cols.forEach((c, i) => { if (colShift.get(c)) out.push(`${cell(at + i + 1)}{translate:${colShift.get(c)}px 0}`); });
    return out.join('\n');
  };
  const paintLayout = () => {
    if (!table) return;
    table.dataset.gid = gid;
    table.classList.toggle('wv-frozen-fields', frozenShown > 0);
    const css = layoutCss();
    if (layoutSheet.textContent !== css) layoutSheet.textContent = css;
  };
  const sizePidColumn = () => {
    const cell = listRows() ? table.querySelector('tbody tr.entity-row > td.pid-cell > .wv-cb') : null;
    if (!cell) return table.style.removeProperty('--wv-pid-w');
    const top = ordered().reduce((n, x) => Math.max(n, x?.publicId ?? 0), db.maxPublicId ?? 0);
    const probe = el('a', { class: 'open-link pid-probe', 'aria-hidden': 'true' }, `#${'0'.repeat(String(top).length)} ↗`);
    cell.append(probe);
    table.style.setProperty('--wv-pid-w', `${Math.ceil(probe.getBoundingClientRect().width)}px`);
    probe.remove();
  };
  const settle = () => {
    if (!table?.isConnected) return;
    sizePidColumn();
    const head = table.tHead.rows[0];
    for (const th of head.querySelectorAll('th.col-head, th.sys-head')) {
      const label = th.querySelector('.col-label');
      if (!label) continue;
      const cs = getComputedStyle(th);
      floors.set(th.dataset.col, CR.floor({
        label: label.getBoundingClientRect().width,
        padLeft: parseFloat(cs.paddingLeft) || 0, padRight: parseFloat(cs.paddingRight) || 0,
      }));
    }
    for (const c of cols) {
      const f = colField(db, c);
      if (f?.type !== 'date' || valueFloors.has(c)) continue;
      const td = table.querySelector(`:scope > tbody > tr.entity-row > td[data-field="${CSS.escape(c)}"]`);
      const input = td?.querySelector('input.date-text');
      if (!input) continue;
      const was = input.value;
      input.value = weaveDateCore.formatDate(f.time ? '2026-09-30T23:45' : '2026-09-30', { ...f, viewerZone: LOCAL_ZONE });
      const probe = cellFitProbe(td);
      input.value = was;
      const measure = el('div', { class: 'wv-measure' }, probe);
      document.body.append(measure);
      const cs = getComputedStyle(td);
      const box = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0);
      valueFloors.set(c, Math.ceil(probe.getBoundingClientRect().width + box));
      measure.remove();
    }
    for (const c of cols) {
      const f = colField(db, c);
      if (f?.type !== 'toggle') continue;
      const td = table.querySelector(`:scope > tbody > tr.entity-row > td[data-field="${CSS.escape(c)}"]`);
      if (!td?.querySelector('.wv-toggle-word')) continue;
      const cs = getComputedStyle(td);
      const probe = el('span', { class: 'wv-measure-cell' });
      for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing']) probe.style[prop] = cs[prop];
      const word = el('span', { class: 'wv-toggle-word' });
      probe.append(word);
      const measure = el('div', { class: 'wv-measure' }, probe);
      document.body.append(measure);
      const wide = (text) => { word.textContent = text; return word.getBoundingClientRect().width; };
      const pad = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0);
      valueFloors.set(c, CR.toggleWidth({ on: wide(f.on ?? 'On'), off: wide(f.off ?? 'Off'), pad }));
      measure.remove();
    }
    for (const c of cols) {
      const f = colField(db, c);
      if (!['select', 'multiselect', 'workflow'].includes(f?.type)) continue;
      const names = f.type === 'workflow' ? (f.states ?? []).map((st) => st.name) : (f.options ?? []);
      const td = table.querySelector(`:scope > tbody > tr.entity-row > td[data-field="${CSS.escape(c)}"]`);
      if (!td || !names.length) continue;
      const cs = getComputedStyle(td);
      const key = JSON.stringify([cs.font, table.dataset.density, f.type === 'workflow' ? f.states : (f.optionsFull ?? names)]);
      let m = chipWidths.get(c);
      if (m?.key !== key) {
        const chips = names.map((o) => optionChipEl(f, o));
        const more = f.type === 'multiselect' && names.length > 1 ? el('span', { class: 'k k-more' }, `+${names.length - 1}`) : null;
        const box = el('span', { class: f.type === 'multiselect' ? 'ms-box' : 'wv-measure-cell' }, ...chips, more);
        const measure = el('div', { class: 'wv-measure' }, box);
        td.append(measure);
        m = {
          key,
          chip: Math.max(...chips.map((n) => n.getBoundingClientRect().width)),
          more: more?.getBoundingClientRect().width ?? 0,
          gap: parseFloat(getComputedStyle(box).columnGap) || 0,
        };
        measure.remove();
        chipWidths.set(c, m);
      }
      const pad = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0);
      valueFloors.set(c, CR.chipWidth({ ...m, pad }));
    }
    for (const c of cols) {
      const f = colField(db, c);
      if (!f || !CR.ratingIcons(f)) continue;
      const td = table.querySelector(`:scope > tbody > tr.entity-row > td[data-field="${CSS.escape(c)}"]`);
      if (!td) continue;
      const cs = getComputedStyle(td);
      cellPads.set(c, ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0));
      valueFloors.set(c, CR.ratingFloor(f, cellPads.get(c)));
    }
    for (const [c, w] of valueFloors) floors.set(c, Math.max(floors.get(c) ?? 0, w));
    const pidCell = table.querySelector(':scope > tbody > tr.entity-row > td.pid-cell');
    if (pidCell) {
      let top = db.entityCount ?? 0;
      for (const it of ordered()) if (it?.publicId > top) top = it.publicId;
      const probe = cellFitProbe(pidCell);
      const link = probe.querySelector('a') ?? probe;
      link.textContent = `#${'0'.repeat(String(top).length)} \u2197`;
      const measure = el('div', { class: 'wv-measure' }, probe);
      document.body.append(measure);
      const cs = getComputedStyle(pidCell);
      const box = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0);
      pidWidth = Math.ceil(probe.getBoundingClientRect().width + box);
      measure.remove();
    }

    lead = [...head.children].slice(0, leadCount()).reduce((sum, h) => sum + h.getBoundingClientRect().width, 0);
    refreeze();
    paintLayout();
  };
  const blocked = () => {
    if (!db.view?.blank) return false;
    toast(BLANK_READ_ONLY, true);
    return true;
  };
  const commitWidth = async (c, w) => {
    override.delete(c);
    const f = colField(db, c);
    try {
      if (canFreezeHere()) {
        db.view.widths = { ...(db.view.widths ?? {}), [c]: w };
        refreeze(); paintLayout();
        requestAnimationFrame(() => markClippedCells(table));
        await gridConfigWrite(db, null, { widths: { [c]: w } });
      } else {
        f.width = Math.max(MIN_COLUMN_WIDTH, w);
        refreeze(); paintLayout();
        requestAnimationFrame(() => markClippedCells(table));
        await api('PATCH', `/tables/${db.id}/fields/${encodeURIComponent(f.id)}`, { config: { width: f.width } });
        loadSchema().catch(() => {});
      }
    } catch (err) { toast(err.message, true); showDatabase(db.id, state.route?.view); }
  };
  const grid = {
    blocked,
    width: widthOf,
    floor: (c) => floors.get(c) ?? 0,
    paint: (c, w) => { override.set(c, w); refreeze(); paintLayout(); },
    cancel: (c) => { override.delete(c); refreeze(); paintLayout(); },
    commit: commitWidth,
  };

  const flip = (before) => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const at = leadCount();
    const rows = [...table.querySelectorAll('tr')].filter((r) => r.children.length >= at + cols.length && r.children[0].colSpan === 1);
    const moving = [];
    cols.forEach((c, i) => {
      const dx = (before.get(c) ?? 0) - (headOf(c)?.getBoundingClientRect().left ?? 0);
      if (Math.abs(dx) >= 1) for (const r of rows) moving.push([r.children[at + i], dx]);
    });
    if (!moving.length) return;
    for (const [cell, dx] of moving) { cell.style.transition = 'none'; cell.style.transform = `translateX(${dx}px)`; }
    void table.offsetWidth;
    for (const [cell] of moving) { cell.style.transition = 'transform 180ms ease'; cell.style.transform = ''; }
    setTimeout(() => { for (const [cell] of moving) cell.style.transition = ''; }, 240);
  };

  const applyOrder = async (next, shownFrozen, moved, seen = null) => {
    const at = leadCount();
    const nextFrozen = Math.min(next.length, Math.max(0, storedFrozen() + shownFrozen - frozenShown));
    const before = seen ?? new Map(cols.map((c) => [c, headOf(c)?.getBoundingClientRect().left ?? 0]));
    const prev = cols;
    const prevFrozen = storedFrozen();
    const reordered = next.some((c, i) => c !== prev[i]);
    if (reordered) {
      for (const row of new Set([...table.querySelectorAll('tr'), ...built.values()])) {
        const cells = row.children;
        if (cells.length < at + prev.length || cells[0].colSpan > 1) continue;
        const byName = new Map(prev.map((c, i) => [c, cells[at + i]]));
        let anchorCell = cells[at - 1];
        for (const c of next) {
          const cell = byName.get(c);
          anchorCell.after(cell);
          anchorCell = cell;
          if (cell.dataset.field) cell.classList.toggle('name-cell', c === next[0]);
        }
      }
      const i = next.indexOf(moved);
      const anchor = i > 0 ? next[i - 1] : next[1];
      const fi = db.fields.findIndex((f) => f.name === moved);
      if (fi >= 0 && db.fields.some((f) => f.name === anchor)) {
        const [mf] = db.fields.splice(fi, 1);
        const ti = db.fields.findIndex((f) => f.name === anchor);
        db.fields.splice(i > 0 ? ti + 1 : ti, 0, mf);
      }
      cols = next;
    }
    if (canFreezeHere()) { db.view.fields = [...next]; if (nextFrozen) db.view.frozen = nextFrozen; else delete db.view.frozen; }
    refreeze();
    paintLayout();
    flip(before);
    try {
      if (canFreezeHere()) {
        const patch = {};
        if (reordered) {
          const i = next.indexOf(moved);
          patch.move = i > 0 ? { field: moved, after: next[i - 1] } : { field: moved, before: next[1] };
        }
        if (nextFrozen !== prevFrozen) patch.frozen = nextFrozen;
        if (Object.keys(patch).length) await gridConfigWrite(db, null, patch);
      } else if (reordered) {
        await api('PATCH', `/tables/${db.id}`, { fieldOrder: db.fields.map((f) => f.name) });
        await loadSchema();
      }
    } catch (err) {
      toast(err.message, true);
      showDatabase(db.id, state.route?.view);
    }
  };

  const columnDrag = (c, th, grip) => {
    const R = RO();
    const pidHead = table.tHead.rows[0].querySelector('th.pid-head');
    const order = [...cols];
    const fz = frozenShown;
    const from = order.indexOf(c);
    const lift = R.liftOf(th, { host: wrap, make: (h) => el('div', { class: 'wv-col-lift' }, h.querySelector('.col-label')?.cloneNode(true) ?? c) });
    const tag = el('span', { class: 'wv-col-insert-tag', hidden: '' });
    const slot = el('div', { class: 'wv-reorder-slot wv-col-slot', 'aria-hidden': 'true' }, tag);
    wrap.append(slot);
    document.body.classList.add('wv-col-dragging');
    table.classList.add('wv-col-sliding', 'wv-reorder-host');
    grabbed = c;
    colShift = new Map();
    paintLayout();
    const sl0 = wrap.scrollLeft;
    const start = order.map((n) => { const r = headOf(n).getBoundingClientRect(); return { name: n, left: r.left, right: r.right, width: r.width }; });
    const widths = start.map((b) => b.width);
    const boxes = () => {
      const dx = wrap.scrollLeft - sl0;
      return start.map((b, i) => (i < fz ? { ...b } : { ...b, left: b.left - dx, right: b.right - dx }));
    };
    const leadRight = () => pidHead?.getBoundingClientRect().right ?? wrap.getBoundingClientRect().left;
    const seam = () => (fz ? start[fz - 1].right : leadRight());
    let plan = null, px = 0, py = 0, gapX = start[from].left;
    const aim = () => {
      const b = boxes();
      const mine = from < fz;
      const capOk = canFreezeHere() && (mine || CR.canFreeze({ lead, widths: order.slice(0, fz).map(widthOf), add: widthOf(c), viewport: wrap.clientWidth }));
      const t = CR.target({ cols: b, frozen: fz, lead: leadRight(), seam: seam(), x: px, dragged: c, capOk });
      plan = CR.plan({ order, frozen: fz, dragged: c, gap: t.gap, side: t.side });
      const to = plan.order.indexOf(c);
      const shift = R.columnShift({ widths, from, to });
      gapX = R.gapStart({ lefts: b.map((x) => x.left), widths, from, to });
      colShift = new Map(order.map((n, i) => [n, i === from ? gapX - b[from].left : shift[i]]));
      paintLayout();
      const wr = wrap.getBoundingClientRect();
      slot.style.left = `${gapX - wr.left - wrap.clientLeft + wrap.scrollLeft}px`;
      slot.style.top = `${table.offsetTop}px`;
      slot.style.width = `${widths[from]}px`;
      slot.style.height = `${table.offsetHeight}px`;
      tag.hidden = !plan.tag;
      tag.textContent = plan.tag ?? '';
    };
    const auto = R.autoScroll({ scroller: wrap, axis: 'x', point: () => ({ x: px, y: py }), onScroll: aim, bounds: (r) => [Math.max(r.left, seam()), r.right] });
    const outside = (p) => {
      const r = wrap.getBoundingClientRect();
      return p.y < r.top - 48 || p.y > r.bottom + 48;
    };
    const unslide = () => {
      colShift = null;
      paintLayout();
      setTimeout(() => table.classList.remove('wv-col-sliding'), 240);
    };
    return {
      update(x, y) {
        px = x; py = y;
        lift.follow(x - grip.x, 0);
        aim();
        auto.kick();
      },
      finish(drop, p) {
        auto.stop();
        document.body.classList.remove('wv-col-dragging');
        table.classList.remove('wv-reorder-host');
        const home = !drop || !plan || plan.noop || (p && outside(p));
        const done = () => { slot.remove(); grabbed = null; paintLayout(); };
        if (home) {
          unslide();
          lift.settle({ left: start[from].left - (wrap.scrollLeft - sl0) * (from < fz ? 0 : 1), top: th.getBoundingClientRect().top }).then(done);
          if (R.reduced()) done();
          return;
        }
        const seen = new Map(cols.map((n) => [n, headOf(n)?.getBoundingClientRect().left ?? 0]));
        table.classList.remove('wv-col-sliding');
        colShift = null;
        applyOrder(plan.order, plan.frozen, c, seen);
        const landed = headOf(c)?.getBoundingClientRect();
        lift.settle(landed ? { left: landed.left, top: landed.top } : null).then(done);
        if (R.reduced()) done();
      },
    };
  };
  const headPointerDown = (e, c) => {
    if (e.button !== 0 || e.target.closest('.field-menu, .col-resize')) return;
    const th = e.currentTarget;
    RO().guard(th);
    let drag = null;
    const end = (drop, p) => {
      if (!drag) return;
      th.dataset.gesture = '1';
      document.addEventListener('pointerdown', () => { delete th.dataset.gesture; }, { capture: true, once: true });
      const d = drag;
      drag = null;
      d.finish(drop, p);
    };
    RO().press(e, {
      keepDefault: true,
      canLift: () => !blocked(),
      lift: (p, at) => {
        try { th.setPointerCapture(e.pointerId); } catch {}
        clearSelection();
        drag = columnDrag(c, th, at);
        drag.update(p.x, p.y);
      },
      move: (p) => { clearSelection(); drag?.update(p.x, p.y); },
      drop: (p) => end(true, p),
      cancel: () => end(false),
    });
  };
  const headKey = (e, c) => {
    const th = e.currentTarget;
    if (e.target !== th) return;
    if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); if (colField(db, c)) editFieldDialog(db, colField(db, c)); return; }
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    e.stopPropagation();
    if (blocked()) return;
    const dir = e.key === 'ArrowLeft' ? -1 : 1;
    if (e.shiftKey) {
      const fz = frozenShown;
      const may = canFreezeHere() && CR.canFreeze({ lead, widths: cols.slice(0, fz).map(widthOf), add: widthOf(c), viewport: wrap.clientWidth });
      const s = CR.step({ order: cols, frozen: fz, name: c, dir, canFreeze: may });
      if (!s) return;
      applyOrder(s.order, s.frozen, c);
      th.focus({ preventScroll: true });
      return;
    }
    const w = CR.nudge({ width: widthOf(c), delta: 8 * dir, floor: floors.get(c) ?? 0 });
    grid.paint(c, w);
    clearTimeout(nudgeTimers.get(c));
    nudgeTimers.set(c, setTimeout(() => { nudgeTimers.delete(c); commitWidth(c, w); }, 350));
  };
  const tokenH = {};
  const listRows = () => dockCoversScreen.matches && wrap.parentElement === main && main.id === 'main';
  const rowH = () => {
    const d = gridDensity(db);
    const key = listRows() ? `${d}:list` : d;
    if (!tokenH[key] && table?.isConnected && table.dataset.density === d) {
      tokenH[key] = parseFloat(getComputedStyle(table).getPropertyValue('--wv-row-h')) || 0;
    }
    return tokenH[key] || (listRows() ? PHONE_ROW_H[d] : GW().ROW_H[d]);
  };
  const spacer = () => el('tr', { class: 'wv-spacer', 'aria-hidden': 'true' },
    el('td', { colspan: String(colCount) }));
  const setPad = (tr, px) => {
    tr.firstChild.style.height = `${px}px`;
    if (px <= 0) return tr.remove();
    if (tr.isConnected) return;
    if (tr === topSpacer) tbody.prepend(tr);
    else tbody.insertBefore(tr, tbody.querySelector('tr.add-entity-row'));
  };
  const rowFor = (i) => {
    const item = itemAt(i);
    if (!item) return el('tr', { class: 'entity-row-pending', 'aria-hidden': 'true', dataset: { i: String(i) }, style: `height:${rowH()}px` }, el('td', { colspan: String(colCount) }));
    let tr = built.get(item.id);
    if (!tr) { tr = buildRow(item); built.set(item.id, tr); }
    tr.dataset.i = String(i);
    return tr;
  };
  const scroller = () => (wrap.classList.contains('wv-grid-scroll') ? wrap : paneOf(wrap));
  const geometry = () => {
    const box = scroller();
    const chromeH = stuckHeaderHeight(wrap);
    const viewTop = (box ? box.getBoundingClientRect().top : 0) + chromeH;
    return {
      box,
      viewTop,
      scrollTop: viewTop - tbody.getBoundingClientRect().top,
      viewportH: (box ? box.clientHeight : innerHeight) - chromeH,
      headH: table.tHead?.offsetHeight ?? 0,
    };
  };
  const paint = (w) => {
    let changed = false;
    for (const [i, tr] of live) {
      if (i < w.start || i >= w.end || (tr.classList.contains('entity-row-pending') && itemAt(i))) {
        tr.remove(); live.delete(i); changed = true;
      }
    }
    setPad(topSpacer, w.topPad); setPad(bottomSpacer, w.bottomPad);
    let cursor = topSpacer.isConnected ? topSpacer : null;
    for (let i = w.start; i < w.end; i++) {
      let tr = live.get(i);
      if (!tr) { tr = rowFor(i); live.set(i, tr); cursor ? cursor.after(tr) : tbody.prepend(tr); changed = true; }
      cursor = tr;
    }
    win.start = w.start; win.end = w.end;
    if (pager) pager.window = { start: w.start, end: w.end };
    if (loadedNote) {
      const n = loadedIds().length;
      const note = n < total() ? `${n.toLocaleString()} of ${total().toLocaleString()} loaded`
        : pager?.search ? `${WeaveTerm.count(total(), db.term)} found` : '';
      if (loadedNote.textContent !== note) loadedNote.textContent = note;
    }
    if (!changed) return;
    requestAnimationFrame(() => markClippedCells(table));
    paintSelection(); markDockedRow(); repaintRange();
  };
  const rewindow = () => {
    if (!tbody?.isConnected) return;
    const g = geometry();
    const travel = GW().travelFor({ scrollTop: g.scrollTop, lastTop: win.lastTop, direction: win.dir, rowH: rowH() });
    win.dir = travel.direction; win.lastTop = travel.lastTop;
    const w = GW().windowFor({ scrollTop: g.scrollTop, viewportH: g.viewportH, rowH: rowH(), total: total(), direction: win.dir });
    if (pager) {
      const want = GW().pagesFor(w, pager.page, pager.total);
      if (w.prefetchOffset != null && win.travelled) want.push(w.prefetchOffset);
      for (const o of want) if (!pager.has(o)) pager.fetch(o).then(schedule, () => {});
    }
    paint(w);
  };
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; rewindow(); }); };
  const onScroll = (e) => {
    if (!wrap.isConnected) return document.removeEventListener('scroll', onScroll, true);
    if (e.target === document || e.target === wrap || e.target === paneOf(wrap)) { win.travelled = true; schedule(); }
  };
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  const scrollToRow = (i) => {
    if (!tbody?.isConnected) return;
    const g = geometry();
    const want = GW().scrollTopFor({ index: i, rowH: rowH(), viewportH: g.viewportH, headH: g.headH, scrollTop: g.scrollTop });
    if (want !== g.scrollTop) (g.box ?? window).scrollBy({ top: want - g.scrollTop, left: 0, behavior: 'instant' });
    rewindow();
  };
  const ensureRow = async (i) => {
    if (i < 0 || i >= total()) return null;
    if (pager && !itemAt(i)) await pager.fetch(pager.pageOf(i));
    scrollToRow(i);
    return live.get(i) ?? null;
  };
  const repaintRow = (tr, item, was) => {
    for (const td of tr.querySelectorAll(':scope > td[data-field]')) {
      const f = db.fields.find((x) => x.name === td.dataset.field);
      if (!f) continue;
      if (td !== document.activeElement && td.contains(document.activeElement)) continue;
      if (was && JSON.stringify(was.fields?.[f.name] ?? null) === JSON.stringify(item.fields?.[f.name] ?? null)) continue;
      td.replaceChildren(cellBox(labeledEditorFor(f, item, db, onSaved, { compact: true, fit: true })));
      for (const n of td.querySelectorAll(':is(input, button, select, textarea, a, [tabindex])')) n.tabIndex = -1;
    }
    for (const td of tr.querySelectorAll(':scope > td.sys-cell')) td.replaceChildren(cellBox(sysValue(td.dataset.sys, item)));
    const listName = tr.querySelector(':scope > td.pid-cell .list-name');
    if (listName && listName.textContent !== (item.name ?? '')) listName.textContent = item.name ?? '';
    tr.classList.toggle('row-deleted', !!item.deleted);
  };
  const patchRows = async (fresh) => {
    const arr = ordered();
    const at = (eid) => arr.findIndex((r) => r && r.id === eid);
    if (at(fresh.id) < 0) return false;
    const stale = fresh.affected.filter((x) => x !== fresh.id && at(x) >= 0);
    const rows = [fresh];
    if (stale.length) {
      const read = await api('POST', `/tables/${db.id}/query`, { where: [['id', 'in', [fresh.id, ...stale]]] });
      rows.push(...read.items.filter((r) => r.id !== fresh.id));
    }
    for (const item of rows) {
      const i = at(item.id);
      if (i < 0) continue;
      const was = arr[i];
      arr[i] = item;
      const j = items.findIndex((r) => r && r.id === item.id);
      if (j >= 0) items[j] = item;
      const tr = built.get(item.id);
      if (tr) repaintRow(tr, item, was);
    }
    requestAnimationFrame(() => markClippedCells(table));
    return true;
  };
  const topEdge = (g) => g.viewTop + g.headH;
  const topRow = () => {
    const edge = topEdge(geometry());
    for (const tr of tbody.querySelectorAll('tr[data-i]')) {
      const r = tr.getBoundingClientRect();
      if (r.bottom > edge + 1) return { i: Number(tr.dataset.i), into: r.height ? Math.max(0, edge - r.top) / r.height : 0 };
    }
    return { i: win.start, into: 0 };
  };
  const setDensity = (mode) => {
    if (!tbody?.isConnected) return saveGridDensity(db, mode);
    const { i: anchor, into } = topRow();
    saveGridDensity(db, mode);
    table.dataset.density = mode;
    rewindow();
    scrollToRow(anchor);
    for (let k = 0; k < 3; k++) {
      const g = geometry(), tr = live.get(anchor);
      if (!tr) break;
      const r = tr.getBoundingClientRect();
      const off = r.top + into * r.height - topEdge(g);
      if (Math.abs(off) < 1) break;
      (g.box ?? window).scrollBy({ top: off, left: 0, behavior: 'instant' });
      win.lastTop = geometry().scrollTop;
      rewindow();
    }
    markClippedCells(table);
  };
  wrap.wvRewindow = rewindow;
  wrap.wvScrollToRow = scrollToRow;
  wrap.wvSetDensity = setDensity;
  wrap.wvPatchRows = patchRows;
  wrap.wvRefresh = () => onSaved?.();

  const draw = () => {
    sortedItems = [...items];
    if (sortKey && !pager) {
      const sortField = db.fields.find((f) => f.name === sortKey);
      const sortType = sortField?.type;
      const system = sortField ? null : fieldDialogCore.SYSTEM_SORT[sortKey];
      const order = sortType === 'select' ? (sortField.optionsFull ?? []).map((o) => o.id)
        : sortType === 'workflow' ? (sortField.states ?? []).map((st) => st.id) : null;
      const val = (item) => {
        if (system) return item[system.key] ?? null;
        const raw = item.raw?.[sortKey];
        if (sortType === 'daterange') return weaveDateGrain.rangeKey(raw);
        if (order) return raw == null ? null : (order.indexOf(raw) + 1 || order.length + 1);
        if (Array.isArray(raw) && raw.some((v) => typeof v === 'number')) return raw.filter((v) => typeof v === 'number').at(-1);
        return typeof raw === 'number' || sortType === 'date' ? raw : item.fields[sortKey];
      };
      sortedItems.sort((a, b) => {
        const av = val(a), bv = val(b);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(fieldValueCell(av)).localeCompare(String(fieldValueCell(bv)))) * sortDir;
      });
    }
    live.clear(); built.clear();
    win.start = 0; win.end = 0; win.lastTop = 0; win.dir = 1;
    tbody = el('tbody');
    topSpacer = spacer(); bottomSpacer = spacer();
    loadedNote = null;
    if (onAdd) {
      loadedNote = pager ? el('span', { class: 'wv-loaded', 'aria-live': 'polite' }) : null;
      tbody.append(el('tr', { class: 'add-entity-row' },
        el('td', { colspan: String(colCount) },
          el('button', {
            class: 'add-entity-btn', type: 'button', title: `New ${db.term.singular}`,
            onclick: () => onAdd(),
          }, `+ New ${db.term.singular}`),
          loadedNote)));
    }

    const sortBy = (key) => (dir) => {
      if (db.view?.blank) { toast(BLANK_READ_ONLY, true); return; }
      sortKey = dir ? key : null; sortDir = dir || 1;
      const saved = gridConfigWrite(db, { sort: dir ? [{ field: key, dir: dir > 0 ? 'asc' : 'desc' }] : [] });
      if (pager) saved.then(() => keepScroll(() => showDatabase(db.id, state.route.view)));
      else draw();
    };
    const sortMark = (key) => (sortKey === key ? iconEl(sortDir > 0 ? '↑' : '↓', 'wv-icon wv-icon-xs') : null);
    const systemMenu = (key, label) => {
      const sys = fieldDialogCore.SYSTEM_SORT[key];
      return sys ? fieldMenuButton(db, { ...sys, name: label, system: true },
        { sorted: sortKey === key ? sortDir : 0, onSort: sortBy(key) }) : null;
    };
    const sysHead = (n, movable) => el('th', {
      class: movable ? 'col-head sys-head' : 'sys-head', title: `${n} — system field, read-only`, dataset: { col: n },
      ...(movable ? {
        tabindex: '0',
        'aria-keyshortcuts': 'Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+ArrowLeft Alt+ArrowRight',
        onpointerdown: (e) => headPointerDown(e, n),
        onkeydown: (e) => headKey(e, n),
      } : {}),
    },
      el('span', { class: 'col-label' }, n, el('sup', { class: 'field-mark' }, '·'), sortMark(n)),
      systemMenu(n, n),
      movable ? columnResizeGrip(db, { name: n, type: 'date' }, grid) : null);

    table = el('table', {
      class: 'table table-sm table-vcenter card-table table-hover wv-grid',
      dataset: { density: gridDensity(db) },
    },
      el('thead', {}, el('tr', {},
        el('th', { class: 'sel-head' },
          el('label', { class: 'sel-hit' },
            el('input', {
              class: 'sel-box form-check-input', type: 'checkbox', 'aria-label': 'Select every row',
              onclick: () => {
                const loaded = loadedIds();
                const L = SEL();
                anchor = null;
                setChosen(L.headState(chosen().size, loaded.length) === 'all'
                  ? new Set() : L.selectAll(loaded));
              },
            }))),
        el('th', { class: 'pid-head' }, '#', sortMark('Public Id'), systemMenu('Public Id', '#')),
        ...cols.map((c) => (isSysCol(c) ? sysHead(c, true) : el('th', {
          class: 'col-head',
          tabindex: '0',
          'aria-keyshortcuts': 'Alt+Shift+ArrowLeft Alt+Shift+ArrowRight Alt+ArrowLeft Alt+ArrowRight',
          dataset: { col: c },
          title: fieldDescription(colField(db, c)) || null,
          onclick: (e) => { const th = e.currentTarget; if (!th.dataset.resized && !th.dataset.gesture) editFieldDialog(db, colField(db, c)); },
          onpointerdown: (e) => headPointerDown(e, c),
          onkeydown: (e) => headKey(e, c),
        },
          el('span', { class: 'col-label' },
            fieldNameLabel(colField(db, c), c),
            sortMark(c)),
          fieldMenuButton(db, colField(db, c), {
            sorted: sortKey === c ? sortDir : 0,
            onSort: sortBy(c),
          }),
          columnResizeGrip(db, colField(db, c), grid)))),
        ...sysTail.map((n) => sysHead(n, false)),
        el('th', { class: 'add-field-head' }, addFieldMenuButton(db))),
      showsRollups(db) ? renderFooter(db, cols) : null),
      tbody);
    const kept = wrap.scrollTop;
    wrap.replaceChildren(table, puck, layoutSheet);
    paintLayout();
    settle();
    wrap.scrollTop = kept;
    fitWatch.disconnect(); fitWatch.observe(wrap); fitWatch.observe(table); fitWatch.observe(main);
    const foot = table.querySelector('tr.wv-foot');
    if (foot) {
      fillFooter(db, foot);
      new ResizeObserver(() => table.style.setProperty('--wv-head-h', `${table.tHead.rows[0].offsetHeight}px`)).observe(table.tHead.rows[0]);
    }
    rewindow();
    if (chosen().size) setChosen(SEL().prune(chosen(), loadedIds()));
    else paintSelection();
  };
  draw();

  const KM = () => globalThis.WeaveGridKeymap;
  const OPEN_CONTROLS = 'input:not([type="checkbox"]), select, textarea, [contenteditable]';
  const stops = (row) => [...row.querySelectorAll(':scope > td[tabindex="0"]')];
  const rowsOf = () => [...wrap.querySelectorAll('tbody tr.entity-row')];
  const openerOf = (td) => {
    if (globalThis.WeaveEditorLib.cellActivation(td.dataset.ftype) !== 'none') return () => activateCell(td);
    const preview = td.querySelector('.doc-preview');
    return preview ? () => preview.click() : null;
  };
  const cellAt = (r, c) => stops(rowsOf()[r])?.[c] ?? null;
  const landOn = async (td, verb) => {
    const row = td.parentElement;
    const r = Number(row.dataset.i), c = stops(row).indexOf(td), cols = stops(row).length;
    const last = total() - 1;
    const to = verb.to === 'end' ? (r === last ? null : { r: last, c })
      : verb.to === 'home' ? (r === 0 ? null : { r: 0, c })
        : KM().step({ r, c, rows: total(), cols }, verb);
    if (!to) return td.focus();
    const tr = await ensureRow(to.r);
    (tr ? stops(tr)[to.c] : td)?.focus();
  };
  const apply = (verb, td, at) => {
    const eid = td.parentElement.dataset.eid;
    switch (verb.type) {
      case 'move': case 'commitMove': clearRange(); landOn(td, verb).catch(() => td.focus()); return true;
      case 'edit': {
        const activation = globalThis.WeaveEditorLib.cellActivation(td.dataset.ftype);
        if (verb.select === 'replace' && activation === 'toggle') return true;
        openerOf(td)?.();
        const input = td.querySelector(OPEN_CONTROLS);
        if (input && input === document.activeElement) {
          try { input.select(); } catch {}
          return verb.select !== 'replace';
        }
        return true;
      }
      case 'caret': {
        if (at.tagName !== 'INPUT' || typeof at.value !== 'string') return false;
        const to = verb.to === 'end' ? at.value.length : 0;
        try { at.setSelectionRange(to, to); } catch { return false; }
        return true;
      }
      case 'revert': {
        if ('defaultValue' in at) at.value = at.defaultValue;
        td.focus();
        return true;
      }
      case 'open': dockEntity(db, eid, { step: true }); return true;
      case 'newRow': {
        if (at !== td) at.blur();
        onAdd?.();
        return true;
      }
      case 'extendRange': {
        const here = coordOfCell(td);
        const cur = rangeRect() && sameCell(coordOfRef(rangeFocus), here)
          ? { anchor: coordOfRef(rangeAnchor), focus: here }
          : { anchor: here, focus: here };
        const out = RG().extend({ ...cur, dr: verb.dr, dc: verb.dc, rows: rowsOf().length, cols: rangeCols().length });
        if (!out) return true;
        setRange(refAtCoord(out.anchor), refAtCoord(out.focus));
        cellAt(out.focus.r, out.focus.c)?.focus();
        return true;
      }
      case 'clearRange': clearRange(); return true;
      case 'rate': td.querySelector('.wv-rating')?.dispatchEvent(new CustomEvent('rate', { detail: verb.value })); return true;
      case 'toggleSelect': anchor = eid; setChosen(SEL().toggle(chosen(), eid)); return true;
      case 'extendSelect': {
        const out = KM().extend({ ids: drawnIds(), anchor, at: eid, dir: verb.dir });
        anchor = out.anchor;
        setChosen(out.selected);
        const c = stops(td.parentElement).indexOf(td);
        stops(wrap.querySelector(`tbody tr.entity-row[data-eid="${out.at}"]`))?.[c]?.focus();
        return true;
      }
      case 'selectAll': anchor = null; setChosen(SEL().selectAll(loadedIds())); return true;
      case 'help': openKeySheet(); return true;
      default: return false;
    }
  };
  wrap.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const at = e.target;
    const td = at?.closest?.('tbody tr.entity-row > td[tabindex="0"]');
    if (!td) return;
    const open = at !== td && at.matches(OPEN_CONTROLS);
    const verb = KM().keymap(KM().keyOf(e), {
      mode: open ? 'edit' : 'rest', readonly: !openerOf(td), sel: chosen(),
      flip: td.dataset.ftype === 'toggle', range: !!rangeRect(),
      rate: td.dataset.ftype === 'rating' ? Number(td.querySelector('.wv-rating')?.dataset.max || 0) : 0,
    });
    if (apply(verb, td, at)) { e.preventDefault(); e.stopPropagation(); }
  });

  const RG = () => globalThis.WeaveGridRange;
  let rangeAnchor = null, rangeFocus = null;
  let fillRect = null;

  const rangeCols = () => (rowsOf()[0] ? stops(rowsOf()[0]).map((td) => td.dataset.field) : []);
  const refOfCell = (td) => ({ eid: td.parentElement.dataset.eid, field: td.dataset.field });
  const coordOfCell = (td) => ({ r: rowsOf().indexOf(td.parentElement), c: stops(td.parentElement).indexOf(td) });
  const coordOfRef = (ref) => (ref ? { r: drawnIds().indexOf(ref.eid), c: rangeCols().indexOf(ref.field) } : null);
  const refAtCoord = ({ r, c }) => ({ eid: drawnIds()[r], field: rangeCols()[c] });
  const sameCell = (a, b) => !!a && !!b && a.r === b.r && a.c === b.c;
  const rangeRect = () => {
    const a = coordOfRef(rangeAnchor), b = coordOfRef(rangeFocus);
    if (!a || !b || a.r < 0 || a.c < 0 || b.r < 0 || b.c < 0) return null;
    const rect = RG().rect(a, b);
    return RG().single(rect) ? null : rect;
  };
  const cellOfNode = (n) => n?.closest?.('tbody tr.entity-row > td[tabindex="0"]') ?? n?.closest?.('.chip-pop')?.cellFrom ?? null;
  const cursorCell = () => {
    const td = cellOfNode(document.activeElement);
    return td && wrap.contains(td) ? td : null;
  };
  const rangeOrCursor = () => {
    const rect = rangeRect();
    if (rect) return rect;
    const td = cursorCell();
    if (!td) return null;
    const { r, c } = coordOfCell(td);
    return r < 0 || c < 0 ? null : { r0: r, c0: c, r1: r, c1: c };
  };

  const paintRange = () => {
    const grid = wrap.querySelector('.wv-grid');
    if (!grid) return;
    for (const td of grid.querySelectorAll('td.wv-in-range, td.wv-fill-target')) {
      td.classList.remove('wv-in-range', 'wv-fill-target', 'wv-range-corner');
    }
    grid.querySelector('.wv-fill-handle')?.remove();
    const rect = rangeRect();
    const rows = rowsOf();
    const cellOf = (r, c) => (rows[r] ? stops(rows[r])[c] ?? null : null);
    for (const { r, c } of rect ? RG().cellsOf(rect) : []) cellOf(r, c)?.classList.add('wv-in-range');
    for (const { r, c } of fillRect ? RG().cellsOf(fillRect) : []) cellOf(r, c)?.classList.add('wv-fill-target');
    const corner = rect ? cellOf(rect.r1, rect.c1)
      : document.activeElement?.closest?.('tbody tr.entity-row > td[tabindex="0"]');
    if (corner && wrap.contains(corner)) {
      corner.classList.add('wv-range-corner');
      corner.append(el('span', { class: 'wv-fill-handle', 'aria-hidden': 'true', title: 'Drag to fill' }));
    }
  };
  repaintRange = paintRange;
  const setRange = (a, f) => { rangeAnchor = a; rangeFocus = f; paintRange(); };
  const clearRange = () => setRange(null, null);
  wrap.addEventListener('focusin', (e) => { if (!rangeRect() && e.target.matches?.('td[tabindex="0"]')) paintRange(); });

  const fieldNamed = (name) => db.fields.find((f) => f.name === name) ?? null;
  const typeOf = (name) => fieldNamed(name)?.type ?? null;
  const optionsOf = (name) => {
    const f = fieldNamed(name);
    return f?.optionsFull ?? f?.states ?? [];
  };
  const labelOf = (x) => (x && typeof x === 'object' ? x.name ?? '' : x);
  const valueAt = (r, c) => {
    const name = rangeCols()[c];
    const item = itemOf(drawnIds()[r]) ?? {};
    const d = item.fields?.[name] ?? null;
    return { type: typeOf(name), v: item.raw?.[name] ?? null, d: Array.isArray(d) ? d.map(labelOf) : labelOf(d) };
  };

  const relationRows = async (names) => {
    const out = new Map();
    for (const name of new Set(names)) {
      const f = fieldNamed(name);
      if (f?.type !== 'relation') continue;
      const dbIds = f.targetDbIds ?? (f.targetDbId ? [f.targetDbId] : []);
      try {
        const lists = await Promise.all(dbIds.map((id) => api('POST', `/tables/${id}/query`, { select: ['Name'] })));
        out.set(name, { rows: lists.flatMap((l) => l.items), many: !!f.many });
      } catch {}
    }
    return (name) => out.get(name) ?? null;
  };
  const runRange = async (verb, rect, block) => {
    const fields = rangeCols(), rowIds = drawnIds();
    const target = RG().target({ rect, block, rows: rowIds.length, cols: fields.length });
    const relationOf = await relationRows(fields.slice(target.c0, target.c1 + 1));
    const plan = RG().plan({ block, rect: target, fields, rowIds, typeOf, optionsOf, relationOf });
    const results = [];
    for (const g of RG().group(plan.writes)) {
      try { results.push(await api('POST', '/bulk', { ids: g.ids, op: 'set', values: g.values })); }
      catch (err) { results.push({ done: [], failed: g.ids.map((id) => ({ id, error: err.message })) }); }
    }
    const steps = results.reduce((n, r) => n + (r.changed?.length ?? 0), 0);
    const t = RG().toast({ verb, cells: plan.writes.length, refused: plan.refused, unparsed: plan.unparsed, unmatched: plan.unmatched, results });
    toast(t.msg, t.err, steps ? {
      label: 'Undo',
      run: async () => { await api('POST', '/undo', { steps }); await onSaved?.(); },
    } : null);
    await onSaved?.();
  };

  const openControl = () => {
    const at = document.activeElement;
    return at && at !== at.closest?.('td') && at.matches?.(OPEN_CONTROLS) ? at : null;
  };
  const clipboardTarget = () => {
    const at = openControl();
    const collapsed = !at ? true
      : at.isContentEditable ? !!getSelection()?.isCollapsed
        : at.selectionStart == null || at.selectionStart === at.selectionEnd;
    return KM().clipboardTarget({ mode: at ? 'edit' : 'rest', selectionCollapsed: collapsed });
  };
  const cellOfEvent = (e) => {
    const td = cellOfNode(e.target);
    return td && wrap.contains(td) ? td : null;
  };
  const onGrid = (kind, handle) => document.addEventListener(kind, function fn(e) {
    if (!wrap.isConnected) return document.removeEventListener(kind, fn);
    if (!e.clipboardData || !cellOfEvent(e) || clipboardTarget() === 'text') return;
    handle(e);
  });
  onGrid('copy', (e) => {
    const rect = rangeOrCursor();
    if (!rect) return;
    const block = RG().block({ rect, fields: rangeCols(), valueAt });
    lastCopiedBlock = block;
    e.clipboardData.setData('text/plain', RG().toTSV(block));
    e.clipboardData.setData('text/html', weaveCellsHTML(block));
    e.preventDefault();
  });
  onGrid('paste', (e) => {
    const rect = rangeOrCursor();
    if (!rect) return;
    const plain = e.clipboardData.getData('text/plain');
    const block = readWeaveCells(e.clipboardData.getData('text/html'))
      ?? (lastCopiedBlock && RG().toTSV(lastCopiedBlock) === plain ? lastCopiedBlock : null)
      ?? RG().parseTSV(plain);
    if (!block) return;
    e.preventDefault();
    const td = cursorCell(), at = openControl();
    if (at && 'defaultValue' in at) at.value = at.defaultValue;
    document.activeElement?.closest?.('.chip-pop')?.remove();
    td?.focus();
    runRange('Pasted', rect, block);
  });

  let dragFrom = null, dragged = false;
  let opening = null;
  const cellUnder = (e) => e.target?.closest?.('tbody tr.entity-row > td[tabindex="0"]');
  wrap.addEventListener('mousedown', (e) => {
    if (nativeClick(e)) return;
    opening = e.target?.matches?.(OPEN_CONTROLS) && e.target !== document.activeElement && cellUnder(e) ? e.target : null;
    if (e.target?.closest?.('.wv-fill-handle')) {
      fillRect = rangeOrCursor();
      dragged = true;
      e.preventDefault();
      return;
    }
    const td = cellUnder(e);
    dragFrom = td ? refOfCell(td) : null;
  });
  wrap.addEventListener('mouseover', (e) => {
    const td = cellUnder(e);
    if (!td) return;
    if (fillRect) {
      const grown = RG().fillTarget(rangeOrCursor() ?? fillRect, coordOfCell(td));
      fillRect = grown ?? rangeOrCursor();
      paintRange();
    } else if (dragFrom && (e.buttons & 1)) {
      const ref = refOfCell(td);
      if (ref.eid === dragFrom.eid && ref.field === dragFrom.field) return;
      if (!dragged) wrap.querySelector(`tr[data-eid="${dragFrom.eid}"] > td[data-field="${CSS.escape(dragFrom.field)}"]`)?.focus();
      dragged = true;
      setRange(dragFrom, ref);
    }
  });
  const endDrag = () => {
    const fill = fillRect;
    dragFrom = null; fillRect = null;
    if (!fill) { paintRange(); return; }
    const source = rangeOrCursor();
    paintRange();
    if (!source || (fill.r1 === source.r1 && fill.c1 === source.c1)) return;
    runRange('Filled', fill, RG().block({ rect: source, fields: rangeCols(), valueAt }));
  };
  addEventListener('mouseup', function up() {
    if (!wrap.isConnected) return removeEventListener('mouseup', up);
    if (dragFrom || fillRect) endDrag();
  });
  wrap.addEventListener('click', (e) => {
    const opened = opening;
    opening = null;
    if (dragged) {
      dragged = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (opened && opened === e.target && opened === document.activeElement
      && opened.selectionStart != null && opened.selectionStart === opened.selectionEnd) {
      try { opened.select(); } catch {}
    }
  }, true);

  let popTimer = 0;
  wrap.addEventListener('mouseover', (e) => {
    const td = e.target.closest('td.clipped');
    clearTimeout(popTimer);
    if (td && wrap.contains(td) && !cellIsEditing(td)) {
      popTimer = setTimeout(() => { if (!cellIsEditing(td)) showCellPop(td, wrap); }, CELL_POP_DELAY);
    } else hideCellPop(wrap);
  });
  const dropCellPop = () => { clearTimeout(popTimer); hideCellPop(wrap); };
  wrap.addEventListener('mouseleave', dropCellPop);
  wrap.addEventListener('mousedown', dropCellPop, true);
  wrap.addEventListener('focusin', dropCellPop);
  const listRow = (e) => (listRows() && !nativeClick(e) ? e.target?.closest?.('tbody tr.entity-row') : null);
  let press = null;
  wrap.addEventListener('pointerdown', (e) => {
    press = listRows() && e.pointerType !== 'mouse' ? { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, tap: false } : null;
  }, true);
  wrap.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    press.tap = Math.hypot(e.clientX - press.x, e.clientY - press.y) <= TAP_SLOP && e.timeStamp - press.t <= TAP_MS;
  }, true);
  wrap.addEventListener('pointercancel', () => { press = null; }, true);
  wrap.addEventListener('mousedown', (e) => {
    if (!listRow(e)) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  wrap.addEventListener('click', (e) => {
    const tr = listRow(e);
    if (!tr) return;
    e.preventDefault();
    e.stopPropagation();
    const touched = press;
    press = null;
    if (touched && !touched.tap) return;
    if (tr.dataset.href && !tr.dataset.href.startsWith('#/entity/')) location.href = tr.dataset.href;
    else openEntity(tr.dataset.eid);
  }, true);
  main.append(wrap);
  settle();
  document.fonts?.ready?.then(() => { if (wrap.isConnected) settle(); });
  requestAnimationFrame(() => { if (wrap.isConnected) settle(); });
  rewindow();
}


const TAP_SLOP = 10;
const TAP_MS = 300;

const SYSTEM_COLS = {
  'Created At': (e) => (e.createdAt ?? '').slice(0, 16).replace('T', ' '),
  'Modified At': (e) => (e.updatedAt ?? '').slice(0, 16).replace('T', ' '),
  'Created By': (e) => actorChipEl(e.createdBy),
  'Modified By': (e) => actorChipEl(e.modifiedBy),
  'Activity': (e) => `${(e.activity ?? []).length}⚡`,
};

function actorChipEl(actor, { link = true } = {}) {
  const a = weaveActor.parseActor(actor);
  if (a.kind === 'none') return '';
  if (a.kind === 'workflow') {
    const row = workflowRow(a.workflowId);
    const label = el('span', { class: 'k-label' }, row.name ?? 'Automation');
    const body = [iconEl('lucide:workflow', 'wv-icon wv-icon-xs'), label];
    const inner = link ? el('a', { href: row.href, title: row.name ?? 'Automation', onclick: (e) => e.stopPropagation() }, ...body) : null;
    row.read.then(() => {
      label.textContent = row.name ?? 'Automation';
      if (inner) { inner.href = row.href; inner.title = label.textContent; }
    });
    return link
      ? el('span', { class: 'k k-rel k-actor-wf' }, inner)
      : el('span', { class: 'k k-actor-wf is-inline' }, ...body);
  }
  return el('span', { class: 'k k-actor', title: a.via ? `${a.name} via ${a.via}` : a.name },
    el('span', { class: `av hue-${chipCore.hueForName(a.name)}` }, chipCore.initialsFor(a.name)),
    el('span', { class: 'k-label' }, a.name),
    a.via ? el('span', { class: 'k-actor-via' }, `· via ${a.via}`) : null);
}

function commentAuthorEl(author) {
  if (/^workflow:/.test(author ?? '')) return actorChipEl(author);
  if (author === 'automation') return el('span', { class: 'k k-actor-wf is-inline' }, iconEl('lucide:workflow', 'wv-icon wv-icon-xs'), el('span', { class: 'k-label' }, 'Automation'));
  return author;
}
function commentAuthorText(author) {
  const a = weaveActor.parseActor(author);
  if (a.kind === 'workflow') return workflowRow(a.workflowId).name ?? 'an automation';
  if (author === 'automation') return 'an automation';
  return author ?? 'someone';
}

const workflowRows = new Map();
function workflowRow(id) {
  let row = workflowRows.get(id);
  if (row) return row;
  row = { name: null, href: WS_PREFIX ? `/#/entity/${id}` : `#/entity/${id}` };
  const read = (prefix) => fetch(`${prefix}/api/entities/${encodeURIComponent(id)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  row.read = (async () => {
    const own = WS_PREFIX ? await read(WS_PREFIX) : null;
    const found = own ?? await read('');
    if (!found) return;
    row.name = found.name || row.name;
    if (own && allTables().some((t) => t.id === own.dbId)) row.href = `#/entity/${id}`;
  })();
  workflowRows.set(id, row);
  return row;
}

const PULSE = { lead: 80, step: 220, ms: 1000 };
const automationSeen = new Map();
function noteAutomationWrites(entity, now) {
  const run = weaveActor.automationWrites(entity.activity, { now });
  if (!run || run.seq <= (automationSeen.get(entity.id) ?? 0)) return;
  automationSeen.set(entity.id, run.seq);
  for (const r of run.runs) {
    const row = r.workflowId ? workflowRow(r.workflowId) : null;
    if (row && r.name && !row.name) row.name = r.name;
    const name = r.name ?? row?.name ?? 'An automation';
    toast(`${name} ran on #${entity.publicId}`, false,
      row ? { label: 'Open', run: () => { location.href = row.href; } } : null, { kind: 'automation' });
  }
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) pulseCells(entity.id, [...run.fields, 'Modified By']);
}

function pulseTargets(eid, field) {
  const id = CSS.escape(eid), f = CSS.escape(field);
  const out = [];
  for (const scope of document.querySelectorAll(`tr[data-eid="${id}"], .entity-grid[data-eid="${id}"], .wv-card[data-eid="${id}"]`)) {
    for (const n of scope.querySelectorAll(`[data-field="${f}"], [data-sys="${f}"], [data-block="${f}"]`)) {
      if (n.parentElement.closest('[data-eid]') === scope) out.push(n);
    }
  }
  return out;
}

function pulseCells(eid, fields) {
  const t0 = performance.now();
  const done = new WeakSet();
  const end = PULSE.lead + fields.length * PULSE.step + PULSE.ms;
  const paint = () => {
    const elapsed = performance.now() - t0;
    fields.forEach((f, i) => {
      for (const n of pulseTargets(eid, f)) {
        const delay = Math.round(PULSE.lead + i * PULSE.step - elapsed);
        if (done.has(n) || delay + PULSE.ms <= 0) continue;
        done.add(n);
        n.style.setProperty('--wv-pulse-delay', `${delay}ms`);
        n.classList.add('wv-pulse');
        const off = (e) => {
          if (e.target !== n || e.animationName !== 'wv-pulse') return;
          n.removeEventListener('animationend', off);
          n.classList.remove('wv-pulse');
          n.style.removeProperty('--wv-pulse-delay');
        };
        n.addEventListener('animationend', off);
      }
    });
  };
  paint();
  const watch = new MutationObserver(paint);
  watch.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => watch.disconnect(), end);
}

const colField = (db, name) => db.fields.find((f) => f.name === name);

const MIN_COLUMN_WIDTH = 60;

function cellFitProbe(cell) {
  const cs = getComputedStyle(cell);
  const probe = el('span', { class: 'wv-measure-cell' });
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing']) {
    probe.style[prop] = cs[prop];
  }
  for (const node of cell.childNodes) probe.append(node.cloneNode(true));
  const live = cell.querySelectorAll('input, textarea');
  probe.querySelectorAll('input, textarea').forEach((copy, i) => {
    const src = live[i] ?? copy;
    const s = getComputedStyle(src);
    const text = el('span', {}, src.value || src.placeholder || '');
    for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
      'paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']) {
      text.style[prop] = s[prop];
    }
    text.style.borderStyle = 'solid';
    copy.replaceWith(text);
  });
  return probe;
}

function fitColumnWidth(th) {
  const table = th.closest('table');
  const idx = [...th.parentElement.children].indexOf(th);
  const measure = el('div', { class: 'wv-measure' });
  document.body.append(measure);
  const probes = [];
  for (const row of table.querySelectorAll(':scope > tbody > tr')) {
    const cell = row.children[idx];
    if (!cell || cell.colSpan > 1) continue;
    const probe = cellFitProbe(cell);
    measure.append(probe);
    probes.push({ probe, cell });
  }
  let widest = 0;
  for (const { probe, cell } of probes) {
    const cs = getComputedStyle(cell);
    const box = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth']
      .reduce((sum, prop) => sum + (parseFloat(cs[prop]) || 0), 0);
    widest = Math.max(widest, probe.getBoundingClientRect().width + box);
  }
  measure.remove();
  return Math.ceil(widest);
}

const clearSelection = () => { try { getSelection()?.removeAllRanges(); } catch {} };

function columnResizeGrip(db, f, grid) {
  const CR = globalThis.WeaveColumnResize;
  const grip = el('span', { class: 'col-resize', title: 'Drag to resize — double-click to fit the content' });
  grip.addEventListener('click', (e) => e.stopPropagation());
  grip.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    clearSelection();
    if (grid.blocked()) return;
    const th = grip.closest('th');
    grid.commit(f.name, CR.fit({ content: fitColumnWidth(th), floor: grid.floor(f.name), max: CR.maxWidth(f) }));
  });
  grip.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
  grip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0 || grid.blocked()) return;
    const th = grip.closest('th');
    try { grip.setPointerCapture(e.pointerId); } catch {}
    clearSelection();
    document.body.classList.add('wv-col-resizing');
    th.dataset.resized = '1';
    document.addEventListener('pointerdown', () => { delete th.dataset.resized; }, { capture: true, once: true });
    const startX = e.clientX;
    const base = grid.width(f.name);
    const floor = grid.floor(f.name);
    let width = base;
    const readout = el('div', { class: 'wv-col-readout', role: 'status' });
    document.body.append(readout);
    const show = () => {
      const d = width - base;
      readout.textContent = `${f.name} ${width}px ${d < 0 ? '−' : '+'}${Math.abs(d)}`;
      const r = th.getBoundingClientRect();
      readout.style.left = `${Math.round(r.right)}px`;
      readout.style.top = `${Math.round(r.top - 30)}px`;
    };
    show();
    const move = (ev) => {
      width = CR.width({ base, startX, x: ev.clientX, floor });
      grid.paint(f.name, width);
      show();
    };
    let done = false;
    const up = () => {
      if (done) return;
      done = true;
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      grip.removeEventListener('lostpointercapture', up);
      readout.remove();
      document.body.classList.remove('wv-col-resizing');
      clearSelection();
      if (width !== base) grid.commit(f.name, width); else grid.cancel(f.name);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    grip.addEventListener('lostpointercapture', up);
  });
  return grip;
}

const FIELD_MENU_ICONS = {
  edit: 'lucide:pencil', insert: '+',
  asc: '↑', desc: '↓', clear: '✕',
  delete: 'lucide:trash-2',
};

function fieldMenuRow(icon, label, run, { current = false } = {}) {
  const row = el('button', {
    class: `chip-pop-row wv-menu-row${current ? ' is-current' : ''}`, type: 'button',
    onclick: () => { document.querySelector('.chip-pop')?.remove(); run(); },
  }, iconEl(icon, 'wv-icon wv-menu-icon'), el('span', { class: 'wv-menu-label' }, label));
  if (current) row.append(el('span', { class: 'chip-pop-check' }, iconEl('✓', 'wv-icon')));
  return row;
}

function lookupTargetOf(db, f) {
  if (f?.type !== 'lookup' || !f.via || !f.targetField) return null;
  const rel = db?.fields?.find((x) => x.type === 'relation' && x.name === f.via);
  const far = rel && allTables().find((t) => t.id === rel.targetDbId);
  return far?.fields.find((x) => x.name === f.targetField) ?? null;
}

function sortLabelsFor(db, f) {
  let targetType = null;
  if ((f.type === 'lookup' || f.type === 'rollup') && f.targetField) {
    const rel = f.via ? db.fields.find((x) => x.name === f.via) : null;
    const target = allTables().find((t) => t.id === (f.viaTableId ?? rel?.targetDbId));
    targetType = target?.fields.find((x) => x.name === f.targetField)?.type ?? null;
  }
  return fieldDialogCore.sortLabels(f, { targetType });
}

function fieldMenuButton(db, f, { sorted = 0, onSort = null } = {}) {
  const btn = el('button', {
    class: 'field-menu', type: 'button',
    title: f.system ? `Sort by ${f.name}` : `Configure ${f.name}`,
    'aria-label': f.system ? `Sort by ${f.name}` : `Configure field ${f.name}`,
  }, iconEl('lucide:ellipsis-vertical', 'wv-icon'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const row = fieldMenuRow;
    const rows = [
      el('div', { class: 'wv-menu-head' },
        el('span', { class: 'wv-menu-title', title: f.name }, f.name),
        el('span', { class: 'wv-menu-kind' }, f.system ? 'system' : fieldDialogCore.typeLabel(f.type))),
    ];
    if (!f.system) {
      rows.push(row(FIELD_MENU_ICONS.edit, 'Edit field…', () => editFieldDialog(db, f)),
        row(FIELD_MENU_ICONS.insert, 'Insert field…', () => addFieldDialog(db)));
    }
    if (onSort) {
      const words = sortLabelsFor(db, f);
      if (!f.system) rows.push(el('div', { class: 'wv-menu-sep' }));
      rows.push(row(FIELD_MENU_ICONS.asc, words.asc, () => onSort(1), { current: sorted > 0 }),
        row(FIELD_MENU_ICONS.desc, words.desc, () => onSort(-1), { current: sorted < 0 }));
      if (sorted) rows.push(row(FIELD_MENU_ICONS.clear, 'Clear sort', () => onSort(0)));
    }
    if (f.role !== 'name' && !f.system) {
      rows.push(el('div', { class: 'wv-menu-sep' }));
      rows.push(holdToConfirm('Delete field', async () => {
        document.querySelector('.chip-pop')?.remove();
        try {
          await api('DELETE', `/tables/${db.id}/fields/${encodeURIComponent(f.id)}`);
          await loadSchema();
          showDatabase(db.id);
        } catch (err) { toast(err.message, true); }
      }, {
        holdingLabel: 'Hold to delete…',
        rowClass: 'chip-pop-row wv-menu-row wv-menu-danger',
        icon: FIELD_MENU_ICONS.delete,
        hint: 'hold',
      }));
    }
    showPopover(btn, rows);
  });
  return btn;
}

let measureCtx = null;
function textWidth(str, node) {
  if (!node.isConnected) return 0;
  const font = getComputedStyle(node).font;
  if (!font) return 0;
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(str).width;
}
function dateControl({ value = '', time = false, format = 'iso', costume = null, placeholder = 'type a date…', onChange, compact = true }) {
  const dc = weaveDateCore;
  const c = costume ? { ...costume } : { time, format };
  format = c.format ?? weaveDateGrain.DEFAULT_FORMAT;
  time = !!c.time;
  const view = { ...c, viewerZone: LOCAL_ZONE };
  const grain = dc.grainOf(c);
  const timeOnly = grain.length === 0;
  let current = value ?? '';
  const show = (v) => dc.formatDate(v, view);
  const text = el('input', {
    class: 'form-control form-control-sm inline-edit date-text' + (compact ? '' : ' date-text-wide'),
    value: show(current), placeholder: timeOnly ? '9:15, 5:40 pm…' : placeholder,
    onclick: (e) => e.stopPropagation(),
  });
  const fit = () => {
    const w = textWidth(text.value || text.placeholder, text);
    if (w) text.style.setProperty('--date-fit', `${Math.ceil(w) + 22}px`);
  };
  requestAnimationFrame(fit);
  const set = (iso) => { current = iso ?? ''; text.value = show(current); fit(); onChange(current || null); };
  const { store, local: toLocal } = dateStoreFns(c);
  const local = () => toLocal(current);
  text.addEventListener('change', () => {
    const typed = text.value.trim();
    if (!typed) return set('');
    try {
      set(store(readTypedDate(typed, c, local())));
    } catch {
      toast(`Could not read '${typed}' as a ${timeOnly ? 'time' : 'date'}`, true);
      text.value = show(current);
    }
  });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } });
  const btn = el('button', {
    type: 'button', class: 'date-pick-btn', title: timeOnly ? 'Pick a time' : 'Pick from the calendar', 'aria-label': timeOnly ? 'Pick a time' : 'Open calendar',
    onclick: (e) => {
      e.stopPropagation();
      datePopover({ anchor: btn, value: local(), costume: c, onPick: (localIso) => {
        try { set(localIso == null ? null : store(localIso)); } catch (err) { toast(err.message, true); }
      } });
    },
  }, calendarGlyph());
  const wrap = el('span', { class: 'date-cell' }, text, btn);
  wrap.setValue = (iso) => { current = iso ?? ''; text.value = show(current); fit(); };
  return wrap;
}

function dateStoreFns(c) {
  const dc = weaveDateCore;
  return {
    store: (localIso) => {
      if (!localIso) return null;
      if (c.zone === 'instant') return dc.toInstant(localIso.includes('T') ? localIso : localIso + 'T00:00', LOCAL_ZONE);
      if (c.grain == null) return localIso;
      return dc.coerce(c, localIso);
    },
    local: (stored) => (c.zone === 'instant' && stored ? dc.fromInstant(stored, LOCAL_ZONE) : (stored ?? '')),
  };
}

function rangeControl({ value = null, costume, compact = true, placeholder = 'start – end', onChange }) {
  const dc = weaveDateCore;
  const c = { ...costume };
  const view = { ...c, viewerZone: LOCAL_ZONE };
  const { store, local } = dateStoreFns(c);
  let current = value?.start && value?.end ? { start: value.start, end: value.end } : null;
  const show = (r) => (r ? dc.formatDateRange(r, view) : '');
  const text = el('input', {
    class: 'form-control form-control-sm inline-edit date-text range-text' + (compact ? '' : ' date-text-wide'),
    value: show(current), placeholder,
    onclick: (e) => e.stopPropagation(),
  });
  const set = (r) => { current = r; text.value = show(current); onChange(current); };
  text.addEventListener('change', () => {
    const typed = text.value.trim();
    if (!typed) return set(null);
    const ends = typed.split(/\s*[–—]\s*|\s+-\s+|\s+to\s+/i).filter(Boolean);
    try {
      if (ends.length !== 2) throw new Error('two ends');
      set(orderRange({ start: store(readTypedDate(ends[0], c, local(current?.start))), end: store(readTypedDate(ends[1], c, local(current?.end))) }));
    } catch {
      toast(`Could not read '${typed}' as a range — type start – end`, true);
      text.value = show(current);
    }
  });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } });
  const btn = el('button', {
    type: 'button', class: 'date-pick-btn', title: 'Pick the range from the calendar', 'aria-label': 'Open the range calendar',
    onclick: (e) => {
      e.stopPropagation();
      datePopover({
        anchor: btn, costume: c, range: true,
        value: current ? { start: local(current.start), end: local(current.end) } : null,
        onPick: (r) => {
          try { set(r ? orderRange({ start: store(r.start), end: store(r.end) }) : null); } catch (err) { toast(err.message, true); }
        },
      });
    },
  }, calendarGlyph());
  const wrap = el('span', { class: 'date-cell range-cell', onclick: (e) => e.stopPropagation() }, text, btn);
  wrap.setValue = (r) => { current = r?.start && r?.end ? { start: r.start, end: r.end } : null; text.value = show(current); };
  return wrap;
}
function orderRange(r) {
  return String(r.start) > String(r.end) ? { start: r.end, end: r.start } : r;
}

function readTypedDate(typed, c, current) {
  const dc = weaveDateCore;
  const grain = dc.grainOf(c);
  const format = c.format ?? weaveDateGrain.DEFAULT_FORMAT;
  const pad = (n) => String(n).padStart(2, '0');
  const clock = c.time ? dc.parseClock(typed) : null;
  if (!grain.length) {
    if (!clock) throw new Error('no time of day');
    return clock;
  }
  const today = dc.todayIso();
  const [ty, tm] = today.split('-').map(Number);
  const hasD = grain.includes('day'), hasM = grain.includes('month'), hasY = grain.includes('year');
  const bare = typed.replace(/\b(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/i, '').trim();
  let day = null;
  let m;
  if (!hasM && hasD && (m = bare.match(/^(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/i))) day = `${ty}-${pad(tm)}-${pad(m[1])}`;
  else if (!hasD && hasM && (m = bare.match(/^(\d{1,2})[/.\-](\d{4})$/))) day = `${m[2]}-${pad(m[1])}-01`;
  else if (!hasD && hasM && (m = bare.match(/^(\d{4})[/.\-](\d{1,2})$/))) day = `${m[1]}-${pad(m[2])}-01`;
  else if (!hasD && !hasM && hasY && (m = bare.match(/^(\d{4})$/))) day = `${m[1]}-01-01`;
  else if (!hasD && hasM && !hasY && (m = bare.match(/^(\d{1,2})$/))) day = `${ty}-${pad(m[1])}-01`;
  else if (bare) {
    day = parseNaturalDate(bare, new Date(), { dayFirst: format === 'eu' })
      ?? (!hasD ? parseNaturalDate('1 ' + bare, new Date(), { dayFirst: format === 'eu' }) : null);
  } else if (clock && current) {
    day = String(current).split('T')[0];
  }
  if (!day) throw new Error('unreadable');
  if (!c.time) return day;
  const keep = dc.partsOf(current)?.t;
  const t = clock ?? keep;
  return t ? `${day}T${t}` : day;
}

function calendarGlyph() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
  svg.innerHTML = '<rect x="1.5" y="2.5" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 6h13" stroke="currentColor" stroke-width="1.3"/><path d="M5 1v3M11 1v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>';
  return svg;
}

function datePopover({ anchor, value, time, format, costume = null, range = false, onPick }) {
  const dc = weaveDateCore;
  const c = costume ?? { time, format };
  time = !!c.time;
  format = c.format ?? weaveDateGrain.DEFAULT_FORMAT;
  const grain = dc.grainOf(c);
  const hasY = grain.includes('year'), hasM = grain.includes('month'), hasD = grain.includes('day');
  const pad = (n) => String(n).padStart(2, '0');
  document.querySelector('.date-pop')?.remove();
  const todayIso = dc.todayIso();
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const startVal = range ? (value?.start ?? '') : (value || '');
  const p = dc.partsOf(startVal) ?? {};
  let y = p.y ?? ty, m = p.m ?? tm;
  const dayOf = (iso) => { const q = dc.partsOf(iso || ''); return q?.d != null ? `${q.y}-${pad(q.m)}-${pad(q.d)}` : ''; };
  const clockOf = (iso) => dc.partsOf(iso || '')?.t ?? '';
  const ends = range
    ? { start: dayOf(value?.start), end: dayOf(value?.end) }
    : { start: dayOf(value), end: '' };
  const clocks = range
    ? { start: clockOf(value?.start), end: clockOf(value?.end) }
    : { start: clockOf(value), end: '' };
  let picking = range && ends.start && !ends.end ? 'end' : 'start';
  let view = !hasY && !hasM && !hasD ? 'clock' : hasD && !hasM ? 'daylist' : hasM && !hasD ? 'months' : hasY && !hasM ? 'years' : 'days';
  let decadeBase = y;
  const pop = el('div', { class: 'date-pop' + (range ? ' range' : ''), role: 'dialog', onclick: (e) => e.stopPropagation() });
  const withClock = (day, which = 'start') => (time ? `${day}T${clocks[which] || '00:00'}` : day);
  const stamp = (which) => (view === 'clock' ? clocks[which] : (ends[which] ? withClock(ends[which], which) : ''));
  const commit = (close) => {
    if (range) {
      const both = view === 'clock' ? clocks.start && clocks.end : ends.start && ends.end;
      if (both) onPick({ start: stamp('start'), end: stamp('end') });
    } else {
      onPick(view === 'clock' ? (clocks.start || null) : (ends.start ? stamp('start') : null));
    }
    if (close) pop.remove();
    else draw();
  };
  const clear = () => { ends.start = ''; ends.end = ''; clocks.start = ''; clocks.end = ''; picking = 'start'; onPick(null); pop.remove(); };
  const pick = (dayIso) => {
    if (!range) { ends.start = dayIso; return commit(!time); }
    if (picking === 'start') { ends.start = dayIso; ends.end = ''; picking = 'end'; return draw(); }
    ends.end = dayIso;
    if (ends.end < ends.start) [ends.start, ends.end] = [ends.end, ends.start];
    picking = 'start';
    commit(!time);
  };
  const dayClass = (iso) => (
    (iso === todayIso ? ' today' : '')
    + (iso === ends.start || iso === ends.end ? ' sel' : '')
    + (range && ends.start && ends.end && iso > ends.start && iso < ends.end ? ' in-range' : ''));
  const smartFor = (which) => {
    const cur = range ? (value?.[which] ?? '') : (value || '');
    const smart = el('input', {
      class: 'form-control form-control-sm date-smart',
      'aria-label': range ? (which === 'start' ? 'Start' : 'End') : 'Date',
      placeholder: view === 'clock' ? '9:15, 5:40 pm…' : hasD ? 'today, 15 sep, 9/15/26…' : hasM ? 'aug 2026, 08/2026…' : '2026…',
      value: dc.formatDate(cur, { ...c, viewerZone: LOCAL_ZONE }),
    });
    const preview = el('div', { class: 'date-smart-preview' });
    const readSmart = () => {
      try { return readTypedDate(smart.value, c, cur); } catch { return null; }
    };
    smart.addEventListener('input', () => {
      const local = readSmart();
      let shown = '…';
      if (local) { try { shown = `→ ${dc.formatDate(c.grain == null ? local : dc.coerce(c, local), { ...c, format: c.grain == null ? 'long' : format })}`; } catch { shown = '…'; } }
      preview.textContent = smart.value.trim() ? shown : '';
    });
    smart.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const local = readSmart();
      if (!local) return toast(`Could not read '${smart.value}' as a ${view === 'clock' ? 'time' : 'date'}`, true);
      if (view === 'clock') { clocks[which] = local; return commit(!range || !!(clocks.start && clocks.end)); }
      const day = local.split('T')[0];
      const t = local.split('T')[1];
      if (t) clocks[which] = t;
      if (!range) { ends.start = day; return commit(true); }
      [y, m] = day.split('-').map(Number);
      if (which === 'start') {
        ends.start = day; ends.end = ''; picking = 'end';
        draw();
        pop.querySelector('.date-pop-smart-end .date-smart')?.focus();
        return;
      }
      ends.end = day;
      if (!ends.start) { picking = 'start'; return draw(); }
      if (ends.end < ends.start) [ends.start, ends.end] = [ends.end, ends.start];
      picking = 'start';
      commit(true);
    });
    return el('div', { class: 'date-pop-smart' + (range ? ' date-pop-smart-' + which : '') },
      range ? el('span', { class: 'date-smart-label' }, which === 'start' ? 'Start' : 'End') : null, smart, preview);
  };
  const body = el('div', { class: 'date-pop-body' });
  const timeInput = (which) => {
    const t = el('input', { type: 'time', class: 'form-control form-control-sm date-time', 'aria-label': range ? `${which} time` : 'Time', value: clocks[which] });
    t.addEventListener('change', () => {
      clocks[which] = t.value;
      if (view === 'clock') { commit(false); return; }
      if (ends.start && (!range || ends.end)) commit(false);
    });
    return t;
  };
  const timeRow = () => el('div', { class: 'date-pop-time' },
    el('span', {}, 'Time'), timeInput('start'),
    ...(range ? [el('span', { class: 'range-sep' }, '–'), timeInput('end')] : []));
  const foot = (todayPick) => el('div', { class: 'date-pop-foot' },
    el('button', { type: 'button', class: 'date-pop-link', onclick: clear }, 'Clear'),
    el('button', { type: 'button', class: 'date-pop-link', onclick: todayPick }, 'Today'));
  function draw() {
    body.replaceChildren();
    if (view === 'days') {
      body.append(el('div', { class: 'date-pop-head' },
        el('button', { type: 'button', class: 'date-pop-title', onclick: () => { view = 'months'; draw(); } }, `${dc.MONTHS_LONG[m - 1]} ▾`),
        hasY ? el('button', { type: 'button', class: 'date-pop-title', onclick: () => { view = 'years'; decadeBase = y; draw(); } }, `${y} ▾`) : el('span'),
        el('span', { class: 'date-pop-spacer' }),
        el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Previous month', onclick: () => { [y, m] = dc.shiftMonth(y, m, -1); draw(); } }, '↑'),
        el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Next month', onclick: () => { [y, m] = dc.shiftMonth(y, m, 1); draw(); } }, '↓')));
      const grid = el('div', { class: 'date-grid' }, ...dc.WEEKDAYS.map((d) => el('span', { class: 'date-wd' }, d)));
      for (const week of dc.calendarMonth(y, m)) {
        for (const cell of week) {
          grid.append(el('button', {
            type: 'button',
            class: 'date-day' + (cell.inMonth ? ' in' : ' out') + dayClass(cell.iso),
            onclick: () => { [y, m] = cell.iso.split('-').map(Number); pick(cell.iso); },
          }, String(cell.day)));
        }
      }
      body.append(grid);
      if (time) body.append(timeRow());
      body.append(foot(() => { [y, m] = [ty, tm]; pick(todayIso); }));
    } else if (view === 'daylist') {
      const grid = el('div', { class: 'date-grid' });
      for (let d = 1; d <= 31; d++) {
        const iso = `${ty}-${pad(tm)}-${pad(d)}`;
        grid.append(el('button', {
          type: 'button', class: 'date-day in' + dayClass(iso),
          onclick: () => pick(iso),
        }, String(d)));
      }
      body.append(grid);
      if (time) body.append(timeRow());
      body.append(foot(() => pick(todayIso)));
    } else if (view === 'clock') {
      body.append(timeRow(), el('div', { class: 'date-pop-foot' },
        el('button', { type: 'button', class: 'date-pop-link', onclick: clear }, 'Clear'),
        el('button', { type: 'button', class: 'date-pop-link', onclick: () => {
          const d = new Date();
          const now = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
          if (!range) { clocks.start = now; return commit(true); }
          if (picking === 'start') { clocks.start = now; clocks.end = ''; picking = 'end'; return draw(); }
          clocks.end = now; picking = 'start'; commit(true);
        } }, 'Now')));
    } else if (view === 'months') {
      body.append(el('div', { class: 'date-pop-head' },
        hasY ? el('button', { type: 'button', class: 'date-pop-title', onclick: () => { if (hasD) { view = 'days'; draw(); } else { view = 'years'; decadeBase = y; draw(); } } }, `${y}${hasD ? '' : ' ▾'}`) : el('span', { class: 'date-pop-title' }, 'Month'),
        el('span', { class: 'date-pop-spacer' }),
        ...(hasY ? [
          el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { y--; draw(); } }, iconEl('↑')),
          el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { y++; draw(); } }, iconEl('↓'))] : [])));
      body.append(el('div', { class: 'date-pick-grid' }, ...dc.MONTHS.map((name, i) => {
        const iso = `${y}-${pad(i + 1)}-01`;
        return el('button', {
          type: 'button', class: 'date-pick-cell' + (hasD ? (i + 1 === m ? ' sel' : '') : dayClass(iso).replace(' today', '')),
          onclick: () => {
            m = i + 1;
            if (hasD) { view = 'days'; draw(); return; }
            pick(iso);
          },
        }, name);
      })));
      if (!hasD && time) body.append(timeRow());
      if (!hasD) body.append(foot(() => { y = ty; m = tm; pick(`${ty}-${pad(tm)}-01`); }));
    } else {
      const years = dc.decade(decadeBase);
      body.append(el('div', { class: 'date-pop-head' },
        el('button', { type: 'button', class: 'date-pop-title', onclick: () => { if (hasM) { view = hasD ? 'days' : 'months'; draw(); } } }, `${years[0]}–${years[years.length - 1]}`),
        el('span', { class: 'date-pop-spacer' }),
        el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { decadeBase -= 10; draw(); } }, iconEl('↑')),
        el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { decadeBase += 10; draw(); } }, iconEl('↓'))));
      body.append(el('div', { class: 'date-pick-grid' }, ...years.map((yr) => {
        const iso = `${yr}-01-01`;
        return el('button', {
          type: 'button', class: 'date-pick-cell' + (hasM ? (yr === y ? ' sel' : '') : dayClass(iso).replace(' today', '')),
          onclick: () => {
            y = yr;
            if (hasM) { view = 'months'; draw(); return; }
            pick(iso);
          },
        }, String(yr));
      })));
      if (!hasM) body.append(foot(() => { y = ty; pick(`${ty}-01-01`); }));
    }
  }
  draw();
  const smarts = range ? [smartFor('start'), smartFor('end')] : [smartFor('start')];
  pop.append(...smarts, body);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (r.bottom + 6 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + 'px';
  dismissOutside({ open: () => pop.isConnected, inside: (t) => pop.contains(t), swallow: (t) => anchor.contains(t), close: () => pop.remove() });
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); pop.remove(); anchor.focus(); } });
  smarts[0].querySelector('.date-smart').focus();
  return pop;
}

function dsection(label, ...kids) {
  return el('div', { class: 'dlg-sec full' }, el('div', { class: 'dlg-lbl' }, label), ...kids);
}

function viewSection(db, dlg, changed, redraw) {
  const v = dlg.view ?? (dlg.view = fieldDialogCore.blankView());
  const previewBox = el('div', { class: 'wv-view-preview' }, el('span', { class: 'wv-muted' }, '…'));
  let sampleId = state.route?.page === 'entity' && state.route.dbId === db.id ? state.route.id : null;
  let timer = null;
  const refreshPreview = async () => {
    try {
      if (!sampleId) {
        const r = await api('POST', `/tables/${db.id}/query`, { limit: 1 });
        sampleId = r.items?.[0]?.id ?? null;
      }
      if (!sampleId) { previewBox.replaceChildren(el('span', { class: 'wv-muted' }, `No ${db.term?.singular ?? WeaveTerm.DEFAULT.singular} to preview yet.`)); return; }
      const cfg = { ...v, fields: Array.isArray(v.fields) ? v.fields : null };
      const view = await api('GET', `/entities/${sampleId}/view?shape=${encodeURIComponent(v.shape)}&config=${encodeURIComponent(JSON.stringify(cfg))}`);
      previewBox.replaceChildren(viewCell(view, { shape: v.shape }));
    } catch (err) {
      previewBox.replaceChildren(el('span', { class: 'wv-muted' }, err.message));
    }
  };
  const bump = () => { changed(); clearTimeout(timer); timer = setTimeout(refreshPreview, 120); };
  const sw = (key, label, hint) => el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
    el('input', { type: 'checkbox', class: 'form-check-input', checked: v[key] ? '' : undefined, onchange: (e) => { v[key] = e.target.checked; bump(); } }),
    el('span', { class: 'form-check-label' }, label, hint ? el('span', { class: 'fx-hint' }, ` ${hint}`) : ''));
  const auto = v.fields == null;
  const eligible = viewCore.eligibleFields(db);
  const pick = el('div', { class: 'wv-view-fields' + (auto ? ' auto' : '') },
    ...eligible.map((f) => {
      const on = !auto && v.fields.includes(f.name);
      return el('label', { class: 'form-check' },
        el('input', {
          type: 'checkbox', class: 'form-check-input', checked: on ? '' : undefined, disabled: auto ? '' : undefined,
          onchange: (e) => {
            const cur = Array.isArray(v.fields) ? v.fields.filter((n) => n !== f.name) : [];
            v.fields = e.target.checked ? [...cur, f.name] : cur;
            bump();
          },
        }),
        el('span', { class: 'form-check-label' }, f.name, el('span', { class: 'wv-tag' }, f.type)));
    }));
  const autoSw = el('label', { class: 'form-check full', style: 'margin:0 0 4px' },
    el('input', { type: 'checkbox', class: 'form-check-input', checked: auto ? '' : undefined, onchange: (e) => { v.fields = e.target.checked ? null : []; changed(); redraw(); } }),
    el('span', { class: 'form-check-label' }, 'The first few non-empty fields, in column order', el('span', { class: 'fx-hint' }, ' arranging the columns is the curation')));
  refreshPreview();
  return [
    dsection('How it will look', previewBox),
    dsection('Shows', sw('link', 'The #id, as a permalink'), sw('state', 'The workflow state, first')),
    dsection('Description preview', segCtl(fieldDialogCore.DESCRIPTION_SIZES, v.description ?? 'none', (id) => { v.description = id; bump(); })),
    dsection('Fields', autoSw, eligible.length ? pick : el('div', { class: 'wv-note' }, 'No other field can ride along yet.')),
  ];
}
function segCtl(options, value, onPick) {
  const wrap = el('div', { class: 'seg-ctl', role: 'group' });
  const norm = options.map((o) => (typeof o === 'string' ? { id: o, label: o } : o));
  const btns = norm.map((o) => el('button', {
    type: 'button', class: 'seg-opt', title: o.title ?? null,
    onclick: () => { mark(o.id); onPick(o.id); },
  }, o.label));
  const mark = (current) => btns.forEach((b, i) => b.classList.toggle('on', norm[i].id === current));
  mark(value);
  wrap.append(...btns);
  wrap.mark = mark;
  return wrap;
}

function huePopover(anchor, current, onPick, { reset = null, note = 'Stored as a name. A new option takes the next hue in ramp order.' } = {}) {
  const grid = el('div', { class: 'swatch-grid' },
    ...chipCore.HUES.map((h) => el('button', {
      type: 'button', class: `sw hue-${h}${h === 'slate' ? ' neutral' : ''}${h === current ? ' sel' : ''}`,
      title: h === 'slate' ? 'no colour' : h, 'aria-label': h,
      onclick: () => onPick(h),
    })));
  showPopover(anchor, [grid,
    reset ? el('button', { type: 'button', class: 'pick-reset', onclick: () => onPick(null) }, reset) : null,
    el('p', { class: 'pick-note' }, note)].filter(Boolean));
}
function glyphPopover(anchor, current, onPick) {
  searchPicker({
    anchor, title: 'Icon', placeholder: 'Search by name or category…',
    options: iconCatalogue(), grid: true, currentId: current ?? '',
    onPick: (o) => onPick(o.id || ''),
  });
}

function previewChip(cls, { icon, name }, placeholder) {
  const label = document.createTextNode(name || placeholder);
  const wrap = el('span', { class: 'opt-preview' },
    el('span', { class: cls }, icon ? iconEl(icon, 'ico wv-icon') : null, label));
  wrap.rename = (next) => { label.textContent = next || placeholder; };
  return wrap;
}
function optionPreview(o) {
  return previewChip(`k k-select hue-${o.hue ?? 'slate'}`, o, 'Option');
}
function statePreview(st) {
  const cat = chipCore.categoryOrDefault(st.category ?? 'in-progress');
  return previewChip(`k k-state cat-${cat} hue-${chipCore.stateHue(st, cat)}`, st, 'State');
}

function termSection(state, onChange) {
  const T = WeaveTerm;
  const face = el('button', { type: 'button', class: 'picker-face term-face', 'aria-haspopup': 'listbox' });
  const reset = el('button', { type: 'button', class: 'term-reset', title: `Back to ${WeaveTerm.cap(WeaveTerm.DEFAULT.singular)}` }, 'reset');
  const plur = el('input', { class: 'form-control term-plural', readonly: '', tabindex: '-1', title: 'derived from the singular', value: T.resolve({ term: state.term }).plural });
  const preview = el('div', { class: 'modal-note term-preview' });
  const draw = () => {
    const t = T.resolve({ term: state.term });
    face.replaceChildren(
      el('span', { class: 'k k-select hue-blue' }, T.cap(t.singular)),
      t.set ? '' : el('span', { class: 'term-default' }, 'the default'),
      el('span', { class: 'term-caret' }, iconEl('lucide:chevron-down', 'wv-icon wv-icon-xs')));
    reset.hidden = !t.set;
    plur.value = t.plural;
    preview.textContent = `“+ New ${t.singular}” · “${T.count(3, t)} selected” · “Deleted ${t.plural}”`;
  };
  const set = (singular) => {
    const s = String(singular ?? '').trim().toLowerCase();
    state.term = (!s || s === T.DEFAULT.singular) ? null : { singular: s, plural: T.pluralize(s) };
    draw(); onChange();
  };
  face.onclick = () => searchPicker({
    anchor: face, title: 'Rows in this table are…', placeholder: 'Search terms, or type your own…',
    options: T.options().map((o) => ({ id: o.id, label: o.label, group: o.group })),
    currentId: state.term?.singular ?? T.DEFAULT.singular,
    groups: true,
    custom: (q) => set(q),
    onPick: (o) => set(o.id),
  });
  reset.onclick = () => set(null);
  draw();
  return dsection('Rows in this table are…',
    el('div', { class: 'term-row' }, face, reset),
    el('div', { class: 'term-row term-plural-row' }, el('span', { class: 'term-tag' }, 'plural'), plur),
    preview);
}

function optRowGrip(wrap, list, i, commit) {
  const grip = RO().guard(el('span', { class: 'opt-grip', title: 'Drag to reorder' }, iconEl('lucide:grip-vertical', 'wv-icon')));
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const row = grip.closest('.opt-row');
    RO().sortable(e, {
      source: row,
      items: () => [...wrap.querySelectorAll(':scope > .opt-row')],
      zone: () => wrap,
      lock: true,
      onDrop: () => commit(fieldDialogCore.moveItem(list(), i, [...wrap.querySelectorAll(':scope > .opt-row')].filter((n) => !RO().lifting(n)).indexOf(row))),
    });
  });
  return grip;
}

function optionListEditor(state, onChange) {
  const wrap = el('div', { class: 'opt-list' });
  const draw = () => {
    wrap.replaceChildren(
      ...state.options.map((o, i) => {
        const hue = o.hue ?? chipCore.hueFromHex(o.color);
        const preview = optionPreview({ ...o, hue });
        return el('div', { class: 'opt-row' },
          optRowGrip(wrap, () => state.options, i, (next) => { state.options = next; draw(); onChange(); }),
          iconButton(o.icon || null, (id) => { o.icon = id ?? ''; draw(); onChange(); }),
          el('input', { class: 'opt-name', value: o.name, placeholder: 'Option', oninput: (e) => { o.name = e.target.value; preview.rename(o.name); onChange(); } }),
          (() => {
            const b = el('button', {
              type: 'button', class: `opt-color hue-${hue}${hue === 'slate' ? ' neutral' : ''}`, title: 'Choose a colour',
              onclick: () => huePopover(b, hue, (h) => { o.hue = h; o.color = chipCore.HUE_HEX[h]; draw(); onChange(); }),
            });
            return b;
          })(),
          preview,
          el('button', { type: 'button', class: 'opt-del', title: 'Remove option', onclick: () => { state.options.splice(i, 1); draw(); onChange(); } }, '✕'));
      }),
      el('button', {
        type: 'button', class: 'opt-add',
        onclick: () => {
          const hue = chipCore.hueForIndex(state.options.length);
          state.options.push({ name: '', hue, icon: '', color: chipCore.HUE_HEX[hue] });
          draw(); onChange();
        },
      }, '+ Add option'));
  };
  draw();
  return wrap;
}

function choiceDefaultControl(state, t) {
  const fdc = fieldDialogCore;
  const multi = t === 'multiselect';
  const chipCls = (x) => {
    if (t !== 'workflow') return `k k-select hue-${x.hue ?? chipCore.hueFromHex(x.color)}`;
    const cat = chipCore.categoryOrDefault(x.category ?? 'in-progress');
    return `k k-state cat-${cat} hue-${chipCore.stateHue(x, cat)}`;
  };
  const face = el('button', { type: 'button', class: 'form-select picker-face choice-default', 'aria-label': 'Default', 'aria-haspopup': 'listbox' });
  const named = () => fdc.choiceItems(state, t).filter((x) => x.name.trim());
  const draw = () => {
    const on = named().filter((x) => x.default);
    face.replaceChildren(...(on.length
      ? on.map((x) => el('span', { class: chipCls(x) }, x.name))
      : [el('span', { class: 'choice-default-none' }, 'No default')]));
  };
  face.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = named();
    const opts = list.map((x) => ({ id: x.id, label: x.name, cls: chipCls(x), chip: true }));
    const set = (ids) => { fdc.setChoiceDefault(state, t, ids); draw(); };
    if (multi) {
      searchPicker({
        anchor: face, title: 'Default', placeholder: 'Search options…', options: opts,
        multi: { selected: opts.filter((o) => list.find((x) => x.id === o.id).default), onCommit: set },
      });
    } else {
      searchPicker({
        anchor: face, title: 'Default', placeholder: t === 'workflow' ? 'Search states…' : 'Search options…',
        options: [{ id: 'none', label: 'No default' }, ...opts],
        currentId: list.find((x) => x.default)?.id ?? 'none',
        onPick: (o) => set(o.id === 'none' ? [] : [o.id]),
      });
    }
  });
  draw();
  face.draw = draw;
  return face;
}

function stateListEditor(state, onChange) {
  const fdc = fieldDialogCore;
  const wrap = el('div', { class: 'opt-list' });
  const draw = () => {
    wrap.replaceChildren(
      ...state.states.map((s, i) => {
        const preview = statePreview(s);
        const row = el('div', { class: 'opt-row' },
        optRowGrip(wrap, () => state.states, i, (next) => { state.states = next; draw(); onChange(); }),
        iconButton(s.icon || null, (id) => { s.icon = id ?? ''; draw(); onChange(); }),
        el('input', { class: 'opt-name', value: s.name, placeholder: 'State', oninput: (e) => { s.name = e.target.value; preview.rename(s.name); onChange(); } }),
        (() => {
          const cat = pickerSelect({ name: `wf-cat-${i}`, options: fdc.STATE_CATEGORIES.map((c) => ({ id: c, label: c })), value: chipCore.categoryOrDefault(s.category ?? 'in-progress') });
          cat.classList.add('opt-cat');
          cat.input.addEventListener('change', () => { s.category = cat.input.value; draw(); onChange(); });
          return cat;
        })(),
        (() => {
          const cat = chipCore.categoryOrDefault(s.category ?? 'in-progress');
          const hue = chipCore.stateHue(s, cat);
          const b = el('button', {
            type: 'button', class: `opt-color hue-${hue}${hue === 'slate' ? ' neutral' : ''}`,
            title: s.hue ? 'Choose a colour' : `Colour comes from the ${cat} category`,
            'aria-label': `Colour: ${hue}`,
            onclick: () => huePopover(b, hue, (h) => {
              if (h) s.hue = h; else delete s.hue;
              draw(); onChange();
            }, {
              reset: s.hue ? 'Reset to category colour' : null,
              note: `Without one, a state wears the ${cat} category colour.`,
            }),
          });
          return b;
        })(),
        preview,
        el('button', { type: 'button', class: 'opt-del', title: 'Remove state', onclick: () => { state.states.splice(i, 1); draw(); onChange(); } }, '✕'));
        for (const ctl of row.querySelectorAll('input,button,.picker-wrap')) ctl.addEventListener('mousedown', (e) => e.stopPropagation());
        return row;
      }),
      el('button', {
        type: 'button', class: 'opt-add',
        onclick: () => { state.states.push({ name: '', category: 'in-progress' }); draw(); onChange(); wrap.querySelectorAll('.opt-name')[state.states.length - 1]?.focus(); },
      }, '+ Add state'));
  };
  draw();
  return wrap;
}

function formulaBuilder(db, state, onChange, { selfName = null, fieldName = () => selfName ?? '', onType = null, onTail = null } = {}) {
  const ta = el('textarea', {
    class: 'fx-expr', rows: 3, spellcheck: 'false',
    placeholder: 'e.g. if(Estimate > 5, "big", "small")',
  });
  ta.value = state.expression ?? '';
  const status = el('div', { class: 'fx-status' });
  const scanNote = el('span', { class: 'fx-scan' });
  const pickLabel = el('span', { class: 'fx-rowpick-lbl' });
  const prevBtn = el('button', { type: 'button', class: 'prev', 'aria-label': 'Previous row', onclick: () => step(-1) }, '‹');
  const nextBtn = el('button', { type: 'button', class: 'next', 'aria-label': 'Next row', onclick: () => step(1) }, '›');
  const rowpick = el('div', { class: 'fx-rowpick', hidden: '' }, prevBtn, pickLabel, nextBtn, scanNote);
  let rows = [], idx = 0, lastScan = null, lastType = null;
  let seq = 0, timer;
  const fmt = (v) => (typeof v === 'string' ? JSON.stringify(v) : v === null || v === undefined ? 'null' : Array.isArray(v) ? JSON.stringify(v) : String(v));
  const drawPick = () => {
    rowpick.hidden = !rows.length;
    pickLabel.textContent = rows.length ? `row ${idx + 1} of ${rows.length} — ${JSON.stringify(rows[idx].name ?? '')}` : '';
    prevBtn.disabled = nextBtn.disabled = rows.length < 2;
    const parts = [];
    if (lastScan?.nulls) parts.push(`${lastScan.nulls} row${lastScan.nulls === 1 ? '' : 's'} → null`);
    if (lastScan?.errors) parts.push(`${lastScan.errors} → #ERR`);
    scanNote.textContent = parts.length ? `⚠ ${parts.join(' · ')}${lastScan.capped ? ' (first 200 rows)' : ''}` : '';
  };
  const setType = (t) => { if (t !== lastType) { lastType = t; onType?.(t); } };
  const runCheck = async ({ scan = true } = {}) => {
    const expr = (state.expression ?? '').trim();
    const mine = ++seq;
    if (!expr) { status.className = 'fx-status'; status.textContent = ''; lastScan = null; drawPick(); return; }
    try {
      const r = await api('POST', `/tables/${db.id}/formula-check`, { expression: expr, excludeField: selfName, scan, entity: rows[idx]?.id ?? null });
      if (mine !== seq) return;
      status.className = 'fx-status ' + (r.ok ? 'ok' : 'err');
      status.replaceChildren();
      if (!r.ok) { status.textContent = r.error; lastScan = null; drawPick(); return; }
      if (!('preview' in r)) { status.textContent = '✓ valid'; drawPick(); return; }
      status.append(`= ${fmt(r.preview)}`, ' ', el('span', { class: 'fx-type' }, r.type), r.previewEntity ? `   (${r.previewEntity})` : '');
      if (scan) lastScan = r.scan ?? null;
      setType(r.type);
      drawPick();
    } catch (err) {
      if (mine !== seq) return;
      status.className = 'fx-status err';
      status.textContent = err.message;
    }
  };
  const step = (d) => { if (rows.length < 2) return; idx = (idx + d + rows.length) % rows.length; drawPick(); runCheck({ scan: false }); };
  const ac = el('div', { class: 'fx-ac', hidden: '' });
  const mirror = el('div', { class: 'fx-ac-mirror', 'aria-hidden': 'true' });
  let sugg = null, sel = 0;
  const hideAc = () => { ac.hidden = true; sugg = null; };
  const caretBox = () => {
    const cs = getComputedStyle(ta);
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'padding', 'border', 'boxSizing', 'whiteSpace', 'wordWrap']) mirror.style[k] = cs[k];
    mirror.style.width = ta.clientWidth + 'px';
    mirror.textContent = ta.value.slice(0, ta.selectionStart ?? 0);
    const mark = el('span', {}, '\u200b');
    mirror.append(mark);
    return { left: mark.offsetLeft, top: mark.offsetTop - ta.scrollTop + parseFloat(cs.lineHeight || cs.fontSize) * 1.2 };
  };
  const applyAc = () => {
    const item = sugg?.items[sel];
    if (!item) return;
    const r = fieldDialogCore.formulaApply(ta.value, sugg, item);
    ta.value = r.text;
    ta.setSelectionRange(r.caret, r.caret);
    hideAc();
    state.expression = ta.value; onChange(); queueCheck(); drawAgent();
  };
  const drawAc = () => {
    sugg = fieldDialogCore.formulaSuggest(ta.value, ta.selectionStart ?? ta.value.length, db.fields, selfName);
    if (!sugg.kind) return hideAc();
    sel = Math.min(sel, sugg.items.length - 1);
    ac.replaceChildren(...sugg.items.map((it, i) => el('div', {
      class: 'fx-ac-item' + (i === sel ? ' sel' : ''), role: 'option',
      onmousedown: (e) => { e.preventDefault(); sel = i; applyAc(); },
    }, el('span', { class: 'k' }, it.label), el('span', { class: 't' }, it.detail))));
    const box = caretBox();
    ac.style.left = Math.min(box.left, Math.max(0, ta.clientWidth - 240)) + 'px';
    ac.style.top = box.top + 'px';
    ac.hidden = false;
  };
  ta.addEventListener('input', () => { sel = 0; drawAc(); });
  ta.addEventListener('blur', hideAc);
  ta.addEventListener('keydown', (e) => {
    if (ac.hidden || !sugg) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % sugg.items.length; drawAc(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + sugg.items.length) % sugg.items.length; drawAc(); e.preventDefault(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { applyAc(); e.preventDefault(); }
    else if (e.key === 'Escape') { hideAc(); e.preventDefault(); e.stopPropagation(); }
  });
  api('GET', `/tables/${db.id}/entities?limit=200`).then((r) => { rows = (r.items ?? []).map((e) => ({ id: e.id, name: e.name })); drawPick(); }).catch(() => {});
  const queueCheck = () => { clearTimeout(timer); timer = setTimeout(runCheck, 250); };
  const agentPre = el('pre', {});
  const agent = el('div', { class: 'fx-agent' }, el('details', {}, el('summary', {}, 'As an agent would do it'), agentPre));
  const drawAgent = () => {
    agentPre.textContent = fieldDialogCore.agentRecipe({ table: db.name, field: fieldName(), expression: state.expression, edit: !!selfName }).text;
  };
  agent.addEventListener('refresh', drawAgent);
  ta.addEventListener('input', () => { state.expression = ta.value; onChange(); queueCheck(); drawAgent(); });
  const insert = (text, cursorBack = 0) => {
    const at = ta.selectionStart ?? ta.value.length;
    ta.setRangeText(text, at, ta.selectionEnd ?? at, 'end');
    if (cursorBack) {
      const p = ta.selectionStart - cursorBack;
      ta.setSelectionRange(p, p);
    }
    state.expression = ta.value;
    ta.focus();
    onChange();
    queueCheck();
    drawAgent();
  };
  const card = el('div', { class: 'fx-sigcard', hidden: '' },
    el('div', { class: 'sig' }), el('div', { class: 'doc' }), el('div', { class: 'eg' }));
  const showCard = ({ sig, doc, eg }) => {
    card.querySelector('.sig').textContent = sig;
    card.querySelector('.doc').textContent = doc;
    card.querySelector('.eg').textContent = eg ?? '';
    card.querySelector('.eg').hidden = !eg;
    card.hidden = false;
  };
  const hideCard = () => { card.hidden = true; };
  const teach = (btn, info) => {
    btn.addEventListener('mouseenter', () => showCard(info));
    btn.addEventListener('focus', () => showCard(info));
    btn.addEventListener('mouseleave', () => { if (document.activeElement !== btn) hideCard(); });
    btn.addEventListener('blur', hideCard);
    return btn;
  };
  const fieldChips = fieldDialogCore.formulaFieldChoices(db.fields, selfName)
    .map((x) => teach(el('button', {
      type: 'button', class: 'fx-chip' + (x.excluded ? ' excluded' : ''),
      disabled: x.excluded ? '' : undefined,
      'aria-label': x.excluded ? `${x.name}: ${x.excluded}` : undefined,
      onclick: () => { if (!x.excluded) insert(x.token); },
    }, x.name), { sig: `${x.token} · ${x.type}`, doc: x.excluded ?? `The ${x.type} value of this row's ${x.name}.`, eg: x.excluded ? null : x.token }));
  const fnRows = fieldDialogCore.formulaFunctionGroups().map(({ group, fns }) =>
    el('div', { class: 'fx-chip-row fn-group' }, el('span', { class: 'fx-chip-lbl' }, group),
      ...fns.map((fn) => teach(el('button', { type: 'button', class: 'fx-chip fn', onclick: () => insert(`${fn.name}()`, 1) }, `${fn.name}()`),
        { sig: fn.sig, doc: fn.doc, eg: fn.example }))));
  const written = !!(state.expression ?? '').trim();
  if (written) runCheck();
  drawAgent();
  const reference = el('details', { class: 'fx-ref', ...(written ? {} : { open: '' }) },
    el('summary', {}, 'Fields and functions', el('span', { class: 'fx-ref-hint' }, 'or type [ for a field, two letters for a function')),
    el('div', { class: 'fx-chip-rows' },
      el('div', { class: 'fx-chip-row' }, el('span', { class: 'fx-chip-lbl' }, 'fields'), ...fieldChips),
      ...fnRows),
    card);
  onTail?.(el('div', { class: 'fx-tail full' }, reference, agent));
  return el('div', {},
    el('div', { class: 'fx-ac-wrap' }, ta, mirror, ac),
    status,
    rowpick);
}

function dateCostumeControls(state, redraw, changed, { type = 'date' } = {}) {
  const fdc = fieldDialogCore;
  const dc = weaveDateCore;
  const d = state.date;
  const g = d.grain;
  const kids = [];
  const todayIso = dc.todayIso();
  const costume = fdc.dateCostume(d, type);
  const parts = ['year', 'month', 'day'].filter((p) => g[p]);
  const tick = (key, label, on, flip) => el('label', { class: 'form-check' },
    el('input', { type: 'checkbox', class: 'form-check-input', checked: on ? '' : undefined, onchange: (e) => { flip(e.target.checked); redraw(); changed(); } }),
    el('span', { class: 'form-check-label' }, label));
  const setPart = (key) => (on) => {
    g[key] = on;
    if (g.year && g.day && !g.month) g.month = true;
    if (!g.year && !g.month && !g.day) d.time = true;
    if (!fdc.legalFormats(g).includes(d.format)) d.format = 'iso';
  };
  let stored = '';
  try { stored = parts.length ? dc.coerce({ ...costume, time: false }, todayIso) : ''; } catch { stored = ''; }
  const storesHint = parts.length
    ? `Stores ${parts.join(' · ')}${d.time ? ' + a time of day' : ''} — today would be ${stored}${d.time ? 'T14:30' : ''}`
    : 'No date parts: a time of day, stored and compared as a clock reading.';
  kids.push(dsection('Stores',
    el('div', { class: 'date-grain' }, tick('year', 'Year', g.year, setPart('year')), tick('month', 'Month', g.month, setPart('month')), tick('day', 'Day', g.day, setPart('day')),
      tick('time', 'Time of day', d.time, (on) => { d.time = on; if (!on && !parts.length) g.year = g.month = g.day = true; if (!on) { d.clock = weaveDateGrain.DEFAULT_CLOCK; d.zone = 'floating'; d.elapsed = false; } })),
    el('div', { class: 'hintnote' }, storesHint)));
  const legal = fdc.legalFormats(g);
  if (legal.length) {
    kids.push(dsection('Format', el('div', { class: 'date-format-list' }, ...legal.map((fmt) => el('button', {
      type: 'button', class: 'date-format-opt' + ((d.format ?? weaveDateGrain.DEFAULT_FORMAT) === fmt ? ' on' : ''),
      onclick: () => { d.format = fmt; redraw(); changed(); },
    }, el('span', { class: 'date-format-id' }, fmt), el('span', { class: 'date-format-eg' }, dc.formatDate(todayIso, { ...costume, format: fmt, time: false })))))));
    if (['us', 'eu'].includes(d.format)) {
      kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
        el('input', { type: 'checkbox', class: 'form-check-input', checked: d.pad ? '' : undefined, onchange: (e) => { d.pad = e.target.checked; redraw(); changed(); } }),
        el('span', { class: 'form-check-label' }, 'Zero-pad numerals ', el('span', { class: 'date-format-eg' }, dc.formatDate(todayIso, { ...costume, format: d.format, pad: true, time: false })))));
    }
  }
  if (d.time) {
    kids.push(dsection('Clock', segCtl(fdc.CLOCKS.map((id) => ({ id, label: dc.formatDate(todayIso + 'T14:30', { ...costume, clock: id, time: true }).split(' ').slice(parts.length ? 1 : 0).join(' ') })), d.clock ?? weaveDateGrain.DEFAULT_CLOCK, (v) => { d.clock = v; redraw(); changed(); })));
    const zoneHint = {
      floating: 'The wall clock as typed, no zone stored — 09:15 is 09:15 everywhere. What every field did before.',
      fixed: 'The zone travels with the field: a store opening at 09:15 PT opens at 09:15 PT for a reader in Berlin.',
      instant: 'Stored as a UTC instant and shown in each reader\'s own zone — a meeting, an audit stamp.',
    };
    const zoneSec = dsection('Zone', segCtl(fdc.ZONES, d.zone ?? 'floating', (v) => { d.zone = v; if (v === 'fixed' && !d.zoneName) d.zoneName = LOCAL_ZONE; redraw(); changed(); }),
      el('div', { class: 'hintnote' }, zoneHint[d.zone ?? 'floating']));
    if (d.zone === 'fixed') {
      let zones = [];
      try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = [LOCAL_ZONE]; }
      const list = el('datalist', { id: 'wv-zones' }, ...zones.map((z) => el('option', { value: z })));
      zoneSec.append(el('input', {
        class: 'form-control date-zone-name', list: 'wv-zones', value: d.zoneName ?? '', placeholder: LOCAL_ZONE,
        onchange: (e) => { d.zoneName = e.target.value.trim(); changed(); },
      }), list);
    }
    kids.push(zoneSec);
    if (type === 'daterange') {
      kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
        el('input', { type: 'checkbox', class: 'form-check-input', checked: d.elapsed ? '' : undefined, onchange: (e) => { d.elapsed = e.target.checked; changed(); } }),
        el('span', { class: 'form-check-label' }, 'Show elapsed time ', el('span', { class: 'date-format-eg' }, '09:15 – 17:40 · 8h 25m'))));
    }
  }
  return kids;
}

function numberCostumeControls(state, redraw, changed, { label = 'Format', column = null } = {}) {
  const fdc = fieldDialogCore;
  const n = state.number;
  const kids = [];
  kids.push(dsection(label, segCtl(fdc.NUMBER_FORMATS, n.format ?? 'number', (v) => { n.format = v; redraw(); changed(); })));
  if ((n.format ?? 'number') === 'number') {
    kids.push(dsection('Unit', el('input', { class: 'form-control', value: n.unit ?? '', placeholder: 'days, feet, kg …', oninput: (e) => { n.unit = e.target.value; changed(); } })));
  } else if (n.format === 'currency' || n.format === 'compact') {
    const known = fdc.CURRENCIES.some((c) => c.id === n.currency);
    const options = known ? fdc.CURRENCIES : [{ id: n.currency, label: n.currency }, ...fdc.CURRENCIES];
    const pick = pickerSelect({ name: 'currency', options, value: n.currency ?? 'USD' });
    pick.input.addEventListener('change', () => { n.currency = pick.input.value; changed(); });
    kids.push(dsection('Currency', pick, el('div', { class: 'hintnote' }, n.format === 'compact'
      ? 'Abbreviated by code — $1.2M, €4.8K — or leave the currency off for a plain 1.2M'
      : 'Formatted by code — $149.50, €1,200 — separate from units')));
  }
  kids.push(dsection('Decimals', el('input', {
    type: 'number', min: 0, max: 6, class: 'form-control dlg-narrow', value: n.decimals ?? '', placeholder: n.format === 'currency' ? '2' : n.format === 'compact' ? '1' : '0',
    oninput: (e) => { n.decimals = e.target.value === '' ? null : Number(e.target.value); changed(); },
  })));
  if (n.format !== 'currency' && n.format !== 'compact') {
    kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
      el('input', { type: 'checkbox', class: 'form-check-input', checked: n.separator ? '' : undefined, onchange: (e) => { n.separator = e.target.checked; changed(); } }),
      el('span', { class: 'form-check-label' }, 'Add 1,000 separator')));
  }
  if (n.format === 'currency') {
    kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
      el('input', { type: 'checkbox', class: 'form-check-input', checked: n.accounting ? '' : undefined, onchange: (e) => { n.accounting = e.target.checked; changed(); } }),
      el('span', { class: 'form-check-label' }, 'Accounting negatives ', el('span', { class: 'date-format-eg' }, '($1,234.57)'))));
  }
  kids.push(...numberDisplayControls(n, redraw, changed, column));
  return kids;
}

function colorPicker(current, sample, onPick) {
  const fdc = fieldDialogCore;
  const wrap = el('div', { class: 'wv-color-pick', role: 'group', 'aria-label': 'Color' });
  const btns = fdc.CELL_COLORS.map((c) => el('button', {
    type: 'button', class: 'wv-color-opt', dataset: { color: c }, 'aria-pressed': String(c === (current ?? 'ink')),
    title: fdc.CELL_COLOR_LABELS[c],
    onclick: () => { for (const b of btns) b.setAttribute('aria-pressed', String(b === btn(c))); onPick(c); },
  }, el('span', { class: 'wv-color-sample', 'aria-hidden': 'true' }, sample(c)), el('span', { class: 'wv-color-label' }, fdc.CELL_COLOR_LABELS[c])));
  const btn = (c) => btns[fdc.CELL_COLORS.indexOf(c)];
  wrap.append(...btns);
  return wrap;
}

const SPARK_STYLE_LABELS = { line: 'line', column: 'column', winloss: 'win/loss' };
const SPARK_SAMPLE = [3, 5, 4, 7, 6, 9, 8, 11, 10, 12];
const SPARK_SAMPLE_WL = [1, -1, 1, 1, -1, 1, -1, -1, 1, 1];
function sparklineControls(n, redraw, changed, column = null) {
  const on = n.display === 'sparkline';
  const out = [dsection('Display', segCtl([{ id: 'text', label: 'text' }, { id: 'sparkline', label: 'sparkline' }], on ? 'sparkline' : 'text',
    (v) => { n.display = v; if (v !== 'sparkline') n.style = 'line'; redraw(); changed(); }))];
  if (!on) return out;
  const style = n.style ?? 'line';
  const swatches = el('div');
  const sample = el('div', { class: 'cg-preview cg-spark-preview' });
  const note = el('div');
  const draw = () => {
    if (column && !column.seriesAnswered) { sample.replaceChildren(); swatches.replaceChildren(); note.replaceChildren(); return; }
    const own = column?.series ?? null;
    const series = own ?? (style === 'winloss' ? SPARK_SAMPLE_WL : SPARK_SAMPLE);
    swatches.replaceChildren(colorPicker(n.color, (c) => sparkEl(style, series, c), (c) => { n.color = c; redraw(); changed(); }));
    sample.replaceChildren(sparkEl(style, series, n.color) ?? '');
    note.replaceChildren(own
      ? el('div', { class: 'hintnote cg-preview-from' }, `${column.seriesRow}: ${own.length} value${own.length === 1 ? '' : 's'}, oldest first`)
      : el('div', { class: 'hintnote cg-preview-note' }, 'Example series. No row of this column holds a list yet.'));
  };
  draw();
  if (column) column.loadSeries().then(draw, () => {});
  out.push(dsection('Color', swatches));
  out.push(dsection('Style', segCtl(fieldDialogCore.SPARKLINE_STYLES.map((id) => ({ id, label: SPARK_STYLE_LABELS[id] })), style,
    (v) => { n.style = v; redraw(); changed(); })));
  out.push(dsection('Sample', sample, note));
  return out;
}

function numberDisplayControls(n, redraw, changed, column = null) {
  const display = n.display ?? 'text';
  const out = [dsection('Display', segCtl(fieldDialogCore.NUMBER_DISPLAYS, display, (v) => { n.display = v; redraw(); changed(); }))];
  if (!cellGraphics.isGraphic(display)) return out;
  const fixed = typeof n.scale === 'number';
  const scaleBox = el('input', {
    type: 'number', min: 0, step: 'any', class: 'form-control dlg-narrow', 'aria-label': 'Fixed scale',
    value: fixed ? n.scale : '', placeholder: '100',
    oninput: (e) => { const v = Number(e.target.value); n.scale = e.target.value !== '' && v > 0 ? v : 'column'; drawPreview(); changed(); },
  });
  const preview = el('div', { class: 'cg-preview', 'aria-label': 'Sample rows' });
  const noteBox = el('div');
  const swatches = el('div');
  const drawPreview = () => {
    if (column && !column.answered) { preview.replaceChildren(); noteBox.replaceChildren(); return; }
    const summary = column?.summary ?? null;
    const scale = numberCore.sampleScale(summary, n.scale, n);
    const { values, example } = numberCore.sampleFigures(summary, n.scale, n);
    const draw = (value, color) => numberGraphic(display, value, scale, String(numberCore.dressNumber(n, value)), n, color);
    preview.replaceChildren(...values.map((value) => el('div', { class: 'cg-preview-row' }, draw(value, n.color))));
    const mid = values[Math.floor(values.length / 2)];
    swatches.replaceChildren(colorPicker(n.color, (c) => draw(mid, c), (c) => { n.color = c; drawPreview(); changed(); }));
    noteBox.replaceChildren(example
      ? el('div', { class: 'hintnote cg-preview-note' }, 'Example figures. This column holds no numbers yet.')
      : '');
  };
  drawPreview();
  if (column) column.load().then(drawPreview, () => {});
  out.push(dsection('Color', swatches));
  out.push(dsection('Scale',
    segCtl([{ id: 'column', label: 'column max' }, { id: 'fixed', label: 'fixed' }], fixed ? 'fixed' : 'column', (v) => {
      n.scale = v === 'fixed' ? (n.format === 'percent' ? 1 : 100) : 'column';
      redraw(); changed();
    }),
    fixed ? scaleBox : el('div', { class: 'hintnote' }, "100% is the column's largest value")));
  out.push(dsection('Sample', preview, noteBox));
  return out;
}

function computedShowsAs(db, f, after) {
  const rel = f.via ? db.fields.find((x) => x.type === 'relation' && x.name === f.via) : null;
  const far = allTables().find((d) => d.id === (f.viaTableId ?? rel?.targetDbId));
  const source = f.targetField ? far?.fields?.find((x) => x.name === f.targetField) : null;
  const owner = source ? `${far.name} › ${source.name}` : null;
  const counts = f.type === 'rollup' && ['count', 'distinct', 'filled', 'empty'].includes(f.aggregate ?? 'count');
  let words;
  if (f.rating) {
    const icon = String(f.rating.icon ?? 'lucide:star').replace(/^lucide:/, '');
    words = `Drawn as the rating on ${owner ?? f.targetField}: ${f.rating.max} ${icon}${f.rating.max === 1 ? '' : 's'}.`;
  } else if (cellGraphics.isGraphic(f.display)) {
    words = `Drawn as a ${f.display} from ${owner ?? f.targetField}, on ${typeof f.scale === 'number' ? `a fixed scale of ${f.scale}` : 'the column max'}.`;
  } else if (counts) {
    words = 'A count, in plain figures.';
  } else {
    words = owner ? `Values from ${owner}, in that field’s format.` : 'Plain text.';
  }
  const link = source && !counts ? el('a', {
    href: '#',
    onclick: (e) => { e.preventDefault(); fieldDialog(far, source, after); },
  }, `Open ${source.name} settings`) : null;
  const result = el('div', {}, el('span', { class: 'hintnote' }, 'Reading the rows…'));
  api('POST', `/tables/${db.id}/query`, { limit: 50 }).then((res) => {
    const blank = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);
    const row = (res.items ?? []).find((it) => !blank(it.raw?.[f.name]));
    if (!row) return result.replaceChildren(el('span', { class: 'hintnote' }, 'No row has a value yet.'));
    const raw = row.raw[f.name];
    const text = row.fields?.[f.name];
    const drawn = f.rating && typeof raw === 'number' ? ratingEl(f.rating.max, f.rating.icon, raw, { color: f.rating.color })
      : f.rating && Array.isArray(raw) && raw.length ? ratingListEl(f.rating, raw, { label: f.name })
      : numberGraphicFor(f, row, text) ?? (Array.isArray(text) ? text.join(', ') : String(text ?? raw));
    result.replaceChildren(el('span', { class: 'hintnote' }, `${row.name || 'Untitled'}: `), drawn);
  }).catch(() => result.replaceChildren(el('span', { class: 'hintnote' }, 'The rows could not be read.')));
  return [
    dsection('Result', result),
    dsection('Shows as',
      el('div', {}, words),
      link ? el('div', { class: 'hintnote' }, `A ${f.type} takes its look from the field it reads, so change it on ${source.name}. `, link) : null),
  ];
}

function fieldDialog(db, existing, after) {
  const fdc = fieldDialogCore;
  const isEdit = !!existing;

  const state = isEdit ? fdc.stateFromDefinition(fdc.definitionFromFieldView(existing)) : fdc.blankState('text');
  if (isEdit && existing.type === 'formula') state.computed = 'formula';

  const column = isEdit && existing?.name ? {
    summary: null,
    answered: false,
    pending: null,
    load() {
      return (this.pending ??= api('GET', `/tables/${db.id}/stats`)
        .then((st) => { this.summary = st.columns?.find((c) => c.name === existing.name)?.summary ?? null; })
        .catch(() => { this.summary = null; })
        .then(() => { this.answered = true; }));
    },
    series: null,
    seriesRow: null,
    seriesAnswered: false,
    seriesPending: null,
    loadSeries() {
      return (this.seriesPending ??= api('POST', `/tables/${db.id}/query`, { where: [[existing.name, 'not-empty']], limit: 50 })
        .then((res) => {
          const row = (res.items ?? []).find((it) => (Array.isArray(it.raw?.[existing.name]) ? it.raw[existing.name] : []).filter((v) => typeof v === 'number').length >= 2);
          if (row) { this.series = row.raw[existing.name]; this.seriesRow = row.name || 'Untitled'; }
        })
        .catch(() => { this.series = null; })
        .then(() => { this.seriesAnswered = true; }));
    },
  } : null;

  const nameInput = el('input', {
    name: 'name', placeholder: 'Field name', class: 'form-control',
    value: existing?.name ?? '',
  });

  const describable = !(isEdit && existing.type === 'view');
  const descInput = el('textarea', {
    name: 'description', class: 'form-control field-desc', rows: '2',
    placeholder: 'What this field holds and how it is written — shown under the label and to agents in the schema',
  });
  descInput.value = fieldDescription(existing) || '';
  const gridWrap = el('div', { class: 'full' });
  const cfgWrap = el('div', { class: 'full' });
  nameInput.addEventListener('input', () => cfgWrap.querySelector('.fx-agent')?.dispatchEvent(new Event('refresh')));
  const changed = () => {};

  let choices = fdc.typeChoices(isEdit ? existing.type : null);
  if (isEdit && existing.role === 'name') choices = choices.filter((t) => t.id === 'text' || t.id === existing.type);
  const migratable = isEdit && choices.length > 1;
  function pickType(id) {
    state.computed = false;
    if (isEdit && id !== state.type) Object.assign(state, fdc.migrateState(state, id));
    else {
      state.type = id;
      if (id === 'workflow' && !state.states.length) state.states = fdc.blankState('workflow').states;
    }
    drawGrid(); drawCfg(); changed();
  }
  function drawGrid() {
    const tiles = choices.map((t) => el('button', {
      type: 'button',
      class: 'type-tile' + (state.type === t.id && !state.computed ? ' sel' : '') + (t.computed ? ' computed' : '')
        + (isEdit && t.id === existing.type ? ' current' : ''),
      disabled: isEdit && choices.length <= 1 ? '' : undefined,
      title: isEdit && t.id !== existing.type ? `Convert to ${t.id} — values are migrated in place` : (t.computed ? `${t.id} (computed)` : t.id),
      onclick: () => pickType(t.id),
    }, el('span', { class: 'type-ic' }, iconEl(t.icon) ?? t.icon), t.label));
    const fx = el('label', { class: 'fx-toggle' + (state.computed ? ' on' : '') },
      el('input', {
        type: 'checkbox', class: 'form-check-input', checked: state.computed ? '' : undefined, disabled: isEdit && !['text', 'formula'].includes(existing.type) ? '' : undefined,
        onchange: (e) => {
          state.computed = e.target.checked ? 'formula' : false;
          drawGrid(); drawCfg(); changed();
          if (state.computed) cfgWrap.querySelector('.fx-expr')?.focus();
        },
      }),
      el('span', { class: 'fx-mark' }, 'ƒ'), 'Formula',
      el('span', { class: 'fx-hint' }, isEdit && existing.type === 'formula'
        ? 'untick to freeze each row’s result into plain text'
        : 'compute this field from the row’s other fields instead of typing it'));
    let note = '';
    if (isEdit && state.type !== existing.type && !state.computed) {
      note = el('div', { class: 'modal-note migrate-note' }, `Saving converts this ${existing.type} field to ${state.type}; every row's value is migrated in place.`);
    } else if (isEdit && !migratable) {
      note = el('div', { class: 'modal-note' }, existing.role === 'name' ? 'a name is text, or a formula (ƒ below)'
        : existing.type === 'view' ? `the ${existing.shape ?? existing.role}: how every ${db.term?.singular ?? WeaveTerm.DEFAULT.singular} appears ${existing.role === 'card' ? 'as a tile' : 'inline'} — rename it, configure it, never delete it`
        : `${existing.type} field — the type is fixed`);
    } else if (isEdit) {
      note = el('div', { class: 'modal-note' }, `${existing.type} field — it can also become ${choices.slice(1).map((t) => t.id).join(', ')}`);
    }
    gridWrap.replaceChildren(
      tiles.length ? dsection(isEdit ? 'Type' : 'Type', el('div', { class: 'type-grid' + (isEdit ? ' editing' : '') }, ...tiles)) : '',
      (!isEdit || ['text', 'formula'].includes(existing.type)) ? fx : '',
      note);
  }

  function drawCfg() {
    const kids = [];
    if (state.computed === 'formula') {
      const costumeWrap = el('div', { class: 'full' });
      let resultType = null, fxTail = null;
      const drawCostume = () => costumeWrap.replaceChildren(...(state.type === 'date' ? dateCostumeControls(state, drawCostume, changed)
        : resultType === 'list' || state.number.display === 'sparkline'
        ? sparklineControls(state.number, drawCostume, changed, column)
        : resultType === null || resultType === 'number' ? numberCostumeControls(state, drawCostume, changed, { label: 'Result format', column }) : []));
      kids.push(dsection('Script', formulaBuilder(db, state, changed, { selfName: existing?.name ?? null, fieldName: () => nameInput.value, onType: (t) => { resultType = t; drawCostume(); }, onTail: (tail) => { fxTail = tail; } })));
      drawCostume();
      kids.push(costumeWrap, fxTail);
    } else {
      const t = state.type;
      if (isEdit && existing.role === 'name') kids.push(termSection(state, changed));
      const choice = ['select', 'multiselect', 'workflow'].includes(t) ? choiceDefaultControl(state, t) : null;
      const listChanged = () => { choice?.draw(); changed(); };
      if (t === 'select' || t === 'multiselect') {
        kids.push(dsection('Options', optionListEditor(state, listChanged)));
      } else if (t === 'workflow') {
        kids.push(dsection('States', stateListEditor(state, listChanged)));
      } else if (t === 'number') {
        kids.push(...numberCostumeControls(state, drawCfg, changed, { column }));
      } else if (t === 'date' || t === 'daterange') {
        kids.push(...dateCostumeControls(state, drawCfg, changed, { type: t }));
      } else if (t === 'relation') {
        if (isEdit) {
          kids.push(el('div', { class: 'modal-note full' }, `→ ${existing.targetDb}${existing.many ? ' (many)' : ''} — repoint by deleting and recreating`));
        } else {
          const r = state.relation;
          const tables = allTables();
          r.targets = r.targets?.length ? r.targets : [r.targetDb || (tables[0]?.id ?? '')];
          const targetsBox = el('div', { class: 'target-set' });
          const drawTargets = () => {
            targetsBox.replaceChildren();
            r.targets.forEach((tid, i) => {
              const sel = pickerSelect({ name: `target-${i}`, placeholder: 'Choose a table…', options: tables.map((d) => ({ id: d.id, label: d.qualified })), value: tid });
              sel.input.addEventListener('change', () => { r.targets[i] = sel.input.value; syncTargets(); });
              const row = el('div', { class: 'target-set-row' }, sel);
              if (r.targets.length > 1) {
                row.append(el('button', {
                  type: 'button', class: 'btn btn-sm btn-ghost-secondary tiny', title: 'Remove this target',
                  onclick: () => { r.targets.splice(i, 1); syncTargets(); drawTargets(); drawCfg(); },
                }, iconEl('lucide:x', 'wv-icon wv-icon-xs')));
              }
              targetsBox.append(row);
            });
            targetsBox.append(el('button', {
              type: 'button', class: 'btn btn-sm btn-ghost-secondary',
              onclick: () => { r.targets.push(tables[0]?.id ?? ''); syncTargets(); drawTargets(); drawCfg(); },
            }, '+ another target table'));
          };
          const syncTargets = () => {
            r.targetDb = r.targets[0];
            r.targetDbs = r.targets.length > 1 ? [...r.targets] : undefined;
            changed();
          };
          syncTargets();
          drawTargets();
          kids.push(dsection(r.targets.length > 1 ? 'Target tables (target set)' : 'Target table', targetsBox));
          kids.push(dsection('Cardinality', segCtl(fdc.CARDINALITIES.map((c) => ({ id: c, label: c.replace('-to-', ' → ') })), r.cardinality ?? 'many-to-one', (v) => { r.cardinality = v; changed(); })));
          if (r.targets.length > 1) {
            kids.push(el('div', { class: 'modal-note full' }, 'A target set is one-way: no inverse field is created on the member tables.'));
          } else {
            const autoName = db.name + (['many-to-one', 'many-to-many'].includes(r.cardinality ?? 'many-to-one') ? 's' : '');
            kids.push(dsection('Inverse field on the target', el('input', { class: 'form-control', value: r.inverseName ?? '', placeholder: `${autoName} (created automatically — rename here)`, oninput: (e) => { r.inverseName = e.target.value; changed(); } })));
          }
        }
      } else if (t === 'view') {
        kids.push(...viewSection(db, state, changed, drawCfg));
      } else if (t === 'attachments') {
        const files = state.files ?? (state.files = { preview: '', size: 'medium', fit: 'trim' });
        kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
          el('input', { type: 'checkbox', class: 'form-check-input', checked: state.multiple !== false ? '' : undefined,
            onchange: (e) => { state.multiple = e.target.checked; if (state.multiple && files.preview === 'cover') files.preview = ''; changed(); drawCfg(); } }),
          el('span', { class: 'form-check-label' }, 'Allow multiple files')));
        const previews = segCtl([
          { id: '', label: 'Unset', title: state.multiple !== false ? 'auto: pictures in a sheet, the rest as chips' : 'inline: the file in its viewer' },
          ...fieldDialogCore.ATTACHMENT_PREVIEWS.map((id) => ({ id, label: id })),
        ], files.preview, (id) => { files.preview = id; changed(); });
        if (state.multiple !== false) {
          const cover = previews.lastElementChild;
          cover.disabled = true;
          cover.title = 'Only a single-file field has a cover';
        }
        kids.push(dsection('Show as', previews),
          dsection('Size', segCtl(fieldDialogCore.ATTACHMENT_SIZES, files.size, (id) => { files.size = id; changed(); })),
          dsection('Fit', segCtl(fieldDialogCore.ATTACHMENT_FITS.map((id) => ({
            id, label: id, title: id === 'fill' ? 'Uniform cells, the file cropped to the cell' : 'The whole file, the cell trimmed to its shape',
          })), files.fit, (id) => { files.fit = id; changed(); })));
      } else if (t === 'text' && !(isEdit && existing.role === 'name')) {
        kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
          el('input', { type: 'checkbox', class: 'form-check-input', checked: state.literal ? '' : undefined, onchange: (e) => { state.literal = e.target.checked; changed(); } }),
          el('span', { class: 'form-check-label' }, 'Literal ', el('span', { class: 'date-format-eg' }, 'show ', el('code', {}, '**marks**'), ' and ', el('code', {}, '`syntax`'), ' as typed, never dressed'))));
      } else if (t === 'document') {
        kids.push(dsection('Kind', segCtl(fdc.DOCUMENT_KINDS, state.kind ?? 'markdown', (v) => { state.kind = v; changed(); })));
      } else if (t === 'key') {
        const cred = (state.credential ??= { kind: 'apikey', keystore: 'local' });
        kids.push(dsection('Holds', segCtl(fdc.CREDENTIAL_KINDS.map((k) => ({ id: k, label: CREDENTIAL_KIND_LABELS[k] ?? k })),
          cred.kind, (v) => { cred.kind = v; changed(); })));
        kids.push(dsection('Kept in', segCtl(fdc.KEYSTORES.map((k) => ({ id: k, label: k === 'local' ? 'weave' : KEYSTORE_LABELS[k] })),
          cred.keystore, (v) => { cred.keystore = v; drawCfg(); changed(); })));
        kids.push(el('div', { class: 'modal-note full' }, cred.keystore === 'local'
          ? 'The cell holds the credential’s name. The secret is encrypted outside the workspace, and reading it back is limited to whoever owns it — everyone else sees only the name.'
          : `The cell holds a reference. ${KEYSTORE_LABELS[cred.keystore]} keeps the secret and decides who may see it; weave links out to it.`));
      } else if (t === 'field') {
        kids.push(dsection('Definition depth', el('input', {
          type: 'number', min: 1, max: fdc.MAX_DEPTH, class: 'form-control dlg-narrow', value: state.depth ?? 1,
          oninput: (e) => { state.depth = Number(e.target.value) || 1; changed(); },
        })));
      } else if (t === 'lookup' || t === 'rollup') {
        const fixedRow = (name, value) => el('input', { class: 'form-control wv-fixed', name, readonly: '', tabindex: '-1', value: value ?? '' });
        const throughRelation = (fixed = false) => {
          const out = [];
          const rels = db.fields.filter((x) => x.type === 'relation');
          const relLabel = (r) => `${r.name} → ${r.targetDb}`;
          if (!fixed) state.relationField = state.relationField || (rels[0]?.name ?? '');
          const rel = rels.find((r) => r.name === state.relationField);
          if (fixed) out.push(dsection('Relation', fixedRow('relationField', rel ? relLabel(rel) : state.relationField)));
          else {
            const relSel = pickerSelect({ name: 'relationField', options: rels.map((r) => ({ id: r.name, label: relLabel(r) })), value: state.relationField || null });
            relSel.input.addEventListener('change', () => { state.relationField = relSel.input.value; state.targetField = ''; drawCfg(); changed(); });
            out.push(dsection('Relation', rels.length ? relSel : el('div', { class: 'modal-note' }, 'This table has no relations yet — add one first')));
          }
          const target = rel && allTables().find((d) => d.id === rel.targetDbId);
          const targets = (target?.fields ?? []).filter((x) => x.type !== 'document');
          const needsTarget = t === 'lookup' || (state.aggregate ?? 'count') !== 'count';
          if (needsTarget && fixed) {
            const tf = targets.find((x) => x.name === state.targetField);
            out.push(dsection('Field', fixedRow('targetField', tf ? `${tf.name} · ${tf.type}` : state.targetField)));
          } else if (needsTarget && target) {
            const tSel = pickerSelect({ name: 'targetField', placeholder: `Field of ${target.name}…`, options: targets.map((x) => ({ id: x.name, label: `${x.name} · ${x.type}` })), value: state.targetField || null });
            tSel.input.addEventListener('change', () => { state.targetField = tSel.input.value; changed(); });
            out.push(dsection('Target field', tSel));
          }
          if (t === 'rollup') {
            out.push(dsection('Aggregate', fixed ? fixedRow('aggregate', state.aggregate ?? 'count')
              : segCtl(fdc.AGGREGATES, state.aggregate ?? 'count', (v) => { state.aggregate = v; drawCfg(); changed(); })));
          }
          return out;
        };
        const overs = t === 'rollup' && db.system === 'spaces' ? allTables().filter((x) => !x.system) : [];
        const overTable = () => {
          const over = overs.find((x) => x.id === state.via) ?? overs[0];
          state.via = over.id;
          const out = [];
          const vSel = pickerSelect({ name: 'via', options: overs.map((x) => ({ id: x.id, label: `${x.space} / ${x.name}` })), value: over.id });
          vSel.input.addEventListener('change', () => { state.via = vSel.input.value; state.targetField = ''; drawCfg(); changed(); });
          out.push(dsection('Table', vSel));
          out.push(dsection('Aggregate', segCtl(fdc.AGGREGATES, state.aggregate ?? 'count', (v) => { state.aggregate = v; drawCfg(); changed(); })));
          if ((state.aggregate ?? 'count') !== 'count') {
            const cols = over.fields.filter((x) => x.type !== 'document');
            const tSel = pickerSelect({ name: 'targetField', placeholder: `Column of ${over.name}…`, options: cols.map((x) => ({ id: x.name, label: `${x.name} · ${x.type}` })), value: state.targetField || null });
            tSel.input.addEventListener('change', () => { state.targetField = tSel.input.value; changed(); });
            out.push(dsection('Target field', tSel));
          }
          out.push(el('div', { class: 'modal-note full' },
            `The whole ${over.name} table, read on this space’s row — the figure the grid’s Σ row shows under that column. Other spaces read nothing.`));
          return out;
        };
        if (isEdit) {
          if (existing.viaTable) {
            kids.push(dsection('Table', fixedRow('via', existing.viaTable)));
            if (existing.targetField) kids.push(dsection('Field', fixedRow('targetField', existing.targetField)));
            kids.push(dsection('Aggregate', fixedRow('aggregate', existing.aggregate ?? 'count')));
          } else kids.push(...throughRelation(true));
          kids.push(el('div', { class: 'modal-note full' }, `The recipe is set when the ${t} is created and cannot be changed here.`));
          kids.push(...computedShowsAs(db, existing, after));
        } else {
          if (overs.length) {
            kids.push(dsection('Rolls up', segCtl(
              [{ id: 'relation', label: 'Through a relation' }, { id: 'table', label: 'Over a table' }],
              state.via ? 'table' : 'relation',
              (v) => {
                state.via = v === 'table' ? (state.via || overs[0].id) : '';
                state.targetField = '';
                drawCfg(); changed();
              })));
          } else state.via = '';
          kids.push(...(state.via ? overTable() : throughRelation()));
        }
      }
      if (choice) {
        kids.push(dsection('Default', choice));
      } else if (t === 'date') {
        const dc = weaveDateCore;
        const kind = dc.defaultKind(state.default);
        const dyn = state.date.time ? 'now()' : 'today()';
        const body = el('div', { class: 'date-default' });
        const seg = segCtl([
          { id: 'none', label: 'None' },
          { id: 'today', label: dyn, title: 'The day the row is created' },
          { id: 'specific', label: 'Specific…' },
        ], kind, (k) => {
          state.default = k === 'none' ? '' : k === 'today' ? dyn : (kind === 'specific' ? state.default : dc.todayIso());
          drawCfg(); changed();
        });
        body.append(seg);
        if (kind === 'specific') {
          body.append(dateControl({
            value: state.default, costume: fdc.dateCostume(state.date, t), compact: false,
            onChange: (iso) => { state.default = iso ?? ''; changed(); },
          }));
        }
        kids.push(dsection('Default', body));
      } else if (t === 'daterange') {
        kids.push(dsection('Default', rangeControl({
          value: fdc.rangeDefault(state.default), costume: fdc.dateCostume(state.date, t), compact: false,
          placeholder: 'No default — pick a range',
          onChange: (r) => { state.default = r ? JSON.stringify(r) : ''; changed(); },
        })));
      } else if (t === 'rating') {
        const r = state.rating ?? (state.rating = { max: 5, icon: 'lucide:star', color: 'ink' });
        const preview = el('div', { class: 'wv-rating-default' });
        const drawDefault = () => {
          state.default = fdc.clampRatingDefault(state.default, r.max);
          const cur = state.default;
          const box = ratingEl(r.max, r.icon, cur === '' ? null : Number(cur), { onSet: (v) => setDefault(v ? String(v) : ''), color: r.color });
          const label = fdc.ratingDefaultLabel(cur, r.max);
          box.setAttribute('aria-label', label);
          box.title = `${label} · click an icon, or use the arrow keys`;
          box.tabIndex = 0;
          box.addEventListener('keydown', (e) => {
            const v = fdc.ratingDefaultKey(state.default, r.max, e.key);
            if (v === undefined || e.metaKey || e.ctrlKey || e.altKey) return;
            e.preventDefault();
            e.stopPropagation();
            setDefault(v);
          });
          const had = preview.contains(document.activeElement);
          preview.replaceChildren(box);
          if (had) box.focus();
        };
        const setDefault = (v) => { state.default = v; drawDefault(); changed(); };
        const setMax = (n) => { r.max = n; presets.mark?.(String(n)); drawDefault(); changed(); };
        const maxBox = el('input', {
          type: 'number', min: 1, max: fdc.RATING_MAX, step: 1, class: 'form-control dlg-narrow', 'aria-label': 'Max', value: r.max,
          oninput: (e) => {
            const n = fdc.ratingMaxValue(e.target.value);
            e.target.classList.toggle('is-invalid', n == null && e.target.value !== '');
            if (n != null) setMax(n);
          },
          onchange: (e) => { if (fdc.ratingMaxValue(e.target.value) == null) { e.target.value = r.max; e.target.classList.remove('is-invalid'); } },
        });
        const presets = segCtl(fdc.RATING_PRESETS.map((n) => ({ id: String(n), label: String(n) })), String(r.max), (v) => { maxBox.value = v; maxBox.classList.remove('is-invalid'); setMax(Number(v)); });
        kids.push(dsection('Max', el('div', { class: 'wv-rating-max' }, maxBox, presets)));
        const iconBtn = el('button', {
          type: 'button', class: 'btn btn-sm wv-rating-icon', title: 'Pick the icon', 'aria-label': 'Icon',
          onclick: (e) => glyphPopover(e.currentTarget, r.icon, (id) => { r.icon = id || 'lucide:star'; drawCfg(); changed(); }),
        }, iconEl(r.icon, 'wv-icon'), el('span', {}, String(r.icon).replace(/^lucide:/, '')));
        kids.push(dsection('Icon', iconBtn));
        kids.push(dsection('Color', colorPicker(r.color, (c) => ratingEl(3, r.icon, 2, { color: c }), (c) => { r.color = c; drawDefault(); changed(); })));
        drawDefault();
        kids.push(dsection('Default', preview));
      } else if (t === 'toggle') {
        const tg = state.toggle ?? (state.toggle = { on: 'On', off: 'Off' });
        const labelInput = (key, ph) => el('input', {
          class: 'form-control', value: tg[key] ?? '', placeholder: ph, 'data-toggle-label': key,
          oninput: (e) => { tg[key] = e.target.value; changed(); },
          onchange: () => drawCfg(),
        });
        kids.push(dsection('Labels', el('div', { class: 'wv-toggle-labels' },
          el('label', { class: 'wv-toggle-label-row' }, el('span', { class: 'wv-tag' }, 'on'), labelInput('on', 'On')),
          el('label', { class: 'wv-toggle-label-row' }, el('span', { class: 'wv-tag' }, 'off'), labelInput('off', 'Off')))));
        const cur = ['true', 'yes', '1'].includes(String(state.default).toLowerCase()) ? 'on' : 'off';
        kids.push(dsection('Default', segCtl([{ id: 'off', label: tg.off?.trim() || 'Off' }, { id: 'on', label: tg.on?.trim() || 'On' }], cur,
          (v) => { state.default = v === 'on' ? 'true' : 'false'; changed(); })));
      } else if (t === 'checkbox') {
        const cur = state.default === '' ? 'none' : ['true', 'yes', '1'].includes(String(state.default).toLowerCase()) ? 'checked' : 'unchecked';
        kids.push(dsection('Default', segCtl([{ id: 'unchecked', label: 'Unchecked' }, { id: 'checked', label: 'Checked' }], cur === 'none' ? 'unchecked' : cur,
          (v) => { state.default = v === 'checked' ? 'true' : 'false'; changed(); })));
      } else if (fdc.DEFAULTABLE.includes(t)) {
        kids.push(dsection('Default', el('input', {
          class: 'form-control', value: state.default ?? '',
          placeholder: t === 'checkbox' ? 'true / false' : 'Default value for new rows (optional)',
          oninput: (e) => { state.default = e.target.value; changed(); },
        })));
      }
    }
    cfgWrap.replaceChildren(...kids);
  }

  drawGrid();
  drawCfg();

  let saved = null;
  tray(isEdit ? `Edit ${existing.name}` : 'New field', [
    dsection('Name', nameInput),
    describable ? dsection('Description', descInput) : '',
    gridWrap, cfgWrap,
  ], async () => {
    const def = fdc.definitionFromState(state);
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    if (!isEdit && def.type === 'relation') {
      const made = await api('POST', `/tables/${db.id}/relations`, { name, ...def.config });
      if (description && made?.field?.id) await api('PATCH', `/tables/${db.id}/fields/${encodeURIComponent(made.field.id)}`, { config: { description } });
    } else if (!isEdit) {
      await api('POST', `/tables/${db.id}/fields`, { name, type: def.type, config: { ...def.config, ...(description ? { description } : {}) } });
    } else {
      const patch = {};
      if (name && name !== existing.name) patch.name = name;
      if (def.type !== existing.type) {
        patch.type = def.type;
        patch.config = def.config;
      } else {
        patch.config = fdc.editPatchConfig(existing, def, state);
      }
      if (describable && description !== (fieldDescription(existing) || '')) patch.config = { ...(patch.config ?? {}), description: description || null };
      saved = await api('PATCH', `/tables/${db.id}/fields/${encodeURIComponent(existing.id)}`, patch);
    }
    await loadSchema();
    after();
    fieldConfigToast(db, saved, after);
  }, isEdit ? 'Save changes' : 'Create');
}

function fieldConfigToast(db, res, redraw) {
  if (!res?.activity) return;
  toast(res.lossy ? `${res.name} is now ${res.type}` : `${res.name} updated`, false, {
    label: 'Undo',
    run: async () => {
      try {
        const out = await api('POST', `/tables/${db.id}/fields/${encodeURIComponent(res.id)}/rollback`, { activity: res.activity, via: 'undo' });
        await loadSchema();
        await redraw?.();
        toast(rolledBackText(out, 'restored'));
      } catch (err) { toast(err.message, true); }
    },
  });
}

function rolledBackText(out, verb) {
  const n = (k, one, many) => (out[k] ? `${out[k]} ${out[k] === 1 ? one : many}` : null);
  const parts = [
    n('restored', 'value back', 'values back'),
    n('left', 'edited since, kept', 'edited since, kept'),
    n('converted', 'newer row converted', 'newer rows converted'),
  ].filter(Boolean);
  return `${out.field.name} ${verb}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}

async function keepScroll(redraw) {
  const x = window.scrollX, y = window.scrollY;
  const boxes = [...document.querySelectorAll('*')]
    .filter((e) => e.scrollTop || e.scrollLeft)
    .map((e) => ({ el: e, top: e.scrollTop, left: e.scrollLeft }));
  const left = document.querySelector('.wv-grid')?.parentElement?.scrollLeft ?? 0;
  const top = document.querySelector('.wv-grid')?.parentElement?.scrollTop ?? null;
  await redraw();
  await new Promise((done) => requestAnimationFrame(() => {
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
    for (const b of boxes) {
      if (!b.el.isConnected) continue;
      b.el.scrollTo({ top: b.top, left: b.left, behavior: 'instant' });
    }
    const again = document.querySelector('.wv-grid')?.parentElement;
    if (again) again.scrollLeft = left;
    if (again) { if (top != null) again.scrollTo({ top, behavior: 'instant' }); again.wvRewindow?.(); }
    done();
  }));
}

function editFieldDialog(db, f) {
  fieldDialog(db, f, () => keepScroll(() => showDatabase(db.id)));
}

async function reorderBlocks(db, body, onFail) {
  const bodyOrder = [...body.children].map((n) => n.dataset.block).filter(Boolean);
  try {
    await api('PATCH', `/tables/${db.id}`, { bodyOrder });
    await loadSchema();
  } catch (err) {
    toast(err.message, true);
    onFail();
  }
}

async function reorderField(db, fromName, toName, { after = false, onFail = () => showDatabase(db.id) } = {}) {
  const order = db.fields.map((f) => f.name).filter((n) => n !== fromName);
  const at = order.indexOf(toName);
  if (at < 0) return;
  order.splice(after ? at + 1 : at, 0, fromName);
  const cols = visibleCols(db);
  const fromIdx = cols.indexOf(fromName);
  const toIdx = cols.indexOf(toName);
  const table = document.querySelector('.wv-grid');
  if (table && fromIdx >= 0 && toIdx >= 0) {
    for (const row of table.querySelectorAll('tr')) {
      const cells = row.children;
      const from = cells[2 + fromIdx];
      const to = cells[2 + toIdx];
      if (from && to) to.insertAdjacentElement(after || fromIdx < toIdx ? 'afterend' : 'beforebegin', from);
    }
  }
  const fi = db.fields.findIndex((f) => f.name === fromName);
  const [moved] = db.fields.splice(fi, 1);
  const ti = db.fields.findIndex((f) => f.name === toName);
  db.fields.splice(after ? ti + 1 : ti, 0, moved);
  try {
    if (db.view) { if (!await gridConfigWrite(db, null, { move: { field: fromName, [after ? 'after' : 'before']: toName } })) onFail(); return; }
    await api('PATCH', `/tables/${db.id}`, { fieldOrder: order });
    await loadSchema();
  } catch (err) {
    toast(err.message, true);
    onFail();
  }
}


function addFieldMenuButton(db) {
  const btn = el('button', { class: 'add-field-btn', type: 'button', title: 'New field' }, iconEl('+', 'wv-icon'));
  btn.addEventListener('click', (e) => { e.stopPropagation(); addFieldDialog(db); });
  return btn;
}

const FOOT_LABELS = { count: 'n', sum: 'Σ', avg: 'avg', median: 'med', min: 'min', max: 'max', stdev: 'σ', range: 'range', distinct: '≠', filled: 'filled', empty: 'empty' };
const FOOT_NUMERIC = ['sum', 'avg', 'median', 'min', 'max', 'stdev', 'range'];

function footAggregatesFor(db, f) {
  if (!f) return [];
  if (f.role === 'name' || f.id === db.fields.find((x) => x.role === 'name')?.id) return ['count', 'distinct'];
  if (f.type === 'number' || f.type === 'rating' || f.type === 'formula' || f.type === 'rollup') return [...FOOT_NUMERIC, 'filled', 'empty'];
  if (f.type === 'date') return ['min', 'max', 'filled', 'empty'];
  if (f.type === 'view' || f.type === 'document' || f.type === 'attachments' || f.type === 'key' || f.type === 'field') return [];
  return ['filled', 'empty', 'distinct'];
}

const spaceRollupName = (db, col, agg) => (agg === 'count' ? `${db.name} · count` : `${db.name} · ${col} · ${agg}`);
const RATING_SCALE_FOOT = ['avg', 'min', 'max', 'median'];
const spaceRollupEntry = (db, col, agg, made) => {
  const out = {
    id: made.id, name: made.name, type: 'rollup', viaTable: db.qualified, viaTableId: db.id,
    ...(agg === 'count' ? {} : { targetField: col }), aggregate: agg,
  };
  const f = agg === 'count' ? null : colField(db, col);
  if ((f?.type === 'number' || f?.type === 'formula') && FOOT_NUMERIC.includes(agg) && ['bar', 'ring', 'heat'].includes(f.display)) {
    out.display = f.display;
    if (typeof f.scale === 'number') out.scale = f.scale;
    out.color = f.color ?? 'ink';
  }
  if (f?.type === 'rating' && RATING_SCALE_FOOT.includes(agg)) out.rating = { max: f.max, icon: f.icon, color: f.color ?? 'ink' };
  return out;
};

function renderFooter(db, cols) {
  const spacesT = registryTable('spaces');
  if (!spacesT) return null;
  const cell = (c) => {
    const f = colField(db, c);
    const aggs = footAggregatesFor(db, f);
    return el('td', {
      class: 'foot-cell' + (aggs.length ? ' foot-open' : '') + (f?.type === 'number' || f?.type === 'formula' ? ' num' : ''),
      dataset: { col: c },
      title: aggs.length ? `Statistics for ${c}` : null,
      tabindex: aggs.length ? '0' : null,
      onclick: (e) => { if (aggs.length) footerPicker(e.currentTarget, db, c); },
      onkeydown: (e) => { if (aggs.length && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); footerPicker(e.currentTarget, db, c); } },
    });
  };
  return el('tr', { class: 'wv-foot' },
    el('td', { class: 'sel-cell' }),
    el('td', { class: 'pid-cell foot-mark', title: 'Space rollups — switch the row off from the eye' }, 'Σ'),
    ...cols.map(cell),
    ...(db.systemFields ?? []).map(() => el('td')),
    el('td'));
}

async function fillFooter(db, foot, rollups = null, { col = null } = {}) {
  if (!foot) return;
  try {
    rollups ??= (await api('GET', `/tables/${db.id}/stats`)).rollups;
  } catch { return; }
  if (!foot.isConnected) return;
  const nameCol = db.fields.find((f) => f.role === 'name')?.name ?? 'Name';
  const colOf = (r) => r.targetField ?? nameCol;
  foot.rollups = col == null ? rollups : [...(foot.rollups ?? []).filter((r) => colOf(r) !== col), ...rollups];
  for (const td of foot.querySelectorAll('td.foot-cell')) {
    if (col != null && td.dataset.col !== col) continue;
    const mine = rollups.filter((r) => colOf(r) === td.dataset.col && FOOT_LABELS[r.aggregate]);
    td.replaceChildren(...mine.map((r) => el('span', { class: 'foot-stat', title: r.name + (r.where ? ' (filtered)' : '') },
      el('span', { class: 'foot-agg' }, FOOT_LABELS[r.aggregate]),
      el('span', { class: 'foot-val' }, r.display ?? '—'))));
    td.classList.toggle('has-stats', mine.length > 0);
  }
  foot.dataset.rollups = String(foot.rollups.length);
}

async function footerPicker(anchor, db, col) {
  const spacesT = registryTable('spaces');
  const f = colField(db, col);
  const aggs = footAggregatesFor(db, f);
  if (!spacesT || !aggs.length) return;
  const nameCol = db.fields.find((x) => x.role === 'name')?.name ?? 'Name';
  let rollups = [];
  const load = async () => { rollups = (await api('GET', `/tables/${db.id}/stats?field=${encodeURIComponent(f.id)}`)).rollups; };
  const have = (agg) => rollups.find((r) => (r.targetField ?? nameCol) === col && r.aggregate === agg && !r.where);
  const tailKey = `Σ ${db.id} ${col}`;
  const write = async (agg, on) => {
    const cur = have(agg);
    if (on && !cur) {
      const made = await api('POST', `/tables/${spacesT.id}/fields`, { name: spaceRollupName(db, col, agg), type: 'rollup', config: { via: db.id, aggregate: agg, ...(agg === 'count' ? {} : { targetField: col }) } });
      rollups = [...rollups, { fieldId: made.id, name: made.name, targetField: agg === 'count' ? null : col, aggregate: agg, where: null, value: null, display: null }];
      const reg = registryTable('spaces');
      if (reg) {
        reg.fields.push(spaceRollupEntry(db, col, agg, made));
        for (const v of reg.views ?? []) if (!v.fields.includes(made.name)) v.fields.push(made.name);
      }
    } else if (!on && cur) {
      await api('DELETE', `/tables/${spacesT.id}/fields/${cur.fieldId}`);
      rollups = rollups.filter((r) => r !== cur);
      const reg = registryTable('spaces');
      if (reg) {
        reg.fields = reg.fields.filter((x) => x.id !== cur.fieldId);
        for (const v of reg.views ?? []) {
          v.fields = v.fields.filter((n) => n !== cur.name);
          if (v.widths && cur.name in v.widths) {
            delete v.widths[cur.name];
            if (!Object.keys(v.widths).length) delete v.widths;
          }
        }
      }
    }
  };
  const flip = (node) => {
    const agg = node.dataset.agg;
    const on = node.getAttribute('aria-checked') !== 'true';
    node.setAttribute('aria-checked', on ? 'true' : 'false');
    node.querySelector('.switch')?.classList.toggle('on', on);
    const turn = eyeWrites.then(async () => {
      try { await write(agg, on); } catch (err) { toast(err.message, true); }
      if (eyeTails.get(tailKey) === turn) await load().catch(() => {});
    });
    eyeWrites = turn;
    eyeTails.set(tailKey, turn);
    turn.then(() => {
      if (eyeTails.get(tailKey) !== turn) return;
      eyeTails.delete(tailKey);
      if (pop.isConnected) relearnRows(pop, build(), (p) => p.querySelector(`[data-agg="${agg}"]`)?.focus());
      fillFooter(db, anchor.closest('tr.wv-foot'), rollups, { col });
    });
  };
  const row = (agg) => {
    const on = !!have(agg);
    return el('button', {
      class: 'chip-pop-row eye-row foot-row', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false',
      dataset: { agg },
      onclick: (e) => { e.stopPropagation(); flip(e.currentTarget); },
    }, el('span', { class: 'eye-label' }, el('span', { class: 'foot-agg' }, FOOT_LABELS[agg]), ' ', agg === 'count' ? `count of ${db.term.plural}` : agg),
    el('span', { class: 'switch' + (on ? ' on' : '') }, el('span', { class: 'switch-knob' })));
  };
  const build = () => [
    el('div', { class: 'chip-pop-title' }, `${col} · space rollups`),
    ...aggs.map(row),
    el('div', { class: 'chip-pop-note' }, 'Each switch is a rollup field on this space\'s row'),
  ];
  const opened = eyeWrites.then(load);
  eyeWrites = opened.catch(() => {});
  try { await opened; } catch (err) { toast(err.message, true); return; }
  const pop = showPopover(anchor, build());
}

async function spaceStatTiles(space) {
  const spacesT = registryTable('spaces');
  if (!spacesT) return null;
  const mine = spacesT.fields.filter((f) => f.type === 'rollup' && f.viaTableId && space.tables.some((t) => t.id === f.viaTableId));
  if (!mine.length) return null;
  let row = null;
  try {
    const res = await api('POST', `/tables/${spacesT.id}/query`, { where: [['Name', '=', space.space]] });
    row = res.items.find((i) => i.sysId === space.spaceId) ?? null;
  } catch { return null; }
  if (!row) return null;
  return el('div', { class: 'wv-stat-tiles' }, ...mine.map((f) => {
    const t = space.tables.find((x) => x.id === f.viaTableId);
    const v = row.fields[f.name];
    return el('a', { class: 'wv-stat-tile', href: `#/table/${f.viaTableId}`, title: f.name },
      el('span', { class: 'wv-stat-value' }, v == null || v === '' ? '—' : String(v)),
      el('span', { class: 'wv-stat-label' }, `${t?.name ?? ''}${f.targetField ? ` · ${f.targetField}` : ''}`),
      el('span', { class: 'wv-stat-agg' }, FOOT_LABELS[f.aggregate] ?? f.aggregate, f.where ? ' · filtered' : ''));
  }));
}

async function columnStatsPanel(db) {
  document.querySelector('#modal-back')?.remove();
  const back = el('div', { id: 'modal-back', onclick: (e) => { if (e.target === back) back.remove(); } });
  const body = el('div', { class: 'wv-stats-body' }, el('div', { class: 'wv-muted' }, 'Reading…'));
  const ctl = el('div', { class: 'wv-stats-ctl' }, el('span', { class: 'wv-muted' }, 'Group by'));
  let bySel = null;
  const statSel = pickerSelect({ name: 'stat', title: 'Group figure', value: 'sum', options: ['sum', 'avg', 'median', 'min', 'max'].map((k) => ({ id: k, label: k })) });
  statSel.classList.add('wv-stats-stat');
  const panel = el('div', { id: 'modal', class: 'wv-stats' },
    el('div', { class: 'wv-stats-head' },
      el('h2', {}, `${db.name} · statistics`),
      el('div', { class: 'wv-stats-ctl-row' }, ctl, statSel,
        el('button', { class: 'btn btn-sm', type: 'button', onclick: () => back.remove() }, 'Close'))),
    body);
  back.append(panel);
  holdPage(back, panel);
  addEventListener('keydown', function esc(e) {
    if (!back.isConnected) return removeEventListener('keydown', esc);
    if (e.key === 'Escape') { back.remove(); removeEventListener('keydown', esc); }
  });
  const fmt = (n) => (n == null ? '—' : typeof n === 'number' ? (Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 })) : String(n));
  const bars = (dist, total, { top = 8 } = {}) => {
    const max = Math.max(1, ...dist.map((d) => d.count));
    const shown = dist.slice(0, top);
    return el('div', { class: 'wv-dist' },
      ...shown.map((d) => el('div', { class: 'wv-dist-row' },
        el('span', { class: 'wv-dist-label' + (d.value == null ? ' empty' : '') }, d.value == null ? '(empty)' : String(d.value)),
        el('span', { class: 'wv-dist-bar' }, el('span', { class: 'wv-dist-fill', style: `width:${Math.round(100 * d.count / max)}%` })),
        el('span', { class: 'wv-dist-n' }, `${d.count} · ${Math.round(100 * d.count / Math.max(1, total))}%`))),
      dist.length > top ? el('div', { class: 'wv-muted' }, `+ ${dist.length - top} more`) : null);
  };
  const hist = (h) => {
    const max = Math.max(1, ...h.map((b) => b.count));
    return el('div', { class: 'wv-hist', title: 'Distribution' }, ...h.map((b) => el('span', {
      class: 'wv-hist-bar', style: `height:${Math.max(2, Math.round(100 * b.count / max))}%`,
      title: `${b.fromDisplay} – ${b.toDisplay}: ${b.count}`,
    })));
  };
  const render = (s) => {
    const numbers = s.columns.filter((c) => c.kind === 'number');
    const cats = s.columns.filter((c) => c.kind === 'category');
    const dates = s.columns.filter((c) => c.kind === 'date');
    const texts = s.columns.filter((c) => c.kind === 'text');
    const parts = [el('div', { class: 'wv-stats-rows' }, `${s.rows.toLocaleString()} ${s.rows === 1 ? db.term.singular : db.term.plural}`,
      s.rollups.length ? el('span', { class: 'wv-muted' }, ` · ${s.rollups.length} space rollup${s.rollups.length === 1 ? '' : 's'} on this table`) : null)];
    if (s.groups) {
      const k = statSel.input.value || 'sum';
      parts.push(el('h3', {}, `By ${s.by} · ${k}`),
        el('div', { class: 'table-wrap' }, el('table', { class: 'table table-sm wv-grid wv-stats-table' },
          el('thead', {}, el('tr', {}, el('th', {}, s.by), el('th', { class: 'num' }, 'rows'), ...numbers.map((c) => el('th', { class: 'num' }, c.name)))),
          el('tbody', {}, ...s.groups.map((g) => el('tr', {},
            el('td', { class: g.value == null ? 'wv-muted' : '' }, g.value == null ? '(empty)' : String(g.value)),
            el('td', { class: 'num' }, fmt(g.rows)),
            ...numbers.map((c) => el('td', { class: 'num' }, g.display[c.name]?.[k] ?? '—'))))))));
    }
    if (numbers.length) {
      parts.push(el('h3', {}, 'Numbers'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'table table-sm wv-grid wv-stats-table' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Column'), el('th', { class: 'num' }, 'filled'), ...['sum', 'avg', 'median', 'min', 'max', 'stdev'].map((k) => el('th', { class: 'num' }, k)), el('th', {}, 'distribution'))),
          el('tbody', {}, ...numbers.map((c) => el('tr', { dataset: { col: c.name } },
            el('td', {}, c.name),
            el('td', { class: 'num' }, `${c.filled}${c.empty ? ` / ${c.empty} empty` : ''}`),
            ...['sum', 'avg', 'median', 'min', 'max', 'stdev'].map((k) => el('td', { class: 'num' }, c.display[k] ?? '—')),
            el('td', {}, hist(c.histogram))))))));
    }
    if (cats.length) {
      parts.push(el('h3', {}, 'Chips and boxes'), el('div', { class: 'wv-stats-cards' }, ...cats.map((c) => el('div', { class: 'wv-stats-card', dataset: { col: c.name } },
        el('div', { class: 'wv-stats-card-title' }, c.name, el('span', { class: 'wv-muted' }, ` · ${c.distribution.filter((d) => d.value != null).length} values`)),
        bars(c.distribution, s.rows)))));
    }
    if (dates.length) {
      parts.push(el('h3', {}, 'Dates'), el('div', { class: 'wv-stats-cards' }, ...dates.map((c) => el('div', { class: 'wv-stats-card', dataset: { col: c.name } },
        el('div', { class: 'wv-stats-card-title' }, c.name),
        el('div', { class: 'wv-muted' }, c.earliest == null ? 'no dates' : `${c.earliestDisplay} → ${c.latestDisplay} · ${c.spanDays} day${c.spanDays === 1 ? '' : 's'} · ${c.filled} filled`),
        c.byMonth?.length ? bars([...c.byMonth].sort((a, b) => String(a.value).localeCompare(String(b.value))), c.filled, { top: 12 }) : null))));
    }
    if (texts.length) {
      parts.push(el('h3', {}, 'Text'), el('div', { class: 'wv-stats-cards' }, ...texts.map((c) => el('div', { class: 'wv-stats-card', dataset: { col: c.name } },
        el('div', { class: 'wv-stats-card-title' }, c.name),
        el('div', { class: 'wv-muted' }, `${c.filled} filled · ${c.empty} empty · ${c.distinct} distinct`)))));
    }
    body.replaceChildren(...parts);
  };
  const load = async () => {
    try {
      const by = bySel?.input.value || '';
      const s = await api('GET', `/tables/${db.id}/stats${by ? `?by=${encodeURIComponent(by)}` : ''}`);
      if (!bySel) {
        bySel = pickerSelect({ name: 'by', title: 'Group by', placeholder: 'No grouping', options: [
          { id: '', label: 'No grouping' },
          ...groupFieldOptions(db, { dates: false }),
          ...s.columns.filter((x) => x.kind === 'category' && !listCore.groupable(db.fields.find((f) => f.name === x.name))).map((c) => ({ id: c.name, label: c.name })),
        ] });
        bySel.classList.add('wv-stats-by');
        bySel.input.addEventListener('change', load);
        ctl.append(bySel);
      }
      statSel.hidden = !s.groups;
      render(s);
    } catch (err) { body.replaceChildren(el('div', { class: 'wv-muted' }, err.message)); }
  };
  statSel.input.addEventListener('change', load);
  statSel.hidden = true;
  await load();
}

async function showSpace(spaceId) {
  const space = state.schema.find((s) => s.spaceId === spaceId);
  if (!space) return showHome();
  state.route = { page: 'space', spaceId };
  renderNav();
  const main = $('#main');
  main.replaceChildren(
    viewHeader({
      crumbs: [{ label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() }],
      permalink: `${location.origin}${WS_PREFIX}/s/${spaceId}`,
      title: space.space,
      kind: 'space',
      onRename: async (name) => {
        await api('PATCH', `/spaces/${spaceId}`, { name });
        await loadSchema();
        showSpace(spaceId);
      },
      icon: space.icon,
      onSetIcon: async (icon) => {
        await api('PATCH', `/spaces/${spaceId}`, { icon: icon ?? '' });
        await loadSchema();
        showSpace(spaceId);
      },
      description: space.description,
      onSaveDescription: async (md) => {
        await api('PATCH', `/spaces/${spaceId}`, { description: md });
        await loadSchema();
      },
      actions: space.system ? [] : [
        ...(space.template ? [useTemplateButton(space)] : []),
        dotsMenu([
          {
            hold: space.tables.length
              ? `Delete space + ${space.tables.length} table${space.tables.length > 1 ? 's' : ''}`
              : 'Delete space',
            holdingLabel: 'Hold to delete space…',
            run: async () => {
              try {
                await api('DELETE', `/spaces/${spaceId}`);
                await loadSchema();
                location.hash = wsHomeHref().replace(/^[^#]*/, '') || '#/';
                showHome();
                toast(`Deleted ${space.space}`);
              } catch (err) { toast(err.message, true); }
            },
          },
        ], { title: 'Space actions', align: 'right' }),
      ],
    }),
  );
  const tiles = await spaceStatTiles(space);
  if (tiles) main.append(tiles);
  main.append(spaceTablesCard(space));
  const card = await relationMapCard('Relation map', { spaceId });
  if (card) main.append(card);
  const reg = registryTable('tables');
  if (reg) {
    const onSaved = async () => {
      rememberGridFocus();
      await loadSchema();
      await showSpace(spaceId);
      restoreGridFocus();
    };
    const onAdd = async () => {
      try {
        const made = await api('POST', `/tables/${reg.id}/entities`, { name: 'New table', values: { Space: space.space } });
        await loadSchema();
        await showSpace(spaceId);
        focusNewRow(made.id, { field: 'Name', select: true });
      } catch (err) { toast(err.message, true); }
    };
    await schemaDisclosure(main, async (body) => {
      const res = await api('POST', `/tables/${reg.id}/query`, {});
      const items = res.items.filter((i) => space.tables.some((t) => t.id === i.sysId));
      renderTable(body, reg, items, onSaved, onAdd);
    });
  }
}

function useTemplateButton(space) {
  return el('button', { class: 'btn btn-sm use-template-btn', type: 'button', onclick: () => useTemplateDialog(space) },
    iconEl('lucide:copy', 'wv-icon'), 'Use template');
}

async function useTemplateDialog(space) {
  let list;
  try { list = await api('GET', '/workspaces'); } catch (err) { return toast(err.message, true); }
  const seg = WS_PREFIX ? WS_PREFIX.slice(3) : null;
  const here = seg ? list.find((w) => w.name === seg || w.id === seg) : list.find((w) => w.default);
  const others = list.filter((w) => w !== here);
  const said = el('div', { class: 'use-template-said', role: 'alert' });
  said.hidden = true;
  const body = others.length ? [
    el('label', { class: 'form-label wv-start-label' }, 'Workspace'),
    pickerSelect({ name: 'workspace', title: 'Workspace', options: others.map((w) => ({ id: w.name, label: w.name })), value: others[0].name }),
    el('label', { class: 'form-label wv-start-label' }, 'Name'),
    el('input', { name: 'name', class: 'form-control full', style: 'width:100%', value: space.space, required: '' }),
    el('div', { class: 'form-hint' }, 'Copies the tables, fields and views. Rows stay here.'),
    said,
  ] : [el('p', { class: 'use-template-none' }, 'There is no other workspace to build in. Create one first, from the workspace rail.')];
  modal(`Use ${space.space} as a template`, body, async (fd) => {
    if (!others.length) return;
    said.hidden = true;
    const workspace = String(fd.get('workspace'));
    try {
      const made = await api('POST', `/spaces/${space.spaceId}/use`, { workspace, name: String(fd.get('name') ?? '').trim() });
      toast(`${made.space.name} is in ${made.workspace}`, false, { label: 'Open', run: () => { location.href = made.url; } });
    } catch (err) {
      said.textContent = err.status === 403 ? `You cannot build in ${workspace}: using a template there needs an architect on it.` : err.message;
      said.hidden = false;
      err.shown = true;
      throw err;
    }
  }, 'Use');
  const box = document.querySelector('#modal');
  if (!others.length) box?.querySelector('button[type=submit]')?.setAttribute('disabled', '');
  else box?.querySelector('.picker-face')?.focus();
}

function spaceTablesCard(space) {
  const add = space.system ? null
    : el('button', { class: 'btn btn-sm wv-start-new', onclick: () => startTableDialog({ spaceId: space.spaceId }) }, '+ New table');
  if (!space.tables.length) {
    return el('div', { class: 'card wv-start space-tables' },
      el('div', { class: 'card-body' }, el('p', { class: 'wv-start-lead' }, 'No tables in this space yet.'), add));
  }
  return el('div', { class: 'card list-rows space-tables' },
    ...space.tables.map((t) => el('div', { class: 'list-row', dataset: { href: `#/table/${t.id}` }, onclick: () => { location.hash = `#/table/${t.id}`; } },
      el('span', {}, t.name),
      el('span', { class: 'spacer' }),
      el('span', { class: 'pid' }, WeaveTerm.count(t.entityCount ?? 0, t.term)))),
    add ? el('div', { class: 'list-row list-row-add' }, add) : null);
}

const AUTO_ACTION = { 'set-field': (x) => `set ${x.field}`, 'append-doc': (x) => `append ${x.field}`, 'add-comment': () => 'comment' };

function relationMapView(tables, automations, { spaceId = null } = {}) {
  const autosByTable = new Map();
  for (const a of automations ?? []) {
    if (!autosByTable.has(a.tableId)) autosByTable.set(a.tableId, []);
    autosByTable.get(a.tableId).push(a);
  }
  const autoCounts = Object.fromEntries([...autosByTable].map(([id, list]) => [id, list.length]));
  const map = globalThis.WeaveRelmap.relmapLayout(tables, { spaceId, autoCounts });
  if (!map.nodes.length) {
    return el('div', { class: 'wv-empty' }, spaceId ? 'No related tables in this space yet.' : 'No tables yet.');
  }
  const svg = svgEl('svg', { viewBox: `0 0 ${map.width} ${map.height}`, class: 'relmap', width: map.width, height: map.height });

  const defs = svgEl('defs');
  const marker = svgEl('marker', {
    id: 'relmap-arrow', viewBox: '0 0 8 8', refX: '7', refY: '4',
    markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
  });
  marker.append(svgEl('path', { d: 'M0,0 L8,4 L0,8 z', class: 'rel-arrow' }));
  defs.append(marker);
  svg.append(defs);

  for (const g of map.groups) {
    svg.append(svgEl('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 14, class: 'space-box' }));
    svg.append(svgEl('text', { x: g.x + 14, y: g.y + 18, class: 'space-label' }, g.name));
  }

  for (const e of map.edges) {
    if (e.self) {
      svg.append(svgEl('path', {
        d: `M${e.x1},${e.y1} C${e.x1 + 34},${e.y1 - 16} ${e.x2 + 34},${e.y2 + 16} ${e.x2},${e.y2}`,
        class: 'rel-line', 'marker-end': 'url(#relmap-arrow)', fill: 'none',
      }));
    } else {
      svg.append(svgEl('line', { x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, class: 'rel-line', 'marker-end': 'url(#relmap-arrow)' }));
    }
    const tw = e.label.length * 6.2 + 14;
    svg.append(svgEl('rect', { x: e.lx - tw / 2, y: e.ly - 9, width: tw, height: 18, rx: 9, class: 'rel-label-bg' }));
    svg.append(svgEl('text', { x: e.lx, y: e.ly + 4, 'text-anchor': 'middle', class: 'rel-label' }, e.label));
  }

  for (const n of map.nodes) {
    const x = n.x - n.w / 2, y = n.y - n.h / 2;
    const g = svgEl('g', { class: 'table-node' + (n.foreign ? ' foreign' : ''), cursor: 'pointer', 'data-href': `#/table/${n.id}` });
    g.addEventListener('click', () => { location.hash = `#/table/${n.id}`; });
    g.append(svgEl('rect', { x, y, width: n.w, height: n.h, rx: 10, class: 'node-box' }));
    g.append(svgEl('text', { x: n.x, y: y + 24, 'text-anchor': 'middle', class: 'node-title' }, n.name));
    g.append(svgEl('text', { x: n.x, y: y + 43, 'text-anchor': 'middle', class: 'node-sub' },
      n.foreign ? `${n.space} • ${WeaveTerm.count(n.entityCount, n.term)}` : WeaveTerm.count(n.entityCount, n.term)));
    svg.append(g);

    (autosByTable.get(n.id) ?? []).forEach((a, i) => {
      const ay = y + n.h + 6 + i * 25;
      const actions = a.actions.map((x) => (AUTO_ACTION[x.type] ?? (() => 'webhook'))(x)).join(', ');
      const trig = a.trigger.type === 'state-changed' ? `${a.trigger.field}→${a.trigger.toState ?? '*'}`
        : a.trigger.type === 'field-updated' ? `${a.trigger.field} changed` : 'created';
      const full = `⚡ ${trig} ⇒ ${actions}`;
      const fits = Math.floor((n.w - 16) / 5.8);
      const label = full.length > fits ? full.slice(0, fits - 1).trimEnd() + '…' : full;
      const tw = Math.min(n.w, label.length * 5.8 + 14);
      svg.append(svgEl('line', { x1: n.x, y1: y + n.h, x2: n.x, y2: ay, class: 'auto-line' }));
      const pill = svgEl('g', { class: 'auto' });
      pill.append(svgEl('title', {}, full));
      pill.append(svgEl('rect', { x: n.x - tw / 2, y: ay, width: tw, height: 17, rx: 8.5, class: 'auto-pill' + (a.enabled ? '' : ' off') }));
      pill.append(svgEl('text', { x: n.x, y: ay + 12, 'text-anchor': 'middle', class: 'auto-label' }, label));
      svg.append(pill);
    });
  }

  return el('div', { class: 'map-view' },
    el('div', { class: 'map-wrap' }, svg),
    el('div', { class: 'map-legend' },
      el('span', {}, '▢ table (click to open)'),
      el('span', {}, '→ relation (1/∗ = cardinality)'),
      el('span', {}, '⚡ automation: trigger ⇒ actions')));
}

async function relationMapCard(title, { spaceId = null } = {}) {
  const card = el('div', { class: 'card panel home-map' },
    el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, title)),
    el('div', { class: 'card-body' }, el('div', { class: 'wv-empty' }, '…')));
  const automations = await api('GET', '/automations').catch(() => []);
  const tables = state.schema.flatMap((s) => s.tables.map((t) => ({ ...t, space: s.space, spaceId: s.spaceId })));
  const view = relationMapView(tables, automations, { spaceId });
  card.querySelector('.card-body').replaceChildren(view);
  return view.classList.contains('wv-empty') ? null : card;
}

async function showMap() {
  state.route = { page: 'map' };
  renderNav();
  const main = $('#main');
  main.replaceChildren(viewHeader({
    crumbs: [{ label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() }],
    permalink: `${location.origin}${WS_PREFIX}/#/map`,
    title: 'Relation map',
  }));
  const automations = await api('GET', '/automations');
  main.append(relationMapView(allTables(), automations));
}

const DOC_SAVE_DEBOUNCE = 600;
const liveEditors = new Set();
const pendingDocSaves = new Map();
const docPulls = new WeakMap();


const SLASH_GROUPS = [
  ['all', 'ALL COMMANDS'],
  ['reference', 'REFERENCE'],
  ['format', 'FORMAT · APPLIES TO SELECTION'],
];

const refMarker = (kind) => `⁣ref:${kind}⁣`;
const DEFERRED_INSERTS = {
  '⁣raw-html⁣': '<div>html</div>',
  '⁣table⁣': { md: '| Column | Column |\n| --- | --- |\n| Cell | Cell |', select: 'Column' },
};
const ENTITY_LINK_MARKER = refMarker('entity');
const REF_MARKER_RE = /⁣ref:(entity|table|space)⁣/;
const holdsCommandMarker = (v) => REF_MARKER_RE.test(v)
  || globalThis.WeaveEditorLib.BLOCK_MARKER_RE.test(v)
  || Object.keys(DEFERRED_INSERTS).some((m) => v.includes(m));
const blockMarker = (kind) => globalThis.WeaveEditorLib.blockMarker(kind);

const SELECTION_MEMORY_MS = 15000;
let lastSelection = { text: '', at: 0 };
function rememberSelection() {
  const sel = document.getSelection();
  const text = sel && !sel.isCollapsed ? String(sel).replace(/\s+/g, ' ').trim() : '';
  if (text) lastSelection = { text, at: Date.now() };
}
function selectionForFormat() {
  const fresh = lastSelection.text && Date.now() - lastSelection.at < SELECTION_MEMORY_MS;
  return fresh ? lastSelection.text : '';
}

function slashItems() {
  const wrap = (before, after = before) => {
    const picked = selectionForFormat();
    return `${before}${picked || 'text'}${after}`;
  };
  const headings = [1, 2, 3, 4, 5, 6].map((n) => ({
    label: `Heading ${n}`, icon: 'H', group: 'all', hidden: true,
    hint: `${'#'.repeat(n)} `, aliases: [`h${n}`, `heading${n}`],
    insert: blockMarker(`h${n}`),
  }));
  return [
    { label: 'Text', icon: '¶', flat: 'pilcrow', group: 'all', hint: '—', aliases: ['paragraph', 'plain'], insert: blockMarker('text') },
    { label: 'Heading 1–6', icon: 'H', group: 'all', hint: '#…######', aliases: ['title'], insert: blockMarker('h1') },
    ...headings,
    { label: 'Bulleted list', icon: '•', flat: 'list', group: 'all', hint: '-', aliases: ['ul', 'unordered'], insert: blockMarker('bullet') },
    { label: 'Numbered list', icon: '1.', flat: 'list-ordered', group: 'all', hint: '1.', aliases: ['ol', 'ordered'], insert: blockMarker('number') },
    { label: 'Task list', icon: '☑', flat: 'square-check', group: 'all', hint: '- [ ]', aliases: ['todo', 'checkbox'], insert: blockMarker('task') },
    { label: 'Quote', icon: '❝', flat: 'quote', group: 'all', hint: '>', aliases: ['blockquote'], insert: blockMarker('quote') },
    { label: 'Code block', icon: '#', flat: 'code', group: 'all', hint: '```', aliases: ['fence', 'pre'], insert: '```\ncode\n```' },
    { label: 'Mermaid diagram', icon: '◈', flat: 'workflow', group: 'all', hint: '```mermaid', aliases: ['chart', 'graph', 'flow'], insert: '```mermaid\ngraph TD\n  A --> B\n```' },
    { label: 'Table', icon: '▦', flat: 'table', group: 'all', hint: '| a | b |', aliases: ['grid'], insert: '⁣table⁣' },
    { label: 'Divider', icon: '—', flat: 'minus', group: 'all', hint: '***', aliases: ['hr', 'rule', 'separator'], insert: '\n***\n' },
    { label: 'Line break', icon: '↵', flat: 'corner-down-left', group: 'all', hint: '\\ + ⏎', aliases: ['br', 'newline', 'return'], insert: '\\\n' },
    { label: 'Image', icon: '▤', flat: 'image', group: 'all', hint: '![](…)', aliases: ['picture', 'photo'], insert: '![alt](url)' },
    { label: 'Raw HTML', icon: '</>', flat: 'braces', group: 'all', hint: '<div>', aliases: ['embed', 'html'], insert: '⁣raw-html⁣' },

    { label: 'Entity', icon: '#', flat: 'hash', group: 'reference', hint: '[[Task#12]]', aliases: ['record', 'row', 'link entity', 'mention'], insert: refMarker('entity') },
    { label: 'Table', icon: '▦', flat: 'table', group: 'reference', hint: '[[table:…]]', aliases: ['database', 'link table'], insert: refMarker('table') },
    { label: 'Space / workspace', icon: '◇', flat: 'folder', group: 'reference', hint: '[[space:…]]', aliases: ['link space'], insert: refMarker('space') },

    { label: 'Bold', icon: 'B', group: 'format', hint: '**…**', aliases: ['strong'], insert: wrap('**') },
    { label: 'Italic', icon: 'I', group: 'format', hint: '*…*', aliases: ['emphasis', 'em'], insert: wrap('*') },
    { label: 'Strikethrough', icon: 'S', group: 'format', hint: '~~…~~', aliases: ['strike', 'delete'], insert: wrap('~~') },
    { label: 'Inline code', icon: '`', group: 'format', hint: '`…`', aliases: ['monospace'], insert: wrap('`') },
    { label: 'Link', icon: '⛓', flat: 'link', group: 'format', hint: '[…](…)', aliases: ['url', 'href'], insert: `[${selectionForFormat() || 'text'}](url)` },
  ];
}

function entityReference(hit) {
  return `[[${hit.db}#${hit.publicId}|${hit.name}]]`;
}

function referenceFor(kind, hit) {
  if (hit.kind === 'entity') return entityReference(hit);
  if (hit.kind === 'table') return `[[table:${hit.name}]]`;
  if (hit.kind === 'space') return `[[space:${hit.name}]]`;
  return `[[workspace|${hit.name}]]`;
}

function slashScore(item, q) {
  if (!q) return 0;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 100;
  if ((item.aliases ?? []).some((a) => a.toLowerCase().startsWith(q))) return 90;
  if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 70;
  if (label.includes(q)) return 50;
  if ((item.aliases ?? []).some((a) => a.toLowerCase().includes(q))) return 40;
  return 0;
}

const SLASH_PROMOTED = 4;

function slashRows(query) {
  const q = String(query ?? '').trim().toLowerCase();
  const items = slashItems();
  const ranked = q
    ? items
      .map((item, i) => ({ item, i, score: slashScore(item, q) }))
      .filter((r) => r.score >= 70)
      .sort((a, b) => (b.score - a.score) || (a.i - b.i))
      .slice(0, SLASH_PROMOTED)
    : [];
  const promoted = new Set(ranked.map((r) => r.item));
  const rows = ranked.map((r, n) => ({ item: r.item, group: n === 0 ? 'INSERT' : null }));
  for (const [key, title] of SLASH_GROUPS) {
    let first = true;
    for (const item of items) {
      if (item.group !== key || item.hidden || promoted.has(item)) continue;
      rows.push({ item, group: first ? title : null });
      first = false;
    }
  }
  return rows;
}

const ENTITY_HINT_MIN = 2;
const entityHintCache = new Map();
let entityHintFailing = false;

async function entityHint(query) {
  const q = String(query ?? '').trim();
  if (q.length < ENTITY_HINT_MIN) return [];
  let hits = entityHintCache.get(q);
  if (!hits) {
    try {
      hits = (await api('GET', `/search?q=${encodeURIComponent(q)}&limit=12`))
        .filter((h) => h.kind === 'entity');
      entityHintFailing = false;
    } catch (err) {
      if (!entityHintFailing) toast(`Couldn't search: ${err.message}`, true);
      entityHintFailing = true;
      return [];
    }
    entityHintCache.set(q, hits);
  }
  return hits.map((hit) => ({
    value: entityReference(hit),
    html: '<span class="slash-item"><span class="slash-icon">#</span>'
      + `<b>${escapeHtmlText(hit.name || `#${hit.publicId}`)}</b>`
      + `<code class="slash-syntax">${escapeHtmlText(hit.db)} #${hit.publicId}</code></span>`,
  }));
}

function slashHint(query) {
  return slashRows(query).map(({ item, group }) => ({
    value: item.insert,
    html: (group ? `<span class="slash-group">${escapeHtmlText(group)}</span>` : '')
      + `<span class="slash-item"><span class="slash-icon">${slashGlyph(item)}</span>`
      + `<b>${escapeHtmlText(item.label)}</b>`
      + `<code class="slash-syntax">${escapeHtmlText(item.hint)}</code></span>`,
  }));
}

function slashGlyph(item) {
  const name = item.flat && window.weaveIconRegistry?.resolve(`lucide:${item.flat}`);
  return name ? window.LUCIDE_MOVING[name] : escapeHtmlText(item.icon);
}

function escapeHtmlText(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function vditorTheme() {
  const dark = document.documentElement.dataset.bsTheme === 'dark';
  return { ui: dark ? 'dark' : 'classic', content: dark ? 'dark' : 'light', hljs: dark ? 'github-dark' : 'github' };
}

function dedupeVditorSprites() {
  const sprites = [...document.querySelectorAll('body > svg')].filter((v) => v.querySelector('symbol'));
  for (const extra of sprites.slice(1)) extra.remove();
}

function tableCellOf(node) {
  for (let n = node instanceof Element ? node : node?.parentElement; n; n = n.parentElement) {
    if (n.tagName === 'TD' || n.tagName === 'TH') return n;
  }
  return null;
}
function rowIsEmpty(cell) {
  return [...cell.parentElement.children].every((c) => !c.textContent.trim());
}
function replayChord(host, key, shift = false) {
  const mac = /Mac|iPhone/.test(navigator.platform);
  const ir = host.querySelector('.vditor-ir .vditor-reset') ?? host;
  ir.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: mac, ctrlKey: !mac, shiftKey: shift, bubbles: true, cancelable: true }));
}
const HINT_MIN_PX = 160;
function hintFloor(hint) {
  const head = document.querySelector(hint.closest('#dock') ? '#dock .view-header' : '#main > .view-header');
  return head ? head.getBoundingClientRect().bottom + 4 : 8;
}
const ENTER_HOLD_MS = 1000;
const ENTER_DRIFT_PX = 120;
function editorScroller(node) {
  for (let n = node?.parentElement; n; n = n.parentElement) {
    const overflow = getComputedStyle(n).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && n.scrollHeight - n.clientHeight > 1) return n;
  }
  return document.scrollingElement;
}
const scrollTopOf = (s) => (s === document.scrollingElement ? scrollY : s.scrollTop);
const putScrollTop = (s, top) => (s === document.scrollingElement
  ? scrollTo({ top, behavior: 'instant' })
  : s.scrollTo({ top, behavior: 'instant' }));
function caretOffsetIn(scroller) {
  const sel = getSelection();
  if (!sel?.rangeCount) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r.width && !r.height && !r.top) return null;
  const base = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
  return r.top - base + scrollTopOf(scroller);
}
function keepPlaceThroughEnter(host) {
  const scroller = editorScroller(host);
  if (!scroller) return;
  const from = scrollTopOf(scroller);
  const caret = caretOffsetIn(scroller);
  const viewport = scroller.clientHeight || innerHeight;
  const held = caret === null || (caret >= from && caret <= from + viewport);
  const pressedAt = performance.now();
  const pin = () => {
    if (performance.now() - pressedAt > ENTER_HOLD_MS || readerActedAt > pressedAt) return;
    if (held && Math.abs(scrollTopOf(scroller) - from) > ENTER_DRIFT_PX) putScrollTop(scroller, from);
    requestAnimationFrame(pin);
  };
  requestAnimationFrame(pin);
}
const HINT_GRACE_MS = 1000;
let readerActedAt = -Infinity;
for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
  addEventListener(type, () => { readerActedAt = performance.now(); }, { capture: true, passive: true });
}
function readerClosedHint(openedAt) {
  if (openedAt === undefined) return true;
  return readerActedAt > openedAt || performance.now() - openedAt >= HINT_GRACE_MS;
}
function attachHintClamp(host) {
  const put = (el, prop, v) => { if (el.style[prop] !== v) el.style[prop] = v; };
  const clamp = (hint) => {
    const floor = hintFloor(hint);
    const r = hint.getBoundingClientRect();
    const over = floor - r.top;
    if (over <= 0) return;
    put(hint, 'maxHeight', `${Math.max(HINT_MIN_PX, r.bottom - floor)}px`);
    put(hint, 'top', `${parseFloat(hint.style.top || '0') + over}px`);
  };
  const openedAt = new WeakMap();
  new MutationObserver((muts) => {
    for (const m of muts) {
      const hint = m.target.classList?.contains('vditor-hint') ? m.target : null;
      if (!hint) continue;
      if (hint.style.display === 'none') {
        if (!readerClosedHint(openedAt.get(hint))) { hint.style.display = 'block'; clamp(hint); continue; }
        openedAt.delete(hint);
        if (hint.style.maxHeight) hint.style.removeProperty('max-height');
        continue;
      }
      if (!openedAt.has(hint)) openedAt.set(hint, performance.now());
      clamp(hint);
    }
  }).observe(host, { subtree: true, attributes: true, attributeFilter: ['style'] });
  host.addEventListener('wheel', (e) => {
    const hint = e.target.closest?.('.vditor-hint');
    if (!hint || hint.style.display === 'none') return;
    const room = e.deltaY > 0 ? hint.scrollHeight - hint.clientHeight - hint.scrollTop : hint.scrollTop;
    if (room <= 0) e.preventDefault();
  }, { passive: false });
}

function attachTableKeys(host) {
  host.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.isComposing) return;
    const cell = tableCellOf(document.getSelection()?.anchorNode);
    if (!cell || !host.contains(cell)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      replayChord(host, '=');
    } else if (e.key === 'Enter' && e.shiftKey) {
      if (!rowIsEmpty(cell)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      replayChord(host, '-');
    } else if (e.key === 'Tab' && !e.shiftKey) {
      const table = cell.closest('table');
      const cells = table.querySelectorAll('td, th');
      const lastCell = cells[cells.length - 1];
      if (cell !== lastCell) return;
      replayChord(host, '=');
    }
  }, { capture: true });
}

const tbIcon = (name) => (window.LUCIDE_MOVING?.[name] ?? '').replace(/ data-mi="[^"]*"/g, '');
const WV_TB_ICONS = {
  headings: tbIcon('heading'), bold: tbIcon('bold'), italic: tbIcon('italic'), strike: tbIcon('strikethrough'),
  'inline-code': tbIcon('code'), link: tbIcon('link'),
  list: tbIcon('list'), 'ordered-list': tbIcon('list-ordered'), check: tbIcon('list-checks'),
  outdent: tbIcon('list-indent-decrease'), indent: tbIcon('list-indent-increase'),
  quote: tbIcon('quote'), code: tbIcon('braces'), table: tbIcon('table'), line: tbIcon('minus'),
  undo: tbIcon('undo'), redo: tbIcon('redo'), upload: tbIcon('upload'),
};

function guardMathRender() {
  const adapter = window.Vditor?.adapterRender?.mathRenderAdapter;
  const live = globalThis.WeaveEditorLib.liveMathElements;
  if (adapter && adapter.getElements !== live) adapter.getElements = live;
}
function mountDocEditor(host, { value, placeholder, onInput: hand, onBlur, autoFocus, entityId }) {
  guardMathRender();
  const t = vditorTheme();
  let handed = null;
  const stored = (v) => globalThis.WeaveEditorLib.normalizeTaskBoxes(v);
  const onInput = (v) => { handed = stored(v); hand(handed); };
  const pull = () => {
    if (handed === null) return;
    let v;
    try { v = editor.getValue(); } catch { return; }
    if (stored(v) !== handed && !holdsCommandMarker(v)) onInput(v);
  };
  host.addEventListener('focusout', () => { pull(); flushDocSaves(); });
  const chips = attachRefChips(host);
  attachCodeAuto(host);
  attachCodeRawToggle(host);
  attachTableKeys(host);
  attachHintClamp(host);
  const editor = new Vditor(host, {
    mode: 'ir',
    cdn: '/vendor/vditor',
    value,
    placeholder,
    lang: 'en_US',
    icon: 'ant',
    theme: t.ui,
    minHeight: 160,
    cache: { enable: false },
    counter: { enable: false },
    toolbar: [
      'headings', 'bold', 'italic', 'strike', 'inline-code', 'link', '|',
      'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
      'quote', 'code', 'table', 'line', '|',
      'undo', 'redo', 'upload',
    ].map((n) => (n === '|' ? n : { name: n, icon: WV_TB_ICONS[n] })),
    toolbarConfig: { hide: false, pin: false },
    upload: {
      multiple: true,
      handler: (files) => uploadDocFiles(files, entityId, () => editor, onInput),
    },
    outline: { enable: false, position: 'left' },
    preview: {
      hljs: { enable: true, style: t.hljs, lineNumber: false },
      theme: { current: t.content, path: '/vendor/vditor/dist/css/content-theme' },
      math: { engine: 'KaTeX' },
    },
    hint: { emoji: window.weaveIconRegistry?.emojiTable() ?? {}, emojiPath: '/vendor/icons', extend: [{ key: '/', hint: slashHint }, { key: '#', hint: entityHint }] },
    after: () => {
      dedupeVditorSprites();
      editor.vditor?.lute?.SetEmojis?.(window.weaveIconRegistry?.emojiTable() ?? {});
      const md = editor.getValue();
      if (new RegExp(globalThis.WeaveEditorLib.ICON_TOKEN.source).test(md)) editor.setValue(md);
      handed = stored(editor.getValue());
      scheduleDecorFor(host);
      host.addEventListener('keyup', rememberSelection);
      host.addEventListener('mouseup', rememberSelection);
      host.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        requestAnimationFrame(() =>
          scrollTargetIntoView(host.querySelector('.vditor-hint--current'), { block: 'nearest' }));
      });
      host.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
        keepPlaceThroughEnter(host);
      }, { capture: true });
      host.addEventListener('keydown', (e) => {
        if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
        e.preventDefault();
        e.stopPropagation();
        editor.vditor?.undo?.redo(editor.vditor);
      }, { capture: true });
      host.addEventListener('beforeinput', (e) => {
        const step = { historyUndo: 'undo', historyRedo: 'redo' }[e.inputType];
        if (!step) return;
        e.preventDefault();
        editor.vditor?.undo?.[step](editor.vditor);
      }, { capture: true });
      attachToolbarBubble(host);
      attachFileTools(host, editor, onInput);
      watchCommandMarkers(host, editor, onInput);
      if (autoFocus) editor.focus();
    },
    ...(onBlur ? { blur: () => onBlur() } : {}),
    input: (v) => {
      if (holdsCommandMarker(v)) return applyCommandMarkers(host, editor, onInput);
      onInput(v);
      scheduleDecorFor(host);
    },
  });
  docPulls.set(editor, pull);
  liveEditors.add(editor);
  return editor;
}

const docBubbles = new Set();

function attachToolbarBubble(host) {
  const st = { host };
  st.place = () => placeToolbarBubble(st);
  docBubbles.add(st);
  st.place();
}

function placeToolbarBubble(st) {
  if (!document.body.contains(st.host)) { docBubbles.delete(st); return; }
  const bar = st.host.querySelector('.vditor-toolbar');
  const root = st.host.querySelector('.vditor-ir .vditor-reset');
  if (!bar || !root) return;
  const sel = getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
  const inBar = bar.contains(document.activeElement) || bar.matches(':hover');
  const on = (range && !range.collapsed && root.contains(range.startContainer)
    && root.contains(range.endContainer)) || (inBar && bar.classList.contains('wv-show'));
  bar.classList.toggle('wv-show', !!on);
  const docked = dockCoversScreen.matches;
  bar.classList.toggle('wv-bar-dock', docked);
  if (docked) {
    const keyboard = keyboardInset();
    bar.style.left = '';
    bar.style.top = '';
    bar.style.bottom = `${keyboard}px`;
    return;
  }
  bar.style.bottom = '';
  if (!on || inBar) return;
  const r = range.getBoundingClientRect();
  const base = st.host.getBoundingClientRect();
  const barW = bar.offsetWidth, barH = bar.offsetHeight;
  const left = Math.max(0, Math.min(base.width - barW, r.left - base.left + r.width / 2 - barW / 2));
  const above = r.top - base.top - barH - 8;
  bar.style.left = `${left}px`;
  bar.style.top = `${above >= 0 ? above : r.bottom - base.top + 8}px`;
}

document.addEventListener('selectionchange', () => {
  for (const st of docBubbles) queueMicrotask(st.place);
});
for (const ev of ['resize', 'scroll']) {
  window.visualViewport?.addEventListener(ev, () => {
    for (const st of docBubbles) st.place();
  });
}

async function uploadDocFiles(files, entityId, getEditor, onInput) {
  if (!entityId) return 'This document has no record to attach to';
  const editor = getEditor();
  for (const f of files) {
    const contentBase64 = await fileBase64(f);
    let meta;
    try {
      meta = await api('POST', `/entities/${entityId}/files`, {
        name: f.name, mime: f.type || 'application/octet-stream', contentBase64,
      });
    } catch (e) { return `Upload failed: ${e.message}`; }
    const url = `${WS_PREFIX}/api/files/${meta.id}`;
    const mime = f.type || '';
    const md = /^image\/(png|jpeg|gif|webp)$/.test(mime) ? `![${f.name}](${url})`
      : mime === 'application/pdf'
        ? `\n<iframe class="wv-file" src="${url}" title="${f.name}"></iframe>\n`
        : `[${f.name}](${url})`;
    editor.insertValue(md + '\n');
  }
  onInput?.(editor.getValue());
  return null;
}

function attachFileTools(host, editor, onInput) {
  const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let target = null;
  const tools = el('div', { class: 'wv-file-tools' },
    el('button', { type: 'button', title: 'Replace the viewer with a plain link' }, 'Show as link'));
  tools.addEventListener('mousedown', (e) => e.preventDefault());
  tools.querySelector('button').addEventListener('click', () => {
    if (!target) return;
    const src = target.getAttribute('src');
    const name = (target.tagName === 'IMG' ? target.getAttribute('alt') : target.getAttribute('title')) || 'file';
    const v = editor.getValue();
    const next = target.tagName === 'IMG'
      ? v.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escRe(src)}\\)`), `[${name}](${src})`)
      : v.replace(new RegExp(`<iframe[^>]*src="${escRe(src)}"[^>]*></iframe>`), `[${name}](${src})`);
    tools.remove(); target = null;
    if (next === v) return;
    editor.setValue(next);
    onInput(next);
    scheduleDecorFor(host);
  });
  host.addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('.vditor-ir img, iframe.wv-file');
    if (!t || !host.contains(t)) return;
    target = t;
    const r = t.getBoundingClientRect();
    const base = host.getBoundingClientRect();
    tools.style.left = `${r.left - base.left + r.width / 2}px`;
    tools.style.top = `${Math.max(0, r.top - base.top - 30)}px`;
    host.append(tools);
  });
  host.addEventListener('mouseout', (e) => {
    if (!target) return;
    const to = e.relatedTarget;
    if (to && (to === target || tools.contains(to) || target.contains?.(to))) return;
    if (to && to.closest?.('.wv-file-tools')) return;
    tools.remove(); target = null;
  });
}


const REF_CHIP_DEBOUNCE = 250;
const refChipLayers = new Set();
const refResolveCache = new Map();

function scheduleDecorFor(host) {
  for (const s of [...refChipLayers, ...docRails, ...docFolds, ...docCodeAuto, ...docCodeRaw]) {
    if (s.host === host) s.schedule();
  }
}

const docCodeAuto = new Set();

function attachCodeAuto(host) {
  const st = { host, timer: 0 };
  st.schedule = () => {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => refreshCodeAuto(st), REF_CHIP_DEBOUNCE);
  };
  docCodeAuto.add(st);
  return st;
}

function refreshCodeAuto(st) {
  if (!document.body.contains(st.host)) { docCodeAuto.delete(st); return; }
  const hljs = window.hljs;
  if (!hljs?.highlightAuto) {
    if ((st.tries = (st.tries ?? 0) + 1) < 20) st.schedule();
    return;
  }
  let applied = false;
  for (const code of st.host.querySelectorAll('.vditor-ir__preview > code')) {
    const ours = code.dataset.autoLang;
    if (!ours && /language-\S/.test(code.className)) continue;
    const text = code.textContent ?? '';
    const answered = code.dataset.autoFor === text;
    if (answered && (!ours || code.querySelector('span'))) continue;
    code.dataset.autoFor = text;
    const lang = globalThis.WeaveEditorLib?.detectCodeLanguage(text);
    if (!lang) { delete code.dataset.autoLang; continue; }
    try {
      code.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      code.classList.add('hljs', `language-${lang}`);
      code.dataset.autoLang = lang;
      applied = true;
    } catch {}
  }
  if (applied && (st.rechecks = (st.rechecks ?? 0) + 1) <= 3) st.schedule();
  else if (!applied) st.rechecks = 0;
}

const docCodeRaw = new Set();

const codeRawNode = (host) =>
  host.querySelector('.vditor-ir .vditor-reset .vditor-ir__node--expand[data-type="code-block"]');
const codeRawIsDrawing = (node) => !node.querySelector(':scope > .vditor-ir__preview > code');

function setCodeRaw(st, on) {
  st.host.classList.toggle('wv-code-raw', on);
  st.btn.setAttribute('aria-pressed', String(on));
  st.btn.title = on ? 'Hide markdown source' : 'Show markdown source';
  st.place();
}

function attachCodeRawToggle(host) {
  const btn = el('button', { type: 'button', class: 'doc-code-raw', 'aria-pressed': 'false', title: 'Show markdown source' },
    iconEl('lucide:code-xml', 'wv-icon'));
  const st = { host, btn, key: -1, timer: 0 };
  st.place = () => placeCodeRaw(st);
  st.schedule = () => queueMicrotask(st.place);
  st.stop = () => {
    st.dead = true;
    clearTimeout(st.timer);
    btn.remove();
    host.classList.remove('wv-code-raw');
  };
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => setCodeRaw(st, !host.classList.contains('wv-code-raw')));
  host.addEventListener('click', st.schedule);
  host.addEventListener('keyup', st.schedule);
  host.addEventListener('focusout', () => { clearTimeout(st.timer); st.timer = setTimeout(st.place); });
  host.addEventListener('keydown', (e) => {
    if (e.isComposing || e.altKey || ((e.metaKey || e.ctrlKey) && e.key !== 'v')) return;
    if (e.key.length !== 1 && !['Enter', 'Backspace', 'Delete', 'Tab'].includes(e.key)) return;
    const node = codeRawNode(host);
    if (node && codeRawIsDrawing(node) && !host.classList.contains('wv-code-raw')) setCodeRaw(st, true);
  }, { capture: true });
  docCodeRaw.add(st);
  return st;
}

function placeCodeRaw(st) {
  if (st.dead) return;
  if (!document.body.contains(st.host)) { docCodeRaw.delete(st); return; }
  const node = codeRawNode(st.host);
  const key = node ? [...node.parentElement.querySelectorAll(':scope > [data-type="code-block"]')].indexOf(node) : -1;
  if (key !== st.key) {
    st.key = key;
    if (st.host.classList.contains('wv-code-raw')) { setCodeRaw(st, false); return; }
  }
  const panel = node && [...node.querySelectorAll(':scope > pre')].find((p) => p.getClientRects().length);
  if (!panel) { st.btn.remove(); return; }
  if (!st.btn.isConnected) st.host.append(st.btn);
  const r = panel.getBoundingClientRect();
  const base = st.host.getBoundingClientRect();
  st.btn.style.top = `${r.top - base.top + 6}px`;
  st.btn.style.right = `${base.right - r.right + 6}px`;
}

function attachRefChips(host) {
  const st = { host, layer: el('div', { class: 'doc-ref-layer' }), timer: 0 };
  st.schedule = () => {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => refreshRefChips(st), REF_CHIP_DEBOUNCE);
  };
  refChipLayers.add(st);
  return st;
}

document.addEventListener('selectionchange', () => {
  for (const st of refChipLayers) st.schedule();
});
window.addEventListener('scroll', () => {
  for (const st of refChipLayers) st.schedule();
  for (const st of docRails) st.schedule();
}, true);
let resizeFrame = 0;
window.addEventListener('resize', () => {
  if (resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    for (const st of docRails) st.schedule();
  });
});

async function refreshRefChips(st) {
  if (!document.body.contains(st.host)) { refChipLayers.delete(st); return; }
  const root = st.host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return;
  if (!st.layer.isConnected) st.host.append(st.layer);
  const lib = globalThis.WeaveEditorLib;

  root.normalize();

  const spans = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const codeCtx = n.parentElement?.closest(lib.REF_SKIP_SELECTOR);
    if (codeCtx && codeCtx !== root) continue;
    const found = lib.findRefSpans(n.nodeValue);
    if (!found.length) continue;
    const box = n.parentElement.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) continue;
    for (const s of found) spans.push({ node: n, ...s });
  }

  await resolveRefs(spans.map((s) => s.ref));
  if (!document.body.contains(st.layer)) return;

  const sel = getSelection();
  const caret = sel?.rangeCount ? sel.getRangeAt(0) : null;
  const base = st.layer.getBoundingClientRect();
  st.layer.replaceChildren();
  for (const s of spans) {
    const hit = refResolveCache.get(s.ref);
    if (!hit) continue;
    if (caret?.startContainer === s.node && caret.startOffset >= s.start && caret.startOffset <= s.end) continue;
    const range = document.createRange();
    range.setStart(s.node, s.start);
    range.setEnd(s.node, s.end);
    const rects = range.getClientRects();
    if (rects.length !== 1) continue;
    const r = rects[0];
    st.layer.append(el('a', {
      class: `mention mention-${hit.kind} doc-ref-chip`,
      href: hit.href,
      title: hit.title,
      style: `left:${r.left - base.left}px; top:${r.top - base.top - 2}px; width:${r.width}px; height:${r.height + 4}px;`,
    }, el('span', { class: 'k k-rel doc-ref-label' }, el('span', { class: 'k-label' }, s.label ?? hit.label))));
  }
}

const DASH_READING_LINE = 80;
const docRails = new Set();

function attachDashRail(section, host) {
  const track = el('div', { class: 'doc-rail-track' });
  const st = {
    section, host, track, timer: 0,
    rail: el('nav', { class: 'doc-rail', title: 'Document outline' }, track),
  };
  const onAway = (e) => { if (!st.rail.contains(e.target)) st.close(); };
  const onKey = (e) => { if (e.key === 'Escape') st.close(); };
  st.close = () => {
    st.rail.classList.remove('open');
    document.removeEventListener('click', onAway, true);
    document.removeEventListener('keydown', onKey);
  };
  st.rail.addEventListener('click', (e) => {
    if (st.rail.classList.contains('open')) return;
    e.stopPropagation();
    st.rail.classList.add('open');
    document.addEventListener('click', onAway, true);
    document.addEventListener('keydown', onKey);
  }, { capture: true });
  st.schedule = () => {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => refreshDashRail(st), REF_CHIP_DEBOUNCE);
  };
  docRails.add(st);
  st.schedule();
  return st;
}

function headText(h) {
  return [...h.childNodes]
    .filter((n) => !(n.nodeType === 1 && n.classList.contains('vditor-ir__marker')))
    .map((n) => n.textContent).join('').trim();
}

function refreshDashRail(st) {
  if (!document.body.contains(st.section)) { st.close(); docRails.delete(st); return; }
  const root = st.host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return;
  const heads = [...root.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')]
    .filter((h) => h.offsetParent !== null);
  const lib = globalThis.WeaveEditorLib;
  const spec = lib.railSpec(heads.map((h) => ({ level: +h.tagName[1], text: headText(h) })));
  if (!spec.length) { st.close(); st.rail.remove(); return; }
  if (!st.rail.isConnected) st.section.append(st.rail);
  const lineTop = scrollBoxOf(heads[0])?.getBoundingClientRect().top ?? 0;
  const current = lib.currentSection(heads.map((h) => h.getBoundingClientRect().top - lineTop), DASH_READING_LINE);
  st.track.replaceChildren(...spec.map((d, i) => el('button', {
    class: 'doc-rail-dash' + (i === current ? ' active' : ''),
    type: 'button',
    title: d.text,
    onclick: () => {
      scrollTargetIntoView(heads[i], { block: 'start', padding: DASH_READING_LINE });
      st.close();
    },
  },
  el('i', { class: 'doc-rail-tick', style: `width:${d.width}px` }),
  el('span', { class: 'doc-rail-label' }, d.text))));
  const marker = st.track.children[current];
  if (marker && st.track.scrollHeight > st.track.clientHeight && !st.rail.matches(':hover')) {
    st.track.scrollTop = Math.max(0, marker.offsetTop - st.track.clientHeight / 2);
  }
}

const docFolds = new Set();

function docFoldState(entityId, field, next) {
  const key = `weave-doc-folds:${entityId}:${field}`;
  if (next === undefined) {
    try { return new Set(JSON.parse(localStorage.getItem(key)) ?? []); }
    catch { return new Set(); }
  }
  localStorage.setItem(key, JSON.stringify([...next]));
  return next;
}

function attachHeadingFolds(host, entityId, field, recordName = () => '') {
  const st = { host, entityId, field, recordName, layer: el('div', { class: 'doc-fold-layer' }), timer: 0 };
  st.schedule = () => {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => refreshHeadingFolds(st), REF_CHIP_DEBOUNCE);
  };
  docFolds.add(st);
  st.schedule();
  return st;
}

function refreshHeadingFolds(st) {
  if (!document.body.contains(st.host)) { docFolds.delete(st); return; }
  const root = st.host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return;
  if (!st.layer.isConnected) st.host.append(st.layer);
  const lib = globalThis.WeaveEditorLib;
  const blocks = [...root.children];
  const echo = blocks.length > 1 && blocks[0].tagName === 'H1'
    && lib.isTitleEcho(headText(blocks[0]), st.recordName());
  if (blocks[0] && blocks[0].classList.contains('wv-title-echo') !== echo) {
    blocks[0].classList.toggle('wv-title-echo', echo);
    for (const rail of docRails) rail.schedule();
  }
  const levels = blocks.map((b, i) => (echo && i === 0 ? null : /^H[1-6]$/.test(b.tagName) ? +b.tagName[1] : null));
  const folded = docFoldState(st.entityId, st.field);
  const headKey = (h) => `${h.tagName[1]}:${headText(h)}`;

  for (const b of blocks.slice(1)) b.classList.remove('wv-title-echo');
  for (const b of blocks) b.classList.remove('wv-folded');
  levels.forEach((lvl, i) => {
    if (lvl == null || !folded.has(headKey(blocks[i]))) return;
    for (const j of lib.foldRange(levels, i)) blocks[j].classList.add('wv-folded');
  });

  const base = st.layer.getBoundingClientRect();
  const carets = [];
  levels.forEach((lvl, i) => {
    if (lvl == null || blocks[i].offsetParent === null) return;
    const key = headKey(blocks[i]);
    const isFolded = folded.has(key);
    const r = blocks[i].getBoundingClientRect();
    carets.push(el('button', {
      class: 'doc-fold' + (isFolded ? ' folded' : ''),
      type: 'button',
      title: isFolded ? 'Unfold section' : 'Fold section',
      style: `top:${r.top - base.top}px; height:${r.height}px;`,
      onclick: () => {
        const next = docFoldState(st.entityId, st.field);
        next.has(key) ? next.delete(key) : next.add(key);
        docFoldState(st.entityId, st.field, next);
        refreshHeadingFolds(st);
        for (const rail of docRails) rail.schedule();
      },
    }));
  });
  st.layer.replaceChildren(...carets);
}

async function resolveRefs(refs) {
  const missing = [...new Set(refs)].filter((r) => !refResolveCache.has(r));
  if (!missing.length) return;
  try {
    const { html } = await api('POST', '/markdown', { md: missing.map((r) => `[[${r}]]`).join('\n\n') });
    const box = document.createElement('div');
    box.innerHTML = html;
    const paras = [...box.children];
    missing.forEach((ref, i) => {
      const a = paras[i]?.querySelector('a.mention');
      if (!a) return refResolveCache.set(ref, null);
      let href = a.getAttribute('href');
      const ent = href.match(/\/e\/([^/]+)\/doc\.html$/);
      if (ent) href = `#/entity/${ent[1]}`;
      const kind = [...a.classList].find((c) => c.startsWith('mention-'))?.slice('mention-'.length) ?? 'entity';
      a.querySelector('.mention-fields')?.remove();
      refResolveCache.set(ref, { href, label: a.dataset.name ?? a.textContent, title: a.textContent, kind });
    });
  } catch {}
}

function watchCommandMarkers(host, editor, onInput) {
  const root = host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return;
  const marked = (n) => holdsCommandMarker(n.textContent);
  new MutationObserver((records) => {
    if (records.some((r) => marked(r.target) || [...r.addedNodes].some(marked))) applyCommandMarkers(host, editor, onInput);
  }).observe(root, { childList: true, characterData: true, subtree: true });
}

function applyCommandMarkers(host, editor, onInput) {
  const v = editor.getValue();
  const ref = v.match(REF_MARKER_RE);
  if (ref) return pickReference(editor, v, ref[0], ref[1], onInput);
  if (globalThis.WeaveEditorLib.BLOCK_MARKER_RE.test(v)) return convertBlockLine(host, editor, onInput);
  for (const [marker, block] of Object.entries(DEFERRED_INSERTS)) {
    if (!v.includes(marker)) continue;
    if (block.select) return insertSelecting(host, editor, onInput, v.replace(marker, block.md), block.select);
    const next = v.replace(marker, block);
    editor.setValue(next);
    editor.focus();
    onInput(next);
    return;
  }
}

const CARET_SENTINEL = '\u2063caret\u2063';
function convertBlockLine(host, editor, onInput) {
  const md = editor.getValue();
  const next = globalThis.WeaveEditorLib.convertMarkedLine(md);
  if (!next) return;
  let token = md.match(globalThis.WeaveEditorLib.BLOCK_MARKER_RE)[0];
  if (next.line >= 0) {
    token = CARET_SENTINEL;
    const lines = next.md.split('\n');
    const line = lines[next.line];
    const at = line.length - next.select.length;
    lines[next.line] = line.slice(0, at) + token + line.slice(at);
    editor.setValue(lines.join('\n'));
  }
  if (!caretToToken(host, token, next.select.length)) { editor.setValue(next.md); editor.focus(); }
  onInput(editor.getValue());
  scheduleDecorFor(host);
}

function insertSelecting(host, editor, onInput, md, select) {
  const at = md.indexOf(select);
  editor.setValue(md.slice(0, at) + CARET_SENTINEL + md.slice(at));
  if (!caretToToken(host, CARET_SENTINEL, select.length)) { editor.setValue(md); editor.focus(); }
  onInput(editor.getValue());
  scheduleDecorFor(host);
}

function caretToToken(host, token, extend = 0) {
  const root = host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return false;
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let spot = null;
  for (let n = texts.nextNode(); n; n = texts.nextNode()) {
    const at = n.data.indexOf(token);
    if (at < 0) continue;
    n.deleteData(at, token.length);
    spot ??= { node: n, at };
  }
  if (!spot) return false;
  root.focus({ preventScroll: true });
  const range = document.createRange();
  range.setStart(spot.node, spot.at);
  range.setEnd(spot.node, Math.min(spot.at + extend, spot.node.length));
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

const REF_KINDS = {
  entity: { kinds: ['entity'], placeholder: 'Search entities to reference…' },
  table: { kinds: ['table'], placeholder: 'Search tables to reference…' },
  space: { kinds: ['space', 'workspace'], placeholder: 'Search spaces to reference…' },
};

function pickReference(editor, value, marker, kind, onInput) {
  const settle = (replacement) => {
    const next = value.replace(marker, replacement);
    editor.setValue(next);
    editor.focus();
    onInput(next);
  };
  const { kinds, placeholder } = REF_KINDS[kind] ?? REF_KINDS.entity;
  openCommandK({
    kinds,
    placeholder,
    onPick: (hit) => settle(referenceFor(kind, hit)),
    onDismiss: () => settle(''),
  });
}

window.__weaveEditors = liveEditors;
window.__weaveDocSaves = pendingDocSaves;
window.__weaveFlushDocSaves = flushDocSaves;

function retheme() {
  const t = vditorTheme();
  for (const ed of liveEditors) {
    try { ed.setTheme(t.ui, t.content, t.hljs); } catch {}
  }
}

function scheduleDocSave(entityId, field, value, statusEl, onSaved = null) {
  const key = `${entityId}::${field}`;
  clearTimeout(pendingDocSaves.get(key)?.timer);
  if (statusEl) statusEl.textContent = '·';
  const write = async () => {
    pendingDocSaves.delete(key);
    try {
      await api('PUT', `/entities/${entityId}/doc`, { field, doc: value });
      onSaved?.();
      if (!statusEl) return;
      statusEl.textContent = '✓';
      setTimeout(() => { if (statusEl.textContent === '✓') statusEl.textContent = ''; }, 1500);
    } catch (err) {
      if (statusEl) statusEl.textContent = '!';
      toast(err.message, true);
    }
  };
  pendingDocSaves.set(key, { timer: setTimeout(write, DOC_SAVE_DEBOUNCE), write });
}

async function flushDocSave(entityId, field) {
  const p = pendingDocSaves.get(`${entityId}::${field}`);
  if (!p) return;
  clearTimeout(p.timer);
  await p.write();
}

function relTime(iso) {
  const sec = (Date.now() - Date.parse(iso)) / 1000;
  if (sec < 45) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  if (sec < 7 * 86400) return `${Math.round(sec / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

function flushDocSaves() {
  for (const ed of liveEditors) docPulls.get(ed)?.();
  for (const { timer, write } of [...pendingDocSaves.values()]) {
    clearTimeout(timer);
    write();
  }
}
window.addEventListener('beforeunload', flushDocSaves);
window.addEventListener('pagehide', flushDocSaves);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushDocSaves();
});

function teardownDocEditors() {
  flushDocSaves();
  for (const ed of liveEditors) {
    try { ed.destroy(); } catch {}
  }
  liveEditors.clear();
  for (const st of refChipLayers) {
    clearTimeout(st.timer);
    st.layer.remove();
  }
  refChipLayers.clear();
  for (const st of docRails) {
    clearTimeout(st.timer);
    st.rail.remove();
  }
  docRails.clear();
  for (const st of docFolds) {
    clearTimeout(st.timer);
    st.layer.remove();
  }
  docFolds.clear();
  for (const st of docCodeAuto) clearTimeout(st.timer);
  docCodeAuto.clear();
  for (const st of docCodeRaw) st.stop();
  docCodeRaw.clear();
}

function docSectionCollapse(entityId, field, next) {
  const key = `weave-doc-collapsed:${entityId}:${field}`;
  if (next === undefined) return localStorage.getItem(key) === '1';
  localStorage.setItem(key, next ? '1' : '');
  return next;
}

function appearsAsPanel(db, entity, refresh) {
  const hidden = new Set(db.hiddenFields ?? []);
  const shownView = (role) => { const f = viewFieldOf(db, role); return f && !hidden.has(f.name) ? f : null; };
  const chipF = shownView('chip');
  const cardF = shownView('card');
  if (!chipF && !cardF) return null;
  const gear = (f) => el('button', {
    type: 'button', class: 'btn btn-sm btn-ghost-secondary tiny wv-appears-cfg', title: `Configure the ${f.role} for every ${db.term?.singular ?? WeaveTerm.DEFAULT.singular}`,
    onclick: () => fieldDialog(db, f, refresh),
  }, iconEl('lucide:sliders-horizontal', 'wv-icon'));
  const slot = (f, node) => el('div', { class: `wv-appears-slot wv-appears-${f.role}` },
    el('div', { class: 'wv-appears-lbl' }, f.name, gear(f)), node);
  const panel = el('div', { class: 'wv-appears' },
    el('div', { class: 'wv-appears-title' }, 'Appears as'));
  if (chipF) panel.append(slot(chipF, viewCell(entity.raw?.[chipF.name], chipF)));
  if (cardF) panel.append(slot(cardF, viewCell(entity.raw?.[cardF.name], cardF)));
  return panel;
}

async function showEntity(id) {
  let entity;
  try {
    entity = await api('GET', `/entities/${id}`);
  } catch (err) {
    toast(`Couldn't open that record: ${err.message}`, true);
    return showHome();
  }
  noteEntityRecent(entity);
  const hop = entityHop(entity);
  const B = weaveBreadcrumbs;
  crumbNav = B.navCurrent(crumbNav)?.id === id ? B.navUpdate(crumbNav, hop)
    : state.route?.page === 'entity' ? B.navHop(crumbNav, hop) : B.navOpen(crumbNav, hop);
  state.trail = B.navPath(crumbNav).slice(0, -1);
  state.route = { page: 'entity', id, dbId: entity.dbId, entity: hop };
  syncDocTitle(entity.name);
  renderNav();
  const main = $('#main');
  main.replaceChildren();
  await renderEntityView(entity, { mount: main, refresh: () => showEntity(id) });
}

function nextStateButton(entity, db, refresh) {
  const flows = (db?.fields ?? []).filter((x) => x.type === 'workflow');
  const buttons = flows.map((f) => nextStateFor(entity, f, flows.length > 1, refresh)).filter(Boolean);
  if (!buttons.length) return null;
  return flows.length === 1 ? buttons[0] : el('div', { class: 'next-state-stack' }, ...buttons);
}
function nextStateFor(entity, f, named, refresh) {
  const was = entity.fields?.[f.name] ?? null;
  const states = f.states ?? [];
  const next = states[states.findIndex((st) => st.name === was) + 1];
  if (!next) return null;
  const move = async (to) => {
    await api('POST', `/entities/${entity.id}/state`, { field: f.name, state: to });
    await refresh?.();
    $('#main > .table-wrap')?.wvRefresh?.();
  };
  const label = named ? `Move ${f.name} to ${next.name}` : `Move to ${next.name}`;
  return el('button', {
    class: 'btn next-state-fab', type: 'button', dataset: { field: f.name },
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await move(next.name);
        toast(named ? `Moved ${f.name} to ${next.name}` : `Moved to ${next.name}`, false, { label: 'Undo', run: () => move(was).catch((err) => toast(err.message, true)) });
      } catch (err) { btn.disabled = false; toast(err.message, true); }
    },
  }, label);
}

function pageGo(next) {
  const to = weaveBreadcrumbs.navCurrent(next);
  if (!to || next === crumbNav) return;
  crumbNav = next;
  teardownDocEditors();
  history.replaceState(null, '', `#/entity/${to.id}`);
  withPageLoader(() => showEntity(to.id));
}

function entityHop(entity) {
  const db = allTables().find((d) => d.id === entity.dbId);
  return { id: entity.id, publicId: entity.publicId, name: entity.name, space: db?.space ?? '', spaceId: db?.spaceId ?? '', spaceIcon: db?.spaceIcon ?? null, table: db?.name ?? entity.db, tableId: entity.dbId, tableIcon: db?.icon ?? null };
}

async function renderEntityView(entity, { mount, refresh, inPeek = false, onClose = null, editors = null, crumbs = null, dockControls = null }) {
  const id = entity.id;
  const db = allTables().find((d) => d.id === entity.dbId);

  const nameF = nameFieldOf(db);
  const computed = nameF?.type === 'formula';
  const nameInput = el('textarea', {
    class: 'name-edit' + (computed ? ' computed' : ''), rows: '1', 'aria-label': 'Name',
    readonly: computed ? '' : undefined,
    title: computed ? `computed name — ƒ ${nameF.expression ?? ''}` : null,
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } },
  });
  nameInput.value = entity.name;
  if (!CSS.supports('field-sizing', 'content')) {
    const fit = () => { nameInput.style.height = 'auto'; nameInput.style.height = `${nameInput.scrollHeight}px`; };
    nameInput.addEventListener('input', fit);
    requestAnimationFrame(fit);
  }
  nameInput.addEventListener('input', () => { for (const st of docFolds) st.schedule(); });
  if (!computed) nameInput.addEventListener('change', async () => {
    try { await api('PATCH', `/entities/${id}`, { values: { [nameF?.name ?? 'Name']: nameInput.value } }); toast('Renamed'); }
    catch (err) { toast(err.message, true); }
  });

  const recent = [...entity.activity].reverse().slice(0, ACTIVITY_PANE_ROWS);
  const firstIndex = entity.activity.length - 1;
  const actBody = el('div', { class: 'card-body' },
    ...recent.map((a, n) => el('a', {
      class: 'activity-item', href: `#/activity/${id}:${firstIndex - n}`,
      title: 'Open this event',
    }, `${new Date(a.ts).toLocaleString()} — `, actorChipEl(a.actor, { link: false }), ` ${activitySummary(a)}`)),
    recent.length ? null : el('span', { class: 'wv-empty' }, 'Nothing has happened here yet.'),
    entity.activityDropped ? el('span', { class: 'activity-dropped' }, droppedText(entity.activityDropped)) : null);
  const actPanel = el('div', { class: 'card panel' },
    el('div', { class: 'card-header' },
      el('h3', { class: 'card-title' }, 'Activity'),
      el('a', { class: 'panel-link', href: `#/activity/${id}` },
        entity.activity.length > recent.length ? `All ${entity.activity.length} →` : 'Open table →')),
    actBody);

  const entBase = `${WS_PREFIX}/e/${id}/entity`;
  const dlBtn = dotsMenu([
    inPeek ? { label: 'Activity', run: () => activityPanel.toggle(id, null, mount) } : null,
    inPeek ? { phone: true, label: 'Copy link', run: () => copyText(`${location.origin}${WS_PREFIX}/e/${id}`, 'Permalink copied') } : null,
    inPeek ? { phone: true, label: 'Show or hide fields', run: () => fieldVisibilityPopover(dlBtn.firstElementChild, db, 0, { redraw: refresh, rowsSection: false }) } : null,
    inPeek ? 'divider' : null,
    ...['md', 'html', 'pdf'].map((ext) => ({
      label: `Download .${ext}`, href: `${entBase}.${ext}`,
      download: `${(entity.name || 'entity')}.${ext}`,
    })),
    'divider',
    {
      label: 'Move to trash', danger: true,
      run: async () => {
        try {
          await api('DELETE', `/entities/${id}`);
          await loadSchema();
          if (inPeek) onClose?.(); else location.hash = `#/table/${entity.dbId}`;
          toast('Moved to trash', false, {
            label: 'Undo',
            run: async () => {
              await api('POST', `/entities/${id}/restore`);
              if (!inPeek) location.hash = `#/entity/${id}`;
              toast('Restored');
            },
          });
        } catch (err) { toast(err.message, true); }
      },
    },
  ], { title: `${WeaveTerm.cap(termOfTable(entity.dbId).singular)} actions`, align: 'right' });

  const sideOpen = (db.systemFields ?? []).includes('Activity');
  const activityBtn = inPeek ? null : el('button', {
    class: 'btn btn-sm activity-btn', type: 'button', title: 'Activity', 'aria-label': 'Activity',
    'aria-pressed': String(activityPanel.openFor === id), onclick: () => activityPanel.toggle(id, null, mount),
  }, iconEl('lucide:history', 'wv-icon'));
  const eye = el('button', { class: 'btn btn-sm eye-btn', title: 'Show / hide fields', 'aria-label': 'Show or hide fields' }, eyeGlyph());
  eye.addEventListener('click', (e) => { e.stopPropagation(); fieldVisibilityPopover(eye, db, 0, { redraw: refresh, rowsSection: false }); });
  const poseControls = inPeek ? (dockControls?.pose ?? []) : db ? [
    el('button', {
      class: 'btn btn-sm pose-btn', type: 'button',
      title: keyHint('Collapse (⌘⇧E)'), 'aria-label': 'Collapse — dock beside the table',
      onclick: () => collapseToSplit(entity),
    }, poseGlyph(true)),
    el('button', {
      class: 'btn btn-sm', type: 'button',
      title: 'Close', 'aria-label': 'Close — back to the table',
      onclick: () => closeToTable(entity),
    }, iconEl('✕')),
  ] : [];
  mount.append(
    stickViewHeader(el('div', { class: 'view-header' },
      el('div', { class: 'crumb crumb-row' },
        ...(inPeek ? (dockControls?.nav ?? []) : [navMenuButton(), ...navArrows(pageGo)]),
        crumbPath(inPeek
          ? (crumbs ?? weaveBreadcrumbs.dockCrumbs([entityHop(entity)]))
          : weaveBreadcrumbs.entityCrumbs($('#ws-name').textContent || 'workspace', state.trail, entityHop(entity)), {
          copy: { title: 'Copy permalink', run: () => copyText(`${location.origin}${WS_PREFIX}/e/${id}`, 'Permalink copied') },
          foldFrom: inPeek ? 1 : 4,
        }),
        el('span', { class: 'crumb-actions wv-toolbar' }, activityBtn, eye, dlBtn, ...poseControls)),
      el('div', { class: 'wv-toolbar entity-head' }, nameInput))),
  );
  const nextFab = nextStateButton(entity, db, refresh);
  if (nextFab) mount.append(nextFab);
  if (!inPeek && db) {
    mount.querySelector(`.crumb-path a[href="#/table/${entity.dbId}"]`)?.addEventListener('click', (e) => {
      e.preventDefault();
      collapseToSplit(entity);
    });
  }

  const grid = el('div', { class: 'entity-grid', dataset: { eid: id } });
  grid.classList.toggle('side-open', sideOpen);
  mount.append(grid);
  const left = el('div');
  const right = el('div', { class: 'entity-side' });
  grid.append(left, right);

  const docSection = (f) => {
    const fmtBase = `${WS_PREFIX}/e/${id}/doc/${encodeURIComponent(f.name)}`;
    const host = el('div', { class: 'doc-editor' });
    const status = el('span', { class: 'doc-status', title: 'Saved automatically' });

    const dl = dotsMenu(
      ['md', 'mmd', 'pdf', 'html'].map((ext) => ({
        label: `Download .${ext}`, href: `${fmtBase}.${ext}`,
        download: `${entity.name || 'document'}-${f.name}.${ext}`,
      })),
      { title: `${f.name} downloads`, extraClass: 'doc-dl' });

    const body = el('div', { class: 'doc-section-body' }, host);
    const mode = globalThis.WeaveEditorLib.docViewMode(f.kind, entity.docs?.[f.name] ?? '');
    const isApp = mode === 'app';
    const isDiagram = mode === 'diagram';
    const appFrame = isApp ? el('iframe', { class: 'doc-app', src: `${fmtBase}.html`, allowfullscreen: '', allow: 'fullscreen', title: f.name })
      : isDiagram ? el('div', { class: 'doc-diagram' }) : null;
    let sourceBox = null;
    const drawDiagram = () => {
      appFrame.replaceChildren(el('pre', { class: 'mermaid' }, sourceBox?.value ?? entity.docs?.[f.name] ?? ''));
      renderMermaidIn(appFrame);
    };
    let showingSource = false;
    let mounted = false;
    const fieldQ = `field=${encodeURIComponent(f.name)}`;
    const histBtn = el('span', {
      class: 'doc-anchor doc-history-btn', title: 'History', 'aria-label': `${f.name} history`, hidden: '',
      onclick: () => activityPanel.toggle(id, f.name, mount),
    }, iconEl('lucide:history', 'wv-icon'));
    const checkHistory = () => api('GET', `/entities/${id}/doc/revisions?${fieldQ}&limit=2`)
      .then((r) => { histBtn.hidden = r.revisions.length < 2; }, () => { histBtn.hidden = true; });
    checkHistory();
    const sourceToggle = appFrame ? el('span', {
      class: 'doc-anchor', title: 'Edit source',
      onclick: () => {
        showingSource = !showingSource;
        host.classList.toggle('hidden', !showingSource);
        appFrame.classList.toggle('hidden', showingSource);
        sourceToggle.classList.toggle('active', showingSource);
        if (showingSource && !mounted) { mounted = true; mountSourceEditor(); }
        if (!showingSource) { if (isApp) appFrame.src = appFrame.src; else drawDiagram(); }
      },
    }, iconEl('lucide:code-xml', 'wv-icon')) : null;
    if (appFrame) { host.classList.add('hidden'); body.prepend(appFrame); }
    if (isDiagram) drawDiagram();
    const caret = el('button', {
      class: 'doc-caret', type: 'button', title: 'Collapse section',
      onclick: () => {
        const open = body.classList.toggle('hidden');
        caret.classList.toggle('closed', open);
        docSectionCollapse(id, f.name, open);
      },
    });
    const section = el('section', { class: 'doc-section', 'data-doc-field': f.name },
      el('div', { class: 'doc-section-head' },
        el('span', { class: 'opt-grip', title: 'Drag to reorder' }, iconEl('lucide:grip-vertical', 'wv-icon')),
        caret,
        el('span', { class: 'doc-section-name' }, f.name),
        sourceToggle,
        histBtn,
        el('span', {
          class: 'doc-anchor permalink-copy', title: 'Copy link to this document',
          onclick: () => copyText(`${location.origin}${fmtBase}.html`, 'Document link copied'),
        }, iconEl('⧉')),
        status, dl),
      body);

    if (docSectionCollapse(id, f.name)) {
      body.classList.add('hidden');
      caret.classList.add('closed');
    }
    const rail = attachDashRail(section, host);
    const folds = attachHeadingFolds(host, id, f.name, () => nameInput.value);
    const mountEditor = () => {
      const ed = mountDocEditor(host, {
        value: entity.docs?.[f.name] ?? '',
        entityId: id,
        placeholder: `Write ${f.name}… press / for blocks`,
        onInput: (value) => {
          scheduleDocSave(id, f.name, value, status, checkHistory);
          rail.schedule();
          folds.schedule();
        },
      });
      editors?.push(ed);
    };
    const mountSourceEditor = () => {
      const ta = el('textarea', { class: 'doc-source', spellcheck: 'false', title: `${f.name} source` });
      ta.value = entity.docs?.[f.name] ?? '';
      ta.addEventListener('input', () => scheduleDocSave(id, f.name, ta.value, status, checkHistory));
      sourceBox = ta;
      host.append(ta);
    };
    if (mode === 'code') mountSourceEditor();
    if (mode === 'markdown') mountEditor();
    return section;
  };

  const commentsBody = el('div', { class: 'card-body' });
  const commentsPanel = el('div', { class: 'card panel' },
    el('div', { class: 'card-header' },
      el('h3', { class: 'card-title' }, `Comments (${entity.comments.length})`)),
    commentsBody);
  for (const c of entity.comments) {
    commentsBody.append(el('div', { class: 'comment' },
      el('div', {}, el('span', { class: 'who' }, commentAuthorEl(c.author)), el('span', { class: 'when' }, new Date(c.createdAt).toLocaleString())),
      el('div', {}, c.text)));
  }
  const commentInput = el('input', { class: 'form-control', placeholder: 'Add a comment…', style: 'width:100%' });
  commentInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && commentInput.value.trim()) {
      try {
        await api('POST', `/entities/${id}/comments`, { author: 'me', text: commentInput.value.trim() });
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  });
  commentsBody.append(el('div', { style: 'margin-top:8px' }, commentInput));

  const VALUES_BLOCK = '@values';
  left.classList.add('entity-body');
  const fields = el('div', { class: 'entity-fields' });
  const values = el('div', { class: 'entity-values' });
  const hidden = new Set(db.hiddenFields ?? []);
  const shown = db.fields.filter((f) => f.role !== 'name' && f.type !== 'view' && !hidden.has(f.name));
  const coverF = shown.find((x) => x.type === 'attachments' && x.preview === 'cover');
  const coverIds = coverF ? (entity.raw?.[coverF.name] ?? []) : [];
  const coverFile = coverF && (entity.files ?? []).find((x) => coverIds.includes(x.id) && !x.missing && isPictureFile(x));
  if (coverFile) left.prepend(entityCoverEl(coverFile, { size: coverF.size ?? 'medium', fit: coverF.fit ?? 'trim' }));
  const blocks = new Map();

  const anchor = (what) => el('span', { class: 'opt-grip', title: `Drag to move ${what}` }, iconEl('lucide:grip-vertical', 'wv-icon'));
  const HANDS_OFF = 'button, a, input, select, textarea, [contenteditable], .picker-wrap, .permalink-copy, .dl-menu, .attach-box';
  const wireBlock = (key, node, handles) => {
    node.dataset.block = key;
    for (const h of handles.filter(Boolean)) {
      RO().guard(h);
      h.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || (e.target.closest(HANDS_OFF) && !e.target.closest('.opt-grip'))) return;
        e.stopPropagation();
        RO().sortable(e, {
          source: node,
          items: () => [...left.children].filter((n) => n.matches('[data-block]')),
          onDrop: () => reorderBlocks(db, left, refresh),
        });
      });
    }
    blocks.set(key, node);
    return node;
  };
  const dragRow = (node, f) => {
    node.dataset.field = f.name;
    RO().guard(node);
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target.closest(HANDS_OFF) && !e.target.closest('.opt-grip'))) return;
      RO().sortable(e, {
        source: node,
        items: () => [...values.querySelectorAll(':scope > .fieldrow:not(.fieldrow-system)')],
        zone: () => values,
        onDrop: () => {
          const next = node.nextElementSibling, prev = node.previousElementSibling;
          if (next?.dataset.field && !next.classList.contains('fieldrow-system')) reorderField(db, f.name, next.dataset.field, { after: false, onFail: refresh });
          else if (prev?.dataset.field) reorderField(db, f.name, prev.dataset.field, { after: true, onFail: refresh });
        },
      });
    });
    return node;
  };
  for (const f of shown) {
    if (f.type === 'relation' && f.many && !f.targetDbIds) continue;
    if (f.type === 'document') {
      const section = docSection(f);
      wireBlock(f.name, section, [section.querySelector('.opt-grip'), section.querySelector('.doc-section-head')]);
      continue;
    }
    const node = el('div', { class: 'fieldrow' },
      f.type === 'attachments' ? anchor(f.name) : el('span', { class: 'opt-grip', title: 'Drag to reorder' }, iconEl('lucide:grip-vertical', 'wv-icon')),
      el('label', { class: 'fieldrow-label', title: fieldDescription(f) ? `${fieldDescription(f)}\n\nEdit field` : 'Edit field', onclick: () => editFieldDialog(db, f) },
        fieldNameLabel(f), fieldDescription(f) ? el('span', { class: 'fieldrow-desc' }, fieldDescription(f)) : null),
      labeledEditorFor(f, entity, db, () => refresh(), { label: f.name }));
    if (f.type === 'attachments') {
      node.classList.add('attach-block');
      wireBlock(f.name, node, [node.querySelector('.opt-grip')]);
      continue;
    }
    values.append(dragRow(node, f));
  }
  for (const n of (db.systemFields ?? [])) {
    if (n === 'Activity' || !SYSTEM_COLS[n]) continue;
    values.append(el('div', { class: 'fieldrow fieldrow-system', dataset: { field: n } },
      el('span', { class: 'opt-grip', 'aria-hidden': 'true' }),
      el('label', { class: 'fieldrow-label' }, n),
      el('span', { class: 'fieldrow-value' }, SYSTEM_COLS[n](entity))));
  }

  if (values.childElementCount) {
    const summary = el('div', { class: 'entity-values-summary hidden' },
      ...[...values.children].map((row) => {
        const f = shown.find((x) => x.name === row.dataset.field);
        const system = row.classList.contains('fieldrow-system');
        const label = row.querySelector('.fieldrow-label');
        return el('span', { class: 'wv-sum' + (system ? ' wv-sum-system' : ''), dataset: { field: row.dataset.field }, title: fieldDescription(f) || null },
          el('span', { class: 'wv-sum-label', onclick: f ? () => editFieldDialog(db, f) : null }, system ? label.textContent : fieldNameLabel(f)),
          system ? el('span', { class: 'wv-sum-value' }, row.querySelector('.fieldrow-value').textContent) : labeledEditorFor(f, entity, db, () => refresh(), { compact: true, label: f.name }));
      }));
    const setFolded = (closed) => {
      values.classList.toggle('hidden', closed);
      summary.classList.toggle('hidden', !closed);
      fieldsCaret.classList.toggle('closed', closed);
    };
    const fieldsCaret = el('button', {
      class: 'doc-caret', type: 'button', title: 'Collapse fields',
      onclick: (e) => {
        e.stopPropagation();
        const closed = !values.classList.contains('hidden');
        setFolded(closed);
        docSectionCollapse(id, VALUES_BLOCK, closed);
      },
    });
    const valuesHead = el('div', { class: 'block-head' },
      anchor('the fields'), fieldsCaret, el('span', { class: 'block-name' }, 'Fields'));
    if (docSectionCollapse(id, VALUES_BLOCK)) setFolded(true);
    fields.append(valuesHead, values, summary);
    wireBlock(VALUES_BLOCK, fields, [valuesHead.querySelector('.opt-grip'), valuesHead]);
  }

  for (const f of shown.filter((x) => x.type === 'relation' && x.many && !x.targetDbIds)) {
    const grip = anchor(f.name);
    const slot = wireBlock(f.name, el('div', { class: 'related-block' }), [grip]);
    relatedGrid(entity, f, refresh)
      .then((grid) => {
        if (!grid) { slot.remove(); blocks.delete(f.name); return; }
        grid.querySelector('.related-head')?.prepend(grip);
        slot.append(grid);
      })
      .catch((err) => toast(err.message, true));
  }

  const named = db.bodyBlocks ?? [VALUES_BLOCK];
  for (const key of [...named, ...blocks.keys()]) {
    const node = blocks.get(key);
    if (node && !node.isConnected) left.append(node);
  }
  const appears = appearsAsPanel(db, entity, refresh);
  if (appears) left.prepend(appears);
  const inFields = new Set((db.fields ?? [])
    .filter((f) => f.type === 'attachments')
    .flatMap((f) => (Array.isArray(entity.raw?.[f.name]) ? entity.raw[f.name] : [])));
  const loose = (entity.files ?? []).filter((f) => !inFields.has(f.id));
  if (loose.length) {
    left.append(el('div', { class: 'card panel entity-files-card' },
      el('div', { class: 'card-header' },
        el('h3', { class: 'card-title' }, `Files · ${loose.length}`)),
      el('div', { class: 'card-body attach-chips' },
        ...loose.map((file) => attachItemEl(file)))));
  }

  const refCard = (title, extraClass) => (refs) => {
    if (!refs?.length || !mount.isConnected) return;
    right.append(el('div', { class: `card panel ref-backlinks-card ${extraClass}` },
      el('div', { class: 'card-header' },
        el('h3', { class: 'card-title' }, `${title} · ${refs.length}`)),
      el('div', { class: 'card-body ref-backlinks' },
        ...refs.map((r) => relationChipEl({ targetDbIds: true }, r)))));
  };
  if (sideOpen) {
    api('GET', `/entities/${id}/references-from`)
      .then(refCard('References', 'ref-outbound-card'))
      .catch(() => {});
    api('GET', `/entities/${id}/references`)
      .then(refCard('Referenced by', 'ref-inbound-card'))
      .catch(() => {});
  }
  const deckRole = deckRoleOf(db);
  if (deckRole) {
    const deckUrl = `${WS_PREFIX}/e/${id}/deck.html`;
    const label = deckRole === 'deck' ? 'Deck' : 'Slide preview';
    const frame = el('iframe', { class: 'deck-frame', src: deckUrl, allowfullscreen: '', allow: 'fullscreen', title: label });
    const body = el('div', { class: 'doc-section-body' }, frame);
    const caret = el('button', {
      class: 'doc-caret', type: 'button', title: 'Collapse section',
      onclick: () => {
        const open = body.classList.toggle('hidden');
        caret.classList.toggle('closed', open);
        docSectionCollapse(id, label, open);
      },
    });
    const newVersion = async (promote) => {
      try {
        const made = await api('POST', `/entities/${id}/version${promote ? '?promote=1' : ''}`);
        toast(`Version ${made.fields?.Version ?? ''} created`);
        location.hash = `#/entity/${made.id}`;
      } catch (err) { toast(err.message, true); }
    };
    const menu = dotsMenu([
      { label: 'Download .html', href: deckUrl, download: `${entity.name || label}.html` },
      { label: 'Open the composed model (.json)', href: `${WS_PREFIX}/e/${id}/deck.json` },
      ...(deckRole === 'slide' ? [
        'divider',
        { label: 'New version', run: () => newVersion(false) },
        { label: 'New version, promoted into its decks', run: () => newVersion(true) },
      ] : []),
    ], { title: `${label} actions`, extraClass: 'doc-dl' });
    const section = el('section', { class: 'doc-section deck-section' },
      el('div', { class: 'doc-section-head' },
        caret,
        el('span', { class: 'doc-section-name' }, label),
        el('span', { class: 'doc-anchor', title: 'Refresh', onclick: () => { frame.src = frame.src; } }, iconEl('⟳')),
        el('span', { class: 'doc-anchor', title: 'Expand', onclick: () => expandDocument(grid, deckUrl, label) }, iconEl('⛶')),
        el('span', {
          class: 'doc-anchor permalink-copy', title: 'Copy link to this deck',
          onclick: () => copyText(`${location.origin}${deckUrl}`, 'Deck link copied'),
        }, iconEl('⧉')),
        menu),
      body);
    left.prepend(section);
    if (docSectionCollapse(id, label)) { body.classList.add('hidden'); caret.classList.add('closed'); }
  }
  right.append(commentsPanel, actPanel);
  activityPanel.mounted(id, mount);
}

const activityPanel = (() => {
  const H = () => window.weaveHistoryCore;
  let st = null;
  let panel = null;
  let sheetBack = null;

  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const stamp = (iso) => `${H().dayLabel(iso) === 'Today' ? '' : `${new Date(iso).toLocaleDateString([], { weekday: 'short' })} `}${clock(iso)}`;
  const val = (v, cls = '') => el('span', { class: `wv-act-val ${cls}`.trim() }, String(v ?? '—'));
  const arrow = () => el('span', { class: 'wv-act-arr' }, iconEl('lucide:arrow-right', 'wv-icon'));
  const byId = (id) => st?.items.find((it) => it.id === id);
  const revsOf = (field) => st.items.filter((it) => it.kind === 'rev' && it.field === field);
  const prevOf = (r) => { const l = revsOf(r.field); return l[l.indexOf(r) + 1] ?? null; };
  const sections = () => [...(st?.mount ?? document).querySelectorAll('.doc-section[data-doc-field]')];
  const sectionFor = (field) => sections().find((s) => s.dataset.docField === field);

  async function load() {
    const [ent, act] = await Promise.all([api('GET', `/entities/${st.id}`), api('GET', `/activity?entity=${st.id}&limit=500`)]);
    const db = allTables().find((d) => d.id === ent.dbId);
    const docFields = (db?.fields ?? []).filter((f) => f.type === 'document').map((f) => f.name);
    const documents = await Promise.all(docFields.map(async (field) => ({
      field, revisions: (await api('GET', `/entities/${st.id}/doc/revisions?field=${encodeURIComponent(field)}&limit=200`)).revisions,
    })));
    const optionName = (field, v) => {
      const f = (db?.fields ?? []).find((x) => x.name === field);
      return (f?.optionsFull ?? []).find((o) => o?.id === v)?.name ?? v;
    };
    st.docFields = docFields;
    st.items = H().feed({ documents, activity: act.items, comments: ent.comments ?? [], optionName });
    if (st.sel && !byId(st.sel)) st.sel = null;
  }
  const text = async (r) => {
    if (!st.texts.has(r.seq)) st.texts.set(r.seq, (await api('GET', `/entities/${st.id}/doc/revisions/${r.seq}?field=${encodeURIComponent(r.field)}`)).text);
    return st.texts.get(r.seq);
  };

  const undoTop = async () => (await api('GET', '/undo?limit=1'))[0] ?? null;
  async function afterWrite(msg, top) {
    st.done = { id: st.sel, top };
    await refreshView();
    await load();
    render();
    toast(msg, false, { label: 'Undo', run: undo });
  }
  async function restore(r) {
    try {
      await flushDocSave(st.id, r.field);
      const out = await api('POST', `/entities/${st.id}/doc/revisions/${r.seq}/restore`, { field: r.field });
      if (out.changed === false) return toast(`${r.field} already reads as the version from ${stamp(r.at)}`);
      const mine = await undoTop();
      await load();
      const top = revsOf(r.field)[0];
      st.sel = top.id; st.from = null;
      await afterWrite(`${r.field} restored from ${stamp(r.at)}`, mine);
    } catch (err) { toast(err.message, true); }
  }
  async function revert(a) {
    try {
      if (a.kind === 'comment') await api('DELETE', `/entities/${st.id}/comments/${a.commentId}`);
      else await api('PATCH', `/entities/${st.id}`, { values: { [a.field]: a.from } });
      const mine = await undoTop();
      st.sel = a.id;
      await afterWrite(a.kind === 'comment' ? 'Comment deleted' : `${a.field} reverted`, mine);
    } catch (err) { toast(err.message, true); }
  }
  async function undo() {
    const done = st?.done; if (!done) return;
    try {
      const top = await undoTop();
      const same = top && done.top && top.ts === done.top.ts && top.kind === done.top.kind && top.entityId === done.top.entityId;
      if (!same) return toast('Changed since, so nothing was undone', true);
      await api('POST', '/undo', { steps: 1 });
      st.done = null;
      await refreshView();
      await load();
      const it = byId(st.sel);
      if (it?.kind === 'rev') st.sel = revsOf(it.field)[0]?.id ?? null;
      render();
      toast('Undone');
    } catch (err) { toast(err.message, true); }
  }

  function cmpSelect(r) {
    const prev = prevOf(r), others = revsOf(r.field).filter((x) => x !== r);
    if (!others.length) return null;
    const p = pickerSelect({
      name: 'compare', title: 'Compare with', value: st.from ?? prev?.id ?? others[0].id,
      options: others.map((x) => ({ id: x.id, label: `vs ${stamp(x.at)} · ${x.actor ?? ''}` })),
    });
    p.classList.add('wv-act-cmp');
    p.input.addEventListener('change', () => { st.from = prev && p.input.value === prev.id ? null : p.input.value; render(); });
    return p;
  }
  function tray(it) {
    const btn = (label, icon, run, primary = false) => el('button', { class: `btn btn-sm${primary ? ' btn-primary' : ''}`, type: 'button', onclick: run }, iconEl(icon, 'wv-icon'), label);
    if (st.done?.id === it.id) return el('div', { class: 'wv-act-tray' }, btn('Undo', 'lucide:undo', undo), it.kind === 'rev' ? cmpSelect(it) : null);
    if (it.kind === 'rev') {
      return it.current ? (cmpSelect(it) ? el('div', { class: 'wv-act-tray' }, cmpSelect(it)) : null)
        : el('div', { class: 'wv-act-tray' }, btn('Restore', 'lucide:undo', () => restore(it), true), cmpSelect(it));
    }
    if (it.kind === 'undo' || it.undone) return null;
    if (it.kind === 'comment') return el('div', { class: 'wv-act-tray' }, btn('Delete', 'lucide:trash-2', () => revert(it)));
    return el('div', { class: 'wv-act-tray' }, btn(`Revert to ${it.from}`, 'lucide:undo', () => revert(it), true));
  }
  function row(it) {
    const on = st.sel === it.id;
    let icon, what, who = clock(it.at), act = null;
    if (it.kind === 'rev') {
      icon = it.restoredFrom != null || it.undo ? 'lucide:undo' : 'lucide:file-text';
      what = [el('span', { class: 'name' }, it.field),
        it.restoredFrom != null ? el('span', {
          class: 'wv-act-src',
          title: it.source ? `Restored the version from ${new Date(it.source.at).toLocaleString()}${it.source.actor ? ` by ${it.source.actor}` : ''}` : 'Restored a version no longer kept',
        }, it.source ? `restored from ${stamp(it.source.at)}` : 'restored from an earlier version') : null,
        it.delta ? el('span', { class: `wv-act-delta ${it.delta > 0 ? 'pos' : 'neg'}` }, it.delta > 0 ? `+${it.delta}` : `−${-it.delta}`) : null];
      if (it.current) who += ' · current'; else if (it.undo) who += ' · undo';
      if (!it.current && !on) act = { title: 'Restore this version', icon: 'lucide:undo', run: () => restore(it) };
    } else if (it.kind === 'comment') {
      icon = 'lucide:message-square';
      what = [el('span', { class: 'quote' }, `“${it.body}”`)];
      if (!on) act = { title: 'Delete comment', icon: 'lucide:trash-2', run: () => revert(it) };
    } else {
      icon = it.kind === 'undo' ? 'lucide:undo' : it.kind === 'state' ? 'lucide:workflow' : 'lucide:pencil';
      what = [el('span', { class: 'name' }, it.field), val(it.from), arrow(), val(it.to, 'new')];
      if (it.undone) who += ' · undone';
      if (!on && !it.undone && it.kind !== 'undo') act = { title: `Revert to ${it.from}`, icon: 'lucide:undo', run: () => revert(it) };
    }
    const node = el('div', { class: `wv-act-row${on ? ' sel' : ''}${it.undone ? ' undone' : ''}`, tabindex: '0', 'data-id': it.id },
      el('span', { class: 'wv-act-kind' }, iconEl(icon, 'wv-icon')),
      el('span', { class: 'wv-act-what' }, ...what),
      act ? el('button', { class: 'wv-act-icon', type: 'button', title: act.title, 'aria-label': act.title, onclick: (e) => { e.stopPropagation(); act.run(); } }, iconEl(act.icon, 'wv-icon')) : el('span'),
      el('span', { class: 'wv-act-who' }, ...(() => { const chip = actorChipEl(it.actor, { link: false }); return chip ? [chip, ` · ${who}`] : [who]; })()),
      on ? tray(it) : null);
    node.addEventListener('click', (e) => {
      if (e.target.closest('.wv-act-tray')) return;
      st.sel = it.id; st.from = null; st.done = null; st.scroll = true; render();
    });
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === node) node.click(); });
    return node;
  }
  function renderPanel() {
    const chips = [['all', 'All'], ...st.docFields.map((f) => [`doc:${f}`, f]), ['fields', 'Fields'], ['comments', 'Comments']];
    const filters = el('div', { class: 'wv-act-filters', role: 'toolbar', 'aria-label': 'Show' },
      ...chips.map(([k, label]) => el('button', { type: 'button', 'aria-pressed': String(st.filter === k), onclick: () => { st.filter = k; render(); } }, label)));
    const list = el('div', { class: 'wv-act-list' });
    let day = '';
    for (const it of H().filterFeed(st.items, st.filter)) {
      const d = H().dayLabel(it.at);
      if (d !== day) { list.append(el('div', { class: 'wv-act-day' }, d)); day = d; }
      list.append(row(it));
    }
    if (!list.children.length) list.append(el('div', { class: 'wv-empty' }, 'No changes yet.'));
    const keep = panel?.querySelector('.wv-act-list')?.scrollTop ?? 0;
    const next = el('aside', { class: 'wv-activity', 'aria-label': 'Activity' },
      el('div', { class: 'wv-act-head' }, el('h3', {}, 'Activity'),
        el('button', { class: 'wv-act-icon wv-act-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: close }, iconEl('lucide:x', 'wv-icon'))),
      filters, list);
    if (panel) panel.replaceWith(next); else document.body.append(next);
    panel = next;
    const dock = st.mount?.closest?.('#dock');
    if (dock && !dockCoversScreen.matches) panel.style.right = `${innerWidth - dock.getBoundingClientRect().left + 8}px`;
    list.scrollTop = keep;
    const s = list.querySelector('.wv-act-row.sel');
    if (s) {
      const lb = list.getBoundingClientRect(), sb = s.getBoundingClientRect();
      if (sb.bottom > lb.bottom) list.scrollTop += sb.bottom - lb.bottom + 8;
      else if (sb.top < lb.top + 28) list.scrollTop -= lb.top + 28 - sb.top;
    }
  }

  const reveal = (node) => { if (st.scroll) { st.scroll = false; scrollTargetIntoView(node, { padding: 12 }); } };
  function clearViews() {
    for (const v of document.querySelectorAll('.wv-act-view')) {
      const body = v.closest('.doc-section')?.querySelector(':scope > .doc-section-body');
      if (body) body.hidden = false;
      v.remove();
    }
    for (const b of document.querySelectorAll('.doc-history-btn.active')) b.classList.remove('active');
  }
  async function renderView() {
    clearViews();
    const it = byId(st?.sel);
    if (!it) return;
    if (it.kind === 'rev') {
      const sec = sectionFor(it.field); if (!sec) return;
      const body = sec.querySelector(':scope > .doc-section-body');
      const from = st.from ? byId(st.from) : prevOf(it);
      const view = el('div', { class: 'wv-act-view' });
      body.hidden = true; body.after(view);
      sec.querySelector('.doc-history-btn')?.classList.add('active');
      const [ft, tt] = await Promise.all([from ? text(from) : '', text(it)]);
      if (!view.isConnected) return;
      const diff = el('div', { class: 'wv-act-diff' }); diff.innerHTML = H().renderDiff(ft, tt);
      view.append(el('div', { class: 'wv-act-bar' }, from ? val(stamp(from.at), 'from') : null, from ? arrow() : null, val(stamp(it.at), 'to')), diff);
      reveal(sec);
      return;
    }
    const host = st.mount?.querySelector('.entity-body'); if (!host) return;
    const view = el('div', { class: 'wv-act-view top' }, el('div', { class: 'wv-act-card' },
      ...(it.kind === 'comment' ? [iconEl('lucide:message-square', 'wv-icon'), el('span', {}, it.body)]
        : [el('b', {}, it.field), val(it.from), arrow(), val(it.to, 'new')])));
    host.prepend(view);
    reveal(view);
  }
  function render() {
    if (!st) return;
    renderPanel();
    renderView();
    for (const b of document.querySelectorAll('.activity-btn')) b.setAttribute('aria-pressed', 'true');
  }

  async function open(id, field, mount) {
    if (st?.id !== id) st = { id, texts: new Map() };
    Object.assign(st, { mount: mount ?? st.mount ?? $('#main'), filter: field ? `doc:${field}` : 'all', from: null, done: null, scroll: !field });
    try { await flushDocSaves(); await load(); } catch (err) { st = null; return toast(err.message, true); }
    const first = H().filterFeed(st.items, st.filter)[0];
    st.sel = first?.id ?? null;
    document.body.classList.toggle('wv-activity-open', !!st.mount?.closest?.('#main'));
    if (dockCoversScreen.matches && !sheetBack) {
      sheetBack = () => close({ back: true });
      history.pushState({ ...(history.state ?? {}), wvSheet: 'activity' }, '', location.href);
      addEventListener('popstate', sheetBack);
    }
    render();
  }
  function close({ back = false } = {}) {
    if (sheetBack) {
      removeEventListener('popstate', sheetBack);
      sheetBack = null;
      if (!back && history.state?.wvSheet === 'activity') history.back();
    }
    panel?.remove(); panel = null;
    clearViews();
    document.body.classList.remove('wv-activity-open');
    for (const b of document.querySelectorAll('.activity-btn')) b.setAttribute('aria-pressed', 'false');
    st = null;
  }
  function toggle(id, field, mount) {
    const want = field ? `doc:${field}` : 'all';
    if (st?.id === id && panel && st.filter === want) return close();
    return open(id, field, mount);
  }
  function mounted(id, mount) {
    if (!st || !panel) return;
    if (st.id !== id) { if (!st.mount?.isConnected) close(); return; }
    st.mount = mount;
    for (const b of mount.querySelectorAll('.activity-btn')) b.setAttribute('aria-pressed', 'true');
    renderView();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panel || e.defaultPrevented || e.target.closest?.('.picker-pop, .chip-pop, .modal') || document.querySelector('.picker-pop')) return;
    e.stopPropagation();
    close();
  }, true);
  window.addEventListener('hashchange', () => setTimeout(() => { if (st && !st.mount?.isConnected) close(); }, 0));
  return { toggle, open, close, mounted, get openFor() { return panel ? st?.id : null; } };
})();

function quickCreate(db) {
  if (computedName(db)) {
    api('POST', `/tables/${db.id}/entities`, {})
      .then(async (e) => { await loadSchema(); openEntity(e.id); })
      .catch((err) => toast(err.message, true));
    return;
  }
  modal(`New ${db.term.singular}`, [
    el('input', { name: 'name', placeholder: 'Name', class: 'form-control full', style: 'width:100%' }),
  ], async (fd) => {
    const e = await api('POST', `/tables/${db.id}/entities`, { name: fd.get('name') });
    await loadSchema();
    openEntity(e.id);
  });
}

function newTableDialog(reg, after) {
  const spaces = state.schema.filter((s) => !s.system);
  if (!spaces.length) return toast('Create a space first — a table lives in one', true);
  modal('New table', [
    el('input', { name: 'name', placeholder: 'Table name', class: 'form-control full', style: 'width:100%', required: '' }),
    pickerSelect({ name: 'space', title: 'Space', options: spaces.map((s) => ({ id: s.space, label: s.space })), value: spaces[0].space }),
  ], async (fd) => {
    const made = await api('POST', `/tables/${reg.id}/entities`, { name: fd.get('name'), values: { Space: fd.get('space') } });
    await loadSchema();
    await after();
    focusNewRow(made.id, { field: 'Name' });
  });
}

function startTableDialog({ spaceId = null } = {}) {
  const spaces = state.schema.filter((s) => !s.system);
  const fixed = spaceId ? spaces.find((s) => s.spaceId === spaceId) : null;
  const spaceInput = fixed ? null
    : spaces.length ? pickerSelect({ name: 'space', title: 'Space', options: spaces.map((s) => ({ id: s.space, label: s.space })), value: spaces[0].space })
      : el('input', { name: 'space', value: 'General', class: 'form-control full', style: 'width:100%', required: '' });
  modal('New table', [
    el('input', { name: 'name', placeholder: 'Table name', class: 'form-control full', style: 'width:100%', required: '' }),
    ...(spaceInput ? [
      el('label', { class: 'form-label wv-start-label' }, 'Space'),
      spaceInput,
      el('div', { class: 'form-hint' }, 'Every table needs a space; related tables share one.'),
    ] : []),
  ], async (fd) => {
    const space = fixed?.space ?? String(fd.get('space')).trim();
    if (!spaces.some((s) => s.space === space)) await api('POST', '/spaces', { name: space });
    const made = await api('POST', '/tables', { space, name: String(fd.get('name')).trim() });
    await loadSchema();
    location.hash = `#/table/${made.id}`;
  });
}

async function runStarter(template) {
  toast(`Setting up ${template.title}…`);
  try {
    await api('POST', '/build', WeaveStarters.spec(template));
  } catch (err) {
    toast(`Couldn't set up ${template.title}: ${err.message}`, true);
    await loadSchema();
    return showHome();
  }
  await loadSchema();
  const name = WeaveStarters.firstTable(template);
  const first = allTables().find((t) => !t.system && t.space === template.space && t.name === name);
  location.hash = first ? `#/table/${first.id}` : '#/';
}

function emptyWorkspace() {
  return el('div', { class: 'card wv-start' },
    el('div', { class: 'card-body' },
      el('p', { class: 'wv-start-lead' }, 'A table holds rows, and you choose its fields. Start with a new table or a template.'),
      el('button', { class: 'btn btn-primary wv-start-new', onclick: () => startTableDialog() }, '+ New table'),
      el('div', { class: 'wv-start-label' }, 'Templates'),
      el('div', { class: 'wv-start-templates' },
        ...WeaveStarters.TEMPLATES.map((t) => el('button', {
          class: 'wv-start-template', dataset: { template: t.id },
          onclick: (e) => {
            for (const b of e.currentTarget.closest('.wv-start').querySelectorAll('button')) b.disabled = true;
            runStarter(t);
          },
        },
        el('span', { class: 'wv-start-title' }, t.title),
        el('span', { class: 'wv-start-blurb' }, t.blurb))))));
}

let onboardingAsked = false;
async function maybeOnboard() {
  if (onboardingAsked || document.querySelector('#modal-back')) return;
  onboardingAsked = true;
  let got;
  try { got = await api('GET', '/onboarding'); } catch { return; }
  if (got.show && !document.querySelector('#modal-back')) onboard(got.name);
}

function onboard(defaultName) {
  const STEPS = [
    { icon: 'lucide:sparkles', title: 'Welcome to weave' },
    { icon: 'lucide:house', title: 'Your workspace', line: 'Rename it anytime from the sidebar.' },
    { icon: 'lucide:layout-grid', title: 'Your first space' },
  ];
  const back = el('div', { id: 'modal-back', class: 'wv-onboard-back' });
  const dots = el('div', { class: 'wv-onboard-dots', 'aria-hidden': 'true' }, ...STEPS.map(() => el('span')));
  const marker = el('span', { class: 'visually-hidden' });
  const iconSlot = el('div', { class: 'wv-onboard-icon' });
  const heading = el('h2', {});
  const line = el('p', { class: 'wv-onboard-line' });
  const body = el('div', { class: 'wv-onboard-body' });
  const skip = el('button', { class: 'btn wv-onboard-skip', type: 'button', onclick: () => leave() }, 'Skip setup');
  const actions = el('div', { class: 'actions' }, skip);
  const box = el('div', { id: 'modal', class: 'wv-onboard' }, dots, marker, iconSlot, heading, line, body, actions);
  back.append(box);
  holdPage(back, box);
  let name = defaultName;
  let busy = false;
  const leave = () => finish(box.dataset.step === '3' ? { name } : {});

  const primary = (label, run) => el('button', { class: 'btn btn-primary wv-onboard-next', type: 'button', onclick: run }, label);
  function show(i) {
    const step = STEPS[i];
    box.dataset.step = String(i + 1);
    [...dots.children].forEach((d, k) => d.classList.toggle('on', k <= i));
    marker.textContent = `Step ${i + 1} of ${STEPS.length}`;
    const icon = iconEl(step.icon, 'wv-icon wv-onboard-glyph');
    iconSlot.replaceChildren(icon);
    heading.textContent = step.title;
    line.textContent = step.line ?? '';
    line.hidden = !step.line;
    actions.querySelector('.wv-onboard-next')?.remove();
    let focus;
    if (i === 0) {
      body.replaceChildren();
      actions.append(focus = primary('Get started', () => show(1)));
    } else if (i === 1) {
      const input = el('input', { name: 'name', value: name, class: 'form-control', 'aria-label': 'Workspace name', autocomplete: 'off', spellcheck: 'false' });
      input.addEventListener('input', () => { name = input.value; });
      const form = el('form', { class: 'wv-onboard-form' }, input);
      form.addEventListener('submit', (e) => { e.preventDefault(); name = input.value; show(2); });
      body.replaceChildren(form);
      actions.append(primary('Continue', () => form.requestSubmit()));
      focus = input;
    } else {
      body.replaceChildren(el('div', { class: 'wv-start-templates' },
        ...WeaveStarters.TEMPLATES.map((t) => el('button', {
          class: 'wv-start-template', type: 'button', dataset: { template: t.id },
          onclick: () => finish({ name, template: t }),
        },
        el('span', { class: 'wv-start-title' }, t.title),
        el('span', { class: 'wv-start-blurb' }, t.blurb)))));
      actions.append(focus = primary('Start with your empty workspace', () => finish({ name })));
    }
    focus.focus();
    if (i === 1) focus.select();
    if (icon?.classList.contains('mi')) playIcon(icon);
  }

  async function finish(choice = {}) {
    if (busy) return;
    busy = true;
    const controls = [...box.querySelectorAll('button, input')];
    for (const c of controls) c.disabled = true;
    if (choice.template) toast(`Setting up ${choice.template.title}…`);
    try {
      const done = await api('POST', '/onboarding', { ...(choice.name != null ? { name: choice.name } : {}), ...(choice.template ? { template: choice.template.id } : {}) });
      const base = WS_PREFIX ? done.url : '/';
      location.href = base + (done.table ? `#/table/${done.table}` : '#/');
      if (location.pathname === base) location.reload();
    } catch (err) {
      busy = false;
      for (const c of controls) c.disabled = false;
      toast(err.message, true);
      if (choice.name != null) show(1);
    }
  }

  addEventListener('keydown', function esc(e) {
    if (!back.isConnected) return removeEventListener('keydown', esc);
    if (e.key === 'Escape' && !e.target.closest?.('#wv-toasts')) { e.preventDefault(); leave(); }
  });
  show(0);
}

const SCHEMA_OPEN_KEY = 'weave-schema-open';
async function schemaDisclosure(parent, draw) {
  let open = false;
  try { open = localStorage.getItem(SCHEMA_OPEN_KEY) === '1'; } catch {}
  const body = el('div', { class: 'wv-schema-body' });
  const box = el('details', { class: 'wv-schema' }, el('summary', {}, 'Schema'), body);
  let drawn = null;
  const fill = () => (drawn ??= Promise.resolve(draw(body)).catch((err) => toast(err.message, true)));
  box.addEventListener('toggle', () => {
    try { localStorage.setItem(SCHEMA_OPEN_KEY, box.open ? '1' : '0'); } catch {}
    if (box.open) fill();
  });
  parent.append(box);
  if (open) {
    box.open = true;
    await fill();
  }
  return box;
}

function newFieldDialog(after) {
  const tables = allTables().filter((t) => !t.system);
  if (!tables.length) return toast('Create a table first — a field lands on one', true);
  modal('New field', [
    pickerSelect({ name: 'table', title: 'Table', options: tables.map((t) => ({ id: t.id, label: `${t.space}/${t.name}` })), value: tables[0].id }),
  ], async (fd) => {
    const target = tables.find((t) => t.id === fd.get('table'));
    fieldDialog(target, null, () => keepScroll(after));
  }, 'Next');
}

function addFieldDialog(db) {
  fieldDialog(db, null, () => keepScroll(() => (state.route?.page === 'db'
    ? showDatabase(db.id, state.route.view)
    : renderRoute())));
}


async function relatedGrid(entity, f, onSaved) {
  const target = allTables().find((d) => d.id === f.targetDbId)
    ?? allTables().find((d) => d.qualified === f.targetDb);
  if (!target) return null;
  const val = entity.fields[f.name];
  const linked = (Array.isArray(val) ? val : [val]).filter(Boolean);
  const rows = linked.length
    ? (await api('POST', `/tables/${target.id}/query`, { where: [['id', 'in', linked.map((s) => s.id)]] })).items
    : [];
  const shownCols = new Set(visibleCols(target));
  const cols = target.fields.filter((c) => shownCols.has(c.name) && c.type !== 'document' && c.name !== f.inverseField);
  const colCount = cols.length + 2;

  const link = async (targets) => {
    await api('POST', `/entities/${entity.id}/link`, { field: f.name, targets });
    await onSaved();
  };

  const body = el('tbody', {},
    ...rows.map((item) => el('tr', {
      class: 'entity-row',
      dataset: { eid: item.id, href: `#/entity/${item.id}` },
      onclick: (e) => {
        const pick = rowClickTarget(e);
        if (pick === 'ignore') return;
        if (pick) return openCellPicker(pick);
        openEntity(item.id);
      },
    },
      el('td', { class: 'pid-cell' },
        el('a', { class: 'open-link', href: `#/entity/${item.id}`, title: `Open ${target.term.singular}` }, `#${item.publicId} ↗`)),
      ...cols.map((c) => el('td', {
        class: (isNumCell(c, item) ? 'num' : '')
          + (PICKER_FIELD_TYPES.includes(c.type) ? ' cell-pick' : READONLY_FIELD_TYPES.includes(c.type) ? ' cell-computed' : ''),
      }, labeledEditorFor(c, item, target, onSaved, { compact: true }))),
      el('td', {}, el('button', {
        class: 'btn btn-sm btn-ghost-secondary tiny unlink-btn', title: `Unlink from ${f.name}`,
        onclick: async (e) => {
          e.stopPropagation();
          try {
            await api('POST', `/entities/${entity.id}/unlink`, { field: f.name, targets: [item.id] });
            await onSaved();
          } catch (err) { toast(err.message, true); }
        },
      }, iconEl('lucide:x', 'wv-icon wv-icon-xs'))))),
    el('tr', { class: 'add-entity-row' },
      el('td', { colspan: String(colCount) },
        el('button', {
          class: 'add-entity-btn', type: 'button',
          onclick: async () => {
            try {
              const made = await api('POST', `/tables/${target.id}/entities`, { values: { Name: `New ${target.name}` } });
              await link([made.id]);
              focusNewRow(made.id, { scope: '.related-block', select: true });
            } catch (err) { toast(err.message, true); }
          },
        }, `+ New ${target.term.singular}`),
        el('button', {
          class: 'add-entity-btn', type: 'button',
          onclick: () => linkSearch(f, {
            linked,
            commit: async (add, drop) => {
              if (add.length) await api('POST', `/entities/${entity.id}/link`, { field: f.name, targets: add });
              if (drop.length) await api('POST', `/entities/${entity.id}/unlink`, { field: f.name, targets: drop });
              await onSaved();
            },
          }),
        }, '+ Link existing'))));

  return el('section', { class: 'related-section' },
    el('div', { class: 'related-head' },
      el('span', { class: 'related-name' }, f.name),
      el('span', { class: 'related-count' }, `${rows.length}`),
      el('a', { class: 'panel-link', href: `#/table/${target.id}` }, `${target.qualified} →`)),
    rows.length
      ? el('div', { class: 'card' },
        el('table', { class: 'table table-sm table-vcenter card-table table-hover wv-grid' },
          el('thead', {}, el('tr', {},
            el('th', { class: 'pid-head' }, '#'),
            ...cols.map((c) => el('th', {}, el('span', { class: 'col-label' }, fieldNameLabel(c)))),
            el('th', {}, ''))),
          body))
      : el('div', { class: 'card' },
        el('table', { class: 'table table-sm wv-grid' }, body)));
}

const ACTIVITY_PANE_ROWS = 10;

function droppedText(n) {
  return `${n} older ${n === 1 ? 'entry' : 'entries'} not kept`;
}

function activitySummary(a) {
  const d = a.detail ?? {};
  switch (a.kind) {
    case 'state-changed': return `${d.field}: ${d.from ?? '—'} → ${d.to ?? '—'}`;
    case 'field-updated': return `${d.field}: ${fmtValue(d.from)} → ${fmtValue(d.to)}`;
    case 'relation-updated': return `${d.field} changed`;
    case 'moved': return `moved from ${d.from} #${d.publicId}` + (d.skipped?.length ? ` — left behind: ${d.skipped.join(', ')}` : '');
    case 'comment-added': return `comment by ${commentAuthorText(d.author)}`;
    case 'file-attached': return `attached ${d.name}`;
    case 'automation-ran': return `automation “${d.name}” ran`;
    case 'field-config-updated': return `${d.field}: ${(d.changed ?? []).join(', ')} changed`;
    case 'undo': if (a.scope === 'field') return `${d.field}: ${(d.changed ?? []).join(', ')} put back`; return a.kind;
    case 'doc-updated':
    case 'doc-appended': {
      if (d.restoredFrom != null) {
        return `${d.field ?? 'Description'} restored to the version from ${d.restoredAt ? new Date(d.restoredAt).toLocaleString() : 'an earlier revision'}${d.restoredBy ? ` by ${d.restoredBy}` : ''}`;
      }
      const size = d.delta == null ? '' : ` ${d.delta >= 0 ? '+' : '−'}${Math.abs(d.delta)} chars`;
      const where = d.line ? ` at line ${d.line}` : '';
      const verb = a.kind === 'doc-appended' ? 'appended to' : 'edited';
      const quote = d.preview ? ` — “${d.preview}”` : '';
      return `${d.field ?? 'Description'} ${verb}${size}${where}${quote}`;
    }
    default: return a.kind;
  }
}

const fmtValue = (v) => {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') {
    if ('start' in v || 'end' in v) return weaveDateCore.formatDateRange(v, {});
    return v.name ?? JSON.stringify(v);
  }
  return String(v);
};

async function showActivity(param) {
  if (param && param.includes(':')) return showActivityDetail(param);
  state.route = { page: 'activity' };
  renderNav();
  const main = $('#main');
  const entityId = param || null;
  const qs = entityId ? `?entity=${encodeURIComponent(entityId)}` : '';
  let feed = { total: 0, items: [] };
  try { feed = await api('GET', `/activity${qs}`); } catch (err) { toast(err.message, true); }
  const subject = entityId ? feed.items[0] : null;

  const rows = feed.items.map((a) => el('tr', {
    class: 'activity-row',
    dataset: { href: `#/activity/${a.id}` },
    onclick: () => { location.hash = `#/activity/${a.id}`; },
  },
    el('td', { class: 'activity-when', title: a.ts }, new Date(a.ts).toLocaleString()),
    el('td', {}, el('span', { class: `k k-sys activity-kind kind-${a.kind}` }, a.kind)),
    el('td', {}, actorChipEl(a.actor)),
    el('td', {}, activitySummary(a)),
    el('td', {}, recordChip(a)),
    el('td', {}, a.entityName ?? '—')));

  main.replaceChildren(
    viewHeader({
      crumbs: entityId && subject
        ? [{ label: 'Activity', href: '#/activity' }, { label: subject.db, href: `#/table/${subject.dbId}` }]
        : [],
      permalink: `${location.origin}${WS_PREFIX}/#/activity${entityId ? `/${entityId}` : ''}`,
      title: entityId && subject ? `Activity — ${subject.scope === 'field' ? subject.db : subject.entityName}` : 'Activity',
    }),
    el('div', { class: 'wv-note' },
      'A system table: weave writes these rows, so they cannot be added, edited or deleted. ',
      el('b', {}, `${feed.total}`), ' events.',
      feed.dropped ? ` ${droppedText(feed.dropped)}.` : ''),
    feed.items.length
      ? el('div', { class: 'card' },
        el('table', { class: 'table table-sm table-vcenter card-table table-hover wv-grid' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'When'), el('th', {}, 'Event'), el('th', {}, 'Actor'), el('th', {}, 'Detail'),
            el('th', {}, 'Record'), el('th', {}, 'Name'))),
          el('tbody', {}, ...rows)))
      : el('div', { class: 'wv-empty' }, 'No activity yet.'));
}

function recordChip(a) {
  if (a.scope === 'field') {
    return el('span', { class: 'k k-rel' + (a.deleted ? ' deleted' : '') },
      el('a', { href: `#/table/${a.dbId}`, onclick: (e) => e.stopPropagation() },
        `${a.db ?? '—'}${a.deleted ? ' (deleted)' : ''}`));
  }
  return el('span', { class: 'k k-rel' + (a.deleted ? ' deleted' : '') },
    el('a', { href: `#/entity/${a.entityId}`, onclick: (e) => e.stopPropagation() },
      `${a.db ?? '—'} #${a.publicId}${a.deleted ? ' (deleted)' : ''}`));
}

function rollbackControl(a) {
  const fieldPath = () => `/tables/${a.dbId}/fields/${encodeURIComponent(a.detail.fieldId)}/rollback`;
  if (!a.rollback?.ok) return el('span', { class: 'activity-rollback-reason' }, a.rollback?.reason ?? 'Not available');
  return el('button', {
    class: 'btn btn-sm activity-rollback', type: 'button',
    onclick: async () => {
      try {
        const out = await api('POST', fieldPath(), { activity: a.id });
        await loadSchema();
        toast(rolledBackText(out, 'rolled back'), false, out.activity ? {
          label: 'Undo',
          run: async () => {
            try { await api('POST', fieldPath(), { activity: out.activity, via: 'undo' }); await loadSchema(); }
            catch (err) { toast(err.message, true); }
            showActivityDetail(a.id);
          },
        } : null);
      } catch (err) { toast(err.message, true); }
      showActivityDetail(a.id);
    },
  }, `Roll back ${a.detail.field}`);
}

function fieldChangeChip(type, o) {
  if (!o) return el('span', { class: 'field-change-none' }, '—');
  if (type === 'workflow') {
    const cat = chipCore.categoryOrDefault(o.category ?? 'not-started');
    return el('span', { class: `k k-state cat-${cat} hue-${chipCore.stateHue(o, cat)}` }, o.icon ? iconEl(o.icon, 'ico wv-icon') : null, chipLabel(o.name));
  }
  return el('span', { class: `k k-select hue-${o.hue || chipCore.hueFromHex(o.color)}` }, o.icon ? iconEl(o.icon, 'ico wv-icon') : null, chipLabel(o.name));
}

function fieldChangeRows(d, row) {
  const D = window.WeaveFieldDiff;
  const arrow = () => el('span', { class: 'field-change-arrow', 'aria-label': 'to' }, iconEl('lucide:arrow-right', 'wv-icon'));
  return D.changes(d).map((c) => {
    if (c.kind === 'list') {
      const type = d.after?.type ?? d.before?.type;
      return row(c.label, el('div', { class: 'field-change field-change-list' },
        ...c.items.map((it) => el('div', { class: 'field-change-item' },
          it.before ? fieldChangeChip(type, it.before) : null,
          it.before && it.after ? arrow() : null,
          it.after ? fieldChangeChip(type, it.after) : null,
          el('span', { class: 'field-change-marks' }, it.marks.map((m) => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')))),
        c.unchanged ? el('div', { class: 'field-change-unchanged' }, `${c.unchanged} unchanged`) : null));
    }
    if (c.kind === 'text') {
      return row(c.label, el('div', { class: 'field-change field-change-text' },
        el('code', {}, ...c.diff.map((p) => (p.op === '=' ? p.text : el(p.op === '+' ? 'ins' : 'del', {}, p.text))))));
    }
    return row(c.label, el('div', { class: 'field-change field-change-value' },
      el('span', { class: 'field-change-before' }, D.formatValue(c.before)), arrow(),
      el('span', { class: 'field-change-after' }, D.formatValue(c.after))));
  });
}

async function showActivityDetail(id) {
  state.route = { page: 'activity' };
  renderNav();
  const main = $('#main');
  let a;
  try { a = await api('GET', `/activity/${encodeURIComponent(id)}`); }
  catch (err) { toast(err.message, true); return showActivity(null); }

  const row = (label, value) => el('div', { class: 'fieldrow' }, el('label', {}, label), el('span', {}, value));
  const field = a.scope === 'field';
  const d = a.detail ?? {};
  const fieldsBody = el('div', { class: 'card-body' },
    row('Record', recordChip(a)),
    row('Table', a.db ? el('a', { href: `#/table/${a.dbId}` }, a.db) : '—'),
    row('Event', el('span', { class: `k k-sys activity-kind kind-${a.kind}` }, a.kind)),
    row('When', el('span', { title: a.ts }, new Date(a.ts).toLocaleString())),
    row('Actor', actorChipEl(a.actor) || '—'),
    ...(field
      ? [row('Field', d.field),
        ...fieldChangeRows(d, row),
        row('Definitions', el('details', { class: 'activity-defs' },
          el('summary', {}, 'Show definitions'),
          el('div', { class: 'activity-defs-body' },
            el('div', { class: 'activity-defs-col' }, el('div', { class: 'activity-defs-head' }, 'Before'), el('pre', { class: 'activity-def' }, JSON.stringify(d.before, null, 2))),
            el('div', { class: 'activity-defs-col' }, el('div', { class: 'activity-defs-head' }, 'After'), el('pre', { class: 'activity-def' }, JSON.stringify(d.after, null, 2)))))),
        ...(d.lossy ? [row('Values', d.snapshot
          ? `${d.snapshot.rows} ${d.snapshot.rows === 1 ? 'value' : 'values'} from before this change kept for a roll back`
          : d.snapshotDropped ? 'No longer kept: a newer type change of this field replaced them' : 'Not kept')] : []),
        ...(d.restored != null ? [row('Values put back', `${d.restored} restored, ${d.left} edited since and kept, ${d.converted} newer converted`)] : [])]
      : Object.entries(d).map(([k, v]) => row(k, k === 'workflow' ? actorChipEl(`workflow:${v}`) : fmtValue(v)))),
    ...(field ? [row('Roll back', rollbackControl(a))] : []),
    row('History', el('a', { href: `#/activity/${a.entityId}` }, field ? `All field changes on ${a.db} →` : `All activity for ${a.entityName ?? 'this record'} →`)));

  main.replaceChildren(
    stickViewHeader(el('div', { class: 'view-header' },
      el('div', { class: 'crumb' },
        navMenuButton(),
        el('a', { href: '#/activity' }, 'Activity'), ' › ',
        el('span', {
          class: 'permalink-copy', title: 'Copy permalink',
          onclick: () => copyText(`${location.origin}${WS_PREFIX}/#/activity/${a.id}`, 'Permalink copied'),
        }, `#${a.id} ⧉`)),
      el('div', { class: 'wv-toolbar entity-head' },
        el('span', { class: 'name-edit activity-title' }, activitySummary(a))))),
    el('div', { class: 'card panel' },
      el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, 'Fields')),
      fieldsBody));
}

async function showView(id) {
  state.route = { page: 'view', id };
  syncDocTitle(null);
  renderNav();
  const main = $('#main');
  let v;
  try { v = await api('GET', `/views/${id}`); } catch (err) { toast(`Couldn't open that view: ${err.message}`, true); return showHome(); }
  syncDocTitle(v.name);
  const meta = (await api('GET', '/views')).find((x) => x.id === id);
  main.replaceChildren(el('div', { class: 'wv-toolbar' },
    el('h1', {}, v.name),
    el('span', { style: 'flex:1' }),
    el('button', {
      class: 'btn btn-sm', onclick: async () => {
        if (meta?.shared) { await api('DELETE', `/views/${id}/share`); toast('Share link revoked'); return showView(id); }
        const { url } = await api('POST', `/views/${id}/share`);
        const full = location.origin + WS_PREFIX + url;
        await navigator.clipboard?.writeText(full).catch(() => {});
        modal('Share link', [
          el('div', { class: 'share-box' },
            el('code', { class: 'share-url' }, full),
            el('span', { class: 'share-hint' }, 'Copied to the clipboard. Anyone with this link sees this view, read-only, until you revoke it.')),
        ], async () => {}, 'Done');
        showView(id);
      },
    }, meta?.shared ? 'Revoke share' : 'Share…'),
    dotsMenu([{ hold: 'Delete view', holdingLabel: 'Hold to delete…', run: async () => { await api('DELETE', `/views/${id}`); toast('View deleted'); showHome(); } }], { align: 'right' })));
  for (const b of v.blocks) {
    const cols = Object.keys(b.items[0]?.fields ?? {});
    main.append(el('div', { class: 'card panel' },
      el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, b.table)),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table table-sm wv-grid' },
        el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', {}, c)))),
        el('tbody', {}, ...b.items.map((e) => el('tr', { dataset: { href: `#/entity/${e.id}` }, onclick: () => openEntity(e.id), style: 'cursor:pointer' },
          ...cols.map((c) => {
            const val = e.fields[c];
            return el('td', {}, Array.isArray(val) ? val.map((x) => x?.name ?? x).join(', ') : (val && typeof val === 'object' ? val.name ?? '' : String(val ?? '')));
          }))))))));
  }
}

async function showHome() {
  state.route = { page: 'home' };
  syncDocTitle(null);
  renderNav();
  const main = $('#main');
  const mine = WeaveStarters.userTables(state.schema);
  const [wsRead, listRead] = await Promise.allSettled([api('GET', '/workspace'), api('GET', '/workspaces')]);
  const ws = wsRead.value ?? { name: $('#ws-name').textContent || 'workspace', description: '' };
  const wsRow = listRead.value?.find?.((w) => w.name === ws.name) ?? null;
  const deletable = !!wsRow?.deletable;
  main.replaceChildren(
    viewHeader({
      crumbs: [],
      kind: 'ws',
      permalink: location.origin + (ws.url ?? wsHomeHref()),
      title: ws.title ?? ws.name,
      onRename: async (name) => {
        const updated = await api('PATCH', '/workspace', { name });
        location.href = WS_PREFIX ? `/w/${updated.id}/` : '/';
      },
      description: ws.description,
      onSaveDescription: async (md) => { await api('PATCH', '/workspace', { description: md }); },
      actions: [dotsMenu([
        {
          label: `Link preview before sign-in: ${ws.linkPreview ? 'on' : 'off'}`,
          run: async () => {
            try {
              const r = await api('PATCH', '/workspace', { linkPreview: !ws.linkPreview });
              toast(`Link preview before sign-in is ${r.linkPreview ? 'on' : 'off'}`);
              showHome();
            } catch (err) { toast(err.message, true); }
          },
        },
        ...(deletable ? [{
          label: 'Delete workspace…', danger: true,
          run: () => confirmDeleteWorkspace(wsRow, { current: true }),
        }] : []),
      ], { title: 'Workspace actions', align: 'right' })],
    }),
    ...(mine.length ? [] : [emptyWorkspace()]),
    el('div', { class: 'card list-rows system-tables' },
      el('div', { class: 'list-row', dataset: { href: '#/activity' }, onclick: () => { location.hash = '#/activity'; } },
        el('span', {}, 'Activity'), el('span', { class: 'k k-sys' }, 'system'),
        el('span', { class: 'spacer' }),
        el('span', { class: 'pid' }, 'every event in this workspace'))));
  try {
    const views = await api('GET', '/views');
    if (views.length) {
      main.append(el('div', { class: 'card list-rows' },
        ...views.map((v) => el('div', { class: 'list-row', dataset: { href: `#/view/${v.id}` }, onclick: () => { location.hash = `#/view/${v.id}`; } },
          el('span', {}, v.name),
          v.shared ? el('span', { class: 'k k-sys' }, 'shared') : null,
          el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, `${v.blocks.length} block${v.blocks.length === 1 ? '' : 's'}`)))));
    }
  } catch {}
  if (mine.length) {
    const card = await relationMapCard('Relation map');
    if (card) main.append(card);
  } else {
    maybeOnboard();
  }
  const reg = registryTable('spaces');
  if (reg) {
    const onSaved = async () => {
      rememberGridFocus();
      await loadSchema();
      await showHome();
      restoreGridFocus();
    };
    const onAdd = async () => {
      try {
        const made = await api('POST', `/tables/${reg.id}/entities`, { name: 'New space' });
        await loadSchema();
        await showHome();
        focusNewRow(made.id, { field: 'Name', select: true });
      } catch (err) { toast(err.message, true); }
    };
    await schemaDisclosure(main, async (body) => {
      const res = await api('POST', `/tables/${reg.id}/query`, {});
      renderTable(body, reg, mineOnly(res.items), onSaved, onAdd);
    });
  }
  await membersSection(main);
}

const ROLE_LABELS = { editor: 'Editor, paid seat', observer: 'Observer, free', architect: 'Architect, paid' };
async function membersSection(parent) {
  const [acc, inv] = await Promise.allSettled([api('GET', '/accounts'), api('GET', '/invites')]);
  if (acc.status !== 'fulfilled' || inv.status !== 'fulfilled') return;
  const body = el('div', { class: 'wv-members' });
  const box = el('details', { class: 'wv-members-box' }, el('summary', {}, 'Members'), body);
  const day = (iso) => String(iso ?? '').slice(0, 10);
  const draw = (accounts, invites, link = null) => {
    const email = el('input', { class: 'form-control', type: 'email', placeholder: 'name@company.com', 'aria-label': 'Email to invite', required: '' });
    const role = pickerSelect({ name: 'invite-role', title: 'Role', value: 'editor',
      options: Object.entries(ROLE_LABELS).map(([id, label]) => ({ id, label })) });
    const form = el('form', { class: 'wv-invite-form', onsubmit: async (ev) => {
      ev.preventDefault();
      try {
        const made = await api('POST', '/invites', { email: email.value.trim(), role: role.input.value });
        if (made.mailError) toast(`The invite email was not sent: ${made.mailError}`, true);
        const [a2, i2] = await Promise.all([api('GET', '/accounts'), api('GET', '/invites')]);
        draw(a2, i2, made);
      } catch (err) { toast(err.message, true); }
    } }, email, role, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Invite'));
    const shown = link?.mailed ? el('div', { class: 'wv-invite-link card' },
      el('div', { class: 'wv-invite-link-head' }, `Emailed ${link.email}`),
      el('div', { class: 'wv-invite-note' }, 'weave emailed the sign-in link. It works once and expires in 7 days.'))
    : link ? el('div', { class: 'wv-invite-link card' },
      el('div', { class: 'wv-invite-link-head' }, `Sign-in link for ${link.email}`),
      el('div', { class: 'wv-invite-link-row' },
        el('input', { class: 'form-control form-control-sm', readonly: '', value: link.url, 'aria-label': 'Sign-in link', onfocus: (e) => e.target.select() }),
        el('button', { class: 'btn btn-sm', type: 'button', onclick: () => copyText(link.url, 'Link copied') }, 'Copy link')),
      el('div', { class: 'wv-invite-note' }, link.mailError
        ? 'Send this link yourself: the email did not go out. It works once and expires in 7 days.'
        : 'Send this link yourself: weave does not send email yet. It works once and expires in 7 days.')) : null;
    body.replaceChildren(
      el('div', { class: 'wv-members-sub' }, 'Accounts'),
      accounts.length ? el('div', { class: 'card list-rows' },
        ...accounts.map((a) => el('div', { class: 'list-row' },
          el('span', {}, a.name), el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, ROLE_LABELS[a.role] ?? a.role))))
        : el('div', { class: 'wv-members-empty' }, 'None'),
      el('div', { class: 'wv-members-sub' }, 'Pending invites'),
      invites.length ? el('div', { class: 'card list-rows' },
        ...invites.map((i) => el('div', { class: 'list-row', dataset: { invite: i.id } },
          el('span', {}, i.email), el('span', { class: 'pid' }, ROLE_LABELS[i.role] ?? i.role),
          el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, `invited by ${i.invitedBy ?? 'unknown'} on ${day(i.createdAt)}`),
          el('button', { class: 'btn btn-sm btn-ghost-danger', type: 'button', onclick: async () => {
            try {
              await api('DELETE', `/invites/${i.id}`);
              toast('Invite revoked');
              draw(accounts, await api('GET', '/invites'));
            } catch (err) { toast(err.message, true); }
          } }, 'Revoke'))))
        : el('div', { class: 'wv-members-empty' }, 'None'),
      form, shown);
  };
  draw(acc.value, inv.value);
  parent.append(box);
}

function navigateToResult(hit) {
  const hitPrefix = (hit.url.match(/^\/w\/[^/]+/) ?? [''])[0];
  if (hitPrefix !== WS_PREFIX) {
    location.href = hit.kind === 'entity' ? `${hitPrefix}/#/entity/${hit.id}` : hit.url;
    return;
  }
  if (hit.kind === 'entity') openEntity(hit.id);
  else if (hit.kind === 'table') location.hash = `#/table/${hit.id}`;
  else if (hit.kind === 'space') location.hash = `#/space/${hit.id}`;
  else if (hit.kind === 'view') location.hash = `#/view/${hit.id}`;
  else location.hash = '#/';
}

function currentWsName() {
  return $('#ws-name')?.textContent || (WS_PREFIX ? decodeURIComponent(WS_PREFIX.slice(3)) : '');
}

const RECENT_KEY = `weave-recent:${WS_PREFIX || '/'}`;
function readRecents() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) ?? []; } catch { return []; }
}
function noteRecent(item) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(weavePalette.pushRecent(readRecents(), item))); } catch {}
}
function noteEntityRecent(entity) {
  const wf = allTables().find((d) => d.id === entity.dbId)?.fields.find((f) => f.type === 'workflow');
  const st = wf ? entity.fields?.[wf.name] : null;
  noteRecent({
    kind: 'entity', id: entity.id, name: entity.name, db: entity.db, publicId: entity.publicId,
    url: `${WS_PREFIX}/e/${entity.id}`,
    ...(st ? { chip: { state: { name: st, category: stateCategory(wf, st) } } } : {}),
  });
}

function paletteIcon(hit, group) {
  const name = hit.kind === 'table' ? 'table'
    : hit.kind === 'view' ? 'eye'
    : hit.kind === 'space' ? 'layout-grid'
    : hit.kind === 'workspace' ? 'layers'
    : PERSON_TABLE.test(String(hit.db ?? '').split('/').pop()) ? 'user'
    : group === 'docs' ? 'file-text' : 'file';
  return iconEl(`lucide:${name}`, 'wv-icon cmdk-ic');
}

const marked = (text, needle) => weavePalette.highlight(text, needle).map((s) => (s.hit ? el('mark', {}, s.text) : s.text));

function paletteCreateRow(hit, i, onPick) {
  return el('div', {
    class: 'result cmdk-create', id: `cmdk-opt-${i}`, role: 'option', 'aria-selected': 'false', onclick: () => onPick(hit),
  },
  iconEl('lucide:plus', 'wv-icon cmdk-ic'),
  el('span', { class: 'cmdk-text' }, hit.name));
}

function paletteRow(hit, i, { needle, group, here, onPick, href, checked = null }) {
  if (hit.kind === 'create') return paletteCreateRow(hit, i, onPick);
  const P = weavePalette;
  const foreign = hit.workspace && (here ? hit.workspace !== here : !hit.url.startsWith(`${WS_PREFIX}/`));
  const state = hit.chip?.state;
  const cat = state && chipCore.categoryOrDefault(state.category);
  return el('div', {
    class: checked ? 'result checked' : 'result', id: `cmdk-opt-${i}`, role: 'option', 'aria-selected': 'false',
    ...(checked == null ? {} : { 'aria-checked': String(checked) }),
    ...(href ? { dataset: { href } } : {}), onclick: () => onPick(hit),
  },
  checked == null ? null : el('span', { class: 'cmdk-check', 'aria-hidden': 'true' }, iconEl('lucide:check', 'wv-icon')),
  paletteIcon(hit, group),
  el('span', { class: 'cmdk-text' },
    el('span', { class: 'cmdk-name' }, ...marked(P.displayName(hit), needle)),
    group === 'docs' ? [' ', el('span', { class: 'cmdk-ctx' }, ...marked(P.excerpt(hit.snippet, needle), needle))] : null),
  foreign ? el('span', { class: 'cmdk-ws' }, hit.workspace) : null,
  state ? el('span', { class: `k k-state cat-${cat} hue-${chipCore.stateHue(state, cat)}` }, state.name) : null,
  el('span', { class: 'cmdk-where' }, P.whereText(hit)),
  el('button', {
    class: 'btn btn-sm btn-ghost-secondary tiny copy-btn', type: 'button', tabindex: '-1',
    title: 'Copy link', 'aria-label': 'Copy link',
    onclick: (e) => {
      e.stopPropagation();
      copyText(location.origin + hit.url, 'Permalink copied');
    },
  }, iconEl('⧉')));
}

function wireSearchButton() {
  $('#search-btn')?.addEventListener('click', openCommandK);
}

function openCommandK({
  onPick = null, onDismiss = null, kinds = null, placeholder = null,
  scope = null, selected = null, multi = false, onCommit = null, create = null,
} = {}) {
  if ($('#cmdk-back')) return;
  const P = weavePalette;
  const here = currentWsName();
  const linked = (selected ?? []).map((h) => ({ kind: 'entity', ...h }));
  const chosen = new Set(linked.map((h) => h.id));
  const checks = !!scope || selected != null || multi;
  const creators = (create ?? []).map((c) => ({ kind: 'create', name: c.label, run: c.run }));
  let picked = false;
  const dismiss = () => {
    back.remove();
    if (picked) return;
    picked = true;
    if (multi) onCommit?.([...chosen]);
    else onDismiss?.();
  };
  const back = el('div', { id: 'cmdk-back', onclick: (e) => { if (e.target === back) dismiss(); } });
  const input = el('input', {
    id: 'cmdk-input', autocomplete: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'cmdk-results', 'aria-autocomplete': 'list',
    placeholder: placeholder ?? (here ? `Search ${here}` : 'Search'),
  });
  input.setAttribute('aria-label', input.placeholder);
  const list = el('div', { id: 'cmdk-results', role: 'listbox', 'aria-label': 'Results', ...(multi ? { 'aria-multiselectable': 'true' } : {}) });
  list.addEventListener('mousedown', (e) => { if (!e.target.closest('button')) e.preventDefault(); });
  let groups = [], flat = [], rowEls = [], sel = 0;
  let timer, inflight = null;
  const markRows = () => rowEls.forEach((r, j) => {
    if (flat[j].kind === 'create' || !checks) return;
    const on = chosen.has(flat[j].id);
    r.setAttribute('aria-checked', String(on));
    r.classList.toggle('checked', on);
  });
  const pick = async (hit) => {
    if (picked) return;
    if (hit.kind === 'create') {
      let made;
      try { made = await hit.run(input.value.trim()); } catch (err) { toast(err.message, true); return; }
      if (!multi) { picked = true; back.remove(); onPick?.(made); return; }
      chosen.add(made.id);
      linked.push(made);
      input.value = '';
      input.focus();
      load('');
      return;
    }
    if (multi) {
      if (chosen.has(hit.id)) chosen.delete(hit.id);
      else chosen.add(hit.id);
      markRows();
      input.focus();
      return;
    }
    picked = true;
    back.remove();
    if (onPick) onPick(hit);
    else navigateToResult(hit);
  };
  const setSel = (i, scroll = true) => {
    if (!rowEls.length) { input.removeAttribute('aria-activedescendant'); return; }
    sel = ((i % rowEls.length) + rowEls.length) % rowEls.length;
    rowEls.forEach((r, j) => {
      r.classList.toggle('active', j === sel);
      r.setAttribute('aria-selected', String(j === sel));
    });
    input.setAttribute('aria-activedescendant', rowEls[sel].id);
    if (scroll) scrollTargetIntoView(rowEls[sel], { block: 'nearest' });
  };
  const render = (q, gs, empty) => {
    groups = gs;
    flat = gs.flatMap((g) => g.hits);
    rowEls = [];
    const needle = q.toLowerCase();
    const nodes = gs.map((g, gi) => el('div', { class: 'cmdk-group', role: 'group', 'aria-labelledby': `cmdk-g${gi}` },
      g.key === 'create' ? null
        : el('div', { class: 'cmdk-hdr', id: `cmdk-g${gi}` }, g.label, g.key === 'recent' || g.key === 'linked' ? null : ` · ${g.hits.length}`),
      g.hits.map((h) => {
        const i = rowEls.length;
        const row = paletteRow(h, i, {
          needle, group: g.key, here, onPick: pick, href: onPick || scope ? null : h.url,
          checked: checks && h.kind !== 'create' ? chosen.has(h.id) : null,
        });
        row.addEventListener('mouseenter', () => setSel(i, false));
        rowEls.push(row);
        return row;
      })));
    list.replaceChildren(...(nodes.length ? nodes : [el('div', { class: 'cmdk-empty' }, empty)]));
    list.dataset.query = q;
    input.setAttribute('aria-expanded', String(rowEls.length > 0));
    setSel(0);
  };
  const withCreate = (gs) => (creators.length ? [...gs, { key: 'create', label: '', hits: creators }] : gs);
  const scopedGroups = (q, hits) => {
    if (q) return withCreate(P.groupHits(hits, q));
    const mine = new Set(linked.map((h) => h.id));
    return withCreate([
      { key: 'linked', label: multi ? 'Linked' : 'Current', hits: linked },
      { key: 'records', label: 'Records', hits: hits.filter((h) => !mine.has(h.id)) },
    ].filter((g) => g.hits.length));
  };
  const showRecent = () => {
    const recent = readRecents().filter((h) => !kinds || kinds.includes(h.kind));
    render('', recent.length ? [{ key: 'recent', label: 'Recent', hits: recent }] : [], 'Records and tables you open show up here.');
  };
  const searchUrl = (q) => (scope
    ? `/search?q=${encodeURIComponent(q)}&tables=${scope.map(encodeURIComponent).join(',')}&limit=50`
    : `/search?q=${encodeURIComponent(q)}&all=1`);
  const load = async (q) => {
    inflight?.abort();
    const ctl = inflight = new AbortController();
    let hits;
    try {
      hits = await api('GET', searchUrl(q), undefined, { signal: ctl.signal });
    } catch (err) {
      if (ctl.signal.aborted) return;
      groups = []; flat = []; rowEls = [];
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      list.replaceChildren(el('div', { class: 'cmdk-error', role: 'alert' }, `Couldn't search: ${err.message}`));
      return;
    }
    if (ctl.signal.aborted) return;
    if (kinds) hits = hits.filter((h) => kinds.includes(h.kind));
    render(q, scope ? scopedGroups(q, hits) : P.groupHits(hits, q), q ? `No matches for “${q}”.` : 'Nothing here yet.');
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q && !scope) { inflight?.abort(); showRecent(); return; }
    timer = setTimeout(() => load(q), 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(sel - 1); }
    else if (e.key === 'Tab') { e.preventDefault(); setSel(P.groupJump(groups, sel, e.shiftKey ? -1 : 1)); }
    else if (e.key === 'Enter' && multi && !input.value.trim()) { e.preventDefault(); dismiss(); }
    else if (e.key === 'Enter' && flat.length) { e.preventDefault(); pick(flat[sel] ?? flat[0]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismiss(); }
  });
  const cap = (k) => el('kbd', {}, k);
  back.append(el('div', { id: 'cmdk', role: 'dialog', 'aria-label': 'Search' },
    el('div', { class: 'cmdk-inp' },
      iconEl('lucide:search', 'wv-icon cmdk-ic'),
      input,
      here ? el('span', { class: 'cmdk-ws', title: 'This workspace' }, here) : null),
    list,
    el('div', { class: 'cmdk-foot', 'aria-hidden': 'true' },
      el('span', {}, cap('↑'), ' ', cap('↓'), ' move'),
      el('span', {}, cap('↵'), multi ? ' toggle' : scope ? ' pick' : ' open'),
      el('span', {}, cap('tab'), ' next group'),
      multi ? el('span', {}, cap('↵'), ' on empty or ', cap('esc'), ' done') : el('span', {}, cap('esc'), ' close'))));
  document.body.append(back);
  if (scope) {
    render('', scopedGroups('', []), 'Searching…');
    load('');
  } else showRecent();
  input.focus();
}

function relationTargets(f) {
  if (f.targetDbIds) return f.targetDbIds.map((tid) => allTables().find((d) => d.id === tid)).filter(Boolean);
  const one = allTables().find((d) => d.id === f.targetDbId)
    ?? allTables().find((d) => d.qualified === f.targetDb || `${d.space}/${d.name}` === f.targetDb);
  return one ? [one] : [];
}

function linkSearch(f, { linked = [], commit }) {
  const targets = relationTargets(f);
  if (!targets.length) return;
  const before = linked.map((s) => s.id);
  const term = targets.length === 1 ? targets[0].term ?? termOfTable(targets[0].id) : WeaveTerm.DEFAULT;
  const run = (add, drop) => commit(add, drop).catch((err) => toast(err.message, true));
  openCommandK({
    scope: targets.map((t) => t.id),
    selected: linked,
    multi: !!f.many,
    placeholder: `Search ${term.plural} to link as ${f.name}…`,
    create: targets.map((t) => {
      const noun = (t.term ?? termOfTable(t.id)).singular;
      return {
        label: targets.length > 1 ? `+ New ${noun} in ${t.qualified}` : `+ New ${noun}`,
        run: async (q) => {
          const made = await api('POST', `/tables/${t.id}/entities`, { values: { Name: q || `New ${t.name}` } });
          return { kind: 'entity', id: made.id, publicId: made.publicId, name: made.name, db: made.db ?? t.qualified, url: `${WS_PREFIX}/e/${made.id}` };
        },
      };
    }),
    onPick: (hit) => { if (!before.includes(hit.id)) run([hit.id], []); },
    onCommit: (ids) => {
      const add = ids.filter((x) => !before.includes(x));
      const drop = before.filter((x) => !ids.includes(x));
      if (add.length || drop.length) run(add, drop);
    },
  });
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCommandK();
  }
});

let lastGesture = null;

async function gestureTop(g) {
  const top = await api('GET', `/undo?limit=${g.ids.length}`);
  const ours = [];
  for (const u of top) {
    if (u.kind !== g.kind || !g.ids.includes(u.entityId) || ours.includes(u.entityId)) break;
    ours.push(u.entityId);
  }
  return ours;
}

async function undoGesture(g) {
  if (lastGesture === g) lastGesture = null;
  try {
    const ours = await gestureTop(g);
    if (ours.length) await api('POST', '/undo', { steps: ours.length });
    for (const id of g.ids) if (!ours.includes(id)) await api('POST', `/entities/${id}/restore`);
    await refreshView();
    focusGridRow(g.ids[0]);
    toast('Restored');
  } catch (err) { toast(err.message, true); }
}

async function refreshView() {
  const grid = state.route?.page === 'db' ? $('#main .table-wrap') : null;
  if (grid?.wvRefresh) return grid.wvRefresh();
  await loadSchema();
  return route();
}

function focusGridRow(eid, scope = document) {
  const stop = 'td[data-field]:not(.cell-nostop)';
  const own = eid ? scope.querySelector(`tr[data-eid="${eid}"] > ${stop}`) : null;
  (own ?? scope.querySelector(`.table-wrap tr.entity-row > ${stop}`))?.focus({ preventScroll: !own });
}

document.addEventListener('keydown', async (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
  if (e.defaultPrevented || e.isComposing) return;
  if (e.target?.isContentEditable || e.target?.closest?.('input:not([type="checkbox"]), textarea, select, [contenteditable]')) return;
  if (document.querySelector(DOCK_ESC_OWNERS)) return;
  e.preventDefault();
  const g = lastGesture;
  lastGesture = null;
  try {
    const ours = g ? await gestureTop(g) : [];
    const { undone } = await api('POST', '/undo', { steps: ours.length || 1 });
    if (!undone.length) return toast('Nothing to undo');
    await refreshView();
    const first = undone[0].name || undone[0].entity;
    toast(`Undone: ${first}${undone.length > 1 ? ` and ${undone.length - 1} more` : ''}`);
  } catch (err) { toast(err.message, true); }
});


const KEY_SHEET_ANYWHERE = [
  { keys: '⌘K', does: 'search every record, table and document' },
  { keys: '?', does: 'this sheet, from anywhere outside a text field' },
  { keys: '⌘⇧E', does: 'expand the docked record to the page, or dock it again' },
  { keys: 'Esc', does: 'close the dock, a dialog or a menu' },
  { keys: '⌘Z', does: 'undo the last change; a trash from the selection bar comes back whole' },
  { keys: '⌘Return', does: 'send a problem report from its note' },
];
const KEY_SHEET_TABLE = [
  { keys: '/ or ⌘F', does: 'search this table' },
  { keys: '⌘C / ⌘V', does: 'copy or paste the cell or the range' },
];

function openKeySheet() {
  const rows = (list) => el('table', { class: 'key-sheet-table' },
    el('tbody', {}, list.map((b) => el('tr', {},
      el('th', { scope: 'row' }, el('kbd', {}, b.keys)),
      el('td', {}, b.does)))));
  const grid = globalThis.WeaveGridKeymap?.bindings ?? [];
  const section = (title, list) => el('section', { class: 'key-sheet-section' }, el('h3', {}, title), rows(list));
  modal('Keyboard shortcuts', [el('div', { class: 'key-sheet' },
    section('Anywhere', KEY_SHEET_ANYWHERE),
    section('On a table, a cell at rest', [...grid.filter((b) => b.mode === 'rest'), ...KEY_SHEET_TABLE]),
    section('In an open cell', grid.filter((b) => b.mode === 'edit')))], null, 'Done');
  $('#modal')?.classList.add('wv-keys');
}

document.addEventListener('keydown', (e) => {
  if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.defaultPrevented) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable], .vditor') || e.target.isContentEditable) return;
  if (document.querySelector(DOCK_ESC_OWNERS) || $('#bug-panel')) return;
  e.preventDefault();
  openKeySheet();
});

function wireKeySheet() {
  const btn = $('#rail-help');
  if (!btn) return;
  btn.replaceChildren(iconEl('lucide:circle-question-mark') ?? '?');
  btn.addEventListener('click', openKeySheet);
}

const LOADER_CYCLE_MS = 2000;
const LOADER_SHOW_AFTER_MS = 500;
const SKELETON_SHOW_AFTER_MS = 150;
const loading = { depth: 0, shownAt: 0, showTimer: null, hideTimer: null, ready: false };

async function initPageLoader() {
  const host = $('#page-loader');
  if (!host) return;
  const html = await fetch('/brand/weave-loader-rope.html')
    .then((res) => (res.ok ? res.text() : null)).catch(() => null);
  if (!html) return;
  host.innerHTML = html;
  loading.ready = true;
}

function showPageLoader() {
  const host = $('#page-loader');
  if (!host) return;
  loading.shownAt = Date.now();
  host.hidden = false;
  host.setAttribute('aria-hidden', 'false');
}

function hidePageLoader() {
  const host = $('#page-loader');
  if (!host) return;
  host.classList.remove('boot');
  host.hidden = true;
  host.setAttribute('aria-hidden', 'true');
  loading.shownAt = 0;
}

async function withPageLoader(work) {
  loading.depth += 1;
  clearTimeout(loading.hideTimer);
  loading.hideTimer = null;
  if (!loading.shownAt && !loading.showTimer) {
    loading.showTimer = setTimeout(() => {
      loading.showTimer = null;
      showPageLoader();
    }, LOADER_SHOW_AFTER_MS);
  }
  try {
    return await work();
  } finally {
    loading.depth -= 1;
    if (loading.depth > 0) return;
    if (loading.showTimer) {
      clearTimeout(loading.showTimer);
      loading.showTimer = null;
      hidePageLoader();
      return;
    }
    if (!loading.shownAt) {
      hidePageLoader();
      return;
    }
    const elapsed = Date.now() - loading.shownAt;
    loading.hideTimer = setTimeout(hidePageLoader, LOADER_CYCLE_MS - (elapsed % LOADER_CYCLE_MS));
  }
}

const gridWait = { holds: new Set(), showTimer: 0, shownAt: 0, hideTimer: 0 };
function gridHold() {
  const token = {};
  gridWait.holds.add(token);
  paintGridWait();
  return () => { if (gridWait.holds.delete(token)) paintGridWait(); };
}
function paintGridWait() {
  const busy = gridWait.holds.size > 0;
  const wrap = $('#main')?.querySelector(':scope > .table-wrap');
  if (wrap && busy !== (wrap.getAttribute('aria-busy') === 'true')) {
    if (busy) wrap.setAttribute('aria-busy', 'true'); else wrap.removeAttribute('aria-busy');
  }
  if (busy) {
    clearTimeout(gridWait.hideTimer); gridWait.hideTimer = 0;
    if (!gridWait.shownAt && !gridWait.showTimer) {
      gridWait.showTimer = setTimeout(() => { gridWait.showTimer = 0; showGridLoader(); }, LOADER_SHOW_AFTER_MS);
    } else if (gridWait.shownAt) placeGridLoader();
    return;
  }
  if (gridWait.showTimer) { clearTimeout(gridWait.showTimer); gridWait.showTimer = 0; return; }
  if (!gridWait.shownAt || gridWait.hideTimer) return;
  const elapsed = Date.now() - gridWait.shownAt;
  gridWait.hideTimer = setTimeout(hideGridLoader, LOADER_CYCLE_MS - (elapsed % LOADER_CYCLE_MS));
}
function placeGridLoader() {
  const main = $('#main');
  const node = main?.querySelector(':scope > .grid-loader');
  const wrap = main?.querySelector(':scope > .table-wrap');
  if (!node || !wrap) return;
  const m = main.getBoundingClientRect(), w = wrap.getBoundingClientRect();
  const top = Math.max(w.top, m.top), bottom = Math.min(w.bottom, m.bottom);
  Object.assign(node.style, {
    top: `${top - m.top + main.scrollTop}px`, left: `${w.left - m.left + main.scrollLeft}px`,
    width: `${w.width}px`, height: `${Math.max(0, bottom - top)}px`,
  });
}
function showGridLoader() {
  const main = $('#main');
  const source = $('#page-loader');
  if (!main?.querySelector(':scope > .table-wrap') || !loading.ready || !source) return;
  let node = main.querySelector(':scope > .grid-loader');
  if (!node) {
    node = el('div', { class: 'grid-loader', 'aria-hidden': 'true' });
    for (const mark of source.querySelectorAll(':scope > span')) node.append(mark.cloneNode(true));
    main.append(node);
  }
  node.hidden = false;
  gridWait.shownAt = Date.now();
  placeGridLoader();
}
function hideGridLoader() {
  gridWait.hideTimer = 0; gridWait.shownAt = 0;
  const node = $('#main')?.querySelector(':scope > .grid-loader');
  if (node) node.hidden = true;
}
function resetGridWait() {
  gridWait.holds.clear();
  clearTimeout(gridWait.showTimer); gridWait.showTimer = 0;
  clearTimeout(gridWait.hideTimer);
  hideGridLoader();
}

function paintSkeleton(kind, db) {
  const main = $('#main');
  if (!main) return;
  const line = (w, h = 12) => el('div', { class: 'sk sk-line', style: `width:${w};height:${h}px` });
  if (kind === 'db') {
    const n = Math.max(2, Math.min(db ? visibleCols(db).length : 4, 8));
    const widths = Array.from({ length: n }, (_, i) => (i === 0 ? '22%' : `${Math.max(12 - i, 7)}%`));
    const bar = () => el('div', { class: 'sk-row' }, line('28px'), ...widths.map((w, i) => line(w, i === 0 ? 14 : 12)));
    main.replaceChildren(
      el('div', { class: 'sk-toolbar' }, line('180px', 22), line('120px', 22)),
      el('div', { class: 'card panel sk-card' },
        el('div', { class: 'sk-row sk-head' }, line('30px'), ...widths.map((w) => line(w, 13))),
        ...Array.from({ length: 8 }, bar)));
  } else if (kind === 'entity') {
    main.replaceChildren(el('div', { class: 'sk-entity' },
      el('div', { class: 'sk-main' }, line('40%', 22), el('div', { class: 'sk sk-block' }), el('div', { class: 'sk sk-block short' })),
      el('div', { class: 'sk-side' }, line('30%', 13),
        ...Array.from({ length: 5 }, () => el('div', { class: 'sk-row' }, line('30%'), line('50%'))))));
  } else {
    main.replaceChildren(
      el('div', { class: 'sk-toolbar' }, line('220px', 22)),
      el('div', { class: 'card list-rows sk-card' },
        ...Array.from({ length: 5 }, () => el('div', { class: 'sk-row sk-listrow' }, line('30%'), line('10%')))));
  }
}

const skeleton = { timer: 0, watch: null };
function scheduleSkeleton(kind, db) {
  cancelSkeleton();
  const main = $('#main');
  if (main) {
    skeleton.watch = new MutationObserver(cancelSkeleton);
    skeleton.watch.observe(main, { childList: true });
  }
  skeleton.timer = setTimeout(() => { cancelSkeleton(); paintSkeleton(kind, db); }, SKELETON_SHOW_AFTER_MS);
}
function cancelSkeleton() {
  clearTimeout(skeleton.timer);
  skeleton.timer = 0;
  skeleton.watch?.disconnect();
  skeleton.watch = null;
}

function syncDocTitle(pageName) {
  if (pageName !== undefined) state.pageName = pageName;
  const top = dock?.state.chain[dock.state.chain.length - 1];
  document.title = weaveBreadcrumbs.docTitle(top?.name || state.pageName, $('#ws-name')?.textContent);
}

function renderRoute() {
  return Promise.resolve().then(dispatchRoute).finally(cancelSkeleton);
}

function dispatchRoute() {
  teardownDocEditors();
  dockClose();
  for (const pop of document.querySelectorAll('.chip-pop, .picker-pop')) {
    const nextTable = location.hash.match(/^#\/(?:table|db)\/([^/?]+)/)?.[1];
    if (!pop.classList.contains('table-view-popover') || pop.tableId !== nextTable) pop.remove();
  }
  state.pageName = null;
  const hash = location.hash || '#/';
  const dbM = hash.match(/^#\/(?:table|db)\/([^/?]+)/);
  if (!(dbM && tableChromeOn(dbM[1]))) {
    resetGridWait();
    scheduleSkeleton(dbM ? 'db' : /^#\/entity\//.test(hash) ? 'entity' : 'list',
      dbM ? allTables().find((d) => d.id === dbM[1]) : null);
  }
  let m;
  if (hash === '#/trash') return showTrash(null);
  if ((m = hash.match(/^#\/trash\/([^/?]+)/))) return showTrash(m[1]);
  if ((m = hash.match(/^#\/(?:table|db)\/([^/?]+)(?:\/view\/([^/?]+))?(?:\?e=([^&]+))?/))) return showDatabase(m[1], m[2] ? decodeURIComponent(m[2]) : null).then(() => redock(m[1], m[3]));
  if ((m = hash.match(/^#\/space\/([^/?]+)/))) return showSpace(m[1]);
  if ((m = hash.match(/^#\/activity(?:\/([^/?]+))?/))) return showActivity(m[1] ?? null);
  if (hash.startsWith('#/map')) return showMap();
  if ((m = hash.match(/^#\/view\/([^/?]+)/))) return showView(m[1]);
  if ((m = hash.match(/^#\/entity\/([^/?]+)/))) return showEntity(m[1]);
  return showHome();
}

function paintRouteError(err) {
  console.error(err);
  const main = $('#main');
  if (!main) return;
  main.replaceChildren(el('div', { class: 'card panel wv-route-error' },
    el('div', { class: 'card-body' },
      el('h2', { class: 'wv-route-error-title' }, 'This page did not load'),
      el('p', { class: 'wv-route-error-msg' }, String(err?.message || err || 'Unknown error')),
      el('div', { class: 'wv-route-error-actions' },
        el('button', { class: 'btn btn-primary', type: 'button', onclick: () => route() }, 'Try again'),
        el('a', {
          class: 'bug-mail', title: `Opens your mail app with the error filled in, addressed to ${bugCore.REPORT_MAIL}`,
          href: bugCore.mailtoReport({
            categories: ['error'], note: '',
            pathname: location.pathname, hash: location.hash,
            health: state.health ?? {}, userAgent: navigator.userAgent,
            viewport: { w: innerWidth, h: innerHeight }, theme: document.documentElement.dataset.bsTheme ?? 'light',
            lastError: String(err?.message || err || ''),
          }),
        }, iconEl('lucide:mail', 'wv-icon bug-mail-icon'), 'Report by email')))));
}
let renderChain = Promise.resolve();
const renderRouteSafely = () => {
  renderChain = renderChain
    .catch(() => {})
    .then(() => schemaFetch)
    .then(renderRoute)
    .catch(paintRouteError)
    .then(ensureNavMenu)
    .then(syncPhoneBar);
  return renderChain;
};
function installPhoneBar() {
  const label = el('span', { class: 'phone-search-label' }, 'Search');
  const search = el('button', { class: 'phone-search', type: 'button', onclick: () => openCommandK() }, lucideEl('search'), label);
  const add = el('button', {
    class: 'phone-new', type: 'button', hidden: '',
    onclick: () => {
      const db = state.route?.page === 'db' ? allTables().find((d) => d.id === state.route.dbId) : null;
      if (db?.system) state.inlineAdd?.();
      else if (db) newRowSheet(db);
    },
  }, lucideEl('plus'));
  document.body.append(el('div', { class: 'phone-bar' }, search, add));
  syncPhoneBar.parts = { label, search, add };
}
const NEW_ROW_CHOICES = 3;
const NEW_ROW_OPTIONS = 6;
function newRowSheet(start) {
  document.querySelector('.new-row-sheet')?.closeSheet?.();
  const back = el('div', { class: 'new-row-back', 'aria-hidden': 'true' });
  const sheet = el('div', { class: 'new-row-sheet', role: 'dialog', 'aria-modal': 'true' });
  let db = start;
  let picked = {};
  let off = () => {};
  const close = () => { off(); removeEventListener('keydown', esc, true); sheet.remove(); back.remove(); };
  const esc = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  sheet.closeSheet = close;
  const name = el('textarea', { class: 'new-row-name', rows: '2', 'aria-label': 'Name' });
  const create = el('button', { class: 'new-row-create', type: 'button', disabled: '' }, 'Create');
  const more = el('button', { class: 'new-row-more', type: 'button', disabled: '' }, 'All fields');
  name.addEventListener('input', () => { create.disabled = more.disabled = !name.value.trim(); });
  const choiceFields = () => {
    const hidden = new Set(db.hiddenFields ?? []);
    return db.fields.filter((f) => (f.type === 'select' || f.type === 'multiselect') && !hidden.has(f.name) && (f.options ?? []).length && f.options.length <= NEW_ROW_OPTIONS).slice(0, NEW_ROW_CHOICES);
  };
  const choiceEl = (f) => {
    const many = f.type === 'multiselect';
    const seg = !many && f.options.length <= 3;
    const box = el('div', { class: seg ? 'new-row-seg' : 'new-row-chips', role: 'group', 'aria-label': f.name });
    const paint = () => {
      for (const b of box.children) {
        const on = many ? (picked[f.name] ?? []).includes(b.dataset.opt) : picked[f.name] === b.dataset.opt;
        b.setAttribute('aria-pressed', String(on));
      }
    };
    for (const opt of f.options) {
      box.append(el('button', {
        class: `new-row-opt ${optionHue(f, opt)}`, type: 'button', dataset: { opt },
        onclick: () => {
          if (many) {
            const now = new Set(picked[f.name] ?? []);
            if (now.has(opt)) now.delete(opt); else now.add(opt);
            picked[f.name] = [...now];
          } else picked[f.name] = picked[f.name] === opt ? undefined : opt;
          paint();
        },
      }, opt));
    }
    paint();
    return el('div', { class: 'new-row-field' }, el('span', { class: 'new-row-label' }, f.name), box);
  };
  const tableChip = el('button', { class: 'new-row-table', type: 'button', 'aria-haspopup': 'dialog' });
  const title = el('h2', { class: 'new-row-title' });
  const fieldsBox = el('div', { class: 'new-row-fields' });
  const draw = () => {
    const term = db.term?.singular ?? 'row';
    title.textContent = `New ${term}`;
    sheet.setAttribute('aria-label', `New ${term}`);
    name.placeholder = `Name this ${term}`;
    tableChip.replaceChildren(iconEl(db.icon, 'wv-icon') ?? '', el('span', {}, db.name), lucideEl('chevron-down'));
    tableChip.setAttribute('aria-label', `Table: ${db.name}`);
    fieldsBox.replaceChildren(...choiceFields().map(choiceEl));
  };
  tableChip.addEventListener('click', () => searchPicker({
    anchor: tableChip, title: 'New row in', placeholder: 'Search tables…',
    options: allTables().filter((t) => !t.system).map((t) => ({ id: t.id, label: t.name, sub: t.space })),
    currentId: db.id,
    onPick: (o) => { db = allTables().find((t) => t.id === o.id) ?? db; picked = {}; draw(); },
  }));
  const write = async (then) => {
    const text = name.value.trim();
    if (!text) return;
    create.disabled = more.disabled = true;
    const values = { ...filterSeed(db) };
    for (const [k, v] of Object.entries(picked)) if (v !== undefined && !(Array.isArray(v) && !v.length)) values[k] = v;
    try {
      const made = await api('POST', `/tables/${db.id}/entities`, { name: text, ...(Object.keys(values).length ? { values } : {}) });
      close();
      await loadSchema();
      if (state.route?.page === 'db' && state.route.dbId === db.id) await showDatabase(db.id, state.route.view);
      await then(made);
    } catch (err) { create.disabled = more.disabled = false; toast(err.message, true); }
  };
  create.addEventListener('click', () => write((made) => openEntity(made.id)));
  more.addEventListener('click', () => write((made) => { location.hash = `#/entity/${made.id}`; }));
  sheet.append(
    el('div', { class: 'new-row-grip', 'aria-hidden': 'true' }),
    el('div', { class: 'new-row-head' }, title, tableChip),
    el('label', { class: 'new-row-field' }, el('span', { class: 'new-row-label' }, 'Name'), name),
    fieldsBox,
    el('div', { class: 'new-row-actions' }, more, create));
  draw();
  document.body.append(back, sheet);
  off = dismissOutside({ inside: (t) => sheet.contains(t) || !!t.closest?.('.picker-pop, .chip-pop'), close, swallow: () => true, open: () => sheet.isConnected });
  addEventListener('keydown', esc, true);
  name.focus({ preventScroll: true });
  return sheet;
}
function syncPhoneBar() {
  const parts = syncPhoneBar.parts;
  if (!parts) return;
  const db = state.route?.page === 'db' ? allTables().find((d) => d.id === state.route.dbId) : null;
  const text = `Search ${db?.name ?? (currentWsName() || 'weave')}`;
  parts.label.textContent = text;
  parts.search.setAttribute('aria-label', text);
  parts.add.hidden = !db;
  const noun = db?.term?.singular ?? 'row';
  parts.add.title = `New ${noun}`;
  parts.add.setAttribute('aria-label', `New ${noun}`);
}
function ensureNavMenu() {
  const main = $('#main');
  if (!main || main.querySelector('.nav-menu')) return;
  main.prepend(el('div', { class: 'crumb nav-menu-row' }, navMenuButton()));
}
function route() {
  return withPageLoader(renderRouteSafely);
}

async function redock(dbId, id) {
  if (!id) return;
  const anchor = allTables().find((d) => d.id === dbId);
  if (!anchor) return;
  let entity;
  try { entity = await api('GET', `/entities/${id}`); } catch { dockSyncUrl(); return; }
  const db = allTables().find((d) => d.id === entity.dbId) ?? anchor;
  await dockEntity(db, id);
}

window.addEventListener('hashchange', commitActiveEdit);
window.addEventListener('hashchange', route);

document.addEventListener('click', (ev) => {
  const caret = ev.target.closest('.mention-caret');
  if (!caret) return;
  ev.preventDefault();
  ev.stopPropagation();
  const open = caret.closest('.mention-wrap')?.classList.toggle('open');
  caret.setAttribute('aria-expanded', String(!!open));
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.shiftKey) return;
  if (state.route?.page !== 'db') return;
  const editing = e.target.closest?.('input,select,textarea,[contenteditable]');
  if (editing && !editing.closest('.wv-grid tr[data-eid]')) return;
  if ($('#modal-back') || $('#cmdk-back')) return;
  const db = allTables().find((d) => d.id === state.route.dbId);
  if (!db) return;
  e.preventDefault();
  if (editing) editing.blur();
  if (state.inlineAdd) state.inlineAdd();
  else quickCreate(db);
});

async function buildWsRail() {
  const listBox = $('#ws-list');
  if (!listBox) return;
  try {
    const list = await api('GET', '/workspaces');
    const seg = WS_PREFIX ? WS_PREFIX.slice(3) : null;
    const cur = seg ? list.find((w) => w.name === seg || w.id === seg) : list.find((w) => w.default);
    const current = cur?.name ?? seg;
    state.wsList = list;
    state.wsCurrent = current;
    const wordmark = $('#ws-name');
    wordmark.textContent = current ?? '';
    syncDocTitle();
    wordmark.href = wsHomeHref();
    wordmark.title = current ? `Open the ${current} workspace page` : 'Open the workspace page';
    syncPhoneBar();
    const weaveWs = list.find((w) => w.name === 'weave');
    const pinned = $('#rail-weave');
    if (pinned) {
      if (weaveWs) pinned.href = weaveWs.default ? '/' : (weaveWs.url ?? '/w/weave/');
      pinned.classList.toggle('active', current === 'weave');
    }
    listBox.replaceChildren(
      ...list.filter((w) => w.name !== 'weave').map((w) => {
        const prefix = w.default ? '' : `/w/${w.id}`;
        const chip = el('a', {
          class: 'ws-icon' + (w.name === current ? ' active' : ''),
          href: w.default ? '/' : (w.url ?? `/w/${w.id}/`),
          title: `${w.name} — ${w.tables} tables, ${w.entities} entities` + (w.name === current ? ' (click for the menu)' : ' (right-click for the menu)'),
        }, w.logo
          ? el('img', { src: `${prefix}/api/workspace/logo`, alt: w.name })
          : w.name.slice(0, 1).toUpperCase());
        const openMenu = (e) => {
          e.preventDefault();
          e.stopPropagation();
          contextMenu(e, [
            { label: 'Update logo…', run: () => uploadWorkspaceLogo(w) },
            w.logo ? { label: 'Remove logo', run: () => removeWorkspaceLogo(w) } : null,
            w.deletable ? { label: 'Delete workspace…', danger: true, run: () => confirmDeleteWorkspace(w, { current: w.name === current }) } : null,
          ].filter(Boolean), 'ws-ctx');
        };
        chip.addEventListener('contextmenu', openMenu);
        if (w.name === current) chip.addEventListener('click', (e) => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) openMenu(e); });
        return chip;
      }));
    refreshWsMarks();
  } catch {}
  refreshAccountChip();
}

function contextMenu(e, items, extraClass = '') {
  contextMenu.close?.();
  const menu = el('div', { class: `dl-menu wv-ctx ${extraClass}`, style: `position:fixed;top:${e.clientY}px;left:${e.clientX}px;z-index:120` });
  let off = () => {};
  const close = () => { menu.remove(); off(); removeEventListener('keydown', esc); contextMenu.close = null; };
  const esc = (ev) => { if (ev.key === 'Escape') close(); };
  for (const it of items) {
    if (it === 'divider') { menu.append(el('div', { class: 'dropdown-divider' })); continue; }
    if (it.hold) {
      menu.append(holdToConfirm(it.hold, async () => { close(); await it.run(); }, { holdingLabel: it.holdingLabel ?? 'Hold to confirm…' }));
      continue;
    }
    menu.append(el('button', {
      class: 'dropdown-item' + (it.danger ? ' text-danger' : ''), type: 'button',
      onclick: async () => { close(); await it.run(); },
    }, it.label));
  }
  document.body.append(menu);
  off = dismissOutside({ open: () => menu.isConnected, inside: (t) => menu.contains(t), close });
  addEventListener('keydown', esc);
  contextMenu.close = close;
  return menu;
}

function confirmDeleteWorkspace(w, { current = false } = {}) {
  modal(`Delete workspace ${w.name}`, [
    el('p', { class: 'text-secondary', style: 'margin:0 0 8px' },
      `The workspace moves to the trash — its ${w.tables ?? 0} tables and ${w.entities ?? 0} entities stay on disk and Restore brings it back from Trash in the sidebar. Type `,
      el('code', {}, w.name), ' to confirm.'),
    el('input', { name: 'confirm', class: 'form-control', placeholder: w.name, autocomplete: 'off', style: 'width:100%' }),
  ], async (fd) => {
    if (fd.get('confirm') !== w.name) throw new Error(`Type ${w.name} exactly to delete it`);
    await api('DELETE', `/workspaces/${w.id}`);
    if (current) { location.href = '/'; return; }
    toast(`Workspace ${w.name} moved to the trash`, false, {
      label: 'Undo', run: async () => { await api('POST', `/workspaces/${w.id}/restore`); buildWsRail(); },
    });
    buildWsRail();
  }, 'Delete');
  document.querySelector('#modal button[type="submit"]')?.classList.replace('btn-primary', 'btn-danger');
}

async function trashedWorkspaces() {
  try { return (await api('GET', '/workspaces?deleted=1')).filter((w) => w.deletedAt); } catch { return []; }
}
function trashedWorkspacesCard(trashed, redraw) {
  return el('div', { class: 'card panel trash-workspaces', style: 'margin-top:12px' },
    el('h3', { class: 'card-title' }, 'Workspaces'),
    ...trashed.map((w) => el('div', { class: 'wv-toolbar', style: 'margin-bottom:6px;gap:8px' },
      el('span', { style: 'flex:1' }, w.name, ' ', el('span', { class: 'text-secondary' }, `deleted ${new Date(w.deletedAt).toLocaleString()}`)),
      el('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: async () => {
          try {
            await api('POST', `/workspaces/${w.id}/restore`);
            toast(`Workspace ${w.name} restored`);
            buildWsRail();
            redraw();
          } catch (err) { toast(err.message, true); }
        },
      }, 'Restore'))));
}
const wsApiPrefix = (w) => (w.default ? '' : `/w/${w.id}`) + '/api';
async function wsApi(w, method, path, body) {
  const res = await fetch(wsApiPrefix(w) + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}
function uploadWorkspaceLogo(w) {
  const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const contentBase64 = await fileBase64(file);
    try {
      await wsApi(w, 'PUT', '/workspace/logo', { name: file.name, mime: file.type || 'image/png', contentBase64 });
      toast(`${w.name} logo updated`);
      buildWsRail();
    } catch (err) { toast(err.message, true); }
  });
  document.body.append(input);
  input.click();
}
async function removeWorkspaceLogo(w) {
  try {
    await wsApi(w, 'DELETE', '/workspace/logo');
    toast(`${w.name} logo removed`);
    buildWsRail();
  } catch (err) { toast(err.message, true); }
}

function wireWsNew() {
  const btn = $('#ws-new');
  if (!btn) return;
  btn.replaceChildren(iconEl('+', 'wv-icon'));
  btn.addEventListener('click', async () => {
    const me = await api('GET', '/auth/me').catch((err) => {
      if (err.status !== 401) toast(err.message, true);
      return null;
    });
    const accountName = me?.account?.name ?? null;
    const slugs = WeaveSlugForm.mount({ accountName, check: (slug) => api('GET', `/workspaces/slug?slug=${encodeURIComponent(slug)}`) });
    modal('New workspace', [slugs.node], async () => {
      try {
        const created = await api('POST', '/workspaces', slugs.value());
        location.href = created.url;
      } catch (err) {
        if (slugs.refused(err.code)) err.shown = true;
        throw err;
      }
    }, WeaveSlugs.COPY.submit);
    const done = document.querySelector('#modal button[type="submit"]');
    if (done) slugs.bindSubmit(done);
  });
}

const narrowShell = matchMedia('(max-width: 900px)');
function wireNavCollapse() {
  const app = $('#app');
  const collapse = $('#nav-collapse');
  const expand = $('#nav-expand');
  const sidebar = $('#sidebar');
  if (!app || !collapse || !expand || !sidebar) return;
  const apply = (collapsed) => {
    app.classList.toggle('nav-collapsed', collapsed);
    app.classList.remove('nav-peek');
    expand.classList.toggle('hidden', !collapsed);
    localStorage.setItem('weave-nav-collapsed', collapsed ? '1' : '');
  };
  collapse.addEventListener('click', () => (narrowShell.matches ? app.classList.remove('nav-peek') : apply(true)));
  expand.addEventListener('click', () => apply(false));
  const strip = el('div', { id: 'nav-hot-strip', 'aria-hidden': 'true' });
  app.append(strip);
  let settle = null;
  strip.addEventListener('mouseenter', () => {
    if (!app.classList.contains('nav-collapsed')) return;
    app.classList.add('nav-peek');
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (!sidebar.matches(':hover') && !strip.matches(':hover')) app.classList.remove('nav-peek');
    }, 400);
  });
  strip.addEventListener('click', () => apply(false));
  sidebar.addEventListener('click', (e) => {
    if (!app.classList.contains('nav-peek') || narrowShell.matches) return;
    if (e.target.closest('a,button,input,textarea,select,label')) return;
    apply(false);
  });
  sidebar.addEventListener('mouseleave', () => {
    if (app.classList.contains('nav-peek') && !narrowShell.matches) app.classList.remove('nav-peek');
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') app.classList.remove('nav-peek'); });
  apply(localStorage.getItem('weave-nav-collapsed') === '1');
  const shut = () => app.classList.remove('nav-peek');
  app.addEventListener('click', (e) => { if (e.target === app) shut(); });
  addEventListener('hashchange', shut);
  sidebar.addEventListener('click', (e) => { if (narrowShell.matches && e.target.closest('a[href]')) shut(); }, true);
  narrowShell.addEventListener('change', shut);
}

function navMenuButton() {
  const btn = el('button', {
    class: 'btn btn-sm btn-icon btn-ghost-secondary nav-menu', type: 'button',
    title: 'Open navigation', 'aria-label': 'Open navigation', 'aria-controls': 'sidebar',
    onclick: () => $('#app').classList.add('nav-peek'),
  });
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  return btn;
}

function wireSkipLink() {
  $('.skip-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    const main = $('#main');
    main.tabIndex = -1;
    main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
    main.focus();
  });
}

function wireThemeToggle() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const icons = { auto: 'lucide:sun-moon', dark: 'lucide:moon', light: 'lucide:sun' };
  const media = matchMedia('(prefers-color-scheme: dark)');
  let pref = localStorage.getItem('weave-theme') ?? 'auto';
  if (!icons[pref]) pref = 'auto';
  const apply = () => {
    const resolved = pref === 'auto' ? (media.matches ? 'dark' : 'light') : pref;
    document.documentElement.dataset.bsTheme = resolved;
    btn.replaceChildren(iconEl(icons[pref]) ?? icons[pref]);
    btn.title = `Theme: ${pref} (click to switch)`;
    retheme();
  };
  media.addEventListener('change', () => { if (pref === 'auto') apply(); });
  apply();
  btn.addEventListener('click', () => {
    pref = pref === 'auto' ? 'dark' : pref === 'dark' ? 'light' : 'auto';
    localStorage.setItem('weave-theme', pref);
    apply();
  });
}

function syncSchema() {
  if (schemaFetch) return schemaFetch;
  const before = JSON.stringify(state.schema);
  schemaFetch = loadSchema().then(() => true, () => false);
  return schemaFetch.then((loaded) => {
    schemaFetch = null;
    if (!loaded || JSON.stringify(state.schema) === before) return;
    if (pendingDocSaves.size) {
      toast('Schema changed elsewhere — reopen this entity to see new fields');
      return;
    }
    if (eyeGestures) return;
    route();
  });
}
window.addEventListener('focus', syncSchema);


const bugGlyph = () => iconEl('lucide:bug', 'bug-fab-icon');

let bugRecorder = null;
let bugDraft = { note: '', categories: [] };

function installBugReporter() {
  if (bugRecorder) return;
  bugRecorder = bugCore.createRecorder();
  const now = () => Date.now();

  bugRecorder.record({ kind: 'nav', to: location.hash || '#/', t: now() });
  addEventListener('hashchange', () => bugRecorder.record({ kind: 'nav', to: location.hash, t: now() }));

  addEventListener('click', (e) => {
    const node = e.target?.closest?.('button, a, [role="button"], th, td, .chip, summary') ?? e.target;
    if (node?.closest?.('.bug-fab, #bug-panel')) return;
    bugRecorder.record({ kind: 'click', target: bugCore.describeTarget(node), t: now() });
  }, true);

  const SLOW_MS = 400;
  const READ_PATHS = /\/(query|search|markdown|health|schema|vocabulary)(\?|$)/;
  const worthRecording = (method, status, ms, path = '') =>
    status === 0 || status >= 400 || ms >= SLOW_MS || (method !== 'GET' && !READ_PATHS.test(path));

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input ?? '');
    const method = String(init.method ?? input?.method ?? 'GET').toUpperCase();
    const started = now();
    const mine = url.includes('/api/bug-report');
    try {
      const res = await nativeFetch(input, init);
      const ms = now() - started;
      if (!mine && worthRecording(method, res.status, ms, url)) {
        bugRecorder.record({
          kind: 'api', method, path: url.replace(location.origin, ''),
          status: res.status, ms, t: started,
        });
      }
      return res;
    } catch (err) {
      if (!mine) {
        bugRecorder.record({
          kind: 'api', method, path: url.replace(location.origin, ''),
          status: 0, ms: now() - started, t: started, message: String(err?.message ?? err),
        });
      }
      throw err;
    }
  };

  addEventListener('error', (e) => bugRecorder.record({
    kind: 'error',
    message: String(e.message ?? e.error?.message ?? 'error'),
    source: String(e.filename ?? '').replace(location.origin, ''),
    line: e.lineno ?? null,
    t: now(),
  }));
  addEventListener('unhandledrejection', (e) => bugRecorder.record({
    kind: 'error', message: String(e.reason?.message ?? e.reason ?? 'unhandled rejection'), t: now(),
  }));

  const fab = el('button', {
    class: 'bug-fab', type: 'button', title: 'Report a problem',
    'aria-label': 'Report a problem', 'aria-expanded': 'false',
    onclick: () => (document.querySelector('#bug-panel') ? closeBugPanel() : openBugPanel(fab)),
  }, bugGlyph());
  document.body.append(fab);
}

function closeBugPanel() {
  document.querySelector('#bug-panel')?.remove();
  document.querySelector('.bug-fab')?.setAttribute('aria-expanded', 'false');
}

function openBugPanel(fab) {
  closeBugPanel();
  fab.setAttribute('aria-expanded', 'true');
  const c = bugRecorder.counts();
  let picked = bugDraft.categories.slice();

  const send = el('button', { class: 'btn btn-primary btn-sm bug-send', type: 'submit', disabled: '', title: keyHint('Send (⌘Return)') }, 'Send');
  const note = el('textarea', {
    class: 'form-control bug-note', rows: '2', maxlength: '600',
    placeholder: 'What went wrong?',
  });
  note.value = bugDraft.note;
  const sync = () => {
    bugDraft = { note: note.value, categories: picked.slice() };
    send.disabled = !bugCore.canSubmit(picked, note.value);
  };
  note.addEventListener('input', sync);

  const cats = bugCore.CATEGORIES.map((cat) => {
    const btn = el('button', {
      class: 'bug-cat', type: 'button', title: cat.hint,
      'aria-pressed': String(picked.includes(cat.id)), 'data-cat': cat.id,
    }, iconEl(cat.icon, 'bug-cat-icon'), el('span', {}, cat.label));
    btn.classList.toggle('picked', picked.includes(cat.id));
    btn.addEventListener('click', () => {
      picked = bugCore.toggleCategory(picked, cat.id);
      const on = picked.includes(cat.id);
      btn.classList.toggle('picked', on);
      btn.setAttribute('aria-pressed', String(on));
      sync();
      refreshMail();
    });
    return btn;
  });
  sync();

  const mailHref = () => bugCore.mailtoReport({
    categories: picked, note: note.value,
    pathname: location.pathname, hash: location.hash,
    health: state.health ?? {}, userAgent: navigator.userAgent,
    viewport: { w: innerWidth, h: innerHeight }, theme: document.documentElement.dataset.bsTheme ?? 'light',
    lastError: bugRecorder.lastError(),
  });
  const mailLink = el('a', {
    class: 'bug-mail', href: mailHref(),
    title: `Opens your mail app with this report filled in, addressed to ${bugCore.REPORT_MAIL}, sent from your own address`,
  }, iconEl('lucide:mail', 'wv-icon bug-mail-icon'), 'Email instead');
  function refreshMail() { mailLink.href = mailHref(); }
  note.addEventListener('input', refreshMail);

  const form = el('form', { class: 'bug-form' },
    note,
    el('div', { class: 'bug-cats' }, ...cats),
    el('div', { class: 'bug-foot' },
      el('span', { class: 'bug-captured', title: 'Recent routes, clicks, requests and errors — never anything you typed into a field' },
        `${c.actions + c.errors + c.failedRequests} steps captured`),
      el('kbd', { class: 'bug-kbd', title: '⌘Return (Ctrl+Return) sends the report' }, '⌘↵'),
      send),
    el('div', { class: 'bug-mail-row' }, mailLink, el('span', { class: 'bug-addr' }, bugCore.REPORT_MAIL)));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (send.disabled) return;
    send.disabled = true;
    send.textContent = 'Sending…';
    try {
      const filed = await api('POST', '/bug-report', {
        categories: picked,
        note: note.value.trim(),
        events: bugRecorder.events(),
        client: bugCore.clientContext(),
      });
      bugDraft = { note: '', categories: [] };
      send.textContent = 'Sent';
      send.classList.add('sent');
      panel.classList.add('sent');
      toast(`Issue #${filed.publicId}`, false, { label: 'Open', run: () => { location.href = filed.url; } });
      setTimeout(closeBugPanel, 1100);
    } catch (err) {
      send.disabled = false;
      send.textContent = 'Send';
      toast(err.message, true);
    }
  });

  const panel = el('div', { id: 'bug-panel', role: 'dialog', 'aria-label': 'Report a problem' }, form);
  document.body.append(panel);

  const r = fab.getBoundingClientRect();
  panel.style.right = Math.max(8, innerWidth - r.right) + 'px';
  panel.style.bottom = (innerHeight - r.top + 6) + 'px';

  dismissOutside({
    open: () => panel.isConnected,
    inside: (t) => panel.contains(t) || fab.contains(t) || bugCore.canSubmit(picked, note.value),
    close: closeBugPanel,
  });
  addEventListener('keydown', function esc(ev) {
    if (!panel.isConnected) return removeEventListener('keydown', esc);
    if (ev.key === 'Escape') { closeBugPanel(); fab.focus(); removeEventListener('keydown', esc); }
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && panel.contains(ev.target)) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });
  note.focus();
}

initPageLoader();
installBugReporter();
installPhoneBar();
toastLayer();
wireThemeToggle();
wireSkipLink();
wireKeySheet();
withPageLoader(() => loadSchema().then(renderRoute).catch(paintRouteError));
wireSearchButton();
buildWsRail();
wireWsNew();
wireNavCollapse();
