(function (root) {
  const NUMBER_FORMATS = new Map();
  function numberFormat(o) {
    const key = JSON.stringify(o);
    let f = NUMBER_FORMATS.get(key);
    if (!f) NUMBER_FORMATS.set(key, (f = new Intl.NumberFormat('en-US', o)));
    return f;
  }

  function dressNumber(c, value) {
    if (c.format == null && c.unit == null && c.currency == null && c.decimals == null && !c.separator) return value;
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    if (c.format === 'compact') {
      const o = { notation: 'compact', maximumFractionDigits: c.decimals ?? 1 };
      if (c.currency) { o.style = 'currency'; o.currency = c.currency; }
      try { return numberFormat(o).format(n); } catch {}
    }
    if (c.format === 'currency') {
      const currency = c.currency ?? 'USD';
      const digits = c.decimals ?? 2;
      try {
        return numberFormat({ style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits, ...(c.accounting ? { currencySign: 'accounting' } : {}) }).format(n);
      } catch { return `${currency} ${n.toFixed(digits)}`; }
    }
    const scaled = c.format === 'percent' ? Math.round(n * 100 * 1e8) / 1e8 : n;
    const own = c.decimals == null && c.separator && c.format == null && c.unit == null;
    let text = own ? String(Math.round(scaled * 1e6) / 1e6) : scaled.toFixed(c.decimals ?? 0);
    if (c.separator) {
      const [int, frac] = text.split('.');
      text = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '');
    }
    if (c.format === 'percent') return `${text}%`;
    return c.unit ? `${text} ${c.unit}` : text;
  }

  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const exampleScale = (config) => (config?.format === 'percent' ? 1 : 100);

  function sampleFigures(summary, scale, config = null) {
    const values = [...new Set([summary?.min, summary?.median, summary?.max].filter((v) => num(v) != null).map(r4))]
      .sort((a, b) => a - b);
    if (values.length) return { values, example: false };
    const s = sampleScale(summary, scale, config);
    return { values: [0.25, 0.6, 1].map((share) => r4(share * s)), example: true };
  }

  function sampleScale(summary, scale, config = null) {
    if (num(scale) != null && scale > 0) return scale;
    const max = num(summary?.max);
    return max != null && max > 0 ? r4(max) : exampleScale(config);
  }

  root.weaveNumberCore = { dressNumber, sampleFigures, sampleScale };
})(globalThis);
