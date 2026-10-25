# weave marketing kit

The weave badge, posters and patterns for the website, email, social, decks, print and merch. Every file here is generated from the canonical mark in [`../assets`](../assets) and [`../../public/brand`](../../public/brand), so the mark is never redrawn by hand.

**Agents: start with [`manifest.json`](manifest.json).** It lists every asset with its code, SVG and PNG paths, pixel size, the ground it is drawn for and where it goes. Pick by `family` (`lockup`, `badge`, `poster`, `pattern`, `icon`) and `use`, then take the `svg` for web and print or the `png` for email and social uploads.

## The badge

A sawtooth seal drawn after Peters Design Company, with the weave mark at the centre and the ring words **DATA · AGENTS** over **SYSTEMS**. Kyle chose the words on 2026-10-16 (Feature #347). The words live in [`labels.json`](labels.json) as `sealTop` and `sealBottom`; every badge, lockup and poster reads them from there.

## Recipes

| Need | Use | Why |
| --- | --- | --- |
| Site, app or document header | `lockup-light` or `lockup-dark` (L1, L2) | Mark and word in one file, word outlined |
| Sign-in, splash or square cover | `lockup-stacked-light` or `-dark` (L3, L4) | Fits a square or a narrow column |
| Website hero or section background | `pattern-contour-light` or `-dark` (M1) as a full-bleed SVG, `badge-blue` (B1) on top | Vector, scales to any width |
| Link preview (`og:image`) | `png/poster-og-contour.png` (X6) or `png/poster-og.png` (X1) | Link unfurlers need a 1200 × 630 raster |
| Email header or signature | `png/badge-lockup-light.png` (B14) at 330 px wide, or `png/badge-small.png` (B12) at 48 px | Gmail strips SVG; PNGs are 2× for retina |
| Dark email or dark site section | `badge-cream` (B6) or `badge-lockup-dark` (B15) | Blue sinks on ink |
| Square social post | `png/poster-contour-square.png` (X6d) or `png/poster-square.png` (X4) | 1080 × 1080 |
| Profile banner | `png/poster-contour-banner.png` (X6e) or `png/poster-banner.png` (X5) | 1584 × 396 |
| Story | `png/poster-story-contour.png` (X7b) | 1080 × 1920 |
| One-colour print, stamp, invoice | `badge-mono-blue` (B7) or `badge-mono-ink` (B8) | Ring type and rays knock out to the paper |
| On brand blue | `badge-ink` (B2), `badge-mono-white` (B10) or `badge-watermark` (B11) | Built for a `#2563eb` ground |
| Under 72 px (avatar, favicon spot, chip) | `badge-small` (B12) or `badge-small-ink` (B17) | Ring type is unreadable that small |
| Sticker | `badge-sticker` (B13) | Cream ring is the die line |
| Merch or packaging all-over print | `pattern-rope-twill` (M2d), `pattern-rope-blue` (M2e) | Repeats edge to edge |
| Release notes | `badge-release` (B3) with the version text edited | Version text is live |
| Public form or shared view footer | `badge-footer-light` / `-dark` (B5) | Links back to weave |

## Rules

- Never redraw, recolor, outline or rotate the mark. Every asset embeds the canonical mark file.
- Strand pairs stay as in [`../README.md`](../README.md): blue with ink on light, blue with sky on dark, cream with ice on brand blue.
- Use each badge treatment on the ground named in `manifest.json`. A badge on the wrong ground loses its ring.
- The L lockups outline their wordmark, so they print as they are. Ring type and the other wordmarks are live Outfit 600 text. The PNGs are rendered with Outfit loaded. Before print, outline the text in the SVG.
- Backgrounds come from the Surfaces table in [`../README.md`](../README.md).

## Changing the kit

```
node brand/kit/build-kit.mjs          # SVGs and manifest.json
node brand/kit/render-kit-png.mjs     # PNGs through Playwright Chromium, Outfit loaded
npm test -- --targeted test/brand-kit.test.mjs
```

To change the badge words, edit `labels.json` and run both scripts. To add an asset, add it in `build-kit.mjs` and give it a `guide.json` entry; the test refuses an asset with no ground or use, and refuses committed files that drift from a fresh build.

## Assets

### Lockup

| Code | Preview | File | Size | Ground | Use |
| --- | --- | --- | --- | --- | --- |
| L1 | <img src="svg/lockup-light.svg" width="120" alt="Lockup, inline, light"> | [`lockup-light`](svg/lockup-light.svg) · [png](png/lockup-light.png) | 480 × 88 | white or light surface | site and app header; document header; slide footer; email header (png) |
| L2 | <img src="svg/lockup-dark.svg" width="120" alt="Lockup, inline, dark"> | [`lockup-dark`](svg/lockup-dark.svg) · [png](png/lockup-dark.png) | 480 × 88 | ink or night surface | dark site and app header; dark slide footer; dark email header (png) |
| L3 | <img src="svg/lockup-stacked-light.svg" width="80" alt="Lockup, stacked, light"> | [`lockup-stacked-light`](svg/lockup-stacked-light.svg) · [png](png/lockup-stacked-light.png) | 240 × 143 | white or light surface | sign-in and splash screens; square covers and avatars; event signage |
| L4 | <img src="svg/lockup-stacked-dark.svg" width="80" alt="Lockup, stacked, dark"> | [`lockup-stacked-dark`](svg/lockup-stacked-dark.svg) · [png](png/lockup-stacked-dark.png) | 240 × 143 | ink or night surface | dark sign-in and splash screens; video end cards; dark covers |

Lockup PNGs are 3×. The lockups come from `../build-logos.mjs` (`lockupLayout()`); the kit places those files as they are.

### Badge

| Code | Preview | File | Size | Ground | Use |
| --- | --- | --- | --- | --- | --- |
| B5 | <img src="svg/badge-footer-light.svg" width="120" alt="Footer badge, light"> | [`badge-footer-light`](svg/badge-footer-light.svg) · [png](png/badge-footer-light.png) | 156 × 40 | white or light page | foot of public forms under Send (src/forms.js); foot of shared views |
| B5 | <img src="svg/badge-footer-dark.svg" width="120" alt="Footer badge, dark"> | [`badge-footer-dark`](svg/badge-footer-dark.svg) · [png](png/badge-footer-dark.png) | 156 × 40 | dark page | foot of public forms and shared views in dark mode |
| B3 | <img src="svg/badge-release.svg" width="120" alt="Release badge"> | [`badge-release`](svg/badge-release.svg) · [png](png/badge-release.png) | 140 × 140 | any; the badge carries its own ink disc | beside each version in release notes and GitHub Releases |
| B1 | <img src="svg/badge-blue.svg" width="120" alt="Blue"> | [`badge-blue`](svg/badge-blue.svg) · [png](png/badge-blue.png) | 240 × 240 | white, slate or any light surface | grunion.ai/weave hero; posters on light fields; social avatar; stickers |
| B2 | <img src="svg/badge-ink.svg" width="120" alt="Ink"> | [`badge-ink`](svg/badge-ink.svg) · [png](png/badge-ink.png) | 240 × 240 | brand blue #2563eb or photography | posters on brand blue (X1, X4); banners; merch on blue |
| B6 | <img src="svg/badge-cream.svg" width="120" alt="Cream"> | [`badge-cream`](svg/badge-cream.svg) · [png](png/badge-cream.png) | 240 × 240 | ink #0c1b33 or night #0f1115 | dark site sections; dark slides; dark email footers |
| B7 | <img src="svg/badge-mono-blue.svg" width="120" alt="One colour, blue"> | [`badge-mono-blue`](svg/badge-mono-blue.svg) · [png](png/badge-mono-blue.png) | 240 × 240 | white or uncoated paper | one-colour print; rubber stamp; embossing die |
| B8 | <img src="svg/badge-mono-ink.svg" width="120" alt="One colour, ink"> | [`badge-mono-ink`](svg/badge-mono-ink.svg) · [png](png/badge-mono-ink.png) | 240 × 240 | white or uncoated paper | invoices; letterhead; packing slips; single-ink print |
| B9 | <img src="svg/badge-mono-cream.svg" width="120" alt="One colour, cream"> | [`badge-mono-cream`](svg/badge-mono-cream.svg) · [png](png/badge-mono-cream.png) | 240 × 240 | dark photography or video | video end cards; photo overlays |
| B10 | <img src="svg/badge-mono-white.svg" width="120" alt="One colour, white"> | [`badge-mono-white`](svg/badge-mono-white.svg) · [png](png/badge-mono-white.png) | 240 × 240 | brand blue #2563eb | buttons and banners on blue; merch printed on blue stock |
| B11 | <img src="svg/badge-watermark.svg" width="120" alt="Watermark"> | [`badge-watermark`](svg/badge-watermark.svg) · [png](png/badge-watermark.png) | 240 × 240 | brand blue #2563eb | tonal background behind copy; certificate ground |
| B12 | <img src="svg/badge-small.svg" width="120" alt="Small"> | [`badge-small`](svg/badge-small.svg) · [png](png/badge-small.png) | 240 × 240 | white or light surface | favicon-size spots under 72px; avatars; chips; email signature at 48px |
| B13 | <img src="svg/badge-sticker.svg" width="120" alt="Die-cut sticker"> | [`badge-sticker`](svg/badge-sticker.svg) · [png](png/badge-sticker.png) | 260 × 260 | print, die-cut | 3 inch die-cut sticker; the cream ring is the die line |
| B17 | <img src="svg/badge-small-ink.svg" width="120" alt="Small, ink"> | [`badge-small-ink`](svg/badge-small-ink.svg) · [png](png/badge-small-ink.png) | 240 × 240 | dark surface | dark avatars; app chrome under 72px |
| B16 | <img src="svg/badge-lockup-stacked.svg" width="87" alt="Lockup, stacked"> | [`badge-lockup-stacked`](svg/badge-lockup-stacked.svg) · [png](png/badge-lockup-stacked.png) | 240 × 330 | white or light surface | narrow columns; book and report covers; event signage |
| B14 | <img src="svg/badge-lockup-light.svg" width="120" alt="Lockup, light"> | [`badge-lockup-light`](svg/badge-lockup-light.svg) · [png](png/badge-lockup-light.png) | 660 × 240 | white or light surface | email header; document cover; slide footer; web footer |
| B15 | <img src="svg/badge-lockup-dark.svg" width="120" alt="Lockup, dark"> | [`badge-lockup-dark`](svg/badge-lockup-dark.svg) · [png](png/badge-lockup-dark.png) | 660 × 240 | ink or night surface | dark email header; dark slide footer; dark web footer |

### Posters

| Code | Preview | File | Size | Ground | Use |
| --- | --- | --- | --- | --- | --- |
| X1 | <img src="svg/poster-og.svg" width="120" alt="Link preview, blue"> | [`poster-og`](svg/poster-og.svg) · [png](png/poster-og.png) | 1200 × 630 | self-contained | grunion.ai/weave og:image; link previews in Slack, iMessage, LinkedIn |
| X2 | <img src="svg/poster-og-ink.svg" width="120" alt="Link preview, ink"> | [`poster-og-ink`](svg/poster-og-ink.svg) · [png](png/poster-og-ink.png) | 1200 × 630 | self-contained | link preview on dark timelines |
| X3 | <img src="svg/poster-og-slate.svg" width="120" alt="Link preview, slate"> | [`poster-og-slate`](svg/poster-og-slate.svg) · [png](png/poster-og-slate.png) | 1200 × 630 | self-contained | link preview on light timelines |
| X4 | <img src="svg/poster-square.svg" width="120" alt="Square post, blue"> | [`poster-square`](svg/poster-square.svg) · [png](png/poster-square.png) | 1080 × 1080 | self-contained | Instagram and LinkedIn square posts |
| X5 | <img src="svg/poster-banner.svg" width="120" alt="Profile banner, ink"> | [`poster-banner`](svg/poster-banner.svg) · [png](png/poster-banner.png) | 1584 × 396 | self-contained | LinkedIn and X profile headers |
| X6 | <img src="svg/poster-og-contour.svg" width="120" alt="Link preview, contour field"> | [`poster-og-contour`](svg/poster-og-contour.svg) · [png](png/poster-og-contour.png) | 1200 × 630 | self-contained | primary link preview with the contour field; launch announcements |
| X6a | <img src="svg/poster-contour-light.svg" width="120" alt="X6, light"> | [`poster-contour-light`](svg/poster-contour-light.svg) · [png](png/poster-contour-light.png) | 1200 × 630 | self-contained | link preview, light; blog post header |
| X6b | <img src="svg/poster-contour-blue.svg" width="120" alt="X6, brand blue"> | [`poster-contour-blue`](svg/poster-contour-blue.svg) · [png](png/poster-contour-blue.png) | 1200 × 630 | self-contained | link preview, brand blue; event pages |
| X6c | <img src="svg/poster-contour-topo.svg" width="120" alt="X6, topography"> | [`poster-contour-topo`](svg/poster-contour-topo.svg) · [png](png/poster-contour-topo.png) | 1200 × 630 | self-contained | link preview, topographic field; changelog posts |
| X6d | <img src="svg/poster-contour-square.svg" width="120" alt="X6, square"> | [`poster-contour-square`](svg/poster-contour-square.svg) · [png](png/poster-contour-square.png) | 1080 × 1080 | self-contained | Instagram and LinkedIn square posts, contour field |
| X6e | <img src="svg/poster-contour-banner.svg" width="120" alt="X6, banner"> | [`poster-contour-banner`](svg/poster-contour-banner.svg) · [png](png/poster-contour-banner.png) | 1584 × 396 | self-contained | LinkedIn and X profile headers, contour field |
| X7b | <img src="svg/poster-story-contour.svg" width="68" alt="Story, contour field"> | [`poster-story-contour`](svg/poster-story-contour.svg) · [png](png/poster-story-contour.png) | 1080 × 1920 | self-contained | Instagram and LinkedIn stories |

### Patterns

| Code | Preview | File | Size | Ground | Use |
| --- | --- | --- | --- | --- | --- |
| M1 | <img src="svg/pattern-contour-light.svg" width="120" alt="Contour field"> | [`pattern-contour-light`](svg/pattern-contour-light.svg) · [png](png/pattern-contour-light.png) | 1200 × 800 | self-contained | site hero background; deck section break; half-letter print |
| M1 | <img src="svg/pattern-contour-dark.svg" width="120" alt="Contour field"> | [`pattern-contour-dark`](svg/pattern-contour-dark.svg) · [png](png/pattern-contour-dark.png) | 1200 × 800 | self-contained | dark site hero background; dark deck section break |
| M2 | <img src="svg/pattern-rope-light.svg" width="120" alt="Endless rope"> | [`pattern-rope-light`](svg/pattern-rope-light.svg) · [png](png/pattern-rope-light.png) | 1200 × 800 | self-contained | merch all-over print; packaging; deck background |
| M2 | <img src="svg/pattern-rope-dark.svg" width="120" alt="Endless rope"> | [`pattern-rope-dark`](svg/pattern-rope-dark.svg) · [png](png/pattern-rope-dark.png) | 1200 × 800 | self-contained | dark merch print; dark deck background |
| M1a | <img src="svg/pattern-contour-dense.svg" width="120" alt="Dense grid"> | [`pattern-contour-dense`](svg/pattern-contour-dense.svg) · [png](png/pattern-contour-dense.png) | 1200 × 800 | self-contained | fine texture behind copy; packaging |
| M1c | <img src="svg/pattern-contour-peaks.svg" width="120" alt="Hidden peaks"> | [`pattern-contour-peaks`](svg/pattern-contour-peaks.svg) · [png](png/pattern-contour-peaks.png) | 1200 × 800 | self-contained | single-mark hero with relief map; print poster |
| M1e | <img src="svg/pattern-contour-blue.svg" width="120" alt="On brand blue"> | [`pattern-contour-blue`](svg/pattern-contour-blue.svg) · [png](png/pattern-contour-blue.png) | 1200 × 800 | self-contained | brand blue hero background; event backdrops |
| M2d | <img src="svg/pattern-rope-twill.svg" width="120" alt="Twill"> | [`pattern-rope-twill`](svg/pattern-rope-twill.svg) · [png](png/pattern-rope-twill.png) | 1200 × 800 | self-contained | textile and merch print; tote bags |
| M2e | <img src="svg/pattern-rope-blue.svg" width="120" alt="On brand blue"> | [`pattern-rope-blue`](svg/pattern-rope-blue.svg) · [png](png/pattern-rope-blue.png) | 1200 × 800 | self-contained | brand blue merch print; event lanyards |
| M3c | <img src="svg/pattern-dots-vignette.svg" width="120" alt="Vignette"> | [`pattern-dots-vignette`](svg/pattern-dots-vignette.svg) · [png](png/pattern-dots-vignette.png) | 1200 × 800 | self-contained | brand blue background behind a centred mark; app splash; video intro |

### Icon

| Code | Preview | File | Size | Ground | Use |
| --- | --- | --- | --- | --- | --- |
| I6 | <img src="svg/icon-product.svg" width="120" alt="Product and engineering"> | [`icon-product`](svg/icon-product.svg) · [png](png/icon-product.png) | 48 × 48 | any | Product and engineering starter category (public/starter-core.js) |
