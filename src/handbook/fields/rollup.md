# rollup

An aggregate over everything on the far side of a relation — or, on a space's record, over a whole table.

## Config

`relationField`, `aggregate`, and `targetField` for every aggregate except `count`.

| Aggregate | Reads | Answers |
| --- | --- | --- |
| `count` | the records | how many |
| `filled` / `empty` | the records | how many say something / nothing in `targetField` |
| `distinct` | the records | how many different values `targetField` holds (a multiselect counts each chip) |
| `sum` / `avg` / `median` | the numbers | the total, the mean, the middle value |
| `min` / `max` | the numbers, or the strings when there are none | the extremes — the earliest and latest of a date column |
| `range` / `stdev` | the numbers | max − min; the sample standard deviation |
| `join` | the display values | one string, `separator` between (default `, `) |

```json
{ "name": "Peer names", "type": "rollup",
  "config": { "relationField": "Peers", "aggregate": "join", "targetField": "Name" } }
```

## Progress over a checkbox

A number aggregate over a checkbox or toggle counts a tick as 1 and an empty box as 0: `sum` is how many are ticked, `avg` is the share. A rollup takes the number costume of its own (`format`, `decimals`, `unit`, `display` `bar`/`ring`/`heat`, `scale`, `color`), so a progress bar is one field; without one it wears the costume of the number it reads.

```json
{ "name": "% Done", "type": "rollup",
  "config": { "relationField": "To-dos", "targetField": "Done", "aggregate": "avg", "format": "percent", "display": "bar", "scale": 1 } }
```

## Over a whole table: the space rollup

The Σ under a grid column is a rollup on the **System/Spaces** record of the space that holds the table (Kyle, 2026-09-06: "all footer values live at the space level"). `via` names the table instead of a relation; `where` narrows the records with the same clauses a query takes.

```json
{ "name": "Sessions · Cost · sum", "type": "rollup",
  "config": { "via": "Agent/Sessions", "targetField": "Cost (USD)", "aggregate": "sum",
              "where": [["Kind", "=", "scheduled"]] } }
```

Three surfaces write that field. The Σ row's picker turns one on with a checkbox, `weave field add` / `weave_add_field` take the config above, and the field dialog on the **System/Spaces** grid asks **Rolls up** — through a relation, or over a table — where *Over a table* picks the table, the aggregate and the column. Only the API writes a `where`.

A grid carries no Σ row until you ask for one: tick **Σ rollup row** in the Fields menu's Rows section and the grid draws every space rollup in a **Σ row** pinned under the field headers — it stays while the body scrolls — and offers the aggregates on a click in that record. The box saves into the current view as its `rollups` (`weave_table_view`, never a browser setting). A view that has never set it follows the table's older `hideRollups` (mirrored as **Hide Rollups** on its Tables record): `false` is a table that opted in, `true` is one switched back off, and a table nobody has touched has no record. The space page draws the same rollups as tiles; `weave stats <table>` / `weave_stats` / `GET /api/tables/:ref/stats` summarise every column on demand without storing anything. A space rollup answers on its own space's record and reads `null` on every other; `via` is refused anywhere but the Spaces registry and on registry tables.

## Usage

The field's settings tray shows the recipe as **Relation**, **Target field** and **Aggregate** pickers, a **Result** line with the value on a record of the table, and a **Shows as** line naming the display it inherits from the field it reads (a rating's icons, or a number's bar, ring or heat), with a link to that field's settings. Change any of the three and save to repoint the rollup in place: it keeps its name, width, description and place in every view. The edit runs the same check a create runs, so a new relation needs a field of its own table and any aggregate but count needs a field to read. When the result changes kind (a number becomes text, say) the tray warns before you save, and the save names every formula of the table that now fails on it. The repoint is one entry in Activity, naming the old and the new recipe, and Undo puts the old one back. A space rollup (one made from the grid's Σ row) keeps its recipe read-only (Feature #241).

Renders on a tinted background marked `Σ`, wearing the target column's costume: a sum of dollars is dollars, the `max` of a date column is a date; a mean of whole numbers shows two decimals. `join` accepts a `separator`; the default is `, `.

## Gotchas

A rollup crosses a relation; a formula stays on the record. Reaching for a formula where a rollup does the job is the most common way to end up with a number that will not update.

The `targetField` cannot be deleted while a rollup reads it — the delete is refused and names the rollup; delete the rollup first. A rollup that already lost its target (a workspace from before that refusal) reads `null`; `count` never had a target and keeps counting.