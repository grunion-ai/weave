# Public documentation presentation

The public weave workspace is the documentation site. `src/handbook.js` owns the guide manifest and Markdown under `src/handbook/guides/`. `src/handbook/presentation.js` owns the selected space, table, guide and release introductions and banner choices. These are ordinary native records, documents, attachments and presentation fields; there is no separate service.

On server startup, Handbook and Showcase synchronize first. `syncDocumentationPresentation` then resolves each named target in the docs workspace, attaches its banner and HTML introduction, and places the introduction before the remaining body blocks. Missing optional Showcase targets produce no link. Duplicate guide or release names are skipped. New guides belong in the Handbook manifest so startup creates them before resolving links.

## Change the presentation

Edit the introduction in `src/handbook/presentation.js`. It uses workspace-relative links resolved from actual IDs. HTML is self-contained and runs in the existing file sandbox. The image remains a native cover outside the HTML. Keep the complete mark visible: the documentation banners are 1584 × 396 and use the default uncropped image fit.

Run `node brand/kit/build-kit.mjs --documentation-banners` to regenerate the five runtime banners under `src/handbook/banners/`. The generator reuses the brand kit's mark, ring, wordmark and patterns. The dark contour and band banners are exact copies from the kit. All five ship under src because container images exclude the marketing brand directory.

## Ownership and preservation

Presentation ownership is recorded in workspace metadata. A no-change rerun keeps attachment IDs and creates no activity. A source revision replaces the current owned attachment and keeps the old file in the ledger. A manually replaced or cleared field, edited file, renamed/removed field, or changed body order is preserved and reported. Descriptions update only when empty, still equal to the last owned version, or exactly equal to the explicitly named previous description.

Issue, Feature, Suite and Case are never presentation targets themselves. Their spaces can gain landing introductions, but their schemas, records, views and histories stay unchanged. Existing release notes are not rewritten by presentation sync. Guide Markdown follows the existing Handbook source-sync contract.

## Verification and publication

Run the documentation content, sync, banner and native presentation tests alongside Handbook, brand-kit and architecture checks through `npm test -- --targeted …`. Review the actual app in light and dark themes and at phone width. Check the complete logo, intro-before-fields order, and native link destinations.

Ship through the normal PR, main CI, dev soak and production promotion flow. Verify `/api/health` names the promoted commit before marking the tracker feature shipped. Then inspect the public Handbook and one guide, space, table and release; a merged PR is not evidence of live publication.
