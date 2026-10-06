/* The navigation trail behind entity breadcrumbs (2026-08-23). A crumb is
   the path TAKEN, not only the path that exists: arriving at an entity by
   a relation link from another entity keeps that entity (and its table,
   where it differs) in the crumb, so a hop People → Ada Chen → Sensor board
   reads ws › Showcase › People › Ada Chen › Field Types › Sensor board.
   Classic script + ESM in one file (nl-date.js pattern). */
(function (root) {
  /* trail: the entities hopped through before `next`. prev: the route being
     left ({page, entity}). Entity-to-entity hops extend it; any other origin
     (table, space, home, sidebar) starts fresh; revisiting an entity already
     on the trail cuts back to it, so a loop never accumulates. */
  function pushTrail(trail, prev, next) {
    if (!prev || prev.page !== 'entity' || !prev.entity) return [];
    if (prev.entity.id === next.id) return trail.slice();
    const at = trail.findIndex((e) => e.id === next.id);
    if (at >= 0) return trail.slice(0, at);
    // No cap (Issue #672): a fifth hop used to drop the oldest with no
    // sign it was there. The crumb's fold menu carries a long trail.
    return [...trail, prev.entity];
  }

  /* A row crumb (Issue #669): the row's table icon, its muted #id and its
     Name, at every place in the trail, the current row included. The icon
     carries the table, so a hop into another table needs no table crumb of
     its own; the tooltip names it. */
  function rowCrumb(h, current = false) {
    return {
      kind: 'row', id: h.id, label: h.name ?? '', href: `#/entity/${h.id}`,
      icon: h.tableIcon ?? null, publicId: h.publicId ?? null,
      title: h.table ? `${h.table} \u00b7 ${h.name ?? ''}` : (h.name ?? ''), current,
    };
  }

  /* The full page's crumb: workspace, space and table in front, each with
     its icon, then every row on the path taken, ending at the current one.
     The head names where the path started (the first hop's space and
     table); the rows after it carry their own tables in their icons. */
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

  /* The dock's crumb (Issues #276, #673): the rows of the path, nothing in
     front. The table panel beside the dock already names its table, and
     each row crumb's icon carries its own. */
  function dockCrumbs(hops) {
    return hops.map((h, i) => rowCrumb(h, i === hops.length - 1));
  }

  /* Which crumbs fold into the "…" menu (Issue #668), as a pure choice:
     widths are each crumb's natural width (its separator included), box is
     the path's width, more is the width the "…" button takes. Nothing folds
     when everything fits. Otherwise crumbs fold from `from` onward, in
     order, until the rest plus the button fit; the crumb at index 0 and
     the last two are never folded, so the start of the journey, where you
     came from and where you are stay on screen. */
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

  /* The tab title (Issue #267): the row or table in front of the reader,
     then the workspace, so tabs, history entries and bookmarks tell places
     apart. The workspace page is the workspace name alone; "Weave" only
     where no workspace has loaded. */
  function docTitle(name, wsName) {
    const n = String(name ?? '').trim();
    const w = String(wsName ?? '').trim();
    // The workspace page names the workspace twice otherwise: its header is
    // the workspace name, and so is the second half of every title here.
    if (n && n === w) return w;
    return n && w ? `${n} · ${w}` : n || w || 'Weave';
  }

  root.weaveBreadcrumbs = { pushTrail, rowCrumb, entityCrumbs, dockCrumbs, foldPlan, docTitle };
})(globalThis);
