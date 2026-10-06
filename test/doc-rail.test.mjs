import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
await import('../public/editor-lib.js');
const LIB = globalThis.WeaveEditorLib;
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');

const H = (...levels) => levels.map((level, i) => ({ level, text: `h${i}` }));

test('fewer than 3 headings means no rail at all', () => {
  assert.deepEqual(LIB.railSpec([]), []);
  assert.deepEqual(LIB.railSpec(H(1)), []);
  assert.deepEqual(LIB.railSpec(H(1, 2)), []);
});

test('3+ headings map to dashes whose length falls with depth', () => {
  const spec = LIB.railSpec(H(1, 2, 3, 6));
  assert.equal(spec.length, 4);
  assert.ok(spec[0].width > spec[1].width, 'h1 dash outreaches h2');
  assert.ok(spec[1].width > spec[2].width, 'h2 dash outreaches h3');
  assert.ok(spec[3].width >= 4, 'even h6 keeps a clickable dash');
  assert.equal(spec[0].text, 'h0', 'the dash carries its heading text for the tooltip');
});

test('equal levels get equal dashes', () => {
  const spec = LIB.railSpec(H(2, 2, 2));
  assert.ok(spec.every((d) => d.width === spec[0].width));
});

test('dashes are big enough to aim at', () => {
  const spec = LIB.railSpec(H(1, 3, 6));
  assert.ok(spec[0].width >= 16, 'an h1 dash reads as a dash, not a speck');
  assert.ok(spec[2].width >= 6, 'the deepest heading still has a target');
  assert.ok(spec[0].width <= 22, 'and the rail stays inside the 26px gutter');
});

test('the tracker picks the last heading above the reading line', () => {
  assert.equal(LIB.currentSection([100, 400, 900], 80), 0, 'nothing scrolled: first section');
  assert.equal(LIB.currentSection([-200, 40, 900], 80), 1, 'second heading passed the line');
  assert.equal(LIB.currentSection([-900, -400, -100], 80), 2, 'past the end: last section');
  assert.equal(LIB.currentSection([], 80), -1, 'no headings, no section');
});

test('a heading resting on the reading line is the current section', () => {
  assert.equal(LIB.currentSection([-900, 80.15625, 900], 80), 1);
  assert.equal(LIB.currentSection([-900, 82, 900], 80), 0, 'a pixel of slack, not ten');
});

test("Vditor's own outline stays disabled", () => {
  assert.match(APP, /outline:\s*\{\s*enable:\s*false/);
});

test('the rail exists only on entity-page document panels', () => {
  const calls = APP.match(/attachDashRail\(/g) ?? [];
  assert.equal(calls.length, 2, 'one definition, one call site (the entity page)');
});

test('the rail lives in the left gutter and hides on narrow screens', () => {
  assert.match(CSS, /\.doc-rail\s*\{[^}]*position:\s*absolute/);
  assert.match(CSS, /@media[^{]*max-width[^{]*\{[^]*?\.doc-rail\s*\{\s*display:\s*none/,
    'no gutter on narrow screens, no rail');
});

test('the rail floats: its track is sticky inside a full-height gutter', () => {
  assert.match(CSS, /\.doc-rail\s*\{[^}]*top:\s*0[^}]*bottom:\s*0/,
    'the rail spans its section, so the sticky track has room to travel');
  assert.match(CSS, /\.doc-rail-track\s*\{[^}]*position:\s*sticky/);
  assert.match(APP, /class:\s*'doc-rail-track'/, 'the rail is built with a track to stick');
});

test('each dash carries its heading, hidden until the rail is clicked open', () => {
  assert.match(APP, /doc-rail-label'\s*\}\s*,\s*d\.text/, 'the label is the heading text');
  assert.match(CSS, /\.doc-rail-label\s*\{[^}]*display:\s*none/, 'resting rail is a minimap');
  assert.match(CSS, /\.doc-rail\.open\s+\.doc-rail-label\s*\{\s*display:\s*block/,
    'clicking the rail opens the headings');
  assert.doesNotMatch(CSS, /\.doc-rail:hover\s+\.doc-rail-label/,
    'hover reveals nothing — the outline is click-to-open');
});

test('the open outline widens in place — it never leaves the gutter for the viewport middle', () => {
  const rule = CSS.match(/\.doc-rail\.open\s+\.doc-rail-track\s*\{[^}]*\}/)?.[0];
  assert.ok(rule, 'an .open state restyles the track');
  assert.doesNotMatch(rule, /position:\s*fixed/, 'the open track stays in the gutter flow');
  assert.doesNotMatch(rule, /top:\s*50%/, 'nothing anchors it to the viewport middle');
  assert.doesNotMatch(rule, /translateY\(/, 'and nothing centres it there');
  const from = APP.indexOf('function attachDashRail');
  const rail = APP.slice(from, APP.indexOf('function attachHeadingFolds', from));
  assert.doesNotMatch(rail, /track\.style\.left/, 'no inline x pin — sticky keeps the rail\'s own x');
});

test('the outline opens on click and closes on Escape or a click away', () => {
  const from = APP.indexOf('function attachDashRail');
  const rail = APP.slice(from, APP.indexOf('function refreshDashRail'));
  assert.match(rail, /classList\.add\('open'\)/, 'a click opens the rail');
  assert.match(rail, /Escape/, 'Escape closes it');
  assert.match(rail, /contains\(e\.target\)/, 'so does clicking anywhere else');
});

test('a hovered dash grows its tick', () => {
  assert.match(CSS, /\.doc-rail-dash:hover\s+\.doc-rail-tick\s*\{[^}]*scaleX\(/);
});

test('the document text is indented off the gutter', () => {
  assert.match(CSS, /\.doc-section\s*\{[^}]*padding-left:\s*18px/);
});

test('clicking a dash scrolls to its section, moving only the box it sits in', () => {
  assert.match(APP, /doc-rail-dash[^]{0,500}scrollTargetIntoView\(heads\[i\]/);
  assert.match(APP, /scrollTargetIntoView\(heads\[i\][^)]*padding: DASH_READING_LINE/,
    'the heading lands on the line the tracker reads from, clear of the header');
});
