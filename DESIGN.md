---
name: Weave status
description: Existing Weave identity applied to the public service status surface.
colors:
  brand-blue: "#2563eb"
  canvas-light: "#eceff3"
  canvas-dark: "#0f1115"
  panel-light: "#ffffff"
  panel-dark: "#181b21"
  divider-light: "#d9dee6"
  divider-dark: "#2a2f38"
  text-light: "#18212f"
  text-dark: "#e6e8ec"
  secondary-light: "#586273"
  secondary-dark: "#a1a9b7"
  operational-light: "#21734b"
  operational-dark: "#78cda0"
  degraded-light: "#895b0c"
  degraded-dark: "#e9bb65"
  outage-light: "#b52c38"
  outage-dark: "#f28c95"
  unknown-light: "#76808e"
  unknown-dark: "#7d8797"
typography:
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.6
  headline:
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.025em"
rounded:
  button: "6px"
  panel: "8px"
  day: "2px"
---

# Design System: Weave status

## Overview

The existing identity in `brand/README.md` remains the visual authority for Weave. `PRODUCT.md` records the product constraints. This document captures the implemented `/status` surface in `public/status.html`, `public/status.css`, and `public/status.js`; its layout choices apply to this surface.

The status page follows Kyle's Anthropic reference through a calm, narrow reading layout: current availability first, recorded uptime next, then incident updates. The lowercase weave name and horizontal rope mark retain the existing identity. Native HTML, CSS, and JavaScript keep the page independent of a component framework or build step.

## Colors

Cool slate canvas surrounds white or charcoal panels. `prefers-color-scheme` selects the light or dark palette. The rope pairs brand blue with ink `#0c1b33` in light mode and sky `#60a5fa` in dark mode. Links use brand blue in light mode and `#8ab4ff` in dark mode.

Operational, degraded, outage, and unknown states use green, amber, red, and gray respectively. Every state also has a text label. Unknown day bars have reduced opacity. The overall summary uses a quiet state tint; its exact theme values remain in `public/status.css`.

## Typography

The status surface uses the native system stack throughout. Its wordmark is live text at 27px, weight 650, with `-.02em` tracking beside the inline rope SVG. The canonical brand lockup remains Outfit 600 in `brand/README.md`; this page does not load a web font.

The page heading is 30px, section headings 17px, and incident titles 16px. Secondary timestamps and monitoring details run from 11px to 13px. Incident update prose is 14px with a 68ch maximum width. Day details use tabular numerals.

## Layout

The centered shell has an 816px maximum width, including 28px horizontal padding. Sections follow one vertical reading path. The overall summary precedes the services panel; active incidents sit above resolved incident history. Dividers separate service rows and incident entries.

At 520px and below, shell padding becomes 20px, the page heading becomes 27px, and incident headings and footer content stack. Each service keeps all 90 day bars visible. Mobile bars are narrow; focus and selected-day text provide the detailed reading path.

## Elevation & Depth

The page uses flat tonal surfaces and one-pixel borders. It has no shadows or decorative motion. The tinted overall summary and white or charcoal service panel establish hierarchy against the slate canvas.

## Shapes

Summary and service containers have 8px corners. Standard buttons use 6px corners and a 40px minimum height. Day bars use 2px corners, reduced to 1px on mobile. Status dots and incident timeline markers are circular.

## Components

| Component | Implemented behavior |
| --- | --- |
| Header | Rope mark, lowercase weave name, and return link |
| Overall summary | Text status, state dot, last-check time, polite live announcement |
| Service row | Service name, current state, recorded-check uptime, last response time, 90 UTC day bars |
| Day history | Native buttons with descriptive labels; pointer, click, and focus reveal details; Left/Right and Home/End move through days using one tab stop per service |
| Monitoring explanation | Native details disclosure explaining recorded checks and unknown periods |
| Incidents | Separate active and resolved sections; newest update first; UTC timestamps; ten resolved incidents initially, with earlier entries on demand |
| Refresh and failure | Manual refresh, one-minute refresh while visible, retry button, explicit unavailable or delayed status |
| Footer | Independent status page link and refresh/time-zone note |

Focus outlines remain visible on links, buttons, and disclosure summaries. A refresh preserves the focused day when that day remains available. Unmeasured periods stay unknown; stale current checks and failed fetches do not imply operational health. The independent status link remains available in the footer when the application-hosted page can load.

## Do's and Don'ts

- Do preserve the incumbent rope geometry, strand pairs, and cool slate surfaces.
- Do pair status colors with labels and retain keyboard access to daily history.
- Do distinguish recorded-check uptime from unmonitored time.
- Don't fabricate historical measurements or turn missing data into healthy periods.
- Don't introduce runtime dependencies, a build step, or visitor incident submission through this surface.
