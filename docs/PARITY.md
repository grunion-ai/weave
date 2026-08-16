# Weave ↔ Fibery feature parity matrix

Scope: Fibery's core work-platform feature set as of 2026 — the features a team actually uses to model and run work. Enterprise/SaaS-only concerns (SSO, billing, hosted infra) are out of scope for a local tool and not counted.

Legend: ✅ implemented & tested · 🟡 partial · ❌ not built

## Structure & schema

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Workspaces | ✅ | one JSON file per workspace; `--data` switches |
| 2 | Spaces | ✅ | CRUD, cascade delete |
| 3 | Databases (types) | ✅ | CRUD, qualified `Space/Name` addressing |
| 4 | Auto public IDs | ✅ | per-database counters, `Db#n` refs everywhere |
| 5 | Name field | ✅ | auto-created, protected |
| 6 | Created/updated timestamps | ✅ | queryable |
| 7 | Schema introspection API | ✅ | `describeSchema` / `GET /api/schema` / MCP tool |
| 8 | Field add/rename/delete with cascades | ✅ | paired relation ends + dependent computeds cleaned up |

## Field types

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 9 | Text | ✅ | |
| 10 | Number | ✅ | validated |
| 11 | Date | ✅ | validated |
| 12 | Date range | ✅ | `{start, end}` |
| 13 | Checkbox | ✅ | |
| 14 | URL | ✅ | |
| 15 | Email | ✅ | format-validated |
| 16 | Single-select | ✅ | options with colors |
| 17 | Multi-select | ✅ | |
| 18 | Workflow (multistate) | ✅ | categories not-started/in-progress/done/canceled, default state, transition log |
| 19 | Relation many-to-one | ✅ | bidirectional, reassignment steals correctly |
| 20 | Relation one-to-many | ✅ | |
| 21 | Relation many-to-many | ✅ | |
| 22 | Relation one-to-one | ✅ | |
| 23 | Auto inverse relation fields | ✅ | created in one call, Fibery-style |
| 24 | Lookup fields | ✅ | through any relation, incl. computed targets |
| 25 | Rollup / aggregations | ✅ | count, sum, avg, min, max, join |
| 26 | Formula fields | ✅ | arithmetic, logic, 17 functions, safe parser |
| 27 | Assignees / people | 🟡 | pattern via relation to a Person database (no built-in user objects) |
| 28 | Files & attachments | ✅ | upload (base64 API/MCP), disk blobs, serve with mime |
| 29 | Avatars/icons on entities | ❌ | |

## Documents & collaboration

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 30 | Rich-text document per entity | ✅ | markdown source of truth |
| 31 | Native HTML document view | ✅ | standalone styled page, dark-mode aware |
| 32 | Native PDF document export | ✅ | in-tree PDF writer, US Letter, multipage |
| 33 | Native raw MD view | ✅ | `text/markdown` |
| 34 | Entity mentions in documents | ✅ | `[[Db#id]]` → resolved live links |
| 35 | Comments | ✅ | per entity, CRUD |
| 36 | Activity history | ✅ | creates, field/state/relation changes, automations |
| 37 | Real-time co-editing | ❌ | single-user local tool by design |
| 38 | Granular permissions | ❌ | local single-user by design |

## Views

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 39 | Table view | ✅ | all field types incl. computed, client sort |
| 40 | Board / kanban | ✅ | grouped by workflow/select, drag-and-drop moves state |
| 41 | List view | ✅ | |
| 42 | Entity page | ✅ | inline editing, linking, doc editor, comments, activity |
| 43 | Sorting | ✅ | API + UI |
| 44 | Filtering | 🟡 | full API/CLI/MCP filter language (relation traversal, and/or); no filter builder UI |
| 45 | Calendar view | ❌ | |
| 46 | Timeline / Gantt | ❌ | |
| 47 | Whiteboards | ❌ | |
| 48 | Reports / charts | ❌ | |
| 49 | Forms | ❌ | |

## Automation, API & data

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 50 | Automation rules (trigger → actions) | ✅ | entity-created, field-updated, state-changed(+target) |
| 51 | Action templating | ✅ | `{{Field}}`, `{{Today}}`, `{{PublicId}}` |
| 52 | Outgoing webhooks | ✅ | automation action, fire-and-forget JSON POST |
| 53 | REST API | ✅ | full surface, honest status codes, CORS |
| 54 | Query language w/ relation traversal | ✅ | dotted paths, and/or, 10 operators, select/sort/paginate |
| 55 | Full-text search | ✅ | names, docs, comments; ranked with snippets |
| 56 | CSV export | ✅ | display values, proper quoting |
| 57 | CSV import | ✅ | typed coercion, atomic rows, error report |
| 58 | JSON backup / restore | ✅ | whole workspace |
| 59 | CLI | ✅ | 20+ commands (Fibery itself has no official CLI) |
| 60 | MCP server for agents | ✅ | 23 tools, stdio JSON-RPC, tested handshake |
| 61 | External integrations (Slack/GitHub/Jira sync) | ❌ | webhooks are the escape hatch |
| 62 | AI assist features | ❌ | agent-accessibility (MCP/CLI/REST) is the substitute |

## Score

- ✅ full: **49**
- 🟡 partial (×0.5): **2** → 1.0
- Total counted features: **62**

**Parity: (49 + 1.0) / 62 = 80.6%** ✔ (target: 80%)

The missing 19.4% is concentrated in multi-user SaaS concerns (permissions, real-time, integrations) and secondary view types (calendar, timeline, whiteboard, charts) — deliberate non-goals for a local-first, agent-oriented tool at v0.1.
