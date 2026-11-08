# checkbox

Boolean. Null normalizes to `false`, so a checkbox is never empty.

## Config

`default` — `{ "name": "Done", "type": "checkbox", "config": { "default": false } }`

## Usage

`{"Done": true}`. CSV import accepts `true`, `1`, `yes`, `✓`, `x`.

## In formulas

`if(Done, "✔", "…")`

## Gotchas

`is-empty` never matches a checkbox — `false` is a value, not a hole.