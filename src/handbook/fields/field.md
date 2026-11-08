# field

A value that **is** a field definition. This is what makes the schema editable as data: the `Definition` column on `System/Fields` is a `field` field.

## Config

`depth` — 1 to 4, how many times a definition may describe another definition. `types` is filled in by the engine with the definable set.

```json
{ "name": "Definition", "type": "field", "config": { "depth": 1 } }
```

## Usage

The value is the same object `add_field` takes:

```json
{ "type": "number", "config": { "format": "currency", "currency": "EUR", "decimals": 2 } }
```

Written to a registry record, it reconfigures the real field — the same validation, because it is the same normalizer.

In a grid the cell reads as a sentence rather than as JSON: `select · 3 options`.

## Definable types

`text`, `number`, `rating`, `date`, `daterange`, `checkbox`, `toggle`, `url`, `email`, `select`, `multiselect`, `workflow`, `document`, `field`, `key`, `attachments`.

`relation`, `lookup`, `rollup` and `formula` are absent on purpose: each needs a target that only exists in a table's context, so each has its own verb.

## Gotchas

A `Definition` cannot change a field's **type** — drop the column and create it anew. Pass the object with a `config` key; a bare `{type, options}` is accepted and silently does nothing.