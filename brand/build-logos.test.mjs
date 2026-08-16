// Tests for the weave brand asset generator (brand/build-logos.mjs).
// Run: node --test brand/
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rope, weaveSvg, VARIANTS, build, LOADERS, loaderSvg, LOADER_CYCLE_MS } from "./build-logos.mjs";

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

// --- loaders (round 6) ------------------------------------------------------

test("rope amplitude is morph-safe: every amp emits identical path commands", () => {
  const shape = d => d.replace(/-?[\d.]+/g, "#");
  const flat = rope(3, 8, 0), full = rope(3, 8, 4), inv = rope(3, 8, -4);
  assert.equal(shape(flat.a), shape(full.a));
  assert.equal(shape(inv.b), shape(full.b));
  assert.equal(flat.overs.length, full.overs.length);
  assert.ok(/^M12,24 /.test(flat.a), "amp 0 puts both strands on the centerline");
  assert.equal(inv.a, full.b, "negative amp swaps the strands");
});

test("every loader variant is a standalone, indefinitely looping SVG", () => {
  for (const [name, { fn, label }] of Object.entries(LOADERS)) {
    const svg = loaderSvg(name);
    assert.equal(typeof fn, "function");
    assert.ok(label.length > 10, `${name} has a descriptive label`);
    assert.ok(svg.startsWith("<svg xmlns="), `${name} is standalone`);
    assert.ok(svg.endsWith("</svg>"), `${name} is closed`);
    assert.ok(svg.includes('repeatCount="indefinite"'), `${name} loops`);
    assert.ok(svg.includes('aria-label="Loading"'), `${name} is announced`);
    assert.ok(!svg.includes("#132444"), `${name} paints no background gaps`);
    assert.ok((svg.match(/<mask /g) || []).length >= 2, `${name} keeps the weave masks`);
  }
});

test("loaderSvg rejects an unknown variant", () => {
  assert.throws(() => loaderSvg("nope"), /unknown loader variant/);
});

test("loader ids are namespaced so two loaders can share a document", () => {
  const ids = s => (s.match(/id="([^"]+)"/g) || []);
  const both = new Set([...ids(loaderSvg("twist")), ...ids(loaderSvg("spin"))]);
  assert.equal(both.size, ids(loaderSvg("twist")).length + ids(loaderSvg("spin")).length);
});

test("keyframe lists are well-formed: values match keyTimes, 0 → 1", () => {
  for (const name of Object.keys(LOADERS)) {
    for (const el of loaderSvg(name).match(/<animate [^>]+\/>/g) || []) {
      const kt = el.match(/keyTimes="([^"]+)"/);
      if (!kt) continue;
      const times = kt[1].split(";"), values = el.match(/values="([^"]+)"/)[1].split(";");
      assert.equal(values.length, times.length, `${name}: ${el.slice(0, 60)}`);
      assert.equal(times[0], "0", `${name}: keyTimes start at 0`);
      assert.equal(times.at(-1), "1", `${name}: keyTimes end at 1`);
      const splines = el.match(/keySplines="([^"]+)"/);
      if (splines) assert.equal(splines[1].split(";").length, times.length - 1);
    }
  }
});

test("morph loaders keep the mask registered with the strand that cuts it", () => {
  // The under-strand mask must carry the SAME d keyframes as strand B, or the
  // gap drifts off the crossing mid-animation.
  for (const name of ["twist", "spin"]) {
    const svg = loaderSvg(name);
    const mask = svg.match(/<mask id="\w+A"[\s\S]*?<\/mask>/)[0];
    const maskVals = mask.match(/values="([^"]+)"/)[1];
    const strandB = svg.slice(svg.indexOf("</defs>")).match(/<path[^>]*B\)"[\s\S]*?<\/path>/)[0];
    assert.equal(strandB.match(/values="([^"]+)"/)[1], maskVals, `${name} mask tracks strand B`);
  }
});

test("travel loader translates exactly one weave period and overhangs the frame", () => {
  const svg = loaderSvg("travel");
  const period = 2 * 8; // 2 x pitch — anything else seams on repeat
  assert.ok(svg.includes(`values="0 0;-${period} 0"`), "seamless period translate");
  const xs = [...svg.matchAll(/M(-?[\d.]+),/g)].map(m => +m[1]);
  assert.ok(Math.min(...xs) <= -period, "rope starts left of the frame by a full period");
  assert.ok(svg.includes("linearGradient"), "edges fade instead of cutting hard");
});

test("weave-on loader is two strands drawing in lockstep, no third element", () => {
  const svg = loaderSvg("draw");
  const body = svg.slice(svg.indexOf("</defs>"));
  assert.equal((body.match(/<path /g) || []).length, 2, "no separate crossing path to time");
  assert.equal((svg.match(/pathLength="100"/g) || []).length, 2, "both strands draw at one rate");
  assert.equal((svg.match(/stroke-dashoffset/g) || []).length, 2);
  assert.ok(!body.includes("opacity"), "nothing fades in late — that is what left a hole");
  assert.ok(svg.includes('values="104;0;0;-104"'), "draws on, holds, unweaves");
  const [on, off] = svg.match(/stroke-dasharray="(\d+) (\d+)"/).slice(1).map(Number);
  assert.ok(on + off > 104 + 100, "pattern never wraps inside the path (no stray cap dots)");
  assert.ok(!/<mask[\s\S]*?stroke-dashoffset[\s\S]*?<\/mask>/.test(svg), "the cut is static, not drawn");
});

test("weave-on keeps the crossing by restoring it inside mask A", () => {
  const svg = loaderSvg("draw");
  const maskA = svg.match(/<mask id="\w+A"[\s\S]*?<\/mask>/)[0];
  const strokes = [...maskA.matchAll(/stroke="(#\w+)"/g)].map(m => m[1]);
  assert.deepEqual(strokes, ["#000", "#fff"], "cut the under-strand, then paint the crossing back");
  // Strand A carries the crossing, so it must paint after B.
  const body = svg.slice(svg.indexOf("</defs>"));
  assert.ok(body.indexOf("#60a5fa") < body.indexOf("#2563eb"), "B draws first, A over it");
});

test("morph loaders close the gap and hide the crossing as the rope flattens", () => {
  // At amp 0 both strands coincide: a full-width cut would eat the line and
  // leave the over-segment floating in the hole.
  for (const name of ["twist", "spin"]) {
    const svg = loaderSvg(name);
    const mask = svg.match(/<mask id="\w+A"[\s\S]*?<\/mask>/)[0];
    const w = mask.match(/attributeName="stroke-width" values="([^"]+)"/);
    assert.ok(w, `${name}: mask width tracks amplitude`);
    const widths = w[1].split(";"), ds = mask.match(/attributeName="d" values="([^"]+)"/)[1].split(";");
    const flat = ds.findIndex(d => /^M12,24 /.test(d));
    assert.ok(flat >= 0, `${name}: passes through a flat frame`);
    assert.equal(widths[flat], "0", `${name}: gap closed at the flat frame`);
    assert.equal(Math.max(...widths.map(Number)), 6, "gap reaches full width elsewhere");
    const over = svg.slice(svg.indexOf("</defs>")).match(/attributeName="opacity" values="([^"]+)"/)[1];
    assert.equal(over.split(";")[flat], "0", `${name}: crossing hidden at the flat frame`);
  }
});

test("the shipped loaders are the weave-on pair, matching the marks' strands", () => {
  const files = VARIANTS.map(v => v.file);
  for (const f of ["weave-loader-dark.svg", "weave-loader-light.svg"]) assert.ok(files.includes(f), `missing ${f}`);
  const dark = VARIANTS.find(v => v.file === "weave-loader-dark.svg").svg;
  const light = VARIANTS.find(v => v.file === "weave-loader-light.svg").svg;
  assert.ok(dark.includes("#60a5fa"), "dark pairs blue + sky, like weave-mark-dark");
  assert.ok(light.includes("#0c1b33"), "light pairs blue + ink, like weave-mark-light (decision 5B)");
  for (const svg of [dark, light]) {
    assert.ok(svg.includes('stroke-dashoffset'), "weave-on, not one of the morph variants");
    assert.ok(svg.includes(`dur="${LOADER_CYCLE_MS / 1000}s"`), "runs at the published cycle");
  }
  assert.notEqual(dark.match(/id="(\w+)A"/)[1], light.match(/id="(\w+)A"/)[1],
    "distinct mask ids so both can be inlined in one document");
});
