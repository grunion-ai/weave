- **Build trial skipped after a passing dry run** (Issue #1606): `weave_build`
  cloned the whole workspace state for a trial run on every call, so a dry run
  followed by the real build of the same spec cloned 20 MB twice. A real build
  that follows a passing dry run of a byte-identical spec, with no write in
  between, now runs straight through. Any change to the workspace, a different
  spec, a different viewer, or a red dry run brings the trial back.
