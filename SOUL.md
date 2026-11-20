# weave soul

Read this before writing copy about weave. PRODUCT.md owns the purpose and
principles; README.md presents them to new users. This file guides the voice.

## Purpose

"weave is a portable work system you own, developed in the open." (`PRODUCT.md`)

## Audience

"weave serves individuals and small teams who organize related work and already use an agent." (`PRODUCT.md`)

People and their agents share the same work. Operators choose local execution,
their own server or weave cloud. Lead with the work they can do and the control
they retain. Named-product comparisons belong on the comparison pages.

## Voice

- Plain: "You already have an agent. weave works natively with it." (`PRODUCT.md`)
- Concrete: "Zero runtime dependencies and no build step" names an operating property, not a speed benchmark. (`PRODUCT.md`)
- Inspectable: "Open source. Open tests. Open roadmap." (`PRODUCT.md`)
- Honest: "Product claims distinguish current behavior, proposed capabilities, maintenance commitments and measured results." (`PRODUCT.md`)
- Generous to peers. State dated, sourced differences without asserting that an established pattern is unique.
- Use weave lowercase in prose, as in the wordmark (`brand/README.md`).

## Positioning

"Connected records, documents and automations share one model." (`PRODUCT.md`)
People and their existing agents can inspect and operate both the records and
the structure containing them. Lead with native agent access, documents with a
structured home, integrated listening, portable operation and open development.

Runtime simplicity means one process, SQLite storage and no build step. It does
not establish superior usability, speed or scale. Customization includes HTML
content and source ownership, with the documented trust boundary. Credential
grants must never be described as general field permissions. Optional semantic
retrieval remains a proposal until implemented and verified.

The maintenance budget is an allocation ceiling. Describe daily development,
release token reporting and frontier-model refactoring as commitments, and link
actual evidence when available. The evidence requirements live in PRODUCT.md.

## Refusals

Refused by the product, from `README.md` "What weave is not" unless noted:

- No general field-level read permissions for accounts: workspace roles, private spaces, member roles, space-scoped tokens and share links establish access. "Ordinary fields do not have separate read permissions."
- Auth stays off until an architect runs `weave workspace require-auth`.
- No plugin API: "weave has no third-party app store inside it." The repository is also a Claude Code plugin marketplace, which installs weave's own MCP connection into Claude Code and "adds nothing to weave."
- Not battle-tested at scale: "a young project backed by a test suite, not by years of production mileage across thousands of installs."
- No telemetry and no account for a local install: "A local install needs no account and sends no telemetry."
- No runtime dependencies, no build step, nothing installed from npm; third-party code is vendored and pinned (`CLAUDE.md` house rules).
- No lock-in: "There is no lock-in to escape." (`README.md` FAQ)

Refused in copy:

- Fabricated history: "Historical uptime before monitoring began is unavailable and must not be fabricated." Missing measurements are reported as unknown. (`PRODUCT.md`)
- Undated claims about another product's pricing, license or features (`docs/comparison/`).
