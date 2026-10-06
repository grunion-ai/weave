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
  assert.deepEqual(r.overs, ["M20,28 C24,28 24,20 28,20"]);
});

const pathPoints = d => {
  const pts = [], nums = s => s.trim().split(/[\s,]+/).map(Number);
  let cur;
  for (const [, cmd, args] of d.matchAll(/([MCQ])([^MCQ]*)/g)) {
    const v = nums(args);
    if (cmd === "M") { cur = v; pts.push(cur); continue; }
    const ctl = [cur];
    for (let i = 0; i < v.length; i += 2) ctl.push([v[i], v[i + 1]]);
    for (let s = 1; s <= 200; s++) {
      let q = ctl.map(p => p.slice()), t = s / 200;
      while (q.length > 1) q = q.slice(1).map((p, i) => [q[i][0] + (p[0] - q[i][0]) * t, q[i][1] + (p[1] - q[i][1]) * t]);
      pts.push(q[0]);
    }
    cur = ctl.at(-1);
  }
  return pts;
};
const nearest = (pts, [x, y]) => Math.min(...pts.map(([u, v]) => Math.hypot(u - x, v - y)));

test("the over-segment covers every part of strand A the halo cuts (Issue #571)", () => {
  for (const [label, n, sw] of [["mark", 3, 3.5], ["favicon", 3, 4.5], ["app icon", 3, 4], ["travel", 11, 3.5]]) {
    const r = rope(n, 8), x0 = 24 - (n * 8) / 2;
    const A = pathPoints(r.a), B = pathPoints(r.b), O = r.overs.flatMap(pathPoints);
    const atOver = ([x]) => Math.round((x - x0) / 8 - 0.5) % 2 === 1;
    let worst = 0;
    for (let i = 1; i < A.length; i++) {
      const [x0, y0] = A[i - 1], [x1, y1] = A[i], len = Math.hypot(x1 - x0, y1 - y0);
      if (!len) continue;
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (const off of [-sw / 2, -sw / 4, 0, sw / 4, sw / 2]) {
        const p = [x1 + nx * off, y1 + ny * off];
        if (!atOver(p) || nearest(B, p) >= (sw + 2.5) / 2) continue;
        worst = Math.max(worst, nearest(O, p) - sw / 2);
      }
    }
    assert.ok(worst < 0.05, `${label}: the cut leaves strand A uncovered by ${worst.toFixed(2)} units`);
  }
});

test("each over-segment is strand A's own odd segment, so it meets the strand with no step", () => {
  for (const amp of [4, 2.83, 1, 0, -2.83, -4]) {
    const r = rope(5, 8, amp);
    for (const o of r.overs) {
      const [, start, curve] = o.match(/^M(\S+) (C.+)$/);
      assert.ok(r.a.includes(`${start} ${curve}`), `amp ${amp}: ${o} lies on strand A`);
    }
  }
});

test("the inline marks in public/index.html carry the current over-segment", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const overs = [...html.matchAll(/<path d="(M[^"]+)" fill="none" stroke="#2563eb" stroke-width="3.5" stroke-linecap="round"\/>/g)].map(m => m[1]);
  assert.ok(overs.length >= 2, "both rail marks found");
  for (const o of overs) assert.equal(o, rope(3, 8).overs[0]);
});

test("rope crossing count scales with n", () => {
  assert.equal(rope(5, 8).overs.length, 2);
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

test("email lockups carry the invite emails' approved palettes (Feature #216)", () => {
  const light = VARIANTS.find(v => v.file === "weave-lockup-email-light.svg").svg;
  const dark = VARIANTS.find(v => v.file === "weave-lockup-email-dark.svg").svg;
  assert.ok(light.includes('stroke="#2563eb"') && light.includes('stroke="#0c1b33"') && light.includes('fill="#0c1b33">weave'));
  assert.ok(dark.includes('stroke="#3b82f6"') && dark.includes('stroke="#60a5fa"') && dark.includes('fill="#eef2f8">weave'));
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

test("build() writes every variant as an svg file, plus the app's loader fragment", () => {
  const dir = mkdtempSync(join(tmpdir(), "weave-brand-"));
  const written = build(dir);
  assert.equal(written.length, VARIANTS.length + 1);
  assert.ok(readFileSync(join(dir, "weave-loader-rope.html"), "utf8").startsWith("<style>"), "the fragment carries its CSS first");
  const onDisk = readdirSync(dir).filter(f => f.endsWith(".svg"));
  assert.equal(onDisk.length, VARIANTS.length);
  for (const f of onDisk) {
    assert.ok(readFileSync(join(dir, f), "utf8").startsWith("<svg"), `${f} is svg`);
  }
});

test("build() writes the served set straight into the served folder and the rest into assets (Issue #651)", () => {
  const assets = mkdtempSync(join(tmpdir(), "weave-brand-assets-"));
  const served = mkdtempSync(join(tmpdir(), "weave-brand-served-"));
  build(assets, served);
  assert.deepEqual(readdirSync(served).sort(),
    ["weave-favicon.svg", "weave-loader-rope.html", "weave-mark-dark.svg", "weave-mark-light.svg"]);
  const both = readdirSync(assets).filter(f => readdirSync(served).includes(f));
  assert.deepEqual(both, [], "no file is written to both folders");
  assert.equal(readdirSync(assets).length, VARIANTS.filter(v => !v.served).length);
});

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
  const period = 2 * 8;
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
  const body = svg.slice(svg.indexOf("</defs>"));
  assert.ok(body.indexOf("#60a5fa") < body.indexOf("#2563eb"), "B draws first, A over it");
});

test("morph loaders close the gap and hide the crossing as the rope flattens", () => {
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

test("morph loaders fade the over-segment's cut in strand B as well as narrowing it", () => {
  for (const name of ["twist", "spin"]) {
    const svg = loaderSvg(name);
    const mask = svg.match(/<mask id="\w+B"[\s\S]*?<\/mask>/)[0];
    const ds = mask.match(/attributeName="d" values="([^"]+)"/)[1].split(";");
    const w = mask.match(/attributeName="stroke-width" values="([^"]+)"/)[1].split(";");
    const op = mask.match(/attributeName="stroke-opacity" values="([^"]+)"/);
    assert.ok(op, `${name}: the over cut fades`);
    const o = op[1].split(";"), flat = ds.findIndex(d => /^M20,24 /.test(d));
    assert.ok(flat >= 0, `${name}: passes through a flat frame`);
    assert.equal(o[flat], "0", `${name}: no cut at the flat frame`);
    assert.equal(w[flat], "0");
    assert.equal(Math.max(...o.map(Number)), 1, `${name}: full cut once the rope is open`);
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
