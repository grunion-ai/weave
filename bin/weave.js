#!/usr/bin/env node
// Weave CLI — full workspace access from the terminal (and for agents).

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
const CLI_ACTOR = process.env.WEAVE_ACTOR || (() => { try { return userInfo().username; } catch { return 'cli'; } })();
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

Service (macOS launchd — auto-start on login, restart on crash)
  service install [--port 4400] [--data path] [--label ai.grunion.weave.<port>]
                                      Write + load the launch agent; logs to ~/Library/Logs/weave/
  service uninstall [--label name]    Stop the agent and remove its plist
  service status [--port 4400]        Plist, launchctl state, live /api/health probe

Schema
  schema                              Describe spaces, tables, fields
  schema export [--out file]          The schema as an editable JSON document
  schema apply --file doc.json [--dry-run] [--allow-destructive]
                                      Grow the workspace to match the document
  space create <name>
  table create <space> <name>
  field add <table> <name> <type> [--config '{json}']
  relation add <table> <name> <targetTable> [--cardinality many-to-one] [--inverse Name]

Entities
  query <db> [--where '[["Field","=",1]]'] [--select 'A,B'] [--sort Field] [--limit n]
  get <ref> [--db name]               Read one entity ("Task#3" or id)
  create <db> <name> [--values '{json}'] [--doc 'markdown']
  update <ref> --values '{json}'
  delete <ref> [--hard]               Soft by default (recoverable); --hard purges
  restore <ref>                       Bring a soft-deleted entity back
  trash [table]                       Deleted entities, one table or all
  state <ref> <field> <state>         Move workflow state
  link <ref> <field> <target> [--unlink]

Documents (entities can carry several document fields; --field picks one,
default is the table's first document field, usually "Description")
  doc get <ref> [--field Name]
  doc set <ref> (--content 'md' | --file path) [--field Name]
  doc append <ref> (--content 'md' | --file path) [--field Name]
  doc export <ref> --format md|html|pdf [--out path] [--field Name]

Keys (Feature #64 — secrets live in ~/.weave/keystore.json, never in data)
  key set <name> (--value <secret> | reads stdin)
  key list
  key delete <name>
Accounts & audit (Feature #14)
  account create <name> [--role admin|writer|reader]
  account list
  account delete <ref>
  audit [--limit 50]
Undo (entity mutations only — schema work is not undoable)
  undo [--steps n]                    Revert the last n entity mutations
  undo --list [--limit 20]           Show what undo would revert, newest first
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
    const w = new Weave({ path: dataPath, actor: CLI_ACTOR });
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
        seedWeaver(new Weave({ path: weavePath, actor: CLI_ACTOR }));
        console.log(`Created docs workspace at ${weavePath}`);
      }
    }
    const port = Number(flags.port ?? process.env.PORT ?? 4400);
    const { port: actual } = await startServer(w, { port });
    console.log(`Weave running at http://127.0.0.1:${actual}  (workspace: ${w.state.meta.name}, data: ${dataPath})`);
    console.log(`Docs workspace: http://127.0.0.1:${actual}/w/weave/`);
    return;
  }
  if (command === 'mcp') {
    const w = new Weave({ path: dataPath, actor: CLI_ACTOR });
    startMcpServer(w);
    return; // stays alive on stdin
  }

  if (command === 'service') {
    // Never opens the workspace — install/status must work while another
    // process owns the data file, and must not create one as a side effect.
    const { serviceOptions, buildPlist, parseLaunchctlPrint, buildStatus, probeHealth } = await import('../src/service.js');
    const [sub] = args;
    const opts = serviceOptions({ ...flags, data: flags.data ?? process.env.WEAVE_DATA });
    const domain = `gui/${process.getuid()}`;
    const launchctl = (...a) => spawnSync('launchctl', a, { encoding: 'utf8' });

    if (sub === 'install') {
      mkdirSync(dirname(opts.plistPath), { recursive: true });
      mkdirSync(dirname(opts.logPath), { recursive: true });
      writeFileSync(opts.plistPath, buildPlist(opts));
      launchctl('bootout', `${domain}/${opts.label}`); // re-install replaces; errors expected on first install
      const boot = launchctl('bootstrap', domain, opts.plistPath);
      if (boot.status !== 0) {
        // Older launchctl (or an already-bootstrapped edge): legacy load path.
        const load = launchctl('load', '-w', opts.plistPath);
        if (load.status !== 0) throw new WeaveError(`launchctl failed: ${(boot.stderr || load.stderr || '').trim() || 'unknown error'}`);
      }
      return out({ ok: true, label: opts.label, plist: opts.plistPath, log: opts.logPath, url: `http://127.0.0.1:${opts.port}` });
    }
    if (sub === 'uninstall') {
      launchctl('bootout', `${domain}/${opts.label}`); // best effort — plist removal is the point
      rmSync(opts.plistPath, { force: true });
      return out({ ok: true, label: opts.label, removed: opts.plistPath });
    }
    if (sub === 'status') {
      const print = launchctl('print', `${domain}/${opts.label}`);
      const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
      return out(buildStatus({
        label: opts.label,
        port: opts.port,
        plistPath: opts.plistPath,
        plistInstalled: existsSync(opts.plistPath),
        launchctl: parseLaunchctlPrint(print.status === 0 ? print.stdout : ''),
        health: await probeHealth(opts.port),
        localVersion: pkg.version,
      }));
    }
    throw new WeaveError(`Unknown service subcommand '${sub}'. Try: install, uninstall, status`);
  }

  const w = new Weave({ path: dataPath, actor: CLI_ACTOR });

  switch (command) {
    case 'schema': {
      const [sub] = args;
      if (sub === 'apply') {
        const doc = JSON.parse(readFileSync(flags.file, 'utf8'));
        return out(w.applySchema(doc, { dryRun: !!flags['dry-run'], allowDestructive: !!flags['allow-destructive'] }));
      }
      if (sub === 'export') {
        const json = JSON.stringify(w.describeSchema(), null, 2);
        if (flags.out) { writeFileSync(flags.out, json); return out({ ok: true, out: flags.out }); }
        return out(json);
      }
      return out(w.describeSchema());
    }
    case 'account': {
      const [sub, ref] = args;
      if (sub === 'create') return out(w.createAccount({ name: ref, role: flags.role ?? 'writer' }));
      if (sub === 'delete') return out(w.deleteAccount(ref));
      if (sub === 'list' || !sub) return out(w.listAccounts());
      throw new WeaveError(`Unknown account subcommand '${sub}'. Try: create, list, delete`);
    }
    case 'key': {
      const [sub, name] = args;
      if (sub === 'set') {
        const value = flags.value ?? readFileSync(0, 'utf8').trim();
        return out(w.setKey(name, value));
      }
      if (sub === 'delete') return out(w.deleteKey(name));
      if (sub === 'list' || !sub) return out(w.listKeys());
      throw new WeaveError(`Unknown key subcommand '${sub}'. Try: set, list, delete`);
    }
    case 'audit':
      return out(w.listAudit({ limit: Number(flags.limit ?? 50) }));
    case 'undo': {
      if (flags.list) return out(w.listUndo({ limit: Number(flags.limit ?? 20) }));
      return out(w.undo({ steps: Math.max(1, Number(flags.steps ?? 1)) }));
    }
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
      return out(w.deleteEntity(e.id, { hard: Boolean(flags.hard) }));
    }
    case 'restore': {
      const e = resolveEntityRef(w, args[0], flags.db);
      return out(w.restoreEntity(e.id));
    }
    case 'trash':
      return out(w.listTrash(args[0] ?? null));
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
