/* docs/mockups/card-view-options.html (Feature #181, round 2 Feature #184):
   fifteen card-view options for one Development/Issue row, every field value
   drawn as the same chip the table cell and the entity view use, light and
   dark side by side. The page is generated — scripts/export-card-view-options.mjs
   lifts the chip rules out of public/style.css — so this suite holds the
   checked-in file to a fresh run, and holds the options to the Card contract
   and the chip rules the mockup claims to reuse. Round 2 adds F–O, a
   comparison matrix at the top, and the renderer note at the foot. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, CSS, rulesFor } from './lib/source.mjs';

const FILE = join(ROOT, 'docs/mockups/card-view-options.html');
const HTML = readFileSync(FILE, 'utf8');

test('the checked-in mockup is a fresh run of its generator', () => {
  const fresh = execFileSync(process.execPath, [join(ROOT, 'scripts/export-card-view-options.mjs'), '--stdout'], { encoding: 'utf8' });
  assert.equal(HTML, fresh, 'docs/mockups/card-view-options.html drifted — run scripts/export-card-view-options.mjs');
});

/* Every option by key and name: A–E from round 1 (kept intact), F–O from
   round 2. The brief names each one; the page has to carry them all. */
const OPTIONS = {
  A: 'Header line', B: 'Footer row', C: 'Labelled grid', D: 'Compact', E: 'Reading card',
  F: 'Cover card', G: 'Two-column split', H: 'Kanban tile', I: 'Sidebar accent', J: 'Table-row card',
  K: 'Icon-led', L: 'Dense list item', M: 'Relation-forward', N: 'Timeline card', O: 'Editable card',
};

test('fifteen options A–O, each named, each annotated in one line with what it optimises for, each under a Card config', () => {
  const options = HTML.match(/<section class="opt"/g) ?? [];
  assert.equal(options.length, Object.keys(OPTIONS).length, `one section per option, got ${options.length}`);
  for (const [key, name] of Object.entries(OPTIONS)) {
    assert.match(HTML, new RegExp(`<section class="opt" id="option-${key.toLowerCase()}">\n<h2><span class="key">Option ${key}</span>${name}</h2>`), `Option ${key} ${name}`);
  }
  // Round 1 stays intact: A–E precede F–O in the order the brief lists them.
  const order = [...HTML.matchAll(/<span class="key">Option ([A-O])<\/span>/g)].map((m) => m[1]).join('');
  assert.equal(order, 'ABCDEFGHIJKLMNO', 'options in brief order');
  assert.equal((HTML.match(/Optimises for <b>/g) ?? []).length, options.length, 'one annotation per option');
  const cfgs = HTML.match(/<code class="cfg">([^<]+)<\/code>/g) ?? [];
  assert.equal(cfgs.length, options.length, 'one config per option');
  for (const c of cfgs) {
    assert.match(c, /shape: 'card'/, 'the Card contract: shape');
    assert.match(c, /link: (true|false)/, 'link');
    assert.match(c, /state: (true|false)/, 'state');
    assert.match(c, /description: '(none|small|medium|large)'/, 'description size');
    assert.match(c, /fields: (null|\[)/, 'fields list or null');
  }
  // The options vary along the axes the brief names.
  assert.ok(/description: 'none'/.test(HTML) && /description: 'large'/.test(HTML), 'density varies: a compact option and a reading option');
  assert.ok(/wv-cf-l|<dt>/.test(HTML), 'at least one option shows field labels');
  assert.match(HTML, /class="k k-more">\+\d/, 'overflow folds into a +N chip');
});

test('round 2: the axes each new option varies are on the page', () => {
  assert.match(HTML, /wv-opt-f[^>]*>\s*<div class="wv-card-cover/, 'F: a cover band leads the card');
  assert.match(HTML, /wv-opt-g[\s\S]*?wv-split-aside[\s\S]*?wv-cf-l/, 'G: a right-hand stack of labelled chips');
  const h = HTML.match(/<section class="opt" id="option-h">[\s\S]*?<\/section>/)[0];
  assert.doesNotMatch(h.replace(/<code class="cfg">[^<]*<\/code>/, ''), /k-state/, 'H: no state chip — the column says it');
  assert.match(h, /class="av/, 'H: the person avatar');
  assert.match(h, /wv-date/, 'H: the due date');
  assert.match(HTML, /wv-opt-i[\s\S]*?wv-card-corner-id/, 'I: id in the corner');
  assert.match(HTML, /\.wv-accent-state\s*\{[^}]*3px/, 'I: a 3px accent in the state colour');
  assert.match(HTML, /wv-opt-j[\s\S]*?<div class="wv-row-cell"/, 'J: inline cells in column order');
  assert.match(HTML, /wv-opt-k[\s\S]*?wv-card-ticon[\s\S]*?<svg/, 'K: the table icon large at left');
  assert.match(HTML, /\.wv-card\.wv-opt-l\s*\{[^}]*height: 32px/, 'L: 32px tall');
  assert.match(HTML, /wv-opt-l[\s\S]*?wv-rel-count/, 'L: the relation count');
  const m = HTML.match(/<section class="opt" id="option-m">[\s\S]*?<\/section>/)[0];
  assert.ok(m.indexOf('wv-rel-cluster') < m.indexOf('wv-card-title'), 'M: the relation cluster precedes the name');
  assert.match(HTML, /wv-opt-n[\s\S]*?wv-range-bar/, 'N: the date range as a bar');
  const o = HTML.match(/<section class="opt" id="option-o">[\s\S]*?<\/section>/)[0];
  assert.match(o, /class="picker-box"/, 'O: chips in the edit costume');
  assert.match(o, /chip-pop picker-pop/, 'O: one picker open');
  assert.match(o, /picker-row active/, 'O: the picker has a live row');
});

test('round 2: the comparison matrix at the top, one row per option, the six axes as columns', () => {
  const matrix = HTML.match(/<table class="matrix">[\s\S]*?<\/table>/)?.[0];
  assert.ok(matrix, 'a matrix table');
  assert.ok(HTML.indexOf('<table class="matrix">') < HTML.indexOf('<section class="opt"'), 'the matrix precedes the options');
  for (const axis of ['Field placement', 'Density', 'Labels', 'Overflow', 'State', 'Description']) assert.match(matrix, new RegExp(`<th>${axis}`), `axis ${axis}`);
  for (const key of Object.keys(OPTIONS)) assert.match(matrix, new RegExp(`<th scope="row"><a href="#option-${key.toLowerCase()}">${key}</a>`), `row ${key}`);
  assert.match(matrix, /<th>Renderer/, 'the renderer column: same renderer + Card config, or a new shape');
  assert.match(matrix, /config<\/td>/, 'some options are Card config');
  assert.match(matrix, /new shape<\/td>/, 'some options need a new shape');
});

test('round 2: the closing note says which options are Card config and which need a new shape', () => {
  const note = HTML.match(/<section class="renderers">[\s\S]*?<\/section>/)?.[0];
  assert.ok(note, 'a renderer note');
  assert.ok(HTML.lastIndexOf('<section class="opt"') < HTML.indexOf('<section class="renderers">'), 'the note closes the page');
  assert.match(note, /<code>Card<\/code> config/, 'names the Card config path');
  assert.match(note, /new <code>shape<\/code>/, 'names the new-shape path');
  for (const key of Object.keys(OPTIONS)) assert.match(note, new RegExp(`\\b${key}\\b`), `the note places ${key}`);
});

test('every field value is the table cell’s chip, not text, in both themes', () => {
  for (const cls of ['k k-state cat-not-started', 'k k-select hue-', 'k k-multi hue-', 'k k-rel', 'k-home', 'k k-more']) {
    assert.ok(HTML.includes(cls), `the cell chip .${cls.split(' ').pop()} is what the card draws`);
  }
  const panels = (t) => (HTML.match(new RegExp(`class="panel[^"]*" data-bs-theme="${t}"`, 'g')) ?? []).length;
  assert.equal(panels('light'), panels('dark'), 'every option is shown light and dark');
  assert.equal(panels('dark'), Object.keys(OPTIONS).length, 'one dark panel per option');
  assert.match(HTML, /k k-computed wv-date/, 'the date chip in the quiet computed costume');
  // The live rules ride along verbatim, so the specimen is the real chip.
  for (const sel of ['.k', '.k-rel > a', '.wv-card', '.mention-wrap.open .mention-caret']) {
    const live = rulesFor(sel);
    assert.ok(Object.keys(live).length, `${sel} is a live rule`);
    for (const [k, v] of Object.entries(live)) assert.ok(HTML.includes(`${k}: ${v}`), `${sel} { ${k}: ${v} } is in the mockup`);
  }
  assert.match(HTML, /--wv-chip-font: 13px/, 'the chip size tokens');
  assert.match(HTML, /\.k-rel, \.k-doc, \.k-attach, \.k-more \{ background: none;/, 'no fill behind a pointer chip');
  assert.match(HTML, /border-radius: 4px/, '4px radius');
});

test('the mockup is self-contained', () => {
  assert.doesNotMatch(HTML, /(src|href)=["'](https?:)?\/\//, 'no external src or href');
  assert.doesNotMatch(HTML, /<link[^>]+stylesheet|<script/, 'no stylesheet link, no script');
});
