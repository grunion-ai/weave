# weave and Fibery

weave is a portable work system you own, developed in the open. Fibery is a
managed workspace for connected databases, collaborative documents and visual
planning. Both organize related records and expose programmatic interfaces.
Their differences concern ownership, operating model and how much work the
application handles directly on screen.

Reviewed November 20, 2026 against weave v0.4.165 source and the linked Fibery
documentation. This is a capability review, not a comparative performance test.
The historical [feature checklist](../PARITY.md) yields **85.5%** under its
own equal-weight scoring rule. That number does not establish current parity,
compatibility, reliability or fit.

## Capability comparison

| Area | weave | Fibery |
| --- | --- | --- |
| Ownership | MIT source; local, self-hosted or weave cloud | Proprietary managed service |
| Agent workflow | Native MCP, REST and CLI; use the agent you already have | Built-in AI and external MCP access |
| Record structure | Spaces, tables and fields exposed as system records | Connected databases configured through visual and programmatic interfaces |
| Relations | Ordinary bidirectional relations; multi-target relations can include structure records | Connected database relations; check current documentation for polymorphic support |
| Documents | Markdown fields on records, addressable as Markdown, HTML or PDF | Collaborative rich text on entities and standalone documents |
| Planning | Table, list and board layouts, gallery-style cards and relation map | Also timelines, calendars, whiteboards and reports |
| Automation | Native polling and inbound hooks, schedules, HTTP actions, persisted outbound retries | Rules, buttons, scripts and managed integrations |
| Capture | Forms with stable keys, URL drafts, HTTP/CLI/MCP submission and retry receipts | Forms and URL prefilling |
| Custom interfaces | HTML documents, API clients and modification of the source | Supported Custom Apps, including external-agent development |
| Permissions | Workspace and space roles, private spaces, scoped tokens, share links and credential grants | Richer sharing and access templates for differentiated team access |
| Search | Text retrieval; semantic retrieval remains proposed | Full-text and semantic search |
| Recovery | SQLite storage, JSON interchange, backup/restore, undo and document revisions | Managed infrastructure and in-app history |
| Development | Public source and tests; roadmap and issues in weave | Public roadmap, changelog and community; proprietary implementation |

## weave's fit

You already have an agent. weave works natively with it. Its engine serves the
browser, MCP, REST and CLI, so an existing agent can operate records, documents,
structure and automation. Fibery also supports external agents; MCP itself is
not an exclusive capability.

A document has a structured home in a record. Multi-target relations extend
that model to different allowed record types, including tables and spaces.
They do not have inverse fields, and lookups and rollups do not support them.
Relationships with properties still need a junction record. See
[polymorphic relations](../../src/handbook/guides/polymorphic-relations.md).

Native listening connects external changes to the same record system, with
visible rules and failure recovery. The first poll establishes a baseline and
missing source items do not generate deletion events. Incoming webhooks and
polling are established patterns, not unique to weave. See
[automations](../../src/handbook/guides/automations.md).

Ownership extends to the runtime. A workspace uses SQLite storage, with
attachments and secrets handled separately. Source, backup and restore let an
operator run it independently. The small runtime does not prove faster queries
or greater scale. HTML documents offer programmable content, but their scripts
execute on the application origin and require trusted authors.

## Fibery's fit

Fibery supports more collaborative authoring and visual planning within the
application. Timelines, reports and whiteboards matter when the team performs
that work directly on screen. Its Custom Apps provide a supported route to
custom interfaces, and its managed integrations reduce operator work.

Standalone documents are optional: a team can use document fields on entities
in either product. Avoid treating sidebar clutter as an unavoidable Fibery
property. Access design also deserves a workflow-specific review; credential
grants in weave are not ordinary field-level permissions.

## Choosing and migrating

Start with one representative workflow. Test its relations, document formats,
formula outputs, attachments, access boundaries and automation failures. A CSV
export does not recreate permissions, formulas, documents or automation.
Rebuild and verify those deliberately before moving the authoritative workflow.

The [product principles](../../PRODUCT.md) describe weave on its own terms,
including the maintenance commitment and proposed capabilities. The
[README matrix](../../README.md#how-weave-compares) summarizes current choices.

## Sources

- [weave agent interfaces](../../AGENTS.md#using-weave)
- [weave forms and retry contract](../../src/handbook/guides/forms.md)
- [weave access implementation](../../src/access.js)
- [Fibery documents](https://the.fibery.io/@public/User_Guide/Guide/Documents-85)
- [Fibery views](https://the.fibery.io/@public/User_Guide/Guide/Views-8)
- [Fibery AI and external agents](https://the.fibery.io/@public/User_Guide/Guide/AI-in-Fibery-What's-possible-and-where-to-start-489)
- [Fibery Custom Apps](https://fibery.com/features/custom-apps)
- [Fibery form prefilling](https://community.fibery.io/t/dec-21-2023-show-rich-text-field-snippet-in-views-all-comments-in-one-right-panel-experimental-set-initial-field-values-via-url-parameter-on-form-view/5571)
- [Fibery November 19 connector release](https://community.fibery.io/t/november-19-2026-tons-of-mcp-improvements-some-whiteboard-improvements-open-fibery-links-in-the-desktop-app/11667)
