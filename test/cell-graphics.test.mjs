import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

await import('../public/cell-graphics.js');
const cg = globalThis.weaveCellGraphics;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a share is the value over the scale, held to 0..1', () => {
  assert.equal(cg.share(3, 4), 0.75);
  assert.equal(cg.share(9, 4), 1, 'past the scale is full, never an overflowing bar');
  assert.equal(cg.share(-2, 4), 0, 'a negative is empty');
  assert.equal(cg.share(3, 0), 0, 'a column whose max is zero draws nothing');
  assert.equal(cg.share(3, null), 0, 'no scale yet, nothing to fill');
  assert.equal(cg.share(null, 4), null, 'an empty cell has no graphic at all');
  assert.equal(cg.share('7', 10), 0.7, 'a numeric string reads as its number');
});

test('the bar fills its share of the track', () => {
  const svg = cg.meterSvg('bar', 0.6);
  assert.match(svg, /^<svg class="cg cg-bar"/);
  assert.match(svg, /aria-hidden="true"/, 'the text beside it is what a screen reader reads');
  assert.match(svg, /class="cg-track"[^>]*width="100"/);
  assert.match(svg, /class="cg-fill"[^>]*width="60"/);
});

test('the ring strokes its share of the circumference', () => {
  const svg = cg.meterSvg('ring', 0.25);
  const C = 2 * Math.PI * 7;
  const dash = svg.match(/class="cg-fill"[^>]*stroke-dasharray="([\d.]+) ([\d.]+)"/);
  assert.ok(dash, svg);
  assert.equal(Number(dash[1]), Math.round(C * 0.25 * 100) / 100);
  assert.equal(Number(dash[2]), Math.round(C * 100) / 100);
});

test('heat tints by the share: never invisible, never louder than the text', () => {
  const lo = Number(cg.meterSvg('heat', 0).match(/fill-opacity="([\d.]+)"/)[1]);
  const hi = Number(cg.meterSvg('heat', 1).match(/fill-opacity="([\d.]+)"/)[1]);
  assert.ok(lo > 0 && lo < 0.2, `the floor shows the cell is on the scale (${lo})`);
  assert.ok(hi > lo && hi <= 0.9, `the top stays readable under text (${hi})`);
});

test('the words a reader and a hover get', () => {
  assert.equal(cg.meterTitle('60%', 0.6, 1, '100%'), '60% — 60% of 100%');
  assert.equal(cg.meterTitle('7', 7, 10, '10'), '7 — 70% of 10');
  assert.equal(cg.meterTitle('3', 3, null, null), '3', 'no scale, no share to claim');
});

test('text is not a graphic, and an unknown display draws nothing', () => {
  assert.equal(cg.isGraphic('text'), false);
  assert.equal(cg.isGraphic(undefined), false);
  assert.equal(cg.isGraphic('bar'), true);
  assert.equal(cg.meterSvg('stars', 0.5), '');
});

test('the displays are the engine\'s list', () => {
  const engine = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
  const list = JSON.parse(engine.match(/NUMBER_DISPLAYS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  assert.deepEqual(cg.DISPLAYS, list);
});

test('the page loads the module before app.js', () => {
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  const at = html.indexOf('/cell-graphics.js');
  assert.ok(at > 0 && at < html.indexOf('/app.js'));
});

test('a rating fills whole icons: rounded, held to the scale, read as "n of max"', () => {
  assert.deepEqual(cg.ratingParts(3, 5), { filled: 3, max: 5, label: '3 of 5' });
  assert.deepEqual(cg.ratingParts(3.5, 5), { filled: 4, max: 5, label: '4 of 5' }, 'an average rounds to a whole icon');
  assert.deepEqual(cg.ratingParts(9, 5), { filled: 5, max: 5, label: '5 of 5' });
  assert.deepEqual(cg.ratingParts(null, 7), { filled: 0, max: 7, label: 'unrated, of 7' }, 'empty is not zero');
  assert.deepEqual(cg.ratingParts(0, 3), { filled: 0, max: 3, label: '0 of 3' });
  assert.equal(cg.ratingParts(2, undefined).max, 5, 'a scale nobody named is five');
});

test('clicking the nth icon sets n; clicking the current value clears to 0', () => {
  assert.equal(cg.ratingClick(2, 4), 4);
  assert.equal(cg.ratingClick(4, 4), 0);
  assert.equal(cg.ratingClick(null, 1), 1);
  assert.equal(cg.ratingClick(0, 1), 1);
});

test('a sparkline draws at most the last 60 points and says when it cut', () => {
  const long = Array.from({ length: 75 }, (_, i) => i);
  const p = cg.sparkPoints(long);
  assert.equal(p.shown.length, 60);
  assert.equal(p.shown[0], 15, 'the newest points are kept');
  assert.equal(p.total, 75);
  assert.equal(p.capped, true);
  assert.equal(cg.SPARK_CAP, 60);
  assert.equal(cg.sparkPoints([1, 2]).capped, false);
  assert.match(cg.sparkTitle(long), /^0, 1, 2, .*, 74\n\(drawing the last 60 of 75\)$/s, 'the hover lists every value');
  assert.equal(cg.sparkTitle([1, null, 3]), '1, –, 3', 'a blank slot is shown as a gap');
});

test('a line breaks at a blank slot and scales between the low and the high', () => {
  const svg = cg.sparkSvg('line', [0, 10, null, 5]);
  assert.match(svg, /^<svg class="cg cg-spark cg-spark-line"/);
  assert.match(svg, /aria-hidden="true"/);
  const d = svg.match(/<path class="cg-fill" d="([^"]+)"/)[1];
  assert.equal((d.match(/M/g) ?? []).length, 2, 'two runs: before and after the gap');
  const flat = cg.sparkSvg('line', [4, 4, 4]);
  assert.ok(/d="M[^"]*"/.test(flat), 'a flat series still draws');
  assert.match(cg.sparkSvg('line', [7]), /<circle/, 'one point is a dot');
  assert.equal(cg.sparkSvg('line', [null, null]), '', 'nothing to draw, no graphic');
});

test('columns stand on zero; win/loss draws the sign only', () => {
  const cols = cg.sparkSvg('column', [3, -1, null, 2]);
  assert.equal((cols.match(/<rect class="cg-fill/g) ?? []).length, 3, 'one column per number');
  assert.match(cols, /cg-neg/, 'a negative column is marked');
  const wl = cg.sparkSvg('winloss', [5, -2, 0, 1]);
  assert.equal((wl.match(/cg-win/g) ?? []).length, 2);
  assert.equal((wl.match(/cg-loss/g) ?? []).length, 1);
  const heights = [...wl.matchAll(/class="cg-fill cg-(?:win|loss)"[^>]*height="([\d.]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(heights).size, 1, 'every win and loss is the same height');
});

test('the words a screen reader hears', () => {
  assert.equal(cg.sparkLabel([100, 300, null, 200]), '3 values, last 200, low 100, high 300');
  assert.equal(cg.sparkLabel([]), 'no values');
});

test('the colours mirror the engine, and an unknown one falls back to ink', () => {
  const engine = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
  assert.deepEqual(cg.COLORS, JSON.parse(engine.match(/CELL_COLORS = (\[[^\]]*\])/)[1].replace(/'/g, '"')));
  assert.equal(cg.colorOf('accent'), 'accent');
  assert.equal(cg.colorOf(undefined), 'ink');
  assert.equal(cg.colorOf('plaid'), 'ink');
  assert.equal(cg.colorClass('icon'), 'cg-c-icon');
  assert.equal(cg.colorClass(null), 'cg-c-ink');
});

test("Color by icon: a star is amber, a heart rose, a bolt violet, a flame orange, anything else the accent", () => {
  assert.equal(cg.ratingHue('lucide:star'), 'amber');
  assert.equal(cg.ratingHue('lucide:heart'), 'rose');
  assert.equal(cg.ratingHue('lucide:zap'), 'violet');
  assert.equal(cg.ratingHue('lucide:flame'), 'orange');
  assert.equal(cg.ratingHue('lucide:sun'), 'accent');
  assert.equal(cg.ratingHue(undefined), 'amber', 'no icon is the default star');
});

test('the bar is 6px with round ends on an 80px track: one uniform scale, no stretch', () => {
  assert.equal(cg.BAR_TRACK, 80);
  const svg = cg.meterSvg('bar', 0.6);
  const [w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  assert.equal(w / h, 80 / 6, 'the box has the drawn shape, so the corners stay round');
  assert.doesNotMatch(svg, /preserveAspectRatio="none"/);
  assert.match(svg, /class="cg-track"[^>]*rx="3.75"/, 'the track has round ends: half its height');
  assert.match(svg, /class="cg-fill"[^>]*width="60"[^>]*rx="3.75"/, 'the share is still a percent of the width');
});

test('the ring is 16px with a 2.5px round-capped stroke', () => {
  assert.equal(cg.RING_PX, 16);
  const svg = cg.meterSvg('ring', 0.4);
  const sw = Number(svg.match(/class="cg-fill"[^>]*stroke-width="([\d.]+)"/)[1]);
  assert.ok(Math.abs(sw * (16 / 18) - 2.5) < 0.01, `2.5px at 16px (${sw} in the 18-unit box)`);
  assert.match(svg, /stroke-linecap="round"/);
});

test('heat is a quiet tint that carries its share for the cool-to-warm mix', () => {
  const lo = cg.meterSvg('heat', 0), hi = cg.meterSvg('heat', 1);
  assert.ok(Number(hi.match(/fill-opacity="([\d.]+)"/)[1]) <= 0.45, 'the hottest tint stays behind the text, never a filled chip');
  assert.match(lo, /--cg-f:0%/);
  assert.match(hi, /--cg-f:100%/);
});

test('sparkline columns have 1.5px corners, win/loss are small blocks clear of the midline, the line ends on a dot', () => {
  const col = cg.sparkSvg('column', [1, 3, 2]);
  assert.equal((col.match(/rx="1.5"/g) ?? []).length, 3);
  const wl = cg.sparkSvg('winloss', [5, -2, 1]);
  const mid = cg.SPARK_H / 2;
  for (const m of wl.matchAll(/class="cg-fill cg-(win|loss)"[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"/g)) {
    const [, kind, y, h] = [m[0], m[1], Number(m[2]), Number(m[3])];
    assert.ok(h < mid - 2, `a small block (${h})`);
    if (kind === 'win') assert.ok(y + h < mid, 'a win sits above the midline'); else assert.ok(y > mid, 'a loss sits below it');
  }
  const line = cg.sparkSvg('line', [1, 4, 2]);
  assert.match(line, /stroke-width="1.5"/);
  assert.match(line, /<circle class="cg-dot"[^>]*r="2"/);
});
