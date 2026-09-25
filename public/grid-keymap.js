/* The grid keymap, the pure half (Feature #134 — REST).

   Kyle, 2026-08-24: "I want to nav with L and R and tab". That decides the
   shape. ← and → cannot navigate while a cell is a live text input — the
   caret is already using them — so cells REST as values and open on
   purpose. Two things fall out for free: Space is unclaimed at rest, so
   keyboard row selection costs nothing, and hover finally has a job.

   Ported from the study's core in docs/mockups/table-grid-keymaps.html
   (test/grid-patterns.test.mjs presses that one). No DOM here: a keystroke
   plus a grid state resolves to a verb, and public/app.js carries it out.

   state  { mode: 'rest' | 'edit', readonly, sel: Set, flip?, range?, rate? }
            flip: the cell is a toggle · range: a cell range is live (#220)
            rate: the cell is a rating, and this is its max (#231)
   verb   { type, ... }
     move / commitMove {dr,dc,wrap?}  · move, saving first if it must
     edit {select}  · revert          · open the cell · back out of it
     caret {to}                       · place the caret in the open cell
     open                             · open the record
     newRow {at,focus}                · create an item
     toggleSelect / extendSelect {dir} / selectAll / clearSelect
     extendRange {dr,dc} / clearRange  · the cell range of Feature #220
     rate {value}                     · set a rating cell (#231)
     help                             · the key sheet (Issue #268)
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
    // The first and the last row of the TABLE, not of the drawn window
    // (Issue #271) — the grid scrolls the row in before the cursor lands.
    if (k.key === 'End') return { type: 'move', to: 'end' };
    if (k.key === 'Home') return { type: 'move', to: 'home' };
    /* ⇧-arrows do two jobs, and rows go first (Feature #220 over #134). With
       a row picked up, ⇧↑/⇧↓ extend that run exactly as they did — Space and
       the vertical shift-arrows are one gesture and splitting them would
       break the reading #134 shipped. With no row up, the same keys grow a
       RANGE of cells. ⇧←/⇧→ are always the range's: a run of rows has no
       width, so nothing was ever claiming them. */
    if (k.shift && MOVE[k.key]) {
      const [dr, dc] = MOVE[k.key];
      if (dc === 0 && s.sel.size) return { type: 'extendSelect', dir: dr };
      return { type: 'extendRange', dr, dc };
    }
    if (MOVE[k.key]) return { type: 'move', dr: MOVE[k.key][0], dc: MOVE[k.key][1] };
    // A toggle cell is the one place Space is the value's own key: it
    // flips the switch (Feature #202); everywhere else it picks the row up.
    if (k.key === ' ') return s.flip && !s.readonly ? { type: 'edit', select: 'all' } : { type: 'toggleSelect' };
    // Escape lets go of one thing at a time, rows before cells: the puck is
    // the louder state and the one a reader means when both are up.
    if (k.key === 'Escape') return s.sel.size ? { type: 'clearSelect' } : s.range ? { type: 'clearRange' } : { type: 'none' };
    /* A rating has no text box (Feature #231): a digit is the value,
       Backspace or Delete clears it to 0, and no other character opens it. */
    if (s.rate) {
      if (s.readonly || k.meta) return { type: 'none' };
      if (/^[0-9]$/.test(k.key)) return { type: 'rate', value: Math.min(Number(k.key), s.rate) };
      if (k.key === 'Backspace' || k.key === 'Delete') return { type: 'rate', value: 0 };
      if (printable(k.key)) return { type: 'none' };
    }
    // ? is the one character that does not open the cell: it opens the sheet
    // of these keys, as it does everywhere outside a text field (Issue #268).
    if (k.key === '?' && !k.meta) return { type: 'help' };
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
    /* Home and End are the caret's, and only placing it ourselves keeps them
       there (Issue #260). Left to the browser, Chromium reads a bare End
       inside a single-line field as "scroll to the end of the document": the
       windowed grid (Issue #271) scrolled a thousand rows, recycled the row
       the editor sat in and dropped focus on the floor, while the caret never
       moved — so the reader who meant to append went on typing into the
       middle of the old value. ⇧, ⌥ and ⌘ variants are real editing commands
       (select to the end, walk a word, walk a line) and stay the browser's. */
    if ((k.key === 'End' || k.key === 'Home') && !k.shift && !k.meta && !k.alt) {
      return { type: 'caret', to: k.key === 'End' ? 'end' : 'home' };
    }
    /* EDGE would branch here: with a caret at the end of the text, → steps
       out into the next cell (and ← at the start into the previous one),
       ⇧← / ⇧→ staying with text selection. It is a setting, not a verdict
       (Feature #134, "Still open"), and is not built. REST gives the
       horizontal arrows to the caret, always. */
    return { type: 'none' };
  };

  /* The rows of the key sheet (Issue #268): what each key does, in the words
     the sheet prints, and the presses that reach it. The sheet renders these
     and nothing else, and test/grid-keymap.test.mjs presses every row through
     keymap() and probes keymap() for any key no row names, so a key added
     above without a row here fails the suite. `browser` marks a row whose
     keys the keymap deliberately lets through. */
  const c = (key, mod = {}) => ({ key, ...mod });
  const BINDINGS = [
    { mode: 'rest', keys: '← → ↑ ↓', does: 'move the cursor', press: [c('ArrowLeft'), c('ArrowRight'), c('ArrowUp'), c('ArrowDown')] },
    { mode: 'rest', keys: 'Tab / ⇧Tab', does: 'along the row, wrapping into the next or previous row', press: [c('Tab'), c('Tab', { shift: true })] },
    { mode: 'rest', keys: 'Return', does: 'open the cell', press: [c('Enter')] },
    { mode: 'rest', keys: 'any character', does: 'open the cell and type over the value', press: [c('x'), c('X', { shift: true })] },
    { mode: 'rest', keys: 'Space', does: 'pick the row up, or flip a toggle cell', press: [c(' ')] },
    { mode: 'rest', keys: '⇧↑ / ⇧↓', does: 'extend the chosen rows, or grow a range of cells', press: [c('ArrowUp', { shift: true }), c('ArrowDown', { shift: true })] },
    { mode: 'rest', keys: '⇧← / ⇧→', does: 'grow a range of cells sideways', press: [c('ArrowLeft', { shift: true }), c('ArrowRight', { shift: true })] },
    { mode: 'rest', keys: '⌘A', does: 'take every loaded row', press: [c('a', { meta: true })] },
    { mode: 'rest', keys: 'Home / End', does: 'the first or the last row of the table', press: [c('Home'), c('End')] },
    { mode: 'rest', keys: '⇧Return', does: 'make the next row, open on its name', press: [c('Enter', { shift: true })] },
    { mode: 'rest', keys: '⌘Return', does: 'open the record in the dock', press: [c('Enter', { meta: true })] },
    { mode: 'rest', keys: 'Esc', does: 'let the chosen rows go, then the range', press: [c('Escape')] },
    { mode: 'rest', keys: '?', does: 'this sheet', press: [c('?', { shift: true })] },
    { mode: 'edit', keys: '← →', does: 'the caret’s; they never step out of the cell', press: [c('ArrowLeft'), c('ArrowRight')], browser: true },
    { mode: 'edit', keys: 'Home / End', does: 'the start or the end of the value', press: [c('Home'), c('End')] },
    { mode: 'edit', keys: 'Return', does: 'commit, move down the column', press: [c('Enter')] },
    { mode: 'edit', keys: 'Tab / ⇧Tab', does: 'commit, move across', press: [c('Tab'), c('Tab', { shift: true })] },
    { mode: 'edit', keys: '↑ / ↓', does: 'commit, move up or down', press: [c('ArrowUp'), c('ArrowDown')] },
    { mode: 'edit', keys: '⇧Return', does: 'commit and make the next row', press: [c('Enter', { shift: true })] },
    { mode: 'edit', keys: '⌘Return', does: 'open the record in the dock', press: [c('Enter', { meta: true })] },
    { mode: 'edit', keys: 'Esc', does: 'put the value back and rest', press: [c('Escape')] },
    { mode: 'edit', keys: 'Space, ?', does: 'typed, like any character', press: [c(' '), c('?', { shift: true })], browser: true },
  ];

  globalThis.WeaveGridKeymap = {
    bindings: BINDINGS,

    keymap(k, s) {
      return s.mode === 'edit' ? openKeys(k, s) : restKeys(k, s);
    },

    /* What ⌘C and ⌘V act on (Feature #221 — Kyle, 2026-09-12, "B+"). A
       click opens the cell exactly as before; the clipboard follows the
       SELECTION. Text selected inside the open control is the browser's own
       copy and paste. With no selection — a collapsed caret, a control with
       no caret at all (number, date, select, checkbox), a picker's popover,
       a resting cell — they take the cell, typed, through the same bulk set
       a range paste uses. One rule for every field type. */
    clipboardTarget({ mode, selectionCollapsed = true }) {
      return mode === 'edit' && selectionCollapsed === false ? 'text' : 'cell';
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
