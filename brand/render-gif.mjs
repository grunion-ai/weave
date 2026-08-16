#!/usr/bin/env node
// Rasterize the loader to animated GIF via headless Chromium + ImageMagick.
//
// Why a GIF at all: the SVG loader is the canonical asset everywhere it can be
// (app, docs, anywhere a browser renders it). GitHub's markdown pipeline serves
// images through a proxy that does not run SMIL, so a README hero has to be a
// real animation format. This keeps that GIF a build product of the same
// generator rather than a hand-made file that drifts.
//
// Two builds, because a GIF cannot be theme-aware: the README pairs them in a
// <picture> with prefers-color-scheme. Backgrounds match GitHub's own canvas
// so the frame reads as page, not as a card.
//
// Needs: playwright + ImageMagick (`magick`). Usage: node brand/render-gif.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loaderSvg, PALETTE, LOADER_CYCLE_MS } from "./build-logos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "assets", "png");
mkdirSync(out, { recursive: true });

const W = 240, H = 120, FRAMES = 25;
const delay = Math.round((LOADER_CYCLE_MS / FRAMES) / 10); // ImageMagick ticks = 1/100s

// [name, second strand, page background] — backgrounds are GitHub's canvas.
const BUILDS = [
  ["weave-loader-dark.gif", PALETTE.sky, "#0d1117"],
  ["weave-loader-light.gif", PALETTE.ink, "#ffffff"],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });

for (const [file, c2, bg] of BUILDS) {
  const dir = mkdtempSync(join(tmpdir(), "weave-gif-"));
  await page.setContent(
    `<style>html,body{margin:0;height:${H}px;background:${bg};display:flex;` +
    `align-items:center;justify-content:center}svg{width:88px;height:88px;display:block}</style>` +
    loaderSvg("draw", { c1: PALETTE.blue, c2, id: "g" }));
  for (let i = 0; i < FRAMES; i++) {
    // Drive the clock rather than sleeping: every frame is exact, and the last
    // frame lands one tick short of the loop point so the GIF cycles cleanly.
    await page.evaluate((t) => {
      const svg = document.querySelector("svg");
      svg.pauseAnimations();
      svg.setCurrentTime(t);
    }, (i / FRAMES) * (LOADER_CYCLE_MS / 1000));
    await page.screenshot({ path: join(dir, `f${String(i).padStart(2, "0")}.png`) });
  }
  execFileSync("magick", ["-delay", String(delay), "-loop", "0",
    join(dir, "f*.png"), "-layers", "Optimize", join(out, file)]);
  rmSync(dir, { recursive: true, force: true });
  console.log(`rendered ${file} (${W}x${H}, ${FRAMES} frames, ${LOADER_CYCLE_MS}ms loop)`);
}

await browser.close();
