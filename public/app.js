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

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
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
      el('button', { type: 'button', onclick: () => back.remove() }, 'Cancel'),
      el('button', { class: 'primary', type: 'submit' }, submitLabel)));
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

function allTables() {
  return state.schema.flatMap((s) => s.tables.map((d) => ({ ...d, space: s.space, spaceId: s.spaceId })));
}

async function loadSchema() {
  state.schema = await api('GET', '/schema');
  renderNav();
}

/* ---------- navigation sidebar ---------- */

function renderNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  nav.append(el('a', {
    class: 'nav-db nav-map' + (state.route?.page === 'map' ? ' active' : ''),
    href: '#/map',
  }, '🗺 Relation map'));
  for (const space of state.schema) {
    nav.append(el('a', { class: 'nav-space', href: `#/space/${space.spaceId}` }, space.space));
    for (const db of space.tables) {
      nav.append(el('a', {
        class: 'nav-db' + (state.route?.dbId === db.id ? ' active' : ''),
        href: `#/table/${db.id}`,
      }, db.name, el('span', { class: 'count' }, String(db.entityCount))));
    }
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

/* ---------- universal field editor ---------- */

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
    if (!compact) box.append(el('span', { class: 'tag' }, f.type));
    return box;
  }
  if (f.type === 'workflow') {
    const sel = el('select', {
      class: `inline-edit state-select state-${stateCategory(f, val)}`,
      onchange: async () => {
        try {
          await api('POST', `/entities/${id}/state`, { field: f.name, state: sel.value });
          await saved();
        } catch (err) { toast(err.message, true); }
      },
    }, ...f.states.map((s) => el('option', { selected: s.name === val ? '' : null }, s.name)));
    return sel;
  }
  if (f.type === 'select') {
    return el('select', {
      class: 'inline-edit',
      onchange: (e) => patch(e.target.value || null),
    }, el('option', { value: '' }, '—'), ...f.options.map((o) => el('option', { selected: o === val ? '' : null }, o)));
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
      const sel = el('select', { class: 'inline-edit ghost-select', onchange: (e) => e.target.value && patch([...current, e.target.value]) },
        el('option', { value: '' }, '+'), ...remaining.map((o) => el('option', {}, o)));
      box.append(sel);
    }
    return box;
  }
  if (f.type === 'checkbox') {
    const cb = el('input', { type: 'checkbox', onchange: () => patch(cb.checked) });
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
      class: 'ghost tiny',
      onclick: async () => {
        const target = allTables().find((d) => d.qualified === f.targetDb || `${d.space}/${d.name}` === f.targetDb);
        const list = await api('POST', `/tables/${target.id}/query`, { select: ['Name'] });
        const linked = new Set(current.map((s) => s.id));
        const options = list.items.filter((i) => !linked.has(i.id));
        if (!options.length) return toast('Nothing left to link');
        modal(`Link ${f.name}`, [
          el('select', { name: 'target', class: 'full', style: 'width:100%' },
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
    class: 'inline-edit',
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
    const tabs = el('div', { class: 'doc-tabs' },
      ...fields.map((f) => el('button', {
        class: 'doc-tab' + (f.name === active ? ' active' : ''),
        onclick: () => { active = f.name; draw(); },
      }, f.name)));
    const area = el('textarea', {
      class: 'doc-inline', spellcheck: 'false',
      dataset: { eid: item.id, field: active },
    });
    area.value = item.docs?.[active] ?? '';
    const fmtBase = `/e/${item.id}/doc/${encodeURIComponent(active)}`;
    wrap.append(
      el('div', { class: 'doc-toolbar' },
        tabs,
        el('span', { style: 'flex:1' }),
        el('a', { class: 'fmt', href: `${fmtBase}.md`, target: '_blank' }, 'MD'),
        el('a', { class: 'fmt', href: `${fmtBase}.html`, target: '_blank' }, 'HTML'),
        el('a', { class: 'fmt', href: `${fmtBase}.pdf`, target: '_blank' }, 'PDF')),
      area,
      el('div', { style: 'margin-top:6px; text-align:right' },
        el('button', {
          class: 'primary',
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

  const switcher = el('div', { class: 'view-switch' },
    ...['table', 'board', 'list'].map((v) =>
      el('button', {
        class: state.route.view === v ? 'active' : '',
        onclick: () => showDatabase(db.id, v),
      }, v[0].toUpperCase() + v.slice(1))));

  main.append(el('div', { class: 'toolbar' },
    el('h1', {}, `${db.space} / ${db.name}`),
    switcher,
    el('button', { onclick: () => openSchemaEditor(db) }, '⚙ Fields'),
    el('a', { href: `/api/tables/${db.id}/export.csv`, download: `${db.name}.csv` }, el('button', {}, 'CSV')),
    el('button', { class: 'primary', onclick: () => quickCreate(db) }, '+ New')));

  if (!items.length) {
    main.append(el('div', { class: 'empty' }, 'No entities yet. Create the first one.'));
    return;
  }

  const onSaved = async () => {
    const fresh = await api('POST', `/tables/${db.id}/query`, {});
    drawDatabase(db, fresh.items);
  };

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
  const wrap = el('div', { class: 'table-wrap' });

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
      const row = el('tr', {},
        el('td', { class: 'num' },
          el('a', { class: 'open-link', href: `#/entity/${item.id}`, title: 'Open entity page' }, `#${item.publicId} ↗`)),
        ...cols.map((c) => {
          const f = db.fields.find((x) => x.name === c);
          return el('td', { class: f.type === 'number' ? 'num' : '' }, editorFor(f, item, db, onSaved, { compact: true }));
        }),
        el('td', {}, el('button', {
          class: 'ghost tiny' + (state.expanded.has(item.id) ? ' active-toggle' : ''),
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
    const table = el('table', { class: 'grid' },
      el('thead', {}, el('tr', {},
        el('th', {}, '#'),
        ...cols.map((c) => el('th', {
          onclick: () => { sortDir = sortKey === c ? -sortDir : 1; sortKey = c; draw(); },
        }, c + (sortKey === c ? (sortDir > 0 ? ' ↑' : ' ↓') : ''))),
        el('th', {}, 'Docs'))),
      tbody);
    wrap.replaceChildren(table);
  };
  draw();
  main.append(wrap);
}

function renderBoard(main, db, items, onSaved) {
  const groupField = db.fields.find((f) => f.type === 'workflow') ?? db.fields.find((f) => f.type === 'select');
  if (!groupField) {
    main.append(el('div', { class: 'empty' }, 'Board view needs a workflow or select field.'));
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
        const card = el('div', { class: 'card' + (expanded ? ' editing' : ''), draggable: 'true', dataset: { id: item.id } },
          el('div', { class: 'card-top' },
            el('a', { class: 'pid', href: `#/entity/${item.id}`, title: 'Open entity page' }, `#${item.publicId} ↗`),
            el('span', { style: 'flex:1' }),
            el('button', {
              class: 'ghost tiny' + (expanded ? ' active-toggle' : ''),
              title: 'Edit fields & documents',
              onclick: (e) => {
                e.stopPropagation();
                if (expanded) state.expanded.delete(item.id);
                else state.expanded.add(item.id);
                redraw();
              },
            }, expanded ? '✕' : '✎')),
          nameInput);
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
  main.append(board);
}

function renderListView(main, db, items, onSaved) {
  const wf = db.fields.find((f) => f.type === 'workflow');
  const rows = el('div', { class: 'list-rows' });
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
    rows.append(el('div', { class: 'list-row' },
      el('a', { class: 'pid', href: `#/entity/${item.id}`, title: 'Open entity page' }, `#${item.publicId} ↗`),
      nameInput,
      el('span', { class: 'spacer' }),
      wf ? editorFor(wf, item, db, onSaved, { compact: true }) : null,
      el('button', {
        class: 'ghost tiny' + (expanded ? ' active-toggle' : ''),
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
    el('div', { class: 'toolbar' },
      el('h1', {}, space.space),
      el('a', { href: '#/map' }, el('button', {}, '🗺 Map'))),
    el('div', { class: 'list-rows' }, ...space.tables.map((d) =>
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
  main.replaceChildren(el('div', { class: 'toolbar' }, el('h1', {}, 'Relation map')));

  const [schema, automations] = await Promise.all([api('GET', '/schema'), api('GET', '/automations')]);
  const tables = schema.flatMap((s) => s.tables.map((t) => ({ ...t, space: s.space })));
  if (!tables.length) {
    main.append(el('div', { class: 'empty' }, 'No tables yet.'));
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

  main.append(
    el('div', { class: 'crumb' },
      el('a', { href: `#/table/${entity.dbId}` }, entity.db), ` › #${entity.publicId}`),
    el('div', { class: 'entity-head' }, nameInput),
  );

  const grid = el('div', { class: 'entity-grid' });
  main.append(grid);
  const left = el('div');
  const right = el('div');
  grid.append(left, right);

  /* One document panel per document field: rendered preview + flip to edit. */
  for (const f of documentFields(db)) {
    const panel = el('div', { class: 'panel' }, el('h2', {}, f.name));
    const preview = el('div', { class: 'doc-preview' });
    const editorWrap = el('div', { class: 'hidden' });
    const singleFieldDb = { ...db, fields: [f] }; // editor scoped to this field
    editorWrap.append(docsEditor(entity, singleFieldDb, () => refresh()));
    const fmtBase = `/e/${id}/doc/${encodeURIComponent(f.name)}`;
    const editBtn = el('button', {
      onclick: () => {
        const editing = !editorWrap.classList.contains('hidden');
        editorWrap.classList.toggle('hidden', editing);
        preview.classList.toggle('hidden', !editing);
        editBtn.textContent = editing ? 'Edit' : 'Preview';
      },
    }, 'Edit');
    panel.append(
      el('div', { class: 'doc-toolbar' },
        editBtn,
        el('span', { style: 'flex:1' }),
        el('a', { class: 'fmt', href: `${fmtBase}.md`, target: '_blank' }, 'MD'),
        el('a', { class: 'fmt', href: `${fmtBase}.html`, target: '_blank' }, 'HTML'),
        el('a', { class: 'fmt', href: `${fmtBase}.pdf`, target: '_blank' }, 'PDF')),
      preview, editorWrap);
    fetch(`${fmtBase}.html`).then((r) => r.text()).then((html) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const body = doc.body;
      body.querySelector('.doc-meta')?.remove();
      preview.innerHTML = body.innerHTML || '<p style="color:var(--muted)">Empty — click Edit.</p>';
    });
    left.append(panel);
  }

  /* Comments panel */
  const commentsPanel = el('div', { class: 'panel' }, el('h2', {}, `Comments (${entity.comments.length})`));
  for (const c of entity.comments) {
    commentsPanel.append(el('div', { class: 'comment' },
      el('div', {}, el('span', { class: 'who' }, c.author), el('span', { class: 'when' }, new Date(c.createdAt).toLocaleString())),
      el('div', {}, c.text)));
  }
  const commentInput = el('input', { placeholder: 'Add a comment…', style: 'width:100%' });
  commentInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && commentInput.value.trim()) {
      try {
        await api('POST', `/entities/${id}/comments`, { author: 'me', text: commentInput.value.trim() });
        refresh();
      } catch (err) { toast(err.message, true); }
    }
  });
  commentsPanel.append(el('div', { style: 'margin-top:8px' }, commentInput));
  left.append(commentsPanel);

  /* Fields panel */
  const fieldsPanel = el('div', { class: 'panel' }, el('h2', {}, 'Fields'));
  for (const f of db.fields) {
    if (f.name === 'Name' || f.type === 'document') continue;
    fieldsPanel.append(el('div', { class: 'fieldrow' },
      el('label', {}, f.name), editorFor(f, entity, db, () => refresh())));
  }
  fieldsPanel.append(el('div', { style: 'margin-top:10px; display:flex; gap:8px' },
    el('button', {
      onclick: async () => {
        if (!confirm(`Delete “${entity.name}”?`)) return;
        await api('DELETE', `/entities/${id}`);
        toast('Deleted');
        location.hash = `#/table/${entity.dbId}`;
      },
    }, 'Delete entity')));
  right.append(fieldsPanel);

  /* Activity */
  const act = el('div', { class: 'panel' }, el('h2', {}, 'Activity'));
  for (const a of [...entity.activity].reverse().slice(0, 12)) {
    const what = a.kind === 'state-changed' ? `${a.detail.field}: ${a.detail.from ?? '—'} → ${a.detail.to}`
      : a.kind === 'field-updated' ? `${a.detail.field} updated`
      : a.kind === 'relation-updated' ? `${a.detail.field} changed`
      : a.kind === 'doc-updated' || a.kind === 'doc-appended' ? `${a.detail.field ?? 'Description'} document updated`
      : a.kind;
    act.append(el('div', { class: 'activity-item' }, `${new Date(a.ts).toLocaleString()} — ${what}`));
  }
  right.append(act);
}

/* ---------- create & schema dialogs ---------- */

function quickCreate(db) {
  modal(`New ${db.name}`, [
    el('input', { name: 'name', placeholder: 'Name', class: 'full', style: 'width:100%' }),
  ], async (fd) => {
    const e = await api('POST', `/tables/${db.id}/entities`, { name: fd.get('name') });
    await loadSchema();
    location.hash = `#/entity/${e.id}`;
  });
}

function openSchemaEditor(db) {
  const main = $('#main');
  main.replaceChildren(
    el('div', { class: 'toolbar' },
      el('h1', {}, `${db.space} / ${db.name} — fields`),
      el('button', { onclick: () => showDatabase(db.id) }, '← Back')),
  );
  const panel = el('div', { class: 'panel' });
  const table = el('table', { class: 'schema-table' },
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
        class: 'ghost',
        onclick: async () => {
          if (!confirm(`Delete field ${f.name}?`)) return;
          try {
            await api('DELETE', `/tables/${db.id}/fields/${encodeURIComponent(f.id)}`);
            await loadSchema();
            openSchemaEditor(allTables().find((d) => d.id === db.id));
          } catch (err) { toast(err.message, true); }
        },
      }, '🗑'))))));
  panel.append(table,
    el('div', { style: 'margin-top:12px; display:flex; gap:8px' },
      el('button', { onclick: () => addFieldDialog(db) }, '+ Field'),
      el('button', { onclick: () => addRelationDialog(db) }, '+ Relation')));
  main.append(panel);
}

function addFieldDialog(db) {
  const typeSel = el('select', { name: 'type', class: 'full', style: 'width:100%' },
    ...['text', 'number', 'date', 'checkbox', 'url', 'email', 'select', 'multiselect', 'workflow', 'document', 'lookup', 'rollup', 'formula']
      .map((t) => el('option', {}, t)));
  const extra = el('div', { class: 'full' });
  const drawExtra = () => {
    const t = typeSel.value;
    extra.replaceChildren();
    if (t === 'select' || t === 'multiselect') {
      extra.append(el('input', { name: 'options', placeholder: 'Options (comma-separated)', style: 'width:100%' }));
    } else if (t === 'workflow') {
      extra.append(el('input', { name: 'states', placeholder: 'States: Open:not-started, Doing:in-progress, Done:done', style: 'width:100%' }));
    } else if (t === 'lookup' || t === 'rollup') {
      const rels = db.fields.filter((f) => f.type === 'relation');
      extra.append(
        el('select', { name: 'relationField', style: 'width:100%' }, ...rels.map((r) => el('option', {}, r.name))),
        el('input', { name: 'targetField', placeholder: 'Target field name', style: 'width:100%; margin-top:6px' }));
      if (t === 'rollup') {
        extra.append(el('select', { name: 'aggregate', style: 'width:100%; margin-top:6px' },
          ...['count', 'sum', 'avg', 'min', 'max', 'join'].map((a) => el('option', {}, a))));
      }
    } else if (t === 'formula') {
      extra.append(el('input', { name: 'expression', placeholder: 'e.g. if(Estimate > 5, "big", "small")', style: 'width:100%' }));
    }
  };
  typeSel.addEventListener('change', drawExtra);
  drawExtra();
  modal('Add field', [
    el('input', { name: 'name', placeholder: 'Field name', class: 'full', style: 'width:100%' }),
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
    el('input', { name: 'name', placeholder: 'Field name (e.g. Project)', class: 'full', style: 'width:100%' }),
    el('select', { name: 'targetDb', class: 'full', style: 'width:100%' },
      ...allTables().map((d) => el('option', { value: d.id }, d.qualified))),
    el('select', { name: 'cardinality', class: 'full', style: 'width:100%' },
      ...['many-to-one', 'one-to-many', 'many-to-many', 'one-to-one'].map((c) => el('option', {}, c))),
    el('input', { name: 'inverseName', placeholder: 'Inverse field name (optional)', class: 'full', style: 'width:100%' }),
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

function showHome() {
  state.route = { page: 'home' };
  renderNav();
  const main = $('#main');
  const dbs = allTables();
  main.replaceChildren(
    el('div', { class: 'toolbar' }, el('h1', {}, 'Weave'),
      el('span', { class: 'kbd-hint' }, '⌘K to search everything')),
    dbs.length
      ? el('div', { class: 'list-rows' }, ...dbs.map((d) =>
        el('div', { class: 'list-row', onclick: () => { location.hash = `#/table/${d.id}`; } },
          el('span', {}, d.qualified), el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, `${d.entityCount} entities`))))
      : el('div', { class: 'empty' }, 'Welcome to Weave. Create a space and a table to get started.'));
}

/* ---------- universal search (sidebar + ⌘K palette) ---------- */

const KIND_ICON = { workspace: '🕸', space: '▣', table: '▦', entity: '●' };

function navigateToResult(hit) {
  if (hit.kind === 'entity') location.hash = `#/entity/${hit.id}`;
  else if (hit.kind === 'table') location.hash = `#/table/${hit.id}`;
  else if (hit.kind === 'space') location.hash = `#/space/${hit.id}`;
  else location.hash = '#/';
}

function resultRow(hit, onPick) {
  const permalink = location.origin + hit.url;
  return el('div', { class: 'result', onclick: () => onPick(hit) },
    el('div', { class: 'result-main' },
      el('span', { class: 'kind-badge' }, `${KIND_ICON[hit.kind] ?? ''} ${hit.kind}`),
      el('span', {}, hit.kind === 'entity' ? `${hit.db} #${hit.publicId} — ${hit.name}` : hit.name),
      el('button', {
        class: 'ghost tiny copy-btn', title: 'Copy permalink',
        onclick: (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(permalink).then(() => toast('Permalink copied'));
        },
      }, '⧉')),
    el('div', { class: 'snip mono' }, permalink),
    hit.snippet ? el('div', { class: 'snip' }, hit.snippet) : null);
}

function wireSearch() {
  const input = $('#search');
  const results = $('#search-results');
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { results.classList.add('hidden'); return; }
      const hits = await api('GET', `/search?q=${encodeURIComponent(q)}`);
      results.replaceChildren(...(hits.length
        ? hits.map((h) => resultRow(h, (hit) => {
          results.classList.add('hidden');
          input.value = '';
          navigateToResult(hit);
        }))
        : [el('div', { class: 'result' }, 'No results')]));
      results.classList.remove('hidden');
    }, 200);
  });
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) results.classList.add('hidden');
  });
}

function openCommandK() {
  if ($('#cmdk-back')) return;
  const back = el('div', { id: 'cmdk-back', onclick: (e) => { if (e.target === back) back.remove(); } });
  const input = el('input', { id: 'cmdk-input', placeholder: 'Search workspace, spaces, tables, entities…', autocomplete: 'off' });
  const list = el('div', { id: 'cmdk-results' });
  let hits = [];
  let timer;
  const pick = (hit) => { back.remove(); navigateToResult(hit); };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { list.replaceChildren(); return; }
      hits = await api('GET', `/search?q=${encodeURIComponent(q)}`);
      list.replaceChildren(...(hits.length
        ? hits.map((h) => resultRow(h, pick))
        : [el('div', { class: 'result' }, 'No results')]));
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && hits.length) pick(hits[0]);
    if (e.key === 'Escape') back.remove();
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

$('#add-space').addEventListener('click', () => {
  modal('New space', [el('input', { name: 'name', placeholder: 'Space name', style: 'width:100%' })],
    async (fd) => {
      await api('POST', '/spaces', { name: fd.get('name') });
      await loadSchema();
    });
});
$('#add-db').addEventListener('click', () => {
  modal('New table', [
    el('select', { name: 'space', style: 'width:100%' }, ...state.schema.map((s) => el('option', {}, s.space))),
    el('input', { name: 'name', placeholder: 'Table name', style: 'width:100%; margin-top:6px' }),
  ], async (fd) => {
    await api('POST', '/tables', { space: fd.get('space'), name: fd.get('name') });
    await loadSchema();
    route();
  });
});

loadSchema().then(route);
wireSearch();
