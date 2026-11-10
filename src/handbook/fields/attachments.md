# attachments

Files on a record. Bytes live in the workspace's sibling `files/` directory; the cell holds their ids.

## Config

**Display inline** (`displayInline` set to `true`) renders the content directly in the record body without its field heading or collapse control. Editors open **Field options** beneath the content to reach settings, source and file controls. The field keeps its identity, permissions and place in the schema. Move it using the existing body order to put it above Fields or elsewhere; enabling inline display does not change its position. Turn it off to restore the standard display.

HTML keeps its sandbox and expands to fit its content. Empty inline documents have no reader-facing section. The setting is available in the field editor and through the same config in MCP, REST and CLI.

Image covers remain separate: `preview: "cover"` keeps the native header treatment. The earlier `preview: "intro"` remains supported; use Display inline for new fields.

`multiple` — `true` by default; `false` makes the field hold exactly one file.

`preview` — how the record shows the files: `link` (chips), `inline` (a contact sheet of the files, or the one file in its viewer), `auto` (pictures in the sheet, everything else a chip) or `cover` (the picture above the record; single-file fields only). Unset follows the field: `auto` for many, `inline` for one.

`size` — `small`, `medium` (default) or `large`: the sheet's cell and the viewer's height.

`fit` — `trim` (default) shows the whole file and trims the cell to its shape, so a portrait page stands tall beside a wide screenshot; `fill` makes every cell the same box and crops the file to it. Nothing is ever stretched.

Every path takes a file of up to 10 MB: the field in the browser, the REST attach routes, `weave attach` and MCP. A larger file is refused by name, with the limit in the message. The browser checks the size before it reads the file, so an oversized pick never leaves the machine, and the attach routes answer an oversized body with `413` and a JSON body whose `limit` gives the limit in bytes.

Each file you pick or drop shows a tile in the field at once, with its name, a progress bar and **Uploading 40%**, then **Saving** once the browser has sent it and the server is writing it. The field is `aria-busy` while any upload runs. Files in one pick or drop go up one at a time, and each is tried on its own, so one failure never stops the rest. One toast sums up a batch: "3 files uploaded." when all landed, or "2 of 3 files uploaded." with the file that was not saved and why.

An upload that fails stays in the field as a red tile carrying the reason (Over 10 MB, Storage full, Still restarting, Error and the request id, No connection or Timed out), a Retry button that sends the same file again and a Dismiss button that drops it. A file over the limit gets no Retry, since sending it again cannot help; the toast offers **Choose another file** instead. A full disk gets no Retry either: the server answers `507` with code `storage-full`, and the toast asks you to tell whoever runs your weave. When the hosting edge answers `502` or `503`, which usually means weave is restarting after a deploy, the tile reads **Server restarting** and weave sends the file again after about 2, 5 and 10 seconds before it reports a failure. When a request times out or a gateway answers `504`, weave reads the row again before it reports a failure, since the server may have stored the file before its answer was lost. Any other server error names the request id the server logged, so a report can be matched to the log. The file input empties after every attempt, so the same file can be picked again. The document editor's upload button and the avatar picker check the same limit and say the same things.

```bash
weave field add Task Files attachments
weave field add Person Headshot attachments --config '{"multiple":false,"preview":"cover"}'
weave field add Issue Evidence attachments --config '{"preview":"inline","size":"small","fit":"fill"}'
```

## Usage

```bash
weave file attach Task#5 --path ./spec.pdf --field Files
weave file read <fileId> --out ./spec.pdf
weave file delete Task#5 <fileId>
```

Renders by its `preview`. A click on a file's chip or sheet cell opens it in a panel beside the record: an image, a PDF, plain text, or an HTML upload live under `GET /api/files/:id?view`, never a download. The panel's arrows step through the field's files, its full-screen button opens the same file full-screen (where ← → step too), and its ✕ or Esc closes it. ⌘-click a chip to open the file in a browser tab instead. The grid cell is a chip too: clicking it opens the row's first viewable file in the panel, whose arrows step through the rest (Issue #1072). A file of any other kind stays a download link. A single-file field shows its file in place: an image, a PDF or plain text in a frame whose bottom edge drags. Every HTML file renders in place on the record (Issue #1175), in a many-file field and on the loose Files card too, one frame per file, unless the field's preview is `link` or `cover`. The page loads live under `GET /api/files/:id?view`, whose sandbox keeps it off the workspace's origin (its scripts run, its links open a new tab, and it can read nothing of weave's), and the frame takes the page's own height: `?view` adds one script after the doctype that posts the page height to weave, and weave sizes a frame only from its own window's messages. A frame starts at three quarters of the window's height, so a page laid out on the viewport height (`100vh`), such as a slide deck, keeps that height instead of growing without end. The stored bytes are unchanged; `weave file read` and the bare route return the file as uploaded.

In the app, drop files from your desktop onto the field's cell in the grid, or onto its files on the record: the cell lights while files hover it, and every file you let go of uploads into the field. **+ file** on the record picks one or more from a dialog. An upload into a single-file field that already holds a file replaces it; the old file stays in the record's file ledger. Where a table shows its records as cards, drop a picture on a card to set its cover: it uploads into the table's cover field, a file that is no PNG, JPEG, GIF or WebP is refused, and a table with no cover field offers to add a Photo field.

## Gotchas

Files are not documents. A document is written and rendered; an attachment is stored and handed back. Copying the `.db` on its own drops every attachment — back up `files/` beside it, or take a `weave export`, whose JSON carries the bytes inline and lands them in `files/` again on import. The MCP `weave_export_json` leaves the bytes out unless it is called with `blobs: true`; import that dump into another data directory and each file arrives as a name only. The import result counts the files and lists each one without bytes under `missing`.

An HTML file's own edits live in its page storage, not in the file (Issue #1176). A page that saves to `localStorage` while weave shows it, such as a deck that autosaves, writes to an in-memory store that weave seeds from the file's saved snapshot and saves back, a moment after each change, to `PUT /api/files/:id/storage` (`{"items": {"key": "value"}}`; `GET` reads it). The next `?view` load, on any device, starts from that snapshot. The file's bytes never change: `weave file read`, an agent or a download gets the page as it was uploaded, without the edits. A file keeps at most 5 MB of page storage; a larger write is refused with a message and the last saved snapshot stays. `sessionStorage` lasts only while the page is open, and IndexedDB is still unavailable to the sandboxed page. Deleting the file deletes its storage. A workspace JSON export leaves page storage out; a backup of the `.db` keeps it.

A file whose bytes are gone keeps its name and is marked `(missing)` in the cell and on the record. Metadata outlives the blob, so weave says which file was lost rather than offering a link that cannot open.

A file attached to the record rather than to this field (`POST /api/entities/<id>/files`, or `weave file attach` with no `--field`) lands in the record's file ledger. The record's **Files** card lists everything in that ledger no attachments field already draws, with the same link and `(missing)` treatment, so a record whose table has no attachments field still reaches its files. The card is a body block like the fields: it sits directly below the fields, above the Deck or Slide preview and the documents, until you drag its grip to move it, and its caret folds it. **Make a field** in its header adds an attachments field to the table (named Files, or Files 2 when that name is taken) and moves the listed files into it without uploading them again, so they pick up the field's preview and multiple settings.

A file delete is not undoable.