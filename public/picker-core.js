/* Pure logic behind the token-box picker (Kyle, 2026-08-25).

   The picker's search bar IS the value: the chips already chosen sit inside
   the cursor box, ahead of the caret, so one box holds both what is selected
   and what is being typed. That makes the whole field keyboard-reachable —
   ← → walk the chips, Backspace/Delete removes one, typing filters the list
   with the TOP FIT already armed so Enter adds it, ↑ ↓ move that arming, and
   Enter on an empty search saves.

   Two dialects, because selection means different things:
     multi   multiselect and linked records — Enter toggles, chips accumulate,
             the edit commits as a set.
     single  select and workflow states — a pick OVERWRITES, so it commits and
             closes on the spot and the box carries at most one chip.

   Classic script + ESM in one file, same pattern as chip-core.js: the browser
   reads the window global, node imports the same source. Nothing here touches
   `document` — the DOM half lives in app.js (searchPicker). */
(function (root) {
  const norm = (s) => String(s ?? '').toLowerCase();
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* ---------- what the search points at ----------
     "Top fit" is not "first option that contains the letters": typing 'do'
     against Done / Backlog-doc / To do must arm Done. Exact beats prefix
     beats word-prefix beats anywhere-in-label beats a hint-only match, and
     inside a tier the author's own order stands. */
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

  /* State: `staged` are the chips in the box, `query` is the text after them,
     `active` indexes the visible list (-1 = nothing armed), and `caret` says
     where the cursor is — null for the text, otherwise the chip it sits on. */
  function blank({ mode = 'multi', options = [], staged = [], currentId = null, clearId = null }) {
    const cur = mode === 'single' ? options.findIndex((o) => o.id === currentId) : -1;
    const chips = mode === 'single'
      ? (cur >= 0 ? [options[cur]] : [])
      : staged.slice();
    return { mode, options, staged: chips, query: '', active: cur, caret: null, clearId, currentId };
  }

  const visible = (state) => rankOptions(state.options, state.query);
  const ids = (state) => state.staged.map((x) => x.id);
  const has = (state, id) => state.staged.some((x) => x.id === id);

  /* Typing arms the top fit — Enter is then "add what I searched for". An
     empty search arms nothing, which is what makes Enter mean "done". */
  function search(state, query) {
    return { ...state, query, active: String(query).trim() ? 0 : -1, caret: null };
  }

  function toggle(state, option) {
    const staged = has(state, option.id)
      ? state.staged.filter((x) => x.id !== option.id)
      : [...state.staged, option];
    return { ...state, staged, query: '', active: -1, caret: null };
  }

  /* Removing chip `index`. `land` says where the cursor goes after: 'prev'
     for Backspace (the chip before it), 'next' for Delete (the one that
     slides into its place), 'text' when the cursor never left the caret. */
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

  /* One keystroke. Returns { state, effect, handled }: `handled` false means
     the key was never ours (plain typing, text navigation) and the input must
     keep it. Effects are the caller's to run — 'pick' overwrites and closes,
     'commit' saves the staged set, 'close' walks away. */
  function keyDown(state, { key, atStart = true } = {}) {
    const vis = visible(state);
    const typed = state.query !== '';
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
        // A single select overwrites, so "remove the chip" is a pick of the
        // clear option — the same commit-and-close any other pick makes. A
        // workflow state has no clear option and so cannot be emptied.
        if (!state.staged.length || !state.clearId) return pass();
        return took(state, { type: 'pick', option: { id: state.clearId, label: state.clearId } });
      }
      if (state.caret != null) return took(removeAt(state, state.caret, key === 'Delete' ? 'next' : 'prev'));
      if (key === 'Delete' || !state.staged.length) return pass();
      return took(removeAt(state, state.staged.length - 1, 'text'));
    }

    if (key === 'Enter') {
      const pick = vis[state.active] ?? (state.query.trim() ? vis[0] : null);
      if (state.mode === 'single') return took(state, pick ? { type: 'pick', option: pick } : { type: 'commit' });
      return pick ? took(toggle(state, pick)) : took(state, { type: 'commit' });
    }
    if (key === 'Escape') return took(state, { type: 'close' });
    return pass();
  }

  root.pickerCore = { rankOptions, blank, visible, ids, has, search, toggle, removeAt, removeId, keyDown };
})(typeof window !== 'undefined' ? window : globalThis);
