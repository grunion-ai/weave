import { WeaveError } from './store.js';
import { nonNegativeInteger, errorBody } from './errors.js';
import { ONTOLOGY, inviteUrl } from './engine.js';
import { guided } from './field-hints.js';
import { vocabularyView } from './vocabulary.js';

const truthy = (v) => v === true || ['1', 'true'].includes(String(v ?? ''));
const list = (v) => (v == null ? undefined : Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const nullable = (v, as = (x) => x) => (v === 'null' ? null : as(v));

export const QUERY_PAGE = 200;
const MAX_ROWS = 500;
const rowCap = () => Math.max(1, Number(process.env.WEAVE_MAX_ROWS) || MAX_ROWS);
export const boundedLimit = (value, fallback = null) => {
  if (value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new WeaveError(`limit must be a number, not '${value}'`, 'invalid');
  return Math.min(n, rowCap());
};
const cliNumber = (name, raw, fallback = null) => {
  if (raw == null || raw === true || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new WeaveError(`--${name} must be a number, not '${raw}'`, 'invalid');
  return value;
};

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function spaceUpdate(w, a) {
  if (a.member != null) w.setSpaceMember(a.space, a.member, { role: a.role ?? null });
  if (a.removeMember != null) w.removeSpaceMember(a.space, a.removeMember);
  const { space, member, removeMember, role, ...rest } = a;
  const patch = defined(rest);
  const sp = Object.keys(patch).length ? w.updateSpace(space, patch) : w.getSpace(space);
  return { ...sp, members: w.spaceMembers(sp.id) };
}

function fieldUpdate(w, a) {
  const seq = w.state.meta.activitySeq ?? 0;
  const { db, field: ref, ...rest } = a;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  const field = w.updateField(db, ref, patch);
  const entry = w.fieldChangeSince(db, field.id, seq);
  return {
    ...guided(w, 'field', field, patch.type == null ? patch.config : {}),
    activity: entry?.id ?? null,
    lossy: !!entry?.detail.lossy,
    ...(entry?.detail.formulas ? { formulas: entry.detail.formulas } : {}),
  };
}

const onFlag = (v) => ['on', 'true', 'yes', '1', true].includes(v);
function viewPatch(flags, json) {
  const patch = {};
  for (const k of ['fields', 'show', 'hide']) if (flags[k] != null && flags[k] !== true) patch[k] = list(flags[k]);
  if (flags.move != null) patch.move = { field: flags.move, ...(flags.before != null ? { before: flags.before } : { after: flags.after }) };
  for (const k of ['filters', 'sort', 'widths']) if (flags[k] != null) patch[k] = json(k);
  if (flags.frozen != null) patch.frozen = Number(flags.frozen);
  for (const k of ['density', 'layout', 'subtotals', 'groups', 'picture', 'search']) if (flags[k] != null) patch[k] = flags[k] === true ? '' : String(flags[k]);
  if (flags.group != null) patch.group = String(flags.group).trim().startsWith('[') ? json('group') : String(flags.group);
  if (flags['completed-by'] != null) patch.completedBy = flags['completed-by'] === 'none' ? null : flags['completed-by'];
  if (flags.collapsed != null) patch.collapsed = json('collapsed');
  if (flags.order != null) patch.order = list(flags.order);
  if (flags['phone-row'] != null) patch.phoneRow = flags['phone-row'] === 'none' ? null : json('phone-row');
  if (flags.deleted != null) patch.deleted = onFlag(flags.deleted);
  if (flags.rollups != null) patch.rollups = flags.rollups === 'table' ? null : onFlag(flags.rollups);
  if (flags.name != null) patch.name = flags.name;
  if (flags.from != null) patch.from = flags.from;
  if (flags.position != null) patch.position = Number(flags.position);
  if (flags.default) patch.default = true;
  if (flags.delete) patch.delete = true;
  return patch;
}
const UPLOAD = Symbol('upload');
export const previewInput = (p) => (p && typeof p === 'object' && (p.contentBase64 ?? p.bytes) != null ? { bytes: p.contentBase64 ?? p.bytes } : null);
const FILES_TOOL = {
  name: 'weave_files',
  description: 'Files already attached to an entity: action read (returns base64 content) | delete. Attach one with weave_attach_file.',
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string' }, entity: { type: 'string' }, file: { type: 'string' } },
    required: ['action', 'file'],
  },
};
const mcpUpload = (a) => {
  if (typeof a.contentBase64 !== 'string') throw new Error('Send contentBase64, or prepare:true and size for a raw upload.');
  return { name: a.name, mime: a.mime, bytes: a.contentBase64 };
};
const REGISTRY_TOOL = {
  name: 'weave_registry',
  description: 'The meta-model registries (System/Workspaces, Spaces, Tables, Fields) whose records ARE the schema. The registry lives once, at the weave root — the default workspace — and every record carries a Workspace relation naming the workspace it describes; a member workspace reports and rebuilds its own slice. action report (drift between the registry and the structures it mirrors) | rebuild.',
  inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
};

const zoned = (ctx) => ({ viewerZone: ctx?.viewerZone });
const withSecret = (w, id, ctx) => {
  const once = w.takeOneTime(id);
  return { ...w.readEntity(id, zoned(ctx)), ...(once?.invite ? { invite: { ...once.invite, url: inviteUrl(ctx?.origin ?? '', once.invite.code) } } : once ?? {}) };
};
const withoutAffected = ({ affected, ...row }) => row;

const queryOptions = (a) => ({
  where: a.where ?? [], sort: a.sort ?? [], limit: a.limit ?? QUERY_PAGE,
  offset: a.offset ?? 0, select: a.select ?? null, fields: a.fields ?? null, relations: a.relations ?? 'chip',
  includeDeleted: a.includeDeleted == null ? null : Boolean(a.includeDeleted),
  trashCount: Boolean(a.trashCount), countAll: Boolean(a.countAll), search: a.search ?? '', view: a.view ?? null,
  groupBy: a.groupBy ?? null, shape: a.shape ?? 'full',
});
const csvList = (v) => (v ? String(v).split(',').map((s) => s.trim()) : null);
const whereJson = (raw) => {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('where must be JSON'), { whereJson: true }); }
};

const docField = (flags) => (flags.field === true ? null : flags.field ?? null);
const docWriteArgs = (sub) => (a, flags, { entityRef, file }) => {
  const entity = entityRef(a.entity, flags.db);
  const content = flags.file ? file(flags.file) : flags.content;
  const field = docField(flags);
  if (content == null || content === true) throw new WeaveError(`doc ${sub} needs its text: --content <markdown> or --file <path>. Use --content '' to clear the document.`, 'invalid');
  return { entity, markdown: content, field };
};
const docWriteBody = (a, body) => {
  const text = body.doc ?? body.markdown;
  if (text == null) throw new WeaveError('A document write carries its text under `doc` or `markdown`; this body has neither. Send `{"doc": ""}` to clear the document.', 'invalid');
  return { entity: a.entity, markdown: text, field: a.field ?? null, base: typeof body.base === 'string' ? body.base : null };
};
const docWritten = () => ({ ok: true });
const SET_DOC_TOOL = {
  name: 'weave_set_doc',
  description: 'Write an entity document. mode "replace" (default) or "append". field picks a document field; omit for the default.',
  inputSchema: { type: 'object', properties: { entity: { type: 'string' }, markdown: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] }, field: { type: 'string' } }, required: ['entity', 'markdown'] },
};
const RECORDS = Symbol('records');
const UNDO_TOOL = {
  name: 'weave_undo',
  description: 'Revert the last entity mutation(s): field/doc/state/relation edits, creates, soft deletes, comments, file attachments. Schema changes and hard deletes are not undoable. Pass list:true to preview the stack without reverting.',
  inputSchema: { type: 'object', properties: { steps: { type: 'number' }, list: { type: 'boolean' } } },
};
const VIEWS_TOOL = {
  name: 'weave_views',
  description: 'Saved views: a named list of blocks, each a table plus an optional where and a view kind (table, the one kind weave draws). action: list | get | create | delete | restore | share | unshare. delete moves the view to the trash (hard: true purges); list with trash: true lists the trash; restore brings a trashed view and its share links back. Sharing mints a read-only public share grant on the view (weave_shares lists it); the /s/<token> URL renders that view read-only, even when the workspace requires auth. share and unshare take an architect token.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string' }, view: { type: 'string' }, name: { type: 'string' },
      blocks: { type: 'array', description: '[{table, where?, view?}]' }, hard: { type: 'boolean' }, trash: { type: 'boolean' },
    },
    required: ['action'],
  },
};
const SHARES_TOOL = {
  name: 'weave_shares',
  description: 'Share beta: architect-managed links. action list (kind?, id?, includeInactive?) | mint (kind entity|entities|table|space|view|workspace, id or ids; mode read|submit|edit|manage; formId for submit; visibility public|private; label; expiry 1h|1d|7d|30d|90d|never or expiresAt ISO; default 30d) | update (share, label?, expiry? or expiresAt?; keeps URL) | regenerate (share, optional expiry; old token stops immediately) | renew (share, 30 more days) | revoke (share). Submit only creates through its form. Public links require no login; private requires an existing signed-in member. Named email/domain audiences are unavailable in beta. Tokens never change scope. Every action requires architect access.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string' }, kind: { type: 'string' }, id: { type: 'string' }, mode: { type: 'string' },
      visibility: { type: 'string' }, label: { type: 'string' }, expiresAt: { type: 'string' }, share: { type: 'string' },
      expiry: { type: 'string' }, formId: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, includeInactive: { type: 'boolean' },
    },
    required: ['action'],
  },
};
const sharePatch = (a) => Object.fromEntries(['label', 'expiry', 'expiresAt'].filter((key) => Object.hasOwn(a, key)).map((key) => [key, a[key]]));
const sharePatchFlags = (a, flags) => {
  const patch = {};
  if (typeof flags.label === 'string') patch.label = flags.label;
  if (typeof flags.expiry === 'string') patch.expiry = flags.expiry;
  if (typeof flags.expires === 'string') patch.expiresAt = flags.expires;
  return { share: a.share, patch };
};
const linked = (r, a, ctx) => ctx.shareLink(r);
const commentAuthor = (w, a, ctx) => (ctx?.caller?.role && !['architect', 'editor'].includes(ctx.caller.role) ? w.actor : a.author ?? 'agent');

const linkArgs = (a, flags, { entityRef }) => ({ entity: entityRef(a.entity, flags.db), field: a.field, targets: a.targets });
const linkBody = (a) => ({ entity: a.entity, field: a.field, targets: a.targets ?? a.items });

const AUTOMATIONS_TOOL = {
  name: 'weave_automations',
  description: 'Automations already on a table, read from their System/Workflows records: action list | describe (rules in prose) | update (patch: name, enabled = the record\'s On) | delete (to the trash) | replay (delivery: a System/Failed Deliveries record; sends its stored request again and runs the steps after it). Create one with weave_create_automation.',
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string' }, db: { type: 'string' }, automation: { type: 'string' }, patch: { type: 'object' }, delivery: { type: 'string', description: 'For replay: the id, public id or Name of a System/Failed Deliveries record.' } },
    required: ['action'],
  },
};

const KEYS_TOOL = {
  name: 'weave_keys',
  description: 'The keystore behind `key` (credential) fields: the field holds the NAME of a secret; the secret lives in weave\'s key store, an encrypted chmod-600 file or the macOS keychain, never in the workspace. action: list (names, owners, sharing) | set (name, value) | share (name, account) | unshare (name, account) | delete. No MCP tool returns a secret value — revealing one is a human act on the CLI or the HTTP surface, gated by that credential\'s own access list and written to the audit log.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' }, to: { type: 'string' },
      account: { type: 'string', description: 'For share/unshare: the account the credential opens to.' },
    },
    required: ['action'],
  },
};

export const COMMANDS = [
  {
    name: 'schema.ontology',
    engine: ['ontology', 'spaceVersions'],
    writes: 'none',
    tool: {
      name: 'weave_ontology',
      description: 'The schema, short; read it before weave_schema (the full JSON). Default outline: one line per table by space, [a|b] options or states, name -> Target (inverse) with * for many, name = lookup, rollup or formula, then the etag. concept: one table in full, field descriptions included. since: an etag; answers only the spaces changed since.',
      inputSchema: { type: 'object', properties: { depth: { type: 'string', enum: ['outline', 'glossary'] }, concept: { type: 'string', description: 'Table or Space/Table' }, since: { type: 'string' } } },
    },
    cli: { command: 'ontology', flags: ['depth', 'concept', 'since'] },
    http: { method: 'GET', path: '/api/ontology', query: ['depth', 'concept', 'since'] },
    run: (w, a) => (a.depth === 'glossary' ? ONTOLOGY : w.ontology({ depth: a.depth || 'outline', concept: a.concept || null, since: a.since || null })),
  },
  {
    name: 'field.add',
    engine: ['addField', 'materializeField'],
    writes: 'schema',
    tool: {
      name: 'weave_add_field',
      description: 'Add a field. Every type, its config keys and what it looks like in the grid: weave_vocabulary. Types: text, number, rating, date, daterange, checkbox, toggle, url, email, select, multiselect, workflow, document, attachments, field, key, lookup, rollup, formula (relation fields use weave_add_relation). config: {options:[...]} for selects; {max, icon} for rating (max 1-100, default 5; the value is a whole number 0..max); {on, off} for toggle (the value stays true/false); {states:[{name,category,default}]} for workflow (categories: not-started, in-progress, done, canceled); {relationField, targetField} for lookup; {relationField, targetField, aggregate} for rollup (count, sum, avg, min, max, join, median, stdev, distinct, filled, empty, range) — or, on the System/Spaces registry record only, {via: <table>, targetField, aggregate, where?} for a rollup over a WHOLE table, the figure under a grid column (where takes weave_query clauses); {expression} for formula. Any of text, number, rating, date, daterange, checkbox, toggle, url, email, select, multiselect may also carry {default}: the value a new entity starts with when the create does not name the field (a workflow uses its default state instead). Any field may carry {width} in px (60 minimum) to set its column, and {description}: plain text saying what the value represents and how it is written — read it back from weave_schema before filling a record. Replies list open settings in next[] (number: format currency, unit, display) and slips in hints[].',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' } }, required: ['db', 'name', 'type'] },
    },
    cli: {
      command: 'field', sub: 'add', positional: ['db', 'name', 'type'],
      args: (a, flags, { json }) => {
        const config = json('config') ?? {};
        if (flags.description != null) config.description = String(flags.description);
        return { ...a, config };
      },
    },
    http: { method: 'POST', path: '/api/tables/:db/fields', status: 201 },
    run: (w, a) => guided(w, 'field', w.addField(a.db, { name: a.name, type: a.type, config: a.config ?? {} }), a.config),
  },
  {
    name: 'field.update',
    engine: ['updateField'],
    writes: 'schema',
    tool: {
      name: 'weave_update_field',
      description: 'Change a field: rename it, retype it (values are migrated; text to relation takes config:{targetDb, createMissing?} and links records by name), or edit its config. config keys ride their own lanes — width (px, 60 minimum, null resets to auto), description (plain text: what the value represents and how it is written; null clears; on a view field it is the description size instead), default (null clears), options/states (a full replacement), on/off (a toggle\'s state labels, one at a time), max/icon (a rating\'s scale and icon, one at a time), expression, and the costume keys for number, date, document and attachments. See weave_vocabulary for every legal value.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, field: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' } }, required: ['db', 'field'] },
    },
    cli: {
      command: 'field', sub: 'update', positional: ['db', 'field'],
      args: (a, flags, { json }) => {
        const config = json('config') ?? {};
        if (flags.width != null) config.width = nullable(flags.width, Number);
        if (flags.default != null) config.default = nullable(flags.default);
        if (flags.description != null) config.description = nullable(flags.description, String);
        return { ...a, name: flags.name, type: flags.type, config: Object.keys(config).length ? config : undefined };
      },
    },
    http: { method: 'PATCH', path: '/api/tables/:db/fields/:field' },
    run: fieldUpdate,
  },
  {
    name: 'field.rollback',
    engine: ['rollbackFieldConfig'],
    writes: 'schema',
    tool: {
      name: 'weave_rollback_field',
      description: 'Put a field back the way one of its field-config-updated (or undo) Activity entries found it. Every change weave_update_field makes to a field\'s name or config (the column width aside) is an Activity entry on its table, with the definition before and after; list them with weave_activity {entity: <table id>}. The roll back is refused when the field changed after the entry. A type change rolls back with its values: records unchanged since are restored, a record edited since keeps its edit (converted back) and a record made since is converted; only the newest type change of a field keeps its values. It writes its own undo entry, which can itself be rolled back. Returns {field, activity}, plus {restored, left, converted} for a type change.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, field: { type: 'string' }, activity: { type: 'string', description: 'The entry id, <tableId>:f<n>' } }, required: ['activity'] },
    },
    cli: { command: 'field', sub: 'rollback', positional: ['db', 'field'], flags: ['activity'] },
    http: { method: 'POST', path: '/api/tables/:db/fields/:field/rollback' },
    run: (w, a) => w.rollbackFieldConfig(a.activity, { table: a.db ?? null, field: a.field ?? null, ...(a.via ? { via: a.via } : {}) }),
  },
  {
    name: 'field.delete',
    engine: ['deleteField'],
    writes: 'schema',
    tool: {
      name: 'weave_delete_field',
      description: 'Move a field to the trash: the column leaves the table and its values leave the records, held in the trash with the column\'s place in every view. Pass hard: true to purge it for good (also purges a field already in the trash).',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, field: { type: 'string' }, hard: { type: 'boolean' } }, required: ['db', 'field'] },
    },
    cli: { command: 'field', sub: 'delete', positional: ['db', 'field'], flags: ['hard'] },
    http: { method: 'DELETE', path: '/api/tables/:db/fields/:field', query: ['hard'] },
    run: (w, a) => ({ ok: true, ...w.deleteField(a.db, a.field, { hard: truthy(a.hard) }) }),
  },
  {
    name: 'field.restore',
    engine: ['restoreField'],
    writes: 'schema',
    tool: {
      name: 'weave_restore_field',
      description: 'Restore a field out of the trash by name or id: the column, its values, its place in the field order and in every view, and for a relation its inverse and every link come back. Refused while a live field holds the name or the table is in the trash.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, field: { type: 'string' } }, required: ['db', 'field'] },
    },
    cli: { command: 'field', sub: 'restore', positional: ['db', 'field'] },
    http: { method: 'POST', path: '/api/tables/:db/fields/:field/restore' },
    run: (w, a) => w.restoreField(a.db, a.field),
  },
  {
    name: 'formula.check',
    engine: ['checkFormula'],
    writes: 'none',
    tool: {
      name: 'weave_check_formula',
      description: 'Validate a formula expression against a table BEFORE saving it — syntax, function names, field names — and, when the table has records, preview the computed value on one real entity. The authoring loop: check → fix until ok:true → weave_add_field/weave_update_field with {expression} → read the cell back. Returns {ok, error?, preview?, previewEntity?, type?} — type is what the preview computed to (number, text, boolean, list, null, error); never throws on a bad expression. Pass excludeField (field name or id) when editing an existing formula field so it cannot reference itself; pass entity (id) to preview a specific record. scan: true evaluates over up to 200 records and adds scan: {records, capped, nulls, errors, sampleByOutcome: {ok, null, error}} — a formula valid on record 1 and null on a third of the table is the bug one preview cannot show; assert nulls and errors are what you expect before saving.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, expression: { type: 'string' }, entity: { type: 'string' }, excludeField: { type: 'string' }, scan: { type: 'boolean' } }, required: ['db', 'expression'] },
    },
    cli: { command: 'formula', sub: 'check', positional: ['db', 'expression'], flags: ['entity', 'exclude-field', 'scan'] },
    http: { method: 'POST', path: '/api/tables/:db/formula-check' },
    run: (w, a) => w.checkFormula(a.db, a.expression, { entity: a.entity ?? null, excludeField: a.excludeField ?? null, scan: truthy(a.scan) }),
  },
  {
    name: 'relation.add',
    engine: ['addRelation'],
    writes: 'schema',
    tool: {
      name: 'weave_add_relation',
      description: 'Create a relation field. One targetDb: bidirectional — the inverse field is created automatically on the target table. targetDbs (a list of 2+ tables, which may include System/Spaces and System/Tables): a target-set (polymorphic) relation — one field whose values may point at records of any member table, one-way, no inverse; lookups/rollups need a single target. Cardinality: many-to-one (this side holds one), one-to-many, many-to-many, one-to-one.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, name: { type: 'string' }, targetDb: { type: 'string' }, targetDbs: { type: 'array', items: { type: 'string' } }, cardinality: { type: 'string' }, inverseName: { type: 'string' } }, required: ['db', 'name'] },
    },
    cli: {
      command: 'relation', sub: 'add', positional: ['db', 'name', 'targetDb'],
      args: (a, flags) => ({ ...a, targetDbs: list(flags['target-dbs']), cardinality: flags.cardinality, inverseName: flags.inverse }),
    },
    http: { method: 'POST', path: '/api/tables/:db/relations', status: 201 },
    run: (w, a) => w.addRelation(a.db, { name: a.name, targetDb: a.targetDb, targetDbs: a.targetDbs, cardinality: a.cardinality ?? 'many-to-one', inverseName: a.inverseName }),
  },
  {
    name: 'space.create',
    engine: ['createSpace'],
    writes: 'schema',
    tool: {
      name: 'weave_create_space',
      description: 'Create a space (top-level grouping of tables).',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' }, template: { type: 'boolean' } }, required: ['name'] },
    },
    cli: { command: 'space', sub: 'create', positional: ['name'], flags: ['description', 'icon', 'template'] },
    http: { method: 'POST', path: '/api/spaces', status: 201 },
    run: (w, a) => guided(w, 'space', w.createSpace({ name: a.name, description: a.description ?? '', icon: a.icon ?? '', template: truthy(a.template) })),
  },
  {
    name: 'space.list',
    engine: ['listSpaces'],
    writes: 'none',
    via: { tool: 'weave_schema' },
    cli: { command: 'space', sub: 'list', default: true },
    http: { method: 'GET', path: '/api/spaces' },
    run: (w) => w.listSpaces(),
  },
  {
    name: 'space.update',
    engine: ['updateSpace', 'spaceMembers', 'setSpaceMember', 'removeSpaceMember'],
    writes: 'schema',
    tool: {
      name: 'weave_update_space',
      description: 'Rename a space, move it (position: 0 is the first space in the sidebar and in weave_schema) or change its description or icon, or mark it a template (template: true; weave_template_use copies a template\'s schema into another workspace). An icon is `lucide:<name>` from weave_vocabulary or a mark character; anything else is refused. access: private shows the space to its members and the workspace architects only; member (with an optional role that overrides the workspace role) and removeMember manage who belongs, which takes an architect of the workspace or of the space.',
      inputSchema: {
        type: 'object',
        properties: {
          space: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' }, template: { type: 'boolean' }, position: { type: 'number', description: 'Its place in the sidebar: 0 is the first space' },
          access: { type: 'string', enum: ['open', 'private'], description: 'open: every account reads it at its workspace role. private: only its members and the workspace architects see it' },
          member: { type: 'string', description: 'An account to add as a member, or whose space role to change' },
          role: { type: 'string', description: 'The member\'s role in this space (observer, editor or architect); it overrides the workspace role. Omit to keep the workspace role' },
          removeMember: { type: 'string', description: 'An account to remove from the space' },
        },
        required: ['space'],
      },
    },
    cli: { command: 'space', sub: 'update', positional: ['space'], flags: ['name', 'description', 'icon', 'position', 'access', 'template'], args: (a) => ({ ...a, ...(a.template != null ? { template: truthy(a.template) } : {}), ...(a.position != null ? { position: Number(a.position) } : {}) }) },
    http: { method: 'PATCH', path: '/api/spaces/:space' },
    run: spaceUpdate,
  },
  {
    name: 'space.members',
    engine: ['spaceMembers', 'setSpaceMember', 'removeSpaceMember'],
    writes: 'none',
    via: { tool: 'weave_update_space' },
    cli: { command: 'space', sub: 'members', positional: ['space', 'account'], flags: ['role', 'remove'] },
    http: { method: 'GET', path: '/api/spaces/:space/members', args: (a) => ({ space: a.space }) },
    run: (w, a) => {
      if (a.account === undefined) return w.spaceMembers(a.space);
      return a.remove ? w.removeSpaceMember(a.space, a.account) : w.setSpaceMember(a.space, a.account, { role: a.role ?? null });
    },
  },
  {
    name: 'space.member.set',
    engine: ['setSpaceMember'],
    writes: 'schema',
    via: { tool: 'weave_update_space', cli: 'space.members' },
    http: { method: 'PUT', path: '/api/spaces/:space/members/:account', args: (a, body) => ({ space: a.space, account: a.account, role: body?.role ?? null }) },
    run: (w, a) => w.setSpaceMember(a.space, a.account, { role: a.role }),
  },
  {
    name: 'space.member.remove',
    engine: ['removeSpaceMember'],
    writes: 'schema',
    via: { tool: 'weave_update_space', cli: 'space.members' },
    http: { method: 'DELETE', path: '/api/spaces/:space/members/:account' },
    run: (w, a) => w.removeSpaceMember(a.space, a.account),
  },
  {
    name: 'space.delete',
    engine: ['deleteSpace'],
    writes: 'schema',
    tool: {
      name: 'weave_delete_space',
      description: 'Move a space to the trash (recoverable — its tables and records go dark with it). Pass hard: true to purge it and every table in it for good.',
      inputSchema: { type: 'object', properties: { space: { type: 'string' }, hard: { type: 'boolean' } }, required: ['space'] },
    },
    cli: { command: 'space', sub: 'delete', positional: ['space'], flags: ['hard'] },
    http: { method: 'DELETE', path: '/api/spaces/:space', query: ['hard'] },
    run: (w, a) => { w.deleteSpace(a.space, { hard: truthy(a.hard) }); return { ok: true, space: a.space, deleted: true, hard: truthy(a.hard) }; },
  },
  {
    name: 'space.restore',
    engine: ['restoreSpace'],
    writes: 'schema',
    tool: {
      name: 'weave_restore_space',
      description: 'Restore a trashed space; its tables and records come back with it.',
      inputSchema: { type: 'object', properties: { space: { type: 'string' } }, required: ['space'] },
    },
    cli: { command: 'space', sub: 'restore', positional: ['space'] },
    http: { method: 'POST', path: '/api/spaces/:space/restore' },
    run: (w, a) => w.restoreSpace(a.space),
  },
  {
    name: 'table.create',
    engine: ['createTable'],
    writes: 'schema',
    tool: {
      name: 'weave_create_table',
      description: 'Create a table in a space (a Name text field and a Description document are added automatically). icon is `lucide:<name>` from weave_vocabulary.',
      inputSchema: {
        type: 'object',
        properties: { space: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' } },
        required: ['space', 'name'],
      },
    },
    cli: { command: 'table', sub: 'create', positional: ['space', 'name'], flags: ['description', 'icon'] },
    http: { method: 'POST', path: '/api/tables', status: 201 },
    run: (w, a) => guided(w, 'table', w.createTable({ space: a.space, name: a.name, description: a.description ?? '', icon: a.icon ?? '' })),
  },
  {
    name: 'table.list',
    engine: ['listTables'],
    writes: 'none',
    via: { tool: 'weave_schema' },
    cli: { command: 'table', sub: 'list', default: true, result: (r) => r.map((t) => t.qualified) },
    http: { method: 'GET', path: '/api/tables', args: (a, body, q) => ({ space: q.get('space') }) },
    run: (w, a) => w.listTables(a.space ? w.getSpace(a.space).id : null).map((db) => ({ id: db.id, name: db.name, qualified: w.qualifiedName(db), spaceId: db.spaceId, position: db.position })),
  },
  {
    name: 'table.update',
    engine: ['updateTable'],
    writes: 'schema',
    tool: {
      name: 'weave_update_table',
      description: 'Change a table: name, description, icon (`lucide:<name>` from weave_vocabulary or a mark character; anything else is refused), noun (what one record is called — stored as the Name field\'s `term`; "invoice" makes the create action read "New invoice" and the puck count "3 invoices"), systemFields (Created At, Modified At, Created By, Modified By), fieldOrder (the schema order — every field exactly once; the grid\'s columns are per view, see weave_table_view), hideRollups (the Σ row of space rollups pinned under the field headers: off unless a table asks for it, so pass `false` to show it and `true` to put it away again), position (its place inside its space, 0 first; weave_move_table changes the space).',
      inputSchema: {
        type: 'object',
        properties: {
          db: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
          icon: { type: 'string' }, noun: { type: 'string' },
          systemFields: { type: 'array', items: { type: 'string' } },
          fieldOrder: { type: 'array', items: { type: 'string' } },
          hideRollups: { type: 'boolean' },
          position: { type: 'number', description: 'Its place inside its space: 0 is the first table' },
        },
        required: ['db'],
      },
    },
    cli: { command: 'table', sub: 'update', positional: ['db'], flags: ['name', 'description', 'icon', 'noun', 'position'], args: (a, flags) => ({ ...a, ...(a.position != null ? { position: Number(a.position) } : {}), hiddenFields: list(flags.hidden), systemFields: list(flags.system), fieldOrder: list(flags.order), ...(flags['rollup-row'] != null ? { hideRollups: !['on', 'true', 'yes', '1', true].includes(flags['rollup-row']) } : {}) }) },
    http: { method: 'PATCH', path: '/api/tables/:db' },
    run: (w, a) => { const { db, ...patch } = a; return w.updateTable(db, defined(patch)); },
  },
  {
    name: 'table.view',
    engine: ['tableView'],
    writes: 'none',
    tool: {
      name: 'weave_table_view',
      description: 'A table\'s views, in order; the first (Standard) opens with the table. view "Task" lists them, "Task/Open" reads one, "Task/blank" is the raw table. Other keys write; a new name creates one (from: copy). fields: columns. show, hide. move: {field, before|after}. filters: {Field: [options]}. sort: [{field, dir}] ≤3. search. position: 0 first. widths: {field: px}. frozen. density: compact|comfortable|spacious. deleted: trash. rollups: Σ row. subtotals: all|top|none. layout: table|board; a board takes groups: stacked|side, picture: off|small|medium|large (gallery: stacked + picture, kanban: side), fit: crop|fit|original|capped, frame: 4:3|1:1|3:4|16:9, flow: masonry|rows. group: ≤5 levels, field or {field, heading: label|chip, order: option|table|az, dir, grain}. completedBy: checkbox. collapsed: paths. hideEmpty: no empty groups. order: #ids. phoneRow: {lead, chips, labels, wrap}. null clears; name renames; delete: true.',
      inputSchema: {
        type: 'object',
        properties: {
          view: { type: 'string' }, fields: { type: 'array' }, show: { type: 'array' }, hide: { type: 'array' },
          move: { type: 'object' }, filters: { type: 'object' }, sort: { type: 'array' }, search: {},
          position: { type: 'number' }, name: { type: 'string' }, from: { type: 'string' }, delete: { type: 'boolean' },
          widths: { type: 'object' }, frozen: { type: 'number' }, density: { type: 'string' }, deleted: { type: 'boolean' }, rollups: { type: ['boolean', 'null'] },
          layout: { type: 'string' }, subtotals: {}, groups: {}, picture: {}, fit: {}, frame: {}, flow: {}, group: {}, completedBy: {}, collapsed: {}, hideEmpty: {}, order: {}, phoneRow: {},
        },
        required: ['view'],
      },
    },
    cli: { command: 'table', sub: 'view', positional: ['view'], args: (a, flags, { json }) => ({ view: a.view, ...viewPatch(flags, json) }) },
    http: { method: 'GET', path: '/api/tables/:db/views', also: ['/api/tables/:db/views/:name'], args: (a) => ({ view: a.name === undefined ? a.db : `${a.db}/${a.name}` }) },
    run: (w, a) => {
      const { view, ...patch } = a;
      return w.tableView(view, Object.keys(patch).length ? patch : null);
    },
  },
  {
    name: 'table.view.set',
    engine: ['tableView'],
    writes: 'schema',
    via: { tool: 'weave_table_view', cli: 'table.view' },
    http: { method: 'PATCH', path: '/api/tables/:db/views/:name', args: (a, body) => ({ view: `${a.db}/${a.name}`, patch: body ?? {} }) },
    run: (w, a) => w.tableView(a.view, a.patch),
  },
  {
    name: 'table.view.delete',
    engine: ['tableView'],
    writes: 'schema',
    via: { tool: 'weave_table_view', cli: 'table.view' },
    http: { method: 'DELETE', path: '/api/tables/:db/views/:name', args: (a) => ({ view: `${a.db}/${a.name}` }) },
    run: (w, a) => w.tableView(a.view, { delete: true }),
  },
  {
    name: 'table.move',
    engine: ['moveTable'],
    writes: 'schema',
    tool: {
      name: 'weave_move_table',
      description: 'Move a table into another space. Only its home changes — every record, field and relation stays exactly as it was. It lands last there unless position says where (0 is the first table). Refuses when the destination already holds (or holds in its trash) a table of the same name.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, space: { type: 'string' }, position: { type: 'number' } }, required: ['db', 'space'] },
    },
    cli: { command: 'table', sub: 'move', positional: ['db', 'space'], flags: ['position'], args: (a) => ({ ...a, ...(a.position != null ? { position: Number(a.position) } : {}) }) },
    http: { method: 'POST', path: '/api/tables/:db/move' },
    run: (w, a) => { if (typeof a.space !== 'string' || !a.space.trim()) throw new WeaveError('space is required: the destination space', 'invalid'); return w.moveTable(a.db, a.space, { position: a.position ?? null }); },
  },
  {
    name: 'table.duplicate',
    engine: ['duplicateTable'],
    writes: 'schema',
    tool: {
      name: 'weave_duplicate_table',
      description: 'Duplicate a table\'s schema into a sibling named "<name> Copy" ("Copy 2", … until free) in the same space: every field with its full config, relations rebuilt as real paired fields (an external target grows a fresh inverse; a self-relation retargets into the copy), lookups and rollups re-pointed at the copy\'s own relation fields. Records are not copied — the copy starts empty.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' } }, required: ['db'] },
    },
    cli: { command: 'table', sub: 'duplicate', positional: ['db'] },
    http: { method: 'POST', path: '/api/tables/:db/duplicate', status: 201 },
    run: (w, a) => w.duplicateTable(a.db),
  },
  {
    name: 'table.delete',
    engine: ['deleteTable'],
    writes: 'schema',
    tool: {
      name: 'weave_delete_table',
      description: 'Move a table to the trash (recoverable — its records go dark with it). Pass hard: true to purge table and records for good.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, hard: { type: 'boolean' } }, required: ['db'] },
    },
    cli: { command: 'table', sub: 'delete', positional: ['db'], flags: ['hard'] },
    http: { method: 'DELETE', path: '/api/tables/:db', query: ['hard'] },
    run: (w, a) => { w.deleteTable(a.db, { hard: truthy(a.hard) }); return { ok: true, table: a.db, deleted: true, hard: truthy(a.hard) }; },
  },
  {
    name: 'table.restore',
    engine: ['restoreTable'],
    writes: 'schema',
    tool: {
      name: 'weave_restore_table',
      description: 'Restore a table out of the trash: the table, its records and their relations come back exactly as they were.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' } }, required: ['db'] },
    },
    cli: { command: 'table', sub: 'restore', positional: ['db'] },
    http: { method: 'POST', path: '/api/tables/:db/restore' },
    run: (w, a) => w.restoreTable(a.db),
  },
  {
    name: 'automation.create',
    engine: ['createAutomation'],
    writes: 'schema',
    tool: {
      name: 'weave_create_automation',
      description: 'Create an automation rule as a System/Workflows record; its Script holds the rule as JSON. enabled (default true) is the record\'s On: pass false to create it Off. trigger: {type: entity-created | field-updated | state-changed, field?, toState?} or {type: schedule, cron: "0 9 * * 1-5", zone?: IANA zone (UTC by default), where?: a query filter}: a schedule fires on its cron minute in its zone, once for every live record of the table the where clause admits, and a box that slept catches up with one run. actions: [{type: set-field, field, value} | {type: append-doc, text} | {type: add-comment, text} | {type: webhook, url, signWith?: the name of a keystore credential, never its value; weave then signs the delivery with an X-Weave-Signature header holding the HMAC-SHA256 of <X-Weave-Timestamp>.<body>, beside an X-Weave-Delivery uuid} | {type: upsert-row, table, key, fields: {targetField: sourcePath}} | {type: http-request, method?: POST by default, url: https://host/path, headers?, body?: text or JSON with templates, integration?: the Name of a System/Integrations record whose key weave adds and never reveals, its Host must be the url host, signWith?: a keystore credential name, signed as on webhook, response?: {field: path in the JSON answer}}: a 4xx answer fails the run and stops later steps; a network error, a timeout, 408, 429 or 5xx is retried with backoff, eight attempts, then lands in System/Failed Deliveries] — upsert-row creates or updates a record of another table matched on its key field (text, number, url or email); source paths read record.<Field>, row.PublicId and event.type/field/toState; select values by option name, relations by target Name. text supports {{FieldName}}, {{PublicId}}, {{Today}} (the workspace date format; {{Today:iso}} for 2026-10-06) and {{steps.N.path}} templates: every action yields an output (set-field {field, value}; append-doc {field, text}; add-comment {id, text}; upsert-row {id, publicId, name, created}; webhook {url, sent}; http-request {status, ok, body}) that later actions read as steps.N in text, in a set-field string value and in upsert-row source paths.',
      inputSchema: {
        type: 'object',
        properties: { db: { type: 'string' }, name: { type: 'string' }, trigger: { type: 'object' }, actions: { type: 'array' }, enabled: { type: 'boolean' } },
        required: ['db', 'trigger', 'actions'],
      },
    },
    cli: {
      command: 'automation', sub: 'create', positional: ['db'],
      args: (a, flags, { json }) => ({ db: a.db, name: flags.name, trigger: json('trigger'), actions: json('actions') ?? [], enabled: flags.enabled !== 'false' }),
    },
    http: { method: 'POST', path: '/api/automations', status: 201 },
    run: (w, a) => w.createAutomation(a.db, { name: a.name, trigger: a.trigger, actions: a.actions, enabled: a.enabled }),
  },
  {
    name: 'automation.list',
    engine: ['listAutomations'],
    writes: 'none',
    tool: AUTOMATIONS_TOOL,
    action: 'list',
    cli: { command: 'automation', sub: 'list', positional: ['db'], default: true, args: (a, flags) => ({ db: a.db ?? flags.db ?? null }), result: (r) => r.automations },
    http: { method: 'GET', path: '/api/automations/list', query: ['db'], result: (r) => r.automations },
    run: (w, a) => ({ automations: w.listAutomations(a.db ?? null) }),
  },
  {
    name: 'automation.describe',
    engine: ['describeAutomations'],
    writes: 'none',
    tool: AUTOMATIONS_TOOL,
    action: 'describe',
    cli: { command: 'automation', sub: 'describe', positional: ['db'], args: (a, flags) => ({ db: a.db ?? flags.db ?? null }), result: (r) => r.rules },
    http: { method: 'GET', path: '/api/automations', query: ['db'], result: (r) => r.rules },
    run: (w, a) => ({ rules: w.describeAutomations(a.db ?? null) }),
  },
  {
    name: 'automation.update',
    engine: ['updateAutomation'],
    writes: 'schema',
    tool: AUTOMATIONS_TOOL,
    action: 'update',
    cli: { command: 'automation', sub: 'update', positional: ['automation'], args: (a, flags, { json }) => ({ automation: a.automation, patch: json('patch') ?? {} }) },
    http: { method: 'PATCH', path: '/api/automations/:automation', args: (a, body) => ({ automation: a.automation, patch: body }) },
    run: (w, a) => w.updateAutomation(a.automation, a.patch ?? {}),
  },
  {
    name: 'automation.delete',
    engine: ['deleteAutomation'],
    writes: 'schema',
    tool: AUTOMATIONS_TOOL,
    action: 'delete',
    cli: { command: 'automation', sub: 'delete', positional: ['automation'] },
    http: {
      method: 'DELETE', path: '/api/automations/:automation',
      result: (r) => { if (!r.deleted) throw new WeaveError(`No automation '${r.id}'`, 'not-found'); return r; },
    },
    run: (w, a) => w.deleteAutomation(a.automation),
  },
  {
    name: 'automation.replay',
    engine: ['replayDelivery'],
    writes: 'entity',
    tool: AUTOMATIONS_TOOL,
    action: 'replay',
    cli: { command: 'automation', sub: 'replay', positional: ['delivery'] },
    http: { method: 'POST', path: '/api/automations/deliveries/:delivery/replay' },
    run: (w, a) => w.replayDelivery(a.delivery),
  },
  {
    name: 'key.list',
    engine: ['listKeys'],
    writes: 'none',
    tool: KEYS_TOOL,
    action: 'list',
    cli: { command: 'key', sub: 'list', default: true, result: (r) => r.keys },
    http: { method: 'GET', path: '/api/keys', result: (r) => r.keys },
    run: (w) => ({ keys: w.listKeys() }),
  },
  {
    name: 'key.set',
    engine: ['setKey'],
    writes: 'keystore',
    tool: KEYS_TOOL,
    action: 'set',
    cli: { command: 'key', sub: 'set', positional: ['name'], flags: ['value'], args: (a, flags, { stdin }) => ({ name: a.name, value: a.value ?? stdin().trim() }) },
    http: { method: 'POST', path: '/api/keys', status: 201 },
    run: (w, a) => w.setKey(a.name, a.value),
  },
  {
    name: 'key.reveal',
    engine: ['revealKey'],
    writes: 'keystore',
    tool: KEYS_TOOL,
    action: 'reveal',
    toolRefusal: 'Revealing a secret is not an agent action — use `weave key reveal` or the app.',
    cli: { command: 'key', sub: 'reveal', positional: ['name'], args: (a, flags) => ({ name: a.name, via: flags.copy ? 'copy' : 'show' }), result: (r) => r.value },
    http: { method: 'POST', path: '/api/keys/:name/reveal' },
    run: (w, a) => ({ name: a.name, value: w.revealKey(a.name, { via: a.via ?? 'show' }) }),
  },
  {
    name: 'key.share',
    engine: ['grantKey'],
    writes: 'keystore',
    tool: KEYS_TOOL,
    action: 'share',
    cli: { command: 'key', sub: 'share', positional: ['name'], args: (a, flags) => ({ name: a.name, account: flags.with }) },
    http: { method: 'POST', path: '/api/keys/:name/share' },
    run: (w, a) => w.grantKey(a.name, a.account),
  },
  {
    name: 'key.unshare',
    engine: ['revokeKey'],
    writes: 'keystore',
    tool: KEYS_TOOL,
    action: 'unshare',
    cli: { command: 'key', sub: 'unshare', positional: ['name'], args: (a, flags) => ({ name: a.name, account: flags.with }) },
    http: { method: 'DELETE', path: '/api/keys/:name/share', body: true },
    run: (w, a) => w.revokeKey(a.name, a.account),
  },
  {
    name: 'key.delete',
    engine: ['deleteKey'],
    writes: 'keystore',
    tool: KEYS_TOOL,
    action: 'delete',
    cli: { command: 'key', sub: 'delete', positional: ['name'] },
    http: { method: 'DELETE', path: '/api/keys/:name*' },
    run: (w, a) => w.deleteKey(a.name),
  },
  {
    name: 'key.migrate',
    engine: ['migrateKeys'],
    writes: 'keystore',
    tool: KEYS_TOOL,
    action: 'migrate',
    toolRefusal: 'Moving the key store is not an agent action: run `weave key migrate --to keychain` or `--to file` on the machine that holds it.',
    cli: { command: 'key', sub: 'migrate', flags: ['to'] },
    http: { method: 'POST', path: '/api/keys/migrate' },
    run: (w, a) => w.migrateKeys(a.to),
  },
  {
    name: 'csv.export',
    engine: ['exportCSV'],
    writes: 'none',
    tool: {
      name: 'weave_export_csv',
      description: 'Export a table as CSV: one record per entity, one column per field, computed fields resolved. Multiselect and to-many relation cells use "; " separators.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' } }, required: ['db'] },
    },
    cli: { command: 'csv', sub: 'export', positional: ['db'], default: 'positional', raw: true },
    http: { method: 'GET', path: '/api/tables/:db/export.csv', type: 'text/csv; charset=utf-8' },
    run: (w, a) => w.exportCSV(a.db),
  },
  {
    name: 'csv.import',
    engine: ['importCSV'],
    writes: 'entity',
    tool: {
      name: 'weave_import_csv',
      description: 'Import entities from CSV text. The header row maps to field names; multiselect and to-many relation cells use "; " separators. Computed fields and Public Id/Created At/Updated At columns are ignored.',
      inputSchema: { type: 'object', properties: { db: { type: 'string' }, csv: { type: 'string' } }, required: ['db', 'csv'] },
    },
    cli: { command: 'csv', sub: 'import', positional: ['db'], flags: ['file'], args: (a, flags, { stdin, file }) => ({ db: a.db, csv: a.file ? file(a.file) : stdin() }) },
    http: { method: 'POST', path: '/api/tables/:db/import.csv', args: (a) => ({ db: a.db, csv: a.csv ?? '' }) },
    run: (w, a) => w.importCSV(a.db, a.csv),
  },
  {
    name: 'activity',
    engine: ['activityFeed', 'getActivity'],
    writes: 'none',
    tool: {
      name: 'weave_activity',
      description: 'The activity feed: every change weave recorded, newest first. Filter by entity, table, kinds, or since (ISO timestamp); pass id to read one event in full. Answers one page of 500 when you name no limit, with `total` counting every event in scope: page with offset, or pass limit -1 for the whole log. Each entity keeps its newest 500 entries; `dropped` counts the older ones in scope that are no longer kept.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' }, entity: { type: 'string' }, table: { type: 'string' },
          kinds: { type: 'array', items: { type: 'string' } }, since: { type: 'string' },
          limit: { type: 'number' }, offset: { type: 'number' },
        },
      },
    },
    cli: {
      command: 'activity', positional: ['id'],
      args: (a, flags, { entityRef }) => (a.id ? { id: a.id } : {
        entity: flags.entity ? entityRef(flags.entity, flags.db) : null,
        table: flags.table ?? null,
        kinds: flags.kinds ? list(flags.kinds) : null,
        since: flags.since ?? null,
        limit: cliNumber('limit', flags.limit),
      }),
    },
    http: {
      method: 'GET', path: '/api/activity/:id*?',
      args: (a, body, q) => (a.id ? { id: a.id } : {
        entity: q.get('entity'), table: q.get('table'), kinds: q.getAll('kind'), since: q.get('since'),
        limit: boundedLimit(q.get('limit')), offset: nonNegativeInteger('offset', q.get('offset')),
      }),
    },
    run: (w, a) => (a.id ? w.getActivity(a.id) : w.activityFeed({
      entityId: a.entity ?? null, tableRef: a.table ?? null, kinds: a.kinds ?? null, since: a.since ?? null,
      limit: a.limit ?? null, offset: a.offset ?? 0,
    })),
  },
  {
    name: 'audit',
    engine: ['listAudit'],
    writes: 'none',
    tool: {
      name: 'weave_audit',
      description: 'The workspace audit log: schema and account events with their actor.',
      inputSchema: { type: 'object', properties: { limit: { type: 'number' }, since: { type: 'string' } } },
    },
    cli: { command: 'audit', args: (a, flags) => ({ limit: cliNumber('limit', flags.limit, 50) }), result: (r) => r.events },
    http: {
      method: 'GET', path: '/api/audit',
      args: (a, body, q) => ({ limit: boundedLimit(q.get('limit'), 100), offset: nonNegativeInteger('offset', q.get('offset')) }),
      result: (r) => r.events,
    },
    run: (w, a) => ({ events: w.listAudit(defined({ limit: a.limit ?? undefined, since: a.since ?? null, offset: a.offset })) }),
  },
  {
    name: 'registry.report',
    engine: ['registryReport'],
    writes: 'none',
    tool: REGISTRY_TOOL,
    action: 'report',
    toolDefault: true,
    cli: { command: 'registry', sub: 'report', default: true },
    http: { method: 'GET', path: '/api/registry' },
    run: (w) => w.registryReport(),
  },
  {
    name: 'registry.rebuild',
    engine: ['rebuildRegistry'],
    writes: 'schema',
    tool: REGISTRY_TOOL,
    action: 'rebuild',
    cli: { command: 'registry', sub: 'rebuild' },
    http: { method: 'POST', path: '/api/registry/rebuild' },
    run: (w) => w.rebuildRegistry(),
  },
  {
    name: 'relation.map',
    engine: ['relationMapMmd'],
    writes: 'none',
    tool: {
      name: 'weave_relation_map',
      description: 'The workspace relation map as a mermaid diagram: every table, relation and automation.',
      inputSchema: { type: 'object', properties: {} },
    },
    cli: { command: 'map', result: (r) => r.mermaid },
    http: { method: 'GET', path: '/api/relation-map.mmd', result: (r) => r.mermaid },
    run: (w) => ({ mermaid: w.relationMapMmd() }),
  },
  {
    name: 'entity.restore',
    engine: ['restoreEntity'],
    writes: 'entity',
    tool: {
      name: 'weave_restore_entity',
      description: 'Restore a soft-deleted entity from the trash, links intact.',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' } }, required: ['entity'] },
    },
    cli: { command: 'restore', positional: ['entity'], args: (a, flags, { entityRef }) => ({ entity: entityRef(a.entity, flags.db) }) },
    http: { method: 'POST', path: '/api/entities/:entity/restore' },
    run: (w, a) => w.restoreEntity(a.entity),
  },
  {
    name: 'entity.state',
    engine: ['setState'],
    writes: 'entity',
    tool: {
      name: 'weave_set_state',
      description: 'Move an entity to a workflow state (multistate field).',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string' }, state: { type: 'string' } }, required: ['entity', 'field', 'state'] },
    },
    cli: { command: 'state', positional: ['entity', 'field'], rest: 'state', args: (a, flags, { entityRef }) => ({ entity: entityRef(a.entity, flags.db), field: a.field, state: a.state.join(' ') }) },
    http: { method: 'POST', path: '/api/entities/:entity/state' },
    run: (w, a, ctx) => { w.setState(a.entity, a.field, a.state); return w.readEntity(a.entity, { viewerZone: ctx?.viewerZone }); },
  },
  {
    name: 'entity.link',
    engine: ['link'],
    writes: 'entity',
    tool: {
      name: 'weave_link',
      description: 'Link entities through a relation field (bidirectional; inverse side updates automatically).',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string' }, targets: { type: 'array', items: { type: 'string' } } }, required: ['entity', 'field', 'targets'] },
    },
    cli: { command: 'link', positional: ['entity', 'field'], rest: 'targets', use: (flags) => (flags.unlink ? 'entity.unlink' : null), args: linkArgs },
    http: { method: 'POST', path: '/api/entities/:entity/link', args: linkBody },
    run: (w, a, ctx) => { w.link(a.entity, a.field, a.targets); return w.readEntity(a.entity, { viewerZone: ctx?.viewerZone }); },
  },
  {
    name: 'entity.unlink',
    engine: ['unlink'],
    writes: 'entity',
    tool: {
      name: 'weave_unlink',
      description: 'Remove entities from a relation field, leaving both entities in place. targets takes ids, names, or "#publicId"; the inverse field on the other table follows.',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string' }, targets: { type: 'array', items: { type: 'string' } } }, required: ['entity', 'field', 'targets'] },
    },
    cli: { command: 'unlink', positional: ['entity', 'field'], rest: 'targets', args: linkArgs },
    http: { method: 'POST', path: '/api/entities/:entity/unlink', args: linkBody },
    run: (w, a, ctx) => { w.unlink(a.entity, a.field, a.targets); return w.readEntity(a.entity, { viewerZone: ctx?.viewerZone }); },
  },
  {
    name: 'entity.create',
    engine: ['createEntity'],
    writes: 'entity',
    tool: {
      name: 'weave_create_entity',
      description: 'Create an entity. values maps field names to values; relation fields accept entity names, ids, or "#publicId".',
      inputSchema: {
        type: 'object',
        properties: {
          db: { type: 'string' },
          name: { type: 'string' },
          values: { type: 'object' },
          doc: { type: 'string', description: 'Initial markdown for the default document field' },
          docs: { type: 'object', description: 'Initial markdown per document field name, e.g. {"Description": "...", "Spec": "..."}' },
        },
        required: ['db'],
      },
    },
    cli: { command: 'create', positional: ['db', 'name'], args: (a, flags, { json }) => ({ db: a.db, input: { name: a.name, values: json('values') ?? {}, doc: flags.doc === true ? '' : flags.doc } }) },
    http: { method: 'POST', path: '/api/tables/:db/entities', status: 201, args: (a, body) => ({ db: a.db, input: body }) },
    run: (w, a, ctx) => withSecret(w, w.createEntity(a.db, a.input ?? { name: a.name, values: a.values, doc: a.doc, docs: a.docs }, zoned(ctx)).id, ctx),
  },
  {
    name: 'entity.read',
    engine: ['readEntity', 'getEntity', 'listEntities'],
    writes: 'none',
    tool: {
      name: 'weave_get_entity',
      description: 'Read one entity in full: all field values (including computed lookups/rollups/formulas), document markdown, comments, activity.',
      inputSchema: { type: 'object', properties: { entity: { type: 'string', description: 'Entity id or "Table#publicId"' } }, required: ['entity'] },
    },
    cli: { command: 'get', positional: ['entity'], args: (a, flags, { entityRef }) => ({ entity: entityRef(a.entity, flags.db) }) },
    http: { method: 'GET', path: '/api/entities/:entity' },
    run: (w, a, ctx) => w.readEntity(a.entity, zoned(ctx)),
  },
  {
    name: 'entity.update',
    engine: ['updateEntity', 'touching', 'affectedBy'],
    writes: 'entity',
    tool: {
      name: 'weave_update_entity',
      description: 'Update entity field values by name (writable fields only; computed fields are read-only).',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, values: { type: 'object' } }, required: ['entity', 'values'] },
    },
    toolResult: withoutAffected,
    cli: { command: 'update', positional: ['entity'], args: (a, flags, { entityRef, json }) => ({ entity: entityRef(a.entity, flags.db), values: json('values') ?? {} }), result: withoutAffected },
    http: {
      method: 'PATCH', path: '/api/entities/:entity',
      args: (a, body) => ({ entity: a.entity, values: body?.values ?? body }),
      fail: (err, w, a, ctx) => (err?.code === 'stale' ? [412, { ...errorBody(err), entity: w.readEntity(a.entity, zoned(ctx)) }] : null),
    },
    run: (w, a, ctx) => {
      const expectedRevision = ctx?.expectedRevision ?? null;
      const { touched } = w.touching(() => w.updateEntity(a.entity, a.values, { expectedRevision }));
      return { ...w.readEntity(a.entity, zoned(ctx)), affected: w.affectedBy(a.entity, touched) };
    },
  },
  {
    name: 'entity.delete',
    engine: ['deleteEntity'],
    writes: 'entity',
    tool: {
      name: 'weave_delete_entity',
      description: 'Delete an entity. Recoverable by default — it moves to the trash keeping its id, public id and links. Pass hard: true to purge it irreversibly (relations are unlinked cleanly).',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, hard: { type: 'boolean' } }, required: ['entity'] },
    },
    cli: { command: 'delete', positional: ['entity'], args: (a, flags, { entityRef }) => ({ entity: entityRef(a.entity, flags.db), hard: Boolean(flags.hard) }) },
    http: { method: 'DELETE', path: '/api/entities/:entity', query: ['hard'], args: (a) => ({ entity: a.entity, hard: truthy(a.hard) }), result: (r) => ({ ok: true, ...r }) },
    run: (w, a) => w.deleteEntity(a.entity, { hard: Boolean(a.hard) }),
  },
  {
    name: 'entity.query',
    engine: ['query'],
    writes: 'none',
    tool: {
      name: 'weave_query',
      description: 'Query a table. 200 a page: `total` counts every match, `nextOffset` is the next page\'s `offset` while more remain, `limit: -1` reads the whole table. Filters support dotted relation paths (e.g. ["Project.Name", "=", "Apollo"]). Operators: =, !=, <, <=, >, >=, contains, in, is-empty, not-empty. Combine with {and:[...]} / {or:[...]}.',
      inputSchema: {
        type: 'object',
        properties: {
          db: { type: 'string', description: 'Table name, Space/Name, or id' },
          where: { description: 'Array of [path, op, value] conditions (AND) or {and/or} tree' },
          sort: { description: 'Array of field names or {field, dir} objects' },
          limit: { type: 'number' },
          offset: { type: 'number' },
          select: { type: 'array', items: { type: 'string' }, description: 'Field paths to return (omit for full entities)' },
          fields: { type: 'array', items: { type: 'string' }, description: 'Keep the entity shape but only these fields (a system column name works too). Comments, activity and files are left out. Not with select.' },
          relations: { type: 'string', enum: ['full', 'chip'], description: 'Default chip: a relation value is { id, publicId, name } and each related record\'s summary is sent once, in chips (keyed by id). full: every record embeds its related records\' summaries.' },
          includeDeleted: { type: 'boolean', description: 'Also return soft-deleted (trashed) entities' },
          trashCount: { type: 'boolean', description: 'Also return trashCount: how many of the table\'s records are in the trash' },
          countAll: { type: 'boolean', description: 'Also return all: the table\'s undeleted records before where and search' },
          search: { type: 'string', description: 'Only the records weave_search finds here: name, publicId, text fields, documents, comments. Composes with where and sort; total counts them.' },
          view: { type: 'string', description: 'A saved view (id or name): its filters AND where; its sort and search apply unless you pass yours; grouped adds groups and groupTotal.' },
          groupBy: { type: 'string', description: 'Like view, groups only: no filters or search.' },
          shape: { type: 'string', enum: ['full', 'row'], description: 'Default full: every row carries the whole entity envelope. row: a lean list row of id, publicId, name, fields and the raw values that differ from their display value.' },
        },
        required: ['db'],
      },
    },
    cli: {
      command: 'query', positional: ['db'],
      args: (a, flags, { json }) => ({
        db: a.db,
        options: {
          where: json('where') ?? [],
          select: csvList(flags.select),
          fields: csvList(flags.fields),
          relations: flags.relations ? String(flags.relations) : 'full',
          shape: flags.shape ? String(flags.shape) : 'full',
          sort: flags.sort ? [String(flags.sort)] : [],
          limit: cliNumber('limit', flags.limit),
          offset: nonNegativeInteger('--offset', flags.offset === true ? 'true' : flags.offset),
          search: flags.search ? String(flags.search) : '',
          countAll: Boolean(flags['count-all']),
          view: flags.view ? String(flags.view) : null,
          groupBy: flags['group-by'] ? String(flags['group-by']) : null,
        },
      }),
    },
    http: { method: 'POST', path: '/api/tables/:db/query', args: (a, body) => ({ db: a.db, options: { ...body, limit: body?.limit == null ? QUERY_PAGE : boundedLimit(body.limit) } }) },
    run: (w, a, ctx) => w.query(a.db, { ...(a.options ?? queryOptions(a)), viewerZone: ctx?.viewerZone, workspace: ctx?.workspace }),
  },
  {
    name: 'entity.trash',
    engine: ['listTrash'],
    writes: 'none',
    tool: {
      name: 'weave_trash',
      description: 'List deleted entities — one table, or the whole workspace when table is omitted.',
      inputSchema: { type: 'object', properties: { table: { type: 'string' } } },
    },
    cli: { command: 'trash', positional: ['table'], result: (r) => r.items },
    http: {
      method: 'GET', path: '/api/tables/:table/trash', also: ['/api/trash'],
      result: ({ items }, a, ctx, w) => (a.table != null ? { total: items.length, items }
        : { total: items.length, items, views: w.listViews({ trash: true }), purge: !ctx.cap || ctx.cap === 'architect' || ctx.cap === 'editor' }),
    },
    run: (w, a, ctx) => ({ items: w.listTrash(a.table ?? null, { workspace: ctx?.workspace ?? null }) }),
  },
  {
    name: 'table.stats',
    engine: ['tableStats', 'tableRollups'],
    writes: 'none',
    tool: {
      name: 'weave_stats',
      description: 'Summarise every column of a table in one read: numbers get filled/empty, sum, avg, median, min, max, p25, p75, range, stdev and a 10-bin histogram (raw and dressed in the column\'s costume); selects, multiselects, workflows, checkboxes and relations get a ranked distribution; dates get earliest, latest, the span in days and counts by month; text gets the distinct count. `rollups` lists the space rollups pointed at the table with their live values. `by` groups the numeric columns on one field (with group rollups) (a multiselect record counts in every chip it wears); `where` narrows the records with the same clauses as weave_query; `field` narrows the answer to one column and the rollups over it (the record count rides with the name column). Nothing is stored; to keep a figure, add a rollup on the System/Spaces record (weave_add_field, config.via).',
      inputSchema: { type: 'object', properties: { table: { type: 'string' }, by: { type: 'string' }, where: {}, field: { type: 'string' } }, required: ['table'] },
    },
    cli: {
      command: 'stats', positional: ['table'],
      args: (a, flags) => {
        if (!a.table) throw new Error('Usage: stats <table> [--by Field] [--where json] [--field F]');
        return { table: a.table, by: flags.by ?? null, where: flags.where ? JSON.parse(flags.where) : null, field: flags.field ?? null };
      },
    },
    http: {
      method: 'GET', path: '/api/tables/:table/stats',
      args: (a, body, q) => ({ table: a.table, by: q.get('by') || null, field: q.get('field') || null, where: whereJson(q.get('where')) }),
      fail: (err) => (err?.whereJson ? [400, { error: err.message }] : null),
    },
    run: (w, a) => w.tableStats(a.table, { by: a.by ?? null, where: a.where ?? null, field: a.field ?? null }),
  },
  {
    name: 'entity.bulk',
    engine: ['bulk'],
    writes: 'entity',
    tool: {
      name: 'weave_bulk',
      description: 'One write for a whole selection. op "set" writes values across every id; "link" links every id to targets through field; "move" re-creates each id in table by field name (same name, same type — unmatched fields, files and comments stay behind and are named in moved[].skipped) and trashes the original; "rollup" creates one parent (name/values) in field\'s target table (or table) and links every id to it. Each record is its own attempt: done names what landed, failed names what did not and why. Each record keeps its own undo step.',
      inputSchema: { type: 'object', properties: {
        ids: { type: 'array', items: { type: 'string' } },
        op: { type: 'string', enum: ['set', 'link', 'move', 'rollup'] },
        values: { type: 'object', description: 'set: the values to write; rollup: the parent\'s values' },
        field: { type: 'string', description: 'link / rollup: the relation field' },
        targets: { type: 'array', items: { type: 'string' }, description: 'link: the records to link to' },
        table: { type: 'string', description: 'move: the destination; rollup: overrides the relation\'s target table' },
        name: { type: 'string', description: 'rollup: the new parent\'s name' },
      }, required: ['ids', 'op'] },
    },
    cli: {
      command: 'bulk', positional: ['op'], rest: 'refs',
      args: (a, flags, { json, entityRef }) => {
        const ids = a.refs.map((r) => entityRef(r, flags.db));
        const params = {};
        for (const n of ['field', 'table', 'name']) if (flags[n] != null && flags[n] !== true) params[n] = flags[n];
        const values = json('values');
        if (values) params.values = values;
        if (flags.targets != null) params.targets = list(flags.targets);
        return { ...params, ids, op: a.op };
      },
    },
    http: { method: 'POST', path: '/api/bulk' },
    run: (w, a) => { const { ids, op, ...params } = a; return w.bulk(ids, op, params); },
  },
  {
    name: 'doc.read',
    engine: ['getDoc'],
    writes: 'none',
    tool: {
      name: 'weave_get_doc',
      description: 'Read an entity document as markdown. Entities can carry several document fields; omit field for the default (the table\'s first document field, usually "Description").',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string', description: 'Document field name (optional)' } }, required: ['entity'] },
    },
    cli: { command: 'doc', sub: 'get', positional: ['entity'], args: (a, flags, { entityRef }) => ({ entity: entityRef(a.entity, flags.db), field: docField(flags) }) },
    http: { method: 'GET', path: '/api/entities/:entity/doc', query: ['field'], result: (doc, a) => ({ field: a.field ?? null, doc }) },
    run: (w, a) => w.getDoc(a.entity, a.field ?? null),
  },
  {
    name: 'doc.set',
    engine: ['setDoc', 'docBase'],
    writes: 'entity',
    tool: SET_DOC_TOOL,
    action: 'replace',
    actionArg: 'mode',
    toolDefault: true,
    cli: { command: 'doc', sub: 'set', positional: ['entity'], args: docWriteArgs('set'), result: docWritten },
    http: {
      method: 'PUT', path: '/api/entities/:entity/doc', query: ['field'], args: docWriteBody,
      result: (r, a, ctx, w) => ({ ok: true, base: w.docBase(a.entity, a.field ?? null) }),
      fail: (err, w, a, ctx) => (err?.code === 'stale' ? [412, { ...errorBody(err), entity: w.readEntity(a.entity, zoned(ctx)), base: w.docBase(a.entity, a.field ?? null) }] : null),
    },
    run: (w, a) => { w.setDoc(a.entity, a.markdown, a.field ?? null, { base: a.base ?? null }); return { ok: true, length: w.getDoc(a.entity, a.field ?? null).length }; },
  },
  {
    name: 'doc.append',
    engine: ['appendDoc'],
    writes: 'entity',
    tool: SET_DOC_TOOL,
    action: 'append',
    actionArg: 'mode',
    cli: { command: 'doc', sub: 'append', positional: ['entity'], args: docWriteArgs('append'), result: docWritten },
    http: { method: 'POST', path: '/api/entities/:entity/doc', query: ['field'], args: docWriteBody, result: docWritten },
    run: (w, a) => { w.appendDoc(a.entity, a.markdown, a.field ?? null); return { ok: true, length: w.getDoc(a.entity, a.field ?? null).length }; },
  },
  {
    name: 'doc.revisions',
    engine: ['listDocRevisions', 'getDocRevision'],
    writes: 'none',
    tool: {
      name: 'weave_doc_revisions',
      description: 'A document\'s version history (Feature #225). Without seq: the revisions newest first as {seq, at, actor, len} — one per editing session (writes by one actor inside ten minutes fold into one). With seq: that revision with its text. field picks a document field; omit for the default.',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string', description: 'Document field name (optional)' }, seq: { type: 'number', description: 'A revision seq from the list — returns its text' }, limit: { type: 'number', description: 'How many to list (default 50)' } }, required: ['entity'] },
    },
    cli: {
      command: 'doc-revisions', positional: ['entity'],
      args: (a, flags, { entityRef }) => {
        const entity = entityRef(a.entity, flags.db);
        const field = docField(flags);
        return flags.seq != null && flags.seq !== true ? { entity, field, seq: Number(flags.seq) } : { entity, field, limit: cliNumber('limit', flags.limit, 50) };
      },
    },
    http: {
      method: 'GET', path: '/api/entities/:entity/doc/revisions/:seq?',
      args: (a, body, q) => (a.seq != null ? { entity: a.entity, field: q.get('field') ?? null, seq: a.seq } : { entity: a.entity, field: q.get('field') ?? null, limit: boundedLimit(q.get('limit'), 50) }),
    },
    run: (w, a) => (a.seq != null ? w.getDocRevision(a.entity, a.field ?? null, a.seq) : w.listDocRevisions(a.entity, a.field ?? null, { limit: a.limit ?? 50 })),
  },
  {
    name: 'doc.restore',
    engine: ['restoreDocRevision'],
    writes: 'entity',
    tool: {
      name: 'weave_doc_restore',
      description: 'Write a past revision back as the document\'s current text (Feature #225). An ordinary write: activity, undo and automations all see it, and the history keeps both the restored text and what it replaced.',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, seq: { type: 'number' }, field: { type: 'string', description: 'Document field name (optional)' } }, required: ['entity', 'seq'] },
    },
    cli: {
      command: 'doc-restore', positional: ['entity'],
      args: (a, flags, { entityRef }) => {
        const entity = entityRef(a.entity, flags.db);
        const field = docField(flags);
        if (flags.seq == null || flags.seq === true) throw new WeaveError('--seq is required: a revision from doc-revisions');
        return { entity, field, seq: Number(flags.seq) };
      },
    },
    http: { method: 'POST', path: '/api/entities/:entity/doc/revisions/:seq/restore' },
    run: (w, a) => w.restoreDocRevision(a.entity, a.field ?? null, a.seq),
  },
  {
    name: 'comment.add',
    engine: ['addComment'],
    writes: 'entity',
    tool: {
      name: 'weave_add_comment',
      description: 'Add a comment to an entity. Comments are their own thread on the entity page and ride the activity feed; delete one with weave_delete_comment.',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, text: { type: 'string' }, author: { type: 'string' } }, required: ['entity', 'text'] },
    },
    cli: { command: 'comment', positional: ['entity'], rest: 'text', args: (a, flags, { entityRef }) => ({ entity: entityRef(a.entity, flags.db), input: { author: flags.author ?? 'cli', text: a.text.join(' ') } }) },
    http: { method: 'POST', path: '/api/entities/:entity/comments', status: 201, args: (a, body, q, ctx) => ({ entity: a.entity, input: ctx.author !== undefined ? { ...body, author: ctx.author } : body }) },
    run: (w, a, ctx) => w.addComment(a.entity, a.input ?? { author: commentAuthor(w, a, ctx), text: a.text }),
  },
  {
    name: 'comment.delete',
    engine: ['deleteComment'],
    writes: 'entity',
    tool: {
      name: 'weave_delete_comment',
      description: 'Delete one comment from an entity. The comment id comes from weave_get_entity.',
      inputSchema: { type: 'object', properties: { entity: { type: 'string' }, comment: { type: 'string' } }, required: ['entity', 'comment'] },
    },
    cli: { command: 'comment', sub: 'delete', positional: ['entity', 'comment'], args: (a, flags, { entityRef }) => ({ entity: entityRef(a.entity, flags.db), comment: a.comment }) },
    http: { method: 'DELETE', path: '/api/entities/:entity/comments/:comment', result: () => ({ ok: true }) },
    run: (w, a) => w.deleteComment(a.entity, a.comment),
  },
  {
    name: 'search',
    engine: ['search', 'universalSearch'],
    writes: 'none',
    tool: {
      name: 'weave_search',
      description: 'Universal search across the workspace, spaces, tables, saved views, and entities (names, publicIds, text fields, documents, comments). Every result carries a stable permalink url. limit bounds entity records only; every matching workspace, space, table and view is always returned.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    },
    cli: { command: 'search', rest: 'words', args: (a, flags) => ({ query: a.words.join(' '), limit: cliNumber('limit', flags.limit, 25), [RECORDS]: true }) },
    http: {
      method: 'GET', path: '/api/search',
      args: (a, body, q) => defined({ query: q.get('q') ?? '', limit: boundedLimit(q.get('limit'), 25), tables: q.get('tables') == null ? undefined : list(q.get('tables')) }),
    },
    run: (w, a) => (a[RECORDS] ? w.search(a.query, { limit: a.limit }) : w.universalSearch(a.query, defined({ limit: a.limit ?? 25, tables: a.tables }))),
  },
  {
    name: 'undo.list',
    engine: ['listUndo'],
    writes: 'none',
    tool: UNDO_TOOL,
    action: true,
    actionArg: 'list',
    cli: { command: 'undo', sub: 'list', args: (a, flags) => ({ limit: cliNumber('limit', flags.limit, 20) }), result: (r) => r.history },
    http: { method: 'GET', path: '/api/undo', args: (a, body, q) => ({ limit: boundedLimit(q.get('limit'), 20) }), result: (r) => r.history },
    run: (w, a) => ({ history: w.listUndo({ limit: a.limit == null ? 20 : Number(a.limit) }) }),
  },
  {
    name: 'undo.run',
    engine: ['undo'],
    writes: 'entity',
    tool: UNDO_TOOL,
    action: false,
    actionArg: 'list',
    toolDefault: true,
    cli: { command: 'undo', use: (flags) => (flags.list ? 'undo.list' : null), args: (a, flags) => ({ steps: flags.steps }) },
    http: { method: 'POST', path: '/api/undo' },
    run: (w, a) => w.undo({ steps: Math.max(1, Number(a.steps ?? 1)) }),
  },
  {
    name: 'json.export',
    engine: ['exportJSON'],
    writes: 'none',
    tool: {
      name: 'weave_export_json',
      description: 'The whole workspace as JSON — the human-readable interchange format, and the backup to take before a destructive apply. Attachment bytes are left out unless blobs is true; `weave export` always carries them.',
      inputSchema: { type: 'object', properties: { blobs: { type: 'boolean' } } },
    },
    cli: {
      command: 'export', args: () => ({ blobs: true }),
      result: (r, flags, { write }) => {
        const dump = JSON.stringify(r, null, 1);
        if (!flags.out) return dump;
        write(flags.out, dump);
        return { ok: true, path: flags.out };
      },
    },
    http: { method: 'GET', path: '/api/export', args: () => ({ blobs: true }) },
    run: (w, a) => w.exportJSON({ blobs: a.blobs === true }),
  },
  {
    name: 'json.import',
    engine: ['importJSON'],
    writes: 'schema',
    tool: {
      name: 'weave_import_json',
      description: 'Replace the workspace with a JSON export. Destructive: everything not in the document is gone. The result names every file that arrived without its bytes (missing).',
      inputSchema: { type: 'object', properties: { state: { type: 'object' } }, required: ['state'] },
    },
    cli: {
      command: 'import',
      args: (a, flags, { file }) => {
        if (!flags.file) throw new WeaveError('import needs --file');
        return { state: JSON.parse(file(flags.file)) };
      },
    },
    http: { method: 'POST', path: '/api/import', args: (a, body) => ({ state: body }) },
    run: (w, a) => ({ ok: true, ...w.importJSON(a.state) }),
  },
  {
    name: 'view.list',
    engine: ['listViews'],
    writes: 'none',
    tool: VIEWS_TOOL,
    action: 'list',
    cli: { command: 'view', sub: 'list', default: true, args: (a, flags) => ({ trash: Boolean(flags.trash) }), result: (r) => r.views },
    http: { method: 'GET', path: '/api/views', query: ['trash'], args: (a) => ({ trash: truthy(a.trash) }), result: (r) => r.views },
    run: (w, a) => ({ views: w.listViews({ trash: Boolean(a.trash) }) }),
  },
  {
    name: 'view.get',
    engine: ['resolveView', 'getView'],
    writes: 'none',
    tool: VIEWS_TOOL,
    action: 'get',
    cli: { command: 'view', sub: 'get', positional: ['view'] },
    http: { method: 'GET', path: '/api/views/:view' },
    run: (w, a) => w.resolveView(a.view),
  },
  {
    name: 'view.create',
    engine: ['createView'],
    writes: 'entity',
    tool: VIEWS_TOOL,
    action: 'create',
    cli: { command: 'view', sub: 'create', positional: ['name'], args: (a, flags, { json }) => ({ name: a.name, blocks: json('blocks') ?? [] }) },
    http: { method: 'POST', path: '/api/views', status: 201, args: (a, body) => ({ input: body ?? {} }) },
    run: (w, a) => w.createView(a.input ?? { name: a.name, blocks: a.blocks ?? [] }),
  },
  {
    name: 'view.delete',
    engine: ['deleteView'],
    writes: 'entity',
    tool: VIEWS_TOOL,
    action: 'delete',
    cli: { command: 'view', sub: 'delete', positional: ['view'], args: (a, flags) => ({ view: a.view, hard: Boolean(flags.hard) }) },
    http: { method: 'DELETE', path: '/api/views/:view', query: ['hard'], args: (a) => ({ view: a.view, hard: truthy(a.hard) }) },
    run: (w, a) => w.deleteView(a.view, { hard: Boolean(a.hard) }),
  },
  {
    name: 'view.restore',
    engine: ['restoreView'],
    writes: 'entity',
    tool: VIEWS_TOOL,
    action: 'restore',
    cli: { command: 'view', sub: 'restore', positional: ['view'] },
    http: { method: 'POST', path: '/api/views/:view/restore' },
    run: (w, a) => w.restoreView(a.view),
  },
  {
    name: 'view.share',
    engine: ['shareView'],
    writes: 'entity',
    tool: VIEWS_TOOL,
    action: 'share',
    cli: { command: 'view', sub: 'share', positional: ['view'] },
    http: { method: 'POST', path: '/api/views/:view/share', status: 201 },
    run: (w, a) => w.shareView(a.view),
  },
  {
    name: 'view.unshare',
    engine: ['unshareView'],
    writes: 'entity',
    tool: VIEWS_TOOL,
    action: 'unshare',
    cli: { command: 'view', sub: 'unshare', positional: ['view'] },
    http: { method: 'DELETE', path: '/api/views/:view/share' },
    run: (w, a) => w.unshareView(a.view),
  },
  {
    name: 'share.list',
    engine: ['listShares'],
    writes: 'none',
    tool: SHARES_TOOL,
    action: 'list',
    cli: {
      command: 'share', sub: 'list', default: true,
      args: (a, flags) => ({ kind: typeof flags.kind === 'string' ? flags.kind : null, id: typeof flags.id === 'string' ? flags.id : null, includeInactive: Boolean(flags['include-inactive']) }),
      result: (r) => r.shares,
    },
    http: {
      method: 'GET', path: '/api/shares',
      args: (a, body, q) => ({ kind: q.get('kind'), id: q.get('id'), includeInactive: q.get('includeInactive') === '1' }),
      result: (r, a, ctx) => r.shares.map(ctx.shareLink),
    },
    run: (w, a) => ({ shares: w.listShares({ kind: a.kind ?? null, id: a.id ?? null, includeInactive: Boolean(a.includeInactive) }) }),
  },
  {
    name: 'share.mint',
    engine: ['mintShare'],
    writes: 'entity',
    tool: SHARES_TOOL,
    action: 'mint',
    cli: {
      command: 'share', sub: 'mint', positional: ['kind', 'id'],
      args: (a, flags, { json }) => ({
        input: {
          scope: a.kind === 'entities' ? { kind: a.kind, ids: json('ids') } : { kind: a.kind, id: a.kind === 'workspace' ? null : a.id }, mode: flags.mode ?? 'read', visibility: flags.private ? 'private' : 'public',
          formId: flags.form, expiry: flags.expiry,
          label: typeof flags.label === 'string' ? flags.label : '', expiresAt: typeof flags.expires === 'string' ? flags.expires : null,
        },
      }),
    },
    http: { method: 'POST', path: '/api/shares', status: 201, args: (a, body) => ({ input: body ?? {} }), result: linked },
    run: (w, a) => w.mintShare(a.input ?? { scope: a.kind === 'entities' ? { kind: a.kind, ids: a.ids } : { kind: a.kind, id: a.id }, mode: a.mode, visibility: a.visibility, label: a.label, expiry: a.expiry, expiresAt: a.expiresAt, formId: a.formId }),
  },
  {
    name: 'share.renew',
    engine: ['renewShare'],
    writes: 'entity',
    tool: SHARES_TOOL,
    action: 'renew',
    cli: { command: 'share', sub: 'renew', positional: ['share'] },
    http: { method: 'POST', path: '/api/shares/:share/renew', result: linked },
    run: (w, a) => w.renewShare(a.share),
  },
  {
    name: 'share.revoke',
    engine: ['revokeShare'],
    writes: 'entity',
    tool: SHARES_TOOL,
    action: 'revoke',
    cli: { command: 'share', sub: 'revoke', positional: ['share'] },
    http: { method: 'DELETE', path: '/api/shares/:share', result: linked },
    run: (w, a) => w.revokeShare(a.share),
  },
  {
    name: 'share.update',
    engine: ['updateShare'],
    writes: 'entity',
    tool: SHARES_TOOL,
    action: 'update',
    cli: { command: 'share', sub: 'update', positional: ['share'], args: sharePatchFlags },
    http: { method: 'PATCH', path: '/api/shares/:share', args: (a, body) => ({ share: a.share, patch: body ?? {} }), result: linked },
    run: (w, a) => w.updateShare(a.share, a.patch ?? sharePatch(a)),
  },
  {
    name: 'share.regenerate',
    engine: ['regenerateShare'],
    writes: 'entity',
    tool: SHARES_TOOL,
    action: 'regenerate',
    cli: { command: 'share', sub: 'regenerate', positional: ['share'], args: sharePatchFlags },
    http: { method: 'POST', path: '/api/shares/:share/regenerate', args: (a, body) => ({ share: a.share, patch: body ?? {} }), result: linked },
    run: (w, a) => w.regenerateShare(a.share, a.patch ?? sharePatch(a)),
  },
  {
    name: 'file.attach',
    engine: ['attachFile', 'attachToField'],
    writes: 'entity',
    tool: {
      name: 'weave_attach_file',
      description: 'Attach a file to a record, optionally to an attachments field. For local files over HTTP, send prepare:true and size (bytes), without contentBase64: returns a one-use PUT URL and headers, valid ten minutes. Send the raw file bytes from a local script using those headers; no separate editor token or base64 in context is needed. Each transfer attempt consumes its grant, even on failure. Grants expire on server restart; prepare again if refused. Stdio and small inline files can use contentBase64.',
      inputSchema: {
        type: 'object',
        properties: { entity: { type: 'string' }, field: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, contentBase64: { type: 'string' }, prepare: { type: 'boolean' }, size: { type: 'integer', minimum: 0, maximum: 10485760 } },
        required: ['entity', 'name'],
      },
    },
    cli: {
      command: 'file', sub: 'attach', default: true, positional: ['entity'],
      args: (a, flags, { entityRef, bytes }) => {
        if (!flags.path) throw new WeaveError('file attach needs --path');
        return { entity: entityRef(a.entity, flags.db), field: flags.field || null, [UPLOAD]: { name: flags.path.split('/').pop(), mime: flags.mime ?? 'application/octet-stream', bytes: bytes(flags.path).toString('base64') } };
      },
    },
    http: {
      method: 'POST', path: '/api/entities/:entity/files', also: ['/api/entities/:entity/fields/:field/files'], status: 201,
      args: (a, body) => ({ entity: a.entity, field: a.field ?? null, [UPLOAD]: { name: body.name, mime: body.mime, bytes: a.field == null ? body.contentBase64 : body.bytes ?? body.contentBase64, preview: previewInput(body.preview) } }),
    },
    run: (w, a, ctx) => {
      if (a[UPLOAD] === undefined && a.prepare === true) {
        if (!ctx?.caller?.prepareUpload) throw new Error('Prepare uploads over the authenticated HTTP MCP endpoint; stdio callers can use the file attach CLI.');
        return ctx.caller.prepareUpload(a);
      }
      const file = a[UPLOAD] ?? mcpUpload(a);
      return a.field == null ? w.attachFile(a.entity, file) : w.attachToField(a.entity, a.field, file);
    },
  },
  {
    name: 'file.read',
    engine: ['readFile'],
    writes: 'none',
    tool: FILES_TOOL,
    action: 'read',
    cli: {
      command: 'file', sub: 'read', positional: ['file'], raw: (flags) => !flags.out,
      result: ({ meta, bytes }, flags, { write }) => {
        if (!flags.out) return Buffer.from(bytes);
        write(flags.out, Buffer.from(bytes));
        return { ...meta, path: flags.out };
      },
    },
    http: { method: 'GET', path: '/api/files/:file', serve: (a, ctx) => ctx.serveFile(a.file) },
    run: (w, a) => w.readFile(a.file),
    toolResult: ({ meta, bytes }) => ({ ...meta, contentBase64: Buffer.from(bytes).toString('base64') }),
  },
  {
    name: 'file.delete',
    engine: ['deleteFile'],
    writes: 'entity',
    tool: FILES_TOOL,
    action: 'delete',
    cli: { command: 'file', sub: 'delete', positional: ['entity', 'file'], args: (a, flags, { entityRef }) => ({ entity: entityRef(a.entity, flags.db), file: a.file }) },
    http: {
      method: 'DELETE', path: '/api/entities/:entity/files/:file',
      result: (r, a) => {
        if (!r.deleted) throw new WeaveError(`No file '${a.file}' on this record`, 'not-found');
        return r;
      },
    },
    run: (w, a) => w.deleteFile(a.entity, a.file),
  },
  {
    name: 'vocabulary',
    engine: [],
    writes: 'none',
    tool: {
      name: 'weave_vocabulary',
      description: 'Every closed set a configuration value comes from, and what each choice looks like on screen: field types with how they render and which config keys they take, the option color palette, the icon names, number/date formats, document kinds, relation cardinalities, workflow state categories, rollup aggregates, system columns, view kinds, the column-width rules, and formulaFunctions — every formula function with its signature, group, doc and an example. Read this before configuring a table. Name every section you need in one call (sections:["icons","optionColors"]); query searches the icon names by name, category and synonym ("wallet, bank" searches both).',
      inputSchema: { type: 'object', properties: { sections: { type: 'array', items: { type: 'string' } }, section: { type: 'string' }, query: { type: 'string' } } },
    },
    cli: { command: 'vocabulary', rest: 'words', args: (a) => ({ section: a.words[0], query: a.words.slice(1).join(' '), invalid: true }) },
    http: { method: 'GET', path: '/api/vocabulary', args: (a, body, q) => ({ section: q.get('section'), query: q.get('query'), invalid: true }) },
    run: (w, a) => {
      try {
        return vocabularyView(a.sections ?? a.section, a.query);
      } catch (e) {
        if (a.invalid) throw new WeaveError(e.message, 'invalid');
        throw e;
      }
    },
  },
  {
    name: 'share.current',
    engine: [],
    writes: 'none',
    via: { tool: 'weave_shares', cli: 'share.list' },
    http: { method: 'GET', path: '/api/share' },
    run: (w, a, ctx) => {
      if (!ctx?.share) throw new WeaveError('No share token on this request: send Authorization: Bearer wvs_…', 'not-found');
      const { token, url, ...grant } = ctx.share;
      return grant;
    },
  },
  {
    name: 'template.list',
    engine: ['listTemplates'],
    writes: 'none',
    tool: {
      name: 'weave_template_list',
      description: 'The template spaces of this workspace: the live spaces marked template: true (weave_update_space marks one, or the Template box on its System/Spaces record). Each is a space: id, name, description, icon. Also starters: the built-in starter workspaces (id, title, blurb, and grows, a note on how one is meant to grow). starter: <id> answers {starter, spec}, a spec dated this month to pass to weave_build.',
      inputSchema: { type: 'object', properties: { starter: { type: 'string' } } },
    },
    cli: { command: 'template', sub: 'list', default: true },
    http: { method: 'GET', path: '/api/templates' },
    run: (w, a, ctx) => {
      if (ctx?.door !== 'mcp') return w.listTemplates();
      return a.starter != null ? globalThis.WeaveStarters.forAgent(a.starter) : { templates: w.listTemplates(), starters: globalThis.WeaveStarters.catalog() };
    },
  },
  {
    name: 'template.use',
    engine: ['useTemplate'],
    writes: 'none',
    tool: {
      name: 'weave_template_use',
      description: 'Copy a template space\'s schema, never its records, into another workspace of this hub: its tables, fields with their config, option colours and icons, workflow states, views, field order, hidden fields, filters, sort, the term, the icons and the space rollups over its tables. space: the template space (name or id). workspace: the target, a name as the hub lists it. name: the new space\'s name, the template\'s by default; a name the target already holds is refused. A relation to a table outside the space is left out and named in `skipped`, with every lookup, rollup and formula that reads through it. Needs an architect on the target. Answers {space, workspace, url, plan, skipped}. Over HTTP only: a stdio server holds one workspace, so there use the CLI, weave template use <space> --into <other.db>.',
      inputSchema: {
        type: 'object',
        properties: { space: { type: 'string' }, workspace: { type: 'string' }, name: { type: 'string' } },
        required: ['space', 'workspace'],
      },
    },
    cli: {
      command: 'template', sub: 'use', positional: ['space'],
      args: (a, flags) => {
        if (!a.space) throw new WeaveError('Usage: weave template use <space> --into <other.db> [--name <name>]', 'invalid');
        if (!flags.into || flags.into === true) throw new WeaveError('template use needs --into <other.db>: the workspace file to build in', 'invalid');
        return { space: a.space, into: String(flags.into), name: flags.name == null || flags.name === true ? undefined : String(flags.name) };
      },
    },
    http: { method: 'POST', path: '/api/spaces/:space/use', status: 201, args: (a, body) => ({ space: a.space, workspace: body?.workspace, name: body?.name }) },
    run: (w, a, ctx) => {
      if (a.into !== undefined) {
        const target = ctx.openInto(a.into);
        try {
          return w.useTemplate(a.space, target.weave, { name: a.name });
        } finally { target.done(); }
      }
      const use = ctx?.useTemplate ?? ctx?.caller?.useTemplate;
      if (!use) {
        throw new Error('weave_template_use copies into another workspace of a hub, and this stdio server holds one workspace. Call it over the HTTP door (POST /api/mcp, or /mcp on the hosted instance), or run weave template use <space> --into <other.db> on the CLI.');
      }
      return use({ space: a.space, workspace: a.workspace, name: a.name });
    },
  },
];

const camel = (flag) => flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export const BY_TOOL = new Map(COMMANDS.filter((c) => c.tool && c.action === undefined).map((c) => [c.tool.name, c]));
export const BY_CLI = new Map(COMMANDS.filter((c) => c.cli).map((c) => [`${c.cli.command} ${c.cli.sub ?? ''}`.trim(), c]));
const DEFAULT_CLI = new Map(COMMANDS.filter((c) => c.cli?.default).map((c) => [c.cli.command, c]));

export const FAMILIES = new Map();
for (const c of COMMANDS.filter((x) => x.action !== undefined)) {
  if (!FAMILIES.has(c.tool.name)) FAMILIES.set(c.tool.name, { tool: c.tool, noun: c.tool.name.replace(/^weave_/, ''), commands: [] });
  FAMILIES.get(c.tool.name).commands.push(c);
}

export const registeredTool = (name) => BY_TOOL.has(name) || FAMILIES.has(name);

export function toolDefinition(name) {
  const tool = BY_TOOL.get(name)?.tool ?? FAMILIES.get(name)?.tool;
  if (!tool) throw new Error(`No registry command for the tool ${name}`);
  return tool;
}

export function toolCommand(name, args = {}) {
  const single = BY_TOOL.get(name);
  if (single) return single;
  const family = FAMILIES.get(name);
  if (!family) return null;
  const picked = (c) => (typeof c.action === 'boolean' ? Boolean(args[c.actionArg]) : args[c.actionArg ?? 'action']);
  const hit = family.commands.find((c) => c.action === picked(c)) ?? family.commands.find((c) => c.toolDefault);
  if (hit?.toolRefusal) throw new Error(hit.toolRefusal);
  if (hit) return hit;
  const offered = family.commands.filter((c) => !c.toolRefusal).map((c) => c.action);
  throw new Error(`Unknown ${family.noun} action '${args.action}' (${offered.join(', ')})`);
}

const CLI_ALIASES = { db: 'table' };

export function cliCommand(given, sub) {
  const command = CLI_ALIASES[given] ?? given;
  const named = sub == null ? null : BY_CLI.get(`${command} ${sub}`);
  if (named) return named;
  const bare = BY_CLI.get(command);
  if (bare && !bare.cli.sub) return bare;
  const fallback = DEFAULT_CLI.get(command) ?? null;
  return sub == null || fallback?.cli.default === 'positional' ? fallback : null;
}

export function cliMiss(given, sub) {
  const command = CLI_ALIASES[given] ?? given;
  if (!DEFAULT_CLI.has(command)) return null;
  const subs = COMMANDS.filter((c) => c.cli?.command === command).map((c) => c.cli.sub);
  return new WeaveError(`Unknown ${command} subcommand '${sub}'. Try: ${subs.join(', ')}`);
}

export const cliRest = (cmd, args) => (cmd.cli.sub && args[0] === cmd.cli.sub ? args.slice(1) : args);

export function cliArgs(cmd, positional, flags, helpers) {
  const a = {};
  cmd.cli.positional?.forEach((k, i) => { if (positional[i] !== undefined) a[k] = positional[i]; });
  if (cmd.cli.rest) a[cmd.cli.rest] = positional.slice(cmd.cli.positional?.length ?? 0);
  for (const f of cmd.cli.flags ?? []) if (flags[f] !== undefined) a[camel(f)] = flags[f];
  return cmd.cli.args ? cmd.cli.args(a, flags, helpers) : a;
}

export function cliRun(given, w, args, flags, helpers) {
  const swap = given.cli.use?.(flags);
  const cmd = swap ? COMMANDS.find((c) => c.name === swap) : given;
  const result = cmd.run(w, cliArgs(cmd, cliRest(given, args), flags, helpers), helpers);
  return cmd.cli.result ? cmd.cli.result(result, flags, helpers) : result;
}

export const httpPaths = (c) => [c.http.path, ...(c.http.also ?? [])];

const ROUTES = COMMANDS.filter((c) => c.http).flatMap((c) => httpPaths(c).map((path) => {
  const keys = [];
  const src = path.replace(/\//g, '\\/').replace(/\./g, '\\.').replace(/(\\\/)?:([a-z]+)(\*?)(\??)/gi, (_, slash, k, rest, optional) => {
    keys.push(k);
    const group = `${slash ?? ''}${rest ? '(.+)' : '([^/]+)'}`;
    return optional ? `(?:${group})?` : group;
  });
  return { cmd: c, method: c.http.method, re: new RegExp(`^${src}$`), keys };
}));

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function matchRoute(method, path) {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (m) return { cmd: r.cmd, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]).filter(([, v]) => v !== undefined).map(([k, v]) => [k, decode(v)])) };
  }
  return null;
}

export function httpArgs(hit, body, searchParams, ctx = {}) {
  const a = { ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}) };
  for (const q of hit.cmd.http.query ?? []) if (searchParams.has(q)) a[q] = searchParams.get(q);
  Object.assign(a, hit.params);
  return hit.cmd.http.args ? hit.cmd.http.args(a, body, searchParams, ctx) : a;
}

export function httpReply(w, hit, body, searchParams, ctx = {}) {
  const headers = hit.cmd.http.type ? { 'Content-Type': hit.cmd.http.type } : {};
  let a;
  try {
    a = httpArgs(hit, body, searchParams, ctx);
    const result = hit.cmd.run(w, a, ctx);
    return { status: hit.cmd.http.status ?? 200, data: hit.cmd.http.result ? hit.cmd.http.result(result, a, ctx, w) : result, headers };
  } catch (err) {
    const failed = hit.cmd.http.fail?.(err, w, a, ctx);
    if (!failed) throw err;
    return { status: failed[0], data: failed[1], headers };
  }
}
