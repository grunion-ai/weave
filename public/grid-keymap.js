/* The grid keymap, the pure half (Feature #134 — REST).

   Kyle, 2026-08-24: "I want to nav with L and R and tab". That decides the
   shape. ← and → cannot navigate while a cell is a live text input — the
   caret is already using them — so cells REST as values and open on
   purpose. Two things fall out for free: Space is unclaimed at rest, so
   keyboard row selection costs nothing, and hover finally has a job.

   Ported from the study's core in docs/mockups/table-grid-keymaps.html
   (test/grid-patterns.test.mjs presses that one). No DOM here: a keystroke
   plus a grid state resolves to a verb, and public/app.js carries it out.

   state  { mode: 'rest' | 'edit', readonly, sel: Set }
   verb   { type, ... }
     move / commitMove {dr,dc,wrap?}  · move, saving first if it must
     edit {select}  · revert          · open the cell · back out of it
     open                             · open the record
     newRow {at,focus}                · create an item
     toggleSelect / extendSelect {dir} / selectAll / clearSelect
     none                             · the browser keeps it */
(() => {
  const printable = (key) => key.length === 1 && key !== ' ';
  const MOVE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  /* At rest the grid is a map: all four arrows and Tab move, Space is free
     for selection, Return and any character open the cell. */
  const restKeys = (k, s) => {
    if (k.key === 'Tab') return { type: 'move', dr: 0, dc: k.shift ? -1 : 1, wrap: 'grid' };
    if (k.key === 'Enter' && k.meta) return { type: 'open' };
    if (k.key === 'Enter' && k.shift) return { type: 'newRow', at: 'below', focus: 'first' };
    if (k.key === 'Enter') return s.readonly ? { type: 'none' } : { type: 'edit', select: 'all' };
    if (k.key === 'a' && k.meta) return { type: 'selectAll' };
    if (k.shift && (k.key === 'ArrowUp' || k.key === 'ArrowDown')) return { type: 'extendSelect', dir: k.key === 'ArrowUp' ? -1 : 1 };
    if (MOVE[k.key]) return { type: 'move', dr: MOVE[k.key][0], dc: MOVE[k.key][1] };
    if (k.key === ' ') return { type: 'toggleSelect' };
    if (k.key === 'Escape') return s.sel.size ? { type: 'clearSelect' } : { type: 'none' };
    if (printable(k.key) && !k.meta) return s.readonly ? { type: 'none' } : { type: 'edit', select: 'replace' };
    return { type: 'none' };
  };

  /* Inside an open cell: Return commits down the column, Tab commits across,
     Esc reverts, ↑↓ commit and move. Everything else is the caret's. */
  const openKeys = (k) => {
    if (k.key === 'Tab') return { type: 'commitMove', dr: 0, dc: k.shift ? -1 : 1, wrap: 'grid' };
    if (k.key === 'Enter' && k.meta) return { type: 'open' };
    if (k.key === 'Enter' && k.shift) return { type: 'newRow', at: 'below', focus: 'first' };
    if (k.key === 'Enter') return { type: 'commitMove', dr: 1, dc: 0 };
    if (k.key === 'ArrowUp' || k.key === 'ArrowDown') return { type: 'commitMove', dr: k.key === 'ArrowUp' ? -1 : 1, dc: 0 };
    if (k.key === 'Escape') return { type: 'revert' };
    /* EDGE would branch here: with a caret at the end of the text, → steps
       out into the next cell (and ← at the start into the previous one),
       ⇧← / ⇧→ staying with text selection. It is a setting, not a verdict
       (Feature #134, "Still open"), and is not built. REST gives the
       horizontal arrows to the caret, always. */
    return { type: 'none' };
  };

  globalThis.WeaveGridKeymap = {
    keymap(k, s) {
      return s.mode === 'edit' ? openKeys(k, s) : restKeys(k, s);
    },

    /* The keystroke a DOM KeyboardEvent carries, in the shape keymap reads.
       ⌘ and Ctrl are one modifier: the grid does not care which hand. */
    keyOf(e) {
      return { key: e.key, meta: !!(e.metaKey || e.ctrlKey), shift: !!e.shiftKey, alt: !!e.altKey };
    },

    /* Where a move lands on a grid of `rows` × `cols` stops, or null when it
       lands nowhere — an arrow at the edge stays put, and Tab at the last
       cell of the last row is the end of the grid rather than the start of
       the browser chrome (Issue #84). `wrap: 'grid'` carries Tab into the
       next row and ⇧Tab into the previous one. */
    step({ r, c, rows, cols }, { dr = 0, dc = 0, wrap = null }) {
      let nr = r + dr, nc = c + dc;
      if (wrap === 'grid') {
        if (nc > cols - 1) { nc = 0; nr += 1; }
        else if (nc < 0) { nc = cols - 1; nr -= 1; }
      }
      if (nr < 0 || nr > rows - 1 || nc < 0 || nc > cols - 1) return null;
      if (nr === r && nc === c) return null;
      return { r: nr, c: nc };
    },

    /* ⇧↑ / ⇧↓: the selection is the span between the anchor and the cursor,
       in drawn order, keyed on entity ids like the checkbox column's
       shift-click (Feature #132). No anchor yet: the row you are on becomes
       it. The cursor holds at either end. */
    extend({ ids, anchor, at, dir }) {
      const a = anchor ?? at;
      const i = ids.indexOf(at);
      const next = ids[Math.max(0, Math.min(ids.length - 1, i + dir))] ?? at;
      const lo = Math.min(ids.indexOf(a), ids.indexOf(next));
      const hi = Math.max(ids.indexOf(a), ids.indexOf(next));
      return { anchor: a, at: next, selected: new Set(ids.slice(lo, hi + 1)) };
    },
  };
})();
