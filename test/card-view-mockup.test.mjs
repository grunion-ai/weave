/* docs/mockups/card-view-options.html (Feature #181): five card-view options
   for one Development/Issue row, every field value drawn as the same chip the
   table cell and the entity view use, light and dark side by side. The page
   is generated — scripts/export-card-view-options.mjs lifts the chip rules
   out of public/style.css — so this suite holds the checked-in file to a
   fresh run, and holds the options to the Card contract and the chip rules
   the mockup claims to reuse. */
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

test('three to five options, each annotated in one line with what it optimises for, each under a Card config', () => {
  const options = HTML.match(/<section class="opt"/g) ?? [];
  assert.ok(options.length >= 3 && options.length <= 5, `3–5 options, got ${options.length}`);
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

test('every field value is the table cell’s chip, not text, in both themes', () => {
  for (const cls of ['k k-state cat-not-started', 'k k-select hue-', 'k k-multi hue-', 'k k-rel', 'k-home', 'k k-more']) {
    assert.ok(HTML.includes(cls), `the cell chip .${cls.split(' ').pop()} is what the card draws`);
  }
  const panels = (t) => (HTML.match(new RegExp(`class="panel" data-bs-theme="${t}"`, 'g')) ?? []).length;
  assert.equal(panels('light'), panels('dark'), 'every option is shown light and dark');
  assert.ok(panels('dark') >= 3, 'dark panels present');
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
