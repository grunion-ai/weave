(function (root) {
  const MAX_VALUE = 1000;
  const MAX_QUERY = 2400;

  function pairsOf(source) {
    if (!source) return [];
    if (typeof source === 'string') return [...new URLSearchParams(source)];
    if (typeof source.entries === 'function' && !Array.isArray(source)) return [...source.entries()];
    return source;
  }

  function clip(source) {
    const kept = [];
    const cut = [];
    let size = 0;
    for (const [key, raw] of pairsOf(source)) {
      const chars = [...String(raw ?? '')];
      const value = chars.slice(0, MAX_VALUE).join('');
      const piece = new URLSearchParams([[key, value]]).toString();
      if (size + piece.length + (kept.length ? 1 : 0) > MAX_QUERY) {
        if (!cut.includes(key)) cut.push(key);
        continue;
      }
      if (chars.length > MAX_VALUE && !cut.includes(key)) cut.push(key);
      kept.push([key, value]);
      size += piece.length + (kept.length > 1 ? 1 : 0);
    }
    return { pairs: kept, query: new URLSearchParams(kept).toString(), cut };
  }

  function link(base, values) {
    const pairs = [];
    for (const [key, v] of Object.entries(values ?? {})) {
      for (const one of Array.isArray(v) ? v : [v]) {
        if (one == null || one === '' || one === false) continue;
        pairs.push([key, one === true ? 'true' : String(one)]);
      }
    }
    const { query } = clip(pairs);
    return query ? `${base}?${query}` : base;
  }

  root.weavePrefill = { MAX_VALUE, MAX_QUERY, clip, link };
})(globalThis);
