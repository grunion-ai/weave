#!/usr/bin/env node
// Renders the round-6 loader contact sheet from the live generators, so the
// decision page can never drift from build-logos.mjs.
// Usage: node brand/build-loader-sheet.mjs [out=brand/docs/round6-loaders.html]

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LOADERS, loaderSvg, PALETTE, weaveSvg } from "./build-logos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, "docs", "round6-loaders.html");
const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z");

const NOTES = {
  travel: ["Endless rope pulled leftward through a fading window; seamless because it travels exactly one weave period.",
    "Reads as: work streaming through. Never resolves — honest for unbounded waits.", "Best at 24–64px"],
  twist: ["Two flat strands lift, cross, and settle into the finished mark, hold, then fade and restart.",
    "Reads as: the logo assembling itself. The literal brief — parts twisting into place.", "Best at 32–96px"],
  spin: ["Amplitude runs a full cosine, so the rope turns on its long axis, passing edge-on and swapping sides.",
    "Reads as: a physical object rotating. Calmest of the four; survives tiny sizes.", "Best at 16–48px"],
  draw: ["Strands draw in left to right, the crossing locks in, then the rope unweaves the same way.",
    "Reads as: weaving, stitch by stitch. Most literal to the product name.", "Best at 32–96px"],
};
const REC = "twist";

// Each rendering needs its own element ids or the masks collide in one document.
let seq = 0;
const at = (variant, size, dark) => {
  const id = `${variant}${seq++}`;
  const [c1, c2] = dark ? [PALETTE.blue, PALETTE.sky] : [PALETTE.blue, PALETTE.ink];
  return `<span class="lo" style="width:${size}px;height:${size}px">` +
    loaderSvg(variant, { c1, c2, id }) + `</span>`;
};
const sizes = (variant, dark) => [16, 24, 32, 48, 64]
  .map(s => `<div class="szcell">${at(variant, s, dark)}<span>${s}</span></div>`).join("");

const card = variant => `
<section class="opt">
  <h3>${variant === REC ? "★ " : ""}${LOADERS[variant].label}</h3>
  <div class="stages">
    <div class="stage dark">${at(variant, 72, true)}<span class="cap">dark</span></div>
    <div class="stage light">${at(variant, 72, false)}<span class="cap">light</span></div>
  </div>
  <div class="szrow">${sizes(variant, true)}</div>
  <p class="why">${NOTES[variant][0]}</p>
  <p class="why muted">${NOTES[variant][1]}</p>
  <p class="tag">${NOTES[variant][2]}${variant === REC ? ' · <span class="star">recommended</span>' : ""}</p>
</section>`;

const ctx = variant => `
<div class="pane">
  <div class="panebar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
  <div class="panebody">${at(variant, 44, true)}<p>Loading workspace…</p></div>
  <p class="panetag">${variant}</p>
</div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="kind" content="design-review">
<meta name="generated-at" content="${stamp}">
<meta name="repo" content="weave">
<meta name="branch" content="main">
<title>weave — loader directions</title>
<style>
  :root{
    --fg:#e0dcd4; --muted:#b4b8c4; --faint:#7e8394; --line:#1a2d54;
    --bg:#0c1b33; --soft:#132444; --accent:#2563eb; --accent2:#60a5fa; --paper:#fafaf8;
    --mono: ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif;padding:0 24px 64px}
  .wrap{max-width:960px;margin:0 auto}
  header.plan-header{margin:24px 0 8px}
  .topbar{background:#060f1f;border:1px solid var(--line);border-radius:8px;padding:10px 16px;
    display:flex;align-items:baseline;gap:14px;font-family:var(--mono)}
  .kind{font-size:11px;letter-spacing:.12em;color:var(--accent2);border:1px solid var(--accent);
    border-radius:4px;padding:2px 8px;text-transform:uppercase}
  .topbar h1{font-size:16px;margin:0;font-weight:600}
  .topbar time{margin-left:auto;font-size:12px;color:var(--faint)}
  dl.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:2px 24px;margin:10px 0 0;
    font-family:var(--mono);font-size:12px;color:var(--muted)}
  dl.meta div{display:flex;gap:8px} dl.meta dt{color:var(--faint);margin:0} dl.meta dd{margin:0;color:var(--fg)}
  p.sub{color:var(--muted);font-size:14px;margin:14px 2px 10px;font-style:italic}
  h2{font-size:13px;font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase;
    color:var(--faint);margin:34px 2px 12px}
  table.summary{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 2px}
  table.summary th{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
    color:var(--faint);text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}
  table.summary td{padding:7px 10px;border-bottom:1px solid var(--line);color:var(--muted);vertical-align:top}
  table.summary td:first-child{color:var(--fg);white-space:nowrap;font-family:var(--mono)}
  table.summary td.rec{color:var(--accent2);font-family:var(--mono);white-space:nowrap}
  .optrow{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}
  .opt{background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:16px}
  .opt h3{margin:0 0 12px;font-size:13.5px;font-weight:600;color:var(--fg)}
  .stages{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .stage{position:relative;display:flex;align-items:center;justify-content:center;min-height:104px;
    border-radius:10px;border:1px solid var(--line)}
  .stage.dark{background:#0a1830} .stage.light{background:var(--paper);border-color:#dcdcd6}
  .stage .cap{position:absolute;left:8px;bottom:5px;font-family:var(--mono);font-size:10px;color:var(--faint)}
  .stage.light .cap{color:#9a9a94}
  .szrow{display:flex;align-items:flex-end;gap:14px;margin-top:12px;padding:10px 12px;
    background:#0a1830;border:1px solid var(--line);border-radius:10px}
  .szcell{display:flex;flex-direction:column;align-items:center;gap:5px}
  .szcell span{font-family:var(--mono);font-size:10px;color:var(--faint)}
  .lo{display:inline-block;line-height:0} .lo svg{width:100%;height:100%;display:block}
  .why{font-size:12.5px;color:var(--muted);line-height:1.45;margin:10px 0 0}
  .why.muted{color:var(--faint);margin-top:4px}
  .tag{margin:8px 0 0;font-family:var(--mono);font-size:11.5px;color:var(--accent2)}
  .tag .star{color:#e8b64c}
  .ctxrow{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
  .pane{background:#0a1830;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .panebar{display:flex;gap:5px;padding:8px 10px;border-bottom:1px solid var(--line);background:#060f1f}
  .dot{width:7px;height:7px;border-radius:50%;background:#1a2d54}
  .panebody{display:flex;flex-direction:column;align-items:center;gap:10px;padding:26px 10px 22px}
  .panebody p{margin:0;font-size:12px;color:var(--faint)}
  .panetag{margin:0;padding:6px 10px;border-top:1px solid var(--line);font-family:var(--mono);
    font-size:10.5px;color:var(--faint)}
  .staticrow{display:flex;align-items:center;gap:20px;padding:14px 16px;background:#0a1830;
    border:1px solid var(--line);border-radius:10px}
  .staticrow .lbl{font-family:var(--mono);font-size:11px;color:var(--faint)}
</style>
</head>
<body>
<div class="wrap">

<header class="plan-header">
  <div class="topbar">
    <span class="kind">design-review</span>
    <h1>weave — loader directions (round 6)</h1>
    <time>${stamp}</time>
  </div>
  <dl class="meta">
    <div><dt>Repo</dt><dd>grunion-ai/weave</dd></div>
    <div><dt>Branch</dt><dd>main</dd></div>
    <div><dt>Working dir</dt><dd>weave/brand</dd></div>
    <div><dt>Kind</dt><dd>design-review</dd></div>
    <div><dt>Source</dt><dd>build-logos.mjs</dd></div>
    <div><dt>Generated</dt><dd>${stamp}</dd></div>
  </dl>
</header>

<p class="sub">Four ways the h3 rope can twist into place. Every frame is the real mark — same
rope(), same masks, same palette — animated in SMIL, so a loader is one inline SVG with no JS.</p>

<h2>Summary</h2>
<table class="summary">
  <tr><th>Variant</th><th>Motion</th><th>Resolves?</th><th>Holds up at 16px</th><th>Verdict</th></tr>
  <tr><td>travel</td><td>Rope translates one weave period, looping seamlessly</td><td>No — infinite</td>
    <td>Yes</td><td class="rec">strong for long waits</td></tr>
  <tr><td>twist</td><td>Amplitude 0 → 4, hold, fade out</td><td>Yes — settles on the mark</td>
    <td>Marginal</td><td class="rec">★ recommended</td></tr>
  <tr><td>spin</td><td>Amplitude cosine 4 → −4 → 4 (edge-on at zero)</td><td>No — continuous</td>
    <td>Yes</td><td class="rec">calmest</td></tr>
  <tr><td>draw</td><td>Dash draw-on, crossing locks, unweaves</td><td>Yes, then undoes</td>
    <td>No</td><td class="rec">most literal</td></tr>
</table>

<h2>Directions</h2>
<div class="optrow">${Object.keys(LOADERS).map(card).join("")}</div>

<h2>In context — app pane, 44px</h2>
<div class="ctxrow">${Object.keys(LOADERS).map(ctx).join("")}</div>

<h2>Against the static mark</h2>
<div class="staticrow">
  <span class="lbl">static</span>
  <span class="lo" style="width:56px;height:56px">${weaveSvg({ c1: PALETTE.blue, c2: PALETTE.sky })}</span>
  ${Object.keys(LOADERS).map(v => `<span class="lbl">${v}</span>${at(v, 56, true)}`).join("")}
</div>

</div>
</body>
</html>
`;

writeFileSync(out, html);
console.log(`wrote ${out}`);
