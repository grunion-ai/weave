- **One command moves the byte budget** (Issue #1680): `test/byte-budget.json`
  took 57 commits in 90 days, and every one of them was an agent reading a red
  unit test, parsing the numbers out of the message and editing the JSON by
  hand. `node scripts/byte-budget.mjs` now measures every first-party asset
  against the ledger and prints the edit it wants; `--write` applies it, and a
  raise is refused unless `--why "<reason>"` gives the reason that
  `unexplainedRaises` demands. The command keeps the file's existing key order,
  so a single raise is a one-line diff rather than a reordered file, and a
  revert that leaves the ledger ahead of the code is one run away from the
  truth again.
