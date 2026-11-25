- **Reach selection spends its cap on the changed lines first** (Issue #1679):
  the PR gate reads changed blocks with `git diff -W`, so a one-line edit inside
  a 1,481-line function offered the whole function's class names and routes as
  evidence, and the 60-file cap filled with suites the edit never named. The
  cap now goes first to the literals the added and removed lines name, then to
  the rest of the block, rarest first. Recall is unchanged: every token of the
  `-W` block still reaches. Of the last 80 commits touching `public`, `src` or
  `bin`, 49 filled the cap and 22 of those select a different set.
