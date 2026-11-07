# Spaces and start pages

Superseded draft for Feature #344, October 25, 2026. Nothing below has shipped.

Kyle's follow-up distinguishes flexible left-navigation folders from semantic subspaces. The current recommendation is independent navigation folders over the existing Workspace → Space → Table → Row ownership model. Folder links may point to spaces, views, dashboards and rows without moving them. Semantic Parent changes below are paused pending that design clarification. The original draft remains here only to make the change in direction reviewable; replace it with the final decision before committing.

A space has an identity, contents and an optional overview. Its start page opens on contents. A subspace is another space with a parent. Tables keep one home; smart matches display references to tables whose home is elsewhere.

## Hierarchy

| Object | Owns or organizes | Start page |
| --- | --- | --- |
| Workspace | Access boundary and spaces | Top-level spaces, with existing onboarding when empty |
| Space | Tables and optional child spaces | Child spaces and tables, followed by optional overview information |
| Subspace | The same contents as any space | The same space page; ancestor breadcrumbs show its location |
| Table | Rows and saved table views | The selected table view |
| Row | Typed field values, documents and relations | The existing row page |

Use shallow spaces by default. Add a subspace when it gives a recognizable group a useful name. There is no separate Folder object with overlapping ownership rules. A space can be empty or contain only subspaces.

Parent is organizational. Moving a space changes its navigation location without moving its tables, changing their IDs or changing access. Existing globally unique space names and `Space/Table` addressing remain valid. Breadcrumbs show ancestry; addresses do not become rename-sensitive paths.

## Contents and overview

The primary task on a workspace or space page is opening its contents. Native links support keyboard navigation, opening a new tab and copying an address. Creation actions name their destination.

Existing descriptions, rollups and relation maps provide context. Overview information is secondary to the contents list. Schema remains available for editing the registry rows. A dashboard is a presentation of existing data, not an additional ownership level.

This decision does not introduce a dashboard composer, personal landing overrides, new permission levels, or empty People and Rules tabs. Those appeared in exploratory mockups and require their own implemented capabilities.

## Smart membership

`Match` filters table registry metadata. A space always lists its own tables; matching tables from other spaces appear as guests with their canonical home visible. Opening a guest opens the original table. A table appears once in a space even if it is both owned and matched.

An empty Match adds no guests. Invalid predicates fail explicitly. Matching is confined to live, non-system tables in the same workspace. Match does not query business rows: a saved table view filters rows.

Ownership stays with the table's home space. Creating a table in a space assigns that home. Deleting a host, using its template, or sharing it does not implicitly delete, copy or publish guest tables. Parents do not inherit matches from children, and children do not inherit matches from parents.

## Safety and compatibility

- Parent must be a live, non-system space in the same workspace. Self-parenting and cycles fail.
- Deleting a space with live subspaces fails until those subspaces are moved. The existing table deletion behavior applies to the space's own tables.
- Sharing and workspace access retain their existing boundaries. A parent grants no access to a child; a guest grants no access to its home.
- Rollups retain their explicit targets. Parent totals do not silently include children or guests.
- Structural APIs and registry-row editing use the same mutation path. CLI, MCP, schema and build operations preserve the same hierarchy.
- Existing deep links continue to open their targets without an intervening start page.

## Alternatives considered

| Model | Decision | Reason |
| --- | --- | --- |
| Folder labels replacing spaces | Reject | Loses the space record, its relations and editable metadata |
| Saved queries replacing spaces | Reject | Conflates ownership with discovery and makes creation ambiguous |
| Tables with several homes | Reject | Makes names, sharing and deletion ambiguous |
| Smart spaces with one home per table | Adopt | Adds discovery while preserving identity and ownership |
| Nested spaces | Adopt as optional organization | Reuses the space object and page without adding another kind |
| Any business row becomes a structural folder | Keep separate | Related rows can be gathered on an entity page without owning tables |

## Prior evidence

The earlier artifacts explored alternatives; they did not record Kyle selecting a final implementation. The September 6 suggestion of multiple table homes was contradicted by the October 5 proposal. This decision resolves that conflict in favor of one home.

- [Space patterns, October 5](https://claude.ai/artifact/QhWjW6MKpfFeR5SxgL8zmN)
- [Home patterns, October 6](https://claude.ai/artifact/77mTEKDgWhWFjpR6QFCTov)
- [Space futures, October 22](https://claude.ai/artifact/6u9jZUX3VGeQNEn3eVXyxz)
- [Feature #344: implementation and verification](https://weave.grunion.ai/w/weave/e/691e063e-1267-4356-8d08-d145474f5d38)

Feature #12 established spaces as registry entities. Feature #127 made the registry editable from workspace and space pages. Feature #278 retained Space as a unit of meaning. This decision preserves those underlying mechanics while putting ordinary navigation first.

## Design references

The contents-first layout applies [Nielsen Norman Group's progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/): frequent tasks stay visible and secondary controls have clear labels. Optional nesting and ancestor breadcrumbs follow its [flat versus deep hierarchy guidance](https://www.nngroup.com/articles/flat-vs-deep-hierarchy/). These principles support the decision; they do not establish that every workspace needs nesting.

[Fibery's sidebar guide](https://the.fibery.io/@public/User_Guide/Guide/Sidebar-21) distinguishes folders, spaces and smart folders. Weave deliberately uses fewer structural kinds because its spaces are already editable records. Fibery's permission semantics are not copied into Weave.
