# Workspace registry

Each workspace owns its **System** space, including **Users**, **Integrations**, **Spaces**, **Tables**, **Fields**, **Forms** and **Workflows**. The workspace stores these records in its own file and checks its own accounts and roles. The hub discovers workspaces and routes requests to them. The workspace served at `/` is a routing default with the same permissions as any other workspace.

## System records in the sidebar

On desktop, **Hide sidebar** hides the workspace rail too. **Show sidebar** leads the page breadcrumb row. Rest at the left edge for 150 ms to peek; moving away for 400 ms or pressing Escape closes the peek. Clicking the edge or blank sidebar space pins it open.

The **System** space sits at the bottom of the sidebar, under your spaces and **+ New space**, behind a hairline, and stays put on desktop however far the space list scrolls (Feature #333). It holds six built-in entries, in this order and with no counts: **Workflows** (this workspace's own workflows), **Runs** (external task outcomes and confirmation delivery), **Users** (the accounts and invites, below), **Integrations** (the outside tools this workspace holds an API key for, below), **Activity** (every change in the workspace, `#/activity`) and **Trash** (every trashed record in the workspace, `#/trash`). System folds and unfolds from its caret like any space, and the sidebar remembers the fold. On a phone, the menu scrolls as one column so System leaves room for the space list; the identity panel stays within reach at the bottom. Its stored name is System and its internal key stays `workspace`; a workspace whose system space was still called Workspace is renamed System the first time it opens, and `Workspace/Users` style names keep resolving to it. A workflow belongs to the workspace whose table its rule runs on, and its record's `Workspace` column says which; a record made in a member workspace starts out there. `POST /api/tables/Workflows/query` and the Trash list answer only for the workspace you ask from, and a member cannot open another workspace's workflow by id. They cannot be renamed, moved or deleted, and neither can any system table: `updateTable` refuses a new name for one on every door. In Trash, a trashed table or space is listed as its Tables or Spaces record, and Restore on that record brings the whole structure back. A workspace you deleted from the icon rail is listed there too, under Workspaces, with its own Restore. The same list is `GET /api/trash`, `weave_trash` with no table, or `weave trash`.

Under System, at the very foot of the sidebar, the identity panel shows who you are here: your avatar, your name and your role in this workspace as a chip (Architect purple, Editor blue, Observer slate). A role belongs to a workspace, never to a person, so switching workspace from the rail changes the chip. Signed out of a workspace that asks for a sign-in, the panel shows **Sign in**; an open workspace with no sign-in shows **Open access**. The **⋯** button opens the personal menu: **Theme** (auto, dark and light in turn), **Keyboard shortcuts** (the `?` key opens the same sheet) and **Sign out** with the running version beside it, then **Sign out everywhere**. A server running an older commit than the page it served, or one behind main or the latest release, still raises its toast and shows a tinted line above the panel naming the commits.

## Users and permissions

Open **System › Users** in the workspace whose accounts you want to manage. An Architect adds people, agents and invites there. A relation from any table in that workspace can target Users for an owner or assignee. Accounts, tokens and roles belong to that workspace; an Architect in one workspace needs a separate account to enter another protected workspace.

## Integrations

Open **System › Integrations** to connect weave to a tool that takes an API key, such as Fibery (Feature #339). Each row is one connection: Name, On, Provider (Fibery or Generic API key), Host, Credential, Key Hint, State (Setup incomplete, Checking, Connected or Failed), Connected As, Health Reason, Last Checked, Last Used and Workspace. Credential, Key Hint, State, Connected As, Health Reason, Last Checked and Last Used are kept by weave and refuse edits.

Host is the one host name the key may reach, such as `acme.fibery.io`. weave stores the bare name and talks https only; a Fibery Host ends in `.fibery.io`, and an IP address, a port or a path is refused.

The key is write-only. **Add key**, then **Replace**, on the Credential cell takes the pasted key once in a password box, sends it as `{ value }` to `PUT /api/integrations/<id>/credential` and clears the box. weave tests it against Host straight away: for Fibery, an authenticated call that returns the current user, whose name lands in Connected As. A green test seals the key in the keystore as `integration:<row id>`, keeps its last four characters as Key Hint (a key under 16 characters shows only `set`) and sets State to Connected. A red test stores nothing, sets State to Failed and says why in Health Reason. Replacing a key keeps the old one until the new one tests green. Changing Host or Provider deletes the stored key, because a key only ever reaches the host it was tested on; deleting the row deletes its key, and a restored row comes back without one.

weave uses a key itself and never hands it out. Inside the engine, `integrationFetch(<row>, <url>, { method, headers, body })` sends one https request with the row's key in the Authorization header (`Token` for Fibery, `Bearer` otherwise). It refuses any host but Host, a port, plain http, a caller-set Authorization, Proxy-Authorization or Cookie header, a method outside GET, HEAD, POST, PUT, PATCH and DELETE, and a row that is Off or has no key, all before a byte leaves. It never follows a redirect. Each call stamps Last Used and writes a `key-used` audit entry naming the integration, host, method, path and status, never the key, and a key the host echoes back is redacted from the answer. The `http-request` automation action is its one caller (Automations guide, "Calling an API"): a rule names the integration and never holds the key.

Nothing reads a key back. The cell shows dots and the hint, with no Show or Copy, and the columns weave keeps read rather than edit. The keystore routes, `weave_keys` and `weave key reveal` refuse every `integration:` name, and a workflow cannot sign a webhook with one. No row, query, export, CSV, share link, Activity entry, audit entry or MCP answer carries the key. Only an architect sets a key.

## The Workspaces table

Each workspace's **Workspaces** table contains the record describing that workspace. Its system records relate to this record through their **Workspace** column.

Create and delete workspaces through the hub routes, `POST /api/workspaces` and `DELETE /api/workspaces/:id`. A Workspaces record's Description edits the workspace's description; edit its Name from the workspace's own page so its address follows the change.

## Structure and system records

Each workspace's `state` holds its spaces, tables and fields. Structural changes update the corresponding system records in the same workspace. Editing a system record calls the same schema operation with the same validation. `weave registry report` reports drift, and `weave registry rebuild` restores the records from the structure.

Table configuration, including Field Order, Hidden Fields, Filter, Sort and Hide Rollups, stays on the local Tables record. Space rollups live on the local Spaces table and name tables in that workspace. Relations can target the local System/Spaces and System/Tables records, and the workspace's own API reads and edits those records.

## Migration

A legacy hub validates its system records before returning them to their owning workspaces. Current hub record IDs are retained, and typed relation references to older local registry records are remapped to those IDs. Custom text stays unchanged. Cross-workspace schema or custom links that cannot remain local stop migration before it writes.

The source records become inactive recovery records only after the destination workspaces save successfully. A migration marker lets startup resume after an interruption. Back up the complete data directory before upgrading. To return to the previous binary, restore that backup too; older code must not open the migrated files.