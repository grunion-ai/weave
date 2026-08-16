// Tests for the weave brand asset generator (brand/build-logos.mjs).
// Run: node --test brand/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rope, weaveSvg, VARIANTS, build } from "./build-logos.mjs";

test("rope(3,8) produces the selected h3 geometry", () => {
  const r = rope(3, 8);
  assert.equal(r.a, "M12,20 C16,20 16,28 20,28 C24,28 24,20 28,20 C32,20 32,28 36,28");
  assert.equal(r.b, "M12,28 C16,28 16,20 20,20 C24,20 24,28 28,28 C32,28 32,20 36,20");
  assert.deepEqual(r.overs, ["M22.7,26.3 Q24,24 25.3,21.7"]);
});

test("rope crossing count scales with n", () => {
  assert.equal(rope(5, 8).overs.length, 2); // A re-drawn over at odd crossings
  assert.equal(rope(7, 6).overs.length, 3);
});

test("weaveSvg uses transparent-safe masks, not painted gaps", () => {
  const svg = weaveSvg({ c1: "#2563eb", c2: "#60a5fa" });
  assert.equal((svg.match(/<mask /g) || []).length, 2);
  assert.ok(!svg.includes("#132444"), "no tile-colored gap strokes in standalone SVGs");
});

test("gap width is strand width + 2.5", () => {
  const svg = weaveSvg({ c1: "#2563eb", c2: "#2563eb", sw: 4.5 });
  assert.ok(svg.includes('stroke-width="4.5"'), "strand width honored");
  assert.ok(svg.includes('stroke-width="7"'), "mask gap = sw + 2.5");
});

test("variant manifest covers the decided asset set with unique filenames", () => {
  const files = VARIANTS.map(v => v.file);
  assert.equal(new Set(files).size, files.length);
  for (const f of [
    "weave-mark-dark.svg", "weave-mark-light.svg", "weave-mark-mono-blue.svg",
    "weave-mark-mono-cream.svg", "weave-mark-white.svg", "weave-favicon.svg",
    "weave-app-icon.svg", "weave-lockup-dark.svg", "weave-lockup-light.svg",
  ]) assert.ok(files.includes(f), `missing ${f}`);
});

test("favicon variant is thickened mono blue (decision 2B)", () => {
  const fav = VARIANTS.find(v => v.file === "weave-favicon.svg").svg;
  assert.ok(fav.includes('stroke-width="4.5"'));
  assert.ok(!fav.includes("#60a5fa"), "favicon is mono");
});

test("light-mode secondary strand is ink navy (decision 5B)", () => {
  const light = VARIANTS.find(v => v.file === "weave-mark-light.svg").svg;
  assert.ok(light.includes("#0c1b33"));
});

test("build() writes every variant as an svg file", () => {
  const dir = mkdtempSync(join(tmpdir(), "weave-brand-"));
  const written = build(dir);
  assert.equal(written.length, VARIANTS.length);
  const onDisk = readdirSync(dir).filter(f => f.endsWith(".svg"));
  assert.equal(onDisk.length, VARIANTS.length);
  for (const f of onDisk) {
    assert.ok(readFileSync(join(dir, f), "utf8").startsWith("<svg"), `${f} is svg`);
  }
});
