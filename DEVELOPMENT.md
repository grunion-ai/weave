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

# approve + land (human judgment stays on Code-Review)
# UI: http://localhost:8282  — or REST:
#   POST /a/changes/<n>/revisions/current/review {"labels":{"Code-Review":2}}
#   POST /a/changes/<n>/submit

# sync landed work back
git fetch gerrit && jj rebase -d main@gerrit   # or: git pull gerrit main
```

## Rules for agents

1. **Never push directly to `refs/heads/main`.** All work goes through `refs/for/main`.
2. **One logical change per push.** Re-push amended commits to iterate the same change
   (the Change-Id keeps them together) instead of opening new ones.
3. **Verified is earned, not asserted**: run `weave-review.sh` (it runs `npm test` on the
   exact patchset in an isolated worktree). A red suite votes −1 and blocks submit.
4. Working in parallel with other agents? You don't need to coordinate — Gerrit
   serializes at submit; rebase conflicts surface as a new patchset, not a broken tree.
5. jj is the local safety net: after any suspected clobber, `jj op log` + `jj undo`.

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

Gerrit is the source of truth for review; GitHub stays the public mirror. Until the
grunion-ai push credential lands, mirroring is manual: `git push origin main` after
changes submit. Once the credential exists, wire Gerrit's replication plugin instead.

## Rollback

`launchctl bootout gui/501/ai.grunion.gerrit-weave`, delete `~/.gerrit/`, delete the
`gerrit` remote and `.git/hooks/commit-msg`, `rm -rf .jj/`. The git repo is untouched
by all of this — colocation and Gerrit are both additive.
