import { readFileSync } from 'node:fs';
import { mcpToolError, contractFor } from './errors.js';
import { toolCommand, toolDefinition, COMMANDS, ROLES } from './commands.js';
import { guided } from './field-hints.js';
import { Weave, WeaveError, FIELD_TYPES } from './engine.js';
import { RANK } from './access.js';
import '../public/starter-core.js';
import { submitForm, listForms, createForm, updateForm, getFormDefinition } from './forms.js';
const PROTOCOL_VERSION = '2024-11-05';
export { QUERY_PAGE, QUERY_CAP } from './commands.js';
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const seal = (text) => text.replace(/<(?=\/?weave_data)/gi, '\\u003c');
const attr = (v) => String(v ?? '*').replace(/[\s"<>&]+/g, ' ').trim() || '*';
function textResult(data, source = null) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  if (!source) return { content: [{ type: 'text', text }] };
  const head = `<weave_data table="${attr(source.table)}" entity="${attr(source.entity)}" field="${attr(source.field)}">`;
  return { content: [{ type: 'text', text: `${head}\n${seal(text)}\n</weave_data>` }] };
}

const TOKEN = /^(?:[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}|\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z|[\da-f]{16,})$/i;
const GUIDANCE = new Set(['hints', 'next']);
function sentText(v, out) {
  if (typeof v === 'string') out.add(v);
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) sentText(x, out.add(k));
  return out;
}
function storedText(v, own, top = false) {
  if (typeof v === 'string') return !own.has(v) && !TOKEN.test(v);
  if (!v || typeof v !== 'object') return false;
  return Object.entries(v).some(([k, x]) => (!Array.isArray(v) && !/^[a-z][a-zA-Z\d]*$/.test(k) && storedText(k, own)) || (!(top && GUIDANCE.has(k)) && storedText(x, own)));
}

function storedSource(weave, name, args, result) {
  if (name === 'weave_call') {
    if (args.name === 'help') return null;
    let inner = args.args ?? {};
    try { if (typeof inner === 'string') inner = JSON.parse(inner); } catch { inner = {}; }
    return storedSource(weave, args.name, inner ?? {}, result);
  }
  let body = result;
  try { if (typeof result === 'string') body = JSON.parse(result); } catch {}
  if (!storedText(body, sentText(args, new Set(['', ...FIELD_TYPES])), true)) return null;
  const tableOf = (fn) => { try { const db = fn(); return db ? weave.qualifiedName(db) : null; } catch { return null; } };
  const ref = args.db ?? args.table ?? null;
  const table = (ref != null ? tableOf(() => weave.findTable(ref)) ?? ref : null)
    ?? (args.entity != null ? tableOf(() => weave.state.tables[weave.getEntity(args.entity).dbId]) : null);
  return { table, entity: args.entity ?? null, field: args.doc ?? args.field ?? null };
}

export const COMPACT_TOOLS = new Set([
  'weave_create_entity', 'weave_update_entity', 'weave_delete_entity', 'weave_restore_entity',
  'weave_set_state', 'weave_link', 'weave_unlink',
  'weave_create_space', 'weave_update_space', 'weave_restore_space',
  'weave_create_table', 'weave_update_table', 'weave_move_table', 'weave_duplicate_table', 'weave_restore_table',
  'weave_add_field', 'weave_update_field', 'weave_add_relation',
]);
const BRIEF_KEYS = ['id', 'publicId', 'name', 'type', 'config', 'deletedAt', 'purged', 'next', 'hints', 'invite', 'token'];
function brief(obj) {
  const out = {};
  for (const k of BRIEF_KEYS) if (obj?.[k] != null) out[k] = obj[k];
  return out;
}
function compactResult(name, result) {
  if (!COMPACT_TOOLS.has(name) || !result || typeof result !== 'object') return result;
  if (name === 'weave_add_relation') return { field: brief(result.field), ...(result.inverse ? { inverse: brief(result.inverse) } : {}) };
  return brief(result);
}
const VERBOSE = { type: 'boolean', description: 'Return the whole object' };

export const TOOLS = [
  toolDefinition('weave_ontology'),
  toolDefinition('weave_schema'),
  toolDefinition('weave_query'),
  toolDefinition('weave_get_entity'),
  toolDefinition('weave_create_entity'),
  toolDefinition('weave_update_entity'),
  toolDefinition('weave_delete_entity'),
  toolDefinition('weave_restore_entity'),
  toolDefinition('weave_trash'),
  toolDefinition('weave_stats'),
  toolDefinition('weave_undo'),
  toolDefinition('weave_bulk'),
  toolDefinition('weave_set_state'),
  toolDefinition('weave_link'),
  toolDefinition('weave_unlink'),
  toolDefinition('weave_get_doc'),
  toolDefinition('weave_set_doc'),
  toolDefinition('weave_doc_revisions'),
  toolDefinition('weave_doc_restore'),
  toolDefinition('weave_add_comment'),
  toolDefinition('weave_delete_comment'),
  toolDefinition('weave_search'),
  toolDefinition('weave_create_space'),
  toolDefinition('weave_create_table'),
  toolDefinition('weave_add_field'),
  toolDefinition('weave_check_formula'),
  toolDefinition('weave_add_relation'),
  toolDefinition('weave_create_automation'),
  toolDefinition('weave_export_csv'),
  toolDefinition('weave_import_csv'),
  toolDefinition('weave_attach_file'),
  toolDefinition('weave_vocabulary'),
  toolDefinition('weave_update_space'),
  toolDefinition('weave_template_list'),
  toolDefinition('weave_template_use'),
  toolDefinition('weave_delete_space'),
  toolDefinition('weave_restore_space'),
  toolDefinition('weave_update_table'),
  toolDefinition('weave_table_view'),
  toolDefinition('weave_move_table'),
  toolDefinition('weave_duplicate_table'),
  toolDefinition('weave_delete_table'),
  toolDefinition('weave_restore_table'),
  toolDefinition('weave_update_field'),
  toolDefinition('weave_rollback_field'),
  toolDefinition('weave_delete_field'),
  toolDefinition('weave_restore_field'),
  toolDefinition('weave_apply_schema'),
  toolDefinition('weave_build'),
  toolDefinition('weave_views'),
  toolDefinition('weave_shares'),
  toolDefinition('weave_automations'),
  toolDefinition('weave_runs'),
  toolDefinition('weave_activity'),
  toolDefinition('weave_audit'),
  toolDefinition('weave_workspace'),
  toolDefinition('weave_accounts'),
  toolDefinition('weave_keys'),
  toolDefinition('weave_files'),
  toolDefinition('weave_registry'),
  toolDefinition('weave_relation_map'),
  toolDefinition('weave_export_json'),
  {
    name: 'weave_forms',
    description: 'Manage native table forms. Architect access is required on the workspace and its hub registry. list shows forms here; get reads an editable definition; create takes a definition with name, table and fields; update changes a form without changing its permalink. Fields accept field, key, label, required, default and aliases. Omitted settings survive edits. Public submissions use weave_form_submit.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'create', 'update'] },
        form: { type: 'string', description: 'The form ID or name for get or update.' },
        definition: { type: 'object', description: 'name, description, table, fields, hidden, enabled and floor (Observer or Anonymous). Create also accepts immutable shareOnly true for submission-link-only forms. Update accepts only the settings to change.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'weave_form_submit',
    description: 'Submit one record through a System/Forms form without write access to its table. form is its id or name; values accepts stable input keys, field IDs, aliases, names or labels. Reuse idempotencyKey when retrying the same request: it returns the original receipt; changed input with the same key is refused. Server-filled and unlisted fields are refused. Bug forms take note and categories (slow, broken-ui, wrong-data, error).',
    inputSchema: {
      type: 'object',
      properties: {
        form: { type: 'string', description: 'The form id or name, as GET /api/forms lists them.' },
        values: { type: 'object', description: 'Stable input key, field ID, alias, name or label to value, for the fields the form shows.' },
        idempotencyKey: { type: 'string', description: 'A unique key for this attempt. Reuse it with the same input to safely retry for 24 hours.' },
        note: { type: 'string', description: 'Bug report forms: what happened.' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Bug report forms: the symptoms.' },
      },
      required: ['form'],
    },
  },
  toolDefinition('weave_import_json'),
];
for (const t of TOOLS) if (COMPACT_TOOLS.has(t.name)) t.inputSchema.properties.verbose = VERBOSE;

export const CORE_TOOLS = new Set([
  'weave_ontology', 'weave_schema', 'weave_query', 'weave_get_entity', 'weave_create_entity', 'weave_update_entity',
  'weave_create_space', 'weave_create_table', 'weave_add_field', 'weave_update_field', 'weave_add_relation',
  'weave_import_csv', 'weave_vocabulary', 'weave_workspace', 'weave_search', 'weave_build', 'weave_call',
]);
export const SUMMARY = {
  weave_build: 'spaces, tables, fields, relations and records in one call (dryRun checks)',
  weave_ontology: 'short schema: outline, one table, changes',
  weave_schema: 'the full schema as JSON',
  weave_query: 'records of one table, where and sort, 200 a page',
  weave_get_entity: 'one record in full: values, document, comments, activity',
  weave_search: 'find records, tables and spaces by text; each hit has a permalink',
  weave_create_entity: 'create one record',
  weave_update_entity: 'change one record\'s values',
  weave_import_csv: 'many records from CSV text',
  weave_create_space: 'create a space',
  weave_create_table: 'create a table in a space',
  weave_add_field: 'add a field to a table',
  weave_update_field: 'rename, retype or reconfigure a field (options are a full replacement)',
  weave_add_relation: 'add a relation and its inverse between two tables',
  weave_workspace: 'read or rename the workspace, set its description or logo',
  weave_vocabulary: 'allowed values; several sections and icon queries in one call',
  weave_call: 'run any other tool by name; help describes one',
  weave_delete_entity: 'trash a record (hard: true purges)',
  weave_restore_entity: 'restore a trashed record',
  weave_trash: 'list trashed records',
  weave_stats: 'summarise a table\'s columns',
  weave_undo: 'revert your own last record edits (list: true previews)',
  weave_bulk: 'set, link, move or roll up many records in one write',
  weave_set_state: 'move a record to a workflow state',
  weave_link: 'link records through a relation field',
  weave_unlink: 'unlink records from a relation field',
  weave_get_doc: 'a record\'s document as markdown',
  weave_set_doc: 'replace or append a record\'s document',
  weave_doc_revisions: 'a document\'s revisions',
  weave_doc_restore: 'write a past revision back',
  weave_add_comment: 'comment on a record',
  weave_delete_comment: 'delete a comment',
  weave_check_formula: 'validate and preview a formula',
  weave_create_automation: 'create an automation rule',
  weave_automations: 'list, describe, update or delete rules',
  weave_runs: 'external run tracking',
  weave_export_csv: 'a table as CSV',
  weave_attach_file: 'attach or prepare raw upload',
  weave_files: 'read or delete an attached file',
  weave_update_space: 'rename a space; description, icon, template mark',
  weave_template_list: 'list template spaces',
  weave_template_use: 'copy a template space to a workspace',
  weave_delete_space: 'trash a space (hard: true purges)',
  weave_restore_space: 'restore a trashed space',
  weave_update_table: 'rename, icon, noun, field order, system fields, Σ row',
  weave_table_view: 'read and write a table\'s views',
  weave_move_table: 'move a table to another space',
  weave_duplicate_table: 'copy a table\'s schema, no records',
  weave_delete_table: 'trash a table (hard: true purges)',
  weave_restore_table: 'restore a trashed table',
  weave_rollback_field: 'restore a field\'s earlier config',
  weave_delete_field: 'trash a field (hard: true purges)',
  weave_restore_field: 'restore a trashed field',
  weave_apply_schema: 'apply a whole schema document (dryRun plans)',
  weave_views: 'saved multi-table pages',
  weave_shares: 'share links',
  weave_activity: 'the change feed',
  weave_audit: 'schema and account audit log',
  weave_accounts: 'accounts, tokens, sessions, require-auth',
  weave_keys: 'the credential keystore',
  weave_registry: 'registry drift report and rebuild',
  weave_relation_map: 'relation map as mermaid',
  weave_export_json: 'the workspace as JSON',
  weave_import_json: 'replace the workspace from a JSON export',
  weave_forms: 'create, configure and pause table forms',
  weave_form_submit: 'one record through a form',
};
TOOLS.push({
  name: 'weave_call',
  description: [
    'Call any weave tool: {name, args}. {name: "help", args: {tool}} returns its description and input schema; read before the first call. Other tools:',
    ...TOOLS.filter((t) => !CORE_TOOLS.has(t.name)).map((t) => `${t.name}: ${SUMMARY[t.name] ?? t.description.split(/[.:]\s/)[0].slice(0, 60)}`),
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'A tool name, or "help"' }, args: { type: 'object', description: 'That tool\'s arguments' } },
    required: ['name'],
  },
});

const TITLES = {
  weave_ontology: 'Read schema outline', weave_schema: 'Read full schema', weave_query: 'Query records',
  weave_get_entity: 'Read record', weave_create_entity: 'Create record', weave_update_entity: 'Update record',
  weave_delete_entity: 'Delete record', weave_restore_entity: 'Restore record', weave_trash: 'List trash',
  weave_stats: 'Summarize table', weave_undo: 'Undo edits', weave_bulk: 'Edit records in bulk',
  weave_set_state: 'Set workflow state', weave_link: 'Link records', weave_unlink: 'Unlink records',
  weave_get_doc: 'Read document', weave_set_doc: 'Write document', weave_doc_revisions: 'List document revisions',
  weave_doc_restore: 'Restore document revision', weave_add_comment: 'Add comment', weave_delete_comment: 'Delete comment',
  weave_search: 'Search workspace', weave_create_space: 'Create space', weave_create_table: 'Create table',
  weave_add_field: 'Add field', weave_check_formula: 'Check formula', weave_add_relation: 'Add relation',
  weave_create_automation: 'Create automation', weave_export_csv: 'Export table as CSV', weave_import_csv: 'Import CSV records',
  weave_attach_file: 'Attach file', weave_vocabulary: 'Look up allowed values', weave_update_space: 'Update space',
  weave_template_list: 'List templates', weave_template_use: 'Use template', weave_delete_space: 'Delete space',
  weave_restore_space: 'Restore space', weave_update_table: 'Update table', weave_table_view: 'Read or write table views',
  weave_move_table: 'Move table', weave_duplicate_table: 'Duplicate table', weave_delete_table: 'Delete table',
  weave_restore_table: 'Restore table', weave_update_field: 'Update field', weave_rollback_field: 'Roll back field config',
  weave_delete_field: 'Delete field', weave_restore_field: 'Restore field', weave_apply_schema: 'Apply schema document',
  weave_build: 'Build workspace', weave_views: 'Manage saved views', weave_shares: 'Manage share links',
  weave_runs: 'Track external runs', weave_automations: 'Manage automations', weave_activity: 'Read activity feed', weave_audit: 'Read audit log',
  weave_workspace: 'Read or update workspace', weave_accounts: 'Manage accounts', weave_keys: 'Manage credential keys',
  weave_files: 'Read or delete files', weave_registry: 'Check workspace registry', weave_relation_map: 'Draw relation map',
  weave_export_json: 'Export workspace as JSON', weave_forms: 'Manage forms', weave_form_submit: 'Submit form',
  weave_import_json: 'Replace workspace from JSON', weave_call: 'Call any weave tool',
};
const FORM_HINTS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const DOOR_TOOLS = {
  weave_forms: { minRole: 'architect', bound: false, annotations: FORM_HINTS },
  weave_form_submit: { minRole: 'architect', bound: true, annotations: FORM_HINTS },
  weave_call: { minRole: 'observer', bound: true, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
};
const ROWS = new Map(TOOLS.map((t) => [t.name, COMMANDS.filter((c) => c.tool?.name === t.name && !c.toolRefusal)]));
const rowsOf = (name) => (ROWS.get(name)?.length ? ROWS.get(name) : DOOR_TOOLS[name] ? [DOOR_TOOLS[name]] : []);
for (const t of TOOLS) {
  const rows = rowsOf(t.name);
  const every = (k) => rows.every((c) => c.annotations[k]);
  const some = (k) => rows.some((c) => c.annotations[k]);
  t.annotations = { title: TITLES[t.name], readOnlyHint: every('readOnlyHint'), destructiveHint: some('destructiveHint'), idempotentHint: every('idempotentHint'), openWorldHint: some('openWorldHint') };
}

export function toolTable() {
  const effect = (a) => [a.readOnlyHint ? 'Read-only' : a.destructiveHint ? 'Destructive' : 'Adds or edits', ...(a.openWorldHint ? ['can call a webhook'] : [])].join(', ');
  return ['| Tool | What it does | Effect |', '| --- | --- | --- |', ...TOOLS.map((t) => `| \`${t.name}\` | ${t.annotations.title} | ${effect(t.annotations)} |`)].join('\n');
}

export function toolProfile(env = process.env) {
  return env.WEAVE_MCP_TOOLS === 'all' ? 'all' : 'core';
}
export function listTools(profile = toolProfile()) {
  return profile === 'all' ? TOOLS : TOOLS.filter((t) => CORE_TOOLS.has(t.name));
}

const envOrigin = () => process.env.WEAVE_ORIGIN?.trim().replace(/\/+$/, '') ?? '';

function callTool(weave, name, rawArgs, caller) {
  if (name === 'weave_call') {
    checkArgs('weave_call', rawArgs);
    let inner = rawArgs.args ?? {};
    if (typeof inner === 'string') inner = JSON.parse(inner);
    if (rawArgs.name === 'help') {
      const t = TOOLS.find((x) => x.name === inner.tool);
      if (!t) throw new Error(`help needs args.tool, one of the names weave_call lists (got ${JSON.stringify(inner.tool ?? null)})`);
      if (!visible(caller, t.name)) throw hidden(t.name, caller);
      return { name: t.name, description: t.description, inputSchema: t.inputSchema };
    }
    if (!rawArgs.name || rawArgs.name === 'weave_call') throw new Error('weave_call needs name: a weave tool name, or "help"');
    return callTool(weave, rawArgs.name, inner, caller);
  }
  const { verbose, ...args } = rawArgs;
  const result = dispatchTool(weave, name, COMPACT_TOOLS.has(name) ? args : rawArgs, { caller });
  return verbose === true ? result : compactResult(name, result);
}

const systemWrite = (system) => new WeaveError(system === 'users' ? 'Writing a Users record needs an architect token' : 'Writing a record of a system table needs an architect token', 'forbidden');
function systemTarget(weave, command, args) {
  const sys = (fn) => { try { return fn()?.system ?? null; } catch { return null; } };
  const ofEntity = (id) => sys(() => weave.state.tables[weave.getEntity(id).dbId]);
  if (command.name !== 'entity.bulk') return args.entity != null ? ofEntity(args.entity) : args.db != null ? sys(() => weave.findTable(args.db)) : null;
  const ids = args.ids == null ? [] : [].concat(args.ids);
  let into = [];
  if (args.op === 'rollup' && args.table == null) try { into = weave.relationTargetDbIds(weave.getField(weave.getEntity(ids[0]).dbId, args.field)); } catch {}
  return ids.map(ofEntity).find(Boolean) ?? (args.table != null ? sys(() => weave.getTable(args.table)) : null) ?? into.map((t) => weave.state.tables[t]?.system).find(Boolean) ?? null;
}

export function mayAdminister(on, role) {
  return Weave.roleName(role) === 'architect' || !on.listAccounts().length;
}
const SPACE_PATH = /^\/api\/(?:tables|spaces|entities)\/:/;
const bound = (c) => c.bound ?? (c.name === 'entity.bulk' || SPACE_PATH.test(c.http?.path ?? ''));
const tierOf = (caller, c) => (bound(c) ? caller.tier : caller.workspaceTier ?? caller.tier);
const ranks = (tier, c) => tier == null || RANK[Weave.roleName(tier)] >= RANK[c.minRole];
const admits = (caller, c) => ranks(tierOf(caller, c) ?? caller.role, c);
const OWNER = { minRole: 'observer' };
const visible = (caller, name) => !caller || rowsOf(name).some((c) => ranks(tierOf(caller, c), c.owns ? OWNER : c));
export const ROLE_TOOLS = Object.fromEntries(ROLES.filter((r) => r !== 'architect').map((role) => [role, new Set(TOOLS.filter((t) => visible({ tier: role }, t.name)).map((t) => t.name))]));
export function toolWrites(name, args = {}) {
  try { return !(toolCommand(name, args) ?? DOOR_TOOLS[name])?.annotations.readOnlyHint; } catch { return true; }
}
const unknownTool = (name) => Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
const label = (name, c) => (typeof c.action === 'string' ? `${name} ${c.action}` : !c.name || (c.tool?.name === name && c.action === undefined) ? name : `${name} (${c.name})`);
const holds = (caller, c) => Weave.roleName(tierOf(caller, c) ?? caller.role) ?? 'none';
const needs = (name, c, caller) => new WeaveError(`${label(name, c)} needs an ${c.minRole} token on this workspace; this token is ${holds(caller, c)}`, 'forbidden');
const floor = (name) => rowsOf(name).map((c) => (c.owns ? { ...c, minRole: 'observer' } : c)).sort((a, b) => RANK[a.minRole] - RANK[b.minRole])[0];
const hidden = (name, caller) => (rowsOf(name).length ? needs(name, { ...floor(name), action: undefined, tool: { name } }, caller) : unknownTool(name));

const isMap = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const toolProps = (name) => TOOLS.find((t) => t.name === name)?.inputSchema.properties;
const unknownArgs = (props, args) => (isMap(args) ? Object.keys(args) : []).filter((k) => !Object.hasOwn(props, k) && k !== 'verbose');
const quoted = (keys) => keys.map((k) => `'${k}'`).join(', ');
function checkArgs(name, args, tail = '') {
  const props = toolProps(name);
  const unknown = props ? unknownArgs(props, args) : [];
  if (unknown.length) throw new WeaveError(`${name} takes ${Object.keys(props).join(', ') || 'no arguments'}; unknown ${quoted(unknown)}${tail}`, 'invalid');
}
function checkRowArgs(name, args, required) {
  const unknown = unknownArgs(toolProps(name), args);
  const extra = unknown.length ? `; unknown ${quoted(unknown)}` : '';
  if (required && !isMap(args.values)) throw new WeaveError(`values is required: a map of field name to value, e.g. {"Name": "…"}${extra}`, 'invalid');
  if (!required && args.values != null && !isMap(args.values)) throw new WeaveError(`values is a map of field name to value, e.g. {"Name": "…"}${extra}`, 'invalid');
  checkArgs(name, args, '; field values go in values');
}

const ROW_ARGS = {
  weave_create_entity: (args) => checkRowArgs('weave_create_entity', args, false),
  weave_update_entity: (args) => checkRowArgs('weave_update_entity', args, true),
};

export function dispatchTool(weave, name, args = {}, { caller = null } = {}) {
  if (!visible(caller, name)) throw hidden(name, caller);
  const command = toolCommand(name, args);
  const row = command ?? DOOR_TOOLS[name];
  if (caller && row) {
    const own = !!row.owns?.(weave, args);
    if ((!admits(caller, row) && !own) || (row.minRole === 'architect' && weave.state.meta.requireAuth && !caller.role)) throw needs(name, row, caller);
    if (caller.seat && row.minRole !== 'observer' && !own) throw new Error(caller.seat);
  }
  if (caller && !caller.role && (name === 'weave_keys' || (name === 'weave_runs' && row.minRole !== 'observer'))) throw new WeaveError(`${label(name, row)} needs an account on this workspace`, 'forbidden');
  if (caller && name === 'weave_forms' && ((weave.state.meta.requireAuth && !caller.role) || !mayAdminister(weave, caller.role))) throw new Error('Form management needs an architect token on this workspace');
  weave.maybeRefresh?.();
  ROW_ARGS[name]?.(args);
  if (caller && command?.writes === 'entity' && command.minRole === 'editor' && !mayAdminister(weave, caller.role)) {
    const system = systemTarget(weave, command, args);
    if (system) throw systemWrite(system);
  }
  const given = command?.toolArgs?.(args) ?? args;
  checkArgs(name, given);
  if (command) {
    const result = command.run(weave, given, { caller, origin: envOrigin(), door: 'mcp' });
    return command.toolResult ? command.toolResult(result) : result;
  }
  switch (name) {
    case 'weave_forms':
      if (args.action === 'list') return listForms(weave);
      if (args.action === 'get') return getFormDefinition(weave, args.form);
      if (args.action === 'create') {
        if (args.definition?.kind !== undefined) throw new Error('Form management creates record forms');
        return createForm(weave, args.definition);
      }
      if (args.action === 'update') return updateForm(weave, args.form, args.definition);
      throw new Error('Form action must be list, get, create or update');
    case 'weave_form_submit':
      return submitForm(weave, args.form, { values: args.values, note: args.note, categories: args.categories, events: [] }, { actor: weave.actor, idempotencyKey: args.idempotencyKey, server: { version: VERSION, workspace: weave.state.meta.name } });
    default:
      throw unknownTool(name);
  }
}

const PRIMER = readFileSync(new URL('./mcp-primer.md', import.meta.url), 'utf8');
export const primer = () => PRIMER;

export function handleMcpMessage(weave, msg, { version = VERSION, caller = null, tools = toolProfile() } = {}) {
  const { id, method, params } = msg ?? {};
  const reply = (result) => (id !== undefined ? { jsonrpc: '2.0', id, result } : null);
  const fail = (code, message) => (id !== undefined ? { jsonrpc: '2.0', id, error: { code, message } } : null);
  try {
    switch (method) {
      case 'initialize':
        weave.actor = 'mcp:' + (params?.clientInfo?.name ?? 'client');
        return reply({
          protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'weave', version },
          instructions: PRIMER,
        });
      case 'notifications/initialized':
      case 'initialized':
        return null;
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: listTools(tools).filter((t) => visible(caller, t.name)) });
      case 'tools/call': {
        try {
          const args = params.arguments ?? {};
          const result = callTool(weave, params.name, args, caller);
          return reply(textResult(result, storedSource(weave, params.name, args, result)));
        } catch (err) {
          return reply(mcpToolError(err));
        }
      }
      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return fail(contractFor(err).mcp, err.message);
  }
}

export function startMcpServer(weave, { input = process.stdin, output = process.stdout, tools = toolProfile() } = {}) {
  let buffer = '';

  const send = (msg) => output.write(JSON.stringify(msg) + '\n');

  const handle = (msg) => {
    const response = handleMcpMessage(weave, msg, { tools });
    if (response) send(response);
  };

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      }
    }
  });
}
