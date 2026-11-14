# Reporting a bug

The bug glyph in the bottom-right corner of a desktop page opens a small panel beside it. On a phone the same panel opens from **Report a problem** in Your menu, from the ⋮ menu on a record, and from the bug glyph in the Activity sheet’s head, so a report starts on the screen the problem is on. The page stays visible while the report is written, because reporting a bug must not cover the bug. Type a sentence, pick any of the four symptoms — **Slow**, **Looks broken**, **Wrong data**, **Error** — and there are two ways to send it.

## Report issue: an Issue on this instance

**Report issue**, or `⌘Return` from the note (the `⌘↵` on the button says so), files a record into this instance's `Development/Issue` table, in the `weave` docs workspace, with the symptoms in the `Symptom` multiselect and a **Replay** section built from the recorder every session runs: routes entered, controls clicked, requests that failed, anything that threw. The recorder keeps control names, never what was typed into them. The server stamps its own version and start time on the record, so a stale build cannot report itself as current. The record also asks **Which probe would have caught this?** Whoever fixes the bug answers it with the probe that should have caught it, or with none, and the weekly quality scorecard counts the answers that read none.

That record lives where the instance lives. On the canonical instance it is read every night. On a self-hosted weave it is on your disk, and an instance without a docs workspace cannot file it at all.

## Email instead: the way out of any instance

**Email instead**, at Report issue's left, opens your mail app with the report filled in, addressed to `weave@grunion.ai`, from your own address. Read it, edit it, add a screenshot, then send. Nothing transits the weave server. The address is receive-only; a reply comes from a person's own mailbox to yours.

A page that did not load offers the same link under its message as **Report by email**, with the error folded in.

The address is printed under the panel's foot, so a device with no mail app still has something to copy. The whole link is held under 2000 characters, the ceiling mail clients accept: a long console line is shortened first, then a long note, and the fixed lines always ride.

### The subject

`[weave] <symptoms>: <first line of the note>` — `[weave] Error: the grid never loaded`. The tag names the product, because one inbox label covers several. With no note the place stands in: `[weave] on /w/<ws>/#/entity/<id>`.

### The body

| Line | Comes from | Why triage wants it |
| --- | --- | --- |
| Symptoms | the four toggles | maps onto the Issue table's Symptom and Severity |
| Note, Steps, Expected, Actual | you, finished in the mail app | the account of what happened |
| `weave v0.4.17, started …, up 3h` | `/api/health`, with a STALE mark when the server predates its own files | a stale build is the most common false bug |
| Page | the **route shape**: `/w/<ws>/#/entity/<id>` | which kind of page failed |
| Browser | family, major version and OS | layout bugs are browser-specific |
| `1440 × 900 · dark` | the window and the theme | layout bugs depend on width; both themes are checked |
| Console | the newest error message, secrets stripped, quoted strings blanked, 300 characters at most | the one line that explains an Error |

## What never leaves the page by mail

- The **workspace name** and every entity, table, space and view id: the page line is the route shape, with `<ws>` and `<id>` in their places, and the query string (a docked entity, a share token) dropped.
- Record names, page titles, field values: the email quotes nothing from the workspace. A server message that quoted a name arrives as `"…"`.
- The action **trace**: its steps name tables and buttons, and a schema is yours. It goes into the local Issue only.
- Tokens and keys: the same redaction the server applies to an Issue runs in the page before the link is built.
- The raw user-agent string, the page URL, and anything from `state.meta`.

## How you know it worked

The mail app opens with the To, Subject and body already there. If nothing opens, the browser has no mail handler: copy the address from under the panel and send the report from any client.