<p align="center">
  <img src="public/brand/weave-mark-light.svg" alt="weave" width="72">
</p>

<h1 align="center">weave</h1>

<p align="center">
  A local, open-source, <strong>agent-accessible</strong> work platform —
  tables, relations, workflows, formulas, and per-entity markdown documents,
  in the spirit of Fibery/Notion/Airtable, with zero runtime dependencies.
</p>

---

## Why

Work-management tools are built for humans first and APIs second. weave is built
for **humans and agents as equals**: everything the web UI can do, the REST API,
the CLI, and the MCP server can do too — same engine, same permissions, same
data file on your disk. No accounts, no cloud, no telemetry.

- **Local-first** — your workspace is one SQLite file next to your project.
- **Zero dependencies** — `git clone` and run. Storage is Node's built-in
  `node:sqlite`; the only third-party code is vendored and pinned.
- **Agent-native** — an MCP server, a scriptable CLI, `Table#12` refs
  everywhere, and markdown documents addressable as plain URLs
  (`/e/Task#12/doc.md`, `.html`, `.pdf`).

## Quickstart

Requires **Node ≥ 22.16** (Node 24 LTS recommended).

```bash
git clone https://github.com/grunion-ai/weave
cd weave
node bin/weave.js serve --port 4400 --data ./my-workspace.db
```

Open http://127.0.0.1:4400 — press **⌘K** to search everything. A
self-documenting **weave** docs workspace is provisioned alongside your data at
`/w/weave/`: handbook, wiki, the public issue tracker and roadmap, and a
Quality space mirroring the test suite.

## What's inside

| Area | Details |
| --- | --- |
| Data model | Spaces → tables → entities. Field types: text, number, date, date range, checkbox, url, email, select, multiselect, workflow states, bidirectional relations, lookups, rollups, formulas, and any number of markdown document fields per entity. |
| Views | Table, board, list, entity pages, a relation map with the automation layer drawn in, and per-space/table filtering. Inline editing everywhere. |
| Documents | Every doc is a native URL: `.md`, `.mmd`, `.html`, `.pdf`. Mermaid diagrams and raw HTML render in place; `[[Table#12]]` mentions resolve to links. Whole-entity export paginates one page per document. |
| Automations | Triggers (created / field changed / state changed) → set field, append doc, add comment, outgoing webhook. |
| Search | Universal ⌘K across workspaces with copyable permalinks, backed by a SQLite FTS5 index. |
| Storage | One workspace = one `.db` file (WAL, row-level writes, crash-safe). Legacy JSON workspaces migrate automatically; `exportJSON`/`importJSON` remain the human-readable interchange. CLI, server, and MCP can run concurrently. |
| Interfaces | Web UI (vanilla JS, no build step) · REST API · CLI (`bin/weave.js`) · MCP server (`weave mcp`). |

## Agents

```bash
# REST
curl -s localhost:4400/api/tables/Task/query -X POST -d '{"where":[["Status","=","Open"]]}'

# CLI
node bin/weave.js query Task --where '[["Status","=","Open"]]' --data ./my-workspace.db

# MCP (stdio)
node bin/weave.js mcp --data ./my-workspace.db
```

Entity refs accept UUIDs, `#12`, `Table#12`, or `Space/Table#12` everywhere.

## Development

```bash
node --test 'test/**/*.test.mjs'
```

The test suite is mirrored as entities in the docs workspace (Quality space),
and the roadmap + issue tracker live there too (`/w/weave/`) — the tool tracks
its own development.

## Third-party (vendored, pinned)

- [mermaid](https://github.com/mermaid-js/mermaid) 11.4.1 — MIT © Knut Sveidqvist & contributors
- [@tabler/core](https://github.com/tabler/tabler) 1.4.0 — MIT © Paweł Kuna & The Tabler Authors

## Security notes

The server binds `127.0.0.1` and has no authentication — it is a personal,
local tool. Documents may contain raw HTML that renders same-origin. Do not
expose the port publicly.

## License

MIT — see [LICENSE](LICENSE).
