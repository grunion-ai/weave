export const STATES = ['Open', 'In Progress', 'Fixed'];
export const SEVERITY = ['Low', 'Medium', 'High'];
export const SYMPTOM = ['Slow', 'Looks broken', 'Wrong data', 'Error'];
export const AREA = ['Grid', 'Editor', 'Nav', 'MCP', 'Gate', 'Server'];
export const RELEASES = ['v0.4', 'v0.5', 'v0.6'];

export const LIVE = [
  [1, 'Single-writer: CLI and server must not write one workspace file concurrently', 'Fixed', 'Medium', ['Wrong data'], 'v0.4', 'Server'],
  [2, 'No filter-builder UI (filters are API/CLI/MCP only)', 'Fixed', 'Medium', [], 'v0.4', 'MCP'],
  [3, 'Board drag-and-drop does not scroll columns horizontally while dragging', 'Open', 'Low', ['Looks broken', 'Slow'], '', 'Grid'],
  [4, 'PDF renders non-WinAnsi glyphs as a question mark', 'In Progress', 'Low', ['Looks broken'], 'v0.5', 'Editor'],
  [5, 'New fields invisible in already-open views until manual reload', 'Fixed', 'Medium', ['Wrong data', 'Looks broken'], 'v0.4', 'Editor'],
  [6, 'REST entity routes accept only UUIDs, not Table#pid refs', 'Open', 'Low', ['Error'], '', 'MCP'],
  [7, 'Collapsed-nav expand control rendered as a workspace chip in the rail', 'Fixed', 'Low', ['Looks broken'], 'v0.4', 'Nav'],
  [8, 'Vendored mermaid predates the security release', 'In Progress', 'Medium', [], 'v0.5', 'Gate'],
  [9, 'Native select dropdown clashes with the chip aesthetic', 'Open', 'Medium', ['Looks broken'], '', 'Editor'],
  [10, 'Public squash briefly included workspace data', 'Fixed', 'Medium', ['Wrong data'], 'v0.4', 'Editor'],
  [11, 'Collapsed left nav cannot be re-opened', 'Open', 'High', ['Looks broken', 'Error'], '', 'Nav'],
  [12, 'Clicking a select cell opens the entity instead of the picker', 'In Progress', 'Medium', ['Error'], 'v0.5', 'Grid'],
];
export const GONE = [
  [13, 'Duplicate of #11: nav chevron hidden', 'Fixed', 'Low', [], '', 'Nav'],
  [14, 'Test row from MCP smoke run', 'Fixed', 'Low', ['Error'], '', 'MCP'],
];

export const STANDARD_FIELDS = ['Name', 'Description', 'Status', 'Severity', 'Symptom', 'Fixed in', 'Area', 'Points', 'Created At', 'Modified At', 'Modified By'];
export const ROLLUPS = [['count', null], ['distinct', 'Severity'], ['filled', 'Symptom'], ['distinct', 'Area'], ['sum', 'Points'], ['avg', 'Points']];

export function seedIssues(w) {
  w.createSpace({ name: 'Development' });
  const release = w.createTable({ space: 'Development', name: 'Release' });
  const issue = w.createTable({ space: 'Development', name: 'Issue' });
  w.addField(issue, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  w.addField(issue, { name: 'Severity', type: 'select', config: { options: [{ name: 'Low', hue: 'slate' }, { name: 'Medium', hue: 'amber' }, { name: 'High', hue: 'red' }] } });
  w.addField(issue, { name: 'Symptom', type: 'multiselect', config: { options: SYMPTOM } });
  w.addRelation(issue.id, { name: 'Fixed in', targetDb: release.id, cardinality: 'many-to-one', inverseName: 'Fixes' });
  w.addField(issue, { name: 'Area', type: 'select', config: { options: AREA } });
  w.addField(issue, { name: 'Points', type: 'number', config: { format: 'currency', currency: 'USD' } });
  const rel = Object.fromEntries(RELEASES.map((name) => [name, w.createEntity(release, { name }).id]));
  const make = ([n, name, Status, Severity, Symptom, fixed, Area]) => w.createEntity(issue, {
    name, values: { Status, Severity, Symptom, Area, Points: (n % 5) * 1.5, ...(fixed ? { 'Fixed in': rel[fixed] } : {}) },
  });
  for (const r of LIVE) make(r);
  for (const r of GONE) w.deleteEntity(make(r).id);
  w.tableView(`${issue.id}/Standard`, { fields: STANDARD_FIELDS });
  const spaces = w.describeSchema().flatMap((sp) => sp.tables).find((t) => t.system === 'spaces');
  for (const [aggregate, targetField] of ROLLUPS) {
    w.addField(spaces.id, { name: `Issue · ${targetField ?? 'count'} · ${aggregate}`, type: 'rollup', config: { via: issue.id, aggregate, ...(targetField ? { targetField } : {}) } });
  }
  return { issue, release };
}

export const FILTERS = [
  { filters: {}, deleted: false },
  { filters: { Severity: ['Medium', 'High'] }, deleted: false },
  { filters: { Area: ['Nav'] }, deleted: false },
  { filters: { Status: ['Fixed'], Symptom: ['Error'] }, deleted: false },
  { filters: {}, deleted: true },
  { filters: { Severity: ['High'], Area: ['Grid'] }, deleted: false },
];
export const SORTS = [
  [],
  [{ field: 'Name', dir: 'asc' }],
  [{ field: 'Severity', dir: 'desc' }, { field: 'Area', dir: 'asc' }, { field: 'Name', dir: 'asc' }],
  [{ field: 'Created At', dir: 'desc' }, { field: 'Modified By', dir: 'asc' }, { field: 'Fixed in', dir: 'desc' }],
];
export const GROUPS = [
  [],
  [{ field: 'Severity' }],
  [{ field: 'Area' }, { field: 'Severity', dir: 'desc' }],
  [{ field: 'Symptom' }],
  [{ field: 'Area' }, { field: 'Severity' }, { field: 'Status', dir: 'desc' }, { field: 'Symptom' }, { field: 'Fixed in' }],
];
export const LAYOUTS = ['table', 'list'];
export const ROLLUP_MODES = [[false, 'all'], [true, 'all'], [true, 'top'], [true, 'none']];
export const HIDDEN = [[], ['Severity', 'Area']];

export function* combinations() {
  for (const fi of FILTERS) for (const sort of SORTS) for (const group of GROUPS) for (const layout of LAYOUTS)
    for (const [rollups, subtotals] of ROLLUP_MODES) for (const hidden of HIDDEN) {
      yield { ...fi, sort, group, layout, rollups, subtotals, hidden };
    }
}

export function fieldsOf(w, tableId) {
  for (const space of w.describeSchema()) for (const t of space.tables) if (t.id === tableId) return t.fields;
  throw new Error(`no table ${tableId}`);
}

export function sortValue(fields) {
  const by = new Map(fields.map((f) => [f.name, f]));
  return (item, name) => {
    if (name === 'Name') return item.name;
    if (name === 'Created At') return item.createdAt ?? null;
    if (name === 'Modified At') return item.updatedAt ?? null;
    if (name === 'Modified By') return item.modifiedBy ?? null;
    if (name === 'Created By') return item.createdBy ?? null;
    const f = by.get(name);
    const v = item.fields?.[name];
    if (!f || v == null || v === '') return null;
    if (f.type === 'select') return f.options.indexOf(v);
    if (f.type === 'workflow') return f.states.findIndex((s) => s.name === v);
    if (f.type === 'relation') return (Array.isArray(v) ? v : [v]).map((x) => x.name).join(',') || null;
    if (Array.isArray(v)) return v.length ? v[0] : null;
    return v;
  };
}

