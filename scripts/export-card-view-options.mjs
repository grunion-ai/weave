#!/usr/bin/env node
/* docs/mockups/card-view-options.html — five card-view options for one
   Development/Issue row (Feature #181), every field value drawn as the SAME
   chip the table cell and the entity view use, light and dark side by side.

   Kyle, 2026-09-05: "Need mockups of card view options. Need to show field
   chips the same way we do in table and entity view, but within cards."

   The chip CSS is not copied by hand: chipCss() lifts the live rules out of
   public/style.css (the same lift the anatomy export uses), so a token change
   moves the mockup too, and test/handbook.test.mjs fails when the checked-in
   file no longer matches a fresh run. Card contract kept per option:
   { shape: 'card', link, state, description: none|small|medium|large,
   fields }. 4px radius; no fill behind a pointer chip.

     node scripts/export-card-view-options.mjs            # writes the file
     node scripts/export-card-view-options.mjs --stdout   # prints it */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chipCss } from './export-chip-card-anatomy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'mockups', 'card-view-options.html');

/* ---- the row: Issue #193 as it stands in the weave workspace ---- */
const ROW = {
  id: '#193',
  name: 'Collapsible chip: retract caret points down; it should face the text',
  state: { name: 'Open', category: 'not-started', hue: 'slate' },
  description: {
    small: 'Reported by Kyle 2026-09-05 (stream of consciousness while using :4400).',
    medium: 'Reported by Kyle 2026-09-05 (stream of consciousness while using :4400). Symptom. On a collapsible chip preview, the expand caret is right; the retract…',
    large: 'Reported by Kyle 2026-09-05 (stream of consciousness while using :4400). Symptom. On a collapsible chip preview (Feature #163 / #175), the expand caret is right. The retract caret, shown once the chip is open, points down. It should face the text it collapses back into, so expand and retract read as one control folding in and out. Expected. Retract caret oriented toward…',
  },
  fields: [
    { label: 'Severity', kind: 'select', value: 'Low', hue: 'green' },
    { label: 'Symptom', kind: 'multi', values: [{ value: 'Looks broken', hue: 'amber' }] },
    { label: 'Fixed in', kind: 'relation', value: 'v0.4.6', home: 'Release' },
    { label: 'Reported', kind: 'date', value: '2026-09-05' },
    { label: 'Area', kind: 'select', value: 'Chips', hue: 'purple' },
  ],
};

/* ---- the chips: exactly the classes app.js emits for a cell ---- */
const stateChip = (s) => `<span class="k k-state cat-${s.category} hue-${s.hue}"><span class="ico"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg></span>${s.name}</span>`;
const selectChip = (f) => `<span class="k k-select hue-${f.hue}">${f.value}</span>`;
const multiChips = (f) => f.values.map((v) => `<span class="k k-multi hue-${v.hue}">${v.value}</span>`).join(' ');
const relChip = (f) => `<span class="mention-wrap"><span class="k k-rel"><a href="#" onclick="return false">${f.value}<span class="k-home">${f.home}</span></a></span></span>`;
const dateChip = (f) => `<span class="k k-computed wv-date"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>${f.value}</span>`;
const chip = (f) => ({ select: selectChip, multi: multiChips, relation: relChip, date: dateChip })[f.kind](f);
const more = (n) => (n > 0 ? `<span class="k k-more">+${n}</span>` : '');
const labelled = (f) => `<span class="wv-cf"><span class="wv-cf-l">${f.label}</span>${chip(f)}</span>`;

const title = (link = true) => `<a class="wv-card-title" href="#" onclick="return false">${link ? `<span class="wv-card-id">${ROW.id}</span>` : ''}${ROW.name}</a>`;
const desc = (size) => (size === 'none' ? '' : `<div class="wv-card-desc wv-desc-${size}">${ROW.description[size]}</div>`);

/* ---- the five options ---- */
const OPTIONS = [
  {
    key: 'A', name: 'Header line', config: { link: true, state: true, description: 'small', fields: null },
    optimises: 'scanning a board column — state and the first chips read on the same eyeline as the title; the description is the second glance.',
    render: () => `<div class="wv-card wv-opt-a">
  <div class="wv-card-head wv-head-wrap">${title()}${stateChip(ROW.state)}${ROW.fields.slice(0, 2).map(chip).join(' ')}${more(ROW.fields.length - 2)}</div>
  ${desc('small')}
</div>`,
  },
  {
    key: 'B', name: 'Footer row', config: { link: true, state: true, description: 'medium', fields: null },
    optimises: 'reading — title, then prose, then the facts as one chip row at the foot; overflow folds into a +N chip like a crowded cell.',
    render: () => `<div class="wv-card wv-opt-b">
  <div class="wv-card-head">${title()}${stateChip(ROW.state)}</div>
  ${desc('medium')}
  <div class="wv-card-foot">${ROW.fields.slice(0, 3).map(chip).join(' ')}${more(ROW.fields.length - 3)}</div>
</div>`,
  },
  {
    key: 'C', name: 'Labelled grid', config: { link: true, state: true, description: 'small', fields: ['Severity', 'Symptom', 'Fixed in', 'Reported'] },
    optimises: 'comparing cards — the label column lines up across a gallery, so Severity sits under Severity; the value is still the chip, never flattened text.',
    render: () => `<div class="wv-card wv-opt-c">
  <div class="wv-card-head">${title()}${stateChip(ROW.state)}</div>
  ${desc('small')}
  <dl class="wv-card-fields wv-fields-chips">${ROW.fields.slice(0, 4).map((f) => `<dt>${f.label}</dt><dd>${chip(f)}</dd>`).join('')}</dl>
</div>`,
  },
  {
    key: 'D', name: 'Compact', config: { link: false, state: true, description: 'none', fields: null },
    optimises: 'density — a two-line tile for a crowded board or a grid cell: name and state, then two chips and the count; no id, no prose.',
    render: () => `<div class="wv-card compact wv-opt-d">
  <div class="wv-card-head">${title(false)}${stateChip(ROW.state)}</div>
  <div class="wv-card-foot">${ROW.fields.slice(0, 2).map(chip).join(' ')}${more(ROW.fields.length - 2)}</div>
</div>`,
  },
  {
    key: 'E', name: 'Reading card', config: { link: true, state: true, description: 'large', fields: ['Severity', 'Symptom', 'Fixed in', 'Reported', 'Area'] },
    optimises: 'a peek or a gallery where the card IS the reading surface — large description, every configured field with its label as a wrapped chip row.',
    render: () => `<div class="wv-card wv-opt-e">
  <div class="wv-card-head">${title()}${stateChip(ROW.state)}</div>
  ${desc('large')}
  <div class="wv-card-foot wv-foot-labelled">${ROW.fields.map(labelled).join('')}</div>
</div>`,
  },
];

const cfg = (c) => `{ shape: 'card', link: ${c.link}, state: ${c.state}, description: '${c.description}', fields: ${c.fields ? JSON.stringify(c.fields).replace(/"/g, "'") : 'null'} }`;

/* ---- the page ---- */
const TOKENS = `
:root { --bg: #ecebe6; --fg: #1a1d23; --muted: #6b7280; --line: #d9d6ce; --mono: ui-monospace, SFMono-Regular, Menlo, monospace; }
[data-bs-theme="light"] {
  --tblr-border-color: #e6e3dc; --tblr-body-color: #1a1d23; --tblr-secondary: #6b7280;
  --tblr-primary: #2563eb; --tblr-primary-rgb: 37, 99, 235; --tblr-danger: #d63939;
  --tblr-bg-surface: #fafaf8; --tblr-bg-surface-secondary: #f3f1ec;
  --tblr-font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
  --panel: #f3f1ec;
}
[data-bs-theme="dark"] {
  --tblr-border-color: #2c3a52; --tblr-body-color: #e0dcd4; --tblr-secondary: #9aa3b5;
  --tblr-primary: #4f8df7; --tblr-primary-rgb: 79, 141, 247; --tblr-danger: #ff6b6b;
  --tblr-bg-surface: #16243d; --tblr-bg-surface-secondary: #1c2c48;
  --tblr-font-monospace: ui-monospace, SFMono-Regular, Menlo, monospace;
  --panel: #0c1b33;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 36px 28px 80px; }
h1 { font-size: 22px; margin: 0 0 6px; }
.lead { color: var(--muted); margin: 0 0 28px; max-width: 78ch; }
.lead code, .cfg { font-family: var(--mono); font-size: 12px; }
.opt { margin: 0 0 34px; }
.opt h2 { font-size: 15px; margin: 0 0 4px; display: flex; align-items: baseline; gap: 10px; }
.opt h2 .key { font-family: var(--mono); font-size: 12px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 6px; }
.opt .note { margin: 0 0 10px; color: var(--muted); max-width: 90ch; }
.opt .note b { color: var(--fg); font-weight: 600; }
.cfg { display: block; color: var(--muted); margin: 0 0 10px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.panel { background: var(--panel); color: var(--tblr-body-color); border-radius: 10px; padding: 18px; display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; position: relative; }
.panel::before { content: attr(data-bs-theme); position: absolute; top: 6px; right: 10px; font: 10px var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--tblr-secondary); }
.panel .wv-card { max-width: 420px; }
/* ---- what each option adds on top of the shipped card (the candidate rules) ---- */
.wv-head-wrap { flex-wrap: wrap; justify-content: flex-start; gap: 6px 8px; }
.wv-head-wrap .wv-card-title { flex-basis: 100%; }
.wv-card-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.wv-foot-labelled { gap: 6px 14px; }
.wv-cf { display: inline-flex; align-items: center; gap: 5px; }
.wv-cf-l { color: var(--tblr-secondary); font-size: 12px; }
.wv-fields-chips dt { align-self: center; }
.wv-fields-chips dd { overflow: visible; white-space: normal; }
.wv-card-desc.wv-desc-medium { -webkit-line-clamp: 2; }
.wv-card-desc.wv-desc-large { -webkit-line-clamp: 6; }
.wv-date svg { margin-right: 4px; opacity: .6; }
.k .ico svg { display: block; }
.k-rel .k-home { margin-left: 5px; }
`;

export function exportCardViewOptions() {
  const sections = OPTIONS.map((o) => `<section class="opt" id="option-${o.key.toLowerCase()}">
<h2><span class="key">Option ${o.key}</span>${o.name}</h2>
<p class="note">Optimises for <b>${o.optimises}</b></p>
<code class="cfg">${cfg(o.config)}</code>
<div class="pair">
<div class="panel" data-bs-theme="light">${o.render()}</div>
<div class="panel" data-bs-theme="dark">${o.render()}</div>
</div>
</section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="kind" content="design-review"><meta name="generated-at" content="2026-09-05"><meta name="repo" content="grunion-ai/weave">
<title>weave — card view options (Feature #181)</title>
<style>
/* weave chip system, lifted from public/style.css — the same rules a table cell uses */
${chipCss()}
${TOKENS}</style>
</head>
<body>
<div class="wrap">
<h1>Card view options</h1>
<p class="lead">Five ways to lay out the <b>Card</b> view (Feature #175) for one <code>Development/Issue</code> row — Issue #193 as it stands. Every field value is the <b>same chip the table cell and the entity view draw</b>: the state chip with its glyph (category owns the colour), select and multiselect value chips, the relation as a pointer chip with the ↗ mark and no fill, a date in the quiet costume the grid gives a plain value, and a <code>+N</code> chip where a row overflows. Options vary field placement, density, whether labels show, and how overflow folds. Light and dark side by side. Pick one; a separate Feature lands it in the Card renderer.</p>
${sections}
<p class="lead" style="margin-top:8px">Shared by every option: 4px radius on every chip; no fill behind a pointer chip; the chip size from <code>--wv-chip-font</code> / <code>--wv-chip-line</code>; the card's title is the only link, the rest of the tile is inert.</p>
</div>
</body>
</html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = exportCardViewOptions();
  if (process.argv.includes('--stdout')) process.stdout.write(html);
  else { writeFileSync(OUT, html); console.log(`wrote ${OUT} (${html.length} bytes)`); }
}
