import { readFileSync } from 'node:fs';
import { mcpToolError, contractFor } from './errors.js';
import { toolCommand, toolDefinition } from './commands.js';
import { vocabularyView } from './vocabulary.js';
import { guided } from './field-hints.js';
import { Weave, inviteUrl } from './engine.js';
import '../public/starter-core.js';
import { submitForm, listForms, createForm, updateForm, getFormDefinition } from './forms.js';
const PROTOCOL_VERSION = '2024-11-05';
export { QUERY_PAGE } from './commands.js';
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const seal = (text) => text.replace(/<(?=\/?weave_data)/gi, '\\u003c');
const attr = (v) => String(v ?? '*').replace(/[\s"<>&]+/g, ' ').trim() || '*';
function textResult(data, source = null) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  if (!source) return { content: [{ type: 'text', text }] };
  const head = `<weave_data table="${attr(source.table)}" entity="${attr(source.entity)}" field="${attr(source.field)}">`;
  return { content: [{ type: 'text', text: `${head}\n${seal(text)}\n</weave_data>` }] };
}

function storedSource(weave, name, args) {
  if (name === 'weave_call' && args.name !== 'help') {
    let inner = args.args ?? {};
    try { if (typeof inner === 'string') inner = JSON.parse(inner); } catch { inner = {}; }
    return storedSource(weave, args.name, inner ?? {});
  }
  if (!READ_ONLY.has(name)) return null;
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

function pick(args, keys) {
  const out = {};
  for (const k of keys) if (k in args) out[k] = args[k];
  return out;
}

export const TOOLS = [
  toolDefinition('weave_ontology'),
  {
    name: 'weave_schema',
    description: 'Describe the whole workspace: spaces, tables, fields (with types, options, workflow states, relations, lookups, rollups, formulas), and entity counts.',
    inputSchema: { type: 'object', properties: {} },
  },
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
  {
    name: 'weave_attach_file',
    description: 'Attach a file to a record, optionally to an attachments field. For local files over HTTP, send prepare:true and size (bytes), without contentBase64: returns a one-use PUT URL and headers, valid ten minutes. Send the raw file bytes from a local script using those headers; no separate editor token or base64 in context is needed. Each transfer attempt consumes its grant, even on failure. Grants expire on server restart; prepare again if refused. Stdio and small inline files can use contentBase64.',
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'string' }, field: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, contentBase64: { type: 'string' }, prepare: { type: 'boolean' }, size: { type: 'integer', minimum: 0, maximum: 10485760 } },
      required: ['entity', 'name'],
    },
  },
  {
    name: 'weave_vocabulary',
    description: 'Every closed set a configuration value comes from, and what each choice looks like on screen: field types with how they render and which config keys they take, the option color palette, the icon names, number/date formats, document kinds, relation cardinalities, workflow state categories, rollup aggregates, system columns, view kinds, the column-width rules, and formulaFunctions — every formula function with its signature, group, doc and an example. Read this before configuring a table. Name every section you need in one call (sections:["icons","optionColors"]); query searches the icon names by name, category and synonym ("wallet, bank" searches both).',
    inputSchema: { type: 'object', properties: { sections: { type: 'array', items: { type: 'string' } }, section: { type: 'string' }, query: { type: 'string' } } },
  },
  toolDefinition('weave_update_space'),
  {
    name: 'weave_template_list',
    description: 'The template spaces of this workspace: the live spaces marked template: true (weave_update_space marks one, or the Template box on its System/Spaces record). Each is a space: id, name, description, icon. Also starters: the built-in starter workspaces (id, title, blurb, and grows, a note on how one is meant to grow). starter: <id> answers {starter, spec}, a spec dated this month to pass to weave_build.',
    inputSchema: { type: 'object', properties: { starter: { type: 'string' } } },
  },
  {
    name: 'weave_template_use',
    description: 'Copy a template space\'s schema, never its records, into another workspace of this hub: its tables, fields with their config, option colours and icons, workflow states, views, field order, hidden fields, filters, sort, the term, the icons and the space rollups over its tables. space: the template space (name or id). workspace: the target, a name as the hub lists it. name: the new space\'s name, the template\'s by default; a name the target already holds is refused. A relation to a table outside the space is left out and named in `skipped`, with every lookup, rollup and formula that reads through it. Needs an architect on the target. Answers {space, workspace, url, plan, skipped}. Over HTTP only: a stdio server holds one workspace, so there use the CLI, weave template use <space> --into <other.db>.',
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string' }, workspace: { type: 'string' }, name: { type: 'string' } },
      required: ['space', 'workspace'],
    },
  },
  toolDefinition('weave_delete_space'),
  toolDefinition('weave_restore_space'),
  toolDefinition('weave_update_table'),
  {
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
  toolDefinition('weave_move_table'),
  toolDefinition('weave_duplicate_table'),
  toolDefinition('weave_delete_table'),
  toolDefinition('weave_restore_table'),
  toolDefinition('weave_update_field'),
  toolDefinition('weave_rollback_field'),
  toolDefinition('weave_delete_field'),
  toolDefinition('weave_restore_field'),
  {
    name: 'weave_apply_schema',
    description: 'Apply a whole schema document — the array weave_schema returns — creating, updating and (with allowDestructive) deleting spaces, tables and fields so the workspace matches it. dryRun returns the plan without writing; partial adds or updates only what the document names and leaves every other space alone. Everything weave_schema emits round-trips, including option colors, widths, icons, nouns, hidden columns and column order.',
    inputSchema: {
      type: 'object',
      properties: { document: { type: 'array' }, dryRun: { type: 'boolean' }, allowDestructive: { type: 'boolean' }, partial: { type: 'boolean' } },
      required: ['document'],
    },
  },
  {
    name: 'weave_build',
    description: 'Build in ONE call: spaces, tables, fields, relations and records. A field is {name, type, plus that type\'s weave_add_field config keys, flat}; a relation is {name, type:"relation", to:<table>, cardinality?}; lookups, rollups and formulas may read relations made in the same build. Records are values by field name; a relation value is the target record\'s Name. Re-sending the spec is safe: existing spaces, tables and same-typed fields are reused; records append; skipExistingRows:true skips Names already there. A refused icon or colour is dropped, not fatal. Returns one line: {ok, created, existing, ignored (keys dropped, with reason), errors:[{path, error}], computed:{field: its first values}}. Example spec:\n'
      + '{"workspace":"personal-finance","spaces":[{"name":"Budget","icon":"lucide:wallet","tables":[{"name":"Account","icon":"lucide:credit-card","fields":[{"name":"Kind","type":"select","options":[{"name":"Credit card"},{"name":"Checking"}]}],"records":[{"Name":"Amex Gold","Kind":"Credit card"}]},{"name":"Transaction","fields":[{"name":"Amount","type":"number","format":"currency","currency":"USD"},{"name":"Date","type":"date"},{"name":"Account","type":"relation","to":"Account","cardinality":"many-to-one"}],"records":[{"Name":"Whole Foods","Amount":142.18,"Date":"2026-08-03","Account":"Amex Gold"}]}]}]}\n'
      + 'dryRun:true first is cheap: it checks the whole spec, returns every error with its path, and writes nothing. Any error means nothing is written.',
    inputSchema: {
      type: 'object',
      properties: { spec: { type: 'object', description: '{workspace?, description?, spaces:[{name, icon?, description?, tables:[{name, icon?, description?, fields?, records?, fieldOrder? (leading names), hidden? (names), sort? ("Amount desc")}]}]}' }, dryRun: { type: 'boolean' }, skipExistingRows: { type: 'boolean', description: 'Skip a record whose Name the table already holds (for a re-run)' } },
      required: ['spec'],
    },
  },
  {
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
  },
  {
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
  },
  toolDefinition('weave_automations'),
  toolDefinition('weave_activity'),
  toolDefinition('weave_audit'),
  {
    name: 'weave_workspace',
    description: 'The workspace record itself. action: get | update (name: any text, kept as the title; its slug, lowercase letters, digits and -, is the /w/<slug>/ address and the <slug>.<base domain> host, description, linkPreview) | logo (contentBase64 + name; type read from the bytes) | clear-logo | order | move (name, position: 0 first).',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, linkPreview: { type: 'boolean' }, contentBase64: { type: 'string' }, position: { type: 'number' } },
    },
  },
  {
    name: 'weave_accounts',
    description: 'Agent and human accounts. action: list | create (name, role: observer|editor|architect, default editor; space scopes the token to one space, and a token never reaches past the account that made it — observer reads and comments, editor writes records, architect also changes structure and accounts; the old names reader|writer|admin are deprecated aliases; the token is returned once) | set (account, role — changes role without rotating tokens or sessions; cannot demote the last architect) | delete | require-auth (on: true|false, which turns token auth on for the whole workspace) | sessions (account — the browser sessions it holds) | revoke-session (account, session id or all: true) | link-identity (account, issuer — mints a one-time invite link, good for 7 days; the person who opens it and signs in at the OpenID Connect provider is linked by subject, and weave stores no email. Signing in at the provider provisions nobody, so an account opens to a provider identity only through this. issuer defaults to WEAVE_OIDC_ISSUER; the url is rooted at WEAVE_ORIGIN) | unlink-identity (account, subject, issuer — the subject account list shows) | invite (email, role default editor, issuer — invites a new person: answers a one-time sign-in link, good for 7 days, that makes the account at that role when they sign in; weave sends no email, so hand the link over) | invites (the pending ones: email, role, invitedBy, createdAt) | revoke-invite (invite: the id invites shows).',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, space: { type: 'string', description: 'create only: scope the token to this one space' }, account: { type: 'string' }, on: { type: 'boolean' }, session: { type: 'string' }, all: { type: 'boolean' }, subject: { type: 'string' }, issuer: { type: 'string' }, email: { type: 'string' }, invite: { type: 'string' } },
      required: ['action'],
    },
  },
  toolDefinition('weave_keys'),
  {
    name: 'weave_files',
    description: 'Files already attached to an entity: action read (returns base64 content) | delete. Attach one with weave_attach_file.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, entity: { type: 'string' }, file: { type: 'string' } },
      required: ['action', 'file'],
    },
  },
  toolDefinition('weave_registry'),
  toolDefinition('weave_relation_map'),
  {
    name: 'weave_export_json',
    description: 'The whole workspace as JSON — the human-readable interchange format, and the backup to take before a destructive apply. Attachment bytes are left out unless blobs is true; `weave export` always carries them.',
    inputSchema: { type: 'object', properties: { blobs: { type: 'boolean' } } },
  },
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
  {
    name: 'weave_import_json',
    description: 'Replace the workspace with a JSON export. Destructive: everything not in the document is gone. The result names every file that arrived without its bytes (missing).',
    inputSchema: { type: 'object', properties: { state: { type: 'object' } }, required: ['state'] },
  },
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
  weave_undo: 'revert the last record edits (list: true previews)',
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
    'Call any weave tool by name: {name, args}, where args is that tool\'s input. {name: "help", args: {tool}} returns its description and input schema; read it before the first call. The tools not listed on their own:',
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
  weave_automations: 'Manage automations', weave_activity: 'Read activity feed', weave_audit: 'Read audit log',
  weave_workspace: 'Read or update workspace', weave_accounts: 'Manage accounts', weave_keys: 'Manage credential keys',
  weave_files: 'Read or delete files', weave_registry: 'Check workspace registry', weave_relation_map: 'Draw relation map',
  weave_export_json: 'Export workspace as JSON', weave_forms: 'Manage forms', weave_form_submit: 'Submit form',
  weave_import_json: 'Replace workspace from JSON', weave_call: 'Call any weave tool',
};
const READ_ONLY = new Set([
  'weave_ontology', 'weave_schema', 'weave_query', 'weave_get_entity', 'weave_search', 'weave_stats', 'weave_trash',
  'weave_get_doc', 'weave_doc_revisions', 'weave_check_formula', 'weave_export_csv', 'weave_export_json',
  'weave_vocabulary', 'weave_template_list', 'weave_activity', 'weave_audit', 'weave_relation_map',
]);
const DESTRUCTIVE = new Set([
  'weave_delete_entity', 'weave_delete_comment', 'weave_delete_space', 'weave_delete_table', 'weave_delete_field',
  'weave_bulk', 'weave_undo', 'weave_set_doc', 'weave_doc_restore', 'weave_update_field', 'weave_rollback_field',
  'weave_apply_schema', 'weave_import_json', 'weave_automations', 'weave_accounts', 'weave_keys', 'weave_files',
  'weave_views', 'weave_shares', 'weave_workspace', 'weave_call',
]);
const OPEN_WORLD = new Set(['weave_create_automation', 'weave_automations', 'weave_call']);
const IDEMPOTENT = new Set([
  ...READ_ONLY,
  'weave_update_entity', 'weave_delete_entity', 'weave_restore_entity', 'weave_set_state', 'weave_link', 'weave_unlink',
  'weave_doc_restore', 'weave_delete_comment', 'weave_update_space', 'weave_delete_space', 'weave_restore_space',
  'weave_update_table', 'weave_table_view', 'weave_move_table', 'weave_delete_table', 'weave_restore_table',
  'weave_update_field', 'weave_rollback_field', 'weave_delete_field', 'weave_restore_field', 'weave_apply_schema',
  'weave_automations', 'weave_workspace', 'weave_keys', 'weave_files', 'weave_registry', 'weave_import_json',
]);
for (const t of TOOLS) {
  t.annotations = { title: TITLES[t.name], readOnlyHint: READ_ONLY.has(t.name), destructiveHint: DESTRUCTIVE.has(t.name), idempotentHint: IDEMPOTENT.has(t.name), openWorldHint: OPEN_WORLD.has(t.name) };
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
    let inner = rawArgs.args ?? {};
    if (typeof inner === 'string') inner = JSON.parse(inner);
    if (rawArgs.name === 'help') {
      const t = TOOLS.find((x) => x.name === inner.tool && mayCall(caller, x.name));
      if (!t) throw new Error(`help needs args.tool, one of the names weave_call lists (got ${JSON.stringify(inner.tool ?? null)})`);
      return { name: t.name, description: t.description, inputSchema: t.inputSchema };
    }
    if (!rawArgs.name || rawArgs.name === 'weave_call') throw new Error('weave_call needs name: a weave tool name, or "help"');
    return callTool(weave, rawArgs.name, inner, caller);
  }
  const { verbose, ...args } = rawArgs;
  const result = dispatchTool(weave, name, COMPACT_TOOLS.has(name) ? args : rawArgs, { caller });
  return verbose === true ? result : compactResult(name, result);
}

const systemWrite = (system) => new Error(system === 'users' ? 'Writing a Users record needs an architect token' : 'Writing a record of a system table needs an architect token');
function refuseUsersWrite(weave, ref, caller) {
  if (!caller || mayAdminister(weave, caller.role)) return;
  let system = null;
  try { system = weave.state.tables[weave.getEntity(ref).dbId]?.system; } catch {}
  if (system) throw systemWrite(system);
}

export function mayAdminister(on, role) {
  return Weave.roleName(role) === 'architect' || !on.listAccounts().length;
}
const ADMIN_TOOLS = { weave_accounts: 'workspace', weave_import_json: 'workspace', weave_keys: 'workspace', weave_shares: 'workspace' };
export const SEATLESS_TOOLS = new Set(['weave_ontology', 'weave_schema', 'weave_query', 'weave_get_entity', 'weave_search', 'weave_trash', 'weave_stats', 'weave_get_doc', 'weave_doc_revisions', 'weave_check_formula', 'weave_export_csv', 'weave_vocabulary', 'weave_template_list', 'weave_activity', 'weave_relation_map', 'weave_add_comment']);
export const ROLE_TOOLS = {
  observer: new Set([...SEATLESS_TOOLS, 'weave_call']),
  editor: new Set([...SEATLESS_TOOLS, 'weave_call', 'weave_create_entity', 'weave_update_entity', 'weave_delete_entity', 'weave_attach_file']),
};
const WORKSPACE_TOOLS = new Set(['weave_create_space', 'weave_build', 'weave_apply_schema', 'weave_template_use', 'weave_create_automation', 'weave_automations', 'weave_registry', 'weave_views', 'weave_workspace', 'weave_forms', 'weave_import_json', 'weave_export_json', 'weave_keys', 'weave_shares', 'weave_accounts', 'weave_undo']);
const mayCall = (caller, name) => {
  const tier = WORKSPACE_TOOLS.has(name) ? caller?.workspaceTier ?? caller?.tier : caller?.tier;
  return !ROLE_TOOLS[tier] || ROLE_TOOLS[tier].has(name);
};
const unknownTool = (name) => Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });

const isMap = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
function checkRowArgs(name, args, required) {
  const props = TOOLS.find((t) => t.name === name).inputSchema.properties;
  const unknown = Object.keys(args).filter((k) => !Object.hasOwn(props, k) && k !== 'verbose');
  const extra = unknown.length ? `; unknown ${unknown.map((k) => `'${k}'`).join(', ')}` : '';
  if (required && !isMap(args.values)) throw new Error(`values is required: a map of field name to value, e.g. {"Name": "…"}${extra}`);
  if (!required && args.values != null && !isMap(args.values)) throw new Error(`values is a map of field name to value, e.g. {"Name": "…"}${extra}`);
  if (unknown.length) throw new Error(`${name} takes ${Object.keys(props).join(', ')}${extra}; field values go in values`);
}

const ROW_GUARDS = {
  weave_create_entity: (weave, args, caller) => {
    checkRowArgs('weave_create_entity', args, false);
    if (caller && !mayAdminister(weave, caller.role) && weave.findTable(args.db)?.system) throw systemWrite(weave.findTable(args.db).system);
  },
  weave_update_entity: (weave, args, caller) => {
    checkRowArgs('weave_update_entity', args, true);
    refuseUsersWrite(weave, args.entity, caller);
  },
  weave_delete_entity: (weave, args, caller) => refuseUsersWrite(weave, args.entity, caller),
};

export function dispatchTool(weave, name, args = {}, { caller = null } = {}) {
  if (!mayCall(caller, name)) throw unknownTool(name);
  if (caller?.seat && !SEATLESS_TOOLS.has(name)) throw new Error(caller.seat);
  if (caller && name === 'weave_keys' && !caller.role) throw new Error('Managing keys needs an account on this workspace');
  if (caller && ADMIN_TOOLS[name]) {
    if ((weave.state.meta.requireAuth && !caller.role) || !mayAdminister(weave, caller.role)) throw new Error(`${name} needs an architect token on this workspace`);
  }
  if (caller && name === 'weave_forms' && ((weave.state.meta.requireAuth && !caller.role) || !mayAdminister(weave, caller.role))) throw new Error('Form management needs an architect token on this workspace');
  weave.maybeRefresh?.();
  ROW_GUARDS[name]?.(weave, args, caller);
  const command = toolCommand(name, args);
  if (command) {
    const result = command.run(weave, args, { caller, origin: envOrigin() });
    return command.toolResult ? command.toolResult(result) : result;
  }
  switch (name) {
    case 'weave_schema':
      return weave.describeSchema();
    case 'weave_attach_file': {
      if (args.prepare === true) {
        if (!caller?.prepareUpload) throw new Error('Prepare uploads over the authenticated HTTP MCP endpoint; stdio callers can use the file attach CLI.');
        return caller.prepareUpload(args);
      }
      if (typeof args.contentBase64 !== 'string') throw new Error('Send contentBase64, or prepare:true and size for a raw upload.');
      const file = { name: args.name, mime: args.mime, bytes: args.contentBase64 };
      return args.field == null ? weave.attachFile(args.entity, file) : weave.attachToField(args.entity, args.field, file);
    }
    case 'weave_vocabulary':
      return vocabularyView(args.sections ?? args.section, args.query);
    case 'weave_template_list':
      return args.starter != null ? globalThis.WeaveStarters.forAgent(args.starter) : { templates: weave.listTemplates(), starters: globalThis.WeaveStarters.catalog() };
    case 'weave_template_use':
      if (!caller?.useTemplate) {
        throw new Error('weave_template_use copies into another workspace of a hub, and this stdio server holds one workspace. Call it over the HTTP door (POST /api/mcp, or /mcp on the hosted instance), or run weave template use <space> --into <other.db> on the CLI.');
      }
      return caller.useTemplate({ space: args.space, workspace: args.workspace, name: args.name });
    case 'weave_table_view': {
      const { view, ...patch } = args;
      return weave.tableView(view, Object.keys(patch).length ? patch : null);
    }
    case 'weave_apply_schema':
      return { plan: weave.applySchema(args.document, { dryRun: Boolean(args.dryRun), allowDestructive: Boolean(args.allowDestructive), partial: Boolean(args.partial) }) };
    case 'weave_build': {
      const { spec, dryRun, skipExistingRows, ...bare } = args;
      return JSON.stringify(weave.build(spec ?? bare, { dryRun: Boolean(dryRun), skipExistingRows: Boolean(skipExistingRows) }));
    }
    case 'weave_views':
      switch (args.action) {
        case 'list': return { views: weave.listViews({ trash: Boolean(args.trash) }) };
        case 'get': return weave.resolveView(args.view);
        case 'create': return weave.createView({ name: args.name, blocks: args.blocks ?? [] });
        case 'delete': return weave.deleteView(args.view, { hard: Boolean(args.hard) });
        case 'restore': return weave.restoreView(args.view);
        case 'share':
        case 'unshare':
          if (caller && !mayAdminister(weave, caller.role)) throw new Error('Sharing a view, or ending its link, needs an architect token');
          return args.action === 'share' ? weave.shareView(args.view) : weave.unshareView(args.view);
        default: throw new Error(`Unknown views action '${args.action}' (list, get, create, delete, restore, share, unshare)`);
      }
    case 'weave_shares': {
      switch (args.action) {
        case 'list': return { shares: weave.listShares({ kind: args.kind ?? null, id: args.id ?? null, includeInactive: Boolean(args.includeInactive) }) };
        case 'mint': return weave.mintShare({ scope: args.kind === 'entities' ? { kind: args.kind, ids: args.ids } : { kind: args.kind, id: args.id }, mode: args.mode, visibility: args.visibility, label: args.label, expiry: args.expiry, expiresAt: args.expiresAt, formId: args.formId });
        case 'update':
        case 'regenerate': {
          const patch = Object.fromEntries(['label', 'expiry', 'expiresAt'].filter((key) => Object.hasOwn(args, key)).map((key) => [key, args[key]]));
          return args.action === 'update' ? weave.updateShare(args.share, patch) : weave.regenerateShare(args.share, patch);
        }
        case 'renew': return weave.renewShare(args.share);
        case 'revoke': return weave.revokeShare(args.share);
        default: throw new Error(`Unknown shares action '${args.action}' (list, mint, renew, revoke, update, regenerate)`);
      }
    }
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
    case 'weave_workspace':
      switch (args.action ?? 'get') {
        case 'get': return weave.getWorkspace();
        case 'update': return (caller?.updateWorkspace ?? ((p) => weave.updateWorkspace(p)))(pick(args, ['name', 'description', 'linkPreview']));
        case 'logo': return weave.setWorkspaceLogo({ name: args.name ?? 'logo.png', bytes: args.contentBase64 });
        case 'clear-logo': weave.deleteWorkspaceLogo(); return { logo: false };
        case 'order': return { workspaces: caller?.workspaceOrder ? caller.workspaceOrder() : weave.workspaceOrder() };
        case 'move':
          if (caller && !mayAdminister(weave, caller.role)) throw new Error('weave_workspace move needs an architect token on this workspace');
          return { workspaces: caller?.moveWorkspace ? caller.moveWorkspace(args.name, args.position) : weave.moveWorkspace(args.name, args.position) };
        default: throw new Error(`Unknown workspace action '${args.action}' (get, update, logo, clear-logo, order, move)`);
      }
    case 'weave_accounts':
      switch (args.action) {
        case 'list': return { accounts: weave.listAccounts() };
        case 'create': return weave.createAccount({ name: args.name, role: args.role ?? 'editor', space: args.space ?? null });
        case 'set': return weave.setAccountRole(args.account ?? args.name, args.role);
        case 'delete': return weave.deleteAccount(args.account);
        case 'require-auth': return weave.setRequireAuth(Boolean(args.on));
        case 'sessions': return { sessions: weave.listSessions(args.account ?? args.name) };
        case 'revoke-session': return weave.revokeSession(args.account ?? args.name, { id: args.session ?? null, all: Boolean(args.all) });
        case 'link-identity': {
          const made = weave.linkIdentity(args.account ?? args.name, { issuer: args.issuer ?? process.env.WEAVE_OIDC_ISSUER, email: args.email });
          return { ...made, url: inviteUrl(envOrigin(), made.code) };
        }
        case 'unlink-identity': return weave.unlinkIdentity(args.account ?? args.name, { issuer: args.issuer ?? null, subject: args.subject });
        case 'invite': {
          const made = weave.inviteMember({ email: args.email, role: args.role ?? 'editor', issuer: args.issuer ?? process.env.WEAVE_OIDC_ISSUER });
          return { ...made, url: inviteUrl(envOrigin(), made.code) };
        }
        case 'invites': return { invites: weave.listInvites() };
        case 'revoke-invite': return weave.revokeInvite(args.invite ?? args.id);
        default: throw new Error(`Unknown accounts action '${args.action}' (list, create, set, delete, require-auth, sessions, revoke-session, link-identity, unlink-identity, invite, invites, revoke-invite)`);
      }
    case 'weave_files':
      switch (args.action) {
        case 'read': {
          const { meta, bytes } = weave.readFile(args.file);
          return { ...meta, contentBase64: Buffer.from(bytes).toString('base64') };
        }
        case 'delete': return weave.deleteFile(args.entity, args.file);
        default: throw new Error(`Unknown files action '${args.action}' (read, delete)`);
      }
    case 'weave_export_json':
      return weave.exportJSON({ blobs: args.blobs === true });
    case 'weave_import_json':
      return { ok: true, ...weave.importJSON(args.state) };
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
        return reply({ tools: listTools(tools).filter((t) => mayCall(caller, t.name)) });
      case 'tools/call': {
        try {
          return reply(textResult(callTool(weave, params.name, params.arguments ?? {}, caller), storedSource(weave, params.name, params.arguments ?? {})));
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
