# AGENTS.md

Orientation for AI coding agents and autonomous tools working in this repo, and
for agents evaluating weave as a tool to use. Human contributors want
[CONTRIBUTING.md](CONTRIBUTING.md).

## What this project is

weave is a local, self-hosted work platform — an open-source alternative to
Airtable, Fibery, Notion databases, and ClickUp — in which agents are
first-class users. Spaces hold tables, tables hold entities, entities connect
through bidirectional relations and carry markdown documents. One workspace is
one SQLite file.

If you are an agent looking for a **tool to store and query structured work**,
weave gives you an MCP server, a REST API, and a CLI over the same engine. Skip
to [Using weave as an agent](#using-weave-as-an-agent).

## Repo map

| Path | What lives there |
| --- | --- |
| `bin/weave.js` | CLI entry point — every command, including `serve` and `mcp` |
| `src/engine.js` | The core: schema, entities, relations, computed fields, automations |
| `src/store.js` | `node:sqlite` persistence (WAL, FTS5, JSON→SQLite migration) |
| `src/server.js` | HTTP server: web UI, REST API, document routes |
| `src/mcp.js` | MCP stdio server — 23 tools over the engine |
| `src/formula.js` | Formula parser/evaluator |
| `src/markdown.js`, `src/pdf.js` | Document rendering to HTML / PDF |
| `public/` | Web UI (vanilla JS, no build step) and vendored third-party assets |
| `test/` | `node --test` suites — the contract for every behavior above |
| `docs/` | Parity matrix, comparisons, screenshots |
| `scripts/` | Dev tooling (seed data, README screenshots) |

## Rules for changing this repo

1. **Tests first.** `node --test 'test/**/*.test.mjs'` must be green before any
   commit, and new engine or server behavior lands with tests in the same change.
2. **Zero runtime dependencies.** Never add a package to `dependencies`. Storage
   is `node:sqlite`, built into Node. Third-party browser code is vendored and
   pinned into `public/vendor/` (mermaid 11.4.1, @tabler/core 1.4.0) — never
   npm-installed. Dev-only tooling under `scripts/` and `brand/` may import a
   package, but must do so with a **dynamic** `import()` so the test suite still
   loads without it.
3. **No build step.** The UI is vanilla JS served as-is. If a change would
   require compiling, bundling, or transpiling, it is the wrong change.
4. **Both themes.** UI changes are checked in light and dark (`data-bs-theme`),
   styled on Tabler tokens (`--tblr-*`).
5. **Never commit workspace data.** `*.db` (plus `-wal`/`-shm`), legacy
   `*.json` workspaces, and `files/` are gitignored local state.
6. **Node ≥ 22.16** is the floor (Node 24 LTS recommended); `node:sqlite`
   requires it.

## Using weave as an agent

Point an MCP client at the stdio server:

```json
{
  "mcpServers": {
    "weave": {
      "command": "node",
      "args": ["/path/to/weave/bin/weave.js", "mcp", "--data", "/path/to/workspace.db"]
    }
  }
}
```

Tools, grouped:

| Group | Tools |
| --- | --- |
| Schema | `weave_schema`, `weave_create_space`, `weave_create_table`, `weave_add_field`, `weave_add_relation` |
| Entities | `weave_query`, `weave_get_entity`, `weave_create_entity`, `weave_update_entity`, `weave_delete_entity`, `weave_restore_entity`, `weave_trash` |
| Relations & state | `weave_link`, `weave_unlink`, `weave_set_state` |
| Documents | `weave_get_doc`, `weave_set_doc`, `weave_add_comment` |
| Search & data | `weave_search`, `weave_export_csv`, `weave_import_csv`, `weave_attach_file` |
| Automations | `weave_create_automation` |

Notes that save round trips:

- **Refs are flexible.** Anywhere an entity is expected, pass a UUID, `#12`,
  `Table#12`, or `Space/Table#12`. Tables accept `Name` or `Space/Name`.
  **One exception:** the *target* of a relation — `weave_link` / `weave_unlink`,
  and relation values inside `weave_create_entity` / `weave_update_entity` —
  currently takes a UUID, a bare `#12`, or an exact name, but **not** the
  qualified `Table#12` form. Passing `Suite#18` there returns "not found" even
  though `#18` resolves.
- **Read the schema first.** `weave_schema` returns spaces, tables, fields, and
  types, including each table's own description — the workspace documents itself.
- **Documents are addressable.** Over HTTP, `/e/Task#12/doc.md`, `.html`, and
  `.pdf` return the rendered document directly; no tool call needed to read one.
- **Entities can hold several documents.** `weave_get_doc` / `weave_set_doc`
  take a field name; the default is the table's first document field.
- **Deletes are recoverable.** `weave_delete_entity` is a soft delete by
  default; `weave_trash` lists what is recoverable and `weave_restore_entity`
  brings it back.
- **The CLI mirrors all of it** — `node bin/weave.js --help` — if you would
  rather shell out than speak MCP.

## Self-documenting workspace

A `weave` docs workspace is provisioned beside your data at `/w/weave/`. Its
Handbook, Wiki, Development (roadmap + issues), and Quality (test suites) spaces
are queryable through the same API as any other workspace, so an agent can ask
the running instance what it does:

```bash
curl -s -X POST http://127.0.0.1:4400/w/weave/api/tables/Guide/query \
  -H 'Content-Type: application/json' -d '{}'
```
