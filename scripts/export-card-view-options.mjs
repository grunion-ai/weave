#!/usr/bin/env node
/* docs/mockups/card-view-options.html — fifteen card-view options for one
   Development/Issue row (Feature #181 A–E, Feature #184 F–O), every field
   value drawn as the SAME chip the table cell and the entity view use, light
   and dark side by side, a comparison matrix at the top and a note at the
   foot on which options are the shipped renderer under a different Card
   config and which need a new shape.

   Kyle, 2026-09-05: "Need mockups of card view options. Need to show field
   chips the same way we do in table and entity view, but within cards."
   Then, after A–E: "I want more variations of card view options."

   The chip CSS is not copied by hand: chipCss() lifts the live rules out of
   public/style.css (the same lift the anatomy export uses), so a token change
   moves the mockup too, and test/handbook.test.mjs fails when the checked-in
   file no longer matches a fresh run. Card contract kept per option:
   { shape: 'card', link, state, description: none|small|medium|large,
   fields }. 4px radius; no fill behind a pointer chip.

     node scripts/export-card-view-options.mjs            # writes the file
     node scripts/export-card-view-options.mjs --stdout   # prints it */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chipCss } from './export-chip-card-anatomy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'mockups', 'card-view-options.html');

/* Option O wears the edit costume, so the picker rules ride along too — the
   same lift chipCss does, over the selectors the one selection dialect and
   the date control use. Lifted, not copied, for the same reason. */
const PICKER_SELECTORS = /^(\.picker-|\.chip-pop|\.date-pick-btn|\.date-text)/;
export function pickerCss(css = readFileSync(join(ROOT, 'public/style.css'), 'utf8')) {
  const out = [];
  for (const [, sels, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const keep = sels.split(',').map((x) => x.trim()).filter((x) => PICKER_SELECTORS.test(x));
    if (!keep.length || !body.trim()) continue;
    out.push(`${keep.join(', ')} { ${body.replace(/\s+/g, ' ').trim()}${body.trim().endsWith(';') ? '' : ';'} }`);
  }
  return out.join('\n');
}

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

/* Facts Issue #193 does not carry but H, N and L call for. Borrowed from the
   tables that do (a person relation, a date range, a many-relation), so the
   mockup is honest about where each chip comes from. */
const EXTRA = {
  owner: { label: 'Owner', kind: 'person', value: 'Kyle Adriany', initials: 'KA', hue: 'teal', home: 'People' },
  due: { label: 'Due', kind: 'date', value: '2026-09-12' },
  window: { label: 'Window', kind: 'range', from: '2026-09-05', to: '2026-09-12', fromShort: 'Sep 5', toShort: 'Sep 12' },
  related: { label: 'Related', count: 4 },
  table: { name: 'Issue', icon: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>' },
};

/* ---- the chips: exactly the classes app.js emits for a cell ---- */
const stateChip = (s) => `<span class="k k-state cat-${s.category} hue-${s.hue}"><span class="ico"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg></span>${s.name}</span>`;
const selectChip = (f) => `<span class="k k-select hue-${f.hue}">${f.value}</span>`;
const multiChips = (f) => f.values.map((v) => `<span class="k k-multi hue-${v.hue}">${v.value}</span>`).join(' ');
const relChip = (f) => `<span class="mention-wrap"><span class="k k-rel"><a href="#" onclick="return false">${f.value}<span class="k-home">${f.home}</span></a></span></span>`;
const dateChip = (f) => `<span class="k k-computed wv-date"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>${f.value}</span>`;
const personChip = (f) => `<span class="mention-wrap"><span class="k k-rel"><a href="#" onclick="return false"><span class="av hue-${f.hue}">${f.initials}</span>${f.value}<span class="k-home">${f.home}</span></a></span></span>`;
const chip = (f) => ({ select: selectChip, multi: multiChips, relation: relChip, date: dateChip, person: personChip })[f.kind](f);
const more = (n) => (n > 0 ? `<span class="k k-more">+${n}</span>` : '');
const labelled = (f) => `<span class="wv-cf"><span class="wv-cf-l">${f.label}</span>${chip(f)}</span>`;

const title = (link = true, wrapName = false) => `<a class="wv-card-title" href="#" onclick="return false">${link ? `<span class="wv-card-id">${ROW.id}</span>` : ''}${wrapName ? `<span class="wv-card-name">${ROW.name}</span>` : ROW.name}</a>`;
const desc = (size) => (size === 'none' ? '' : `<div class="wv-card-desc wv-desc-${size}">${ROW.description[size]}</div>`);

/* ---- round-2 costumes: the picker as app.js draws it, the range bar ---- */
const rangeBar = (r) => `<div class="wv-range-bar" aria-label="${r.from} to ${r.to}"><span class="wv-range-tick">${r.fromShort}</span><span class="wv-range-fill"></span><span class="wv-range-tick">${r.toShort}</span></div>`;
/* A chip in its edit costume: the picker box the cell becomes on click, the
   chosen chip(s) inside ahead of the caret, the search input bare. */
const editBox = (chips, placeholder = 'Search…') => `<div class="picker-box"><span class="picker-chips">${chips}</span><input class="picker-search" placeholder="${placeholder}" type="text" readonly></div>`;
const editSelect = (f) => editBox(`<span class="k k-select hue-${f.hue} picker-chip">${f.value}<span class="x" title="Remove">×</span></span>`);
const editMulti = (f) => editBox(f.values.map((v) => `<span class="k k-multi hue-${v.hue} picker-chip">${v.value}<span class="x" title="Remove">×</span></span>`).join(''));
const editRel = (f) => editBox(`<span class="k k-multi hue-slate picker-chip">${f.value}<span class="x" title="Remove">×</span></span>`);
const editDate = (f) => `<div class="picker-box wv-date-edit"><input class="picker-search date-text" value="${f.value}" readonly><button class="date-pick-btn" type="button" aria-label="Pick a date">${dateChip({ value: '' }).replace(/<\/?span[^>]*>/g, '')}</button></div>`;
const editState = (s) => editBox(`<span class="k k-state cat-${s.category} hue-${s.hue} picker-chip sel"><span class="ico"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg></span>${s.name}</span>`);
const editChip = (f) => ({ select: editSelect, multi: editMulti, relation: editRel, date: editDate })[f.kind](f);
/* The one picker that is open: Severity, Low is current, the caret on Medium. */
const pickerOpen = (f, rows) => `<div class="chip-pop picker-pop wv-pop-inline"><div class="picker-title">${f.label}</div>${editSelect(f)}<div class="picker-list">${rows.map((r, i) => `<button class="chip-pop-row picker-row${i === 1 ? ' active' : ''}" type="button"><span class="picker-num">${i + 1}</span><span class="k k-select hue-${r.hue}">${r.value}</span>${r.value === f.value ? '<span class="chip-pop-check">✓</span>' : ''}</button>`).join('')}</div></div>`;
const SEVERITIES = [{ value: 'Low', hue: 'green' }, { value: 'Medium', hue: 'amber' }, { value: 'High', hue: 'orange' }, { value: 'Blocking', hue: 'red' }];

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
  /* ---- round 2 (Feature #184): axes A–E did not touch ---- */
  {
    key: 'F', name: 'Cover card', config: { link: true, state: true, description: 'small', fields: null }, renderer: 'new shape',
    optimises: 'a gallery read from across the room — the state owns a colour band across the top (an attachment thumbnail would take the same slot), so the column of cards reads as a heat map before a single word is read.',
    render: () => `<div class="wv-card wv-opt-f">
  <div class="wv-card-cover cat-${ROW.state.category} hue-${ROW.state.hue}">${stateChip(ROW.state)}</div>
  <div class="wv-card-head">${title()}</div>
  ${desc('small')}
  <div class="wv-card-foot">${ROW.fields.slice(0, 3).map(chip).join(' ')}${more(ROW.fields.length - 3)}</div>
</div>`,
  },
  {
    key: 'G', name: 'Two-column split', config: { link: true, state: true, description: 'medium', fields: ['Severity', 'Symptom', 'Fixed in', 'Reported'] }, renderer: 'new shape',
    optimises: 'a wide card in a two-up gallery or a peek — prose keeps the left column at reading width; the facts stack on the right as a labelled ledger, each value still the chip.',
    render: () => `<div class="wv-card wv-opt-g">
  <div class="wv-split-main">
    <div class="wv-card-head">${title()}${stateChip(ROW.state)}</div>
    ${desc('medium')}
  </div>
  <div class="wv-split-aside">${ROW.fields.slice(0, 4).map((f) => `<span class="wv-cf wv-cf-stack"><span class="wv-cf-l">${f.label}</span>${chip(f)}</span>`).join('')}</div>
</div>`,
  },
  {
    key: 'H', name: 'Kanban tile', config: { link: true, state: false, description: 'none', fields: ['Owner', 'Due'] }, renderer: 'config',
    optimises: 'a board column — the column already says the state, so no state chip; who and when are the only facts a tile needs to be dragged. (Issue has no person field; the Owner chip is borrowed from a People-target relation.)',
    render: () => `<div class="wv-card wv-opt-h">
  <div class="wv-card-head">${title()}</div>
  <div class="wv-card-foot wv-foot-between">${personChip(EXTRA.owner)}${dateChip(EXTRA.due)}</div>
</div>`,
  },
  {
    key: 'I', name: 'Sidebar accent', config: { link: true, state: true, description: 'small', fields: null }, renderer: 'new shape',
    optimises: 'a list of cards where the state should be felt, not read — a 3px accent in the state colour at the left edge, one row of chips, the id tucked in the corner so the title starts flush.',
    render: () => `<div class="wv-card wv-opt-i wv-accent-state cat-${ROW.state.category} hue-${ROW.state.hue}">
  <span class="wv-card-corner-id">${ROW.id}</span>
  <div class="wv-card-head">${title(false)}</div>
  ${desc('small')}
  <div class="wv-card-foot wv-foot-nowrap">${stateChip(ROW.state)}${ROW.fields.slice(0, 3).map(chip).join(' ')}${more(ROW.fields.length - 3)}</div>
</div>`,
  },
  {
    key: 'J', name: 'Table-row card', config: { link: true, state: true, description: 'none', fields: ['Severity', 'Symptom', 'Fixed in', 'Reported'] }, renderer: 'new shape',
    optimises: 'lifting a row out of the grid — the card keeps the table\'s column order as inline cells, so a card dragged from a table to a board or a document still reads left to right the way the row did.',
    render: () => `<div class="wv-card wv-opt-j">
  <div class="wv-row-cell wv-row-name">${title(true, true)}</div>
  <div class="wv-row-cell">${stateChip(ROW.state)}</div>
  ${ROW.fields.slice(0, 4).map((f) => `<div class="wv-row-cell">${chip(f)}</div>`).join('\n  ')}
</div>`,
  },
  {
    key: 'K', name: 'Icon-led', config: { link: true, state: false, description: 'none', fields: ['Severity'] }, renderer: 'new shape',
    optimises: 'a picker row or a search result — the table\'s icon large at the left says what kind of thing this is before the name does; one key field and nothing else, so twenty results still scan.',
    render: () => `<div class="wv-card wv-opt-k">
  <span class="wv-card-ticon" title="${EXTRA.table.name}">${EXTRA.table.icon}</span>
  <div class="wv-icon-body">
    <div class="wv-card-head">${title()}</div>
    <div class="wv-card-foot">${chip(ROW.fields[0])}<span class="wv-card-kind">${EXTRA.table.name}</span></div>
  </div>
</div>`,
  },
  {
    key: 'L', name: 'Dense list item', config: { link: true, state: true, description: 'none', fields: ['Severity'] }, renderer: 'new shape',
    optimises: 'a long relation list in the entity side column — 32px tall, the name ellipsised, the state and one chip, and a count of what else this row points at, so fifty items fit where five cards would.',
    render: () => `<div class="wv-card wv-opt-l">
  ${title(true, true)}
  ${stateChip(ROW.state)}${chip(ROW.fields[0])}
  <span class="k k-more wv-rel-count" title="${EXTRA.related.count} related rows">⇄ ${EXTRA.related.count}</span>
</div>`,
  },
  {
    key: 'M', name: 'Relation-forward', config: { link: true, state: true, description: 'none', fields: ['Fixed in', 'Owner', 'Area'] }, renderer: 'config',
    optimises: 'a CRM or a people table where the connections ARE the row — the relation targets lead as a chip cluster (who and what this touches), the name second, the state trailing quietly.',
    render: () => `<div class="wv-card wv-opt-m">
  <div class="wv-rel-cluster">${relChip(ROW.fields[2])}${personChip(EXTRA.owner)}${chip(ROW.fields[4])}</div>
  <div class="wv-card-head">${title()}${stateChip(ROW.state)}</div>
</div>`,
  },
  {
    key: 'N', name: 'Timeline card', config: { link: true, state: true, description: 'none', fields: ['Window', 'Severity', 'Fixed in'] }, renderer: 'new shape',
    optimises: 'a daterange-carrying table — the range is drawn as a bar with its ends dated, the other fields hang beneath it, so a column of these cards is already a rough Gantt.',
    render: () => `<div class="wv-card wv-opt-n">
  <div class="wv-card-head">${title()}${stateChip(ROW.state)}</div>
  ${rangeBar(EXTRA.window)}
  <div class="wv-card-foot wv-foot-hang">${chip(ROW.fields[0])}${chip(ROW.fields[2])}</div>
</div>`,
  },
  {
    key: 'O', name: 'Editable card', config: { link: true, state: true, description: 'medium', fields: null }, renderer: 'config',
    optimises: 'in-card editing — B\'s layout with every chip in its edit costume: each value sits in the picker box the cell becomes on click, and one picker (Severity) is open with the caret on Medium, to show the card is a surface you change on, not only read.',
    render: () => `<div class="wv-card wv-opt-o wv-card-editing">
  <div class="wv-card-head">${title()}${editState(ROW.state)}</div>
  ${desc('medium')}
  <div class="wv-card-foot wv-foot-edit">
    <span class="wv-edit-cell wv-edit-open">${editSelect(ROW.fields[0])}${pickerOpen(ROW.fields[0], SEVERITIES)}</span>
    <span class="wv-edit-cell">${editChip(ROW.fields[1])}</span>
    <span class="wv-edit-cell">${editChip(ROW.fields[2])}</span>
    ${more(ROW.fields.length - 3)}
  </div>
</div>`,
  },
];

/* ---- the matrix: options × the axes the brief names ---- */
const MATRIX = {
  A: ['header line', 'medium', 'no', '+N in the head', 'chip in the head', 'small', 'config'],
  B: ['footer row', 'medium', 'no', '+N in the foot', 'chip in the head', 'medium', 'config'],
  C: ['labelled grid', 'medium', 'yes, column', 'configured list', 'chip in the head', 'small', 'config'],
  D: ['footer row', 'compact', 'no', '+N in the foot', 'chip in the head', 'none', 'config'],
  E: ['labelled wrap', 'large', 'yes, inline', 'all configured', 'chip in the head', 'large', 'config'],
  F: ['footer row', 'medium', 'no', '+N in the foot', 'cover band + chip', 'small', 'new shape'],
  G: ['right stack', 'wide', 'yes, stacked', 'configured list', 'chip in the head', 'medium', 'new shape'],
  H: ['footer row', 'compact', 'no', 'two fields, none', 'implied by column', 'none', 'config'],
  I: ['single row', 'medium', 'no', '+N, no wrap', '3px accent + chip', 'small', 'new shape'],
  J: ['inline cells', 'one line', 'no', 'configured list', 'cell in order', 'none', 'new shape'],
  K: ['one field', 'compact', 'no', 'one field, none', 'none', 'none', 'new shape'],
  L: ['inline', '32px', 'no', 'relation count', 'chip inline', 'none', 'new shape'],
  M: ['cluster first', 'medium', 'no', 'configured list', 'chip trailing', 'none', 'config'],
  N: ['under the bar', 'medium', 'no', 'configured list', 'chip in the head', 'none', 'new shape'],
  O: ['footer row', 'medium', 'no', '+N in the foot', 'edit box in the head', 'medium', 'config'],
};
const AXES = ['Field placement', 'Density', 'Labels', 'Overflow', 'State', 'Description', 'Renderer'];

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
/* ---- round 2 (Feature #184) ---- */
.matrix-wrap { overflow-x: auto; margin: 0 0 34px; border: 1px solid var(--line); border-radius: 8px; background: var(--tblr-bg-surface, #fafaf8); }
.matrix { border-collapse: collapse; width: 100%; font-size: 12.5px; }
.matrix th, .matrix td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: top; }
.matrix thead th { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; }
.matrix tbody th { font-family: var(--mono); font-weight: 500; }
.matrix tbody th a { color: inherit; text-decoration: none; }
.matrix tbody th a:hover { color: var(--tblr-primary); }
.matrix tbody tr:last-child th, .matrix tbody tr:last-child td { border-bottom: 0; }
.matrix td.r-config { color: #218358; }
.matrix td.r-new { color: #9a4310; }
.matrix tr.round2 th { background: rgba(37, 99, 235, .06); }
.panel.wide .wv-card { max-width: 100%; width: 100%; }
.panel.column { background: var(--tblr-bg-surface-secondary); }
.panel.column .wv-card { max-width: 300px; }
.renderers { margin: 8px 0 0; padding: 18px 20px; border: 1px solid var(--line); border-radius: 8px; }
.renderers h2 { font-size: 15px; margin: 0 0 8px; }
.renderers p { margin: 0 0 8px; max-width: 90ch; }
.renderers ul { margin: 0; padding-left: 20px; }
.renderers li { margin: 2px 0; }
.renderers code { font-family: var(--mono); font-size: 12px; }
/* F — a cover band across the top in the state colour; the fill token the
   state chip already carries, so the band and the chip agree by construction. */
.wv-opt-f { padding: 0; overflow: hidden; }
.wv-card-cover { padding: 8px 10px; background: var(--fill, var(--tblr-bg-surface-secondary)); border-bottom: 1px solid var(--tblr-border-color); }
.wv-card-cover .k-state { background: var(--tblr-bg-surface); }
.wv-opt-f .wv-card-head, .wv-opt-f .wv-card-desc, .wv-opt-f .wv-card-foot { margin: 0 10px; }
.wv-opt-f .wv-card-head { margin-top: 8px; }
.wv-opt-f .wv-card-foot { margin-bottom: 8px; }
/* G — two columns: prose left, a labelled ledger right. */
.wv-opt-g { flex-direction: row; gap: 14px; max-width: 560px; }
.wv-split-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.wv-split-aside { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding-left: 14px; border-left: 1px solid var(--tblr-border-color); }
.wv-cf-stack { flex-direction: column; align-items: flex-start; gap: 1px; }
.wv-cf-stack .wv-cf-l { font-size: 11px; }
/* H — a board tile: who and when, the ends of the row. */
.wv-foot-between { justify-content: space-between; }
/* I — a 3px accent in the state colour; the id in the corner. */
.wv-accent-state { border-left: 3px solid var(--text, var(--tblr-secondary)); position: relative; padding-right: 44px; }
.wv-card-corner-id { position: absolute; top: 6px; right: 8px; font-family: var(--tblr-font-monospace); font-size: 11px; opacity: .55; }
.wv-foot-nowrap { flex-wrap: nowrap; overflow: hidden; }
.wv-foot-nowrap > * { flex: none; }
/* J — the row lifted out of the grid: inline cells in column order. */
.wv-opt-j { flex-direction: row; align-items: center; gap: 0; max-width: 100%; padding: 0; }
.wv-row-cell { padding: 6px 10px; border-right: 1px solid var(--tblr-border-color); white-space: nowrap; display: inline-flex; align-items: center; }
.wv-row-cell:last-child { border-right: 0; }
.wv-row-name { flex: 1 1 auto; min-width: 0; }
.wv-row-name .wv-card-title { white-space: nowrap; min-width: 0; }
.wv-card-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pair.stack { grid-template-columns: 1fr; }
/* K — the table icon large at left; one field; the kind named quietly. */
.wv-opt-k { flex-direction: row; align-items: center; gap: 12px; max-width: 420px; }
.wv-card-ticon { flex: none; width: 36px; height: 36px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: var(--tblr-bg-surface-secondary); color: var(--tblr-secondary); }
.wv-card-ticon svg { display: block; }
.wv-icon-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.wv-card-kind { font-family: var(--tblr-font-monospace); font-size: 11px; opacity: .55; margin-left: 4px; }
/* L — 32px tall, one line, the name gives way first. */
.wv-card.wv-opt-l { flex-direction: row; align-items: center; gap: 6px; height: 32px; padding: 0 10px; max-width: 420px; }
.wv-opt-l .wv-card-title { flex: 1 1 auto; min-width: 0; white-space: nowrap; }
.wv-opt-l .k { flex: none; }
.wv-rel-count { letter-spacing: .02em; }
/* M — the cluster leads; the head trails. */
.wv-rel-cluster { display: flex; flex-wrap: wrap; gap: 6px; }
.wv-opt-m .wv-card-head .k-state { opacity: .8; }
/* N — the range as a bar, dated at both ends; fields hang beneath. */
.wv-range-bar { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
.wv-range-fill { flex: 1 1 auto; height: 6px; border-radius: 3px; background: rgba(var(--tblr-primary-rgb), .35); position: relative; }
.wv-range-fill::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 40%; border-radius: 3px; background: var(--tblr-primary); }
.wv-range-tick { font-family: var(--tblr-font-monospace); font-size: 11px; color: var(--tblr-secondary); }
.wv-foot-hang { padding-left: 14px; border-left: 2px solid var(--tblr-border-color); margin-left: 6px; }
/* O — the edit costume: every chip in its picker box; one picker open in
   place (the live one is position: fixed; here it hangs under its cell). */
.wv-card-editing { max-width: 440px; }
.wv-card-editing .picker-box { margin-bottom: 0; width: auto; display: inline-flex; }
.wv-card-editing .picker-search { flex: 0 0 62px; min-width: 0; width: 62px; }
.wv-foot-edit { align-items: flex-start; position: relative; }
.wv-card-editing .wv-card-head .picker-box { flex-wrap: nowrap; }
.wv-edit-cell { display: inline-flex; }
.wv-edit-open > .picker-box { border-color: var(--tblr-primary); }
.wv-pop-inline { position: absolute; top: calc(100% + 4px); left: 0; z-index: 3; animation: none; }
.wv-card-editing { padding-bottom: 218px; }
.wv-pop-inline.picker-pop { min-width: 200px; }
.wv-pop-inline .picker-box { display: flex; width: 100%; margin-bottom: 6px; }
.wv-pop-inline .picker-row { width: 100%; }
.wv-date-edit .date-text { width: 92px; font-family: var(--tblr-font-monospace); }
.wv-date-edit .date-pick-btn svg { display: block; }
`;

const PANEL = { G: 'panel wide', H: 'panel column', J: 'panel wide', O: 'panel wide' };
const PAIR = { J: 'pair stack' };

export function exportCardViewOptions() {
  const sections = OPTIONS.map((o) => `<section class="opt" id="option-${o.key.toLowerCase()}">
<h2><span class="key">Option ${o.key}</span>${o.name}</h2>
<p class="note">Optimises for <b>${o.optimises}</b></p>
<code class="cfg">${cfg(o.config)}</code>
<div class="${PAIR[o.key] ?? 'pair'}">
<div class="${PANEL[o.key] ?? 'panel'}" data-bs-theme="light">${o.render()}</div>
<div class="${PANEL[o.key] ?? 'panel'}" data-bs-theme="dark">${o.render()}</div>
</div>
</section>`).join('\n');
  const matrix = `<div class="matrix-wrap"><table class="matrix">
<thead><tr><th>Option</th>${AXES.map((a) => `<th>${a}</th>`).join('')}</tr></thead>
<tbody>
${OPTIONS.map((o) => `<tr${o.key > 'E' ? ' class="round2"' : ''}><th scope="row"><a href="#option-${o.key.toLowerCase()}">${o.key}</a> ${o.name}</th>${MATRIX[o.key].map((v, i) => (i === AXES.length - 1 ? `<td class="${v === 'config' ? 'r-config' : 'r-new'}">${v}</td>` : `<td>${v}</td>`)).join('')}</tr>`).join('\n')}
</tbody></table></div>`;
  const byRenderer = (r) => OPTIONS.filter((o) => (o.renderer ?? 'config') === r).map((o) => o.key);
  const renderers = `<section class="renderers">
<h2>Which options are the shipped renderer, and which need a new shape</h2>
<p><b>${byRenderer('config').join(', ')}</b> are the same <code>renderView(ref, 'card', { config })</code> under a different <code>Card</code> config — the contract already carries <code>link</code>, <code>state</code>, <code>description</code> and <code>fields</code>, and <code>viewCardEl</code> draws head, description, foot in that order. What varies between them is only which of those are on and how many fields ride along: H is <code>state: false, description: 'none', fields: [Owner, Due]</code>; M is the configured fields drawn before the head instead of after (one flag on the card tile, <code>fieldsFirst</code>, or a field-order convention); O is the same tile with each chip swapped for the cell's edit control, which the grid already knows how to do (<code>picker-box</code> + <code>picker-pop</code>) — a card-level <code>editable</code> switch, no new markup.</p>
<p><b>${byRenderer('new shape').join(', ')}</b> each change the tile's geometry, so they need a new <code>shape</code> beside <code>chip</code> and <code>card</code> (or a <code>layout</code> key inside the Card config that <code>viewCardEl</code> switches on):</p>
<ul>
<li><b>F</b> cover — a band above the head that reads the state's <code>--fill</code>; the head loses its state chip to the band.</li>
<li><b>G</b> split — two flex columns; the aside stacks label-over-chip, which no shipped rule does.</li>
<li><b>I</b> accent — a left border in the state's <code>--text</code> and an absolutely placed id; the foot refuses to wrap.</li>
<li><b>J</b> row — inline cells in the table's <code>fieldOrder</code>, not the Card's <code>fields</code> list; the only option that reads the grid's column order.</li>
<li><b>K</b> icon-led — a table-icon slot the card has no notion of today; one field, the table name as a caption.</li>
<li><b>L</b> list item — a fixed 32px single line plus a relation count the renderer does not compute.</li>
<li><b>N</b> timeline — a range drawn as a bar, which is a new value costume, not a chip.</li>
</ul>
<p>Recommendation: land the config-only four first (H, M, O and any of A–E Kyle picks), then add one <code>layout</code> key to the Card contract for the new shapes rather than minting seven <code>shape</code> values — <code>shape</code> stays the coarse answer to "chip or card", <code>layout</code> the fine one.</p>
</section>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="kind" content="design-review"><meta name="generated-at" content="2026-09-05"><meta name="repo" content="grunion-ai/weave">
<title>weave — card view options (Features #181, #184)</title>
<style>
/* weave chip system, lifted from public/style.css — the same rules a table cell uses */
${chipCss()}
/* the picker and the date control, lifted the same way — Option O's edit costume */
${pickerCss()}
${TOKENS}</style>
</head>
<body>
<div class="wrap">
<h1>Card view options</h1>
<p class="lead">Fifteen ways to lay out the <b>Card</b> view (Feature #175) for one <code>Development/Issue</code> row — Issue #193 as it stands. A–E are round 1 (Feature #181); F–O are round 2 (Feature #184), varying axes A–E left alone: a cover band, a two-column split, a board tile, a sidebar accent, a lifted table row, an icon-led result, a 32px list item, relations first, a date-range bar, and every chip in its edit costume. Every field value is the <b>same chip the table cell and the entity view draw</b>: the state chip with its glyph (category owns the colour), select and multiselect value chips, the relation as a pointer chip with the ↗ mark and no fill, a person as the same pointer with its avatar, a date in the quiet costume the grid gives a plain value, and a <code>+N</code> chip where a row overflows. Light and dark side by side. The matrix compares them on one screen; the note at the foot says which are one renderer under a different config and which need a new shape. Pick one; a separate Feature lands it in the Card renderer.</p>
${matrix}
${sections}
${renderers}
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
