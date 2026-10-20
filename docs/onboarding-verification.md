# Onboarding verification contract

These journeys are release behavior, not a one-time audit checklist. The PR author owns keeping the assertions and this mapping current in the same change as a changed flow. Every onboarding bug adds a reproducing regression before its fix. Renaming or replacing a suite must update the mandatory inventory, its tests and this document together; deleting coverage or skipping a broken test is not a fix.

| ID | Journey and required outcome | Executable coverage |
| --- | --- | --- |
| WEB-01 | Every website signup CTA preserves explicit signup intent; Sign in remains distinct; both are usable on desktop and phone in both themes | Website `tests/weave-entry.spec.js` and its required evidence validator |
| ONB-01 | Direct `/start`, explicit signup and login-to-signup reach an authenticated account; refresh and mode switching preserve intent | `setup-flows-browser.test.mjs`, `setup-routes.test.mjs` |
| ONB-02 | First workspace: name/address validation, template search/selection, empty creation; entered values survive Back | `setup-flows-browser.test.mjs`, `setup-core.test.mjs` |
| ONB-03 | Optional AI setup can be deferred; opening the workspace reaches usable content; simulated connector discovers tools and calls one | `setup-flows-browser.test.mjs` |
| ONB-04 | Returning user opens the intended workspace or linked row; switching login/signup and reload retain the destination | `workspace-signin-start-browser.test.mjs` |
| ONB-05 | Existing member creates a second workspace with a fresh name; Back returns to the picker; refresh preserves its draft | `setup-flows-browser.test.mjs` (desktop/phone × light/dark) |
| ONB-06 | Invited architect/editor/observer lands in the right existing workspace, with permitted actions, without the creator wizard | `setup-flows-browser.test.mjs` (three roles × empty/populated × desktop/phone) |
| ONB-07 | Invite creation, copy, revocation and email success/failure provide usable feedback | `invites-browser.test.mjs`, `invites-mail-browser.test.mjs`, `invites.test.mjs` |
| ONB-08 | Used/invalid invitation allows legitimate member recovery and never grants an outsider access | `setup-routes.test.mjs` |
| ONB-09 | Refresh, interrupted creation, expired sign-in and blocked storage preserve a safe recovery path; no duplicate creation or cross-identity draft reuse | `setup-flows-browser.test.mjs`, `setup-core.test.mjs` |
| ONB-10 | Rejected sign-in, occupied address, failed build, closed registration and blocked provider UI remain recoverable | `setup-flows-browser.test.mjs` |
| CORE-01 | The resulting product still opens tables, documents, entity detail and views with usable navigation and bounded click cost | Existing `SMOKE` suites in `scripts/ci-test.mjs` |

## Merge decision

`ONBOARDING` in `scripts/ci-test.mjs` is the mandatory browser inventory. All four suites run on every ready PR alongside the existing smoke set and every unit suite. Missing mandatory files fail planning. `PR gate` validates execution evidence against the tested commit and complete shard manifest: missing results, zero tests, failed/cancelled execution and skipped onboarding tests fail. `Dev gate` and `security scan` remain required. A new push invalidates the prior result. Arm squash auto-merge only for a ready PR; a passing gate permits merging without a separate approval. Main CI and dev soak remain separate production-promotion controls.

The website repository separately requires its full build/browser job and `Website E2E gate`. The latter validates recorded outcomes for every WEB-01 profile. The boundary test intercepts the outgoing destination; app journeys run against a local app and test identity provider. These are complementary contract checks, not a claim that one browser crossed the live website, identity provider and production app.

## Keeping the series current

- Flow changes update the corresponding assertions and this matrix in the same PR. Keep IDs stable; update paths when files move.
- Bugs become named regression cases with an Issue reference. Run through the final persisted result, not a transient loading screen.
- Keep desktop Chromium and phone WebKit coverage; invitation roles and empty/populated states are required permutations, not optional smoke samples.
- Do not resolve red checks with skips, unconditional retries or lower assertions. Diagnose failures; log recurring flakes. Preserve traces and execution evidence for diagnosis.
- Review this contract when adding an entry point, role, authentication method, workspace state or recovery path. Add the new permutation before enabling it.
- Changes to the gate itself must include negative tests proving missing/failed evidence cannot pass. Repository rule changes preserve existing unit/security checks.

## Explicit remaining coverage

Physical iOS/Android devices and live OTP/Google/email delivery are not verified by these hermetic PR checks. Feature #344 tracks a browser-driven multi-tab connector authorization and return journey with click/tab/sign-in budgets; the present HTTP simulation does not close that feature. Record real-provider/device checks as dated evidence; do not represent them as automated passes. Auto-merge is permission to land tested code, not proof of live-provider availability or production deployment.
