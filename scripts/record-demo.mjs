#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const cli = join(repo, "bin", "weave.js");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const PORT = Number(arg("port", 4417));
const OUT = arg("out", join(repo, "docs"));
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const W = 1200, H = 675, FPS = 10;
const BASE = `http://127.0.0.1:${PORT}`;

export const SPEC = {
  workspace: "launch",
  spaces: [{
    name: "Launch", icon: "lucide:rocket", tables: [
      { name: "Milestone", rows: [{ Name: "Private beta" }, { Name: "Public launch" }] },
      {
        name: "Task",
        fields: [
          { name: "Status", type: "select", options: [
            { name: "Todo", icon: "lucide:clock" },
            { name: "Doing", hue: "blue", icon: "lucide:play" },
            { name: "Done", hue: "green", icon: "lucide:square-check" },
          ] },
          { name: "Milestone", type: "relation", to: "Milestone", cardinality: "many-to-one" },
          { name: "Estimate", type: "number" },
        ],
        fieldOrder: ["Name", "Status", "Milestone", "Estimate"],
      },
    ],
  }],
};

export const ROWS = [
  { Name: "Write the onboarding guide", Status: "Doing", Milestone: "Private beta", Estimate: 3,
    doc: "# Onboarding guide\n\nThe first ten minutes for a new team, from sign-in to a first shared table.\n\n## Steps\n\n- [x] Sign in and create a workspace\n- [x] Build a table from a spec\n- [ ] Invite a teammate\n- [ ] Connect an agent over MCP\n\n## Open questions\n\nShould the guide start with the CLI or the web app?" },
  { Name: "Set up the status page", Status: "Done", Milestone: "Private beta", Estimate: 1 },
  { Name: "Draft the pricing page", Status: "Doing", Milestone: "Public launch", Estimate: 2 },
  { Name: "Open the waitlist form", Status: "Done", Milestone: "Private beta", Estimate: 1 },
  { Name: "Record the walkthrough video", Status: "Todo", Milestone: "Public launch", Estimate: 2 },
  { Name: "Plan the launch email", Status: "Todo", Milestone: "Public launch", Estimate: 1 },
];

export const QUERY = { db: "Task", where: [["Status", "=", "Doing"]], select: ["Name", "Milestone.Name", "Estimate"] };

const TERMINAL = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#eceff3}
.win{position:absolute;inset:28px 40px;border-radius:12px;background:#0f1115;box-shadow:0 10px 40px rgba(15,17,21,.25);overflow:hidden}
.bar{height:36px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#181b21;color:#9aa3b2;font:500 13px -apple-system,system-ui,sans-serif}
.dot{width:12px;height:12px;border-radius:50%;background:#3a3f4b}
.title{margin-left:12px}
pre{margin:0;padding:20px 24px;color:#e6e8ee;font:20px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.p{color:#7cc4a4}.c{color:#8b93a3}.k{color:#9ec3ff}
</style><div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="title"></span></div><pre></pre></div>`;

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

function mcpQuery(db) {
  const lines = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "record-demo", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "weave_query", arguments: QUERY } },
  ].map((m) => JSON.stringify(m)).join("\n") + "\n";
  const out = execFileSync(process.execPath, [cli, "mcp", "--data", db], { input: lines, stdio: ["pipe", "pipe", "ignore"] }).toString();
  const reply = out.trim().split("\n").map((l) => JSON.parse(l)).find((m) => m.id === 2);
  if (reply.result?.isError) throw new Error(reply.result.content[0].text);
  return reply.result.content.map((c) => c.text).join("\n");
}

async function waitFor(url) {
  for (let i = 0; i < 1200; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no answer from ${url}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import("playwright");
  const scratch = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "weave-demo-"));
  const frames = join(scratch, "frames");
  mkdirSync(frames);
  mkdirSync(OUT, { recursive: true });
  const db = join(scratch, "launch.db");
  const specFile = join(scratch, "launch.json");
  writeFileSync(specFile, JSON.stringify(SPEC, null, 2));
  const built = execFileSync(process.execPath, [cli, "build", specFile, "--data", db], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  const build = JSON.parse(built);
  if (!build.ok || build.errors.length || build.ignored.length) throw new Error(`build refused the spec: ${built}`);

  if (await fetch(`${BASE}/api/schema`).then(() => true, () => false)) throw new Error(`port ${PORT} is taken; pass --port`);
  const app = join(scratch, "app");
  mkdirSync(app);
  execFileSync("sh", ["-c", `git -C "${repo}" archive HEAD | tar -x -C "${app}"`]);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const server = spawn(process.execPath, [join(app, "bin", "weave.js"), "serve", "--port", String(PORT), "--data", db], { cwd: scratch, stdio: "ignore", env: { ...process.env, WEAVE_AUTO_UPDATE: "0", WEAVE_UPDATE_CHECK: "0" } });
  let n = 0;
  try {
    await waitFor(`${BASE}/api/schema`);
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const shot = () => page.screenshot({ path: join(frames, `f${String(n++).padStart(4, "0")}.png`) });
    const hold = async (s) => { for (let i = 0; i < Math.round(s * FPS); i++) { await page.waitForTimeout(1000 / FPS); await shot(); } };

    await page.setContent(TERMINAL);
    const term = (title) => page.evaluate((t) => { document.querySelector(".title").textContent = t; document.querySelector("pre").innerHTML = ""; }, title);
    const put = (html) => page.evaluate((h) => { document.querySelector("pre").insertAdjacentHTML("beforeend", h); }, html);
    const type = async (text, per = 6) => {
      await put('<span class="p">$ </span>');
      for (let i = 0; i < text.length; i += per) { await put(esc(text.slice(i, i + per))); await shot(); }
      await put("\n");
    };

    await term("Terminal: weave build");
    await hold(0.3);
    await type("weave build launch.json --data launch.db");
    await hold(0.3);
    const c = build.created;
    await put(`<span class="c">ok</span>  created <span class="k">${c.spaces}</span> space, <span class="k">${c.tables}</span> tables, <span class="k">${c.fields}</span> fields, <span class="k">${c.relations}</span> relation, <span class="k">${c.rows}</span> rows\n`);
    await hold(1.4);

    const schema = await (await fetch(`${BASE}/api/schema`)).json();
    const task = schema.flatMap((s) => s.tables ?? []).find((t) => t.name === "Task");
    await page.goto(`${BASE}/#/table/${task.id}`, { waitUntil: "networkidle" });
    await page.mouse.move(W - 4, H - 4);
    await hold(0.4);
    for (const row of ROWS) {
      const { doc, ...values } = row;
      const res = await fetch(`${BASE}/api/tables/Task/entities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(doc ? { values, doc } : { values }) });
      if (!res.ok) throw new Error(`row ${row.Name}: ${res.status} ${await res.text()}`);
      await page.reload({ waitUntil: "networkidle" });
      await page.locator("td", { hasText: row.Name }).first().waitFor();
      await hold(0.3);
    }
    await hold(0.6);

    const open = page.locator("tr", { hasText: ROWS[0].Name }).locator("a.open-link").first();
    await open.hover();
    await hold(0.3);
    await open.click();
    await page.locator("#dock", { hasText: "Open questions" }).waitFor();
    await hold(0.5);
    const poster = n;
    await hold(3.0);

    const rows = mcpQuery(db);
    await page.setContent(TERMINAL);
    await term("Terminal: weave mcp");
    await hold(0.2);
    await type("weave mcp --data launch.db", 8);
    await put(`<span class="c">→ tools/call</span> <span class="k">weave_query</span> ${esc(JSON.stringify(QUERY).replace(/,(?=["[{])/g, ", "))}\n`);
    await hold(0.6);
    const { items } = JSON.parse(rows.replace(/^<weave_data[^>]*>|<\/weave_data>$/g, ""));
    await put(`<span class="c">← ${items.length} rows</span>\n`);
    for (const r of items) {
      await put(`  <span class="k">#${r.publicId}</span>  ${esc(r.Name.padEnd(28))}${esc(r["Milestone.Name"].padEnd(15))}${r.Estimate}\n`);
      await hold(0.3);
    }
    await hold(3.4);

    await page.close();
    execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", join(frames, `f${String(poster).padStart(4, "0")}.png`), join(OUT, "demo-poster.png")]);
  } finally {
    await browser.close();
    server.kill();
  }
  execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "f%04d.png"),
    "-vf", "split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
    "-loop", "0", join(OUT, "demo.gif")]);
  rmSync(scratch, { recursive: true, force: true });
  console.log(`wrote ${join(OUT, "demo.gif")} (${n} frames at ${FPS} fps = ${(n / FPS).toFixed(1)} s) and ${join(OUT, "demo-poster.png")}`);
}
