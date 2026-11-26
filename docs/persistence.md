# Persistence

This page states the rules that carry a workspace to disk and back. Read it
before you change a write path, a read path that skips the engine, `src/store.js` or
`src/backup.js`. `test/persistence-doc.test.mjs` checks that every symbol in
the last table is still in the file it names, with the value stated.

## Memory is the source, the database is written behind

Each workspace is one SQLite file, `<name>.db`, in the data directory. The
store opens it in WAL mode with `synchronous = FULL` and a 5 second busy
timeout. On open, `Store.load` reads every row into `weave.state`, and from
then on every read is a scan of that object in JavaScript, never a SQLite
query, which makes the `.db` a write-behind copy of `weave.state`.

## A changed record must be marked

`Store.save` writes two kinds of data in different ways.

- Workspace settings, spaces, tables and automations are compared as JSON
  strings against the last strings the store wrote or read. A changed string
  is written and a missing id is deleted. You need do nothing beyond changing
  the object.
- Records (`state.entities`) are written only when their id is in the
  engine's dirty set. A verb that changes a record calls `#mark(record)` and
  then `save()`. A record changed without `#mark` looks right until the
  process restarts or reloads, then reverts. No test fails unless one checks
  the reopened file.

`#dirtyAll` makes the next save rewrite every record. It is set only when a
whole state is swapped in, as when a workspace is detached into its own file.
Do not use it to cover a missing `#mark`.

## One save per call

`save()` inside `#oneSave(fn)` does not write. It records that a save is owed,
and the outermost `#oneSave` writes once when `fn` returns. Opening a
workspace, `addField`, `addRelation`, `duplicateTable`, `build` and
`applySchema` run inside it, on both the member and the hub in hub mode
(Issue #1627). A new verb that saves in a loop belongs inside it too.

Each save runs in `store.batch`, one `BEGIN IMMEDIATE` transaction: queued
undo entries, file storage rows, document revisions and the state write
commit together. If any of them throws, the transaction rolls back, the store
reloads the file, and the engine adopts what was loaded, so memory never
holds a change the file lost.

## Another process may have written

The CLI, `weave mcp` and a second server can all open the same `.db`.
`changedExternally()` compares SQLite's `PRAGMA data_version` with the value
seen last. `maybeRefresh()` asks it and, when the file moved, reloads. A
trigger on `entities` appends every changed record id to the `changes`
journal, so the reload reads only the records changed since this process last
looked. The journal keeps the last `JOURNAL_CAP` rows; if this process fell
further behind than that, the reload reads the whole file.

The HTTP handler in `src/routes.js` calls `maybeRefresh()` once per request,
after it picks the workspace, and the MCP server calls it before each tool.
The hub's `list()` and `entries()` refresh every open workspace. A new entry
point that reads `weave.state` without passing through one of these serves
stale data.

## Logs with caps

- Undo keeps the last `UNDO_CAP` entries per actor in `undo_log`.
- Document history keeps the last `DOC_REVISION_CAP` revisions per record and
  document field in `doc_revisions`. Each revision is the full text, not a
  diff, so a long document edited often holds up to that many copies.
- `audit_log` has no cap.

A `Store` with no path (an in-memory workspace, as most tests create) keeps
audit, undo, revisions and file storage in arrays and maps on the store, with
the same caps.

## Attachment bytes

File bytes live in `files/<id>` beside the `.db` files, and every workspace in
the data directory shares that folder. `writeFileDurable` writes each one to
`<path>.<uuid>.tmp`, flushes it, renames it into place and syncs the folder,
so a crash leaves either the whole file or a `.tmp` file. An in-memory
workspace keeps bytes as base64 in `state.fileBlobs` instead.

Before it deletes a file, the engine checks `siblingNames(id)`: if any other
`.db` in the folder mentions the id, or a sibling cannot be read, the file
stays. A change that moves workspaces between folders has to keep this check
true.

## Backup and restore

`weave backup` copies each `.db` with `VACUUM INTO` from its own connection,
which is safe while the server writes. It skips `.tmp` files in `files/`, and
writes a tar archive whose `manifest.json` carries the format
`weave-backup/1`, a sha256 per entry and the workspace counts. The Handbook
guide "Backup and restore" covers the commands and flags.

Two rules for operators:

- Never copy a live `.db` with `cp`. The copy can tear between the file and
  its `-wal`. Use `weave backup`.
- Stop the server before a restore. `restore` refuses a data directory whose
  `.db` a running process holds (`heldOpen`), and `--force` does not override
  that.

## Where each rule lives

| Symbol | File | Value |
| --- | --- | --- |
| `#mark` | `src/engine.js` | |
| `#dirtyAll` | `src/engine.js` | |
| `#oneSave` | `src/engine.js` | |
| `maybeRefresh` | `src/engine.js` | |
| `changedExternally` | `src/store.js` | |
| `PRAGMA data_version` | `src/store.js` | |
| `JOURNAL_CAP` | `src/store.js` | 1000 |
| `UNDO_CAP` | `src/store.js` | 200 |
| `DOC_REVISION_CAP` | `src/store.js` | 200 |
| `writeFileDurable` | `src/store.js` | |
| `siblingNames` | `src/store.js` | |
| `VACUUM INTO` | `src/backup.js` | |
| `'weave-backup/1'` | `src/backup.js` | |
| `.endsWith('.tmp')` | `src/backup.js` | |
| `heldOpen` | `src/backup.js` | |
| `maybeRefresh` | `src/routes.js` | |
| `maybeRefresh` | `src/mcp.js` | |
