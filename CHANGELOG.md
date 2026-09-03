# Changelog

weave's tracker (the Development space in the weave workspace) is the changelog of record — every Feature and Issue row carries its evidence. This file is the release-notes digest.

## Unreleased
- **Formula authoring gets a check step**: `check()` validates an expression statically — syntax, function names, field references — and the engine refuses to save one that fails, including a formula that references its own field. `weave formula check`, `POST /api/tables/:id/formula-check` and the `weave_check_formula` MCP tool run the same check and preview the computed value on a real row, so the loop for a human and an agent is identical: check until `ok: true`, save, read a cell back. The script editor shows the verdict live while typing (red parse error, or `= value` from row 1), function chips land the caret inside the parens, and the field being edited no longer offers itself as a chip.
- **Icons move** : the icon set is Lucide (595 names) carrying movingicons.dev motion — an icon plays once when the page loads, once when the picker scrolls it into view, once per hover, never on a loop. The value form is `lucide:<name>`; every `iconly:<name>` stored before 2026-09-02 resolves to its Lucide twin through `public/icon-registry.js`, so nothing migrates. Fourteen state marks (✓ ✕ ★ ! ? ▶ ⏸ ⊘ ⚑ ◎ ⛓ ⌁ → +) draw as their Lucide twins; the six progress rings stay hand-drawn, re-inked to the same stroke. Rebuild the set with `scripts/build-lucide-moving.mjs`.

## v0.4.4 — 2026-08-31

- **Development sync** (#152): every build ships `docs/development.json` — the canonical Issue + Feature lists exported at release by `scripts/export-development.mjs` — and `weave serve` applies it to the local docs workspace on boot. Updating weave now updates the known/resolved issue list and the roadmap; locally filed rows are never touched (match is by name). `test/development-sync.test.mjs` pins the manifest to the package version.
- **Workspace delete** (Issue #122): `DELETE /api/workspaces/:ref` + a hold-to-confirm action on the workspace page. The `.db` (with WAL/SHM) moves to `<dataDir>/trash/` — recoverable, invisible to the hub's scan. The default and weave docs workspaces refuse.
- **A fresh workspace explains itself** (Issue #123): hub-created workspaces open with a description naming the first steps and what the Workspace registry space is.
- **The registry registers itself** (Issue #126): the system Workspace space and its four tables are rows in Spaces/Tables like everything else — the registry now means its own description. Deleting or repurposing those rows is refused; columns cannot be added to system tables through the Fields registry.
- **Percent means percent** (Issue #127): number fields with the percent costume follow the spreadsheet convention — stored fraction, displayed ×100 (0.325 → "32.5%"), input ÷100. Existing percent values migrate ÷100 once on first open, so every cell reads exactly as it did.
- **Formula chips insert parseable tokens** (Issue #128): a field chip inserts `[Due Date]` when the name needs bracketing (spaces, punctuation, keywords, function-name collisions) and the bare name only when it is a safe identifier.
- **Shift+Enter is save-and-create-another from inside a row** (Issue #125): the cell commits, the new row's Name cell takes focus.
- **Empty-schema banner gone** (Issue #124): "This table has no fields beyond its name." read as breakage, not help.

## v0.4.3 — 2026-08-28

- **Target-set (polymorphic) relations** (#150): one relation field may target SEVERAL tables — `targetDbs` — including the registry's `Workspace/Spaces` and `Workspace/Tables`, so a row can point at a space or a table as easily as at another row (a bug scoped to a whole space, a dependency on an entire workstream, an agenda mixing rows with structure). One-way by design (no inverse spray); lookups/rollups keep the single-target contract; filters traverse per-row; chips carry their home table; the picker searches every member; the relation map draws one edge per member. Rollback-safe: singleton relations are bit-for-bit unchanged, and removing multi-target fields restores the pre-feature shape exactly.

## v0.4.1 — 2026-08-21

- **Skeleton loading** (#49, inspired by 0xGF/boneyard): navigation paints a skeleton of the real destination — natively, the library being framework-bound.
- **Share QR codes** (#50, inspired by p2r3/ha.mr): sharing a view shows a scannable code beside the copied link (lean-qr 2.7.3 vendored; `.mjs` MIME fix included).
- **Simultaneous boots survive** (Issue #39): `busy_timeout` now precedes the WAL switch.

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

