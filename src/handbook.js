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
| \`display\` | \`text\` (default), \`bar\`, \`ring\`, \`heat\` | how the value is drawn: a bar or a ring filled to its share of the scale, or a cell tinted by it; the text rides beside it, and the API still returns the number |
| \`scale\` | \`column\` (default) or a number above 0 | what 100% is for a bar, ring or heat: the column's largest value, or a fixed figure (\`1\` for a percent, \`5\` for a score out of five) |
| \`color\` | \`ink\` (default), \`icon\`, \`accent\` | the colour a bar, ring or heat is drawn in (Feature #235): Quiet ink is the text colour on a hairline track and a grey tint; Color by icon draws bars and rings teal and runs heat from cool to warm; One accent hue draws everything in the workspace accent |
| \`default\` | number | the value a new row starts with |

\`\`\`json
{ "name": "Price", "type": "number",
  "config": { "format": "currency", "currency": "USD", "decimals": 2 } }
\`\`\`

A bar is 6px tall with round ends on an 80px track, the figure to its right; a ring is 16px; heat is a rounded tint behind the figure. A graphic column opens wide enough for its graphic and its widest figure; a width you drag is kept. Under \`display\` the tray's **Color** picker draws three swatches, each this field's graphic in that setting. The field's settings tray also draws a **Sample**: this column's own smallest, middle and largest figures in the chosen costume, measured against the chosen scale, so a bar on \`column\` shows what the column will look like. A column holding no numbers yet samples a quarter, three fifths and the whole of the scale instead, labelled as examples.

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
Half a range is not a range: the server refuses one end, so an unfinished pick stays in the dialog until the other end lands, and one date typed alone into the box is refused with a toast. The elapsed span is computed at read time from the two ends and never stored — a formula wanting it uses \`datediff\`.

**A sort reads the stored ends, not the painted span.** A range sorts by its start, then by its end, so two spans that open on the same day stack the shorter one first — the way a calendar does. The costume changes nothing: \`Oct 1 – Oct 3, 2026\` sorts below \`Sep 9 – Sep 12, 2026\` because October is later, not because \`O\` beats \`S\`.` },

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

Boolean, worn as a switch with two named states (Feature #202). Same storage as a checkbox — \`true\` / \`false\` is what a formula, a filter, a CSV cell, the API and MCP read — but the config names the states, and every surface that draws the value draws the switch with the label of the state it is in: the grid cell, the entity page, the chip and the card, the Filters popover. Null normalizes to \`false\`, so a toggle is never empty.

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

  { name: 'rating', kind: 'Value', doc: `# rating

A whole number from 0 to the field's \`max\`, drawn as \`max\` icons with the first ones filled (Feature #231). Scoring a row (priority, quality, fit) takes one click instead of a number and a scale to remember. To a formula, a sort, a filter, CSV, the API and MCP it is a number.

## Config

\`max\` — how many icons, any whole number from 1 to 100; \`5\` unless named (Feature #234). The field dialog takes any number and offers 3, 5 and 7 as shortcuts. The ceiling of 100 keeps a screen of rows paintable: every icon is a button in every visible cell.

\`icon\` — one icon for the field, picked from the inventory (\`lucide:<name>\`, or a mark): \`lucide:star\` unless named. \`{ "name": "Fit", "type": "rating", "config": { "max": 7, "icon": "lucide:heart" } }\`.

\`color\` — \`ink\` (default) fills the icons in the text colour with hairline outlines for the empties; \`icon\` fills them in the icon's own hue (a star amber, a heart rose, a bolt violet, anything else the accent); \`accent\` fills them in the workspace accent (Feature #235). The tray's **Color** picker shows three of the field's own icons in each setting. A lookup or a rollup of the rating draws in its colour.

Icons are 14px with a 1px gap. A rating column dragged narrower than its icons, or past the fit cap, draws a compact \`★ 3/12\` instead of cutting icons off.

\`default\` — the rating a new row starts with. In the field dialog it is picked on a row of the field's own icons: click the nth to set n, click it again to clear; with the row focused, the arrow keys move it, a digit sets it and \`Backspace\` clears it. Lowering \`max\` below the default brings the default down with it.

## Usage

Click the third icon to set 3; click the filled third icon again to clear to 0. In the grid a digit key on the resting cell sets the rating (a digit past the max sets the max) and \`Backspace\` or \`Delete\` clears it to 0. A screen reader hears "3 of 5".

A write is rounded and held to 0..max: \`{"Fit": 3.6}\` stores 4, \`{"Fit": 9}\` stores 5, numeric text is read as its number, anything else is refused by name. Lowering \`max\` holds every row to the new ceiling.

A rating column in the grid opens wide enough for every icon: \`max\` icons, the gaps between them and the cell's padding, up to the fit ceiling of 320 pixels (Issue #404). A width you drag stands.

A lookup of a rating, and a rollup whose answer stays on the scale (\`avg\`, \`min\`, \`max\`, \`median\`), draw the same icons, read-only, rounded to a whole number; the API returns the unrounded figure. A \`sum\` or a spread leaves the scale and prints as a number.

## Migrations

\`number\` ⇄ \`rating\` both ways: a number becomes a rating by rounding and clamping to the max; a rating becomes the number it held. To \`text\`, each row freezes its number.

## In formulas

\`[Fit] * 20\` reads the number: a 4 of 5 is 80.

## Gotchas

Empty and 0 are different: an unrated row is empty (\`is-empty\` matches it), a cleared one is 0.` },

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

\`options\` — strings, or objects carrying a hue and a glyph. \`default\` — one option, by name or id; without it a new row's value is empty. The field dialog picks it from the options (*No default* first), and removing that option clears it.

\`\`\`json
{ "name": "Priority", "type": "select", "config": { "options": [
  { "name": "Low",    "hue": "green" },
  { "name": "Medium", "hue": "amber" },
  { "name": "High",   "hue": "red" }] } }
\`\`\`

**The palette is ten hues and nothing else**: \`slate\` (no hex), \`blue\` \`#4769eb\`, \`green\` \`#2ea043\`, \`amber\` \`#f59f00\`, \`red\` \`#e5484d\`, \`purple\` \`#8e4ec6\`, \`cyan\` \`#00a2c7\`, \`pink\` \`#d6409f\`, \`teal\` \`#12a594\`, \`orange\` \`#f76b15\`. Name the hue in \`hue\`, or give its hex in \`color\`; weave stores both. \`magenta\` is the name pink was published under and still resolves to pink, and \`neutral\` still resolves to slate. Any other name or hex is refused with a 400 that names the ten (Issue #551). Slate is the honest default: a colour should carry meaning, not decoration.

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

**Leave \`states\` out and you get one.** A workflow whose config never mentions states arrives as \`Not started\` · \`In progress\` · \`Done\` · \`Canceled\` — one per category — in the tray and on \`weave field add\` alike. Rename, reorder, recolour or delete them like any others. Sending \`"states": []\` is a different thing and still refused: a list emptied on purpose is not a lifecycle.

**No state is the default unless you mark one.** A new row's state is empty until someone sets it, unless one state carries \`"default": true\` (at most one does; the first marked wins). In the field dialog that is the **Default** picker under the states: *No default* first, then the states. A state can be set back to empty (\`null\`, or the — row in the cell's picker). Fields created before 2026-09-26 stored their first state as the default and keep it until the Default is changed.

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

The field's settings tray shows the recipe as read-only **Relation** and **Field** rows, and a **Shows as** line naming the display it inherits: a lookup of a rating reads \`Drawn as the rating on People › Skill: 5 stars.\`, with a link to that field's settings, where the look is changed. The recipe is set when the lookup is created (Issue #387).

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

A grid carries no Σ row until you ask for one: tick **Σ rollup row** in the Fields popover's Rows section and the grid draws every space rollup in a **Σ row** pinned under the field headers — it stays while the body scrolls — and offers the aggregates on a click in that row. The box saves into the current view as its \`rollups\` (\`weave_table_view\`, never a browser setting). A view that has never set it follows the table's older \`hideRollups\` (mirrored as **Hide Rollups** on its Tables row): \`false\` is a table that opted in, \`true\` is one switched back off, and a table nobody has touched has no row. The space page draws the same rollups as tiles; \`weave stats <table>\` / \`weave_stats\` / \`GET /api/tables/:ref/stats\` summarise every column on demand without storing anything. A space rollup answers on its own space's row and reads \`null\` on every other; \`via\` is refused anywhere but the Spaces registry and on registry tables.

## Usage

The field's settings tray shows the recipe as read-only **Relation**, **Field** and **Aggregate** rows, a **Result** line with the value on a row of the table, and a **Shows as** line naming the display it inherits from the field it reads (a rating's icons, or a number's bar, ring or heat), with a link to that field's settings. The recipe is set when the rollup is created (Issue #387).

Renders on a tinted background marked \`Σ\`, wearing the target column's costume: a sum of dollars is dollars, the \`max\` of a date column is a date; a mean of whole numbers shows two decimals. \`join\` accepts a \`separator\`; the default is \`, \`.

## Gotchas

A rollup crosses a relation; a formula stays on the row. Reaching for a formula where a rollup does the job is the most common way to end up with a number that will not update.

The \`targetField\` cannot be deleted while a rollup reads it — the delete is refused and names the rollup; delete the rollup first. A rollup that already lost its target (a workspace from before that refusal) reads \`null\`; \`count\` never had a target and keeps counting.` },

  { name: 'formula', kind: 'Computed', doc: `# formula

An expression over this row's own fields, recomputed on read.

## Config

\`expression\`, plus every number costume key — \`format\`, \`currency\`, \`unit\`, \`decimals\`, \`separator\`, \`accounting\`, \`display\`, \`scale\`, \`color\` — so a computed figure can wear the same clothes as a stored one; a list result also takes \`display: sparkline\` and its \`style\`. A rollup over a number column wears that column's format and display.

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

## Lists and the sparkline

A formula can return a list or null. A list comes in through a lookup over a to-many relation, in relation order. \`sortby(values, keys)\` orders it by a parallel list, ascending, blank keys last: \`sortby([Deal amounts], [Deal close dates])\` is the amounts in close-date order. Two lookups over one relation keep their blank slots in position, so the pairs stay together (Feature #232).

A list result can wear \`"display": "sparkline"\` with a \`style\` of \`line\` (the default), \`column\` or \`winloss\`. The cell, the chip and the card draw the newest 60 points; the hover lists every value and says when it cut; a screen reader hears the count, the last value, the low and the high. Sort and filter on the column read the last number in the series. The API returns the numbers. \`color\` paints it: \`ink\` (default) in the secondary text colour, win/loss as text colour and muted; \`icon\` a blue line, green wins and red losses; \`accent\` the workspace accent, losses a lighter accent. The sparkline is drawn 80 by 18 at its own size. A rich cell leaves the \`ƒ\` to its column header.

\`\`\`json
{ "name": "Trend", "type": "formula",
  "config": { "expression": "sortby([Deal amounts], [Deal close dates])", "display": "sparkline", "style": "column" } }
\`\`\`

## Check before you save

The script editor validates as you type: a parse error, an unknown function or an unknown field shows under the box in red, and a valid expression shows its computed value on a real row. The same check stands alone as \`weave formula check <table> '<expression>'\`, \`POST /api/tables/:id/formula-check\` and the \`weave_check_formula\` MCP tool — validate until \`ok: true\`, save, then read a cell back. Saving an invalid expression is refused with the same error the check gives.

The chips under the script are the whole vocabulary: this table's fields first, then the functions in the four groups the grammar has — **logic** (\`if\`, \`empty\`, \`contains\`), **text**, **number**, **date**. Hover, focus or tap a chip and a card shows its signature, one sentence of what it does and an example; click it and the call lands with the caret between the parens. A document or an attachments field is listed greyed with the reason — a formula reads values, not prose or files — rather than left out. \`weave vocabulary formulaFunctions\` (and \`weave_vocabulary\`, \`GET /api/vocabulary\`) serves the same cards verbatim.

Under the chips, **As an agent would do it** (closed by default) prints the three calls that do what the dialog is doing — \`weave formula check\`, \`weave field add\` (or \`update\`) with the expression, \`weave get\` to read the cell back — and the MCP sequence \`weave_check_formula → weave_add_field → weave_get_entity\`, live with the typing. Copy it into a script and the browser was never the only door.

The verdict line names the result's **type** (number, text, boolean, list) and the dialog scans the table behind it — up to 200 rows — so the line under it reads \`row 1 of 51 — "Acme"\` with ‹ › to step through rows and pick the pathological one, and \`⚠ 2 rows → null · 1 → #ERR\` when any row did not compute. A formula valid on row 1 and null on a third of the table is exactly the bug one preview cannot show. The **Result format** section (currency, unit, decimals) only appears when the result is a number. The same figures come back from \`weave formula check <table> '<expression>' --scan\` and \`weave_check_formula {scan: true}\` as \`{type, scan: {rows, capped, nulls, errors, sampleByOutcome}}\`.

Chips are discovery; typing is speed. In the script box, \`[\` opens a list of this table's readable fields at the caret and two letters open the functions that start with them — the same two lists the chips draw from, ranked by prefix. ↑ ↓ move, Return picks (a call lands with the caret between its parens), Escape closes the list and nothing else. A misspelled field name dies at the keystroke instead of at the check; the verdict line stays live underneath.

## Gotchas

A formula reads **raw** values. A number's currency and unit are display costumes and never reach the expression, which is what keeps \`Price * Count\` from breaking when someone turns on thousands separators.

A formula cannot reference its own field — it never converges, and the save refuses it as an unknown field.

A formula cannot reach its own field the long way round either. \`Total\` reading \`Bonus\` while \`Bonus\` reads \`Total\` is refused when it is saved, and the message names the path: \`Formula 'Bonus' would close a reference cycle: Bonus → Total → Bonus\`. A loop that only closes through a rollup or a lookup takes two rows pointing at each other to exist, so no save can see it — those cells read \`#CYCLE:\` and the path instead of computing, and the marker travels: a rollup over a looping value reports the loop rather than summing it. A loop that stays on one row names its fields (\`#CYCLE: Double → MirrorSum → Double\`); one that travels between rows names them too (\`#CYCLE: Alpha › Double → Alpha › PeerSum → Beta › Double → Beta › PeerSum → Alpha › Double\`), because the rows are what closed it (Issue #283).

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

Every OTHER document is a column of its own in the grid: a named chip wearing the kind it holds — the declared kind when the field declares one, the sniffed kind otherwise. It hides behind the eye, resizes and reorders like any field. All documents open in full on the entity page and in the dock. While you scroll a long one, the entity header stays at the top and the document's section head (its name, history, copy link and menu) stays under it until the document ends; the next document's head takes its place.

\`\`\`bash
weave doc set Task#5 --field Spec --content '# Spec'
weave doc append Task#5 --field Spec --file notes.md
weave doc export Task#5 --format pdf --out t5.pdf
\`\`\`

Every document is addressable as MD, HTML, MMD and PDF at \`/e/<id>/doc/<Field>.<fmt>\`.

A write over HTTP carries its text under \`doc\` or \`markdown\`: \`PUT /api/entities/<id>/doc\` replaces, \`POST\` appends, and \`field\` in the body picks a named document. A body with neither key is a 400. Clearing stays explicit, \`{"doc": ""}\` over HTTP and \`weave doc set --content ''\` from the CLI, so leaving the text out is a mistake rather than a blank document.

## History

Every document keeps its own revisions. A revision is one editing session: writes by the same actor to the same field within ten minutes fold into one, so a pause is not a snapshot and a keystroke log never builds up. Identical text records nothing. Two hundred revisions are kept per document, oldest trimmed; the trash keeps them, a purge drops them with the row.

The history control (the clock-arrow beside the source toggle in the section head) shows once a document has more than one revision. It opens a panel inside the section: the list newest first — when, who, how much the size moved — and a row shows that revision read-only in place of the editor under a **Viewing revision** bar. **Restore** writes it back as an ordinary edit (undoable, on the activity feed) and the editor returns; **Back** or Escape returns without writing. A restore never overwrites what it replaces: both texts stay in the list.

\`\`\`bash
weave doc-revisions Task#5 --field Spec          # newest first: seq, at, actor, len
weave doc-revisions Task#5 --field Spec --seq 41 # that revision's text
weave doc-restore Task#5 --field Spec --seq 41   # write it back
\`\`\`

Agents reach the same three through \`weave_doc_revisions\` / \`weave_doc_restore\` and \`GET /api/entities/<id>/doc/revisions?field=\`, \`GET …/doc/revisions/<seq>\`, \`POST …/doc/revisions/<seq>/restore\`. Revisions live beside the entity, not inside it: an export carries the current text only.

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

\`text\`, \`number\`, \`rating\`, \`date\`, \`daterange\`, \`checkbox\`, \`toggle\`, \`url\`, \`email\`, \`select\`, \`multiselect\`, \`workflow\`, \`document\`, \`field\`, \`key\`, \`attachments\`.

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

In the app, drop files from your desktop onto the field's cell in the grid, or onto its files on the record: the cell lights while files hover it, and every file you let go of uploads into the field. **+ file** on the record picks one from a dialog. A single-file field refuses a second file and says so.

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

Type \`/\` on an empty line, or after a space on a line that already has text. Three groups:

| Group | What it holds |
| --- | --- |
| **ALL COMMANDS** | blocks — headings, lists, quote, code, mermaid, table, divider, line break, raw HTML |
| **REFERENCE** | a link to an entity, a table, or a space; picking one opens the search |
| **FORMAT · APPLIES TO SELECTION** | bold, italic, strikethrough, inline code, link |

Each row shows its markdown on the right, so the menu teaches the syntax rather than hiding it. Aliases catch what you actually type: \`/todo\` finds the task list, \`/hr\` the divider, \`/h4\` a level-four heading directly.

A format command wraps the text you selected rather than a placeholder — as long as you selected it in the last fifteen seconds. Select a phrase, type \`/bold\`, and the phrase is what ends up bold.

Text, a heading, a list, a task list and a quote take the line they are typed on. \`Buy milk /task\` becomes \`- [ ] Buy milk\`, \`## Plan /task\` becomes \`- [ ] Plan\`, and \`/text\` on a heading gives a plain paragraph. The words, their inline formatting and a nested item's indent stay; the caret goes to the end of the line. On an empty line the command writes its prefix and a placeholder to type over. Every other block (code, mermaid, table, divider, line break, image, raw HTML) is inserted beside the text.

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

In the editor a chip shows the target's name. Its tint stops where the name does; hover for the table and number. A bare \`[[Task#12]]\` leaves room for a few characters only, so a long name ends in an ellipsis. Picked from the \`#\` search, the reference carries the name and fits.

## Code

An unlabelled fence detects its own language — JSON, HTML, a mermaid source, a shell session — and highlights it. Naming the language on the fence still wins. Anything unrecognised stays plain text, which is the right answer for a config snippet nobody has a grammar for.

Highlighting is the vendored highlight.js: github in light, github-dark in dark. The block chrome belongs to weave, so a code block reads like the rest of the page in both themes.

Click into a block and you edit the code itself; the fences and the language stay out of sight. The **</>** button in the block's upper right shows them, so you can rename the language, and a second click hides them. Leave the block and it closes again.

## Diagrams

A \`mermaid\` or \`mmd\` fence renders as a diagram — in the editor, and in every export. \`.mmd\` is a first-class download format beside \`.md\`, \`.html\` and \`.pdf\`.

Clicking a diagram keeps the drawing on screen. Its source sits behind the same **</>** button, and typing into the block opens the source first, so you never edit text you cannot see.

Graphviz, PlantUML, echarts, mindmap, abc and flowchart fences are deliberately **not** vendored. They degrade to plain code blocks rather than pulling six renderers into the tree.

## Math and chemistry

\`$…$\` inline, \`$$…$$\` as a block, rendered by KaTeX. mhchem rides along, so \`\\ce{H2O}\` works — and it is load-bearing rather than a bonus: the math render callback lives inside mhchem's load, so dropping it would silently kill all math, not only the chemistry.

KaTeX is the only optional renderer in the tree.

## Tables

Inside a table, **Enter** adds a row, **Shift+Enter** breaks a line within the cell, and **Tab** moves to the next cell. A wide table scrolls inside its own frame rather than pushing the page sideways.

## Folding

Click a heading's gutter to fold it. Everything down to the next heading of the same or a higher level collapses.

The fold lives in an overlay layer, never inside the document itself, so **the stored markdown does not change when you fold**. Fold state is remembered per entity and field in your browser and comes back on reload.

A document that opens with a level-one heading matching the record's name, ignoring case and spacing, hides that heading on the entity page, because the page title above it already says it. The heading stays in the markdown and in every export. Rename the record and the heading shows again.

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

## The home page and a space page

The first time you open an empty instance, a short welcome asks you to name the workspace (a default is filled in), then offers a starter or an empty workspace. **Skip setup** or Esc keeps the defaults. It runs once per person, and an existing workspace with tables never shows it; rename the workspace later from its chip in the rail or its page title.

A workspace with no tables of your own opens its home page on an empty state: one line on spaces and tables, a **New table** button, and three templates (**Money**, **Work**, **People**). The system **Workspace** space (**Spaces**, **Tables**, **Fields**, **Views**, **Workflows**, **Workspaces**) doesn't count as yours.

**New table** asks for a name and a space, offering **General** if you have none. A template builds its space, tables, fields and a few sample rows in one build call, and opens its first table. **Money** links each transaction to an account and a month, and a **Months** row totals what was **Spent** and **Earned** that month and the **Net** between them; you link the rows by hand for now. **Work** gives **Tasks** a status, a due date and a priority. **People** links **Contacts** to **Companies**. The empty state ends with your first table.

Then the home page shows the relation map. A space page shows a **+ New table** button, the space's relation map, and its tables with record counts.

On both pages the grid (**Spaces** on home, **Tables** on a space page) sits under a collapsed **Schema** disclosure; opened, it stays open in that browser until you close it. Every column is editable in place, including the **Tables** grid's **Field Order**, **Hidden Fields**, **Filter** and **Sort**.

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

The dock is the entity itself, not a preview: edit there and the table keeps its place, the docked row stays lit, Esc closes it. **Docked is the default pose** (Issue #198): a relation chip, a card, a mention chip in a document, a ⌘K hit and a document chip in a cell all open the entity in the dock beside the table you are reading. **The dock follows the click and the page stays** (Issue #276): a relation hop into another table docks that row beside the table you were on, the grid keeps its place and its filters, nothing lands in the browser history, and the dock's own crumb carries the path taken — Deals › Acme › Contacts › #4 — with a back arrow (or Esc) that walks it one hop at a time. Only from a page with no table under it (home, a space, the activity page) does a hit travel to the entity's table first. The outward diagonal arrows on the dock expand it to the full page (⌘⇧E flips either way); the inward arrows on the page dock it again. The dock keeps every control on its breadcrumb line (Issue #583): the back arrow at its left, the eye, the ⋮, the expand arrows and the ✕ at its right, and that line stays pinned at the top of the pane while the record scrolls under it. Only a \`#/entity/…\` address opens as the page — the address a new tab, a permalink and the expand arrows land on. ⌘-click a row (or its \`#id\` link) to give the record its own browser tab. Every navigating surface in weave answers the same three gestures — ⌘/Ctrl, Shift, and the middle button — so an activity row, a ⌘K hit and a node on the relation map open in a tab the same way. Text cells keep their own modifiers: shift-click still extends a selection there. A document chip in a cell opens its entity in the dock.

## A big table draws only what is in view

The grid holds the rows in view plus a buffer of rows above and below — the buffer runs ahead of the direction you scroll, so the next rows are drawn before they arrive — and two spacer rows stand in for the rest, at the height they would take, so the scrollbar and the scroll position are honest (Issue #271). The rows come in pages of 200 in the table's sort and filter order; the page past the edge of the window is fetched before it is needed, and a row whose page is still on its way holds its place at the row height for the moment it takes. The foot reads \`200 of 2,087 loaded\` until every row has been through the window. Sort and filter stay on the server, so page one is the right 200 and the Σ row still reads the space rollups, never the page. A cell commit re-reads the pages under the window and redraws at the same scroll.

## Searching everything (⌘K)

⌘K (Ctrl+K on Windows and Linux) or the sidebar's search control opens the palette. A tag at the right of its \`Search <workspace name>\` box names the current workspace. An empty palette lists Recent: the last eight records and tables opened here, newest first, kept in this browser only. Typing searches every workspace; a match from another carries that workspace's name in an outlined tag. Matches are grouped with counts: Records (name or \`#143\` id), In documents (words in a document or text field, with an excerpt), Tables, then Spaces and views; empty groups are dropped. Each match shows a kind icon, its name with your text highlighted, any workflow state chip, and its location on the right (\`Task #1\`, \`Product · table\`).

The footer lists the keys: \`↑\` and \`↓\` select, \`Tab\` and \`Shift+Tab\` jump between groups, \`Return\` opens and \`Esc\` closes. The copy button on the selected or hovered match copies its permalink. ⌘-click or middle-click opens a match in a new tab and leaves the palette open (Issue #382).

## Searching a table

The magnifier in the table's toolbar opens a search box; \`/\` or \`⌘F\` opens it from a resting cell. It uses the ⌘K matcher, scoped to this table: a name fragment, a \`#143\` id, or the words in a text field or a document. The grid keeps only the matching rows as you type, in the table's own sort and inside its saved filter, and the foot reads \`3 records found\`. The search runs on the server, so it reaches every page of a big table, and it belongs to you alone: it is never saved on the table and nobody else's view changes (Feature #228). \`Return\` on a single match opens that row in the dock. \`Esc\` clears the box and folds it away; a search that finds nothing says so and offers **Clear search**. \`+ New\` clears the search first, since an empty new row matches nothing.

## The grid from the keyboard

Cells **rest as values** and open on purpose. The cursor is a ring on one cell; the arrows and Tab move it, and a cell opens when you ask. That is what gives ← and → to navigation: a text caret only owns them while a cell is open, and hands them back when you Tab, Return or Esc out.

\`?\` shows these keys. Press it on a resting cell, or anywhere outside a text field and the document editor, or click the \`?\` chip at the foot of the workspace rail: a sheet lists every key below, read from the grid's own keymap so it cannot promise a key the grid has dropped (Issue #268). \`Esc\` closes it and puts focus back where it was. Inside an open cell, \`?\` is a character like any other.

| At rest | What it does |
| --- | --- |
| \`← → ↑ ↓\` | move the cursor |
| \`Tab\` / \`⇧Tab\` | along the row, wrapping into the next or previous row; the last cell of the last row is the end, never the browser's chrome |
| \`Return\` | open the cell: a caret with the value selected, a picker, a flipped checkbox |
| any character | open the cell and start typing over the value |
| \`/\` or \`⌘F\` | search this table |
| \`Space\` | pick the row up — or, on a toggle cell, flip the switch |
| \`0\`–\`9\`, \`Backspace\` | on a rating cell: set the rating, or clear it to 0 |
| \`⇧↑\` / \`⇧↓\` | extend the run of chosen rows |
| \`⌘A\` | take every loaded row — the foot says how many that is |
| \`Home\` / \`End\` | the first or the last row of the table, scrolled in first |
| \`⇧Return\` | make the next row, open on its name |
| \`⌘Return\` | open the record in the dock |
| \`Esc\` | let the selection go |
| \`?\` | the sheet of these keys |

| In an open cell | What it does |
| --- | --- |
| \`← →\` | the caret's; they never step out of the cell |
| \`Home\` / \`End\` | the start or the end of the value — the grid places the caret, so the window never scrolls out from under an open editor (Issue #260) |
| \`⇧Home\` / \`⇧End\`, \`⌥←\` / \`⌥→\`, \`⌘←\` / \`⌘→\` | the browser's own editing keys: select to the edge, walk a word, walk a line |
| \`Return\` | commit, move down the column |
| \`Tab\` / \`⇧Tab\` | commit, move across |
| \`↑\` / \`↓\` | commit, move up or down |
| \`Esc\` | put the value back and rest |
| \`Space\` | a space |

Every field cell is a stop, select, multi-select, checkbox and date included. A document chip column is not: it is a door to the record, not a value, so the cursor passes over it. The checkbox column and the \`#id\` link are pointer targets; \`Space\` and \`⌘Return\` are their keys.

The first \`Tab\` on any page lands on **Skip to content**, which moves focus past the rail and the sidebar into the page. Wherever focus goes, it wears one ring: 2px of the brand blue, drawn clear of the control and at 3:1 or better against it in both themes (Issue #378).

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
- **A relation links by name.** Each label in the paste — a copied relation cell, or \`Ann, Bob\` from a sheet — is matched against the related table's rows: a cell copied inside weave links the same rows; otherwise the exact name (case and surrounding spaces aside), then \`#12\`. A set is replaced whole, as a multi-select is; a single relation takes the first match. A label that names no row is never invented: the message counts and names it, and a cell whose labels all miss is left alone.
- **A formula, rollup, lookup, view or document column takes no paste.** The cell refuses and the message names the column, the way the selection bar names what did not land.
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
| **Move to trash** | past a hairline, on its own. It is instant: the message it raises carries **Undo**, which brings back every row it took, and the cursor moves to the row after them |

| Under ⋯ | What it does |
| --- | --- |
| **Move to table…** | re-creates each row in the chosen table, matching fields by name and type, and trashes the original. Fields the far table lacks, files and comments stay behind — the bar names them |
| **Roll up into a new …** | pick a relation, name one new parent in its table, and every chosen row is linked to it |
| **Copy links** | one permalink per chosen row on the clipboard; the selection stays |

Set a field, Link to, Move to table and Roll up are each one write (\`POST /api/bulk\`, \`weave bulk\`, \`weave_bulk\`), reported per row. If part of it fails, the bar says what did **not** land rather than reporting a success it cannot vouch for, and each row keeps its own undo step. A \`set\` also reports \`changed\` — the rows whose value actually moved, which is how deep the undo stack it left goes, and what the grid's fill and paste count before offering to step one back.

## Column order, width, and what is on screen at all

| Control | Where | What it does |
| --- | --- | --- |
| Drag a header | table view | moves the column: a line marks where it lands, and the view keeps the order. Drop it across the seam beside **#** to freeze it; drop a frozen one back across to unfreeze it |
| Alt+Shift+\u2190 / \u2192 on a focused header | table view | moves the field one place. Crossing the seam freezes or unfreezes it where it stands |
| Drag a header's right edge | table view | sets the width. Only that column changes; the columns to its right slide over, and a readout shows the width and the change. It stops at its own label |
| Alt+\u2190 / \u2192 on a focused header | table view | narrows or widens the column by 8px, down to its label |
| Double-click that edge | table view | fits the column to its longest value, up to the type's maximum and never under its label |
| Click a header, or Return on a focused one | table view | opens the field tray to rename, retype or reconfigure. The click that ends a drag or a resize opens nothing |
| ⋮ on a header | table view | sorts by that column, stored on the table for everyone. The two rows read by type: **Oldest to newest** for a date, **Smallest to largest** for a number, **A to Z** for text, **Option order** for a select and **State order** for a workflow (the order the definition lists them in), plain **Ascending** where no one reading fits. The **#** column and the system columns carry a sort-only ⋮ of their own |
| 👁 | view toolbar | show or hide any field, the system columns, and deleted rows |
| Drag the grip | entity page | reorders fields; the table's columns follow |
| Fold FIELDS | entity page | the caret beside FIELDS folds the value rows into one line of label · value chips, so a long field list stops pushing the documents down; the chips still edit in place, and the fold is remembered per row in this browser |

The **#** column takes none of this. It is frozen to the grid's left edge, so a wide table scrolls sideways underneath it and the row keeps its id and its \`\u2197\` permalink whatever column you have read your way out to; the selection checkbox travels with it. No drag moves it, and no field can be ordered ahead of it.

Fields dropped across the seam beside **#** freeze with it, and stay put while the rest of the grid scrolls. The frozen zone stops at 60% of the visible grid: a drop past that lands on the scrolling side, and a narrow window draws fewer fields frozen without forgetting the rest. The hairline at the seam shows only while something scrolls under it.

Every field type opens at a default width: Name 260px, text, links and multi-selects 180, long text 280, selects and workflows 124, relations 136, dates 112, numbers 88, currency 104, checkboxes 56. A header label never clips: a label longer than its default widens that column, and no drag, nudge or fit goes under it. Widths belong to the view, so each view keeps its own. Showing, hiding, adding or removing a field never resizes another one; the neighbours slide, and the space at the right of the grid takes up the difference. A hidden field keeps its width and its place for when it comes back.

The five system columns — \`Created At\`, \`Modified At\`, \`Created By\`, \`Modified By\`, \`Activity\` — are off by default. Turn them on where provenance is part of the record. A view shows the ones you turn on in its own list: each one drags, freezes across the seam and sizes like any field, and its place and width are the view's. Activity is the history panel on the record, not a column, so it stays a switch for the whole table. Every one but Activity sorts from its ⋮; the stored sort names it (\`Created At desc\`), and \`Public Id\` is the name the # column sorts under.

Hide rather than delete when a column matters to a machine and not to a reader. Hiding keeps the data and the API surface; a delete needs \`hard\` and does not come back.

## What a field means

Every field can carry a **description**: what the value represents and how it is written — \`Who we bought from — the legal name on the invoice\`, \`ISO date of the first event in the transcript\`. It sits under the label on the entity page and in the folded chips, is the column header's tooltip in the grid, and rides the schema (\`weave_schema\`, \`weave schema\`, \`GET /api/schema\`) as the field's \`description\`, so an agent filling the row reads the same note a person does. Set it in the field tray (click a header, or a label on the entity page), or from the schema verbs:

\`\`\`bash
weave field update Order Vendor --description "Who we bought from — the legal name on the invoice"
weave field add Order "Due" date --description "When the invoice falls due; ISO date"
\`\`\`

\`{description: null}\` clears it. The two view fields are the exception: on Chip and Card, \`description\` is the description **size** (none, small, medium, large), not a note.

## Taking a field change back

Saving a field in its tray shows a toast, \`Qty updated\`, with **Undo**. Undo puts the field's definition back the way it was before that save: its name, options and their colours, states, formula, format, default and description.

The toast lasts a few seconds. The record of the change stays in Activity: every change to a field's configuration is an entry on its table, \`field-config-updated\`, with the definition before and after. It shows in the Activity table with the table as its record, and its own page has a **Roll back** button. The column width is the exception: a width belongs to the view, so resizing a column records nothing.

A roll back checks first. If the field has changed since the entry, the page says so and changes nothing: roll back the newer change first. Undo and Roll back each write an \`undo\` entry of their own, which can itself be rolled back.

Removing an option or a state leaves the rows that held it alone: they keep its id, so rolling the change back brings their values back. A **type change** converts every stored value to the new type, and weave keeps each row's value from before it, so its Undo and its Roll back bring the values back with the definition. A row someone edited after the change keeps that edit, converted back to the old type, and a row made after the change is converted the same way. The toast says how many values came back, how many edited rows were kept and how many newer rows were converted.

Weave keeps the values of a field's newest type change only. When a field changes type again, the older entry keeps its two definitions but not its values, and its page says so: rolling it back cannot bring those values back.

Agents reach the same history: \`weave_activity {entity: <table id>}\` lists a table's entries, and \`weave_rollback_field\` (\`weave field rollback <table> <field> --activity <id>\`) rolls one back. Rolling back needs the same permission as changing the field.

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

The option palette is the ten-hue ramp and it is closed: \`slate\`, \`blue\`, \`green\`, \`amber\`, \`red\`, \`purple\`, \`cyan\`, \`pink\`, \`teal\`, \`orange\`. Name a hue in an option's \`hue\`, or give its hex in \`color\`. A colour weave cannot name is refused rather than stored grey, and \`magenta\` still reaches pink for callers that learned the older name.

Slate is the honest default. A colour should carry meaning — red for blocked, green for done — and a table where every option is a different colour has told the reader nothing.

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
weave account create ci-bot --role editor
weave account list
weave audit --limit 50
\`\`\`

Three roles. An **Observer** (free) reads every page and comments: it may post a comment, under its own name, and delete a comment it made. An **Editor** (paid seat) also creates, edits and deletes rows and any comment, and never touches structure: no workspace, space, table or field definition. An **Architect** (paid) does everything, structure, accounts and the keystore included. "Free" and "paid seat" are labels: weave bills nobody. Before 2026-10-02 the three were \`reader\`, \`writer\` and \`admin\`; every open rewrites a stored old name to the new one, so every token keeps working, and \`--role admin|writer|reader\` is still accepted, with a deprecation note, for one more release. Tokens are \`wv_\` values hashed at rest, and every mutation lands in a durable audit log with the actor that made it — a person, the CLI, or a named MCP client.

\`weave workspace require-auth\` closes every page and every API route to a caller without a token or a signed-in session. The doors that stay open are \`/api/health\`, a view's share link, the task applet, the sign-in page at \`/auth\`, and the static assets it needs; a browser without either is sent to the sign-in when a provider is configured and gets a page that links to it when none is, and an API call gets a 401. People sign in through an identity provider (the **Door C: sign in with a provider** guide) and agents keep the token. An observer may read any page and write nothing but its own comments; an editor writes rows, never structure — and \`weave import\`, which replaces the whole workspace, is structure, so it needs an architect token. A token hash never leaves through \`weave export\`: an imported account keeps its name and role but opens nothing until it is deleted and created again.

Entity mutations are undoable (\`weave undo\`, 200 deep). Schema work, hard deletes and file deletions are not. In the app, \`⌘Z\` (Ctrl+Z) steps back the last change: a selection-bar trash comes back whole when nothing was written after it. A text box, an open cell and a document keep \`⌘Z\` as their own text undo. There is no redo.

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

## System rows in the sidebar

Three fixed rows sit at the bottom of the sidebar, under the spaces: **Activity** (every change in the workspace, \`#/activity\`), **Trash** (every trashed row in the workspace, \`#/trash\`) and **Workflows** (the Workflows table, shown at the root only). They cannot be renamed, moved or deleted, and neither can any system table: \`updateTable\` refuses a new name for one on every door. In Trash, a trashed table or space is listed as its Tables or Spaces row, and Restore on that row brings the whole structure back. The same list is \`GET /api/trash\`, \`weave_trash\` with no table, or \`weave trash\`.

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

weave on a laptop binds \`127.0.0.1\` and needs no login. weave on a server needs a door: something that decides who gets to the port. The rule this page and the ones after it follow: **the authentication surface is the operator's choice.** Two doors, each a complete path on its own page, each ending with a check you can run.

\`requireAuth\` is the switch inside weave (\`weave workspace require-auth\`). With requireAuth on, every page and API call needs a token: a \`wv_\` bearer for agents, a session for people who sign in through the provider (door C). Off, whoever reaches the port is an architect. A door in front of the port is what makes "reaches the port" mean something.

## The two doors

| Door | Runs where | Code in weave | Phone browser | Agents over HTTP | Share links | Portability |
| --- | --- | --- | --- | --- | --- | --- |
| **A. Edge gate**: Cloudflare Access, Tailscale, Caddy \`basic_auth\`, oauth2-proxy, Authelia | In front of the process | None | Yes (Tailscale needs its app) | Service token or tailnet member | Only behind a public gate | Swap the proxy; weave untouched |
| **C. Identity provider over OIDC**: Clerk, Auth0, Google; Keycloak, Authentik | Inside weave, identity outside | Ships with weave, zero dependencies | Yes | \`wv_\` bearer tokens | Share grants | One client id per provider |

**Door A** is the fastest way to a private instance today and costs nothing: every gate on the list has a free tier, and Cloudflare Access is free to fifty users. The gate owns identity; weave never learns who came in. Stack it in front of C whenever you like; neither side needs to know. The **Door A: an edge gate** guide has one config block per gate.

**Door C** signs people in with one OpenID Connect provider: Clerk, Auth0, Google, or a self-hosted identity server. The provider proves who is there; weave keeps the account, the role, the browser session and the \`wv_\` tokens agents use. The **Door C: sign in with a provider** page covers the provider's settings, the four variables, linking an account, sessions and \`WEAVE_ORIGIN\`.

## Door B was removed

weave used to ship a third door, B: passkeys built into weave, registered from a one-time invite link. It was removed in the 0.4 series, in the first release after 0.4.52 (Feature #243). The CLI verbs \`weave account invite\` and \`weave account remove-credential\` and the \`/api/auth/register/*\` and \`/api/auth/login/*\` routes went with it. A passkey already stored on an account row stays in the data and is ignored. To keep a person signing in, link their account to a provider identity before you upgrade: \`weave account link <name>\` prints an invite link for them.

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

A gate in front of the port. weave keeps binding \`127.0.0.1\` (or the container's \`0.0.0.0\` behind a platform that only routes the custom domain); the gate is what the internet talks to. Five gates, one config block each, one check each. All five stack in front of door C without either side knowing.

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
    name: "Door C: sign in with a provider",
    audience: 'Human',
    order: 15.5,
    doc: `# Door C: sign in with a provider

Door C signs people in with one OpenID Connect (OIDC) provider. The provider has to serve \`/.well-known/openid-configuration\`; Clerk, Auth0, Keycloak, Authentik and Google are examples. The provider proves who is there; weave keeps the account row, the browser session and sign-out. Agents keep using \`wv_\` bearer tokens.

## Accounts and identities

Signing in at the provider creates no account in weave. An architect either invites a new person to a workspace (below, **Invite a new person**), which makes the account when they sign in, or links an existing weave account by minting an invite: a one-time link that lasts 7 days. The person opens it and signs in at the provider, and weave stores the provider's issuer and subject (the \`sub\` claim) on the account as an identity. From then on the subject alone signs that person in.

weave asks the provider for the \`openid\` scope only, so the consent screen lists one line, and weave stores no email address or profile for sign-in. The provider keeps whatever it needs to run its own sign-in.

A hosted provider with open sign-up lets anyone create a user there. A sign-in at the provider proves who someone is, and weave admits that person only after they have redeemed an invite for an account. weave keeps only the invite's hash, like a token or a session, and an invite works once.

## Application at the provider

Register an OAuth or OIDC application that uses the authorization code flow with PKCE, the scope \`openid\` and one redirect URI:

\`\`\`
<WEAVE_ORIGIN>/api/auth/oidc/callback
\`\`\`

That URI serves every workspace the weave process hosts. Copy the client id and client secret.

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| \`WEAVE_OIDC_ISSUER\` | Yes | The provider's issuer URL. \`https\` is required except on loopback. |
| \`WEAVE_OIDC_CLIENT_ID\` | Yes | The client id of the application you registered. |
| \`WEAVE_OIDC_CLIENT_SECRET\` | No | The client secret. Omit it for a public client, which then relies on PKCE alone. |
| \`WEAVE_OIDC_NAME\` | No | The provider's name on the sign-in link. Defaults to the issuer's host name. |

Issuer and client id switch the door on together. Set one without the other and \`weave serve\` stops at startup and names the missing variable.

## Account linking

Link an account from the CLI, the HTTP API or MCP. Each takes the account name and answers with an invite: the code, its expiry and a \`url\` to send the person. From the CLI:

\`\`\`bash
weave account link kyle
\`\`\`

Add \`--issuer <url>\` when \`WEAVE_OIDC_ISSUER\` is not set in your shell. The CLI roots the link at \`WEAVE_ORIGIN\` and prints a bare path without it. The HTTP call needs an architect bearer token and answers with the full link:

\`\`\`bash
curl -X POST https://weave.example.com/api/accounts/kyle/identities \\
  -H "Authorization: Bearer wv_<architect token>" \\
  -H "Content-Type: application/json" -d '{}'
# {"account":"kyle","issuer":"…","code":"wvi_…","expiresAt":"…",
#  "url":"https://weave.example.com/api/auth/oidc/start?invite=wvi_…"}
\`\`\`

From MCP, call the \`weave_accounts\` tool with \`action: link-identity\`.

The invite link goes straight to the provider. After the person signs in there, weave pins their subject to the account and opens the workspace. A spent or expired link answers \`410\`; a provider identity that already opens another account answers \`409\` and leaves the invite unused. A person who signed in before an operator linked them sees **No account for this identity**; opening the invite link from that page links them in one step.

To unlink, name the subject that \`weave account list\` shows:

\`\`\`bash
weave account unlink kyle --subject user_2abc
# or over HTTP: DELETE /api/accounts/kyle/identities?subject=user_2abc
\`\`\`

An account linked by email before this release keeps any identity the provider had already pinned, minus the email. An identity that was never pinned is dropped on the first open, and the email is removed from the old identity entries in the audit log. Mint an invite for anyone who had not signed in yet.

## Invite a new person

An architect invites someone who has no account yet from the workspace's home page: open **Members**, enter the email, pick the role (Editor, paid seat, by default; Observer, free; Architect, paid) and choose **Invite**. weave answers with a one-time sign-in link. weave sends no email yet, so copy the link and send it yourself; it is shown once, works once and expires in 7 days. The same section lists the pending invites, with the role, who invited and when, and **Revoke** cancels one.

The person opens the link and signs in at the provider, signing up there first if they have to. weave then makes their account at the invited role, named after the email's local part (\`dylan@example.com\` becomes \`dylan\`, then \`dylan-2\` when that name is taken), pins their subject to it, spends the invite and opens the workspace. Their next sign-in needs no link. The email lives on the pending invite only: the account, the audit log and \`weave export\` never carry it.

An invite opens the workspace it was made in. An invite made on the hub root makes a root account, which opens every workspace the way a root account always has. A link that was revoked, spent, expired or made in another workspace answers \`410\` before the provider; a sign-in with no invite gets the refusal page, **No access to** the workspace.

An architect sees the emails weave sends about an invite, filled with sample values, at \`GET /api/mail/preview/invite\` and \`GET /api/mail/preview/accepted\`. Add \`?role=observer\`, \`editor\` or \`architect\` to pick the role, and \`?theme=light\` or \`?theme=dark\` to paint one palette instead of following the mail client's setting.

\`\`\`bash
weave invite dylan@example.com --role observer   # prints the invite and its url
weave invite list                                # the pending ones
weave invite revoke <id>
# HTTP, with an architect token: POST /api/invites {"email", "role"}, GET /api/invites, DELETE /api/invites/<id>
# MCP: weave_accounts with action invite, invites or revoke-invite
\`\`\`

## Clerk

In the Clerk dashboard, create an OAuth application and give it the redirect URI above. Use your Clerk instance's Frontend API URL as \`WEAVE_OIDC_ISSUER\`; on a development instance it looks like \`https://<name>.clerk.accounts.dev\`. weave accepts RS256 or ES256 id tokens and sends an S256 PKCE challenge; Clerk supports RS256 and S256.

\`\`\`bash
WEAVE_OIDC_ISSUER=https://<name>.clerk.accounts.dev
WEAVE_OIDC_CLIENT_ID=<client id>
WEAVE_OIDC_CLIENT_SECRET=<client secret>
WEAVE_OIDC_NAME=Clerk
\`\`\`

## Sign-in page

A signed-out visit to any page answers \`302\` to \`/auth?next=<the page>\`, and \`/auth\` goes straight to the provider, with no page in between, and keeps \`?next\`. After you sign in at the provider, you land on the page you were heading to. Signed in, \`/auth\` shows your sessions and a sign-out button. Signing out lands on \`/auth?signed-out=1\`, which shows a \`Sign in with <name>\` link instead of sending you back to the provider, where its own session would sign you straight back in. A refused sign-in gets a page that states the reason and links back to \`/auth?signed-out=1\`, never to bare \`/auth\`, which would send you to the provider and back to the same refusal. When the provider signs in someone with no account here, the page says that provider account has no access to the workspace, points to an invite link, and offers **Use a different account**: the provider's \`end_session_endpoint\` when its discovery document names one, coming back to \`/auth?signed-out=1\`, or else a new sign-in with \`prompt=login\`, so the provider asks for credentials again instead of reusing its session. An invite opened as someone the server already knows gets the same button, and that new sign-in carries the unspent invite.

## Sessions and the lost-device day

A session lasts 30 days from its last use and is carried in an \`HttpOnly\` cookie named \`wv_session\`; only its hash is stored. Sign out from \`/auth\`, or end your other sessions from the same page.

When a device is lost, end its sessions from any terminal that holds the data, then deal with the provider account at the provider:

\`\`\`bash
weave account sessions kyle                     # what is signed in, and from where
weave account revoke-session kyle --all         # every session ends now
\`\`\`

Every step lands in the audit log: \`identity-invited\`, \`identity-linked\`, \`identity-unlinked\`, \`session-created\`, \`session-revoked\`. An architect \`wv_\` token is the rescue path, and \`weave account\` runs on the data file without a server.

## \`WEAVE_ORIGIN\` and \`WEAVE_TRUST_PROXY\`

The provider sends the browser back to \`<WEAVE_ORIGIN>/api/auth/oidc/callback\`, so the server has to know its own public origin. Set \`WEAVE_ORIGIN\` to the URL browsers use: \`https://weave.example.com\`, scheme and host, no path. It is required whenever \`requireAuth\` is on and the host is not loopback; \`weave serve\` refuses to start without it. The session cookie is \`Secure\` when it is https. On localhost nothing is needed: the origin is \`http://localhost:<port>\`, and the sign-in page moves an address typed as \`127.0.0.1\` there.

Behind Railway, Fly, Render or any reverse proxy, set \`WEAVE_TRUST_PROXY=1\` so the rate limiter reads the client address from \`X-Forwarded-For\`. Without it every visitor shares the proxy's address. Leave it unset when the process faces the network itself, or a client could forge the header. The limits: 10 sign-in starts a minute per address, 5 failed callbacks a minute.

## Sign-in verification

On every sign-in, weave verifies the id token's signature (RS256 or ES256) against the provider's published keys, then checks the token's issuer, audience, expiry and nonce. Each sign-in carries a one-time state value that expires after five minutes, so a sign-in left open longer than that at the provider is refused. weave sets a cookie in the browser that starts a sign-in and refuses a callback that arrives without it, so a callback link opened in another browser signs nobody in. weave reads the issuer and the subject from the id token and nothing else; it never calls the provider's userinfo endpoint.

## Agents sign in through the browser: the MCP door

With a provider configured, an agent on a hosted instance needs no pasted token. \`/mcp\` serves the default workspace over MCP and \`/w/<name>/mcp\` serves another; both speak what \`POST /api/mcp\` speaks. Add it to Claude Code in one line:

\`\`\`bash
claude mcp add --scope user --transport http weave https://weave.example.com/mcp
\`\`\`

The first call opens the provider's sign-in in the browser (in Claude Code, \`/mcp\` then Authenticate); Codex runs \`codex mcp login weave\`. The client stores and refreshes the token. Behind the line, weave is an OAuth 2.1 protected resource as the MCP authorization spec describes:

1. A call with no credential answers \`401\` with \`WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"\` (\`.../oauth-protected-resource/w/<name>/mcp\` for a workspace).
2. That document (RFC 9728) names \`WEAVE_OIDC_ISSUER\` as the authorization server. The client registers itself there and signs the person in, so the provider must allow dynamic client registration (in Clerk: OAuth applications, dynamic client registration on).
3. The client sends the provider's access token. weave asks the provider's \`userinfo_endpoint\` who it belongs to and opens the account that subject is linked to on this workspace or on the hub root, the same lookup a browser sign-in makes. weave reads the subject alone and asks for the \`openid\` scope only, as the browser door does. Answers are kept a minute under the token's sha256; the token itself is never stored or logged.

A subject no account is linked to gets \`403\`: the person opens their invite (\`weave account link <name>\`) in a browser once, which pins the subject, and the agent's next call goes through. A token the provider rejects or has expired gets \`401\` with the same \`WWW-Authenticate\` header, and the client signs in again. Five refused tokens in a minute from one address get \`429\` for the rest of that minute, since each unknown token costs a call to the provider; a provider that is down gets \`502\`. MCP carries the schema tools, so the account needs the Architect role, as for \`/api/mcp\`. Writes record \`<account> via <client>\`: the client is the access token's \`client_id\` when the token is a JWT, and \`oauth\` when it is opaque, which Clerk's are. A \`wv_\` token works on \`/mcp\` unchanged and never reaches the provider; \`/api/mcp\` accepts only \`wv_\` tokens and sessions.

The resource names an origin weave was told about: \`WEAVE_ORIGIN\`, or one of the comma-separated \`WEAVE_MCP_ORIGINS\` when the request arrived on that host (\`https://mcp.weave.example.com\` on the same service). A Host header weave was not told about is refused before it reaches the door.

## Limits

weave supports one provider per process and creates no account at sign-in. Signing out ends the weave session and leaves the provider's own session alone.

The MCP door does not check that a token was issued for this instance (RFC 8707 resource indicators): Clerk does not bind its tokens to a resource, so any access token the provider issued to any of its clients passes userinfo. The account link is what decides who gets in. Revoking a link or an account takes up to a minute to reach a token weave has already checked.

## How you know it worked

1. Open \`/auth\` in a private window: the browser goes straight to the provider's sign-in.
2. Open an invite link from \`weave account link <name>\` and sign in at the provider: you land in the workspace.
3. Sign in at the provider as someone with no invite: weave answers \`403\` with a page reading **No access to <workspace>** that offers **Use a different account**.
4. Run \`weave account list\`: the account's entry in \`identities[]\` carries the issuer and the \`subject\`, and no email.
5. \`weave account revoke-session <name> --all\`: the next page load in that browser is the sign-in page.`,
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

\`WEAVE_KEYSTORE_PASSPHRASE\` is what keeps the keystore key off the volume; lose it and the secrets in the keystore are unreadable (the data is untouched). \`WEAVE_ORIGIN=https://weave.example.com\` (the custom domain from step 4) and \`WEAVE_TRUST_PROXY=1\` join the list once \`requireAuth\` is on and you use **Door C: sign in with a provider**; \`WEAVE_BACKUP_DEST\` (with the bucket credentials) switches on the nightly backup — the **Backup and restore** guide. The **Environment reference** guide has every variable and what breaks when each is wrong.

## 4. Custom domain

Service → **Settings → Networking → Custom Domain** → \`weave.example.com\`. Railway shows the target; at your DNS add a **CNAME** record for \`weave\` pointing at it. At Cloudflare keep the proxy **off** (DNS only) so Railway's certificate check sees the record. TLS is Railway's.

## 5. Health check and restarts

\`railway.json\` carries \`healthcheckPath: /api/health\` and \`healthcheckTimeout: 120\`: a deploy is live only once \`/api/health\` answers \`2xx\`, and a crash restarts the container up to ten times. Health checks run at deploy time, not continuously; for an alert when the instance is down, point a free uptime monitor at \`/api/health\`.

## 6. The door

The custom domain is public. Turn \`requireAuth\` on (\`weave workspace require-auth\` from a shell on the service, or \`PATCH /api/workspace\` with \`{"requireAuth": true}\` and an architect token) and put a door in front: **Door C: sign in with a provider** (set \`WEAVE_ORIGIN\` to the custom domain, \`WEAVE_TRUST_PROXY=1\` and the \`WEAVE_OIDC_*\` variables, then \`weave account link\` from a shell on the service) or **Door A: an edge gate**.

## 7. Updates in place

A volume-backed service runs one deployment at a time, so every Railway redeploy stops the old container before the new one answers: a minute or more of failed requests. weave updates itself instead. Service → **Settings → Deploy → Custom Start Command** \`node bin/weave.js supervise\`, and under **Variables** \`WEAVE_AUTO_UPDATE=1\`. Redeploy once to install the supervisor; that deploy has the usual short gap, and it is the last one a release needs.

The supervisor holds \`PORT\` and runs \`weave serve\` as a worker behind it. Every ten minutes it asks GitHub for the latest release. A newer one is taken only when its tag's commit is on \`grunion-ai/weave\` main; it is unpacked to \`/data/releases/v<version>/\`, started as a second worker on the same workspace files, and checked on its own \`/api/health\`. Healthy, it takes new requests; the old worker finishes the ones it holds and exits; then the new one writes its migrations, and writes that arrive in that moment wait in the supervisor instead of failing. A release that fails any step stays off, the old worker keeps serving, and that version is not tried again. A restart boots the newest release on the volume that finished a swap. Railway still has to rebuild for a change to the Node version, the \`Dockerfile\` or the supervisor itself, and only then: with the supervisor in place, a redeploy to ship a landed change restarts the container, fails requests for up to a minute and resets the supervisor. The release tag is the deploy. If the service is connected to GitHub with automatic deploys, turn them off under **Settings → Source** so a push to main does not restart it.

## Backups

Railway's cron is a separate service and cannot share the volume, so backup runs inside the weave process, not as a Railway cron: phase 3 adds \`weave backup\` and the in-process nightly switch (\`WEAVE_BACKUP_DEST\`). Until then the **Backup and restore** page has the manual copy, and paid Railway plans snapshot the volume.

## How you know it worked

1. \`curl -s https://weave.example.com/api/health\` answers \`{"ok":true,"name":"weave","version":"…","workspace":"workspace",…}\` and the Deployments tab shows the health check passed.
2. Create a row, then **Redeploy** from the dashboard. The row is still there: the volume, not the container, holds it.
3. The service shows **1 replica** and one volume at \`/data\`; the log has no \`EACCES\`.
4. With step 7 in place, \`/api/health\` carries a \`supervisor\` object. After the next release it reads \`"release":"v<that version>"\` with \`lastSwap.ok: true\`, \`version\` is the new one, and the Deployments tab shows no new deployment.`,
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

A weave instance is one directory: a \`.db\` per workspace (yours, plus the \`weave.db\` docs workspace), one \`files/\` directory of attachment blobs shared by all of them, \`keystore.json\`, and on a laptop \`keystore.key\` beside it. \`weave backup\` turns that directory into one archive; \`weave restore\` turns the archive back into a directory. Built in phase 3 of Feature #222 (Feature #209 asked for it; Issue #250 shaped the orphan report). No SQLite tooling, no tar, no cloud SDK: \`node:sqlite\`, \`node:crypto\` and \`fetch\`.

## What a backup holds

| Entry | How it is taken | Why |
| --- | --- | --- |
| \`<workspace>.db\`, one per workspace | \`VACUUM INTO\` a temp file from a throwaway connection | Safe while the server is writing: a read transaction in WAL mode, the WAL folded in, compacted, no \`-wal\`/\`-shm\` sidecars. A plain copy of a live database is a torn file. |
| \`files/<id>\` | Every blob in \`files/\` (a single-workspace backup takes only the blobs that workspace references) | Attachments live outside the \`.db\`; an export without them restores to dead links. |
| \`keystore.json\` | Copied as is | Sealed by its own key, so it is useless alone. |
| \`manifest.json\`, last | Written after everything else | Entry names and sizes, a sha256 per entry, entity counts per workspace, the weave version, and the orphan report. |

\`keystore.key\` **never** goes into the archive. It decrypts \`keystore.json\`, and the pair in one place is exactly the leak the keystore exists to survive. Instead the key material seals the archive (below), and the restore side needs it from your hand.

The archive is a plain POSIX tar: \`tar -tf weave-backup-all-2026-09-12T04-00-00Z.tar\` lists it, and any tar reads it. Names carry the scope (\`all\`, or one workspace) and the UTC instant, so they sort chronologically.

## The orphan report

A row can reference a blob that is not in \`files/\` any more — Issue #250 found fifty-six such references on one instance. The backup cannot copy bytes that are not there, so it **counts and lists** them in \`manifest.json\` and on stdout, and does not fail: a nightly job that went red over a source defect would teach everyone to ignore red. \`weave restore\` prints the same count so nobody is surprised by a dead link on the restored instance. The \`orphan\` count on the manifest is the number to watch; a rising one means bytes are going missing quietly.

## The three variables

| Variable | What it does |
| --- | --- |
| \`WEAVE_BACKUP_DEST\` | \`s3://bucket/prefix\`. On \`weave backup\` it is the default \`--dest\`. On \`weave serve\` it switches on the nightly. Unset, nothing leaves the machine. |
| \`WEAVE_BACKUP_PASSPHRASE\` | Seals the archive (AES-256-GCM under a scrypt-stretched key). Absent, \`WEAVE_KEYSTORE_PASSPHRASE\` is used — a hosted instance already has it in the environment — and absent that, the contents of \`keystore.key\`. With none of the three the archive is a plain tar; the command says so. \`--passphrase-env NAME\` names one variable and nothing else counts. |
| \`WEAVE_BACKUP_ENDPOINT\` | The S3-compatible endpoint for R2, B2 or MinIO (path-style, \`endpoint/bucket/key\`). Unset, the archive goes to AWS S3 in \`WEAVE_BACKUP_REGION\` (or \`AWS_REGION\`, default \`us-east-1\`). |

Credentials: \`WEAVE_BACKUP_KEY_ID\` and \`WEAVE_BACKUP_SECRET\`, or the standard \`AWS_ACCESS_KEY_ID\` and \`AWS_SECRET_ACCESS_KEY\`. Every request is signed with AWS Signature Version 4; R2, B2, MinIO and S3 all accept it. Signing uses the region: R2 takes \`auto\` (the default once an endpoint is set), B2 wants its real one (\`us-west-004\`, say) in \`WEAVE_BACKUP_REGION\`.

## Examples

Cloudflare R2:

\`\`\`bash
export WEAVE_BACKUP_DEST=s3://weave-backups/nightly
export WEAVE_BACKUP_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
export WEAVE_BACKUP_KEY_ID=<r2 access key id>
export WEAVE_BACKUP_SECRET=<r2 secret access key>
export WEAVE_BACKUP_PASSPHRASE='a long sentence you keep somewhere else'
node bin/weave.js backup --data /var/lib/weave
\`\`\`

Backblaze B2 is the same with \`WEAVE_BACKUP_ENDPOINT=https://s3.us-west-004.backblazeb2.com\` and \`WEAVE_BACKUP_REGION=us-west-004\`. AWS S3 needs no endpoint: \`WEAVE_BACKUP_DEST=s3://my-bucket/weave\`, \`AWS_REGION=eu-west-1\`, the two \`AWS_\` credentials.

A local archive with nothing uploaded:

\`\`\`bash
node bin/weave.js backup --data ~/.weave --out ~/Desktop
# Backup weave-backup-all-2026-09-12T04-00-00Z.tar.enc (58.1 MB, encrypted) → /Users/me/Desktop/…
#   weave: 2104 entities, 12.3 MB
#   uno: 388 entities, 7.0 MB
#   files: 258 attachment blobs copied
#   orphaned references (Issue #250): 56 — weave: c-json-editor.html, …
\`\`\`

\`--workspace uno\` takes one workspace and its own blobs. \`--out\` may name a directory or the file itself. \`--now\` is the manual trigger of the run the nightly makes; it is the same run.

## The nightly switch

Set \`WEAVE_BACKUP_DEST\` (and the credentials) on the server and \`weave serve\` runs \`backup\` every day at 04:00 UTC — inside the process, on a timer re-armed after each run, not cron. Railway's cron services run in their own container and cannot mount the volume the data directory lives on, and a sidecar is one more thing to keep alive; a timer in the process that already holds the data needs neither. The archive is written to the temp directory, uploaded, and removed.

Each run writes one audit row: \`backup-completed\` with the archive name, its bytes and the orphan count, or \`backup-failed\` with the error. \`weave audit\` shows them. \`/api/health\` carries the last result:

\`\`\`json
"backup": { "lastAt": "2026-09-12T04:00:00.000Z", "lastStatus": "completed", "nextAt": "2026-09-13T04:00:00.000Z", "dest": "s3://weave-backups/nightly" }
\`\`\`

No credential is in it. A monitor that already reads health can alarm on \`lastStatus: "failed"\` or on a \`lastAt\` older than a day and a half.

## Retention

After a successful upload the job lists the prefix and deletes every \`weave-backup-*\` archive past the newest **thirty**. Anything else under the prefix is not its to delete. Thirty daily archives at the laptop's size is under two gigabytes; R2 stores that for free.

## Restore

\`\`\`bash
node bin/weave.js restore weave-backup-all-2026-09-12T04-00-00Z.tar.enc --data /var/lib/weave-restored
node bin/weave.js restore s3://weave-backups/nightly/weave-backup-all-2026-09-12T04-00-00Z.tar.enc --data /var/lib/weave-restored
\`\`\`

The source is a local path, an \`s3://\` key (fetched with the same signer and variables), or an \`https://\` URL. Restore decrypts with the same passphrase rule as backup, reads \`manifest.json\`, checks every entry's sha256 against it and refuses on the first mismatch, then unpacks the \`.db\` files, \`files/\` and \`keystore.json\` into \`--data\`.

It refuses to overwrite a database a server holds open. Two readings, either one refuses: a \`-wal\` or \`-shm\` sidecar beside the target (SQLite removes both when the last connection closes cleanly, so their presence means an open connection or a crash mid-write), or a \`BEGIN IMMEDIATE\` that cannot take the lock (a writer inside a transaction right now). A target that merely exists is refused too. \`--force\` overrides all three and deletes stale sidecars first; stop the server before you use it.

Then start \`weave serve --data /var/lib/weave-restored/<your workspace>.db\`. The hub adopts every other \`.db\` beside it; nothing needs importing.

### keystore.key and passphrases

\`keystore.json\` lands; the key that opens it does not, by design. On a laptop, copy \`keystore.key\` back beside it (Kyle's is in the login Keychain; yours is wherever you put it — a password manager is the right place). On a hosted instance set \`WEAVE_KEYSTORE_PASSPHRASE\` to the value the original had. Without either, every credential reads as undecryptable and must be re-entered; everything else — workspaces, rows, documents, attachments — is whole.

The backup passphrase and the keystore passphrase are separate things that default into each other. Keep whichever you set somewhere that is not the server and not the bucket.

### A restore rehearsal, quarterly

1. \`weave restore <last night's archive> --data /tmp/rehearsal\` on any machine.
2. \`weave serve --port 4401 --data /tmp/rehearsal/<workspace>.db\`.
3. Compare \`/api/health\` on \`:4401\` with the live instance: the \`entities\` count per workspace should match the manifest, and one attachment you know should download byte-for-byte.
4. Delete \`/tmp/rehearsal\`.

A backup you have not restored is a hope.

## The upgrade: Litestream

A nightly archive means a day of loss in the worst case. Litestream replicates the SQLite WAL to the same bucket continuously and restores to within seconds; it runs as one more process beside \`weave serve\` (on Railway, a second service on the same volume is not possible, so it goes into the same container as a supervisor of the serve process). Add it when a lost day would hurt; the nightly stays as the copy that does not depend on a replica being healthy. The laptop copy (\`~/bin/weave-backup\` into iCloud) keeps running regardless: two mechanisms, two failure modes.

## How you know it worked

\`weave backup --out /tmp/check --data <your data dir>\` prints one line per workspace with its entity count and ends with the orphan count; \`tar -tf\` on a plain archive (or the restored one) lists \`manifest.json\` last. Restore that archive into an empty directory, \`weave serve\` on it, and read \`/api/health\`: the \`entities\` figure matches the line the backup printed, and \`curl -o - /api/files/<id>\` on an attachment you know matches the original byte for byte. With the nightly on, tomorrow's \`/api/health\` carries \`backup.lastStatus: "completed"\` and the bucket holds one more archive than it did today.`,
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
| \`WEAVE_ORIGIN\` | \`weave serve\` | unset (loopback: \`http://localhost:<port>\`) | The public origin, scheme and host, no path. The identity provider sends sign-ins back to \`<origin>/api/auth/oidc/callback\`, and the \`wv_session\` cookie is \`Secure\` when it is https. Unset off loopback with \`requireAuth\` on, \`serve\` refuses to start; wrong, the provider refuses the redirect URI or sends the browser to the wrong host. |
| \`WEAVE_TRUST_PROXY\` | \`weave serve\` | unset | Set to \`1\` behind Railway, Fly, Render or any reverse proxy: the sign-in rate limits then read the client from \`X-Forwarded-For\`. Unset behind a proxy, every visitor shares the proxy's address and ten sign-in attempts a minute lock everyone out; set with no proxy, a client can forge the header. |
| \`WEAVE_BACKUP_DEST\` | \`weave serve\`, \`weave backup\` | unset | \`s3://bucket/prefix\`. Set on \`weave serve\`, the server backs up in-process daily at 04:00 UTC and keeps thirty archives; unset, nothing leaves the machine and \`/api/health\` carries no \`backup\` field. Wrong bucket or credentials: the run fails, a \`backup-failed\` audit row and \`lastStatus\` on health say so, the server keeps serving. The endpoint, credentials and passphrase it needs are on the **Backup and restore** guide. |
| \`WEAVE_OIDC_ISSUER\` | \`weave serve\`, \`weave account link\` | unset | The issuer URL of one OpenID Connect provider, \`https\` off loopback. Set with \`WEAVE_OIDC_CLIENT_ID\`, \`/auth\` sends a signed-out browser to the provider (the **Door C: sign in with a provider** guide). Set without it, \`serve\` stops at startup and names the missing variable. A URL the provider does not call its own issuer fails every sign-in with a page that says so. |
| \`WEAVE_MCP_ORIGINS\` | \`weave serve\` | unset | Other public origins the MCP door answers on, comma separated, each scheme and host only: \`https://mcp.weave.example.com\`. The protected-resource metadata names the one the request arrived on, else \`WEAVE_ORIGIN\`; each host is also served. Unset, a second domain on the same service gets \`421\`; wrong, the agent's client refuses the metadata because it names another URL (the **Door C: sign in with a provider** guide). |
| \`WEAVE_OIDC_CLIENT_ID\` | \`weave serve\` | unset | The client id the provider issued for this instance. The provider must hold \`<WEAVE_ORIGIN>/api/auth/oidc/callback\` as a redirect URI, or it refuses the sign-in before weave sees it. |
| \`WEAVE_OIDC_CLIENT_SECRET\` | \`weave serve\` | unset | The client secret, for a confidential client. Unset, weave signs in as a public client and relies on PKCE alone; a provider that expects the secret answers \`invalid_client\`. |
| \`WEAVE_OIDC_NAME\` | \`weave serve\` | the issuer's host name | The word on the sign-in link: \`Clerk\` reads "Sign in with Clerk". |
| \`WEAVE_UPDATE_CHECK\` | \`weave serve\` | on | Set to \`off\` and the server makes no request to GitHub. On, it asks \`api.github.com/repos/grunion-ai/weave/releases/latest\` at most once a day (no token, nothing about the install), keeps the answer in \`update-check.json\` beside \`WEAVE_DATA\`, and \`/api/health\` carries \`latestRelease\`, \`releaseCheckedAt\` and \`releaseBehind\`; the sidebar instance chip turns amber when a newer release exists. Offline, rate-limited or blocked, the check stays silent and nothing else changes. |
| \`WEAVE_AUTO_UPDATE\` | \`weave supervise\` | unset | Set to \`1\` and \`weave supervise\` holds the port, runs the server as a worker, and installs each newer release in place: every ten minutes it asks GitHub for the latest release, takes it only when the tag's commit is on \`grunion-ai/weave\` main, unpacks it to \`releases/v<version>/\` beside \`WEAVE_DATA\`, and moves requests to the new worker once its \`/api/health\` answers. Unset, \`supervise\` is \`serve\`. A release that fails its health check stays off and is not tried again; \`/api/health\` carries the supervisor's \`release\`, \`dir\`, \`lastSwap\` and \`failed\`. |

## The container

The \`Dockerfile\` bakes the container-shaped values: \`PORT=4400\`, \`WEAVE_HOST=0.0.0.0\`, \`WEAVE_DATA=/data/workspace.db\`, \`WEAVE_KEYSTORE=/data/keystore.json\`. A platform overrides \`PORT\`; you supply \`WEAVE_KEYSTORE_PASSPHRASE\`. \`WEAVE_ORIGIN\`, \`WEAVE_TRUST_PROXY\`, \`WEAVE_BACKUP_DEST\` and the four provider sign-in variables are listed as comments, each off unless set, \`WEAVE_UPDATE_CHECK\` is listed as the one that is on unless set to \`off\`, and \`WEAVE_AUTO_UPDATE\` as the switch \`supervise\` reads, so the contract is visible in one place.

## How you know it worked

\`curl -s http://<host>:<port>/api/health\` answers with the workspace's name: a fresh volume answers \`"workspace":"personal-workspace"\`, and a workspace an earlier release created keeps the name it was given, such as \`"workspace"\`, the basename of \`WEAVE_DATA\`. A listing of the data directory shows \`workspace.db\`, \`weave.db\`, \`files/\` and \`keystore.json\`, and no \`keystore.key\` when the passphrase is set.`,
  },
  {
    name: 'Reporting a bug',
    audience: 'Both',
    order: 12,
    doc: `# Reporting a bug

The bug glyph in the bottom-right corner of every page opens a small panel beside it. The page stays visible while the report is written, because reporting a bug must not cover the bug. Type a sentence, pick any of the four symptoms — **Slow**, **Looks broken**, **Wrong data**, **Error** — and there are two ways to send it.

## Send: an Issue on this instance

**Send**, or \`⌘Return\` from the note (the \`⌘↵\` beside the button says so), files a row into this instance's \`Development/Issue\` table, in the \`weave\` docs workspace, with the symptoms in the \`Symptom\` multiselect and a **Replay** section built from the recorder every session runs: routes entered, controls clicked, requests that failed, anything that threw. The recorder keeps control names, never what was typed into them. The server stamps its own version and start time on the row, so a stale build cannot report itself as current.

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
    name: 'Table views',
    audience: 'Both',
    order: 20,
    doc: `# Table views

A table can be read several ways. Each **view** keeps which columns show, their order and widths, frozen columns, filters and sorting. Open the button bearing the current view's name to choose another. The **first** view in the menu opens with the table, and its row says **Opens first**. A new table's first view is named **Standard**; views you add are offered **View 2**, **View 3** and so on. A table always keeps at least one view.

## The toolbar

The controls sit beside the breadcrumb, in this order: **Search → View → Density → Fields → Filters → Table actions (⋮)**. The three-dot menu keeps the table's existing actions; add records from the grid.

| Control | What it does |
| --- | --- |
| **Search** | Narrows this table by name, public id or text. Click the visible search box or press **/** when not editing. It searches all pages, combines with filters and preserves sorting. **Escape** clears the search. **⌘K / Ctrl+K** remains workspace search. |
| **Current view name ▾** | Selects and manages saved views. Changes save automatically. |
| **Compact ▾**, **Comfortable ▾** or **Spacious ▾** | Sets the row height: 32, 44 or 72 pixels, with two lines of text at Spacious. Only the height changes; text size and column widths stay the same. The row under your eye stays put, and the choice saves into the current view like its filters and sorting, so each view keeps its own. A cell shows the chips that fit whole and a +N for the rest; hover it to see them all. |
| **Fields** | Shows, hides and reorders columns; opens the field tray to add a field. |
| **Filters** | Narrows rows by workflow states, toggle labels and single-select or multi-select options. The badge counts fields with active filters. |

Search is temporary: it is not saved into a view or shared with other people, and leaving the table clears it.

## Managing views

| You do in the view menu | What happens |
| --- | --- |
| Select a view | Opens its saved layout, filters and sorting. |
| Drag a view by its handle | Reorders the list; a straight line marks where it lands. Drop it first to make it open with the table. The handle works with a mouse or a finger. |
| **Alt+↑** / **Alt+↓** on a focused view | Moves it one place. |
| Hover or focus a view | Shows its **Rename**, **Duplicate** and **Delete** buttons. There is no right-click menu. |
| **Rename** | Edits the name in place. **Enter** or clicking away saves; **Escape** cancels. |
| **Duplicate** | Adds a row under the view with its name focused (\`Open bugs 2\`). **Enter** or clicking away creates the copy and opens it; **Escape** drops the row. |
| **Delete** | Hold the button until it fills. The last view cannot be deleted. |
| **+ Add view** | Adds a row with its name focused, offered as the next free **View N**. **Enter** or clicking away creates the view from the system default that **Reset view** restores, and opens it; **Escape** drops the row. The menu stays open throughout. |
| **Reset view** | Returns the view to the system default: every regular field in schema order with the table's default system columns, no filters, sorting, search, custom widths or frozen columns, no deleted rows, no Σ rollup row, and Comfortable density. **+ Add view** starts from the same default. The view keeps its name. |
| **Clear filters, search, and sorting** | Removes those restrictions while keeping the column layout and density. |

A view's link is \`#/table/<table>/view/<view id>\`. An old \`…/view/blank\` link still opens the raw table, read-only. Choose **+ Add view** to make an editable view.

## Fields

Click a field's visibility control to show or hide its column. **Show all** and **Hide all** apply to the whole list. Drag the grip at a field's right edge to move it; the straight insertion line marks where it will land. With the grip focused, **↑ / ↓** moves it one place. System columns such as Created At use the same controls.

These changes save into the current view. Hiding a column does not delete its data. **Add field** opens the same field tray as the **+** at the end of the grid's field headers. The **Rows** section shows deleted records and the Σ rollup row; each box saves into the current view, so another view keeps its own.

## Filters

Open **Filters** and tick options under a workflow, toggle, single-select or multi-select field. Each tick applies at once and saves into the current view; the popover stays open as results update. Untick an option to remove it. Several options in one field include any of them, and filters on different fields must all match. A multi-select row matches when it has any ticked option. A field with nothing ticked adds no restriction. The footer counts what is left as **X of N**, in the table's own word for its rows (\`7 of 413 bugs\`): X after the filters and the search, N every row that is not deleted.

**Clear all** removes all filters from the view while keeping search, sorting and column layout. If the table has no workflow, toggle or select fields, the popover offers **Add field**, opening the usual field tray.

## For agents

One tool, \`weave_table_view\`, addressed by name. \`{view: "Issue"}\` lists the views in order, and the first view opens with the table (a new table's first view is \`Standard\`); \`position: 0\` makes a view the default (\`default: true\` is the older spelling of the same move). \`{view: "Issue/Open bugs", fields: ["Name", "Status"]}\` defines a view, where the list is the visible columns in order and anything left out is hidden. \`show\`, \`hide\` and \`move\` edit one field at a time, so a wide table is never resent. \`widths\` sets column widths by name (\`{Name: 240}\`, merged; \`null\` clears one) and \`frozen\` says how many leading fields stay frozen beside # (0, the default, freezes only #); \`density\` is \`compact\`, \`comfortable\` (the default) or \`spacious\`; \`deleted: true\` shows the trashed rows in place, and \`rollups\` is \`true\` or \`false\` for the Σ row (\`null\` follows the table); a read carries each only when it is set. The same verb is \`weave table view\` on the CLI and \`/api/tables/:table/views/:view\` over REST, and every view is a row in **Workspace/Views**, where editing \`Fields\`, \`Filter\` or \`Sort\` runs the same checks.`,
  },
  {
    name: 'Chip and card anatomy',
    audience: 'Both',
    order: 21,
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
