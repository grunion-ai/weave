# email

A string checked against a pragmatic address pattern on write, rendered as a `mailto:` link.

## Config

`default`.

## Usage

`{"Contact": "ada@example.com"}` — `"not-an-email"` is rejected with a 400.

## Gotchas

Format only: no MX lookup, no deliverability check. Empty clears to null.