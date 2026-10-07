(function (root) {
  const GROUP_CAP = 3;
  const GROUP_TYPES = ['select', 'multiselect', 'workflow', 'toggle', 'checkbox', 'relation', 'date'];
  const HEADINGS = ['label', 'chip'];
  const ORDERS = ['option', 'table', 'az'];
  const GRAINS = ['day', 'week', 'month', 'year'];
  const COMPLETED = 'Completed';
  const SEP = ' › ';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = (n) => String(n).padStart(2, '0');

  const groupable = (f) => !!f && GROUP_TYPES.includes(f.type);

  function levelDefaults(type) {
    return { heading: 'label', order: type === 'relation' ? 'table' : 'option', ...(type === 'date' ? { grain: 'month' } : {}) };
  }

  function normalizeLevel(f, raw = {}) {
    if (!groupable(f)) throw new Error(`'${f?.name}' cannot group a list: group by a select, workflow, toggle, checkbox, link or date field`);
    const out = levelDefaults(f.type);
    if (raw.heading != null) {
      if (!HEADINGS.includes(raw.heading)) throw new Error(`heading is label or chip, got ${JSON.stringify(raw.heading)}`);
      if (raw.heading === 'chip' && f.type !== 'relation') throw new Error(`Only a link field heads its groups with a chip; '${f.name}' takes label`);
      out.heading = raw.heading;
    }
    if (raw.order != null) {
      if (!ORDERS.includes(raw.order)) throw new Error(`order is option, table or az, got ${JSON.stringify(raw.order)}`);
      if (raw.order === 'table' && f.type !== 'relation') throw new Error(`table order is the linked table's order: only a link field has it, '${f.name}' takes option or az`);
      if (raw.order === 'option' && f.type === 'relation') throw new Error(`A link field orders its groups by table or az, not option`);
      out.order = raw.order;
    }
    if (raw.grain != null) {
      if (f.type !== 'date') throw new Error(`grain groups a date field; '${f.name}' is a ${f.type}`);
      if (!GRAINS.includes(raw.grain)) throw new Error(`grain is day, week, month or year, got ${JSON.stringify(raw.grain)}`);
      out.grain = raw.grain;
    }
    return out;
  }

  function compactLevel(type, level) {
    const d = levelDefaults(type);
    const out = {};
    for (const k of ['heading', 'order', 'grain']) if (level[k] != null && level[k] !== d[k]) out[k] = level[k];
    return out;
  }

  function parseGroup(input) {
    if (input == null) return [];
    const list = typeof input === 'string'
      ? input.split(/›|>|,/).map((s) => s.trim()).filter(Boolean)
      : Array.isArray(input) ? input : [input];
    const out = list.map((x) => (typeof x === 'string' ? { field: x } : x && typeof x === 'object' ? { ...x } : null));
    if (out.some((x) => !x || x.field == null || String(x.field).trim() === '')) {
      throw new Error('group is a list of levels: a field name, or {field, heading, order, grain}');
    }
    if (out.length > GROUP_CAP) throw new Error(`A list groups at most ${GROUP_CAP} levels deep, got ${out.length}`);
    return out;
  }

  function dateBucket(iso, grain = 'month') {
    const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (grain === 'year') return { key: `${y}`, label: `${y}`, value: `${y}-01-01` };
    if (grain === 'month') return { key: `${y}-${pad(mo)}`, label: `${LONG_MONTHS[mo - 1]} ${y}`, value: `${y}-${pad(mo)}-01` };
    if (grain === 'week') {
      const t = new Date(Date.UTC(y, mo - 1, d));
      t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
      const key = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
      return { key, label: `Week of ${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`, value: key };
    }
    const key = `${y}-${pad(mo)}-${pad(d)}`;
    return { key, label: `${MONTHS[mo - 1]} ${d}, ${y}`, value: key };
  }

  function applyManual(rows, manual) {
    if (!manual?.length) return rows.slice();
    const at = new Map(manual.map((id, i) => [id, i]));
    return rows.map((r, i) => ({ r, i, k: at.has(r.id) ? at.get(r.id) : Infinity }))
      .sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r);
  }

  function nestItems(rows, nest) {
    if (!nest) return rows.map((row) => ({ row, depth: 0, children: [] }));
    const here = new Set(rows.map((r) => r.id));
    const kids = new Map();
    const roots = [];
    for (const r of rows) {
      if (r.parent && r.parent !== r.id && here.has(r.parent)) {
        if (!kids.has(r.parent)) kids.set(r.parent, []);
        kids.get(r.parent).push(r);
      } else roots.push(r);
    }
    const seen = new Set();
    const grow = (row, depth) => {
      seen.add(row.id);
      return { row, depth, children: (kids.get(row.id) ?? []).filter((c) => !seen.has(c.id)).map((c) => grow(c, depth + 1)) };
    };
    const out = roots.map((r) => grow(r, 0));
    for (const r of rows) if (!seen.has(r.id)) out.push(grow(r, 0));
    return out;
  }

  const countRows = (rows) => new Set(rows.filter((r) => !r.ghost).map((r) => r.id)).size;

  function sortBuckets(list, level) {
    const domain = new Map((level.domain ?? []).map((d, i) => [d.key, i]));
    return list.sort((a, b) => {
      if ((a.key === '') !== (b.key === '')) return a.key === '' ? 1 : -1;
      if (level.order !== 'az') {
        const ia = domain.has(a.key) ? domain.get(a.key) : Infinity;
        const ib = domain.has(b.key) ? domain.get(b.key) : Infinity;
        if (ia !== ib) return ia - ib;
      }
      return String(a.label).localeCompare(String(b.label), undefined, { numeric: true });
    });
  }

  function arrange(rows, { levels = [], completedBy = false, nest = false, manual = null, showEmpty = false } = {}) {
    const ordered = applyManual(rows, manual);
    const isDone = (r) => completedBy && r.done && !r.ghost;
    const active = ordered.filter((r) => !isDone(r));
    const finished = ordered.filter(isDone);
    const build = (depth, subset, path) => {
      const level = levels[depth];
      const buckets = new Map();
      const add = (k) => { if (!buckets.has(k.key)) buckets.set(k.key, { ...k, rows: [] }); return buckets.get(k.key); };
      if (showEmpty) for (const d of level.domain ?? []) add(d);
      for (const r of subset) {
        const ks = r.keys?.[depth] ?? [];
        if (!ks.length) add({ key: '', label: level.nullLabel ?? 'None' }).rows.push(r);
        for (const k of ks) add(k).rows.push(r);
      }
      return sortBuckets([...buckets.values()], level).map(({ rows: members, ...b }) => {
        const here = [...path, b];
        const node = { key: here.map((p) => p.label).join(SEP), label: b.label, value: b.key, level: depth, path: here, count: countRows(members) };
        if (depth === levels.length - 1) node.items = nestItems(members, nest);
        else node.groups = build(depth + 1, members, here);
        return node;
      });
    };
    const out = { shown: countRows(ordered), done: countRows(finished) };
    if (levels.length) out.groups = build(0, active, []);
    else out.items = nestItems(active, nest);
    if (completedBy) out.completed = { key: COMPLETED, label: COMPLETED, count: countRows(finished), items: nestItems(finished, nest) };
    return out;
  }

  function isCollapsed(collapsed, key) {
    return collapsed == null ? key === COMPLETED : collapsed.includes(key);
  }

  function toggleCollapsed(collapsed, key) {
    const now = collapsed == null ? [COMPLETED] : collapsed.slice();
    const i = now.indexOf(key);
    if (i >= 0) now.splice(i, 1); else now.push(key);
    return now;
  }

  function moveInOrder(ids, dragId, targetId, after = false) {
    const out = ids.filter((id) => id !== dragId);
    const at = out.indexOf(targetId);
    if (at < 0) out.push(dragId); else out.splice(after ? at + 1 : at, 0, dragId);
    return out;
  }

  function locate(items, id, parent = null) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].row.id === id) return { siblings: items, index: i, parent };
      const hit = locate(items[i].children, id, items[i]);
      if (hit) return hit;
    }
    return null;
  }

  function changedLevels(fromPath, toPath) {
    const out = [];
    for (let i = 0; i < Math.max(fromPath.length, toPath.length); i++) if (fromPath[i]?.key !== toPath[i]?.key) out.push(i);
    return out;
  }

  function footerText({ shown, all, done = null, term = { singular: 'row', plural: 'rows' } }) {
    const noun = all === 1 ? term.singular : term.plural;
    return `${shown} of ${all} ${noun}` + (done == null ? '' : ` · ${done} completed`);
  }

  function groupLabel(levels, fieldOf) {
    return levels.map((l) => fieldOf(l.field)?.name ?? l.field).join(SEP);
  }

  root.weaveListCore = {
    GROUP_CAP, GROUP_TYPES, HEADINGS, ORDERS, GRAINS, COMPLETED, SEP,
    groupable, levelDefaults, normalizeLevel, compactLevel, parseGroup, dateBucket,
    applyManual, nestItems, arrange, isCollapsed, toggleCollapsed, moveInOrder, locate, changedLevels, footerText, groupLabel,
  };
})(typeof window !== 'undefined' ? window : globalThis);
