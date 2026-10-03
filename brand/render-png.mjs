#!/usr/bin/env node
// Rasterize brand SVGs to PNG via headless Chromium (Playwright).
// ImageMagick's SVG delegate drops <mask> elements, so raster export goes
// through a real browser engine. Usage: node brand/render-png.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "assets");
const out = join(assets, "png");
mkdirSync(out, { recursive: true });

// [svg, png, width, height]
const JOBS = [
  ["weave-favicon.svg", "favicon-16.png", 16, 16],
  ["weave-favicon.svg", "favicon-32.png", 32, 32],
  ["weave-favicon.svg", "favicon-48.png", 48, 48],
  ["weave-app-icon.svg", "app-icon-512.png", 512, 512],
  ["weave-app-icon.svg", "app-icon-180.png", 180, 180],
  ["weave-mark-dark.svg", "mark-dark-256.png", 256, 256],
  ["weave-mark-mono-blue.svg", "mark-mono-blue-256.png", 256, 256],
  ["weave-lockup-dark.svg", "lockup-dark-512.png", 512, 116],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [svg, png, w, h] of JOBS) {
  const uri = "data:image/svg+xml;base64," +
    Buffer.from(readFileSync(join(assets, svg), "utf8")).toString("base64");
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<style>*{margin:0}html,body{background:transparent}img{display:block}</style>` +
    `<img src="${uri}" width="${w}" height="${h}">`);
  await page.screenshot({ path: join(out, png), omitBackground: true });
  console.log(`rendered ${png} (${w}x${h})`);
}

// Email lockups (Feature #216), at 2x the 104x24 the invite emails show.
// Drawn inline rather than in an <img>, because an <img> SVG cannot fetch the
// wordmark's web font. weave serves them itself, from public/brand/.
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
  await page.screenshot({ path: join(here, "..", "public", "brand", png), omitBackground: true });
  console.log(`rendered ${png} (208x48, Outfit)`);
}
await browser.close();
