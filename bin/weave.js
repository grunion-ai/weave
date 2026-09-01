#!/usr/bin/env node
// Weave CLI — full workspace access from the terminal (and for agents).

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
const CLI_ACTOR = process.env.WEAVE_ACTOR || (() => { try { return userInfo().username; } catch { return 'cli'; } })();
import { Weave, WeaveError } from '../src/engine.js';
import { VOCABULARY } from '../src/vocabulary.js';
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

// Only the flags a caller actually typed: an absent flag means "leave it".
function pickFlags(names) {
  const patch = {};
  for (const n of names) if (flags[n] != null && flags[n] !== true) patch[n] = flags[n];
  return patch;
}

const splitList = (v) => String(v).split(',').map((x) => x.trim()).filter(Boolean);

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
  serve [--port 4400] [--host 127.0.0.1]
                                      Start the web app + REST API
                                      (--host 0.0.0.0 exposes it to this network)
  mcp                                 Start the MCP stdio server (for agents)

Service (macOS launchd — auto-start on login, restart on crash)
  service install [--port 4400] [--data path] [--label ai.grunion.weave.<port>]
                                      Write + load the launch agent; logs to ~/Library/Logs/weave/
  service uninstall [--label name]    Stop the agent and remove its plist
  service status [--port 4400]        Plist, launchctl state, live /api/health probe
  service promote [--serve-dir ~/.weave-serve] [--remote gerrit] [--label ...] [--port 4400]
                  [--no-rehearse] [--rehearse-db path]
                                      Checkout main clean, run the lifecycle pack, then
                                      rehearse on a COPY of the weave docs workspace +
                                      a fresh one; restart, probe, roll back on red
  rehearse --data path                Run the promote rehearsal battery against a COPY
                                      (mutates its target — never the live file)

Schema
  schema                              Describe spaces, tables, fields
  schema export [--out file]          The schema as an editable JSON document
  schema apply --file doc.json [--dry-run] [--allow-destructive]
                                      Grow the workspace to match the document
  vocabulary [section]                Every legal config value and what it looks like
                                      (icons are iconly:<name>; colors are hex from the palette)
  space create <name> [--description] [--icon iconly:work]
  space list | update <ref> [--name] [--description] [--icon iconly:work] | delete <ref>
  table create <space> <name> [--description] [--icon]
  table list | delete <ref>
  table update <ref> [--name] [--description] [--icon iconly:wallet] [--noun invoice]
              [--hidden A,B] [--system 'Created At'] [--order Name,A,B]
  field add <table> <name> <type> [--config '{json}']
  field list <table> | delete <table> <field>
  field update <table> <field> [--name] [--type] [--config '{json}'] [--width 240|null]
  relation add <table> <name> <targetTable> [--cardinality many-to-one] [--inverse Name] [--target-dbs 'A,B,C']
  registry [report|rebuild]           The meta-model rows that mirror the schema
  map                                 Relation map as mermaid

Entities
  query <db> [--where '[["Field","=",1]]'] [--select 'A,B'] [--sort Field] [--limit n]
  get <ref> [--db name]               Read one entity ("Task#3" or id)
  create <db> <name> [--values '{json}'] [--doc 'markdown']
  update <ref> --values '{json}'
  delete <ref> [--hard]               Soft by default (recoverable); --hard purges
  restore <ref>                       Bring a soft-deleted entity back
  trash [table]                       Deleted entities, one table or all
  state <ref> <field> <state>         Move workflow state
  link <ref> <field> <target...>
  unlink <ref> <field> <target...>

Documents (entities can carry several document fields; --field picks one,
default is the table's first document field, usually "Description")
  doc get <ref> [--field Name]
  doc set <ref> (--content 'md' | --file path) [--field Name]
  doc append <ref> (--content 'md' | --file path) [--field Name]
  doc export <ref> --format md|html|pdf [--out path] [--field Name]

Credentials (#64, #143 — secrets live encrypted in ~/.weave/keystore.json, never in data)
  key set <name> (--value <secret> | reads stdin)
  key list                            Names, owners and who each is shared with
  key reveal <name> [--copy]          Prints the secret — owner or grantee only, always audited
  key share <name> --with <account>   Open one credential to one account
  key unshare <name> --with <account>
  key delete <name>
Accounts & audit (Feature #14)
  account create <name> [--role admin|writer|reader]
  account list
  account delete <ref>
  audit [--limit 50]
Undo (entity mutations only — schema work is not undoable)
  undo [--steps n]                    Revert the last n entity mutations
  undo --list [--limit 20]           Show what undo would revert, newest first
Views & automations
  view list | get <id> | delete <id> | share <id> | unshare <id>
  view create <name> --blocks '[{"table":"Task","view":"board"}]'
  automation list [<table>] | describe [<table>] | delete <id>
  automation create <table> --name N --trigger '{json}' --actions '[json]'
  automation update <id> --patch '{json}'

The workspace itself
  workspace [get]                     Name, description, logo, auth
  workspace set [--name] [--description]
  workspace logo (--path file | --out file | --clear)
  workspace require-auth [--off]
  activity [<id>] [--entity ref] [--table name] [--kinds a,b] [--since iso] [--limit n]

Collaboration & data
  comment <ref> <text> [--author name]
  comment delete <ref> <commentId>
  search <text>
  csv <db>                            Export a table as CSV
  csv import <db> [--file path]       Import rows (stdin when --file is absent)
  file attach <ref> --path file [--field Name] [--mime type]
  file read <fileId> [--out path]
  file delete <ref> <fileId>
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
    /* Every build carries its issue list (2026-08-31): apply the shipped
       Development manifest to the docs workspace, so an updated install
       shows the current known / resolved issues and the roadmap. Fail-open —
       a missing or unreadable manifest never blocks serving. */
    try {
      const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'development.json'), 'utf8'));
      const docsPath = w.state.meta.name === 'weave' ? dataPath : join(dirname(dataPath), 'weave.db');
      if (existsSync(docsPath)) {
        const { syncDevelopment } = await import('../src/weaver-seed.js');
        const docsW = w.state.meta.name === 'weave' ? w : new Weave({ path: docsPath, actor: CLI_ACTOR });
        const r = syncDevelopment(docsW, manifest);
        if (docsW !== w) docsW.store.close?.();
        if (r.applied) console.log(`Development sync v${manifest.version}: ${r.created} created, ${r.updated} updated`);
      }
    } catch { /* no manifest in this build */ }
    const port = Number(flags.port ?? process.env.PORT ?? 4400);
    // Loopback unless asked otherwise. --host 0.0.0.0 puts every workspace on
    // the local network with no authentication in front of /api/*; it exists
    // so a phone on the same wifi can reach the task applet, and it should be
    // turned off again when it is not needed.
    const host = String(flags.host ?? process.env.WEAVE_HOST ?? '127.0.0.1');
    const { port: actual } = await startServer(w, { port, host });
    const wide = host === '0.0.0.0' || host === '::';
    const shown = wide ? hostname() : host;
    console.log(`Weave running at http://${shown}:${actual}  (workspace: ${w.state.meta.name}, data: ${dataPath})`);
    if (wide) console.log(`Bound to ${host} — every workspace on this network can reach it.`);
    console.log(`Docs workspace: http://${shown}:${actual}/w/weave/`);
    return;
  }
  if (command === 'mcp') {
    const w = new Weave({ path: dataPath, actor: CLI_ACTOR });
    startMcpServer(w);
    return; // stays alive on stdin
  }

  if (command === 'rehearse') {
    // The promote rehearsal, runnable by hand. Mutates (and then cleans) the
    // workspace it opens, so it demands an explicit --data: pointing it at
    // the live default workspace by accident must be impossible.
    if (!flags.data || flags.data === true) {
      console.error('rehearse mutates its target — pass an explicit --data pointing at a COPY');
      process.exit(1);
    }
    const { rehearse } = await import('../src/rehearse.js');
    const result = rehearse(String(flags.data));
    out(result);
    process.exit(result.ok ? 0 : 1);
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
    /* Promote (lifecycle gate, Phase 3): production is the last SHA that
       passed the lifecycle pack twice — once pre-merge in Gerrit, once here.
       The serve checkout (--serve-dir, default ~/.weave-serve) is the ONLY
       thing the launch agent should run; promoting the dev working tree is
       exactly the era this ends. Flow: fetch gerrit/main -> clean checkout ->
       run the pack there -> kickstart -> health + version probe -> roll back
       to the previous SHA on any red, with the breadcrumb on stdout. */
    if (sub === 'promote') {
      const { parseTap, promoteVerdict } = await import('../src/service.js');
      const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
      const serveDir = flags['serve-dir'] && flags['serve-dir'] !== true ? String(flags['serve-dir']) : join(homedir(), '.weave-serve');
      const git = (cwd, ...a) => {
        const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8' });
        if (r.status !== 0) throw new WeaveError(`git ${a.join(' ')} failed: ${(r.stderr || '').trim()}`);
        return r.stdout.trim();
      };
      // The source of truth is the review queue's main, not the dev tree.
      const remote = flags.remote && flags.remote !== true ? String(flags.remote) : 'gerrit';
      git(repoRoot, 'fetch', remote, 'main');
      const sha = git(repoRoot, 'rev-parse', 'FETCH_HEAD');
      if (!existsSync(serveDir)) {
        spawnSync('git', ['clone', '--no-checkout', repoRoot, serveDir], { encoding: 'utf8' });
      }
      const prevSha = spawnSync('git', ['-C', serveDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim() || null;
      git(serveDir, 'fetch', repoRoot, sha);
      git(serveDir, 'checkout', '--detach', '--force', sha);

      const pack = spawnSync('node', ['--test', '--test-name-pattern', 'lifecycle:', 'test/regression/lifecycle.test.mjs'],
        { cwd: serveDir, encoding: 'utf8' });
      const tap = parseTap((pack.stdout ?? '') + (pack.stderr ?? ''));
      if (!tap.pass) {
        if (prevSha) git(serveDir, 'checkout', '--detach', '--force', prevSha);
        return out({ promoted: false, sha, verdict: 'REJECTED by the lifecycle regression gate before restart', failed: tap.failed });
      }

      /* Rehearsal (gap 3): the pack proved the code on toy fixtures; now
         prove it on a COPY of the built-in weave workspace — the most data
         any workspace carries — plus a fresh workspace built from nothing.
         Red here rejects before restart, same as the pack. --no-rehearse
         skips; --rehearse-db points at a different source file. */
      if (!flags['no-rehearse']) {
        const { mkdtempSync, copyFileSync, rmSync: rmTmp } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const srcDb = flags['rehearse-db'] && flags['rehearse-db'] !== true
          ? String(flags['rehearse-db'])
          : join(homedir(), '.weave', 'weave.db');
        if (existsSync(srcDb)) {
          const scratch = mkdtempSync(join(tmpdir(), 'weave-rehearse-'));
          try {
            const copy = join(scratch, 'copy.db');
            for (const suffix of ['', '-wal', '-shm']) {
              if (existsSync(srcDb + suffix)) copyFileSync(srcDb + suffix, copy + suffix);
            }
            const run = spawnSync('node', [join(serveDir, 'bin', 'weave.js'), 'rehearse', '--data', copy], { encoding: 'utf8' });
            let steps = [];
            try { steps = JSON.parse(run.stdout).steps ?? []; } catch { /* older builds have no rehearse */ }
            if (run.status !== 0 && steps.length) {
              if (prevSha) git(serveDir, 'checkout', '--detach', '--force', prevSha);
              return out({
                promoted: false,
                sha,
                verdict: 'REJECTED by the promote rehearsal (real-data copy) before restart',
                failed: steps.filter((s) => !s.ok),
              });
            }
          } finally {
            rmTmp(scratch, { recursive: true, force: true });
          }
        }
      }

      launchctl('kickstart', '-k', `${domain}/${opts.label}`);
      const expectedVersion = JSON.parse(readFileSync(join(serveDir, 'package.json'), 'utf8')).version;
      let health = { reachable: false };
      for (let i = 0; i < 20 && !promoteVerdict({ health, expectedVersion }).healthy; i++) {
        await new Promise((r) => setTimeout(r, 500));
        health = await probeHealth(opts.port);
      }
      const verdict = promoteVerdict({ health, expectedVersion });
      if (!verdict.healthy) {
        if (prevSha) {
          git(serveDir, 'checkout', '--detach', '--force', prevSha);
          launchctl('kickstart', '-k', `${domain}/${opts.label}`);
        }
        return out({ promoted: false, sha, verdict: `ROLLED BACK: ${verdict.reason}`, rolledBackTo: prevSha });
      }
      return out({ promoted: true, sha, previous: prevSha, server: { version: health.version, startedAt: health.startedAt } });
    }
    throw new WeaveError(`Unknown service subcommand '${sub}'. Try: install, uninstall, status, promote`);
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
      /* Reveal is the one command that prints a secret, so it prints the
         secret and nothing else — a bare value pipes into whatever needed it
         without a JSON wrapper to strip (Feature #143). */
      if (sub === 'reveal') {
        process.stdout.write(w.revealKey(name, { via: flags.copy ? 'copy' : 'show' }) + '\n');
        return;
      }
      if (sub === 'share') return out(w.grantKey(name, flags.with === true ? true : flags.with));
      if (sub === 'unshare') return out(w.revokeKey(name, flags.with));
      if (sub === 'list' || !sub) return out(w.listKeys());
      throw new WeaveError(`Unknown key subcommand '${sub}'. Try: set, list, reveal, share, unshare, delete`);
    }
    case 'audit':
      return out(w.listAudit({ limit: Number(flags.limit ?? 50) }));
    case 'undo': {
      if (flags.list) return out(w.listUndo({ limit: Number(flags.limit ?? 20) }));
      return out(w.undo({ steps: Math.max(1, Number(flags.steps ?? 1)) }));
    }
    case 'space': {
      const [sub, name] = args;
      if (sub === 'create') return out(w.createSpace({ name, description: flags.description ?? '', icon: flags.icon ?? '' }));
      if (sub === 'update') return out(w.updateSpace(name, pickFlags(['name', 'description', 'icon'])));
      if (sub === 'delete') { w.deleteSpace(name, { hard: Boolean(flags.hard) }); return out({ space: name, deleted: true }); }
      if (sub === 'restore') return out(w.restoreSpace(name));
      if (sub === 'list' || !sub) return out(w.listSpaces());
      throw new WeaveError(`Unknown space subcommand '${sub}'. Try: create, list, update, delete, restore`);
    }
    case 'table':
    case 'db': { // `db` kept as an alias
      const [sub, space, name] = args;
      if (sub === 'create') return out(w.createTable({ space, name, description: flags.description ?? '', icon: flags.icon ?? '' }));
      if (sub === 'update') {
        // `space` is the table ref here: `table update Ops/Invoice --icon wallet`.
        const patch = pickFlags(['name', 'description', 'icon', 'noun']);
        if (flags.hidden != null) patch.hiddenFields = splitList(flags.hidden);
        if (flags.system != null) patch.systemFields = splitList(flags.system);
        if (flags.order != null) patch.fieldOrder = splitList(flags.order);
        return out(w.updateTable(space, patch));
      }
      if (sub === 'delete') { w.deleteTable(space, { hard: Boolean(flags.hard) }); return out({ table: space, deleted: true }); }
      if (sub === 'restore') return out(w.restoreTable(space));
      if (sub === 'list' || !sub) return out(w.listTables().map((d) => w.qualifiedName(d)));
      throw new WeaveError(`Unknown table subcommand '${sub}'. Try: create, list, update, delete, restore`);
    }
    case 'field': {
      const [sub, db, name, type] = args;
      if (sub === 'add') return out(w.addField(db, { name, type, config: parseJsonFlag('config') ?? {} }));
      if (sub === 'update') {
        const patch = {};
        if (flags.name != null) patch.name = flags.name;
        if (flags.type != null) patch.type = flags.type;
        const config = parseJsonFlag('config') ?? {};
        // Width and default ride their own lanes in the engine, so they are
        // flags rather than JSON: `--width 240`, `--width null` to reset.
        if (flags.width != null) config.width = flags.width === 'null' ? null : Number(flags.width);
        if (flags.default != null) config.default = flags.default === 'null' ? null : flags.default;
        if (Object.keys(config).length) patch.config = config;
        return out(w.updateField(db, name, patch));
      }
      if (sub === 'delete') return out(w.deleteField(db, name));
      if (sub === 'list' || !sub) return out(w.getTable(db).fieldOrder.map((id) => w.getTable(db).fields[id]));
      throw new WeaveError(`Unknown field subcommand '${sub}'. Try: add, list, update, delete`);
    }
    case 'relation': {
      const [sub, db, name, targetDb] = args;
      if (sub === 'add') {
        // --target-dbs 'A,B,C' makes a target-set (polymorphic) relation.
        const targetDbs = flags['target-dbs'] ? String(flags['target-dbs']).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
        return out(w.addRelation(db, { name, targetDb, targetDbs, cardinality: flags.cardinality ?? 'many-to-one', inverseName: flags.inverse }));
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
    case 'link':
    case 'unlink': {
      const [ref, field, ...targets] = args;
      const e = resolveEntityRef(w, ref, flags.db);
      // `link --unlink` was the only way to take one off, which reads as a
      // flag that means the opposite of its command.
      if (command === 'unlink' || flags.unlink) w.unlink(e.id, field, targets);
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
      const [first, ...rest] = args;
      if (first === 'delete') {
        const [ref, commentId] = rest;
        return out(w.deleteComment(resolveEntityRef(w, ref, flags.db).id, commentId));
      }
      const e = resolveEntityRef(w, first, flags.db);
      return out(w.addComment(e.id, { author: flags.author ?? 'cli', text: rest.join(' ') }));
    }
    case 'search':
      return out(w.search(args.join(' '), { limit: flags.limit ? Number(flags.limit) : 25 }));
    case 'csv': {
      const [sub, ...rest] = args;
      if (sub === 'import') {
        const db = rest[0];
        const text = flags.file ? readFileSync(flags.file, 'utf8') : readFileSync(0, 'utf8');
        return out(w.importCSV(db, text));
      }
      // `csv <table>` stays the export it has always been.
      return process.stdout.write(w.exportCSV(sub === 'export' ? rest[0] : sub));
    }
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
    /* Everything below reaches a capability the web UI has always had and the
       terminal did not — which made a browser the only way to do it. */
    case 'vocabulary': {
      const [section] = args;
      if (section) {
        if (!(section in VOCABULARY)) throw new WeaveError(`Unknown vocabulary section '${section}' (${Object.keys(VOCABULARY).join(', ')})`);
        return out(VOCABULARY[section]);
      }
      return out(VOCABULARY);
    }
    case 'view': {
      const [sub, ref] = args;
      if (sub === 'create') return out(w.createView({ name: ref, blocks: parseJsonFlag('blocks') ?? [] }));
      if (sub === 'get') return out(w.resolveView(ref));
      if (sub === 'delete') return out(w.deleteView(ref));
      if (sub === 'share') return out(w.shareView(ref));
      if (sub === 'unshare') return out(w.unshareView(ref));
      if (sub === 'list' || !sub) return out(w.listViews());
      throw new WeaveError(`Unknown view subcommand '${sub}'. Try: create, list, get, delete, share, unshare`);
    }
    case 'automation': {
      const [sub, ref] = args;
      if (sub === 'create') {
        return out(w.createAutomation(ref, {
          name: flags.name, trigger: parseJsonFlag('trigger'), actions: parseJsonFlag('actions') ?? [],
          enabled: flags.enabled !== 'false',
        }));
      }
      if (sub === 'describe') return out(w.describeAutomations(ref ?? flags.db ?? null));
      if (sub === 'update') return out(w.updateAutomation(ref, parseJsonFlag('patch') ?? {}));
      if (sub === 'delete') return out(w.deleteAutomation(ref));
      if (sub === 'list' || !sub) return out(w.listAutomations(ref ?? flags.db ?? null));
      throw new WeaveError(`Unknown automation subcommand '${sub}'. Try: create, list, describe, update, delete`);
    }
    case 'activity': {
      const [id] = args;
      if (id) return out(w.getActivity(id));
      return out(w.activityFeed({
        entityId: flags.entity ? resolveEntityRef(w, flags.entity, flags.db).id : null,
        tableRef: flags.table ?? null,
        kinds: flags.kinds ? splitList(flags.kinds) : null,
        since: flags.since ?? null,
        limit: flags.limit ? Number(flags.limit) : null,
      }));
    }
    case 'workspace': {
      const [sub] = args;
      if (sub === 'logo') {
        if (flags.clear) { w.deleteWorkspaceLogo(); return out({ logo: false }); }
        if (flags.out) {
          const logo = w.getWorkspaceLogo();
          if (!logo) throw new WeaveError('This workspace has no logo');
          writeFileSync(flags.out, Buffer.from(logo.bytes));
          return out({ ok: true, path: flags.out, mime: logo.mime });
        }
        if (!flags.path) throw new WeaveError('workspace logo needs --path, --out or --clear');
        const bytes = readFileSync(flags.path).toString('base64');
        return out(w.setWorkspaceLogo({ name: flags.path.split('/').pop(), mime: flags.mime ?? 'image/png', bytes }));
      }
      if (sub === 'set' || sub === 'update') return out(w.updateWorkspace(pickFlags(['name', 'description'])));
      if (sub === 'require-auth') return out(w.setRequireAuth(flags.off ? false : true));
      if (sub === 'get' || !sub) return out(w.getWorkspace());
      throw new WeaveError(`Unknown workspace subcommand '${sub}'. Try: get, set, logo, require-auth`);
    }
    case 'file': {
      const [sub, ref, fileId] = args;
      if (sub === 'attach') {
        if (!flags.path) throw new WeaveError('file attach needs --path');
        const e = resolveEntityRef(w, ref, flags.db);
        const file = { name: flags.path.split('/').pop(), mime: flags.mime ?? 'application/octet-stream', bytes: readFileSync(flags.path).toString('base64') };
        return out(flags.field ? w.attachToField(e.id, flags.field, file) : w.attachFile(e.id, file));
      }
      if (sub === 'read') {
        const { meta, bytes } = w.readFile(ref);
        if (flags.out) { writeFileSync(flags.out, Buffer.from(bytes)); return out({ ...meta, path: flags.out }); }
        return process.stdout.write(Buffer.from(bytes));
      }
      if (sub === 'delete') return out(w.deleteFile(resolveEntityRef(w, ref, flags.db).id, fileId));
      throw new WeaveError(`Unknown file subcommand '${sub}'. Try: attach, read, delete`);
    }
    case 'registry': {
      const [sub] = args;
      if (sub === 'rebuild') return out(w.rebuildRegistry());
      if (sub === 'report' || !sub) return out(w.registryReport());
      throw new WeaveError(`Unknown registry subcommand '${sub}'. Try: report, rebuild`);
    }
    case 'map':
      return out(w.relationMapMmd());
    default:
      console.error(`Unknown command '${command}'. Run: weave help`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`weave: error: ${err.message}`);
  process.exit(1);
});
