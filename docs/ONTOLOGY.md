# weave ontology

weave's model has **two axes**, and they are often confused because both are
called "types".

- An **entity type** is a *kind of object weave models* — a Space, a Table, an
  Entity, a Comment. It has an identity, a lifecycle, and verbs that create and
  destroy it.
- A **field type** is the *datatype of one slot* on one of those objects —
  `text`, `number`, `workflow`, `rollup`.

An entity **has** fields. A field is **not** an entity: it is part of the Table
that describes entities, and `text` is not a kind of thing weave stores. Asking
"what are the entity types in weave" and getting a list of field types is the
category error this document exists to prevent.

Both lists are exported from the engine — `ONTOLOGY` and `FIELD_TYPES` in
`src/engine.js` — and `test/ontology.test.mjs` holds this page to them.

## The entity types

Fifteen kinds, in five layers: what structure is made of, the data itself, what
an entity carries, what runs over it, and what it remembers.

| Kind | Layer | Lives in | Identity | What it is |
| --- | --- | --- | --- | --- |
| **Workspace** | structure | `state.meta` | the .db file itself; a name and an optional logo | One workspace file and everything in it: spaces, tables, entities, and the operational objects around them. |
| **Space** | structure | `state.spaces` | uuid; name unique in the workspace | A named container grouping tables that belong to one area of work; it qualifies their names (`Space/Table`). |
| **Table** | structure | `state.tables` | uuid; qualified name `Space/Table` | **A user-defined entity type** — the schema, an ordered set of fields, that every one of its entities follows. |
| **Field** | structure | `table.fields` | uuid; name unique within its table | One typed, named slot on a table, carrying a field type and that type's config. Describes entities; is not one. |
| **Entity** | data | `state.entities` | uuid; per-table public id, addressed `Table#n` | One row of one table: a value per field, plus the documents, comments, files and activity it carries. |
| **Document** | entity content | `entity.docs` | the entity plus the document field it fills | A long-form body — markdown, HTML or code — held in a document-typed field. An entity may carry any number. |
| **Comment** | entity content | `entity.comments` | uuid within its entity | An authored note on an entity, ordered by time and separate from its documents. |
| **File** | entity content | `entity.files` | uuid; blob at `files/<id>` beside the workspace | A blob attached to an entity, referenced by id from attachments fields. |
| **Activity** | history | `entity.activity` | `entityId:index` | An append-only record of one thing that happened to an entity. Ten kinds; the last 500 per entity are kept. |
| **View** | operations | `state.meta.views` | uuid; a share token when shared | A saved arrangement of one or more table blocks, each with its own filter and layout. |
| **Automation** | operations | `state.automations` | uuid | A rule bound to one table: a trigger and the actions it fires. |
| **Account** | access | `state.meta.accounts` | uuid; name unique in the workspace | A named token holder with a role — admin, writer, or reader. Only the token hash is kept. |
| **Key** | access | the keystore, *outside* the workspace | its name | A named secret. A key field stores the NAME; the value never enters the .db and is never read back. |
| **Audit entry** | history | `store.audit_log` | rowid | A workspace-level record of a structural change: spaces, tables, fields, relations, views, accounts, keys, applied schemas. |
| **Undo step** | history | `store.undo_log` | rowid | A reversible before-image of one entity mutation, newest first, replayed by `undo()`. |

## How they nest

```
Workspace
├── Space
│   └── Table ......................... a user-defined entity type
│       ├── Field ..................... typed by one of the 18 field types
│       ├── Automation ................ trigger + actions, bound to this table
│       └── Entity .................... one row
│           ├── value per Field
│           ├── Document  (0..n, one per document field)
│           ├── Comment   (0..n)
│           ├── File      (0..n)
│           └── Activity  (append-only, last 500)
├── View, Account ..................... workspace-wide
├── Audit entry, Undo step ............ workspace history
└── Key ............................... referenced by name; stored in the keystore
```

Two structural notes that follow from the table above:

- **The meta-model closes the loop.** Every workspace carries a system space,
  `Workspace`, whose `Spaces`, `Tables` and `Fields` tables hold one entity per
  space, table and field. Structure is therefore *also* data: create a row in
  `Tables` and the table exists; rename it and the table renames. The registry
  and the schema cannot drift because both go through the same verb.
- **Relations are paired fields, not a separate kind.** Linking two tables
  creates a field on each side; the link itself has no identity you can address.

## Lifecycles

| Kind | Created by | Ends by |
| --- | --- | --- |
| Workspace | opening a path | deleting the file |
| Space | `createSpace` | `deleteSpace` — cascades to its tables |
| Table | `createTable` | `deleteTable` — cascades to its entities, and to paired relation ends and dependent computed fields elsewhere |
| Field | `addField` / `addRelation` | `deleteField` — takes its inverse end and dependent lookups/rollups with it |
| Entity | `createEntity` | soft delete to trash, then `restoreEntity` or a hard delete |
| Document, Comment, File, Activity | writing to an entity | with their entity (files also individually) |
| View, Automation, Account | their `create*` verb | their `delete*` verb |
| Key | `setKey` | `deleteKey` — the workspace still holds the name |
| Audit entry, Undo step | any qualifying mutation | never rewritten; undo steps are consumed by `undo()` |

System spaces, system tables and system fields refuse deletion: the registry is
part of the engine, not user data.

## The other axis: field types

Eighteen, and none of them is an entity type. Fourteen store a value —
`text`, `number`, `date`, `daterange`, `checkbox`, `url`, `email`, `select`,
`multiselect`, `workflow`, `relation`, `field`, `key`, `attachments`. Three
compute one from other fields — `lookup`, `rollup`, `formula`. One holds a
body — `document`.

The pair to keep straight is `field` and Field. A Field is the slot; the
`field` *type* is a slot whose **value is a field definition**, which is what
lets the `Fields` registry describe columns as rows without the model becoming
circular. The same normaliser validates a stored definition and a real column,
so a definition can only ever describe a field the engine would accept.

## Glossary

### Entity type
A kind of object weave models, with its own identity, lifecycle and verbs — the
fifteen in this document. In the *user's* model the entity types are the
**Tables** they define; the fifteen here are the built-in kinds those tables and
their rows are made of.

### Field type
The datatype of one field: what values that slot accepts and how they display.
Eighteen of them, listed above. A field type is not a kind of object — no
`text` is ever created, deleted or addressed.

### Workspace
One weave file — a SQLite `.db` — holding spaces, tables, entities and the
operational objects around them. One workspace is one unit of self-hosting.

### Space
A named container that groups tables and qualifies their names, so `Dev/Task`
and `Sales/Task` are different tables.

### Table
A user-defined entity type: an ordered set of fields, plus the rows that follow
it. Called a *database* in Fibery and a *table* in Airtable.

### Field
One typed, named slot on a table. Fields belong to the schema; entities carry a
value for each.

### Entity
One row of one table, addressed `Table#n` by its per-table public id. Carries
its field values plus its documents, comments, files and activity.

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

### View
A saved arrangement of one or more table blocks, each with its own filter and
layout, optionally published read-only through a share token.

### Automation
A rule bound to one table: a trigger — entity-created, field-updated,
state-changed — and the actions it fires: set-field, append-doc, add-comment,
webhook.

### Account
A named token holder with a role: admin, writer, or reader. The workspace stores
the token's hash, never the token.

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
documents and mentions.

### System table
A table the engine owns — the `Spaces`, `Tables` and `Fields` registries and
`Activity`. Readable and queryable like any other; not deletable, not
redefinable.

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
recursion and is what the `Fields` registry stores.

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
