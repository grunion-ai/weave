import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RADIATE, SIZES, STAGE, rings, radiateSvg, build, buildStage } from "../brand/build-radiate.mjs";
import { tempDir } from './lib/temp.mjs';

const { width, height, pitch } = RADIATE;
const cx = width / 2, cy = height / 2;
const all = rings();

const crossingsAt = (x, keep) => {
  const ys = [];
  for (const line of all) {
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1], [x1, y1] = line[i];
      if ((x0 - x) * (x1 - x) > 0 || x0 === x1) continue;
      const y = y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      if (keep(y)) ys.push(y);
    }
  }
  return ys.sort((a, b) => a - b);
};

test("the half page is US Letter halved, landscape, at 96 px per inch", () => {
  assert.equal(width, 816);
  assert.equal(height, 528);
  for (const theme of ["dark", "light"]) {
    assert.match(radiateSvg(theme), new RegExp(`viewBox="0 0 ${width} ${height}"`));
  }
});

test("rings above the mark sit one pitch apart", () => {
  const ys = crossingsAt(cx, y => y < cy - 90);
  assert.ok(ys.length >= 8, `only ${ys.length} rings cross above the mark`);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(Math.abs(ys[i] - ys[i - 1] - pitch) < pitch * 0.08,
      `ring gap ${(ys[i] - ys[i - 1]).toFixed(2)} at y=${ys[i].toFixed(1)}, pitch ${pitch}`);
  }
});

test("rings beside the mark sit one pitch apart", () => {
  const xs = [];
  for (const line of all) {
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1], [x1, y1] = line[i];
      if ((y0 - cy) * (y1 - cy) > 0 || y0 === y1) continue;
      const x = x0 + (x1 - x0) * (cy - y0) / (y1 - y0);
      if (x > cx + 200) xs.push(x);
    }
  }
  xs.sort((a, b) => a - b);
  assert.ok(xs.length >= 6);
  for (let i = 1; i < xs.length; i++) {
    assert.ok(Math.abs(xs[i] - xs[i - 1] - pitch) < pitch * 0.12, `gap ${(xs[i] - xs[i - 1]).toFixed(2)}`);
  }
});

test("every ring turns smoothly, with no cusp or kink", () => {
  let worst = 0;
  for (const line of all) {
    const pts = [line[0]];
    for (const p of line) {
      const q = pts.at(-1);
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= 6) pts.push(p);
    }
    for (let i = 2; i < pts.length; i++) {
      const a = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
      const b = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      let turn = Math.abs(b - a);
      if (turn > Math.PI) turn = 2 * Math.PI - turn;
      worst = Math.max(worst, turn * 180 / Math.PI);
    }
  }
  assert.ok(worst < 25, `sharpest turn ${worst.toFixed(1)} degrees over 6 px`);
});

test("rings fill the page to every edge", () => {
  assert.ok(crossingsAt(cx, y => y < 2 * pitch).length > 0, "no ring reaches the top edge");
  assert.ok(crossingsAt(cx, y => y > height - 2 * pitch).length > 0, "no ring reaches the bottom edge");
  assert.ok(crossingsAt(pitch, () => true).length > 0, "no ring reaches the left edge");
});

test("dark sits on the slate canvas with blue and sky strands; light on white with blue and ink", () => {
  const dark = radiateSvg("dark"), light = radiateSvg("light");
  assert.match(dark, /fill="#0f1115"/);
  assert.match(dark, /stroke="#2563eb"/);
  assert.match(dark, /stroke="#60a5fa"/);
  assert.match(light, /fill="#ffffff"/);
  assert.match(light, /stroke="#0c1b33"/);
  assert.doesNotMatch(light, /stroke="#60a5fa"/);
});

test("build writes the dark and light half-page SVGs", () => {
  const dir = tempDir("radiate-");
  build(dir);
  assert.deepEqual(readdirSync(dir).sort(),
    ["weave-radiate-half-letter-dark.svg", "weave-radiate-half-letter-light.svg"]);
  assert.ok(readFileSync(join(dir, "weave-radiate-half-letter-dark.svg"), "utf8").length < 600_000);
});

test("the SVG draws every ring the field produces, closed rings included", () => {
  const drawn = [...radiateSvg("dark").matchAll(/<path d="M([^"]+)"\/>/g)]
    .map(m => m[1].split("L").map(p => p.split(" ").map(Number)));
  const crossings = lines => {
    let n = 0;
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1], [x1, y1] = line[i];
      if ((x0 - cx) * (x1 - cx) <= 0 && x0 !== x1 && y0 + (y1 - y0) * (cx - x0) / (x1 - x0) > 0) n++;
    }
    return n;
  };
  assert.equal(crossings(drawn), crossings(all));
  assert.equal(drawn.length, all.length);
  all.forEach((line, i) => {
    if (line.length > 12) assert.ok(drawn[i].length > 3, `ring ${i} collapsed to ${drawn[i].length} points`);
  });
});

const stage = STAGE.size;
const stageRings = rings(stage);
const stageCrossings = (x, keep) => {
  const ys = [];
  for (const line of stageRings) for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i];
    if ((x0 - x) * (x1 - x) > 0 || x0 === x1) continue;
    const y = y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    if (keep(y)) ys.push(y);
  }
  return ys;
};
const markBox = svg => {
  const [, tx, ty, k] = svg.match(/<g transform="translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)">/).map(Number);
  return { k, cx: tx + 24 * k, cy: ty + 24 * k };
};

test("the sign-in stage art is a 3840 x 2160 canvas", () => {
  assert.deepEqual(stage, { width: 3840, height: 2160 });
  for (const theme of ["dark", "light"]) {
    assert.match(radiateSvg(theme, stage), /viewBox="0 0 3840 2160" width="3840" height="2160"/);
  }
});

test("the stage art keeps the mark at the half-page size, centred", () => {
  const half = markBox(radiateSvg("light")), big = markBox(radiateSvg("light", stage));
  assert.equal(big.k, half.k);
  assert.equal(big.cx, stage.width / 2);
  assert.equal(big.cy, stage.height / 2);
});

test("stage rings reach all four edges of the 4k canvas", () => {
  const { width: w, height: h } = stage, p = RADIATE.pitch;
  assert.ok(stageCrossings(w / 2, y => y < 2 * p).length > 0, "top");
  assert.ok(stageCrossings(w / 2, y => y > h - 2 * p).length > 0, "bottom");
  assert.ok(stageCrossings(p, () => true).length > 0, "left");
  assert.ok(stageCrossings(w - p, () => true).length > 0, "right");
});

test("stage rings keep the half-page pitch out to the corners", () => {
  const ys = stageCrossings(stage.width / 2 + 0.37, y => y > 2 * RADIATE.pitch && y < stage.height / 2 - 400).sort((a, b) => a - b);
  assert.ok(ys.length >= 38, `only ${ys.length} rings above the mark`);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(Math.abs(ys[i] - ys[i - 1] - RADIATE.pitch) < RADIATE.pitch * 0.08, `gap ${(ys[i] - ys[i - 1]).toFixed(2)} at y=${ys[i].toFixed(1)}`);
  }
});

test("buildStage writes the setup page copies, and public/brand matches the generator", () => {
  const dir = tempDir("radiate-stage-");
  buildStage(dir);
  assert.deepEqual(readdirSync(dir).sort(), ["weave-radiate-dark.svg", "weave-radiate-light.svg"]);
  for (const [theme, file] of Object.entries(STAGE.files)) {
    const svg = readFileSync(join(dir, file), "utf8");
    assert.ok(svg.length < 600_000, `${file} is ${svg.length} bytes`);
    assert.equal(readFileSync(new URL(`../public/brand/${file}`, import.meta.url), "utf8"), svg, `public/brand/${file} is stale; run node brand/build-radiate.mjs`);
  }
});
