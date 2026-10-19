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

  const FORMATS = [
    { key: 'md', label: 'Markdown', ext: '.md' },
    { key: 'mmd', label: 'Mermaid', ext: '.mmd' },
    { key: 'html', label: 'HTML', ext: '.html' },
    { key: 'pdf', label: 'PDF', ext: '.pdf' },
    { key: 'csv', label: 'CSV', ext: '.csv' },
    { key: 'json', label: 'JSON', ext: '.json' },
  ];

  function exportSection({ name = 'export', serves = [], href }) {
    const want = new Set(serves);
    for (const k of want) if (!FORMATS.some((f) => f.key === k)) throw new Error(`unknown export format "${k}"`);
    return FORMATS.filter((f) => want.has(f.key))
      .map((f) => ({ key: f.key, label: f.label, hint: f.ext, section: 'export', href: href(f.key), download: `${name}${f.ext}` }));
  }

  const KINDS = {
    table: { settings: ['description'], organize: ['move', 'duplicate'], share: ['share', 'share-page', 'forms', 'create-link'], export: ['csv'], delete: ['delete'] },
    record: { organize: ['duplicate'], share: ['share'], export: ['md', 'html', 'pdf'], delete: ['delete'] },
    doc: { export: ['md', 'mmd', 'html', 'pdf'] },
    space: { delete: ['delete'] },
    'share-page': { delete: ['delete'] },
    workspace: { share: ['invite', 'link-preview'] },
    field: { settings: ['settings'], organize: ['insert'], delete: ['delete'] },
  };

  const kinds = () => Object.keys(KINDS);

  function definition(kind) {
    const def = KINDS[kind];
    if (!def) throw new Error(`no menu definition for "${kind}"`);
    return def;
  }

  function assemble(kind, rows = {}) {
    const def = definition(kind);
    const ids = new Set(SECTIONS.flatMap((s) => (s === 'export' ? [] : def[s] ?? [])));
    for (const id of Object.keys(rows)) {
      if (id !== 'export' && !ids.has(id)) throw new Error(`"${id}" is not on the ${kind} menu`);
    }
    const formats = def.export ?? [];
    for (const r of rows.export ?? []) {
      if (!formats.includes(r.key)) throw new Error(`${r.label} is not on the ${kind} menu`);
    }
    const out = [];
    for (const section of SECTIONS) {
      if (section === 'export') {
        for (const key of formats) {
          const r = (rows.export ?? []).find((x) => x.key === key);
          if (r) out.push({ ...r, section, id: key });
        }
        continue;
      }
      for (const id of def[section] ?? []) {
        if (rows[id]) out.push({ ...rows[id], section, id });
      }
    }
    return out;
  }

  root.menuCore = { SECTIONS, FORMATS, plan, move, typeahead, exportSection, kinds, definition, assemble };
})(typeof window !== 'undefined' ? window : globalThis);
