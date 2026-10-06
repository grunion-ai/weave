(() => {
  const printable = (key) => key.length === 1 && key !== ' ';
  const MOVE = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

  const restKeys = (k, s) => {
    if (k.key === 'Tab') return { type: 'move', dr: 0, dc: k.shift ? -1 : 1, wrap: 'grid' };
    if (k.key === 'Enter' && k.meta) return { type: 'open' };
    if (k.key === 'Enter' && k.shift) return { type: 'newRow', at: 'below', focus: 'first' };
    if (k.key === 'Enter') return s.readonly ? { type: 'none' } : { type: 'edit', select: 'all' };
    if (k.key === 'a' && k.meta) return { type: 'selectAll' };
    if (k.key === 'End') return { type: 'move', to: 'end' };
    if (k.key === 'Home') return { type: 'move', to: 'home' };
    if (k.shift && MOVE[k.key]) {
      const [dr, dc] = MOVE[k.key];
      if (dc === 0 && s.sel.size) return { type: 'extendSelect', dir: dr };
      return { type: 'extendRange', dr, dc };
    }
    if (MOVE[k.key]) return { type: 'move', dr: MOVE[k.key][0], dc: MOVE[k.key][1] };
    if (k.key === ' ') return s.flip && !s.readonly ? { type: 'edit', select: 'all' } : { type: 'toggleSelect' };
    if (k.key === 'Escape') return s.sel.size ? { type: 'clearSelect' } : s.range ? { type: 'clearRange' } : { type: 'none' };
    if (s.rate) {
      if (s.readonly || k.meta) return { type: 'none' };
      if (/^[0-9]$/.test(k.key)) return { type: 'rate', value: Math.min(Number(k.key), s.rate) };
      if (k.key === 'Backspace' || k.key === 'Delete') return { type: 'rate', value: 0 };
      if (printable(k.key)) return { type: 'none' };
    }
    if (k.key === '?' && !k.meta) return { type: 'help' };
    if (printable(k.key) && !k.meta) return s.readonly ? { type: 'none' } : { type: 'edit', select: 'replace' };
    return { type: 'none' };
  };

  const openKeys = (k) => {
    if (k.key === 'Tab') return { type: 'commitMove', dr: 0, dc: k.shift ? -1 : 1, wrap: 'grid' };
    if (k.key === 'Enter' && k.meta) return { type: 'open' };
    if (k.key === 'Enter' && k.shift) return { type: 'newRow', at: 'below', focus: 'first' };
    if (k.key === 'Enter') return { type: 'commitMove', dr: 1, dc: 0 };
    if (k.key === 'ArrowUp' || k.key === 'ArrowDown') return { type: 'commitMove', dr: k.key === 'ArrowUp' ? -1 : 1, dc: 0 };
    if (k.key === 'Escape') return { type: 'revert' };
    if ((k.key === 'End' || k.key === 'Home') && !k.shift && !k.meta && !k.alt) {
      return { type: 'caret', to: k.key === 'End' ? 'end' : 'home' };
    }
    return { type: 'none' };
  };

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

    clipboardTarget({ mode, selectionCollapsed = true }) {
      return mode === 'edit' && selectionCollapsed === false ? 'text' : 'cell';
    },

    keyOf(e) {
      return { key: e.key, meta: !!(e.metaKey || e.ctrlKey), shift: !!e.shiftKey, alt: !!e.altKey };
    },

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
