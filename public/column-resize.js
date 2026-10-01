/* Column resize, reorder and freeze, the pure half (Issues #98, #100, #160;
   Feature #233). The grip and the header in public/app.js read the pointer
   and paint; every number and every drop plan they need comes from here so
   it can be pressed without a browser (test/column-resize.test.mjs,
   test/column-layout.test.mjs).

   floor: the narrowest a column may go. A header must always show its own
   label — icon, text, sort arrow, computed mark — plus the padding around it
   (the right pad is where the ⋮ menu and the grip sit), and never less than
   the engine's minimum. It is measured off the rendered header by app.js.

   width: where the column is while the pointer is at x. The SAME number is
   painted on every move and persisted on release — one rounding, one
   floor — so what the reader sees during the drag is what the view stores.
   A drag that painted one width and stored another is the jump.

   Kyle's rules for the grid (2026-09-25): a label never truncates; one
   field's change never moves another field's width; every type has a
   default width, raised only by its own label. */
(function (root) {
  /* The mockup's widths, and every other weave type mapped to the nearest.
     A relation is the person chip's width: it shows a row's name. */
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
  /* Name opens at 260, past the mockup's 220 (Kyle, 2026-09-26; Issues
     #261, #414): at 240 a thirty-character name had one pixel of room in
     Chromium's fallback face. */
  const NAME_WIDTH = 260;
  const CURRENCY_WIDTH = 104;
  const FALLBACK_WIDTH = 136;
  /* Where a double-click fit stops: a long value is read in its cell's pop,
     it does not get the screen. */
  const MAX_WIDTHS = { document: 560, text: 480, url: 480, email: 480, multiselect: 480, relation: 480, lookup: 480, view: 480, formula: 480 };
  const MAX_FALLBACK = 320;

  const maxWidth = (f = {}) => (f.role === 'name' ? 480 : MAX_WIDTHS[f.type] ?? MAX_FALLBACK);

  /* A rating's icons, as the cell paints them (public/style.css: a
     .wv-rate-ico is a 16px glyph in 1px of padding, .wv-rating sets a 1px
     gap, and a grid cell carries 4px of padding each side). Feature #235's
     column-width rule: a rating opens at `max` icons plus the gaps between
     them plus the cell's padding, so no column opens cutting its last icon
     (Issue #404 — before this every rating opened at 104 whatever its max,
     so a 7 of 7 read like a 5 of 7 and the right-most icon could not be
     clicked). test/rating-browser.test.mjs holds these three numbers to
     what the browser paints, so a CSS change to the icon cannot drift away
     from the width in silence. */
  const RATING_METRICS = { icon: 18, gap: 1, pad: 8 };
  const ratingIcons = (f = {}) => (f.type === 'rating' && Number.isInteger(f.max) && f.max > 0 ? f.max : 0);
  /* `pad` is the cell's own horizontal padding and border, measured off the
     rendered cell by app.js — Tabler gives the row's last cell 20px on the
     right where every other cell has 4 — and the ordinary cell's 8 when
     nothing has been measured yet. */
  const ratingWidth = (n, pad) => n * RATING_METRICS.icon + (n - 1) * RATING_METRICS.gap + (Number.isFinite(pad) ? pad : RATING_METRICS.pad);

  const defaultWidth = (f = {}) => {
    if (f.role === 'name') return NAME_WIDTH;
    if (f.type === 'number' && f.currency) return CURRENCY_WIDTH;
    const icons = ratingIcons(f);
    /* A short rating keeps the type default rather than shrinking under it,
       and past the fit ceiling a rating stops there rather than taking the
       screen: a max that long is read in the cell's pop. */
    if (icons) return Math.min(maxWidth(f), Math.max(DEFAULT_WIDTHS.rating, ratingWidth(icons, f.pad)));
    return DEFAULT_WIDTHS[f.type] ?? FALLBACK_WIDTH;
  };

  /* The widths a grid paints: the view's width, else the field's legacy
     schema width, else the type's default — and never under the label. One
     column's inputs decide its width; nothing is shared or redistributed. */
  function layout(cols) {
    const out = {};
    for (const c of cols) out[c.name] = Math.max(Math.ceil(c.floor ?? 0), Math.round(c.stored ?? defaultWidth(c)));
    return out;
  }

  /* The frozen zone may cover at most `cap` of the visible grid. `lead` is
     the checkbox and # columns; `widths` the frozen fields in order. */
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

  /* What a drop does. `order` is the visible fields, `frozen` how many of
     them lead the order frozen, `gap` the insertion index among the other
     fields, `side` which side of the seam the pointer is on. The side wins
     over the gap: a frozen-side gap is kept inside the zone, a scroll-side
     one outside it. */
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

  /* Where the pointer would drop. `cols` are the visible fields' rendered
     boxes in order (viewport x), `lead` the right edge of the # column,
     `seam` the right edge of the frozen zone (the # column when only it is
     frozen). Left of the seam is the frozen side — # and the checkbox
     included, so nothing ever lands before #. Over a column, its left half
     is the gap before it and its right half the gap after; dead centre
     falls on the side the dragged column comes from. */
  function target({ cols, frozen = 0, lead, seam, x, dragged, capOk = true }) {
    const names = cols.map((c) => c.name);
    const from = names.indexOf(dragged);
    const rest = cols.filter((c) => c.name !== dragged);
    const restFrozen = frozen - (from >= 0 && from < frozen ? 1 : 0);
    let side = x < seam ? 'frozen' : 'scroll';
    let gap = null;
    // Past the cap a freeze lands on the scrolling side of the seam instead.
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

  /* One keyboard step (Alt+Shift+←/→). Crossing the seam freezes or
     unfreezes the field where it stands; nothing moves before #. */
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
    DEFAULT_WIDTHS, NAME_WIDTH, CAP, RATING_METRICS,
    floor({ label = 0, padLeft = 0, padRight = 0, min = 0 } = {}) {
      return Math.max(min, Math.ceil(label + padLeft + padRight));
    },
    width({ base, startX, x, floor = 0 }) {
      return Math.max(floor, Math.round(base + x - startX));
    },
    fit: ({ content, floor = 0, max = Infinity }) => Math.max(Math.ceil(floor), Math.min(max, Math.ceil(content))),
    nudge: ({ width, delta, floor = 0 }) => Math.max(Math.ceil(floor), Math.round(width + delta)),
    defaultWidth, maxWidth, layout, frozenFit, canFreeze, plan, target, step,
  };
})(globalThis);
