# Automations

An automation is a rule bound to one table: something happens, and weave writes. The rule names a trigger and a list of actions, it lives as a row of `System/Workflows`, and it runs inside the engine, so a write from the CLI, the REST API, an MCP client or the grid fires it the same way.

Nothing here reaches outside the workspace except the `webhook` and `http-request` actions.

## Rules in a build spec

A table in a `weave_build` spec, `POST /api/build` body or `weave build` file takes `automations`, a list of rules written as `{name, trigger, actions}` with fields and states by name, and `on: false` for a rule that should start Off. The build makes each rule after the table's records. A rule that would read `Setup incomplete` stops the build with the reason at its path, so a dry run shows it before anything is written. The Work starter ships `Stamp the done date`, which sets `Done on` when a task reaches Done.

## The Workflows row is the control panel

Every rule is a row of `System/Workflows`, and the row is the whole interface to it. The Standard view shows `On`, `Name`, `When`, `Then`, `Health` and `Last Run`, so you can read what each rule does without opening its Script:

| Column | What it holds |
| --- | --- |
| `Name` | what you call the rule |
| `On` | the switch. Off means the trigger is ignored |
| `When` | the table and the trigger in words, such as `Status moves to Approved in Ops/Request`, written by the engine |
| `Then` | the actions in words, in order, such as `Set Notes to "approved", then Add a comment`, written by the engine |
| `Script` | the rule itself, as JSON: `{"table", "trigger", "actions"}` |
| `State` | `Setup incomplete` while the Script does not compile, `Ready` once it does |
| `Health` | `Healthy`, `Warning` while a delivery waits to be sent again, `Failed`, or `No runs` before the first fire |
| `Health Reason` | why the last run failed or what it waits on, in the engine's words. The grid shows it when you hover the Health chip, click it, or tap it on a phone |
| `Last Run` | when it last fired, to the minute |
| `Tables`, `Spaces` | what the rule touches, filled in by the engine |
| `Diagram` | the rule drawn as mermaid |

Editing the Script runs the same validation the create verb runs, because it is the create verb: a Script weave cannot compile leaves the row `Setup incomplete` and names what is wrong. The engine computes `State` and stamps `Health`, `Health Reason` and `Last Run` on every run. While a row is `Setup incomplete` and Off, its On toggle is greyed and cannot be switched on; hover it, click it or tap it on a phone and it names what is missing, the same text the `Health Reason` holds. A row whose setup breaks while it is On keeps a live toggle, so you can always switch it off. The row number is the firing order: when several rules answer the same trigger, they run top to bottom.

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
| `http-request` | a call to an outside API, with its answer mapped onto the firing row |

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
| `http-request` | `{status, ok, body}`, the body parsed from JSON |

A later action reads them as `{{steps.1.publicId}}` in its text or in a `set-field` string value, and as `steps.1.name` in an `upsert-row` source path. The number is the action's position, counted from 1. A step that has not run yet, or a path it has not got, reads empty.

Every run leaves an `automation-ran` entry on each row it touched. The entry holds the outputs under `steps`, in action order. A run that stops on a failing action adds `failed: {step, error}` to the entry of the row it stopped on, and the rule's `Health Reason` carries the same message.

## Webhooks

A `webhook` action POSTs to an `http(s)` url. The url is validated when the rule compiles; the `url` field type is not, so validate upstream if strictness matters to you.

Before each delivery weave resolves the host and refuses loopback, link-local, the private ranges and the cloud metadata addresses, and it follows no redirect. The write that fired the rule lands first; the steps after the webhook wait for its answer. A refusal or a 4xx answer marks the rule `Failed` with the reason in `Health Reason`, and the later steps do not run. A 5xx, 408 or 429 answer, no answer within 5 seconds, or a connection that cannot be made is retried, as [When a delivery fails](#when-a-delivery-fails) describes.

Set `WEAVE_WEBHOOK_ALLOW_PRIVATE=1` on an instance whose webhooks land on its own network, such as a Railway private service or a VPS sidecar, and the private ranges are allowed. A redirect stays refused either way. A `weave_build` dry run drops webhook actions, so a trial never posts.

## Signed deliveries

Add `signWith` to a `webhook` or `http-request` action and every delivery it sends is signed, so a receiver can tell weave from anyone else:

```json
{ "type": "webhook", "url": "https://hooks.example.com/weave", "signWith": "hooks-example" }
```

`signWith` is the NAME of a credential in the keystore (`weave key set hooks-example`), never the value: the Script, the Workflows row, the export, the backup and a Failed Deliveries record hold the name alone. Three headers ride along:

| Header | Value |
| --- | --- |
| `X-Weave-Timestamp` | the clock of this attempt, unix seconds |
| `X-Weave-Delivery` | a uuid for the delivery, the same on every retry and replay of it |
| `X-Weave-Signature` | `sha256=` and the hex HMAC-SHA256 of `<timestamp>.<raw body>` under the credential |

An `http-request` through an integration always carries `X-Weave-Timestamp` and `X-Weave-Delivery` beside its key; it carries `X-Weave-Signature` too when it also names `signWith`.

The receiver recomputes the signature over the bytes it read, before any JSON parse, and compares in constant time:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

const ts = req.headers['x-weave-timestamp'];
const hex = createHmac('sha256', process.env.WEAVE_HOOK_SECRET).update(ts + '.' + raw).digest('hex');
const mine = Buffer.from('sha256=' + hex);
const theirs = Buffer.from(req.headers['x-weave-signature'] ?? '');
const ok = mine.length === theirs.length && timingSafeEqual(mine, theirs);
if (!ok || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return reject();
```

Replay protection takes two checks on the receiver's side. Refuse a timestamp more than five minutes from your clock, so a captured request cannot be sent again later; each retry is signed afresh, so a late retry still passes. Remember each `X-Weave-Delivery` id you have handled for at least that window and answer a repeat with 2xx without acting on it: a retry, or a replay from Failed Deliveries, sends the same `X-Weave-Delivery`, so a delivery you already handled is handled once.

A rule that names no credential sends no `X-Weave-` headers; a webhook then posts with `Content-Type` as its only header. A rule whose credential the keystore does not hold sends nothing and reads `Failed`, and it is not retried: weave never falls back to an unsigned delivery.

## Calling an API

An `http-request` action sends one request and reads the answer back onto the row:

```json
{ "type": "http-request", "method": "POST", "integration": "Slack",
  "url": "https://slack.com/api/chat.postMessage",
  "body": { "channel": "C0123456789", "text": "{{Name}} moved to {{Status}}" },
  "response": { "Slack Ts": "ts" } }
```

| Key | What it holds |
| --- | --- |
| `method` | `GET`, `HEAD`, `POST`, `PUT`, `PATCH` or `DELETE`; `POST` when left out |
| `url` | the address, its scheme and host written out; the path and query take placeholders |
| `headers` | an object of header names and text values, with placeholders |
| `body` | text with placeholders, or a JSON object or list whose text values take them, sent as `application/json` unless a header says otherwise. `GET` and `HEAD` carry none |
| `integration` | the Name of a `System/Integrations` record, whose key weave adds as the Authorization header |
| `signWith` | the name of a keystore credential; the request is signed as in [Signed deliveries](#signed-deliveries) |
| `response` | each field of the firing row mapped to a path in the JSON answer, such as `id` or `data.items.0.id` |

The key never sits in the rule. The Script, the Workflows row, the run's activity entry, the step output and the `key-used` audit entry hold the integration's name alone, and a key the API echoes back is redacted from the answer. weave refuses a Script that sets an `Authorization`, `Proxy-Authorization` or `Cookie` header, because the key belongs on the Integrations record, set there with Replace.

A rule whose url is plain http, or whose host is not the integration's Host, reads `Setup incomplete` with the reason, and so does a rule whose integration later moves to another Host. Before each send weave checks again, along with the integration's On switch and its key, and a refused request never leaves the box. With no `integration` the request goes out with no key, through the webhook address guard: loopback, link-local, the private ranges and the cloud metadata addresses are refused unless `WEAVE_WEBHOOK_ALLOW_PRIVATE=1`.

The write that fires the rule answers first. The request goes out after it, and the steps after the request wait for the answer: the mapped fields land on the row, and a later step reads `{{steps.1.status}}`, `{{steps.1.ok}}` or any path of the parsed answer, such as `{{steps.1.body.ts}}`. A path that finds nothing or null leaves its field as it was, and an object or list lands as JSON text. An answer over 16 KB still maps its fields, but its step output keeps `body: null` and `truncated: true`.

A 4xx answer, a redirect or a refusal marks the rule `Failed`, and `Health Reason` names the method, host and path, as in `POST slack.com/api/chat.postMessage answered HTTP 404`. The later steps of that run do not run. A 5xx, 408 or 429 answer, no answer within 5 seconds (10 with an integration), or a connection that cannot be made is retried, as [When a delivery fails](#when-a-delivery-fails) describes. A `weave_build` dry run sends nothing.

A worked example: a support ticket that moves to Escalated posts to a Slack channel, keeps the message timestamp and says so in a comment. The `Slack` record in `System/Integrations` has Provider `Generic API key`, Host `slack.com` and a bot token as its key, which weave sends as `Authorization: Bearer <key>`.

```bash
weave automation create Support/Ticket --name 'Escalate to Slack' \
  --trigger '{"type":"state-changed","field":"Status","toState":"Escalated"}' \
  --actions '[{"type":"http-request","method":"POST","integration":"Slack",
               "url":"https://slack.com/api/chat.postMessage",
               "body":{"channel":"C0123456789","text":"Escalated: {{Name}} (#{{PublicId}})"},
               "response":{"Slack Ts":"ts"}},
              {"type":"add-comment","text":"Posted to Slack, message {{steps.1.body.ts}}"}]'
```

Slack answers HTTP 200 with `"ok": false` when it refuses a message, so map `ok` to a field, or read `{{steps.1.body.ok}}`, when that matters.

## When a delivery fails

A `webhook` or `http-request` that fails for a reason that may pass is sent again: a network error, no answer in time, or an answer of 408, 429 or 5xx. Any other 4xx answer, a redirect and a refusal are not retried, because sending the same request again gets the same answer.

| Attempt | Waits after it fails |
| --- | --- |
| 1 | 1 minute |
| 2 | 2 minutes |
| 3 | 4 minutes |
| 4 | 8 minutes |
| 5 | 16 minutes |
| 6 | 32 minutes |
| 7 | 1 hour |
| 8 | none: the delivery has failed |

While a delivery waits, the rule reads `Warning` and `Health Reason` names the failure, the attempt and the next try, as in `POST hooks.example.com: HTTP 503; attempt 2 of 8 failed, next try 2026-11-09 14:03 UTC`. The steps after it wait too, and run once a retry lands. A retry that lands returns the rule to `Healthy`. After the eighth attempt the run stops, the rule reads `Failed`, the reason ends `gave up after 8 attempts`, and the delivery becomes a record of `System/Failed Deliveries`.

The waiting delivery is stored in the workspace file, so a restart loses nothing: the minute tick that runs schedules sends each retry that is due, the first tick after a restart included. The stored request holds the url, the method, the headers and the body; a credential is held by name and added at each send. A webhook retry carries the same `X-Weave-Delivery` id as its first attempt and a fresh `X-Weave-Timestamp` and signature, so a receiver that remembers delivery ids handles it once.

A rule switched Off keeps sending the deliveries already waiting. Deleting the rule drops them.

### Failed Deliveries

`System/Failed Deliveries` holds one record per delivery that ran out of attempts:

| Column | What it holds |
| --- | --- |
| `Name` | the method, host and path, such as `POST hooks.example.com/weave` |
| `Status` | `Failed`, `Replay` while weave sends it again, or `Delivered` once a replay lands |
| `Workflow` | the rule that sent it |
| `Record` | the record that fired the rule, as `Ops/Request #12 Acme` |
| `Request` | the method, url, headers and body, with `signWith` or `integration` naming the credential; the credential value is never stored |
| `Attempts` | each attempt's time and outcome, one per line |
| `Last Error`, `Last Attempt` | the most recent failure and when it happened |

Replay a record to send it again: set its `Status` to `Replay` in the grid, or run one of these. weave sends the stored request, with a fresh signature for a signed webhook, and on success runs the steps after it, so the rule reads `Healthy` and the record `Delivered`. A replay that fails again is retried on the same schedule and returns the same record to `Failed`, its new attempts added. A record already `Delivered` is not sent twice.

| Door | Call |
| --- | --- |
| CLI | `weave automation replay <record>` |
| REST | `POST /api/automations/deliveries/<record>/replay` |
| MCP | `weave_automations` with `action: replay`, `delivery: <record>` |
| Grid | set `Status` to `Replay` |

`<record>` is the id, the public id or the Name of the Failed Deliveries record. A replay runs against the rule's current Script: if the rule was deleted, or the step that failed is no longer a webhook or http-request, the replay is refused with the reason.

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
| REST | `POST /api/automations` with `{db, name, trigger, actions, enabled}`, `GET /api/automations?db=<table>` (the rules in prose), `GET /api/automations/list?db=<table>` (the rules as records), `PATCH /api/automations/:id`, `DELETE /api/automations/:id` |
| MCP | `weave_create_automation`, and `weave_automations` with `action: list | describe | update | delete | replay` |
| Grid | a new row of `System/Workflows`, its Script written as JSON |

`weave_create_automation` and `weave_automations` carry the MCP open-world mark: a rule can call a webhook or an API, and no other tool leaves the workspace.

Deleting a rule sends its Workflows row to the trash, where restoring it brings the rule back. Switching `On` off is the reversible way to stop one.