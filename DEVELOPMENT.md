# Weave — Standard Development Approach

Two layers, adopted 2026-08-22. Rationale: multiple concurrent AI agents (plus Kyle)
write to this repo; git-alone had no isolation and GitHub-PR review is human-paced.

| Layer | Tool | What it buys |
| --- | --- | --- |
| Local VCS | **jj (colocated)** | Every working-copy change auto-snapshotted; any operation undoable (`jj undo`); lock-free concurrent ops; agents can't clobber uncommitted work |
| Review & landing | **Gerrit change queue** (local, `http://localhost:8282`) | Each push is a *change* with iterating patchsets; Verified vote gates landing; submit queue serializes merges |
| Mirror | GitHub `grunion-ai/weave` | Unchanged remote; push pending grunion credential |

## Daily flow

```bash
# hack (jj snapshots continuously; git commands still work — repo is colocated)
jj st                                  # see snapshot state
jj describe -m "viewer: fix X (#NN)"   # describe current change

# send for review — every commit needs a Change-Id (hook installed)
git push gerrit HEAD:refs/for/main

# approve + land — the shipping agent does this itself (Kyle, 2026-09-02)
# after its own review pass; the +2 message names what was reviewed and
# which tests were added. UI: http://localhost:8282  — or REST:
#   POST /a/changes/<n>/revisions/current/review {"labels":{"Code-Review":2},"message":"..."}
# after Code-Review +2, the poller verifies the exact patchset and casts Verified ±1
# wait for Verified +1; do not launch a second manual gate
#   POST /a/changes/<n>/submit        # 409 = main moved: rebase, re-push, await gate

# sync landed work back
git fetch gerrit && jj rebase -d main@gerrit   # or: git pull gerrit main
```

## Rules for agents

1. **Never push directly to `refs/heads/main`.** All work goes through `refs/for/main`.
2. **One logical change per push.** Re-push amended commits to iterate the same change
   (the Change-Id keeps them together) instead of opening new ones.
3. **Verified is earned, not asserted**: the poller runs `weave-review.sh`, which runs
   the authoritative full `npm test` gate on the exact patchset in an isolated
   worktree. A red suite votes −1 and blocks submit. Workers run targeted tests
   before committing, then push once, self-review and cast Code-Review +2. The
   poller selects reviewed stack tips without a Verified vote. Wait for its result. Do not launch a
   duplicate manual gate while the poller owns the queue.
   The `*-browser.test.mjs` suites `import('playwright')` and skip on a bare checkout;
   the gate links its shared install (`~/.gerrit/weave/pw/node_modules`) into the
   worktree and votes −1 if they skipped anyway. For targeted browser tests, link
   `~/.gerrit/weave/pw/node_modules` as `node_modules` (gitignored), then name the
   test files explicitly: `node scripts/test.mjs test/<name>.test.mjs`. An empty
   dynamic file selection must stop; bare `node --test` discovers extra scripts.
   A browser case that is red in the gate and green alone is almost always a
   read taken after a fixed sleep; `WEAVE_CPU_THROTTLE=4 node --test <file>`
   slows each page fourfold and usually turns it red on a quiet machine.
4. Parallel workers use separate worktrees and coordinate file ownership. Gerrit
   serializes submit; the poller owns full verification. Keep local checks targeted
   so workers do not compete with the gate for CPU, memory, or browser capacity.
5. jj is the local safety net: after any suspected clobber, `jj op log` + `jj undo`.
6. **The shipping agent lands its own change.** Before +2: read the whole diff again,
   check tombstone/undo/lifecycle paths, CLI + route + MCP parity for any new engine
   verb, both themes for UI, the Handbook when chrome or a field type is new; add the
   tests that assert each of those (a regression gets its failing test first). Then
   +2 with a message naming what was tightened and which tests were added, submit,
   and confirm MERGED. Never leave a green change parked for someone else's +2.
7. **Never push `origin main`.** The repo's pre-push hook refuses it. The main watcher
   (`harness/scripts/weave-review-poll.mjs`) mirrors a green gerrit/main to GitHub
   fast-forward only, ff-pulls `~/.weave-serve`, restarts launchd `ai.grunion.weave`,
   and files a weave Issue if :4400 is not launchd's pid started after the landing.
8. **Never hand-deploy the hosted instance after a landing** (Feature #250,
   2026-10-03). https://weave.grunion.ai runs `node bin/weave.js supervise` with
   `WEAVE_AUTO_UPDATE=1`: within ten minutes of a `v<version>` tag on GitHub it
   unpacks the release and swaps workers with no failed request
   (`/api/health` → `supervisor.release`, `supervisor.lastSwap`). A Railway
   `serviceInstanceDeployV2` restarts the container, fails requests for 20 to 60
   seconds and resets that state. Redeploy only for a change to the Node version,
   the `Dockerfile` or `src/supervisor.js`. To ship a fix to the host, cut a
   release (below); the tag is the deploy.

## Releasing

A release is a `Development/Release` row in the weave docs workspace first and a version
bump second. The row carries the version as its name, Date, Commit, `Fixes` (Issues) and
`Ships` (Features) relations, and the release notes as its Description — the notes are
mandatory. `scripts/export-development.mjs` refuses to run without a notes-bearing row
named `v<package.json version>`, `syncDevelopment` refuses a manifest release without
notes, and `test/development-sync.test.mjs` fails the build, so an unwritten release
cannot pass the gate.

```bash
# 1. write the Release row (notes in Description) on the canonical workspace, :4400
# 2. bump package.json
node scripts/export-development.mjs        # 3. docs/development.json gains the release
node scripts/changelog-fold.mjs            # 4. every changelog.d/ fragment moves under
#    `## v<version>` in CHANGELOG.md and the fragments are deleted; edit the digest if
#    needed
node scripts/architecture.mjs              # 5. re-pin docs/architecture/ to the landed
#    base, then land steps 2-5 through Gerrit as one change
# 6. automatic: the main watcher tags and publishes it. Then confirm it did:
gh release list -R grunion-ai/weave --limit 1   # the new version, marked Latest
```

Between releases nothing edits CHANGELOG.md. Each change adds its own fragment,
`changelog.d/<short-slug>-<Issue or Feature number>.md`, holding its bullet(s), so no two
open changes touch the same file and Gerrit rebases them without a hand (Issue #408: when
every change added a bullet under `## Unreleased`, each landing sent every open change
back for a hand rebase and a fresh gate). Step 4 folds the fragments, sorted by file name;
it is idempotent, so a second run changes nothing. `test/changelog-fragments.test.mjs`
guards both directions: it fails a commit that adds lines to CHANGELOG.md without changing
the package.json version, and it fails a commit that changes `src/`, `public/`, `bin/` or
`scripts/` and names `(Issue #N)` or `(Feature #N)` in its subject while adding no fragment
(Issue #573: change 527 landed `e85ada8` with nine files and no fragment, and its fix reached
the v0.4.54 notes only because the bullet was written by hand). A refactor or a docs-only
change that owes no bullet says so in a `No-changelog: <reason>` trailer; a release commit,
which bumps the version and deletes the fragments it folded, is exempt.

Step 6 is the one users see. After the change lands and the main watcher mirrors the
green gerrit/main to GitHub (rule 7), it runs `harness/scripts/weave-release-tags.mjs`:
every version in the landed range with no `v<version>` tag gets an annotated
`v<version>` tag on the commit that introduced it, pushed to GitHub, and a GitHub Release
titled `weave v<version>` whose notes are that version's `## v<version>` section of
CHANGELOG.md. A normal landing needs no hand on it. Without the tag and the Release a bump is
invisible: `gh release list`, the repo's Releases sidebar and `git describe` keep naming
the last tagged build, which is how an install sat on 0.4.4 while main was at 0.4.15
(Issue #253). The notes are mandatory here too: a version with no `## v<version>`
section is skipped rather than published empty, and the watcher files a weave Issue
named `weave v<version> did not publish a GitHub Release`.

The check is not automatic. Whoever lands the bump confirms, the same day, that
`gh release list -R grunion-ai/weave` names the new version as Latest. The watcher runs
on the Mac that hosts Gerrit, from `~/.harness-serve`, a detached harness worktree kept at
the harness `origin/main` (launchd jobs `ai.grunion.weave-review` and
`ai.grunion.weave-deploy`). It once ran from a shared checkout that sat on another
branch, and v0.4.16 went out untagged on 2026-09-10 because of it. The tagger compares
against the tags and Releases on GitHub, never local tags.
`node scripts/weave-release-tags.mjs --dry-run` in `~/.harness-serve` prints every version
still owed a tag or a Release; write the missing CHANGELOG section or fix the push, then
run it without `--dry-run`.

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

## Service operations

| What | How |
| --- | --- |
| Status | `launchctl list \| grep gerrit` · `curl http://localhost:8282/config/server/version` |
| Restart | `launchctl kickstart -k gui/501/ai.grunion.gerrit-weave` |
| Stop / start | `launchctl bootout gui/501/ai.grunion.gerrit-weave` / `launchctl bootstrap gui/501 ~/Library/LaunchAgents/ai.grunion.gerrit-weave.plist` |
| Logs | `~/.gerrit/weave/logs/` (error_log, launchd.*.log) |
| Site / config | `~/.gerrit/weave/etc/gerrit.config` (localhost-only: http 8282, ssh 29418) |
| Agent REST credential | `~/.gerrit/weave/etc/agent-http-cred` (`user:http-password`, mode 600) |
| Install gate | `node --test ~/Documents/harness.nosync/scripts/weave-gerrit.test.mjs` |

Auth is `DEVELOPMENT_BECOME_ANY_ACCOUNT` — acceptable **only** because the service
binds 127.0.0.1. Do not expose these ports; re-auth properly before any remote hosting.

## GitHub mirror

Gerrit is the source of truth; GitHub is the public mirror and nothing else. The main
watcher pushes every green gerrit/main tip to GitHub fast-forward only (rule 7). If
that push is ever refused, someone pushed GitHub directly: reconcile by merging
GitHub main into gerrit/main in a temp worktree and pushing both, never force.

## Rollback

`launchctl bootout gui/501/ai.grunion.gerrit-weave`, delete `~/.gerrit/`, delete the
`gerrit` remote and `.git/hooks/commit-msg`, `rm -rf .jj/`. The git repo is untouched
by all of this — colocation and Gerrit are both additive.

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
| Full landing verification | Gerrit poller runs `npm test` on the reviewed patchset |
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
for a caller that is already serial, such as the Gerrit gate. A raw `node --test`
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

The harness routine `weave-flicker` runs the sweep nightly against gerrit/main
and files each confirmed finding as an Issue row carrying its fingerprint
(`journey|kind|selector`) and the frames around it. The overnight fixer picks
those rows up like any other. **Fixing one:** reproduce with the sweep, fix,
and add the fingerprint to `test/flicker-fixed.json` with the Issue number in
the same change. `test/flicker-gate-browser.test.mjs` walks every journey in
the gate and fails when a listed fingerprint comes back, so a fixed flicker
stays fixed. A journey whose selectors rot fails the gate too.
