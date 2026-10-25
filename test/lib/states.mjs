import { SEEDS } from './seeds.mjs';

export { SEEDS };

export const CELLS = {
  desktop: { engine: 'chromium', viewport: { width: 1440, height: 900 } },
  phone: { engine: 'webkit', device: 'iPhone 15', viewport: { width: 390, height: 844 } },
};
export const TAGS = ['cutoff', 'a11y', 'touch'];

const ROW = '.wv-grid tbody tr.entity-row';
const TILE = '.wv-board .board-group:first-of-type .tile';
const BOTH = ['desktop', 'phone'];
const DESKTOP = ['desktop'];
const PHONE = ['phone'];

const press = (page, sel, cell) => {
  const target = page.locator(`${sel} >> visible=true`).first();
  return cell === 'phone' ? target.tap() : target.click();
};
const menu = async (page, cell, trigger, label) => {
  await press(page, trigger, cell);
  await press(page, `.wv-menu >> visible=true >> text=${label}`, cell);
};
const tools = async (page, cell) => {
  const sheet = '#main .crumb-row.tools-open > .crumb-actions';
  if (cell !== 'phone' || await page.locator(sheet).count()) return;
  await press(page, '#main .table-tools-btn', cell);
  await page.waitForSelector(sheet);
};
const toolsThen = (trigger) => async (page, ctx, cell) => {
  await tools(page, cell);
  await press(page, trigger, cell);
};
const tableMenu = (label) => async (page, ctx, cell) => {
  if (await page.locator('#main .crumb-row.tools-open > .crumb-actions').count()) await press(page, '#main .table-tools-btn', cell);
  await menu(page, cell, '#main .dots-btn[title="Table actions"]', label);
};
const scope = (cell) => (cell === 'phone' ? '#dock' : '#main');
export const EDITOR = '.vditor';

export async function openBugReport(page) {
  const fab = page.locator('.bug-fab');
  if (await fab.isVisible()) await fab.click();
  else {
    if (!(await page.locator('#app.nav-peek').count())) await page.locator('.nav-menu >> visible=true').first().click();
    await page.locator('#sidebar .nav-identity-more').click();
    await page.locator('.nav-personal-menu .nav-bug-row').click();
  }
  await page.waitForSelector('#bug-panel .bug-note');
}

export const OPENS = [
  {
    name: 'search', root: '#cmdk-back',
    async open(page, ctx, cell) {
      await press(page, cell === 'phone' ? '.phone-search' : '.search-like', cell);
      await page.waitForSelector('#cmdk-input');
      await page.keyboard.type('Task 0');
      await page.waitForSelector('#cmdk-back mark');
    },
  },
  {
    name: 'palette', title: 'command palette', root: '#cmdk-back',
    async open(page, ctx, cell) {
      await press(page, '.search-like', cell);
      await page.waitForSelector('#cmdk-input');
    },
  },
  { name: 'shortcuts', root: '#modal-back', open: (page, ctx, cell) => menu(page, cell, '#sidebar .nav-identity-more', 'Keyboard shortcuts') },
  { name: 'personal-menu', root: '.nav-personal-menu', open: (page, ctx, cell) => press(page, '#sidebar .nav-identity-more', cell) },
  { name: 'new-workspace', root: '#tray-back', open: (page, ctx, cell) => press(page, '.ws-new', cell) },
  { name: 'workspace-menu', root: '.wv-menu', open: (page, ctx, cell) => press(page, '#main .dots-btn[title="Workspace actions"]', cell) },
  { name: 'nav-table-menu', root: '.wv-menu', open: (page, ctx, cell) => press(page, '#nav .dots-btn[title="Task actions"]', cell) },
  {
    name: 'bug-report', root: '#bug-panel',
    async open(page, ctx, cell) {
      if (cell !== 'phone') return press(page, '.bug-fab', cell);
      await press(page, '#main .nav-menu', cell);
      await menu(page, cell, '#sidebar .nav-identity-more', 'Report a problem');
    },
  },
  {
    name: 'bug-panel', title: 'bug panel', root: '#bug-panel',
    async open(page) {
      await openBugReport(page);
      await page.waitForSelector('#bug-panel');
    },
  },
  {
    name: 'nav', root: '#nav',
    open: (page, ctx, cell) => press(page, '#main .nav-menu', cell),
    close: (page, ctx, cell) => press(page, '#nav-collapse', cell),
  },
  {
    name: 'nav-rail', title: 'menu', root: '#sidebar, #ws-rail',
    async open(page) {
      await page.click('#main .nav-menu');
      await page.waitForSelector('#sidebar');
    },
  },
  {
    name: 'table-tools', root: '#main .crumb-row.tools-open > .crumb-actions',
    open: (page, ctx, cell) => tools(page, cell),
    close: (page, ctx, cell) => press(page, '#main .table-tools-btn', cell),
  },
  { name: 'view', root: '.table-view-popover', open: toolsThen('#main .table-view-btn') },
  { name: 'density', root: '.table-density-popover', open: toolsThen('#main .table-density-btn') },
  { name: 'fields', root: '.table-fields-popover', open: toolsThen('#main .eye-btn') },
  { name: 'phone-row', root: '.phone-row-popover', open: toolsThen('#main .eye-btn') },
  { name: 'filters', title: 'filter popover', root: '.table-filter-popover', open: toolsThen('#main .table-filter-btn') },
  { name: 'sort', title: 'sort popover', root: '.table-sort-popover', open: (page, ctx, cell) => press(page, '#main .table-sort-btn', cell) },
  { name: 'table-menu', root: '.wv-menu', open: (page, ctx, cell) => press(page, '#main .dots-btn[title="Table actions"]', cell) },
  { name: 'share-table', title: 'share dialog', root: '#modal-back', open: tableMenu('Share…') },
  { name: 'share-page', root: '#tray-back', open: tableMenu('New share page') },
  {
    name: 'name-field-editor', root: '#tray-back',
    async open(page, ctx, cell) {
      await press(page, '.field-menu[title="Configure Name"]', cell);
      await press(page, '.chip-pop .chip-pop-row >> text=Field settings', cell);
    },
  },
  { name: 'table-icon', root: '.picker-pop', open: (page, ctx, cell) => (cell === 'phone' ? tableMenu('Add icon…')(page, ctx, cell) : press(page, '#main .icon-btn', cell)) },
  { name: 'field-menu', root: '.chip-pop', open: (page, ctx, cell) => press(page, '.field-menu[title="Configure Status"]', cell) },
  {
    name: 'field-editor', title: 'field dialog', root: '#tray-back',
    async open(page, ctx, cell) {
      await press(page, '.field-menu[title="Configure Status"]', cell);
      await press(page, '.chip-pop .chip-pop-row >> text=Field settings', cell);
    },
  },
  { name: 'new-field', root: '#tray-back', open: (page, ctx, cell) => press(page, '#main .add-field-btn', cell) },
  { name: 'status-picker', root: '.picker-pop', open: (page, ctx, cell) => press(page, `${ROW} .chip-trigger[title="Status"]`, cell) },
  { name: 'link-picker', root: '#cmdk-back', open: (page, ctx, cell) => press(page, `${ROW} button >> text=+ link`, cell) },
  {
    name: 'row-menu', title: 'row menu', root: '.wv-menu',
    async open(page, ctx, cell) {
      await page.locator(`${ROW} td.pid-cell a.open-link`).first().click();
      await page.waitForSelector('#dock .pose-btn');
      await press(page, '#dock .crumb-actions .dots-btn', cell);
    },
  },
  { name: 'activity', root: 'aside.wv-activity', open: (page, ctx, cell) => press(page, '#main .activity-btn', cell) },
  { name: 'entity-fields', root: '.chip-pop', open: (page, ctx, cell) => press(page, '#main .eye-btn', cell) },
  { name: 'entity-field-editor', root: '#tray-back', open: (page, ctx, cell) => press(page, '#dock .fieldrow[data-field="Status"] .fieldrow-label', cell) },
  { name: 'row-actions', root: '.wv-menu', open: (page, ctx, cell) => press(page, `${scope(cell)} .dots-btn[title="Row actions"]`, cell) },
  { name: 'share-row', root: '#modal-back', open: (page, ctx, cell) => menu(page, cell, `${scope(cell)} .dots-btn[title="Row actions"]`, 'Share…') },
  { name: 'doc-downloads', root: '.wv-menu', open: (page, ctx, cell) => press(page, `${scope(cell)} .dots-btn[title="Description downloads"]`, cell) },
  { name: 'entity-status', root: '.picker-pop', open: (page, ctx, cell) => press(page, `${scope(cell)} .fieldrow[data-field="Status"] .chip-trigger`, cell) },
  {
    name: 'picker-sheet', title: 'picker sheet', root: '.picker-pop',
    async open(page) {
      await page.click('#dock .chip-trigger[title="Status"]');
      await page.waitForSelector('.picker-pop');
    },
  },
  { name: 'date-picker', root: '.date-pop', open: (page, ctx, cell) => press(page, `${scope(cell)} .fieldrow[data-field="Due"] .date-pick-btn`, cell) },
  { name: 'range-picker', root: '.date-pop', open: (page, ctx, cell) => press(page, `${scope(cell)} .fieldrow[data-field="Window"] .date-pick-btn`, cell) },
  { name: 'group', title: 'group popover', root: '.table-group-popover', open: toolsThen('#main .table-group-btn') },
  { name: 'tile-status', title: 'tile status picker', root: '.picker-pop', open: (page, ctx, cell) => press(page, `${TILE} .tile-field[data-field="Status"] .chip-trigger`, cell) },
  { name: 'tile-range', title: 'tile range picker', root: '.date-pop', open: (page, ctx, cell) => press(page, `${TILE} .tile-field[data-field="Window"] .date-pick-btn`, cell) },
  {
    name: 'compare', root: '#dock .dock-compare',
    async open(page, ctx, cell) {
      if (await page.locator('#main .crumb-row.tools-open > .crumb-actions').count()) await press(page, '#main .table-tools-btn', cell);
      for (const n of [1, 2]) await press(page, `${TILE}:nth-child(${n}) .tile-pick`, cell);
      const go = page.locator('.board-footer .board-compare');
      await go.evaluate((n) => n.scrollIntoView({ block: 'center', behavior: 'instant' }));
      if (cell !== 'phone') return go.click();
      const box = await go.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    },
    close: (page, ctx, cell) => press(page, '#dock .compare-close', cell),
  },
  { name: 'editor', title: 'editor open', root: EDITOR, open: (page) => page.locator('.vditor-ir [contenteditable="true"] >> visible=true').first().click() },
].map((o) => ({ title: o.name.replace(/-/g, ' '), ...o }));

const cut = (open, cells) => ({ open, cells, seed: 'messy', tags: ['cutoff'] });
const rest = () => cut(null, BOTH);
const tap = (open = null) => ({ open, cells: PHONE, seed: 'touch', tags: ['touch'] });
const ax = (open = null, seed = 'a11y') => ({ open, cells: DESKTOP, seed, tags: ['a11y'] });

const TASKS = ['journeys', 'messy', 'touch'];
const page = () => '#main';

export const SURFACES = {
  home: {
    title: 'workspace home', route: 'home', seeds: TASKS,
    url: (ctx) => `${ctx.base}/#/`, ready: () => '#main', root: page,
    states: [
      tap(),
      cut('search', BOTH), cut('shortcuts', DESKTOP), cut('personal-menu', DESKTOP), cut('new-workspace', DESKTOP),
      cut('workspace-menu', BOTH), cut('nav-table-menu', DESKTOP), cut('bug-report', BOTH), cut('nav', PHONE),
    ],
  },
  table: {
    title: 'table list', route: 'table', layout: 'grid', seeds: TASKS,
    url: (ctx) => `${ctx.base}/#/table/${ctx.table}`, ready: () => ROW, root: page,
    states: [
      tap(), tap('nav-rail'), tap('bug-panel'),
      cut('table-tools', PHONE), cut('view', BOTH), cut('density', BOTH), cut('fields', DESKTOP), cut('phone-row', PHONE),
      cut('filters', BOTH), cut('table-menu', DESKTOP), cut('share-table', BOTH), cut('share-page', BOTH),
      cut('name-field-editor', DESKTOP), cut('table-icon', BOTH), cut('field-menu', DESKTOP), cut('field-editor', DESKTOP),
      cut('new-field', DESKTOP), cut('status-picker', DESKTOP), cut('link-picker', DESKTOP),
    ],
  },
  entity: {
    title: 'row page', route: 'entity', seeds: TASKS,
    url: (ctx, cell) => (cell === 'phone' ? `${ctx.base}/#/table/${ctx.table}?e=${ctx.row}` : `${ctx.base}/#/entity/${ctx.row}`),
    ready: (cell) => (cell === 'phone' ? '#dock:not([hidden]) .fieldrow[data-field="Status"]' : '.entity-fields .fieldrow[data-field="Status"]'),
    root: scope,
    states: [
      tap(), tap('picker-sheet'),
      cut('activity', DESKTOP), cut('entity-fields', DESKTOP), cut('entity-field-editor', PHONE), cut('row-actions', BOTH),
      cut('share-row', BOTH), cut('doc-downloads', BOTH), cut('entity-status', BOTH), cut('date-picker', BOTH), cut('range-picker', BOTH),
    ],
  },
  board: {
    title: 'board', route: 'table', layout: 'board', seeds: ['messy', 'touch'],
    url: (ctx) => `${ctx.base}/#/table/${ctx.table}/view/${ctx.board.id}`, ready: () => '.wv-board .tile', root: page,
    states: [
      tap(), tap('group'),
      rest(), cut('view', BOTH), cut('group', BOTH), cut('tile-status', DESKTOP), cut('tile-range', DESKTOP), cut('compare', BOTH),
    ],
  },
  list: {
    title: 'list', route: 'table', layout: 'list', seeds: ['messy', 'touch'],
    url: (ctx) => `${ctx.base}/#/table/${ctx.table}/view/${ctx.list.id}`, ready: () => '.wv-list .list-row', root: page,
    states: [tap(), tap('group'), rest(), cut('view', BOTH), cut('group', BOTH)],
  },
  'task-table': {
    title: 'Task table', route: 'table', layout: 'grid', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/#/table/${ctx.task.id}`, ready: () => ROW, root: page,
    states: [ax(), ax('field-editor'), ax('palette'), ax('share-table'), ax('filters'), ax('sort'), ax('row-menu')],
  },
  'issue-table': {
    title: 'Issue table', route: 'table', layout: 'grid', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/#/table/${ctx.issue.id}`, ready: () => ROW, root: page,
    states: [ax()],
  },
  'task-board': {
    title: 'Task board', route: 'table', layout: 'board', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/#/table/${ctx.task.id}/view/${ctx.board.id}`, ready: () => '.wv-board .tile', root: page,
    states: [ax()],
  },
  'task-list': {
    title: 'Task list', route: 'table', layout: 'list', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/#/table/${ctx.task.id}/view/${ctx.list.id}`, ready: () => '.wv-list .list-row', root: page,
    states: [ax()],
  },
  'issue-page': {
    title: 'entity page', route: 'entity', seeds: ['a11y'], editor: true,
    url: (ctx) => `${ctx.base}/#/entity/${ctx.entityId}`, ready: () => '.vditor-ir [contenteditable="true"]', root: page,
    states: [ax(), ax('editor')],
  },
  map: {
    title: 'map', route: 'map', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/#/map`, ready: () => '#main .view-title', root: page,
    states: [ax()],
  },
  settings: {
    title: 'settings', route: 'settings', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/#/settings`, ready: () => '#main .settings-purge', root: page,
    states: [ax()],
  },
  trash: {
    title: 'trash', route: 'trash', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/#/trash`, ready: () => '#main .view-title', root: page,
    states: [ax()],
  },
  'activity-feed': {
    title: 'activity', route: 'activity', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/#/activity`, ready: () => '.activity-row', root: page,
    states: [ax()],
  },
  'form-builder': {
    title: 'forms builder', route: 'table', layout: 'grid', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/#/table/${ctx.task.id}`, ready: () => ROW, root: page,
    async setup(p, ctx, cell) {
      await tableMenu('Forms…')(p, ctx, cell);
      await p.getByRole('button', { name: 'Create form', exact: true }).click();
      await p.waitForSelector('[data-form-field]');
    },
    states: [ax()],
  },
  'published-form': {
    title: 'published form', route: 'form', seeds: ['a11y'],
    url: (ctx) => `${ctx.base}/f/${ctx.form.id}`, ready: () => '#wv-form-error', root: () => 'body',
    states: [ax()],
  },
  start: {
    title: 'start', route: 'start', seeds: ['doors'],
    url: (ctx) => `${ctx.base}/start`, ready: () => 'main#start:not(:has([role="status"]))', root: () => 'main#start',
    states: [ax(null, 'doors')],
  },
  billing: {
    title: 'billing', route: 'billing', seeds: ['doors'], session: true,
    url: (ctx) => `${ctx.base}/billing`, ready: () => '#seats li', root: () => 'body',
    states: [ax(null, 'doors')],
  },
};

const OPEN = new Map(OPENS.map((o) => [o.name, o]));

export const STATES = Object.entries(SURFACES).flatMap(([name, s]) => {
  const surface = { name, ...s };
  return s.states.flatMap((w) => w.cells.map((cell) => {
    const open = w.open === null ? null : OPEN.get(w.open) ?? { name: w.open };
    return {
      id: `${w.seed}:${name}${open ? `+${open.name}` : ''}@${cell}`,
      title: open ? open.title : surface.title,
      seed: w.seed, cell, tags: w.tags, layout: s.layout ?? null,
      surface, open, root: open ? open.root : s.root(cell),
    };
  }));
});

export function states({ tag, cell, seed, surface, open } = {}) {
  return STATES.filter((st) => (!tag || st.tags.includes(tag))
    && (!cell || st.cell === cell)
    && (!seed || st.seed === seed)
    && (!surface || st.surface.name === surface)
    && (open === undefined || (st.open?.name ?? null) === open));
}

export function bySurface(list) {
  const out = new Map();
  for (const st of list) {
    if (!out.has(st.surface.name)) out.set(st.surface.name, []);
    out.get(st.surface.name).push(st);
  }
  return out;
}
