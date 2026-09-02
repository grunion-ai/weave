# Weave — working rules for Claude sessions

## The weave-workspace mandate (non-negotiable)

The **weave** workspace (`/w/weave/` on the running app; `weave.db` beside the default workspace's data file; renamed from "weaver" 2026-08-16, old /w/weaver/ links alias through) is Weave's canonical, self-referential record: Handbook guides, Wiki articles, the Quality space mirroring the test suites, and the Development space holding the public Issue and Feature/roadmap tables.

**No work step happens without first checking — and afterwards updating — the weave workspace's self-referencing records:**

1. **Before starting** any feature, fix, or refactor: query its `Development/Issue` and `Development/Feature` tables for existing records; check relevant `Handbook/Guide` + `Wiki/Article` entries for documented behavior you might contradict.
2. **After landing** a change: mark/create the `Feature` (with Milestone) as Shipped or the `Issue` as Fixed; update any Guide/Article whose content the change touches; the `Quality/Suite` + `Quality/Case` mirror is GENERATED from the test files (src/quality-mirror.js) — never edit it by hand; the main watcher re-syncs the live workspace after every landing, and `node bin/weave.js quality sync --data <weave.db>` does it on demand (`quality check` reports drift).
3. Bugs found along the way get logged as `Issue` rows (Severity set) even if fixed immediately.
4. Issue and Feature rows are **enriched by default**: every provided material (screenshots, files, snippets, logs) is embedded as a **copy** — attachments via the files API, full text inline in the Description — never a relative path or external reference. Screenshots pasted in chat get saved and attached at record-creation time.

Quick access (server running on :4400):
```bash
curl -s -X POST http://127.0.0.1:4400/w/weave/api/tables/Feature/query -H 'Content-Type: application/json' -d '{"where":[["Status","!=","Shipped"]]}'
curl -s -X POST http://127.0.0.1:4400/w/weave/api/tables/Issue/query   -H 'Content-Type: application/json' -d '{"where":[["Status","=","Open"]]}'
```
Or `node bin/weave.js --data ./weave.db query Feature ...` — CLI and server can run concurrently since the SQLite migration (WAL + per-request refresh); legacy `weave.json` (né weaver.json) is a frozen pre-migration backup, never written again.

## House rules

- Zero runtime dependencies; no build step. Third-party code is **vendored pinned** into `public/vendor/` (mermaid 11.17.0, @tabler/core 1.4.0, Vditor 3.x pruned, KaTeX 0.16.47 + mhchem, highlight.js) — never npm-installed. Storage is `node:sqlite` (built into Node — Node ≥ 22.16 required, 24 LTS recommended): one workspace = one `.db` file (WAL, row-level writes, FTS5 index); legacy `.json` workspaces auto-migrate to a sibling `.db` on first open and the json is left untouched as a backup. `exportJSON`/`importJSON` remain the human-readable interchange layer.
- TDD: `node --test 'test/**/*.test.mjs'` (run from this directory) must be green before any commit; new engine/server behavior lands with tests.
- UI is vanilla JS (`public/app.js`), styled on Tabler tokens (`--tblr-*`) with Radix-style soft squared chips; both themes (`data-bs-theme`) must be checked for UI changes.
- Data files (`*.db` + WAL/SHM sidecars, legacy `uno.json`/`weave.json`, `files/`) are gitignored workspace state — never commit them; the engine refuses non-workspace JSON and foreign SQLite files (keep it that way).
- Commits end with the Claude co-author line; push to `origin main` (github.com/grunion-ai/weave).
