(function (root) {
  const LABELS = {
    name: 'Name', type: 'Type', options: 'Options', states: 'States', expression: 'Formula',
    default: 'Default', format: 'Format', currency: 'Currency', precision: 'Precision', grain: 'Grain',
    clock: 'Clock', description: 'Description', display: 'Display', prefix: 'Prefix', suffix: 'Suffix',
  };

  const label = (key) => LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

  function listChanges(before = [], after = []) {
    const keyOf = (o, i) => o?.id ?? o?.name ?? `#${i}`;
    const was = new Map(before.map((o, i) => [keyOf(o, i), { o, i }]));
    const now = new Map(after.map((o, i) => [keyOf(o, i), { o, i }]));
    const items = [];
    let unchanged = 0;
    const keptBefore = before.map(keyOf).filter((k) => now.has(k));
    const keptAfter = after.map(keyOf).filter((k) => was.has(k));
    after.forEach((o, i) => {
      const k = keyOf(o, i);
      const prev = was.get(k)?.o;
      if (!prev) { items.push({ before: null, after: o, marks: ['added'] }); return; }
      const marks = [];
      if ((prev.name ?? '') !== (o.name ?? '')) marks.push('renamed');
      if ((prev.hue ?? '') !== (o.hue ?? '') || (prev.color ?? '') !== (o.color ?? '')) marks.push('recoloured');
      if ((prev.icon ?? '') !== (o.icon ?? '')) marks.push('icon changed');
      if ((prev.category ?? '') !== (o.category ?? '')) marks.push('category changed');
      if (keptBefore.indexOf(k) !== keptAfter.indexOf(k)) marks.push('moved');
      if (marks.length) items.push({ before: prev, after: o, marks });
      else unchanged++;
    });
    before.forEach((o, i) => { if (!now.has(keyOf(o, i))) items.push({ before: o, after: null, marks: ['removed'] }); });
    return { items, unchanged };
  }

  function words(text) { return String(text ?? '').split(/(\s+)/).filter((w) => w !== ''); }

  function textDiff(before, after) {
    const a = words(before), b = words(after);
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    const out = [];
    const push = (op, text) => {
      const last = out[out.length - 1];
      if (last?.op === op) last.text += text; else out.push({ op, text });
    };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { push('=', a[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) push('-', a[i++]);
      else push('+', b[j++]);
    }
    while (i < n) push('-', a[i++]);
    while (j < m) push('+', b[j++]);
    return out;
  }

  function optionNames(ids, options) {
    if (ids == null) return null;
    const byId = new Map((options ?? []).map((o) => [o.id, o.name]));
    return [].concat(ids).map((id) => byId.get(id) ?? id);
  }

  function changes(detail) {
    const before = detail?.before ?? { config: {} };
    const after = detail?.after ?? { config: {} };
    const keys = detail?.changed ?? [];
    return keys.map((key) => {
      if (key === 'name' || key === 'type') return { key, label: label(key), kind: 'value', before: before[key] ?? null, after: after[key] ?? null };
      const b = before.config?.[key], a = after.config?.[key];
      if (key === 'options' || key === 'states') return { key, label: label(key), kind: 'list', ...listChanges(b ?? [], a ?? []) };
      if (key === 'expression') return { key, label: label(key), kind: 'text', before: b ?? '', after: a ?? '', diff: textDiff(b, a) };
      if (key === 'default' && (before.config?.options || after.config?.options)) {
        return { key, label: label(key), kind: 'value', before: optionNames(b, before.config?.options), after: optionNames(a, after.config?.options) };
      }
      return { key, label: label(key), kind: 'value', before: b ?? null, after: a ?? null };
    });
  }

  function formatValue(v) {
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return v.length ? v.map(formatValue).join(', ') : '—';
    if (typeof v === 'boolean') return v ? 'On' : 'Off';
    if (typeof v === 'object') return v.name ?? JSON.stringify(v);
    return String(v);
  }

  root.WeaveFieldDiff = { changes, listChanges, textDiff, formatValue, label };
})(typeof window !== 'undefined' ? window : globalThis);
