(() => {
  const clone = (s) => ({
    anchor: { ...s.anchor },
    filter: s.filter ? { ...s.filter } : null,
    chain: s.chain.map((f) => ({ ...f })),
    pose: s.pose,
  });

  const init = (anchor) => ({ anchor: { ...anchor }, filter: null, chain: [], pose: 'closed' });

  const open = (s, frame) => {
    if (frame.kind !== 'entity') return s;
    const n = clone(s);
    n.chain = [{ ...frame }];
    if (n.pose === 'closed') n.pose = 'split';
    return n;
  };

  const drill = (s, frame) => {
    if (!s.chain.length) return open(s, frame);
    const top = s.chain[s.chain.length - 1];
    if (top.kind === frame.kind && (top.id ?? top.field) === (frame.id ?? frame.field)) return s;
    const n = clone(s);
    n.chain.push({ ...frame });
    return n;
  };

  const popTo = (s, i) => {
    if (i < 0) return popTable(s);
    if (i >= s.chain.length - 1) return s;
    const n = clone(s);
    n.chain = n.chain.slice(0, i + 1);
    return n;
  };

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

  const escape = (s) => {
    if (s.chain.length > 1) return popTo(s, s.chain.length - 2);
    if (s.pose === 'expanded') { const n = clone(s); n.pose = 'split'; return n; }
    return close(s);
  };

  const selectionId = (s) => {
    if (s.pose === 'closed' || !s.chain.length) return null;
    const owner = [...s.chain].reverse().find((f) => f.kind === 'entity');
    if (!owner) return null;
    if (owner.tableId === s.anchor.tableId) return owner.id;
    const root = s.chain[0];
    return root.kind === 'entity' && root.tableId === s.anchor.tableId ? root.id : null;
  };

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
