# AGENTS.md

This file has two readers. An agent that uses weave as a tool for someone reads
[Using weave](#using-weave) and can usually stop there; [Reference](#reference)
holds the detail behind it. An agent that changes weave's own code reads
[Developing weave](#developing-weave). Human contributors want
[CONTRIBUTING.md](CONTRIBUTING.md).

## Using weave

weave is a self-hosted work platform in which agents are first-class users.
Workspaces hold spaces, spaces hold tables, and tables hold rows that link to
each other through relations and carry markdown documents. One workspace is one
SQLite file. The MCP server, the REST API, the CLI and the browser UI all run
the same engine over that file.

### Primer

The MCP server sends this text as its `initialize.instructions`, so an MCP
client reads it before its first call.

<!-- primer:start (generated from src/mcp-primer.md by scripts/agent-docs.mjs; edit that file, then run the script) -->
```text
weave: read the weave_ontology outline first. Build with ONE weave_build call (workspace, spaces, tables, fields, relations and rows; its description shows the spec). Run it with dryRun:true first, fix every error it lists, then run it for real. Its computed block samples every lookup, rollup and formula.
Rules for building in weave:
- One workspace per domain of life or work (personal-finance, sales), never one per request. Name it as a slug (letters, digits, dash) with the spec's workspace key. A request becomes a space; its records become tables with singular names.
- A value that names a row of another table is a relation, never text: a field {name, type:"relation", to:<table>, cardinality:"many-to-one"}. In rows, a relation value is the target row's Name.
- Money is a number field with format:"currency" and currency:"USD". A date field takes grain as a list of parts: ["year","month"] for a month, ["year"] for a year.
- Colour carries meaning: options stay slate unless the hue says something (green income, red overdue). An option is {name, hue, icon}; status options and workflow states take an icon.
- Icons are lucide:<name> from the inventory. Most builds need no weave_vocabulary call: weave_build lists a refused icon or colour under ignored, with the nearest icons. To look things up, ask for every list in one call: weave_vocabulary {sections:["icons","optionColors"], query:"<word>"}.
- A build table takes fieldOrder, hidden and sort. A Sort is "Date desc", comma-separated for more keys.
- Writes answer compact ({id, publicId, name}); pass verbose:true for the full object.
- Read rows with weave_query (where, sort) and find a row by text with weave_search. weave_call {name, args} runs any tool not listed; weave_call {name:"help", args:{tool}} describes one.
```
<!-- primer:end -->

### Model

Workspace › space › table › row. A row has a Name, a public id (`Deal#12`) and
any number of markdown documents; its fields hold typed values (the types are
in `weave_vocabulary`).
A relation links rows of two tables and works both ways: adding `Deal.Company`
also adds `Company.Deals`, and a rollup over `Deals` totals them per company.

### Surfaces

| Surface | Start it | Pick it when |
| --- | --- | --- |
| MCP over stdio | `node bin/weave.js mcp --data <file.db>` (`weave mcp --data <file>`) | you are an MCP client and the workspace is a local file; the default |
| MCP over HTTP | `POST /api/mcp` on a running `weave serve`; `/mcp` with a sign-in provider | the workspace lives on a server, local or hosted |
| REST | `weave serve --data <file.db>`, then routes under `/w/<workspace>/api` (`/api` for the default workspace) | you are writing a script or service rather than making tool calls |
| CLI | `node bin/weave.js <command> --data <file.db>`; `weave build <spec.json> --dry-run` builds from a file | a shell is all you have, or the step belongs in a script |
| Browser UI | `weave serve`, then http://127.0.0.1:4400 | a person wants to see or edit the result |

Claude Code over stdio, in one line:

```bash
claude mcp add weave -- node /path/to/weave/bin/weave.js mcp --data /path/to/workspace.db
```

Other stdio clients take the same command as a config block
([README › Connect your agent](README.md#connect-your-agent)). A hosted
instance with a sign-in provider takes
`claude mcp add --scope user --transport http weave https://weave.example.com/mcp`;
the first call opens the sign-in in a browser. One MCP server serves one
workspace file; a second workspace is a second file (see
[One MCP server is one workspace](#the-cli-mirrors-all-of-it)).

### Tool map

<!-- tool-map:start (generated from src/mcp.js by scripts/agent-docs.mjs) -->
17 listed by default, out of 63. `weave mcp --tools all` or `WEAVE_MCP_TOOLS=all` lists every one.

| Job | Tool | What it does |
| --- | --- | --- |
| Build | `weave_build` | spaces, tables, fields, relations and rows in one call (dryRun checks) |
| Read and search | `weave_ontology` | short schema: outline, one table, changes |
|  | `weave_schema` | the full schema as JSON |
|  | `weave_query` | rows of one table, filtered (where), sorted, paged |
|  | `weave_get_entity` | one row in full: values, document, comments, activity |
|  | `weave_search` | find rows, tables and spaces by text; each hit has a permalink |
| Write rows | `weave_create_entity` | create one row |
|  | `weave_update_entity` | change one row's values |
|  | `weave_import_csv` | many rows into one table from CSV text |
| Change schema | `weave_create_space` | create a space |
|  | `weave_create_table` | create a table in a space |
|  | `weave_add_field` | add a field to a table |
|  | `weave_update_field` | rename, retype or reconfigure a field (options are a full replacement) |
|  | `weave_add_relation` | add a relation and its inverse between two tables |
|  | `weave_workspace` | read or rename the workspace, set its description or logo |
| Look up allowed values | `weave_vocabulary` | allowed values; several sections and icon queries in one call |
| Everything else | `weave_call` | run any other tool by name; help describes one |

The other 46, through `weave_call {name, args}`:

| Area | Tools |
| --- | --- |
| Rows | `weave_delete_entity`, `weave_restore_entity`, `weave_trash`, `weave_undo`, `weave_bulk`, `weave_set_state`, `weave_link`, `weave_unlink`, `weave_form_submit` |
| Documents and comments | `weave_get_doc`, `weave_set_doc`, `weave_doc_revisions`, `weave_doc_restore`, `weave_add_comment`, `weave_delete_comment` |
| Spaces and tables | `weave_update_space`, `weave_delete_space`, `weave_restore_space`, `weave_update_table`, `weave_move_table`, `weave_duplicate_table`, `weave_delete_table`, `weave_restore_table`, `weave_table_view` |
| Fields and formulas | `weave_rollback_field`, `weave_delete_field`, `weave_check_formula` |
| Whole schema | `weave_apply_schema`, `weave_registry`, `weave_relation_map` |
| Templates | `weave_template_list`, `weave_template_use` |
| Figures | `weave_stats` |
| Import and export | `weave_export_csv`, `weave_export_json`, `weave_import_json` |
| Files | `weave_attach_file`, `weave_files` |
| Automations | `weave_create_automation`, `weave_automations` |
| Share pages | `weave_views`, `weave_shares` |
| History | `weave_activity`, `weave_audit` |
| Accounts and secrets | `weave_accounts`, `weave_keys` |
<!-- tool-map:end -->

### Plans

A turn here is one tool call.

**Build a workspace: 3 turns.** Run `weave_build` with `dryRun: true`, fix
every entry in its `errors` list, run it again without `dryRun`, then answer
the user. Put every table, field, relation and starting row in the one spec.
Skip `weave_vocabulary`: the reply's `ignored` list names any refused icon or
colour, with the nearest icons, and `computed` samples each computed field.

```json
{"dryRun": true, "spec": {"workspace": "sales", "spaces": [{"name": "Pipeline", "icon": "lucide:briefcase", "tables": [
  {"name": "Company", "rows": [{"Name": "Acme"}]},
  {"name": "Deal", "fields": [
    {"name": "Value", "type": "number", "format": "currency", "currency": "USD"},
    {"name": "Stage", "type": "select", "options": [{"name": "Lead"}, {"name": "Won", "hue": "green"}, {"name": "Lost", "hue": "red"}]},
    {"name": "Closed", "type": "date", "grain": ["year", "month"]},
    {"name": "Company", "type": "relation", "to": "Company", "cardinality": "many-to-one"}],
   "rows": [{"Name": "Acme renewal", "Value": 12000, "Stage": "Won", "Closed": "2026-09", "Company": "Acme"}]}]}]}}
```

**Add rows to existing tables: 1 turn.** Send one `weave_build` whose spec
holds only the space, the tables and their rows; existing parts are reused and
`skipExistingRows: true` skips a Name the table already holds. For a CSV file,
`weave_import_csv` once per table.

```json
{"skipExistingRows": true, "spec": {"spaces": [{"name": "Pipeline", "tables": [
  {"name": "Deal", "rows": [{"Name": "Globex pilot", "Value": 4000, "Stage": "Lead", "Company": "Acme"}]}]}]}}
```

**Answer a question: 1 or 2 turns.** `weave_query` with `where` (conditions
are ANDed; a dotted path follows a relation). For a total per parent row, add
a rollup once (`weave_add_field` on Company with `type: "rollup"`,
`relationField: "Deals"`, `targetField: "Value"`, `aggregate: "sum"`); for a
whole column, `weave_call` runs `weave_stats {table}`.

```json
{"db": "Deal", "where": [["Company.Name", "=", "Acme"], ["Stage", "=", "Won"]], "select": ["Name", "Value"]}
```

**Change a field: 1 turn.** `weave_update_field`. `config.options` is a full
replacement, so send every option you keep; rows keep their values.

```json
{"db": "Deal", "field": "Stage", "config": {"options": [{"name": "Lead"}, {"name": "Qualified", "hue": "blue"}, {"name": "Won", "hue": "green"}, {"name": "Lost", "hue": "red"}]}}
```

**Find a row by text: 1 turn.** `weave_search` matches names, public ids, text
fields, documents and comments; every hit carries its id and permalink.

```json
{"query": "renewal", "limit": 5}
```

### Pitfalls

Each error below is the text weave returns, followed by the fix.

| Error | Fix |
| --- | --- |
| `Icon 'lucide:dolar' is not in the inventory; nearest: lucide:dollar-sign (money)` | Use a `nearest` name, or `weave_vocabulary {section: "icons", query: "<word>"}`. `weave_build` drops a refused icon, lists it under `ignored` and goes on. |
| `grain is a list of parts, e.g. ["year","month"] for a month or ["year"] for a year` | Send `"grain": ["year", "month"]`, never `"month"`. |
| `Workspace name must be alphanumeric` | Name the workspace as a slug: letters, digits and dashes, starting with a letter or digit (`personal-finance`). |
| `Field 'Stage' not found in table 'Deal'` | The field was never made because an earlier step failed. Read the build's `errors` (each has a `path` such as `spaces[0].tables[1].fields[2]`), fix that entry and resend the whole spec. |
| `Invalid number format 'currencyy' (number, currency, percent, compact)` | Pick a value the message lists. |
| `Field 'When' not found in table 'Transaction'. Sort reads 'Field asc\|desc, Field2 asc\|desc', e.g. 'Date desc'` (a `Sort` on a `Workspace/Tables` or `Workspace/Views` row) | Name a field the table has; `-Date` and `[{field, dir}]` land too (Issue #626). |
| `Table 'Deals' not found` | Use the name `weave_ontology` shows, as `Table` or `Space/Table`. Table names are singular. |

## Reference

The detail behind Using weave, one subsection per topic.

### Tool list and replies

`tools/list` names the default tools in the [Tool map](#tool-map); every other
tool is one `weave_call` away: `weave_call {name: "weave_set_doc", args: {entity, markdown}}`
runs it with the same gate, the same compact reply and the same `verbose`
switch as a direct call. The `weave_call` description lists each of those
tools with a few words, and `weave_call {name: "help", args: {tool: "weave_set_doc"}}`
returns that tool's full description and input schema. The full list costs
about 12,000 tokens on every turn and a build uses about twelve tools, so the
default lists only those (Issue #595). To list every tool directly, start the
server with `weave mcp --tools all` or set `WEAVE_MCP_TOOLS=all`; the variable
also applies to `POST /api/mcp` on `weave serve`. Every tool reaches something
the web UI can do; no configuration needs a browser or a human.

**Writes answer compact.** Over MCP, the create, update, link, unlink, state,
delete, restore, move and duplicate writes answer with `{id, publicId, name}`.
A field write adds its `type` and stored `config`, and `weave_add_relation`
answers `{field, inverse}` in the same shape. Pass `verbose: true` to any of
them for the whole row or table, or read it back with `weave_get_entity` or
`weave_schema`. Tool text is one-line JSON. REST and the CLI still return the
full object (Issue #596).

**Figures.** `weave_stats` summarises every column of a table in one read:
sum, avg, median, min, max, p25/p75, stdev and a histogram for numbers; a
ranked distribution for chips; earliest, latest and span for dates; the space
rollups pointed at the table; and per-group figures with `by`. To keep a
figure on the record, add a rollup on the `Workspace/Spaces` row with
`config.via` naming the table (`aggregate` from the vocabulary, optional
`where`); that is the Σ the grid footer draws under the column. A grid draws no
Σ row until the table asks for one: `weave_update_table` with
`hideRollups: false` (`weave table update <ref> --rollup-row on`) turns it on,
`true` puts it away.

### Build in one call

`weave_build` (`weave build <spec.json> [--dry-run]`, `POST /api/build`) stands
up a workspace outline in one call: spaces, tables, fields, relations and rows.
A field is `{name, type}` plus the config keys `weave_add_field` takes for that
type, written flat. A relation is a field with `type: "relation"` and `to`
naming the table, plus an optional `cardinality`. Lookups, rollups and formulas
may read relations made in the same build. A row is values by field name, and a
relation value is the target row's Name, so rows link to rows made in the same
call.

```json
{"workspace": "personal-finance", "spaces": [{"name": "Budget", "icon": "lucide:wallet", "tables": [
  {"name": "Account", "icon": "lucide:credit-card",
   "fields": [{"name": "Kind", "type": "select", "options": [{"name": "Credit card"}, {"name": "Checking"}]}],
   "rows": [{"Name": "Amex Gold", "Kind": "Credit card"}]},
  {"name": "Transaction",
   "fields": [{"name": "Amount", "type": "number", "format": "currency", "currency": "USD"},
              {"name": "Date", "type": "date"},
              {"name": "Account", "type": "relation", "to": "Account", "cardinality": "many-to-one"}],
   "rows": [{"Name": "Whole Foods", "Amount": 142.18, "Date": "2026-08-03", "Account": "Amex Gold"}]}]}]}
```

The build runs in this order: workspace name, spaces, tables, plain fields,
relations, lookups and rollups, formulas, rows, then the rows' relation values.
A space, table or same-typed field that already exists is reused and listed in
`existing`, so resending the whole spec after an error is safe. Rows append, so
a spec with only rows is a batch create; on a re-run, `skipExistingRows: true`
(`--skip-existing-rows`) skips a row whose Name the table already holds. An
icon outside the inventory or an option colour weave cannot name is dropped and
reported, never fatal. The reply is one line: `{ok, created: {spaces, tables,
fields, relations, rows}, existing, ignored, errors, computed}`. `ignored` holds `{path,
keys}` for config keys a field's type does not take, plus a `reason` for a
refused icon or colour; `errors` holds `{path, error}` with paths like
`spaces[0].tables[1].fields[2]`. The spec runs first, rows included, on an
in-memory copy of the workspace, so `dryRun: true` returns every error at once
and writes nothing, and a spec with any error writes nothing either. A step that
fails only because an earlier one did (a row value for a field that failed) is
not reported twice.

`computed` maps each lookup, rollup and formula the build made
(`"Budget/Category.Spending"`) to the first three values the grid shows for it,
so a rollup that sums to nothing or a formula that reads null is seen in the
reply, dry run included; an empty list means the table has no rows yet. A table
in the spec also takes its layout, applied to its default view after its fields
exist: `fieldOrder` names the leading columns (the rest keep their order, in the
schema too), `hidden` names columns to hide, and `sort` is `"Amount desc, Name"`
or `[{field, dir}]`. A bad name there is an error with its path, like any other.

### Configuration without a browser

A space and a table are born with everything they need: `weave_create_space`
and `weave_create_table` take `description` and `icon` alongside the name, so
standing one up is one call rather than a create followed by an update.

**Every field can say what it means.** `config.description` on `weave_add_field`
and `weave_update_field` (`weave field add … --description`, `--description null`
to clear) is plain text: what the value represents and how it is written —
`Who we bought from — the legal name on the invoice`. `weave_schema` emits it as
the field's `description`; read it before filling a row, and write one on every
column you create so the next agent has the same context a person gets under
the label on the entity page. The two view fields are the exception: on Chip and
Card, `description` is the description size (`none`, `small`, `medium`, `large`).

**Read `weave_vocabulary` before configuring anything.** It returns every
closed set a config value can come from *and what the choice looks like on
screen*: the eighteen field types with how each renders in the grid and which
config keys it takes, the eight option colors, the icon names (stored as `lucide:<name>`; a value stored as `iconly:<name>` before 2026-09-02 still resolves; anything else is refused — an emoji is not an icon), number
and date formats, document kinds, relation cardinalities, workflow state
categories, rollup aggregates, the system columns, the two view kinds, and the
column-width rules (60px floor, 260px cap when unset, a set width is a floor as
well as a ceiling). Guessing a color that validates still reads wrong.
`weave_vocabulary {section: "icons"}` returns that section alone, `{sections: ["icons", "optionColors", "formulaFunctions"]}` returns several keyed by name (REST `?section=icons,optionColors`, CLI `weave vocabulary icons,optionColors`), a comma list of queries searches several icon words at once, and `{section: "icons", query: "build"}` searches the icon names by name, category and synonym (REST `GET /api/vocabulary?section=icons&query=build`, CLI `weave vocabulary icons build`), so a guessed icon costs one small call, not the whole list. A refused icon names the three nearest inventory icons.

**The registry rows are the schema verbs.** `Workspace/Spaces`,
`Workspace/Tables` and `Workspace/Fields` are ordinary tables whose rows *are*
the spaces, tables and fields, so entity CRUD on them runs the same validation
as the schema verb — useful when you are already holding an entity tool. They
live once, at the weave root (the default workspace, served at `/`); a
`Workspace` column on every row names the workspace it describes, and a member
workspace's own `/w/<id>/api` answers for its rows:

| Change | Write |
| --- | --- |
| Rename a table, edit its description | `weave_update_entity` on `Workspace/Tables#n` → `Name`, `Description` |
| Reorder columns | same row → `Field Order`: every field name, comma-separated, exactly once |
| Hide a column | same row → `Hidden Fields` — the table's default view (data untouched); every view is also a `Workspace/Views` row: `Fields`, `Filter`, `Sort`, `Default`, `Position` |
| Rename a field | `weave_update_entity` on `Workspace/Fields#n` → `Name` |
| Reconfigure a field | same row → `Definition` = `{type, config: {…}}` — the type cannot change |
| Drop a field or table | `weave_delete_entity` on its registry row with `hard: true` |

The dedicated verbs (`weave_update_table`, `weave_update_field`, …) do the same
work with an argument list instead of a row, and reach the three settings the
registry has no column for: a table's `icon` and `noun`, and its `systemFields`.
`weave_registry` (`weave registry`, `GET /api/registry`) reports drift between
the rows and the structures they mirror; `action: rebuild` (`weave registry
rebuild`, `POST /api/registry/rebuild`) resyncs them, and counts as a schema
write for a capped token.

**A field's configuration keeps its history.** Every change to a field's
name or config (options, states, colours, formula, format, default,
description, type; the column width aside) is an Activity entry on its table,
kind `field-config-updated`, holding the definition before and after and a
`seq`, whichever door made it: the verb, the `Definition` on its registry
row, or `weave_apply_schema`. `weave_activity {entity: <table id>}` lists a
table's entries; the entry id is `<tableId>:f<n>`, and `PATCH
/api/tables/:t/fields/:f` returns the id it recorded as `activity`.
`weave_rollback_field {activity}` (`weave field rollback <table> <field>
--activity <id>`, `POST /api/tables/:t/fields/:f/rollback {activity}`) puts
the definition back and records an `undo` entry. It refuses when the field
changed after the entry. A type change keeps each row's value from before
it, so its roll back restores the definition and the values: a row edited
since keeps its edit, converted back, and a row made since is converted; the
answer and the undo entry count them as `restored`, `left` and `converted`.
Only a field's newest type change keeps its values; an older entry says
`snapshotDropped` and its roll back is refused. The feed and the audit log
show a snapshot as its row count only, and an export carries none. Removing
an option or a state leaves the rows' stored ids alone, so rolling it back
brings those values back. A roll back is a schema write, with the same rung.

**A schema document round-trips.** `weave_schema` out, edit, `weave_apply_schema`
back — with `dryRun` first for the plan. Everything the description emits
survives the apply, including option colors, column widths, icons, nouns,
hidden columns and column order. Omitted spaces, tables and fields are
deletions, which is why they need `allowDestructive`.

### Views over a table

A table has an ordered list of named views (Features #229, #237); the first is
the default and opens with the table. A new table's first view is named
`Standard` (tables made before 2026-09-27 had theirs renamed from `Default`),
and the UI offers `View 2`, `View 3` and so on for new ones. The toolbar button bearing the current
view name opens the list and its add, reset and clear actions. **Blank** — the
raw table, every regular field in schema order, no filter, no sort — remains
addressable through the API and old links. It is computed, never stored, and
read-only. One tool does all of it, addressed by name:

```
weave_table_view {view: "Issue/Open bugs", fields: ["Name", "Severity", "Status"], filters: {Status: ["Open"]}, sort: [{field: "Severity", dir: "desc"}]}
weave_table_view {view: "Issue/Open bugs", move: {field: "Status", before: "Name"}, default: true}
```

- `view: "Issue"` lists the views (names, the default flag, fields, filters,
  sort — never rows or field definitions); `"Issue/Open bugs"` reads one;
  `"Issue/blank"` reads Blank. A table id works in place of its name.
- Any other key writes, and a new name creates the view — from Blank, or
  from the view `from` names (the UI's Duplicate view). A write returns the
  resulting view, never the table.
- `fields` is the visible columns in order: listed shows, unlisted hides.
  `show` / `hide` take names and `move` takes `{field, before|after}` (or a
  list of them), so a wide table never has to be resent. `show` puts a field
  back where it was hidden from (its schema position when that neighbour is
  gone).
- `deleted: true` shows the trashed rows in place and `rollups` (`true`, `false`, or
  `null` to follow the table's `hideRollups`) draws or hides the Σ row; both are
  the view's own (Issue #442), like `density`.
- `widths` (`{Name: 240}`) sets column widths by name, merged into the
  view's; `null` clears one. `frozen` is how many leading fields stay frozen
  beside # (0, the default, freezes only #). A read carries either only
  when it is set (Feature #233).
- The system columns a view shows (`Created At`, `Modified At`,
  `Created By`, `Modified By`) are names in the same `fields` list: they
  `show`, `hide`, `move`, freeze and take `widths` like fields (Issue #418).
  `weave_update_table`'s `systemFields` still works and writes the default
  view; `Activity` stays a table-level switch.
- `filters` (`{Field: [names]}`: a workflow's states, a toggle's labels, or a
  single-select's or multi-select's options; Issue #319) and `sort`
  (`[{field, dir}]`) are `weave_update_table`'s shapes and validators.
- `default: true` moves a view first (the default is the first view); `position`
  sets its place in the list; `name` renames; `delete: true` removes it.
- The same verb is `weave table view Issue/Open --fields Name,Status`
  (`--show`, `--hide`, `--move F --before G`, `--filters JSON`, `--sort JSON`,
  `--widths JSON`, `--frozen N`, `--default`, `--position N`, `--from V`,
  `--name N`, `--delete`) and
  `GET` / `PATCH` / `DELETE /api/tables/:table/views/:view`
  (`GET /api/tables/:table/views` lists). `weave_schema` emits every table's
  `views` and `weave_apply_schema` round-trips them.
- `weave_update_table`'s older `hiddenFields`, `filters` and `sort` still work
  and write the default view; `fieldOrder` is the schema order (the entity
  page and Blank), not any view's columns.

### The CLI mirrors all of it

`node bin/weave.js help` prints the full list; `--data <path>` picks the
workspace. Every MCP tool has a command:

| Read | Schema | Data |
| --- | --- | --- |
| `weave ontology [--concept T] [--since E]` / `weave schema` | `weave space create` / `weave space` / `weave space update` / `weave space delete` / `weave space restore` | `weave create` / `weave get` / `weave query` |
| `weave vocabulary` | `weave table create` / `weave table` / `weave table update` / `weave table view` / `weave table move` / `weave table duplicate` / `weave table delete` / `weave table restore` | `weave update` / `weave delete` / `weave restore` / `weave trash` / `weave stats <table> [--by F] [--where J]` |
| `weave map` | `weave field add` / `weave field update` / `weave field rollback` / `weave field delete` | `weave link` / `weave unlink` / `weave state` / `weave bulk` |
| `weave template list` | `weave template use <space> --into <other.db> [--name N]` | |
| `weave registry` | `weave relation add` / `weave formula check` | `weave doc` / `weave comment` / `weave comment delete` |
| `weave activity` | `weave schema apply --file doc.json [--dry-run]` | `weave search` / `weave undo` |
| `weave doc-revisions <ref> [--field F] [--seq n]` | `weave doc-restore <ref> --seq n [--field F]` | |
| `weave audit` | `weave view` / `weave share` / `weave automation` / `weave automation create` | `weave csv` / `weave csv import` / `weave export` / `weave import` |
| `weave workspace` | `weave workspace logo` / `weave account` / `weave key` | `weave file attach` / `weave file read` / `weave file delete` |
| `weave form` / `weave form get` | `weave workspace leave` | `weave form submit <form> --values '{json}'` |
| `weave audit` | `weave account sessions` / `weave account revoke-session` / `weave account link` / `weave account unlink` | `weave invite <email>` / `weave invite list` / `weave invite revoke` |

Two operator verbs work on the whole data directory rather than one workspace
and have no MCP tool on purpose — an agent holding a token must not be able to
ship the keystore off the box or overwrite the store under a running server:
`weave backup` (every `.db` via `VACUUM INTO` + `files/` + `keystore.json`
into one tar, sealed when a passphrase or key file exists, `--dest s3://…`
uploads it with a stdlib SigV4 signer and keeps thirty) and
`weave restore <archive>` (verifies the manifest's sha256s, unpacks beside
`--data`, refuses a database a server holds open). `weave restore <ref>` is
still the entity verb. The Handbook's **Backup and restore** guide is the
reference; `WEAVE_BACKUP_DEST` on `weave serve` arms the nightly and
`/api/health` carries its last result as `backup`.

Notes that save round trips:

- **Refs are flexible.** Anywhere an entity is expected, pass a UUID, `#12`,
  `Table#12`, or `Space/Table#12`. Tables accept `Name` or `Space/Name`.
  **One exception:** the *target* of a relation — `weave_link` / `weave_unlink`,
  and relation values inside `weave_create_entity` / `weave_update_entity` —
  currently takes a UUID, a bare `#12`, or an exact name, but **not** the
  qualified `Table#12` form. Passing `Suite#18` there returns "not found" even
  though `#18` resolves.
- **Formulas have a check step.** The loop is: `weave_check_formula` (or
  `POST /api/tables/:id/formula-check`, or `weave formula check`) until it
  returns `ok: true` — it also previews the value on a real row — then save
  the expression with `weave_add_field` / `weave_update_field`, then read one
  entity back to verify the cell. Saving an invalid expression is rejected
  with the same error the check returns, so checking first costs nothing.
  Field references: bare name (`Amount`) or bracketed (`[Close Date]` — any
  name that is not a plain identifier). A formula may not reference itself.
  `weave_vocabulary` → `formulaFunctions` is the function catalog — name,
  signature, group (logic, text, number, date), a one-line doc and an example
  that parses — the same card the dialog shows on a chip. A formula cannot
  read a document or an attachments field.
  The verdict carries `type` — what the preview computed to: `number`,
  `text`, `boolean`, `list`, `null`, `error`. Pass `scan: true` (`--scan` on
  the CLI) to evaluate over up to 200 rows: `scan: {rows, capped, nulls,
  errors, sampleByOutcome: {ok, null, error}}`, each sample naming the row
  (and `error` its message). A formula valid on row 1 and null on a third of
  the table is the bug one preview cannot show — assert `nulls` and `errors`
  before saving.
- **Read the outline first.** `weave_ontology` (`{depth: "outline"}`) is the
  whole schema in a few thousand characters: one line per table, grouped by
  space, with short types, option and state names, relations as
  `name -> Target (inverse)` (`*` for many) and lookups, rollups and formulas as
  `name = short form`. `{concept: "Issue"}` reads one table in full, every field's
  description included. `weave_schema` is the full JSON, about twenty times larger,
  and still the document `weave_apply_schema` takes.
- **Documents are addressable.** Over HTTP, `/e/Task#12/doc.md`, `.html`, and
  `.pdf` return the rendered document directly; no tool call needed to read one.
- **Entities can hold several documents.** `weave_get_doc` / `weave_set_doc`
  take a field name; the default is the table's first document field.
- **A document write carries its text or it is refused.** Over HTTP,
  `PUT /api/entities/:ref/doc` and `POST …/doc` take the text under `doc` or
  `markdown`. A body with neither key is a 400, never a silent erase. Clearing
  a document stays explicit: send `{"doc": ""}`.
- **Every document keeps its history.** `weave_doc_revisions` lists a
  document's revisions newest first (`seq`, `at`, `actor`, `len`) — one per
  editing session, since writes by one actor inside ten minutes fold into
  one — and with `seq` returns that revision's text; `weave_doc_restore`
  writes a revision back as an ordinary, undoable write. Over HTTP:
  `GET /api/entities/:ref/doc/revisions?field=`, `GET …/doc/revisions/:seq`,
  `POST …/doc/revisions/:seq/restore` `{field}`. Two hundred revisions per
  document are kept; a purge drops them with the row.
- **Deletes are recoverable.** `weave_delete_entity` is a soft delete by
  default; `weave_trash` lists what is recoverable and `weave_restore_entity`
  brings it back. Schema deletes are not: a dropped column takes its values.
- **People sign in through a provider; agents keep the token.** With
  `requireAuth` on, a browser needs a `wv_session` cookie (minted when a
  linked person signs in at the provider from `/auth`) or a Bearer token; the
  API and MCP keep using `wv_` tokens, and a Bearer token wins when both are
  present. `sessions` and `revoke-session` are the lost-device verbs.
  `WEAVE_ORIGIN` names the origin the provider sends people back to on a
  hosted instance; localhost needs nothing. The built-in passkey door, with
  its invites and `remove-credential`, was removed after 0.4.52 (Feature #243).
- **A provider sign-in opens only a linked account.** With `WEAVE_OIDC_ISSUER`
  and `WEAVE_OIDC_CLIENT_ID` set, `/auth` sends a signed-out browser straight
  to one OpenID Connect provider (`?next` kept, no page in between). Signing in there creates no account: `weave_accounts`
  `action: link-identity` (or `weave account link <name>`, or
  `POST /api/accounts/<name>/identities`) mints a one-time invite link that
  lasts 7 days. The person who opens it and signs in at the provider is
  linked by the provider's subject, and `unlink-identity` (`--subject`)
  closes it. weave asks the provider for `openid` alone and stores no email
  (Feature #252). The session is the same `wv_session` cookie; agents keep
  the token.
- **A new person is invited, never provisioned by signing in.** An architect
  invites an email with a role (`observer`, `editor` by default, or
  `architect`): `weave_accounts` `action: invite`, `weave invite <email>
  --role <r>`, `POST /api/invites`, or **Members** on the workspace's home
  page. The answer carries a one-time `url`, good for 7 days; weave sends no
  email, so hand the link over. Signing in through it makes the account at
  that role, named after the email's local part, and spends the invite.
  `invites` / `weave invite list` / `GET /api/invites` list the pending ones;
  `revoke-invite` / `weave invite revoke <id>` / `DELETE /api/invites/<id>`
  cancel one. The email stays on the pending invite only (Issue #569).
- **A hosted agent can sign in through the browser too** (Feature #254).
  `POST /mcp` (the default workspace) and `POST /w/<name>/mcp` are
  `POST /api/mcp` as an OAuth 2.1 protected resource: with a provider
  configured, a call with no credential answers 401 with
  `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`
  (`.../oauth-protected-resource/w/<name>/mcp` for a workspace), and that
  document names the provider as the authorization server. The client signs
  the person in there and sends the provider's access token; weave asks the
  provider's userinfo endpoint whose it is and opens the account that
  subject is linked to (here or on the hub root), the link a browser makes
  by opening its invite once. Unlinked: 403. Rejected
  or expired: 401. Answers are cached a minute by the token's sha256. Writes
  record `<account> via MCP`, never the client id. The account needs the Architect role, as for `/api/mcp`.
  `wv_` tokens work on `/mcp` unchanged; `/api/mcp` takes only them.
  `WEAVE_MCP_ORIGINS` lists other origins the door answers on.
- **Secrets never come back to an agent.** A `key` (credential) field holds the
  *name* of a secret; the secret itself is encrypted in a keystore outside the
  workspace, so it is never in a cell, an export, a formula or a query result.
  `weave_keys` lists names, sets values and shares a credential with an
  account — it has no `reveal`. Reading a secret back is a human act on the
  CLI (`weave key reveal <name>`, which prints the bare value) or on
  `POST /api/keys/:name/reveal`, and both are gated by that credential's own
  access list — its owner plus whoever the owner granted — and written to the
  audit log. Permission lives on the credential, not on the field: the field's
  value was never the secret, so no view, formula or export needs a new check.
- **One MCP server is one workspace**, because one workspace is one file. A
  *second* workspace is a second file — `node bin/weave.js --data ./other.db
  space create …` creates it on first write, and a running hub takes
  `POST /api/workspaces {"name":"other"}`. Point another MCP server at the new
  file to work in it. `DELETE /api/workspaces/<name>` moves a workspace to the
  trash (its .db stays; `?deleted=1` lists the trash) and
  `POST /api/workspaces/<name>/restore` brings it back — removing the file
  itself stays a human act.
- **The schema carries a version.** Every API response stamps
  `X-Weave-Schema-Version`, and `GET /api/workspace` ships the same string as
  `schemaVersion`. It fingerprints the structure (spaces, tables, fields,
  automations), so it moves when anyone changes the schema and holds still
  while rows are written. A client that caches the schema compares the stamp
  on a read it was already making and refetches `GET /api/schema` when the two
  disagree; the browser app does exactly that (Issue #274).
- **Each space carries its own schema version** (Feature #277). It counts the
  structural audit entries that touched the space: a field, relation or table
  change bumps the spaces it touches, and a row write bumps nothing. The
  outline's last line is the workspace etag, a short hash of the space versions;
  `weave_ontology {since: "<etag>"}` (`GET /api/ontology?since=`,
  `weave ontology --since`) answers only the spaces that moved, or one line when
  nothing did. An etag the workspace never issued answers the whole outline.

### Self-documenting workspace

A `weave` docs workspace is provisioned beside your data at `/w/weave/`. Its
Handbook, Wiki, Development (roadmap + issues), and Quality (test suites) spaces
are queryable through the same API as any other workspace, so an agent can ask
the running instance what it does:

```bash
curl -s -X POST http://127.0.0.1:4400/w/weave/api/tables/Guide/query \
  -H 'Content-Type: application/json' -d '{}'
```

The Handbook's `Guide` and `Fields` pages are generated from `src/handbook.js`:
edit a page there, not on the running instance. `serve` re-applies them to an
existing docs workspace on the first boot of each build whose pages changed,
matched by name, so a guide you wrote yourself is never touched.
`weave handbook check --data weave.db` reports drift (exit 1 when any) and
`weave handbook sync --data weave.db` applies it on demand.

## Developing weave

For agents changing weave itself: where the code lives and the rules every change follows. weave is a local, self-hosted work platform, an open-source alternative to Airtable, Fibery, Notion databases and ClickUp; the maintainers' own workflow (Gerrit, the weave docs workspace) is in [CLAUDE.md](CLAUDE.md) and [DEVELOPMENT.md](DEVELOPMENT.md).

### Repo map

| Path | What lives there |
| --- | --- |
| `bin/weave.js` | CLI entry point — every command, including `serve` and `mcp` |
| `src/engine.js` | The core: schema, entities, relations, computed fields, automations |
| `src/store.js` | `node:sqlite` persistence (WAL, FTS5, JSON→SQLite migration) |
| `src/server.js` | HTTP server: web UI, REST API, document routes |
| `src/mcp.js` | MCP server: 63 tools over the engine, 17 listed by default |
| `src/formula.js` | Formula parser/evaluator |
| `src/markdown.js`, `src/pdf.js` | Document rendering to HTML / PDF |
| `public/` | Web UI (vanilla JS, no build step) and vendored third-party assets |
| `test/` | `node --test` suites — the contract for every behavior above |
| `docs/` | Parity matrix, comparisons, screenshots, the architecture map (`docs/architecture/`) |
| `scripts/` | Dev tooling (seed data, README screenshots) |

### Rules for changing this repo

1. **Tests first.** Run targeted tests for the changed behavior before committing.
   New engine or server behavior lands with tests in the same change. Push once
   to Gerrit, self-review and cast Code-Review +2; the poller runs the authoritative full gate before landing. Parallel
   workers must not each run `npm test` or invoke a duplicate manual gate.
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
7. **A landing is not a deploy.** A host that runs `weave supervise` with
   `WEAVE_AUTO_UPDATE=1` (the hosted instance does) installs each new release
   tag itself, with no restart and no failed request. Never redeploy it to ship
   a change: a platform redeploy restarts the container, drops requests for up
   to a minute and resets the supervisor. Redeploy only for a Node version, a
   `Dockerfile` or a `src/supervisor.js` change. A landed fix reaches the host
   with the next release.
8. **No inline code comments.** weave's own code carries no `//`, `/* */` or
   `<!-- -->` comments (Issue #661). Put the why in the commit message and the
   Issue or Feature row, a `ponytail:` upgrade path included.
   `test/no-inline-comments.test.mjs` enforces it; vendored code, `brand/` and
   `docs/` are exempt.
