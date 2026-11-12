import test from 'node:test';
import assert from 'node:assert/strict';
import { CSS } from './lib/source.mjs';
import { touchFloor } from './lib/touch.mjs';
import '../public/phone-row.js';

const PR = globalThis.weavePhoneRow;
const MIN_SIZE = ['min-height', 'min-width', 'min-block-size', 'min-inline-size'];
const SHELL = [
  '#sidebar .brand',
  '#sidebar #nav-collapse',
  '#dock .crumb-row :is(.dl-wrap > .dots-btn, .dock-close, .activity-btn, .eye-btn, .table-share-btn)',
  '.crumb-row > .dl-wrap > .dots-btn, .crumb-row:not(:has(> .table-tools-btn)) > .crumb-actions > .table-share-btn',
  '.wv-board[data-lanes] .board-col-head',
  '.wv-board[data-groups="side"] .board-group-head',
];

function declarations(css) {
  const out = [];
  const stack = [];
  let buf = '';
  let quote = '';
  const flush = () => {
    const at = buf.indexOf(':');
    if (at > 0 && stack.length) {
      out.push({
        media: stack.filter((h) => h.startsWith('@')).join(' '),
        selector: stack.filter((h) => !h.startsWith('@')).join(' '),
        prop: buf.slice(0, at).trim(),
        value: buf.slice(at + 1).trim(),
      });
    }
    buf = '';
  };
  for (const ch of css) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' '));
      buf = '';
    } else if (ch === '}') {
      flush();
      stack.pop();
    } else if (ch === ';') flush();
    else buf += ch;
  }
  return out;
}

const DECLS = declarations(CSS);

test('one --wv-hit token: 24px on a fine pointer, 44px under (pointer: coarse), and no rule keeps a copy of its own (Issue #1712)', () => {
  const tokens = DECLS.filter((d) => d.prop === '--wv-hit').map((d) => `${d.media || 'base'} ${d.selector} ${d.value}`);
  assert.deepEqual(tokens, ['base :root 24px', '@media (pointer: coarse) :root 44px']);
});

test('one (pointer: coarse) :where() rule gives every touch target the --wv-hit floor, with checkbox and radio inputs opted out (Issue #1712)', () => {
  const floor = touchFloor(CSS);
  assert.ok(floor, 'style.css holds the coarse-pointer touch rule right after the token');
  assert.equal(floor.hit, '44px');
  assert.equal(floor.body, 'min-inline-size: var(--wv-hit); min-block-size: var(--wv-hit);');
  assert.deepEqual(floor.optOuts, ['input[type="checkbox"]', 'input[type="radio"]'], 'a bare checkbox or radio keeps its drawn box and its row takes the touch');
  assert.equal(new Set(floor.targets).size, floor.targets.length, 'each target is listed once');
  for (const target of ['.picker-pop :is(.picker-box, .picker-row)', '.wv-menu-row', '#cmdk-results .result']) {
    assert.ok(floor.targets.includes(target), `${target} is one of the rows the review measured at desktop size on a coarse pointer wider than 600px`);
  }
  const rules = DECLS.filter((d) => d.prop === 'min-block-size' && d.value === 'var(--wv-hit)');
  assert.equal(rules.length, 1, 'one rule sets the floor');
});

test('no touch floor is keyed to the viewport width: a 44px minimum under the phone layout is shell geometry, and none sits under a pointer query outside the one rule (Issue #1712)', () => {
  const floors = DECLS.filter((d) => MIN_SIZE.includes(d.prop) && /\b44px\b/.test(d.value));
  assert.deepEqual(floors.filter((d) => /pointer/.test(d.media)).map((d) => `${d.media} ${d.selector} { ${d.prop}: ${d.value} }`), [],
    'a coarse-pointer target joins the :where() list instead of carrying its own 44px');
  const width = floors.filter((d) => /max-width/.test(d.media) && !SHELL.includes(d.selector));
  assert.deepEqual(width.map((d) => `${d.media} ${d.selector} { ${d.prop}: ${d.value} }`), [],
    'a control sized to 44px only under the phone breakpoint stays desktop-sized on a tablet or an open fold; give it the --wv-hit floor instead');
});

test('a phone row grows its chip hit boxes to the --wv-hit token the page reads, and to 44px with no page to read (Issue #1712)', () => {
  const row = { left: 0, top: 0, right: 339, bottom: 88 };
  const chip = { left: 100, top: 34, right: 150, bottom: 54 };
  const tall = ([b]) => b.bottom - b.top;
  assert.equal(PR.HIT, 44);
  assert.equal(tall(PR.hitBoxes(row, [chip])), 44, 'with no document the box is the 44px touch size');
  const had = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  try {
    globalThis.document = { body: {} };
    globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => (name === '--wv-hit' ? ' 24px' : '') });
    assert.equal(tall(PR.hitBoxes(row, [chip])), 36, 'a fine pointer reads 24px, so the chip keeps only the 8px reach either side');
    globalThis.getComputedStyle = () => ({ getPropertyValue: (name) => (name === '--wv-hit' ? ' 44px' : '') });
    assert.equal(tall(PR.hitBoxes(row, [chip])), 44, 'a coarse pointer reads 44px');
  } finally {
    globalThis.document = had.document;
    globalThis.getComputedStyle = had.getComputedStyle;
  }
});
