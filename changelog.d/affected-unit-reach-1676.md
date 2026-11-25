- **Local affected selection narrows its unit lane** (Issue #1676):
  `npm test -- --affected` ran all 620 gating unit files for any source change,
  so the local answer to "which tests does my diff reach" was the whole unit
  suite. It now keeps the unit files that reach a changed `src/`, `bin/` or
  `scripts/` file through the relative-import graph, name it, or read the
  directory it sits in: 33 files for a leaf script, 468 for a module the engine
  imports. A change the graph cannot follow still runs every gating unit file,
  and the `PR gate` and `CI gate` are unchanged.
