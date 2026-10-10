import '../public/chip-core.js';
import '../public/date-grain.js';
import '../public/number-core.js';
import '../public/term-core.js';
import '../public/icon-registry.js';
import '../public/mark-icons.js';
import '../public/editor-lib.js';
import '../public/list-core.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';
import { join, dirname } from 'node:path';
import { uuid, slug } from './ids.js';
import { workspaceName, workspaceSlug, nameFromFile, hostSlugRefusal } from './workspace-name.js';
import { Store, WeaveError } from './store.js';
import * as Shares from './shares.js';
import { nearestIcons } from './vocabulary.js';
import { evaluate, check as checkExpression, references as formulaReferences } from './formula.js';
import { aggregate as aggregateValues, describeNumbers, histogram, distribution, NUMERIC_AGGREGATES } from './stats.js';
import { FIELD_TYPE_VOCABULARY, VOCABULARY } from './vocabulary.js';
import { FORMS_DESCRIPTION, ensureFormColumns, refuseOnDocs, adoptForms } from './forms.js';

function iconValue(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const reg = globalThis.weaveIconRegistry, marks = globalThis.weaveMarkIcons;
  if (reg?.resolve(s) || marks?.has(s)) return s;
  const near = nearestIcons(s).map((m) => `lucide:${m.name} (${m.category})`);
  throw new WeaveError(`Icon '${s}' is not in the inventory${near.length ? `; nearest: ${near.join(', ')}` : ''}. Search it with weave_vocabulary {section:"icons", query:"<word>"} (CLI: weave vocabulary icons <word>), or use a mark character`, 'invalid');
}

const Term = globalThis.WeaveTerm;
const ListCore = globalThis.weaveListCore;
const SYSTEM_TERMS = { spaces: 'space', tables: 'table', fields: 'field', workflows: 'workflow', forms: 'form' };

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

const VALUES_BLOCK = '@values';
const BLOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isBodyBlock = (f) => f.type === 'document' || f.type === 'attachments'
  || (f.type === 'relation' && !!(f.many ?? f.config?.many));

const VALUE_TYPES = ['text', 'number', 'rating', 'date', 'daterange', 'checkbox', 'toggle', 'url', 'email', 'select', 'multiselect', 'workflow', 'relation', 'field', 'key', 'attachments'];
const SEARCHED_VALUE_TYPES = new Set(['text', 'url', 'email']);
const REGISTRY_HITS = new Set(['workspaces', 'spaces', 'tables', 'views']);
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const own = (o, k) => (o != null && Object.hasOwn(o, k) ? o[k] : undefined);
function refuseReserved(kind, name) {
  if (RESERVED_NAMES.has(String(name).trim())) throw new WeaveError(`'${String(name).trim()}' is reserved and cannot name a ${kind}`, 'invalid');
}

export function sniffImage(bytes) {
  const b = Buffer.from(bytes ?? []);
  const at = (hex, i = 0) => b.subarray(i, i + hex.length / 2).toString('hex') === hex;
  if (at('89504e470d0a1a0a')) return 'image/png';
  if (at('ffd8ff')) return 'image/jpeg';
  if (at('474946383761') || at('474946383961')) return 'image/gif';
  if (at('52494646') && at('57454250', 8)) return 'image/webp';
  return null;
}

export function logoType(bytes) {
  const head = Buffer.from(bytes ?? []).subarray(0, 1024).toString('utf8').replace(/^\ufeff/, '');
  return sniffImage(bytes)
    ?? (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s/>]/i.test(head) ? 'image/svg+xml' : null);
}

const INLINE_FILE_TYPES = new Set(['application/pdf', 'text/plain']);
export const HTML_VIEW_POLICY = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";
const HTML_FILE_TYPES = new Set(['text/html', 'application/xhtml+xml']);
export function fileHeaders(meta, bytes, { view = false } = {}) {
  const claimed = String(meta.mime ?? '').split(';')[0].trim().toLowerCase();
  const image = claimed.startsWith('image/') ? sniffImage(bytes) : null;
  const extra = String(process.env.WEAVE_INLINE_FILE_TYPES ?? '').toLowerCase().split(',').map((t) => t.trim());
  const html = view && HTML_FILE_TYPES.has(claimed);
  const inline = image === claimed ? image
    : html ? 'text/html; charset=utf-8'
      : INLINE_FILE_TYPES.has(claimed) || (claimed && extra.includes(claimed)) ? claimed : null;
  const name = String(meta.name ?? 'file');
  const ascii = name.replace(/[^\w.-]+/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*!]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return {
    'Content-Type': inline ?? 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': html ? HTML_VIEW_POLICY : "sandbox; default-src 'none'",
  };
}

export const ATTACHMENT_PREVIEWS = ['link', 'inline', 'auto', 'cover'];
export const ATTACHMENT_SIZES = ['small', 'medium', 'large'];
export const ATTACHMENT_FITS = ['fill', 'trim'];
const ATTACHMENT_LOOK_KEYS = ['preview', 'size', 'fit'];

const isBoolType = (t) => t === 'checkbox' || t === 'toggle';
const COMPUTED_TYPES = ['lookup', 'rollup', 'formula', 'view'];
export const SYSTEM_SORT_KEYS = {
  'Created At': 'createdAt', 'Modified At': 'updatedAt',
  'Created By': 'createdBy', 'Modified By': 'modifiedBy',
  'Public Id': 'publicId',
};
const TEXT_OPS = new Set(['contains', 'is-empty', 'not-empty']);
export const VIEW_SHAPES = ['chip', 'card'];
export const DESCRIPTION_SIZES = ['none', 'small', 'medium', 'large'];
const DESCRIPTION_CHARS = { small: 0, medium: 120, large: 320 };
export const ACTIVITY_CAP = 500;
const FIELD_CONFIG_ACTIONS = { 'field-config-updated': 'field-config-updated', 'field-config-undo': 'undo' };
const SCHEMA_AUDIT_ACTIONS = ['space-created', 'space-updated', 'space-trashed', 'space-deleted', 'space-restored', 'space-from-template',
  'table-created', 'table-updated', 'table-moved', 'table-duplicated', 'table-trashed', 'table-deleted', 'table-restored',
  'field-added', 'field-updated', 'field-config-updated', 'field-config-undo', 'field-migrated', 'field-deleted', 'relation-added'];
const UNTAGGED_SCHEMA_ACTIONS = new Set(SCHEMA_AUDIT_ACTIONS.filter((a) => a !== 'field-updated' && a !== 'table-updated'));
const ONTOLOGY_TYPES = { number: 'num', daterange: 'dates', checkbox: 'check', document: 'doc', attachments: 'files', select: 'one', multiselect: 'many', workflow: 'flow' };
const ONTOLOGY_LEGEND = 'one/many/flow[..] are select/multiselect/workflow; a -> T (b) is a relation to T, T* many, b its inverse; a = .. is a lookup, rollup or formula. Every table also has Name, Description, Chip and Card.';
function ontologyEtag(counts) {
  const text = [...counts].filter(([, n]) => n > 0).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, n]) => `${id}:${n}`).join(',');
  return createHash('sha1').update(text).digest('hex').slice(0, 8);
}
function fieldDefinition(f) {
  const { width, ...config } = f.config ?? {};
  return structuredClone({ name: f.name, type: f.type, config });
}
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
const VIEW_AUTO_SEGMENTS = { chip: 3, card: 4 };
const VIEW_DEFAULTS = {
  chip: { shape: 'chip', link: false, state: true, description: 'none', fields: null },
  card: { shape: 'card', link: true, state: true, description: 'small', fields: null },
};
const VIEW_NAMES = { chip: 'Chip', card: 'Card' };
const VIEW_EXCLUDED_TYPES = ['document', 'attachments', 'key', 'field', 'view'];
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
const GRID_SYSTEM_COLUMNS = ['Created At', 'Modified At', 'Created By', 'Modified By'];
const sysColumnId = (name) => `sys:${name}`;
const sysColumnName = (id) => (typeof id === 'string' && id.startsWith('sys:') && GRID_SYSTEM_COLUMNS.includes(id.slice(4)) ? id.slice(4) : null);
const viewEntryName = (db, id) => db.fields[id]?.name ?? sysColumnName(id);
function placeField(db, id) {
  let at = db.fieldOrder.length;
  while (at > 0 && db.fields[db.fieldOrder[at - 1]]?.type === 'view') at--;
  db.fieldOrder.splice(at, 0, id);
  if (db.fields[id]?.type !== 'view') {
    for (const v of db.tableViews ?? []) {
      if (v.fields.includes(id)) continue;
      let k = v.fields.length;
      while (k > 0 && sysColumnName(v.fields[k - 1])) k--;
      v.fields.splice(k, 0, id);
    }
  }
}
function showBySchema(db, fields, id) {
  const at = db.fieldOrder.indexOf(id);
  for (let k = at - 1; k >= 0; k--) {
    const i = fields.indexOf(db.fieldOrder[k]);
    if (i >= 0) { fields.splice(i + 1, 0, id); return; }
  }
  fields.unshift(id);
}
const clip =(text, max) => (text.length <= max ? text : text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');
const DYNAMIC_DATE_DEFAULTS = ['today()', 'now()'];
const DOCUMENT_KINDS = ['markdown', 'html', 'code'];
export const CREDENTIAL_KINDS = ['apikey', 'token', 'password', 'id', 'pair'];
export const KEYSTORES = ['local', '1password', 'aws-sm', 'google-sm', 'cloudflare', 'apple-passwords'];
const DEFAULT_PAIR_PARTS = [{ name: 'id', secret: false }, { name: 'secret', secret: true }];
const NUMBER_COSTUME_KEYS = ['format', 'unit', 'currency', 'decimals', 'separator', 'accounting', 'display', 'scale', 'color'];
const ROLLUP_COSTUME_KEYS = NUMBER_COSTUME_KEYS.filter((k) => k !== 'separator');
export const NUMBER_DISPLAYS = ['text', 'bar', 'ring', 'heat'];
const isGraphicDisplay = (d) => d === 'bar' || d === 'ring' || d === 'heat';
export const CELL_COLORS = ['ink', 'icon', 'accent'];
function cellColorValue(color) {
  if (color == null) return 'ink';
  if (!CELL_COLORS.includes(color)) throw new WeaveError(`Invalid color '${color}' (${CELL_COLORS.join(', ')})`, 'invalid');
  return color;
}
export const SPARKLINE_STYLES = ['line', 'column', 'winloss'];
const lastNumber = (list) => { for (let i = list.length - 1; i >= 0; i--) if (typeof list[i] === 'number' && Number.isFinite(list[i])) return list[i]; return null; };
export const RATING_MAX = 100;
const RATING_DEFAULTS = { max: 5, icon: 'lucide:star' };
const RATING_SCALE_AGGS = ['avg', 'min', 'max', 'median'];
const ratingValue = (n, max) => Math.min(max, Math.max(0, Math.round(n)));
const DATE_COSTUME_KEYS = ['grain', 'format', 'time', 'clock', 'zone', 'zoneName', 'pad', 'elapsed'];
const FORMULA_COSTUME_KEYS = [...new Set([...NUMBER_COSTUME_KEYS, 'style', ...DATE_COSTUME_KEYS.filter((k) => k !== 'elapsed')])];
const DG = globalThis.weaveDateGrain;
const DEFAULTABLE_TYPES = ['text', 'number', 'rating', 'date', 'daterange', 'checkbox', 'toggle', 'url', 'email', 'select', 'multiselect'];
export const FIELD_TYPES = [...VALUE_TYPES, ...COMPUTED_TYPES, 'document'];
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

const STATE_CATEGORIES = ['not-started', 'in-progress', 'done', 'canceled'];
const RETIRED_STATE_CATEGORIES = { other: 'in-progress' };
const DEFAULT_WORKFLOW_STATES = [
  { name: 'Not started', category: 'not-started' },
  { name: 'In progress', category: 'in-progress' },
  { name: 'Done', category: 'done' },
  { name: 'Canceled', category: 'canceled' },
];

const WORKFLOW_STATES = [
  { name: 'Setup incomplete', category: 'not-started', default: true },
  { name: 'Ready', category: 'done' },
];
const workflowActor = (rowId) => `workflow:${rowId}`;
const workflowScript = (spec) => `${JSON.stringify(spec, null, 2)}\n`;

const { HUE_HEX, HUES, hueName } = globalThis.chipCore;
function hueOf(o, { strict = false, fallback = 'slate' } = {}) {
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
  return fallback;
}
function normaliseOption(o, { strict = false } = {}) {
  if (typeof o === 'string') return { id: slug(o), name: o, hue: 'slate', icon: '', color: '' };
  const hue = hueOf(o, { strict });
  return {
    id: o.id ?? slug(o.name), name: o.name, hue,
    icon: iconValue(o.icon),
    color: HUE_HEX[hue],
  };
}
const AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'join', 'median', 'stdev', 'distinct', 'filled', 'empty', 'range'];
const MAX_COMPUTE_DEPTH = 8;
const CYCLE_PREFIX = '#CYCLE: ';
const isCycle = (v) => typeof v === 'string' && v.startsWith(CYCLE_PREFIX);
class CycleSignal extends Error {
  constructor(marker) { super(marker); this.marker = marker; }
}
const FORMULA_SCAN_CAP = 200;

export const DEFINABLE_TYPES = [
  'text', 'number', 'rating', 'date', 'daterange', 'checkbox', 'toggle', 'url', 'email',
  'select', 'multiselect', 'workflow', 'document', 'field', 'key', 'attachments',
];
const MAX_DEFINITION_DEPTH = 4;
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

  levels: [
    {
      key: 'workspace', name: 'Workspace', isEntity: true, registry: 'Workspace/Workspaces', storedIn: 'state.meta',
      contains: 'spaces', identity: 'the .db file; a name and an optional logo',
      definition: 'One workspace file and everything in it. The top level of the hierarchy. The registry lives once, at the hub root (Feature #219): every workspace the hub serves is a row there, and its spaces, tables and fields relate back to it.',
      api: ['describeSchema', 'ontology', 'spaceVersions', 'exportJSON', 'importJSON', 'setWorkspaceLogo'],
    },
    {
      key: 'space', name: 'Space', isEntity: true, registry: 'Workspace/Spaces', storedIn: 'state.spaces',
      contains: 'tables', identity: 'uuid; name unique in the workspace, and the left half of Space/Table',
      definition: 'A space is a workspace\'s unit of meaning: the tables of one area, such as CRM or Development, each addressed as Space/Table. It carries its own schema version, and its row in Workspace/Spaces is the same object seen as data.',
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
      api: ['createAccount', 'listAccounts', 'deleteAccount', 'verifyToken', 'setRequireAuth', 'createSession', 'verifySession', 'removedSession', 'listSessions', 'revokeSession', 'linkIdentity', 'inviteMember', 'listInvites', 'revokeInvite', 'identityInvite', 'redeemIdentityInvite', 'unlinkIdentity', 'accountForIdentity'],
    },
    {
      key: 'key', name: 'Credential', storedIn: 'keystore',
      definition: 'A named secret — API key, token, password, id or pair — held outside the workspace, encrypted in weave\'s keystore or in the manager that owns it. A key field stores the NAME; the value never enters the .db. Reading it back is a separate audited act gated by the credential\'s own access list, never by a permission on the field.',
      identity: 'its name',
      api: ['setKey', 'hasKey', 'listKeys', 'resolveKey', 'revealKey', 'grantKey', 'revokeKey', 'deleteKey'],
    },
    {
      key: 'audit', name: 'Audit entry', storedIn: 'store.audit_log',
      definition: 'A workspace-level record of a structural change: spaces, tables, fields, relations, saved views, accounts, keys, applied schemas. A schema entry names the spaces it touched; their count is each space\'s schema version, and spaceVersions() hashes the versions into the workspace etag (Feature #277).',
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

  aliases: ['record', 'item', 'entry', 'customer', 'company', 'account', 'task', 'deal', 'ticket', 'contact'],

  collisions: [
    {
      alias: 'account', kind: 'account',
      note: 'An "account" row in a CRM table is a Row like any other; the Account kind here is a token holder with a role. Same word, two levels.',
    },
  ],
};

const { dressNumber } = globalThis.weaveNumberCore;

function dressDate(c, iso) { return DG.formatDate(iso, c); }

function rollupCostume(config) {
  if (!ROLLUP_COSTUME_KEYS.some((k) => config[k] != null)) return {};
  return normalizeSelfContainedConfig('number', { ...config, separator: undefined });
}

function formulaCostume(config) {
  if (config.grain == null) return normalizeSelfContainedConfig('number', config, { formula: true });
  const date = normalizeSelfContainedConfig('date', config);
  return { ...date, grain: date.grain ?? [...DG.PARTS] };
}

function dressDateRange(c, value) { return DG.formatDateRange(value, c); }

function normalizeSelfContainedConfig(type, config = {}, { formula = false, strict = false } = {}) {
  if (type === 'select' || type === 'multiselect') {
    return { options: (config.options ?? []).map((o) => normaliseOption(o, { strict })) };
  }
  if (type === 'workflow') {
    const states = (config.states ?? DEFAULT_WORKFLOW_STATES).map((s) => (typeof s === 'string'
      ? { id: slug(s), name: s, category: 'in-progress', default: false }
      : { id: s.id ?? slug(s.name), name: s.name, category: RETIRED_STATE_CATEGORIES[s.category] ?? s.category ?? 'in-progress', default: !!s.default, ...(iconValue(s.icon) ? { icon: iconValue(s.icon) } : {}), ...(hueOf(s, { strict, fallback: null }) ? { hue: hueOf(s, { strict, fallback: null }) } : {}) }));
    if (states.length === 0) throw new WeaveError('Workflow field needs at least one state', 'invalid');
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
    if (config.accounting) {
      if (out.format !== 'currency') throw new WeaveError('Accounting negatives need format currency', 'invalid');
      out.accounting = true;
    }
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
  if (type === 'rating') {
    const max = config.max ?? RATING_DEFAULTS.max;
    if (!Number.isInteger(max) || max < 1 || max > RATING_MAX) {
      throw new WeaveError(`A rating's max is a whole number from 1 to ${RATING_MAX}, got '${config.max}'`, 'invalid');
    }
    const color = cellColorValue(config.color);
    return { max, icon: iconValue(config.icon ?? RATING_DEFAULTS.icon) || RATING_DEFAULTS.icon, ...(color !== 'ink' ? { color } : {}) };
  }
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
  if (type === 'attachments') {
    const multiple = config.multiple == null ? true : !!config.multiple;
    const out = { multiple };
    const pick = (key, list, unmarked) => {
      const v = config[key];
      if (v == null || v === '' || v === unmarked) return;
      if (!list.includes(v)) throw new WeaveError(`Invalid attachments ${key} '${v}' (${list.join(', ')})`, 'invalid');
      out[key] = v;
    };
    pick('preview', ATTACHMENT_PREVIEWS, null);
    pick('size', ATTACHMENT_SIZES, 'medium');
    pick('fit', ATTACHMENT_FITS, 'trim');
    if (out.preview === 'cover' && multiple) throw new WeaveError("A cover preview needs a single-file field (multiple: false)", 'invalid');
    return out;
  }
  if (type === 'text') return config.literal ? { literal: true } : {};
  if (type === 'document') {
    if (config.kind != null && config.kind !== 'markdown') {
      if (!DOCUMENT_KINDS.includes(config.kind)) throw new WeaveError(`Invalid document kind '${config.kind}' (${DOCUMENT_KINDS.join(', ')})`, 'invalid');
      return { kind: config.kind };
    }
    return {};
  }
  return {};
}

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

const MIN_COLUMN_WIDTH = 60;
const VIEW_MIN_WIDTH = 40;
const VIEW_MAX_WIDTH = 4000;
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

function fieldDescriptionValue(raw) {
  if (raw == null) return '';
  if (typeof raw !== 'string') throw new WeaveError('A field description is plain text', 'invalid');
  return raw.trim();
}

const CREATE_INPUT_KEYS = new Set(['values', 'name', 'doc', 'docs']);

const BULK_OPS = ['set', 'link', 'move', 'rollup'];

export { WeaveError };

function nowISO() {
  return new Date().toISOString();
}

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
      const table = without(t, ['id', 'url', 'entityCount', 'maxPublicId']);
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

let HELD = null;
export function deferMigrations() { HELD ??= new Set(); }
export function runDeferredMigrations() {
  const held = HELD;
  HELD = null;
  for (const w of held ?? []) {
    try { w.settleDeferred(); } catch (err) { console.warn(`weave: deferred migration of ${w.store.path} failed: ${err.message}`); }
  }
}

export const inviteUrl = (origin, code) => `${origin}/api/auth/oidc/start?invite=${encodeURIComponent(code)}`;

export class Weave {
  #dirty = new Set();
  #dirtyAll = false;
  #held = false;

  #schemaVersion = null;
  #scales = new Map();

  #computing = [];

  constructor({ path = null, actor = 'local', keystorePath = null, store = null, keystoreEnv = null, revisionWindowMs = DOC_REVISION_WINDOW_MS, name = null } = {}) {
    this.actor = actor;
    this.revisionWindowMs = revisionWindowMs;
    this.keystorePath = keystorePath ?? process.env.WEAVE_KEYSTORE ?? join(process.env.HOME ?? '.', '.weave', 'keystore.json');
    this.keystoreEnv = keystoreEnv ?? process.env;
    this.store = store ?? new Store(path);
    const loaded = this.store.load();
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
    if (this.state.meta.registry !== 'hub') this.#ensureMetaTables();
    if (this.#landBlobs()) this.save();
    HELD?.add(this);
  }

  #migrate() {
    const s = this.state;
    if (!s.meta.id) { s.meta.id = uuid(); if (this.store.path) this.save(); }
    if (s.databases && !s.tables) {
      s.tables = s.databases;
      delete s.databases;
    }
    s.tables = s.tables ?? {};
    let changed = false;
    for (const db of Object.values(s.tables)) {
      if (this.#reconcileFieldOrder(db)) changed = true;
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
    for (const a of Object.values(s.meta.accounts ?? {})) {
      const role = Weave.roleName(a.role);
      if (role !== a.role) { a.role = role; changed = true; }
    }
    if (this.#scrubIdentityEmails()) changed = true;
    if (Shares.liftViewShares(s)) changed = true;
    if (Shares.expireLegacy(s)) changed = true;
    if (changed) this.save();
  }

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

  #ensureTerm(db) {
    if (db.noun == null) return false;
    const nameField = db.fields[db.nameFieldId];
    if (nameField && !nameField.config.term && String(db.noun).trim()) {
      try { nameField.config.term = Term.normalize({ singular: db.noun }); } catch {}
    }
    delete db.noun;
    return true;
  }

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
      if (!db.tableViews && !(db.hiddenFields ?? []).includes(name)) db.hiddenFields = [...(db.hiddenFields ?? []), name];
      changed = true;
    }
    return changed;
  }

  #ensureSystemColumnsInViews(db) {
    if (db.system || db.systemColumnsInViews || !Array.isArray(db.tableViews)) return false;
    db.systemColumnsInViews = true;
    const ids = (db.systemFields ?? []).filter((n) => GRID_SYSTEM_COLUMNS.includes(n)).map(sysColumnId);
    for (const v of db.tableViews) for (const id of ids) if (!v.fields.includes(id)) v.fields.push(id);
    return true;
  }

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

  viewField(dbRef, shape) {
    const db = dbRef && typeof dbRef === 'object' ? dbRef : this.getTable(dbRef);
    if (!VIEW_SHAPES.includes(shape)) throw new WeaveError(`A view is a chip or a card, not '${shape}'`, 'invalid');
    if (db.system) return null;
    const f = db.fields?.[db[`${shape}FieldId`]];
    return f?.type === 'view' ? f : null;
  }

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

  renderView(entityRef, shape, { limit = null, config = null } = {}) {
    const e = this.getEntity(entityRef);
    const db = this.state.tables[e.dbId];
    const field = this.viewField(db, shape);
    const cfg = config
      ? this.#normalizeViewConfig(db, field ?? { config: { ...VIEW_DEFAULTS[shape] } }, config)
      : (field?.config ?? VIEW_DEFAULTS[shape]);
    const out = { shape, id: e.id, publicId: e.publicId, url: `/e/${e.id}`, name: this.entityName(e), link: cfg.link, state: null, description: null, fields: [] };
    const wf = Object.values(db.fields).find((f) => f.type === 'workflow');
    if (cfg.state && wf) {
      const st = this.#resolve(e, db, wf, 0);
      const def = wf.config.states.find((s) => s.id === st || s.name === st);
      if (def) out.state = { name: def.name, category: def.category, ...(def.hue ? { hue: def.hue } : {}) };
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
      const shown = f.type === 'toggle' ? (v ? f.config.on : f.config.off) : v;
      const seg = { label: f.name, value: shown == null ? '' : Array.isArray(shown) ? shown.map((x) => x?.name ?? x).join(', ') : String(shown?.name ?? shown) };
      if ((f.type === 'select' || f.type === 'multiselect') && seg.value) {
        const named = (name) => {
          const o = f.config.options?.find((x) => x.name === name);
          return { name, ...(o?.hue ? { hue: o.hue } : {}), ...(o?.icon ? { icon: o.icon } : {}) };
        };
        seg.type = f.type;
        if (f.type === 'select') seg.option = named(seg.value);
        else seg.options = (Array.isArray(shown) ? shown : []).map((x) => named(x?.name ?? x));
      }
      const nd = typeof resolved === 'number' ? this.#numberDisplay(db, f) : null;
      if (nd) seg.meter = { display: nd.display, value: resolved, scale: this.#scaleOf(db, f), color: nd.color };
      const rated = Array.isArray(resolved) ? resolved.some((v) => typeof v === 'number') : typeof resolved === 'number';
      const rt = rated ? this.#ratingOf(db, f) : null;
      if (rt) {
        seg.rating = Array.isArray(resolved)
          ? { values: resolved.map((v) => (typeof v === 'number' ? v : null)), ...rt }
          : { value: resolved, ...rt };
      }
      if (f.type === 'formula' && f.config.display === 'sparkline' && Array.isArray(resolved)) seg.spark = { style: f.config.style ?? 'line', values: resolved, color: f.config.color ?? 'ink' };
      out.fields.push(seg);
    }
    return out;
  }

  #viewLine(v) {
    const parts = [];
    parts.push(v.link ? `#${v.publicId} ${v.name}` : v.name);
    if (v.state) parts.push(v.state.name);
    if (v.description) parts.push(v.description);
    for (const f of v.fields) if (f.value !== '') parts.push(`${f.label} ${f.value}`);
    return parts.join(' · ');
  }

  termOf(dbRef) {
    const db = dbRef && typeof dbRef === 'object' ? dbRef : this.getTable(dbRef);
    const term = Term.resolve(db.fields?.[db.nameFieldId]?.config);
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

  descriptionField(db) {
    if (!db?.fields) return null;
    if (db.system) return null;
    if (db.descriptionFieldId === null) return null;
    const f = db.fields[db.descriptionFieldId];
    if (f?.type === 'document') return f;
    return this.documentFields(db)[0] ?? null;
  }

  save() {
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
    const db = e?.dbId ? this.state.tables[e.dbId] : null;
    const nf = db?.fields?.[db.nameFieldId];
    if (nf?.type === 'formula' && e.values) {
      try { const v = this.#resolve(e, db, nf, 0); e.values[nf.id] = v == null ? '' : String(v); } catch {}
    }
    const id = typeof entityOrId === 'string' ? entityOrId : entityOrId.id;
    this.#dirty.add(id);
    this.#touching?.add(id);
    if (db?.system === 'workflows' && !this.#stamping) { this.#wfQueue.add(id); this.#wfEpoch++; }
  }

  settleDeferred() {
    this.maybeRefresh();
    const held = this.#held;
    this.#held = false;
    this.#migrate();
    this.#migrateAutomations();
    if (held) this.save();
  }

  maybeRefresh() {
    if (!this.store.changedExternally?.()) return false;
    const loaded = this.store.reload();
    if (loaded) {
      this.state = loaded;
      if (this.registryHost) this.#syncAll();
      this.#migrateAutomations();
    }
    this.#schemaVersion = null;
    this.#scales.clear();
    return true;
  }

  schemaVersion() {
    this.#schemaVersion ??= schemaFingerprint(this.state);
    return this.#schemaVersion;
  }

  createSpace({ name, description = '', icon = '', template = false }) {
    if (!name) throw new WeaveError('Space name is required', 'invalid');
    refuseReserved('space', name);
    if (this.findSpace(name)) throw new WeaveError(`Space '${name}' already exists`, 'conflict');
    const held = Object.values(this.state.spaces).find((s) => s.deletedAt && s.name.toLowerCase() === name.toLowerCase());
    if (held) throw new WeaveError(`Space '${name}' is in the trash — restore or purge it first`, 'conflict');
    const space = { id: uuid(), name, description, ...(iconValue(icon) ? { icon: iconValue(icon) } : {}), ...(template === true ? { template: true } : {}), createdAt: nowISO() };
    this.state.spaces[space.id] = space;
    this.save();
    this.#syncSpaceRow(space);
    if (!space.system) this.#audit('space-created', { name: space.name }, space.id);
    return space;
  }

  listSpaces({ includeDeleted = false } = {}) {
    const all = Object.values(this.state.spaces);
    return includeDeleted ? all : all.filter((s) => !s.deletedAt);
  }

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
    this.#audit('space-updated', { name: s.name, patch: Object.keys(patch) }, s.id);
    if (patch.name != null) s.name = patch.name;
    if (patch.description != null) s.description = patch.description;
    if (patch.icon != null) { const v = iconValue(patch.icon); if (v) s.icon = v; else delete s.icon; }
    if (patch.template != null) { if (patch.template) s.template = true; else delete s.template; }
    this.#syncSpaceRow(s);
    this.save();
    return s;
  }

  deleteSpace(ref, { hard = false } = {}) {
    const s = this.getSpace(ref);
    if (s.system) throw new WeaveError(`Space '${s.name}' is the workspace's own system space and cannot be deleted`, 'invalid');
    if (!hard) {
      if (s.deletedAt) return s;
      s.deletedAt = nowISO();
      this.#trashSysRow('spaces', s.id);
      this.#audit('space-trashed', { name: s.name }, s.id);
      this.save();
      return s;
    }
    for (const db of this.listTables(s.id, { includeDeleted: true })) this.deleteTable(db.id, { hard: true });
    delete this.state.spaces[s.id];
    this.#dropSysRow('spaces', s.id);
    this.#audit('space-deleted', { name: s.name }, s.id);
    this.save();
  }

  restoreSpace(ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    const s = own(this.state.spaces, ref)
      ?? Object.values(this.state.spaces).find((x) => x.name.toLowerCase() === String(ref).toLowerCase());
    if (!s) throw new WeaveError(`Space '${ref}' not found`, 'not-found');
    if (!s.deletedAt) return s;
    if (s.system && this.state.meta.registry === 'hub') throw new WeaveError('The registry lives at the weave root now — this workspace\'s own Workspace space is a tombstone', 'invalid');
    const clash = Object.values(this.state.spaces).find((x) => !x.deletedAt && x.name.toLowerCase() === s.name.toLowerCase());
    if (clash) throw new WeaveError(`A live space already holds the name '${s.name}'`, 'conflict');
    s.deletedAt = null;
    this.#restoreSysRow('spaces', s.id);
    this.#audit('space-restored', { name: s.name }, s.id);
    this.save();
    return s;
  }

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
    if (!db.system) this.#audit('table-created', { space: sp.name, name: db.name }, sp.id);
    return db;
  }

  listTables(spaceId = null, { includeDeleted = false } = {}) {
    let all = Object.values(this.state.tables);
    if (!includeDeleted) all = all.filter((d) => !d.deletedAt && !this.state.spaces[d.spaceId]?.deletedAt);
    return spaceId ? all.filter((d) => d.spaceId === spaceId) : all;
  }

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
    const shape = (t) => JSON.stringify([t.name, t.description ?? '', t.fieldOrder]);
    const was = shape(db);
    if (patch.name != null && db.system && patch.name !== db.name) throw new WeaveError(`Table '${db.name}' is part of the system registry and cannot be renamed`, 'invalid');
    if (patch.name != null) db.name = patch.name;
    if (patch.description != null) db.description = patch.description;
    if (patch.icon != null) db.icon = iconValue(patch.icon);
    if (patch.noun != null) {
      if (typeof patch.noun !== 'string') throw new WeaveError('A noun is a short string (e.g. "invoice")', 'invalid');
      this.#setTerm(db, patch.noun.trim() ? { singular: patch.noun } : null);
    }
    if (patch.systemFields != null) {
      const known = ['Created At', 'Modified At', 'Created By', 'Modified By', 'Activity'];
      for (const n of patch.systemFields) {
        if (!known.includes(n)) throw new WeaveError(`'${n}' is not a system field (${known.join(', ')})`, 'invalid');
      }
      db.systemFields = [...patch.systemFields];
      const cur = !db.system ? db.tableViews?.[0] : null;
      if (cur) {
        const want = new Set(patch.systemFields.filter((n) => GRID_SYSTEM_COLUMNS.includes(n)).map(sysColumnId));
        const show = [...want].filter((id) => !cur.fields.includes(id)).map(sysColumnName);
        const hide = cur.fields.filter((id) => sysColumnName(id) && !want.has(id)).map(sysColumnName);
        if (show.length || hide.length) this.#writeView(db, cur.name, { show, hide });
      }
    }
    if (patch.filters != null || patch.sort != null || patch.hiddenFields != null) {
      this.#writeDefaultView(db, patch);
    }
    if (patch.hideRollups != null) {
      if (typeof patch.hideRollups !== 'boolean') throw new WeaveError('hideRollups is true or false', 'invalid');
      db.hideRollups = patch.hideRollups;
    }
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
    if (patch.fieldOrder != null) {
      const ids = patch.fieldOrder.map((ref2) => this.getField(db.id, ref2).id);
      for (const fid of db.fieldOrder) if (db.fields[fid]?.type === 'view' && !ids.includes(fid)) ids.push(fid);
      const unique = new Set(ids);
      if (unique.size !== ids.length || ids.length !== db.fieldOrder.length) {
        throw new WeaveError('fieldOrder must list every field exactly once', 'invalid');
      }
      db.fieldOrder = ids;
    }
    this.#syncTableRow(db);
    this.save();
    if (!db.system && shape(db) !== was) this.#audit('table-updated', { name: db.name, patch: Object.keys(patch) }, this.#spacesTouching(db));
    if (patch.name != null) this.#reg.#settleWorkflows();
    return db;
  }

  moveTable(ref, spaceRef) {
    const db = this.getTable(ref);
    if (db.system) throw new WeaveError(`Table '${db.name}' is part of the system registry`, 'invalid');
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
    const left = db.spaceId;
    db.spaceId = sp.id;
    this.save();
    this.#syncTableRow(db);
    this.#audit('table-moved', { name: db.name, from, to: sp.name }, [left, ...this.#spacesTouching(db)]);
    return db;
  }

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
    const touchedTargets = [];
    for (const f of Object.values(src.fields)) {
      const nf = structuredClone(f);
      nf.id = mapId(f.id);
      if (f.type === 'relation' && !f.config.targetDbs) {
        if (f.config.targetDb === src.id) {
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
      tableViews: (src.tableViews ?? []).map((v) => {
        const copy = { ...structuredClone(v), id: uuid(), fields: v.fields.map(mapId) };
        if (copy.widths) copy.widths = Object.fromEntries(Object.entries(copy.widths).map(([k, px]) => [mapId(k), px]));
        if (copy.group) copy.group = copy.group.map((l) => ({ ...l, field: mapId(l.field) }));
        for (const k of ['completedBy', 'nest']) if (copy[k]) copy[k] = mapId(copy[k]);
        delete copy.parked;
        delete copy.order;
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
    this.#audit('table-duplicated', { space: sp?.name, source: src.name, name: db.name }, this.#spacesTouching(db));
    return db;
  }

  deleteTable(ref, { hard = false } = {}) {
    const db = this.getTable(ref);
    if (db.system) throw new WeaveError(`Table '${db.name}' is part of the system registry`, 'invalid');
    if (!hard) {
      if (db.deletedAt) return db;
      db.deletedAt = nowISO();
      this.#trashSysRow('tables', db.id);
      for (const v of db.tableViews ?? []) this.#trashSysRow('views', v.id);
      this.#audit('table-trashed', { name: db.name }, this.#spacesTouching(db));
      this.save();
      return db;
    }
    const touched = this.#spacesTouching(db);
    for (const e of this.listEntities(db.id, { includeDeleted: true })) {
      this.deleteEntity(e.id, { hard: true });
    }
    for (const field of Object.values(db.fields)) {
      if (field.type === 'relation') {
        const other = this.state.tables[field.config.targetDb];
        if (other && other.id !== db.id) {
          this.#removeFieldRaw(other, field.config.inverseFieldId);
          this.#dropFieldRow(field.config.inverseFieldId);
        }
      }
    }
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
    this.#audit('table-deleted', { name: db.name }, touched);
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
    this.#audit('table-restored', { name: db.name }, this.#spacesTouching(db));
    this.save();
    return db;
  }

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
        for (const tid of this.relationTargetDbIds(f)) {
          const target = this.state.tables[tid];
          if (!target || target.system) continue;
          lines.push(`  ${nid(db)} -- ${JSON.stringify(f.name)} --> ${nid(target)}`);
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  createView({ name, blocks = [] } = {}) {
    if (!name) throw new WeaveError('View name is required', 'invalid');
    refuseReserved('view', name);
    const views = (this.state.meta.views ??= {});
    const resolved = blocks.map((b) => {
      const db = this.getTable(b.table);
      const view = b.view ?? 'table';
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
    return Object.values(this.state.meta.views ?? {}).map((v) => ({ ...v, shared: this.listShares({ kind: 'view', id: v.id }).length > 0 }));
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
    const held = this.listShares({ kind: 'view', id: v.id }).find((g) => g.mode === 'read' && g.visibility === 'public');
    const g = held ?? this.mintShare({ scope: { kind: 'view', id: v.id }, label: v.name });
    return { url: g.url, token: g.token };
  }

  unshareView(id) {
    const v = this.getView(id);
    for (const g of this.listShares({ kind: 'view', id: v.id })) this.revokeShare(g.id);
    return { id: v.id, shared: false };
  }

  viewByShareToken(token) {
    const g = this.shareByToken(token);
    return g?.scope.kind === 'view' ? own(this.state.meta.views, g.scope.id) : null;
  }

  mintShare(opts = {}) {
    const g = Shares.mint(this, opts);
    this.save();
    this.#audit('share-minted', Shares.auditDetail(g));
    return g;
  }

  listShares(opts = {}) {
    return Shares.list(this, opts ?? {});
  }

  revokeShare(id, { any = true } = {}) {
    const { grant, changed } = Shares.revoke(this, id, { any });
    if (changed) {
      this.save();
      this.#audit('share-revoked', Shares.auditDetail(grant));
    }
    return grant;
  }

  renewShare(id) {
    const g = Shares.renew(this, id);
    this.save();
    this.#audit('share-renewed', Shares.auditDetail(g));
    return g;
  }

  shareByToken(token) {
    return Shares.byToken(this, token);
  }

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

  #viewOut(db, v) {
    const out = { id: v.id, name: v.name };
    out.fields = v.fields.map((id) => viewEntryName(db, id)).filter(Boolean);
    if (v.filters) out.filters = structuredClone(v.filters);
    if (v.sort) out.sort = structuredClone(v.sort);
    const widths = {};
    for (const [id, px] of Object.entries(v.widths ?? {})) { const n = viewEntryName(db, id); if (n) widths[n] = px; }
    if (Object.keys(widths).length) out.widths = widths;
    if (v.frozen) out.frozen = v.frozen;
    if (v.density) out.density = v.density;
    if (v.deleted) out.deleted = true;
    if (typeof v.rollups === 'boolean') out.rollups = v.rollups;
    if (v.layout === 'list') out.layout = 'list';
    const group = (v.group ?? []).filter((l) => db.fields[l.field]).map((l) => ({ field: db.fields[l.field].name, ...ListCore.compactLevel(db.fields[l.field].type, l) }));
    if (group.length) out.group = group;
    if (db.fields[v.completedBy]) out.completedBy = db.fields[v.completedBy].name;
    if (db.fields[v.nest]) out.nest = db.fields[v.nest].name;
    if (Array.isArray(v.collapsed)) out.collapsed = [...v.collapsed];
    const order = (v.order ?? []).map((id) => own(this.state.entities, id)).filter((e) => e && !e.deletedAt && e.dbId === db.id).map((e) => e.publicId);
    if (order.length) out.order = order;
    return out;
  }

  #listField(db, ref) {
    const f = this.findField(db, ref);
    if (!f) throw new WeaveError(`'${ref}' is not a field of ${this.qualifiedName(db)}`, 'not-found');
    return f;
  }

  #checkGroup(db, input) {
    let levels;
    try { levels = ListCore.parseGroup(input); } catch (err) { throw new WeaveError(err.message, 'invalid'); }
    const seen = new Set();
    return levels.map((raw) => {
      const f = this.#listField(db, raw.field);
      if (seen.has(f.id)) throw new WeaveError(`group names each field once: '${f.name}' is there twice`, 'invalid');
      seen.add(f.id);
      try { return { field: f.id, ...ListCore.normalizeLevel({ name: f.name, type: f.type }, raw) }; } catch (err) { throw new WeaveError(err.message, 'invalid'); }
    });
  }

  #orderRow(db, ref) {
    const pid = typeof ref === 'number' ? ref : /^#?\d+$/.test(String(ref).trim()) ? Number(String(ref).trim().replace('#', '')) : null;
    const e = pid != null
      ? Object.values(this.state.entities).find((x) => x.dbId === db.id && x.publicId === pid)
      : own(this.state.entities, String(ref));
    if (!e || e.dbId !== db.id) throw new WeaveError(`'${ref}' is not a row of ${this.qualifiedName(db)} — order lists its rows as #ids`, 'invalid');
    return e.id;
  }

  #writeListKeys(db, next, patch) {
    if (patch.layout !== undefined) {
      if (patch.layout == null || patch.layout === 'table') delete next.layout;
      else if (patch.layout === 'list') next.layout = 'list';
      else throw new WeaveError(`layout is table or list — got ${JSON.stringify(patch.layout)}`, 'invalid');
    }
    if (patch.group !== undefined) {
      const g = patch.group == null ? [] : this.#checkGroup(db, patch.group);
      if (g.length) next.group = g; else delete next.group;
    }
    if (patch.completedBy !== undefined) {
      if (patch.completedBy == null || patch.completedBy === '') delete next.completedBy;
      else {
        const f = this.#listField(db, patch.completedBy);
        if (!isBoolType(f.type)) throw new WeaveError(`completedBy is a checkbox or toggle field: '${f.name}' is a ${f.type}`, 'invalid');
        next.completedBy = f.id;
      }
    }
    if (patch.nest !== undefined) {
      if (patch.nest == null || patch.nest === '') delete next.nest;
      else {
        const f = this.#listField(db, patch.nest);
        if (f.type !== 'relation' || f.config.targetDbs || f.config.targetDb !== db.id) throw new WeaveError(`nest is a link from ${db.name} to itself (a Parent link): '${f.name}' is not one`, 'invalid');
        if (f.config.many) throw new WeaveError(`nest needs one parent per row: '${f.name}' links many`, 'invalid');
        next.nest = f.id;
      }
    }
    if (patch.collapsed !== undefined) {
      if (patch.collapsed == null) delete next.collapsed;
      else {
        if (!Array.isArray(patch.collapsed) || patch.collapsed.some((x) => typeof x !== 'string')) throw new WeaveError('collapsed is a list of group paths, e.g. ["Japan › P1", "Completed"]', 'invalid');
        next.collapsed = [...new Set(patch.collapsed.map((x) => x.trim()).filter(Boolean))].slice(0, 500);
      }
    }
    if (patch.order !== undefined) {
      if (patch.order == null) delete next.order;
      else {
        if (!Array.isArray(patch.order)) throw new WeaveError('order is the list of rows, as #ids, in the order the list shows them', 'invalid');
        const ids = [...new Set(patch.order.map((ref) => this.#orderRow(db, ref)))];
        if (ids.length) next.order = ids; else delete next.order;
      }
    }
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

  #writeView(db, name, patch) {
    const KNOWN = ['name', 'fields', 'show', 'hide', 'move', 'filters', 'sort', 'default', 'position', 'from', 'delete', 'widths', 'frozen', 'density', 'deleted', 'rollups', 'layout', 'group', 'completedBy', 'nest', 'collapsed', 'order'];
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
    this.#writeListKeys(db, next, patch);
    if ((next.frozen ?? 0) > next.fields.length) next.frozen = next.fields.length;
    if (!next.frozen) delete next.frozen;
    if (next.parked && !Object.keys(next.parked).length) delete next.parked;
    if (patch.filters != null) { const f = this.#checkFilters(db, patch.filters); if (f) next.filters = f; else delete next.filters; }
    if (patch.sort != null) { const s = this.#checkSort(db, patch.sort); if (s) next.sort = s; else delete next.sort; }
    if (patch.default === false && i === 0) throw new WeaveError(`'${next.name}' is the default because it is first — move another view to position 0 instead`, 'invalid');
    if (patch.position != null && !(Number.isInteger(patch.position) && patch.position >= 0)) {
      throw new WeaveError('position is a whole number: 0 is the first place in the strip (the default)', 'invalid');
    }
    const created = i < 0;
    if (created) { views.push(next); i = views.length - 1; } else views[i] = next;
    const to = patch.default === true ? 0 : patch.position != null ? Math.min(patch.position, views.length - 1) : i;
    if (to !== i) { views.splice(i, 1); views.splice(to, 0, next); i = to; }
    this.save();
    this.#syncTableRow(db);
    this.#audit(created ? 'table-view-created' : 'table-view-updated', { table: this.qualifiedName(db), name: next.name });
    return { ...this.#viewOut(db, next), ...(created ? { created: true } : {}) };
  }

  #writeDefaultView(db, { filters, sort, hiddenFields }) {
    this.#ensureTableViews(db);
    const cur = db.tableViews[0];
    const patch = {};
    if (filters != null) patch.filters = filters;
    if (sort != null) patch.sort = sort;
    if (hiddenFields != null) {
      if (!Array.isArray(hiddenFields)) throw new WeaveError('hiddenFields is a list of field names', 'invalid');
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

  applySchema(doc, { dryRun = false, allowDestructive = false, partial = false } = {}) {
    if (!Array.isArray(doc)) throw new WeaveError('A schema document is the array describeSchema() returns', 'invalid');
    const plan = [];
    const act = (action, subject, fn) => {
      plan.push({ action, subject });
      if (!dryRun) fn();
    };
    const configFromDescriptor = (f, existing = null) => {
      const config = existing ? { ...existing.config } : {};
      if (f.options) {
        const named = new Map((f.optionsFull ?? []).map((o) => [o.name, o.color ?? '']));
        const kept = new Map((existing?.config.options ?? []).map((o) => [o.name, o.color ?? '']));
        const icons = new Map([
          ...(existing?.config.options ?? []).map((o) => [o.name, o.icon ?? '']),
          ...(f.optionsFull ?? []).filter((o) => 'icon' in o).map((o) => [o.name, o.icon ?? '']),
        ]);
        config.options = f.options.map((name) => normaliseOption(
          { name, color: named.get(name) ?? kept.get(name) ?? '', icon: icons.get(name) ?? '' },
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
      if (f.type === 'attachments') for (const k of ATTACHMENT_LOOK_KEYS) if (f[k] != null) config[k] = f[k];
      if (f.term != null) config.term = f.term;
      if (f.type === 'rating') { if (f.max != null) config.max = f.max; if (f.icon != null) config.icon = f.icon; if (f.color != null) config.color = f.color; }
      if (f.type === 'view') {
        for (const k of ['link', 'state', 'description']) if (f[k] !== undefined) config[k] = f[k];
        if (f.fields !== undefined) config.fields = f.fields;
      }
      return config;
    };
    const DESCRIPTOR_KEYS = ['options', 'states', 'expression', 'via', 'viaTable', 'where', 'targetField', 'aggregate',
      'default', 'width', 'format', 'unit', 'currency', 'decimals', 'separator', 'accounting', 'display', 'scale', 'style', 'time', 'kind', 'multiple', 'types', 'depth',
      'grain', 'clock', 'zone', 'zoneName', 'pad', 'elapsed', 'term', 'link', 'state', 'description', 'fields', 'max', 'icon', 'preview', 'size', 'fit'];
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
        if ('hideRollups' in tDoc && (tDoc.hideRollups !== false) !== (db.hideRollups !== false)) tPatch.hideRollups = !!tDoc.hideRollups;
        if (Object.keys(tPatch).length) act('update-table', qualified, () => this.updateTable(db.id, tPatch));
        let nameTypeChange = null;
        const createdHere = new Set();
        for (const fDoc of tDoc.fields ?? []) {
          let existing = Object.values(db.fields).find((x) => x.name === fDoc.name);
          if (!existing && fDoc.role === 'name') {
            existing = db.fields[db.nameFieldId];
            act('update-field', `${qualified}.${fDoc.name}`, () => this.updateField(db.id, db.nameFieldId, { name: fDoc.name }));
          }
          if (!existing && fDoc.type === 'view' && VIEW_SHAPES.includes(fDoc.role ?? fDoc.shape)) {
            existing = this.viewField(db, fDoc.role ?? fDoc.shape);
            if (existing) act('update-field', `${qualified}.${fDoc.name}`, () => this.updateField(db.id, existing.id, { name: fDoc.name }));
          }
          if (existing && existing.id === db.nameFieldId && fDoc.type && fDoc.type !== existing.type && ['text', 'formula'].includes(fDoc.type)) {
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
        for (const existing of Object.values(db.fields)) {
          if (existing.system || existing.id === db.nameFieldId) continue;
          if (existing.type === 'relation' && existing.inverseOf) continue;
          const still = (tDoc.fields ?? []).some((f) => f.name === existing.name);
          if (!still) {
            if (!allowDestructive) throw new WeaveError(`Applying this document would delete '${qualified}.${existing.name}' — a destructive change needs allowDestructive`, 'invalid');
            act('delete-field', `${qualified}.${existing.name}`, () => this.deleteField(db.id, existing.id));
          }
        }
        if (!dryRun && (tDoc.fields ?? []).length) {
          const wanted = [];
          for (const fDoc of tDoc.fields) {
            const f = Object.values(db.fields).find((x) => x.name === fDoc.name);
            if (f && !wanted.includes(f.id)) wanted.push(f.id);
          }
          for (const id of db.fieldOrder) if (!wanted.includes(id)) wanted.push(id);
          const views = wanted.filter((id) => db.fields[id]?.type === 'view');
          const ordered = [...wanted.filter((id) => !views.includes(id)), ...views];
          wanted.splice(0, wanted.length, ...ordered);
          if (wanted.length === db.fieldOrder.length && JSON.stringify(wanted) !== JSON.stringify(db.fieldOrder)) {
            act('reorder-fields', qualified, () => this.updateTable(db.id, { fieldOrder: wanted }));
          }
        }
        if (Array.isArray(tDoc.views)) {
          this.#applyViews(db, tDoc.views, act, allowDestructive, createdHere);
          const legacy = this.#legacyEdits(db, tDoc, createdHere);
          if (Object.keys(legacy).length) act('update-table', qualified, () => this.updateTable(db.id, legacy));
        }
        const body = this.#bodyOrderFrom(db, tDoc);
        if (body) act('update-table', qualified, () => this.updateTable(db.id, { bodyOrder: body }));
      }
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
    if (created.length) {
      this.#withoutFieldLog(() => {
        for (const { db, tDoc } of created) {
          for (const f of tDoc.fields ?? []) {
            if (f.type !== 'relation') continue;
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

  listTemplates() {
    return this.listSpaces().filter((sp) => sp.template && !sp.system);
  }

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
      if (half) { try { target.deleteSpace(half.id, { hard: true }); } catch {} }
      throw err;
    }
    const made = target.getSpace(as);
    target.#audit('space-from-template', { name: made.name, template: sp.name, from: this.state.meta.name ?? null }, made.id);
    return { space: made, plan, skipped };
  }

  build(spec, { dryRun = false, skipExistingRows = false } = {}) {
    const trial = this.#buildCopy().#buildRun(spec, { keepGoing: true, skipExistingRows });
    if (dryRun || trial.errors.length) return { ok: !trial.errors.length, ...(dryRun ? { dryRun: true } : {}), ...trial };
    const run = this.#buildRun(spec, { keepGoing: false, skipExistingRows });
    return { ok: !run.errors.length, ...run };
  }

  #buildCopy() {
    const state = structuredClone(this.state);
    for (const a of Object.values(state.automations ?? {})) a.actions = (a.actions ?? []).filter((x) => x.type !== 'webhook');
    const store = new Store(null);
    store.load = () => state;
    const copy = new Weave({ store, actor: this.actor, keystorePath: this.keystorePath, keystoreEnv: this.keystoreEnv });
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
        tables.push({ at: tAt, spec: t, db, failed: new Set() });
        return undefined;
      });
      return undefined;
    });

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
        const takes = new Set([...(FIELD_TYPE_VOCABULARY.find((v) => v.type === type)?.config ?? []), 'width', 'description', 'default', 'relation']);
        const dropped = Object.keys(config).filter((k) => !(k in field.config) && !takes.has(k));
        if (dropped.length) ignored.push({ path: at, keys: dropped });
      }
    }

    const relationOf = (tb, key) => {
      const f = this.findField(tb.db, key);
      return f?.type === 'relation' ? f : null;
    };
    const resolves = (f, v) => {
      try { this.#normalizeRelationInput(f, v); return true; } catch { return false; }
    };
    const needs = new Map(tables.map((tb) => [tb, new Set()]));
    for (const tb of tables) {
      for (const row of Array.isArray(tb.spec.rows) ? tb.spec.rows : []) {
        if (!isObj(row)) continue;
        for (const [key, v] of Object.entries(row)) {
          const f = relationOf(tb, key);
          if (!f || v == null) continue;
          for (const id of this.relationTargetDbIds(f)) {
            for (const other of tables) if (other !== tb && other.db.id === id) needs.get(tb).add(other);
          }
        }
      }
    }
    const rowOrder = [];
    const visit = (tb, path) => {
      if (rowOrder.includes(tb) || path.has(tb)) return;
      path.add(tb);
      for (const other of needs.get(tb)) visit(other, path);
      path.delete(tb);
      rowOrder.push(tb);
    };
    for (const tb of tables) visit(tb, new Set());

    const links = [];
    for (const tb of rowOrder) {
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
          const f = relationOf(tb, key);
          (f && !resolves(f, v) ? rel : values)[key] = v;
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

    if (computedMade.length) {
      const brief = (v) => (Array.isArray(v) ? v.map(brief) : isObj(v) && 'name' in v ? v.name : v);
      computed = {};
      for (const { tb, name } of computedMade) {
        computed[`${this.qualifiedName(tb.db)}.${name}`] = this.query(tb.db.id, { limit: 3, fields: [name] }).items.map((e) => brief(e.fields[name]));
      }
    }
    return result();
  }

  #buildOrder(db, names) {
    const lead = names.map((n) => this.getField(db.id, n).id);
    const order = [...new Set([...lead, ...db.fieldOrder])];
    this.updateTable(db.id, { fieldOrder: order });
    const [view] = this.tableView(db.id).views;
    const shown = new Set(view.fields.map((n) => this.findField(db, n)?.id ?? n));
    const cols = [...order.filter((id) => shown.has(id)), ...[...shown].filter((id) => !order.includes(id))];
    this.tableView(`${db.id}/${view.name}`, { fields: cols });
  }

  #applyTableCostume(db, tDoc) {
    const patch = {};
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
    if (Array.isArray(tDoc.views)) {
      this.#applyViews(db, tDoc.views, (a, s, fn) => fn(), true);
      const legacy = this.#legacyEdits(db, tDoc);
      if (Object.keys(legacy).length) this.updateTable(db.id, legacy);
    }
  }

  #bodyOrderFrom(db, tDoc) {
    if (!Array.isArray(tDoc.bodyBlocks)) return null;
    const want = tDoc.bodyBlocks.filter((n) => n === VALUES_BLOCK || (this.findField(db, n) && isBodyBlock(this.findField(db, n))));
    const now = this.bodyBlocks(db).filter((n) => want.includes(n));
    return JSON.stringify(want) === JSON.stringify(now) ? null : want;
  }

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

  #applyViews(db, docViews, act, allowDestructive, created = new Set()) {
    const q = this.qualifiedName(db);
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
      if (vDoc.layout) out.layout = vDoc.layout;
      if (Array.isArray(vDoc.group)) out.group = vDoc.group.filter((l) => has(typeof l === 'string' ? l : l?.field));
      for (const k of ['completedBy', 'nest']) if (vDoc[k] && has(vDoc[k])) out[k] = vDoc[k];
      for (const k of ['filters', 'sort', 'widths']) if (out[k] && !Object.keys(out[k]).length) delete out[k];
      return out;
    };
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
      if (JSON.stringify(vDoc.widths ?? {}) !== JSON.stringify(have?.widths ?? {})) {
        patch.widths = { ...Object.fromEntries(Object.keys(have?.widths ?? {}).map((n) => [n, null])), ...(vDoc.widths ?? {}) };
      }
      if ((vDoc.frozen ?? 0) !== (have?.frozen ?? 0)) patch.frozen = vDoc.frozen ?? 0;
      if ((vDoc.density ?? 'comfortable') !== (have?.density ?? 'comfortable')) patch.density = vDoc.density ?? 'comfortable';
      if (!!vDoc.deleted !== !!have?.deleted) patch.deleted = !!vDoc.deleted;
      if ((vDoc.rollups ?? null) !== (have?.rollups ?? null)) patch.rollups = vDoc.rollups ?? null;
      if ((vDoc.layout ?? 'table') !== (have?.layout ?? 'table')) patch.layout = vDoc.layout ?? 'table';
      if (JSON.stringify(vDoc.group ?? []) !== JSON.stringify(have?.group ?? [])) patch.group = vDoc.group ?? null;
      for (const k of ['completedBy', 'nest']) if ((vDoc[k] ?? null) !== (have?.[k] ?? null)) patch[k] = vDoc[k] ?? null;
      if (!Object.keys(patch).length) continue;
      act(have ? 'update-view' : 'create-view', `${q}/${vDoc.name}`, () => this.tableView(`${db.id}/${vDoc.name}`, patch));
    }
    for (const v of doomed) act('delete-view', `${q}/${v.name}`, () => this.tableView(`${db.id}/${v.id}`, { delete: true }));
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

  getWorkspace() {
    const m = this.state.meta;
    return { id: m.id, name: m.name, title: m.title ?? m.name, description: m.description ?? '', logo: !!m.logo, requireAuth: !!m.requireAuth, linkPreview: !!m.linkPreview };
  }

  updateWorkspace({ name = null, description = null, linkPreview = null } = {}) {
    if (name != null && name !== this.state.meta.name) refuseOnDocs(this, 'renamed');
    if (description != null) this.state.meta.description = String(description);
    if (linkPreview != null) {
      if ([true, 'true', 'on'].includes(linkPreview)) this.state.meta.linkPreview = true;
      else delete this.state.meta.linkPreview;
    }
    if (name != null && name !== this.state.meta.name) {
      const slug = workspaceSlug(name);
      const refused = hostSlugRefusal(slug);
      if (refused) throw new WeaveError(refused.message, refused.code);
      const was = String(this.state.meta.name ?? '').toLowerCase();
      const aliases = [...(this.state.meta.aliases ?? []), ...(was ? [was] : [])].filter((a, i, all) => a !== slug && all.indexOf(a) === i);
      if (aliases.length) this.state.meta.aliases = aliases;
      else delete this.state.meta.aliases;
      this.state.meta.name = slug;
      this.state.meta.title = String(name).trim();
      if (this.state.meta.title === slug) delete this.state.meta.title;
    }
    this.#audit('workspace-updated', { name: this.state.meta.name });
    this.save();
    this.#syncWorkspaceRow();
    return this.getWorkspace();
  }

  #keystoreKey() {
    const pass = this.keystoreEnv?.WEAVE_KEYSTORE_PASSPHRASE;
    if (pass) return scryptSync(String(pass), 'weave-keystore-v2', 32);
    const keyPath = this.keystorePath.replace(/\.json$/, '') + '.key';
    try {
      const b = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64');
      if (b.length === 32) return b;
    } catch {}
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

  #readKeystore() {
    let raw;
    try { raw = JSON.parse(readFileSync(this.keystorePath, 'utf8')); } catch { return { v: 2, keys: {} }; }
    if (raw && raw.v === 2 && raw.keys) return raw;
    const keys = {};
    for (const [name, secret] of Object.entries(raw ?? {})) keys[name] = { legacy: String(secret) };
    return { v: 2, keys, migrated: true };
  }

  #writeKeystore(data) {
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

  #mayReveal(entry) {
    if (!entry) return false;
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
    this.#audit('key-revealed', { name, via });
    return 'legacy' in entry ? entry.legacy : this.#open(entry, name);
  }

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

  credentialLink(field, ref) {
    const { keystore } = this.credentialConfig(field);
    const r = encodeURIComponent(String(ref ?? ''));
    switch (keystore) {
      case '1password': return `onepassword://search/?q=${r}`;
      case 'aws-sm': return `https://console.aws.amazon.com/secretsmanager/secret?name=${r}`;
      case 'google-sm': return `https://console.cloud.google.com/security/secret-manager/secret/${r}`;
      case 'cloudflare': return `https://dash.cloudflare.com/?to=/:account/workers/services`;
      case 'apple-passwords': return 'x-apple.systempreferences:com.apple.Passwords-Settings.extension';
      default: return null;
    }
  }

  static ROLES = ['architect', 'editor', 'observer'];
  static ROLE_LABELS = { architect: 'Architect, paid', editor: 'Editor, paid seat', observer: 'Observer, free' };
  static OLD_ROLES = { admin: 'architect', writer: 'editor', reader: 'observer' };
  static roleName(role) { return Weave.OLD_ROLES[role] ?? role; }

  #audit(action, detail = {}, spaces = null) {
    const touched = spaces ? [...new Set([].concat(spaces).filter(Boolean))] : [];
    this.store.audit({ at: nowISO(), actor: this.actor, action, detail: touched.length ? { ...detail, spaces: touched } : detail });
    this.#reg.#settleWorkflows();
  }

  #spacesTouching(db, field = null) {
    const ids = new Set([db.spaceId]);
    const fields = field ? [field] : Object.values(db.fields);
    for (const f of fields) {
      if (f.type !== 'relation') continue;
      for (const tid of [f.config.targetDb, ...(f.config.targetDbs ?? [])]) {
        if (this.state.tables[tid]) ids.add(this.state.tables[tid].spaceId);
      }
    }
    const watched = new Set(fields.map((f) => f.id));
    for (const other of Object.values(this.state.tables)) {
      for (const f of Object.values(other.fields)) {
        if (f.config?.targetField && watched.has(f.config.targetField)) ids.add(other.spaceId);
        if (!field && f.type === 'relation' && (f.config.targetDb === db.id || f.config.targetDbs?.includes(db.id))) ids.add(other.spaceId);
      }
    }
    return [...ids];
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

  listAccounts() {
    return Object.values(this.state.meta.accounts ?? {}).map(({ tokenHash, credentials, ...pub }) => pub);
  }

  deleteAccount(ref) {
    const accounts = this.state.meta.accounts ?? {};
    const a = own(accounts, ref) ?? Object.values(accounts).find((x) => x.name === ref);
    if (!a) throw new WeaveError(`Account '${ref}' not found`, 'not-found');
    delete accounts[a.id];
    const sessions = this.state.meta.sessions ?? {};
    const removedAt = nowISO();
    let ended = 0;
    for (const [h, s] of Object.entries(sessions)) {
      if (s.accountId !== a.id) continue;
      sessions[h] = { removedAt, expiresAt: s.expiresAt };
      ended += 1;
    }
    this.save();
    this.#audit('account-deleted', { name: a.name });
    if (ended) this.#audit('session-revoked', { name: a.name, count: ended, all: true });
    return { id: a.id, deleted: true };
  }

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

  verifySession(token) {
    if (!token) return null;
    const h = this.#hash(token);
    const s = this.state.meta.sessions?.[h];
    if (!s) return null;
    const now = Date.now();
    if (Date.parse(s.expiresAt) <= now) { delete this.state.meta.sessions[h]; this.save(); return null; }
    if (s.removedAt) return null;
    const a = this.state.meta.accounts?.[s.accountId];
    if (!a) return null;
    const renewed = now - Date.parse(s.lastSeenAt) > 60 * 1000;
    if (renewed) {
      s.lastSeenAt = new Date(now).toISOString();
      s.expiresAt = new Date(now + Weave.SESSION_TTL_MS).toISOString();
      this.save();
    }
    const { tokenHash, ...pub } = a;
    return { ...pub, sessionId: h, expiresAt: s.expiresAt, renewed };
  }

  removedSession(token) {
    if (!token) return null;
    const s = this.state.meta.sessions?.[this.#hash(token)];
    if (!s?.removedAt || Date.parse(s.expiresAt) <= Date.now()) return null;
    return { removedAt: s.removedAt };
  }

  listSessions(accountRef) {
    const a = this.#account(accountRef);
    const now = Date.now();
    return Object.entries(this.state.meta.sessions ?? {})
      .filter(([, s]) => s.accountId === a.id && Date.parse(s.expiresAt) > now)
      .map(([id, s]) => ({ id, ...s }))
      .sort((x, y) => y.lastSeenAt.localeCompare(x.lastSeenAt));
  }

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

  #invite(code) {
    const h = this.#hash(code);
    const i = code ? this.state.meta.identityInvites?.[h] : null;
    if (!i || Date.parse(i.expiresAt) <= Date.now()) return null;
    if (!i.accountId) return { h, i, a: null };
    const a = this.state.meta.accounts?.[i.accountId];
    return a ? { h, i, a } : null;
  }

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

  revokeInvite(id) {
    const invites = this.state.meta.identityInvites ?? {};
    const key = String(id ?? '').length >= 8 ? Object.keys(invites).find((h) => h.startsWith(String(id))) : null;
    if (!key) throw new WeaveError(`Invite '${id ?? ''}' not found`, 'not-found');
    delete invites[key];
    this.save();
    this.#audit('invite-revoked', {});
    return { revoked: 1 };
  }

  #memberName(email) {
    const base = String(email ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'member';
    const taken = new Set(Object.values(this.state.meta.accounts ?? {}).map((a) => a.name));
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${base}-${n}`;
      if (taken.has(name)) continue;
      try { refuseReserved('account', name); return name; } catch {}
    }
  }

  identityInvite(code) {
    const found = this.#invite(code);
    return found ? { account: found.a?.name ?? this.#memberName(found.i.email), issuer: found.i.issuer, expiresAt: found.i.expiresAt } : null;
  }

  invitesForEmail(email) {
    const mail = String(email ?? '').trim().toLowerCase();
    return mail ? this.listInvites().filter((i) => i.email === mail) : [];
  }

  acceptInvite(id, who = {}) {
    const mail = String(who.email ?? '').trim().toLowerCase();
    const i = Object.hasOwn(this.state.meta.identityInvites ?? {}, String(id)) ? this.state.meta.identityInvites[id] : null;
    if (!mail || !i || i.accountId || i.email !== mail || Date.parse(i.expiresAt) <= Date.now()) throw new WeaveError('This invite expired, was already used or is for another address', 'not-found');
    return this.#redeem({ h: String(id), i, a: null }, who);
  }

  redeemIdentityInvite(code, who = {}) {
    const found = this.#invite(code);
    if (!found) throw new WeaveError('This invite expired or was already used', 'not-found');
    return this.#redeem(found, who);
  }

  #redeem({ h, i, a }, { issuer, subject, email } = {}) {
    const mail = String(email ?? '').trim().toLowerCase();
    const stamp = (x) => { if (mail) x.verifiedEmail = mail; return x; };
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
      row.identities = [stamp({ issuer: iss, subject: sub, createdAt: at, lastUsedAt: at })];
      this.save();
      this.#audit('member-joined', { name: row.name, role: row.role, invitedBy: i.invitedBy ?? null });
      const { tokenHash, ...pub } = row;
      return pub;
    }
    let identity = (a.identities ?? []).find((x) => x.issuer === iss && x.subject === sub);
    if (!identity) {
      identity = stamp({ issuer: iss, subject: sub, createdAt: at, lastUsedAt: at });
      (a.identities ??= []).push(identity);
      this.#audit('identity-linked', { name: a.name, issuer: iss });
    } else stamp(identity).lastUsedAt = at;
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

  accountForIdentity({ issuer, subject, email } = {}) {
    if (!issuer || !subject) return null;
    for (const a of Object.values(this.state.meta.accounts ?? {})) {
      const i = (a.identities ?? []).find((x) => x.issuer === issuer && x.subject === String(subject));
      if (!i) continue;
      i.lastUsedAt = nowISO();
      const mail = String(email ?? '').trim().toLowerCase();
      if (mail) i.verifiedEmail = mail;
      this.save();
      const { tokenHash, ...pub } = a;
      return pub;
    }
    return null;
  }

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

  #inMetaSync = false;
  registryHost = null;
  members = [];
  get #reg() { return this.registryHost ?? this; }
  #engines() { const r = this.#reg; return [r, ...r.members]; }
  #engineOf(wsId) {
    if (!wsId || wsId === this.state.meta.id) return this;
    return this.#engines().find((w) => w.state.meta.id === wsId) ?? this;
  }
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
    adoptForms(this, root);
    const spacesT = root.#sysTable('spaces');
    for (const f of rollups) {
      const via = this.state.tables[f.config.via];
      if (!via || via.deletedAt) continue;
      const name = root.findField(spacesT, f.name) ? `${f.name} (${this.state.meta.name})` : f.name;
      if (root.findField(spacesT, name)) continue;
      const config = { via: f.config.via, aggregate: f.config.aggregate, ...(f.config.targetField ? { targetField: f.config.targetField } : {}), ...(f.config.where ? { where: f.config.where } : {}) };
      try { root.addField(spacesT.id, { name, type: 'rollup', config }); } catch {}
    }
    this.#migrateAutomations();
    root.#settleWorkflows();
    return this;
  }

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
    if (!!meta.deletedAt !== !!row.deletedAt) reg.#metaSync(() => (meta.deletedAt ? reg.deleteEntity(row.id) : reg.restoreEntity(row.id)));
    return row;
  }

  syncRegistry() { this.#syncAll(); return this; }

  #metaSync(fn) {
    const was = this.#inMetaSync;
    this.#inMetaSync = true;
    try { return fn(); } finally { this.#inMetaSync = was; }
  }

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
    if (this.state.meta.registry === 'hub' && !this.registryHost) return undefined;
    return Object.values(this.#reg.state.tables).find((t) => t.system === kind && !t.deletedAt);
  }

  #sysRow(kind, sysId) {
    const t = this.#sysTable(kind);
    if (!t) return undefined;
    return Object.values(this.#reg.state.entities).find((e) => e.dbId === t.id && e.sysId === sysId);
  }

  #relIds(row, table, fieldName) {
    const f = this.#sysField(table, fieldName);
    const v = row.values[f.id];
    return Array.isArray(v) ? v : v == null ? [] : [v];
  }

  #sysField(table, name) {
    return Object.values(table.fields).find((f) => f.name === name);
  }

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
    if (!this.#sysField(spacesT, 'Template')) this.addField(spacesT.id, { name: 'Template', type: 'checkbox' }).system = true;
    const tablesT = this.#sysTable('tables')
      ?? mkTable('Tables', 'tables', 'Every table in this workspace, as a row related to its space. Creating a row creates the table; renaming it renames the table; hard-deleting it deletes the table and its rows.');
    if (!this.#sysField(tablesT, 'Space')) {
      const { field, inverse } = this.addRelation(tablesT.id, { name: 'Space', targetDb: spacesT.id, cardinality: 'many-to-one', inverseName: 'Tables' });
      field.system = true;
      inverse.system = true;
    }
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
    if (!this.#sysField(fieldsT, 'Definition')) this.addField(fieldsT.id, { name: 'Definition', type: 'field', config: { depth: 4 } }).system = true;
    const viewsT = this.#sysTable('views')
      ?? mkTable('Views', 'views', 'Every view over every table, as a row related to its table: the columns it shows in order, its state filter and its sort. The first view of a table is its default. Creating a row creates the view; editing it edits the view; deleting it deletes the view.');
    if (!this.#sysField(viewsT, 'Table')) {
      const { field, inverse } = this.addRelation(viewsT.id, { name: 'Table', targetDb: tablesT.id, cardinality: 'many-to-one', inverseName: 'Views' });
      field.system = true;
      inverse.system = true;
    }
    for (const [n, type] of [['Fields', 'text'], ['Filter', 'text'], ['Sort', 'text'], ['Default', 'checkbox'], ['Position', 'number'], ['Frozen', 'number'], ['Widths', 'text'], ['Density', 'text'], ['Show Deleted', 'checkbox'], ['Rollup Row', 'checkbox'], ['Layout', 'text'], ['Group', 'text']]) {
      if (!this.#sysField(viewsT, n)) this.addField(viewsT.id, { name: n, type, ...(type === 'number' ? { config: { decimals: 0 } } : {}) }).system = true;
    }
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
    const stateF = this.#sysField(wfT, 'State');
    if (!stateF) {
      this.addField(wfT.id, { name: 'State', type: 'workflow', config: { states: WORKFLOW_STATES } }).system = true;
    } else if (stateF.config.states.map((s) => s.name).join() !== WORKFLOW_STATES.map((s) => s.name).join()) {
      stateF.config = normalizeSelfContainedConfig('workflow', { states: WORKFLOW_STATES });
      this.save();
    }
    if (!this.#sysField(wfT, 'Health')) {
      this.addField(wfT.id, { name: 'Health', type: 'select', config: { options: [
        { name: 'Healthy', hue: 'green' },
        { name: 'Warning', hue: 'amber' },
        { name: 'Failed', hue: 'red' },
        { name: 'No runs', hue: 'slate' },
      ] } }).system = true;
    }
    const healthF = this.#sysField(wfT, 'Health');
    if (!healthF.config.options.some((o) => o.name === 'No runs')) {
      healthF.config.options.push(normaliseOption({ name: 'No runs', hue: 'slate' }));
      this.save();
    }
    if (!this.#sysField(wfT, 'Health Reason')) this.addField(wfT.id, { name: 'Health Reason', type: 'text' }).system = true;
    if (!this.#sysField(wfT, 'Last Run')) this.addField(wfT.id, { name: 'Last Run', type: 'date', config: { time: true } }).system = true;
    if (!this.#sysField(wfT, 'Diagram')) this.addField(wfT.id, { name: 'Diagram', type: 'document' }).system = true;
    if (!this.#sysField(wfT, 'Type')) this.addField(wfT.id, { name: 'Type', type: 'select', config: { options: [] } }).system = true;
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
    const wsT = this.#sysTable('workspaces')
      ?? mkTable('Workspaces', 'workspaces', 'Every workspace this weave serves, as a row: the hub root and every member workspace. Its spaces, tables, fields and workflows relate back to it. Workspaces are created and deleted from the hub, not as rows.');
    for (const [t, inverseName] of [[spacesT, 'Spaces'], [tablesT, 'Tables'], [fieldsT, 'Fields'], [wfT, 'Workflows'], [viewsT, 'Views']]) {
      if (this.#sysField(t, 'Workspace')) continue;
      const { field, inverse } = this.addRelation(t.id, { name: 'Workspace', targetDb: wsT.id, cardinality: 'many-to-one', inverseName });
      field.system = true;
      inverse.system = true;
    }
    ensureFormColumns(this, this.#sysTable('forms') ?? mkTable('Forms', 'forms', FORMS_DESCRIPTION), tablesT);
    this.#syncAll();
    this.#migrateAutomations();
    this.#settleWorkflows();
  }

  registryReport() {
    const problems = [];
    const rowOf = (kind, sysId) => this.#sysRow(kind, sysId);
    const relIds = (row, table, fieldName) => this.#relIds(row, table, fieldName);
    const tablesT = this.#sysTable('tables');
    const fieldsT = this.#sysTable('fields');
    if (!tablesT || !fieldsT) return { problems, rows: 0 };

    let rows = 0;
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
    const reg = this.#reg;
    for (const [kind, sysTable, lookup] of [
      ['table', tablesT, (id) => this.#tableAnywhere(id)],
      ['field', fieldsT, (id) => this.#fieldOwner(id)],
      ['view', this.#sysTable('views'), (id) => this.#viewAnywhere(id)],
    ]) {
      if (!sysTable) continue;
      for (const row of reg.listEntities(sysTable.id)) {
        if (!mine.has(this.#wsIdOfRow(row))) continue;
        if (row.sysId && !lookup(row.sysId)) {
          problems.push({ kind, name: this.entityName(row), problem: 'row describes nothing that exists', rowId: row.id });
        }
      }
    }
    return { problems, rows };
  }

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
    const t = this.#sysTable('spaces');
    if (!t) return undefined;
    if (space.system && this.registryHost) return undefined;
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
    const t = this.#sysTable('tables');
    if (!t) return undefined;
    if (db.system && this.registryHost) return undefined;
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
    }
    const patch = {};
    if (reg.entityName(row) !== db.name) patch.Name = db.name;
    const descF = this.#sysField(t, 'Description');
    if ((row.values[descF.id] ?? '') !== (db.description ?? '')) patch.Description = db.description ?? '';
    if (spaceRow && !this.#relIds(row, t, 'Space').includes(spaceRow.id)) patch.Space = spaceRow.id;
    if (wsRow && !this.#relIds(row, t, 'Workspace').includes(wsRow.id)) patch.Workspace = wsRow.id;
    const orderF = this.#sysField(t, 'Field Order');
    if (orderF) {
      const order = db.fieldOrder.map((id) => db.fields[id]?.name).filter(Boolean).join(', ');
      if ((row.values[orderF.id] ?? '') !== order) patch['Field Order'] = order;
    }
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
    if (hideF && !!row.values[hideF.id] !== (db.hideRollups !== false)) patch['Hide Rollups'] = db.hideRollups !== false;
    if (Object.keys(patch).length) reg.#metaSync(() => reg.updateEntity(row.id, patch));
    this.#syncViewRows(db, row);
    return row;
  }

  #syncViewRows(db, tableRow) {
    const t = this.#sysTable('views');
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
        Frozen: v.frozen ?? 0,
        Widths: formatWidths(this.#viewOut(db, v).widths),
        Density: v.density ?? '',
        'Show Deleted': !!v.deleted,
        'Rollup Row': typeof v.rollups === 'boolean' ? v.rollups : db.hideRollups === false,
        Layout: v.layout ?? '',
        Group: (v.group ?? []).map((l) => db.fields[l.field]?.name).filter(Boolean).join(ListCore.SEP),
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
      for (const k of ['Fields', 'Filter', 'Sort', 'Default', 'Position', 'Frozen', 'Widths', 'Density', 'Show Deleted', 'Rollup Row', 'Layout', 'Group']) {
        const f = this.#sysField(t, k);
        if (!f) continue;
        if ((row.values[f.id] ?? (['Default', 'Show Deleted', 'Rollup Row'].includes(k) ? false : k === 'Frozen' ? 0 : '')) !== want[k]) patch[k] = want[k];
      }
      if (!this.#relIds(row, t, 'Table').includes(tableRow.id)) patch.Table = tableRow.id;
      if (wsRow && !this.#relIds(row, t, 'Workspace').includes(wsRow.id)) patch.Workspace = wsRow.id;
      if (Object.keys(patch).length) reg.#metaSync(() => reg.updateEntity(row.id, patch));
    });
  }

  #viewAnywhere(viewId) {
    for (const w of this.#engines()) {
      for (const table of Object.values(w.state.tables)) {
        const view = table.tableViews?.find((v) => v.id === viewId);
        if (view) return { owner: w, table, view };
      }
    }
    return null;
  }

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

  #fieldOwner(fieldId) {
    return this.#fieldAnywhere(fieldId)?.table;
  }

  #dropSysRow(kind, sysId) {
    const row = this.#sysRow(kind, sysId);
    const reg = this.#reg;
    if (row) reg.#metaSync(() => reg.deleteEntity(row.id, { hard: true }));
  }

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

  #interceptCreate(db, input) {
    if (!db.system || this.#inMetaSync) return undefined;
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
    const wsRef = values.Workspace;
    delete values.Workspace;
    if (db.system === 'spaces') {
      let owner = this;
      if (wsRef != null) {
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
      if (owner.state.spaces[spaceRow.sysId]?.system) {
        throw new WeaveError(`Space '${this.entityName(spaceRow)}' is part of the system registry — create tables in your own spaces`, 'invalid');
      }
      made = this.#sysRow('tables', owner.createTable({ space: spaceRow.sysId, name, description }).id);
    } else if (db.system === 'fields') {
      const tableRef = values.Table;
      const def = values.Definition;
      delete values.Table;
      delete values.Definition;
      delete values.Type;
      if (tableRef == null) throw new WeaveError(`A Fields row needs its 'Table' — which table the column lands on`, 'invalid');
      if (!def || typeof def !== 'object' || !def.type) throw new WeaveError(`A Fields row needs its 'Definition' — the column's shape`, 'invalid');
      const tableRow = this.findEntity(this.#sysTable('tables').id, tableRef);
      if (!tableRow) throw new WeaveError(`Table row '${tableRef}' not found`, 'not-found');
      const owner = this.#ownerOf(tableRow);
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
    if (db.system === 'workspaces') {
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
    if ('Layout' in values) vp.layout = String(take('Layout') ?? '').trim().toLowerCase() || 'table';
    if ('Group' in values) {
      const names = ListCore.parseGroup(String(take('Group') ?? '')).map((l) => l.field);
      vp.group = names.map((n) => cur?.group?.find((l) => l.field.toLowerCase() === n.toLowerCase()) ?? n);
    }
    if ('Widths' in values) {
      vp.widths = { ...Object.fromEntries(Object.keys(cur?.widths ?? {}).map((n) => [n, null])), ...parseWidths(take('Widths')) };
    }
    return vp;
  }

  #interceptDelete(e, db, hard) {
    if (!db.system || this.#inMetaSync) return undefined;
    if (db.system === 'workspaces') throw new WeaveError('A workspace is deleted from the hub (DELETE /api/workspaces/:id), not as a row', 'invalid');
    if (!['spaces', 'tables', 'fields', 'views'].includes(db.system)) return undefined;
    if (db.system === 'views') {
      const hit = this.#viewAnywhere(e.sysId);
      if (hit) hit.owner.tableView(`${hit.table.id}/${hit.view.id}`, { delete: true });
      else this.#metaSync(() => this.deleteEntity(e.id, { hard: true }));
      return { id: e.id, purged: true };
    }

    if (db.system === 'fields') {
      if (!hard) throw new WeaveError('Deleting a column is not recoverable — pass hard to confirm', 'invalid');
      const hit = this.#fieldAnywhere(e.sysId);
      const owner = hit?.table;
      if (owner && owner.nameFieldId === e.sysId) {
        throw new WeaveError('Cannot delete the Name field', 'invalid');
      }
      if (owner) hit.owner.deleteField(owner.id, e.sysId);
      else this.#metaSync(() => this.deleteEntity(e.id, { hard: true }));
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
      ?? (String(ref) === 'Name' ? db.fields[db.nameFieldId] : undefined);
  }

  getField(dbRef, ref) {
    const db = this.getTable(dbRef);
    const f = this.findField(db, ref);
    if (!f) throw new WeaveError(`Field '${ref}' not found in table '${db.name}'`, 'not-found');
    return f;
  }

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
      field.config = normalizeSelfContainedConfig(type, config, { strict: true });
    } else if (type === 'lookup') {
      const rel = this.getField(db.id, config.relationField ?? config.relation);
      if (rel.type !== 'relation') throw new WeaveError('Lookup must point at a relation field', 'invalid');
      if (rel.config.targetDbs) throw new WeaveError('Lookup needs a single-target relation', 'invalid');
      const target = this.getField(rel.config.targetDb, config.targetField);
      field.config = { relationField: rel.id, targetField: target.id };
    } else if (type === 'rollup') {
      const aggregate = config.aggregate ?? 'count';
      if (!AGGREGATES.includes(aggregate)) throw new WeaveError(`Invalid aggregate '${aggregate}' (use ${AGGREGATES.join(', ')})`, 'invalid');
      if (config.via != null && config.relationField == null && config.relation == null) {
        if (db.system !== 'spaces') throw new WeaveError('A rollup over a whole table lives on the Spaces registry row that holds the table — add it there (config.via names the table)', 'invalid');
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
      Object.assign(field.config, rollupCostume(config));
    } else if (type === 'formula') {
      if (!config.expression) throw new WeaveError('Formula field needs an expression', 'invalid');
      const checked = checkExpression(config.expression, Object.values(db.fields).map((f) => f.name));
      if (!checked.ok) throw new WeaveError(checked.error, 'invalid');
      this.#refuseFormulaCycle(db, field.id, field.name, config.expression);
      field.config = { expression: config.expression, ...formulaCostume(config) };
    }
    if (config.default !== undefined && config.default !== null) {
      field.config.default = this.#validateDefault(field, config.default);
    }
    if (config.width != null) {
      const width = Number(config.width);
      if (!Number.isFinite(width) || width < MIN_COLUMN_WIDTH) {
        throw new WeaveError(`Column width must be a number of at least ${MIN_COLUMN_WIDTH}px`, 'invalid');
      }
      field.config.width = Math.round(width);
    }
    if (config.description != null) {
      const description = fieldDescriptionValue(config.description);
      if (description) field.config.description = description;
    }

    db.fields[field.id] = field;
    placeField(db, field.id);
    this.save();
    this.#syncFieldRow(db, field);
    this.#syncTableRow(db);
    if (!db.system) this.#audit('field-added', { table: db.name, name: field.name, type: field.type }, this.#spacesTouching(db, field));
    return field;
  }

  addRelation(dbRef, { name, targetDb, targetDbs, cardinality = 'many-to-one', inverseName }) {
    const db = this.getTable(dbRef);
    if (!name) throw new WeaveError('Relation field name is required', 'invalid');
    refuseReserved('field', name);
    if (inverseName != null) refuseReserved('field', inverseName);
    if (this.findField(db, name)) throw new WeaveError(`Field '${name}' already exists`, 'conflict');
    const cards = {
      'many-to-one': { thisMany: false, targetMany: true },
      'one-to-many': { thisMany: true, targetMany: false },
      'many-to-many': { thisMany: true, targetMany: true },
      'one-to-one': { thisMany: false, targetMany: false },
    };
    const card = cards[cardinality];
    if (!card) throw new WeaveError(`Invalid cardinality '${cardinality}'`, 'invalid');

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
        if (!db.system) this.#audit('relation-added', { table: db.name, name: a.name, targets: members.map((m) => this.qualifiedName(m)) }, this.#spacesTouching(db, a));
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
    if (!db.system) this.#audit('relation-added', { table: db.name, name: a.name, target: target.name }, this.#spacesTouching(db, a));
    return { field: a, inverse: b };
  }

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

  #updateField(dbRef, fieldRef, patch, undo, restore = null) {
    const db = this.getTable(dbRef);
    const field = this.getField(db.id, fieldRef);
    const before = fieldDefinition(field);
    const touchedBefore = this.#spacesTouching(db, field);
    let renamed = false;
    if (patch.name != null) refuseReserved('field', patch.name);
    if (patch.name != null && patch.name !== field.name) {
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
      migrated = this.#migrateFieldType(db, field, patch.type, patch.config ?? {}, { force: !!undo, restore });
      if (!undo) {
        patch = { ...patch, config: Object.fromEntries(Object.entries(patch.config ?? {}).filter(([k]) => ['width', 'default'].includes(k))) };
        if (!Object.keys(patch.config).length) delete patch.config;
      }
    }
    if (patch.config) {
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
      if ('description' in patch.config && field.type !== 'view') {
        const description = fieldDescriptionValue(patch.config.description);
        if (description) field.config.description = description; else delete field.config.description;
      }
      if (field.type === 'rating' && ('max' in patch.config || 'icon' in patch.config || 'color' in patch.config)) {
        const { max, icon, color } = normalizeSelfContainedConfig('rating', { max: field.config.max, icon: field.config.icon, color: field.config.color, ...patch.config });
        field.config.max = max;
        field.config.icon = icon;
        if (color) field.config.color = color; else delete field.config.color;
        if (typeof field.config.default === 'number') field.config.default = ratingValue(field.config.default, max);
      }
      if (field.type === 'number' || field.type === 'formula') {
        const switched = field.type === 'formula' && 'grain' in patch.config && (patch.config.grain == null) !== (field.config.grain == null);
        const merged = switched ? patch.config : { ...field.config, ...patch.config };
        const costume = field.type === 'formula' ? formulaCostume(merged) : normalizeSelfContainedConfig('number', merged);
        for (const k of field.type === 'formula' ? FORMULA_COSTUME_KEYS : NUMBER_COSTUME_KEYS) {
          if (k in patch.config || k in costume || k in field.config) {
            if (costume[k] == null) delete field.config[k];
            else field.config[k] = costume[k];
          }
        }
      }
      if (field.type === 'rollup' && ROLLUP_COSTUME_KEYS.some((k) => k in patch.config)) {
        const merged = { ...field.config, ...patch.config };
        for (const k of ROLLUP_COSTUME_KEYS) if (merged[k] === null) delete merged[k];
        const costume = rollupCostume(merged);
        for (const k of ROLLUP_COSTUME_KEYS) { if (costume[k] == null) delete field.config[k]; else field.config[k] = costume[k]; }
      }
      if (field.type === 'view') field.config = this.#normalizeViewConfig(db, field, patch.config);
      if (field.type === 'text' && 'literal' in patch.config) {
        if (normalizeSelfContainedConfig('text', patch.config).literal) field.config.literal = true; else delete field.config.literal;
      }
      if (field.type === 'toggle' && ('on' in patch.config || 'off' in patch.config)) {
        const { on, off } = normalizeSelfContainedConfig('toggle', { ...field.config, ...patch.config });
        field.config.on = on;
        field.config.off = off;
      }
      if (field.type === 'attachments' && ['multiple', ...ATTACHMENT_LOOK_KEYS].some((k) => k in patch.config)) {
        const next = normalizeSelfContainedConfig('attachments', { ...field.config, ...patch.config });
        field.config.multiple = next.multiple;
        for (const k of ATTACHMENT_LOOK_KEYS) { if (next[k] == null) delete field.config[k]; else field.config[k] = next[k]; }
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
          const names = Object.values(db.fields).filter((f) => f.id !== field.id).map((f) => f.name);
          const checked = checkExpression(patch.config.expression, names);
          if (!checked.ok) throw new WeaveError(checked.error, 'invalid');
          this.#refuseFormulaCycle(db, field.id, field.name, patch.config.expression);
          field.config.expression = patch.config.expression;
        }
      } else if (field.type === 'workflow') {
        if (patch.config.states) {
          const states = normalizeSelfContainedConfig('workflow', { states: patch.config.states }).states;
          field.config.states = states;
        }
      }
      if ('default' in patch.config) {
        if (patch.config.default === null) delete field.config.default;
        else field.config.default = this.#validateDefault(field, patch.config.default);
      } else if ((field.type === 'select' || field.type === 'multiselect') && patch.config.options && field.config.default != null) {
        const ids = new Set(field.config.options.map((o) => o.id));
        const kept = [].concat(field.config.default).filter((id) => ids.has(id));
        if (!kept.length) delete field.config.default;
        else field.config.default = field.type === 'select' ? kept[0] : kept;
      }
    }
    this.#syncFieldRow(db, field);
    if (renamed) this.#syncTableRow(db);
    const after = fieldDefinition(field);
    const changed = definitionChanges(before, after);
    const logged = !db.system && !this.#fieldLogQuiet && changed.length
      ? { table: this.qualifiedName(db), tableId: db.id, fieldId: field.id, field: field.name, changed, before, after, seq: this.#nextSeq(),
        ...(before.type !== after.type ? { lossy: true } : {}), ...(migrated ? { snapshot: migrated.rows } : {}),
        ...(undo ?? {}), ...(restore && migrated ? migrated.counts : {}) }
      : null;
    this.save();
    if (logged) {
      this.#audit(undo ? 'field-config-undo' : 'field-config-updated', logged, [...touchedBefore, ...this.#spacesTouching(db, field)]);
      if (migrated) this.#dropOlderSnapshots(field.id, logged.seq);
    } else if (!db.system) this.#audit('field-updated', { table: db.name, name: field.name, patch: Object.keys(patch) }, changed.length ? [...touchedBefore, ...this.#spacesTouching(db, field)] : null);
    return { field, counts: migrated?.counts ?? null };
  }

  #dropOlderSnapshots(fieldId, keepSeq) {
    for (const r of this.store.listAudit({ limit: -1, actions: Object.keys(FIELD_CONFIG_ACTIONS) })) {
      const d = r.detail ?? {};
      if (d.fieldId !== fieldId || !d.snapshot || d.seq === keepSeq) continue;
      const { snapshot, ...rest } = d;
      this.store.setAuditDetail(r.seq, { ...rest, snapshotDropped: true });
    }
  }

  static #publicDetail(d) {
    return d?.snapshot ? { ...d, snapshot: { rows: Object.keys(d.snapshot).length } } : d;
  }

  #fieldLogQuiet = false;
  #withoutFieldLog(fn) {
    const was = this.#fieldLogQuiet;
    this.#fieldLogQuiet = true;
    try { return fn(); } finally { this.#fieldLogQuiet = was; }
  }

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

  #rollbackCheck(row, rows) {
    const d = row.detail;
    const db = this.state.tables[d.tableId];
    if (!db || db.deletedAt) return { ok: false, code: 'conflict', reason: `The table ${d.table} is gone or in the trash, so ${d.field} cannot be rolled back.` };
    const field = db.fields[d.fieldId];
    if (!field) return { ok: false, code: 'conflict', reason: `${d.field} has been deleted, so there is nothing to roll back.` };
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
    if (f.type !== 'view') for (const k of Object.keys(now.config)) if (!(k in d.before.config)) patch.config[k] = null;
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

  #formulaCycle(db, fieldId, fieldName, expression) {
    const seen = new Set([fieldId]);
    const walk = (expr, path) => {
      for (const name of formulaReferences(expr)) {
        const f = this.findField(db, name);
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

  checkFormula(dbRef, expression, { entity = null, excludeField = null, scan = false } = {}) {
    const db = this.getTable(dbRef);
    const names = Object.values(db.fields).filter((f) => f.id !== excludeField && f.name !== excludeField).map((f) => f.name);
    const checked = checkExpression(expression, names);
    if (!checked.ok) return checked;
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
      const sent = !!config.options?.length;
      if (sent) options = config.options;
      nextConfig = normalizeSelfContainedConfig(toType, { options }, { strict: sent });
    } else if (toType === 'workflow') {
      const states = (from === 'select' ? field.config.options : []).map((o) => ({ id: o.id, name: o.name, category: 'in-progress', default: o.id === field.config.default }));
      nextConfig = normalizeSelfContainedConfig('workflow', { states: config.states?.length ? config.states : (states.length ? states : undefined) });
    } else if (toType === 'formula') {
      if (!config.expression) throw new WeaveError('Formula field needs an expression', 'invalid');
      const checked = checkExpression(config.expression, Object.values(db.fields).filter((f) => f.id !== field.id).map((f) => f.name));
      if (!checked.ok) throw new WeaveError(checked.error, 'invalid');
      this.#refuseFormulaCycle(db, field.id, field.name, config.expression);
      nextConfig = { expression: config.expression, ...formulaCostume(config) };
    } else {
      nextConfig = normalizeSelfContainedConfig(toType, config);
    }
    const frozen = from === 'formula' ? new Map(rows.map((e) => { const v = this.#resolve(e, db, field, 0); return [e.id, v == null ? null : String(v)]; })) : null;
    const coerce = (raw, e) => {
      if (frozen) return toType === 'text' ? frozen.get(e.id) : null;
      if (toType === 'formula') return null;
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
    const dflt = isBoolType(from) && isBoolType(toType) ? field.config.default : undefined;
    field.config = nextConfig;
    if (dflt !== undefined) field.config.default = dflt;
    if (width) field.config.width = width;
    if (description) field.config.description = description;
    if (term) field.config.term = term;
    if (toType === 'formula' && field.id === db.nameFieldId) for (const e of rows) this.#mark(e);
    if (!db.system) this.#audit('field-migrated', { table: db.name, name: field.name, from, to: toType, rows: rows.length }, db.spaceId);
    return { rows: snapshot, counts };
  }

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
    if (!db.system) this.#audit('field-migrated', { table: db.name, name: field.name, from: 'text', to: 'relation', rows: rows.length, target: target.name }, [db.spaceId, target.spaceId]);
    return { rows: snapshot, counts: null };
  }

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
    if (!db.system) this.#audit('field-migrated', { table: db.name, name: field.name, from: 'relation', to: 'text', rows: rows.length }, db.spaceId);
    return { rows: snapshot, counts };
  }

  deleteField(dbRef, fieldRef) {
    const db = this.getTable(dbRef);
    const field = this.getField(db.id, fieldRef);
    if (field.id === db.nameFieldId) throw new WeaveError('Cannot delete the Name field', 'invalid');
    if (field.type === 'view') throw new WeaveError(`Cannot delete '${field.name}': every row has a ${field.config.shape} by existing — hide it instead`, 'invalid');
    if (field.system) throw new WeaveError(`Field '${field.name}' is part of the system registry`, 'invalid');
    const readers = this.#targetFieldReaders(field.id);
    if (readers.length) {
      throw new WeaveError(`Cannot delete '${field.name}': ${readers.join(', ')} read${readers.length === 1 ? 's' : ''} it — delete ${readers.length === 1 ? 'that field' : 'those fields'} first`, 'invalid');
    }
    const touched = this.#spacesTouching(db, field);
    for (const shape of VIEW_SHAPES) {
      const v = this.viewField(db, shape);
      if (Array.isArray(v?.config.fields) && v.config.fields.includes(field.id)) v.config.fields = v.config.fields.filter((id) => id !== field.id);
    }
    if (field.id === db.descriptionFieldId) db.descriptionFieldId = null;
    if (field.type === 'relation') {
      for (const e of this.listEntities(db.id)) {
        if (e.values[field.id] != null) this.#setRelationValue(e, db, field, []);
      }
      const other = this.state.tables[field.config.targetDb];
      if (other) this.#removeFieldRaw(other, field.config.inverseFieldId);
    }
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
    if (!db.system) this.#audit('field-deleted', { table: db.name, name: field.name }, touched);
    return { id: field.id, name: field.name, db: this.qualifiedName(db), deleted: true };
  }

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

  documentFields(db) {
    return db.fieldOrder.map((id) => db.fields[id]).filter((f) => f.type === 'document');
  }

  #resolveDocField(db, fieldRef = null) {
    if (fieldRef == null) {
      const described = this.descriptionField(db) ?? this.documentFields(db)[0];
      if (!described) throw new WeaveError(`Table '${db.name}' has no document field`, 'not-found');
      return described;
    }
    const f = this.findField(db, fieldRef);
    if (!f || f.type !== 'document') throw new WeaveError(`'${fieldRef}' is not a document field of '${db.name}'`, 'invalid');
    return f;
  }

  listEntities(dbId, { includeDeleted = false } = {}) {
    return Object.values(this.state.entities)
      .filter((e) => e.dbId === dbId && (includeDeleted || !e.deletedAt));
  }

  #liveRowCounts() {
    const counts = new Map();
    for (const e of Object.values(this.state.entities)) {
      if (e.deletedAt) continue;
      counts.set(e.dbId, (counts.get(e.dbId) ?? 0) + 1);
    }
    return counts;
  }

  listTrash(dbRef = null) {
    const dbId = dbRef == null ? null : this.getTable(dbRef).id;
    return Object.values(this.state.entities)
      .filter((e) => e.deletedAt && (dbId == null || e.dbId === dbId))
      .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
      .map((e) => this.readEntity(e.id));
  }

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
    const m = /^(.+)#(\d+)$/.exec(String(id));
    if (m && this.findTable(m[1])) {
      const found = this.findEntity(m[1], '#' + m[2]);
      if (found) return found;
      const dbId = this.findTable(m[1]).id;
      const trashed = this.listEntities(dbId, { includeDeleted: true }).find((x) => x.deletedAt && x.publicId === Number(m[2]));
      if (trashed) return trashed;
    }
    throw new WeaveError(`Entity '${id}' not found`, 'not-found');
  }

  findEntity(dbRef, ref) {
    if (ref && typeof ref === 'object') ref = ref.id;
    if (own(this.state.entities, ref)) return this.state.entities[ref];
    const db = this.getTable(dbRef);
    const list = this.listEntities(db.id);
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
      const v = this.#resolve(e, db, f, 0);
      return v == null ? '' : String(v);
    }
    return String(e.values[db.nameFieldId] ?? '');
  }

  createEntity(dbRef, input = {}, { depth = 0 } = {}) {
    const db = this.getTable(dbRef);
    const meta = this.#interceptCreate(db, input);
    if (meta) return meta;
    const flat = Object.fromEntries(
      Object.entries(input).filter(([k]) => !CREATE_INPUT_KEYS.has(k)));
    const values = { ...flat, ...(input.values ?? {}) };
    const nameField = db.fields[db.nameFieldId];
    if (nameField?.type === 'formula') {
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
    if (input.doc) {
      const f = this.#resolveDocField(db);
      e.docs[f.id] = String(input.doc);
    }
    for (const [fieldName, md] of Object.entries(input.docs ?? {})) {
      const f = this.#resolveDocField(db, fieldName);
      e.docs[f.id] = String(md);
    }
    const named = new Set();
    for (const key of Object.keys(values)) {
      const f = this.findField(db, key);
      if (f) named.add(f.id);
    }
    for (const f of Object.values(db.fields)) {
      if (named.has(f.id)) continue;
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
      for (const field of Object.values(db.fields)) {
        if (field.type === 'relation' && e.values[field.id] != null) {
          this.#setRelationValue(e, db, field, []);
        }
      }
      delete this.state.entities[e.id];
      db.publicIdCounter--;
      throw err;
    }
    this.#recordUndo('create', e);
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

  #validateDefault(field, raw) {
    if (!DEFAULTABLE_TYPES.includes(field.type)) {
      throw new WeaveError(`A ${field.type} field cannot carry a default value`, 'invalid');
    }
    if (field.type === 'date' && DYNAMIC_DATE_DEFAULTS.includes(String(raw).trim())) return String(raw).trim();
    return this.#validateValue(field, raw);
  }

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
        return normalizeDefinition(raw, field.config.depth ?? 1, { strict: !this.#inMetaSync });
      case 'key':
        return String(raw);
      case 'attachments': {
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

    if (!field.config.inverseFieldId) {
      for (const rid of added) this.#mark(this.getEntity(rid));
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

  deleteEntity(ref, { hard = false } = {}) {
    const e = this.getEntity(ref);
    const id = e.id;
    {
      const db = this.state.tables[e.dbId];
      const meta = this.#interceptDelete(e, db, hard);
      if (meta) return meta;
    }
    const db = this.state.tables[e.dbId];
    if (!hard) {
      if (e.deletedAt) return this.readEntity(id);
      e.deletedAt = nowISO();
      e.updatedAt = e.deletedAt;
      this.#logActivity(e, 'deleted', {}, { ts: e.deletedAt });
      this.#recordUndo('delete', e);
      this.#mark(e);
      this.save();
      return this.readEntity(id);
    }
    for (const field of Object.values(db.fields)) {
      if (field.type === 'relation' && e.values[field.id] != null) {
        this.#setRelationValue(e, db, field, []);
      }
    }
    delete this.state.entities[id];
    this.store.deleteDocRevisions(id);
    this.#mark(id);
    this.save();
    return { id, purged: true };
  }

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
      if (COMPUTED_TYPES.includes(f.type)) continue;
      const raw = f.type === 'document' ? (e.docs[f.id] ?? '') : e.values[f.id];
      if (raw == null || raw === '' || raw === false || (Array.isArray(raw) && !raw.length)) continue;
      const tf = Object.values(to.fields).find((x) => x.name === f.name && x.type === f.type);
      if (!tf) { skipped.push(f.name); continue; }
      try {
        if (f.type === 'document') { docs[tf.name] = raw; continue; }
        const v = this.#portable(e, f);
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

  #resolve(e, db, field, depth) {
    if (depth > MAX_COMPUTE_DEPTH) return null;
    if (field.type !== 'formula' && field.type !== 'lookup' && field.type !== 'rollup') {
      return this.#resolveValue(e, db, field, depth);
    }
    const key = `${e.id}:${field.id}`;
    const frame = { key, name: field.name, row: e.id, rowName: this.#rawName(e, db) };
    const at = this.#computing.findIndex((c) => c.key === key);
    if (at >= 0) {
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

  #rawName(e, db) {
    const raw = e.values?.[db?.nameFieldId];
    return raw == null ? '' : String(raw);
  }

  #resolveValue(e, db, field, depth) {
    switch (field.type) {
      case 'relation':
        return this.#relationIds(e, field).filter((id) => this.#liveEntity(id));
      case 'lookup': {
        const rel = db.fields[field.config.relationField];
        const targetDb = rel && this.state.tables[rel.config.targetDb];
        const targetField = targetDb?.fields[field.config.targetField];
        if (!targetField) return null;
        const vals = this.#relationIds(e, rel)
          .map((id) => this.#liveEntity(id))
          .filter(Boolean)
          .map((t) => this.#resolve(t, targetDb, targetField, depth + 1));
        const looped = vals.find(isCycle);
        if (looped) return looped;
        return rel.config.many ? vals : (vals[0] ?? null);
      }
      case 'rollup': {
        const { targetDb, targetField, owner } = this.#rollupTarget(db, field);
        if (!targetDb) return null;
        let rows;
        if (field.config.via) {
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
        const ticks = isBoolType(targetField.type) && NUMERIC_AGGREGATES.includes(field.config.aggregate);
        const vals = rows.map((t) => this.#resolve(t, targetDb, targetField, depth + 1)).map((v) => (ticks && !isCycle(v) ? (v ? 1 : 0) : v));
        const looped = vals.find(isCycle);
        if (looped) return looped;
        const display = ['distinct', 'join'].includes(field.config.aggregate)
          ? rows.map((t, i) => this.#displayValue(targetDb, targetField, vals[i], t)) : null;
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
            if (isCycle(v)) throw new CycleSignal(v);
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
        const v = e.values[field.id];
        return typeof v === 'number' ? Math.min(v, field.config.max) : null;
      }
      default:
        return e.values[field.id] ?? (isBoolType(field.type) ? false : null);
    }
  }

  #displayValue(db, field, resolved, e = null) {
    if (resolved == null) return null;
    if (isCycle(resolved)) return resolved;
    switch (field.type) {
      case 'select':
        return this.#findOption(field.config.options, resolved)?.name ?? resolved;
      case 'multiselect':
        return resolved.map((id) => this.#findOption(field.config.options, id)?.name ?? id);
      case 'workflow':
        return field.config.states.find((s) => s.id === resolved)?.name ?? resolved;
      case 'field': {
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
        const { keystore } = this.credentialConfig(field);
        const unset = keystore === 'local' && !this.hasKey(resolved) ? ' (unset)' : '';
        return `✱✱✱✱ ${resolved}${unset}`;
      }
      case 'attachments': {
        if (!Array.isArray(resolved) || !resolved.length) return null;
        const names = resolved.map((id) => {
          const f = e?.files?.find((x) => x.id === id);
          if (!f) return '(missing)';
          return this.#hasBlob(id) ? f.name : `${f.name} (missing)`;
        });
        return names.join(', ');
      }
      case 'date': {
        return dressDate({ ...field.config, now: this.now(), viewerZone: this.viewerZone ?? 'UTC' }, resolved);
      }
      case 'daterange':
        return dressDateRange({ ...field.config, now: this.now(), viewerZone: this.viewerZone ?? 'UTC' }, resolved);
      case 'number':
        return dressNumber(field.config, resolved);
      case 'formula':
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
        const far = this.#lookupRelation(db, field, resolved);
        if (far) {
          const names = far.ids.map((id) => this.entityName(this.state.entities[id]));
          return far.many ? names : (names[0] ?? null);
        }
        const rel = db.fields[field.config.relationField];
        const targetDb = rel && this.state.tables[rel.config.targetDb];
        const target = targetDb?.fields[field.config.targetField];
        if (!['select', 'multiselect', 'workflow'].includes(target?.type)) return resolved;
        const dress = (v) => this.#displayValue(targetDb, target, v);
        return rel.config.many ? resolved.map(dress) : dress(resolved);
      }
      case 'rollup': {
        const { targetField } = this.#rollupTarget(db, field);
        const agg = field.config.aggregate;
        if (typeof resolved === 'number' && ROLLUP_COSTUME_KEYS.some((k) => field.config[k] != null)) {
          const c = Object.fromEntries(ROLLUP_COSTUME_KEYS.filter((k) => field.config[k] != null).map((k) => [k, field.config[k]]));
          const fractional = !Number.isInteger(resolved) && c.decimals == null && c.format !== 'currency' && c.format !== 'percent';
          return dressNumber(fractional ? { ...c, decimals: 2 } : c, resolved);
        }
        if (!targetField || !NUMERIC_AGGREGATES.includes(agg)) return resolved;
        if (typeof resolved === 'number' && (targetField.type === 'number' || targetField.type === 'formula')) {
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

  #lookupRelation(db, field, resolved) {
    if (field.type !== 'lookup') return null;
    const rel = db.fields[field.config.relationField];
    const target = rel && this.state.tables[rel.config.targetDb]?.fields[field.config.targetField];
    if (target?.type !== 'relation') return null;
    const lists = rel.config.many ? resolved : [resolved];
    const ids = Array.isArray(lists) ? lists.flat().filter((id) => typeof id === 'string' && !isCycle(id)) : [];
    return { ids: [...new Set(ids)], many: !!(rel.config.many || target.config.many) };
  }

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

  tableRollups(dbRef, { field = null } = {}) {
    const db = this.getTable(dbRef);
    const under = field == null ? null : this.getField(db.id, field);
    const spacesT = this.#sysTable('spaces');
    const row = spacesT && this.#sysRow('spaces', db.spaceId);
    if (!row) return [];
    const out = [];
    const reg = this.#reg;
    for (const fid of spacesT.fieldOrder) {
      const f = spacesT.fields[fid];
      if (f?.type !== 'rollup' || f.config.via !== db.id) continue;
      if (under && (f.config.targetField ?? db.nameFieldId) !== under.id) continue;
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

  tableStats(dbRef, { by = null, where = null, field = null } = {}) {
    const db = this.getTable(dbRef);
    const only = field == null ? null : this.getField(db.id, field);
    let rows = this.listEntities(db.id);
    if (where && (Array.isArray(where) ? where.length : true)) {
      this.#checkWhere(db, where);
      rows = rows.filter((r) => this.#matchNode(r, db, Array.isArray(where) ? { and: where } : where));
    }
    const SKIP = new Set(['view', 'document', 'attachments', 'key', 'field']);
    const fields = db.fieldOrder.map((id) => db.fields[id]).filter((f) => f && !SKIP.has(f.type) && (!only || f.id === only.id));
    const isBlank = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
    const read = (f) => rows.map((e) => this.#resolve(e, db, f, 0));
    const dressAll = (f, vals) => rows.map((e, i) => this.#displayValue(db, f, vals[i], e));
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
      const vals = read(f);
      const kind = kindOf(f, vals);
      const col = { id: f.id, name: f.name, type: f.type, kind, filled: vals.filter((v) => !isBlank(v)).length, empty: vals.filter(isBlank).length };
      if (kind === 'number') {
        col.summary = describeNumbers(vals);
        col.display = Object.fromEntries(Object.entries(col.summary).map(([k, v]) => [k, k === 'n' ? String(v) : dress(f, v)]));
        col.histogram = histogram(vals, 10).map((b) => ({ ...b, fromDisplay: dress(f, b.from), toDisplay: dress(f, b.to) }));
      } else if (kind === 'category') {
        col.distribution = distribution(dressAll(f, vals));
      } else if (kind === 'date') {
        const iso = vals.filter((v) => typeof v === 'string' && v);
        col.earliest = aggregateValues('min', iso);
        col.latest = aggregateValues('max', iso);
        col.earliestDisplay = col.earliest == null ? null : this.#displayValue(db, f, col.earliest);
        col.latestDisplay = col.latest == null ? null : this.#displayValue(db, f, col.latest);
        col.spanDays = col.earliest == null ? null : Math.round((dayOf(col.latest) - dayOf(col.earliest)) / 86400000);
        col.byMonth = distribution(iso.map((v) => v.slice(0, 7)));
      } else {
        col.distinct = aggregateValues('distinct', dressAll(f, vals));
      }
      return col;
    });
    const out = { table: this.qualifiedName(db), rows: rows.length, columns, rollups: this.tableRollups(db.id, { field: only?.id ?? null }) };
    if (by) {
      const byF = this.getField(db.id, by);
      const keys = dressAll(byF, read(byF));
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

  readEntity(id, { viewerZone = null } = {}) {
    if (viewerZone == null) return this.#readEntityIn(id);
    const prev = this.viewerZone;
    this.viewerZone = DG.isZone(viewerZone) ? viewerZone : null;
    try { return this.#readEntityIn(id); } finally { this.viewerZone = prev; }
  }
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
    const scales = {};
    for (const fid of db.fieldOrder) {
      if (pick && !pick.ids.has(fid)) continue;
      const f = db.fields[fid];
      if (this.#numberDisplay(db, f)) scales[f.name] = this.#scaleOf(db, f);
    }
    if (pick) {
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
      docField: defaultDocField ? defaultDocField.name : null,
      docs,
      comments: e.comments,
      activity: e.activity,
      activityDropped: e.activityDropped ?? 0,
      files: e.files.map((f) => (this.#hasBlob(f.id) ? f : { ...f, missing: true })),
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

  #numberDisplay(db, f) {
    let c = null;
    if (f.type === 'number' || f.type === 'formula') c = f.config;
    else if (f.type === 'rollup' && f.config.display) c = f.config;
    else if (f.type === 'rollup' && NUMERIC_AGGREGATES.includes(f.config.aggregate)) {
      const { targetField } = this.#rollupTarget(db, f);
      if (targetField && (targetField.type === 'number' || targetField.type === 'formula')) c = targetField.config;
    }
    return c && isGraphicDisplay(c.display) ? { display: c.display, scale: c.scale ?? 'column', color: c.color ?? 'ink' } : null;
  }

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

  #ratingOf(db, f) {
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
    return { id: e.id, publicId: e.publicId, name: this.entityName(e), db: this.qualifiedName(db), ...(db.system ? {} : { chip: this.renderView(e.id, 'chip') }) };
  }

  query(dbRef, { viewerZone = null, ...opts } = {}) {
    if (viewerZone == null) return this.#queryIn(dbRef, opts);
    const prev = this.viewerZone;
    this.viewerZone = DG.isZone(viewerZone) ? viewerZone : null;
    try { return this.#queryIn(dbRef, opts); } finally { this.viewerZone = prev; }
  }
  #queryIn(dbRef, { where = [], sort = [], limit = null, offset = 0, select = null, fields = null, relations = 'full', includeDeleted = false, trashCount = false, countAll = false, search = '' } = {}) {
    const db = this.getTable(dbRef);
    if (fields != null && !Array.isArray(fields)) throw new WeaveError('fields must be a list of field names', 'invalid');
    if (fields && select) throw new WeaveError('Ask for select or fields, not both: select is a flat projection, fields cuts the entity', 'invalid');
    if (relations != null && relations !== 'full' && relations !== 'chip') throw new WeaveError(`relations must be 'full' or 'chip' (got '${relations}')`, 'invalid');
    const pick = fields && { ids: new Set(), activity: false };
    for (const name of fields ?? []) {
      if (name === 'Activity') pick.activity = true;
      const f = this.findField(db, name);
      if (f) pick.ids.add(f.id);
      else if (name !== 'Activity' && !Object.hasOwn(SYSTEM_SORT_KEYS, name)) this.getField(db.id, name);
    }
    const chips = relations === 'chip' && !select ? Object.create(null) : null;
    let rows = this.listEntities(db.id, { includeDeleted });
    const all = countAll ? (includeDeleted ? this.listEntities(db.id).length : rows.length) : null;
    if (String(search ?? '').trim()) {
      const hit = new Set(this.#searchHits(search, db.id).map((h) => h.e.id));
      rows = rows.filter((e) => hit.has(e.id));
    }
    const trashed = trashCount
      ? this.listEntities(db.id, { includeDeleted: true }).filter((e) => e.deletedAt).length
      : null;
    if (where && (Array.isArray(where) ? where.length : true)) {
      rows = rows.filter((e) => this.#matchNode(e, db, Array.isArray(where) ? { and: where } : where));
    }
    for (const s of [...sort].reverse()) {
      const { field, dir = 'asc' } = typeof s === 'string' ? { field: s } : s;
      const mul = dir === 'desc' ? -1 : 1;
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

  #pathValue(e, db, path, { undressed = false, numbers = false } = {}) {
    const parts = String(path).split('.');
    let current = [{ e, db }];
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const next = [];
      const results = [];
      for (const { e: ce, db: cdb } of current) {
        if (parts[i] === 'id') { results.push(ce.id); continue; }
        if (parts[i] === 'publicId' || parts[i] === 'Public Id') { results.push(ce.publicId); continue; }
        if (parts[i] === 'createdAt') { results.push(ce.createdAt); continue; }
        if (parts[i] === 'updatedAt') { results.push(ce.updatedAt); continue; }
        const f = this.findField(cdb, parts[i]);
        if (!f && Object.hasOwn(SYSTEM_SORT_KEYS, parts[i])) { results.push(ce[SYSTEM_SORT_KEYS[parts[i]]] ?? null); continue; }
        if (!f) throw new WeaveError(`Field '${parts[i]}' not found in table '${cdb.name}'`, 'not-found');
        let resolved = this.#resolve(ce, cdb, f, 0);
        if (isLast && f.type === 'formula' && f.config.display === 'sparkline' && Array.isArray(resolved)) resolved = lastNumber(resolved);
        if (isLast) {
          results.push((undressed || numbers) && typeof resolved === 'number' ? resolved
            : undressed && f.type === 'date' ? resolved
            : undressed && f.type === 'daterange' ? DG.rangeKey(resolved)
            : undressed && (f.type === 'select' || f.type === 'workflow') ? this.#definitionRank(f, resolved)
            : this.#displayValue(cdb, f, resolved, ce));
        } else {
          if (f.type !== 'relation') throw new WeaveError(`'${parts[i]}' is not a relation; cannot traverse`, 'invalid');
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

  getDoc(entityId, fieldRef = null) {
    const e = this.getEntity(entityId);
    const db = this.state.tables[e.dbId];
    const f = this.#resolveDocField(db, fieldRef);
    return e.docs?.[f.id] ?? '';
  }

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
    if (before === after) return e;
    const prior = { at: e.updatedAt, by: e.modifiedBy };
    e.docs[f.id] = after;
    e.updatedAt = nowISO();
    e.modifiedBy = this.actor;
    const r = this.#restoring;
    this.#logActivity(e, 'doc-updated', r ? { ...docChange(f.name, before, after), restoredFrom: r.seq, restoredAt: r.at, restoredBy: r.actor ?? null }
      : docChange(f.name, before, after));
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

  #docRevisionFresh = false;
  #restoring = null;

  #recordDocRevision(e, f, before, after, { prior = null, fresh = false } = {}) {
    if (this.#inMetaSync) return;
    const db = this.state.tables[e.dbId];
    if (!db || db.system) return;
    const now = nowISO();
    const [latest] = this.store.listDocRevisions(e.id, f.id, { limit: 1 });
    if (!latest && before) {
      this.store.pushDocRevision({ entityId: e.id, fieldId: f.id, at: prior?.at ?? now, actor: prior?.by ?? null, text: before });
    } else if (latest && !fresh && !this.#docRevisionFresh && latest.actor === this.actor
      && latest.restoredFrom == null
      && Date.now() - Date.parse(latest.at) < this.revisionWindowMs) {
      this.store.replaceDocRevision(latest.seq, { at: now, text: after });
      return;
    }
    this.store.pushDocRevision({ entityId: e.id, fieldId: f.id, at: now, actor: this.actor, text: after, restoredFrom: this.#restoring?.seq ?? null });
  }

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

  restoreDocRevision(entityId, fieldRef, seq) {
    const rev = this.getDocRevision(entityId, fieldRef, seq);
    const changed = this.getDoc(entityId, fieldRef) !== rev.text;
    this.#docRevisionFresh = true;
    this.#restoring = rev;
    try { this.setDoc(entityId, rev.text, fieldRef); } finally { this.#docRevisionFresh = false; this.#restoring = null; }
    const e = this.getEntity(entityId);
    const f = this.#resolveDocField(this.state.tables[e.dbId], fieldRef);
    return { ok: true, changed, field: f.name, seq: rev.seq, at: rev.at, length: rev.text.length };
  }

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

  activityFeed({ entityId = null, tableRef = null, kinds = null, since = null, limit = null, offset = 0 } = {}) {
    const wanted = kinds?.length ? new Set(kinds) : null;
    const dbId = tableRef ? this.getTable(tableRef).id : null;
    const tableOnly = entityId && own(this.state.tables, entityId) ? entityId : null;
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
    rows.sort((x, y) => {
      const xs = x.seq ?? Infinity, ys = y.seq ?? Infinity;
      if (xs !== ys) return ys - xs;
      return x.ts < y.ts ? 1 : (x.ts > y.ts ? -1 : 0);
    });
    return {
      total: rows.length,
      dropped,
      items: limit == null ? rows.slice(offset) : rows.slice(offset, offset + limit),
    };
  }

  getActivity(id) {
    const at = String(id).lastIndexOf(':');
    const entityId = String(id).slice(0, at);
    if (String(id).slice(at + 1).startsWith('f')) {
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

  #nextSeq() {
    this.state.meta.activitySeq = (this.state.meta.activitySeq ?? 0) + 1;
    return this.state.meta.activitySeq;
  }

  #logActivity(e, kind, detail, { ts = null } = {}) {
    const last = e.activity[e.activity.length - 1];
    if (kind === 'doc-updated' && last?.kind === 'doc-updated'
      && last.detail?.field === detail.field && last.actor === this.actor
      && detail.restoredFrom == null && last.detail?.restoredFrom == null
      && Date.now() - Date.parse(last.ts) < 10 * 60 * 1000) {
      last.ts = nowISO();
      last.detail = { ...detail, prevLength: last.detail.prevLength, delta: detail.length - last.detail.prevLength };
      this.#mark(e);
      return;
    }
    e.activity.push({ ts: ts ?? nowISO(), kind, detail, actor: this.actor, seq: this.#nextSeq() });
    if (e.activity.length > ACTIVITY_CAP) {
      e.activityDropped = (e.activityDropped ?? 0) + e.activity.length - ACTIVITY_CAP;
      e.activity = e.activity.slice(-ACTIVITY_CAP);
    }
    this.#mark(e);
  }

  #stamping = false;
  #wfQueue = new Set();
  #wfEpoch = 0;
  #wfRows = null;
  #wfRules = null;
  #noWebhooks = false;
  #wfRun = new Map();
  webhookTimeoutMs = 5000;

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

  #asReg(fn) {
    const reg = this.#reg;
    if (reg === this) return fn();
    const was = reg.actor;
    reg.actor = this.actor;
    try { return fn(); } finally { reg.actor = was; }
  }

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
      if (a?.type === 'add-comment') return { type: 'add-comment', text: String(a.text ?? ''), ...(a.author && a.author !== 'automation' ? { author: a.author } : {}) };
      if (a?.type === 'webhook') {
        if (!/^https?:\/\//.test(a.url ?? '')) throw new WeaveError('Webhook action needs an http(s) url', 'invalid');
        return { type: 'webhook', url: a.url };
      }
      throw new WeaveError(`Unknown automation action '${a?.type}'`, 'invalid');
    });
    if (!acts.length) throw new WeaveError('Automation needs at least one action', 'invalid');
    return { dbId: db.id, trigger: t, actions: acts };
  }

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
        if (a.type === 'add-comment') return { type: a.type, text: a.text, ...(a.author ? { author: a.author } : {}) };
        return { type: a.type, url: a.url };
      });
      return { table: this.qualifiedName(db), trigger, actions };
    } catch { return null; }
  }

  #workflowRows() {
    const t = this.#sysTable('workflows');
    if (!t) return [];
    if (this.#wfRows?.state !== this.state || this.#wfRows.epoch !== this.#wfEpoch || this.#wfRows.table !== t) {
      const rows = Object.values(this.state.entities).filter((e) => e.dbId === t.id).sort((a, b) => a.publicId - b.publicId);
      this.#wfRows = { state: this.state, epoch: this.#wfEpoch, table: t, rows };
    }
    return this.#wfRows.rows.filter((e) => this.state.entities[e.id] === e && !e.deletedAt);
  }

  #workflowHome(row) {
    const wsId = this.#wsIdOfRow(row);
    if (!wsId) return this;
    return this.#engines().find((w) => w.state.meta.id === wsId);
  }

  #wfField(name) { return this.#sysField(this.#sysTable('workflows'), name); }

  #workflowRule(row, text = row.docs?.[this.#wfField('Script').id] ?? '') {
    const owner = this.#workflowHome(row);
    if (!owner) return null;
    try {
      const src = String(text).trim();
      if (!src) throw new WeaveError('The Script is empty: write the rule as JSON {"table", "trigger", "actions"}', 'invalid');
      let spec;
      try { spec = JSON.parse(src); } catch (err) { throw new WeaveError(`The Script is not JSON: ${err.message}`, 'invalid'); }
      let w = owner;
      if (spec?.table != null && !owner.findTable(spec.table)) w = this.#engines().find((x) => x.findTable(spec.table)) ?? owner;
      return { row, owner: w, ...w.#compileSpec(spec), problem: null };
    } catch (err) {
      return { row, owner, dbId: null, trigger: null, actions: [], problem: err.message };
    }
  }

  #allRules() {
    const rows = this.#workflowRows();
    if (!rows.length) return [];
    const engines = this.#engines();
    const key = [this.state, this.#wfEpoch, ...engines.flatMap((w) => [w, w.schemaVersion()])];
    const c = this.#wfRules;
    if (c && c.key.length === key.length && c.key.every((k, i) => k === key[i])) return c.rules;
    const schemaMoved = !c || c.key.length !== key.length || c.key.some((k, i) => i !== 1 && k !== key[i]);
    const rules = rows.map((row) => (schemaMoved ? this.#settleWorkflow(row) : this.#workflowRule(row))).filter(Boolean);
    this.#wfRules = { key: [this.state, this.#wfEpoch, ...engines.flatMap((w) => [w, w.schemaVersion()])], rules };
    if (this.#stampDirty) { this.#stampDirty = false; this.save(); }
    return rules;
  }

  #settleWorkflows() {
    if (!this.#sysTable('workflows')) return;
    this.#wfRules = null;
    this.#allRules();
  }
  #stampDirty = false;

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

  #settleWorkflow(row) {
    const F = (n) => this.#wfField(n);
    const script = F('Script');
    let rule = this.#workflowRule(row);
    if (!rule) return null;
    const text = row.docs?.[script.id] ?? '';
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

  #stampRun(row, failure) {
    const health = this.#wfField('Health');
    const reasonF = this.#wfField('Health Reason');
    this.#stamp(row, () => {
      row.values[this.#wfField('Last Run').id] = nowISO();
      this.#setOption(row, health, failure ? 'Failed' : 'Healthy');
      row.values[reasonF.id] = failure ?? null;
    });
  }

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

  #myRules() { return this.#reg.#allRules().filter((r) => r.owner === this); }

  listAutomations(dbRef = null) {
    const mine = this.#myRules();
    const db = dbRef ? this.getTable(dbRef) : null;
    return mine.filter((r) => !db || r.dbId === db.id).map((r) => this.#ruleOut(r));
  }

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
          if (a.type === 'append-doc') return { type: a.type, field: a.fieldId ? fieldName(a.fieldId) : (db ? this.descriptionField(db)?.name ?? null : null) };
          if (a.type === 'webhook') return { type: a.type, url: a.url };
          return { type: a.type };
        }),
      };
    });
  }

  #myRow(id) {
    const r = this.#myRules().find((x) => x.row.id === id);
    if (r) return r.row;
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

  deleteAutomation(id) {
    const row = this.#myRow(id);
    if (!row || row.deletedAt) return { id, deleted: false };
    const r = this.#myRules().find((x) => x.row === row);
    const db = r?.dbId ? this.state.tables[r.dbId] : null;
    this.#asReg(() => this.#reg.deleteEntity(row.id));
    if (!db?.system) this.#audit('automation-deleted', { table: db?.name ?? null, name: this.#reg.entityName(row) });
    return { id, deleted: true };
  }

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
      const run = { failed: false };
      reg.#wfRun.set(rule.row.id, run);
      const person = this.actor;
      this.actor = workflowActor(rule.row.id);
      try {
        for (const action of rule.actions) this.#runAction(rule, name, action, db, e, event, depth, run);
      } catch (err) {
        failure = err.message;
        run.failed = true;
      } finally {
        this.actor = person;
      }
      this.#logActivity(e, 'automation-ran', { name, workflow: rule.row.id });
      reg.#stampRun(rule.row, failure);
      if (reg !== this) reg.save();
    }
  }

  #runAction(rule, name, action, db, e, event, depth, run) {
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
        const before = e.docs[docField.id] ?? '';
        const after = (before ? before.replace(/\n*$/, '\n\n') : '') + this.#template(action.text, e, db);
        const prior = { at: e.updatedAt, by: e.modifiedBy };
        this.#recordUndo('update', e, { before: { values: {}, docs: { [docField.id]: before } } });
        e.docs[docField.id] = after;
        e.updatedAt = nowISO();
        e.modifiedBy = this.actor;
        this.#logActivity(e, 'doc-appended', docChange(docField.name, before, after));
        this.#recordDocRevision(e, docField, before, after, { prior });
      }
    } else if (action.type === 'add-comment') {
      const comment = { id: uuid(), author: action.author ?? this.actor, text: this.#template(action.text, e, db), createdAt: nowISO() };
      e.comments.push(comment);
      this.#recordUndo('comment-add', e, { commentId: comment.id });
    } else if (action.type === 'webhook') {
      if (this.#noWebhooks) return;
      const payload = {
        event: event.type,
        workspace: this.state.meta.name,
        entity: this.#summary(e.id),
        automation: name,
        at: nowISO(),
      };
      const reg = this.#reg;
      const ms = this.webhookTimeoutMs;
      fetch(action.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(ms),
      }).then((res) => {
        res.body?.cancel().catch(() => {});
        return res.ok ? null : `HTTP ${res.status}`;
      }, (err) => (err?.name === 'TimeoutError' ? `timed out after ${ms / 1000} s` : err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(err)))
        .then((why) => { if (why) reg.#webhookFailed(rule.row.id, run, `POST ${new URL(action.url).host}: ${why}`); })
        .catch(() => {});
    }
  }

  #webhookFailed(id, run, reason) {
    if (this.#wfRun.get(id) !== run || run.failed) return;
    run.failed = true;
    const row = own(this.state.entities, id);
    if (!row || row.deletedAt) return;
    this.#stamp(row, () => {
      this.#setOption(row, this.#wfField('Health'), 'Failed');
      row.values[this.#wfField('Health Reason').id] = reason;
    });
    this.save();
  }

  #template(text, e, db) {
    return text.replace(/\{\{([^}]+)\}\}/g, (_, name) => {
      const key = name.trim();
      if (key === 'PublicId') return String(e.publicId);
      if (key === 'Today' || key === 'Today:iso') {
        const iso = this.now().toISOString().slice(0, 10);
        return key === 'Today' ? dressDate({ now: this.now(), viewerZone: this.viewerZone ?? 'UTC' }, iso) : iso;
      }
      const f = this.findField(db, key);
      if (!f) return '';
      const v = this.#displayValue(db, f, this.#resolve(e, db, f, 0), e);
      const s = v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
      return s === '' ? `(no ${f.name})` : s;
    });
  }

  search(text, { limit = 25, table = null } = {}) {
    const scope = table == null ? null : this.getTable(table).id;
    return this.#searchHits(text, scope)
      .map(({ e, score, snippet }) => ({ ...this.#summary(e.id), score, snippet }))
      .sort((a, b) => b.score - a.score).slice(0, limit);
  }

  #searchHits(text, dbId = null) {
    const needle = String(text ?? '').toLowerCase().trim();
    if (!needle) return [];
    const idm = /^(.*?)#\s*(\d+)$/.exec(needle) ?? /^()(\d+)$/.exec(needle);
    const idNum = idm ? Number(idm[2]) : null;
    const idTable = idm ? idm[1].trim() : '';
    const results = [];
    for (const e of dbId ? this.listEntities(dbId) : Object.values(this.state.entities)) {
      if (e.deletedAt) continue;
      const home = this.state.tables[e.dbId];
      if (!home || home.deletedAt || this.state.spaces[home.spaceId]?.deletedAt) continue;
      const name = this.entityName(e);
      const docText = Object.values(e.docs ?? {}).join('\n');
      const comments = e.comments.map((c) => c.text).join('\n');
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

  universalSearch(text, { limit = 25, prefix = '', tables = null } = {}) {
    if (tables != null) return this.#scopedSearch(text, { limit, prefix, tables });
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
    let tableCounts = null;
    for (const db of this.listTables()) {
      if (db.name.toLowerCase().includes(needle) || this.qualifiedName(db).toLowerCase().includes(needle)) {
        tableCounts ??= this.#liveRowCounts();
        results.push({
          kind: 'table', id: db.id, name: this.qualifiedName(db),
          url: `${prefix}/#/table/${db.id}`, entityCount: tableCounts.get(db.id) ?? 0, score: 9,
        });
      }
    }
    for (const v of this.listViews()) {
      if (v.name.toLowerCase().includes(needle)) {
        results.push({ kind: 'view', id: v.id, name: v.name, url: `${prefix}/#/view/${v.id}`, score: 8 });
      }
    }
    const rows = this.#searchHits(text)
      .filter(({ e }) => !REGISTRY_HITS.has(this.state.tables[e.dbId]?.system))
      .sort((a, b) => b.score - a.score).slice(0, limit);
    for (const { e, score, snippet } of rows) {
      results.push({ kind: 'entity', url: `${prefix}/e/${e.id}`, ...this.#summary(e.id), score, snippet });
    }
    return Weave.capRows(results, limit);
  }

  #scopedSearch(text, { limit, prefix, tables }) {
    const ids = [...new Set((Array.isArray(tables) ? tables : [tables]).map((t) => this.getTable(t).id))];
    const hit = (e, score = 0, snippet = '') => ({ kind: 'entity', url: `${prefix}/e/${e.id}`, ...this.#summary(e.id), score, snippet });
    if (!String(text ?? '').trim()) {
      return ids.flatMap((id) => this.listEntities(id))
        .filter((e) => !e.deletedAt)
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
        .slice(0, limit)
        .map((e) => hit(e));
    }
    return ids.flatMap((id) => this.#searchHits(text, id))
      .sort((a, b) => b.score - a.score).slice(0, limit)
      .map(({ e, score, snippet }) => hit(e, score, snippet));
  }

  static capRows(hits, limit) {
    const tier = (h) => (h.kind !== 'entity' ? 1 : h.score >= 20 ? 2 : 0);
    let rows = 0;
    return [...hits].sort((a, b) => tier(b) - tier(a) || b.score - a.score)
      .filter((h) => h.kind !== 'entity' || rows++ < limit);
  }

  previewFields(entityRef, limit = 3) {
    const v = this.renderView(entityRef, 'chip', { limit });
    return [
      ...(v.state ? [{ label: this.#stateLabel(v), value: v.state.name }] : []),
      ...v.fields.map((f) => ({ label: f.label, value: f.value })),
    ].slice(0, limit);
  }

  #stateLabel(v) {
    const db = this.state.tables[this.getEntity(v.id).dbId];
    return Object.values(db.fields).find((f) => f.type === 'workflow')?.name ?? 'State';
  }

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

  referencesFrom(entityRef) {
    const e = this.getEntity(entityRef);
    const text = Object.values(e.docs ?? {}).filter(Boolean).join('\n');
    const ids = new Set();
    const add = (id) => {
      const t = own(this.state.entities, id);
      if (t && !t.deletedAt && t.id !== e.id) ids.add(t.id);
    };
    for (const m of text.matchAll(/\[\[\s*([^\][|#\n]+?)\s*#(\d+)\s*(?:\|[^\]]*)?\]\]/g)) {
      try { add(this.getEntity(`${m[1].trim()}#${m[2]}`).id); } catch {}
    }
    const uuidPat = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    for (const m of text.matchAll(new RegExp(`\\[\\[\\s*(${uuidPat.source})\\s*(?:\\|[^\\]]*)?\\]\\]`, 'gi'))) add(m[1].toLowerCase());
    for (const m of text.matchAll(new RegExp(`/e/(${uuidPat.source})(?=[/#?"')\\s]|$)`, 'gi'))) add(m[1].toLowerCase());
    return [...ids].map((id) => this.#summary(id))
      .sort((a, b) => a.db.localeCompare(b.db) || a.publicId - b.publicId);
  }

  storageStats() {
    let entities = 0;
    let fileBytes = 0;
    for (const e of Object.values(this.state.entities)) {
      if (!e.deletedAt) entities += 1;
      for (const f of e.files ?? []) fileBytes += f.size ?? 0;
    }
    return { entities, sizeBytes: (this.store.sizeBytes?.() ?? 0) + fileBytes };
  }

  #blobPath(id) {
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

  setWorkspaceLogo({ name, bytes }) {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'base64');
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

  spaceVersions() {
    const { counts } = this.#schemaHistory();
    return { etag: ontologyEtag(counts), spaces: this.listSpaces().map((s) => ({ id: s.id, name: s.name, version: counts.get(s.id) ?? 0 })) };
  }

  ontology({ depth = 'outline', concept = null, since = null } = {}) {
    if ((depth ?? 'outline') !== 'outline') throw new WeaveError(`depth is "outline"; read one table in full with concept (got ${JSON.stringify(depth)})`, 'invalid');
    const { counts, seen } = this.#schemaHistory();
    if (concept != null && concept !== '') return this.#ontologyConcept(this.getTable(concept), counts);
    const etag = ontologyEtag(counts);
    const spaces = this.listSpaces();
    const label = this.#ontologyLabel();
    const block = (sp) => (sp.system
      ? [`${sp.name} (system registry, read one with concept): ${this.listTables(sp.id).map((db) => db.name).join(', ')}`]
      : [`${sp.name} v${counts.get(sp.id) ?? 0}:`, ...this.listTables(sp.id).map((db) => `  ${db.name}: ${this.#ontologyFields(db, label).join('; ') || '-'}`)]);
    const tables = spaces.reduce((n, sp) => n + this.listTables(sp.id).length, 0);
    const outline = [`weave ontology: ${tables} tables in ${spaces.length} spaces, one line each. ${ONTOLOGY_LEGEND}`, ...spaces.flatMap(block), `etag ${etag}`].join('\n');
    if (since == null || since === '') return outline;
    if (String(since) === etag) return `unchanged; etag ${etag}`;
    const then = seen.get(String(since));
    if (!then) return `etag ${since} is not one this workspace issued; the whole outline follows.\n${outline}`;
    const moved = [...counts.keys()].filter((id) => counts.get(id) > (then.get(id) ?? 0));
    const live = spaces.filter((sp) => moved.includes(sp.id));
    const gone = moved.filter((id) => !live.some((sp) => sp.id === id)).map((id) => this.state.spaces[id]?.name ?? id);
    return [
      `since ${since}: ${moved.length} space${moved.length === 1 ? '' : 's'} changed. ${ONTOLOGY_LEGEND}`,
      ...live.flatMap(block),
      ...(gone.length ? [`gone: ${gone.join(', ')}`] : []),
      `etag ${etag}`,
    ].join('\n');
  }

  #schemaHistory() {
    const spacesNamed = (n) => Object.values(this.state.spaces).filter((s) => s.name === n).map((s) => s.id);
    const tablesNamed = (ref) => {
      if (!ref) return [];
      const [sp, t] = String(ref).includes('/') ? String(ref).split('/') : [null, String(ref)];
      return Object.values(this.state.tables).filter((x) => x.name === t && (!sp || this.state.spaces[x.spaceId]?.name === sp)).map((x) => x.spaceId);
    };
    const resolve = (action, d) => {
      if (Array.isArray(d.spaces)) return d.spaces;
      if (!UNTAGGED_SCHEMA_ACTIONS.has(action)) return [];
      if (this.state.tables[d.tableId]) return [this.state.tables[d.tableId].spaceId];
      if (action.startsWith('space-')) return spacesNamed(d.name);
      if (action === 'table-created' || action === 'table-duplicated') return spacesNamed(d.space);
      if (action === 'table-moved') return [...spacesNamed(d.from), ...spacesNamed(d.to)];
      if (action.startsWith('table-')) return tablesNamed(d.name);
      return [...tablesNamed(d.table), ...tablesNamed(d.target), ...(d.targets ?? []).flatMap(tablesNamed)];
    };
    const counts = new Map();
    const seen = new Map([[ontologyEtag(counts), new Map()]]);
    for (const r of this.store.listAudit({ limit: -1, actions: SCHEMA_AUDIT_ACTIONS }).reverse()) {
      const touched = new Set(resolve(r.action, r.detail ?? {}));
      if (!touched.size) continue;
      for (const id of touched) counts.set(id, (counts.get(id) ?? 0) + 1);
      seen.set(ontologyEtag(counts), new Map(counts));
    }
    return { counts, seen };
  }

  #ontologyLabel() {
    const names = new Map();
    for (const t of this.listTables()) names.set(t.name.toLowerCase(), (names.get(t.name.toLowerCase()) ?? 0) + 1);
    return (t) => (!t ? '?' : names.get(t.name.toLowerCase()) > 1 && this.state.tables[t.id] === t ? this.qualifiedName(t) : t.name);
  }

  #ontologyFields(db, label) {
    const cap = (names) => (names.length > 8 ? [...names.slice(0, 8), `+${names.length - 8}`] : names).join('|');
    const parts = [];
    for (const fid of db.fieldOrder) {
      const f = db.fields[fid];
      if (!f || f.type === 'view' || f.id === db.nameFieldId || f.id === db.descriptionFieldId) continue;
      const c = f.config ?? {};
      const computed = this.#ontologyComputed(db, f, label);
      if (f.type === 'relation') {
        const targets = (c.targetDbs ?? [c.targetDb]).map((id) => label(this.state.tables[id])).join('|');
        const inverse = c.targetDb ? this.state.tables[c.targetDb]?.fields[c.inverseFieldId]?.name : null;
        parts.push(`${f.name} -> ${targets}${c.many ? '*' : ''}${inverse ? ` (${inverse})` : ''}`);
      } else if (computed != null) {
        parts.push(`${f.name} = ${computed.length > 48 ? `${computed.slice(0, 47)}…` : computed}`);
      } else {
        const type = ONTOLOGY_TYPES[f.type] ?? f.type;
        const names = f.type === 'workflow' ? c.states.map((x) => x.name) : f.type === 'select' || f.type === 'multiselect' ? c.options.map((o) => o.name) : null;
        parts.push(`${f.name} ${type}${names ? `[${cap(names)}]` : ''}`);
      }
    }
    return parts;
  }

  #ontologyComputed(db, f, label) {
    const c = f.config ?? {};
    if (f.type === 'formula') return String(c.expression ?? '').replace(/\s+/g, ' ').trim();
    if (f.type !== 'lookup' && f.type !== 'rollup') return null;
    let base;
    let tdb;
    if (f.type === 'rollup' && c.via) {
      tdb = this.#tableAnywhere(c.via)?.table;
      base = label(tdb);
    } else {
      const rel = db.fields[c.relationField];
      base = rel?.name ?? '?';
      tdb = rel ? this.state.tables[rel.config.targetDb] : null;
    }
    const target = c.targetField ? tdb?.fields[c.targetField]?.name ?? '?' : null;
    const path = target ? `${base}.${target}` : base;
    return f.type === 'lookup' ? path : `${c.aggregate}(${path})`;
  }

  #ontologyConcept(db, counts) {
    const rows = this.#liveRowCounts().get(db.id) ?? 0;
    const sp = this.state.spaces[db.spaceId];
    const qualified = (t) => (t ? this.qualifiedName(t) : '?');
    const lines = [`${this.qualifiedName(db)}: ${rows} row${rows === 1 ? '' : 's'}, space ${sp?.name ?? '?'} v${counts.get(db.spaceId) ?? 0}.${db.description ? ` ${db.description}` : ''}`, 'Fields:'];
    for (const fid of db.fieldOrder) {
      const f = db.fields[fid];
      if (!f || f.type === 'view') continue;
      const c = f.config ?? {};
      const parts = [f.type];
      if (f.id === db.nameFieldId) parts.push('the row name');
      if (f.id === db.descriptionFieldId) parts.push('the row description');
      if (f.type === 'select' || f.type === 'multiselect') parts.push(`options ${c.options.map((o) => o.name).join(', ')}`);
      if (f.type === 'workflow') parts.push(`states ${c.states.map((x) => `${x.name} (${x.category}${x.default ? ', default' : ''})`).join(', ')}`);
      if (f.type === 'relation') {
        const members = (c.targetDbs ?? [c.targetDb]).map((id) => this.state.tables[id]).filter(Boolean);
        parts[0] = `relation -> ${members.map(qualified).join(' | ')}, ${c.many ? 'many' : 'one'}`;
        const inverse = c.targetDb ? this.state.tables[c.targetDb]?.fields[c.inverseFieldId]?.name : null;
        parts.push(inverse ? `inverse ${inverse}` : 'one-way');
      }
      const computed = this.#ontologyComputed(db, f, qualified);
      if (computed != null) parts[0] = `${f.type} ${computed}`;
      if (f.type === 'number' || f.type === 'formula') for (const k of ['format', 'currency', 'unit']) if (c[k]) parts.push(`${k} ${c[k]}`);
      if (f.type === 'rating') parts.push(`max ${c.max}`);
      if (f.type === 'toggle') parts.push(`on ${c.on}, off ${c.off}`);
      if (f.type === 'document' && c.kind) parts.push(`kind ${c.kind}`);
      if (f.type === 'field') parts.push(`types ${(c.types ?? []).join(', ')}`);
      if (c.default !== undefined) {
        const named = (id) => c.options?.find((o) => o.id === id)?.name ?? id;
        parts.push(`default ${f.type === 'select' || f.type === 'multiselect' ? [].concat(c.default).map(named).join(', ') : JSON.stringify(c.default)}`);
      }
      lines.push(`- ${f.name}: ${parts.join('; ')}${c.description ? `. ${c.description}` : ''}`);
    }
    return lines.join('\n');
  }

  describeSchema() {
    const counts = this.#liveRowCounts();
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
        ...structuredClone(this.#defaultViewConfig(db)),
        views: (db.tableViews ?? []).map((v) => this.#viewOut(db, v)),
        ...(typeof db.hideRollups === 'boolean' ? { hideRollups: db.hideRollups } : {}),
        bodyBlocks: this.bodyBlocks(db),
        term: this.termOf(db),
        ...(this.termOf(db).set ? { noun: this.termOf(db).singular } : {}),
        qualified: this.qualifiedName(db),
        entityCount: counts.get(db.id) ?? 0,
        maxPublicId: db.publicIdCounter ?? 0,
        fields: db.fieldOrder.map((fid) => {
          const f = db.fields[fid];
          const out = { id: f.id, name: f.name, type: f.type };
          if (f.config.width) out.width = f.config.width;
          if (f.type !== 'view' && f.config.description) out.description = f.config.description;
          if (f.id === db.nameFieldId && f.config.term) out.term = { ...f.config.term };
          if (f.type === 'select' || f.type === 'multiselect') {
            out.options = f.config.options.map((o) => o.name);
            out.optionsFull = f.config.options.map((o) => ({
              id: o.id, name: o.name, hue: hueOf(o), icon: o.icon ?? '', color: o.color ?? '',
            }));
          }
          if (f.type === 'workflow') out.states = f.config.states.map((s) => ({ id: s.id, name: s.name, category: s.category, default: !!s.default, ...(s.icon ? { icon: s.icon } : {}), ...(s.hue ? { hue: s.hue } : {}) }));
          if (f.type === 'relation' && f.config.targetDbs) {
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
          if (f.type === 'rollup') {
            for (const k of ROLLUP_COSTUME_KEYS) if (f.config[k] != null) out[k] = f.config[k];
            const nd = this.#numberDisplay(db, f);
            if (nd) { out.display = nd.display; if (typeof nd.scale === 'number') out.scale = nd.scale; out.color = nd.color; }
          }
          if (f.type === 'number' || f.type === 'formula') {
            for (const k of f.type === 'formula' ? FORMULA_COSTUME_KEYS : NUMBER_COSTUME_KEYS) {
              if (f.config[k] != null) out[k] = f.config[k];
            }
            if (f.config.display) out.color = f.config.color ?? 'ink';
          }
          if (f.type === 'attachments') {
            out.multiple = f.config.multiple !== false;
            for (const k of ATTACHMENT_LOOK_KEYS) if (f.config[k] != null) out[k] = f.config[k];
          }
          if (f.type === 'toggle') { out.on = f.config.on; out.off = f.config.off; }
          if (f.type === 'rating') { out.max = f.config.max; out.icon = f.config.icon; out.color = f.config.color ?? 'ink'; }
          if (f.type === 'lookup' || f.type === 'rollup') {
            const rt = this.#ratingOf(db, f);
            if (rt) out.rating = rt;
          }
          if (f.type === 'document' && f.config.kind) out.kind = f.config.kind;
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
          if (f.type === 'key') Object.assign(out, this.credentialConfig(f));
          if (f.type === 'date' || f.type === 'daterange') {
            for (const k of DATE_COSTUME_KEYS) if (f.config[k] != null) out[k] = f.config[k];
          }
          if (f.type === 'formula') out.expression = f.config.expression;
          if (f.type === 'field') { out.types = [...f.config.types]; out.depth = f.config.depth; }
          if (f.type === 'text' && f.config.literal) out.literal = true;
          if (f.config?.default !== undefined) out.default = f.config.default;
          return out;
        }),
      })),
    }));
  }

  exportJSON({ blobs: withBlobs = true } = {}) {
    const out = JSON.parse(JSON.stringify(this.state));
    delete out.fileBlobs;
    for (const a of Object.values(out.meta.accounts ?? {})) {
      delete a.tokenHash;
      for (const i of a.identities ?? []) delete i.verifiedEmail;
    }
    for (const v of Object.values(out.meta.views ?? {})) delete v.shareToken;
    Shares.redactTokens(out);
    delete out.meta.sessions;
    delete out.meta.invites;
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

  #landBlobs() {
    const blobs = this.state.fileBlobs;
    if (!blobs || !this.store.path) return false;
    for (const [id, b64] of Object.entries(blobs)) this.#writeBlob(id, Buffer.from(b64, 'base64'));
    delete this.state.fileBlobs;
    return true;
  }

  #keepSecrets(prior) {
    const meta = this.state.meta;
    for (const a of Object.values(meta.accounts ?? {})) {
      const was = prior.accounts?.[a.id];
      if (was?.tokenHash && a.tokenHash === undefined) a.tokenHash = was.tokenHash;
      for (const i of a.identities ?? []) {
        const mail = was?.identities?.find((x) => x.issuer === i.issuer && x.subject === i.subject)?.verifiedEmail;
        if (mail && i.verifiedEmail === undefined) i.verifiedEmail = mail;
      }
    }
    Shares.keepTokens(meta, prior);
    for (const kind of ['sessions', 'identityInvites']) {
      if (meta[kind] !== undefined || !prior[kind]) continue;
      const kept = Object.entries(prior[kind]).filter(([, s]) => (kind === 'identityInvites' && !s.accountId) || meta.accounts?.[s.accountId]);
      if (kept.length) meta[kind] = Object.fromEntries(kept);
    }
  }

  importJSON(state) {
    if (!state || ![1, 2].includes(state.version)) throw new WeaveError('Unsupported workspace format', 'invalid');
    const ids = [...Object.keys(state.fileBlobs ?? {}), state.meta?.logo?.id];
    for (const e of Object.values(state.entities ?? {})) for (const f of e?.files ?? []) ids.push(f?.id);
    for (const id of ids) {
      if (id !== undefined && !BLOB_ID.test(String(id))) throw new WeaveError(`Invalid file id '${id}' in the import`, 'invalid');
    }
    const prior = this.state.meta ?? {};
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
