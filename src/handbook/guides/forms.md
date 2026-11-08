# Forms

A form lets someone add one record to one table without write access to that table. An Observer, who can read and comment and nothing else, can still file a bug or send feedback through a form.

## A form is a record

Every form is a record in `System/Forms`, beside Spaces, Tables and Fields. The record names:

| Column | What it holds |
| --- | --- |
| Table | the table a submission files into |
| Fields | the fields the form shows, in order, as JSON: `[{"field": "Mood", "label": "How do you feel", "default": "Happy"}]` |
| Hidden | the fields the server fills, as JSON: `{"Reporter": "$actor", "Filed At": "$now", "Build": "$version"}` |
| Enabled | a form that is off refuses every submission |
| Floor | **Observer** (anyone with a role in the workspace) or **Anonymous** (signed-out visitors too) |
| Kind | **Record**, or **Bug report** for the bug reporter |

A form record is schema, like a Tables row: an Architect makes and edits it, and an Editor or Observer cannot.

## Submitting

A submission creates exactly one record in the form's table and nothing else. It reads no other record, edits nothing, and changes no schema. The submitter is the record's author and the actor in its history. A submission that names a hidden field is refused, and so is one that names a field the form does not show.

- **Page:** `/f/<form id>`, styled for both themes, opens to anyone the form admits.
- **HTTP:** `POST /api/forms/<id>/submit` with `{"values": {...}}`; `GET /api/forms` lists the forms whose table lives in the workspace.
- **MCP:** `weave_form_submit {form, values, idempotencyKey}`.
- **CLI:** `weave form submit <form> --values '{"Mood": "Sad"}' --idempotency-key <key>`.

An **Anonymous** floor also needs the operator to allow it: start the server with `WEAVE_ANONYMOUS_FORMS=1`. Without that switch a signed-out visitor is asked to sign in.

## Forms inside a table

Open the table's actions menu and choose **Forms…**. The same action appears in the phone menu. An Architect can create a form, choose its fields, change labels and defaults, mark required inputs, and save it. Each form has controls to open it, copy its link, edit it or pause submissions. Editing keeps its form ID and permalink.

The editor writes the existing System/Forms record. Server-filled values survive edits. Advanced input keys remain stable, and old keys remain aliases. Forms created by an agent appear in the same manager.

The audience control reports whether the server allows anonymous submissions. In a workspace with sign-in disabled, forms follow that workspace's open access. A member-workspace Architect also needs Architect access on the hub registry to manage its forms.

| Surface | Management |
| --- | --- |
| HTTP | `GET /api/forms/manage?table=<id>`, `POST /api/forms`, `PATCH /api/forms/<id>` |
| CLI | `weave form create --definition '{json}'`, `weave form update <id> --definition '{json}'`, `weave form config <id>` |
| MCP | `weave_forms {action, form, definition}`; actions: list, get, create, update |

A creation definition contains `name`, `table` and `fields`. Updates contain only settings to change. Hidden values are available only through the privileged management read. The built-in bug form keeps its dedicated bug-report flow.

## Stable links and input keys

The form ID keeps its address stable while its name, labels and layout change. Prefix the path with `/w/<workspace>` when needed. Configure a field with a stable input key:

`[{"field":"Name","key":"title","label":"Page title","aliases":["subject"],"required":true},{"field":"Link","key":"url"}]`

Saving the form resolves its fields to IDs and retains its previous input keys as aliases when they change. Labels can change without changing a key. A removed field is refused; a newly required field needs a value on new submissions. Existing accepted requests keep their retry receipts.

| Input | Example |
| --- | --- |
| URL draft | `/f/<id>?title=Read%20this&url=https%3A%2F%2Fexample.com` |
| Prefill prefix | `/f/<id>?prefill_title=Read%20this` |
| Several selected options | `?tags=Research&tags=Product` |
| JSON body | `{"values":{"title":"Read this","url":"https://example.com"}}` |
| Standard form body | `title=Read%20this&url=https%3A%2F%2Fexample.com` with `application/x-www-form-urlencoded` |

Field IDs, configured aliases, current field names and labels also work. Unknown or invalid URL values produce a visible warning; hidden values cannot be prefilled. Submission rejects unknown, ambiguous, hidden or invalid fields. A required boolean must be provided; false is a valid answer.

Opening a URL only fills a draft. A person presses **Send**, or a caller makes a POST, to create the record. Sign-in preserves the form's query parameters. A Squirrel-style share-sheet Shortcut can URL-encode the shared title and URL and open this draft, without storing a workspace token on the phone.

## Retries and duplicate detection

Send a new random UUID in `Idempotency-Key` for each intended submission. Reuse it with the same input after a timeout. JSON and standard form bodies may instead carry `idempotencyKey`. Anonymous keys require 32 to 200 letters, digits, hyphens or underscores. Treat an anonymous retry key as a receipt capability and keep it private.

| Case | Result |
| --- | --- |
| New input | 201 and a receipt |
| Same key and input within 24 hours | 200 and the original receipt, even after restart |
| Same key with different input | 409; no new record |
| Identical input within 60 seconds, same signed-in actor or browser cookie | Original receipt, with duplicate marked |
| Independent anonymous browsers | Separate submissions |
| Disabled form | Refused, including retries |

The browser retains a pending retry key in tab session storage until success, so a lost response can be retried without a second record. Anonymous clients without a browser cookie receive retry protection when they supply a key; they do not share content deduplication with other clients. Duplicate matching uses submitted values, with types normalized. It does not merge existing records or compare similar wording.

## Limits

HTTP submissions allow 20 attempts per sender IP per form, 120 per form and 1,000 across the server in a one-minute window. A 429 response includes Retry-After. These counters are local to the server process and reset on restart. Form bodies are capped at 64 KiB. Cross-origin browser POSTs remain refused; server and Shortcut clients can POST directly.

Each workspace retains at most 10,000 unexpired receipts for 24 hours. At capacity, new receipts are refused until space expires; existing retries still work. Receipts persist with the record in one transaction and are omitted from JSON exports. A database backup preserves them. These limits suit a single server; multiple serving processes need shared rate counters.

## The bug reporter is the first form

The bug glyph files through the **Report a bug** form on the `weave` docs workspace. It keeps its four symptoms, its note, its action trace and the server's own version stamp. `POST /api/bug-report` still answers, as an alias that submits through the form, so turning the form off turns the reporter off too.

## The weave docs workspace

The `weave` docs workspace is built in. Nobody can delete it, rename it or leave it; each attempt answers 403. Every login any workspace on this instance knows opens it as an Observer, with no invite and no account record there, and may submit a bug through its form.

## How you know it worked

Open `/f/<id>`, fill it in and press **Send**. The button reads **Sent** and the line under it names the new record, such as `Development/Issue #412`. The record shows you as its author.