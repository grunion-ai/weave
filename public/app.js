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
   weight of the surrounding chrome — see the nav-caret UAT note in style.css. */
const chevron = () => svgEl('svg', {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
  'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
}, svgEl('path', { d: 'M6 9l6 6l6 -6' }));

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

const state = { schema: [], route: null, expanded: new Set(), refocus: null };

// Single entry point for opening an entity (future: side-peek drawer).
function openEntity(id) { location.hash = `#/entity/${id}`; }

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
function viewHeader({ crumbs = [], permalink, title, onRename = null, description = null, onSaveDescription = null, actions = [] }) {
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
  box.append(el('div', { class: 'wv-toolbar view-title-row' }, titleInput, ...actions.filter(Boolean)));

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
      el('button', {
        class: 'nav-caret' + (isFolded ? ' folded' : ''),
        title: isFolded ? `Expand ${space.space}` : `Collapse ${space.space}`, type: 'button',
        'aria-expanded': String(!isFolded),
        onclick: () => {
          if (folded.has(space.spaceId)) folded.delete(space.spaceId);
          else folded.add(space.spaceId);
          localStorage.setItem('weave-folded-spaces', JSON.stringify([...folded]));
          renderNav();
        },
      }, chevron()),
      el('a', { class: 'nav-space', href: `#/space/${space.spaceId}` }, space.space),
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
      }, db.name, el('span', { class: 'count' }, String(db.entityCount))));
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
  nav.append(foot);
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

function chipPicker({ trigger, options, current, onPick }) {
  trigger.classList.add('chip-trigger');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = showPopover(trigger, options.map((o) => el('button', {
      class: 'chip-pop-row', type: 'button',
      onclick: async () => { pop.remove(); if (o.name !== current) await onPick(o.name); },
    },
      el('span', { class: `chip ${o.cls ?? ''}` }, o.name),
      o.name === current ? el('span', { class: 'chip-pop-check' }, '✓') : '')));
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
  return { formula: 'ƒ', rollup: 'Σ', lookup: '↗', document: '¶' }[type] ?? '·';
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
      trigger: el('button', { class: 'chip', type: 'button', title: f.name }, val ?? '—'),
      options: [{ name: '—' }, ...f.options.map((o) => ({ name: o }))],
      current: val ?? '—',
      onPick: (name) => patch(name === '—' ? null : name),
    });
  }
  if (f.type === 'multiselect') {
    const box = el('span', { class: 'ms-box' });
    const current = Array.isArray(val) ? val : [];
    for (const v of current) {
      box.append(el('span', { class: 'chip' }, v, el('span', {
        class: 'x', onclick: () => patch(current.filter((x) => x !== v)),
      }, '×')), ' ');
    }
    const remaining = f.options.filter((o) => !current.includes(o));
    if (remaining.length) {
      const sel = el('select', { class: 'form-select form-select-sm inline-edit ghost-select', onchange: (e) => e.target.value && patch([...current, e.target.value]) },
        el('option', { value: '' }, '+'), ...remaining.map((o) => el('option', {}, o)));
      box.append(sel);
    }
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
      onclick: async () => {
        const target = allTables().find((d) => d.qualified === f.targetDb || `${d.space}/${d.name}` === f.targetDb);
        const list = await api('POST', `/tables/${target.id}/query`, { select: ['Name'] });
        const linked = new Set(current.map((s) => s.id));
        const options = list.items.filter((i) => !linked.has(i.id));
        if (!options.length) return toast('Nothing left to link');
        modal(`Link ${f.name}`, [
          el('select', { name: 'target', class: 'form-select full', style: 'width:100%' },
            ...options.map((o) => el('option', { value: o.id }, `#${o.publicId} ${o.name}`))),
        ], async (fd) => {
          await api('POST', `/entities/${id}/link`, { field: f.name, targets: [fd.get('target')] });
          await saved();
        }, 'Link');
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
  const input = el('input', {
    class: 'form-control form-control-sm inline-edit',
    type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text',
    value: val ?? '',
    onclick: (e) => e.stopPropagation(),
  });
  input.addEventListener('change', () => patch(input.value === '' ? null : f.type === 'number' ? Number(input.value) : input.value));
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

async function showDatabase(dbId, view) {
  const db = allTables().find((d) => d.id === dbId);
  if (!db) return showHome();
  if (state.route?.dbId !== dbId) state.expanded.clear();
  state.route = { page: 'db', dbId, view: view ?? state.route?.view ?? 'table' };
  renderNav();
  // public/ is served from disk while the server process is long-lived, so a
  // page can be newer than the routes behind it (git pull without a restart).
  // The trash badge is decoration — it must never keep the table from opening.
  const [result, trash] = await Promise.all([
    api('POST', `/tables/${db.id}/query`, {}),
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
    ...['table', 'board', 'list'].map((v) =>
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

  const onSaved = async () => {
    const fresh = await api('POST', `/tables/${db.id}/query`, {});
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

  if (state.route.view === 'table') renderTable(main, db, items, onSaved);
  else if (state.route.view === 'board') renderBoard(main, db, items, onSaved);
  else renderListView(main, db, items, onSaved);

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
          openEntity(item.id);
        },
      },
        el('td', { class: 'pid-cell' },
          el('a', { class: 'open-link', href: `#/entity/${item.id}`, title: 'Open entity page' }, `#${item.publicId} ↗`)),
        ...cols.map((c) => {
          const f = db.fields.find((x) => x.name === c);
          const kind = PICKER_FIELD_TYPES.includes(f.type) ? ' cell-pick'
            : READONLY_FIELD_TYPES.includes(f.type) ? ' cell-computed' : '';
          return el('td', { class: (f.type === 'number' ? 'num' : '') + kind }, editorFor(f, item, db, onSaved, { compact: true }));
        }),
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
        ...cols.map((c) => el('th', {
          onclick: () => { sortDir = sortKey === c ? -sortDir : 1; sortKey = c; draw(); },
        }, c + (sortKey === c ? (sortDir > 0 ? ' ↑' : ' ↓') : ''))),
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
            openEntity(item.id);
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
              el('label', {}, f.name), editorFor(f, item, db, onSaved, { compact: true })));
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

function renderListView(main, db, items, onSaved) {
  const wf = db.fields.find((f) => f.type === 'workflow');
  const rows = el('div', { class: 'card list-rows' });
  const redraw = () => drawDatabase(db, items);
  for (const item of items) {
    const expanded = state.expanded.has(item.id);
    const nameInput = el('input', { class: 'row-name', value: item.name || '' });
    nameInput.addEventListener('change', async () => {
      try {
        await api('PATCH', `/entities/${item.id}`, { values: { Name: nameInput.value } });
        toast('Saved');
        onSaved();
      } catch (err) { toast(err.message, true); }
    });
    rows.append(el('div', {
      class: 'list-row entity-row',
      onclick: (e) => {
        const pick = rowClickTarget(e);
        if (pick === 'ignore') return;
        if (pick) return openCellPicker(pick);
        openEntity(item.id);
      },
    },
      el('a', { class: 'pid', href: `#/entity/${item.id}`, title: 'Open entity page' }, `#${item.publicId} ↗`),
      nameInput,
      item.doc ? el('span', { class: 'doc-preview' }, docPreview(item.doc, 80)) : null,
      el('span', { class: 'spacer' }),
      wf ? editorFor(wf, item, db, onSaved, { compact: true }) : null,
      el('button', {
        class: 'btn btn-sm btn-ghost-secondary tiny' + (expanded ? ' active-toggle' : ''),
        title: 'Edit fields & documents',
        onclick: () => {
          if (expanded) state.expanded.delete(item.id);
          else state.expanded.add(item.id);
          redraw();
        },
      }, expanded ? '▴' : '▾')));
    if (expanded) {
      const detail = el('div', { class: 'list-detail' });
      const fieldsBox = el('div', { class: 'detail-fields' });
      for (const f of db.fields) {
        if (f.name === 'Name' || f.type === 'document') continue;
        fieldsBox.append(el('div', { class: 'fieldrow compact' },
          el('label', {}, f.name), editorFor(f, item, db, onSaved, { compact: true })));
      }
      detail.append(fieldsBox, docsEditor(item, db, onSaved));
      rows.append(detail);
    }
  }
  main.append(rows);
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
    el('div', { class: 'card list-rows' }, ...space.tables.map((d) =>
      el('div', { class: 'list-row', onclick: () => { location.hash = `#/table/${d.id}`; } },
        el('span', {}, d.name),
        el('span', { class: 'spacer' }),
        el('span', { class: 'pid' }, `${d.entityCount} entities`)))));
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

/* ---------- entity page ---------- */

async function showEntity(id) {
  let entity;
  try {
    entity = await api('GET', `/entities/${id}`);
  } catch {
    return showHome();
  }
  const db = allTables().find((d) => d.id === entity.dbId);
  state.route = { page: 'entity', id, dbId: entity.dbId };
  renderNav();
  const main = $('#main');
  main.replaceChildren();

  const refresh = () => showEntity(id);

  const nameInput = el('input', { class: 'name-edit', value: entity.name });
  nameInput.addEventListener('change', async () => {
    try { await api('PATCH', `/entities/${id}`, { values: { Name: nameInput.value } }); toast('Renamed'); }
    catch (err) { toast(err.message, true); }
  });

  const actBody = el('div', { class: 'card-body' });
  for (const a of [...entity.activity].reverse().slice(0, 20)) {
    const what = a.kind === 'state-changed' ? `${a.detail.field}: ${a.detail.from ?? '—'} → ${a.detail.to}`
      : a.kind === 'field-updated' ? `${a.detail.field} updated`
      : a.kind === 'relation-updated' ? `${a.detail.field} changed`
      : a.kind === 'doc-updated' || a.kind === 'doc-appended' ? `${a.detail.field ?? 'Description'} document updated`
      : a.kind;
    actBody.append(el('div', { class: 'activity-item' }, `${new Date(a.ts).toLocaleString()} — ${what}`));
  }
  const actPanel = el('div', { class: 'card panel' },
    el('div', { class: 'card-header' }, el('h3', { class: 'card-title' }, 'Activity')),
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
          location.hash = `#/table/${entity.dbId}`;
          toast('Moved to trash', false, {
            label: 'Undo',
            run: async () => {
              await api('POST', `/entities/${id}/restore`);
              location.hash = `#/entity/${id}`;
              toast('Restored');
            },
          });
        } catch (err) { toast(err.message, true); }
      },
    },
  ], { title: 'Entity actions', extraClass: 'entity-dl-corner' });

  main.append(
    dlBtn,
    el('div', { class: 'crumb crumb-offset' },
      el('a', { href: `#/table/${entity.dbId}` }, entity.db), ' › ',
      el('span', {
        class: 'permalink-copy', title: 'Copy permalink',
        onclick: () => copyText(`${location.origin}${WS_PREFIX}/e/${id}`, 'Permalink copied'),
      }, `#${entity.publicId} ⧉`)),
    el('div', { class: 'entity-head' }, nameInput),
  );

  const grid = el('div', { class: 'entity-grid' });
  main.append(grid);
  const left = el('div');
  const right = el('div');
  grid.append(left, right);

  /* One document panel per document field: rendered doc.html in a navigable
     same-origin frame (mention links work in-frame, with back/refresh). */
  for (const f of documentFields(db)) {
    const fmtBase = `${WS_PREFIX}/e/${id}/doc/${encodeURIComponent(f.name)}`;
    // Same-origin frame: mention links navigate inside it; back/refresh work.
    const frame = el('iframe', { class: 'doc-frame', src: `${fmtBase}.html`, title: `${f.name} document` });
    // Full-size preview: grow the frame to its content on every load
    // (initial, in-frame navigation, refresh) — no inner scrolling.
    frame.addEventListener('load', () => {
      const size = () => {
        const h = frame.contentDocument?.documentElement?.scrollHeight;
        if (h) frame.style.height = Math.max(h + 4, 120) + 'px';
      };
      size();
      setTimeout(size, 350); // after mermaid/diagram render settles
    });
    const editorWrap = el('div', { class: 'hidden' });
    const singleFieldDb = { ...db, fields: [f] }; // editor scoped to this field
    editorWrap.append(docsEditor(entity, singleFieldDb, () => refresh()));
    const editBtn = el('button', {
      class: 'btn btn-sm',
      onclick: () => {
        const editing = !editorWrap.classList.contains('hidden');
        editorWrap.classList.toggle('hidden', editing);
        frame.classList.toggle('hidden', !editing);
        editBtn.textContent = editing ? 'Edit' : 'Preview';
        if (editing) frame.contentWindow?.location.reload(); // show saved edits
      },
    }, 'Edit');
    // View switcher: the frame shows the chosen native format in place.
    const viewBtns = {};
    const setView = (ext) => {
      frame.src = ext === 'view' ? `${fmtBase}.html` : `${fmtBase}.${ext}`;
      for (const [k, b] of Object.entries(viewBtns)) b.classList.toggle('active', k === ext);
    };
    const viewGroup = el('div', { class: 'btn-group' },
      ...[['view', 'View'], ['md', 'MD'], ['mmd', 'MMD'], ['pdf', 'PDF']].map(([ext, label]) => {
        const b = el('button', { class: 'btn btn-sm' + (ext === 'view' ? ' active' : ''), onclick: () => setView(ext) }, label);
        viewBtns[ext] = b;
        return b;
      }));

    const panel = el('div', { class: 'card panel' },
      el('div', { class: 'card-header' },
        el('h3', { class: 'card-title' }, f.name),
        el('div', { class: 'card-actions' },
          el('div', { class: 'btn-group' },
            el('button', { class: 'btn btn-sm', title: 'Back', onclick: () => frame.contentWindow?.history.back() }, '◀'),
            el('button', { class: 'btn btn-sm', title: 'Refresh', onclick: () => frame.contentWindow?.location.reload() }, '⟳')), ' ',
          editBtn, ' ',
          viewGroup)),
      el('div', { class: 'card-body doc-frame-body' }, frame, editorWrap));
    left.append(panel);
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
    fieldsBody.append(el('div', { class: 'fieldrow' },
      el('label', {}, f.name), editorFor(f, entity, db, () => refresh())));
  }
  // The side column reads top-down as metadata about the entity: what it is
  // (Fields), what people said (Comments), what happened (Activity). That
  // leaves the main column to the documents, which are the reason to be here.
  right.append(fieldsPanel, commentsPanel, actPanel); // delete lives in the ⋮ menu
}

/* ---------- create & schema dialogs ---------- */

function quickCreate(db) {
  modal(`New ${db.name}`, [
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
      el('td', {}, f.name),
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
  const typeSel = el('select', { name: 'type', class: 'form-select full', style: 'width:100%' },
    ...['text', 'number', 'date', 'checkbox', 'url', 'email', 'select', 'multiselect', 'workflow', 'document', 'lookup', 'rollup', 'formula']
      .map((t) => el('option', {}, t)));
  const extra = el('div', { class: 'full' });
  const drawExtra = () => {
    const t = typeSel.value;
    extra.replaceChildren();
    if (t === 'select' || t === 'multiselect') {
      extra.append(el('input', { name: 'options', class: 'form-control', placeholder: 'Options (comma-separated)', style: 'width:100%' }));
    } else if (t === 'workflow') {
      extra.append(el('input', { name: 'states', class: 'form-control', placeholder: 'States: Open:not-started, Doing:in-progress, Done:done', style: 'width:100%' }));
    } else if (t === 'lookup' || t === 'rollup') {
      const rels = db.fields.filter((f) => f.type === 'relation');
      extra.append(
        el('select', { name: 'relationField', class: 'form-select', style: 'width:100%' }, ...rels.map((r) => el('option', {}, r.name))),
        el('input', { name: 'targetField', class: 'form-control', placeholder: 'Target field name', style: 'width:100%; margin-top:6px' }));
      if (t === 'rollup') {
        extra.append(el('select', { name: 'aggregate', class: 'form-select', style: 'width:100%; margin-top:6px' },
          ...['count', 'sum', 'avg', 'min', 'max', 'join'].map((a) => el('option', {}, a))));
      }
    } else if (t === 'formula') {
      extra.append(el('input', { name: 'expression', class: 'form-control', placeholder: 'e.g. if(Estimate > 5, "big", "small")', style: 'width:100%' }));
    }
  };
  typeSel.addEventListener('change', drawExtra);
  drawExtra();
  modal('Add field', [
    el('input', { name: 'name', placeholder: 'Field name', class: 'form-control full', style: 'width:100%' }),
    typeSel, extra,
  ], async (fd) => {
    const type = fd.get('type');
    const config = {};
    if (type === 'select' || type === 'multiselect') {
      config.options = String(fd.get('options') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (type === 'workflow') {
      config.states = String(fd.get('states') ?? '').split(',').map((s) => {
        const [name, category] = s.split(':').map((x) => x.trim());
        return { name, category: category ?? 'in-progress' };
      }).filter((s) => s.name);
    } else if (type === 'lookup' || type === 'rollup') {
      config.relationField = fd.get('relationField');
      config.aggregate = fd.get('aggregate') ?? undefined;
      if (fd.get('targetField')) config.targetField = fd.get('targetField');
    } else if (type === 'formula') {
      config.expression = fd.get('expression');
    }
    await api('POST', `/tables/${db.id}/fields`, { name: fd.get('name'), type, config });
    await loadSchema();
    openSchemaEditor(allTables().find((d) => d.id === db.id));
  });
}

function addRelationDialog(db) {
  modal('Add relation', [
    el('input', { name: 'name', placeholder: 'Field name (e.g. Project)', class: 'form-control full', style: 'width:100%' }),
    el('select', { name: 'targetDb', class: 'form-select full', style: 'width:100%' },
      ...allTables().map((d) => el('option', { value: d.id }, d.qualified))),
    el('select', { name: 'cardinality', class: 'form-select full', style: 'width:100%' },
      ...['many-to-one', 'one-to-many', 'many-to-many', 'one-to-one'].map((c) => el('option', {}, c))),
    el('input', { name: 'inverseName', placeholder: 'Inverse field name (optional)', class: 'form-control full', style: 'width:100%' }),
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

/* ---------- home ---------- */

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
      : el('div', { class: 'wv-empty' }, 'Welcome to Weave. Create a space and a table to get started.'));
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

function openCommandK() {
  if ($('#cmdk-back')) return;
  const back = el('div', { id: 'cmdk-back', onclick: (e) => { if (e.target === back) back.remove(); } });
  const input = el('input', { id: 'cmdk-input', placeholder: 'Search workspace, spaces, tables, entities…', autocomplete: 'off' });
  const list = el('div', { id: 'cmdk-results' });
  let hits = [], rowEls = [], sel = 0;
  let timer;
  const pick = (hit) => { back.remove(); navigateToResult(hit); };
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
    else if (e.key === 'Escape') back.remove();
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

function renderRoute() {
  const hash = location.hash || '#/';
  let m;
  if ((m = hash.match(/^#\/trash\/([^/?]+)/))) return showTrash(m[1]);
  if ((m = hash.match(/^#\/(?:table|db)\/([^/?]+)/))) return showDatabase(m[1]);
  if ((m = hash.match(/^#\/space\/([^/?]+)/))) return showSpace(m[1]);
  if (hash.startsWith('#/map')) return showMap();
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
  if (document.querySelector('textarea.doc-inline')) {
    toast('Schema changed elsewhere — close the doc editor and reopen to see new fields');
    return;
  }
  route();
});

// The loader is fetched before the first route so boot's own wait can use it.
initPageLoader();
withPageLoader(() => loadSchema().then(renderRoute));
wireSearchButton();
buildWsRail();
wireWsNew();
wireNavCollapse();
wireThemeToggle();
