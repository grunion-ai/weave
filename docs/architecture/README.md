# Architecture map

`weave.architecture.html` is an interactive map of weave's runtime: the two host adapters, the shared request core, the engine, both stores, the renderers, sign-in, backup, and the CLI and MCP surfaces agents use. Download it and open it in a browser. It pans, zooms, searches, plays three guided views, and switches between light and dark.

Every node links to the lines of code it stands for, pinned to one commit. The pin is `meta.repository.revision` in `weave.architecture.json`, and each link opens that commit on GitHub, so the map describes weave exactly as of that commit and says which commit that is.

## Files

| File | Role |
| --- | --- |
| `weave.architecture.json` | The source: components, connections, boundaries, cards, guided views, and the cited files and lines. Edit this one. |
| `weave.architecture.html` | Rendered by [archify](https://github.com/tt-a1i/archify) (MIT) from the JSON. Never edit it by hand. |

## Keeping it true

`test/architecture-map.test.mjs` runs with `npm test` and fails when:

- a cited file was moved or deleted,
- a file in `src/` or `bin/` is not named anywhere in the map (a component source or a card line),
- the HTML was rendered from a different JSON, or pinned to a different commit,
- the pinned commit is not in this branch's history.

To fix a red gate, edit the JSON, then re-pin and re-render:

```bash
node scripts/architecture.mjs          # pins HEAD
node scripts/architecture.mjs <sha>    # pins a given landed commit
```

The script runs archify's `deliver`, which checks every cited line at the pinned commit and refuses a layout with crossings or overlapping labels. archify is a development tool and never a weave dependency: the script looks for it at `$ARCHIFY`, then `~/.claude/skills/archify/bin/archify.mjs`.

## Versions

Every release re-pins the map in the same change as the version bump (DEVELOPMENT.md, "Releasing"), so each tagged release carries a map of the code it shipped. To see how the architecture changed between two releases, check out both JSON files and run `archify compare architecture <old.json> <new.json>`.
