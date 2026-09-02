/* One entity surface: the pane state machine (2026-09-02).
   The split dock replaces both the side peek and the entity page — one
   renderer in three poses (closed / split / expanded), a drill chain, and
   a crumb that is the only way back. This core is pure and DOM-free so the
   rules live under test; app.js only paints what these functions return.

   Frames: { kind:'entity', id, name, tableId, tableName }
        or { kind:'doc', field, name } (a document opened full, owned by the
           nearest entity frame beneath it).
   State: { anchor:{tableId,tableName}, filter, chain:[frame], pose }.
   Every transition returns a fresh state; nothing here mutates its input. */
(() => {
  const clone = (s) => ({
    anchor: { ...s.anchor },
    filter: s.filter ? { ...s.filter } : null,
    chain: s.chain.map((f) => ({ ...f })),
    pose: s.pose,
  });

  const init = (anchor) => ({ anchor: { ...anchor }, filter: null, chain: [], pose: 'closed' });

  /* Only an entity can be a root: a doc frame is owned by the entity
     beneath it, so there is nothing for a doc-rooted pane to select. */
  const open = (s, frame) => {
    if (frame.kind !== 'entity') return s;
    const n = clone(s);
    n.chain = [{ ...frame }];
    if (n.pose === 'closed') n.pose = 'split';
    return n;
  };

  /* A drill into a closed pane is an open — there is no chain to grow, and
     a frame sitting in a closed pane would paint nothing and select nobody. */
  const drill = (s, frame) => {
    if (!s.chain.length) return open(s, frame);
    const top = s.chain[s.chain.length - 1];
    if (top.kind === frame.kind && (top.id ?? top.field) === (frame.id ?? frame.field)) return s;
    const n = clone(s);
    n.chain.push({ ...frame });
    return n;
  };

  /* Clicking the frame already on top changes nothing; an index below the
     root is the table segment. */
  const popTo = (s, i) => {
    if (i < 0) return popTable(s);
    if (i >= s.chain.length - 1) return s;
    const n = clone(s);
    n.chain = n.chain.slice(0, i + 1);
    return n;
  };

  /* The table segment of the crumb: from expanded it re-docks to the root,
     from split it closes — you are already looking at the table. */
  const popTable = (s) => {
    const n = clone(s);
    if (n.pose === 'expanded') { n.pose = 'split'; n.chain = n.chain.slice(0, 1); }
    else { n.pose = 'closed'; n.chain = []; }
    return n;
  };

  const toggle = (s) => {
    if (s.pose === 'closed') return s;
    const n = clone(s);
    n.pose = n.pose === 'expanded' ? 'split' : 'expanded';
    return n;
  };

  const close = (s) => {
    const n = clone(s);
    n.pose = 'closed';
    n.chain = [];
    return n;
  };

  /* Esc pops exactly one level: doc → entity → split → closed. */
  const escape = (s) => {
    if (s.chain.length > 1) return popTo(s, s.chain.length - 2);
    if (s.pose === 'expanded') { const n = clone(s); n.pose = 'split'; return n; }
    return close(s);
  };

  /* Wrap-around selection: the anchor table lights the pane's top entity
     when it lives there, else the chain root, else nobody. A doc frame is
     skipped — its owner is the nearest entity beneath it. */
  const selectionId = (s) => {
    if (s.pose === 'closed' || !s.chain.length) return null;
    const owner = [...s.chain].reverse().find((f) => f.kind === 'entity');
    if (!owner) return null;
    if (owner.tableId === s.anchor.tableId) return owner.id;
    const root = s.chain[0];
    return root.kind === 'entity' && root.tableId === s.anchor.tableId ? root.id : null;
  };

  /* The crumb model. Terse (just "#pid") only when split at an undrilled
     root; otherwise the full trail. Home tags mark frames living outside
     the anchor table — the same k-home treatment relation chips use. */
  const crumb = (s) => {
    const segments = [{ type: 'table', label: s.anchor.tableName }];
    s.chain.forEach((f, i) => {
      segments.push({
        type: 'frame', index: i, label: f.name,
        last: i === s.chain.length - 1,
        homeTag: f.kind === 'entity' && f.tableName !== s.anchor.tableName ? f.tableName : null,
      });
    });
    return { segments, terse: s.pose === 'split' && s.chain.length === 1 };
  };

  /* The two deliberate table swaps. reanchor: a cross-table frame becomes
     the new root in its own table. viewAsTable: a related collection becomes
     the anchor with its relation filter on; the pane stays where it was. */
  const reanchor = (s, i) => {
    const f = s.chain[i];
    if (!f || f.kind !== 'entity') return s;
    const n = clone(s);
    n.anchor = { tableId: f.tableId, tableName: f.tableName };
    n.filter = null;
    n.chain = [{ ...f }];
    n.pose = 'split';
    return n;
  };

  const viewAsTable = (s, table, filter) => {
    const n = clone(s);
    n.anchor = { tableId: table.tableId, tableName: table.tableName };
    n.filter = filter ? { ...filter } : null;
    return n;
  };

  const clearFilter = (s) => {
    const n = clone(s);
    n.filter = null;
    return n;
  };

  /* Linear history with forward truncation, like a browser. Snapshots are
     deep copies both ways, so live-state mutation can't rewrite the past. */
  const hInit = () => ({ stack: [], idx: -1 });
  const hPush = (h, s) => {
    const stack = h.stack.slice(0, h.idx + 1);
    stack.push(clone(s));
    return { stack, idx: stack.length - 1 };
  };
  const hCanBack = (h) => h.idx > 0;
  const hCanFwd = (h) => h.idx < h.stack.length - 1;
  const hBack = (h) => hCanBack(h)
    ? { hist: { stack: h.stack, idx: h.idx - 1 }, state: clone(h.stack[h.idx - 1]) } : null;
  const hFwd = (h) => hCanFwd(h)
    ? { hist: { stack: h.stack, idx: h.idx + 1 }, state: clone(h.stack[h.idx + 1]) } : null;

  globalThis.weaveEntitySurface = {
    init, open, drill, popTo, popTable, toggle, close, escape,
    selectionId, crumb, reanchor, viewAsTable, clearFilter,
    hInit, hPush, hCanBack, hCanFwd, hBack, hFwd,
  };
})();
