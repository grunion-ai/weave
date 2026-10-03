/* Column resize, reorder and freeze, the pure half (Issues #98, #100, #160;
   Feature #233). The grip and the header in public/app.js read the pointer
   and paint; every number and every drop plan they need comes from here so
   it can be pressed without a browser (test/column-resize.test.mjs,
   test/column-layout.test.mjs).

   floor: the narrowest a column may go. A header must always show its own
   label — icon, text, sort arrow, computed mark — plus the padding around it
   (the right pad is where the ⋮ menu and the grip sit), and never less than
   the engine's minimum. It is measured off the rendered header by app.js.
   A date (Issue #159), a toggle (Issue #586), a select, a multi-select, a
   state and a rating (Issue #614) raise it to what their value paints, so
   no column of theirs can cut one. Free text is not floored: it truncates
   with an ellipsis and its pop shows the rest.

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
     .wv-rate-ico is a 14px glyph with no padding, Feature #235's redrawn
     cell; .wv-rating sets a 1px gap, and a grid cell carries 4px of padding
     each side). Feature #235's column-width rule: a rating opens at `max`
     icons plus the gaps between them plus the cell's padding, so no column
     opens cutting its last icon (Issue #404 — before this every rating
     opened at 104 whatever its max, so a 7 of 7 read like a 5 of 7 and the
     right-most icon could not be clicked). test/rating-browser.test.mjs
     holds these three numbers to what the browser paints, so a CSS change
     to the icon cannot drift away from the width in silence. */
  const RATING_METRICS = { icon: 14, gap: 1, pad: 8 };
  const ratingIcons = (f = {}) => (f.type === 'rating' && Number.isInteger(f.max) && f.max > 0 ? f.max : 0);
  /* `pad` is the cell's own horizontal padding and border, measured off the
     rendered cell by app.js — Tabler gives the row's last cell 20px on the
     right where every other cell has 4 — and the ordinary cell's 8 when
     nothing has been measured yet. */
  const ratingWidth = (n, pad) => n * RATING_METRICS.icon + (n - 1) * RATING_METRICS.gap + (Number.isFinite(pad) ? pad : RATING_METRICS.pad);
  /* Whether a rating's icons fit in a column this wide; a column narrower
     than its icons draws the compact "★ 3/12" instead of cutting icons off.
     Since Issue #614 a drag cannot take a rating under its icons (its floor,
     ratingFloor below), so the compact form is what a max past the fit cap
     draws. A rollup or a lookup that reads a rating draws inside the
     computed chip and is sized on its own (Issue #564). */
  const ratingFits = (width, max, pad) => !(max > 0) || width >= ratingWidth(max, pad);

  /* A toggle's switch, as the cell paints it (public/style.css: a
     .wv-toggle-track is 28px, .wv-toggle sets a 7px gap before the word,
     and a grid cell carries 4px of padding each side). Issue #586: the
     floor took only the header label, so a toggle named "On" dragged to
     about 50px, its word ellipsized and then its track clipped. Kyle
     (2026-10-02): the minimum width is set so a toggle is never cut off.
     The words are text, so app.js measures them in the grid's own face;
     `pad` is the cell's measured padding and border, as for a rating.
     test/toggle-width-browser.test.mjs holds these numbers to the paint. */
  const TOGGLE_METRICS = { track: 28, gap: 7, pad: 8 };
  const toggleWidth = ({ on = 0, off = 0, pad } = {}) =>
    Math.ceil(TOGGLE_METRICS.track + TOGGLE_METRICS.gap + Math.max(on, off) + (Number.isFinite(pad) ? pad : TOGGLE_METRICS.pad));

  /* A select, a multi-select or a state paints a chip of fixed shape:
     fill, padding, colour or icon, name. Kyle (2026-10-03, Issue #614):
     "make sure no part of the toggle or box can be cut off by field
     resize." Before, these floored at their header label only, so a State
     column dragged under a "Setup incomplete" chip cut it mid-word. `chip`
     is the widest option's chip as app.js measures it in the column's own
     cell, so a CSS change moves the number with it. A multi-select keeps one
     chip whole beside the +N count that says the rest are hidden (fitChips
     in app.js): `more` is that count's width and `gap` the box's gap
     between them — one chip, never the sum. `pad` is the cell's measured
     padding and border, as for a toggle. */
  const CELL_PAD = 8;
  const chipWidth = ({ chip = 0, more = 0, gap = 0, pad } = {}) =>
    (chip ? Math.ceil(chip + (more ? gap + more : 0) + (Number.isFinite(pad) ? pad : CELL_PAD)) : 0);

  /* A rating's icons are a control of fixed shape too (Issue #614), so its
     floor holds every icon. That supersedes Feature #235's "a width the
     reader dragged still wins" for widths under the icons. Past the fit
     ceiling a rating stops there, as its default does: a max that long
     (the engine allows 100) draws its compact form. */
  const ratingFloor = (f = {}, pad) => {
    const icons = ratingIcons(f);
    return icons ? Math.min(maxWidth(f), ratingWidth(icons, pad)) : 0;
  };

  /* A graphic number column opens at the width its graphic needs (Feature
     #235): never a bar squeezed to a sliver. The sizes are the cells' own
     (public/style.css): an 80px bar track, a 16px ring, an 80px sparkline,
     6px between a graphic and its figure, 24px of cell padding. `widest` is
     the widest figure the column prints, measured by the page; three digits
     until it has. The width a person dragged is stored and wins (layout). */
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
    /* A short rating keeps the type default rather than shrinking under it,
       and past the fit ceiling a rating stops there rather than taking the
       screen: a max that long draws its compact form. */
    if (icons) return Math.min(maxWidth(f), Math.max(DEFAULT_WIDTHS.rating, ratingWidth(icons, f.pad)));
    const rich = richWidth(f, widest);
    // A number column is never narrower than a plain one: an empty cell
    // is still a number box, and the box wants its 88px.
    if (rich != null) return Math.min(maxWidth(f), Math.ceil(Math.max(rich, DEFAULT_WIDTHS.number)));
    if (f.type === 'number' && f.currency) return CURRENCY_WIDTH;
    return DEFAULT_WIDTHS[f.type] ?? FALLBACK_WIDTH;
  };

  /* The widths a grid paints: the view's width, else the field's legacy
     schema width, else the type's default — and never under the label. One
     column's inputs decide its width; nothing is shared or redistributed. */
  function layout(cols) {
    const out = {};
    for (const c of cols) out[c.name] = Math.max(Math.ceil(c.floor ?? 0), Math.round(c.stored ?? defaultWidth(c, { widest: c.widest })));
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
    DEFAULT_WIDTHS, NAME_WIDTH, CAP, RATING_METRICS, TOGGLE_METRICS, toggleWidth, chipWidth, ratingFloor,
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
