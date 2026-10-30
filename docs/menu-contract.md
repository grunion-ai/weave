# Menu contract

Every action menu in weave follows one framework (Feature #296). This page states it for anyone adding or changing a menu.

## Principle

One builder draws every action menu, and each object kind has exactly one menu definition. Every trigger for an object opens that definition. Context may hide a row that cannot work in that place. It never adds a row and never reorders a section.

## The pieces

| Piece | Where | Job |
| --- | --- | --- |
| `menuCore.plan` | `public/menu-core.js` | Orders rows into sections, drops empty sections, refuses a row without a known section and refuses a second delete row. |
| `menuCore.definition(kind)` | `public/menu-core.js` | The row ids each kind may show, per section. |
| `menuCore.assemble(kind, rows)` | `public/menu-core.js` | Lays out a kind's rows in definition order. It drops rows passed as `null` and refuses any id the definition does not list. |
| `menuCore.exportSection` | `public/menu-core.js` | Builds Export rows from the one format registry. |
| `MENU_ROWS[kind](obj, ctx)` | `public/app.js` | Builds the live rows for one object: labels, runs, links. |
| `menuFor(kind, obj, ctx)` | `public/app.js` | `assemble(kind, MENU_ROWS[kind](obj, ctx))`. Every trigger calls it. |
| `trashRow({ remove, restore, after, undone })` | `public/app.js` | The one delete row every kind uses: **Move to trash**, then a **Moved to trash** toast whose **Undo** calls `restore`. |
| `menu(items, opts)` | `public/app.js` | Draws the panel: the desktop popover or the phone bottom sheet. |
| `kindDots`, `kindContext` | `public/app.js` | The ⋮ button and the right-click listener for a kind. |

## Sections

Sections run in a fixed order with a thin separator between them. Only Export shows a label.

1. **Settings**: one row, `<Kind> settings…`, only for a kind whose settings live in a dialog with no inline surface. Today that is the field (column header), whose row is **Field settings…**.
2. **Organize**: Move, Duplicate, Insert.
3. **Share**: links, share pages and workspace link settings.
4. **Export**: formats from the registry.
5. **Delete**: last, one row.

## The kinds

| Kind | Settings | Organize | Share | Export | Delete |
| --- | --- | --- | --- | --- | --- |
| Table | | Move to space…, Duplicate | Share…, New share page…, Forms… (architects), Copy create link | CSV | Move to trash |
| Record (decks too) | | Duplicate | Share… | Markdown, HTML, PDF | Move to trash |
| Document section | | | | Markdown, Mermaid, HTML, PDF | |
| Space | | | | | Move to trash |
| Share page | | | | | Move to trash |
| Workspace | | | Link preview before sign-in (switch) | | (none, Feature #297) |
| Field (column header) | Field settings… | Insert field… | | | Move to trash |

Share… keeps its current place while its redesign is parked.

## Delete

Every delete row is `trashRow`, labelled **Move to trash** with a **HOLD** hint. Holding the row until its fill sweeps across moves the object to the trash and raises a **Moved to trash** toast with **Undo**; a click deletes nothing (Feature #346). Undo calls the kind's restore route and puts the object back where it was.

| Kind | Trash | Undo | Back where it was |
| --- | --- | --- | --- |
| Table | `DELETE /api/tables/:id` | `POST /api/tables/:id/restore` | its place in the sidebar; reopens if it was open |
| Space | `DELETE /api/spaces/:id` | `POST /api/spaces/:id/restore` | its place in the sidebar, with its tables; reopens if it was open |
| Record | `DELETE /api/entities/:id` | `POST /api/entities/:id/restore` | its page, or its grid row from the dock |
| Share page | `DELETE /api/views/:id` | `POST /api/views/:id/restore` | its row on the workspace page; reopens if it was open |
| Field | `DELETE /api/tables/:table/fields/:field` | `POST /api/tables/:table/fields/:field/restore` | its column, with its values |

The multi-select toolbar trash is a hold too, uses the same verb, `TRASHED`, and the same Undo; its toast adds the count.

Every other control that sends a DELETE is a hold as well: Delete workspace in Settings, Revoke on a share link and on an invite, Delete link in the Share panel, Remove logo, the Views list delete and Delete forever. `test/menu-contract.test.mjs` counts the DELETE call sites in the app and fails until a new one is a hold.

A hold is for permanent delete only. The builder keeps `hold: true` rows for it, and no kind's definition uses one. **Delete forever** lives in Settings (`#/settings`, Feature #295): a typed name arms the builder's hold row, and the Trash page only restores.

Workspace delete lives in Settings beside it (Feature #297), behind the same typed name and hold, and no menu carries it. `DELETE /api/workspaces/:id` trashes a workspace and the Trash page restores it.

## Triggers

| Kind | Triggers |
| --- | --- |
| Table | the header ⋮ (Table actions), a right-click on the table header, the sidebar row's ⋮, a right-click on the sidebar row |
| Record | the header ⋮, a right-click on the record header, the same two in the dock |
| Document section | the section's ⋮, a right-click on the section head |
| Space | the header ⋮, a right-click on the space header, the sidebar row's ⋮, a right-click on its sidebar row |
| Share page | the header ⋮, a right-click on its header, a right-click on its row on the workspace page |
| Workspace | the ⋮ on the workspace page, a right-click on its header, a click on the current workspace's rail chip, a right-click on any rail chip |
| Field | the column ⋮, a right-click on the column header |

A menu opened away from its object (a sidebar row, a right-click, a rail chip) starts with a head row naming the object and its kind. A right-click on a text field, the title input or a breadcrumb link keeps the browser's own menu.

## Export

`exportSection({ name, serves, href })` builds rows from one registry in one order: Markdown `.md`, Mermaid `.mmd`, HTML `.html`, PDF `.pdf`, CSV `.csv`, JSON `.json`, filtered to the formats the object serves. Each row's label is the format name and its extension sits in the hint slot. Export is an inline labelled section, never a submenu.

## What stays out of menus

- View actions belong to the toolbar: Fields, Sort, Activity, Show or hide fields.
- Click-to-edit belongs in place: a title, an icon, a workspace logo, a table name (double-click its sidebar row).
- Copy link belongs to the header permalink button, which shows on a phone and in the dock.
- A deck's download, composed model and new version controls are buttons on its panel.

## Phone

Under 600px the same `menu()` draws a bottom sheet with 44px rows, using the picker sheet rules. Same rows, same order as on a desktop.

## Keys

Focus lands on the first row. Arrow Up and Down, Home and End move; typing jumps to the next row that starts with the typed letters; Escape closes and hands focus back to the trigger; Tab closes. Rows carry `role="menuitem"`, switch and check rows `role="menuitemcheckbox"`.

## Adding a menu or a row

1. Add the row id to the kind's definition in `public/menu-core.js`, in the right section, and extend `test/menu-core.test.mjs`.
2. Build the row in `MENU_ROWS[kind]` in `public/app.js`. Return `null` where it cannot work.
3. For a new kind, add its definition, its `MENU_ROWS` entry and its triggers through `kindDots` and `kindContext`, then add it to `test/menu-triggers-browser.test.mjs` with every trigger.
4. Never build a `role="menu"` panel outside `menu()`; `test/menu-contract.test.mjs` refuses it.
