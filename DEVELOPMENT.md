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

# verify + vote (the TDD gate as a Gerrit vote)
~/Documents/harness.nosync/scripts/weave-review.sh <change-number>          # tests -> Verified ±1
~/Documents/harness.nosync/scripts/weave-review.sh <change-number> --submit # also submit on green

# approve + land — the shipping agent does this itself (Kyle, 2026-09-02)
# after its own review pass; the +2 message names what was reviewed and
# which tests were added. UI: http://localhost:8282  — or REST:
#   POST /a/changes/<n>/revisions/current/review {"labels":{"Code-Review":2},"message":"..."}
#   POST /a/changes/<n>/submit        # 409 = main moved: rebase, re-push, re-gate

# sync landed work back
git fetch gerrit && jj rebase -d main@gerrit   # or: git pull gerrit main
```

## Rules for agents

1. **Never push directly to `refs/heads/main`.** All work goes through `refs/for/main`.
2. **One logical change per push.** Re-push amended commits to iterate the same change
   (the Change-Id keeps them together) instead of opening new ones.
3. **Verified is earned, not asserted**: run `weave-review.sh` (it runs `npm test` on the
   exact patchset in an isolated worktree). A red suite votes −1 and blocks submit.
   The `*-browser.test.mjs` suites `import('playwright')` and skip on a bare checkout;
   the gate links its shared install (`~/.gerrit/weave/pw/node_modules`) into the
   worktree and votes −1 if they skipped anyway. Run them locally the same way:
   `ln -s ~/.gerrit/weave/pw/node_modules node_modules` (gitignored) before `npm test`.
   A browser case that is red in the gate and green alone is almost always a
   read taken after a fixed sleep; `WEAVE_CPU_THROTTLE=4 node --test <file>`
   slows each page fourfold and usually turns it red on a quiet machine.
4. Working in parallel with other agents? You don't need to coordinate — Gerrit
   serializes at submit; rebase conflicts surface as a new patchset, not a broken tree.
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
fails a commit that adds lines to CHANGELOG.md without changing the package.json version.

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
