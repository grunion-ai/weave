# weave documentation

[weave](https://github.com/grunion-ai/weave) is an open-source, self-hosted
alternative to Airtable, Fibery, Notion databases, and ClickUp, built so that AI
agents are first-class users. Start at the
[project README](https://github.com/grunion-ai/weave#readme) — it covers what
weave is, the quickstart, self-hosting, and the FAQ.

## In this directory

| Document | What it covers |
| --- | --- |
| [Feature parity matrix](PARITY.md) | weave scored against Fibery's core work-platform feature set, feature by feature |
| [weave vs Airtable](comparison/airtable.md) | Concept mapping, field types, what wins where, how to migrate |
| [weave vs Fibery](comparison/fibery.md) | The closest model to weave's, and the honest gaps |
| [Open-source alternatives compared](comparison/alternatives.md) | weave against NocoDB, Baserow, Grist, and Teable |
| [Screenshots](screenshots/) | Table, board, entity documents, relation map, search — regenerate with `node scripts/screenshots.mjs` |

## Elsewhere in the repo

| Document | What it covers |
| --- | --- |
| [AGENTS.md](https://github.com/grunion-ai/weave/blob/main/AGENTS.md) | Agent-facing map: repo layout, the 23 MCP tools, entity-ref forms, rules for changing the repo |
| [CONTRIBUTING.md](https://github.com/grunion-ai/weave/blob/main/CONTRIBUTING.md) | Setup, the zero-dependency and no-build-step rules, PR expectations |
| [SECURITY.md](https://github.com/grunion-ai/weave/blob/main/SECURITY.md) | Threat model, what is in scope, private reporting |
| [llms.txt](https://github.com/grunion-ai/weave/blob/main/llms.txt) | Machine-readable index of this documentation |

## The live docs

Every running instance provisions a self-documenting **weave** workspace at
`/w/weave/` — a Handbook, a Wiki, the roadmap and issue tracker, and a Quality
space mirroring the test suite. It is queryable through the same REST API as any
other workspace, so the tool documents itself in its own data model.
