// The Handbook: weave's own documentation, stored in weave.
//
// Two collections live here. FIELD_DOCS is one page per field type — the
// reference a writer opens when a column will not do what they meant. GUIDES
// is the prose that field pages cannot carry: how a document is written, and
// what a workspace can be made to look like.
//
// Both are applied by upsert (name is the key), so a workspace seeded before
// this file existed grows the new pages and refreshes the old ones without
// losing a row's id, its links, or anything a reader added underneath.

/* ---------------------------------------------------------------- fields */

/* `kind` groups the pages in the Fields table. The five original groups plus
   three the v0.4/v0.5 types earned: a definition is Meta, a keystore name is
   Secret, an upload is Files. */
export const FIELD_KINDS = ['Value', 'Choice', 'Relation', 'Computed', 'Document', 'Meta', 'Secret', 'Files'];

export const FIELD_DOCS = [
  { name: 'text', kind: 'Value', doc: `# text

Free-form single-line string. Every table is born with one: \`Name\`, the entity's identity and its link text everywhere.

## Config

\`default\` — the value a new row starts with. \`{ "name": "Title", "type": "text", "config": { "default": "Untitled" } }\`

## Usage

\`\`\`bash
weave create Task "Ship the release"
weave field add Task Owner text --config '{"default":"unassigned"}'
\`\`\`

Inline-editable in every view. The \`Name\` field feeds full-text search.

## In formulas

\`concat(Name, " — ", Owner)\` · \`upper(Code)\` · \`empty(Notes)\`

## Migrations

A text column can become \`number\`, \`key\`, \`url\`, \`email\`, \`select\`, \`multiselect\` or \`date\` in place, values coerced as they move. Anything else means a new column — the engine refuses a migration that would have to invent data.

## Gotchas

Empty string normalizes to null. \`Name\` cannot be renamed or deleted.` },

  { name: 'number', kind: 'Value', doc: `# number

Finite numeric value. One type, four costumes — plain, currency, percent, and a unit — and the costume is display only.

## Config

| Key | Values | Effect |
| --- | --- | --- |
| \`format\` | \`number\` (default), \`currency\`, \`percent\` | which costume the cell wears |
| \`currency\` | ISO code — \`USD\`, \`EUR\`, \`MXN\`, \`CNY\`, \`JPY\`, \`RUB\`, \`CAD\`, … | the symbol, when \`format\` is \`currency\` |
| \`unit\` | any short string — \`kg\`, \`ms\`, \`seats\` | a suffix, on plain numbers and on formulas |
| \`decimals\` | integer | fixed places; defaults to 0, or 2 under \`currency\` |
| \`separator\` | boolean | thousands grouping |
| \`default\` | number | the value a new row starts with |

\`\`\`json
{ "name": "Price", "type": "number",
  "config": { "format": "currency", "currency": "USD", "decimals": 2 } }
\`\`\`

## Usage

\`\`\`bash
weave field add Invoice Total number --config '{"format":"currency","currency":"USD"}'
weave field add Part Weight number --config '{"unit":"kg","decimals":1}'
weave field add Deal Share number --config '{"format":"percent","decimals":1}'
\`\`\`

Right-aligned with tabular figures, so a column of figures lines up on the decimal.

## In formulas & rollups

Aggregates: \`sum\`, \`avg\`, \`min\`, \`max\`, \`count\`. Formula: \`round(Price * Count)\`.

## Gotchas

**A formula reads the raw number, never the costume.** \`$1,499.50\` is stored as \`1499.5\`; the currency, the unit and the separator are painted at read time. A formula that received the formatted string would break the moment someone turned on grouping — so it does not receive it.

Validates with \`Number()\`: \`"25000"\` coerces, \`"abc"\` is rejected.` },

  { name: 'date', kind: 'Value', doc: `# date

A single point in time. Type it in any format you like — the cell parses what you meant and stores ISO.

## Config

| Key | Values | Effect |
| --- | --- | --- |
| \`format\` | \`iso\` (default), \`us\`, \`eu\`, \`long\` | \`2026-09-15\` · \`9/15/2026\` · \`15/09/2026\` · \`September 15, 2026\` |
| \`time\` | boolean | show and edit the clock as well as the day |
| \`default\` | a date, or \`today()\` / \`now()\` | what a new row starts with, evaluated per row |

## Usage

\`\`\`bash
weave field add Task Due date --config '{"format":"us"}'
weave field add Post Published date --config '{"format":"long","time":true}'
weave field add Log Seen date --config '{"default":"now()"}'
\`\`\`

Typing is forgiving: \`next friday\`, \`sep 15\`, \`15/9\`, \`in 3 weeks\` and \`2026-09-15\` all land on the same day. The picker button opens a calendar with month and year grids, and the field's own format is shown as an example under the input.

## Query

\`\`\`json
{"where": [["Due", "<", "2026-10-01"], ["Due", "not-empty"]]}
\`\`\`

## In formulas

\`days(today(), Due)\` · \`if(empty(Due), "", days(today(), Due))\`

## Gotchas

The format is a costume, like a number's. Comparison, sorting and date math all run on the stored ISO value, so changing a column from \`us\` to \`long\` changes nothing but the reading.` },

  { name: 'daterange', kind: 'Value', doc: `# daterange

A start and an end, together: \`{"start": "2026-09-20", "end": "2026-09-27"}\`.

## Config

\`format\` — the same four the \`date\` type takes (\`iso\`, \`us\`, \`eu\`, \`long\`), applied to both bounds. \`default\`.

The two bounds render as a pair of date inputs.

## Usage

\`\`\`bash
weave update 'Trip#3' --values '{"Window": {"start": "2026-09-20", "end": "2026-09-27"}}'
\`\`\`

## Gotchas

Both bounds must parse as dates or the write is rejected. Queries have no overlap operator yet, and the bounds are not addressable as \`Window.start\` — fetch and filter in the caller. Calendar and timeline views are a known gap.` },

  { name: 'checkbox', kind: 'Value', doc: `# checkbox

Boolean. Null normalizes to \`false\`, so a checkbox is never empty.

## Config

\`default\` — \`{ "name": "Done", "type": "checkbox", "config": { "default": false } }\`

## Usage

\`{"Done": true}\`. CSV import accepts \`true\`, \`1\`, \`yes\`, \`✓\`, \`x\`.

## In formulas

\`if(Done, "✔", "…")\`

## Gotchas

\`is-empty\` never matches a checkbox — \`false\` is a value, not a hole.` },

  { name: 'url', kind: 'Value', doc: `# url

A string the grid renders as a link, opening in a new tab.

## Config

\`default\`.

## Usage

\`{"Repo": "https://github.com/grunion-ai/weave"}\` — no scheme validation is enforced; the UI links the string as it stands.

## Gotchas

Webhook automation URLs **do** validate (\`http(s)://\` required). The \`url\` field type does not, so validate upstream if strictness matters to you.` },

  { name: 'email', kind: 'Value', doc: `# email

A string checked against a pragmatic address pattern on write, rendered as a \`mailto:\` link.

## Config

\`default\`.

## Usage

\`{"Contact": "ada@example.com"}\` — \`"not-an-email"\` is rejected with a 400.

## Gotchas

Format only: no MX lookup, no deliverability check. Empty clears to null.` },

  { name: 'select', kind: 'Choice', doc: `# select

One choice from a configured list. Stored as the option **id** (a slug), read everywhere as the option **name**.

## Config

\`options\` — strings, or objects carrying a color and a glyph. \`default\`.

\`\`\`json
{ "name": "Priority", "type": "select", "config": { "options": [
  { "name": "Low",    "color": "#2ea043" },
  { "name": "Medium", "color": "#f59f00" },
  { "name": "High",   "color": "#e5484d" }] } }
\`\`\`

**The palette is eight values and nothing else**: \`''\` neutral, \`#4769eb\` blue, \`#2ea043\` green, \`#f59f00\` amber, \`#e5484d\` red, \`#8e4ec6\` purple, \`#00a2c7\` cyan, \`#d6409f\` magenta. An empty string is the honest default — a color should carry meaning, not decoration.

## Usage

Write by name or by id, case-insensitively: \`{"Priority": "high"}\`. An unknown option is rejected.

Editing the options is an in-place edit from the column header, not a delete-and-recreate: renaming \`Medium\` to \`Normal\` keeps every row that held it.

## Gotchas

Pass an option's **id** when renaming it — a bare string re-slugs and orphans the rows that pointed at the old id. A board can group on a select when the table has no workflow field.` },

  { name: 'multiselect', kind: 'Choice', doc: `# multiselect

Several choices from the same option shape as \`select\`; stored as an array of ids, rendered as a row of chips.

## Config

Same as \`select\`: \`options\`, \`default\`.

## Usage

\`{"Tags": ["alpha", "stable"]}\` — a bare string becomes a one-element array. CSV import splits on \`;\`.

The picker is a token box: chips live inside the cursor box with the text you are typing, so adding a fourth tag never pushes the field out from under you.

## Gotchas

Order is the order you wrote, not the order of the options list.` },

  { name: 'workflow', kind: 'Choice', doc: `# workflow

A lifecycle. One state at a time, each state belonging to a **category**, and the category is what colors the chip and orders a board.

## Config

\`states\` — \`[{ name, category, default, icon }]\`. Categories are exactly four: \`not-started\`, \`in-progress\`, \`done\`, \`canceled\`.

\`\`\`json
{ "name": "Stage", "type": "workflow", "config": { "states": [
  { "name": "Backlog",  "category": "not-started", "default": true },
  { "name": "Building", "category": "in-progress" },
  { "name": "Shipped",  "category": "done" },
  { "name": "Dropped",  "category": "canceled" }] } }
\`\`\`

## Usage

State moves through its own verb, which records the transition in the activity log:

\`\`\`bash
weave state Task#5 State "In Progress"
\`\`\`

A two-state workflow is a legitimate gate — \`Pending\` → \`Approved\` says more than a checkbox called \`approved\`.

## Gotchas

**One workflow per table.** The board and the row's state chip both read the first one; a second makes both ambiguous.

A select becomes a workflow the moment its values describe progress rather than kind.` },

  { name: 'relation', kind: 'Relation', doc: `# relation

A link between two tables, always created as a bidirectional pair — the inverse field appears on the other table in the same write.

## Config

Created with its own verb, not \`add_field\`: \`targetDb\`, \`cardinality\`, \`inverseName\`.

Cardinalities: \`many-to-one\` (the default), \`one-to-many\`, \`many-to-many\`, \`one-to-one\`.

## Usage

\`\`\`bash
weave relation add Task Project Project --cardinality many-to-one --inverse Tasks
weave link Task#5 Project 'Project#1'
weave unlink Task#5 Project 'Project#1'
\`\`\`

Renders as chips carrying the target's name, each with a \`×\`, plus a \`+ link\` control that opens the search-first picker.

## Query

Traverse with a dotted path: \`[["Project.Name", "=", "Apollo"]]\`.

## Gotchas

Name the field for **what is on the other end** (\`Project\`, \`Assignee\`), and the inverse for what this side is, plural (\`Tasks\`). The field name is what the chip reads and what every lookup path starts with — \`Task-Project\` makes both unreadable.

Deleting a relation deletes both ends.` },

  { name: 'lookup', kind: 'Computed', doc: `# lookup

A value borrowed across a relation, read-only, refreshed whenever either side changes.

## Config

\`relationField\` — the relation to walk. \`targetField\` — the field to read on the other side.

\`\`\`json
{ "name": "Owner email", "type": "lookup",
  "config": { "relationField": "Owner", "targetField": "Email" } }
\`\`\`

## Usage

Renders on a tinted background marked \`↗\`. Nothing writes to it.

## Gotchas

A lookup that returns null usually means the \`relationField\` name is wrong — it is the **field** name on this table, not the target table's name.

Across a to-many relation a lookup takes the first match; use a \`rollup\` with \`join\` when you want all of them.` },

  { name: 'rollup', kind: 'Computed', doc: `# rollup

An aggregate over everything on the far side of a relation.

## Config

\`relationField\`, \`aggregate\`, and \`targetField\` for every aggregate except \`count\`.

Aggregates: \`count\`, \`sum\`, \`avg\`, \`min\`, \`max\`, \`join\`.

\`\`\`json
{ "name": "Peer names", "type": "rollup",
  "config": { "relationField": "Peers", "aggregate": "join", "targetField": "Name" } }
\`\`\`

## Usage

Renders on a tinted background marked \`Σ\`. \`join\` accepts a \`separator\`; the default is \`, \`.

## Gotchas

A rollup crosses a relation; a formula stays on the row. Reaching for a formula where a rollup does the job is the most common way to end up with a number that will not update.` },

  { name: 'formula', kind: 'Computed', doc: `# formula

An expression over this row's own fields, recomputed on read.

## Config

\`expression\`, plus every number costume key — \`format\`, \`currency\`, \`unit\`, \`decimals\`, \`separator\` — so a computed figure can wear the same clothes as a stored one.

\`\`\`json
{ "name": "Total", "type": "formula",
  "config": { "expression": "Price * Count", "format": "currency", "currency": "USD" } }
\`\`\`

## Usage

Field names go in bare; quote them only when they contain spaces.

\`\`\`
Price * Count
concat(upper(Category), " · ", Priority)
if(empty(Due), "", days(today(), Due))
if(empty(Estimate), "unsized", if(Estimate > 5, "large", "small"))
\`\`\`

Renders on a tinted background marked \`ƒ\`. In the field dialog, formula is a checkbox on any type — ticking it opens the script editor.

## Gotchas

A formula reads **raw** values. A number's currency and unit are display costumes and never reach the expression, which is what keeps \`Price * Count\` from breaking when someone turns on thousands separators.

A formula cannot cross a relation. That is what \`lookup\` and \`rollup\` are for.` },

  { name: 'document', kind: 'Document', doc: `# document

A markdown document that belongs to one row. Every table has one — \`Description\` — and a table may carry as many more as it needs.

## Config

\`kind\` — \`markdown\` (the unmarked default), \`html\`, or \`code\`.

\`\`\`bash
weave field add Task Spec document
weave field add Workflow Script document --config '{"kind":"code"}'
\`\`\`

## Usage

Documents never take a column of their own. They fold into the shared \`Docs (n)\` control in the grid, and open in full on the entity page and in the side peek.

\`\`\`bash
weave doc set Task#5 --field Spec --content '# Spec'
weave doc append Task#5 --field Spec --file notes.md
weave doc export Task#5 --format pdf --out t5.pdf
\`\`\`

Every document is addressable as MD, HTML, MMD and PDF at \`/e/<id>/doc/<Field>.<fmt>\`.

## What a document can hold

Headings that fold, tables, task lists, code blocks that detect their own language, mermaid diagrams, KaTeX math including chemistry, raw HTML, and \`[[…]]\` chips that link to any entity, table or space. See the **Document formatting** guide for the whole surface.

## Gotchas

The editor renders as you type — there is no edit mode and no save button. A document written by an automation lands the same way a person's typing does.` },

  { name: 'field', kind: 'Meta', doc: `# field

A value that **is** a field definition. This is what makes the schema editable as data: the \`Definition\` column on \`Workspace/Fields\` is a \`field\` field.

## Config

\`depth\` — 1 to 4, how many times a definition may describe another definition. \`types\` is filled in by the engine with the definable set.

\`\`\`json
{ "name": "Definition", "type": "field", "config": { "depth": 1 } }
\`\`\`

## Usage

The value is the same object \`add_field\` takes:

\`\`\`json
{ "type": "number", "config": { "format": "currency", "currency": "EUR", "decimals": 2 } }
\`\`\`

Written to a registry row, it reconfigures the real field — the same validation, because it is the same normalizer.

In a grid the cell reads as a sentence rather than as JSON: \`select · 3 options\`.

## Definable types

\`text\`, \`number\`, \`date\`, \`daterange\`, \`checkbox\`, \`url\`, \`email\`, \`select\`, \`multiselect\`, \`workflow\`, \`document\`, \`field\`, \`key\`, \`attachments\`.

\`relation\`, \`lookup\`, \`rollup\` and \`formula\` are absent on purpose: each needs a target that only exists in a table's context, so each has its own verb.

## Gotchas

A \`Definition\` cannot change a field's **type** — drop the column and create it anew. Pass the object with a \`config\` key; a bare \`{type, options}\` is accepted and silently does nothing.` },

  { name: 'key', kind: 'Secret', doc: `# key

The **name** of a secret. The secret itself lives in \`~/.weave/keystore.json\`, chmod 600, and never in the workspace.

## Config

None — \`{ "name": "API key", "type": "key" }\`.

## Usage

The cell holds a name; the value is set out of band.

\`\`\`bash
weave key set vendor-portal --value s3cr3t
weave key set vendor-portal            # reads stdin
weave key list
weave update 'Field Types#1' --values '{"API key": "vendor-portal"}'
\`\`\`

The cell reads \`✱✱✱✱ vendor-portal\`, or \`✱✱✱✱ vendor-portal (unset)\` when the keystore has no such name yet.

## Gotchas

**There is no read-back endpoint.** Not on REST, not on MCP, not on the CLI. A secret goes in and is used; it does not come out.

Storing a name the keystore does not hold is allowed on purpose — set the row first and the secret later, and the cell tells you which state you are in. An export carries the names and none of the values.` },

  { name: 'attachments', kind: 'Files', doc: `# attachments

Files on a row. Bytes live in the workspace's sibling \`files/\` directory; the cell holds their ids.

## Config

\`multiple\` — \`true\` by default; \`false\` makes the field hold exactly one file.

\`\`\`bash
weave field add Task Files attachments
weave field add Person Headshot attachments --config '{"multiple":false}'
\`\`\`

## Usage

\`\`\`bash
weave file attach Task#5 --path ./spec.pdf --field Files
weave file read <fileId> --out ./spec.pdf
weave file delete Task#5 <fileId>
\`\`\`

Renders as file chips; images preview in the fullscreen viewer.

## Gotchas

Files are not documents. A document is written and rendered; an attachment is stored and handed back. Back up \`files/\` alongside the \`.db\` — a single-file backup drops every attachment.

A file delete is not undoable.` },
];

/* ---------------------------------------------------------------- guides */

export const GUIDES = [
  {
    name: 'Document formatting',
    audience: 'Both',
    order: 8,
    doc: `# Document formatting

Every entity carries at least one document, and a table can give it more. This page is what a document can hold.

## The editor is the renderer

There is no edit mode, no preview pane and no save button. A heading becomes a heading as you finish typing it, and what is stored underneath is plain markdown — the same text the API returns, the same text an automation appends, the same text \`doc export\` writes out.

Nothing in a document is a proprietary block. Copy it into a file, hand it to an agent, put it under version control; it stays what it is.

## The slash menu

Type \`/\` on an empty line. Three groups:

| Group | What it holds |
| --- | --- |
| **ALL COMMANDS** | blocks — headings, lists, quote, code, mermaid, table, divider, line break, raw HTML |
| **REFERENCE** | a link to an entity, a table, or a space; picking one opens the search |
| **FORMAT · APPLIES TO SELECTION** | bold, italic, strikethrough, inline code, link |

Each row shows its markdown on the right, so the menu teaches the syntax rather than hiding it. Aliases catch what you actually type: \`/todo\` finds the task list, \`/hr\` the divider, \`/h4\` a level-four heading directly.

A format command wraps the text you selected rather than a placeholder — as long as you selected it in the last fifteen seconds. Select a phrase, type \`/bold\`, and the phrase is what ends up bold.

## Blocks

| Block | Syntax |
| --- | --- |
| Heading 1–6 | \`#\` … \`######\` |
| Bulleted list | \`-\` |
| Numbered list | \`1.\` |
| Task list | \`- [ ]\` |
| Quote | \`>\` |
| Code block | three backticks |
| Mermaid diagram | three backticks + \`mermaid\` |
| Table | \`| a | b |\` |
| Divider | \`***\` |
| Raw HTML | \`<div>\` |

Lists nest on two spaces. The divider is \`***\` rather than \`---\` because a \`---\` pair reads as YAML front matter and comes back as a code block.

## Linking to anything in the workspace

Type \`#\` anywhere in a line and the entity search opens inline, arrow-navigable, one step. Pick a row and you get a chip.

\`\`\`
[[Task#12]]          an entity
[[table:Task]]       a table
[[space:Handbook]]   a space
\`\`\`

The stored form is a permalink keyed on the target's id, so renaming the target renames the chip and never breaks the link. Chips render live in the editor, in the rendered view, and in exported HTML.

## Code

An unlabelled fence detects its own language — JSON, HTML, a mermaid source, a shell session — and highlights it. Naming the language on the fence still wins. Anything unrecognised stays plain text, which is the right answer for a config snippet nobody has a grammar for.

Highlighting is the vendored highlight.js: github in light, github-dark in dark. The block chrome belongs to weave, so a code block reads like the rest of the page in both themes.

## Diagrams

A \`mermaid\` or \`mmd\` fence renders as a diagram — in the editor, and in every export. \`.mmd\` is a first-class download format beside \`.md\`, \`.html\` and \`.pdf\`.

Graphviz, PlantUML, echarts, mindmap, abc and flowchart fences are deliberately **not** vendored. They degrade to plain code blocks rather than pulling six renderers into the tree.

## Math and chemistry

\`$…$\` inline, \`$$…$$\` as a block, rendered by KaTeX. mhchem rides along, so \`\\ce{H2O}\` works — and it is load-bearing rather than a bonus: the math render callback lives inside mhchem's load, so dropping it would silently kill all math, not only the chemistry.

KaTeX is the only optional renderer in the tree.

## Tables

Inside a table, **Enter** adds a row, **Shift+Enter** breaks a line within the cell, and **Tab** moves to the next cell. A wide table scrolls inside its own frame rather than pushing the page sideways.

## Folding

Click a heading's gutter to fold it. Everything down to the next heading of the same or a higher level collapses.

The fold lives in an overlay layer, never inside the document itself, so **the stored markdown does not change when you fold**. Fold state is remembered per entity and field in your browser and comes back on reload.

## The dash rail

A document with three or more headings grows a minimap down its edge: one dash per heading, longer for higher levels, a tracker that follows the scroll, click to jump. Below three headings a map explains nothing, so no rail appears.

## Full screen

Any document opens full screen from its frame, and markdown editing works there exactly as it does in the panel. That is where a long document is worth writing.

## Kinds

A document field carries a \`kind\`: \`markdown\` (the default), \`html\`, or \`code\`. A \`code\` document is what the \`Workflows\` registry's \`Script\` column uses — a document that is a program rather than prose.

## Getting it back out

\`\`\`bash
weave doc get Task#5 --field Spec
weave doc export Task#5 --format md   --out spec.md
weave doc export Task#5 --format html --out spec.html
weave doc export Task#5 --format pdf  --out spec.pdf
\`\`\`

Or by URL: \`/e/<id>/doc/<Field>.md\`, \`.html\`, \`.mmd\`, \`.pdf\`. The whole entity downloads as one file from the entity page.

The PDF writer is in-tree and embeds DejaVu, so accented text, Greek, arrows and box-drawing survive the trip. The standard PDF fonts cannot carry those, which is why the fonts are embedded rather than named.

## Written by an agent, read by a person

An automation can append to a document on a state change, with \`{{Name}}\` and \`{{Today}}\` filled in from the row:

\`\`\`json
{ "type": "append-doc", "text": "---\\n\\n✅ Completed on {{Today}}." }
\`\`\`

What lands is markdown, in the same document a person is editing, folding and exporting. There is no second class of content.

Worked examples of every construct on this page live in [[table:Formatting]], one row each.`,
  },
  {
    name: 'Making a workspace your own',
    audience: 'Both',
    order: 9,
    doc: `# Making a workspace your own

Two tables holding the same rows can read completely differently. This page is the surface that decides which one you get: the chrome, the costumes, the grid, and the views.

Everything here is reachable from the UI, the CLI, REST and MCP. The **Configuring a space, first time right** guide is the same surface written for an agent standing up a space without a browser; this one is written for whoever has to read the result.

## The workspace

\`\`\`bash
weave workspace set --name "Acme" --description "Everything we owe someone"
weave workspace logo --path ./acme.png
weave workspace require-auth
\`\`\`

The name and logo ride the icon rail on the far left, which is how you switch between workspaces served side by side at \`/w/<name>/\`. The theme toggle is light, dark, or follow the system, and every surface — chips, code blocks, diagrams, the relation map — is drawn in both.

## Icons and nouns

A space and a table are born with an icon and can be given a better one:

\`\`\`bash
weave space update Finance --icon iconly:wallet
weave table update Invoice --icon iconly:paper --noun invoice
\`\`\`

The icon value is **\`iconly:<name>\`** — one of a hundred flat names (\`activity bag bookmark bug calendar category chart chat danger delete discovery document edit filter folder graph heart home image location lock message notification paper profile search send setting shielddone star ticket timecircle wallet work\` among them). Any other string paints itself, so an emoji is a legal icon too.

The **noun** is what one row is called. Set it and the create control says "New invoice" instead of "New Invoice" — a small thing that stops a table full of invoices reading like a table full of table names.

## The grid reads as a record

The table view is a ledger, not a form. The \`#id\` link navigates; **every other cell edits in place**, raising that field type's own editor with the cursor already in it. Chips keep their tint and lose their box. Computed cells keep their glyph and drop their ground. No cell draws a border on hover — the row's tint is the feedback.

⌘-click opens a row in the **side peek**, so the table keeps its place while you read one record.

## Column order, width, and what is on screen at all

| Control | Where | What it does |
| --- | --- | --- |
| Drag a header | table view | reorders columns, stored on the schema for everyone |
| Drag a header's right edge | table view | sets a width |
| Double-click that edge | table view | fits the column to its content, no cutoff |
| Click a header | table view | opens the field tray — rename, retype, reconfigure |
| 👁 | view toolbar | show or hide any field, the system columns, and deleted rows |
| Drag ⠿ | entity page | reorders fields; the table's columns follow |

Two facts about width decide how a table reads: **an unset column caps at 260px and ellipsises**, and **a set width is a floor as well as a ceiling** (60px minimum), so the column holds its width in a grid wider than its card. Set one only where the default clips something a reader needs.

The five system columns — \`Created At\`, \`Modified At\`, \`Created By\`, \`Modified By\`, \`Activity\` — are off by default. Turn them on where provenance is part of the record.

Hide rather than delete when a column matters to a machine and not to a reader. Hiding keeps the data and the API surface; a delete needs \`hard\` and does not come back.

## Costumes

A costume is display only. The stored value never changes, and neither does anything computed from it.

| Field | Config | Reads as |
| --- | --- | --- |
| number | \`{}\` | \`1499.5\` |
| number | \`{"format":"currency","currency":"USD","decimals":2}\` | \`$1,499.50\` |
| number | \`{"format":"percent","decimals":1}\` | \`32.5%\` |
| number | \`{"unit":"kg","decimals":0}\` | \`2 kg\` |
| date | \`{}\` | \`2026-09-15\` |
| date | \`{"format":"us"}\` | \`9/15/2026\` |
| date | \`{"format":"long","time":true}\` | \`September 15, 2026, 2:30 PM\` |

A formula takes the same number keys, so a computed total wears the same clothes as a stored one — and still reads raw numbers inside the expression.

The \`Field Types\` table in the **Showcase** space holds all of these side by side, one column each, in one grid.

## Colour means one thing

The option palette is eight values and closed: \`''\` neutral, \`#4769eb\` blue, \`#2ea043\` green, \`#f59f00\` amber, \`#e5484d\` red, \`#8e4ec6\` purple, \`#00a2c7\` cyan, \`#d6409f\` magenta.

Neutral is the honest default. A colour should carry meaning — red for blocked, green for done — and a table where every option is a different colour has told the reader nothing.

Workflow states are the exception that proves it: a state's **category** colours its chip, so \`not-started\`, \`in-progress\`, \`done\` and \`canceled\` look the same everywhere in the workspace without anyone choosing a colour.

## Views

\`table\` and \`board\` are the two kinds. A board groups on the table's first \`workflow\` field, falling back to the first \`select\`; a table with neither cannot be a board.

Filters are workflow-state chips above the grid and resolve to a server-side \`where\`, so filtering a large table does not mean fetching it.

A **saved view** is a named set of table blocks, and it can be shared:

\`\`\`bash
weave view create "Ops Monday" --blocks '[{"table":"Task","view":"board"},{"table":"Incident","view":"table"}]'
weave view share <id>     # returns a wvv_ capability URL
weave view unshare <id>
\`\`\`

The share URL carries its own capability. Anyone holding it reads that view and nothing else — no account, no login.

## The relation map

One map, drawn in three places from one renderer: the \`#/map\` page, a card on the workspace home, and a card on every space page. A column per space, one edge per relation pair carrying both ends' cardinality, automations drawn in as pills. A space's map shows that space plus whatever it actually touches, guests dashed and named by their own space.

## Automations

\`\`\`bash
weave automation create Task --name 'Log completion' \\
  --trigger '{"type":"state-changed","field":"State","toState":"Done"}' \\
  --actions '[{"type":"append-doc","text":"✅ Completed on {{Today}}."},
              {"type":"add-comment","text":"{{Name}} moved to Done."}]'
\`\`\`

Triggers fire on create, update, and state change. Actions set fields, move state, append to a document, add a comment, or POST a webhook. \`{{Field}}\` placeholders read the row.

## Decks

A deck is a read over slide rows, composed on request — the rows stay editable data and the deck is generated from them. See the **Decks: composing slides** guide.

## Who can do it

\`\`\`bash
weave account create ci-bot --role writer
weave account list
weave audit --limit 50
\`\`\`

Three roles: \`admin\`, \`writer\`, \`reader\`. Tokens are \`wv_\` values hashed at rest, and every mutation lands in a durable audit log with the actor that made it — a person, the CLI, or a named MCP client.

Entity mutations are undoable (\`weave undo\`, 200 deep). Schema work, hard deletes and file deletions are not.

## The structure is data too

\`Workspace/Spaces\`, \`Workspace/Tables\`, \`Workspace/Fields\` and \`Workspace/Workflows\` are ordinary tables whose rows **are** the structure. Editing a row runs the same validation as the schema verb, because it is the schema verb. That is the subject of the **Configuring a space, first time right** guide.`,
  },
];

/* ----------------------------------------------------- formatting samples

   The Showcase space answers "what can a field be" in one grid. This answers
   the same question for a document: one row per construct, each row's own
   Description written in the construct it names, so the table is the proof
   and the reference at once. */

export const FORMATTING_SAMPLES = [
  { name: 'Headings and folds', construct: 'Structure', syntax: '`#` … `######`', doc: `# Headings and folds

Six levels. A heading's gutter folds everything down to the next heading of the same or a higher level.

## Level two

Folding this one hides the level-three heading below it and its text.

### Level three

The fold is an overlay, never part of the document. Fold this page, export it, and the markdown comes out whole.

## A second level two

Folding the first level two leaves this one alone — the range stops at the next heading of the same level.

### Three headings is the threshold

At three or more headings a document grows the dash rail down its edge. This page has six, so the rail is there.` },

  { name: 'Lists and task lists', construct: 'Block', syntax: '`-` · `1.` · `- [ ]`', doc: `# Lists

- A bullet
- Another
  - Nested on two spaces
    - And again

1. Numbered
2. Numbered
   1. Nested

## Task lists

- [x] Written
- [x] Checked in
- [ ] Reviewed
- [ ] Shipped

A task list is markdown, not a widget: the box is \`[ ]\` or \`[x]\` in the stored text, so an agent can tick one with a string edit.` },

  { name: 'Quote, divider, line break', construct: 'Block', syntax: '`>` · `***` · trailing `\\`', doc: `# Quote, divider, line break

> A quote is a block. It wraps, it nests, and it keeps its bar in both themes.
>
> > Nested, when the second voice matters.

***

The divider above is \`***\`. The obvious spelling, \`---\`, reads as YAML front matter and comes back as a code block — so weave inserts \`***\` and means it.

A hard break is a trailing backslash:\\
this line began after one, without starting a new paragraph.` },

  { name: 'Emphasis and inline code', construct: 'Format', syntax: '`**…**` · `*…*` · `~~…~~`', doc: `# Emphasis

**Bold**, *italic*, ~~struck through~~, \`inline code\`, and a [link](https://github.com/grunion-ai/weave).

Select a phrase first and the slash menu wraps **what you selected** rather than a placeholder — the selection is remembered for fifteen seconds, which is long enough to type \`/bold\` and short enough that a selection from a minute ago is not what this \`/\` is about.` },

  { name: 'Tables', construct: 'Table', syntax: '`| a | b |`', doc: `# Tables

| Field | Type | Reads as |
| --- | --- | --- |
| Price | number · currency USD | \`$1,499.50\` |
| Share | number · percent | \`32.5%\` |
| Weight | number · unit kg | \`2 kg\` |
| Due | date · us | \`9/15/2026\` |
| Published | date · long + time | \`September 15, 2026, 2:30 PM\` |

**Enter** adds a row, **Shift+Enter** breaks a line inside a cell, **Tab** moves to the next cell. A table wider than the panel scrolls inside its own frame instead of pushing the page sideways.` },

  { name: 'Code, unlabelled', construct: 'Code', syntax: 'a bare fence', doc: `# An unlabelled fence detects its own language

JSON:

\`\`\`
{ "name": "Price", "type": "number", "config": { "format": "currency", "currency": "USD" } }
\`\`\`

A shell session:

\`\`\`
weave query Task --where '[["State","=","Open"]]' --select 'Due,Owner'
\`\`\`

HTML:

\`\`\`
<section class="card"><h2>Hello</h2></section>
\`\`\`

Nothing on the fence names a language. The content decides, and anything unrecognised stays plain text — the right answer for a config snippet nobody has a grammar for.` },

  { name: 'Code, labelled', construct: 'Code', syntax: 'fence + language', doc: `# Naming the language wins

\`\`\`js
const total = items.reduce((sum, i) => sum + i.price * i.count, 0);
\`\`\`

\`\`\`sql
select space, count(*) from tables group by space order by 2 desc;
\`\`\`

\`\`\`python
def days_left(due, today):
    return (due - today).days
\`\`\`

Highlighting is the vendored highlight.js — github in light, github-dark in dark — and the block's own chrome is weave's, so a code block reads like the rest of the page in either theme.` },

  { name: 'Mermaid diagrams', construct: 'Diagram', syntax: 'fence + `mermaid`', doc: `# Diagrams

\`\`\`mermaid
graph TD
  W[Workspace] --> S[Space]
  S --> T[Table]
  T --> E[Entity]
  E --> D[Document]
  E --> F[Field value]
  T -. relation .-> T
\`\`\`

A state machine:

\`\`\`mermaid
stateDiagram-v2
  [*] --> Backlog
  Backlog --> Building
  Building --> Shipped
  Building --> Dropped
  Shipped --> [*]
\`\`\`

Both render in the editor, in the rendered view, and in every export. \`.mmd\` is a first-class download format beside \`.md\`, \`.html\` and \`.pdf\`.

Graphviz, PlantUML, echarts, mindmap, abc and flowchart fences degrade to plain code blocks on purpose — six more renderers is not worth six more vendored bundles.` },

  { name: 'Math and chemistry', construct: 'Math', syntax: '`$…$` · `$$…$$`', doc: `# Math

Inline: the run rate is $r = \\frac{\\sum_{i=1}^{n} c_i}{n}$ over the trailing months.

As a block:

$$
\\text{Total} = \\sum_{i=1}^{n} p_i q_i \\qquad \\sigma = \\sqrt{\\frac{1}{n}\\sum (x_i - \\mu)^2}
$$

## Chemistry

mhchem rides along with KaTeX, so $\\ce{2H2 + O2 -> 2H2O}$ and $\\ce{CO2 + H2O <=> H2CO3}$ typeset properly.

That is not a bonus. The math render callback lives inside mhchem's load — remove mhchem and **all** math stops rendering, not only the chemistry.

KaTeX is the only optional renderer vendored into the tree.` },

  { name: 'Links to entities, tables and spaces', construct: 'Reference', syntax: '`[[…]]`', doc: `# References

Type \`#\` anywhere in a line and the entity search opens inline, arrow-navigable, one step.

- An entity: [[Field Types#1]]
- A table: [[table:Field Types]]
- A space: [[space:Showcase]]

The stored form is a permalink keyed on the target's id. Rename the target and the chip renames with it; the link never breaks. Chips render live in the editor, in the rendered view, and in exported HTML.` },

  { name: 'Raw HTML', construct: 'Block', syntax: '`<div>`', doc: `# Raw HTML

When markdown will not say it:

<div style="border-left:3px solid #4769eb;padding:.6rem .9rem;border-radius:6px">
<strong>Note.</strong> A raw HTML block passes through the renderer untouched, in the editor and in the HTML export.
</div>

Raw HTML is inserted through the slash menu rather than typed, because the insert path spins what it inserts through the markdown engine in a context that drops an HTML block outright. A whole-document write round-trips it untouched.` },

  { name: 'One page using all of it', construct: 'Structure', syntax: '—', doc: `# Release note

A document does not have to pick one construct.

## What shipped

| Area | Change |
| --- | --- |
| Fields | \`attachments\`, \`key\` and \`field\` documented |
| Documents | this page |

## The shape

\`\`\`mermaid
graph LR
  Content --> Model --> Document --> PDF
\`\`\`

## Checklist

- [x] Pages written
- [x] Samples rendered
- [ ] Screenshot refreshed

## The maths

Coverage is $c = \\frac{documented}{types}$, and this release takes it to $1$.

> Everything above is one markdown string. Export it and it comes back the same.

See [[table:Fields]] for the field reference.` },
];

/* ---------------------------------------------------------------- apply */

const ensureSpace = (w, name, description) =>
  w.listSpaces().find((s) => s.name === name) ?? w.createSpace({ name, description });

/* Fills the blanks on a table that already exists — a workspace seeded before
   this file had a description, an icon or a noun should gain them — without
   overwriting anything someone chose deliberately. */
function ensureTable(w, space, name, { description = '', icon = '', noun = '' } = {}) {
  const existing = w.findTable(`${space}/${name}`);
  if (existing) {
    const patch = {};
    if (description && !existing.description) patch.description = description;
    if (icon && !existing.icon) patch.icon = icon;
    if (noun && !existing.noun) patch.noun = noun;
    if (Object.keys(patch).length) w.updateTable(existing.id, patch);
    return existing;
  }
  const db = w.createTable({ space, name, description, icon });
  if (noun) w.updateTable(db.id, { noun });
  return db;
}

const ensureField = (w, db, spec) => w.findField(db, spec.name) ?? w.addField(db, spec);

/* A select gains the option names it is missing, and keeps the ids of the
   ones it has — a bare string would re-slug and orphan every row pointing at
   the old id. */
function ensureOptions(w, db, fieldName, names) {
  const field = w.findField(db, fieldName);
  if (!field) return;
  const have = field.config.options ?? [];
  const missing = names.filter((n) => !have.some((o) => o.name === n));
  if (!missing.length) return;
  w.updateField(db.id, field.id, {
    config: { ...field.config, options: [...have.map((o) => ({ ...o })), ...missing.map((name) => ({ name, color: '' }))] },
  });
}

/* Upsert on the name. A page that already exists keeps its id, its inbound
   [[…]] links and its position; only its values and its document move. */
function upsertRow(w, db, { name, values, doc }) {
  const existing = w.findEntity(db, name);
  if (!existing) return w.createEntity(db, { name, values, doc });
  if (values && Object.keys(values).length) w.updateEntity(existing.id, values);
  if (doc != null) w.setDoc(existing.id, doc);
  return existing;
}

/* The Handbook: one page per field type, plus the guides that no single field
   page can carry. Idempotent — safe on a workspace seeded before either
   existed, and safe to run again after this file grows. */
export function applyHandbook(w) {
  ensureSpace(w, 'Handbook', 'Official documentation and how-tos');

  const guides = ensureTable(w, 'Handbook', 'Guide', {
    description: 'The prose no field page can carry — how to install it, how the model works, how a document is written, and what a workspace can be made to look like.',
    icon: 'iconly:document',
    noun: 'guide',
  });
  ensureField(w, guides, { name: 'Audience', type: 'select', config: { options: ['Human', 'Agent', 'Both'] } });
  ensureField(w, guides, { name: 'Order', type: 'number' });
  for (const g of GUIDES) {
    upsertRow(w, guides, { name: g.name, values: { Audience: g.audience, Order: g.order }, doc: g.doc });
  }

  const fields = ensureTable(w, 'Handbook', 'Fields', {
    description: 'One page per field type: what it stores, what it can be configured into, and what bites.',
    icon: 'iconly:category',
    noun: 'field type',
  });
  ensureField(w, fields, { name: 'Kind', type: 'select', config: { options: FIELD_KINDS.map((name) => ({ name, color: '' })) } });
  ensureOptions(w, fields, 'Kind', FIELD_KINDS);
  for (const f of FIELD_DOCS) {
    upsertRow(w, fields, { name: f.name, values: { Kind: f.kind }, doc: f.doc });
  }

  w.save();
  return w;
}

/* The document half of the Showcase space: every construct a document can
   hold, each row written in the construct it names. Needs the Showcase space,
   which seedFieldShowcase creates. */
export function applyFormattingShowcase(w) {
  ensureSpace(w, 'Showcase', 'Every field type, in several configurations — the range of what a field can be, visible in one grid');

  const t = ensureTable(w, 'Showcase', 'Formatting', {
    description: 'Every construct a document can hold, each row written in the construct it names.',
    icon: 'iconly:paper',
    noun: 'construct',
  });
  ensureField(w, t, {
    name: 'Construct',
    type: 'select',
    config: { options: ['Structure', 'Block', 'Format', 'Table', 'Code', 'Diagram', 'Math', 'Reference'].map((name) => ({ name, color: '' })) },
  });
  ensureField(w, t, { name: 'Syntax', type: 'text' });

  for (const s of FORMATTING_SAMPLES) {
    upsertRow(w, t, { name: s.name, values: { Construct: s.construct, Syntax: s.syntax }, doc: s.doc });
  }

  w.save();
  return w;
}
