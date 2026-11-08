# workflow

A lifecycle. One state at a time, each state belonging to a **category**. The category sets the chip colour, and a state may carry a colour of its own instead.

## Config

`states` — `[{ name, category, default, icon, hue }]`. Categories are exactly four: `not-started`, `in-progress`, `done`, `canceled`. `hue` is optional and overrides the category colour for that one state: a hue name or its hex, stored as the name. Leave it out, or send `"hue": ""`, and the chip reads the category again. The swatch in the field dialog writes it, and **Reset to category colour** clears it.

**Leave `states` out and you get one.** A workflow whose config never mentions states arrives as `Not started` · `In progress` · `Done` · `Canceled` — one per category — in the tray and on `weave field add` alike. Rename, reorder, recolour or delete them like any others. Sending `"states": []` is a different thing and still refused: a list emptied on purpose is not a lifecycle.

**No state is the default unless you mark one.** A new record's state is empty until someone sets it, unless one state carries `"default": true` (at most one does; the first marked wins). In the field dialog that is the **Default** picker under the states: *No default* first, then the states. A state can be set back to empty (`null`, or the — row in the cell's picker). Fields created before 2026-09-26 stored their first state as the default and keep it until the Default is changed.

```json
{ "name": "Stage", "type": "workflow", "config": { "states": [
  { "name": "Backlog",  "category": "not-started", "default": true },
  { "name": "Building", "category": "in-progress" },
  { "name": "Shipped",  "category": "done" },
  { "name": "Dropped",  "category": "canceled" }] } }
```

## Usage

State moves through its own verb, which records the transition in the activity log:

```bash
weave state Task#5 State "In Progress"
```

A two-state workflow is a legitimate gate — `Pending` → `Approved` says more than a checkbox called `approved`.

## Gotchas

**One workflow per table.** The state a record's chip and card show is read from the first one; a second makes it ambiguous.

A select becomes a workflow the moment its values describe progress rather than kind.