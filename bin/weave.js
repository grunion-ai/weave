#!/usr/bin/env node
// Weave CLI — full workspace access from the terminal (and for agents).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { startMcpServer } from '../src/mcp.js';
import { renderDocumentPage } from '../src/markdown.js';
import { markdownToPdf } from '../src/pdf.js';

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const key = argv[i].slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
    else flags[key] = true;
  } else {
    positional.push(argv[i]);
  }
}
const [command, ...args] = positional;

const dataPath = flags.data ?? process.env.WEAVE_DATA ?? join(homedir(), '.weave', 'workspace.json');

function out(data) {
  if (typeof data === 'string') console.log(data);
  else console.log(JSON.stringify(data, null, 2));
}

function parseJsonFlag(name) {
  if (flags[name] == null || flags[name] === true) return undefined;
  try {
    return JSON.parse(flags[name]);
  } catch {
    console.error(`--${name} must be valid JSON`);
    process.exit(1);
  }
}

function resolveEntityRef(w, ref, dbFlag) {
  // Accept: entity uuid, "Db#12", or (with --db) a name / #pid.
  const m = String(ref).match(/^(.+)#(\d+)$/);
  if (m) {
    const found = w.findEntity(m[1], '#' + m[2]);
    if (found) return found;
  }
  if (dbFlag) {
    const found = w.findEntity(dbFlag, ref);
    if (found) return found;
  }
  return w.getEntity(ref);
}

const HELP = `weave — local, open-source, agent-accessible work platform

Usage: weave <command> [args] [--data path]

Server
  serve [--port 4400]                 Start the web app + REST API
  mcp                                 Start the MCP stdio server (for agents)

Schema
  schema                              Describe spaces, tables, fields
  space create <name>
  table create <space> <name>
  field add <table> <name> <type> [--config '{json}']
  relation add <table> <name> <targetTable> [--cardinality many-to-one] [--inverse Name]

Entities
  query <db> [--where '[["Field","=",1]]'] [--select 'A,B'] [--sort Field] [--limit n]
  get <ref> [--db name]               Read one entity ("Task#3" or id)
  create <db> <name> [--values '{json}'] [--doc 'markdown']
  update <ref> --values '{json}'
  delete <ref>
  state <ref> <field> <state>         Move workflow state
  link <ref> <field> <target> [--unlink]

Documents (entities can carry several document fields; --field picks one,
default is the table's first document field, usually "Description")
  doc get <ref> [--field Name]
  doc set <ref> (--content 'md' | --file path) [--field Name]
  doc append <ref> (--content 'md' | --file path) [--field Name]
  doc export <ref> --format md|html|pdf [--out path] [--field Name]

Collaboration & data
  comment <ref> <text> [--author name]
  search <text>
  csv <db>
  export [--out path]                 Full workspace JSON
  import --file path

Refs: entities accept "Table#publicId" (e.g. Task#3), a UUID, or a name with --db.
Data file: --data flag > WEAVE_DATA env > ~/.weave/workspace.json`;

async function main() {
  if (!command || command === 'help' || flags.help) return out(HELP);

  if (command === 'serve') {
    const w = new Weave({ path: dataPath });
    // Workspace name = data file basename (unless already named).
    const base = dataPath.split('/').pop().replace(/\.(json|db)$/, '');
    if (!w.state.meta.name || w.state.meta.name === 'Weave Workspace') {
      w.state.meta.name = base;
      w.save();
    }
    // The self-referential docs workspace ("weave") always exists alongside.
    if (w.state.meta.name !== 'weave') {
      const dir = dirname(dataPath);
      // Any spelling counts — legacy weaver.* files migrate/rename on adoption.
      const present = ['weave.db', 'weave.json', 'weaver.db', 'weaver.json']
        .some((f) => existsSync(join(dir, f)));
      if (!present) {
        const { seedWeaver } = await import('../src/weaver-seed.js');
        const weavePath = join(dir, 'weave.db');
        seedWeaver(new Weave({ path: weavePath }));
        console.log(`Created docs workspace at ${weavePath}`);
      }
    }
    const port = Number(flags.port ?? 4400);
    const { port: actual } = await startServer(w, { port });
    console.log(`Weave running at http://127.0.0.1:${actual}  (workspace: ${w.state.meta.name}, data: ${dataPath})`);
    console.log(`Docs workspace: http://127.0.0.1:${actual}/w/weave/`);
    return;
  }
  if (command === 'mcp') {
    const w = new Weave({ path: dataPath });
    startMcpServer(w);
    return; // stays alive on stdin
  }

  const w = new Weave({ path: dataPath });

  switch (command) {
    case 'schema':
      return out(w.describeSchema());
    case 'space': {
      const [sub, name] = args;
      if (sub === 'create') return out(w.createSpace({ name }));
      return out(w.listSpaces());
    }
    case 'table':
    case 'db': { // `db` kept as an alias
      const [sub, space, name] = args;
      if (sub === 'create') return out(w.createTable({ space, name }));
      return out(w.listTables().map((d) => w.qualifiedName(d)));
    }
    case 'field': {
      const [sub, db, name, type] = args;
      if (sub === 'add') return out(w.addField(db, { name, type, config: parseJsonFlag('config') ?? {} }));
      throw new WeaveError(`Unknown field subcommand '${sub}'`);
    }
    case 'relation': {
      const [sub, db, name, targetDb] = args;
      if (sub === 'add') {
        return out(w.addRelation(db, { name, targetDb, cardinality: flags.cardinality ?? 'many-to-one', inverseName: flags.inverse }));
      }
      throw new WeaveError(`Unknown relation subcommand '${sub}'`);
    }
    case 'query': {
      const [db] = args;
      const result = w.query(db, {
        where: parseJsonFlag('where') ?? [],
        select: flags.select ? String(flags.select).split(',').map((s) => s.trim()) : null,
        sort: flags.sort ? [String(flags.sort)] : [],
        limit: flags.limit ? Number(flags.limit) : null,
        offset: flags.offset ? Number(flags.offset) : 0,
      });
      return out(result);
    }
    case 'get':
      return out(w.readEntity(resolveEntityRef(w, args[0], flags.db).id));
    case 'create': {
      const [db, name] = args;
      const e = w.createEntity(db, { name, values: parseJsonFlag('values') ?? {}, doc: flags.doc === true ? '' : flags.doc });
      return out(w.readEntity(e.id));
    }
    case 'update': {
      const e = resolveEntityRef(w, args[0], flags.db);
      w.updateEntity(e.id, parseJsonFlag('values') ?? {});
      return out(w.readEntity(e.id));
    }
    case 'delete': {
      const e = resolveEntityRef(w, args[0], flags.db);
      w.deleteEntity(e.id);
      return out({ ok: true });
    }
    case 'state': {
      const [ref, field, ...stateParts] = args;
      const e = resolveEntityRef(w, ref, flags.db);
      w.setState(e.id, field, stateParts.join(' '));
      return out(w.readEntity(e.id));
    }
    case 'link': {
      const [ref, field, ...targets] = args;
      const e = resolveEntityRef(w, ref, flags.db);
      if (flags.unlink) w.unlink(e.id, field, targets);
      else w.link(e.id, field, targets);
      return out(w.readEntity(e.id));
    }
    case 'doc': {
      const [sub, ref] = args;
      const e = resolveEntityRef(w, ref, flags.db);
      const content = flags.file ? readFileSync(flags.file, 'utf8') : flags.content;
      const docField = flags.field === true ? null : flags.field ?? null; // named document field, default = first
      if (sub === 'get') return out(w.getDoc(e.id, docField));
      if (sub === 'set') { w.setDoc(e.id, content ?? '', docField); return out({ ok: true }); }
      if (sub === 'append') { w.appendDoc(e.id, content ?? '', docField); return out({ ok: true }); }
      if (sub === 'export') {
        const read = w.readEntity(e.id);
        const markdown = w.getDoc(e.id, docField);
        const subtitle = `${read.db} #${read.publicId}${docField ? ` • ${docField}` : ''}`;
        const format = flags.format ?? 'md';
        let data;
        if (format === 'md') data = markdown;
        else if (format === 'html') data = renderDocumentPage({ title: read.name, subtitle, markdown });
        else if (format === 'pdf') data = markdownToPdf(markdown, { title: read.name, subtitle });
        else throw new WeaveError(`Unknown format '${format}'`);
        if (flags.out) {
          writeFileSync(flags.out, data);
          return out({ ok: true, path: flags.out, bytes: Buffer.byteLength(data) });
        }
        if (format === 'pdf') return process.stdout.write(data);
        return out(data);
      }
      throw new WeaveError(`Unknown doc subcommand '${sub}'`);
    }
    case 'comment': {
      const [ref, ...textParts] = args;
      const e = resolveEntityRef(w, ref, flags.db);
      return out(w.addComment(e.id, { author: flags.author ?? 'cli', text: textParts.join(' ') }));
    }
    case 'search':
      return out(w.search(args.join(' '), { limit: flags.limit ? Number(flags.limit) : 25 }));
    case 'csv':
      return process.stdout.write(w.exportCSV(args[0]));
    case 'export': {
      const dump = JSON.stringify(w.exportJSON(), null, 1);
      if (flags.out) {
        writeFileSync(flags.out, dump);
        return out({ ok: true, path: flags.out });
      }
      return console.log(dump);
    }
    case 'import': {
      if (!flags.file) throw new WeaveError('import needs --file');
      w.importJSON(JSON.parse(readFileSync(flags.file, 'utf8')));
      return out({ ok: true });
    }
    default:
      console.error(`Unknown command '${command}'. Run: weave help`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`weave: error: ${err.message}`);
  process.exit(1);
});
