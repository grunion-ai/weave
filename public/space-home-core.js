(() => {
  function homeSections(payload, recents) {
    const { space, tables = [], runs = [] } = payload ?? {};
    const byId = new Map(tables.map((t) => [t.id, t]));
    const qualified = new Set(tables.map((t) => `${t.space ?? space?.name}/${t.name}`));
    const list = (Array.isArray(recents) ? recents : []).filter((r) => r && typeof r === 'object');
    const views = list.flatMap((r) => {
      if (r.kind !== 'table-view') return [];
      const now = byId.get(r.tableId)?.views?.find((v) => v.id === r.id);
      return now ? [{ ...r, name: now.name, layout: now.layout, table: byId.get(r.tableId).name }] : [];
    });
    const rows = list
      .filter((r) => r.kind === 'entity' && (r.dbId ? byId.has(r.dbId) : qualified.has(r.db)))
      .map((r) => ({ ...r, table: byId.get(r.dbId)?.name ?? String(r.db).split('/').pop() }));
    const out = {};
    if (tables.length) out.tables = tables;
    if (views.length) out.views = views;
    if (rows.length) out.rows = rows;
    if (runs.length) out.runs = runs;
    if (tables.length || space?.description) out.overview = { description: space?.description ?? '' };
    return out;
  }

  function workspaceSections(payload, recents) {
    const { workspace, spaces = [], runs = [] } = payload ?? {};
    const tables = spaces.flatMap((sp) => (sp.tables ?? []).map((t) => ({ ...t, space: sp.name })));
    const out = homeSections({ space: { description: workspace?.description ?? '' }, tables, runs }, recents);
    if (spaces.length) {
      out.spaces = spaces.map(({ tables: list = [], ...sp }) => ({ ...sp, rowCount: list.reduce((n, t) => n + (t.rowCount ?? 0), 0) }));
      out.overview = { description: workspace?.description ?? '' };
    }
    return out;
  }

  const filterRuns = (runs, outcome) => (outcome === 'all' ? runs : runs.filter((r) => r.outcome === outcome));

  function runSubject(run, spaceName = null) {
    const from = run.originSpace;
    const where = spaceName == null ? from : (from && from !== spaceName ? `${from} → ${spaceName}` : spaceName);
    const changed = (run.changedTables ?? []).map((t) => `${t.table} ${t.count.toLocaleString('en-US')}`).join(', ');
    return [where, changed || 'nothing changed'].filter(Boolean).join(' · ');
  }

  function rowsByTable(rows) {
    const groups = new Map();
    for (const r of rows) {
      if (!groups.has(r.table)) groups.set(r.table, []);
      groups.get(r.table).push(r);
    }
    return [...groups].map(([table, list]) => ({ table, rows: list }));
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
    return { kind: 'table-view', id: v.id, name: v.name, tableId: table.id, table: table.name, layout: v.layout ?? 'table', url: `#/table/${table.id}/view/${v.id}` };
  }

  globalThis.WeaveSpaceHome = { homeSections, workspaceSections, filterRuns, runSubject, rowsByTable, runResult, viewRecent };
})();
