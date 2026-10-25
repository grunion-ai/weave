import { readFileSync } from 'node:fs';
import { vocabularyView } from './vocabulary.js';
import { guided } from './field-hints.js';
import { Weave, inviteUrl } from './engine.js';
import { submitForm, listForms, createForm, updateForm, getFormDefinition } from './forms.js';
const PROTOCOL_VERSION = '2024-11-05';
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
  {
    name: 'weave_ontology',
    description: 'The schema, short; read it before weave_schema (the full JSON). Default outline: one line per table by space, [a|b] options or states, name -> Target (inverse) with * for many, name = lookup, rollup or formula, then the etag. concept: one table in full, field descriptions included. since: an etag; answers only the spaces changed since.',
    inputSchema: {
      type: 'object',
      properties: { depth: { type: 'string', enum: ['outline'] }, concept: { type: 'string', description: 'Table or Space/Table' }, since: { type: 'string' } },
    },
  },
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
        fields: { type: 'array', items: { type: 'string' }, description: 'Keep the entity shape but only these fields (a system column name works too). Comments, activity and files are left out. Not with select.' },
        relations: { type: 'string', enum: ['full', 'chip'], description: 'chip: a relation value is { id, publicId, name } and each related row\'s summary is sent once, in chips (keyed by id). Default full: every row embeds its related rows\' summaries.' },
        includeDeleted: { type: 'boolean', description: 'Also return soft-deleted (trashed) entities' },
        trashCount: { type: 'boolean', description: 'Also return trashCount: how many of the table\'s rows are in the trash' },
        countAll: { type: 'boolean', description: 'Also return all: the table\'s undeleted rows before where and search' },
        search: { type: 'string', description: 'Only the rows weave_search finds here: name, publicId, text fields, documents, comments. Composes with where and sort; total counts them.' },
        view: { type: 'string', description: 'A saved view (id or name): its filters AND where; its sort and search apply unless you pass yours; grouped adds groups and groupTotal.' },
        groupBy: { type: 'string', description: 'Like view, groups only: no filters or search.' },
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
    description: 'Summarise every column of a table in one read: numbers get filled/empty, sum, avg, median, min, max, p25, p75, range, stdev and a 10-bin histogram (raw and dressed in the column\'s costume); selects, multiselects, workflows, checkboxes and relations get a ranked distribution; dates get earliest, latest, the span in days and counts by month; text gets the distinct count. `rollups` lists the space rollups pointed at the table with their live values. `by` groups the numeric columns on one field (with group rollups) (a multiselect row counts in every chip it wears); `where` narrows the rows with the same clauses as weave_query; `field` narrows the answer to one column and the rollups over it (the row count rides with the name column). Nothing is stored; to keep a figure, add a rollup on the System/Spaces row (weave_add_field, config.via).',
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
    description: 'Add a field. Every type, its config keys and what it looks like in the grid: weave_vocabulary. Types: text, number, rating, date, daterange, checkbox, toggle, url, email, select, multiselect, workflow, document, attachments, field, key, lookup, rollup, formula (relation fields use weave_add_relation). config: {options:[...]} for selects; {max, icon} for rating (max 1-100, default 5; the value is a whole number 0..max); {on, off} for toggle (the value stays true/false); {states:[{name,category,default}]} for workflow (categories: not-started, in-progress, done, canceled); {relationField, targetField} for lookup; {relationField, targetField, aggregate} for rollup (count, sum, avg, min, max, join, median, stdev, distinct, filled, empty, range) — or, on the System/Spaces registry row only, {via: <table>, targetField, aggregate, where?} for a rollup over a WHOLE table, the figure under a grid column (where takes weave_query clauses); {expression} for formula. Any of text, number, rating, date, daterange, checkbox, toggle, url, email, select, multiselect may also carry {default}: the value a new entity starts with when the create does not name the field (a workflow uses its default state instead). Any field may carry {width} in px (60 minimum) to set its column, and {description}: plain text saying what the value represents and how it is written — read it back from weave_schema before filling a row. Replies list open settings in next[] (number: format currency, unit, display) and slips in hints[].',
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
    description: 'Create a relation field. One targetDb: bidirectional — the inverse field is created automatically on the target table. targetDbs (a list of 2+ tables, which may include System/Spaces and System/Tables): a target-set (polymorphic) relation — one field whose values may point at rows of any member table, one-way, no inverse; lookups/rollups need a single target. Cardinality: many-to-one (this side holds one), one-to-many, many-to-many, one-to-one.',
    inputSchema: {
      type: 'object',
      properties: { db: { type: 'string' }, name: { type: 'string' }, targetDb: { type: 'string' }, targetDbs: { type: 'array', items: { type: 'string' } }, cardinality: { type: 'string' }, inverseName: { type: 'string' } },
      required: ['db', 'name'],
    },
  },
  {
    name: 'weave_create_automation',
    description: 'Create an automation rule as a System/Workflows row; its Script holds the rule as JSON. enabled (default true) is the row\'s On: pass false to create it Off. trigger: {type: entity-created | field-updated | state-changed, field?, toState?} or {type: schedule, cron: "0 9 * * 1-5", zone?: IANA zone (UTC by default), where?: a query filter}: a schedule fires on its cron minute in its zone, once for every live row of the table the where clause admits, and a box that slept catches up with one run. actions: [{type: set-field, field, value} | {type: append-doc, text} | {type: add-comment, text} | {type: webhook, url} | {type: upsert-row, table, key, fields: {targetField: sourcePath}}] — upsert-row creates or updates a row of another table matched on its key field (text, number, url or email); source paths read row.<Field>, row.PublicId and event.type/field/toState; select values by option name, relations by target Name. text supports {{FieldName}}, {{PublicId}}, {{Today}} (the workspace date format; {{Today:iso}} for 2026-10-06) templates.',
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
    description: 'Rename a space, move it (position: 0 is the first space in the sidebar and in weave_schema) or change its description or icon, or mark it a template (template: true; weave_template_use copies a template\'s schema into another workspace). An icon is `lucide:<name>` from weave_vocabulary or a mark character; anything else is refused.',
    inputSchema: {
      type: 'object',
      properties: { space: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, icon: { type: 'string' }, template: { type: 'boolean' }, position: { type: 'number', description: 'Its place in the sidebar: 0 is the first space' } },
      required: ['space'],
    },
  },
  {
    name: 'weave_template_list',
    description: 'The template spaces of this workspace: the live spaces marked template: true (weave_update_space marks one, or the Template box on its System/Spaces row). Each is a space record: id, name, description, icon.',
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
    description: 'Change a table: name, description, icon (`lucide:<name>` from weave_vocabulary or a mark character; anything else is refused), noun (what one row is called — stored as the Name field\'s `term`; "invoice" makes the create action read "New invoice" and the puck count "3 invoices"), systemFields (Created At, Modified At, Created By, Modified By), fieldOrder (the schema order — every field exactly once; the grid\'s columns are per view, see weave_table_view), hideRollups (the Σ row of space rollups pinned under the field headers: off unless a table asks for it, so pass `false` to show it and `true` to put it away again), position (its place inside its space, 0 first; weave_move_table changes the space).',
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
  {
    name: 'weave_table_view',
    description: 'A table\'s views, in order; the first (Standard) opens with the table. view "Task" lists them, "Task/Open" reads one, "Task/blank" is the raw table. Other keys write; a new name creates one (from: copy). fields: columns. show, hide. move: {field, before|after}. filters: {Field: [options]}. sort: [{field, dir}] ≤3. search. position: 0 first. widths: {field: px}. frozen. density: compact|comfortable|spacious. deleted: trash. rollups: Σ row. subtotals: all|top|none. layout: table|list|board; a board takes groups: stacked|side, picture: off|small|medium|large (gallery: stacked + picture, kanban: side). group: ≤5 levels, field or {field, heading: label|chip, order: option|table|az, dir, grain}. completedBy: checkbox. nest: Parent link. collapsed: paths. order: row #ids. phoneRow: {lead, chips, labels, wrap}. null clears; name renames; delete: true.',
    inputSchema: {
      type: 'object',
      properties: {
        view: { type: 'string' }, fields: { type: 'array' }, show: { type: 'array' }, hide: { type: 'array' },
        move: { type: 'object' }, filters: { type: 'object' }, sort: { type: 'array' }, search: {},
        position: { type: 'number' }, name: { type: 'string' }, from: { type: 'string' }, delete: { type: 'boolean' },
        widths: { type: 'object' }, frozen: { type: 'number' }, density: { type: 'string' }, deleted: { type: 'boolean' }, rollups: { type: ['boolean', 'null'] },
        layout: { type: 'string' }, subtotals: {}, groups: {}, picture: {}, group: {}, completedBy: {}, nest: {}, collapsed: {}, order: {}, phoneRow: {},
      },
      required: ['view'],
    },
  },
  {
    name: 'weave_move_table',
    description: 'Move a table into another space. Only its home changes — every row, field and relation stays exactly as it was. It lands last there unless position says where (0 is the first table). Refuses when the destination already holds (or holds in its trash) a table of the same name.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' }, space: { type: 'string' }, position: { type: 'number' } }, required: ['db', 'space'] },
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
    description: 'Move a field to the trash: the column leaves the table and its values leave the rows, held in the trash with the column\'s place in every view. Pass hard: true to purge it for good (also purges a field already in the trash).',
    inputSchema: { type: 'object', properties: { db: { type: 'string' }, field: { type: 'string' }, hard: { type: 'boolean' } }, required: ['db', 'field'] },
  },
  {
    name: 'weave_restore_field',
    description: 'Restore a field out of the trash by name or id: the column, its values, its place in the field order and in every view, and for a relation its inverse and every link come back. Refused while a live field holds the name or the table is in the trash.',
    inputSchema: { type: 'object', properties: { db: { type: 'string' }, field: { type: 'string' } }, required: ['db', 'field'] },
  },
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
    description: 'Share links: one grant opens one entity, table, space, saved view or the whole workspace to whoever holds its wvs_ token. action: list (kind?, id? narrow it) | mint (kind: entity|table|space|view|workspace, id, mode: read|edit|manage, default read: edit changes rows in scope, manage also adds and trashes them, neither touches schema; comment is reserved and refused; visibility: public|private, private opens only for a signed-in account; label; expiresAt ISO, thirty days out when omitted) | renew (share: the grant id; thirty more days on the same token) | revoke (share: the grant id). The answer carries token and url (/s/<token>); a holder reads pages there or calls the scoped JSON API with Authorization: Bearer <token>. Every action takes an architect token.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' }, kind: { type: 'string' }, id: { type: 'string' }, mode: { type: 'string' },
        visibility: { type: 'string' }, label: { type: 'string' }, expiresAt: { type: 'string' }, share: { type: 'string' },
      },
      required: ['action'],
    },
  },
  {
    name: 'weave_automations',
    description: 'Automations already on a table, read from their System/Workflows rows: action list | describe (rules in prose) | update (patch: name, enabled = the row\'s On) | delete (to the trash). Create one with weave_create_automation.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string' }, db: { type: 'string' }, automation: { type: 'string' }, patch: { type: 'object' } },
      required: ['action'],
    },
  },
  {
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
  {
    name: 'weave_audit',
    description: 'The workspace audit log: schema and account events with their actor.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, since: { type: 'string' } } },
  },
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
    description: 'Agent and human accounts. action: list | create (name, role: observer|editor|architect, default editor — observer reads and comments, editor writes rows, architect also changes structure and accounts; the old names reader|writer|admin are deprecated aliases; the token is returned once) | set (account, role — changes role without rotating tokens or sessions; cannot demote the last architect) | delete | require-auth (on: true|false, which turns token auth on for the whole workspace) | sessions (account — the browser sessions it holds) | revoke-session (account, session id or all: true) | link-identity (account, issuer — mints a one-time invite link, good for 7 days; the person who opens it and signs in at the OpenID Connect provider is linked by subject, and weave stores no email. Signing in at the provider provisions nobody, so an account opens to a provider identity only through this. issuer defaults to WEAVE_OIDC_ISSUER; the url is rooted at WEAVE_ORIGIN) | unlink-identity (account, subject, issuer — the subject account list shows) | invite (email, role default editor, issuer — invites a new person: answers a one-time sign-in link, good for 7 days, that makes the account at that role when they sign in; weave sends no email, so hand the link over) | invites (the pending ones: email, role, invitedBy, createdAt) | revoke-invite (invite: the id invites shows).',
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
    description: 'The meta-model registries (System/Workspaces, Spaces, Tables, Fields) whose rows ARE the schema. The registry lives once, at the weave root — the default workspace — and every row carries a Workspace relation naming the workspace it describes; a member workspace reports and rebuilds its own slice. action report (drift between the registry and the structures it mirrors) | rebuild.',
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
    name: 'weave_forms',
    description: 'Manage native table forms. Architect access is required on the workspace and its hub registry. list shows forms here; get reads an editable definition; create takes a definition with name, table and fields; update changes a form without changing its permalink. Fields accept field, key, label, required, default and aliases. Omitted settings survive edits. Public submissions use weave_form_submit.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'create', 'update'] },
        form: { type: 'string', description: 'The form ID or name for get or update.' },
        definition: { type: 'object', description: 'name, description, table, fields, hidden, enabled and floor (Observer or Anonymous). Update accepts only the settings to change.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'weave_form_submit',
    description: 'Submit one row through a System/Forms form without write access to its table. form is its id or name; values accepts stable input keys, field IDs, aliases, names or labels. Reuse idempotencyKey when retrying the same request: it returns the original receipt; changed input with the same key is refused. Server-filled and unlisted fields are refused. Bug forms take note and categories (slow, broken-ui, wrong-data, error).',
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
  weave_build: 'spaces, tables, fields, relations and rows in one call (dryRun checks)',
  weave_ontology: 'short schema: outline, one table, changes',
  weave_schema: 'the full schema as JSON',
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
  weave_restore_entity: 'restore a trashed row',
  weave_trash: 'list trashed rows',
  weave_stats: 'summarise a table\'s columns',
  weave_undo: 'revert the last row edits (list: true previews)',
  weave_bulk: 'set, link, move or roll up many rows in one write',
  weave_set_state: 'move a row to a workflow state',
  weave_link: 'link rows through a relation field',
  weave_unlink: 'unlink rows from a relation field',
  weave_get_doc: 'a row\'s document as markdown',
  weave_set_doc: 'replace or append a row\'s document',
  weave_doc_revisions: 'a document\'s revisions',
  weave_doc_restore: 'write a past revision back',
  weave_add_comment: 'comment on a row',
  weave_delete_comment: 'delete a comment',
  weave_check_formula: 'validate and preview a formula',
  weave_create_automation: 'create an automation rule',
  weave_automations: 'list, describe, update or delete rules',
  weave_export_csv: 'a table as CSV',
  weave_attach_file: 'attach a file to a row (base64)',
  weave_files: 'read or delete an attached file',
  weave_update_space: 'rename a space; description, icon, template mark',
  weave_template_list: 'list template spaces',
  weave_template_use: 'copy a template space to a workspace',
  weave_delete_space: 'trash a space (hard: true purges)',
  weave_restore_space: 'restore a trashed space',
  weave_update_table: 'rename, icon, noun, field order, system fields, Σ row',
  weave_table_view: 'read and write a table\'s views',
  weave_move_table: 'move a table to another space',
  weave_duplicate_table: 'copy a table\'s schema, no rows',
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
  weave_form_submit: 'one row through a form',
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
  weave_ontology: 'Read schema outline', weave_schema: 'Read full schema', weave_query: 'Query rows',
  weave_get_entity: 'Read row', weave_create_entity: 'Create row', weave_update_entity: 'Update row',
  weave_delete_entity: 'Delete row', weave_restore_entity: 'Restore row', weave_trash: 'List trash',
  weave_stats: 'Summarize table', weave_undo: 'Undo edits', weave_bulk: 'Edit rows in bulk',
  weave_set_state: 'Set workflow state', weave_link: 'Link rows', weave_unlink: 'Unlink rows',
  weave_get_doc: 'Read document', weave_set_doc: 'Write document', weave_doc_revisions: 'List document revisions',
  weave_doc_restore: 'Restore document revision', weave_add_comment: 'Add comment', weave_delete_comment: 'Delete comment',
  weave_search: 'Search workspace', weave_create_space: 'Create space', weave_create_table: 'Create table',
  weave_add_field: 'Add field', weave_check_formula: 'Check formula', weave_add_relation: 'Add relation',
  weave_create_automation: 'Create automation', weave_export_csv: 'Export table as CSV', weave_import_csv: 'Import CSV rows',
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
for (const t of TOOLS) {
  t.annotations = { title: TITLES[t.name], readOnlyHint: READ_ONLY.has(t.name), destructiveHint: DESTRUCTIVE.has(t.name), openWorldHint: OPEN_WORLD.has(t.name) };
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

const systemWrite = (system) => new Error(system === 'users' ? 'Writing a Users row needs an architect token' : 'Writing a row of a system table needs an architect token');
function refuseUsersWrite(weave, ref, caller) {
  if (!caller || mayAdminister(weave, caller.role)) return;
  let system = null;
  try { system = weave.state.tables[weave.getEntity(ref).dbId]?.system; } catch {}
  if (system) throw systemWrite(system);
}

export function mayAdminister(on, role) {
  return Weave.roleName(role) === 'architect' || !on.listAccounts().length;
}
const ADMIN_TOOLS = { weave_accounts: 'workspace', weave_import_json: 'workspace', weave_keys: 'root', weave_shares: 'workspace' };
export const SEATLESS_TOOLS = new Set(['weave_ontology', 'weave_schema', 'weave_query', 'weave_get_entity', 'weave_search', 'weave_trash', 'weave_stats', 'weave_get_doc', 'weave_doc_revisions', 'weave_check_formula', 'weave_export_csv', 'weave_vocabulary', 'weave_template_list', 'weave_activity', 'weave_relation_map', 'weave_add_comment']);
export const ROLE_TOOLS = {
  observer: new Set([...SEATLESS_TOOLS, 'weave_call']),
  editor: new Set([...SEATLESS_TOOLS, 'weave_call', 'weave_create_entity', 'weave_update_entity', 'weave_delete_entity', 'weave_attach_file']),
};
const mayCall = (caller, name) => !ROLE_TOOLS[caller?.tier] || ROLE_TOOLS[caller.tier].has(name);
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

export function dispatchTool(weave, name, args = {}, { caller = null } = {}) {
  if (!mayCall(caller, name)) throw unknownTool(name);
  if (caller?.seat && !SEATLESS_TOOLS.has(name)) throw new Error(caller.seat);
  if (caller && ADMIN_TOOLS[name]) {
    const atRoot = ADMIN_TOOLS[name] === 'root';
    if (!mayAdminister(atRoot ? caller.root ?? weave : weave, atRoot ? caller.rootRole : caller.role)) {
      throw new Error(`${name} needs an architect token${atRoot ? ' on the hub root' : ''}`);
    }
  }
  if (caller && name === 'weave_forms') {
    const registry = weave.registryHost ?? weave;
    const rootRole = registry === weave ? caller.role : caller.rootRole;
    if ((weave.state.meta.requireAuth && !caller.role) || (registry.state.meta.requireAuth && !rootRole) || !mayAdminister(weave, caller.role) || !mayAdminister(registry, rootRole)) throw new Error('Form management needs an architect token on the workspace and hub registry');
  }
  weave.maybeRefresh?.();
  switch (name) {
    case 'weave_ontology':
      return weave.ontology({ depth: args.depth ?? 'outline', concept: args.concept ?? null, since: args.since ?? null });
    case 'weave_schema':
      return weave.describeSchema();
    case 'weave_query':
      return weave.query(args.db, {
        where: args.where ?? [], sort: args.sort ?? [], limit: args.limit ?? null,
        offset: args.offset ?? 0, select: args.select ?? null, fields: args.fields ?? null, relations: args.relations ?? 'full',
        includeDeleted: args.includeDeleted == null ? null : Boolean(args.includeDeleted),
        trashCount: Boolean(args.trashCount), countAll: Boolean(args.countAll), search: args.search ?? '', view: args.view ?? null,
        groupBy: args.groupBy ?? null,
      });
    case 'weave_get_entity':
      return weave.readEntity(args.entity);
    case 'weave_create_entity': {
      checkRowArgs(name, args, false);
      if (caller && !mayAdminister(weave, caller.role) && weave.findTable(args.db)?.system) throw systemWrite(weave.findTable(args.db).system);
      const e = weave.createEntity(args.db, { name: args.name, values: args.values, doc: args.doc, docs: args.docs });
      const once = weave.takeOneTime(e.id);
      return { ...weave.readEntity(e.id), ...(once?.invite ? { invite: { ...once.invite, url: inviteUrl(envOrigin(), once.invite.code) } } : once ?? {}) };
    }
    case 'weave_update_entity':
      checkRowArgs(name, args, true);
      refuseUsersWrite(weave, args.entity, caller);
      weave.updateEntity(args.entity, args.values);
      return weave.readEntity(args.entity);
    case 'weave_delete_entity':
      refuseUsersWrite(weave, args.entity, caller);
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
      return weave.addComment(args.entity, { author: caller?.role && !['architect', 'editor'].includes(caller.role) ? weave.actor : args.author ?? 'agent', text: args.text });
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
      return weave.updateSpace(args.space, pick(args, ['name', 'description', 'icon', 'template', 'position']));
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
      return weave.updateTable(args.db, pick(args, ['name', 'description', 'icon', 'noun', 'hiddenFields', 'systemFields', 'fieldOrder', 'hideRollups', 'position']));
    case 'weave_table_view': {
      const { view, ...patch } = args;
      return weave.tableView(view, Object.keys(patch).length ? patch : null);
    }
    case 'weave_move_table':
      return weave.moveTable(args.db, args.space, { position: args.position ?? null });
    case 'weave_duplicate_table':
      return weave.duplicateTable(args.db);
    case 'weave_delete_table':
      weave.deleteTable(args.db, { hard: Boolean(args.hard) });
      return { table: args.db, deleted: true, hard: Boolean(args.hard) };
    case 'weave_restore_table':
      return weave.restoreTable(args.db);
    case 'weave_update_field': {
      const seq = weave.state.meta.activitySeq ?? 0;
      const field = weave.updateField(args.db, args.field, pick(args, ['name', 'type', 'config']));
      const formulas = weave.fieldChangeSince(args.db, field.id, seq)?.detail.formulas;
      return { ...guided(weave, 'field', field, args.type == null ? args.config : {}), ...(formulas ? { formulas } : {}) };
    }
    case 'weave_rollback_field':
      return weave.rollbackFieldConfig(args.activity, { table: args.db ?? null, field: args.field ?? null });
    case 'weave_delete_field':
      return weave.deleteField(args.db, args.field, { hard: Boolean(args.hard) });
    case 'weave_restore_field':
      return weave.restoreField(args.db, args.field);
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
        case 'list': return { shares: weave.listShares({ kind: args.kind ?? null, id: args.id ?? null }) };
        case 'mint': return weave.mintShare({ scope: { kind: args.kind, id: args.id }, mode: args.mode, visibility: args.visibility, label: args.label, expiresAt: args.expiresAt });
        case 'renew': return weave.renewShare(args.share);
        case 'revoke': return weave.revokeShare(args.share);
        default: throw new Error(`Unknown shares action '${args.action}' (list, mint, renew, revoke)`);
      }
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
      return { events: weave.listAudit({ limit: args.limit ?? undefined, since: args.since ?? null }) };
    case 'weave_forms':
      if (args.action === 'list') return listForms(weave);
      if (args.action === 'get') return getFormDefinition(weave, args.form);
      if (args.action === 'create') {
        if (args.definition?.kind !== undefined) throw new Error('Form management creates row forms');
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
        case 'order': return { workspaces: weave.workspaceOrder() };
        case 'move':
          if (caller && !mayAdminister(caller.root ?? weave, caller.rootRole ?? caller.role)) throw new Error('weave_workspace move needs an architect token on the hub root');
          return { workspaces: weave.moveWorkspace(args.name, args.position) };
        default: throw new Error(`Unknown workspace action '${args.action}' (get, update, logo, clear-logo, order, move)`);
      }
    case 'weave_accounts':
      switch (args.action) {
        case 'list': return { accounts: weave.listAccounts() };
        case 'create': return weave.createAccount({ name: args.name, role: args.role ?? 'editor' });
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
