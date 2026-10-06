import '../public/chip-core.js';
import '../public/date-grain.js';
import '../public/number-core.js';
import '../public/term-core.js';
import '../public/icon-registry.js';
import '../public/mark-icons.js';
import '../public/editor-lib.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { join, dirname } from 'node:path';
import { uuid, slug } from './ids.js';
import { workspaceName, workspaceSlug, nameFromFile } from './workspace-name.js';
import { Store, WeaveError } from './store.js';
import { nearestIcons } from './vocabulary.js';
import { evaluate, check as checkExpression, references as formulaReferences } from './formula.js';
import { aggregate as aggregateValues, describeNumbers, histogram, distribution, NUMERIC_AGGREGATES } from './stats.js';
import { FIELD_TYPE_VOCABULARY, VOCABULARY } from './vocabulary.js';

/* An icon value is one of the inventory (`lucide:<name>`), a legacy alias that
   still resolves (`iconly:<name>`), or a drawn mark — anything else is refused
   (Kyle, 2026-09-02: "still finding emojis; this should not be possible").
   Empty clears. */
function iconValue(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const reg = globalThis.weaveIconRegistry, marks = globalThis.weaveMarkIcons;
  if (reg?.resolve(s) || marks?.has(s)) return s;
  /* Name the nearest inventory icons so the next write lands (Issue #591). */
  const near = nearestIcons(s).map((m) => `lucide:${m.name} (${m.category})`);
  throw new WeaveError(`Icon '${s}' is not in the inventory${near.length ? `; nearest: ${near.join(', ')}` : ''}. Search it with weave_vocabulary {section:"icons", query:"<word>"} (CLI: weave vocabulary icons <word>), or use a mark character`, 'invalid');
}

// What one row is called (Feature #40): the pure half, shared with the browser.
const Term = globalThis.WeaveTerm;
const SYSTEM_TERMS = { spaces: 'space', tables: 'table', fields: 'field', workflows: 'workflow' };

// Minimal CSV parser handling quoted cells and embedded newlines.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text ?? '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/* The entity body is blocks, not fields: a document, an attachment row and a
   related table each stand alone, and every other field belongs to the one
   value block that `@values` names. */
const VALUES_BLOCK = '@values';
// The shape of every file and logo id uuid() (crypto.randomUUID) mints.
const BLOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isBodyBlock = (f) => f.type === 'document' || f.type === 'attachments'
  || (f.type === 'relation' && !!(f.many ?? f.config?.many));

const VALUE_TYPES = ['text', 'number', 'rating', 'date', 'daterange', 'checkbox', 'toggle', 'url', 'email', 'select', 'multiselect', 'workflow', 'relation', 'field', 'key', 'attachments'];
// The stored values search reads as text (Feature #228). `key` is a secret and stays out.
const SEARCHED_VALUE_TYPES = new Set(['text', 'url', 'email']);
// Registry tables whose rows are containers universalSearch already returns.
const REGISTRY_HITS = new Set(['workspaces', 'spaces', 'tables', 'views']);
/* Collections are plain objects keyed by id (or name, for keys), and a ref
   is any string a caller sends. These three would find Object.prototype or
   Object itself, and the verb after the lookup would write to it, so a
   lookup reads own properties only and nothing may be named them
   (Issue #485). */
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const own = (o, k) => (o != null && Object.hasOwn(o, k) ? o[k] : undefined);
function refuseReserved(kind, name) {
  if (RESERVED_NAMES.has(String(name).trim())) throw new WeaveError(`'${String(name).trim()}' is reserved and cannot name a ${kind}`, 'invalid');
}

/* The raster image type the leading bytes prove, or null. A claimed type is
   never trusted for anything served inline (Issue #483). */
export function sniffImage(bytes) {
  const b = Buffer.from(bytes ?? []);
  const at = (hex, i = 0) => b.subarray(i, i + hex.length / 2).toString('hex') === hex;
  if (at('89504e470d0a1a0a')) return 'image/png';
  if (at('ffd8ff')) return 'image/jpeg';
  if (at('474946383761') || at('474946383961')) return 'image/gif';
  if (at('52494646') && at('57454250', 8)) return 'image/webp';
  return null;
}

/* The logo's type (Issue #492): a raster image its bytes prove, or an SVG,
   which the workspace chip draws through an <img>. Null for anything else. */
export function logoType(bytes) {
  const head = Buffer.from(bytes ?? []).subarray(0, 1024).toString('utf8').replace(/^\ufeff/, '');
  return sniffImage(bytes)
    ?? (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s/>]/i.test(head) ? 'image/svg+xml' : null);
}

/* Headers for serving a stored file (Issue #483). Only inert types the app
   shows in place go inline: images (checked against their bytes), PDFs for
   the document viewer iframe, plain text. Anything else, HTML and SVG
   included, downloads as octet-stream. The sandbox policy and nosniff hold
   for every file, so no stored byte runs script on the workspace origin.
   WEAVE_INLINE_FILE_TYPES (comma-separated) adds types served in place. */
const INLINE_FILE_TYPES = new Set(['application/pdf', 'text/plain']);
export function fileHeaders(meta, bytes) {
  const claimed = String(meta.mime ?? '').split(';')[0].trim().toLowerCase();
  const image = claimed.startsWith('image/') ? sniffImage(bytes) : null;
  const extra = String(process.env.WEAVE_INLINE_FILE_TYPES ?? '').toLowerCase().split(',').map((t) => t.trim());
  const inline = image === claimed ? image
    : INLINE_FILE_TYPES.has(claimed) || (claimed && extra.includes(claimed)) ? claimed : null;
  const name = String(meta.name ?? 'file');
  const ascii = name.replace(/[^\w.-]+/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*!]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return {
    'Content-Type': inline ?? 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
  };
}

/* checkbox and toggle store the same boolean; the toggle names its two states (Feature #202). */
const isBoolType = (t) => t === 'checkbox' || t === 'toggle';
const COMPUTED_TYPES = ['lookup', 'rollup', 'formula', 'view'];
/* The system columns a table may sort by (Issues #254, #273), each against
   the entity key that holds it. `Public Id` is the grid's # column. Activity
   is absent: it is a count that links to the history, not a value to order
   by. public/field-dialog-core.js mirrors the names (test/sort-labels). */
export const SYSTEM_SORT_KEYS = {
  'Created At': 'createdAt', 'Modified At': 'updatedAt',
  'Created By': 'createdBy', 'Modified By': 'modifiedBy',
  'Public Id': 'publicId',
};
/* The where operators that read a value's painted text (Issue #617). */
const TEXT_OPS = new Set(['contains', 'is-empty', 'not-empty']);
/* Chip and Card (Kyle, 2026-09-04): every table carries two `view` fields
   that say how one of its rows appears elsewhere — the chip inline (a
   relation cell, a doc mention, a reference card) and the card as a tile (a
   gallery, a peek). The config is the table's, the same for
   every row: the public-id link, the state, a description preview at one of
   three sizes, and which other fields ride along. Minted per table like the
   description role, held by id, hidden from the grid until unhidden. */
export const VIEW_SHAPES = ['chip', 'card'];
export const DESCRIPTION_SIZES = ['none', 'small', 'medium', 'large'];
const DESCRIPTION_CHARS = { small: 0, medium: 120, large: 320 };
/* An entity keeps its newest ACTIVITY_CAP activity entries. Older ones are
   dropped and counted on the entity as `activityDropped` (Issue #281), so a
   read can say the history is partial instead of passing it off as complete. */
export const ACTIVITY_CAP = 500;
/* Field configuration history (Issue #428). A field is structure, not a row,
   so its history is not on an entity: every change updateField makes lands
   in the workspace's audit log, the archive of structural work, under one of
   these two actions, and the Activity feed reads it back as the table's
   entries. The definition is the field's name, type and config, minus the
   column width: a width is a layout setting (a view's, since Feature #233),
   and a toast per resize would be noise. */
const FIELD_CONFIG_ACTIONS = { 'field-config-updated': 'field-config-updated', 'field-config-undo': 'undo' };
function fieldDefinition(f) {
  const { width, ...config } = f.config ?? {};
  return structuredClone({ name: f.name, type: f.type, config });
}
// Key order is not meaning: two definitions are the same when their sorted
// JSON is.
function canonicalJSON(v) {
  return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((kk) => [kk, x[kk]])) : x));
}
function definitionChanges(before, after) {
  const out = [];
  if (before.name !== after.name) out.push('name');
  if (before.type !== after.type) out.push('type');
  for (const k of new Set([...Object.keys(before.config), ...Object.keys(after.config)])) {
    if (canonicalJSON(before.config[k]) !== canonicalJSON(after.config[k])) out.push(k);
  }
  return out;
}
/* How many segments a view takes when nobody chose (`fields: null`): the
   state counts as one, so a chip stays three wide and a card four. */
const VIEW_AUTO_SEGMENTS = { chip: 3, card: 4 };
const VIEW_DEFAULTS = {
  chip: { shape: 'chip', link: false, state: true, description: 'none', fields: null },
  card: { shape: 'card', link: true, state: true, description: 'small', fields: null },
};
const VIEW_NAMES = { chip: 'Chip', card: 'Card' };
/* What a view segment may show: a value a reader can take in at a glance.
   Long-form bodies, files, definitions and the views themselves are out. */
const VIEW_EXCLUDED_TYPES = ['document', 'attachments', 'key', 'field', 'view'];
/* The description as prose lines: the block pass editor-lib already runs for
   the grid preview (one classifier, so a card and a cell never disagree
   about what a document is), then the inline marks dropped — a card has no
   room for bold. A page, a model or a diagram is named, not flattened. */
function plainLines(md, budget = 12) {
  const { kind, lines, label } = globalThis.WeaveEditorLib.docPreview(md, { lines: budget });
  if (!kind) return [];
  if (!lines.length) return label ? [label] : [];
  return lines.map((l) => l
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .trim()).filter(Boolean);
}
/* The system columns a grid can show (Feature #65). Since Issue #418 a view
   holds the ones it shows in its one ordered field list, beside the fields,
   as `sys:<name>` ids, so they move, freeze, size and hide like any field.
   Activity is the entity page's history panel, not a column, and stays a
   table-level switch in `systemFields`. */
const GRID_SYSTEM_COLUMNS = ['Created At', 'Modified At', 'Created By', 'Modified By'];
const sysColumnId = (name) => `sys:${name}`;
const sysColumnName = (id) => (typeof id === 'string' && id.startsWith('sys:') && GRID_SYSTEM_COLUMNS.includes(id.slice(4)) ? id.slice(4) : null);
/* A view entry's name: a field's, or a system column's. */
const viewEntryName = (db, id) => db.fields[id]?.name ?? sysColumnName(id);
/* A new column goes before the trailing chip and card: the views are
   presentation over the data columns, so they close the order. */
function placeField(db, id) {
  let at = db.fieldOrder.length;
  while (at > 0 && db.fields[db.fieldOrder[at - 1]]?.type === 'view') at--;
  db.fieldOrder.splice(at, 0, id);
  // A new column shows in every table view (Feature #229), as it showed in
  // the one grid before views; a chip or card is minted hidden. It lands
  // before the system columns that close a view, where it always landed.
  if (db.fields[id]?.type !== 'view') {
    for (const v of db.tableViews ?? []) {
      if (v.fields.includes(id)) continue;
      let k = v.fields.length;
      while (k > 0 && sysColumnName(v.fields[k - 1])) k--;
      v.fields.splice(k, 0, id);
    }
  }
}
/* Put a field back where the schema order says, among the visible ones: after
   the nearest field before it that is showing, or first (Feature #229). */
function showBySchema(db, fields, id) {
  const at = db.fieldOrder.indexOf(id);
  for (let k = at - 1; k >= 0; k--) {
    const i = fields.indexOf(db.fieldOrder[k]);
    if (i >= 0) { fields.splice(i + 1, 0, id); return; }
  }
  fields.unshift(id);
}
const clip =(text, max) => (text.length <= max ? text : text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');
/* Types whose definition can name the value a new row starts with. Workflow is
   absent on purpose: its default is one of its states, which is where it has
   always lived. */
const DYNAMIC_DATE_DEFAULTS = ['today()', 'now()'];
const DOCUMENT_KINDS = ['markdown', 'html', 'code'];
/* What sort of credential a `key` column holds (Feature #143). The kind is
   metadata — it changes the glyph, the label and the reveal default, never
   what the cell stores, which is always a NAME. `pair` is the one kind whose
   entry has named parts, so an OAuth id and its secret stay ONE credential
   under ONE grant rather than two fields nobody keeps in step. */
export const CREDENTIAL_KINDS = ['apikey', 'token', 'password', 'id', 'pair'];
/* Which store holds the secret the name points at. `local` is weave's own
   keystore file; the rest are refs into a manager that keeps its own access
   rules, which is the whole reason weave never has to become one. */
export const KEYSTORES = ['local', '1password', 'aws-sm', 'google-sm', 'cloudflare', 'apple-passwords'];
const DEFAULT_PAIR_PARTS = [{ name: 'id', secret: false }, { name: 'secret', secret: true }];
const NUMBER_COSTUME_KEYS = ['format', 'unit', 'currency', 'decimals', 'separator', 'accounting', 'display', 'scale', 'color'];
/* How a number is drawn (Feature #230): text, or a graphic drawn against a
   scale — the column's max unless the field names a fixed one. Stars are not
   here: a rating is its own type. public/cell-graphics.js draws them. */
export const NUMBER_DISPLAYS = ['text', 'bar', 'ring', 'heat'];
const isGraphicDisplay = (d) => d === 'bar' || d === 'ring' || d === 'heat';
/* The colour a rich cell is drawn in (Feature #235), one setting per field
   on a rating, a number's display and a formula's display. Quiet ink is the
   default and is never written down: the graphic in the text colour, the
   value's own words doing the talking. `icon` colours by what is drawn — a
   star amber, a heart rose, a bar teal, a loss red — and `accent` draws
   everything in the workspace accent. public/cell-graphics.js mirrors the
   list, and public/style.css holds the colours, each with its dark twin. */
export const CELL_COLORS = ['ink', 'icon', 'accent'];
function cellColorValue(color) {
  if (color == null) return 'ink';
  if (!CELL_COLORS.includes(color)) throw new WeaveError(`Invalid color '${color}' (${CELL_COLORS.join(', ')})`, 'invalid');
  return color;
}
/* A formula that returns a list can wear a sparkline (Feature #232): a
   line, columns, or win/loss bars. A stored number cannot — it is one value. */
export const SPARKLINE_STYLES = ['line', 'column', 'winloss'];
/* The last number in a series: what a sort or a filter on a sparkline reads. */
const lastNumber = (list) => { for (let i = list.length - 1; i >= 0; i--) if (typeof list[i] === 'number' && Number.isFinite(list[i])) return list[i]; return null; };
/* A rating (Feature #231): a whole number from 0 to `max`, drawn as `max`
   icons. The max is any whole number from 1 (Feature #234 lifted the old cap
   of 10); 5 unless named, and the dialog offers 3, 5 and 7 as shortcuts.
   The guard of 100 exists because every icon is a DOM node in every visible
   grid cell: a max in the thousands would put tens of thousands of buttons in
   one screen of rows and stall the paint, and a row of more than 100 icons is
   already wider than any screen, so nobody can read or click it as a rating. */
export const RATING_MAX = 100;
const RATING_DEFAULTS = { max: 5, icon: 'lucide:star' };
/* The aggregates whose answer stays on a rating's scale, so a rollup over a
   rating can draw the same icons. A sum or a spread leaves the scale. */
const RATING_SCALE_AGGS = ['avg', 'min', 'max', 'median'];
const ratingValue = (n, max) => Math.min(max, Math.max(0, Math.round(n)));
/* Grain and costume keys of a date (Feature #164) — the rules live in public/date-grain.js. */
const DATE_COSTUME_KEYS = ['grain', 'format', 'time', 'clock', 'zone', 'zoneName', 'pad', 'elapsed'];
/* A formula wears every number key, plus a sparkline's style (Feature #232),
   or a date's costume when it returns a date (Issue #576): `formulaCostume`
   picks one. `elapsed` belongs to a range, which no formula returns. */
const FORMULA_COSTUME_KEYS = [...new Set([...NUMBER_COSTUME_KEYS, 'style', ...DATE_COSTUME_KEYS.filter((k) => k !== 'elapsed')])];
const DG = globalThis.weaveDateGrain;
const DEFAULTABLE_TYPES = ['text', 'number', 'rating', 'date', 'daterange', 'checkbox', 'toggle', 'url', 'email', 'select', 'multiselect'];
export const FIELD_TYPES = [...VALUE_TYPES, ...COMPUTED_TYPES, 'document'];
/* What a document edit actually did, in the terms a reader of the feed needs:
   where it landed, how much text came and went, and the first line that
   differs. Trimming the common head and tail is the shape of a single edit —
   which is what an autosave almost always is — and degrades honestly to "the
   whole document changed" when the edit was not local. */
/* One typing session is one revision: the same ten minutes the activity
   feed folds doc-updated entries over (Issue #32), so a page's history and
   its feed tell the same story. */
const DOC_REVISION_WINDOW_MS = 10 * 60 * 1000;
function docChange(field, before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head
    && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return {
    field,
    length: after.length,
    prevLength: before.length,
    delta: after.length - before.length,
    line: head + 1,
    linesAdded: b.length - head - tail,
    linesRemoved: a.length - head - tail,
    preview: (b[head] ?? a[head] ?? '').trim().slice(0, 120),
  };
}

/* Four categories since 2026-08-24. 'other' was a purple escape hatch no
   seeded workflow used; anything still stored under it was describing
   in-progress, and normaliseStates migrates it on the next write. */
const STATE_CATEGORIES = ['not-started', 'in-progress', 'done', 'canceled'];
const RETIRED_STATE_CATEGORIES = { other: 'in-progress' };
/* The lifecycle a state field starts life with (Issue #251). A workflow whose
   config omits `states` used to be a refusal, so a new status column cost you
   a vocabulary before it could exist; the four categories already say what the
   four states are. Named once here, mirrored in public/field-dialog-core.js so
   the tray opens on the same list, and both are gated in
   test/workflow-defaults.test.mjs. None is the default (Issue #421): a new
   row's state is empty until the author marks one. */
const DEFAULT_WORKFLOW_STATES = [
  { name: 'Not started', category: 'not-started' },
  { name: 'In progress', category: 'in-progress' },
  { name: 'Done', category: 'done' },
  { name: 'Canceled', category: 'canceled' },
];

/* A Workflows row's State (Feature #249, Kyle 2026-10-03): setup, computed by
   the engine. Ready means the rule names a table, trigger and actions that
   exist and values that fit. */
const WORKFLOW_STATES = [
  { name: 'Setup incomplete', category: 'not-started', default: true },
  { name: 'Ready', category: 'done' },
];
/* The actor an automation's writes carry (Issue #674): its Workflows row.
   The UI draws exactly this string as the row's chip, so the spelling is a
   contract with public/app.js. */
const workflowActor = (rowId) => `workflow:${rowId}`;
// A rule as its Script holds it: JSON, two-space indented.
const workflowScript = (spec) => `${JSON.stringify(spec, null, 2)}\n`;

/* An option's colour is a name from the ten-hue ramp, which public/chip-core.js
   owns: the ramp, its two published aliases, and the one reader that turns an
   authored name or hex into a ramp name. `color` is kept in step with the hue
   so schema export, CSV and every other existing reader keeps working.

   Reads are forgiving and writes are strict (Issue #551). A colour already on
   disk resolves to whichever hue its hex was, or rests on slate, so no stored
   workspace becomes unreadable. A colour a caller just sent is refused by
   name, because weave used to swap an unknown one for slate and answer 201. */
const { HUE_HEX, HUES, hueName } = globalThis.chipCore;
function hueOf(o, { strict = false } = {}) {
  for (const authored of [o?.hue, o?.color]) {
    if (authored === undefined || authored === null || String(authored).trim() === '') continue;
    const hue = hueName(authored);
    if (hue) return hue;
    if (strict) {
      throw new WeaveError(
        `Unknown option colour '${authored}' (use a hue name: ${HUES.join(', ')}; `
        + `or its hex, or '' for slate)`, 'invalid');
    }
  }
  return 'slate';
}
/* One option, normalised: identity, name, ramp hue, optional glyph, and the
   hex that hue resolves to. */
function normaliseOption(o, { strict = false } = {}) {
  if (typeof o === 'string') return { id: slug(o), name: o, hue: 'slate', icon: '', color: '' };
  const hue = hueOf(o, { strict });
  return {
    id: o.id ?? slug(o.name), name: o.name, hue,
    icon: iconValue(o.icon),
    color: HUE_HEX[hue],
  };
}
// Two families plus join — src/stats.js computes them; this literal is the
// contract every surface (vocabulary, field dialog, handbook) is gated on.
const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'join', 'median', 'stdev', 'distinct', 'filled', 'empty', 'range'];
const MAX_COMPUTE_DEPTH = 8;
/* A computed field that is already being computed for this row has looped
   back on itself. The depth guard above used to swallow that as null, which
   reads exactly like an empty cell and quietly fabricated a number one level
   up (Issue #283). A loop now answers with its own path instead. */
const CYCLE_PREFIX = '#CYCLE: ';
const isCycle = (v) => typeof v === 'string' && v.startsWith(CYCLE_PREFIX);
class CycleSignal extends Error {
  constructor(marker) { super(marker); this.marker = marker; }
}
// A formula scan reads this many rows at most: enough to catch a null on a
// third of the table, cheap enough to run on every keystroke.
const FORMULA_SCAN_CAP = 200;

/* The `field` type holds a field DEFINITION as its value — the schema of a
   field one level down the hierarchy. It is what terminates the meta-model's
   recursion: a space-level `Fields` table needs fields to describe fields, and
   the innermost descriptor is this ordinary primitive whose options come from
   the array below, which lives beneath the entity layer. Nothing is circular.

   `relation` and the computed types are NOT definable: their config names
   fields of a specific resolved table, which a down-hierarchy definition does
   not have yet. Refusing them at definition time is deliberate — the
   alternative is a definition that only fails when something tries to
   materialise it. */
export const DEFINABLE_TYPES = [
  'text', 'number', 'rating', 'date', 'daterange', 'checkbox', 'toggle', 'url', 'email',
  'select', 'multiselect', 'workflow', 'document', 'field', 'key', 'attachments',
];
const MAX_DEFINITION_DEPTH = 4;
/* Which type an existing field may become, with its values coerced in place
   (#migrateFieldType). Anything absent is refused — a move that would need
   to invent data (number -> workflow) is not a migration, it is a new field.
   Exported so the field tray offers exactly these and nothing the engine
   would then refuse. */
export const TYPE_MIGRATIONS = {
  text: ['number', 'key', 'url', 'email', 'select', 'multiselect', 'date', 'formula'],
  formula: ['text'],
  number: ['rating', 'text'],
  rating: ['number', 'text'],
  url: ['text'],
  email: ['text'],
  key: ['text'],
  date: ['text'],
  checkbox: ['toggle', 'text'],
  toggle: ['checkbox', 'text'],
  select: ['multiselect', 'workflow', 'text'],
  multiselect: ['select', 'text'],
  workflow: ['select'],
};

/* The ONTOLOGY: what weave models, on the axis the field types above are NOT.

   Its spine (Kyle, 2026-08-23): an ENTITY is the one core kind, and a
   workspace, a space, a table and a row inside a table are all entities. They
   differ by LEVEL, not by kind — each is addressable, each carries fields,
   each has a dedicated entity view. What a row is called downstream is a
   naming convention: record, item, entry, customer, company, account, task,
   deal, endlessly, exactly as in Airtable. None of those names is a kind.
   The engine already works this way — creating a space writes a row in
   `Workspace/Spaces`, a table writes one in `Workspace/Tables`, a field one
   in `Workspace/Fields`, through the same verbs a customer row answers to.

   A field is NOT an entity in this sense — it is a slot on a table — but it
   IS described by an entity of its own in the Fields registry, which is how
   the schema stays editable as data. And `text` is not a kind of thing weave
   stores at all: it is the datatype of one slot. Both axes are exported
   because agents discovering the model need to know what a Table is before
   what a `rollup` is; test/ontology.test.mjs holds this list, docs/ONTOLOGY.md
   and the engine to each other. */
export const ONTOLOGY = {
  core: {
    key: 'entity', name: 'Entity', definition:
      'One addressable thing: it has an id, a public id, a set of fields with values, and a dedicated entity view. Workspaces, spaces, tables and the rows inside tables are all entities; they differ by level, not by kind.',
    identity: 'uuid, plus a per-table public id addressed as Table#n',
    storedIn: 'state.entities',
    view: '/e/<id> — the entity view: its fields, its documents, its comments, its files, its activity',
    has: ['values', 'documents', 'comments', 'files', 'activity'],
    api: ['getEntity', 'findEntity', 'readEntity', 'entityName', 'query'],
  },

  /* The levels of the hierarchy. Every one of them is an entity. */
  levels: [
    {
      key: 'workspace', name: 'Workspace', isEntity: true, registry: 'Workspace/Workspaces', storedIn: 'state.meta',
      contains: 'spaces', identity: 'the .db file; a name and an optional logo',
      definition: 'One workspace file and everything in it. The top level of the hierarchy. The registry lives once, at the hub root (Feature #219): every workspace the hub serves is a row there, and its spaces, tables and fields relate back to it.',
      api: ['describeSchema', 'exportJSON', 'importJSON', 'setWorkspaceLogo'],
    },
    {
      key: 'space', name: 'Space', isEntity: true, registry: 'Workspace/Spaces', storedIn: 'state.spaces',
      contains: 'tables', identity: 'uuid; name unique in the workspace, and the left half of Space/Table',
      definition: 'A named container grouping the tables of one area of work. Its row in the Spaces registry is the same object seen as data.',
      api: ['createSpace', 'listSpaces', 'updateSpace', 'deleteSpace'],
    },
    {
      key: 'table', name: 'Table', isEntity: true, registry: 'Workspace/Tables', storedIn: 'state.tables',
      contains: 'rows', identity: 'uuid; qualified name Space/Table',
      definition: 'An entity that is also an entity TYPE: the ordered set of fields every row inside it follows.',
      api: ['createTable', 'listTables', 'updateTable', 'moveTable', 'duplicateTable', 'deleteTable', 'qualifiedName'],
    },
    {
      key: 'field', name: 'Field', isEntity: true, registry: 'Workspace/Fields', storedIn: 'table.fields',
      contains: 'nothing', identity: 'uuid; name unique within its table',
      definition: 'One typed, named slot on a table. A field is not itself a row of data, but it has a row in the Fields registry — carrying its type and its definition — so the schema is editable as data.',
      api: ['addField', 'addRelation', 'updateField', 'deleteField', 'materializeField'],
    },
    {
      key: 'row', name: 'Row', isEntity: true, registry: null, storedIn: 'state.entities',
      contains: 'its values, documents, comments, files and activity',
      identity: 'uuid; public id addressed as Table#n',
      definition: 'An entity inside a table, typed by that table. Called whatever the domain calls it — record, item, entry, customer, company, account — without changing what it is.',
      note: 'A row needs no registry: it IS the data, and the table it belongs to is its entity type.',
      api: ['createEntity', 'updateEntity', 'deleteEntity', 'restoreEntity', 'listEntities'],
    },
  ],

  /* What an entity is made of. These have no identity apart from the entity
     that carries them, and no entity view of their own. */
  constituents: [
    {
      key: 'value', name: 'Value', storedIn: 'entity.values',
      definition: 'What one entity holds in one field, validated and coerced by that field’s type.',
      identity: 'the entity plus the field',
      api: ['resolveField', 'updateEntity', 'link', 'unlink', 'setState'],
    },
    {
      key: 'document', name: 'Document', storedIn: 'entity.docs',
      definition: 'A long-form body — markdown, HTML or code — held in a document-typed field. An entity may carry any number.',
      identity: 'the entity plus the document field it fills',
      api: ['getDoc', 'setDoc', 'appendDoc', 'documentFields', 'descriptionField', 'listDocRevisions', 'getDocRevision', 'restoreDocRevision'],
    },
    {
      key: 'comment', name: 'Comment', storedIn: 'entity.comments',
      definition: 'An authored, time-ordered note on an entity, kept separate from its documents.',
      identity: 'uuid within its entity',
      api: ['addComment', 'deleteComment'],
    },
    {
      key: 'file', name: 'File', storedIn: 'entity.files',
      definition: 'A blob attached to an entity, stored beside the workspace file and referenced by id from attachments fields.',
      identity: 'uuid; the blob is files/<id> next to the workspace',
      api: ['attachFile', 'attachToField', 'readFile', 'deleteFile'],
    },
    {
      key: 'activity', name: 'Activity', storedIn: 'entity.activity',
      definition: 'An append-only record of one thing that happened to an entity — created, field-updated, state-changed, relation-updated, doc-updated, doc-appended, comment-added, file-attached, automation-ran, undo. A table carries the same kind of entry for its fields\' configuration (field-config-updated and undo, with the definition before and after; Issue #428), kept in the audit log rather than on an entity. Every entry carries seq, a monotonic per-workspace commit counter: seq is the order, ts is the display. An entity keeps its newest 500; entity.activityDropped counts the older ones it no longer holds.',
      identity: 'entityId:index',
      api: ['activityFeed', 'getActivity'],
    },
  ],

  /* Machinery around the entities: real objects with their own verbs, but not
     entities — nothing here has fields or an entity view. */
  apparatus: [
    {
      key: 'saved-view', name: 'Saved view', storedIn: 'state.meta.views',
      definition: 'A saved arrangement of one or more table blocks, each with its own filter and layout; optionally published read-only through a share token. Not to be confused with the entity view, which every entity has by existing.',
      identity: 'uuid; a share token when shared',
      api: ['createView', 'listViews', 'getView', 'deleteView', 'resolveView', 'shareView', 'unshareView'],
    },
    {
      key: 'automation', name: 'Automation', storedIn: 'state.entities',
      definition: 'A rule bound to one table, held as a row of Workspace/Workflows (Feature #249): its Script is the rule as JSON — the table, a trigger (entity-created, field-updated, state-changed) and the actions it fires (set-field, append-doc, add-comment, webhook) — and its On toggle is the user\'s switch. The engine computes State (Setup incomplete, Ready) and stamps Health and Last Run on every fire. seq is the row number: the rules on one trigger fire in that order.',
      identity: 'uuid',
      api: ['createAutomation', 'listAutomations', 'describeAutomations', 'updateAutomation', 'deleteAutomation'],
    },
    {
      key: 'account', name: 'Account', storedIn: 'state.meta.accounts',
      definition: 'A named token holder with a role — architect, editor, or observer (admin, writer and reader before 2026-10-02, rewritten on open). Only the token hash is kept. Browser sessions are kept beside it as sha256 hashes (Feature #222 part 2). A credentials[] array left on a row by the passkey door removed in Feature #243 is kept and ignored. Provider identities ({ issuer, subject }, no email) live on the row as identities[] (Feature #212, Feature #252); an identity is linked by redeeming a one-time invite kept as its sha256 in meta.identityInvites.',
      identity: 'uuid; name unique in the workspace',
      api: ['createAccount', 'listAccounts', 'deleteAccount', 'verifyToken', 'setRequireAuth', 'createSession', 'verifySession', 'listSessions', 'revokeSession', 'linkIdentity', 'inviteMember', 'listInvites', 'revokeInvite', 'identityInvite', 'redeemIdentityInvite', 'unlinkIdentity', 'accountForIdentity'],
    },
    {
      key: 'key', name: 'Credential', storedIn: 'keystore',
      definition: 'A named secret — API key, token, password, id or pair — held outside the workspace, encrypted in weave\'s keystore or in the manager that owns it. A key field stores the NAME; the value never enters the .db. Reading it back is a separate audited act gated by the credential\'s own access list, never by a permission on the field.',
      identity: 'its name',
      api: ['setKey', 'hasKey', 'listKeys', 'resolveKey', 'revealKey', 'grantKey', 'revokeKey', 'deleteKey'],
    },
    {
      key: 'audit', name: 'Audit entry', storedIn: 'store.audit_log',
      definition: 'A workspace-level record of a structural change: spaces, tables, fields, relations, saved views, accounts, keys, applied schemas.',
      identity: 'rowid in audit_log',
      api: ['listAudit'],
    },
    {
      key: 'undo', name: 'Undo step', storedIn: 'store.undo_log',
      definition: 'A reversible before-image of one entity mutation, newest first, replayed by undo().',
      identity: 'rowid in undo_log',
      api: ['undo', 'listUndo'],
    },
  ],

  /* Names people give rows. Endless, domain-specific, and ontologically
     empty — a customer is a row, an item is a row, an entry is a row. */
  aliases: ['record', 'item', 'entry', 'customer', 'company', 'account', 'task', 'deal', 'ticket', 'contact'],

  /* One alias collides with a kind, and the collision is real rather than a
     naming slip: an "account" row in a CRM table is a Row like any other,
     while the Account kind is a token holder with a role. Same word, two
     levels. Anything listed here must be disambiguated in the glossary. */
  collisions: [
    {
      alias: 'account', kind: 'account',
      note: 'An "account" row in a CRM table is a Row like any other; the Account kind here is a token holder with a role. Same word, two levels.',
    },
  ],
};

/* The number costume (#97) lives in public/number-core.js, so the field
   dialog's Sample dresses a figure exactly as the cell does. */
const { dressNumber } = globalThis.weaveNumberCore;

/* The date costume, mirrored in public/date-core.js and contract-tested
   against it. Format the stored wall-clock parts, never the local zone's
   reading of them — '2026-08-21' must never render as Aug 20. */
function dressDate(c, iso) { return DG.formatDate(iso, c); }

/* A formula's costume (Issue #576): a `grain` says the result is a date and
   takes the date costume, written whole even for the full grain, since the
   grain is the opt-in; without one a numeric result wears the number costume
   and anything else passes through as computed. The two never mix: `format`
   is a date style on one and a number format on the other. */
function formulaCostume(config) {
  if (config.grain == null) return normalizeSelfContainedConfig('number', config, { formula: true });
  const date = normalizeSelfContainedConfig('date', config);
  return { ...date, grain: date.grain ?? [...DG.PARTS] };
}

/* A range wears the same costume at both ends (Issue #91). The read side
   had no case for daterange at all, so `{ start, end }` walked to the
   browser and painted itself as '[object Object]'. A long range inside one
   year says the year once — 'Aug 1 – Sep 15, 2026' — which only reads well
   without a time of day, so the collapse stops there. */
function dressDateRange(c, value) { return DG.formatDateRange(value, c); }

/* The single normaliser for every type whose config is self-contained. Used
   by addField AND by `field` value validation, so a definition can never
   describe a field the engine would refuse to create. */
function normalizeSelfContainedConfig(type, config = {}, { formula = false, strict = false } = {}) {
  if (type === 'select' || type === 'multiselect') {
    return { options: (config.options ?? []).map((o) => normaliseOption(o, { strict })) };
  }
  if (type === 'workflow') {
    // No `states` key at all means "give me a lifecycle" and gets the default
    // four; an empty array means someone emptied the list, and that is still
    // invalid. Seeding here rather than relaxing the throw keeps both true.
    const states = (config.states ?? DEFAULT_WORKFLOW_STATES).map((s) => (typeof s === 'string'
      ? { id: slug(s), name: s, category: 'in-progress', default: false }
      : { id: s.id ?? slug(s.name), name: s.name, category: RETIRED_STATE_CATEGORIES[s.category] ?? s.category ?? 'in-progress', default: !!s.default, ...(iconValue(s.icon) ? { icon: iconValue(s.icon) } : {}) }));
    if (states.length === 0) throw new WeaveError('Workflow field needs at least one state', 'invalid');
    // The list's order is the order everywhere. A default is only ever the
    // one the author marked, and at most one (Issue #421): the first state
    // used to be marked for them, so no row could start without a status.
    let marked = false;
    for (const s of states) { if (s.default && marked) s.default = false; marked ||= s.default; }
    for (const s of states) {
      if (!STATE_CATEGORIES.includes(s.category)) {
        throw new WeaveError(`Invalid state category '${s.category}' (use ${STATE_CATEGORIES.join(', ')})`, 'invalid');
      }
    }
    return { states };
  }
  if (type === 'number') {
    const out = {};
    if (config.format != null) {
      if (!['number', 'currency', 'percent', 'compact'].includes(config.format)) {
        throw new WeaveError(`Invalid number format '${config.format}' (number, currency, percent, compact)`, 'invalid');
      }
      if (config.format !== 'number') out.format = config.format;
    }
    // `unit` is free text ('days', 'feet'); `currency` is an ISO code. A
    // legacy currency field that carried its code in `unit` moves it over.
    let unit = config.unit != null && String(config.unit).trim() ? String(config.unit).trim() : null;
    let currency = config.currency != null && String(config.currency).trim() ? String(config.currency).trim().toUpperCase() : null;
    if (out.format === 'currency' && !currency && unit && /^[A-Za-z]{3}$/.test(unit)) { currency = unit.toUpperCase(); unit = null; }
    if (currency) {
      try { new Intl.NumberFormat('en-US', { style: 'currency', currency }); } catch { throw new WeaveError(`'${currency}' is not a currency code (use ISO 4217: USD, EUR, GBP…)`, 'invalid'); }
      out.currency = currency;
    }
    if (unit) out.unit = unit;
    if (config.decimals != null) {
      if (!Number.isInteger(config.decimals) || config.decimals < 0 || config.decimals > 6) {
        throw new WeaveError(`Decimals must be 0..6, got '${config.decimals}'`, 'invalid');
      }
      out.decimals = config.decimals;
    }
    if (config.separator != null) out.separator = !!config.separator;
    if (out.format === 'compact' && out.separator) throw new WeaveError('Compact groups on its own; a separator has nothing to add', 'invalid');
    // Parenthesised negatives are a currency convention and need one.
    if (config.accounting) {
      if (out.format !== 'currency') throw new WeaveError('Accounting negatives need format currency', 'invalid');
      out.accounting = true;
    }
    // The display (Feature #230): text is the default and is not written
    // down; a scale only means something to a graphic, so text drops it.
    if (config.display === 'sparkline') {
      if (!formula) throw new WeaveError('A sparkline draws a list: only a formula can wear it', 'invalid');
      out.display = 'sparkline';
      if (config.style != null && !SPARKLINE_STYLES.includes(config.style)) {
        throw new WeaveError(`Invalid sparkline style '${config.style}' (${SPARKLINE_STYLES.join(', ')})`, 'invalid');
      }
      if (config.style != null && config.style !== 'line') out.style = config.style;
    } else if (config.display != null) {
      if (!NUMBER_DISPLAYS.includes(config.display)) {
        throw new WeaveError(`Invalid number display '${config.display}' (${NUMBER_DISPLAYS.join(', ')})`, 'invalid');
      }
      if (config.display !== 'text') out.display = config.display;
    }
    // The colour (Feature #235): written down only when it is not ink.
    if (cellColorValue(config.color) !== 'ink') out.color = config.color;
    if (isGraphicDisplay(out.display) && config.scale != null && config.scale !== 'column') {
      const scale = config.scale;
      if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
        throw new WeaveError("Scale is 'column' or a number above 0", 'invalid');
      }
      out.scale = scale;
    }
    return out;
  }
  if (type === 'date' || type === 'daterange') {
    /* Grain (what the field stores) and costume (how it prints) — the rules
       live in public/date-grain.js so the browser applies the same ones. A
       style that needs a part the grain never stores is refused here, at
       definition time, never rendered as a guess. */
    const out = {};
    let grain;
    try { grain = DG.normalizeGrain(config.grain); } catch (e) { throw new WeaveError(e.message, 'invalid'); }
    if (grain) out.grain = grain;
    const time = !!config.time;
    if (time) out.time = true;
    const parts = grain ?? DG.PARTS;
    if (!parts.length && !time) throw new WeaveError('A grain with no date parts must keep a time of day', 'invalid');
    if (config.format != null) {
      const problem = DG.formatProblem(parts, config.format);
      if (problem) throw new WeaveError(problem, 'invalid');
      if (config.format !== DG.DEFAULT_FORMAT) out.format = config.format;
    }
    if (config.clock != null) {
      if (!DG.CLOCKS.includes(config.clock)) throw new WeaveError(`Invalid clock '${config.clock}' (${DG.CLOCKS.join(', ')})`, 'invalid');
      if (!time) throw new WeaveError('A clock needs a time of day', 'invalid');
      if (config.clock !== DG.DEFAULT_CLOCK) out.clock = config.clock;
    }
    if (config.zone != null) {
      if (!DG.ZONES.includes(config.zone)) throw new WeaveError(`Invalid zone '${config.zone}' (${DG.ZONES.join(', ')})`, 'invalid');
      if (!time) throw new WeaveError('A zone needs a time of day', 'invalid');
      if (config.zone === 'fixed') {
        if (!config.zoneName) throw new WeaveError('A fixed zone needs a zoneName (an IANA name: America/Los_Angeles, Europe/Berlin…)', 'invalid');
        if (!DG.isZone(config.zoneName)) throw new WeaveError(`'${config.zoneName}' is not a time zone`, 'invalid');
        out.zoneName = String(config.zoneName);
      }
      if (config.zone !== 'floating') out.zone = config.zone;
    }
    if (config.pad) out.pad = true;
    if (config.elapsed) {
      if (type !== 'daterange') throw new WeaveError('elapsed belongs to a range', 'invalid');
      if (!time) throw new WeaveError('elapsed needs a time of day at both ends', 'invalid');
      out.elapsed = true;
    }
    return out;
  }
  if (type === 'field') {
    const depth = config.depth ?? 1;
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEFINITION_DEPTH) {
      throw new WeaveError(`Definition depth must be 1..${MAX_DEFINITION_DEPTH}, got '${depth}'`, 'invalid');
    }
    return { types: [...DEFINABLE_TYPES], depth };
  }
  /* Credentials: which sort, and whose store (Feature #143). Both are closed
     sets with defaults, so every key field ever created — including the ones
     that predate this config and carry `{}` — reads as an apikey in the local
     keystore, which is exactly what #64 meant by a key. */
  if (type === 'key') {
    const kind = config.kind ?? 'apikey';
    if (!CREDENTIAL_KINDS.includes(kind)) {
      throw new WeaveError(`Invalid credential kind '${kind}' (${CREDENTIAL_KINDS.join(', ')})`, 'invalid');
    }
    const keystore = config.keystore ?? 'local';
    if (!KEYSTORES.includes(keystore)) {
      throw new WeaveError(`Invalid keystore '${keystore}' (${KEYSTORES.join(', ')})`, 'invalid');
    }
    const out = { kind, keystore };
    if (kind === 'pair') {
      const parts = config.parts?.length ? config.parts : DEFAULT_PAIR_PARTS;
      if (parts.length !== 2) {
        throw new WeaveError(`A pair names exactly two parts, got ${parts.length}`, 'invalid');
      }
      out.parts = parts.map((p) => {
        const name = typeof p === 'string' ? p : p.name;
        if (!name) throw new WeaveError('Every part of a pair needs a name', 'invalid');
        return { name: String(name), secret: typeof p === 'string' ? false : !!p.secret };
      });
    } else if (config.parts != null) {
      throw new WeaveError(`Only a 'pair' credential names parts; '${kind}' holds one value`, 'invalid');
    }
    return out;
  }
  /* A rating (Feature #231): both keys written down, like a toggle's
     labels, so a reader of the config sees the scale and the icon. */
  if (type === 'rating') {
    const max = config.max ?? RATING_DEFAULTS.max;
    if (!Number.isInteger(max) || max < 1 || max > RATING_MAX) {
      throw new WeaveError(`A rating's max is a whole number from 1 to ${RATING_MAX}, got '${config.max}'`, 'invalid');
    }
    const color = cellColorValue(config.color);
    return { max, icon: iconValue(config.icon ?? RATING_DEFAULTS.icon) || RATING_DEFAULTS.icon, ...(color !== 'ink' ? { color } : {}) };
  }
  /* A toggle names its two states (Feature #202). Both labels are kept
     even at their defaults so a reader of the config sees the words the
     switch wears; two identical labels would be a switch with no meaning. */
  if (type === 'toggle') {
    const label = (key, fallback) => {
      if (config[key] == null) return fallback;
      const v = String(config[key]).trim();
      if (!v) throw new WeaveError(`A toggle's ${key} label cannot be blank`, 'invalid');
      return v;
    };
    const on = label('on', 'On');
    const off = label('off', 'Off');
    if (on.toLowerCase() === off.toLowerCase()) throw new WeaveError(`A toggle needs two different labels, got '${on}' for both`, 'invalid');
    return { on, off };
  }
  // Files: one or many (Kyle, 2026-08-23 — files are not documents).
  if (type === 'attachments') return { multiple: config.multiple == null ? true : !!config.multiple };
  // Text: literal paints the characters — a column of syntax, a regex, a
  // glob — instead of dressing inline markdown (Issue #86). Off is unmarked.
  if (type === 'text') return config.literal ? { literal: true } : {};
  // Documents: what kind of document. markdown is the unmarked default.
  if (type === 'document') {
    if (config.kind != null && config.kind !== 'markdown') {
      if (!DOCUMENT_KINDS.includes(config.kind)) throw new WeaveError(`Invalid document kind '${config.kind}' (${DOCUMENT_KINDS.join(', ')})`, 'invalid');
      return { kind: config.kind };
    }
    return {};
  }
  return {};
}

/* Validate one field definition — the value of a `field`-typed field.
   `depth` is how many further levels this definition is allowed to define;
   at depth 1 it must describe a leaf, so it may not itself be a `field`. */
function normalizeDefinition(raw, depth, { strict = false } = {}) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WeaveError('A field definition must be an object of { type, config }', 'invalid');
  }
  const { type } = raw;
  if (!DEFINABLE_TYPES.includes(type)) {
    throw new WeaveError(`'${type}' is not a definable field type (use ${DEFINABLE_TYPES.join(', ')})`, 'invalid');
  }
  if (type === 'field' && depth < 2) {
    throw new WeaveError(
      'A definition at depth 1 must describe a leaf field; raise the field\'s depth to nest one', 'invalid');
  }
  const config = normalizeSelfContainedConfig(type, raw.config ?? {}, { strict });
  if (type === 'field' && config.depth > depth - 1) {
    throw new WeaveError(
      `A nested definition may declare depth ${depth - 1} at most, got ${config.depth}`, 'invalid');
  }
  return { type, config };
}
/* The text the Tables registry row shows for a table's filter and sort —
   `State: Open, Doing; Priority: High` and `Due desc, Name asc`. Round-trip
   partners: #syncTableRow formats, #interceptUpdate parses, and updateTable
   validates whatever the parse produced, so a malformed row edit fails the
   same way a malformed API call does. */
const formatFilters = (filters) =>
  Object.entries(filters ?? {}).map(([f, states]) => `${f}: ${states.join(', ')}`).join('; ');
const parseFilters = (text) => {
  const out = {};
  for (const part of String(text ?? '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i < 0) throw new WeaveError(`A filter is 'Field: State, State' — got '${part}'`, 'invalid');
    out[part.slice(0, i).trim()] = part.slice(i + 1).split(',').map((x) => x.trim()).filter(Boolean);
  }
  return out;
};
const formatSort = (sort) => (sort ?? []).map((s) => `${s.field} ${s.dir}`).join(', ');
/* A Sort cell reads 'Date desc, Name'. Agents also write '-Date' and the
   [{field, dir}] list weave_query takes, as JSON text or a list (Issue #626):
   both land, and anything else is refused with the one spelling. */
const SORT_FORM = "Sort reads 'Field asc|desc, Field2 asc|desc'";
const parseSortPart = (part) => {
  if (part && typeof part === 'object' && !Array.isArray(part)) {
    const field = String(part.field ?? part.name ?? '').trim();
    const dir = String(part.dir ?? part.direction ?? 'asc').trim().toLowerCase();
    if (!field || !['asc', 'desc'].includes(dir)) throw new WeaveError(`${SORT_FORM}; got ${JSON.stringify(part)}`, 'invalid');
    return { field, dir };
  }
  const s = String(part ?? '').trim();
  const m = s.match(/^(.+)\s+(asc|desc)$/i);
  if (m) return { field: m[1].trim(), dir: m[2].toLowerCase() };
  if (/^[-+]\S/.test(s)) return { field: s.slice(1).trim(), dir: s[0] === '-' ? 'desc' : 'asc' };
  return { field: s, dir: 'asc' };
};
const parseSort = (value) => {
  let v = value;
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
    try { v = JSON.parse(v); } catch { throw new WeaveError(`${SORT_FORM}, e.g. 'Date desc'; got '${v}'`, 'invalid'); }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) v = [v];
  const parts = Array.isArray(v) ? v : String(v ?? '').split(',');
  return parts.filter((x) => typeof x !== 'string' || x.trim()).map(parseSortPart);
};

// Narrower than this and a column can hold neither a chip nor a resize grip.
const MIN_COLUMN_WIDTH = 60;
/* A view's column widths (Feature #233). The grid never paints a header
   under its own label, so the engine only refuses nonsense: the mockup's
   checkbox default (56) is under the legacy field floor above. */
const VIEW_MIN_WIDTH = 40;
const VIEW_MAX_WIDTH = 4000;
/* A view's row density (Feature #239): the row height its grid is drawn at,
   32, 44 or 72px. Comfortable is the default and is never stored. */
const VIEW_DENSITIES = ['compact', 'comfortable', 'spacious'];
const formatWidths = (widths) => Object.entries(widths ?? {}).map(([n, px]) => `${n} ${px}`).join(', ');
function parseWidths(text) {
  const out = {};
  for (const part of String(text ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(.+?)\s+(\S+)$/);
    const px = m ? Number(m[2]) : NaN;
    if (!m || !Number.isFinite(px)) throw new WeaveError(`Widths reads 'Name 240, Due 112' — a field name, a space, its width in pixels; got '${part}'`, 'invalid');
    out[m[1]] = px;
  }
  return out;
}

/* A field's description (Issue #209) is plain text, trimmed; blank means
   none. Anything but a string is refused rather than stringified. */
function fieldDescriptionValue(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'string') throw new WeaveError('A field description is plain text', 'invalid');
  return raw.trim();
}

// The documented keys of a createEntity input. Everything else in the object
// is treated as a field value, so a flat create behaves like a flat update.
const CREATE_INPUT_KEYS = new Set(['values', 'name', 'doc', 'docs']);

// What bulk() can do to a selection (Feature #132, slice 3).
const BULK_OPS = ['set', 'link', 'move', 'rollup'];

export { WeaveError };

function nowISO() {
  return new Date().toISOString();
}

/* What "the schema" means for Weave#schemaVersion() below: the structural
   rows, minus the two write counters. `publicIdCounter` lives on the table row
   and ticks on every row insert; `activitySeq` lives on meta and ticks on every
   activity entry (Issue #282). Neither is a schema change, and leaving either
   in would cost every open tab a schema refetch every time anyone touched a
   row anywhere.
   The hash is FNV-1a over the canonical JSON, paired with its length in hex: a
   collision would cost one missed refresh, which is the bug this fixes, so
   it never needs to be cryptographic. */
function schemaFingerprint(state) {
  const { spaces = {}, tables = {}, automations = {}, entities, ...meta } = state ?? {};
  const drop = (key, value) => (key === 'publicIdCounter' || key === 'activitySeq' ? undefined : value);
  const parts = [JSON.stringify(meta, drop)];
  for (const collection of [spaces, tables, automations]) {
    for (const id of Object.keys(collection).sort()) parts.push(id, JSON.stringify(collection[id], drop));
  }
  const text = parts.join('\u0000');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(16)}${h.toString(16).padStart(8, '0')}`;
}

/* A template space's schema as a document to apply elsewhere (Feature #261).
   Takes one entry of describeSchema() and hands back that space under a new
   name, ready for applySchema(..., { partial: true }) on another workspace:
   every `Space/Table` the descriptor spells is rewritten to the new name; the
   ids, urls and counts that belong to the source go; and the copy is never a
   template itself. A relation that leaves the space cannot follow it, so it
   is removed and named in `skipped`, with every lookup, rollup and formula
   that reads through it and every view, sort and filter that names it.
   `rollups` are the source's Workspace/Spaces rollups over this space's
   tables (they live on the registry row, not in the space's entry); they
   come back renamed the same way. Pure: the source document is not touched. */
export function templateDoc(spaceDoc, { name, rollups = [] } = {}) {
  if (!spaceDoc || typeof spaceDoc.space !== 'string' || !Array.isArray(spaceDoc.tables)) {
    throw new WeaveError('templateDoc takes one space entry of describeSchema()', 'invalid');
  }
  if (spaceDoc.system) throw new WeaveError(`Space '${spaceDoc.space}' is the workspace's own system space and cannot be a template`, 'invalid');
  const from = spaceDoc.space;
  const to = String(name ?? from).trim();
  if (!to) throw new WeaveError('A template copy needs a name', 'invalid');
  const prefix = `${from}/`;
  const inside = new Set(spaceDoc.tables.map((t) => prefix + t.name));
  const move = (q) => (typeof q === 'string' && q.startsWith(prefix) ? `${to}/${q.slice(prefix.length)}` : q);
  const without = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
  const src = structuredClone(spaceDoc);
  const skipped = [];
  const gone = new Map(src.tables.map((t) => [t.name, new Set()]));
  const tableOf = (q) => (inside.has(q) ? src.tables.find((t) => prefix + t.name === q) : null);
  const drop = (t, f, why) => { gone.get(t.name).add(f.name); skipped.push({ table: t.name, field: f.name, ...why }); };
  for (const t of src.tables) {
    for (const f of t.fields ?? []) {
      if (f.type !== 'relation') continue;
      const targets = Array.isArray(f.targetDbs) ? f.targetDbs : [f.targetDb];
      if (targets.some((q) => !inside.has(q))) drop(t, f, { targetDb: f.targetDbs ?? f.targetDb });
    }
  }
  // What reads through a removed field goes with it, to a fixed point: a
  // lookup over a lookup, a formula over either.
  for (let moved = true; moved;) {
    moved = false;
    for (const t of src.tables) {
      const out = gone.get(t.name);
      for (const f of t.fields ?? []) {
        if (out.has(f.name) || f.role === 'name') continue;
        let why = null;
        if ((f.type === 'lookup' || f.type === 'rollup') && f.via != null) {
          const rel = (t.fields ?? []).find((x) => x.name === f.via);
          const far = rel ? tableOf(rel.targetDb) : null;
          if (out.has(f.via)) why = { via: f.via };
          else if (far && f.targetField != null && gone.get(far.name).has(f.targetField)) why = { via: f.via, targetField: f.targetField };
        } else if (f.type === 'formula' && f.expression) {
          let refs = [];
          try { refs = formulaReferences(f.expression); } catch { refs = []; }
          const hit = refs.find((n) => out.has(n));
          if (hit) why = { reads: hit };
        }
        if (why) { drop(t, f, why); moved = true; }
      }
    }
  }
  const scrub = (out, list) => (list ?? []).filter((n) => !out.has(n));
  const scrubKeys = (out, obj) => (obj ? Object.fromEntries(Object.entries(obj).filter(([k]) => !out.has(k))) : obj);
  const doc = {
    ...without(src, ['spaceId', 'url', 'template', 'tables', 'id']),
    space: to,
    tables: src.tables.map((t) => {
      const out = gone.get(t.name);
      const table = without(t, ['id', 'url', 'entityCount']);
      if (table.qualified != null) table.qualified = move(table.qualified);
      table.fields = (t.fields ?? []).filter((f) => !out.has(f.name)).map((f) => {
        const field = without(f, ['id', 'targetDbId', 'targetDbIds', 'inverseFieldId', 'viaTableId']);
        if (field.targetDb != null) field.targetDb = move(field.targetDb);
        if (Array.isArray(field.targetDbs)) field.targetDbs = field.targetDbs.map(move);
        if (field.viaTable != null) field.viaTable = move(field.viaTable);
        if (Array.isArray(field.optionsFull)) field.optionsFull = field.optionsFull.map((o) => without(o, ['id']));
        if (Array.isArray(field.states)) field.states = field.states.map((st) => without(st, ['id']));
        if (field.type === 'view' && Array.isArray(field.fields)) field.fields = scrub(out, field.fields);
        return field;
      });
      if (!out.size) {
        if (Array.isArray(table.views)) table.views = table.views.map((v) => without(v, ['id']));
        return table;
      }
      if (table.hiddenFields) table.hiddenFields = scrub(out, table.hiddenFields);
      if (table.filters) table.filters = scrubKeys(out, table.filters);
      if (table.sort) table.sort = table.sort.filter((x) => !out.has(x.field));
      if (table.bodyBlocks) table.bodyBlocks = scrub(out, table.bodyBlocks);
      if (Array.isArray(table.views)) {
        table.views = table.views.map((v) => {
          const view = without(v, ['id']);
          if (view.fields) view.fields = scrub(out, view.fields);
          if (view.filters) view.filters = scrubKeys(out, view.filters);
          if (view.sort) view.sort = view.sort.filter((x) => !out.has(x.field));
          if (view.widths) view.widths = scrubKeys(out, view.widths);
          return view;
        });
      }
      return table;
    }),
  };
  const kept = [];
  for (const r of rollups ?? []) {
    const far = tableOf(r.viaTable);
    if (!far) { skipped.push({ table: 'Workspace/Spaces', field: r.name, viaTable: r.viaTable }); continue; }
    if (r.targetField != null && gone.get(far.name).has(r.targetField)) { skipped.push({ table: 'Workspace/Spaces', field: r.name, viaTable: r.viaTable, targetField: r.targetField }); continue; }
    const out = without(r, ['id', 'viaTableId']);
    out.viaTable = move(r.viaTable);
    kept.push(out);
  }
  return { doc, rollups: kept, skipped };
}

/* Deferred migrations (Feature #250). The supervisor starts a new release's
   worker beside the one still serving, against the same .db files. Opening a
   workspace migrates it (#migrate, the registry tables, the boot syncs), and
   the old build must never read a shape it does not know, so in that worker
   every save is held: the open-time repairs live in memory only. Once the old
   worker has exited, runDeferredMigrations() settles each workspace opened
   meanwhile: re-read it when someone else wrote to it since, and migrate
   that; otherwise write what was held. The supervisor sends the new worker
   reads only until then, so nothing a client sends is held. The store's own
   CREATE TABLE IF NOT EXISTS still runs at open: it only adds tables, and an
   old build never reads one it does not know. */
let HELD = null;
export function deferMigrations() { HELD ??= new Set(); }
export function runDeferredMigrations() {
  const held = HELD;
  HELD = null;
  for (const w of held ?? []) {
    try { w.settleDeferred(); } catch (err) { console.warn(`weave: deferred migration of ${w.store.path} failed: ${err.message}`); }
  }
}

// The one-time sign-in link an invite or identity link hands over (Issue #569).
export const inviteUrl = (origin, code) => `${origin}/api/auth/oidc/start?invite=${encodeURIComponent(code)}`;

export class Weave {
  // Entity ids mutated since the last save — the store flushes only these
  // rows. An id missing from state at save time means "delete the row".
  #dirty = new Set();
  #dirtyAll = false;
  #held = false; // a save happened while migrations were deferred

  // Memo for schemaVersion(): cleared by every save and every reload, so it
  // is recomputed at most once per write and only when someone asks.
  #schemaVersion = null;
  /* Column scales for graphic numbers (Feature #230), `${tableId}:${fieldId}`
     → the column max. Every write and every reload drops the lot: a max is
     one pass over the column, and a grid page, a chip and a card all ask. */
  #scales = new Map();

  // The computed fields currently resolving, innermost last — see #resolve.
  #computing = [];

  // `store` injects an alternate Store implementation (same interface) — the
  // Cloudflare Worker port (Feature #84) passes a Durable Object-backed one.
  // `name` seeds a FRESH workspace only, for a caller that knows the address
  // (the Worker's route, `weave serve` checking the names on the instance);
  // without it a file someone named names the workspace, and otherwise the
  // seed is personal-workspace (Issue #594).
  constructor({ path = null, actor = 'local', keystorePath = null, store = null, keystoreEnv = null, revisionWindowMs = DOC_REVISION_WINDOW_MS, name = null } = {}) {
    this.actor = actor;
    // Writes by one actor to one document inside this window are one
    // revision (Feature #225); a test sets 0 to make every write its own.
    this.revisionWindowMs = revisionWindowMs;
    this.keystorePath = keystorePath ?? process.env.WEAVE_KEYSTORE ?? join(process.env.HOME ?? '.', '.weave', 'keystore.json');
    // Injected so a test can hold a passphrase without touching the process.
    this.keystoreEnv = keystoreEnv ?? process.env;
    this.store = store ?? new Store(path);
    const loaded = this.store.load();
    // A pre-existing file must actually be a workspace — never adopt (and
    // never migrate-write!) arbitrary JSON like a package.json.
    if (loaded && (!loaded.meta || (loaded.tables == null && loaded.databases == null))) {
      throw new WeaveError(`'${path}' is not a Weave workspace file`, 'invalid');
    }
    this.state = loaded ?? {
      version: 2,
      meta: { name: name ?? nameFromFile(path) ?? workspaceName().slug, createdAt: nowISO() },
      spaces: {},
      tables: {},
      entities: {},
      automations: {},
    };
    this.#migrate();
    // A hub member (Feature #219) keeps no registry of its own: the rows
    // live at the root it joins, and the flag holds while it is opened alone.
    if (this.state.meta.registry !== 'hub') this.#ensureMetaTables();
    // Opening a JSON dump as a workspace is an import by another name: the
    // .json migration writes state straight through the store, blobs and
    // all. Land them the same way importJSON does (Issue #121).
    if (this.#landBlobs()) this.save();
    // Only a workspace that opened is settled later (a file the hub's scan
    // refuses throws above and is never seen again).
    HELD?.add(this);
  }

  // Upgrade v1 workspaces in place: `databases` state key → `tables`, and the
  // single entity-level `doc` → a Description document field per table.
  #migrate() {
    const s = this.state;
    // The universal reference rule (Kyle, 2026-08-24): every entity — the
    // workspace included — is referenced by a unique id; names are display
    // labels. Minted once here, kept through export/import and every rename.
    if (!s.meta.id) { s.meta.id = uuid(); if (this.store.path) this.save(); }
    if (s.databases && !s.tables) {
      s.tables = s.databases;
      delete s.databases;
    }
    s.tables = s.tables ?? {};
    let changed = false;
    for (const db of Object.values(s.tables)) {
      // Every surface that lists columns — the grid, describeSchema() and so
      // GET /api/schema, the CSV export, the phone applet — walks fieldOrder,
      // never db.fields. A field the order forgets is present and invisible,
      // which is how a plain number column went missing across
      // export → import (Issue #110). Reconcile on every open and every
      // import, registry tables included: they list columns too.
      if (this.#reconcileFieldOrder(db)) changed = true;
      // System registry tables (Feature #12) carry a TEXT Description that
      // syncs with the real space/table description — backfilling a document
      // field here would give them a second, colliding 'Description'.
      if (!db.system) {
        if (this.#ensureDescriptionField(db)) changed = true;
        if (this.#ensureTerm(db)) changed = true;
        if (this.#ensureViewFields(db)) changed = true;
      }
      if (this.#ensureTableViews(db)) changed = true;
      if (this.#ensureSystemColumnsInViews(db)) changed = true;
      if (this.#ensureStandardViewName(db)) changed = true;
    }
    for (const e of Object.values(s.entities ?? {})) {
      if (e.docs) continue;
      e.docs = {};
      if (e.doc) {
        const db = s.tables[e.dbId];
        const docField = this.descriptionField(db);
        if (docField) e.docs[docField.id] = e.doc;
      }
      delete e.doc;
      this.#mark(e);
      changed = true;
    }
    if (s.version !== 2) {
      s.version = 2;
      changed = true;
    }
    /* Percent semantics flipped to the spreadsheet convention (Issue #127):
       the stored value is now the fraction and the display is ×100. Values
       written under the old rule (stored 32.5, shown "32.5%") divide once so
       every existing cell keeps reading exactly as it did. The flag on meta
       makes this a one-time pass, not a per-load rescale. */
    if (!s.meta.percentFractional) {
      for (const db of Object.values(s.tables)) {
        for (const f of Object.values(db.fields ?? {})) {
          if (f.type !== 'number' || f.config?.format !== 'percent') continue;
          for (const e of Object.values(s.entities ?? {})) {
            if (e.dbId !== db.id) continue;
            const v = e.values?.[f.id];
            if (typeof v === 'number' && Number.isFinite(v)) {
              e.values[f.id] = v / 100;
              this.#mark(e);
            }
          }
        }
      }
      s.meta.percentFractional = true;
      changed = true;
    }
    /* Activity gained `seq`, a commit counter, because a wall-clock `ts`
       cannot separate two writes in one millisecond (Issue #282). Every open
       numbers whatever it finds unnumbered, continuing from the counter, and
       never touches a number already handed out. That covers both cases: a
       workspace written before seq existed, where nothing is numbered, and a
       single straggler, which is what a CLI or a second server still running
       pre-seq code leaves behind when it appends through the shared .db.
       An entity's stored order always wins: the key each stream sorts on only
       ever rises, so a clock that stepped backwards cannot lift an entry above
       the one it was appended after. */
    if (s.meta.activitySeq == null) { s.meta.activitySeq = 0; changed = true; }
    {
      const pending = [];
      const touched = new Set();
      for (const e of Object.values(s.entities ?? {})) {
        let high = '';
        (e.activity ?? []).forEach((a, i) => {
          const ts = String(a.ts ?? '');
          if (ts > high) high = ts;
          if (a.seq == null) { pending.push({ e, a, i, key: high }); touched.add(e); }
        });
      }
      if (pending.length) {
        pending.sort((x, y) => (x.key === y.key
          ? (x.e.id === y.e.id ? x.i - y.i : (x.e.id < y.e.id ? -1 : 1))
          : (x.key < y.key ? -1 : 1)));
        let n = s.meta.activitySeq;
        for (const row of pending) row.a.seq = ++n;
        for (const e of touched) this.#mark(e);
        s.meta.activitySeq = n;
        changed = true;
      }
    }
    /* Automations gained `seq` for the same reason (Issue #285): the rules on
       one trigger fired in whatever order the store read them back, which was
       never stored. Numbering follows the order they load in, rowid order,
       which is the order they fired in before seq existed, so no workspace
       changes behaviour on this open. As above, anything unnumbered is
       numbered and a number already handed out never moves; the counter first
       catches up with the highest number present, so a dump that lost its
       counter cannot reissue one. */
    {
      const autos = Object.values(s.automations ?? {});
      const high = Math.max(s.meta.automationSeq ?? 0, ...autos.map((a) => a.seq ?? 0));
      if (s.meta.automationSeq !== high) { s.meta.automationSeq = high; changed = true; }
      for (const auto of autos) {
        if (auto.seq != null) continue;
        auto.seq = ++s.meta.automationSeq;
        changed = true;
      }
    }
    // admin / writer / reader became architect / editor / observer
    // (2026-10-02). The token hash is untouched, so every wv_ token and
    // session keeps opening the account it opened. No flag: an older weave
    // sharing the .db can still write an old name, so every open looks.
    for (const a of Object.values(s.meta.accounts ?? {})) {
      const role = Weave.roleName(a.role);
      if (role !== a.role) { a.role = role; changed = true; }
    }
    if (this.#scrubIdentityEmails()) changed = true;
    /* Every entity this pass changes is marked, and the structural rows are
       compared on every save, so a plain save writes exactly the migration.
       It used to force a rewrite of every row and search entry, which cost a
       ten-second stall when a supervised worker settled on a slow volume
       (Feature #250, 2026-10-03). */
    if (changed) this.save();
  }

  /* The field order names every field exactly once — updateTable refuses
     anything else, so this only ever repairs state that arrived from outside:
     an import, a legacy file, a hand-edited dump. Forgotten fields come back
     on the end (visible beats lost); an id naming no field goes. Returns
     whether the table changed. */
  #reconcileFieldOrder(db) {
    const fields = db.fields ?? {};
    const seen = new Set();
    const order = [];
    for (const id of db.fieldOrder ?? []) {
      if (!fields[id] || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    for (const id of Object.keys(fields)) if (!seen.has(id)) order.push(id);
    const was = db.fieldOrder ?? [];
    if (order.length === was.length && order.every((id, i) => id === was[i])) return false;
    db.fieldOrder = order;
    return true;
  }

  /* The one place a table's description role is settled, so the three states
     never get read three ways. Returns whether the table changed.

       null       the owner deleted it — leave the table without one
       a live id  nothing to do
       undefined  the table predates the role: adopt the document field that
                  WAS the default (first in field order — the old positional
                  rule, so no existing workspace changes shape on first open),
                  or mint one when the table has no document at all. */
  #ensureDescriptionField(db) {
    if (db.descriptionFieldId === null) return false;
    if (db.descriptionFieldId && db.fields[db.descriptionFieldId]?.type === 'document') return false;
    const adopted = this.documentFields(db)[0];
    if (adopted) {
      db.descriptionFieldId = adopted.id;
      return true;
    }
    const docField = { id: uuid(), name: 'Description', type: 'document', config: {} };
    db.fields[docField.id] = docField;
    placeField(db, docField.id);
    db.descriptionFieldId = docField.id;
    return true;
  }

  /* What one row is called (Feature #40; Name-field config since 2026-09-02).
     Legacy workspaces carried it as `db.noun`; the first open moves it onto
     the Name field's config and drops the table key, so there is one source. */
  #ensureTerm(db) {
    if (db.noun == null) return false;
    const nameField = db.fields[db.nameFieldId];
    if (nameField && !nameField.config.term && String(db.noun).trim()) {
      try { nameField.config.term = Term.normalize({ singular: db.noun }); } catch { /* an unusable legacy noun is dropped */ }
    }
    delete db.noun;
    return true;
  }

  /* Chip and Card, settled in one place (Kyle, 2026-09-04). A table that
     predates the roles — or lost a pointer somehow — gets a fresh view field
     minted and hidden; a live pointer is left alone. Returns whether the
     table changed. Registry tables are structure, not rows: no views. */
  #ensureViewFields(db) {
    if (db.system) return false;
    let changed = false;
    for (const shape of VIEW_SHAPES) {
      const key = `${shape}FieldId`;
      if (db[key] && db.fields[db[key]]?.type === 'view') continue;
      let name = VIEW_NAMES[shape];
      for (let n = 2; Object.values(db.fields).some((f) => f.name.toLowerCase() === name.toLowerCase()); n++) name = `${VIEW_NAMES[shape]} ${n}`;
      const field = { id: uuid(), name, type: 'view', config: { ...VIEW_DEFAULTS[shape] }, system: true };
      db.fields[field.id] = field;
      db.fieldOrder.push(field.id);
      db[key] = field.id;
      // Hidden by default: the grid is for data, and a view is presentation.
      // Once a table has views, placeField already leaves it out of them.
      if (!db.tableViews && !(db.hiddenFields ?? []).includes(name)) db.hiddenFields = [...(db.hiddenFields ?? []), name];
      changed = true;
    }
    return changed;
  }

  /* Table views (Feature #229). A table carries its views as an ordered
     list — the order IS the strip, and the first is the default — each view
     holding its visible fields (ids, in column order: listed = shown,
     unlisted = hidden), its state filter and its sort. A table that predates
     views gets one, "Standard" ("Default" before 2026-09-27), made of what it showed: the columns left after
     its hidden set, in its field order, with its filter and sort. The legacy
     keys go, so there is one source. Blank is never stored. */
  /* Issue #418: the system columns a table showed (its `systemFields`, a
     table-level switch before) join the end of every view once, so no view
     loses a column; from then on each view shows and orders its own. */
  #ensureSystemColumnsInViews(db) {
    if (db.system || db.systemColumnsInViews || !Array.isArray(db.tableViews)) return false;
    db.systemColumnsInViews = true;
    const ids = (db.systemFields ?? []).filter((n) => GRID_SYSTEM_COLUMNS.includes(n)).map(sysColumnId);
    for (const v of db.tableViews) for (const id of ids) if (!v.fields.includes(id)) v.fields.push(id);
    return true;
  }

  /* "Standard" replaces "Default" (Kyle, 2026-09-27): a first view made
     before the ruling, or any view still called Default then, is renamed
     once, unless the table already has a Standard. The flag keeps the
     rename to once, so a view somebody names Default later keeps it. */
  #ensureStandardViewName(db) {
    if (db.standardViewNamed || !Array.isArray(db.tableViews)) return false;
    db.standardViewNamed = true;
    const taken = db.tableViews.some((v) => v.name.toLowerCase() === 'standard');
    const old = db.tableViews.find((v) => v.name === 'Default');
    if (old && !taken) old.name = 'Standard';
    return true;
  }

  #ensureTableViews(db) {
    if (Array.isArray(db.tableViews)) return false;
    const hidden = new Set(db.hiddenFields ?? []);
    db.standardViewNamed = true;
    const view = { id: uuid(), name: 'Standard', fields: db.fieldOrder.filter((id) => db.fields[id] && !hidden.has(db.fields[id].name)) };
    if (db.filters && Object.keys(db.filters).length) view.filters = db.filters;
    if (db.sort?.length) view.sort = db.sort;
    db.tableViews = [view];
    delete db.hiddenFields;
    delete db.filters;
    delete db.sort;
    return true;
  }

  /* The table's chip or card field, or null on a registry table. */
  viewField(dbRef, shape) {
    const db = dbRef && typeof dbRef === 'object' ? dbRef : this.getTable(dbRef);
    if (!VIEW_SHAPES.includes(shape)) throw new WeaveError(`A view is a chip or a card, not '${shape}'`, 'invalid');
    if (db.system) return null;
    const f = db.fields?.[db[`${shape}FieldId`]];
    return f?.type === 'view' ? f : null;
  }

  /* A view's config, checked. The shape is the field's identity and never
     changes; `fields` arrives as names and is stored as ids, so a rename
     costs nothing and a delete drops the segment (see deleteField). */
  #normalizeViewConfig(db, field, config) {
    const out = { ...field.config };
    if (config.shape != null && config.shape !== out.shape) throw new WeaveError(`The shape is fixed: this field is the ${out.shape}`, 'invalid');
    for (const k of ['link', 'state']) {
      if (config[k] === undefined) continue;
      if (typeof config[k] !== 'boolean') throw new WeaveError(`${k} is true or false`, 'invalid');
      out[k] = config[k];
    }
    if (config.description !== undefined) {
      if (!DESCRIPTION_SIZES.includes(config.description)) throw new WeaveError(`description is one of ${DESCRIPTION_SIZES.join(', ')}`, 'invalid');
      out.description = config.description;
    }
    if (config.fields !== undefined) {
      if (config.fields === null) out.fields = null;
      else {
        if (!Array.isArray(config.fields)) throw new WeaveError('fields is a list of field names, or null for the first few', 'invalid');
        out.fields = config.fields.map((ref) => {
          const f = this.findField(db, ref);
          if (!f) throw new WeaveError(`'${ref}' is not a field of ${db.name}`, 'invalid');
          if (f.type === 'view') throw new WeaveError(`A ${out.shape} cannot show itself or the other view`, 'invalid');
          if (f.id === db.nameFieldId) throw new WeaveError('The name is always shown', 'invalid');
          if (VIEW_EXCLUDED_TYPES.includes(f.type)) throw new WeaveError(`A ${f.type} field cannot ride on a ${out.shape}; the description preview has its own setting`, 'invalid');
          return f.id;
        });
      }
    }
    return out;
  }

  /* The fields a view shows, resolved: the explicit list, or when nobody
     chose, the first glanceable non-empty values in field order — arranging
     the columns IS the curation (Kyle, 2026-09-01). */
  #viewSegmentFields(e, db, cfg, limit) {
    const glanceable = (f) => f.id !== db.nameFieldId && !VIEW_EXCLUDED_TYPES.includes(f.type) && f.type !== 'workflow';
    if (Array.isArray(cfg.fields)) return cfg.fields.map((id) => db.fields[id]).filter(Boolean);
    const out = [];
    for (const fid of db.fieldOrder) {
      if (out.length >= limit) break;
      const f = db.fields[fid];
      if (!f || !glanceable(f)) continue;
      const v = this.#resolve(e, db, f, 0);
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
      out.push(f);
    }
    return out;
  }

  /* One row as its chip or its card: the object every surface draws from.
     `fields` are display strings, so a relation reads as names and a number
     wears its costume. The description is the plain first lines of the
     description document, clipped to the size the config asks for. */
  renderView(entityRef, shape, { limit = null, config = null } = {}) {
    const e = this.getEntity(entityRef);
    const db = this.state.tables[e.dbId];
    const field = this.viewField(db, shape);
    // A candidate config previews without being saved — the dialog's live
    // preview — checked exactly as a save would check it.
    const cfg = config
      ? this.#normalizeViewConfig(db, field ?? { config: { ...VIEW_DEFAULTS[shape] } }, config)
      : (field?.config ?? VIEW_DEFAULTS[shape]);
    const out = { shape, id: e.id, publicId: e.publicId, url: `/e/${e.id}`, name: this.entityName(e), link: cfg.link, state: null, description: null, fields: [] };
    const wf = Object.values(db.fields).find((f) => f.type === 'workflow');
    if (cfg.state && wf) {
      const st = this.#resolve(e, db, wf, 0);
      const def = wf.config.states.find((s) => s.id === st || s.name === st);
      if (def) out.state = { name: def.name, category: def.category };
    }
    if (cfg.description !== 'none') {
      const docField = this.descriptionField(db);
      const text = docField ? plainLines(e.docs?.[docField.id] ?? '') : '';
      if (text) {
        const max = DESCRIPTION_CHARS[cfg.description];
        out.description = max ? clip(text.join(' '), max) : text[0];
      }
    }
    const budget = (limit ?? VIEW_AUTO_SEGMENTS[shape]) - (out.state ? 1 : 0);
    for (const f of this.#viewSegmentFields(e, db, cfg, Math.max(budget, 0))) {
      const resolved = this.#resolve(e, db, f, 0);
      const v = this.#displayValue(db, f, resolved, e);
      // A toggle's chip says the state's word, never `true` (Feature #202).
      const shown = f.type === 'toggle' ? (v ? f.config.on : f.config.off) : v;
      const seg = { label: f.name, value: shown == null ? '' : Array.isArray(shown) ? shown.map((x) => x?.name ?? x).join(', ') : String(shown?.name ?? shown) };
      // A graphic number draws on the chip and the card too (Feature #230);
      // the text stays for a surface that draws none.
      const nd = typeof resolved === 'number' ? this.#numberDisplay(db, f) : null;
      if (nd) seg.meter = { display: nd.display, value: resolved, scale: this.#scaleOf(db, f), color: nd.color };
      // A rating draws its icons on the chip and the card (Feature #231).
      const rt = typeof resolved === 'number' ? this.#ratingOf(db, f) : null;
      if (rt) seg.rating = { value: resolved, ...rt };
      // A sparkline draws its series (Feature #232).
      if (f.type === 'formula' && f.config.display === 'sparkline' && Array.isArray(resolved)) seg.spark = { style: f.config.style ?? 'line', values: resolved, color: f.config.color ?? 'ink' };
      out.fields.push(seg);
    }
    return out;
  }

  /* The view as one line — what a formula, a CSV cell or a search index
     sees. Segments are joined with a middle dot, as the chip draws them. */
  #viewLine(v) {
    const parts = [];
    parts.push(v.link ? `#${v.publicId} ${v.name}` : v.name);
    if (v.state) parts.push(v.state.name);
    if (v.description) parts.push(v.description);
    for (const f of v.fields) if (f.value !== '') parts.push(`${f.label} ${f.value}`);
    return parts.join(' · ');
  }

  /* The term every surface speaks for this table: { singular, plural, set }.
     Absent config resolves to the default, "record". */
  termOf(dbRef) {
    const db = dbRef && typeof dbRef === 'object' ? dbRef : this.getTable(dbRef);
    const term = Term.resolve(db.fields?.[db.nameFieldId]?.config);
    // A registry table's rows ARE spaces, tables, fields, workflows: the kind
    // is the term, unless someone set one.
    if (!term.set && db.system && SYSTEM_TERMS[db.system]) return { ...Term.normalize({ singular: SYSTEM_TERMS[db.system] }), set: false };
    return term;
  }

  #setTerm(db, term, { save = true } = {}) {
    const field = db.fields[db.nameFieldId];
    if (!field) throw new WeaveError('This table has no Name field', 'invalid');
    if (term == null) delete field.config.term;
    else {
      try { field.config.term = Term.normalize(term); } catch (err) { throw new WeaveError(err.message, 'invalid'); }
    }
    if (save) {
      this.#syncFieldRow(db, field);
      this.save();
      if (!db.system) this.#audit('field-updated', { table: db.name, name: field.name, patch: ['term'] });
    }
  }

  /* A table's description field, or null when it has been deleted. Every
     "the default document" reader goes through here, so reordering columns
     no longer silently reassigns which document is the description. */
  descriptionField(db) {
    if (!db?.fields) return null;
    // A registry table's 'Description' is the TEXT column mirroring the real
    // space/table description, and its documents (Workflows' Script, Diagram)
    // are structure, not prose. No registry table has a description role.
    if (db.system) return null;
    if (db.descriptionFieldId === null) return null;
    const f = db.fields[db.descriptionFieldId];
    if (f?.type === 'document') return f;
    return this.documentFields(db)[0] ?? null;
  }

  save() {
    // State, Tables and Spaces follow the Script on every write to a
    // Workflows row, by whichever verb wrote it (Feature #249).
    if (this.#wfQueue.size && !this.#stamping) {
      const ids = [...this.#wfQueue];
      this.#wfQueue.clear();
      for (const id of ids) {
        const row = own(this.state.entities, id);
        if (row && !row.deletedAt) this.#settleWorkflow(row);
      }
    }
    if (HELD) this.#held = true;
    else {
      this.store.save(this.state, { dirty: this.#dirty, all: this.#dirtyAll });
      this.#dirty.clear();
      this.#dirtyAll = false;
    }
    this.#schemaVersion = null;
    this.#scales.clear();
  }

  /* What one write touched (Issue #257). `#dirty` is the store's business and
     is cleared by every save, including the nested ones an automation causes,
     so the blast radius a caller wants is collected alongside it: `touching`
     opens a set, `#mark` fills it, and the caller reads it back whole. Nested
     calls fold into the outer set rather than hiding from it. */
  #touching = null;

  touching(fn) {
    const outer = this.#touching;
    const set = new Set();
    this.#touching = set;
    try {
      return { result: fn(), touched: [...set] };
    } finally {
      this.#touching = outer;
      if (outer) for (const id of set) outer.add(id);
    }
  }

  /* The rows a client must re-read after writing `id`: the ones this write
     marked, plus every row `id` is linked to — a lookup or rollup there shows
     this row's value and recomputes on read, so it repaints with nothing of
     its own written. A one-way target-set relation POINTING AT `id` is the
     one link this cannot see from here; that row keeps its stale value until
     its page is read again. */
  affectedBy(id, touched = []) {
    const out = new Set([id, ...touched]);
    const e = own(this.state.entities, id);
    const db = e ? this.state.tables[e.dbId] : null;
    for (const f of Object.values(db?.fields ?? {})) {
      if (f.type !== 'relation') continue;
      for (const rid of this.#relationIds(e, f)) out.add(rid);
    }
    return [...out];
  }

  #mark(entityOrId) {
    const e = typeof entityOrId === 'string' ? own(this.state.entities, entityOrId) : entityOrId;
    // A formula Name is materialised into values[nameFieldId] on the row's own
    // writes (Feature #168) so FTS search and the store index a string.
    // Cross-row inputs refresh on this row's next write — search may lag,
    // the displayed name never does (entityName computes live).
    const db = e?.dbId ? this.state.tables[e.dbId] : null;
    const nf = db?.fields?.[db.nameFieldId];
    if (nf?.type === 'formula' && e.values) {
      try { const v = this.#resolve(e, db, nf, 0); e.values[nf.id] = v == null ? '' : String(v); } catch { /* an erroring formula leaves the last value */ }
    }
    const id = typeof entityOrId === 'string' ? entityOrId : entityOrId.id;
    this.#dirty.add(id);
    this.#touching?.add(id);
    // A Workflows row someone wrote is judged again at the next save, and
    // the rules are re-read (Feature #249). The engine's own stamps are not
    // a write to the rule.
    if (db?.system === 'workflows' && !this.#stamping) { this.#wfQueue.add(id); this.#wfEpoch++; }
  }

  // The end of a deferred open (see deferMigrations). Re-read what another
  // process wrote meanwhile, migrate whatever state is on hand (a reload
  // brings back the unmigrated shape), then write what is still held. A held
  // save kept its dirty set, and the structural rows are compared on every
  // save, so a plain save writes exactly what changed. Forcing every row
  // here is what stalled the hosted swap on 2026-10-03: a full rewrite of
  // each workspace, row and search entry, in the worker that had just begun
  // serving.
  settleDeferred() {
    this.maybeRefresh();
    const held = this.#held;
    this.#held = false;
    this.#migrate();
    // A reload brings state.automations back too (Feature #249).
    this.#migrateAutomations();
    if (held) this.save();
  }

  // Re-read state when another process (CLI beside the server, a second
  // server) committed to the same workspace file. Returns true on reload.
  maybeRefresh() {
    if (!this.store.changedExternally?.()) return false;
    const loaded = this.store.reload();
    if (loaded) {
      this.state = loaded;
      // A CLI beside the hub may have changed this member's structure; the
      // root rows are a projection, so re-assert them (Feature #219).
      if (this.registryHost) this.#syncAll();
      // A writer on older code beside this one can still leave a rule in
      // state.automations; it becomes a row here (Feature #249).
      this.#migrateAutomations();
    }
    this.#schemaVersion = null;
    this.#scales.clear();
    return true;
  }

  /* The structure's fingerprint (Issue #274). A browser tab loads the schema
     once and then draws fresh rows against it forever; this is how it learns
     the schema moved underneath it — under the CLI, an agent over MCP, an
     automation or a second tab — on the query it was already making, since
     every API response stamps this value. Feature #33's focus listener only
     ever covered the second-tab case: nobody refocuses the window after an
     agent writes.

     Derived, never stored: two processes holding the same workspace compute
     the same string, so nothing has to be bumped, persisted or coordinated.
     The cost is one stringify + one hash of the structural rows (~0.4ms on
     the largest workspace here), paid at most once per write. */
  schemaVersion() {
    this.#schemaVersion ??= schemaFingerprint(this.state);
    return this.#schemaVersion;
  }

  // ---------------- spaces ----------------

  createSpace({ name, description = '', icon = '', template = false }) {
    if (!name) throw new WeaveError('Space name is required', 'invalid');
    refuseReserved('space', name);
    if (this.findSpace(name)) throw new WeaveError(`Space '${name}' already exists`, 'conflict');
    // A table has taken its icon at creation since Feature #51; a space had to
    // be created and then updated, which is a second call for one field.
    const held = Object.values(this.state.spaces).find((s) => s.deletedAt && s.name.toLowerCase() === name.toLowerCase());
    if (held) throw new WeaveError(`Space '${name}' is in the trash — restore or purge it first`, 'conflict');
    // template (Feature #261) is stored like icon: present only when set.
    const space = { id: uuid(), name, description, ...(iconValue(icon) ? { icon: iconValue(icon) } : {}), ...(template === true ? { template: true } : {}), createdAt: nowISO() };
    this.state.spaces[space.id] = space;
    this.save();
    this.#syncSpaceRow(space);
    if (!space.system) this.#audit('space-created', { name: space.name });
    return space;
  }

  listSpaces({ includeDeleted = false } = {}) {
    const all = Object.values(this.state.spaces);
    return includeDeleted ? all : all.filter((s) => !s.deletedAt);
  }

  /* An id finds a space even in the trash — restore and the registry need
     that, the same way readEntity works on a trashed row. Name lookups see
     only live spaces. */
  findSpace(ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    const live = Object.values(this.state.spaces).filter((s) => !s.deletedAt);
    return own(this.state.spaces, ref) ?? live.find((s) => s.name === ref)
      ?? live.find((s) => s.name.toLowerCase() === String(ref).toLowerCase());
  }

  getSpace(ref) {
    const s = this.findSpace(ref);
    if (!s) throw new WeaveError(`Space '${ref}' not found`, 'not-found');
    return s;
  }

  updateSpace(ref, patch) {
    const s = this.getSpace(ref);
    if (patch.name != null) refuseReserved('space', patch.name);
    if (patch.template != null && typeof patch.template !== 'boolean') throw new WeaveError(`A space's template is true or false, got ${JSON.stringify(patch.template)}`, 'invalid');
    this.#audit('space-updated', { name: s.name, patch: Object.keys(patch) });
    if (patch.name != null) s.name = patch.name;
    if (patch.description != null) s.description = patch.description;
    if (patch.icon != null) { const v = iconValue(patch.icon); if (v) s.icon = v; else delete s.icon; }
    if (patch.template != null) { if (patch.template) s.template = true; else delete s.template; }
    this.#syncSpaceRow(s);
    this.save();
    return s;
  }

  /* Recoverable by default, like an entity: a soft delete tombstones the
     space and leaves its tables and rows exactly where they are, hidden by
     the parent. `hard` is the old cascading purge. */
  deleteSpace(ref, { hard = false } = {}) {
    const s = this.getSpace(ref);
    // Issue #248: say what the space is, not "registry" — that read as a
    // name clash with the Spaces table. The refusal itself is by design (#126).
    if (s.system) throw new WeaveError(`Space '${s.name}' is the workspace's own system space and cannot be deleted`, 'invalid');
    if (!hard) {
      if (s.deletedAt) return s;
      s.deletedAt = nowISO();
      this.#trashSysRow('spaces', s.id);
      this.#audit('space-trashed', { name: s.name });
      this.save();
      return s;
    }
    for (const db of this.listTables(s.id, { includeDeleted: true })) this.deleteTable(db.id, { hard: true });
    delete this.state.spaces[s.id];
    this.#dropSysRow('spaces', s.id);
    this.#audit('space-deleted', { name: s.name });
    this.save();
  }

  restoreSpace(ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    // The live-name resolver cannot see the trash, so reach in by hand.
    const s = own(this.state.spaces, ref)
      ?? Object.values(this.state.spaces).find((x) => x.name.toLowerCase() === String(ref).toLowerCase());
    if (!s) throw new WeaveError(`Space '${ref}' not found`, 'not-found');
    if (!s.deletedAt) return s;
    // A member's legacy Workspace space is a tombstone, not trash (Feature #219).
    if (s.system && this.state.meta.registry === 'hub') throw new WeaveError('The registry lives at the weave root now — this workspace\'s own Workspace space is a tombstone', 'invalid');
    const clash = Object.values(this.state.spaces).find((x) => !x.deletedAt && x.name.toLowerCase() === s.name.toLowerCase());
    if (clash) throw new WeaveError(`A live space already holds the name '${s.name}'`, 'conflict');
    s.deletedAt = null;
    this.#restoreSysRow('spaces', s.id);
    this.#audit('space-restored', { name: s.name });
    this.save();
    return s;
  }

  // ---------------- tables ----------------

  createTable({ space, name, description = '', icon = '' }) {
    const sp = this.getSpace(space);
    if (!name) throw new WeaveError('Table name is required', 'invalid');
    refuseReserved('table', name);
    const qualified = `${sp.name}/${name}`;
    if (this.findTable(qualified)) throw new WeaveError(`Table '${qualified}' already exists`, 'conflict');
    const held = Object.values(this.state.tables).find((d) => d.deletedAt && d.spaceId === sp.id && d.name.toLowerCase() === name.toLowerCase());
    if (held) throw new WeaveError(`Table '${qualified}' is in the trash — restore or purge it first`, 'conflict');
    const nameField = { id: uuid(), name: 'Name', type: 'text', config: {} };
    const docField = { id: uuid(), name: 'Description', type: 'document', config: {} };
    const db = {
      id: uuid(),
      spaceId: sp.id,
      name,
      description,
      icon: iconValue(icon),
      publicIdCounter: 0,
      nameFieldId: nameField.id,
      /* The description is a ROLE, held by id (Kyle, 2026-08-27: "description
         should be a default field in all entities. it can be renamed or
         deleted"). An id survives the rename for free; deleteField sets this
         to null, and that null is the tombstone #ensureDescriptionField reads
         as "the owner removed it" rather than "this table predates the role".
         Unlike nameFieldId, nothing here is defended — renaming and deleting
         are exactly what Kyle asked to keep working. */
      descriptionFieldId: docField.id,
      fields: { [nameField.id]: nameField, [docField.id]: docField },
      fieldOrder: [nameField.id, docField.id],
      createdAt: nowISO(),
    };
    this.#ensureViewFields(db);
    this.#ensureTableViews(db);
    this.#ensureSystemColumnsInViews(db);
    this.state.tables[db.id] = db;
    this.save();
    this.#syncTableRow(db);
    for (const f of Object.values(db.fields)) this.#syncFieldRow(db, f);
    if (!db.system) this.#audit('table-created', { space: sp.name, name: db.name });
    return db;
  }

  listTables(spaceId = null, { includeDeleted = false } = {}) {
    let all = Object.values(this.state.tables);
    if (!includeDeleted) all = all.filter((d) => !d.deletedAt && !this.state.spaces[d.spaceId]?.deletedAt);
    return spaceId ? all.filter((d) => d.spaceId === spaceId) : all;
  }

  /* The tables a person made (Issue #386): the registry — any system table,
     or a table in a system space — is weave's own, and every root carries it
     from birth, so a count that includes it is never zero. */
  userTables() {
    return this.listTables().filter((d) => !d.system && !this.state.spaces[d.spaceId]?.system);
  }

  qualifiedName(db) {
    const sp = this.state.spaces[db.spaceId];
    return `${sp ? sp.name : '?'}/${db.name}`;
  }

  findTable(ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    if (own(this.state.tables, ref)) return this.state.tables[ref];
    const all = Object.values(this.state.tables).filter((d) => !d.deletedAt && !this.state.spaces[d.spaceId]?.deletedAt);
    if (String(ref).includes('/')) {
      const [spName, dbName] = String(ref).split('/');
      return all.find((d) => d.name.toLowerCase() === dbName.toLowerCase()
        && this.state.spaces[d.spaceId]?.name.toLowerCase() === spName.toLowerCase());
    }
    const matches = all.filter((d) => d.name.toLowerCase() === String(ref).toLowerCase());
    if (matches.length > 1) throw new WeaveError(`Table name '${ref}' is ambiguous; qualify as Space/Name`, 'ambiguous');
    return matches[0];
  }

  getTable(ref) {
    const db = this.findTable(ref);
    if (!db) throw new WeaveError(`Table '${ref}' not found`, 'not-found');
    return db;
  }

  updateTable(ref, patch) {
    const db = this.getTable(ref);
    if (patch.name != null) refuseReserved('table', patch.name);
    // A system table's name is fixed (Kyle, 2026-09-29): the nav pins it and
    // every door finds it by that name. Writing the name it has is no rename.
    if (patch.name != null && db.system && patch.name !== db.name) throw new WeaveError(`Table '${db.name}' is part of the system registry and cannot be renamed`, 'invalid');
    if (patch.name != null) db.name = patch.name;
    if (patch.description != null) db.description = patch.description;
    if (patch.icon != null) db.icon = iconValue(patch.icon);
    if (patch.noun != null) {
      // `noun` is the pre-term spelling (Feature #40): a bare singular that
      // lands on the Name field's term. Empty clears it.
      if (typeof patch.noun !== 'string') throw new WeaveError('A noun is a short string (e.g. "invoice")', 'invalid');
      this.#setTerm(db, patch.noun.trim() ? { singular: patch.noun } : null);
    }
    if (patch.systemFields != null) {
      const known = ['Created At', 'Modified At', 'Created By', 'Modified By', 'Activity'];
      for (const n of patch.systemFields) {
        if (!known.includes(n)) throw new WeaveError(`'${n}' is not a system field (${known.join(', ')})`, 'invalid');
      }
      db.systemFields = [...patch.systemFields];
      /* The table-level switch is the default view's under its older name
         (Issue #418): the grid columns it names show or hide there, in the
         view's own order, as hiddenFields does for the fields. */
      const cur = !db.system ? db.tableViews?.[0] : null;
      if (cur) {
        const want = new Set(patch.systemFields.filter((n) => GRID_SYSTEM_COLUMNS.includes(n)).map(sysColumnId));
        const show = [...want].filter((id) => !cur.fields.includes(id)).map(sysColumnName);
        const hide = cur.fields.filter((id) => sysColumnName(id) && !want.has(id)).map(sysColumnName);
        if (show.length || hide.length) this.#writeView(db, cur.name, { show, hide });
      }
    }
    // Hidden fields (Feature #114): a per-table view setting, by name, over
    // the table's own fields and the system columns. Nothing else changes.
    /* View config as data (Kyle, 2026-08-28): the workflow-state filter and
       the sort are table truth, not browser truth — stored here, mirrored to
       the Tables registry row as text, edited from either side. Density is
       deliberately absent: a per-person reading preference, not schema. */
    /* Since Feature #229 the filter, the sort and the hidden set belong to a
       view. These three keys are the table's DEFAULT view under their older
       names, written through the view verb, so every door that spoke them
       still lands somewhere a reader sees. */
    if (patch.filters != null || patch.sort != null || patch.hiddenFields != null) {
      this.#writeDefaultView(db, patch);
    }
    /* The Σ row's switch (Issue #233), inverted by Issue #249 (Kyle,
       2026-09-08: "hide summation row by default"). A table has no Σ row
       until someone asks for one, so the flag is stored in BOTH directions:
       `false` means this table opted in, `true` means it was switched back
       off, and the absence means nobody has asked. Storing only `true` — the
       old shape, where the absence meant shown — would have made a table
       Kyle switched on read exactly like one he never touched, and the new
       default would then have silently hidden his own row. Nothing stored
       needs rewriting: `true` was off then and is off now, and the absence
       was on then and is the new default off. */
    if (patch.hideRollups != null) {
      if (typeof patch.hideRollups !== 'boolean') throw new WeaveError('hideRollups is true or false', 'invalid');
      db.hideRollups = patch.hideRollups;
    }
    /* Body order (Issue #89): where the field block sits among the documents
       and the related tables on an entity page. The value fields are one
       block — `@values` stands for the run of them — because the grid is a
       thing you move, not a thing you take apart. Stored by id like
       fieldOrder, so a rename cannot orphan a placement, and a short list is
       fine here: bodyBlocks() appends whatever nobody placed. */
    if (patch.bodyOrder != null) {
      if (!Array.isArray(patch.bodyOrder)) throw new WeaveError('bodyOrder is a list of block keys', 'invalid');
      const keys = patch.bodyOrder.map((ref2) => {
        if (ref2 === VALUES_BLOCK) return VALUES_BLOCK;
        const f = this.getField(db.id, ref2);
        if (!isBodyBlock(f)) throw new WeaveError(`'${f.name}' is not a body block — value fields move inside ${VALUES_BLOCK}`, 'invalid');
        return f.id;
      });
      if (new Set(keys).size !== keys.length) throw new WeaveError('bodyOrder lists every block at most once, and it repeated one', 'invalid');
      if (keys.length) db.bodyOrder = keys; else delete db.bodyOrder;
    }
    // Column order is fieldOrder — describeSchema() reads it — so a reorder is
    // a schema write. Demand a full permutation: a short list would silently
    // drop columns off the grid, which reads exactly like data loss.
    if (patch.fieldOrder != null) {
      const ids = patch.fieldOrder.map((ref2) => this.getField(db.id, ref2).id);
      // The chip and the card are hidden and minted, so a caller who never
      // saw them may leave them out: they keep their place at the end.
      for (const fid of db.fieldOrder) if (db.fields[fid]?.type === 'view' && !ids.includes(fid)) ids.push(fid);
      const unique = new Set(ids);
      if (unique.size !== ids.length || ids.length !== db.fieldOrder.length) {
        throw new WeaveError('fieldOrder must list every field exactly once', 'invalid');
      }
      db.fieldOrder = ids;
    }
    this.#syncTableRow(db);
    this.save();
    // A rename is not audited, and a rule names its table (Feature #249).
    if (patch.name != null) this.#reg.#settleWorkflows();
    return db;
  }

  /* Re-home a table: only spaceId changes, so every row, field and relation
     stays put. The destination gets the same name defence createTable runs —
     a live clash refuses outright, a trashed one names the trash. */
  moveTable(ref, spaceRef) {
    const db = this.getTable(ref);
    if (db.system) throw new WeaveError(`Table '${db.name}' is part of the system registry`, 'invalid');
    // An id finds a table (or a space) in the trash; neither is a home to
    // move from or into — restore first, then move.
    if (db.deletedAt) throw new WeaveError(`Table '${db.name}' is in the trash — restore it first`, 'conflict');
    const sp = this.getSpace(spaceRef);
    if (sp.system) throw new WeaveError(`Space '${sp.name}' is the workspace's own system space and cannot hold your tables`, 'invalid');
    if (sp.deletedAt) throw new WeaveError(`Space '${sp.name}' is in the trash — restore it first`, 'conflict');
    if (sp.id === db.spaceId) return db;
    const clash = Object.values(this.state.tables).find((d) => d.id !== db.id
      && d.spaceId === sp.id && d.name.toLowerCase() === db.name.toLowerCase());
    if (clash?.deletedAt) throw new WeaveError(`Table '${sp.name}/${db.name}' is in the trash — restore or purge it first`, 'conflict');
    if (clash) throw new WeaveError(`Table '${sp.name}/${db.name}' already exists`, 'conflict');
    const from = this.state.spaces[db.spaceId]?.name;
    db.spaceId = sp.id;
    this.save();
    this.#syncTableRow(db);
    this.#audit('table-moved', { name: db.name, from, to: sp.name });
    return db;
  }

  /* Duplicate a table's SCHEMA into a sibling: every field cloned deep with a
     fresh id (an id map keeps lookups/rollups and the name/description roles
     pointing inside the copy), paired relations rebuilt for real — an
     external target grows a fresh auto-renamed inverse, a self-relation
     retargets into the copy — and the name takes " Copy" (" Copy 2", …)
     until it clears both the live tables and the trash. Rows are not copied:
     the copy starts empty. */
  duplicateTable(ref) {
    const src = this.getTable(ref);
    if (src.system) throw new WeaveError(`Table '${src.name}' is part of the system registry`, 'invalid');
    if (src.deletedAt) throw new WeaveError(`Table '${src.name}' is in the trash — restore it first`, 'conflict');
    const sp = this.state.spaces[src.spaceId];
    const taken = (n) => Object.values(this.state.tables)
      .some((d) => d.spaceId === src.spaceId && d.name.toLowerCase() === n.toLowerCase());
    let name = `${src.name} Copy`;
    for (let i = 2; taken(name); i++) name = `${src.name} Copy ${i}`;
    const newId = uuid();
    const idMap = new Map(Object.keys(src.fields).map((fid) => [fid, uuid()]));
    const mapId = (fid) => idMap.get(fid) ?? fid;
    const fields = {};
    const touchedTargets = []; // far tables that grew an inverse
    for (const f of Object.values(src.fields)) {
      const nf = structuredClone(f);
      nf.id = mapId(f.id);
      if (f.type === 'relation' && !f.config.targetDbs) {
        if (f.config.targetDb === src.id) {
          // Self-relation: both ends live in this table, so the whole pair
          // clones through the id map and closes over the copy.
          nf.config.targetDb = newId;
          nf.config.inverseFieldId = mapId(f.config.inverseFieldId);
        } else {
          const target = this.state.tables[f.config.targetDb];
          const srcInv = target?.fields[f.config.inverseFieldId];
          if (target && srcInv) {
            let invName = `${srcInv.name} Copy`;
            for (let i = 2; this.findField(target, invName); i++) invName = `${srcInv.name} Copy ${i}`;
            const inv = { id: uuid(), name: invName, type: 'relation',
              config: { ...structuredClone(srcInv.config), targetDb: newId, inverseFieldId: nf.id } };
            nf.config.inverseFieldId = inv.id;
            target.fields[inv.id] = inv;
            placeField(target, inv.id);
            touchedTargets.push([target, inv]);
          } else {
            // The far end is gone; keep the field but make it honestly one-way.
            delete nf.config.inverseFieldId;
          }
        }
      }
      if (f.type === 'lookup' || f.type === 'rollup') {
        nf.config.relationField = mapId(f.config.relationField);
        if (nf.config.targetField != null) nf.config.targetField = mapId(nf.config.targetField);
      }
      if (f.type === 'view' && Array.isArray(f.config.fields)) {
        nf.config.fields = f.config.fields.map(mapId);
      }
      fields[nf.id] = nf;
    }
    const db = {
      ...structuredClone({ description: src.description, icon: src.icon, noun: src.noun,
        systemFields: src.systemFields, hideRollups: src.hideRollups }),
      // The copy keeps the source's views, re-pointed at its own fields.
      tableViews: (src.tableViews ?? []).map((v) => {
        const copy = { ...structuredClone(v), id: uuid(), fields: v.fields.map(mapId) };
        if (copy.widths) copy.widths = Object.fromEntries(Object.entries(copy.widths).map(([k, px]) => [mapId(k), px]));
        delete copy.parked;
        return copy;
      }),
      id: newId,
      spaceId: src.spaceId,
      name,
      publicIdCounter: 0,
      nameFieldId: mapId(src.nameFieldId),
      descriptionFieldId: src.descriptionFieldId == null ? src.descriptionFieldId : mapId(src.descriptionFieldId),
      chipFieldId: src.chipFieldId ? mapId(src.chipFieldId) : undefined,
      cardFieldId: src.cardFieldId ? mapId(src.cardFieldId) : undefined,
      fields,
      fieldOrder: src.fieldOrder.map(mapId),
      createdAt: nowISO(),
    };
    if (src.bodyOrder) db.bodyOrder = src.bodyOrder.map((k) => (k === VALUES_BLOCK ? k : mapId(k)));
    for (const k of Object.keys(db)) if (db[k] === undefined) delete db[k];
    this.state.tables[db.id] = db;
    this.save();
    this.#syncTableRow(db);
    for (const f of Object.values(db.fields)) this.#syncFieldRow(db, f);
    for (const [target, inv] of touchedTargets) { this.#syncFieldRow(target, inv); this.#syncTableRow(target); }
    this.#audit('table-duplicated', { space: sp?.name, source: src.name, name: db.name });
    return db;
  }

  /* Recoverable by default (structure trash): a soft delete tombstones the
     table and keeps every row exactly where it is, hidden by the tombstone.
     `hard` is the old purge. */
  deleteTable(ref, { hard = false } = {}) {
    const db = this.getTable(ref);
    if (db.system) throw new WeaveError(`Table '${db.name}' is part of the system registry`, 'invalid');
    if (!hard) {
      if (db.deletedAt) return db;
      db.deletedAt = nowISO();
      this.#trashSysRow('tables', db.id);
      for (const v of db.tableViews ?? []) this.#trashSysRow('views', v.id);
      this.#audit('table-trashed', { name: db.name });
      this.save();
      return db;
    }
    // Purge, not trash: the table itself is going away, so a soft-deleted row
    // would be left pointing at a table that no longer exists — unrestorable
    // and fatal to any read of the trash. Trashed rows go too.
    for (const e of this.listEntities(db.id, { includeDeleted: true })) {
      this.deleteEntity(e.id, { hard: true });
    }
    // Remove paired relation fields living in other tables — registry row
    // included, or the Fields registry keeps an orphan for a column that no
    // longer exists (found by the promote rehearsal, 2026-09-01).
    for (const field of Object.values(db.fields)) {
      if (field.type === 'relation') {
        const other = this.state.tables[field.config.targetDb];
        if (other && other.id !== db.id) {
          this.#removeFieldRaw(other, field.config.inverseFieldId);
          this.#dropFieldRow(field.config.inverseFieldId);
        }
      }
    }
    // Prune this table from every target set pointing here; a set emptied by
    // the prune takes its field with it — a relation with nowhere to point is
    // not a field.
    for (const other of Object.values(this.state.tables)) {
      if (other.id === db.id) continue;
      for (const f of [...Object.values(other.fields)]) {
        if (f.type !== 'relation' || !f.config.targetDbs?.includes(db.id)) continue;
        f.config.targetDbs = f.config.targetDbs.filter((id) => id !== db.id);
        if (!f.config.targetDbs.length) {
          this.#removeFieldRaw(other, f.id);
          this.#dropFieldRow(f.id);
        } else {
          this.#syncFieldRow(other, f);
        }
      }
    }
    for (const [id, auto] of Object.entries(this.state.automations)) {
      if (auto.dbId === db.id) delete this.state.automations[id];
    }
    for (const f of Object.values(db.fields)) this.#dropFieldRow(f.id);
    for (const v of db.tableViews ?? []) this.#dropSysRow('views', v.id);
    // A space rollup over this table has nothing left to read.
    const spacesT = this.#sysTable('spaces');
    if (spacesT) {
      const reg = this.#reg;
      for (const f of Object.values(spacesT.fields)) {
        if (f.type === 'rollup' && f.config.via === db.id) { reg.#removeFieldRaw(spacesT, f.id); reg.#dropFieldRow(f.id); }
      }
      if (reg !== this) reg.save();
    }
    delete this.state.tables[db.id];
    this.#dropSysRow('tables', db.id);
    this.#audit('table-deleted', { name: db.name });
    this.save();
  }

  restoreTable(ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    let db = own(this.state.tables, ref);
    if (!db) {
      const [spName, dbName] = String(ref).includes('/') ? String(ref).split('/') : [null, String(ref)];
      db = Object.values(this.state.tables).find((d) => d.name.toLowerCase() === String(dbName).toLowerCase()
        && (!spName || this.state.spaces[d.spaceId]?.name.toLowerCase() === spName.toLowerCase()));
    }
    if (!db) throw new WeaveError(`Table '${ref}' not found`, 'not-found');
    if (!db.deletedAt) return db;
    const sp = this.state.spaces[db.spaceId];
    if (sp?.deletedAt) throw new WeaveError(`Table '${db.name}' is inside the trashed space '${sp.name}' — restore the space first`, 'invalid');
    const clash = Object.values(this.state.tables).find((x) => !x.deletedAt && x.spaceId === db.spaceId && x.name.toLowerCase() === db.name.toLowerCase());
    if (clash) throw new WeaveError(`A live table already holds the name '${this.qualifiedName(db)}'`, 'conflict');
    db.deletedAt = null;
    this.#restoreSysRow('tables', db.id);
    for (const v of db.tableViews ?? []) this.#restoreSysRow('views', v.id);
    this.#audit('table-restored', { name: db.name });
    this.save();
    return db;
  }

  // ---------------- fields ----------------

  /* The workspace's shape as mermaid source (Feature #51): one generator,
     consumed by the home page and any document that wants the map. User
     structure only — the registry describes itself and would double every
     edge with bookkeeping. */
  relationMapMmd() {
    const lines = ['graph LR'];
    const nid = (db) => 'T' + db.id.replaceAll('-', '').slice(0, 8);
    for (const sp of this.listSpaces()) {
      if (sp.system) continue;
      const tables = this.listTables(sp.id).filter((t) => !t.system);
      if (!tables.length) continue;
      lines.push(`  subgraph ${JSON.stringify(sp.name)}`);
      for (const t of tables) lines.push(`    ${nid(t)}[${JSON.stringify(t.name)}]`);
      lines.push('  end');
    }
    const seen = new Set();
    for (const db of Object.values(this.state.tables)) {
      if (db.system) continue;
      for (const f of Object.values(db.fields)) {
        if (f.type !== 'relation' || seen.has(f.id)) continue;
        seen.add(f.id);
        seen.add(f.config.inverseFieldId);
        // A target-set relation is one field but one edge per member table.
        for (const tid of this.relationTargetDbIds(f)) {
          const target = this.state.tables[tid];
          if (!target || target.system) continue;
          lines.push(`  ${nid(db)} -- ${JSON.stringify(f.name)} --> ${nid(target)}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  // ---------------- saved views (Feature #17) ----------------
  /* A view is a named list of blocks — each a table plus an optional where —
     stored in workspace meta. Sharing mints a capability token: the /view/
     URL renders that view read-only and nothing else, even when the
     workspace requires auth. Tables are resolved at creation so a broken
     block fails the author, not the reader. */
  createView({ name, blocks = [] } = {}) {
    if (!name) throw new WeaveError('View name is required', 'invalid');
    refuseReserved('view', name);
    const views = (this.state.meta.views ??= {});
    const resolved = blocks.map((b) => {
      const db = this.getTable(b.table);
      const view = b.view ?? 'table';
      // Issue #438: a kind the UI does not draw (the board, gone since Issue #75) renders nothing.
      if (!VOCABULARY.viewKinds.includes(view)) throw new WeaveError(`View kind '${view}' is not drawn; use ${VOCABULARY.viewKinds.join(', ')}`, 'invalid');
      return { dbId: db.id, where: b.where ?? null, view };
    });
    const v = { id: uuid(), name, blocks: resolved, createdAt: nowISO(), createdBy: this.actor };
    views[v.id] = v;
    this.save();
    this.#audit('view-created', { name });
    return v;
  }

  listViews() {
    return Object.values(this.state.meta.views ?? {}).map(({ shareToken, ...pub }) => ({ ...pub, shared: !!shareToken }));
  }

  getView(id) {
    const v = own(this.state.meta.views, id);
    if (!v) throw new WeaveError(`View '${id}' not found`, 'not-found');
    return v;
  }

  deleteView(id) {
    const v = this.getView(id);
    delete this.state.meta.views[v.id];
    this.save();
    this.#audit('view-deleted', { name: v.name });
    return { id: v.id, deleted: true };
  }

  resolveView(id) {
    const v = this.getView(id);
    return {
      id: v.id,
      name: v.name,
      blocks: v.blocks.map((b) => {
        const db = this.state.tables[b.dbId];
        if (!db) return { table: '(deleted table)', items: [] };
        const { items } = this.query(db.id, { where: b.where ?? undefined });
        return { table: this.qualifiedName(db), view: b.view, items: items.map((e) => this.readEntity(e.id)) };
      }),
    };
  }

  shareView(id) {
    const v = this.getView(id);
    v.shareToken ??= 'wvv_' + randomBytes(18).toString('base64url');
    this.save();
    this.#audit('view-shared', { name: v.name });
    return { url: `/view/${v.shareToken}`, token: v.shareToken };
  }

  unshareView(id) {
    const v = this.getView(id);
    delete v.shareToken;
    this.save();
    this.#audit('view-unshared', { name: v.name });
    return { id: v.id, shared: false };
  }

  viewByShareToken(token) {
    if (!token) return null;
    return Object.values(this.state.meta.views ?? {}).find((v) => v.shareToken === token) ?? null;
  }

  // ---------------- table views (Feature #229) ----------------
  /* The views over one table's grid — the strip under its title. Not the
     saved views above (Feature #17, cross-table share pages, `views` in
     meta); these live on the table as `tableViews` and answer to
     `tableView`, `weave_table_view`, `weave table view` and
     `/api/tables/:t/views`.

     One verb, because every agent turn pays for every tool it can see:
       tableView('Issue')                    the strip, in order: compact
       tableView('Issue/Open bugs')          one view
       tableView('Issue/Open bugs', patch)   write it, creating it if new
     A patch names only what changes: `fields` (the visible columns in
     order — listed shows, unlisted hides), `show` / `hide` (names), `move`
     ({field, before|after}, or a list of them), `filters` and `sort`
     (updateTable's shapes and validators), `position` (its place in the
     strip; 0 is the default, Kyle's ruling 2026-09-25: order is the only
     signal), `default: true` (the old spelling of position 0), `name`
     (rename), `from` (the view a new one copies — every field, no filter,
     no sort when omitted), `delete: true` (never the last view: a table
     keeps one), `widths` ({field: px}, merged; null clears one) and
     `frozen` (how many leading fields stay frozen beside #; Feature #233)
     and `density` (compact, comfortable or spacious: the row height the
     grid draws this view at; Feature #239), `deleted` (true shows the
     trashed rows in place) and `rollups` (true draws the Σ row, false
     hides it, null hands it back to the table's hideRollups; Issue #442).
     Blank, the raw table, left the strip on 2026-09-25; it is
     still readable as 'Issue/blank' so old links and agents keep working,
     never written, never stored. */
  tableView(ref, patch = null) {
    const { db, name } = this.#viewTarget(ref);
    this.#ensureTableViews(db);
    const keys = patch ? Object.keys(patch).filter((k) => patch[k] !== undefined) : [];
    if (name == null) {
      if (keys.length) throw new WeaveError(`Name the view to write: '${this.qualifiedName(db)}/<view>'`, 'invalid');
      return { table: this.qualifiedName(db), views: db.tableViews.map((v) => this.#viewOut(db, v)) };
    }
    if (name.toLowerCase() === 'blank') {
      if (keys.length) throw new WeaveError(`Blank is read-only: it is the raw table — every field in schema order, no filter, no sort. Start a view from it instead: {from: 'blank'} under a new name`, 'invalid');
      return { name: 'Blank', blank: true, fields: this.#blankFields(db).map((id) => db.fields[id].name) };
    }
    const i = this.#viewIndex(db, name);
    if (!keys.length) {
      if (i < 0) throw this.#noView(db, name);
      return this.#viewOut(db, db.tableViews[i]);
    }
    return this.#writeView(db, name, patch);
  }

  /* 'Table' or 'Space/Table' is the table; one more segment is a view. A
     table id stands in for the table part anywhere. */
  #viewTarget(ref) {
    if (ref && typeof ref === 'object') return { db: this.getTable(ref), name: null };
    const s = String(ref ?? '');
    const parts = s.split('/');
    if (parts.length <= 2) {
      const db = this.findTable(s);
      if (db) return { db, name: null };
    }
    if (parts.length >= 2) {
      const db = this.findTable(parts.slice(0, -1).join('/'));
      if (db) return { db, name: parts.at(-1) };
    }
    throw new WeaveError(`No table or view '${s}' — name a table ('Issue') or one of its views ('Issue/Open bugs')`, 'not-found');
  }

  /* A view answers to its name (any case) or its id. */
  #viewIndex(db, ref) {
    const r = String(ref).toLowerCase();
    return db.tableViews.findIndex((v) => v.id === ref || v.name.toLowerCase() === r);
  }

  #noView(db, name) {
    const have = db.tableViews.map((v) => v.name).join(', ');
    return new WeaveError(`View '${name}' not found on ${this.qualifiedName(db)} — it has: ${have}`, 'not-found');
  }

  #blankFields(db) {
    return db.fieldOrder.filter((id) => db.fields[id] && db.fields[id].type !== 'view');
  }

  /* No default flag: the list's order says it, the first view is the default,
     and a flag would be a second source that could disagree. */
  #viewOut(db, v) {
    const out = { id: v.id, name: v.name };
    out.fields = v.fields.map((id) => viewEntryName(db, id)).filter(Boolean);
    if (v.filters) out.filters = structuredClone(v.filters);
    if (v.sort) out.sort = structuredClone(v.sort);
    // Feature #233: column widths by name (a hidden field keeps its width)
    // and how many leading fields stay frozen beside #. Absent when unset.
    const widths = {};
    for (const [id, px] of Object.entries(v.widths ?? {})) { const n = viewEntryName(db, id); if (n) widths[n] = px; }
    if (Object.keys(widths).length) out.widths = widths;
    if (v.frozen) out.frozen = v.frozen;
    // Feature #239: Comfortable is the default and reads as absent.
    if (v.density) out.density = v.density;
    // Issue #442: deleted rows and the Σ row are the view's. Absent is the
    // default: no trash, and the Σ row as the table's older opt-in says.
    if (v.deleted) out.deleted = true;
    if (typeof v.rollups === 'boolean') out.rollups = v.rollups;
    return out;
  }

  #checkViewName(db, name, self = null) {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n) throw new WeaveError('A view needs a name', 'invalid');
    refuseReserved('view', n);
    if (n.includes('/')) throw new WeaveError(`A view name cannot hold '/' — it separates the table from the view: '${n}'`, 'invalid');
    if (n.toLowerCase() === 'blank') throw new WeaveError("'Blank' is reserved: 'Table/blank' reads the raw table", 'invalid');
    const clash = db.tableViews.find((v) => v !== self && v.name.toLowerCase() === n.toLowerCase());
    if (clash) throw new WeaveError(`${this.qualifiedName(db)} already has a view named '${clash.name}'`, 'conflict');
    return n;
  }

  /* The one write path: the verb, the legacy table keys, the registry row
     and the UI all land here. Everything is checked on a copy and committed
     at the end, so a refused write leaves the view (or its absence) as it
     was. */
  #writeView(db, name, patch) {
    const KNOWN = ['name', 'fields', 'show', 'hide', 'move', 'filters', 'sort', 'default', 'position', 'from', 'delete', 'widths', 'frozen', 'density', 'deleted', 'rollups'];
    const unknown = Object.keys(patch).filter((k) => patch[k] !== undefined && !KNOWN.includes(k));
    if (unknown.length) throw new WeaveError(`Unknown view key${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} — a view takes ${KNOWN.join(', ')}`, 'invalid');
    const views = db.tableViews;
    let i = this.#viewIndex(db, name);
    if (patch.delete) {
      if (i < 0) throw this.#noView(db, name);
      if (views.length === 1) {
        throw new WeaveError(`'${views[i].name}' is the only view of ${this.qualifiedName(db)}, and a table keeps at least one view — make another first (a new name with no from starts from every field, no filter, no sort)`, 'invalid');
      }
      const [gone] = views.splice(i, 1);
      this.#dropSysRow('views', gone.id);
      this.save();
      this.#syncTableRow(db);
      this.#audit('table-view-deleted', { table: this.qualifiedName(db), name: gone.name });
      return { name: gone.name, deleted: true };
    }
    let next;
    if (i < 0) {
      const from = patch.from == null || String(patch.from).toLowerCase() === 'blank' ? null : this.#viewIndex(db, patch.from);
      if (from != null && from < 0) throw this.#noView(db, patch.from);
      next = from == null ? { fields: this.#blankFields(db) } : structuredClone(views[from]);
      next.id = uuid();
      next.name = this.#checkViewName(db, name);
    } else {
      if (patch.from != null) throw new WeaveError(`${this.qualifiedName(db)} already has a view named '${views[i].name}' — from copies into a new name`, 'conflict');
      next = structuredClone(views[i]);
    }
    const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
    // A field by name or id, or a system column by name (Issue #418).
    const fid = (ref) => {
      const sys = typeof ref === 'string' && !this.findField(db, ref) ? GRID_SYSTEM_COLUMNS.find((n) => n.toLowerCase() === ref.trim().toLowerCase()) : null;
      return sys ? sysColumnId(sys) : this.getField(db.id, ref).id;
    };
    if (patch.name != null && i >= 0) next.name = this.#checkViewName(db, patch.name, views[i]);
    if (patch.fields != null) {
      if (!Array.isArray(patch.fields)) throw new WeaveError('fields is the list of visible field names, in column order', 'invalid');
      const ids = patch.fields.map(fid);
      if (new Set(ids).size !== ids.length) throw new WeaveError('fields names each field once', 'invalid');
      next.fields = ids;
      for (const id of ids) if (next.parked) delete next.parked[id];
    }
    /* A hidden field keeps its place (Feature #233, Kyle's rule 2): hide
       notes the field it followed and whether it was frozen, and show puts
       it back there — the schema position is the fallback when that
       neighbour is gone. The zone keeps its other members either way. */
    for (const n of list(patch.hide)) {
      const id = fid(n);
      const k = next.fields.indexOf(id);
      if (k < 0) continue;
      const fz = next.frozen ?? 0;
      (next.parked ??= {})[id] = { after: k > 0 ? next.fields[k - 1] : '', frozen: k < fz };
      next.fields.splice(k, 1);
      if (k < fz) next.frozen = fz - 1;
    }
    for (const n of list(patch.show)) {
      const id = fid(n);
      if (next.fields.includes(id)) continue;
      const p = next.parked?.[id];
      if (next.parked) delete next.parked[id];
      const fz = next.frozen ?? 0;
      let at = p && (p.after === '' || next.fields.includes(p.after)) ? (p.after === '' ? 0 : next.fields.indexOf(p.after) + 1) : null;
      // A system column shown for the first time closes the list.
      if (at == null && sysColumnName(id)) at = next.fields.length;
      if (at == null) { showBySchema(db, next.fields, id); at = next.fields.indexOf(id); next.fields.splice(at, 1); }
      if (p?.frozen) { at = Math.min(at, fz); next.frozen = fz + 1; } else at = Math.max(at, fz);
      next.fields.splice(at, 0, id);
    }
    for (const m of list(patch.move)) {
      if (!m || typeof m !== 'object' || m.field == null || (m.before == null) === (m.after == null)) {
        throw new WeaveError('move is {field, before: <field>} or {field, after: <field>}', 'invalid');
      }
      const id = fid(m.field);
      const anchor = fid(m.before ?? m.after);
      if (!next.fields.includes(anchor)) throw new WeaveError(`'${m.before ?? m.after}' is hidden in this view — move beside a field that shows, or show it first`, 'invalid');
      if (id === anchor) continue;
      next.fields = next.fields.filter((x) => x !== id);
      const k = next.fields.indexOf(anchor);
      next.fields.splice(m.before != null ? k : k + 1, 0, id);
      if (next.parked) delete next.parked[id];
    }
    if (patch.widths != null) {
      if (typeof patch.widths !== 'object' || Array.isArray(patch.widths)) throw new WeaveError('widths is an object of { fieldName: pixels } — null clears one', 'invalid');
      const widths = { ...(next.widths ?? {}) };
      for (const [n, px] of Object.entries(patch.widths)) {
        const id = fid(n);
        if (px === null) { delete widths[id]; continue; }
        if (typeof px !== 'number' || !Number.isFinite(px) || px < VIEW_MIN_WIDTH || px > VIEW_MAX_WIDTH) {
          throw new WeaveError(`A column width is a number of pixels from ${VIEW_MIN_WIDTH} to ${VIEW_MAX_WIDTH} — got ${JSON.stringify(px)} for '${n}'`, 'invalid');
        }
        widths[id] = Math.round(px);
      }
      if (Object.keys(widths).length) next.widths = widths; else delete next.widths;
    }
    if (patch.frozen != null) {
      if (!Number.isInteger(patch.frozen) || patch.frozen < 0) throw new WeaveError('frozen is a whole number: how many of the leading fields stay frozen beside # (0 — only #)', 'invalid');
      if (patch.frozen > next.fields.length) throw new WeaveError(`frozen is at most the ${next.fields.length} fields this view shows`, 'invalid');
      next.frozen = patch.frozen;
    }
    if (patch.density != null) {
      const d = typeof patch.density === 'string' ? patch.density.trim().toLowerCase() : '';
      if (!VIEW_DENSITIES.includes(d)) throw new WeaveError(`density is compact, comfortable or spacious — got ${JSON.stringify(patch.density)}`, 'invalid');
      if (d === 'comfortable') delete next.density; else next.density = d;
    }
    if (patch.deleted != null) {
      if (typeof patch.deleted !== 'boolean') throw new WeaveError(`deleted is true or false: whether the view shows its deleted rows. Got ${JSON.stringify(patch.deleted)}`, 'invalid');
      if (patch.deleted) next.deleted = true; else delete next.deleted;
    }
    if (patch.rollups !== undefined) {
      if (patch.rollups !== null && typeof patch.rollups !== 'boolean') throw new WeaveError(`rollups is true, false or null: whether the view draws the Σ row (null follows the table). Got ${JSON.stringify(patch.rollups)}`, 'invalid');
      if (patch.rollups === null) delete next.rollups; else next.rollups = patch.rollups;
    }
    if ((next.frozen ?? 0) > next.fields.length) next.frozen = next.fields.length;
    if (!next.frozen) delete next.frozen;
    if (next.parked && !Object.keys(next.parked).length) delete next.parked;
    if (patch.filters != null) { const f = this.#checkFilters(db, patch.filters); if (f) next.filters = f; else delete next.filters; }
    if (patch.sort != null) { const s = this.#checkSort(db, patch.sort); if (s) next.sort = s; else delete next.sort; }
    if (patch.default === false && i === 0) throw new WeaveError(`'${next.name}' is the default because it is first — move another view to position 0 instead`, 'invalid');
    if (patch.position != null && !(Number.isInteger(patch.position) && patch.position >= 0)) {
      throw new WeaveError('position is a whole number: 0 is the first place in the strip (the default)', 'invalid');
    }
    // Commit.
    const created = i < 0;
    if (created) { views.push(next); i = views.length - 1; } else views[i] = next;
    const to = patch.default === true ? 0 : patch.position != null ? Math.min(patch.position, views.length - 1) : i;
    if (to !== i) { views.splice(i, 1); views.splice(to, 0, next); i = to; }
    this.save();
    this.#syncTableRow(db);
    this.#audit(created ? 'table-view-created' : 'table-view-updated', { table: this.qualifiedName(db), name: next.name });
    return { ...this.#viewOut(db, next), ...(created ? { created: true } : {}) };
  }

  /* updateTable's filters / sort / hiddenFields, spoken to the default view
     (the leftmost; a table always has one, and a legacy table gets its
     Standard from #ensureTableViews). */
  #writeDefaultView(db, { filters, sort, hiddenFields }) {
    this.#ensureTableViews(db);
    const cur = db.tableViews[0];
    const patch = {};
    if (filters != null) patch.filters = filters;
    if (sort != null) patch.sort = sort;
    if (hiddenFields != null) {
      if (!Array.isArray(hiddenFields)) throw new WeaveError('hiddenFields is a list of field names', 'invalid');
      // The system columns ride systemFields; naming one here is harmless.
      const system = ['Created At', 'Modified At', 'Created By', 'Modified By', 'Activity'];
      const hide = new Set();
      for (const n of hiddenFields) {
        if (system.includes(n)) continue;
        const f = this.findField(db, n);
        if (!f) throw new WeaveError(`'${n}' is not a field of ${db.name}`, 'invalid');
        hide.add(f.id);
      }
      const shown = new Set(cur?.fields ?? []);
      patch.hide = [...shown].filter((id) => hide.has(id));
      patch.show = db.fieldOrder.filter((id) => !hide.has(id) && !shown.has(id));
    }
    return this.#writeView(db, cur?.name ?? 'Standard', patch);
  }

  #checkFilters(db, filters) {
    if (typeof filters !== 'object' || Array.isArray(filters)) {
      throw new WeaveError('filters is an object of { fieldName: [stateOrOptionNames] }', 'invalid');
    }
    const out = {};
    for (const [fname, states] of Object.entries(filters)) {
      const f = this.findField(db, fname);
      // A toggle's two labels are its states (Feature #202); a select's and a
      // multi-select's options filter the same way (Issue #319).
      if (!f || !['workflow', 'toggle', 'select', 'multiselect'].includes(f.type)) throw new WeaveError(`'${fname}' is not a workflow, toggle, single-select or multi-select field of ${db.name}`, 'invalid');
      if (!Array.isArray(states)) throw new WeaveError(`The filter on '${fname}' is a list of ${f.type.endsWith('select') ? 'option' : 'state'} names`, 'invalid');
      const names = f.type === 'toggle' ? [f.config.on, f.config.off] : f.type.endsWith('select') ? (f.config.options ?? []).map((o) => o.name) : f.config.states.map((st) => st.name);
      for (const s of states) {
        if (!names.includes(s)) throw new WeaveError(`'${s}' is not ${f.type.endsWith('select') ? 'an option' : 'a state'} of ${db.name}.${f.name}`, 'invalid');
      }
      if (states.length) out[f.name] = [...states];
    }
    return Object.keys(out).length ? out : null;
  }

  #checkSort(db, sort) {
    if (!Array.isArray(sort)) throw new WeaveError('sort is a list of { field, dir }', 'invalid');
    const out = sort.map((s) => {
      // The table's own fields first, so a field an import named
      // `Created At` keeps its column; then the system columns (Issue #254).
      const f = this.findField(db, s.field);
      if (!f && !Object.hasOwn(SYSTEM_SORT_KEYS, s.field)) {
        throw new WeaveError(`Field '${s.field}' not found in table '${db.name}'. ${SORT_FORM}, e.g. 'Date desc'`, 'not-found');
      }
      const name = f ? f.name : s.field;
      const dir = s.dir ?? 'asc';
      if (!['asc', 'desc'].includes(dir)) throw new WeaveError(`Sort direction is asc or desc, got '${s.dir}'`, 'invalid');
      return { field: name, dir };
    });
    return out.length ? out : null;
  }

  /* What the default view shows, in the table-level spelling older readers
     (the entity page, the Tables row, describeSchema) still speak. */
  #defaultViewConfig(db) {
    const v = db.tableViews?.[0];
    if (!v) return {};
    const shown = new Set(v.fields);
    const hidden = db.fieldOrder.filter((id) => db.fields[id] && !shown.has(id)).map((id) => db.fields[id].name);
    return {
      ...(hidden.length ? { hiddenFields: hidden } : {}),
      ...(v.filters ? { filters: v.filters } : {}),
      ...(v.sort ? { sort: v.sort } : {}),
    };
  }

  // ---------------- schema as a document (Feature #13) ----------------
  /* describeSchema() is the read half; this is the write half. Hand back an
     edited copy of that JSON and the workspace grows to match. Additive by
     design: creations and config updates apply freely; an omission is a
     deletion and needs allowDestructive; a type change is never applied —
     the document cannot mean that, delete and recreate is the honest
     spelling. Names are identity here, so renames belong to the registry
     rows (#12/#52), not this surface. System spaces/tables are not the
     document's business in either direction. */
  /* `partial` (Feature #261): the document names only the spaces it touches,
     so the sweeps that read an omission as a deletion (spaces, and the space
     rollups on Workspace/Spaces) leave the rest of the workspace alone. A
     named space is still described whole. */
  applySchema(doc, { dryRun = false, allowDestructive = false, partial = false } = {}) {
    if (!Array.isArray(doc)) throw new WeaveError('A schema document is the array describeSchema() returns', 'invalid');
    const plan = [];
    const act = (action, subject, fn) => {
      plan.push({ action, subject });
      if (!dryRun) fn();
    };
    /* A descriptor carries everything describeSchema() emits, including the
       half that decides how the table READS — option colors, column widths,
       number and date costumes, document kind, state icons. Applying used to
       rebuild the config from four keys, so any edit to a document stripped
       the rest (Issue #59). The config is merged over what the field already
       has: a key the document does not mention keeps its value, while options
       and states are replacements, because dropping one is the point. */
    const configFromDescriptor = (f, existing = null) => {
      const config = existing ? { ...existing.config } : {};
      if (f.options) {
        // Colors ride optionsFull; a name that survives an edit to `options`
        // alone keeps the color it already had.
        const named = new Map((f.optionsFull ?? []).map((o) => [o.name, o.color ?? '']));
        const kept = new Map((existing?.config.options ?? []).map((o) => [o.name, o.color ?? '']));
        // An option's icon rides optionsFull too (Feature #261: a template's
        // status options arrived without theirs); a document that does not
        // say keeps the icon the option already had.
        const icons = new Map([
          ...(existing?.config.options ?? []).map((o) => [o.name, o.icon ?? '']),
          ...(f.optionsFull ?? []).filter((o) => 'icon' in o).map((o) => [o.name, o.icon ?? '']),
        ]);
        // named/kept hold the colour an option already had, keyed by name.
        config.options = f.options.map((name) => normaliseOption(
          { name, color: named.get(name) ?? kept.get(name) ?? '', icon: icons.get(name) ?? '' },
          /* A colour the document names is refused when weave cannot name it.
             One the field already stored is read as it has always been read,
             including when the document carries it back unchanged, so a
             round-trip of describeSchema() never refuses the workspace it
             came from (Issue #551). */
          { strict: named.has(name) && named.get(name) !== kept.get(name) },
        ));
      }
      if (f.states) config.states = f.states;
      if (f.expression) config.expression = f.expression;
      if (f.via) config.relationField = f.via;
      if (f.viaTable) config.via = f.viaTable;
      if (f.where) config.where = f.where;
      if (f.targetField) config.targetField = f.targetField;
      if (f.aggregate) config.aggregate = f.aggregate;
      if (f.default !== undefined) config.default = f.default;
      if (f.types) config.types = f.types;
      if (f.depth != null) config.depth = f.depth;
      if (f.width != null) config.width = f.width;
      if (f.type !== 'view' && f.description != null) config.description = f.description;
      for (const k of FORMULA_COSTUME_KEYS) if (f[k] != null) config[k] = f[k];
      for (const k of DATE_COSTUME_KEYS) if (k !== 'format' && f[k] != null) config[k] = f[k];
      if (f.kind != null) config.kind = f.kind;
      if (f.multiple != null) config.multiple = f.multiple;
      if (f.term != null) config.term = f.term;
      if (f.type === 'rating') { if (f.max != null) config.max = f.max; if (f.icon != null) config.icon = f.icon; if (f.color != null) config.color = f.color; }
      if (f.type === 'view') {
        for (const k of ['link', 'state', 'description']) if (f[k] !== undefined) config[k] = f[k];
        if (f.fields !== undefined) config.fields = f.fields;
      }
      return config;
    };
    /* The apply is a no-op exactly when the document already describes the
       workspace, so the comparison is descriptor against descriptor — never
       config against config, where a relation field is an id on one side and a
       name on the other. */
    const DESCRIPTOR_KEYS = ['options', 'states', 'expression', 'via', 'viaTable', 'where', 'targetField', 'aggregate',
      'default', 'width', 'format', 'unit', 'currency', 'decimals', 'separator', 'accounting', 'display', 'scale', 'style', 'time', 'kind', 'multiple', 'types', 'depth',
      'grain', 'clock', 'zone', 'zoneName', 'pad', 'elapsed', 'term', 'link', 'state', 'description', 'fields', 'max', 'icon'];
    const colorsOf = (full) => JSON.stringify((full ?? []).map((o) => ({ name: o.name, color: o.color ?? '' })));
    const fieldChanged = (fDoc, have) => {
      if (!have) return true;
      if (fDoc.optionsFull && colorsOf(fDoc.optionsFull) !== colorsOf(have.optionsFull)) return true;
      if (fDoc.optionsFull) {
        const had = new Map((have.optionsFull ?? []).map((o) => [o.name, o.icon ?? '']));
        if (fDoc.optionsFull.some((o) => 'icon' in o && (o.icon ?? '') !== (had.get(o.name) ?? ''))) return true;
      }
      return DESCRIPTOR_KEYS.some((k) => k in fDoc && JSON.stringify(fDoc[k]) !== JSON.stringify(have[k]));
    };
    const current = new Map();
    for (const sp of this.describeSchema()) {
      for (const t of sp.tables) current.set(`${sp.space}/${t.name}`, t);
    }
    const wanted = doc.filter((sp) => !sp.system);
    /* A relation's cardinality is both ends: this descriptor's `many` and its
       inverse's, found on the target table's descriptor in the same document.
       Without the inverse, the older reading (`many` alone) stands. */
    const docTable = (q) => {
      const cut = String(q ?? '').lastIndexOf('/');
      return doc.find((sp) => sp.space === String(q).slice(0, cut))?.tables?.find((t) => t.name === String(q).slice(cut + 1));
    };
    const cardinalityOf = (fDoc) => {
      const inv = fDoc.inverseField != null ? docTable(fDoc.targetDb)?.fields?.find((x) => x.name === fDoc.inverseField) : null;
      if (!inv) return fDoc.many ? 'one-to-many' : 'many-to-one';
      return ({ 'true,true': 'many-to-many', 'true,false': 'one-to-many', 'false,true': 'many-to-one', 'false,false': 'one-to-one' })[`${!!fDoc.many},${!!inv.many}`];
    };
    const relationArgs = (fDoc) => ({
      name: fDoc.name,
      ...(Array.isArray(fDoc.targetDbs) ? { targetDbs: fDoc.targetDbs } : { targetDb: fDoc.targetDb }),
      cardinality: cardinalityOf(fDoc),
      inverseName: fDoc.inverseField ?? undefined,
    });
    /* A table this apply creates gets its plain fields at once and its
       relations, lookups, rollups and formulas once every table in the
       document exists (Feature #261): a relation names a table the document
       may list later, a rollup crosses an inverse that relation mints, and a
       formula may read either. Its costume (order, views) goes on last. */
    const DEFERRED = new Set(['relation', 'lookup', 'rollup', 'formula']);
    const created = [];

    for (const spDoc of wanted) {
      let sp = this.findSpace(spDoc.space);
      if (!sp) {
        act('create-space', spDoc.space, () => {
          sp = this.createSpace({ name: spDoc.space, description: spDoc.description ?? '', template: spDoc.template === true });
          if (spDoc.icon) this.updateSpace(sp.id, { icon: spDoc.icon });
        });
        if (dryRun) continue;
      } else {
        const patch = {};
        if (spDoc.description != null && spDoc.description !== (sp.description ?? '')) patch.description = spDoc.description;
        if (spDoc.icon != null && spDoc.icon !== (sp.icon ?? '')) patch.icon = spDoc.icon;
        if (spDoc.template != null && !!spDoc.template !== !!sp.template) patch.template = !!spDoc.template;
        if (Object.keys(patch).length) act('update-space', spDoc.space, () => this.updateSpace(sp.id, patch));
      }
      for (const tDoc of spDoc.tables ?? []) {
        const qualified = `${spDoc.space}/${tDoc.name}`;
        let db = this.findTable(qualified);
        if (db?.system) continue;
        if (!db) {
          act('create-table', qualified, () => this.#withoutFieldLog(() => {
            db = this.createTable({ space: spDoc.space, name: tDoc.name, description: tDoc.description ?? '', icon: tDoc.icon ?? '' });
            /* createTable already minted Name and a description. Match the
               descriptor that claims the description ROLE — falling back to
               one literally named 'Description' for schema documents written
               before roles — and RENAME the minted field to it. Matching on
               the literal name alone used to leave a renamed description
               ('Notes') beside a spurious second 'Description'. When no
               descriptor claims the role the source table had none, so the
               minted field goes, tombstone and all. */
            const described = (tDoc.fields ?? []).find((f) => f.role === 'description')
              ?? (tDoc.fields ?? []).find((f) => f.type === 'document' && f.name === 'Description');
            if (described) {
              if (described.name !== 'Description') this.updateField(db.id, db.descriptionFieldId, { name: described.name });
              const cfg = configFromDescriptor(described);
              if (cfg && Object.keys(cfg).length) this.updateField(db.id, db.descriptionFieldId, { config: cfg });
            } else {
              this.deleteField(db.id, db.descriptionFieldId);
            }
            const named = (tDoc.fields ?? []).find((f) => f.role === 'name') ?? (tDoc.fields ?? []).find((f) => f.name === 'Name');
            if (named) {
              if (named.name !== 'Name') this.updateField(db.id, db.nameFieldId, { name: named.name });
            }
            for (const f of tDoc.fields ?? []) {
              if (f === named || f === described) continue;
              if (DEFERRED.has(f.type)) continue;
              if (f.type === 'view') {
                // Renamed now; configured once the fields it shows exist.
                const minted = this.viewField(db, f.role ?? f.shape);
                if (minted && f.name !== minted.name) this.updateField(db.id, minted.id, { name: f.name });
                continue;
              }
              this.addField(db.id, { name: f.name, type: f.type, config: configFromDescriptor(f) });
            }
          }));
          if (!dryRun) created.push({ db, tDoc, named: (tDoc.fields ?? []).find((f) => f.role === 'name') ?? (tDoc.fields ?? []).find((f) => f.name === 'Name') });
          continue;
        }
        const tPatch = {};
        if (tDoc.description != null && tDoc.description !== (db.description ?? '')) tPatch.description = tDoc.description;
        if (tDoc.icon != null && tDoc.icon !== (db.icon ?? '')) tPatch.icon = tDoc.icon;
        if (tDoc.noun != null && tDoc.noun !== (this.termOf(db).set ? this.termOf(db).singular : '')) tPatch.noun = tDoc.noun;
        // A document that carries `views` says everything about them; an older
        // one speaks for the default view through the table-level keys.
        const dv = this.#defaultViewConfig(db);
        if (!tDoc.views) {
          if ('hiddenFields' in tDoc && JSON.stringify(tDoc.hiddenFields ?? []) !== JSON.stringify(dv.hiddenFields ?? [])) {
            tPatch.hiddenFields = tDoc.hiddenFields ?? [];
          }
          if ('filters' in tDoc && JSON.stringify(tDoc.filters ?? {}) !== JSON.stringify(dv.filters ?? {})) {
            tPatch.filters = tDoc.filters ?? {};
          }
          if ('sort' in tDoc && JSON.stringify(tDoc.sort ?? []) !== JSON.stringify(dv.sort ?? [])) {
            tPatch.sort = tDoc.sort ?? [];
          }
        }
        if ('systemFields' in tDoc && JSON.stringify(tDoc.systemFields ?? []) !== JSON.stringify(db.systemFields ?? [])) {
          tPatch.systemFields = tDoc.systemFields ?? [];
        }
        // Absent is hidden on both sides (Issue #249), so compare what each
        // one shows, not what each one stores.
        if ('hideRollups' in tDoc && (tDoc.hideRollups !== false) !== (db.hideRollups !== false)) tPatch.hideRollups = !!tDoc.hideRollups;
        if (Object.keys(tPatch).length) act('update-table', qualified, () => this.updateTable(db.id, tPatch));
        let nameTypeChange = null;
        const createdHere = new Set();
        for (const fDoc of tDoc.fields ?? []) {
          let existing = Object.values(db.fields).find((x) => x.name === fDoc.name);
          // The name role matches by role, so a renamed Name is a rename here
          // rather than a second column (Feature #168).
          if (!existing && fDoc.role === 'name') {
            existing = db.fields[db.nameFieldId];
            act('update-field', `${qualified}.${fDoc.name}`, () => this.updateField(db.id, db.nameFieldId, { name: fDoc.name }));
          }
          if (!existing && fDoc.type === 'view' && VIEW_SHAPES.includes(fDoc.role ?? fDoc.shape)) {
            existing = this.viewField(db, fDoc.role ?? fDoc.shape);
            if (existing) act('update-field', `${qualified}.${fDoc.name}`, () => this.updateField(db.id, existing.id, { name: fDoc.name }));
          }
          if (existing && existing.id === db.nameFieldId && fDoc.type && fDoc.type !== existing.type && ['text', 'formula'].includes(fDoc.type)) {
            // Deferred past the loop: a computed Name may read a field created below (Issue #288).
            nameTypeChange = () => act('update-field', `${qualified}.${fDoc.name}`, () => this.updateField(db.id, db.nameFieldId, { type: fDoc.type, config: configFromDescriptor(fDoc, existing) }));
            continue;
          }
          if (!existing) {
            createdHere.add(fDoc.name);
            if (fDoc.type === 'relation') {
              act('create-relation', `${qualified}.${fDoc.name}`, () => this.addRelation(db.id, relationArgs(fDoc)));
            } else {
              act('create-field', `${qualified}.${fDoc.name}`, () => this.addField(db.id, { name: fDoc.name, type: fDoc.type, config: configFromDescriptor(fDoc) }));
            }
            continue;
          }
          if (existing.type !== fDoc.type) {
            throw new WeaveError(`'${qualified}.${fDoc.name}' cannot change type ('${existing.type}' → '${fDoc.type}') — delete the field and create it anew`, 'invalid');
          }
          const nextCfg = configFromDescriptor(fDoc, existing);
          const have = current.get(qualified)?.fields.find((x) => x.name === fDoc.name);
          if (fieldChanged(fDoc, have)) {
            act('update-field', `${qualified}.${fDoc.name}`, () => this.updateField(db.id, existing.id, { config: nextCfg }));
          }
        }
        nameTypeChange?.();
        // Omitted fields are deletions.
        for (const existing of Object.values(db.fields)) {
          if (existing.system || existing.id === db.nameFieldId) continue;
          if (existing.type === 'relation' && existing.inverseOf) continue;
          const still = (tDoc.fields ?? []).some((f) => f.name === existing.name);
          if (!still) {
            if (!allowDestructive) throw new WeaveError(`Applying this document would delete '${qualified}.${existing.name}' — a destructive change needs allowDestructive`, 'invalid');
            act('delete-field', `${qualified}.${existing.name}`, () => this.deleteField(db.id, existing.id));
          }
        }
        // Column order is the order the document lists its fields in — read
        // after the creates and deletes, so it is an order over what exists.
        if (!dryRun && (tDoc.fields ?? []).length) {
          const wanted = [];
          for (const fDoc of tDoc.fields) {
            const f = Object.values(db.fields).find((x) => x.name === fDoc.name);
            if (f && !wanted.includes(f.id)) wanted.push(f.id);
          }
          for (const id of db.fieldOrder) if (!wanted.includes(id)) wanted.push(id);
          // The views close the order wherever a document happened to list
          // them, so a field appended after them is not a reorder.
          const views = wanted.filter((id) => db.fields[id]?.type === 'view');
          const ordered = [...wanted.filter((id) => !views.includes(id)), ...views];
          wanted.splice(0, wanted.length, ...ordered);
          if (wanted.length === db.fieldOrder.length && JSON.stringify(wanted) !== JSON.stringify(db.fieldOrder)) {
            act('reorder-fields', qualified, () => this.updateTable(db.id, { fieldOrder: wanted }));
          }
        }
        // Views last: they name fields the steps above may have created.
        if (Array.isArray(tDoc.views)) {
          this.#applyViews(db, tDoc.views, act, allowDestructive, createdHere);
          const legacy = this.#legacyEdits(db, tDoc, createdHere);
          if (Object.keys(legacy).length) act('update-table', qualified, () => this.updateTable(db.id, legacy));
        }
        const body = this.#bodyOrderFrom(db, tDoc);
        if (body) act('update-table', qualified, () => this.updateTable(db.id, { bodyOrder: body }));
      }
      // Omitted tables are deletions.
      if (sp && !dryRun || sp) {
        for (const db of this.listTables(sp?.id)) {
          if (db.system) continue;
          const still = (spDoc.tables ?? []).some((t) => t.name === db.name);
          if (!still) {
            if (!allowDestructive) throw new WeaveError(`Applying this document would delete table '${spDoc.space}/${db.name}' — a destructive change needs allowDestructive`, 'invalid');
            act('delete-table', `${spDoc.space}/${db.name}`, () => this.deleteTable(db.id));
          }
        }
      }
    }
    // The created tables' deferred fields, in passes until none is left: a
    // rollup may read a formula and a formula a lookup, so no single order
    // fits every document. A pass that makes nothing throws what it hit.
    if (created.length) {
      this.#withoutFieldLog(() => {
        for (const { db, tDoc } of created) {
          for (const f of tDoc.fields ?? []) {
            if (f.type !== 'relation') continue;
            // The far end of a relation made earlier in this pass is its inverse.
            const field = this.findField(db, f.name) ?? this.addRelation(db.id, relationArgs(f)).field;
            const cfg = {};
            if (f.width != null) cfg.width = f.width;
            if (f.description != null) cfg.description = f.description;
            if (Object.keys(cfg).length) this.updateField(db.id, field.id, { config: { ...field.config, ...cfg } });
          }
        }
        let pending = created.flatMap(({ db, tDoc, named }) => (tDoc.fields ?? [])
          .filter((f) => f !== named && ['lookup', 'rollup', 'formula'].includes(f.type) && !this.findField(db, f.name))
          .map((f) => ({ db, f })));
        while (pending.length) {
          const left = [];
          let last = null;
          for (const p of pending) {
            try { this.addField(p.db.id, { name: p.f.name, type: p.f.type, config: configFromDescriptor(p.f) }); } catch (err) { left.push(p); last = err; }
          }
          if (left.length === pending.length) throw last;
          pending = left;
        }
        for (const { db, named } of created) {
          // A computed Name reads fields made above, and the type change
          // checks every name it reads (Issue #288), so it goes last.
          if (named?.type === 'formula') this.updateField(db.id, db.nameFieldId, { type: 'formula', config: configFromDescriptor(named) });
        }
        for (const { db, tDoc } of created) {
          for (const f of tDoc.fields ?? []) {
            if (f.type !== 'view') continue;
            const minted = this.findField(db, f.name);
            if (minted?.type !== 'view') continue;
            const cfg = configFromDescriptor(f);
            delete cfg.shape;
            if (Object.keys(cfg).length) this.updateField(db.id, minted.id, { config: cfg });
          }
          this.#applyTableCostume(db, tDoc);
        }
      });
    }
    /* Space rollups live on the Workspace/Spaces registry row, the one system
       table a document may add fields to. Applied after every user table
       exists, since each names one. Computed config has no verb to change
       it: a differing descriptor is a delete and a create. The row lives on
       the hub root when this workspace is a member, so the writes go there,
       naming the table by id: the root cannot resolve a member's names. */
    const spacesT = this.#sysTable('spaces');
    const reg = this.#reg;
    const spacesDoc = doc.find((sp) => sp.system === 'workspace')?.tables?.find((t) => t.system === 'spaces');
    if (spacesT && spacesDoc) {
      const wantedRollups = (spacesDoc.fields ?? []).filter((f) => f.type === 'rollup' && f.viaTable);
      const cfgOf = (f) => ({ via: this.findTable(f.viaTable)?.id ?? f.viaTable, targetField: f.targetField, aggregate: f.aggregate, ...(f.where ? { where: f.where } : {}) });
      const regSpaces = reg === this ? current.get('Workspace/Spaces') : reg.describeSchema().find((sp) => sp.system === 'workspace')?.tables.find((t) => t.system === 'spaces');
      for (const fDoc of wantedRollups) {
        const existing = Object.values(spacesT.fields).find((x) => x.name === fDoc.name);
        const have = regSpaces?.fields.find((x) => x.name === fDoc.name);
        if (existing && !fieldChanged(fDoc, have)) continue;
        if (existing) act('delete-field', `Workspace/Spaces.${fDoc.name}`, () => reg.deleteField(spacesT.id, existing.id));
        act('create-field', `Workspace/Spaces.${fDoc.name}`, () => reg.addField(spacesT.id, { name: fDoc.name, type: 'rollup', config: cfgOf(fDoc) }));
      }
      for (const existing of partial ? [] : Object.values(spacesT.fields)) {
        if (existing.type !== 'rollup' || !existing.config.via) continue;
        if (wantedRollups.some((f) => f.name === existing.name)) continue;
        if (!allowDestructive) throw new WeaveError(`Applying this document would delete 'Workspace/Spaces.${existing.name}' — a destructive change needs allowDestructive`, 'invalid');
        act('delete-field', `Workspace/Spaces.${existing.name}`, () => this.deleteField(spacesT.id, existing.id));
      }
    }
    // Omitted spaces are deletions, unless the document is partial.
    for (const sp of partial ? [] : this.listSpaces()) {
      if (sp.system) continue;
      const still = wanted.some((d) => d.space === sp.name);
      if (!still) {
        if (!allowDestructive) throw new WeaveError(`Applying this document would delete space '${sp.name}' — a destructive change needs allowDestructive`, 'invalid');
        act('delete-space', sp.name, () => this.deleteSpace(sp.id));
      }
    }
    if (!dryRun && plan.length) this.#audit('schema-applied', { changes: plan.length });
    return plan;
  }

  // ---------------- templates (Feature #261) ----------------

  /* The live spaces marked as templates: what Use Template offers. */
  listTemplates() {
    return this.listSpaces().filter((sp) => sp.template && !sp.system);
  }

  /* Copy a space's schema, never its rows, into `target`, another workspace's
     engine (this one is allowed too, under a new name). The copy is the
     space's describeSchema() entry through templateDoc(), plus the
     Workspace/Spaces rollups that read its tables, applied as a partial
     document so the target's other spaces are left alone. A name the target
     already holds is refused before anything is written; an apply that fails
     part way takes the half-made space back out. */
  useTemplate(spaceRef, target, { name } = {}) {
    if (!(target instanceof Weave)) throw new WeaveError('useTemplate needs the target workspace', 'invalid');
    const sp = this.getSpace(spaceRef);
    if (sp.system) throw new WeaveError(`Space '${sp.name}' is the workspace's own system space and cannot be a template`, 'invalid');
    const as = String(name ?? sp.name).trim();
    if (!as) throw new WeaveError('A template copy needs a name', 'invalid');
    const where = target.state.meta.name || 'the target workspace';
    if (target.listSpaces().some((x) => x.name.toLowerCase() === as.toLowerCase())) {
      throw new WeaveError(`${where} already has a space named '${as}'`, 'conflict');
    }
    const entry = this.describeSchema().find((x) => x.spaceId === sp.id);
    // Space rollups live on the Spaces registry row, by table id.
    const mine = new Set(this.listTables(sp.id).map((t) => t.id));
    const rollups = [];
    for (const f of Object.values(this.#sysTable('spaces')?.fields ?? {})) {
      if (f.type !== 'rollup' || !mine.has(f.config.via)) continue;
      const via = this.state.tables[f.config.via];
      rollups.push({
        name: f.name, type: 'rollup', viaTable: this.qualifiedName(via), aggregate: f.config.aggregate,
        ...(f.config.targetField ? { targetField: via.fields[f.config.targetField]?.name } : {}),
        ...(f.config.where ? { where: structuredClone(f.config.where) } : {}),
      });
    }
    const { doc, rollups: carried, skipped } = templateDoc(entry, { name: as, rollups });
    // A rollup name the target's Spaces row already uses would be replaced,
    // so the copy's takes the new space's name; one still taken stays home.
    const theirs = target.#sysTable('spaces');
    const landing = [];
    for (const r of carried) {
      if (!theirs) { skipped.push({ table: 'Workspace/Spaces', field: r.name, viaTable: r.viaTable }); continue; }
      const taken = (n) => !!target.findField(theirs, n);
      const n = taken(r.name) ? `${r.name} (${as})` : r.name;
      if (taken(n)) { skipped.push({ table: 'Workspace/Spaces', field: r.name, viaTable: r.viaTable }); continue; }
      landing.push({ ...r, name: n });
    }
    const full = [doc, ...(landing.length ? [{ space: 'Workspace', system: 'workspace', tables: [{ name: 'Spaces', system: 'spaces', fields: landing }] }] : [])];
    let plan;
    try {
      plan = target.applySchema(full, { partial: true });
    } catch (err) {
      const half = target.listSpaces().find((x) => x.name === as);
      if (half) { try { target.deleteSpace(half.id, { hard: true }); } catch { /* the error below says what failed */ } }
      throw err;
    }
    const made = target.getSpace(as);
    target.#audit('space-from-template', { name: made.name, template: sp.name, from: this.state.meta.name ?? null });
    return { space: made, plan, skipped };
  }

  // ---------------- a workspace outline in one call (Feature #253) ----------------
  /* An agent standing up a five-table workspace spent 50 to 100 turns on it,
     one field, relation or row per call, and applySchema takes the 22 KB
     document describeSchema emits, which nobody writes by hand. build() takes
     the short spec an agent does write: spaces, tables, fields (each {name,
     type} plus that type's config keys, flat; a relation names its table in
     `to`), rows (values by field name; a relation value is the target row's
     name). Every step is a verb that already exists, so what is legal here is
     what createSpace, createTable, addField, addRelation, createEntity and
     updateEntity already allow.

     Order: the workspace name, spaces, tables, plain fields, relations,
     lookups and rollups, formulas, rows without their relation values, then
     the relation values, so a row links by name to a row made in the same
     build. A space, table or same-typed field that exists is reused and named
     in `existing`, so resending a whole spec after an error is safe; rows
     append, so a spec of rows alone is a batch create, and skipExistingRows
     skips a row whose Name the table already holds.

     A refused cosmetic setting (an icon outside the inventory, an option
     colour weave cannot name) is dropped and reported in `ignored` with the
     engine's reason, never allowed to block what wears it: on the second
     2026-10-02 eval one refused table icon left the table uncreated and
     failed 42 fields, 20 relations and 96 rows aimed at it. For the same
     reason a step that only fails because an earlier one did (a lookup over
     a relation that failed, a row value for a field that failed) is skipped,
     not charged a second error.

     No transaction spans several verbs. The spec runs first, whole, on a
     throwaway in-memory copy of this workspace, carrying on past each failure
     so every error comes back at once with its path. Only a clean trial runs
     for real; dryRun stops after the trial. */
  build(spec, { dryRun = false, skipExistingRows = false } = {}) {
    const trial = this.#buildCopy().#buildRun(spec, { keepGoing: true, skipExistingRows });
    if (dryRun || trial.errors.length) return { ok: !trial.errors.length, ...(dryRun ? { dryRun: true } : {}), ...trial };
    // ponytail: the trial is the validation. A real run that still fails halfway
    // returns what landed plus the error; a rollback needs a store transaction
    // around many verbs, which the engine does not have.
    const run = this.#buildRun(spec, { keepGoing: false, skipExistingRows });
    return { ok: !run.errors.length, ...run };
  }

  /* The same state in memory: no file, no registry host to write through,
     and no webhooks, since a trial row must not call out. */
  #buildCopy() {
    const state = structuredClone(this.state);
    for (const a of Object.values(state.automations ?? {})) a.actions = (a.actions ?? []).filter((x) => x.type !== 'webhook');
    const store = new Store(null);
    store.load = () => state;
    const copy = new Weave({ store, actor: this.actor, keystorePath: this.keystorePath, keystoreEnv: this.keystoreEnv });
    // The rules are Workflows rows now (Feature #249), cloned with the rest.
    copy.#noWebhooks = true;
    return copy;
  }

  #buildRun(spec, { keepGoing, skipExistingRows }) {
    const created = { spaces: 0, tables: 0, fields: 0, relations: 0, rows: 0 };
    const existing = [];
    const ignored = [];
    const errors = [];
    let halted = false;
    const fail = (path, err) => {
      if (halted) return;
      errors.push({ path, error: err.message });
      if (!keepGoing) halted = true;
    };
    const step = (path, fn) => {
      if (halted) return undefined;
      try { return fn(); } catch (err) { fail(path, err); return undefined; }
    };
    const extra = (path, obj, keys) => {
      const left = Object.keys(obj).filter((k) => !keys.includes(k));
      if (left.length) ignored.push({ path, keys: left });
    };
    const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
    // The holder without `key` when the check refuses its value, reported.
    const cosmetic = (path, holder, key, check) => {
      if (!isObj(holder) || holder[key] == null || holder[key] === '') return holder;
      try { check(holder[key]); return holder; } catch (err) {
        const { [key]: _dropped, ...rest } = holder;
        ignored.push({ path, keys: [key], reason: err.message });
        return rest;
      }
    };
    const listAt = (path, v) => {
      if (v == null) return [];
      if (Array.isArray(v)) return v;
      fail(path, new WeaveError(`'${path}' must be a list`, 'invalid'));
      return [];
    };
    // The computed fields this build made, sampled at the end (Issue #627).
    const computedMade = [];
    let computed = null;
    const result = () => ({ created, existing, ignored, errors, ...(computed ? { computed } : {}) });
    if (!isObj(spec)) {
      fail('', new WeaveError('A build spec is an object: {workspace?, spaces: [{name, tables: [{name, fields, rows}]}]}', 'invalid'));
      return result();
    }
    extra('', spec, ['workspace', 'description', 'spaces']);
    if ((spec.workspace != null && spec.workspace !== this.state.meta.name) || spec.description != null) {
      step('workspace', () => this.updateWorkspace({ name: spec.workspace ?? null, description: spec.description ?? null }));
    }

    const tables = [];
    const failedTables = new Set();
    listAt('spaces', spec.spaces).forEach((sp, i) => {
      const at = `spaces[${i}]`;
      if (!isObj(sp)) return fail(at, new WeaveError('A space is an object: {name, icon?, description?, tables}', 'invalid'));
      extra(at, sp, ['name', 'icon', 'description', 'tables']);
      sp = cosmetic(at, sp, 'icon', iconValue);
      let space = sp.name ? this.findSpace(sp.name) : null;
      if (space) existing.push(`space ${space.name}`);
      else {
        space = step(at, () => this.createSpace({ name: sp.name, description: sp.description ?? '', icon: sp.icon ?? '' }));
        if (!space) return undefined;
        created.spaces += 1;
      }
      listAt(`${at}.tables`, sp.tables).forEach((t, j) => {
        const tAt = `${at}.tables[${j}]`;
        if (!isObj(t)) return fail(tAt, new WeaveError('A table is an object: {name, icon?, description?, fields?, rows?, fieldOrder?, hidden?, sort?}', 'invalid'));
        extra(tAt, t, ['name', 'icon', 'description', 'fields', 'rows', 'fieldOrder', 'hidden', 'sort']);
        const tw = cosmetic(tAt, t, 'icon', iconValue);
        let db = t.name ? this.findTable(`${space.name}/${t.name}`) : null;
        if (db) existing.push(`table ${space.name}/${db.name}`);
        else {
          db = step(tAt, () => this.createTable({ space: space.id, name: t.name, description: t.description ?? '', icon: tw.icon ?? '' }));
          if (!db) { if (t.name) failedTables.add(String(t.name).toLowerCase()); return undefined; }
          created.tables += 1;
        }
        // `failed` holds the field names that did not land, so a row naming
        // one is not charged a second error for it.
        tables.push({ at: tAt, spec: t, db, failed: new Set() });
        return undefined;
      });
      return undefined;
    });

    // A table this spec names is the one a relation means, even when another
    // space holds a namesake.
    const target = (ref) => {
      const hit = tables.filter((tb) => tb.db.name.toLowerCase() === String(ref).toLowerCase());
      return hit.length === 1 ? hit[0].db.id : ref;
    };
    const phase = (f) => (f?.type === 'relation' ? 1 : f?.type === 'lookup' || f?.type === 'rollup' ? 2 : f?.type === 'formula' ? 3 : 0);
    const fields = tables.flatMap((tb) => listAt(`${tb.at}.fields`, tb.spec.fields).map((f, k) => ({ tb, f, at: `${tb.at}.fields[${k}]` })));
    for (const p of [0, 1, 2, 3]) {
      for (const { tb, f, at } of fields) {
        if (phase(f) !== p) continue;
        if (!isObj(f)) { fail(at, new WeaveError('A field is an object: {name, type, ...config}', 'invalid')); continue; }
        const { name, type, ...sent } = f;
        let config = type === 'rating' ? cosmetic(at, sent, 'icon', iconValue) : sent;
        if (Array.isArray(config.options)) {
          const hue = (k) => (v) => hueOf({ [k]: v }, { strict: true });
          config = { ...config, options: config.options.map((o, n) => ['icon', 'hue', 'color']
            .reduce((acc, k) => cosmetic(`${at}.options[${n}]`, acc, k, k === 'icon' ? iconValue : hue(k)), o)) };
        }
        if (Array.isArray(config.states)) {
          config = { ...config, states: config.states.map((st, n) => cosmetic(`${at}.states[${n}]`, st, 'icon', iconValue)) };
        }
        // Downstream of a failure: its own error is already in the list.
        const reads = type === 'lookup' || type === 'rollup' ? [config.relationField ?? config.relation]
          : type === 'formula' && typeof config.expression === 'string' ? formulaReferences(config.expression) : [];
        if (reads.some((r) => r != null && tb.failed.has(r))
          || (type === 'relation' && !Array.isArray(config.to) && config.to != null && failedTables.has(String(config.to).toLowerCase()))) {
          tb.failed.add(name);
          continue;
        }
        const have = name ? this.findField(tb.db, name) : null;
        if (have) {
          if (have.type === type) existing.push(`field ${this.qualifiedName(tb.db)}.${have.name}`);
          else {
            tb.failed.add(name);
            fail(at, new WeaveError(`Field '${name}' already exists as ${have.type}, not ${type}`, 'conflict'));
          }
          continue;
        }
        if (type === 'relation') {
          const { to, cardinality, inverseName, ...rest } = config;
          if (Object.keys(rest).length) ignored.push({ path: at, keys: Object.keys(rest) });
          const where = Array.isArray(to) ? { targetDbs: to.map(target) } : { targetDb: to == null ? undefined : target(to) };
          if (step(at, () => this.addRelation(tb.db.id, { name, ...where, cardinality, inverseName }))) created.relations += 1;
          else tb.failed.add(name);
          continue;
        }
        const field = step(at, () => this.addField(tb.db.id, { name, type, config }));
        if (!field) { tb.failed.add(name); continue; }
        created.fields += 1;
        if (p >= 2) computedMade.push({ tb, name: field.name });
        /* addField drops a key its type does not take without a word. A key
           is ignored when the stored config does not carry it and the
           vocabulary does not list it for the type; a listed key the
           normaliser left out (format 'number', the default) was taken. */
        const takes = new Set([...(FIELD_TYPE_VOCABULARY.find((v) => v.type === type)?.config ?? []), 'width', 'description', 'default', 'relation']);
        const dropped = Object.keys(config).filter((k) => !(k in field.config) && !takes.has(k));
        if (dropped.length) ignored.push({ path: at, keys: dropped });
      }
    }

    const links = [];
    for (const tb of tables) {
      // The names a re-run may skip: what the table held, plus what this build adds.
      const held = skipExistingRows ? new Set(this.listEntities(tb.db.id).map((e) => this.entityName(e))) : null;
      listAt(`${tb.at}.rows`, tb.spec.rows).forEach((row, k) => {
        const at = `${tb.at}.rows[${k}]`;
        if (!isObj(row)) return fail(at, new WeaveError('A row is an object of values by field name', 'invalid'));
        const rowName = row.Name ?? row.name ?? row[tb.db.fields[tb.db.nameFieldId]?.name];
        if (held && rowName != null && held.has(String(rowName))) {
          existing.push(`row ${this.qualifiedName(tb.db)}: ${rowName}`);
          return undefined;
        }
        const values = {};
        const rel = {};
        for (const [key, v] of Object.entries(row)) {
          if (tb.failed.has(key)) continue;
          (this.findField(tb.db, key)?.type === 'relation' ? rel : values)[key] = v;
        }
        const e = step(at, () => this.createEntity(tb.db.id, values));
        if (!e) return undefined;
        created.rows += 1;
        held?.add(this.entityName(e));
        if (Object.keys(rel).length) links.push({ at, id: e.id, rel });
        return undefined;
      });
    }
    for (const { at, id, rel } of links) step(at, () => this.updateEntity(id, rel));

    /* Layout per table (Issue #628): an agent set column order, hidden
       columns and sort with one registry-row write each, up to ten calls
       after a build. fieldOrder names the leading fields, the rest keep their
       place; it orders the schema and the default view's columns alike.
       hidden hides those columns in the default view and leaves the rest as
       they are (the minted Chip and Card stay hidden); sort is that view's.
       A field that failed above is left out rather than charged again. */
    for (const tb of tables) {
      const ok = (n) => !tb.failed.has(n);
      const names = (key) => listAt(`${tb.at}.${key}`, tb.spec[key]).filter(ok);
      if (tb.spec.fieldOrder != null) step(`${tb.at}.fieldOrder`, () => this.#buildOrder(tb.db, names('fieldOrder')));
      if (tb.spec.hidden != null) step(`${tb.at}.hidden`, () => this.tableView(`${tb.db.id}/${this.tableView(tb.db.id).views[0].name}`, { hide: names('hidden') }));
      if (tb.spec.sort != null) {
        step(`${tb.at}.sort`, () => {
          const raw = typeof tb.spec.sort === 'string' ? parseSort(tb.spec.sort) : listAt(`${tb.at}.sort`, tb.spec.sort);
          const sort = raw.flatMap((x) => (typeof x === 'string' ? parseSort(x) : [x])).filter((x) => !isObj(x) || ok(x.field));
          return this.updateTable(tb.db.id, { sort });
        });
      }
    }

    /* What each computed field computed (Issue #627): agents ran 3 to 10
       weave_query read-backs after a build to see whether a rollup or a
       formula worked. The reply carries the first three values the grid
       shows, so a null or an #ERR is seen without another call; a related
       row reads as its name. Empty when the table has no rows yet. */
    if (computedMade.length) {
      const brief = (v) => (Array.isArray(v) ? v.map(brief) : isObj(v) && 'name' in v ? v.name : v);
      computed = {};
      for (const { tb, name } of computedMade) {
        computed[`${this.qualifiedName(tb.db)}.${name}`] = this.query(tb.db.id, { limit: 3, fields: [name] }).items.map((e) => brief(e.fields[name]));
      }
    }
    return result();
  }

  /* A build's fieldOrder: the named fields lead, every other keeps its
     relative place, in the schema and in the default view. */
  #buildOrder(db, names) {
    const lead = names.map((n) => this.getField(db.id, n).id);
    const order = [...new Set([...lead, ...db.fieldOrder])];
    this.updateTable(db.id, { fieldOrder: order });
    const [view] = this.tableView(db.id).views;
    const shown = new Set(view.fields.map((n) => this.findField(db, n)?.id ?? n));
    const cols = [...order.filter((id) => shown.has(id)), ...[...shown].filter((id) => !order.includes(id))];
    this.tableView(`${db.id}/${view.name}`, { fields: cols });
  }

  /* The half of a table that is not its fields: what it is called in the
     create action, which columns a reader never sees, which system columns
     ride along, and the order of the grid. Applied on create so a document
     builds the table someone described, not a stripped copy of it. */
  #applyTableCostume(db, tDoc) {
    const patch = {};
    // The Name field's own `term` (plural included) outranks the table-level
    // `noun`, which is that term's singular under its older name.
    const nameDoc = (tDoc.fields ?? []).find((f) => f.role === 'name') ?? (tDoc.fields ?? []).find((f) => f.name === 'Name');
    if (nameDoc?.term) this.#setTerm(db, nameDoc.term);
    else if (tDoc.noun) patch.noun = tDoc.noun;
    if (!tDoc.views) {
      if (tDoc.hiddenFields?.length) patch.hiddenFields = [...tDoc.hiddenFields];
      if (tDoc.filters && Object.keys(tDoc.filters).length) patch.filters = tDoc.filters;
      if (tDoc.sort?.length) patch.sort = tDoc.sort;
    }
    if (tDoc.systemFields?.length) patch.systemFields = [...tDoc.systemFields];
    if (tDoc.hideRollups != null) patch.hideRollups = !!tDoc.hideRollups;
    const wanted = [];
    for (const fDoc of tDoc.fields ?? []) {
      const f = Object.values(db.fields).find((x) => x.name === fDoc.name);
      if (f && !wanted.includes(f.id)) wanted.push(f.id);
    }
    for (const id of db.fieldOrder) if (!wanted.includes(id)) wanted.push(id);
    if (wanted.length === db.fieldOrder.length && JSON.stringify(wanted) !== JSON.stringify(db.fieldOrder)) patch.fieldOrder = wanted;
    if (Object.keys(patch).length) this.updateTable(db.id, patch);
    const body = this.#bodyOrderFrom(db, tDoc);
    if (body) this.updateTable(db.id, { bodyOrder: body });
    // A created table is built to the document: its minted Default goes
    // unless the document names it.
    if (Array.isArray(tDoc.views)) {
      this.#applyViews(db, tDoc.views, (a, s, fn) => fn(), true);
      const legacy = this.#legacyEdits(db, tDoc);
      if (Object.keys(legacy).length) this.updateTable(db.id, legacy);
    }
  }

  /* The entity page's block order a document names (`bodyBlocks`, which
     describeSchema emits), as the bodyOrder that reproduces it, or null when
     the table already reads that way. Names the table lacks are passed over.
     Feature #261: a template's moved document blocks came back in the default
     order, because nothing applied this key. */
  #bodyOrderFrom(db, tDoc) {
    if (!Array.isArray(tDoc.bodyBlocks)) return null;
    const want = tDoc.bodyBlocks.filter((n) => n === VALUES_BLOCK || (this.findField(db, n) && isBodyBlock(this.findField(db, n))));
    const now = this.bodyBlocks(db).filter((n) => want.includes(n));
    return JSON.stringify(want) === JSON.stringify(now) ? null : want;
  }

  /* A document carrying `views` still carries the default view's older
     spelling (hiddenFields, filters, sort) beside it. Those keys win only
     where they disagree with the document's own first view — that is an
     edit someone made to the old keys; agreement is just the echo. A list
     naming a field the table no longer has is a stale echo of a rename made
     in the same document, and is left alone. */
  #legacyEdits(db, tDoc, created = new Set()) {
    const v0 = tDoc.views[0];
    const out = {};
    const SYSTEM = ['Created At', 'Modified At', 'Created By', 'Modified By', 'Activity'];
    const fresh = (list) => (list ?? []).every((n) => SYSTEM.includes(n) || this.findField(db, n));
    if ('hiddenFields' in tDoc && Array.isArray(v0?.fields) && fresh(tDoc.hiddenFields)) {
      const shown = new Set(v0.fields);
      const echo = (tDoc.fields ?? []).map((f) => f.name).filter((n) => !shown.has(n) && !created.has(n));
      if (JSON.stringify(tDoc.hiddenFields ?? []) !== JSON.stringify(echo)) out.hiddenFields = tDoc.hiddenFields ?? [];
    }
    if ('filters' in tDoc && JSON.stringify(tDoc.filters ?? {}) !== JSON.stringify(v0?.filters ?? {})) out.filters = tDoc.filters ?? {};
    if ('sort' in tDoc && JSON.stringify(tDoc.sort ?? []) !== JSON.stringify(v0?.sort ?? [])) out.sort = tDoc.sort ?? [];
    return out;
  }

  /* A schema document's `views` onto one table (Feature #229): the list IS
     the strip, so each view lands at its index and the first is the default.
     A view the document leaves out is a deletion, which needs
     allowDestructive like every other omission. */
  #applyViews(db, docViews, act, allowDestructive, created = new Set()) {
    const q = this.qualifiedName(db);
    /* A document is reconciled, not obeyed name by name: a view naming a
       field the table does not have (renamed or dropped in the same edit)
       loses that name, as deleteField would have taken it, and a field this
       apply just created stays where placeField put it unless the view
       names it — an agent adding a column should not have to find it in
       every view first. The verb itself stays strict. */
    const has = (n) => !!this.findField(db, n) || GRID_SYSTEM_COLUMNS.includes(n);
    const clean = (vDoc) => {
      const out = {};
      if (vDoc.fields) {
        out.fields = vDoc.fields.filter(has);
        for (const n of created) if (!out.fields.includes(n) && has(n)) out.fields.push(n);
      }
      if (vDoc.filters) out.filters = Object.fromEntries(Object.entries(vDoc.filters).filter(([k]) => has(k)));
      if (vDoc.sort) out.sort = vDoc.sort.filter((s) => has(s.field));
      if (vDoc.widths) out.widths = Object.fromEntries(Object.entries(vDoc.widths).filter(([k]) => has(k)));
      if (vDoc.frozen) out.frozen = vDoc.frozen;
      if (vDoc.density) out.density = vDoc.density;
      if (vDoc.deleted) out.deleted = true;
      if (typeof vDoc.rollups === 'boolean') out.rollups = vDoc.rollups;
      for (const k of ['filters', 'sort', 'widths']) if (out[k] && !Object.keys(out[k]).length) delete out[k];
      return out;
    };
    /* Writes land before deletions, because a table keeps at least one view:
       a document that replaces every view must add the new one before the
       last old one can go. The order is placed last, once the strip holds
       exactly the document's views. */
    const named = new Set(docViews.map((v) => String(v?.name ?? '').toLowerCase()));
    const doomed = db.tableViews.filter((v) => !named.has(v.name.toLowerCase()));
    if (doomed.length && !allowDestructive) {
      throw new WeaveError(`Applying this document would delete view '${q}/${doomed[0].name}' — a destructive change needs allowDestructive`, 'invalid');
    }
    if (!docViews.length && db.tableViews.length) {
      throw new WeaveError(`A table keeps at least one view — the document lists none for ${q}`, 'invalid');
    }
    for (const raw of docViews) {
      const vDoc = { name: raw.name, ...clean(raw) };
      const i = this.#viewIndex(db, vDoc.name);
      const have = i >= 0 ? this.#viewOut(db, db.tableViews[i]) : null;
      const patch = {};
      if (vDoc.fields && JSON.stringify(vDoc.fields) !== JSON.stringify(have?.fields)) patch.fields = vDoc.fields;
      if (JSON.stringify(vDoc.filters ?? null) !== JSON.stringify(have?.filters ?? null)) patch.filters = vDoc.filters ?? {};
      if (JSON.stringify(vDoc.sort ?? null) !== JSON.stringify(have?.sort ?? null)) patch.sort = vDoc.sort ?? [];
      // The document's widths are the whole set: a name it drops is unsized.
      if (JSON.stringify(vDoc.widths ?? {}) !== JSON.stringify(have?.widths ?? {})) {
        patch.widths = { ...Object.fromEntries(Object.keys(have?.widths ?? {}).map((n) => [n, null])), ...(vDoc.widths ?? {}) };
      }
      if ((vDoc.frozen ?? 0) !== (have?.frozen ?? 0)) patch.frozen = vDoc.frozen ?? 0;
      if ((vDoc.density ?? 'comfortable') !== (have?.density ?? 'comfortable')) patch.density = vDoc.density ?? 'comfortable';
      if (!!vDoc.deleted !== !!have?.deleted) patch.deleted = !!vDoc.deleted;
      if ((vDoc.rollups ?? null) !== (have?.rollups ?? null)) patch.rollups = vDoc.rollups ?? null;
      if (!Object.keys(patch).length) continue;
      act(have ? 'update-view' : 'create-view', `${q}/${vDoc.name}`, () => this.tableView(`${db.id}/${vDoc.name}`, patch));
    }
    for (const v of doomed) act('delete-view', `${q}/${v.name}`, () => this.tableView(`${db.id}/${v.id}`, { delete: true }));
    // The order: what the strip holds once the writes and deletions above
    // land (on a dry run, what it would hold), placed view by view.
    const strip = [...db.tableViews.filter((v) => named.has(v.name.toLowerCase())).map((v) => v.name.toLowerCase())];
    for (const raw of docViews) if (!strip.includes(String(raw.name).toLowerCase())) strip.push(String(raw.name).toLowerCase());
    docViews.forEach((raw, k) => {
      const at = strip.indexOf(String(raw.name).toLowerCase());
      if (at === k) return;
      strip.splice(at, 1);
      strip.splice(k, 0, String(raw.name).toLowerCase());
      act('update-view', `${q}/${raw.name}`, () => this.tableView(`${db.id}/${raw.name}`, { position: k }));
    });
  }

  // ---------------- the workspace record ----------------
  /* The workspace's own name and description are workspace data, so they are
     engine verbs like any other. The HTTP layer adds what only it knows: the
     hub's name index, which it re-keys after the write. */
  getWorkspace() {
    const m = this.state.meta;
    return { id: m.id, name: m.name, title: m.title ?? m.name, description: m.description ?? '', logo: !!m.logo, requireAuth: !!m.requireAuth };
  }

  /* `name` is what a person calls the workspace, any text (Issue #592): it
     is kept as the title, and meta.name takes its slug, the /w/<slug>/
     address. A name equal to the slug held, mixed-case ones from before
     Issue #599 included, changes nothing. */
  updateWorkspace({ name = null, description = null } = {}) {
    if (description != null) this.state.meta.description = String(description);
    if (name != null && name !== this.state.meta.name) {
      const slug = workspaceSlug(name);
      if (!slug) throw new WeaveError('A workspace name needs a letter or a digit: its slug keeps letters, digits, - and _', 'invalid');
      this.state.meta.name = slug;
      this.state.meta.title = String(name).trim();
      if (this.state.meta.title === slug) delete this.state.meta.title;
    }
    this.#audit('workspace-updated', { name: this.state.meta.name });
    this.save();
    this.#syncWorkspaceRow();
    return this.getWorkspace();
  }

  // ---------------- keystore (Feature #64) ----------------
  /* Secrets never enter workspace data: a key field's value is a NAME, and
     the name resolves here — a chmod-600 file beside no workspace. There is
     deliberately no way to read a secret over HTTP; resolveKey exists for
     the engine's own consumers (automations, integrations). */
  /* The key the envelope is sealed with (Feature #143, phase 2). A passphrase
     in the environment wins — that is the deployment that keeps the secret off
     the disk entirely. Otherwise a random key is generated once into a
     chmod-600 file beside the keystore.

     Be honest about what the key file buys: it does NOT stop someone who can
     read the whole directory, because the key is in that directory. It stops
     the leak that actually happens — the keystore copied out alone by a
     backup, a sync folder, a support bundle, a `scp` of the data dir. For a
     hosted instance, set WEAVE_KEYSTORE_PASSPHRASE and the key never lands. */
  #keystoreKey() {
    const pass = this.keystoreEnv?.WEAVE_KEYSTORE_PASSPHRASE;
    if (pass) return scryptSync(String(pass), 'weave-keystore-v2', 32);
    const keyPath = this.keystorePath.replace(/\.json$/, '') + '.key';
    try {
      const b = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
      if (b.length === 32) return b;
    } catch { /* not written yet */ }
    const fresh = randomBytes(32);
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, fresh.toString('base64'), { mode: 0o600 });
    return fresh;
  }

  #seal(plain) {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.#keystoreKey(), iv);
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
  }

  #open(entry, name) {
    try {
      const d = createDecipheriv('aes-256-gcm', this.#keystoreKey(), Buffer.from(entry.iv, 'base64'));
      d.setAuthTag(Buffer.from(entry.tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(entry.ct, 'base64')), d.final()]).toString('utf8');
    } catch {
      throw new WeaveError(
        `Cannot decrypt '${name}' — wrong passphrase, or the keystore was edited outside weave`, 'invalid');
    }
  }

  /* On disk: `{ v: 2, keys: { name: { iv, ct, tag, ...record } } }`. The NAMES
     stay in the clear on purpose — a name is not a secret, and listing keys
     must work without the key material. A v1 file (a flat name→secret map,
     Feature #64) is read as-is and re-sealed the next time anything writes,
     so an upgrade costs nothing and loses nothing. */
  #readKeystore() {
    let raw;
    try { raw = JSON.parse(readFileSync(this.keystorePath, 'utf8')); } catch { return { v: 2, keys: {} }; }
    if (raw && raw.v === 2 && raw.keys) return raw;
    const keys = {};
    for (const [name, secret] of Object.entries(raw ?? {})) keys[name] = { legacy: String(secret) };
    return { v: 2, keys, migrated: true };
  }

  #writeKeystore(data) {
    // Anything still carrying a v1 plaintext gets sealed on the way out.
    for (const [name, entry] of Object.entries(data.keys)) {
      if ('legacy' in entry) {
        const { legacy, ...rest } = entry;
        data.keys[name] = { ...rest, ...this.#seal(legacy) };
      }
    }
    delete data.migrated;
    mkdirSync(dirname(this.keystorePath), { recursive: true });
    writeFileSync(this.keystorePath, JSON.stringify(data, null, 1), { mode: 0o600 });
  }

  /* A key field's config, with the #143 defaults filled in. Fields created
     before #143 carry `{}`, and every reader — cell, chip, reveal — needs the
     same answer for those as for a field created today. */
  credentialConfig(field) {
    const c = field?.config ?? {};
    const kind = CREDENTIAL_KINDS.includes(c.kind) ? c.kind : 'apikey';
    const keystore = KEYSTORES.includes(c.keystore) ? c.keystore : 'local';
    return { kind, keystore, ...(kind === 'pair' ? { parts: c.parts ?? DEFAULT_PAIR_PARTS } : {}) };
  }

  setKey(name, secret) {
    if (!name) throw new WeaveError('Key name is required', 'invalid');
    refuseReserved('key', name);
    const data = this.#readKeystore();
    const prior = own(data.keys, name);
    data.keys[name] = {
      ...this.#seal(secret ?? ''),
      // The actor who first set a credential owns it; re-setting the secret is
      // a rotation, not a change of hands (Feature #143, phase 3).
      owner: prior?.owner ?? this.actor,
      shared: prior?.shared ?? false,
      createdAt: prior?.createdAt ?? nowISO(),
      ...(prior ? { rotatedAt: nowISO() } : {}),
    };
    this.#writeKeystore(data);
    this.#audit('key-set', { name });
    return { name, set: true };
  }

  deleteKey(name) {
    const data = this.#readKeystore();
    if (!Object.hasOwn(data.keys, name)) throw new WeaveError(`Key '${name}' not found`, 'not-found');
    delete data.keys[name];
    this.#writeKeystore(data);
    this.#audit('key-deleted', { name });
    return { name, deleted: true };
  }

  hasKey(name) {
    return Object.hasOwn(this.#readKeystore().keys, name);
  }

  /* Names, never values — and now who may see each one, which is the fact a
     reader needs to know whether asking is worth it. */
  listKeys() {
    const { keys } = this.#readKeystore();
    return Object.keys(keys).sort().map((name) => ({
      name,
      set: true,
      owner: keys[name].owner ?? null,
      shared: keys[name].shared ?? false,
    }));
  }

  resolveKey(name) {
    const { keys } = this.#readKeystore();
    const entry = own(keys, name);
    if (!entry) throw new WeaveError(`Key '${name}' not found in the keystore`, 'not-found');
    return 'legacy' in entry ? entry.legacy : this.#open(entry, name);
  }

  /* ---- reveal: the exception, and why it is not a field permission ----
     Everywhere else in weave, reaching the table reaches the values. A
     credential looks like an exception to that and is not one: the secret was
     never IN the table. The cell holds a name — ordinary table data, visible
     to anyone who can see the row — and the secret sits in the keystore behind
     its own access list. So the rule lives on the credential, which is where
     1Password (vaults) and AWS Secrets Manager (resource policies) put it too,
     and no view, formula, export or MCP read has to learn a new check.

     `shared`: false → the owner alone; an array → the owner and those actors;
     true → anyone the surface has already authenticated. An entry carried over
     from #64 has no owner and no grant, so nobody reveals it — the promise #64
     made about everything it stored still holds. */
  #mayReveal(entry) {
    if (!entry) return false;
    /* An access list needs someone to keep out. Until the workspace has
       accounts it is one operator with the CLI, the data file and the
       keystore already in hand, and refusing them their own credential in the
       app would be theatre — the same reason /api/keys itself is ungated
       until an account exists. The moment accounts appear, the list bites.
       The keystore is one per process, so the accounts that count are the
       hub root's: a member with none of its own opens nothing (Issue #480). */
    if (!(this.registryHost ?? this).listAccounts().length) return true;
    if (entry.shared === true) return true;
    if (Array.isArray(entry.shared) && entry.shared.includes(this.actor)) return true;
    return !!entry.owner && entry.owner === this.actor;
  }

  revealKey(name, { via = 'show' } = {}) {
    const data = this.#readKeystore();
    const entry = own(data.keys, name);
    if (!entry) throw new WeaveError(`Key '${name}' not found in the keystore`, 'not-found');
    if (!this.#mayReveal(entry)) {
      throw new WeaveError(`'${name}' is not shared with you — its owner has to grant it`, 'forbidden');
    }
    /* Copying counts. A value on the clipboard has left the vault as surely as
       one on the screen, so the two take the same path and the log says which
       (Feature #143). The secret itself never enters the audit detail. */
    this.#audit('key-revealed', { name, via });
    return 'legacy' in entry ? entry.legacy : this.#open(entry, name);
  }

  /* Granting is the audited act that opens a credential. The owner may grant;
     an ownerless entry (everything #64 left behind) may be claimed, or it
     would be sealed forever with no way forward. Once #141 gives weave real
     users, "admin may grant" becomes a role check rather than this. */
  #mayGrant(entry) {
    return !entry.owner || entry.owner === this.actor;
  }

  grantKey(name, account) {
    if (!account) throw new WeaveError('Name the account the credential is shared with', 'invalid');
    const data = this.#readKeystore();
    const entry = own(data.keys, name);
    if (!entry) throw new WeaveError(`Key '${name}' not found`, 'not-found');
    if (!this.#mayGrant(entry)) throw new WeaveError(`Only '${entry.owner}' can share '${name}'`, 'forbidden');
    entry.owner ??= this.actor;
    const list = Array.isArray(entry.shared) ? entry.shared : [];
    if (account !== true && !list.includes(account)) list.push(account);
    entry.shared = account === true ? true : list;
    this.#writeKeystore(data);
    this.#audit('key-granted', { name, to: account === true ? 'everyone' : account });
    return { name, shared: entry.shared };
  }

  revokeKey(name, account) {
    const data = this.#readKeystore();
    const entry = own(data.keys, name);
    if (!entry) throw new WeaveError(`Key '${name}' not found`, 'not-found');
    if (!this.#mayGrant(entry)) throw new WeaveError(`Only '${entry.owner}' can unshare '${name}'`, 'forbidden');
    entry.shared = Array.isArray(entry.shared) ? entry.shared.filter((a) => a !== account) : false;
    this.#writeKeystore(data);
    this.#audit('key-revoked', { name, from: account });
    return { name, shared: entry.shared };
  }

  /* Where to go for a credential weave does not hold. A remote keystore keeps
     its own access rules, which is precisely why weave stores a ref and never
     the value — and why the honest answer to "show me" is a door, not a
     refusal (Feature #143, phase 4). */
  credentialLink(field, ref) {
    const { keystore } = this.credentialConfig(field);
    const r = encodeURIComponent(String(ref ?? ''));
    switch (keystore) {
      case '1password': return `onepassword://search/?q=${r}`;
      case 'aws-sm': return `https://console.aws.amazon.com/secretsmanager/secret?name=${r}`;
      case 'google-sm': return `https://console.cloud.google.com/security/secret-manager/secret/${r}`;
      case 'cloudflare': return `https://dash.cloudflare.com/?to=/:account/workers/services`;
      case 'apple-passwords': return 'x-apple.systempreferences:com.apple.Passwords-Settings.extension';
      default: return null; // local — weave holds it, so reveal is the door
    }
  }

  // ---------------- accounts & audit (Feature #14) ----------------
  /* Accounts are how a hosted instance (#84, v0.5) knows its callers. The
     token is handed out exactly once; only its sha256 lands at rest. Roles
     (Kyle, 2026-10-02): architect (everything, structure included), editor
     (entities and comments, no structure), observer (reads, and its own
     comments). Enforcement lives at the surfaces — the engine keeps the
     facts. The labels are billing words only; weave bills nobody. */
  static ROLES = ['architect', 'editor', 'observer'];
  static ROLE_LABELS = { architect: 'Architect, paid', editor: 'Editor, paid seat', observer: 'Observer, free' };
  /* The names before 2026-10-02. Accepted as input for one release, and
     rewritten wherever a stored row still carries one (#migrate).
     ponytail: drop OLD_ROLES from input in the release after v0.4.55;
     keep the #migrate rewrite for any .db opened late. */
  static OLD_ROLES = { admin: 'architect', writer: 'editor', reader: 'observer' };
  static roleName(role) { return Weave.OLD_ROLES[role] ?? role; }

  #audit(action, detail = {}) {
    this.store.audit({ at: nowISO(), actor: this.actor, action, detail });
    // A structural change can break a rule or mend one: judge the rows now,
    // so a rule whose trigger field was just deleted reads Failed at once
    // rather than at its table's next write (Feature #249).
    this.#reg.#settleWorkflows();
  }

  listAudit(opts) {
    return this.store.listAudit(opts).map((r) => ({ ...r, detail: Weave.#publicDetail(r.detail) }));
  }

  createAccount({ name, role: asked = 'editor' } = {}) {
    if (!name) throw new WeaveError('Account name is required', 'invalid');
    refuseReserved('account', name);
    const role = Weave.roleName(asked);
    if (!Weave.ROLES.includes(role)) throw new WeaveError(`Invalid role '${asked}' (${Weave.ROLES.join(', ')})`, 'invalid');
    const accounts = (this.state.meta.accounts ??= {});
    if (Object.values(accounts).some((a) => a.name === name)) throw new WeaveError(`Account '${name}' already exists`, 'conflict');
    const token = 'wv_' + randomBytes(24).toString('base64url');
    const account = { id: uuid(), name, role, tokenHash: this.#hash(token), createdAt: nowISO() };
    accounts[account.id] = account;
    this.save();
    this.#audit('account-created', { name, role });
    const { tokenHash, ...pub } = account;
    const note = role !== asked ? `Role '${asked}' is now '${role}'; the old name is deprecated and accepted for one more release` : undefined;
    return { account: pub, token, ...(note ? { note } : {}) };
  }

  verifyToken(token) {
    if (!token) return null;
    const h = this.#hash(token);
    const a = Object.values(this.state.meta.accounts ?? {}).find((x) => x.tokenHash === h);
    if (!a) return null;
    const { tokenHash, ...pub } = a;
    return pub;
  }

  /* The token hash is never listed (Issue #230). Nor is a credentials[]
     array a pre-#243 row may still carry: the passkey door that read it is
     gone, and the data is left where it is, unread. */
  listAccounts() {
    return Object.values(this.state.meta.accounts ?? {}).map(({ tokenHash, credentials, ...pub }) => pub);
  }

  deleteAccount(ref) {
    const accounts = this.state.meta.accounts ?? {};
    const a = own(accounts, ref) ?? Object.values(accounts).find((x) => x.name === ref);
    if (!a) throw new WeaveError(`Account '${ref}' not found`, 'not-found');
    delete accounts[a.id];
    this.save();
    this.#audit('account-deleted', { name: a.name });
    return { id: a.id, deleted: true };
  }

  /* The onboarding welcome runs once per person (Feature #248), finished or
     skipped, on every device. A signed-in person's mark is on their account
     row; with nobody signed in it is the workspace's own. The first time is
     kept. */
  onboardedAt(accountId = null) {
    return (accountId ? this.state.meta.accounts?.[accountId]?.onboardedAt : this.state.meta.onboardedAt) ?? null;
  }

  markOnboarded(accountId = null) {
    const holder = accountId ? own(this.state.meta.accounts ?? {}, accountId) : this.state.meta;
    if (!holder) throw new WeaveError(`Account '${accountId}' not found`, 'not-found');
    if (holder.onboardedAt) return holder.onboardedAt;
    holder.onboardedAt = nowISO();
    this.save();
    this.#audit('onboarded', accountId ? { name: holder.name } : {});
    return holder.onboardedAt;
  }

  setRequireAuth(on) {
    this.state.meta.requireAuth = !!on;
    this.save();
    this.#audit(on ? 'auth-required-on' : 'auth-required-off');
    return this.state.meta.requireAuth;
  }

  // ---------------- sessions (Feature #222 part 2, Feature #208) ----------------
  /* A session is a browser's standing with an account, minted at sign-in
     (the provider door, Feature #212) and carried as the wv_session cookie.
     Sessions are stored as sha256 of their token only — the raw token is
     handed out exactly once, like a wv_ token — and never leave through
     exportJSON. The passkey door that introduced them, with its invites and
     credentials, was removed in Feature #243. */
  static SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  #account(ref) {
    const accounts = this.state.meta.accounts ?? {};
    const a = own(accounts, ref) ?? Object.values(accounts).find((x) => x.name === ref);
    if (!a) throw new WeaveError(`Account '${ref}' not found`, 'not-found');
    return a;
  }

  #hash(token) { return createHash('sha256').update(String(token)).digest('hex'); }

  createSession(accountRef, { ua = '' } = {}) {
    const a = this.#account(accountRef);
    const sessions = (this.state.meta.sessions ??= {});
    const now = Date.now();
    for (const [h, s] of Object.entries(sessions)) if (Date.parse(s.expiresAt) <= now) delete sessions[h];
    const token = randomBytes(32).toString('base64url');
    const at = new Date(now).toISOString();
    const expiresAt = new Date(now + Weave.SESSION_TTL_MS).toISOString();
    sessions[this.#hash(token)] = { accountId: a.id, createdAt: at, expiresAt, lastSeenAt: at, ua: String(ua ?? '').slice(0, 200) };
    this.save();
    this.#audit('session-created', { name: a.name });
    return { token, expiresAt, account: { id: a.id, name: a.name, role: a.role } };
  }

  /* Sliding expiry: every verified use pushes expiresAt 30 days out. The
     write is throttled to once a minute per session so a page of fetches
     does not turn into a page of saves. */
  verifySession(token) {
    if (!token) return null;
    const h = this.#hash(token);
    const s = this.state.meta.sessions?.[h];
    if (!s) return null;
    const now = Date.now();
    if (Date.parse(s.expiresAt) <= now) { delete this.state.meta.sessions[h]; this.save(); return null; }
    const a = this.state.meta.accounts?.[s.accountId];
    if (!a) return null;
    if (now - Date.parse(s.lastSeenAt) > 60 * 1000) {
      s.lastSeenAt = new Date(now).toISOString();
      s.expiresAt = new Date(now + Weave.SESSION_TTL_MS).toISOString();
      this.save();
    }
    const { tokenHash, ...pub } = a;
    return { ...pub, sessionId: h };
  }

  listSessions(accountRef) {
    const a = this.#account(accountRef);
    const now = Date.now();
    return Object.entries(this.state.meta.sessions ?? {})
      .filter(([, s]) => s.accountId === a.id && Date.parse(s.expiresAt) > now)
      .map(([id, s]) => ({ id, ...s }))
      .sort((x, y) => y.lastSeenAt.localeCompare(x.lastSeenAt));
  }

  /* revokeSession(accountRef, { id }) ends one session by its id (the hash,
     or a prefix of it); { all: true } ends every session the account holds;
     { except } spares one — the browser asking. */
  revokeSession(accountRef, { id = null, all = false, except = null } = {}) {
    const a = this.#account(accountRef);
    const sessions = this.state.meta.sessions ?? {};
    const gone = [];
    for (const [h, s] of Object.entries(sessions)) {
      if (s.accountId !== a.id) continue;
      if (h === except) continue;
      if (all || (id && h.startsWith(id))) { delete sessions[h]; gone.push(h); }
    }
    if (!all && id && !gone.length) throw new WeaveError(`Session '${id}' not found on '${a.name}'`, 'not-found');
    if (gone.length) {
      this.save();
      this.#audit('session-revoked', { name: a.name, count: gone.length, all: !!all });
    }
    return { revoked: gone.length };
  }

  // ---------------- provider identities (Feature #212, door C; Feature #252) ----------------
  /* Signing in at a provider provisions nobody, and weave keeps no email for
     sign-in (Feature #252). An architect links an account by minting a one-time
     invite (linkIdentity): a code handed out once and stored as its sha256,
     like a token or a session, that expires in a week. The person opens the
     invite link, signs in at the provider, and redeeming the invite pins the
     provider's { issuer, subject } to the account (account.identities[]).
     From then on the subject alone is the identity. Identities are keyed by
     issuer, so two providers never share a namespace.
     An invite can also be for someone with no account yet (inviteMember):
     redeeming it makes the account. listInvites and revokeInvite cover the
     pending member invites; a link invite still expires on its own.
     revokeInvite takes either kind by id. */
  static INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  #issuer(issuer) { return String(issuer ?? '').trim().replace(/\/+$/, ''); }

  linkIdentity(accountRef, { issuer, email } = {}) {
    const a = this.#account(accountRef);
    const iss = this.#issuer(issuer);
    if (!iss) throw new WeaveError('An identity needs the issuer of the provider that vouches for it', 'invalid');
    if (email !== undefined) throw new WeaveError('weave no longer links by email (Feature #252): link mints an invite link, and the person who opens it and signs in is linked', 'invalid');
    const { code, expiresAt } = this.#mintInvite({ accountId: a.id, issuer: iss });
    this.#audit('identity-invited', { name: a.name, issuer: iss });
    return { account: a.name, issuer: iss, code, expiresAt };
  }

  #mintInvite(entry) {
    const invites = (this.state.meta.identityInvites ??= {});
    const now = Date.now();
    for (const [h, i] of Object.entries(invites)) if (Date.parse(i.expiresAt) <= now) delete invites[h];
    const code = 'wvi_' + randomBytes(32).toString('base64url');
    const h = this.#hash(code);
    const expiresAt = new Date(now + Weave.INVITE_TTL_MS).toISOString();
    invites[h] = { ...entry, createdAt: new Date(now).toISOString(), expiresAt };
    this.save();
    return { code, h, expiresAt };
  }

  /* A member invite has no account until it is redeemed: `a` is null. */
  #invite(code) {
    const h = this.#hash(code);
    const i = code ? this.state.meta.identityInvites?.[h] : null;
    if (!i || Date.parse(i.expiresAt) <= Date.now()) return null;
    if (!i.accountId) return { h, i, a: null };
    const a = this.state.meta.accounts?.[i.accountId];
    return a ? { h, i, a } : null;
  }

  /* An invite for a new person (Issue #569; Kyle, 2026-10-02: a new person
     is invited to an existing workspace). An architect names an email and a
     role, Editor by default; the invite is linkIdentity's one-time code, and
     redeeming it makes the account at that role and pins the provider's
     subject to it. The email only says who the invite is for: it lives on
     the pending invite, which redeeming, revoking or expiring deletes, and
     never reaches the account or the audit log (Feature #252). */
  inviteMember({ email, role: asked = 'editor', issuer } = {}) {
    const iss = this.#issuer(issuer);
    if (!iss) throw new WeaveError('Inviting needs a sign-in provider: set WEAVE_OIDC_ISSUER (the issuer the person signs in at)', 'invalid');
    const mail = String(email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) throw new WeaveError(`An invite needs an email address (got '${email ?? ''}')`, 'invalid');
    const role = Weave.roleName(asked);
    if (!Weave.ROLES.includes(role)) throw new WeaveError(`Invalid role '${asked}' (${Weave.ROLES.join(', ')})`, 'invalid');
    if (this.listInvites().some((i) => i.email === mail)) throw new WeaveError(`${mail} already has a pending invite; revoke it to send a new one`, 'conflict');
    const { code, h } = this.#mintInvite({ accountId: null, issuer: iss, email: mail, role, invitedBy: this.actor });
    this.#audit('member-invited', { role, issuer: iss });
    return { ...this.listInvites().find((i) => i.id === h), code };
  }

  listInvites() {
    const now = Date.now();
    return Object.entries(this.state.meta.identityInvites ?? {})
      .filter(([, i]) => !i.accountId && Date.parse(i.expiresAt) > now)
      .map(([id, i]) => ({ id, email: i.email, name: this.#memberName(i.email), role: i.role, roleLabel: Weave.ROLE_LABELS[i.role], workspace: this.state.meta.name, invitedBy: i.invitedBy, createdAt: i.createdAt, expiresAt: i.expiresAt }))
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  }

  /* By id, the hash the list shows, or a prefix of it at least 8 long. */
  revokeInvite(id) {
    const invites = this.state.meta.identityInvites ?? {};
    const key = String(id ?? '').length >= 8 ? Object.keys(invites).find((h) => h.startsWith(String(id))) : null;
    if (!key) throw new WeaveError(`Invite '${id ?? ''}' not found`, 'not-found');
    delete invites[key];
    this.save();
    this.#audit('invite-revoked', {});
    return { revoked: 1 };
  }

  /* The name an invited person's account gets: the email's local part, as
     an account name is written by hand ('kyle', 'deploy-check'), with -2,
     -3 on when it is taken. */
  #memberName(email) {
    const base = String(email ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'member';
    const taken = new Set(Object.values(this.state.meta.accounts ?? {}).map((a) => a.name));
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${base}-${n}`;
      if (taken.has(name)) continue;
      try { refuseReserved('account', name); return name; } catch { /* a reserved word: try the next */ }
    }
  }

  /* A pending invite, or null: what the start of a sign-in checks before it
     sends anyone to the provider. */
  identityInvite(code) {
    const found = this.#invite(code);
    return found ? { account: found.a?.name ?? this.#memberName(found.i.email), issuer: found.i.issuer, expiresAt: found.i.expiresAt } : null;
  }

  /* The invite's end of a sign-in: the provider has vouched for { issuer,
     subject }, and the invite says which account it opens. A subject that
     already opens another account is refused and the invite is left for the
     right person; the same account just signs in. */
  redeemIdentityInvite(code, { issuer, subject } = {}) {
    const found = this.#invite(code);
    if (!found) throw new WeaveError('This invite expired or was already used', 'not-found');
    const { h, i, a } = found;
    const iss = this.#issuer(issuer);
    if (iss !== i.issuer) throw new WeaveError('This invite is for another provider', 'invalid');
    if (!subject) throw new WeaveError('The provider named nobody', 'invalid');
    const sub = String(subject);
    for (const other of Object.values(this.state.meta.accounts ?? {})) {
      if (other.id !== a?.id && (other.identities ?? []).some((x) => x.issuer === iss && x.subject === sub)) {
        throw new WeaveError(`This identity already opens '${other.name}'`, 'conflict');
      }
    }
    delete this.state.meta.identityInvites[h];
    const at = nowISO();
    if (!a) {
      const { account } = this.createAccount({ name: this.#memberName(i.email), role: i.role });
      const row = this.state.meta.accounts[account.id];
      row.identities = [{ issuer: iss, subject: sub, createdAt: at, lastUsedAt: at }];
      this.save();
      this.#audit('member-joined', { name: row.name, role: row.role, invitedBy: i.invitedBy ?? null });
      const { tokenHash, ...pub } = row;
      return pub;
    }
    let identity = (a.identities ?? []).find((x) => x.issuer === iss && x.subject === sub);
    if (!identity) {
      identity = { issuer: iss, subject: sub, createdAt: at, lastUsedAt: at };
      (a.identities ??= []).push(identity);
      this.#audit('identity-linked', { name: a.name, issuer: iss });
    } else identity.lastUsedAt = at;
    this.save();
    const { tokenHash, ...pub } = a;
    return pub;
  }

  unlinkIdentity(accountRef, { issuer = null, subject } = {}) {
    const a = this.#account(accountRef);
    const sub = String(subject ?? '');
    const iss = issuer ? this.#issuer(issuer) : null;
    const keep = (a.identities ?? []).filter((i) => !(i.subject === sub && (!iss || i.issuer === iss)));
    const unlinked = (a.identities ?? []).length - keep.length;
    if (!sub || !unlinked) throw new WeaveError(`No identity '${sub}' on '${a.name}'`, 'not-found');
    a.identities = keep;
    this.save();
    this.#audit('identity-unlinked', { name: a.name, ...(iss ? { issuer: iss } : {}) });
    return { unlinked, remaining: keep.length };
  }

  /* The account a verified provider identity opens, or null. The subject is
     the only key: an email, if a caller still passes one, opens nothing. */
  accountForIdentity({ issuer, subject } = {}) {
    if (!issuer || !subject) return null;
    for (const a of Object.values(this.state.meta.accounts ?? {})) {
      const i = (a.identities ?? []).find((x) => x.issuer === issuer && x.subject === String(subject));
      if (!i) continue;
      i.lastUsedAt = nowISO();
      this.save();
      const { tokenHash, ...pub } = a;
      return pub;
    }
    return null;
  }

  /* Feature #252 on open: weave holds no email for sign-in. An identity the
     provider already pinned keeps its subject and loses the email it was
     linked by; one never pinned is dropped, since only an email named it and
     nobody holds an invite for it (the architect mints a new one). The identity
     entries in the audit log lose their email too. Every open looks, not
     once per workspace: an older weave sharing the .db could still write one. */
  #scrubIdentityEmails() {
    const meta = this.state.meta;
    let changed = false;
    for (const a of Object.values(meta.accounts ?? {})) {
      if (!a.identities?.some((i) => 'email' in i || !i.subject)) continue;
      a.identities = a.identities.filter((i) => i.subject).map(({ email, emailVerified, ...rest }) => rest);
      changed = true;
    }
    for (const r of this.store.listAudit({ limit: -1, actions: ['identity-linked', 'identity-unlinked', 'identity-pinned'] })) {
      if (!r.detail || !('email' in r.detail)) continue;
      const { email, ...rest } = r.detail;
      this.store.setAuditDetail(r.seq, rest);
    }
    return changed;
  }

  // ---------------- meta-model (Feature #12) ----------------
  /* The workspace's structure, as rows. A Workspace system space holds
     `Spaces` (rows = the spaces) and `Tables` (rows = the tables, each
     related to its space's row). The rows are REAL entities, so relations,
     automations and custom fields work on structure for free. The engine's
     own verbs keep both directions in step: a structural verb writes its row,
     a row verb on a system table translates into the structural verb —
     #inMetaSync marks which side started it, so the loop terminates. */
  #inMetaSync = false;
  /* Feature #219 — the registry lives once, at the hub root. A member engine
     points at the root that holds its rows (registryHost); the root lists
     its members so a row edit can find the engine whose structure the row
     describes. Every registry helper reads through #reg. */
  registryHost = null;
  members = [];
  get #reg() { return this.registryHost ?? this; }
  #engines() { const r = this.#reg; return [r, ...r.members]; }
  #engineOf(wsId) {
    if (!wsId || wsId === this.state.meta.id) return this;
    return this.#engines().find((w) => w.state.meta.id === wsId) ?? this;
  }
  /* The workspace a registry row belongs to: the Workspaces row itself, or
     the one its Workspace relation names. */
  #wsIdOfRow(row) {
    const reg = this.#reg;
    const db = reg.state.tables[row.dbId];
    if (!db?.system) return null;
    if (db.system === 'workspaces') return row.sysId ?? null;
    const f = this.#sysField(db, 'Workspace');
    const wsRow = f && row.values[f.id] ? reg.state.entities[row.values[f.id]] : null;
    return wsRow?.sysId ?? null;
  }
  #ownerOf(row) { return this.#engineOf(this.#wsIdOfRow(row)); }
  /* Table ids are uuids, so one id names a table across every engine. */
  #tableAnywhere(id) {
    for (const w of this.#engines()) { const table = own(w.state.tables, id); if (table) return { owner: w, table }; }
    return null;
  }
  #fieldAnywhere(fieldId) {
    for (const w of this.#engines()) {
      const table = Object.values(w.state.tables).find((t) => own(t.fields, fieldId));
      if (table) return { owner: w, table, field: table.fields[fieldId] };
    }
    return null;
  }

  /* Join the root's registry: mint nothing here, tombstone a legacy local
     Workspace space (rows kept), carry its space rollups to the root Spaces
     table, then project this workspace's structure as root rows. Idempotent. */
  joinRegistry(root) {
    if (root === this) throw new WeaveError('A workspace cannot join its own registry', 'invalid');
    this.registryHost = root;
    if (!root.members.includes(this)) root.members.push(this);
    let dirty = false;
    if (this.state.meta.registry !== 'hub') { this.state.meta.registry = 'hub'; dirty = true; }
    const rollups = [];
    for (const sp of Object.values(this.state.spaces)) {
      if (sp.system !== 'workspace' || sp.deletedAt) continue;
      sp.deletedAt = nowISO();
      dirty = true;
      for (const t of Object.values(this.state.tables)) {
        if (t.spaceId !== sp.id || t.deletedAt) continue;
        if (t.system === 'spaces') for (const f of Object.values(t.fields)) if (f.type === 'rollup' && f.config.via) rollups.push(f);
        t.deletedAt = nowISO();
      }
    }
    if (dirty) this.save();
    this.#syncAll();
    const spacesT = root.#sysTable('spaces');
    for (const f of rollups) {
      const via = this.state.tables[f.config.via];
      if (!via || via.deletedAt) continue;
      const name = root.findField(spacesT, f.name) ? `${f.name} (${this.state.meta.name})` : f.name;
      if (root.findField(spacesT, name)) continue;
      const config = { via: f.config.via, aggregate: f.config.aggregate, ...(f.config.targetField ? { targetField: f.config.targetField } : {}), ...(f.config.where ? { where: f.config.where } : {}) };
      try { root.addField(spacesT.id, { name, type: 'rollup', config }); } catch { /* an unresolvable rollup stays in the tombstone */ }
    }
    // A member's rules move to the root's Workflows table (Feature #249),
    // and the rows that name it can be judged now that its tables are seen.
    this.#migrateAutomations();
    root.#settleWorkflows();
    return this;
  }

  /* The inverse: this engine is the hub root again (or served alone). The
     tombstoned space comes back and the registry re-syncs into it. */
  hostRegistry() {
    if (this.state.meta.registry !== 'hub') return this;
    delete this.state.meta.registry;
    this.registryHost = null;
    for (const sp of Object.values(this.state.spaces)) {
      if (sp.system !== 'workspace') continue;
      sp.deletedAt = null;
      for (const t of Object.values(this.state.tables)) if (t.spaceId === sp.id) t.deletedAt = null;
    }
    this.#ensureMetaTables();
    this.save();
    return this;
  }

  /* A workspace leaves the hub: its rows leave the registry. */
  dropWorkspace(wsId) {
    this.members = this.members.filter((m) => m.state.meta.id !== wsId);
    for (const kind of ['views', 'fields', 'tables', 'spaces']) {
      const t = this.#sysTable(kind);
      if (!t) continue;
      for (const row of this.listEntities(t.id, { includeDeleted: true })) {
        if (this.#wsIdOfRow(row) === wsId) this.#metaSync(() => this.deleteEntity(row.id, { hard: true }));
      }
    }
    const wsRow = this.#sysRow('workspaces', wsId);
    if (wsRow) this.#metaSync(() => this.deleteEntity(wsRow.id, { hard: true }));
    this.save();
  }

  #syncAll() {
    if (!this.#sysTable('spaces')) return;
    this.#syncWorkspaceRow();
    for (const sp of Object.values(this.state.spaces)) this.#syncSpaceRow(sp);
    for (const t of Object.values(this.state.tables)) this.#syncTableRow(t);
    for (const t of Object.values(this.state.tables)) {
      if (t.system) continue;
      for (const f of Object.values(t.fields)) this.#syncFieldRow(t, f);
    }
  }

  #syncWorkspaceRow() {
    const t = this.#sysTable('workspaces');
    if (!t) return undefined;
    const reg = this.#reg;
    const meta = this.state.meta;
    const desc = meta.description ?? '';
    let row = this.#sysRow('workspaces', meta.id);
    if (!row) {
      row = reg.#metaSync(() => reg.createEntity(t.id, { name: meta.name, values: { Description: desc } }));
      row.sysId = meta.id;
      reg.#mark(row);
      if (meta.deletedAt) reg.#metaSync(() => reg.deleteEntity(row.id));
      reg.save();
      return row;
    }
    const patch = {};
    if (reg.entityName(row) !== meta.name) patch.Name = meta.name;
    const descF = this.#sysField(t, 'Description');
    if ((row.values[descF.id] ?? '') !== desc) patch.Description = desc;
    if (Object.keys(patch).length) reg.#metaSync(() => reg.updateEntity(row.id, patch));
    // A trashed workspace (hub soft delete) is a trashed row, and back.
    if (!!meta.deletedAt !== !!row.deletedAt) reg.#metaSync(() => (meta.deletedAt ? reg.deleteEntity(row.id) : reg.restoreEntity(row.id)));
    return row;
  }

  /* Re-assert this workspace's rows at the root — the hub calls it after a
     soft delete or a restore, which touch meta without a structural verb. */
  syncRegistry() { this.#syncAll(); return this; }

  #metaSync(fn) {
    const was = this.#inMetaSync;
    this.#inMetaSync = true;
    try { return fn(); } finally { this.#inMetaSync = was; }
  }

  /* ---------------- undo ----------------
     Every entity mutation verb records an inverse-operation entry before it
     returns; undo() pops entries and replays the inverse. Deliberate limits:
     structural work (spaces, tables, fields, registry rows — everything the
     audit log covers) is not undoable, hard deletes and file deletions are
     gone for real, and undo itself fires no automations — stepping back must
     not cascade forward. */
  #inUndo = false;

  #recordUndo(kind, e, data = {}) {
    if (this.#inMetaSync || this.#inUndo) return;
    const db = this.state.tables[e.dbId];
    if (!db || db.system) return;
    this.store.pushUndo({
      ts: nowISO(),
      actor: this.actor,
      kind,
      entityId: e.id,
      table: this.qualifiedName(db),
      publicId: e.publicId,
      name: this.entityName(e),
      data,
    });
  }

  // Sparse before-image of exactly the fields a mutation names.
  #undoBefore(e, db, fieldRefs) {
    const before = { values: {}, docs: {} };
    for (const ref of fieldRefs) {
      const f = typeof ref === 'object' ? ref : this.findField(db, ref);
      if (!f || COMPUTED_TYPES.includes(f.type)) continue;
      if (f.type === 'document') before.docs[f.id] = e.docs?.[f.id] ?? '';
      else before.values[f.id] = structuredClone(e.values[f.id] ?? null);
    }
    return before;
  }

  #undoChanged(e, before) {
    for (const [fid, prev] of Object.entries(before.values)) {
      if (JSON.stringify(e.values[fid] ?? null) !== JSON.stringify(prev)) return true;
    }
    for (const [fid, prev] of Object.entries(before.docs)) {
      if ((e.docs?.[fid] ?? '') !== prev) return true;
    }
    return false;
  }

  undo({ steps = 1 } = {}) {
    const undone = [];
    this.#inUndo = true;
    try {
      for (let i = 0; i < steps; i++) {
        const entry = this.store.popUndo();
        if (!entry) break;
        const summary = { kind: entry.kind, entity: `${entry.table}#${entry.publicId}`, name: entry.name, ts: entry.ts };
        const e = this.state.entities[entry.entityId];
        if (!e) { undone.push({ ...summary, skipped: 'entity purged' }); continue; }
        const db = this.state.tables[e.dbId];
        switch (entry.kind) {
          case 'create':
          case 'restore':
            this.deleteEntity(e.id);
            break;
          case 'delete':
            this.restoreEntity(e.id);
            break;
          case 'update': {
            const before = entry.data.before ?? { values: {}, docs: {} };
            const fields = [];
            for (const [fid, prev] of Object.entries(before.values)) {
              const f = db.fields[fid];
              if (!f) continue;
              fields.push(f.name);
              if (f.type === 'relation') {
                const ids = prev == null ? [] : Array.isArray(prev) ? prev : [prev];
                this.#setRelationValue(e, db, f, ids.filter((id) => this.state.entities[id]));
              } else {
                e.values[fid] = structuredClone(prev);
              }
            }
            for (const [fid, text] of Object.entries(before.docs)) {
              if (!db.fields[fid]) continue;
              fields.push(db.fields[fid].name);
              const was = e.docs[fid] ?? '';
              e.docs[fid] = text;
              // Stepping back is a write too: the log keeps the step, fresh,
              // so the edit undone stays readable in history.
              if (was !== text) this.#recordDocRevision(e, db.fields[fid], was, text, { fresh: true });
            }
            e.updatedAt = nowISO();
            e.modifiedBy = this.actor;
            this.#logActivity(e, 'undo', { fields });
            this.#mark(e);
            this.save();
            break;
          }
          case 'comment-add':
            e.comments = e.comments.filter((c) => c.id !== entry.data.commentId);
            this.#mark(e);
            this.save();
            break;
          case 'comment-delete':
            e.comments.push(entry.data.comment);
            this.#mark(e);
            this.save();
            break;
          case 'file-attach':
            this.deleteFile(e.id, entry.data.fileId);
            break;
        }
        undone.push(summary);
      }
    } finally {
      this.#inUndo = false;
    }
    return { undone };
  }

  listUndo({ limit = 20 } = {}) {
    return this.store.listUndo({ limit })
      .map(({ data, ...summary }) => ({ ...summary, entity: `${summary.table}#${summary.publicId}` }));
  }

  #sysTable(kind) {
    // A member opened alone (the flag set, no host attached) has no registry:
    // its tombstoned tables must not be written to.
    if (this.state.meta.registry === 'hub' && !this.registryHost) return undefined;
    return Object.values(this.#reg.state.tables).find((t) => t.system === kind && !t.deletedAt);
  }

  #sysRow(kind, sysId) {
    const t = this.#sysTable(kind);
    if (!t) return undefined;
    // Trashed rows count: a trashed table's row still IS its row, and a sync
    // that cannot see it would mint a duplicate.
    return Object.values(this.#reg.state.entities).find((e) => e.dbId === t.id && e.sysId === sysId);
  }

  /* The ids a registry row's relation points at, however it is stored. */
  #relIds(row, table, fieldName) {
    const f = this.#sysField(table, fieldName);
    const v = row.values[f.id];
    return Array.isArray(v) ? v : v == null ? [] : [v];
  }

  #sysField(table, name) {
    return Object.values(table.fields).find((f) => f.name === name);
  }

  /* Idempotent bootstrap: runs on every load and import, so a legacy
     workspace grows its registry the first time a new engine opens it. */
  #ensureMetaTables() {
    const s = this.state;
    let ws = Object.values(s.spaces).find((x) => x.system === 'workspace');
    if (!ws) {
      ws = { id: uuid(), name: 'Workspace', description: 'The workspace itself: its spaces and tables, as rows.', system: 'workspace', createdAt: nowISO() };
      s.spaces[ws.id] = ws;
    }
    const mkTable = (name, kind, description) => {
      const nameF = { id: uuid(), name: 'Name', type: 'text', config: {}, system: true };
      const descF = { id: uuid(), name: 'Description', type: 'text', config: {}, system: true };
      const t = {
        id: uuid(), spaceId: ws.id, name, description, icon: '', system: kind,
        publicIdCounter: 0, nameFieldId: nameF.id,
        fields: { [nameF.id]: nameF, [descF.id]: descF },
        fieldOrder: [nameF.id, descF.id], createdAt: nowISO(),
      };
      this.#ensureTableViews(t);
      s.tables[t.id] = t;
      return t;
    };
    const spacesT = this.#sysTable('spaces')
      ?? mkTable('Spaces', 'spaces', 'Every space in this workspace, as a row. Creating a row creates the space; renaming it renames the space; hard-deleting it deletes the space and everything in it.');
    // Feature #261: a space is a template when this box is ticked. Minted on
    // every open, so a workspace made before it gains the column.
    if (!this.#sysField(spacesT, 'Template')) this.addField(spacesT.id, { name: 'Template', type: 'checkbox' }).system = true;
    const tablesT = this.#sysTable('tables')
      ?? mkTable('Tables', 'tables', 'Every table in this workspace, as a row related to its space. Creating a row creates the table; renaming it renames the table; hard-deleting it deletes the table and its rows.');
    if (!this.#sysField(tablesT, 'Space')) {
      const { field, inverse } = this.addRelation(tablesT.id, { name: 'Space', targetDb: spacesT.id, cardinality: 'many-to-one', inverseName: 'Tables' });
      field.system = true;
      inverse.system = true;
    }
    // A table's configuration IS fields on its row (Kyle, 2026-08-24): the
    // visible column order and the hidden columns, as comma-separated names.
    // Editing them edits the table — #interceptUpdate routes them through
    // updateTable, which validates exactly as the schema verb does.
    if (!this.#sysField(tablesT, 'Field Order')) this.addField(tablesT.id, { name: 'Field Order', type: 'text' }).system = true;
    if (!this.#sysField(tablesT, 'Hidden Fields')) this.addField(tablesT.id, { name: 'Hidden Fields', type: 'text' }).system = true;
    if (!this.#sysField(tablesT, 'Filter')) this.addField(tablesT.id, { name: 'Filter', type: 'text' }).system = true;
    if (!this.#sysField(tablesT, 'Sort')) this.addField(tablesT.id, { name: 'Sort', type: 'text' }).system = true;
    if (!this.#sysField(tablesT, 'Hide Rollups')) this.addField(tablesT.id, { name: 'Hide Rollups', type: 'checkbox' }).system = true;
    const fieldsT = this.#sysTable('fields')
      ?? mkTable('Fields', 'fields', 'Every field of every table, as a row related to its table and carrying its definition. Creating a row creates the column; renaming it renames the column; editing its Definition changes the config; hard-deleting it deletes the column.');
    if (!this.#sysField(fieldsT, 'Table')) {
      const { field, inverse } = this.addRelation(fieldsT.id, { name: 'Table', targetDb: tablesT.id, cardinality: 'many-to-one', inverseName: 'Fields' });
      field.system = true;
      inverse.system = true;
    }
    if (!this.#sysField(fieldsT, 'Type')) this.addField(fieldsT.id, { name: 'Type', type: 'text' }).system = true;
    // Depth 4 (the cap): the registry must describe field-type columns, which
    // are themselves definitions one level down. A depth-4 field column is the
    // one shape the registry cannot hold — #syncFieldRow leaves it empty.
    if (!this.#sysField(fieldsT, 'Definition')) this.addField(fieldsT.id, { name: 'Definition', type: 'field', config: { depth: 4 } }).system = true;
    /* Table views (Feature #229): configuration as field values on a row, per
       the 2026-08-28 ruling — one row per view, related to its table. A row
       edit runs the view verb (#interceptUpdate), so its validation is the
       verb's. Blank has no row: it is never stored. */
    const viewsT = this.#sysTable('views')
      ?? mkTable('Views', 'views', 'Every view over every table, as a row related to its table: the columns it shows in order, its state filter and its sort. The first view of a table is its default. Creating a row creates the view; editing it edits the view; deleting it deletes the view.');
    if (!this.#sysField(viewsT, 'Table')) {
      const { field, inverse } = this.addRelation(viewsT.id, { name: 'Table', targetDb: tablesT.id, cardinality: 'many-to-one', inverseName: 'Views' });
      field.system = true;
      inverse.system = true;
    }
    for (const [n, type] of [['Fields', 'text'], ['Filter', 'text'], ['Sort', 'text'], ['Default', 'checkbox'], ['Position', 'number'], ['Frozen', 'number'], ['Widths', 'text'], ['Density', 'text'], ['Show Deleted', 'checkbox'], ['Rollup Row', 'checkbox']]) {
      if (!this.#sysField(viewsT, n)) this.addField(viewsT.id, { name: n, type, ...(type === 'number' ? { config: { decimals: 0 } } : {}) }).system = true;
    }
    /* Workflows (Kyle, 2026-08-24): a system table whose rows are DATA —
       one row per workflow — not a mirror of structure. It lives beside the
       registries because a workflow belongs to the workspace, not to any one
       table. The Type select ships EMPTY on purpose: workflow types are
       designed and rolled out later; the field is the socket they plug into. */
    const wfT = this.#sysTable('workflows')
      ?? mkTable('Workflows', 'workflows', 'Every workflow in this workspace, as a row: an On switch, the tables and spaces it touches, its executable script, version, state, health, last run, and a mermaid diagram of itself.');
    if (!this.#sysField(wfT, 'Tables')) {
      const { field, inverse } = this.addRelation(wfT.id, { name: 'Tables', targetDb: tablesT.id, cardinality: 'many-to-many', inverseName: 'Workflows' });
      field.system = true;
      inverse.system = true;
    }
    if (!this.#sysField(wfT, 'Spaces')) {
      const { field, inverse } = this.addRelation(wfT.id, { name: 'Spaces', targetDb: spacesT.id, cardinality: 'many-to-many', inverseName: 'Workflows' });
      field.system = true;
      inverse.system = true;
    }
    if (!this.#sysField(wfT, 'Script')) this.addField(wfT.id, { name: 'Script', type: 'document', config: { kind: 'code' } }).system = true;
    if (!this.#sysField(wfT, 'Version')) this.addField(wfT.id, { name: 'Version', type: 'number', config: { decimals: 0 } }).system = true;
    /* State is setup (Kyle, 2026-10-03): the engine computes it from whether
       the row's rule is valid, so Draft / Active / Deactivated became Setup
       incomplete / Ready — Deactivated said what Off says. A workspace that
       still carries the old three is rewritten here; #settleWorkflow puts
       every row back on one of the two. */
    const stateF = this.#sysField(wfT, 'State');
    if (!stateF) {
      this.addField(wfT.id, { name: 'State', type: 'workflow', config: { states: WORKFLOW_STATES } }).system = true;
    } else if (stateF.config.states.map((s) => s.name).join() !== WORKFLOW_STATES.map((s) => s.name).join()) {
      stateF.config = normalizeSelfContainedConfig('workflow', { states: WORKFLOW_STATES });
      this.save();
    }
    if (!this.#sysField(wfT, 'Health')) {
      // Ramp hues, not loose colour words: `yellow` is not one of weave's ten
      // names, so all three of these stored slate and the health column read
      // grey (Issue #551).
      this.addField(wfT.id, { name: 'Health', type: 'select', config: { options: [
        { name: 'Healthy', hue: 'green' },
        { name: 'Warning', hue: 'amber' },
        { name: 'Failed', hue: 'red' },
        { name: 'No runs', hue: 'slate' },
      ] } }).system = true;
    }
    // Health is runtime (Kyle, 2026-10-03): a row that never fired reads No
    // runs, and the reason a row Failed sits beside it for the hover.
    const healthF = this.#sysField(wfT, 'Health');
    if (!healthF.config.options.some((o) => o.name === 'No runs')) {
      healthF.config.options.push(normaliseOption({ name: 'No runs', hue: 'slate' }));
      this.save();
    }
    if (!this.#sysField(wfT, 'Health Reason')) this.addField(wfT.id, { name: 'Health Reason', type: 'text' }).system = true;
    if (!this.#sysField(wfT, 'Last Run')) this.addField(wfT.id, { name: 'Last Run', type: 'date', config: { time: true } }).system = true;
    if (!this.#sysField(wfT, 'Diagram')) this.addField(wfT.id, { name: 'Diagram', type: 'document' }).system = true;
    if (!this.#sysField(wfT, 'Type')) this.addField(wfT.id, { name: 'Type', type: 'select', config: { options: [] } }).system = true;
    /* The table is the control panel (Feature #249, Kyle 2026-10-02): every
       workflow row carries an On switch, worded On / Off and off until
       someone switches it. It leads the row's own columns, straight after
       Name, in the schema order and in every view; that move happens only
       when the field is minted, so a reader who moves it later keeps their
       order. The engine reads it before every fire and never writes it. */
    if (!this.#sysField(wfT, 'On')) {
      const on = this.addField(wfT.id, { name: 'On', type: 'toggle', config: { on: 'On', off: 'Off' } });
      on.system = true;
      const lead = (ids) => {
        ids.splice(ids.indexOf(on.id), 1);
        ids.splice(ids.indexOf(wfT.nameFieldId) + 1, 0, on.id);
      };
      lead(wfT.fieldOrder);
      for (const v of wfT.tableViews ?? []) if (v.fields.includes(on.id)) lead(v.fields);
      this.save();
    }
    /* Workspaces (Feature #219): the level-1 row. One registry serves every
       workspace the hub holds, so each registry table relates its rows back
       to the workspace they describe — uno's tables and test's sit side by
       side under one Workspace column. */
    const wsT = this.#sysTable('workspaces')
      ?? mkTable('Workspaces', 'workspaces', 'Every workspace this weave serves, as a row: the hub root and every member workspace. Its spaces, tables, fields and workflows relate back to it. Workspaces are created and deleted from the hub, not as rows.');
    for (const [t, inverseName] of [[spacesT, 'Spaces'], [tablesT, 'Tables'], [fieldsT, 'Fields'], [wfT, 'Workflows'], [viewsT, 'Views']]) {
      if (this.#sysField(t, 'Workspace')) continue;
      const { field, inverse } = this.addRelation(t.id, { name: 'Workspace', targetDb: wsT.id, cardinality: 'many-to-one', inverseName });
      field.system = true;
      inverse.system = true;
    }
    this.#syncAll();
    this.#migrateAutomations();
    this.#settleWorkflows();
  }

  /* ---------------- registry integrity (Issue: drifted links) ----------------

     The registry is only true if both directions agree: a Fields row belongs
     to the Tables row of the table that actually owns the column, and a Tables
     row to its Spaces row. Both links used to be written once, at row
     creation, and never looked at again — so a link that was wrong, or that
     could not be written yet because the parent row did not exist during a
     legacy backfill, stayed wrong forever and the two sides disagreed about
     which fields a table has. The syncs now re-assert the link, and these two
     verbs make the state inspectable and repairable on demand. */

  registryReport() {
    const problems = [];
    const rowOf = (kind, sysId) => this.#sysRow(kind, sysId);
    const relIds = (row, table, fieldName) => this.#relIds(row, table, fieldName);
    const tablesT = this.#sysTable('tables');
    const fieldsT = this.#sysTable('fields');
    if (!tablesT || !fieldsT) return { problems, rows: 0 };

    let rows = 0;
    // The root reports on every workspace it serves; a member on itself.
    const engines = this.registryHost ? [this] : [this, ...this.members];
    const mine = new Set(engines.map((w) => w.state.meta.id));
    for (const db of engines.flatMap((w) => w.listTables())) {
      if (db.system) continue;
      const tableRow = rowOf('tables', db.id);
      if (!tableRow) { problems.push({ kind: 'table', name: this.qualifiedName(db), problem: 'no registry row' }); continue; }
      rows++;
      const spaceRow = rowOf('spaces', db.spaceId);
      if (spaceRow && !relIds(tableRow, tablesT, 'Space').includes(spaceRow.id)) {
        problems.push({ kind: 'table', name: this.qualifiedName(db), problem: 'row is not registered to its space' });
      }
      for (const f of Object.values(db.fields)) {
        const fieldRow = rowOf('fields', f.id);
        if (!fieldRow) { problems.push({ kind: 'field', name: `${db.name}.${f.name}`, problem: 'no registry row' }); continue; }
        rows++;
        if (!relIds(fieldRow, fieldsT, 'Table').includes(tableRow.id)) {
          problems.push({ kind: 'field', name: `${db.name}.${f.name}`, problem: 'row is not registered to its table' });
        }
      }
    }
    // Rows describing something the schema no longer has.
    const reg = this.#reg;
    for (const [kind, sysTable, lookup] of [
      ['table', tablesT, (id) => this.#tableAnywhere(id)],
      ['field', fieldsT, (id) => this.#fieldOwner(id)],
      ['view', this.#sysTable('views'), (id) => this.#viewAnywhere(id)],
    ]) {
      if (!sysTable) continue;
      for (const row of reg.listEntities(sysTable.id)) {
        if (!mine.has(this.#wsIdOfRow(row))) continue; // another workspace's slice
        if (row.sysId && !lookup(row.sysId)) {
          problems.push({ kind, name: this.entityName(row), problem: 'row describes nothing that exists', rowId: row.id });
        }
      }
    }
    return { problems, rows };
  }

  /* Re-run every sync, then drop rows that describe nothing. Idempotent: a
     clean workspace reports zero repairs. */
  rebuildRegistry() {
    const before = this.registryReport().problems;
    const engines = this.registryHost ? [this] : [this, ...this.members];
    for (const w of engines) w.#syncAll();
    const reg = this.#reg;
    for (const p of before) {
      if (p.problem === 'row describes nothing that exists' && p.rowId) {
        const row = reg.state.entities[p.rowId];
        if (row) reg.#metaSync(() => reg.deleteEntity(row.id, { hard: true }));
      }
    }
    reg.save();
    const after = this.registryReport().problems;
    return { repaired: before.length - after.length, remaining: after };
  }

  #syncSpaceRow(space) {
    // The system Workspace space gets a row too (Issue #126): the table says
    // "every space in this workspace, as a row", and it meant it. Deleting
    // the row is refused downstream — deleteSpace guards system spaces.
    const t = this.#sysTable('spaces');
    if (!t) return undefined; // mid-bootstrap
    if (space.system && this.registryHost) return undefined; // a member's tombstone
    const reg = this.#reg;
    const wsRow = this.#sysRow('workspaces', this.state.meta.id);
    let row = this.#sysRow('spaces', space.id);
    if (!row) {
      row = reg.#metaSync(() => reg.createEntity(t.id, { name: space.name, values: { Description: space.description ?? '', ...(space.template && this.#sysField(t, 'Template') ? { Template: true } : {}), ...(wsRow ? { Workspace: wsRow.id } : {}) } }));
      row.sysId = space.id;
      reg.#mark(row);
      if (space.deletedAt) reg.#metaSync(() => reg.deleteEntity(row.id));
      reg.save();
      return row;
    }
    const patch = {};
    if (reg.entityName(row) !== space.name) patch.Name = space.name;
    const descF = this.#sysField(t, 'Description');
    if ((row.values[descF.id] ?? '') !== (space.description ?? '')) patch.Description = space.description ?? '';
    if (wsRow && !this.#relIds(row, t, 'Workspace').includes(wsRow.id)) patch.Workspace = wsRow.id;
    const templateF = this.#sysField(t, 'Template');
    if (templateF && !!row.values[templateF.id] !== !!space.template) patch.Template = !!space.template;
    if (Object.keys(patch).length) reg.#metaSync(() => reg.updateEntity(row.id, patch));
    return row;
  }

  #syncTableRow(db) {
    // System tables register themselves like any other (Issue #126) — the
    // registry describes the whole workspace, its own plumbing included.
    // deleteTable refuses system tables, so the row cannot take them down.
    const t = this.#sysTable('tables');
    if (!t) return undefined;
    if (db.system && this.registryHost) return undefined; // a member's tombstone
    const reg = this.#reg;
    const wsRow = this.#sysRow('workspaces', this.state.meta.id);
    const spaceRow = this.#sysRow('spaces', db.spaceId);
    let row = this.#sysRow('tables', db.id);
    if (!row) {
      row = reg.#metaSync(() => reg.createEntity(t.id, {
        name: db.name,
        values: { Description: db.description ?? '', ...(spaceRow ? { Space: spaceRow.id } : {}), ...(wsRow ? { Workspace: wsRow.id } : {}) },
      }));
      row.sysId = db.id;
      reg.#mark(row);
      if (db.deletedAt) reg.#metaSync(() => reg.deleteEntity(row.id));
      reg.save();
      // Fall through: the configuration columns are written by the patch
      // below, so a row minted by a member's join carries them at once.
    }
    const patch = {};
    if (reg.entityName(row) !== db.name) patch.Name = db.name;
    const descF = this.#sysField(t, 'Description');
    if ((row.values[descF.id] ?? '') !== (db.description ?? '')) patch.Description = db.description ?? '';
    // The link, every time — not only at creation. A row created mid-bootstrap
    // has no space row to point at yet, and nothing ever went back for it.
    if (spaceRow && !this.#relIds(row, t, 'Space').includes(spaceRow.id)) patch.Space = spaceRow.id;
    if (wsRow && !this.#relIds(row, t, 'Workspace').includes(wsRow.id)) patch.Workspace = wsRow.id;
    // Configuration as fields: the column order and the hidden columns.
    const orderF = this.#sysField(t, 'Field Order');
    if (orderF) {
      const order = db.fieldOrder.map((id) => db.fields[id]?.name).filter(Boolean).join(', ');
      if ((row.values[orderF.id] ?? '') !== order) patch['Field Order'] = order;
    }
    // Hidden Fields, Filter and Sort are the default view's (Feature #229).
    const dv = this.#defaultViewConfig(db);
    const hiddenF = this.#sysField(t, 'Hidden Fields');
    if (hiddenF) {
      const hidden = (dv.hiddenFields ?? []).join(', ');
      if ((row.values[hiddenF.id] ?? '') !== hidden) patch['Hidden Fields'] = hidden;
    }
    const filterF = this.#sysField(t, 'Filter');
    if (filterF) {
      const txt = formatFilters(dv.filters);
      if ((row.values[filterF.id] ?? '') !== txt) patch.Filter = txt;
    }
    const sortF = this.#sysField(t, 'Sort');
    if (sortF) {
      const txt = formatSort(dv.sort);
      if ((row.values[sortF.id] ?? '') !== txt) patch.Sort = txt;
    }
    const hideF = this.#sysField(t, 'Hide Rollups');
    // Checked is hidden, and a table nobody opted in is hidden (Issue #249).
    if (hideF && !!row.values[hideF.id] !== (db.hideRollups !== false)) patch['Hide Rollups'] = db.hideRollups !== false;
    if (Object.keys(patch).length) reg.#metaSync(() => reg.updateEntity(row.id, patch));
    this.#syncViewRows(db, row);
    return row;
  }

  /* One Workspace/Views row per table view (Feature #229), related to the
     table's row: Fields, Filter and Sort as text, Default and Position as the
     strip says. Every table change passes through #syncTableRow, so a field
     added, renamed or dropped rewrites the Fields text here too. */
  #syncViewRows(db, tableRow) {
    const t = this.#sysTable('views');
    // Mid-bootstrap the table exists before its columns do; #syncAll comes back.
    if (!t || !db.tableViews || !this.#sysField(t, 'Position') || !this.#sysField(t, 'Workspace')) return;
    const reg = this.#reg;
    const wsRow = this.#sysRow('workspaces', this.state.meta.id);
    db.tableViews.forEach((v, i) => {
      const want = {
        Name: v.name,
        Fields: v.fields.map((id) => viewEntryName(db, id)).filter(Boolean).join(', '),
        Filter: formatFilters(v.filters),
        Sort: formatSort(v.sort),
        Default: i === 0,
        Position: i,
        // Feature #233: the frozen count and the widths, as the verb reads them.
        Frozen: v.frozen ?? 0,
        Widths: formatWidths(this.#viewOut(db, v).widths),
        // Feature #239: blank is the default, Comfortable.
        Density: v.density ?? '',
        // Issue #442: what the grid draws, the table's opt-in when the view is silent.
        'Show Deleted': !!v.deleted,
        'Rollup Row': typeof v.rollups === 'boolean' ? v.rollups : db.hideRollups === false,
      };
      let row = this.#sysRow('views', v.id);
      if (!row) {
        row = reg.#metaSync(() => reg.createEntity(t.id, {
          name: v.name,
          values: { ...want, Table: tableRow.id, ...(wsRow ? { Workspace: wsRow.id } : {}) },
        }));
        row.sysId = v.id;
        reg.#mark(row);
        if (db.deletedAt) reg.#metaSync(() => reg.deleteEntity(row.id));
        reg.save();
        return;
      }
      const patch = {};
      if (reg.entityName(row) !== v.name) patch.Name = v.name;
      for (const k of ['Fields', 'Filter', 'Sort', 'Default', 'Position', 'Frozen', 'Widths', 'Density', 'Show Deleted', 'Rollup Row']) {
        const f = this.#sysField(t, k);
        if (!f) continue;
        if ((row.values[f.id] ?? (['Default', 'Show Deleted', 'Rollup Row'].includes(k) ? false : k === 'Frozen' ? 0 : '')) !== want[k]) patch[k] = want[k];
      }
      if (!this.#relIds(row, t, 'Table').includes(tableRow.id)) patch.Table = tableRow.id;
      if (wsRow && !this.#relIds(row, t, 'Workspace').includes(wsRow.id)) patch.Workspace = wsRow.id;
      if (Object.keys(patch).length) reg.#metaSync(() => reg.updateEntity(row.id, patch));
    });
  }

  /* A view id names one view across every engine the registry serves. */
  #viewAnywhere(viewId) {
    for (const w of this.#engines()) {
      for (const table of Object.values(w.state.tables)) {
        const view = table.tableViews?.find((v) => v.id === viewId);
        if (view) return { owner: w, table, view };
      }
    }
    return null;
  }

  /* One row per field of every user table (Feature #52). DEFINABLE types
     carry their shape as a `field` value; relations and computed fields are
     rows too — the registry is complete — but their Definition stays empty
     and their shape belongs to the schema verbs that understand them. */
  #syncFieldRow(db, f) {
    if (db.system) return undefined;
    const t = this.#sysTable('fields');
    if (!t) return undefined;
    const tableRow = this.#sysRow('tables', db.id);
    if (!tableRow) return undefined;
    const reg = this.#reg;
    const wsRow = this.#sysRow('workspaces', this.state.meta.id);
    const definable = DEFINABLE_TYPES.includes(f.type) && !(f.type === 'field' && (f.config.depth ?? 1) >= 4);
    let row = this.#sysRow('fields', f.id);
    if (!row) {
      row = reg.#metaSync(() => reg.createEntity(t.id, {
        name: f.name,
        values: {
          Table: tableRow.id,
          Type: f.type,
          ...(wsRow ? { Workspace: wsRow.id } : {}),
          ...(definable ? { Definition: { type: f.type, config: f.config } } : {}),
        },
      }));
      row.sysId = f.id;
      reg.#mark(row);
      reg.save();
      return row;
    }
    const patch = {};
    if (reg.entityName(row) !== f.name) patch.Name = f.name;
    if (definable) patch.Definition = { type: f.type, config: f.config };
    // Same repair as the table row's Space: the registry is only true if the
    // row belongs to the table whose column it describes.
    if (!this.#relIds(row, t, 'Table').includes(tableRow.id)) patch.Table = tableRow.id;
    if (wsRow && !this.#relIds(row, t, 'Workspace').includes(wsRow.id)) patch.Workspace = wsRow.id;
    if (Object.keys(patch).length) reg.#metaSync(() => reg.updateEntity(row.id, patch));
    return row;
  }

  #dropFieldRow(fieldId) {
    const row = this.#sysRow('fields', fieldId);
    const reg = this.#reg;
    if (row) reg.#metaSync(() => reg.deleteEntity(row.id, { hard: true }));
  }

  /* The table a field id belongs to — the registry's way back to the schema. */
  #fieldOwner(fieldId) {
    return this.#fieldAnywhere(fieldId)?.table;
  }

  #dropSysRow(kind, sysId) {
    const row = this.#sysRow(kind, sysId);
    const reg = this.#reg;
    if (row) reg.#metaSync(() => reg.deleteEntity(row.id, { hard: true }));
  }

  /* Structure trash mirrored onto the registry: the row is soft-deleted with
     the structure and restored with it, so the registry trash lists trashed
     tables and spaces the way a table's trash lists its rows. */
  #trashSysRow(kind, sysId) {
    const row = this.#sysRow(kind, sysId);
    const reg = this.#reg;
    if (row && !row.deletedAt) reg.#metaSync(() => reg.deleteEntity(row.id));
  }

  #restoreSysRow(kind, sysId) {
    const row = this.#sysRow(kind, sysId);
    const reg = this.#reg;
    if (row?.deletedAt) reg.#metaSync(() => reg.restoreEntity(row.id));
  }

  /* Row-side verbs arriving at a system table translate into the structural
     verb; that verb's own sync writes the row, so both directions share one
     path. Returns undefined when the call should proceed as a plain row op. */
  #interceptCreate(db, input) {
    if (!db.system || this.#inMetaSync) return undefined;
    // Only the registries mirror structure; rows of other system tables
    // (Workflows) are ordinary data and take the ordinary path — a blank
    // row from the grid foot included (Issue #241).
    if (db.system === 'workspaces') throw new WeaveError('A workspace is created from the hub (POST /api/workspaces), not as a row', 'invalid');
    if (db.system === 'workflows') {
      const values = { ...Object.fromEntries(Object.entries(input ?? {}).filter(([k]) => !CREATE_INPUT_KEYS.has(k))), ...(input?.values ?? {}) };
      this.#guardWorkflowOn(null, db, values, input?.docs);
      return undefined;
    }
    if (!['spaces', 'tables', 'fields', 'views'].includes(db.system)) return undefined;
    const flat = Object.fromEntries(Object.entries(input ?? {}).filter(([k]) => !['name', 'values', 'doc', 'docs'].includes(k)));
    const values = { ...flat, ...(input?.values ?? {}) };
    const name = input?.name ?? values.Name;
    if (!name) throw new WeaveError('Name is required', 'invalid');
    const description = values.Description ?? '';
    delete values.Name;
    delete values.Description;
    let made;
    // The row's Workspace follows the structure it describes (Feature #219):
    // a Spaces create names it (the root by default); a Tables or Fields
    // create inherits the parent row's.
    const wsRef = values.Workspace;
    delete values.Workspace;
    if (db.system === 'spaces') {
      let owner = this;
      if (wsRef != null) {
        // The row, or the workspace's own id (what a member page knows).
        const wsRow = this.findEntity(this.#sysTable('workspaces').id, wsRef) ?? this.#sysRow('workspaces', wsRef);
        if (!wsRow) throw new WeaveError(`Workspace row '${wsRef}' not found`, 'not-found');
        owner = this.#engineOf(wsRow.sysId);
      }
      const template = !!values.Template;
      delete values.Template;
      made = this.#sysRow('spaces', owner.createSpace({ name, description, template }).id);
    } else if (db.system === 'tables') {
      const spaceRef = values.Space;
      delete values.Space;
      if (spaceRef == null) throw new WeaveError(`A Tables row needs its 'Space' — which space the table lives in`, 'invalid');
      const spaceRow = this.findEntity(this.#sysTable('spaces').id, spaceRef);
      if (!spaceRow) throw new WeaveError(`Space row '${spaceRef}' not found`, 'not-found');
      const owner = this.#ownerOf(spaceRow);
      // The Workspace space registers itself as a row (Issue #126); user
      // tables still belong in user spaces.
      if (owner.state.spaces[spaceRow.sysId]?.system) {
        throw new WeaveError(`Space '${this.entityName(spaceRow)}' is part of the system registry — create tables in your own spaces`, 'invalid');
      }
      made = this.#sysRow('tables', owner.createTable({ space: spaceRow.sysId, name, description }).id);
    } else if (db.system === 'fields') {
      const tableRef = values.Table;
      const def = values.Definition;
      delete values.Table;
      delete values.Definition;
      delete values.Type; // derived from the definition, never written directly
      if (tableRef == null) throw new WeaveError(`A Fields row needs its 'Table' — which table the column lands on`, 'invalid');
      if (!def || typeof def !== 'object' || !def.type) throw new WeaveError(`A Fields row needs its 'Definition' — the column's shape`, 'invalid');
      const tableRow = this.findEntity(this.#sysTable('tables').id, tableRef);
      if (!tableRow) throw new WeaveError(`Table row '${tableRef}' not found`, 'not-found');
      const owner = this.#ownerOf(tableRow);
      // System tables register rows too (Issue #126), so this door now sees
      // them — their columns are weave's own plumbing, not a place for user
      // fields, and a field row would never sync back (#syncFieldRow skips).
      if (owner.state.tables[tableRow.sysId]?.system) {
        throw new WeaveError(`Table '${this.entityName(tableRow)}' is part of the system registry — its columns are fixed`, 'invalid');
      }
      const f = owner.addField(tableRow.sysId, { name, type: def.type, config: def.config ?? {} });
      made = this.#sysRow('fields', f.id);
    } else if (db.system === 'views') {
      const tableRef = values.Table;
      delete values.Table;
      if (tableRef == null) throw new WeaveError(`A Views row needs its 'Table' — which table the view is over`, 'invalid');
      const tableRow = this.findEntity(this.#sysTable('tables').id, tableRef);
      if (!tableRow) throw new WeaveError(`Table row '${tableRef}' not found`, 'not-found');
      const owner = this.#ownerOf(tableRow);
      const v = owner.tableView(`${tableRow.sysId}/${name}`, { from: 'blank', ...this.#viewRowPatch(values, null) });
      made = this.#sysRow('views', v.id);
      if (description) values.Description = description;
    } else {
      return undefined;
    }
    if (Object.keys(values).length) this.#metaSync(() => this.updateEntity(made.id, values));
    return this.getEntity(made.id);
  }

  #interceptUpdate(e, db, valuesByName) {
    if (!db.system || this.#inMetaSync) return undefined;
    // Only the registries mirror structure; rows of other system tables
    // (Workflows) are ordinary data and take the ordinary path.
    if (db.system === 'workspaces') {
      // ponytail: Description routes to the workspace; a rename must move the
      // hub's name index too, so it stays on the workspace page for now.
      const patch = { ...valuesByName };
      if ('Name' in patch) throw new WeaveError("Rename a workspace from its own page — the hub's name index moves with it", 'invalid');
      if ('Description' in patch) { this.#engineOf(e.sysId).updateWorkspace({ description: patch.Description }); delete patch.Description; }
      if (Object.keys(patch).length) this.#metaSync(() => this.updateEntity(e.id, patch));
      return this.getEntity(e.id);
    }
    if (db.system === 'workflows') { this.#guardWorkflowOn(e, db, valuesByName); return undefined; }
    if (!['spaces', 'tables', 'fields', 'views'].includes(db.system)) return undefined;
    const patch = { ...valuesByName };
    if ('Workspace' in patch) {
      const next = patch.Workspace == null ? null : this.findEntity(this.#sysTable('workspaces').id, patch.Workspace)?.id;
      if (next !== (e.values[this.#sysField(db, 'Workspace').id] ?? null)) throw new WeaveError("A row's Workspace follows the structure it describes and cannot move", 'invalid');
      delete patch.Workspace;
    }
    if (db.system === 'views') {
      const hit = this.#viewAnywhere(e.sysId);
      if (!hit) throw new WeaveError(`View row '${this.entityName(e)}' describes no view`, 'not-found');
      if ('Table' in patch) {
        const next = patch.Table == null ? null : this.findEntity(this.#sysTable('tables').id, patch.Table)?.id;
        if (next !== (e.values[this.#sysField(db, 'Table').id] ?? null)) throw new WeaveError('A view cannot move between tables', 'invalid');
        delete patch.Table;
      }
      const vp = this.#viewRowPatch(patch, hit.table.tableViews[0] === hit.view, hit.owner.#viewOut(hit.table, hit.view));
      if (Object.keys(vp).length) hit.owner.tableView(`${hit.table.id}/${hit.view.id}`, vp);
    } else if (db.system === 'fields') {
      const hit = this.#fieldAnywhere(e.sysId);
      const owner = hit?.table;
      const f = hit?.field;
      if ('Type' in patch) throw new WeaveError(`'Type' follows the Definition — change the definition, not the label`, 'invalid');
      if ('Table' in patch) {
        const next = patch.Table == null ? null : this.findEntity(this.#sysTable('tables').id, patch.Table)?.id;
        const cur = e.values[this.#sysField(db, 'Table').id] ?? null;
        if (next !== cur) throw new WeaveError('A field cannot move between tables', 'invalid');
        delete patch.Table;
      }
      if ('Name' in patch) {
        hit.owner.updateField(owner.id, f.id, { name: patch.Name });
        delete patch.Name;
      }
      if ('Definition' in patch) {
        const def = patch.Definition;
        if (!DEFINABLE_TYPES.includes(f.type)) {
          throw new WeaveError(`A ${f.type} field's shape is edited through the schema verbs, not its Definition`, 'invalid');
        }
        if (!def || def.type !== f.type) {
          throw new WeaveError(`A definition cannot change its type ('${f.type}' → '${def?.type}') — delete the column and create it anew`, 'invalid');
        }
        // A definition names its shape under `config`. The flat descriptor
        // shape describeSchema() hands back used to pass straight through to
        // an empty config: the caller's intent discarded, the call a success
        // (Issue #60). Refusing says which shape the write wanted.
        if (!def.config || typeof def.config !== 'object') {
          throw new WeaveError("A definition carries its shape under `config` — {type, config: {…}}", 'invalid');
        }
        hit.owner.updateField(owner.id, f.id, { config: def.config ?? {} });
        delete patch.Definition;
      }
    } else {
      if (db.system === 'tables' && 'Space' in patch) {
        const spaceF = this.#sysField(db, 'Space');
        const next = patch.Space == null ? null : this.findEntity(this.#sysTable('spaces').id, patch.Space)?.id;
        if (next !== (e.values[spaceF.id] ?? null)) {
          throw new WeaveError('A table cannot move between spaces yet', 'invalid');
        }
        delete patch.Space;
      }
      const structural = {};
      if ('Name' in patch) { structural.name = patch.Name; delete patch.Name; }
      if ('Description' in patch) { structural.description = patch.Description; delete patch.Description; }
      if (db.system === 'spaces' && 'Template' in patch) { structural.template = !!patch.Template; delete patch.Template; }
      if (db.system === 'tables') {
        // Configuration as fields, writing back: same validation as the
        // schema verb, because it IS the schema verb.
        const split = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
        if ('Field Order' in patch) { structural.fieldOrder = split(patch['Field Order']); delete patch['Field Order']; }
        if ('Hidden Fields' in patch) { structural.hiddenFields = split(patch['Hidden Fields']); delete patch['Hidden Fields']; }
        if ('Filter' in patch) { structural.filters = parseFilters(patch.Filter); delete patch.Filter; }
        if ('Sort' in patch) { structural.sort = parseSort(patch.Sort); delete patch.Sort; }
        if ('Hide Rollups' in patch) { structural.hideRollups = !!patch['Hide Rollups']; delete patch['Hide Rollups']; }
      }
      if (Object.keys(structural).length) {
        const owner = this.#ownerOf(e);
        if (db.system === 'spaces') owner.updateSpace(e.sysId, structural);
        else owner.updateTable(e.sysId, structural);
      }
    }
    if (Object.keys(patch).length) this.#metaSync(() => this.updateEntity(e.id, patch));
    return this.getEntity(e.id);
  }

  /* A Views row's columns, spoken as the view verb's patch. Consumes the keys
     it translates, so what is left is plain row data. */
  #viewRowPatch(values, isDefault, cur = null) {
    const vp = {};
    const take = (k) => { const v = values[k]; delete values[k]; return v; };
    if ('Name' in values) vp.name = take('Name');
    if ('Fields' in values) vp.fields = String(take('Fields') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if ('Filter' in values) vp.filters = parseFilters(take('Filter'));
    if ('Sort' in values) vp.sort = parseSort(take('Sort'));
    if ('Default' in values) {
      const on = !!take('Default');
      if (on) vp.default = true; else if (isDefault) vp.default = false;
    }
    if ('Position' in values) {
      const p = take('Position');
      if (p != null && p !== '') vp.position = Number(p);
    }
    if ('Frozen' in values) {
      const n = take('Frozen');
      vp.frozen = n == null || n === '' ? 0 : Number(n);
    }
    if ('Density' in values) vp.density = String(take('Density') ?? '').trim() || 'comfortable';
    if ('Show Deleted' in values) vp.deleted = !!take('Show Deleted');
    if ('Rollup Row' in values) vp.rollups = !!take('Rollup Row');
    // The Widths text is the whole set: a name it no longer lists is unsized.
    if ('Widths' in values) {
      vp.widths = { ...Object.fromEntries(Object.keys(cur?.widths ?? {}).map((n) => [n, null])), ...parseWidths(take('Widths')) };
    }
    return vp;
  }

  #interceptDelete(e, db, hard) {
    if (!db.system || this.#inMetaSync) return undefined;
    if (db.system === 'workspaces') throw new WeaveError('A workspace is deleted from the hub (DELETE /api/workspaces/:id), not as a row', 'invalid');
    if (!['spaces', 'tables', 'fields', 'views'].includes(db.system)) return undefined; // ordinary rows
    if (db.system === 'views') {
      // A view has no trash: it is configuration. The verb keeps the last one.
      const hit = this.#viewAnywhere(e.sysId);
      if (hit) hit.owner.tableView(`${hit.table.id}/${hit.view.id}`, { delete: true });
      else this.#metaSync(() => this.deleteEntity(e.id, { hard: true })); // orphaned row
      return { id: e.id, purged: true };
    }

    if (db.system === 'fields') {
      // A column has no trash — its values would dangle. Hard-only, said out loud.
      if (!hard) throw new WeaveError('Deleting a column is not recoverable — pass hard to confirm', 'invalid');
      const hit = this.#fieldAnywhere(e.sysId);
      const owner = hit?.table;
      if (owner && owner.nameFieldId === e.sysId) {
        throw new WeaveError('Cannot delete the Name field', 'invalid');
      }
      if (owner) hit.owner.deleteField(owner.id, e.sysId);
      else this.#metaSync(() => this.deleteEntity(e.id, { hard: true })); // orphaned row
      return { id: e.id, purged: true };
    }
    const owner = this.#ownerOf(e);
    if (db.system === 'spaces') owner.deleteSpace(e.sysId, { hard });
    else owner.deleteTable(e.sysId, { hard });
    return hard ? { id: e.id, purged: true } : this.readEntity(e.id);
  }

  findField(db, ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    if (own(db.fields, ref)) return db.fields[ref];
    const fields = Object.values(db.fields);
    return fields.find((f) => f.name === ref)
      ?? fields.find((f) => f.name.toLowerCase() === String(ref).toLowerCase())
      // The literal 'Name' keeps resolving after a rename (Feature #168): it
      // is what every existing caller — MCP, CSV, `values: { Name }` — says.
      ?? (String(ref) === 'Name' ? db.fields[db.nameFieldId] : undefined);
  }

  getField(dbRef, ref) {
    const db = this.getTable(dbRef);
    const f = this.findField(db, ref);
    if (!f) throw new WeaveError(`Field '${ref}' not found in table '${db.name}'`, 'not-found');
    return f;
  }

  /* A stored `field` definition becomes a real column. Thin by design: the
     definition was validated by the same normaliser addField runs, so this
     cannot be asked to create a field addField would refuse. The binding —
     how a Fields row names the table it lands on — is the caller's business
     (Feature #52); this is only the act. */
  materializeField(dbRef, name, def) {
    if (!def || typeof def !== 'object' || !def.type) {
      throw new WeaveError(`'${name}' has no definition to materialize`, 'invalid');
    }
    return this.addField(dbRef, { name, type: def.type, config: def.config ?? {} });
  }

  addField(dbRef, { name, type, config = {} }) {
    const db = this.getTable(dbRef);
    if (!name) throw new WeaveError('Field name is required', 'invalid');
    refuseReserved('field', name);
    if (this.findField(db, name)) throw new WeaveError(`Field '${name}' already exists`, 'conflict');
    if (!FIELD_TYPES.includes(type)) throw new WeaveError(`Unknown field type '${type}'`, 'invalid');
    if (type === 'relation') throw new WeaveError(`Use addRelation() to create relation fields`, 'invalid');
    if (type === 'view') throw new WeaveError('The chip and the card are minted on every table; configure those instead', 'invalid');

    const field = { id: uuid(), name, type, config: {} };
    if (['select', 'multiselect', 'workflow', 'field', 'number', 'rating', 'date', 'daterange', 'attachments', 'document', 'key', 'text', 'toggle'].includes(type)) {
      // One normaliser, shared with `field` value validation — see the note on
      // normalizeSelfContainedConfig. If these drift, a definition can describe
      // a field addField would reject.
      field.config = normalizeSelfContainedConfig(type, config, { strict: true });
    } else if (type === 'lookup') {
      const rel = this.getField(db.id, config.relationField ?? config.relation);
      if (rel.type !== 'relation') throw new WeaveError('Lookup must point at a relation field', 'invalid');
      // A target set has no one far table to read a field from.
      if (rel.config.targetDbs) throw new WeaveError('Lookup needs a single-target relation', 'invalid');
      const target = this.getField(rel.config.targetDb, config.targetField);
      field.config = { relationField: rel.id, targetField: target.id };
    } else if (type === 'rollup') {
      const aggregate = config.aggregate ?? 'count';
      if (!AGGREGATES.includes(aggregate)) throw new WeaveError(`Invalid aggregate '${aggregate}' (use ${AGGREGATES.join(', ')})`, 'invalid');
      if (config.via != null && config.relationField == null && config.relation == null) {
        /* A rollup over a WHOLE table, no relation to cross. Kyle's ruling
           (2026-09-06): a table-wide aggregate — the Σ under a grid column —
           lives on the Spaces registry row of the space that holds the
           table, where it is addressable, auditable and lookup-able like any
           field. `where` narrows the rows; the grid footer reads these. */
        if (db.system !== 'spaces') throw new WeaveError('A rollup over a whole table lives on the Spaces registry row that holds the table — add it there (config.via names the table)', 'invalid');
        // The table may belong to any workspace the registry serves (Feature #219).
        const hit = this.#tableAnywhere(config.via) ?? { owner: this, table: this.getTable(config.via) };
        const viaT = hit.table;
        if (viaT.system) throw new WeaveError(`Table '${viaT.name}' is part of the system registry — roll up your own tables`, 'invalid');
        let targetFieldId = null;
        if (aggregate !== 'count') targetFieldId = hit.owner.getField(viaT.id, config.targetField).id;
        const where = config.where && (Array.isArray(config.where) ? config.where.length : true) ? config.where : null;
        if (where) hit.owner.#checkWhere(viaT, where);
        field.config = { via: viaT.id, targetField: targetFieldId, aggregate, ...(where ? { where } : {}) };
      } else {
        const rel = this.getField(db.id, config.relationField ?? config.relation);
        if (rel.type !== 'relation') throw new WeaveError('Rollup must point at a relation field', 'invalid');
        if (rel.config.targetDbs) throw new WeaveError('Rollup needs a single-target relation', 'invalid');
        let targetFieldId = null;
        if (aggregate !== 'count') {
          const target = this.getField(rel.config.targetDb, config.targetField);
          targetFieldId = target.id;
        }
        field.config = { relationField: rel.id, targetField: targetFieldId, aggregate };
      }
      if (config.separator != null) field.config.separator = String(config.separator);
    } else if (type === 'formula') {
      if (!config.expression) throw new WeaveError('Formula field needs an expression', 'invalid');
      const checked = checkExpression(config.expression, Object.values(db.fields).map((f) => f.name));
      if (!checked.ok) throw new WeaveError(checked.error, 'invalid');
      this.#refuseFormulaCycle(db, field.id, field.name, config.expression);
      // A numeric result wears the number costume (unit / currency / decimals),
      // a date the date costume (Issue #576).
      field.config = { expression: config.expression, ...formulaCostume(config) };
    }
    if (config.default !== undefined && config.default !== null) {
      field.config.default = this.#validateDefault(field, config.default);
    }
    // Width belongs to every type and rides its own lane in updateField; a
    // create takes it too, so standing a column up is one call rather than
    // two (and so a schema document can carry the width it describes).
    if (config.width != null) {
      const width = Number(config.width);
      if (!Number.isFinite(width) || width < MIN_COLUMN_WIDTH) {
        throw new WeaveError(`Column width must be a number of at least ${MIN_COLUMN_WIDTH}px`, 'invalid');
      }
      field.config.width = Math.round(width);
    }
    // The description belongs to every field too (Issue #209): what the
    // column holds and how it is written, for a reader or an agent.
    if (config.description != null) {
      const description = fieldDescriptionValue(config.description);
      if (description) field.config.description = description;
    }

    db.fields[field.id] = field;
    placeField(db, field.id);
    this.save();
    this.#syncFieldRow(db, field);
    this.#syncTableRow(db); // the row's Field Order names every column
    if (!db.system) this.#audit('field-added', { table: db.name, name: field.name, type: field.type });
    return field;
  }

  addRelation(dbRef, { name, targetDb, targetDbs, cardinality = 'many-to-one', inverseName }) {
    const db = this.getTable(dbRef);
    if (!name) throw new WeaveError('Relation field name is required', 'invalid');
    refuseReserved('field', name);
    if (inverseName != null) refuseReserved('field', inverseName);
    if (this.findField(db, name)) throw new WeaveError(`Field '${name}' already exists`, 'conflict');
    const cards = {
      'many-to-one': { thisMany: false, targetMany: true },   // Task.Project ← Project.Tasks
      'one-to-many': { thisMany: true, targetMany: false },   // Project.Tasks → Task.Project
      'many-to-many': { thisMany: true, targetMany: true },
      'one-to-one': { thisMany: false, targetMany: false },
    };
    const card = cards[cardinality];
    if (!card) throw new WeaveError(`Invalid cardinality '${cardinality}'`, 'invalid');

    /* Target-set relation (polymorphic): several legal target tables in one
       field — the registry's Spaces/Tables rows are legal members, so a row
       can point at a space or a table as easily as at another row. One-way by
       design: an inverse would have to be sprayed across every member table,
       so the reverse direction is a computed read, not a stored field. A
       singleton set falls through to the classic paired relation below. */
    if (targetDbs !== undefined) {
      const members = (Array.isArray(targetDbs) ? targetDbs : [targetDbs]).map((r) => this.getTable(r));
      if (!members.length) throw new WeaveError('A relation needs at least one target table', 'invalid');
      if (new Set(members.map((m) => m.id)).size !== members.length) {
        throw new WeaveError('Duplicate table in the target set', 'invalid');
      }
      if (members.length > 1) {
        const a = { id: uuid(), name, type: 'relation', config: { targetDbs: members.map((m) => m.id), many: card.thisMany } };
        db.fields[a.id] = a;
        placeField(db, a.id);
        this.save();
        this.#syncFieldRow(db, a);
        this.#syncTableRow(db);
        if (!db.system) this.#audit('relation-added', { table: db.name, name: a.name, targets: members.map((m) => this.qualifiedName(m)) });
        return { field: a, inverse: null };
      }
      targetDb = members[0].id;
    }
    if (targetDb == null) throw new WeaveError('A relation needs a targetDb (or a targetDbs list)', 'invalid');
    const target = this.getTable(targetDb);
    const invName = inverseName ?? db.name + (card.targetMany ? 's' : '');
    if (this.findField(target, invName)) throw new WeaveError(`Field '${invName}' already exists in target table`, 'conflict');

    const a = { id: uuid(), name, type: 'relation', config: { targetDb: target.id, many: card.thisMany } };
    const b = { id: uuid(), name: invName, type: 'relation', config: { targetDb: db.id, many: card.targetMany } };
    a.config.inverseFieldId = b.id;
    b.config.inverseFieldId = a.id;
    db.fields[a.id] = a;
    placeField(db, a.id);
    target.fields[b.id] = b;
    placeField(target, b.id);
    this.save();
    this.#syncFieldRow(db, a);
    this.#syncFieldRow(target, b);
    this.#syncTableRow(db);
    this.#syncTableRow(target);
    if (!db.system) this.#audit('relation-added', { table: db.name, name: a.name, target: target.name });
    return { field: a, inverse: b };
  }

  /* The blocks of an entity body, in the order a reader will meet them:
     whatever bodyOrder placed, then everything it did not, in the default
     order — the field block first, then documents, attachments and related
     tables as the table declares them. A document added after someone set an
     order appends rather than jumping the queue. */
  bodyBlocks(dbRef) {
    const db = this.getTable(dbRef);
    const known = [VALUES_BLOCK];
    for (const id of db.fieldOrder) {
      const f = db.fields[id];
      if (f && isBodyBlock(f)) known.push(id);
    }
    const seen = new Set();
    const out = [];
    for (const key of db.bodyOrder ?? []) {
      if (seen.has(key) || !known.includes(key)) continue;
      seen.add(key);
      out.push(key);
    }
    for (const key of known) if (!seen.has(key)) out.push(key);
    return out.map((key) => key === VALUES_BLOCK ? VALUES_BLOCK : db.fields[key].name);
  }

  updateField(dbRef, fieldRef, patch) {
    return this.#updateField(dbRef, fieldRef, patch, null).field;
  }

  /* The one write path for a field's configuration. `undo` is set when the
     write is a roll back ({of, via}), which records an `undo` entry instead of
     a new change. `restore` is the snapshot a roll back of a type change
     puts back (Issue #467). */
  #updateField(dbRef, fieldRef, patch, undo, restore = null) {
    const db = this.getTable(dbRef);
    const field = this.getField(db.id, fieldRef);
    const before = fieldDefinition(field);
    let renamed = false;
    if (patch.name != null) refuseReserved('field', patch.name);
    if (patch.name != null && patch.name !== field.name) {
      // Views hold fields by id, so visibility survives a rename for free;
      // their filter and sort speak names, so those follow it here.
      for (const v of db.tableViews ?? []) {
        if (v.filters?.[field.name]) { v.filters[patch.name] = v.filters[field.name]; delete v.filters[field.name]; }
        for (const s of v.sort ?? []) if (s.field === field.name) s.field = patch.name;
      }
      field.name = patch.name;
      renamed = true;
    }
    if (patch.type != null && patch.type !== field.type && field.type === 'view') {
      throw new WeaveError(`The ${field.config.shape} is fixed as a view — rename or reconfigure it`, 'invalid');
    }
    let migrated = null;
    if (patch.type != null && patch.type !== field.type) {
      // A roll back goes back to the type the field had, whichever way the
      // migration table points: the definition it restores was valid.
      migrated = this.#migrateFieldType(db, field, patch.type, patch.config ?? {}, { force: !!undo, restore });
      // The new type's config is fully set by the migration; the rest of the
      // patch (width, default) still applies below on the new shape. A roll
      // back sends the whole definition before, so every lane applies it.
      if (!undo) {
        patch = { ...patch, config: Object.fromEntries(Object.entries(patch.config ?? {}).filter(([k]) => ['width', 'default'].includes(k))) };
        if (!Object.keys(patch.config).length) delete patch.config;
      }
    }
    if (patch.config) {
      // Column width belongs to every field type, so it is handled before the
      // type switch — and independently of it, so a resize cannot clobber a
      // select's options and an options edit cannot reset the width. null is
      // the auto-fit reset: back to letting the column size itself.
      // The row term rides the Name field's config (Feature #40). null clears
      // it back to "record"; any other field refuses it.
      if ('term' in patch.config) {
        if (field.id !== db.nameFieldId) throw new WeaveError('The row term lives on the Name field', 'invalid');
        this.#setTerm(db, patch.config.term, { save: false });
      }
      if ('width' in patch.config) {
        const width = patch.config.width;
        if (width === null) delete field.config.width;
        else if (typeof width !== 'number' || !Number.isFinite(width) || width < MIN_COLUMN_WIDTH) {
          throw new WeaveError(`Column width must be a number of at least ${MIN_COLUMN_WIDTH}px`, 'invalid');
        } else field.config.width = Math.round(width);
      }
      // The description rides its own lane like width (Issue #209): null or
      // blank clears it, and no other key can clobber it. A view's
      // `description` is its description size and takes the view lane below.
      if ('description' in patch.config && field.type !== 'view') {
        const description = fieldDescriptionValue(patch.config.description);
        if (description) field.config.description = description; else delete field.config.description;
      }
      if (field.type === 'rating' && ('max' in patch.config || 'icon' in patch.config || 'color' in patch.config)) {
        // One key at a time: the other keeps. A lower max holds every
        // stored value to the new ceiling on read (#resolve). The scale
        // moves BEFORE the default lane reads it, so a default sent with a
        // new max is judged against that max (Feature #234), and a standing
        // default above a lowered max clamps down with it.
        // A colour of null is the default, ink, like every other colour lane.
        const { max, icon, color } = normalizeSelfContainedConfig('rating', { max: field.config.max, icon: field.config.icon, color: field.config.color, ...patch.config });
        field.config.max = max;
        field.config.icon = icon;
        if (color) field.config.color = color; else delete field.config.color;
        if (typeof field.config.default === 'number') field.config.default = ratingValue(field.config.default, max);
      }
      if (field.type === 'number' || field.type === 'formula') {
        // Merge the costume keys through the same validation addField runs;
        // absent keys keep their value, width/default ride their own lanes.
        /* A formula that moves between the number and the date costume
           (Issue #576) takes only what the edit sends: the stored keys of
           the costume it leaves behind would be read as the new one's. */
        const switched = field.type === 'formula' && 'grain' in patch.config && (patch.config.grain == null) !== (field.config.grain == null);
        const merged = switched ? patch.config : { ...field.config, ...patch.config };
        const costume = field.type === 'formula' ? formulaCostume(merged) : normalizeSelfContainedConfig('number', merged);
        for (const k of field.type === 'formula' ? FORMULA_COSTUME_KEYS : NUMBER_COSTUME_KEYS) {
          // A stored key the canonical costume drops goes too: a fixed scale
          // left behind by a display gone back to text (Feature #230).
          if (k in patch.config || k in costume || k in field.config) {
            if (costume[k] == null) delete field.config[k];
            else field.config[k] = costume[k];
          }
        }
      }
      if (field.type === 'view') field.config = this.#normalizeViewConfig(db, field, patch.config);
      if (field.type === 'text' && 'literal' in patch.config) {
        if (normalizeSelfContainedConfig('text', patch.config).literal) field.config.literal = true; else delete field.config.literal;
      }
      if (field.type === 'toggle' && ('on' in patch.config || 'off' in patch.config)) {
        // One label at a time: the other keeps its word.
        const { on, off } = normalizeSelfContainedConfig('toggle', { ...field.config, ...patch.config });
        field.config.on = on;
        field.config.off = off;
      }
      if (field.type === 'attachments' && 'multiple' in patch.config) {
        field.config.multiple = normalizeSelfContainedConfig('attachments', patch.config).multiple;
      }
      if (field.type === 'document' && 'kind' in patch.config) {
        const kind = normalizeSelfContainedConfig('document', patch.config).kind;
        if (kind) field.config.kind = kind; else delete field.config.kind;
      }
      if (field.type === 'date' || field.type === 'daterange') {
        const costume = normalizeSelfContainedConfig(field.type, { ...field.config, ...patch.config });
        for (const k of DATE_COSTUME_KEYS) {
          if (k in patch.config || k in costume) {
            if (costume[k] == null) delete field.config[k];
            else field.config[k] = costume[k];
          }
        }
      }
      if (field.type === 'select' || field.type === 'multiselect') {
        if (patch.config.options) {
          /* A colour the caller just named is held to the palette; an option
             handed back wearing the colour it already had is not a new
             assertion, so an edit to the list does not have to re-justify a
             colour stored before the ramp had names (Issue #551). Widening a
             select by appending to its own options is the common case: see
             src/weaver-seed.js. */
          const stored = new Map(field.config.options.map((o) => [o.id, o]));
          field.config.options = patch.config.options.map((o) => {
            const was = typeof o === 'string' ? null : stored.get(o.id);
            const asStored = was
              && (o.hue ?? '') === (was.hue ?? '') && (o.color ?? '') === (was.color ?? '');
            return normaliseOption(o, { strict: !asStored });
          });
        }
      } else if (field.type === 'formula') {
        if (patch.config.expression) {
          // The field's own name is off the list: a formula that reads
          // itself never converges, so it fails as an unknown field.
          const names = Object.values(db.fields).filter((f) => f.id !== field.id).map((f) => f.name);
          const checked = checkExpression(patch.config.expression, names);
          if (!checked.ok) throw new WeaveError(checked.error, 'invalid');
          // Its own name is off the list above; a longer way round to itself
          // is refused here, with the path (Issue #283).
          this.#refuseFormulaCycle(db, field.id, field.name, patch.config.expression);
          field.config.expression = patch.config.expression;
        }
      } else if (field.type === 'workflow') {
        if (patch.config.states) {
          // Same normaliser as addField: categories checked, icons kept,
          // the default only where the edit marks one (Issue #421).
          const states = normalizeSelfContainedConfig('workflow', { states: patch.config.states }).states;
          field.config.states = states;
        }
      }
      // The default rides alongside the type config for the same reason width
      // does: editing one must not clobber the other. null clears it. It is
      // read AFTER the options, so a default that names an option renamed in
      // the same save is judged against the new name (Issue #422).
      if ('default' in patch.config) {
        if (patch.config.default === null) delete field.config.default;
        else field.config.default = this.#validateDefault(field, patch.config.default);
      } else if ((field.type === 'select' || field.type === 'multiselect') && patch.config.options && field.config.default != null) {
        // An option removed takes the default with it: an id nothing names
        // would start every new row on a value no picker can show.
        const ids = new Set(field.config.options.map((o) => o.id));
        const kept = [].concat(field.config.default).filter((id) => ids.has(id));
        if (!kept.length) delete field.config.default;
        else field.config.default = field.type === 'select' ? kept[0] : kept;
      }
    }
    this.#syncFieldRow(db, field);
    if (renamed) this.#syncTableRow(db); // the names in Field Order and every view row
    const after = fieldDefinition(field);
    const changed = definitionChanges(before, after);
    // The seq is minted before the save so the counter lands with it.
    // A type change keeps each row's value from before it and the value it
    // made (Issue #467), so its Undo can put the values back too.
    const logged = !db.system && !this.#fieldLogQuiet && changed.length
      ? { table: this.qualifiedName(db), tableId: db.id, fieldId: field.id, field: field.name, changed, before, after, seq: this.#nextSeq(),
        ...(before.type !== after.type ? { lossy: true } : {}), ...(migrated ? { snapshot: migrated.rows } : {}),
        ...(undo ?? {}), ...(restore && migrated ? migrated.counts : {}) }
      : null;
    this.save();
    if (logged) {
      this.#audit(undo ? 'field-config-undo' : 'field-config-updated', logged);
      if (migrated) this.#dropOlderSnapshots(field.id, logged.seq);
    } else if (!db.system) this.#audit('field-updated', { table: db.name, name: field.name, patch: Object.keys(patch) });
    return { field, counts: migrated?.counts ?? null };
  }

  /* The growth bound (Issue #467). The audit log keeps no size policy, and the
     capped stores cap a count per subject (200 revisions a document, 500
     entries an entity), which a whole column of values per entry does not
     fit. So a field keeps the values of its newest type change only; an older
     entry keeps its definitions and says its values were dropped. */
  #dropOlderSnapshots(fieldId, keepSeq) {
    for (const r of this.store.listAudit({ limit: -1, actions: Object.keys(FIELD_CONFIG_ACTIONS) })) {
      const d = r.detail ?? {};
      if (d.fieldId !== fieldId || !d.snapshot || d.seq === keepSeq) continue;
      const { snapshot, ...rest } = d;
      this.store.setAuditDetail(r.seq, { ...rest, snapshotDropped: true });
    }
  }

  // An entry's detail as any door shows it: a snapshot is row values, so it
  // leaves as its row count and nothing else.
  static #publicDetail(d) {
    return d?.snapshot ? { ...d, snapshot: { rows: Object.keys(d.snapshot).length } } : d;
  }

  /* A new table's minted fields are renamed and configured by applySchema as
     part of creating it: that is its birth, not a change to record. */
  #fieldLogQuiet = false;
  #withoutFieldLog(fn) {
    const was = this.#fieldLogQuiet;
    this.#fieldLogQuiet = true;
    try { return fn(); } finally { this.#fieldLogQuiet = was; }
  }

  /* The field-config entries as Activity feed rows, newest first. The id is
     `<tableId>:f<audit seq>`: the table is the address, like an entity's
     `<entityId>:<index>`. */
  #fieldConfigRows() {
    return this.store.listAudit({ limit: -1, actions: Object.keys(FIELD_CONFIG_ACTIONS) }).map((r) => {
      const d = r.detail ?? {};
      const db = this.state.tables[d.tableId];
      return {
        id: `${d.tableId}:f${r.seq}`,
        seq: d.seq,
        ts: r.at,
        kind: FIELD_CONFIG_ACTIONS[r.action],
        actor: r.actor ?? null,
        detail: Weave.#publicDetail(d),
        entityId: d.tableId,
        entityName: db?.fields[d.fieldId]?.name ?? d.field,
        publicId: null,
        dbId: d.tableId,
        db: db ? this.qualifiedName(db) : d.table,
        space: db ? (this.state.spaces[db.spaceId]?.name ?? null) : null,
        deleted: !db || !!db.deletedAt,
        scope: 'field',
      };
    });
  }

  #fieldConfigRow(id, rows = this.#fieldConfigRows()) {
    const row = rows.find((r) => r.id === String(id));
    if (!row) throw new WeaveError(`Activity '${id}' is not a field configuration entry`, 'not-found');
    return row;
  }

  /* Whether an entry can be rolled back now, and if not, why. Stale is judged
     twice: a later entry for the same field (the seq), and a definition that
     no longer matches the entry's `after` (a write that recorded nothing). */
  #rollbackCheck(row, rows) {
    const d = row.detail;
    const db = this.state.tables[d.tableId];
    if (!db || db.deletedAt) return { ok: false, code: 'conflict', reason: `The table ${d.table} is gone or in the trash, so ${d.field} cannot be rolled back.` };
    const field = db.fields[d.fieldId];
    if (!field) return { ok: false, code: 'conflict', reason: `${d.field} has been deleted, so there is nothing to roll back.` };
    // A type change rolls back with its values while its snapshot is kept.
    if (d.lossy && !d.snapshot) {
      return { ok: false, code: 'conflict', reason: d.snapshotDropped
        ? `The values from before this change are no longer kept: weave keeps them for the newest type change of ${field.name} only, and a newer one replaced them. Rolling back this entry cannot bring its values back.`
        : `This type change was recorded before weave kept the values a type change converts, so rolling it back cannot bring its values back.` };
    }
    const later = rows.find((r) => r.detail.fieldId === d.fieldId && r.seq > row.seq);
    if (later) return { ok: false, code: 'conflict', reason: `${field.name} changed again after this entry (${later.id}). Roll back the newer change first.` };
    if (canonicalJSON(fieldDefinition(field)) !== canonicalJSON(d.after)) {
      return { ok: false, code: 'conflict', reason: `${field.name} has changed since this entry, so its definition no longer matches what the entry recorded.` };
    }
    return { ok: true };
  }

  /* Issue #428: put a field back the way an Activity entry found it. The
     definition only: a type change is refused, because its migration
     converted the stored values and nothing recorded them. Everything else a
     definition holds (options, states, colours, formula, format, default,
     description, name) leaves stored values alone: a removed option's rows
     keep its id, so restoring the option brings their values back. The write
     goes through the one path and records an `undo` entry naming the entry it
     reversed; `via` says whether a toast's Undo or a roll back asked. */
  rollbackFieldConfig(id, { table = null, field = null, via = 'rollback' } = {}) {
    const rows = this.#fieldConfigRows();
    const row = this.#fieldConfigRow(id, rows);
    const d = row.detail;
    if (table != null && this.getTable(table).id !== d.tableId) throw new WeaveError(`Activity '${id}' belongs to ${d.table}, not ${table}`, 'invalid');
    if (field != null && this.getField(d.tableId, field).id !== d.fieldId) throw new WeaveError(`Activity '${id}' is a change to ${d.field}, not ${field}`, 'invalid');
    const check = this.#rollbackCheck(row, rows);
    if (!check.ok) throw new WeaveError(check.reason, check.code);
    const f = this.state.tables[d.tableId].fields[d.fieldId];
    const now = fieldDefinition(f);
    const patch = { config: structuredClone(d.before.config) };
    if (d.before.name !== f.name) patch.name = d.before.name;
    // A key the definition did not have goes; null is every lane's clear. A
    // view's config is a whole shape, merged, so it takes no nulls.
    if (f.type !== 'view') for (const k of Object.keys(now.config)) if (!(k in d.before.config)) patch.config[k] = null;
    // A type change goes back through the migration with its snapshot.
    let restore = null;
    if (d.before.type !== f.type) {
      patch.type = d.before.type;
      const auditSeq = Number(String(row.id).slice(String(row.id).lastIndexOf(':f') + 2));
      restore = this.store.listAudit({ limit: -1, actions: Object.keys(FIELD_CONFIG_ACTIONS) }).find((r) => r.seq === auditSeq)?.detail?.snapshot ?? {};
    }
    const seq = this.state.meta.activitySeq ?? 0;
    const { counts } = this.#updateField(d.tableId, f.id, patch, { of: row.id, via: via === 'undo' ? 'undo' : 'rollback' }, restore);
    const made = this.#fieldConfigRows().find((r) => r.kind === 'undo' && r.seq > seq);
    return { field: f, activity: made?.id ?? null, ...(counts ?? {}) };
  }

  /* The path back to `fieldId` through the table's other formulas, or null.
     Only formula-to-formula edges are walked: every other type is a leaf as
     far as an expression is concerned, and a loop that runs through a rollup
     or a lookup needs two rows to exist, so no save can see it — that half is
     caught at read time and reads `#CYCLE:` (Issue #283). */
  #formulaCycle(db, fieldId, fieldName, expression) {
    const seen = new Set([fieldId]);
    const walk = (expr, path) => {
      for (const name of formulaReferences(expr)) {
        const f = this.findField(db, name);
        // A field being added is not in the table yet, so a reference that
        // names it resolves to nothing — and is still the loop closing.
        if (!f) {
          if (String(name).toLowerCase() === String(fieldName).toLowerCase()) return [...path, fieldName];
          continue;
        }
        if (f.id === fieldId) return [...path, fieldName];
        if (f.type !== 'formula') continue;
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        const hit = walk(f.config?.expression ?? '', [...path, f.name]);
        if (hit) return hit;
      }
      return null;
    };
    return walk(expression, [fieldName]);
  }

  #refuseFormulaCycle(db, fieldId, fieldName, expression) {
    const path = this.#formulaCycle(db, fieldId, fieldName, expression);
    if (path) {
      throw new WeaveError(`Formula '${fieldName}' would close a reference cycle: ${path.join(' → ')}`, 'invalid');
    }
  }

  /* The authoring loop for formulas — validate an expression against a
     table's fields and, when the table has rows, evaluate it on one so the
     author (human or agent) sees a real result before saving. Never throws
     on a bad expression: the verdict is the return value. `type` names what
     the preview computed to (number, text, boolean, list, null, error).
     scan:true (direction B, 2026-09-07) evaluates over up to 200 rows —
     one preview row proves the formula parses, not that it is right — and
     returns {rows, capped, nulls, errors, sampleByOutcome: {ok, null,
     error}}; the type then comes from the rows that computed. */
  checkFormula(dbRef, expression, { entity = null, excludeField = null, scan = false } = {}) {
    const db = this.getTable(dbRef);
    const names = Object.values(db.fields).filter((f) => f.id !== excludeField && f.name !== excludeField).map((f) => f.name);
    const checked = checkExpression(expression, names);
    if (!checked.ok) return checked;
    // Editing an existing formula: the dialog hears about a cycle before the
    // save refuses one, and with the same path (Issue #283).
    const edited = excludeField && this.findField(db, excludeField);
    if (edited) {
      const path = this.#formulaCycle(db, edited.id, edited.name, expression);
      if (path) return { ok: false, error: `Formula '${edited.name}' would close a reference cycle: ${path.join(' → ')}` };
    }
    const rows = this.listEntities(db.id);
    const e = entity ? this.getEntity(entity) : rows[0];
    if (!e) return { ok: true };
    const temp = { id: '__preview', name: '__preview', type: 'formula', config: { expression } };
    const nameOf = (row) => String(row.values[db.nameFieldId] ?? '');
    const kindOf = (v) => (v == null ? 'null' : typeof v === 'string' && (v.startsWith('#ERR: ') || isCycle(v)) ? 'error'
      : Array.isArray(v) ? 'list' : typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'text');
    const preview = this.#resolve(e, db, temp, 0);
    const result = { ok: true, preview, previewEntity: nameOf(e), type: kindOf(preview) };
    if (!scan) return result;
    const sample = rows.slice(0, FORMULA_SCAN_CAP);
    const out = { rows: sample.length, capped: rows.length > FORMULA_SCAN_CAP, nulls: 0, errors: 0, sampleByOutcome: { ok: null, null: null, error: null } };
    const types = {};
    for (const row of sample) {
      const v = this.#resolve(row, db, temp, 0);
      const kind = kindOf(v);
      if (kind === 'null') { out.nulls++; out.sampleByOutcome.null ??= { entity: nameOf(row), id: row.id }; }
      else if (kind === 'error') { out.errors++; out.sampleByOutcome.error ??= { entity: nameOf(row), id: row.id, error: isCycle(v) ? v : v.slice(6) }; }
      else { types[kind] = (types[kind] ?? 0) + 1; out.sampleByOutcome.ok ??= { entity: nameOf(row), id: row.id, value: v }; }
    }
    const dominant = Object.entries(types).sort((a, b) => b[1] - a[1])[0];
    if (dominant) result.type = dominant[0];
    result.scan = out;
    return result;
  }

  /* Change a field's type along TYPE_MIGRATIONS, coercing every row's value
     into the new shape. Options/states are derived from the old config or,
     for text sources, from the distinct values present — so nothing that is
     in a cell today is lost, it just wears a new type. */
  /* `force` is a roll back going back to the type the field had; `restore`
     is that roll back's snapshot. Returns the snapshot of this conversion
     ({rowId: [before, after]}, rows that held a value only) and, when
     restoring, what happened to each row: restored (unchanged since), left
     (edited since: its edit converts, the snapshot does not overwrite it),
     converted (no snapshot: made since, or empty then). */
  #migrateFieldType(db, field, toType, config, { force = false, restore = null } = {}) {
    if (field.type === 'text' && toType === 'relation') return this.#textToRelation(db, field, config);
    if (field.type === 'relation' && toType === 'text' && force) return this.#relationToText(db, field, restore);
    const allowed = TYPE_MIGRATIONS[field.type] ?? [];
    if (!force && !allowed.includes(toType)) {
      throw new WeaveError(`A ${field.type} field can become ${allowed.length ? allowed.join(', ') : 'nothing else'} — not ${toType}`, 'invalid');
    }
    if (field.id === db.nameFieldId && !(['text', 'formula'].includes(toType) && ['text', 'formula'].includes(field.type))) {
      throw new WeaveError('The Name field can be text or a formula — a name is a label, not a number or a date', 'invalid');
    }
    const from = field.type;
    const rows = this.listEntities(db.id, { includeDeleted: true });
    const optName = (opts, id) => opts.find((o) => o.id === id)?.name ?? null;
    let nextConfig;
    if (toType === 'select' || toType === 'multiselect') {
      let options;
      if (from === 'select' || from === 'multiselect') options = field.config.options.map((o) => ({ ...o }));
      else if (from === 'workflow') options = field.config.states.map((s) => ({ id: s.id, name: s.name, color: '' }));
      else {
        // text: every distinct value becomes an option, in first-seen order
        const seen = new Map();
        for (const e of rows) {
          const raw = e.values[field.id];
          const parts = toType === 'multiselect' ? String(raw ?? '').split(',') : [raw];
          for (const p of parts) {
            const v = String(p ?? '').trim();
            if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
          }
        }
        options = [...seen.values()];
      }
      // A caller's own options are strict; the ones carried over from the
      // field's stored config or its rows are whatever is already there.
      const sent = !!config.options?.length;
      if (sent) options = config.options;
      nextConfig = normalizeSelfContainedConfig(toType, { options }, { strict: sent });
    } else if (toType === 'workflow') {
      // A select's default, if it had one, is the state's (Issue #421).
      const states = (from === 'select' ? field.config.options : []).map((o) => ({ id: o.id, name: o.name, category: 'in-progress', default: o.id === field.config.default }));
      // Nothing to carry across (an option-less select) leaves `states` unsent,
      // so the conversion lands on the default lifecycle instead of a refusal.
      nextConfig = normalizeSelfContainedConfig('workflow', { states: config.states?.length ? config.states : (states.length ? states : undefined) });
    } else if (toType === 'formula') {
      if (!config.expression) throw new WeaveError('Formula field needs an expression', 'invalid');
      // Same parse + known-field gate as addField and updateField, the
      // field's own name off the list (Issue #288).
      const checked = checkExpression(config.expression, Object.values(db.fields).filter((f) => f.id !== field.id).map((f) => f.name));
      if (!checked.ok) throw new WeaveError(checked.error, 'invalid');
      // A type change is a formula save too, and can close the same loop a
      // direct edit is refused for (Issue #283).
      this.#refuseFormulaCycle(db, field.id, field.name, config.expression);
      nextConfig = { expression: config.expression, ...formulaCostume(config) };
    } else {
      nextConfig = normalizeSelfContainedConfig(toType, config);
    }
    // formula -> text freezes what each row showed, so nothing a reader saw
    // disappears when the computation stops. Computed BEFORE the type flips.
    const frozen = from === 'formula' ? new Map(rows.map((e) => { const v = this.#resolve(e, db, field, 0); return [e.id, v == null ? null : String(v)]; })) : null;
    const coerce = (raw, e) => {
      if (frozen) return toType === 'text' ? frozen.get(e.id) : null;
      if (toType === 'formula') return null;
      // An empty cell stays empty, a workflow included (Issue #421).
      if (raw == null || raw === '') return isBoolType(toType) ? false : null;
      switch (toType) {
        case 'checkbox':
        case 'toggle': return Boolean(raw);
        case 'text': {
          if (from === 'select') return optName(field.config.options, raw);
          if (from === 'toggle') return raw ? field.config.on : field.config.off;
          if (from === 'multiselect') return (Array.isArray(raw) ? raw : [raw]).map((id) => optName(field.config.options, id)).filter(Boolean).join(', ');
          if (from === 'workflow') return field.config.states.find((s) => s.id === raw)?.name ?? null;
          return String(raw);
        }
        case 'number': { const n = Number(raw); return Number.isFinite(n) ? n : null; }
        // Rounded and held to the scale (Feature #231).
        case 'rating': { const n = Number(raw); return Number.isFinite(n) ? ratingValue(n, nextConfig.max) : null; }
        case 'date': { try { return this.#coerceDate(nextConfig ?? {}, raw); } catch { return null; } }
        case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(raw)) ? String(raw) : null;
        case 'key':
        case 'url': return String(raw);
        case 'select': {
          if (from === 'multiselect') return (Array.isArray(raw) ? raw[0] : raw) ?? null;
          if (from === 'workflow') return raw;
          return this.#findOption(nextConfig.options, String(raw).trim())?.id ?? null;
        }
        case 'multiselect': {
          if (from === 'select') return [raw];
          return String(raw).split(',').map((v) => this.#findOption(nextConfig.options, v.trim())?.id).filter(Boolean);
        }
        case 'workflow': return nextConfig.states.some((s) => s.id === raw) ? raw : null;
        default: return null;
      }
    };
    const held = (v) => !(v == null || v === '' || (Array.isArray(v) && !v.length));
    const snapshot = {};
    const counts = restore ? { restored: 0, left: 0, converted: 0 } : null;
    for (const e of rows) {
      const raw = e.values[field.id];
      let next = coerce(raw, e);
      if (restore) {
        const pair = restore[e.id];
        if (pair && canonicalJSON(raw ?? null) === canonicalJSON(pair[1] ?? null)) { next = structuredClone(pair[0]); counts.restored += 1; }
        else if (pair) counts.left += 1;
        else if (held(raw)) counts.converted += 1;
      }
      if (held(raw)) snapshot[e.id] = [structuredClone(raw), structuredClone(next ?? null)];
      e.values[field.id] = next;
    }
    field.type = toType;
    const width = field.config.width;
    const term = field.id === db.nameFieldId ? field.config.term : undefined;
    const description = field.config.description;
    // checkbox ⇄ toggle is the same boolean in a new coat: the default rides.
    const dflt = isBoolType(from) && isBoolType(toType) ? field.config.default : undefined;
    field.config = nextConfig;
    if (dflt !== undefined) field.config.default = dflt;
    if (width) field.config.width = width;
    if (description) field.config.description = description; // what the column means survives its shape (Issue #209)
    if (term) field.config.term = term; // the row term rides the Name field through every shape
    // A computed name is materialised per row (see #mark) so search and sort
    // have a string; migrating to a formula fills the cache for every row.
    if (toType === 'formula' && field.id === db.nameFieldId) for (const e of rows) this.#mark(e);
    if (!db.system) this.#audit('field-migrated', { table: db.name, name: field.name, from, to: toType, rows: rows.length });
    return { rows: snapshot, counts };
  }

  /* Text becomes a relation in place (Issue #582): a stock agent typed an
     account as text beside an Account table and had no way back short of a
     rebuild. Each value links to the target row of that name, matched by
     name only (a figure in a cell is never read as a public id), case
     folded when no exact name matches. A value no row carries is refused by
     name before anything changes, unless config.createMissing makes the
     rows. Off TYPE_MIGRATIONS on purpose: the field tray has no way to pick
     a target, so the lane is the API's (weave_update_field {type:
     'relation', config: {targetDb}}). Only the cardinalities where a target
     row may hold many sources: one-to-one or one-to-many would let a second
     row naming Checking take it from the first. */
  #textToRelation(db, field, config) {
    if (field.id === db.nameFieldId) throw new WeaveError('The Name field can be text or a formula — a name is a label, not a link', 'invalid');
    const ref = config.targetDb ?? config.to;
    if (ref == null || ref === '') throw new WeaveError('A text field becomes a relation to one table: pass config.targetDb, the table its values name', 'invalid');
    const target = this.getTable(ref);
    const cardinality = config.cardinality ?? 'many-to-one';
    if (!['many-to-one', 'many-to-many'].includes(cardinality)) throw new WeaveError(`A text field becomes a many-to-one or many-to-many relation, not ${cardinality}`, 'invalid');
    const many = cardinality === 'many-to-many';
    const invName = config.inverseName ?? db.name + 's';
    refuseReserved('field', invName);
    if (this.findField(target, invName)) throw new WeaveError(`Field '${invName}' already exists in target table — pass config.inverseName`, 'conflict');
    const exact = new Map();
    const folded = new Map();
    for (const e of this.listEntities(target.id)) {
      const n = this.entityName(e);
      if (!exact.has(n)) exact.set(n, e.id);
      if (!folded.has(n.toLowerCase())) folded.set(n.toLowerCase(), e.id);
    }
    const lookup = (v) => exact.get(v) ?? folded.get(v.toLowerCase());
    const rows = this.listEntities(db.id, { includeDeleted: true });
    const parts = (raw) => (raw == null || raw === '' ? [] : many ? String(raw).split(',') : [String(raw)]).map((s) => s.trim()).filter(Boolean);
    const missing = [...new Set(rows.flatMap((e) => parts(e.values[field.id])).filter((v) => !lookup(v)))];
    if (missing.length && !config.createMissing) {
      const shown = missing.slice(0, 10).map((v) => `'${v}'`).join(', ');
      throw new WeaveError(`No ${target.name} row is named ${shown}${missing.length > 10 ? ` and ${missing.length - 10} more` : ''}: make those rows first, or pass config.createMissing: true`, 'invalid');
    }
    // Case-folded duplicates make one row: 'Brokerage' and 'brokerage' are one account.
    for (const v of missing) if (!lookup(v)) { const made = this.createEntity(target.id, { name: v }); exact.set(v, made.id); folded.set(v.toLowerCase(), made.id); }
    const inverse = { id: uuid(), name: invName, type: 'relation', config: { targetDb: db.id, many: true, inverseFieldId: field.id } };
    target.fields[inverse.id] = inverse;
    placeField(target, inverse.id);
    const raws = new Map(rows.map((e) => [e.id, e.values[field.id]]));
    const { width, description } = field.config;
    field.type = 'relation';
    field.config = { targetDb: target.id, many, inverseFieldId: inverse.id, ...(width ? { width } : {}), ...(description ? { description } : {}) };
    const snapshot = {};
    for (const e of rows) {
      const raw = raws.get(e.id);
      e.values[field.id] = many ? [] : null;
      const ids = [...new Set(parts(raw).map(lookup))];
      if (ids.length) this.#setRelationValue(e, db, field, ids);
      if (raw != null && raw !== '') snapshot[e.id] = [raw, structuredClone(e.values[field.id] ?? null)];
    }
    this.#syncFieldRow(target, inverse);
    this.#syncTableRow(target);
    if (!db.system) this.#audit('field-migrated', { table: db.name, name: field.name, from: 'text', to: 'relation', rows: rows.length, target: target.name });
    return { rows: snapshot, counts: null };
  }

  /* The way back, for a roll back of the conversion above: each row's
     linked names joined, or the text it held when the link is the one the
     conversion made; the inverse goes with it. Rows the conversion created
     stay: they are rows now, with their own history. */
  #relationToText(db, field, restore) {
    if (field.config.targetDbs) throw new WeaveError('A relation to several tables cannot become text', 'invalid');
    const invId = field.config.inverseFieldId;
    const readers = this.listTables().flatMap((t) => Object.values(t.fields)
      .filter((f) => (f.type === 'lookup' || f.type === 'rollup') && [field.id, invId].includes(f.config.relationField))
      .map((f) => `${t.name}.${f.name}`));
    if (readers.length) throw new WeaveError(`${readers.join(', ')} read${readers.length === 1 ? 's' : ''} ${field.name} — delete ${readers.length === 1 ? 'it' : 'them'} first`, 'invalid');
    const rows = this.listEntities(db.id, { includeDeleted: true });
    const snapshot = {};
    const counts = restore ? { restored: 0, left: 0, converted: 0 } : null;
    for (const e of rows) {
      const ids = this.#relationIds(e, field);
      const stored = e.values[field.id] ?? null;
      let next = ids.map((id) => this.state.entities[id]).filter(Boolean).map((t) => this.entityName(t)).join(', ') || null;
      const pair = restore?.[e.id];
      if (pair && canonicalJSON(stored) === canonicalJSON(pair[1] ?? null)) { next = pair[0]; counts.restored += 1; }
      else if (pair) counts.left += 1;
      else if (counts && ids.length) counts.converted += 1;
      if (ids.length) snapshot[e.id] = [structuredClone(stored), next];
      if (ids.length) this.#setRelationValue(e, db, field, []);
      e.values[field.id] = next;
    }
    const target = this.state.tables[field.config.targetDb];
    if (target && invId) {
      this.#removeFieldRaw(target, invId);
      this.#dropFieldRow(invId);
      this.#syncTableRow(target);
    }
    const { width, description } = field.config;
    field.type = 'text';
    field.config = { ...(width ? { width } : {}), ...(description ? { description } : {}) };
    if (!db.system) this.#audit('field-migrated', { table: db.name, name: field.name, from: 'relation', to: 'text', rows: rows.length });
    return { rows: snapshot, counts };
  }

  deleteField(dbRef, fieldRef) {
    const db = this.getTable(dbRef);
    const field = this.getField(db.id, fieldRef);
    if (field.id === db.nameFieldId) throw new WeaveError('Cannot delete the Name field', 'invalid');
    if (field.type === 'view') throw new WeaveError(`Cannot delete '${field.name}': every row has a ${field.config.shape} by existing — hide it instead`, 'invalid');
    if (field.system) throw new WeaveError(`Field '${field.name}' is part of the system registry`, 'invalid');
    // A lookup or rollup reading this column has no other target and no verb
    // to be repointed with, so the delete is refused rather than left dangling
    // (Issue #206: the dangling id crashed every read reaching the row).
    const readers = this.#targetFieldReaders(field.id);
    if (readers.length) {
      throw new WeaveError(`Cannot delete '${field.name}': ${readers.join(', ')} read${readers.length === 1 ? 's' : ''} it — delete ${readers.length === 1 ? 'that field' : 'those fields'} first`, 'invalid');
    }
    // A view that named this field loses the segment, not its footing.
    for (const shape of VIEW_SHAPES) {
      const v = this.viewField(db, shape);
      if (Array.isArray(v?.config.fields) && v.config.fields.includes(field.id)) v.config.fields = v.config.fields.filter((id) => id !== field.id);
    }
    // The description may go, and it must STAY gone: null is what tells the
    // next open that the owner removed it (Kyle, 2026-08-27).
    if (field.id === db.descriptionFieldId) db.descriptionFieldId = null;
    if (field.type === 'relation') {
      // Unlink all values first so inverse sides stay consistent, then drop both ends.
      for (const e of this.listEntities(db.id)) {
        if (e.values[field.id] != null) this.#setRelationValue(e, db, field, []);
      }
      const other = this.state.tables[field.config.targetDb];
      if (other) this.#removeFieldRaw(other, field.config.inverseFieldId);
    }
    // Drop dependent computed fields.
    for (const f of Object.values(db.fields)) {
      if ((f.type === 'lookup' || f.type === 'rollup') && f.config.relationField === field.id) {
        this.#removeFieldRaw(db, f.id);
      }
    }
    this.#removeFieldRaw(db, field.id);
    this.#dropFieldRow(field.id);
    if (field.type === 'relation' && field.config.inverseFieldId) this.#dropFieldRow(field.config.inverseFieldId);
    this.#syncTableRow(db);
    if (field.type === 'relation' && field.config.targetDb) {
      const far = this.state.tables[field.config.targetDb];
      if (far) this.#syncTableRow(far);
    }
    this.save();
    if (!db.system) this.#audit('field-deleted', { table: db.name, name: field.name });
    return { id: field.id, name: field.name, db: this.qualifiedName(db), deleted: true };
  }

  /* Every lookup/rollup, in any table, whose targetField is this column —
     named `Table.Field` for the refusal message. */
  #targetFieldReaders(fieldId) {
    const out = [];
    for (const t of Object.values(this.state.tables)) {
      for (const f of Object.values(t.fields)) {
        if ((f.type === 'lookup' || f.type === 'rollup') && f.config.targetField === fieldId) out.push(`${t.name}.${f.name}`);
      }
    }
    return out;
  }

  #removeFieldRaw(db, fieldId) {
    if (!db.fields[fieldId]) return;
    const gone = db.fields[fieldId].name;
    delete db.fields[fieldId];
    db.fieldOrder = db.fieldOrder.filter((id) => id !== fieldId);
    // A view loses the column, and any filter or sort that read it.
    for (const v of db.tableViews ?? []) {
      const k = v.fields.indexOf(fieldId);
      if (k >= 0 && k < (v.frozen ?? 0)) { v.frozen -= 1; if (!v.frozen) delete v.frozen; }
      if (v.widths) { delete v.widths[fieldId]; if (!Object.keys(v.widths).length) delete v.widths; }
      if (v.parked) { delete v.parked[fieldId]; if (!Object.keys(v.parked).length) delete v.parked; }
      v.fields = v.fields.filter((id) => id !== fieldId);
      if (v.filters?.[gone]) { delete v.filters[gone]; if (!Object.keys(v.filters).length) delete v.filters; }
      if (v.sort?.some((s) => s.field === gone)) { v.sort = v.sort.filter((s) => s.field !== gone); if (!v.sort.length) delete v.sort; }
    }
    for (const e of this.listEntities(db.id)) {
      delete e.values[fieldId];
      if (e.docs) delete e.docs[fieldId];
      this.#mark(e);
    }
  }

  // Document fields on a table, in field order. The description is the default
  // one — descriptionField(), not whichever happens to sort first.
  documentFields(db) {
    return db.fieldOrder.map((id) => db.fields[id]).filter((f) => f.type === 'document');
  }

  #resolveDocField(db, fieldRef = null) {
    if (fieldRef == null) {
      // The description is the default document. A table that never had one —
      // a registry table, or one whose description the owner deleted — falls
      // back to the old positional rule so its documents stay reachable.
      const described = this.descriptionField(db) ?? this.documentFields(db)[0];
      if (!described) throw new WeaveError(`Table '${db.name}' has no document field`, 'not-found');
      return described;
    }
    const f = this.findField(db, fieldRef);
    if (!f || f.type !== 'document') throw new WeaveError(`'${fieldRef}' is not a document field of '${db.name}'`, 'invalid');
    return f;
  }

  // ---------------- entities ----------------

  /* Soft-deleted rows keep their id, publicId, values, documents and relation
     links — they are simply not "in the table" any more. Every read that means
     "the rows of this table" goes through here, so the trash is invisible by
     default and opting back into it is one explicit flag. */
  listEntities(dbId, { includeDeleted = false } = {}) {
    return Object.values(this.state.entities)
      .filter((e) => e.dbId === dbId && (includeDeleted || !e.deletedAt));
  }

  // The deleted rows of one table, or of the whole workspace when ref is null.
  listTrash(dbRef = null) {
    const dbId = dbRef == null ? null : this.getTable(dbRef).id;
    return Object.values(this.state.entities)
      .filter((e) => e.deletedAt && (dbId == null || e.dbId === dbId))
      .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
      .map((e) => this.readEntity(e.id));
  }

  // A relation target that is still live. Deleted targets keep their link (so
  // restore is lossless) but must not be seen by anything reading through it.
  #liveEntity(id) {
    const e = own(this.state.entities, id);
    if (!e || e.deletedAt) return null;
    const db = this.state.tables[e.dbId];
    if (!db || db.deletedAt || this.state.spaces[db.spaceId]?.deletedAt) return null;
    return e;
  }

  getEntity(id) {
    const e = own(this.state.entities, id);
    if (e) return e;
    // 'Table#12' / 'Space/Table#12' refs work everywhere an id does.
    const m = /^(.+)#(\d+)$/.exec(String(id));
    if (m && this.findTable(m[1])) {
      const found = this.findEntity(m[1], '#' + m[2]);
      if (found) return found;
      // A trashed row answers its ref the way it answers its id, so a
      // second delete or a restore by ref finds it (Issue #597).
      const dbId = this.findTable(m[1]).id;
      const trashed = this.listEntities(dbId, { includeDeleted: true }).find((x) => x.deletedAt && x.publicId === Number(m[2]));
      if (trashed) return trashed;
    }
    throw new WeaveError(`Entity '${id}' not found`, 'not-found');
  }

  findEntity(dbRef, ref) {
    // ref: entity object, entity id, public id (number or '#12'), or exact name
    if (ref && typeof ref === 'object') ref = ref.id;
    if (own(this.state.entities, ref)) return this.state.entities[ref];
    const db = this.getTable(dbRef);
    const list = this.listEntities(db.id);
    // Qualified 'Table#12' / 'Space/Table#12' refs resolve everywhere else
    // (getEntity, REST, mentions); relation targets must match (Issue #21).
    // The named table must BE the target table — 'Task#1' offered to an Issue
    // relation falls through to name matching rather than resolving by pid.
    const q = /^(.+)#(\d+)$/.exec(String(ref));
    if (q) {
      const qt = this.findTable(q[1]);
      if (qt && qt.id === db.id) {
        const byPid = list.find((e) => String(e.publicId) === q[2]);
        if (byPid) return byPid;
      }
    }
    const pid = String(ref).replace(/^#/, '');
    if (/^\d+$/.test(pid)) {
      const byPid = list.find((e) => String(e.publicId) === pid);
      if (byPid) return byPid;
    }
    return list.find((e) => this.entityName(e) === ref)
      ?? list.find((e) => this.entityName(e).toLowerCase() === String(ref).toLowerCase());
  }

  entityName(e) {
    const db = this.state.tables[e.dbId];
    const f = db?.fields?.[db.nameFieldId];
    if (f?.type === 'formula') {
      // Live, not the cache: the cache is for the store (search, sort) and
      // refreshes on the row's own writes; the name a reader sees follows
      // its inputs immediately.
      const v = this.#resolve(e, db, f, 0);
      return v == null ? '' : String(v);
    }
    return String(e.values[db.nameFieldId] ?? '');
  }

  createEntity(dbRef, input = {}, { depth = 0 } = {}) {
    const db = this.getTable(dbRef);
    const meta = this.#interceptCreate(db, input);
    if (meta) return meta;
    // Create must be as forgiving as update (Issue #33). updateEntity takes
    // values by name and the REST layer hands it `body.values ?? body`, so a
    // flat {Name, Estimate} object is the shape callers reach for first.
    // Reading only `input.values` turned that into a 201 with an empty row —
    // silent data loss, and how Feature #66 ended up blank. Anything that is
    // not a documented key is a value; a misspelled field still fails loudly
    // in #applyValues rather than vanishing.
    const flat = Object.fromEntries(
      Object.entries(input).filter(([k]) => !CREATE_INPUT_KEYS.has(k)));
    const values = { ...flat, ...(input.values ?? {}) };
    const nameField = db.fields[db.nameFieldId];
    if (nameField?.type === 'formula') {
      // A computed name cannot be written; the shape every caller reaches
      // for (`{ name }`, the grid's `{ name: '' }`) is tolerated, not refused.
      delete values.Name;
      delete values[nameField.name];
    } else if (input.name != null && values.Name == null && values[nameField?.name] == null) {
      values[nameField?.name ?? 'Name'] = input.name;
    }
    const e = {
      id: uuid(),
      dbId: db.id,
      publicId: ++db.publicIdCounter,
      values: {},
      docs: {},
      comments: [],
      activity: [],
      files: [],
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: this.actor,
      modifiedBy: this.actor,
    };
    // Initial documents: input.doc fills the default document field;
    // input.docs maps document field names to markdown.
    if (input.doc) {
      const f = this.#resolveDocField(db);
      e.docs[f.id] = String(input.doc);
    }
    for (const [fieldName, md] of Object.entries(input.docs ?? {})) {
      const f = this.#resolveDocField(db, fieldName);
      e.docs[f.id] = String(md);
    }
    /* Where a new row starts: a workflow's default state, and every other
       field's configured default — but only for fields this create did not
       name. Naming a field is a choice, including naming it empty. */
    const named = new Set();
    for (const key of Object.keys(values)) {
      const f = this.findField(db, key);
      if (f) named.add(f.id);
    }
    for (const f of Object.values(db.fields)) {
      if (named.has(f.id)) continue;
      // A state only where the author marked one (Issue #421).
      if (f.type === 'workflow') {
        const d = f.config.states.find((s) => s.default);
        if (d) e.values[f.id] = d.id;
      } else if (f.config?.default !== undefined) {
        e.values[f.id] = this.#resolveDefault(f);
      }
    }
    this.state.entities[e.id] = e;
    this.#logActivity(e, 'created', {});
    try {
      this.#applyValues(e, db, values, { depth, isCreate: true });
    } catch (err) {
      // Atomic create: roll back the partial entity (unlink any relations set so far).
      for (const field of Object.values(db.fields)) {
        if (field.type === 'relation' && e.values[field.id] != null) {
          this.#setRelationValue(e, db, field, []);
        }
      }
      delete this.state.entities[e.id];
      db.publicIdCounter--;
      throw err;
    }
    // Recorded before automations run, so their edits sit above the create on
    // the undo stack and step back first.
    this.#recordUndo('create', e);
    // A row born with a document starts its history there (Feature #225).
    for (const [fid, text] of Object.entries(e.docs)) {
      if (text && db.fields[fid]) this.#recordDocRevision(e, db.fields[fid], '', text, { fresh: true });
    }
    this.#runAutomations(db, e, { type: 'entity-created' }, depth);
    this.save();
    return e;
  }

  updateEntity(id, valuesByName, { depth = 0 } = {}) {
    const e = this.getEntity(id);
    const db = this.state.tables[e.dbId];
    const meta = this.#interceptUpdate(e, db, valuesByName);
    if (meta) return meta;
    const before = this.#undoBefore(e, db, Object.keys(valuesByName));
    this.#applyValues(e, db, valuesByName, { depth });
    if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
    this.save();
    return e;
  }

  #applyValues(e, db, valuesByName, { depth = 0, isCreate = false } = {}) {
    for (const [key, raw] of Object.entries(valuesByName)) {
      const field = this.findField(db, key);
      if (!field) throw new WeaveError(`Field '${key}' not found in table '${db.name}'`, 'not-found');
      if (COMPUTED_TYPES.includes(field.type)) {
        throw new WeaveError(`Field '${field.name}' is computed (${field.type}) and cannot be written`, 'invalid');
      }
      if (field.type === 'relation') {
        const ids = this.#normalizeRelationInput(field, raw);
        this.#setRelationValue(e, db, field, ids);
        continue;
      }
      if (field.type === 'workflow') {
        this.#setStateInternal(e, db, field, raw, depth);
        continue;
      }
      if (field.type === 'document') {
        const md = String(raw ?? '');
        const before = e.docs[field.id] ?? '';
        if (before === md) continue;
        const prior = { at: e.updatedAt, by: e.modifiedBy };
        e.docs[field.id] = md;
        e.updatedAt = nowISO();
        e.modifiedBy = this.actor;
        if (!isCreate) this.#logActivity(e, 'doc-updated', docChange(field.name, before, md));
        this.#recordDocRevision(e, field, before, md, { prior });
        continue;
      }
      const val = this.#validateValue(field, raw);
      if (field.type === 'attachments') {
        // A column can only name the entity's OWN files — a foreign id would
        // be a pointer nobody can follow from here.
        for (const id of val) {
          if (!e.files.some((x) => x.id === id)) {
            throw new WeaveError(`'${id}' is not a file on this entity — upload it here first`, 'invalid');
          }
        }
      }
      const old = e.values[field.id];
      if (JSON.stringify(old) === JSON.stringify(val)) continue;
      e.values[field.id] = val;
      e.updatedAt = nowISO();
      e.modifiedBy = this.actor;
      if (!isCreate) this.#logActivity(e, 'field-updated', { field: field.name, from: old ?? null, to: val });
      this.#runAutomations(db, e, { type: 'field-updated', fieldId: field.id }, depth);
    }
  }

  /* A default is a value, so it is validated by the field that will hold it —
     the same call the row itself goes through, at definition time instead of
     write time. Types with nothing to default say so: a computed field has no
     value of its own, a document starts empty, a relation points at rows that
     do not exist yet, and a workflow already has a default state. */
  #validateDefault(field, raw) {
    if (!DEFAULTABLE_TYPES.includes(field.type)) {
      throw new WeaveError(`A ${field.type} field cannot carry a default value`, 'invalid');
    }
    // A date default may be dynamic: today() / now() are stored verbatim
    // and resolved when the row is created (#resolveDefault).
    if (field.type === 'date' && DYNAMIC_DATE_DEFAULTS.includes(String(raw).trim())) return String(raw).trim();
    return this.#validateValue(field, raw);
  }

  /* The engine's clock. `short` drops a current-year year, `relative` counts
     from today, and today()/now() defaults read it — a test pins it. */
  now() { return new Date(); }
  #resolveDefault(field) {
    const d = field.config.default;
    if (field.type === 'date' && DYNAMIC_DATE_DEFAULTS.includes(d)) {
      const iso = this.now().toISOString();
      if (field.config.grain != null) return DG.coerce(field.config, iso.slice(0, 16));
      const stamp = d === 'now()' && field.config.time ? iso.slice(0, 16) : iso.slice(0, 10);
      return field.config.zone === 'instant' && field.config.time ? stamp + 'Z' : stamp;
    }
    return d;
  }

  /* One date value → its stored form under the field's grain. The full
     grain keeps its old lenient rule (anything Date.parse reads, stored as
     given); an instant folds to UTC; a partial grain takes the ISO 8601
     truncated form, cutting a fuller value and refusing a thinner one. */
  #coerceDate(config, raw) {
    if (config.zone === 'instant') {
      const v = DG.coerceInstant(raw);
      if (!v) throw new WeaveError(`'${raw}' is not a valid date and time`, 'invalid');
      return v;
    }
    if (config.grain == null) {
      if (Number.isNaN(Date.parse(raw))) throw new WeaveError(`'${raw}' is not a valid date`, 'invalid');
      return String(raw);
    }
    try { return DG.coerce(config, raw); } catch (e) { throw new WeaveError(e.message, 'invalid'); }
  }
  #validateValue(field, raw) {
    if (raw == null || raw === '') return isBoolType(field.type) ? false : null;
    switch (field.type) {
      case 'toggle': {
        // A label is a way to write the state — the word the switch wears,
        // or the boolean it stores; anything else is refused by name.
        if (typeof raw === 'string') {
          const s = raw.trim().toLowerCase();
          if (s === field.config.on.toLowerCase() || ['true', '1', 'yes'].includes(s)) return true;
          if (s === field.config.off.toLowerCase() || ['false', '0', 'no'].includes(s)) return false;
          throw new WeaveError(`'${raw}' is not a state of '${field.name}' (${field.config.on}, ${field.config.off})`, 'invalid');
        }
        return Boolean(raw);
      }
      case 'text':
        return String(raw);
      case 'url':
      case 'email': {
        const s = String(raw);
        if (field.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
          throw new WeaveError(`'${s}' is not a valid email`, 'invalid');
        }
        return s;
      }
      case 'number': {
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new WeaveError(`'${raw}' is not a number`, 'invalid');
        return n;
      }
      case 'rating': {
        // A whole number on the scale: rounded, then held to 0..max.
        const n = typeof raw === 'boolean' ? NaN : Number(raw);
        if (!Number.isFinite(n)) throw new WeaveError(`'${raw}' is not a rating of '${field.name}' (a whole number from 0 to ${field.config.max})`, 'invalid');
        return ratingValue(n, field.config.max);
      }
      case 'date':
        return this.#coerceDate(field.config, raw);
      case 'daterange': {
        const { start, end } = raw ?? {};
        if (start == null || end == null || start === '' || end === '') throw new WeaveError('Date range needs valid start and end', 'invalid');
        return { start: this.#coerceDate(field.config, start), end: this.#coerceDate(field.config, end) };
      }
      case 'checkbox':
        return Boolean(raw);
      case 'select': {
        const opt = this.#findOption(field.config.options, raw);
        if (!opt) throw new WeaveError(`'${raw}' is not an option of '${field.name}'`, 'invalid');
        return opt.id;
      }
      case 'multiselect': {
        const arr = Array.isArray(raw) ? raw : [raw];
        return arr.map((r) => {
          const opt = this.#findOption(field.config.options, r);
          if (!opt) throw new WeaveError(`'${r}' is not an option of '${field.name}'`, 'invalid');
          return opt.id;
        });
      }
      case 'field':
        /* The value IS a field definition. Validated by the same normaliser
           addField uses, so it can only ever describe a creatable field.
           A definition an author writes is held to the option palette; the
           one the Fields registry mirrors from a field already in the
           workspace is not, because a colour stored before the ramp had its
           names would make the row unwritable (Issue #551). */
        return normalizeDefinition(raw, field.config.depth ?? 1, { strict: !this.#inMetaSync });
      case 'key':
        // Only the NAME is a value; the secret stays in the keystore (#64).
        // An unknown name is storable on purpose — set the secret before or
        // after, the cell shows which state you are in.
        return String(raw);
      case 'attachments': {
        // An array of file ids. Whose files they are is checked at apply
        // time, where the entity is known (#applyValues).
        const arr = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
        if (field.config.multiple === false && arr.length > 1) throw new WeaveError(`'${field.name}' holds one file`, 'invalid');
        return arr.map((r) => String(r && typeof r === 'object' ? r.id : r));
      }
      default:
        throw new WeaveError(`Cannot write field type '${field.type}'`, 'invalid');
    }
  }

  #findOption(options, ref) {
    return options.find((o) => o.id === ref)
      ?? options.find((o) => o.name === ref)
      ?? options.find((o) => o.name.toLowerCase() === String(ref).toLowerCase());
  }

  // The tables a relation field may point at — one for the classic paired
  // field, several for a target-set (polymorphic) field.
  relationTargetDbIds(field) {
    return field.config.targetDbs ?? [field.config.targetDb];
  }

  #normalizeRelationInput(field, raw) {
    const arr = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
    const memberIds = this.relationTargetDbIds(field);
    return arr.map((r) => {
      let target = null;
      for (const dbId of memberIds) {
        target = this.findEntity(dbId, r);
        if (target) break;
      }
      // A uuid of a live entity outside the set resolves nowhere above but is
      // a sharper error than 'not found': the row exists, just not here.
      if (!target && own(this.state.entities, r)) throw new WeaveError(`Entity '${r}' is not in a related table`, 'invalid');
      if (!target) throw new WeaveError(`Related entity '${r}' not found`, 'not-found');
      if (!memberIds.includes(target.dbId)) throw new WeaveError(`Entity '${r}' is not in the related table`, 'invalid');
      return target.id;
    });
  }

  #setRelationValue(e, db, field, newIds) {
    if (!field.config.many && newIds.length > 1) {
      throw new WeaveError(`Field '${field.name}' holds a single entity`, 'invalid');
    }
    const oldIds = this.#relationIds(e, field);
    const removed = oldIds.filter((id) => !newIds.includes(id));
    const added = newIds.filter((id) => !oldIds.includes(id));
    if (!removed.length && !added.length) return;

    // A target-set relation is one-way: no inverse to keep in step — the
    // shared tail below still writes the value and the activity entry.
    if (!field.config.inverseFieldId) {
      for (const rid of added) this.#mark(this.getEntity(rid)); // linked-to, even without a field of its own
    } else {
      const targetDb = this.state.tables[field.config.targetDb];
      const inverse = targetDb.fields[field.config.inverseFieldId];

      for (const rid of removed) {
        const t = this.state.entities[rid];
        if (!t) continue;
        this.#pluck(t, inverse, e.id);
        this.#logInverse(t, inverse, { removed: [this.entityName(e)] });
      }
      for (const rid of added) {
        const t = this.getEntity(rid);
        if (inverse.config.many) {
          const cur = this.#relationIds(t, inverse);
          if (!cur.includes(e.id)) t.values[inverse.id] = [...cur, e.id];
        } else {
          // Steal from the previous holder: t's old single parent loses t.
          const prevHolder = t.values[inverse.id];
          if (prevHolder && prevHolder !== e.id) {
            const p = this.state.entities[prevHolder];
            if (p) {
              this.#pluck(p, field, t.id);
              this.#logInverse(p, field, { removed: [this.entityName(t)] });
            }
          }
          t.values[inverse.id] = e.id;
        }
        this.#logInverse(t, inverse, { added: [this.entityName(e)] });
      }
    }
    e.values[field.id] = field.config.many ? newIds : (newIds[0] ?? null);
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    this.#logActivity(e, 'relation-updated', {
      field: field.name,
      added: added.map((id) => this.entityName(this.state.entities[id])),
      removed: removed.map((id) => this.state.entities[id] ? this.entityName(this.state.entities[id]) : id),
    });
  }

  /* The far side of a paired relation changed too, so it gets its own entry
     (Issue #286): before this, only the row the caller touched was logged and
     the inverse field moved with nothing in its history to say so. `inverse`
     marks the write a row received rather than made — Fibery shows the link on
     both feeds the same way. */
  #logInverse(t, field, { added = [], removed = [] }) {
    this.#logActivity(t, 'relation-updated', { field: field.name, added, removed, inverse: true });
  }

  #relationIds(e, field) {
    const v = e.values[field.id];
    return v == null ? [] : Array.isArray(v) ? v : [v];
  }

  #pluck(entity, field, removeId) {
    const cur = this.#relationIds(entity, field);
    const next = cur.filter((id) => id !== removeId);
    entity.values[field.id] = field.config.many ? next : (next[0] ?? null);
    entity.updatedAt = nowISO();
    this.#mark(entity);
  }

  link(entityId, fieldRef, targetRefs) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const field = this.getField(db.id, fieldRef);
    if (field.type !== 'relation') throw new WeaveError(`Field '${field.name}' is not a relation`, 'invalid');
    const addIds = this.#normalizeRelationInput(field, targetRefs);
    const cur = this.#relationIds(e, field);
    const next = field.config.many ? [...new Set([...cur, ...addIds])] : addIds.slice(-1);
    const before = this.#undoBefore(e, db, [field]);
    this.#setRelationValue(e, db, field, next);
    if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
    this.save();
    return e;
  }

  unlink(entityId, fieldRef, targetRefs) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const field = this.getField(db.id, fieldRef);
    if (field.type !== 'relation') throw new WeaveError(`Field '${field.name}' is not a relation`, 'invalid');
    const removeIds = this.#normalizeRelationInput(field, targetRefs);
    const next = this.#relationIds(e, field).filter((id) => !removeIds.includes(id));
    const before = this.#undoBefore(e, db, [field]);
    this.#setRelationValue(e, db, field, next);
    if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
    this.save();
    return e;
  }

  setState(entityId, fieldRef, stateRef, { depth = 0 } = {}) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const field = this.getField(db.id, fieldRef);
    if (field.type !== 'workflow') throw new WeaveError(`Field '${field.name}' is not a workflow`, 'invalid');
    const before = this.#undoBefore(e, db, [field]);
    this.#setStateInternal(e, db, field, stateRef, depth);
    if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
    this.save();
    return e;
  }

  #setStateInternal(e, db, field, stateRef, depth) {
    // Empty is a state value like any other since Issue #421: a row can start
    // with none, so it can be put back to none.
    const empty = stateRef == null || stateRef === '';
    const state = empty ? null
      : field.config.states.find((s) => s.id === stateRef)
      ?? field.config.states.find((s) => s.name === stateRef)
      ?? field.config.states.find((s) => s.name.toLowerCase() === String(stateRef).toLowerCase());
    if (!empty && !state) throw new WeaveError(`'${stateRef}' is not a state of '${field.name}'`, 'invalid');
    const old = e.values[field.id] ?? null;
    if (old === (state?.id ?? null)) return;
    e.values[field.id] = state?.id ?? null;
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    const oldName = field.config.states.find((s) => s.id === old)?.name ?? null;
    this.#logActivity(e, 'state-changed', { field: field.name, from: oldName, to: state?.name ?? null });
    this.#runAutomations(db, e, { type: 'state-changed', fieldId: field.id, toStateId: state?.id ?? null }, depth);
  }

  /* Recoverable by default. `hard` is the irreversible opt-in: it unlinks the
     relations (so the inverse sides stay consistent) and drops the row. A soft
     delete deliberately leaves the links in place — restoring has to give back
     exactly what was deleted. */
  deleteEntity(ref, { hard = false } = {}) {
    const e = this.getEntity(ref);
    // Everything below speaks the row's id, never the ref it was asked by:
    // a "Table#N" key purged nothing and read back nothing (Issue #597).
    const id = e.id;
    {
      const db = this.state.tables[e.dbId];
      const meta = this.#interceptDelete(e, db, hard);
      if (meta) return meta;
    }
    const db = this.state.tables[e.dbId];
    if (!hard) {
      if (e.deletedAt) return this.readEntity(id); // already in the trash
      e.deletedAt = nowISO();
      e.updatedAt = e.deletedAt;
      this.#logActivity(e, 'deleted', {}, { ts: e.deletedAt });
      this.#recordUndo('delete', e);
      this.#mark(e);
      this.save();
      return this.readEntity(id);
    }
    // Unlink every relation so inverse sides stay consistent.
    for (const field of Object.values(db.fields)) {
      if (field.type === 'relation' && e.values[field.id] != null) {
        this.#setRelationValue(e, db, field, []);
      }
    }
    delete this.state.entities[id];
    this.store.deleteDocRevisions(id); // the history goes with the row (Feature #225)
    this.#mark(id); // absent from state at save time → row delete
    this.save();
    return { id, purged: true };
  }

  /* ---------------- bulk (Feature #132, slice 3) ----------------
     One call for a whole selection: the puck's Set a field…, Link to…,
     Move to table… and Roll up… each reach the engine here instead of
     looping rows from the browser. Every row is its own attempt — `done`
     names what landed, `failed` names what did not and why — because a bulk
     command that half works and reports success is how a row goes missing
     quietly. Each row keeps its own undo step and activity entry; the verbs
     underneath are the single-row ones, so nothing here can drift from them.
       set    { values }                 one value set written across every row
       link   { field, targets }         every row linked to the same targets
       move   { table }                  each row re-created there by field
                                         name (same name, same type) and the
                                         original trashed — files, comments
                                         and unmatched fields stay behind and
                                         are named in `moved[].skipped`
       rollup { field, name?, values?, table? }
                                         one parent created in the relation's
                                         target table, every row linked to it
     ponytail: each row saves on its own; one deferred save is the upgrade
     if a thousand-row selection ever shows up in a profile. */
  bulk(ids, op, params = {}) {
    const list = ids == null ? [] : Array.isArray(ids) ? ids : [ids];
    if (!list.length) throw new WeaveError('ids is required: the rows to act on', 'invalid');
    if (!BULK_OPS.includes(op)) throw new WeaveError(`Unknown bulk op '${op}' (${BULK_OPS.join(', ')})`, 'invalid');
    const out = { op, done: [], failed: [] };
    const each = (fn) => {
      for (const id of list) {
        try { fn(this.getEntity(id)); out.done.push(id); } catch (err) { out.failed.push({ id, error: err.message }); }
      }
    };
    switch (op) {
      case 'set': {
        /* `changed` beside `done`: a set writes the same value across every
           row, and a row that already held it records no undo step. A caller
           that wants one gesture to step the whole write back — the grid's
           fill and paste (Feature #220) — needs the depth of the stack this
           call left, and counting the rows it VISITED would walk past this
           write into somebody else's. Same before-image and same comparison
           `updateEntity` uses, so the two cannot drift. */
        const names = Object.keys(params.values ?? {});
        out.changed = [];
        each((e) => {
          const db = this.state.tables[e.dbId];
          const before = this.#undoBefore(e, db, names.filter((n) => this.findField(db, n)));
          this.updateEntity(e.id, params.values ?? {});
          if (this.#undoChanged(e, before)) out.changed.push(e.id);
        });
        break;
      }
      case 'link':
        each((e) => this.link(e.id, params.field, params.targets ?? []));
        break;
      case 'move': {
        const to = this.getTable(params.table);
        out.moved = [];
        each((e) => {
          const from = this.state.tables[e.dbId];
          if (to.system || from.system) throw new WeaveError('Rows cannot move into or out of a system table', 'invalid');
          if (to.id === from.id) throw new WeaveError(`Already in ${this.qualifiedName(to)}`, 'invalid');
          out.moved.push(this.#moveEntity(e, from, to));
        });
        break;
      }
      case 'rollup': {
        const first = this.getEntity(list[0]);
        const db = this.state.tables[first.dbId];
        const field = this.getField(db.id, params.field);
        if (field.type !== 'relation') throw new WeaveError(`Field '${field.name}' is not a relation`, 'invalid');
        const target = params.table ? this.getTable(params.table) : this.state.tables[this.relationTargetDbIds(field)[0]];
        const parent = this.createEntity(target, { name: params.name, values: params.values ?? {} });
        each((e) => this.link(e.id, field.name, [parent.id]));
        out.parent = this.readEntity(parent.id);
        break;
      }
    }
    return out;
  }

  /* A row's values, spelled the way another table can read them: option and
     state NAMES rather than ids (a same-named select on the far table has
     its own option ids), relation targets as ids. */
  #portable(e, f) {
    const raw = e.values[f.id];
    if (f.type === 'select') return f.config.options.find((o) => o.id === raw)?.name ?? raw;
    if (f.type === 'multiselect') return (raw ?? []).map((id) => f.config.options.find((o) => o.id === id)?.name ?? id);
    if (f.type === 'workflow') return f.config.states.find((s) => s.id === raw)?.name ?? raw;
    return raw;
  }

  #moveEntity(e, from, to) {
    const values = {}, docs = {}, skipped = [];
    for (const f of Object.values(from.fields)) {
      if (COMPUTED_TYPES.includes(f.type)) continue; // a read; it recomputes over there
      const raw = f.type === 'document' ? (e.docs[f.id] ?? '') : e.values[f.id];
      if (raw == null || raw === '' || raw === false || (Array.isArray(raw) && !raw.length)) continue;
      const tf = Object.values(to.fields).find((x) => x.name === f.name && x.type === f.type);
      if (!tf) { skipped.push(f.name); continue; }
      try {
        if (f.type === 'document') { docs[tf.name] = raw; continue; }
        const v = this.#portable(e, f);
        // Checked by the far field's own rule before anything is written, so
        // a value that does not fit skips its field instead of the whole row.
        if (tf.type === 'relation') this.#normalizeRelationInput(tf, v);
        else if (tf.type === 'workflow') { if (!tf.config.states.some((s) => s.name === v)) throw new WeaveError(`'${v}' is not a state of '${tf.name}'`, 'invalid'); }
        else this.#validateValue(tf, v);
        values[tf.name] = v;
      } catch { skipped.push(f.name); }
    }
    const made = this.createEntity(to, { values, docs });
    if (e.files.length) skipped.push('files');
    if (e.comments.length) skipped.push('comments');
    this.#logActivity(made, 'moved', { from: this.qualifiedName(from), publicId: e.publicId, skipped });
    this.deleteEntity(e.id);
    return { from: e.id, to: made.id, skipped };
  }

  restoreEntity(id) {
    const e = this.getEntity(id);
    {
      // A registry row's restore is the structural restore, same one path as
      // its delete — #inMetaSync marks which side started it.
      const db = this.state.tables[e.dbId];
      if (db?.system && !this.#inMetaSync && ['spaces', 'tables'].includes(db.system)) {
        const owner = this.#ownerOf(e);
        if (db.system === 'spaces') owner.restoreSpace(e.sysId);
        else owner.restoreTable(e.sysId);
        return this.readEntity(id);
      }
    }
    if (!e.deletedAt) return this.readEntity(id);
    e.deletedAt = null;
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    this.#logActivity(e, 'restored', {}, { ts: e.updatedAt });
    this.#recordUndo('restore', e);
    this.#mark(e);
    this.save();
    return this.readEntity(id);
  }

  // ---------------- computed values ----------------

  resolveField(e, fieldRef, depth = 0) {
    const db = this.state.tables[e.dbId];
    const field = this.findField(db, fieldRef);
    if (!field) {
      if (fieldRef === 'createdAt' || fieldRef === 'Created At') return e.createdAt;
      if (fieldRef === 'updatedAt' || fieldRef === 'Updated At') return e.updatedAt;
      if (fieldRef === 'publicId' || fieldRef === 'Public Id') return e.publicId;
      throw new WeaveError(`Field '${fieldRef}' not found in table '${db.name}'`, 'not-found');
    }
    return this.#resolve(e, db, field, depth);
  }

  /* A computed field is keyed by the row it is computing on, so the same
     field on two rows is two computations and only a return to the same pair
     is a loop. The stack is per-engine and unwound in a `finally`, so an
     erroring formula never leaves a row looking cyclic to the next read. */
  #resolve(e, db, field, depth) {
    if (depth > MAX_COMPUTE_DEPTH) return null;
    if (field.type !== 'formula' && field.type !== 'lookup' && field.type !== 'rollup') {
      return this.#resolveValue(e, db, field, depth);
    }
    const key = `${e.id}:${field.id}`;
    const frame = { key, name: field.name, row: e.id, rowName: this.#rawName(e, db) };
    const at = this.#computing.findIndex((c) => c.key === key);
    if (at >= 0) {
      // A loop that stays on one row names its fields; one that travels — two
      // rows pointing at each other through a rollup — names the rows too,
      // since 'Double → PeerSum → Double' would read as a loop on one row.
      const loop = [...this.#computing.slice(at), frame];
      const travels = new Set(loop.map((c) => c.row)).size > 1;
      return CYCLE_PREFIX + loop.map((c) => (travels && c.rowName ? `${c.rowName} › ${c.name}` : c.name)).join(' → ');
    }
    this.#computing.push(frame);
    try {
      return this.#resolveValue(e, db, field, depth);
    } finally {
      this.#computing.pop();
    }
  }

  /* The row's stored name, never a computed one: a formula Name is read
     while a cycle is being reported, and computing it could walk back into
     the loop. `#mark` materialises it on every write, so the stored string
     is the name the reader saw. */
  #rawName(e, db) {
    const raw = e.values?.[db?.nameFieldId];
    return raw == null ? '' : String(raw);
  }

  #resolveValue(e, db, field, depth) {
    switch (field.type) {
      case 'relation':
        // Deleted targets stay linked in storage but are never read back out.
        return this.#relationIds(e, field).filter((id) => this.#liveEntity(id));
      // A relation or target field that is gone (a workspace from before
      // deleteField refused it — Issue #206) resolves to null: one dangling
      // id must not take down every read that reaches the row.
      case 'lookup': {
        const rel = db.fields[field.config.relationField];
        const targetDb = rel && this.state.tables[rel.config.targetDb];
        const targetField = targetDb?.fields[field.config.targetField];
        if (!targetField) return null;
        const vals = this.#relationIds(e, rel)
          .map((id) => this.#liveEntity(id))
          .filter(Boolean)
          .map((t) => this.#resolve(t, targetDb, targetField, depth + 1));
        // A looked-up value that is itself part of a loop carries the loop
        // out, rather than being listed or joined as if it were a value.
        const looped = vals.find(isCycle);
        if (looped) return looped;
        return rel.config.many ? vals : (vals[0] ?? null);
      }
      case 'rollup': {
        const { targetDb, targetField, owner } = this.#rollupTarget(db, field);
        if (!targetDb) return null;
        let rows;
        if (field.config.via) {
          // A space rollup answers on the row of the space that holds the
          // table; every other Spaces row reads null, the way a rollup that
          // lost its target does. The table's rows are read from the engine
          // that owns it (Feature #219).
          if (e.sysId !== targetDb.spaceId) return null;
          rows = owner.listEntities(targetDb.id);
          const w = field.config.where;
          if (w) {
            try { rows = rows.filter((r) => owner.#matchNode(r, targetDb, Array.isArray(w) ? { and: w } : w)); } catch { return null; }
          }
        } else {
          const rel = db.fields[field.config.relationField];
          rows = this.#relationIds(e, rel).map((id) => this.#liveEntity(id)).filter(Boolean);
        }
        if (field.config.aggregate === 'count') return rows.length;
        if (!targetField) return null;
        const vals = rows.map((t) => this.#resolve(t, targetDb, targetField, depth + 1));
        // Summing a loop would report a number nobody can explain: the loop
        // is the answer.
        const looped = vals.find(isCycle);
        if (looped) return looped;
        const display = rows.map((t, i) => this.#displayValue(targetDb, targetField, vals[i], t));
        return aggregateValues(field.config.aggregate, vals, { display, separator: field.config.separator ?? ', ' });
      }
      case 'view':
        return this.renderView(e.id, field.config.shape);
      case 'formula': {
        try {
          return evaluate(field.config.expression, (name) => {
            const f = this.findField(db, name);
            if (!f) {
              if (name === 'PublicId') return e.publicId;
              throw new WeaveError(`Formula references unknown field '${name}'`, 'invalid');
            }
            const v = this.#resolve(e, db, f, depth + 1);
            // A field in a loop stops the arithmetic here: `[Looped] + 1` has
            // no honest answer, so the formula reports the loop it sits on.
            if (isCycle(v)) throw new CycleSignal(v);
            // Numbers stay numbers in formulas — the display costume (#97)
            // would turn '$1,200.50' * 2 into NaN — and a date stays its
            // stored ISO form: a day-only field displays '15', which no date
            // function could read back. Everything else keeps its display
            // form (state and option names, joined relations).
            return typeof v === 'number' || f.type === 'date' ? v : this.#displayValue(db, f, v, e);
          });
        } catch (err) {
          if (err instanceof CycleSignal) return err.marker;
          return `#ERR: ${err.message}`;
        }
      }
      case 'document':
        return e.docs?.[field.id] ?? '';
      case 'rating': {
        // A max lowered since the write holds the value to the new ceiling.
        const v = e.values[field.id];
        return typeof v === 'number' ? Math.min(v, field.config.max) : null;
      }
      default:
        return e.values[field.id] ?? (isBoolType(field.type) ? false : null);
    }
  }

  // Human-readable value: option/state names, entity names for relations.
  #displayValue(db, field, resolved, e = null) {
    if (resolved == null) return null;
    // A cycle marker wears no costume: '$#CYCLE…' would read as a value.
    if (isCycle(resolved)) return resolved;
    switch (field.type) {
      case 'select':
        return this.#findOption(field.config.options, resolved)?.name ?? resolved;
      case 'multiselect':
        return resolved.map((id) => this.#findOption(field.config.options, id)?.name ?? id);
      case 'workflow':
        return field.config.states.find((s) => s.id === resolved)?.name ?? resolved;
      case 'field': {
        // A definition should read as a sentence in a grid cell, not as JSON —
        // and the sentence is what a clear quotes back before it takes the
        // definition away (Issue #90), so a costume belongs in it.
        const c = resolved.config ?? {};
        const n = c.options?.length ?? c.states?.length ?? 0;
        const unit = c.states ? 'state' : 'option';
        if (n) return `${resolved.type} · ${n} ${unit}${n === 1 ? '' : 's'}`;
        const costume = resolved.type === 'number' || resolved.type === 'formula'
          ? (c.format === 'currency' ? `currency ${c.currency ?? 'USD'}` : c.format === 'percent' ? 'percent' : c.unit ?? null)
          : resolved.type === 'date' || resolved.type === 'daterange'
            ? ([c.grain ? (c.grain.length ? c.grain.join('·') : 'time') : null, c.format ?? (c.time ? 'with time' : null)].filter(Boolean).join(' · ') || null)
            : resolved.type === 'document' ? c.kind ?? null
              : resolved.type === 'field' ? `depth ${c.depth ?? 1}` : null;
        return costume ? `${resolved.type} · ${costume}` : resolved.type;
      }
      case 'key': {
        /* The name and — for the local store only — whether it holds it. Never
           the secret: the value is write-only by design, so the cell shows
           asterisks and the credential's NAME (Kyle, 2026-08-23).
           A remote keystore gets no `(unset)`: weave cannot see inside
           1Password, and a cell that guesses is worse than one that does not
           say (Feature #143). */
        const { keystore } = this.credentialConfig(field);
        const unset = keystore === 'local' && !this.hasKey(resolved) ? ' (unset)' : '';
        return `✱✱✱✱ ${resolved}${unset}`;
      }
      case 'attachments': {
        if (!Array.isArray(resolved) || !resolved.length) return null;
        // A name whose bytes are gone still names itself — the reader has to
        // know WHICH file was lost, not just that one was (Issue #121).
        const names = resolved.map((id) => {
          const f = e?.files?.find((x) => x.id === id);
          if (!f) return '(missing)';
          return this.#hasBlob(id) ? f.name : `${f.name} (missing)`;
        });
        return names.join(', ');
      }
      case 'date': {
        // A field that says nothing still dresses: the default costume
        // (date-grain's DEFAULT_FORMAT / DEFAULT_CLOCK) is a costume too.
        return dressDate({ ...field.config, now: this.now(), viewerZone: this.viewerZone ?? 'UTC' }, resolved);
      }
      case 'daterange':
        return dressDateRange({ ...field.config, now: this.now(), viewerZone: this.viewerZone ?? 'UTC' }, resolved);
      case 'number':
        return dressNumber(field.config, resolved);
      case 'formula':
        // A date formula wears its grain and style (Issue #576); a numeric
        // result wears the field's number costume; anything else (text, a
        // date with no grain) is already in display form.
        if (field.config.grain) return typeof resolved === 'string' ? dressDate({ ...field.config, now: this.now(), viewerZone: this.viewerZone ?? 'UTC' }, resolved) : resolved;
        return typeof resolved === 'number' ? dressNumber(field.config, resolved) : resolved;
      case 'view':
        return resolved && typeof resolved === 'object' ? this.#viewLine(resolved) : resolved;
      case 'relation': {
        const names = resolved.map((id) => {
          const t = this.state.entities[id];
          return t ? this.entityName(t) : id;
        });
        return field.config.many ? names : (names[0] ?? null);
      }
      case 'lookup': {
        /* A looked-up relation reads the far rows' names, the way the
           relation column reads (Issue #643): it printed their uuids. */
        const far = this.#lookupRelation(db, field, resolved);
        if (far) {
          const names = far.ids.map((id) => this.entityName(this.state.entities[id]));
          return far.many ? names : (names[0] ?? null);
        }
        /* A looked-up option or state wears the far field's name for it, the
           way that column paints itself: the slug "credit-card" stood in for
           "Credit card" (Issue #598). Other types keep their value as read. */
        const rel = db.fields[field.config.relationField];
        const targetDb = rel && this.state.tables[rel.config.targetDb];
        const target = targetDb?.fields[field.config.targetField];
        if (!['select', 'multiselect', 'workflow'].includes(target?.type)) return resolved;
        const dress = (v) => this.#displayValue(targetDb, target, v);
        return rel.config.many ? resolved.map(dress) : dress(resolved);
      }
      case 'rollup': {
        // The figure wears the column it summarises: a sum of dollars is
        // dollars, the earliest of a date column is a date. Counts stay
        // counts; join is already text.
        const { targetField } = this.#rollupTarget(db, field);
        const agg = field.config.aggregate;
        if (!targetField || !NUMERIC_AGGREGATES.includes(agg)) return resolved;
        if (typeof resolved === 'number' && (targetField.type === 'number' || targetField.type === 'formula')) {
          // A mean or a deviation of whole numbers is rarely whole; two
          // decimals unless the column already says how many.
          const c = targetField.config;
          const fractional = !Number.isInteger(resolved) && c.decimals == null && c.format !== 'currency';
          return dressNumber(fractional ? { ...c, decimals: 2 } : c, resolved);
        }
        if (typeof resolved === 'string' && targetField.type === 'date' && (agg === 'min' || agg === 'max')) {
          return dressDate({ ...targetField.config, now: this.now(), viewerZone: this.viewerZone ?? 'UTC' }, resolved);
        }
        return resolved;
      }
      default:
        return resolved;
    }
  }

  /* The far rows a lookup of a relation reaches (Issue #643): each row once,
     in the order the path meets it, and whether the answer is a list (either
     hop to-many). Null when the lookup reads anything but a relation. */
  #lookupRelation(db, field, resolved) {
    if (field.type !== 'lookup') return null;
    const rel = db.fields[field.config.relationField];
    const target = rel && this.state.tables[rel.config.targetDb]?.fields[field.config.targetField];
    if (target?.type !== 'relation') return null;
    const lists = rel.config.many ? resolved : [resolved];
    const ids = Array.isArray(lists) ? lists.flat().filter((id) => typeof id === 'string' && !isCycle(id)) : [];
    return { ids: [...new Set(ids)], many: !!(rel.config.many || target.config.many) };
  }

  /* Where a rollup reads from: the relation's far table, or the table `via`
     names. Either may be gone (Issue #206); the caller treats null as null. */
  #rollupTarget(db, field) {
    let targetDb = null;
    let owner = this;
    if (field.config.via) {
      const hit = this.#tableAnywhere(field.config.via);
      targetDb = hit?.table;
      owner = hit?.owner ?? this;
      if (targetDb?.deletedAt) targetDb = null;
    } else {
      const rel = db.fields[field.config.relationField];
      targetDb = rel && this.state.tables[rel.config.targetDb];
    }
    const targetField = targetDb && field.config.targetField ? targetDb.fields[field.config.targetField] ?? null : null;
    return { targetDb: targetDb ?? null, targetField, owner };
  }

  /* A `where` is checked when it is stored, not when a row happens to be
     read: every path must name a field (or `id`/`publicId`), hopping only
     through single-target relations. Mirrors #pathValue's rules. */
  #checkWhere(db, node) {
    if (Array.isArray(node)) {
      if (node.length === 3 && typeof node[0] === 'string') {
        const parts = node[0].split('.');
        let cdb = db;
        for (let i = 0; i < parts.length; i++) {
          const last = i === parts.length - 1;
          if (last && (parts[i] === 'id' || parts[i] === 'publicId')) return;
          const f = this.findField(cdb, parts[i]);
          if (!f) throw new WeaveError(`Field '${parts[i]}' not found in table '${cdb.name}'`, 'not-found');
          if (!last) {
            if (f.type !== 'relation' || !f.config.targetDb) throw new WeaveError(`'${parts[i]}' is not a relation; cannot traverse`, 'invalid');
            cdb = this.state.tables[f.config.targetDb];
          }
        }
        return;
      }
      for (const n of node) this.#checkWhere(db, n);
      return;
    }
    if (node && typeof node === 'object' && (node.and || node.or)) {
      for (const n of node.and ?? node.or) this.#checkWhere(db, n);
      return;
    }
    throw new WeaveError('Invalid where node', 'invalid');
  }

  /* The space rollups pointed at a table, with their live values — what the
     grid footer draws under each column and the space page draws as tiles. */
  tableRollups(dbRef) {
    const db = this.getTable(dbRef);
    const spacesT = this.#sysTable('spaces');
    const row = spacesT && this.#sysRow('spaces', db.spaceId);
    if (!row) return [];
    const out = [];
    const reg = this.#reg;
    for (const fid of spacesT.fieldOrder) {
      const f = spacesT.fields[fid];
      if (f?.type !== 'rollup' || f.config.via !== db.id) continue;
      const value = reg.#resolve(row, spacesT, f, 0);
      const display = value == null ? null : reg.#displayValue(spacesT, f, value, row);
      out.push({
        fieldId: f.id, name: f.name, spaceRowId: row.id,
        targetField: f.config.targetField ? db.fields[f.config.targetField]?.name ?? null : null,
        aggregate: f.config.aggregate, where: f.config.where ?? null,
        value, display: display == null ? null : String(display),
      });
    }
    return out;
  }

  /* Every column of a table, summarised: the five-number summary and a
     histogram for numbers, a distribution for chips and checkboxes, the span
     for dates, the distinct count for text. `by` groups the numeric columns
     on one field; `where` narrows the rows. One read, computed on demand —
     nothing is stored, so nothing can go stale. */
  tableStats(dbRef, { by = null, where = null } = {}) {
    const db = this.getTable(dbRef);
    let rows = this.listEntities(db.id);
    if (where && (Array.isArray(where) ? where.length : true)) {
      this.#checkWhere(db, where);
      rows = rows.filter((r) => this.#matchNode(r, db, Array.isArray(where) ? { and: where } : where));
    }
    const SKIP = new Set(['view', 'document', 'attachments', 'key', 'field']);
    const fields = db.fieldOrder.map((id) => db.fields[id]).filter((f) => f && !SKIP.has(f.type));
    const isBlank = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
    const read = (f) => {
      const vals = rows.map((e) => this.#resolve(e, db, f, 0));
      const display = rows.map((e, i) => this.#displayValue(db, f, vals[i], e));
      return { vals, display };
    };
    const numericCostume = (f) => {
      if (f.type === 'number' || f.type === 'formula') return f.config;
      if (f.type === 'rollup') return this.#rollupTarget(db, f).targetField?.config ?? {};
      return {};
    };
    const dress = (f, v) => {
      if (v == null) return null;
      if (typeof v !== 'number') return String(v);
      const c = numericCostume(f);
      const fractional = !Number.isInteger(v) && c.decimals == null && c.format !== 'currency';
      return String(dressNumber(fractional ? { ...c, decimals: 2 } : c, v));
    };
    const kindOf = (f, vals) => {
      if (f.type === 'number' || f.type === 'rating') return 'number';
      if (f.type === 'formula' || f.type === 'rollup' || f.type === 'lookup') {
        return vals.some((v) => typeof v === 'number') ? 'number' : vals.some((v) => Array.isArray(v)) ? 'category' : 'text';
      }
      if (['select', 'multiselect', 'workflow', 'checkbox', 'toggle', 'relation'].includes(f.type)) return 'category';
      if (f.type === 'date') return 'date';
      return 'text';
    };
    const dayOf = (iso) => Date.parse(String(iso).length <= 10 ? `${iso}T00:00:00Z` : iso);
    const columns = fields.map((f) => {
      const { vals, display } = read(f);
      const kind = kindOf(f, vals);
      const col = { id: f.id, name: f.name, type: f.type, kind, filled: vals.filter((v) => !isBlank(v)).length, empty: vals.filter(isBlank).length };
      if (kind === 'number') {
        col.summary = describeNumbers(vals);
        col.display = Object.fromEntries(Object.entries(col.summary).map(([k, v]) => [k, k === 'n' ? String(v) : dress(f, v)]));
        col.histogram = histogram(vals, 10).map((b) => ({ ...b, fromDisplay: dress(f, b.from), toDisplay: dress(f, b.to) }));
      } else if (kind === 'category') {
        col.distribution = distribution(display);
      } else if (kind === 'date') {
        const iso = vals.filter((v) => typeof v === 'string' && v);
        col.earliest = aggregateValues('min', iso);
        col.latest = aggregateValues('max', iso);
        col.earliestDisplay = col.earliest == null ? null : this.#displayValue(db, f, col.earliest);
        col.latestDisplay = col.latest == null ? null : this.#displayValue(db, f, col.latest);
        col.spanDays = col.earliest == null ? null : Math.round((dayOf(col.latest) - dayOf(col.earliest)) / 86400000);
        col.byMonth = distribution(iso.map((v) => v.slice(0, 7)));
      } else {
        col.distinct = aggregateValues('distinct', display);
      }
      return col;
    });
    const out = { table: this.qualifiedName(db), rows: rows.length, columns, rollups: this.tableRollups(db.id) };
    if (by) {
      const byF = this.getField(db.id, by);
      const { display: keys } = read(byF);
      const numeric = columns.filter((c) => c.kind === 'number' && c.id !== byF.id).map((c) => db.fields[c.id]);
      const buckets = new Map();
      rows.forEach((e, i) => {
        const ks = isBlank(keys[i]) ? [null] : (Array.isArray(keys[i]) ? keys[i] : [keys[i]]);
        for (const k of ks) {
          const key = isBlank(k) ? null : (typeof k === 'object' ? JSON.stringify(k) : k);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(e);
        }
      });
      out.by = byF.name;
      out.groups = [...buckets].map(([value, members]) => {
        const g = { value, rows: members.length, columns: {}, display: {} };
        for (const f of numeric) {
          const vals = members.map((e) => this.#resolve(e, db, f, 0));
          const d = describeNumbers(vals);
          g.columns[f.name] = { n: d.n, sum: d.sum, avg: d.avg, median: d.median, min: d.min, max: d.max };
          g.display[f.name] = Object.fromEntries(Object.entries(g.columns[f.name]).map(([k, v]) => [k, k === 'n' ? String(v) : dress(f, v)]));
        }
        return g;
      }).sort((a, b) => b.rows - a.rows || (a.value == null) - (b.value == null) || String(a.value).localeCompare(String(b.value)));
    }
    return out;
  }

  // Full materialized read: everything by field name, display values + raw.
  /* A read may say where it is being read from: an instant renders in that
     zone. The engine has no reader of its own, so UTC is the default — the
     browser sends its zone on every request (routes.js, X-Weave-Zone). */
  readEntity(id, { viewerZone = null } = {}) {
    if (viewerZone == null) return this.#readEntityIn(id);
    const prev = this.viewerZone;
    this.viewerZone = DG.isZone(viewerZone) ? viewerZone : null;
    try { return this.#readEntityIn(id); } finally { this.viewerZone = prev; }
  }
  /* `pick` and `chips` are the table query's cut (Issue #272), never a
     caller's: `pick` is the set of field ids to read (null reads them all)
     plus whether the history rides along, and `chips` collects each far
     row's summary once, the relation value carrying only a reference. */
  #readEntityIn(id, { pick = null, chips = null } = {}) {
    const e = this.getEntity(id);
    const db = this.state.tables[e.dbId];
    const fields = {};
    const raw = {};
    for (const fid of db.fieldOrder) {
      if (pick && !pick.ids.has(fid)) continue;
      const f = db.fields[fid];
      const resolved = this.#resolve(e, db, f, 0);
      raw[f.name] = resolved;
      // A lookup of a relation carries the far rows' chips too (Issue #643).
      const far = f.type === 'relation' ? { ids: resolved, many: f.config.many } : this.#lookupRelation(db, f, resolved);
      if (far) {
        const summaries = far.ids.map((rid) => {
          if (!chips) return this.#summary(rid);
          const s = chips[rid] ?? this.#summary(rid);
          if (!s) return null;
          chips[rid] = s;
          return { id: s.id, publicId: s.publicId, name: s.name };
        }).filter(Boolean);
        fields[f.name] = far.many ? summaries : (summaries[0] ?? null);
      } else {
        fields[f.name] = this.#displayValue(db, f, resolved, e);
      }
    }
    const docs = {};
    for (const f of this.documentFields(db)) if (!pick || pick.ids.has(f.id)) docs[f.name] = e.docs?.[f.id] ?? '';
    const defaultDocField = this.descriptionField(db) ?? this.documentFields(db)[0];
    /* The 100% mark each graphic number column is drawn against (Feature
       #230). Only when there is one: a table of plain figures reads as it
       always did. */
    const scales = {};
    for (const fid of db.fieldOrder) {
      if (pick && !pick.ids.has(fid)) continue;
      const f = db.fields[fid];
      if (this.#numberDisplay(db, f)) scales[f.name] = this.#scaleOf(db, f);
    }
    if (pick) {
      /* The cut row: identity, stamps and the named fields. The comments,
         the files and the history are the entity page's, and they were most
         of a wide table's bytes; the history comes back when the grid's
         Activity column is showing, since that column counts it. */
      const docNamed = defaultDocField && pick.ids.has(defaultDocField.id);
      return {
        id: e.id,
        publicId: e.publicId,
        db: this.qualifiedName(db),
        dbId: db.id,
        name: this.entityName(e),
        fields,
        raw,
        ...(docNamed ? { doc: e.docs?.[defaultDocField.id] ?? '', docField: defaultDocField.name } : {}),
        docs,
        ...(pick.activity ? { activity: e.activity, activityDropped: e.activityDropped ?? 0 } : {}),
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        createdBy: e.createdBy ?? null,
        modifiedBy: e.modifiedBy ?? null,
        deletedAt: e.deletedAt ?? null,
        url: `/e/${e.id}`,
        ...(Object.keys(scales).length ? { scales } : {}),
        ...(e.sysId ? { sysId: e.sysId, sysWorkspaceId: this.#wsIdOfRow(e) } : {}),
      };
    }
    return {
      id: e.id,
      publicId: e.publicId,
      db: this.qualifiedName(db),
      dbId: db.id,
      name: this.entityName(e),
      fields,
      raw,
      doc: defaultDocField ? (e.docs?.[defaultDocField.id] ?? '') : '',
      // `docs` is keyed by field NAME, and Kyle may rename the description
      // (2026-08-27). Saying which key `doc` came from is what lets a client
      // label the thing it is showing without hard-coding 'Description'.
      docField: defaultDocField ? defaultDocField.name : null,
      docs,
      comments: e.comments,
      activity: e.activity,
      // Older entries past the cap are gone; this says how many (Issue #281).
      activityDropped: e.activityDropped ?? 0,
      /* Metadata outlives bytes: a dump that carried no blobs, a backup that
         took the .db and left files/ behind. A surface must be able to tell
         the two apart, or it draws a live-looking link into a 404 and the
         reader is left guessing (Issue #121). */
      files: e.files.map((f) => (this.#hasBlob(f.id) ? f : { ...f, missing: true })),
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      createdBy: e.createdBy ?? null,
      modifiedBy: e.modifiedBy ?? null,
      deletedAt: e.deletedAt ?? null,
      url: `/e/${e.id}`,
      ...(Object.keys(scales).length ? { scales } : {}),
      // A registry row stands for a piece of structure; sysId says which, so
      // a surface can open the space/table itself rather than the row.
      ...(e.sysId ? { sysId: e.sysId, sysWorkspaceId: this.#wsIdOfRow(e) } : {}),
    };
  }

  /* The graphic a number column wears, or null for text (Feature #230): its
     own costume on a number or a formula; a rollup wears the costume of the
     column it summarises, the way it wears its format. A count is a count. */
  #numberDisplay(db, f) {
    let c = null;
    if (f.type === 'number' || f.type === 'formula') c = f.config;
    else if (f.type === 'rollup' && NUMERIC_AGGREGATES.includes(f.config.aggregate)) {
      const { targetField } = this.#rollupTarget(db, f);
      if (targetField && (targetField.type === 'number' || targetField.type === 'formula')) c = targetField.config;
    }
    return c && isGraphicDisplay(c.display) ? { display: c.display, scale: c.scale ?? 'column', color: c.color ?? 'ink' } : null;
  }

  /* What 100% is: the fixed scale, or the column's max — computed by
     src/stats.js, the one place a list becomes a figure, so it is the same
     number a Space-level `via` max rollup over the column reads. */
  #scaleOf(db, f) {
    const d = this.#numberDisplay(db, f);
    if (!d) return null;
    if (typeof d.scale === 'number') return d.scale;
    const key = `${db.id}:${f.id}`;
    if (!this.#scales.has(key)) {
      const vals = this.listEntities(db.id).map((r) => this.#resolve(r, db, f, 0)).filter((v) => typeof v === 'number' && Number.isFinite(v));
      this.#scales.set(key, vals.length ? aggregateValues('max', vals) : null);
    }
    return this.#scales.get(key);
  }

  /* The scale a field's value is drawn on as icons (Feature #231): the
     rating's own, or — for a lookup of a rating and a rollup whose answer
     stays on the scale — the rating it reads. Null for everything else. */
  #ratingOf(db, f) {
    // The colour rides with the scale (Feature #235): a lookup or a rollup
    // draws the rating it reads in that rating's colour.
    const scaleOf = (r) => ({ max: r.config.max, icon: r.config.icon, color: r.config.color ?? 'ink' });
    if (f.type === 'rating') return scaleOf(f);
    if (f.type === 'lookup') {
      const rel = db.fields[f.config.relationField];
      const target = rel && this.state.tables[rel.config.targetDb]?.fields[f.config.targetField];
      return target?.type === 'rating' ? scaleOf(target) : null;
    }
    if (f.type === 'rollup' && RATING_SCALE_AGGS.includes(f.config.aggregate)) {
      const { targetField } = this.#rollupTarget(db, f);
      return targetField?.type === 'rating' ? scaleOf(targetField) : null;
    }
    return null;
  }

  #summary(id) {
    const e = own(this.state.entities, id);
    if (!e) return null;
    const db = this.state.tables[e.dbId];
    /* The far row's chip rides along so a relation cell draws the same chip
       a doc mention does. ponytail: a chip resolves up to three fields per
       related row; index it at write time if relations grow past ~1k. */
    return { id: e.id, publicId: e.publicId, name: this.entityName(e), db: this.qualifiedName(db), ...(db.system ? {} : { chip: this.renderView(e.id, 'chip') }) };
  }

  // ---------------- query ----------------

  // where: [ [path, op, value], ... ] AND-combined, or { or:[...] } / { and:[...] } nodes.
  query(dbRef, { viewerZone = null, ...opts } = {}) {
    if (viewerZone == null) return this.#queryIn(dbRef, opts);
    const prev = this.viewerZone;
    this.viewerZone = DG.isZone(viewerZone) ? viewerZone : null;
    try { return this.#queryIn(dbRef, opts); } finally { this.viewerZone = prev; }
  }
  #queryIn(dbRef, { where = [], sort = [], limit = null, offset = 0, select = null, fields = null, relations = 'full', includeDeleted = false, trashCount = false, countAll = false, search = '' } = {}) {
    const db = this.getTable(dbRef);
    /* What the reader draws, and no more (Issue #272). `select` is the flat
       projection an agent asks a narrow question with; `fields` keeps the
       entity shape a grid draws from and cuts it to the named fields (and a
       system column: the stamps always ride, Activity brings the history).
       `relations: 'chip'` answers a relation as a reference and sends each
       far row's summary once in `chips`: a Case page embedded the same forty
       suites two hundred times, each with its chip's segments. */
    if (fields != null && !Array.isArray(fields)) throw new WeaveError('fields must be a list of field names', 'invalid');
    if (fields && select) throw new WeaveError('Ask for select or fields, not both: select is a flat projection, fields cuts the entity', 'invalid');
    if (relations != null && relations !== 'full' && relations !== 'chip') throw new WeaveError(`relations must be 'full' or 'chip' (got '${relations}')`, 'invalid');
    const pick = fields && { ids: new Set(), activity: false };
    for (const name of fields ?? []) {
      // The Activity column counts the history, even beside a field of that name.
      if (name === 'Activity') pick.activity = true;
      const f = this.findField(db, name);
      if (f) pick.ids.add(f.id);
      else if (name !== 'Activity' && !Object.hasOwn(SYSTEM_SORT_KEYS, name)) this.getField(db.id, name);
    }
    const chips = relations === 'chip' && !select ? Object.create(null) : null;
    let rows = this.listEntities(db.id, { includeDeleted });
    /* `countAll: true` answers N beside the filtered total: the table's
       undeleted rows before any where or search, so the Filters popover
       reads "X of N" off the read the grid makes anyway (Issue #448). */
    const all = countAll ? (includeDeleted ? this.listEntities(db.id).length : rows.length) : null;
    /* `search` is the ⌘K matcher scoped to this table (Feature #228): it
       narrows whatever the where-clause and the sort make of the table, and
       `total` counts the matches, so a paged grid pages through them. */
    if (String(search ?? '').trim()) {
      const hit = new Set(this.#searchHits(search, db.id).map((h) => h.e.id));
      rows = rows.filter((e) => hit.has(e.id));
    }
    /* `trashCount: true` answers how many of the table's rows are in the
       trash — the whole table's, not the filtered page's — so the table page
       can print its eyeball count without reading the trash list (Issue #270). */
    const trashed = trashCount
      ? this.listEntities(db.id, { includeDeleted: true }).filter((e) => e.deletedAt).length
      : null;
    if (where && (Array.isArray(where) ? where.length : true)) {
      rows = rows.filter((e) => this.#matchNode(e, db, Array.isArray(where) ? { and: where } : where));
    }
    for (const s of [...sort].reverse()) {
      const { field, dir = 'asc' } = typeof s === 'string' ? { field: s } : s;
      const mul = dir === 'desc' ? -1 : 1;
      /* Undressed: a sort orders the value, not the costume it wears. The
         grid read "Sep 9, 2026" above every Sep 12 row because the painted
         string is what reached the comparator (Issue #279). */
      rows = [...rows].sort((a, b) => {
        const av = this.#pathValue(a, db, field, { undressed: true });
        const bv = this.#pathValue(b, db, field, { undressed: true });
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mul;
        return String(av).localeCompare(String(bv)) * mul;
      });
    }
    const total = rows.length;
    rows = rows.slice(offset, limit != null ? offset + limit : undefined);
    const items = rows.map((e) => {
      if (!select) return this.#readEntityIn(e.id, { pick, chips });
      const out = { id: e.id, publicId: e.publicId, name: this.entityName(e) };
      for (const path of select) out[path] = this.#pathValue(e, db, path);
      return out;
    });
    return { total, items, ...(chips ? { chips } : {}), ...(trashCount ? { trashCount: trashed } : {}), ...(countAll ? { all } : {}) };
  }

  #matchNode(e, db, node) {
    if (Array.isArray(node)) return this.#matchCondition(e, db, node);
    if (node.and) return node.and.every((n) => this.#matchNode(e, db, n));
    if (node.or) return node.or.some((n) => this.#matchNode(e, db, n));
    throw new WeaveError('Invalid where node', 'invalid');
  }

  /* A number compares as its number, whatever costume it wears: a currency
     column painted "$12,000.00" matched no `> 5000` (Issue #617). Only
     `contains` and the emptiness tests read the painted text. */
  #matchCondition(e, db, [path, op, value]) {
    const v = this.#pathValue(e, db, path, { numbers: !TEXT_OPS.has(op) });
    const list = Array.isArray(v) ? v : [v];
    switch (op) {
      case '=': return list.some((x) => this.#looseEq(x, value));
      case '!=': return !list.some((x) => this.#looseEq(x, value));
      case '<': return list.some((x) => x != null && x < value);
      case '<=': return list.some((x) => x != null && x <= value);
      case '>': return list.some((x) => x != null && x > value);
      case '>=': return list.some((x) => x != null && x >= value);
      case 'contains':
        return list.some((x) => String(x ?? '').toLowerCase().includes(String(value).toLowerCase()));
      case 'in':
        return list.some((x) => (Array.isArray(value) ? value : [value]).some((y) => this.#looseEq(x, y)));
      case 'is-empty':
        return v == null || v === '' || (Array.isArray(v) && v.length === 0);
      case 'not-empty':
        return !(v == null || v === '' || (Array.isArray(v) && v.length === 0));
      default:
        throw new WeaveError(`Unknown operator '${op}'`, 'invalid');
    }
  }

  /* Where a select's option or a workflow's state sits in its definition
     (Issue #318, Kyle: "for status it should be in the order of the status
     field definition in config or reverse, same with single select"). A
     value the definition no longer lists goes after every one it does. */
  #definitionRank(f, resolved) {
    if (resolved == null || isCycle(resolved)) return null;
    const list = f.type === 'workflow' ? f.config.states : f.config.options;
    const at = f.type === 'workflow'
      ? list.findIndex((s) => s.id === resolved)
      : list.indexOf(this.#findOption(list, resolved));
    return at < 0 ? list.length : at;
  }

  #looseEq(a, b) {
    return a === b || String(a) === String(b);
  }

  /* Path: 'Field' or 'Relation.Field' (any hops). Returns display values —
     `undressed` takes the costume off the three types whose painted form does
     not order the way the value does (Issue #279): a number stays a number, a
     date stays its stored instant, and a daterange becomes its start then its
     end (DG.rangeKey, Issue #287). A select and a workflow become the place
     their option or state holds in the definition (Issue #318), so a status
     column reads in its own order rather than alphabetically. Everything else
     keeps its display form, because for a multiselect or a joined relation
     the names ARE the value. Same rule a formula reads by (#resolve, the
     'formula' case), less the definition order. */
  #pathValue(e, db, path, { undressed = false, numbers = false } = {}) {
    const parts = String(path).split('.');
    let current = [{ e, db }];
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const next = [];
      const results = [];
      for (const { e: ce, db: cdb } of current) {
        // `id` alongside publicId: asking for a known set of rows by identity
        // is what an embedded related grid does, and a name can collide.
        if (parts[i] === 'id') { results.push(ce.id); continue; }
        if (parts[i] === 'publicId' || parts[i] === 'Public Id') { results.push(ce.publicId); continue; }
        if (parts[i] === 'createdAt') { results.push(ce.createdAt); continue; }
        if (parts[i] === 'updatedAt') { results.push(ce.updatedAt); continue; }
        const f = this.findField(cdb, parts[i]);
        // A system column by its grid name (Issue #254), asked after the
        // table's own fields so a field of the same name wins.
        if (!f && Object.hasOwn(SYSTEM_SORT_KEYS, parts[i])) { results.push(ce[SYSTEM_SORT_KEYS[parts[i]]] ?? null); continue; }
        if (!f) throw new WeaveError(`Field '${parts[i]}' not found in table '${cdb.name}'`, 'not-found');
        let resolved = this.#resolve(ce, cdb, f, 0);
        // A sparkline sorts and filters on its last value (Feature #232).
        if (isLast && f.type === 'formula' && f.config.display === 'sparkline' && Array.isArray(resolved)) resolved = lastNumber(resolved);
        if (isLast) {
          results.push((undressed || numbers) && typeof resolved === 'number' ? resolved
            : undressed && f.type === 'date' ? resolved
            : undressed && f.type === 'daterange' ? DG.rangeKey(resolved)
            : undressed && (f.type === 'select' || f.type === 'workflow') ? this.#definitionRank(f, resolved)
            // The row rides along: an attachments name lives in its file
            // ledger, and without it every file read as gone (Issue #622).
            : this.#displayValue(cdb, f, resolved, ce));
        } else {
          if (f.type !== 'relation') throw new WeaveError(`'${parts[i]}' is not a relation; cannot traverse`, 'invalid');
          // Each target knows its own table — a target-set relation's members
          // live in different ones, so the hop resolves per row, not per field.
          for (const rid of resolved) {
            const t = this.#liveEntity(rid);
            if (t) next.push({ e: t, db: this.state.tables[t.dbId] });
          }
        }
      }
      if (isLast) {
        const flat = results.flatMap((r) => (Array.isArray(r) ? r : [r]));
        return parts.length === 1 && !Array.isArray(results[0]) && results.length === 1 ? results[0]
          : flat.length === 1 ? flat[0] : flat;
      }
      current = next;
      if (!current.length) return null;
    }
    return null;
  }

  // ---------------- documents ----------------

  // field is optional everywhere: default = the table's first document field.
  getDoc(entityId, fieldRef = null) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const f = this.#resolveDocField(db, fieldRef);
    return e.docs?.[f.id] ?? '';
  }

  /* A document write carries its text or nothing happens (Issue #572). An
     empty string is a legitimate write — clearing a document is an ordinary
     edit — so only an absent value is refused, and it is refused loudly:
     every caller above coerced `undefined` to '' and erased the document
     while answering success. */
  #docText(markdown, verb) {
    if (markdown == null) throw new WeaveError(`A document ${verb} needs its text: pass the markdown, '' to clear the document. Nothing was passed.`, 'invalid');
    return String(markdown);
  }

  setDoc(entityId, markdown, fieldRef = null) {
    const e = this.getEntity(entityId);
    const after = this.#docText(markdown, 'write');
    const db = this.state.tables[e.dbId];
    const f = this.#resolveDocField(db, fieldRef);
    e.docs = e.docs ?? {};
    const before = e.docs[f.id] ?? '';
    // Autosave writes on every pause, so identical text arrives often. Nothing
    // changed, nothing happened: no timestamp bump and no entry in the feed.
    if (before === after) return e;
    const prior = { at: e.updatedAt, by: e.modifiedBy };
    e.docs[f.id] = after;
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    this.#logActivity(e, 'doc-updated', docChange(f.name, before, after));
    this.#recordUndo('update', e, { before: { values: {}, docs: { [f.id]: before } } });
    this.#recordDocRevision(e, f, before, after, { prior });
    this.save();
    return e;
  }

  appendDoc(entityId, markdown, fieldRef = null) {
    const e = this.getEntity(entityId);
    const addition = this.#docText(markdown, 'append');
    const db = this.state.tables[e.dbId];
    const f = this.#resolveDocField(db, fieldRef);
    e.docs = e.docs ?? {};
    const before = e.docs[f.id] ?? '';
    const after = (before ? before.replace(/\n*$/, '\n\n') : '') + addition;
    if (before === after) return e;
    const prior = { at: e.updatedAt, by: e.modifiedBy };
    e.docs[f.id] = after;
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    this.#logActivity(e, 'doc-appended', docChange(f.name, before, after));
    this.#recordUndo('update', e, { before: { values: {}, docs: { [f.id]: before } } });
    this.#recordDocRevision(e, f, before, after, { prior });
    this.save();
    return e;
  }

  /* ---------------- document history (Feature #225) ----------------
     Every write above lands a snapshot of the NEW text in doc_revisions,
     beside the entity blob. Rules: identical text records nothing (the
     writes already return early); the same actor writing the same field
     inside revisionWindowMs replaces the newest snapshot instead of adding
     one, so a typing session is one revision and not a keystroke log; a
     restore and an undo are always fresh, so restoring can never overwrite
     the session it steps back from; a document that predates the log gets
     its prior text as the first snapshot on its first write, so the text
     before the feature is not the one text history cannot show. System
     tables (the registry) keep no history, as they keep no undo. */
  #docRevisionFresh = false;

  #recordDocRevision(e, f, before, after, { prior = null, fresh = false } = {}) {
    if (this.#inMetaSync) return;
    const db = this.state.tables[e.dbId];
    if (!db || db.system) return;
    const now = nowISO();
    const [latest] = this.store.listDocRevisions(e.id, f.id, { limit: 1 });
    if (!latest && before) {
      this.store.pushDocRevision({ entityId: e.id, fieldId: f.id, at: prior?.at ?? now, actor: prior?.by ?? null, text: before });
    } else if (latest && !fresh && !this.#docRevisionFresh && latest.actor === this.actor
      && Date.now() - Date.parse(latest.at) < this.revisionWindowMs) {
      this.store.replaceDocRevision(latest.seq, { at: now, text: after });
      return;
    }
    this.store.pushDocRevision({ entityId: e.id, fieldId: f.id, at: now, actor: this.actor, text: after });
  }

  // Metadata only, newest first: { seq, at, actor, len }. The text is one
  // getDocRevision away, so a long history lists without moving its bytes.
  listDocRevisions(entityId, fieldRef = null, { limit = 50 } = {}) {
    const e = this.getEntity(entityId);
    const f = this.#resolveDocField(this.state.tables[e.dbId], fieldRef);
    const revisions = this.store.listDocRevisions(e.id, f.id, { limit: Math.max(1, Math.min(1000, Number(limit) || 50)) });
    return { field: f.name, revisions };
  }

  getDocRevision(entityId, fieldRef, seq) {
    const e = this.getEntity(entityId);
    const f = this.#resolveDocField(this.state.tables[e.dbId], fieldRef);
    const rev = this.store.getDocRevision(e.id, f.id, Number(seq));
    if (!rev) throw new WeaveError(`Revision ${seq} of ${f.name} not found on this entity`, 'not-found');
    return rev;
  }

  // A restore is a setDoc of the old text: activity, undo and automations
  // all see an ordinary write. Recorded fresh — never folded into the
  // session it replaces — so the log keeps both what was and what is.
  restoreDocRevision(entityId, fieldRef, seq) {
    const rev = this.getDocRevision(entityId, fieldRef, seq);
    this.#docRevisionFresh = true;
    try { this.setDoc(entityId, rev.text, fieldRef); } finally { this.#docRevisionFresh = false; }
    const e = this.getEntity(entityId);
    const f = this.#resolveDocField(this.state.tables[e.dbId], fieldRef);
    return { ok: true, field: f.name, seq: rev.seq, at: rev.at, length: rev.text.length };
  }

  // ---------------- comments & activity ----------------

  addComment(entityId, { author = 'anonymous', text }) {
    if (!text) throw new WeaveError('Comment text is required', 'invalid');
    const e = this.getEntity(entityId);
    const comment = { id: uuid(), author, text, createdAt: nowISO() };
    e.comments.push(comment);
    this.#logActivity(e, 'comment-added', { author });
    this.#recordUndo('comment-add', e, { commentId: comment.id });
    this.save();
    return comment;
  }

  deleteComment(entityId, commentId) {
    const e = this.getEntity(entityId);
    const removed = e.comments.find((c) => c.id === commentId);
    e.comments = e.comments.filter((c) => c.id !== commentId);
    if (removed) this.#recordUndo('comment-delete', e, { comment: removed });
    this.#mark(e);
    this.save();
    return { id: commentId, deleted: Boolean(removed) };
  }

  /* ---------------- the workspace Activity table ----------------
     Activity is a SYSTEM table: a fixed shape nobody can redefine, no rows
     anyone writes by hand. It is a read over the history every entity already
     carries, so the workspace feed and an entity's own list can never drift
     apart — they are the same rows, filtered differently. The id is
     `<entityId>:<index>`, which makes a single event addressable as a link. */
  activityFeed({ entityId = null, tableRef = null, kinds = null, since = null, limit = null, offset = 0 } = {}) {
    const wanted = kinds?.length ? new Set(kinds) : null;
    const dbId = tableRef ? this.getTable(tableRef).id : null;
    // A table id narrows to the table's own entries, its field configuration
    // history (Issue #428); the rows in it have addresses of their own.
    const tableOnly = entityId && own(this.state.tables, entityId) ? entityId : null;
    // 'Table#12' works here the way it works everywhere an id does.
    if (entityId && !tableOnly) entityId = this.getEntity(entityId).id;
    const rows = [];
    let dropped = 0;
    if (!entityId || tableOnly) {
      for (const r of this.#fieldConfigRows()) {
        if ((tableOnly ?? dbId) && r.dbId !== (tableOnly ?? dbId)) continue;
        if (wanted && !wanted.has(r.kind)) continue;
        if (since && r.ts < since) continue;
        rows.push(r);
      }
    }
    for (const e of Object.values(this.state.entities)) {
      if (tableOnly) break;
      if (entityId && e.id !== entityId) continue;
      if (dbId && e.dbId !== dbId) continue;
      dropped += e.activityDropped ?? 0;
      const db = this.state.tables[e.dbId];
      (e.activity ?? []).forEach((a, i) => {
        if (wanted && !wanted.has(a.kind)) return;
        if (since && a.ts < since) return;
        rows.push({
          id: `${e.id}:${i}`,
          seq: a.seq,
          ts: a.ts,
          kind: a.kind,
          actor: a.actor ?? null,
          detail: a.detail ?? {},
          entityId: e.id,
          entityName: this.entityName(e),
          publicId: e.publicId,
          dbId: e.dbId,
          db: db ? this.qualifiedName(db) : null,
          space: db ? (this.state.spaces[db.spaceId]?.name ?? null) : null,
          deleted: !!e.deletedAt,
        });
      });
    }
    /* Newest first is the last commit, which only seq knows (Issue #282). The
       ts sort this replaced tie-broke on the row id, and got it wrong twice:
       across entities it ranked same-millisecond events by entity uuid, and
       within one entity it compared the index as a string, so ':9' read as
       newer than ':10'.
       An entry a pre-seq writer appended through the shared .db has no number
       until the next open, and that window is a running server's whole life.
       Treating it as the highest number is right — it is the newest write —
       and keeps the comparator total, which a bare subtraction over undefined
       would not be. */
    rows.sort((x, y) => {
      const xs = x.seq ?? Infinity, ys = y.seq ?? Infinity;
      if (xs !== ys) return ys - xs;
      return x.ts < y.ts ? 1 : (x.ts > y.ts ? -1 : 0);
    });
    return {
      total: rows.length,
      // Entries in this scope older than the per-entity cap, no longer kept.
      dropped,
      items: limit == null ? rows.slice(offset) : rows.slice(offset, offset + limit),
    };
  }

  getActivity(id) {
    const at = String(id).lastIndexOf(':');
    const entityId = String(id).slice(0, at);
    if (String(id).slice(at + 1).startsWith('f')) {
      // A field configuration entry carries whether it can be rolled back now.
      const rows = this.#fieldConfigRows();
      const row = this.#fieldConfigRow(id, rows);
      const { code, ...rollback } = this.#rollbackCheck(row, rows);
      return { ...row, rollback };
    }
    const index = Number(String(id).slice(at + 1));
    const e = own(this.state.entities, entityId);
    const a = e?.activity?.[index];
    if (!a) throw new WeaveError(`Activity '${id}' not found`, 'not-found');
    return this.activityFeed({ entityId }).items.find((r) => r.id === `${entityId}:${index}`);
  }

  /* Commit order, which the wall clock cannot give: two writes can share a
     millisecond — an entity created with a document writes two — and a clock
     can step backwards (Issue #282). One counter per workspace, minted where
     an entry is stamped, so seq is the order and ts is only ever displayed. */
  #nextSeq() {
    this.state.meta.activitySeq = (this.state.meta.activitySeq ?? 0) + 1;
    return this.state.meta.activitySeq;
  }

  // `ts` overrides the clock for the lifecycle entries, which stamp the same
  // instant they wrote onto the entity (deletedAt, updatedAt).
  #logActivity(e, kind, detail, { ts = null } = {}) {
    // One editing session is one entry: autosave flushes every pause, and a
    // row per pause is a keystroke log (Issue #32). A doc-updated landing
    // right after another doc-updated for the same field folds into it,
    // keeping the session's starting length so delta spans the whole session.
    // Mutating in place (not pop+push) preserves entityId:index activity ids,
    // and one event keeps one seq: the fold does not re-stamp it.
    const last = e.activity[e.activity.length - 1];
    if (kind === 'doc-updated' && last?.kind === 'doc-updated'
      && last.detail?.field === detail.field
      && Date.now() - Date.parse(last.ts) < 10 * 60 * 1000) {
      last.ts = nowISO();
      last.detail = { ...detail, prevLength: last.detail.prevLength, delta: detail.length - last.detail.prevLength };
      this.#mark(e);
      return;
    }
    e.activity.push({ ts: ts ?? nowISO(), kind, detail, actor: this.actor, seq: this.#nextSeq() });
    if (e.activity.length > ACTIVITY_CAP) {
      // ponytail: counted, not kept. Keeping every entry (the cap as a
      // read-time page size) changes stored size and is Kyle's call.
      e.activityDropped = (e.activityDropped ?? 0) + e.activity.length - ACTIVITY_CAP;
      e.activity = e.activity.slice(-ACTIVITY_CAP);
    }
    this.#mark(e);
  }

  // ---------------- automations ----------------
  /* Every automation is a row of Workspace/Workflows, and that table is the
     control panel (Feature #249, Kyle 2026-10-02). The row's Script document
     holds the rule as JSON — {table, trigger, actions}, with names, the shape
     createAutomation takes — and the row carries three columns with one
     owner each (Kyle, 2026-10-03):
     - On is the user's switch. The engine reads it before every fire and
       never writes it; a row that is Setup incomplete and Off refuses it.
     - State is setup: Ready while the rule names a table, trigger and
       actions that exist and values that fit, Setup incomplete otherwise.
       Judged on every write to the row and on every structural change.
     - Health is runtime: Healthy, Failed (with Health Reason) or No runs,
       stamped with Last Run on every fire. A rule whose setup breaks while
       On keeps On, is skipped, and reads Failed with the reason.
     The rows live where the registry does (#reg), so a hub member's rules
     sit at the root beside the rest of its structure. */

  #stamping = false;
  #wfQueue = new Set();
  #wfEpoch = 0;
  #wfRows = null;
  #wfRules = null;
  #noWebhooks = false;

  createAutomation(dbRef, { name, trigger, actions, enabled = true }) {
    const db = this.getTable(dbRef);
    const compiled = this.#compileSpec({ table: db.id, trigger, actions });
    const reg = this.#reg;
    const t = this.#sysTable('workflows');
    if (!t) throw new WeaveError('This workspace has no Workflows table to hold the rule: open it from its hub', 'invalid');
    const wsRow = this.#sysRow('workspaces', this.state.meta.id);
    const values = { Name: name ?? 'Automation', On: enabled !== false, ...(wsRow ? { Workspace: wsRow.id } : {}) };
    const row = this.#asReg(() => reg.createEntity(t.id, { values, docs: { Script: workflowScript(this.#renderSpec(compiled)) } }));
    if (!db.system) this.#audit('automation-created', { table: db.name, name: values.Name, trigger: compiled.trigger.type });
    return this.#ruleOut(reg.#allRules().find((r) => r.row === row));
  }

  // A row write the member asked for runs at the root under the member's actor.
  #asReg(fn) {
    const reg = this.#reg;
    if (reg === this) return fn();
    const was = reg.actor;
    reg.actor = this.actor;
    try { return fn(); } finally { reg.actor = was; }
  }

  /* A rule in its stored, id-keyed shape, checked against this engine's
     schema; throws the first thing missing, in the words the old
     createAutomation used. `spec` names its table, fields and states by name
     or id. */
  #compileSpec(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new WeaveError('The Script is not a rule: write {"table", "trigger", "actions"} as JSON', 'invalid');
    if (spec.table == null || spec.table === '') throw new WeaveError('The Script names no table', 'invalid');
    const db = this.getTable(spec.table);
    const { trigger, actions } = spec;
    if (!trigger?.type || !['entity-created', 'field-updated', 'state-changed'].includes(trigger.type)) {
      throw new WeaveError(`Invalid automation trigger`, 'invalid');
    }
    const t = { type: trigger.type };
    if (trigger.type !== 'entity-created') {
      const f = this.getField(db.id, trigger.field);
      t.fieldId = f.id;
      if (trigger.type === 'state-changed' && trigger.toState) {
        const st = f.config.states?.find((s) => s.id === trigger.toState || s.name === trigger.toState);
        if (!st) throw new WeaveError(`Unknown state '${trigger.toState}'`, 'invalid');
        t.toStateId = st.id;
      }
    }
    if (!Array.isArray(actions ?? [])) throw new WeaveError('The Script\'s actions are a list', 'invalid');
    const acts = (actions ?? []).map((a) => {
      if (a?.type === 'set-field') {
        const f = this.getField(db.id, a.field);
        this.#checkFits(f, a.value);
        return { type: 'set-field', fieldId: f.id, value: a.value };
      }
      if (a?.type === 'append-doc') {
        const act = { type: 'append-doc', text: String(a.text ?? '') };
        if (a.field) act.fieldId = this.#resolveDocField(db, a.field).id;
        else if (!this.documentFields(db).length) throw new WeaveError(`Table '${db.name}' has no document to append to`, 'invalid');
        return act;
      }
      if (a?.type === 'add-comment') return { type: 'add-comment', text: String(a.text ?? ''), author: a.author ?? 'automation' };
      if (a?.type === 'webhook') {
        if (!/^https?:\/\//.test(a.url ?? '')) throw new WeaveError('Webhook action needs an http(s) url', 'invalid');
        return { type: 'webhook', url: a.url };
      }
      throw new WeaveError(`Unknown automation action '${a?.type}'`, 'invalid');
    });
    if (!acts.length) throw new WeaveError('Automation needs at least one action', 'invalid');
    return { dbId: db.id, trigger: t, actions: acts };
  }

  // "The value fits": the checks the write itself would make, made early.
  #checkFits(f, value) {
    if (COMPUTED_TYPES.includes(f.type)) throw new WeaveError(`Field '${f.name}' is computed (${f.type}) and cannot be written`, 'invalid');
    if (f.type === 'relation') { this.#normalizeRelationInput(f, value); return; }
    if (f.type === 'workflow') {
      if (value == null || value === '') return;
      const hit = f.config.states.some((s) => s.id === value || s.name === value || s.name.toLowerCase() === String(value).toLowerCase());
      if (!hit) throw new WeaveError(`'${value}' is not a state of '${f.name}'`, 'invalid');
      return;
    }
    if (f.type !== 'document') this.#validateValue(f, value);
  }

  /* The stored shape back into names: what the Script says. Null when the
     table it points at is gone. */
  #renderSpec(c) {
    const db = own(this.state.tables, c.dbId);
    if (!db || db.deletedAt) return null;
    const fname = (fid) => {
      if (!own(db.fields, fid)) throw new WeaveError(`Field '${fid}' not found`, 'not-found');
      return db.fields[fid].name;
    };
    try {
      const trigger = { type: c.trigger.type };
      if (c.trigger.fieldId) trigger.field = fname(c.trigger.fieldId);
      if (c.trigger.toStateId) {
        const st = db.fields[c.trigger.fieldId].config.states?.find((s) => s.id === c.trigger.toStateId);
        if (!st) return null;
        trigger.toState = st.name;
      }
      const actions = c.actions.map((a) => {
        if (a.type === 'set-field') return { type: a.type, field: fname(a.fieldId), value: a.value };
        if (a.type === 'append-doc') return { type: a.type, ...(a.fieldId ? { field: fname(a.fieldId) } : {}), text: a.text };
        if (a.type === 'add-comment') return { type: a.type, text: a.text, ...(a.author && a.author !== 'automation' ? { author: a.author } : {}) };
        return { type: a.type, url: a.url };
      });
      return { table: this.qualifiedName(db), trigger, actions };
    } catch { return null; }
  }

  /* The Workflows rows, in fire order: by row number, the order they were
     made in, which is the order the old seq kept (Issue #285). Re-read when
     someone writes a row or the state is reloaded. */
  #workflowRows() {
    const t = this.#sysTable('workflows');
    if (!t) return [];
    if (this.#wfRows?.state !== this.state || this.#wfRows.epoch !== this.#wfEpoch || this.#wfRows.table !== t) {
      const rows = Object.values(this.state.entities).filter((e) => e.dbId === t.id).sort((a, b) => a.publicId - b.publicId);
      this.#wfRows = { state: this.state, epoch: this.#wfEpoch, table: t, rows };
    }
    return this.#wfRows.rows.filter((e) => this.state.entities[e.id] === e && !e.deletedAt);
  }

  /* The engine a row's rule belongs to: the workspace its Workspace
     relation names, or the registry itself when it names none (a row made
     by hand at the root). Undefined when it names a member the hub has not
     attached yet: that row waits, rather than reading as broken. */
  #workflowHome(row) {
    const wsId = this.#wsIdOfRow(row);
    if (!wsId) return this;
    return this.#engines().find((w) => w.state.meta.id === wsId);
  }

  #wfField(name) { return this.#sysField(this.#sysTable('workflows'), name); }

  /* One row's rule: { row, owner, dbId, trigger, actions, problem }. Read
     on the registry engine. */
  #workflowRule(row, text = row.docs?.[this.#wfField('Script').id] ?? '') {
    const owner = this.#workflowHome(row);
    if (!owner) return null;
    try {
      const src = String(text).trim();
      if (!src) throw new WeaveError('The Script is empty: write the rule as JSON {"table", "trigger", "actions"}', 'invalid');
      let spec;
      try { spec = JSON.parse(src); } catch (err) { throw new WeaveError(`The Script is not JSON: ${err.message}`, 'invalid'); }
      // A table another attached workspace holds is found there too.
      let w = owner;
      if (spec?.table != null && !owner.findTable(spec.table)) w = this.#engines().find((x) => x.findTable(spec.table)) ?? owner;
      return { row, owner: w, ...w.#compileSpec(spec), problem: null };
    } catch (err) {
      return { row, owner, dbId: null, trigger: null, actions: [], problem: err.message };
    }
  }

  /* Every rule the registry holds, judged against the schema as it stands.
     Cached on the rows and on every attached workspace's schema version; a
     schema change re-judges every row and stamps what moved. */
  #allRules() {
    const rows = this.#workflowRows();
    if (!rows.length) return [];
    const engines = this.#engines();
    const key = [this.state, this.#wfEpoch, ...engines.flatMap((w) => [w, w.schemaVersion()])];
    const c = this.#wfRules;
    if (c && c.key.length === key.length && c.key.every((k, i) => k === key[i])) return c.rules;
    const schemaMoved = !c || c.key.length !== key.length || c.key.some((k, i) => i !== 1 && k !== key[i]);
    const rules = rows.map((row) => (schemaMoved ? this.#settleWorkflow(row) : this.#workflowRule(row))).filter(Boolean);
    // Settling may stamp; the key is taken after it, so a stamp is not news.
    this.#wfRules = { key: [this.state, this.#wfEpoch, ...engines.flatMap((w) => [w, w.schemaVersion()])], rules };
    if (this.#stampDirty) { this.#stampDirty = false; this.save(); }
    return rules;
  }

  // Re-judge every row now (a load, a join, a structural change).
  #settleWorkflows() {
    if (!this.#sysTable('workflows')) return;
    this.#wfRules = null;
    this.#allRules();
  }
  #stampDirty = false;

  // The engine's own writes to a Workflows row: no activity, no re-judging.
  #stamp(row, fn) {
    const was = this.#stamping;
    this.#stamping = true;
    try {
      if (fn() !== false) { this.#mark(row); this.#stampDirty = true; }
    } finally { this.#stamping = was; }
  }

  #setOption(row, field, name) {
    const id = name == null ? null : (field.type === 'workflow' ? field.config.states : field.config.options).find((o) => o.name === name)?.id ?? null;
    if ((row.values[field.id] ?? null) === id) return false;
    row.values[field.id] = id;
    return true;
  }

  /* Judge one row (on the registry engine) and stamp what follows from it:
     State, the Tables and Spaces it touches, and Health when its setup broke
     or mended. Returns the rule. */
  #settleWorkflow(row) {
    const F = (n) => this.#wfField(n);
    const script = F('Script');
    let rule = this.#workflowRule(row);
    if (!rule) return null;
    const text = row.docs?.[script.id] ?? '';
    /* A rule that stopped resolving although nobody touched its Script was
       broken by a rename: the ids it last resolved to still name the table,
       fields and states, so the Script is rewritten in the new names.
       ponytail: the rewrite keeps no revision or activity entry. */
    if (rule.problem && row.rule?.text === text) {
      const hit = this.#tableAnywhere(row.rule.dbId);
      const spec = hit && hit.owner.#renderSpec(row.rule);
      const next = spec && workflowScript(spec);
      if (next && next !== text) {
        this.#stamp(row, () => { row.docs[script.id] = next; });
        rule = this.#workflowRule(row);
      }
    }
    const on = row.values[F('On').id] === true;
    const lastRun = row.values[F('Last Run').id] ?? null;
    const health = F('Health');
    const healthName = health.config.options.find((o) => o.id === row.values[health.id])?.name ?? null;
    const reasonF = F('Health Reason');
    const reason = row.values[reasonF.id] ?? '';
    const SETUP = 'Setup incomplete: ';
    this.#stamp(row, () => {
      let moved = this.#setOption(row, F('State'), rule.problem ? 'Setup incomplete' : 'Ready');
      const setReason = (r) => { if ((row.values[reasonF.id] ?? '') === r) return; row.values[reasonF.id] = r || null; moved = true; };
      if (rule.problem && on) {
        moved = this.#setOption(row, health, 'Failed') || moved;
        setReason(SETUP + rule.problem);
      } else if (!rule.problem && healthName === 'Failed' && String(reason).startsWith(SETUP)) {
        // Mended: back to what it was before the break.
        moved = this.#setOption(row, health, lastRun ? 'Healthy' : 'No runs') || moved;
        setReason('');
      } else if (!healthName) {
        moved = this.#setOption(row, health, 'No runs') || moved;
      }
      if (!rule.problem) {
        const next = { text, dbId: rule.dbId, trigger: rule.trigger, actions: rule.actions };
        if (JSON.stringify(row.rule) !== JSON.stringify(next)) { row.rule = next; moved = true; }
      }
      return moved;
    });
    // Tables and Spaces follow the rule's table; a row with no rule keeps
    // whatever was written there by hand.
    if (!rule.problem) {
      const db = rule.owner.state.tables[rule.dbId];
      const wfT = this.#sysTable('workflows');
      for (const [name, kind, id] of [['Tables', 'tables', db.id], ['Spaces', 'spaces', db.spaceId]]) {
        const target = this.#sysRow(kind, id);
        if (!target) continue;
        const f = F(name);
        const cur = this.#relationIds(row, f);
        if (cur.length === 1 && cur[0] === target.id) continue;
        this.#stamp(row, () => { this.#setRelationValue(row, wfT, f, [target.id]); });
      }
    }
    return rule;
  }

  /* What a fire leaves on its row (on the registry engine). Warning is the
     socket for a run that finished with something to look at.
     ponytail: nothing raises Warning yet; a webhook is fire-and-forget. */
  #stampRun(row, failure) {
    const health = this.#wfField('Health');
    const reasonF = this.#wfField('Health Reason');
    this.#stamp(row, () => {
      row.values[this.#wfField('Last Run').id] = nowISO();
      this.#setOption(row, health, failure ? 'Failed' : 'Healthy');
      row.values[reasonF.id] = failure ?? null;
    });
  }

  /* Refuse switching On a row whose setup is incomplete (Kyle, 2026-10-03).
     A row already On stays On whatever happens to its setup, and writing On
     to it again is no switch at all. */
  #guardWorkflowOn(e, db, values, docs = {}) {
    if (this.#stamping || this.#migrating) return;
    const onF = this.#sysField(db, 'On');
    const scriptF = this.#sysField(db, 'Script');
    if (!onF || !scriptF) return;
    const keyOf = (f) => Object.keys(values ?? {}).find((k) => this.findField(db, k)?.id === f.id);
    const onKey = keyOf(onF);
    if (onKey === undefined || this.#validateValue(onF, values[onKey]) !== true) return;
    if (e?.values[onF.id] === true) return;
    const scriptKey = keyOf(scriptF);
    const text = scriptKey !== undefined ? values[scriptKey] : docs?.Script ?? e?.docs?.[scriptF.id] ?? '';
    const reg = this.#reg;
    const probe = e ?? { dbId: db.id, values: {}, docs: {} };
    const rule = reg.#workflowRule(probe, text ?? '');
    if (rule?.problem) {
      const name = values.Name ?? (e ? this.entityName(e) : '') ?? '';
      throw new WeaveError(`Workflow '${name}' cannot be switched On until its setup is complete. ${rule.problem}`, 'invalid');
    }
  }

  // The verbs' answer: the stored, id-keyed shape the rule always had.
  #ruleOut(r) {
    const out = {
      id: r.row.id,
      seq: r.row.publicId,
      dbId: r.dbId,
      name: this.#reg.entityName(r.row),
      trigger: r.trigger,
      actions: r.actions,
      enabled: r.row.values[this.#wfField('On').id] === true,
      state: r.problem ? 'Setup incomplete' : 'Ready',
    };
    if (r.problem) out.problem = r.problem;
    return out;
  }

  // This workspace's rules: the rows whose rule belongs here.
  #myRules() { return this.#reg.#allRules().filter((r) => r.owner === this); }

  listAutomations(dbRef = null) {
    const mine = this.#myRules();
    const db = dbRef ? this.getTable(dbRef) : null;
    return mine.filter((r) => !db || r.dbId === db.id).map((r) => this.#ruleOut(r));
  }

  // Human/agent-readable automation descriptions (field ids → names).
  // Powers the relation map's automation layer.
  describeAutomations(dbRef = null) {
    return this.listAutomations(dbRef).map((auto) => {
      const db = auto.dbId ? this.state.tables[auto.dbId] : null;
      const fieldName = (fid) => db?.fields[fid]?.name ?? null;
      const trigger = auto.trigger ? { type: auto.trigger.type } : null;
      if (auto.trigger?.fieldId) trigger.field = fieldName(auto.trigger.fieldId);
      if (auto.trigger?.toStateId && auto.trigger.fieldId) {
        trigger.toState = db.fields[auto.trigger.fieldId]?.config.states
          ?.find((s) => s.id === auto.trigger.toStateId)?.name ?? null;
      }
      return {
        id: auto.id,
        seq: auto.seq,
        name: auto.name,
        table: db ? this.qualifiedName(db) : null,
        tableId: auto.dbId,
        enabled: auto.enabled,
        state: auto.state,
        ...(auto.problem ? { problem: auto.problem } : {}),
        trigger,
        actions: auto.actions.map((a) => {
          if (a.type === 'set-field') return { type: a.type, field: fieldName(a.fieldId) };
          // No field named means the description, whatever it is called now.
          if (a.type === 'append-doc') return { type: a.type, field: a.fieldId ? fieldName(a.fieldId) : (db ? this.descriptionField(db)?.name ?? null : null) };
          if (a.type === 'webhook') return { type: a.type, url: a.url };
          return { type: a.type };
        }),
      };
    });
  }

  // One of this workspace's Workflows rows, by id.
  #myRow(id) {
    const r = this.#myRules().find((x) => x.row.id === id);
    if (r) return r.row;
    // A trashed row is still this workspace's to answer about.
    const t = this.#sysTable('workflows');
    const row = t ? own(this.#reg.state.entities, id) : undefined;
    return row && row.dbId === t.id && row.deletedAt && this.#reg.#workflowHome(row) === this ? row : null;
  }

  updateAutomation(id, patch) {
    const row = this.#myRow(id);
    if (!row || row.deletedAt) throw new WeaveError(`Automation '${id}' not found`, 'not-found');
    const values = {};
    if (patch.enabled != null) values.On = !!patch.enabled;
    if (patch.name != null) values.Name = patch.name;
    if (Object.keys(values).length) this.#asReg(() => this.#reg.updateEntity(row.id, values));
    const changed = ['enabled', 'name'].filter((k) => patch[k] != null);
    const r = this.#myRules().find((x) => x.row === row);
    const db = r?.dbId ? this.state.tables[r.dbId] : null;
    if (changed.length && !db?.system) this.#audit('automation-updated', { table: db?.name ?? null, name: this.#reg.entityName(row), patch: changed });
    return this.#ruleOut(r);
  }

  /* The row goes to the trash like any row, and comes back with
     restoreEntity. */
  deleteAutomation(id) {
    const row = this.#myRow(id);
    if (!row || row.deletedAt) return { id, deleted: false };
    const r = this.#myRules().find((x) => x.row === row);
    const db = r?.dbId ? this.state.tables[r.dbId] : null;
    this.#asReg(() => this.#reg.deleteEntity(row.id));
    if (!db?.system) this.#audit('automation-deleted', { table: db?.name ?? null, name: this.#reg.entityName(row) });
    return { id, deleted: true };
  }

  /* Feature #249: the rules a workspace kept in state.automations become
     Workflows rows, in seq order (Issue #285), On = enabled, and the old
     store empties. A row with the same Name whose Tables relation names the
     same table is adopted instead (Net had two such rows made by hand beside
     its engine rules): it gains the Script and keeps its id, On,
     Description and Diagram. Idempotent: an empty state.automations is
     done. A member opened alone has no Workflows table and keeps its rules
     until it joins a hub. */
  #migrating = false;
  #migrateAutomations() {
    const autos = Object.values(this.state.automations ?? {});
    if (!autos.length) return;
    const t = this.#sysTable('workflows');
    if (!t || !this.#wfField('Script')) return;
    const reg = this.#reg;
    const key = (a) => a.seq ?? Infinity;
    autos.sort((x, y) => (key(x) === key(y) ? 0 : key(x) - key(y)));
    const wsRow = this.#sysRow('workspaces', this.state.meta.id);
    this.#migrating = true;
    reg.#migrating = true;
    try {
      for (const auto of autos) {
        const spec = this.#renderSpec(auto) ?? { table: auto.dbId, trigger: auto.trigger, actions: auto.actions };
        const Script = workflowScript(spec);
        const tableRow = this.#sysRow('tables', auto.dbId);
        const name = auto.name ?? 'Automation';
        const adopt = tableRow && reg.#workflowRows().find((e) => reg.entityName(e) === name && reg.#relIds(e, t, 'Tables').includes(tableRow.id));
        if (adopt) {
          reg.#metaSync(() => reg.updateEntity(adopt.id, { Script }));
        } else {
          reg.#metaSync(() => reg.createEntity(t.id, { values: { Name: name, On: auto.enabled !== false, ...(wsRow ? { Workspace: wsRow.id } : {}) }, docs: { Script } }));
        }
        delete this.state.automations[auto.id];
      }
    } finally {
      this.#migrating = false;
      reg.#migrating = false;
    }
    reg.save();
    if (reg !== this) this.save();
  }

  #runAutomations(db, e, event, depth) {
    if (depth >= 3) return;
    const reg = this.#reg;
    for (const rule of reg.#allRules()) {
      if (rule.owner !== this || rule.problem || rule.dbId !== db.id) continue;
      if (rule.row.deletedAt || rule.row.values[reg.#wfField('On').id] !== true) continue;
      const t = rule.trigger;
      if (t.type !== event.type) continue;
      if (t.fieldId && t.fieldId !== event.fieldId) continue;
      if (t.toStateId && t.toStateId !== event.toStateId) continue;
      const name = reg.entityName(rule.row);
      let failure = null;
      // Its writes are its own (Issue #674): activity and Modified By name
      // the Workflows row, and the person who fired it gets the actor back.
      const person = this.actor;
      this.actor = workflowActor(rule.row.id);
      try {
        for (const action of rule.actions) this.#runAction(rule, name, action, db, e, event, depth);
      } catch (err) {
        // A failing rule stays On (Kyle, 2026-10-03); the write that fired
        // it stands, and the row says why.
        failure = err.message;
      } finally {
        this.actor = person;
      }
      this.#logActivity(e, 'automation-ran', { name, workflow: rule.row.id });
      reg.#stampRun(rule.row, failure);
      // The write that fired the rule saves this engine; the stamp lives at
      // the root when this is a hub member.
      if (reg !== this) reg.save();
    }
  }

  #runAction(rule, name, action, db, e, event, depth) {
    if (action.type === 'set-field') {
      const f = db.fields[action.fieldId];
      if (f) {
        const before = this.#undoBefore(e, db, [f]);
        this.#applyValues(e, db, { [f.name]: action.value }, { depth: depth + 1 });
        if (this.#undoChanged(e, before)) this.#recordUndo('update', e, { before });
      }
    } else if (action.type === 'append-doc') {
      const docField = db.fields[action.fieldId] ?? this.documentFields(db)[0];
      if (docField) {
        e.docs = e.docs ?? {};
        const cur = e.docs[docField.id] ?? '';
        this.#recordUndo('update', e, { before: { values: {}, docs: { [docField.id]: cur } } });
        e.docs[docField.id] = (cur ? cur.replace(/\n*$/, '\n\n') : '') + this.#template(action.text, e, db);
        e.updatedAt = nowISO();
        e.modifiedBy = this.actor;
      }
    } else if (action.type === 'add-comment') {
      const comment = { id: uuid(), author: action.author, text: this.#template(action.text, e, db), createdAt: nowISO() };
      e.comments.push(comment);
      this.#recordUndo('comment-add', e, { commentId: comment.id });
    } else if (action.type === 'webhook') {
      if (this.#noWebhooks) return;
      // Fire and forget; a dead endpoint must never block a mutation.
      const payload = {
        event: event.type,
        workspace: this.state.meta.name,
        entity: this.#summary(e.id),
        automation: name,
        at: nowISO(),
      };
      fetch(action.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    }
  }

  #template(text, e, db) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, name) => {
      const key = name.trim();
      if (key === 'PublicId') return String(e.publicId);
      if (key === 'Today') return new Date().toISOString().slice(0, 10);
      const f = this.findField(db, key);
      if (!f) return '';
      const v = this.#displayValue(db, f, this.#resolve(e, db, f, 0), e);
      return v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
    });
  }

  // ---------------- search ----------------

  /* `table` scopes the search to one table (Feature #228): the table page's
     search box is this scorer with a scope, never a second matcher. */
  search(text, { limit = 25, table = null } = {}) {
    const scope = table == null ? null : this.getTable(table).id;
    return this.#searchHits(text, scope)
      .map(({ e, score, snippet }) => ({ ...this.#summary(e.id), score, snippet }))
      .sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /* The one matcher behind ⌘K and the table search: every live row that
     matches, unsorted, as { e, score, snippet }. */
  #searchHits(text, dbId = null) {
    const needle = String(text ?? '').toLowerCase().trim();
    if (!needle) return [];
    // '#143', '143', or 'task #143' — an exact publicId hit outranks any text
    // match, so numbered entities land on top of the ⌘K palette.
    const idm = /^(.*?)#\s*(\d+)$/.exec(needle) ?? /^()(\d+)$/.exec(needle);
    const idNum = idm ? Number(idm[2]) : null;
    const idTable = idm ? idm[1].trim() : '';
    const results = [];
    for (const e of dbId ? this.listEntities(dbId) : Object.values(this.state.entities)) {
      if (e.deletedAt) continue; // the trash is not searchable
      const home = this.state.tables[e.dbId];
      if (!home || home.deletedAt || this.state.spaces[home.spaceId]?.deletedAt) continue; // nor a trashed container
      const name = this.entityName(e);
      const docText = Object.values(e.docs ?? {}).join('\n');
      const comments = e.comments.map((c) => c.text).join('\n');
      // Plain text values (text, url, email) read like the documents do.
      const textValues = Object.values(home.fields)
        .filter((f) => SEARCHED_VALUE_TYPES.has(f.type) && f.id !== home.nameFieldId && typeof e.values?.[f.id] === 'string')
        .map((f) => e.values[f.id]).join('\n');
      let score = 0;
      let snippet = '';
      if (idNum !== null && e.publicId === idNum) {
        if (!idTable
          || home.name.toLowerCase().startsWith(idTable)
          || this.qualifiedName(home).toLowerCase().includes(idTable)) score += 20;
      }
      if (name.toLowerCase().includes(needle)) score += 10;
      const hay = textValues + '\n' + docText + '\n' + comments;
      const idx = hay.toLowerCase().indexOf(needle);
      if (idx >= 0) {
        score += 5;
        snippet = hay.slice(Math.max(0, idx - 40), idx + needle.length + 40).replace(/\n+/g, ' ').trim();
      }
      if (score > 0) results.push({ e, score, snippet });
    }
    return results;
  }

  /* Universal search across everything addressable, with stable permalinks.
     Kinds: workspace, space, table, view, entity. `limit` bounds the entity
     rows only: the containers that match are always returned, however many
     rows match too (Issue #280 — a sort-then-slice let rows scoring above
     the hierarchy crowd it out). */
  universalSearch(text, { limit = 25, prefix = '' } = {}) {
    const needle = String(text).toLowerCase().trim();
    if (!needle) return [];
    const results = [];
    if (this.state.meta.name.toLowerCase().includes(needle)) {
      results.push({ kind: 'workspace', id: 'workspace', name: this.state.meta.name, url: prefix + '/', score: 8 });
    }
    for (const sp of this.listSpaces()) {
      if (sp.name.toLowerCase().includes(needle)) {
        results.push({ kind: 'space', id: sp.id, name: sp.name, url: `${prefix}/#/space/${sp.id}`, score: 9 });
      }
    }
    for (const db of this.listTables()) {
      if (db.name.toLowerCase().includes(needle) || this.qualifiedName(db).toLowerCase().includes(needle)) {
        results.push({
          kind: 'table', id: db.id, name: this.qualifiedName(db),
          url: `${prefix}/#/table/${db.id}`, entityCount: this.listEntities(db.id).length, score: 9,
        });
      }
    }
    for (const v of this.listViews()) {
      if (v.name.toLowerCase().includes(needle)) {
        results.push({ kind: 'view', id: v.id, name: v.name, url: `${prefix}/#/view/${v.id}`, score: 8 });
      }
    }
    // A registry row IS the container hit above it: the Workspaces row is the
    // workspace (Feature #219), a Spaces, Tables or Views row the space, table
    // or view. Listing both showed ⌘K every table twice (Issue #382). They go
    // before the limit, so they never take a real row's place.
    const rows = this.#searchHits(text)
      .filter(({ e }) => !REGISTRY_HITS.has(this.state.tables[e.dbId]?.system))
      .sort((a, b) => b.score - a.score).slice(0, limit);
    for (const { e, score, snippet } of rows) {
      results.push({ kind: 'entity', url: `${prefix}/e/${e.id}`, ...this.#summary(e.id), score, snippet });
    }
    return Weave.capRows(results, limit);
  }

  /* At most `limit` entity rows; hierarchy hits are never cut. Order is
     three tiers, score order inside each: an exact id hit (score ≥ 20,
     Issue #113), then the containers, then text-matched rows — the
     containers section sits above rows the way quick-find tools list it.
     Shared by the scoped search and the cross-workspace merge. */
  static capRows(hits, limit) {
    const tier = (h) => (h.kind !== 'entity' ? 1 : h.score >= 20 ? 2 : 0);
    let rows = 0;
    return [...hits].sort((a, b) => tier(b) - tier(a) || b.score - a.score)
      .filter((h) => h.kind !== 'entity' || rows++ < limit);
  }

  /* The headline fields a reference chip previews. Zero configuration by
     design (Kyle, 2026-09-01): workflow state first, then non-empty simple
     values in schema order — arranging the table's field order IS the
     curation, so no per-table or per-user setting exists. */
  previewFields(entityRef, limit = 3) {
    const v = this.renderView(entityRef, 'chip', { limit });
    return [...(v.state ? [{ label: this.#stateLabel(v), value: v.state.name }] : []), ...v.fields].slice(0, limit);
  }

  #stateLabel(v) {
    const db = this.state.tables[this.getEntity(v.id).dbId];
    return Object.values(db.fields).find((f) => f.type === 'workflow')?.name ?? 'State';
  }

  /* Which entities' documents mention this one. A chip in a document is
     deliberately NOT a relation: nothing is configured, nothing is unlinked —
     the reference exists exactly as long as the text does, so the list is
     computed from the text on demand. Matches every accepted spelling:
     [[Table#pid]] (qualified or not, with |label), [[uuid]], and URL
     spellings — a markdown permalink, an HTML chip's href, a mermaid click
     target — which all reduce to /e/<uuid>.
     ponytail: O(total doc bytes) per call; move to a save-time index if a
     workspace grows past ~10k entities. */
  referencesTo(entityRef) {
    const target = this.getEntity(entityRef);
    const db = this.state.tables[target.dbId];
    const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const names = [...new Set([db.name, this.qualifiedName(db)])].map(esc).join('|');
    const bracket = new RegExp(`\\[\\[\\s*(?:${names})\\s*#${target.publicId}\\s*(?:\\|[^\\]]*)?\\]\\]`, 'i');
    const uuidRef = new RegExp(`\\[\\[\\s*${esc(target.id)}\\s*(?:\\|[^\\]]*)?\\]\\]`, 'i');
    const permalink = new RegExp(`/e/${esc(target.id)}(?=[/#?"')\\s]|$)`, 'i');
    const out = [];
    for (const e of Object.values(this.state.entities)) {
      if (e.deletedAt || e.id === target.id) continue;
      const docs = Object.values(e.docs ?? {}).filter(Boolean);
      if (docs.some((t) => bracket.test(t) || uuidRef.test(t) || permalink.test(t))) {
        out.push(this.#summary(e.id));
      }
    }
    return out.sort((a, b) => a.db.localeCompare(b.db) || a.publicId - b.publicId);
  }

  /* The outbound mirror: which entities THIS entity's documents mention.
     Same ruling as referencesTo — a chip is a reference, never a relation:
     the set is recomputed from the text on every read, so it is 1:1 with
     what the documents say and can never drift or be edited directly.
     Spellings are shared with referencesTo; dead pids and unknown uuids stay
     text, self-mentions and deleted targets never count. */
  referencesFrom(entityRef) {
    const e = this.getEntity(entityRef);
    const text = Object.values(e.docs ?? {}).filter(Boolean).join('\n');
    const ids = new Set();
    const add = (id) => {
      const t = own(this.state.entities, id);
      if (t && !t.deletedAt && t.id !== e.id) ids.add(t.id);
    };
    for (const m of text.matchAll(/\[\[\s*([^\][|#\n]+?)\s*#(\d+)\s*(?:\|[^\]]*)?\]\]/g)) {
      try { add(this.getEntity(`${m[1].trim()}#${m[2]}`).id); } catch { /* a dead ref stays text */ }
    }
    const uuidPat = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    for (const m of text.matchAll(new RegExp(`\\[\\[\\s*(${uuidPat.source})\\s*(?:\\|[^\\]]*)?\\]\\]`, 'gi'))) add(m[1].toLowerCase());
    for (const m of text.matchAll(new RegExp(`/e/(${uuidPat.source})(?=[/#?"')\\s]|$)`, 'gi'))) add(m[1].toLowerCase());
    return [...ids].map((id) => this.#summary(id))
      .sort((a, b) => a.db.localeCompare(b.db) || a.publicId - b.publicId);
  }

  /* What this workspace weighs: live entity count plus bytes on disk — the
     .db (with sidecars) from the store, attachment blobs from each entity's
     own file ledger (files/ is shared between workspaces, so the directory
     itself can never be the measure). Feeds /api/health and the nav strip. */
  storageStats() {
    let entities = 0;
    let fileBytes = 0;
    for (const e of Object.values(this.state.entities)) {
      if (!e.deletedAt) entities += 1;
      for (const f of e.files ?? []) fileBytes += f.size ?? 0;
    }
    return { entities, sizeBytes: (this.store.sizeBytes?.() ?? 0) + fileBytes };
  }

  // ---------------- files ----------------

  /* Where the bytes are. A file-backed workspace keeps them in a sibling
     files/ directory — outside state, and so outside every copy of state; an
     in-memory one has nowhere else to put them and holds base64 inline.
     Three verbs over that split, so no caller has to know which it is, and
     so a surface can ASK whether a file is still there (Issue #121). */
  #blobPath(id) {
    // A file id is an opaque token, never a path: it has the shape uuid()
    // mints, and the path it names stays inside files/ (Issue #479).
    if (!BLOB_ID.test(String(id))) throw new WeaveError(`Invalid file id '${id}'`, 'invalid');
    if (!this.store.path) return null;
    const p = join(dirname(this.store.path), 'files', id);
    if (dirname(p) !== join(dirname(this.store.path), 'files')) throw new WeaveError(`Invalid file id '${id}'`, 'invalid');
    return p;
  }

  #hasBlob(id) {
    const p = this.#blobPath(id);
    return p ? existsSync(p) : this.state.fileBlobs?.[id] != null;
  }

  #readBlob(id) {
    const p = this.#blobPath(id);
    if (p) return existsSync(p) ? readFileSync(p) : null;
    const b64 = this.state.fileBlobs?.[id];
    return b64 == null ? null : Buffer.from(b64, 'base64');
  }

  #writeBlob(id, buf) {
    const p = this.#blobPath(id);
    if (p) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, buf);
      return;
    }
    this.state.fileBlobs = this.state.fileBlobs ?? {};
    this.state.fileBlobs[id] = buf.toString('base64');
  }

  // Attach a file to an entity. bytes is a Buffer (or base64 string). Blobs are
  // stored on disk next to the workspace file, or inline when in-memory.
  attachFile(entityId, { name, mime = 'application/octet-stream', bytes }) {
    const e = this.getEntity(entityId);
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'base64');
    const file = { id: uuid(), name: String(name), size: buf.length, mime, createdAt: nowISO() };
    this.#writeBlob(file.id, buf);
    e.files.push(file);
    this.#logActivity(e, 'file-attached', { name: file.name });
    this.#recordUndo('file-attach', e, { fileId: file.id });
    this.save();
    return file;
  }

  /* Upload a file and put it in an attachments column in one motion —
     the flow every surface actually wants (Feature #16). */
  attachToField(entityId, fieldRef, fileInput) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const field = this.getField(db.id, fieldRef);
    if (field.type !== 'attachments') throw new WeaveError(`Field '${field.name}' is not an attachments field`, 'invalid');
    const file = this.attachFile(e.id, fileInput);
    const cur = Array.isArray(e.values[field.id]) ? e.values[field.id] : [];
    this.updateEntity(e.id, { [field.name]: [...cur, file.id] });
    return file;
  }

  readFile(fileId) {
    for (const e of Object.values(this.state.entities)) {
      const meta = e.files.find((f) => f.id === fileId);
      if (!meta) continue;
      const bytes = this.#readBlob(fileId);
      if (bytes == null) throw new WeaveError('File blob missing', 'not-found');
      return { meta, bytes };
    }
    throw new WeaveError(`File '${fileId}' not found`, 'not-found');
  }

  // Workspace-level logo (shown in the workspace-selector chip). Stored like
  // entity file blobs; the descriptor lives on meta so it persists with the
  // schema rows. Becomes a real field once workspace-as-table lands.
  setWorkspaceLogo({ name, bytes }) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'base64');
    /* The type comes from the bytes, never the caller (Issue #492). */
    const mime = logoType(buf);
    if (!mime) throw new WeaveError('A logo must be a PNG, JPEG, GIF, WebP or SVG image', 'unsupported-type');
    if (this.state.meta.logo) this.deleteWorkspaceLogo();
    const logo = { id: uuid(), name: String(name), size: buf.length, mime, createdAt: nowISO() };
    this.#writeBlob(logo.id, buf);
    this.state.meta.logo = logo;
    this.save();
    return logo;
  }

  getWorkspaceLogo() {
    const logo = this.state.meta.logo;
    if (!logo) throw new WeaveError('Workspace has no logo', 'not-found');
    const bytes = this.#readBlob(logo.id);
    if (bytes == null) throw new WeaveError('Logo blob missing', 'not-found');
    return { meta: logo, bytes };
  }

  deleteWorkspaceLogo() {
    const logo = this.state.meta.logo;
    if (!logo) return;
    if (this.state.fileBlobs) delete this.state.fileBlobs[logo.id];
    delete this.state.meta.logo;
    this.save();
  }

  deleteFile(entityId, fileId) {
    const e = this.getEntity(entityId);
    const had = e.files.some((f) => f.id === fileId);
    e.files = e.files.filter((f) => f.id !== fileId);
    // No ghost pointers: an attachments column loses the file with the file.
    const db = this.state.tables[e.dbId];
    for (const f of Object.values(db.fields)) {
      if (f.type === 'attachments' && Array.isArray(e.values[f.id]) && e.values[f.id].includes(fileId)) {
        e.values[f.id] = e.values[f.id].filter((id) => id !== fileId);
      }
    }
    if (this.state.fileBlobs) delete this.state.fileBlobs[fileId];
    this.#mark(e);
    this.save();
    return { id: fileId, entity: e.id, deleted: had };
  }

  // ---------------- CSV import ----------------

  importCSV(dbRef, csvText) {
    const db = this.getTable(dbRef);
    const rows = parseCSV(csvText);
    if (!rows.length) return { created: 0 };
    const header = rows[0];
    const skip = new Set(['Public Id', 'Created At', 'Updated At', 'publicId', 'createdAt', 'updatedAt']);
    const writable = header.map((name) => {
      if (skip.has(name)) return null;
      const f = this.findField(db, name);
      if (!f || ['lookup', 'rollup', 'formula'].includes(f.type)) return null;
      return f;
    });
    let created = 0;
    const errors = [];
    for (const row of rows.slice(1)) {
      if (row.every((c) => c === '')) continue;
      const values = {};
      writable.forEach((f, i) => {
        if (!f || row[i] === '' || row[i] == null) return;
        let v = row[i];
        if (f.type === 'multiselect' || (f.type === 'relation' && f.config.many)) {
          v = v.split(';').map((s) => s.trim()).filter(Boolean);
        } else if (f.type === 'checkbox') {
          v = ['true', '1', 'yes', '✓', 'x'].includes(v.toLowerCase());
        } else if (f.type === 'toggle') {
          const s = v.trim().toLowerCase();
          v = s === f.config.on.toLowerCase() ? true : s === f.config.off.toLowerCase() ? false : ['true', '1', 'yes', '✓', 'x'].includes(s);
        }
        values[f.name] = v;
      });
      try {
        this.createEntity(db, { values });
        created++;
      } catch (err) {
        errors.push({ row: created + errors.length + 2, error: err.message });
      }
    }
    return { created, errors };
  }

  // ---------------- schema description & export ----------------

  describeSchema() {
    return this.listSpaces().map((sp) => ({
      space: sp.name,
      spaceId: sp.id,
      url: `#/space/${sp.id}`,
      description: sp.description ?? '',
      ...(sp.system ? { system: sp.system } : {}),
      ...(sp.icon ? { icon: sp.icon } : {}),
      ...(sp.template ? { template: true } : {}),
      tables: this.listTables(sp.id).map((db) => ({
        id: db.id,
        name: db.name,
        url: `#/table/${db.id}`,
        description: db.description ?? '',
        ...(db.system ? { system: db.system } : {}),
        ...(db.icon ? { icon: db.icon } : {}),
        ...(db.systemFields?.length ? { systemFields: [...db.systemFields] } : {}),
        // The default view under its pre-views spelling (Feature #229), for
        // the entity page and older readers; `views` below is the whole set.
        ...structuredClone(this.#defaultViewConfig(db)),
        views: (db.tableViews ?? []).map((v) => this.#viewOut(db, v)),
        ...(typeof db.hideRollups === 'boolean' ? { hideRollups: db.hideRollups } : {}),
        bodyBlocks: this.bodyBlocks(db),
        term: this.termOf(db),
        // `noun` is the term's singular under its pre-2026-09 name, emitted
        // only when set so existing readers and round-trip documents hold.
        ...(this.termOf(db).set ? { noun: this.termOf(db).singular } : {}),
        qualified: this.qualifiedName(db),
        entityCount: this.listEntities(db.id).length,
        fields: db.fieldOrder.map((fid) => {
          const f = db.fields[fid];
          const out = { id: f.id, name: f.name, type: f.type };
          if (f.config.width) out.width = f.config.width;
          // What the field holds and how it is written (Issue #209) — the
          // agent's context for the column. A view's `description` is its
          // description size and is emitted with the view keys below.
          if (f.type !== 'view' && f.config.description) out.description = f.config.description;
          if (f.id === db.nameFieldId && f.config.term) out.term = { ...f.config.term };
          if (f.type === 'select' || f.type === 'multiselect') {
            out.options = f.config.options.map((o) => o.name);
            // The field dialog edits colors and must round-trip ids so a
            // rename keeps the option's identity. `options` stays plain
            // names for every existing consumer.
            out.optionsFull = f.config.options.map((o) => ({
              id: o.id, name: o.name, hue: hueOf(o), icon: o.icon ?? '', color: o.color ?? '',
            }));
          }
          if (f.type === 'workflow') out.states = f.config.states.map((s) => ({ id: s.id, name: s.name, category: s.category, default: !!s.default, ...(s.icon ? { icon: s.icon } : {}) }));
          if (f.type === 'relation' && f.config.targetDbs) {
            // Target-set (polymorphic): every member named, no single targetDb.
            const members = f.config.targetDbs.map((tid) => this.state.tables[tid]).filter(Boolean);
            out.targetDbs = members.map((t) => this.qualifiedName(t));
            out.targetDbIds = members.map((t) => t.id);
            out.many = f.config.many;
          } else if (f.type === 'relation') {
            const target = this.state.tables[f.config.targetDb];
            out.targetDb = this.qualifiedName(target);
            out.targetDbId = target.id;
            out.many = f.config.many;
            out.inverseFieldId = f.config.inverseFieldId;
            out.inverseField = target.fields[f.config.inverseFieldId]?.name ?? null;
          }
          if (f.type === 'rollup' && f.config.via) {
            // A space rollup: the table it reads, not a relation it crosses.
            const tdb = this.#tableAnywhere(f.config.via)?.table;
            if (tdb) { out.viaTable = this.qualifiedName(tdb); out.viaTableId = tdb.id; }
            if (f.config.targetField) out.targetField = tdb?.fields[f.config.targetField]?.name;
            if (f.config.where) out.where = f.config.where;
            out.aggregate = f.config.aggregate;
          } else if (f.type === 'lookup' || f.type === 'rollup') {
            const rel = db.fields[f.config.relationField];
            out.via = rel?.name;
            if (f.config.targetField) {
              const tdb = this.state.tables[rel.config.targetDb];
              out.targetField = tdb.fields[f.config.targetField]?.name;
            }
            if (f.type === 'rollup') out.aggregate = f.config.aggregate;
          }
          // A rollup wears the display of the column it summarises (#230).
          if (f.type === 'rollup') {
            const nd = this.#numberDisplay(db, f);
            if (nd) { out.display = nd.display; if (typeof nd.scale === 'number') out.scale = nd.scale; out.color = nd.color; }
          }
          if (f.type === 'number' || f.type === 'formula') {
            for (const k of f.type === 'formula' ? FORMULA_COSTUME_KEYS : NUMBER_COSTUME_KEYS) {
              if (f.config[k] != null) out[k] = f.config[k];
            }
            // A graphic says its colour out loud, ink included (Feature #235).
            if (f.config.display) out.color = f.config.color ?? 'ink';
          }
          if (f.type === 'attachments') out.multiple = f.config.multiple !== false;
          if (f.type === 'toggle') { out.on = f.config.on; out.off = f.config.off; }
          if (f.type === 'rating') { out.max = f.config.max; out.icon = f.config.icon; out.color = f.config.color ?? 'ink'; }
          // A lookup or a rollup that reads a rating draws its icons (#231).
          if (f.type === 'lookup' || f.type === 'rollup') {
            const rt = this.#ratingOf(db, f);
            if (rt) out.rating = rt;
          }
          if (f.type === 'document' && f.config.kind) out.kind = f.config.kind;
          // Which document is the description, said out loud, so applying a
          // schema onto a fresh workspace reproduces the role rather than
          // guessing it from the name (Kyle, 2026-08-27).
          if (f.id === db.descriptionFieldId) out.role = 'description';
          if (f.id === db.nameFieldId) out.role = 'name';
          if (f.type === 'view') {
            out.role = f.config.shape;
            out.shape = f.config.shape;
            out.link = f.config.link;
            out.state = f.config.state;
            out.description = f.config.description;
            out.fields = f.config.fields == null ? null : f.config.fields.map((id) => db.fields[id]?.name).filter(Boolean);
          }
          /* A credential column tells the browser which sort it holds and
             whose store holds it, so the chip can wear the right glyph and
             offer the right door (Feature #143). Never a value — the secret
             is not in the schema any more than it is in a cell. */
          if (f.type === 'key') Object.assign(out, this.credentialConfig(f));
          if (f.type === 'date' || f.type === 'daterange') {
            for (const k of DATE_COSTUME_KEYS) if (f.config[k] != null) out[k] = f.config[k];
          }
          if (f.type === 'formula') out.expression = f.config.expression;
          if (f.type === 'field') { out.types = [...f.config.types]; out.depth = f.config.depth; }
          // A literal text column paints its characters (Issue #86).
          if (f.type === 'text' && f.config.literal) out.literal = true;
          if (f.config?.default !== undefined) out.default = f.config.default;
          return out;
        }),
      })),
    }));
  }

  /* A dump is the whole workspace, attachments included. Blobs live beside
     the .db and not in state, so a plain clone of state handed back a dump
     that NAMED every file and carried none of them: import it into another
     data directory and every attachment is a link that 404s (Issue #121).
     The file ledger and the logo say which blobs are real, so orphans left
     behind by a delete stay behind. A blob already gone is simply absent —
     an export must not fail on damage it did not do.
     `blobs: false` is for a reader rather than a backup: an agent asking for
     the shape of the workspace should not be handed 30MB of base64.
     Secrets stay home (Issue #230): a reader token may take an export, so
     the account token hashes and the view share tokens are stripped on the
     way out — from every surface, the CLI and MCP included. The dump still
     round-trips: imported into another workspace, an account keeps its name
     and role but verifies no token until it is deleted and created again,
     and a view arrives unshared until someone shares it, which mints a fresh
     token. Imported back into the workspace it came from, the stored
     secrets stay put (#keepSecrets).
     The .db copy (`weave backup`, Feature #209) is the surface that keeps
     them; the JSON is interchange, not a key escrow. */
  exportJSON({ blobs: withBlobs = true } = {}) {
    const out = JSON.parse(JSON.stringify(this.state));
    delete out.fileBlobs;
    for (const a of Object.values(out.meta.accounts ?? {})) delete a.tokenHash;
    for (const v of Object.values(out.meta.views ?? {})) delete v.shareToken;
    // Sessions are standing (Feature #222 part 2): a dump is interchange,
    // and a browser signed in here is not signed in there. A pre-#243
    // workspace may still hold invite hashes; they stay out too.
    delete out.meta.sessions;
    delete out.meta.invites;
    // Identity invites are one-time secrets too (Feature #252).
    delete out.meta.identityInvites;
    if (!withBlobs) return out;
    const blobs = {};
    const carry = (id) => {
      const bytes = this.#readBlob(id);
      if (bytes) blobs[id] = bytes.toString('base64');
    };
    for (const e of Object.values(this.state.entities)) for (const f of e.files ?? []) carry(f.id);
    if (this.state.meta.logo) carry(this.state.meta.logo.id);
    if (Object.keys(blobs).length) out.fileBlobs = blobs;
    return out;
  }

  /* The other half of the round trip: a dump's blobs belong in files/, not
     in the workspace row. Left in state they would ride every save into
     weave_meta and grow it without bound. An in-memory workspace has nowhere
     else to keep them, so there they stay. Says whether it landed anything,
     because the caller may still owe a save. */
  #landBlobs() {
    const blobs = this.state.fileBlobs;
    if (!blobs || !this.store.path) return false;
    for (const [id, b64] of Object.entries(blobs)) this.#writeBlob(id, Buffer.from(b64, 'base64'));
    delete this.state.fileBlobs;
    return true;
  }

  /* The export strips the secrets (Issue #230), so a dump imported back into
     the workspace it came from would wipe every token hash, share token
     and session, and lock the admin who ran it out. What the dump
     leaves out, the store keeps: matched by account and view id, and only
     for the accounts and views the dump still names. A secret the dump does
     carry wins. A dump from elsewhere matches no ids and keeps nothing. */
  #keepSecrets(prior) {
    const meta = this.state.meta;
    for (const a of Object.values(meta.accounts ?? {})) {
      const was = prior.accounts?.[a.id];
      if (was?.tokenHash && a.tokenHash === undefined) a.tokenHash = was.tokenHash;
    }
    for (const v of Object.values(meta.views ?? {})) {
      const was = prior.views?.[v.id];
      if (was?.shareToken && v.shareToken === undefined) v.shareToken = was.shareToken;
    }
    for (const kind of ['sessions', 'identityInvites']) {
      if (meta[kind] !== undefined || !prior[kind]) continue;
      const kept = Object.entries(prior[kind]).filter(([, s]) => (kind === 'identityInvites' && !s.accountId) || meta.accounts?.[s.accountId]);
      if (kept.length) meta[kind] = Object.fromEntries(kept);
    }
  }

  importJSON(state) {
    if (!state || ![1, 2].includes(state.version)) throw new WeaveError('Unsupported workspace format', 'invalid');
    // Every id that becomes a blob path is checked before anything is
    // written, so a refused dump leaves the workspace as it was (Issue #479).
    const ids = [...Object.keys(state.fileBlobs ?? {}), state.meta?.logo?.id];
    for (const e of Object.values(state.entities ?? {})) for (const f of e?.files ?? []) ids.push(f?.id);
    for (const id of ids) {
      if (id !== undefined && !BLOB_ID.test(String(id))) throw new WeaveError(`Invalid file id '${id}' in the import`, 'invalid');
    }
    const prior = this.state.meta ?? {};
    // A reserved id in a dump would become a row the store reloads onto a
    // prototype; refuse it before anything changes (Issue #485).
    const tables = { ...state.tables, ...state.databases };
    const maps = [state.spaces, tables, state.entities, state.automations, state.meta?.views, state.meta?.accounts,
      ...Object.values(tables).map((t) => t?.fields)];
    for (const m of maps) for (const k of Object.keys(m ?? {})) refuseReserved('row id', k);
    this.state = JSON.parse(JSON.stringify(state));
    this.#migrate();
    this.#keepSecrets(prior);
    if (this.state.meta.registry !== 'hub') this.#ensureMetaTables();
    else if (this.registryHost) { this.#syncAll(); this.#migrateAutomations(); }
    this.#landBlobs();
    this.#dirtyAll = true;
    this.save();
    return this.#fileLedger();
  }

  /* What an import says about its files (Issue #462). The MCP dump leaves
     the bytes out by design, so a fresh data directory gets names with
     nothing behind them; checked after the landing, so a dump imported back
     where its bytes already sit reports nothing missing. */
  #fileLedger() {
    let files = 0;
    const missing = [];
    for (const e of Object.values(this.state.entities)) {
      for (const f of e.files ?? []) {
        files++;
        if (!this.#hasBlob(f.id)) missing.push({ entity: e.id, file: f.id, name: f.name });
      }
    }
    if (!missing.length) return { files, missing };
    const warning = `${missing.length} of ${files} file${files === 1 ? '' : 's'} arrived without ${missing.length === 1 ? 'its' : 'their'} bytes: `
      + 'the dump names them and carries none. Export with blobs (weave export, GET /api/export, or weave_export_json with blobs: true) to bring them.';
    return { files, missing, warning };
  }

  exportCSV(dbRef) {
    const db = this.getTable(dbRef);
    // The chip and the card are presentation over the other columns, not data.
    const fieldNames = db.fieldOrder.map((fid) => db.fields[fid]).filter((f) => f.type !== 'view').map((f) => f.name);
    const header = ['Public Id', ...fieldNames, 'Created At', 'Updated At'];
    const esc = (v) => {
      if (v == null) return '';
      const s = Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.name : x)).join('; ') : typeof v === 'object' ? (v.name ?? JSON.stringify(v)) : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header.map(esc).join(',')];
    for (const e of this.listEntities(db.id)) {
      const read = this.readEntity(e.id);
      lines.push([e.publicId, ...fieldNames.map((n) => read.fields[n]), e.createdAt, e.updatedAt].map(esc).join(','));
    }
    return lines.join('\n') + '\n';
  }
}
