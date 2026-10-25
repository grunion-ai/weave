#!/usr/bin/env node
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lockupLayout, LOCKUP_SIZES } from "./build-logos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "assets");
const out = join(assets, "png");
const served = join(here, "..", "public", "brand");
mkdirSync(out, { recursive: true });
const tall = (layout, w) => { const [, , vw, vh] = lockupLayout(layout).viewBox; return Math.round(w * vh / vw); };

const JOBS = [
  [join(served, "weave-favicon.svg"), join(out, "favicon-16.png"), 16, 16],
  [join(served, "weave-favicon.svg"), join(served, "favicon-32.png"), 32, 32],
  [join(served, "weave-favicon.svg"), join(out, "favicon-48.png"), 48, 48],
  [join(assets, "weave-app-icon.svg"), join(out, "app-icon-512.png"), 512, 512],
  [join(assets, "weave-app-icon.svg"), join(out, "app-icon-180.png"), 180, 180],
  [join(served, "weave-mark-dark.svg"), join(out, "mark-dark-256.png"), 256, 256],
  [join(assets, "weave-mark-mono-blue.svg"), join(out, "mark-mono-blue-256.png"), 256, 256],
  [join(assets, "weave-lockup-dark.svg"), join(out, "lockup-dark-512.png"), 512, tall("inline", 512)],
  [join(assets, "weave-lockup-stacked-dark.svg"), join(out, "lockup-stacked-dark-512.png"), 512, tall("stacked", 512)],
];

const browser = await chromium.launch();
for (const [svg, png, w, h] of JOBS) {
  const uri = "data:image/svg+xml;base64," +
    Buffer.from(readFileSync(svg, "utf8")).toString("base64");
  const shot = await browser.newPage({ viewport: { width: w, height: h } });
  await shot.setContent(
    `<style>*{margin:0}html,body{background:transparent}img{display:block}</style>` +
    `<img src="${uri}" width="${w}" height="${h}">`);
  await shot.locator("img").evaluate((img) => img.decode());
  await shot.screenshot({ path: png, omitBackground: true });
  await shot.close();
  console.log(`rendered ${png} (${w}x${h})`);
}
const page = await browser.newPage();

const EMAIL = [
  ["weave-lockup-email-light.svg", "email-lockup-light.png"],
  ["weave-lockup-email-dark.svg", "email-lockup-dark.png"],
];
const ew = LOCKUP_SIZES.email.width * LOCKUP_SIZES.emailScale, eh = LOCKUP_SIZES.email.height * LOCKUP_SIZES.emailScale;
for (const [svg, png] of EMAIL) {
  await page.setViewportSize({ width: ew, height: eh });
  await page.setContent(
    `<style>*{margin:0}html,body{background:transparent}svg{display:block;width:${ew}px;height:${eh}px}</style>` +
    readFileSync(join(assets, svg), "utf8"));
  await page.screenshot({ path: join(served, png), omitBackground: true });
  console.log(`rendered ${png} (${ew}x${eh})`);
}
await browser.close();
