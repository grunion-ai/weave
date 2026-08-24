# weave ontology

## The one core kind

**An entity is one addressable thing.** It has an id, a public id, a set of
fields with values, and a dedicated **entity view** at `/e/<id>` showing those
fields along with its documents, comments, files and activity.

Workspaces, spaces, tables, and the rows inside tables **are all entities**.
They differ by *level*, not by kind. This is not a metaphor in weave: creating a
space writes a row in `Workspace/Spaces`, creating a table writes one in
`Workspace/Tables`, adding a field writes one in `Workspace/Fields` — through
the same verbs a customer row answers to, with the same entity view.

What a row is called downstream is a **naming convention and nothing more**: a
record, an item, an entry, a customer, a company, an account, a task, a deal, a
ticket, a contact — endlessly, exactly as in Airtable. None of those names is a
kind. They are all rows, and every row is an entity.

## Two axes, often confused

- An **entity type** is what a thing *is*. In weave every entity type is a
  **Table**: the table an entity belongs to is its type. The levels above the
  row — workspace, space, table, field — are the built-in ones.
- A **field type** is the datatype of one *slot* — `text`, `number`,
  `workflow`, `rollup`.

An entity **has** fields. A field is not a row of data, and `text` is not a kind
of thing weave stores. Asking what entity types weave has and being handed
`text`/`number`/`rollup` is the category error this page exists to prevent.

Both lists are exported from the engine — `ONTOLOGY` and `FIELD_TYPES` in
`src/engine.js` — and `test/ontology.test.mjs` holds this page to them.

## The kinds

### The entity, and its levels

| Kind | Level of | Registry | Lives in | What it is |
| --- | --- | --- | --- | --- |
| **Entity** | — | — | `state.entities` | One addressable thing: id, public id (`Table#n`), fields, and an entity view. Everything below is one. |
| **Workspace** | contains spaces | *(none yet)* | `state.meta` | One workspace file and everything in it. The top of the hierarchy — and the one level with no registry row yet, so it cannot be opened as an entity. |
| **Space** | contains tables | `Workspace/Spaces` | `state.spaces` | A named container grouping the tables of one area of work; the left half of `Space/Table`. |
| **Table** | contains rows | `Workspace/Tables` | `state.tables` | An entity that is also an **entity type**: the ordered set of fields every row in it follows. |
| **Field** | describes a slot | `Workspace/Fields` | `table.fields` | One typed, named slot on a table. Not a row of data, but it has a registry row carrying its type and definition, which is how the schema stays editable as data. |
| **Row** | the data itself | *(it is the data)* | `state.entities` | An entity inside a table, typed by that table, addressed `Task#42`. Call it a record, an item, an entry, a customer — it is a row. |

### What an entity is made of

These have no identity apart from the entity carrying them, and no entity view
of their own.

| Kind | Lives in | What it is |
| --- | --- | --- |
| **Value** | `entity.values` | What one entity holds in one field, validated and coerced by that field's type. |
| **Document** | `entity.docs` | A long-form body — markdown, HTML or code — in a document-typed field. Any number per entity. |
| **Comment** | `entity.comments` | An authored, time-ordered note, kept separate from the documents. |
| **File** | `entity.files` | A blob stored beside the workspace file, referenced by id from attachments fields. |
| **Activity** | `entity.activity` | An append-only record of one thing that happened to the entity. Ten kinds; last 500 kept. |

### Machinery around the entities

Real objects with their own verbs — but not entities: nothing here has fields
or an entity view.

| Kind | Lives in | What it is |
| --- | --- | --- |
| **Saved view** | `state.meta.views` | A saved arrangement of table blocks with filters and layouts, optionally shared by token. Distinct from the entity view every entity has by existing. |
| **Automation** | `state.automations` | A rule bound to one table: a trigger, and the actions it fires. |
| **Account** | `state.meta.accounts` | A named token holder with a role — admin, writer, reader. Only the hash is kept. |
| **Key** | the keystore, *outside* the workspace | A named secret. A key field stores the NAME; the value never enters the .db. |
| **Audit entry** | `store.audit_log` | A workspace-level record of a structural change. |
| **Undo step** | `store.undo_log` | A reversible before-image of one entity mutation. |

## Every level is a table

The claim "everything is an entity" has a twin: **every level is itself
structured as a table with fields.**

- The **workspace** is a table whose rows are its spaces — literally
  `Workspace/Spaces`.
- A **space** is a table whose rows are its tables — `Workspace/Tables`,
  scoped to the space through the `Space` relation; a space's entity view
  lists exactly its own tables.
- A **table** is a table whose rows are its rows — that one needs no
  registry, it is the thing itself.

And because a table's row is a real entity, **the table's configuration is
fields on that row**, not settings hidden in an options panel:

| Field on the Tables row | What it configures |
| --- | --- |
| `Description` | The description shown at the top of the table |
| `Field Order` | Which columns appear, in what order — a comma-separated full permutation |
| `Hidden Fields` | Which columns (including system columns) are hidden |

The sync is two-way and validated identically in both directions: editing
`Field Order` on the row *is* `updateTable({ fieldOrder })`, so a partial
order is refused on the row exactly as it is at the schema verb. Adding,
deleting, or reordering columns through the schema verbs updates the row.

## How it nests

```
Workspace ......................... entity (level 1) — no registry row yet
└── Space ......................... entity (level 2) — row in Workspace/Spaces
    └── Table ..................... entity (level 3) — row in Workspace/Tables
        │                             …and the ENTITY TYPE of everything in it
        ├── Field ................. entity (level 4) — row in Workspace/Fields
        └── Row ................... entity (level 5) — record / item / entry /
            │                         customer / company / account / task /
            │                         deal / ticket / contact — all the same kind
            ├── Value per field
            ├── Document  (0..n)
            ├── Comment   (0..n)
            ├── File      (0..n)
            └── Activity  (append-only)
```

Two consequences worth stating outright:

- **Structure is data.** The registries are not a mirror of the schema, they
  *are* the schema seen as rows — one verb per mutation, whichever side it
  starts from. So a table can be filtered, related, automated and documented
  like anything else.
- **A relation is a paired field, not a kind.** Linking two tables creates a
  field on each side; the link itself has no identity you can address.

The single place the engine does not yet honour this ontology is the top: the
workspace is state rather than an entity, so it has no row and no entity view.
Tracked as weave Feature #121.

## Lifecycles

| Kind | Created by | Ends by |
| --- | --- | --- |
| Workspace | opening a path | deleting the file |
| Space | `createSpace`, or a row in `Workspace/Spaces` | `deleteSpace` — cascades to its tables |
| Table | `createTable`, or a row in `Workspace/Tables` | `deleteTable` — cascades to its rows, paired relation ends, dependent computed fields |
| Field | `addField` / `addRelation`, or a row in `Workspace/Fields` | `deleteField` — takes its inverse end and dependent lookups/rollups with it |
| Row | `createEntity` | soft delete to trash, then `restoreEntity` or a hard delete |
| Value, Document, Comment, File, Activity | writing to an entity | with their entity (files also individually) |
| Saved view, Automation, Account | their `create*` verb | their `delete*` verb |
| Key | `setKey` | `deleteKey` — the workspace still holds the name |
| Audit entry, Undo step | any qualifying mutation | never rewritten; undo steps are consumed by `undo()` |

System spaces, system tables and system fields refuse deletion: the registries
are part of the engine, not user data.

## The other axis: field types

Eighteen, and not one of them is a kind of entity. Fourteen store a value —
`text`, `number`, `date`, `daterange`, `checkbox`, `url`, `email`, `select`,
`multiselect`, `workflow`, `relation`, `field`, `key`, `attachments`. Three
compute one from other fields — `lookup`, `rollup`, `formula`. One holds a
body — `document`.

The pair to keep straight is `field` and Field. A Field is the slot; the
`field` *type* is a slot whose **value is a field definition**, which is what
lets the Fields registry describe columns as rows without the model becoming
circular. The same normaliser validates a stored definition and a real column,
so a definition can only ever describe a field the engine would accept.

## Glossary

### Entity
One addressable thing: an id, a public id, fields with values, and a dedicated
entity view. Workspaces, spaces, tables and rows are all entities, differing by
level rather than kind.

### Entity type
What an entity *is*. In weave an entity type is a **Table** — the table an
entity belongs to is its type — plus the built-in levels above the row.
Downstream names for rows (record, item, entry, customer, company, account,
task, deal, ticket, contact) are conventions, not types.

### Field type
The datatype of one field: what values that slot accepts and how they display.
Eighteen of them. A field type is not a kind of object — no `text` is ever
created, deleted, or addressed.

### Entity view
The page every entity has by existing, at `/e/<id>`: its fields in the table's
order, then its documents, comments, files and activity. A space, a table and a
customer all have one, because all three are entities.

### Workspace
One weave file — a SQLite `.db` — holding spaces, tables, rows and the
machinery around them. The top level of the hierarchy, and the one level that
has no registry row yet.

### Space
A named container that groups tables and qualifies their names, so `Dev/Task`
and `Sales/Task` are different tables. A row in `Workspace/Spaces`.

### Table
An entity that is also an entity type: the ordered set of fields every row in
it follows. A row in `Workspace/Tables`. Called a *database* in Fibery, a
*table* in Airtable.

### Field
One typed, named slot on a table. Not a row of data, but described by a row in
`Workspace/Fields` carrying its type and definition.

### Row
An entity inside a table, typed by that table and addressed `Table#n`. The
level everything domain-specific lives at, under whatever name the domain uses.

### Value
What one entity holds in one field, validated and coerced by that field's type.

### Document
A long-form body held in a document-typed field — markdown by default, HTML or
code by kind. Any number per entity; rendered natively as HTML, PDF or raw text.

### Comment
An authored, time-ordered note on an entity, kept separate from its documents.

### File
A blob attached to an entity, stored beside the workspace file and referenced by
id from attachments fields.

### Activity
An append-only entry recording one change to an entity — created, field-updated,
state-changed, relation-updated, doc-updated, doc-appended, comment-added,
file-attached, automation-ran, undo. Consecutive document edits in one session
fold into a single entry.

### Saved view
A saved arrangement of one or more table blocks, each with its own filter and
layout, optionally published read-only through a share token. Not the entity
view.

### Automation
A rule bound to one table: a trigger — entity-created, field-updated,
state-changed — and the actions it fires: set-field, append-doc, add-comment,
webhook.

### Account
A named token holder with a role: admin, writer, or reader. The workspace stores
the token's hash, never the token. An "account" row in a CRM table is a Row like
any other; the Account kind here is a token holder with a role. Same word, two
levels.

### Key
A named secret held in the keystore outside the workspace, so a workspace file
can be copied without copying credentials.

### Audit entry
A workspace-level record of a structural change — the schema's history, as
opposed to an entity's.

### Undo step
A before-image of one entity mutation, newest first, replayed by `undo()`.

### Public id
The per-table counter that makes an entity addressable as `Task#42` in queries,
documents and mentions. A convenience spelling: the durable reference is
always the uuid.

### Permalink
The id-based URL every entity answers to, at every level: the workspace at
`/w/<workspace-id>/` (its name is an alias), a space at `#/space/<id>`, a
table at `#/table/<id>`, a row at `/e/<id>`. Ids never change, so a permalink
survives every rename; mentions may use a bare uuid (`[[<uuid>]]`) for the
same reason.

### Registry
A system table whose rows are structure: `Workspace/Spaces`, `Workspace/Tables`,
`Workspace/Fields`. Readable, queryable and editable like any table; not
deletable, not redefinable.

Not every system table is a registry. `Workspace/Workflows` is a system table
whose rows are ordinary data — one row per workflow: the tables and spaces it
touches (relations into the registries), its executable script (a code
document), Version, State (Draft / Active / Deactivated), Health (Healthy /
Warning / Failed), Last Run, a Diagram document carrying the workflow's
mermaid, and a Type select that ships empty until workflow types are rolled
out.

The registries are related to each other exactly as the hierarchy says: a
Fields row belongs to its Tables row (the `Table` field, inverse `Fields`), and
a Tables row to its Spaces row (`Space`, inverse `Tables`). Both links are
re-asserted on every sync, and `registryReport()` / `rebuildRegistry()` inspect
and repair a workspace whose links drifted.

### Relation
A link between two tables, materialised as a paired field on each side. The pair
is the relation; there is no separate link object.

### `text`
Free string.

### `number`
A validated number, dressed by its costume: decimals, thousands separator, and
one of percent, an ISO currency, or a free-text unit.

### `date`
A calendar date, optionally with a time, formatted iso / us / eu / long.

### `daterange`
A start and an end.

### `checkbox`
True or false.

### `url`
A link.

### `email`
A format-validated address.

### `select`
One option from a list of coloured options.

### `multiselect`
Any number of options from that list.

### `workflow`
One state from an ordered list, each in a category — not-started, in-progress,
done, canceled, other — with a default state and a transition log.

### `relation`
A link to entities of another table: many-to-one, one-to-many, many-to-many or
one-to-one, always with an inverse field on the far side.

### `field`
A slot whose value is a field *definition*. It terminates the meta-model's
recursion and is what the Fields registry stores.

### `key`
The name of a secret. Displays redacted, and says whether the keystore holds it.

### `attachments`
File ids — one, or many.

### `lookup`
A value pulled through a relation from a field on the far side.

### `rollup`
An aggregate over a relation: count, sum, avg, min, max, or join.

### `formula`
An expression over this entity's fields — arithmetic, logic, and 17 functions —
evaluated by a parser that executes nothing.

### `document`
The slot a Document lives in; its kind is markdown, html, or code.
