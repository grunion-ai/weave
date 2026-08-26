// MCP (Model Context Protocol) server core: JSON-RPC 2.0 messages over two
// transports — newline-delimited stdio (local agents) and POST /api/mcp
// (Feature #99, the hosted instance). One handler serves both.

import { readFileSync } from 'node:fs';
import { VOCABULARY } from './vocabulary.js';
const PROTOCOL_VERSION = '2024-11-05';
// Lazy-tolerant, same reason as pdf.js's font path: module-top file reads
// crash the workerd bundle at cold start. The HTTP transport passes the real
// version in; 'dev' is only ever the stdio fallback on a broken checkout.
let VERSION = 'dev';
try {
  VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
} catch { /* bundled runtime — version arrives via handleMcpMessage opts */ }

function textResult(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] };
}

// Only the keys a caller actually named: an absent key means "leave it", and
// the engine's patches distinguish that from an explicit null.
function pick(args, keys) {
  const out = {};
  for (const k of keys) if (k in args) out[k] = args[k];
  return out;
}

// Entity refs accepted everywhere: raw entity id, or "Table#publicId".
function resolveEntity(weave, ref) {
  const m = String(ref).match(/^(.+)#(\d+)$/);
  if (m) {
    const found = weave.findEntity(m[1], '#' + m[2]);
    if (found) return found.id;
  }
  return weave.getEntity(ref).id;
}

export const TOOLS = [
  {
    name: 'weave_schema',
    description: 'Describe the whole workspace: spaces, tables, fields (with types, options, workflow states, relations, lookups, rollups, formulas), and entity counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'weave_query',
    description: 'Query entities in a table. Filters support dotted relation paths (e.g. ["Project.Name", "=", "Apollo"]). Operators: =, !=, <, <=, >, >=, contains, in, is-empty, not-empty. Combine with {and:[...]} / {or:[...]}.',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string', description: 'Table name, Space/Name, or id' },
        where: { description: 'Array of [path, op, value] conditions (AND) or {and/or} tree' },
        sort: { description: 'Array of field names or {field, dir} objects' },
        limit: { type: 'number' },
        offset: { type: 'number' },
        select: { type: 'array', items: { type: 'string' }, description: 'Field paths to return (omit for full entities)' },
        includeDeleted: { type: 'boolean', description: 'Also return soft-deleted (trashed) entities' },
      },
      required: ['db'],
    },
  },
  {
    name: 'weave_get_entity',
    description: 'Read one entity in full: all field values (including computed lookups/rollups/formulas), document markdown, comments, activity.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string', description: 'Entity id or "Table#publicId"' } }, required: ['entity'] },
  },
  {
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
  {
    name: 'weave_update_entity',
    description: 'Update entity field values by name (writable fields only; computed fields are read-only).',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, values: { type: 'object' } }, required: ['entity', 'values'] },
  },
  {
    name: 'weave_delete_entity',
    description: 'Delete an entity. Recoverable by default — it moves to the trash keeping its id, public id and links. Pass hard: true to purge it irreversibly (relations are unlinked cleanly).',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, hard: { type: 'boolean' } }, required: ['entity'] },
  },
  {
    name: 'weave_restore_entity',
    description: 'Restore a soft-deleted entity from the trash, links intact.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' } }, required: ['entity'] },
  },
  {
    name: 'weave_trash',
    description: 'List deleted entities — one table, or the whole workspace when table is omitted.',
    inputSchema: { type: 'object', properties: { table: { type: 'string' } } },
  },
  {
    name: 'weave_undo',
    description: 'Revert the last entity mutation(s): field/doc/state/relation edits, creates, soft deletes, comments, file attachments. Schema changes and hard deletes are not undoable. Pass list:true to preview the stack without reverting.',
    inputSchema: { type: 'object', properties: { steps: { type: 'number' }, list: { type: 'boolean' } } },
  },
  {
    name: 'weave_set_state',
    description: 'Move an entity to a workflow state (multistate field).',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string' }, state: { type: 'string' } }, required: ['entity', 'field', 'state'] },
  },
  {
    name: 'weave_link',
    description: 'Link entities through a relation field (bidirectional; inverse side updates automatically).',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string' }, targets: { type: 'array', items: { type: 'string' } } }, required: ['entity', 'field', 'targets'] },
  },
  {
    name: 'weave_unlink',
    description: 'Remove entities from a relation field, leaving both entities in place. targets takes ids, names, or "#publicId"; the inverse field on the other table follows.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string' }, targets: { type: 'array', items: { type: 'string' } } }, required: ['entity', 'field', 'targets'] },
  },
  {
    name: 'weave_get_doc',
    description: 'Read an entity document as markdown. Entities can carry several document fields; omit field for the default (the table\'s first document field, usually "Description").',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string', description: 'Document field name (optional)' } }, required: ['entity'] },
  },
  {
    name: 'weave_set_doc',
    description: 'Write an entity document. mode "replace" (default) or "append". field picks a document field; omit for the default.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, markdown: { type: 'string' }, mode: { type: 'string', enum: ['replace', 'append'] }, field: { type: 'string' } }, required: ['entity', 'markdown'] },
  },
  {
    name: 'weave_add_comment',
    description: 'Add a comment to an entity. Comments are their own thread on the entity page and ride the activity feed; delete one with weave_delete_comment.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, text: { type: 'string' }, author: { type: 'string' } }, required: ['entity', 'text'] },
  },
  {
    name: 'weave_delete_comment',
    description: 'Delete one comment from an entity. The comment id comes from weave_get_entity.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, comment: { type: 'string' } }, required: ['entity', 'comment'] },
  },
  {
    name: 'weave_search',
    description: 'Universal search across the workspace, spaces, tables, and entities (names, documents, comments). Every result carries a stable permalink url.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'weave_create_space',
    description: 'Create a space (top-level grouping of tables).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'weave_create_table',
    description: 'Create a table in a space (a Name text field and a Description document are added automatically). icon is `iconly:<name>` from weave_vocabulary.',
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' } },
      required: ['space', 'name'],
    },
  },
  {
    name: 'weave_add_field',
    description: 'Add a field. Every type, its config keys and what it looks like in the grid: weave_vocabulary. Types: text, number, date, daterange, checkbox, url, email, select, multiselect, workflow, document, attachments, field, key, lookup, rollup, formula (relation fields use weave_add_relation). config: {options:[...]} for selects; {states:[{name,category,default}]} for workflow (categories: not-started, in-progress, done, canceled); {relationField, targetField} for lookup; {relationField, targetField, aggregate} for rollup (count,sum,avg,min,max,join); {expression} for formula. Any of text, number, date, daterange, checkbox, url, email, select, multiselect may also carry {default}: the value a new entity starts with when the create does not name the field (a workflow uses its default state instead). Any field may carry {width} in px (60 minimum) to set its column.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' } },
      required: ['db', 'name', 'type'],
    },
  },
  {
    name: 'weave_add_relation',
    description: 'Create a bidirectional relation between two tables. Cardinality: many-to-one (this side holds one), one-to-many, many-to-many, one-to-one. The inverse field is created automatically on the target table.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, name: { type: 'string' }, targetDb: { type: 'string' }, cardinality: { type: 'string' }, inverseName: { type: 'string' } },
      required: ['db', 'name', 'targetDb'],
    },
  },
  {
    name: 'weave_create_automation',
    description: 'Create an automation rule. trigger: {type: entity-created | field-updated | state-changed, field?, toState?}. actions: [{type: set-field, field, value} | {type: append-doc, text} | {type: add-comment, text}] — text supports {{FieldName}}, {{PublicId}}, {{Today}} templates.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, name: { type: 'string' }, trigger: { type: 'object' }, actions: { type: 'array' } },
      required: ['db', 'trigger', 'actions'],
    },
  },
  {
    name: 'weave_export_csv',
    description: 'Export a table as CSV: one row per entity, one column per field, computed fields resolved. Multiselect and to-many relation cells use "; " separators.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' } }, required: ['db'] },
  },
  {
    name: 'weave_import_csv',
    description: 'Import entities from CSV text. The header row maps to field names; multiselect and to-many relation cells use "; " separators. Computed fields and Public Id/Created At/Updated At columns are ignored.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' }, csv: { type: 'string' } }, required: ['db', 'csv'] },
  },
  {
    name: 'weave_attach_file',
    description: 'Attach a file to an entity (base64 content).',
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'string' }, name: { type: 'string' }, mime: { type: 'string' }, contentBase64: { type: 'string' } },
      required: ['entity', 'name', 'contentBase64'],
    },
  },
  /* ---------- configuration: every choice the UI can make, as a tool ----------
     The web UI reaches all of this over REST; an agent had to shell out to
     curl for it, which is a human gate wearing a shell prompt. */
  {
    name: 'weave_vocabulary',
    description: 'Every closed set a configuration value comes from, and what each choice looks like on screen: field types with how they render and which config keys they take, the option color palette, the icon names, number/date formats, document kinds, relation cardinalities, workflow state categories, rollup aggregates, system columns, view kinds, and the column-width rules. Read this before configuring a table.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'weave_update_space',
    description: 'Rename a space or change its description or icon. An icon is `iconly:<name>` from weave_vocabulary — any other string renders as text, so an emoji works too.',
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' } },
      required: ['space'],
    },
  },
  {
    name: 'weave_delete_space',
    description: 'Delete a space and every table in it. Not recoverable.',
    inputSchema: { type: 'object', properties: { space: { type: 'string' } }, required: ['space'] },
  },
  {
    name: 'weave_update_table',
    description: 'Change a table: name, description, icon (`iconly:<name>` from weave_vocabulary; any other string renders as text), noun (what one record is called — "invoice" makes the create action read "New invoice"), hiddenFields (names kept out of the grid, data untouched), systemFields (Created At, Modified At, Created By, Modified By, Activity), fieldOrder (the column order — every field exactly once).',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
        icon: { type: 'string' }, noun: { type: 'string' },
        hiddenFields: { type: 'array', items: { type: 'string' } },
        systemFields: { type: 'array', items: { type: 'string' } },
        fieldOrder: { type: 'array', items: { type: 'string' } },
      },
      required: ['db'],
    },
  },
  {
    name: 'weave_delete_table',
    description: 'Delete a table and its entities. Not recoverable.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' } }, required: ['db'] },
  },
  {
    name: 'weave_update_field',
    description: 'Change a field: rename it, retype it (values are migrated), or edit its config. config keys ride their own lanes — width (px, 60 minimum, null resets to auto), default (null clears), options/states (a full replacement), expression, and the costume keys for number, date, document and attachments. See weave_vocabulary for every legal value.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, field: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' } },
      required: ['db', 'field'],
    },
  },
  {
    name: 'weave_delete_field',
    description: 'Delete a field and its values from every entity of the table. Not recoverable.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' }, field: { type: 'string' } }, required: ['db', 'field'] },
  },
  {
    name: 'weave_apply_schema',
    description: 'Apply a whole schema document — the array weave_schema returns — creating, updating and (with allowDestructive) deleting spaces, tables and fields so the workspace matches it. dryRun returns the plan without writing. Everything weave_schema emits round-trips, including option colors, widths, icons, nouns, hidden columns and column order.',
    inputSchema: {
      type: 'object',
      properties: { document: { type: 'array' }, dryRun: { type: 'boolean' }, allowDestructive: { type: 'boolean' } },
      required: ['document'],
    },
  },
  {
    name: 'weave_views',
    description: 'Saved views: a named list of blocks, each a table plus an optional where and a view kind (table or board — a board groups by the first workflow field, falling back to the first select). action: list | get | create | delete | share | unshare. Sharing mints a capability token; the /view/<token> URL renders that view read-only, even when the workspace requires auth.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' }, view: { type: 'string' }, name: { type: 'string' },
        blocks: { type: 'array', description: '[{table, where?, view?}]' },
      },
      required: ['action'],
    },
  },
  {
    name: 'weave_automations',
    description: 'Automations already on a table: action list | describe (rules in prose) | update | delete. Create one with weave_create_automation.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, db: { type: 'string' }, automation: { type: 'string' }, patch: { type: 'object' } },
      required: ['action'],
    },
  },
  {
    name: 'weave_activity',
    description: 'The activity feed: every change weave recorded, newest first. Filter by entity, table, kinds, or since (ISO timestamp); pass id to read one event in full.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, entity: { type: 'string' }, table: { type: 'string' },
        kinds: { type: 'array', items: { type: 'string' } }, since: { type: 'string' },
        limit: { type: 'number' }, offset: { type: 'number' },
      },
    },
  },
  {
    name: 'weave_audit',
    description: 'The workspace audit log: schema and account events with their actor.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, since: { type: 'string' } } },
  },
  {
    name: 'weave_workspace',
    description: 'The workspace record itself. action: get | update (name — alphanumeric — and description) | logo (contentBase64 + name + mime) | clear-logo.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, mime: { type: 'string' }, contentBase64: { type: 'string' } },
    },
  },
  {
    name: 'weave_accounts',
    description: 'Agent and human accounts. action: list | create (name, role: reader|writer|admin — the token is returned once) | delete | require-auth (on: true|false, which turns token auth on for the whole workspace).',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, account: { type: 'string' }, on: { type: 'boolean' } },
      required: ['action'],
    },
  },
  {
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
  },
  {
    name: 'weave_files',
    description: 'Files already attached to an entity: action read (returns base64 content) | delete. Attach one with weave_attach_file.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, entity: { type: 'string' }, file: { type: 'string' } },
      required: ['action', 'file'],
    },
  },
  {
    name: 'weave_registry',
    description: 'The meta-model registries (Workspace/Spaces, Tables, Fields) whose rows ARE the schema: action report (drift between the registry and the structures it mirrors) | rebuild.',
    inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
  },
  {
    name: 'weave_relation_map',
    description: 'The workspace relation map as a mermaid diagram: every table, relation and automation.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'weave_export_json',
    description: 'The whole workspace as JSON — the human-readable interchange format, and the backup to take before a destructive apply.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'weave_import_json',
    description: 'Replace the workspace with a JSON export. Destructive: everything not in the document is gone.',
    inputSchema: { type: 'object', properties: { state: { type: 'object' } }, required: ['state'] },
  },
];

export function dispatchTool(weave, name, args = {}) {
  // The MCP server is long-running: pick up commits from other processes
  // (CLI, HTTP server) before every tool call.
  weave.maybeRefresh?.();
  switch (name) {
    case 'weave_schema':
      return weave.describeSchema();
    case 'weave_query':
      return weave.query(args.db, {
        where: args.where ?? [], sort: args.sort ?? [], limit: args.limit ?? null,
        offset: args.offset ?? 0, select: args.select ?? null, includeDeleted: Boolean(args.includeDeleted),
      });
    case 'weave_get_entity':
      return weave.readEntity(resolveEntity(weave, args.entity));
    case 'weave_create_entity': {
      const e = weave.createEntity(args.db, { name: args.name, values: args.values, doc: args.doc, docs: args.docs });
      return weave.readEntity(e.id);
    }
    case 'weave_update_entity': {
      const id = resolveEntity(weave, args.entity);
      weave.updateEntity(id, args.values);
      return weave.readEntity(id);
    }
    case 'weave_delete_entity':
      return weave.deleteEntity(resolveEntity(weave, args.entity), { hard: Boolean(args.hard) });
    case 'weave_restore_entity':
      return weave.restoreEntity(resolveEntity(weave, args.entity));
    case 'weave_trash':
      return { items: weave.listTrash(args.table ?? null) };
    case 'weave_undo':
      if (args.list) return { history: weave.listUndo({ limit: Number(args.limit ?? 20) }) };
      return weave.undo({ steps: Math.max(1, Number(args.steps ?? 1)) });
    case 'weave_set_state': {
      const id = resolveEntity(weave, args.entity);
      weave.setState(id, args.field, args.state);
      return weave.readEntity(id);
    }
    case 'weave_link': {
      const id = resolveEntity(weave, args.entity);
      weave.link(id, args.field, args.targets);
      return weave.readEntity(id);
    }
    case 'weave_unlink': {
      const id = resolveEntity(weave, args.entity);
      weave.unlink(id, args.field, args.targets);
      return weave.readEntity(id);
    }
    case 'weave_get_doc':
      return weave.getDoc(resolveEntity(weave, args.entity), args.field ?? null);
    case 'weave_set_doc': {
      const id = resolveEntity(weave, args.entity);
      if (args.mode === 'append') weave.appendDoc(id, args.markdown, args.field ?? null);
      else weave.setDoc(id, args.markdown, args.field ?? null);
      return { ok: true, length: weave.getDoc(id, args.field ?? null).length };
    }
    case 'weave_add_comment':
      return weave.addComment(resolveEntity(weave, args.entity), { author: args.author ?? 'agent', text: args.text });
    case 'weave_delete_comment':
      return weave.deleteComment(resolveEntity(weave, args.entity), args.comment);
    case 'weave_search':
      return weave.universalSearch(args.query, { limit: args.limit ?? 25 });
    case 'weave_create_space':
      return weave.createSpace(pick(args, ['name', 'description', 'icon']));
    case 'weave_create_table':
      return weave.createTable(pick(args, ['space', 'name', 'description', 'icon']));
    case 'weave_add_field':
      return weave.addField(args.db, { name: args.name, type: args.type, config: args.config ?? {} });
    case 'weave_add_relation':
      return weave.addRelation(args.db, { name: args.name, targetDb: args.targetDb, cardinality: args.cardinality ?? 'many-to-one', inverseName: args.inverseName });
    case 'weave_create_automation':
      return weave.createAutomation(args.db, { name: args.name, trigger: args.trigger, actions: args.actions });
    case 'weave_export_csv':
      return weave.exportCSV(args.db);
    case 'weave_import_csv':
      return weave.importCSV(args.db, args.csv);
    case 'weave_attach_file':
      return weave.attachFile(resolveEntity(weave, args.entity), { name: args.name, mime: args.mime, bytes: args.contentBase64 });
    case 'weave_vocabulary':
      return VOCABULARY;
    case 'weave_update_space':
      return weave.updateSpace(args.space, pick(args, ['name', 'description', 'icon']));
    case 'weave_delete_space':
      weave.deleteSpace(args.space);
      return { space: args.space, deleted: true };
    case 'weave_update_table':
      return weave.updateTable(args.db, pick(args, ['name', 'description', 'icon', 'noun', 'hiddenFields', 'systemFields', 'fieldOrder']));
    case 'weave_delete_table':
      weave.deleteTable(args.db);
      return { table: args.db, deleted: true };
    case 'weave_update_field':
      return weave.updateField(args.db, args.field, pick(args, ['name', 'type', 'config']));
    case 'weave_delete_field':
      return weave.deleteField(args.db, args.field);
    case 'weave_apply_schema':
      return { plan: weave.applySchema(args.document, { dryRun: Boolean(args.dryRun), allowDestructive: Boolean(args.allowDestructive) }) };
    case 'weave_views':
      switch (args.action) {
        case 'list': return { views: weave.listViews() };
        case 'get': return weave.resolveView(args.view);
        case 'create': return weave.createView({ name: args.name, blocks: args.blocks ?? [] });
        case 'delete': return weave.deleteView(args.view);
        case 'share': return weave.shareView(args.view);
        case 'unshare': return weave.unshareView(args.view);
        default: throw new Error(`Unknown views action '${args.action}' (list, get, create, delete, share, unshare)`);
      }
    case 'weave_automations':
      switch (args.action) {
        case 'list': return { automations: weave.listAutomations(args.db ?? null) };
        case 'describe': return { rules: weave.describeAutomations(args.db ?? null) };
        case 'update': return weave.updateAutomation(args.automation, args.patch ?? {});
        case 'delete': return weave.deleteAutomation(args.automation);
        default: throw new Error(`Unknown automations action '${args.action}' (list, describe, update, delete)`);
      }
    case 'weave_activity':
      if (args.id) return weave.getActivity(args.id);
      return weave.activityFeed({
        entityId: args.entity ? resolveEntity(weave, args.entity) : null,
        tableRef: args.table ?? null, kinds: args.kinds ?? null, since: args.since ?? null,
        limit: args.limit ?? null, offset: args.offset ?? 0,
      });
    case 'weave_audit':
      return { events: weave.listAudit({ limit: args.limit ?? null, since: args.since ?? null }) };
    case 'weave_workspace':
      switch (args.action ?? 'get') {
        case 'get': return weave.getWorkspace();
        case 'update': return weave.updateWorkspace(pick(args, ['name', 'description']));
        case 'logo': return weave.setWorkspaceLogo({ name: args.name ?? 'logo.png', mime: args.mime ?? 'image/png', bytes: args.contentBase64 });
        case 'clear-logo': weave.deleteWorkspaceLogo(); return { logo: false };
        default: throw new Error(`Unknown workspace action '${args.action}' (get, update, logo, clear-logo)`);
      }
    case 'weave_accounts':
      switch (args.action) {
        case 'list': return { accounts: weave.listAccounts() };
        case 'create': return weave.createAccount({ name: args.name, role: args.role ?? 'writer' });
        case 'delete': return weave.deleteAccount(args.account);
        case 'require-auth': return weave.setRequireAuth(Boolean(args.on));
        default: throw new Error(`Unknown accounts action '${args.action}' (list, create, delete, require-auth)`);
      }
    case 'weave_keys':
      switch (args.action) {
        case 'list': return { keys: weave.listKeys() };
        case 'set': return weave.setKey(args.name, args.value);
        case 'share': return weave.grantKey(args.name, args.account);
        case 'unshare': return weave.revokeKey(args.name, args.account);
        case 'delete': return weave.deleteKey(args.name);
        /* No `reveal`. An agent can name, set, share and drop a credential —
           everything except carry the secret out (Feature #143). */
        case 'reveal': throw new Error('Revealing a secret is not an agent action — use `weave key reveal` or the app.');
        default: throw new Error(`Unknown keys action '${args.action}' (list, set, share, unshare, delete)`);
      }
    case 'weave_files':
      switch (args.action) {
        case 'read': {
          const { meta, bytes } = weave.readFile(args.file);
          return { ...meta, contentBase64: Buffer.from(bytes).toString('base64') };
        }
        case 'delete': return weave.deleteFile(resolveEntity(weave, args.entity), args.file);
        default: throw new Error(`Unknown files action '${args.action}' (read, delete)`);
      }
    case 'weave_registry':
      if ((args.action ?? 'report') === 'rebuild') return weave.rebuildRegistry();
      return weave.registryReport();
    case 'weave_relation_map':
      return { mermaid: weave.relationMapMmd() };
    case 'weave_export_json':
      return weave.exportJSON();
    case 'weave_import_json':
      weave.importJSON(args.state);
      return { ok: true };
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}

/* One JSON-RPC message in, one response (or null for notifications) out —
   transport-free, so stdio and POST /api/mcp (Feature #99) cannot drift.
   HTTP note: requests are stateless, so the actor set by `initialize` lasts
   one request; HTTP clients name themselves per call with x-weave-actor. */
export function handleMcpMessage(weave, msg, { version = VERSION } = {}) {
  const { id, method, params } = msg ?? {};
  const reply = (result) => (id !== undefined ? { jsonrpc: '2.0', id, result } : null);
  const fail = (code, message) => (id !== undefined ? { jsonrpc: '2.0', id, error: { code, message } } : null);
  try {
    switch (method) {
      case 'initialize':
        // The MCP client names itself in the handshake; mutations carry it.
        weave.actor = 'mcp:' + (params?.clientInfo?.name ?? 'client');
        return reply({
          protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'weave', version },
        });
      case 'notifications/initialized':
      case 'initialized':
        return null; // notification, no response
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        try {
          const result = dispatchTool(weave, params.name, params.arguments ?? {});
          return reply(textResult(result));
        } catch (err) {
          return reply({ content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
        }
      }
      default:
        return fail(-32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return fail(-32603, err.message);
  }
}

export function startMcpServer(weave, { input = process.stdin, output = process.stdout } = {}) {
  let buffer = '';

  const send = (msg) => output.write(JSON.stringify(msg) + '\n');

  const handle = (msg) => {
    const response = handleMcpMessage(weave, msg);
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
