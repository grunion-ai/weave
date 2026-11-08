# url

A string the grid renders as a link, opening in a new tab. Click the link to open it; use the pencil beside it, double-click, or press Return on the cell to change the address.

## Config

`default`.

## Usage

`{"Repo": "https://github.com/grunion-ai/weave"}` — no scheme validation is enforced on write. Any scheme draws as a link — `claude://resume?…` and `mailto:` open in place through their handler, `http(s)://` opens a new tab — except `javascript:`, `data:`, `vbscript:`, `blob:` and `file:`, which rest as a text box so a stored string can never run in the reader's tab.

## Gotchas

Webhook automation URLs **do** validate (`http(s)://` required). The `url` field type does not, so validate upstream if strictness matters to you.