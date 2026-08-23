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

async function api(method, path, body) {
  const res = await fetch(WS_PREFIX + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
  const t = el('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  if (action) {
    t.append(el('button', {
      class: 'toast-action', type: 'button',
      onclick: async () => { t.remove(); await action.run(); },
    }, action.label));
  }
  document.body.append(t);
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
      el('button', { class: 'tray-close', type: 'button', 'aria-label': 'Close', onclick: () => back.remove() }, '✕')),
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

const state = { schema: [], route: null, expanded: new Set(), refocus: null, trail: [] };

// Single entry point for opening an entity (future: side-peek drawer).
function openEntity(id) { location.hash = `#/entity/${id}`; }

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
    for (const set of [refChipLayers, docRails, docFolds]) {
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
      el('button', { class: 'btn btn-sm btn-ghost-secondary', title: 'Close', onclick: () => close() }, '✕')));
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

/* Shared view header: breadcrumb with a copyable permalink, an editable
   title, and a markdown description editable in place. Every page uses it
   (entity pages carry the same crumb pattern natively). */

/* An icon value on a space or table: 'iconly:<name>' renders the vendored
   flat set inline (currentColor — it inherits text color); anything else is
   text, which keeps old emoji icons working (Feature #101). */
function iconEl(icon, cls = 'wv-icon') {
  if (!icon) return null;
  const m = String(icon).match(/^iconly:(.+)$/);
  if (m && window.ICONLY_FLAT?.[m[1]]) {
    const span = el('span', { class: cls });
    span.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">${window.ICONLY_FLAT[m[1]]}</svg>`;
    return span;
  }
  return el('span', { class: cls }, String(icon));
}

/* The icon half of a naming edit: the current icon (or a ghost ring) beside
   the title, opening the one selection dialect over the flat set. */
function iconButton(current, onPick) {
  const btn = el('button', { class: 'icon-btn', type: 'button', title: 'Set icon' },
    iconEl(current) ?? el('span', { class: 'wv-icon icon-ghost' }, '◌'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    searchPicker({
      anchor: btn, title: 'Icon', placeholder: 'Search icons…',
      options: [
        { id: '', label: 'No icon' },
        ...Object.keys(window.ICONLY_FLAT ?? {}).map((n) => ({ id: `iconly:${n}`, label: n, iconly: n })),
      ],
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
  box.append(el('div', { class: 'crumb' }, ...crumbKids));

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
    titleInput, ...actions.filter(Boolean)));

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

function renderNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  nav.append(el('a', {
    class: 'nav-db nav-map' + (state.route?.page === 'map' ? ' active' : ''),
    href: '#/map',
  }, '🗺 Relation map'));
  const folded = new Set(JSON.parse(localStorage.getItem('weave-folded-spaces') ?? '[]'));
  for (const space of state.schema) {
    const isFolded = folded.has(space.spaceId);
    const spaceRow = el('div', { class: 'nav-space-row' },
      el('a', { class: 'nav-space', href: `#/space/${space.spaceId}` }, iconEl(space.icon, 'wv-icon nav-icon'), space.space),
      // Trails the label, "Routines ›" — the caret reads as part of the space
      // name, not as a gutter control. Open is a rotation of the same glyph.
      el('button', {
        class: 'nav-caret' + (isFolded ? '' : ' open'),
        title: isFolded ? `Expand ${space.space}` : `Collapse ${space.space}`, type: 'button',
        'aria-expanded': String(!isFolded),
        onclick: () => {
          if (folded.has(space.spaceId)) folded.delete(space.spaceId);
          else folded.add(space.spaceId);
          localStorage.setItem('weave-folded-spaces', JSON.stringify([...folded]));
          renderNav();
        },
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
      nav.append(el('a', {
        class: 'nav-db' + (state.route?.dbId === db.id ? ' active' : ''),
        href: `#/table/${db.id}`,
      }, iconEl(db.icon, 'wv-icon nav-icon'), db.name, el('span', { class: 'count' }, String(db.entityCount))));
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
  // Instance status (Feature #54): version + uptime from /api/health, so a
  // stale server is visible at a glance instead of masquerading as a broken
  // feature. startedAt arrives with the same payload for tooling to compare.
  nav.append(foot);
  // The instance chip lives in the bottom-right corner of the pane (Kyle,
  // 2026-08-22) — out of the nav, always visible, never in the way.
  if (!document.querySelector('.nav-health')) {
    const status = el('div', { class: 'nav-health', title: 'This weave instance' }, '…');
    api('GET', '/health').then((h) => {
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

function stateCategory(fieldSchema, stateName) {
  return fieldSchema.states?.find((s) => s.name === stateName)?.category ?? 'not-started';
}

function documentFields(db) {
  return db.fields.filter((f) => f.type === 'document');
}

// First lines of an entity's default document, flattened for view previews.
function docPreview(md, max = 120) {
  const flat = String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^[\s]*[-+] /gm, '')
    .replace(/[#>*`_|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() + '…' : flat;
}

// Lazy mermaid: load the vendored lib only when a preview contains a diagram.
let mermaidLoading = null;

/* ---------- fullscreen viewer (Feature #47) ----------
   Any URL weave serves, full-viewport, without leaving the app: an in-tree
   dialog hosting an iframe with its own back/refresh — mention links inside
   keep navigating in-frame (#27), and Esc brings you home. Also the host for
   the whiteboard (#46), which fills the frame slot with a canvas instead. */
function fullscreenViewer(title, { url = null, mount = null } = {}) {
  document.querySelector('#fsv-back')?.remove();
  const frame = url ? el('iframe', { class: 'fsv-frame', src: url, allowfullscreen: '', allow: 'fullscreen' }) : null;
  const back = el('div', { id: 'fsv-back' },
    el('div', { class: 'fsv-bar' },
      url ? el('button', { class: 'btn btn-sm', title: 'Back', onclick: () => frame.contentWindow?.history.back() }, '‹') : null,
      url ? el('button', { class: 'btn btn-sm', title: 'Refresh', onclick: () => { try { frame.contentWindow.location.reload(); } catch { frame.src = frame.src; } } }, '⟳') : null,
      el('span', { class: 'fsv-title' }, title),
      el('span', { style: 'flex:1' }),
      url ? el('a', { class: 'btn btn-sm', href: url, target: '_blank', title: 'Open in a browser tab' }, '↗') : null,
      el('button', { class: 'btn btn-sm', title: 'Close', onclick: () => back.remove() }, '✕')),
    frame ?? el('div', { class: 'fsv-body' }));
  document.body.append(back);
  addEventListener('keydown', function esc(e) {
    if (!back.isConnected) return removeEventListener('keydown', esc);
    if (e.key === 'Escape') { back.remove(); removeEventListener('keydown', esc); }
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
      }, '⛶'));
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
   design. Keyboard users hold Enter or Space, which works the same way. */
function holdToConfirm(label, onConfirm, { holdingLabel = 'Hold to confirm…' } = {}) {
  const fill = el('span', { class: 'hold-fill' });
  const text = el('span', { class: 'hold-label' }, label);
  const btn = el('button', { class: 'dropdown-item text-danger hold-btn', type: 'button' }, fill, text);
  let armed = false;
  const start = () => {
    if (armed) return;
    armed = true;
    btn.classList.add('holding');
    text.textContent = holdingLabel;
  };
  const stop = () => {
    armed = false;
    btn.classList.remove('holding');
    text.textContent = label;
  };
  btn.addEventListener('pointerdown', start);
  for (const ev of ['pointerup', 'pointerleave', 'blur']) btn.addEventListener(ev, stop);
  btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } });
  btn.addEventListener('keyup', stop);
  // Fires once the fill finishes sweeping across. Collapsing is untransitioned,
  // so releasing early cannot trigger it. The sweep is a scaleX transform, not
  // an animated width — width/height animations thrash layout on every frame.
  fill.addEventListener('transitionend', async (e) => {
    if (!armed || e.propertyName !== 'transform') return;
    stop();
    await onConfirm();
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


/* ---------- the one selection dialect (Kyle, 2026-08-22) ----------
   Everything that picks from a list — workflow states, select options, field
   types, relation targets, formats — opens the SAME surface: a compact panel
   with the cursor already in a search bar, a small scrollable list under it,
   ↑↓ to move, Enter to pick, Esc to close. Anchored to its trigger when it
   has one, centered otherwise. */
function searchPicker({ anchor = null, title = '', placeholder = 'Search…', options, currentId = null, onPick, multi = null }) {
  // multi: { selected: [{id, label, cls?}], onCommit(ids) } — the picker
  // becomes the editor: current picks listed with an ×, additions staged from
  // the list, and Enter on an empty search saves the lot (Kyle, 2026-08-22).
  document.querySelector('.chip-pop')?.remove();
  const input = el('input', { class: 'picker-search', placeholder, type: 'text' });
  const list = el('div', { class: 'picker-list' });
  const chosen = el('div', { class: 'picker-chosen' });
  const staged = multi ? new Map(multi.selected.map((x) => [x.id, x])) : null;
  const byId = new Map(options.map((o) => [o.id, o]));
  const drawChosen = () => {
    if (!multi) return;
    chosen.replaceChildren(...[...staged.values()].map((x) => el('span', { class: `chip ${x.cls ?? ''}` }, x.label,
      el('span', { class: 'x', title: 'Remove', onclick: (ev) => { ev.stopPropagation(); staged.delete(x.id); drawChosen(); draw(); input.focus(); } }, '×'))));
    if (!staged.size) chosen.append(el('span', { class: 'picker-empty' }, 'Nothing selected yet'));
  };
  const pop = el('div', { class: 'chip-pop picker-pop' },
    title ? el('div', { class: 'picker-title' }, title) : null,
    multi ? chosen : null,
    input, list);
  const commit = async () => { pop.remove(); await multi.onCommit([...staged.keys()]); };
  let active = -1;
  let visible = [];
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    visible = options.filter((o) => !q || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q));
    list.replaceChildren(...visible.map((o, i) => el('button', {
      class: 'chip-pop-row picker-row' + (i === active ? ' active' : ''), type: 'button',
      onclick: async () => {
        if (multi) {
          staged.has(o.id) ? staged.delete(o.id) : staged.set(o.id, o);
          drawChosen(); draw(); input.focus();
          return;
        }
        pop.remove();
        await onPick(o);
      },
    },
      o.chip ? el('span', { class: `chip ${o.cls ?? ''}` }, o.label)
        : o.iconly ? el('span', { class: 'picker-label picker-iconly' }, iconEl(`iconly:${o.iconly}`), o.label)
        : el('span', { class: 'picker-label' }, o.label),
      o.hint ? el('span', { class: 'picker-hint' }, o.hint) : null,
      (multi ? staged.has(o.id) : o.id === currentId) ? el('span', { class: 'chip-pop-check' }, '✓') : null)));
    if (!visible.length) list.append(el('div', { class: 'picker-empty' }, 'No matches'));
  };
  input.addEventListener('input', () => { active = -1; draw(); });
  input.addEventListener('keydown', async (ev) => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(active + 1, visible.length - 1); draw(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(active - 1, 0); draw(); }
    else if (ev.key === 'Enter') {
      ev.preventDefault();
      if (multi) {
        // Enter with a match toggles it; Enter on an empty search SAVES.
        const pick = visible[active] ?? (input.value.trim() ? visible[0] : null);
        if (pick) {
          staged.has(pick.id) ? staged.delete(pick.id) : staged.set(pick.id, pick);
          input.value = '';
          active = -1;
          drawChosen(); draw();
        } else {
          await commit();
        }
        return;
      }
      const pick = visible[active] ?? visible[0];
      if (pick) { pop.remove(); await onPick(pick); }
    } else if (ev.key === 'Escape') { ev.preventDefault(); pop.remove(); anchor?.focus?.(); }
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
  // The mandate: the cursor is already in the search bar.
  input.focus();
  drawChosen();
  const cur = options.findIndex((o) => o.id === currentId);
  if (cur >= 0) { active = cur; }
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

function chipPicker({ trigger, options, current, onPick }) {
  trigger.classList.add('chip-trigger');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const cell = trigger.closest('td');
    state.refocus = cell
      ? { eid: cell.parentElement.dataset.eid, col: [...cell.parentElement.children].indexOf(cell) }
      : null;
    searchPicker({
      anchor: trigger,
      options: options.map((o) => ({ id: o.name, label: o.name, cls: o.cls, chip: true })),
      currentId: current,
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

/* Field-type groupings the row/cell chrome keys off.
   PICKER: the cell's whole area opens a chooser. READONLY: computed values
   that render as text and must not look editable. */
const PICKER_FIELD_TYPES = ['select', 'multiselect', 'workflow'];
const READONLY_FIELD_TYPES = ['lookup', 'rollup', 'formula', 'document'];

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

// Row click → 'ignore' (a control handled it), the picker cell, or null (open).
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

  // Option colors come from the field dialog's swatches; a soft alpha tint
  // in the option's own hue, readable in both themes (Radix-style).
  function optionChipStyle(field, name) {
    const hex = (field.optionsFull ?? []).find((o) => o.name === name)?.color;
    return hex ? `background:${hex}1f;border-color:${hex}66;color:${hex}` : undefined;
  }

  if (READONLY_FIELD_TYPES.includes(f.type) && f.type !== 'document') {
    // Read-only: the glyph says "computed, not editable" at a glance so these
    // are not mistaken for the chips and inputs beside them.
    const box = el('span', { class: 'computed', title: `${f.type} — read-only` },
      el('span', { class: 'computed-mark' }, computedMark(f.type)), fieldValueCell(val) || '—');
    if (!compact) box.append(el('span', { class: 'wv-tag' }, f.type));
    return box;
  }
  if (f.type === 'workflow') {
    return chipPicker({
      trigger: el('button', { class: `chip state-${stateCategory(f, val)}`, type: 'button', title: f.name }, val ?? '—'),
      options: f.states.map((s) => ({ name: s.name, cls: `state-${s.category}` })),
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
      trigger: el('button', { class: 'chip', type: 'button', title: f.name, style: optionChipStyle(f, val) }, val ?? '—'),
      options: [{ name: '—' }, ...f.options.map((o) => ({ name: o }))],
      current: val ?? '—',
      onPick: (name) => patch(name === '—' ? null : name),
    });
  }
  if (f.type === 'multiselect') {
    const current = Array.isArray(val) ? val : [];
    const box = el('span', { class: 'ms-box', title: 'Edit selections' });
    for (const v of current) box.append(el('span', { class: 'chip', style: optionChipStyle(f, v) }, v), ' ');
    if (!current.length) box.append(el('span', { class: 'chip chip-add' }, '+'));
    chipPickerMulti({
      trigger: box,
      options: f.options.map((o) => ({ id: o, label: o, chip: true })),
      selected: current.map((v) => ({ id: v, label: v })),
      onCommit: (ids) => patch(ids),
    });
    return box;
  }
  if (f.type === 'checkbox') {
    const cb = el('input', { type: 'checkbox', class: 'form-check-input', onchange: () => patch(cb.checked) });
    cb.checked = !!val;
    return cb;
  }
  if (f.type === 'relation') {
    const box = el('span', { class: 'ms-box' });
    const current = val == null ? [] : Array.isArray(val) ? val : [val];
    for (const s of current) {
      box.append(el('span', { class: 'chip rel' },
        el('a', { href: `#/entity/${s.id}`, onclick: (e) => e.stopPropagation() }, s.name || `#${s.publicId}`),
        el('span', {
          class: 'x',
          onclick: async () => {
            try {
              await api('POST', `/entities/${id}/unlink`, { field: f.name, targets: [s.id] });
              await saved();
            } catch (err) { toast(err.message, true); }
          },
        }, '×')), ' ');
    }
    box.append(el('button', {
      class: 'btn btn-sm btn-ghost-secondary tiny',
      onclick: async (e2) => {
        const btn = e2?.currentTarget ?? null;
        const target = allTables().find((d) => d.qualified === f.targetDb || `${d.space}/${d.name}` === f.targetDb);
        const list = await api('POST', `/tables/${target.id}/query`, { select: ['Name'] });
        const before = current.map((sm) => sm.id);
        searchPicker({
          anchor: btn, title: `${f.name}`, placeholder: 'Search records…',
          options: list.items.map((o) => ({ id: o.id, label: o.name || '(unnamed)', hint: `#${o.publicId}` })),
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
    // Documents are edited through the doc editor surfaces, not a cell input.
    const text = String(val ?? '');
    return el('span', { class: 'computed', title: 'document — edit in the doc editor' },
      el('span', { class: 'computed-mark' }, computedMark('document')),
      text ? text.slice(0, 60).replace(/\n/g, ' ') + (text.length > 60 ? '…' : '') : '—');
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
    const chip = el('span', { class: 'computed', title: compact ? 'field definition — edit on the entity page' : 'field definition — click to edit' },
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
      modal(`${f.name} — field definition`, [
        el('label', { class: 'form-label' }, 'Type'), typeSel,
        el('label', { class: 'form-label', style: 'margin-top:8px' }, 'Config'), cfgArea,
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
    const box = el('span', { class: 'fielddef-edit' }, chip);
    if (def != null) {
      box.append(el('button', {
        class: 'btn btn-sm btn-ghost-secondary tiny', title: 'Clear the definition',
        onclick: () => patch(null),
      }, '×'));
    }
    return box;
  }
  // Attachments (Feature #16): the value is file ids; the cell shows names,
  // the entity page manages the list — upload lands blob and column together.
  if (f.type === 'attachments') {
    const ids = item.raw?.[f.name] ?? [];
    const chip = el('span', { class: 'computed', title: 'attachments' },
      el('span', { class: 'computed-mark' }, '📎'),
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
      value: item.raw?.[f.name] ?? '', time: !!f.time, format: f.format ?? 'iso',
      placeholder: 'today, 15 sep, 9/15/26…', onChange: (iso) => patch(iso),
    });
  }
  const rawVal = item.raw?.[f.name] ?? val;
  const input = el('input', {
    class: 'form-control form-control-sm inline-edit',
    type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text',
    value: rawVal ?? '',
    onclick: (e) => e.stopPropagation(),
  });
  input.addEventListener('change', () => patch(input.value === '' ? null : f.type === 'number' ? Number(input.value) : input.value));
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

/* ---------- inline multi-document editor ----------
   Tabbed across every document field of the table. Used by all views. */

function docsEditor(item, db, onSaved) {
  const fields = documentFields(db);
  if (!fields.length) return el('div', { class: 'doc-inline-wrap' }, 'This table has no document fields.');
  let active = fields[0].name;
  const wrap = el('div', { class: 'doc-inline-wrap' });

  const draw = () => {
    wrap.replaceChildren();
    const tabs = el('nav', { class: 'nav nav-tabs doc-tabs' },
      ...fields.map((f) => el('button', {
        class: 'nav-link doc-tab' + (f.name === active ? ' active' : ''),
        type: 'button',
        onclick: () => { active = f.name; draw(); },
      }, f.name)));
    const area = el('textarea', {
      class: 'form-control doc-inline', spellcheck: 'false',
      dataset: { eid: item.id, field: active },
    });
    area.value = item.docs?.[active] ?? '';
    // Focus swaps in the shared Vditor (Issue #89); blur brings this
    // textarea back carrying whatever was typed.
    area.addEventListener('focus', () => mountRowEditor(area));
    const fmtBase = `${WS_PREFIX}/e/${item.id}/doc/${encodeURIComponent(active)}`;
    wrap.append(
      el('div', { class: 'doc-toolbar' },
        tabs,
        el('span', { style: 'flex:1' }),
        el('div', { class: 'btn-group' },
          el('a', { class: 'btn btn-sm fmt', href: `${fmtBase}.md`, target: '_blank' }, 'MD'),
          el('a', { class: 'btn btn-sm fmt', href: `${fmtBase}.html`, target: '_blank' }, 'HTML'),
          el('a', { class: 'btn btn-sm fmt', href: `${fmtBase}.pdf`, target: '_blank' }, 'PDF'))),
      area,
      el('div', { style: 'margin-top:8px; text-align:right' },
        el('button', {
          class: 'btn btn-sm btn-primary',
          onclick: async () => {
            try {
              await api('PUT', `/entities/${item.id}/doc`, { field: active, doc: area.value });
              toast(`${active} saved`);
              const fresh = await api('GET', `/entities/${item.id}`);
              onSaved(fresh);
            } catch (err) { toast(err.message, true); }
          },
        }, `Save ${active}`)));
  };
  draw();
  return wrap;
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
   Per-table workflow-state filters, persisted per browser. The selection
   drives the ENGINE's where-language over POST /query — the grid never
   filters client-side, so board/list/table all obey the same truth. */
const FILTERS_KEY = 'weave-filters';
function tableFilters(dbId) {
  try { return JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}')[dbId] ?? {}; } catch { return {}; }
}
function setTableFilters(dbId, filters) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}'); } catch { /* fresh */ }
  if (Object.keys(filters).length) all[dbId] = filters;
  else delete all[dbId];
  localStorage.setItem(FILTERS_KEY, JSON.stringify(all));
}
function filterWhere(db) {
  const active = tableFilters(db.id);
  const conds = Object.entries(active)
    .filter(([field, states]) => states?.length && db.fields.some((f) => f.name === field && f.type === 'workflow'))
    .map(([field, states]) => [field, 'in', states]);
  return conds.length ? conds : undefined;
}
function filterStrip(db, onChange) {
  const wfFields = db.fields.filter((f) => f.type === 'workflow');
  if (!wfFields.length) return null;
  const active = tableFilters(db.id);
  const strip = el('div', { class: 'filter-strip' });
  for (const f of wfFields) {
    const row = el('span', { class: 'filter-group' },
      el('span', { class: 'filter-label' }, f.name));
    for (const st of f.states) {
      const on = (active[f.name] ?? []).includes(st.name);
      row.append(el('button', {
        class: `filter-chip cat-${st.category}${on ? ' on' : ''}`,
        onclick: () => {
          const cur = new Set(active[f.name] ?? []);
          cur.has(st.name) ? cur.delete(st.name) : cur.add(st.name);
          const next = { ...active };
          if (cur.size) next[f.name] = [...cur]; else delete next[f.name];
          setTableFilters(db.id, next);
          onChange();
        },
      }, st.name));
    }
    strip.append(row);
  }
  if (Object.keys(active).length) {
    strip.append(el('button', {
      class: 'btn btn-sm btn-ghost-secondary tiny',
      onclick: () => { setTableFilters(db.id, {}); onChange(); },
    }, 'Clear'));
  }
  return strip;
}

async function showDatabase(dbId, view) {
  const db = allTables().find((d) => d.id === dbId);
  if (!db) return showHome();
  if (state.route?.dbId !== dbId) state.expanded.clear();
  state.route = { page: 'db', dbId, view: view ?? state.route?.view ?? 'table' };
  renderNav();
  // public/ is served from disk while the server process is long-lived, so a
  // page can be newer than the routes behind it (git pull without a restart).
  // The trash badge is decoration — it must never keep the table from opening.
  const where = filterWhere(db);
  const [result, trash] = await Promise.all([
    api('POST', `/tables/${db.id}/query`, where ? { where } : {}),
    api('GET', `/tables/${db.id}/trash`).catch(() => ({ total: 0 })),
  ]);
  drawDatabase(db, result.items, trash.total);
}

function drawDatabase(db, items, trashCount = 0) {
  const main = $('#main');
  const unsaved = new Map();
  for (const area of main.querySelectorAll('textarea.doc-inline[data-eid]')) {
    unsaved.set(`${area.dataset.eid}::${area.dataset.field}`, area.value);
  }
  main.replaceChildren();

  const switcher = el('div', { class: 'btn-group view-switch' },
    ...['table', 'board'].map((v) =>
      el('button', {
        class: 'btn btn-sm' + (state.route.view === v ? ' active' : ''),
        onclick: () => showDatabase(db.id, v),
      }, v[0].toUpperCase() + v.slice(1))));

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
      switcher,
      // Only surfaced once the table actually has deleted rows — an empty
      // trash is not worth a permanent control.
      trashCount
        ? el('a', { class: 'btn btn-sm', href: `#/trash/${db.id}`, title: 'Deleted entities' }, `🗑 ${trashCount}`)
        : null,
      // Table view carries both affordances inside the grid itself — a "+"
      // in the header bar for fields, a "+ New" row at the foot for entities.
      // Board and list have no grid to host them, so they keep the buttons.
      state.route.view === 'table' ? null
        : el('button', { class: 'btn btn-sm', onclick: () => openSchemaEditor(db) }, '⚙ Fields'),
      state.route.view === 'table' ? null
        : el('button', { class: 'btn btn-sm btn-primary', onclick: () => quickCreate(db) }, '+ New'),
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
        // What a row is called (Feature #40): "+ New invoice", not "entity".
        {
          label: `Record noun${db.noun ? ` (${db.noun})` : ''}…`,
          run: () => modal(`What is one ${db.name} row?`, [
            el('input', { name: 'noun', placeholder: 'e.g. invoice — empty clears', class: 'form-control full', value: db.noun ?? '' }),
          ], async (fd) => {
            await api('PATCH', `/tables/${db.id}`, { noun: String(fd.get('noun') ?? '') });
            await loadSchema();
            showDatabase(db.id, state.route.view);
          }, 'Save'),
        },
        'divider',
        // System columns (Feature #65): per-table show/hide, persisted schema.
        ...Object.keys(SYSTEM_COLS).map((n) => ({
          label: `${(db.systemFields ?? []).includes(n) ? '✓ ' : ''}${n}`,
          run: async () => {
            const cur = db.systemFields ?? [];
            const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
            try {
              await api('PATCH', `/tables/${db.id}`, { systemFields: next });
              await loadSchema();
              showDatabase(db.id, state.route.view);
            } catch (err) { toast(err.message, true); }
          },
        })),
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
  state.inlineAdd = state.route.view !== 'table' ? null : async () => {
    const created = await api('POST', `/tables/${db.id}/entities`, { name: '' });
    await loadSchema();
    const fresh = await api('POST', `/tables/${db.id}/query`, {});
    drawDatabase(db, fresh.items);
    requestAnimationFrame(() =>
      $(`tr[data-eid="${created.id}"]`)?.querySelector('td:nth-child(2) input')?.focus());
  };

  if (!items.length && state.route.view !== 'table') {
    main.append(el('div', { class: 'wv-empty' }, 'No entities yet. Create the first one.'));
    return;
  }

  // The list view is gone (Kyle, 2026-08-22): table and board carry it all;
  // stale #/… routes and saved views that said 'list' land on the table.
  if (state.route.view === 'board') renderBoard(main, db, items, onSaved);
  else renderTable(main, db, items, onSaved);

  for (const area of main.querySelectorAll('textarea.doc-inline[data-eid]')) {
    const key = `${area.dataset.eid}::${area.dataset.field}`;
    if (unsaved.has(key)) area.value = unsaved.get(key);
  }
}

function renderTable(main, db, items, onSaved) {
  const cols = db.fields.filter((f) => f.type !== 'document').map((f) => f.name);
  // Header bar = id + one per field + docs + the "+" field control. Full-width
  // rows span it, so it is derived once rather than restated per call site.
  const colCount = cols.length + 3;
  let sortKey = null, sortDir = 1;
  const wrap = el('div', { class: 'card table-wrap' });

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
        class: 'entity-row',
        dataset: { eid: item.id },
        onclick: (e) => {
          const pick = rowClickTarget(e);
          if (pick === 'ignore') return;
          if (pick) return openCellPicker(pick);
          peekEntity(item.id);
        },
      },
        el('td', { class: 'pid-cell' },
          el('a', { class: 'open-link', href: `#/entity/${item.id}`, title: 'Open entity page' }, `#${item.publicId} ↗`)),
        ...cols.map((c) => {
          const f = db.fields.find((x) => x.name === c);
          const kind = PICKER_FIELD_TYPES.includes(f.type) ? ' cell-pick'
            : READONLY_FIELD_TYPES.includes(f.type) ? ' cell-computed' : '';
          return el('td', {
            class: (f.type === 'number' ? 'num' : '') + kind,
            // A resized column overrides the shared 260px cap — otherwise the
            // header widens and the cells keep ellipsising at the old width.
            style: f.width ? `max-width:${f.width}px` : null,
          }, editorFor(f, item, db, onSaved, { compact: true }));
        }),
        ...(db.systemFields ?? []).map((n) => el('td', { class: 'cell-computed sys-cell' }, SYSTEM_COLS[n]?.(item) ?? '')),
        el('td', {}, el('button', {
          class: 'btn btn-sm btn-ghost-secondary tiny' + (state.expanded.has(item.id) ? ' active-toggle' : ''),
          title: 'Edit documents',
          onclick: () => {
            if (state.expanded.has(item.id)) state.expanded.delete(item.id);
            else state.expanded.add(item.id);
            draw();
          },
        }, state.expanded.has(item.id) ? '📄▾' : '📄')));
      tbody.append(row);
      if (state.expanded.has(item.id)) {
        tbody.append(el('tr', { class: 'doc-row' },
          el('td', { colspan: String(colCount) }, docsEditor(item, db, onSaved))));
      }
    }
    // Creating an entity is the last row of the grid, not a detached bar:
    // the table reads as one surface that grows from the bottom.
    tbody.append(el('tr', { class: 'add-entity-row' },
      el('td', { colspan: String(colCount) },
        el('button', {
          class: 'add-entity-btn', type: 'button', title: 'Add an entity',
          onclick: () => state.inlineAdd?.(),
        }, '+ New'))));

    const table = el('table', { class: 'table table-sm table-vcenter card-table table-hover wv-grid' },
      el('thead', {}, el('tr', {},
        el('th', { class: 'pid-head' }, '#'),
        ...cols.map((c, i) => el('th', {
          class: 'col-head',
          draggable: 'true',
          style: colField(db, c).width ? `width:${colField(db, c).width}px` : null,
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
            if (from && from !== c) reorderField(db, from, c, { after: cols.indexOf(from) < i });
          },
        },
          el('span', { class: 'col-label' },
            fieldNameLabel(colField(db, c), c),
            sortKey === c ? (sortDir > 0 ? ' ↑' : ' ↓') : ''),
          fieldMenuButton(db, colField(db, c), {
            sorted: sortKey === c ? sortDir : 0,
            onSort: (dir) => { sortKey = dir ? c : null; sortDir = dir || 1; draw(); },
          }),
          columnResizeGrip(db, colField(db, c)))),
        ...(db.systemFields ?? []).map((n) => el('th', { class: 'sys-head', title: `${n} — system field, read-only` },
          el('span', { class: 'col-label' }, n, el('sup', { class: 'field-mark' }, '·')))),
        el('th', { title: documentFields(db).map((f) => f.name).join(', ') },
          `Docs (${documentFields(db).length})`),
        // Adding a field lives where the fields are: the end of the header bar.
        el('th', { class: 'add-field-head' }, addFieldMenuButton(db)))),
      tbody);
    wrap.replaceChildren(table);
  };
  draw();
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
/* The widest content in the column, measured on the cells themselves:
   double-clicking the grip fits the column to it so nothing is cut off
   (Kyle, 2026-08-23). scrollWidth reads the full content even when the
   cell clips it. */
function fitColumnWidth(th) {
  const table = th.closest('table');
  const idx = [...th.parentElement.children].indexOf(th);
  let widest = 0;
  for (const row of table.querySelectorAll('tr')) {
    const cell = row.children[idx];
    if (!cell) continue;
    const inner = cell.firstElementChild;
    widest = Math.max(widest, (inner ? inner.scrollWidth : 0), cell.scrollWidth);
  }
  return Math.max(MIN_COLUMN_WIDTH, Math.ceil(widest) + 18);
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

async function setColumnWidth(db, f, width, th = null) {
  try {
    await api('PATCH', `/tables/${db.id}/fields/${encodeURIComponent(f.id)}`, { config: { width } });
    // Commit in place: the header keeps (or sheds) its width and the cells
    // follow, without tearing the grid down mid-gesture (Kyle, 2026-08-22).
    f.width = width ?? undefined;
    if (th) {
      th.style.width = width ? `${width}px` : '';
      const idx = [...th.parentElement.children].indexOf(th);
      for (const row of th.closest('table')?.querySelectorAll('tbody tr') ?? []) {
        const cell = row.children[idx];
        if (cell) cell.style.maxWidth = width ? `${width}px` : '';
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

function fieldMenuButton(db, f, { sorted = 0, onSort = null } = {}) {
  const btn = el('button', {
    class: 'field-menu', type: 'button',
    title: `Configure ${f.name}`, 'aria-label': `Configure field ${f.name}`,
  }, '⋮');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();   // configuring a column must not also sort it
    const row = (label, run) => el('button', {
      class: 'chip-pop-row', type: 'button',
      onclick: () => { document.querySelector('.chip-pop')?.remove(); run(); },
    }, label);
    // No move rows: the header itself is the reorder control, and a dragged
    // column lands where the gap opened. Two ways to do one thing is one too
    // many when the direct one is the one people reach for.
    const rows = [
      row('✎ Edit field…', () => editFieldDialog(db, f)),
      row('+ Insert field…', () => addFieldDialog(db)),
    ];
    if (onSort) {
      rows.push(
        row((sorted > 0 ? '✓ ' : '') + '↑ Sort ascending', () => onSort(1)),
        row((sorted < 0 ? '✓ ' : '') + '↓ Sort descending', () => onSort(-1)));
      if (sorted) rows.push(row('Clear sort', () => onSort(0)));
    }
    if (f.name !== 'Name') {
      rows.push(holdToConfirm('🗑 Delete field', async () => {
        document.querySelector('.chip-pop')?.remove();
        try {
          await api('DELETE', `/tables/${db.id}/fields/${encodeURIComponent(f.id)}`);
          await loadSchema();
          showDatabase(db.id);
        } catch (err) { toast(err.message, true); }
      }, { holdingLabel: 'Hold to delete…' }));
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
function dateControl({ value = '', time = false, format = 'iso', placeholder = 'type a date…', onChange, compact = true }) {
  const dc = weaveDateCore;
  let current = value ?? '';
  const text = el('input', {
    class: 'form-control form-control-sm inline-edit date-text' + (compact ? '' : ' date-text-wide'),
    value: dc.formatDate(current, { format, time }), placeholder,
    onclick: (e) => e.stopPropagation(),
  });
  const set = (iso) => { current = iso ?? ''; text.value = dc.formatDate(current, { format, time }); onChange(current || null); };
  text.addEventListener('change', () => {
    const typed = text.value.trim();
    if (!typed) return set('');
    const day = parseNaturalDate(typed, new Date(), { dayFirst: format === 'eu' });
    if (!day) { toast(`Could not read '${typed}' as a date`, true); text.value = dc.formatDate(current, { format, time }); return; }
    // A typed day keeps the existing time of day; a typed datetime brings its own.
    const typedTime = (typed.match(/[t ](\d{1,2}:\d{2})/i) || [])[1];
    set(dc.joinIso(day, time ? (typedTime ?? dc.splitIso(current).time) : ''));
  });
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } });
  const btn = el('button', {
    type: 'button', class: 'date-pick-btn', title: 'Pick from the calendar', 'aria-label': 'Open calendar',
    onclick: (e) => { e.stopPropagation(); datePopover({ anchor: btn, value: current, time, format, onPick: set }); },
  }, calendarGlyph());
  const wrap = el('span', { class: 'date-cell' }, text, btn);
  wrap.setValue = (iso) => { current = iso ?? ''; text.value = dc.formatDate(current, { format, time }); };
  return wrap;
}

function calendarGlyph() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14');
  svg.innerHTML = '<rect x="1.5" y="2.5" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1.5 6h13" stroke="currentColor" stroke-width="1.3"/><path d="M5 1v3M11 1v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>';
  return svg;
}

function datePopover({ anchor, value, time, format, onPick }) {
  const dc = weaveDateCore;
  document.querySelector('.date-pop')?.remove();
  const todayIso = dc.todayIso();
  let { date: selected, time: clock } = dc.splitIso(value || '');
  let [y, m] = (selected || todayIso).split('-').map(Number);
  let view = 'days';                     // days | months | years
  let decadeBase = y;
  const pop = el('div', { class: 'date-pop', role: 'dialog', onclick: (e) => e.stopPropagation() });
  const commit = (iso, close) => {
    onPick(iso);
    if (close) pop.remove();
    else draw();
  };
  const smart = el('input', {
    class: 'form-control form-control-sm date-smart', placeholder: 'today, 15 sep, 9/15/26…',
    value: dc.formatDate(selected, { format }),
  });
  const preview = el('div', { class: 'date-smart-preview' });
  smart.addEventListener('input', () => {
    const day = parseNaturalDate(smart.value, new Date(), { dayFirst: format === 'eu' });
    preview.textContent = smart.value.trim() ? (day ? `→ ${dc.formatDate(day, { format: 'long' })}` : '…') : '';
  });
  smart.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const day = parseNaturalDate(smart.value, new Date(), { dayFirst: format === 'eu' });
    if (!day) return toast(`Could not read '${smart.value}' as a date`, true);
    selected = day; [y, m] = day.split('-').map(Number);
    // Enter is "done": commit and close, time of day kept (Kyle, 2026-08-23).
    commit(dc.joinIso(day, time ? clock : ''), true);
  });
  const body = el('div', { class: 'date-pop-body' });
  function draw() {
    body.replaceChildren();
    if (view === 'days') {
      body.append(el('div', { class: 'date-pop-head' },
        el('button', { type: 'button', class: 'date-pop-title', onclick: () => { view = 'months'; draw(); } }, `${dc.MONTHS_LONG[m - 1]} ▾`),
        el('button', { type: 'button', class: 'date-pop-title', onclick: () => { view = 'years'; decadeBase = y; draw(); } }, `${y} ▾`),
        el('span', { class: 'date-pop-spacer' }),
        el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Previous month', onclick: () => { [y, m] = dc.shiftMonth(y, m, -1); draw(); } }, '↑'),
        el('button', { type: 'button', class: 'date-pop-arrow', 'aria-label': 'Next month', onclick: () => { [y, m] = dc.shiftMonth(y, m, 1); draw(); } }, '↓')));
      const grid = el('div', { class: 'date-grid' }, ...dc.WEEKDAYS.map((d) => el('span', { class: 'date-wd' }, d)));
      for (const week of dc.calendarMonth(y, m)) {
        for (const c of week) {
          grid.append(el('button', {
            type: 'button',
            class: 'date-day' + (c.inMonth ? '' : ' out') + (c.iso === todayIso ? ' today' : '') + (c.iso === selected ? ' sel' : ''),
            onclick: () => { selected = c.iso; [y, m] = c.iso.split('-').map(Number); commit(dc.joinIso(c.iso, time ? clock : ''), !time); },
          }, String(c.day)));
        }
      }
      body.append(grid);
      if (time) {
        const t = el('input', { type: 'time', class: 'form-control form-control-sm date-time', value: clock });
        t.addEventListener('change', () => { clock = t.value; if (selected) commit(dc.joinIso(selected, clock), false); });
        body.append(el('div', { class: 'date-pop-time' }, el('span', {}, 'Time'), t));
      }
      body.append(el('div', { class: 'date-pop-foot' },
        el('button', { type: 'button', class: 'date-pop-link', onclick: () => { selected = ''; commit(null, true); } }, 'Clear'),
        el('button', { type: 'button', class: 'date-pop-link', onclick: () => { selected = todayIso; [y, m] = todayIso.split('-').map(Number); commit(dc.joinIso(todayIso, time ? clock : ''), !time); } }, 'Today')));
    } else if (view === 'months') {
      body.append(el('div', { class: 'date-pop-head' },
        el('button', { type: 'button', class: 'date-pop-title', onclick: () => { view = 'days'; draw(); } }, `${y}`),
        el('span', { class: 'date-pop-spacer' }),
        el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { y--; draw(); } }, '↑'),
        el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { y++; draw(); } }, '↓')));
      body.append(el('div', { class: 'date-pick-grid' }, ...dc.MONTHS.map((name, i) => el('button', {
        type: 'button', class: 'date-pick-cell' + (i + 1 === m ? ' sel' : ''),
        onclick: () => { m = i + 1; view = 'days'; draw(); },
      }, name))));
    } else {
      const years = dc.decade(decadeBase);
      body.append(el('div', { class: 'date-pop-head' },
        el('button', { type: 'button', class: 'date-pop-title', onclick: () => { view = 'days'; draw(); } }, `${years[0]}–${years[years.length - 1]}`),
        el('span', { class: 'date-pop-spacer' }),
        el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { decadeBase -= 10; draw(); } }, '↑'),
        el('button', { type: 'button', class: 'date-pop-arrow', onclick: () => { decadeBase += 10; draw(); } }, '↓')));
      body.append(el('div', { class: 'date-pick-grid' }, ...years.map((yr) => el('button', {
        type: 'button', class: 'date-pick-cell' + (yr === y ? ' sel' : ''),
        onclick: () => { y = yr; view = 'months'; draw(); },
      }, String(yr)))));
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

function optionSwatchStyle(hex) {
  return hex ? `background:${hex}` : '';
}

/* Rows of {name, color} with a cycling color swatch — replaces the
   comma-separated string that couldn't hold a color and choked on commas. */
function optionListEditor(state, onChange) {
  const colors = fieldDialogCore.OPTION_COLORS;
  const wrap = el('div', { class: 'opt-list' });
  const draw = () => {
    wrap.replaceChildren(
      ...state.options.map((o, i) => el('div', { class: 'opt-row' },
        el('button', {
          type: 'button', class: 'opt-color' + (o.color ? '' : ' neutral'), title: 'Cycle color',
          style: optionSwatchStyle(o.color),
          onclick: () => { o.color = colors[(colors.indexOf(o.color ?? '') + 1) % colors.length]; draw(); onChange(); },
        }),
        el('input', { class: 'opt-name', value: o.name, placeholder: 'Option', oninput: (e) => { o.name = e.target.value; onChange(); } }),
        el('button', { type: 'button', class: 'opt-del', title: 'Remove option', onclick: () => { state.options.splice(i, 1); draw(); onChange(); } }, '✕'))),
      el('button', {
        type: 'button', class: 'opt-add',
        onclick: () => { state.options.push({ name: '', color: '' }); draw(); onChange(); wrap.querySelectorAll('.opt-name')[state.options.length - 1]?.focus(); },
      }, '+ Add option'));
  };
  draw();
  return wrap;
}

function stateListEditor(state, onChange) {
  const cats = fieldDialogCore.STATE_CATEGORIES;
  const wrap = el('div', { class: 'opt-list' });
  const draw = () => {
    wrap.replaceChildren(
      ...state.states.map((s, i) => el('div', { class: 'opt-row' },
        el('input', {
          type: 'radio', name: 'wf-default', class: 'opt-default', title: 'Default state for new rows',
          checked: s.default ? '' : undefined,
          onchange: () => { state.states.forEach((x, j) => { x.default = j === i; }); onChange(); },
        }),
        el('input', { class: 'opt-name', value: s.name, placeholder: 'State', oninput: (e) => { s.name = e.target.value; onChange(); } }),
        (() => {
          // Category goes through the house picker dialect, never a native
          // <select> (ui-contract: one selector dialect everywhere).
          const cat = pickerSelect({ name: `wf-cat-${i}`, options: cats.map((c) => ({ id: c, label: c })), value: s.category ?? 'in-progress' });
          cat.classList.add('opt-cat');
          cat.input.addEventListener('change', () => { s.category = cat.input.value; onChange(); });
          return cat;
        })(),
        el('button', { type: 'button', class: 'opt-del', title: 'Remove state', onclick: () => { state.states.splice(i, 1); draw(); onChange(); } }, '✕'))),
      el('button', {
        type: 'button', class: 'opt-add',
        onclick: () => { state.states.push({ name: '', category: 'in-progress', default: state.states.length === 0 }); draw(); onChange(); wrap.querySelectorAll('.opt-name')[state.states.length - 1]?.focus(); },
      }, '+ Add state'));
  };
  draw();
  return wrap;
}

/* The formula builder: expression plus insertable chips for this table's
   fields and the engine's functions — the two vocabularies a formula has. */
function formulaBuilder(db, state, onChange) {
  const ta = el('textarea', {
    class: 'fx-expr', rows: 3, spellcheck: 'false',
    placeholder: 'e.g. if(Estimate > 5, "big", "small")',
  });
  ta.value = state.expression ?? '';
  ta.addEventListener('input', () => { state.expression = ta.value; onChange(); });
  const insert = (text) => {
    const at = ta.selectionStart ?? ta.value.length;
    ta.setRangeText(text, at, ta.selectionEnd ?? at, 'end');
    state.expression = ta.value;
    ta.focus();
    onChange();
  };
  const fieldChips = db.fields
    .filter((x) => !['document', 'attachments'].includes(x.type))
    .map((x) => el('button', { type: 'button', class: 'fx-chip', title: x.type, onclick: () => insert(x.name) }, x.name));
  const fnChips = fieldDialogCore.FORMULA_FUNCTIONS
    .map((fn) => el('button', { type: 'button', class: 'fx-chip fn', title: fn.sig, onclick: () => insert(`${fn.name}(`) }, `${fn.name}()`));
  return el('div', {},
    ta,
    el('div', { class: 'fx-chip-rows' },
      el('div', { class: 'fx-chip-row' }, el('span', { class: 'fx-chip-lbl' }, 'fields'), ...fieldChips),
      el('div', { class: 'fx-chip-row' }, el('span', { class: 'fx-chip-lbl' }, 'functions'), ...fnChips)));
}

/* The formula script, in its own dialog above the tray: the expression
   with insertable field/function chips. Saving writes state.expression. */
function formulaScriptDialog(db, state, onSave) {
  const draft = { expression: state.expression ?? '' };
  modal('Formula script', [
    el('div', { class: 'full' }, formulaBuilder(db, draft, () => {})),
  ], async () => {
    if (!draft.expression.trim()) throw new Error('A formula needs an expression');
    state.expression = draft.expression;
    onSave();
  }, 'Save script');
}

/* The number costume controls (Kyle, 2026-08-23): Format → number shows a
   free-text Unit (days, feet); currency shows an ISO-code picker — the two
   never mix; percent shows neither. Decimals and the separator apply to
   all. Used by number fields and by a formula's numeric result. */
function numberCostumeControls(state, redraw, changed, { label = 'Format' } = {}) {
  const fdc = fieldDialogCore;
  const n = state.number;
  const kids = [];
  kids.push(dsection(label, segCtl(fdc.NUMBER_FORMATS, n.format ?? 'number', (v) => { n.format = v; redraw(); changed(); })));
  if ((n.format ?? 'number') === 'number') {
    kids.push(dsection('Unit', el('input', { class: 'form-control', value: n.unit ?? '', placeholder: 'days, feet, kg …', oninput: (e) => { n.unit = e.target.value; changed(); } })));
  } else if (n.format === 'currency') {
    const known = fdc.CURRENCIES.some((c) => c.id === n.currency);
    const options = known ? fdc.CURRENCIES : [{ id: n.currency, label: n.currency }, ...fdc.CURRENCIES];
    const pick = pickerSelect({ name: 'currency', options, value: n.currency ?? 'USD' });
    pick.input.addEventListener('change', () => { n.currency = pick.input.value; changed(); });
    kids.push(dsection('Currency', pick, el('div', { class: 'hintnote' }, 'Formatted by code — $149.50, €1,200 — separate from units')));
  }
  kids.push(dsection('Decimals', el('input', {
    type: 'number', min: 0, max: 6, class: 'form-control dlg-narrow', value: n.decimals ?? '', placeholder: n.format === 'currency' ? '2' : 'auto',
    oninput: (e) => { n.decimals = e.target.value === '' ? null : Number(e.target.value); changed(); },
  })));
  if (n.format !== 'currency') {
    kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
      el('input', { type: 'checkbox', class: 'form-check-input', checked: n.separator ? '' : undefined, onchange: (e) => { n.separator = e.target.checked; changed(); } }),
      el('span', { class: 'form-check-label' }, 'Add 1,000 separator')));
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
    if (f.type === 'number' || f.type === 'formula') for (const k of ['format', 'unit', 'currency', 'decimals', 'separator']) { if (f[k] != null) c[k] = f[k]; }
    if (f.type === 'date') { if (f.format) c.format = f.format; if (f.time) c.time = true; }
    if (f.type === 'formula') c.expression = f.expression ?? '';
    if (f.type === 'field') c.depth = f.depth ?? 1;
    if (f.type === 'lookup' || f.type === 'rollup') { c.relationField = f.via ?? ''; c.targetField = f.targetField ?? ''; c.aggregate = f.aggregate; }
    if (f.default !== undefined) c.default = f.default;
    return { type: f.type, config: c };
  };
  const state = isEdit ? fdc.stateFromDefinition(defFromFieldView(existing)) : fdc.blankState('text');
  if (isEdit && existing.type === 'formula') state.computed = 'formula';

  const nameInput = el('input', {
    name: 'name', placeholder: 'Field name', class: 'form-control',
    value: existing?.name ?? '',
    disabled: isEdit && existing.name === 'Name' ? '' : undefined,
  });

  const gridWrap = el('div', { class: 'full' });
  const cfgWrap = el('div', { class: 'full' });
  const changed = () => {};

  // An existing field sees its own type plus the compatible migrations —
  // nothing the engine would refuse. Picking one carries the config across
  // (options <-> states) so it can be adjusted before the save migrates the
  // column's values in place.
  const choices = fdc.typeChoices(isEdit ? existing.type : null);
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
    }, el('span', { class: 'type-ic' }, t.icon), t.label));
    // Formula is a checkbox (Kyle, 2026-08-23): ticking it opens the script
    // dialog; the tray then shows the expression with an edit link.
    const fx = el('label', { class: 'fx-toggle' + (state.computed ? ' on' : '') },
      el('input', {
        type: 'checkbox', class: 'form-check-input', checked: state.computed ? '' : undefined, disabled: isEdit ? '' : undefined,
        onchange: (e) => {
          state.computed = e.target.checked ? 'formula' : false;
          drawGrid(); drawCfg(); changed();
          if (state.computed) formulaScriptDialog(db, state, () => { drawCfg(); changed(); });
        },
      }),
      el('span', { class: 'fx-mark' }, 'ƒ'), 'Formula',
      el('span', { class: 'fx-hint' }, 'any field can be computed'));
    let note = '';
    if (isEdit && state.type !== existing.type && !state.computed) {
      note = el('div', { class: 'modal-note migrate-note' }, `Saving converts this ${existing.type} field to ${state.type}; every row's value is migrated in place.`);
    } else if (isEdit && !migratable) {
      note = el('div', { class: 'modal-note' }, `${existing.type} field — the type is fixed`);
    } else if (isEdit) {
      note = el('div', { class: 'modal-note' }, `${existing.type} field — it can also become ${choices.slice(1).map((t) => t.id).join(', ')}`);
    }
    gridWrap.replaceChildren(
      tiles.length ? dsection(isEdit ? 'Type' : 'Type', el('div', { class: 'type-grid' + (isEdit ? ' editing' : '') }, ...tiles)) : '',
      (!isEdit || existing.type === 'formula') ? fx : '',
      note);
  }

  function drawCfg() {
    const kids = [];
    if (state.computed === 'formula') {
      kids.push(dsection('Script', el('div', { class: 'fx-summary' },
        el('code', { class: 'fx-summary-expr' }, state.expression || '— no script yet —'),
        el('button', { type: 'button', class: 'btn btn-sm', onclick: () => formulaScriptDialog(db, state, () => { drawCfg(); changed(); }) }, state.expression ? 'Edit script…' : 'Write script…'))));
      // A numeric result wears the same costume a number field does.
      kids.push(...numberCostumeControls(state, drawCfg, changed, { label: 'Result format' }));
    } else {
      const t = state.type;
      if (t === 'select' || t === 'multiselect') {
        kids.push(dsection('Options', optionListEditor(state, changed)));
      } else if (t === 'workflow') {
        kids.push(dsection('States', stateListEditor(state, changed)));
      } else if (t === 'number') {
        kids.push(...numberCostumeControls(state, drawCfg, changed));
      } else if (t === 'date') {
        // Each format shown as today's date would render in it — the
        // example IS the label. The time toggle shows its own example.
        const dc = weaveDateCore;
        const today = dc.todayIso();
        kids.push(dsection('Format', el('div', { class: 'date-format-list' }, ...fdc.DATE_FORMATS.map((fmt) => el('button', {
          type: 'button', class: 'date-format-opt' + ((state.date.format ?? 'iso') === fmt ? ' on' : ''),
          onclick: () => { state.date.format = fmt; drawCfg(); changed(); },
        }, el('span', { class: 'date-format-id' }, fmt), el('span', { class: 'date-format-eg' }, dc.formatDate(today, { format: fmt })))))));
        kids.push(el('label', { class: 'form-check full', style: 'margin:4px 0 0' },
          el('input', { type: 'checkbox', class: 'form-check-input', checked: state.date.time ? '' : undefined, onchange: (e) => { state.date.time = e.target.checked; drawCfg(); changed(); } }),
          el('span', { class: 'form-check-label' }, 'Include time of day ', el('span', { class: 'date-format-eg' }, dc.formatDate(today + 'T14:30', { format: state.date.format ?? 'iso', time: true })))));
      } else if (t === 'field') {
        kids.push(dsection('Definition depth', el('input', {
          type: 'number', min: 1, max: fdc.MAX_DEPTH, class: 'form-control dlg-narrow', value: state.depth ?? 1,
          oninput: (e) => { state.depth = Number(e.target.value) || 1; changed(); },
        })));
      } else if (t === 'lookup' || t === 'rollup') {
        if (isEdit) {
          kids.push(el('div', { class: 'modal-note full' }, 'Computed config is not editable — delete and recreate to repoint it'));
        } else {
          const rels = db.fields.filter((x) => x.type === 'relation');
          const relSel = pickerSelect({ name: 'relationField', title: 'Relation', options: rels.map((r) => ({ id: r.name, label: r.name })), value: state.relationField || (rels[0]?.name ?? null) });
          state.relationField = state.relationField || (rels[0]?.name ?? '');
          relSel.input.addEventListener('change', () => { state.relationField = relSel.input.value; changed(); });
          kids.push(dsection('Relation', relSel));
          kids.push(dsection('Target field', el('input', { class: 'form-control', value: state.targetField ?? '', placeholder: 'Field on the target table', oninput: (e) => { state.targetField = e.target.value; changed(); } })));
          if (t === 'rollup') {
            kids.push(dsection('Aggregate', segCtl(fdc.AGGREGATES, state.aggregate ?? 'count', (v) => { state.aggregate = v; changed(); })));
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
            value: state.default, time: state.date.time, format: state.date.format ?? 'iso', compact: false,
            onChange: (iso) => { state.default = iso ?? ''; changed(); },
          }));
        }
        kids.push(dsection('Default', body));
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
    if (!isEdit) {
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
  if (existing.type === 'number' || existing.type === 'formula') {
    patch.format = c.format ?? null;
    patch.unit = c.unit ?? null;
    patch.currency = c.currency ?? null;
    patch.decimals = c.decimals ?? null;
    patch.separator = c.separator ?? null;
  }
  if (existing.type === 'date') {
    patch.format = c.format ?? null;
    patch.time = c.time ?? null;
  } else if (existing.type === 'select' || existing.type === 'multiselect') {
    patch.options = (c.options ?? []).filter((o) => o.name && o.name.trim());
  } else if (existing.type === 'workflow') {
    patch.states = (c.states ?? []).filter((s) => s.name && s.name.trim());
  }
  if (existing.type === 'formula' && state.expression) patch.expression = state.expression;
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
async function reorderField(db, fromName, toName, { after = false } = {}) {
  const order = db.fields.map((f) => f.name).filter((n) => n !== fromName);
  const at = order.indexOf(toName);
  if (at < 0) return;
  order.splice(after ? at + 1 : at, 0, fromName);
  // The columns move IN PLACE — cells relocate, nothing repaints, scroll and
  // focus stay put (Kyle, 2026-08-22: the full redraw read as clunky flicker).
  // The schema write happens behind the move; if it fails, redraw to truth.
  // Must mirror drawDatabase's cols selection or the in-place move lands on
  // the wrong cell index.
  const cols = db.fields.filter((f) => f.type !== 'document').map((f) => f.name);
  const fromIdx = cols.indexOf(fromName);
  const toIdx = cols.indexOf(toName);
  const table = document.querySelector('.wv-grid');
  if (table && fromIdx >= 0 && toIdx >= 0) {
    for (const row of table.querySelectorAll('tr')) {
      const cells = row.children;
      const from = cells[1 + fromIdx];
      const to = cells[1 + toIdx];
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
    showDatabase(db.id); // the move did not hold — show the truth
  }
}


/* The "+" that closes the grid's header bar. A menu rather than a straight
   dialog because it replaces the "⚙ Fields" button in table view, so it has
   to keep relations and field management reachable — not just adding. */
function addFieldMenuButton(db) {
  const btn = el('button', { class: 'add-field-btn', type: 'button', title: 'Add or manage fields' }, '+');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const row = (label, run) => el('button', {
      class: 'chip-pop-row', type: 'button',
      onclick: () => { document.querySelector('.chip-pop')?.remove(); run(); },
    }, label);
    showPopover(btn, [
      row('+ Field', () => addFieldDialog(db)),
      row('+ Relation', () => addRelationDialog(db)),
      row('⚙ Manage fields', () => openSchemaEditor(db)),
    ]);
  });
  return btn;
}

function renderBoard(main, db, items, onSaved) {
  const groupField = db.fields.find((f) => f.type === 'workflow') ?? db.fields.find((f) => f.type === 'select');
  if (!groupField) {
    main.append(el('div', { class: 'wv-empty' }, 'Board view needs a workflow or select field.'));
    return;
  }
  const groups = groupField.type === 'workflow' ? groupField.states.map((s) => s.name) : groupField.options;
  const board = el('div', { class: 'board' });
  const redraw = () => drawDatabase(db, items);

  for (const group of groups) {
    const inGroup = items.filter((i) => i.fields[groupField.name] === group);
    const col = el('div', { class: 'board-col', dataset: { group } },
      el('h3', {}, group, el('span', {}, String(inGroup.length))),
      ...inGroup.map((item) => {
        const expanded = state.expanded.has(item.id);
        const nameInput = el('input', { class: 'card-name', value: item.name || '' });
        nameInput.addEventListener('click', (e) => e.stopPropagation());
        nameInput.addEventListener('change', async () => {
          try {
            await api('PATCH', `/entities/${item.id}`, { values: { Name: nameInput.value } });
            toast('Saved');
            onSaved();
          } catch (err) { toast(err.message, true); }
        });
        const card = el('div', {
          class: 'card board-card' + (expanded ? ' editing' : ''), draggable: 'true', dataset: { id: item.id },
          onclick: (e) => {
            if (expanded) return;
            const pick = rowClickTarget(e);
            if (pick === 'ignore') return;
            if (pick) return openCellPicker(pick);
            peekEntity(item.id);
          },
        },
          el('div', { class: 'card-top' },
            el('a', { class: 'pid', href: `#/entity/${item.id}`, title: 'Open entity page' }, `#${item.publicId} ↗`),
            el('span', { style: 'flex:1' }),
            el('button', {
              class: 'btn btn-sm btn-ghost-secondary tiny' + (expanded ? ' active-toggle' : ''),
              title: 'Edit fields & documents',
              onclick: (e) => {
                e.stopPropagation();
                if (expanded) state.expanded.delete(item.id);
                else state.expanded.add(item.id);
                redraw();
              },
            }, expanded ? '✕' : '✎')),
          nameInput,
          !expanded && item.doc ? el('div', { class: 'doc-preview card-doc-preview' }, docPreview(item.doc)) : null);
        if (expanded) {
          const fieldsBox = el('div', { class: 'card-fields' });
          for (const f of db.fields) {
            if (f.name === 'Name' || f.type === 'document' || f.id === groupField.id) continue;
            fieldsBox.append(el('div', { class: 'fieldrow compact' },
              el('label', {}, fieldNameLabel(f)), editorFor(f, item, db, onSaved, { compact: true })));
          }
          card.append(fieldsBox, docsEditor(item, db, onSaved));
        }
        card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', item.id));
        return card;
      }));
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('dragover'); });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('dragover');
      const id = e.dataTransfer.getData('text/plain');
      try {
        if (groupField.type === 'workflow') await api('POST', `/entities/${id}/state`, { field: groupField.name, state: group });
        else await api('PATCH', `/entities/${id}`, { values: { [groupField.name]: group } });
        await loadSchema();
        onSaved();
      } catch (err) { toast(err.message, true); }
    });
    board.append(col);
  }
  // Dragging a card near either edge scrolls the column strip horizontally.
  board.addEventListener('dragover', (e) => {
    const r = board.getBoundingClientRect();
    if (e.clientX > r.right - 60) board.scrollLeft += 14;
    else if (e.clientX < r.left + 60) board.scrollLeft -= 14;
  });
  main.append(board);
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
        el('a', { class: 'btn btn-sm', href: '#/map' }, '🗺 Map'),
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
    el('div', { class: 'card list-rows' }, ...space.tables.map((d) => {
      const wf = d.fields.find((x) => x.type === 'workflow');
      const bits = [
        `${d.entityCount} ${d.noun ? d.noun + (d.entityCount === 1 ? '' : 's') : (d.entityCount === 1 ? 'entity' : 'entities')}`,
        `${d.fields.length} fields`,
        ...(wf ? [`${wf.states.length}-state ${wf.name.toLowerCase()}`] : []),
        ...(d.fields.some((x) => x.type === 'relation') ? ['linked'] : []),
      ];
      return el('div', { class: 'list-row space-table-row', onclick: () => { location.hash = `#/table/${d.id}`; } },
        el('span', { class: 'space-table-main' },
          el('span', { class: 'space-table-name' }, iconEl(d.icon, 'wv-icon'), d.name),
          d.description ? el('span', { class: 'space-table-desc' }, d.description.replace(/[#*_`\[\]]/g, '').slice(0, 90)) : null),
        el('span', { class: 'spacer' }),
        el('span', { class: 'pid' }, bits.join(' · ')));
    })));
}

/* ---------- relation map (tables, relations, automations) ---------- */

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
  const tables = schema.flatMap((s) => s.tables.map((t) => ({ ...t, space: s.space })));
  if (!tables.length) {
    main.append(el('div', { class: 'wv-empty' }, 'No tables yet.'));
    return;
  }

  const W = 1060;
  const NODE_W = 190, NODE_H = 58;
  const autosByTable = new Map();
  for (const a of automations) {
    if (!autosByTable.has(a.tableId)) autosByTable.set(a.tableId, []);
    autosByTable.get(a.tableId).push(a);
  }
  const hasWebhook = automations.some((a) => a.actions.some((x) => x.type === 'webhook'));

  // Circle layout, with vertical room under each node for automation pills.
  const n = tables.length;
  const cx = W / 2, cy = 290;
  const rx = Math.min(400, 140 + n * 45), ry = 185;
  const pos = new Map();
  tables.forEach((t, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    pos.set(t.id, { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  });
  const maxAutos = Math.max(0, ...[...autosByTable.values()].map((a) => a.length));
  const H = 580 + maxAutos * 24;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'relmap' });

  // Relations: draw each pair once (dedupe by field id vs inverse id).
  const drawn = new Set();
  for (const t of tables) {
    for (const f of t.fields) {
      if (f.type !== 'relation' || drawn.has(f.id) || drawn.has(f.inverseFieldId)) continue;
      drawn.add(f.id);
      const a = pos.get(t.id), b = pos.get(f.targetDbId);
      if (!a || !b) continue;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      svg.append(svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'rel-line' }));
      const thisCard = f.many ? '∗' : '1';
      const target = tables.find((x) => x.id === f.targetDbId);
      const invField = target?.fields.find((x) => x.id === f.inverseFieldId);
      const invCard = invField?.many ? '∗' : '1';
      const label = `${t.name}.${f.name} ${invCard}—${thisCard} ${f.inverseField ?? ''}`;
      const tw = label.length * 6.2 + 12;
      svg.append(svgEl('rect', { x: mx - tw / 2, y: my - 10, width: tw, height: 18, rx: 9, class: 'rel-label-bg' }));
      svg.append(svgEl('text', { x: mx, y: my + 3, 'text-anchor': 'middle', class: 'rel-label' }, label));
    }
  }

  // External webhook node.
  if (hasWebhook) {
    svg.append(svgEl('rect', { x: W - 130, y: 16, width: 112, height: 34, rx: 8, class: 'ext-node' }));
    svg.append(svgEl('text', { x: W - 74, y: 37, 'text-anchor': 'middle', class: 'node-title' }, '🌐 webhooks'));
  }

  // Table nodes + automation pills.
  for (const t of tables) {
    const p = pos.get(t.id);
    const x = p.x - NODE_W / 2, y = p.y - NODE_H / 2;
    const g = svgEl('g', { class: 'table-node', cursor: 'pointer' });
    g.addEventListener('click', () => { location.hash = `#/table/${t.id}`; });
    g.append(svgEl('rect', { x, y, width: NODE_W, height: NODE_H, rx: 10, class: 'node-box' }));
    g.append(svgEl('text', { x: p.x, y: y + 24, 'text-anchor': 'middle', class: 'node-title' }, t.name));
    g.append(svgEl('text', { x: p.x, y: y + 43, 'text-anchor': 'middle', class: 'node-sub' }, `${t.space} • ${t.entityCount} entities`));
    svg.append(g);

    const autos = autosByTable.get(t.id) ?? [];
    autos.forEach((a, i) => {
      const ay = y + NODE_H + 10 + i * 22;
      const actions = a.actions.map((x) =>
        x.type === 'set-field' ? `set ${x.field}` :
        x.type === 'append-doc' ? `append ${x.field}` :
        x.type === 'add-comment' ? 'comment' : 'webhook').join(', ');
      const trig = a.trigger.type === 'state-changed' ? `${a.trigger.field}→${a.trigger.toState ?? '*'}` :
        a.trigger.type === 'field-updated' ? `${a.trigger.field} changed` : 'created';
      const label = `⚡ ${trig} ⇒ ${actions}`;
      const tw = Math.min(NODE_W + 70, label.length * 5.8 + 14);
      svg.append(svgEl('line', { x1: p.x, y1: y + NODE_H, x2: p.x, y2: ay, class: 'auto-line' }));
      svg.append(svgEl('rect', { x: p.x - tw / 2, y: ay, width: tw, height: 17, rx: 8.5, class: 'auto-pill' + (a.enabled ? '' : ' off') }));
      svg.append(svgEl('text', { x: p.x, y: ay + 12, 'text-anchor': 'middle', class: 'auto-label' }, label));
      if (a.actions.some((x) => x.type === 'webhook') && hasWebhook) {
        svg.append(svgEl('line', { x1: p.x + tw / 2, y1: ay + 8, x2: W - 130, y2: 40, class: 'auto-line dashed' }));
      }
    });
  }

  const legend = el('div', { class: 'map-legend' },
    el('span', {}, '▢ table (click to open)'),
    el('span', {}, '— relation (1/∗ = cardinality)'),
    el('span', {}, '⚡ automation: trigger ⇒ actions'));
  const wrap = el('div', { class: 'map-wrap' });
  wrap.append(svg);
  main.append(wrap, legend);
}

/* ---------- the embedded document editor (Feature #45) ----------
   Vditor in `ir` mode: the rendered document is the editing surface, so there
   is no mode to switch, nothing to preview and nothing to save by hand. The
   toolbar is hidden — every markdown block is reachable from the slash menu
   below, which keeps the document the only chrome on the page. */

const DOC_SAVE_DEBOUNCE = 600;
const liveEditors = new Set();
const pendingDocSaves = new Map();

/* Picking this item opens the ⌘K search instead of inserting text. It travels
   through Vditor as a value, because a hint item can only insert — so the
   editor's own input handler recognises the marker, takes it back out and
   hands over to the picker. U+2063 is invisible and not something a writer
   types by accident. */
const ENTITY_LINK_MARKER = '⁣entity-link⁣';

/* The block set. With the toolbar hidden this list is the ONLY way to reach a
   markdown construct, so anything missing here is unreachable. `insert` is
   what replaces the typed "/query" — Vditor swaps the trigger for the value.

   Line-prefix blocks carry placeholder text on purpose. A marker with nothing
   after it is not a block: "# " round-tripped through Lute as "#\n" and "> "
   vanished to "\n", so every heading, quote and list item the menu inserted
   came out empty. Placeholders make the block real and visible, and the
   writer types over them. */
function slashItems() {
  return [
    { label: 'Heading 1', insert: '# Heading' },
    { label: 'Heading 2', insert: '## Heading' },
    { label: 'Heading 3', insert: '### Heading' },
    { label: 'Bold', insert: '**text**' },
    { label: 'Italic', insert: '*text*' },
    { label: 'Strikethrough', insert: '~~text~~' },
    { label: 'Inline code', insert: '`code`' },
    // The language is a placeholder like the text ones: a bare ``` fence is
    // plaintext to hljs — zero token spans, one colour, forever (Issue #35).
    { label: 'Code block', insert: '```js\ncode\n```' },
    { label: 'Quote', insert: '> Quote' },
    { label: 'Bulleted list', insert: '- List item' },
    { label: 'Numbered list', insert: '1. List item' },
    { label: 'Task list', insert: '- [ ] To do' },
    { label: 'Table', insert: '| Column | Column |\n| --- | --- |\n| Cell | Cell |' },
    { label: 'Divider', insert: '\n---\n' },
    { label: 'Link', insert: '[text](url)' },
    { label: 'Image', insert: '![alt](url)' },
    { label: 'Mermaid diagram', insert: '```mermaid\ngraph TD\n  A --> B\n```' },
    { label: 'Entity link', insert: ENTITY_LINK_MARKER },
  ];
}

// [[Space/Table#12|Name]] — qualified, so a table name shared by two spaces
// cannot resolve to the wrong one. The label keeps the chip readable when the
// reference is read as plain markdown.
function entityReference(hit) {
  return `[[${hit.db}#${hit.publicId}|${hit.name}]]`;
}

function slashHint(query) {
  const q = String(query ?? '').toLowerCase();
  return slashItems()
    .filter((i) => i.label.toLowerCase().includes(q))
    .map((i) => ({
      value: i.insert,
      html: `<span class="slash-item"><b>${i.label}</b></span>`,
    }));
}

// Editor chrome, document content and code highlighting each take a theme;
// all three follow weave's data-bs-theme so a toggle does not leave a light
// document sitting inside a dark page.
function vditorTheme() {
  const dark = document.documentElement.dataset.bsTheme === 'dark';
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

function mountDocEditor(host, { value, placeholder, onInput, onBlur, autoFocus }) {
  const t = vditorTheme();
  const chips = attachRefChips(host);
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
    toolbar: [],
    toolbarConfig: { hide: true, pin: false },
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
    hint: { emoji: {}, extend: [{ key: '/', hint: slashHint }] },
    // Every decoration pass on this host starts once the editor is actually
    // built — an attach-time schedule can fire before Vditor has a surface.
    after: () => {
      dedupeVditorSprites();
      scheduleDecorFor(host);
      if (autoFocus) editor.focus();
    },
    ...(onBlur ? { blur: () => onBlur() } : {}),
    input: (v) => {
      // The entity-link command arrives here as its marker, never as content.
      if (v.includes(ENTITY_LINK_MARKER)) return pickEntityLink(editor, v, onInput);
      onInput(v);
      chips.schedule();
    },
  });
  liveEditors.add(editor);
  return editor;
}

/* ---------- the shared row editor (Issue #89) ----------
   Grid, board and list rows keep their <textarea> as the resting state —
   it is the value the Save button reads and the redraw-preservation map
   snapshots. ONE shared Vditor mounts into whichever cell has focus and
   unmounts on blur; measured on a warm page the round trip costs 2–5ms,
   so focus feels instant and no instance-per-row ever exists. */

let rowEditor = null; // { editor, host, area } — the one mounted cell

function unmountRowEditor() {
  if (!rowEditor) return;
  const { editor, host, area } = rowEditor;
  rowEditor = null;
  try { area.value = editor.getValue(); } catch { /* keep the last synced value */ }
  liveEditors.delete(editor);
  try { editor.destroy(); } catch { /* already gone with the DOM */ }
  host.remove();
  area.classList.remove('hidden');
}

function mountRowEditor(area) {
  if (rowEditor?.area === area) return;
  unmountRowEditor();
  const host = el('div', { class: 'doc-inline-editor' });
  area.after(host);
  area.classList.add('hidden');
  const editor = mountDocEditor(host, {
    value: area.value,
    placeholder: 'Write… press / for blocks',
    // Sync every keystroke back: the textarea stays the source of truth for
    // Save and for value preservation across view redraws.
    onInput: (v) => { area.value = v; },
    onBlur: () => unmountRowEditor(),
    autoFocus: true,
  });
  rowEditor = { editor, host, area };
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
  for (const s of [...refChipLayers, ...docRails, ...docFolds]) {
    if (s.host === host) s.schedule();
  }
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
  const spans = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    // The IR surface is itself a <pre contenteditable>, so the root never
    // counts as a code context — only something nearer does.
    const codeCtx = n.parentElement?.closest(lib.REF_SKIP_SELECTOR);
    if (codeCtx && codeCtx !== root) continue;
    const found = lib.findRefSpans(n.nodeValue);
    if (!found.length) continue;
    const box = n.parentElement.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) continue;
    for (const s of found) spans.push({ node: n, ...s });
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
}

/* ---------- document outline dash rail (Issue #87) ----------
   A minimap in the left gutter of the entity page's document panels: one
   dash per heading (longer for higher levels), a tracker that follows the
   scroll, click to jump. Vditor's own outline stays disabled — it wants the
   same gutter and a tree; the rail says "where am I" without one. */

const DASH_READING_LINE = 80; // px below the viewport top: past the header
const docRails = new Set();

function attachDashRail(section, host) {
  const st = { section, host, rail: el('nav', { class: 'doc-rail', title: 'Document outline' }), timer: 0 };
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
  if (!document.body.contains(st.section)) { docRails.delete(st); return; }
  const root = st.host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return;
  // Block headings only — direct children of the surface, never something a
  // preview rendered inside a code block. Headings hidden inside a fold
  // (display:none, so no offsetParent) leave the map with their section.
  const heads = [...root.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6')]
    .filter((h) => h.offsetParent !== null);
  const lib = globalThis.WeaveEditorLib;
  const spec = lib.railSpec(heads.map((h) => ({ level: +h.tagName[1], text: headText(h) })));
  if (!spec.length) { st.rail.remove(); return; } // < 3 headings: no rail
  if (!st.rail.isConnected) st.section.append(st.rail);
  const current = lib.currentSection(heads.map((h) => h.getBoundingClientRect().top), DASH_READING_LINE);
  st.rail.replaceChildren(...spec.map((d, i) => el('button', {
    class: 'doc-rail-dash' + (i === current ? ' active' : ''),
    type: 'button',
    title: d.text,
    style: `width:${d.width}px`,
    // Instant, not smooth: a backgrounded tab never runs the animation
    // frames a smooth scroll rides on, and the jump is the point anyway.
    onclick: () => heads[i].scrollIntoView({ block: 'start' }),
  })));
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
      refResolveCache.set(ref, { href, label: a.textContent, kind });
    });
  } catch { /* resolution is decoration; a failed fetch leaves literals */ }
}

/* Hands off to the same search the ⌘K palette runs, so one search surface
   serves navigation and referencing. Picking writes the reference where the
   marker was; dismissing leaves the document as it was. */
function pickEntityLink(editor, value, onInput) {
  const settle = (replacement) => {
    const next = value.replace(ENTITY_LINK_MARKER, replacement);
    editor.setValue(next);
    editor.focus();
    onInput(next);
  };
  openCommandK({
    entitiesOnly: true,
    onPick: (hit) => settle(entityReference(hit)),
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
  unmountRowEditor(); // restore the row's textarea before the page goes away
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

  const nameInput = el('input', { class: 'name-edit', value: entity.name });
  nameInput.addEventListener('change', async () => {
    try { await api('PATCH', `/entities/${id}`, { values: { Name: nameInput.value } }); toast('Renamed'); }
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
  ], { title: 'Entity actions', align: 'right' });

  /* Crumb row, then a title row that ends in the ⋮ — the same two-row shape
     viewHeader() builds for tables, boards, lists and spaces, so the menu is
     in one place across the app. */
  mount.append(
    el('div', { class: 'view-header' },
      el('div', { class: 'crumb' },
        ...(inPeek
          ? [el('a', { href: `#/table/${entity.dbId}` }, entity.db), ' › ']
          : weaveBreadcrumbs.entityCrumbs($('#ws-name').textContent || 'workspace', state.trail, entityHop(entity))
            .map((c, i) => i === 0 ? [el('a', { href: wsHomeHref() }, c.label), ' › '] : [el('a', { href: c.href }, c.label), ' › ']).flat()),
        el('span', {
          class: 'permalink-copy', title: 'Copy permalink',
          onclick: () => copyText(`${location.origin}${WS_PREFIX}/e/${id}`, 'Permalink copied'),
        }, `#${entity.publicId} ⧉`)),
      el('div', { class: 'wv-toolbar entity-head' }, nameInput, dlBtn)),
  );

  const grid = el('div', { class: 'entity-grid' });
  mount.append(grid);
  const left = el('div');
  const right = el('div');
  grid.append(left, right);

  /* One document section per document field. The rendered document IS the
     editor — no edit mode, no preview toggle, no save button. The section
     title is a quiet collapsible line rather than a card header, so nothing
     competes with the document for attention. */
  for (const f of documentFields(db)) {
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
    const caret = el('button', {
      class: 'doc-caret', type: 'button', title: 'Collapse section',
      onclick: () => {
        const open = body.classList.toggle('hidden');
        caret.classList.toggle('closed', open);
        docSectionCollapse(id, f.name, open);
      },
    });
    const section = el('section', { class: 'doc-section' },
      el('div', { class: 'doc-section-head' },
        caret,
        el('span', { class: 'doc-section-name' }, f.name),
        el('span', {
          class: 'doc-anchor', title: 'View fullscreen',
          onclick: () => fullscreenViewer(`${entity.name || 'Document'} — ${f.name}`, { url: `${fmtBase}.html` }),
        }, '⛶'),
        el('span', {
          class: 'doc-anchor', title: 'Copy link to this document',
          onclick: () => copyText(`${location.origin}${fmtBase}.html`, 'Document link copied'),
        }, '🔗'),
        status, dl),
      body);
    left.append(section);

    if (docSectionCollapse(id, f.name)) {
      body.classList.add('hidden');
      caret.classList.add('closed');
    }
    const rail = attachDashRail(section, host);
    const folds = attachHeadingFolds(host, id, f.name);
    const ed = mountDocEditor(host, {
      value: entity.docs?.[f.name] ?? '',
      placeholder: `Write ${f.name}… press / for blocks`,
      onInput: (value) => {
        scheduleDocSave(id, f.name, value, status);
        rail.schedule(); // headings may have changed
        folds.schedule(); // a re-render drops the fold classes; re-apply
      },
    });
    editors?.push(ed);
  }

  /* Collections of related records go under the documents, in the body rather
     than the side panel: they are work to do, not attributes to read. Each is
     fetched on its own so a slow one cannot hold up the page. */
  for (const f of db.fields.filter((x) => x.type === 'relation' && x.many)) {
    const slot = el('div', {});
    left.append(slot);
    relatedGrid(entity, f, refresh)
      .then((grid) => { if (grid) slot.replaceWith(grid); })
      .catch((err) => toast(err.message, true));
  }

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

  /* Fields panel */
  const fieldsBody = el('div', { class: 'card-body' });
  const fieldsPanel = el('div', { class: 'card panel' },
    el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, 'Fields')),
    fieldsBody);
  for (const f of db.fields) {
    if (f.name === 'Name' || f.type === 'document') continue;
    // A collection relation is the grid in the body; a row of chips repeating
    // it here would be the same links twice, one of them worse.
    if (f.type === 'relation' && f.many) continue;
    fieldsBody.append(el('div', { class: 'fieldrow' },
      el('label', {}, fieldNameLabel(f)), editorFor(f, entity, db, () => refresh())));
  }
  if (!fieldsBody.childElementCount) {
    fieldsBody.append(el('span', { class: 'wv-empty' }, 'This table has no fields beyond its name.'));
  }
  // The side column reads top-down as metadata about the entity: what it is
  // (Fields), what people said (Comments), what happened (Activity). That
  // leaves the main column to the documents, which are the reason to be here.
  right.append(fieldsPanel, commentsPanel, actPanel); // delete lives in the ⋮ menu
}

/* ---------- create & schema dialogs ---------- */

function quickCreate(db) {
  modal(`New ${db.noun ?? db.name}`, [
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
          : f.targetDb ? `→ ${f.targetDb}${f.many ? ' (many)' : ''}`
          : f.via ? `via ${f.via}${f.targetField ? ` . ${f.targetField}` : ''}${f.aggregate ? ` (${f.aggregate})` : ''}`
          : f.expression ?? ''),
      el('td', {}, f.name === 'Name' ? '' : holdToConfirm('🗑', async () => {
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
  fieldDialog(db, null, () => openSchemaEditor(allTables().find((d) => d.id === db.id)));
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
        peekEntity(item.id);
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
        }, `+ New ${target.name}`),
        el('button', {
          class: 'add-entity-btn', type: 'button',
          onclick: async (e2) => {
            const list = await api('POST', `/tables/${target.id}/query`, { select: ['Name'] });
            const before = linked.map((sm) => sm.id);
            searchPicker({
              anchor: e2?.currentTarget ?? null, title: `${f.name}`, placeholder: 'Search records…',
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

const fmtValue = (v) => (v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));

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
    el('td', {}, el('span', { class: `chip activity-kind kind-${a.kind}` }, a.kind)),
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
  return el('span', { class: 'chip rel' + (a.deleted ? ' deleted' : '') },
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
    row('Event', el('span', { class: `chip activity-kind kind-${a.kind}` }, a.kind)),
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
  main.replaceChildren(
    viewHeader({
      crumbs: [],
      permalink: location.origin + wsHomeHref(),
      title: ws.name,
      onRename: async (name) => {
        const updated = await api('PATCH', '/workspace', { name });
        location.href = WS_PREFIX ? `/w/${updated.name}/` : '/';
      },
      description: ws.description,
      onSaveDescription: async (md) => { await api('PATCH', '/workspace', { description: md }); },
    }),
    dbs.length
      ? el('div', { class: 'card list-rows' }, ...dbs.map((d) =>
        el('div', { class: 'list-row', onclick: () => { location.hash = `#/table/${d.id}`; } },
          el('span', {}, d.qualified), el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, `${d.entityCount} entities`))))
      : el('div', { class: 'wv-empty' }, 'Welcome to Weave. Create a space and a table to get started.'),
    /* The system tables live below the workspace's own, marked as weave's
       rather than the user's — they are reached from here because they belong
       to no space. */
    el('div', { class: 'card list-rows system-tables' },
      el('div', { class: 'list-row', onclick: () => { location.hash = '#/activity'; } },
        el('span', {}, 'Activity'), el('span', { class: 'chip system-chip' }, 'system'),
        el('span', { class: 'spacer' }),
        el('span', { class: 'pid' }, 'every event in this workspace'))));
  // Saved views (Feature #17): named cross-table slices; share mints a
  // read-only capability URL that outlives the auth wall until revoked.
  try {
    const views = await api('GET', '/views');
    if (views.length) {
      main.append(el('div', { class: 'card list-rows' },
        ...views.map((v) => el('div', { class: 'list-row', onclick: () => { location.hash = `#/view/${v.id}`; } },
          el('span', {}, v.name),
          v.shared ? el('span', { class: 'chip system-chip' }, 'shared') : null,
          el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, `${v.blocks.length} block${v.blocks.length === 1 ? '' : 's'}`)))));
    }
  } catch { /* older server */ }
  // The workspace's shape, read-only (Feature #51): the same .mmd any doc can
  // reference, rendered here through the vendored mermaid.
  if (dbs.some((d) => !d.system)) {
    const mapCard = el('div', { class: 'card panel home-map' },
      el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, 'Relation map')),
      el('div', { class: 'card-body' }, '…'));
    main.append(mapCard);
    fetch(`${WS_PREFIX}/api/relation-map.mmd`).then((r) => r.text()).then((mmd) => {
      const body = mapCard.querySelector('.card-body');
      body.replaceChildren(el('pre', { class: 'mermaid' }, mmd));
      renderMermaidIn(body);
    }).catch(() => mapCard.remove());
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
      el('span', { class: 'kind-badge' },
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
      }, '⧉')),
    el('div', { class: 'snip mono' }, permalink),
    hit.snippet ? el('div', { class: 'snip' }, hit.snippet) : null);
}

// The sidebar search control IS the ⌘K palette — one search surface.
function wireSearchButton() {
  $('#search-btn')?.addEventListener('click', openCommandK);
}

/* One search surface. By default a pick navigates; callers that need a
   reference rather than a jump — the editor's entity-link command — pass
   their own onPick and get the hit back instead. */
function openCommandK({ onPick = null, onDismiss = null, entitiesOnly = false } = {}) {
  if ($('#cmdk-back')) return;
  let picked = false;
  const dismiss = () => { back.remove(); if (!picked) onDismiss?.(); };
  const back = el('div', { id: 'cmdk-back', onclick: (e) => { if (e.target === back) dismiss(); } });
  const input = el('input', {
    id: 'cmdk-input', autocomplete: 'off',
    placeholder: entitiesOnly ? 'Search entities to link…' : 'Search workspace, spaces, tables, entities…',
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
      // Only an entity can be the target of a [[…]] reference.
      if (entitiesOnly) hits = hits.filter((h) => h.kind === 'entity');
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

/* The weave-on rope (brand decision 7) covers every page-load wait.

   Two rules, and they pull against each other:
   - It must not tax fast navigation, so it only appears once a wait passes
     LOADER_SHOW_AFTER_MS. Most route changes are local and never show it.
   - Once it does appear it always finishes at least one whole cycle, so the
     rope is never caught half-woven. Hiding therefore waits out the remainder
     of the cycle it is in — which is a full cycle when it has only just
     appeared, and rounds up to the next boundary when the wait ran long.

   The SVGs are fetched and inlined rather than used as <img>: only an inline
   SVG exposes setCurrentTime, and restarting the clock at show time is what
   makes "one whole cycle" true rather than approximately true — an <img>
   timeline free-runs from page load, so it would be at an arbitrary phase. */
const LOADER_CYCLE_MS = 2000; // must match LOADER_CYCLE_MS in brand/build-logos.mjs
const LOADER_SHOW_AFTER_MS = 200;
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
   UI). The route's own render replaces it; the rope overlay still covers
   loads long enough to earn animation. */
function paintSkeleton(kind) {
  const main = $('#main');
  if (!main) return;
  const line = (w, h = 12) => el('div', { class: 'sk sk-line', style: `width:${w};height:${h}px` });
  const bar = () => el('div', { class: 'sk-row' }, line('28px'), line('34%', 14), line('12%'), line('10%'), line('8%'));
  if (kind === 'db') {
    main.replaceChildren(
      el('div', { class: 'sk-toolbar' }, line('180px', 22), line('120px', 22)),
      el('div', { class: 'card panel sk-card' },
        el('div', { class: 'sk-row sk-head' }, line('30px'), line('20%', 13), line('14%', 13), line('12%', 13), line('10%', 13)),
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
  const hash = location.hash || '#/';
  // The skeleton of where we're going, painted before we go (Feature #49).
  paintSkeleton(/^#\/(?:table|db)\//.test(hash) ? 'db' : /^#\/entity\//.test(hash) ? 'entity' : 'list');
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

// Every route change is a page-load wait, including the one boot performs.
function route() {
  return withPageLoader(renderRoute);
}

window.addEventListener('hashchange', route);

/* Spaces and tables are created by the single-instance inline input in the
   sidebar (inlineNameInput). The modal variants that used to live here were
   unreachable and styled differently, so the same action had two competing
   designs — weave Issue #16. */

/* Shift+Enter anywhere on a table view = quick-create in the current table. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.shiftKey) return;
  if (state.route?.page !== 'db') return;
  if (e.target.closest?.('input,select,textarea,[contenteditable]')) return;
  if ($('#modal-back') || $('#cmdk-back')) return;
  const db = allTables().find((d) => d.id === state.route.dbId);
  if (!db) return;
  e.preventDefault();
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
    const current = WS_PREFIX ? WS_PREFIX.slice(3) : list.find((w) => w.default)?.name;
    $('#ws-name').textContent = current ?? '';
    const weaveWs = list.find((w) => w.name === 'weave');
    const pinned = $('#rail-weave');
    if (pinned) {
      if (weaveWs) pinned.href = weaveWs.default ? '/' : '/w/weave/';
      pinned.classList.toggle('active', current === 'weave');
    }
    listBox.replaceChildren(
      ...list.filter((w) => w.name !== 'weave').map((w) => {
        const prefix = w.default ? '' : `/w/${w.name}`;
        const chip = el('a', {
          class: 'ws-icon' + (w.name === current ? ' active' : ''),
          href: w.default ? '/' : `/w/${w.name}/`,
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
   (the rail stays); the expand chevron lives at the top of the rail. */
function wireNavCollapse() {
  const app = $('#app');
  const collapse = $('#nav-collapse');
  const expand = $('#nav-expand');
  if (!app || !collapse || !expand) return;
  const apply = (collapsed) => {
    app.classList.toggle('nav-collapsed', collapsed);
    expand.classList.toggle('hidden', !collapsed);
    localStorage.setItem('weave-nav-collapsed', collapsed ? '1' : '');
  };
  collapse.addEventListener('click', () => apply(true));
  expand.addEventListener('click', () => apply(false));
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
    btn.textContent = icons[pref];
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
  // reached the server yet, and never mid-edit in a grid row's textarea.
  if (document.querySelector('textarea.doc-inline') || pendingDocSaves.size) {
    toast('Schema changed elsewhere — reopen this entity to see new fields');
    return;
  }
  route();
});

// The loader is fetched before the first route so boot's own wait can use it.
initPageLoader();
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
