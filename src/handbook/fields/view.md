# view

How one record **appears elsewhere**. Every table carries two, minted with it and hidden from the grid until someone unhides them: **Chip**, the record inline — a relation cell, a `[[Table#12]]` mention in a document, a reference card — and **Card**, the record as a tile — a gallery, a peek. The config is the table's and the same for every record, so a task looks like a task wherever it turns up. The entity page draws each one the eye leaves on, in its **Appears as** strip, so a reader sees the record the way the rest of the workspace will; switch Chip or Card on in the eye to see it there, off and it goes from the strip and the grid alike.

## Config

`shape` — `chip` or `card`. Fixed: it is which of the two this field is.

`link` — show the public id as a permalink (`#12`). A card says yes by default; a chip no.

`state` — show the workflow state, first. On by default for both. The state is the **mark**: on a chip it leads the line, on a card it takes a row of its own, and on either a click opens the state picker grouped by category and writes the state to the record. It is the only way state changes from a chip or a card.

`description` — a preview of the description document: `none`, `small` (the first line), `medium` (about 120 characters across the first lines), `large` (about 320). A chip defaults to `none`, a card to `small`. Prose only: a page, a JSON model or a diagram is named, never flattened.

`fields` — the other fields to show, by name, in this order — or `null` to take the first few non-empty glanceable values in column order, which is the default: arranging the columns IS the curation. A chip auto-fills to three segments in all, a card to four; the state counts as one. A select or multiselect segment draws as its own chip and opens its picker; the rest are label·value pairs. Documents, files, keys and definitions cannot ride along, and neither can the name (always shown) or the views themselves.

One renderer draws both shapes, `public/chip-view.js`, with one stylesheet, `public/chip.css`. The browser loads them for relation cells and the References panel, and `src/markdown.js` loads them for document pages and HTML exports, so the same record prints the same markup on every surface. The **Chip and card anatomy** guide names every element.

```json
{ "name": "Card", "type": "view", "role": "card",
  "shape": "card", "link": true, "state": true, "description": "small", "fields": ["Owner", "Due"] }
```

## Usage

The chip and the card are roles, like the description: `describeSchema` marks them `role: chip` / `role: card`, and a schema document is matched on the role, so a renamed Chip is still the chip. Rename freely. There is no delete — every record has a chip and a card by existing — and no `add_field` of type `view`: configure the minted pair.

`readEntity` ships both under their field names — the one-line form (`Ship the editor · Doing · Due 2026-09-12`) in `fields`, the object (`{ shape, id, publicId, url, name, link, state, description, fields }`) in `raw` — and every relation summary carries the far record's `chip`, so a relation cell and a doc mention draw the same chip. `weave_update_field` with `{ config: { fields: ["Owner"], description: "medium" } }` changes it for every record of the table at once. `GET /api/entities/:ref/view?shape=card&config={…}` draws one record under a candidate config without saving it — the field dialog's live preview.

## Gotchas

`fields` arrives as names and is stored as ids: a renamed field keeps its place on the card, and a deleted one falls off it rather than breaking it.

Unhiding a view puts a read-only column in the grid; a chip cell draws the chip, a card cell a compact card. CSV export leaves both out — they are presentation over the other columns, not data. A partial `fieldOrder` may leave them out too; they keep their place at the end.

A card cannot show the description of a table whose description was deleted; `description` is then simply empty.