# weave soul

Read this before writing copy about weave: the README, docs pages, release notes, the website, posts, decks or UI strings. Every line below is copied or closely paraphrased from the file named after it.

## Purpose

"Weave provides connected tables, documents, workflows, and an MCP interface over the same workspace data." (`PRODUCT.md`)

## Audience

Two readers, as equals: "People and agents use Weave to organize related records in workspaces" (`PRODUCT.md`), and weave is built "for people and AI agents as equals" (`README.md`).

- People whose work lives in Airtable, ClickUp or Fibery and who want to run the tool themselves. They already know linked records, rollups, formulas and views; the comparison pages map those concepts onto weave's (`README.md` FAQ, `docs/comparison/`).
- Agents that connect over MCP, REST or the CLI. They start at AGENTS.md › Using weave (`README.md` "For agents").
- Operators who host it: a workspace is "one SQLite file next to your project, served by one Node process on a laptop or a small VPS behind your own TLS and login" (`README.md`).

## Voice

- Plain enough to rule weave out: "Stated plainly, so you can rule it out fast" (`README.md`, "What weave is not")
- Honest about gaps: the Airtable page "is honest about what is missing" (`docs/comparison/airtable.md`); the Fibery page covers "the honest gaps" (`docs/README.md`); the alternatives page shows where weave fits among them and where it does not (`docs/comparison/alternatives.md`).
- Generous to peers: "The open-source options in this space are all worth a look, and several are far more mature than weave." When a limit is a dealbreaker, name Baserow, NocoDB and Grist. (`README.md`)
- Concrete: counts, commands and file names stand in for adjectives. "One SQLite file. Zero dependencies. No build step. MIT." "Do I need Docker, Postgres, or npm install? No, no, and no." (`README.md`)
- Dated claims about other products: "Licenses and packaging as of August 2026. Every project here moves; check each repository for current terms." (`docs/comparison/alternatives.md`)
- The name is lowercase in prose, as in the wordmark: "weave" lowercase, Outfit 600 (`brand/README.md`, decision 4).

## Positioning

weave is "an open-source, self-hosted work database and Airtable alternative", where "People use the web UI and AI agents use the built-in MCP server, REST API or CLI, on the same tables" (`README.md`). It "replaces the SaaS your work already lives in", running on your laptop or your own server "with no per-seat bill and no vendor holding the export button" (`README.md`). Against the SaaS tools, the second audience is the difference: "everything the web UI can do, the REST API, the CLI and the built-in MCP server can do too, on the same engine and the same data file on your disk" (`README.md`). Fibery is the closest model, and weave implements it "as an MIT-licensed program you run yourself, against a single SQLite file" (`docs/comparison/fibery.md`). Against the open-source alternatives: "Pick weave if you want connected tables plus markdown documents plus an MCP server, with no container, no database server, and no dependency tree" (`README.md`). The badge ring reads DATA · AGENTS over SYSTEMS (`brand/kit/labels.json`, `brand/kit/README.md`).

## Refusals

Refused by the product, from `README.md` "What weave is not" unless noted:

- No fine-grained permissions: three roles per workspace (observer, editor, architect). A share link opens one record, table, space or saved view to whoever holds it, but "no rule narrows an account's own role to one space, record or field."
- Auth stays off until an architect runs `weave workspace require-auth`.
- No plugin API: "weave has no third-party app store inside it." The repository is also a Claude Code plugin marketplace, which installs weave's own MCP connection into Claude Code and "adds nothing to weave."
- Not battle-tested at scale: "a young project backed by a test suite, not by years of production mileage across thousands of installs."
- No telemetry and no account for a local install: "A local install needs no account and sends no telemetry."
- No runtime dependencies, no build step, nothing installed from npm; third-party code is vendored and pinned (`CLAUDE.md` house rules).
- No lock-in: "There is no lock-in to escape." (`README.md` FAQ)

Refused in copy:

- Fabricated history: "Historical uptime before monitoring began is unavailable and must not be fabricated." Missing measurements are reported as unknown. (`PRODUCT.md`)
- Undated claims about another product's pricing, license or features (`docs/comparison/`).
