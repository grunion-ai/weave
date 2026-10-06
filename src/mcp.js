import { readFileSync } from 'node:fs';
import { vocabularyView } from './vocabulary.js';
import { guided } from './field-hints.js';
import { Weave, inviteUrl } from './engine.js';
const PROTOCOL_VERSION = '2024-11-05';
let VERSION = 'dev';
try {
  VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
} catch {}

function textResult(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }] };
}

export const COMPACT_TOOLS = new Set([
  'weave_create_entity', 'weave_update_entity', 'weave_delete_entity', 'weave_restore_entity',
  'weave_set_state', 'weave_link', 'weave_unlink',
  'weave_create_space', 'weave_update_space', 'weave_restore_space',
  'weave_create_table', 'weave_update_table', 'weave_move_table', 'weave_duplicate_table', 'weave_restore_table',
  'weave_add_field', 'weave_update_field', 'weave_add_relation',
]);
const BRIEF_KEYS = ['id', 'publicId', 'name', 'type', 'config', 'deletedAt', 'purged', 'next', 'hints'];
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
        fields: { type: 'array', items: { type: 'string' }, description: 'Keep the entity shape but only these fields (a system column name works too; Activity brings the history). Comments, activity and files are left out. Not with select.' },
        relations: { type: 'string', enum: ['full', 'chip'], description: 'chip: a relation value is { id, publicId, name } and each related row\'s summary is sent once, in chips (keyed by id). Default full: every row embeds its related rows\' summaries.' },
        includeDeleted: { type: 'boolean', description: 'Also return soft-deleted (trashed) entities' },
        trashCount: { type: 'boolean', description: 'Also return trashCount: how many of the table\'s rows are in the trash' },
        countAll: { type: 'boolean', description: 'Also return all: the table\'s undeleted rows before where and search' },
        search: { type: 'string', description: 'Keep only the rows the weave_search matcher finds in this table: name, publicId (#143), text fields, documents, comments. Composes with where and sort; total counts the matches.' },
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
    name: 'weave_stats',
    description: 'Summarise every column of a table in one read: numbers get filled/empty, sum, avg, median, min, max, p25, p75, range, stdev and a 10-bin histogram (raw and dressed in the column\'s costume); selects, multiselects, workflows, checkboxes and relations get a ranked distribution; dates get earliest, latest, the span in days and counts by month; text gets the distinct count. `rollups` lists the space rollups pointed at the table with their live values. `by` groups the numeric columns on one field (a multiselect row counts in every chip it wears); `where` narrows the rows with the same clauses as weave_query; `field` narrows the answer to one column and the rollups over it (the row count rides with the name column). Nothing is stored — to keep a figure on the record, add a rollup on the Workspace/Spaces row instead (weave_add_field with config.via).',
    inputSchema: { type: 'object', properties: { table: { type: 'string' }, by: { type: 'string' }, where: {}, field: { type: 'string' } }, required: ['table'] },
  },
  {
    name: 'weave_undo',
    description: 'Revert the last entity mutation(s): field/doc/state/relation edits, creates, soft deletes, comments, file attachments. Schema changes and hard deletes are not undoable. Pass list:true to preview the stack without reverting.',
    inputSchema: { type: 'object', properties: { steps: { type: 'number' }, list: { type: 'boolean' } } },
  },
  {
    name: 'weave_bulk',
    description: 'One write for a whole selection. op "set" writes values across every id; "link" links every id to targets through field; "move" re-creates each id in table by field name (same name, same type — unmatched fields, files and comments stay behind and are named in moved[].skipped) and trashes the original; "rollup" creates one parent (name/values) in field\'s target table (or table) and links every id to it. Each row is its own attempt: done names what landed, failed names what did not and why. Each row keeps its own undo step.',
    inputSchema: { type: 'object', properties: {
      ids: { type: 'array', items: { type: 'string' } },
      op: { type: 'string', enum: ['set', 'link', 'move', 'rollup'] },
      values: { type: 'object', description: 'set: the values to write; rollup: the parent\'s values' },
      field: { type: 'string', description: 'link / rollup: the relation field' },
      targets: { type: 'array', items: { type: 'string' }, description: 'link: the rows to link to' },
      table: { type: 'string', description: 'move: the destination; rollup: overrides the relation\'s target table' },
      name: { type: 'string', description: 'rollup: the new parent\'s name' },
    }, required: ['ids', 'op'] },
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
    name: 'weave_doc_revisions',
    description: 'A document\'s version history (Feature #225). Without seq: the revisions newest first as {seq, at, actor, len} — one per editing session (writes by one actor inside ten minutes fold into one). With seq: that revision with its text. field picks a document field; omit for the default.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, field: { type: 'string', description: 'Document field name (optional)' }, seq: { type: 'number', description: 'A revision seq from the list — returns its text' }, limit: { type: 'number', description: 'How many to list (default 50)' } }, required: ['entity'] },
  },
  {
    name: 'weave_doc_restore',
    description: 'Write a past revision back as the document\'s current text (Feature #225). An ordinary write: activity, undo and automations all see it, and the history keeps both the restored text and what it replaced.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, seq: { type: 'number' }, field: { type: 'string', description: 'Document field name (optional)' } }, required: ['entity', 'seq'] },
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
    description: 'Universal search across the workspace, spaces, tables, saved views, and entities (names, publicIds, text fields, documents, comments). Every result carries a stable permalink url. limit bounds entity rows only; every matching workspace, space, table and view is always returned.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'weave_create_space',
    description: 'Create a space (top-level grouping of tables).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' }, template: { type: 'boolean' } }, required: ['name'] },
  },
  {
    name: 'weave_create_table',
    description: 'Create a table in a space (a Name text field and a Description document are added automatically). icon is `lucide:<name>` from weave_vocabulary.',
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' } },
      required: ['space', 'name'],
    },
  },
  {
    name: 'weave_add_field',
    description: 'Add a field. Every type, its config keys and what it looks like in the grid: weave_vocabulary. Types: text, number, rating, date, daterange, checkbox, toggle, url, email, select, multiselect, workflow, document, attachments, field, key, lookup, rollup, formula (relation fields use weave_add_relation). config: {options:[...]} for selects; {max, icon} for rating (max 1-100, default 5; the value is a whole number 0..max); {on, off} for toggle (the value stays true/false); {states:[{name,category,default}]} for workflow (categories: not-started, in-progress, done, canceled); {relationField, targetField} for lookup; {relationField, targetField, aggregate} for rollup (count, sum, avg, min, max, join, median, stdev, distinct, filled, empty, range) — or, on the Workspace/Spaces registry row only, {via: <table>, targetField, aggregate, where?} for a rollup over a WHOLE table, the figure under a grid column (where takes weave_query clauses); {expression} for formula. Any of text, number, rating, date, daterange, checkbox, toggle, url, email, select, multiselect may also carry {default}: the value a new entity starts with when the create does not name the field (a workflow uses its default state instead). Any field may carry {width} in px (60 minimum) to set its column, and {description}: plain text saying what the value represents and how it is written — read it back from weave_schema before filling a row. Replies list open settings in next[] (number: format currency, unit, display) and slips in hints[].',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' } },
      required: ['db', 'name', 'type'],
    },
  },
  {
    name: 'weave_check_formula',
    description: 'Validate a formula expression against a table BEFORE saving it — syntax, function names, field names — and, when the table has rows, preview the computed value on one real entity. The authoring loop: check → fix until ok:true → weave_add_field/weave_update_field with {expression} → read the cell back. Returns {ok, error?, preview?, previewEntity?, type?} — type is what the preview computed to (number, text, boolean, list, null, error); never throws on a bad expression. Pass excludeField (field name or id) when editing an existing formula field so it cannot reference itself; pass entity (id) to preview a specific row. scan: true evaluates over up to 200 rows and adds scan: {rows, capped, nulls, errors, sampleByOutcome: {ok, null, error}} — a formula valid on row 1 and null on a third of the table is the bug one preview cannot show; assert nulls and errors are what you expect before saving.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, expression: { type: 'string' }, entity: { type: 'string' }, excludeField: { type: 'string' }, scan: { type: 'boolean' } },
      required: ['db', 'expression'],
    },
  },
  {
    name: 'weave_add_relation',
    description: 'Create a relation field. One targetDb: bidirectional — the inverse field is created automatically on the target table. targetDbs (a list of 2+ tables, which may include Workspace/Spaces and Workspace/Tables): a target-set (polymorphic) relation — one field whose values may point at rows of any member table, one-way, no inverse; lookups/rollups need a single target. Cardinality: many-to-one (this side holds one), one-to-many, many-to-many, one-to-one.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, name: { type: 'string' }, targetDb: { type: 'string' }, targetDbs: { type: 'array', items: { type: 'string' } }, cardinality: { type: 'string' }, inverseName: { type: 'string' } },
      required: ['db', 'name'],
    },
  },
  {
    name: 'weave_create_automation',
    description: 'Create an automation rule as a Workspace/Workflows row; its Script holds the rule as JSON. enabled (default true) is the row\'s On: pass false to create it Off. trigger: {type: entity-created | field-updated | state-changed, field?, toState?}. actions: [{type: set-field, field, value} | {type: append-doc, text} | {type: add-comment, text} | {type: webhook, url}] — text supports {{FieldName}}, {{PublicId}}, {{Today}} (the workspace date format; {{Today:iso}} for 2026-10-06) templates.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, name: { type: 'string' }, trigger: { type: 'object' }, actions: { type: 'array' }, enabled: { type: 'boolean' } },
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
  {
    name: 'weave_vocabulary',
    description: 'Every closed set a configuration value comes from, and what each choice looks like on screen: field types with how they render and which config keys they take, the option color palette, the icon names, number/date formats, document kinds, relation cardinalities, workflow state categories, rollup aggregates, system columns, view kinds, the column-width rules, and formulaFunctions — every formula function with its signature, group, doc and an example. Read this before configuring a table. Name every section you need in one call (sections:["icons","optionColors"]); query searches the icon names by name, category and synonym ("wallet, bank" searches both).',
    inputSchema: { type: 'object', properties: { sections: { type: 'array', items: { type: 'string' } }, section: { type: 'string' }, query: { type: 'string' } } },
  },
  {
    name: 'weave_update_space',
    description: 'Rename a space or change its description or icon, or mark it a template (template: true; weave_template_use copies a template\'s schema into another workspace). An icon is `lucide:<name>` from weave_vocabulary or a mark character; anything else is refused.',
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' }, template: { type: 'boolean' } },
      required: ['space'],
    },
  },
  {
    name: 'weave_template_list',
    description: 'The template spaces of this workspace: the live spaces marked template: true (weave_update_space marks one, or the Template box on its Workspace/Spaces row). Each is a space record: id, name, description, icon.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'weave_template_use',
    description: 'Copy a template space\'s schema, never its rows, into another workspace of this hub: its tables, fields with their config, option colours and icons, workflow states, views, field order, hidden fields, filters, sort, the term, the icons and the space rollups over its tables. space: the template space (name or id). workspace: the target, a name as the hub lists it. name: the new space\'s name, the template\'s by default; a name the target already holds is refused. A relation to a table outside the space is left out and named in `skipped`, with every lookup, rollup and formula that reads through it. Needs an architect on the target. Answers {space, workspace, url, plan, skipped}. Over HTTP only: a stdio server holds one workspace, so there use the CLI, weave template use <space> --into <other.db>.',
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string' }, workspace: { type: 'string' }, name: { type: 'string' } },
      required: ['space', 'workspace'],
    },
  },
  {
    name: 'weave_delete_space',
    description: 'Move a space to the trash (recoverable — its tables and rows go dark with it). Pass hard: true to purge it and every table in it for good.',
    inputSchema: { type: 'object', properties: { space: { type: 'string' }, hard: { type: 'boolean' } }, required: ['space'] },
  },
  {
    name: 'weave_restore_space',
    description: 'Restore a trashed space; its tables and rows come back with it.',
    inputSchema: { type: 'object', properties: { space: { type: 'string' } }, required: ['space'] },
  },
  {
    name: 'weave_update_table',
    description: 'Change a table: name, description, icon (`lucide:<name>` from weave_vocabulary or a mark character; anything else is refused), noun (what one row is called — stored as the Name field\'s `term`; "invoice" makes the create action read "New invoice" and the puck count "3 invoices"), systemFields (Created At, Modified At, Created By, Modified By, Activity), fieldOrder (the schema order — every field exactly once; the grid\'s columns are per view, see weave_table_view), hideRollups (the Σ row of space rollups pinned under the field headers: off unless a table asks for it, so pass `false` to show it and `true` to put it away again).',
    inputSchema: {
      type: 'object',
      properties: {
        db: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
        icon: { type: 'string' }, noun: { type: 'string' },
        systemFields: { type: 'array', items: { type: 'string' } },
        fieldOrder: { type: 'array', items: { type: 'string' } },
        hideRollups: { type: 'boolean' },
      },
      required: ['db'],
    },
  },
  {
    name: 'weave_table_view',
    description: 'A table\'s views (the View dropdown over its grid), in order: the first opens with the table; a new table\'s first view is named Standard, and new ones View 2, View 3. view "Task" lists them; "Task/Open" reads one; "Task/blank" is the raw table, read-only. Any other key writes, creating the view if new (from: a view to copy, else all fields). fields: visible columns in order, unlisted hidden. show/hide: names. move: {field, before|after}. filters: {Field: [states|options]}. sort: [{field, dir}]. position: its place, 0 = default. widths: {field: px}, null clears. frozen: leading fields frozen beside #. density: compact, comfortable (default) or spacious. deleted: show trashed rows. rollups: Σ row on/off, null = table default. name renames; delete: true. Returns the view.',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string' }, fields: { type: 'array' }, show: { type: 'array' }, hide: { type: 'array' },
        move: { type: 'object' }, filters: { type: 'object' }, sort: { type: 'array' },
        position: { type: 'number' }, name: { type: 'string' }, from: { type: 'string' }, delete: { type: 'boolean' },
        widths: { type: 'object' }, frozen: { type: 'number' }, density: { type: 'string', enum: ['compact', 'comfortable', 'spacious'] }, deleted: { type: 'boolean' }, rollups: { type: ['boolean', 'null'] },
      },
      required: ['view'],
    },
  },
  {
    name: 'weave_move_table',
    description: 'Move a table into another space. Only its home changes — every row, field and relation stays exactly as it was. Refuses when the destination already holds (or holds in its trash) a table of the same name.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' }, space: { type: 'string' } }, required: ['db', 'space'] },
  },
  {
    name: 'weave_duplicate_table',
    description: 'Duplicate a table\'s schema into a sibling named "<name> Copy" ("Copy 2", … until free) in the same space: every field with its full config, relations rebuilt as real paired fields (an external target grows a fresh inverse; a self-relation retargets into the copy), lookups and rollups re-pointed at the copy\'s own relation fields. Rows are not copied — the copy starts empty.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' } }, required: ['db'] },
  },
  {
    name: 'weave_delete_table',
    description: 'Move a table to the trash (recoverable — its rows go dark with it). Pass hard: true to purge table and rows for good.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' }, hard: { type: 'boolean' } }, required: ['db'] },
  },
  {
    name: 'weave_restore_table',
    description: 'Restore a table out of the trash: the table, its rows and their relations come back exactly as they were.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' } }, required: ['db'] },
  },
  {
    name: 'weave_update_field',
    description: 'Change a field: rename it, retype it (values are migrated; text to relation takes config:{targetDb, createMissing?} and links rows by name), or edit its config. config keys ride their own lanes — width (px, 60 minimum, null resets to auto), description (plain text: what the value represents and how it is written; null clears; on a view field it is the description size instead), default (null clears), options/states (a full replacement), on/off (a toggle\'s state labels, one at a time), max/icon (a rating\'s scale and icon, one at a time), expression, and the costume keys for number, date, document and attachments. See weave_vocabulary for every legal value.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, field: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' }, config: { type: 'object' } },
      required: ['db', 'field'],
    },
  },
  {
    name: 'weave_rollback_field',
    description: 'Put a field back the way one of its field-config-updated (or undo) Activity entries found it. Every change weave_update_field makes to a field\'s name or config (the column width aside) is an Activity entry on its table, with the definition before and after; list them with weave_activity {entity: <table id>}. The roll back is refused when the field changed after the entry. A type change rolls back with its values: rows unchanged since are restored, a row edited since keeps its edit (converted back) and a row made since is converted; only the newest type change of a field keeps its values. It writes its own undo entry, which can itself be rolled back. Returns {field, activity}, plus {restored, left, converted} for a type change.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, field: { type: 'string' }, activity: { type: 'string', description: 'The entry id, <tableId>:f<n>' } },
      required: ['activity'],
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
    name: 'weave_build',
    description: 'Build in ONE call: spaces, tables, fields, relations and rows. A field is {name, type, plus that type\'s weave_add_field config keys, flat}; a relation is {name, type:"relation", to:<table>, cardinality?}; lookups, rollups and formulas may read relations made in the same build. Rows are values by field name; a relation value is the target row\'s Name. Re-sending the whole spec is safe: existing spaces, tables and same-typed fields are reused; rows append, so pass skipExistingRows:true to skip rows whose Name is already there. A refused icon or colour is dropped, not fatal. Returns one line: {ok, created, existing, ignored (keys dropped, with reason), errors:[{path, error}], computed:{field: its first values}}. Example spec:\n'
      + '{"workspace":"personal-finance","spaces":[{"name":"Budget","icon":"lucide:wallet","tables":[{"name":"Account","icon":"lucide:credit-card","fields":[{"name":"Kind","type":"select","options":[{"name":"Credit card"},{"name":"Checking"}]}],"rows":[{"Name":"Amex Gold","Kind":"Credit card"}]},{"name":"Transaction","fields":[{"name":"Amount","type":"number","format":"currency","currency":"USD"},{"name":"Date","type":"date"},{"name":"Account","type":"relation","to":"Account","cardinality":"many-to-one"}],"rows":[{"Name":"Whole Foods","Amount":142.18,"Date":"2026-08-03","Account":"Amex Gold"}]}]}]}\n'
      + 'dryRun:true first is cheap: it checks the whole spec, rows included, returns every error with its path, and writes nothing. Any error means nothing is written.',
    inputSchema: {
      type: 'object',
      properties: { spec: { type: 'object', description: '{workspace?, description?, spaces:[{name, icon?, description?, tables:[{name, icon?, description?, fields?, rows?, fieldOrder? (leading names), hidden? (names), sort? ("Amount desc")}]}]}' }, dryRun: { type: 'boolean' }, skipExistingRows: { type: 'boolean', description: 'Skip a row whose Name the table already holds (for a re-run)' } },
      required: ['spec'],
    },
  },
  {
    name: 'weave_views',
    description: 'Saved views: a named list of blocks, each a table plus an optional where and a view kind (table, the one kind weave draws). action: list | get | create | delete | share | unshare. Sharing mints a capability token; the /view/<token> URL renders that view read-only, even when the workspace requires auth.',
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
    description: 'Automations already on a table, read from their Workspace/Workflows rows: action list | describe (rules in prose) | update (patch: name, enabled = the row\'s On) | delete (to the trash). Create one with weave_create_automation.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, db: { type: 'string' }, automation: { type: 'string' }, patch: { type: 'object' } },
      required: ['action'],
    },
  },
  {
    name: 'weave_activity',
    description: 'The activity feed: every change weave recorded, newest first. Filter by entity, table, kinds, or since (ISO timestamp); pass id to read one event in full. Each entity keeps its newest 500 entries; `dropped` counts the older ones in scope that are no longer kept.',
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
    description: 'The workspace record itself. action: get | update (name: any text, kept as the title; its slug, lowercase letters, digits, - and _, is the /w/<slug>/ address, description, linkPreview) | logo (contentBase64 + name + mime) | clear-logo.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, linkPreview: { type: 'boolean' }, mime: { type: 'string' }, contentBase64: { type: 'string' } },
    },
  },
  {
    name: 'weave_accounts',
    description: 'Agent and human accounts. action: list | create (name, role: observer|editor|architect, default editor — observer reads and comments, editor writes rows, architect also changes structure and accounts; the old names reader|writer|admin are deprecated aliases; the token is returned once) | delete | require-auth (on: true|false, which turns token auth on for the whole workspace) | sessions (account — the browser sessions it holds) | revoke-session (account, session id or all: true) | link-identity (account, issuer — mints a one-time invite link, good for 7 days; the person who opens it and signs in at the OpenID Connect provider is linked by subject, and weave stores no email. Signing in at the provider provisions nobody, so an account opens to a provider identity only through this. issuer defaults to WEAVE_OIDC_ISSUER; the url is rooted at WEAVE_ORIGIN) | unlink-identity (account, subject, issuer — the subject account list shows) | invite (email, role default editor, issuer — invites a new person: answers a one-time sign-in link, good for 7 days, that makes the account at that role when they sign in; weave sends no email, so hand the link over) | invites (the pending ones: email, role, invitedBy, createdAt) | revoke-invite (invite: the id invites shows).',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, account: { type: 'string' }, on: { type: 'boolean' }, session: { type: 'string' }, all: { type: 'boolean' }, subject: { type: 'string' }, issuer: { type: 'string' }, email: { type: 'string' }, invite: { type: 'string' } },
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
    description: 'The meta-model registries (Workspace/Workspaces, Spaces, Tables, Fields) whose rows ARE the schema. The registry lives once, at the weave root — the default workspace — and every row carries a Workspace relation naming the workspace it describes; a member workspace reports and rebuilds its own slice. action report (drift between the registry and the structures it mirrors) | rebuild.',
    inputSchema: { type: 'object', properties: { action: { type: 'string' } } },
  },
  {
    name: 'weave_relation_map',
    description: 'The workspace relation map as a mermaid diagram: every table, relation and automation.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'weave_export_json',
    description: 'The whole workspace as JSON — the human-readable interchange format, and the backup to take before a destructive apply. Attachment bytes are left out unless blobs is true; `weave export` always carries them.',
    inputSchema: { type: 'object', properties: { blobs: { type: 'boolean' } } },
  },
  {
    name: 'weave_import_json',
    description: 'Replace the workspace with a JSON export. Destructive: everything not in the document is gone. The result names every file that arrived without its bytes (missing).',
    inputSchema: { type: 'object', properties: { state: { type: 'object' } }, required: ['state'] },
  },
];
for (const t of TOOLS) if (COMPACT_TOOLS.has(t.name)) t.inputSchema.properties.verbose = VERBOSE;

export const CORE_TOOLS = new Set([
  'weave_schema', 'weave_query', 'weave_get_entity', 'weave_create_entity', 'weave_update_entity',
  'weave_create_space', 'weave_create_table', 'weave_add_field', 'weave_update_field', 'weave_add_relation',
  'weave_import_csv', 'weave_vocabulary', 'weave_workspace', 'weave_search', 'weave_build', 'weave_call',
]);
export const SUMMARY = {
  weave_build: 'spaces, tables, fields, relations and rows in one call (dryRun checks)',
  weave_schema: 'every space, table and field, with types and options',
  weave_query: 'rows of one table, filtered (where), sorted, paged',
  weave_get_entity: 'one row in full: values, document, comments, activity',
  weave_search: 'find rows, tables and spaces by text; each hit has a permalink',
  weave_create_entity: 'create one row',
  weave_update_entity: 'change one row\'s values',
  weave_import_csv: 'many rows into one table from CSV text',
  weave_create_space: 'create a space',
  weave_create_table: 'create a table in a space',
  weave_add_field: 'add a field to a table',
  weave_update_field: 'rename, retype or reconfigure a field (options are a full replacement)',
  weave_add_relation: 'add a relation and its inverse between two tables',
  weave_workspace: 'read or rename the workspace, set its description or logo',
  weave_vocabulary: 'allowed values; several sections and icon queries in one call',
  weave_call: 'run any other tool by name; help describes one',
  weave_delete_entity: 'trash a row (hard: true purges)',
  weave_restore_entity: 'bring a row back from the trash',
  weave_trash: 'list trashed rows',
  weave_stats: 'summarise every column of a table',
  weave_undo: 'revert the last row edits (list: true previews)',
  weave_bulk: 'set, link, move or roll up many rows in one write',
  weave_set_state: 'move a row to a workflow state',
  weave_link: 'link rows through a relation field',
  weave_unlink: 'unlink rows from a relation field',
  weave_get_doc: 'read a row\'s document as markdown',
  weave_set_doc: 'replace or append a row\'s document',
  weave_doc_revisions: 'a document\'s version history',
  weave_doc_restore: 'write a past revision back',
  weave_add_comment: 'comment on a row',
  weave_delete_comment: 'delete a comment',
  weave_check_formula: 'validate and preview a formula before saving it',
  weave_create_automation: 'create an automation rule',
  weave_automations: 'list, describe, update or delete automations',
  weave_export_csv: 'a table as CSV',
  weave_attach_file: 'attach a file to a row (base64)',
  weave_files: 'read or delete an attached file',
  weave_update_space: 'rename a space; its description, icon, template mark',
  weave_template_list: 'the template spaces here',
  weave_template_use: 'copy a template space into another workspace',
  weave_delete_space: 'trash a space (hard: true purges)',
  weave_restore_space: 'restore a trashed space',
  weave_update_table: 'rename, icon, noun, field order, system fields, Σ row',
  weave_table_view: 'read and write a table\'s views',
  weave_move_table: 'move a table to another space',
  weave_duplicate_table: 'copy a table\'s schema, no rows',
  weave_delete_table: 'trash a table (hard: true purges)',
  weave_restore_table: 'restore a trashed table',
  weave_rollback_field: 'put a field back to an earlier config',
  weave_delete_field: 'delete a field and its values',
  weave_apply_schema: 'apply a whole schema document (dryRun plans)',
  weave_views: 'saved multi-table pages and share links',
  weave_activity: 'the change feed',
  weave_audit: 'the schema and account audit log',
  weave_accounts: 'accounts, tokens, sessions, require-auth',
  weave_keys: 'the credential keystore',
  weave_registry: 'registry drift report and rebuild',
  weave_relation_map: 'the relation map as mermaid',
  weave_export_json: 'the whole workspace as JSON',
  weave_import_json: 'replace the workspace from a JSON export',
};
TOOLS.push({
  name: 'weave_call',
  description: [
    'Call any weave tool by name: {name, args}, where args is that tool\'s input. {name: "help", args: {tool}} returns the tool\'s description and input schema; read it before the first call. The tools not listed on their own:',
    ...TOOLS.filter((t) => !CORE_TOOLS.has(t.name)).map((t) => `${t.name}: ${SUMMARY[t.name] ?? t.description.split(/[.:]\s/)[0].slice(0, 60)}`),
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'A tool name, or "help"' }, args: { type: 'object', description: 'That tool\'s arguments' } },
    required: ['name'],
  },
});

export function toolProfile(env = globalThis.process?.env ?? {}) {
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
      const t = TOOLS.find((x) => x.name === inner.tool);
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

export function mayAdminister(on, role) {
  return Weave.roleName(role) === 'architect' || !on.listAccounts().length;
}
const ADMIN_TOOLS = { weave_accounts: 'workspace', weave_import_json: 'workspace', weave_keys: 'root' };

const isMap = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
function checkRowArgs(name, args, required) {
  const props = TOOLS.find((t) => t.name === name).inputSchema.properties;
  const unknown = Object.keys(args).filter((k) => !Object.hasOwn(props, k) && k !== 'verbose');
  const extra = unknown.length ? `; unknown ${unknown.map((k) => `'${k}'`).join(', ')}` : '';
  if (required && !isMap(args.values)) throw new Error(`values is required: a map of field name to value, e.g. {"Name": "…"}${extra}`);
  if (!required && args.values != null && !isMap(args.values)) throw new Error(`values is a map of field name to value, e.g. {"Name": "…"}${extra}`);
  if (unknown.length) throw new Error(`${name} takes ${Object.keys(props).join(', ')}${extra}; field values go in values`);
}

export function dispatchTool(weave, name, args = {}, { caller = null } = {}) {
  if (caller && ADMIN_TOOLS[name]) {
    const atRoot = ADMIN_TOOLS[name] === 'root';
    if (!mayAdminister(atRoot ? caller.root ?? weave : weave, atRoot ? caller.rootRole : caller.role)) {
      throw new Error(`${name} needs an architect token${atRoot ? ' on the hub root' : ''}`);
    }
  }
  weave.maybeRefresh?.();
  switch (name) {
    case 'weave_schema':
      return weave.describeSchema();
    case 'weave_query':
      return weave.query(args.db, {
        where: args.where ?? [], sort: args.sort ?? [], limit: args.limit ?? null,
        offset: args.offset ?? 0, select: args.select ?? null, fields: args.fields ?? null, relations: args.relations ?? 'full',
        includeDeleted: Boolean(args.includeDeleted),
        trashCount: Boolean(args.trashCount), countAll: Boolean(args.countAll), search: args.search ?? '',
      });
    case 'weave_get_entity':
      return weave.readEntity(args.entity);
    case 'weave_create_entity': {
      checkRowArgs(name, args, false);
      const e = weave.createEntity(args.db, { name: args.name, values: args.values, doc: args.doc, docs: args.docs });
      return weave.readEntity(e.id);
    }
    case 'weave_update_entity':
      checkRowArgs(name, args, true);
      weave.updateEntity(args.entity, args.values);
      return weave.readEntity(args.entity);
    case 'weave_delete_entity':
      return weave.deleteEntity(args.entity, { hard: Boolean(args.hard) });
    case 'weave_restore_entity':
      return weave.restoreEntity(args.entity);
    case 'weave_trash':
      return { items: weave.listTrash(args.table ?? null) };
    case 'weave_stats':
      return weave.tableStats(args.table, { by: args.by ?? null, where: args.where ?? null, field: args.field ?? null });
    case 'weave_undo':
      if (args.list) return { history: weave.listUndo({ limit: Number(args.limit ?? 20) }) };
      return weave.undo({ steps: Math.max(1, Number(args.steps ?? 1)) });
    case 'weave_bulk': {
      const { ids, op, ...params } = args;
      return weave.bulk(ids, op, params);
    }
    case 'weave_set_state':
      weave.setState(args.entity, args.field, args.state);
      return weave.readEntity(args.entity);
    case 'weave_link':
      weave.link(args.entity, args.field, args.targets);
      return weave.readEntity(args.entity);
    case 'weave_unlink':
      weave.unlink(args.entity, args.field, args.targets);
      return weave.readEntity(args.entity);
    case 'weave_get_doc':
      return weave.getDoc(args.entity, args.field ?? null);
    case 'weave_set_doc':
      if (args.mode === 'append') weave.appendDoc(args.entity, args.markdown, args.field ?? null);
      else weave.setDoc(args.entity, args.markdown, args.field ?? null);
      return { ok: true, length: weave.getDoc(args.entity, args.field ?? null).length };
    case 'weave_doc_revisions':
      if (args.seq != null) return weave.getDocRevision(args.entity, args.field ?? null, args.seq);
      return weave.listDocRevisions(args.entity, args.field ?? null, { limit: args.limit ?? 50 });
    case 'weave_doc_restore':
      return weave.restoreDocRevision(args.entity, args.field ?? null, args.seq);
    case 'weave_add_comment':
      return weave.addComment(args.entity, { author: args.author ?? 'agent', text: args.text });
    case 'weave_delete_comment':
      return weave.deleteComment(args.entity, args.comment);
    case 'weave_search':
      return weave.universalSearch(args.query, { limit: args.limit ?? 25 });
    case 'weave_create_space':
      return guided(weave, 'space', weave.createSpace(pick(args, ['name', 'description', 'icon', 'template'])));
    case 'weave_create_table':
      return guided(weave, 'table', weave.createTable(pick(args, ['space', 'name', 'description', 'icon'])));
    case 'weave_add_field':
      return guided(weave, 'field', weave.addField(args.db, { name: args.name, type: args.type, config: args.config ?? {} }), args.config);
    case 'weave_check_formula':
      return weave.checkFormula(args.db, args.expression, { entity: args.entity ?? null, excludeField: args.excludeField ?? null, scan: Boolean(args.scan) });
    case 'weave_add_relation':
      return weave.addRelation(args.db, { name: args.name, targetDb: args.targetDb, targetDbs: args.targetDbs, cardinality: args.cardinality ?? 'many-to-one', inverseName: args.inverseName });
    case 'weave_create_automation':
      return weave.createAutomation(args.db, { name: args.name, trigger: args.trigger, actions: args.actions, enabled: args.enabled });
    case 'weave_export_csv':
      return weave.exportCSV(args.db);
    case 'weave_import_csv':
      return weave.importCSV(args.db, args.csv);
    case 'weave_attach_file':
      return weave.attachFile(args.entity, { name: args.name, mime: args.mime, bytes: args.contentBase64 });
    case 'weave_vocabulary':
      return vocabularyView(args.sections ?? args.section, args.query);
    case 'weave_update_space':
      return weave.updateSpace(args.space, pick(args, ['name', 'description', 'icon', 'template']));
    case 'weave_template_list':
      return { templates: weave.listTemplates() };
    case 'weave_template_use':
      if (!caller?.useTemplate) {
        throw new Error('weave_template_use copies into another workspace of a hub, and this stdio server holds one workspace. Call it over the HTTP door (POST /api/mcp, or /mcp on the hosted instance), or run weave template use <space> --into <other.db> on the CLI.');
      }
      return caller.useTemplate({ space: args.space, workspace: args.workspace, name: args.name });
    case 'weave_delete_space':
      weave.deleteSpace(args.space, { hard: Boolean(args.hard) });
      return { space: args.space, deleted: true, hard: Boolean(args.hard) };
    case 'weave_restore_space':
      return weave.restoreSpace(args.space);
    case 'weave_update_table':
      return weave.updateTable(args.db, pick(args, ['name', 'description', 'icon', 'noun', 'hiddenFields', 'systemFields', 'fieldOrder', 'hideRollups']));
    case 'weave_table_view': {
      const { view, ...patch } = args;
      return weave.tableView(view, Object.keys(patch).length ? patch : null);
    }
    case 'weave_move_table':
      return weave.moveTable(args.db, args.space);
    case 'weave_duplicate_table':
      return weave.duplicateTable(args.db);
    case 'weave_delete_table':
      weave.deleteTable(args.db, { hard: Boolean(args.hard) });
      return { table: args.db, deleted: true, hard: Boolean(args.hard) };
    case 'weave_restore_table':
      return weave.restoreTable(args.db);
    case 'weave_update_field':
      return guided(weave, 'field', weave.updateField(args.db, args.field, pick(args, ['name', 'type', 'config'])), args.type == null ? args.config : {});
    case 'weave_rollback_field':
      return weave.rollbackFieldConfig(args.activity, { table: args.db ?? null, field: args.field ?? null });
    case 'weave_delete_field':
      return weave.deleteField(args.db, args.field);
    case 'weave_apply_schema':
      return { plan: weave.applySchema(args.document, { dryRun: Boolean(args.dryRun), allowDestructive: Boolean(args.allowDestructive) }) };
    case 'weave_build': {
      const { spec, dryRun, skipExistingRows, ...bare } = args;
      return JSON.stringify(weave.build(spec ?? bare, { dryRun: Boolean(dryRun), skipExistingRows: Boolean(skipExistingRows) }));
    }
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
        entityId: args.entity ?? null,
        tableRef: args.table ?? null, kinds: args.kinds ?? null, since: args.since ?? null,
        limit: args.limit ?? null, offset: args.offset ?? 0,
      });
    case 'weave_audit':
      return { events: weave.listAudit({ limit: args.limit ?? null, since: args.since ?? null }) };
    case 'weave_workspace':
      switch (args.action ?? 'get') {
        case 'get': return weave.getWorkspace();
        case 'update': return (caller?.updateWorkspace ?? ((p) => weave.updateWorkspace(p)))(pick(args, ['name', 'description', 'linkPreview']));
        case 'logo': return weave.setWorkspaceLogo({ name: args.name ?? 'logo.png', mime: args.mime ?? 'image/png', bytes: args.contentBase64 });
        case 'clear-logo': weave.deleteWorkspaceLogo(); return { logo: false };
        default: throw new Error(`Unknown workspace action '${args.action}' (get, update, logo, clear-logo)`);
      }
    case 'weave_accounts':
      switch (args.action) {
        case 'list': return { accounts: weave.listAccounts() };
        case 'create': return weave.createAccount({ name: args.name, role: args.role ?? 'editor' });
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
        default: throw new Error(`Unknown accounts action '${args.action}' (list, create, delete, require-auth, sessions, revoke-session, link-identity, unlink-identity, invite, invites, revoke-invite)`);
      }
    case 'weave_keys':
      switch (args.action) {
        case 'list': return { keys: weave.listKeys() };
        case 'set': return weave.setKey(args.name, args.value);
        case 'share': return weave.grantKey(args.name, args.account);
        case 'unshare': return weave.revokeKey(args.name, args.account);
        case 'delete': return weave.deleteKey(args.name);
        case 'reveal': throw new Error('Revealing a secret is not an agent action — use `weave key reveal` or the app.');
        default: throw new Error(`Unknown keys action '${args.action}' (list, set, share, unshare, delete)`);
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
    case 'weave_registry':
      if ((args.action ?? 'report') === 'rebuild') return weave.rebuildRegistry();
      return weave.registryReport();
    case 'weave_relation_map':
      return { mermaid: weave.relationMapMmd() };
    case 'weave_export_json':
      return weave.exportJSON({ blobs: args.blobs === true });
    case 'weave_import_json':
      return { ok: true, ...weave.importJSON(args.state) };
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}

let PRIMER;
export function primer() {
  if (PRIMER === undefined) {
    try { PRIMER = readFileSync(new URL('./mcp-primer.md', import.meta.url), 'utf8'); } catch { PRIMER = null; }
  }
  return PRIMER;
}

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
          ...(primer() ? { instructions: primer() } : {}),
        });
      case 'notifications/initialized':
      case 'initialized':
        return null;
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: listTools(tools) });
      case 'tools/call': {
        try {
          return reply(textResult(callTool(weave, params.name, params.arguments ?? {}, caller)));
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
