'use strict';

function navigateToResult(hit) {
  const home = !hit.workspace || hit.workspace.toLowerCase() === currentWsName().toLowerCase();
  if (!home) {
    location.href = hit.url;
    return;
  }
  if (hit.kind === 'entity') openEntity(hit.id);
  else if (hit.kind === 'table') location.hash = `#/table/${hit.id}`;
  else if (hit.kind === 'space') location.hash = `#/space/${hit.id}`;
  else if (hit.kind === 'view') location.hash = `#/view/${hit.id}`;
  else location.hash = '#/';
}

function paletteIcon(hit, group) {
  if (hit.avatar) return chipElFrom(chipView.avatarHtml(hit.avatar, { cls: 'cmdk-ic cmdk-av' }));
  const name = hit.kind === 'table' ? 'table'
    : hit.kind === 'view' ? 'eye'
    : hit.kind === 'space' ? 'layout-grid'
    : hit.kind === 'workspace' ? 'house'
    : group === 'docs' ? 'file-text' : 'file';
  return iconEl(`lucide:${name}`, 'wv-icon cmdk-ic');
}

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
    releasePage();
    if (picked) return;
    picked = true;
    if (multi) onCommit?.([...chosen]);
    else onDismiss?.();
  };
  const back = el('div', { id: 'cmdk-back', onclick: (e) => { if (e.target === back) dismiss(); } });
  const input = el('input', {
    id: 'cmdk-input', class: 'search-bare', autocomplete: 'off', spellcheck: 'false',
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
      if (!multi) { picked = true; back.remove(); releasePage(); onPick?.(made); return; }
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
    releasePage();
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
  const box = el('div', { id: 'cmdk' },
    el('div', { class: 'cmdk-inp' },
      iconEl('lucide:search', 'wv-icon cmdk-ic'),
      input,
      here ? el('span', { class: 'cmdk-ws', title: 'This workspace' }, here) : null),
    list,
    el('div', { class: 'cmdk-foot', 'aria-hidden': 'true' },
      el('span', {}, cap('↑'), ' ', cap('↓'), ' move'),
      el('span', {}, cap('↵'), multi ? ' toggle' : scope ? ' pick' : ' open'),
      el('span', {}, cap('tab'), ' next group'),
      multi ? el('span', {}, cap('↵'), ' on empty or ', cap('esc'), ' done') : el('span', {}, cap('esc'), ' close')));
  back.append(box);
  holdPage(back, box, 'Search');
  if (scope) {
    render('', scopedGroups('', []), 'Searching…');
    load('');
  } else showRecent();
  input.focus();
}
