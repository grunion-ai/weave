# Weave development

GitHub is the canonical repository. Pull requests replace the Gerrit review queue.
Agents work in isolated branches, run targeted checks locally, and let hosted CI
run the full required test inventory before merging.

## Daily flow

1. Query the weave Development tracker before work and add the regression test
   before the fix. Keep one concern per worktree and coordinate file ownership.
2. Run relevant local tests with explicit filenames. Read the complete diff,
   including lifecycle, undo, CLI, API and MCP parity. Check both themes for UI
   changes and update the Handbook where behavior changes.
3. Push the feature branch to origin and open a GitHub pull request. Record the
   tracker reference, changes and test evidence. Never push directly to main.
4. Require the `CI gate` check on the exact current PR merge candidate. Branch
   protection requires the branch to be up to date with main. If main advances,
   update the branch and wait for fresh checks; an earlier green SHA cannot land.
5. The shipping agent self-reviews and squash-merges after all required checks
   pass, then verifies main CI and delivery. Do not bypass branch protection.
   Migrated draft PRs stay drafts until their individual review and checks finish.

## Verification

The `tests` workflow owns full landing verification. Its final `CI gate` succeeds
only after every required job succeeds. Browser dependencies are installed in CI;
a missing browser or skipped required browser suite fails the gate. Parallel CI
jobs have isolated runners and test data. Superseded branch runs are canceled.

Local workers use `npm test -- --targeted <file...>` and leave full verification
to CI. Never invoke bare `node --test`; empty selections must fail before Node
starts. The shared test manager serializes local browser work across worktrees.
Use `npm test -- --status` to inspect the queue and cancel only your own job.
Browser assertions use `styleOf` or `settled` from `test/lib/browser.mjs`, never
fixed sleeps. `WEAVE_CPU_THROTTLE=4` helps reproduce gate-only browser failures.
Retries remain visible in test output; repeated flakiness gets a tracker issue.

## Releasing

A release starts with a notes-bearing `Development/Release` row in the canonical
weave workspace on `:4400`: name `v<version>`, Date, Commit, Fixes and Ships relations,
and Description. Preserve this tracker contract before bumping `package.json`.

```bash
node scripts/export-development.mjs
node scripts/changelog-fold.mjs
node scripts/architecture.mjs
```

Land the version, exported manifest, folded changelog and architecture map in one
PR. Between releases every change adds its own
`changelog.d/<short-slug>-<Issue or Feature number>.md`; only a version bump edits
CHANGELOG.md. The fold sorts and deletes fragments. A refactor or documentation
change without a release bullet carries `No-changelog: <reason>` in its commit.
The changelog and development-sync tests enforce these contracts.

After the `CI gate` succeeds on a main push, `tests` calls the reusable `release`
workflow. Its read-only guard validates the same-repository event, current run
ID and completed `CI gate`. Pull requests never call release publication. Its publishing
job checks out the exact tested SHA and checks GitHub main again. A superseded run
skips publication so the newer main run owns delivery. The publisher validates the
version, matching tracker manifest and nonempty `## v<version>` changelog section
before creating an immutable `v<version>` tag and GitHub Release. Existing published ancestor versions stay
unchanged. A partial publication resumes only if its tag names the tested commit;
a conflicting tag fails and is never moved.

The hosted supervisor at https://weave.grunion.ai polls GitHub releases every ten
minutes. It downloads the tag's immutable SHA, checks health, and swaps workers.
The release job polls health for at most 90 attempts, with ten-second intervals and
five-second request timeouts. Success requires the exact package version and
`supervisor.release` tag. A rejected update or timeout fails the workflow visibly.
For a no-version-change landing, an existing image at the matching version is a
valid baseline. The local deployment watcher separately follows verified GitHub
main into `~/.weave-serve` and refreshes the local tracker and quality mirror.

Recovery uses Actions' `release` workflow dispatch with the main push `tests`
run ID. The same event, gate, SHA and current-main checks apply. A completed run
with failed delivery jobs can retry only when the CI gate succeeded and no test
job failed. Other failed or canceled runs cannot publish.
Confirm the workflow is green and the expected release is Latest:

```bash
gh release list -R grunion-ai/weave --limit 1
curl -fsS https://weave.grunion.ai/api/health
```

Never hand-deploy Railway after a routine landing. The release tag is the hosted
deployment. Container redeployment is reserved for Node, Dockerfile or supervisor
changes. To revert application behavior, land a tested revert PR and cut a new
version; never retarget an existing release tag.

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
| Full landing verification | GitHub Actions `tests` runs every required suite; `CI gate` reports the result |
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
