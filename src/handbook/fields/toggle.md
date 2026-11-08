# toggle

Boolean, worn as a switch with two named states (Feature #202). Same storage as a checkbox — `true` / `false` is what a formula, a filter, a CSV cell, the API and MCP read — but the config names the states, and every surface that draws the value draws the switch with the label of the state it is in: the grid cell, the entity page, the chip and the card, the Filters popover. Null normalizes to `false`, so a toggle is never empty.

## Config

`on` and `off` — the two labels, renameable, `On` / `Off` unless named: `{ "name": "Feed", "type": "toggle", "config": { "on": "Live", "off": "Paused" } }`. Both must be words, and they must differ.

`default` — the state a new record starts in when the create does not name the field: `{ "config": { "on": "Public", "off": "Private", "default": false } }`.

## Usage

`{"Feed": true}`, or the label — `{"Feed": "Live"}` writes `true`, `{"Feed": "paused"}` writes `false` (case-blind); any other word is refused by name. CSV import accepts the labels and `true`, `1`, `yes`, `✓`, `x`; CSV export writes `true` / `false`.

In the grid a click flips it, and so does `Space` on the resting cell — the one cell where Space is not row selection. The table filter offers the two labels the way it offers a workflow's states.

## Migrations

`checkbox` ⇄ `toggle` both ways, lossless: the values and the default ride along, the labels start at On / Off. To `text`, each record freezes the label it showed.

## In formulas

`if(Feed, "live", "paused")` — the value is the boolean, never the label.

## Gotchas

`is-empty` never matches a toggle — `false` is a value, not a hole. Renaming a label changes what the switch says, not what any record stores; a filter saved on the old label is refused until it names the new one.