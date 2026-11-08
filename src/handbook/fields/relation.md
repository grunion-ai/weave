# relation

A link between tables. One target table makes the classic bidirectional pair — the inverse field appears on the other table in the same write. A **target set** (`targetDbs`, two or more tables) makes a polymorphic relation: one field whose values may point at records of ANY member table — the registry's `System/Spaces` and `System/Tables` are legal members, so a record can point at a space or a table as easily as at another record.

## Config

Created with its own verb, not `add_field`: `targetDb` (or `targetDbs`, a list), `cardinality`, `inverseName`.

Cardinalities: `many-to-one` (the default), `one-to-many`, `many-to-many`, `one-to-one`. For a target set only this side's arity matters: `many-to-one` holds one chip, `many-to-many` holds a set.

A target set is **one-way**: no inverse field is minted (it would have to be sprayed across every member table). The reverse direction is a read, not a stored field. Chips from a target set carry their home table, and the picker searches every member.

## Usage

```bash
weave relation add Task Project Project --cardinality many-to-one --inverse Tasks
weave link Task#5 Project 'Project#1'
weave unlink Task#5 Project 'Project#1'
```

Renders as chips carrying the target's name, each with a `×`, plus a `+ link` control that opens the ⌘K search scoped to the relation's target tables (Issue #703). It matches a record by name, `#id`, any text field or a document, and shows the linked records checked. A to-one relation replaces its value on a pick and closes; a to-many relation toggles records and saves on `Esc` or `Return` in an empty box. The last row, `+ New <term>`, creates a record named from what you typed and links it. **+ Link existing** under a related grid and the selection bar's **Link to…** open the same search.

On a record page each to-many relation shows its linked records as a subtable. The eye in the subtable header picks which target fields the subtable shows and filters its records with the same chips as the table filter (Feature #214). Both land on the relation field as `config.subtable`, shaped `{ fields, filter, sort }` with the filter in `where` triples, so every record of the table shares one setting and one edit changes them all. A filtered subtable counts `shown / total` in its header, and the field dialog shows the stored JSON. Reading the record through the API still returns every linked record.

## Query

Traverse with a dotted path: `[["Project.Name", "=", "Apollo"]]`.

## Gotchas

Name the field for **what is on the other end** (`Project`, `Assignee`), and the inverse for what this side is, plural (`Tasks`). The field name is what the chip reads and what every lookup path starts with — `Task-Project` makes both unreadable.

Deleting a relation deletes both ends. Deleting a member table of a target set prunes it from the set; the last member takes the field with it.

Lookups and rollups need a single-target relation — a target set has no one far table to read a field from. Filters still traverse it: each linked record resolves against its own table, so `[["Scope.Name", "=", "Apollo"]]` matches whichever member table Apollo lives in.