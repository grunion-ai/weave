/* docs/mockups/chip-anatomy-alternatives.html (Feature #185): five chip
   alternatives, P–T, that drop the avatar, the ↗ and (mostly) the ×, and
   draw the in-chip segments as the live state / select / multiselect chips
   at the shared chip size. Each option is the real chip markup in three
   surfaces (relation cell, [[…]] mention, References list), light and dark
   side by side, hitboxes outlined as the anatomy guide (#180) does. The
   page is generated — scripts/export-chip-anatomy-alternatives.mjs lifts
   the chip rules out of public/style.css — so this suite holds the checked-
   in file to a fresh run, and holds every option to Kyle's rulings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, rulesFor } from './lib/source.mjs';

const FILE = join(ROOT, 'docs/mockups/chip-anatomy-alternatives.html');
const HTML = readFileSync(FILE, 'utf8');
const KEYS = ['P', 'Q', 'R', 'S', 'T'];
const SURFACES = ['cell', 'mention', 'refs'];
const section = (key) => {
  const m = HTML.match(new RegExp(`<section class="opt" id="option-${key.toLowerCase()}">[\\s\\S]*?</section>`));
  assert.ok(m, `option ${key} has a section`);
  return m[0];
};
const panels = (html, attrs) => html.match(new RegExp(`<div class="panel" ${attrs}>[\\s\\S]*?<!-- /panel -->`, 'g')) ?? [];

test('the checked-in mockup is a fresh run of its generator', () => {
  const fresh = execFileSync(process.execPath, [join(ROOT, 'scripts/export-chip-anatomy-alternatives.mjs'), '--stdout'], { encoding: 'utf8' });
  assert.equal(HTML, fresh, 'docs/mockups/chip-anatomy-alternatives.html drifted — run scripts/export-chip-anatomy-alternatives.mjs');
});

test('options P–T, each with a one-line trade, a keyboard table, and its distance from today’s renderer', () => {
  assert.equal((HTML.match(/<section class="opt"/g) ?? []).length, KEYS.length, 'exactly five options');
  for (const key of KEYS) {
    const s = section(key);
    assert.equal((s.match(/Trades <b>/g) ?? []).length, 1, `${key}: one trade line`);
    assert.equal((s.match(/<table class="keys">/g) ?? []).length, 1, `${key}: one keyboard table`);
    for (const k of ['Tab', 'Enter', 'Space', 'Backspace']) assert.ok(s.includes(`<th>${k}`), `${key}: the keyboard table names ${k}`);
    assert.equal((s.match(/<p class="today">/g) ?? []).length, 1, `${key}: one line on what it takes from today’s renderer`);
    assert.equal((s.match(/<code class="cfg">/g) ?? []).length, 1, `${key}: one chip config`);
  }
  assert.match(HTML, /<p class="today"><b>Config only\.<\/b>/, 'at least one option is today’s renderer with config only');
});

test('every option is drawn in three surfaces, light and dark, at the live chip size', () => {
  for (const key of KEYS) {
    const s = section(key);
    for (const surface of SURFACES) {
      for (const theme of ['light', 'dark']) {
        const p = panels(s, `data-bs-theme="${theme}" data-surface="${surface}"`);
        assert.equal(p.length, 1, `${key}: one ${theme} ${surface} panel`);
        assert.ok(/class="k k-rel/.test(p[0]), `${key}/${surface}/${theme}: the specimen is the real k-rel chip`);
      }
    }
    assert.ok(/class="mention-wrap/.test(s), `${key}: a mention wrapper, as app.js emits`);
    assert.ok(/class="k-home"/.test(s), `${key}: keeps the home badge (ruling: keep 4)`);
  }
  // Surfaces are what the brief names.
  assert.ok(/<p class="doc-mock">[^<]+<span class="mention-wrap/.test(HTML), 'the mention sits inside running text');
  assert.ok(/class="ref-backlinks"/.test(HTML), 'the References list is the entity page’s .ref-backlinks');
  assert.ok(/class="cell-mock"/.test(HTML), 'the relation cell is drawn as a grid cell');
});

test('the rulings: no avatar, no ↗, segments are live chips at the shared size, × only in T’s relation cell', () => {
  assert.doesNotMatch(HTML.slice(HTML.indexOf('<section')), /class="av\b/, 'no avatar in any option (ruling: drop 1)');
  assert.match(HTML, /\.wv-alt \.k-rel > a::after \{ content: none/, 'the ↗ is switched off — the chip IS the link (ruling: drop 7)');
  assert.match(HTML, /\.wv-alt \.mention-fields\.wv-live > \.k \{ font-size: var\(--wv-chip-font\); line-height: var\(--wv-chip-line\)/, 'segments wear the shared chip size (ruling: 6 at the size they have elsewhere)');
  for (const key of KEYS) {
    const s = section(key);
    assert.ok(/wv-live/.test(s), `${key}: segments are in a live strip`);
    assert.ok(/class="k k-state cat-in-progress hue-blue/.test(s), `${key}: the state is the state chip`);
  }
  for (const key of ['P', 'Q', 'R', 'T']) {
    const s = section(key);
    assert.ok(/class="k k-select hue-/.test(s) && /class="k k-multi hue-/.test(s), `${key}: select and multiselect segments are the cell’s chips`);
    assert.ok(/class="mention-caret/.test(s), `${key}: keeps the caret (ruling: keep 5)`);
  }
  // × : only option T, only its relation-cell panels.
  for (const key of KEYS) {
    const s = section(key);
    for (const surface of SURFACES) {
      for (const theme of ['light', 'dark']) {
        const [p] = panels(s, `data-bs-theme="${theme}" data-surface="${surface}"`);
        const hasX = /class="x hit-x"/.test(p);
        assert.equal(hasX, key === 'T' && surface === 'cell', `${key}/${surface}/${theme}: × ${hasX ? 'present' : 'absent'}`);
      }
    }
  }
});

test('hitboxes are outlined as in the anatomy guide, with a legend', () => {
  assert.match(HTML, /\.hit-link \{ outline: 1\.5px solid/, 'the link is the solid grey outline');
  assert.match(HTML, /\.hit-seg \{ outline: 1\.5px dashed/, 'a live segment is a dashed outline');
  assert.match(HTML, /\.hit-caret \{ outline: 1\.5px dashed/, 'the caret is its own dashed box');
  assert.match(HTML, /\.hit-x \{ outline: 1\.5px dashed/, 'the × is its own dashed box');
  assert.match(HTML, /<ul class="legend">/, 'a legend names the outlines');
  for (const key of KEYS) {
    const s = section(key);
    assert.ok(/hit-link/.test(s), `${key}: the link hitbox is drawn`);
    assert.ok(/hit-seg/.test(s), `${key}: the segment hitboxes are drawn`);
  }
});

test('the live chip rules ride along verbatim and the page is self-contained', () => {
  for (const sel of ['.k', '.k-rel > a', '.mention-caret', '.mention-wrap.open .mention-caret']) {
    const live = rulesFor(sel);
    assert.ok(Object.keys(live).length, `${sel} is a live rule`);
    for (const [k, v] of Object.entries(live)) assert.ok(HTML.includes(`${k}: ${v}`), `${sel} { ${k}: ${v} } is in the mockup`);
  }
  assert.match(HTML, /--wv-chip-font: 13px/, 'the chip size tokens');
  assert.match(HTML, /\.k-rel, \.k-doc, \.k-attach, \.k-more \{ background: none;/, 'no fill behind a pointer chip');
  assert.match(HTML, /border-radius: 4px/, '4px radius');
  assert.doesNotMatch(HTML, /(src|href)=["'](https?:)?\/\//, 'no external src or href');
  assert.doesNotMatch(HTML, /<link[^>]+stylesheet|<script/, 'no stylesheet link, no script');
});
