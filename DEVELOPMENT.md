# Weave development

GitHub is the canonical repository. Pull requests replace the Gerrit review queue.
Agents work in isolated branches and run targeted checks locally. A ready pull
request lands on main after a fast `Dev gate` and deploys to dev.weave.grunion.ai
within a minute. The full test inventory runs on main. The `promote` workflow
moves production to the newest main commit that passed both the `CI gate` and
the dev soak.

## Daily flow

1. Query the weave Development tracker before work and add the regression test
   before the fix. Keep one concern per worktree and coordinate file ownership.
2. Push the feature branch to origin early and open a GitHub pull request; the
   `PR gate` runs the tests on GitHub-hosted runners. Record the tracker
   reference, changes and test evidence. Never push directly to main. Local runs
   through the shared test manager are optional, for debugging a failure. Read
   the complete diff, including lifecycle, undo, CLI, API and MCP parity. Check
   both themes for UI changes and update the Handbook where behavior changes.
3. Self-review, then arm auto-merge: `gh pr merge --auto --squash`. Two checks
   are required: `Dev gate` (syntax plus a boot health check, under a minute)
   and `PR gate` (the `pr` workflow, under six minutes). The branch does not
   have to be up to date with main.
4. Fix a red `PR gate` by pushing again; a new push cancels the superseded run.
5. Every main push swaps dev.weave.grunion.ai to that commit. The dev supervisor
   boots the new commit beside the serving one, moves traffic only after its
   health check passes, and keeps the old worker serving when it fails. A failed
   commit is skipped until main moves. Roll back a bad change by landing its
   revert. The dev service runs `weave supervise` with `WEAVE_AUTO_UPDATE=1`,
   `WEAVE_TRACK=main` (follow main commits into `releases/c<sha>/`; after every
   swap, failed health check and boot the supervisor deletes every folder under
   `releases/` except the serving commit and the most recently served good one,
   kept for rollback, and never touches `releases/state.json`) and
   `WEAVE_DEPLOY_TOKEN` (32+ characters; `POST /_supervisor/check` with that
   bearer token checks main at once, which the `Deploy dev` job calls).
   `WEAVE_TRACK=branch:<name>` follows another branch, such as a `production`
   promotion branch, with the same `c<sha>` folders and deploy hook. Migrated draft PRs stay drafts until their own review finishes.
6. After every switch the supervisor watches the new release for
   `WEAVE_WATCH_MS` (default ten minutes). The serving worker exiting, three
   failed `/api/health` polls in a row, or a 5xx share of proxied responses at
   or above `WEAVE_WATCH_5XX_RATE` (default 0.25, over at least 20 responses)
   marks the release failed and swaps back, through the same health-checked
   path, to the kept rollback folder, or the image when none is kept.
   `lastSwap.rollback` names the trip and `/api/health` shows
   `supervisor.watch` with `until` and `ok`. A release is written good
   (`.weave-release-ok`) only when its watch passes, so a restart mid-watch
   boots the last proven release; a boot that fails falls back to the newest
   good `v<version>` or `c<sha>` folder before the image.
   Migration rule: a release whose deferred migration wrote to any workspace in
   the data directory (`PRAGMA data_version` moved across the migrate step) is
   never rolled back automatically. It is written good at once, and a later
   trip logs an `ALERT` and sets `watch.alert` for a person to act on; old code
   never runs on a schema a newer release migrated.

## Verification

The `pr` workflow runs on every ready pull request. Its plan, `node
scripts/ci-test.mjs pr-plan`, reuses the full-suite planner: every unit file in
four shards, plus the browser tests the diff maps to, sharded at about twenty
files each, four at most. A changed browser test runs itself. Any other changed
file maps to browser tests named for its module (`public/chip-core.js` maps to
`test/chip-*-browser.test.mjs`) or whose source cites its file name. The diff
also maps by what it names: the plan reads the changed blocks with
`git diff -W`, takes every dashed or slashed literal of six characters or more
out of them (`sheet-grip`, `/api/tables/subtotals`), and adds each browser test
whose source names one. A literal more than `REACH_SPREAD` browser tests name
is too common to place a change, so it is dropped, and the reached tier stops
at `REACH_CAP` files beyond the name matches, which holds the gate inside its
fifteen-minute job timeout. A change to `public/app.js` or `src/routes.js`
therefore runs the journeys that name the DOM classes and routes it touches,
which file names alone never reach (Issue #1075). A fixed smoke set (`SMOKE` in
`scripts/ci-test.mjs`) always runs, so a diff nothing maps to still boots the
app in a browser. `PR gate` succeeds only
when every shard succeeded and `pr-aggregate` finds executed evidence for every
planned file at the exact commit. A newer push to the same pull request cancels
the running one. A browser job bounds each
`playwright install --with-deps` attempt at five minutes with `timeout` and
runs a second one after `dpkg --configure -a`, since a trickling apt mirror
held that step for fifteen minutes three times on 2026-10-23 and took the gate
down with it. The bound lives in the shell, not in `timeout-minutes`: a step
the runner kills on its own timeout cancels the whole job, so `continue-on-error`
never reaches the retry (measured on PR #430, 2026-10-23). The step also writes
an apt drop-in with a twenty-second acquire timeout and three retries, so one
stalled connection no longer costs minutes. The `tests` shard job and the dev
soak carry the same bound, after the mirror held their install for thirty
minutes and cancelled two jobs of the `CI gate` on `14f290cb` (Issue #1107).

The `tests` workflow runs the full inventory on every main push. Its final
`CI gate` succeeds only after every required job succeeds, and a release can
only publish a main commit whose `CI gate` succeeded. Browser dependencies are installed in CI;
a missing browser or skipped required browser suite fails the gate. Parallel CI
jobs have isolated runners and test data. Superseded branch runs are canceled.

Local runs are for debugging: `npm test -- --targeted <file...>` reproduces a
red shard, and CI owns verification. Never invoke bare `node --test`; empty
selections must fail before Node starts. The shared test manager serializes
local browser work across worktrees.
Use `npm test -- --status` to inspect the queue and cancel only your own job.
Browser assertions use `styleOf`, `settled` or `atRest` from
`test/lib/browser.mjs`, never fixed sleeps. `settled` reads the animations
running right now, so it answers at once when the interaction has cleared an
inline transform and the transition it starts has not been resolved yet.
`atRest(locator)` is the wait for that: it holds until the element has no
running animation, its transform is identity and its box has stayed put for a
frame (Issue #901).
`WEAVE_CPU_THROTTLE=4` helps reproduce gate-only browser failures.
Retries remain visible in test output; repeated flakiness gets a tracker issue.

### Sheriff

`.github/workflows/sheriff.yml` owns a red main (Feature #320). A failed main
push `tests` run gets its failed jobs rerun once by `scripts/sheriff.mjs`. A green
rerun is a flake: it appends a line to the Issue row
`Error: <test file> flakes on main`, creating it if none is open, and stops. A
second red finds the commits since the last main run whose `CI gate` succeeded
and bisects them by dispatching `tests` with its `ref` input, at most four
runs. Completed runs for a commit are reused for free. It then opens a
`sheriff/revert-<sha>` PR with squash auto-merge, comments on the original PR,
files `Error: <test> fails on main after PR #<n>` with the run links, and writes
one alert line to the job summary and `SHERIFF_ALERT_URL`. Past the cap it
reverts what is still suspect. It never reverts a revert, never acts on a
culprit that already has a revert branch, never pushes to main and never
forces a push. Replay a run without writing anything:
`gh workflow run sheriff -f run_id=<id> -f dry_run=true`, or locally
`node scripts/sheriff.mjs <id> --dry-run`.

Secrets: `SHERIFF_TOKEN` (fine-grained token with contents, pull requests,
actions and workflows write, so the revert PR starts `Dev gate` and its merge
starts `tests`; without it the PR opens unarmed and the sheriff job fails), `WEAVE_TRACKER_TOKEN`
(a dedicated editor bearer for the canonical tracker; a missing token fails incident and flake recording) and the
optional `SHERIFF_ALERT_URL`, which receives the alert line as a POST body. When
`SHERIFF_ALERT_TOKEN` is also set, the POST carries `Authorization: Bearer <token>`;
the `weave-alerts` Worker refuses a request without it. The repository's
Actions setting must allow GitHub Actions to create pull requests when using
the built-in token. Keep the default workflow permission read-only; the sheriff
job declares its required write permissions. Scope `SHERIFF_TOKEN` to this
repository only. An escalation or unarmed revert fails the sheriff job after
writing its evidence. Read-only dry runs still succeed.

### Dev smoke and soak

`.github/workflows/dev-soak.yml` runs after the `dev` workflow's `Deploy dev`
job confirms a main commit is serving on dev.weave.grunion.ai. It runs
`scripts/dev-soak.mjs`: a Playwright smoke (load the app, open the `/w/weave`
workspace, open a table, open a document) every three minutes for fifteen
minutes, and dev's `/api/health` every thirty seconds. A failed smoke runs
again at once; a second failure in a row fails the soak. The soak passes when
the supervisor's `watch` for `c<sha>` reports `ok: true`, no rollback
happened, the worker's pid never changed and dev answered no 5xx. It then
posts the commit status `dev-soak` (success) on that SHA; promotion reads that
context. A failure posts `dev-soak` failure linking the run and sends one line
to `SHERIFF_ALERT_URL` and the job summary. A newer main commit cancels the
older run, and a soak that sees dev move to newer main posts nothing.

With the `DEV_SMOKE_TOKEN` secret (an editor `wv_` token on dev) the smoke
also creates a row through the API, sees it in the grid, and hard-deletes it,
in the workspace named by the `DEV_SMOKE_WORKSPACE` variable (default
`/w/smoke`, which needs at least one table). Without it the smoke covers the
anonymous read surface only. Run one smoke locally with
`node scripts/dev-soak.mjs smoke`, or soak a commit dev serves with
`gh workflow run dev-soak -f sha=<sha>`.

## Releasing

A release starts with a notes-bearing `Development/Release` row in the canonical
weave workspace on `:4400`: name `v<version>`, Date, Commit, Fixes and Ships relations,
and Description. Preserve this tracker contract before bumping `package.json`.

```bash
node scripts/export-development.mjs
node scripts/changelog-fold.mjs
node scripts/architecture.mjs
```

The fold also stamps the version into `server.json`. After the `publish` job tags
the release, `release.yml` pushes `ghcr.io/grunion-ai/weave:<version>` and
`:latest`, then publishes `server.json` to the Official MCP Registry with a pinned
`mcp-publisher` signed in through GitHub OIDC.

### Canonical tracker

The `weave` docs workspace on production, https://weave.grunion.ai/w/weave, is
the one canonical tracker for Development/Issue, Feature and Release rows. Every
other server holds a read copy that boot syncs from `docs/development.json`.

- The canonical server sets `WEAVE_TRACKER_CANONICAL=1`. Boot then skips the
  manifest sync and logs one line saying so, so edits made on the tracker are
  never overwritten by an older build's manifest. A canonical server never
  forwards bug reports.
- Every other Grunion server sets `WEAVE_BUG_FORWARD_URL` to the workspace base
  (`https://weave.grunion.ai/w/weave`) and `WEAVE_BUG_FORWARD_TOKEN` to a bearer
  token for it. `POST /api/bug-report` then posts the report to
  `<url>/api/bug-report` with the instance's origin (`WEAVE_ORIGIN`, or the
  request host) as `instance`, which the canonical report shows as its Instance
  row. A forwarded report answers 201 with the canonical row and `forwardedTo`.
  A network error, a 10 s timeout or a non-2xx answer files the report locally
  as before, notes "Forward to <url> failed: <reason>" in it, and answers with
  `forward: "failed"` and `forwardError`. With either variable unset nothing is
  forwarded.
- Export reads the canonical tracker over HTTP:
  `node scripts/export-development.mjs --from https://weave.grunion.ai/w/weave --token-env WEAVE_TRACKER_TOKEN`.
  The file mode (`node scripts/export-development.mjs [path/to/weave.db]`) still
  works, and `--out <path>` writes somewhere other than `docs/development.json`.

Land the version, exported manifest, folded changelog and architecture map in one
PR. Between releases every change adds its own
`changelog.d/<short-slug>-<Issue or Feature number>.md`; only a version bump edits
CHANGELOG.md. The fold sorts and deletes fragments. A refactor or documentation
change without a release bullet carries `No-changelog: <reason>` in its commit.
The changelog and development-sync tests enforce these contracts.

Releases publish automatically after successful same-repository main push `tests`
runs and never move production. Retry publication by dispatching the
`release` workflow with that tests run ID.
Its read-only guard validates the same-repository event, run ID and completed
`CI gate`. Its publishing job checks out the exact tested SHA and checks GitHub
main again; a superseded run skips publication. The publisher validates the
version, matching tracker manifest and nonempty `## v<version>` changelog
section before creating an immutable `v<version>` tag and GitHub Release.
Existing published ancestor versions stay unchanged. A partial publication
resumes only if its tag names the tested commit; a conflicting tag fails and is
never moved. To revert a release, land a tested revert PR and cut a new version.
Historical recovery uses `gh workflow run release -f run_id=<id> -f historical=true`.
It requires a successful main push tests run for a commit still on main history.
It publishes that exact commit, leaves GitHub Latest and the image `:latest` alone,
and never moves an existing tag. Recover versions oldest first. A later ordinary
run uses the existing immutable tag for image and registry retries. Automatic
runs skip image and registry publication for an already published ancestor version.
Confirm the publication with `gh release list -R grunion-ai/weave --limit 1`.

### Production promotion

Production follows the `production` branch. The hosted supervisor at
https://weave.grunion.ai runs with `WEAVE_TRACK=branch:production` and a
`WEAVE_DEPLOY_TOKEN`, so it serves `releases/c<sha>/` folders and swaps, watches
and rolls back exactly as dev does (Daily flow, steps 5 and 6).

`.github/workflows/promote.yml` (Feature #322) moves the branch. It runs every
hour and acts when the UTC hour is a multiple of the repository variable
`PROMOTION_EVERY_HOURS` (default 2); `workflow_dispatch` acts at once, and its
`dry_run` input only prints the pick. `scripts/promote.mjs select` picks the
newest main commit that has a push `tests` run whose `CI gate` succeeded and a
`dev-soak` commit status of success, and that descends from the `production`
head. With none it exits quietly. The `promote` job then, in the `production`
environment:

1. pushes `<sha>:refs/heads/production` through the promotion deploy key
   (`PROMOTION_DEPLOY_KEY`), a fast-forward that is never forced;
2. calls `POST /_supervisor/check` with `PROD_DEPLOY_TOKEN`;
3. waits up to 25 minutes for `/api/health` to show `supervisor.commit` at that
   SHA, `lastSwap.ok` true and `supervisor.watch` for `c<sha>` with `ok` true.

A failed watch or a rollback fails the run, files the Issue row
`Error: production rolled back the promotion of <sha>`, writes one alert line
and opens a `promote/revert-<sha>` PR on main for the promoted range (armed when
`SHERIFF_TOKEN` is set). `production` is never rewound: it stays on the failed
commit while prod serves its rollback, and the next promotion waits for a main
commit that reverts it. A timeout files and alerts without a revert.

Set the repository variable `PROMOTION_PAUSED=true` to stop promotion; delete it
or set it to anything else to resume. Two rulesets guard the branch: nobody
deletes it or pushes a non-fast-forward, and only the promotion deploy key
updates it. Both secrets live in the `production` environment, which has no
required reviewer and admits main only.

After a promotion passes its watch, the job runs `node scripts/exposure.mjs`
(Issue #879). It reads every workspace name from `GET /_supervisor/workspaces`,
which the worker answers only to `Bearer <WEAVE_DEPLOY_TOKEN>`, then asks each
one for `GET /api/tables` with no credentials, by `/w/<name>/` and by
`<name>.weave.grunion.ai`. Any 200 fails the run, unless the workspace is named
in the repository variable `PUBLIC_WORKSPACES` (comma-separated). Run it by hand
with `WEAVE_DEPLOY_TOKEN` set to the production token.

Check a promotion:

```bash
gh run list -R grunion-ai/weave --workflow promote --limit 3
gh api repos/grunion-ai/weave/branches/production --jq .commit.sha
curl -fsS https://weave.grunion.ai/api/health
```

Never hand-deploy Railway after a routine landing. Container redeployment is
reserved for Node, Dockerfile or supervisor changes.

## Architecture map

`docs/architecture/` holds an interactive map of the runtime rendered by
[archify](https://github.com/tt-a1i/archify): `weave.architecture.json` is the source,
`weave.architecture.html` the rendered page, and every node links to its code at the
commit named in `meta.repository.revision`. `test/architecture-map.test.mjs` goes red
when a cited file moves or is deleted, when a new `src/` or `bin/` module is not named
on the map, or when the HTML no longer matches the JSON. The change that trips it
updates the JSON and runs `node scripts/architecture.mjs`, which re-pins HEAD and
re-renders. Release step 5 re-pins it too, so every tagged version carries a map of the
code it shipped. archify is a dev tool, found at `$ARCHIFY` or
`~/.claude/skills/archify/bin/archify.mjs`; weave never depends on it.

## Retired Gerrit queue

Gerrit and its review worker are retired from the landing path. Preserve their
repositories and open-change exports until migrated draft PRs are reconciled.
Do not run the old mirror or release publisher alongside GitHub delivery. Retained
Gerrit refs are historical recovery material, not an authority for new landings.

## Shared test manager

Use `npm test` for full verification and pass several filenames to batch related
regression checks. Every CLI request enters one per-user FIFO queue shared across
worktrees, and one job runs at a time, in `scripts/test.mjs`'s two lanes (unit suites
at node's default, browser suites at half the cores). A persistent browser
server supplies fresh Playwright connections and contexts to each browser suite;
closing one suite cannot close another suite's contexts. Direct browser-harness
callers also lease this queue. Use the CLI for predictable whole-job admission.

| Operation | Command |
| --- | --- |
| Batch targeted regressions | `npm test -- --targeted test/formula.test.mjs test/service.test.mjs` |
| Inspect affected selection | `npm test -- --affected --base=HEAD --plan` |
| Run affected selection | `npm test -- --affected --base=HEAD` |
| Landing check | GitHub Actions `dev` runs `Dev gate` on ready pull requests |
| Full verification | GitHub Actions `tests` runs every suite on main; `CI gate` reports the result |
| Queue and browser status | `npm test -- --status` |
| Cancel one queued or active job | `npm test -- --cancel=<id>` |
| Stop owned jobs and browser | `npm test -- --stop` |
| Bound one job, milliseconds | `npm test -- --timeout=120000 test/formula.test.mjs` |

Affected selection includes staged, unstaged and untracked files relative to the
base. Only changed tests narrow it; source, UI, configuration and unknown paths
require the full suite. The
printed plan explains the decision. Full landing verification remains mandatory.
An empty explicit selection fails. File lists must name existing files; use
`--test-name-pattern='pattern'` or its separate-value form to filter test names.

The manager hashes source files and selected tests at enqueue, start and finish.
A changed worktree invalidates the result. Results are never cached, and duplicate
requests remain separate jobs. Keep the worktree unchanged while tests run. An
agent may assess scope or propose redundant-test removal, but cannot omit required
verification. Existing `run()` imports are the low-level synchronous fixture API;
agents submit work through the CLI.

The browser recycles between jobs after 20 browser jobs or 15 minutes, after job
failure/cancellation, and when admission is blocked by resource pressure. The
manager exits after five idle minutes. It starts automatically on the next request.
Browser versions and browser kinds use separate lifetimes. `WEAVE_BROWSER=webkit`
uses the same queue. No npm dependency or launchd job is installed.

Admission waits below 10 GB available disk, below 10% available memory, or above a
one-minute load average of twice the CPU count. Status and waiting messages name
the reason. An admitted job times out after one hour by default, the gate's 3600 s
cap, which is also the maximum `--timeout`. Queue waiting expires after
`WEAVE_TEST_QUEUE_WAIT_MS` (default 30 minutes). A job that is never admitted, because
its wait ran out or the manager stopped first, prints
`# TEST MANAGER NOT ADMITTED: <reason>` and exits 75: its tests did not run, so a gate
skips its vote rather than rejecting. A disconnect cancels its job. A responsive
supervisor reaps the owned process group if the manager dies. Job temp directories
are removed after process cleanup; stale manager-owned temp directories older than
24 hours are pruned on startup. Other agents' files and processes are untouched.

`WEAVE_TEST_MIN_FREE_GB`, `WEAVE_TEST_MIN_MEMORY_PERCENT`, `WEAVE_TEST_MAX_LOAD` and
`WEAVE_TEST_QUEUE_WAIT_MS` override admission for a deliberately sized CI machine, or
for a caller that is already serial, such as a hosted CI runner. A raw `node --test`
browser suite sends them with its lease. Keep the defaults for ad hoc runs on this
shared workstation. One process holds one browser lease however many times its suites
call `launch()`, and releases it when the last connection closes.
`WEAVE_TEST_MANAGER_DIR` selects a private socket directory for isolated manager
integration tests; ordinary jobs use the shared default, which is keyed on a hash of
`scripts/test-manager.mjs`. Worktrees on the same manager code share one queue; a
worktree with changed manager code gets its own manager, and the old one exits after
five idle minutes. `--stop` cancels active work, so inspect `--status` first.

## State catalog

`test/lib/states.mjs` lists the states of the product as data, so every browser
probe walks the same list. A surface in `SURFACES` is a route and layout with its
`url(ctx, cell)`, `ready(cell)` selector, `root(cell)` selector, the seeds it is
built for and an optional `setup`. An entry in `OPENS` is an open state: a
dialog, popover, menu or sheet with its `root`, an `open(page, ctx, cell)` and an
optional `close`. Each surface's `states` crosses an open state, or none for the
surface at rest, with its cells, a seed from `test/lib/seeds.mjs` and the tags of
the probes that walk it. `STATES` is that product, one entry per id
`seed:surface+open@cell`.

A probe asks for its slice: `states({ tag: 'cutoff' })`, `states({ tag: 'a11y' })`,
`states({ tag: 'touch' })`, or `states()` for every state, and can narrow by
`cell`, `seed`, `surface` or `open`. The cut-off sweep, the a11y gate and the
touch-target gate read their states this way; the flicker journeys name their
`surface` and reach it through the catalog's url and ready selector.

A new surface, layout or open state is added to the catalog once, never to one
probe. Adding it is one entry, plus a tag for each probe that should walk it.
A probe that widens its slice may surface defects its baseline never held: fix
them, or admit them through that probe's reason-bearing mechanism, in the same
change. `test/states-core.test.mjs` guards the shape: unique ids and names, every
reach field present, every open state used, every seed buildable and every
probe's slice non-empty.

## Flicker loop

A flicker is something the reader saw that should not have been there: a node
painted for a beat and gone, a list painted empty and refilled, a class that
flipped and flipped back, content that jumped with no input, a screencast
frame that differs from both neighbours while they match. `test/lib/flicker.mjs`
is the probe; `test/lib/journeys.mjs` is the nine journeys it walks (load,
open a table, scroll, edit a cell, open a row, switch view, type in a
document, trash and undo, flip the theme).

```bash
node scripts/flicker-sweep.mjs                         # 3 runs, keeps what 2 saw
node scripts/flicker-sweep.mjs --journey open-row --runs 1 --min 1   # reproduce one
```

The harness routine `weave-flicker` runs the sweep nightly against GitHub main
and files each confirmed finding as an Issue row carrying its fingerprint
(`journey|kind|selector`) and the frames around it. The overnight fixer picks
those rows up like any other. **Fixing one:** reproduce with the sweep, fix,
and add the fingerprint to `test/flicker-fixed.json` with the Issue number in
the same change. `test/flicker-gate-browser.test.mjs` walks every journey in
the gate and fails when a listed fingerprint comes back, so a fixed flicker
stays fixed. A journey whose selectors rot fails the gate too.

The gate reads the DOM probe only, so it reads the kinds in `GATED`
(`transient`, `blank`, `revert`, `shift`, `cut`). A `frame` finding comes from
the sweep's screencast, which the gate does not run: taking it would put the
gate's own paint timing into the result. `fixedFault` refuses a `frame`,
`jank` or `rerender` key in `test/flicker-fixed.json` for that reason
(`test/flicker-core.test.mjs`, Issue #702), because such an entry would sit
there unchecked. Hold a frame finding with a `frameFlashes` case in
`test/flicker-core.test.mjs` built from the frames on the Issue row, and mark
the row Fixed naming that case.

## Click budget

Every journey in `test/lib/journeys.mjs` is an action a person takes, and
`walk` counts the clicks it takes: trusted primary pointer presses (mouse
clicks and taps) during the run phase. Setup clicks, keys and scripted
`element.click()` calls count nothing. `test/click-budget.json` holds the
budget per `journey|cell`.

`test/click-budget-browser.test.mjs` walks every journey on every PR (it is in
`SMOKE`) and logs `clicks <journey|cell> <count> budget <n>` as a test
diagnostic. Budgets only ratchet down:

- a count above its budget fails: remove the extra click;
- a count below its budget fails until the same change lowers the budget, so
  the saving holds;
- a new journey adds its own `journey|cell` entry with its measured count.

Raising a budget is the one way to merge an action that takes more clicks.
`test/click-budget.test.mjs` compares the file with `HEAD^1` and refuses a
raised number unless the same change writes a new reason under
`raised["<journey|cell>"]`. The reason names the Issue or Feature that needs
the click.

## Vitals budget

`test/vitals-budget-browser.test.mjs` loads home (`#/`) and a table
(`#/table/<id>`) cold, once to warm up and then seven times, on desktop and on the phone, and reads
LCP, CLS and INP from PerformanceObserver (`test/lib/vitals.mjs`). After the
page is ready it makes one real interaction for INP: desktop opens the Task
table from the sidebar or a row's dock, the phone opens the menu or taps a row.
CLS is the largest session window of shifts without recent input. The medians
are judged against `test/vitals-budget.json`
(`vitals["<journey|cell|metric>"]`) and logged as
`vitals <journey|cell|metric> <value> runs <...> budget <n>`. The phone cell runs
Chromium with the iPhone 15 profile, because WebKit reports no `layout-shift`
entries. Budgets hold the Linux runner's medians with headroom; a raise needs a
new reason under `raised[...]`, checked against `HEAD^1` by
`test/vitals-budget.test.mjs`.

## Feedback budget

An action answers on screen before the server does. `test/feedback-budget-browser.test.mjs`
walks every journey three times with each `/api/` request held 1000 ms by a
Playwright route, and times each trusted press or commit key (Enter, Tab,
Escape) to the first animation frame after a visible DOM change. A skeleton, a
loader or `aria-busy` is not an answer. The journey's time is its slowest
action; the gate reads the median of the three walks against
`test/feedback-budget.json` (`ms["<journey|cell>"]`) and logs
`feedback <journey|cell> <ms> runs <a,b,c> budget <n> acts <kind:ms ...>`.

A fourth walk runs against the unheld server and refuses any loading state
shown for an action that settles inside the skeleton delay: a skeleton or
loader visible sooner than `SKELETON_SHOW_AFTER_MS` after an action, or
`aria-busy` that sets and clears inside it. `busy["<journey|cell>"]` lets a
journey off that check only while it names the Issue that will fix it.

Budgets hold the Linux runner's times with headroom, since a timing gate cannot
ratchet down on every run the way clicks do. A time over its budget fails.
Raising a budget needs a new reason under `raised["<journey|cell>"]`, checked
against `HEAD^1` by `test/feedback-budget.test.mjs`, the same rule as the click
budget. Journeys that wait on the server today carry their measured time and the
`Slow:` Issue that tracks them; lower the budget in the change that fixes one.

## Render budget

`test/render-budget-browser.test.mjs` walks every journey three times with the
flicker probe and counts its renders: animation frames in which the app wrote to
the DOM under `<body>` (child lists, `class`, `hidden` or `style`). The median
of three walks is judged against `test/render-budget.json`
(`renders["<journey|cell>"]`) and logged as
`renders <journey|cell> <n> runs <a,b,c> budget <n>`. Budgets hold the Linux
runner's largest median plus a quarter and one frame, since network timing
splits writes across frames from run to run. A count over its budget fails.
Batch the writes, or raise the budget with a new reason under
`raised["<journey|cell>"]`, which `test/render-budget.test.mjs` checks against
`HEAD^1`.

## Cut-off loop

Weave never shows cut-off text. `test/lib/cutoff.mjs` is the probe: a page
function that reports text cut by an overflow hidden or clip box (`clipped`), a
truncated `text-overflow: ellipsis` box (`ellipsis`), a `-webkit-line-clamp` box
holding more lines than it shows (`line-clamp`), and an input or textarea whose
value or placeholder runs past its box (`field-value`, `field-placeholder`).
Text inside an overflow auto or scroll container, visually hidden text and
invisible elements are not cut-offs. A finding's fingerprint is its kind plus its
selector with every number folded to `#`, and `|phone` for the phone cell.

```bash
node scripts/cutoff-sweep.mjs                       # both cells, writes cutoff-out/findings.json
node scripts/cutoff-sweep.mjs --cell phone --overlay field-editor,new-field   # reproduce one
node scripts/cutoff-sweep.mjs --lower               # after a fix: lower this platform's baseline
```

The sweep walks the flicker journeys and opens every dialog and popover the state
catalog tags `cutoff` (`test/lib/states.mjs`), at desktop 1440x900 in Chromium and
phone 390x844 in WebKit, on the messy seed. `test/cutoff-gate-browser.test.mjs` runs the same
sweep in the gate against `test/cutoff-baseline.json`, which holds today's counts
per platform, since system fonts differ between macOS and the Linux CI runner.
The baseline is a ceiling. The gate fails on a fingerprint the baseline does not
hold, or more instances than it holds. A count under the ceiling is a stale
baseline: the gate prints it as `stale:` and passes, since the same commit
measured one breadcrumb fingerprint 5, 7 and 8 times on loaded runners (Issue
#1103). `test/cutoff-core.test.mjs` refuses a baseline that grows past its
committed version or past the base a pull request merges into, so the ceiling
only ever comes down. **Fixing one:** fix the cut-off, run the sweep until the
lower count holds, run it once with `--lower`, and commit the lowered counts in
the same change. A red gate prints the Linux counts it measured; copy them into
the `linux` section.

### Mandatory onboarding verification

[The onboarding verification contract](docs/onboarding-verification.md) maps the
required journeys, permutations and remaining coverage gaps to executable tests.
`ONBOARDING` in `scripts/ci-test.mjs` runs on every ready PR, alongside `SMOKE`,
regardless of diff selection. Missing mandatory suites fail planning. Keep the
contract and regression assertions current in the same PR as a flow change.
