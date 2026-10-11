(function (root) {
  const SECTIONS = ['settings', 'organize', 'share', 'export', 'delete'];
  const LABELS = { export: 'Export' };

  function check(it) {
    if (typeof it.label !== 'string' || !it.label.trim()) throw new Error('a menu row needs a label');
    if (!SECTIONS.includes(it.section)) throw new Error(`unknown menu section "${it.section}" on "${it.label}"`);
    if (typeof it.run !== 'function' && typeof it.href !== 'string') throw new Error(`menu row "${it.label}" has nothing to run`);
  }

  function plan(items, { sheet = false } = {}) {
    const rows = (items ?? []).filter(Boolean);
    rows.forEach(check);
    const shown = rows.filter((it) => sheet || !it.phone);
    const out = [];
    for (const section of SECTIONS) {
      const mine = shown.filter((it) => it.section === section);
      if (!mine.length) continue;
      if (section === 'delete' && mine.length > 1) throw new Error(`a menu holds one delete row, got ${mine.map((i) => `"${i.label}"`).join(', ')}`);
      out.push({ section, label: LABELS[section] ?? null, items: mine });
    }
    return out;
  }

  function move(count, index, key) {
    if (!count) return null;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
    if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
    return null;
  }

  function typeahead(labels, from, buffer) {
    const want = String(buffer ?? '').toLowerCase();
    if (!want || !labels.length) return -1;
    const start = want.length > 1 ? from : from + 1;
    for (let k = 0; k < labels.length; k++) {
      const i = (((start + k) % labels.length) + labels.length) % labels.length;
      if (String(labels[i] ?? '').toLowerCase().startsWith(want)) return i;
    }
    return -1;
  }

  root.menuCore = { SECTIONS, plan, move, typeahead };
})(typeof window !== 'undefined' ? window : globalThis);
