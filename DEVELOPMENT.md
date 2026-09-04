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
# 4. paste the notes as the CHANGELOG.md digest; land through Gerrit as one change
```

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
