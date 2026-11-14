# Document formatting

Every entity carries at least one document, and a table can give it more. This page is what a document can hold. Inline, `:name:` draws any icon from the set (`:bell:` is the bell) where an emoji shortcode would go; see the Formatting showcase.

## Conditional agent writes

Entity API reads include an opaque `revision`. Send it as `expectedRevision` to `POST /api/entities/:id/conditional`. The `append` operation takes `field` and `markdown`; `state` takes `field` and `state`; `close` takes both halves at once, `markdown` with its `field` and `state` with its `stateField`, so a worker files its evidence and moves the record in one write with one revision check. A refused `close` writes neither half. The server checks the revision under its database write lock, refuses stale input with 409, and returns the updated entity. Append preserves existing text. A retry first reads the record again and checks whether its run evidence already exists.

Authenticated clients can read `GET /api/health/build` for the serving worker's full commit SHA, version and readiness. This response excludes filesystem paths, backup details and process identifiers. A missing full SHA makes readiness false.

## The editor is the renderer

There is no edit mode, no preview pane and no save button. A heading becomes a heading as you finish typing it, and what is stored underneath is plain markdown — the same text the API returns, the same text an automation appends, the same text `doc export` writes out.

Nothing in a document is a proprietary block. Copy it into a file, hand it to an agent, put it under version control; it stays what it is.

## The toolbar

Select some text and the toolbar floats in over the selection — headings (with a level dropdown), bold, italic, strikethrough, inline code, link, the three list kinds, outdent and indent, quote, code block, table, divider, undo, redo, and file upload. Hover any button for its name and shortcut. The bar leaves when the selection does; the document keeps a clean top edge. Uploads attach to the entity and land in the document as inline viewers — images, PDFs and HTML files render centered at a medium width with a resize grip in the corner; any other file type gets a plain link. Hover a viewer for its toolbar: **Show as link** swaps the viewer for a plain link. Viewers survive every export — the `.md` keeps the markdown verbatim, the `.html` renders them, the `.pdf` still builds. The full catalogue (references, mermaid, raw HTML, math) stays in the slash menu.

## The slash menu

Type `/` on an empty line, or after a space on a line that already has text. Three groups:

| Group | What it holds |
| --- | --- |
| **ALL COMMANDS** | blocks — headings, lists, quote, code, mermaid, table, divider, line break, raw HTML |
| **REFERENCE** | a link to an entity, a table, or a space; picking one opens the search |
| **FORMAT · APPLIES TO SELECTION** | bold, italic, strikethrough, inline code, link |

Each row shows its markdown on the right, so the menu teaches the syntax rather than hiding it. Aliases catch what you actually type: `/todo` finds the task list, `/hr` the divider, `/h4` a level-four heading directly.

A format command wraps the text you selected rather than a placeholder — as long as you selected it in the last fifteen seconds. Select a phrase, type `/bold`, and the phrase is what ends up bold.

Text, a heading, a list, a task list and a quote take the line they are typed on. `Buy milk /task` becomes `- [ ] Buy milk`, `## Plan /task` becomes `- [ ] Plan`, and `/text` on a heading gives a plain paragraph. The words, their inline formatting and a nested item's indent stay; the caret goes to the end of the line. On an empty line the command writes its prefix and a placeholder, selected, so the first thing you type replaces it. Every other block (code, mermaid, table, divider, line break, image, raw HTML) is inserted beside the text.

## Blocks

| Block | Syntax |
| --- | --- |
| Heading 1–6 | `#` … `######` |
| Bulleted list | `-` |
| Numbered list | `1.` |
| Task list | `- [ ]` |
| Quote | `>` |
| Code block | three backticks |
| Mermaid diagram | three backticks + `mermaid` |
| Table | `| a | b |` |
| Divider | `***` |
| Raw HTML | `<div>` |

Lists nest on two spaces. The divider is `***` rather than `---` because a `---` pair reads as YAML front matter and comes back as a code block.

## Linking to anything in the workspace

Type `#` anywhere in a line and the entity search opens inline, arrow-navigable, one step. Pick a record and you get a chip.

```
[[Task#12]]          an entity
[[table:Task]]       a table
[[space:Handbook]]   a space
```

The stored form is a permalink keyed on the target's id, so renaming the target renames the chip and never breaks the link. Chips render live in the editor, in the rendered view, and in exported HTML. Each is the same pointer chip a relation cell wears, out of the same renderer and the same stylesheet: an outline, no fill, the state mark leading, the `#id` in mono, the name, then the configured chips and the home badge. It draws at the size of the text around it, so a line holding one is no taller than a line without. A bare `[[Table#n]]` is stored as `[[Table#n|Name]]` once the editor resolves it, which is what keeps the chip from being cut to the width of its source (Issue #679). A reference to a missing or deleted record is never drawn as a chip, and a PDF prints the reference's words.

In the editor a chip shows the target's name. Its outline stops where the name does; hover for the table and number. A bare `[[Task#12]]` leaves room for a few characters only, so a long name ends in an ellipsis. Picked from the `#` search, the reference carries the name and fits.

## Code

An unlabelled fence detects its own language — JSON, HTML, a mermaid source, a shell session — and highlights it. Naming the language on the fence still wins. Anything unrecognised stays plain text, which is the right answer for a config snippet nobody has a grammar for.

Highlighting is the vendored highlight.js: github in light, github-dark in dark. The block chrome belongs to weave, so a code block reads like the rest of the page in both themes.

Click into a block and you edit the code itself; the fences and the language stay out of sight. The **</>** button in the block's upper right shows them, so you can rename the language, and a second click hides them. Leave the block and it closes again.

## Diagrams

A `mermaid` or `mmd` fence renders as a diagram — in the editor, and in every export. `.mmd` is a first-class download format beside `.md`, `.html` and `.pdf`.

Clicking a diagram keeps the drawing on screen. Its source sits behind the same **</>** button, and typing into the block opens the source first, so you never edit text you cannot see.

Graphviz, PlantUML, echarts, mindmap, abc and flowchart fences are deliberately **not** vendored. They degrade to plain code blocks rather than pulling six renderers into the tree.

## Math and chemistry

`$…$` inline, `$$…$$` as a block, rendered by KaTeX. mhchem rides along, so `\ce{H2O}` works — and it is load-bearing rather than a bonus: the math render callback lives inside mhchem's load, so dropping it would silently kill all math, not only the chemistry.

KaTeX is the only optional renderer in the tree.

## Tables

Inside a table, **Enter** adds a record, **Shift+Enter** breaks a line within the cell, and **Tab** moves to the next cell. A wide table scrolls inside its own frame rather than pushing the page sideways.

## Folding

Click a heading's gutter to fold it. Everything down to the next heading of the same or a higher level collapses.

The fold lives in an overlay layer, never inside the document itself, so **the stored markdown does not change when you fold**. Fold state is remembered per entity and field in your browser and comes back on reload.

A document that opens with a level-one heading matching the record's name, ignoring case and spacing, hides that heading on the entity page, because the page title above it already says it. The heading stays in the markdown and in every export. Rename the record and the heading shows again.

## The dash rail

A document with three or more headings grows a minimap down its edge: one dash per heading, longer for higher levels, a tracker that follows the scroll. Click the rail and the minimap widens in place into a panel of headings — same spot, same left edge; click a heading to jump, press Escape or click away to close. Below three headings a map explains nothing, so no rail appears.

## Full screen

Any document opens full screen from its frame, and markdown editing works there exactly as it does in the panel. That is where a long document is worth writing.

## Kinds

A document field carries a `kind`: `markdown` (the default), `html`, or `code`. The declared kind rules how the entity page renders the document — an `html` field runs in its frame with the `</>` source toggle, a `code` field edits directly in the monospace code box — and a field that declares nothing falls back to sniffing its content: a complete HTML file runs as an app, a mermaid source draws as a diagram with the same `</>` source toggle, a JSON model edits in the code box, and anything else is markdown. The source toggle is a button: Tab reaches it, Enter and Space work it, it reports whether the source is showing, and it reads "Hide source" while the source is up. Pressing it puts the caret straight in the source box, and pressing it again returns the drawing and the focus to the button. A `code` document is what the `Workflows` registry's `Script` column uses — a document that is a program rather than prose.

## Getting it back out

```bash
weave doc get Task#5 --field Spec
weave doc export Task#5 --format md   --out spec.md
weave doc export Task#5 --format html --out spec.html
weave doc export Task#5 --format pdf  --out spec.pdf
```

Or by URL: `/e/<id>/doc/<Field>.md`, `.html`, `.mmd`, `.pdf`. The whole entity downloads as one file from the entity page.

The PDF writer is in-tree and embeds DejaVu, so accented text, Greek, arrows and box-drawing survive the trip. The standard PDF fonts cannot carry those, which is why the fonts are embedded rather than named.

## Written by an agent, read by a person

An automation can append to a document on a state change, with `{{Name}}` and `{{Today}}` filled in from the record. `{{Today}}` and date fields print the way the grid prints dates (Oct 6, 2026); `{{Today:iso}}` prints 2026-10-06 for a script to parse:

```json
{ "type": "append-doc", "text": "---\n\n✅ Completed on {{Today}}." }
```

What lands is markdown, in the same document a person is editing, folding and exporting. There is no second class of content.

Worked examples of every construct on this page live in [[table:Formatting]], one record each.