# text

Free-form single-line string. Every table is born with one: `Name`, the entity's identity and its link text everywhere. It can be renamed (Title, Subject, Invoice #) and it can become a **formula** — a computed name that follows its inputs; it cannot be deleted, because a record needs an identity. The record term (what one record is called) lives on it too.

## Config

`default` — the value a new record starts with. `{ "name": "Title", "type": "text", "config": { "default": "Untitled" } }`

`literal` — `true` paints the characters as typed. A text cell normally dresses inline markdown (`**bold**` reads bold, `\`code\`` reads as code); a column that HOLDS syntax — a regex, a glob, a format string, the Showcase's Syntax column — opts out with `{ "literal": true }`, from the field dialog's **Literal** box or `--config '{"literal":true}'`.

## Usage

```bash
weave create Task "Ship the release"
weave field add Task Owner text --config '{"default":"unassigned"}'
```

Inline-editable in every view. The `Name` field feeds full-text search.

## In formulas

`concat(Name, " — ", Owner)` · `upper(Code)` · `empty(Notes)`

## Migrations

A text column can become `number`, `key`, `url`, `email`, `select`, `multiselect` or `date` in place, values coerced as they move. Anything else means a new column — the engine refuses a migration that would have to invent data.

## Gotchas

Empty string normalizes to null. `Name` cannot be renamed or deleted.