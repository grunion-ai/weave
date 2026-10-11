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
| Table | | Move to space…, Duplicate | Share…, New share page…, Forms… (architects), Copy create link | CSV | Delete table |
| Record (decks too) | | Duplicate | Share… | Markdown, HTML, PDF | Move to trash |
| Document section | | | | Markdown, Mermaid, HTML, PDF | |
| Space | | | | | Delete space |
| Share page | | | | | Delete view |
| Workspace | | | Link preview before sign-in (switch) | | Delete workspace… |
| Field (column header) | Field settings… | Insert field… | | | Delete field |

Share… keeps its current place while its redesign is parked. The delete rows keep today's behaviour until the trash-with-Undo stage lands.

## Triggers

| Kind | Triggers |
| --- | --- |
| Table | the header ⋮ (Table actions), a right-click on the table header, the sidebar row's ⋮, a right-click on the sidebar row |
| Record | the header ⋮, a right-click on the record header, the same two in the dock |
| Document section | the section's ⋮, a right-click on the section head |
| Space | the header ⋮, a right-click on the space header, a right-click on its sidebar row |
| Share page | the header ⋮, a right-click on its header, a right-click on its row on the workspace page |
| Workspace | the ⋮ on the workspace page, a right-click on its header, a click on the current workspace's rail chip, a right-click on any rail chip |
| Field | the column ⋮, a right-click on the column header |

A menu opened away from its object (a sidebar row, a right-click, a rail chip) starts with a head row naming the object and its kind. A right-click on a text field, the title input or a breadcrumb link keeps the browser's own menu.

## Export

`exportSection({ name, serves, href })` builds rows from one registry in one order: Markdown `.md`, Mermaid `.mmd`, HTML `.html`, PDF `.pdf`, CSV `.csv`, JSON `.json`, filtered to the formats the object serves. Each row's label is the format name and its extension sits in the hint slot. Export is an inline labelled section, never a submenu.

## What stays out of menus

- View actions belong to the toolbar: Stats, Fields, Sort, Activity, Show or hide fields.
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
