'use strict';
const masonryRows = new ResizeObserver((entries) => {
  for (const { target: t } of entries) {
    if (!t.isConnected) { masonryRows.unobserve(t); continue; }
    const gap = parseFloat(getComputedStyle(t.parentElement).columnGap) || 0;
    t.style.gridRowEnd = `span ${Math.ceil((t.getBoundingClientRect().height + gap) / 2)}`;
  }
});
const coverSize = (e) => {
  e.target.style.setProperty('--nw', `${e.target.naturalWidth}px`);
  e.target.style.setProperty('--nh', `${e.target.naturalHeight}px`);
};
const TILE_FORM = 'button, input, select, textarea, [contenteditable], .picker-wrap';
const TILE_HANDS_OFF = `${TILE_FORM}, .tile-field, .tile-pick`;
const boardPicks = { dbId: null, ids: [], full: false };
function closeCompare() {
  if (!compare) return;
  if (history.state?.wvCompare) history.back();
  else dockClose();
}
addEventListener('popstate', () => { if (compare) dockClose(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !compare || e.defaultPrevented) return;
  if (document.querySelector(DOCK_ESC_OWNERS) || document.querySelector('.picker-pop')) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  closeCompare();
});
async function openCompare(db, ids) {
  if (activityPanel.openFor) activityPanel.close();
  if (dock) { dockClose(); dockSyncUrl(); }
  crumbNav = null;
  compare = { db, ids: [...ids] };
  if (dockCoversScreen.matches && !history.state?.wvCompare) history.pushState({ wvCompare: true }, '', location.hash);
  await drawCompare();
}
async function drawCompare() {
  const at = compare;
  if (!at) return;
  let items;
  try { items = await Promise.all(at.ids.map((id) => api('GET', `/entities/${id}`))); } catch (err) { closeCompare(); return toast(err.message, true); }
  if (compare !== at) return;
  const { db } = at;
  const cover = boardCore.coverField(db);
  const rows = boardCore.compareRows(boardCardFields(db), items);
  const saved = () => { drawCompare(); keepScroll(() => showDatabase(db.id, db.view.id)); };
  const panel = $('#dock');
  releaseDockPanel();
  panel.hidden = false;
  delete panel.dataset.eid;
  wirePaneGutter(panel, DOCK_PANE);
  applyPaneWidth(panel, DOCK_PANE);
  const head = el('div', { class: 'compare-head' },
    el('h2', { class: 'compare-title' }, `Compare ${items.length}`, el('span', { class: 'compare-table' }, db.name)),
    el('button', { class: 'btn btn-sm btn-ghost-secondary compare-close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close the comparison', onclick: () => closeCompare() }, iconEl('✕')));
  const column = (it) => {
    const file = cover ? boardCore.coverOf(db, it) : null;
    return el('th', { scope: 'col', dataset: { eid: it.id } },
      cover ? el('div', { class: 'tile-cover' + (file ? '' : ' is-empty') },
        file ? el('img', { loading: 'lazy', decoding: 'async', src: previewUrl(file), alt: '' }) : iconEl('lucide:image', 'wv-icon')) : null,
      el('a', { class: 'compare-name', href: `#/entity/${it.id}`, onclick: (e) => { if (nativeClick(e)) return; e.preventDefault(); dockEntity(db, it.id, { step: true }); } },
        el('span', { class: 'tile-id' }, `#${it.publicId}`), ' ', it.name || `#${it.publicId}`));
  };
  const table = el('table', { class: 'wv-compare', 'aria-label': `Compare ${items.length} from ${db.name}` },
    el('thead', {}, el('tr', {}, el('th', { class: 'compare-corner', scope: 'col' }), ...items.map(column))),
    el('tbody', {}, ...rows.map(({ field, differs }) => el('tr', { class: differs ? 'is-different' : '', dataset: { field: field.name } },
      el('th', { scope: 'row' }, field.name),
      ...items.map((it) => el('td', { dataset: { eid: it.id } }, labeledEditorFor(field, it, db, saved, { compact: true })))))));
  panel.replaceChildren(el('div', { class: 'dock-compare' }, head, el('div', { class: 'compare-scroll' }, table)));
  markDockedRow();
}
function renderBoard(main, db, items, ctx) {
  const { setup: s, all, everyone, domains, filtered, sorted } = ctx;
  const v = db.view;
  const picksState = ctx.embedded ? { dbId: db.id, ids: [], full: false } : boardPicks;
  const writeView = (patch) => ctx.writeView ? ctx.writeView(patch) : listViewWrite(db, patch);
  const groups = boardCore.groupsOf(v);
  const picture = boardCore.pictureOf(db, v);
  const size = boardCore.widths(picture);
  const fit = boardCore.fitOf(v);
  const flow = boardCore.flowOf(v);
  const masonry = picture !== 'off' && (fit === 'original' || fit === 'capped') && flow === 'masonry';
  const fields = boardCardFields(db);
  if (picksState.dbId !== db.id) Object.assign(picksState, { dbId: db.id, ids: [], full: false });
  const known = new Set((everyone ?? items).map((it) => it.id));
  picksState.ids = picksState.ids.filter((id) => known.has(id));
  if (compare?.db.id === db.id) compare.db = db;
  const levels = groups === 'side' ? s.levels.slice(0, 2) : s.levels;
  const lanes = groups === 'side' && levels.length === 2;
  const rows = items.map((it) => ({ id: it.id, keys: levels.map((l) => listKeys(l, it)), parent: null, done: s.completedBy ? !!it.raw?.[s.completedBy.name] : false, item: it }));
  const byPid = new Map([...(everyone ?? []), ...items].map((it) => [it.publicId, it.id]));
  const manual = sorted ? null : (v.order ?? []).map((p) => byPid.get(p)).filter(Boolean);
  const arrangeLevels = levels.map((l, i) => ({ order: l.order, dir: l.dir, domain: listDomain(l, domains?.[i], items), nullLabel: `No ${l.f.name}` }));
  const arranged = listCore.arrange(rows, { levels: arrangeLevels, completedBy: !!s.completedBy, manual, showEmpty: !filtered && !s.hideEmpty });
  let collapsed = Array.isArray(v.collapsed) ? [...v.collapsed] : undefined;
  const everyRow = (everyone ?? items).map((it) => ({ id: it.id }));
  const effective = () => listCore.applyManual(everyRow, manual).map((r) => r.id);
  const reload = () => ctx.reload ? ctx.reload() : keepScroll(() => showDatabase(db.id, db.view.id));
  const write = async (item, values, order, undo = null, settled = null) => {
    const release = gridHold();
    try {
      if (Object.keys(values).length) await api('PATCH', `/entities/${item.id}`, { values });
      if (order) await listViewWrite(db, { order });
      await settled;
      await reload();
      if (undo) toast(undo.text, false, { label: 'Undo', run: () => write(item, undo.values, null) });
    } catch (err) { await settled; await reload(); toast(err.message, true); } finally { release(); }
  };

  const addPhotoField = async (it, file) => {
    const release = gridHold();
    try {
      const name = boardCore.photoFieldName(db);
      await api('POST', `/tables/${db.id}/fields`, { name, type: 'attachments', config: { multiple: false, preview: 'cover' } });
      await streamUpload(`/entities/${it.id}/fields/${encodeURIComponent(name)}/files`, { entity: it.id, field: name, file });
      await loadSchema();
      await reload();
    } catch (err) { toast(err.message, true); } finally { release(); }
  };
  const dropCover = (it, files) => {
    const got = boardCore.coverDrop(db, files);
    if (got.refuse === 'not-picture') return toast(`${got.name || 'That file'} is not a picture. A cover takes a PNG, JPEG, GIF or WebP file.`, true);
    if (got.refuse === 'no-field') return toast(`${db.name} has no picture field for covers.`, false, { label: 'Add a Photo field', run: () => addPhotoField(it, got.file) }, { kind: 'info' });
    labeledEditorFor(got.field, it, db, () => reload(), { compact: true }).dropFiles([got.file]);
  };
  const tileEl = (node, path) => {
    const it = node.row.item;
    const file = picture === 'off' ? null : boardCore.coverOf(db, it);
    const label = it.name || `#${it.publicId}`;
    const card = el('article', {
      class: 'tile' + (node.row.done ? ' done' : ''), role: 'listitem', tabindex: '0',
      dataset: { eid: it.id, href: `#/entity/${it.id}` }, 'aria-label': label,
    },
      picture === 'off' ? null : el('div', { class: 'tile-cover' + (file ? '' : ' is-empty') },
        file ? el('img', { loading: 'lazy', decoding: 'async', onload: coverSize, src: previewUrl(file), alt: '', draggable: 'false' }) : iconEl('lucide:image', 'wv-icon')),
      el('div', { class: 'tile-body' },
        el('div', { class: 'tile-head' },
          el('label', { class: 'tile-pick', title: 'Pick to compare' },
            el('input', { type: 'checkbox', 'aria-label': `Pick ${label} to compare`, onchange: () => pickCard(it.id) })),
          el('span', { class: 'tile-id' }, `#${it.publicId}`),
          el('a', { class: 'tile-title', href: `#/entity/${it.id}`, draggable: 'false', tabindex: '-1' }, label)),
        fields.length ? el('dl', { class: 'tile-fields' }, ...fields.map((f) => el('div', { class: 'tile-field', dataset: { field: f.name } },
          el('dt', {}, f.name), el('dd', {}, labeledEditorFor(f, it, db, () => reload(), { compact: true }))))) : null));
    card.wvPath = path;
    card.wvItem = node;
    if (masonry) masonryRows.observe(card);
    RO().guard(card);
    fileDropZone(card, (files) => dropCover(it, files));
    card.addEventListener('click', (e) => {
      if (e.target.closest('.tile-pick') || !(e.shiftKey || (dockCoversScreen.matches && picksState.ids.length))) return;
      e.preventDefault();
      e.stopPropagation();
      pickCard(it.id);
    }, true);
    card.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.shiftKey) return;
      const phone = dockCoversScreen.matches;
      if (!phone && e.target.closest('.tile-field > dd')) { if (!ctx.embedded && !nativeClick(e)) dockEntity(db, it.id, { step: true }); return; }
      if (!e.target.closest(phone ? TILE_FORM : TILE_HANDS_OFF)) boardDrag(e, card);
    });
    card.addEventListener('click', (e) => {
      if (nativeClick(e) || e.target.closest('a.tile-title, .tile-pick') || (!dockCoversScreen.matches && e.target.closest('.tile-field > dd'))) return;
      dockEntity(db, it.id, { step: true });
    });
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target !== card) return;
      e.preventDefault();
      dockEntity(db, it.id, { step: true });
    });
    return card;
  };
  const cardsEl = (node, completed) => {
    const items = node.items.flatMap(function out(i) { return [i, ...i.children.flatMap(out)]; });
    const cards = el('div', { class: 'board-cards', role: 'list' }, ...cappedEls(db, listCore.BOARD_CAP, node.key, items, (i) => [tileEl(i, completed ? null : node.path)]));
    const more = cards.querySelector(':scope > .wv-more');
    if (masonry && more) masonryRows.observe(more);
    cards.append(el('div', { class: 'board-empty board-tail' }, 'Drop a card here'));
    return cards;
  };
  const groupEl = (node, depth, { completed = false, cell = false } = {}) => {
    const key = node.key ?? '';
    const nested = !!node.groups;
    const body = nested
      ? el('div', { class: 'board-nest' }, ...node.groups.map((g) => groupEl(g, depth + 1)))
      : cardsEl(node, completed);
    const shut = !cell && listCore.isCollapsed(collapsed, key);
    const fold = el('button', { class: 'list-fold', type: 'button', 'aria-expanded': String(!shut), 'aria-label': `Fold ${node.label || key}` }, lucideEl('chevron-right'));
    const head = !cell && (node.path?.length || completed)
      ? el('div', { class: 'board-group-head' }, fold,
        completed ? el('span', { class: 'list-group-label' }, node.label) : listHeadingEl(s, depth, node),
        el('span', { class: 'list-count' }, String(node.count ?? node.items.length)))
      : null;
    const sec = el('section', {
      class: 'board-group' + (nested ? ' board-parent' : '') + (completed ? ' board-completed' : '') + (shut ? ' shut' : ''),
      dataset: { key, depth: String(depth) }, 'aria-label': key || db.name,
    }, head, body);
    fold.addEventListener('click', () => {
      collapsed = listCore.toggleCollapsed(collapsed, key);
      const now = listCore.isCollapsed(collapsed, key);
      sec.classList.toggle('shut', now);
      fold.setAttribute('aria-expanded', String(!now));
      v.collapsed = collapsed;
      writeView({ collapsed });
    });
    sec.wvPath = completed || nested ? null : node.path;
    return sec;
  };
  const stacked = arranged.groups ?? [{ key: '', path: [], items: arranged.items, count: arranged.items.length }];
  const laneEl = (lane) => {
    const shut = boardCore.laneShut(collapsed, lane);
    const row = el('div', { class: 'board-lane' + (shut ? ' shut' : ''), role: 'group', 'aria-label': lane.label, dataset: { key: lane.key } });
    const fold = el('button', { class: 'list-fold', type: 'button', 'aria-expanded': String(!shut), 'aria-label': `Fold ${lane.label}` }, lucideEl('chevron-right'));
    fold.addEventListener('click', () => {
      collapsed = boardCore.laneFold(collapsed, lane);
      const now = boardCore.laneShut(collapsed, lane);
      row.classList.toggle('shut', now);
      fold.setAttribute('aria-expanded', String(!now));
      v.collapsed = collapsed;
      writeView({ collapsed });
    });
    row.append(el('div', { class: 'board-lane-head' },
      el('span', { class: 'board-lane-title' }, fold, listHeadingEl(s, 1, lane), el('span', { class: 'list-count' }, String(lane.count)))),
    ...lane.cells.map((c) => groupEl(c, 1, { cell: true })));
    return row;
  };
  const grid = lanes ? boardCore.laneGrid(arranged.groups, arrangeLevels[1]) : null;
  const syncColumns = () => {
    board.style.gridTemplateColumns = grid.columns.map((c) => listCore.isCollapsed(collapsed, c.key) ? '48px' : 'var(--board-col-width)').join(' ');
    grid.columns.forEach((c, i) => {
      const shut = listCore.isCollapsed(collapsed, c.key);
      board.querySelectorAll(`.board-col-head:nth-child(${i + 1}), .board-lane > .board-group:nth-child(${i + 2})`).forEach((n) => n.classList.toggle('column-shut', shut));
      board.querySelector(`.board-col-head:nth-child(${i + 1}) .list-fold`)?.setAttribute('aria-expanded', String(!shut));
    });
  };
  const columnHead = (c) => el('div', { class: 'board-col-head board-group-head', dataset: { key: c.key } },
    el('button', { class: 'list-fold', type: 'button', 'aria-label': `Fold ${c.label}`, 'aria-expanded': 'true', onclick: () => {
      collapsed = listCore.toggleCollapsed(collapsed, c.key);
      v.collapsed = collapsed;
      syncColumns();
      writeView({ collapsed });
    } }, lucideEl('chevron-right')), listHeadingEl(s, 0, c), el('span', { class: 'list-count' }, String(c.count)));
  const board = el('div', {
    class: 'wv-board', 'aria-label': `${db.name} · ${v.name}`,
    dataset: { groups: levels.length ? groups : 'stacked', picture, fit, flow, ...(lanes ? { lanes: 'true' } : {}) },
    style: `--card-w:${size.card}px;--col-w:${size.column}px;--phone-cols:${size.phone};--frame:${boardCore.frameOf(v).replace(':', ' / ')}` + (lanes ? `;--cols:${grid.columns.length}` : ''),
  }, ...(lanes
    ? [...grid.columns.map(columnHead), ...grid.lanes.map(laneEl)]
    : stacked.map((node) => groupEl(node, 0))));
  if (lanes) syncColumns();
  if (arranged.completed?.count) board.append(groupEl(arranged.completed, 0, { completed: true }));
  const sortName = (gridSort(db) ?? []).map((x) => x.field).join(', ');
  const manualBtn = el('button', { class: 'btn btn-sm btn-ghost-primary tiny board-manual', type: 'button', onclick: () => listViewWrite(db, { sort: [] }).then(reload) }, 'Manual');
  const hint = ctx.embedded ? null : sorted
    ? el('span', { class: 'board-hint' }, `Sorted by ${sortName}: ${levels.length ? 'drag into another group, or ' : ''}choose `, manualBtn, ' to arrange by hand')
    : el('span', { class: 'board-hint' }, levels.length ? 'Manual: drag to arrange, or into another group to change it' : 'Manual: drag to arrange, left to right then down');
  const picks = el('span', { class: 'board-picks' });
  const footer = el('div', { class: 'list-footer board-footer', role: 'status', 'aria-live': 'polite' },
    el('span', {}, listCore.footerText({ shown: arranged.shown, all, done: s.completedBy ? arranged.done : null, term: db.term })), hint, picks);
  const wrap = el('div', { class: 'board-wrap', dataset: { layout: 'board', density: gridDensity(db) } }, board, footer);
  wrap.wvSetDensity = (mode) => { wrap.dataset.density = mode; saveGridDensity(db, mode); };
  main.append(wrap);
  syncPicks();
  board.style.setProperty('--board-top', `${Math.max(0, Math.round(board.getBoundingClientRect().top + scrollY))}px`);
  markDockedRow();

  function pickCard(id) {
    const got = boardCore.togglePick(picksState.ids, id);
    picksState.ids = got.ids;
    picksState.full = got.refused;
    syncPicks();
  }
  function syncPicks() {
    const on = new Set(picksState.ids);
    board.classList.toggle('is-picking', on.size > 0);
    for (const t of board.querySelectorAll('.tile[data-eid]')) {
      const yes = on.has(t.dataset.eid);
      t.classList.toggle('is-picked', yes);
      const box = t.querySelector('.tile-pick input');
      if (box) box.checked = yes;
    }
    if (!on.size) { picks.replaceChildren(); return; }
    const n = on.size;
    picks.replaceChildren(...[
      picksState.full ? el('span', { class: 'board-pick-hint' }, `Compare takes up to ${boardCore.PICK_CAP} cards`) : null,
      el('button', { class: 'btn btn-sm btn-primary board-compare', type: 'button', ...(n < boardCore.PICK_MIN ? { disabled: '', title: `Pick ${boardCore.PICK_MIN} to ${boardCore.PICK_CAP} cards to compare` } : {}),
        onclick: () => openCompare(db, picksState.ids) }, `Compare ${n}`),
      el('button', { class: 'btn btn-sm btn-ghost-secondary board-clear', type: 'button', onclick: () => { Object.assign(picksState, { ids: [], full: false }); syncPicks(); } }, 'Clear')].filter(Boolean));
  }
  function boardDrag(down, card) {
    const side = board.dataset.groups === 'side';
    let at = { x: down.clientX, y: down.clientY };
    const track = (e) => { at = { x: e.clientX, y: e.clientY }; };
    const stop = () => { removeEventListener('pointermove', track, true); removeEventListener('pointerup', stop, true); removeEventListener('pointercancel', stop, true); };
    addEventListener('pointermove', track, true);
    addEventListener('pointerup', stop, true);
    addEventListener('pointercancel', stop, true);
    const inLanes = board.dataset.lanes === 'true';
    let held = null;
    const under = () => {
      const g = [...board.querySelectorAll('.board-group:not(.board-parent)')].find((n) => {
        if (n.classList.contains('shut') || n.classList.contains('column-shut') || !n.getClientRects().length) return false;
        const r = n.getBoundingClientRect();
        return at.x >= r.left && at.x <= r.right && ((side && !inLanes) || (at.y >= r.top && at.y <= r.bottom));
      });
      if (g) held = g;
      return g ?? (inLanes ? held : null);
    };
    RO().sortable(down, {
      source: card,
      items: () => {
        const all = [...board.querySelectorAll('.tile, .board-tail')].filter((n) => !n.closest('.board-group.shut, .board-lane.shut, .column-shut'));
        const group = under();
        return group ? all.filter((n) => group.contains(n)) : all;
      },
      tail: (n) => n.classList.contains('board-tail'),
      axis: side ? 'y' : 'x',
      alsoScroll: [side ? { scroller: board, axis: 'x' } : { scroller: RO().scrollParent(board, 'y'), axis: 'y' }],
      zone: () => board,
      onDrop: (placed) => drop(card, placed),
      onStay: ({ point, start }) => {
        if (down.pointerType === 'touch' && Math.hypot(point.x - start.x, point.y - start.y) <= RO().TOUCH_SLOP) pickCard(card.wvItem.row.item.id);
      },
    });
  }
  function drop(card, { node, before, settled }) {
    const item = card.wvItem.row.item;
    const from = card.wvPath;
    const sec = node.closest('.board-group');
    const to = sec?.wvPath;
    if (!to) return Promise.resolve(settled).then(reload);
    const values = from ? listPathValues(s, to, item, from) : listPathValues(s, to, item, to.map(() => ({ key: null })));
    if (!from && s.completedBy) values[s.completedBy.name] = false;
    const target = node.classList.contains('tile') ? node : null;
    const order = !sorted && target ? listCore.moveInOrder(effective(), item.id, target.dataset.eid, !before) : null;
    if (!Object.keys(values).length && !order) return Promise.resolve(settled).then(reload);
    const back = from ? listPathValues(s, from, item, to) : (s.completedBy ? { [s.completedBy.name]: true } : {});
    const where = to.map((p) => p.label).join(listCore.SEP);
    const undo = Object.keys(values).length ? { text: `#${item.publicId} moved to ${where}`, values: back } : null;
    write(item, values, order, undo, settled);
  }
  return listCore.drawnKeys(arranged);
}
