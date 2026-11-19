# Code graph

`graphify-out/graph.json` is a knowledge graph of weave's code and docs, built by [graphify](https://github.com/Graphify-Labs/graphify) (Apache 2.0, PyPI package `graphifyy`). Every function, class, module and doc section is a node; calls, imports, containment and doc references are edges; a clustering pass groups them into named communities. Query it before reading a monolith end to end: it answers "what calls this", "what breaks if I change this" and "how are these two connected" in under a second, with file and line for every hit.

`graphify-out/GRAPH_REPORT.md` is the human summary: hub symbols, surprising connections, every community with its members. `graphify-out/.graphify_labels.json` keeps the community names stable across rebuilds. Nothing else under `graphify-out/` is committed. graphify is a development tool and never a weave dependency.

## Using it

Install once with `uv tool install graphifyy` (or `pipx install graphifyy`). From the repo root, every command finds the graph on its own:

| Question | Command |
| --- | --- |
| What does this symbol touch? | `graphify explain "public/app.js::renderTable()"` |
| What breaks if I change it? | `graphify affected "src/store.js::WeaveError" --depth 2` |
| How are two symbols connected? | `graphify path "public/app.js::sendDoc()" "Weave" --undirected` |
| Which symbols hold the most weight? | `graphify god-nodes --top 20` |
| Open-ended search | `graphify query "<question>" --budget 2000` |
| Browse it | `graphify export html`, `graphify tree` or `graphify export callflow-html`, then open the HTML under `graphify-out/` |

Name a symbol when you can, qualified by its file: every function the tables below cite also has a stub node under `docs/graph.md`, so a bare name can come back ambiguous, and graphify then lists the candidates. `explain`, `path` and `affected` resolve names exactly; `query` matches keywords and can miss the code you mean. Asked how a workflow run gets scheduled, it returned `scripts/sheriff.mjs` and missed the scheduler in `src/engine.js`. `graphify-mcp` serves the same graph to an MCP client.

## How it is built

Three passes, all recorded in the graph:

1. **Structure.** A tree-sitter pass over every `.js`, `.mjs`, `.json` and `.yml` file: definitions, calls, imports. Local, deterministic, no model.
2. **Docs.** A language-model pass over the Markdown and HTML docs that links concepts and sections to the code they describe. Code spans in a doc (`src/engine.js`, `renderTable()`) become `references` edges to the symbol they name.
3. **Names.** A language-model pass that names each community from its members.

`.graphifyignore` keeps vendored libraries, minified bundles, generated pages, the tracker export, the changelog and images out of the graph. Without it, `public/vendor/mermaid.min.js` alone adds 3,203 nodes and fake hubs named `t()` and `r()`.

## Blind spots

The structure pass cannot see two things, so this page records them by hand, and the graph picks them up through pass 2:

- The browser reaches the server only over HTTP. No import joins `public/app.js` to `src/`, so the map shows the front end as an island. The route table below joins them.
- Eight browser scripts wrap their code in an immediately invoked function, so the pass finds no symbols in them. The script table below lists what each defines and exposes.

Test files that hold only anonymous `test()` callbacks also yield no symbols; their imports still link them to the code under test.

## Refreshing

Refresh after a large refactor, a module split or a new top-level directory, and with each release. `graphify-out/graph.json` names the commit it was built from in `built_at_commit`.

```bash
graphify extract . --backend claude-cli
graphify label . --backend claude-cli --missing-only
```

`extract` reruns the structure pass in about a minute and sends only changed docs to the model, because `graphify-out/cache/semantic/` is committed and keyed by file content (the first full doc pass read 550,000 tokens); `--backend claude-cli` bills the local Claude Code login, and any backend graphify lists works. `graphify update .` refreshes the structure alone with no model. `test/code-graph.test.mjs` fails when the graph is missing, when it carries ignored paths, when more than a tenth of its communities are unnamed, or when a file or function cited below no longer exists.

## Browser to server routes

This table maps every server endpoint that browser code under `public/` requests to the server code that answers it, grouped by method and path with dynamic segments as `:name`. Paths are shown as the server sees them, after the `/w/:ws` workspace prefix and the `/s/:token` share prefix are stripped.

How the paths are built. `api()` (`public/app.js:299`) fetches `WS_PREFIX + '/api' + path`, where `WS_PREFIX` (`public/app.js:31`) is the `/w/<ws>` part of `location.pathname`; every `public/*.js` classic script on `public/index.html` shares this global `api()`. `warmGet()` (`public/app.js:283`) caches `api('GET')` results; `openEntity()` (`public/app.js:649`) uses it to warm `/entities/:id`, `/references` and `/references-from`. `wsApi()` (`public/app.js:11521`) targets another workspace through `wsApiPrefix()` (`/w/<id>/api`). `sendUpload()` (`public/app.js:71`) uses `XMLHttpRequest`; `streamUpload()` (`public/app.js:3819`) first asks `POST /api/uploads` for a grant, then PUTs the bytes to the grant's `url`. `postLogout()` (`public/app.js:1819`) and `workflowRow()` (`public/app.js:8141`) call `fetch()` directly. Outside the shell, `public/start.js` uses its own `getJson()` and `post()`, `public/billing.js` defines a separate module-local `api()` on `${prefix}/api`, `public/form.js` posts to `form.dataset.submit`, and `public/paint.js` sends a beacon from `start()`.

Server dispatch. `createServer()` (`src/server.js:663`) hands every request to the handler from `createRequestHandler()` (`src/routes.js:1749`), which runs a chain of route functions in order: `resolveWorkspaceHost()` (`src/routes.js:181`, strips `/w/:ws` at `:242`), `entityExportRoutes()`, `formAndStatusRoutes()`, `backupAndUploadRoutes()`, `authRoutes()`, `startRoutes()`, inline checks in `createRequestHandler()`, `workspaceRoutes()`, `mailKeyAndIntegrationRoutes()`, `leaveAndBugReportRoutes()` and finally `registeredAndSpaceRoutes()` (`src/routes.js:1628`). That last one answers every route declared as `http:` on a command in `COMMANDS` (`src/commands.js:357`), matched by `matchRoute()` (`src/commands.js:2235`) and run by `httpReply()` (`src/commands.js:2253`). A handler cited as `src/commands.js:N` names that command's `http:` entry; the command's `run` holds the logic.

| Endpoint | Browser callers | Server handler |
| --- | --- | --- |
| GET /api/entities/:entity | `showEntity()`, `drawDock()`, `duplicateEntity()`, `editorFor()` in `public/app.js`; `drawCompare()` in `public/board-view.js`; `uploadDocFiles()` in `public/doc-editor.js`; `workflowRow()` direct fetch; `warmGet()`; 16 sites | `entity.read`, `src/commands.js:1120` |
| PATCH /api/entities/:entity | `editorFor()`, `editChipSegment()`, `renderEntityView()` in `public/app.js`; `renderBoard()` in `public/board-view.js`; `activityPanelCore` in `public/activity-panel.js`; 8 sites | `entity.update`, `src/commands.js:1138` |
| DELETE /api/entities/:entity (`?hard=1`) | `renderTable()` and `MENU_ROWS` record menu in `public/app.js`; `showSettings()` purge in `public/settings-view.js` | `entity.delete`, `src/commands.js:1160` |
| POST /api/entities/:entity/restore | `undoGesture()`, `MENU_ROWS` in `public/app.js`; `showTrash()` in `public/settings-view.js` | `entity.restore`, `src/commands.js:1038` |
| POST /api/entities/:entity/state | `editorFor()`, `editChipSegment()`, `editPhoneField()`, `nextStateFor()` in `public/app.js` | `entity.state`, `src/commands.js:1051` |
| POST /api/entities/:entity/link | `editorFor()`, `editPhoneField()`, `relatedGrid()` in `public/app.js` | `entity.link`, `src/commands.js:1064` |
| POST /api/entities/:entity/unlink | `editorFor()`, `relatedGrid()`, `unlinkWithUndo()` in `public/app.js` | `entity.unlink`, `src/commands.js:1077` |
| PUT /api/entities/:entity/doc | `sendDoc()` in `public/app.js` | `doc.set`, `src/commands.js:1313` |
| GET /api/entities/:entity/doc/revisions/:seq? | `activityPanelCore` in `public/activity-panel.js` (list and one revision) | `doc.revisions`, `src/commands.js:1356` |
| POST /api/entities/:entity/doc/revisions/:seq/restore | `activityPanelCore` in `public/activity-panel.js` | `doc.restore`, `src/commands.js:1380` |
| GET /api/entities/:entity/references | `entityRefs()`, `warmGet()` in `public/app.js` | `registeredAndSpaceRoutes()`, `src/routes.js:1720` |
| GET /api/entities/:entity/references-from | `entityRefs()`, `warmGet()` in `public/app.js` | `registeredAndSpaceRoutes()`, `src/routes.js:1732` |
| GET /api/entities/:entity/view | `viewSection()` in `public/field-dialog.js` | `registeredAndSpaceRoutes()`, `src/routes.js:1723` |
| POST /api/entities/:entity/version | `renderEntityView()` in `public/app.js` | `registeredAndSpaceRoutes()`, `src/routes.js:1735` |
| POST /api/entities/:entity/fields/:field/files | `avatarUpload()` via `sendUpload()` in `public/app.js` | `file.attach` (`also` path), `src/commands.js:1656` |
| POST /api/tables | `tableTray()` in `public/app.js` | `table.create`, `src/commands.js:597` |
| PATCH /api/tables/:db | `renameNavTable()`, `tableChrome()`, `renderTable()`, `reorderBlocks()`, `gridConfigWrite()` in `public/app.js`; 11 sites | `table.update`, `src/commands.js:631` |
| DELETE /api/tables/:db | `MENU_ROWS` table menu in `public/app.js` | `table.delete`, `src/commands.js:713` |
| POST /api/tables/:db/restore | `MENU_ROWS` table menu in `public/app.js` | `table.restore`, `src/commands.js:726` |
| POST /api/tables/:db/move | `MENU_ROWS` table menu in `public/app.js` | `table.move`, `src/commands.js:687` |
| POST /api/tables/:db/duplicate | `MENU_ROWS` table menu in `public/app.js` | `table.duplicate`, `src/commands.js:700` |
| POST /api/tables/:db/fields | `footRollupWrite()`, `renderEntityView()` in `public/app.js`; `renderBoard()` in `public/board-view.js`; `fieldDialog()` in `public/field-dialog.js` | `field.add`, `src/commands.js:388` |
| PATCH /api/tables/:db/fields/:field | `optionCreator()`, `renderTable()`, `subtablePopover()` in `public/app.js`; `fieldDialog()` in `public/field-dialog.js` | `field.update`, `src/commands.js:411` |
| DELETE /api/tables/:db/fields/:field | `footRollupWrite()`, `MENU_ROWS` field menu in `public/app.js` | `field.delete`, `src/commands.js:438` |
| POST /api/tables/:db/fields/:field/restore | `MENU_ROWS` field menu in `public/app.js` | `field.restore`, `src/commands.js:451` |
| POST /api/tables/:db/fields/:field/rollback | `fieldConfigToast()` in `public/app.js`; `rollbackControl()` in `public/activity-log.js` | `field.rollback`, `src/commands.js:425` |
| POST /api/tables/:db/formula-check | `formulaBuilder()` in `public/field-dialog.js` | `formula.check`, `src/commands.js:464` |
| POST /api/tables/:db/relations | `fieldDialog()` in `public/field-dialog.js` | `relation.add`, `src/commands.js:480` |
| POST /api/tables/:db/query | `readAndDrawTable()`, `gridPager()`, `readAndDrawBoard()`, `relatedGrid()`, `spaceStatTiles()` in `public/app.js`; `viewSection()`, `computedShowsAs()`, `fieldDialog()` in `public/field-dialog.js`; 18 sites | `entity.query`, `src/commands.js:1212` |
| GET /api/tables/:table/stats | `fillFooter()`, `footStatLists()`, `footerPicker()` in `public/app.js`; `fieldDialog()` in `public/field-dialog.js` | `table.stats`, `src/commands.js:1248` |
| POST /api/tables/:db/entities | `quickCreate()`, `drawDatabase()`, `duplicateEntity()`, `newUserDialog()`, `openPrefill()` in `public/app.js`; 10 sites | `entity.create`, `src/commands.js:1100` |
| GET /api/tables/:db/entities | `newUserDialog()` in `public/app.js`; `formulaBuilder()` in `public/field-dialog.js` | `registeredAndSpaceRoutes()`, `src/routes.js:1709` |
| GET /api/tables/:db/prefill | `openPrefill()` in `public/app.js` | `registeredAndSpaceRoutes()`, `src/routes.js:1716` (`prefillDraft()`, `:85`) |
| PATCH /api/tables/:db/views/:name | `viewStrip()` (rename, reorder, create), `saveTableSearch()`, `paneWrite()`, `listViewWrite()`, `gridConfigWrite()` in `public/app.js` | `table.view.set`, `src/commands.js:666` |
| DELETE /api/tables/:db/views/:name | `viewStrip()` in `public/app.js` | `table.view.delete`, `src/commands.js:674` |
| GET /api/trash and GET /api/tables/:table/trash | `showTrash()`, `showSettings()` in `public/settings-view.js` | `entity.trash` (`also` path), `src/commands.js:1225` |
| POST /api/spaces | `renderNav()`, `tableTray()` in `public/app.js` | `space.create`, `src/commands.js:494` |
| PATCH /api/spaces/:space | `showSpace()`, `renderNav()` in `public/app.js` | `space.update`, `src/commands.js:526` |
| DELETE /api/spaces/:space | `MENU_ROWS` space menu in `public/app.js` | `space.delete`, `src/commands.js:567` |
| POST /api/spaces/:space/restore | `MENU_ROWS` space menu in `public/app.js` | `space.restore`, `src/commands.js:580` |
| POST /api/spaces/:space/use | `useTemplateDialog()` in `public/app.js` | `template.use`, `src/commands.js:1772` |
| GET /api/spaces/:space/home | `mountSpaceHome()` in `public/space-home-view.js`; `showSpaceLauncher()` in `public/space-launcher-view.js` | `registeredAndSpaceRoutes()`, `src/routes.js:1699` |
| GET /api/views | `savedPagesCard()` in `public/app.js` | `view.list`, `src/commands.js:1496` |
| GET /api/views/:view | `showView()` in `public/app.js` | `view.get`, `src/commands.js:1506` |
| POST /api/views | `MENU_ROWS` table menu in `public/app.js` | `view.create`, `src/commands.js:1516` |
| DELETE /api/views/:view (`?hard=1`) | `MENU_ROWS` space menu in `public/app.js`; `showSettings()` purge in `public/settings-view.js` | `view.delete`, `src/commands.js:1526` |
| POST /api/views/:view/restore | `MENU_ROWS` space menu in `public/app.js`; `showTrash()` in `public/settings-view.js` | `view.restore`, `src/commands.js:1536` |
| GET /api/shares | `mount()` in `public/share-panel.js` | `share.list`, `src/commands.js:1570` |
| POST /api/shares | `mount()` in `public/share-panel.js` | `share.mint`, `src/commands.js:1593` |
| PATCH /api/shares/:share | `mount()` in `public/share-panel.js` | `share.update`, `src/commands.js:1623` |
| DELETE /api/shares/:share | `mount()` in `public/share-panel.js` | `share.revoke`, `src/commands.js:1613` |
| POST /api/shares/:share/regenerate | `mount()` in `public/share-panel.js` | `share.regenerate`, `src/commands.js:1633` |
| GET /api/forms/manage | `formsDialog()` in `public/forms-dialog.js` | `mailKeyAndIntegrationRoutes()`, `src/routes.js:1567` |
| POST /api/forms | `formEditor()` in `public/forms-dialog.js`; `mount()` in `public/share-panel.js` | `mailKeyAndIntegrationRoutes()`, `src/routes.js:1573` |
| PATCH /api/forms/:form | `formsDialog()`, `formEditor()` in `public/forms-dialog.js` | `mailKeyAndIntegrationRoutes()`, `src/routes.js:1577` (`updateForm()` in `src/forms.js`) |
| POST /api/forms/:form/submit | submit listener in `wire()` in `public/form.js` | `formAndStatusRoutes()`, `src/routes.js:852` |
| GET /api/workspace | `loadSchema()`, `homeReads()`, `newUserDialog()`, `refreshAccountChip()`, `wireWsNew()` in `public/app.js`; `showSettings()` in `public/settings-view.js`; 7 sites | `workspace.get`, `src/commands.js:1867` |
| PATCH /api/workspace | `setLinkPreview()`, `showHome()` in `public/app.js` | `workspace.update`, `src/commands.js:1880` |
| GET /api/workspace/home | `mountWorkspaceHome()` in `public/space-home-view.js`; `showWorkspaceLauncher()` in `public/space-launcher-view.js` | `workspaceRoutes()`, `src/routes.js:1445` |
| PUT /api/workspace/logo | `uploadWorkspaceLogo()` via `wsApi()` in `public/app.js` | `workspace.logo.set`, `src/commands.js:1910` |
| DELETE /api/workspace/logo | `removeWorkspaceLogo()` via `wsApi()` in `public/app.js` | `workspace.logo.clear`, `src/commands.js:1936` |
| GET /api/workspaces | `buildWsRail()`, `homeReads()`, `useTemplateDialog()` in `public/app.js`; `showSettings()` in `public/settings-view.js` | `workspace.order`, `src/commands.js:1949` (list built in `registeredAndSpaceRoutes()`, `src/routes.js:1674`) |
| POST /api/workspaces | `wireWsNew()` in `public/app.js` | `createRequestHandler()`, `src/routes.js:2179` (admission), then `workspaceRoutes()`, `src/routes.js:1393` |
| DELETE /api/workspaces/:ws | `deleteWorkspaceDialog()` in `public/settings-view.js` | `workspaceRoutes()`, `src/routes.js:1402` |
| GET /api/workspaces/slug | `wireWsNew()` in `public/app.js` | `createRequestHandler()`, `src/routes.js:2137` |
| GET /api/schema | `loadSchema()` in `public/app.js` | `schema.describe`, `src/commands.js:1804` |
| POST /api/build | `runStarter()` in `public/app.js` | `build`, `src/commands.js:1851` |
| GET /api/onboarding | `maybeOnboard()` in `public/app.js` | `workspaceRoutes()`, `src/routes.js:1420` |
| POST /api/onboarding | `onboard()` in `public/app.js` | `workspaceRoutes()`, `src/routes.js:1428` |
| GET /api/accounts | `showIntroControls()` in `public/app.js`; `inviteDialog()` in `public/invite-dialog.js` | `account.list`, `src/commands.js:1987` |
| GET /api/invites | `homeReads()` in `public/app.js`; `inviteDialog()` in `public/invite-dialog.js` | `invite.list`, `src/commands.js:2116` |
| POST /api/invites | `inviteDialog()` in `public/invite-dialog.js` | `invite.create`, `src/commands.js:2099` |
| DELETE /api/invites/:ref | `inviteDialog()` in `public/invite-dialog.js` | `invite.revoke`, `src/commands.js:2127` |
| GET /api/auth/me | `accountNow()`, `wireWsNew()` in `public/app.js` | `authRoutes()`, `src/routes.js:1212` |
| POST /api/auth/logout (`?everywhere=1`) | `signOutOf()`, `signOutEverywhere()` via `postLogout()` in `public/app.js` | `authRoutes()`, `src/routes.js:1196` |
| POST /api/keys/:name/reveal | `credentialReveal()` in `public/app.js` | `key.reveal`, `src/commands.js:867`, run by the keys gate in `mailKeyAndIntegrationRoutes()`, `src/routes.js:1512` |
| PUT /api/integrations/:integration/credential | `replaceIntegrationKey()` in `public/app.js` | `mailKeyAndIntegrationRoutes()`, `src/routes.js:1507` |
| GET /api/billing | `renderNav()` in `public/app.js`; `inviteDialog()` in `public/invite-dialog.js`; `refresh()` in `public/billing.js` | `workspaceRoutes()`, `src/routes.js:1469` |
| POST /api/billing/organization | `refresh()` in `public/billing.js` | `workspaceRoutes()`, `src/routes.js:1473` |
| GET /api/activity/:id*? | `showActivity()`, `showActivityDetail()` in `public/activity-log.js`; `activityPanelCore` | `activity`, `src/commands.js:964` |
| GET /api/search | `openCommandK()` in `public/command-palette.js` (path from `searchUrl()`); `entityHint()` in `public/doc-editor.js` | `search`, `src/commands.js:1420` |
| GET /api/undo | `stepBackOwn()` in `public/app.js`; `activityPanelCore` | `undo.list`, `src/commands.js:1434` |
| POST /api/undo | `stepBackOwn()` in `public/app.js`; `activityPanelCore` | `undo.run`, `src/commands.js:1446` |
| POST /api/bulk | `renderTable()` (bulk actions and range fill) in `public/app.js` | `entity.bulk`, `src/commands.js:1284`; editor-token guard at `src/routes.js:1548` |
| POST /api/markdown | `renderMarkdownInto()` in `public/app.js`; `resolveRefs()` in `public/doc-editor.js`; `spaceHomeOverview()` in `public/space-home-view.js` | `mailKeyAndIntegrationRoutes()`, `src/routes.js:1561` |
| GET /api/automations | `relationMapCard()` in `public/app.js`; `showMap()` in `public/relation-map.js` | `automation.describe`, `src/commands.js:784` |
| POST /api/uploads | `streamUpload()` in `public/app.js` | `mailKeyAndIntegrationRoutes()`, `src/routes.js:1525`, grant built by `prepareUpload()`, `src/routes.js:2083` |
| PUT /api/uploads | `sendUpload()` in `public/app.js` with the grant (callers of `streamUpload()`: `editorFor()` in `public/app.js`, `renderBoard()` in `public/board-view.js`, `uploadDocFiles()` in `public/doc-editor.js`) | `backupAndUploadRoutes()`, `src/routes.js:989` |
| PUT /api/files/:file/storage | `reserveFit()` in `public/app.js` | `registeredAndSpaceRoutes()`, `src/routes.js:1745` |
| GET /api/health | `healthNow()` in `public/app.js` | `createRequestHandler()`, `src/routes.js:2151` |
| POST /api/bug-report | `openBugPanel()` in `public/app.js` | `leaveAndBugReportRoutes()`, `src/routes.js:1604` |
| POST /api/paint | `start()` in `public/paint.js` (`navigator.sendBeacon`) | `resolveWorkspaceHost()`, `src/routes.js:184` |
| GET /api/start | `boot()`, `done()` in `public/start.js` | `startRoutes()`, `src/routes.js:1248` (signed out) and `:1258` |
| GET /api/start/slug | `workspace()` in `public/start.js` | `startRoutes()`, `src/routes.js:1274` |
| POST /api/start/signout | `foot()` in `public/start.js` | `startRoutes()`, `src/routes.js:1244` |
| POST /api/start/workspaces | `run()` in `public/start.js` | `startRoutes()`, `src/routes.js:1323` |
| GET /api/start/workspaces/:ws/agent | `render()` in `public/start.js` | `startRoutes()`, `src/routes.js:1316` |
| POST /api/start/invites/:ws/:token | `list()` in `public/start.js`, URL taken from the row's `accept` field built at `src/routes.js:448` | `startRoutes()`, `src/routes.js:1308` |

The browser also reaches five endpoints through `href`, `src` or `location` rather than a request call: GET /api/files/:file (`fileUrl()` in `public/app.js`, `src()` in `public/file-preview-core.js`, `public/chip-view.js`, `public/doc-editor.js`; `file.read`, `src/commands.js:1683`, served by `serveFile()` at `src/routes.js:1636`), GET /api/workspace/logo (`wsLogoButton()`; `workspace.logo.read`, `src/commands.js:1926`), GET /api/tables/:db/export.csv (`MENU_ROWS` table menu; `csv.export`, `src/commands.js:921`), GET /api/auth/open/:ws (`wsHref()`; `authRoutes()`, `src/routes.js:1188`, only with a base domain) and GET /api/auth/oidc/start (`wireWsNew()`, `signInHref()` in `public/start.js`; `authRoutes()`, `src/routes.js:1060`).

Notes.
- Every endpoint the browser calls has a handler. The one exception is `refresh()` in `public/status.js`, which fetches `document.body.dataset.api`, set in `public/status.html:3` to an external status worker. No handler in this repo answers it; `formAndStatusRoutes()` at `src/routes.js:881` serves only `public/status.html`.
- `api()` in `public/billing.js` is a different function from `api()` in `public/app.js`; both resolve to the same server routes.
- Route groups with an HTTP route that no browser code calls (searched all `public/*.js`): `schema.ontology`, `space.list` and the `space.members` routes, `table.list`, `table.view` GET, `run.*`, every `automation.*` route except GET /api/automations, POST /api/hooks/:hook, every `key.*` route except reveal, `csv.import`, `audit`, `registry.*`, `relation.map`, `comment.add` and `comment.delete`, `doc.read` and `doc.append`, `json.export` and `json.import`, `view.share` and `view.unshare`, `share.renew`, `share.current`, `file.delete`, `vocabulary`, `template.list`, `schema.apply`, `workspace.move`, `account.create`/`set`/`delete`/`link`/`unlink`, plus inline GET /api/spaces/:space, GET /api/tables/:db, POST /api/entities/:entity/conditional, /api/backups, /api/mail/preview/:kind, GET /api/health/build, POST /api/workspace/leave and POST /api/mcp. The CLI does not use these over HTTP: `bin/weave.js:425` runs commands in process through `cliRun()`. MCP tools also run in process (`src/mcp.js:436`), reached over HTTP only through POST /api/mcp or /mcp (`src/routes.js:1941`). So these routes serve outside HTTP API clients with bearer tokens; I did not trace which ones.
- The browser sends no comment write, so `ENTITY_UNDO` in `public/app.js`, the regex table that classifies writes for undo, lists no comment routes.

## Self-contained browser scripts

These nine files wrap their code in an immediately invoked function, so they declare no top-level symbols. The table lists what each one defines inside the wrapper, what it exposes, what loads it and who reads the exposed global. `public/index.html` is the app shell, served for `/` by `serveStatic()` through `createShell()` (`src/server.js:631`).

| Script | Job | Functions defined inside | Exposes | Loaded by | Used by |
| --- | --- | --- | --- | --- | --- |
| `public/actor-core.js` | Parses activity actor strings (person, MCP, workflow) into display names and automation runs. | `displayName()`, `parseActor()`, `actorText()`, `resolveActor()`, `workflowOf()`, `isAutomation()`, `automationWrites()` | `globalThis.weaveActor` (`:66`) with `displayName`, `parseActor`, `actorText`, `resolveActor`, `automationWrites` | `public/index.html:59` (deferred) | `actorChipEl()`, `commentAuthorText()`, `noteAutomationWrites()` in `public/app.js`; `activityPanelCore` in `public/activity-panel.js`; tests `test/actor-core.test.mjs`, `test/system-fields-people.test.mjs` |
| `public/entity-surface-core.js` | Pure state machine for the docked record surface: anchor table, frame chain, pose, and back/forward history. | `clone()`, `init()`, `open()`, `drill()`, `popTo()`, `popTable()`, `toggle()`, `close()`, `escape()`, `selectionId()`, `crumb()`, `reanchor()`, `viewAsTable()`, `clearFilter()`, `hInit()`, `hPush()`, `hCanBack()`, `hCanFwd()`, `hBack()`, `hFwd()` | `globalThis.weaveEntitySurface` (`:121`) with every function except `clone()` | `public/index.html:82` | `dockEntity()` (`init`, `open`), `markDockedRow()` and `renderTable()` (`selectionId`) in `public/app.js`; tests `test/entity-surface-core.test.mjs`, `test/ui-contract.test.mjs` |
| `public/form.js` | Client for the public form page: applies the theme, collects field values, posts the submission with an idempotency key. | `applyTheme()`, `valueOf()`, `collect()`, `wire()`, `requestKey()` | Nothing. It calls `window.bugCore.clientContext()` from `public/bug-core.js` on bug forms | `<script src="/form.js">` in `renderFormPage()`, `src/forms.js:578`, served at GET /f/:form (`src/routes.js:843`); no `public/*.html` loads it | No callers. It sends POST /api/forms/:form/submit (`src/routes.js:852`); tests `test/forms-client.test.mjs`, `test/forms.test.mjs` |
| `public/icon-registry.js` | Generated icon inventory: Lucide names, categories, motion timings, Iconly aliases, mark twins and retired names. Written by `scripts/build-lucide-moving.mjs:171`. | `resolve()`, `canonical()`, `inline()`, `emojiTable()` | `globalThis.weaveIconRegistry` (`:20`) with `NAMES`, `CATEGORY`, `MOTION`, `ALIASES`, `MARK_TWINS`, `RETIRED`, `MARK_ALIASES` and the four functions | `public/index.html:80` | Browser: `lucideEl()`, `iconEl()`, `iconCatalogue()`, `searchPicker()`, `inlineIconAccept()` in `public/app.js`; `slashGlyph()`, `mountDocEditor()` in `public/doc-editor.js`; `iconHtml()` in `public/chip-view.js`; `twin()` in `public/mark-icons.js`. Server: see below |
| `public/mark-icons.js` | Inline SVG paths for the Unicode mark glyphs (progress rings, check, cross, star and others). | `fill()`, `line()`, `twin()`, `has()`, `markSvg()` | `globalThis.weaveMarkIcons` (`:46`) with `MARKS`, `has`, `markSvg`, `twin` | `public/index.html:89` | Browser: `iconEl()` in `public/app.js`; `iconHtml()` in `public/chip-view.js`. Server: see below |
| `public/permalink.js` | On a permalink page, rewrites the address bar to the in-app route from `<meta name="weave-route">`, or redirects to sign-in when the meta has `data-sign-in`. | None (one anonymous function) | Nothing | Injected into the shell head by `entityExportRoutes()` at `src/routes.js:820` (`/t/:table/new`) and `src/routes.js:830` (`/e`, `/s`, `/t` permalinks), and into the signed-out preview page from `previewPageHtml()` (`src/routes.js:138`, used at `:630`) | No callers; it reads the meta tag the server wrote |
| `public/prefs-core.js` | Safe `localStorage` wrapper that never throws and validates string-list values. | `store()`, `read()`, `write()`, `drop()`, `list()` | `globalThis.WeavePrefs` (`:27`) as `{ of: store, read, write, drop, list }` | `public/index.html:94` | `startUsage()`, `applyPaneWidth()`, `wirePaneGutter()`, `renderNav()`, `readPref()`, `writePref()`, `docFoldState()`, `docSectionCollapse()`, `wireNavCollapse()`, `wireNavResize()`, `themePref()`, `cycleTheme()` in `public/app.js` (19 uses); tests `test/prefs-core.test.mjs`, `test/ui-contract.test.mjs` |
| `public/theme-boot.js` | Sets `data-bs-theme` on `<html>` from the `weave-theme` preference or the OS scheme before first paint. | None (one anonymous function) | Nothing | `public/index.html:9` (blocking, in `<head>`) | No callers. `cycleTheme()` in `public/app.js` writes the `weave-theme` key it reads; tests `test/theme-boot.test.mjs`, `test/asset-cache-browser.test.mjs` |
| `public/ws-boot.js` | Redraws the workspace rail and the wordmark before first paint, from the chip specs the last answered `GET /api/workspaces` cached in `localStorage` under `weave-ws-rail`. | None (one anonymous function) | `window.weaveWsRail` with `read`, `write`, `forget`, `currentOf`, `order`, `chipEl`, `paint` and `painted` | `public/index.html:44` (blocking, after the rail and the wordmark are parsed) | `buildWsRail()` in `public/app.js` draws its chips through `chipEl()` and writes the cache; `postLogout()` forgets it; tests `test/ws-rail-boot.test.mjs`, `test/ws-rail-first-paint-browser.test.mjs`, `test/asset-cache-browser.test.mjs` |

Server-side use. `src/` imports only two of the nine, for their globals: `public/icon-registry.js` (`src/engine.js:7`, `src/vocabulary.js:33`, `src/handbook.js:334`, `src/markdown.js:4`) and `public/mark-icons.js` (`src/engine.js:8`, `src/vocabulary.js:110`, `src/markdown.js:4`). On the server, `iconValue()` (`src/engine.js:38`) validates icons with `weaveIconRegistry.resolve()` and `weaveMarkIcons.has()`; `inlineIconHtml()` in `src/markdown.js` renders inline icon tokens from both; `src/vocabulary.js` builds the icon vocabulary from `REGISTRY` and `MARK_CHARS` (`:35`, `:111`); `src/handbook.js:336` reads `ICON_REGISTRY`. The other seven are never imported by `src/`. `public/form.js` and `public/permalink.js` appear in `src/` only as `<script>` tags in server-built HTML.
