#!/usr/bin/env node
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const OUT = arg("out", join(repo, "docs", "screenshots"));
const WIDTH = Number(arg("width", 1440));
const HEIGHT = Number(arg("height", 900));
const PORT = Number(arg("port", 4418));
const BASE = `http://127.0.0.1:${PORT}`;
const PHONE = { width: 390, height: 844 };

const TASKS = [
  ["Write the onboarding guide", "Doing", "Private beta", 3, "Maya"],
  ["Set up the status page", "Done", "Private beta", 1, "Theo"],
  ["Draft the pricing page", "Review", "Public launch", 2, "Ana"],
  ["Open the waitlist form", "Done", "Private beta", 1, "Maya"],
  ["Record the product demo", "Doing", "Public launch", 2, "Theo"],
  ["Connect the agent over MCP", "Todo", "Public launch", 2, "Ana"],
  ["Import the customer list", "Review", "Private beta", 1, "Theo"],
  ["Plan the launch post", "Todo", "Public launch", 3, "Maya"],
  ["Invite the first ten teams", "Todo", "Private beta", 1, "Ana"],
  ["Set up nightly backups", "Done", "Private beta", 1, "Theo"],
];

export const DEMO_SPEC = {
  workspace: "launch",
  spaces: [{
    name: "Launch", icon: "lucide:rocket", tables: [
      { name: "Milestone", rows: [{ Name: "Private beta" }, { Name: "Public launch" }] },
      { name: "Person", rows: [{ Name: "Maya" }, { Name: "Theo" }, { Name: "Ana" }] },
      {
        name: "Task",
        fields: [
          { name: "Status", type: "select", options: [
            { name: "Todo", icon: "lucide:clock" },
            { name: "Doing", hue: "blue", icon: "lucide:play" },
            { name: "Review", hue: "amber", icon: "lucide:eye" },
            { name: "Done", hue: "green", icon: "lucide:square-check" },
          ] },
          { name: "Milestone", type: "relation", to: "Milestone", cardinality: "many-to-one" },
          { name: "Owner", type: "relation", to: "Person", cardinality: "many-to-one" },
          { name: "Estimate", type: "number" },
        ],
        fieldOrder: ["Name", "Status", "Owner", "Milestone", "Estimate"],
        hidden: ["Description"],
        rows: TASKS.map(([Name, Status, Milestone, Estimate, Owner]) => ({ Name, Status, Milestone, Estimate, Owner })),
      },
    ],
  }],
};

export const BOARD_VIEW = { layout: "board", groups: "side", group: "Status", fields: ["Name", "Owner", "Estimate"] };

export const SHOTS = [
  ["table", "", (s) => `#/table/${tableId(s, "Launch/Task")}`],
  ["document", "/w/weave", async (s, ws) =>
    `#/entity/${await entityId(ws, "Guide", "Quickstart")}`],
  ["map", "", () => "#/map"],
  ["search", "/w/weave", (s) => `#/table/${tableId(s, "Development/Feature")}`, "search"],
  ["dock", "/w/weave", (s) => `#/table/${tableId(s, "Development/Feature")}`, "dock"],
  ["board", "", async (s) => `#/table/${tableId(s, "Launch/Task")}/view/${await boardViewId()}`],
  ["phone", "", (s) => `#/table/${tableId(s, "Launch/Task")}`, "phone"],
];

export function tableId(schema, qualified) {
  for (const space of schema) {
    for (const table of space.tables ?? []) {
      if (table.qualified === qualified || table.name === qualified) return table.id;
    }
  }
  throw new Error(`no table ${qualified} in schema`);
}

const json = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

async function boardViewId() {
  const { views } = await json(`${BASE}/api/tables/Task/views`);
  return views.find((v) => v.name === "Board").id;
}

async function serveDemo() {
  const scratch = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "weave-shots-"));
  const db = join(scratch, "launch.db");
  const spec = join(scratch, "launch.json");
  writeFileSync(spec, JSON.stringify(DEMO_SPEC));
  const built = JSON.parse(execFileSync(process.execPath, [join(repo, "bin", "weave.js"), "build", spec, "--data", db], { stdio: ["ignore", "pipe", "ignore"] }).toString());
  if (!built.ok || built.errors.length || built.ignored.length) throw new Error(`build refused the demo spec: ${JSON.stringify(built)}`);
  if (await fetch(`${BASE}/api/schema`).then(() => true, () => false)) throw new Error(`port ${PORT} is taken; pass --port`);
  const app = join(scratch, "app");
  mkdirSync(app);
  execFileSync("sh", ["-c", `git -C "${repo}" archive HEAD | tar -x -C "${app}"`]);
  const server = spawn(process.execPath, [join(app, "bin", "weave.js"), "serve", "--port", String(PORT), "--data", db], { cwd: scratch, stdio: "ignore", env: { ...process.env, WEAVE_AUTO_UPDATE: "0", WEAVE_UPDATE_CHECK: "0" } });
  for (let i = 0; i < 600 && !(await fetch(`${BASE}/api/schema`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 100));
  await json(`${BASE}/api/tables/Task/views/Board`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(BOARD_VIEW) });
  return server;
}

async function entityId(ws, table, name) {
  const { items } = await json(`${BASE}${ws}/api/tables/${table}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ where: [["Name", "=", name]] }),
  });
  if (!items?.length) throw new Error(`no ${table} named ${name}`);
  return items[0].id;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import("playwright");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const desktop = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  });
  const phone = await browser.newPage({ viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const server = await serveDemo();

  try {
    for (const [file, ws, route, mode] of SHOTS) {
      const page = mode === "phone" ? phone : desktop;
      const base = `${BASE}${ws}`;
      const schema = await json(`${base}/api/schema`);
      const hash = await route(schema, ws);
      await page.goto(`${base}/${hash}`, { waitUntil: "networkidle" });

      if (mode === "search") {
        await page.keyboard.press("Meta+K");
        await page.keyboard.type("document", { delay: 20 });
      }
      if (mode === "dock") {
        await page.keyboard.press("Escape");
        await page.click("td.pid-cell a.open-link");
        await page.waitForSelector("#dock:not([hidden])");
      }
      if (mode !== "search" && mode !== "dock") await page.mouse.move(0, 0);
      await page.waitForTimeout(500);

      const path = join(OUT, `${file}.png`);
      await page.screenshot({ path });
      console.log(`captured ${path}`);
    }
  } finally {
    server.kill();
    await browser.close();
  }
}
