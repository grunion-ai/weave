> **Using weave as a tool for someone?** Stop here and read
> [AGENTS.md › Using weave](AGENTS.md#using-weave): the primer, the tool map,
> plans and fixes for common errors. The rest of this file is for agents
> developing weave itself: the maintainers' workflow, GitHub PR landing and the
> weave docs workspace on `:4400`.

# Weave — working rules for Claude sessions

## The weave-workspace mandate (non-negotiable)

The **weave** workspace (`/w/weave/` on the running app; `weave.db` beside the default workspace's data file; renamed from "weaver" 2026-08-16, old /w/weaver/ links alias through) is Weave's canonical, self-referential record: Handbook guides, Wiki articles, the Quality space mirroring the test suites, and the Development space holding the public Issue and Feature/roadmap tables.

**No work step happens without first checking — and afterwards updating — the weave workspace's self-referencing records:**

1. **Before starting** any feature, fix, or refactor: query its `Development/Issue` and `Development/Feature` tables for existing records; check relevant `Handbook/Guide` + `Wiki/Article` entries for documented behavior you might contradict.
2. **After landing** a change: mark/create the `Feature` (with Milestone) as Shipped or the `Issue` as Fixed; update any Guide/Article whose content the change touches; the `Quality/Suite` + `Quality/Case` mirror is GENERATED from the test files (src/quality-mirror.js) — never edit it by hand; the main watcher re-syncs the live workspace after every landing, and `node bin/weave.js quality sync --data <weave.db>` does it on demand (`quality check` reports drift).
3. Bugs found along the way get logged as `Issue` rows (Severity set) even if fixed immediately.
4. Issue and Feature rows are **enriched by default**: every provided material (screenshots, files, snippets, logs) is embedded as a **copy** — attachments via the files API, full text inline in the Description — never a relative path or external reference. Screenshots pasted in chat get saved and attached at record-creation time.
5. **Every release is a `Development/Release` row with its notes written** (2026-09-04): name = `v<version>`, Date, Commit, `Fixes` → Issues, `Ships` → Features, and the release notes as its Description. A version bump does not land without one — `scripts/export-development.mjs` refuses to export without a notes-bearing row for the package version, and `test/development-sync.test.mjs` refuses the build. Order for a release: write the Release row on `:4400` → bump `package.json` → run the export → `node scripts/changelog-fold.mjs` moves every `changelog.d/` fragment under `## v<version>` in CHANGELOG.md and deletes the fragments → `node scripts/architecture.mjs` re-pins the architecture map → land through a GitHub PR → successful main CI publishes the immutable tested `v<version>` tag and GitHub Release carrying that CHANGELOG section (automatic: `.github/workflows/release.yml`, see DEVELOPMENT.md "Releasing"); whoever landed the bump confirms `gh release list -R grunion-ai/weave` names it as Latest.

Quick access (server running on :4400):
```bash
curl -s -X POST http://127.0.0.1:4400/w/weave/api/tables/Feature/query -H 'Content-Type: application/json' -d '{"where":[["Status","!=","Shipped"]]}'
curl -s -X POST http://127.0.0.1:4400/w/weave/api/tables/Issue/query   -H 'Content-Type: application/json' -d '{"where":[["Status","=","Open"]]}'
```
Or `node bin/weave.js --data ./weave.db query Feature ...` — CLI and server can run concurrently since the SQLite migration (WAL + per-request refresh); legacy `weave.json` (né weaver.json) is a frozen pre-migration backup, never written again.

## Demos and showcase spaces live in the MAIN instance

The main instance (`:4400`, data dir `~/.weave/`) hosts every workspace — `weave`, `uno`, the rest — one `.db` per workspace, siblings at `/w/<name>/`. A demo, showcase, or example space for **shipped** behavior goes there: build it in a scratch `.db`, then drop the file into `~/.weave/` (checkpoint the WAL first) — the hub adopts it on the first `/w/<name>/` hit, no restart. Never spin a parallel `weave serve` on another port for a demo. The ONLY reason for a scratch instance on its own port is verifying **unlanded** working-tree code, which `:4400` (serving `~/.weave-serve`, landed code only) cannot show; tear it down when verification ends.

## House rules

- Zero runtime dependencies; no build step. Third-party code is **vendored pinned** into `public/vendor/` (mermaid 11.17.0, @tabler/core 1.4.0, Vditor 3.x pruned, KaTeX 0.16.47 + mhchem, highlight.js) — never npm-installed. Storage is `node:sqlite` (built into Node — Node ≥ 22.16 required, 24 LTS recommended): one workspace = one `.db` file (WAL, row-level writes, FTS5 index); legacy `.json` workspaces auto-migrate to a sibling `.db` on first open and the json is left untouched as a backup. `exportJSON`/`importJSON` remain the human-readable interchange layer.
- TDD: run targeted tests for changed behavior before committing; new behavior lands with regression tests. Push a feature branch to GitHub, self-review its PR, and wait for the hosted full `CI gate` on the exact current merge candidate. Branch protection requires an up-to-date branch; never bypass it or substitute an older green SHA. Local workers use `npm test -- --targeted <file...>` rather than duplicate full suites. The shared test manager serializes local browser work; `npm test -- --status` explains waits. Never invoke bare `node --test`, and stop empty selections before Node starts. Browser checks use `styleOf`/`settled` from `test/lib/browser.mjs`, never fixed sleeps. Missing browsers or skipped required browser checks fail CI. Retries remain visible and repeated flakiness gets an Issue. See DEVELOPMENT.md for the full flow.
- Changelog: every change writes its own `changelog.d/<short-slug>-<Issue or Feature number>.md` holding its bullet(s) and never edits CHANGELOG.md; only a release commit does, through `scripts/changelog-fold.mjs` (Issue #408: one shared file caused concurrent change conflicts; `test/changelog-fragments.test.mjs` refuses CHANGELOG.md lines added without a version bump, and Issue #573: it refuses a commit that changes `src/`, `public/`, `bin/` or `scripts/` and names `(Issue #N)` or `(Feature #N)` in its subject while adding no fragment, unless the commit carries a `No-changelog: <reason>` trailer).
- UI is vanilla JS (`public/app.js`), styled on Tabler tokens (`--tblr-*`) with Radix-style soft squared chips; both themes (`data-bs-theme`) must be checked for UI changes.
- The architecture map (`docs/architecture/`, rendered by archify) is gated by `test/architecture-map.test.mjs`: a new `src/` or `bin/` module, or a moved cited file, turns it red. Edit `weave.architecture.json`, then `node scripts/architecture.mjs`; never hand-edit the HTML.
- Data files (`*.db` + WAL/SHM sidecars, legacy `uno.json`/`weave.json`, `files/`) are gitignored workspace state — never commit them; the engine refuses non-workspace JSON and foreign SQLite files (keep it that way).
- The hosted instance (https://weave.grunion.ai) updates itself from release tags (Feature #250): never hand-deploy it on Railway after a landing. Cut a release instead; redeploy only for a Node, `Dockerfile` or `src/supervisor.js` change (DEVELOPMENT.md "Releasing").
- No inline code comments in weave's own code (Issue #661): no `//`, `/* */` or `<!-- -->`. The why behind a change, a `ponytail:` upgrade path included, goes in the commit message and the Issue or Feature row. `test/no-inline-comments.test.mjs` enforces it. Vendored code, `brand/` and `docs/` are exempt.
- Main lands through GitHub pull requests after self-review and the required up-to-date `CI gate`. Never push origin main directly. The local watcher follows verified GitHub main; hosted releases follow the release workflow. Keep migrated draft PRs unmerged until their individual reviews and checks finish. Gerrit and its mirror are retired. See DEVELOPMENT.md.
