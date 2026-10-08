(function (root) {
  const DEFAULT_WIDTHS = {
    text: 180, url: 180, email: 180, multiselect: 180, daterange: 180, view: 180,
    document: 280,
    select: 124, workflow: 124, toggle: 124,
    relation: 136, lookup: 136, field: 136, key: 136, attachments: 136, formula: 136,
    date: 112,
    number: 88, rollup: 88,
    rating: 104,
    checkbox: 56,
  };
  const NAME_WIDTH = 260;
  const CURRENCY_WIDTH = 104;
  const FALLBACK_WIDTH = 136;
  const MAX_WIDTHS = { document: 560, text: 480, url: 480, email: 480, multiselect: 480, relation: 480, lookup: 480, view: 480, formula: 480 };
  const MAX_FALLBACK = 320;

  const maxWidth = (f = {}) => (f.role === 'name' ? 480 : MAX_WIDTHS[f.type] ?? MAX_FALLBACK);

  const RATING_METRICS = { icon: 14, gap: 1, pad: 8 };
  const ratingIcons = (f = {}) => {
    const max = f.type === 'rating' ? f.max : f.type === 'rollup' || f.type === 'lookup' ? f.rating?.max : null;
    return Number.isInteger(max) && max > 0 ? max : 0;
  };
  const ratingWidth = (n, pad) => n * RATING_METRICS.icon + (n - 1) * RATING_METRICS.gap + (Number.isFinite(pad) ? pad : RATING_METRICS.pad);
  const ratingFits = (width, max, pad) => !(max > 0) || width >= ratingWidth(max, pad);

  const TOGGLE_METRICS = { track: 28, gap: 7, pad: 8 };
  const toggleWidth = ({ on = 0, off = 0, pad } = {}) =>
    Math.ceil(TOGGLE_METRICS.track + TOGGLE_METRICS.gap + Math.max(on, off) + (Number.isFinite(pad) ? pad : TOGGLE_METRICS.pad));

  const CELL_PAD = 8;
  const chipWidth = ({ chip = 0, more = 0, gap = 0, pad } = {}) =>
    (chip ? Math.ceil(chip + (more ? gap + more : 0) + (Number.isFinite(pad) ? pad : CELL_PAD)) : 0);

  const ratingFloor = (f = {}, pad) => {
    const icons = ratingIcons(f);
    return icons ? Math.min(maxWidth(f), ratingWidth(icons, pad)) : 0;
  };

  const RICH = { bar: 80, ring: 16, spark: 80, gap: 6, heatPad: 16, cellPad: 24, figure: 24 };
  function richWidth(f, widest) {
    const figure = widest ?? RICH.figure;
    if (f.display === 'sparkline') return RICH.cellPad + RICH.spark;
    if (f.display === 'bar') return RICH.cellPad + RICH.bar + RICH.gap + figure;
    if (f.display === 'ring') return RICH.cellPad + RICH.ring + RICH.gap + figure;
    if (f.display === 'heat') return RICH.cellPad + RICH.heatPad + figure;
    return null;
  }

  const defaultWidth = (f = {}, { widest = null } = {}) => {
    if (f.role === 'name') return NAME_WIDTH;
    const icons = ratingIcons(f);
    if (icons) return Math.min(maxWidth(f), Math.max(DEFAULT_WIDTHS[f.type] ?? DEFAULT_WIDTHS.rating, ratingWidth(icons, f.pad)));
    const rich = richWidth(f, widest);
    if (rich != null) return Math.min(maxWidth(f), Math.ceil(Math.max(rich, DEFAULT_WIDTHS.number)));
    if (f.type === 'number' && f.currency) return CURRENCY_WIDTH;
    if (f.type === 'document' && f.empty) return DEFAULT_WIDTHS.text;
    return DEFAULT_WIDTHS[f.type] ?? FALLBACK_WIDTH;
  };

  function layout(cols) {
    const out = {};
    for (const c of cols) out[c.name] = Math.max(Math.ceil(c.floor ?? 0), Math.round(c.stored ?? defaultWidth(c, { widest: c.widest })));
    return out;
  }

  const CAP = 0.6;
  function frozenFit({ lead = 0, widths = [], frozen = 0, viewport = Infinity, cap = CAP }) {
    let used = lead;
    let n = 0;
    for (; n < Math.min(frozen, widths.length); n++) {
      used += widths[n];
      if (used > viewport * cap) break;
    }
    return n;
  }
  const canFreeze = ({ lead = 0, widths = [], add = 0, viewport = Infinity, cap = CAP }) =>
    lead + widths.reduce((s, w) => s + w, 0) + add <= viewport * cap;

  function plan({ order, frozen = 0, dragged, gap, side }) {
    const from = order.indexOf(dragged);
    if (from < 0) throw new Error(`'${dragged}' is not a visible field`);
    const rest = order.filter((n) => n !== dragged);
    const wasFrozen = from < frozen;
    const restFrozen = frozen - (wasFrozen ? 1 : 0);
    const into = side === 'frozen';
    const at = into ? Math.min(Math.max(gap, 0), restFrozen) : Math.min(Math.max(gap, restFrozen), rest.length);
    const next = [...rest.slice(0, at), dragged, ...rest.slice(at)];
    const nextFrozen = restFrozen + (into ? 1 : 0);
    const noop = nextFrozen === frozen && next.every((n, i) => n === order[i]);
    const tag = noop ? null : !wasFrozen && into ? 'Freeze here' : wasFrozen && !into ? 'Unfreeze' : null;
    return { order: next, frozen: nextFrozen, noop, tag };
  }

  function target({ cols, frozen = 0, lead, seam, x, dragged, capOk = true }) {
    const names = cols.map((c) => c.name);
    const from = names.indexOf(dragged);
    const rest = cols.filter((c) => c.name !== dragged);
    const restFrozen = frozen - (from >= 0 && from < frozen ? 1 : 0);
    let side = x < seam ? 'frozen' : 'scroll';
    let gap = null;
    if (side === 'frozen' && from >= frozen && !capOk) { side = 'scroll'; gap = restFrozen; }
    const me = cols[from];
    if (gap == null && me && x >= me.left && x < me.right && (x < seam) === (from < frozen)) gap = rest.filter((c) => names.indexOf(c.name) < from).length;
    if (gap == null) {
      const span = side === 'frozen' ? rest.slice(0, restFrozen) : rest.slice(restFrozen);
      const offset = side === 'frozen' ? 0 : restFrozen;
      gap = side === 'frozen' ? 0 : rest.length;
      for (let j = 0; j < span.length; j++) {
        const c = span[j];
        if (x < c.left || x >= c.right) continue;
        const mid = (c.left + c.right) / 2;
        let before = x < mid;
        if (Math.abs(x - mid) <= 2) before = names.indexOf(c.name) < from;
        gap = offset + j + (before ? 0 : 1);
        break;
      }
    }
    gap = side === 'frozen' ? Math.min(gap, restFrozen) : Math.max(gap, restFrozen);
    let lineX;
    if (side === 'frozen') lineX = gap === 0 ? lead : rest[gap - 1].right;
    else lineX = gap < rest.length ? Math.max(rest[gap].left, seam) : (rest.at(-1)?.right ?? seam);
    return { gap, side, x: lineX };
  }

  function step({ order, frozen = 0, name, dir, canFreeze: may = true }) {
    const i = order.indexOf(name);
    if (i < 0) return null;
    if (dir < 0) {
      if (i === frozen) return may ? { order: [...order], frozen: frozen + 1 } : null;
      if (i === 0) return null;
      const next = [...order];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return { order: next, frozen };
    }
    if (i === frozen - 1) return { order: [...order], frozen: frozen - 1 };
    if (i === order.length - 1) return null;
    const next = [...order];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    return { order: next, frozen };
  }

  root.WeaveColumnResize = {
    DEFAULT_WIDTHS, NAME_WIDTH, CAP, RATING_METRICS, TOGGLE_METRICS, toggleWidth, chipWidth, ratingFloor, ratingIcons,
    floor({ label = 0, padLeft = 0, padRight = 0, min = 0 } = {}) {
      return Math.max(min, Math.ceil(label + padLeft + padRight));
    },
    width({ base, startX, x, floor = 0 }) {
      return Math.max(floor, Math.round(base + x - startX));
    },
    fit: ({ content, floor = 0, max = Infinity }) => Math.max(Math.ceil(floor), Math.min(max, Math.ceil(content))),
    nudge: ({ width, delta, floor = 0 }) => Math.max(Math.ceil(floor), Math.round(width + delta)),
    RICH, ratingFits,
    defaultWidth, maxWidth, layout, frozenFit, canFreeze, plan, target, step,
  };
})(globalThis);
