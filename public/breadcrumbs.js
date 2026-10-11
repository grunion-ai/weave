(function (root) {
  function pushTrail(trail, prev, next) {
    if (!prev || prev.page !== 'entity' || !prev.entity) return [];
    if (prev.entity.id === next.id) return trail.slice();
    const at = trail.findIndex((e) => e.id === next.id);
    if (at >= 0) return trail.slice(0, at);
    return [...trail, prev.entity];
  }

  function rowCrumb(h, current = false) {
    return {
      kind: 'row', id: h.id, label: h.name ?? '', href: `#/entity/${h.id}`,
      icon: h.tableIcon ?? null, publicId: h.publicId ?? null,
      title: h.table ? `${h.table} \u00b7 ${h.name ?? ''}` : (h.name ?? ''), current,
    };
  }

  function entityCrumbs(wsName, trail, entity) {
    const first = trail[0] ?? entity;
    return [
      { kind: 'ws', label: wsName, href: '#/' },
      { kind: 'space', label: first.space, href: `#/space/${first.spaceId}`, icon: first.spaceIcon ?? null },
      { kind: 'table', label: first.table, href: `#/table/${first.tableId}`, icon: first.tableIcon ?? null },
      ...trail.map((h) => rowCrumb(h)),
      rowCrumb(entity, true),
    ];
  }

  function dockCrumbs(hops) {
    return hops.map((h, i) => rowCrumb(h, i === hops.length - 1));
  }

  function foldPlan(widths, box, { from = 1, more = 0 } = {}) {
    let w = widths.reduce((a, b) => a + b, 0);
    if (w <= box) return [];
    w += more;
    const out = [];
    for (let i = Math.max(1, from); i < widths.length - 2 && w > box; i++) {
      out.push(i);
      w -= widths[i];
    }
    return out;
  }

  const navCurrent = (nav) => nav?.stack?.[nav.idx] ?? null;
  function navOpen(nav, hop) {
    if (navCurrent(nav)?.id === hop.id) return nav;
    return { stack: [hop], idx: 0 };
  }
  function navHop(nav, hop) {
    const cur = navCurrent(nav);
    if (!cur) return { stack: [hop], idx: 0 };
    if (cur.id === hop.id) return nav;
    const stack = [...nav.stack.slice(0, nav.idx + 1), hop];
    return { stack, idx: stack.length - 1 };
  }
  const navCanBack = (nav) => !!nav && nav.idx > 0;
  const navCanForward = (nav) => !!nav && nav.idx < nav.stack.length - 1;
  const navBack = (nav) => (navCanBack(nav) ? { stack: nav.stack, idx: nav.idx - 1 } : nav);
  const navForward = (nav) => (navCanForward(nav) ? { stack: nav.stack, idx: nav.idx + 1 } : nav);
  function navPath(nav) {
    const seq = nav?.stack?.slice(0, nav.idx + 1) ?? [];
    if (!seq.length) return [];
    let trail = [];
    for (let i = 1; i < seq.length; i++) trail = pushTrail(trail, { page: 'entity', entity: seq[i - 1] }, seq[i]);
    return [...trail, seq[seq.length - 1]];
  }
  function navUpdate(nav, hop) {
    if (!nav?.stack) return nav;
    return { stack: nav.stack.map((x) => (x.id === hop.id ? { ...x, ...hop } : x)), idx: nav.idx };
  }

  function rowTitle(hop) {
    const name = String(hop?.name ?? '').trim();
    const table = String(hop?.table ?? hop?.tableName ?? '').trim();
    if (!table || hop?.publicId == null) return name;
    const ref = `${table} #${hop.publicId}`;
    return name ? `${ref} · ${name}` : ref;
  }
  function docTitle(name, wsName) {
    const n = String(name ?? '').trim();
    const w = String(wsName ?? '').trim();
    if (n && n === w) return w;
    return n && w ? `${n} · ${w}` : n || w || 'Weave';
  }

  root.weaveBreadcrumbs = {
    pushTrail, rowCrumb, entityCrumbs, dockCrumbs, foldPlan, docTitle, rowTitle,
    navOpen, navHop, navBack, navForward, navCanBack, navCanForward, navCurrent, navPath, navUpdate,
  };
})(globalThis);
