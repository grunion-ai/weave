# avatar

The record's face: an uploaded image, or the record's initials on a colour drawn from its name. An icon says what kind of record this is and belongs to the table; an avatar says which record it is and belongs to the record, so an avatar never takes an icon from the inventory.

## Config

`shape`: `round` (default) for people and agents, `square` for organisations and logos.

A table holds one avatar field. A second is refused.

```bash
weave field add Contact Photo avatar
weave field add Company Logo avatar --config '{"shape":"square"}'
```

## Usage

```bash
weave file attach Contact#5 --path ./myriam.png --field Photo
```

The upload replaces the face; the earlier image stays in the record's file ledger. The value is the id of a file on this record, and the field takes PNG, JPEG, GIF or WebP. An SVG is refused, since weave serves uploaded SVGs as downloads, never inline. Clearing the value, or deleting the file, puts the initials back.

A table with an avatar field puts the face first in the record's chip, inside its link, and first in the card's head. The face stands in for the record mark in the crumb and sits beside the name on the record's page, where a click or a dropped image changes it. A relation to the table draws the face on every chip that points there, and ⌘K shows it beside the hit. A table without one draws exactly as before.

**System/Users** carries an Avatar field. An agent account shows its face with a small chip badge in the corner, so a person and an agent with the same initials read apart.

A compact to-many relation cell whose records all have faces draws them as a pile: up to five overlapping faces, each a link to its record, then `+N`. Created by, Modified by, the activity feed and the identity panel show the face from the actor's **System/Users** record. A one-word name takes its initials from the parts between its dashes or underscores, so `weave-fixer` reads WF.

## Gotchas

The avatar is never a chip segment or a card field: it is the face, drawn once. Formulas, filters and footers skip it, as they skip attachments.