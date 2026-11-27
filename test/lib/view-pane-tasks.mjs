export const WORKSTREAMS = ['Personal', 'Work Work', 'Startup', 'Other Work', 'Projects', 'Home'];
export const STATES = ['Open', 'In Progress', 'Review', 'Done', 'Canceled'];
export const TAGS = ['bug', 'feature', 'chore', 'design'];
export const PROJECTS = ['weave', 'harness', 'plumbline', 'decklet', 'underchat', 'household'];
const VERBS = ['Fix', 'Draft', 'Review', 'Ship', 'Call', 'Renew', 'Measure', 'Migrate', 'Cancel', 'Book'];
const NOUNS = ['the quarterly tax filing', 'view pane accordion', 'insurance dispute letter', 'overnight digest', 'Railway token', 'gym schedule', 'landing page hero', 'expense log gaps', 'domain renewal', 'a very long task name that keeps going well past any reasonable column width so truncation has to cope'];

export const FIELDS = ['Name', 'State', 'Due', 'Workstream', 'Captured', 'Fibery', 'Uno Row', 'Tags', 'Spec', 'Assignee', 'Project', 'Visibility', 'Version', 'Commit', 'As of', 'Files', 'Photo'];

export const VIEWS = {
  Standard: {},
  Work: {
    filters: { State: ['Open', 'In Progress', 'Review'] },
    sort: [{ field: 'Due', dir: 'asc' }, { field: 'Name', dir: 'asc' }],
    group: [{ field: 'Workstream' }],
    hide: ['Spec', 'Commit', 'Fibery'],
    density: 'compact', rollups: true, subtotals: 'top',
  },
  Triage: {
    filters: { Tags: ['bug', 'feature'] },
    sort: [{ field: 'Captured', dir: 'desc' }],
    group: [{ field: 'Workstream' }],
    hide: ['Version', 'As of'],
    density: 'spacious', rollups: false,
  },
  Kanban: {
    filters: { Visibility: ['Normal'] },
    sort: [{ field: 'Name', dir: 'asc' }],
    group: [{ field: 'State' }],
    hide: ['Spec', 'Version', 'Commit', 'Fibery', 'As of'],
    layout: 'board', groups: 'side', density: 'comfortable',
  },
};

export function seedTasks(w, { rows = 60 } = {}) {
  w.createSpace({ name: 'Backlog' });
  const project = w.createTable({ space: 'Backlog', name: 'Project' });
  const tasks = w.createTable({ space: 'Backlog', name: 'Tasks' });
  w.updateTable(tasks.id, { noun: 'task' });
  w.addField(tasks.id, { name: 'State', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Review', category: 'in-progress' },
    { name: 'Done', category: 'done' },
    { name: 'Canceled', category: 'canceled' }] } });
  w.addField(tasks.id, { name: 'Due', type: 'date' });
  w.addField(tasks.id, { name: 'Workstream', type: 'select', config: { options: WORKSTREAMS } });
  w.addField(tasks.id, { name: 'Captured', type: 'date' });
  w.addField(tasks.id, { name: 'Fibery', type: 'url' });
  w.addField(tasks.id, { name: 'Uno Row', type: 'number' });
  w.addField(tasks.id, { name: 'Tags', type: 'multiselect', config: { options: TAGS } });
  w.addField(tasks.id, { name: 'Spec', type: 'document' });
  w.addField(tasks.id, { name: 'Assignee', type: 'select', config: { options: ['Kyle', 'Guest'] } });
  w.addRelation(tasks.id, { name: 'Project', targetDb: project.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.addField(tasks.id, { name: 'Visibility', type: 'select', config: { options: ['High', 'Normal'] } });
  w.addField(tasks.id, { name: 'Version', type: 'text' });
  w.addField(tasks.id, { name: 'Commit', type: 'text' });
  w.addField(tasks.id, { name: 'As of', type: 'date' });
  w.addField(tasks.id, { name: 'Files', type: 'attachments' });
  w.addField(tasks.id, { name: 'Photo', type: 'attachments', config: { multiple: false } });
  const rel = PROJECTS.map((name) => w.createEntity(project.id, { name }).id);
  const day = (n) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);
  const ids = [];
  for (let i = 0; i < rows; i++) {
    const values = {
      State: STATES[(i * 7) % 5],
      Workstream: i % 11 === 0 ? undefined : WORKSTREAMS[(i * 5) % 6],
      Captured: day(i % 40),
      Due: i % 3 === 0 ? undefined : day((i * 3) % 60),
      Tags: i % 4 === 0 ? [] : [TAGS[i % 4], ...(i % 6 === 1 ? [TAGS[(i + 1) % 4]] : [])],
      Assignee: i % 5 === 0 ? undefined : 'Kyle',
      Visibility: i % 9 === 0 ? 'High' : 'Normal',
      'Uno Row': i % 2 ? i * 3 : undefined,
      Version: i % 7 === 0 ? `weave 0.4.${100 + i}` : undefined,
      Fibery: i % 8 === 0 ? `https://example.test/task/${i}` : undefined,
      ...(i % 6 === 5 ? {} : { Project: rel[i % 6] }),
    };
    for (const k of Object.keys(values)) if (values[k] === undefined) delete values[k];
    const made = w.createEntity(tasks.id, { name: `${VERBS[i % 10]} ${NOUNS[(i * 3) % 10]}`, values });
    if (i % 20 === 19) w.deleteEntity(made.id); else ids.push(made.id);
  }
  writeViews(w, tasks.id);
  return { tasks, project, ids };
}

export function viewSpec(name) {
  const v = VIEWS[name];
  return {
    fields: FIELDS.filter((f) => !(v.hide ?? []).includes(f)),
    filters: v.filters ?? {}, sort: v.sort ?? [], group: v.group ?? null, deleted: false, search: '',
    density: v.density ?? 'comfortable', rollups: v.rollups ?? null, subtotals: v.subtotals ?? null,
    layout: v.layout ?? null, groups: v.groups ?? null, picture: null, fit: null, frame: null, flow: null,
    collapsed: null, hideEmpty: null, completedBy: null, order: null,
  };
}

export function writeViews(w, tableId) {
  const names = Object.keys(VIEWS);
  for (const v of w.tableView(tableId).views) if (!names.includes(v.name)) w.tableView(`${tableId}/${v.name}`, { delete: true });
  names.forEach((name, position) => {
    w.tableView(`${tableId}/${name}`, { group: null, sort: [] });
    w.tableView(`${tableId}/${name}`, { ...viewSpec(name), position });
  });
}

export function spacesTable(w) {
  return w.describeSchema().flatMap((sp) => sp.tables).find((t) => t.system === 'spaces');
}

const SPACES_BASE = ['Name', 'Description', 'Template', 'Tables', 'Workflows', 'Workspace'];

export function useCover(w, tableId, on) {
  w.updateField(tableId, 'Photo', { config: { preview: on ? 'cover' : null } });
}

export function resetTasks(w, tableId) {
  useCover(w, tableId, false);
  const spaces = spacesTable(w);
  for (const f of spaces?.fields ?? []) if (!SPACES_BASE.includes(f.name)) w.deleteField(spaces.id, f.id, { hard: true });
  writeViews(w, tableId);
}
