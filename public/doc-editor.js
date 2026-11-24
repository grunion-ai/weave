'use strict';
const SLASH_GROUPS = [
  ['all', 'ALL COMMANDS'],
  ['reference', 'REFERENCE'],
  ['format', 'FORMAT · APPLIES TO SELECTION'],
];

const refMarker = (kind) => `⁣ref:${kind}⁣`;
const DEFERRED_INSERTS = {
  '⁣raw-html⁣': '<div>html</div>',
  '⁣table⁣': { md: '| Column | Column |\n| --- | --- |\n| Cell | Cell |', select: 'Column' },
  '⁣code⁣': { md: '```\ncode\n```', select: 'code' },
};
const ENTITY_LINK_MARKER = refMarker('entity');
const REF_MARKER_RE = /⁣ref:(entity|table|space)⁣/;
const holdsCommandMarker = (v) => REF_MARKER_RE.test(v)
  || globalThis.WeaveEditorLib.BLOCK_MARKER_RE.test(v)
  || Object.keys(DEFERRED_INSERTS).some((m) => v.includes(m));
const blockMarker = (kind) => globalThis.WeaveEditorLib.blockMarker(kind);

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

function slashItems() {
  const wrap = (before, after = before) => {
    const picked = selectionForFormat();
    return `${before}${picked || 'text'}${after}`;
  };
  const headings = [1, 2, 3, 4, 5, 6].map((n) => ({
    label: `Heading ${n}`, icon: 'H', group: 'all', hidden: true,
    hint: `${'#'.repeat(n)} `, aliases: [`h${n}`, `heading${n}`],
    insert: blockMarker(`h${n}`),
  }));
  return [
    { label: 'Text', icon: '¶', flat: 'pilcrow', group: 'all', hint: '—', aliases: ['paragraph', 'plain'], insert: blockMarker('text') },
    { label: 'Heading 1–6', icon: 'H', group: 'all', hint: '#…######', aliases: ['title'], insert: blockMarker('h1') },
    ...headings,
    { label: 'Bulleted list', icon: '•', flat: 'list', group: 'all', hint: '-', aliases: ['ul', 'unordered'], insert: blockMarker('bullet') },
    { label: 'Numbered list', icon: '1.', flat: 'list-ordered', group: 'all', hint: '1.', aliases: ['ol', 'ordered'], insert: blockMarker('number') },
    { label: 'Task list', icon: '☑', flat: 'square-check', group: 'all', hint: '- [ ]', aliases: ['todo', 'checkbox'], insert: blockMarker('task') },
    { label: 'Quote', icon: '❝', flat: 'quote', group: 'all', hint: '>', aliases: ['blockquote'], insert: blockMarker('quote') },
    { label: 'Code block', icon: '#', flat: 'code', group: 'all', hint: '```', aliases: ['fence', 'pre'], insert: '⁣code⁣' },
    { label: 'Mermaid diagram', icon: '◈', flat: 'workflow', group: 'all', hint: '```mermaid', aliases: ['chart', 'graph', 'flow'], insert: '```mermaid\ngraph TD\n  A --> B\n```' },
    { label: 'Table', icon: '▦', flat: 'table', group: 'all', hint: '| a | b |', aliases: ['grid'], insert: '⁣table⁣' },
    { label: 'Divider', icon: '—', flat: 'minus', group: 'all', hint: '***', aliases: ['hr', 'rule', 'separator'], insert: '\n***\n' },
    { label: 'Line break', icon: '↵', flat: 'corner-down-left', group: 'all', hint: '\\ + ⏎', aliases: ['br', 'newline', 'return'], insert: '\\\n' },
    { label: 'Image', icon: '▤', flat: 'image', group: 'all', hint: '![](…)', aliases: ['picture', 'photo'], insert: '![alt](url)' },
    { label: 'Raw HTML', icon: '</>', flat: 'braces', group: 'all', hint: '<div>', aliases: ['embed', 'html'], insert: '⁣raw-html⁣' },

    { label: 'Entity', icon: '#', flat: 'hash', group: 'reference', hint: '[[Task#12]]', aliases: ['record', 'row', 'link entity', 'mention'], insert: refMarker('entity') },
    { label: 'Table', icon: '▦', flat: 'table', group: 'reference', hint: '[[table:…]]', aliases: ['database', 'link table'], insert: refMarker('table') },
    { label: 'Space / workspace', icon: '◇', flat: 'folder', group: 'reference', hint: '[[space:…]]', aliases: ['link space'], insert: refMarker('space') },

    { label: 'Bold', icon: 'B', group: 'format', hint: '**…**', aliases: ['strong'], insert: wrap('**') },
    { label: 'Italic', icon: 'I', group: 'format', hint: '*…*', aliases: ['emphasis', 'em'], insert: wrap('*') },
    { label: 'Strikethrough', icon: 'S', group: 'format', hint: '~~…~~', aliases: ['strike', 'delete'], insert: wrap('~~') },
    { label: 'Inline code', icon: '`', group: 'format', hint: '`…`', aliases: ['monospace'], insert: wrap('`') },
    { label: 'Link', icon: '⛓', flat: 'link', group: 'format', hint: '[…](…)', aliases: ['url', 'href'], insert: `[${selectionForFormat() || 'text'}](url)` },
  ];
}

function entityReference(hit) {
  return `[[${hit.db}#${hit.publicId}|${hit.name}]]`;
}

function referenceFor(kind, hit) {
  if (hit.kind === 'entity') return entityReference(hit);
  if (hit.kind === 'table') return `[[table:${hit.name}]]`;
  if (hit.kind === 'space') return `[[space:${hit.name}]]`;
  return `[[workspace|${hit.name}]]`;
}

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

const ENTITY_HINT_MIN = 2;
const entityHintCache = new Map();
let entityHintFailing = false;

async function entityHint(query) {
  const q = String(query ?? '').trim();
  if (q.length < ENTITY_HINT_MIN) return [];
  let hits = entityHintCache.get(q);
  if (!hits) {
    try {
      hits = (await api('GET', `/search?q=${encodeURIComponent(q)}&limit=12`))
        .filter((h) => h.kind === 'entity');
      entityHintFailing = false;
    } catch (err) {
      if (!entityHintFailing) toast(`Couldn't search: ${err.message}`, true);
      entityHintFailing = true;
      return [];
    }
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

function slashGlyph(item) {
  const name = item.flat && window.weaveIconRegistry?.resolve(`lucide:${item.flat}`);
  return name ? window.LUCIDE_MOVING[name] : escapeHtmlText(item.icon);
}

function escapeHtmlText(text) {
  return String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function dedupeVditorSprites() {
  const sprites = [...document.querySelectorAll('body > svg')].filter((v) => v.querySelector('symbol'));
  for (const extra of sprites.slice(1)) extra.remove();
}

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
  const mac = /Mac|iPhone/.test(navigator.platform);
  const ir = host.querySelector('.vditor-ir .vditor-reset') ?? host;
  ir.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: mac, ctrlKey: !mac, shiftKey: shift, bubbles: true, cancelable: true }));
}
const HINT_MIN_PX = 160;
function hintFloor(hint) {
  const head = document.querySelector(hint.closest('#dock') ? '#dock .view-header' : '#main > .view-header');
  return head ? head.getBoundingClientRect().bottom + 4 : 8;
}
const ENTER_HOLD_MS = 1000;
const ENTER_DRIFT_PX = 120;
function editorScroller(node) {
  for (let n = node?.parentElement; n; n = n.parentElement) {
    const overflow = getComputedStyle(n).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && n.scrollHeight - n.clientHeight > 1) return n;
  }
  return document.scrollingElement;
}
const scrollTopOf = (s) => (s === document.scrollingElement ? scrollY : s.scrollTop);
const putScrollTop = (s, top) => (s === document.scrollingElement
  ? scrollTo({ top, behavior: 'instant' })
  : s.scrollTo({ top, behavior: 'instant' }));
function caretOffsetIn(scroller) {
  const sel = getSelection();
  if (!sel?.rangeCount) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r.width && !r.height && !r.top) return null;
  const base = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
  return r.top - base + scrollTopOf(scroller);
}
function keepPlaceThroughEnter(host) {
  const scroller = editorScroller(host);
  if (!scroller) return;
  const from = scrollTopOf(scroller);
  const caret = caretOffsetIn(scroller);
  const viewport = scroller.clientHeight || innerHeight;
  const held = caret === null || (caret >= from && caret <= from + viewport);
  const pressedAt = performance.now();
  const pin = () => {
    if (performance.now() - pressedAt > ENTER_HOLD_MS || readerActedAt > pressedAt) return;
    if (held && Math.abs(scrollTopOf(scroller) - from) > ENTER_DRIFT_PX) putScrollTop(scroller, from);
    requestAnimationFrame(pin);
  };
  requestAnimationFrame(pin);
}
const HINT_GRACE_MS = 1000;
let readerActedAt = -Infinity;
for (const type of ['keydown', 'pointerdown', 'wheel', 'touchstart']) {
  addEventListener(type, () => { readerActedAt = performance.now(); }, { capture: true, passive: true });
}
function readerClosedHint(openedAt) {
  if (openedAt === undefined) return true;
  return readerActedAt > openedAt || performance.now() - openedAt >= HINT_GRACE_MS;
}
function attachHintClamp(host) {
  const put = (el, prop, v) => { if (el.style[prop] !== v) el.style[prop] = v; };
  const clamp = (hint) => {
    const floor = hintFloor(hint);
    const r = hint.getBoundingClientRect();
    const over = floor - r.top;
    if (over <= 0) return;
    put(hint, 'maxHeight', `${Math.max(HINT_MIN_PX, r.bottom - floor)}px`);
    put(hint, 'top', `${parseFloat(hint.style.top || '0') + over}px`);
  };
  const openedAt = new WeakMap();
  new MutationObserver((muts) => {
    for (const m of muts) {
      const hint = m.target.classList?.contains('vditor-hint') ? m.target : null;
      if (!hint) continue;
      if (hint.style.display === 'none') {
        if (!readerClosedHint(openedAt.get(hint))) { hint.style.display = 'block'; clamp(hint); continue; }
        openedAt.delete(hint);
        if (hint.style.maxHeight) hint.style.removeProperty('max-height');
        continue;
      }
      if (!openedAt.has(hint)) openedAt.set(hint, performance.now());
      clamp(hint);
    }
  }).observe(host, { subtree: true, attributes: true, attributeFilter: ['style'] });
  host.addEventListener('wheel', (e) => {
    const hint = e.target.closest?.('.vditor-hint');
    if (!hint || hint.style.display === 'none') return;
    const room = e.deltaY > 0 ? hint.scrollHeight - hint.clientHeight - hint.scrollTop : hint.scrollTop;
    if (room <= 0) e.preventDefault();
  }, { passive: false });
}

function attachTableKeys(host) {
  host.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.isComposing) return;
    const cell = tableCellOf(document.getSelection()?.anchorNode);
    if (!cell || !host.contains(cell)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      replayChord(host, '=');
    } else if (e.key === 'Enter' && e.shiftKey) {
      if (!rowIsEmpty(cell)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      replayChord(host, '-');
    } else if (e.key === 'Tab' && !e.shiftKey) {
      const table = cell.closest('table');
      const cells = table.querySelectorAll('td, th');
      const lastCell = cells[cells.length - 1];
      if (cell !== lastCell) return;
      replayChord(host, '=');
    }
  }, { capture: true });
}

function editorHintOpen(host) {
  const hint = [...host.querySelectorAll('.vditor-hint')].find((h) => !h.closest('.vditor-toolbar'));
  return !!hint && hint.style.display !== 'none' && !!hint.querySelector('button') ? hint : null;
}

function attachCodeFenceReturn(host) {
  let chose = false;
  host.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { chose = !!editorHintOpen(host); return; }
    if (e.key !== 'Enter') { chose = false; return; }
    const picked = chose;
    chose = false;
    if (picked || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const hint = editorHintOpen(host);
    const node = document.getSelection()?.anchorNode;
    const at = node instanceof Element ? node : node?.parentElement;
    const block = at?.closest('[data-type="code-block"]');
    if (!hint || !block || !host.contains(block)) return;
    const info = block.querySelector('[data-type="code-block-info"]');
    if ((info?.textContent ?? '').replace(/\u200b/g, '').trim()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    hint.style.display = 'none';
  }, { capture: true });
}

function attachTabKeys(host) {
  let escaped = false;
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { escaped = true; return; }
    if (e.key !== 'Tab') { escaped = false; return; }
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    if (escaped) { escaped = false; e.stopImmediatePropagation(); return; }
    if (editorHintOpen(host)) return;
    const node = document.getSelection()?.anchorNode;
    const at = node instanceof Element ? node : node?.parentElement;
    const root = host.querySelector('.vditor-ir .vditor-reset');
    if (!at || !root?.contains(at) || at.closest('td, th, pre') !== root) return;
    const li = at.closest('li');
    if (!li || !root.contains(li)) return;
    if (!pressListButton(host, e.shiftKey ? 'outdent' : 'indent')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    if (editorHintOpen(host)) return;
    const sel = document.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return;
    const node = sel.anchorNode;
    const at = node instanceof Element ? node : node?.parentElement;
    const root = host.querySelector('.vditor-ir .vditor-reset');
    if (!at || !root?.contains(at) || at.closest('td, th, pre') !== root) return;
    const li = at.closest('li');
    if (!li || !root.contains(li) || li.querySelector('ul, ol')) return;
    if ((li.textContent ?? '').replace(/\u200b/g, '').trim() !== '') return;
    if (li.parentElement?.parentElement?.tagName !== 'LI') return;
    if (!pressListButton(host, 'outdent')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, { capture: true });
}

function pressListButton(host, type) {
  const button = host.querySelector(`.vditor-toolbar [data-type="${type}"]`);
  if (!button) return false;
  button.classList.remove('vditor-menu--disabled');
  button.dispatchEvent(new Event(navigator.userAgent.includes('iPhone') ? 'touchstart' : 'click', { bubbles: true, cancelable: true }));
  return true;
}

const LIST_MARKER = /^(?:([-*+])(?: \[([ xX])\])?|(\d{1,9})([.)]))$/;
const TASK_BOX = /^\[([ xX])\]$/;

function attachListMarkers(host) {
  let undo = null;
  const rootOf = () => host.querySelector('.vditor-ir .vditor-reset');
  const textOf = (node) => (node.textContent ?? '').replace(/\u200b/g, '');
  const caretAtEnd = (block, range) => {
    const before = document.createRange();
    before.setStart(block, 0);
    before.setEnd(range.endContainer, range.endOffset);
    return before.toString().replace(/\u200b/g, '') === textOf(block);
  };
  const putCaret = (node, offset) => {
    const r = document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  };
  const fireInput = (root) => root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
  const itemEl = (marker, box) => box === undefined
    ? el('li', { dataset: { marker } })
    : el('li', { dataset: { marker }, class: 'vditor-task' }, el('input', { checked: box.trim() ? '' : null, type: 'checkbox' }), ' ');
  host.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'insertText' || e.data !== ' ' || e.isComposing) return;
    const root = rootOf();
    const range = getSelection()?.rangeCount ? getSelection().getRangeAt(0) : null;
    if (!root || !range || range.toString() !== '' || !root.contains(range.endContainer)) return;
    const at = range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer;
    const block = at.closest('p, li');
    if (!block || !caretAtEnd(block, range)) return;
    const text = textOf(block);
    let li, typed = text;
    if (block.tagName === 'P' && block.parentElement === root && LIST_MARKER.test(text)) {
      const [, bullet, box, num, delim] = text.match(LIST_MARKER);
      const marker = bullet ?? `${num}${delim}`;
      const tag = bullet ? 'ul' : 'ol';
      const start = num && Number(num) !== 1 ? String(Number(num)) : null;
      block.after(el(tag, { 'data-tight': 'true', start, dataset: { marker, block: '0' } }, itemEl(marker, box)));
      li = block.nextElementSibling.firstElementChild;
      block.remove();
    } else if (block.tagName === 'LI' && block.parentElement?.tagName === 'UL' && !block.classList.contains('vditor-task')
      && !block.querySelector('ul, ol') && TASK_BOX.test(text)) {
      const marker = block.getAttribute('data-marker') ?? '-';
      typed = `${marker} ${text}`;
      block.after(itemEl(marker, text.match(TASK_BOX)[1]));
      li = block.nextElementSibling;
      block.remove();
    } else return;
    e.preventDefault();
    e.stopImmediatePropagation();
    undo = `${typed} `;
    putCaret(li, li.childNodes.length);
    fireInput(root);
  }, { capture: true });
  host.addEventListener('keydown', (e) => {
    const armed = undo;
    undo = null;
    if (!armed || e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return;
    const root = rootOf();
    const range = getSelection()?.rangeCount ? getSelection().getRangeAt(0) : null;
    const li = range?.endContainer && (range.endContainer.nodeType === 3 ? range.endContainer.parentElement : range.endContainer).closest('li');
    const list = li?.parentElement;
    if (!root || !li || range.toString() !== '' || list.parentElement !== root || textOf(li).trim() !== '' || list.children.length !== 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const p = document.createElement('p');
    p.setAttribute('data-block', '0');
    p.textContent = armed;
    list.replaceWith(p);
    putCaret(p.firstChild, armed.length);
    fireInput(root);
  }, { capture: true });
  host.addEventListener('mousedown', () => { undo = null; }, { capture: true });
}

const tbIcon = (name) => (window.LUCIDE_MOVING?.[name] ?? '').replace(/ data-mi="[^"]*"/g, '');
const WV_TB_ICONS = {
  headings: tbIcon('heading'), bold: tbIcon('bold'), italic: tbIcon('italic'), strike: tbIcon('strikethrough'),
  'inline-code': tbIcon('code'), link: tbIcon('link'),
  list: tbIcon('list'), 'ordered-list': tbIcon('list-ordered'), check: tbIcon('list-checks'),
  outdent: tbIcon('list-indent-decrease'), indent: tbIcon('list-indent-increase'),
  quote: tbIcon('quote'), code: tbIcon('braces'), table: tbIcon('table'), line: tbIcon('minus'),
  undo: tbIcon('undo'), redo: tbIcon('redo'), upload: tbIcon('upload'),
  'wv-insert': tbIcon('plus'), 'wv-done': tbIcon('chevron-down'),
};
const WV_TB_WRITING = {
  'wv-insert': { tip: 'Insert', click: (e, vd) => {
    const r = getSelection()?.rangeCount ? getSelection().getRangeAt(0) : null;
    const before = r ? r.startContainer.textContent.slice(0, r.startOffset) : '';
    document.execCommand('insertText', false, before && !/\s$/.test(before) ? ' /' : '/');
    vd.hint.render(vd);
  } },
  'wv-done': { tip: 'Hide keyboard', click: () => { document.activeElement?.blur(); getSelection()?.removeAllRanges(); } },
};

function guardMathRender() {
  const adapter = window.Vditor?.adapterRender?.mathRenderAdapter;
  const live = globalThis.WeaveEditorLib.liveMathElements;
  if (adapter && adapter.getElements !== live) adapter.getElements = live;
}
function skipCaretOnlyUndo(vditor) {
  const undo = vditor?.undo;
  if (!undo?.addToUndoStack || !undo.addCaret) return;
  const add = undo.addToUndoStack.bind(undo);
  const bare = (html) => String(html ?? '').replace(/<wbr>/g, '').replace(/ vditor-ir__node--expand/g, '')
    .replace(/<span class="doc-ref-raw[^"]*"(?: style="[^"]*")?>([^<]*)<\/span>/g, '$1');
  undo.addToUndoStack = (v) => {
    const mode = undo[v.currentMode];
    if (mode?.undoStack?.length && bare(undo.addCaret(v, true)) === bare(mode.lastText)) return;
    add(v);
  };
}

function mountDocEditor(host, { value, placeholder, onInput: hand, onBlur, autoFocus, entityId, readOnly = false }) {
  guardMathRender();
  const t = vditorTheme();
  let handed = null;
  const stored = (v) => globalThis.WeaveEditorLib.normalizeTaskBoxes(v);
  const onInput = (v) => { handed = stored(v); hand(handed); };
  const pull = () => {
    if (handed === null) return;
    let v;
    try { v = editor.getValue(); } catch { return; }
    if (stored(v) !== handed && !holdsCommandMarker(v)) onInput(v);
  };
  host.addEventListener('focusout', () => { pull(); flushDocSaves(); });
  const chips = attachRefChips(host);
  attachCodeAuto(host);
  attachCodeRawToggle(host);
  attachTableKeys(host);
  attachTabKeys(host);
  attachCodeFenceReturn(host);
  attachListMarkers(host);
  attachHintClamp(host);
  holdDocFrames(host);
  const editor = new Vditor(host, {
    mode: 'ir',
    cdn: '/vendor/vditor',
    value,
    placeholder,
    lang: 'en_US',
    icon: 'ant',
    theme: t.ui,
    minHeight: 160,
    tab: '\t',
    cache: { enable: false },
    counter: { enable: false },
    toolbar: [
      'headings', 'bold', 'italic', 'strike', 'inline-code', 'link', '|',
      'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
      'quote', 'code', 'table', 'line', '|',
      'undo', 'redo', 'upload', 'wv-insert', 'wv-done',
    ].map((n) => (n === '|' ? n : { name: n, icon: WV_TB_ICONS[n], ...WV_TB_WRITING[n] })),
    toolbarConfig: { hide: false, pin: false },
    upload: {
      multiple: true,
      handler: (files) => uploadDocFiles(files, entityId, () => editor, onInput, host),
    },
    outline: { enable: false, position: 'left' },
    preview: {
      markdown: { sanitize: true },
      hljs: { enable: true, style: t.hljs, lineNumber: false },
      theme: { current: t.content, path: '/vendor/vditor/dist/css/content-theme' },
      math: { engine: 'KaTeX' },
    },
    hint: { emoji: window.weaveIconRegistry?.emojiTable() ?? {}, emojiPath: '/vendor/icons', extend: [{ key: '/', hint: slashHint }, { key: '#', hint: entityHint }] },
    after: () => {
      dedupeVditorSprites();
      editor.vditor?.lute?.SetEmojis?.(window.weaveIconRegistry?.emojiTable() ?? {});
      const md = editor.getValue();
      if (new RegExp(globalThis.WeaveEditorLib.ICON_TOKEN.source).test(md)) editor.setValue(md);
      handed = stored(editor.getValue());
      editor.clearStack();
      skipCaretOnlyUndo(editor.vditor);
      aliasBareRefs(editor, onInput);
      scheduleDecorFor(host);
      host.addEventListener('keyup', rememberSelection);
      host.addEventListener('mouseup', rememberSelection);
      host.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        requestAnimationFrame(() =>
          scrollTargetIntoView(host.querySelector('.vditor-hint--current'), { block: 'nearest' }));
      });
      host.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
        keepPlaceThroughEnter(host);
      }, { capture: true });
      host.addEventListener('keydown', (e) => {
        if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
        e.preventDefault();
        e.stopPropagation();
        editor.vditor?.undo?.redo(editor.vditor);
      }, { capture: true });
      host.addEventListener('beforeinput', (e) => {
        const step = { historyUndo: 'undo', historyRedo: 'redo' }[e.inputType];
        if (!step) return;
        e.preventDefault();
        editor.vditor?.undo?.[step](editor.vditor);
      }, { capture: true });
      attachToolbarBubble(host);
      attachFileTools(host, editor, onInput);
      watchCommandMarkers(host, editor, onInput);
      if (readOnly) editor.disabled();
      else if (autoFocus) editor.focus();
    },
    ...(onBlur ? { blur: () => onBlur() } : {}),
    input: (v) => {
      if (holdsCommandMarker(v)) return applyCommandMarkers(host, editor, onInput);
      onInput(v);
      scheduleDecorFor(host);
    },
  });
  docPulls.set(editor, pull);
  liveEditors.add(editor);
  return editor;
}

function attachToolbarBubble(host) {
  const st = { host };
  st.place = () => placeToolbarBubble(st);
  st.schedule = () => queueMicrotask(st.place);
  for (const ev of ['focusin', 'focusout']) host.addEventListener(ev, st.schedule);
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
  const inBar = bar.contains(document.activeElement) || bar.matches(':hover');
  const docked = dockCoversScreen.matches;
  const inRoot = range && root.contains(range.startContainer) && root.contains(range.endContainer);
  const picked = inRoot && !range.collapsed;
  const caret = docked && !picked && root.contains(document.activeElement);
  const on = picked || caret || (inBar && bar.classList.contains('wv-show'));
  bar.classList.toggle('wv-show', !!on);
  bar.classList.toggle('wv-bar-caret', !!caret);
  bar.classList.toggle('wv-bar-dock', docked);
  if (docked) {
    const keyboard = keyboardInset();
    bar.style.left = '';
    bar.style.top = '';
    bar.style.bottom = `${keyboard}px`;
    return;
  }
  bar.style.bottom = '';
  if (!on || inBar) return;
  const r = range.getBoundingClientRect();
  const base = st.host.getBoundingClientRect();
  const barW = bar.offsetWidth, barH = bar.offsetHeight;
  const left = Math.max(0, Math.min(base.width - barW, r.left - base.left + r.width / 2 - barW / 2));
  const above = r.top - base.top - barH - 8;
  bar.style.left = `${left}px`;
  bar.style.top = `${above >= 0 ? above : r.bottom - base.top + 8}px`;
}

document.addEventListener('selectionchange', () => {
  for (const st of docBubbles) queueMicrotask(st.place);
});
for (const ev of ['resize', 'scroll']) {
  window.visualViewport?.addEventListener(ev, () => {
    for (const st of docBubbles) st.place();
  });
}

let docUploadSeq = 0;
const DOC_UPLOAD_INPUT = '.vditor-toolbar [data-type="upload"] input[type="file"]';
function docUploadStrip(host) {
  if (host.uploadStrip?.isConnected) return host.uploadStrip;
  host.uploadKey ??= `doc:${++docUploadSeq}`;
  const strip = el('div', { class: 'doc-uploads attach-chips' });
  host.after(strip);
  host.uploadStrip = uploadHost(strip, host.uploadKey);
  return strip;
}

async function uploadDocFiles(files, entityId, getEditor, onInput, host = null) {
  if (!entityId) return 'This document has no record to attach to';
  const input = host?.querySelector(DOC_UPLOAD_INPUT);
  if (input) input.value = '';
  const key = host?.parentNode ? docUploadStrip(host).dataset.uploadKey : `doc:${entityId}`;
  const seen = api('GET', `/entities/${entityId}`).then((e) => new Set((e.files ?? []).map((x) => x.id)), () => new Set());
  const mine = new Set();
  uploadState(key).ctl = {
    send: (f, progress) => streamUpload(`/entities/${entityId}/files`, { entity: entityId, file: f }, progress),
    known: () => seen.then((ids) => new Set([...ids, ...mine])),
    found: (f, before) => landedFile(entityId, f, before),
    landed: (f, meta) => {
      mine.add(meta.id);
      const url = `${WS_PREFIX}/api/files/${meta.id}`;
      const mime = f.type || '';
      const md = /^image\/(png|jpeg|gif|webp)$/.test(mime) ? `![](${url})`
        : mime === 'application/pdf'
          ? `\n<iframe class="wv-file" src="${url}" title="${escapeHtmlText(f.name)}"></iframe>\n`
          : `[${f.name}](${url})`;
      getEditor().insertValue(md + '\n');
    },
    refresh: async () => onInput?.(getEditor().getValue()),
    choose: host ? () => host.querySelector(DOC_UPLOAD_INPUT)?.click() : null,
  };
  await runUploads(key, [...files]);
  return null;
}

const BARE_FILE_FRAME = /^(?:\/w\/[^/?#]+)?\/api\/files\/[\w-]+$/;
function holdDocFrames(host) {
  const hold = (frame) => {
    frame.removeAttribute('allow');
    if (BARE_FILE_FRAME.test(frame.getAttribute('src') ?? '') || frame.getAttribute('sandbox') === HTML_FRAME_SANDBOX) return;
    frame.setAttribute('sandbox', HTML_FRAME_SANDBOX);
    if (frame.hasAttribute('src')) frame.setAttribute('src', frame.getAttribute('src'));
  };
  new MutationObserver((records) => {
    for (const { addedNodes } of records) {
      for (const n of addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'IFRAME') hold(n);
        else n.querySelectorAll('iframe').forEach(hold);
      }
    }
  }).observe(host, { childList: true, subtree: true });
}

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

const refResolveCache = new Map();

function scheduleDecorFor(host) {
  for (const s of DOC_DECOR.flatMap((set) => [...set])) {
    if (s.host === host) s.schedule();
  }
}

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
    if ((st.tries = (st.tries ?? 0) + 1) < 20) st.schedule();
    return;
  }
  let applied = false;
  for (const code of st.host.querySelectorAll('.vditor-ir__preview > code')) {
    const ours = code.dataset.autoLang;
    if (!ours && /language-\S/.test(code.className)) continue;
    const text = code.textContent ?? '';
    const answered = code.dataset.autoFor === text;
    if (answered && (!ours || code.querySelector('span'))) continue;
    code.dataset.autoFor = text;
    const lang = globalThis.WeaveEditorLib?.detectCodeLanguage(text);
    if (!lang) { delete code.dataset.autoLang; continue; }
    try {
      code.innerHTML = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      code.classList.add('hljs', `language-${lang}`);
      code.dataset.autoLang = lang;
      applied = true;
    } catch {}
  }
  if (applied && (st.rechecks = (st.rechecks ?? 0) + 1) <= 3) st.schedule();
  else if (!applied) st.rechecks = 0;
}

const codeRawNode = (host) =>
  host.querySelector('.vditor-ir .vditor-reset .vditor-ir__node--expand[data-type="code-block"]');
const codeRawIsDrawing = (node) => !node.querySelector(':scope > .vditor-ir__preview > code');

function setCodeRaw(st, on) {
  st.host.classList.toggle('wv-code-raw', on);
  st.btn.setAttribute('aria-pressed', String(on));
  st.btn.title = on ? 'Hide markdown source' : 'Show markdown source';
  st.place();
}

function attachCodeRawToggle(host) {
  const btn = el('button', { type: 'button', class: 'doc-code-raw', 'aria-pressed': 'false', title: 'Show markdown source' },
    iconEl('lucide:code-xml', 'wv-icon'));
  const st = { host, btn, key: -1, timer: 0 };
  st.place = () => placeCodeRaw(st);
  st.schedule = () => queueMicrotask(st.place);
  st.stop = () => {
    st.dead = true;
    clearTimeout(st.timer);
    btn.remove();
    host.classList.remove('wv-code-raw');
  };
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => setCodeRaw(st, !host.classList.contains('wv-code-raw')));
  host.addEventListener('click', st.schedule);
  host.addEventListener('keyup', st.schedule);
  host.addEventListener('focusout', () => { clearTimeout(st.timer); st.timer = setTimeout(st.place); });
  host.addEventListener('keydown', (e) => {
    if (e.isComposing || e.altKey || ((e.metaKey || e.ctrlKey) && e.key !== 'v')) return;
    if (e.key.length !== 1 && !['Enter', 'Backspace', 'Delete', 'Tab'].includes(e.key)) return;
    const node = codeRawNode(host);
    if (node && codeRawIsDrawing(node) && !host.classList.contains('wv-code-raw')) setCodeRaw(st, true);
  }, { capture: true });
  docCodeRaw.add(st);
  return st;
}

function placeCodeRaw(st) {
  if (st.dead) return;
  if (!document.body.contains(st.host)) { docCodeRaw.delete(st); return; }
  const node = codeRawNode(st.host);
  const key = node ? [...node.parentElement.querySelectorAll(':scope > [data-type="code-block"]')].indexOf(node) : -1;
  if (key !== st.key) {
    st.key = key;
    if (st.host.classList.contains('wv-code-raw')) { setCodeRaw(st, false); return; }
  }
  const panel = node && [...node.querySelectorAll(':scope > pre')].find((p) => p.getClientRects().length);
  if (!panel) { st.btn.remove(); return; }
  if (!st.btn.isConnected) st.host.append(st.btn);
  const r = panel.getBoundingClientRect();
  const base = st.host.getBoundingClientRect();
  st.btn.style.top = `${r.top - base.top + 6}px`;
  st.btn.style.right = `${base.right - r.right + 6}px`;
}

function attachRefChips(host) {
  const st = { host, layer: el('div', { class: 'doc-ref-layer' }), timer: 0, expanded: new WeakSet(), wrapOfSlot: new WeakMap() };
  st.schedule = () => {
    clearTimeout(st.timer);
    st.timer = setTimeout(() => refreshRefChips(st), REF_CHIP_DEBOUNCE);
  };
  refChipLayers.add(st);
  return st;
}

document.addEventListener('selectionchange', () => {
  for (const st of refChipLayers) st.schedule();
});
async function refreshRefChips(st) {
  if (!document.body.contains(st.host)) { refChipLayers.delete(st); return; }
  const root = st.host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return;
  if (!st.layer.isConnected) st.host.append(st.layer);
  const lib = globalThis.WeaveEditorLib;

  const wholeRef = (w) => {
    const found = lib.findRefSpans(w.textContent);
    return found.length === 1 && found[0].start === 0 && found[0].end === w.textContent.length && !w.querySelector('*') ? found[0] : null;
  };
  for (const w of root.querySelectorAll('.doc-ref-raw')) if (!wholeRef(w)) w.replaceWith(...w.childNodes);
  root.normalize();

  const spans = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const codeCtx = n.parentElement?.closest(lib.REF_SKIP_SELECTOR);
    if (codeCtx && codeCtx !== root) continue;
    if (n.parentElement.classList.contains('doc-ref-raw')) continue;
    for (const s of lib.findRefSpans(n.nodeValue)) spans.push({ node: n, text: n.nodeValue, ...s });
  }
  const wraps = () => [...root.querySelectorAll('.doc-ref-raw')].map((w) => ({ w, ...wholeRef(w) }));

  await resolveRefs([...spans, ...wraps()].map((s) => s.ref));
  if (!document.body.contains(st.layer)) return;

  const sel = getSelection();
  const caret = sel?.rangeCount ? sel.getRangeAt(0) : null;
  for (const s of spans.reverse()) {
    const n = s.node;
    if (!refResolveCache.get(s.ref) || !n.isConnected || n.parentElement.classList.contains('doc-ref-raw')) continue;
    if (n.nodeValue.slice(s.start, s.end) !== s.text.slice(s.start, s.end)) continue;
    if (caret?.startContainer === n && caret.startOffset >= s.start && caret.startOffset <= s.end) continue;
    if (s.end < n.length) n.splitText(s.end);
    const mid = s.start > 0 ? n.splitText(s.start) : n;
    const w = el('span', { class: 'doc-ref-raw' });
    mid.before(w);
    w.append(mid);
  }

  const focusedCaret = document.activeElement?.closest?.('.doc-ref-slot .mention-caret');
  const focusedWrap = focusedCaret && st.wrapOfSlot.get(focusedCaret.closest('.doc-ref-slot'));
  st.layer.replaceChildren();
  const drawn = [];
  for (const { w, ref, label } of wraps()) {
    const hit = ref && refResolveCache.get(ref);
    if (!hit) { w.replaceWith(...w.childNodes); continue; }
    const open = !!caret && w.contains(caret.startContainer);
    w.classList.toggle('open', open);
    if (open) { w.removeAttribute('style'); continue; }
    const slot = el('span', { class: 'doc-ref-slot wv-prose' });
    slot.append(hit.chip.cloneNode(true));
    if (label) {
      const k = slot.querySelector('.k-label');
      if (k) k.textContent = label;
    }
    if (st.expanded.has(w)) {
      slot.querySelector('.k-rel')?.classList.add('open');
      slot.querySelector('.mention-caret')?.setAttribute('aria-expanded', 'true');
    }
    slot.addEventListener('click', (ev) => {
      if (!ev.target.closest('.mention-caret')) return;
      if (!st.expanded.delete(w)) st.expanded.add(w);
      refreshRefChips(st);
    });
    st.wrapOfSlot.set(slot, w);
    st.layer.append(slot);
    drawn.push({ w, slot });
  }
  for (const d of drawn) {
    const box = d.w.parentElement.closest('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote') ?? root;
    const cs = getComputedStyle(box);
    const r = d.slot.getBoundingClientRect();
    d.width = Math.min(r.width, box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    d.height = r.height;
  }
  for (const d of drawn) d.w.style.cssText = `width:${d.width}px; height:${d.height}px;`;
  const base = st.layer.getBoundingClientRect();
  for (const d of drawn) {
    const r = d.w.getBoundingClientRect();
    d.slot.style.cssText = `left:${r.left - base.left}px; top:${r.top - base.top}px; width:${r.width}px;`;
    const lab = d.slot.querySelector('.k-rel:not(.open) .k-label');
    if (lab) lab.style.maxWidth = '';
    d.slot.classList.toggle('long', d.slot.scrollWidth > r.width + 1);
    if (lab && d.slot.classList.contains('long')) lab.style.maxWidth = `${Math.max(0, lab.offsetWidth - (d.slot.scrollWidth - r.width))}px`;
    if (d.w === focusedWrap) d.slot.querySelector('.mention-caret')?.focus({ preventScroll: true });
  }
}

async function aliasBareRefs(editor, onInput) {
  const lib = globalThis.WeaveEditorLib;
  const md = editor.getValue();
  const bare = lib.findRefSpans(md).filter((s) => s.label == null).map((s) => s.ref);
  if (!bare.length) return;
  await resolveRefs(bare);
  const next = lib.aliasRefSpans(md, (ref) => refResolveCache.get(ref)?.label ?? null);
  if (next === md) return;
  editor.setValue(next);
  editor.clearStack();
  onInput(next);
}

async function resolveRefs(refs) {
  const missing = [...new Set(refs)].filter((r) => !refResolveCache.has(r));
  if (!missing.length) return;
  try {
    const { html } = await api('POST', '/markdown', { md: missing.map((r) => `[[${r}]]`).join('\n\n') });
    const box = document.createElement('div');
    box.innerHTML = html;
    const paras = [...box.children];
    missing.forEach((ref, i) => {
      const chip = paras[i]?.querySelector('.k-rel');
      const a = chip?.querySelector('a.mention');
      if (!a) return refResolveCache.set(ref, null);
      const ent = a.getAttribute('href').match(/\/e\/([^/]+)\/doc\.html$/);
      if (ent) a.setAttribute('href', `#/entity/${ent[1]}`);
      const kind = [...a.classList].find((c) => c.startsWith('mention-'))?.slice('mention-'.length) ?? 'entity';
      refResolveCache.set(ref, {
        href: a.getAttribute('href'), chip, kind,
        label: a.dataset.name ?? a.textContent, title: a.title || a.textContent,
      });
    });
  } catch {}
}

function watchCommandMarkers(host, editor, onInput) {
  const root = host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return;
  const marked = (n) => holdsCommandMarker(n.textContent);
  new MutationObserver((records) => {
    if (records.some((r) => marked(r.target) || [...r.addedNodes].some(marked))) applyCommandMarkers(host, editor, onInput);
  }).observe(root, { childList: true, characterData: true, subtree: true });
}

function applyCommandMarkers(host, editor, onInput) {
  const v = editor.getValue();
  const ref = v.match(REF_MARKER_RE);
  if (ref) return pickReference(editor, v, ref[0], ref[1], onInput);
  if (globalThis.WeaveEditorLib.BLOCK_MARKER_RE.test(v)) return convertBlockLine(host, editor, onInput);
  for (const [marker, block] of Object.entries(DEFERRED_INSERTS)) {
    if (!v.includes(marker)) continue;
    if (block.select) return insertSelecting(host, editor, onInput, v.replace(marker, block.md), block.select);
    const next = v.replace(marker, block);
    editor.setValue(next);
    editor.focus();
    onInput(next);
    return;
  }
}

const CARET_SENTINEL = '\u2063caret\u2063';
function convertBlockLine(host, editor, onInput) {
  const md = editor.getValue();
  const next = globalThis.WeaveEditorLib.convertMarkedLine(md);
  if (!next) return;
  let token = md.match(globalThis.WeaveEditorLib.BLOCK_MARKER_RE)[0];
  if (next.line >= 0) {
    token = CARET_SENTINEL;
    const lines = next.md.split('\n');
    const line = lines[next.line];
    const at = line.length - next.select.length;
    lines[next.line] = line.slice(0, at) + token + line.slice(at);
    editor.setValue(lines.join('\n'));
  }
  if (!caretToToken(host, token, next.select.length)) { editor.setValue(next.md); editor.focus(); }
  onInput(editor.getValue());
  scheduleDecorFor(host);
}

function insertSelecting(host, editor, onInput, md, select) {
  const at = md.indexOf(select);
  editor.setValue(md.slice(0, at) + CARET_SENTINEL + md.slice(at));
  if (!caretToToken(host, CARET_SENTINEL, select.length)) { editor.setValue(md); editor.focus(); }
  onInput(editor.getValue());
  scheduleDecorFor(host);
}

function caretToToken(host, token, extend = 0) {
  const root = host.querySelector('.vditor-ir .vditor-reset');
  if (!root) return false;
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let spot = null;
  for (let n = texts.nextNode(); n; n = texts.nextNode()) {
    const at = n.data.indexOf(token);
    if (at < 0) continue;
    n.deleteData(at, token.length);
    spot ??= { node: n, at };
  }
  if (!spot) return false;
  root.focus({ preventScroll: true });
  const range = document.createRange();
  range.setStart(spot.node, spot.at);
  range.setEnd(spot.node, Math.min(spot.at + extend, spot.node.length));
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

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
  openPalette({
    kinds,
    placeholder,
    onPick: (hit) => settle(referenceFor(kind, hit)),
    onDismiss: () => settle(''),
  });
}

const crepeMarkdown = (md) => String(md ?? '').replace(/\\\[\\\[/g, '[[').replace(/\[\[([^[\]\n]*?)\\\]\\\]/g, '[[$1]]');

const CREPE_REF_RE = /\[\[([^[\]\n]+)\]\]/g;

const CREPE_REF_ICONS = {
  entity: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M5 9h14M5 15h14M11 4 7 20M17 4l-4 16"/></svg>',
  table: '<svg viewBox="0 0 24 24"><rect fill="none" stroke="currentColor" stroke-width="2" x="4" y="4" width="16" height="16" rx="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M4 10h16M10 4v16"/></svg>',
  space: '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>',
};

function crepePickReference(view, from, to, kind) {
  const { kinds, placeholder } = REF_KINDS[kind] ?? REF_KINDS.entity;
  openPalette({
    kinds,
    placeholder,
    onPick: (hit) => {
      view.dispatch(view.state.tr.insertText(referenceFor(kind, hit), from, to));
      view.focus();
    },
    onDismiss: () => view.focus(),
  });
}

function referencesPlugin(M) {
  const key = new M.PluginKey('weave-references');
  const chip = (hit) => {
    const span = document.createElement('span');
    span.className = 'wv-ref-chip';
    span.contentEditable = 'false';
    span.append(hit.chip.cloneNode(true));
    return span;
  };
  const decorate = (state) => {
    const { from: a, to: b } = state.selection;
    const decos = [];
    state.doc.descendants((node, pos) => {
      if (!node.isText || node.marks.some((m) => m.type.name === 'inlineCode')) return;
      for (const m of node.text.matchAll(CREPE_REF_RE)) {
        const from = pos + m.index;
        const to = from + m[0].length;
        const hit = refResolveCache.get(m[1]);
        if (!hit || (a <= to && b >= from)) continue;
        decos.push(M.Decoration.widget(from, () => chip(hit), { side: -1, key: `${m[1]}@${from}`, ignoreSelection: true }));
        decos.push(M.Decoration.inline(from, to, { class: 'wv-ref-src' }));
      }
    });
    return M.DecorationSet.create(state.doc, decos);
  };
  const unresolved = (doc) => {
    const refs = new Set();
    doc.descendants((node) => {
      if (!node.isText) return;
      for (const m of node.text.matchAll(CREPE_REF_RE)) if (!refResolveCache.has(m[1])) refs.add(m[1]);
    });
    return [...refs];
  };
  return new M.Plugin({
    key,
    props: {
      decorations: decorate,
      handleTextInput(view, from, to, text) {
        if (text !== '[' || view.state.doc.textBetween(Math.max(0, from - 1), from) !== '[') return false;
        view.dispatch(view.state.tr.insertText(text, from, to));
        crepePickReference(view, from - 1, from + 1, 'entity');
        return true;
      },
    },
    view: (view) => {
      let live = true;
      const resolve = () => {
        const refs = unresolved(view.state.doc);
        if (!refs.length) return;
        resolveRefs(refs).then(() => { if (live) view.dispatch(view.state.tr.setMeta(key, 'resolved')); });
      };
      resolve();
      return {
        update: (v, prev) => { if (!prev.doc.eq(v.state.doc)) resolve(); },
        destroy: () => { live = false; },
      };
    },
  });
}

function blockMarksPlugin(M, key) {
  return new M.Plugin({
    key,
    state: { init: () => [], apply: (tr, marks) => tr.getMeta(key) ?? marks },
    props: {
      decorations(state) {
        const marks = key.getState(state);
        const decos = [];
        let i = 0;
        state.doc.forEach((node, pos) => {
          const cls = marks[i++];
          if (cls) decos.push(M.Decoration.node(pos, pos + node.nodeSize, { class: cls }));
        });
        return M.DecorationSet.create(state.doc, decos);
      },
    },
  });
}

function crepeDividerBelow(M) {
  return (ctx) => {
    const view = ctx.get(M.editorViewCtx);
    const { state } = view;
    const { $from } = state.selection;
    const { hr, paragraph } = state.schema.nodes;
    const from = $from.before();
    const tr = state.tr.replaceWith(from, $from.after(), [hr.create(), paragraph.create()]);
    view.dispatch(tr.setSelection(M.TextSelection.create(tr.doc, from + 2)));
    view.focus();
  };
}

let crepeMenuScrollFrom = null;
const crepeMenuList = () => document.querySelector('.wv-crepe .milkdown-slash-menu[data-show="true"] .menu-groups');
addEventListener('keydown', (e) => {
  const list = (e.key === 'ArrowDown' || e.key === 'ArrowUp') && crepeMenuList();
  crepeMenuScrollFrom = list ? list.scrollTop : null;
}, true);
addEventListener('keydown', (e) => {
  const list = crepeMenuScrollFrom === null ? null : crepeMenuList();
  const from = crepeMenuScrollFrom;
  crepeMenuScrollFrom = null;
  if (!list) return;
  const rows = [...list.querySelectorAll('.menu-group li')];
  const at = rows.findIndex((li) => li.classList.contains('hover'));
  const row = rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))];
  if (!row) return;
  const group = row.closest('.menu-group');
  const top = (row === group.querySelector('li') ? group.offsetTop : row.offsetTop) - list.offsetTop;
  const bottom = row.offsetTop - list.offsetTop + row.offsetHeight;
  list.scrollTop = top < from ? top : bottom > from + list.clientHeight ? bottom - list.clientHeight : from;
});

const CREPE_HOLD_MS = 400;
let crepeScrolledAt = -Infinity;
for (const type of ['wheel', 'touchstart', 'pointerdown']) {
  addEventListener(type, () => { crepeScrolledAt = performance.now(); }, { capture: true, passive: true });
}
addEventListener('keydown', (e) => { if (e.key === 'PageUp' || e.key === 'PageDown') crepeScrolledAt = performance.now(); }, true);
const CREPE_HOLD_DRIFT_PX = 40;
function holdScrollPlugin(M, host) {
  return new M.Plugin({
    view: () => ({
      update: (view, prev) => {
        if (prev.doc.eq(view.state.doc) && prev.selection.eq(view.state.selection)) return;
        const scroller = editorScroller(host);
        if (!scroller) return;
        const held = scrollTopOf(scroller);
        const box = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
        const caret = view.coordsAtPos(view.state.selection.head);
        if (caret.top < box.top || caret.bottom > box.bottom) return;
        const at = performance.now();
        const pin = () => {
          if (performance.now() - at > CREPE_HOLD_MS || crepeScrolledAt > at) return;
          if (Math.abs(scrollTopOf(scroller) - held) > CREPE_HOLD_DRIFT_PX) putScrollTop(scroller, held);
          requestAnimationFrame(pin);
        };
        requestAnimationFrame(pin);
      },
    }),
  });
}

function crepeReferenceMenu(M) {
  return (builder) => {
    const divider = builder.getGroup('text').group.items.find((item) => item.key === 'divider');
    if (divider) divider.onRun = crepeDividerBelow(M);
    const group = builder.addGroup('reference', 'Reference');
    for (const [kind, label] of [['entity', 'Entity'], ['table', 'Table'], ['space', 'Space / workspace']]) {
      group.addItem(kind, {
        label,
        icon: CREPE_REF_ICONS[kind],
        onRun: (ctx) => {
          const view = ctx.get(M.editorViewCtx);
          const { $from } = view.state.selection;
          const start = $from.start();
          const slash = view.state.doc.textBetween(start, $from.pos).lastIndexOf('/');
          const at = slash < 0 ? $from.pos : start + slash;
          view.dispatch(view.state.tr.delete(at, $from.pos));
          crepePickReference(view, at, at, kind);
        },
      });
    }
  };
}

let crepeCellClick = null;
function crepeCellCaret(M, crepe, root) {
  root.addEventListener('mousedown', (e) => {
    const cell = e.target.closest?.('td, th');
    if (!cell || e.button !== 0 || e.shiftKey || e.detail > 1 || !cell.closest('.ProseMirror')) return;
    const text = cell.querySelector('p') ?? cell;
    const range = document.createRange();
    range.selectNodeContents(text);
    if ([...range.getClientRects()].some((r) => e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top && e.clientY <= r.bottom)) return;
    const view = crepe.editor.ctx.get(M.editorViewCtx);
    e.preventDefault();
    e.stopPropagation();
    view.focus();
    view.dispatch(view.state.tr.setSelection(M.TextSelection.create(view.state.doc, view.posAtDOM(text, text.childNodes.length))));
  }, true);
  root.addEventListener('mousedown', (e) => {
    crepeCellClick = e.button === 0 && e.target.closest?.('td, th') ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
  }, true);
}

function cellClicksPlugin(M) {
  let view = null;
  return new M.Plugin({
    view: (v) => { view = v; return {}; },
    appendTransaction: (trs, old, state) => {
      const click = crepeCellClick;
      if (!click || !view || performance.now() - click.at > 800 || !state.selection.node?.isTextblock) return null;
      const at = view.posAtCoords({ left: click.x, top: click.y });
      return at ? state.tr.setSelection(M.TextSelection.create(state.doc, at.pos)) : null;
    },
    props: {
      handleKeyDown(view, e) {
        if ((e.key !== 'End' && e.key !== 'Home') || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
        const { $head, empty } = view.state.selection;
        if (!empty) return false;
        let inCell = false;
        for (let d = $head.depth; d > 0; d--) if (/^table_(cell|header)$/.test($head.node(d).type.name)) inCell = true;
        if (!inCell || !$head.parent.isTextblock) return false;
        const pos = e.key === 'End' ? $head.end() : $head.start();
        view.dispatch(view.state.tr.setSelection(M.TextSelection.create(view.state.doc, pos)));
        return true;
      },
    },
  });
}

function crepeSourceKeeper(M, ctx, source) {
  const doc = ctx.get(M.editorViewCtx).state.doc;
  const blocks = ctx.get(M.remarkCtx).parse(source).children.filter((n) => n.position);
  if (blocks.length !== doc.childCount) return () => null;
  const was = [];
  doc.forEach((n) => was.push(n));
  const spans = blocks.map((b) => [b.position.start.offset, b.position.end.offset]);
  const serialize = ctx.get(M.serializerCtx);
  return (next, clean) => {
    const now = [];
    next.forEach((n) => now.push(n));
    let head = 0;
    while (head < now.length && head < was.length && now[head].eq(was[head])) head++;
    let tail = 0;
    while (tail < now.length - head && tail < was.length - head && now[now.length - 1 - tail].eq(was[was.length - 1 - tail])) tail++;
    if (head === now.length && head === was.length) return source;
    const mid = now.slice(head, now.length - tail);
    const parts = [];
    if (head) parts.push(source.slice(0, spans[head - 1][1]));
    if (mid.length) parts.push(clean(serialize(next.type.create(null, mid))).replace(/\n+$/, ''));
    if (tail) parts.push(source.slice(spans[was.length - tail][0]));
    const end = tail ? '' : (was.length ? source.slice(spans[was.length - 1][1]) : '\n') || '\n';
    return parts.join('\n\n') + end;
  };
}

const crepeReferences = (M) => M.$prose(() => referencesPlugin(M));
const crepeBlockMarks = (M, key) => M.$prose(() => blockMarksPlugin(M, key));
const crepeHoldScroll = (M, host) => M.$prose(() => holdScrollPlugin(M, host));
const crepeCellClicks = (M) => M.$prose(() => cellClicksPlugin(M));

function mountCrepeEditor(host, { value, entityId, placeholder, onInput: hand, onBlur, autoFocus, readOnly = false }) {
  const M = globalThis.WeaveCrepe;
  const stored = (v) => globalThis.WeaveEditorLib.normalizeTaskBoxes(crepeMarkdown(v));
  const root = document.createElement('div');
  root.className = 'wv-crepe';
  host.append(root);
  let handed = stored(value ?? '');
  let ready = false;
  let keep = () => null;
  const keepFrom = (source) => crepe.editor.action((ctx) => { keep = crepeSourceKeeper(M, ctx, source); });
  const current = () => keep(crepe.editor.ctx.get(M.editorViewCtx).state.doc, stored) ?? stored(crepe.getMarkdown());
  const crepe = new M.Crepe({
    root,
    defaultValue: value ?? '',
    features: { [M.Crepe.Feature.AI]: false, [M.Crepe.Feature.TopBar]: false },
    featureConfigs: {
      [M.Crepe.Feature.Placeholder]: { text: placeholder ?? '', mode: 'doc' },
      [M.Crepe.Feature.BlockEdit]: { buildMenu: crepeReferenceMenu(M) },
      [M.Crepe.Feature.ImageBlock]: {
        onUpload: (file) => streamUpload(`/entities/${entityId}/files`, { entity: entityId, file }).then((meta) => `${WS_PREFIX}/api/files/${meta.id}`),
      },
    },
  });
  crepe.editor.use(crepeReferences(M));
  crepe.editor.use(crepeHoldScroll(M, host));
  crepe.editor.use(crepeCellClicks(M));
  const marksKey = new M.PluginKey('weave-block-marks');
  crepe.editor.use(crepeBlockMarks(M, marksKey));
  crepe.editor.config((ctx) => ctx.update(M.remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: '-', rule: '-' })));
  crepe.on((l) => {
    l.markdownUpdated(() => {
      if (!ready) return;
      const v = current();
      if (v === handed) return;
      handed = v;
      hand(v);
    });
    if (onBlur) l.blur(() => onBlur());
  });
  const editor = {
    crepe,
    getValue: () => (ready ? current() : handed),
    setValue: (md) => {
      handed = stored(md);
      if (!ready) return;
      crepe.editor.action(M.replaceAll(md));
      keepFrom(md);
    },
    insertValue: (md) => {
      if (!ready) return;
      crepe.editor.action(M.insert(md));
      crepe.editor.action((ctx) => {
        const view = ctx.get(M.editorViewCtx);
        const { selection: sel, doc } = view.state;
        if (sel.node) view.dispatch(view.state.tr.setSelection(M.TextSelection.near(doc.resolve(sel.to))));
      });
    },
    focus: () => root.querySelector('.ProseMirror')?.focus(),
    setTheme: () => {},
    destroy: () => { liveEditors.delete(editor); crepe.destroy(); root.remove(); },
  };
  root.weaveMarkBlocks = (marks) => {
    if (!ready) return;
    const view = crepe.editor.ctx.get(M.editorViewCtx);
    const now = marksKey.getState(view.state);
    if (now.length === marks.length && now.every((m, i) => m === marks[i])) return;
    view.dispatch(view.state.tr.setMeta(marksKey, marks));
  };
  crepe.create().then(() => {
    ready = true;
    keepFrom(value ?? '');
    scheduleDecorFor(host);
    if (readOnly) crepe.setReadonly(true);
    else if (autoFocus) editor.focus();
  });
  crepeCellCaret(M, crepe, root);
  const takeFiles = (e, data) => {
    if (readOnly || !data?.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    uploadDocFiles(data.files, entityId, () => editor, hand, host);
  };
  root.addEventListener('paste', (e) => takeFiles(e, e.clipboardData), true);
  root.addEventListener('drop', (e) => takeFiles(e, e.dataTransfer), true);
  host.addEventListener('focusout', () => {
    if (!ready) return;
    const v = current();
    if (v !== handed) { handed = v; hand(v); }
    flushDocSaves();
  });
  docPulls.set(editor, () => {
    if (!ready) return;
    const v = current();
    if (v !== handed) { handed = v; hand(v); }
  });
  liveEditors.add(editor);
  return editor;
}

const TIPTAP_SLASH = [
  { group: 'Basic', key: 'text', label: 'Text', glyph: 'T', aliases: ['paragraph', 'plain'], run: (c) => c.setParagraph() },
  { group: 'Basic', key: 'h1', label: 'Heading 1', glyph: 'H1', aliases: ['title', 'h1'], run: (c) => c.setHeading({ level: 1 }) },
  { group: 'Basic', key: 'h2', label: 'Heading 2', glyph: 'H2', aliases: ['subtitle', 'h2'], run: (c) => c.setHeading({ level: 2 }) },
  { group: 'Basic', key: 'h3', label: 'Heading 3', glyph: 'H3', aliases: ['h3'], run: (c) => c.setHeading({ level: 3 }) },
  { group: 'Basic', key: 'quote', label: 'Quote', glyph: '❝', aliases: ['blockquote', 'cite'], run: (c) => c.toggleBlockquote() },
  { group: 'Lists', key: 'bullet', label: 'Bullet list', glyph: '•', aliases: ['ul', 'list', 'unordered'], run: (c) => c.toggleBulletList() },
  { group: 'Lists', key: 'ordered', label: 'Numbered list', glyph: '1.', aliases: ['ol', 'ordered', 'number'], run: (c) => c.toggleOrderedList() },
  { group: 'Lists', key: 'task', label: 'Task list', glyph: '☐', aliases: ['todo', 'checkbox', 'check'], run: (c) => c.toggleTaskList() },
  { group: 'Insert', key: 'divider', label: 'Divider', glyph: '—', aliases: ['hr', 'rule', 'line', 'separator'], run: (c) => c.insertContent([{ type: 'horizontalRule' }, { type: 'paragraph' }]) },
  { group: 'Insert', key: 'code', label: 'Code block', glyph: '{ }', aliases: ['pre', 'fence', 'snippet'], run: (c) => c.toggleCodeBlock() },
  { group: 'Insert', key: 'table', label: 'Table', glyph: '▦', aliases: ['grid'], run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { group: 'Insert', key: 'file', label: 'Image or file', glyph: '↑', aliases: ['upload', 'image', 'picture', 'photo', 'attach'], file: true },
  { group: 'Reference', key: 'entity', label: 'Entity', icon: CREPE_REF_ICONS.entity, aliases: ['record', 'row', 'mention', 'link entity'], ref: 'entity' },
  { group: 'Reference', key: 'table-ref', label: 'Table', icon: CREPE_REF_ICONS.table, aliases: ['database', 'link table'], ref: 'table' },
  { group: 'Reference', key: 'space', label: 'Space / workspace', icon: CREPE_REF_ICONS.space, aliases: ['link space', 'workspace'], ref: 'space' },
];

function tiptapSlashItems(query) {
  const q = query.toLowerCase().trim();
  if (!q) return TIPTAP_SLASH;
  return TIPTAP_SLASH.filter((i) => [i.label, ...i.aliases].some((w) => w.toLowerCase().includes(q)));
}

function tiptapSlashMenu() {
  let box = null;
  let items = [];
  let at = 0;
  let pick = () => {};
  const keepInView = () => {
    const row = box.querySelector('.wv-slash-row.on');
    if (!row) return;
    const head = row.previousElementSibling?.classList.contains('wv-slash-group') ? row.previousElementSibling : row;
    if (head.offsetTop < box.scrollTop) box.scrollTop = head.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
  };
  const paint = () => {
    const rows = [];
    let group = null;
    items.forEach((item, i) => {
      if (item.group !== group) {
        group = item.group;
        rows.push(el('div', { class: 'wv-slash-group' }, group));
      }
      const mark = el('span', { class: 'wv-slash-mark' });
      if (item.icon) mark.append(new DOMParser().parseFromString(item.icon, 'image/svg+xml').documentElement);
      else mark.textContent = item.glyph;
      rows.push(el('div', {
        class: 'wv-slash-row' + (i === at ? ' on' : ''),
        role: 'option',
        'aria-selected': i === at ? 'true' : 'false',
        onmousedown: (e) => e.preventDefault(),
        onmousemove: () => { if (at !== i) { at = i; paint(); } },
        onclick: () => pick(item),
      }, mark, el('span', { class: 'wv-slash-label' }, item.label)));
    });
    if (!items.length) rows.push(el('div', { class: 'wv-slash-empty' }, 'No matching block'));
    box.replaceChildren(...rows);
    keepInView();
  };
  const place = (rect) => {
    const r = rect?.();
    if (!r) return;
    const h = box.offsetHeight;
    const below = innerHeight - r.bottom;
    box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8))}px`;
    box.style.top = `${below >= h + 12 || r.top < h + 12 ? r.bottom + 6 : r.top - h - 6}px`;
  };
  return {
    onStart: (p) => {
      box = el('div', { class: 'wv-slash', role: 'listbox' });
      document.body.append(box);
      items = p.items;
      pick = p.command;
      at = 0;
      paint();
      place(p.clientRect);
    },
    onUpdate: (p) => {
      items = p.items;
      pick = p.command;
      at = Math.max(0, Math.min(at, items.length - 1));
      paint();
      place(p.clientRect);
    },
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        at = (at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        paint();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        pick(items[at]);
        return true;
      }
      return false;
    },
    onExit: () => { box?.remove(); box = null; },
  };
}

function tiptapSlash(T, pickFiles) {
  return T.Extension.create({
    name: 'weaveSlash',
    addProseMirrorPlugins() {
      return [T.Suggestion({
        editor: this.editor,
        char: '/',
        pluginKey: new T.PluginKey('weave-slash'),
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => tiptapSlashItems(query),
        command: ({ editor, range, props: item }) => {
          const chain = editor.chain().focus().deleteRange(range);
          if (item.run) return item.run(chain).run();
          chain.run();
          if (item.file) return pickFiles();
          crepePickReference(editor.view, range.from, range.from, item.ref);
        },
        render: tiptapSlashMenu,
      })];
    },
  });
}

function tiptapRawHtml(T) {
  return T.Node.create({
    name: 'rawHtml',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes: () => ({ html: { default: '' } }),
    parseHTML: () => [{ tag: 'div[data-raw-html]', getAttrs: (d) => ({ html: d.getAttribute('data-raw-html') }) }],
    renderHTML: ({ node }) => ['div', { 'data-raw-html': node.attrs.html, class: 'wv-raw-html' }, ['span', { class: 'wv-raw-html-tag' }, 'HTML'], ['code', {}, node.attrs.html]],
    markdownTokenName: 'html',
    parseMarkdown: (token) => {
      const raw = String(token.raw ?? token.text ?? '');
      if (token.block) return { type: 'rawHtml', attrs: { html: raw.replace(/\s+$/, '') } };
      if (/^<br\s*\/?>$/i.test(raw.trim())) return { type: 'hardBreak' };
      return { type: 'text', text: raw };
    },
    renderMarkdown: (node) => node.attrs.html,
  });
}

const TIPTAP_BUBBLE = [
  { key: 'bold', label: 'B', title: 'Bold', run: (c) => c.toggleBold() },
  { key: 'italic', label: 'I', title: 'Italic', run: (c) => c.toggleItalic() },
  { key: 'strike', label: 'S', title: 'Strikethrough', run: (c) => c.toggleStrike() },
  { key: 'code', label: '</>', title: 'Inline code', run: (c) => c.toggleCode() },
  { key: 'link', label: 'Link', title: 'Link' },
  { key: 'heading', attrs: { level: 2 }, label: 'H2', title: 'Heading', run: (c) => c.toggleHeading({ level: 2 }) },
  { key: 'blockquote', label: '❝', title: 'Quote', run: (c) => c.toggleBlockquote() },
  { key: 'bulletList', label: '•', title: 'Bullet list', run: (c) => c.toggleBulletList() },
  { key: 'taskList', label: '☐', title: 'Task list', run: (c) => c.toggleTaskList() },
];

function tiptapBubble() {
  const bar = el('div', { class: 'wv-bubble', role: 'toolbar', 'aria-label': 'Format' });
  let tt = null;
  const buttons = TIPTAP_BUBBLE.map((b) => el('button', {
    type: 'button',
    class: 'wv-bubble-btn',
    title: b.title,
    'aria-label': b.title,
    'data-mark': b.key,
    onmousedown: (e) => e.preventDefault(),
    onclick: () => (b.run ? b.run(tt.chain().focus()).run() : askLink()),
  }, b.label));
  const refresh = () => {
    if (!tt) return;
    TIPTAP_BUBBLE.forEach((b, i) => buttons[i].classList.toggle('on', tt.isActive(b.key, b.attrs)));
  };
  const askLink = () => {
    if (tt.isActive('link')) return tt.chain().focus().extendMarkRange('link').unsetLink().run();
    const input = el('input', { class: 'wv-bubble-link', type: 'url', placeholder: 'Paste a link, then Return', 'aria-label': 'Link address' });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const href = input.value.trim();
        bar.replaceChildren(...buttons);
        if (href) tt.chain().focus().extendMarkRange('link').setLink({ href }).run();
        else tt.commands.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        bar.replaceChildren(...buttons);
        tt.commands.focus();
      }
    });
    bar.replaceChildren(input);
    input.focus();
  };
  bar.append(...buttons);
  return {
    el: bar,
    bind: (editor) => {
      tt = editor;
      editor.on('selectionUpdate', refresh);
      editor.on('transaction', refresh);
    },
  };
}

function tiptapGrip() {
  const grip = el('div', { class: 'wv-drag', title: 'Drag to move', 'aria-hidden': 'true' });
  grip.innerHTML = '<svg viewBox="0 0 10 16" width="10" height="16"><circle cx="2.5" cy="3" r="1.3"/><circle cx="7.5" cy="3" r="1.3"/><circle cx="2.5" cy="8" r="1.3"/><circle cx="7.5" cy="8" r="1.3"/><circle cx="2.5" cy="13" r="1.3"/><circle cx="7.5" cy="13" r="1.3"/></svg>';
  return grip;
}

function tiptapSourceKeeper(tt, source) {
  const trimmed = (list) => {
    const out = [...list];
    while (out.length && out.at(-1).type === 'paragraph' && !out.at(-1).content?.length) out.pop();
    return out;
  };
  const blocksOf = (doc) => {
    const out = [];
    doc.forEach((n) => out.push(n));
    while (out.length && out.at(-1).type.name === 'paragraph' && !out.at(-1).content.size) out.pop();
    return out;
  };
  const units = [];
  let at = 0;
  for (const t of tt.markdown.instance.lexer(source)) {
    if (t.type !== 'space' && t.type !== 'def') {
      const count = trimmed(tt.markdown.parse(t.raw).content ?? []).length;
      if (count) units.push({ from: at, to: at + t.raw.replace(/\s+$/, '').length, count });
    }
    at += t.raw.length;
  }
  const was = blocksOf(tt.state.doc);
  if (units.reduce((n, u) => n + u.count, 0) !== was.length) return () => null;
  const text = (nodes) => tt.markdown.serialize({ type: 'doc', content: nodes.map((n) => n.toJSON()) });
  const owner = [];
  units.forEach((u, k) => { for (let c = 0; c < u.count; c++) owner.push(k); });
  const wasText = [];
  const alike = (a, i, b, j) => a[i].eq(b[j]) || (a[i].type === b[j].type && (wasText[i] ??= text([a[i]])) === text([b[j]]));
  return (next, clean) => {
    const now = blocksOf(next);
    const n = was.length;
    const m = now.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = alike(was, i, now, j) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const matchOf = new Int32Array(n).fill(-1);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (alike(was, i, now, j) && lcs[i][j] === lcs[i + 1][j + 1] + 1) { matchOf[i] = j; i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
      else j++;
    }
    const keptAt = new Map();
    let first = 0;
    units.forEach((u, k) => {
      const start = matchOf[first];
      let whole = start >= 0;
      for (let c = 1; whole && c < u.count; c++) whole = matchOf[first + c] === start + c;
      if (whole) keptAt.set(start, k);
      first += u.count;
    });
    if (keptAt.size === units.length && m === n) return source;
    const pieces = [];
    let run = [];
    const flush = () => {
      if (!run.length) return;
      pieces.push({ text: clean(text(run)).replace(/\n+$/, '') });
      run = [];
    };
    for (let j = 0; j < m;) {
      const k = keptAt.get(j);
      if (k === undefined) { run.push(now[j]); j++; continue; }
      flush();
      pieces.push({ unit: k, text: source.slice(units[k].from, units[k].to) });
      j += units[k].count;
    }
    flush();
    let out = '';
    pieces.forEach((p, i) => {
      const prev = pieces[i - 1];
      if (i) out += prev.unit !== undefined && p.unit === prev.unit + 1 ? source.slice(units[prev.unit].to, units[p.unit].from) : '\n\n';
      else if (p.unit === 0) out += source.slice(0, units[0].from);
      out += p.text;
    });
    const last = pieces.at(-1);
    return out + (last?.unit === units.length - 1 ? source.slice(units.at(-1).to) || '\n' : '\n');
  };
}

function mountTiptapEditor(host, { value, entityId, placeholder, onInput: hand, onBlur, autoFocus, readOnly = false }) {
  const T = globalThis.WeaveTiptap;
  const stored = (v) => globalThis.WeaveEditorLib.normalizeTaskBoxes(crepeMarkdown(v));
  const root = document.createElement('div');
  root.className = 'wv-tiptap';
  host.append(root);
  const marksKey = new T.PluginKey('weave-block-marks');
  const bubble = tiptapBubble();
  let handed = stored(value ?? '');
  let keep = () => null;
  let editor = null;
  const pickFiles = () => {
    const input = el('input', { type: 'file', multiple: true, hidden: true });
    input.addEventListener('change', () => { if (input.files?.length) uploadDocFiles(input.files, entityId, () => editor, hand, host); input.remove(); });
    document.body.append(input);
    input.click();
  };
  const tt = new T.Editor({
    element: root,
    editable: !readOnly,
    injectCSS: false,
    content: value ?? '',
    contentType: 'markdown',
    extensions: [
      T.StarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: true } }),
      T.CodeBlockLowlight.configure({ lowlight: T.createLowlight(T.common) }),
      T.TaskList,
      T.TaskItem.configure({ nested: true }),
      T.TableKit.configure({ table: { resizable: false } }),
      T.Image,
      T.Placeholder.configure({ placeholder: placeholder ?? '' }),
      T.Markdown,
      tiptapRawHtml(T),
      T.BubbleMenu.configure({
        element: bubble.el,
        shouldShow: ({ editor: ed, state }) => ed.isEditable && !state.selection.empty && !state.selection.node,
      }),
      T.DragHandle.configure({ render: tiptapGrip }),
      tiptapSlash(T, pickFiles),
      T.Extension.create({
        name: 'weavePlugins',
        addProseMirrorPlugins: () => [referencesPlugin(T), blockMarksPlugin(T, marksKey), holdScrollPlugin(T, host)],
      }),
    ],
  });
  bubble.bind(tt);
  keep = tiptapSourceKeeper(tt, value ?? '');
  const current = () => keep(tt.state.doc, stored) ?? stored(tt.getMarkdown());
  const push = () => {
    const v = current();
    if (v !== handed) { handed = v; hand(v); }
  };
  tt.on('update', push);
  if (onBlur) tt.on('blur', () => onBlur());
  editor = {
    tiptap: tt,
    getValue: current,
    setValue: (md) => {
      handed = stored(md);
      tt.commands.setContent(md, { contentType: 'markdown', emitUpdate: false });
      keep = tiptapSourceKeeper(tt, md);
    },
    insertValue: (md) => {
      tt.chain().focus().insertContent(md, { contentType: 'markdown' }).run();
      const { selection, doc } = tt.state;
      if (selection.node) tt.view.dispatch(tt.state.tr.setSelection(T.TextSelection.near(doc.resolve(selection.to))));
    },
    focus: () => tt.commands.focus(),
    setTheme: () => {},
    destroy: () => { liveEditors.delete(editor); tt.destroy(); bubble.el.remove(); root.remove(); },
  };
  root.weaveMarkBlocks = (marks) => {
    const now = marksKey.getState(tt.state);
    if (now.length === marks.length && now.every((m, i) => m === marks[i])) return;
    tt.view.dispatch(tt.state.tr.setMeta(marksKey, marks));
  };
  const takeFiles = (e, data) => {
    if (readOnly || !data?.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    uploadDocFiles(data.files, entityId, () => editor, hand, host);
  };
  root.addEventListener('paste', (e) => takeFiles(e, e.clipboardData), true);
  root.addEventListener('drop', (e) => takeFiles(e, e.dataTransfer), true);
  host.addEventListener('focusout', () => { push(); flushDocSaves(); });
  docPulls.set(editor, push);
  liveEditors.add(editor);
  queueMicrotask(() => {
    scheduleDecorFor(host);
    if (autoFocus && !readOnly) tt.commands.focus('end');
  });
  return editor;
}
