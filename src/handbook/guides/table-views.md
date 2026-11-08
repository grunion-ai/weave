# Table views

A table can be read several ways. Each **view** keeps which columns show, their order and widths, frozen columns, filters and sorting. Open the button bearing the current view's name to choose another. The **first** view in the menu opens with the table, and its row says **Opens first**. A new table's first view is named **Standard**; views you add are offered **View 2**, **View 3** and so on. A table always keeps at least one view.

## The toolbar

The controls sit beside the breadcrumb: **Search → View → Table actions (⋮)**. The three-dot menu is the table menu, the same one the table's sidebar row opens from its ⋮ or a right-click: **Move to space…** and **Duplicate**, **New share page…**, **Forms…** and **Copy create link**, an **Export** section with **CSV**, then **Move to trash**. Rename the table by editing its title, or by double-clicking its sidebar row; add records from the grid.

| Control | What it does |
| --- | --- |
| **Search** | Narrows this table by name, public id or text. Click the visible search box or press **/** when not editing. It searches all pages, combines with filters and preserves sorting. **Escape** clears the search. **⌘K / Ctrl+K** remains workspace search. |
| **View** | Opens the View pane beside the table, and closes it again. Its badge counts the active filters, deleted records included. Closing the pane gives the table the full width. |

## The View pane

The pane holds the view picker at the top, then five sections. One section is open at a time. Each header shows its current value, and turns blue when the view differs from the system default. **Reset view** and **Clear all** sit at the foot. Every change saves into the current view at once.

| Section | What it does |
| --- | --- |
| **Filters** | Narrows records by workflow states, toggle labels and single-select or multi-select options, and holds the **Include deleted** switch. Deleted records show struck through and never count toward a total. |
| **Sort** | Up to three levels: primary, secondary and tertiary. Each level has a field, a direction worded by type, move up, move down and remove. Records that tie on every level fall back to **#**. Empty values sort last in both directions. |
| **Group** | Up to five nested levels, in Table and Board layouts. Each level has a field, an order, move up, move down and remove. **Collapse all** and **Expand all** fold every group. Empty values gather under **No value**, listed last. A record with several values in a multi-select appears under each one, and every total above that level counts it once. In Board layout the section also holds **Completed by**, and an unfiltered view shows every option of the group field, empty or not; **Hide empty groups** leaves out the groups with no records. |
| **Fields** | Shows, hides and reorders columns, with a **Group n** or **Sort n** tag on a field in use; opens the field tray to add a field. |
| **Display** | **Layout** (Table or Board layout), **Density** (Compact, Comfortable or Spacious; table records are 32, 44 or 72 pixels), the **Σ Rollups** switch, **Subtotals** (Every level, Top level, None) and the aggregation for each column. |

A field sits in Sort or Group, never both: grouping by a sorted field takes it out of Sort, and the Sort section says so. Groups order the records first; the sort levels order the records inside each innermost group. A collapsed group keeps its header and its subtotal, so collapsing every group turns the table into a summary. Hiding a grouped field keeps its group headers. A nested group header shows the groups above it, muted, before its own field and value, and the top-level header stays pinned under the column headers while its rows scroll. With **Σ Rollups** off, each header also shows a short breakdown of the first single-select or workflow field not grouped at or above it; with rollups on, the subtotal rows carry the numbers. Collapsed groups belong to the grouping: every view of the table with the same group fields, in the same order and directions, opens with the same groups collapsed. Changing the group fields or their order opens every group again, unless another view already uses that grouping.

A subtotal row shows the group's live record count and, for each column, the aggregations picked in Display. The server computes them; an agent reads the same numbers from `weave_query` with the view, in its `groups` and `groupTotal`.

On a phone the sliders button keeps the table menu: View, Density, Fields, Filters, Group and Sort, with the same sort and group levels.

Search is temporary: it is not saved into a view or shared with other people, and leaving the table clears it.

## Board layout

The Board layout displays each record as a card. Groups can sit side by side as columns or stack vertically as a gallery. Collapse a group with its chevron: a column becomes a narrow rail with its label and count; a stacked group keeps its header. The view remembers these folds. Two grouping levels in a side-by-side layout produce columns and collapsible swimlanes. A stacked layout nests them instead: each level gets its own header and count, and the cards sit in the innermost group.

Density changes the padding and spacing inside cards. Picture size remains a separate setting. Hover or focus a card to pick it for comparison; the checkbox has its own space beside the title. Drag a card into a group to change its grouped value, then use Undo to restore it.

**Completed by** names a checkbox or toggle field. Ticked cards leave their group for **Completed · N**, folded until you open it. Each column draws its first 40 cards and ends with **Show 40 more**, which adds the next 40 in place (Issue #1266).

A relation block uses the Board layout when the linked table's first view selects it. It shows only linked records, honors the relation's field and filter settings, and keeps New, Link existing and Unlink actions. Its collapsed groups stay local to that entity in the current browser tab. Group changes edit the linked record without leaving the entity; hand ordering remains in the full table view.

## Managing views

| You do in the view picker | What happens |
| --- | --- |
| Select a view | Opens its saved layout, filters and sorting. |
| Drag a view by its handle | Reorders the list; a dashed placeholder opens where it lands. Drop it first to make it open with the table. With a finger, press and hold the handle to pick it up. |
| **Alt+↑** / **Alt+↓** on a focused view | Moves it one place. |
| Hover or focus a view | Shows its **Rename**, **Duplicate** and **Delete** buttons. There is no right-click menu. |
| **Rename** | Edits the name in place. **Enter** or clicking away saves; **Escape** cancels. |
| **Duplicate** | Adds a record under the view with its name focused (`Open bugs 2`). **Enter** or clicking away creates the copy and opens it; **Escape** drops the row. |
| **Delete** | Hold the button until it fills. The last view cannot be deleted. |
| **+ Add view** | Adds a record with its name focused, offered as the next free **View N**. **Enter** or clicking away creates the view from the system default that **Reset view** restores, and opens it; **Escape** drops the row. The pane stays open throughout. |
| **Reset view** | Returns the view to the system default: a Table with no grouping, every regular field in schema order with the table's default system columns, no filters, sorting, search, custom widths or frozen columns, no deleted records, no Σ rollup row, and Comfortable density. **+ Add view** starts from the same default. The view keeps its name. |
| **Clear all** | Removes filters, deleted records, search, sorting and grouping while keeping the column layout and density. |

A view's link is `#/table/<table>/view/<view id>`. An old `…/view/blank` link still opens the raw table, read-only. Choose **+ Add view** to make an editable view.

## Fields

Click a field's visibility control to show or hide its column. **Show all** and **Hide all** apply to the whole list. Drag the grip at a field's right edge to move it; a dashed placeholder opens where it will land and the other fields slide aside. With the grip focused, **↑ / ↓** moves it one place. System columns such as Created At use the same controls.

These changes save into the current view. Hiding a column does not delete its data. **New field** opens the same field tray as the **+** at the end of the grid's field headers. Deleted records moved to the **Include deleted** switch in Filters, and the Σ row to **Σ Rollups** in Display; each saves into the current view, so another view keeps its own.

## Filters

Open **Filters** in the View pane and tick options under a workflow, toggle, single-select or multi-select field. Each tick applies at once and saves into the current view; the pane stays open as results update. Untick an option to remove it. Several options in one field include any of them, and filters on different fields must all match. A multi-select record matches when it has any ticked option. A field with nothing ticked adds no restriction. The footer counts what is left as **X of N**, in the table's own word for its records (`7 of 413 bugs`): X after the filters and the search, N every record that is not deleted.

**Clear all** removes all filters from the view while keeping search, sorting and column layout. If the table has no workflow, toggle or select fields, the popover offers **New field**, opening the usual field tray.

## For agents

One tool, `weave_table_view`, addressed by name. `{view: "Issue"}` lists the views in order, and the first view opens with the table (a new table's first view is `Standard`); `position: 0` makes a view the default (`default: true` is the older spelling of the same move). `{view: "Issue/Open bugs", fields: ["Name", "Status"]}` defines a view, where the list is the visible columns in order and anything left out is hidden. `show`, `hide` and `move` edit one field at a time, so a wide table is never resent. `search` is the table search box's text for the view (`''` or `null` clears it); pass it to `weave_query` as `search` to read the records the grid shows. `widths` sets column widths by name (`{Name: 240}`, merged; `null` clears one) and `frozen` says how many leading fields stay frozen beside # (0, the default, freezes only #); `density` is `compact`, `comfortable` (the default) or `spacious`; `deleted: true` shows the trashed records in place, and `rollups` is `true` or `false` for the Σ row (`null` follows the table); a read carries each only when it is set. `layout` is `table` or `board`; a read carries it once someone has chosen one, and `null` clears the choice. A view takes `group` (up to five levels, each a field name or `{field, heading: "chip", order: "az", grain: "week"}`; a read leaves out the defaults), `completedBy` (a checkbox, on the Board layout), `collapsed` (group paths such as `"Japan › P1"` and `"Completed"`), shared by every view of the table with the same group levels, `hideEmpty` (`true` leaves out groups with no records) and `order` (the manual order as record #ids); `null` clears any of them. The same verb is `weave table view` on the CLI and `/api/tables/:table/views/:view` over REST, and every view is a record in **System/Views**, where editing `Fields`, `Filter`, `Sort` or `Search` runs the same checks.