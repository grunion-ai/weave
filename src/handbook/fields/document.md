# document

A markdown document that belongs to one record. Every table has one — `Description` — and a table may carry as many more as it needs.

The first one is a **role**, not a name. Rename it to `Notes` and it is still the description: the table points at it by id, so `weave doc set Task#5` without a `--field` still finds it, and the schema descriptor carries `role: "description"`. Delete it and it stays deleted — no migration puts it back.

## Config

**Display inline** (`displayInline` set to `true`) renders the content directly in the record body without its field heading or collapse control. Editors open **Field options** beneath the content to reach settings, source and file controls. The field keeps its identity, permissions and place in the schema. Move it using the existing body order to put it above Fields or elsewhere; enabling inline display does not change its position. Turn it off to restore the standard display.

HTML keeps its sandbox and expands to fit its content. Empty inline documents have no reader-facing section. The setting is available in the field editor and through the same config in MCP, REST and CLI.

`kind` — `markdown` (the unmarked default), `html`, or `code`.

```bash
weave field add Task Spec document
weave field add Workflow Script document --config '{"kind":"code"}'
weave field update Task Description --name Notes   # still the description
```

## Usage

The description takes a column of its own and previews what it says: the first line, formatted — a heading as its words, bold as bold, never a hash or a pair of asterisks — and the first few lines when you hover it. A document that is not prose is named instead of flattened: `HTML page` (or its own <title>), `JSON model`, `graph diagram`.

Every OTHER document is a column of its own in the grid: a named chip wearing the kind it holds — the declared kind when the field declares one, the sniffed kind otherwise. It hides behind the eye, resizes and reorders like any field. All documents open in full on the entity page and in the dock. While you scroll a long one, the entity header stays at the top and the document's section head (its name, history, copy link and menu) stays under it until the document ends; the next document's head takes its place.

```bash
weave doc set Task#5 --field Spec --content '# Spec'
weave doc append Task#5 --field Spec --file notes.md
weave doc export Task#5 --format pdf --out t5.pdf
```

Every document is addressable as MD, HTML, MMD and PDF at `/e/<id>/doc/<Field>.<fmt>`.

A write over HTTP carries its text under `doc` or `markdown`: `PUT /api/entities/<id>/doc` replaces, `POST` appends, and `field` in the body picks a named document. A body with neither key is a 400. Clearing stays explicit, `{"doc": ""}` over HTTP and `weave doc set --content ''` from the CLI, so leaving the text out is a mistake rather than a blank document.

## History

Every document keeps its own revisions. A revision is one editing session: writes by the same actor to the same field within ten minutes fold into one, so a pause is not a snapshot and a keystroke log never builds up. Identical text records nothing. Two hundred revisions are kept per document, oldest trimmed; the trash keeps them, a purge drops them with the record.

The **Activity** button (the clock-arrow in the record's header) opens the record's Activity in the context pane, the next card in the pane row: right of the record on the full page, right of the entity pane in the peek. Drag the gutter before it to resize it (double-click resets it to 340 px); the URL carries `side=activity`, so a reload or a shared link reopens it, and Esc closes it before the entity pane. Press the button again to close it. It lists every document's revisions and every field and state change, newest first under Today, Yesterday and a date. A chip per document narrows the list to that document's versions; the chips stay on one line, and the ones that do not fit wait under **More**. A long value wraps inside its row. Hover a row for its action; select it for **Restore** (a revision) or **Revert** (a field; **Clear value** when the field was empty before the change), and for a revision a picker to compare it with any other version of the same document. The selected change shows read-only where it lives, a document's diff in place of its editor and a field change as a card at the top. A restore is an ordinary edit (undoable) and never overwrites what it replaces: both texts stay in the list. Its record reads "Description restored from" and the time of the version it brought back, and its own activity entry reads "Description restored to the version from …" with who wrote that version; an agent reads the same as `restoredFrom` (the revision's seq) on the revision and `restoredFrom`, `restoredAt`, `restoredBy` on the entry. Every action toasts with **Undo**, which steps back that action only.

Comments are off in the app until their redesign: a record shows no comment card or comment box, and the Activity panel lists no comments. Comments written through the API, MCP or an automation's add-comment action are still stored, returned with the record by `GET /api/entities/:id`, and listed as comment-added entries in the Activity table.

```bash
weave doc-revisions Task#5 --field Spec          # newest first: seq, at, actor, len
weave doc-revisions Task#5 --field Spec --seq 41 # that revision's text
weave doc-restore Task#5 --field Spec --seq 41   # write it back
```

Agents reach the same three through `weave_doc_revisions` / `weave_doc_restore` and `GET /api/entities/<id>/doc/revisions?field=`, `GET …/doc/revisions/<seq>`, `POST …/doc/revisions/<seq>/restore`. Revisions live beside the entity, not inside it: an export carries the current text only.

## What a document can hold

Headings that fold, tables, task lists, code blocks that detect their own language, mermaid diagrams, KaTeX math including chemistry, raw HTML, `[[…]]` chips that link to any entity, table or space, and `:name:` icons drawn from the set. See the **Document formatting** guide for the whole surface.

## Gotchas

The editor renders as you type — there is no edit mode and no save button. A document written by an automation lands the same way a person's typing does.