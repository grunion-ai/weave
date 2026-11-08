# lookup

A value borrowed across a relation, read-only, refreshed whenever either side changes.

## Config

`relationField` — the relation to walk. `targetField` — the field to read on the other side.

```json
{ "name": "Owner email", "type": "lookup",
  "config": { "relationField": "Owner", "targetField": "Email" } }
```

## Usage

Renders on a tinted background marked `↗`. Nothing writes to it.

A lookup of a relation draws the far record's chip, the way the relation column draws it: `Contact › Company` shows the company's chip, which opens the company. A to-many path draws one chip per far record, each record once. The API answers `{id, publicId, name, db}` per record (a list when either hop is to-many), a filter and a formula read the name, and `raw` keeps the ids (Issue #643).

The field's settings tray shows the recipe as **Relation** and **Target field** pickers, and a **Shows as** line naming the display it inherits: a lookup of a rating reads `Drawn as the rating on People › Skill: 5 stars.`, with a link to that field's settings, where the look is changed. Pick another relation or another field and save to repoint the lookup in place: the column keeps its name, width, description and place in every view, and every cell reads the new recipe at once. From the terminal: `weave field update Team Skills --config '{"targetField":"Age"}'` (Feature #241).

## Gotchas

A lookup that returns null usually means the `relationField` name is wrong — it is the **field** name on this table, not the target table's name.

Across a to-many relation a lookup reads a list, one value per linked record in relation order; use a `rollup` with `join` when you want them as one string.

The `targetField` cannot be deleted while a lookup reads it — the delete is refused and names the lookup; delete the lookup first. A lookup that already lost its target (a workspace from before that refusal) reads `null`.