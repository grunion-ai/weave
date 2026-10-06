#!/usr/bin/env node
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "assets");
const out = join(assets, "png");
const served = join(here, "..", "public", "brand");
mkdirSync(out, { recursive: true });

const JOBS = [
  [join(served, "weave-favicon.svg"), join(out, "favicon-16.png"), 16, 16],
  [join(served, "weave-favicon.svg"), join(served, "favicon-32.png"), 32, 32],
  [join(served, "weave-favicon.svg"), join(out, "favicon-48.png"), 48, 48],
  [join(assets, "weave-app-icon.svg"), join(out, "app-icon-512.png"), 512, 512],
  [join(assets, "weave-app-icon.svg"), join(out, "app-icon-180.png"), 180, 180],
  [join(served, "weave-mark-dark.svg"), join(out, "mark-dark-256.png"), 256, 256],
  [join(assets, "weave-mark-mono-blue.svg"), join(out, "mark-mono-blue-256.png"), 256, 256],
  [join(assets, "weave-lockup-dark.svg"), join(out, "lockup-dark-512.png"), 512, 116],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [svg, png, w, h] of JOBS) {
  const uri = "data:image/svg+xml;base64," +
    Buffer.from(readFileSync(svg, "utf8")).toString("base64");
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<style>*{margin:0}html,body{background:transparent}img{display:block}</style>` +
    `<img src="${uri}" width="${w}" height="${h}">`);
  await page.screenshot({ path: png, omitBackground: true });
  console.log(`rendered ${png} (${w}x${h})`);
}

const EMAIL = [
  ["weave-lockup-email-light.svg", "email-lockup-light.png"],
  ["weave-lockup-email-dark.svg", "email-lockup-dark.png"],
];
for (const [svg, png] of EMAIL) {
  await page.setViewportSize({ width: 208, height: 48 });
  await page.setContent(
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@600&display=block">` +
    `<style>*{margin:0}html,body{background:transparent}svg{display:block;width:208px;height:48px}</style>` +
    readFileSync(join(assets, svg), "utf8"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const outfit = await page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Outfit" && f.status === "loaded"));
  if (!outfit) throw new Error(`Outfit did not load, so ${png} would draw the wordmark in a fallback face`);
  await page.screenshot({ path: join(served, png), omitBackground: true });
  console.log(`rendered ${png} (208x48, Outfit)`);
}
await browser.close();
