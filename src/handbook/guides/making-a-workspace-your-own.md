# Making a workspace your own

Two tables holding the same records can read completely differently. This page is the surface that decides which one you get: the chrome, the costumes, the grid, and the views.

Everything here is reachable from the UI, the CLI, REST and MCP. The **Configuring a space, first time right** guide is the same surface written for an agent standing up a space without a browser; this one is written for whoever has to read the result.

## The workspace

```bash
weave workspace set --name "Acme" --description "Everything we owe someone"
weave workspace logo --path ./acme.png
weave workspace require-auth
weave workspace link-preview        # or --off
```

The name and logo ride the icon rail on the far left, which is how you switch between workspaces served side by side at `/w/<name>/`. The weave mark stays pinned at the top; below it the chips run in the order this browser last opened them, newest first, with the workspace you are in always first. Every workspace page load moves that workspace to the front of a `wv_recent` cookie (fifty names at most, the same domain, path and lifetime as `wv_rail`), and `GET /api/workspaces` answers in that order, with workspaces the cookie does not name after them in their usual order. Right-click any chip (or click the current one) for the workspace menu, the same one the **⋮** on the workspace page opens. It holds one record, **Delete workspace…**, and shows only where you may delete that workspace, so a workspace you cannot delete has no ⋮ and its chip opens no menu. **Settings**, which the personal menu opens (the **⋯** beside your name at the foot of the sidebar), lists the same workspaces with **Delete…**. Either way a **Delete workspace** dialog opens. Type the workspace's exact name and its **Delete workspace** button turns on; **Cancel**, Escape or a click outside closes the dialog with nothing deleted. Deleting a workspace is permanent from your side: it leaves the rail for everyone, its address and links answer 404, there is no **Undo** and Trash never lists it. Delete the workspace you are in and weave opens the next workspace on the rail; delete your last one and you land on the `weave` workspace as an Observer. `DELETE /api/workspaces/<id>` does the same. The hub keeps the file behind a tombstone that only the operator can restore (`POST /api/workspaces/<id>/restore`). Delete shows only to an Architect of the workspace being deleted, the right the route checks; the `weave` docs workspace and the last live workspace cannot be deleted. **Click the logo** at the left of the workspace page's title to pick an image, whether or not the workspace has one yet; **Remove logo**, the small **×** beside it, clears it. The theme toggle is light, dark, or follow the system, and every surface — chips, code blocks, diagrams, the relation map — is drawn in both.

## Deleting

Every menu deletes the same way: **Move to trash**, held until its fill sweeps across, for a table, a space, a record, a share page or a field. A click deletes nothing. The message it raises says **Moved to trash** and carries **Undo**, which puts the thing back where it was: a table or a space in the sidebar, a record on its page, a share page on the workspace page, a field at its column. The selection bar's trash says the same and undoes the same. Nothing in a menu or on the Trash page deletes for good; the Trash page restores. **Delete forever** lives in **Settings**, which the personal menu opens (the **⋯** beside your name at the foot of the sidebar): choose it on a record, type the record's name, then hold the button until it fills. An observer sees the list without the button.

## The space

A space is the unit of meaning in a workspace: it groups the tables of one area, such as Contact, Company and Deal in CRM. You address a table by space and table name, so CRM/Deal is the Deal table in CRM. Spaces never nest. Make a new space only when you have a table whose area no existing space covers. The Σ under a grid column is a rollup on the space's record in System/Spaces. A space's schema version rises when its structure changes, so an agent can ask for only what changed. Mark a space as a template and weave_template_use copies its schema into another workspace.

## Sharing a link

Every record, table, space and workspace has a permalink built from its id, so a rename never breaks it: `/e/<id>` for a record, `/t/<id>` for a table, `/s/<id>` for a space and `/w/<ws>/` for the workspace. A record, table or space link names no workspace: on a workspace host such as `net.weave.grunion.ai` the host names it, and anywhere else the link opens in whichever workspace holds that id. Links that do carry `/w/<ws>/` (`/w/<ws>/e/Issue%23287` too) keep working. The ⧉ beside a record's `#id`, a table's title or a space's title copies it.

The same record permalink comes back as `url` from every door: the API, MCP, the CLI, chips and cards, search hits and the bug reporter. It works as input too. Paste a record's link, with or without the origin, its `/e/<id>` path or its bare id into search or ⌘K and that record comes first; pass it to any API, MCP or CLI call that names a record and it names that record.

Paste one into Slack, Messages or an email and it unfurls: the workspace logo (the weave mark when the workspace has none, or only an SVG one), the record's table, `#id` and name as the title, the path `weave › Development › Issue` on the first line and the state and the first fields on the next (`Status Fixed · Severity Medium`). The browser tab reads the record before the app has loaded. Opening the link lands on the record, and Back leaves in one step.

On a workspace with `requireAuth` on, a link fetcher is signed out, so by default it gets the sign-in redirect and the paste shows a bare URL. **Link preview before sign-in**, a switch on the **Settings** page (`weave workspace link-preview`, or `PATCH /api/workspace` with `{"linkPreview": true}` and an architect token), lets a signed-out request for a uuid permalink read the preview head: title, path, `#id`, name, logo, state and the first fields. Nothing else leaves: no document, no other field, no API. An unknown id and a `Table#n` address, which anyone could count through, are walled like any other page. The person who opens the link still signs in first. It is off on every workspace until an architect turns it on.

**Prefilled create links.** `/w/<ws>/t/<id>/new?<Field>=<value>&…` opens the new-row form for that table with those fields filled in. Nothing is saved until you press **Save**, so a link on another page cannot add rows. Values are read the way the API reads them: a select takes the option's name, a relation takes the target record's Name, and a repeated key fills a multi-select or a many relation (`Tags=ai&Tags=ops`). A field the table does not have, or a computed one, is left out and named at the top of the form, and so is a value that matches no option or record. Each value is cut to 1,000 characters and the whole query to 2,400, so the link survives sign-in: a signed-out visit signs in and lands on the filled form. **Copy create link** in the table's ⋮ menu copies the link with the values the current filter gives a new record; the button of the same name in the form copies a link carrying what you have filled in so far.

## Share links

The **Share** up-arrow in the header of every workspace, space, table, record and share page opens the one docked **Beta** panel beside the page; no menu row or dialog shares. **Existing access** lists links with preview, copy, edit and delete icons. **Add link** creates a public read link, or a submission link on a table. Selected entries fix the read scope to those entries; with nothing selected, the whole current table, space or workspace is shared, or the one record or share page you are on. Filters hide records in a view but do not narrow table access. Container links include every field. Selected-entry links omit related and computed fields to keep neighboring records private.

**Expires** offers one hour, one day, seven days, thirty days, ninety days, a custom future date, or **Never**. Editing expiration keeps the address. **Regenerate link** preserves the grant and replaces its credential; the previous address stops working immediately. **Delete link** revokes it. Expired and deleted links remain visible for review. Dedicated HTTP links use the workspace UUID and an opaque token, with no username in the path; renaming a workspace or link does not change access.

**Submit a new entry** makes a form from the table's supported writable fields. Anyone with its live link can submit without signing in. The link cannot read existing entries, change them or delete them. Preview shows the same form with submission disabled. Repeated delivery of the same submission is deduplicated; expiry, deletion and regeneration are checked again before a write, including retries. The form's ordinary id-based address cannot bypass the share link.

Recipients can select a saved table view and temporarily change search and name sort. Reset restores the saved settings. These controls never save view changes; this beta renders saved views as tables.

Email and domain restrictions, automatic observer membership, and comments by public link are deferred in this beta. Existing private links still require an existing signed-in workspace member. Legacy edit and manage grants remain available through the API, CLI and MCP.

| Access | What the link can do |
| --- | --- |
| Read | open the pages under the link, and read the records in scope through the API |
| Submit | create through the configured form without reading existing records |
| Comment | reserved: shown but not offered until comments by share link are built |
| Edit records | read, and change the values and documents of records in scope |
| Add and delete records | edit, add records to a table in scope, and move records in scope to the trash |

No link changes a field, a table, a space or a registry record, and none purges a record. Pages under `/s/<token>` open read-only whatever the access: a record opens as its fields and documents, a table as its records under the columns its schema names, a space as its tables. Edit and add-delete work through the API and MCP, with the link's token as the bearer:

```bash
weave share mint table Dev/Task --mode edit --label "vendor sync"
weave share list --kind table
weave share revoke <share id>
curl -H "Authorization: Bearer wvs_…" https://<host>/api/share
```

`GET /api/share` answers what the token reaches. A record or table outside the scope answers 404, and a route no link reaches answers 403. **Signed-in members only** makes the link private: it opens only in a browser signed in to the workspace. An architect makes, lists, renews and revokes links; a link passes the wall, so minting one is a publishing decision, and editors and observers do none of it. An API or CLI link defaults to thirty days unless an architect chooses an expiration preset or renews it for thirty more on the same token (`weave share renew <id>`, `weave_shares` renew, `POST /api/shares/<id>/renew`), or names its own expiry when minting. Every mint, renew and revoke lands in the audit log with its actor (`weave_shares` over MCP, `POST`/`GET`/`DELETE /api/shares` over HTTP).

The CLI also accepts `share update <id> --expiry 7d` and `share regenerate <id> --expiry never`. MCP `weave_shares` exposes the same `update` and `regenerate` actions. REST uses `PATCH /api/shares/<id>` and `POST /api/shares/<id>/regenerate`; `GET /api/shares?includeInactive=1` includes expired and revoked grants. Labels and expiration can change; a grant's scope and purpose stay fixed.

The token is stored with the grant so the panel can show the link again, and `weave export` leaves it out: an imported grant opens nothing until someone mints a new link. Revoking is how a link ends. A saved view shared before share links existed keeps its old address: `/view/<token>` redirects to `/s/<token>`.

## The home page and a space page

On a local instance, the first time you open an empty workspace, a short welcome asks you to name the workspace (a default is filled in), then offers a starter or an empty workspace. **Skip setup** or Esc keeps the defaults. It runs once per person, and an existing workspace with tables never shows it; rename the workspace later from its chip in the rail or its page title.

Architects opening a workspace with no tables of their own see a **New table** button and three templates (**Money**, **Work**, **People**). The system **Workspace** space (**Spaces**, **Tables**, **Fields**, **Views**, **Workflows**, **Workspaces**) doesn't count as yours.

**New table** asks for a name and a space, offering **General** if you have none. A template builds its space, tables, fields and a few sample records in one build call, and opens its first table. **Money** links each transaction to an account and a month, and a **Months** record totals what was **Spent** and **Earned** that month and the **Net** between them; you link the records by hand for now. **Work** gives **Tasks** a status, a due date and a priority. **People** links **Contacts** to **Companies**. The empty state ends with your first table.

Editors and observers see guidance to ask a workspace architect for the first table instead of schema-creation controls. Editors can add and edit records once a table exists; observers can read and comment. Invited members, including architects, skip the creator naming wizard.

Then the home page shows the relation map.

On a desktop or tablet, opening a space lands on one page, computed from what the workspace already holds. It runs from the space's tables and their counts, through the saved views and records you opened recently in this browser, keyed by table name, to the automation runs that changed something here, wherever the automation started. A section with nothing in it disappears. Open a run to see what it changed; a run that stopped partway names the step that failed, where weave recorded it. A run that started in a space you cannot open stays off your list.

**Space overview** at the foot of the page holds the description, the space's rollups, its relation map, its tables with **+ New table** for architects, and the **Schema** disclosure. Opened, it stays open in that browser until you close it.

On both pages the grid (**Spaces** on home, **Tables** on a space page) sits under a collapsed **Schema** disclosure; opened, it stays open in that browser until you close it. Every column is editable in place, including the **Tables** grid's **Field Order**, **Hidden Fields**, **Filter** and **Sort**.

At 600px and below, a space page opens as a launcher under its title and description: a search box for that space's records, one tile per table with its count, your recent views and records, and automation runs that changed records in the space, including runs that started elsewhere. A partial run shows its failed step, and tapping a run opens its details and the records it changed. **About this space** opens the description, summaries and relation map. A section with nothing to show disappears. Add a table on a phone from the sidebar.

## Icons and nouns

A space and a table are born with an icon and can be given a better one:

```bash
weave space update Finance --icon lucide:wallet
weave table update Invoice --icon lucide:file --noun invoice
```

The icon value is **`lucide:<name>`** — one of the names in weave's inventory, Lucide shapes curated for what a space, a table, an option or a state tends to be called (`activity bell bookmark bug calendar chart-bar compass file-text folder funnel heart house layout-grid lock mail map-pin pencil search settings shield-check star trash-2 users wallet` among them; `weave vocabulary icons` lists them all). Most of them move — once when the page loads, once when the picker scrolls them into view, once per hover, never on a loop. A value stored before 2026-09-02 as `iconly:<name>` keeps drawing through a built-in alias, so nothing migrates. An emoji is not an icon: the engine refuses any value outside the inventory (Kyle, 2026-09-02).

The **noun** is what one record is called — the table's *record term*. It lives on the Name field (open the Name column's menu → Field settings… → "Rows in this table are…"), with a curated list to pick from and a plural you can correct. Every surface speaks it: the create control says "New invoice" instead of "New Invoice", the selection puck counts "3 invoices", the trash toggle reads "Deleted invoices". `--noun` on the CLI and `noun` over MCP set the same term.

## The grid reads as a record

The table view is a ledger, not a form. The `#id` link opens the record in the **dock** beside the table; **every other cell edits in place**, raising that field type's own editor with the cursor already in it. A text, number, date or url cell opens with its **whole value selected**, so typing, `⌘C` and `⌘V` act on the value you can see; a second click inside the open cell places the caret. Chips keep their tint and lose their box. A computed cell shows its value alone on a faint gray ground across the whole cell; the glyph lives on the field's name. A computed or relation column marks its header with a superscript (`ƒ` formula, `Σ` rollup, `↳` lookup, `→` relation), and hovering the mark names the route its value travels: `Σ sum of Estimate via Tasks → Product/Task`, `↳ Name via Project → Product/Project`, `→ Product/Task`. A row hover draws no lines between fields; the row's tint is the feedback. The one cell under the pointer shows the control a click would open.

The dock is the entity itself, not a preview: edit there and the table keeps its place, the docked record stays lit, Esc closes it. **Docked is the default pose** (Issue #198): a relation chip, a card, a mention chip in a document, a ⌘K hit and a document chip in a cell all open the entity in the dock beside the table you are reading. **The dock follows the click and the page stays** (Issue #276): a relation hop into another table docks that record beside the table you were on, the grid keeps its place and its filters, nothing lands in the browser history, and the dock's own crumb carries the path taken — Deals › Acme › Contacts › #4 — with a back arrow (or Esc) that walks it one hop at a time. Only from a page with no table under it (home, a space, the activity page) does a hit travel to the entity's table first. The outward diagonal arrows on the dock expand it to the full page (⌘⇧E flips either way); the inward arrows on the page dock it again. The dock keeps every control on its breadcrumb line (Issue #583): the back arrow at its left, the eye, the ⋮, the expand arrows and the ✕ at its right, and that line stays pinned at the top of the pane while the record scrolls under it. Only a `#/entity/…` address opens as the page — the address a new tab, a permalink and the expand arrows land on. ⌘-click a record (or its `#id` link) to give the record its own browser tab. Every navigating surface in weave answers the same three gestures — ⌘/Ctrl, Shift, and the middle button — so an activity record, a ⌘K hit and a node on the relation map open in a tab the same way. Text cells keep their own modifiers: shift-click still extends a selection there. A document chip in a cell opens its entity in the dock.

The window itself never scrolls (Issue #609). The workspace rail, the sidebar, the table and the dock each scroll on their own: the wheel moves the one under the pointer, and a scroll that reaches the end of one stops there instead of carrying on into the next.

## A big table draws only what is in view

The grid holds the rows in view plus a buffer of rows above and below, the buffer running ahead of the direction you scroll, and two spacer rows stand in for the loaded rows outside that window (Issue #271). The records come in pages of 200 in the table's sort and filter order. The scroll reaches only rows that are here: under the last loaded row sits a **Loading more** row with the weave loader, and the next page is asked for while the end of the loaded rows is still three screens below the fold, so scrolling down meets that record and never a blank one (Issue #962). Jumping to a record that is not here yet (End, a new record, a search hit) loads every page up to it first. The foot reads `200 of 2,087 loaded` until every record is here. Sort and filter stay on the server, so page one is the right 200 and the Σ row still reads the space rollups, never the page. A refresh re-reads every loaded record in batches of 400 and swaps them in at once, so scrolling back up after a refresh never waits on a row you already saw (Issue #961). A cell commit redraws at the same scroll.

## Searching everything (⌘K)

⌘K (Ctrl+K on Windows and Linux) or the sidebar's search control opens the palette. A tag at the right of its `Search <workspace name>` box names the current workspace. An empty palette lists Recent: the last eight records and tables opened here, newest first, kept in this browser only. Typing searches this workspace (Issue #1308); another workspace you can open answers by name as a jump target, read from the rail. Matches are grouped with counts: Records (name or `#143` id), In documents (words in a document or text field, with an excerpt), Tables, then Spaces and views; empty groups are dropped. Each match shows a kind icon, its name with your text highlighted, any workflow state chip, and its location on the right (`Task #1`, `Product · table`).

Linking a relation opens the same palette scoped to the relation's target tables (Issue #703): an empty box lists the linked records first, then the table's latest records, and `GET /api/search?tables=<id,...>` is the scoped search behind it.

The footer lists the keys: `↑` and `↓` select, `Tab` and `Shift+Tab` jump between groups, `Return` opens and `Esc` closes. The copy button on the selected or hovered match copies its permalink. ⌘-click or middle-click opens a match in a new tab and leaves the palette open (Issue #382).

## Searching a table

The magnifier in the table's toolbar opens a search box; `/` opens it from a resting cell. `⌘F` stays the browser's own find, which sees only the records the grid has drawn; the search box reaches every record (Issue #822). It uses the ⌘K matcher, scoped to this table: a name fragment, a `#143` id, or the words in a text field or a document. The grid keeps only the matching records as you type, in the table's own sort and inside its saved filter, and the foot reads `3 rows found`. The search runs on the server, so it reaches every page of a big table. It is saved with the view, beside its filter and sort: open the view again, or reload, and the box and the records come back. Duplicate copies the search into the new view, a view started from **+ Add view** has none, and clearing the box clears the view's search (Feature #307). On the raw Blank table the search is yours alone and nothing is written. `Return` on a single match opens that record in the dock. `Esc` clears the box and folds it away; a search that finds nothing says so and offers **Clear search**. `+ New` clears the search first, since an empty new record matches nothing.

## The grid from the keyboard

Cells **rest as values** and open on purpose. The cursor is a ring on one cell; the arrows and Tab move it, and a cell opens when you ask. That is what gives ← and → to navigation: a text caret only owns them while a cell is open, and hands them back when you Tab, Return or Esc out.

`?` shows these keys. Press it on a resting cell, or anywhere outside a text field and the document editor, or choose **Keyboard shortcuts** from the **⋯** menu on the identity panel at the foot of the sidebar: a sheet lists every key below, read from the grid's own keymap so it cannot promise a key the grid has dropped (Issue #268). `Esc` closes it and puts focus back where it was. Inside an open cell, `?` is a character like any other.

| At rest | What it does |
| --- | --- |
| `← → ↑ ↓` | move the cursor |
| `Tab` / `⇧Tab` | along the row, wrapping into the next or previous row; the last cell of the last row is the end, never the browser's chrome |
| `Return` | open the cell: a caret with the value selected, a picker, a flipped checkbox |
| any character | open the cell and start typing over the value |
| `/` | search this table |
| `Space` | pick the row up — or, on a toggle cell, flip the switch |
| `0`–`9`, `Backspace` | on a rating cell: set the rating, or clear it to 0 |
| `⇧↑` / `⇧↓` | extend the run of chosen records |
| `⌘A` | take every loaded record — the foot says how many that is |
| `Home` / `End` | the first or the last row of the table, scrolled in first |
| `⇧Return` | make the next row, open on its name |
| `⌘Return` | open the record in the dock |
| `Esc` | let the selection go |
| `?` | the sheet of these keys |

| In an open cell | What it does |
| --- | --- |
| `← →` | the caret's; they never step out of the cell |
| `Home` / `End` | the start or the end of the value — the grid places the caret, so the window never scrolls out from under an open editor (Issue #260) |
| `⇧Home` / `⇧End`, `⌥←` / `⌥→`, `⌘←` / `⌘→` | the browser's own editing keys: select to the edge, walk a word, walk a line |
| `Return` | commit, move down the column |
| `Tab` / `⇧Tab` | commit, move across |
| `↑` / `↓` | commit, move up or down |
| `Esc` | put the value back and rest |
| `Space` | a space |

Every field cell is a stop, select, multi-select, checkbox and date included. A document chip column is not: it is a door to the record, not a value, so the cursor passes over it. The checkbox column and the `#id` link are pointer targets; `Space` and `⌘Return` are their keys.

The first `Tab` on any page lands on **Skip to content**, which moves focus past the rail and the sidebar into the page. Wherever focus goes, it wears one ring: 2px of the brand blue, drawn clear of the control and at 3:1 or better against it in both themes (Issue #378).

## Ranges, fill and paste

A rectangle of cells is a **range**. Grow one with `⇧` and the arrows, or drag the pointer across the cells; the range is what a fill and a paste act on, and drawing one writes nothing.

| Gesture | What it does |
| --- | --- |
| `⇧← ⇧→` | grow the range sideways from the resting cell |
| `⇧↑ ⇧↓` | grow it up or down — **unless a record is picked up**, where they still extend the run of records |
| Drag across cells | the same rectangle, from the pointer |
| Drag the corner handle | fill: the range's values, down or across, over everything the handle covers |
| `⌘C` | copy the range, or the cell the cursor is on |
| `⌘V` | paste, tiled to fit whatever it lands on |
| `Esc` | let the range go — a row selection goes first when both are up |

`⌘C` and `⌘V` **follow the selection**, in every kind of cell. Text selected inside an open cell is the browser's own copy and paste — the text moves. With no text selected — a bare caret, a picker open, a checkbox, a cell at rest — they take the **cell**: `⌘C` copies its value, typed, and `⌘V` writes the clipboard into it through the same write a paste onto a range makes, with the same Undo. A clicked text cell opens with its value selected, so the two readings agree until you place the caret.

The blue square on the range's bottom-right corner is the **fill handle**. Drag it down a column or across a row and the range's values are written into every cell it covers — one value down twenty rows, or a whole row of values across. It moves along one axis, whichever you pull further.

`⌘C` puts two things on the clipboard at once: tab-separated text a spreadsheet reads, and the same block **typed**, which is what another weave tab reads back. That is what makes a select paste as an option and not as a word, and a multi-select carry its whole set. Pasting onto a single cell lays the block down from there; pasting onto a range fills the range, repeating the block to cover it — so one copied cell fills twenty.

What the types force:

- **Select, multi-select and workflow paste by option identity.** Within a table the option itself carries over. Into a different table the label goes instead, and a label that names no option there is **refused**, never invented.
- **A multi-select pastes as a replacement**, never a merge: the set you copied is the set the cell ends up with.
- **A relation links by name.** Each label in the paste — a copied relation cell, or `Ann, Bob` from a sheet — is matched against the related table's rows: a cell copied inside weave links the same records; otherwise the exact name (case and surrounding spaces aside), then `#12`. A set is replaced whole, as a multi-select is; a single relation takes the first match. A label that names no record is never invented: the message counts and names it, and a cell whose labels all miss is left alone.
- **A formula, rollup, lookup, view or document column takes no paste.** The cell refuses and the message names the column, the way the selection bar names what did not land.
- **Text from a spreadsheet** fills the range row by row. Each column reads it in its own terms — a number parsed, a checkbox read (`false` is false), a comma list split into a set — and a cell that will not read is dropped and counted while its neighbours land.

A fill or a paste is written the same way the selection bar writes: `POST /api/bulk`, one call per distinct set of values, reported per record. Records that receive the same values share one call, so a fill down a column is **one write**, and the message it raises carries an **Undo** that steps the whole thing back at once.

## Working on many records at once

The checkbox column sits **left of the `#` link**, so the link never disappears while a selection is live. It draws nothing at rest: the box appears when the pointer is on the row, and every box in the column stays lit once anything is chosen.

Because a bare cell click already means *edit this cell*, it cannot also mean *choose this row* — the box is the only way in. **Shift-click a second box** and everything between it and the last one is taken. The header box is select-all, and wears a dash while the selection is partial. `Esc` clears.

| Gesture | What it does |
| --- | --- |
| Click a box | chooses that record |
| Shift-click a box | takes the span from the last box hit |
| Click the header box | all, then none |
| `Esc` | clears the selection |

A selection is a set of **records**, not of positions: sort the table and the same records stay chosen. Records that leave the page — trashed, filtered out — leave the selection with them. Trashed records carry no box at all.

Once a record is chosen, a bar sits at the bottom centre of the window saying how many it holds — the window, not the table, so it is in reach on a grid taller than the screen, and the grid keeps a floor under it so the last row is never covered. The bar is contextual: a table with no relation gets no *Link to…*, a workspace with one table gets no *Move to table…*.

| On the bar | What it does |
| --- | --- |
| **Set a field…** | pick a field, then a value — state chips, options, checked or unchecked, or a typed box — and it is written across the selection. State is a field like any other here, so a table with two workflow fields needs no second button |
| **Link to…** | pick a relation, search the far table, pick one row: every chosen record is linked to it |
| **Duplicate** | copies each record's writable fields; computed fields and documents are not copied, because a computed field is a read and recomputes itself on the copy |
| **⋯** | the overflow below |
| **Move to trash** | past a hairline, on its own. Hold it until its fill sweeps across: the message it raises carries **Undo**, which brings back every record it took, and the cursor moves to the record after them |

| Under ⋯ | What it does |
| --- | --- |
| **Move to table…** | re-creates each record in the chosen table, matching fields by name and type, and trashes the original. Fields the far table lacks, files and comments stay behind — the bar names them |
| **Roll up into a new …** | pick a relation, name one new parent in its table, and every chosen record is linked to it |
| **Copy links** | one permalink per chosen record on the clipboard; the selection stays |

Set a field, Link to, Move to table and Roll up are each one write (`POST /api/bulk`, `weave bulk`, `weave_bulk`), reported per record. If part of it fails, the bar says what did **not** land rather than reporting a success it cannot vouch for, and each record keeps its own undo step. A `set` also reports `changed` — the records whose value actually moved, which is how deep the undo stack it left goes, and what the grid's fill and paste count before offering to step one back.

## Column order, width, and what is on screen at all

| Control | Where | What it does |
| --- | --- | --- |
| Drag a header | table view | moves the column: the header lifts, the columns it passes slide aside, and a dashed placeholder opens where it will land; the view keeps the order. Drop it across the seam beside **#** to freeze it; drop a frozen one back across to unfreeze it. Escape puts it back |
| Alt+Shift+← / → on a focused header | table view | moves the field one place. Crossing the seam freezes or unfreezes it where it stands |
| Drag a header's right edge | table view | sets the width. Only that column changes; the columns to its right slide over, and a readout shows the width and the change. It stops at its own label |
| Alt+← / → on a focused header | table view | narrows or widens the column by 8px, down to its label |
| Double-click that edge | table view | fits the column to its longest value, up to the type's maximum and never under its label |
| Click a header, or Return on a focused one | table view | opens the field tray to rename, retype or reconfigure. The click that ends a drag or a resize opens nothing |
| **Sort** in the View pane | table view | sorts by up to three fields, stored on the view for everyone. The two directions read by type: **Oldest to newest** for a date, **Smallest to largest** for a number, **A to Z** for text, **Option order** for a select and **State order** for a workflow (the order the definition lists them in), plain **Ascending** where no one reading fits. The system columns and **Public Id** (the **#** column) are in its list too; a column's ⋮ holds no sort rows |
| **Fields** in the View pane | table view | show or hide any field and the system columns |
| Drag the grip | entity page | reorders fields; the table's columns follow. On a phone, press and hold a field to pick it up |
| Tap a field record | entity page, phone | opens that field's picker sheet. At 600px and below the fields block is one inset group of 50px rows: label on the left, value chip, chevron on the right, and an empty value as a single + chip. The grips are gone, the label still opens the field tray, and a relation that carries chips takes its own full-width row |
| Tap a chip on a list row | table view, phone | edits that field without opening the record. The state mark and every chip own a 44px target around the drawn pill, the size the pill keeps; where two targets meet, or a target meets the **#** link or the name, the gap splits at its midpoint, so a tap a little wide of the state still picks a state and a tap nearer the **#** opens the record. The name always holds its two lines, so the chip line sits at the same height in every row. A drag never edits |
| Fold FIELDS | entity page | the caret beside FIELDS folds the value rows into one line of label · value chips, so a long field list stops pushing the documents down; the chips still edit in place, and the fold is remembered per record in this browser |

The **#** column takes none of this. It is frozen to the grid's left edge, so a wide table scrolls sideways underneath it and the record keeps its id and its `↗` permalink whatever column you have read your way out to; the selection checkbox travels with it. No drag moves it, and no field can be ordered ahead of it.

Fields dropped across the seam beside **#** freeze with it, and stay put while the rest of the grid scrolls. The frozen zone stops at 60% of the visible grid: a drop past that lands on the scrolling side, and a narrow window draws fewer fields frozen without forgetting the rest. The hairline at the seam shows only while something scrolls under it.

Every field type opens at a default width: Name 260px, text, links and multi-selects 180, long text 280, selects and workflows 124, relations 136, dates 112, numbers 88, currency 104, checkboxes 56. A header label never clips: a label longer than its default widens that column, and no drag, nudge or fit goes under it. Widths belong to the view, so each view keeps its own. Showing, hiding, adding or removing a field never resizes another one; the neighbours slide, and the space at the right of the grid takes up the difference. A hidden field keeps its width and its place for when it comes back.

A table or field description stays behind the raised info icon beside its name. Click the icon, or focus it and press Enter or Space, to show or hide the text below. Descriptions fold after three lines; **Show more** expands them. Each viewer's browser remembers the open descriptions. Click an open table description to edit it; for an empty table, use **Add description…** in its menu. Field settings keep the field's description editor. Grid column tooltips are unchanged.

The four system columns — `Created At`, `Modified At`, `Created By`, `Modified By` — are off by default. Turn them on where provenance is part of the record. A view shows the ones you turn on in its own list: each one drags, freezes across the seam and sizes like any field, and its place and width are the view's. A record's history lives in two places: the Activity button in the record's header and the Activity system table. Every one sorts from **Sort** in the View pane; the stored sort names it (`Created At desc`), and `Public Id` is the name the # column sorts under.

`Created By` and `Modified By` show a person as their name on an initial, followed by "via MCP" when they wrote through an MCP client. A signed-in write records the account, never its name, so these columns, the activity feed, the audit log, document revisions and credential owners all show the account's current name and follow it across a rename; a line written before accounts were recorded keeps the name it was written with, and an account since removed shows as `removed account`. A write an automation made shows the rule's Workflows record instead, and the chip opens that record. When a rule writes to a record you have open, in the grid or on its page, each cell it changed lights up in the order the rule wrote it, Modified By last, and a toast names the rule and the record. With reduced motion on, the cells stay still and the chip and the toast still show.

Hide rather than delete when a column matters to a machine and not to a reader. Hiding keeps the data and the API surface; a delete needs `hard` and does not come back.

## What a field means

Every field can carry a **description**: what the value represents and how it is written — `Who we bought from — the legal name on the invoice`, `ISO date of the first event in the transcript`. It sits under the label on the entity page and in the folded chips, is the column header's tooltip in the grid, and rides the schema (`weave_schema`, `weave schema`, `GET /api/schema`) as the field's `description`, so an agent filling the record reads the same note a person does. Set it in the field tray (click a header, or a label on the entity page), or from the schema verbs:

```bash
weave field update Order Vendor --description "Who we bought from — the legal name on the invoice"
weave field add Order "Due" date --description "When the invoice falls due; ISO date"
```

`{description: null}` clears it. The two view fields are the exception: on Chip and Card, `description` is the description **size** (none, small, medium, large), not a note.

## Taking a field change back

Saving a field in its tray shows a toast, `Qty updated`, with **Undo**. Undo puts the field's definition back the way it was before that save: its name, options and their colours, states, formula, format, default and description.

The toast lasts a few seconds. The record of the change stays in Activity: every change to a field's configuration is an entry on its table, `field-config-updated`, with the definition before and after. It shows in the Activity table with the table as its record, and its own page has a **Roll back** button. The page shows each changed setting in the field's own terms: an option or a state as its chip before and after, marked added, removed, renamed, recoloured, icon changed or moved; a formula as its text with the words that changed marked; a name, format or default as its value before and after. The whole definitions wait under **Show definitions**. The column width is the exception: a width belongs to the view, so resizing a column records nothing.

A roll back checks first. If the field has changed since the entry, the page says so and changes nothing: roll back the newer change first. Undo and Roll back each write an `undo` entry of their own, which can itself be rolled back.

Removing an option or a state leaves the records that held it alone: they keep its id, so rolling the change back brings their values back. A **type change** converts every stored value to the new type, and weave keeps each record's value from before it, so its Undo and its Roll back bring the values back with the definition. A record someone edited after the change keeps that edit, converted back to the old type, and a record made after the change is converted the same way. The toast says how many values came back, how many edited records were kept and how many newer records were converted.

Weave keeps the values of a field's newest type change only. When a field changes type again, the older entry keeps its two definitions but not its values, and its page says so: rolling it back cannot bring those values back.

Agents reach the same history: `weave_activity {entity: <table id>}` lists a table's entries, and `weave_rollback_field` (`weave field rollback <table> <field> --activity <id>`) rolls one back. Rolling back needs the same permission as changing the field. A sync that wants only what is new asks by cursor rather than by clock: `weave_activity {sinceSeq: <n>}`, `GET /api/activity?sinceSeq=<n>` or `weave activity --since-seq <n>` answers the entries after that seq, oldest first, and hands back `nextSeq` to pass next time. `since` compares timestamps, which many entries written in one tick share, so it cannot page without repeating an entry or skipping one.

## Costumes

A costume is display only. The stored value never changes, and neither does anything computed from it.

| Field | Config | Reads as |
| --- | --- | --- |
| number | `{}` | `1499.5` |
| number | `{"format":"currency","currency":"USD","decimals":2}` | `$1,499.50` |
| number | `{"format":"percent","decimals":1}` | `32.5%` |
| number | `{"unit":"kg","decimals":0}` | `2 kg` |
| date | `{}` | `2026-09-15` |
| date | `{"format":"us"}` | `9/15/2026` |
| date | `{"format":"long","time":true}` | `September 15, 2026, 2:30 PM` |

A formula takes the same number keys, so a computed total wears the same clothes as a stored one — and still reads raw numbers inside the expression.

The `Field Types` table in the **Showcase** space holds all of these side by side, one column each, in one grid.

## Colour means one thing

The option palette is the ten-hue ramp and it is closed: `slate`, `blue`, `green`, `amber`, `red`, `purple`, `cyan`, `pink`, `teal`, `orange`. Name a hue in an option's `hue`, or give its hex in `color`. A colour weave cannot name is refused rather than stored grey, and `magenta` still reaches pink for callers that learned the older name.

Slate is the honest default. A colour should carry meaning — red for blocked, green for done — and a table where every option is a different colour has told the reader nothing.

Workflow states start from their **category**, so `not-started`, `in-progress`, `done` and `canceled` look the same everywhere in the workspace without anyone choosing a colour. Pick a `hue` on one state and it keeps that colour everywhere instead, which is how two states in one category are told apart.

## Views

Every block is a `table`, the one view kind weave draws, with an optional `where`.

Filters are workflow-state chips above the grid and resolve to a server-side `where`, so filtering a large table does not mean fetching it.

A **saved view** is a named set of table blocks, and it can be shared:

```bash
weave view create "Ops Monday" --blocks '[{"table":"Task","where":[["Status","=","Open"]]},{"table":"Incident"}]'
weave view share <id>     # returns a /s/wvs_… link: a read-only share grant on the view
weave view unshare <id>   # revokes it
```

A view's link is a share grant (**Share links** above), so sharing a view takes an architect and the link lasts thirty days unless renewed. Anyone holding it reads that view and nothing else, with no account and no sign-in, and the link stays open when the workspace requires authentication. The token never leaves through `weave export`: an imported view arrives unshared, and `weave view share` mints it a fresh link.

## The relation map

One map, drawn in three places from one renderer: the `#/map` page, a card on the workspace home, and a card in every space's overview. A column per space, one edge per relation pair carrying both ends' cardinality, automations drawn in as pills. A space's map shows that space plus whatever it actually touches, guests dashed and named by their own space.

## Automations

A rule bound to one table: something happens, and weave writes.

```bash
weave automation create Task --name 'Log completion' \
  --trigger '{"type":"state-changed","field":"State","toState":"Done"}' \
  --actions '[{"type":"append-doc","text":"✅ Completed on {{Today}}."}]'
```

Triggers fire on create, update, state change and on a schedule. Actions set fields, move a state, append to a document, add a comment, upsert a record of another table, or POST a webhook. Each rule is a record of `System/Workflows`, which carries its On switch, State, Health and Last Run. The trigger and action reference, the cron schedule, the step outputs and a worked example are in the **Automations** guide.

## Decks

A deck is a read over slide records, composed on request — the records stay editable data and the deck is generated from them. See the **Decks: composing slides** guide.

## Who can do it

```bash
weave account create ci-bot --role editor
weave account set ci-bot --role observer
weave account list
weave audit --limit 50
```

Three roles. An **Observer** (free) reads every page and comments: through the API or MCP it may post a comment, under its own name, and delete a comment it made. An **Editor** (paid seat) also creates, edits and deletes records and any comment, and never touches structure: no workspace, space, table or field definition. An **Architect** (paid) does everything, structure, accounts and the keystore included. Over MCP, `tools/list` names only the tools the caller's role may call, and any other tool answers as an unknown one. "Free" and "paid seat" are labels: weave bills nobody. Before 2026-10-02 the three were `reader`, `writer` and `admin`; every open rewrites a stored old name to the new one, so every token keeps working, and `--role admin|writer|reader` is still accepted, with a deprecation note, for one more release. Tokens are `wv_` values hashed at rest, and every mutation lands in a durable audit log with the actor that made it — a person, the CLI, or a named MCP client.

An architect changes an existing account with `weave account set <name> --role observer|editor|architect`, `weave_accounts` with `action: set`, `account` and `role`, or `PATCH /api/accounts/:ref` with `{role}`. The account keeps its identity, tokens and sessions, which use the new role on their next request. The change is audited, and the last architect cannot be demoted. Editing Role in the Users table follows the same rules.

A space is open or private. An open space follows each account's workspace role. A private space admits its members and the workspace's architects: anyone else gets `404` on its tables and records and finds nothing of it in search, the schema, views, exports, share links or the audit log, and a relation into it shows a locked **Private** chip. A member may carry a role for that space that overrides the workspace role, so an Observer can be an Editor in Sales alone, and that member takes a paid seat. Workspace architects and the space's own architects manage it with `PATCH /api/spaces/:ref` and `{access: "private"}`, `PUT /api/spaces/:ref/members/:account` with an optional `{role}`, `DELETE` on the same path, or `weave_update_space` with `access`, `member`, `role` and `removeMember`. `weave_accounts` with `action: create` and `space` mints a token that reaches one space. A token never reaches past the account that issued it, and each write it makes lands in the audit log as `token-write`.

`weave workspace require-auth` closes every page and every API route to a caller without a token or a signed-in session. The doors that stay open are `/api/health` (status only without credentials: `{"ok":true,"name":"weave"}`, plus `"auth":{"ok":…}` when a provider is configured; the version, build, sizes, backup state and the provider's error code need an architect token or session), a share link (`/s/<token>`, and the old `/view/<token>` that redirects there), the task applet, the public production status page at `/status`, the sign-in page at `/auth`, and the static assets it needs; a browser without either is sent to the sign-in when a provider is configured and gets a page that links to it when none is, and an API call gets a 401. People sign in through an identity provider (the **Door C: sign in with a provider** guide) and agents keep the token. An observer may read any page and write nothing but its own comments; an editor writes records, never structure — and `weave import`, which replaces the whole workspace, is structure, so it needs an architect token. A token hash never leaves through `weave export`: an imported account keeps its name and role but opens nothing until it is deleted and created again.

Entity mutations are undoable (`weave undo`, 200 deep). Schema work, hard deletes and file deletions are not. In the app, `⌘Z` (Ctrl+Z) steps back the last change made in the same tab, and only while it is still the newest change on its undo stack. Each account keeps its own stack, and every browser on a server without sign-in shares one, so once another tab writes to that stack, `⌘Z` says "Changed since, so nothing was undone" and changes nothing. A write that never passed through that stack, an agent's or another account's, is caught on the way back instead: undo restores a field only while the field still holds the value the undone step gave it, and otherwise keeps the newer value and names it, "Kept: Due, changed since by agent-bo". A step whose every field is kept changes nothing and leaves the stack. A selection-bar trash comes back whole. A text box, an open cell and a document keep `⌘Z` as their own text undo. There is no redo.

## The structure is data too

`System/Spaces`, `System/Tables`, `System/Fields` and `System/Workflows` are ordinary tables whose records **are** the structure. Each workspace stores its own system tables, with a `Workspace` column identifying the workspace (the **Workspace registry** guide). Editing a record runs the same validation as the schema verb, because it is the schema verb. So does the grid foot: `+ New space` births a space named "New space" with the name selected for the caret to replace; `+ New table` and `+ New field` ask for the space or the table the record needs before creating it; a Workflows record starts blank like any other record; and a create the engine refuses lands in a toast rather than in silence. That is the subject of the **Configuring a space, first time right** guide.