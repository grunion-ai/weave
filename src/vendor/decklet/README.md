# decklet — vendored

Pinned copy of [grunion-ai/decklet](https://github.com/grunion-ai/decklet) — the slide
engine weave composes decks with. MIT.

| | |
| --- | --- |
| Version | **0.3.3** |
| Commit | **cf73916** — "Rebuild deck.html against the merged explainer model (self-hosting gate)", 2026-08-23 |

The package version moves slower than the build, so **the commit is the pin**: 0.3.3 plus
everything that landed after the tag — `href` links (row anchors and inline marks), `curve`
and `arrow` connector rows, the parity collision check, the storage probe, and the
flicker-free `⤓` rasteriser.

Three files, verbatim from that commit except for one path:

| Here | Upstream | Change |
| --- | --- | --- |
| `create.mjs` | `bin/create.mjs` | template path is a sibling (`./template.html`), not `../template.html` |
| `validate.mjs` | `bin/validate.mjs` | none |
| `template.html` | `template.html` | none |

Both modules import node builtins only — vendoring keeps weave's zero-runtime-dependency
rule intact. `src/deck.js` is the only consumer; nothing here is served to the browser
directly (the composed deck HTML is).

To update: copy the three files from a decklet checkout, re-apply the path change, put the
new commit in the table above, and run `node --test test/deck.test.mjs`. The upstream suite
is the engine's own gate, not weave's — check it (`node --test test/*.test.mjs` in the
decklet checkout) before pinning a commit, and say in the commit message if it is red.
