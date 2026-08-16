// MCP (Model Context Protocol) stdio server: newline-delimited JSON-RPC 2.0.
// Gives any MCP-capable agent full access to a Weave workspace.

const PROTOCOL_VERSION = '2024-11-05';

function textResult(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] };
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
    description: 'Delete an entity (relations are unlinked cleanly).',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' } }, required: ['entity'] },
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
    description: 'Unlink entities from a relation field.',
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
    description: 'Add a comment to an entity.',
    inputSchema: { type: 'object', properties: { entity: { type: 'string' }, text: { type: 'string' }, author: { type: 'string' } }, required: ['entity', 'text'] },
  },
  {
    name: 'weave_search',
    description: 'Universal search across the workspace, spaces, tables, and entities (names, documents, comments). Every result carries a stable permalink url.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'weave_create_space',
    description: 'Create a space (top-level grouping of tables).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'weave_create_table',
    description: 'Create a table in a space (a Name text field is added automatically).',
    inputSchema: { type: 'object', properties: { space: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } }, required: ['space', 'name'] },
  },
  {
    name: 'weave_add_field',
    description: 'Add a field. Types: text, number, date, daterange, checkbox, url, email, select, multiselect, workflow, lookup, rollup, formula. config: {options:[...]} for selects; {states:[{name,category,default}]} for workflow (categories: not-started, in-progress, done, canceled); {relationField, targetField} for lookup; {relationField, targetField, aggregate} for rollup (count,sum,avg,min,max,join); {expression} for formula.',
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
    description: 'Export a table as CSV.',
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
];

export function dispatchTool(weave, name, args = {}) {
  // The MCP server is long-running: pick up commits from other processes
  // (CLI, HTTP server) before every tool call.
  weave.maybeRefresh?.();
  switch (name) {
    case 'weave_schema':
      return weave.describeSchema();
    case 'weave_query':
      return weave.query(args.db, { where: args.where ?? [], sort: args.sort ?? [], limit: args.limit ?? null, offset: args.offset ?? 0, select: args.select ?? null });
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
      weave.deleteEntity(resolveEntity(weave, args.entity));
      return { ok: true };
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
    case 'weave_search':
      return weave.universalSearch(args.query, { limit: args.limit ?? 25 });
    case 'weave_create_space':
      return weave.createSpace(args);
    case 'weave_create_table':
      return weave.createTable(args);
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
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32601 });
  }
}

export function startMcpServer(weave, { input = process.stdin, output = process.stdout } = {}) {
  let buffer = '';

  const send = (msg) => output.write(JSON.stringify(msg) + '\n');

  const handle = (msg) => {
    const { id, method, params } = msg;
    const reply = (result) => id !== undefined && send({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => id !== undefined && send({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      switch (method) {
        case 'initialize':
          return reply({
            protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'weave', version: '0.1.0' },
          });
        case 'notifications/initialized':
        case 'initialized':
          return; // notification, no response
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
