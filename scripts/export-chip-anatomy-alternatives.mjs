#!/usr/bin/env node
/* docs/mockups/chip-anatomy-alternatives.html — chip anatomy, round 2
   (Feature #185): five alternatives, P–T, to the chip the anatomy guide
   (#180) documents, each drawn in the real chip markup at the live chip
   size, in three surfaces (relation cell, [[…]] mention in a document,
   References list), light and dark side by side, hitboxes outlined.

   Kyle, 2026-09-05, on the guide's elements 1–8: keep 4 (home badge) and
   5 (caret); drop 1 (avatar) as a default; drop 7 (↗) because the chip IS
   the link; segments (6) are the real state / select / multiselect chips at
   the shared size and stay interactive; 8 (×) may go where Backspace
   removes the chip.

   The chip CSS is not copied by hand: chipCss() lifts the live rules out of
   public/style.css (the lift the anatomy export uses), so a token change
   moves the mockup too, and test/chip-alternatives-mockup.test.mjs fails
   when the checked-in file no longer matches a fresh run. Everything an
   option adds on top of the shipped chip is in ALT below, prefixed wv-.

     node scripts/export-chip-anatomy-alternatives.mjs            # writes the file
     node scripts/export-chip-anatomy-alternatives.mjs --stdout   # prints it */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chipCss } from './export-chip-card-anatomy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'mockups', 'chip-anatomy-alternatives.html');

/* ---- the row: the guide's own specimen, Task #12 ---- */
const ROW = {
  id: '#12',
  name: 'Ship the editor',
  home: 'Task',
  state: { name: 'Doing', category: 'in-progress', hue: 'blue' },
  severity: { value: 'High', hue: 'amber' },
  tags: [{ value: 'Editor', hue: 'purple' }, { value: 'Docs', hue: 'green' }],
};

/* ---- the segments: exactly the classes app.js emits for a cell, plus a
   hitbox class. `hit-seg` is the dashed outline that says "a click here
   edits"; the chip class is what says it is the same chip as the cell's. */
const stateChip = () => `<span class="k k-state cat-${ROW.state.category} hue-${ROW.state.hue} hit-seg" title="Change state">${ROW.state.name}</span>`;
const selectChip = () => `<span class="k k-select hue-${ROW.severity.hue} hit-seg" title="Change Severity">${ROW.severity.value}</span>`;
const multiChips = () => ROW.tags.map((t) => `<span class="k k-multi hue-${t.hue} hit-seg" title="Change Tags">${t.value}</span>`).join('');
const live = (...chips) => `<span class="mention-fields wv-live">${chips.join('')}</span>`;
const caret = (open = true) => `<button type="button" class="mention-caret hit-caret" aria-expanded="${open}" title="${open ? 'Hide fields' : 'Show fields'}">›</button>`;
const home = () => `<span class="k-home">${ROW.home}</span>`;
const pointer = ({ id = true, badge = true, cls = '' } = {}) => `<a href="#" onclick="return false" class="hit-link${cls}">${id ? `${ROW.id} ` : ''}<span class="k-label">${ROW.name}</span>${badge ? home() : ''}</a>`;
const x = () => `<span class="x hit-x" title="Unlink">×</span>`;

/* ---- the five options. render(surface) returns one chip for that surface;
   `cell` may carry a ×, `mention` and `refs` never do. ---- */
const OPTIONS = [
  {
    key: 'P', name: 'Name-link + live segments',
    trades: 'one undivided link for two kinds of click — the name navigates, a segment edits — so the pointer has to read the chip before clicking; in return every value in the chip is a control, at the size it has in the grid.',
    config: "{ shape: 'chip', link: true, state: true, fields: ['Severity', 'Tags'], segments: 'inline' }",
    today: '<b>Markup change.</b> The segments leave the anchor and become the cell’s own state / select / multiselect chips with their pickers; one CSS rule drops the ↗. The caret, the home badge and the cell’s × plumbing are today’s.',
    keys: [
      ['Tab', 'lands on the name link; a second Tab on the caret; then one stop per segment (← → move between them)'],
      ['Enter', 'on the name: opens the row (⌘/Ctrl-Enter in a new tab); on a segment: opens its picker'],
      ['Space', 'on the caret: folds the segments; on a segment: opens its picker; on the name: nothing'],
      ['Backspace', 'on any part of a focused chip: removes the chip — unlinks in a cell, deletes the mention in a document; Delete does the same'],
      ['Esc', 'closes an open picker, focus back on the segment'],
    ],
    render: () => `<span class="mention-wrap open wv-alt wv-p"><span class="k k-rel has-segs">${pointer()}${caret()}${live(stateChip(), selectChip(), multiChips())}</span></span>`,
  },
  {
    key: 'Q', name: 'Whole-chip link, segments pop on caret',
    trades: 'a second row of height whenever the strip is open — in a grid cell that row overlaps the next line — for a collapsed chip that stays exactly one link, so the resting surface never asks the pointer to aim.',
    config: "{ shape: 'chip', link: true, state: true, fields: ['Severity', 'Tags'], segments: 'strip' }",
    today: '<b>Closest to today.</b> The collapsed chip is today’s chip minus the ↗ (one CSS rule). The strip is today’s <code>.mention-fields</code> moved after the anchor, at full size, with pickers.',
    keys: [
      ['Tab', 'lands on the chip link; a second Tab on the caret; the strip is skipped while closed'],
      ['Enter', 'on the link: opens the row; on the caret: toggles the strip; on a strip chip: opens its picker'],
      ['Space', 'on the caret: toggles the strip; ↓ from the caret enters the strip, ← → move along it; on a strip chip: opens its picker'],
      ['Backspace', 'on the link or the caret: removes the chip; inside the strip: nothing (the strip is values, not the chip)'],
      ['Esc', 'in the strip: closes it, focus back on the caret'],
    ],
    render: () => `<span class="mention-wrap open wv-alt wv-q"><span class="k k-rel has-segs">${pointer()}${caret()}</span>${live(stateChip(), selectChip(), multiChips()).replace('class="mention-fields wv-live"', 'class="mention-fields wv-live wv-strip"')}</span>`,
  },
  {
    key: 'R', name: 'Split chip',
    trades: 'a heavier chip — a rule down the middle and two backgrounds to read — for the two kinds of click being two visible halves: left half goes, right half edits, and the pointer knows which before it lands.',
    config: "{ shape: 'chip', link: true, state: true, fields: ['Severity', 'Tags'], segments: 'split' }",
    today: '<b>Markup change.</b> A pointer half (today’s anchor: id, name, home badge, caret) and a value half (the live segments) under one 4px outline; the halves are new, the chips inside them are today’s.',
    keys: [
      ['Tab', 'lands on the pointer half; a second Tab on the caret; then one stop per chip in the value half'],
      ['Enter', 'on the pointer half: opens the row; on a value chip: opens its picker'],
      ['Space', 'on the caret: folds the value half away; on a value chip: opens its picker'],
      ['Backspace', 'on either half: removes the whole chip (the halves are one thing to the cell and to the document)'],
      ['Esc', 'closes an open picker'],
    ],
    render: () => `<span class="mention-wrap open wv-alt wv-r"><span class="k k-rel has-segs wv-split"><span class="wv-half wv-half-ptr">${pointer()}${caret()}</span><span class="wv-half wv-half-val">${live(stateChip(), selectChip(), multiChips())}</span></span></span>`,
  },
  {
    key: 'S', name: 'Minimal',
    trades: 'the id, the home badge and every non-state field for the quietest chip — name and state, nothing else at rest; the rest appears on hover or focus, so a scan of a column reads two things per row and a pause reads the whole.',
    config: "{ shape: 'chip', link: false, state: true, fields: [], reveal: 'hover' }",
    today: '<b>Config only.</b> <code>link: false, state: true, fields: []</code> is today’s renderer drawing exactly this at rest, once the ↗ rule is off and the state segment is the live chip at full size. The hover reveal (id, badge, caret) is new.',
    keys: [
      ['Tab', 'lands on the name link; a second Tab on the state chip; focus reveals what hover reveals'],
      ['Enter', 'on the name: opens the row; on the state: opens the state picker'],
      ['Space', 'on the state: opens the state picker'],
      ['Backspace', 'on the name or the state: removes the chip'],
      ['Esc', 'closes the picker; a second Esc hides the revealed parts'],
    ],
    render: () => `<span class="mention-wrap open wv-alt wv-s"><span class="k k-rel has-segs">${pointer({ id: false, badge: false })}<span class="wv-ghost" aria-hidden="true">${ROW.id}${home()}${caret(false)}</span>${live(stateChip())}</span></span>`,
  },
  {
    key: 'T', name: 'Cell-only ×',
    trades: 'P’s chip, plus a × that exists in the relation cell alone — on hover or focus, outside the link — so a mouse can unlink without a keyboard; the mention and the References list keep Backspace as the only remove.',
    config: "{ shape: 'chip', link: true, state: true, fields: ['Severity', 'Tags'], segments: 'inline', remove: 'cell' }",
    today: '<b>P plus today’s ×.</b> The cell already passes the × in as <code>extra</code> and the mention and References surfaces already omit it; T only hides it until hover or focus.',
    keys: [
      ['Tab', 'as P; in a cell the × is the last stop, reached with → from the last segment'],
      ['Enter', 'as P; on the ×: unlinks'],
      ['Space', 'as P; on the ×: unlinks'],
      ['Backspace', 'as P — the × and Backspace do the same thing in a cell; in a document Backspace is the only remove'],
      ['Esc', 'closes an open picker'],
    ],
    render: (surface) => `<span class="mention-wrap open wv-alt wv-t"><span class="k k-rel has-segs">${pointer()}${caret()}${live(stateChip(), selectChip(), multiChips())}${surface === 'cell' ? x() : ''}</span></span>`,
  },
];

/* ---- the three surfaces a chip lives in ---- */
const SURFACES = [
  { key: 'cell', label: 'Relation cell', wrap: (chip) => `<div class="cell-mock"><span class="cell-label">Blocks</span>${chip}</div>` },
  { key: 'mention', label: '[[…]] mention in a document', wrap: (chip) => `<p class="doc-mock">Blocked until ${chip} lands.</p>` },
  { key: 'refs', label: 'References list', wrap: (chip) => `<div class="ref-card"><div class="ref-head">References · 1</div><div class="ref-backlinks">${chip}</div></div>` },
];

const keysTable = (rows) => `<table class="keys"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;

/* ---- the page ---- */
const TOKENS = `
:root { --bg: #ecebe6; --fg: #1a1d23; --muted: #6b7280; --line: #d9d6ce; --mono: ui-monospace, SFMono-Regular, Menlo, monospace; }
[data-bs-theme="light"] {
  --tblr-border-color: #e6e3dc; --tblr-body-color: #1a1d23; --tblr-secondary: #6b7280;
  --tblr-primary: #2563eb; --tblr-primary-rgb: 37, 99, 235; --tblr-danger: #d63939;
  --tblr-bg-surface: #fafaf8; --tblr-bg-surface-secondary: #f3f1ec;
  --tblr-font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
  --panel: #f3f1ec; --paper: #fafaf8;
}
[data-bs-theme="dark"] {
  --tblr-border-color: #2c3a52; --tblr-body-color: #e0dcd4; --tblr-secondary: #9aa3b5;
  --tblr-primary: #4f8df7; --tblr-primary-rgb: 79, 141, 247; --tblr-danger: #ff6b6b;
  --tblr-bg-surface: #16243d; --tblr-bg-surface-secondary: #1c2c48;
  --tblr-font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
  --panel: #0c1b33; --paper: #16243d;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 1480px; margin: 0 auto; padding: 36px 28px 80px; }
h1 { font-size: 22px; margin: 0 0 6px; }
.lead { color: var(--muted); margin: 0 0 18px; max-width: 84ch; }
.lead code, .cfg, .keys th { font-family: var(--mono); font-size: 12px; }
blockquote { margin: 0 0 22px; padding: 8px 14px; border-left: 3px solid var(--line); color: var(--muted); max-width: 84ch; }
.legend { list-style: none; margin: 0 0 30px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 22px; color: var(--muted); font-size: 13px; }
.legend li::before { content: ""; display: inline-block; width: 22px; height: 12px; margin: 0 8px -1px 0; border-radius: 3px; }
.legend .l-link::before { outline: 1.5px solid rgba(128,128,128,.7); outline-offset: -1px; }
.legend .l-seg::before { outline: 1.5px dashed #0e8a7a; outline-offset: -1px; }
.legend .l-caret::before { outline: 1.5px dashed #e5484d; outline-offset: -1px; }
.legend .l-x::before { outline: 1.5px dashed #ce2c31; outline-offset: -1px; }
.legend .l-ghost::before { border: 1px dotted var(--muted); opacity: .6; }
.opt { margin: 0 0 40px; }
.opt h2 { font-size: 15px; margin: 0 0 4px; display: flex; align-items: baseline; gap: 10px; }
.opt h2 .key { font-family: var(--mono); font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 6px; }
.opt .note, .opt .today { margin: 0 0 8px; color: var(--muted); max-width: 96ch; }
.opt .note b, .opt .today b { color: var(--fg); font-weight: 600; }
.cfg { display: block; color: var(--muted); margin: 0 0 12px; }
.surfaces { display: grid; grid-template-columns: 100px 1fr 1fr; gap: 10px 14px; align-items: stretch; margin: 0 0 12px; }
.surfaces .sl { font-size: 12px; color: var(--muted); padding-top: 22px; }
.panel { background: var(--panel); color: var(--tblr-body-color); border-radius: 10px; padding: 26px 18px 18px; position: relative; min-height: 84px; display: flex; align-items: center; overflow: hidden; }
.panel::before { content: attr(data-bs-theme); position: absolute; top: 6px; right: 10px; font: 10px var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--tblr-secondary); }
.keys { border-collapse: collapse; width: 100%; max-width: 96ch; font-size: 13px; margin: 0 0 8px; }
.keys th, .keys td { border-top: 1px solid var(--line); padding: 4px 8px 4px 0; text-align: left; vertical-align: top; }
.keys th { width: 92px; color: var(--muted); font-weight: 500; white-space: nowrap; }
/* ---- the surfaces ---- */
.cell-mock { display: flex; align-items: center; gap: 10px; background: var(--paper); border: 1px solid var(--tblr-border-color); border-radius: 4px; padding: 5px 10px; width: 100%; }
.cell-label { font: 11px var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--tblr-secondary); flex: none; }
.doc-mock { margin: 0; font-size: 15px; line-height: 1.8; }
.ref-card { width: 100%; background: var(--paper); border: 1px solid var(--tblr-border-color); border-radius: 6px; }
.ref-head { font-size: 12px; font-weight: 600; padding: 6px 12px; border-bottom: 1px solid var(--tblr-border-color); }
.ref-backlinks { padding: 10px 12px; }
.ref-backlinks { display: flex; flex-wrap: wrap; gap: 6px; }
/* ---- the hitboxes (as the anatomy guide draws them) ---- */
.hit-link { outline: 1.5px solid rgba(128,128,128,.55); outline-offset: 2px; }
.hit-seg { outline: 1.5px dashed #0e8a7a; outline-offset: 2px; cursor: pointer; }
.hit-caret { outline: 1.5px dashed #e5484d; outline-offset: 2px; }
.hit-x { outline: 1.5px dashed #ce2c31; outline-offset: 2px; }
/* ---- what every option shares on top of the shipped chip ---- */
.wv-alt .k-rel > a::after { content: none; }                       /* ruling: drop 7 — the chip IS the link */
.wv-alt .k-rel > a { padding: 1px 8px; }                            /* the ↗'s left slot closes, the padding evens out */
.wv-alt .k-rel .k-home { margin-left: 5px; }
.wv-alt, .wv-alt .k-rel, .wv-alt .k-rel > a, .wv-alt .k-label { max-width: none; overflow: visible; flex: none; } /* the specimen shows its whole name; truncation (Issue #201) is the cell's business */
.wv-alt .mention-caret { transform: none; }                          /* Issue #193: the retract caret faces the text */
.wv-alt.open .mention-caret { transform: rotate(180deg); }
.wv-alt .mention-fields { display: inline-flex; align-items: center; }
.wv-alt .mention-fields.wv-live { gap: 6px; font-size: var(--wv-chip-font); color: inherit; }
.wv-alt .mention-fields.wv-live > .k { font-size: var(--wv-chip-font); line-height: var(--wv-chip-line); padding: 1px 8px; } /* ruling: 6 at the shared size, over the .82em the shipped segment wears */
.wv-alt .k-rel > .x { margin: 0 8px 0 2px; }
/* P, T: segments beside the link, inside the chip's outline, after a rule */
.wv-p .mention-fields, .wv-t .mention-fields { margin: 0 6px 0 4px; padding-left: 8px; border-left: 1px solid var(--tblr-border-color); }
/* Q: one link at rest; the strip hangs under the chip */
.wv-q { position: relative; display: inline-flex; padding-bottom: 32px; }
.wv-q .wv-strip { position: absolute; left: 0; top: 100%; margin-top: -28px; background: var(--paper); border: 1px solid var(--tblr-border-color); border-radius: 4px; padding: 3px 6px; box-shadow: 0 2px 6px rgba(0,0,0,.08); }
/* R: two halves under one outline */
.wv-split { padding: 0; overflow: hidden; }
.wv-half { display: inline-flex; align-items: center; }
.wv-half-ptr { padding-right: 4px; }
.wv-half-ptr > a { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; color: inherit; text-decoration: none; } /* the anchor sits one level deeper than .k-rel > a */
.wv-half-ptr > a::after { content: none; }
.wv-half-val { background: var(--tblr-bg-surface-secondary); border-left: 1px solid var(--tblr-border-color); padding: 2px 6px; }
.wv-half-val .mention-fields { margin: 0; }
/* S: name + state at rest; the ghost is what hover or focus reveals */
.wv-ghost { display: inline-flex; align-items: center; gap: 5px; margin-left: 2px; opacity: .38; border: 1px dotted var(--tblr-secondary); border-radius: 3px; padding: 0 4px; font-size: var(--wv-chip-font); }
.wv-ghost .mention-caret { margin-left: 0; transform: none; } /* the revealed caret offers to expand, so it points away from the text */
.wv-s .mention-fields { margin-left: 6px; }
`;

export function exportChipAnatomyAlternatives() {
  const sections = OPTIONS.map((o) => `<section class="opt" id="option-${o.key.toLowerCase()}">
<h2><span class="key">Option ${o.key}</span>${o.name}</h2>
<p class="note">Trades <b>${o.trades}</b></p>
<code class="cfg">${o.config}</code>
<div class="surfaces">
${SURFACES.map((s) => `<div class="sl">${s.label}</div>
<div class="panel" data-bs-theme="light" data-surface="${s.key}">${s.wrap(o.render(s.key))}<!-- /panel --></div>
<div class="panel" data-bs-theme="dark" data-surface="${s.key}">${s.wrap(o.render(s.key))}<!-- /panel --></div>`).join('\n')}
</div>
${keysTable(o.keys)}
<p class="today">${o.today}</p>
</section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="kind" content="design-review"><meta name="generated-at" content="2026-09-05"><meta name="repo" content="grunion-ai/weave">
<title>weave — chip anatomy alternatives (Feature #185)</title>
<style>
/* weave chip system, lifted from public/style.css — the same rules a table cell uses */
${chipCss()}
${TOKENS}</style>
</head>
<body>
<div class="wrap">
<h1>Chip anatomy, round 2</h1>
<p class="lead">Five alternatives to the chip the <b>Chip and card anatomy</b> guide (Feature #180) documents, for its own specimen — Task #12, <i>Ship the editor</i>, state Doing, Severity High, Tags Editor · Docs. Each is the real <code>k k-rel</code> markup at the live size (<code>--wv-chip-font</code> / <code>--wv-chip-line</code>), in the three surfaces a chip lives in, light and dark side by side. Every option keeps the <b>home badge</b> (4) and the <b>caret</b> (5), drops the <b>avatar</b> (1) as a default and the <b>↗</b> (7) outright, and draws the <b>segments</b> (6) as the same state, select and multiselect chips a grid cell wears — at the same size, and live: a click on one opens its picker and changes the row. The <b>×</b> (8) survives in one option, in one surface.</p>
<blockquote>“I like 5 (caret), I like 4 (home badge). 1 (avatar) rarely makes sense since we don't often have avatars. 7 (open mark ↗) doesn't make sense if the whole thing is a link. Chips in 6 (segments) should be represented the same size and way they are elsewhere so they can be interacted with — a state can be changed, a multiselect can be changed. 8 (×) may not be necessary since we use this chip inline and it can be deleted with backspace.” — Kyle, 2026-09-05</blockquote>
<ul class="legend"><li class="l-link">the link — a click opens the row</li><li class="l-seg">a live segment — a click opens its picker</li><li class="l-caret">the caret — folds, never navigates</li><li class="l-x">the × — unlinks, outside the link</li><li class="l-ghost">shown on hover or focus only</li></ul>
${sections}
<p class="lead" style="margin-top:8px">Shared by every option: 4px radius; no fill behind a pointer chip; one chip size from <code>--wv-chip-font</code> / <code>--wv-chip-line</code> for the chip and for every segment in it; the caret is the one pixel that never navigates and it faces the text it folds (Issue #193); a person table may still opt the avatar back in through its Chip view config. Pick one; a Feature lands it in <code>viewChipEl</code> and updates the guide (#180) and the chip system (#175).</p>
</div>
</body>
</html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = exportChipAnatomyAlternatives();
  if (process.argv.includes('--stdout')) process.stdout.write(html);
  else { writeFileSync(OUT, html); console.log(`wrote ${OUT} (${html.length} bytes)`); }
}
