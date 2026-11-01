'use strict';

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
    anchor, title: 'Icon',
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
    anchor: face, title: 'Term',
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
    el('div', { class: 'term-row term-plural-row' }, el('span', { class: 'wv-tag' }, 'plural'), plur),
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
        anchor: face, title: 'Default', options: opts,
        multi: { selected: opts.filter((o) => list.find((x) => x.id === o.id).default), onCommit: set },
      });
    } else {
      searchPicker({
        anchor: face, title: 'Default',
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

function fieldDialog(db, existing, after, { pickTables = null } = {}) {
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
  const DESC_HINT = 'What this field holds and how it is written — shown under the label and to agents in the schema';
  const descInput = el('textarea', {
    name: 'description', class: 'form-control field-desc', rows: '2',
    placeholder: DESC_HINT, title: DESC_HINT,
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
          if (existing.subtable) kids.push(dsection('Subtable', el('pre', { class: 'subtable-config' }, JSON.stringify({ subtable: existing.subtable }, null, 2))));
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
            const autoName = WeaveTerm.inverseName(db.name, db.term, ['many-to-one', 'many-to-many'].includes(r.cardinality ?? 'many-to-one'));
            kids.push(dsection('Inverse field on the target', el('input', { class: 'form-control', value: r.inverseName ?? '', placeholder: `${autoName} (created automatically — rename here)`, oninput: (e) => { r.inverseName = e.target.value; changed(); } })));
          }
        }
      } else if (t === 'view') {
        kids.push(...viewSection(db, state, changed, drawCfg));
      } else if (t === 'avatar') {
        kids.push(dsection('Shape', segCtl([
          { id: 'round', label: 'round', title: 'People and agents' },
          { id: 'square', label: 'square', title: 'Organisations and logos' },
        ], state.avatarShape ?? 'round', (v) => { state.avatarShape = v; changed(); })));
        kids.push(el('div', { class: 'modal-note full' }, 'The row\'s face on its chip, card and header. With no photo it shows initials on the name\'s colour. One per table.'));
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
        const throughRelation = () => {
          const out = [];
          const rels = db.fields.filter((x) => x.type === 'relation');
          const relLabel = (r) => `${r.name} → ${r.targetDb}`;
          state.relationField = state.relationField || (rels[0]?.name ?? '');
          const rel = rels.find((r) => r.name === state.relationField);
          const relSel = pickerSelect({ name: 'relationField', options: rels.map((r) => ({ id: r.name, label: relLabel(r) })), value: state.relationField || null });
          relSel.input.addEventListener('change', () => { state.relationField = relSel.input.value; state.targetField = ''; drawCfg(); changed(); });
          out.push(dsection('Relation', rels.length ? relSel : el('div', { class: 'modal-note' }, 'This table has no relations yet — add one first')));
          const target = rel && allTables().find((d) => d.id === rel.targetDbId);
          const targets = (target?.fields ?? []).filter((x) => x.type !== 'document');
          if ((t === 'lookup' || (state.aggregate ?? 'count') !== 'count') && target) {
            const tSel = pickerSelect({ name: 'targetField', placeholder: `Field of ${target.name}…`, options: targets.map((x) => ({ id: x.name, label: `${x.name} · ${x.type}` })), value: state.targetField || null });
            tSel.input.addEventListener('change', () => { state.targetField = tSel.input.value; if (isEdit) drawCfg(); changed(); });
            out.push(dsection('Target field', tSel));
          }
          if (t === 'rollup') {
            out.push(dsection('Aggregate', segCtl(fdc.AGGREGATES, state.aggregate ?? 'count', (v) => { state.aggregate = v; drawCfg(); changed(); })));
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
            kids.push(el('div', { class: 'modal-note full' }, 'A space rollup is set from the grid’s Σ row, so its recipe is read-only here.'));
          } else {
            kids.push(...throughRelation());
            const resultOf = (via, targetField, aggregate) => {
              const rel = db.fields.find((x) => x.type === 'relation' && x.name === via);
              const far = rel && allTables().find((d) => d.id === rel.targetDbId);
              return fdc.recipeResult(t, aggregate ?? 'count', far?.fields.find((x) => x.name === targetField)?.type ?? null);
            };
            const note = fdc.recipeChangeNote(existing.name, resultOf(existing.via, existing.targetField, existing.aggregate),
              resultOf(state.relationField, state.targetField, state.aggregate));
            if (note) kids.push(el('div', { class: 'modal-note full recipe-warn' }, iconEl('lucide:triangle-alert', 'wv-icon wv-icon-xs'), ' ', note));
          }
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
            value: state.default, title: 'Default', costume: fdc.dateCostume(state.date, t), compact: false,
            onChange: (iso) => { state.default = iso ?? ''; changed(); },
          }));
        }
        kids.push(dsection('Default', body));
      } else if (t === 'daterange') {
        kids.push(dsection('Default', rangeControl({
          value: fdc.rangeDefault(state.default), title: 'Default', costume: fdc.dateCostume(state.date, t), compact: false,
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
  const tableSel = pickTables && !isEdit
    ? pickerSelect({ name: 'table', title: 'Table', options: pickTables.map((t) => ({ id: t.id, label: `${t.space}/${t.name}` })), value: db.id })
    : null;
  tableSel?.input.addEventListener('change', () => {
    const next = pickTables.find((t) => t.id === tableSel.input.value);
    if (next && next.id !== db.id) fieldDialog(next, null, after, { pickTables });
  });
  tray(isEdit ? `Edit ${existing.name}` : 'New field', [
    tableSel ? dsection('Table', tableSel) : '',
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
