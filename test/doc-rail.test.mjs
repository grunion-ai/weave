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

test('the resting rail rides the vertical middle of its scroll box, as ChatGPT does', () => {
  assert.match(CSS, /\.doc-rail-track\s*\{[^}]*top:\s*calc\(50%[^;]*var\(--rail-h/,
    'sticky top is the box middle less half the rail');
  assert.match(APP, /setProperty\('--rail-h'/, 'the rail measures its own height for the offset');
});

test('a section preview is its text, whitespace collapsed and capped', () => {
  assert.equal(LIB.sectionPreview([]), '');
  assert.equal(LIB.sectionPreview(['  one\n two ', '', 'three']), 'one two three');
  const long = LIB.sectionPreview(['word '.repeat(200)], 40);
  assert.ok(long.length <= 40, `capped at the limit (${long.length})`);
  assert.ok(long.endsWith('…'), 'a cut preview ends on an ellipsis');
});

test('resting dashes share one length and grow to their depth while the rail is hovered', () => {
  assert.match(CSS, /\.doc-rail-tick\s*\{[^}]*width:\s*\d+px/, 'one resting length for every tick');
  assert.match(CSS, /\.doc-rail:hover\s+\.doc-rail-tick\s*\{[^}]*width:\s*var\(--w\)/,
    'a hovered rail lets each tick take its depth length');
  assert.match(APP, /--w:\$\{d\.width\}px/, 'the depth length rides on the tick as --w');
});

test('hovering a dash shows one preview card beside the rail, never a panel or a native tooltip', () => {
  const from = APP.indexOf('function attachDashRail');
  const rail = APP.slice(from, APP.indexOf('const docFolds', from));
  assert.match(rail, /class:\s*'doc-rail-card'/, 'the rail owns one card');
  assert.match(rail, /pointerenter/, 'a dash under the pointer shows its card');
  assert.match(rail, /focus/, 'and so does a dash reached by keyboard');
  assert.match(rail, /sectionPreview\(/, 'the card previews the section text');
  assert.doesNotMatch(rail, /classList\.add\('open'\)/, 'no click-to-open panel');
  assert.doesNotMatch(rail, /title:\s*d\.text/, 'no native title tooltip on a dash');
  assert.doesNotMatch(CSS, /\.doc-rail\.open/, 'no open-panel styles');
  assert.doesNotMatch(CSS, /\.doc-rail-label/, 'no label list');
});

test('the card hides when the pointer leaves the rail, on blur and on Escape', () => {
  const from = APP.indexOf('function attachDashRail');
  const rail = APP.slice(from, APP.indexOf('function headText', from));
  assert.match(rail, /pointerleave/);
  assert.match(rail, /focusout/);
  assert.match(rail, /Escape/);
});

test('the card clamps its preview to three lines and its title to one', () => {
  assert.match(CSS, /\.doc-rail-card-text\s*\{[^}]*-webkit-line-clamp:\s*3/);
  assert.match(CSS, /\.doc-rail-card-title\s*\{[^}]*text-overflow:\s*ellipsis/);
});

test('the dash for the section on screen is body-coloured', () => {
  assert.match(CSS, /\.doc-rail-dash\.active\s+\.doc-rail-tick\s*\{[^}]*var\(--tblr-body-color\)/);
});

test('the document text is indented off the gutter', () => {
  assert.match(CSS, /\.doc-section\s*\{[^}]*padding-left:\s*18px/);
});

test('clicking a dash scrolls to its section, moving only the box it sits in', () => {
  assert.match(APP, /doc-rail-dash[^]{0,500}scrollTargetIntoView\(heads\[i\]/);
  assert.match(APP, /scrollTargetIntoView\(heads\[i\][^)]*padding: DASH_READING_LINE/,
    'the heading lands on the line the tracker reads from, clear of the header');
});
