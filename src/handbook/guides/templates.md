# Templates

Any space can be a template. A template copies its schema into another workspace of this weave: the tables, their fields and settings, option colours and icons, workflow states, views, column widths, field order, hidden fields, filters, sorting, the record term, the icons, and the space rollups over its tables. Records never travel. The copy is an ordinary space; it is not a template itself.

## Mark a space as a template

Open **Workspace › Spaces** and tick the space's **Template** box, in the grid or on the record's own page. Untick it to stop offering the space.

## Use a template

Open the template space. **Use template** sits beside the space's menu. Pick the workspace to build in and the new space's name, which starts as the template's, then choose **Use**. A toast says where the space landed; **Open** goes there.

| You see | Why |
| --- | --- |
| *already has a space named …* | The workspace holds a live space of that name. Choose another name. |
| *You cannot build in …* | Using a template writes the schema of that workspace, which needs an architect there. |
| *There is no other workspace to build in* | This weave holds one workspace. Create another from the workspace rail first. |

## What stays behind

A relation to a table outside the space cannot follow it. The copy leaves that relation out, with every lookup, rollup and formula that reads through it, and the answer names each one under `skipped`. Relations, lookups, rollups and formulas inside the space travel intact.

## Template checks

The test suite exercises each template kept in `test/fixtures/templates/` (the CRM template) and the three starters. For each table it adds a record that sets every field and reads each value back, links and unlinks every relation from both ends, checks each lookup, rollup and formula while the links stand, then trashes and restores the record. It also uses each template into a workspace named `test` and runs the same steps on the copy.

`node scripts/template-exercise.mjs --base http://127.0.0.1:4400 --from weave --into test` runs the same checks over HTTP on a running weave. It removes every record it made, purges its copy so the test workspace keeps nothing, not even trash, and exits 1 on any failure; `--keep` leaves the copy for a look. `node scripts/template-fixture.mjs --space CRM` refreshes the fixture from the live template.

## For agents

`weave_update_space {space, template: true}` marks a space; `weave_template_list` lists this workspace's templates; `weave_template_use {space, workspace, name?}` copies one into another workspace of the hub and answers `{space, workspace, url, plan, skipped}`. It needs the HTTP door, because a stdio server holds one workspace. Over REST: `GET /api/templates` and `POST /api/spaces/:space/use {workspace, name?}` on the template's own workspace. On the CLI: `weave template list` and `weave template use <space> --into <other.db> [--name N]`.