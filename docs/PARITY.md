# Weave ↔ Fibery feature parity matrix

Scope: Fibery's core work-platform feature set, the features a team uses to model and run work. Billing and hosted infrastructure are out of scope and not counted. Re-scored against v0.4.63 on 2026-10-03; `test/docs-drift.test.mjs` recomputes the score from the table, so a row that changes moves the total with it.

Legend: ✅ implemented & tested · 🟡 partial · ❌ not built

## Structure & schema

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Workspaces | ✅ | one SQLite `.db` per workspace; one server hosts many at `/w/<name>/` |
| 2 | Spaces | ✅ | CRUD, cascade delete, restore from trash |
| 3 | Databases (types) | ✅ | CRUD, qualified `Space/Name` addressing, move and duplicate |
| 4 | Auto public IDs | ✅ | per-database counters, `Db#n` refs everywhere |
| 5 | Name field | ✅ | auto-created, protected |
| 6 | Created/updated timestamps | ✅ | queryable; `Created By` and `Modified By` on request |
| 7 | Schema introspection API | ✅ | `describeSchema` / `GET /api/schema` / `weave_schema` |
| 8 | Field add/rename/delete with cascades | ✅ | paired relation ends + dependent computeds cleaned up |

## Field types

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 9 | Text | ✅ | |
| 10 | Number | ✅ | formats, units, currency; bar, ring or heat display |
| 11 | Date | ✅ | year, month or day grain; optional time and zone |
| 12 | Date range | ✅ | `{start, end}`, optional elapsed span |
| 13 | Checkbox | ✅ | a toggle type with named states as well |
| 14 | URL | ✅ | |
| 15 | Email | ✅ | format-validated |
| 16 | Single-select | ✅ | options from a ten-hue palette |
| 17 | Multi-select | ✅ | |
| 18 | Workflow (multistate) | ✅ | categories not-started/in-progress/done/canceled, default state, transition log |
| 19 | Relation many-to-one | ✅ | bidirectional, reassignment steals correctly |
| 20 | Relation one-to-many | ✅ | |
| 21 | Relation many-to-many | ✅ | |
| 22 | Relation one-to-one | ✅ | |
| 23 | Auto inverse relation fields | ✅ | created in one call, Fibery-style |
| 24 | Lookup fields | ✅ | through any relation, incl. computed targets |
| 25 | Rollup / aggregations | ✅ | 12 aggregates: count, sum, avg, min, max, join, median, stdev, distinct, filled, empty, range |
| 26 | Formula fields | ✅ | 23 functions, safe parser, live check before save |
| 27 | Assignees / people | 🟡 | accounts exist, but a person field is a relation to a Person table; no field type binds to accounts |
| 28 | Files & attachments | ✅ | upload (base64 API/MCP), disk blobs, serve with mime |
| 29 | Avatars/icons on entities | 🟡 | icons on spaces and tables; rows carry none |

## Documents & collaboration

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 30 | Rich-text document per entity | ✅ | any number of documents per entity, markdown, HTML or code |
| 31 | Native HTML document view | ✅ | standalone styled page, dark-mode aware |
| 32 | Native PDF document export | ✅ | in-tree PDF writer, US Letter, multipage |
| 33 | Native raw MD view | ✅ | `text/markdown` |
| 34 | Entity mentions in documents | ✅ | `[[Db#id]]` → resolved live chips |
| 35 | Comments | ✅ | per entity, CRUD; observers may comment |
| 36 | Activity history | ✅ | creates, field/state/relation changes, automations; undo and field rollback |
| 37 | Real-time co-editing | ❌ | each request reads the latest write; nothing pushes changes to an open page |
| 38 | Granular permissions | 🟡 | three roles per workspace (observer, editor, architect) and `require-auth`; no per-space, per-row or per-field rules |

## Views

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 39 | Table view | ✅ | all field types incl. computed, in-place cell editing, sort |
| 40 | Board / kanban | ❌ | removed in Issue #75 |
| 41 | List view | ❌ | removed before the board |
| 42 | Entity page | ✅ | docked beside the table or full page; fields, documents, comments, activity |
| 43 | Sorting | ✅ | API + UI |
| 44 | Filtering | ✅ | the Filters popover in the UI (Issues #319, #448); API/CLI/MCP filter language with relation traversal and and/or |
| 45 | Calendar view | ❌ | |
| 46 | Timeline / Gantt | ❌ | |
| 47 | Whiteboards | ❌ | |
| 48 | Reports / charts | ❌ | number displays and sparklines live in cells; no chart view |
| 49 | Forms | ❌ | |

## Automation, API & data

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 50 | Automation rules (trigger → actions) | ✅ | entity-created, field-updated, state-changed (with target state) |
| 51 | Action templating | ✅ | `{{Field}}`, `{{Today}}`, `{{PublicId}}` |
| 52 | Outgoing webhooks | ✅ | automation action, fire-and-forget JSON POST |
| 53 | REST API | ✅ | full surface, honest status codes, CORS |
| 54 | Query language w/ relation traversal | ✅ | dotted paths, and/or, select/sort/paginate |
| 55 | Full-text search | ✅ | SQLite FTS5 over names, documents and comments; ranked with snippets |
| 56 | CSV export | ✅ | display values, proper quoting |
| 57 | CSV import | ✅ | typed coercion, atomic rows, error report |
| 58 | JSON backup / restore | ✅ | JSON export and import, plus `weave backup`: one sealed tar of every workspace, attachments and keystore |
| 59 | CLI | ✅ | the whole surface; Fibery itself has no official CLI |
| 60 | MCP server for agents | ✅ | 58 tools over stdio or HTTP, 16 listed by default |
| 61 | External integrations (Slack/GitHub/Jira sync) | ❌ | webhooks and the REST API are the escape hatch |
| 62 | AI assist features | ❌ | MCP, CLI and REST access for your own agent instead |

## Score

- ✅ full: **49**
- 🟡 partial (×0.5): **3** → 1.5
- Total counted features: **62**

**Parity: (49 + 1.5) / 62 = 81.5%** (target: 80%)

Most of the missing 18.5% sits in two groups. Collaboration: real-time co-editing, fine-grained permissions and connector integrations. Secondary views: board, list, calendar, timeline, whiteboard, charts and forms.

## Outside the matrix

weave ships field types this list does not score: rating, toggle, numbers drawn as bars, rings or heat, formula sparklines, credential (`key`) fields, and document fields of a declared kind. The Handbook's field reference (**Handbook → Fields** on any instance) describes each one.
