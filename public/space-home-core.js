(() => {
  const plural = (n) => `${n} ${n === 1 ? 'row' : 'rows'} changed`;

  function homeSections(payload, recents) {
    const { space, tables = [], runs = [] } = payload ?? {};
    const byId = new Map(tables.map((t) => [t.id, t]));
    const qualified = new Set(tables.map((t) => `${space?.name}/${t.name}`));
    const list = (Array.isArray(recents) ? recents : []).filter((r) => r && typeof r === 'object');
    const views = list.flatMap((r) => {
      if (r.kind !== 'table-view') return [];
      const now = byId.get(r.tableId)?.views?.find((v) => v.id === r.id);
      return now ? [{ ...r, name: now.name, layout: now.layout, table: byId.get(r.tableId).name }] : [];
    });
    const rows = list.filter((r) => r.kind === 'entity' && (r.dbId ? byId.has(r.dbId) : qualified.has(r.db)));
    const out = {};
    if (tables.length) out.tables = tables;
    if (views.length) out.views = views;
    if (rows.length) out.rows = rows;
    if (runs.length) out.runs = runs;
    if (tables.length || space?.description) out.overview = { description: space?.description ?? '' };
    return out;
  }

  const filterRuns = (runs, outcome) => (outcome === 'all' ? runs : runs.filter((r) => r.outcome === outcome));

  function runSubject(run, spaceName) {
    const where = run.originSpace && run.originSpace !== spaceName ? `${run.originSpace} → ${spaceName}` : spaceName;
    return `${where} · ${run.changedCount ? plural(run.changedCount) : 'no rows changed'}`;
  }

  function runResult(run) {
    if (run.outcome !== 'attention') return 'Succeeded';
    const { step = null, error = null } = run.failedStep ?? {};
    const head = step == null ? 'Failed' : `Step ${step} failed`;
    return error ? `${head}: ${error}` : head;
  }

  function viewRecent(table, ref) {
    const views = table?.views ?? [];
    const v = views.find((x) => x.id === ref);
    if (!v || v === views[0]) return null;
    return { kind: 'table-view', id: v.id, name: v.name, tableId: table.id, table: table.name, layout: v.layout ?? 'grid', url: `#/table/${table.id}/view/${v.id}` };
  }

  globalThis.WeaveSpaceHome = { homeSections, filterRuns, runSubject, runResult, viewRecent };
})();
