# Automations

An automation is a rule bound to one table: something happens, and weave writes. The rule names a trigger and a list of actions, it lives as a row of `System/Workflows`, and it runs inside the engine, so a write from the CLI, the REST API, an MCP client or the grid fires it the same way.

Nothing here reaches outside the workspace except the `webhook` action.

## The Workflows row is the control panel

Every rule is a row of `System/Workflows`, and the row is the whole interface to it:

| Column | What it holds |
| --- | --- |
| `Name` | what you call the rule |
| `On` | the switch. Off means the trigger is ignored |
| `Script` | the rule itself, as JSON: `{"table", "trigger", "actions"}` |
| `State` | `Setup incomplete` while the Script does not compile, `Ready` once it does |
| `Health` | `Healthy`, `Warning`, `Failed`, or `No runs` before the first fire |
| `Health Reason` | why the last run failed, in the engine's words |
| `Last Run` | when it last fired, to the minute |
| `Tables`, `Spaces` | what the rule touches, filled in by the engine |
| `Diagram` | the rule drawn as mermaid |

Editing the Script runs the same validation the create verb runs, because it is the create verb: a Script weave cannot compile leaves the row `Setup incomplete` and names what is wrong. The engine computes `State` and stamps `Health`, `Health Reason` and `Last Run` on every run. The row number is the firing order: when several rules answer the same trigger, they run top to bottom.

A rule's own writes can fire other rules, three deep at most, so a pair of rules that write to each other stops rather than looping.

## Triggers

Four trigger types, and a rule has one:

| Trigger | Fires when |
| --- | --- |
| `entity-created` | a row of the table is created |
| `field-updated` | a named field on a row changes |
| `state-changed` | a workflow field moves, optionally only into one named state |
| `schedule` | the clock reaches a cron minute |

`field-updated` and `state-changed` take `field`; `state-changed` also takes `toState` to narrow it to one landing state.

```json
{ "type": "state-changed", "field": "Status", "toState": "Done" }
```

## On a schedule

A `schedule` trigger fires on a timer instead of a row change:

```json
{ "type": "schedule", "cron": "0 9 * * 1-5", "zone": "America/Los_Angeles", "where": [["Status", "!=", "Done"]] }
```

`cron` is the five-field expression: minute, hour, day, month, weekday, with `*`, lists, ranges and `*/n` steps. It is read on the wall clock of `zone`, an IANA name, UTC when you leave it out. At each due minute the rule runs its actions on every live row of its table, or on the rows its `where` clause admits, written in the query filter syntax. `{{Today}}` reads the clock of the run and `event.type` is `schedule`.

The server checks every minute, and a due minute fires once. A box that slept through several due minutes does one catch-up pass when it wakes, reaching back seven days at most. A new rule starts at the first tick that sees it, and a rule switched On after its minute waits for the next one.

## Actions

Actions run in order. A rule needs at least one.

| Action | What it writes |
| --- | --- |
| `set-field` | a value onto the firing row, a workflow field's state included |
| `append-doc` | text at the end of a document field |
| `add-comment` | a comment on the firing row |
| `webhook` | a POST to an http(s) url, signed when the rule names a credential |
| `upsert-row` | a row of another table, matched on a key |

`upsert-row` is the one that writes somewhere else:

```json
{ "type": "upsert-row", "table": "Billing/Account", "key": "Stripe Id",
  "fields": { "Stripe Id": "row.Customer", "Name": "row.Company", "Plan": "row.Tier" } }
```

When a row of the target table already holds that key, the action updates it; otherwise it creates one, so a repeated delivery never makes a duplicate. The key field is a `text`, `number`, `url` or `email` field and must be mapped. Each source path reads the firing row (`row.<Field>`, `row.PublicId`) or the trigger (`event.type`, `event.field`, `event.toState`). A select takes its option name and a relation the target row's Name, as the entities API does. A path that finds nothing leaves its field as it was, and an empty key marks the row `Failed`.

## Placeholders and step outputs

Text in an action reads the firing row through placeholders: `{{Name}}`, `{{PublicId}}`, `{{Today}}` in the workspace date format, `{{Today:iso}}` as 2026-10-06. An empty field reads `(no Field)`.

Each action also yields an output the later ones can read:

| Action | Output |
| --- | --- |
| `set-field` | `{field, value}` |
| `append-doc` | `{field, text}` |
| `add-comment` | `{id, text}` |
| `upsert-row` | `{id, publicId, name, created}` |
| `webhook` | `{url, sent}` |

A later action reads them as `{{steps.1.publicId}}` in its text or in a `set-field` string value, and as `steps.1.name` in an `upsert-row` source path. The number is the action's position, counted from 1. A step that has not run yet, or a path it has not got, reads empty.

Every run leaves an `automation-ran` entry on each row it touched. The entry holds the outputs under `steps`, in action order. A run that stops on a failing action adds `failed: {step, error}` to the entry of the row it stopped on, and the rule's `Health Reason` carries the same message.

## Webhooks

A `webhook` action POSTs to an `http(s)` url. The url is validated when the rule compiles; the `url` field type is not, so validate upstream if strictness matters to you.

Before each delivery weave resolves the host and refuses loopback, link-local, the private ranges and the cloud metadata addresses, and it follows no redirect. A refusal, a non-2xx answer, no answer within 5 seconds, or a connection that cannot be made marks the rule `Failed` with the reason in `Health Reason`. The write that fired it still lands.

Set `WEAVE_WEBHOOK_ALLOW_PRIVATE=1` on an instance whose webhooks land on its own network, such as a Railway private service or a VPS sidecar, and the private ranges are allowed. A redirect stays refused either way. A `weave_build` dry run drops webhook actions, so a trial never posts.

### Signing a delivery

Add `signWith` to the action and the delivery is signed, so a receiver can tell weave from anyone else:

```json
{ "type": "webhook", "url": "https://hooks.example.com/weave", "signWith": "hooks-example" }
```

`signWith` is the NAME of a credential in the keystore (`weave key set hooks-example`), never the value: the Script, the Workflows row, the export and the backup hold the name alone. Three headers ride along:

| Header | Value |
| --- | --- |
| `X-Weave-Timestamp` | the delivery clock, unix seconds |
| `X-Weave-Delivery` | a uuid, new for each delivery |
| `X-Weave-Signature` | `sha256=` and the hex HMAC-SHA256 of `<timestamp>.<raw body>` under the credential |

The receiver recomputes it over the bytes it read, before any JSON parse, and compares in constant time:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

const ts = req.headers['x-weave-timestamp'];
const hex = createHmac('sha256', process.env.WEAVE_HOOK_SECRET).update(ts + '.' + raw).digest('hex');
const mine = Buffer.from('sha256=' + hex);
const theirs = Buffer.from(req.headers['x-weave-signature'] ?? '');
const ok = mine.length === theirs.length && timingSafeEqual(mine, theirs);
if (!ok || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return reject();
```

Refuse a timestamp older than your replay window and remember the `X-Weave-Delivery` ids you have already handled. A rule that names no credential posts exactly what it posted before, with `Content-Type` as its only header. A rule whose credential the keystore does not hold sends nothing and reads `Failed`: weave never falls back to an unsigned delivery.

## A worked example

Two rules on a Request table. The first opens or updates the billing account when a request lands, writes the account reference back, and says so in a comment:

```bash
weave automation create Request --name 'Open the account' \
  --trigger '{"type":"state-changed","field":"Status","toState":"Approved"}' \
  --actions '[{"type":"upsert-row","table":"Billing/Account","key":"Stripe Id",
               "fields":{"Stripe Id":"row.Customer","Name":"row.Company"}},
              {"type":"set-field","field":"Account Ref","value":"Account#{{steps.1.publicId}}"},
              {"type":"add-comment","text":"Opened {{steps.1.name}} on {{Today}}; ref {{steps.2.value}}"}]'
```

The second sweeps every weekday morning in Los Angeles and nudges whatever is still open:

```bash
weave automation create Request --name 'Weekday nudge' \
  --trigger '{"type":"schedule","cron":"0 9 * * 1-5","zone":"America/Los_Angeles","where":[["Status","!=","Approved"]]}' \
  --actions '[{"type":"append-doc","text":"Still open on {{Today}}."},
              {"type":"webhook","url":"https://hooks.example.com/weave/nudge"}]'
```

Read what you have, then watch the rows:

```bash
weave automation list Request
weave automation describe Request
weave activity --kind automation-ran --limit 20
```

## Every door reaches it

| Door | Calls |
| --- | --- |
| CLI | `weave automation create <table> --name N --trigger '{json}' --actions '[json]'`, `automation list`, `automation describe`, `automation update <id> --patch '{json}'`, `automation delete <id>` |
| REST | `POST /api/automations` with `{db, name, trigger, actions, enabled}`, `GET /api/automations?db=<table>`, `PATCH /api/automations/:id`, `DELETE /api/automations/:id` |
| MCP | `weave_create_automation`, and `weave_automations` with `action: list | describe | update | delete` |
| Grid | a new row of `System/Workflows`, its Script written as JSON |

`weave_create_automation` and `weave_automations` carry the MCP open-world mark: a rule can call a webhook, and no other tool leaves the workspace.

Deleting a rule sends its Workflows row to the trash, where restoring it brings the rule back. Switching `On` off is the reversible way to stop one.