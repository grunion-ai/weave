import { WeaveError } from './store.js';
import { nonNegativeInteger } from './errors.js';
import { guided } from './field-hints.js';
import { ONTOLOGY } from './engine.js';

const truthy = (v) => v === true || ['1', 'true'].includes(String(v ?? ''));
const list = (v) => (v == null ? undefined : Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const nullable = (v, as = (x) => x) => (v === 'null' ? null : as(v));

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

const AUTOMATIONS_TOOL = {
  name: 'weave_automations',
  description: 'Automations already on a table, read from their System/Workflows records: action list | describe (rules in prose) | update (patch: name, enabled = the record\'s On) | delete (to the trash). Create one with weave_create_automation.',
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string' }, db: { type: 'string' }, automation: { type: 'string' }, patch: { type: 'object' } },
    required: ['action'],
  },
};

const KEYS_TOOL = {
  name: 'weave_keys',
  description: 'The keystore behind `key` (credential) fields: the field holds the NAME of a secret; the secret lives encrypted in a chmod-600 file beside the workspace. action: list (names, owners, sharing) | set (name, value) | share (name, account) | unshare (name, account) | delete. No MCP tool returns a secret value — revealing one is a human act on the CLI or the HTTP surface, gated by that credential\'s own access list and written to the audit log.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' },
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
      description: 'Create an automation rule as a System/Workflows record; its Script holds the rule as JSON. enabled (default true) is the record\'s On: pass false to create it Off. trigger: {type: entity-created | field-updated | state-changed, field?, toState?} or {type: schedule, cron: "0 9 * * 1-5", zone?: IANA zone (UTC by default), where?: a query filter}: a schedule fires on its cron minute in its zone, once for every live record of the table the where clause admits, and a box that slept catches up with one run. actions: [{type: set-field, field, value} | {type: append-doc, text} | {type: add-comment, text} | {type: webhook, url, signWith?: the name of a keystore credential, never its value; weave then signs the delivery with an X-Weave-Signature header holding the HMAC-SHA256 of <X-Weave-Timestamp>.<body>, beside an X-Weave-Delivery uuid} | {type: upsert-row, table, key, fields: {targetField: sourcePath}}] — upsert-row creates or updates a record of another table matched on its key field (text, number, url or email); source paths read record.<Field>, row.PublicId and event.type/field/toState; select values by option name, relations by target Name. text supports {{FieldName}}, {{PublicId}}, {{Today}} (the workspace date format; {{Today:iso}} for 2026-10-06) and {{steps.N.path}} templates: every action yields an output (set-field {field, value}; append-doc {field, text}; add-comment {id, text}; upsert-row {id, publicId, name, created}; webhook {url, sent}) that later actions read as steps.N in text, in a set-field string value and in upsert-row source paths.',
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
];

const camel = (flag) => flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export const BY_TOOL = new Map(COMMANDS.filter((c) => c.tool && !c.action).map((c) => [c.tool.name, c]));
export const BY_CLI = new Map(COMMANDS.filter((c) => c.cli).map((c) => [`${c.cli.command} ${c.cli.sub ?? ''}`.trim(), c]));
const DEFAULT_CLI = new Map(COMMANDS.filter((c) => c.cli?.default).map((c) => [c.cli.command, c]));

export const FAMILIES = new Map();
for (const c of COMMANDS.filter((x) => x.action)) {
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
  const hit = family.commands.find((c) => c.action === args.action);
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
  for (const f of cmd.cli.flags ?? []) if (flags[f] !== undefined) a[camel(f)] = flags[f];
  return cmd.cli.args ? cmd.cli.args(a, flags, helpers) : a;
}

export function cliRun(cmd, w, args, flags, helpers) {
  const result = cmd.run(w, cliArgs(cmd, cliRest(cmd, args), flags, helpers));
  return cmd.cli.result ? cmd.cli.result(result) : result;
}

const ROUTES = COMMANDS.filter((c) => c.http).map((c) => {
  const keys = [];
  const src = c.http.path.replace(/\//g, '\\/').replace(/\./g, '\\.').replace(/(\\\/)?:([a-z]+)(\*?)(\??)/gi, (_, slash, k, rest, optional) => {
    keys.push(k);
    const group = `${slash ?? ''}${rest ? '(.+)' : '([^/]+)'}`;
    return optional ? `(?:${group})?` : group;
  });
  return { cmd: c, method: c.http.method, re: new RegExp(`^${src}$`), keys };
});

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function matchRoute(method, path) {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (m) return { cmd: r.cmd, params: Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]).filter(([, v]) => v !== undefined).map(([k, v]) => [k, decode(v)])) };
  }
  return null;
}

export function httpArgs(hit, body, searchParams) {
  const a = { ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}) };
  for (const q of hit.cmd.http.query ?? []) if (searchParams.has(q)) a[q] = searchParams.get(q);
  Object.assign(a, hit.params);
  return hit.cmd.http.args ? hit.cmd.http.args(a, body, searchParams) : a;
}

export function httpRun(w, hit, body, searchParams) {
  const a = httpArgs(hit, body, searchParams);
  const result = hit.cmd.run(w, a);
  return hit.cmd.http.result ? hit.cmd.http.result(result, a) : result;
}

export const httpHeaders = (hit) => (hit.cmd.http.type ? { 'Content-Type': hit.cmd.http.type } : {});
