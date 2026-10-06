globalThis.WeaveSelection = {
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

  headState(selectedCount, total) {
    if (!total || !selectedCount) return 'none';
    return selectedCount >= total ? 'all' : 'some';
  },

  range(drawnIds, anchorId, id) {
    const a = drawnIds.indexOf(anchorId), b = drawnIds.indexOf(id);
    if (a < 0 || b < 0) return [];
    return drawnIds.slice(Math.min(a, b), Math.max(a, b) + 1);
  },

  barCommands({ relations = [], writableFields = [], built = null, more = null } = {}) {
    const cmds = [];
    if (writableFields.length) cmds.push({ id: 'fields', label: 'Set a field…', menu: 'fields' });
    if (relations.length) cmds.push({ id: 'link', label: 'Link to…', menu: 'rels' });
    cmds.push({ id: 'dup', label: 'Duplicate' });
    if (!more || more.length) cmds.push({ id: 'more', label: 'More', menu: 'more' });
    cmds.push({ id: 'trash', label: 'Move to trash', danger: true });
    return built ? cmds.filter((c) => built.includes(c.id)) : cmds;
  },

  moreCommands({ built = null, term = null, relations = [], otherTables = 1 } = {}) {
    const cmds = [];
    if (otherTables > 0) cmds.push({ id: 'move', label: 'Move to table…' });
    if (relations.length) cmds.push({ id: 'rollup', label: `Roll up into a new ${(term && term.singular) || 'record'}…` });
    cmds.push({ id: 'copy', label: 'Copy links' });
    return built ? cmds.filter((c) => built.includes(c.id)) : cmds;
  },

  SETTABLE: ['text', 'number', 'rating', 'date', 'workflow', 'select', 'multiselect', 'checkbox', 'toggle', 'url', 'email'],
  settableFields(fields) {
    return fields.filter((f) => this.SETTABLE.includes(f.type));
  },

  bulkToast({ verb, count, term = null, result }) {
    const failed = result.failed ?? [];
    if (failed.length) return { msg: `${verb}: ${failed.length} of ${count} failed — ${failed[0].error}`, err: true };
    const left = [...new Set((result.moved ?? []).flatMap((m) => m.skipped ?? []))];
    return { msg: `${verb} ${this.countLabel(count, term)}` + (left.length ? ` — left behind: ${left.join(', ')}` : ''), err: false };
  },

  countLabel(n, term = null) {
    const t = term && term.singular ? term : { singular: 'record', plural: 'records' };
    return `${n} ${n === 1 ? t.singular : t.plural}`;
  },
};
