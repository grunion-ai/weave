import { createForm } from '../../src/forms.js';
import { openBugReport } from './bug-report.mjs';
import { openPane } from './view-pane.mjs';

export const LAYOUTS = ['table', 'list', 'board'];
export const OPENS = ['journey', 'rest', 'overlay', 'hover', 'drag'];
export const CELLS = ['desktop', 'phone'];
export const THEMES = ['light', 'dark'];

export const ROWS = 400;
const ROW = '.wv-grid tbody tr.entity-row';
const BOTH = ['desktop', 'phone'];
const DESKTOP = ['desktop'];
const PHONE = ['phone'];
const GRID = ['grid', 'messy'];
const MESSY = ['messy'];
const A11Y = ['a11y'];
const TOUCH = ['touch'];

const views = (weave, table) => ({
  board: weave.tableView(`${table.id}/Board`, { layout: 'board', group: ['Status'] }).id,
  list: weave.tableView(`${table.id}/List`, { layout: 'list', group: ['Status'] }).id,
});

function grid(weave) {
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
  return { tasks, projects, ids, doc, table: tasks.id, ...views(weave, tasks) };
}

function messy(weave) {
  const handles = grid(weave);
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
  return { ...handles, notes, activity };
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
  const handles = { task, issue, entityId: i1.id, table: task.id, ...views(weave, task) };
  const form = createForm(weave, { name: 'Report a task', table: task.id, fields: [{ field: 'Name', key: 'title', label: 'Title', required: true }, { field: 'Notes', key: 'notes', label: 'Notes' }] });
  return { ...handles, form };
}

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
      name: i === 1 ? `Issue ${i}` : `Issue ${i}: a phone row name long enough to wrap`,
      values: { Status: 'Open', Severity: 'High', Symptom: ['Looks broken', 'Slow'], Notes: 'a note' },
    }));
  }
  weave.setDoc(rows[0].id, 'Some body text.\n\nAnother paragraph.');
  return { table: issues.id, row: rows[0].id, ...views(weave, issues) };
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f3a8d40000000049454e44ae426082', 'hex');
export const UNBROKEN = 'Antidisestablishmentarianism'.repeat(4);
const SINK_STATE = 'Waiting on the vendor to countersign the renewal';
const SINK_OPTION = 'An option label long enough to run past any chip width';
const SINK_TAG = 'A second tag that also runs long';

function sink(weave) {
  weave.createSpace({ name: 'Lab' });
  const parts = weave.createTable({ space: 'Lab', name: 'Part' });
  weave.addField(parts, { name: 'Cost', type: 'number', config: { format: 'currency', currency: 'USD' } });
  const t = weave.createTable({ space: 'Lab', name: 'Sample' });
  weave.addField(t, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: SINK_STATE, category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  weave.addField(t, { name: 'Notes', type: 'text' });
  weave.addField(t, { name: 'Amount', type: 'number', config: { format: 'currency', currency: 'USD' } });
  weave.addField(t, { name: 'Score', type: 'rating', config: { max: 10 } });
  weave.addField(t, { name: 'Due', type: 'date' });
  weave.addField(t, { name: 'Window', type: 'daterange', config: { format: 'long' } });
  weave.addField(t, { name: 'Checked', type: 'checkbox' });
  weave.addField(t, { name: 'Live', type: 'toggle', config: { on: 'Published to every customer', off: 'Held back for review' } });
  weave.addField(t, { name: 'Site', type: 'url' });
  weave.addField(t, { name: 'Mail', type: 'email' });
  weave.addField(t, { name: 'Kind', type: 'select', config: { options: ['Short', SINK_OPTION] } });
  weave.addField(t, { name: 'Tags', type: 'multiselect', config: { options: ['Short', SINK_OPTION, SINK_TAG] } });
  weave.addRelation(t, { name: 'Parts', targetDb: parts, cardinality: 'many-to-many', inverseName: 'Samples' });
  weave.addField(t, { name: 'Definition', type: 'field' });
  weave.addField(t, { name: 'Secret', type: 'key' });
  weave.addField(t, { name: 'Files', type: 'attachments' });
  weave.addField(t, { name: 'Face', type: 'avatar' });
  weave.addField(t, { name: 'Part costs', type: 'lookup', config: { relationField: 'Parts', targetField: 'Cost' } });
  weave.addField(t, { name: 'Total cost', type: 'rollup', config: { relationField: 'Parts', targetField: 'Cost', aggregate: 'sum' } });
  weave.addField(t, { name: 'Double', type: 'formula', config: { expression: 'Amount * 2' } });
  weave.addField(t, { name: 'Brief', type: 'document' });
  const ps = ['Bolt', `Housing ${UNBROKEN}`].map((name, i) => weave.createEntity(parts, { name, values: { Cost: [12.5, 987654321.99][i] } }).id);
  const full = weave.createEntity(t, { name: UNBROKEN, values: {
    Status: SINK_STATE, Notes: UNBROKEN, Amount: 98765432109.87, Score: 10, Due: '2026-10-25',
    Window: { start: '1999-01-01', end: '2099-12-31' }, Checked: true, Live: true,
    Site: `https://docs.example.com/${UNBROKEN}`, Mail: `${UNBROKEN.toLowerCase()}@example.com`,
    Kind: SINK_OPTION, Tags: ['Short', SINK_OPTION, SINK_TAG], Parts: ps,
    Definition: { type: 'select', config: { options: ['Draft', SINK_OPTION] } }, Secret: `sk-${UNBROKEN}`,
  } }).id;
  weave.attachToField(full, 'Files', { name: `${UNBROKEN}.pdf`, mime: 'application/pdf', bytes: Buffer.from('%PDF-1') });
  weave.attachToField(full, 'Face', { name: 'face.png', mime: 'image/png', bytes: PNG });
  weave.setDoc(full, `# ${UNBROKEN}\n\nBody text.`, 'Brief');
  weave.createEntity(t, { name: 'A', values: { Status: 'Open', Kind: 'Short', Amount: 1, Score: 1, Tags: ['Short'], Parts: [ps[0]] } });
  weave.createEntity(t, { name: 'Pump housing', values: { Status: SINK_STATE, Kind: 'Short', Amount: 1250000, Window: { start: '2026-01-01', end: '2026-12-31' }, Live: false, Parts: [ps[1]] } });
  weave.createEntity(t, { name: 'Blank', values: { Status: 'Done' } });
  return { table: t.id, row: full, ...views(weave, t) };
}

const withSink = (build) => (weave) => ({ ...build(weave), sink: sink(weave) });

export const SEEDS = Object.fromEntries(Object.entries({ grid, messy, a11y, touch }).map(([name, build]) => [name, withSink(build)]));

const at = (sel) => () => sel;
const tap = (page, sel, cell) => {
  const target = page.locator(`${sel} >> visible=true`).first();
  return cell === 'phone' ? target.tap() : target.click();
};
const menu = async (page, cell, trigger, label) => {
  await tap(page, trigger, cell);
  await tap(page, `.wv-menu >> visible=true >> text=${label}`, cell);
};

export const ROUTES = {
  home: { url: (c) => `${c.base}/#/`, ready: at('#main') },
  table: { url: (c) => `${c.base}/#/table/${c.table}`, ready: at(ROW) },
  board: { url: (c) => `${c.base}/#/table/${c.table}/view/${c.board}`, ready: at('.wv-board .tile') },
  list: { url: (c) => `${c.base}/#/table/${c.table}/view/${c.list}`, ready: at('.wv-list .list-row') },
  entity: {
    url: (c, cell) => (cell === 'phone' ? `${c.base}/#/table/${c.table}?e=${c.ids[3]}` : `${c.base}/#/entity/${c.ids[3]}`),
    ready: (cell) => (cell === 'phone' ? '#dock:not([hidden]) .fieldrow[data-field="Status"]' : '.entity-fields .fieldrow[data-field="Status"]'),
  },
  'row-dock': { url: (c) => `${c.base}/#/table/${c.table}?e=${c.row}`, ready: at('#dock .entity-fields .fieldrow') },
  'issue-table': { url: (c) => `${c.base}/#/table/${c.issue.id}`, ready: at(ROW) },
  'sink-table': { url: (c) => `${c.base}/#/table/${c.sink.table}`, ready: at(ROW) },
  'sink-board': { url: (c) => `${c.base}/#/table/${c.sink.table}/view/${c.sink.board}`, ready: at('.wv-board .tile') },
  'sink-list': { url: (c) => `${c.base}/#/table/${c.sink.table}/view/${c.sink.list}`, ready: at('.wv-list .list-row') },
  'sink-row': {
    url: (c, cell) => (cell === 'phone' ? `${c.base}/#/table/${c.sink.table}?e=${c.sink.row}` : `${c.base}/#/entity/${c.sink.row}`),
    ready: (cell) => (cell === 'phone' ? '#dock:not([hidden]) .fieldrow[data-field="Status"]' : '.entity-fields .fieldrow[data-field="Status"]'),
  },
  'entity-page': { url: (c) => `${c.base}/#/entity/${c.entityId}`, ready: at('.vditor-ir [contenteditable="true"]'), editor: true },
  map: { url: (c) => `${c.base}/#/map`, ready: at('#main .view-title') },
  settings: { url: (c) => `${c.base}/#/settings`, ready: at('#main .settings-purge') },
  trash: { url: (c) => `${c.base}/#/trash`, ready: at('#main .view-title') },
  'activity-log': { url: (c) => `${c.base}/#/activity`, ready: at('.activity-row') },
  'forms-builder': {
    url: (c) => `${c.base}/#/table/${c.table}`, ready: at(ROW),
    async setup(page) {
      await menu(page, 'desktop', '#main .dots-btn[title="Table actions"]', 'Forms…');
      await page.getByRole('button', { name: 'Create form', exact: true }).click();
      await page.waitForSelector('[data-form-field]');
    },
  },
  'published-form': { url: (c) => `${c.base}/f/${c.form.id}`, ready: at('#wv-form-error') },
  start: { url: (c) => `${c.doors.base}/start`, ready: at('main#start:not(:has([role="status"]))') },
  billing: { url: (c) => `${c.doors.base}/billing`, ready: at('#seats li'), session: true },
};

const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);

async function table(page, ctx) {
  await page.goto(`${ctx.base}/#/table/${ctx.tasks.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(ROW);
  await frames(page, 3);
}

async function scrollTo(page, f) {
  await page.evaluate((k) => {
    const wrap = document.querySelector('.table-wrap');
    const box = wrap.classList.contains('wv-grid-scroll') ? wrap : wrap.closest('#main') ?? document.scrollingElement;
    box.scrollTo({ top: (box.scrollHeight - box.clientHeight) * k, behavior: 'instant' });
  }, f);
  await frames(page, 3);
}

const beat = (page) => page.waitForTimeout(400);
const phoneCell = (page) => (page.viewportSize()?.width ?? 1440) < 768;

const JOURNEY_STATES = [
  {
    name: 'load-home', layout: null, cells: BOTH,
    async run(page, ctx) {
      await page.goto(`${ctx.base}/#/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main');
    },
  },
  {
    name: 'open-table', layout: 'table', cells: BOTH,
    async setup(page, ctx) {
      await page.goto(`${ctx.base}/#/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main');
    },
    async run(page, ctx) {
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, ctx.tasks.id);
      await page.waitForSelector(ROW);
    },
  },
  {
    name: 'scroll-grid', layout: 'table', cells: BOTH,
    setup: table,
    async run(page) {
      for (const f of [0.25, 0.5, 0.75, 1]) {
        await scrollTo(page, f);
        await page.waitForFunction(() => !document.querySelector('.wv-grid tbody tr.entity-row-pending'), null, { timeout: 8000 });
      }
      await scrollTo(page, 0);
    },
  },
  {
    name: 'edit-cell', layout: 'table',
    setup: table,
    async run(page, ctx) {
      const id = ctx.ids[2];
      await page.click(`tr[data-eid="${id}"] td[data-field="Name"] input`);
      await page.keyboard.type(`Task 2, edited ${Date.now() % 1e6}`);
      const landed = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
      await page.keyboard.press('Tab');
      await landed;
    },
  },
  {
    name: 'open-row', layout: 'table',
    setup: table,
    async run(page, ctx) {
      await page.click(`tr[data-eid="${ctx.ids[1]}"] .open-link`);
      await page.waitForSelector('#dock:not([hidden]) .fieldrow[data-field="Status"]');
      await frames(page, 3);
      await page.click(`tr[data-eid="${ctx.ids[4]}"] .open-link`);
      await page.waitForFunction((id) => location.hash.includes(id), ctx.ids[4]);
      await page.waitForSelector('#dock:not([hidden]) .fieldrow[data-field="Status"]');
    },
  },
  {
    name: 'switch-view', layout: 'table',
    setup: table,
    async run(page) {
      for (const name of ['Compact', 'All']) {
        if (!await page.locator('#view-pane:not([hidden]) .vp-acc').count()) await page.click('#main .table-view-btn');
        if (await page.getAttribute('#view-pane .vp-view-pick', 'aria-expanded') !== 'true') await page.click('#view-pane .vp-view-pick');
        await page.waitForSelector('.view-strip .view-row');
        await page.locator('.view-strip .view-row').filter({ has: page.locator('.view-name', { hasText: new RegExp(`^${name}$`) }) }).click();
        await page.waitForFunction((n) => location.hash.includes('/view/') || n === 'All', name);
        await page.waitForSelector(ROW);
        await frames(page, 3);
      }
      await page.click('#view-pane .vp-close');
      await page.waitForSelector('#view-pane', { state: 'hidden' });
      await frames(page, 3);
    },
  },
  {
    name: 'type-doc', layout: null, cells: BOTH,
    async setup(page, ctx) {
      await page.goto(`${ctx.base}/#/entity/${ctx.doc}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.vditor-ir [contenteditable="true"]');
      await frames(page, 3);
    },
    async run(page) {
      await page.click('.vditor-ir [contenteditable="true"]');
      await page.keyboard.press('End');
      await page.keyboard.type(' A sentence typed at a reading pace.', { delay: 15 });
      await page.waitForTimeout(1500);
    },
  },
  {
    name: 'trash-undo', layout: 'table',
    setup: table,
    async run(page) {
      const n = await page.locator(ROW).count();
      const boxes = page.locator('.wv-grid tbody .sel-box');
      await boxes.nth(1).check();
      await boxes.nth(2).check();
      await page.locator('.sel-puck .sel-act.danger').click();
      const toast = page.locator('.wv-toast', { hasText: 'Moved to trash' }).last();
      await toast.waitFor();
      await toast.locator('.wv-toast-action').click();
      await page.waitForFunction(([sel, k]) => document.querySelectorAll(sel).length === k, [ROW, n], { timeout: 8000 });
    },
  },
  {
    name: 'theme', layout: 'table',
    setup: table,
    async run(page) {
      for (let i = 0; i < 2; i++) {
        await page.evaluate(() => cycleTheme());
        await frames(page, 4);
      }
    },
  },
  {
    name: 'phone-search', layout: 'table', cells: PHONE,
    setup: table,
    async run(page) {
      await page.tap('.phone-bar .phone-search');
      await page.waitForSelector('#cmdk-back #cmdk-input');
      await beat(page);
      const vp = page.viewportSize();
      await page.touchscreen.tap(vp.width / 2, vp.height - 12);
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
    },
  },
  {
    name: 'phone-menu', layout: 'table', cells: PHONE,
    setup: table,
    async run(page) {
      await page.tap('#main .nav-menu');
      await page.waitForFunction(() => document.querySelector('#app').classList.contains('nav-peek'));
      await beat(page);
      await page.tap('#nav-collapse');
      await page.waitForFunction(() => !document.querySelector('#app').classList.contains('nav-peek'));
    },
  },
  {
    name: 'phone-table-sheet', layout: 'table', cells: PHONE,
    setup: table,
    async run(page) {
      const sheet = '#main .crumb-row.tools-open > .crumb-actions';
      await page.tap('#main .table-tools-btn');
      await page.waitForSelector(sheet);
      await beat(page);
      await page.tap('#main .table-tools-btn');
      await page.waitForSelector(sheet, { state: 'detached' });
    },
  },
  {
    name: 'phone-picker', layout: 'table', cells: PHONE,
    async setup(page, ctx) {
      await page.goto(`${ctx.base}/#/table/${ctx.tasks.id}?e=${ctx.ids[7]}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock:not([hidden]) .chip-trigger[title="Status"]');
      await frames(page, 3);
    },
    async run(page) {
      const chip = '#dock .chip-trigger[title="Status"]';
      const was = (await page.textContent(chip)).trim();
      const to = ['Open', 'Doing', 'Done'].find((st) => !was.includes(st));
      await page.tap(chip);
      await page.waitForSelector('.picker-pop .picker-row');
      await beat(page);
      await page.tap(`.picker-pop .picker-row:has-text("${to}")`);
      await page.waitForSelector('.picker-pop', { state: 'detached' });
      await page.waitForFunction(([q, st]) => document.querySelector(q)?.textContent.includes(st), [chip, to]);
    },
  },
  {
    name: 'phone-open-row', layout: 'table', cells: PHONE,
    setup: table,
    async run(page, ctx) {
      const name = await page.locator(`tr[data-eid="${ctx.ids[1]}"] .list-name`).boundingBox();
      await page.touchscreen.tap(name.x + 20, name.y + name.height / 2);
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await beat(page);
      await page.goBack();
      await page.waitForFunction(() => document.querySelector('#dock')?.hidden !== false);
      await page.waitForSelector(ROW);
    },
  },
].map((j) => ({ ...j, open: 'journey', seeds: GRID }));

const ACTIVITY_STATE = {
  name: 'activity-panel', open: 'journey', layout: null, seeds: MESSY,
  cells: BOTH,
  root: 'aside.wv-activity, .wv-act-view',
  async setup(page, ctx) {
    const phone = phoneCell(page);
    await page.goto(phone ? `${ctx.base}/#/table/${ctx.notes.id}?e=${ctx.activity}` : `${ctx.base}/#/entity/${ctx.activity}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${phone ? '#dock:not([hidden])' : '#main'} .activity-btn`);
  },
  async run(page) {
    const phone = phoneCell(page);
    const btn = page.locator(`${phone ? '#dock' : '#main'} .activity-btn >> visible=true`).first();
    await (phone ? btn.tap() : btn.click());
    const link = page.locator('.wv-activity .wv-act-row').filter({ has: page.locator('.name', { hasText: /^Link$/ }) }).first();
    await link.waitFor();
    await (phone ? link.locator('.wv-act-what').tap() : link.locator('.wv-act-what').click());
    await page.waitForSelector('.wv-activity .wv-act-row.sel .wv-act-tray');
  },
};

const tools = async (page, cell) => {
  const sheet = '#main .crumb-row.tools-open > .crumb-actions';
  if (cell !== 'phone' || await page.locator(sheet).count()) return;
  await tap(page, '#main .table-tools-btn', cell);
  await page.waitForSelector(sheet);
};
const toolsThen = (trigger) => async (page, ctx, cell) => {
  await tools(page, cell);
  await tap(page, trigger, cell);
};
const tableMenu = (label) => async (page, ctx, cell) => {
  if (await page.locator('#main .crumb-row.tools-open > .crumb-actions').count()) await tap(page, '#main .table-tools-btn', cell);
  await menu(page, cell, '#main .dots-btn[title="Table actions"]', label);
};
const scope = (cell) => (cell === 'phone' ? '#dock' : '#main');
const paneSection = (section) => async (page, ctx, cell) => {
  if (!await page.locator('#view-pane:not([hidden]) .vp-acc').count()) await tap(page, '#main .table-view-btn', cell);
  await page.waitForSelector('#view-pane:not([hidden]) .vp-acc');
  const acc = page.locator(`#view-pane .vp-acc[data-section="${section}"]`);
  if (await acc.getAttribute('aria-expanded') !== 'true') await tap(page, `#view-pane .vp-acc[data-section="${section}"]`, cell);
  await page.waitForSelector(`#view-pane #vp-body-${section}`);
};
const paneClose = (page, ctx, cell) => tap(page, '#view-pane .vp-close', cell);

const OVERLAY_STATES = [
  {
    name: 'search', route: 'home', cells: BOTH, root: '#cmdk-back',
    async act(page, ctx, cell) {
      await tap(page, cell === 'phone' ? '.phone-search' : '.search-like', cell);
      await page.waitForSelector('#cmdk-input');
      await page.keyboard.type('Task 0');
      await page.waitForSelector('#cmdk-back mark');
    },
  },
  { name: 'shortcuts', route: 'home', cells: DESKTOP, root: '#modal-back', act: (page, ctx, cell) => menu(page, cell, '#sidebar .nav-identity-more', 'Keyboard shortcuts') },
  { name: 'personal-menu', route: 'home', cells: DESKTOP, root: '.nav-personal-menu', act: (page, ctx, cell) => tap(page, '#sidebar .nav-identity-more', cell) },
  { name: 'new-workspace', route: 'home', cells: DESKTOP, root: '#tray-back', act: (page, ctx, cell) => tap(page, '.ws-new', cell) },
  { name: 'workspace-menu', route: 'home', cells: BOTH, root: '.wv-menu', act: (page, ctx, cell) => tap(page, '#main .dots-btn[title="Workspace actions"]', cell) },
  { name: 'nav-table-menu', route: 'home', cells: DESKTOP, root: '.wv-menu', act: (page, ctx, cell) => tap(page, '#nav .dots-btn[title="Task actions"]', cell) },
  {
    name: 'bug-report', route: 'home', cells: BOTH, root: '#bug-panel',
    async act(page, ctx, cell) {
      if (cell !== 'phone') return tap(page, '.bug-fab', cell);
      await tap(page, '#main .nav-menu', cell);
      await menu(page, cell, '#sidebar .nav-identity-more', 'Report a problem');
    },
  },
  {
    name: 'nav', route: 'home', cells: PHONE, root: '#nav',
    act: (page, ctx, cell) => tap(page, '#main .nav-menu', cell),
    close: (page, ctx, cell) => tap(page, '#nav-collapse', cell),
  },
  {
    name: 'table-tools', route: 'table', cells: PHONE, root: '#main .crumb-row.tools-open > .crumb-actions',
    act: (page, ctx, cell) => tools(page, cell),
    close: (page, ctx, cell) => tap(page, '#main .table-tools-btn', cell),
  },
  { name: 'view', route: 'table', cells: PHONE, root: '.table-view-popover', act: toolsThen('#main .table-view-btn') },
  { name: 'density', route: 'table', cells: PHONE, root: '.table-density-popover', act: toolsThen('#main .table-density-btn') },
  { name: 'phone-row', route: 'table', cells: PHONE, root: '.phone-row-popover', act: toolsThen('#main .eye-btn') },
  { name: 'filters', route: 'table', cells: PHONE, root: '.table-filter-popover', act: toolsThen('#main .table-filter-btn') },
  { name: 'sort', route: 'table', cells: PHONE, root: '.table-sort-popover', act: toolsThen('#main .table-sort-btn') },
  { name: 'group', route: 'table', cells: PHONE, root: '.table-group-popover', act: toolsThen('#main .table-group-btn') },
  { name: 'view-pane-filters', route: 'table', cells: DESKTOP, root: '#view-pane', act: paneSection('filters'), close: paneClose },
  { name: 'view-pane-sort', route: 'table', cells: DESKTOP, root: '#view-pane', act: paneSection('sort'), close: paneClose },
  { name: 'view-pane-group', route: 'table', cells: DESKTOP, root: '#view-pane', act: paneSection('group'), close: paneClose },
  { name: 'fields', route: 'table', cells: DESKTOP, root: '#view-pane', act: paneSection('fields'), close: paneClose },
  { name: 'view-pane-display', route: 'table', cells: DESKTOP, root: '#view-pane', act: paneSection('display'), close: paneClose },
  { name: 'table-menu', route: 'table', cells: DESKTOP, root: '.wv-menu', act: (page, ctx, cell) => tap(page, '#main .dots-btn[title="Table actions"]', cell) },
  { name: 'share-table', route: 'table', cells: BOTH, root: '#modal-back', act: tableMenu('Share…') },
  { name: 'share-page', route: 'table', cells: BOTH, root: '#tray-back', act: tableMenu('New share page') },
  {
    name: 'name-field-editor', route: 'table', cells: DESKTOP, root: '#tray-back',
    async act(page, ctx, cell) {
      await tap(page, '.field-menu[title="Configure Name"]', cell);
      await tap(page, '.chip-pop .chip-pop-row >> text=Field settings', cell);
    },
  },
  { name: 'table-icon', route: 'table', cells: BOTH, root: '.picker-pop', act: (page, ctx, cell) => (cell === 'phone' ? tableMenu('Add icon…')(page, ctx, cell) : tap(page, '#main .icon-btn', cell)) },
  { name: 'field-menu', route: 'table', cells: DESKTOP, root: '.chip-pop', act: (page, ctx, cell) => tap(page, '.field-menu[title="Configure Status"]', cell) },
  {
    name: 'field-editor', route: 'table', cells: DESKTOP, root: '#tray-back',
    async act(page, ctx, cell) {
      await tap(page, '.field-menu[title="Configure Status"]', cell);
      await tap(page, '.chip-pop .chip-pop-row >> text=Field settings', cell);
    },
  },
  { name: 'new-field', route: 'table', cells: DESKTOP, root: '#tray-back', act: (page, ctx, cell) => tap(page, '#main .add-field-btn', cell) },
  { name: 'status-picker', route: 'table', cells: DESKTOP, root: '.picker-pop', act: (page, ctx, cell) => tap(page, `${ROW} .chip-trigger[title="Status"]`, cell) },
  { name: 'link-picker', route: 'table', cells: DESKTOP, root: '#cmdk-back', act: (page, ctx, cell) => tap(page, `${ROW} button >> text=+ link`, cell) },
  { name: 'activity', route: 'entity', cells: DESKTOP, root: 'aside.wv-activity', act: (page, ctx, cell) => tap(page, '#main .activity-btn', cell) },
  { name: 'entity-fields', route: 'entity', cells: DESKTOP, root: '.chip-pop', act: (page, ctx, cell) => tap(page, '#main .eye-btn', cell) },
  { name: 'entity-field-editor', route: 'entity', cells: PHONE, root: '#tray-back', act: (page, ctx, cell) => tap(page, '#dock .fieldrow[data-field="Status"] .fieldrow-label', cell) },
  { name: 'row-actions', route: 'entity', cells: BOTH, root: '.wv-menu', act: (page, ctx, cell) => tap(page, `${scope(cell)} .dots-btn[title="Row actions"]`, cell) },
  { name: 'share-row', route: 'entity', cells: BOTH, root: '#modal-back', act: (page, ctx, cell) => menu(page, cell, `${scope(cell)} .dots-btn[title="Row actions"]`, 'Share…') },
  { name: 'doc-downloads', route: 'entity', cells: BOTH, root: '.wv-menu', act: (page, ctx, cell) => tap(page, `${scope(cell)} .dots-btn[title="Description downloads"]`, cell) },
  { name: 'entity-status', route: 'entity', cells: BOTH, root: '.picker-pop', act: (page, ctx, cell) => tap(page, `${scope(cell)} .fieldrow[data-field="Status"] .chip-trigger`, cell) },
  { name: 'date-picker', route: 'entity', cells: BOTH, root: '.date-pop', act: (page, ctx, cell) => tap(page, `${scope(cell)} .fieldrow[data-field="Due"] .date-pick-btn`, cell) },
  { name: 'range-picker', route: 'entity', cells: BOTH, root: '.date-pop', act: (page, ctx, cell) => tap(page, `${scope(cell)} .fieldrow[data-field="Window"] .date-pick-btn`, cell) },
].map((o) => ({ ...o, open: 'overlay', layout: o.route === 'table' ? 'table' : null, seeds: MESSY }));

const a11yMenu = (label) => (page) => menu(page, 'desktop', '#main .dots-btn[title="Table actions"]', label);

const A11Y_STATES = [
  { name: 'Task table', route: 'table', open: 'rest', layout: 'table' },
  { name: 'field dialog', route: 'table', open: 'overlay', layout: 'table', root: '#tray-back', async act(page) {
    await tap(page, '.field-menu[title="Configure Status"]');
    await tap(page, '.chip-pop .chip-pop-row >> text=Field settings');
  } },
  { name: 'command palette', route: 'table', open: 'overlay', layout: 'table', root: '#cmdk-back', async act(page) {
    await tap(page, '.search-like');
    await page.waitForSelector('#cmdk-input');
  } },
  { name: 'share dialog', route: 'table', open: 'overlay', layout: 'table', root: '#modal-back', act: a11yMenu('Share…') },
  { name: 'filter popover', route: 'table', open: 'overlay', layout: 'table', root: '#view-pane', act: (page) => openPane(page, 'filters') },
  { name: 'sort popover', route: 'table', open: 'overlay', layout: 'table', root: '#view-pane', act: (page) => openPane(page, 'sort') },
  { name: 'row menu', route: 'table', open: 'overlay', layout: 'table', root: '.wv-menu', async act(page) {
    await page.locator(`${ROW} td.pid-cell a.open-link`).first().click();
    await page.waitForSelector('#dock .pose-btn');
    await tap(page, '#dock .crumb-actions .dots-btn');
  } },
  { name: 'Issue table', route: 'issue-table', open: 'rest', layout: 'table' },
  { name: 'entity page', route: 'entity-page', open: 'rest', layout: null },
  { name: 'editor open', route: 'entity-page', open: 'overlay', layout: null, root: '.vditor', act: (page) => page.locator('.vditor-ir [contenteditable="true"] >> visible=true').first().click() },
  { name: 'map', route: 'map', open: 'rest', layout: null },
  { name: 'settings', route: 'settings', open: 'rest', layout: null },
  { name: 'trash', route: 'trash', open: 'rest', layout: null },
  { name: 'activity', route: 'activity-log', open: 'rest', layout: null },
  { name: 'forms builder', route: 'forms-builder', open: 'rest', layout: null },
  { name: 'published form', route: 'published-form', open: 'rest', layout: null },
  { name: 'start', route: 'start', open: 'rest', layout: null },
  { name: 'billing', route: 'billing', open: 'rest', layout: null },
].map((s) => ({ ...s, cells: DESKTOP, seeds: A11Y }));

const TOUCH_STATES = [
  { name: 'workspace home', route: 'home', open: 'rest', layout: null, roots: ['#main'], hold: { touch: [1222] } },
  { name: 'table list', route: 'table', open: 'rest', layout: 'table', roots: ['#main'] },
  { name: 'row page', route: 'row-dock', open: 'rest', layout: 'table', roots: ['#dock'] },
  { name: 'menu', route: 'table', open: 'overlay', layout: 'table', ready: '#main .nav-menu', root: '#sidebar', roots: ['#sidebar', '#ws-rail'], act: (p) => p.click('#main .nav-menu'), hold: { touch: [1163, 1164] } },
  { name: 'picker sheet', route: 'row-dock', open: 'overlay', layout: 'table', ready: '#dock .chip-trigger[title="Status"]', root: '.picker-pop', act: (p) => p.click('#dock .chip-trigger[title="Status"]') },
  { name: 'bug panel', route: 'table', open: 'overlay', layout: 'table', ready: '#main .nav-menu', root: '#bug-panel', act: (p) => openBugReport(p) },
].map((s) => ({ ...s, cells: PHONE, seeds: TOUCH }));

const SHARED_STATES = [
  { name: 'board-view', route: 'board', open: 'rest', layout: 'board', cells: BOTH, hold: { touch: [1217] } },
  { name: 'list-view', route: 'list', open: 'rest', layout: 'list', cells: BOTH },
  { name: 'sink-table', route: 'sink-table', open: 'rest', layout: 'table', cells: BOTH, hold: { 'cutoff|desktop': [1161], 'cutoff|phone': [1152, 1161] } },
  { name: 'sink-list', route: 'sink-list', open: 'rest', layout: 'list', cells: BOTH, hold: { touch: [1169, 1170] } },
  { name: 'sink-board', route: 'sink-board', open: 'rest', layout: 'board', cells: BOTH, hold: { touch: [1217] } },
  { name: 'sink-row', route: 'sink-row', open: 'rest', layout: null, cells: BOTH, roots: ['#dock'], hold: { 'cutoff|phone': [1152, 1161], touch: [1165, 1166, 1167, 1168] } },
];

export const STATES = [...JOURNEY_STATES, ACTIVITY_STATE, ...OVERLAY_STATES, ...A11Y_STATES, ...TOUCH_STATES, ...SHARED_STATES];

export const PROBES = {
  cutoff: { seed: 'messy', opens: ['journey', 'rest', 'overlay', 'hover', 'drag'], cells: CELLS, themes: ['light'] },
  flicker: { seed: 'grid', opens: ['journey', 'rest'], cells: CELLS, themes: ['light'] },
  budgets: { seed: 'grid', opens: ['journey'], cells: CELLS, themes: ['light'] },
  a11y: { seed: 'a11y', opens: ['rest', 'overlay', 'hover', 'drag'], cells: ['desktop'], themes: THEMES },
  touch: { seed: 'touch', opens: ['rest', 'overlay'], cells: ['phone'], themes: THEMES },
};

export const seedsOf = (s) => s.seeds ?? Object.keys(SEEDS);
export const cellsOf = (s) => s.cells ?? ['desktop'];
export const themesOf = (s) => s.themes ?? THEMES;
export const rootsOf = (s) => s.roots ?? (s.root ? [s.root] : ['#main']);
export const readyOf = (s, cell) => s.ready ?? ROUTES[s.route].ready(cell);

export const HOLD_PLATFORMS = ['darwin', 'linux'];
export function plan(probe) {
  const p = PROBES[probe];
  const out = [];
  for (const state of STATES) {
    if (!p.opens.includes(state.open) || !seedsOf(state).includes(p.seed)) continue;
    for (const cell of cellsOf(state).filter((c) => p.cells.includes(c))) {
      for (const theme of themesOf(state).filter((t) => p.themes.includes(t))) {
        out.push({ state, cell, theme, hold: state.hold?.[`${probe}|${cell}|${process.platform}`] ?? state.hold?.[`${probe}|${cell}`] ?? state.hold?.[probe] ?? null });
      }
    }
  }
  return out;
}

export const walked = (probe) => plan(probe).filter((p) => !p.hold);
export const held = (probe) => plan(probe).filter((p) => p.hold);
export const statesOf = (entries, open) => [...new Set(entries.filter((p) => p.state.open === open).map((p) => p.state))];

export function journeyOf(state, cell) {
  if (state.open === 'journey') return state;
  return {
    name: state.name, open: state.open, cells: [cell],
    async run(page, ctx) {
      await page.goto(ROUTES[state.route].url(ctx, cell), { waitUntil: 'networkidle' });
      await page.waitForSelector(readyOf(state, cell));
    },
  };
}
