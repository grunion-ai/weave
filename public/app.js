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

function toast(msg, isErr = false) {
  const t = el('div', { class: 'toast' + (isErr ? ' err' : '') }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), isErr ? 4200 : 1400);
}

function modal(title, bodyNodes, onSubmit, submitLabel = 'Create') {
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
  const first = form.querySelector('input,select,textarea');
  if (first) first.focus();
}

const state = { schema: [], route: null, expanded: new Set() };

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
function inlineNameInput(placeholder, onCommit) {
  const input = el('input', { class: 'form-control form-control-sm', placeholder });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { input.remove(); renderNav(); }
    if (e.key === 'Enter' && input.value.trim()) {
      try { await onCommit(input.value.trim()); } catch (err) { toast(err.message, true); }
    }
  });
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
      requestAnimationFrame(() => { ta.focus(); ta.style.height = Math.max(60, ta.scrollHeight) + 'px'; });
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
      el('a', { class: 'nav-space', href: `#/space/${space.spaceId}` }, space.space),
      el('button', {
        class: 'nav-caret' + (isFolded ? ' folded' : ''),
        title: isFolded ? `Expand ${space.space}` : `Collapse ${space.space}`, type: 'button',
        onclick: () => {
          if (folded.has(space.spaceId)) folded.delete(space.spaceId);
          else folded.add(space.spaceId);
          localStorage.setItem('weave-folded-spaces', JSON.stringify([...folded]));
          renderNav();
        },
      }, '▾'),
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
function chipPicker({ trigger, options, current, onPick }) {
  trigger.classList.add('chip-trigger');
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelector('.chip-pop')?.remove();
    const pop = el('div', { class: 'chip-pop' },
      ...options.map((o) => el('button', {
        class: 'chip-pop-row', type: 'button',
        onclick: async () => { pop.remove(); if (o.name !== current) await onPick(o.name); },
      },
        el('span', { class: `chip ${o.cls ?? ''}` }, o.name),
        o.name === current ? el('span', { class: 'chip-pop-check' }, '✓') : '')));
    document.body.append(pop);
    const r = trigger.getBoundingClientRect();
    pop.style.left = Math.min(r.left, innerWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = (r.bottom + 4 + pop.offsetHeight > innerHeight ? r.top - pop.offsetHeight - 4 : r.bottom + 4) + 'px';
    const close = (ev) => { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('click', close, true); } };
    addEventListener('click', close, true);
    addEventListener('keydown', function esc(ev) { if (ev.key === 'Escape') { pop.remove(); removeEventListener('keydown', esc); } });
  });
  return trigger;
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

  if (['lookup', 'rollup', 'formula'].includes(f.type)) {
    const box = el('span', { class: 'computed', title: f.type }, fieldValueCell(val) || '—');
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
    return el('span', { class: 'computed', title: 'document' }, text ? text.slice(0, 60).replace(/\n/g, ' ') + (text.length > 60 ? '…' : '') : '—');
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

/* ---------- table views ---------- */

async function showDatabase(dbId, view) {
  const db = allTables().find((d) => d.id === dbId);
  if (!db) return showHome();
  if (state.route?.dbId !== dbId) state.expanded.clear();
  state.route = { page: 'db', dbId, view: view ?? state.route?.view ?? 'table' };
  renderNav();
  const result = await api('POST', `/tables/${db.id}/query`, {});
  drawDatabase(db, result.items);
}

function drawDatabase(db, items) {
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
      drawDatabase(allTables().find((d) => d.id === db.id), items);
    },
    description: db.description,
    onSaveDescription: async (md) => {
      await api('PATCH', `/tables/${db.id}`, { description: md });
      await loadSchema();
    },
    actions: [
      switcher,
      el('button', { class: 'btn btn-sm', onclick: () => openSchemaEditor(db) }, '⚙ Fields'),
      el('a', { class: 'btn btn-sm', href: `${WS_PREFIX}/api/tables/${db.id}/export.csv`, download: `${db.name}.csv` }, 'CSV'),
      // Table view creates inline at the table bottom; other views keep the dialog.
      state.route.view === 'table' ? null
        : el('button', { class: 'btn btn-sm btn-primary', onclick: () => quickCreate(db) }, '+ New'),
    ],
  }));

  const onSaved = async () => {
    const fresh = await api('POST', `/tables/${db.id}/query`, {});
    drawDatabase(db, fresh.items);
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
          if (e.target.closest('input,select,textarea,button,a,label,.ms-box,.chip')) return;
          openEntity(item.id);
        },
      },
        el('td', { class: 'num' },
          el('a', { class: 'open-link', href: `#/entity/${item.id}`, title: 'Open entity page' }, `#${item.publicId} ↗`)),
        ...cols.map((c) => {
          const f = db.fields.find((x) => x.name === c);
          return el('td', { class: f.type === 'number' ? 'num' : '' }, editorFor(f, item, db, onSaved, { compact: true }));
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
          el('td', { colspan: String(cols.length + 2) }, docsEditor(item, db, onSaved))));
      }
    }
    const table = el('table', { class: 'table table-sm table-vcenter card-table table-hover wv-grid' },
      el('thead', {}, el('tr', {},
        el('th', {}, '#'),
        ...cols.map((c) => el('th', {
          onclick: () => { sortDir = sortKey === c ? -sortDir : 1; sortKey = c; draw(); },
        }, c + (sortKey === c ? (sortDir > 0 ? ' ↑' : ' ↓') : ''))),
        el('th', { title: documentFields(db).map((f) => f.name).join(', ') },
          `Docs (${documentFields(db).length})`))),
      tbody);
    wrap.replaceChildren(table);
  };
  draw();
  main.append(wrap);
  // Bottom + New: floats (sticky) when the table outgrows the viewport.
  main.append(el('div', { class: 'add-row-bar' },
    el('button', { class: 'btn btn-sm btn-primary', onclick: () => state.inlineAdd?.() }, `+ New`)));
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
            if (e.target.closest('input,select,textarea,button,a,label,.ms-box,.chip')) return;
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
        if (e.target.closest('input,select,textarea,button,a,label,.ms-box,.chip')) return;
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
      actions: [el('a', { class: 'btn btn-sm', href: '#/map' }, '🗺 Map')],
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
  const dlMenu = el('div', { class: 'dl-menu hidden' },
    ...['md', 'html', 'pdf'].map((ext) =>
      el('a', { class: 'dropdown-item', href: `${entBase}.${ext}`, download: `${(entity.name || 'entity')}.${ext}` }, `Download .${ext}`)),
    el('div', { class: 'dropdown-divider' }),
    el('button', {
      class: 'dropdown-item text-danger',
      onclick: async () => {
        if (!confirm(`Delete “${entity.name || '#' + entity.publicId}”? This cannot be undone.`)) return;
        try {
          await api('DELETE', `/entities/${id}`);
          toast('Deleted');
          await loadSchema();
          location.hash = `#/table/${entity.dbId}`;
        } catch (err) { toast(err.message, true); }
      },
    }, 'Delete entity…'));
  const dlBtn = el('span', { class: 'dl-wrap entity-dl-corner' },
    el('button', { class: 'btn btn-sm btn-ghost-secondary', title: 'Entity actions', onclick: () => dlMenu.classList.toggle('hidden') }, '⋯'),
    dlMenu);

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
  left.append(commentsPanel);
  left.append(actPanel);

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
  right.append(fieldsPanel); // delete lives in the upper-left ⋯ menu

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
      el('td', {}, f.name === 'Name' ? '' : el('button', {
        class: 'btn btn-sm btn-ghost-secondary tiny',
        onclick: async () => {
          if (!confirm(`Delete field ${f.name}?`)) return;
          try {
            await api('DELETE', `/tables/${db.id}/fields/${encodeURIComponent(f.id)}`);
            await loadSchema();
            openSchemaEditor(allTables().find((d) => d.id === db.id));
          } catch (err) { toast(err.message, true); }
        },
      }, '🗑'))))));
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

/* ---------- boot ---------- */

function route() {
  const hash = location.hash || '#/';
  let m;
  if ((m = hash.match(/^#\/(?:table|db)\/([^/?]+)/))) showDatabase(m[1]);
  else if ((m = hash.match(/^#\/space\/([^/?]+)/))) showSpace(m[1]);
  else if (hash.startsWith('#/map')) showMap();
  else if ((m = hash.match(/^#\/entity\/([^/?]+)/))) showEntity(m[1]);
  else showHome();
}

window.addEventListener('hashchange', route);

function newSpaceModal() {
  modal('New space', [el('input', { name: 'name', class: 'form-control', placeholder: 'Space name', style: 'width:100%' })],
    async (fd) => {
      await api('POST', '/spaces', { name: fd.get('name') });
      await loadSchema();
    });
}

// preSpace: pre-select a space (used by the per-space "+" in the sidebar).
function newTableModal(preSpace) {
  modal('New table', [
    el('select', { name: 'space', class: 'form-select', style: 'width:100%' },
      ...state.schema.map((s) => el('option', { selected: s.space === preSpace ? '' : null }, s.space))),
    el('input', { name: 'name', class: 'form-control', placeholder: 'Table name', style: 'width:100%; margin-top:6px' }),
  ], async (fd) => {
    await api('POST', '/tables', { space: fd.get('space'), name: fd.get('name') });
    await loadSchema();
    route();
  });
}

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

loadSchema().then(route);
wireSearchButton();
buildWsRail();
wireWsNew();
wireNavCollapse();
wireThemeToggle();
