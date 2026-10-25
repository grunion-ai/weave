import { createForm } from '../../src/forms.js';
import { createOidc } from '../../src/oidc.js';
import { createBilling } from '../../src/billing.js';

export const ROWS = 400;

function journeys(weave) {
  weave.createSpace({ name: 'Work' });
  const projects = weave.createTable({ space: 'Work', name: 'Project' });
  const tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Doing', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  weave.addField(tasks, { name: 'Owner', type: 'text' });
  weave.addField(tasks, { name: 'Points', type: 'number' });
  weave.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  const ps = ['Launch', 'Billing rewrite with a name long enough to wrap in a chip', 'Ops'].map((name) => weave.createEntity(projects, { name }).id);
  const ids = [];
  for (let i = 0; i < ROWS; i++) {
    const name = i % 37 === 0 ? `Task ${i}: a title that runs well past the column so the cell has to clip it somewhere sensible` : `Task ${i}`;
    ids.push(weave.createEntity(tasks, { name, values: {
      Status: ['Open', 'Doing', 'Done'][i % 3],
      ...(i % 5 ? { Owner: ['ana', 'bo', 'cy'][i % 3] } : {}),
      ...(i % 4 ? { Points: (i * 7) % 13 } : {}),
      ...(i % 6 ? { Project: ps[i % 3] } : {}),
    } }).id);
  }
  const doc = weave.createEntity(tasks, { name: 'Spec', doc: '# Spec\n\nFirst paragraph of the spec.\n\n- one\n- two\n' }).id;
  weave.tableView(`${tasks.id}/All`, { from: 'blank' });
  weave.tableView(`${tasks.id}/Compact`, { from: 'blank', fields: ['Name', 'Status'] });
  return { tasks, projects, ids, doc, table: tasks.id, row: ids[3] };
}

function messy(weave) {
  const handles = journeys(weave);
  const { tasks, ids } = handles;
  weave.addField(tasks, { name: 'Due', type: 'date' });
  weave.addField(tasks, { name: 'Window', type: 'daterange', config: { format: 'long' } });
  weave.addField(tasks, { name: 'Link', type: 'url' });
  weave.addField(tasks, { name: 'Tags', type: 'multiselect', config: { options: ['Short', 'A tag whose label runs long enough to need a wrap'] } });
  for (const [i, id] of ids.entries()) {
    if (i % 3) continue;
    weave.updateEntity(id, {
      Due: `2026-${String((i % 12) + 1).padStart(2, '0')}-15`,
      Window: { start: '2026-08-01', end: '2026-09-15' },
      Link: i % 2 ? 'https://example.com/' : `https://docs.example.com/guides/a-path-that-keeps-going/${i}/and-going`,
      Tags: i % 2 ? ['Short'] : ['Short', 'A tag whose label runs long enough to need a wrap'],
    });
  }
  const notes = weave.createTable({ space: 'Work', name: 'Note' });
  weave.addField(notes, { name: 'Link', type: 'url' });
  for (const name of ['Spec', 'Release note', 'Customer summary']) weave.addField(notes, { name, type: 'document' });
  const activity = weave.createEntity(notes, { name: 'Log', doc: 'First draft.' }).id;
  weave.setDoc(activity, 'Spec text.', 'Spec');
  weave.setDoc(activity, 'Release text.', 'Release note');
  weave.setDoc(activity, 'Summary text.', 'Customer summary');
  weave.updateEntity(activity, { Link: 'https://adriany.fibery.io/Task_Management/Task/a-path-that-keeps-going-past-the-panel-1234' });
  const board = weave.tableView(`${tasks.id}/Board`, { layout: 'board', group: ['Tags'], search: 'title' });
  const list = weave.tableView(`${tasks.id}/List`, { layout: 'list', group: [{ field: 'Project', heading: 'chip' }] });
  return { ...handles, notes, activity, board, list };
}

function a11y(weave) {
  weave.createSpace({ name: 'Work' });
  const task = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(task, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In progress', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  weave.addField(task, { name: 'Notes', type: 'text' });
  const issue = weave.createTable({ space: 'Work', name: 'Issue' });
  weave.addField(issue, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField(issue, { name: 'Symptom', type: 'multiselect', config: { options: ['Slow', 'Looks broken'] } });
  weave.addField(issue, { name: 'Points', type: 'number' });
  weave.addField(issue, { name: 'Double', type: 'formula', config: { expression: 'Points * 2' } });
  weave.addField(issue, { name: 'Due', type: 'date' });
  weave.addField(issue, { name: 'Done', type: 'checkbox' });
  weave.addField(issue, { name: 'Link', type: 'url' });
  weave.addField(issue, { name: 'Brief', type: 'document' });
  weave.addRelation(issue, { name: 'Task', targetDb: task, cardinality: 'many-to-one', inverseName: 'Issues' });
  const t1 = weave.createEntity(task, { name: 'Write the plan', values: { Status: 'In progress', Notes: 'first pass' } });
  weave.createEntity(task, { name: 'Ship it', values: { Status: 'Open' } });
  const i1 = weave.createEntity(issue, { name: 'Grid is slow', values: {
    Severity: 'High', Symptom: ['Slow'], Points: 3, Due: '2026-10-01', Done: false, Link: 'https://example.com', Task: t1.id } });
  const gone = weave.createEntity(issue, { name: 'Chip wraps', values: { Severity: 'Low', Points: 1 } });
  weave.createEntity(issue, { name: 'Old note', values: { Severity: 'Low' } });
  weave.deleteEntity(gone.id);
  weave.setDoc(i1.id, `Measured on [[Task#${t1.publicId}]].\n\n## Steps\n\nOpen the grid and scroll.\n`, 'Brief');
  const board = weave.tableView(`${task.id}/Board`, { layout: 'board', group: ['Status'] });
  const list = weave.tableView(`${task.id}/List`, { layout: 'list', group: ['Status'] });
  const form = createForm(weave, { name: 'Report a task', table: task.id, fields: [{ field: 'Name', key: 'title', label: 'Title', required: true }, { field: 'Notes', key: 'notes', label: 'Notes' }] });
  return { task, issue, entityId: i1.id, board, list, form };
}

export const DOORS_ISSUER = 'https://clerk.a11y.example.test';

function doors(weave) {
  weave.updateWorkspace({ name: 'ada-sales' });
  weave.createSpace({ name: 'Sales' });
  const architect = weave.createAccount({ name: 'ada-sales', role: 'architect' }).account;
  weave.redeemIdentityInvite(weave.linkIdentity('ada-sales', { issuer: DOORS_ISSUER }).code, { issuer: DOORS_ISSUER, subject: 'user_ada' });
  weave.accountForIdentity({ issuer: DOORS_ISSUER, subject: 'user_ada', email: 'ada-sales@example.com' });
  weave.setRequireAuth(true);
  return { architect };
}

const nobody = async () => new Response('{"errors":[{"code":"resource_not_found"}]}', { status: 404 });
const doorsServer = () => ({
  oidc: createOidc({ issuer: 'https://idp.a11y.example.test', clientId: 'test', clientSecret: 'test', name: 'Test' }),
  billing: createBilling({ secretKey: 'sk_test_x', soloPlan: 'solo', teamPlan: 'team', issuer: DOORS_ISSUER, publishableKey: null, fetch: nobody }),
});

function touch(weave) {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue', description: Array.from({ length: 9 }, (_, i) => `Line ${i + 1} of a table description long enough that the phone header clamps it and offers Show more.`).join('\n\n') });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField(issues, { name: 'Symptom', type: 'multiselect', config: { options: ['Looks broken', 'Slow', 'Wrong data'] } });
  weave.addField(issues, { name: 'Notes', type: 'text' });
  weave.addField(issues, { name: 'Due', type: 'date' });
  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push(weave.createEntity(issues, {
      name: `Issue ${i}: a phone row name long enough to wrap`,
      values: { Status: 'Open', Severity: 'High', Symptom: ['Looks broken', 'Slow'], Notes: 'a note' },
    }));
  }
  weave.setDoc(rows[0].id, 'Some body text.\n\nAnother paragraph.');
  const board = weave.tableView(`${issues.id}/Board`, { layout: 'board', group: ['Status'] });
  const list = weave.tableView(`${issues.id}/List`, { layout: 'list', group: ['Status'] });
  return { table: issues.id, row: rows[0].id, board, list };
}

export const SEEDS = {
  journeys: { build: journeys, about: 'a 400-row Task table with a Project relation, long names every 37th row, a document row and two saved views' },
  messy: { build: messy, extends: 'journeys', about: 'the journeys seed plus date, date range, url and multiselect fields with long values, a Note table whose row carries three documents and an activity history, a board of the long-named rows grouped by the long-labelled Tags and a list grouped under Project chips' },
  a11y: { build: a11y, about: 'a Task and an Issue table covering every common field type, a board and a list view, a trashed row and a published form' },
  doors: { build: doors, server: doorsServer, about: 'a signed-in workspace behind OIDC and billing, for the start and billing pages' },
  touch: { build: touch, about: 'an Issue table with a clamped description, wrapping row names and chips, and a board and a list grouped by Status, for phone hit areas' },
};
