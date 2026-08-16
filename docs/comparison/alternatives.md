# Open-source Airtable alternatives compared

If you are looking for a self-hosted, open-source alternative to Airtable,
Fibery, Notion databases, or ClickUp, there are several good ones. This page is
about where [weave](https://github.com/grunion-ai/weave) fits among them — and
where it does not.

*Licenses and packaging as of August 2026. Every project here moves; check each
repository for current terms.*

## At a glance

| | **weave** | [NocoDB](https://github.com/nocodb/nocodb) | [Baserow](https://github.com/baserow/baserow) | [Grist](https://github.com/gristlabs/grist-core) | [Teable](https://github.com/teableio/teable) |
| --- | --- | --- | --- | --- | --- |
| License | MIT | Sustainable Use License (since v0.301.0) | MIT core, paid tiers separate | Apache-2.0 | AGPL-3.0 core |
| Install | `git clone` + Node | Docker + a database | Docker Compose + Postgres | Docker or Node | Docker + Postgres |
| Storage | One SQLite file per workspace | Your MySQL/Postgres/SQLite | Postgres | SQLite | Postgres |
| Runtime dependencies | None | Many | Many | Many | Many |
| Users & permissions | **None** | Yes | Yes | Yes | Yes |
| Hosted option | No | Yes | Yes | Yes | Yes |
| MCP server built in | Yes (23 tools) | Check upstream | Check upstream | Check upstream | Check upstream |
| Markdown documents per record | Yes, any number, as `.md`/`.html`/`.pdf` URLs | No | No | No | No |
| Formulas | Yes | Yes | Yes | Yes (Python, spreadsheet-grade) | Yes |
| Relations, lookups, rollups | Yes | Yes | Yes | Yes | Yes |

## What each one is actually for

**NocoDB** puts a smart-spreadsheet interface on a database you already have.
If your data lives in MySQL or Postgres and you want a no-code UI over it
without migrating, this is the one. Note the license change in v0.301.0 — self-hosting
for internal use is fine, but offering it as a service to third parties needs a
commercial license.

**Baserow** is the closest thing to a full open-source Airtable product:
permissions, a plugin architecture, form views, a hosted tier, and compliance
paperwork. If you are replacing Airtable for a team and need it to behave like a
product, start here.

**Grist** is the most serious about the *spreadsheet* half. Python formulas,
real data analysis, interactive widgets, and a thoughtful approach to
collaboration. If your workload is analytical rather than operational, Grist is
the strongest fit on this list.

**Teable** targets Postgres-native scale with an Airtable-shaped UI — the option
when you expect a lot of rows and want a real database underneath.

**weave** is the small one. It optimizes for three things the others do not
center: **agents as first-class users** (an MCP server exposing schema design,
not just CRUD, alongside REST and a CLI), **documents attached to records**
(many markdown documents per entity, each a real URL rendering to Markdown,
HTML, or PDF), and **disappearing into a repo** (no container, no database
server, no dependency tree — one Node process and one file you can commit next
to the project it describes).

## Choosing

Pick **Baserow, NocoDB, Grist, or Teable** if you need any of: multi-user
permissions, a hosted option, a plugin ecosystem, a mobile app, or the
confidence that comes from a large install base. These are mature projects and
weave is not competing with them on maturity.

Pick **weave** if you are one person or a small trusted group, you want the data
in a file you own with no infrastructure around it, your records want documents
attached to them, and you want an agent to be able to design and drive the
workspace as capably as a human can.

Read [what weave is not](https://github.com/grunion-ai/weave#what-weave-is-not) before you commit —
the absence of authentication is the deciding factor for most teams, and it is a
design position rather than a roadmap gap.

## See also

- [weave vs Airtable](airtable.md)
- [weave vs Fibery](fibery.md)
- [Feature parity matrix](../PARITY.md)
