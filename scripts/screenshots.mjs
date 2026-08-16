#!/usr/bin/env node
// Capture the README screenshots from a running weave server.
//
//   node bin/weave.js serve --port 4400 --data ./my-workspace.db   # in one shell
//   node scripts/screenshots.mjs --url http://127.0.0.1:4400       # in another
//
// Tables and entities are resolved by qualified name against /api/schema, so
// this runs against any workspace that has the tables named in SHOTS. Output
// lands in docs/screenshots/ at 2x for retina README rendering.
//
// Playwright is imported dynamically, below the export, so the unit test can
// load this module without it — weave itself stays dependency-free.
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const BASE = (arg("url", "http://127.0.0.1:4400")).replace(/\/$/, "");
const OUT = arg("out", join(repo, "docs", "screenshots"));
const WIDTH = Number(arg("width", 1440));
const HEIGHT = Number(arg("height", 900));

// [file, workspace prefix ("" = default), route resolver, caption]
const SHOTS = [
  ["table", "/w/weave", (s) => `#/table/${tableId(s, "Development/Feature")}`],
  ["board", "/w/weave", (s) => `#/table/${tableId(s, "Development/Feature")}`, "board"],
  ["document", "/w/weave", async (s, ws) =>
    `#/entity/${await entityId(ws, "Guide", "Quickstart")}`],
  // The seeded `uno` demo (scripts/seed.mjs) is the map subject — it has
  // relations in both directions plus an automation, which an empty
  // just-created workspace does not.
  ["map", "/w/uno", () => "#/map"],
  ["search", "/w/weave", (s) => `#/table/${tableId(s, "Development/Feature")}`, "search"],
];

/** Find a table's id in a /api/schema payload by "Space/Table" or bare name. */
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
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2,
  });

  for (const [file, ws, route, mode] of SHOTS) {
    const schema = await json(`${BASE}${ws}/api/schema`);
    const hash = await route(schema, ws);
    await page.goto(`${BASE}${ws}/${hash}`, { waitUntil: "networkidle" });

    if (mode === "board") {
      await page.getByRole("button", { name: "Board", exact: true }).click();
    }
    if (mode === "search") {
      await page.keyboard.press("Meta+K");
      await page.keyboard.type("document", { delay: 20 });
    }
    await page.waitForTimeout(500);

    const path = join(OUT, `${file}.png`);
    await page.screenshot({ path });
    console.log(`captured ${path}`);
  }

  await browser.close();
}
