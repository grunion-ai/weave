/* Weave web UI — vanilla JS SPA over the REST API.
   Every writable field and every document field is natively editable in every
   view (table, board, list, entity page). ⌘K opens universal search with
   permalinks. #/map visualizes relations and automations. */
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

/* Tabler-house chevron: stroked, round caps, 24-unit box so it sizes off the
   CSS box rather than a font metric. Text glyphs (▾) cannot match the stroke
   weight of the surrounding chrome — see the nav-caret UAT note in style.css.

   Points RIGHT at rest and is turned down by CSS rotation, never by swapping
   the path: one glyph means the open and closed states cannot drift apart,
   and the turn is animatable. Hairline stroke per Kyle's "Routines ›". */
const chevron = () => svgEl('svg', {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5',
  'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
}, svgEl('path', { d: 'M9 6l6 6l-6 6' }));

// Workspace scoping: the app is served at / (default workspace) and at
// /w/<name>/ for sibling workspaces — one SPA, path-scoped API + permalinks.
const WS_PREFIX = (location.pathname.match(/^\/w\/[^/]+/) ?? [''])[0];

/* Where this browser is. An instant (a date field with zone: instant) is
   stored as UTC and rendered in the reader's zone — the server learns the
   zone from this header and the cell uses it directly. */
const LOCAL_ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
async function api(method, path, body) {
  const res = await fetch(WS_PREFIX + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Weave-Zone': LOCAL_ZONE },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}

// Clipboard with fallback: async API → execCommand → show the text to copy.
async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
    return;
  } catch { /* fall through */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  toast(ok ? label : text, !ok);
}

/* action = { label, run } adds an inline button and holds the toast open long
   enough to use it — the undo affordance for recoverable actions. */
function toast(msg, isErr = false, action = null) {
  // `wv-toast`, not `toast`: Tabler ships `.toast:not(.show){display:none}` —
  // Bootstrap's toast, waiting for JS to reveal it — so weave's hand-rolled
  // toast inherited that switch and every message it raised was invisible
  // (Issue #92, the sibling of the `.empty` collision).
  const t = el('div', { class: 'wv-toast' + (isErr ? ' err' : '') }, msg);
  if (action) {
    t.append(el('button', {
      class: 'wv-toast-action', type: 'button',
      onclick: async () => { t.remove(); await action.run(); },
    }, action.label));
  }
  // One layer, so a second message stacks above the first instead of landing
  // on top of it — invisible toasts could overlap unnoticed, visible ones
  // cannot (Issue #92).
  let layer = document.querySelector('#wv-toasts');
  if (!layer) document.body.append(layer = el('div', { id: 'wv-toasts' }));
  layer.append(t);
  setTimeout(() => t.remove(), action ? 7000 : isErr ? 4200 : 1400);
}

function modal(title, bodyNodes, onSubmit, submitLabel = 'Create') {
  // One dialog at a time: a second open replaces the first instead of stacking
  // another backdrop (and another set of blank inputs) on top of it.
  document.querySelector('#modal-back')?.remove();
  const back = el('div', { id: 'modal-back', onclick: (e) => { if (e.target === back) back.remove(); } });
  const form = el('form', {}, ...bodyNodes,
    el('div', { class: 'actions' },
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
  back.append(el('div', { id: 'modal' }, el('h2', {}, title), form));
  document.body.append(back);
  addEventListener('keydown', function esc(e) {
    if (!back.isConnected) return removeEventListener('keydown', esc);
    if (e.key === 'Escape') { back.remove(); removeEventListener('keydown', esc); }
  });
  const first = form.querySelector('input,select,textarea');
  if (first) first.focus();
}

/* The right-hand tray: the same form contract as modal() (body nodes, an
   onSubmit over FormData, a submit label) in a slide-over that leaves the
   table visible behind it — schema edits are made while looking at the
   data they shape. One tray at a time; Esc or the backdrop closes it.
   Popovers opened from inside it stack above it (.chip-pop z-index). */
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
  /* Feature #132: which rows are chosen, per table. A Set of ENTITY IDS —
     the grid re-sorts on every draw, so a selection keyed on position would
     quietly slide onto different records. */
  selected: new Map() };

// Single entry point for opening an entity. The page IS the destination
// (Feature #117): a row click lands here; the side peek below is kept for
// callers that want a slide-over on top of a page, not as a row target.
function openEntity(id) { location.hash = `#/entity/${id}`; }
/* The row term of a table by id (Feature #40) — for surfaces that hold a
   target id rather than the table. Unknown ids speak the default, "record". */
/* The field that carries a table's row identity — by ROLE (Feature #168: the
   Name field can be renamed), with the literal as the pre-role fallback. */
function nameFieldOf(db) {
  return db?.fields?.find((f) => f.role === 'name') ?? db?.fields?.find((f) => f.name === 'Name');
}
function computedName(db) { return nameFieldOf(db)?.type === 'formula'; }
function termOfTable(id) {
  for (const s of state.schema ?? []) for (const t of s.tables) if (t.id === id) return t.term ?? WeaveTerm.DEFAULT;
  return WeaveTerm.DEFAULT;
}

/* ---------- side peek (Features #39, #48) ----------
   A row opens here first: the entity's fields, editable, in a slide-over —
   the page stays where it is. The breadcrumb # and 'Open' go to the full
   page. One panel at a time; Esc or the backdrop closes it. */

/* ---------- share QR (Feature #50, ha.mr-inspired) ----------
   A share link's natural destination is a phone. lean-qr (the generator
   ha.mr credits) is vendored as an ES module; drawing on a canvas keeps the
   page self-contained. ha.mr's URL compression half is not needed — weave
   has a server, and the wvv_ token IS the short link. */
function qrCanvas(text, scale = 5) {
  const code = window.leanQR?.generate?.(text);
  if (!code) return null;
  const canvas = el('canvas', { class: 'share-qr' });
  const quiet = 4;
  const px = (code.size + quiet * 2) * scale;
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let y = 0; y < code.size; y++) {
    for (let x = 0; x < code.size; x++) {
      if (code.get(x, y)) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
  }
  return canvas;
}

function peekEntity(id) {
  document.querySelector('#peek-back')?.remove();
  const editors = [];
  // Scoped teardown: only what THIS panel mounted. The page underneath may
  // hold its own live editors and decoration layers — a global teardown here
  // would destroy them mid-edit.
  const releasePanel = () => {
    flushDocSaves();
    for (const ed of editors.splice(0)) {
      try { ed.destroy(); } catch { /* already gone with the DOM */ }
      liveEditors.delete(ed);
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
  };
  const close = () => { releasePanel(); back.remove(); };
  const back = el('div', { id: 'peek-back', onclick: (e) => { if (e.target === back) close(); } });
  const panel = el('aside', { id: 'peek' }, el('div', { class: 'peek-body' }, '…'));
  back.append(panel);
  document.body.append(back);
  addEventListener('keydown', function esc(e) {
    if (!back.isConnected) return removeEventListener('keydown', esc);
    if (e.key === 'Escape') { close(); removeEventListener('keydown', esc); }
  });
  const draw = async () => {
    let entity;
    try { entity = await api('GET', `/entities/${id}`); } catch (err) { close(); return toast(err.message, true); }
    releasePanel(); // a redraw replaces everything the last pass mounted
    const body = el('div', { class: 'peek-body' });
    body.append(el('div', { class: 'peek-head' },
      el('span', { style: 'flex:1' }),
      el('button', { class: 'btn btn-sm btn-ghost-secondary', onclick: () => { close(); openEntity(id); } }, 'Open'),
      el('button', { class: 'btn btn-sm btn-ghost-secondary', title: 'Close', onclick: () => close() }, iconEl('✕'))));
    const host = el('div', { class: 'peek-entity' });
    // Any in-panel navigation (crumb, related rows, activity links) moves the
    // page underneath — the panel must not linger over it.
    host.addEventListener('click', (e) => {
      if (e.target.closest('a[href^="#/"], a[href^="#"]:not([href="#"])')) close();
    });
    body.append(host);
    panel.replaceChildren(body); // in the DOM before editors mount
    // The full entity view — the peek is the entity, not a preview of it.
    await renderEntityView(entity, { mount: host, refresh: draw, inPeek: true, onClose: close, editors });
  };
  draw();
}



/* ---------- entity dock (one entity surface) ----------
   The split dock: an entity opens as a second panel BESIDE the table, not
   an overlay over it. public/entity-surface-core.js holds the rules (poses,
   the drill chain, selection-follow); this paints them. The side peek stays
   for callers outside the table view until the dock absorbs them. */
let dock = null; // { db, state, editors }

function markDockedRow() {
  const id = dock ? weaveEntitySurface.selectionId(dock.state) : null;
  for (const tr of document.querySelectorAll('tr.entity-row.row-docked')) tr.classList.remove('row-docked');
  if (id) $(`tr[data-eid="${id}"]`)?.classList.add('row-docked');
}

// Scoped teardown, same discipline as the peek: only what THIS panel
// mounted — the table beside it may hold live editors of its own.
function releaseDockPanel() {
  const panel = $('#dock');
  if (!panel) return;
  flushDocSaves();
  if (dock) {
    for (const ed of dock.editors.splice(0)) {
      try { ed.destroy(); } catch { /* already gone with the DOM */ }
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

/* Tabler's diagonal-arrow pair (MIT, the icon family of the Tabler CSS we
   already vendor): arrows-diagonal points outward = expand, and
   arrows-diagonal-minimize-2 points inward = collapse. Drawn inline like
   eyeGlyph() — 16px stroke-2 reads at crumb-row scale. */
function poseGlyph(expanded) {
  const span = el('span', { class: 'pose-glyph' });
  span.innerHTML = expanded
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 10h-4v-4"/><path d="M20 4l-6 6"/><path d="M6 14h4v4"/><path d="M4 20l6 -6"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4h4v4"/><path d="M14 10l6 -6"/><path d="M8 20h-4v-4"/><path d="M10 14l-6 6"/></svg>';
  return span;
}

/* The two poses live in two mounts of the ONE renderer: split is the dock
   panel, expanded is the classic entity page in #main — same URL, same
   geometry (doc rails, drag reorder, icon scale) as it always had. The
   pose buttons and the crumb bridge them. */
function dockExpand() {
  if (!dock) return;
  const top = dock.state.chain[dock.state.chain.length - 1];
  if (!top) return;
  dockClose();
  location.hash = `#/entity/${top.id}`;
}

/* Collapse: the entity page re-docks beside its table. A direct render plus
   replaceState — a hashchange here would only rebuild the same table. */
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
  releaseDockPanel();
  const panel = $('#dock');
  panel.hidden = true;
  panel.replaceChildren();
  dock = null;
  markDockedRow();
}

async function dockEntity(db, id) {
  const S = weaveEntitySurface;
  const frame = { kind: 'entity', id, tableId: db.id, tableName: db.name };
  const state = dock && dock.db.id === db.id
    ? S.open(dock.state, frame)
    : S.open(S.init({ tableId: db.id, tableName: db.name }), frame);
  dock = { db, state, editors: dock?.editors ?? [] };
  await drawDock();
}

async function drawDock() {
  if (!dock) return;
  const top = dock.state.chain[dock.state.chain.length - 1];
  let entity;
  try { entity = await api('GET', `/entities/${top.id}`); } catch (err) { dockClose(); return toast(err.message, true); }
  releaseDockPanel();
  const panel = $('#dock');
  panel.hidden = false;
  applyDockWidth(panel);
  const host = el('div', { class: 'dock-entity' });
  panel.replaceChildren(
    dockResizeHandle(panel),
    el('div', { class: 'dock-head' },
      el('span', { style: 'flex:1' }),
      el('button', {
        class: 'btn btn-sm btn-ghost-secondary pose-btn', type: 'button',
        title: 'Expand (⌘⇧E)', 'aria-label': 'Expand to the full page',
        onclick: () => dockExpand(),
      }, poseGlyph(false)),
      el('button', {
        class: 'btn btn-sm btn-ghost-secondary', type: 'button',
        title: 'Close (Esc)', 'aria-label': 'Close',
        onclick: () => dockClose(),
      }, iconEl('✕'))),
    host);
  // The full entity view — the dock is the entity, not a preview of it.
  await renderEntityView(entity, { mount: host, refresh: drawDock, inPeek: true, onClose: dockClose, editors: dock.editors });
  markDockedRow();
}

/* The divider. Default is the equal flex split; a drag pins the dock to a
   px width remembered per browser (like grid density and the activity
   side), clamped so neither panel collapses. Double-click clears the pin
   and the halves are equal again. */
const DOCK_MIN = 360;
function applyDockWidth(panel) {
  const px = Number(localStorage.getItem('wv-dock-width'));
  if (px >= DOCK_MIN) { panel.style.width = `${px}px`; panel.style.flex = 'none'; }
  else { panel.style.width = ''; panel.style.flex = ''; }
}
function dockResizeHandle(panel) {
  const grip = el('div', {
    // No tooltip: the hairline on hover says everything (Kyle, 2026-09-02).
    class: 'dock-resize',
    role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the entity pane',
  });
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    document.body.classList.add('dock-resizing');
    const right = panel.getBoundingClientRect().right;
    const roomFor = (want) => {
      // The table keeps at least its own minimum beside the pin.
      const mainLeft = $('#main').getBoundingClientRect().left;
      return Math.min(want, right - mainLeft - 320);
    };
    const move = (ev) => {
      const want = Math.max(DOCK_MIN, roomFor(Math.round(right - ev.clientX)));
      panel.style.width = `${want}px`;
      panel.style.flex = 'none';
    };
    const up = () => {
      document.body.classList.remove('dock-resizing');
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      const px = Math.round(panel.getBoundingClientRect().width);
      localStorage.setItem('wv-dock-width', String(px));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  grip.addEventListener('dblclick', () => {
    localStorage.removeItem('wv-dock-width');
    applyDockWidth(panel);
  });
  return grip;
}

// ⌘⇧E flips the pose: expands a split dock, re-docks an expanded page.
document.addEventListener('keydown', (e) => {
  if (!((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'e' || e.key === 'E'))) return;
  if (dock) { e.preventDefault(); return dockExpand(); }
  if (state.route?.page === 'entity') {
    e.preventDefault();
    api('GET', `/entities/${state.route.id}`).then(collapseToSplit).catch(() => {});
  }
});

// Esc pops the dock one level (core.escape). Cell editors, overlays and
// pickers keep their own Escape; the dock only hears it bare. Every
// overlay app.js raises (a *-back backdrop, a *-pop popover, an open doc
// rail) owns the key while it is up — test/ui-contract.test.mjs derives
// that list from the source and checks this selector covers it.
const DOCK_ESC_OWNERS = '.chip-pop, .cell-pop, .date-pop, .doc-rail.open, #tray-back, #modal-back, #peek-back, #cmdk-back, #fsv-back';
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !dock) return;
  if (document.querySelector(DOCK_ESC_OWNERS)) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const next = weaveEntitySurface.escape(dock.state);
  if (next.pose === 'closed') return dockClose();
  dock.state = next;
  dockApplyPose();
  dockSyncUrl();
  drawDock();
});

function allTables() {
  return state.schema.flatMap((s) => s.tables.map((d) => ({ ...d, space: s.space, spaceId: s.spaceId })));
}

async function loadSchema() {
  state.schema = await api('GET', '/schema');
  renderNav();
}

/* ---------- navigation sidebar ---------- */

// Inline name entry, replacing popup dialogs: Enter commits, Esc cancels.
/* Single-instance inline create field for the sidebar. Only ever one is open:
   clicking "+ New space" (or a space's "+") again — or clicking the other one —
   moves the existing input rather than stacking another blank row. Enter
   commits, Escape or blurring an empty input cancels. */
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
  // An abandoned input should not linger in the nav.
  input.addEventListener('blur', () => { if (!input.disabled && !input.value.trim()) cancel(); });
  requestAnimationFrame(() => input.focus());
  return input;
}

/* The nav row's ⋮ (Kyle, 2026-08-31): the table verbs, right on the row.
   Reuses the house dotsMenu — including its hold-to-delete — and sits inside
   an <a>, so the wrap swallows clicks before the link can navigate. */
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
        // The shared input only cancels an EMPTY blur; a rename starts full,
        // so clicking away must put the row back too.
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
  // Inside the row's <a>: without this, opening the menu also follows the
  // link. Capture phase, because the dots button stops propagation before a
  // bubble listener here would ever run — and preventDefault only cancels the
  // anchor's navigation, never the button handlers themselves.
  wrap.addEventListener('click', (e) => e.preventDefault(), true);
  return wrap;
}

/* Shared view header: breadcrumb with a copyable permalink, an editable
   title, and a markdown description editable in place. Every page uses it
   (entity pages carry the same crumb pattern natively). */

/* One Lucide icon wearing its motion (moving icons, 2026-09-02). The svg's
   parts carry the classes their keyframes need as data-mi; adding them plays
   the icon once, removing them after its run puts it back. Three triggers,
   each a single run, none looping (Kyle: "fire on load but not loop"): mount
   inside the load window, scrolling into a picker grid, and hover. */
const ICON_LOAD_WINDOW_MS = 2500;
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
let iconMountQueue = [];
function lucideEl(name, cls = 'wv-icon') {
  const reg = window.weaveIconRegistry;
  const span = el('span', { class: `${cls} mi mi-${name}`, 'data-ms': String(reg.MOTION[name] || 0) });
  span.innerHTML = window.LUCIDE_MOVING[name];
  // The load wave: icons born while the page is still arriving play once, a
  // beat apart, then rest. A re-render minutes later draws them still.
  if (reg.MOTION[name] && performance.now() < ICON_LOAD_WINDOW_MS) {
    iconMountQueue.push(span);
    if (iconMountQueue.length === 1) {
      requestAnimationFrame(() => {
        const q = iconMountQueue; iconMountQueue = [];
        q.forEach((s, i) => setTimeout(() => { if (s.isConnected) playIcon(s); }, 120 + i * 24));
      });
    }
  }
  return span;
}
document.addEventListener('mouseover', (e) => {
  const host = e.target.closest?.('.mi');
  if (host && !(e.relatedTarget && host.contains(e.relatedTarget))) playIcon(host);
});
/* Grid icons play once as they scroll into view, then rest. */
function playIconsInView(container) {
  const io = new IntersectionObserver((entries) => {
    entries.filter((en) => en.isIntersecting).forEach((en, i) => { io.unobserve(en.target); setTimeout(() => playIcon(en.target), i * 18); });
  });
  container.querySelectorAll('.mi').forEach((m) => io.observe(m));
}

/* An icon value on a space or table: 'lucide:<name>' renders the vendored
   set inline (currentColor — it inherits text color); anything else is
   text, which keeps old emoji icons working (Feature #101). */
function iconEl(icon, cls = 'wv-icon') {
  if (!icon) return null;
  // A mark is stored as its character — '✓', '◔' — and drawn as a vector on
  // the same canvas as the flat set (Issue #87). Rendered as type it took the
  // font's optical size, so a quarter-filled circle came out visibly smaller
  // than the tick beside it. The KEY IS THE CHARACTER: nothing migrates.
  const twin = window.weaveMarkIcons?.twin(icon);
  if (twin) return lucideEl(twin, cls);
  const mark = window.weaveMarkIcons?.markSvg(icon);
  if (mark) {
    const span = el('span', { class: cls });
    span.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">${mark}</svg>`;
    return span;
  }
  // `lucide:<name>` draws the vendored set; `iconly:<name>` — every value
  // stored before 2026-09-02 — resolves through the registry's aliases to its
  // Lucide twin, so nothing stored migrates. A reference that resolves to
  // nothing (a name removed, renamed, or never there) draws a ghost ring with
  // the name in the tooltip: the prefix never reaches the screen. Painting it
  // once printed the literal "iconly:slides" into the icon slot (Kyle,
  // 2026-08-29). A bare string paints itself, which keeps an emoji working.
  const name = window.weaveIconRegistry?.resolve(icon);
  if (name) return lucideEl(name, cls);
  if (name === '') {
    return el('span', {
      class: `${cls} icon-ghost`, title: `${String(icon).replace(/^\w+:/, '')} — this icon is no longer in the set`,
    }, '◌');
  }
  return el('span', { class: cls }, String(icon));
}

/* The one catalogue every icon is picked from — a space, a table, a select
   option, a workflow state (Issue #87). The marks lead, the flat set
   follows; the shape lives in field-dialog-core so it can be reasoned about
   without a browser. */
function iconCatalogue() {
  // Hidden names are dropped from the OFFER, never from the data — a row that
  // stored `arrow-upsquare` still draws it.
  const reg = window.weaveIconRegistry;
  return fieldDialogCore.iconChoices(reg.NAMES, (n) => reg.CATEGORY[n]);
}

/* The icon half of a naming edit: the current icon (or a ghost ring) beside
   the title, opening the one selection dialect over the flat set. */
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

function viewHeader({ crumbs = [], permalink, title, onRename = null, description = null, onSaveDescription = null, actions = [], icon = null, onSetIcon = null }) {
  const box = el('div', { class: 'view-header' });
  const crumbKids = [];
  for (const c of crumbs) {
    crumbKids.push(el('a', { href: c.href }, c.label), ' › ');
  }
  crumbKids.push(el('span', {
    class: 'permalink-copy', title: 'Copy permalink',
    onclick: () => copyText(permalink, 'Permalink copied'),
  }, `${title} ⧉`));
  // The view's controls sit on the crumb line, right-aligned (Kyle,
  // 2026-08-23), leaving the title row to the title.
  box.append(el('div', { class: 'crumb crumb-row' },
    el('span', { class: 'crumb-path' }, ...crumbKids),
    el('span', { class: 'crumb-actions wv-toolbar' }, ...actions.filter(Boolean))));

  const titleInput = el('input', { class: 'view-title', value: title, title: onRename ? 'Click to rename' : '' });
  if (onRename) {
    titleInput.addEventListener('change', async () => {
      const name = titleInput.value.trim();
      if (!name || name === title) { titleInput.value = title; return; }
      try { await onRename(name); toast('Renamed'); } catch (err) { titleInput.value = title; toast(err.message, true); }
    });
  } else {
    titleInput.readOnly = true;
  }
  box.append(el('div', { class: 'wv-toolbar view-title-row' },
    onSetIcon ? iconButton(icon, onSetIcon) : (icon ? iconEl(icon) : null),
    titleInput));

  if (onSaveDescription) {
    const descBox = el('div', { class: 'view-desc' });
    const showRendered = async (md) => {
      descBox.classList.remove('editing');
      if (!md.trim()) {
        descBox.replaceChildren(el('span', { class: 'view-desc-empty' }, 'Add description…'));
        return;
      }
      try {
        const { html } = await api('POST', '/markdown', { md });
        descBox.innerHTML = html;
      } catch {
        descBox.textContent = md;
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
          toast('Saved');
        } catch (err) { toast(err.message, true); }
        showRendered(current);
      };
      ta.addEventListener('blur', save);
      ta.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') ta.blur(); });
      descBox.replaceChildren(ta);
      requestAnimationFrame(() => { ta.focus(); ta.style.height = Math.max(38, ta.scrollHeight) + 'px'; });
    };
    descBox.addEventListener('click', (e) => { if (!e.target.closest('a,textarea')) startEdit(); });
    showRendered(current);
    box.append(descBox);
  }
  return box;
}

function wsHomeHref() {
  return (WS_PREFIX || '') + '/';
}

/* Workspace weight in the units the strip speaks: GB, or TB past 1000 GB.
   A small workspace shows "0.02 GB" rather than switching units downward. */
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
  // The relation map is not a nav row (Kyle, 2026-09-02): the workspace page
  // and every space page draw it in place; the map route still answers deep links.
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
        // A click that would navigate nowhere — the space page is already
        // open — folds/unfolds the tables instead (Issue #72). Navigation
        // keeps ⌘-click and middle-click untouched: only the plain click on
        // the already-open space is repurposed.
        onclick: (e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          if (state.route?.page === 'space' && state.route.spaceId === space.spaceId) {
            e.preventDefault();
            toggleFold(space.spaceId);
          }
        },
      }, iconEl(space.icon, 'wv-icon nav-icon'), space.space),
      // Trails the label, "Routines ›" — the caret reads as part of the space
      // name, not as a gutter control. Open is a rotation of the same glyph.
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
      }, '+'));
    nav.append(spaceRow);
    if (isFolded) continue;
    for (const db of space.tables) {
      // The row's right edge is the kebab, not a count (Kyle, 2026-08-31):
      // hover or the active row shows ⋮, and the menu carries the table verbs.
      const row = el('a', {
        class: 'nav-db' + (state.route?.dbId === db.id ? ' active' : ''),
        href: `#/table/${db.id}`,
      }, iconEl(db.icon, 'wv-icon nav-icon'), db.name);
      // The registry tables take none of these verbs, so they get no kebab.
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
  // The stats strip: what this workspace holds and what it weighs. Count is
  // the same per-table figure the rows above show, summed; size arrives with
  // /api/health (one shared fetch — the instance chip drinks from it too).
  const entityTotal = state.schema.reduce((n, s) => n + s.tables.reduce((m, d) => m + (d.entityCount ?? 0), 0), 0);
  const stats = el('div', { class: 'nav-stats', title: 'Records in this workspace · storage on disk' },
    `${entityTotal.toLocaleString()} ${entityTotal === 1 ? 'record' : 'records'}`);
  // Pinned to the sidebar's bottom edge — a sibling AFTER #nav (which carries
  // flex:1), sticky so a long nav scrolls under it rather than pushing it away.
  document.querySelector('#sidebar .nav-stats')?.remove();
  $('#sidebar').append(stats);
  (state.healthP ??= api('GET', '/health')).then((h) => {
    if (h.sizeBytes != null) stats.append(` · ${fmtSize(h.sizeBytes)}`);
  }).catch(() => {});
  // Instance status (Feature #54): version + uptime from /api/health, so a
  // stale server is visible at a glance instead of masquerading as a broken
  // feature. startedAt arrives with the same payload for tooling to compare.
  nav.append(foot);
  // The instance chip lives in the bottom-right corner of the pane (Kyle,
  // 2026-08-22) — out of the nav, always visible, never in the way.
  if (!document.querySelector('.nav-health')) {
    const status = el('div', { class: 'nav-health', title: 'This weave instance' }, '…');
    (state.healthP ??= api('GET', '/health')).then((h) => {
      const up = h.uptime == null ? '' : ` · up ${h.uptime < 3600 ? Math.round(h.uptime / 60) + 'm' : Math.round(h.uptime / 3600) + 'h'}`;
      status.textContent = `v${h.version}${up}`;
      if (h.startedAt) status.title = `This weave instance — started ${h.startedAt}`;
    }).catch(() => { status.textContent = 'offline'; });
    document.body.append(status);
  }
}

/* ---------- shared value rendering ---------- */

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

/* A state's chip text: its icon, when it has one, then the name. A flat icon
   has no text form, so in a text-only context the name stands alone rather
   than dragging 'iconly:activity' along with it (Issue #87). */
const isIconRef = (v) => /^(lucide|iconly):/.test(String(v ?? ''));
function stateLabel(fieldSchema, stateName) {
  if (stateName == null) return '—';
  const icon = fieldSchema.states?.find((s) => s.name === stateName)?.icon;
  return icon && !isIconRef(icon) ? `${icon} ${stateName}` : stateName;
}
/* The same label as nodes, for the chip itself: a flat icon has to be drawn,
   not spelled (Issue #87). The picker's list keeps the string above, because
   that is what its search ranks against. */
function stateNodes(fieldSchema, stateName) {
  if (stateName == null) return ['—'];
  const icon = fieldSchema.states?.find((s) => s.name === stateName)?.icon;
  if (!icon) return [stateName];
  return isIconRef(icon)
    ? [iconEl(icon, 'ico wv-icon'), stateName]
    : [`${icon} ${stateName}`];
}
function stateCategory(fieldSchema, stateName) {
  const found = fieldSchema.states?.find((s) => s.name === stateName)?.category;
  // A state stored under the retired 'other' category still has to render, so
  // it lands on the default rather than on a class with no rule behind it.
  return found ? chipCore.categoryOrDefault(found) : 'not-started';
}

/* A state chip: its tier, its category, and the hue that category owns.
   Category keeps the colour because status has to mean the same thing in
   every table — it is the one part of the ramp an author cannot repaint. */
function stateChipClass(fieldSchema, stateName, bare = false) {
  const cat = stateCategory(fieldSchema, stateName);
  return `${bare ? '' : 'k '}k-state cat-${cat} hue-${chipCore.categoryHue(cat)}`.trim();
}

/* weave has no person type yet — a colleague is a relation to whatever table
   holds people — so person-ness is read off the target table's name. When a
   real flag lands this is the one function that changes. */
const PERSON_TABLE = /^(people|persons?|members?|users?|contacts?|owners?|team|staff|employees?)$/i;
function relationIsPerson(f) {
  const table = String(f?.targetDb ?? '').split('/').pop() ?? '';
  return PERSON_TABLE.test(table.trim());
}
/* Initials on a hue hashed from the name, so the same colleague is the same
   colour in every table with nothing to configure. */
function personAvatar(f, target) {
  if (!relationIsPerson(f)) return null;
  const name = target?.name ?? '';
  if (!name) return el('span', { class: 'av unknown' }, '?');
  return el('span', { class: `av hue-${chipCore.hueForName(name)}` }, chipCore.initialsFor(name));
}

function documentFields(db) {
  return db.fields.filter((f) => f.type === 'document');
}

/* The description, by the role the schema marks — never by the name, which is
   Kyle's to change (2026-08-27). Null once he deletes it. */
function descriptionFieldOf(db) {
  return db?.fields?.find((f) => f.type === 'document' && f.role === 'description') ?? null;
}


/* What this table is to the slide composer (Feature #118): a table with a
   many-relation named Slides is a deck, a table with a Model document is a
   slide. The same convention the server composes on, read off the schema so
   the entity view knows whether to frame a deck before asking for one. */
function deckRoleOf(db) {
  if (!db?.fields) return null;
  const isSlideTable = (t) => !!t?.fields?.some((f) => f.name === 'Model' && f.type === 'document');
  const slides = db.fields.find((f) => f.name === 'Slides');
  if (slides?.type === 'relation' && slides.many
    && isSlideTable(allTables().find((t) => t.id === slides.targetDbId))) return 'deck';
  if (isSlideTable(db)) return 'slide';
  return null;
}

// First lines of an entity's default document, flattened for view previews.

// Lazy mermaid: load the vendored lib only when a preview contains a diagram.
let mermaidLoading = null;


/* ---------- expand a document (Feature #47) ----------
   Expanding is not fullscreen: the document takes the entity body — fields,
   comments, activity step aside — while the nav and breadcrumbs stay where
   they are. Collapse (or Esc, even with the cursor in the frame) brings the
   body back. The document's own fullscreen (a deck's F) is its to ask for. */
function expandDocument(grid, url, title, { node = null } = {}) {
  grid.parentElement?.querySelector('.doc-expand')?.remove();
  /* A markdown document expands as ITSELF: the live editor node moves into
     the overlay and moves home on collapse — one editor, nothing to sync,
     still saving as you type (Kyle, 2026-08-23: "md should be editable in
     fullscreen mode as well"). Only an HTML app document keeps the rendered
     frame, because the frame IS that document. */
  const origin = node?.parentElement ?? null;
  const frame = node ? null : el('iframe', { class: 'doc-expand-frame', src: url, allowfullscreen: '', allow: 'fullscreen', title });
  const collapse = () => { if (node && origin) origin.append(node); wrap.remove(); grid.classList.remove('hidden'); };
  const wrap = el('div', { class: 'doc-expand' + (node ? ' doc-expand-edit' : '') },
    el('div', { class: 'doc-expand-bar' },
      el('button', { class: 'btn btn-sm', title: 'Collapse (Esc)', onclick: collapse }, '‹ Collapse'),
      el('span', { class: 'fsv-title' }, title),
      el('span', { style: 'flex:1' }),
      node ? null : el('button', { class: 'btn btn-sm', title: 'Refresh', onclick: () => { try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; } } }, iconEl('⟳')),
      node ? null : el('a', { class: 'btn btn-sm', href: url, target: '_blank', title: 'Open in a browser tab' }, '↗')),
    node ?? frame);
  grid.classList.add('hidden');
  grid.after(wrap);
  const onKey = (e) => { if (e.key === 'Escape') collapse(); };
  addEventListener('keydown', function esc(e) {
    if (!wrap.isConnected) return removeEventListener('keydown', esc);
    onKey(e);
  });
  frame.addEventListener('load', () => {
    try { frame.contentWindow.addEventListener('keydown', onKey); } catch { /* cross-origin: the bar still collapses */ }
  });
  return wrap;
}

/* ---------- fullscreen viewer (Feature #47) ----------
   Any URL weave serves, full-viewport, without leaving the app: an in-tree
   dialog hosting an iframe with its own back/refresh — mention links inside
   keep navigating in-frame (#27), and Esc brings you home. Also the host for
   the whiteboard (#46), which fills the frame slot with a canvas instead. */
function fullscreenViewer(title, { url = null, mount = null } = {}) {
  document.querySelector('#fsv-back')?.remove();
  const frame = url ? el('iframe', { class: 'fsv-frame', src: url, allowfullscreen: '', allow: 'fullscreen' }) : null;
  // Closing leaves real fullscreen too, if we got it; leaving real fullscreen
  // (Esc, the browser's own control) closes the viewer — one state, not two.
  const close = () => back.remove();
  // Back means back: the frame's own history when it has one, home when it
  // does not — a fresh frame has nowhere to go but out.
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
      url ? el('a', { class: 'btn btn-sm', href: url, target: '_blank', title: 'Open in a browser tab' }, '↗') : null,
      el('button', { class: 'btn btn-sm', title: 'Close (Esc)', onclick: close }, iconEl('✕'))),
    frame ?? el('div', { class: 'fsv-body' }));
  document.body.append(back);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  addEventListener('keydown', function esc(e) {
    if (!back.isConnected) return removeEventListener('keydown', esc);
    onKey(e);
  });
  // Keys land in the frame once it has focus; a same-origin frame lets us
  // listen there too, so Esc works wherever the cursor is.
  frame?.addEventListener('load', () => {
    try { frame.contentWindow.addEventListener('keydown', onKey); } catch { /* cross-origin: the bar still closes */ }
  });
  if (mount) mount(back.querySelector('.fsv-body'));
  return back;
}

/* ---------- whiteboard (Feature #46) ----------
   A mermaid diagram, but alive: parsed to nodes/edges (graph-parse.js) and
   handed to vendored cytoscape — pan, zoom, drag the nodes around. View
   state only: nothing writes back to the document. */
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
          { selector: 'node', style: { label: 'data(label)', shape: 'round-rectangle', 'background-color': box, 'border-color': line, 'border-width': 1, color: fg, 'font-size': 13, 'text-valign': 'center', 'text-halign': 'center', width: 'label', height: 'label', padding: '10px' } },
          { selector: 'node.diamond', style: { shape: 'diamond', padding: '18px' } },
          { selector: 'node.circle', style: { shape: 'ellipse', padding: '14px' } },
          { selector: 'edge', style: { label: 'data(label)', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'line-color': line, 'target-arrow-color': line, color: fg, 'font-size': 11, width: 1.5 } },
        ],
        wheelSensitivity: 0.2,
      });
      // The dialog was appended this frame: cytoscape measured a container
      // the layout engine had not sized yet, and drew into a corner. One
      // frame later the box is real — measure again, then frame the graph.
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
    s.onerror = () => resolve(); // fall back to visible source
    document.head.append(s);
  });
  for (const pre of nodes) {
    // The source dies when mermaid replaces it — stash it, and give every
    // diagram its whiteboard handle (#46).
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

/* ---------- universal field editor ---------- */

/* In-app chip picker: replaces native <select> popups (which can't be
   styled and clash with the chip aesthetic — weave Issue #9). options:
   [{name, cls}], current = selected name. */
/* Anchored popover shared by the chip picker and the header field menu:
   flips above the trigger when it would overflow, closes on outside click or
   Escape, and never leaves two popovers open at once. */
function showPopover(trigger, rows) {
  document.querySelector('.chip-pop')?.remove();
  const pop = el('div', { class: 'chip-pop' }, ...rows);
  document.body.append(pop);
  const r = trigger.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = (r.bottom + 4 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 4 : r.bottom + 4) + 'px';
  const close = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('click', close, true); } };
  addEventListener('click', close, true);

  /* Keyboard: arrows move, Enter/Space commit (native <button> behaviour),
     Escape closes and hands focus back, Tab closes and carries on along the
     row — so a record can be filled in without touching the mouse. */
  const opts = [...pop.querySelectorAll('.chip-pop-row')];
  const focusAt = (i) => opts[((i % opts.length) + opts.length) % opts.length].focus();
  pop.addEventListener('keydown', (ev) => {
    const i = opts.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); focusAt(i + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); focusAt(i - 1); }
    else if (ev.key === 'Escape') { ev.preventDefault(); pop.remove(); trigger.focus(); }
    else if (ev.key === 'Tab') pop.remove();
  });
  // Open on the current value when there is one, otherwise the first option.
  const checked = opts.findIndex((o) => o.querySelector('.chip-pop-check'));
  if (opts.length) focusAt(checked < 0 ? 0 : checked);

  // A pick redraws the grid and destroys this cell's control; remember where
  // we were so focus can be put back on the replacement.
  const cell = trigger.closest?.('tr[data-eid] > td');
  state.refocus = cell
    ? { eid: cell.parentElement.dataset.eid, col: [...cell.parentElement.children].indexOf(cell) }
    : null;
  return pop;
}

/* Press-and-hold destructive action: the button fills over ~900ms and fires
   only when the fill completes; letting go early cancels. The confirmation is
   the gesture, so there is no window.confirm() dialog to break the page's
   design. Keyboard users hold Enter or Space, which works the same way.

   `rowClass` lets the caller hand it the row metric of the surface it lands
   in — a hold button inside the chip popover has to BE a .chip-pop-row or it
   wears Tabler's padding beside weave's and falls outside the arrow-key walk
   (Kyle, 2026-08-27). `icon` draws through the one icon path (Issue #87)
   rather than a character typed into the label, and `hint` is the quiet
   trailing chip that says the gesture out loud — a hold nobody knows about
   is a button that does nothing. */
function holdToConfirm(label, onConfirm, {
  holdingLabel = 'Hold to confirm…', rowClass = 'dropdown-item', icon = null, hint = null,
} = {}) {
  const fill = el('span', { class: 'hold-fill' });
  const text = el('span', { class: 'hold-label' }, label);
  const btn = el('button', { class: `${rowClass} text-danger hold-btn`, type: 'button' },
    fill, icon ? iconEl(icon, 'wv-icon wv-menu-icon hold-icon') : null, text,
    hint ? el('span', { class: 'hold-hint' }, hint) : null);
  let armed = false;
  let press = 0; // which press a queued confirm belongs to — a re-press must not inherit it
  const start = (e) => {
    if (armed) return;
    armed = true;
    press++;
    // Capture the pointer (Kyle, 2026-09-02): a release must cancel no matter
    // where the cursor drifted to — without capture, pointerup lands on
    // whatever is under the cursor and the hold runs on to completion.
    if (e?.pointerId != null) { try { btn.setPointerCapture(e.pointerId); } catch { /* gone mid-press */ } }
    btn.classList.add('holding');
    text.textContent = holdingLabel;
  };
  const stop = () => {
    armed = false;
    btn.classList.remove('holding');
    text.textContent = label;
  };
  btn.addEventListener('pointerdown', start);
  // pointercancel and lostpointercapture are the releases the finger never
  // gets to send — a touch turning into a scroll, a native drag starting.
  // Missing them left the hold armed with no release event ever coming.
  for (const ev of ['pointerup', 'pointerleave', 'blur', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, stop);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } });
  btn.addEventListener('keyup', stop);
  // Fires once the fill finishes sweeping across. Collapsing is untransitioned,
  // so releasing early cannot trigger it. The sweep is a scaleX transform, not
  // an animated width — width/height animations thrash layout on every frame.
  fill.addEventListener('transitionend', (e) => {
    if (!armed || e.propertyName !== 'transform') return;
    // The sweep runs on the compositor, so it completes on schedule even when
    // the main thread is behind on delivering the pointerup — and this
    // handler would then fire a hold the user had already released. A short
    // grace lets any queued release land first; re-check that THIS press is
    // still armed (a release-and-re-press inside the grace is a new press,
    // not a finished one), then commit.
    const thisPress = press;
    setTimeout(async () => {
      if (!armed || press !== thisPress) return;
      stop();
      await onConfirm();
    }, 80);
  });
  return btn;
}

/* Put focus back on the cell that triggered a redraw (see showPopover). */
function restoreGridFocus() {
  const want = state.refocus;
  state.refocus = null;
  if (!want) return;
  requestAnimationFrame(() => {
    const td = $(`tr[data-eid="${want.eid}"]`)?.children[want.col];
    td?.querySelector('button,input,select')?.focus();
  });
}


/* ---------- the one selection dialect (Kyle, 2026-08-22; token box 08-25) ----------
   Everything that picks from a list — workflow states, select options, field
   types, relation targets, formats — opens the SAME surface: a panel whose
   first line is a box holding the chips already chosen and, right after them,
   the cursor. Type and the list beneath filters with the top fit already
   armed, so Enter adds it; ↑↓ move that arming; ← → walk the chips and
   Backspace/Delete takes one out; Enter on an empty search saves. Anchored to
   its trigger when it has one, centered otherwise.

   multi (multiselect, linked records) accumulates chips and commits the set.
   single (select, workflow states) overwrites — a pick commits and closes on
   the spot — and `clearId` is the empty value Backspace picks for a field
   that has one (a select does; a workflow state does not).
   The keyboard grammar itself is pure and lives in public/picker-core.js. */
function searchPicker({ anchor = null, title = '', placeholder = 'Search…', options, currentId = null, onPick, multi = null, clearId = null, grid = false }) {
  document.querySelector('.chip-pop')?.remove();
  const core = globalThis.pickerCore;
  // A grid is the icon picker: a value stored as iconly:<name> rings the cell
  // its Lucide twin sits in, since that is the icon it draws.
  if (grid) currentId = window.weaveIconRegistry?.canonical(currentId) ?? currentId;
  let st = core.blank({
    mode: multi ? 'multi' : 'single',
    options,
    staged: multi ? multi.selected.map((x) => ({ ...x })) : [],
    currentId,
    clearId,
  });
  const input = el('input', { class: 'picker-search', placeholder, type: 'text' });
  // Chips are their own element so redrawing them never detaches the focused
  // input; display:contents keeps them in the box's own flex row.
  const chips = el('span', { class: 'picker-chips' });
  const box = el('div', { class: 'picker-box' }, chips, input);
  const list = el('div', { class: 'picker-list' });
  const pop = el('div', { class: 'chip-pop picker-pop' },
    title ? el('div', { class: 'picker-title' }, title) : null,
    box, list);
  const commit = async () => { pop.remove(); await multi.onCommit(core.ids(st)); };
  const dismiss = () => { pop.remove(); anchor?.focus?.(); };
  const pick = async (o) => { pop.remove(); await onPick(o); };
  const apply = (next) => { st = next; input.value = st.query; drawChips(); draw(); input.focus(); };

  const drawChips = () => {
    // A grid shows the current icon as a ring on its own cell, so staging it
    // as a chip says the same thing twice and takes the search box with it —
    // an unset icon put a "No icon" chip in the field (Kyle, 2026-08-29).
    if (grid) {
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
      }, '×') : null)));
    // The placeholder is the empty box's label; chips take its place.
    input.placeholder = st.staged.length ? '' : placeholder;
  };
  /* The list draws exactly what core.visible() says is in it — in a multi
     picker that is the options NOT already chipped in the box (Issue #64), so
     no row wears a ✓ there and nothing the arrows land on can un-pick. A
     single picker still ticks its current value: picking there overwrites.
     The first nine rows carry their number, which is what ⌥1–⌥9 takes. */
  /* Icons draw as a grid, not a list (Kyle, 2026-08-29). A name beside every
     icon is a column you read instead of a set you scan, and 119 of them was
     a very long column. The name still does its work: it is what the search
     matches and it is the tooltip. Categories are the only labels, and a
     heading leaves with its icons. Nothing is numbered — ⌥1–9 is for a list
     you read down, not a field you aim at. */
  const drawGrid = () => {
    const vis = core.visible(st);
    const groups = fieldDialogCore.iconGroups(vis);
    const clear = vis.find((o) => !o.id);
    const cell = (o, extra = '') => el('button', {
      class: `picker-cell${extra}` + (o.id === currentId ? ' on' : ''), type: 'button',
      title: o.label, 'aria-label': o.label,
      onclick: async () => { await pick(o); },
    }, o.lucide ? iconEl(`lucide:${o.lucide}`) : iconEl(o.mark) ?? el('span', { class: 'wv-icon icon-ghost' }, '◌'));
    // Clearing is the FIRST cell, not a footer (Kyle, 2026-08-29): setting an
    // icon back to none is the same gesture as setting it to anything else,
    // and it is the one people reach for after a mistake.
    list.replaceChildren(
      ...(clear ? [el('div', { class: 'picker-cells' }, cell(clear, ' picker-none'))] : []),
      ...groups.flatMap((g) => [
        el('div', { class: 'picker-cat' }, g.name),
        el('div', { class: 'picker-cells' }, ...g.items.map((o) => cell(o))),
      ]));
    if (!groups.length && !clear) list.append(el('div', { class: 'picker-empty' }, 'No matches'));
    playIconsInView(list);
  };
  const draw = () => {
    if (grid) return drawGrid();
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
    // An empty list means two different things, and saying "No matches" to
    // someone who has simply chosen everything is a lie.
    if (!vis.length) {
      list.append(el('div', { class: 'picker-empty' },
        multi && st.staged.length && !st.query.trim() ? 'Everything is chosen' : 'No matches'));
    }
  };
  // Clicking the box's empty space is aiming at the caret, not at a chip.
  box.addEventListener('click', (ev) => {
    if (ev.target !== box && ev.target !== chips) return;
    apply({ ...st, caret: null });
  });
  input.addEventListener('input', () => { st = core.search(st, input.value); drawChips(); draw(); });
  input.addEventListener('keydown', async (ev) => {
    // Where the text caret sits decides whether ← belongs to the text or to
    // the chips in front of it.
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    // ⌥1–⌥9 takes the numbered row. The physical key is what counts: with
    // Option down, ev.key is the character the chord types (⌥1 is `¡`), and a
    // bare digit has to stay a digit — the box is a search field.
    const quick = ev.altKey && /^Digit[1-9]$/.test(ev.code) ? Number(ev.code.slice(5)) : null;
    const r = core.keyDown(st, { key: ev.key, atStart, quick });
    if (!r.handled) return;
    ev.preventDefault();
    if (r.state) { st = r.state; input.value = st.query; drawChips(); draw(); }
    if (!r.effect) return;
    if (r.effect.type === 'pick') await pick(r.effect.option);
    else if (r.effect.type === 'close') dismiss();
    else if (multi) await commit();
    else dismiss();
  });
  document.body.append(pop);
  if (anchor?.getBoundingClientRect) {
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = (r.bottom + 4 + pop.offsetHeight > innerHeight ? Math.max(8, r.top - pop.offsetHeight - 4) : r.bottom + 4) + 'px';
  } else {
    pop.classList.add('picker-centered');
  }
  const close = (ev) => {
    if (pop.contains(ev.target)) return;
    removeEventListener('click', close, true);
    if (multi && pop.isConnected) { commit(); return; }
    pop.remove();
  };
  addEventListener('click', close, true);
  // The mandate: the cursor is already in the box, after the chips.
  input.focus();
  drawChips();
  draw();
  return pop;
}

/* The same dialect as a FORM control: looks like a select, opens the picker,
   carries its value in a hidden input so FormData and change listeners keep
   working. Returns the wrapper; `.input` is the hidden input to read/listen. */
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

/* Where a remote keystore keeps the credential. Mirrors the engine's
   credentialLink() — test/credential-chip.test.mjs pins the two together, so
   a new keystore cannot land on one side only. */
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

/* The one control in weave that takes a secret out of the vault.

   It lives on the entity page and nowhere else — a grid draws hundreds of
   cells and none of them should be one press away from a credential. Copy is
   the primary path because a value on the clipboard never lands on a screen
   somebody else is looking at; the server treats copy and show as the same
   act and logs both, so the softer path is not the quieter one. A refusal is
   shown as written: the reason a credential is closed is the useful part.
   (Feature #143.) */
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
      // Back behind the mask on its own, so a screen left open does not keep
      // showing it. Re-pressing costs another audited reveal, which is right.
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

/* Field-type groupings the row/cell chrome keys off.
   PICKER: the cell's whole area opens a chooser. READONLY: computed values
   that render as text and must not look editable. */
const PICKER_FIELD_TYPES = ['select', 'multiselect', 'workflow'];
const READONLY_FIELD_TYPES = ['lookup', 'rollup', 'formula', 'document'];

/* Credentials (Feature #143). The glyph says what SORT of secret the chip
   stands for; the badge says whose store holds it. Both are read off the
   field's config — the cell itself holds only a name, here as everywhere. */
const CREDENTIAL_GLYPHS = { apikey: '✱', token: '⌘', password: '•••', id: '⛉', pair: '⚯' };
const CREDENTIAL_KIND_LABELS = {
  apikey: 'API key', token: 'token', password: 'password', id: 'protected id', pair: 'id + secret pair',
};
const KEYSTORE_LABELS = {
  local: 'this workspace’s keystore', '1password': '1Password', 'aws-sm': 'AWS',
  'google-sm': 'Google', cloudflare: 'Cloudflare', 'apple-passwords': 'Apple Passwords',
};

// Inline glyph marking how a read-only value is produced.
function computedMark(type) {
  return { formula: 'ƒ', rollup: 'Σ', lookup: '↗', document: '¶', field: '⌗' }[type] ?? '·';
}

/* The same glyph, riding the field NAME. A formula column is not typeable, and
   that fact belongs on its heading rather than being discovered by clicking a
   cell that does not respond. Returns children for el(), which flattens. */
const COMPUTED_NAME_MARKS = { formula: 'formula', rollup: 'rollup', lookup: 'lookup' };
function fieldNameLabel(f, text = f?.name) {
  const kind = COMPUTED_NAME_MARKS[f?.type];
  if (!kind) return [text];
  return [text, el('sup', {
    class: 'field-mark',
    title: `${kind} — computed from other values, not editable`,
  }, computedMark(f.type))];
}

/* A click landed on a picker cell's padding rather than its control: forward
   it to the control. Chip pickers open on click; a native <select> opens its
   own dropdown (showPicker where supported, focus as the fallback). */
function openCellPicker(cell) {
  const trigger = cell.querySelector('.chip-trigger');
  if (trigger) return trigger.click();
  const sel = cell.querySelector('select');
  if (!sel) return;
  sel.focus();
  try { sel.showPicker?.(); } catch { /* not user-activated — focus is enough */ }
}

/* ---------- Ledger: a click raises the field's own editor ----------
   The grid shows values at rest, so aiming at a cell has to produce the
   control that field type actually uses — a picker for a select, the record
   search for a relation, a caret for text — rather than a generic input the
   reader then has to find. Which one is the pure half, in editor-lib.js.
   A click that already landed ON a control is left alone: the browser has
   put the caret where the reader aimed, which is better than any guess. */
function activateCell(cell) {
  switch (globalThis.WeaveEditorLib.cellActivation(cell.dataset.ftype)) {
    case 'none': return;
    case 'toggle': {
      const box = cell.querySelector('input[type="checkbox"]');
      if (box) { box.checked = !box.checked; box.dispatchEvent(new Event('change')); }
      return;
    }
    case 'open-picker': return (cell.querySelector('.chip-trigger') ?? cell.querySelector('.ms-box'))?.click();
    case 'open-button': return cell.querySelector('button')?.click();
    default: {
      const input = cell.querySelector('input, select');
      if (!input) return;
      input.focus();
      // Placing the cursor is the point — a bare focus() leaves a text input
      // with everything selected in some browsers and nothing in others.
      const end = String(input.value ?? '').length;
      try { input.setSelectionRange(end, end); } catch { /* number/date reject it */ }
    }
  }
}

/* ---------- Ledger: a capped column says what it is hiding ----------
   A cell whose value does not fit shows a marker and, on hover, the whole
   value — as a COPY in an overlay layer over the grid. The cell itself is
   never touched: rewriting its box to expand in place would move every
   column beside it (Kyle, 2026-08-24). The layer hangs off .table-wrap,
   which scrolls with the grid and does not clip like the cell does. */
function cellPopLayer(wrap) {
  let layer = wrap.querySelector(':scope > .cell-pop-layer');
  if (!layer) { layer = el('div', { class: 'cell-pop-layer' }); wrap.append(layer); }
  return layer;
}

/* The type a cell sets, carried onto the copy. The clone lands OUTSIDE the
   <td>, so every rule scoped to a cell — `td.name-cell .inline-edit` sets the
   leading column at 15px/600 — stops matching it, and the value changed size
   at the moment you hovered it to read it (Issue #67). Same technique as
   cellFitProbe() below: read the computed value, write it on the clone. */
const CELL_TYPE_PROPS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
  'letterSpacing', 'lineHeight', 'color', 'textAlign'];
function copyCellType(src, dst) {
  const cs = getComputedStyle(src);
  for (const p of CELL_TYPE_PROPS) dst.style[p] = cs[p];
}
/* Where a box's content actually starts — the element it holds, or, for a
   cell that is nothing but text, the text itself. Padding and borders differ
   between a cell and the popover, so the boxes cannot be aligned; the
   CONTENT can. */
function contentRect(node) {
  if (node.firstElementChild) return node.firstElementChild.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(node);
  const r = range.getBoundingClientRect();
  return r.width || r.height ? r : node.getBoundingClientRect();
}
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
  // A copy, so the live cell keeps its controls and its place in the row.
  for (const node of td.childNodes) pop.append(node.cloneNode(true));
  copyCellType(td, pop);
  const src = td.querySelectorAll('*');
  const clones = pop.querySelectorAll('*');
  for (let i = 0; i < clones.length && i < src.length; i++) copyCellType(src[i], clones[i]);
  layer.replaceChildren(pop);
  /* The expansion opens OVER the value, not beside it (Kyle, 2026-08-26): the
     cell pads 9px/4px, the popover 8px/10px over a border, and the cell
     centres its line in a row taller than one line — so pinning the two boxes
     together put the value 8px right and 22px high, and reading a cell moved
     the thing you were reading. Measure both after layout and close the gap. */
  const want = contentRect(td);
  const got = contentRect(pop);
  pop.style.left = `${left + (want.left - got.left)}px`;
  pop.style.top = `${top + (want.top - got.top)}px`;
}

function hideCellPop(wrap) {
  wrap.querySelector(':scope > .cell-pop-layer')?.replaceChildren();
}

/* Clipped is measured, never assumed: a value that fits gets no marker, so
   the marker always means there is more to see. */
function markClippedCells(grid) {
  for (const td of grid.querySelectorAll('tbody td')) {
    // A description holds lines the row has no height for; they are in the
    // cell, hidden, and only the pop can show them. Width alone would call
    // that cell unclipped and the rest of the description would never be
    // reachable, so having more than one line counts as clipped too.
    const hasHiddenLines = td.querySelectorAll('.doc-preview-line').length > 1;
    td.classList.toggle('clipped', td.scrollWidth > td.clientWidth + 1 || hasHiddenLines);
  }
}

/* ---------- Ledger: density ----------
   Comfortable or Compact, per table and per person — a way of reading the
   table rather than a property of it, so it lives beside the doc-fold state
   in localStorage rather than in the table's schema. */
function gridDensity(dbId, next) {
  const key = `weave-grid-density:${dbId}`;
  if (next === undefined) {
    try { return localStorage.getItem(key) === 'compact' ? 'compact' : 'comfortable'; }
    catch { return 'comfortable'; }
  }
  try { localStorage.setItem(key, next); } catch { /* private mode */ }
  return next;
}

// Row click → 'ignore' (a control handled it), the picker cell, or null (open).
/* The Workspace registries, as the schema describes them. kind is the
   engine's system marker: 'spaces' | 'tables' | 'fields'. */
function registryTable(kind) {
  for (const sp of state.schema) {
    if (sp.system !== 'workspace') continue;
    const db = sp.tables.find((t) => t.system === kind);
    if (db) return db;
  }
  return null;
}

/* A registry row stands for a piece of structure; opening it opens the
   structure — the space or the table, which IS the entity of the workspace
   (Kyle, 2026-08-24). Ordinary rows open their entity page as ever. */
function registryHref(db, item) {
  if (db.system === 'tables' && item.sysId) return `#/table/${item.sysId}`;
  if (db.system === 'spaces' && item.sysId) return `#/space/${item.sysId}`;
  return null;
}

function openRegistryRow(db, item) {
  const href = registryHref(db, item);
  if (href) { location.hash = href; return true; }
  return false;
}

function rowClickTarget(e) {
  if (e.target.closest('input,select,textarea,button,a,label,.ms-box,.chip')) return 'ignore';
  return e.target.closest('.cell-pick');
}

/* The ⋮ overflow menu, one implementation for every view that has one.
   items: {label, href, download} for a link, {label, run, danger} for a
   button, {hold: label, run} for a hold-to-confirm, or 'divider'.
   align 'right' hangs the panel off the right edge — the table and space
   menus sit at the end of the header toolbar, where left-aligning would
   push the panel off-screen. */
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
      class: 'dropdown-item' + (it.danger ? ' text-danger' : ''), type: 'button',
      onclick: async () => { close(); await it.run(); },
    }, it.label));
  }
  const wrap = el('span', { class: `dl-wrap ${extraClass}`.trim() },
    el('button', {
      class: 'btn btn-sm btn-ghost-secondary dots-btn', title, type: 'button',
      onclick: (e) => {
        e.stopPropagation();
        const opening = menu.classList.contains('hidden');
        // One menu at a time, and clicking anywhere else closes it.
        for (const m of document.querySelectorAll('.dl-menu')) m.classList.add('hidden');
        if (!opening) return;
        menu.classList.remove('hidden');
        addEventListener('click', function away(ev) {
          if (wrap.contains(ev.target)) return;
          close();
          removeEventListener('click', away);
        });
      },
    }, '⋮'),
    menu);
  return wrap;
}

/* A text value is markdown when tokenizing it finds a mark — cheaper to ask
   the tokenizer than to keep a second grammar in sync with it. */
function hasInlineMarkup(text) {
  return globalThis.WeaveEditorLib.inlineTokens(text, inlineIconAccept).some((t) => t.mark);
}

const INLINE_TAG = { strong: 'strong', em: 'em', code: 'code', strike: 's', link: 'span', ref: 'span' };
/* Which `:token:` is an icon (Kyle, 2026-09-02): a name in the set draws as
   `lucide:<name>`, a drawn mark draws as itself; anything else stays literal.
   The tokenizer and the chip layer both ask this, so there is one answer. */
function inlineIconAccept(token) {
  if (window.weaveIconRegistry?.resolve(`lucide:${token}`)) return `lucide:${token}`;
  return window.weaveMarkIcons?.has(token) ? token : null;
}

/* One line of markdown painted into one node: the marks as marks, the syntax
   gone. Shared by the text costume and the description preview so there is a
   single place the browser turns tokens into elements. */
function dressTokens(into, tokens) {
  for (const t of tokens) {
    if (t.mark === 'icon') { into.append(iconEl(t.icon, 'wv-icon md-icon')); continue; }
    const cls = t.mark === 'link' ? 'md-link' : t.mark === 'ref' ? 'md-ref' : null;
    into.append(t.mark ? el(INLINE_TAG[t.mark], cls ? { class: cls } : {}, t.text) : t.text);
  }
  return into;
}

/* The costume: marks painted, syntax gone, and one click back to the source.
   Focus follows the click so typing continues where it was aimed. */
function dressedText(md, input) {
  const tokens = globalThis.WeaveEditorLib.inlineTokens(md, inlineIconAccept);
  // The tooltip is the whole value the cell had to ellipsise — as prose, for
  // the same reason the cell is: nobody wants to read markers in a tooltip.
  const dressed = el('span', { class: 'text-dressed', tabindex: 0, title: tokens.map((t) => t.text).join('') });
  dressTokens(dressed, tokens);
  dressed.addEventListener('click', (e) => {
    e.stopPropagation();
    dressed.replaceWith(input);
    input.focus();
  });
  input.addEventListener('blur', () => { if (input.isConnected) input.replaceWith(dressed); });
  return dressed;
}

function editorFor(f, item, db, onSaved, { compact = false } = {}) {
  const id = item.id;
  const val = item.fields[f.name];
  const saved = async () => {
    const fresh = await api('GET', `/entities/${id}`);
    toast('Saved');
    onSaved(fresh);
  };
  const patch = async (value) => {
    try {
      await api('PATCH', `/entities/${id}`, { values: { [f.name]: value } });
      await saved();
    } catch (err) { toast(err.message, true); }
  };

  // An option's colour is a name from the ten-hue ramp, not a loose hex —
  // chip-core.js reads the stored hex back as one, so an option that predates
  // the ramp keeps exactly the colour it had. Uncoloured rests on slate.
  function optionHue(field, name) {
    const o = (field.optionsFull ?? []).find((x) => x.name === name);
    return `hue-${chipCore.hueFromHex(o?.color)}`;
  }
  // The glyph an option wears, if its author gave it one.
  function optionIcon(field, name) {
    const ico = (field.optionsFull ?? []).find((x) => x.name === name)?.icon;
    return ico ? iconEl(ico, 'ico wv-icon') : null;
  }

  if (READONLY_FIELD_TYPES.includes(f.type) && f.type !== 'document') {
    // Read-only: the glyph says "computed, not editable" at a glance so these
    // are not mistaken for the chips and inputs beside them.
    const box = el('span', { class: 'computed k k-computed', title: `${f.type} — read-only` },
      el('span', { class: 'computed-mark' }, computedMark(f.type)), fieldValueCell(val) || '—');
    if (!compact) box.append(el('span', { class: 'wv-tag' }, f.type));
    return box;
  }
  if (f.type === 'workflow') {
    return chipPicker({
      trigger: el('button', { class: stateChipClass(f, val), type: 'button', title: f.name }, ...stateNodes(f, val)),
      options: f.states.map((s) => ({ name: s.name, cls: stateChipClass(f, s.name, true), label: stateLabel(f, s.name) })),
      current: val,
      onPick: async (name) => {
        try {
          await api('POST', `/entities/${id}/state`, { field: f.name, state: name });
          await saved();
        } catch (err) { toast(err.message, true); }
      },
    });
  }
  if (f.type === 'select') {
    return chipPicker({
      trigger: el('button', { class: `k k-select ${optionHue(f, val)}`, type: 'button', title: f.name },
        optionIcon(f, val), val ?? '—'),
      options: [{ name: '—' }, ...f.options.map((o) => ({ name: o }))],
      current: val ?? null,
      clearId: '—',
      onPick: (name) => patch(name === '—' ? null : name),
    });
  }
  if (f.type === 'multiselect') {
    const current = Array.isArray(val) ? val : [];
    const box = el('span', { class: 'ms-box', title: 'Edit selections' });
    for (const v of current) box.append(el('span', { class: `k k-multi ${optionHue(f, v)}` }, optionIcon(f, v), v), ' ');
    if (!current.length) box.append(el('span', { class: 'k k-add' }, '+'));
    chipPickerMulti({
      trigger: box,
      options: f.options.map((o) => ({ id: o, label: o, chip: true })),
      selected: current.map((v) => ({ id: v, label: v })),
      onCommit: (ids) => patch(ids),
    });
    return box;
  }
  if (f.type === 'key') {
    /* A credential is generated, not typed. It reads as a value chip in slate
       and in the monospace an identifier deserves — the identity treatment the
       row's own #41 ↗ already gets. (Feature: chip system, 2026-08-24.)
       Since #143 the chip also says WHICH sort of credential and WHOSE store,
       because "✱✱✱✱ acme-portal" alone left a reader guessing whether the
       secret was here, in 1Password, or nowhere yet. The grid never reveals:
       the mask is the whole point of the cell. */
    const kind = f.kind ?? 'apikey';
    const store = f.keystore ?? 'local';
    /* The engine masks the value as `✱✱✱✱ name` for surfaces with no glyph —
       CLI, CSV, export. The chip HAS a glyph, and wearing both read as
       "✱✱✱✱✱ stripe-live" (or "•••✱✱✱✱ …" once kinds arrived), so the text
       mask comes off here and the glyph carries it alone. */
    const shown = String(fieldValueCell(val) ?? '').replace(/^✱+\s*/, '');
    const chip = el('span', {
      class: 'k k-key hue-slate',
      title: `${f.name} — ${CREDENTIAL_KIND_LABELS[kind] ?? kind} in ${KEYSTORE_LABELS[store] ?? store}`,
    }, el('span', { class: 'ico' }, CREDENTIAL_GLYPHS[kind] ?? '✱'), shown || '—');
    if (store !== 'local' && val) chip.append(el('span', { class: 'store' }, KEYSTORE_LABELS[store]));
    /* The NAME, not the dressed cell. `val` arrives masked and may carry
       ' (unset)', and posting that to /reveal asked the keystore for a
       credential called '✱✱✱✱ stripe-live'. item.raw is the undressed value,
       which is what every other editor here already reaches for. */
    const ref = item?.raw?.[f.name] ?? null;
    if (compact || !ref) return chip;
    // A local credential the keystore does not hold yet has nothing to reveal;
    // offering the buttons would promise a secret that is not there.
    if (store === 'local' && /\(unset\)$/.test(String(val ?? ''))) return chip;
    // The entity page IS the edit surface, so it is where taking the secret
    // out belongs — the same split the relation chip's × makes.
    return el('span', { class: 'cred-cell' }, chip, credentialReveal(ref, store));
  }
  if (f.type === 'checkbox') {
    const cb = el('input', { type: 'checkbox', class: 'form-check-input', onchange: () => patch(cb.checked) });
    cb.checked = !!val;
    return cb;
  }
  if (f.type === 'relation') {
    const box = el('span', { class: 'ms-box' });
    const all = val == null ? [] : Array.isArray(val) ? val : [val];
    // In the grid a cell is nowrap and used to clip whatever did not fit. Show
    // the first few and hand the rest to a count that opens the cell popover,
    // so the row says how much it is not showing.
    const CAP = 3;
    const current = compact && all.length > CAP ? all.slice(0, CAP) : all;
    const hidden = all.length - current.length;
    for (const s of current) {
      /* The whole chip is the link — avatar, name, and the ↗ that promises
         it goes somewhere. The mark used to be a ::after on the chip, i.e.
         OUTSIDE the <a>, so the one pixel advertising navigation was the one
         pixel that did nothing (Kyle, 2026-08-26). */
      const chip = el('span', { class: 'k k-rel' },
        el('a', { href: `#/entity/${s.id}`, onclick: (e) => e.stopPropagation() },
          personAvatar(f, s), s.name || `#${s.publicId}`,
          /* A target-set chip says where it lives — a Task and a Space can
             share a name, and the table is the disambiguator. */
          f.targetDbIds && s.db ? el('span', { class: 'k-home' }, s.db.split('/').pop()) : ''));
      /* Unlinking is an edit, and a grid is a record: in a table the × was
         chrome on every chip of every row. The cell's picker owns removal
         there; the entity page keeps its × because the page IS the edit
         surface (Kyle, 2026-08-26). */
      if (!compact) {
        chip.append(el('span', {
          class: 'x',
          onclick: async () => {
            try {
              await api('POST', `/entities/${id}/unlink`, { field: f.name, targets: [s.id] });
              await saved();
            } catch (err) { toast(err.message, true); }
          },
        }, '×'));
      }
      box.append(chip, ' ');
    }
    if (hidden > 0) {
      box.append(el('span', {
        class: 'k k-more', title: `${hidden} more — open the cell to see them`,
      }, `+${hidden}`), ' ');
    }
    box.append(el('button', {
      class: 'btn btn-sm btn-ghost-secondary tiny',
      onclick: async (e2) => {
        const btn = e2?.currentTarget ?? null;
        /* A target-set field draws candidates from every member table, each
           option wearing its home table so a Task and a Space with the same
           name stay tellable apart. */
        const targets = f.targetDbIds
          ? f.targetDbIds.map((tid) => allTables().find((d) => d.id === tid)).filter(Boolean)
          : [allTables().find((d) => d.qualified === f.targetDb || `${d.space}/${d.name}` === f.targetDb)];
        const lists = await Promise.all(targets.map((t) => api('POST', `/tables/${t.id}/query`, { select: ['Name'] })));
        const options = targets.flatMap((t, i) => lists[i].items.map((o) => ({
          id: o.id, label: o.name || '(unnamed)',
          hint: f.targetDbIds ? `${t.qualified} · #${o.publicId}` : `#${o.publicId}`,
        })));
        const before = current.map((sm) => sm.id);
        searchPicker({
          anchor: btn, title: `${f.name}`, placeholder: `Search ${termOfTable(f.targetDbId).plural}…`,
          options,
          multi: {
            selected: current.map((sm) => ({ id: sm.id, label: sm.name || '(unnamed)' })),
            onCommit: async (ids) => {
              const add = ids.filter((x) => !before.includes(x));
              const drop = before.filter((x) => !ids.includes(x));
              if (!add.length && !drop.length) return;
              if (add.length) await api('POST', `/entities/${id}/link`, { field: f.name, targets: add });
              if (drop.length) await api('POST', `/entities/${id}/unlink`, { field: f.name, targets: drop });
              await saved();
            },
          },
        });
      },
    }, '+ link'));
    return box;
  }
  if (f.type === 'document') {
    // The description reaches its cell as prose; every other document as the
    // named chip wearing its kind (Kyle, 2026-08-31 — one field, one column).
    if (f.role === 'description') return docPreviewCell(item.docs?.[f.name], f.name, () => peekEntity(id));
    return docChipCell(f, item, () => peekEntity(id));
  }
  if (f.type === 'field') {
    // A field definition. In compact surfaces (grid, board, list) the value
    // reads as a sentence and editing happens on the entity page — same
    // reason as document: the generic text fallback would render an editable
    // box that can only ever produce an invalid definition. On the entity
    // page the chip opens the definition editor: the entity page IS the
    // control surface (Feature #85, design option D).
    // `val` (item.fields) is the engine's display sentence — 'select · 3
    // options'; the definition itself rides in item.raw.
    const def = item.raw?.[f.name] ?? null;
    const chip = el('span', { class: 'computed k k-computed', title: compact ? `field definition — edit on the ${db?.term?.singular ?? 'record'} page` : 'field definition — click to edit' },
      el('span', { class: 'computed-mark' }, computedMark('field')),
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
      // Clearing lives HERE, beside the definition it would take, and behind a
      // held gesture (Issue #90). The bare `×` this replaces sat on the row at
      // the same weight as the chip that merely opens this editor, so a click
      // meant to find out what it did destroyed a definition that has no copy
      // anywhere. What the clear takes, it offers straight back.
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
        // The server validates through the same normaliser addField uses, so
        // an invalid definition is refused with its real reason — and the
        // dialog stays open to fix it (patch() would swallow the throw).
        await api('PATCH', `/entities/${id}`, { values: { [f.name]: { type: String(fd.get('type')), config } } });
        await saved();
      }, 'Save');
    };
    return el('span', { class: 'fielddef-edit' }, chip);
  }
  // Attachments (Feature #16): the value is file ids; the cell shows names,
  // the entity page manages the list — upload lands blob and column together.
  if (f.type === 'attachments') {
    const ids = item.raw?.[f.name] ?? [];
    const chip = el('span', { class: 'k k-attach' + (ids.length ? '' : ' is-empty'), title: 'attachments' },
      el('span', { class: 'ico' }, iconEl('lucide:file', 'wv-icon')),
      ids.length ? String(val ?? `${ids.length}`) : '—');
    if (compact) return chip;
    const box = el('span', { class: 'attach-box' });
    const files = (item.files ?? []).filter((x) => ids.includes(x.id));
    for (const file of files) {
      box.append(el('span', { class: 'attach-item' },
        el('a', { href: `${WS_PREFIX}/api/files/${file.id}`, target: '_blank' }, file.name),
        el('button', {
          class: 'btn btn-sm btn-ghost-secondary tiny', title: 'Remove from this field',
          onclick: () => patch(ids.filter((x) => x !== file.id)),
        }, '×')));
    }
    const input = el('input', { type: 'file', style: 'display:none' });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await api('POST', `/entities/${id}/fields/${encodeURIComponent(f.name)}/files`, {
            name: file.name, mime: file.type || 'application/octet-stream',
            bytes: String(reader.result).split(',')[1],
          });
          await saved();
        } catch (err) { toast(err.message, true); }
      };
      reader.readAsDataURL(file);
    });
    box.append(input, el('button', {
      class: 'btn btn-sm btn-ghost-secondary tiny', title: 'Upload a file into this field',
      onclick: () => input.click(),
    }, '+ file'));
    return box;
  }
  // Type-or-pick dates (Feature #44): one control that is both a text input
  // ('next friday', 'jun 21' — parsed by nl-date.js) and a native calendar.
  if (f.type === 'date') {
    return dateControl({
      value: item.raw?.[f.name] ?? '', costume: f,
      placeholder: 'today, 15 sep, 9/15/26…', onChange: (iso) => patch(iso),
    });
  }
  /* A range is two of the same control (Issue #91). The generic text
     fallback painted the stored `{ start, end }` as '[object Object]' and
     could only ever hand the server a string it must refuse, so a range
     edits end by end and commits once both ends read as dates. */
  if (f.type === 'daterange') {
    const cur = item.raw?.[f.name] ?? null;
    const range = { start: cur?.start ?? '', end: cur?.end ?? '' };
    const opts = { costume: f };
    if (compact) {
      // Rendered here, not from the server's string: an instant reads in
      // this browser's zone, and the costume is the field's own.
      return el('span', { class: 'k k-range' + (cur ? '' : ' is-empty'), title: `date range — edit on the ${db?.term?.singular ?? 'record'} page` },
        cur ? weaveDateCore.formatDateRange(range, { ...f, viewerZone: LOCAL_ZONE }) : '—');
    }
    const commit = () => {
      // Half a range is not a range: the server refuses one end, so an
      // unfinished edit stays in the box until the other end lands.
      if (range.start && range.end) patch({ ...range });
      else if (!range.start && !range.end) patch(null);
    };
    return el('span', { class: 'range-box' },
      dateControl({ ...opts, value: range.start, placeholder: 'start', onChange: (iso) => { range.start = iso ?? ''; commit(); } }),
      el('span', { class: 'range-sep' }, '–'),
      dateControl({ ...opts, value: range.end, placeholder: 'end', onChange: (iso) => { range.end = iso ?? ''; commit(); } }));
  }
  const rawVal = item.raw?.[f.name] ?? val;
  /* A percent field stores the fraction and talks to people in percent
     (Issue #127): the box shows 32.5 for a stored 0.325 and typing 50
     stores 0.5 — the number in the box is the number in the "32.5%" the
     cell shows at rest. Rounding strips float noise both ways. */
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
  // Space and table descriptions are markdown living in a text field. A grid
  // that paints them raw reads `**Official docs** — the pages`, so the cell
  // wears the marks and hands over the source on click (the #97 pattern).
  if (f.type === 'text' && typeof rawVal === 'string' && hasInlineMarkup(rawVal)) {
    return dressedText(rawVal, input);
  }
  // A formatted number (#97) shows its costume at rest — '30 days' — and
  // hands over the raw number the moment it is clicked.
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

/* ---------- the description, as its first few lines (Kyle, 2026-08-27) ----
   "it should always show a preview of the properly formatted first few lines,
   not an md document chip." The chip said the field was there; the preview
   says what it says.

   The row holds one line, because a row holds one line: a comfortable row is
   48px and a compact one 34px, and Kyle drove those numbers down himself on
   2026-08-26. The rest of the budget rides along in the same cell, hidden,
   and showCellPop's cloneNode copy reveals it on hover — so "the first few
   lines" arrive without the grid growing to hold them.

   A document that is not prose is named, not flattened: docPreview hands back
   a label for an HTML app, a JSON model or a mermaid diagram, and the cell
   wears it as the chip's kind rather than pretending a doctype is a sentence.
   Clicking opens the side peek, never an inline input — a document is not
   edited in a cell (Issue #74). */
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

/* ---------- a document cell, as a chip (Kyle, 2026-08-24 → 2026-08-31) ----
   One chip per document field: its name, and the kind of thing it holds —
   the kind the field DECLARES when it declares one, the sniffed kind
   otherwise — with an empty one labelled as empty rather than lying. The
   chips used to crowd a shared Docs cell; each now sits in its own field's
   column, so it hides, resizes and reorders like any value. */
function docChipCell(f, item, onOpen) {
  const kind = globalThis.WeaveEditorLib.docChipKind(f.kind, item.docs?.[f.name]);
  return el('button', {
    class: 'k k-doc doc-chip' + (kind ? '' : ' is-empty'),
    type: 'button',
    title: kind ? `Open ${f.name} (${kind})` : `${f.name} is empty — click to write it`,
    onclick: (e) => { e.stopPropagation(); onOpen(); },
  }, f.name, el('span', { class: 'doc-kind' }, kind ?? 'empty'));
}


/* ---------- trash ----------
   Deleted rows keep their public id and links, so this reads as the table it
   came from, minus the editing: each row can only go back (restore) or away
   for good (purge, hold-to-confirm — it is the one irreversible action). */

async function showTrash(dbId) {
  const db = allTables().find((d) => d.id === dbId);
  if (!db) return showHome();
  state.route = { page: 'trash', dbId };
  renderNav();
  const { items } = await api('GET', `/tables/${db.id}/trash`);
  const main = $('#main');
  main.replaceChildren();
  main.append(viewHeader({
    crumbs: [
      { label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() },
      { label: db.space, href: `#/space/${db.spaceId}` },
      { label: db.name, href: `#/table/${db.id}` },
    ],
    permalink: `${location.origin}${WS_PREFIX}/#/trash/${db.id}`,
    title: `${db.name} — trash`,
  }));

  if (!items.length) {
    main.append(el('div', { class: 'card panel empty-note' }, 'Nothing in the trash.'));
    return;
  }
  const rows = el('tbody');
  for (const item of items) {
    rows.append(el('tr', {},
      el('td', { class: 'pid-cell' }, `#${item.publicId}`),
      el('td', {}, item.name || el('span', { class: 'view-desc-empty' }, 'Untitled')),
      el('td', { class: 'trash-when' }, new Date(item.deletedAt).toLocaleString()),
      el('td', { class: 'trash-acts' },
        el('button', {
          class: 'btn btn-sm', type: 'button',
          onclick: async () => {
            try {
              await api('POST', `/entities/${item.id}/restore`);
              toast('Restored');
              await loadSchema(); // the nav's row counts moved
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
  main.append(el('div', { class: 'card table-wrap' },
    el('table', { class: 'table table-sm table-vcenter card-table wv-grid' },
      el('thead', {}, el('tr', {},
        el('th', { class: 'pid-head' }, '#'), el('th', {}, 'Name'),
        el('th', {}, 'Deleted'), el('th', {}, ''))),
      rows)));
}

/* ---------- table views ---------- */


/* ---------- filters (Feature #38) ----------
   Per-table workflow-state filters. Table truth since 2026-08-28: the
   selection lives on the table itself and mirrors to the Tables registry
   row's Filter field, so every browser — and the row — shows the same
   filter. The selection drives the ENGINE's where-language over POST /query
   — the grid never filters client-side. */
function tableFilters(db) {
  return db.filters ?? {};
}
async function setTableFilters(db, filters) {
  await api('PATCH', `/tables/${db.id}`, { filters });
  await loadSchema();
}
function filterWhere(db) {
  const active = tableFilters(db);
  const conds = Object.entries(active)
    .filter(([field, states]) => states?.length && db.fields.some((f) => f.name === field && f.type === 'workflow'))
    .map(([field, states]) => [field, 'in', states]);
  return conds.length ? conds : undefined;
}
function filterStrip(db, onChange) {
  const wfFields = db.fields.filter((f) => f.type === 'workflow');
  if (!wfFields.length) return null;
  const active = tableFilters(db);
  const strip = el('div', { class: 'filter-strip' });
  for (const f of wfFields) {
    const row = el('span', { class: 'filter-group' },
      el('span', { class: 'filter-label' }, f.name));
    for (const st of f.states) {
      const on = (active[f.name] ?? []).includes(st.name);
      row.append(el('button', {
        class: `filter-chip cat-${st.category}${on ? ' on' : ''}`,
        onclick: async () => {
          const cur = new Set(active[f.name] ?? []);
          cur.has(st.name) ? cur.delete(st.name) : cur.add(st.name);
          const next = { ...active };
          if (cur.size) next[f.name] = [...cur]; else delete next[f.name];
          await setTableFilters(db, next);
          onChange();
        },
      }, st.name));
    }
    strip.append(row);
  }
  if (Object.keys(active).length) {
    strip.append(el('button', {
      class: 'btn btn-sm btn-ghost-secondary tiny',
      onclick: async () => { await setTableFilters(db, {}); onChange(); },
    }, 'Clear'));
  }
  return strip;
}

async function showDatabase(dbId, view) {
  const db = allTables().find((d) => d.id === dbId);
  if (!db) return showHome();
  // The board view is gone (Kyle, 2026-08-25, Issue #75) the way the list
  // view went before it: stale #/… routes and saved views that say 'board'
  // land on the table.
  void view;
  state.route = { page: 'db', dbId, view: 'table' };
  renderNav();
  // public/ is served from disk while the server process is long-lived, so a
  // page can be newer than the routes behind it (git pull without a restart).
  // The trash badge is decoration — it must never keep the table from opening.
  const where = filterWhere(db);
  const [result, trash] = await Promise.all([
    api('POST', `/tables/${db.id}/query`, where ? { where } : {}),
    api('GET', `/tables/${db.id}/trash`).catch(() => ({ total: 0, items: [] })),
  ]);
  // The eyeball's "show deleted": trashed rows ride along, dimmed, in place.
  const items = state.showDeleted.has(db.id)
    ? [...result.items, ...(trash.items ?? []).map((e) => ({ ...e, deleted: true }))]
    : result.items;
  drawDatabase(db, items, trash.total);
}

function drawDatabase(db, items, trashCount = 0) {
  const main = $('#main');
  main.replaceChildren();

  main.append(viewHeader({
    crumbs: [
      { label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() },
      { label: db.space, href: `#/space/${db.spaceId}` },
    ],
    permalink: `${location.origin}${WS_PREFIX}/#/table/${db.id}`,
    title: db.name,
    icon: db.icon,
    onSetIcon: async (icon) => {
      await api('PATCH', `/tables/${db.id}`, { icon: icon ?? '' });
      await loadSchema();
      showDatabase(db.id, state.route.view);
    },
    onRename: async (name) => {
      await api('PATCH', `/tables/${db.id}`, { name });
      await loadSchema();
      drawDatabase(allTables().find((d) => d.id === db.id), items, trashCount);
    },
    description: db.description,
    onSaveDescription: async (md) => {
      await api('PATCH', `/tables/${db.id}`, { description: md });
      await loadSchema();
    },
    actions: [
      // Only surfaced once the table actually has deleted rows — an empty
      // trash is not worth a permanent control.
      // The eyeball (Feature #114): show / hide fields, system columns and
      // deleted rows — replaces "Manage fields".
      (() => {
        const eye = el('button', { class: 'btn btn-sm eye-btn', title: 'Show / hide fields and deleted rows', 'aria-label': 'Show or hide fields' }, eyeGlyph());
        eye.addEventListener('click', (e) => { e.stopPropagation(); fieldVisibilityPopover(eye, db, trashCount); });
        return eye;
      })(),
      // How tall a row reads at (Kyle, 2026-08-24). A way of reading the
      // table, so it is a control in the toolbar and a per-person memory —
      // not schema, and not something the next reader inherits.
      segCtl(
        [{ id: 'comfortable', label: 'Comfortable', title: 'Roomy rows, for reading' },
          { id: 'compact', label: 'Compact', title: 'Short rows, for scanning' }],
        gridDensity(db.id),
        (mode) => {
          gridDensity(db.id, mode);
          const grid = document.querySelector('.wv-grid');
          if (grid) { grid.dataset.density = mode; markClippedCells(grid); }
        },
      ),
      // Export and delete are occasional and one of them is irreversible, so
      // they live in the overflow rather than the toolbar.
      dotsMenu([
        { label: 'Export CSV', href: `${WS_PREFIX}/api/tables/${db.id}/export.csv`, download: `${db.name}.csv` },
        'divider',
        // A saved view is this table + these filters, named (Feature #17).
        {
          label: 'Save as view…',
          run: () => modal('Save view', [
            el('input', { name: 'name', placeholder: 'View name', class: 'form-control full' }),
          ], async (fd) => {
            const where = filterWhere(db);
            await api('POST', '/views', { name: fd.get('name'), blocks: [{ table: db.id, ...(where ? { where } : {}) }] });
            toast('View saved — find it on the workspace page');
          }, 'Save'),
        },
        'divider',
        // What a row is called (Feature #40) is Name-field config — the same
        // dialog every other field opens, reached from here as a shortcut.
        {
          label: `Row term (${db.term.singular})…`,
          run: () => editFieldDialog(db, nameFieldOf(db)),
        },
        // System columns live behind the eye (Feature #114), not here.
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
      ], { title: 'Table actions', align: 'right' }),
    ],
  }));

  const strip = filterStrip(db, () => showDatabase(db.id, state.route.view));
  if (strip) main.append(strip);

  const onSaved = async () => {
    const w2 = filterWhere(db);
    const fresh = await api('POST', `/tables/${db.id}/query`, w2 ? { where: w2 } : {});
    drawDatabase(db, fresh.items);
    restoreGridFocus();
  };

  // Inline add: create an empty entity, redraw, focus its Name cell.
  state.inlineAdd = async () => {
    const created = await api('POST', `/tables/${db.id}/entities`, { name: '' });
    await loadSchema();
    const fresh = await api('POST', `/tables/${db.id}/query`, {});
    drawDatabase(db, fresh.items);
    requestAnimationFrame(() =>
      $(`tr[data-eid="${created.id}"]`)?.querySelector('td:nth-child(2) input')?.focus());
  };

  renderTable(main, db, items, onSaved);
}

/* Show / hide, one list: the table's fields, then the system columns, then
   the deleted rows. A tick toggles and the list reopens; hidden fields and
   shown system columns persist on the table (PATCH), deleted-row display
   is a session switch. */
/* A flat eye, drawn inline so it takes the text color (no emoji). */
function eyeGlyph() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = '<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  return svg;
}

function fieldVisibilityPopover(anchor, db, trashCount = 0, { redraw = null, rowsSection = true } = {}) {
  const hidden = new Set(db.hiddenFields ?? []);
  const sysOn = new Set(db.systemFields ?? []);
  const save = async (patch) => {
    try {
      await api('PATCH', `/tables/${db.id}`, patch);
      await loadSchema();
      const fresh = allTables().find((d) => d.id === db.id);
      // The entity page opens this too (Feature #117): it redraws itself.
      redraw ? await redraw() : await keepScroll(() => showDatabase(db.id, state.route.view));
      const again = document.querySelector('.eye-btn');
      if (again) fieldVisibilityPopover(again, fresh, trashCount, { redraw, rowsSection });
    } catch (err) { toast(err.message, true); }
  };
  // Each row is a toggle switch: the whole row flips it.
  const row = (on, label, run) => el('button', {
    class: 'chip-pop-row eye-row', type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false',
    onclick: (e) => { e.stopPropagation(); run(); },
  }, el('span', { class: 'eye-label' }, label), el('span', { class: 'switch' + (on ? ' on' : '') }, el('span', { class: 'switch-knob' })));
  const rows = [
    el('div', { class: 'eye-head' }, 'Fields'),
    ...db.fields.map((f) => row(!hidden.has(f.name), f.name, () => {
      const next = new Set(hidden);
      if (next.has(f.name)) next.delete(f.name); else next.add(f.name);
      save({ hiddenFields: [...next] });
    })),
    el('div', { class: 'eye-head' }, 'System'),
    ...Object.keys(SYSTEM_COLS).map((n) => row(sysOn.has(n), n, () => {
      const next = new Set(sysOn);
      if (next.has(n)) next.delete(n); else next.add(n);
      save({ systemFields: [...next] });
    })),
    ...(rowsSection ? [
      el('div', { class: 'eye-head' }, 'Rows'),
      row(state.showDeleted.has(db.id), `Deleted ${db.term.plural}${trashCount ? ` (${trashCount})` : ''}`, () => {
        if (state.showDeleted.has(db.id)) state.showDeleted.delete(db.id); else state.showDeleted.add(db.id);
        document.querySelector('.chip-pop')?.remove();
        keepScroll(() => showDatabase(db.id, state.route.view));
      }),
    ] : []),
  ];
  showPopover(anchor, rows);
}

/* The columns a table shows: every field, minus the table's hidden set (the
   eyeball, Feature #114). reorderField mirrors this.

   Documents are columns like everything else (Kyle, 2026-08-31): the
   description previews its first lines (2026-08-27), every other document is
   its named chip with a kind badge — and each resizes, hides and reorders
   like every other field. The shared Docs cell they used to fold into is
   gone. */
function visibleCols(db) {
  const hidden = new Set(db.hiddenFields ?? []);
  return db.fields.filter((f) => !hidden.has(f.name)).map((f) => f.name);
}

function renderTable(main, db, items, onSaved) {
  const cols = visibleCols(db);
  // Header bar = checkbox + id + one per field + the "+" field control.
  // Full-width rows span it, so it is derived once rather than restated per
  // call site.
  const colCount = cols.length + 3;
  // Sort is table truth (2026-08-28): read from the schema, written back on
  // change, mirrored to the Tables registry row's Sort field. The grid still
  // sorts locally for the instant redraw; the PATCH makes it survive.
  let sortKey = db.sort?.[0]?.field ?? null, sortDir = db.sort?.[0]?.dir === 'desc' ? -1 : 1;
  const wrap = el('div', { class: 'card table-wrap' });

  /* ---------- Feature #132: row selection ----------
     The Puck won the five-bars study (Kyle, 2026-08-24). This is the layer
     underneath it: a set of chosen ids, a checkbox column left of the # link,
     and a header box that reads none / some / all.

     One departure from that spec, forced by Ledger landing the same evening:
     the mockup had a bare row click toggle the row, but Ledger's one rule is
     that a bare row click raises THAT CELL's editor. Two meanings for one
     gesture is one too many, so the checkbox owns selection outright and
     shift extends from the last box hit. */
  const SEL = () => globalThis.WeaveSelection;
  const chosen = () => state.selected.get(db.id) ?? new Set();
  let anchor = null;                       // the last box hit, for shift-range
  // Read off the DOM rather than off `sorted`: what shift-click means is
  // "everything between these two rows ON SCREEN", which is the drawn order.
  const drawnIds = () => [...wrap.querySelectorAll('tbody tr.entity-row')].map((r) => r.dataset.eid);

  /* Painting is deliberately not a redraw: a redraw would tear down whatever
     editor the reader has open in a cell of the row they are selecting. */
  const paintSelection = () => {
    const sel = chosen();
    const table = wrap.querySelector('.wv-grid');
    if (!table) return;
    for (const row of table.querySelectorAll('tbody tr.entity-row')) {
      const on = sel.has(row.dataset.eid);
      const box = row.querySelector('.sel-box');
      if (box) box.checked = on;
      // Selected rows carry the accent tint alone — Kyle took the leading
      // accent stripe out on the second pass.
      row.classList.toggle('row-selected', on);
    }
    const head = table.querySelector('thead .sel-box');
    if (head) {
      const st = SEL().headState(sel.size, table.querySelectorAll('tbody tr.entity-row').length);
      head.checked = st === 'all';
      head.indeterminate = st === 'some';
    }
    // While anything is chosen the whole column stays lit, so the reader can
    // work down it without hunting for a box that only exists under the mouse.
    if (sel.size) table.dataset.selecting = 'on'; else delete table.dataset.selecting;
    // The bar floats over the grid, so the grid grows a floor while one is up
    // — otherwise the puck covers the last row it is acting on.
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

  /* ---------- the puck ----------
     Direction 2 of the five-bars study, chosen by Kyle on 2026-08-24: icon
     only, hover labels, a count in an accent pill, and trash past a hairline.
     It floats over the bottom of the grid and rises 14px on appear.

     Only commands this release can actually RUN reach it. A designed-but-
     unbuilt button reads as broken rather than forthcoming, so `BUILT` is the
     gate and it grows as slice 3 lands. */
  const BUILT = ['dup', 'trash'];
  const CMD_ICON = { fields: 'lucide:pencil', link: 'lucide:arrow-left-right', dup: '⧉', more: 'lucide:ellipsis', trash: 'lucide:trash-2' };
  const puck = el('div', { class: 'sel-puck-wrap' });

  const runOnSelection = async (verb, each) => {
    const ids = [...chosen()];
    const failed = [];
    for (const id of ids) {
      try { await each(id); } catch { failed.push(id); }
    }
    // What did NOT land is the part worth saying. A bulk command that half
    // works and reports success is how a row goes missing quietly.
    if (failed.length) toast(`${verb}: ${failed.length} of ${ids.length} failed`, true);
    else toast(`${verb} ${SEL().countLabel(ids.length, db.term)}`);
    clearChosen();
    await onSaved?.();
  };

  const COMMANDS = {
    dup: () => runOnSelection('Duplicated', async (id) => {
      const row = await api('GET', `/entities/${id}`);
      const values = { ...row.fields };
      // Computed fields are reads, not values — writing one back is an error,
      // and the copy recomputes them anyway.
      for (const f of db.fields) {
        if (READONLY_FIELD_TYPES.includes(f.type) || f.type === 'document') delete values[f.name];
      }
      await api('POST', `/tables/${db.id}/entities`, { values });
    }),
    trash: () => runOnSelection('Moved to trash', (id) => api('DELETE', `/entities/${id}`)),
  };

  const drawPuck = () => {
    const sel = chosen();
    if (!sel.size) { puck.replaceChildren(); return; }
    const L = SEL();
    const cmds = L.barCommands({
      relations: db.fields.filter((f) => f.type === 'relation').map((f) => f.name),
      writableFields: db.fields.filter((f) => !READONLY_FIELD_TYPES.includes(f.type)).map((f) => f.name),
      built: BUILT,
    });
    puck.replaceChildren(el('div', { class: 'sel-puck glass' },
      el('span', { class: 'sel-count' }, L.countLabel(sel.size, db.term)),
      ...cmds.map((c) => [
        // Trash is past a hairline: it is the one command on the bar that
        // takes rows away, and it should not sit flush against Duplicate.
        c.danger ? el('span', { class: 'sel-sep' }) : null,
        el('button', {
          class: 'sel-act' + (c.danger ? ' danger' : ''), type: 'button',
          title: c.label, 'aria-label': c.label,
          onclick: () => COMMANDS[c.id]?.(),
        }, iconEl(CMD_ICON[c.id], 'wv-icon'), el('span', { class: 'sel-tip' }, c.label)),
      ]).flat()));
  };

  // Escape is the way out of a selection, for the life of this grid.
  addEventListener('keydown', function esc(e) {
    if (!wrap.isConnected) return removeEventListener('keydown', esc);
    if (e.key !== 'Escape' || !chosen().size) return;
    // A dialog, popover or open cell editor owns Escape first — clearing the
    // selection out from under one of those would answer a keystroke the
    // reader aimed somewhere else.
    if (document.querySelector('.chip-pop, .tray-back, .modal-back')) return;
    clearChosen();
  });

  const draw = () => {
    const sorted = [...items];
    if (sortKey) {
      sorted.sort((a, b) => {
        const av = a.fields[sortKey], bv = b.fields[sortKey];
        if (av == null) return 1;
        if (bv == null) return -1;
        return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(fieldValueCell(av)).localeCompare(String(fieldValueCell(bv)))) * sortDir;
      });
    }
    const tbody = el('tbody');
    for (const item of sorted) {
      const row = el('tr', {
        class: 'entity-row' + (item.deleted ? ' row-deleted' : ''),
        dataset: { eid: item.id },
        /* Ledger's one rule: the #id link opens, every cell edits. A bare
           row click raises the cell's own editor; the #id link docks the
           entity beside the table. ⌘-click anywhere on the row gives the
           entity its own browser tab — the modifier means "own window",
           same as every link. */
        onclick: (e) => {
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            if (!openRegistryRow(db, item)) window.open(`${location.pathname}#/entity/${item.id}`, '_blank');
            return;
          }
          if (e.target.closest('a, button, input, select, textarea, label')) return;
          const cell = e.target.closest('td');
          if (cell) activateCell(cell);
        },
      },
        // Left of the # link, so the link never disappears while a selection
        // is live and a chosen row stays openable (mockup, 2026-08-24).
        el('td', { class: 'sel-cell' },
          item.deleted ? null : el('label', { class: 'sel-hit' },
            el('input', {
              class: 'sel-box', type: 'checkbox',
              'aria-label': `Select #${item.publicId}`,
              onclick: (e) => onBox(e, item.id),
            }))),
        el('td', { class: 'pid-cell' },
          el('a', {
            class: 'open-link',
            href: registryHref(db, item) ?? `#/entity/${item.id}`,
            title: db.system === 'tables' ? 'Open table' : db.system === 'spaces' ? 'Open space' : `Open ${db.term.singular} beside the table — ⌘-click for a new tab`,
            // Plain click docks the entity beside the table; a modifier
            // falls through to the real href, so ⌘-click opens a tab.
            onclick: (e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || registryHref(db, item)) return;
              e.preventDefault();
              dockEntity(db, item.id);
            },
          }, `#${item.publicId} ↗`)),
        ...cols.map((c) => {
          const f = db.fields.find((x) => x.name === c);
          /* A description is not computed. `cell-computed` dims a value to
             --tblr-secondary and says "nothing to do here"; the description is
             the row's own prose and one click opens it (Kyle, 2026-08-27), so
             it takes the plain cell every text value takes. */
          const kind = PICKER_FIELD_TYPES.includes(f.type) ? ' cell-pick'
            : (READONLY_FIELD_TYPES.includes(f.type) && f.type !== 'document') ? ' cell-computed' : '';
          return el('td', {
            dataset: { ftype: f.type, field: f.name },
            // The leading column carries the row's identity — Name by default,
            // whatever the reader put first after a reorder — so it is set
            // heavier than the fields that qualify it.
            class: (f.type === 'number' ? 'num' : '')
              + (c === cols[0] ? ' name-cell' : '') + kind,
            // A resized column overrides the shared 260px cap — otherwise the
            // header widens and the cells keep ellipsising at the old width.
            style: f.width ? columnWidthStyle(f.width) : null,
          }, editorFor(f, item, db, onSaved, { compact: true }));
        }),
        ...(db.systemFields ?? []).map((n) => el('td', { class: 'cell-computed sys-cell' }, SYSTEM_COLS[n]?.(item) ?? '')));
      tbody.append(row);
    }
    // Creating an entity is the last row of the grid, not a detached bar:
    // the table reads as one surface that grows from the bottom.
    tbody.append(el('tr', { class: 'add-entity-row' },
      el('td', { colspan: String(colCount) },
        el('button', {
          class: 'add-entity-btn', type: 'button', title: `New ${db.term.singular}`,
          onclick: () => state.inlineAdd?.(),
        }, `+ New ${db.term.singular}`))));

    const table = el('table', {
      class: 'table table-sm table-vcenter card-table table-hover wv-grid',
      dataset: { density: gridDensity(db.id) },
    },
      el('thead', {}, el('tr', {},
        // Select-all, with a dash for a partial selection. Same hit target as
        // the body boxes so the column reads as one vertical line.
        el('th', { class: 'sel-head' },
          el('label', { class: 'sel-hit' },
            el('input', {
              class: 'sel-box', type: 'checkbox', 'aria-label': 'Select every row',
              onclick: () => {
                const drawn = drawnIds();
                const L = SEL();
                anchor = null;
                setChosen(L.headState(chosen().size, drawn.length) === 'all'
                  ? new Set() : L.selectAll(drawn));
              },
            }))),
        el('th', { class: 'pid-head' }, '#'),
        ...cols.map((c, i) => el('th', {
          class: 'col-head',
          draggable: 'true',
          style: colField(db, c).width ? columnWidthStyle(colField(db, c).width) : null,
          // Click opens the field in the tray (Kyle, 2026-08-23: editing is
          // what a header click should mean); sorting lives in the ⋮ menu.
          onclick: () => editFieldDialog(db, colField(db, c)),
          // Dragging a header moves the column. The drop lands before the
          // target when the column travels left, after it when it travels
          // right — the same "insert where the gap opened" reading as a
          // dragged card.
          ondragstart: (e) => { e.dataTransfer.setData('text/plain', c); e.dataTransfer.effectAllowed = 'move'; },
          ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-target'); },
          ondragleave: (e) => e.currentTarget.classList.remove('drop-target'),
          ondrop: (e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('drop-target');
            const from = e.dataTransfer.getData('text/plain');
            // The side is judged against the LIVE order, not the order this
            // header was drawn with: a previous drag moves columns in place
            // without a redraw, so `cols` and `i` here can be stale and a
            // second drag would land on the wrong side of the target.
            const live = visibleCols(db);
            if (from && from !== c && live.includes(from) && live.includes(c)) {
              reorderField(db, from, c, { after: live.indexOf(from) < live.indexOf(c) });
            }
          },
        },
          el('span', { class: 'col-label' },
            fieldNameLabel(colField(db, c), c),
            sortKey === c ? (sortDir > 0 ? ' ↑' : ' ↓') : ''),
          fieldMenuButton(db, colField(db, c), {
            sorted: sortKey === c ? sortDir : 0,
            onSort: (dir) => {
              sortKey = dir ? c : null; sortDir = dir || 1; draw();
              api('PATCH', `/tables/${db.id}`, { sort: dir ? [{ field: c, dir: dir > 0 ? 'asc' : 'desc' }] : [] }).then(loadSchema);
            },
          }),
          columnResizeGrip(db, colField(db, c)))),
        ...(db.systemFields ?? []).map((n) => el('th', { class: 'sys-head', title: `${n} — system field, read-only` },
          el('span', { class: 'col-label' }, n, el('sup', { class: 'field-mark' }, '·')))),
        // Adding a field lives where the fields are: the end of the header bar.
        el('th', { class: 'add-field-head' }, addFieldMenuButton(db)))),
      tbody);
    wrap.replaceChildren(table, puck);
    // A row that left the page — trashed, filtered out, sorted away — is no
    // longer selected. Done after the draw so it reads the rows that exist.
    if (chosen().size) setChosen(SEL().prune(chosen(), drawnIds()));
    else paintSelection();
    // Measured after the browser has laid the columns out, so "clipped"
    // means clipped and the marker never claims there is more to read.
    requestAnimationFrame(() => markClippedCells(table));
    // A redraw rebuilds every row; the docked one takes its light back.
    markDockedRow();
  };
  draw();
  // A clipped cell opens over the grid on hover, in a layer of its own —
  // the cell keeps its box, so no column ever moves (Kyle, 2026-08-24).
  wrap.addEventListener('mouseover', (e) => {
    const td = e.target.closest('td.clipped');
    if (td && wrap.contains(td)) showCellPop(td, wrap); else hideCellPop(wrap);
  });
  wrap.addEventListener('mouseleave', () => hideCellPop(wrap));
  main.append(wrap);
}


/* System columns (Feature #65): read-only, engine-maintained, shown per
   table via db.systemFields. Values ride the entity payload, not fields. */
const SYSTEM_COLS = {
  'Created At': (e) => (e.createdAt ?? '').slice(0, 16).replace('T', ' '),
  'Modified At': (e) => (e.updatedAt ?? '').slice(0, 16).replace('T', ' '),
  'Created By': (e) => e.createdBy ?? '',
  'Modified By': (e) => e.modifiedBy ?? '',
  // The count links the row to its history; the panel is the full treatment.
  'Activity': (e) => `${(e.activity ?? []).length}⚡`,
};

const colField = (db, name) => db.fields.find((f) => f.name === name);

/* ---------- column widths (Feature #42) ----------
   Mirrors the engine's floor: a drag that writes anything narrower comes back
   as a 400 and the column snaps to a width nobody asked for. */
const MIN_COLUMN_WIDTH = 60;

/* Drag the edge to size a column, double-click it to hand the column back to
   the browser. The width is per-field schema, so it is the grid's width for
   everyone — one write on release, never one per pointermove. */
/* The widest content in the column, measured off the grid: double-clicking
   the grip fits the column to it so nothing is cut off (Kyle, 2026-08-23).
   scrollWidth cannot answer this (Kyle, 2026-08-24 — "does not snap to
   properly"): a cell clips with `max-width` + ellipsis, so it never reports
   overflow, and the <input> a text cell holds is a fixed default box whose
   width says nothing about its value. Every fit came back as the width the
   column already had, plus the padding constant. So the column's content is
   cloned into an unclipped measurer — inputs swapped for spans carrying their
   text and metrics — and the widest clone is the fit. */
function cellFitProbe(cell) {
  const cs = getComputedStyle(cell);
  const probe = el('span', { class: 'wv-measure-cell' });
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing']) {
    probe.style[prop] = cs[prop];
  }
  for (const node of cell.childNodes) probe.append(node.cloneNode(true));
  // An <input> paints its value, not its box, so measure the value.
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
  const rows = [th.parentElement, ...table.querySelectorAll(':scope > tbody > tr')];
  for (const row of rows) {
    const cell = row.children[idx];
    // A colspan cell (the "+ New" row, an expanded document) is the whole
    // grid, not this column — measuring it fits the column to the table.
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
  return Math.max(MIN_COLUMN_WIDTH, Math.ceil(widest));
}

function columnResizeGrip(db, f) {
  const grip = el('span', { class: 'col-resize', title: 'Drag to resize — double-click to fit the content' });
  grip.addEventListener('click', (e) => e.stopPropagation());        // resizing is not opening the editor
  grip.addEventListener('dblclick', (e) => { e.stopPropagation(); const th = grip.closest('th'); setColumnWidth(db, f, fitColumnWidth(th), th); });
  grip.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
  grip.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const th = grip.closest('th');
    // The th is draggable for column reorder; Safari and Firefox start
    // that native drag a few pixels into a resize and the pointer stream
    // dies — the "stuck" resize. Suspend draggable for the duration and
    // capture the pointer on the grip so every move reaches us.
    const wasDraggable = th.draggable;
    th.draggable = false;
    try { grip.setPointerCapture(e.pointerId); } catch { /* older engines */ }
    const startX = e.clientX;
    const base = th.getBoundingClientRect().width;
    let width = base;
    const move = (ev) => {
      width = Math.max(MIN_COLUMN_WIDTH, Math.round(base + ev.clientX - startX));
      th.style.width = `${width}px`;
    };
    let done = false;
    const up = () => {
      if (done) return;
      done = true;
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      grip.removeEventListener('lostpointercapture', up);
      th.draggable = wasDraggable;
      if (Math.round(width) !== Math.round(base)) setColumnWidth(db, f, width, th);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
    grip.addEventListener('lostpointercapture', up);
  });
  return grip;
}

/* A column width is a floor as well as a ceiling. Auto table layout treats a
   bare `width` as a suggestion and squeezes it away as soon as the grid is
   wider than its card — which is every grid with a document column — so a
   resized or fitted column visibly refused to move (Kyle, 2026-08-24).
   min-width holds the column open; max-width keeps the cells ellipsising. */
const columnWidthStyle = (width) => `width:${width}px;min-width:${width}px;max-width:${width}px`;

function applyColumnWidth(cell, width) {
  cell.style.width = width ? `${width}px` : '';
  cell.style.minWidth = width ? `${width}px` : '';
  cell.style.maxWidth = width ? `${width}px` : '';
}

async function setColumnWidth(db, f, width, th = null) {
  try {
    await api('PATCH', `/tables/${db.id}/fields/${encodeURIComponent(f.id)}`, { config: { width } });
    // Commit in place: the header keeps (or sheds) its width and the cells
    // follow, without tearing the grid down mid-gesture (Kyle, 2026-08-22).
    f.width = width ?? undefined;
    if (th) {
      applyColumnWidth(th, width);
      const idx = [...th.parentElement.children].indexOf(th);
      for (const row of th.closest('table')?.querySelectorAll('tbody tr') ?? []) {
        const cell = row.children[idx];
        if (cell && cell.colSpan === 1) applyColumnWidth(cell, width);
      }
    }
    loadSchema().catch(() => {}); // background truth refresh, no repaint
  } catch (err) { toast(err.message, true); showDatabase(db.id); }
}

/* ---------- the column header as a control (Feature #41, option A) ----------
   Until this, the header only sorted and there was NO edit path for a field:
   changing a select's options meant deleting the column and building it again,
   which takes the column's data with it. The ⋮ puts the field's whole life —
   edit, move, insert, delete — on the header it belongs to, reusing the chip
   popover so it matches every other picker in the grid. */

/* Redesigned 2026-08-27 (Kyle: "match weave design language"). What the old
   panel got wrong, all of it visible in one screenshot:

   1. The icons were CHARACTERS typed into the label — '✎ Edit field…',
      '↑ Sort ascending'. A font gives each glyph its own advance width and
      its own optical size, so the pencil, the plus and the arrows never
      shared a box and the labels never shared a left edge. That is the exact
      defect Issue #87 is about, and this was the surface it had not reached:
      every mark here now draws through iconEl() at --wv-icon-md, on the same
      0 0 24 24 canvas as the rest of the app.
   2. The delete row was a Tabler `.dropdown-item` sitting among weave
      `.chip-pop-row`s — different padding, different radius, no icon column,
      so it hung off the left edge of the labels above it. Worse than the
      look: showPopover walks `.chip-pop-row` for ↑↓, so the one row that
      needed the most deliberate aim was the one the keyboard could not reach.
      Every row is the same row now, destructive included.
   3. Sort state was a '✓ ' PREFIX pasted onto the label, which shunted the
      whole row right when it was on. The popover already has a cue for "this
      is the current value" — the trailing .chip-pop-check — and using it also
      opens the menu focused on the active sort, free.
   4. Nothing said which column the panel belonged to. The ⋮ paints at its
      column's right edge, millimetres from the NEXT column's label; the
      hovered-header tint was the only cue (live check, 2026-08-16). The panel
      now opens by naming the field and its type.

   The hold-to-delete gesture and its sweep are kept, and made discoverable:
   the row carries a quiet HOLD chip at rest, so the gesture is advertised
   before the press rather than discovered by it. */

/* Picked by eye off a contact sheet of every candidate in both vocabularies,
   not by name. `iconly:arrow-up` is a solid teardrop that reads as a map pin
   at 16px — the drawn '↑' and '↓' marks are the actual arrows, and being
   stroked at 2.6 they sit at the density Issue #87 matched the filled set to.
   Iconly's only plus is a filled rounded square, which came out the darkest
   thing on the panel beside a hairline pencil, so the set gained a bare '+'
   at 2.6 — the same move Issue #87 made for the five marks it drew.
   edit and delete stay on iconly because that is what the entity command bar
   already draws for the same two verbs (CMD_ICON), and a menu that renames a
   field must not label it differently from the bar that deletes it. */
const FIELD_MENU_ICONS = {
  edit: 'lucide:pencil', insert: '+',
  asc: '↑', desc: '↓', clear: '✕',
  delete: 'lucide:trash-2',
};

/* One row shape for the whole menu: icon box, label, and the check slot the
   popover already uses. `current` both tints the row and drops the check in,
   which is what showPopover reads to open focus on it. */
function fieldMenuRow(icon, label, run, { current = false } = {}) {
  const row = el('button', {
    class: `chip-pop-row wv-menu-row${current ? ' is-current' : ''}`, type: 'button',
    onclick: () => { document.querySelector('.chip-pop')?.remove(); run(); },
  }, iconEl(icon, 'wv-icon wv-menu-icon'), el('span', { class: 'wv-menu-label' }, label));
  if (current) row.append(el('span', { class: 'chip-pop-check' }, iconEl('✓', 'wv-icon')));
  return row;
}

function fieldMenuButton(db, f, { sorted = 0, onSort = null } = {}) {
  const btn = el('button', {
    class: 'field-menu', type: 'button',
    title: `Configure ${f.name}`, 'aria-label': `Configure field ${f.name}`,
  }, '⋮');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();   // configuring a column must not also sort it
    const row = fieldMenuRow;
    // No move rows: the header itself is the reorder control, and a dragged
    // column lands where the gap opened. Two ways to do one thing is one too
    // many when the direct one is the one people reach for.
    const rows = [
      el('div', { class: 'wv-menu-head' },
        el('span', { class: 'wv-menu-title', title: f.name }, f.name),
        el('span', { class: 'wv-menu-kind' }, fieldDialogCore.typeLabel(f.type))),
      row(FIELD_MENU_ICONS.edit, 'Edit field…', () => editFieldDialog(db, f)),
      row(FIELD_MENU_ICONS.insert, 'Insert field…', () => addFieldDialog(db)),
    ];
    if (onSort) {
      rows.push(el('div', { class: 'wv-menu-sep' }),
        row(FIELD_MENU_ICONS.asc, 'Sort ascending', () => onSort(1), { current: sorted > 0 }),
        row(FIELD_MENU_ICONS.desc, 'Sort descending', () => onSort(-1), { current: sorted < 0 }));
      if (sorted) rows.push(row(FIELD_MENU_ICONS.clear, 'Clear sort', () => onSort(0)));
    }
    if (f.role !== 'name') {
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

/* A field definition can name the value a new row starts with. The engine's
   DEFAULTABLE_TYPES is the authority — it refuses the rest — so the dialogs
   offer the input for exactly those types. A workflow is absent because its
   default is one of its states. */
/* Which types take a default, and how a string becomes one, live in
   field-dialog-core.js (DEFAULTABLE / definitionFromState) — tested there. */

/* ---------- dates: smart input + calendar popover (2026-08-23) ----------
   One control everywhere a date is edited (cells, entity rows, the tray's
   default): a text input that reads any format a person types — '9/15/26',
   '15 sep 2026', 'next friday' (nl-date.js) — beside a calendar button that
   opens a small popover laid out like the native picker Kyle liked:
   month ▾ / year ▾ (each a grid), ↑ ↓ months, Sunday-first days, a time row
   when the field carries time, Clear / Today. */
function dateControl({ value = '', time = false, format = 'iso', costume = null, placeholder = 'type a date…', onChange, compact = true }) {
  const dc = weaveDateCore;
  /* The field's costume (grain · format · time · clock · zone · pad, 2026-09-02)
     decides what the box parses, what the popover offers and what is stored.
     Callers that predate it pass { time, format } and get the full grain. */
  const c = costume ? { ...costume } : { time, format };
  format = c.format ?? 'iso';
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
  const set = (iso) => { current = iso ?? ''; text.value = show(current); onChange(current || null); };
  /* A local wall clock → the stored form: an instant folds to UTC, a
     partial grain is cut to its parts, the full grain stores as typed. */
  const store = (localIso) => {
    if (!localIso) return null;
    if (c.zone === 'instant') return dc.toInstant(localIso.includes('T') ? localIso : localIso + 'T00:00', LOCAL_ZONE);
    if (c.grain == null) return localIso;
    return dc.coerce(c, localIso);
  };
  // What the popover and the typed-time fallback see: the local wall clock.
  const local = () => (c.zone === 'instant' && current ? dc.fromInstant(current, LOCAL_ZONE) : current);
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
  wrap.setValue = (iso) => { current = iso ?? ''; text.value = show(current); };
  return wrap;
}

/* Typed text → a local ISO stamp the store() step cuts to the grain. Throws
   when nothing readable is there. The full-date phrases ('next friday',
   '15 sep') go through nl-date.js; the shapes a partial grain invites —
   '08/2026', '2026', 'the 15th', 'august' — are read here first. */
function readTypedDate(typed, c, current) {
  const dc = weaveDateCore;
  const grain = dc.grainOf(c);
  const format = c.format ?? 'iso';
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
  // A typed day keeps the existing time of day; a typed datetime brings its own.
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

/* The picker opens on the view the grain asks for: a calendar for a full
   date, the month grid for year·month, the year grid for a year, a 1–31
   grid for a day of the month, a clock alone for a time of day. Every pick
   hands back a LOCAL wall-clock stamp; the control cuts it to the grain. */
function datePopover({ anchor, value, time, format, costume = null, onPick }) {
  const dc = weaveDateCore;
  const c = costume ?? { time, format };
  time = !!c.time;
  format = c.format ?? 'iso';
  const grain = dc.grainOf(c);
  const hasY = grain.includes('year'), hasM = grain.includes('month'), hasD = grain.includes('day');
  const pad = (n) => String(n).padStart(2, '0');
  document.querySelector('.date-pop')?.remove();
  const todayIso = dc.todayIso();
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const p = dc.partsOf(value || '') ?? {};
  let y = p.y ?? ty, m = p.m ?? tm;
  let selected = p.d != null ? `${y}-${pad(m)}-${pad(p.d)}` : '';
  let clock = p.t ?? '';
  let view = !hasY && !hasM && !hasD ? 'clock' : hasD && !hasM ? 'daylist' : hasM && !hasD ? 'months' : hasY && !hasM ? 'years' : 'days';
  let decadeBase = y;
  const pop = el('div', { class: 'date-pop', role: 'dialog', onclick: (e) => e.stopPropagation() });
  const commit = (iso, close) => {
    onPick(iso);
    if (close) pop.remove();
    else draw();
  };
  const withClock = (day) => (time ? `${day}T${clock || '00:00'}` : day);
  const smart = el('input', {
    class: 'form-control form-control-sm date-smart',
    placeholder: view === 'clock' ? '9:15, 5:40 pm…' : hasD ? 'today, 15 sep, 9/15/26…' : hasM ? 'aug 2026, 08/2026…' : '2026…',
    value: dc.formatDate(value || '', { ...c, viewerZone: LOCAL_ZONE }),
  });
  const preview = el('div', { class: 'date-smart-preview' });
  const readSmart = () => {
    try { return readTypedDate(smart.value, c, value || ''); } catch { return null; }
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
    // Enter is "done": commit and close, time of day kept (Kyle, 2026-08-23).
    commit(local, true);
  });
  const body = el('div', { class: 'date-pop-body' });
  const timeRow = () => {
    const t = el('input', { type: 'time', class: 'form-control form-control-sm date-time', value: clock });
    t.addEventListener('change', () => {
      clock = t.value;
      if (view === 'clock') { if (clock) commit(clock, false); return; }
      if (selected) commit(withClock(selected), false);
    });
    return el('div', { class: 'date-pop-time' }, el('span', {}, 'Time'), t);
  };
  const foot = (todayPick) => el('div', { class: 'date-pop-foot' },
    el('button', { type: 'button', class: 'date-pop-link', onclick: () => { selected = ''; clock = ''; commit(null, true); } }, 'Clear'),
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
            class: 'date-day' + (cell.inMonth ? '' : ' out') + (cell.iso === todayIso ? ' today' : '') + (cell.iso === selected ? ' sel' : ''),
            onclick: () => { selected = cell.iso; [y, m] = cell.iso.split('-').map(Number); commit(withClock(cell.iso), !time); },
          }, String(cell.day)));
        }
      }
      body.append(grid);
      if (time) body.append(timeRow());
      body.append(foot(() => { selected = todayIso; [y, m] = [ty, tm]; commit(withClock(todayIso), !time); }));
    } else if (view === 'daylist') {
      // A day of the month, of no particular month: 1 to 31.
      const grid = el('div', { class: 'date-grid' });
      for (let d = 1; d <= 31; d++) {
        grid.append(el('button', {
          type: 'button', class: 'date-day' + (d === td ? ' today' : '') + (d === p.d ? ' sel' : ''),
          onclick: () => { selected = `${ty}-${pad(tm)}-${pad(d)}`; commit(withClock(selected), !time); },
        }, String(d)));
      }
      body.append(grid);
      if (time) body.append(timeRow());
      body.append(foot(() => { selected = todayIso; commit(withClock(todayIso), !time); }));
    } else if (view === 'clock') {
      body.append(timeRow(), el('div', { class: 'date-pop-foot' },
        el('button', { type: 'button', class: 'date-pop-link', onclick: () => { clock = ''; commit(null, true); } }, 'Clear'),
        el('button', { type: 'button', class: 'date-pop-link', onclick: () => { const d = new Date(); clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`; commit(clock, true); } }, 'Now')));
    } else if (view === 'months') {
      body.append(el('div', { class: 'date-pop-head' },
        hasY ? el('button', { type: 'button', class: 'date-pop-title', onclick: () => { if (hasD) { view = 'days'; draw(); } else { view = 'years'; decadeBase = y; draw(); } } }, `${y}${hasD ? '' : ' ▾'}`) : el('span', { class: 'date-pop-title' }, 'Month'),
        el('span', { class: 'date-pop-spacer' }),
        ...(hasY ? [
          el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { y--; draw(); } }, iconEl('↑')),
          el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { y++; draw(); } }, iconEl('↓'))] : [])));
      body.append(el('div', { class: 'date-pick-grid' }, ...dc.MONTHS.map((name, i) => el('button', {
        type: 'button', class: 'date-pick-cell' + (i + 1 === m ? ' sel' : ''),
        onclick: () => {
          m = i + 1;
          if (hasD) { view = 'days'; draw(); return; }
          selected = `${y}-${pad(m)}-01`;
          commit(withClock(selected), !time);
        },
      }, name))));
      if (!hasD && time) body.append(timeRow());
      if (!hasD) body.append(foot(() => { y = ty; m = tm; selected = `${ty}-${pad(tm)}-01`; commit(withClock(selected), !time); }));
    } else {
      const years = dc.decade(decadeBase);
      body.append(el('div', { class: 'date-pop-head' },
        el('button', { type: 'button', class: 'date-pop-title', onclick: () => { if (hasM) { view = hasD ? 'days' : 'months'; draw(); } } }, `${years[0]}–${years[years.length - 1]}`),
        el('span', { class: 'date-pop-spacer' }),
        el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { decadeBase -= 10; draw(); } }, iconEl('↑')),
        el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { decadeBase += 10; draw(); } }, iconEl('↓'))));
      body.append(el('div', { class: 'date-pick-grid' }, ...years.map((yr) => el('button', {
        type: 'button', class: 'date-pick-cell' + (yr === y ? ' sel' : ''),
        onclick: () => {
          y = yr;
          if (hasM) { view = 'months'; draw(); return; }
          selected = `${y}-01-01`;
          commit(withClock(selected), !time);
        },
      }, String(yr)))));
      if (!hasM) body.append(foot(() => { y = ty; selected = `${ty}-01-01`; commit(withClock(selected), !time); }));
    }
  }
  draw();
  pop.append(el('div', { class: 'date-pop-smart' }, smart, preview), body);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (r.bottom + 6 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + 'px';
  const close = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('click', close, true); } };
  addEventListener('click', close, true);
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); pop.remove(); anchor.focus(); } });
  smart.focus();
  return pop;
}

/* ---------- unified field dialog (design review 2026-08-22, A+E) ----------
   One dialog for add and edit: a type grid with per-type config editors
   (direction A) plus a form ⇄ code pane over the canonical {type, config}
   definition (direction E), both views of the same state object in
   field-dialog-core.js. Any field can be a formula: ƒ is a toggle, not a
   grid tile. The section/grid/list-editor pieces are the house dialog
   framework — addRelationDialog composes from the same parts. */

function dsection(label, ...kids) {
  return el('div', { class: 'dlg-sec full' }, el('div', { class: 'dlg-lbl' }, label), ...kids);
}

function segCtl(options, value, onPick) {
  const wrap = el('div', { class: 'seg-ctl', role: 'group' });
  const norm = options.map((o) => (typeof o === 'string' ? { id: o, label: o } : o));
  const draw = (current) => {
    wrap.replaceChildren(...norm.map((o) => el('button', {
      type: 'button', class: 'seg-opt' + (o.id === current ? ' on' : ''), title: o.title ?? null,
      onclick: () => { draw(o.id); onPick(o.id); },
    }, o.label)));
  };
  draw(value);
  return wrap;
}

/* The ten-hue ramp and the glyph vocabulary as popovers rather than cycles.
   Seven clicks to reach the seventh colour was tolerable when there were
   seven; the ramp is ten and the glyphs are fourteen. */
function huePopover(anchor, current, onPick) {
  const grid = el('div', { class: 'swatch-grid' },
    ...chipCore.HUES.map((h) => el('button', {
      type: 'button', class: `sw hue-${h}${h === 'slate' ? ' neutral' : ''}${h === current ? ' sel' : ''}`,
      title: h === 'slate' ? 'no colour' : h, 'aria-label': h,
      onclick: () => onPick(h),
    })));
  showPopover(anchor, [grid, el('p', { class: 'pick-note' },
    'Stored as a name. A new option takes the next hue in ramp order.')]);
}
/* Was a fourteen-button strip of marks while a table next door searched 101
   flat icons. One catalogue, one control, both dialects (Issue #87). */
function glyphPopover(anchor, current, onPick) {
  searchPicker({
    anchor, title: 'Icon', placeholder: 'Search by name or category…',
    options: iconCatalogue(), grid: true, currentId: current ?? '',
    onPick: (o) => onPick(o.id || ''),
  });
}

/* The chip a row is about to produce, shown beside the controls that produce
   it — the one thing the tray could never tell you before. */
function optionPreview(o) {
  return el('span', { class: 'opt-preview' },
    el('span', { class: `k k-select hue-${o.hue ?? 'slate'}` },
      o.icon ? iconEl(o.icon, 'ico wv-icon') : null,
      o.name || 'Option'));
}
function statePreview(st) {
  const cat = chipCore.categoryOrDefault(st.category ?? 'in-progress');
  return el('span', { class: 'opt-preview' },
    el('span', { class: `k k-state cat-${cat} hue-${chipCore.categoryHue(cat)}` },
      st.icon ? iconEl(st.icon, 'ico wv-icon') : null,
      st.name || 'State'));
}

/* What one row is called (Feature #40) — Name-field config. The singular is
   a datalist over the curated terms, so a click picks one and typing makes a
   custom one; the plural derives until someone corrects it. Below, the three
   surfaces that speak it, live.
   ponytail: a grouped searchPicker (the icon picker's dialect) is the upgrade
   if the flat datalist proves too long to scan. */
function termSection(state, onChange) {
  const T = WeaveTerm;
  const list = el('datalist', { id: 'term-options' }, ...T.options().map((o) => el('option', { value: o.id }, o.group)));
  const sing = el('input', { class: 'form-control term-singular', list: 'term-options', placeholder: T.DEFAULT.singular, autocomplete: 'off', spellcheck: 'false', value: state.term?.singular ?? '' });
  const plur = el('input', { class: 'form-control term-plural', placeholder: T.DEFAULT.plural, spellcheck: 'false', value: state.term?.plural ?? '' });
  let pluralTouched = !!(state.term?.plural && state.term.plural !== T.pluralize(state.term.singular));
  const preview = el('div', { class: 'modal-note term-preview' });
  const draw = () => {
    const t = T.resolve({ term: state.term });
    plur.placeholder = T.pluralize(sing.value.trim() || T.DEFAULT.singular);
    preview.textContent = `“+ New ${t.singular}” · “${T.count(3, t)} selected” · “Deleted ${t.plural}”${t.set ? '' : ' — the default'}`;
  };
  sing.oninput = () => {
    const s = sing.value.trim().toLowerCase();
    if (!s) { state.term = null; if (!pluralTouched) plur.value = ''; }
    else {
      const plural = pluralTouched && plur.value.trim() ? plur.value.trim().toLowerCase() : T.pluralize(s);
      state.term = { singular: s, plural };
      if (!pluralTouched) plur.value = plural;
    }
    draw(); onChange();
  };
  plur.oninput = () => {
    pluralTouched = !!plur.value.trim();
    if (state.term) state.term.plural = plur.value.trim().toLowerCase() || T.pluralize(state.term.singular);
    draw(); onChange();
  };
  draw();
  return dsection('Rows in this table are…',
    el('div', { class: 'term-row' }, sing, el('span', { class: 'term-sep' }, '/'), plur, list), preview);
}

/* Rows of {name, color} with a cycling color swatch — replaces the
   comma-separated string that couldn't hold a color and choked on commas. */
function optionListEditor(state, onChange) {
  const wrap = el('div', { class: 'opt-list' });
  const draw = () => {
    wrap.replaceChildren(
      ...state.options.map((o, i) => {
        const hue = o.hue ?? chipCore.hueFromHex(o.color);
        return el('div', { class: 'opt-row' },
          (() => {
            const b = el('button', {
              type: 'button', class: 'opt-icon' + (o.icon ? '' : ' none'), title: 'Choose a glyph',
              onclick: () => glyphPopover(b, o.icon ?? '', (g) => { o.icon = g; draw(); onChange(); }),
            }, o.icon || '—');
            return b;
          })(),
          el('input', { class: 'opt-name', value: o.name, placeholder: 'Option', oninput: (e) => { o.name = e.target.value; onChange(); } }),
          (() => {
            const b = el('button', {
              type: 'button', class: `opt-color hue-${hue}${hue === 'slate' ? ' neutral' : ''}`, title: 'Choose a colour',
              onclick: () => huePopover(b, hue, (h) => { o.hue = h; o.color = chipCore.HUE_HEX[h]; draw(); onChange(); }),
            });
            return b;
          })(),
          optionPreview({ ...o, hue }),
          el('button', { type: 'button', class: 'opt-del', title: 'Remove option', onclick: () => { state.options.splice(i, 1); draw(); onChange(); } }, '✕'));
      }),
      el('button', {
        type: 'button', class: 'opt-add',
        // A new option takes the next hue in ramp order, so a fresh set is
        // legible before anyone has chosen anything.
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

/* States: drag ⠿ to reorder (the list's order is the selector's order and
   the first state is the default — no radio), an icon the chip wears, the
   name, the category through the picker dialect. */
function stateListEditor(state, onChange) {
  const fdc = fieldDialogCore;
  const wrap = el('div', { class: 'opt-list' });
  let dragFrom = null;
  const draw = () => {
    wrap.replaceChildren(
      ...state.states.map((s, i) => {
        const row = el('div', {
          class: 'opt-row', draggable: 'true',
          ondragstart: (e) => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); },
          ondragend: () => row.classList.remove('dragging'),
          ondragover: (e) => { e.preventDefault(); row.classList.add('drop-target'); },
          ondragleave: () => row.classList.remove('drop-target'),
          ondrop: (e) => {
            e.preventDefault(); row.classList.remove('drop-target');
            if (dragFrom == null || dragFrom === i) return;
            state.states = fdc.moveItem(state.states, dragFrom, i);
            dragFrom = null; draw(); onChange();
          },
        },
        el('span', { class: 'opt-grip', title: 'Drag to reorder' }, '⠿'),
        (() => {
          const b = el('button', {
            type: 'button', class: 'opt-icon' + (s.icon ? '' : ' none'), title: 'Choose a glyph',
            onclick: () => glyphPopover(b, s.icon ?? '', (g) => { s.icon = g; draw(); onChange(); }),
          }, s.icon || '—');
          return b;
        })(),
        el('input', { class: 'opt-name', value: s.name, placeholder: 'State', oninput: (e) => { s.name = e.target.value; onChange(); } }),
        (() => {
          const cat = pickerSelect({ name: `wf-cat-${i}`, options: fdc.STATE_CATEGORIES.map((c) => ({ id: c, label: c })), value: chipCore.categoryOrDefault(s.category ?? 'in-progress') });
          cat.classList.add('opt-cat');
          cat.input.addEventListener('change', () => { s.category = cat.input.value; draw(); onChange(); });
          return cat;
        })(),
        // A state's colour belongs to its category — status has to mean the
        // same thing in every table — so the swatch shows it and refuses.
        (() => {
          const cat = chipCore.categoryOrDefault(s.category ?? 'in-progress');
          const hue = chipCore.categoryHue(cat);
          return el('button', {
            type: 'button', class: `opt-color locked hue-${hue}${hue === 'slate' ? ' neutral' : ''}`,
            disabled: true, title: `Colour comes from the ${cat} category`, 'aria-label': `Colour: ${cat}`,
          });
        })(),
        statePreview(s),
        el('button', { type: 'button', class: 'opt-del', title: 'Remove state', onclick: () => { state.states.splice(i, 1); draw(); onChange(); } }, '✕'));
        // Inputs inside a draggable row must keep their own mouse events.
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

/* The formula builder: expression plus insertable chips for this table's
   fields and the engine's functions — the two vocabularies a formula has. */
function formulaBuilder(db, state, onChange, { selfName = null } = {}) {
  const ta = el('textarea', {
    class: 'fx-expr', rows: 3, spellcheck: 'false',
    placeholder: 'e.g. if(Estimate > 5, "big", "small")',
  });
  ta.value = state.expression ?? '';
  /* Live verdict under the expression: the same check the save runs, so
     nothing is a surprise at submit. Valid + a row → a real preview value;
     invalid → the parser's message, in place, while typing. */
  const status = el('div', { class: 'fx-status' });
  let seq = 0, timer;
  const runCheck = async () => {
    const expr = (state.expression ?? '').trim();
    const mine = ++seq;
    if (!expr) { status.className = 'fx-status'; status.textContent = ''; return; }
    try {
      const r = await api('POST', `/tables/${db.id}/formula-check`, { expression: expr, excludeField: selfName });
      if (mine !== seq) return;
      status.className = 'fx-status ' + (r.ok ? 'ok' : 'err');
      status.textContent = r.ok
        ? ('preview' in r ? `= ${typeof r.preview === 'string' ? JSON.stringify(r.preview) : r.preview}${r.previewEntity ? `   (${r.previewEntity})` : ''}` : '✓ valid')
        : r.error;
    } catch (err) {
      if (mine !== seq) return;
      status.className = 'fx-status err';
      status.textContent = err.message;
    }
  };
  const queueCheck = () => { clearTimeout(timer); timer = setTimeout(runCheck, 250); };
  ta.addEventListener('input', () => { state.expression = ta.value; onChange(); queueCheck(); });
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
  };
  // The field being edited never offers itself — a formula that reads
  // itself never converges, and the engine rejects it anyway.
  const fieldChips = db.fields
    .filter((x) => !['document', 'attachments'].includes(x.type) && x.name !== selfName)
    .map((x) => el('button', { type: 'button', class: 'fx-chip', title: x.type, onclick: () => insert(fieldDialogCore.formulaFieldToken(x.name)) }, x.name));
  // Function chips land the caret between the parens, not after a dangling '('.
  const fnChips = fieldDialogCore.FORMULA_FUNCTIONS
    .map((fn) => el('button', { type: 'button', class: 'fx-chip fn', title: fn.sig, onclick: () => insert(`${fn.name}()`, 1) }, `${fn.name}()`));
  if ((state.expression ?? '').trim()) runCheck();
  return el('div', {},
    ta,
    status,
    el('div', { class: 'fx-chip-rows' },
      el('div', { class: 'fx-chip-row' }, el('span', { class: 'fx-chip-lbl' }, 'fields'), ...fieldChips),
      el('div', { class: 'fx-chip-row' }, el('span', { class: 'fx-chip-lbl' }, 'functions'), ...fnChips)));
}

/* The number costume controls (Kyle, 2026-08-23): Format → number shows a
   free-text Unit (days, feet); currency shows an ISO-code picker — the two
   never mix; percent shows neither. Decimals and the separator apply to
   all. Used by number fields and by a formula's numeric result. */
/* The date tray (2026-09-02): what the field STORES — which of year · month
   · day, and a time of day — then how it PRINTS. Only the styles the grain
   can wear are offered, each shown as today's date would render in it, in
   the grain the field stores: the example IS the label. */
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
    // A year with a day needs the month between them; no parts at all is a time of day.
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
      tick('time', 'Time of day', d.time, (on) => { d.time = on; if (!on && !parts.length) g.year = g.month = g.day = true; if (!on) { d.clock = '24h'; d.zone = 'floating'; d.elapsed = false; } })),
    el('div', { class: 'hintnote' }, storesHint)));
  const legal = fdc.legalFormats(g);
  if (legal.length) {
    kids.push(dsection('Format', el('div', { class: 'date-format-list' }, ...legal.map((fmt) => el('button', {
      type: 'button', class: 'date-format-opt' + ((d.format ?? 'iso') === fmt ? ' on' : ''),
      onclick: () => { d.format = fmt; redraw(); changed(); },
    }, el('span', { class: 'date-format-id' }, fmt), el('span', { class: 'date-format-eg' }, dc.formatDate(todayIso, { ...costume, format: fmt, time: false })))))));
    if (['us', 'eu'].includes(d.format)) {
      kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
        el('input', { type: 'checkbox', class: 'form-check-input', checked: d.pad ? '' : undefined, onchange: (e) => { d.pad = e.target.checked; redraw(); changed(); } }),
        el('span', { class: 'form-check-label' }, 'Zero-pad numerals ', el('span', { class: 'date-format-eg' }, dc.formatDate(todayIso, { ...costume, format: d.format, pad: true, time: false })))));
    }
  }
  if (d.time) {
    kids.push(dsection('Clock', segCtl(fdc.CLOCKS.map((id) => ({ id, label: dc.formatDate(todayIso + 'T14:30', { ...costume, clock: id, time: true }).split(' ').slice(parts.length ? 1 : 0).join(' ') })), d.clock ?? '24h', (v) => { d.clock = v; redraw(); changed(); })));
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

function numberCostumeControls(state, redraw, changed, { label = 'Format' } = {}) {
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
  // Currency and compact group on their own; the separator is for the rest.
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
  return kids;
}

function fieldDialog(db, existing, after) {
  const fdc = fieldDialogCore;
  const isEdit = !!existing;

  const defFromFieldView = (f) => {
    const c = {};
    if (f.type === 'select' || f.type === 'multiselect') c.options = f.optionsFull ?? (f.options ?? []).map((n) => ({ name: n, color: '' }));
    if (f.type === 'workflow') c.states = f.states ?? [];
    if (f.type === 'number' || f.type === 'formula') for (const k of ['format', 'unit', 'currency', 'decimals', 'separator', 'accounting']) { if (f[k] != null) c[k] = f[k]; }
    if (f.type === 'date' || f.type === 'daterange') for (const k of ['grain', 'format', 'time', 'clock', 'zone', 'zoneName', 'pad', 'elapsed']) { if (f[k] != null) c[k] = f[k]; }
    if (f.type === 'formula') c.expression = f.expression ?? '';
    if (f.type === 'field') c.depth = f.depth ?? 1;
    if (f.type === 'attachments') c.multiple = f.multiple !== false;
    if (f.type === 'document' && f.kind) c.kind = f.kind;
    // The schema flattens a credential's config onto the field, so the tray
    // has to fold it back or every existing column reopens claiming to be a
    // local API key — which is the one wrong answer for an SSN column.
    if (f.type === 'key') { c.kind = f.kind ?? 'apikey'; c.keystore = f.keystore ?? 'local'; }
    if (f.type === 'lookup' || f.type === 'rollup') { c.relationField = f.via ?? ''; c.targetField = f.targetField ?? ''; c.aggregate = f.aggregate; }
    if (f.default !== undefined) c.default = f.default;
    if (f.term) c.term = { ...f.term };
    return { type: f.type, config: c };
  };
  const state = isEdit ? fdc.stateFromDefinition(defFromFieldView(existing)) : fdc.blankState('text');
  if (isEdit && existing.type === 'formula') state.computed = 'formula';

  const nameInput = el('input', {
    name: 'name', placeholder: 'Field name', class: 'form-control',
    value: existing?.name ?? '',
  });

  const gridWrap = el('div', { class: 'full' });
  const cfgWrap = el('div', { class: 'full' });
  const changed = () => {};

  // An existing field sees its own type plus the compatible migrations —
  // nothing the engine would refuse. Picking one carries the config across
  // (options <-> states) so it can be adjusted before the save migrates the
  // column's values in place.
  let choices = fdc.typeChoices(isEdit ? existing.type : null);
  // A name is a label: text, or a formula through the ƒ toggle (Feature #168).
  if (isEdit && existing.role === 'name') choices = choices.filter((t) => t.id === 'text' || t.id === existing.type);
  const migratable = isEdit && choices.length > 1;
  function pickType(id) {
    state.computed = false;
    if (isEdit && id !== state.type) Object.assign(state, fdc.migrateState(state, id));
    else state.type = id;
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
      // The tile draws whatever the catalogue can draw and types the rest:
      // Aa, #, @ and the sum sign are letters doing a letter's job, while url
      // and files were colour emoji sitting among monochrome marks (#138).
    }, el('span', { class: 'type-ic' }, iconEl(t.icon) ?? t.icon), t.label));
    // Formula is a checkbox (Kyle, 2026-08-23): ticking it opens the script
    // dialog; the tray then shows the expression with an edit link.
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
      el('span', { class: 'fx-hint' }, 'any field can be computed'));
    let note = '';
    if (isEdit && state.type !== existing.type && !state.computed) {
      note = el('div', { class: 'modal-note migrate-note' }, `Saving converts this ${existing.type} field to ${state.type}; every row's value is migrated in place.`);
    } else if (isEdit && !migratable) {
      note = el('div', { class: 'modal-note' }, existing.role === 'name' ? 'a name is text, or a formula (ƒ below)' : `${existing.type} field — the type is fixed`);
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
      // The script editor lives in the tray (Kyle, 2026-08-23), not a window.
      kids.push(dsection('Script', formulaBuilder(db, state, changed, { selfName: existing?.name ?? null })));
      // A numeric result wears the same costume a number field does.
      kids.push(...numberCostumeControls(state, drawCfg, changed, { label: 'Result format' }));
    } else {
      const t = state.type;
      // The Name field carries the table's row term (Feature #40).
      if (isEdit && existing.role === 'name') kids.push(termSection(state, changed));
      if (t === 'select' || t === 'multiselect') {
        kids.push(dsection('Options', optionListEditor(state, changed)));
      } else if (t === 'workflow') {
        kids.push(dsection('States', stateListEditor(state, changed)));
      } else if (t === 'number') {
        kids.push(...numberCostumeControls(state, drawCfg, changed));
      } else if (t === 'date' || t === 'daterange') {
        kids.push(...dateCostumeControls(state, drawCfg, changed, { type: t }));
      } else if (t === 'relation') {
        if (isEdit) {
          kids.push(el('div', { class: 'modal-note full' }, `→ ${existing.targetDb}${existing.many ? ' (many)' : ''} — repoint by deleting and recreating`));
        } else {
          const r = state.relation;
          const tables = allTables();
          /* One target: the classic paired relation. More: a target-set
             (polymorphic) relation — one-way, values may point at rows of any
             member table, the registry's Spaces/Tables included. */
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
                }, '×'));
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
            // The inverse is a NEW field the engine creates on the target table
            // — a name, not a pick — and it has a sensible default, so the
            // input only exists to override it.
            const autoName = db.name + (['many-to-one', 'many-to-many'].includes(r.cardinality ?? 'many-to-one') ? 's' : '');
            kids.push(dsection('Inverse field on the target', el('input', { class: 'form-control', value: r.inverseName ?? '', placeholder: `${autoName} (created automatically — rename here)`, oninput: (e) => { r.inverseName = e.target.value; changed(); } })));
          }
        }
      } else if (t === 'attachments') {
        kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
          el('input', { type: 'checkbox', class: 'form-check-input', checked: state.multiple !== false ? '' : undefined, onchange: (e) => { state.multiple = e.target.checked; changed(); } }),
          el('span', { class: 'form-check-label' }, 'Allow multiple files')));
      } else if (t === 'document') {
        kids.push(dsection('Kind', segCtl(fdc.DOCUMENT_KINDS, state.kind ?? 'markdown', (v) => { state.kind = v; changed(); })));
      } else if (t === 'key') {
        /* Two picks, both stated rather than defaulted quietly (#143). The
           note under them is the part that matters: someone reaching for this
           type is deciding where a secret lives, and the answer to "who can
           see it" is not the same answer the rest of the table gives. */
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
        if (isEdit) {
          kids.push(el('div', { class: 'modal-note full' }, 'Computed config is not editable — delete and recreate to repoint it'));
        } else {
          // Both picks are search-as-you-type over what exists: the table's
          // relations, then the fields of the table that relation points at.
          const rels = db.fields.filter((x) => x.type === 'relation');
          const relSel = pickerSelect({ name: 'relationField', options: rels.map((r) => ({ id: r.name, label: `${r.name} → ${r.targetDb}` })), value: state.relationField || (rels[0]?.name ?? null) });
          state.relationField = state.relationField || (rels[0]?.name ?? '');
          relSel.input.addEventListener('change', () => { state.relationField = relSel.input.value; state.targetField = ''; drawCfg(); changed(); });
          kids.push(dsection('Relation', rels.length ? relSel : el('div', { class: 'modal-note' }, 'This table has no relations yet — add one first')));
          const rel = rels.find((r) => r.name === state.relationField);
          const target = rel && allTables().find((d) => d.id === rel.targetDbId);
          const targets = (target?.fields ?? []).filter((x) => x.type !== 'document');
          const needsTarget = t === 'lookup' || (state.aggregate ?? 'count') !== 'count';
          if (needsTarget && target) {
            const tSel = pickerSelect({ name: 'targetField', placeholder: `Field of ${target.name}…`, options: targets.map((x) => ({ id: x.name, label: `${x.name} · ${x.type}` })), value: state.targetField || null });
            tSel.input.addEventListener('change', () => { state.targetField = tSel.input.value; changed(); });
            kids.push(dsection('Target field', tSel));
          }
          if (t === 'rollup') {
            kids.push(dsection('Aggregate', segCtl(fdc.AGGREGATES, state.aggregate ?? 'count', (v) => { state.aggregate = v; drawCfg(); changed(); })));
          }
        }
      }
      if (t === 'date') {
        // A date default is none, the day/moment the row is created
        // (today() / now(), resolved by the engine), or a specific date.
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
      } else if (t === 'checkbox') {
        // A checkbox default is one of two states, not typed text.
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

  tray(isEdit ? `Edit ${existing.name}` : 'Add field', [
    dsection('Name', nameInput),
    gridWrap, cfgWrap,
  ], async () => {
    const def = fdc.definitionFromState(state);
    const name = nameInput.value.trim();
    if (!isEdit && def.type === 'relation') {
      await api('POST', `/tables/${db.id}/relations`, { name, ...def.config });
    } else if (!isEdit) {
      await api('POST', `/tables/${db.id}/fields`, { name, type: def.type, config: def.config });
    } else {
      const patch = {};
      if (name && name !== existing.name) patch.name = name;
      if (def.type !== existing.type) {
        // A migration: the engine coerces every row, then the rest of the
        // config (default) applies on the new shape.
        patch.type = def.type;
        patch.config = def.config;
      } else {
        patch.config = editPatchConfig(existing, def, state);
      }
      await api('PATCH', `/tables/${db.id}/fields/${encodeURIComponent(existing.id)}`, patch);
    }
    await loadSchema();
    after();
  }, isEdit ? 'Save changes' : 'Create');
}

/* The PATCH body per type. The engine merges config keys, so clearing a
   number/date costume key means sending an explicit null — the canonical
   minimal def omits defaults, which would silently keep the old value. */
function editPatchConfig(existing, def, state) {
  const c = def.config;
  const patch = {};
  // The row term is a lane of its own on the Name field: null clears it.
  if (existing.role === 'name') patch.term = c.term ?? null;
  if (existing.type === 'number' || existing.type === 'formula') {
    for (const k of ['format', 'unit', 'currency', 'decimals', 'separator', 'accounting']) patch[k] = c[k] ?? null;
  }
  if (existing.type === 'date' || existing.type === 'daterange') {
    // Every lane, every time: a null clears (a grain back to full drops the key).
    for (const k of ['grain', 'format', 'time', 'clock', 'zone', 'zoneName', 'pad', 'elapsed']) patch[k] = c[k] ?? null;
  } else if (existing.type === 'select' || existing.type === 'multiselect') {
    patch.options = (c.options ?? []).filter((o) => o.name && o.name.trim());
  } else if (existing.type === 'workflow') {
    patch.states = (c.states ?? []).filter((s) => s.name && s.name.trim());
  }
  if (existing.type === 'formula' && state.expression) patch.expression = state.expression;
  if (existing.type === 'attachments') patch.multiple = state.multiple !== false;
  if (existing.type === 'document') patch.kind = state.kind ?? 'markdown';
  if (fieldDialogCore.DEFAULTABLE.includes(existing.type)) {
    patch.default = c.default ?? null;
  }
  return patch;
}

/* A field edit redraws the table; the page and the grid must not snap back
   to the top-left (Kyle, 2026-08-23). */
async function keepScroll(redraw) {
  const grid = document.querySelector('.wv-grid');
  const scroller = grid?.parentElement;
  const x = window.scrollX, y = window.scrollY, left = scroller?.scrollLeft ?? 0;
  await redraw();
  requestAnimationFrame(() => {
    window.scrollTo(x, y);
    const again = document.querySelector('.wv-grid')?.parentElement;
    if (again) again.scrollLeft = left;
  });
}

function editFieldDialog(db, f) {
  fieldDialog(db, f, () => keepScroll(() => showDatabase(db.id)));
}

/* Column order IS fieldOrder, so a move is a schema write — drag a column and
   it is still there tomorrow. The order sent covers every field, document
   columns included, because the engine refuses a partial order rather than
   silently dropping what the grid cannot see. */
/* Blocks are reordered by reading the body back after the move: the nodes
   have already been put where the reader dropped them, so the DOM is the new
   order and no index arithmetic can disagree with it (Issue #89). */
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
  // The columns move IN PLACE — cells relocate, nothing repaints, scroll and
  // focus stay put (Kyle, 2026-08-22: the full redraw read as clunky flicker).
  // The schema write happens behind the move; if it fails, redraw to truth.
  // Must mirror drawDatabase's cols selection or the in-place move lands on
  // the wrong cell index.
  const cols = visibleCols(db);
  const fromIdx = cols.indexOf(fromName);
  const toIdx = cols.indexOf(toName);
  const table = document.querySelector('.wv-grid');
  if (table && fromIdx >= 0 && toIdx >= 0) {
    for (const row of table.querySelectorAll('tr')) {
      const cells = row.children;
      // Two anchored cells sit before the first field in every row — the
      // selection box and the # link — so field i lives at cell 2 + i.
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
    await api('PATCH', `/tables/${db.id}`, { fieldOrder: order });
    await loadSchema();
  } catch (err) {
    toast(err.message, true);
    onFail(); // the move did not hold — show the truth
  }
}


/* The "+" that closes the grid's header bar. A menu rather than a straight
   dialog because it replaces the "⚙ Fields" button in table view, so it has
   to keep relations and field management reachable — not just adding. */
/* The header "+" opens the add-field tray directly (Kyle, 2026-08-23):
   relation is a type in the grid and Manage fields is gone, so there is
   nothing left for a menu to offer. */
function addFieldMenuButton(db) {
  const btn = el('button', { class: 'add-field-btn', type: 'button', title: 'Add a field' }, '+');
  btn.addEventListener('click', (e) => { e.stopPropagation(); addFieldDialog(db); });
  return btn;
}

/* ---------- space page ---------- */

async function showSpace(spaceId) {
  const space = state.schema.find((s) => s.spaceId === spaceId);
  if (!space) return showHome();
  state.route = { page: 'space', spaceId };
  renderNav();
  const main = $('#main');
  main.replaceChildren(
    viewHeader({
      crumbs: [{ label: $('#ws-name').textContent || 'workspace', href: wsHomeHref() }],
      permalink: `${location.origin}${WS_PREFIX}/#/space/${spaceId}`,
      title: space.space,
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
      actions: [
        // A space has no CSV of its own — it is a container — so the menu
        // offers one export per table it holds, then the destructive act.
        dotsMenu([
          ...space.tables.map((d) => ({
            label: `Export ${d.name}.csv`,
            href: `${WS_PREFIX}/api/tables/${d.id}/export.csv`,
            download: `${d.name}.csv`,
          })),
          space.tables.length ? 'divider' : null,
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
  // The tables of this space, AS the Tables registry grid (Kyle, 2026-08-24):
  // the same rows the engine syncs, with every field — Description, Field
  // Order, Hidden Fields, the Fields relation — editable in place. Opening a
  // row opens the table, because the row IS the table.
  const reg = registryTable('tables');
  if (reg) {
    const res = await api('POST', `/tables/${reg.id}/query`, {});
    // Scoped by id (universal reference rule): a registry row belongs to this
    // space iff its sysId names one of the space's tables. Names can drift.
    const items = res.items.filter((i) => space.tables.some((t) => t.id === i.sysId));
    const onSaved = async () => {
      await loadSchema();
      await showSpace(spaceId);
      restoreGridFocus();
    };
    renderTable(main, reg, items, onSaved);
  }
  // A space draws its own map — itself and whatever it touches — instead of
  // sending the reader to the workspace-wide one (Kyle, 2026-08-24).
  const card = await relationMapCard('Relation map', { spaceId });
  if (card) main.append(card);
}

/* ---------- relation map (tables, relations, automations) ----------
   ONE map, drawn at three altitudes: the full page behind #/map, a card on
   the workspace home, and a card on a space page showing that space and
   whatever it touches. It replaces both of the maps that came before — the
   mermaid render (right content: user tables, grouped by space, a labelled
   arrow each) and the circle-layout SVG (right design: weave's own cards).
   Geometry is relmap-layout.js; this is the drawing. */

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

  // One arrowhead, referenced by every relation line.
  const defs = svgEl('defs');
  const marker = svgEl('marker', {
    id: 'relmap-arrow', viewBox: '0 0 8 8', refX: '7', refY: '4',
    markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse',
  });
  marker.append(svgEl('path', { d: 'M0,0 L8,4 L0,8 z', class: 'rel-arrow' }));
  defs.append(marker);
  svg.append(defs);

  // Space boxes first: they are ground, everything else sits on them.
  for (const g of map.groups) {
    svg.append(svgEl('rect', { x: g.x, y: g.y, width: g.w, height: g.h, rx: 14, class: 'space-box' }));
    svg.append(svgEl('text', { x: g.x + 14, y: g.y + 18, class: 'space-label' }, g.name));
  }

  for (const e of map.edges) {
    if (e.self) {
      // A relation onto its own table: a loop off the card's right edge.
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
    const g = svgEl('g', { class: 'table-node' + (n.foreign ? ' foreign' : ''), cursor: 'pointer' });
    g.addEventListener('click', () => { location.hash = `#/table/${n.id}`; });
    g.append(svgEl('rect', { x, y, width: n.w, height: n.h, rx: 10, class: 'node-box' }));
    g.append(svgEl('text', { x: n.x, y: y + 24, 'text-anchor': 'middle', class: 'node-title' }, n.name));
    // Inside its own space box the space name is redundant; a guest names it.
    g.append(svgEl('text', { x: n.x, y: y + 43, 'text-anchor': 'middle', class: 'node-sub' },
      n.foreign ? `${n.space} • ${WeaveTerm.count(n.entityCount, n.term)}` : WeaveTerm.count(n.entityCount, n.term)));
    svg.append(g);

    (autosByTable.get(n.id) ?? []).forEach((a, i) => {
      const ay = y + n.h + 6 + i * 25;
      const actions = a.actions.map((x) => (AUTO_ACTION[x.type] ?? (() => 'webhook'))(x)).join(', ');
      const trig = a.trigger.type === 'state-changed' ? `${a.trigger.field}→${a.trigger.toState ?? '*'}`
        : a.trigger.type === 'field-updated' ? `${a.trigger.field} changed` : 'created';
      // The pill never outgrows its card: a wider one leaves the space box
      // and, in the first column, the canvas itself.
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

/* The same view as a card, for a page that is mostly something else. */
async function relationMapCard(title, { spaceId = null } = {}) {
  const card = el('div', { class: 'card panel home-map' },
    el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, title)),
    el('div', { class: 'card-body' }, el('div', { class: 'wv-empty' }, '…')));
  const [schema, automations] = await Promise.all([api('GET', '/schema'), api('GET', '/automations').catch(() => [])]);
  const tables = schema.flatMap((s) => s.tables.map((t) => ({ ...t, space: s.space, spaceId: s.spaceId })));
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
  const [schema, automations] = await Promise.all([api('GET', '/schema'), api('GET', '/automations')]);
  const tables = schema.flatMap((s) => s.tables.map((t) => ({ ...t, space: s.space, spaceId: s.spaceId })));
  main.append(relationMapView(tables, automations));
}

/* ---------- the embedded document editor (Feature #45) ----------
   Vditor in `ir` mode: the rendered document is the editing surface, so there
   is no mode to switch, nothing to preview and nothing to save by hand. The
   toolbar is hidden — every markdown block is reachable from the slash menu
   below, which keeps the document the only chrome on the page. */

const DOC_SAVE_DEBOUNCE = 600;
const liveEditors = new Set();
const pendingDocSaves = new Map();


/* ---------- the slash menu ----------
   With the toolbar hidden this menu is the ONLY way to reach a markdown
   construct, so it has to read like a menu and not like a list of syntax:
   a glyph for what the thing is, its name, and — on the right of every row —
   the markdown it actually writes, so the menu teaches the syntax while it
   inserts it. Commands are grouped by what they do rather than alphabetically:
   blocks you insert, references to other records, and formatting.

   Line-prefix blocks carry placeholder text on purpose. A marker with nothing
   after it is not a block: "# " round-tripped through Lute as "#\n" and "> "
   vanished to "\n", so every heading, quote and list item the menu inserted
   came out empty. Placeholders make the block real and visible, and the writer
   types over them. */
const SLASH_GROUPS = [
  ['all', 'ALL COMMANDS'],
  ['reference', 'REFERENCE'],
  ['format', 'FORMAT · APPLIES TO SELECTION'],
];

/* Picking a reference opens the ⌘K search instead of inserting text. It
   travels through Vditor as a value, because a hint item can only insert — so
   the editor's own input handler recognises the marker, takes it back out and
   hands over to the picker. U+2063 is invisible and not something a writer
   types by accident. */
const refMarker = (kind) => `⁣ref:${kind}⁣`;
/* Same trick for a raw HTML block, for a different reason: Vditor's insert
   path spins what it inserts through Lute in a context that drops an html
   block outright (measured: "/raw html" produced an empty document), while a
   whole-document write round-trips it untouched. The marker is what the menu
   inserts; the input handler swaps it for the block. */
const DEFERRED_INSERTS = { '⁣raw-html⁣': '<div>html</div>' };
const ENTITY_LINK_MARKER = refMarker('entity');
const REF_MARKER_RE = /⁣ref:(entity|table|space)⁣/;

/* The last thing the writer selected, remembered because typing "/" replaces
   the selection before any command can see it. A format command wraps that
   text instead of a placeholder, which is what "applies to selection" means
   from the writer's side. Short-lived on purpose: a selection from a minute
   ago is not what this "/" is about. */
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

/* One catalogue. `hint` is the syntax column, `icon` the leading glyph, and
   `aliases` are the words a writer is likely to type for something the label
   does not literally say ("h2", "checkbox", "hr"). `hidden` items never show
   on their own row — they exist so a query can promote a specific one, which
   is how "Heading 1–6" answers /h4 with a level-4 heading. */
function slashItems() {
  const wrap = (before, after = before) => {
    const picked = selectionForFormat();
    return `${before}${picked || 'text'}${after}`;
  };
  const headings = [1, 2, 3, 4, 5, 6].map((n) => ({
    label: `Heading ${n}`, icon: 'H', group: 'all', hidden: true,
    hint: `${'#'.repeat(n)} `, aliases: [`h${n}`, `heading${n}`],
    insert: `${'#'.repeat(n)} Heading`,
  }));
  return [
    { label: 'Text', icon: '¶', flat: 'document', group: 'all', hint: '—', aliases: ['paragraph', 'plain'], insert: 'Text' },
    { label: 'Heading 1–6', icon: 'H', group: 'all', hint: '#…######', aliases: ['title'], insert: '# Heading' },
    ...headings,
    { label: 'Bulleted list', icon: '•', group: 'all', hint: '-', aliases: ['ul', 'unordered'], insert: '- List item' },
    { label: 'Numbered list', icon: '1.', group: 'all', hint: '1.', aliases: ['ol', 'ordered'], insert: '1. List item' },
    { label: 'Task list', icon: '☑', flat: 'ticksquare', group: 'all', hint: '- [ ]', aliases: ['todo', 'checkbox'], insert: '- [ ] To do' },
    { label: 'Quote', icon: '❝', group: 'all', hint: '>', aliases: ['blockquote'], insert: '> Quote' },
    /* No language on the fence: the content decides. An unlabelled block is
       auto-detected and highlighted as what it actually is — json, html, a
       mermaid source, a shell session — and anything unrecognised stays plain
       text. Naming a language on the fence still wins (Issue #35). */
    { label: 'Code block', icon: '#', group: 'all', hint: '```', aliases: ['fence', 'pre'], insert: '```\ncode\n```' },
    { label: 'Mermaid diagram', icon: '◈', flat: 'graph', group: 'all', hint: '```mermaid', aliases: ['chart', 'graph', 'flow'], insert: '```mermaid\ngraph TD\n  A --> B\n```' },
    { label: 'Table', icon: '▦', flat: 'category', group: 'all', hint: '| a | b |', aliases: ['grid'], insert: '| Column | Column |\n| --- | --- |\n| Cell | Cell |' },
    /* The divider inserts ***, not --- : Lute reads an inserted --- pair as
       YAML front matter and renders a yaml code block (Kyle, 2026-08-23:
       "divider still makes a code block"). Same rule, unambiguous spelling. */
    { label: 'Divider', icon: '—', group: 'all', hint: '***', aliases: ['hr', 'rule', 'separator'], insert: '\n***\n' },
    /* A hard break, the markdown way (backslash-newline). Before this item,
       "/line break" matched nothing and Enter took whatever row was first —
       usually a code block (Kyle, 2026-08-23). */
    { label: 'Line break', icon: '↵', group: 'all', hint: '\\ + ⏎', aliases: ['br', 'newline', 'return'], insert: '\\\n' },
    { label: 'Image', icon: '▤', flat: 'image', group: 'all', hint: '![](…)', aliases: ['picture', 'photo'], insert: '![alt](url)' },
    // Raw HTML is a block Lute passes through untouched: the escape hatch for
    // anything markdown has no syntax for.
    { label: 'Raw HTML', icon: '</>', group: 'all', hint: '<div>', aliases: ['embed', 'html'], insert: '⁣raw-html⁣' },

    { label: 'Entity', icon: '#', group: 'reference', hint: '[[Task#12]]', aliases: ['record', 'row', 'link entity', 'mention'], insert: refMarker('entity') },
    { label: 'Table', icon: '▦', flat: 'category', group: 'reference', hint: '[[table:…]]', aliases: ['database', 'link table'], insert: refMarker('table') },
    { label: 'Space / workspace', icon: '◇', group: 'reference', hint: '[[space:…]]', aliases: ['link space'], insert: refMarker('space') },

    { label: 'Bold', icon: 'B', group: 'format', hint: '**…**', aliases: ['strong'], insert: wrap('**') },
    { label: 'Italic', icon: 'I', group: 'format', hint: '*…*', aliases: ['emphasis', 'em'], insert: wrap('*') },
    { label: 'Strikethrough', icon: 'S', group: 'format', hint: '~~…~~', aliases: ['strike', 'delete'], insert: wrap('~~') },
    { label: 'Inline code', icon: '`', group: 'format', hint: '`…`', aliases: ['monospace'], insert: wrap('`') },
    { label: 'Link', icon: '⛓', flat: 'link', group: 'format', hint: '[…](…)', aliases: ['url', 'href'], insert: `[${selectionForFormat() || 'text'}](url)` },
  ];
}

// [[Space/Table#12|Name]] — qualified, so a table name shared by two spaces
// cannot resolve to the wrong one. The label keeps the chip readable when the
// reference is read as plain markdown.
function entityReference(hit) {
  return `[[${hit.db}#${hit.publicId}|${hit.name}]]`;
}

/* What the picked search result becomes, per reference kind — the same four
   shapes the renderer's mention parser accepts. */
function referenceFor(kind, hit) {
  if (hit.kind === 'entity') return entityReference(hit);
  if (hit.kind === 'table') return `[[table:${hit.name}]]`;
  if (hit.kind === 'space') return `[[space:${hit.name}]]`;
  return `[[workspace|${hit.name}]]`;
}

/* Ranking: a query promotes its best matches into an INSERT group at the top
   and leaves the rest of the catalogue where it is, so the menu narrows
   without ever becoming a dead end — a typo still shows every command. */
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
      // Only a strong match is promoted: a query that merely appears inside a
      // word ("ta" in "italic") is not what the writer meant, and a wrong row
      // at the top is worse than no INSERT group at all.
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

/* `#` IS the entity search. Picking a reference used to be two steps — the
   /entity command, then a dialog to search in — and the dialog is the part
   nobody wants: the caret is already where the reference goes, and the
   document is a perfectly good search box. Type # and the workspace's records
   filter under the caret; ↑/↓ move, Enter drops the reference in, and the chip
   layer turns it into a chip. Two characters minimum, so "# Heading" is still
   a heading and never a search. */
const ENTITY_HINT_MIN = 2;
const entityHintCache = new Map();

async function entityHint(query) {
  const q = String(query ?? '').trim();
  if (q.length < ENTITY_HINT_MIN) return [];
  let hits = entityHintCache.get(q);
  if (!hits) {
    try {
      hits = (await api('GET', `/search?q=${encodeURIComponent(q)}&limit=12`))
        .filter((h) => h.kind === 'entity');
    } catch { return []; } // a search that fails is a menu that does not open
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

/* A row's glyph: the vendored flat icon when the row names one, otherwise the
   typographic mark, which for B / I / S / ` / H IS the icon. Never an emoji —
   a colour picture in a monochrome menu ignores the text colour and the
   theme. `link` is drawn here because the Iconly free set has no chain. */
// Feather's `link` (MIT) — the interlocked-chain everyone recognises; the
// hand-drawn approximation it replaces read as two broken arcs.
const SLASH_LINK_GLYPH = '<svg viewBox="-2 -2 28 28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>'
  + '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
function slashGlyph(item) {
  if (item.flat === 'link') return SLASH_LINK_GLYPH;
  const flat = item.flat && window.ICONLY_FLAT?.[item.flat];
  return flat
    ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${flat}</svg>`
    : escapeHtmlText(item.icon);
}

// The catalogue is weave's own text, but it reaches the menu as innerHTML and
// a remembered SELECTION rides into it — which is the writer's text.
function escapeHtmlText(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Editor chrome, document content and code highlighting each take a theme;
// all three follow weave's data-bs-theme so a toggle does not leave a light
// document sitting inside a dark page.
function vditorTheme() {
  const dark = document.documentElement.dataset.bsTheme === 'dark';
  /* The hljs palette follows the theme because the code SLAB does (Kyle,
     2026-08-26: "dark code block background in light mode dont make sense").
     That pairing is the whole of Issue #81 — the slab was dark in both themes
     while the palette switched, so github's white-page tokens landed on a
     near-black ground at 2.7:1. Either they move together or neither does;
     --wv-code-bg in style.css is the other half of this line. */
  return { ui: dark ? 'dark' : 'classic', content: dark ? 'dark' : 'light', hljs: dark ? 'github-dark' : 'github' };
}

/* Every `new Vditor` appends another copy of the hidden 53-symbol icon
   sprite to <body>, and destroy() never removes it — the one leak a
   mount-per-focus editor would accumulate (measured: +1428 nodes over 12
   cycles, all sprite). One sheet serves every editor; the rest go. */
function dedupeVditorSprites() {
  const sprites = [...document.querySelectorAll('body > svg')].filter((v) => v.querySelector('symbol'));
  for (const extra of sprites.slice(1)) extra.remove();
}

/* ---------- table keys (Kyle, 2026-08-23) ----------
   Vditor already owns every table operation: Tab/⇧Tab walk cells, ⌘= adds a
   row below, ⇧⌘F above, ⇧⌘= a column, ⌘-/⇧⌘- delete. What writers reach for
   first is plain Enter and Tab, so those are added ON TOP by replaying the
   chord — one implementation of each operation, Vditor's own.
   Enter: row below. Shift+Enter on an all-empty row: delete it. Tab in the
   very last cell: grow the table by a row, then Vditor's own Tab moves the
   caret into it. */
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
  // Dispatched on the IR element Vditor listens on — an event targeted at the
  // host never reaches a descendant's listener. Vditor's modifier check is
  // exclusive (mac: metaKey && !ctrlKey; elsewhere the reverse), so the
  // replay sets exactly the platform's own modifier.
  const mac = /Mac|iPhone/.test(navigator.platform);
  const ir = host.querySelector('.vditor-ir .vditor-reset') ?? host;
  ir.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: mac, ctrlKey: !mac, shiftKey: shift, bubbles: true, cancelable: true }));
}
/* The slash menu opens upward when the caret sits low — and a 20-row menu
   can overflow the top of the window, hiding exactly the row the query
   promoted (the writer then reads the wrong first row). Clamp it into the
   viewport and let it scroll instead. */
function attachHintClamp(host) {
  const clamp = (hint) => {
    hint.style.maxHeight = `${Math.max(200, innerHeight - 24)}px`;
    hint.style.overflowY = 'auto';
    const top = hint.getBoundingClientRect().top;
    if (top < 8) hint.style.top = `${parseFloat(hint.style.top || '0') + (8 - top)}px`;
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      const hint = m.target.classList?.contains('vditor-hint') ? m.target : null;
      if (hint && hint.style.display !== 'none') clamp(hint);
    }
  }).observe(host, { subtree: true, attributes: true, attributeFilter: ['style'] });
}

function attachTableKeys(host) {
  host.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.isComposing) return;
    const cell = tableCellOf(document.getSelection()?.anchorNode);
    if (!cell || !host.contains(cell)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      replayChord(host, '='); // row below
    } else if (e.key === 'Enter' && e.shiftKey) {
      if (!rowIsEmpty(cell)) return; // a full row is never deleted from a key
      e.preventDefault(); e.stopImmediatePropagation();
      replayChord(host, '-'); // delete row
    } else if (e.key === 'Tab' && !e.shiftKey) {
      const table = cell.closest('table');
      const cells = table.querySelectorAll('td, th');
      const lastCell = cells[cells.length - 1];
      if (cell !== lastCell) return; // mid-table Tab is Vditor's cell walk
      replayChord(host, '='); // grow first; Vditor's Tab then enters the new row
    }
  }, { capture: true });
}

/* The icon set Kyle approved in the Toolbar Lab artifact (2026-08-30) —
   the mockup's stroke-drawn glyphs, not Vditor's sprite icons. Each entry
   overrides the built-in item's icon via mergeToolbar's Object.assign;
   hotkeys, tips and behavior stay Vditor's. */
// Stroke width rides inline so it beats Vditor's stroke-width:0 reset AND
// can thin per glyph — the dense ones (numbered list, checklist) read as
// clots at 2px in a 16px box (Kyle, 2026-08-31).
const WV_TB_SVG = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="stroke-width:${w}px">${d}</svg>`;
const WV_TB_ICONS = {
  headings: WV_TB_SVG('<path d="M6 4v16M18 4v16M6 12h12"/>'),
  bold: WV_TB_SVG('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  italic: WV_TB_SVG('<path d="M11 5h6M7 19h6M14 5l-4 14"/>'),
  strike: WV_TB_SVG('<path d="M5 12h14M16 6.5C15.3 5.6 13.8 5 12 5c-2.5 0-4 1.2-4 2.8 0 .8.3 1.4.9 1.9M8 17.5c.7.9 2.2 1.5 4 1.5 2.5 0 4-1.2 4-2.8 0-.8-.3-1.4-.9-1.9"/>'),
  'inline-code': WV_TB_SVG('<path d="M9 8l-4 4 4 4M15 8l4 4-4 4"/>'),
  link: WV_TB_SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.6l-1.2 1.2M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 1 0 5.7 5.6l1.2-1.2"/>'),
  list: WV_TB_SVG('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),
  'ordered-list': WV_TB_SVG('<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.8 11.5a1.5 1.5 0 0 1 2.7 1c0 1-2.7 1.6-2.7 3h3"/>', 1.4),
  check: WV_TB_SVG('<rect x="3" y="4" width="7" height="7" rx="1.5"/><path d="M5 7.5l1.5 1.5 2.5-3M14 7.5h7M14 16.5h7M3.5 16.5l2 2 3.5-4"/>', 1.4),
  outdent: WV_TB_SVG('<path d="M13 6h8M13 12h8M13 18h8M8 9l-4 3 4 3"/>'),
  indent: WV_TB_SVG('<path d="M13 6h8M13 12h8M13 18h8M4 9l4 3-4 3"/>'),
  quote: WV_TB_SVG('<path d="M9 7c-2.5.7-4 2.6-4 5.5V17h5v-5H7c0-2 .8-3.2 2-3.8zM19 7c-2.5.7-4 2.6-4 5.5V17h5v-5h-3c0-2 .8-3.2 2-3.8z" fill="currentColor" stroke="none"/>'),
  code: WV_TB_SVG('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 10l-2 2 2 2M15 10l2 2-2 2"/>'),
  table: WV_TB_SVG('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 10h18M9 5v14M15 5v14"/>'),
  line: WV_TB_SVG('<path d="M4 12h16"/>'),
  undo: WV_TB_SVG('<path d="M8 7L4 11l4 4M4 11h10a5 5 0 0 1 0 10h-3"/>'),
  redo: WV_TB_SVG('<path d="M16 7l4 4-4 4M20 11H10a5 5 0 0 0 0 10h3"/>'),
  upload: WV_TB_SVG('<path d="M12 16V5M8 9l4-4 4 4M4 19h16"/>'),
};

function mountDocEditor(host, { value, placeholder, onInput, onBlur, autoFocus, entityId }) {
  const t = vditorTheme();
  const chips = attachRefChips(host);
  attachCodeAuto(host);
  attachTableKeys(host);
  attachHintClamp(host);
  const editor = new Vditor(host, {
    mode: 'ir',
    // Vendored, not the public CDN default: a weave instance with no internet
    // still has to render its own documents.
    cdn: '/vendor/vditor',
    value,
    placeholder,
    lang: 'en_US',
    icon: 'ant',
    theme: t.ui,
    minHeight: 160,
    // weave saves server-side on every pause; a localStorage draft would only
    // compete with that and resurrect stale text.
    cache: { enable: false },
    counter: { enable: false },
    // Kyle's Toolbar Lab pick (2026-08-30): the full set as a selection
    // bubble — the bar floats over selected text (attachToolbarBubble)
    // instead of sitting in the flow, so the document keeps a clean top
    // edge. The slash menu stays the full catalogue (references, mermaid,
    // raw HTML, math) the toolbar never holds. hide stays false: Vditor
    // must never fight the bubble layer for visibility.
    toolbar: [
      'headings', 'bold', 'italic', 'strike', 'inline-code', 'link', '|',
      'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
      'quote', 'code', 'table', 'line', '|',
      'undo', 'redo', 'upload',
    ].map((n) => (n === '|' ? n : { name: n, icon: WV_TB_ICONS[n] })),
    toolbarConfig: { hide: false, pin: false },
    upload: {
      multiple: true,
      // Everything weave stores is uploadable — the files API takes any
      // mime. Images embed, everything else links.
      handler: (files) => uploadDocFiles(files, entityId, () => editor, onInput),
    },
    // The outline lives outside the editor (the dash rail), so Vditor's own
    // panel stays off rather than fighting it for the left gutter.
    outline: { enable: false, position: 'left' },
    preview: {
      hljs: { enable: true, style: t.hljs, lineNumber: false },
      theme: { current: t.content, path: '/vendor/vditor/dist/css/content-theme' },
      // KaTeX is Vditor's default engine, but the default is not a decision:
      // naming it here is what makes "only KaTeX is vendored" a choice.
      // $…$ / $$…$$ load katex + mhchem from the vendored tree; the other
      // fence engines (graphviz, echarts, plantuml, mindmap, abc, flowchart)
      // are NOT vendored and those fences degrade to plain code blocks.
      math: { engine: 'KaTeX' },
    },
    hint: { emoji: {}, extend: [{ key: '/', hint: slashHint }, { key: '#', hint: entityHint }] },
    // Every decoration pass on this host starts once the editor is actually
    // built — an attach-time schedule can fire before Vditor has a surface.
    after: () => {
      dedupeVditorSprites();
      /* `:bell:` is an icon here, never an emoji (Kyle, 2026-09-02): Lute
         ships GitHub's shortcode table and would paint the bell emoji for
         the same text the icon set draws. Parsing is switched off on this editor's Lute,
         and a document that already carries a token is rendered again so
         the first paint agrees with every later one. setValue does not
         fire input, so nothing is saved by the re-render. */
      editor.vditor?.lute?.SetEmoji?.(false);
      const md = editor.getValue();
      if (new RegExp(globalThis.WeaveEditorLib.ICON_TOKEN.source).test(md)) editor.setValue(md);
      scheduleDecorFor(host);
      /* Typing "/" replaces whatever was selected, so the selection has to be
         remembered before the menu can ask for it. Both events fire after the
         selection settles, and only a non-empty one is kept — the collapsed
         selection left by the "/" itself must not erase it. */
      host.addEventListener('keyup', rememberSelection);
      host.addEventListener('mouseup', rememberSelection);
      /* Vditor moves the slash menu's highlight on ↑/↓ but never scrolls to
         it, which is invisible in a menu of eight rows and useless in one of
         twenty. Runs after Vditor's own handler, so the class has moved. */
      host.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        requestAnimationFrame(() =>
          host.querySelector('.vditor-hint--current')?.scrollIntoView({ block: 'nearest' }));
      });
      attachToolbarBubble(host);
      attachFileTools(host, editor, onInput);
      if (autoFocus) editor.focus();
    },
    ...(onBlur ? { blur: () => onBlur() } : {}),
    input: (v) => {
      // A reference command arrives here as its marker, never as content.
      const ref = v.match(REF_MARKER_RE);
      if (ref) return pickReference(editor, v, ref[0], ref[1], onInput);
      for (const [marker, block] of Object.entries(DEFERRED_INSERTS)) {
        if (!v.includes(marker)) continue;
        const next = v.replace(marker, block);
        /* A microtask, not a timer or a frame: a headless page is
           backgrounded and Chrome throttles both there, so the swap would
           never land under test — and the writer would watch the marker sit
           in their document until something else woke the page. */
        queueMicrotask(() => {
          editor.setValue(next);
          editor.focus();
          onInput(next);
        });
        return;
      }
      onInput(v);
      scheduleDecorFor(host); // chips, rail, folds and code detection
    },
  });
  liveEditors.add(editor);
  return editor;
}

/* ---------- toolbar bubble + uploads (Kyle's Toolbar Lab pick, 2026-08-30) ----
   The toolbar never sits in the flow: it floats over the selection like
   Fibery's, and only while a selection exists in this editor. Vditor keeps
   owning every button; weave only owns where and when the bar is. */

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
  // The bubble stays while the writer is inside it — a headings-dropdown or
  // link-input click collapses the document selection, and the bar must not
  // vanish under the cursor mid-gesture.
  const inBar = bar.contains(document.activeElement) || bar.matches(':hover');
  const on = (range && !range.collapsed && root.contains(range.startContainer)
    && root.contains(range.endContainer)) || (inBar && bar.classList.contains('wv-show'));
  bar.classList.toggle('wv-show', !!on);
  if (!on || inBar) return;
  const r = range.getBoundingClientRect();
  const base = st.host.getBoundingClientRect();
  const barW = bar.offsetWidth, barH = bar.offsetHeight;
  const left = Math.max(0, Math.min(base.width - barW, r.left - base.left + r.width / 2 - barW / 2));
  // Above the selection; below it when the selection touches the host's top.
  const above = r.top - base.top - barH - 8;
  bar.style.left = `${left}px`;
  bar.style.top = `${above >= 0 ? above : r.bottom - base.top + 8}px`;
}

/* A microtask, not a frame: backgrounded pages throttle rAF to never, and
   the bubble must still work in a hidden tab under test. */
document.addEventListener('selectionchange', () => {
  for (const st of docBubbles) queueMicrotask(st.place);
});

/* Toolbar uploads land on the entity through the same files API every other
   surface uses; the doc then links what was stored — an image embeds, any
   other type gets a plain link. Returning a string is Vditor's error tip. */
async function uploadDocFiles(files, entityId, getEditor, onInput) {
  if (!entityId) return 'This document has no record to attach to';
  const editor = getEditor();
  for (const f of files) {
    const contentBase64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1] ?? '');
      r.onerror = () => rej(r.error);
      r.readAsDataURL(f);
    });
    let meta;
    try {
      meta = await api('POST', `/entities/${entityId}/files`, {
        name: f.name, mime: f.type || 'application/octet-stream', contentBase64,
      });
    } catch (e) { return `Upload failed: ${e.message}`; }
    const url = `${WS_PREFIX}/api/files/${meta.id}`;
    const mime = f.type || '';
    // Images and viewable documents embed as inline viewers (the raw-HTML
    // block passes through the renderer and every export); anything else
    // links. The hover toolbar can demote any viewer to a link later.
    const md = mime.startsWith('image/') ? `![${f.name}](${url})`
      : (mime === 'application/pdf' || mime === 'text/html')
        ? `\n<iframe class="wv-file" src="${url}" title="${f.name}"></iframe>\n`
        : `[${f.name}](${url})`;
    editor.insertValue(md + '\n');
  }
  onInput?.(editor.getValue());
  return null;
}

/* ---------- hover toolbar on file viewers (Kyle, 2026-08-31) ----------
   Every file viewer (an uploaded image, a pdf/html iframe) grows a small
   toolbar on hover with one action: show the file as a plain link. The
   rewrite happens in the markdown, so it survives save and export.
   ponytail: the reverse (link back to viewer) and persisting a resized
   width into the markdown are deliberate omissions until asked for. */

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


/* ---------- live [[…]] chips over the IR surface (Issue #86) ----------
   Lute is compiled Go and cannot learn weave's reference syntax, so the
   chips are a decoration pass OVER the editing surface, never a rewrite of
   it: the contenteditable DOM belongs to Lute's serializer, and anything
   injected there would leak into the stored markdown. Each editor gets a
   click-transparent sibling layer; resolved chips paint on top of the
   literal text and step aside while the caret sits inside a reference. */

const REF_CHIP_DEBOUNCE = 250;
const refChipLayers = new Set();
const refResolveCache = new Map(); // ref → { href, label, kind } | null (miss)

// Kick every decoration pass attached to one editor host (chips, rail, folds).
function scheduleDecorFor(host) {
  for (const s of [...refChipLayers, ...docRails, ...docFolds, ...docCodeAuto]) {
    if (s.host === host) s.schedule();
  }
}

/* ---------- unlabelled code blocks colour themselves ----------
   A fence with no language is plaintext to highlight.js: zero token spans,
   one colour, forever. Naming a language for the writer was the old answer
   (the slash command inserted ```js); detecting it is the better one — the
   block is highlighted as whatever it turns out to be, and content that is
   not recognisably code stays plain text rather than being coloured as a
   guess. Only the rendered half of the block is touched: the markdown lives
   in the editable <pre> beside it, so nothing here can change the document.
   Diagram and math fences belong to their own renderers and are left alone. */
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
    // Vditor fetches highlight.js when it renders the first code block, which
    // can land after this pass. Wait for it rather than never colouring.
    if ((st.tries = (st.tries ?? 0) + 1) < 20) st.schedule();
    return;
  }
  let applied = false;
  for (const code of st.host.querySelectorAll('.vditor-ir__preview > code')) {
    /* A language WE detected is not a language the fence named. Both leave a
       `language-x` class behind, and answering "already handled" to our own
       class means never looking again — so the two are told apart by the
       marker, not by the class.

       The same marker cannot be the whole answer either: this element belongs
       to Vditor, which re-renders the preview from the markdown. A re-render
       replaces the tokens while leaving the class and the marker on the
       element, and the block would then read as handled and stay plain for
       good. So the question is not "did we answer" but "is the answer still
       on the page". Under load that is the state a flaky
       `slash-commands` case has been landing in; it is a hypothesis, not a
       proven cause, and this guard costs nothing when it is wrong. */
    const ours = code.dataset.autoLang;
    if (!ours && /language-\S/.test(code.className)) continue; // the fence named a language
    const text = code.textContent ?? '';
    const answered = code.dataset.autoFor === text;
    if (answered && (!ours || code.querySelector('span'))) continue;
    code.dataset.autoFor = text;
    const lang = globalThis.WeaveEditorLib?.detectCodeLanguage(text);
    if (!lang) { delete code.dataset.autoLang; continue; } // prose, a note, a diagram source
    try {
      code.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      code.classList.add('hljs', `language-${lang}`);
      code.dataset.autoLang = lang;
      applied = true;
    } catch { /* the language is not in the vendored bundle */ }
  }
  /* Vditor renders the preview again after it has fetched highlight.js, which
     can land after this pass and take the tokens with it. Nothing types, so
     no input or selection event brings us back — look once more on our own.
     The guard above makes the second pass free when the tokens survived, and
     the counter stops the two of us trading renders forever. */
  if (applied && (st.rechecks = (st.rechecks ?? 0) + 1) <= 3) st.schedule();
  else if (!applied) st.rechecks = 0;
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

/* Caret and scroll re-evaluate every live decoration (chips and rails).
   Registered once — the sets empty on teardown, so idle listeners cost
   nothing. */
document.addEventListener('selectionchange', () => {
  for (const st of refChipLayers) st.schedule();
});
window.addEventListener('scroll', () => {
  for (const st of refChipLayers) st.schedule();
  for (const st of docRails) st.schedule();
}, true);
window.addEventListener('resize', () => {
  for (const st of docRails) st.schedule(); // an open outline re-pins its x
});

async function refreshRefChips(st) {
  if (!document.body.contains(st.host)) { refChipLayers.delete(st); return; }
  // The IR surface specifically: the host also carries Vditor's outline and
  // preview containers, each with an (empty) .vditor-reset of its own.
  const root = st.host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return;
  // Vditor owns the host and clears it when it builds (and rebuilds), so the
  // layer re-attaches itself instead of trusting any earlier append.
  if (!st.layer.isConnected) st.host.append(st.layer);
  const lib = globalThis.WeaveEditorLib;

  // The caret splits text nodes as it moves ("edit [[N" + "ote#1]] live"),
  // and a reference cut in two is invisible to a per-node scan. normalize()
  // merges the pieces without changing content — the DOM spec adjusts live
  // ranges (the selection included) across the merge.
  root.normalize();

  // Gather spans first: only visible paragraphs pay for geometry, and code
  // contexts never decorate (code is literal text by definition).
  const spans = [], icons = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    // The IR surface is itself a <pre contenteditable>, so the root never
    // counts as a code context — only something nearer does.
    const codeCtx = n.parentElement?.closest(lib.REF_SKIP_SELECTOR);
    if (codeCtx && codeCtx !== root) continue;
    const found = lib.findRefSpans(n.nodeValue);
    // `:bell:` paints the bell over its literal the same way (Kyle, 2026-09-02).
    const iconsFound = lib.findIconSpans(n.nodeValue, inlineIconAccept);
    if (!found.length && !iconsFound.length) continue;
    const box = n.parentElement.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) continue;
    for (const s of found) spans.push({ node: n, ...s });
    for (const s of iconsFound) icons.push({ node: n, ...s });
  }

  await resolveRefs(spans.map((s) => s.ref));
  if (!document.body.contains(st.layer)) return; // torn down mid-flight

  const sel = getSelection();
  const caret = sel?.rangeCount ? sel.getRangeAt(0) : null;
  const base = st.layer.getBoundingClientRect();
  st.layer.replaceChildren();
  for (const s of spans) {
    const hit = refResolveCache.get(s.ref);
    if (!hit) continue; // a broken reference stays literal — nothing to open
    // The writer is inside this reference: editing stays plain text.
    if (caret?.startContainer === s.node && caret.startOffset >= s.start && caret.startOffset <= s.end) continue;
    const range = document.createRange();
    range.setStart(s.node, s.start);
    range.setEnd(s.node, s.end);
    const rects = range.getClientRects();
    if (rects.length !== 1) continue; // wrapped across lines: leave literal
    const r = rects[0];
    st.layer.append(el('a', {
      class: `mention mention-${hit.kind} doc-ref-chip`,
      href: hit.href,
      style: `left:${r.left - base.left}px; top:${r.top - base.top}px; width:${r.width}px; height:${r.height}px;`,
    }, s.label ?? hit.label));
  }
  // An icon chip: the icon alone, centred over the literal it covers (the
  // name is the tooltip — six characters of `:bell:` cannot also hold a word
  // beside a glyph), and the literal comes back the moment the caret enters
  // it — same rule as a reference, so typing `:bel` never fights a half-drawn
  // bell. The chip wears the ground it sits on — a striped table row, the
  // page — so it hides the colons without reading as a pill.
  const groundOf = (node) => {
    for (let n = node.parentElement; n && n !== document.body; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && bg !== 'transparent' && !/^rgba\(\d+, \d+, \d+, 0\)$/.test(bg)) return bg;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  for (const s of icons) {
    if (caret?.startContainer === s.node && caret.startOffset >= s.start && caret.startOffset <= s.end) continue;
    const range = document.createRange();
    range.setStart(s.node, s.start);
    range.setEnd(s.node, s.end);
    const rects = range.getClientRects();
    if (rects.length !== 1) continue;
    const r = rects[0];
    st.layer.append(el('span', {
      class: 'doc-icon-chip', title: s.token,
      style: `left:${r.left - base.left}px; top:${r.top - base.top}px; width:${r.width}px; height:${r.height}px; background:${groundOf(s.node)};`,
    }, iconEl(s.icon, 'wv-icon md-icon')));
  }
}

/* ---------- document outline dash rail (Issue #87) ----------
   A minimap in the left gutter of the entity page's document panels: one
   dash per heading (longer for higher levels), a tracker that follows the
   scroll, click to jump. Vditor's own outline stays disabled — it wants the
   same gutter and a tree; the rail says "where am I" without one. */

const DASH_READING_LINE = 80; // px below the viewport top: past the header
const docRails = new Set();

function attachDashRail(section, host) {
  // rail = the full-height gutter column; track = the sticky thing inside it,
  // so the map floats alongside the reader instead of scrolling off the top.
  const track = el('div', { class: 'doc-rail-track' });
  const st = {
    section, host, track, timer: 0,
    rail: el('nav', { class: 'doc-rail', title: 'Document outline' }, track),
  };
  /* The outline opens on click, never on hover: the resting rail stays a
     minimap, and the first click anywhere on it floats the headings at the
     viewport midpoint. Capture phase, so a dash click while closed opens
     the panel instead of jumping blind. */
  const onAway = (e) => { if (!st.rail.contains(e.target)) st.close(); };
  const onKey = (e) => { if (e.key === 'Escape') st.close(); };
  st.close = () => {
    st.rail.classList.remove('open');
    st.track.style.left = '';
    document.removeEventListener('click', onAway, true);
    document.removeEventListener('keydown', onKey);
  };
  st.rail.addEventListener('click', (e) => {
    if (st.rail.classList.contains('open')) return; // open: dash clicks jump
    e.stopPropagation();
    // Fixed positioning drops the gutter context, so the panel keeps the
    // rail's own x and only its y is the viewport's middle (see the CSS).
    st.track.style.left = `${st.rail.getBoundingClientRect().left}px`;
    st.rail.classList.add('open');
    st.schedule(); // refresh re-measures the x — a click can beat layout
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

// A heading's textContent includes Vditor's "# " marker span; chrome about
// the heading (rail tooltips, fold keys) wants the words, not the syntax.
function headText(h) {
  return [...h.childNodes]
    .filter((n) => !(n.nodeType === 1 && n.classList.contains('vditor-ir__marker')))
    .map((n) => n.textContent).join('').trim();
}

function refreshDashRail(st) {
  if (!document.body.contains(st.section)) { st.close(); docRails.delete(st); return; }
  const root = st.host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return;
  // Block headings only — direct children of the surface, never something a
  // preview rendered inside a code block. Headings hidden inside a fold
  // (display:none, so no offsetParent) leave the map with their section.
  const heads = [...root.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')]
    .filter((h) => h.offsetParent !== null);
  const lib = globalThis.WeaveEditorLib;
  const spec = lib.railSpec(heads.map((h) => ({ level: +h.tagName[1], text: headText(h) })));
  if (!spec.length) { st.close(); st.rail.remove(); return; } // < 3 headings: no rail
  if (!st.rail.isConnected) st.section.append(st.rail);
  // While open the track is fixed and carries the rail's x inline; the rail
  // itself keeps moving with layout, so every refresh re-pins the panel.
  if (st.rail.classList.contains('open')) st.track.style.left = `${st.rail.getBoundingClientRect().left}px`;
  const current = lib.currentSection(heads.map((h) => h.getBoundingClientRect().top), DASH_READING_LINE);
  // A dash is a tick plus its heading's words. The words are display:none
  // until the rail is hovered, so the resting rail stays a minimap and the
  // dash keeps the tick's own width.
  st.track.replaceChildren(...spec.map((d, i) => el('button', {
    class: 'doc-rail-dash' + (i === current ? ' active' : ''),
    type: 'button',
    title: d.text,
    // Instant, not smooth: a backgrounded tab never runs the animation
    // frames a smooth scroll rides on, and the jump is the point anyway.
    onclick: () => { heads[i].scrollIntoView({ block: 'start' }); st.close(); },
  },
  el('i', { class: 'doc-rail-tick', style: `width:${d.width}px` }),
  el('span', { class: 'doc-rail-label' }, d.text))));
  // The track caps at the viewport, so a long map has to bring the reader's
  // own section back into it — never while they are scrolling the map by hand.
  const marker = st.track.children[current];
  if (marker && st.track.scrollHeight > st.track.clientHeight && !st.rail.matches(':hover')) {
    st.track.scrollTop = Math.max(0, marker.offsetTop - st.track.clientHeight / 2);
  }
}

/* ---------- collapsible headings (Issue #88) ----------
   Folding a heading hides every block until the next heading of the same or
   a higher level. The caret lives in an overlay gutter layer — never inside
   the contenteditable — and the fold itself is a class on the hidden blocks,
   which Lute ignores when it reads the DOM back, so the stored markdown
   never changes. State persists per entity+field, keyed by level+text (two
   identical headings fold together — the key is the identity we have). */

const docFolds = new Set();

// Fold state per entity+field: read with two args, write with three.
function docFoldState(entityId, field, next) {
  const key = `weave-doc-folds:${entityId}:${field}`;
  if (next === undefined) {
    try { return new Set(JSON.parse(localStorage.getItem(key)) ?? []); }
    catch { return new Set(); }
  }
  localStorage.setItem(key, JSON.stringify([...next]));
  return next;
}

function attachHeadingFolds(host, entityId, field) {
  const st = { host, entityId, field, layer: el('div', { class: 'doc-fold-layer' }), timer: 0 };
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
  const levels = blocks.map((b) => (/^H[1-6]$/.test(b.tagName) ? +b.tagName[1] : null));
  const folded = docFoldState(st.entityId, st.field);
  const headKey = (h) => `${h.tagName[1]}:${headText(h)}`;

  // Apply the folds first (layout settles), then place carets on whatever
  // headings are still visible.
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
        for (const rail of docRails) rail.schedule(); // hidden headings leave the rail
      },
    }));
  });
  st.layer.replaceChildren(...carets);
}

/* One resolver for every reference kind: the same POST /api/markdown the
   previews render through, batched (one paragraph per reference) and cached.
   Misses cache as null so a dead reference is not re-asked on every pass. */
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
      // The API's canonical entity href targets the standalone document page
      // (right for exported HTML); inside the app the chip means the entity.
      let href = a.getAttribute('href');
      const ent = href.match(/\/e\/([^/]+)\/doc\.html$/);
      if (ent) href = `#/entity/${ent[1]}`;
      const kind = [...a.classList].find((c) => c.startsWith('mention-'))?.slice('mention-'.length) ?? 'entity';
      // The anchor may carry collapsed preview segments (.mention-fields);
      // the overlay chip's label is the name alone, never the hidden fields.
      a.querySelector('.mention-fields')?.remove();
      refResolveCache.set(ref, { href, label: a.textContent, kind });
    });
  } catch { /* resolution is decoration; a failed fetch leaves literals */ }
}

/* Hands off to the same search the ⌘K palette runs, so one search surface
   serves navigation and referencing. Picking writes the reference where the
   marker was; dismissing leaves the document as it was. */
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
    // Dismissing leaves the document as it was: the marker goes, nothing
    // takes its place, and the writer is back where they typed "/".
    onDismiss: () => settle(''),
  });
}

/* Exposed for the browser-driven slash-command suite: what a menu item
   produces depends on Lute and contenteditable, so the tests need the live
   instance to read the document back rather than scraping the DOM. */
window.__weaveEditors = liveEditors;
window.__weaveDocSaves = pendingDocSaves;
/* Same flush the page runs on unload and on route change. Exposed because a
   headless page is backgrounded, and Chrome throttles timers there — the
   debounce is not a usable clock in a test, so the suite asks for the write
   instead of waiting for one. */
window.__weaveFlushDocSaves = flushDocSaves;

function retheme() {
  const t = vditorTheme();
  for (const ed of liveEditors) {
    try { ed.setTheme(t.ui, t.content, t.hljs); } catch { /* editor not ready yet */ }
  }
}

/* A pause in typing is the save. Keyed per entity+field so two document
   sections on one page cannot cancel each other's writes. */
function scheduleDocSave(entityId, field, value, statusEl) {
  const key = `${entityId}::${field}`;
  clearTimeout(pendingDocSaves.get(key)?.timer);
  if (statusEl) statusEl.textContent = '·';
  const write = async () => {
    pendingDocSaves.delete(key);
    try {
      await api('PUT', `/entities/${entityId}/doc`, { field, doc: value });
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

// Leaving the page must not cost the last few keystrokes.
function flushDocSaves() {
  for (const { timer, write } of [...pendingDocSaves.values()]) {
    clearTimeout(timer);
    write();
  }
}
window.addEventListener('beforeunload', flushDocSaves);

function teardownDocEditors() {
  flushDocSaves();
  for (const ed of liveEditors) {
    try { ed.destroy(); } catch { /* already gone with the DOM */ }
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
}

// Collapse state per entity+field: read with two args, write with three.
function docSectionCollapse(entityId, field, next) {
  const key = `weave-doc-collapsed:${entityId}:${field}`;
  if (next === undefined) return localStorage.getItem(key) === '1';
  localStorage.setItem(key, next ? '1' : '');
  return next;
}

/* ---------- entity page ---------- */

async function showEntity(id) {
  let entity;
  try {
    entity = await api('GET', `/entities/${id}`);
  } catch {
    return showHome();
  }
  // The crumb is the path taken: an entity reached from another entity
  // keeps that entity in the trail (breadcrumbs.js); any other origin
  // starts it fresh.
  const hop = entityHop(entity);
  state.trail = weaveBreadcrumbs.pushTrail(state.trail, state.route, hop);
  state.route = { page: 'entity', id, dbId: entity.dbId, entity: hop };
  renderNav();
  const main = $('#main');
  main.replaceChildren();
  await renderEntityView(entity, { mount: main, refresh: () => showEntity(id) });
}

function entityHop(entity) {
  const db = allTables().find((d) => d.id === entity.dbId);
  return { id: entity.id, name: entity.name, space: db?.space ?? '', spaceId: db?.spaceId ?? '', table: db?.name ?? entity.db, tableId: entity.dbId };
}

/* The one entity rendering. The full page and the side peek (Feature #39)
   mount the SAME view — the peek is not a preview, it is the entity. Peek
   mode changes only what must change: no route/nav writes, refresh redraws
   the panel, deleting closes it instead of navigating, and mounted editors
   are handed back for scoped teardown when the panel goes. */
async function renderEntityView(entity, { mount, refresh, inPeek = false, onClose = null, editors = null }) {
  const id = entity.id;
  const db = allTables().find((d) => d.id === entity.dbId);

  const nameF = nameFieldOf(db);
  const computed = nameF?.type === 'formula';
  const nameInput = el('input', {
    class: 'name-edit' + (computed ? ' computed' : ''), value: entity.name,
    readonly: computed ? '' : undefined,
    title: computed ? `computed name — ƒ ${nameF.expression ?? ''}` : null,
  });
  if (!computed) nameInput.addEventListener('change', async () => {
    try { await api('PATCH', `/entities/${id}`, { values: { [nameF?.name ?? 'Name']: nameInput.value } }); toast('Renamed'); }
    catch (err) { toast(err.message, true); }
  });

  /* Activity is a system relation, not a log printed into the page: these are
     the entity's own rows of the workspace Activity table, so each one links
     into that table the way any related record would. Ten of them — the pane
     answers "what just happened here", and the table answers everything
     else. */
  const recent = [...entity.activity].reverse().slice(0, ACTIVITY_PANE_ROWS);
  const firstIndex = entity.activity.length - 1;
  const actBody = el('div', { class: 'card-body' },
    ...recent.map((a, n) => el('a', {
      class: 'activity-item', href: `#/activity/${id}:${firstIndex - n}`,
      title: 'Open this event',
    }, `${new Date(a.ts).toLocaleString()} — ${activitySummary(a)}`)),
    recent.length ? null : el('span', { class: 'wv-empty' }, 'Nothing has happened here yet.'));
  const actPanel = el('div', { class: 'card panel' },
    el('div', { class: 'card-header' },
      el('h3', { class: 'card-title' }, 'Activity'),
      el('a', { class: 'panel-link', href: `#/activity/${id}` },
        entity.activity.length > recent.length ? `All ${entity.activity.length} →` : 'Open table →')),
    actBody);

  // Upper-left ⋯ menu: whole-entity downloads + delete (with confirmation).
  const entBase = `${WS_PREFIX}/e/${id}/entity`;
  const dlBtn = dotsMenu([
    ...['md', 'html', 'pdf'].map((ext) => ({
      label: `Download .${ext}`, href: `${entBase}.${ext}`,
      download: `${(entity.name || 'entity')}.${ext}`,
    })),
    'divider',
    // Deleting is recoverable now, so it is a plain item with an undo rather
    // than a hold-to-confirm. The irreversible purge lives in the trash view.
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

  /* Crumb row, then a title row that ends in the ⋮ — the same two-row shape
     viewHeader() builds for tables, boards, lists and spaces, so the menu is
     in one place across the app. */
  // The eye (Feature #114), the table's own: one hidden set per table, so a
  // field hidden here is hidden in the grid and back. No Rows section — a
  // page has no rows to show deleted.
  // Comments + activity are a side column the reader asks for: off by
  // default, remembered per browser once opened.
  const sideOpen = localStorage.getItem('wv-entity-side') === '1';
  const activityBtn = el('button', {
    class: 'btn btn-sm activity-btn' + (sideOpen ? ' active-toggle' : ''), title: 'Comments & activity', 'aria-pressed': String(sideOpen),
    onclick: () => { localStorage.setItem('wv-entity-side', sideOpen ? '0' : '1'); refresh(); },
  }, `Activity${entity.comments.length ? ` · ${entity.comments.length}` : ''}`);
  const eye = el('button', { class: 'btn btn-sm eye-btn', title: 'Show / hide fields', 'aria-label': 'Show or hide fields' }, eyeGlyph());
  eye.addEventListener('click', (e) => { e.stopPropagation(); fieldVisibilityPopover(eye, db, 0, { redraw: refresh, rowsSection: false }); });
  /* One entity surface: the full page IS the dock's expanded pose, so its
     crumb row wears the same pose controls the split dock wears — the
     inward arrows re-dock beside the table, ✕ closes to the table. */
  const poseControls = (!inPeek && db) ? [
    el('button', {
      class: 'btn btn-sm pose-btn', type: 'button',
      title: 'Collapse (⌘⇧E)', 'aria-label': 'Collapse — dock beside the table',
      onclick: () => collapseToSplit(entity),
    }, poseGlyph(true)),
    el('button', {
      class: 'btn btn-sm', type: 'button',
      title: 'Close', 'aria-label': 'Close — back to the table',
      onclick: () => { location.hash = `#/table/${entity.dbId}`; },
    }, iconEl('✕')),
  ] : [];
  mount.append(
    el('div', { class: 'view-header' },
      el('div', { class: 'crumb crumb-row' },
        el('span', { class: 'crumb-path' },
        ...(inPeek
          ? [el('a', { href: `#/table/${entity.dbId}` }, entity.db), ' › ']
          : weaveBreadcrumbs.entityCrumbs($('#ws-name').textContent || 'workspace', state.trail, entityHop(entity))
            .map((c, i) => i === 0 ? [el('a', { href: wsHomeHref() }, c.label), ' › '] : [el('a', { href: c.href }, c.label), ' › ']).flat()),
        el('span', {
          class: 'permalink-copy', title: 'Copy permalink',
          onclick: () => copyText(`${location.origin}${WS_PREFIX}/e/${id}`, 'Permalink copied'),
        }, `#${entity.publicId} ⧉`)),
        el('span', { class: 'crumb-actions wv-toolbar' }, activityBtn, eye, dlBtn, ...poseControls)),
      el('div', { class: 'wv-toolbar entity-head' }, nameInput)),
  );
  /* The crumb's table link on the full page means "re-dock", not "leave":
     the split shows the same table the link names, entity still in hand. */
  if (!inPeek && db) {
    mount.querySelector(`.crumb-path a[href="#/table/${entity.dbId}"]`)?.addEventListener('click', (e) => {
      e.preventDefault();
      collapseToSplit(entity);
    });
  }

  const grid = el('div', { class: 'entity-grid' });
  grid.classList.toggle('side-open', sideOpen);
  mount.append(grid);
  const left = el('div');
  const right = el('div', { class: 'entity-side' });
  grid.append(left, right);

  /* One document section per document field — built here, placed by the
     ordered body below. The rendered document IS the
     editor — no edit mode, no preview toggle, no save button. The section
     title is a quiet collapsible line rather than a card header, so nothing
     competes with the document for attention. */
  const docSection = (f) => {
    const fmtBase = `${WS_PREFIX}/e/${id}/doc/${encodeURIComponent(f.name)}`;
    const host = el('div', { class: 'doc-editor' });
    const status = el('span', { class: 'doc-status', title: 'Saved automatically' });

    // MD / MMD / PDF survive as downloads. They were view modes when the frame
    // could swap its source; with the editor always live they are exports.
    const dl = dotsMenu(
      ['md', 'mmd', 'pdf', 'html'].map((ext) => ({
        label: `Download .${ext}`, href: `${fmtBase}.${ext}`,
        download: `${entity.name || 'document'}-${f.name}.${ext}`,
      })),
      { title: `${f.name} downloads`, extraClass: 'doc-dl' });

    const body = el('div', { class: 'doc-section-body' }, host);
    /* The field's DECLARED kind picks the surface (Kyle, 2026-08-31): an
       html field runs in its frame, a code field edits in the code box, and
       only an undeclared field falls back to sniffing its content. An HTML
       document runs in its own frame here; the source editor is one </>
       toggle away — mounted on first use, because an editor mounted into a
       hidden box measures nothing and stays blank. */
    const mode = globalThis.WeaveEditorLib.docViewMode(f.kind, entity.docs?.[f.name] ?? '');
    const isApp = mode === 'app';
    const appFrame = isApp ? el('iframe', { class: 'doc-app', src: `${fmtBase}.html`, allowfullscreen: '', allow: 'fullscreen', title: f.name }) : null;
    let showingSource = false;
    let mounted = false;
    const sourceToggle = isApp ? el('span', {
      class: 'doc-anchor', title: 'Edit source',
      onclick: () => {
        showingSource = !showingSource;
        host.classList.toggle('hidden', !showingSource);
        appFrame.classList.toggle('hidden', showingSource);
        sourceToggle.classList.toggle('active', showingSource);
        if (showingSource && !mounted) { mounted = true; mountSourceEditor(); }
        if (!showingSource) appFrame.src = appFrame.src; // pick up what was typed
      },
    }, '</>') : null;
    if (isApp) { host.classList.add('hidden'); body.prepend(appFrame); }
    const caret = el('button', {
      class: 'doc-caret', type: 'button', title: 'Collapse section',
      onclick: () => {
        const open = body.classList.toggle('hidden');
        caret.classList.toggle('closed', open);
        docSectionCollapse(id, f.name, open);
      },
    });
    const section = el('section', { class: 'doc-section' },
      el('div', { class: 'doc-section-head', draggable: 'true' },
        el('span', { class: 'opt-grip', title: 'Drag to reorder' }, '⠿'),
        caret,
        el('span', { class: 'doc-section-name' }, f.name),
        sourceToggle,
        el('span', {
          class: 'doc-anchor', title: 'Expand',
          onclick: () => expandDocument(grid, `${fmtBase}.html`, f.name, isApp ? {} : { node: host }),
        }, iconEl('⛶')),
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
    const folds = attachHeadingFolds(host, id, f.name);
    const mountEditor = () => {
      const ed = mountDocEditor(host, {
        value: entity.docs?.[f.name] ?? '',
        entityId: id, // toolbar uploads attach to this entity
        placeholder: `Write ${f.name}… press / for blocks`,
        onInput: (value) => {
          scheduleDocSave(id, f.name, value, status);
          rail.schedule(); // headings may have changed
          folds.schedule(); // a re-render drops the fold classes; re-apply
        },
      });
      editors?.push(ed);
    };
    // The source of an HTML document is code, so its editor is a code box —
    // the rendering editor would run the HTML instead of showing it. A field
    // whose declared kind IS code mounts this box directly: its document is a
    // program, and there is no frame to toggle away from.
    const mountSourceEditor = () => {
      const ta = el('textarea', { class: 'doc-source', spellcheck: 'false', title: `${f.name} source` });
      ta.value = entity.docs?.[f.name] ?? '';
      ta.addEventListener('input', () => scheduleDocSave(id, f.name, ta.value, status));
      host.append(ta);
    };
    if (mode === 'code') mountSourceEditor();
    if (mode === 'markdown') mountEditor();
    return section;
  };

  /* Comments panel */
  const commentsBody = el('div', { class: 'card-body' });
  const commentsPanel = el('div', { class: 'card panel' },
    el('div', { class: 'card-header' },
      el('h3', { class: 'card-title' }, `Comments (${entity.comments.length})`)),
    commentsBody);
  for (const c of entity.comments) {
    commentsBody.append(el('div', { class: 'comment' },
      el('div', {}, el('span', { class: 'who' }, c.author), el('span', { class: 'when' }, new Date(c.createdAt).toLocaleString())),
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

  /* The body is BLOCKS (Feature #117; blocks since Issue #89, Kyle
     2026-08-26): the field block, each document, each attachment row, each
     related table. A block carries a reposition anchor and moves among its
     peers through bodyOrder; a value field moves inside the field block
     through fieldOrder. The two drags never reach into each other — a field
     promoted to a block would be a field the grid view could not show — so
     each ignores the other's dragstart. */
  const VALUES_BLOCK = '@values';
  left.classList.add('entity-body');
  const fields = el('div', { class: 'entity-fields' });
  /* Value rows flow into columns (Issue #89): twenty-eight of them in one
     column put the document a screen down. */
  const values = el('div', { class: 'entity-values' });
  let dragFrom = null;   // a value field, moving inside the field block
  let blockFrom = null;  // a whole block, moving among the blocks
  const hidden = new Set(db.hiddenFields ?? []);
  const shown = db.fields.filter((f) => f.role !== 'name' && !hidden.has(f.name));
  const blocks = new Map();

  /* Every block wears the same anchor — a ⠿ that is itself draggable, so the
     thing you grab is the thing that moves. */
  const anchor = (what) => el('span', { class: 'opt-grip', draggable: 'true', title: `Drag to move ${what}` });
  const wireBlock = (key, node, handles) => {
    node.dataset.block = key;
    for (const h of handles.filter(Boolean)) {
      h.setAttribute('draggable', 'true');
      h.addEventListener('dragstart', (e) => {
        blockFrom = key; e.dataTransfer.effectAllowed = 'move'; e.stopPropagation();
        node.classList.add('dragging');
      });
      h.addEventListener('dragend', () => { blockFrom = null; node.classList.remove('dragging'); });
    }
    node.addEventListener('dragover', (e) => {
      if (!blockFrom || blockFrom === key) return;
      e.preventDefault(); e.stopPropagation(); node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', (e) => {
      node.classList.remove('drop-target');
      const from = blockFrom; blockFrom = null;
      if (!from || from === key) return;
      e.preventDefault(); e.stopPropagation();
      const fromNode = blocks.get(from);
      const after = !!(fromNode && (fromNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (fromNode) node.insertAdjacentElement(after ? 'afterend' : 'beforebegin', fromNode);
      reorderBlocks(db, left, refresh);
    });
    blocks.set(key, node);
    return node;
  };

  /* One line, not a tinted row: the cue is the gap the field will land in,
     and the pointer's height against the row's midpoint picks the side —
     top half inserts before, bottom half after (Kyle, 2026-08-28: the
     highlighted row read as a swap, and the DOM-order direction left gaps
     the pointer could not reach). */
  const sweepCues = () => {
    for (const n of values.querySelectorAll('.drop-before, .drop-after')) n.classList.remove('drop-before', 'drop-after');
  };
  const dragRow = (node, handle, f) => {
    node.dataset.field = f.name;
    handle.addEventListener('dragstart', (e) => { dragFrom = f.name; e.dataTransfer.effectAllowed = 'move'; node.classList.add('dragging'); });
    handle.addEventListener('dragend', () => { dragFrom = null; node.classList.remove('dragging'); sweepCues(); });
    node.addEventListener('dragover', (e) => {
      if (!dragFrom || dragFrom === f.name) return;
      e.preventDefault(); e.stopPropagation();
      const r = node.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      node.classList.toggle('drop-after', after);
      node.classList.toggle('drop-before', !after);
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after'));
    node.addEventListener('drop', (e) => {
      const after = node.classList.contains('drop-after');
      sweepCues();
      const from = dragFrom; dragFrom = null;
      if (!from || from === f.name) return;
      e.preventDefault(); e.stopPropagation();
      const fromNode = values.querySelector(`[data-field="${CSS.escape(from)}"]`);
      if (fromNode) node.insertAdjacentElement(after ? 'afterend' : 'beforebegin', fromNode);
      reorderField(db, from, f.name, { after, onFail: refresh });
    });
    // Editors inside a draggable node must keep their own mouse events.
    for (const stop of node.querySelectorAll('input, select, textarea, .picker-wrap')) {
      stop.addEventListener('mousedown', (ev) => ev.stopPropagation());
    }
    return node;
  };

  /* The space under a column's last row belongs to the container, not to any
     row — without its own target, the bottom of the list is a gap the drag
     cannot reach. Dropping there lands the field after the last row. */
  values.addEventListener('dragover', (e) => {
    if (!dragFrom || e.target !== values) return;
    e.preventDefault();
    sweepCues();
    const last = values.lastElementChild;
    if (last && last.dataset.field !== dragFrom) last.classList.add('drop-after');
  });
  values.addEventListener('drop', (e) => {
    if (!dragFrom || e.target !== values) return;
    e.preventDefault();
    sweepCues();
    const from = dragFrom; dragFrom = null;
    const last = values.lastElementChild;
    if (!last || last.dataset.field === from) return;
    const fromNode = values.querySelector(`[data-field="${CSS.escape(from)}"]`);
    if (fromNode) last.insertAdjacentElement('afterend', fromNode);
    reorderField(db, from, last.dataset.field, { after: true, onFail: refresh });
  });

  for (const f of shown) {
    // A related table is its own block, below — but a target-set relation has
    // no one table to render as a grid, so its chips stay here in the panel.
    if (f.type === 'relation' && f.many && !f.targetDbIds) continue;
    if (f.type === 'document') {
      const section = docSection(f);
      wireBlock(f.name, section, [section.querySelector('.opt-grip'), section.querySelector('.doc-section-head')]);
      continue;
    }
    const node = el('div', { class: 'fieldrow' },
      f.type === 'attachments' ? anchor(f.name) : el('span', { class: 'opt-grip', title: 'Drag to reorder' }, '⠿'),
      el('label', { class: 'fieldrow-label', title: 'Edit field', onclick: () => editFieldDialog(db, f) }, fieldNameLabel(f)),
      editorFor(f, entity, db, () => refresh()));
    if (f.type === 'attachments') {
      // An attachment row is a block: it is as wide as its chips, and it
      // belongs wherever the reader put it, not always last.
      node.classList.add('attach-block');
      wireBlock(f.name, node, [node.querySelector('.opt-grip')]);
      continue;
    }
    node.setAttribute('draggable', 'true');
    values.append(dragRow(node, node, f));
  }

  if (values.childElementCount) {
    const valuesHead = el('div', { class: 'block-head' },
      anchor('the fields'), el('span', { class: 'block-name' }, 'Fields'));
    fields.append(valuesHead, values);
    wireBlock(VALUES_BLOCK, fields, [valuesHead.querySelector('.opt-grip'), valuesHead]);
  }
  // A table with no fields beyond its name shows nothing here — the banner
  // that used to fill the space read as breakage, not help (Issue #124).

  /* Collections of related records are blocks in the body rather than the
     side panel: they are work to do, not attributes to read. Each is fetched
     on its own so a slow one cannot hold up the page, and its anchor lands in
     the head the grid draws for it. */
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

  // The order the table remembers, resolved by the engine; anything it does
  // not name (a block just added, a field just unhidden) still has a node,
  // and lands after the ones it does.
  const named = db.bodyBlocks ?? [VALUES_BLOCK];
  for (const key of [...named, ...blocks.keys()]) {
    const node = blocks.get(key);
    if (node && !node.isConnected) left.append(node);
  }

  /* References, both directions. A chip in a document is deliberately not a
     relation — nothing was configured, so there is nothing to unlink; each
     list exists exactly as long as the text does. "References" is what this
     entity's documents mention (md chips, HTML hrefs, mermaid clicks alike);
     "Referenced by" is who mentions it.
     Hidden by default (Kyle, 2026-09-02), exactly like comments and
     activity: the panels live in the entity-side column the Activity button
     opens, so the resting page never mentions them — and nothing is even
     fetched until the reader asks. The chips are the SAME k k-rel chips a
     relation field wears, each with its k-home table badge, since
     references cross tables freely. No ×: a reference is text, so there is
     nothing to unlink. */
  const refCard = (title, extraClass) => (refs) => {
    if (!refs?.length || !mount.isConnected) return;
    right.append(el('div', { class: `card panel ref-backlinks-card ${extraClass}` },
      el('div', { class: 'card-header' },
        el('h3', { class: 'card-title' }, `${title} · ${refs.length}`)),
      el('div', { class: 'card-body ref-backlinks' },
        ...refs.map((r) => el('span', { class: 'k k-rel' },
          el('a', { href: `#/entity/${r.id}` },
            r.name || `#${r.publicId}`,
            el('span', { class: 'k-home' }, r.db.split('/').pop())))))));
  };
  if (sideOpen) {
    api('GET', `/entities/${id}/references-from`)
      .then(refCard('References', 'ref-outbound-card'))
      .catch(() => { /* references are a bonus, never an error on the page */ });
    api('GET', `/entities/${id}/references`)
      .then(refCard('Referenced by', 'ref-inbound-card'))
      .catch(() => { /* backlinks are a bonus, never an error on the page */ });
  }
  /* A deck is composed on read, so the frame IS the deck: the same editable
     file /e/:id/deck.html serves, live over whatever the slides say right now.
     A deck entity shows its whole composition; a slide shows itself, wearing
     the chrome of the deck it belongs to. Slides also carry the version
     action, because a version is a new row, not a saved copy. */
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
  // The side column reads top-down as what people said (Comments) and what
  // happened (Activity); the body holds what the record is and carries.
  right.append(commentsPanel, actPanel); // delete lives in the ⋮ menu
}

/* ---------- create & schema dialogs ---------- */

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

function openSchemaEditor(db) {
  const main = $('#main');
  main.replaceChildren(
    el('div', { class: 'wv-toolbar' },
      el('h1', {}, `${db.space} / ${db.name} — fields`),
      el('button', { class: 'btn btn-sm', onclick: () => showDatabase(db.id) }, '← Back')),
  );
  const panel = el('div', { class: 'card panel' });
  const body = el('div', { class: 'card-body' });
  const table = el('table', { class: 'table table-sm table-vcenter schema-table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Field'), el('th', {}, 'Type'), el('th', {}, 'Details'), el('th', {}, ''))),
    el('tbody', {}, ...db.fields.map((f) => el('tr', {},
      el('td', {}, fieldNameLabel(f)),
      el('td', { class: 'type' }, f.type),
      el('td', { class: 'type' },
        f.options ? f.options.join(', ')
          : f.states ? f.states.map((s) => s.name).join(' → ')
          : f.targetDbs ? `→ ${f.targetDbs.join(' | ')}${f.many ? ' (many)' : ''}`
          : f.targetDb ? `→ ${f.targetDb}${f.many ? ' (many)' : ''}`
          : f.via ? `via ${f.via}${f.targetField ? ` . ${f.targetField}` : ''}${f.aggregate ? ` (${f.aggregate})` : ''}`
          : f.expression ?? ''),
      el('td', {}, f.role === 'name' ? '' : holdToConfirm('Delete', async () => {
        try {
          await api('DELETE', `/tables/${db.id}/fields/${encodeURIComponent(f.id)}`);
          await loadSchema();
          openSchemaEditor(allTables().find((d) => d.id === db.id));
        } catch (err) { toast(err.message, true); }
      }, { holdingLabel: 'Hold…' }))))));
  body.append(table,
    el('div', { style: 'margin-top:12px; display:flex; gap:8px' },
      el('button', { class: 'btn btn-sm', onclick: () => addFieldDialog(db) }, '+ Field'),
      el('button', { class: 'btn btn-sm', onclick: () => addRelationDialog(db) }, '+ Relation')));
  panel.append(body);
  main.append(panel);
}

function addFieldDialog(db) {
  // Back to wherever the add started: the table keeps its scroll, the
  // schema editor redraws itself.
  fieldDialog(db, null, () => (state.route?.page === 'db'
    ? keepScroll(() => showDatabase(db.id, state.route.view))
    : openSchemaEditor(allTables().find((d) => d.id === db.id))));
}

function addRelationDialog(db) {
  tray('Add relation', [
    dsection('Name', el('input', { name: 'name', placeholder: 'Field name (e.g. Project)', class: 'form-control' })),
    dsection('Target table', pickerSelect({ name: 'targetDb', placeholder: 'Choose a table…', options: allTables().map((d) => ({ id: d.id, label: d.qualified })), value: allTables()[0]?.id ?? null })),
    dsection('Cardinality', pickerSelect({ name: 'cardinality', value: 'many-to-one', options: ['many-to-one', 'one-to-many', 'many-to-many', 'one-to-one'].map((c) => ({ id: c, label: c })) })),
    dsection('Inverse field', el('input', { name: 'inverseName', placeholder: 'Inverse field name (optional)', class: 'form-control' })),
  ], async (fd) => {
    await api('POST', `/tables/${db.id}/relations`, {
      name: fd.get('name'),
      targetDb: fd.get('targetDb'),
      cardinality: fd.get('cardinality'),
      inverseName: fd.get('inverseName') || undefined,
    });
    await loadSchema();
    openSchemaEditor(allTables().find((d) => d.id === db.id));
  });
}

/* ---------- related records, rendered as the table they live in ----------
   A collection relation was chips in the Fields panel: enough to see what is
   linked, useless for working on it — every edit meant opening five other
   pages. It renders here as the target table's own grid, built from the same
   parts as the table view (its columns, editorFor cells, the picker routing),
   so a Project page is where its Tasks are worked on. Single-value relations
   stay chips: a one-row grid is a worse chip. */
async function relatedGrid(entity, f, onSaved) {
  const target = allTables().find((d) => d.id === f.targetDbId)
    ?? allTables().find((d) => d.qualified === f.targetDb);
  if (!target) return null;
  const val = entity.fields[f.name];
  const linked = (Array.isArray(val) ? val : [val]).filter(Boolean);
  const rows = linked.length
    ? (await api('POST', `/tables/${target.id}/query`, { where: [['id', 'in', linked.map((s) => s.id)]] })).items
    : [];
  // Every column the target table has, minus its documents (edited on their
  // own page) and minus the relation pointing back at the record you are
  // already looking at.
  const cols = target.fields.filter((c) => c.type !== 'document' && c.name !== f.inverseField);
  const colCount = cols.length + 2;

  const link = async (targets) => {
    await api('POST', `/entities/${entity.id}/link`, { field: f.name, targets });
    await onSaved();
  };

  const body = el('tbody', {},
    ...rows.map((item) => el('tr', {
      class: 'entity-row',
      onclick: (e) => {
        const pick = rowClickTarget(e);
        if (pick === 'ignore') return;
        if (pick) return openCellPicker(pick);
        openEntity(item.id);
      },
    },
      el('td', { class: 'pid-cell' },
        el('a', { class: 'open-link', href: `#/entity/${item.id}`, title: 'Open entity page' }, `#${item.publicId} ↗`)),
      ...cols.map((c) => el('td', {
        class: (c.type === 'number' ? 'num' : '')
          + (PICKER_FIELD_TYPES.includes(c.type) ? ' cell-pick' : READONLY_FIELD_TYPES.includes(c.type) ? ' cell-computed' : ''),
      }, editorFor(c, item, target, onSaved, { compact: true }))),
      el('td', {}, el('button', {
        class: 'btn btn-sm btn-ghost-secondary tiny unlink-btn', title: `Unlink from ${f.name}`,
        onclick: async (e) => {
          e.stopPropagation();
          try {
            await api('POST', `/entities/${entity.id}/unlink`, { field: f.name, targets: [item.id] });
            await onSaved();
          } catch (err) { toast(err.message, true); }
        },
      }, '×')))),
    /* Adding grows the table from the bottom, as it does in the table view —
       and a row added HERE is created and linked in one step, because the
       reason to add it is that it belongs to this record. */
    el('tr', { class: 'add-entity-row' },
      el('td', { colspan: String(colCount) },
        el('button', {
          class: 'add-entity-btn', type: 'button',
          onclick: async () => {
            try {
              const made = await api('POST', `/tables/${target.id}/entities`, { values: { Name: `New ${target.name}` } });
              await link([made.id]);
            } catch (err) { toast(err.message, true); }
          },
        }, `+ New ${target.term.singular}`),
        el('button', {
          class: 'add-entity-btn', type: 'button',
          onclick: async (e2) => {
            const list = await api('POST', `/tables/${target.id}/query`, { select: ['Name'] });
            const before = linked.map((sm) => sm.id);
            searchPicker({
              anchor: e2?.currentTarget ?? null, title: `${f.name}`, placeholder: `Search ${target.term.plural}…`,
              options: list.items.map((o) => ({ id: o.id, label: o.name || '(unnamed)', hint: `#${o.publicId}` })),
              multi: {
                selected: linked.map((sm) => ({ id: sm.id, label: sm.name || '(unnamed)' })),
                onCommit: async (ids) => {
                  const add = ids.filter((x) => !before.includes(x));
                  const drop = before.filter((x) => !ids.includes(x));
                  if (!add.length && !drop.length) return;
                  if (add.length) await api('POST', `/entities/${item.id}/link`, { field: f.name, targets: add });
                  if (drop.length) await api('POST', `/entities/${item.id}/unlink`, { field: f.name, targets: drop });
                  await onSaved();
                },
              },
            });
          },
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

/* ---------- the Activity system table ----------
   Activity is a table weave owns: every event in the workspace, one row each,
   with a fixed shape nobody can redefine and no row anyone can type. It reads
   like any other table view, and the entity pane is the same rows filtered to
   one entity — a related table, not a second implementation of the log. */

const ACTIVITY_PANE_ROWS = 10;

function activitySummary(a) {
  const d = a.detail ?? {};
  switch (a.kind) {
    case 'state-changed': return `${d.field}: ${d.from ?? '—'} → ${d.to}`;
    case 'field-updated': return `${d.field}: ${fmtValue(d.from)} → ${fmtValue(d.to)}`;
    case 'relation-updated': return `${d.field} changed`;
    case 'comment-added': return `comment by ${d.author ?? 'someone'}`;
    case 'file-attached': return `attached ${d.name}`;
    case 'automation-ran': return `automation “${d.name}” ran`;
    case 'doc-updated':
    case 'doc-appended': {
      // The enriched detail is the point of the row: how much moved, where.
      const size = d.delta == null ? '' : ` ${d.delta >= 0 ? '+' : '−'}${Math.abs(d.delta)} chars`;
      const where = d.line ? ` at line ${d.line}` : '';
      const verb = a.kind === 'doc-appended' ? 'appended to' : 'edited';
      const quote = d.preview ? ` — “${d.preview}”` : '';
      return `${d.field ?? 'Description'} ${verb}${size}${where}${quote}`;
    }
    default: return a.kind;
  }
}

/* A history line has to name what changed. `String(v)` on a stored object
   printed '[object Object]' — a date range is the shape that hits it, and any
   other object would have too (Issue #91). */
const fmtValue = (v) => {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') {
    if ('start' in v || 'end' in v) return weaveDateCore.formatDateRange(v, {});
    return v.name ?? JSON.stringify(v);
  }
  return String(v);
};

/* `#/activity` is the whole table; `#/activity/<entityId>` narrows it to one
   entity; `#/activity/<entityId>:<n>` is one event's own page. */
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
    onclick: () => { location.hash = `#/activity/${a.id}`; },
  },
    el('td', { class: 'activity-when', title: a.ts }, new Date(a.ts).toLocaleString()),
    el('td', {}, el('span', { class: `k k-sys activity-kind kind-${a.kind}` }, a.kind)),
    el('td', {}, activitySummary(a)),
    el('td', {}, recordChip(a)),
    el('td', {}, a.entityName ?? '—')));

  main.replaceChildren(
    viewHeader({
      crumbs: entityId && subject
        ? [{ label: 'Activity', href: '#/activity' }, { label: subject.db, href: `#/table/${subject.dbId}` }]
        : [],
      permalink: `${location.origin}${WS_PREFIX}/#/activity${entityId ? `/${entityId}` : ''}`,
      title: entityId && subject ? `Activity — ${subject.entityName}` : 'Activity',
    }),
    el('div', { class: 'wv-note' },
      'A system table: weave writes these rows, so they cannot be added, edited or deleted. ',
      el('b', {}, `${feed.total}`), ' events.'),
    feed.items.length
      ? el('div', { class: 'card' },
        el('table', { class: 'table table-sm table-vcenter card-table table-hover wv-grid' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'When'), el('th', {}, 'Event'), el('th', {}, 'Detail'),
            el('th', {}, 'Record'), el('th', {}, 'Name'))),
          el('tbody', {}, ...rows)))
      : el('div', { class: 'wv-empty' }, 'No activity yet.'));
}

/* The record an event refers to, as the same relation chip any entity page
   uses: a permalink to the entity, swallowing the click so the row or page
   around it keeps its own destination. */
function recordChip(a) {
  return el('span', { class: 'k k-rel' + (a.deleted ? ' deleted' : '') },
    el('a', { href: `#/entity/${a.entityId}`, onclick: (e) => e.stopPropagation() },
      `${a.db ?? '—'} #${a.publicId}${a.deleted ? ' (deleted)' : ''}`));
}

/* One event's own page, laid out like any entity page: the crumb carries its
   table (Activity) and a copyable permalink, the title is the summary, and the
   values are label/value field rows. The event is the entity here — its
   `entityId:index` id is a real address — so the record it references is one
   field among the others, a relation chip linking out, not the click-through
   destination: one event can involve several records (a relation change
   names two) and the record may since have been deleted. */
async function showActivityDetail(id) {
  state.route = { page: 'activity' };
  renderNav();
  const main = $('#main');
  let a;
  try { a = await api('GET', `/activity/${encodeURIComponent(id)}`); }
  catch (err) { toast(err.message, true); return showActivity(null); }

  const row = (label, value) => el('div', { class: 'fieldrow' }, el('label', {}, label), el('span', {}, value));
  const fieldsBody = el('div', { class: 'card-body' },
    row('Record', recordChip(a)),
    row('Table', a.db ? el('a', { href: `#/table/${a.dbId}` }, a.db) : '—'),
    row('Event', el('span', { class: `k k-sys activity-kind kind-${a.kind}` }, a.kind)),
    row('When', el('span', { title: a.ts }, new Date(a.ts).toLocaleString())),
    row('Actor', a.actor ?? '—'),
    ...Object.entries(a.detail ?? {}).map(([k, v]) => row(k, fmtValue(v))),
    row('History', el('a', { href: `#/activity/${a.entityId}` }, `All activity for ${a.entityName ?? 'this record'} →`)));

  main.replaceChildren(
    el('div', { class: 'view-header' },
      el('div', { class: 'crumb' },
        el('a', { href: '#/activity' }, 'Activity'), ' › ',
        el('span', {
          class: 'permalink-copy', title: 'Copy permalink',
          onclick: () => copyText(`${location.origin}${WS_PREFIX}/#/activity/${a.id}`, 'Permalink copied'),
        }, `#${a.id} ⧉`)),
      el('div', { class: 'wv-toolbar entity-head' },
        el('span', { class: 'name-edit activity-title' }, activitySummary(a)))),
    el('div', { class: 'card panel' },
      el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, 'Fields')),
      fieldsBody));
}

/* ---------- home ---------- */

async function showView(id) {
  state.route = { page: 'view', id };
  renderNav();
  const main = $('#main');
  let v;
  try { v = await api('GET', `/views/${id}`); } catch { return showHome(); }
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
        const qr = qrCanvas(full);
        modal('Share link', [
          el('div', { class: 'share-box' },
            qr ?? el('span', {}, ''),
            el('code', { class: 'share-url' }, full),
            el('span', { class: 'share-hint' }, 'Copied to the clipboard — or scan it. Anyone with this link sees this view, read-only, until you revoke it.')),
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
        el('tbody', {}, ...b.items.map((e) => el('tr', { onclick: () => openEntity(e.id), style: 'cursor:pointer' },
          ...cols.map((c) => {
            const val = e.fields[c];
            return el('td', {}, Array.isArray(val) ? val.map((x) => x?.name ?? x).join(', ') : (val && typeof val === 'object' ? val.name ?? '' : String(val ?? '')));
          }))))))));
  }
}

async function showHome() {
  state.route = { page: 'home' };
  renderNav();
  const main = $('#main');
  const dbs = allTables();
  let ws = { name: $('#ws-name').textContent || 'workspace', description: '' };
  try { ws = await api('GET', '/workspace'); } catch { /* older server */ }
  // Deleting a workspace lives on the workspace's own page (Issue #122) —
  // the same place a space and a table keep their destructive act. The
  // default and the weave docs workspaces cannot go; theirs shows no menu.
  let wsRow = null;
  try { wsRow = (await api('GET', '/workspaces')).find((w) => w.name === ws.name); } catch { /* single-workspace hub */ }
  const deletable = wsRow && !wsRow.default && ws.name !== 'weave';
  main.replaceChildren(
    viewHeader({
      crumbs: [],
      permalink: location.origin + (ws.url ?? wsHomeHref()),
      title: ws.name,
      onRename: async (name) => {
        const updated = await api('PATCH', '/workspace', { name });
        // The id permalink survives the rename; the name URL just died.
        location.href = WS_PREFIX ? `/w/${updated.id}/` : '/';
      },
      description: ws.description,
      onSaveDescription: async (md) => { await api('PATCH', '/workspace', { description: md }); },
      ...(deletable ? {
        actions: [dotsMenu([{
          hold: 'Delete workspace', holdingLabel: 'Hold to delete workspace…',
          run: async () => {
            try {
              await api('DELETE', `/workspaces/${wsRow.id}`);
              location.href = '/';
            } catch (err) { toast(err.message, true); }
          },
        }], { title: 'Workspace actions', align: 'right' })],
      } : {}),
    }),
    ...(dbs.length
      ? []
      : [el('div', { class: 'wv-empty' }, 'Welcome to Weave. Create a space and a table to get started.')]),
    /* The system tables live below the workspace's own, marked as weave's
       rather than the user's — they are reached from here because they belong
       to no space. */
    el('div', { class: 'card list-rows system-tables' },
      el('div', { class: 'list-row', onclick: () => { location.hash = '#/activity'; } },
        el('span', {}, 'Activity'), el('span', { class: 'k k-sys' }, 'system'),
        el('span', { class: 'spacer' }),
        el('span', { class: 'pid' }, 'every event in this workspace'))));
  // The spaces of this workspace, AS the Spaces registry grid (Kyle,
  // 2026-08-24): every field of the registry, editable in place; opening a
  // row opens the space, because the row IS the space.
  const reg = registryTable('spaces');
  if (reg && dbs.length) {
    const res = await api('POST', `/tables/${reg.id}/query`, {});
    const onSaved = async () => {
      await loadSchema();
      await showHome();
      restoreGridFocus();
    };
    const sysCard = main.querySelector('.system-tables');
    renderTable(main, reg, res.items, onSaved);
    // renderTable appends; the registry grid belongs above the system card.
    const wrap = main.lastElementChild;
    if (sysCard && wrap && wrap !== sysCard) main.insertBefore(wrap, sysCard);
  }
  // Saved views (Feature #17): named cross-table slices; share mints a
  // read-only capability URL that outlives the auth wall until revoked.
  try {
    const views = await api('GET', '/views');
    if (views.length) {
      main.append(el('div', { class: 'card list-rows' },
        ...views.map((v) => el('div', { class: 'list-row', onclick: () => { location.hash = `#/view/${v.id}`; } },
          el('span', {}, v.name),
          v.shared ? el('span', { class: 'k k-sys' }, 'shared') : null,
          el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, `${v.blocks.length} block${v.blocks.length === 1 ? '' : 's'}`)))));
    }
  } catch { /* older server */ }
  // The workspace's shape, read-only (Feature #51) — the same view #/map and
  // every space page draw, so there is one map to learn, not three.
  if (dbs.some((d) => !d.system)) {
    const card = await relationMapCard('Relation map');
    if (card) main.append(card);
  }
}

/* ---------- universal search (sidebar + ⌘K palette) ---------- */

const KIND_ICON = { workspace: '', space: '▣', table: '▦', entity: '●' };

function navigateToResult(hit) {
  // Results can come from another workspace: follow the permalink's path.
  const hitPrefix = (hit.url.match(/^\/w\/[^/]+/) ?? [''])[0];
  if (hitPrefix !== WS_PREFIX) {
    location.href = hit.kind === 'entity' ? `${hitPrefix}/#/entity/${hit.id}` : hit.url;
    return;
  }
  if (hit.kind === 'entity') openEntity(hit.id);
  else if (hit.kind === 'table') location.hash = `#/table/${hit.id}`;
  else if (hit.kind === 'space') location.hash = `#/space/${hit.id}`;
  else location.hash = '#/';
}

function resultRow(hit, onPick) {
  const permalink = location.origin + hit.url;
  return el('div', { class: 'result', onclick: () => onPick(hit) },
    el('div', { class: 'result-main' },
      el('span', { class: 'k k-sys' },
        ...(hit.kind === 'workspace'
          ? [el('img', { class: 'kind-mark', src: '/brand/weave-favicon.svg', alt: '' }), ` ${hit.kind}`]
          : [`${KIND_ICON[hit.kind] ?? ''} ${hit.kind}`])),
      el('span', {}, hit.kind === 'entity' ? `${hit.db} #${hit.publicId} — ${hit.name}` : hit.name),
      el('button', {
        class: 'btn btn-sm btn-ghost-secondary tiny copy-btn', title: 'Copy permalink',
        onclick: (e) => {
          e.stopPropagation();
          copyText(permalink, 'Permalink copied');
        },
      }, iconEl('⧉'))),
    el('div', { class: 'snip mono' }, permalink),
    hit.snippet ? el('div', { class: 'snip' }, hit.snippet) : null);
}

// The sidebar search control IS the ⌘K palette — one search surface.
function wireSearchButton() {
  $('#search-btn')?.addEventListener('click', openCommandK);
}

/* One search surface. By default a pick navigates; callers that need a
   reference rather than a jump — the editor's reference commands, which ask
   for one kind of target each — pass their own onPick and get the hit back
   instead. */
function openCommandK({ onPick = null, onDismiss = null, kinds = null, placeholder = null } = {}) {
  if ($('#cmdk-back')) return;
  let picked = false;
  const dismiss = () => { back.remove(); if (!picked) onDismiss?.(); };
  const back = el('div', { id: 'cmdk-back', onclick: (e) => { if (e.target === back) dismiss(); } });
  const input = el('input', {
    id: 'cmdk-input', autocomplete: 'off',
    placeholder: placeholder ?? 'Search workspace, spaces, tables, entities…',
  });
  const list = el('div', { id: 'cmdk-results' });
  let hits = [], rowEls = [], sel = 0;
  let timer;
  const pick = (hit) => {
    picked = true;
    back.remove();
    if (onPick) onPick(hit);
    else navigateToResult(hit);
  };
  const setSel = (i, scroll = true) => {
    if (!rowEls.length) return;
    sel = ((i % rowEls.length) + rowEls.length) % rowEls.length; // wrap at ends
    rowEls.forEach((r, j) => r.classList.toggle('active', j === sel));
    if (scroll) rowEls[sel].scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { hits = []; rowEls = []; list.replaceChildren(); return; }
      hits = await api('GET', `/search?q=${encodeURIComponent(q)}&all=1`);
      // A reference command asks for one kind of target; the palette itself
      // asks for all of them.
      if (kinds) hits = hits.filter((h) => kinds.includes(h.kind));
      rowEls = hits.map((h, i) => {
        const row = resultRow(h, pick);
        row.addEventListener('mouseenter', () => setSel(i, false));
        return row;
      });
      list.replaceChildren(...(rowEls.length ? rowEls : [el('div', { class: 'result' }, 'No results')]));
      setSel(0); // highlight resets to the top on every re-render
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(sel - 1); }
    else if (e.key === 'Enter' && hits.length) pick(hits[sel] ?? hits[0]);
    else if (e.key === 'Escape') dismiss();
  });
  back.append(el('div', { id: 'cmdk' },
    input,
    list,
    el('div', { class: 'cmdk-foot' }, 'Enter opens top result • ⧉ copies a permalink • Esc closes')));
  document.body.append(back);
  input.focus();
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCommandK();
  }
});

/* ---------- page loader ---------- */

/* The weave-on rope (brand decision 7) covers any load expected to run
   long: it appears only once a wait passes LOADER_SHOW_AFTER_MS (500ms —
   Kyle, 2026-08-28). Hash routes paint their skeleton instantly and almost
   always finish well inside the threshold (the API answers in single-digit
   ms), so in practice the rope belongs to boot — which is also every
   workspace switch, since those navigate to /w/<id>/ — and to the rare
   genuinely slow route (Feature #148).

   Two rules, and they pull against each other:
   - It must not tax fast navigation, so it only appears once a wait passes
     LOADER_SHOW_AFTER_MS.
   - Once it does appear it always finishes at least one whole cycle, so the
     rope is never caught half-woven. Hiding therefore waits out the remainder
     of the cycle it is in — which is a full cycle when it has only just
     appeared, and rounds up to the next boundary when the wait ran long.

   The SVGs are fetched and inlined rather than used as <img>: only an inline
   SVG exposes setCurrentTime, and restarting the clock at show time is what
   makes "one whole cycle" true rather than approximately true — an <img>
   timeline free-runs from page load, so it would be at an arbitrary phase. */
const LOADER_CYCLE_MS = 2000; // must match LOADER_CYCLE_MS in brand/build-logos.mjs
const LOADER_SHOW_AFTER_MS = 500;
const loading = { depth: 0, shownAt: 0, showTimer: null, hideTimer: null, ready: false };

async function initPageLoader() {
  const host = $('#page-loader');
  if (!host) return;
  const pairs = [['mark-light', 'light'], ['mark-dark', 'dark']];
  const svgs = await Promise.all(pairs.map(async ([cls, theme]) => {
    const res = await fetch(`/brand/weave-loader-${theme}.svg`);
    const wrap = el('span', { class: cls });
    wrap.innerHTML = await res.text();
    return wrap;
  })).catch(() => null);
  if (!svgs) return; // no loader is better than a bare wash
  host.replaceChildren(...svgs);
  loading.ready = true;
}

function showPageLoader() {
  const host = $('#page-loader');
  if (!host || !loading.ready) return;
  loading.shownAt = Date.now();
  host.hidden = false;
  host.setAttribute('aria-hidden', 'false');
  // Restart both clocks so the visible rope begins at the start of a weave.
  for (const svg of host.querySelectorAll('svg')) svg.setCurrentTime(0);
}

function hidePageLoader() {
  const host = $('#page-loader');
  if (!host) return;
  host.hidden = true;
  host.setAttribute('aria-hidden', 'true');
  loading.shownAt = 0;
}

/* Runs `work`, showing the loader if it takes long enough to be a wait. */
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
    if (loading.depth > 0) return; // a newer route is still in flight
    if (loading.showTimer) { // finished before it ever appeared
      clearTimeout(loading.showTimer);
      loading.showTimer = null;
      return;
    }
    if (!loading.shownAt) return;
    const elapsed = Date.now() - loading.shownAt;
    loading.hideTimer = setTimeout(hidePageLoader, LOADER_CYCLE_MS - (elapsed % LOADER_CYCLE_MS));
  }
}

/* ---------- boot ---------- */


/* ---------- skeleton loading (Feature #49, boneyard-inspired) ----------
   The route paints a skeleton of the REAL destination the instant navigation
   starts — grid rows at grid rhythm, an entity page's two columns — so the
   wait looks like the thing being waited for (0xGF/boneyard's idea; the
   library itself is framework+build-time and cannot ride a vanilla no-build
   UI). The route's own render replaces it. Since Feature #148 the skeleton
   is the ONLY cover for hash routes — the rope belongs to full page loads —
   so a table skeleton takes its column count from the destination table:
   the schema is already client-side, which makes the real shape free. */
function paintSkeleton(kind, db) {
  const main = $('#main');
  if (!main) return;
  const line = (w, h = 12) => el('div', { class: 'sk sk-line', style: `width:${w};height:${h}px` });
  if (kind === 'db') {
    // First column wide like a Name, the rest tapering like real fields.
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

function renderRoute() {
  // Every render replaces #main, which would strand live document editors and
  // whatever they have not written yet. Flush and destroy before the DOM goes.
  teardownDocEditors();
  // A route change leaves the view the dock belonged to.
  dockClose();
  const hash = location.hash || '#/';
  // The skeleton of where we're going, painted before we go (Feature #49).
  const dbM = hash.match(/^#\/(?:table|db)\/([^/?]+)/);
  paintSkeleton(dbM ? 'db' : /^#\/entity\//.test(hash) ? 'entity' : 'list',
    dbM ? allTables().find((d) => d.id === dbM[1]) : null);
  let m;
  if ((m = hash.match(/^#\/trash\/([^/?]+)/))) return showTrash(m[1]);
  if ((m = hash.match(/^#\/(?:table|db)\/([^/?]+)/))) return showDatabase(m[1]);
  if ((m = hash.match(/^#\/space\/([^/?]+)/))) return showSpace(m[1]);
  if ((m = hash.match(/^#\/activity(?:\/([^/?]+))?/))) return showActivity(m[1] ?? null);
  if (hash.startsWith('#/map')) return showMap();
  if ((m = hash.match(/^#\/view\/([^/?]+)/))) return showView(m[1]);
  if ((m = hash.match(/^#\/entity\/([^/?]+)/))) return showEntity(m[1]);
  return showHome();
}

// Every route change may earn the rope, but only past LOADER_SHOW_AFTER_MS
// (500ms): the skeleton covers the wait until a load proves it is genuinely
// long (Feature #148). At the old 200ms threshold the full-cycle rule WAS
// the wait — routine navs paid up to ~2.2s for fetches that took a quarter
// of that.
function route() {
  return withPageLoader(renderRoute);
}

window.addEventListener('hashchange', route);

/* Collapsible chip previews arrive wherever /api/markdown HTML lands (doc
   previews, handbook, applets). One delegated listener toggles every caret;
   the chip itself stays a plain link. */
document.addEventListener('click', (ev) => {
  const caret = ev.target.closest('.mention-caret');
  if (!caret) return;
  ev.preventDefault();
  ev.stopPropagation();
  const open = caret.closest('.mention-wrap')?.classList.toggle('open');
  caret.setAttribute('aria-expanded', String(!!open));
});

/* Spaces and tables are created by the single-instance inline input in the
   sidebar (inlineNameInput). The modal variants that used to live here were
   unreachable and styled differently, so the same action had two competing
   designs — weave Issue #16. */

/* Shift+Enter anywhere on a table view = quick-create in the current table.
   From inside a grid cell editor it is save-and-create-another (Issue #125):
   the blur commits the cell (change fires before keydown resolves), and the
   focus lands in the new row's Name cell instead of being dropped. Editors
   outside the grid — filters, dialogs, pickers — keep their keys. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.shiftKey) return;
  if (state.route?.page !== 'db') return;
  const editing = e.target.closest?.('input,select,textarea,[contenteditable]');
  if (editing && !editing.closest('tr[data-eid]')) return;
  if ($('#modal-back') || $('#cmdk-back')) return;
  const db = allTables().find((d) => d.id === state.route.dbId);
  if (!db) return;
  e.preventDefault();
  if (editing) editing.blur();
  if (state.inlineAdd) state.inlineAdd();
  else quickCreate(db);
});

/* Workspace rail: the weave docs workspace is pinned first as the
   brand-colored chip (it always exists); every other workspace stacks below,
   showing its uploaded logo when it has one (right-click the active chip to
   set it). */
async function buildWsRail() {
  const listBox = $('#ws-list');
  if (!listBox) return;
  try {
    const list = await api('GET', '/workspaces');
    const seg = WS_PREFIX ? WS_PREFIX.slice(3) : null;
    // The URL segment may be the friendly name or the durable id — both route.
    const cur = seg ? list.find((w) => w.name === seg || w.id === seg) : list.find((w) => w.default);
    const current = cur?.name ?? seg;
    // The wordmark is the way home, not a caption (Kyle, 2026-08-24: "allow
    // clicking the workspace name to take you to the workspace entity page in
    // addition to the workspace selector chip"). A real href, so ⌘-click and
    // middle-click open the workspace in a tab like every other link.
    const wordmark = $('#ws-name');
    wordmark.textContent = current ?? '';
    wordmark.href = wsHomeHref();
    wordmark.title = current ? `Open the ${current} workspace page` : 'Open the workspace page';
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
          title: `${w.name} — ${w.tables} tables, ${w.entities} entities` + (w.name === current ? ' (right-click to set logo)' : ''),
        }, w.logo
          ? el('img', { src: `${prefix}/api/workspace/logo`, alt: w.name })
          : w.name.slice(0, 1).toUpperCase());
        if (w.name === current) {
          chip.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            uploadWorkspaceLogo();
          });
        }
        return chip;
      }));
  } catch { /* single-workspace hub */ }
}

// Workspace logo: picked file → base64 → PUT /api/workspace/logo (current
// workspace), then the rail re-renders with the image chip.
function uploadWorkspaceLogo() {
  const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (const b of buf) bin += String.fromCharCode(b);
    try {
      await api('PUT', '/workspace/logo', { name: file.name, mime: file.type || 'image/png', contentBase64: btoa(bin) });
      toast('Workspace logo set');
      buildWsRail();
    } catch (err) { toast(err.message, true); }
  });
  document.body.append(input);
  input.click();
}

function wireWsNew() {
  const btn = $('#ws-new');
  if (!btn) return;
  btn.addEventListener('click', () => {
    modal('New workspace', [el('input', { name: 'name', class: 'form-control', placeholder: 'Workspace name (e.g. dos)', style: 'width:100%' })],
      async (fd) => {
        const created = await api('POST', '/workspaces', { name: fd.get('name') });
        location.href = created.url;
      });
  });
}

/* Collapsible left nav: chevron in the sidebar header hides the sidebar
   (the rail stays); the expand chevron lives at the top of the rail.
   While collapsed, resting on the left edge slides the nav out as an
   overlay and clicking the edge pins it open (Kyle, 2026-08-25, Issue #77);
   the workspace rail keeps its ordinary hover behaviour. */
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
  collapse.addEventListener('click', () => apply(true));
  expand.addEventListener('click', () => apply(false));
  // The hot strip sits where the sidebar's edge used to be. The overlay
  // covers it once open, so "left the sidebar" is the one closing signal —
  // plus a short grace check for a pointer that crossed without settling.
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
  // Once the overlay is out it covers the strip, so the pinning click lands
  // on the sidebar itself: any press on a non-interactive spot pins the nav.
  sidebar.addEventListener('click', (e) => {
    if (!app.classList.contains('nav-peek')) return;
    if (e.target.closest('a,button,input,textarea,select,label')) return;
    apply(false);
  });
  sidebar.addEventListener('mouseleave', () => {
    if (app.classList.contains('nav-peek')) app.classList.remove('nav-peek');
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') app.classList.remove('nav-peek'); });
  apply(localStorage.getItem('weave-nav-collapsed') === '1');
}

/* Theme toggle: auto (follow OS, live) → dark → light.
   Tabler themes via data-bs-theme on <html>; data-theme kept for legacy
   custom scopes. Auto resolves from the OS and tracks OS changes live. */
function wireThemeToggle() {
  const btn = $('#theme-toggle');
  if (!btn) return;
  const icons = { auto: '◐', dark: '●', light: '○' };
  const media = matchMedia('(prefers-color-scheme: dark)');
  let pref = localStorage.getItem('weave-theme') ?? 'auto';
  if (!icons[pref]) pref = 'auto';
  const apply = () => {
    const resolved = pref === 'auto' ? (media.matches ? 'dark' : 'light') : pref;
    document.documentElement.dataset.bsTheme = resolved;
    if (pref === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = pref;
    btn.replaceChildren(iconEl(icons[pref]) ?? icons[pref]);
    btn.title = `Theme: ${pref} (click to switch)`;
    retheme(); // live document editors follow the page, not their birth theme
  };
  media.addEventListener('change', () => { if (pref === 'auto') apply(); });
  apply();
  btn.addEventListener('click', () => {
    pref = pref === 'auto' ? 'dark' : pref === 'dark' ? 'light' : 'auto';
    localStorage.setItem('weave-theme', pref);
    apply();
  });
}

// Schema can change from another tab, the CLI, or an agent while a view is
// open. On refocus, re-fetch it; if it changed, re-render — unless a document
// editor is open (never clobber unsaved text; hint instead).
window.addEventListener('focus', async () => {
  const before = JSON.stringify(state.schema);
  try {
    await loadSchema();
  } catch { return; }
  if (JSON.stringify(state.schema) === before) return;
  // A re-render destroys live editors. Never do that over text that has not
  // reached the server yet.
  if (pendingDocSaves.size) {
    toast('Schema changed elsewhere — reopen this entity to see new fields');
    return;
  }
  route();
});


/* ---------- the bug reporter (Feature #141) ---------- */

/* The report button's glyph: Kyle's ant, traced from the icon he sent
   (2026-08-25) and vendored into the flat set as `bug` — "this is also
   good for the icon library" — so spaces, tables and states can wear it
   too. The FAB draws it through iconEl like every other mark. */
const bugGlyph = () => iconEl('lucide:bug', 'bug-fab-icon');

/* One recorder for the session, started at boot. It holds the last minute of
   what happened — routes, clicks, API calls with their status and duration,
   anything that threw — so a report can carry the steps to reproduce instead
   of asking the reporter to remember them. bugCore owns the rules about what
   may be remembered (public/bug-core.js); this wires it to the page. */
let bugRecorder = null;
/* What has been written but not yet filed. A report is often several minutes
   of someone's attention and the panel is not modal, so closing it — however
   that happens — puts the writing down rather than throwing it away, and the
   next open picks it back up (Issue #93). Filing clears it. */
let bugDraft = { note: '', categories: [] };

function installBugReporter() {
  if (bugRecorder) return;
  bugRecorder = bugCore.createRecorder();
  const now = () => Date.now();

  // Routes. The hash IS the page in this SPA, so a route change is the
  // coarsest replay step and usually the first line of a reproduction.
  bugRecorder.record({ kind: 'nav', to: location.hash || '#/', t: now() });
  addEventListener('hashchange', () => bugRecorder.record({ kind: 'nav', to: location.hash, t: now() }));

  /* Clicks, captured at the document so a redraw cannot unsubscribe us. The
     reporter's own controls are skipped: the trace is about the app, and a
     bug report that ends "clicked Report" tells nobody anything. */
  addEventListener('click', (e) => {
    const node = e.target?.closest?.('button, a, [role="button"], th, td, .chip, summary') ?? e.target;
    if (node?.closest?.('.bug-fab, #bug-panel')) return;
    bugRecorder.record({ kind: 'click', target: bugCore.describeTarget(node), t: now() });
  }, true);

  /* Requests — but not all of them. A page load fires a dozen reads that all
     come back 200 in 3ms; recorded, they fill the buffer with the app working
     correctly and push the actions that caused the bug off the end. What is
     evidence: anything that failed, anything slow enough to be the complaint,
     and every write (a 200 on a PATCH is what proves the save was accepted,
     which is the whole question in a "didn't save" report). */
  const SLOW_MS = 400;
  /* weave posts its reads: a filter goes in a body, so /query, /search and
     /markdown are POSTs that change nothing. Classify by what a call does,
     not by its verb, or "every write is evidence" quietly readmits the noise. */
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
      // status 0 is "never arrived" — a dropped connection reads differently
      // from a 500 when an agent is deciding what to reproduce.
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

/* The panel floats beside the button — no backdrop, no modal (Kyle,
   2026-08-25: "dialog floats next to bug button"). Reporting a bug must not
   cover the bug: the broken page stays visible while the report is written.

   The note is first and focused, so the fastest report is to start typing;
   the four symptoms are a multi-select underneath, because one bug is often
   slow AND wrong, and neither half is required — a sentence alone is the
   "other" nobody has to be given a fifth button for. */
function openBugPanel(fab) {
  closeBugPanel();
  fab.setAttribute('aria-expanded', 'true');
  const c = bugRecorder.counts();
  let picked = bugDraft.categories.slice();

  const send = el('button', { class: 'btn btn-primary btn-sm bug-send', type: 'submit', disabled: '' }, 'Send');
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
    });
    return btn;
  });
  sync();

  const form = el('form', { class: 'bug-form' },
    note,
    el('div', { class: 'bug-cats' }, ...cats),
    el('div', { class: 'bug-foot' },
      // Say what is being sent before it is sent — a trace of someone's
      // session is not something to attach quietly.
      el('span', { class: 'bug-captured', title: 'Recent routes, clicks, requests and errors — never anything you typed into a field' },
        `${c.actions + c.errors + c.failedRequests} steps captured`),
      send));

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
      /* The button becomes the receipt (Kyle: "send should sent"). Confirming
         in the control that was pressed beats a toast that has already faded
         by the time anyone looks up. */
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

  // Anchored to the button, flipped inside the viewport on a small screen.
  const r = fab.getBoundingClientRect();
  panel.style.right = Math.max(8, innerWidth - r.right) + 'px';
  panel.style.bottom = (innerHeight - r.top + 6) + 'px';

  /* The panel is not modal on purpose, so clicking the page behind it is the
     reporter checking the thing they are reporting — not a dismissal. A blank
     panel still goes away on that click, because there is nothing to lose and
     one opened by accident should not need a second gesture to put back.
     Esc closes either way; the draft is kept, so nothing typed is gone. */
  const away = (ev) => {
    if (!panel.isConnected) return removeEventListener('click', away, true);
    if (panel.contains(ev.target) || fab.contains(ev.target)) return;
    if (bugCore.canSubmit(picked, note.value)) return;
    closeBugPanel();
    removeEventListener('click', away, true);
  };
  addEventListener('click', away, true);
  addEventListener('keydown', function esc(ev) {
    if (!panel.isConnected) return removeEventListener('keydown', esc);
    if (ev.key === 'Escape') { closeBugPanel(); fab.focus(); removeEventListener('keydown', esc); }
    // ⌘/Ctrl+Enter sends from the note without reaching for the mouse.
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey) && panel.contains(ev.target)) {
      ev.preventDefault();
      form.requestSubmit();
    }
  });
  note.focus();
}

// The loader is fetched before the first route so boot's own wait can use it.
initPageLoader();
/* The recorder starts before the first render: a bug on first paint is a
   bug too, and by the time a user reaches for the button the actions that
   caused it are already history. */
installBugReporter();
/* Theme first: the first render must not paint an unthemed frame. Anything
   that reads the theme when it is built rather than on every paint — the
   document editors, and the mermaid diagrams they render once — would
   otherwise be born light and stay light under a dark page. */
wireThemeToggle();
withPageLoader(() => loadSchema().then(renderRoute));
wireSearchButton();
buildWsRail();
wireWsNew();
wireNavCollapse();
