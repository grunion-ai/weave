export const FIELD_TYPE_VOCABULARY = [
  { type: 'text', renders: 'inline text input', config: ['default'] },
  { type: 'number', renders: 'right-aligned, tabular figures; with a `display` of bar, ring or heat, a small graphic filled to the value\'s share of the `scale` (the column max, or a fixed number) beside the text, drawn in the field\'s `color` (ink, icon or accent)', config: ['format', 'unit', 'currency', 'decimals', 'separator', 'accounting', 'display', 'scale', 'color', 'default'] },
  { type: 'rating', renders: 'a row of `max` icons (a star unless the config names another from the inventory), the first `n` filled; click the nth to set n, click the current one again to clear to 0; in the grid a digit sets it and Backspace clears; the value is a whole number 0..max, which formulas, sort, filter and CSV read as a number; `color` ink draws filled icons in the text colour, icon in the icon\'s own hue, accent in the workspace accent', config: ['max', 'icon', 'color', 'default'] },
  { type: 'date', renders: 'inline date input with a picker button — a calendar, or a month/year, month/day, year or day-of-month picker when the grain stores less', config: ['grain', 'format', 'time', 'clock', 'zone', 'zoneName', 'pad', 'default'] },
  { type: 'daterange', renders: 'a pair of date inputs, both wearing the grain and costume; an elapsed span when asked', config: ['grain', 'format', 'time', 'clock', 'zone', 'zoneName', 'pad', 'elapsed', 'default'] },
  { type: 'checkbox', renders: 'a checkbox', config: ['default'] },
  { type: 'toggle', renders: 'a switch wearing the label of its state — `on` or `off` as the config names them; click or Space flips it; the value stays true/false', config: ['on', 'off', 'default'] },
  { type: 'url', renders: 'inline input, opens in a new tab', config: ['default'] },
  { type: 'email', renders: 'inline input, opens a mail client', config: ['default'] },
  { type: 'select', renders: 'one soft chip; click picks from the options', config: ['options', 'default'] },
  { type: 'multiselect', renders: 'a row of chips', config: ['options', 'default'] },
  { type: 'workflow', renders: 'one state chip, colored by its category', config: ['states'] },
  { type: 'relation', renders: 'chips carrying the target\'s name, each with ×, plus "+ link"', config: ['targetDb', 'targetDbs', 'cardinality', 'inverseName'], verb: 'add_relation' },
  { type: 'lookup', renders: 'read-only cell on a tinted background, marked ↗', config: ['relationField', 'targetField'] },
  { type: 'rollup', renders: 'read-only cell on a tinted background, marked Σ, wearing the target column\'s costume; on a Workspace/Spaces row a `via` rollup is the figure the grid footer shows under that column', config: ['relationField', 'via', 'where', 'targetField', 'aggregate', 'separator'] },
  { type: 'formula', renders: 'read-only cell on a tinted background, marked ƒ; a numeric result can wear a bar, ring or heat display like a number; a list result (a lookup, or sortby over lookups) can wear `display: sparkline` in a `style` of line, column or winloss, drawn from the last 60 points, sorted and filtered on its last value; the graphic wears the field\'s `color` like a number', config: ['expression', 'format', 'unit', 'currency', 'decimals', 'separator', 'accounting', 'display', 'scale', 'style', 'color'] },
  { type: 'document', renders: 'every document field is a column of its own: the description previews its first lines; any other renders as a named chip wearing its kind', config: ['kind'] },
  { type: 'attachments', renders: 'file chips', config: ['multiple'] },
  { type: 'field', renders: 'a field definition as a value — what the Fields registry\'s Definition is', config: ['types', 'depth'] },
  { type: 'key', renders: 'a masked chip naming the credential, never the secret', config: ['kind', 'keystore', 'parts'] },
  { type: 'view', renders: 'the row as its chip (inline: name, then the state and a few fields behind a caret) or its card (a tile: the #id link, name, state, description preview, a few fields); every table has one of each, minted and hidden', config: ['shape', 'link', 'state', 'description', 'fields'] },
];

await import('../public/chip-core.js');
const RAMP = globalThis.chipCore;
export const OPTION_COLORS = Object.entries(RAMP.HUE_HEX).map(([name, value]) => {
  const aliases = Object.entries(RAMP.HUE_ALIAS).filter(([, hue]) => hue === name).map(([a]) => a);
  return { value, name, ...(aliases.length ? { aliases } : {}) };
});

await import('../public/icon-registry.js');
await import('../public/field-dialog-core.js');
const REGISTRY = globalThis.weaveIconRegistry;
export const ICON_FORM = 'lucide:<name>';
export const ICONS = globalThis.fieldDialogCore.ICON_INVENTORY;

const ICON_SYNONYMS = [
  ['building buildings office company factory warehouse city', 'landmark house'],
  ['handshake deal partner partnership', 'users briefcase heart'],
  ['tag tags label labels', 'ticket bookmark hash'],
  ['repeat loop recurring cycle sync', 'refresh-cw history'],
  ['idea bulb light-bulb', 'lightbulb sparkles'],
  ['cog gear', 'settings sliders-horizontal'],
  ['person account profile', 'user users'],
  ['comment chat', 'message-circle message-square'],
  ['graph analytics', 'chart-bar chart-column chart-pie'],
  ['task todo', 'square-check list-checks'],
].flatMap(([keys, names]) => keys.split(' ').map((k) => [k, names.split(' ')]));
const iconCategory = (name) => globalThis.fieldDialogCore.categoryOf(`lucide:${name}`);
const iconWords = (s) => s.split('-').filter((t) => t && !/^\d+$/.test(t));
const iconQuery = (v) => String(v ?? '').trim().toLowerCase().replace(/^(lucide|iconly):/, '').replace(/[\s_]+/g, '-');
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
function iconDistance(q, qw, name) {
  for (const [k, names] of ICON_SYNONYMS) if (qw.includes(k) && names.includes(name)) return -1 + names.indexOf(name) / 100;
  const nw = iconWords(name);
  const gap = (a, b) => editDistance(a, b) / Math.max(a.length, b.length);
  let d = Math.min(gap(q, name), 0.1 + Math.min(...qw.flatMap((t) => nw.map((u) => gap(t, u))), 1));
  if (q.length >= 3 && (name.includes(q) || (name.length >= 3 && q.includes(name)))) d = Math.min(d, 0.2);
  if (qw.some((t) => t.length >= 3 && nw.some((u) => u === t))) d = Math.min(d, 0.3);
  if (qw.some((k) => REGISTRY.ALIASES[k] === name)) d = Math.min(d, 0.25);
  return d;
}
const iconEntry = (name) => ({ name, category: iconCategory(name) });
export function nearestIcons(value, limit = 3) {
  const q = iconQuery(value);
  if (!q) return [];
  const qw = iconWords(q);
  return ICONS.map((name) => ({ name, d: iconDistance(q, qw, name) }))
    .filter((m) => m.d < 0.4)
    .sort((a, b) => a.d - b.d || a.name.length - b.name.length || (a.name < b.name ? -1 : 1))
    .slice(0, limit)
    .map((m) => iconEntry(m.name));
}
export function searchIcons(query, limit = 20) {
  const q = iconQuery(query);
  const hit = (name) => name.includes(q) || iconCategory(name) === q
    || ICON_SYNONYMS.some(([k, names]) => (k.startsWith(q) || q.startsWith(k)) && names.includes(name));
  const direct = q ? ICONS.filter(hit) : [];
  const out = { form: ICON_FORM, query: String(query ?? '').trim() };
  if (direct.length) return { ...out, matches: direct.slice(0, limit).map(iconEntry) };
  return { ...out, fuzzy: true, matches: nearestIcons(q, 5) };
}
const listOf = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',')).map((s) => String(s ?? '').trim()).filter(Boolean);
export function vocabularyView(section, query) {
  const qs = listOf(query);
  const names = listOf(section);
  if (!names.length && qs.length) names.push('icons');
  if (!names.length) return VOCABULARY;
  for (const name of names) if (!Object.hasOwn(VOCABULARY, name)) throw new Error(`Unknown vocabulary section '${name}' (${Object.keys(VOCABULARY).join(', ')})`);
  if (qs.length && !names.includes('icons')) throw new Error(`query searches the icons section only (section 'icons'), not '${names.join(', ')}'`);
  const icons = () => (qs.length === 1 ? searchIcons(qs[0])
    : { form: ICON_FORM, searches: qs.map((q) => { const { form, ...rest } = searchIcons(q); return rest; }) });
  const one = (name) => (name === 'icons' && qs.length ? icons() : VOCABULARY[name]);
  return names.length === 1 ? one(names[0]) : Object.fromEntries(names.map((n) => [n, one(n)]));
}

export const FORMULA_FUNCTIONS = globalThis.fieldDialogCore.FORMULA_FUNCTIONS;
export const FORMULA_GROUPS = globalThis.fieldDialogCore.FORMULA_GROUPS;

await import('../public/mark-icons.js');
const MARK_CHARS = Object.keys(globalThis.weaveMarkIcons.MARKS);

export const VOCABULARY = {
  fieldTypes: FIELD_TYPE_VOCABULARY,
  optionColors: OPTION_COLORS,
  icons: {
    form: ICON_FORM,
    legacy: 'iconly:<name> — the set stored before 2026-09-02; every name still resolves to its Lucide twin (see aliases)',
    aliases: REGISTRY.ALIASES,
    marks: MARK_CHARS,
    fallback: 'Anything else is refused — an emoji is not an icon. A legacy iconly:<name> resolves through aliases; a mark character (✓, ◔) is its own value.',
    names: ICONS,
  },
  numberFormats: ['number', 'currency', 'percent', 'compact'],
  numberDisplays: ['text', 'bar', 'ring', 'heat'],
  sparklineStyles: ['line', 'column', 'winloss'],
  cellColors: ['ink', 'icon', 'accent'],
  dateFormats: ['iso', 'us', 'eu', 'long', 'short', 'month', 'quarter', 'ordinal', 'relative'],
  dateGrains: ['year', 'month', 'day'],
  dateGrainForm: 'a list of parts, e.g. ["year","month"] for a month or ["year"] for a year',
  dateStyleNeeds: { month: ['month'], quarter: ['month'], ordinal: ['day'], relative: ['year'] },
  clocks: ['24h', '12h'],
  zones: ['floating', 'fixed', 'instant'],
  documentKinds: ['markdown', 'html', 'code'],
  cardinalities: ['many-to-one', 'one-to-many', 'many-to-many', 'one-to-one'],
  stateCategories: ['not-started', 'in-progress', 'done', 'canceled'],
  aggregates: ['count', 'sum', 'avg', 'min', 'max', 'join', 'median', 'stdev', 'distinct', 'filled', 'empty', 'range'],
  systemFields: ['Created At', 'Modified At', 'Created By', 'Modified By', 'Activity'],
  viewKinds: ['table'],
  columnWidth: {
    min: 60,
    unsetCap: 260,
    note: 'An unset column caps at 260px and ellipsises. A set width is a floor as well as a ceiling, so the column holds that width in a grid wider than its card.',
  },
  fieldDescription: {
    key: 'description',
    note: 'config.description on any field type except view: plain text saying what the value represents and how it is written. Emitted by the schema as the field\'s `description`, drawn under the label on the entity page and as the column tooltip. null clears it. On a view field, `description` is the description SIZE (none, small, medium, large) instead.',
  },
  formulaFunctions: FORMULA_FUNCTIONS,
  formulaGroups: FORMULA_GROUPS,
  registries: {
    'Workspace/Workspaces': ['Description'],
    'Workspace/Spaces': ['Name', 'Description'],
    'Workspace/Tables': ['Name', 'Description', 'Field Order', 'Hidden Fields', 'Filter', 'Sort', 'Hide Rollups'],
    'Workspace/Fields': ['Name', 'Definition'],
  },
};
