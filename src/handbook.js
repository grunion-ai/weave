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
// A docs workspace that already exists gets the same apply on the first boot
// of each build whose pages differ (syncHandbook, Issue #255).

import { createHash } from 'node:crypto';

/* ---------------------------------------------------------------- fields */

/* `kind` groups the pages in the Fields table. The five original groups plus
   three the v0.4/v0.5 types earned: a definition is Meta, a keystore name is
   Secret, an upload is Files. */
export const FIELD_KINDS = ['Value', 'Choice', 'Relation', 'Computed', 'Document', 'Meta', 'Secret', 'Files'];

export const FIELD_DOCS = [
  { name: 'text', kind: 'Value', doc: `# text

Free-form single-line string. Every table is born with one: \`Name\`, the entity's identity and its link text everywhere. It can be renamed (Title, Subject, Invoice #) and it can become a **formula** — a computed name that follows its inputs; it cannot be deleted, because a row needs an identity. The row term (what one row is called) lives on it too.

## Config

\`default\` — the value a new row starts with. \`{ "name": "Title", "type": "text", "config": { "default": "Untitled" } }\`

\`literal\` — \`true\` paints the characters as typed. A text cell normally dresses inline markdown (\`**bold**\` reads bold, \`\\\`code\\\`\` reads as code); a column that HOLDS syntax — a regex, a glob, a format string, the Showcase's Syntax column — opts out with \`{ "literal": true }\`, from the field dialog's **Literal** box or \`--config '{"literal":true}'\`.

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
| \`format\` | \`number\` (default), \`currency\`, \`percent\`, \`compact\` | which costume the cell wears — \`compact\` prints 1.2M / 4.8K and composes with a currency ($1.2M) |
| \`currency\` | ISO code — \`USD\`, \`EUR\`, \`MXN\`, \`CNY\`, \`JPY\`, \`RUB\`, \`CAD\`, … | the symbol, when \`format\` is \`currency\` or \`compact\` |
| \`unit\` | any short string — \`kg\`, \`ms\`, \`seats\` | a suffix, on plain numbers and on formulas |
| \`decimals\` | integer | fixed places; defaults to 0, or 2 under \`currency\`, or 1 under \`compact\` |
| \`separator\` | boolean | thousands grouping (currency and compact group on their own) |
| \`accounting\` | boolean | negatives in parentheses — ($1,234.57) — the finance convention; needs \`currency\` |
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
weave field add Fund Raised number --config '{"format":"compact","currency":"USD"}'
weave field add Ledger Net number --config '{"format":"currency","currency":"USD","accounting":true}'
\`\`\`

Right-aligned with tabular figures, so a column of figures lines up on the decimal.

## In formulas & rollups

Aggregates: \`sum\`, \`avg\`, \`median\`, \`min\`, \`max\`, \`range\`, \`stdev\`, \`count\`, \`filled\`, \`empty\`, \`distinct\`. Formula: \`round(Price * Count)\`. A rollup of this column wears its costume.

## Gotchas

**A formula reads the raw number, never the costume.** \`$1,499.50\` is stored as \`1499.5\`; the currency, the unit and the separator are painted at read time. A formula that received the formatted string would break the moment someone turned on grouping — so it does not receive it.

Validates with \`Number()\`: \`"25000"\` coerces, \`"abc"\` is rejected.` },

  { name: 'date', kind: 'Value', doc: `# date
A point in time — or only the parts of one the field actually captures. Type it in any format you like — the cell parses what you meant and stores ISO.

A date field declares two things separately. Its **grain** is which parts it stores: any contiguous run of year · month · day, plus a time of day. Its **costume** is how the stored parts print. A card expires in a month, never on a day; rent falls on the 15th of no particular month. Storing the missing part would store a lie, so the grain leaves it out, and a costume that needs it is refused when the field is defined.
## Config
| Key | Values | Effect |
| --- | --- | --- |
| \`grain\` | a list from \`year\`, \`month\`, \`day\` — \`["year","month"]\`, \`["month","day"]\`, \`["day"]\`, \`["year"]\`, \`["month"]\`, or \`[]\` with \`time\` | which parts the field stores; omitted means all three |
| \`format\` | \`long\` (default), \`iso\`, \`us\`, \`eu\`, \`short\`, \`month\`, \`quarter\`, \`ordinal\`, \`relative\` | \`Sep 15, 2026\` · \`2026-09-15\` · \`9/15/2026\` · \`15.9.2026\` · \`Sep 15\` (the year only when it is not this one) · \`September 2026\` · \`Q3 2026\` · \`September 15th, 2026\` · \`in 2 weeks\` |
| \`pad\` | boolean | zero-padded numerals on \`us\` and \`eu\` — \`08/2026\` for a card expiry |
| \`time\` | boolean | store and show a time of day as well |
| \`clock\` | \`12h\` (default), \`24h\` | \`2:32 PM\` or \`14:32\` |
| \`zone\` | \`floating\` (default), \`fixed\`, \`instant\` | what the clock time means — see below |
| \`zoneName\` | an IANA zone — \`America/Los_Angeles\`, \`Europe/Berlin\` | the zone a \`fixed\` field lives in |
| \`default\` | a date, or \`today()\` / \`now()\` | what a new row starts with, evaluated per row and cut to the grain |
\`\`\`json
{ "name": "Expires", "type": "date",
  "config": { "grain": ["year", "month"], "format": "us", "pad": true } }
\`\`\`
## Usage
\`\`\`bash
weave field add Task Due date --config '{"format":"us"}'
weave field add Post Published date --config '{"format":"long","time":true,"clock":"12h"}'
weave field add Log Seen date --config '{"default":"now()","time":true,"zone":"instant"}'
weave field add Card Expires date --config '{"grain":["year","month"],"format":"us","pad":true}'
weave field add Lease [Rent day] date --config '{"grain":["day"],"format":"ordinal"}'
weave field add Store Opens date --config '{"grain":[],"time":true,"clock":"12h","zone":"fixed","zoneName":"America/Los_Angeles"}'
\`\`\`
Typing is forgiving: \`next friday\`, \`sep 15\`, \`15/9\`, \`in 3 weeks\` and \`2026-09-15\` all land on the same day. The picker button opens a calendar with month and year grids — or, when the grain stores less, a month/year picker, a month/day picker, a year, a day of the month, or just a clock — and the field's own format is shown as an example under the input.
## What the field stores
| Grain | Stores | For |
| --- | --- | --- |
| year · month · day | \`2026-08-15\`, \`2026-08-15T09:15\` with time | a due date, a meeting |
| year · month | \`2026-08\` | a card expiry, a monthly target |
| year | \`2026\` | a fiscal year, a vintage |
| month · day | \`--08-15\` | a birthday, an anniversary |
| month | \`--08\` | a seasonal window |
| day | \`---15\` | rent day, the 15th of every month |
| none, with time | \`09:15\` | an opening time |
These are the ISO 8601 truncated forms (XSD gYear / gYearMonth / gMonthDay / gDay), and they sort as text within a grain. A fuller value written to a narrower field is cut to the grain — \`2026-08-15\` into a year·month field stores \`2026-08\` — and a thinner one is refused: the store never invents a January or a year.
## What a clock time means
| \`zone\` | Stores | Means | Two readers in two cities see |
| --- | --- | --- | --- |
| \`floating\` | \`2026-08-15T09:15\` | a wall clock, no zone — the default, and what every existing field is | both 09:15 |
| \`fixed\` | \`2026-08-15T09:15\` + the field's \`zoneName\` | a wall clock in a named place | both 09:15 PDT |
| \`instant\` | \`2026-08-15T16:15Z\` | a point in history, stored as UTC | 09:15 in Los Angeles, 18:15 in Berlin |
An instant is the one case where the reader's own zone enters, and only because the field asked for it. Written through the API, an instant takes a \`Z\`, an offset, or a bare wall clock read as UTC.
## Query
\`\`\`json
{"where": [["Due", "<", "2026-10-01"], ["Due", "not-empty"]]}
\`\`\`
## In formulas
\`days(today(), Due)\` · \`if(empty(Due), "", days(today(), Due))\` · \`month(Expires)\`

A formula reads the stored value, never the costume, so \`year(Expires)\` on a year·month field is the year and \`day([Rent day])\` is the day.
## Gotchas
The format is a costume, like a number's. Comparison, sorting and date math all run on the stored value, so changing a column from \`us\` to \`long\` changes nothing but the reading.

**A costume can dress only what the grain stored.** \`month\` and \`quarter\` need a month, \`ordinal\` a day, \`relative\` a year — ask for one on a grain without it and the field refuses to be defined that way, with the missing part named. The tray only offers the styles the grain can wear.

**Narrowing a grain does not rewrite rows.** A \`2026-08-15\` already stored keeps its day; the costume simply stops printing it. Widening cannot invent the parts it never had.` },
  { name: 'daterange', kind: 'Value', doc: `# daterange
A start and an end, together: \`{"start": "2026-09-20", "end": "2026-09-27"}\`. Both ends wear the field's grain and costume.
## Config
| Key | Values | Effect |
| --- | --- | --- |
| \`grain\` | as for \`date\` — \`[]\` with \`time\` makes a range of clock times | which parts each end stores |
| \`format\` | the nine the \`date\` type takes | applied to both bounds; \`long\` inside one year says the year once — \`Aug 1 – Sep 15, 2026\` |
| \`pad\` | boolean | zero-padded numerals on \`us\` and \`eu\` |
| \`time\` | boolean | a time of day at both ends |
| \`clock\` | \`24h\`, \`12h\` | as for \`date\` |
| \`zone\` · \`zoneName\` | as for \`date\` | what the clock times mean |
| \`elapsed\` | boolean | append the span between the ends — \`09:15 – 17:40 · 8h 25m\`; needs \`time\`, and two clock readings wrap at midnight |
| \`default\` | a range | what a new row starts with |
\`\`\`json
{ "name": "Hours", "type": "daterange",
  "config": { "grain": [], "time": true, "clock": "12h", "elapsed": true } }
\`\`\`
## Usage
\`\`\`bash
weave field add Trip Window daterange --config '{"format":"long"}'
weave field add Store Hours daterange --config '{"grain":[],"time":true,"clock":"12h","elapsed":true}'
weave update 'Trip#3' --values '{"Window": {"start": "2026-09-20", "end": "2026-09-27"}}'
weave update 'Store#1' --values '{"Hours": {"start": "09:15", "end": "17:40"}}'
\`\`\`
## Editing a range
One control, one dialog (Issue #197). The cell, the entity page and the tray's **default** all wear the same control: a box that reads the whole span in the field's costume — \`2026-08-01 – 2026-09-15\`, \`Aug 1 – Sep 15, 2026\` — and a calendar button that opens **one range dialog**. The first click on the calendar sets the start, the second sets the end (an earlier second click swaps the two), and the days between them are lit. Two typed inputs sit inside the same dialog: Enter on **Start** begins a new span and hands focus to **End**; Enter on **End** closes the span and the dialog. **Clear** empties the range, **Today** picks today for whichever end is next. The dialog follows the grain: a year·month range picks two months, a year range two years, a range of clock times two times; a field with a time of day shows a start and an end clock under the calendar.
Typing into the box works too — \`2026-08-01 – 2026-09-15\`, \`aug 1 to sep 15\`, \`9/1/26 - 9/30/26\` — each end read the way a single date is.
## Gotchas
Half a range is not a range: the server refuses one end, so an unfinished pick stays in the dialog until the other end lands, and one date typed alone into the box is refused with a toast. The elapsed span is computed at read time from the two ends and never stored — a formula wanting it uses \`datediff\`.` },

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

  { name: 'toggle', kind: 'Value', doc: `# toggle

Boolean, worn as a switch with two named states (Feature #202). Same storage as a checkbox — \`true\` / \`false\` is what a formula, a filter, a CSV cell, the API and MCP read — but the config names the states, and every surface that draws the value draws the switch with the label of the state it is in: the grid cell, the entity page, the chip and the card, the filter strip. Null normalizes to \`false\`, so a toggle is never empty.

## Config

\`on\` and \`off\` — the two labels, renameable, \`On\` / \`Off\` unless named: \`{ "name": "Feed", "type": "toggle", "config": { "on": "Live", "off": "Paused" } }\`. Both must be words, and they must differ.

\`default\` — the state a new row starts in when the create does not name the field: \`{ "config": { "on": "Public", "off": "Private", "default": false } }\`.

## Usage

\`{"Feed": true}\`, or the label — \`{"Feed": "Live"}\` writes \`true\`, \`{"Feed": "paused"}\` writes \`false\` (case-blind); any other word is refused by name. CSV import accepts the labels and \`true\`, \`1\`, \`yes\`, \`✓\`, \`x\`; CSV export writes \`true\` / \`false\`.

In the grid a click flips it, and so does \`Space\` on the resting cell — the one cell where Space is not row selection. The table filter offers the two labels the way it offers a workflow's states.

## Migrations

\`checkbox\` ⇄ \`toggle\` both ways, lossless: the values and the default ride along, the labels start at On / Off. To \`text\`, each row freezes the label it showed.

## In formulas

\`if(Feed, "live", "paused")\` — the value is the boolean, never the label.

## Gotchas

\`is-empty\` never matches a toggle — \`false\` is a value, not a hole. Renaming a label changes what the switch says, not what any row stores; a filter saved on the old label is refused until it names the new one.` },

  { name: 'url', kind: 'Value', doc: `# url

A string the grid renders as a link, opening in a new tab. Click the link to open it; use the pencil beside it, double-click, or press Return on the cell to change the address.

## Config

\`default\`.

## Usage

\`{"Repo": "https://github.com/grunion-ai/weave"}\` — no scheme validation is enforced on write. Any scheme draws as a link — \`claude://resume?…\` and \`mailto:\` open in place through their handler, \`http(s)://\` opens a new tab — except \`javascript:\`, \`data:\`, \`vbscript:\`, \`blob:\` and \`file:\`, which rest as a text box so a stored string can never run in the reader's tab.

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

**Leave \`states\` out and you get one.** A workflow whose config never mentions states arrives as \`Not started\` · \`In progress\` · \`Done\` · \`Canceled\` — one per category, \`Not started\` the default — in the tray and on \`weave field add\` alike. Rename, reorder, recolour or delete them like any others. Sending \`"states": []\` is a different thing and still refused: a list emptied on purpose is not a lifecycle.

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

A link between tables. One target table makes the classic bidirectional pair — the inverse field appears on the other table in the same write. A **target set** (\`targetDbs\`, two or more tables) makes a polymorphic relation: one field whose values may point at rows of ANY member table — the registry's \`Workspace/Spaces\` and \`Workspace/Tables\` are legal members, so a row can point at a space or a table as easily as at another row.

## Config

Created with its own verb, not \`add_field\`: \`targetDb\` (or \`targetDbs\`, a list), \`cardinality\`, \`inverseName\`.

Cardinalities: \`many-to-one\` (the default), \`one-to-many\`, \`many-to-many\`, \`one-to-one\`. For a target set only this side's arity matters: \`many-to-one\` holds one chip, \`many-to-many\` holds a set.

A target set is **one-way**: no inverse field is minted (it would have to be sprayed across every member table). The reverse direction is a read, not a stored field. Chips from a target set carry their home table, and the picker searches every member.

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

Deleting a relation deletes both ends. Deleting a member table of a target set prunes it from the set; the last member takes the field with it.

Lookups and rollups need a single-target relation — a target set has no one far table to read a field from. Filters still traverse it: each linked row resolves against its own table, so \`[["Scope.Name", "=", "Apollo"]]\` matches whichever member table Apollo lives in.` },

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

Across a to-many relation a lookup takes the first match; use a \`rollup\` with \`join\` when you want all of them.

The \`targetField\` cannot be deleted while a lookup reads it — the delete is refused and names the lookup; delete the lookup first. A lookup that already lost its target (a workspace from before that refusal) reads \`null\`.` },

  { name: 'rollup', kind: 'Computed', doc: `# rollup

An aggregate over everything on the far side of a relation — or, on a space's row, over a whole table.

## Config

\`relationField\`, \`aggregate\`, and \`targetField\` for every aggregate except \`count\`.

| Aggregate | Reads | Answers |
| --- | --- | --- |
| \`count\` | the rows | how many |
| \`filled\` / \`empty\` | the rows | how many say something / nothing in \`targetField\` |
| \`distinct\` | the rows | how many different values \`targetField\` holds (a multiselect counts each chip) |
| \`sum\` / \`avg\` / \`median\` | the numbers | the total, the mean, the middle value |
| \`min\` / \`max\` | the numbers, or the strings when there are none | the extremes — the earliest and latest of a date column |
| \`range\` / \`stdev\` | the numbers | max − min; the sample standard deviation |
| \`join\` | the display values | one string, \`separator\` between (default \`, \`) |

\`\`\`json
{ "name": "Peer names", "type": "rollup",
  "config": { "relationField": "Peers", "aggregate": "join", "targetField": "Name" } }
\`\`\`

## Over a whole table: the space rollup

The Σ under a grid column is a rollup on the **Workspace/Spaces** row of the space that holds the table (Kyle, 2026-09-06: "all footer values live at the space level"). \`via\` names the table instead of a relation; \`where\` narrows the rows with the same clauses a query takes.

\`\`\`json
{ "name": "Sessions · Cost · sum", "type": "rollup",
  "config": { "via": "Agent/Sessions", "targetField": "Cost (USD)", "aggregate": "sum",
              "where": [["Kind", "=", "scheduled"]] } }
\`\`\`

Three surfaces write that field. The Σ row's picker turns one on with a switch, \`weave field add\` / \`weave_add_field\` take the config above, and the field dialog on the **Workspace/Spaces** grid asks **Rolls up** — through a relation, or over a table — where *Over a table* picks the table, the aggregate and the column. Only the API writes a \`where\`.

A grid carries no Σ row until you ask for one: switch **Σ rollup row** on in the eye's Rows section and the grid draws every space rollup in a **Σ row** pinned under the field headers — it stays while the body scrolls — and offers the aggregates on a click in that row. The switch is the table's \`hideRollups\` (mirrored as **Hide Rollups** on its Tables row, like the filter and the sort — never a browser setting): \`false\` is the table that opted in, \`true\` is one switched back off, and a table nobody has touched has no row. The space page draws the same rollups as tiles; \`weave stats <table>\` / \`weave_stats\` / \`GET /api/tables/:ref/stats\` summarise every column on demand without storing anything. A space rollup answers on its own space's row and reads \`null\` on every other; \`via\` is refused anywhere but the Spaces registry and on registry tables.

## Usage

Renders on a tinted background marked \`Σ\`, wearing the target column's costume: a sum of dollars is dollars, the \`max\` of a date column is a date; a mean of whole numbers shows two decimals. \`join\` accepts a \`separator\`; the default is \`, \`.

## Gotchas

A rollup crosses a relation; a formula stays on the row. Reaching for a formula where a rollup does the job is the most common way to end up with a number that will not update.

The \`targetField\` cannot be deleted while a rollup reads it — the delete is refused and names the rollup; delete the rollup first. A rollup that already lost its target (a workspace from before that refusal) reads \`null\`; \`count\` never had a target and keeps counting.` },

  { name: 'formula', kind: 'Computed', doc: `# formula

An expression over this row's own fields, recomputed on read.

## Config

\`expression\`, plus every number costume key — \`format\`, \`currency\`, \`unit\`, \`decimals\`, \`separator\`, \`accounting\` — so a computed figure can wear the same clothes as a stored one.

\`\`\`json
{ "name": "Total", "type": "formula",
  "config": { "expression": "Price * Count", "format": "currency", "currency": "USD" } }
\`\`\`

## Usage

Field names go in bare when they are plain identifiers; anything else — a space, a keyword, a name that reads as a function — rides in \`[brackets]\`.

\`\`\`
Price * Count
concat(upper(Category), " · ", Priority)
if(empty(Due), "", days(today(), [Due Date]))
if(empty(Estimate), "unsized", if(Estimate > 5, "large", "small"))
\`\`\`

Renders on a tinted background marked \`ƒ\`. In the field dialog, formula is a checkbox on any type — ticking it opens the script editor.

## Check before you save

The script editor validates as you type: a parse error, an unknown function or an unknown field shows under the box in red, and a valid expression shows its computed value on a real row. The same check stands alone as \`weave formula check <table> '<expression>'\`, \`POST /api/tables/:id/formula-check\` and the \`weave_check_formula\` MCP tool — validate until \`ok: true\`, save, then read a cell back. Saving an invalid expression is refused with the same error the check gives.

The chips under the script are the whole vocabulary: this table's fields first, then the functions in the four groups the grammar has — **logic** (\`if\`, \`empty\`, \`contains\`), **text**, **number**, **date**. Hover, focus or tap a chip and a card shows its signature, one sentence of what it does and an example; click it and the call lands with the caret between the parens. A document or an attachments field is listed greyed with the reason — a formula reads values, not prose or files — rather than left out. \`weave vocabulary formulaFunctions\` (and \`weave_vocabulary\`, \`GET /api/vocabulary\`) serves the same cards verbatim.

Under the chips, **As an agent would do it** (closed by default) prints the three calls that do what the dialog is doing — \`weave formula check\`, \`weave field add\` (or \`update\`) with the expression, \`weave get\` to read the cell back — and the MCP sequence \`weave_check_formula → weave_add_field → weave_get_entity\`, live with the typing. Copy it into a script and the browser was never the only door.

The verdict line names the result's **type** (number, text, boolean, list) and the dialog scans the table behind it — up to 200 rows — so the line under it reads \`row 1 of 51 — "Acme"\` with ‹ › to step through rows and pick the pathological one, and \`⚠ 2 rows → null · 1 → #ERR\` when any row did not compute. A formula valid on row 1 and null on a third of the table is exactly the bug one preview cannot show. The **Result format** section (currency, unit, decimals) only appears when the result is a number. The same figures come back from \`weave formula check <table> '<expression>' --scan\` and \`weave_check_formula {scan: true}\` as \`{type, scan: {rows, capped, nulls, errors, sampleByOutcome}}\`.

Chips are discovery; typing is speed. In the script box, \`[\` opens a list of this table's readable fields at the caret and two letters open the functions that start with them — the same two lists the chips draw from, ranked by prefix. ↑ ↓ move, Return picks (a call lands with the caret between its parens), Escape closes the list and nothing else. A misspelled field name dies at the keystroke instead of at the check; the verdict line stays live underneath.

## Gotchas

A formula reads **raw** values. A number's currency and unit are display costumes and never reach the expression, which is what keeps \`Price * Count\` from breaking when someone turns on thousands separators.

A formula cannot reference its own field — it never converges, and the save refuses it as an unknown field.

A formula cannot cross a relation. That is what \`lookup\` and \`rollup\` are for.` },

  { name: 'document', kind: 'Document', doc: `# document

A markdown document that belongs to one row. Every table has one — \`Description\` — and a table may carry as many more as it needs.

The first one is a **role**, not a name. Rename it to \`Notes\` and it is still the description: the table points at it by id, so \`weave doc set Task#5\` without a \`--field\` still finds it, and the schema descriptor carries \`role: "description"\`. Delete it and it stays deleted — no migration puts it back.

## Config

\`kind\` — \`markdown\` (the unmarked default), \`html\`, or \`code\`.

\`\`\`bash
weave field add Task Spec document
weave field add Workflow Script document --config '{"kind":"code"}'
weave field update Task Description --name Notes   # still the description
\`\`\`

## Usage

The description takes a column of its own and previews what it says: the first line, formatted — a heading as its words, bold as bold, never a hash or a pair of asterisks — and the first few lines when you hover it. A document that is not prose is named instead of flattened: \`HTML page\` (or its own <title>), \`JSON model\`, \`graph diagram\`.

Every OTHER document is a column of its own in the grid: a named chip wearing the kind it holds — the declared kind when the field declares one, the sniffed kind otherwise. It hides behind the eye, resizes and reorders like any field. All documents open in full on the entity page and in the dock.

\`\`\`bash
weave doc set Task#5 --field Spec --content '# Spec'
weave doc append Task#5 --field Spec --file notes.md
weave doc export Task#5 --format pdf --out t5.pdf
\`\`\`

Every document is addressable as MD, HTML, MMD and PDF at \`/e/<id>/doc/<Field>.<fmt>\`.

## What a document can hold

Headings that fold, tables, task lists, code blocks that detect their own language, mermaid diagrams, KaTeX math including chemistry, raw HTML, \`[[…]]\` chips that link to any entity, table or space, and \`:name:\` icons drawn from the set. See the **Document formatting** guide for the whole surface.

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

\`text\`, \`number\`, \`date\`, \`daterange\`, \`checkbox\`, \`toggle\`, \`url\`, \`email\`, \`select\`, \`multiselect\`, \`workflow\`, \`document\`, \`field\`, \`key\`, \`attachments\`.

\`relation\`, \`lookup\`, \`rollup\` and \`formula\` are absent on purpose: each needs a target that only exists in a table's context, so each has its own verb.

## Gotchas

A \`Definition\` cannot change a field's **type** — drop the column and create it anew. Pass the object with a \`config\` key; a bare \`{type, options}\` is accepted and silently does nothing.` },

  { name: 'key', kind: 'Secret', doc: `# key

A **credential**: an API key, a token, a shared password, an OAuth pair, or an id you would rather not print. The cell holds the credential's NAME. The secret itself lives in \`~/.weave/keystore.json\` — encrypted, chmod 600 — or in the manager that already owns it, and never in the workspace.

## Config

\`kind\` — \`apikey\` (default), \`token\`, \`password\`, \`id\`, \`pair\`. Metadata: it changes the label and the glyph, never what the cell stores.

\`keystore\` — \`local\` (default), \`1password\`, \`aws-sm\`, \`google-sm\`, \`cloudflare\`, \`apple-passwords\`. A remote store keeps its own access rules; weave holds only the ref and offers a link.

\`parts\` — a \`pair\` only. Two \`{ name, secret }\` entries, defaulting to \`id\` and \`secret\`. One credential with two parts, so an OAuth id and its secret stay under ONE grant.

\`\`\`json
{ "name": "Portal Login", "type": "key", "config": { "kind": "password", "keystore": "1password" } }
\`\`\`

## Usage

\`\`\`bash
weave key set vendor-portal --value s3cr3t
weave key set vendor-portal            # reads stdin
weave key list                         # names, owners, who each is shared with
weave update 'Field Types#1' --values '{"API key": "vendor-portal"}'
\`\`\`

The cell reads \`✱✱✱✱ vendor-portal\`, or \`✱✱✱✱ vendor-portal (unset)\` when the local keystore has no such name yet. A remote keystore gets no \`(unset)\` — weave cannot see inside 1Password and will not guess.

## Who can read it back

Everywhere else in weave, reaching the table reaches the values. A credential looks like the exception and is not one: the secret was never IN the table. The name is ordinary table data that anyone with the row can see; the secret sits behind the credential's own access list.

\`\`\`bash
weave key reveal vendor-portal          # owner, or someone granted — prints the bare value
weave key share vendor-portal --with sajit
weave key unshare vendor-portal --with sajit
\`\`\`

A new credential is owned by whoever set it and shared with nobody. Copying counts as revealing, and every reveal and every grant lands in the audit log. **There is no MCP reveal** — an agent can name, set, share and drop a credential, never carry the secret out.

## Gotchas

There is still no read-back GET, on any surface. Reveal is a POST because it is an act, not a read.

A credential written before this — anything from the original keystore — has no owner and no grant, so nobody reveals it until someone claims it with \`key share\`. The promise the old keystore made about everything it stored still holds.

Storing a name the keystore does not hold is allowed on purpose — set the row first and the secret later. An export carries the names and none of the values, and neither does a formula, a lookup or a query result.` },

  { name: 'view', kind: 'Meta', doc: `# view

How one row **appears elsewhere**. Every table carries two, minted with it and hidden from the grid until someone unhides them: **Chip**, the row inline — a relation cell, a \`[[Table#12]]\` mention in a document, a reference card — and **Card**, the row as a tile — a board column, a gallery, a peek. The config is the table's and the same for every row, so a task looks like a task wherever it turns up. The entity page draws each one the eye leaves on, in its **Appears as** strip, so a reader sees the row the way the rest of the workspace will; switch Chip or Card on in the eye to see it there, off and it goes from the strip and the grid alike.

## Config

\`shape\` — \`chip\` or \`card\`. Fixed: it is which of the two this field is.

\`link\` — show the public id as a permalink (\`#12\`). A card says yes by default; a chip no.

\`state\` — show the workflow state, first. On by default for both.

\`description\` — a preview of the description document: \`none\`, \`small\` (the first line), \`medium\` (about 120 characters across the first lines), \`large\` (about 320). A chip defaults to \`none\`, a card to \`small\`. Prose only: a page, a JSON model or a diagram is named, never flattened.

\`fields\` — the other fields to show, by name, in this order — or \`null\` to take the first few non-empty glanceable values in column order, which is the default: arranging the columns IS the curation. A chip auto-fills to three segments in all, a card to four; the state counts as one. Documents, files, keys and definitions cannot ride along, and neither can the name (always shown) or the views themselves.

\`\`\`json
{ "name": "Card", "type": "view", "role": "card",
  "shape": "card", "link": true, "state": true, "description": "small", "fields": ["Owner", "Due"] }
\`\`\`

## Usage

The chip and the card are roles, like the description: \`describeSchema\` marks them \`role: chip\` / \`role: card\`, and a schema document is matched on the role, so a renamed Chip is still the chip. Rename freely. There is no delete — every row has a chip and a card by existing — and no \`add_field\` of type \`view\`: configure the minted pair.

\`readEntity\` ships both under their field names — the one-line form (\`Ship the editor · Doing · Due 2026-09-12\`) in \`fields\`, the object (\`{ shape, id, publicId, url, name, link, state, description, fields }\`) in \`raw\` — and every relation summary carries the far row's \`chip\`, so a relation cell and a doc mention draw the same chip. \`weave_update_field\` with \`{ config: { fields: ["Owner"], description: "medium" } }\` changes it for every row of the table at once. \`GET /api/entities/:ref/view?shape=card&config={…}\` draws one row under a candidate config without saving it — the field dialog's live preview.

## Gotchas

\`fields\` arrives as names and is stored as ids: a renamed field keeps its place on the card, and a deleted one falls off it rather than breaking it.

Unhiding a view puts a read-only column in the grid; a chip cell draws the chip, a card cell a compact card. CSV export leaves both out — they are presentation over the other columns, not data. A partial \`fieldOrder\` may leave them out too; they keep their place at the end.

A card cannot show the description of a table whose description was deleted; \`description\` is then simply empty.` },

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

Files are not documents. A document is written and rendered; an attachment is stored and handed back. Copying the \`.db\` on its own drops every attachment — back up \`files/\` beside it, or take a \`weave export\`, whose JSON carries the bytes inline and lands them in \`files/\` again on import.

A file whose bytes are gone keeps its name and is marked \`(missing)\` in the cell and on the record. Metadata outlives the blob, so weave says which file was lost rather than offering a link that cannot open.

A file delete is not undoable.` },
];

/* ---------------------------------------------------------------- guides */

export const GUIDES = [
  {
    name: 'Document formatting',
    audience: 'Both',
    order: 8,
    doc: `# Document formatting

Every entity carries at least one document, and a table can give it more. This page is what a document can hold. Inline, \`:name:\` draws any icon from the set (\`:bell:\` is the bell) where an emoji shortcode would go; see the Formatting showcase.

## The editor is the renderer

There is no edit mode, no preview pane and no save button. A heading becomes a heading as you finish typing it, and what is stored underneath is plain markdown — the same text the API returns, the same text an automation appends, the same text \`doc export\` writes out.

Nothing in a document is a proprietary block. Copy it into a file, hand it to an agent, put it under version control; it stays what it is.

## The toolbar

Select some text and the toolbar floats in over the selection — headings (with a level dropdown), bold, italic, strikethrough, inline code, link, the three list kinds, outdent and indent, quote, code block, table, divider, undo, redo, and file upload. Hover any button for its name and shortcut. The bar leaves when the selection does; the document keeps a clean top edge. Uploads attach to the entity and land in the document as inline viewers — images, PDFs and HTML files render centered at a medium width with a resize grip in the corner; any other file type gets a plain link. Hover a viewer for its toolbar: **Show as link** swaps the viewer for a plain link. Viewers survive every export — the \`.md\` keeps the markdown verbatim, the \`.html\` renders them, the \`.pdf\` still builds. The full catalogue (references, mermaid, raw HTML, math) stays in the slash menu.

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

A document with three or more headings grows a minimap down its edge: one dash per heading, longer for higher levels, a tracker that follows the scroll. Click the rail and the minimap widens in place into a panel of headings — same spot, same left edge; click a heading to jump, press Escape or click away to close. Below three headings a map explains nothing, so no rail appears.

## Full screen

Any document opens full screen from its frame, and markdown editing works there exactly as it does in the panel. That is where a long document is worth writing.

## Kinds

A document field carries a \`kind\`: \`markdown\` (the default), \`html\`, or \`code\`. The declared kind rules how the entity page renders the document — an \`html\` field runs in its frame with the \`</>\` source toggle, a \`code\` field edits directly in the monospace code box — and a field that declares nothing falls back to sniffing its content: a complete HTML file runs as an app, a mermaid source draws as a diagram with the same \`</>\` source toggle, a JSON model edits in the code box, and anything else is markdown. A \`code\` document is what the \`Workflows\` registry's \`Script\` column uses — a document that is a program rather than prose.

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

The name and logo ride the icon rail on the far left, which is how you switch between workspaces served side by side at \`/w/<name>/\`. Right-click any chip (or click the current one) for its menu: **Update logo…** picks an image for that workspace, whether or not it has one yet; **Remove logo** clears it; **Delete workspace…** asks you to type its name to confirm, and it moves to the trash — a small trash glyph in the bottom-right corner, under the bug button beside the version tag, that appears only while something is in it and opens a sheet with a Restore per workspace; the default and the \`weave\` docs workspaces cannot be deleted. The theme toggle is light, dark, or follow the system, and every surface — chips, code blocks, diagrams, the relation map — is drawn in both.

## Icons and nouns

A space and a table are born with an icon and can be given a better one:

\`\`\`bash
weave space update Finance --icon lucide:wallet
weave table update Invoice --icon lucide:file --noun invoice
\`\`\`

The icon value is **\`lucide:<name>\`** — one of the names in weave's inventory, Lucide shapes curated for what a space, a table, an option or a state tends to be called (\`activity bell bookmark bug calendar chart-bar compass file-text folder funnel heart house layout-grid lock mail map-pin pencil search settings shield-check star trash-2 users wallet\` among them; \`weave vocabulary icons\` lists them all). Most of them move — once when the page loads, once when the picker scrolls them into view, once per hover, never on a loop. A value stored before 2026-09-02 as \`iconly:<name>\` keeps drawing through a built-in alias, so nothing migrates. An emoji is not an icon: the engine refuses any value outside the inventory (Kyle, 2026-09-02).

The **noun** is what one row is called — the table's *row term*. It lives on the Name field (open the Name column's menu → Edit field → "Rows in this table are…"), with a curated list to pick from and a plural you can correct. Every surface speaks it: the create control says "New invoice" instead of "New Invoice", the selection puck counts "3 invoices", the trash toggle reads "Deleted invoices". \`--noun\` on the CLI and \`noun\` over MCP set the same term.

## The grid reads as a record

The table view is a ledger, not a form. The \`#id\` link opens the row in the **dock** beside the table; **every other cell edits in place**, raising that field type's own editor with the cursor already in it. A text, number, date or url cell opens with its **whole value selected**, so typing, \`⌘C\` and \`⌘V\` act on the value you can see; a second click inside the open cell places the caret. Chips keep their tint and lose their box. Computed cells keep their glyph and drop their ground. A row hover draws no lines between fields; the row's tint is the feedback. The one cell under the pointer shows the control a click would open.

The dock is the entity itself, not a preview: edit there and the table keeps its place, the docked row stays lit, Esc closes it. **Docked is the default pose** (Issue #198): a relation chip, a card, a mention chip in a document, a ⌘K hit and a document chip in a cell all open the entity beside its table — travelling to that table first when you were somewhere else. The outward diagonal arrows on the dock expand it to the full page (⌘⇧E flips either way); the inward arrows on the page dock it again. Only a \`#/entity/…\` address opens as the page — the address a new tab, a permalink and the expand arrows land on. ⌘-click a row (or its \`#id\` link) to give the record its own browser tab. Every navigating surface in weave answers the same three gestures — ⌘/Ctrl, Shift, and the middle button — so an activity row, a ⌘K hit and a node on the relation map open in a tab the same way. Text cells keep their own modifiers: shift-click still extends a selection there. A document chip in a cell opens its entity in the dock.

## The grid from the keyboard

Cells **rest as values** and open on purpose. The cursor is a ring on one cell; the arrows and Tab move it, and a cell opens when you ask. That is what gives ← and → to navigation: a text caret only owns them while a cell is open, and hands them back when you Tab, Return or Esc out.

| At rest | What it does |
| --- | --- |
| \`← → ↑ ↓\` | move the cursor |
| \`Tab\` / \`⇧Tab\` | along the row, wrapping into the next or previous row; the last cell of the last row is the end, never the browser's chrome |
| \`Return\` | open the cell: a caret with the value selected, a picker, a flipped checkbox |
| any character | open the cell and start typing over the value |
| \`Space\` | pick the row up — or, on a toggle cell, flip the switch |
| \`⇧↑\` / \`⇧↓\` | extend the run of chosen rows |
| \`⌘A\` | take the whole table |
| \`⇧Return\` | make the next row, open on its name |
| \`⌘Return\` | open the record in the dock |
| \`Esc\` | let the selection go |

| In an open cell | What it does |
| --- | --- |
| \`← →\` | the caret's; they never step out of the cell |
| \`Return\` | commit, move down the column |
| \`Tab\` / \`⇧Tab\` | commit, move across |
| \`↑\` / \`↓\` | commit, move up or down |
| \`Esc\` | put the value back and rest |
| \`Space\` | a space |

Every field cell is a stop, select, multi-select, checkbox and date included. A document chip column is not: it is a door to the record, not a value, so the cursor passes over it. The checkbox column and the \`#id\` link are pointer targets; \`Space\` and \`⌘Return\` are their keys.

## Ranges, fill and paste

A rectangle of cells is a **range**. Grow one with \`⇧\` and the arrows, or drag the pointer across the cells; the range is what a fill and a paste act on, and drawing one writes nothing.

| Gesture | What it does |
| --- | --- |
| \`⇧← ⇧→\` | grow the range sideways from the resting cell |
| \`⇧↑ ⇧↓\` | grow it up or down — **unless a row is picked up**, where they still extend the run of rows |
| Drag across cells | the same rectangle, from the pointer |
| Drag the corner handle | fill: the range's values, down or across, over everything the handle covers |
| \`⌘C\` | copy the range, or the cell the cursor is on |
| \`⌘V\` | paste, tiled to fit whatever it lands on |
| \`Esc\` | let the range go — a row selection goes first when both are up |

\`⌘C\` and \`⌘V\` **follow the selection**, in every kind of cell. Text selected inside an open cell is the browser's own copy and paste — the text moves. With no text selected — a bare caret, a picker open, a checkbox, a cell at rest — they take the **cell**: \`⌘C\` copies its value, typed, and \`⌘V\` writes the clipboard into it through the same write a paste onto a range makes, with the same Undo. A clicked text cell opens with its value selected, so the two readings agree until you place the caret.

The blue square on the range's bottom-right corner is the **fill handle**. Drag it down a column or across a row and the range's values are written into every cell it covers — one value down twenty rows, or a whole row of values across. It moves along one axis, whichever you pull further.

\`⌘C\` puts two things on the clipboard at once: tab-separated text a spreadsheet reads, and the same block **typed**, which is what another weave tab reads back. That is what makes a select paste as an option and not as a word, and a multi-select carry its whole set. Pasting onto a single cell lays the block down from there; pasting onto a range fills the range, repeating the block to cover it — so one copied cell fills twenty.

What the types force:

- **Select, multi-select and workflow paste by option identity.** Within a table the option itself carries over. Into a different table the label goes instead, and a label that names no option there is **refused**, never invented.
- **A multi-select pastes as a replacement**, never a merge: the set you copied is the set the cell ends up with.
- **A formula, rollup, lookup, view, relation or document column takes no paste.** The cell refuses and the message names the column, the way the selection bar names what did not land.
- **Text from a spreadsheet** fills the range row by row. Each column reads it in its own terms — a number parsed, a checkbox read (\`false\` is false), a comma list split into a set — and a cell that will not read is dropped and counted while its neighbours land.

A fill or a paste is written the same way the selection bar writes: \`POST /api/bulk\`, one call per distinct set of values, reported per row. Rows that receive the same values share one call, so a fill down a column is **one write**, and the message it raises carries an **Undo** that steps the whole thing back at once.

## Working on many rows at once

The checkbox column sits **left of the \`#\` link**, so the link never disappears while a selection is live. It draws nothing at rest: the box appears when the pointer is on the row, and every box in the column stays lit once anything is chosen.

Because a bare cell click already means *edit this cell*, it cannot also mean *choose this row* — the box is the only way in. **Shift-click a second box** and everything between it and the last one is taken. The header box is select-all, and wears a dash while the selection is partial. \`Esc\` clears.

| Gesture | What it does |
| --- | --- |
| Click a box | chooses that row |
| Shift-click a box | takes the span from the last box hit |
| Click the header box | all, then none |
| \`Esc\` | clears the selection |

A selection is a set of **records**, not of positions: sort the table and the same rows stay chosen. Rows that leave the page — trashed, filtered out — leave the selection with them. Trashed rows carry no box at all.

Once a row is chosen, a bar sits at the bottom centre of the window saying how many it holds — the window, not the table, so it is in reach on a grid taller than the screen, and the grid keeps a floor under it so the last row is never covered. The bar is contextual: a table with no relation gets no *Link to…*, a workspace with one table gets no *Move to table…*.

| On the bar | What it does |
| --- | --- |
| **Set a field…** | pick a field, then a value — state chips, options, checked or unchecked, or a typed box — and it is written across the selection. State is a field like any other here, so a table with two workflow fields needs no second button |
| **Link to…** | pick a relation, search the far table, pick one row: every chosen row is linked to it |
| **Duplicate** | copies each row's writable fields; computed fields and documents are not copied, because a computed field is a read and recomputes itself on the copy |
| **⋯** | the overflow below |
| **Move to trash** | past a hairline, on its own |

| Under ⋯ | What it does |
| --- | --- |
| **Move to table…** | re-creates each row in the chosen table, matching fields by name and type, and trashes the original. Fields the far table lacks, files and comments stay behind — the bar names them |
| **Roll up into a new …** | pick a relation, name one new parent in its table, and every chosen row is linked to it |
| **Copy links** | one permalink per chosen row on the clipboard; the selection stays |

Set a field, Link to, Move to table and Roll up are each one write (\`POST /api/bulk\`, \`weave bulk\`, \`weave_bulk\`), reported per row. If part of it fails, the bar says what did **not** land rather than reporting a success it cannot vouch for, and each row keeps its own undo step. A \`set\` also reports \`changed\` — the rows whose value actually moved, which is how deep the undo stack it left goes, and what the grid's fill and paste count before offering to step one back.

## Column order, width, and what is on screen at all

| Control | Where | What it does |
| --- | --- | --- |
| Drag a header | table view | reorders columns, stored on the schema for everyone |
| Drag a header's right edge | table view | sets a width — the column follows the pointer and stops at its own label |
| Double-click that edge | table view | fits the column to its content, no cutoff |
| Click a header | table view | opens the field tray — rename, retype, reconfigure |
| 👁 | view toolbar | show or hide any field, the system columns, and deleted rows |
| Drag the grip | entity page | reorders fields; the table's columns follow |
| Fold FIELDS | entity page | the caret beside FIELDS folds the value rows into one line of label · value chips, so a long field list stops pushing the documents down; the chips still edit in place, and the fold is remembered per row in this browser |

The **#** column takes none of this. It is frozen to the grid's left edge, so a wide table scrolls sideways underneath it and the row keeps its id and its \`\u2197\` permalink whatever column you have read your way out to; the selection checkbox travels with it. No drag moves it, and no field can be ordered ahead of it.

Two facts about width decide how a table reads: **an unset column caps at 260px and ellipsises**, and **a set width is a floor as well as a ceiling** (60px minimum, and never narrower than the header's label), so the column holds its width in a grid wider than its card. Set one only where the default clips something a reader needs.

The five system columns — \`Created At\`, \`Modified At\`, \`Created By\`, \`Modified By\`, \`Activity\` — are off by default. Turn them on where provenance is part of the record.

Hide rather than delete when a column matters to a machine and not to a reader. Hiding keeps the data and the API surface; a delete needs \`hard\` and does not come back.

## What a field means

Every field can carry a **description**: what the value represents and how it is written — \`Who we bought from — the legal name on the invoice\`, \`ISO date of the first event in the transcript\`. It sits under the label on the entity page and in the folded chips, is the column header's tooltip in the grid, and rides the schema (\`weave_schema\`, \`weave schema\`, \`GET /api/schema\`) as the field's \`description\`, so an agent filling the row reads the same note a person does. Set it in the field tray (click a header, or a label on the entity page), or from the schema verbs:

\`\`\`bash
weave field update Order Vendor --description "Who we bought from — the legal name on the invoice"
weave field add Order "Due" date --description "When the invoice falls due; ISO date"
\`\`\`

\`{description: null}\` clears it. The two view fields are the exception: on Chip and Card, \`description\` is the description **size** (none, small, medium, large), not a note.

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

The share URL carries its own capability. Anyone holding it reads that view and nothing else — no account, no login, and the link stays open when the workspace requires authentication. The token never leaves through \`weave export\`: an imported view arrives unshared, and \`weave view share\` mints it a fresh link.

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

\`weave workspace require-auth\` closes every page and every API route to a caller without a token. The doors that stay open are \`/api/health\`, a view's share link, the task applet, and the static assets a sign-in page needs; a browser without a token gets a page that says so, an API call gets a 401. A reader may read any page and write at none; a writer writes rows, never structure — and \`weave import\`, which replaces the whole workspace, is structure, so it needs an admin token. A token hash never leaves through \`weave export\`: an imported account keeps its name and role but opens nothing until it is deleted and created again.

Entity mutations are undoable (\`weave undo\`, 200 deep). Schema work, hard deletes and file deletions are not.

## The structure is data too

\`Workspace/Spaces\`, \`Workspace/Tables\`, \`Workspace/Fields\` and \`Workspace/Workflows\` are ordinary tables whose rows **are** the structure. They live once, at the weave root — the default workspace — with a \`Workspace\` column saying which workspace each row describes (the **Registry at the root** guide). Editing a row runs the same validation as the schema verb, because it is the schema verb. So does the grid foot: \`+ New space\` births a space named "New space" with the name selected for the caret to replace; \`+ New table\` and \`+ New field\` ask for the space or the table the row needs before creating it; a Workflows row starts blank like any other row; and a create the engine refuses lands in a toast rather than in silence. That is the subject of the **Configuring a space, first time right** guide.`,
  },
  {
    name: 'Polymorphic relations',
    audience: 'Both',
    order: 10,
    doc: `# Polymorphic relations

A relation field normally points at one table. In weave it can point at several, a **target set**, and two of the legal members are the workspace's own registries: \`Workspace/Spaces\` and \`Workspace/Tables\`. A bug can be scoped to a whole space. A dependency can name an entire workstream. An agenda can mix rows with the structure that holds them. This page is what a target set is, how the engine carries it, and why it was built this way rather than the way every other tool builds it.

## The classic pair

\`\`\`bash
weave relation add Task Project Project --cardinality many-to-one --inverse Tasks
\`\`\`

\`\`\`mermaid
graph LR
  subgraph pair["Classic pair: one target, two stored fields"]
    T1[Task] -- "Project" --> P1[Project]
    P1 -- "Tasks" --> T1
  end
  subgraph set["Target set: one stored field, several legal targets"]
    B[Bug] -- "Scope" --> S[Workspace/Spaces]
    B -- "Scope" --> Tb[Workspace/Tables]
    B -- "Scope" --> Pr[Sales/Project]
  end
\`\`\`

One target table makes the bidirectional pair: \`Task.Project\` on one side, \`Project.Tasks\` on the other, minted in the same write and deleted together. Each end knows the other by \`inverseFieldId\`. Lookups read a field through it; rollups aggregate over it. Nothing on this page changes the pair. A singleton target set collapses to it bit-for-bit, which is what makes the feature rollback-safe: revert the code and the stored fields are the fields you had.

## The target set

\`\`\`bash
weave relation add Bug Scope --target-dbs 'Workspace/Spaces,Workspace/Tables,Sales/Project' --cardinality many-to-one
weave link Bug#7 Scope Sales
\`\`\`

\`\`\`json
{ "name": "Scope", "type": "relation",
  "config": { "targetDbs": ["<Spaces id>", "<Tables id>", "<Project id>"], "many": false } }
\`\`\`

Two or more tables in \`targetDbs\` make one field whose values may point at a row of any member. The engine stores the member ids and this side's arity, and nothing else. Only this side's cardinality matters: \`many-to-one\` holds one chip, \`many-to-many\` holds a set.

Each surface handles the set on its own terms:

| Surface | Behaviour |
| --- | --- |
| Chip | carries its **home table**, so \`Apollo\` from \`Sales/Project\` and \`Apollo\` the space read differently in the same cell |
| Picker | searches every member table in one box |
| Filter | traverses per row: \`[["Scope.Name", "=", "Apollo"]]\` resolves each linked row against its own table and matches whichever member Apollo lives in |
| Relation map | draws one edge per member, so the field reads as a fan rather than a line |
| Field dialog | one select per member plus a remove control on the same line; the set shrinks to one and the field becomes a classic pair on the next save |
| Link input | a name is resolved across the members in order; a live uuid outside the set is refused as *not in a related table*, a sharper error than *not found* |

How one value gets in, and how a filter reads it back out:

\`\`\`mermaid
flowchart TD
  In["link Bug#7 Scope 'Apollo'"] --> M1{"in Workspace/Spaces?"}
  M1 -- no --> M2{"in Workspace/Tables?"}
  M2 -- no --> M3{"in Sales/Project?"}
  M3 -- yes --> Store["store Sales/Project#4"]
  M1 -- yes --> Store
  M2 -- yes --> Store
  M3 -- no --> Err["not found · or: not in a related table"]
  Store --> Chip["chip: Apollo · Sales/Project"]
  F["filter Scope.Name = Apollo"] --> Row["each linked row → its own table → its own Name"]
  Row --> Match["matches whichever member Apollo lives in"]
\`\`\`

## Why a space can be a target

The polymorphism is not a special case bolted onto relations. It falls out of the model.

Every level of weave is a row. A space is a row in \`Workspace/Spaces\`, a table a row in \`Workspace/Tables\`, a field a row in \`Workspace/Fields\`; a space has an entity view, a document, comments and a public id, the same as a task does, because it is the same kind of thing. One core kind, the Entity, is the whole ontology. Workspace, Space, Table, Field and Row are levels of it rather than separate kinds, and a relation has only ever known how to point at an entity.

\`\`\`mermaid
graph TD
  subgraph reg["Registries are tables; their rows are the structure"]
    WS["Workspace/Spaces"] --- s1["row: Sales"]
    WT["Workspace/Tables"] --- t1["row: Sales/Project"]
    WF["Workspace/Fields"] --- f1["row: Project.Owner"]
  end
  subgraph data["A user table; its rows are the data"]
    SP["Sales/Project"] --- p1["row: Apollo"]
  end
  Bug["Bug#7 · Scope"] -. "may point at" .-> s1
  Bug -. "may point at" .-> t1
  Bug -. "may point at" .-> p1
  s1 --- E1["entity view · document · comments · public id"]
  p1 --- E2["entity view · document · comments · public id"]
\`\`\`

So a relation whose target set includes \`Workspace/Spaces\` is pointing at rows in a table, which is all a relation ever did. No second link type, no "reference to structure" field, no string that holds a space name and hopes it stays valid. Rename the space and the chip follows; delete the space and the link is pruned with the row. Airtable, Notion and Fibery weld a link field to one table and keep spaces and databases outside the data, so the same relation is structurally unavailable there.

## Why it is one-way

A classic pair has an inverse because there is exactly one far table to put it on. A target set has several, and an inverse would have to be sprayed across every member: a \`Bugs\` column appearing on \`Workspace/Spaces\`, on \`Workspace/Tables\`, on \`Sales/Project\`, each one a stored field to keep consistent, each one a surprise on a table nobody edited. \`\`\`mermaid
graph LR
  subgraph no["What an inverse would mint (refused)"]
    B1[Bug.Scope] --> X1["Spaces.Bugs"]
    B1 --> X2["Tables.Bugs"]
    B1 --> X3["Project.Bugs"]
  end
  subgraph yes["What weave stores"]
    B2[Bug.Scope] --> Q["reverse = query: Scope.Name = Sales"]
  end
\`\`\`

So no inverse is minted. The reverse direction is a **query**, not a stored field: filter the source table on the relation, \`[["Scope.Name", "=", "Sales"]]\`, and you have every bug scoped to that space, answered from the stored forward links and never able to drift from them.

This is the ruling from the 2026-08-28 design review, and it is the reason the schema stays quiet. A target set adds one field to one table and leaves every member untouched.

## What stays single-target

Lookups and rollups refuse a target set. A lookup reads a named field from the far side, and across three member tables there is no one far side: \`Owner\` may exist on one member, be a number on another, and be missing on the third. Rather than answer with the first thing that matches, the engine keeps the single-target contract and the error says why.

Filters do traverse, because a filter resolves one row at a time and each row knows its own table. That asymmetry is deliberate: a filter answers *does this row match*, a lookup promises *this column has this type*, and only the first can be kept across members.

## Lifecycle

\`\`\`mermaid
stateDiagram-v2
  [*] --> Pair: targetDbs has one member
  [*] --> Set: targetDbs has two or more
  Set --> Set: add or remove a member
  Set --> Pair: members shrink to one
  Set --> Gone: last member table deleted
  Pair --> Gone: field or target deleted
  Gone --> [*]
\`\`\`

- Adding a member is a config edit on the field. Removing one is the same edit.
- Deleting a member table prunes it from every target set that names it. The last member takes the field with it; an empty set has nothing to hold.
- Duplicate members are refused at creation. An empty list is refused.
- Chips into a deleted row disappear with the row, as they do for the pair.

## Gotchas

Name the field for the role the target plays (\`Scope\`, \`Blocks\`, \`Agenda\`), not for any one member. The chip already says which table it came from.

A target set that only ever holds one member is a classic pair wearing a costume. Drop the list and take the inverse.

\`Workspace/Fields\` is a registry too, but it is not a useful member: a field's identity is its table's, and a relation into it reads as a pointer to a column definition. Reach for the \`field\` field type when a row needs to hold a field.

MCP: \`weave_add_relation\` takes \`targetDbs\` as a list; a single-element list is the pair. REST and the CLI mirror it with \`--target-dbs\`.

## See it in Showcase

Six tables in the **Showcase** space, one per use case, each with realistic rows and a description that opens on the one-line WHY. Open a table, click any chip in the polymorphic column: the home badge names the table the row came from, and the picker searches every member.

| Case | Table | Field | Target set |
| --- | --- | --- | --- |
| Attachment target — a comment lives on anything | [[table:Showcase/Comments]] | \`On\` | Tasks · Docs · Meetings, one |
| Audit subject — the log points at what changed | [[table:Showcase/Activity]] | \`Subject\` | every Showcase table, one |
| Pointing at structure — a note about a row *or the table that holds it* | [[table:Showcase/Notes]] | \`Related\` | Projects · Meetings · Docs · Workspace/Tables · Workspace/Spaces, many |
| Sign-off target — one approval workflow for three kinds of subject | [[table:Showcase/Approvals]] | \`Of\` | Expenses · Contracts · Deploys, one |
| Many-to-many mixed set — one label across five tables, +N chip | [[table:Showcase/Tags]] | \`Applied to\` | Tasks · Docs · Projects · Meetings · Deploys, many |
| The counter-example — a plain pair because a lookup and a rollup read through it | [[table:Showcase/Line Items]] | \`Expense\` | Expenses only; \`Expense category\` is a lookup, \`Line total\` on Expenses a sum rollup |

The Notes case is the walkthrough in [[Article#5]]. The set was built for Feature #182.`,
  },
  {
    name: 'Registry at the root',
    audience: 'Both',
    order: 11,
    doc: `# Registry at the root

The system registry — **Spaces**, **Tables**, **Fields** and **Workflows** as rows — exists once per weave, in the **Workspace** space of the root: the default workspace, the one served at \`/\`. It used to be minted inside every workspace file; since Feature #219 a member workspace (uno, test, anything the hub adopts or creates) shows only its own spaces in the sidebar, and its structure appears as rows at the root instead.

## The Workspaces table

The root's Workspace space carries one more table, **Workspaces**: one row per workspace the hub serves, the root included. It is the level-1 row — every other registry table relates back to it through a system **Workspace** column, so uno's tables and test's sit side by side in one grid, and a filter on Workspace is the slice you want.

Workspaces are created and deleted from the hub (the rail, \`POST /api/workspaces\`, \`DELETE /api/workspaces/:id\`), never as rows. A Workspaces row's Description edits the workspace's description; its Name is edited from the workspace's own page, because the hub's name index moves with it.

## Rows are a projection, the structure is the truth

Every workspace's \`state\` — its spaces, tables and fields — stays the source of truth. The root rows are a projection each workspace's own structural verbs keep true: rename a table in uno and its Tables row at the root follows; add a field and a Fields row appears. Edit a row at the root and the write routes to the workspace that owns it — the Workspace column says which — through the same verb, with the same validation. \`weave registry report\` names any drift; \`weave registry rebuild\` re-asserts every row from structure.

Opening a row opens the structure: a row that describes another workspace deep-links into it (\`/w/<id>/#/table/…\`).

## What still works, and where

- **Configuration as fields** (#126): Field Order, Hidden Fields, Filter, Sort and Hide Rollups on a Tables row — same columns, same verbs, now one grid for every workspace.
- **Space rollups and the Σ row** (#233): a \`via\` rollup lives on the root **Spaces** table and may name a table in any workspace; a member's grid still draws its Σ row and its picker still adds the rollup. Ids are uuids, so one \`via\` names one table wherever it lives.
- **Chip and Card view fields** (#175, #212) sit on the user tables themselves; unchanged.
- **Polymorphic relations** into \`Workspace/Spaces\` and \`Workspace/Tables\`: legal at the root, where those tables are.
- A member's own API answers for its registry rows through its prefix: \`/w/<id>/api/entities/<row>\` and \`/w/<id>/api/tables/Tables/…\` fall through to the root when the member does not hold them.

## Migration

A workspace that minted its own Workspace space keeps it as a **tombstone**: the space and its four tables are marked deleted, their rows kept, nothing purged. Its space rollups are re-created on the root Spaces table (a name clash gets \` (<workspace>)\` appended). \`weave serve\` on that file alone hosts the registry again; joining a hub tombstones it again. The Cloudflare Worker serves one workspace per deployment, so there the root is that workspace and nothing moves.`,
  },
  /* ---------- Self-hosting (Feature #222, phase 1) ----------
     The door matrix, the gates, the deploy targets and the environment
     contract live here so a fresh clone carries them; the README's
     self-hosting section is an index into these pages. Two stubs name the
     phase that fills them. test/deploy-artifacts.test.mjs pins the titles,
     the checks, and the variable set against the Dockerfile and compose. */
  {
    name: "Self-host weave: choose your door",
    audience: 'Human',
    order: 13,
    doc: `# Self-host weave: choose your door

weave on a laptop binds \`127.0.0.1\` and needs no login. weave on a server needs a door: something that decides who gets to the port. The rule this page and the ones after it follow: **the authentication surface is the operator's choice, and no surface depends on another.** Three doors, each a complete path on its own page, each ending with a check you can run.

\`requireAuth\` is the switch inside weave (\`weave workspace require-auth\`). With requireAuth on, every page and API call needs a token: a \`wv_\` bearer for agents, a session for people once door B lands. Off, whoever reaches the port is an admin. A door in front of the port is what makes "reaches the port" mean something.

## The three doors

| Door | Runs where | Code in weave | Phone browser | Agents over HTTP | Share links | Portability |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Edge gate**: Cloudflare Access, Tailscale, Caddy \`basic_auth\`, oauth2-proxy, Authelia | In front of the process | None | Yes (Tailscale needs its app) | Service token or tailnet member | Only behind a public gate | Swap the proxy; weave untouched |
| **B. Built-in passkeys + scoped tokens** | Inside weave | Ships with weave, zero dependencies | Yes: Face ID, Touch ID, Android | \`wv_\` bearer tokens | Share grants | Any host, any DNS, no vendor |
| **C. Identity provider over OIDC**: GitHub, Google; Keycloak, Authentik; Clerk, Auth0 | Inside weave, identity outside | On top of B's sessions | Yes | Same tokens as B | Same as B | One client id per provider |

**Door A** is the fastest way to a private instance today and costs nothing: every gate on the list has a free tier, and Cloudflare Access is free to fifty users. The gate owns identity; weave never learns who came in. Stack it in front of B or C whenever you like; neither side needs to know. The **Door A: an edge gate** guide has one config block per gate.

**Door B** is the door a fresh \`git clone\` gets: passkeys for people, typed and scoped \`wv_\` tokens for agents, no account at a third party. It is the default the guides lead with once it ships (phase 2 of Feature #222; the **Door B: passkeys** page says what it will hold).

**Door C** adds a provider to door B's session: sign in with GitHub, Google, or a self-hosted identity server. It is "add a provider", never a second auth system, and it lands with Feature #212.

## Tailscale, stated plainly

Tailscale is the simplest door A and the most limited: no public URL. Hosted MCP from claude.ai, share links opened off the tailnet, and phone capture from outside all stay off. Right for one person and their devices; wrong the day someone outside the tailnet needs a link.

## Where the door goes

Every deploy target (Railway, Fly.io, Render, a VPS, Docker on a NAS) takes the same container and the same environment (the **Environment reference** guide). The door sits between the internet and the published port: a platform's custom domain plus a gate, or a reverse proxy on the same box. Pick the target in **Deploy: Railway** or **Deploy: Fly.io, Render, a VPS, Docker**, then pick the door.

## How you know it worked

1. Open the instance in a private browser window. A door A gate asks you to sign in before any weave page draws. With requireAuth on and no gate, the page loads but every call answers \`401\` until a token is set.
2. \`curl -s https://weave.example.com/api/health\` still answers \`{"ok":true,…}\` through a public gate that exempts it, or a \`302\` to the gate's login when it does not. Either is fine; a bare \`200\` with your data behind it and no gate is the failure.
3. From a device that should not have access, the same URL gets the gate, not weave.`,
  },
  {
    name: "Door A: an edge gate",
    audience: 'Human',
    order: 14,
    doc: `# Door A: an edge gate

A gate in front of the port. weave keeps binding \`127.0.0.1\` (or the container's \`0.0.0.0\` behind a platform that only routes the custom domain); the gate is what the internet talks to. Five gates, one config block each, one check each. All five stack in front of door B or C without either side knowing.

With a gate in place, turn \`requireAuth\` on as well when agents reach the instance over HTTP: with requireAuth on, every page and API call needs a token, so a gate that admits a person still does not hand an agent anonymous write.

## Cloudflare Access

Free to fifty users. The DNS record is proxied, a tunnel carries traffic to the box, and an Access application decides who gets through.

\`\`\`yaml
# ~/.cloudflared/config.yml  (cloudflared tunnel create weave; cloudflared tunnel route dns weave weave.example.com)
tunnel: <tunnel-id>
credentials-file: /home/weave/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: weave.example.com
    service: http://127.0.0.1:4400
  - service: http_status:404
\`\`\`

In Zero Trust → Access → Applications, add a self-hosted application for \`weave.example.com\` with one policy: **Allow** → Emails → the people who belong. Agents get a **service token** (Access → Service Auth) and send it as \`CF-Access-Client-Id\` / \`CF-Access-Client-Secret\` headers on every call.

**Check:** \`curl -sI https://weave.example.com/api/health\` answers \`302\` to \`*.cloudflareaccess.com\`. The same call with the two service-token headers answers \`200\` and \`{"ok":true\`.

## Tailscale

Private to your devices, nothing exposed, no certificate to manage, no public URL (the limit is stated on the **choose your door** page). One command on the server:

\`\`\`bash
tailscale serve --bg 4400
\`\`\`

**Check:** \`tailscale serve status\` lists \`https://<machine>.<tailnet>.ts.net → http://127.0.0.1:4400\`. That URL opens on another device in the tailnet and does not resolve anywhere else.

## Caddy \`basic_auth\`

A public hostname with automatic TLS and one shared password. Make the hash with \`caddy hash-password\`, then:

\`\`\`caddyfile
# /etc/caddy/Caddyfile
weave.example.com {
	basic_auth {
		you $2a$14$replace-with-your-bcrypt-hash
	}
	reverse_proxy 127.0.0.1:4400
}
\`\`\`

One credential for everyone: every person who gets in is whatever \`requireAuth\` says they are. Fine for one operator; for distinct identities use one of the gates below.

**Check:** \`curl -sI https://weave.example.com/\` answers \`401\`; \`curl -sI -u you:password https://weave.example.com/api/health\` answers \`200\`.

## oauth2-proxy

Sign in with GitHub, Google, or any OIDC provider; the proxy holds the session and forwards to weave.

\`\`\`ini
# /etc/oauth2-proxy.cfg  (oauth2-proxy --config /etc/oauth2-proxy.cfg)
http_address = "127.0.0.1:4180"
upstreams = ["http://127.0.0.1:4400"]
provider = "github"
client_id = "<oauth app id>"
client_secret = "<oauth app secret>"
cookie_secret = "<python3 -c 'import secrets; print(secrets.token_urlsafe(32))'>"
email_domains = ["example.com"]
redirect_url = "https://weave.example.com/oauth2/callback"
\`\`\`

Caddy (or nginx) terminates TLS for \`weave.example.com\` and \`reverse_proxy 127.0.0.1:4180\`.

**Check:** the hostname redirects to the provider's sign-in page; an address outside \`email_domains\` is refused with \`403\` after signing in; yours lands on weave.

## Authelia

Self-hosted SSO with two-factor, driven through Caddy's \`forward_auth\`.

\`\`\`yaml
# authelia/configuration.yml (excerpt)
access_control:
  default_policy: deny
  rules:
    - domain: weave.example.com
      policy: two_factor
\`\`\`

\`\`\`caddyfile
weave.example.com {
	forward_auth 127.0.0.1:9091 {
		uri /api/authz/forward-auth
		copy_headers Remote-User Remote-Groups Remote-Email Remote-Name
	}
	reverse_proxy 127.0.0.1:4400
}
\`\`\`

**Check:** the hostname redirects to Authelia's portal; after the second factor the same URL draws weave; \`curl -sI https://weave.example.com/api/health\` answers \`401\` from Authelia, never weave's JSON.

## How you know it worked

Three checks, whichever gate you chose:

1. A private browser window gets the gate before any weave page.
2. \`curl -sI https://weave.example.com/api/health\` answers a redirect or \`401\` from the gate, or \`200\` only with the gate's own credential (service token, basic auth, cookie).
3. A row created through the gate is there after the gate is restarted: the gate holds sessions, weave holds data, and neither borrowed the other's.`,
  },
  {
    name: "Door B: passkeys",
    audience: 'Human',
    order: 15,
    doc: `# Door B: passkeys

Not built yet. Phase 2 of Feature #222 builds door B inside weave with zero dependencies: a passkey sign-in page at \`/auth\`, \`wv_session\` cookies with a thirty-day sliding expiry, \`weave account invite <name>\` for the first admin and every device after it, \`weave account sessions\` and \`revoke-session\` for the lost-phone day, and \`WEAVE_ORIGIN\` as the public origin the passkeys are bound to. Agents keep their \`wv_\` bearer tokens; passkeys never lock the CLI out. This page fills in when that lands. Until then, put a **Door A: an edge gate** in front of the port.

## How you know it worked

Not yet. Door A's check is the check until phase 2 lands.`,
  },
  {
    name: "Deploy: Railway",
    audience: 'Human',
    order: 16,
    doc: `# Deploy: Railway

One service, one volume, one replica. The repo carries \`railway.json\` (Dockerfile build, health check on \`/api/health\`, restart on failure, \`numReplicas: 1\`, \`requiredMountPath: /data\`), so the dashboard has little left to set.

## 1. Project from GitHub

New Project → **Deploy from GitHub repo** → your fork of \`grunion-ai/weave\` (or the repo itself). Railway reads \`railway.json\`, builds the \`Dockerfile\`, and deploys on every push to the branch you pick. Nothing to build, nothing from npm.

## 2. Volume at /data

Right-click the service → **Add Volume** → mount path \`/data\`. Everything worth keeping lives there: \`workspace.db\`, the \`weave.db\` docs workspace beside it, \`files/\` for attachments, and the keystore. A volume attaches to one service, and replicas cannot be used with a volume, so the count stays at \`1\`, which is also what a single SQLite writer needs.

Railway mounts the volume owned by root, and the image runs as the unprivileged \`node\` user. If the first deploy log shows \`EACCES\` on \`/data\`, set \`RAILWAY_RUN_UID=0\` on the service and redeploy; the process then runs as root inside its own container, which is the platform's documented answer.

## 3. Variables

Service → **Variables**. Railway sets \`PORT\` itself; the Dockerfile sets \`WEAVE_HOST\`, \`WEAVE_DATA\` and \`WEAVE_KEYSTORE\`; set the rest here.

\`\`\`
WEAVE_DATA=/data/workspace.db
WEAVE_KEYSTORE_PASSPHRASE=<a long random string, kept in your password manager>
\`\`\`

\`WEAVE_KEYSTORE_PASSPHRASE\` is what keeps the keystore key off the volume; lose it and the secrets in the keystore are unreadable (the data is untouched). \`WEAVE_ORIGIN\` joins this list when door B lands; \`WEAVE_BACKUP_DEST\` when phase 3 does. The **Environment reference** guide has every variable and what breaks when each is wrong.

## 4. Custom domain

Service → **Settings → Networking → Custom Domain** → \`weave.example.com\`. Railway shows the target; at your DNS add a **CNAME** record for \`weave\` pointing at it. At Cloudflare keep the proxy **off** (DNS only) so Railway's certificate check sees the record. TLS is Railway's.

## 5. Health check and restarts

\`railway.json\` carries \`healthcheckPath: /api/health\` and \`healthcheckTimeout: 120\`: a deploy is live only once \`/api/health\` answers \`2xx\`, and a crash restarts the container up to ten times. Health checks run at deploy time, not continuously; for an alert when the instance is down, point a free uptime monitor at \`/api/health\`.

## 6. The door

The custom domain is public. Turn \`requireAuth\` on (\`weave workspace require-auth\` from a shell on the service, or \`PATCH /api/workspace\` with \`{"requireAuth": true}\` and an admin token) and put a door in front: **Door A: an edge gate** today, **Door B: passkeys** when it ships.

## Backups

Railway's cron is a separate service and cannot share the volume, so backup runs inside the weave process, not as a Railway cron: phase 3 adds \`weave backup\` and the in-process nightly switch (\`WEAVE_BACKUP_DEST\`). Until then the **Backup and restore** page has the manual copy, and paid Railway plans snapshot the volume.

## How you know it worked

1. \`curl -s https://weave.example.com/api/health\` answers \`{"ok":true,"name":"weave","version":"…","workspace":"workspace",…}\` and the Deployments tab shows the health check passed.
2. Create a row, then **Redeploy** from the dashboard. The row is still there: the volume, not the container, holds it.
3. The service shows **1 replica** and one volume at \`/data\`; the log has no \`EACCES\`.`,
  },
  {
    name: "Deploy: Fly.io, Render, a VPS, Docker",
    audience: 'Human',
    order: 17,
    doc: `# Deploy: Fly.io, Render, a VPS, Docker

Four targets, the same container and the same environment. The constraint every one satisfies: weave writes one SQLite file per workspace in WAL mode through Node's synchronous driver, so it needs a real Node ≥ 22.16 process, a disk that survives restarts, and exactly one running copy per data directory. Serverless runtimes and horizontal scaling are out.

## Fly.io

The repo carries \`fly.toml\`: one Machine, a volume at \`/data\`, the internal port \`4400\`, a health check on \`/api/health\`, and \`auto_stop_machines = "off"\` so the single writer never sleeps mid-WAL.

\`\`\`bash
fly launch --no-deploy --copy-config            # takes fly.toml as is; pick the app name and region
fly volumes create weave_data -r <region> -n 1 -s 2
fly secrets set WEAVE_KEYSTORE_PASSPHRASE=<long random string>
fly deploy --ha=false                            # one Machine, not two: one volume, one writer
\`\`\`

Fly snapshots the volume daily with five days of retention; that is a floor, not a backup plan (the **Backup and restore** page). If the log shows \`EACCES\` on \`/data\`, the mount came up root-owned: \`fly ssh console -C "chown node:node /data"\` once, then \`fly machine restart\`.

**Check:** \`fly status\` shows one Machine \`started\`; \`curl -s https://<app>.fly.dev/api/health\` answers \`{"ok":true\`; a row created before \`fly machine restart\` is there after it.

## Render

New → **Web Service** → your repo, runtime **Docker**. Disks need a paid instance type. Under **Disks** add one at mount path \`/data\` (1 GB is plenty to start). Under **Environment** set \`WEAVE_DATA=/data/workspace.db\` and \`WEAVE_KEYSTORE_PASSPHRASE\`; Render sets \`PORT\`. Health check path: \`/api/health\`.

A disk pins the service to one instance and turns off zero-downtime deploys: Render stops the old instance before starting the new one, so each deploy is a few seconds of \`502\`. Render snapshots the disk daily and keeps snapshots at least seven days.

**Check:** the service log ends in \`Weave running at http://…:<port>\`; \`/api/health\` on the \`onrender.com\` URL answers ok; a row survives **Manual Deploy → Deploy latest commit**.

## A VPS (Hetzner, or any Linux box) with systemd

Any always-on Linux box with **Node ≥ 22.16**. There is nothing to build and nothing to install from npm.

\`\`\`bash
sudo git clone https://github.com/grunion-ai/weave /opt/weave
sudo useradd --system --home /var/lib/weave --create-home weave
\`\`\`

\`\`\`ini
# /etc/systemd/system/weave.service
[Unit]
Description=weave
After=network.target

[Service]
User=weave
WorkingDirectory=/opt/weave
Environment=WEAVE_KEYSTORE=/var/lib/weave/keystore.json
ExecStart=/usr/bin/node /opt/weave/bin/weave.js serve --port 4400 --data /var/lib/weave/workspace.db
Restart=always

[Install]
WantedBy=multi-user.target
\`\`\`

\`\`\`bash
sudo systemctl enable --now weave
\`\`\`

Keep it bound to \`127.0.0.1\` (the default) and put a **Door A: an edge gate** in front: Caddy for a public hostname, Tailscale for a private one. Everything worth keeping is in \`/var/lib/weave\`. Update with \`sudo git -C /opt/weave pull && sudo systemctl restart weave\`; there is no migration step.

**Check:** \`systemctl status weave\` is \`active (running)\`; \`curl -s http://127.0.0.1:4400/api/health\` answers ok on the box; the gate's own check passes from outside.

## Docker (a NAS, a home server, Unraid, anywhere)

The repo carries \`compose.yaml\`: one service built from the \`Dockerfile\`, a named volume at \`/data\`, the port published on \`4400\`, a health check on \`/api/health\`.

\`\`\`bash
git clone https://github.com/grunion-ai/weave && cd weave
docker compose up -d
\`\`\`

To keep the data in a directory you can see instead of a named volume, change the mount to \`./data:/data\` and \`chown 1000:1000 data\` first: the image runs as the unprivileged \`node\` user (uid 1000) and a bind mount keeps the host's ownership. Set \`WEAVE_KEYSTORE_PASSPHRASE\` in the \`environment\` block to keep the keystore key off the disk. Update with \`git pull && docker compose up -d --build\`.

**Check:** \`docker compose ps\` shows the service \`healthy\`; \`curl -s http://127.0.0.1:4400/api/health\` answers ok; \`docker compose restart\` keeps every row.

## How you know it worked

Whichever target: \`/api/health\` answers \`{"ok":true,…}\` with the version you deployed, a row created before a restart is there after it, and the log shows no \`EACCES\` on the data directory. Then pick the door on the **Self-host weave: choose your door** page.`,
  },
  {
    name: "Backup and restore",
    audience: 'Human',
    order: 18,
    doc: `# Backup and restore

\`weave backup\` and \`weave restore\` are not built yet. Phase 3 of Feature #222 (and Feature #209) adds them: \`VACUUM INTO\` a temp file per workspace, tar with \`files/\` and the keystore, encrypt, upload to an S3-compatible bucket with nothing but \`node:fetch\` and \`node:crypto\`; \`WEAVE_BACKUP_DEST\` set on the server switches on a nightly run inside the process, thirty archives kept; \`weave restore <archive> --data <dir>\` brings one back without any SQLite tooling installed. Litestream stays the documented upgrade for operators who need under-a-minute loss. This page fills in when that lands.

## Until then

Everything lives in the data directory: one \`.db\` per workspace (yours, plus the \`weave.db\` docs workspace), one \`files/\` directory of attachments, and \`keystore.json\`.

\`\`\`bash
for db in /var/lib/weave/*.db; do
	sqlite3 "$db" ".backup '/backups/$(basename "$db" .db)-$(date +%F).db'"
done
rsync -a /var/lib/weave/files/ /backups/files/
\`\`\`

Use \`.backup\` rather than copying the file: it is safe while the server is running and folds in the \`-wal\`/\`-shm\` sidecars. \`node bin/weave.js export --data <file>\` writes the same workspace as human-readable JSON if you want a copy you can read without weave.

## How you know it worked

Copy the backed-up \`.db\` and \`files/\` into an empty directory, run \`node bin/weave.js serve --port 4401 --data <dir>/workspace.db\`, and compare an entity count and one attachment against the live instance. A backup you have not restored is a hope.`,
  },
  {
    name: "Environment reference",
    audience: 'Human',
    order: 19,
    doc: `# Environment reference

Every deploy target takes the same variables. Precedence is the same everywhere: a CLI flag beats the environment, the environment beats the default. The \`Dockerfile\` and \`compose.yaml\` in the repo name exactly this set; \`test/deploy-artifacts.test.mjs\` refuses a build where they and this page disagree.

| Variable | Read by | Default | What breaks when it is wrong |
| --- | --- | --- | --- |
| \`PORT\` | \`weave serve\` | \`4400\` | The platform's router and health check probe a port nothing listens on: the deploy never goes live. Railway and Fly set it; leave it alone there. |
| \`WEAVE_HOST\` | \`weave serve\` | \`127.0.0.1\` | Inside a container the loopback address is the container's own: the platform cannot reach the process and the health check fails. Containers need \`0.0.0.0\`; the \`Dockerfile\` sets it. On a VPS keep the default and let the gate connect on loopback. |
| \`WEAVE_DATA\` | every verb | \`~/.weave/workspace.json\` | Points off the volume: every restart starts empty. It names the workspace \`.db\`; the \`weave.db\` docs workspace and the \`files/\` directory of attachments are created beside it, so the directory is what needs to persist. A \`.json\` spelling is accepted and becomes the sibling \`.db\`. |
| \`WEAVE_KEYSTORE\` | every verb | \`~/.weave/keystore.json\` | Defaults into \`$HOME\`, which in a container is not on the volume: every restart loses the encrypted secrets. The \`Dockerfile\` sets \`/data/keystore.json\`. |
| \`WEAVE_KEYSTORE_PASSPHRASE\` | every verb | unset | Unset, a random key is written to a \`chmod 600\` file beside the keystore, so a copy of the volume carries the key. Set, the key is derived from the passphrase and nothing lands. Change it and every stored secret becomes unreadable; keep it in a password manager. |
| \`WEAVE_ORIGIN\` | nothing yet | unset | Reserved for phase 2 (door B). It will be the public origin passkeys and cookies are bound to, required whenever \`requireAuth\` is on and the host is not loopback. Setting it today does nothing. |
| \`WEAVE_BACKUP_DEST\` | nothing yet | unset | Reserved for phase 3. It will be the S3-compatible URL of the nightly archive; set, the server backs up in-process at 04:00 UTC. Setting it today does nothing. |

## The container

The \`Dockerfile\` bakes the container-shaped values: \`PORT=4400\`, \`WEAVE_HOST=0.0.0.0\`, \`WEAVE_DATA=/data/workspace.db\`, \`WEAVE_KEYSTORE=/data/keystore.json\`. A platform overrides \`PORT\`; you supply \`WEAVE_KEYSTORE_PASSPHRASE\`. The two reserved variables are listed as comments so the contract is visible in one place.

## How you know it worked

\`curl -s http://<host>:<port>/api/health\` answers with \`"workspace":"workspace"\` (the basename of \`WEAVE_DATA\`), and a listing of the data directory shows \`workspace.db\`, \`weave.db\`, \`files/\` and \`keystore.json\`, and no \`keystore.key\` when the passphrase is set.`,
  },
  {
    name: 'Reporting a bug',
    audience: 'Both',
    order: 12,
    doc: `# Reporting a bug

The bug glyph in the bottom-right corner of every page opens a small panel beside it. The page stays visible while the report is written, because reporting a bug must not cover the bug. Type a sentence, pick any of the four symptoms — **Slow**, **Looks broken**, **Wrong data**, **Error** — and there are two ways to send it.

## Send: an Issue on this instance

**Send** files a row into this instance's \`Development/Issue\` table, in the \`weave\` docs workspace, with the symptoms in the \`Symptom\` multiselect and a **Replay** section built from the recorder every session runs: routes entered, controls clicked, requests that failed, anything that threw. The recorder keeps control names, never what was typed into them. The server stamps its own version and start time on the row, so a stale build cannot report itself as current.

That row lives where the instance lives. On the canonical instance it is read every night. On a self-hosted weave it is on your disk, and an instance without a docs workspace cannot file it at all.

## Email instead: the way out of any instance

**Email instead**, at Send's left, opens your mail app with the report filled in, addressed to \`weave@grunion.ai\`, from your own address. Read it, edit it, add a screenshot, then send. Nothing transits the weave server. The address is receive-only; a reply comes from a person's own mailbox to yours.

A page that did not load offers the same link under its message as **Report by email**, with the error folded in.

The address is printed under the panel's foot, so a device with no mail app still has something to copy. The whole link is held under 2000 characters, the ceiling mail clients accept: a long console line is shortened first, then a long note, and the fixed lines always ride.

### The subject

\`[weave] <symptoms>: <first line of the note>\` — \`[weave] Error: the grid never loaded\`. The tag names the product, because one inbox label covers several. With no note the place stands in: \`[weave] on /w/<ws>/#/entity/<id>\`.

### The body

| Line | Comes from | Why triage wants it |
| --- | --- | --- |
| Symptoms | the four toggles | maps onto the Issue table's Symptom and Severity |
| Note, Steps, Expected, Actual | you, finished in the mail app | the account of what happened |
| \`weave v0.4.17, started …, up 3h\` | \`/api/health\`, with a STALE mark when the server predates its own files | a stale build is the most common false bug |
| Page | the **route shape**: \`/w/<ws>/#/entity/<id>\` | which kind of page failed |
| Browser | family, major version and OS | layout bugs are browser-specific |
| \`1440 × 900 · dark\` | the window and the theme | layout bugs depend on width; both themes are checked |
| Console | the newest error message, secrets stripped, quoted strings blanked, 300 characters at most | the one line that explains an Error |

## What never leaves the page by mail

- The **workspace name** and every entity, table, space and view id: the page line is the route shape, with \`<ws>\` and \`<id>\` in their places, and the query string (a docked entity, a share token) dropped.
- Row names, page titles, field values: the email quotes nothing from the workspace. A server message that quoted a name arrives as \`"…"\`.
- The action **trace**: its steps name tables and buttons, and a schema is yours. It goes into the local Issue only.
- Tokens and keys: the same redaction the server applies to an Issue runs in the page before the link is built.
- The raw user-agent string, the page URL, and anything from \`state.meta\`.

## How you know it worked

The mail app opens with the To, Subject and body already there. If nothing opens, the browser has no mail handler: copy the address from under the panel and send the report from any client.`,
  },
  {
    name: 'Chip and card anatomy',
    audience: 'Both',
    order: 20,
    doc: `# Chip and card anatomy

A row appears in two shapes outside its own page: the **chip**, inline — a relation cell, a \`[[…]]\` mention in a document, a reference card, a picker — and the **card**, a tile. Both are drawn from the table's two \`view\` fields (the **view** page in [[table:Handbook/Fields|Fields]] says what they can contain; the entity page's **Appears as** strip shows the live pair once the eye unhides them — a hidden view is not drawn there either, Issue #208). This page is the face: every element, what it does, how you use it, and its **hitbox** — the region a click lands in. Each figure below is the real markup the app draws, with a dashed outline traced on each element's box, so the outline IS the hitbox. The solid grey outline is the one link the whole thing is.

## The chip

<div class="wv-anat" style="font-family:var(--tblr-font-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif);font-size:14px;line-height:1.5;color:var(--tblr-body-color,inherit);display:inline-flex;align-items:center;gap:18px;padding:26px 22px 16px;border:1px dashed rgba(128,128,128,.45);border-radius:8px;margin:4px 0 8px">
<span class="mention-wrap open"><span class="k k-rel has-segs"><a href="#" style="position:relative;outline:1.5px solid rgba(128,128,128,.55);outline-offset:2px" onclick="return false"><span class="av hue-blue" style="overflow:visible;position:relative;outline:1.5px dashed #d6409f;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#d6409f">1</i>AL</span><span style="position:relative;outline:1.5px dashed #8e4ec6;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#8e4ec6">2</i>#12</span> <span style="position:relative;outline:1.5px dashed #3a5bc7;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#3a5bc7">3</i>Ship the editor</span> <span class="k-home" style="position:relative;outline:1.5px dashed #0e8a7a;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#0e8a7a">4</i>Task</span><button type="button" class="mention-caret" aria-expanded="true" title="Hide fields" style="position:relative;outline:1.5px dashed #e5484d;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;right:-3px;bottom:-15px;transform:rotate(180deg);font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#e5484d">5</i>›</button><span class="mention-fields" style="position:relative;outline:1.5px dashed #d97706;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#d97706">6</i><span class="k k-state cat-in-progress hue-blue wv-seg-state">Doing</span><span class="mention-f"><span class="mention-f-label">Due</span>2026-09-12</span><span class="mention-f"><span class="mention-f-label">Severity</span>High</span></span><span style="position:relative;outline:1.5px dashed #3a5bc7;outline-offset:2px;display:inline-block;width:9px;height:14px;margin-right:-11px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#3a5bc7">7</i></span></a><span class="x" style="position:relative;outline:1.5px dashed #ce2c31;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#ce2c31">8</i>×</span></span></span>
</div>

The whole chip is one link to the row. Everything inside the grey box navigates on click except the caret; the × sits outside it.

| № | Element | What it does | How you use it | Hitbox |
| --- | --- | --- | --- | --- |
| 1 | **Avatar** (\`.av\`) | initials, or the picture, of a person-table row; hue from the name | none of its own — part of the link | inside the link |
| 2 | **Public id** (\`#12\`) | the row's number; shows when the chip's \`link\` setting is on | read it, quote it — \`[[Task#12]]\` written in any document becomes this chip | inside the link |
| 3 | **Name** | the row's \`Name\` field | **click** opens the row; **⌘/Ctrl/Shift-click or middle-click** opens it in a new tab; **right-click → Copy Link** copies its permalink (the chip is a real anchor); **hover** turns the outline brand-blue | inside the link — the label, its padding, and the space between elements all count |
| 4 | **Home badge** (\`.k-home\`) | names the far table when a relation can point at several (a target set) | none of its own | inside the link |
| 5 | **Caret** (\`›\` / \`‹\`) | folds the segments in and out; shows only when there is a segment to show | **click to expand**; it turns to face the label (\`‹\`) and a second click **collapses** — the caret is the one pixel of the chip that never navigates | its own 12×18px button; the click stops there |
| 6 | **Segments** | the state as a state chip (the category owns the colour), then label·value pairs from the view's \`fields\`; three at most in a chip | read them; the state's colour is the same one the grid cell wears | inside the link — a click on a segment opens the row |
| 7 | **Open mark** (\`↗\`) | promises navigation; always the last pixel inside the link | click it like the name | inside the link |
| 8 | **Remove** (\`×\`) | in a relation cell only: unlinks this row from the field — never deletes it | **click to unlink**; \`weave undo\` (or the activity row) puts it back | its own box, outside the link |

The mark (7) and the caret (5) are why the chip never fills behind a pointer: colour is spent on values, and a pointer is a place to go. Tier rules, radius (4px) and the shared size come from the chip system — one size for every tier, decided once in \`--wv-chip-font\` and \`--wv-chip-line\`.

## The card

<div class="wv-anat" style="font-family:var(--tblr-font-sans-serif,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif);font-size:14px;line-height:1.5;color:var(--tblr-body-color,inherit);display:inline-block;padding:26px 22px 16px;border:1px dashed rgba(128,128,128,.45);border-radius:8px;margin:4px 0 8px">
<div class="wv-card" style="position:relative;outline:1.5px solid rgba(128,128,128,.55);outline-offset:2px;gap:16px;padding-top:12px"><div class="wv-card-head"><a class="wv-card-title" href="#" onclick="return false" style="overflow:visible;position:relative;outline:1.5px dashed #3a5bc7;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;right:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#3a5bc7">10</i><span class="wv-card-id" style="position:relative;outline:1.5px dashed #8e4ec6;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#8e4ec6">9</i>#12</span>Ship the editor</a><span class="k k-state cat-in-progress hue-blue wv-seg-state" style="position:relative;outline:1.5px dashed #218358;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#218358">11</i>Doing</span></div><div class="wv-card-desc" style="overflow:visible;position:relative;outline:1.5px dashed #d97706;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#d97706">12</i>The editor is the renderer: no edit mode, no preview pane, no save button.</div><dl class="wv-card-fields" style="position:relative;outline:1.5px dashed #0e8a7a;outline-offset:2px"><i class="wv-anat-n" style="position:absolute;left:-3px;top:-15px;font:600 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-style:normal;color:#0e8a7a;grid-column:1/-1">13</i><dt>Severity</dt><dd>High</dd><dt>Symptom</dt><dd>Looks broken</dd><dt>Due</dt><dd>2026-09-12</dd></dl></div>
</div>

Only the title is a link. The rest of the tile is inert — in a grid cell the cell's own click applies, on a board the column's.

| № | Element | What it does | How you use it | Hitbox |
| --- | --- | --- | --- | --- |
| 9 | **Public id** (\`.wv-card-id\`) | the row's number, when the card's \`link\` setting is on (it is, by default) | read it, quote it | inside the title link |
| 10 | **Title** (\`.wv-card-title\`) | the row's \`Name\`, bold | **click** opens the row; **⌘/Ctrl/Shift-click or middle-click** for a new tab; **right-click → Copy Link** for the permalink; **hover** turns it brand-blue | the title text, the id, and the gap between them |
| 11 | **State** | the workflow state as the same state chip the grid cell wears, right of the title | read it — a card's state changes on the row, not on the card | none — display only |
| 12 | **Description** | the first lines of the description document at the view's \`description\` size — small (one line), medium (~120 chars), large (~320); prose only, three lines at most, one on a compact card | read it; the row's page has the rest | none |
| 13 | **Fields** (\`.wv-card-fields\`) | label · value pairs from the view's \`fields\` — the first few glanceable values in column order by default, four at most counting the state | read them; arranging the table's columns IS the curation | none |

## Where the same chip shows up

| Surface | Which chip | What differs |
| --- | --- | --- |
| a relation cell in the grid | the far row's chip | carries the × (8); the avatar (1) on a person relation; the home badge (4) on a target set |
| a \`[[…]]\` mention in a document | the same chip, from the same config | no ×, no avatar — a reference is text, there is nothing to unlink |
| a reference panel on the entity page | the same chip | home badge on, no × |
| the relation picker | the same chip | the × means "take it out of the selection" |
| the entity page's Appears as strip | this table's own chip and card, for the views the eye shows — both are minted hidden, so unhide one to see it | a gear beside each opens the table's config; the strip shows what every other surface will draw |

To change what a chip or card contains — the id, the state, the description size, which fields ride along — open the gear on the Appears as strip or \`weave field update Task Chip --config '{"fields":["Due"]}'\`. It changes every row of the table at once.`,
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

At three or more headings a document grows the dash rail down its edge. This section alone has six, so the rail is there.` },

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

  { name: 'Inline icons', construct: 'Format', syntax: '`:name:`', doc: `# Inline icons

Any icon in the set draws inline where its name sits between colons — :bell: \`:bell:\`, :shield-check: \`:shield-check:\`, :rocket: \`:rocket:\` — in a sentence, a list or a table cell, where an emoji shortcode would go. A state mark goes by its Lucide twin or, for a progress ring, its alias: :check: \`:check:\`, :ring-quarter: \`:ring-quarter:\`.

| Icon | Name | Where it fits |
| --- | --- | --- |
| :bug: | \`bug\` | an issue |
| :star: | \`star\` | a feature |
| :calendar: | \`calendar\` | a date |
| :lock: | \`lock\` | a credential |
| :check: | \`check\` | a state that is done |

A token the set does not know stays literal, so \`12:30:45\` and \`:smile:\` are untouched. \`weave vocabulary icons\` lists every name.` },
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
    if (noun && !w.termOf(existing).set) patch.noun = noun;
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
   [[…]] links and its position; only its values and its document move. The
   engine drops identical values and identical text, so a re-apply that
   changes nothing writes nothing. */
function upsertRow(w, db, { name, values, doc }) {
  const existing = w.findEntity(db, name);
  if (!existing) return w.createEntity(db, { name, values, doc });
  if (values && Object.keys(values).length) w.updateEntity(existing.id, values);
  if (doc != null) w.setDoc(existing.id, doc);
  return existing;
}
const sameValue = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* The generated pages, one list per table — the single source applyHandbook,
   handbookHash and handbookDrift all read. */
const guidePages = () => GUIDES.map((g) => ({ name: g.name, values: { Audience: g.audience, Order: g.order }, doc: g.doc }));
const fieldPages = () => FIELD_DOCS.map((f) => ({ name: f.name, values: { Kind: f.kind }, doc: f.doc }));
const HANDBOOK_PAGES = () => [['Handbook/Guide', guidePages()], ['Handbook/Fields', fieldPages()]];

/* The Handbook: one page per field type, plus the guides that no single field
   page can carry. Idempotent — safe on a workspace seeded before either
   existed, and safe to run again after this file grows. */
export function applyHandbook(w) {
  ensureSpace(w, 'Handbook', 'Official documentation and how-tos');

  const guides = ensureTable(w, 'Handbook', 'Guide', {
    description: 'The prose no field page can carry — how to install it, how the model works, how a document is written, and what a workspace can be made to look like.',
    icon: 'lucide:file-text',
    noun: 'guide',
  });
  ensureField(w, guides, { name: 'Audience', type: 'select', config: { options: ['Human', 'Agent', 'Both'] } });
  ensureField(w, guides, { name: 'Order', type: 'number' });
  for (const page of guidePages()) upsertRow(w, guides, page);

  const fields = ensureTable(w, 'Handbook', 'Fields', {
    description: 'One page per field type: what it stores, what it can be configured into, and what bites.',
    icon: 'lucide:layout-grid',
    noun: 'field type',
  });
  ensureField(w, fields, { name: 'Kind', type: 'select', config: { options: FIELD_KINDS.map((name) => ({ name, color: '' })) } });
  ensureOptions(w, fields, 'Kind', FIELD_KINDS);
  for (const page of fieldPages()) upsertRow(w, fields, page);

  w.save();
  return w;
}

/* ---------- handbook sync (Issue #255) ----------
   applyHandbook used to run only from seedWeaver, which serve calls only when
   no weave.db exists — so a landed edit to a page in this file never reached
   a docs workspace that already existed. Boot now applies it the way it
   applies the Development manifest: the generated pages' hash on meta makes
   it one pass per build, not one per boot, so a hand edit on a page survives
   restarts until the source of that build moves. `weave handbook sync`
   applies on demand; `weave handbook check` reports drift and writes nothing.
   The apply is name-matched and additive: a guide a person wrote is never
   read, rewritten or removed, and sync deletes nothing. */
export function handbookHash() {
  return createHash('sha256').update(JSON.stringify(HANDBOOK_PAGES())).digest('hex').slice(0, 16);
}

export function handbookDrift(w) {
  const missing = [], stale = [];
  for (const [qualified, pages] of HANDBOOK_PAGES()) {
    const db = w.findTable(qualified);
    for (const page of pages) {
      const row = db && w.findEntity(db, page.name);
      if (!row) { missing.push(`${qualified}: ${page.name}`); continue; }
      const read = w.readEntity(row.id);
      const differs = read.doc !== page.doc || Object.entries(page.values).some(([k, v]) => !sameValue(read.fields[k], v));
      if (differs) stale.push(`${qualified}: ${page.name}`);
    }
  }
  return { missing, stale };
}

export function syncHandbook(w, { force = false } = {}) {
  const hash = handbookHash();
  if (!force && w.state.meta.handbookSync === hash) return { applied: false, hash };
  const { missing, stale } = handbookDrift(w);
  // The feed names the sync, not whoever happened to start the server.
  const actor = w.actor;
  w.actor = 'handbook-sync';
  try {
    applyHandbook(w);
  } finally {
    w.actor = actor;
  }
  w.state.meta.handbookSync = hash;
  w.save();
  return { applied: true, created: missing.length, updated: stale.length, hash };
}

/* The document half of the Showcase space: every construct a document can
   hold, each row written in the construct it names. Needs the Showcase space,
   which seedFieldShowcase creates. */
export const FORMATTING_PAGE = 'Every construct on one page';

/* The showcase as one document (Issue #88): a lead-in, the syntax reference
   as a table, then every sample body verbatim behind a divider. Nothing is
   rewritten on the way in — a sample that demonstrates a construct has to
   keep demonstrating it. */
function formattingPage() {
  const reference = [
    '| Section | Construct | Syntax |',
    '| --- | --- | --- |',
    ...FORMATTING_SAMPLES.map((s) => `| ${s.name} | ${s.construct} | ${s.syntax} |`),
  ].join('\n');
  return [
    '# Every construct a document can hold',
    '',
    'Each section below is written in the construct it names, so the page is its own proof. Read it in one scroll; fold a heading to skip what you already know.',
    '',
    reference,
    ...FORMATTING_SAMPLES.map((s) => `\n---\n\n${s.doc}`),
  ].join('\n');
}

/* ---------- the icon library, documented where it lives ----------
   Kyle, 2026-09-02: "store this as canonical in the showcase — an icon entity
   with a nicely formatted description, with pictures." One row in
   Showcase/Icons. The numbers come from the registry at apply time, so the
   page cannot drift from the set; the pictures are static files the server
   already serves, so a re-apply refreshes the text without losing them. */
await import('../public/icon-registry.js');
await import('../public/field-dialog-core.js');
const ICON_REGISTRY = globalThis.weaveIconRegistry;
export const ICON_LIBRARY_PAGE = 'Icon library';
export function iconLibraryPage() {
  const R = ICON_REGISTRY;
  const moving = R.NAMES.filter((n) => R.MOTION[n] > 0);
  const runs = moving.map((n) => R.MOTION[n]);
  const core = globalThis.fieldDialogCore;
  const groups = core.ICON_CATEGORIES.filter((g) => g.flat.length || g.marks.length);
  const twins = Object.entries(R.MARK_TWINS).map(([ch, n]) => `| \`${ch}\` | \`lucide:${n}\` | :${n}: | ${R.MOTION[n] ? `${R.MOTION[n]} ms` : 'still'} |`);
  // Every icon, drawn beside its name, grouped by Lucide's own categories.
  const gallery = groups.flatMap((g) => [
    '', `### ${g.name} · ${g.marks.length + g.flat.length}`, '', '| Icon | Value | Run |', '| --- | --- | --- |',
    ...g.marks.map((m) => `| :${R.MARK_TWINS[m] ?? R.MARK_ALIASES[m] ?? m}: | \`${m}\` | ${R.MARK_TWINS[m] && R.MOTION[R.MARK_TWINS[m]] ? `${R.MOTION[R.MARK_TWINS[m]]} ms` : 'still'} |`),
    ...g.flat.map((n) => `| :${n}: | \`lucide:${n}\` | ${R.MOTION[n] ? `${R.MOTION[n]} ms` : 'still'} |`),
  ]);
  const sample = ['activity', 'bell', 'bookmark', 'bug', 'calendar', 'chart-bar', 'compass', 'file-text', 'folder', 'funnel', 'heart', 'house', 'layout-grid', 'lock', 'mail', 'map-pin', 'pencil', 'search', 'settings', 'shield-check', 'star', 'trash-2', 'users', 'wallet'];
  const INV = core.ICON_INVENTORY.length;
  return [
    '# Icon library',
    '',
    `Weave's inventory is ${INV} names: **Lucide** shapes on one 24-grid at stroke 2, chosen for what a space, a table, an option or a state tends to be called, carrying the motion **movingicons.dev** (github.com/jis3r/icons, MIT) draws for ${moving.length} of them. The libraries are larger (Lucide draws 1,800 shapes, movingicons.dev moves 555); the inventory is what the picker offers, and this page shows all of it. Weave switched from Iconly flat on 2026-09-02; nothing stored had to move.`,
    '',
    '## Writing a value',
    '',
    `- \`lucide:<name>\` on a space, a table, a select option or a workflow state — \`${sample.join(' ')}\` among the names; \`weave vocabulary icons\` lists them all.`,
    '- An emoji is not an icon: the engine refuses any value outside the inventory. A legacy `iconly:` name still resolves; a mark keeps its character.',
    '- In a document, `:name:` draws the icon inline — :bell: `:bell:`, :bug: `:bug:`, :shield-check: `:shield-check:` — in a sentence or a table cell, where an emoji shortcode would go. A mark goes by its twin or its ring alias: :check: `:check:`, :ring-quarter: `:ring-quarter:`.',
    `- A value stored before 2026-09-02 as \`iconly:<name>\` keeps drawing: ${Object.keys(R.ALIASES).length} legacy names resolve to a Lucide twin (\`iconly:notification\` → \`lucide:bell\`, \`iconly:bug\` → \`lucide:bug\`) and the picker rings the twin. A reference that resolves to nothing draws a ghost ring with the name in its tooltip — the prefix never reaches the screen.`,
    '',
    '## Motion',
    '',
    `An icon plays **once per hover** and once per press — its own trigger, nothing else's. Nothing plays when a page loads or a picker opens (the first cut's load wave fired every icon on screen at once on refresh or login; Kyle ruled it out 2026-09-05, Issue #192). Nothing loops: a run lasts ${Math.min(...runs)}–${Math.max(...runs)} ms, \`infinite\` is rewritten to a single run when the set is built, and \`prefers-reduced-motion\` stills every icon. ${R.NAMES.length - moving.length} names draw still: the ones movingicons.dev animates by script rather than CSS, and the Lucide shapes the legacy aliases needed.`,
    '![Hover: one run per icon, then rest](/showcase/icons/hover.gif)',
    '',
    '',
    '## Marks',
    '',
    `A workflow state or select option keeps its **character** (\`✓\`, \`◔\`) as its value; the chrome's own marks (\`⟳\`, \`⧉\`, \`‹\`) are the same kind of thing. ${Object.keys(R.MARK_TWINS).length} of them draw as Lucide twins:`,
    '',
    '| Mark | Draws as | Drawn | Run |',
    '| --- | --- | --- | --- |',
    ...twins,
    '',
    'The six progress rings `○ ◔ ◐ ◑ ◕ ●` — :ring-empty: :ring-quarter: :ring-half-left: :ring-half: :ring-three-quarters: :ring-full: in a document — have no Lucide shape and stay hand-drawn in `public/mark-icons.js`, re-inked from a 2.5 ring to 2.0 so they sit level with the strokes beside them.',
    '',
    '## The picker',
    '',
    `Eleven groups — ${groups.map((g) => g.name).join(', ')} — hold the whole inventory: the vocabulary weave already had, the review's recommendations (key, terminal, layers, kanban, list-checks, timer, sparkles, lightbulb, rocket, paperclip, archive, copy, clipboard, refresh-cw, undo, redo, history, chart-column, blocks, bell-ring, message-square, user-cog, route, battery, wifi, radio, cloud-upload, cloud-download, cpu, gauge, award), and the twins a legacy value resolves to. Marks lead their group; a name typed by hand that no group claims files under other.`,
    '',
    'Search matches a name or a category, so typing `money` keeps the whole group. A name is never printed beside its icon in the grid: the search bar names the one cell the pointer or the keyboard is on, and rests on the icon already set, so reopening the picker says what the current one is called. The name is the tooltip too.',
    '',
    '## Pictures',
    '',
    '![The picker after the switch: the Issue table, the status group leading, the current icon ringed](/showcase/icons/picker-after.png)',
    '',
    '![The picker before the switch, same table: Iconly flat, filled glyphs at uneven optical sizes](/showcase/icons/picker-before.png)',
    '',
    '![Fourteen icons at 24px inside their grid — Iconly (top) fills the box unevenly and needed a hand scale table; Lucide (bottom) sits on one grid at one stroke](/showcase/icons/optical-box.png)',
    '',
    '## The inventory',
    '',
    `All ${INV}, drawn beside their values with the \`:name:\` form, in the picker's own groups:`,
    ...gallery,
    '',
    '## Rebuilding the set',
    '',
    '```bash',
    'node scripts/build-lucide-moving.mjs --moving <jis3r/icons checkout> --lucide <lucide-icons/lucide checkout>',
    '```',
    '',
    'writes `public/vendor/lucide-moving.js` (one inline svg per name), `public/vendor/lucide-moving.css` (the keyframes, scoped per icon under `.mi-<name>`) and `public/icon-registry.js` (names, categories, motion lengths, legacy aliases, mark twins). `test/icon-registry.test.mjs` gates the three: every name draws, every legacy name resolves, every twin exists, nothing loops.',
  ].join('\n');
}
export function applyIconShowcase(w) {
  ensureSpace(w, 'Showcase', 'Every field type, in several configurations — the range of what a field can be, visible in one grid');
  const t = ensureTable(w, 'Showcase', 'Icons', {
    description: 'The icon vocabulary: where the shapes come from, how a value is written, what moves and what stays still.',
    icon: 'lucide:sparkles',
    noun: 'page',
  });
  upsertRow(w, t, { name: ICON_LIBRARY_PAGE, doc: iconLibraryPage() });
  w.save();
  return t;
}

export function applyFormattingShowcase(w) {
  ensureSpace(w, 'Showcase', 'Every field type, in several configurations — the range of what a field can be, visible in one grid');

  const t = ensureTable(w, 'Showcase', 'Formatting', {
    description: 'Every construct a document can hold, each row written in the construct it names.',
    icon: 'lucide:file',
    noun: 'construct',
  });
  ensureField(w, t, {
    name: 'Construct',
    type: 'select',
    config: { options: ['Structure', 'Block', 'Format', 'Table', 'Code', 'Diagram', 'Math', 'Reference'].map((name) => ({ name, color: '' })) },
  });
  ensureField(w, t, { name: 'Syntax', type: 'text' });

  // One page, not twelve (Issue #88). Kyle: "formatting showcase could all be
  // done in one entity's description." Twelve rows meant opening twelve
  // records to see a renderer that one scroll proves, and the last of them
  // already carried the whole demonstration on its own. Each sample's body
  // moves over verbatim — every construct still demonstrates itself — and the
  // Syntax column survives as a table inside the page it describes.
  upsertRow(w, t, { name: FORMATTING_PAGE, values: {}, doc: formattingPage() });
  // Rows from the twelve-row era go to the trash, not the void.
  for (const row of w.query('Showcase/Formatting', { limit: 200 }).items) {
    if (row.name !== FORMATTING_PAGE) w.deleteEntity(row.id);
  }

  w.save();
  return w;
}
