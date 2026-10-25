#!/usr/bin/env node
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "png");
mkdirSync(out, { recursive: true });
const { assets } = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const scale = (a) => (a.family === "icon" ? 4 : a.family === "lockup" ? 3 : a.family === "badge" ? 2 : 1);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const a of assets) {
  const k = scale(a), w = a.width * k, h = a.height * k;
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@600&display=block">` +
    `<style>*{margin:0}html,body{background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>` +
    readFileSync(join(here, a.svg), "utf8"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const usesText = /<text/.test(readFileSync(join(here, a.svg), "utf8"));
  const outfit = await page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Outfit" && f.status === "loaded"));
  if (usesText && !outfit) throw new Error(`Outfit did not load, so ${a.png} would draw its type in a fallback face`);
  await page.screenshot({ path: join(here, a.png), omitBackground: true });
  console.log(`rendered ${a.png} (${w}x${h})`);
}
await browser.close();
