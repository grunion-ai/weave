> **Using weave as a tool for someone?** Stop here and read
> [AGENTS.md › Using weave](AGENTS.md#using-weave): the primer, the tool map,
> plans and fixes for common errors. The rest of this file is for agents
> developing weave itself: where each maintainer rule lives and the test that
> holds it.

# Weave: working rules for Claude sessions

Each rule has one owner file. This page names the owner and the gate and
restates nothing: read the owner before work that touches its concern, and
change a rule only there.

## The weave-workspace mandate (non-negotiable)

No work step happens without first checking, and afterwards updating, the
tracker rows it touches: the Issue and Feature rows before work; Fixed or
Shipped, and every Guide the change contradicts, after landing.
[DEVELOPMENT.md › The tracker](DEVELOPMENT.md#the-tracker) owns the rule.

- The canonical tracker is the `weave` workspace on production,
  https://weave.grunion.ai/w/weave. Row numbers and states come only from there.
- Offline, read `docs/development.json`, the copy every other server loads at
  boot, or query a copy a server built from it:
  `node bin/weave.js --data ~/.weave/weave.db query Issue --where '[["Name","contains","<words>"]]'`.
  A match there is a lead to confirm on the canonical tracker before you cite it.

## House rules

| Concern | Owner | Gate |
| --- | --- | --- |
| Tests first; a bug fix lands with a test that failed before it | [CONTRIBUTING.md › The rules](CONTRIBUTING.md#the-rules) | Review |
| Running tests: targeted locally, the full suite on CI, browser waits, ledgers | [DEVELOPMENT.md › Running tests](DEVELOPMENT.md#running-tests) | `test/test-runner.test.mjs`, `test/temp-dirs.test.mjs` |
| Landing: branch, pull request, self-review, auto-merge, required checks | [DEVELOPMENT.md › Daily flow](DEVELOPMENT.md#daily-flow) | Branch protection, `test/doc-owners.test.mjs` |
| What the PR and main gates run, the sheriff and the dev soak | [DEVELOPMENT.md › Verification](DEVELOPMENT.md#verification) | `test/ci-test.test.mjs`, `test/sheriff.test.mjs` |
| Releasing, in order | [DEVELOPMENT.md › Releasing](DEVELOPMENT.md#releasing) | `test/development-sync.test.mjs` |
| Dev and production deploys; never hand-deploy Railway | [DEVELOPMENT.md › Production promotion](DEVELOPMENT.md#production-promotion) | `test/claude-md-promotion.test.mjs` |
| The Quality mirror is generated from the test files | [DEVELOPMENT.md › The tracker](DEVELOPMENT.md#the-tracker) | `test/quality-mirror.test.mjs` |
| Handbook pages live in `src/handbook/`, never on an instance | [AGENTS.md › Self-documenting workspace](AGENTS.md#self-documenting-workspace) | `test/handbook.test.mjs` |
| A changelog fragment per change | [CONTRIBUTING.md › The rules](CONTRIBUTING.md#the-rules) | `test/changelog-fragments.test.mjs` |
| No inline comments | [CONTRIBUTING.md › The rules](CONTRIBUTING.md#the-rules) | `test/no-inline-comments.test.mjs` |
| Zero runtime dependencies; vendored code pinned in the lock | [CONTRIBUTING.md › The rules](CONTRIBUTING.md#the-rules) | `test/security/vendor-lock.test.mjs`, `test/tabler-trim.test.mjs` |
| No build step | [CONTRIBUTING.md › The rules](CONTRIBUTING.md#the-rules) | Review |
| Both themes, Tabler tokens, the surface table | [CONTRIBUTING.md › The rules](CONTRIBUTING.md#the-rules) | `test/surface-palette.test.mjs`, `test/theme-loop-guard.test.mjs` |
| Never commit workspace data | [CONTRIBUTING.md › The rules](CONTRIBUTING.md#the-rules) | `.gitignore` |
| Copy about weave | [SOUL.md](SOUL.md) | Review |
| The Node floor | [CONTRIBUTING.md › Setup](CONTRIBUTING.md#setup) | `engines` in `package.json` |
| A new `src/` or `bin/` module goes on the architecture map | [DEVELOPMENT.md › Architecture map](DEVELOPMENT.md#architecture-map) | `test/architecture-map.test.mjs` |
| Where a grid behaviour lives in `public/app.js` | [docs/grid.md](docs/grid.md) | `test/grid-map.test.mjs` |
| Brand assets come from the kit, never drawn by hand | [brand/kit/README.md](brand/kit/README.md) | `test/brand-kit.test.mjs` |
| The agent surface: primer, tool map, CLI and generated blocks | [AGENTS.md › Using weave](AGENTS.md#using-weave) | `test/agent-front-door.test.mjs`, `test/docs-drift.test.mjs` |
| Demos, and the local main instance on `:4400` | [DEVELOPMENT.md › Local instance](DEVELOPMENT.md#local-instance) | Review |
