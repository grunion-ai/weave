# formula

An expression over this record's own fields, recomputed on read.

## Config

`expression`, plus every number costume key — `format`, `currency`, `unit`, `decimals`, `separator`, `accounting`, `display`, `scale`, `color` — so a computed figure can wear the same clothes as a stored one; a list result also takes `display: sparkline` and its `style`. A rollup over a number column wears that column's format and display.

```json
{ "name": "Total", "type": "formula",
  "config": { "expression": "Price * Count", "format": "currency", "currency": "USD" } }
```

## Usage

Field names go in bare when they are plain identifiers; anything else — a space, a keyword, a name that reads as a function — rides in `[brackets]`.

```
Price * Count
concat(upper(Category), " · ", Priority)
if(empty(Due), "", days(today(), [Due Date]))
if(empty(Estimate), "unsized", if(Estimate > 5, "large", "small"))
```

Renders on a tinted background marked `ƒ`. In the field dialog, formula is a checkbox on any type — ticking it opens the script editor.

## Lists and the sparkline

A formula can return a list or null. A list comes in through a lookup over a to-many relation, in relation order. `sortby(values, keys)` orders it by a parallel list, ascending, blank keys last: `sortby([Deal amounts], [Deal close dates])` is the amounts in close-date order. Two lookups over one relation keep their blank slots in position, so the pairs stay together (Feature #232).

A list result can wear `"display": "sparkline"` with a `style` of `line` (the default), `column` or `winloss`. The cell, the chip and the card draw the newest 60 points; the hover lists every value and says when it cut; a screen reader hears the count, the last value, the low and the high. Sort and filter on the column read the last number in the series. The API returns the numbers. `color` paints it: `ink` (default) in the secondary text colour, win/loss as text colour and muted; `icon` a blue line, green wins and red losses; `accent` the workspace accent, losses a lighter accent. The sparkline is drawn 80 by 18 at its own size. A rich cell leaves the `ƒ` to its column header.

```json
{ "name": "Trend", "type": "formula",
  "config": { "expression": "sortby([Deal amounts], [Deal close dates])", "display": "sparkline", "style": "column" } }
```

## Check before you save

The script editor validates as you type: a parse error, an unknown function or an unknown field shows under the box in red, and a valid expression shows its computed value on a real record. The same check stands alone as `weave formula check <table> '<expression>'`, `POST /api/tables/:id/formula-check` and the `weave_check_formula` MCP tool — validate until `ok: true`, save, then read a cell back. Saving an invalid expression is refused with the same error the check gives.

The chips under the script are the whole vocabulary: this table's fields first, then the functions in the four groups the grammar has — **logic** (`if`, `empty`, `contains`), **text**, **number**, **date**. Hover, focus or tap a chip and a card shows its signature, one sentence of what it does and an example; click it and the call lands with the caret between the parens. A document or an attachments field is listed greyed with the reason — a formula reads values, not prose or files — rather than left out. `weave vocabulary formulaFunctions` (and `weave_vocabulary`, `GET /api/vocabulary`) serves the same cards verbatim.

Under the chips, **As an agent would do it** (closed by default) prints the three calls that do what the dialog is doing — `weave formula check`, `weave field add` (or `update`) with the expression, `weave get` to read the cell back — and the MCP sequence `weave_check_formula → weave_add_field → weave_get_entity`, live with the typing. Copy it into a script and the browser was never the only door.

The verdict line names the result's **type** (number, text, boolean, list) and the dialog scans the table behind it — up to 200 records — so the line under it reads `record 1 of 51 — "Acme"` with ‹ › to step through records and pick the pathological one, and `⚠ 2 rows → null · 1 → #ERR` when any record did not compute. A formula valid on record 1 and null on a third of the table is exactly the bug one preview cannot show. The **Result format** section (currency, unit, decimals) only appears when the result is a number. The same figures come back from `weave formula check <table> '<expression>' --scan` and `weave_check_formula {scan: true}` as `{type, scan: {rows, capped, nulls, errors, sampleByOutcome}}`.

Chips are discovery; typing is speed. In the script box, `[` opens a list of this table's readable fields at the caret and two letters open the functions that start with them — the same two lists the chips draw from, ranked by prefix. ↑ ↓ move, Return picks (a call lands with the caret between its parens), Escape closes the list and nothing else. A misspelled field name dies at the keystroke instead of at the check; the verdict line stays live underneath.

## Gotchas

A formula reads **raw** values. A number's currency and unit are display costumes and never reach the expression, which is what keeps `Price * Count` from breaking when someone turns on thousands separators.

A formula cannot reference its own field — it never converges, and the save refuses it as an unknown field.

A formula cannot reach its own field the long way round either. `Total` reading `Bonus` while `Bonus` reads `Total` is refused when it is saved, and the message names the path: `Formula 'Bonus' would close a reference cycle: Bonus → Total → Bonus`. A loop that only closes through a rollup or a lookup takes two records pointing at each other to exist, so no save can see it — those cells read `#CYCLE:` and the path instead of computing, and the marker travels: a rollup over a looping value reports the loop rather than summing it. A loop that stays on one record names its fields (`#CYCLE: Double → MirrorSum → Double`); one that travels between records names them too (`#CYCLE: Alpha › Double → Alpha › PeerSum → Beta › Double → Beta › PeerSum → Alpha › Double`), because the records are what closed it (Issue #283).

A formula result stops at 65,536 characters. `concat` and `+` count the characters as they join and refuse the result once it passes the budget, so the cell reads `#ERR: Formula result is longer than 65536 characters` instead of building the string. A chain of concat fields, each joining the one before it, used to multiply into megabytes a row and exhaust the server's heap on the next grid read (Issue #1604).

A formula cannot cross a relation. That is what `lookup` and `rollup` are for.