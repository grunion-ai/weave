/* Weave web UI — vanilla JS SPA over the REST API. */
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
  setTimeout(() => t.remove(), isErr ? 4200 : 1800);
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

const state = { schema: [], route: null };

function allDatabases() {
  return state.schema.flatMap((s) => s.databases.map((d) => ({ ...d, space: s.space })));
}

async function loadSchema() {
  state.schema = await api('GET', '/schema');
  renderNav();
}

/* ---------- navigation sidebar ---------- */

function renderNav() {
  const nav = $('#nav');
  nav.replaceChildren();
  for (const space of state.schema) {
    nav.append(el('div', { class: 'nav-space' }, space.space));
    for (const db of space.databases) {
      nav.append(el('a', {
        class: 'nav-db' + (state.route?.dbId === db.id ? ' active' : ''),
        href: `#/db/${db.id}`,
      }, db.name, el('span', { class: 'count' }, String(db.entityCount))));
    }
  }
}

/* ---------- views ---------- */

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

function stateChip(dbSchema, entity) {
  const wf = dbSchema.fields.find((f) => f.type === 'workflow');
  if (!wf) return null;
  const name = entity.fields?.[wf.name] ?? entity[wf.name];
  if (!name) return null;
  const st = wf.states.find((s) => s.name === name);
  return el('span', { class: `chip state-${st?.category ?? 'not-started'}` }, name);
}

async function showDatabase(dbId, view) {
  const db = allDatabases().find((d) => d.id === dbId);
  if (!db) return showHome();
  state.route = { page: 'db', dbId, view: view ?? state.route?.view ?? 'table' };
  renderNav();
  const result = await api('POST', `/databases/${db.id}/query`, {});
  const main = $('#main');
  main.replaceChildren();

  const switcher = el('div', { class: 'view-switch' },
    ...['table', 'board', 'list'].map((v) =>
      el('button', {
        class: state.route.view === v ? 'active' : '',
        onclick: () => showDatabase(dbId, v),
      }, v[0].toUpperCase() + v.slice(1))));

  main.append(el('div', { class: 'toolbar' },
    el('h1', {}, `${db.space} / ${db.name}`),
    switcher,
    el('button', { onclick: () => openSchemaEditor(db) }, '⚙ Fields'),
    el('a', { href: `/api/databases/${db.id}/export.csv`, download: `${db.name}.csv` }, el('button', {}, 'CSV')),
    el('button', { class: 'primary', onclick: () => quickCreate(db) }, '+ New')));

  if (!result.items.length) {
    main.append(el('div', { class: 'empty' }, 'No entities yet. Create the first one.'));
    return;
  }
  if (state.route.view === 'table') renderTable(main, db, result.items);
  else if (state.route.view === 'board') renderBoard(main, db, result.items);
  else renderListView(main, db, result.items);
}

function renderTable(main, db, items) {
  const cols = db.fields.map((f) => f.name);
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
    const table = el('table', { class: 'grid' },
      el('thead', {}, el('tr', {},
        el('th', {}, '#'),
        ...cols.map((c) => el('th', {
          onclick: () => { sortDir = sortKey === c ? -sortDir : 1; sortKey = c; draw(); },
        }, c + (sortKey === c ? (sortDir > 0 ? ' ↑' : ' ↓') : ''))))),
      el('tbody', {}, ...sorted.map((item) =>
        el('tr', { onclick: () => { location.hash = `#/entity/${item.id}`; } },
          el('td', { class: 'num' }, String(item.publicId)),
          ...cols.map((c) => {
            const f = db.fields.find((x) => x.name === c);
            const v = item.fields[c];
            const td = el('td', { class: typeof v === 'number' ? 'num' : '' });
            if (f.type === 'workflow' && v) {
              const st = f.states.find((s) => s.name === v);
              td.append(el('span', { class: `chip state-${st?.category ?? 'not-started'}` }, v));
            } else td.textContent = fieldValueCell(v);
            return td;
          })))));
    wrap.replaceChildren(table);
  };
  draw();
  main.append(wrap);
}

function renderBoard(main, db, items) {
  const groupField = db.fields.find((f) => f.type === 'workflow') ?? db.fields.find((f) => f.type === 'select');
  if (!groupField) {
    main.append(el('div', { class: 'empty' }, 'Board view needs a workflow or select field.'));
    return;
  }
  const groups = groupField.type === 'workflow' ? groupField.states.map((s) => s.name) : groupField.options;
  const board = el('div', { class: 'board' });
  for (const group of groups) {
    const inGroup = items.filter((i) => i.fields[groupField.name] === group);
    const col = el('div', { class: 'board-col', dataset: { group } },
      el('h3', {}, group, el('span', {}, String(inGroup.length))),
      ...inGroup.map((item) => {
        const card = el('div', { class: 'card', draggable: 'true', dataset: { id: item.id } },
          el('div', { class: 'pid' }, `#${item.publicId}`),
          el('div', {}, item.name || '(unnamed)'),
        );
        card.addEventListener('click', () => { location.hash = `#/entity/${item.id}`; });
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
        showDatabase(db.id, 'board');
      } catch (err) { toast(err.message, true); }
    });
    board.append(col);
  }
  main.append(board);
}

function renderListView(main, db, items) {
  main.append(el('div', { class: 'list-rows' }, ...items.map((item) =>
    el('div', { class: 'list-row', onclick: () => { location.hash = `#/entity/${item.id}`; } },
      el('span', { class: 'pid' }, `#${item.publicId}`),
      el('span', {}, item.name || '(unnamed)'),
      el('span', { class: 'spacer' }),
      stateChip(db, item)))));
}

/* ---------- entity page ---------- */

async function showEntity(id) {
  let entity;
  try {
    entity = await api('GET', `/entities/${id}`);
  } catch {
    return showHome();
  }
  const db = allDatabases().find((d) => d.id === entity.dbId);
  state.route = { page: 'entity', id, dbId: entity.dbId };
  renderNav();
  const main = $('#main');
  main.replaceChildren();

  const nameInput = el('input', { class: 'name-edit', value: entity.name });
  nameInput.addEventListener('change', async () => {
    try { await api('PATCH', `/entities/${id}`, { values: { Name: nameInput.value } }); toast('Renamed'); }
    catch (err) { toast(err.message, true); }
  });

  main.append(
    el('div', { class: 'crumb' },
      el('a', { href: `#/db/${entity.dbId}` }, entity.db), ` › #${entity.publicId}`),
    el('div', { class: 'entity-head' }, nameInput),
  );

  const grid = el('div', { class: 'entity-grid' });
  main.append(grid);
  const left = el('div');
  const right = el('div');
  grid.append(left, right);

  /* Document panel */
  const docPanel = el('div', { class: 'panel' }, el('h2', {}, 'Document'));
  const preview = el('div', { id: 'doc-preview' });
  const editArea = el('textarea', { id: 'doc-edit', class: 'hidden' });
  editArea.value = entity.doc ?? '';
  const editBtn = el('button', {
    onclick: async () => {
      if (editArea.classList.contains('hidden')) {
        editArea.classList.remove('hidden');
        preview.classList.add('hidden');
        editBtn.textContent = 'Save';
        editBtn.classList.add('primary');
      } else {
        try {
          await api('PUT', `/entities/${id}/doc`, { doc: editArea.value });
          toast('Document saved');
          showEntity(id);
        } catch (err) { toast(err.message, true); }
      }
    },
  }, 'Edit');
  docPanel.append(
    el('div', { class: 'doc-toolbar' },
      editBtn,
      el('span', { style: 'flex:1' }),
      el('a', { class: 'fmt', href: `/e/${id}/doc.md`, target: '_blank' }, 'MD'),
      el('a', { class: 'fmt', href: `/e/${id}/doc.html`, target: '_blank' }, 'HTML'),
      el('a', { class: 'fmt', href: `/e/${id}/doc.pdf`, target: '_blank' }, 'PDF')),
    preview, editArea);
  // Server-rendered preview keeps one markdown implementation.
  fetch(`/e/${id}/doc.html`).then((r) => r.text()).then((html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body;
    body.querySelector('.doc-meta')?.remove();
    preview.innerHTML = body.innerHTML || '<p style="color:var(--muted)">Empty document — click Edit.</p>';
  });
  left.append(docPanel);

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
        showEntity(id);
      } catch (err) { toast(err.message, true); }
    }
  });
  commentsPanel.append(el('div', { style: 'margin-top:8px' }, commentInput));
  left.append(commentsPanel);

  /* Fields panel */
  const fieldsPanel = el('div', { class: 'panel' }, el('h2', {}, 'Fields'));
  for (const f of db.fields) {
    if (f.name === 'Name') continue;
    const row = el('div', { class: 'fieldrow' }, el('label', {}, f.name));
    row.append(fieldEditor(f, entity, db));
    fieldsPanel.append(row);
  }
  fieldsPanel.append(el('div', { style: 'margin-top:10px; display:flex; gap:8px' },
    el('button', {
      onclick: async () => {
        if (!confirm(`Delete “${entity.name}”?`)) return;
        await api('DELETE', `/entities/${id}`);
        toast('Deleted');
        location.hash = `#/db/${entity.dbId}`;
      },
    }, 'Delete entity')));
  right.append(fieldsPanel);

  /* Activity */
  const act = el('div', { class: 'panel' }, el('h2', {}, 'Activity'));
  for (const a of [...entity.activity].reverse().slice(0, 12)) {
    const what = a.kind === 'state-changed' ? `${a.detail.field}: ${a.detail.from ?? '—'} → ${a.detail.to}`
      : a.kind === 'field-updated' ? `${a.detail.field} updated`
      : a.kind === 'relation-updated' ? `${a.detail.field} changed`
      : a.kind;
    act.append(el('div', { class: 'activity-item' }, `${new Date(a.ts).toLocaleString()} — ${what}`));
  }
  right.append(act);
}

function fieldEditor(f, entity, db) {
  const id = entity.id;
  const val = entity.fields[f.name];
  const patch = async (value) => {
    try {
      await api('PATCH', `/entities/${id}`, { values: { [f.name]: value } });
      toast('Saved');
      showEntity(id);
    } catch (err) { toast(err.message, true); }
  };

  if (['lookup', 'rollup', 'formula'].includes(f.type)) {
    return el('div', { class: 'computed' }, fieldValueCell(val) || '—', el('span', { class: 'tag' }, f.type));
  }
  if (f.type === 'workflow') {
    const sel = el('select', { onchange: () => api('POST', `/entities/${id}/state`, { field: f.name, state: sel.value }).then(() => showEntity(id)).catch((e) => toast(e.message, true)) },
      ...f.states.map((s) => el('option', { selected: s.name === val ? '' : null }, s.name)));
    return sel;
  }
  if (f.type === 'select') {
    const sel = el('select', { onchange: () => patch(sel.value || null) },
      el('option', { value: '' }, '—'),
      ...f.options.map((o) => el('option', { selected: o === val ? '' : null }, o)));
    return sel;
  }
  if (f.type === 'multiselect') {
    const box = el('div');
    const current = Array.isArray(val) ? val : [];
    for (const v of current) {
      box.append(el('span', { class: 'chip' }, v, el('span', {
        class: 'x', onclick: () => patch(current.filter((x) => x !== v)),
      }, '×')), ' ');
    }
    const remaining = f.options.filter((o) => !current.includes(o));
    if (remaining.length) {
      const sel = el('select', { onchange: () => sel.value && patch([...current, sel.value]) },
        el('option', { value: '' }, '+ add'), ...remaining.map((o) => el('option', {}, o)));
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
    const box = el('div');
    const current = val == null ? [] : Array.isArray(val) ? val : [val];
    for (const s of current) {
      box.append(el('span', { class: 'chip rel' },
        el('span', { onclick: () => { location.hash = `#/entity/${s.id}`; } }, s.name || `#${s.publicId}`),
        el('span', { class: 'x', onclick: async () => { await api('POST', `/entities/${id}/unlink`, { field: f.name, targets: [s.id] }); showEntity(id); } }, '×')), ' ');
    }
    const addBtn = el('button', { class: 'ghost' }, '+ link');
    addBtn.addEventListener('click', async () => {
      const target = allDatabases().find((d) => d.qualified === f.targetDb || `${d.space}/${d.name}` === f.targetDb);
      const list = await api('POST', `/databases/${target.id}/query`, { select: ['Name'] });
      const linked = new Set(current.map((s) => s.id));
      const options = list.items.filter((i) => !linked.has(i.id));
      modal(`Link ${f.name}`, [
        el('select', { name: 'target', class: 'full', style: 'width:100%' },
          ...options.map((o) => el('option', { value: o.id }, `#${o.publicId} ${o.name}`))),
      ], async (fd) => {
        await api('POST', `/entities/${id}/link`, { field: f.name, targets: [fd.get('target')] });
        showEntity(id);
      }, 'Link');
    });
    box.append(addBtn);
    return box;
  }
  // text / number / date / url / email
  const input = el('input', {
    type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text',
    value: val ?? '',
  });
  input.addEventListener('change', () => patch(input.value === '' ? null : f.type === 'number' ? Number(input.value) : input.value));
  return input;
}

/* ---------- create & schema dialogs ---------- */

function quickCreate(db) {
  modal(`New ${db.name}`, [
    el('input', { name: 'name', placeholder: 'Name', class: 'full', style: 'width:100%' }),
  ], async (fd) => {
    const e = await api('POST', `/databases/${db.id}/entities`, { name: fd.get('name') });
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
            await api('DELETE', `/databases/${db.id}/fields/${encodeURIComponent(f.id)}`);
            await loadSchema();
            openSchemaEditor(allDatabases().find((d) => d.id === db.id));
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
    ...['text', 'number', 'date', 'checkbox', 'url', 'email', 'select', 'multiselect', 'workflow', 'lookup', 'rollup', 'formula']
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
    await api('POST', `/databases/${db.id}/fields`, { name: fd.get('name'), type, config });
    await loadSchema();
    openSchemaEditor(allDatabases().find((d) => d.id === db.id));
  });
}

function addRelationDialog(db) {
  modal('Add relation', [
    el('input', { name: 'name', placeholder: 'Field name (e.g. Project)', class: 'full', style: 'width:100%' }),
    el('select', { name: 'targetDb', class: 'full', style: 'width:100%' },
      ...allDatabases().map((d) => el('option', { value: d.id }, d.qualified))),
    el('select', { name: 'cardinality', class: 'full', style: 'width:100%' },
      ...['many-to-one', 'one-to-many', 'many-to-many', 'one-to-one'].map((c) => el('option', {}, c))),
    el('input', { name: 'inverseName', placeholder: 'Inverse field name (optional)', class: 'full', style: 'width:100%' }),
  ], async (fd) => {
    await api('POST', `/databases/${db.id}/relations`, {
      name: fd.get('name'),
      targetDb: fd.get('targetDb'),
      cardinality: fd.get('cardinality'),
      inverseName: fd.get('inverseName') || undefined,
    });
    await loadSchema();
    openSchemaEditor(allDatabases().find((d) => d.id === db.id));
  });
}

/* ---------- home & search ---------- */

function showHome() {
  state.route = { page: 'home' };
  renderNav();
  const main = $('#main');
  const dbs = allDatabases();
  main.replaceChildren(
    el('div', { class: 'toolbar' }, el('h1', {}, 'Weave')),
    dbs.length
      ? el('div', { class: 'list-rows' }, ...dbs.map((d) =>
        el('div', { class: 'list-row', onclick: () => { location.hash = `#/db/${d.id}`; } },
          el('span', {}, d.qualified), el('span', { class: 'spacer' }),
          el('span', { class: 'pid' }, `${d.entityCount} entities`))))
      : el('div', { class: 'empty' }, 'Welcome to Weave. Create a space and a database to get started.'));
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
      results.replaceChildren(...(hits.length ? hits.map((h) =>
        el('div', { class: 'result', onclick: () => { results.classList.add('hidden'); input.value = ''; location.hash = `#/entity/${h.id}`; } },
          el('div', {}, `${h.db} #${h.publicId} — ${h.name}`),
          h.snippet ? el('div', { class: 'snip' }, h.snippet) : null))
        : [el('div', { class: 'result' }, 'No results')]));
      results.classList.remove('hidden');
    }, 200);
  });
  document.addEventListener('click', (e) => {
    if (!results.contains(e.target) && e.target !== input) results.classList.add('hidden');
  });
}

/* ---------- boot ---------- */

function route() {
  const hash = location.hash || '#/';
  let m;
  if ((m = hash.match(/^#\/db\/([^/?]+)/))) showDatabase(m[1]);
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
  modal('New database', [
    el('select', { name: 'space', style: 'width:100%' }, ...state.schema.map((s) => el('option', {}, s.space))),
    el('input', { name: 'name', placeholder: 'Database name', style: 'width:100%; margin-top:6px' }),
  ], async (fd) => {
    await api('POST', '/databases', { space: fd.get('space'), name: fd.get('name') });
    await loadSchema();
    route();
  });
});

loadSchema().then(route);
wireSearch();
