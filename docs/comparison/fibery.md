# weave vs Fibery — a self-hosted, open-source alternative

Of the tools weave is compared to, [Fibery](https://fibery.io) is the closest
model: connected databases across spaces, documents attached to entities,
workflow states, lookups and rollups, automations, and a relation graph over the
whole thing. [weave](https://github.com/grunion-ai/weave) implements that model
as an MIT-licensed program you run yourself, against a single SQLite file.

The [feature parity matrix](../PARITY.md) scores weave against Fibery's core
work-platform feature set feature by feature — **80.6%** at last count, with the
gap concentrated in multi-user SaaS concerns and secondary view types. This page
is the narrative version.

*Fibery's product as described here reflects August 2026 — check fibery.io for
current details.*

## Concept mapping

| Fibery | weave | Notes |
| --- | --- | --- |
| Workspace | Workspace | One `.db` file; a server can host several, switched from the icon rail. |
| Space | Space | Same idea: a named grouping of databases. |
| Database (type) | Table | Addressed as `Space/Table`. |
| Entity | Entity | Per-table public ids — `Task#12` — usable as refs everywhere. |
| Public id / `Db#n` refs | Same, everywhere | In the UI, API, CLI, documents, and agent tool calls. |
| Rich-text field | Document field | Markdown is the source of truth, and an entity may carry several. |
| Entity mentions `[[…]]` | `[[Table#12]]` | Resolved to live links when documents render. |
| Relations (all four cardinalities) | Relations | Bidirectional, with the inverse field created in one call. |
| Lookups | Lookups | Through any relation, including onto computed fields. |
| Formulas | Formulas | Arithmetic, logic, 17 functions, safe parser — no sandboxed scripting. |
| Workflow / multistate | Workflow field | Categories, default state, transition log. |
| Rules / automations | Automations | created / field changed / state changed → set field, append doc, comment, webhook. |
| Comments & activity | Comments & activity | Per entity, including automation-driven changes. |
| Table / board / list views | Same | Board columns are workflow states. |
| Relation diagram | Relation map | Tables, cardinalities, and the automation layer in one picture. |
| Whiteboards, Timeline, Calendar, Reports | — | Not built. |
| Forms, Portals | — | Not built. |
| Users, permissions, guest access | — | Not built — weave has no accounts. |
| Integrations (Jira, GitHub, Slack…) | Webhooks + REST | Outbound webhooks and a full REST API; no connector catalog. |
| AI assistant | MCP server | Agent-accessibility instead of built-in AI features. |

## Where weave wins

- **Self-hosted and yours.** The workspace is a SQLite file on disk. No vendor
  holds the export button, and there is no per-user bill.
- **An official CLI.** Fibery has no first-party CLI; weave's covers the whole
  surface — schema, entities, documents, search, import/export.
- **An MCP server in the box.** 23 tools including schema design, so an agent
  can create spaces, tables, relations, and automations, not just rows.
- **Documents as plain URLs.** `/e/Task#12/doc.md`, `.html`, `.pdf` render
  directly, with Mermaid diagrams in place and a whole-entity export that
  paginates one page per document.
- **Runs anywhere, offline, with nothing to install.** No Docker, no database
  server, no npm install, no build step. Node ≥ 22.16 and `git clone`.

## Where Fibery wins

- **It is a product, with users.** Accounts, per-user and per-space permissions,
  guest access, sharing, real-time collaboration. weave has none of this; anyone
  who reaches the port is an admin of every workspace.
- **View types.** Whiteboards, timeline/Gantt, calendar, and reports/charts —
  none of which weave has.
- **Forms and portals** for collecting work from outside the tool.
- **Integrations.** A catalog of two-way syncs versus outbound webhooks you wire
  yourself.
- **Scale and support.** A hosted service with an SLA, backups, and a team
  behind it, versus a young project and your own systemd unit.

## Who should switch

weave is a reasonable move if you are one person or a small trusted group, your
Fibery use is mostly connected databases with documents and automations, and you
want the data local — especially if agents do a meaningful share of the reading
and writing.

It is the wrong move if you depend on permissions, whiteboards, timelines,
reports, forms, or two-way integrations. Those are non-goals of a local-first
tool, not near-term roadmap items.

## Migrating

Fibery exports to CSV per database. Recreate the spaces and tables in weave
(UI, CLI, or by handing an agent the MCP server and the exported headers), load
rows with `import` / `weave_import_csv`, then rebuild relations, lookups,
rollups, and formulas on top. Rich-text fields come across as markdown into
document fields.

## See also

- [Feature parity matrix](../PARITY.md) — the scored, feature-by-feature version
- [weave vs Airtable](airtable.md)
- [weave vs other open-source alternatives](alternatives.md)
