/* Every closed set a configuration value can come from, and what the choice
   looks like on screen. An agent configuring a table has to guess otherwise:
   the option palette and the format lists live in browser-only code, the type
   list lives in the engine's private constants, and the icon names live in a
   vendored file nobody serves. Served as data — `weave_vocabulary`,
   `weave vocabulary`, GET /api/vocabulary — so a tool description, a guide and
   the engine cannot drift apart. test/vocabulary.test.mjs holds them together.

   Zero imports on purpose: this module is read by the CLI, the MCP server, the
   HTTP server and the worker bundle. */

/* The `renders` line is the point of the file — it says what a reader of the
   grid sees, which is the thing an agent cannot look at. */
export const FIELD_TYPE_VOCABULARY = [
  { type: 'text', renders: 'inline text input', config: ['default'] },
  { type: 'number', renders: 'right-aligned, tabular figures', config: ['format', 'unit', 'currency', 'decimals', 'separator', 'default'] },
  { type: 'date', renders: 'inline date input with a picker button', config: ['format', 'time', 'default'] },
  { type: 'daterange', renders: 'a pair of date inputs', config: ['format', 'default'] },
  { type: 'checkbox', renders: 'a checkbox', config: ['default'] },
  { type: 'url', renders: 'inline input, opens in a new tab', config: ['default'] },
  { type: 'email', renders: 'inline input, opens a mail client', config: ['default'] },
  { type: 'select', renders: 'one soft chip; click picks from the options', config: ['options', 'default'] },
  { type: 'multiselect', renders: 'a row of chips', config: ['options', 'default'] },
  { type: 'workflow', renders: 'one state chip, colored by its category; a board groups on it', config: ['states'] },
  { type: 'relation', renders: 'chips carrying the target\'s name, each with ×, plus "+ link"', config: ['targetDb', 'targetDbs', 'cardinality', 'inverseName'], verb: 'add_relation' },
  { type: 'lookup', renders: 'read-only cell on a tinted background, marked ↗', config: ['relationField', 'targetField'] },
  { type: 'rollup', renders: 'read-only cell on a tinted background, marked Σ', config: ['relationField', 'targetField', 'aggregate'] },
  { type: 'formula', renders: 'read-only cell on a tinted background, marked ƒ', config: ['expression', 'format', 'unit', 'currency', 'decimals', 'separator'] },
  { type: 'document', renders: 'the description previews its first lines in a column of its own; every other document folds into the shared "Docs (n)" chips', config: ['kind'] },
  { type: 'attachments', renders: 'file chips', config: ['multiple'] },
  { type: 'field', renders: 'a field definition as a value — what the Fields registry\'s Definition is', config: ['types', 'depth'] },
  { type: 'key', renders: 'a masked chip naming the credential, never the secret', config: ['kind', 'keystore', 'parts'] },
];

/* An empty string is the honest default: color earns its place by carrying
   meaning (red for blocked, green for done), not by decorating a list. */
export const OPTION_COLORS = [
  { value: '', name: 'neutral' },
  { value: '#4769eb', name: 'blue' },
  { value: '#2ea043', name: 'green' },
  { value: '#f59f00', name: 'amber' },
  { value: '#e5484d', name: 'red' },
  { value: '#8e4ec6', name: 'purple' },
  { value: '#00a2c7', name: 'cyan' },
  { value: '#d6409f', name: 'magenta' },
];

/* Iconly flat, vendored at public/vendor/iconly-flat.js. The VALUE stored on a
   space, a table or a workflow state is `iconly:<name>` — a bare name renders
   as the literal text "ticksquare", which is what the fallback is for: any
   other string paints as itself, so an emoji is a legal icon too. */
export const ICON_FORM = 'iconly:<name>';
export const ICONS = [
  '2user', '3user', 'activity', 'adduser', 'arrow-down', 'arrow-down2', 'arrow-down3', 'arrow-downcircle',
  'arrow-downsquare', 'arrow-left', 'arrow-left2', 'arrow-left3', 'arrow-leftcircle', 'arrow-leftsquare', 'arrow-right', 'arrow-right2',
  'arrow-right3', 'arrow-rightcircle', 'arrow-rightsquare', 'arrow-up', 'arrow-up2', 'arrow-up3', 'arrow-upcircle', 'arrow-upsquare',
  'bag', 'bag2', 'bookmark', 'bug', 'buy', 'calendar', 'call', 'calling', 'callmissed',
  'callsilent', 'camera', 'category', 'chart', 'chat', 'closesquare', 'danger', 'delete',
  'discount', 'discovery', 'document', 'download', 'edit', 'editsquare', 'filter', 'filter2',
  'folder', 'game', 'graph', 'heart', 'hide', 'home', 'image', 'image2',
  'infocircle', 'infosquare', 'location', 'lock', 'login', 'logout', 'message', 'morecircle',
  'moresquare', 'notification', 'paper', 'paperdownload', 'paperfail', 'papernegative', 'paperplus', 'paperupload',
  'password', 'play', 'plus', 'profile', 'scan', 'search', 'send', 'setting',
  'shielddone', 'shieldfail', 'show', 'star', 'swap', 'ticket', 'ticketstar', 'ticksquare',
  'timecircle', 'timesquare', 'unlock', 'upload', 'video', 'voice', 'voice2', 'volumedown',
  'volumeoff', 'volumeup', 'wallet', 'work',
];

/* The marks an author may pick, read from the drawn set so this list and the
   shapes cannot drift apart. */
await import('../public/mark-icons.js');
const MARK_CHARS = Object.keys(globalThis.weaveMarkIcons.MARKS);

export const VOCABULARY = {
  fieldTypes: FIELD_TYPE_VOCABULARY,
  optionColors: OPTION_COLORS,
  icons: {
    form: ICON_FORM,
    // A mark is stored as its own character and drawn as a vector from the
    // same canvas as the flat set (Issue #87), so the two forms are one
    // vocabulary rather than two.
    marks: MARK_CHARS,
    fallback: 'Any other string renders as text, so an emoji ("📦") is a legal icon too.',
    names: ICONS,
  },
  numberFormats: ['number', 'currency', 'percent'],
  dateFormats: ['iso', 'us', 'eu', 'long'],
  documentKinds: ['markdown', 'html', 'code'],
  cardinalities: ['many-to-one', 'one-to-many', 'many-to-many', 'one-to-one'],
  stateCategories: ['not-started', 'in-progress', 'done', 'canceled'],
  aggregates: ['count', 'sum', 'avg', 'min', 'max', 'join'],
  // Off by default; add them where provenance is part of the record.
  systemFields: ['Created At', 'Modified At', 'Created By', 'Modified By', 'Activity'],
  // A board groups by the first workflow field, falling back to the first
  // select; a table with neither cannot be a board.
  viewKinds: ['table', 'board'],
  columnWidth: {
    min: 60,
    unsetCap: 260,
    note: 'An unset column caps at 260px and ellipsises. A set width is a floor as well as a ceiling, so the column holds that width in a grid wider than its card.',
  },
  // Writing a registry row runs the same validation as the schema verb,
  // because it is the schema verb.
  registries: {
    'Workspace/Spaces': ['Name', 'Description'],
    'Workspace/Tables': ['Name', 'Description', 'Field Order', 'Hidden Fields'],
    'Workspace/Fields': ['Name', 'Definition'],
  },
};
