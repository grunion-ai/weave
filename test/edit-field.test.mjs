import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const PUBLIC = new URL('../public/', import.meta.url);
const read = (p) => readFileSync(new URL(p, PUBLIC), 'utf8');
const CSS = read('style.css');
const SCRIPTS = readdirSync(PUBLIC).filter((f) => f.endsWith('.js')).map((f) => [f, read(f)]);
const APP = read('app.js');

const rules = () => {
  const out = [];
  const tok = /([^{}]+)\{|\}/g;
  let m;
  while ((m = tok.exec(CSS))) {
    if (m[0] === '}') continue;
    const head = m[1].trim();
    if (head.startsWith('@')) continue;
    const end = CSS.indexOf('}', tok.lastIndex);
    out.push({ selector: head, body: CSS.slice(tok.lastIndex, end) });
    tok.lastIndex = end + 1;
  }
  return out;
};
const split = (list) => {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  parts.push(cur.trim());
  return parts;
};
const stripNot = (sel) => {
  let out = sel;
  for (let at = out.indexOf(':not('); at !== -1; at = out.indexOf(':not(')) {
    let depth = 0;
    let i = at + 4;
    for (; i < out.length; i++) {
      if (out[i] === '(') depth++;
      if (out[i] === ')' && --depth === 0) break;
    }
    out = out.slice(0, at) + out.slice(i + 1);
  }
  return out;
};
const decl = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+?)\\s*(?:;|$)`))?.[1];

const FIELDS = /\.(?:title-edit|view-title|name-edit|inline-edit|view-name-input|nav-inline-add|view-desc-edit)(?![-\w])/;
const FOCUS_PAINT = /(?:^|;)\s*(?:border(?:-[a-z]+)*-color|border|outline(?:-[a-z]+)*|box-shadow)\s*:/;

test('the view title and the record name get .wv-edit from the one title builder (Issue #1030)', () => {
  const at = APP.search(/^function titleEdit\(/m);
  const body = APP.slice(at, APP.indexOf('\n}', at) + 2);
  assert.match(body, /class: `title-edit wv-edit \$\{/, body);
  assert.match(body, /placeholder: 'Untitled'/, 'an empty title or name shows Untitled');
});

test('every grid cell, field row, view rename, nav add and description editor is built with .wv-edit (Issue #1030)', () => {
  const missing = [];
  const seen = new Set();
  for (const [file, src] of SCRIPTS) {
    for (const m of src.matchAll(/class: ['`]([^'`]*)['`]/g)) {
      const classes = m[1].split(/\s+/);
      const field = ['inline-edit', 'view-name-input', 'nav-inline-add', 'view-desc-edit'].find((c) => classes.includes(c));
      if (!field) continue;
      seen.add(field);
      if (!classes.includes('wv-edit')) missing.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual([...seen].sort(), ['inline-edit', 'nav-inline-add', 'view-desc-edit', 'view-name-input']);
  assert.deepEqual(missing, []);
});

test('.wv-edit paints rest, hover and one focus ring, and beats the global focus outline (Issue #1030)', () => {
  const all = rules();
  const base = all.find((r) => r.selector === '.wv-edit');
  assert.ok(base, 'a bare .wv-edit rule');
  assert.equal(decl(base.body, 'padding'), 'var(--wv-edit-pad)');
  assert.equal(decl(base.body, 'font-size'), 'var(--wv-edit-fs)');
  assert.equal(decl(base.body, 'border'), '1px solid transparent');
  assert.equal(decl(base.body, 'border-radius'), '6px');
  assert.equal(decl(base.body, 'background-color'), 'transparent');
  const hover = all.find((r) => split(r.selector).some((s) => s.startsWith('.wv-edit') && s.endsWith(':hover')));
  assert.ok(hover, 'a .wv-edit hover rule');
  assert.match(hover.selector, /:not\([^)]*\[readonly\][^)]*:focus[^)]*\)|:not\([^)]*:focus[^)]*\[readonly\][^)]*\)/, 'hover skips read-only and focused fields');
  assert.equal(decl(hover.body, 'border-color'), 'var(--tblr-border-color)');
  const focus = all.find((r) => split(r.selector).includes('.wv-edit:focus'));
  assert.ok(focus, 'a .wv-edit:focus rule');
  assert.equal(decl(focus.body, 'box-shadow'), 'inset 0 0 0 1.5px var(--tblr-primary)');
  assert.equal(decl(focus.body, 'background-color'), 'var(--tblr-bg-surface)');
  assert.equal(decl(focus.body, 'border-color'), 'transparent');
  assert.equal(decl(focus.body, 'outline'), 'none !important', 'the global :focus-visible outline is !important, so the ring must be too');
  assert.ok(split(focus.selector).includes('.wv-edit:focus-visible'), 'the rule names :focus-visible as well');
});

test('no rule for the six editable fields paints its own focus border, outline or shadow (Issue #1030)', () => {
  const own = [];
  for (const r of rules()) {
    for (const sel of split(r.selector)) {
      const bare = stripNot(sel);
      if (!FIELDS.test(bare) || !/:focus(?!-within)/.test(bare)) continue;
      if (FOCUS_PAINT.test(r.body)) own.push(sel);
    }
  }
  assert.deepEqual(own, []);
});

test('no rule for the six editable fields paints its own resting border colour or outline (Issue #1030)', () => {
  const own = rules().filter((r) => split(r.selector).some((s) => FIELDS.test(s) && !/:hover|:focus|::placeholder/.test(s) && !s.startsWith('.cell-pop') && !s.startsWith('#main > .table-wrap'))
    && /(?:^|;)\s*(?:border-color|outline)\s*:/.test(r.body));
  assert.deepEqual(own.map((r) => r.selector), []);
});

test('an editable field that sizes to its content never collapses below 8ch, outside the phone list pill that hides when empty (Issue #1030)', () => {
  const all = rules();
  const floor = all.find((r) => split(r.selector).includes('.wv-edit:placeholder-shown'));
  assert.equal(floor && decl(floor.body, 'min-width'), '8ch', 'an empty field showing its placeholder is at least 8ch');
  const sized = all.filter((r) => split(r.selector).some((s) => FIELDS.test(s) && !s.startsWith('.list-phone .phone-chip')) && decl(r.body, 'field-sizing') === 'content');
  assert.ok(sized.length >= 3, `found ${sized.length} content-sized field rules`);
  const short = sized.filter((r) => decl(r.body, 'min-width') !== '8ch' && !(/\.view-title(?![-\w])|\.name-edit/.test(r.selector) && !decl(r.body, 'min-width')));
  assert.deepEqual(short.map((r) => r.selector), [], 'a field without a placeholder floors at 8ch itself; the titles lean on Untitled');
});

test('the view title pulls left only when it leads its row, and the row keeps an 8px gap in both modes (Issue #1030)', () => {
  const all = rules();
  const pulls = all.filter((r) => /\.view-title(?![-\w])/.test(r.selector) && /margin(-left)?\s*:/.test(r.body) && /-\d/.test(decl(r.body, 'margin') ?? decl(r.body, 'margin-left') ?? ''));
  assert.ok(pulls.some((r) => r.selector === '.view-title-row > .view-title-h:first-child > .view-title'), 'the title pulls left when it leads');
  assert.deepEqual(pulls.filter((r) => !/:first-child > \.view-title$|\.icon-btn:has\(> \.icon-ghost\) \+ \.view-title-h > \.view-title$/.test(r.selector)).map((r) => r.selector), [], 'or when the only thing before it is the icon slot the phone hides');
  const row = all.filter((r) => r.selector === '.view-title-row' && decl(r.body, 'gap'));
  assert.deepEqual(row.map((r) => decl(r.body, 'gap')), ['8px']);
  assert.deepEqual(all.filter((r) => /\.view-title-row$/.test(r.selector) && r.selector !== '.view-title-row' && decl(r.body, 'gap')).map((r) => r.selector), []);
});

test('the title info button is a superscript glyph whose hit area leaves the row height alone (Issue #1030)', () => {
  const all = rules();
  const info = all.find((r) => r.selector === '.view-title-row > .desc-info');
  assert.ok(info);
  assert.equal(decl(info.body, '--wv-hit'), '24px');
  assert.equal(decl(info.body, 'width'), 'var(--wv-hit)');
  assert.equal(decl(info.body, 'height'), 'var(--wv-hit)');
  assert.match(decl(info.body, 'margin') ?? '', /calc\(/, 'a negative margin cancels the hit area');
  const glyph = all.find((r) => r.selector.startsWith('.view-title-row > .desc-info .wv-icon'));
  const px = Number(decl(glyph.body, 'width').replace('px', ''));
  assert.ok(px >= 13 && px <= 15, `glyph ${px}px`);
  assert.match(CSS, /@media \(max-width: 600px\), \(pointer: coarse\) \{[^@]*\.view-title-row > \.desc-info \{ --wv-hit: 44px;[^}]*\}/);
});
