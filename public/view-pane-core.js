(function (root) {
  const SORT_CAP = 3;
  const GROUP_CAP = 5;
  const SUBTOTALS = ['all', 'top', 'none'];
  const SUBTOTAL_LABELS = { all: 'Every level', top: 'Top level', none: 'None' };
  const SORT_LEVELS = ['Primary', 'Secondary', 'Tertiary'];
  const SECTIONS = ['filters', 'sort', 'group', 'fields', 'display'];
  const core = () => root.weaveListCore;
  const NO_VALUE = () => core().NO_VALUE;

  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  const fieldOf = (level) => (typeof level === 'string' ? level : level?.field ?? null);

  function normalize({ sort = [], group = [] } = {}, { sortable = () => true, groupable = () => true } = {}) {
    const notes = [];
    const g = [];
    for (const level of group ?? []) {
      const f = fieldOf(level);
      if (f == null || !groupable(f) || g.some((x) => fieldOf(x) === f)) continue;
      if (g.length >= GROUP_CAP) { notes.push(`Group keeps ${GROUP_CAP} levels.`); break; }
      g.push(typeof level === 'string' ? { field: level } : level);
    }
    const s = [];
    for (const level of sort ?? []) {
      const f = fieldOf(level);
      if (f == null || !sortable(f) || s.some((x) => x.field === f)) continue;
      if (g.some((x) => fieldOf(x) === f)) { notes.push(`${f} now orders the groups, so it left Sort.`); continue; }
      if (s.length >= SORT_CAP) { notes.push(`Sort keeps ${SORT_CAP} levels.`); break; }
      s.push({ field: f, dir: level?.dir === 'desc' ? 'desc' : 'asc' });
    }
    return { sort: s, group: g, notes };
  }

  function compareValues(x, y) {
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }

  function comparator(sort, valueOf, tie = (a, b) => (a.publicId ?? 0) - (b.publicId ?? 0)) {
    return (a, b) => {
      for (const { field, dir } of sort ?? []) {
        const x = valueOf(a, field), y = valueOf(b, field);
        const ex = isEmpty(x), ey = isEmpty(y);
        if (ex !== ey) return ex ? 1 : -1;
        if (ex) continue;
        const c = compareValues(x, y);
        if (c) return dir === 'desc' ? -c : c;
      }
      return tie(a, b);
    };
  }

  function boolKey(f, on) {
    return {
      key: String(on),
      label: f.type === 'toggle' ? (on ? f.on : f.off) : (on ? f.name : `Not ${f.name.toLowerCase()}`),
      value: on,
    };
  }

  function groupKeys(level, item) {
    const f = level.f;
    if (f.type === 'relation') {
      const v = item.fields?.[f.name];
      return (Array.isArray(v) ? v : v ? [v] : []).filter((x) => x?.id).map((x) => ({ key: x.id, label: x.name || `#${x.publicId}`, value: x.id, summary: x }));
    }
    if (f.type === 'date') { const b = core().dateBucket(item.raw?.[f.name], level.grain); return b ? [b] : []; }
    if (f.type === 'checkbox' || f.type === 'toggle') return [boolKey(f, !!item.raw?.[f.name])];
    const v = item.fields?.[f.name];
    return (Array.isArray(v) ? v : v != null && v !== '' ? [v] : []).map((n) => ({ key: String(n), label: String(n), value: String(n) }));
  }

  function groupDomain(level, targets, items) {
    const f = level.f;
    if (f.type === 'relation') return (targets ?? []).map((t) => ({ key: t.id, label: t.name || `#${t.publicId}`, value: t.id, summary: t }));
    if (f.type === 'select' || f.type === 'multiselect') return (f.options ?? []).map((n) => ({ key: n, label: n, value: n }));
    if (f.type === 'workflow') return (f.states ?? []).map((st) => ({ key: st.name, label: st.name, value: st.name }));
    if (f.type === 'checkbox' || f.type === 'toggle') return [boolKey(f, false), boolKey(f, true)];
    const seen = new Map();
    for (const it of items) for (const k of groupKeys(level, it)) seen.set(k.key, k);
    return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  function levelsFor(group, fields, { domains = [], items = [] } = {}) {
    return (group ?? []).map((l, i) => {
      const f = fields.find((x) => x.name === fieldOf(l));
      if (!f || !core().groupable(f)) return null;
      const level = { ...core().levelDefaults(f.type), ...(typeof l === 'string' ? {} : l), field: f.name, f };
      return { ...level, domain: groupDomain(level, domains[i], items), nullLabel: NO_VALUE() };
    }).filter(Boolean);
  }

  function rowsFor(items, levels) {
    return items.map((it) => ({ id: it.id, publicId: it.publicId, keys: levels.map((l) => groupKeys(l, it)), deleted: !!it.deleted, item: it }));
  }

  function filterLabels(f, item) {
    if (f.type === 'toggle') return [item.raw?.[f.name] ? f.on : f.off];
    const v = item.fields?.[f.name];
    return Array.isArray(v) ? v.map(String) : isEmpty(v) ? [] : [String(v)];
  }

  function passes(item, filters, fields) {
    return Object.entries(filters ?? {}).every(([name, want]) => {
      const f = fields.find((x) => x.name === name);
      if (!f || !want?.length) return true;
      return filterLabels(f, item).some((v) => want.includes(v));
    });
  }

  function liveRows(rows) {
    const out = new Map();
    for (const r of rows ?? []) if (!r.deleted && !r.ghost && !out.has(r.id)) out.set(r.id, r);
    return [...out.values()];
  }

  function countText(rows, term = { singular: 'row', plural: 'rows' }) {
    const n = liveRows(rows).length;
    return `${n.toLocaleString('en-US')} ${n === 1 ? term.singular : term.plural}`;
  }

  function nodeCount(rows, term) {
    const gone = new Set((rows ?? []).filter((r) => r.deleted).map((r) => r.id)).size;
    return countText(rows, term) + (gone ? ` · ${gone} deleted` : '');
  }

  function nextCollapsed(prev, next, collapsed) {
    const sig = (levels) => (levels ?? []).map(fieldOf).join('|');
    return sig(prev) === sig(next) ? collapsed : null;
  }

  function subtotalAt(level, { rollups, subtotals = 'all' }) {
    return !!rollups && (subtotals === 'all' || (subtotals === 'top' && level === 0));
  }

  function model(rows, { levels = [], collapsed = null, rollups = false, subtotals = 'all', showEmpty = false } = {}) {
    const arranged = core().arrange(rows, { levels, showEmpty });
    const slots = [];
    const nodes = [];
    const leaves = [];
    const shut = new Set(collapsed ?? []);
    const every = (ns) => { for (const n of ns) { nodes.push(n); if (n.groups) every(n.groups); else leaves.push(n); } };
    const walk = (ns) => {
      for (const n of ns) {
        slots.push({ kind: 'head', node: n, key: `h:${n.key}` });
        if (!shut.has(n.key)) {
          if (n.groups) walk(n.groups);
          else for (const it of n.items) slots.push({ kind: 'row', row: it.row, node: n, key: `r:${n.key}:${it.row.id}` });
        }
        if (subtotalAt(n.level, { rollups, subtotals })) slots.push({ kind: 'sum', node: n, rows: n.rows, key: `s:${n.key}` });
      }
    };
    if (arranged.groups) { every(arranged.groups); walk(arranged.groups); }
    else for (const it of arranged.items) slots.push({ kind: 'row', row: it.row, node: null, key: `r::${it.row.id}` });
    if (rollups) slots.push({ kind: 'grand', rows, key: 'g' });
    return { arranged, slots, nodes, leaves };
  }

  function activeFilters(view) {
    const n = Object.values(view?.filters ?? {}).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
    return n + (view?.deleted ? 1 : 0);
  }

  function directionWords(type, { order = null } = {}) {
    if (type === 'number' || type === 'rating' || type === 'formula' || type === 'rollup') return ['1 to 9', '9 to 1'];
    if (type === 'date' || type === 'daterange') return ['Oldest first', 'Newest first'];
    if (type === 'select' || type === 'multiselect' || type === 'workflow') return order === 'az' ? ['A to Z', 'Z to A'] : ['Option order', 'Reversed'];
    if (type === 'relation') return order === 'az' ? ['A to Z', 'Z to A'] : ['Table order', 'Reversed'];
    if (type === 'checkbox' || type === 'toggle') return ['Off first', 'On first'];
    return ['A to Z', 'Z to A'];
  }

  root.weaveViewPane = {
    SORT_CAP, GROUP_CAP, SUBTOTALS, SUBTOTAL_LABELS, SORT_LEVELS, SECTIONS,
    isEmpty, normalize, comparator, groupKeys, groupDomain, boolKey, levelsFor, rowsFor, passes, filterLabels, liveRows,
    countText, nodeCount, nextCollapsed, subtotalAt, model, activeFilters, directionWords,
    get NO_VALUE() { return NO_VALUE(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
