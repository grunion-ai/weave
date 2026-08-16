# weave vs Airtable — an open-source, self-hosted alternative

[weave](https://github.com/grunion-ai/weave) is a local-first, MIT-licensed work
platform: connected tables, relations, workflows, formulas, rollups, and
markdown documents on every record, in a single SQLite file you own. This page
maps Airtable's concepts onto weave's, and is honest about what is missing.

*Airtable's product and pricing as described here reflect August 2026 — check
airtable.com for current terms.*

## Concept mapping

| Airtable | weave | Notes |
| --- | --- | --- |
| Workspace | Workspace | One `.db` file. A server can host several side by side, switched from the icon rail. |
| Base | Space | Spaces group tables. A workspace holds many. |
| Table | Table | Qualified as `Space/Table` when names collide. |
| Record | Entity | Every entity gets a per-table public id — `Task#12` — usable as a ref anywhere. |
| Field | Field | See the field-type table below. |
| Grid view | Table view | Inline editing on every cell. |
| Kanban view | Board view | Columns are workflow states. |
| Gallery / list | List view | |
| Linked record | Relation | Bidirectional and real — the inverse field is created and maintained for you. |
| Lookup | Lookup | Pull a field across a relation. |
| Rollup | Rollup | Aggregate across a relation. |
| Formula | Formula | Computed from other fields in the row. |
| Long text / rich text | Document field | Full markdown, and **any number per entity** — not one notes field. |
| Attachments | File attachments | Stored in a `files/` directory beside the workspace. |
| Automations | Automations | Trigger on created / field changed / state changed → set field, append doc, add comment, POST a webhook. |
| Interfaces | — | Not built. |
| Forms | — | Not built. |
| Sync / integrations | Webhooks + REST + CSV | Outbound webhooks and a full REST API; no prebuilt connector catalog. |
| Collaborators & permissions | — | Not built. weave has no accounts at all — see below. |

## Field types

weave implements text, number, date, date range, checkbox, url, email, select,
multiselect, workflow state, relation, lookup, rollup, formula, and document.

Airtable types with no weave equivalent today: rating, duration, barcode,
button, user, currency and percent as distinct types (use number), and the
AI-generated field types.

## Where weave wins

- **You own the file.** A workspace is one SQLite file on your disk. Open it
  with `sqlite3`, back it up with `cp`, put it next to the project it describes.
  No export button to be held hostage by, and no row caps other than your disk.
- **No per-seat bill.** It is a repository. Clone it.
- **Documents are first class.** Every entity carries as many markdown documents
  as you want, each addressable as a URL: `/e/Task#12/doc.md`, `.html`, `.pdf`.
  Mermaid diagrams render in place. Airtable's long-text field is not this.
- **Agents are first-class users.** A built-in MCP server exposes 23 tools —
  including schema design, not just record CRUD — alongside the REST API and a
  scriptable CLI, all over the same engine. An agent can create the space, the
  tables, the relations, and the automations, then fill them.
- **It runs offline**, with no telemetry and no account.
- **Nothing to install.** No Docker, no Postgres, no npm install, no build step.
  Node ≥ 22.16 and `git clone`.

## Where Airtable wins

- **Permissions and collaboration.** weave has no authentication and no per-user
  permissions at all. Everyone who reaches the port is an admin of every
  workspace. That is a design position, not a roadmap gap you can wait out
  today.
- **Interfaces and forms.** Airtable's app-builder and form surfaces have no
  counterpart in weave.
- **The marketplace.** Hundreds of prebuilt integrations and extensions versus
  outbound webhooks and an API you wire up yourself.
- **Maturity.** Airtable has been hardened by a decade of production use across
  a huge install base. weave is young, and backed by its test suite rather than
  by that mileage.
- **Mobile apps, realtime multiplayer cursors, revision history at record level.**

## Migrating

There is no one-click importer. The practical path:

1. Export each Airtable table as CSV.
2. Create the space and tables in weave — via the UI, the CLI (`table create`,
   `field add`, `relation add`), or by handing an agent the MCP server and the
   CSV headers.
3. `node bin/weave.js import` or the `weave_import_csv` MCP tool loads the rows.
4. Recreate linked records as relations, then lookups, rollups, and formulas on
   top.

Migrating *off* weave is the part worth checking before you commit:
`node bin/weave.js export --data <file>` writes the whole workspace as readable
JSON, `csv <table>` dumps any table, and the `.db` is standard SQLite.

## See also

- [weave vs Fibery](fibery.md)
- [weave vs other open-source alternatives](alternatives.md) — NocoDB, Baserow, Grist, Teable
- [Feature parity matrix](../PARITY.md)
