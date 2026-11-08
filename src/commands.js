import { guided } from './field-hints.js';
import { ONTOLOGY } from './engine.js';

const truthy = (v) => v === true || ['1', 'true'].includes(String(v ?? ''));
const list = (v) => (v == null ? undefined : Array.isArray(v) ? v : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const nullable = (v, as = (x) => x) => (v === 'null' ? null : as(v));

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

export const COMMANDS = [
  {
    name: 'schema.ontology',
    engine: ['ontology', 'spaceVersions'],
    writes: 'none',
    tool: {
      name: 'weave_ontology',
      description: 'The schema, short; read it before weave_schema (the full JSON). Default outline: one line per table by space, [a|b] options or states, name -> Target (inverse) with * for many, name = lookup, rollup or formula, then the etag. concept: one table in full, field descriptions included. since: an etag; answers only the spaces changed since.',
      properties: { depth: { type: 'string', enum: ['outline', 'glossary'] }, concept: { type: 'string', description: 'Table or Space/Table' }, since: { type: 'string' } },
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
      properties: { db: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' } },
      required: ['db', 'name', 'type'],
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
      properties: { db: { type: 'string' }, field: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' } },
      required: ['db', 'field'],
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
      properties: { db: { type: 'string' }, field: { type: 'string' }, activity: { type: 'string', description: 'The entry id, <tableId>:f<n>' } },
      required: ['activity'],
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
      properties: { db: { type: 'string' }, field: { type: 'string' }, hard: { type: 'boolean' } },
      required: ['db', 'field'],
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
      properties: { db: { type: 'string' }, field: { type: 'string' } },
      required: ['db', 'field'],
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
      properties: { db: { type: 'string' }, expression: { type: 'string' }, entity: { type: 'string' }, excludeField: { type: 'string' }, scan: { type: 'boolean' } },
      required: ['db', 'expression'],
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
      properties: { db: { type: 'string' }, name: { type: 'string' }, targetDb: { type: 'string' }, targetDbs: { type: 'array', items: { type: 'string' } }, cardinality: { type: 'string' }, inverseName: { type: 'string' } },
      required: ['db', 'name'],
    },
    cli: {
      command: 'relation', sub: 'add', positional: ['db', 'name', 'targetDb'],
      args: (a, flags) => ({ ...a, targetDbs: list(flags['target-dbs']), cardinality: flags.cardinality, inverseName: flags.inverse }),
    },
    http: { method: 'POST', path: '/api/tables/:db/relations', status: 201 },
    run: (w, a) => w.addRelation(a.db, { name: a.name, targetDb: a.targetDb, targetDbs: a.targetDbs, cardinality: a.cardinality ?? 'many-to-one', inverseName: a.inverseName }),
  },
];

const camel = (flag) => flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export const BY_TOOL = new Map(COMMANDS.filter((c) => c.tool).map((c) => [c.tool.name, c]));
export const BY_CLI = new Map(COMMANDS.filter((c) => c.cli).map((c) => [`${c.cli.command} ${c.cli.sub ?? ''}`.trim(), c]));

export function toolDefinition(name) {
  const c = BY_TOOL.get(name);
  if (!c) throw new Error(`No registry command for the tool ${name}`);
  const { properties, required, description } = c.tool;
  return { name, description, inputSchema: { type: 'object', properties, ...(required?.length ? { required } : {}) } };
}

export function cliCommand(command, sub) {
  const named = sub == null ? null : BY_CLI.get(`${command} ${sub}`);
  if (named) return named;
  const bare = BY_CLI.get(command);
  return bare && !bare.cli.sub ? bare : null;
}

export const cliRest = (cmd, args) => (cmd.cli.sub ? args.slice(1) : args);

export function cliArgs(cmd, positional, flags, helpers) {
  const a = {};
  cmd.cli.positional?.forEach((k, i) => { if (positional[i] !== undefined) a[k] = positional[i]; });
  for (const f of cmd.cli.flags ?? []) if (flags[f] !== undefined) a[camel(f)] = flags[f];
  return cmd.cli.args ? cmd.cli.args(a, flags, helpers) : a;
}

const ROUTES = COMMANDS.filter((c) => c.http).map((c) => {
  const keys = [];
  const src = c.http.path.replace(/\//g, '\\/').replace(/\./g, '\\.').replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; });
  return { cmd: c, method: c.http.method, re: new RegExp(`^${src}$`), keys };
});

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

export function matchRoute(method, path) {
  for (const r of ROUTES) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (m) return { cmd: r.cmd, params: Object.fromEntries(r.keys.map((k, i) => [k, decode(m[i + 1])])) };
  }
  return null;
}

export function httpArgs(hit, body, searchParams) {
  const a = { ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}) };
  for (const q of hit.cmd.http.query ?? []) if (searchParams.has(q)) a[q] = searchParams.get(q);
  return Object.assign(a, hit.params);
}
