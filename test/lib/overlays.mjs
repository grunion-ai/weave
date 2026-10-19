const ROW = '.wv-grid tbody tr.entity-row';
const BOTH = ['desktop', 'phone'];
const DESKTOP = ['desktop'];
const PHONE = ['phone'];

export const SURFACES = {
  home: { url: (ctx) => `${ctx.base}/#/`, ready: () => '#main' },
  table: { url: (ctx) => `${ctx.base}/#/table/${ctx.tasks.id}`, ready: () => ROW },
  entity: {
    url: (ctx, cell) => (cell === 'phone' ? `${ctx.base}/#/table/${ctx.tasks.id}?e=${ctx.ids[3]}` : `${ctx.base}/#/entity/${ctx.ids[3]}`),
    ready: (cell) => (cell === 'phone' ? '#dock:not([hidden]) .fieldrow[data-field="Status"]' : '.entity-fields .fieldrow[data-field="Status"]'),
  },
};

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
const tableMenu = (label) => (page, ctx, cell) => menu(page, cell, '#main .dots-btn[title="Table actions"]', label);
const scope = (cell) => (cell === 'phone' ? '#dock' : '#main');

export const OVERLAYS = [
  {
    name: 'search', surface: 'home', cells: BOTH, root: '#cmdk-back',
    async open(page, ctx, cell) {
      await press(page, cell === 'phone' ? '.phone-search' : '.search-like', cell);
      await page.waitForSelector('#cmdk-input');
      await page.keyboard.type('Task 0');
      await page.waitForSelector('#cmdk-back mark');
    },
  },
  { name: 'shortcuts', surface: 'home', cells: DESKTOP, root: '#modal-back', open: (page, ctx, cell) => menu(page, cell, '#sidebar .nav-identity-more', 'Keyboard shortcuts') },
  { name: 'personal-menu', surface: 'home', cells: DESKTOP, root: '.nav-personal-menu', open: (page, ctx, cell) => press(page, '#sidebar .nav-identity-more', cell) },
  { name: 'new-workspace', surface: 'home', cells: DESKTOP, root: '#tray-back', open: (page, ctx, cell) => press(page, '.ws-new', cell) },
  { name: 'workspace-menu', surface: 'home', cells: BOTH, root: '.wv-menu', open: (page, ctx, cell) => press(page, '#main .dots-btn[title="Workspace actions"]', cell) },
  { name: 'nav-table-menu', surface: 'home', cells: DESKTOP, root: '.wv-menu', open: (page, ctx, cell) => press(page, '#nav .dots-btn[title="Task actions"]', cell) },
  { name: 'bug-report', surface: 'home', cells: BOTH, root: '#bug-panel', open: (page, ctx, cell) => press(page, '.bug-fab', cell) },
  {
    name: 'nav', surface: 'home', cells: PHONE, root: '#nav',
    open: (page, ctx, cell) => press(page, '#main .nav-menu', cell),
    close: (page, ctx, cell) => press(page, '#nav-collapse', cell),
  },
  {
    name: 'table-tools', surface: 'table', cells: PHONE, root: '#main .crumb-row.tools-open > .crumb-actions',
    open: (page, ctx, cell) => tools(page, cell),
    close: (page, ctx, cell) => press(page, '#main .table-tools-btn', cell),
  },
  { name: 'view', surface: 'table', cells: BOTH, root: '.table-view-popover', open: toolsThen('#main .table-view-btn') },
  { name: 'density', surface: 'table', cells: BOTH, root: '.table-density-popover', open: toolsThen('#main .table-density-btn') },
  { name: 'fields', surface: 'table', cells: DESKTOP, root: '.table-fields-popover', open: toolsThen('#main .eye-btn') },
  { name: 'phone-row', surface: 'table', cells: PHONE, root: '.phone-row-popover', open: toolsThen('#main .eye-btn') },
  { name: 'filters', surface: 'table', cells: BOTH, root: '.table-filter-popover', open: toolsThen('#main .table-filter-btn') },
  { name: 'table-menu', surface: 'table', cells: DESKTOP, root: '.wv-menu', open: (page, ctx, cell) => press(page, '#main .dots-btn[title="Table actions"]', cell) },
  { name: 'share-table', surface: 'table', cells: BOTH, root: '#modal-back', open: tableMenu('Share…') },
  { name: 'share-page', surface: 'table', cells: BOTH, root: '#tray-back', open: tableMenu('New share page') },
  {
    name: 'name-field-editor', surface: 'table', cells: DESKTOP, root: '#tray-back',
    async open(page, ctx, cell) {
      await press(page, '.field-menu[title="Configure Name"]', cell);
      await press(page, '.chip-pop .chip-pop-row >> text=Field settings', cell);
    },
  },
  { name: 'table-icon', surface: 'table', cells: BOTH, root: '.picker-pop', open: (page, ctx, cell) => press(page, '#main .icon-btn', cell) },
  { name: 'field-menu', surface: 'table', cells: DESKTOP, root: '.chip-pop', open: (page, ctx, cell) => press(page, '.field-menu[title="Configure Status"]', cell) },
  {
    name: 'field-editor', surface: 'table', cells: DESKTOP, root: '#tray-back',
    async open(page, ctx, cell) {
      await press(page, '.field-menu[title="Configure Status"]', cell);
      await press(page, '.chip-pop .chip-pop-row >> text=Field settings', cell);
    },
  },
  { name: 'new-field', surface: 'table', cells: DESKTOP, root: '#tray-back', open: (page, ctx, cell) => press(page, '#main .add-field-btn', cell) },
  { name: 'status-picker', surface: 'table', cells: DESKTOP, root: '.picker-pop', open: (page, ctx, cell) => press(page, `${ROW} .chip-trigger[title="Status"]`, cell) },
  { name: 'link-picker', surface: 'table', cells: DESKTOP, root: '#cmdk-back', open: (page, ctx, cell) => press(page, `${ROW} button >> text=+ link`, cell) },
  { name: 'activity', surface: 'entity', cells: DESKTOP, root: 'aside.wv-activity', open: (page, ctx, cell) => press(page, '#main .activity-btn', cell) },
  { name: 'entity-fields', surface: 'entity', cells: DESKTOP, root: '.chip-pop', open: (page, ctx, cell) => press(page, '#main .eye-btn', cell) },
  { name: 'entity-field-editor', surface: 'entity', cells: PHONE, root: '#tray-back', open: (page, ctx, cell) => press(page, '#dock .fieldrow[data-field="Status"] .fieldrow-label', cell) },
  { name: 'row-actions', surface: 'entity', cells: BOTH, root: '.wv-menu', open: (page, ctx, cell) => press(page, `${scope(cell)} .dots-btn[title="Row actions"]`, cell) },
  { name: 'share-row', surface: 'entity', cells: BOTH, root: '#modal-back', open: (page, ctx, cell) => menu(page, cell, `${scope(cell)} .dots-btn[title="Row actions"]`, 'Share…') },
  { name: 'doc-downloads', surface: 'entity', cells: BOTH, root: '.wv-menu', open: (page, ctx, cell) => press(page, `${scope(cell)} .dots-btn[title="Description downloads"]`, cell) },
  { name: 'entity-status', surface: 'entity', cells: BOTH, root: '.picker-pop', open: (page, ctx, cell) => press(page, `${scope(cell)} .fieldrow[data-field="Status"] .chip-trigger`, cell) },
  { name: 'date-picker', surface: 'entity', cells: BOTH, root: '.date-pop', open: (page, ctx, cell) => press(page, `${scope(cell)} .fieldrow[data-field="Due"] .date-pick-btn`, cell) },
  { name: 'range-picker', surface: 'entity', cells: BOTH, root: '.date-pop', open: (page, ctx, cell) => press(page, `${scope(cell)} .fieldrow[data-field="Window"] .date-pick-btn`, cell) },
];

export const overlaysFor = (list, surface, cell) => list.filter((o) => o.surface === surface && o.cells.includes(cell));
