/* The chip system (design review 2026-08-24: set E at 4px, no pointer fill).
   Three tiers and nothing else:

     value    filled tint, no border      colour means "chosen from a set"
     pointer  1px outline plus ↗          means "clicking goes somewhere"
     computed a glyph, then the value     means "not yours to type"

   Two halves to the contract. public/chip-core.js is pure logic — the ten-hue
   ramp, the hex→hue migration, the avatar hash — tested directly. The rest is
   source-level, in the style of ui-contract.test.mjs: the UI is dependency-free
   vanilla JS with no DOM runtime here, so a tier's rule is asserted by reading
   its declarations out of style.css. Each test names the promise it keeps. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

await import('../public/chip-core.js');
const chips = globalThis.chipCore;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (f) => readFileSync(join(ROOT, f), 'utf8');
const CSS = raw('public/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const APP = raw('public/app.js');
const ENGINE = raw('src/engine.js');
const FDC = raw('public/field-dialog-core.js');
const INDEX = raw('public/index.html');

/* Same minimal reader ui-contract.test.mjs uses: every declaration block whose
   selector list names `selector` as a whole comma-separated part, merged in
   source order. */
function rulesFor(selector, css = CSS) {
  const out = {};
  for (const [, sels, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').map((s) => s.trim()).includes(selector)) continue;
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}
/* Declarations under a dark-theme ancestor, which is where the ramp's second
   half lives. */
const DARK = CSS.split('[data-bs-theme="dark"]').slice(1).join('\n');

const VALUE = ['.k-state', '.k-select', '.k-multi', '.k-key'];
const POINTER = ['.k-rel', '.k-doc', '.k-attach', '.k-more'];

/* ---------- the ramp ---------- */

test('the ramp is ten hues, and slate is held back from the rotation', () => {
  assert.equal(chips.HUES.length, 10);
  assert.ok(chips.HUES.includes('slate'));
  assert.equal(chips.RAMP_ORDER.length, 9);
  assert.ok(!chips.RAMP_ORDER.includes('slate'),
    'slate is the resting colour for anything uncoloured, never auto-assigned');
  for (const h of chips.RAMP_ORDER) assert.ok(chips.HUES.includes(h), `${h} is a real hue`);
});

test('a new option walks the ramp in order and wraps', () => {
  assert.equal(chips.hueForIndex(0), chips.RAMP_ORDER[0]);
  assert.equal(chips.hueForIndex(8), chips.RAMP_ORDER[8]);
  assert.equal(chips.hueForIndex(9), chips.RAMP_ORDER[0], 'wraps rather than running out');
  assert.equal(chips.hueForIndex(-1), chips.RAMP_ORDER[0], 'a nonsense index still yields a hue');
});

test('every hue the ramp can hand out has a CSS rule with both tokens', () => {
  for (const h of chips.HUES) {
    const r = rulesFor(`.hue-${h}`);
    assert.ok(r['--fill'], `.hue-${h} defines --fill`);
    assert.ok(r['--text'], `.hue-${h} defines --text`);
  }
});

test('every hue is redefined for dark — a light tint on navy is the classic unreadable cell', () => {
  for (const h of chips.HUES) {
    assert.match(DARK, new RegExp(`\\.hue-${h}\\b`),
      `.hue-${h} has no dark-theme definition`);
  }
});

/* ---------- the migration ---------- */

test("every colour a stored option can already hold is in the ramp", () => {
  // The claim the migration rests on: this is a rename, not a colour match.
  const stored = FDC.match(/const OPTION_COLORS = \[([^\]]*)\]/)[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.ok(stored.length >= 7, 'read the real OPTION_COLORS list');
  for (const hex of stored) {
    const hue = chips.hueFromHex(hex);
    assert.ok(hue, `stored colour ${hex} has no ramp hue`);
    assert.equal(chips.HUE_HEX[hue].toLowerCase(), hex.toLowerCase(),
      `${hex} must map to the hue that resolves back to it`);
  }
});

test('an unset or unknown colour rests on slate rather than throwing', () => {
  assert.equal(chips.hueFromHex(''), 'slate');
  assert.equal(chips.hueFromHex(null), 'slate');
  assert.equal(chips.hueFromHex(undefined), 'slate');
  assert.equal(chips.hueFromHex('#123456'), 'slate');
});

test('hueFromHex ignores case and stray whitespace', () => {
  const hex = chips.HUE_HEX.blue;
  assert.equal(chips.hueFromHex(hex.toUpperCase()), 'blue');
  assert.equal(chips.hueFromHex(` ${hex} `), 'blue');
});

/* ---------- people ---------- */

test('the same colleague is the same colour in every table', () => {
  const a = chips.hueForName('Sajit Roshan');
  assert.equal(a, chips.hueForName('Sajit Roshan'), 'the hash is deterministic');
  assert.ok(chips.RAMP_ORDER.includes(a), 'an avatar never lands on slate');
  assert.notEqual(chips.hueForName('Kyle Adriany'), chips.hueForName('Hayden Price'));
});

test('a nameless person still gets a chip instead of a crash', () => {
  for (const bad of ['', null, undefined, '   ']) {
    assert.ok(chips.RAMP_ORDER.includes(chips.hueForName(bad)));
    assert.equal(typeof chips.initialsFor(bad), 'string');
  }
});

test('initials are at most two letters, upper case', () => {
  assert.equal(chips.initialsFor('Sajit Roshan'), 'SR');
  assert.equal(chips.initialsFor('kyle adriany'), 'KA');
  assert.equal(chips.initialsFor('Cher'), 'C');
  assert.equal(chips.initialsFor('Ana Maria de Souza'), 'AM', 'never more than two');
});

test('every person relation wears an avatar — that is what makes it a person', () => {
  assert.match(APP, /class: 'av[ ']/, 'app.js builds an .av element');
  const r = rulesFor('.av');
  assert.ok(r.width && r.height, '.av is a fixed square');
  assert.ok(r['border-radius'], '.av declares its own radius');
});

/* ---------- the four categories ---------- */

test("the fifth state category is gone — nothing seeded 'other'", () => {
  const cats = ENGINE.match(/const STATE_CATEGORIES = \[([^\]]*)\]/)[1]
    .split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepEqual(cats, ['not-started', 'in-progress', 'done', 'canceled']);
  assert.equal(chips.CATEGORIES.length, 4);
  assert.deepEqual(chips.CATEGORIES.map((c) => c.id), cats,
    'chip-core and the engine name the same four');
});

test("a state stored as 'other' migrates rather than failing validation", () => {
  assert.equal(chips.categoryOrDefault('other'), 'in-progress');
  assert.equal(chips.categoryOrDefault('nonsense'), 'in-progress');
  assert.equal(chips.categoryOrDefault('done'), 'done');
});

test('each category carries a default hue and glyph, and styles a chip', () => {
  for (const c of chips.CATEGORIES) {
    assert.ok(chips.HUES.includes(c.hue), `${c.id} names a real hue`);
    assert.ok(c.icon && c.icon.length, `${c.id} has a default glyph`);
    assert.ok(Object.keys(rulesFor(`.k-state.cat-${c.id}`)).length,
      `.k-state.cat-${c.id} has no rule`);
  }
});

test('canceled reads as ended, not as finished', () => {
  assert.equal(rulesFor('.k-state.cat-canceled')['text-decoration'], 'line-through');
});

/* ---------- tier geometry ---------- */

test('the value tier is 4px and square-ish — set E, not the pill', () => {
  assert.equal(rulesFor('.k')['border-radius'], '4px',
    'Kyle chose 4px over the pill on 2026-08-24');
});

test('a value chip is a fill with no border — colour is the whole signal', () => {
  const r = rulesFor(VALUE.join(', ')) ;
  const merged = Object.keys(r).length ? r : rulesFor('.k-state');
  assert.match(merged.background ?? '', /var\(--fill/, 'value chips fill from the hue token');
  assert.match(merged.color ?? '', /var\(--text/, 'and take their text from it too');
  assert.equal(merged.border, '0', 'a value chip carries no border');
});

test('a pointer chip is an outline with no fill — Kyle chose none over faint', () => {
  for (const sel of POINTER) {
    const r = rulesFor(POINTER.join(', '));
    const merged = Object.keys(r).length ? r : rulesFor(sel);
    assert.match(merged.border ?? '', /^1px solid/, `${sel} is a 1px outline`);
    assert.equal(merged.background, 'none', `${sel} carries no fill`);
  }
  assert.ok(!/\.k-rel[^{]*\{[^}]*background:\s*var\(--fill/.test(CSS),
    'a pointer must never borrow the value tier’s fill');
});

test('a pointer says it goes somewhere', () => {
  for (const sel of ['.k-rel::after', '.k-doc::after', '.k-attach::after']) {
    const r = rulesFor(['.k-rel::after', '.k-doc::after', '.k-attach::after'].join(', '));
    const merged = Object.keys(r).length ? r : rulesFor(sel);
    assert.match(merged.content ?? '', /↗/, `${sel} wears the open mark`);
  }
});

test('a computed value is never a chip', () => {
  const r = rulesFor('.k-computed');
  assert.equal(r.background, 'none');
  assert.equal(r.border, '0');
  assert.equal(r.padding, '0');
});

test('an empty cell is an invitation, not a disabled control', () => {
  // Dimming to 50% reads as "you may not", which is the opposite of the truth.
  assert.match(rulesFor('.k-add')['border'] ?? '', /dashed/);
  assert.match(CSS, /\.k-doc\.empty[^{]*\{[^}]*border-style:\s*dashed/,
    'an empty document chip is dashed too');
});

/* ---------- the new chips ---------- */

test('key and overflow are real chips with real rules', () => {
  assert.ok(Object.keys(rulesFor('.k-key')).length, '.k-key has a rule');
  assert.ok(Object.keys(rulesFor('.k-more')).length, '.k-more has a rule');
  assert.match(APP, /k-more/, 'app.js renders the overflow chip');
  assert.match(APP, /k-key/, 'app.js renders the key chip');
});

test('one neutral system chip replaces both of the old ones', () => {
  assert.ok(Object.keys(rulesFor('.k-sys')).length, '.k-sys has a rule');
  assert.ok(!/\.kind-badge\b/.test(CSS), '.kind-badge is gone');
  assert.ok(!/kind-badge/.test(APP), 'app.js no longer builds a .kind-badge');
});

/* ---------- what must not break ---------- */

test('the old .chip class still resolves for one release', () => {
  // Board, list, doc rail and the cell popover all still ask for `.chip`.
  assert.match(CSS, /\.chip\b/, '.chip is kept as an alias while callers migrate');
});

test("the retired 'other' category leaves no styling behind", () => {
  assert.ok(!/state-other/.test(CSS), 'state-other CSS is removed');
  assert.ok(!/state-other/.test(APP), 'app.js never emits state-other');
});

test('chip-core is loaded by the page, not just by the tests', () => {
  assert.match(INDEX, /<script src="\/chip-core\.js"><\/script>/);
  assert.ok(INDEX.indexOf('/chip-core.js') < INDEX.indexOf('/app.js'),
    'chip-core must load before app.js reads it');
});
