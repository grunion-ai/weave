(function (root) {
  const VIEW_SHAPES = ['chip', 'card'];
  const DESCRIPTION_SIZES = ['none', 'small', 'medium', 'large'];
  const EXCLUDED = ['document', 'attachments', 'key', 'field', 'view'];

  function viewSegments(v) {
    const out = [];
    if (v?.state) out.push({ kind: 'state', label: 'State', value: v.state.name, category: v.state.category });
    for (const f of v?.fields ?? []) {
      if (f.value == null || f.value === '') continue;
      const extra = {};
      for (const k of ['meter', 'rating', 'spark']) if (f[k]) extra[k] = f[k];
      out.push({ kind: 'field', label: f.label, value: String(f.value), ...extra });
    }
    return out;
  }

  function viewTitle(v) {
    const id = v?.publicId != null ? `#${v.publicId}` : '';
    const name = String(v?.name ?? '').trim();
    if (v?.link) return name ? `${id} ${name}`.trim() : id;
    return name || id;
  }

  function eligibleFields(db) {
    return (db?.fields ?? []).filter((f) => f.role !== 'name' && f.type !== 'workflow' && !EXCLUDED.includes(f.type));
  }

  root.weaveViewCore = { VIEW_SHAPES, DESCRIPTION_SIZES, EXCLUDED, viewSegments, viewTitle, eligibleFields };
})(globalThis);
