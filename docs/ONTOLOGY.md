# weave ontology

## The one core kind

**An entity is one addressable thing.** It has an id, a public id, a set of
fields with values, and a dedicated **entity view** at `/e/<id>` showing those
fields along with its documents, comments, files and activity.

Workspaces, spaces, tables, and the records inside tables **are all entities**.
They differ by *level*, not by kind. This is not a metaphor in weave: creating a
space writes a record in `System/Spaces`, creating a table writes one in
`System/Tables`, adding a field writes one in `System/Fields` — through
the same verbs a customer record answers to, with the same entity view.

What a record is called downstream is a **naming convention and nothing more**:
an item, an entry, a customer, a company, an account, a task, a deal, a
ticket, a contact — endlessly, exactly as in Airtable. None of those names is a
kind. They are all records, and every record is an entity.

**Row** is not a kind either. It is how a grid draws a record: the same record is
a card on a board and a line in a list. Row stays the word for grid geometry
(row density, the Σ row, a CSV header row) and nothing else.

## Two axes, often confused

- An **entity type** is what a thing *is*. In weave every entity type is a
  **Table**: the table an entity belongs to is its type. The levels above the
  record — workspace, space, table, field — are the built-in ones.
- A **field type** is the datatype of one *slot* — `text`, `number`,
  `workflow`, `rollup`.

An entity **has** fields. A field is not a record of data, and `text` is not a kind
of thing weave stores. Asking what entity types weave has and being handed
`text`/`number`/`rollup` is the category error this page exists to prevent.

Both lists are exported from the engine — `ONTOLOGY` and `FIELD_TYPES` in
`src/engine.js` — and `test/ontology.test.mjs` holds this page to them.

## The kinds

### The entity, and its levels

| Kind | Level of | Registry | Lives in | What it is |
| --- | --- | --- | --- | --- |
| **Entity** | — | — | `state.entities` | One addressable thing: id, public id (`Table#n`), fields, and an entity view. Everything below is one. |
| **Workspace** | contains spaces | `System/Workspaces` | `state.meta` | One workspace file and everything in it. The top of the hierarchy. Each workspace owns its system registry and Users table. Its Spaces, Tables, Fields and Workflows records relate to its local Workspaces record through a `Workspace` relation. |
| **Space** | contains tables | `System/Spaces` | `state.spaces` | The unit of meaning in a workspace: the tables of one area, under one schema version. Its name is the left half of `Space/Table`, as in `CRM/Deal`. Spaces never nest. |
| **Table** | contains records | `System/Tables` | `state.tables` | An entity that is also an **entity type**: the ordered set of fields every record in it follows. |
| **Field** | describes a slot | `System/Fields` | `table.fields` | One typed, named slot on a table. Not a record of data, but it has a registry record carrying its type and definition, which is how the schema stays editable as data. |
| **Record** | the data itself | *(it is the data)* | `state.entities` | An entity inside a table, typed by that table, addressed `Task#42`. Call it an item, an entry, a customer — it is a record. |

### What an entity is made of

These have no identity apart from the entity carrying them, and no entity view
of their own.

| Kind | Lives in | What it is |
| --- | --- | --- |
| **Value** | `entity.values` | What one entity holds in one field, validated and coerced by that field's type. |
| **Document** | `entity.docs` | A long-form body — markdown, HTML or code — in a document-typed field. Any number per entity. |
| **Comment** | `entity.comments` | An authored, time-ordered note, kept separate from the documents. |
| **File** | `entity.files` | A blob stored beside the workspace file, referenced by id from attachments fields. |
| **Activity** | `entity.activity` | An append-only record of one thing that happened to the entity, carrying `seq` (the commit order) and `ts` (the display time). Ten kinds; last 500 kept, the older ones counted in `entity.activityDropped`. |

### Machinery around the entities

Real objects with their own verbs, outside the entity levels. Two of them are
also seen as records: a rule is a `System/Workflows` record and an account a
`System/Users` record, which gives those two fields and an entity view. The rest
have neither.

| Kind | Lives in | What it is |
| --- | --- | --- |
| **Saved view** | `state.meta.views` | A saved arrangement of table blocks with filters and layouts, optionally shared by token. Distinct from the entity view every entity has by existing. |
| **Automation** | a `System/Workflows` record | A rule bound to one table: a trigger, and the actions it fires. Its verbs read and write the record. |
| **Account** | `state.meta.accounts` | A named token holder with a role — architect, editor, observer. Only the hash is kept. |
| **Credential** | the keystore, *outside* the workspace | A named secret — API key, token, password, id or pair. A key field stores the NAME; the value never enters the .db, and reading it back is gated by the credential's own access list. |
| **Audit entry** | `store.audit_log` | A workspace-level record of a structural change. |
| **Undo step** | `store.undo_log` | A reversible before-image of one entity mutation. |

## Every level is a table

The claim "everything is an entity" has a twin: **every level is itself
structured as a table with fields.**

- The **workspace** is a table whose records are its spaces — literally
  `System/Spaces`.
- A **space** is a table whose records are its tables — `System/Tables`,
  scoped to the space through the `Space` relation; a space's entity view
  lists exactly its own tables.
- A **table** is a table whose records are its records — that one needs no
  registry, it is the thing itself.

And because a table's record is a real entity, **the table's configuration is
fields on that record**, not settings hidden in an options panel:

| Field on the Tables record | What it configures |
| --- | --- |
| `Description` | The description shown at the top of the table |
| `Field Order` | Which columns appear, in what order — a comma-separated full permutation |
| `Hidden Fields` | Which columns (including system columns) are hidden |

The sync is two-way and validated identically in both directions: editing
`Field Order` on the record *is* `updateTable({ fieldOrder })`, so a partial
order is refused on the record exactly as it is at the schema verb. Adding,
deleting, or reordering columns through the schema verbs updates the record.

## How it nests

```
Workspace ......................... entity (level 1), record in its own System/Workspaces table
└── Space ......................... entity (level 2) — record in System/Spaces
    └── Table ..................... entity (level 3) — record in System/Tables
        │                             …and the ENTITY TYPE of everything in it
        ├── Field ................. entity (level 4) — record in System/Fields
        └── Record ................ entity (level 5) — row / item / entry /
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
  *are* the schema seen as records — one verb per mutation, whichever side it
  starts from. So a table can be filtered, related, automated and documented
  like anything else.
- **A relation is a paired field, not a kind.** Linking two tables creates a
  field on each side; the link itself has no identity you can address.

## Lifecycles

| Kind | Created by | Ends by |
| --- | --- | --- |
| Workspace | opening a path | deleting the file |
| Space | `createSpace`, or a record in `System/Spaces` | `deleteSpace` — cascades to its tables |
| Table | `createTable`, or a record in `System/Tables` | `deleteTable` — cascades to its records, paired relation ends, dependent computed fields |
| Field | `addField` / `addRelation`, or a record in `System/Fields` | `deleteField` — takes its inverse end and dependent lookups/rollups with it |
| Record | `createEntity` | soft delete to trash, then `restoreEntity` or a hard delete |
| Value, Document, Comment, File, Activity | writing to an entity | with their entity (files also individually) |
| Saved view, Automation, Account | their `create*` verb | their `delete*` verb |
| Credential | `setKey` | `deleteKey` — the workspace still holds the name |
| Audit entry, Undo step | any qualifying mutation | never rewritten; undo steps are consumed by `undo()` |

System spaces, system tables and system fields refuse deletion: the registries
are part of the engine, not user data.

## The other axis: field types

Twenty-two, and not one of them is a kind of entity. Seventeen store a value —
`text`, `number`, `rating`, `date`, `daterange`, `checkbox`, `toggle`, `url`, `email`, `select`,
`multiselect`, `workflow`, `relation`, `field`, `key`, `attachments`, `avatar`. Four
compute one from other fields — `lookup`, `rollup`, `formula`, and `view`,
which computes the record's own chip or card. One holds a body — `document`.

The pair to keep straight is `field` and Field. A Field is the slot; the
`field` *type* is a slot whose **value is a field definition**, which is what
lets the Fields registry describe columns as records without the model becoming
circular. The same normaliser validates a stored definition and a real column,
so a definition can only ever describe a field the engine would accept.

## Glossary

### Entity
One addressable thing: an id, a public id, fields with values, and a dedicated
entity view. Workspaces, spaces, tables and records are all entities, differing by
level rather than kind.

### Entity type
What an entity *is*. In weave an entity type is a **Table** — the table an
entity belongs to is its type — plus the built-in levels above the record.
Downstream names for records (row, item, entry, customer, company, account,
task, deal, ticket, contact) are conventions, not types.

### Field type
The datatype of one field: what values that slot accepts and how they display.
Twenty-two of them. A field type is not a kind of object — no `text` is ever
created, deleted, or addressed.

### Entity view
The page every entity has by existing, at `/e/<id>`: its fields in the table's
order, then its documents, comments, files and activity. A space, a table and a
customer all have one, because all three are entities.

### Workspace
One SQLite `.db` file holding spaces, tables, records, accounts and its system
registry. The workspace is the top level of the hierarchy, with a record in its
own `System/Workspaces` table. The hub discovers workspace files and routes
requests to them; each workspace checks its own users and permissions.

### Space
The unit of meaning in a workspace: the tables of one area, under one schema
version. Its name is the left half of `Space/Table`, as in `CRM/Deal`. Spaces
never nest. A record in `System/Spaces`.

### Table
An entity that is also an entity type: the ordered set of fields every record in
it follows. A record in `System/Tables`. Called a *database* in Fibery, a
*table* in Airtable.

### Field
One typed, named slot on a table. Not a record of data, but described by a record in
`System/Fields` carrying its type and definition.

### Record
An entity inside a table, typed by that table and addressed `Table#n`. The
level everything domain-specific lives at, under whatever name the domain uses.

### Value
What one entity holds in one field, validated and coerced by that field's type.

### Document
A long-form body held in a document-typed field — markdown by default, HTML or
code by kind. Any number per entity; rendered natively as HTML, PDF or raw text.
Every document keeps its own revisions (`doc_revisions`, beside the entity
blob): one snapshot per editing session, restorable, dropped on purge.

### Comment
An authored, time-ordered note on an entity, kept separate from its documents.

### File
A blob attached to an entity, stored beside the workspace file and referenced by
id from attachments fields.

### Avatar
The face of one record, drawn first on its chip, card, crumb and header. An
`avatar` field holds it; with no image the record shows its initials.

### Activity
An append-only entry recording one change to an entity — created, field-updated,
state-changed, relation-updated, doc-updated, doc-appended, comment-added,
file-attached, automation-ran, undo. Consecutive document edits in one session
fold into a single entry, keeping the `seq` they started with.

Every entry carries `seq`, a monotonic counter over the whole workspace
(`meta.activitySeq`), alongside its wall-clock `ts`. `seq` is the order — the
feed and `GET /api/activity` sort on it, newest first — and `ts` is what a
reader is shown. Two writes inside one millisecond and a clock that steps
backwards both order correctly because of it. Every open numbers whatever it
finds unnumbered, oldest first and with each entity's stored order preserved,
and never moves a number already handed out: that covers a workspace written
before `seq` existed and a straggler left by a writer running older code
against the shared `.db`.

### Saved view
A saved arrangement of one or more table blocks, each with its own filter and
layout, optionally published read-only through a share token. Not the entity
view.

### Automation
A rule bound to one table: a trigger — entity-created, field-updated,
state-changed, or schedule (a cron expression, a zone and an optional where
clause, fired by the server's minute tick) — and the actions it fires: set-field, append-doc, add-comment,
webhook. Since Feature #249 every rule is a record of `System/Workflows`: the
record's Script document holds it as JSON, `{table, trigger, actions}` with
names, and `createAutomation`, `listAutomations`, `updateAutomation` and
`deleteAutomation` (REST, MCP and the CLI alike) read and write that record.

A rule's `seq` is its record number: minted when the rule is created, never
reused after a delete, carried by export and import with the record. The rules
on one trigger fire in `seq` order, and the API (`GET /api/automations`),
MCP, the CLI and the relation map's pills all list them that way. A
workspace that still holds rules in the old `state.automations` store moves
them onto records on open, in `seq` order (a rule older than `seq` is numbered
in rowid order first); a hand-made record with the same Name on the same table
is adopted rather than duplicated.

Writes an automation makes are made as its record (Issue #674): their activity
entries and the changed record's Modified By read `workflow:<Workflows row id>`,
while the `automation-ran` entry keeps the person whose write fired the rule
and names the record in `detail.workflow`.

### Account
A named token holder with a role: architect, editor, or observer (admin, writer
and reader before 2026-10-02). The workspace stores
the token's hash, never the token. An "account" record in a CRM table is a Record like
any other; the Account kind here is a token holder with a role. Same word, two
levels.

### Credential
A named secret held in the keystore outside the workspace, so a workspace file
can be copied without copying credentials. Which sort it is — API key, token,
password, protected id, or an id/secret pair — and which store holds it are
column config; the cell holds only the name.

Permission for a credential sits on the credential, not on the field. Weave has
no field-level read rules and wants none: reaching a table reaches its values
everywhere, and that stays true here because the secret was never in the table.
Getting one out is a separate audited act, allowed to the credential's owner
and whoever the owner granted.

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
table at `#/table/<id>`, a record at `/e/<id>`. Ids never change, so a permalink
survives every rename; mentions may use a bare uuid (`[[<uuid>]]`) for the
same reason.

### Registry
A system table whose records are structure: `System/Workspaces`,
`System/Spaces`, `System/Tables`, `System/Fields`. Readable, queryable
and editable like any table; not deletable, not redefinable. Each workspace
owns its registry. Every record carries a `Workspace` relation to its local
Workspaces record, and a record edit calls that workspace's schema operation.

Not every system table is a registry. `System/Workflows` is a system table
whose records are the workspace's automations, one record per rule, and the table
is their control panel (Feature #249). A record carries an On toggle (worded
On / Off, off until switched, the first column after Name), the tables and
spaces its rule touches (relations into the registries, kept in step with the
rule's table), its Script (a code document holding the rule as JSON), Version,
State, Health with its Health Reason, Last Run, a Diagram document carrying
the workflow's mermaid, and a Type select that ships empty until workflow
types are rolled out. Three columns, one owner each (Kyle, 2026-10-03): On is
the user's switch, which the engine reads before every fire and never
writes; State is setup, `Setup incomplete` or `Ready`, which the engine
computes on every write from whether the rule names a table, trigger and
actions that exist with values that fit, and a record that is Setup incomplete
and Off refuses to be switched On; Health is runtime, `Healthy`, `Warning`,
`Failed` or `No runs`, stamped with Last Run on every fire. A record whose setup
breaks while On (its trigger field deleted, say) stays On, is skipped, and
reads Failed with the reason; a failing record is never switched off for you.
Workflow records live in the workspace whose tables the rules operate on.

`System/Views` holds one record per table view, `System/Users` one per account or
pending invite, and `System/Forms` one per form. These are system tables too, and
not registries of schema.

The registries are related to each other exactly as the hierarchy says: a
Fields record belongs to its Tables record (the `Table` field, inverse `Fields`), and
a Tables record to its Spaces record (`Space`, inverse `Tables`). Both links are
re-asserted on every sync, and `registryReport()` / `rebuildRegistry()` inspect
and repair a workspace whose links drifted.

Legacy hub detachment preserves current registry IDs and remaps typed references
and UUID wiki targets from older local registries. Plain markdown URLs and saved
bookmarks containing replaced local IDs need manual updates. Restore a complete
hub backup and migrate it before importing an individual legacy member archive.

### Relation
A link between two tables, materialised as a paired field on each side. The pair
is the relation; there is no separate link object.

### `text`
Free string.

### `number`
A validated number, dressed by its costume: decimals, thousands separator, and
one of percent, an ISO currency, or a free-text unit.

### `rating`
A whole number from 0 to the field's `max` (1 to 100, 5 unless named), drawn as `max` icons
from the inventory with the first ones filled. A number to every reader.

### `date`
A calendar date, optionally with a time, formatted iso / us / eu / long.

### `daterange`
A start and an end.

### `checkbox`
True or false.
### `toggle`
True or false wearing two named states — `on` and `off` labels the config
names, and a default state; a switch, not a box.

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

### `avatar`
The record's face: one image file from the record, or initials on a hue from its
name. One per table. An icon names the kind of record; an avatar names the record.

### `lookup`
A value pulled through a relation from a field on the far side.

### `rollup`
An aggregate over a relation: count, sum, avg, min, max, or join.

### `formula`
An expression over this entity's fields (arithmetic, logic, and 23 functions),
evaluated by a parser that executes nothing.

### `view`
The record as it appears elsewhere: its **chip** inline, its **card** as a tile.
Every table carries one of each, minted with it and hidden from the grid; the
config — the #id link, the state, a description preview, a few fields — is the
table's, the same for every record.

### `document`
The slot a Document lives in; its kind is markdown, html, or code.
