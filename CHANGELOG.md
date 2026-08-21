# Changelog

weave's tracker (the Development space in the weave workspace) is the changelog of record — every Feature and Issue row carries its evidence. This file is the release-notes digest.

## v0.4.0 — 2026-08-21

### The agent-native meta-model
- **The workspace's structure, as rows** (#12): a `Workspace` system space holds `Spaces`, `Tables` and `Fields` registries — real entities synced both ways by the engine's own verbs. Create a row, get a space/table/column; rename the row, the real thing renames; custom fields (a workspace logo, an owner) ride structure for free.
- **Every field is a row** (#52): the Fields registry is the schema surface, carrying each column's shape as a `field`-type Definition (#85 — entity page as the control surface, `materializeField`).
- **The schema as a document** (#13): `weave schema export/apply` — edit the JSON, the workspace grows to match; deletions need `--allow-destructive`, type changes never apply.

### Identity, audit, and the road to hosting
- **Every change names its actor** (#65): createdBy/modifiedBy + per-table system columns (Created/Modified At/By, Activity #95); server X-Weave-Actor, CLI WEAVE_ACTOR/OS user, MCP client name.
- **Accounts, roles, audit** (#14): admin/writer/reader tokens (sha256 at rest, handed out once), requireAuth for the hosted future (#84, v0.5), a durable audit log of structural change.
- **The key field type** (#64): secrets live in a chmod-600 keystore, never in workspace data; set over HTTP, never readable back.

### Views
- **Filters** (#38, closes the oldest issue #2): workflow-state chips driving the engine's where-language server-side.
- **Side peek** (#39, #48): rows and activity entries open beside the page, not instead of it.
- **Saved views + share links** (#17): named blocks resolved live; sharing mints a revocable capability URL that outlives the auth wall.
- **The workspace page** (#51): its own shape as a read-only mermaid map; **record nouns** (#40).

### Typed values
- **Number costumes** (#97): format/unit/decimals/separator, display-only, formulas keep raw numbers.
- **The date system** (#44): iso/us/eu/long + time costumes, date math in formulas (dateadd, datediff, year/month/day, now), and a type-or-pick cell that reads "next friday".

### The editor, completed
- **Syntax highlighting** (#35): the slash menu seeds a language; rendered pages load vendored highlight.js on demand.
- **Live `[[…]]` chips in the editor** (#86): an overlay decoration over Vditor's IR — Lute owns the text, weave never mutates it; literal under the caret.
- **Outline dash rail** (#87) and **collapsible headings** (#88): a minimap with a place tracker; folds are view state (content byte-identical), persisted per document.
- **The row editor** (#89): one shared Vditor instance mounts into the focused row (2ms warm) — and the icon-sprite leak `destroy()` misses is fixed.
- **Math** (#90): KaTeX 0.16.47 vendored (with mhchem — load-bearing); the heavier diagram engines stay out, documented.

### Operations
- **Service management** (#54): `weave service install|status` (launchd), health with startedAt/uptime, instance status in the nav.
- Hygiene: mermaid 11.17.0 (XSS advisories, #8), MCP version honesty (#19), qualified relation refs (#21), board title ellipsis (#20), activity coalescing (#32), webhook test deflaked (#27).

Slipped to v0.5 (recorded on their tracker rows): #84 hosting, #16 attachments field type, #46, #47, #49, #50, PDF non-WinAnsi glyphs (Issue #4).

