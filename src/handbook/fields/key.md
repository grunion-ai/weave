# key

A **credential**: an API key, a token, a shared password, an OAuth pair, or an id you would rather not print. The cell holds the credential's NAME. The secret itself lives in `~/.weave/keystore.json` — encrypted, chmod 600 — or in the manager that already owns it, and never in the workspace.

## Config

`kind` — `apikey` (default), `token`, `password`, `id`, `pair`. Metadata: it changes the label and the glyph, never what the cell stores.

`keystore` — `local` (default), `1password`, `aws-sm`, `google-sm`, `cloudflare`, `apple-passwords`. A remote store keeps its own access rules; weave holds only the ref and offers a link.

`parts` — a `pair` only. Two `{ name, secret }` entries, defaulting to `id` and `secret`. One credential with two parts, so an OAuth id and its secret stay under ONE grant.

```json
{ "name": "Portal Login", "type": "key", "config": { "kind": "password", "keystore": "1password" } }
```

## Usage

```bash
weave key set vendor-portal --value s3cr3t
weave key set vendor-portal            # reads stdin
weave key list                         # names, owners, who each is shared with
weave update 'Field Types#1' --values '{"API key": "vendor-portal"}'
```

The cell reads `✱✱✱✱ vendor-portal`, or `✱✱✱✱ vendor-portal (unset)` when the local keystore has no such name yet. A remote keystore gets no `(unset)` — weave cannot see inside 1Password and will not guess.

## Who can read it back

Everywhere else in weave, reaching the table reaches the values. A credential looks like the exception and is not one: the secret was never IN the table. The name is ordinary table data that anyone with the record can see; the secret sits behind the credential's own access list.

```bash
weave key reveal vendor-portal          # owner, or someone granted — prints the bare value
weave key share vendor-portal --with sajit
weave key unshare vendor-portal --with sajit
```

A new credential is owned by the account that set it and shared with nobody; owners and grants are account ids, so a name typed by a caller with no account opens nothing. Copying counts as revealing, and every reveal and every grant lands in the audit log. **There is no MCP reveal** — an agent can name, set, share and drop a credential, never carry the secret out.

## Gotchas

There is still no read-back GET, on any surface. Reveal is a POST because it is an act, not a read.

A legacy credential with no owning account stays unavailable through the web and MCP. An operator with local CLI access can grant it to an account through `key share`. A workspace Architect gains no access to another account's credential by role alone. Sharing grants access without changing ownership.

Storing a name the keystore does not hold is allowed on purpose — set the record first and the secret later. An export carries the names and none of the values, and neither does a formula, a lookup or a query result.