(function (root) {
  const DEFAULTS = {
    nodeW: 190, nodeH: 58,
    gapX: 78, gapY: 30,
    padX: 16, padY: 14,
    titleH: 26,
    selfH: 20,
    autoH: 25,
    top: 10, left: 10, bottom: 16,
    autoCounts: null,
  };

  const card = (many) => (many ? '∗' : '1');

  function border(a, b, w, h) {
    const dx = b.x - a.x, dy = b.y - a.y;
    if (!dx && !dy) return { x: a.x, y: a.y };
    const sx = dx ? (w / 2) / Math.abs(dx) : Infinity;
    const sy = dy ? (h / 2) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: a.x + dx * s, y: a.y + dy * s };
  }

  function relmapLayout(tables, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const all = (tables ?? []).filter((t) => !t.system);
    const byId = new Map(all.map((t) => [t.id, t]));

    const inScope = o.spaceId ? all.filter((t) => t.spaceId === o.spaceId) : all;
    const scope = new Map(inScope.map((t) => [t.id, t]));
    if (o.spaceId) {
      for (const t of inScope) {
        for (const f of t.fields ?? []) {
          for (const tid of (f.type === 'relation' ? (f.targetDbIds ?? [f.targetDbId]) : [])) {
            if (byId.has(tid)) scope.set(tid, byId.get(tid));
          }
        }
      }
      for (const t of all) {
        if (scope.has(t.id)) continue;
        for (const f of t.fields ?? []) {
          const tids = f.type === 'relation' ? (f.targetDbIds ?? [f.targetDbId]) : [];
          if (tids.some((tid) => scope.has(tid) && inScope.some((x) => x.id === tid))) {
            scope.set(t.id, t);
            break;
          }
        }
      }
    }

    const columns = [];
    const colOf = new Map();
    for (const t of all) {
      if (!scope.has(t.id)) continue;
      const key = t.space ?? '';
      if (!colOf.has(key)) { colOf.set(key, columns.length); columns.push({ name: key, tables: [] }); }
      columns[colOf.get(key)].tables.push(t);
    }
    if (!columns.length) return { width: 0, height: 0, groups: [], nodes: [], edges: [] };

    const loops = new Set(all.filter((t) => (t.fields ?? []).some((f) => f.type === 'relation' && f.targetDbId === t.id)).map((t) => t.id));
    const autos = (id) => Number(o.autoCounts?.[id] ?? 0);

    const colW = o.nodeW + o.padX * 2;
    const groups = [];
    const nodes = [];
    let x = o.left;
    for (const col of columns) {
      let cy = o.top + o.titleH + o.padY;
      col.tables.forEach((t, i) => {
        if (i) cy += o.gapY;
        if (loops.has(t.id)) cy += o.selfH;
        nodes.push({
          id: t.id,
          name: t.name,
          space: t.space,
          entityCount: t.entityCount ?? 0,
          term: t.term,
          foreign: !!o.spaceId && t.spaceId !== o.spaceId,
          loop: loops.has(t.id),
          w: o.nodeW,
          h: o.nodeH,
          x: x + o.padX + o.nodeW / 2,
          y: cy + o.nodeH / 2,
        });
        cy += o.nodeH + autos(t.id) * o.autoH;
      });
      groups.push({ name: col.name, x, y: o.top, w: colW, h: cy + o.padY - o.top });
      x += colW + o.gapX;
    }
    const pos = new Map(nodes.map((n) => [n.id, n]));

    const edges = [];
    const seen = new Set();
    for (const t of all) {
      if (!pos.has(t.id)) continue;
      for (const f of t.fields ?? []) {
        if (f.type !== 'relation' || seen.has(f.id) || seen.has(f.inverseFieldId)) continue;
        seen.add(f.id);
        if (f.inverseFieldId) seen.add(f.inverseFieldId);
        for (const tid of (f.targetDbIds ?? [f.targetDbId])) {
        const b = pos.get(tid);
        if (!b) continue;
        const a = pos.get(t.id);
        const inv = byId.get(tid)?.fields?.find((x) => x.id === f.inverseFieldId);
        const label = `${f.name} ${card(inv?.many)}–${card(f.many)}`;
        if (a.id === b.id) {
          const top = a.y - a.h / 2;
          edges.push({
            fromId: a.id, toId: b.id, label, self: true,
            x1: a.x + a.w / 2, y1: a.y - 10, x2: a.x + a.w / 2, y2: a.y + 10,
            lx: a.x, ly: top - 9,
          });
          continue;
        }
        const p1 = border(a, b, a.w, a.h);
        const p2 = border(b, a, b.w, b.h);
        edges.push({
          fromId: a.id, toId: b.id, label, self: false,
          x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
          lx: (p1.x + p2.x) / 2, ly: (p1.y + p2.y) / 2,
        });
        }
      }
    }

    const right = Math.max(
      ...groups.map((g) => g.x + g.w),
      ...edges.filter((e) => e.self).map((e) => e.x1 + 40),
    );
    return {
      width: right + o.left,
      height: Math.max(...groups.map((g) => g.y + g.h)) + o.bottom,
      groups, nodes, edges,
    };
  }

  const api = { relmapLayout, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.WeaveRelmap = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));
