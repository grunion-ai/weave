/* The navigation trail behind entity breadcrumbs (2026-08-23). A crumb is
   the path TAKEN, not only the path that exists: arriving at an entity by
   a relation link from another entity keeps that entity (and its table,
   where it differs) in the crumb, so a hop People → Ada Chen → Sensor board
   reads ws › Showcase › People › Ada Chen › Field Types › Sensor board.
   Classic script + ESM in one file (nl-date.js pattern). */
(function (root) {
  const MAX_TRAIL = 4;

  /* trail: the entities hopped through before `next`. prev: the route being
     left ({page, entity}). Entity-to-entity hops extend it; any other origin
     (table, space, home, sidebar) starts fresh; revisiting an entity already
     on the trail cuts back to it, so a loop never accumulates. */
  function pushTrail(trail, prev, next) {
    if (!prev || prev.page !== 'entity' || !prev.entity) return [];
    if (prev.entity.id === next.id) return trail.slice();
    const at = trail.findIndex((e) => e.id === next.id);
    if (at >= 0) return trail.slice(0, at);
    const out = [...trail, prev.entity];
    return out.slice(-MAX_TRAIL);
  }

  /* The crumb list up to (not including) the current entity. The structural
     head is the workspace and the FIRST space; after that, a space or table
     crumb appears only where it changes from the previous hop. */
  function entityCrumbs(wsName, trail, entity) {
    const crumbs = [{ label: wsName, href: '#/' }];
    let space = null;
    let table = null;
    const step = (e) => {
      if (e.spaceId !== space) { crumbs.push({ label: e.space, href: `#/space/${e.spaceId}` }); space = e.spaceId; table = null; }
      if (e.tableId !== table) { crumbs.push({ label: e.table, href: `#/table/${e.tableId}` }); table = e.tableId; }
    };
    for (const e of trail) {
      step(e);
      crumbs.push({ label: e.name, href: `#/entity/${e.id}` });
    }
    step(entity);
    return crumbs;
  }

  /* The dock's crumb (Issue #276): the chain of frames the dock walked, run
     through the same rule — a hop into another table shows that table where
     it changes — minus the workspace › space head, which the sidebar already
     shows beside a docked table. Frames carry their table; tableOf(tableId)
     supplies the space. */
  function dockCrumbs(chain, tableOf) {
    const hop = (f) => {
      const t = tableOf(f.tableId) || {};
      return { id: f.id, name: f.name, space: t.space ?? '', spaceId: t.spaceId ?? '', table: f.tableName, tableId: f.tableId };
    };
    const hops = chain.map(hop);
    if (!hops.length) return [];
    return entityCrumbs('', hops.slice(0, -1), hops[hops.length - 1]).slice(2);
  }

  root.weaveBreadcrumbs = { pushTrail, entityCrumbs, dockCrumbs, MAX_TRAIL };
})(globalThis);
