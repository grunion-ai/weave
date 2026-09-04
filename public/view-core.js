/* Pure logic behind the chip and the card (Kyle, 2026-09-04): what one row
   looks like inline and as a tile, drawn from the object the engine's
   renderView hands back. Classic script + ESM in one file, same pattern as
   chip-core.js: the browser reads the window global, node imports the same
   source for test/view-fields-ui.test.mjs. No DOM here — app.js builds the
   elements from these parts, so a relation cell, a doc mention, a reference
   card and the entity page's own preview cannot disagree. */
(function (root) {
  const VIEW_SHAPES = ['chip', 'card'];
  const DESCRIPTION_SIZES = ['none', 'small', 'medium', 'large'];
  /* What may ride on a view: a value a reader takes in at a glance. Mirrors
     the engine's VIEW_EXCLUDED_TYPES (source-gated). */
  const EXCLUDED = ['document', 'attachments', 'key', 'field', 'view'];

  /* The segments after the name, in the order they draw: the state, then
     the fields with something in them. */
  function viewSegments(v) {
    const out = [];
    if (v?.state) out.push({ kind: 'state', label: 'State', value: v.state.name, category: v.state.category });
    for (const f of v?.fields ?? []) {
      if (f.value == null || f.value === '') continue;
      out.push({ kind: 'field', label: f.label, value: String(f.value) });
    }
    return out;
  }

  /* The headline: the #id when the view links, then the name. A nameless
     row is still its number. */
  function viewTitle(v) {
    const id = v?.publicId != null ? `#${v.publicId}` : '';
    const name = String(v?.name ?? '').trim();
    if (v?.link) return name ? `${id} ${name}`.trim() : id;
    return name || id;
  }

  /* The fields a view's config may name, in column order. */
  function eligibleFields(db) {
    return (db?.fields ?? []).filter((f) => f.role !== 'name' && f.type !== 'workflow' && !EXCLUDED.includes(f.type));
  }

  root.weaveViewCore = { VIEW_SHAPES, DESCRIPTION_SIZES, EXCLUDED, viewSegments, viewTitle, eligibleFields };
})(globalThis);
