/* Row selection, the pure half (Feature #132).
   The Puck won the five-bars study (Kyle, 2026-08-24), but the arithmetic
   below is what all five shared: which rows are chosen, what the header box
   reads, and which commands a given table can actually offer.

   Selection is a set of ENTITY IDS, never row indices. The grid re-sorts and
   re-filters on every draw, so a selection keyed on position would quietly
   slide onto different rows. `prune` closes the same loop from the other end:
   an id that is no longer drawn is no longer selected. */
globalThis.WeaveSelection = {
  /* Every mutator returns a new Set. The live selection is read during a
     draw, so mutating it in place would let a redraw half-see the change. */
  toggle(selected, id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  },

  selectAll(drawnIds) {
    return new Set(drawnIds);
  },

  prune(selected, drawnIds) {
    const live = new Set(drawnIds);
    return new Set([...selected].filter((id) => live.has(id)));
  },

  /* The header box: 'none' | 'some' | 'all'. 'some' is what wears the
     indeterminate dash. An empty table reads 'none' — there is nothing to
     have selected, so a checked box would be a claim about no rows. */
  headState(selectedCount, total) {
    if (!total || !selectedCount) return 'none';
    return selectedCount >= total ? 'all' : 'some';
  },

  /* Shift-click: everything between the anchor and the clicked row, in the
     order the rows are DRAWN. Either row may be the higher one — a range
     that only ran forwards would return nothing whenever the reader picked
     the lower row first. An end that is no longer on the page yields no
     span rather than a span to the edge of the table. */
  range(drawnIds, anchorId, id) {
    const a = drawnIds.indexOf(anchorId), b = drawnIds.indexOf(id);
    if (a < 0 || b < 0) return [];
    return drawnIds.slice(Math.min(a, b), Math.max(a, b) + 1);
  },

  /* The bar is contextual. A table with no relations gets no "Link to…", and
     a table whose every field is computed gets no "Set a field…" — offering
     a command that can only fail is worse than not offering it.
     State is deliberately absent: a table can carry more than one workflow
     field, so state is a field and lives inside "Set a field…" with the rest
     (the mockup's "Cut, and why", 2026-08-24). */
  barCommands({ relations = [], writableFields = [], built = null } = {}) {
    const cmds = [];
    if (writableFields.length) cmds.push({ id: 'fields', label: 'Set a field…', menu: 'fields' });
    if (relations.length) cmds.push({ id: 'link', label: 'Link to…', menu: 'rels' });
    cmds.push({ id: 'dup', label: 'Duplicate' });
    cmds.push({ id: 'more', label: 'More', menu: 'more' });
    cmds.push({ id: 'trash', label: 'Move to trash', danger: true });
    // A button that cannot do its job yet is worse than an absent one: it
    // reads as broken rather than unbuilt. `built` names what this release
    // can actually run, and the bar carries nothing else.
    return built ? cmds.filter((c) => built.includes(c.id)) : cmds;
  },

  /* The overflow, behind ⋯. Same rule: only what is built reaches it, and an
     empty overflow means the ⋯ itself does not belong on the bar. */
  moreCommands({ built = null, term = null } = {}) {
    const cmds = [
      { id: 'move', label: 'Move to table…' },
      { id: 'rollup', label: `Roll up into a new ${(term && term.singular) || 'record'}…` },
      { id: 'copy', label: 'Copy links' },
    ];
    return built ? cmds.filter((c) => built.includes(c.id)) : cmds;
  },

  /* The puck says what it holds in the table's own term (Feature #40):
     "3 deals", "1 record" when none is set. */
  countLabel(n, term = null) {
    const t = term && term.singular ? term : { singular: 'record', plural: 'records' };
    return `${n} ${n === 1 ? t.singular : t.plural}`;
  },
};
