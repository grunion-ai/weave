(function (root) {
  const norm = (s) => String(s ?? '').toLowerCase();
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function rankOptions(options, query) {
    const q = norm(query).trim();
    if (!q) return options.slice();
    const word = new RegExp(`\\b${escapeRe(q)}`);
    const scored = [];
    options.forEach((o, i) => {
      const label = norm(o.label);
      const tier = label === q ? 0
        : label.startsWith(q) ? 1
        : word.test(label) ? 2
        : label.includes(q) ? 3
        : norm(o.hint).includes(q) ? 4
        : -1;
      if (tier >= 0) scored.push({ o, tier, i });
    });
    scored.sort((a, b) => a.tier - b.tier || a.i - b.i);
    return scored.map((s) => s.o);
  }

  function blank({ mode = 'multi', options = [], staged = [], currentId = null, clearId = null }) {
    const cur = mode === 'single' ? options.findIndex((o) => o.id === currentId) : -1;
    const chips = mode === 'single'
      ? (cur >= 0 ? [options[cur]] : [])
      : staged.slice();
    return { mode, options, staged: chips, query: '', active: cur, caret: null, clearId, currentId };
  }

  const ids = (state) => state.staged.map((x) => x.id);
  const has = (state, id) => state.staged.some((x) => x.id === id);

  const visible = (state) => {
    const ranked = rankOptions(state.options, state.query);
    return state.mode === 'single' ? ranked : ranked.filter((o) => !has(state, o.id));
  };

  function search(state, query) {
    return { ...state, query, active: String(query).trim() ? 0 : -1, caret: null };
  }

  function toggle(state, option) {
    const staged = has(state, option.id)
      ? state.staged.filter((x) => x.id !== option.id)
      : [...state.staged, option];
    return { ...state, staged, query: '', active: -1, caret: null };
  }

  function removeAt(state, index, land = 'prev') {
    if (index < 0 || index >= state.staged.length) return state;
    const staged = state.staged.filter((_, i) => i !== index);
    const last = staged.length - 1;
    const caret = !staged.length || land === 'text' ? null
      : land === 'next' ? Math.min(index, last)
      : Math.min(Math.max(index - 1, 0), last);
    return { ...state, staged, caret, active: -1 };
  }

  const removeId = (state, id, land = 'text') =>
    removeAt(state, state.staged.findIndex((x) => x.id === id), land);

  const pass = () => ({ state: null, effect: null, handled: false });
  const took = (state, effect = null) => ({ state, effect, handled: true });

  function keyDown(state, { key, atStart = true, quick = null } = {}) {
    const vis = visible(state);
    const typed = state.query !== '';

    if (quick != null) {
      const o = vis[quick - 1];
      if (!o) return took(state);
      if (state.mode === 'single') return took(state, { type: 'pick', option: o });
      return took(toggle(state, o));
    }

    if (key === 'ArrowDown') return took({ ...state, caret: null, active: Math.min(state.active + 1, vis.length - 1) });
    if (key === 'ArrowUp') return took({ ...state, caret: null, active: Math.max(state.active - 1, 0) });

    if (key === 'ArrowLeft') {
      if (!atStart || !state.staged.length) return pass();
      const caret = state.caret == null ? state.staged.length - 1 : Math.max(0, state.caret - 1);
      return took({ ...state, caret, active: -1 });
    }
    if (key === 'ArrowRight') {
      if (state.caret == null) return pass();
      const next = state.caret + 1;
      return took({ ...state, caret: next > state.staged.length - 1 ? null : next });
    }

    if (key === 'Backspace' || key === 'Delete') {
      if (typed) return pass();
      if (state.mode === 'single') {
        if (!state.staged.length || !state.clearId) return pass();
        return took(state, { type: 'pick', option: { id: state.clearId, label: state.clearId } });
      }
      if (state.caret != null) return took(removeAt(state, state.caret, key === 'Delete' ? 'next' : 'prev'));
      if (key === 'Delete' || !state.staged.length) return pass();
      return took(removeAt(state, state.staged.length - 1, 'text'));
    }

    if (key === 'Enter') {
      const pick = vis[state.active] ?? (state.query.trim() ? vis[0] : null);
      if (pick) {
        return state.mode === 'single'
          ? took(state, { type: 'pick', option: pick })
          : took(toggle(state, pick));
      }
      if (state.query.trim()) return took(state);
      return took(state, { type: 'commit' });
    }
    if (key === 'Escape') return took(state, { type: 'close' });
    return pass();
  }

  root.pickerCore = { rankOptions, blank, visible, ids, has, search, toggle, removeAt, removeId, keyDown };
})(typeof window !== 'undefined' ? window : globalThis);
