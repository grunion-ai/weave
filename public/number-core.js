/* The number costume and the figures a settings tray samples — pure: a value
   and a config in, a dressed string out; a column's five-number summary in,
   the figures to draw out. No DOM. Classic script + ESM in one file (the
   cell-graphics.js pattern): the browser reads the window global, node
   imports the same source, and src/engine.js dresses every number read
   through it — one costume, so the tray's Sample and the grid cell can never
   disagree. */
(function (root) {
  /* The number costume (#97): decimals, thousands separator, then one of
     percent / currency (ISO code through Intl — '$149.50', '€1,200') / a
     free-text unit appended ('12 days'). Used by number fields and by
     formulas whose result is a number. */
  function dressNumber(c, value) {
    // No costume at all: the raw number, untouched (formulas, sorting, the
    // API all rely on it). Any costume: decimals default to 0, currency to 2.
    if (c.format == null && c.unit == null && c.currency == null && c.decimals == null && !c.separator) return value;
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    if (c.format === 'compact') {
      // 1.2M / 4.8K — a figure that would outgrow its column; composes with a currency.
      const o = { notation: 'compact', maximumFractionDigits: c.decimals ?? 1 };
      if (c.currency) { o.style = 'currency'; o.currency = c.currency; }
      try { return new Intl.NumberFormat('en-US', o).format(n); } catch { /* fall through to the plain figure */ }
    }
    if (c.format === 'currency') {
      const currency = c.currency ?? 'USD';
      const digits = c.decimals ?? 2;
      try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits, ...(c.accounting ? { currencySign: 'accounting' } : {}) }).format(n);
      } catch { return `${currency} ${n.toFixed(digits)}`; }
    }
    // Percent follows the spreadsheet convention (Issue #127): the stored
    // value is the fraction, the display is ×100 — 0.325 reads "32.5%". The
    // scale is rounded before toFixed so float noise (0.1 × 100 =
    // 10.000000000000002) never reaches the reader.
    const scaled = c.format === 'percent' ? Math.round(n * 100 * 1e8) / 1e8 : n;
    // Zero decimals unless the field says otherwise (currency above: two).
    // A separator alone only groups thousands: 44.22 stays 44.22, never 44
    // (Issue #574). Up to six places, which keeps float noise out.
    const own = c.decimals == null && c.separator && c.format == null && c.unit == null;
    let text = own ? String(Math.round(scaled * 1e6) / 1e6) : scaled.toFixed(c.decimals ?? 0);
    if (c.separator) {
      const [int, frac] = text.split('.');
      text = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '');
    }
    if (c.format === 'percent') return `${text}%`;
    return c.unit ? `${text} ${c.unit}` : text;
  }

  // Enough places to keep a stored figure whole, few enough to keep an
  // interpolated median off the float-noise tail.
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  /* What an example is measured against when there is no column to read: a
     percent lives in 0..1, every other costume in 0..100 — the figures the
     Scale control itself offers when it switches to fixed. */
  const exampleScale = (config) => (config?.format === 'percent' ? 1 : 100);

  /* The figures a graphic number field's Sample draws (Issue #388): the
     column's own smallest, middle and largest, so the display and the scale
     are judged against values the field holds. `summary` is the column's
     five-number summary — the stats every Σ row reads (src/stats.js). Equal
     figures collapse: a one-row column draws one bar, not three of the same.
     A column with no numbers in it falls back to a quarter, three fifths and
     the whole of the scale, and `example` says to label them as examples. */
  function sampleFigures(summary, scale, config = null) {
    const values = [...new Set([summary?.min, summary?.median, summary?.max].filter((v) => num(v) != null).map(r4))]
      .sort((a, b) => a - b);
    if (values.length) return { values, example: false };
    const s = sampleScale(summary, scale, config);
    return { values: [0.25, 0.6, 1].map((share) => r4(share * s)), example: true };
  }

  /* What 100% is in the Sample: the fixed scale, or the column's largest
     value — the same number the engine hands the grid under scale 'column'. */
  function sampleScale(summary, scale, config = null) {
    if (num(scale) != null && scale > 0) return scale;
    const max = num(summary?.max);
    return max != null && max > 0 ? r4(max) : exampleScale(config);
  }

  root.weaveNumberCore = { dressNumber, sampleFigures, sampleScale };
})(globalThis);
