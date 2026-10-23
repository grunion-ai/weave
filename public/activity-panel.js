'use strict';

const activityPanelCore = (() => {
  const H = () => window.weaveHistoryCore;
  let st = null;
  let panel = null;
  let sheetBack = null;
  let fitObserver = null;

  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const stamp = (iso) => `${H().dayLabel(iso) === 'Today' ? '' : `${new Date(iso).toLocaleDateString([], { weekday: 'short' })} `}${clock(iso)}`;
  const val = (v, cls = '') => el('span', { class: `wv-act-val ${cls}`.trim() }, H().valueText(v));
  const arrow = () => el('span', { class: 'wv-act-arr' }, iconEl('lucide:arrow-right', 'wv-icon'));
  const byId = (id) => st?.items.find((it) => it.id === id);
  const revsOf = (field) => st.items.filter((it) => it.kind === 'rev' && it.field === field);
  const prevOf = (r) => { const l = revsOf(r.field); return l[l.indexOf(r) + 1] ?? null; };
  const sections = () => [...(st?.mount ?? document).querySelectorAll('.doc-section[data-doc-field]')];
  const sectionFor = (field) => sections().find((s) => s.dataset.docField === field);

  async function load() {
    const [ent, act] = await Promise.all([api('GET', `/entities/${st.id}`), api('GET', `/activity?entity=${st.id}&limit=${ACTIVITY_PAGE}`)]);
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
    st.name = ent.name ?? '';
    st.items = H().feed({ documents, activity: act.items, optionName });
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
      await api('PATCH', `/entities/${st.id}`, { values: { [a.field]: a.from } });
      const mine = await undoTop();
      st.sel = a.id;
      await afterWrite(`${a.field} reverted`, mine);
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
      options: others.map((x) => ({ id: x.id, label: `vs ${stamp(x.at)} · ${weaveActor.actorText(x.actor)}` })),
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
    return el('div', { class: 'wv-act-tray' }, btn(H().revertLabel(it.from), 'lucide:undo', () => revert(it), true));
  }
  function row(it) {
    const on = st.sel === it.id;
    let icon, what, who = clock(it.at), act = null;
    if (it.kind === 'rev') {
      icon = it.restoredFrom != null || it.undo ? 'lucide:undo' : 'lucide:file-text';
      what = [el('span', { class: 'name' }, it.field),
        it.restoredFrom != null ? el('span', {
          class: 'wv-act-src',
          title: it.source ? `Restored the version from ${weaveDateCore.relativeOrShort(it.source.at).title}${it.source.actor ? ` by ${weaveActor.actorText(it.source.actor)}` : ''}` : 'Restored a version no longer kept',
        }, it.source ? `restored from ${stamp(it.source.at)}` : 'restored from an earlier version') : null,
        it.delta ? el('span', { class: `wv-act-delta ${it.delta > 0 ? 'pos' : 'neg'}` }, it.delta > 0 ? `+${it.delta}` : `−${-it.delta}`) : null];
      if (it.current) who += ' · current'; else if (it.undo) who += ' · undo';
      if (!it.current && !on) act = { title: 'Restore this version', icon: 'lucide:undo', run: () => restore(it) };
    } else {
      icon = it.kind === 'undo' ? 'lucide:undo' : it.kind === 'state' ? 'lucide:workflow' : 'lucide:pencil';
      what = [el('span', { class: 'name' }, it.field), val(it.from), arrow(), val(it.to, 'new')];
      if (it.undone) who += ' · undone';
      if (!on && !it.undone && it.kind !== 'undo') act = { title: H().revertLabel(it.from), icon: 'lucide:undo', run: () => revert(it) };
    }
    const node = el('div', { class: `wv-act-row${on ? ' sel' : ''}${it.undone ? ' undone' : ''}`, tabindex: '0', 'data-id': it.id },
      el('span', { class: 'wv-act-kind' }, iconEl(icon, 'wv-icon')),
      el('span', { class: 'wv-act-what' }, ...what),
      act ? el('button', { class: 'wv-act-icon', type: 'button', title: act.title, 'aria-label': act.title, onclick: (e) => { e.stopPropagation(); act.run(); } }, iconEl(act.icon, 'wv-icon')) : el('span'),
      el('span', { class: 'wv-act-who' }, ...(() => { const chip = actorChipEl(it.actor, { link: false }); return chip ? [chip, ` · ${who}`] : [who]; })()),
      on ? tray(it) : null);
    node.addEventListener('click', (e) => {
      if (e.target.closest('.wv-act-tray, .wv-act-view')) return;
      st.sel = it.id; st.from = null; st.done = null; st.scroll = true; render();
    });
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === node) node.click(); });
    return node;
  }
  function fitFilters(strip) {
    if (!strip.isConnected) return;
    const chipEls = [...strip.querySelectorAll(':scope > button[data-filter]')];
    const more = strip.querySelector(':scope > .wv-act-more');
    const fits = () => {
      const last = [...strip.children].filter((c) => !c.hidden).at(-1);
      const edge = strip.getBoundingClientRect().right - parseFloat(getComputedStyle(strip).paddingRight);
      return !last || last.getBoundingClientRect().right <= edge + 0.5;
    };
    for (const c of chipEls) c.hidden = false;
    more.hidden = true;
    if (fits()) return;
    more.hidden = false;
    const spare = chipEls.filter((c) => c.dataset.filter.startsWith('doc:') && c.getAttribute('aria-pressed') !== 'true').reverse();
    for (const c of spare) {
      c.hidden = true;
      if (fits()) return;
    }
  }
  function subjectCrumb() {
    if (!st.name) return [];
    const subject = dockCoversScreen.matches
      ? el('button', { type: 'button', class: 'wv-act-subject', title: `Back to ${st.name}`, onclick: () => close() }, st.name)
      : el('span', { class: 'wv-act-subject' }, st.name);
    return [subject, el('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›')];
  }
  function renderPanel() {
    const chips = [['all', 'All'], ...st.docFields.map((f) => [`doc:${f}`, f]), ['fields', 'Fields']];
    const pickFilter = (k) => { st.filter = k; render(); };
    const chipEls = chips.map(([k, label]) => el('button', { type: 'button', 'data-filter': k, 'aria-pressed': String(st.filter === k), onclick: () => pickFilter(k) }, label));
    const more = el('button', {
      type: 'button', class: 'wv-act-more', hidden: true, 'aria-haspopup': 'menu', title: 'More filters',
      onclick: () => menu(chipEls.filter((c) => c.hidden).map((c) => ({ label: c.textContent, section: 'organize', run: () => pickFilter(c.dataset.filter) })), { anchor: more, label: 'More filters' }),
    }, 'More', iconEl('lucide:chevron-down', 'wv-icon'));
    const filters = el('div', { class: 'wv-act-filters', role: 'toolbar', 'aria-label': 'Show' }, ...chipEls, more);
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
      el('div', { class: 'wv-act-head' }, el('h3', {}, ...subjectCrumb(), el('span', { class: 'wv-act-section' }, 'Activity')),
        el('button', { class: 'wv-act-icon wv-act-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: close }, iconEl('lucide:x', 'wv-icon'))),
      filters, list);
    const side = $('#side');
    if (panel?.parentElement === side) panel.replaceWith(next); else side.replaceChildren(next);
    panel = next;
    side.hidden = false;
    wirePaneGutter(side, SIDE_PANE);
    applyPaneWidth(side, SIDE_PANE);
    fitObserver?.disconnect();
    fitFilters(filters);
    fitObserver = new ResizeObserver(() => fitFilters(filters));
    fitObserver.observe(filters);
    list.scrollTop = keep;
    const s = list.querySelector('.wv-act-row.sel');
    if (s) {
      const lb = list.getBoundingClientRect(), sb = s.getBoundingClientRect();
      if (sb.bottom > lb.bottom) list.scrollTop += sb.bottom - lb.bottom + 8;
      else if (sb.top < lb.top + 28) list.scrollTop -= lb.top + 28 - sb.top;
    }
  }

  const reveal = (node, padding = 12) => { if (st.scroll) { st.scroll = false; scrollTargetIntoView(node, { padding }); } };
  function clearViews() {
    for (const v of document.querySelectorAll('.wv-act-view')) {
      const body = v.closest('.doc-section')?.querySelector(':scope > .doc-section-body');
      if (body) body.hidden = false;
      v.remove();
    }
  }
  async function renderView() {
    clearViews();
    const it = byId(st?.sel);
    if (!it) return;
    const inSheet = dockCoversScreen.matches ? panel?.querySelector('.wv-act-row.sel') : null;
    if (it.kind === 'rev') {
      const sec = inSheet ? null : sectionFor(it.field); if (!inSheet && !sec) return;
      const from = st.from ? byId(st.from) : prevOf(it);
      const view = el('div', { class: 'wv-act-view' });
      if (inSheet) inSheet.append(view);
      else { const body = sec.querySelector(':scope > .doc-section-body'); body.hidden = true; body.after(view); }
      const [ft, tt] = await Promise.all([from ? text(from) : '', text(it)]);
      if (!view.isConnected) return;
      const diff = el('div', { class: 'wv-act-diff' }); diff.innerHTML = H().renderDiff(ft, tt);
      view.append(el('div', { class: 'wv-act-bar' }, from ? val(stamp(from.at), 'from') : null, from ? arrow() : null, val(stamp(it.at), 'to')), diff);
      if (inSheet) reveal(inSheet, 36); else reveal(sec);
      return;
    }
    const host = inSheet ?? st.mount?.querySelector('.entity-body'); if (!host) return;
    const view = el('div', { class: 'wv-act-view top' }, el('div', { class: 'wv-act-card' },
      el('b', {}, it.field), val(it.from), arrow(), val(it.to, 'new')));
    if (inSheet) { inSheet.append(view); reveal(inSheet, 36); return; }
    host.prepend(view);
    reveal(view);
  }
  function render() {
    if (!st) return;
    renderPanel();
    renderView();
    for (const b of document.querySelectorAll('.activity-btn')) b.setAttribute('aria-pressed', 'true');
    sideSyncUrl();
  }

  async function open(id, mount) {
    if (st?.id !== id) st = { id, texts: new Map() };
    Object.assign(st, { mount: mount ?? st.mount ?? $('#main'), filter: 'all', from: null, done: null, scroll: true });
    try { await flushDocSaves(); await load(); } catch (err) { st = null; return toast(err.message, true); }
    const first = H().filterFeed(st.items, st.filter)[0];
    st.sel = first?.id ?? null;
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
    fitObserver?.disconnect(); fitObserver = null;
    panel?.remove(); panel = null;
    $('#side').hidden = true;
    $('#side-gutter').hidden = true;
    clearViews();
    for (const b of document.querySelectorAll('.activity-btn')) b.setAttribute('aria-pressed', 'false');
    st = null;
    sideSyncUrl();
  }
  function toggle(id, mount) {
    if (st?.id === id && panel?.isConnected) return close();
    return open(id, mount);
  }
  function mounted(id, mount) {
    if (!st || !panel) { if (sideWanted() === 'activity') open(id, mount); return; }
    if (st.id !== id) { if (!st.mount?.isConnected || !panel.isConnected) close(); return; }
    st.mount = mount;
    for (const b of mount.querySelectorAll('.activity-btn')) b.setAttribute('aria-pressed', 'true');
    renderPanel();
    renderView();
    sideSyncUrl();
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !panel?.isConnected || e.defaultPrevented || e.target.closest?.('.picker-pop, .chip-pop, .modal') || document.querySelector('.picker-pop, #tray-back, #modal-back')) return;
    e.stopPropagation();
    close();
  }, true);
  window.addEventListener('hashchange', () => setTimeout(() => { if (st && !st.mount?.isConnected) close(); }, 0));
  return { toggle, open, close, mounted, get openFor() { return panel?.isConnected ? st?.id : null; } };
})();
